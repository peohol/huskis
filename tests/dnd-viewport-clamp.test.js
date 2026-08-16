/*
  Regresjonstest: det løftede DnD-objektet holdes ALLTID innenfor viewporten, og
  toppmenyens elementer (kontoknappen) rører seg ikke av et drag.

  Feilen som testes: drar man et listepunkt/en kategori UT i board-lufta, bytter
  placeholderen til «ny liste»-modus og board-ets kort FLIP-animeres. Kilde-kortet
  er en FORFAR til det løftede objektet, og et transformert element blir containing
  block for absolutt posisjonerte etterkommere — dokument-koordinatene fra dragPos*
  ble dermed plutselig tolket relativt til kortet, så objektet hoppet langt ut til
  høyre, utvidet sidens scroll-bredde og (på iOS WebKit) skjøv den høyre-forankrede
  `position: fixed`-kontoknappen ut av viewporten.

  SAMME FALLGRUVE, ANDRE KILDE (siste blokk): en DRAKT-regel som posisjonerer en
  forfar. Et forsøk med `position: relative` på `.card` (for å tegne en
  aksentstripe med `::before`) traff to ganger samtidig — `.card` ble containing
  block for listepunkter og kategorier, og selektoren var dessuten sterkere enn
  `.card.dragging`, så det løftede KORTET ble `relative` i stedet for `absolute`.
  Alle fire dokument-koordinat-objektene la seg da ~114 px nedenfor fingeren, og
  områdekortet i navigasjonsmodalen langt utenfor viewporten. Derfor kjøres
  forankringen i MØRK drakt også: draktene deler geometri, og en regel som bare
  gjelder den ene er nettopp den som ellers slipper gjennom.

  Kjør:
    python3 -m http.server 8000                     # fra repo-roten, i egen terminal
    NODE_PATH=$(npm root -g) node tests/dnd-viewport-clamp.test.js
*/
const { chromium } = require('playwright');

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

// Seed: `cards` = [[tittel, antall listepunkter, antall kategorimedlemmer], …].
// Er tredje felt satt, får kortet i tillegg en kategori med så mange medlemmer.
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
    const mkI = (id, t, h) => Object.assign({ id, text: t, home: h, cat: null, trashed: false, done: false }, mk());
    g.cards = cards.map(([title, n, catN], pos) => {
      const id = 'card-' + title;
      const c = Object.assign({ id, group: g.id, title, trashed: false, k: true, p: true, labTs: 0, labOrg: 't', items: [] }, mk());
      c.pos = pos;
      for (let i = 0; i < n; i++) { const it = mkI('it-' + id + '-' + i, title + ' ' + i, id); it.pos = i; c.items.push(it); }
      if (catN) {
        const cat = mkI('cat-' + id, 'Kategori ' + title, id);
        cat.isCat = true; cat.lockTimes = false; cat.collapsed = false; cat.pos = n;
        c.items.push(cat);
        for (let i = 0; i < catN; i++) {
          const m = mkI('cm-' + id + '-' + i, 'Medlem ' + i, id);
          m.cat = cat.id; m.pos = i; c.items.push(m);
        }
      }
      return c;
    });
    H.render();
  }, cards);
  await p.waitForTimeout(300);
}

// Syntetisk peker (samme mønster som de øvrige DnD-testene) — pointerType er
// parameter så både mus (start på bevegelse) og touch (200 ms hold) kan kjøres.
async function ptr(p, type, x, y, kind) {
  await p.evaluate(({ type, x, y, kind }) => {
    const ev = new PointerEvent(type, { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, pointerId: 7, pointerType: kind, button: 0, isPrimary: true });
    (type === 'pointerdown' ? (document.elementFromPoint(x, y) || document.body) : window).dispatchEvent(ev);
  }, { type, x, y, kind });
}

const zoneOf = (p, sel) => p.evaluate((sel) => {
  const r = document.querySelector(sel).getBoundingClientRect();
  return { x: r.left + Math.min(60, r.width / 2), y: r.top + r.height / 2 };
}, sel);

// Måler alt vi bryr oss om i én runde: det løftede objektets rendrede boks,
// sidens scroll-bredde, og de faste toppelementenes plassering.
const probe = (p) => p.evaluate(() => {
  const d = document.querySelector('.item.dragging, .category.dragging, .card.dragging');
  const a = document.getElementById('account-btn').getBoundingClientRect();
  const t = document.getElementById('topbar').getBoundingClientRect();
  const r = d ? d.getBoundingClientRect() : null;
  return {
    dragging: !!d,
    box: r ? { l: Math.round(r.left), r: Math.round(r.right), t: Math.round(r.top), b: Math.round(r.bottom) } : null,
    vw: window.innerWidth, vh: window.innerHeight,
    scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth,
    acct: { l: Math.round(a.left), r: Math.round(a.right), t: Math.round(a.top) },
    topbar: { l: Math.round(t.left), r: Math.round(t.right), t: Math.round(t.top) },
    phMode: document.querySelector('.new-list-placeholder') ? 'extract'
      : (document.querySelector('.item-placeholder, .card-placeholder') ? 'reorder' : 'none'),
  };
});

