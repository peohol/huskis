/*
  Regresjonstest: FLYTT EN LISTE TIL EN ANNEN MAPPE VED Å DRA DEN PÅ
  📁-BREADCRUMBEN.

  Mappene ligger ikke på hovedsiden. I stedet dras lista opp på nav-knappen i
  toppmenyen: knappen markeres, det løftede kortet blir gjennomskinnelig, og
  slippet åpner «Flytt … til»-velgeren. Breadcrumben er en SONE for kortdraget
  (`data-dnd-zone="crumb"`), akkurat som liste-søppelkassen er det —
  `docs/drag-and-drop.md`.

  Dekker:
    1. Breadcrumben markeres (`.drop-target`) og det løftede kortet blir
       gjennomskinnelig (`.to-group`) — men BARE når det finnes en annen mappe å
       flytte til.
    2. Slippet ruller lista tilbake dit den kom fra FØR velgeren åpnes — også når
       draget rakk å omrokkere lista på veien opp. Avbryter man velgeren, er
       ingenting endret: verken rekkefølgen eller mappen.
    3. Et valg i velgeren flytter lista til den andre mappen (den forsvinner fra
       board-et), og de gjenværende beholder rekkefølgen sin.
    4. Finnes det ingen annen mappe, markeres ingenting, og slippet flytter
       ingenting — lista blir liggende der den lå.

  Kjøres på BÅDE desktop- og mobil-viewport: gesten er pekeravhengig, og
  toppmenyen brekker til to rader under 560 px.

  Gestene er EKTE input (`tests/dnd-gestures.js`).

  Kjør:
    python3 -m http.server 8000                     # fra repo-roten, i egen terminal
    NODE_PATH=$(npm root -g) node tests/dnd-move-list.test.js
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
  await p.waitForFunction(() => {
    const H = window.__huskis;
    return H && H.authUser && H.lastMy;
  }, null, { timeout: 10000, polling: 200 });
  // Introduksjonen og gest-tipsene legger seg over appen — ingen av delene er
  // det denne testen handler om (tests/CLAUDE.md).
  await p.evaluate(() => window.__huskis.tour.skipAll());
  await p.waitForTimeout(150);
}

/* Ett område, `groups` mapper, og `cards` lister i den FØRSTE mappen. */
async function seed(p, groups, cards) {
  await p.evaluate(() => { window.__huskis.addUniverse(); }); await p.waitForTimeout(150);
  await p.keyboard.press('Escape'); await p.waitForTimeout(150);
  await p.evaluate(({ groups, cards }) => {
    const H = window.__huskis, st = H.state;
    const u = st.universes.find((x) => x.id === st.activeUniverse);
    const mk = () => ({ ts: 0, org: 't', pos: 0, posTs: 0, posOrg: 't' });
    u.groups = groups.map((name, i) => Object.assign(
      { id: 'grp-' + name, uni: u.id, name, isCat: false, cat: null, trashed: false, cards: [] },
      mk(), { pos: i },
    ));
    st.activeGroup = u.groups[0].id;
    u.groups[0].cards = cards.map((title, pos) => Object.assign(
      { id: 'card-' + title, group: u.groups[0].id, title, trashed: false, k: true, p: true, labTs: 0, labOrg: 't', items: [] },
      mk(), { pos },
    ));
    // Ingen `save()`: kortene her er skrevet rett inn i state (som i de øvrige
    // DnD-testene), og en synk av dem ville blitt avvist på fremmednøkkelen.
    H.render();
  }, { groups, cards });
  await p.waitForTimeout(350);
}

const cardIds = (p) => p.evaluate(() => [...document.querySelectorAll('#board .card')]
  .filter((c) => !c.hasAttribute('data-dnd-placeholder')).map((c) => c.dataset.id));
const crumbPoint = (p) => p.evaluate(() => {
  const r = document.getElementById('nav-crumb').getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
});
const marks = (p) => p.evaluate(() => ({
  crumb: document.getElementById('nav-crumb').classList.contains('drop-target'),
  toGroup: !!document.querySelector('#board [data-dnd-dragging].to-group'),
}));
const pickerOpen = (p) => p.evaluate(() => !document.getElementById('place-modal').hidden);
const settled = (p) => p.waitForFunction(
  () => !document.querySelector('[data-dnd-dragging]'), null, { timeout: 5000 });

const results = [];
const log = (n, ok, x = '') => { results.push(ok); console.log((ok ? 'PASS' : 'FAIL') + ' — ' + n + (x ? '  [' + x + ']' : '')); };

