/*
  Regresjonstest: BOARD-VAKTEN UNDER ET LISTE-DRAG.

  Alle lister kollapses idet én dras, og kollapsen må skje FØR dnd-kit måler det
  løftede kortet (`beforedragstart`). Men den flytter også kortet man nettopp tok
  tak i, og dnd-kit maler kortet fra der elementet FAKTISK LÅ da det ble målt —
  ikke fra grepet, slik den gamle motoren gjorde. Board-vakten
  (`boardCollapseCardsForDrag` → min-height + padding-top) gjør derfor to jobber:

    1. GREPET HOLDER. `padding-top` legger tilbake nøyaktig det kortet flyttet
       seg av kollapsen, så det blir liggende under fingeren. Dette gjelder ALLE
       inputtyper og ALLE layouter — det er den påstanden denne fila først og
       fremst vokter.
    2. BOARD-BUNNEN SYNKER IKKE. `min-height` holder dokumentets maks-scroll
       oppe, så Android Chrome ikke klemmer scrollen og avbryter touch-en.

  Før dnd-kit fantes vakten KUN for punkt 2, og derfor kun på touch/pen i
  énkolonne-layout. Punkt 1 gjelder overalt, så skillet er borte: vakten er aktiv
  i begge layouter og for begge inputtyper. Grensen mellom én og flere kolonner
  (560/561 px) kjøres fortsatt — nå for å vise at grepet holder på begge sider av
  den. Se `docs/drag-and-drop.md`.

  Gestene er EKTE input (`tests/dnd-gestures.js`), og liste-draget kjøres av
  dnd-kit: det løftede kortet merkes `[data-dnd-dragging]`, og plassen holdes av
  en KLONE (`[data-dnd-placeholder]`) som bærer de samme klassene.

  Kjør:
    python3 -m http.server 8000                     # fra repo-roten, i egen terminal
    NODE_PATH=$(npm root -g) node tests/dnd-layout-modes.test.js
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
    const mkI = (t, h, i) => Object.assign({ id: 'it-' + h + '-' + i, text: t, home: h, cat: null, trashed: false, done: false }, mk());
    g.cards = cards.map(([title, n], pos) => {
      const id = 'card-' + title;
      const c = Object.assign({ id, group: g.id, title, trashed: false, k: true, p: true, labTs: 0, labOrg: 't', items: [] }, mk());
      c.pos = pos;
      for (let i = 0; i < n; i++) { const it = mkI(title + ' ' + i, id, i); it.pos = i; c.items.push(it); }
      return c;
    });
    H.render();
  }, cards);
  await p.waitForTimeout(300);
}

const guardStyles = (p) => p.evaluate(() => {
  const bd = document.querySelector('.board');
  return { minH: bd.style.minHeight || '', pad: bd.style.paddingTop || '' };
});
// `single` = CSS-flagget som slår på normal-flow-vakten; `colCount` = antall
// FAKTISKE kolonner. Kolonnene er egne containere (`.board-col`, fordelt av
// `relayoutBoard`), ikke CSS multi-column — se docs/board-layout.md.
const colMode = (p) => p.evaluate(() => ({
  single: getComputedStyle(document.querySelector('.board')).getPropertyValue('--mobile-dnd-flow-guard').trim() === '1',
  colCount: String(document.querySelectorAll('.board > .board-col').length),
}));
const headRectOf = (p, id) => p.evaluate((id) => {
  const r = document.querySelector('.card[data-id="' + id + '"] .card-head').getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}, id);
// Kortene som faktisk er rader — dnd-kits klone bærer de samme klassene, men er
// en kopi og skal aldri telles med.
const cardIds = (p) => p.evaluate(() => [...document.querySelectorAll('#board .card')]
  .filter((c) => !c.hasAttribute('data-dnd-placeholder')).map((c) => c.dataset.id));
const liftedCards = (p) => p.evaluate(() => document.querySelectorAll('#board .card[data-dnd-dragging]').length);

/* Avstanden fra pekeren til kortets øvre kant — FØR løftet og UNDER draget.
   Er de like, holder grepet gjennom kollapsen; ellers har kortet løsnet fra
   fingeren med akkurat det layouten flyttet seg.
   Rotasjonen nøytraliseres i målingen: `getBoundingClientRect` på et rotert
   element gir den akse-justerte omslutningsboksen, som er høyere enn kortet. */
