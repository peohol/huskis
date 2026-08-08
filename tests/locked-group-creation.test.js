/*
  Regresjonstest: INGEN opprettelses- eller opprydningskontroll skal tilbys der
  serveren uansett avviser skrivingen.

  Bakgrunnen er en rapportert feil: et vanlig medlem kunne gå inn i en LÅST
  mappe og trykke «＋ Liste». Lista ble opprettet lokalt, aldri skrevet til
  databasen (RLS: `cards_insert` krever `can_create_child('group', …)`), og siden
  den arvet mappelåsen ble den umulig å redigere ELLER slette igjen — et
  spøkelse som bare forsvant ved å tømme localStorage.

  Myndigheten til å OPPRETTE en liste ligger på MAPPEN, ikke på lista: `frozen`
  svarer bare på om jeg kan redigere objektet SELV. Testen dekker alle veiene inn
  til den samme myndigheten:

    1. «＋ Liste» i toppmenyen (den rapporterte feilen)
    2. Klikk-handleren selv (en gjenaktivert knapp skal fortsatt ikke opprette)
    3. Tomtilstanden i en låst mappe forklarer i stedet for å be om et trykk
    4. Ekstrahering: et listepunkt dratt ut i board-lufta lager en NY liste —
       ny-liste-placeholderen skal ikke dukke opp uten opprettelsesrett
    5. Draging av en liste (posisjon blant søsknene tilhører mappen)
    6. Søppelkassene: «Gjenopprett» skriver `trashed = false` og krever samme
       myndighet som å slette — og «Tøm» sletter permanent

  Punkt 4–5 måles i en mappe med et LÅS-UNNTAK på én liste: der kan lista
  redigeres, men det gir ingen rett til å lage en ny liste ved siden av den eller
  flytte den. Eieren brukes som kontroll overalt (låser gjelder aldri for eiere),
  og det samme gjør en ÅPEN mappe i samme område.

  Kjøres på både desktop- og mobil-viewport, mot mock-backenden (?mock=1), som
  håndhever de samme reglene som Postgres/RLS.

  Kjør:
    python3 -m http.server 8000
    NODE_PATH=$(npm root -g) node tests/locked-group-creation.test.js
*/
const { chromium } = require(require('path').join(process.env.NODE_PATH || require('child_process').execSync('npm root -g').toString().trim(), 'playwright'));
const BASE = process.env.HUSKIS_URL || 'http://localhost:8000';

const results = [];
const log = (n, ok, x = '') => { results.push(ok); console.log((ok ? 'PASS' : 'FAIL') + ' — ' + n + (x ? '  [' + x + ']' : '')); };

const U = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
  const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
});

/* Fikstur — A eier området, C er vanlig medlem:
     GL  låst mappe           → liste LL (m/ slettet listepunkt), slettet liste LT
     GO  åpen mappe           → liste LO, slettet liste LOT   (kontrollgruppe)
     GE  låst og tom           → tomtilstanden
     GX  låst m/ unntak på LX  → LX kan redigeres, LX2 er fortsatt låst */
