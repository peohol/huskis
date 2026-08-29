/*
  Regresjonstest: VARSELKNAPPEN og VARSELMODALEN (docs/varsler.md).
  Generatoren og synkingen har sin egen fil (`notifications.test.js`); her
  testes flaten.

  Radene seedes rett inn i mock-databasen, ikke gjennom generatoren: da er
  rekkefølge, lest/ulest, angre-vinduet og «Utsett» det som faktisk måles.

  Dekker:
     1. Bjelleknappen ligger FØRST i toppkontrollgruppen, og badgen viser
        antall uleste — skjult ved 0, «99+» over hundre, og antallet er med i
        knappens ARIA-navn (badgen selv er aria-hidden).
     2. Modalen: dialogsemantikk, nyeste ØVERST, ikon/flate per varseltype,
        objektnavn, melding, kontekststi og diskret dato + klokkeslett.
     3. Tomtilstand.
     4. Åpning markerer lest — men bare det som sto der da modalen ble åpnet.
        Et varsel som ankommer ETTERPÅ forblir ulest, også med modalen åpen.
     5. Trykk på en rad navigerer via `navigateToObject()`.
     6. Et slettet mål: raden står, klikk verken feiler eller navigerer, og
        modalen blir stående med en beskjed.
     7. «Tøm varsler»: øyeblikksbildet skjules straks, knappen blir «Angre · 10»
        og teller ned, «Angre» gjenoppretter, og et varsel som ankommer ETTER
        øyeblikksbildet blir ikke slettet med det.
     8. Lukking av modalen committer slettingen med én gang.
     9. «Utsett» 1 time / 6 timer / 1 døgn lager et nytt varsel som er USYNLIG
        til det forfaller, og kvitterer det opprinnelige som lest.
    10. Preferansepanelet: fire brytere, og et bytte lagres på kontoen.
    11. Tastatur og fokus: Escape lukker, og fokus går tilbake til bjellen.
    12. i18n: hele flaten på engelsk.
    13. Kontobytte UTEN utlogging (Supabase kan gå rett fra én bruker til en
        annen): historikken og badgen nullstilles med én gang, ikke først når
        den nye brukerens pull svarer — den kan utebli helt offline.

  Kjøres på BÅDE desktop- og mobil-viewport.

  Kjør:
    python3 -m http.server 8000                        # fra repo-roten, i egen terminal
    NODE_PATH=$(npm root -g) node tests/notif-modal.test.js
*/
const { chromium } = require('playwright');

const BASE = process.env.HUSKIS_URL || 'http://localhost:8000';
const results = [];
const log = (n, ok, x = '') => { results.push(ok); console.log((ok ? 'PASS' : 'FAIL') + ' — ' + n + (x !== '' ? '  [' + (typeof x === 'string' ? x : JSON.stringify(x)) + ']' : '')); };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const U = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
  const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
});

function buildDB() {
  const uid = 'uM';
  const id = { UA: U(), GA: U(), C1: U(), C2: U(), C3: U(), I1: U(), I2: U(), I3: U() };
  const base = (x) => Object.assign({
    trashed: false, locked: false, unlocked: false, invite_policy: 'inherit',
    collapsed: false, is_cat: false, cat_id: null,
    start_at: null, due_at: null, lock_times: false,
    ts: 1, org: 'm', pos: 0, pos_ts: 1, pos_org: 'm',
  }, x);
  const card = (i, t, pos) => base({ id: i, owner_id: uid, group_id: id.GA, title: t, pos: pos,
    k: true, p: true, lab_ts: 0, lab_org: '' });
  const item = (i, c, t) => base({ id: i, owner_id: uid, card_id: c, text: t, done: false });
  return { id, uid, db: {
    _rolesBackfilled: true,
    // Bruker B finnes bare for kontobytte-testen nederst: Supabase kan gå rett
    // fra én innlogget bruker til en annen UTEN et SIGNED_OUT imellom.
    profiles: [
      { id: uid, email: 'm@x.no', display_name: 'Modal', user_metadata: {} },
      { id: 'uB', email: 'b@x.no', display_name: 'Bytte', user_metadata: {} },
    ],
    passwords: { 'm@x.no': 'x', 'b@x.no': 'x' },
    universes: [base({ id: id.UA, owner_id: uid, name: 'Arbeid' })],
    groups: [base({ id: id.GA, owner_id: uid, universe_id: id.UA, name: 'Klinikk' })],
    cards: [card(id.C1, 'Skattemelding', 0), card(id.C2, 'Sykkeltur', 1), card(id.C3, 'Flyttedag', 2)],
    items: [item(id.I1, id.C1, 'Levere'), item(id.I2, id.C2, 'Pumpe dekk'), item(id.I3, id.C3, 'Pakke')],
    memberships: [{ id: U(), user_id: uid, universe_id: id.UA, group_id: null, role: 'owner', pos: 0, created_at: 1 }],
    share_invites: [], tombstones: [], notifications: [], notification_prefs: [],
  } };
}

