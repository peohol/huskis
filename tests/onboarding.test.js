/*
  Regresjonstest: DEMONSTRASJONEN FOR NYE BRUKERE (+ de kontekstuelle tipsene).

  Demoen kjører i en SIMULERING: brukerens egne objekter legges til side, demoen
  bygger sitt eget tomme hierarki, og alt rives ned igjen til slutt. Hvert steg
  må UTFØRES — den går aldri videre fordi en knapp ble trykket, og man kan
  verken lukke, navigere seg bort eller bruke andre funksjoner enn den steget
  demonstrerer. Autoritativt: docs/introduksjon.md. Testen dekker:

    1. Tom, ny konto starter demoen (velkomsten, framdriftsstolpe, role=dialog).
    2. Velkomsten er modal med mørklegging OG uskarphet; resten er tooltips med
       pilspiss, uten mørklegging og uten rampelys.
    3. Simuleringen: brukerens egne objekter er borte fra visningen mens demoen
       står på, kulissene når aldri serveren eller bufferen, og staten kommer
       tilbake etterpå.
    4. Steget går IKKE videre kun fordi en knapp ble trykket (＋ oppretter
       objektet og åpner navnefeltet — navnesteget står til navnet er bekreftet).
    5. Avgrensningen: kontroller steget IKKE handler om svarer ikke (sletting,
       kontoknappen), og Escape kommer ikke ut av steget.
    6. Neste instruks vises FØRST når navigasjonen er ferdig (kortet står skjult
       mens Områder og mapper-modalen fortsatt er åpen).
    7. Pilspissen peker på målet, og kortet dekker det aldri.
    8. «Tilbake» nullstiller det forrige steget, så handlingen kan gjøres om.
    9. En avbrutt navngiving ruller demoen tilbake til steget som lager raden.
   10. Hele runden kan kjøres til ende, og etterpå er kontoen tilbake i sin egen app.
   11. Gamle brukere som ikke har sett DEMOEN får tilbudet (v1/v2 teller ikke),
       mens en konto som har sett den ikke får den igjen.
   12. «Vis på nytt» i konto-modalen starter den samme tomme demoen.
   13. Utlogging midt i demoen river den ned OG gir brukeren staten sin tilbake.
   14. Kontekstuelle tips (etter at demoen er ferdig).

  Kjøres på både desktop- og mobil-viewport.

  Kjør:
    python3 -m http.server 8000                  # fra repo-roten, i egen terminal
    NODE_PATH=$(npm root -g) node tests/onboarding.test.js
*/
const { chromium } = require('playwright');

const BASE = process.env.HUSKIS_URL || 'http://localhost:8000';

// Sletting/oppløsing ligger i objektmenyen. Demoen tillater menypanelet på de
// stegene den demonstrerer, så gaten slipper begge klikkene gjennom.
async function pickInMenu(p, hostSel, label) {
  await p.locator(hostSel + ' .obj-menu-btn').first().click();
  await p.waitForTimeout(250);
  await p.locator('#obj-menu-panel .obj-menu-row', { hasText: label }).click();
  await p.waitForTimeout(250);
}

const results = [];
const log = (n, ok, x = '') => { results.push(ok); console.log((ok ? 'PASS' : 'FAIL') + ' — ' + n + (x ? '  [' + x + ']' : '')); };

const U = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
  const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
});

/* ---------------- Felles hjelpere ---------------- */

// Vent på at demoen står på ET BESTEMT steg OG at kortet faktisk vises.
// `shown` er halve poenget: kortet males først når navigasjonen er ferdig.
const waitStep = (p, id, timeout = 15000) => p.waitForFunction(
  (want) => {
    const H = window.__huskis;
    return !!H && !!H.authUser && H.tour.active && H.tour.id === want && H.tour.shown;
  }, id, { timeout, polling: 80 });

const tourState = (p) => p.evaluate(() => {
  const el = document.getElementById('tour');
  const card = document.getElementById('tour-card');
  const arrow = document.getElementById('tour-arrow');
  const H = window.__huskis;
  return {
    open: !el.hidden,
    id: H.tour.active ? H.tour.id : null,
    index: H.tour.index,
    steps: H.tour.steps,
    sim: H.tour.sim,
    shown: H.tour.shown,
    ctx: H.tour.ctx,
    narrated: H.tour.active ? H.tour.narrated : null,
    demoBody: document.body.classList.contains('tour-demo'),
    note: document.getElementById('tour-note').textContent,
    progress: Number(document.getElementById('tour-progress').getAttribute('aria-valuenow')),
    fill: document.getElementById('tour-progress-fill').style.width,
    nextHidden: document.getElementById('tour-next').hidden,
    backHidden: document.getElementById('tour-back').hidden,
    role: card.getAttribute('role'),
    modal: card.getAttribute('aria-modal'),
    live: !!card.querySelector('[aria-live="polite"]'),
    labelledby: card.getAttribute('aria-labelledby'),
    focusId: document.activeElement.id,
    cardHidden: card.hidden,
    arrowHidden: arrow.hidden,
    cardRect: card.hidden ? null : card.getBoundingClientRect().toJSON(),
    arrowRect: arrow.hidden ? null : arrow.getBoundingClientRect().toJSON(),
    layerBg: getComputedStyle(el).backgroundColor,
    layerBlur: getComputedStyle(el).backdropFilter || getComputedStyle(el).webkitBackdropFilter,
  };
});