function buildDB() {
  const uA = 'uA', uC = 'uC';
  const ids = { uA, uC, UA: U(), GL: U(), GO: U(), GE: U(), GX: U(),
    LL: U(), LT: U(), LO: U(), LOT: U(), LX: U(), LX2: U(),
    ILA: U(), ILT: U(), IO: U(), IX1: U(), IX2: U(), IY: U() };
  const base = (x) => Object.assign({ trashed: false, locked: false, unlocked: false,
    invite_policy: 'inherit', collapsed: false, is_cat: false, cat_id: null,
    ts: 1, org: 'a', pos: 0, pos_ts: 1, pos_org: 'a' }, x);
  const cardRow = (x) => base(Object.assign({ k: true, p: true, lab_ts: 0, lab_org: '' }, x));
  const mem = (user, on, role) => Object.assign(
    { id: U(), user_id: user, universe_id: null, group_id: null, role, pos: 0, created_at: 1 }, on);
  return {
    ids,
    db: {
      _rolesBackfilled: true,
      profiles: [
        { id: uA, email: 'a@x.no', display_name: 'Alice Eier', user_metadata: {} },
        { id: uC, email: 'c@x.no', display_name: 'Cato Medlem', user_metadata: {} },
      ],
      passwords: { 'a@x.no': 'x', 'c@x.no': 'x' },
      universes: [base({ id: ids.UA, owner_id: uA, name: 'Felles område' })],
      groups: [
        base({ id: ids.GL, owner_id: uA, universe_id: ids.UA, name: 'Låst mappe', locked: true, pos: 0 }),
        base({ id: ids.GO, owner_id: uA, universe_id: ids.UA, name: 'Åpen mappe', pos: 1 }),
        base({ id: ids.GE, owner_id: uA, universe_id: ids.UA, name: 'Låst og tom', locked: true, pos: 2 }),
        base({ id: ids.GX, owner_id: uA, universe_id: ids.UA, name: 'Låst med unntak', locked: true, pos: 3 }),
      ],
      cards: [
        cardRow({ id: ids.LL, owner_id: uA, group_id: ids.GL, title: 'Liste i låst' }),
        cardRow({ id: ids.LT, owner_id: uA, group_id: ids.GL, title: 'Slettet liste', trashed: true, pos: 1 }),
        cardRow({ id: ids.LO, owner_id: uA, group_id: ids.GO, title: 'Åpen liste' }),
        cardRow({ id: ids.LOT, owner_id: uA, group_id: ids.GO, title: 'Slettet åpen', trashed: true, pos: 1 }),
        cardRow({ id: ids.LX, owner_id: uA, group_id: ids.GX, title: 'Åpnet liste', unlocked: true }),
        cardRow({ id: ids.LX2, owner_id: uA, group_id: ids.GX, title: 'Fortsatt låst', pos: 1 }),
      ],
      items: [
        base({ id: ids.ILA, owner_id: uA, card_id: ids.LL, text: 'Punkt i låst' }),
        base({ id: ids.ILT, owner_id: uA, card_id: ids.LL, text: 'Slettet punkt', trashed: true, pos: 1 }),
        base({ id: ids.IO, owner_id: uA, card_id: ids.LO, text: 'Punkt i åpen' }),
        base({ id: ids.IX1, owner_id: uA, card_id: ids.LX, text: 'Punkt X1' }),
        base({ id: ids.IX2, owner_id: uA, card_id: ids.LX, text: 'Punkt X2', pos: 1 }),
        base({ id: ids.IY, owner_id: uA, card_id: ids.LX2, text: 'Punkt Y' }),
      ],
      memberships: [
        mem(uA, { universe_id: ids.UA }, 'owner'),
        mem(uC, { universe_id: ids.UA }, 'member'),
      ],
      share_invites: [], tombstones: [],
    },
  };
}

async function loadAs(page, db, uid, email, viewport) {
  await page.setViewportSize(viewport);
  await page.goto(BASE + '/?mock=1');
  await page.evaluate(({ db, uid, email }) => {
    localStorage.clear(); sessionStorage.clear();
    localStorage.setItem('hk-mock-db', JSON.stringify(db));
    // Kontoen har sett HELE introduksjonen (docs/introduksjon.md): verken
    // omvisningen eller et gest-tips skal legge seg over det som testes.
    sessionStorage.setItem('hk-mock-session', JSON.stringify({ id: uid, email, user_metadata: { onboarding: { v: 3, status: 'done' }, tips: { drag: true, trash: true, moveList: true, dragTrash: true } } }));
  }, { db, uid, email });
  await page.goto(BASE + '/?mock=1');
  await page.waitForFunction(() => {
    const H = window.__huskis;
    return H && H.authUser && H.lastMy && H.state.universes.length > 0;
  }, null, { timeout: 8000, polling: 200 });
}

const goTo = async (p, gid) => {
  await p.evaluate((id) => { window.__huskis.setActiveGroup(id); window.__huskis.render(); }, gid);
  await p.waitForTimeout(250);
};
const cardTitles = (p, gid) => p.evaluate((gid) => {
  const g = window.__huskis.state.universes.flatMap((u) => u.groups).find((x) => x.id === gid);
  return g ? g.cards.filter((c) => !c.trashed && !c._pendingDelete).map((c) => c.title) : null;
}, gid);
const dbCardCount = (p) => p.evaluate(() => JSON.parse(localStorage.getItem('hk-mock-db')).cards.length);