async function seed(p, db, uid, lang) {
  await p.goto(BASE + '/?mock=1');
  await p.evaluate(({ db, uid, lang }) => {
    localStorage.clear(); sessionStorage.clear();
    if (lang) localStorage.setItem('hk-lang', lang);
    localStorage.setItem('hk-mock-db', JSON.stringify(db));
    sessionStorage.setItem('hk-mock-session', JSON.stringify({
      id: uid, email: 'm@x.no',
      user_metadata: { lang: lang || 'no', onboarding: { v: 3, status: 'done' },
        tips: { drag: true, trash: true, moveList: true, dragTrash: true } },
    }));
  }, { db, uid, lang });
  await p.goto(BASE + '/?mock=1');
  await p.waitForFunction(() => {
    const H = window.__huskis;
    return H && H.authUser && H.lastMy && H.state.universes.length > 0;
  }, null, { timeout: 15000, polling: 200 });
  await p.waitForTimeout(400);
}

// Legg rader rett i «databasen» — som om generatoren hadde logget dem.
async function addNotifs(p, rows) {
  await p.evaluate((rows) => {
    const db = window.HK_MOCK._loadDB();
    const uid = window.__huskis.authUser.id;
    const uuid = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
    rows.forEach((r) => db.notifications.push(Object.assign({
      id: uuid(), user_id: uid, key: 'k-' + Math.random(), snoozed: false,
      name: '', path: 'Arbeid › Klinikk', value: '2026-06-14T12:00',
      created_at: Date.now(), read_at: null,
    }, r)));
    window.HK_MOCK._saveDB(db);
  }, rows);
}

async function cycle(p) {
  await p.evaluate(() => window.__huskis.cloudCycle());
  await p.waitForTimeout(500);
}

const badgeInfo = (p) => p.evaluate(() => {
  const b = document.getElementById('notif-badge');
  const btn = document.getElementById('notif-btn');
  return { hidden: b.hidden, text: b.textContent, ariaHidden: b.getAttribute('aria-hidden'),
    label: btn.getAttribute('aria-label') };
});

const rowsOf = (p) => p.evaluate(() => [...document.querySelectorAll('#notif-body .notif-item')].map((li) => {
  const btn = li.querySelector('.notif-row');
  return {
    id: li.dataset.id,
    name: btn.querySelector('.notif-name').textContent,
    meta: btn.querySelector('.notif-meta').textContent,
    when: btn.querySelector('.notif-when').textContent,
    tone: [...btn.querySelector('.event-icon').classList].filter((c) => c.indexOf('is-') === 0).join(''),
    unread: btn.classList.contains('is-unread'),
    gone: btn.classList.contains('is-gone'),
    label: btn.getAttribute('aria-label'),
  };
}));