// Registrer + logg inn en fersk konto.
async function register(p) {
  await p.goto(BASE + '/?mock=1');
  await p.waitForFunction(() => !!window.__huskis, null, { timeout: 10000, polling: 100 });
  const email = 'u' + Math.floor(Math.random() * 1e9) + '@test.no';
  await p.getByText('Registrer deg').click();
  await p.locator('#auth-first-name').waitFor({ state: 'visible' });
  await p.locator('#auth-first-name').fill('Test');
  await p.locator('#auth-last-name').fill('Bruker');
  await p.locator('#auth-email').fill(email);
  await p.locator('#auth-password').fill('passord123');
  await p.locator('#auth-submit').click();
  await p.getByText('Tilbake til innlogging').click();
  await p.locator('#auth-email').waitFor({ state: 'visible' });
  await p.locator('#auth-email').fill(email);
  await p.locator('#auth-password').fill('passord123');
  await p.locator('#auth-submit').click();
  await waitStep(p, 'welcome');
  return email;
}

const accountMeta = (p, email) => p.evaluate((mail) => {
  const db = JSON.parse(localStorage.getItem('hk-mock-db') || '{}');
  const prof = (db.profiles || []).find((x) => x.email === mail);
  return (prof && prof.user_metadata) || null;
}, email);

const waitReady = (p) => p.waitForFunction(() => {
  const H = window.__huskis;
  return H && H.authUser && H.lastMy;
}, null, { timeout: 10000, polling: 200 });

// Er punktet midt i elementet faktisk elementet selv? (= laget er ikke i veien.)
const hittable = (p, sel) => p.evaluate((s) => {
  const el = document.querySelector(s);
  if (!el) return false;
  const r = el.getBoundingClientRect();
  const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
  return !!hit && (el.contains(hit) || hit.contains(el));
}, sel);

// Rektangler som ikke overlapper (kortet skal aldri dekke målet).
function apart(a, b) {
  if (!a || !b) return false;
  return a.x + a.width <= b.x + 1 || b.x + b.width <= a.x + 1 ||
    a.y + a.height <= b.y + 1 || b.y + b.height <= a.y + 1;
}

async function typeName(p, name) {
  await p.locator('.edit-input').waitFor({ state: 'visible', timeout: 8000 });
  await p.keyboard.type(name);
  await p.keyboard.press('Enter');
}

// Dra fra midten av ett element til midten av et annet (mus: draget starter på
// bevegelse forbi terskelen).
async function drag(p, fromSel, toSel) {
  const a = await p.locator(fromSel).first().boundingBox();
  const b = await p.locator(toSel).first().boundingBox();
  const tx = b.x + b.width / 2, ty = b.y + b.height / 2;
  const sx = a.x + a.width / 2, sy = a.y + a.height / 2;
  await p.mouse.move(sx, sy);
  await p.mouse.down();
  for (let i = 1; i <= 12; i++) {
    await p.mouse.move(sx + (tx - sx) * i / 12, sy + (ty - sy) * i / 12);
    await p.waitForTimeout(20);
  }
  await p.mouse.up();
}

// Hold inne søppelkassen og sveip til høyre (tømming).
async function swipeEmpty(p, sel) {
  const b = await p.locator(sel).first().boundingBox();
  await p.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await p.mouse.down();
  await p.waitForTimeout(450);   // FAST: gest-fysikk (HOLD_EXPAND_MS)
  for (let i = 1; i <= 20; i++) {
    await p.mouse.move(b.x + b.width / 2 + i * 14, b.y + b.height / 2);
    await p.waitForTimeout(15);
  }
  await p.mouse.up();
}

/* ============================================================
   HOVEDLØP — hele demoen fra ende til ende, desktop + mobil
   ============================================================ */
