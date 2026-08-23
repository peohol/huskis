/*
  Regresjonstest: DROP-ANIMASJONEN.

  5. Slippes objektet ved (eller utenfor) viewportkanten, skal fly-inn-animasjonen
     starte fra objektets FAKTISK RENDREDE boks — ikke fra den UKLEMTE
     `drag.lastX - grabX`, som ligger utenfor skjermen når klemmen har slått inn
     (ga et synlig hopp idet man slapp). Målt på et LISTEPUNKT: det er nivåene
     som fortsatt kjører den hjemmesnekrede motoren som har den transformen.
     For en LISTE er drop-animasjonen dnd-kits, og klemmen Smetts `SafeViewport`
     — påstanden der er den samme, og måles som den gjelder: kortet holder seg
     innenfor viewporten, og slippet lar ingen dra-maling bli igjen.
  6. Løfte-skalaen følger objekttypen — liste 1.02, listepunkt 1.03 — og ikke en
     hardkodet 1.02 for alt. På de nivåene som kjører den gamle motoren leses den
     av drop-animasjonens startskala; på dnd-kit-nivåene (`docs/drag-and-drop.md`
     — nav-modalen og hovedsidens KORTNIVÅ) er drop-animasjonen bibliotekets, og
     skalaen ligger i CSS på `[data-dnd-dragging]`. Der måles derfor det som
     faktisk MALES under draget: skalaen, og at rotasjonen settes som en EGEN
     `rotate`-egenskap — dnd-kit skriver `transform` selv, med `!important`, så
     en rotasjon lagt der ville forsvunnet uten at noe annet feilet.

  Gestene er EKTE input (`tests/dnd-gestures.js`).

  Kjør:
    python3 -m http.server 8000                    # fra repo-roten, i egen terminal
    NODE_PATH=$(npm root -g) node tests/dnd-drop-animation.test.js
*/
const { chromium } = require('playwright');
const G = require('./dnd-gestures.js');

const BASE = process.env.HUSKIS_URL || 'http://localhost:8000';

async function register(p) {
  await p.goto(BASE + '/?mock=1');
  await p.waitForTimeout(500);
  const email = 'u' + Math.floor(Math.random() * 1e9) + '@test.no';
  await p.getByText('Registrer deg').click(); await p.waitForTimeout(300);
  await p.locator('#auth-first-name').fill('Test');
  await p.locator('#auth-last-name').fill('Bruker');
  await p.locator('#auth-email').fill(email);
  await p.locator('#auth-password').fill('passord123');
  await p.locator('#auth-submit').click(); await p.waitForTimeout(700);
  await p.getByText('Tilbake til innlogging').click(); await p.waitForTimeout(300);
  await p.locator('#auth-email').fill(email);
  await p.locator('#auth-password').fill('passord123');
  await p.locator('#auth-submit').click();
  // `lastMy` settes først når get_my_doc har svart — da er kontoen innlogget
  // og dokumentet hentet. (En fersk konto har null områder — board er tomt.)
  await p.waitForFunction(() => {
    const H = window.__huskis;
    return H && H.authUser && H.lastMy;
  }, null, { timeout: 10000, polling: 200 });
  // Introduksjonen (docs/introduksjon.md) møter enhver ny konto: omvisningen
  // legger seg over appen, og et gest-tips legger seg nederst på skjermen —
  // ingen av delene er det denne testen handler om.
  await p.evaluate(() => window.__huskis.tour.skipAll());
  await p.waitForTimeout(150);
}

async function seed(p, cards) {
  await p.evaluate(() => { window.__huskis.addUniverse(); }); await p.waitForTimeout(150);
  await p.keyboard.press('Escape'); await p.waitForTimeout(150);
  await p.evaluate(() => { window.__huskis.addGroup(); }); await p.waitForTimeout(150);
  await p.keyboard.press('Escape'); await p.waitForTimeout(150);
  await p.evaluate((cards) => {
    const H = window.__huskis, st = H.state;
    const u = st.universes.find((x) => x.id === st.activeUniverse);
    const g = u.groups.find((x) => x.id === st.activeGroup);
    const mk = () => ({ ts: 0, org: 't', pos: 0, posTs: 0, posOrg: 't' });
    g.cards = cards.map(([title, n], pos) => {
      const id = 'card-' + title;
      const c = Object.assign({ id, group: g.id, title, trashed: false, k: true, p: true, labTs: 0, labOrg: 't', items: [] }, mk());
      c.pos = pos;
      for (let i = 0; i < n; i++) {
        const it = Object.assign({ id: 'it-' + title + '-' + i, text: title + ' ' + i, home: id, cat: null, trashed: false, done: false }, mk());
        it.pos = i; c.items.push(it);
      }
      return c;
    });
    H.render();
  }, cards);
  await p.waitForTimeout(300);
}

