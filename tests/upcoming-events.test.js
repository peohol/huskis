/*
  Regresjonstest: HENDELSESMOTOREN bak «Kommende hendelser»
  (docs/kommende-hendelser.md). Modalen har sin egen fil
  (`events-modal.test.js`); her testes reglene.

  `collectUpcomingEvents(state, now)` er en ren funksjon av tilstand +
  tidspunkt, og `now` er EKSPLISITT. Den kjøres derfor gjennom
  `window.__huskis` med et fast `now` — da kan grensene testes nøyaktig, uten
  at testen begynner å feile fordi klokken har gått.

  Fikstur og «nå»: nettleseren står i Europe/Oslo, og NÅ er
  2026-06-15 kl. 12:00 lokal tid. Hvert kort isolerer én regel, fordi
  dedupliseringen er per liste.

  Dekker:
     1. Fullføringslogikk: tom liste/kategori er irrelevant, en der ALT er
        gjort er irrelevant, og minst ett uferdig listepunkt gjør forelderen
        aktiv igjen.
     2. Papirkurven er ute — slettet liste, slettet listepunkt.
     3. Fristgrensene, uttømmende og uten hull: utløpt, nøyaktig nå, under
        7 døgn, NØYAKTIG 7 døgn, under 30 døgn, NØYAKTIG 30 døgn, over 30 døgn.
     4. Startgrensene: har begynt (også nøyaktig nå), under 7 døgn, nøyaktig
        7 døgn, under 30 døgn, nøyaktig 30 døgn, senere.
     5. Sorteringen: lengst overskredet først, nærmest frist først, og sist
        påbegynt først blant de påbegynte.
     6. Tidsarv: listens lås har forrang for ALLE listepunkter, en kategoris
        lås gjelder dens egne, og et rent arvet tidspunkt gir ingen egen rad.
     7. Hierarkisk deduplisering for FRISTER, kombinasjonen liste → kategori →
        listepunkt: identisk frist skjules, tidligere egen frist vises, og en
        UTLØPT forelder dominerer barn som er utløpt av samme eller senere
        grunn — men ikke et barn som er enda mer overskredet.
     8. Starter dedupliseres IKKE som frister: et barn med egen, senere start
        vises selv om forelderen har begynt.
     9. Dato uten klokkeslett: start = døgnets begynnelse, frist = døgnets
        slutt — regnet i LOKAL veggtid. Sommertidsdøgnet 29. mars 2026 (23
        timer i Oslo) er beviset på at ingen del av kjeden går innom UTC.
    10. Tom tilstand: ingen tider satt → ingen hendelser.

  Kjør:
    python3 -m http.server 8000                        # fra repo-roten, i egen terminal
    NODE_PATH=$(npm root -g) node tests/upcoming-events.test.js
*/
const { chromium } = require('playwright');

const BASE = process.env.HUSKIS_URL || 'http://localhost:8000';
const results = [];
const log = (n, ok, x = '') => { results.push(ok); console.log((ok ? 'PASS' : 'FAIL') + ' — ' + n + (x !== '' ? '  [' + (typeof x === 'string' ? x : JSON.stringify(x)) + ']' : '')); };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const U = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
  const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
});

const KEYS = ['UA', 'GA',
  'LTOM', 'LFERDIG', 'LAKTIV', 'LGRENSE', 'LSTART', 'LLÅS', 'LKATLÅS',
  'LHIER', 'LIDENT', 'LDOM', 'LSTARTBARN', 'LDST', 'LSLETTET',
  'CLÅS', 'CHIER', 'CIDENT', 'CDOM', 'CTOM',
  'I01', 'I02', 'I03', 'I04', 'I05', 'I06', 'I07', 'I08', 'I09', 'I10',
  'I11', 'I12', 'I13', 'I14', 'I15', 'I16', 'I17', 'I18', 'I19', 'I20',
  'I21', 'I22', 'I23', 'I24', 'I25', 'I26', 'I27', 'I28', 'I29', 'I30', 'I31'];

/* Fikstur. NÅ = 2026-06-15 kl. 12:00.
     15.06 kl. 12:00 er NØYAKTIG nå
     22.06 kl. 12:00 er NØYAKTIG 7 døgn fram
     15.07 kl. 12:00 er NØYAKTIG 30 døgn fram */