async function run(label, vp, mobile) {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: vp, isMobile: mobile, hasTouch: mobile });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  console.log('\n== ' + label + ' ==');
  const email = await register(p);

  /* ---------- 1) Velkomsten ---------- */
  const s1 = await tourState(p);
  log(label + ' 1: tom, ny konto starter demoen',
    s1.open && s1.id === 'welcome' && s1.role === 'dialog' && s1.sim === true,
    JSON.stringify({ id: s1.id, sim: s1.sim, role: s1.role }));
  log(label + ' 1b: framdrift vises som stolpe, ikke «Steg n av m»',
    s1.progress === 0 && !/steg\s*\d+\s*av/i.test(await p.locator('#tour-card').innerText()),
    JSON.stringify({ progress: s1.progress, fill: s1.fill }));
  const velkomst = await p.locator('#tour-text').innerText();
  log(label + ' 1c: velkomsten nevner lister, mapper, områder og kategorier',
    /huskelister/i.test(velkomst) && /mapper/i.test(velkomst) &&
    /områder/i.test(velkomst) && /kategorier/i.test(velkomst),
    velkomst.replace(/\s+/g, ' ').slice(0, 60));
  log(label + ' 2: velkomsten er modal med BÅDE mørklegging og uskarphet',
    s1.narrated === true && s1.modal === 'true' && /rgba?\(/.test(s1.layerBg) &&
    /blur/.test(s1.layerBlur || ''),
    JSON.stringify({ bg: s1.layerBg, blur: s1.layerBlur }));
  log(label + ' 2b: velkomsten har ingen pilspiss (ingenting å peke på ennå)',
    s1.arrowHidden === true);

  /* ---------- 2) Tooltip-steg: ingen mørklegging, ingen rampelys ---------- */
  await p.locator('#tour-next').click();
  await waitStep(p, 'open_nav');
  const s2 = await tourState(p);
  const crumb = await p.locator('#nav-crumb').boundingBox();
  log(label + ' 3: handlingssteget er en tooltip — ingen mørklegging av appen',
    s2.narrated === false && s2.modal === null &&
    /rgba\(0, 0, 0, 0\)|transparent/.test(s2.layerBg), s2.layerBg);
  log(label + ' 3b: ingen rampelys — #tour-spot finnes ikke lenger',
    (await p.locator('#tour-spot').count()) === 0);
  log(label + ' 4: pilspissen peker på knappen, og kortet dekker den ikke',
    !s2.arrowHidden && apart(s2.cardRect, crumb) &&
    Math.abs((s2.arrowRect.x + s2.arrowRect.width / 2) - (crumb.x + crumb.width / 2)) <= crumb.width,
    JSON.stringify({ pil: s2.arrowRect, kort: s2.cardRect, crumb }));
  log(label + ' 4b: målet tar imot klikk (laget er ikke i veien)',
    await hittable(p, '#nav-crumb'));
  log(label + ' 5: fokus står på den EKTE kontrollen, ikke i kortet',
    s2.focusId === 'nav-crumb', 'fokus=' + s2.focusId);
  log(label + ' 5b: ingen «Neste» på et handlingssteg — handlingen driver det',
    s2.nextHidden && !s2.backHidden);

  /* ---------- 3) Avgrensningen ---------- */
  await p.locator('#account-btn').click({ force: true });
  await p.keyboard.press('Escape');
  // FAST venting med vilje: FRAVÆRSBEVIS — verken konto-modalen eller Escape
  // skal ha gjort noe, og fravær kan først påstås etter at det ville rukket å skje.
  await p.waitForTimeout(500);
  const etterBom = await tourState(p);
  log(label + ' 6: en kontroll steget ikke handler om svarer ikke',
    (await p.locator('#account-modal').isHidden()) && etterBom.id === 'open_nav',
    JSON.stringify({ modalSkjult: await p.locator('#account-modal').isHidden(), id: etterBom.id }));
  log(label + ' 6b: Escape kommer ikke ut av steget', etterBom.open && etterBom.id === 'open_nav');

  /* ---------- 4) ＋ alene fullfører ikke et navnesteg ---------- */
  await p.locator('#nav-crumb').click();
  await waitStep(p, 'create_area');
  await p.locator('.nav-add-uni button').click();
  await waitStep(p, 'name_area');
  log(label + ' 7: ＋ alene fører ikke demoen videre — navnesteget venter',
    (await tourState(p)).id === 'name_area' && (await p.locator('.edit-input').count()) === 1);
  await typeName(p, 'Hjemme');

  /* ---------- 5) Avbrutt navngiving ruller tilbake ---------- */
  await waitStep(p, 'create_folder');
  await p.locator('.uni-card .add-item-row .add-item-btn').first().click();
  await waitStep(p, 'name_folder');
  // Escape er av under demoen, så raden avbrytes ved å bekrefte et tomt felt.
  await p.keyboard.press('Enter');
  await waitStep(p, 'create_folder');
  const rullet = await tourState(p);
  log(label + ' 8: en navngiving uten navn ruller tilbake til steget som lager raden',
    rullet.id === 'create_folder' && !rullet.ctx.groupId,
    JSON.stringify({ id: rullet.id, ctx: rullet.ctx }));

  await p.locator('.uni-card .add-item-row .add-item-btn').first().click();
  await waitStep(p, 'name_folder');
  await typeName(p, 'Ukesplan');

  /* ---------- 6) Navigasjonen fullføres FØR neste instruks ---------- */
  await waitStep(p, 'open_folder');
  const gid = (await tourState(p)).ctx.groupId;
  await p.locator('.uni-card .item[data-id="' + gid + '"]').click();
  await waitStep(p, 'create_list');
  const etterNav = await tourState(p);
  log(label + ' 9: instruksen står først når modalen faktisk er lukket',
    (await p.locator('#nav-modal').isHidden()) && etterNav.shown && !etterNav.cardHidden,
    JSON.stringify({ navLukket: await p.locator('#nav-modal').isHidden(), vist: etterNav.shown }));
  const addBtn = await p.locator('#add-card-btn').boundingBox();
  log(label + ' 9b: kortet dekker ikke «＋ Liste»', apart(etterNav.cardRect, addBtn),
    JSON.stringify({ kort: etterNav.cardRect, knapp: addBtn }));

  /* ---------- 7) «Tilbake» nullstiller forrige steg ---------- */
  await p.locator('#add-card-btn').click();
  await waitStep(p, 'name_list');
  await typeName(p, 'Handleliste');
  await waitStep(p, 'create_item');
  const førTilbake = await p.evaluate(() => window.__huskis.state.universes[0].groups[0].cards.length);
  await p.locator('#tour-back').click();
  await waitStep(p, 'name_list');
  await p.locator('#tour-back').click();
  await waitStep(p, 'create_list');
  const etterTilbake = await p.evaluate(() => window.__huskis.state.universes[0].groups[0].cards.length);
  log(label + ' 10: «Tilbake» nullstiller det man gjorde, så steget kan gjøres om',
    førTilbake === 1 && etterTilbake === 0, førTilbake + ' → ' + etterTilbake);

  /* ---------- 8) Resten av runden ---------- */
  await p.locator('#add-card-btn').click();
  await waitStep(p, 'name_list');
  await typeName(p, 'Handleliste');
  await waitStep(p, 'create_item');
  const cid = (await tourState(p)).ctx.cardId;
  const kort = '.card[data-id="' + cid + '"]';
  const rader = kort + ' > .card-body > .items-container > .item';
  await p.locator(kort + ' .add-item-row .add-item-btn').click();
  await waitStep(p, 'name_item');
  await typeName(p, 'Melk');
  await waitStep(p, 'create_item2');
  await p.locator(kort + ' .add-item-row .add-item-btn').click();
  await waitStep(p, 'name_item2');
  await typeName(p, 'Brød');

  /* Sletting demonstreres ikke her: menyknappen i raden svarer ikke, selv om
     raden ellers er «levende» fordi den skal dras. */
  await waitStep(p, 'drag_item');
  const antall = () => p.evaluate((id) => {
    const c = window.__huskis.state.universes[0].groups[0].cards.find((x) => x.id === id);
    return c.items.filter((it) => !it.trashed && !it._pendingDelete).length;
  }, cid);
  const antallFør = await antall();
  await p.locator(rader + ':last-child .obj-menu-btn').click({ force: true });
  await p.waitForTimeout(400);   // FAST: fraværsbevis (menyen skal IKKE åpne seg)
  const antallEtter = await antall();
  log(label + ' 11: menyen åpner seg ikke når steget ikke demonstrerer sletting',
    antallFør === 2 && antallEtter === 2, antallFør + ' → ' + antallEtter);

  await drag(p, rader + ':last-child', rader + ':first-child');
  await waitStep(p, 'create_list2');
  await p.locator('#add-card-btn').click();
  await waitStep(p, 'name_list2');
  await typeName(p, 'Ideer');

  await waitStep(p, 'drag_list');
  const c2 = (await tourState(p)).ctx.card2Id;
  await drag(p, '.card[data-id="' + c2 + '"] .card-head', kort + ' .card-head');

  await waitStep(p, 'create_cat');
  await p.locator(kort + ' .add-cat-btn').click();
  await waitStep(p, 'name_cat');
  await typeName(p, 'Frokost');
  await waitStep(p, 'drag_into_cat');
  const catId = (await tourState(p)).ctx.catId;
  await drag(p, rader + ':first-child', '.category[data-id="' + catId + '"] .cat-add-btn');
  await waitStep(p, 'create_cat_item');
  await p.locator('.category[data-id="' + catId + '"] .cat-add-btn').click();
  await waitStep(p, 'name_cat_item');
  await typeName(p, 'Egg');
  await waitStep(p, 'dissolve_cat');
  await pickInMenu(p, '.category[data-id="' + catId + '"] .cat-head', 'Løs opp kategorien');

  await waitStep(p, 'delete_item');
  await pickInMenu(p, rader + ':first-child', 'Slett listepunktet');
  await waitStep(p, 'open_item_trash');
  await p.locator(kort + ' .item-trash-btn').click();
  await waitStep(p, 'restore_item');
  await p.locator('#trash-list .trash-row button').first().click();
  await waitStep(p, 'close_item_trash');
  await p.locator('#trash-close').click();
  await waitStep(p, 'delete_item2');
  await pickInMenu(p, rader + ':first-child', 'Slett listepunktet');
  await waitStep(p, 'empty_item_trash');
  await swipeEmpty(p, kort + ' .item-trash-btn');
  await waitStep(p, 'delete_list');
  await pickInMenu(p, kort + ' .card-head', 'Slett listen');
  await waitStep(p, 'empty_card_trash');
  await swipeEmpty(p, '#trash-btn');
  await waitStep(p, 'open_nav2');
  await p.locator('#nav-crumb').click();
  await waitStep(p, 'delete_area');
  await pickInMenu(p, '.uni-card .card-head', 'Slett området for alle');
  await waitStep(p, 'empty_uni_trash');
  await swipeEmpty(p, '#uni-trash-btn');
  await waitStep(p, 'close_nav');
  await p.locator('#nav-modal-close').click();

  /* ---------- 9) Avslutningen ---------- */
  await waitStep(p, 'finish');
  const fin = await tourState(p);
  const kontoKnapp = await p.locator('#account-btn').boundingBox();
  log(label + ' 12: siste steg peker på kontoknappen og sier at turen kan tas igjen',
    !fin.arrowHidden && apart(fin.cardRect, kontoKnapp) &&
    /kontosiden/i.test(await p.locator('#tour-text').innerText()));
  log(label + ' 12b: framdriften er full på siste steg',
    fin.progress === 100 && fin.index === fin.steps - 1,
    JSON.stringify({ progress: fin.progress, index: fin.index, steps: fin.steps }));
  log(label + ' 12c: skjermlesersemantikk (dialog + live-område + tittel)',
    fin.role === 'dialog' && fin.live && fin.labelledby === 'tour-title');
  log(label + ' 12d: demoen ryddet etter seg — ingen kulisser igjen',
    await p.evaluate(() => window.__huskis.state.universes.length === 0));

  await p.locator('#tour-next').click();
  await p.waitForFunction(() => document.getElementById('tour').hidden,
    null, { timeout: 6000, polling: 100 });
  const meta = await accountMeta(p, email);
  log(label + ' 13: fullført demo lagres som «done» på v3',
    !!meta && meta.onboarding.v === 3 && meta.onboarding.status === 'done',
    JSON.stringify(meta && meta.onboarding));
  const etterpå = await p.evaluate(() => ({
    sim: window.__huskis.tour.sim,
    demoBody: document.body.classList.contains('tour-demo'),
  }));
  log(label + ' 13b: simuleringen er avviklet og kroppen ryddet',
    etterpå.sim === false && !etterpå.demoBody, JSON.stringify(etterpå));

  log(label + ' 14: ingen JS-feil', errs.length === 0, errs.join(' | '));
  await b.close();
}