const centerOf = (p, sel) => p.evaluate((sel) => {
  const r = document.querySelector(sel).getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}, sel);

// Slipp pekeren og les AV SAMME SYNKRONE TASK hvor drop-animasjonen starter:
// dropIntoPlaceholder setter start-transformen før nettleseren maler igjen.
// `from` = objektets faktiske (u-roterte) boks der det stod malt under draget,
// `rest` = hvileboksen etter slippet. Start-transformens translate skal føre
// hvileboksen NØYAKTIG tilbake til `from` — da starter animasjonen der objektet
// faktisk var, uansett om klemmen holdt det innenfor viewporten.
/*
  Slippet må måles i SAMME øyeblikk som det skjer: drop-animasjonen setter
  transformen i pointerup-håndtereren, og den er ryddet bort igjen når
  animasjonen er ferdig. Med ekte input kan ikke testen måle inni hendelsen, så
  den armerer en lytter først. Den registreres etter appens egen, og kjører
  derfor etter den — nøyaktig der den gamle syntetiske dispatchen målte.
*/
const armDrop = (p, sel) => p.evaluate((sel) => {
  const box = (el) => {
    const t = el.style.transform, tr = el.style.transition;
    el.style.transition = 'none'; el.style.transform = 'none';
    const r = el.getBoundingClientRect();
    el.style.transform = t; el.style.transition = tr;
    return { left: r.left, top: r.top };
  };
  const el = document.querySelector(sel);
  const from = box(el);
  window.__drop = { from };
  window.addEventListener('pointerup', () => {
    const transform = el.style.transform || '';
    const m = /translate\(([-\d.e+]+)px,\s*([-\d.e+]+)px\)/.exec(transform);
    window.__drop = {
      from, transform, rest: box(el),
      dx: m ? parseFloat(m[1]) : NaN,
      dy: m ? parseFloat(m[2]) : NaN,
    };
  }, { once: true });
}, sel);

const measuredDrop = (p) => p.evaluate(() => window.__drop);

/** Armér, slipp for ekte, og les av det lytteren fanget. */
async function dropAndMeasure(p, sel) {
  await armDrop(p, sel);
  await G.drop(p, undefined, true);
  return measuredDrop(p);
}

const scaleIn = (t) => { const m = /scale\(([\d.]+)\)/.exec(t); return m ? parseFloat(m[1]) : null; };

/* Malingen av det løftede objektet på dnd-kit-nivåene: dnd-kit eier geometrien,
   vi eier skala og rotasjon — og de må ligge i egenskaper dnd-kit IKKE skriver. */
const paintOf = (p, sel) => p.evaluate((s) => {
  const el = document.querySelector(s);
  if (!el) return null;
  const cs = getComputedStyle(el);
  return { scale: cs.scale, rotate: el.style.rotate, position: cs.position };
}, sel);

const results = [];
const log = (n, ok, x = '') => { results.push(ok); console.log((ok ? 'PASS' : 'FAIL') + ' — ' + n + (x ? '  [' + x + ']' : '')); };