async function run(label, viewport, mobile) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext(Object.assign({ viewport,
    timezoneId: 'Europe/Oslo', locale: 'nb-NO' }, mobile ? { isMobile: true, hasTouch: true } : {}));
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  console.log('\n== ' + label + ' ==');

  const { id, uid, db } = buildDB();
  await seed(p, db, uid);

  /* ---------- 1) Knappen og badgen ---------- */
  const plass = await p.evaluate(() => {
    const g = document.getElementById('corner-controls');
    return [...g.children].map((k) => k.id);
  });
  log(label + ' 1a: bjellen ligger FØRST i toppkontrollgruppen, til venstre for kalenderen',
    plass[0] === 'notif-btn' && plass[1] === 'events-btn', JSON.stringify(plass));
  const tom = await badgeInfo(p);
  log(label + ' 1b: badgen er skjult når ingenting er ulest',
    tom.hidden === true && tom.label === 'Varsler', JSON.stringify(tom));

  const NÅ = Date.now();
  await addNotifs(p, [
    { type: 'dueOver', obj_type: 'card', obj_id: id.C1, name: 'Skattemelding', at: NÅ - 60000, value: '2026-06-14T12:00' },
    { type: 'dueSoon', obj_type: 'card', obj_id: id.C2, name: 'Sykkeltur', at: NÅ - 3600000, value: '2026-06-20' },
    { type: 'startNow', obj_type: 'item', obj_id: id.I3, name: 'Pakke', at: NÅ - 7200000, value: '2026-06-10T08:00' },
  ]);
  await cycle(p);
  const tre = await badgeInfo(p);
  log(label + ' 1c: badgen viser antall uleste, og antallet står i knappens navn',
    tre.hidden === false && tre.text === '3' && tre.label === 'Varsler, 3 uleste' &&
    tre.ariaHidden === 'true', JSON.stringify(tre));

  /* ---------- 2) Modalen ---------- */
  await p.click('#notif-btn');
  await p.waitForTimeout(300);
  const dialog = await p.evaluate(() => {
    const d = document.querySelector('#notif-modal .modal');
    return { role: d.getAttribute('role'), modal: d.getAttribute('aria-modal'),
      tittel: document.getElementById('notif-modal-title').textContent.trim(),
      status: document.getElementById('notif-count').textContent };
  });
  log(label + ' 2a: dialogsemantikk og tittel', dialog.role === 'dialog' &&
    dialog.modal === 'true' && dialog.tittel === 'Varsler', JSON.stringify(dialog));
  log(label + ' 2b: antallet leses opp ved åpning', dialog.status === '3 varsler, 3 uleste.', dialog.status);
  const rader = await rowsOf(p);
  log(label + ' 2c: NYESTE øverst',
    eq(rader.map((r) => r.name), ['Skattemelding', 'Sykkeltur', 'Pakke']),
    JSON.stringify(rader.map((r) => r.name)));
  log(label + ' 2d: hver rad har flaten som hører til varseltypen',
    eq(rader.map((r) => r.tone), ['is-over', 'is-soon', 'is-started']),
    JSON.stringify(rader.map((r) => r.tone)));
  log(label + ' 2e: meldingen sier hva som skjedde, og stien hvor objektet står',
    rader[0].meta.indexOf('Fristen') === 0 && rader[0].meta.indexOf('Arbeid › Klinikk') > -1,
    rader[0].meta);
  log(label + ' 2f: raden viser dato + klokkeslett for varselet',
    /\d/.test(rader[0].when) && rader[0].when.indexOf('kl.') > -1, rader[0].when);
  log(label + ' 2g: opplesningen bærer tilstand, type, navn og sti i klartekst',
    rader[0].label.indexOf('Ulest') === 0 && rader[0].label.indexOf('Frist utløpt') > -1 &&
    rader[0].label.indexOf('Skattemelding') > -1 &&
    rader[0].label.indexOf('Arbeid › Klinikk') > -1, rader[0].label);
  log(label + ' 2h: radene åpningen merket lest beholder markeringen til modalen lukkes',
    rader.every((r) => r.unread === true), JSON.stringify(rader.map((r) => r.unread)));

  /* ---------- 4) Åpning markerer lest ---------- */
  await p.waitForTimeout(400);
  const etterÅpning = await badgeInfo(p);
  log(label + ' 4a: åpningen markerer alt som sto der som lest — badgen forsvinner',
    etterÅpning.hidden === true, JSON.stringify(etterÅpning));
  const iDb = await p.evaluate(() => window.HK_MOCK._loadDB().notifications.filter((n) => n.read_at).length);
  log(label + ' 4b: lest-merkingen ligger på KONTOEN, ikke bare i denne fanen', iDb === 3, String(iDb));

  // Et varsel som ankommer MENS modalen står åpen skal ikke bli lest.
  await addNotifs(p, [{ type: 'startSoon', obj_type: 'card', obj_id: id.C3,
    name: 'Flyttedag', at: NÅ - 10000, value: '2026-06-25' }]);
  await cycle(p);
  const medNytt = await rowsOf(p);
  const nyBadge = await badgeInfo(p);
  const ulestPåKontoen = await p.evaluate(() =>
    window.__huskis.notifRows.filter((r) => !r.readAt).map((r) => r.name));
  log(label + ' 4c: et varsel som ankommer etter åpningen dukker opp …',
    medNytt.length === 4 && medNytt[0].name === 'Flyttedag',
    JSON.stringify(medNytt.map((r) => r.name)));
  log(label + ' 4d: … og forblir ULEST — grensen er satt ved åpningen, ikke på klokka',
    eq(ulestPåKontoen, ['Flyttedag']) && nyBadge.hidden === false && nyBadge.text === '1',
    JSON.stringify({ ulest: ulestPåKontoen, badge: nyBadge.text }));

  /* ---------- 9) «Utsett» ---------- */
  await p.click('.notif-item:first-child .notif-snooze-btn');
  await p.waitForTimeout(200);
  const valg = await p.evaluate(() => [...document.querySelectorAll('.notif-item:first-child .notif-snooze-row button')].map((b) => b.textContent));
  log(label + ' 9a: «Utsett» tilbyr 1 time, 6 timer og 1 døgn',
    eq(valg, ['Om 1 time', 'Om 6 timer', 'Om 1 døgn']), JSON.stringify(valg));
  const førUtsett = await p.evaluate(() => window.HK_MOCK._loadDB().notifications.length);
  await p.click('.notif-item:first-child .notif-snooze-row button:nth-child(3)');  // 1 døgn
  await p.waitForTimeout(600);
  await cycle(p);
  const utsatt = await p.evaluate(() => {
    const db = window.HK_MOCK._loadDB();
    const ny = db.notifications.filter((n) => n.snoozed);
    return { antall: db.notifications.length, snoozed: ny.length,
      framITid: ny.every((n) => n.at > Date.now() + 20 * 3600 * 1000),
      synlige: document.querySelectorAll('#notif-body .notif-item').length,
      badge: document.getElementById('notif-badge').hidden };
  });
  log(label + ' 9b: utsettelsen lager ETT nytt varsel med et tidspunkt et døgn fram',
    utsatt.antall === førUtsett + 1 && utsatt.snoozed === 1 && utsatt.framITid,
    JSON.stringify(utsatt));
  log(label + ' 9c: det utsatte varselet er usynlig til det forfaller, og teller ikke som ulest',
    utsatt.synlige === 4 && utsatt.badge === true, JSON.stringify(utsatt));

  /* ---------- 7) «Tøm varsler» med angre ---------- */
  const idFørTømming = (await rowsOf(p)).map((r) => r.id);
  await p.click('#notif-clear');
  await p.waitForTimeout(250);
  const tømt = await p.evaluate(() => ({
    rader: document.querySelectorAll('#notif-body .notif-item').length,
    knapp: document.getElementById('notif-clear').textContent,
    iDb: window.HK_MOCK._loadDB().notifications.length,
  }));
  log(label + ' 7a: øyeblikksbildet skjules med én gang, uten bekreftelse …',
    tømt.rader === 0 && tømt.iDb > 0, JSON.stringify(tømt));
  log(label + ' 7b: … og knappen blir «Angre · 10»', tømt.knapp === 'Angre · 10', tømt.knapp);
  // Nedtellingen er en tidsvindu-observasjon: den MÅ ses på klokka.
  await p.waitForTimeout(1300);
  const teller = await p.evaluate(() => document.getElementById('notif-clear').textContent);
  log(label + ' 7c: nedtellingen teller ned', teller === 'Angre · 9', teller);

  // Et varsel som ankommer ETTER øyeblikksbildet skal ikke slettes med det.
  await addNotifs(p, [{ type: 'dueOver', obj_type: 'card', obj_id: id.C2,
    name: 'Etterpå', at: Date.now() - 1000, value: '2026-07-01' }]);
  await cycle(p);
  const underAngre = await rowsOf(p);
  log(label + ' 7d: et varsel som ankommer under angre-vinduet vises …',
    underAngre.length === 1 && underAngre[0].name === 'Etterpå',
    JSON.stringify(underAngre.map((r) => r.name)));

  await p.click('#notif-clear');   // Angre
  await p.waitForTimeout(250);
  const angret = await rowsOf(p);
  log(label + ' 7e: «Angre» gjenoppretter nøyaktig øyeblikksbildet',
    angret.length === 5 && idFørTømming.every((x) => angret.some((r) => r.id === x)),
    JSON.stringify(angret.map((r) => r.name)));

  /* ---------- 8) Lukking committer ---------- */
  await p.click('#notif-clear');
  await p.waitForTimeout(200);
  const snapshot = 5;
  await p.click('#notif-close');
  await p.waitForTimeout(700);
  const etterLukking = await p.evaluate(() => {
    const db = window.HK_MOCK._loadDB();
    return { igjen: db.notifications.length, navn: db.notifications.map((n) => n.name) };
  });
  log(label + ' 8: lukking committer slettingen med én gang — det utsatte varselet overlever',
    etterLukking.igjen === 1 && etterLukking.navn[0] === 'Flyttedag',
    JSON.stringify(etterLukking) + ' (øyeblikksbilde: ' + snapshot + ')');

  /* ---------- 3) Tomtilstand ---------- */
  await cycle(p);
  await p.click('#notif-btn');
  await p.waitForTimeout(300);
  const tomtilstand = await p.evaluate(() => ({
    tekst: (document.querySelector('#notif-body .notif-empty') || {}).textContent || '',
    knapp: document.getElementById('notif-clear').disabled,
  }));
  log(label + ' 3: tomtilstand, og «Tøm varsler» er avskrudd',
    tomtilstand.tekst === 'Ingen varsler ennå.' && tomtilstand.knapp === true,
    JSON.stringify(tomtilstand));

  /* ---------- 10) Preferansene ---------- */
  await p.click('#notif-settings-btn');
  await p.waitForTimeout(250);
  const brytere = await p.evaluate(() => [...document.querySelectorAll('#notif-body .toggle-switch')]
    .map((b) => b.dataset.pref + '=' + b.getAttribute('aria-checked')));
  log(label + ' 10a: fire brytere, alle PÅ som standard',
    eq(brytere, ['dueOver=true', 'dueSoon=true', 'startNow=true', 'startSoon=true']),
    JSON.stringify(brytere));
  await p.click('#notif-body .toggle-switch[data-pref="dueSoon"]');
  await p.waitForTimeout(500);
  const lagret = await p.evaluate(() => {
    const db = window.HK_MOCK._loadDB();
    const row = db.notification_prefs.find((r) => r.user_id === window.__huskis.authUser.id);
    return { due_soon: row.due_soon, klient: window.__huskis.notifPrefs.dueSoon,
      aria: document.querySelector('#notif-body .toggle-switch[data-pref="dueSoon"]').getAttribute('aria-checked') };
  });
  log(label + ' 10b: et bytte lagres på kontoen (ikke bare i denne fanen)',
    lagret.due_soon === false && lagret.klient === false && lagret.aria === 'false',
    JSON.stringify(lagret));
  await p.click('#notif-settings-btn');
  await p.waitForTimeout(200);

  /* ---------- 5–6) Navigering og et slettet mål ---------- */
  await p.click('#notif-close');
  await p.waitForTimeout(200);
  await addNotifs(p, [
    { type: 'dueOver', obj_type: 'card', obj_id: id.C1, name: 'Skattemelding', at: Date.now() - 5000, value: '2026-06-14T12:00' },
    { type: 'dueOver', obj_type: 'card', obj_id: 'ffffffff-ffff-4fff-bfff-ffffffffffff', name: 'Borte', at: Date.now() - 9000, value: '2026-06-01' },
  ]);
  await cycle(p);
  await p.click('#notif-btn');
  await p.waitForTimeout(300);
  const medBorte = await rowsOf(p);
  const borte = medBorte.find((r) => r.name === 'Borte');
  log(label + ' 6a: en rad hvis mål er borte står fortsatt i historikken, merket som utilgjengelig',
    !!borte && borte.gone === true && borte.meta.indexOf('ikke tilgjengelig') > -1,
    JSON.stringify(borte));
  await p.click('#notif-body .notif-item .notif-row.is-gone');
  await p.waitForTimeout(400);
  const etterDødtKlikk = await p.evaluate(() => ({
    åpen: !document.getElementById('notif-modal').hidden,
    toast: (document.getElementById('toast') || {}).textContent || '',
  }));
  log(label + ' 6b: klikket verken feiler eller navigerer — modalen står, og beskjeden kommer',
    etterDødtKlikk.åpen === true && etterDødtKlikk.toast.indexOf('ikke tilgjengelig') > -1,
    JSON.stringify(etterDødtKlikk));

  await p.click('#notif-body .notif-item:not(:has(.is-gone)) .notif-row');
  await p.waitForFunction(() => document.getElementById('notif-modal').hidden, null, { timeout: 4000 });
  await p.waitForTimeout(900);
  const navigert = await p.evaluate((cid) => {
    const el = document.querySelector('.card[data-id="' + cid + '"]');
    return { finnes: !!el, markert: !!document.querySelector('.nav-flash') };
  }, id.C1);
  log(label + ' 5: trykk på en rad lukker modalen og navigerer til objektet',
    navigert.finnes && navigert.markert, JSON.stringify(navigert));

  /* ---------- 1d) «99+» ---------- */
  const mange = [];
  for (let i = 0; i < 120; i++) {
    mange.push({ type: 'dueOver', obj_type: 'card', obj_id: id.C1, name: 'Masse ' + i,
      at: Date.now() - 20000 - i * 1000, value: '2026-06-14T12:00' });
  }
  await addNotifs(p, mange);
  await cycle(p);
  const stor = await badgeInfo(p);
  log(label + ' 1d: svært mange uleste vises som «99+», og antallet står i navnet',
    stor.text === '99+' && /^Varsler, \d+ uleste$/.test(stor.label), JSON.stringify(stor));

  /* ---------- 11) Tastatur og fokus ---------- */
  await p.evaluate(() => document.getElementById('notif-btn').focus());
  await p.keyboard.press('Enter');
  await p.waitForTimeout(400);
  const fokusInne = await p.evaluate(() =>
    !!document.getElementById('notif-modal').contains(document.activeElement));
  log(label + ' 11a: fokus flyttes inn i modalen ved åpning', fokusInne === true, String(fokusInne));
  await p.keyboard.press('Escape');
  await p.waitForTimeout(400);
  const etterEscape = await p.evaluate(() => ({
    skjult: document.getElementById('notif-modal').hidden,
    fokus: document.activeElement && document.activeElement.id,
  }));
  log(label + ' 11b: Escape lukker, og fokus går tilbake til bjellen',
    etterEscape.skjult === true && etterEscape.fokus === 'notif-btn', JSON.stringify(etterEscape));

  log(label + ': ingen JS-feil', errs.length === 0, errs.join(' | '));
  await browser.close();
}