/* ============================================================
   SIMULERINGEN: brukerens innhold røres ikke
   ============================================================ */

// Seed en konto med innhold direkte i mock-databasen.
function seedDB(meta) {
  const uid = U(), UA = U(), GA = U(), LA = U(), IA = U();
  const base = (x) => Object.assign({ trashed: false, locked: false, unlocked: false,
    invite_policy: 'inherit', collapsed: false, is_cat: false, cat_id: null,
    ts: 1, org: 'a', pos: 0, pos_ts: 1, pos_org: 'a' }, x);
  const db = {
    _rolesBackfilled: true,
    profiles: [{ id: uid, email: 'seed@x.no', display_name: 'Seed Bruker', user_metadata: meta || {} }],
    passwords: { 'seed@x.no': 'x' },
    universes: [base({ id: UA, owner_id: uid, name: 'Mitt område' })],
    groups: [base({ id: GA, owner_id: uid, universe_id: UA, name: 'Min mappe' })],
    cards: [base({ id: LA, owner_id: uid, group_id: GA, title: 'Min liste', k: true, p: true, lab_ts: 0, lab_org: '' })],
    items: [base({ id: IA, owner_id: uid, card_id: LA, text: 'Mitt punkt', done: false, home: LA })],
    memberships: [{ id: U(), user_id: uid, universe_id: UA, group_id: null, role: 'owner', pos: 0, created_at: 1 }],
    share_invites: [], tombstones: [],
  };
  return { uid, db };
}