async function ptr(p, type, x, y, kind) {
  await p.evaluate(({ type, x, y, kind }) => {
    const ev = new PointerEvent(type, { bubbles: true, cancelable: true, composed: true,
      clientX: x, clientY: y, pointerId: kind === 'mouse' ? 1 : 7, pointerType: kind, button: 0,
      buttons: type === 'pointerup' || type === 'pointercancel' ? 0 : 1, isPrimary: true });
    (type === 'pointerdown' ? (document.elementFromPoint(x, y) || document.body) : window).dispatchEvent(ev);
  }, { type, x, y, kind });
}
const rectOf = (p, sel) => p.evaluate((sel) => {
  const el = document.querySelector(sel); if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2),
    left: r.left, right: r.right, top: r.top, bottom: r.bottom };
}, sel);

// Løft en rad/liste med musen og dra den til (x, y) — uten å slippe.
async function liftTo(p, sel, x, y) {
  const r = await rectOf(p, sel);
  if (!r) return false;
  await ptr(p, 'pointerdown', r.x, r.y, 'mouse');
  await ptr(p, 'pointermove', r.x + 12, r.y + 12, 'mouse');
  await p.waitForTimeout(120);
  await ptr(p, 'pointermove', x, y, 'mouse');
  await p.waitForTimeout(160);
  await ptr(p, 'pointermove', x, y + 1, 'mouse');
  await p.waitForTimeout(160);
  return true;
}
const drop = async (p, x, y) => { await ptr(p, 'pointerup', x, y, 'mouse'); await p.waitForTimeout(500); };

// Board-luft godt under det nederste kortet (der ny-liste-placeholderen hører hjemme).
const airBelowCards = (p) => p.evaluate(() => {
  let bottom = 0;
  document.querySelectorAll('#board .card').forEach((c) => {
    bottom = Math.max(bottom, c.getBoundingClientRect().bottom);
  });
  const col = document.querySelector('#board .board-col');
  const r = col ? col.getBoundingClientRect() : { left: 0, width: 300 };
  return { x: Math.round(r.left + r.width / 2), y: Math.round(bottom + 90) };
});

// Innholdet i den åpne søppelmodalen.
const trashRows = (p) => p.evaluate(() => ({
  rows: [...document.querySelectorAll('#trash-list .trash-row')].map((r) => ({
    name: r.querySelector('.trash-name').textContent,
    restoreDisabled: r.querySelector('button').disabled,
  })),
  emptyDisabled: document.getElementById('trash-empty').disabled,
}));
const closeTrash = async (p) => { await p.locator('#trash-close').click(); await p.waitForTimeout(250); };