const results = [];
const log = (n, ok, x = '') => { results.push(ok); console.log((ok ? 'PASS' : 'FAIL') + ' — ' + n + (x ? '  [' + x + ']' : '')); };

// Ett drag: løft `sel`, før pekeren langt utenfor hver kant, og sjekk hele veien
// at objektet ligger innenfor viewporten og at headeren står stille.
async function dragOutOfBounds(p, label, sel, kind, opts) {
  opts = opts || {};
  // Forrige drag kan ha scrollet siden (auto-scroll / scroll-til-slupt-liste);
  // start hvert drag fra toppen så dra-sonen ikke ligger bak den faste toppmenyen.
  await p.evaluate(() => window.scrollTo(0, 0)); await p.waitForTimeout(120);
  const base = await probe(p);
  const z = await zoneOf(p, sel);
  await ptr(p, 'pointerdown', z.x, z.y, kind);
  if (kind === 'mouse') { await ptr(p, 'pointermove', z.x + 20, z.y + 4, kind); }
  else { await p.waitForTimeout(260); await ptr(p, 'pointermove', z.x + 4, z.y + 4, kind); }
  await p.waitForTimeout(80);

  const started = await probe(p);
  log(label + ': draget startet', started.dragging, 'phMode=' + started.phMode);

  const vw = base.vw, vh = base.vh;
  // Langt utenfor hver kant, med et par mellomsteg (auto-scroll/FLIP rekker å kjøre).
  const stops = [
    ['høyre', vw + 400, vh / 2], ['høyre-hjørne', vw + 400, vh + 300],
    ['venstre', -400, vh / 2], ['over', vw / 2, -300], ['under', vw / 2, vh + 300],
  ];
  const bad = [];
  let sawExtract = false;
  for (const [where, x, y] of stops) {
    await ptr(p, 'pointermove', x, y, kind);
    await p.waitForTimeout(140); // FLIP (150 ms) og auto-scroll får løpe
    const s = await probe(p);
    if (!s.dragging) { bad.push(where + ': draget døde'); continue; }
    if (s.phMode === 'extract') sawExtract = true;
    const b = s.box;
    if (b.l < -1 || b.r > s.vw + 1 || b.t < -1 || b.b > s.vh + 1) bad.push(where + ': boks ' + JSON.stringify(b) + ' utenfor ' + s.vw + '×' + s.vh);
    if (s.scrollW > s.clientW) bad.push(where + ': horisontal overflow ' + s.scrollW + '>' + s.clientW);
    if (s.acct.l !== base.acct.l || s.acct.r !== base.acct.r || s.acct.t !== base.acct.t) bad.push(where + ': kontoknappen flyttet seg ' + JSON.stringify(s.acct));
    if (s.topbar.l !== base.topbar.l || s.topbar.r !== base.topbar.r) bad.push(where + ': toppmenyen flyttet seg ' + JSON.stringify(s.topbar));
  }
  log(label + ': objektet holdt seg innenfor viewporten + headeren sto stille', bad.length === 0, bad.join(' | '));
  // Ekstrahering finnes kun for listepunkt/kategori — en liste dras aldri ut i «board-lufta».
  if (!opts.noExtract) log(label + ': ny-liste-placeholderen (extract) ble faktisk aktivert underveis', sawExtract);

  await ptr(p, 'pointercancel', vw / 2, vh / 2, kind);
  await p.waitForTimeout(250);
  const after = await probe(p);
  log(label + ': ryddet opp etter avbrutt drag (ingen overflow, header urørt)',
    !after.dragging && after.scrollW <= after.clientW && after.acct.r === base.acct.r, JSON.stringify(after.acct));
}

/* PEKERFORANKRINGEN: ett løft, pekeren ført til et fast punkt godt inne i
   viewporten (klemmen over skal ikke slå inn), og så det ene spørsmålet som
   avslører enhver containing-block-feil uansett årsak — LIGGER FINGEREN
   FORTSATT PÅ OBJEKTET? Blir koordinatene tolket mot feil forfar, glir boksen
   vekk fra pekeren og svaret er nei.
   `position` sjekkes i samme slengen: board-objektene skal være `absolute`
   (dokument-koordinater) og modal-objektene `fixed` — se kommentaren over
   `.card.dragging` i styles.css. En drakt-regel som overdøver den er den andre
   halvdelen av den samme feilen. */