async function run(name, viewport, touch) {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport, isMobile: touch, hasTouch: touch });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await register(p);

  /* ---- To mapper: breadcrumben er et ekte mål ---- */
  await seed(p, ['Jobb', 'Hjem'], ['A', 'B', 'C', 'D']);
  const before = await cardIds(p);
  log(name + ': fire lister i den første mappen', before.length === 4, before.join(','));

  /* Den SISTE lista, ført opp forbi de andre: draget rekker da å omrokkere den
     på veien til toppmenyen. Nettopp derfor er tilbakerullingen en påstand og
     ikke en selvfølge — uten den ville lista blitt liggende der den tilfeldigvis
     havnet mens man siktet. */
  const head = await G.centre(p, '#board .card[data-id="card-D"] .card-head');
  await G.lift(p, head, touch);
  // Kortene er kollapset nå — mål målene etter løftet.
  await G.travel(p, () => G.centre(p, '#board .card[data-id="card-B"] .card-head'), touch);
  const mid = await cardIds(p);
  log(name + ': draget rakk å omrokkere lista på veien opp',
    JSON.stringify(mid) !== JSON.stringify(before), mid.join(','));

  await G.travel(p, () => crumbPoint(p), touch);
  const m = await marks(p);
  log(name + ': breadcrumben markeres mens man sikter', m.crumb === true, JSON.stringify(m));
  log(name + ': det løftede kortet blir gjennomskinnelig', m.toGroup === true, JSON.stringify(m));

  await G.drop(p, undefined, touch);
  await settled(p);
  await p.waitForTimeout(250);
  log(name + ': velgeren åpnes ved slippet', (await pickerOpen(p)) === true);
  const rolledBack = await cardIds(p);
  log(name + ': lista er rullet tilbake dit den kom fra (ingen ny rekkefølge)',
    JSON.stringify(rolledBack) === JSON.stringify(before), rolledBack.join(','));

  // Avbryt velgeren: ingenting skal ha skjedd.
  await p.keyboard.press('Escape'); await p.waitForTimeout(250);
  const afterCancel = await cardIds(p);
  const stillHere = await p.evaluate(() => {
    const H = window.__huskis, st = H.state;
    const u = st.universes.find((x) => x.id === st.activeUniverse);
    return u.groups.find((g) => g.id === 'grp-Jobb').cards.map((c) => c.id);
  });
  log(name + ': avbrutt velger flytter ingenting',
    JSON.stringify(afterCancel) === JSON.stringify(before) && stillHere.length === 4,
    afterCancel.join(',') + ' | Jobb=' + stillHere.join(','));

  /* ---- Velg mappen: lista flyttes ---- */
  const head2 = await G.centre(p, '#board .card[data-id="card-D"] .card-head');
  await G.lift(p, head2, touch);
  await G.travel(p, () => crumbPoint(p), touch);
  await G.drop(p, undefined, touch);
  await settled(p);
  await p.waitForTimeout(250);
  await p.locator('#place-body .place-option').first().click();
  await p.waitForTimeout(400);
  const moved = await p.evaluate(() => {
    const H = window.__huskis, st = H.state;
    const u = st.universes.find((x) => x.id === st.activeUniverse);
    const get = (id) => u.groups.find((g) => g.id === id).cards.map((c) => c.id);
    return { jobb: get('grp-Jobb'), hjem: get('grp-Hjem') };
  });
  log(name + ': lista havnet i den andre mappen',
    moved.hjem.join(',') === 'card-D' && !moved.jobb.includes('card-D'), JSON.stringify(moved));
  log(name + ': de gjenværende listene beholdt rekkefølgen',
    (await cardIds(p)).join(',') === 'card-A,card-B,card-C', (await cardIds(p)).join(','));

  /* ---- Bare ÉN mappe: ingen markering, og slippet flytter ingenting ---- */
  await seed(p, ['Alene'], ['X', 'Y']);
  const solo = await cardIds(p);
  const h3 = await G.centre(p, '#board .card[data-id="card-Y"] .card-head');
  await G.lift(p, h3, touch);
  await G.travel(p, () => crumbPoint(p), touch);
  const m3 = await marks(p);
  log(name + ': uten en annen mappe markeres ingenting',
    m3.crumb === false && m3.toGroup === false, JSON.stringify(m3));
  await G.drop(p, undefined, touch);
  await settled(p);
  await p.waitForTimeout(250);
  log(name + ': uten en annen mappe åpnes ingen velger', (await pickerOpen(p)) === false);
  log(name + ': lista ble liggende der den lå',
    JSON.stringify(await cardIds(p)) === JSON.stringify(solo), (await cardIds(p)).join(','));

  log(name + ': ingen JS-feil', errs.length === 0, errs.join(' | '));
  await b.close();
}

(async () => {
  await run('desktop', { width: 1200, height: 900 }, false);
  await run('mobil', { width: 390, height: 780 }, true);
  const failed = results.filter((x) => !x).length;
  console.log('\n==== ' + (results.length - failed) + '/' + results.length + ' PASS ====');
  process.exit(failed ? 1 : 0);
})();