async function run(label, viewport, mobile) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  console.log('\n== ' + label + ' ==');
  const { ids, db } = buildDB();

  /* ---------- Vanlig medlem ---------- */
  await loadAs(p, db, ids.uC, 'c@x.no', viewport);
  const cardsBefore = await dbCardCount(p);

  // 1) «＋ Liste» av/på etter mappens lås
  await goTo(p, ids.GL);
  log(label + ' 1: «＋ Liste» er avskrudd i en låst mappe',
    await p.locator('#add-card-btn').isDisabled());
  await goTo(p, ids.GO);
  log(label + ' 1: «＋ Liste» virker i en åpen mappe i samme område',
    await p.locator('#add-card-btn').isEnabled());
  await goTo(p, ids.GX);
  log(label + ' 1: … og er avskrudd selv når ÉN liste har lås-unntak',
    await p.locator('#add-card-btn').isDisabled());

  // 2) Klikk-handleren avviser også et klikk som slipper forbi (gjenaktivert knapp)
  await goTo(p, ids.GL);
  await p.evaluate(() => {
    const b = document.getElementById('add-card-btn');
    b.disabled = false; b.click();
  });
  await p.waitForTimeout(400);
  log(label + ' 2: handleren oppretter ingenting selv om knappen gjenaktiveres',
    JSON.stringify(await cardTitles(p, ids.GL)) === JSON.stringify(['Liste i låst']),
    JSON.stringify(await cardTitles(p, ids.GL)));

  // 3) Tomtilstanden i en låst mappe forklarer, i stedet for å be om et trykk
  await goTo(p, ids.GE);
  const emptyTxt = await p.locator('#board .empty-state').textContent();
  log(label + ' 3: tomtilstanden sier at mappen er låst, uten «trykk ＋»-hint',
    /låst/i.test(emptyTxt) && !/Trykk/i.test(emptyTxt), emptyTxt.trim());

  // 4) Ekstrahering: ingen ny-liste-placeholder uten opprettelsesrett
  await goTo(p, ids.GX);
  let air = await airBelowCards(p);
  await liftTo(p, '.card[data-id="' + ids.LX + '"] .item[data-id="' + ids.IX1 + '"]', air.x, air.y);
  log(label + ' 4: listepunktet lar seg løfte (lista har lås-unntak)',
    await p.locator('.item.dragging').count() === 1);
  log(label + ' 4: ingen ny-liste-placeholder i board-lufta',
    await p.locator('.new-list-placeholder').count() === 0);
  await drop(p, air.x, air.y);
  log(label + ' 4: slippet lagde ingen ny liste …',
    JSON.stringify(await cardTitles(p, ids.GX)) === JSON.stringify(['Åpnet liste', 'Fortsatt låst']),
    JSON.stringify(await cardTitles(p, ids.GX)));
  log(label + ' 4: … og listepunktet ligger fortsatt i lista si',
    await p.locator('.card[data-id="' + ids.LX + '"] .item[data-id="' + ids.IX1 + '"]').count() === 1);

  // Kontroll: i en ÅPEN mappe dukker placeholderen opp som før
  await goTo(p, ids.GO);
  air = await airBelowCards(p);
  await liftTo(p, '.item[data-id="' + ids.IO + '"]', air.x, air.y);
  log(label + ' 4: kontroll — ny-liste-placeholderen finnes i en åpen mappe',
    await p.locator('.new-list-placeholder').count() === 1);
  await drop(p, air.x, air.y);
  await p.keyboard.press('Escape'); await p.waitForTimeout(300);

  // 5) Listedraging krever rett til å endre mappens innhold (posisjonen er mappens)
  await goTo(p, ids.GX);
  const cardMid = await rectOf(p, '.card[data-id="' + ids.LX + '"] .card-head');
  await liftTo(p, '.card[data-id="' + ids.LX + '"] .card-head', cardMid.x, cardMid.y + 160);
  log(label + ' 5: en liste i en låst mappe lar seg ikke dra, selv med lås-unntak',
    await p.locator('.card.dragging').count() === 0);
  await drop(p, cardMid.x, cardMid.y + 160);

  // 6) Søppelkassene: gjenopprett/tøm kun der myndigheten finnes
  await goTo(p, ids.GL);
  await p.locator('#trash-btn').click(); await p.waitForTimeout(400);
  let t = await trashRows(p);
  log(label + ' 6: «Gjenopprett» er avskrudd for en slettet liste i en låst mappe',
    t.rows.length === 1 && t.rows[0].restoreDisabled === true, JSON.stringify(t.rows));
  log(label + ' 6: «Tøm» er avskrudd når ingenting i kassen kan slettes permanent',
    t.emptyDisabled === true);
  await closeTrash(p);

  await p.locator('.card[data-id="' + ids.LL + '"] .item-trash-btn').click(); await p.waitForTimeout(400);
  t = await trashRows(p);
  log(label + ' 6: samme for et slettet listepunkt i en frossen liste',
    t.rows.length === 1 && t.rows[0].restoreDisabled === true && t.emptyDisabled === true,
    JSON.stringify(t));
  await closeTrash(p);

  await goTo(p, ids.GO);
  await p.locator('#trash-btn').click(); await p.waitForTimeout(400);
  t = await trashRows(p);
  log(label + ' 6: kontroll — i en åpen mappe er begge tilgjengelige',
    t.rows.length === 1 && t.rows[0].restoreDisabled === false && t.emptyDisabled === false,
    JSON.stringify(t));
  await closeTrash(p);

  // Ingenting av det ovenfor skal ha nådd databasen (den ene lista fra kontroll-
  // ekstraheringen i en ÅPEN mappe er den eneste lovlige nyskapningen).
  log(label + ' 7: databasen har fått nøyaktig den ene lovlige nye lista',
    await dbCardCount(p) === cardsBefore + 1, 'før ' + cardsBefore + ', nå ' + await dbCardCount(p));

  /* 7b) Kappløpet: en BUFFRET sletting som blir låst i angre-vinduet.
     Sletter jeg en åpen mappe og en annen eier låser den før angre-toasten er
     ute, skal en «Tøm» ikke committe den buffrede slettingen — det ville stemplet
     en `trashed = true` serveren avviser OG kastet angre-muligheten. Låsen settes
     her rett på state-objektet (`_locked` + `_caps`), nøyaktig slik synken skriver
     den, så testen slipper å kappløpe to 5-sekunders-timere mot hverandre. */
  await p.evaluate((gid) => {
    const H = window.__huskis;
    const g = H.state.universes.flatMap((u) => u.groups).find((x) => x.id === gid);
    H.deleteGroup(g);                                   // buffret sletting + angre-toast
    g._locked = true;                                   // … og så låser noen andre mappen
    if (g._caps) { g._caps.delete = false; g._caps.leave = false; g._caps.editContent = false; }
  }, ids.GO);
  await p.waitForTimeout(200);
  await p.evaluate((uid) => window.__huskis.emptyGroupsTrash(uid), ids.UA);
  await p.waitForTimeout(400);
  const raced = await p.evaluate((gid) => {
    const g = window.__huskis.state.universes.flatMap((u) => u.groups).find((x) => x.id === gid);
    const row = JSON.parse(localStorage.getItem('hk-mock-db')).groups.find((x) => x.id === gid);
    return { found: !!g, pending: !!(g && g._pendingDelete), trashed: !!(g && g.trashed),
      dbTrashed: !!(row && row.trashed) };
  }, ids.GO);
  log(label + ' 7b: en buffret sletting som blir låst committes ikke av «Tøm»',
    raced.found && raced.pending === true && raced.trashed === false && raced.dbTrashed === false,
    JSON.stringify(raced));

  /* ---------- Eieren: låsen gjelder aldri for henne ---------- */
  await loadAs(p, db, ids.uA, 'a@x.no', viewport);
  await goTo(p, ids.GL);
  log(label + ' 8: eieren kan opprette lister i den låste mappen',
    await p.locator('#add-card-btn').isEnabled());
  await p.locator('#trash-btn').click(); await p.waitForTimeout(400);
  t = await trashRows(p);
  log(label + ' 8: eieren kan gjenopprette og tømme',
    t.rows.length === 1 && t.rows[0].restoreDisabled === false && t.emptyDisabled === false,
    JSON.stringify(t));
  await closeTrash(p);
  await goTo(p, ids.GX);
  const ownerCard = await rectOf(p, '.card[data-id="' + ids.LX + '"] .card-head');
  await liftTo(p, '.card[data-id="' + ids.LX + '"] .card-head', ownerCard.x, ownerCard.y + 160);
  log(label + ' 8: eieren kan dra listene i den låste mappen',
    await p.locator('.card.dragging').count() === 1);
  await drop(p, ownerCard.x, ownerCard.y + 160);

  await p.screenshot({ path: '/tmp/locked-group-' + (mobile ? 'mobil' : 'desktop') + '.png' });
  log(label + ' 9: ingen JS-feil underveis', errs.length === 0, errs.join(' | '));
  await browser.close();
}

(async () => {
  await run('desktop', { width: 1280, height: 900 }, false);
  await run('mobil', { width: 390, height: 844 }, true);
  const bad = results.filter((r) => !r).length;
  console.log('\n' + (results.length - bad) + '/' + results.length + ' sjekker grønne');
  process.exit(bad ? 1 : 0);
})();