async function grabOffset(p, id, touch) {
  // Korthodet må være innenfor viewporten for at et løft skal treffe det.
  // `nearest` scroller kortest mulig, så en test som med vilje står i bunnen
  // (mobil-vakten) blir stående der.
  await p.evaluate((i) => document.querySelector('.card[data-id="' + i + '"] .card-head')
    .scrollIntoView({ block: 'nearest' }), id);
  await p.waitForTimeout(150);
  const h = await headRectOf(p, id);
  const before = await p.evaluate((i) =>
    document.querySelector('.card[data-id="' + i + '"]').getBoundingClientRect().top, id);
  const lifted = await G.lift(p, h, touch);
  /* Én bevegelse til etter løftet, INN mot midten av viewporten.
     To grunner: et musedrag AKTIVERES av terskelbevegelsen, og den flyttingen er
     ikke malt ennå i det draget starter; og klemmen (`SafeViewport`) pinner
     kortet mot kanten det ligger inntil, så en bevegelse UT mot den kanten er
     med rette uten virkning. Retningen velges derfor etter hvilken halvdel
     grepet ligger i. */
  const vh = await p.evaluate(() => window.innerHeight);
  const at = { x: lifted.x, y: lifted.y + (h.y > vh / 2 ? -40 : 40) };
  if (touch) await G.touchMove(p, at.x, at.y);
  else await p.mouse.move(at.x, at.y, { steps: 3 });
  await p.waitForTimeout(140);
  const after = await p.evaluate((i) => {
    const el = document.querySelector('.card[data-id="' + i + '"]');
    const rot = el.style.rotate; el.style.rotate = 'none';
    const t = el.getBoundingClientRect().top;
    el.style.rotate = rot;
    return t;
  }, id);
  return { before: h.y - before, after: at.y - after, at };
}

const results = [];
const log = (n, ok, x = '') => { results.push(ok); console.log((ok ? 'PASS' : 'FAIL') + ' — ' + n + (x ? '  [' + x + ']' : '')); };