// Engelsk: hele flaten går gjennom ordboken (docs/sprak.md).
async function runEngelsk() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 },
    timezoneId: 'Europe/Oslo', locale: 'nb-NO' });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  console.log('\n== engelsk ==');
  const { id, uid, db } = buildDB();
  await seed(p, db, uid, 'en');
  await addNotifs(p, [{ type: 'dueOver', obj_type: 'card', obj_id: id.C1,
    name: 'Tax return', at: Date.now() - 60000, value: '2026-06-14T12:00' }]);
  await cycle(p);
  const knapp = await badgeInfo(p);
  await p.click('#notif-btn');
  await p.waitForTimeout(300);
  const tekst = await p.evaluate(() => ({
    tittel: document.getElementById('notif-modal-title').textContent.trim(),
    melding: document.querySelector('.notif-meta').textContent,
    tøm: document.getElementById('notif-clear').textContent,
  }));
  log('12a: knappens navn er engelsk', knapp.label === 'Notifications, 1 unread', knapp.label);
  log('12b: modalen er engelsk', tekst.tittel === 'Notifications' &&
    tekst.tøm === 'Clear notifications' && tekst.melding.indexOf('The deadline') === 0,
    JSON.stringify(tekst));
  await p.click('#notif-clear');
  await p.waitForTimeout(250);
  const undo = await p.evaluate(() => document.getElementById('notif-clear').textContent);
  log('12c: angre-nedtellingen er engelsk', undo === 'Undo · 10', undo);
  await p.click('#notif-settings-btn');
  await p.waitForTimeout(250);
  const prefs = await p.evaluate(() => [...document.querySelectorAll('#notif-body .menu-setting')]
    .map((r) => r.querySelector('.menu-setting-label span:last-child').textContent));
  log('12d: preferansene er engelske',
    eq(prefs, ['Deadline passed', 'Deadline in less than a week', 'Starting now', 'Starts in less than a week']),
    JSON.stringify(prefs));
  log('engelsk: ingen JS-feil', errs.length === 0, errs.join(' | '));
  await browser.close();
}