(async () => {
  const b = await chromium.launch();

  /* ===== 5) Slipp ved/utenfor viewportkanten (klemmen aktiv) ===== */
  for (const M of [{ n: 'mobil', vw: 420, vh: 820, mob: true }, { n: 'desktop', vw: 1200, vh: 900, mob: false }]) {
    const p = await b.newPage({ viewport: { width: M.vw, height: M.vh }, hasTouch: true, isMobile: M.mob });
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await register(p); await seed(p, [['A', 4], ['B', 4], ['C', 4]]);

    const farX = M.vw + 260;

    /* LISTEPUNKT — den gamle motoren: klemmen er `clampToViewport`, og
       drop-transformen er vår egen.

       Grepet tas ved radens VENSTRE kant og pekeren føres til kortets HØYRE
       kant. Den uklemte boksen stikker da langt ut av viewporten (klemmen er
       aktiv), mens PEKEREN fortsatt står inne i kortet — og det er pekerens x
       `dragOverCard` leser. Uten det hadde raden falt ut av lista og draget
       vært i ekstraheringsmodus, som ikke har noen drop-tween å måle. */
    const grip = await p.evaluate(() => {
      // Teksten, ikke hele raden: avmerkingsboksen til venstre er unntatt fra
      // dra-sonen, og et grep der løfter ingenting.
      const t = document.querySelector('.item[data-id="it-B-1"] .item-text');
      const el = t.closest('.item');
      const r = t.getBoundingClientRect();
      const cr = el.closest('.card').getBoundingClientRect();
      return { x: r.left + 10, y: r.top + r.height / 2, edgeX: cr.right - 3 };
    });
    await G.lift(p, { x: grip.x, y: grip.y }, true);
    await G.travel(p, { x: grip.edgeX, y: grip.y }, true, { steps: 6, settle: 140 });
    const clamped = await p.evaluate(() => {
      const r = document.querySelector('.item.dragging').getBoundingClientRect();
      return { right: Math.round(r.right), vw: window.innerWidth, extract: !!document.querySelector('.new-list-placeholder') };
    });
    log('5 ' + M.n + ': listepunktet er klemt innenfor viewporten før slippet',
      clamped.right <= clamped.vw + 2 && !clamped.extract, JSON.stringify(clamped));

    const res = await dropAndMeasure(p, '.item.dragging');
    const ex = Math.abs(res.rest.left + res.dx - res.from.left);
    const ey = Math.abs(res.rest.top + res.dy - res.from.top);
    log('5 ' + M.n + ': drop-animasjonen starter der listepunktet FAKTISK stod (ingen hopp)',
      ex < 2 && ey < 2, 'avvik x=' + ex.toFixed(1) + ' y=' + ey.toFixed(1) + ' transform=' + res.transform);
    await p.waitForTimeout(700);

    /* LISTE — dnd-kit: klemmen er Smetts `SafeViewport`, drop-animasjonen
       bibliotekets. Samme påstand, målt der den nå gjelder. Kortet kan dras helt
       ut av board-et uten å skifte modus (det finnes ingen ekstrahering på
       kortnivå), så her holder det å føre pekeren langt utenfor kanten.
       `travel` går i to omganger med en pause imellom: klemmen leser den FAKTISK
       MALTE boksen, og rotasjonen settes av oss etter at dnd-kit har regnet ut
       flyttingen — ett enkelt hopp ville derfor klemt mot forrige frames boks. */
    const ch = await centerOf(p, '.card[data-id="card-B"] .card-head');
    await G.lift(p, { x: ch.x, y: ch.y }, true);
    await G.travel(p, { x: farX, y: ch.y }, true);
    const cClamped = await p.evaluate(() => {
      const r = document.querySelector('#board [data-dnd-dragging]').getBoundingClientRect();
      return { right: Math.round(r.right), vw: window.innerWidth };
    });
    log('5 ' + M.n + ': lista er klemt innenfor viewporten før slippet',
      cClamped.right <= cClamped.vw + 2, JSON.stringify(cClamped));
    await G.drop(p, undefined, true);
    // Vent på TILSTANDEN: dnd-kit bærer `[data-dnd-dragging]` gjennom hele
    // drop-animasjonen, så et fast tall ville målt midt i den.
    await p.waitForFunction(() => !document.querySelector('[data-dnd-dragging]'), null, { timeout: 4000 });
    log('5 ' + M.n + ': slippet lot ingen dra-maling bli igjen på lista',
      (await p.evaluate(() => {
        const el = document.querySelector('.card[data-id="card-B"]');
        return !!el && !el.style.rotate && getComputedStyle(el).position === 'static';
      })) === true);

    log('5 ' + M.n + ': ingen JS-feil', errs.length === 0, errs.join(' | '));
    await p.close();
  }

  /* ===== 6) Startskala per objekttype ===== */
  {
    const p = await b.newPage({ viewport: { width: 1200, height: 900 }, hasTouch: true });
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await register(p); await seed(p, [['A', 6], ['B', 6]]);

    // LISTE → 1.02, malt av dnd-kit (kortnivået kjører på det nå), så skalaen
    // og rotasjonen måles på det som faktisk står malt under draget.
    const ch = await centerOf(p, '.card[data-id="card-A"] .card-head');
    await G.lift(p, { x: ch.x, y: ch.y }, true);
    await G.touchMove(p, ch.x - 40, ch.y + 30); await p.waitForTimeout(120);
    const cPaint = await paintOf(p, '#board [data-dnd-dragging]');
    log('6 liste: løftes med skala 1.02', !!cPaint && cPaint.scale === '1.02', JSON.stringify(cPaint));
    log('6 liste: rotasjonen er en EGEN `rotate`-egenskap, ikke en `transform`',
      !!cPaint && /^-?[\d.]+deg$/.test(cPaint.rotate), JSON.stringify(cPaint));
    log('6 liste: løftes i top layer (dnd-kits `position: fixed`)',
      !!cPaint && cPaint.position === 'fixed', JSON.stringify(cPaint));
    await G.drop(p, undefined, true);
    await p.waitForFunction(() => !document.querySelector('[data-dnd-dragging]'), null, { timeout: 4000 });

    // LISTEPUNKT → 1.03
    const it = await centerOf(p, '.item[data-id="it-A-2"]');
    await G.lift(p, { x: it.x, y: it.y }, true);
    await G.touchMove(p, it.x, it.y + 40); await p.waitForTimeout(120);
    const rItem = await dropAndMeasure(p, '.item.dragging');
    log('6 listepunkt: startskala 1.03', scaleIn(rItem.transform) === 1.03, 'transform=' + rItem.transform);
    await p.waitForTimeout(600);

    // MAPPE (rad i et område-kort) → samme skala som et listepunkt (1.03)
    for (let i = 0; i < 2; i++) {
      await p.evaluate(() => { window.__huskis.addGroup(); }); await p.waitForTimeout(200);
    }
    await p.evaluate(() => { window.__huskis.openNavModal(); }); await p.waitForTimeout(400);
    const uSel = '#nav-board .card[data-id="' + await p.evaluate(() => window.__huskis.state.activeUniverse) + '"]';
    const gIds = await p.evaluate((sel) => [...document.querySelectorAll(sel + ' .items-container > .item')].map((g) => g.dataset.id), uSel);
    const g0 = await centerOf(p, uSel + ' .item[data-id="' + gIds[0] + '"]');
    await G.lift(p, { x: g0.x, y: g0.y }, true);
    // Til venstre, så dra-rotasjonen (og dermed rotate/scale-suffikset) ikke blir 0.
    await G.touchMove(p, g0.x - 90, g0.y + 30); await p.waitForTimeout(120);
    const gPaint = await paintOf(p, '#nav-board [data-dnd-dragging]');
    log('6 mappe: løftes med skala 1.03',
      !!gPaint && gPaint.scale === '1.03', JSON.stringify(gPaint));
    log('6 mappe: rotasjonen er en EGEN `rotate`-egenskap, ikke en `transform`',
      !!gPaint && /^-?[\d.]+deg$/.test(gPaint.rotate), JSON.stringify(gPaint));
    await G.drop(p, undefined, true);
    await p.waitForTimeout(600);
    log('6 mappe: dra-malingen er ryddet etter slippet',
      (await p.evaluate(() => {
        const el = document.querySelector('#nav-board .items-container > .item');
        return !!el && !el.style.rotate && !el.hasAttribute('data-dnd-dragging');
      })) === true);

    // OMRÅDE (kort) → samme skala som en liste (1.02)
    for (let i = 0; i < 2; i++) {
      await p.evaluate(() => { window.__huskis.addUniverse(); }); await p.waitForTimeout(200);
      await p.keyboard.press('Escape'); await p.waitForTimeout(180);
    }
    await p.evaluate(() => { window.__huskis.openNavModal(); }); await p.waitForTimeout(400);
    await p.evaluate(() => { document.querySelector('#nav-modal .menu-body').scrollTop = 0; });
    await p.waitForTimeout(150);
    const uIds = await p.evaluate(() => [...document.querySelectorAll('#nav-board .card')].map((u) => u.dataset.id));
    const u0 = await centerOf(p, '#nav-board .card[data-id="' + uIds[0] + '"] .card-head');
    await G.lift(p, { x: u0.x, y: u0.y }, true);
    await G.touchMove(p, u0.x - 90, u0.y + 30); await p.waitForTimeout(120);
    const uPaint = await paintOf(p, '#nav-board [data-dnd-dragging]');
    log('6 område: løftes med skala 1.02',
      !!uPaint && uPaint.scale === '1.02', JSON.stringify(uPaint));
    log('6 område: løftes i top layer (dnd-kits `position: fixed`)',
      !!uPaint && uPaint.position === 'fixed', JSON.stringify(uPaint));
    await G.drop(p, undefined, true);
    await p.waitForTimeout(600);

    log('6 ingen JS-feil', errs.length === 0, errs.join(' | '));
    await p.close();
  }

  await b.close();
  const failed = results.filter((x) => !x).length;
  console.log('\n==== ' + (results.length - failed) + '/' + results.length + ' PASS ====');
  process.exit(failed ? 1 : 0);
})();