// lag: kunstig serverforsinkelse (?mock=1&lag=…) — brukes til å holde en
// synk-runde i lufta mens demoen starter.
async function loadSeeded(p, db, uid, lag) {
  const url = BASE + '/?mock=1' + (lag ? '&lag=' + lag : '');
  await p.goto(url);
  await p.evaluate(({ db, uid, meta }) => {
    localStorage.clear(); sessionStorage.clear();
    localStorage.setItem('hk-mock-db', JSON.stringify(db));
    sessionStorage.setItem('hk-mock-session', JSON.stringify({ id: uid, email: 'seed@x.no', user_metadata: meta }));
  }, { db, uid, meta: (db.profiles.find((x) => x.id === uid) || {}).user_metadata || {} });
  await p.goto(url);
  await waitReady(p);
}

async function runSimulation() {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1200, height: 900 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  console.log('\n== simuleringen ==');

  /* --- en gammel bruker som ALDRI har sett demoen får tilbudet --- */
  for (const v of [1, 2]) {
    const f = seedDB({ onboarding: { v, status: 'done' }, tips: {} });
    await loadSeeded(p, f.db, f.uid);
    await waitStep(p, 'welcome');
    log('sim 1 (v' + v + '): en konto som bare har sett en tidligere runde får demoen tilbudt',
      (await tourState(p)).id === 'welcome');
    await p.locator('#tour-close').click();
    await p.waitForFunction(() => document.getElementById('tour').hidden,
      null, { timeout: 5000, polling: 100 });
  }

  /* --- innholdet er borte fra visningen UNDER demoen, og tilbake etterpå --- */
  const f = seedDB({});
  await loadSeeded(p, f.db, f.uid);
  await waitStep(p, 'welcome');
  const under = await p.evaluate(() => ({
    unis: window.__huskis.state.universes.length,
    sim: window.__huskis.tour.sim,
  }));
  log('sim 2: brukerens egne objekter er lagt til side mens demoen står på',
    under.unis === 0 && under.sim === true, JSON.stringify(under));

  // Bygg en kulisse i demoen, og se at ingenting av den lekker ut.
  await p.locator('#tour-next').click();
  await waitStep(p, 'open_nav');
  await p.locator('#nav-crumb').click();
  await waitStep(p, 'create_area');
  await p.locator('.nav-add-uni button').click();
  await waitStep(p, 'name_area');
  await typeName(p, 'Demoområde');
  await waitStep(p, 'create_folder');
  const lekkasje = await p.evaluate(() => {
    const db = JSON.parse(localStorage.getItem('hk-mock-db') || '{}');
    const buffer = Object.keys(localStorage).filter((k) => /^mine-lister-v1/.test(k))
      .map((k) => localStorage.getItem(k)).join('|');
    return {
      server: (db.universes || []).map((u) => u.name),
      bufferHarDemo: /Demoområde/.test(buffer),
    };
  });
  log('sim 3: demoens kulisser skrives ALDRI til serveren',
    lekkasje.server.length === 1 && lekkasje.server[0] === 'Mitt område',
    JSON.stringify(lekkasje.server));
  log('sim 3b: kulissene skrives heller ikke til den lokale bufferen',
    lekkasje.bufferHarDemo === false);

  await p.locator('#tour-close').click();
  await p.waitForFunction(() => document.getElementById('tour').hidden,
    null, { timeout: 5000, polling: 100 });
  const etter = await p.evaluate(() => ({
    unis: window.__huskis.state.universes.map((u) => u.name),
    sim: window.__huskis.tour.sim,
  }));
  log('sim 4: brukeren får staten sin tilbake når demoen avsluttes',
    etter.sim === false && etter.unis.length === 1 && etter.unis[0] === 'Mitt område',
    JSON.stringify(etter));
  const metaSkip = await accountMeta(p, 'seed@x.no');
  log('sim 4b: avsluttet demo lagres som «skipped» på v3',
    metaSkip.onboarding.v === 3 && metaSkip.onboarding.status === 'skipped',
    JSON.stringify(metaSkip.onboarding));

  /* --- «Vis på nytt» på en konto med innhold --- */
  await p.locator('#account-btn').click();
  await p.locator('#menu-tour').waitFor({ state: 'visible' });
  await p.locator('#tour-restart').click();
  await waitStep(p, 'welcome');
  const igjen = await p.evaluate(() => ({
    unis: window.__huskis.state.universes.length,
    kontoLukket: document.getElementById('account-modal').hidden,
  }));
  log('sim 5: «Vis på nytt» kjører den samme tomme demoen, ikke brukerens innhold',
    igjen.unis === 0 && igjen.kontoLukket, JSON.stringify(igjen));

  /* --- utlogging midt i demoen gir staten tilbake --- */
  await p.evaluate(() => window.__huskis.logout());
  await p.waitForFunction(() => document.getElementById('tour').hidden,
    null, { timeout: 8000, polling: 100 });
  const utlogget = await p.evaluate(() => ({
    sim: window.__huskis.tour.sim,
    aktiv: window.__huskis.tour.active,
    demoBody: document.body.classList.contains('tour-demo'),
  }));
  log('sim 6: utlogging midt i demoen river den ned og avvikler simuleringen',
    !utlogget.sim && !utlogget.aktiv && !utlogget.demoBody, JSON.stringify(utlogget));

  /* --- en konto som HAR sett demoen får den ikke igjen --- */
  const sett = seedDB({ onboarding: { v: 3, status: 'done' }, tips: {} });
  await loadSeeded(p, sett.db, sett.uid);
  await p.waitForTimeout(900);   // FAST: fraværsbevis («demoen kommer IKKE»)
  log('sim 7: en konto som har sett demoen får den ikke automatisk igjen',
    !(await tourState(p)).open);

  /* --- en BESTILT bufferskriving bærer brukerens state, ikke kulissen ---
     Bufferskrivingen er debouncet 120 ms. Ble den bestilt like før demoen
     startet, ville den fyrt ETTER byttet og lagret en tom kulisse sammen med
     den ekte synk-basen — og en reload midt i demoen ville lest det som «alt
     slettet lokalt». */
  await p.evaluate(() => {
    const H = window.__huskis;
    H.state.universes[0].name = 'Endret rett før demoen';
    H.save();                 // bestiller en skriving 120 ms fram i tid
    H.tour.start();           // … og demoen bytter ut state med det samme
  });
  await waitStep(p, 'welcome');
  await p.waitForTimeout(400);  // FAST: la den bestilte skrivingen få fyre
  const buffer = await p.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => /^mine-lister-v1:/.test(k));
    const s = key ? JSON.parse(localStorage.getItem(key)) : null;
    return s ? (s.universes || []).map((u) => u.name) : null;
  });
  log('sim 8: en skriving bestilt før demoen lagrer BRUKERENS state, ikke kulissen',
    !!buffer && buffer.length === 1 && buffer[0] === 'Endret rett før demoen',
    JSON.stringify(buffer));
  await p.evaluate(() => window.__huskis.tour.end('skipped'));
  await p.waitForFunction(() => document.getElementById('tour').hidden,
    null, { timeout: 5000, polling: 100 });

  /* --- en synk-runde som ALLEREDE er i lufta pusher ikke kulissen ---
     Vakten øverst i cloudCycle fanger bare runder som ikke har begynt. En runde
     som venter på `get_my_doc` når demoen starter, ville gjenopptatt med
     kulissen i `state` og lest brukerens ekte rader som slettet. */
  const treg = seedDB({ onboarding: { v: 3, status: 'done' }, tips: {} });
  await loadSeeded(p, treg.db, treg.uid, 900);
  await p.evaluate(() => {
    window.__huskis.cloudCycle();   // runden henger i transporten (lag=900)
    window.__huskis.tour.start();   // … og demoen bytter ut state mens den venter
  });
  await waitStep(p, 'welcome');
  await p.waitForTimeout(2500);   // FAST: la den hengende runden komme tilbake
  const serverEtter = await p.evaluate(() => {
    const db = JSON.parse(localStorage.getItem('hk-mock-db') || '{}');
    return {
      områder: (db.universes || []).map((u) => u.name),
      mapper: (db.groups || []).length,
      lister: (db.cards || []).length,
      gravsteiner: (db.tombstones || []).length,
    };
  });
  log('sim 9: en runde som var i lufta da demoen startet rører ikke serveren',
    serverEtter.områder.length === 1 && serverEtter.områder[0] === 'Mitt område' &&
    serverEtter.mapper === 1 && serverEtter.lister === 1 && serverEtter.gravsteiner === 0,
    JSON.stringify(serverEtter));
  await p.evaluate(() => window.__huskis.tour.end('skipped'));

  log('sim 10: ingen JS-feil', errs.length === 0, errs.join(' | '));
  await b.close();
}