function buildDB() {
  const uid = 'uH';
  const id = {};
  KEYS.forEach((k) => { id[k] = U(); });
  const base = (x) => Object.assign({
    trashed: false, locked: false, unlocked: false, invite_policy: 'inherit',
    collapsed: false, is_cat: false, cat_id: null,
    start_at: null, due_at: null, lock_times: false,
    ts: 1, org: 'h', pos: 0, pos_ts: 1, pos_org: 'h',
  }, x);
  const card = (i, t, e) => base(Object.assign(
    { id: i, owner_id: uid, group_id: id.GA, title: t, k: true, p: true, lab_ts: 0, lab_org: '' }, e || {}));
  const item = (i, c, t, e) => base(Object.assign(
    { id: i, owner_id: uid, card_id: c, text: t, done: false }, e || {}));

  return { id, uid, db: {
    _rolesBackfilled: true,
    profiles: [{ id: uid, email: 'h@x.no', display_name: 'Hendelse', user_metadata: {} }],
    passwords: { 'h@x.no': 'x' },
    universes: [base({ id: id.UA, owner_id: uid, name: 'Arbeid' })],
    groups: [base({ id: id.GA, owner_id: uid, universe_id: id.UA, name: 'Klinikk' })],
    cards: [
      // 1) Tom liste og liste der alt er gjort — begge har tider, ingen skal telle.
      card(id.LTOM, 'Tom', { due_at: '2026-06-20', start_at: '2026-06-10' }),
      card(id.LFERDIG, 'Ferdig', { pos: 1, due_at: '2026-06-20', start_at: '2026-06-10' }),
      card(id.LAKTIV, 'Aktiv', { pos: 2, due_at: '2026-06-20' }),
      // 3–5) Grensene. Listen har INGEN egne tider, så hvert listepunkt står alene.
      card(id.LGRENSE, 'Frister', { pos: 3 }),
      card(id.LSTART, 'Starter', { pos: 4 }),
      // 6) Arv: listens lås styrer alle, også de i kategori.
      card(id.LLÅS, 'Listelås', { pos: 5, due_at: '2026-06-19', start_at: '2026-06-12', lock_times: true }),
      card(id.LKATLÅS, 'Kategorilås', { pos: 6 }),
      // 7) Hierarki og dominans.
      card(id.LHIER, 'Hierarki', { pos: 7, due_at: '2026-06-21' }),
      card(id.LIDENT, 'Identisk', { pos: 8, due_at: '2026-06-21' }),
      card(id.LDOM, 'Dominans', { pos: 9, due_at: '2026-06-10' }),
      // 8) Start: barnets egen, senere start overlever at forelderen har begynt.
      card(id.LSTARTBARN, 'Startbarn', { pos: 10, start_at: '2026-06-01' }),
      // 9) Sommertid: 29. mars 2026 er 23 timer langt i Oslo.
      card(id.LDST, 'Sommertid', { pos: 11, due_at: '2026-03-29', start_at: '2026-03-29' }),
      // 2) Papirkurven.
      card(id.LSLETTET, 'Slettet liste', { pos: 12, due_at: '2026-06-16', trashed: true }),
    ],
    items: [
      // LFERDIG: alle avkrysset → listen er irrelevant.
      item(id.I01, id.LFERDIG, 'Gjort A', { done: true }),
      item(id.I02, id.LFERDIG, 'Gjort B', { pos: 1, done: true }),
      // LAKTIV: ett gjort, ett igjen → listen er aktiv.
      item(id.I03, id.LAKTIV, 'Gjort', { done: true }),
      item(id.I04, id.LAKTIV, 'Igjen', { pos: 1 }),
      // LGRENSE: fristgrensene, ett listepunkt per grense.
      item(id.I05, id.LGRENSE, 'Utløpt', { due_at: '2026-06-15T11:59' }),
      item(id.I06, id.LGRENSE, 'Nøyaktig nå', { pos: 1, due_at: '2026-06-15T12:00' }),
      item(id.I07, id.LGRENSE, 'Under sju', { pos: 2, due_at: '2026-06-22T11:59' }),
      item(id.I08, id.LGRENSE, 'Nøyaktig sju', { pos: 3, due_at: '2026-06-22T12:00' }),
      item(id.I09, id.LGRENSE, 'Over sju', { pos: 4, due_at: '2026-06-22T12:01' }),
      item(id.I28, id.LGRENSE, 'Nøyaktig tretti', { pos: 5, due_at: '2026-07-15T12:00' }),
      item(id.I29, id.LGRENSE, 'Over tretti', { pos: 6, due_at: '2026-07-16T12:00' }),
      item(id.I10, id.LGRENSE, 'Lengst overskredet', { pos: 7, due_at: '2026-06-01' }),
      // LSTART: startgrensene.
      item(id.I11, id.LSTART, 'Begynt før', { start_at: '2026-06-14T09:00' }),
      item(id.I12, id.LSTART, 'Begynner nå', { pos: 1, start_at: '2026-06-15T12:00' }),
      item(id.I13, id.LSTART, 'Under sju', { pos: 2, start_at: '2026-06-22T11:59' }),
      item(id.I14, id.LSTART, 'Nøyaktig sju', { pos: 3, start_at: '2026-06-22T12:00' }),
      item(id.I30, id.LSTART, 'Under tretti', { pos: 4, start_at: '2026-07-10' }),
      item(id.I31, id.LSTART, 'Nøyaktig tretti', { pos: 5, start_at: '2026-07-15T12:00' }),
      item(id.I15, id.LSTART, 'Senere', { pos: 6, start_at: '2026-07-20' }),
      // LLÅS: listens lås. Kategorien har egne tider (den låses ikke av listen).
      item(id.CLÅS, id.LLÅS, 'Kat i låst liste', { is_cat: true, due_at: '2026-06-17' }),
      item(id.I16, id.LLÅS, 'Låst medlem', { pos: 1, cat_id: id.CLÅS, due_at: '2026-06-16', start_at: '2026-06-13' }),
      item(id.I17, id.LLÅS, 'Låst løs', { pos: 2, due_at: '2026-06-18', start_at: '2026-06-14' }),
      // LKATLÅS: kategoriens lås gjelder KUN dens egne medlemmer.
      item(id.CTOM, id.LKATLÅS, 'Låsende kategori', { is_cat: true, due_at: '2026-06-17', lock_times: true }),
      item(id.I18, id.LKATLÅS, 'I kategorien', { pos: 1, cat_id: id.CTOM, due_at: '2026-06-16' }),
      item(id.I19, id.LKATLÅS, 'Utenfor kategorien', { pos: 2, due_at: '2026-06-18' }),
      // LHIER: liste 21.06 → kategori 19.06 → listepunkt 17.06, alle tre synlige.
      item(id.CHIER, id.LHIER, 'Kat tidligere', { is_cat: true, due_at: '2026-06-19' }),
      item(id.I20, id.LHIER, 'Punkt tidligst', { pos: 1, cat_id: id.CHIER, due_at: '2026-06-17' }),
      // Uten tider — finnes bare for at listen skal overleve at kategoriens
      // eneste medlem krysses av (punkt 1e).
      item(id.I27, id.LHIER, 'Løst punkt', { pos: 2 }),
      // LIDENT: alle tre har samme frist → bare listen.
      item(id.CIDENT, id.LIDENT, 'Kat identisk', { is_cat: true, due_at: '2026-06-21' }),
      item(id.I21, id.LIDENT, 'Punkt identisk', { pos: 1, cat_id: id.CIDENT, due_at: '2026-06-21' }),
      // LDOM: listen er utløpt (10.06). Kategori/punkt utløpt SENERE er
      // redundante; et punkt som er enda mer overskredet er det ikke.
      item(id.CDOM, id.LDOM, 'Kat senere utløpt', { is_cat: true, due_at: '2026-06-12' }),
      item(id.I22, id.LDOM, 'Punkt senere utløpt', { pos: 1, cat_id: id.CDOM, due_at: '2026-06-13' }),
      item(id.I23, id.LDOM, 'Punkt tidligere utløpt', { pos: 2, due_at: '2026-06-05' }),
      // LSTARTBARN: listen har begynt; barnet begynner først om tre dager.
      item(id.I24, id.LSTARTBARN, 'Egen senere start', { start_at: '2026-06-18' }),
      // LDST + papirkurv.
      item(id.I25, id.LDST, 'Sommertidspunkt'),
      item(id.I26, id.LSLETTET, 'I slettet liste', { due_at: '2026-06-16' }),
    ],
    memberships: [{ id: U(), user_id: uid, universe_id: id.UA, group_id: null, role: 'owner', pos: 0, created_at: 1 }],
    share_invites: [], tombstones: [],
  } };
}