(async () => {
  const b = await chromium.launch();

  /* ---------- 1) Flerkolonne + EKTE MUS (page.mouse) ---------- */
  {
    const p = await b.newPage({ viewport: { width: 1200, height: 800 } });
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await register(p);
    await seed(p, [['A', 3], ['B', 3], ['C', 3], ['D', 3], ['E', 3], ['F', 3]]);
    const mode = await colMode(p);
    log('1 desktop/mus: board i FLERKOLONNE', !mode.single && mode.colCount !== '1', JSON.stringify(mode));

    // Grepet holder gjennom kollapsen — den lista som har flest åpne lister over
    // seg er den som flytter seg mest, og altså den som avslører en manglende
    // kompensasjon.
    const go = await grabOffset(p, 'card-C', false);
    log('1 desktop/mus: grepet holder gjennom kollapsen',
      Math.abs(go.after - go.before) <= 2, 'før=' + go.before.toFixed(1) + ' under=' + go.after.toFixed(1));
    // Escape AVBRYTER draget (Smett-invariant), så denne målingen ikke etterlater
    // seg et slipp — og dermed heller ingen scroll-til-slupt som ville flyttet
    // korthodet under neste gest.
    await p.keyboard.press('Escape');
    await p.mouse.up();
    await p.waitForFunction(() => !document.querySelector('[data-dnd-dragging]'), null, { timeout: 5000 });
    await p.evaluate(() => window.scrollTo(0, 0));
    await p.waitForTimeout(400);

    const before = await cardIds(p);
    const h = await headRectOf(p, before[0]);
    // Ekte muse-drag: down på korthodet, beveg > HOLD_MOVE for å starte, så flytt.
    await p.mouse.move(h.x, h.y);
    await p.mouse.down();
    await p.mouse.move(h.x + 30, h.y + 30, { steps: 4 });
    await p.mouse.move(h.x + 300, h.y + 260, { steps: 8 }); // mot en annen kolonne
    await p.waitForTimeout(80);
    const during = await guardStyles(p);
    const dragging = await liftedCards(p);
    const collapsed = await p.evaluate(() => document.querySelectorAll('#board .card.collapsed').length);
    log('1 desktop/mus: lister kollapset under drag', collapsed >= 1, 'collapsed=' + collapsed);
    log('1 desktop/mus: board-vakt AKTIV (min-height satt)', during.minH !== '', JSON.stringify(during));
    log('1 desktop/mus: draget aktivt', dragging === 1, 'dragging=' + dragging);
    await p.mouse.up();
    await p.waitForFunction(() => !document.querySelector('[data-dnd-dragging]'), null, { timeout: 5000 });
    await p.waitForTimeout(1000); // smooth-scroll + omfordeling ferdig

    const after = await p.evaluate(() => {
      const cards = [...document.querySelectorAll('#board .card')].filter((c) => !c.hasAttribute('data-dnd-placeholder'));
      const moved = document.querySelector('.card[data-id="card-A"]');
      const r = moved.getBoundingClientRect();
      const topbar = document.querySelector('.topbar') || document.querySelector('header');
      return {
        order: cards.map((c) => c.dataset.id),
        dragging: document.querySelectorAll('.dragging, [data-dnd-dragging]').length,
        ph: document.querySelectorAll('.card-placeholder, [data-dnd-placeholder]').length,
        movedTop: Math.round(r.top), vh: window.innerHeight,
        topbarBottom: Math.round(topbar ? topbar.getBoundingClientRect().bottom : 0),
        trans: moved.style.transition || '', transform: moved.style.transform || '',
        guard: (document.querySelector('.board').style.minHeight || '') + '/' + (document.querySelector('.board').style.paddingTop || ''),
      };
    });
    log('1 desktop/mus: rekkefølge endret (omorganisert mellom kolonner)', JSON.stringify(after.order) !== JSON.stringify(before), before + ' → ' + after.order);
    log('1 desktop/mus: opprydding (ingen dragging/placeholder, inline-stiler ryddet)',
      after.dragging === 0 && after.ph === 0 && after.trans === '' && after.transform === '', JSON.stringify(after));
    log('1 desktop/mus: scrollet til slupt liste (under toppmeny, i viewport)',
      after.movedTop >= after.topbarBottom - 6 && after.movedTop < after.vh - 20, 'top=' + after.movedTop + ' tbBottom=' + after.topbarBottom);
    log('1 desktop/mus: board-vakt ryddet', after.guard === '/', 'guard=' + after.guard);
    log('1 desktop/mus: ingen JS-feil', errs.length === 0, errs.join(' | '));
    await p.close();
  }

  /* ---------- 2) Flerkolonne + BRED TOUCH («Side for datamaskin») ---------- */
  {
    const p = await b.newPage({ viewport: { width: 1200, height: 800 }, hasTouch: true });
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await register(p);
    await seed(p, [['A', 6], ['B', 6], ['C', 6], ['D', 6], ['E', 6], ['F', 6]]);
    const mode = await colMode(p);
    log('2 bred touch: board i FLERKOLONNE', !mode.single && mode.colCount !== '1', JSON.stringify(mode));

    const before = await cardIds(p);
    const go2 = await grabOffset(p, before[2], true);
    log('2 bred touch: grepet holder gjennom kollapsen',
      Math.abs(go2.after - go2.before) <= 2, 'før=' + go2.before.toFixed(1) + ' under=' + go2.after.toFixed(1));
    const h = go2.at;
    await G.touchMove(p, h.x + 6, h.y + 6); await p.waitForTimeout(50);
    const during = await guardStyles(p);
    const collapsed = await p.evaluate(() => document.querySelectorAll('#board .card.collapsed').length);
    const dragging = await liftedCards(p);
    log('2 bred touch: lister kollapser MOMENTANT', collapsed >= 1, 'collapsed=' + collapsed);
    log('2 bred touch: board-vakt AKTIV også i flerkolonne på touch', during.minH !== '', 'minH=' + JSON.stringify(during.minH));
    log('2 bred touch: draget aktivt', dragging === 1, 'dragging=' + dragging);
    // Overskriftene skal følge kolonneflyten (ikke flokke seg): kortene som ikke
    // er løftet er fordelt i flere kolonner → minst to distinkte kolonne-x.
    const distinctCols = await p.evaluate(() => {
      const xs = new Set([...document.querySelectorAll('#board .card:not([data-dnd-dragging])')]
        .map((c) => Math.round(c.getBoundingClientRect().left)));
      return xs.size;
    });
    log('2 bred touch: overskriftene følger flerkolonneflyt (≥2 kolonner)', distinctCols >= 2, 'kolonner=' + distinctCols);

    // Reorder + drop
    await G.touchMove(p, h.x + 200, h.y + 220); await p.waitForTimeout(80);
    await G.drop(p, undefined, true);
    await p.waitForFunction(() => !document.querySelector('[data-dnd-dragging]'), null, { timeout: 5000 });
    await p.waitForTimeout(900);
    const after = await p.evaluate(() => ({
      dragging: document.querySelectorAll('.dragging, [data-dnd-dragging]').length,
      ph: document.querySelectorAll('.card-placeholder, [data-dnd-placeholder]').length,
      guard: (document.querySelector('.board').style.minHeight || '') + '/' + (document.querySelector('.board').style.paddingTop || ''),
    }));
    log('2 bred touch: drop rydder opp + ingen vakt-rester', after.dragging === 0 && after.ph === 0 && after.guard === '/', JSON.stringify(after));

    // pointercancel-rollback i flerkolonne-touch
    const before2 = await cardIds(p);
    // Slippet over scrollet siden, så korthodet kan ligge utenfor viewporten.
    // Med syntetiske hendelser gjorde det ingenting: pointerdown traff
    // document.body, draget startet aldri, og «rekkefølgen er uendret» var sann
    // fordi ingenting hadde skjedd. Ekte input må treffe noe for å teste noe.
    await p.evaluate((id) => document.querySelector('.card[data-id="' + id + '"]')
      .scrollIntoView({ block: 'center' }), before2[0]);
    await p.waitForTimeout(250);
    const h2 = await headRectOf(p, before2[0]);
    await G.lift(p, { x: h2.x, y: h2.y }, true);
    await G.touchMove(p, h2.x + 8, h2.y + 40); await p.waitForTimeout(50);
    await G.touchMove(p, h2.x + 8, h2.y + 160); await p.waitForTimeout(50);
    await G.touchCancel(p);
    await p.waitForFunction(() => !document.querySelector('[data-dnd-dragging]'), null, { timeout: 5000 });
    await p.waitForTimeout(250);
    const cancel = {
      order: await cardIds(p),
      ...(await p.evaluate(() => ({
        dragging: document.querySelectorAll('.dragging, [data-dnd-dragging]').length,
        ph: document.querySelectorAll('.card-placeholder, [data-dnd-placeholder]').length,
      }))),
    };
    log('2 bred touch: pointercancel ruller tilbake (rekkefølge uendret, opprydding)',
      JSON.stringify(cancel.order) === JSON.stringify(before2) && cancel.dragging === 0 && cancel.ph === 0, JSON.stringify(cancel));
    log('2 bred touch: ingen JS-feil', errs.length === 0, errs.join(' | '));
    await p.close();
  }

  /* ---------- 3) Énkolonne + TOUCH (vanlig mobil): vakten AKTIV ---------- */
  {
    const p = await b.newPage({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true });
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await register(p);
    await seed(p, [['Hoy', 20], ['Kort', 2]]);
    const mode = await colMode(p);
    log('3 mobil: board i ÉNKOLONNE', mode.single && mode.colCount === '1', JSON.stringify(mode));
    await p.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight)); await p.waitForTimeout(120);
    const go3 = await grabOffset(p, 'card-Kort', true);
    log('3 mobil: grepet holder gjennom kollapsen',
      Math.abs(go3.after - go3.before) <= 2, 'før=' + go3.before.toFixed(1) + ' under=' + go3.after.toFixed(1));
    await G.touchMove(p, go3.at.x + 3, go3.at.y - 3); await p.waitForTimeout(60);
    const during = await guardStyles(p);
    log('3 mobil: board-vakt AKTIV (minHeight + padding-top satt)', during.minH !== '' && during.pad !== '', JSON.stringify(during));
    await G.drop(p, undefined, true);
    await p.waitForFunction(() => !document.querySelector('[data-dnd-dragging]'), null, { timeout: 5000 });
    await p.waitForTimeout(900);
    const after = await guardStyles(p);
    log('3 mobil: vakt ryddet etter slipp', after.minH === '' && after.pad === '', JSON.stringify(after));
    log('3 mobil: ingen JS-feil', errs.length === 0, errs.join(' | '));
    await p.close();
  }

  /* ---------- 4) Layoutgrensen: 560 (énkolonne) vs 561 (flerkolonne), touch ----------
     Grensen er der board-et bytter mellom én og flere kolonner, og den var
     tidligere også grensen for om vakten fantes. Nå gjelder vakten begge sider —
     og det som må vises er at GREPET holder på begge sider, for det er der de to
     layoutene faktisk regner ulikt (i flerkolonne teller bare listene i kortets
     EGEN kolonne). */
  for (const [w, wantSingle] of [[560, true], [561, false]]) {
    const p = await b.newPage({ viewport: { width: w, height: 800 }, hasTouch: true });
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await register(p);
    await seed(p, [['Hoy', 12], ['Midt', 8], ['Kort', 2]]);
    const mode = await colMode(p);
    log('4 grense ' + w + 'px: board i ' + (wantSingle ? 'ÉNKOLONNE' : 'FLERKOLONNE'),
      mode.single === wantSingle, JSON.stringify(mode));
    // Dra den NEDERSTE lista: den har flest åpne lister over seg, og flytter seg
    // altså mest av kollapsen.
    const go = await grabOffset(p, 'card-Kort', true);
    log('4 grense ' + w + 'px (touch): grepet holder gjennom kollapsen',
      Math.abs(go.after - go.before) <= 2, 'før=' + go.before.toFixed(1) + ' under=' + go.after.toFixed(1));
    const during = await guardStyles(p);
    log('4 grense ' + w + 'px (touch): board-vakt aktiv', during.minH !== '', JSON.stringify(during));
    await G.touchCancel(p);
    await p.waitForFunction(() => !document.querySelector('[data-dnd-dragging]'), null, { timeout: 5000 });
    await p.close();
    if (errs.length) log('4 grense ' + w + ': ingen JS-feil', false, errs.join(' | '));
  }

  /* ---------- 5) prefers-reduced-motion: momentan scroll, ingen drop-tween ---------- */
  {
    const p = await b.newPage({ viewport: { width: 1200, height: 800 } });
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await p.emulateMedia({ reducedMotion: 'reduce' });
    await register(p);
    await seed(p, [['A', 3], ['B', 3], ['C', 3], ['D', 3], ['E', 3], ['F', 3]]);
    const before = await cardIds(p);
    const h = await headRectOf(p, before[0]);
    await p.mouse.move(h.x, h.y);
    await p.mouse.down();
    await p.mouse.move(h.x + 30, h.y + 30, { steps: 3 });
    await p.mouse.move(h.x + 300, h.y + 260, { steps: 6 });
    await p.mouse.up();
    // Momentant: ingen tween og ingen smooth-scroll å vente på. Vi venter likevel
    // på TILSTANDEN (klonen er borte) — det er den som frigjør etterarbeidet.
    await p.waitForFunction(() => !document.querySelector('[data-dnd-placeholder]'), null, { timeout: 3000 });
    await p.waitForTimeout(120);
    const res = await p.evaluate(() => {
      const moved = document.querySelector('.card[data-id="card-A"]');
      const r = moved.getBoundingClientRect();
      const topbar = document.querySelector('.topbar') || document.querySelector('header');
      return {
        transform: moved.style.transform || '', trans: moved.style.transition || '',
        top: Math.round(r.top), vh: window.innerHeight,
        topbarBottom: Math.round(topbar ? topbar.getBoundingClientRect().bottom : 0),
        dragging: document.querySelectorAll('.dragging, [data-dnd-dragging]').length,
        ph: document.querySelectorAll('.card-placeholder, [data-dnd-placeholder]').length,
      };
    });
    log('5 redusert bevegelse: ingen drop-tween (transform/transition tomme straks)', res.transform === '' && res.trans === '', JSON.stringify(res));
    log('5 redusert bevegelse: momentan scroll → lista under toppmenyen i viewport', res.top >= res.topbarBottom - 6 && res.top < res.vh - 20, 'top=' + res.top);
    log('5 redusert bevegelse: opprydding', res.dragging === 0 && res.ph === 0);
    log('5 redusert bevegelse: ingen JS-feil', errs.length === 0, errs.join(' | '));
    await p.close();
  }

  await b.close();
  const failed = results.filter((x) => !x).length;
  console.log('\n==== ' + (results.length - failed) + '/' + results.length + ' PASS ====');
  process.exit(failed ? 1 : 0);
})();