/* Kontobytte uten utlogging. Supabase kan gå rett fra én innlogget bruker til
   en annen uten et SIGNED_OUT imellom (`cloudStart` har en egen gren for det),
   og da må varselhistorikken byttes ut MED ÉN GANG — ikke først når den nye
   brukerens pull svarer. Serverforsinkelsen (`&lag=`) er hele poenget: den
   holder pullen i lufta mens vi ser etter, så det som måles er nullstillingen
   og ikke det nye svaret. */
async function runKontobytte() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 },
    timezoneId: 'Europe/Oslo', locale: 'nb-NO' });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  console.log('\n== kontobytte ==');

  // Fang klientinstansen appen bruker, så testen kan logge inn som en ANNEN
  // bruker i den samme fanen og få den ekte SIGNED_IN-hendelsen.
  await p.addInitScript(() => {
    let real = null;
    Object.defineProperty(window, 'HK_MOCK', {
      configurable: true,
      get() { return real; },
      set(v) {
        const orig = v.createClient;
        v.createClient = function () {
          const c = orig.apply(this, arguments);
          window.__client = c;
          return c;
        };
        real = v;
      },
    });
  });

  const { id, uid, db } = buildDB();
  await p.goto(BASE + '/?mock=1&lag=1200');
  await p.evaluate(({ db, uid }) => {
    localStorage.clear(); sessionStorage.clear();
    localStorage.setItem('hk-mock-db', JSON.stringify(db));
    sessionStorage.setItem('hk-mock-session', JSON.stringify({
      id: uid, email: 'm@x.no',
      user_metadata: { onboarding: { v: 3, status: 'done' },
        tips: { drag: true, trash: true, moveList: true, dragTrash: true } },
    }));
  }, { db, uid });
  await p.goto(BASE + '/?mock=1&lag=1200');
  await p.waitForFunction(() => {
    const H = window.__huskis;
    return H && H.authUser && H.lastMy && H.state.universes.length > 0;
  }, null, { timeout: 25000, polling: 200 });

  await addNotifs(p, [
    { type: 'dueOver', obj_type: 'card', obj_id: id.C1, name: 'Skattemelding',
      at: Date.now() - 60000, value: '2026-06-14T12:00' },
    { type: 'startNow', obj_type: 'card', obj_id: id.C2, name: 'Sykkeltur',
      at: Date.now() - 90000, value: '2026-06-10T08:00' },
  ]);
  await p.evaluate(() => window.__huskis.cloudCycle());
  await p.waitForFunction(() => window.__huskis.notifRows.length === 2, null,
    { timeout: 20000, polling: 200 });
  const før = await badgeInfo(p);
  log('13a: bruker A har to uleste varsler før byttet',
    før.hidden === false && før.text === '2', JSON.stringify(før));

  // Bytt konto uten å logge ut: den nye brukerens pull er på vei, men treg.
  await p.evaluate(() => window.__client.auth.signInWithPassword({ email: 'b@x.no', password: 'x' }));
  await p.waitForFunction(() => window.__huskis.authUser && window.__huskis.authUser.id === 'uB',
    null, { timeout: 8000, polling: 50 });
  const etter = await p.evaluate(() => ({
    rader: window.__huskis.notifRows.length,
    prefs: window.__huskis.notifPrefs,
    markør: window.__huskis.notifCursor,
    badge: document.getElementById('notif-badge').hidden,
    navn: document.getElementById('notif-btn').getAttribute('aria-label'),
    lastMy: !!window.__huskis.lastMy,
  }));
  log('13b: historikken er borte FØR den nye brukerens pull har svart',
    etter.rader === 0 && etter.prefs === null && etter.markør === null &&
    etter.badge === true && etter.navn === 'Varsler', JSON.stringify(etter));

  log('kontobytte: ingen JS-feil', errs.length === 0, errs.join(' | '));
  await browser.close();
}

(async () => {
  await run('desktop', { width: 1200, height: 900 }, false);
  await run('mobil', { width: 390, height: 780 }, true);
  await runEngelsk();
  await runKontobytte();
  const ok = results.filter(Boolean).length;
  console.log('\n==== ' + ok + '/' + results.length + ' PASS ====');
  process.exit(ok === results.length ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