/* ============================================================
   «REDUSER BEVEGELSE» + KONTEKSTUELLE TIPS
   ============================================================ */
async function runReducedMotion() {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1200, height: 900 }, reducedMotion: 'reduce' });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  console.log('\n== reduser bevegelse ==');
  await register(p);
  const s = await tourState(p);
  log('rm 1: demoen starter også med «reduser bevegelse»', s.open && s.id === 'welcome');
  const motion = await p.evaluate(() => ({
    fill: getComputedStyle(document.getElementById('tour-progress-fill')).transitionDuration,
    kort: getComputedStyle(document.getElementById('tour-card')).animationDuration,
    reduce: matchMedia('(prefers-reduced-motion: reduce)').matches,
  }));
  // «0s», «0.001ms», «1e-06s» — alt under et millisekund er praktisk talt av.
  const stille = (v) => parseFloat(String(v).split(',')[0]) * (/ms$/.test(v) ? 1 : 1000) < 1;
  log('rm 2: ingen bevegelse på kort eller framdriftsstolpe',
    motion.reduce && stille(motion.fill) && stille(motion.kort), JSON.stringify(motion));
  await p.locator('#tour-next').click();
  await waitStep(p, 'open_nav');
  const s2 = await tourState(p);
  const crumb = await p.locator('#nav-crumb').boundingBox();
  log('rm 3: pilspissen treffer likevel målet',
    !s2.arrowHidden && apart(s2.cardRect, crumb));
  log('rm 4: ingen JS-feil', errs.length === 0, errs.join(' | '));
  await b.close();
}