async function anchorHolds(p, label, sel, kind, expectPos) {
  await p.evaluate(() => window.scrollTo(0, 0)); await p.waitForTimeout(120);
  const z = await zoneOf(p, sel);
  await ptr(p, 'pointerdown', z.x, z.y, kind);
  if (kind === 'mouse') { await ptr(p, 'pointermove', z.x + 20, z.y + 4, kind); }
  else { await p.waitForTimeout(260); await ptr(p, 'pointermove', z.x + 4, z.y + 4, kind); }
  await p.waitForTimeout(120);
  const t = await p.evaluate(() => ({ x: Math.round(window.innerWidth / 2), y: Math.round(window.innerHeight / 2) }));
  await ptr(p, 'pointermove', t.x, t.y, kind);
  await p.waitForTimeout(160);
  const s = await p.evaluate(({ tx, ty }) => {
    const d = document.querySelector('.item.dragging, .category.dragging, .card.dragging');
    if (!d) return { dragging: false };
    const r = d.getBoundingClientRect();
    return {
      dragging: true, position: getComputedStyle(d).position,
      dx: Math.round(tx - r.left), dy: Math.round(ty - r.top),
      w: Math.round(r.width), h: Math.round(r.height),
    };
  }, { tx: t.x, ty: t.y });
  const inside = s.dragging && s.dx >= 0 && s.dx <= s.w && s.dy >= 0 && s.dy <= s.h;
  log(label + ': pekeren ligger fortsatt på det løftede objektet', inside, JSON.stringify(s));
  log(label + ': løftes som `' + expectPos + '`', s.position === expectPos, 'fikk ' + s.position);
  await ptr(p, 'pointercancel', t.x, t.y, kind);
  await p.waitForTimeout(250);
}

(async () => {
  const b = await chromium.launch();

  /* ---------- Desktop (flerkolonne, mus) ---------- */
  {
    const p = await b.newPage({ viewport: { width: 1200, height: 800 } });
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await register(p);
    // Fire kort → flere kolonner, så kilde-kortet ligger i venstre kolonne og en
    // feilaktig containing-block-forskyvning slår ut i full bredde.
    await seed(p, [['A', 4, 3], ['B', 4], ['C', 4], ['D', 4]]);
    await dragOutOfBounds(p, 'desktop/listepunkt', '.card[data-id="card-A"] .items-container > .item .item-text', 'mouse');
    await dragOutOfBounds(p, 'desktop/kategori', '.card[data-id="card-A"] .category .cat-head', 'mouse');
    await dragOutOfBounds(p, 'desktop/liste', '.card[data-id="card-A"] .card-head', 'mouse', { noExtract: true });
    log('desktop: ingen JS-feil', errs.length === 0, errs.join(' | '));
    await p.close();
  }

  /* ---------- Mobil (énkolonne, touch) ---------- */
  {
    const p = await b.newPage({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true });
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await register(p);
    await seed(p, [['A', 4, 3], ['B', 4]]);
    await dragOutOfBounds(p, 'mobil/listepunkt', '.card[data-id="card-A"] .items-container > .item .item-text', 'touch');
    await dragOutOfBounds(p, 'mobil/kategori', '.card[data-id="card-A"] .category .cat-head', 'touch');
    log('mobil: ingen JS-feil', errs.length === 0, errs.join(' | '));
    await p.close();
  }

  /* ---------- Mørk drakt: forankringen på ALLE fem nivåene ----------
     Område og mappe bor i navigasjonsmodalen og dras `fixed`; liste, kategori
     og listepunkt bor på board-et og dras `absolute`. Begge halvdelene kjøres,
     fordi de to øverste nivåene er bygget av de samme komponentene som de to
     nederste — en drakt-regel på `.card` treffer dem alle. */
  {
    const p = await b.newPage({ viewport: { width: 1200, height: 800 } });
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await register(p);
    await p.evaluate(() => window.HUSKIS_THEME.setMode('dark'));
    await p.waitForTimeout(200);
    await seed(p, [['A', 4, 3], ['B', 4], ['C', 4], ['D', 4]]);
    const dark = await p.evaluate(() => document.documentElement.getAttribute('data-theme'));
    log('mørk drakt: attributtet står', dark === 'dark', String(dark));

    await anchorHolds(p, 'mørk/listepunkt', '.card[data-id="card-A"] .items-container > .item .item-text', 'mouse', 'absolute');
    await anchorHolds(p, 'mørk/kategori', '.card[data-id="card-A"] .category .cat-head', 'mouse', 'absolute');
    await anchorHolds(p, 'mørk/liste', '.card[data-id="card-A"] .card-head', 'mouse', 'absolute');
    // Samme runde som i lys drakt: en forskyvning som ikke slår ut på
    // forankringen ville fortsatt kunne skyve objektet ut av viewporten.
    await dragOutOfBounds(p, 'mørk/listepunkt', '.card[data-id="card-A"] .items-container > .item .item-text', 'mouse');
    await dragOutOfBounds(p, 'mørk/liste', '.card[data-id="card-A"] .card-head', 'mouse', { noExtract: true });

    await p.evaluate(() => window.__huskis.openNavModal());
    await p.waitForTimeout(350);
    await anchorHolds(p, 'mørk/område', '#nav-board .card .card-head', 'mouse', 'fixed');
    await anchorHolds(p, 'mørk/mappe', '#nav-board .card .items-container > .item', 'mouse', 'fixed');

    log('mørk drakt: ingen JS-feil', errs.length === 0, errs.join(' | '));
    await p.close();
  }

  await b.close();
  const failed = results.filter((x) => !x).length;
  console.log('\n==== ' + (results.length - failed) + '/' + results.length + ' PASS ====');
  process.exit(failed ? 1 : 0);
})();