// Hendelsene i én gruppe, eventuelt begrenset til ÉN liste (dedupliseringen er
// per liste, så en assertion om rekkefølge må kunne se bare den ene).
const rows = (p, kind, bucket, cardId) => p.evaluate(({ kind, bucket, cardId, now }) =>
  window.__huskis.collectUpcomingEvents(null, now)[kind][bucket]
    .filter((e) => !cardId || e.cardId === cardId)
    .map((e) => e.type + ':' + e.name),
{ kind, bucket, cardId: cardId || null, now: null });

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 1200, height: 900 },
    // Sommertidsbeviset i punkt 9 krever en sone som FAKTISK bytter.
    timezoneId: 'Europe/Oslo',
  });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));

  const { id, uid, db } = buildDB();
  await p.goto(BASE + '/?mock=1');
  await p.evaluate(({ db, uid }) => {
    localStorage.clear(); sessionStorage.clear();
    localStorage.setItem('hk-mock-db', JSON.stringify(db));
    sessionStorage.setItem('hk-mock-session', JSON.stringify({
      id: uid, email: 'h@x.no',
      user_metadata: { onboarding: { v: 3, status: 'done' }, tips: { drag: true, trash: true, moveList: true, dragTrash: true } },
    }));
  }, { db, uid });
  await p.goto(BASE + '/?mock=1');
  await p.waitForFunction(() => {
    const H = window.__huskis;
    return H && H.authUser && H.lastMy && H.state.universes.length > 0;
  }, null, { timeout: 15000, polling: 200 });

  // NÅ regnes i SIDEN, så det er den samme lokale veggtiden motoren bruker.
  const NOW = await p.evaluate(() => new Date(2026, 5, 15, 12, 0, 0, 0).getTime());
  await p.evaluate((now) => {
    // Ett fast `now` for hele filen — hjelperen under sender null videre.
    const orig = window.__huskis.collectUpcomingEvents;
    window.__huskis.collectUpcomingEvents = (st, n) => orig(st, n == null ? now : n);
  }, NOW);

  const alle = (kind, bucket, cardId) => rows(p, kind, bucket, cardId);

  /* ---------- 1) Fullføringslogikk ---------- */
  const alleDue = await p.evaluate(() => {
    const d = window.__huskis.collectUpcomingEvents(null, null);
    return ['over', 'soon', 'month', 'far'].reduce((a, b) => a.concat(d.due[b].map((e) => e.type + ':' + e.name)), []);
  });
  log('1a: en TOM liste gir ingen hendelse, selv med frist',
    !alleDue.includes('card:Tom'), JSON.stringify(alleDue.filter((x) => x.indexOf('Tom') > -1)));
  log('1b: en liste der ALT er gjort gir ingen hendelse',
    !alleDue.includes('card:Ferdig'), JSON.stringify(alleDue.filter((x) => x.indexOf('Ferdig') > -1)));
  log('1c: minst ett uferdig listepunkt gjør listen aktiv',
    alleDue.includes('card:Aktiv'), JSON.stringify(alleDue));
  const katTom = await p.evaluate(() => {
    const H = window.__huskis;
    // Kryss av det ene medlemmet: kategorien har da ingen aktive barn igjen.
    const kort = H.state.universes[0].groups[0].cards.find((c) => c.title === 'Hierarki');
    const punkt = kort.items.find((it) => it.text === 'Punkt tidligst');
    punkt.done = true;
    const d = H.collectUpcomingEvents(null, null);
    const navn = ['over', 'soon', 'month', 'far'].reduce((a, b) => a.concat(d.due[b].map((e) => e.type + ':' + e.name)), []);
    punkt.done = false;
    return navn;
  });
  log('1d: en kategori uten aktive medlemmer er irrelevant',
    !katTom.includes('category:Kat tidligere'), JSON.stringify(katTom.filter((x) => x.indexOf('Kat tidligere') > -1)));
  log('1e: men listen over den er fortsatt aktiv (den har flere listepunkter)',
    katTom.includes('card:Hierarki'), JSON.stringify(katTom));

  /* ---------- 2) Papirkurven ---------- */
  log('2: slettet liste (og alt i den) er ute',
    !alleDue.some((x) => x.indexOf('Slettet') > -1 || x.indexOf('I slettet liste') > -1),
    JSON.stringify(alleDue));

  /* ---------- 3) Fristgrensene ---------- */
  const fOver = await alle('due', 'over', id.LGRENSE);
  const fSoon = await alle('due', 'soon', id.LGRENSE);
  const fMonth = await alle('due', 'month', id.LGRENSE);
  const fFar = await alle('due', 'far', id.LGRENSE);
  log('3a: frist FØR nå er utløpt', eq(fOver, ['item:Lengst overskredet', 'item:Utløpt']), JSON.stringify(fOver));
  log('3b: frist NØYAKTIG nå er ikke utløpt — den er innen en uke',
    fSoon[0] === 'item:Nøyaktig nå', JSON.stringify(fSoon));
  log('3c: under 7 døgn ligger i «innen en uke»',
    eq(fSoon, ['item:Nøyaktig nå', 'item:Under sju']), JSON.stringify(fSoon));
  log('3d: NØYAKTIG 7 døgn faller i «innen en måned» — ingen hull i grensen',
    fMonth[0] === 'item:Nøyaktig sju', JSON.stringify(fMonth));
  log('3e: over 7 døgn ligger samme sted', eq(fMonth, ['item:Nøyaktig sju', 'item:Over sju']), JSON.stringify(fMonth));
  log('3f: NØYAKTIG 30 døgn faller i «om mer enn en måned» — samme slag grense som ukas',
    fFar[0] === 'item:Nøyaktig tretti', JSON.stringify(fFar));
  log('3g: over 30 døgn ligger samme sted',
    eq(fFar, ['item:Nøyaktig tretti', 'item:Over tretti']), JSON.stringify(fFar));

  /* ---------- 4) Startgrensene ---------- */
  const sStart = await alle('start', 'started', id.LSTART);
  const sSoon = await alle('start', 'soon', id.LSTART);
  const sMonth = await alle('start', 'month', id.LSTART);
  const sFar = await alle('start', 'far', id.LSTART);
  log('4a: start NØYAKTIG nå HAR begynt (motsatt av fristen ved samme grense)',
    sStart.includes('item:Begynner nå'), JSON.stringify(sStart));
  log('4b: under 7 døgn begynner «innen en uke»', eq(sSoon, ['item:Under sju']), JSON.stringify(sSoon));
  log('4c: NØYAKTIG 7 døgn faller i «innen en måned»',
    sMonth[0] === 'item:Nøyaktig sju', JSON.stringify(sMonth));
  log('4d: under 30 døgn ligger samme sted',
    eq(sMonth, ['item:Nøyaktig sju', 'item:Under tretti']), JSON.stringify(sMonth));
  log('4e: NØYAKTIG 30 døgn og senere begynner «om mer enn en måned»',
    eq(sFar, ['item:Nøyaktig tretti', 'item:Senere']), JSON.stringify(sFar));

  /* ---------- 5) Sortering ---------- */
  log('5a: lengst overskredet først', eq(fOver, ['item:Lengst overskredet', 'item:Utløpt']), JSON.stringify(fOver));
  log('5b: nærmest frist først', eq(fSoon, ['item:Nøyaktig nå', 'item:Under sju']), JSON.stringify(fSoon));
  log('5c: sist påbegynt først blant de påbegynte',
    eq(sStart, ['item:Begynner nå', 'item:Begynt før']), JSON.stringify(sStart));

  /* ---------- 6) Tidsarv ---------- */
  const låsDue = await p.evaluate((cid) => {
    const d = window.__huskis.collectUpcomingEvents(null, null);
    return ['over', 'soon', 'month', 'far'].reduce((a, b) => a.concat(
      d.due[b].filter((e) => e.cardId === cid).map((e) => e.type + ':' + e.name + (e.own ? '' : '(arv)'))), []);
  }, id.LLÅS);
  log('6a: listens lås styrer ALLE listepunktene — også de i kategori',
    !låsDue.includes('item:Låst medlem') && !låsDue.includes('item:Låst løs'), JSON.stringify(låsDue));
  log('6b: listen selv står igjen som den ene hendelsen for tiden sin',
    låsDue.includes('card:Listelås'), JSON.stringify(låsDue));
  log('6c: en kategori låses IKKE av listen — den har fortsatt egen frist',
    låsDue.includes('category:Kat i låst liste'), JSON.stringify(låsDue));
  const katLåsDue = await p.evaluate((cid) => {
    const d = window.__huskis.collectUpcomingEvents(null, null);
    return ['over', 'soon', 'month', 'far'].reduce((a, b) => a.concat(
      d.due[b].filter((e) => e.cardId === cid).map((e) => e.type + ':' + e.name)), []);
  }, id.LKATLÅS);
  log('6d: kategoriens lås gjelder KUN dens egne medlemmer',
    !katLåsDue.includes('item:I kategorien') && katLåsDue.includes('item:Utenfor kategorien'),
    JSON.stringify(katLåsDue));
  log('6e: det rent arvede tidspunktet representeres av kategorien',
    katLåsDue.includes('category:Låsende kategori'), JSON.stringify(katLåsDue));

  /* ---------- 7) Hierarkisk deduplisering for frister ---------- */
  const hier = await p.evaluate((cid) => {
    const d = window.__huskis.collectUpcomingEvents(null, null);
    return ['over', 'soon', 'month', 'far'].reduce((a, b) => a.concat(
      d.due[b].filter((e) => e.cardId === cid).map((e) => e.type + ':' + e.name)), []);
  }, id.LHIER);
  log('7a: liste → kategori → listepunkt med hver sin TIDLIGERE frist: alle tre vises',
    eq(hier.slice().sort(), ['card:Hierarki', 'category:Kat tidligere', 'item:Punkt tidligst'].sort()),
    JSON.stringify(hier));
  const ident = await alle('due', 'soon', id.LIDENT);
  log('7b: identisk frist på alle tre nivåene gir KUN listehendelsen',
    eq(ident, ['card:Identisk']), JSON.stringify(ident));
  const dom = await alle('due', 'over', id.LDOM);
  log('7c: en UTLØPT liste dominerer kategori/listepunkt som er utløpt senere',
    !dom.includes('category:Kat senere utløpt') && !dom.includes('item:Punkt senere utløpt'),
    JSON.stringify(dom));
  log('7d: men et listepunkt som er ENDA MER overskredet bryter ut, og står først',
    eq(dom, ['item:Punkt tidligere utløpt', 'card:Dominans']), JSON.stringify(dom));

  /* ---------- 8) Starter dedupliseres ikke som frister ---------- */
  const sBarn = await p.evaluate((cid) => {
    const d = window.__huskis.collectUpcomingEvents(null, null);
    return ['started', 'soon', 'month', 'far'].reduce((a, b) => a.concat(
      d.start[b].filter((e) => e.cardId === cid).map((e) => b + '/' + e.type + ':' + e.name)), []);
  }, id.LSTARTBARN);
  log('8: et barn med EGEN, senere start vises selv om listen har begynt — og det er ikke «begynt»',
    eq(sBarn.slice().sort(), ['soon/item:Egen senere start', 'started/card:Startbarn'].sort()),
    JSON.stringify(sBarn));

  /* ---------- 9) Dato uten klokkeslett, i lokal veggtid ---------- */
  const dst = await p.evaluate((cid) => {
    const d = window.__huskis.collectUpcomingEvents(null, null);
    const due = d.due.over.find((e) => e.cardId === cid && e.type === 'card');
    const start = d.start.started.find((e) => e.cardId === cid && e.type === 'card');
    return {
      due: due && due.at, start: start && start.at,
      ventetStart: new Date(2026, 2, 29, 0, 0, 0, 0).getTime(),
      ventetDue: new Date(2026, 2, 29, 23, 59, 59, 999).getTime(),
    };
  }, id.LDST);
  log('9a: startdato uten klokkeslett er døgnets BEGYNNELSE, lokalt',
    dst.start === dst.ventetStart, JSON.stringify(dst));
  log('9b: fristdato uten klokkeslett er døgnets SLUTT, lokalt',
    dst.due === dst.ventetDue, JSON.stringify(dst));
  log('9c: sommertidsdøgnet 29. mars 2026 er 23 timer i Oslo — altså ingen UTC-omvei',
    dst.due - dst.start === 23 * 60 * 60 * 1000 - 1, (dst.due - dst.start) + ' ms');

  /* ---------- 10) Tom tilstand ---------- */
  const tomt = await p.evaluate(() => {
    const H = window.__huskis;
    const rydd = [];
    H.state.universes.forEach((u) => (u.groups || []).forEach((g) => (g.cards || []).forEach((c) => {
      rydd.push([c, c.start, c.due]);
      c.start = null; c.due = null;
      (c.items || []).forEach((it) => { rydd.push([it, it.start, it.due]); it.start = null; it.due = null; });
    })));
    const d = H.collectUpcomingEvents(null, null);
    rydd.forEach(([o, s, u]) => { o.start = s; o.due = u; });
    return d.total;
  });
  log('10: ingen tider satt → ingen hendelser', tomt === 0, tomt);

  log('ingen JS-feil', errs.length === 0, errs.join(' | '));
  await browser.close();

  const ok = results.filter(Boolean).length;
  console.log('\n==== ' + ok + '/' + results.length + ' PASS ====');
  process.exit(ok === results.length ? 0 : 1);
})();