/* Tipsene om de avanserte gestene — de kommer FØRST når demoen er ferdig. */
async function runTips() {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1200, height: 900 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  console.log('\n== kontekstuelle tips ==');
  const email = await register(p);
  await p.evaluate(() => window.__huskis.tour.end('done'));
  await p.waitForFunction(() => document.getElementById('tour').hidden,
    null, { timeout: 5000, polling: 100 });

  // To lister i mappen → flytte-gesten er relevant, og tipset kommer én gang.
  await p.evaluate((count) => {
    const H = window.__huskis, st = H.state;
    const mk = (o) => Object.assign({ ts: 1, org: 't', pos: 0, posTs: 1, posOrg: 't', trashed: false, _role: 'owner' }, o);
    st.universes.length = 0;
    const u = mk({ id: 'uni-A', name: 'Hjemme', collapsed: false, groups: [] });
    const g = mk({ id: 'g-a1', uni: 'uni-A', name: 'Ukesplan', cat: null, isCat: false, collapsed: false, cards: [] });
    for (let i = 0; i < count; i++) {
      g.cards.push(mk({ id: 'c-' + i, group: 'g-a1', title: 'Liste ' + i, pos: i, k: true, p: true, items: [] }));
    }
    u.groups.push(g);
    st.universes.push(u);
    st.activeUniverse = 'uni-A'; st.activeGroup = 'g-a1';
    H.render();
  }, 2);
  await p.waitForFunction(() => {
    const t = document.getElementById('toast');
    return !!t && t.classList.contains('show');
  }, null, { timeout: 6000, polling: 100 });
  const tip = await p.evaluate(() => {
    const t = document.getElementById('toast');
    return {
      tekst: t.innerText.replace(/\s+/g, ' ').trim(),
      tips: t.classList.contains('toast-tip'),
      modal: document.body.classList.contains('modal-open'),
      stjalFokus: t.contains(document.activeElement),
    };
  });
  log('tips 1: første relevante gest gir et kontekstuelt tips',
    tip.tips && /hold/i.test(tip.tekst), tip.tekst);
  log('tips 1b: tipset blokkerer ikke bruken (ingen modal, ingen fokusfangst)',
    !tip.modal && !tip.stjalFokus);
  const metaTips = await accountMeta(p, email);
  log('tips 1c: tipset er lagret på kontoen',
    !!metaTips.tips && metaTips.tips.drag === true, JSON.stringify(metaTips.tips));

  await p.evaluate(() => { document.getElementById('toast').classList.remove('show'); });
  await p.evaluate(() => window.__huskis.render());
  await p.waitForTimeout(600);   // FAST: fraværsbevis — tipset skal IKKE komme igjen
  log('tips 1d: det samme tipset kommer ikke igjen',
    !(await p.evaluate(() => document.getElementById('toast').classList.contains('show'))));

  log('tips 2: ingen JS-feil', errs.length === 0, errs.join(' | '));
  await b.close();
}

(async () => {
  await run('desktop', { width: 1200, height: 900 }, false);
  await run('mobil', { width: 390, height: 780 }, true);
  await runSimulation();
  await runReducedMotion();
  await runTips();
  const ok = results.filter(Boolean).length;
  console.log('\n==== ' + ok + '/' + results.length + ' PASS ====');
  process.exit(ok === results.length ? 0 : 1);
})();
