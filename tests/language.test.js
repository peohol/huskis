/*
  Nettlesertest for SPRÅKVALGET (norsk/engelsk) — autoritativt: docs/sprak.md.

  Dekker det ordbokstesten (tests/i18n.test.js) ikke ser: at valget faktisk
  slår gjennom i en ekte nettleser, på tvers av en omlasting og på tvers av
  enhet og konto.

    1. Uten et lagret valg starter appen på norsk (`<html lang="no">`), også
       med et engelsk nettleserspråk — standarden er norsk, ikke nettleserens.
    2. Språkvelgeren finnes på innloggingsskjermen, og et bytte der gjør hele
       innloggingen engelsk — og overlever en omlasting (enhetens valg).
    3. Innlogget: språkvelgeren i konto-modalen bytter HELE UI-et, inkludert
       tekst som bygges i JS (toppmeny, tomtilstand, objektmenyen) og tekst i
       maler (`<template>` → fromTemplate).
    4. Valget skrives til KONTOEN (`user_metadata.lang`), så det følger med til
       en annen enhet.
    5. Kontoen vinner over enheten: en konto som står på engelsk gjør appen
       engelsk selv om enheten står på norsk.
    6. Datoformatet følger språket («12. mai» mot «12 May»).

  ETT viewport: språkvalget avhenger verken av layout eller pekertype — det er
  ren logikk (tests/CLAUDE.md, «Viewport»). Hver kontroll i testen laster
  dessuten appen på nytt, og en omlasting er dyr; å kjøre den samme logikken to
  ganger ville doblet kjøretiden uten å dekke noe nytt.

  Kjør:
    python3 -m http.server 8000
    NODE_PATH=$(npm root -g) node tests/language.test.js
*/
const { chromium } = require(require('path').join(process.env.NODE_PATH || require('child_process').execSync('npm root -g').toString().trim(), 'playwright'));
const BASE = process.env.HUSKIS_URL || 'http://localhost:8000';

const results = [];
const log = (n, ok, x = '') => { results.push(ok); console.log((ok ? 'PASS' : 'FAIL') + ' — ' + n + (x ? '  [' + x + ']' : '')); };

const U = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
  const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
});

// Minimal fikstur: én bruker med ett område, én mappe og én liste med ett punkt
// som har en frist — nok til å se både bygget tekst og datoformatering.
function buildDB(meta) {
  const uid = 'u1', UA = U(), GA = U(), LA = U(), IA = U();
  const base = (x) => Object.assign({ trashed: false, locked: false, unlocked: false,
    invite_policy: 'inherit', collapsed: false, is_cat: false, cat_id: null,
    ts: 1, org: 'a', pos: 0, pos_ts: 1, pos_org: 'a' }, x);
  const mem = (on, role) => Object.assign(
    { id: U(), user_id: uid, universe_id: null, group_id: null, role, pos: 0, created_at: 1 }, on);
  return {
    ids: { uid, UA, GA, LA, IA },
    db: {
      _rolesBackfilled: true,
      profiles: [{ id: uid, email: 'a@x.no', display_name: 'Alice Eier', user_metadata: meta || {} }],
      passwords: { 'a@x.no': 'x' },
      universes: [base({ id: UA, owner_id: uid, name: 'Hjemme' })],
      groups: [base({ id: GA, owner_id: uid, universe_id: UA, name: 'Ukesplan' })],
      cards: [base({ id: LA, owner_id: uid, group_id: GA, title: 'Handleliste', k: true, p: true, lab_ts: 0, lab_org: '' })],
      // Databasekolonnen heter `due_at` (klientens `due`) — se mock-backend.js.
      items: [base({ id: IA, owner_id: uid, card_id: LA, text: 'Melk', due_at: '2031-05-12' })],
      memberships: [mem({ universe_id: UA }, 'owner')],
      share_invites: [], tombstones: [],
    },
  };
}

/* WEBFONTEN AVVISES I DENNE FILA. Den er dekorasjon (Google Fonts), men den
   ligger som et `<link rel="stylesheet">` i `<head>`, og et stilark som HENGER
   blokkerer kjøringen av skriptene under seg: siden kommer da ikke opp igjen
   før forespørselen har brukt opp timeouten sin. Alle andre testfiler laster
   siden én gang og merker det knapt; denne laster den på nytt for hvert eneste
   språkbytte, og ville ellers brukt minutter på å vente på en font ingenting
   her handler om. Ingen av appens EGNE forespørsler røres — hermetikken kommer
   fortsatt fra mock-backenden (tests/CLAUDE.md). */
const FONT_HOSTS = ['https://fonts.googleapis.com/**', 'https://fonts.gstatic.com/**'];

/* Et språkbytte laster appen på NYTT (docs/sprak.md). Ventingen går derfor på
   det NYE dokumentet — appens egne signaler — og aldri på klokka. */
const RELOAD_MS = 30000;
const waitForReload = (p, cond) =>
  p.waitForFunction(cond, null, { timeout: RELOAD_MS, polling: 200 });

// Seeder databasen + sesjonen og laster appen. `lang` er ENHETENS lagrede valg
// (null = ingen — appen skal da starte på standarden).
async function loadApp(page, db, lang, meta) {
  await page.goto(BASE + '/?mock=1');
  await page.evaluate(({ db, lang, meta }) => {
    localStorage.clear(); sessionStorage.clear();
    // Demoen og gest-tipsene slås av (tests/CLAUDE.md). Metadataen seedes i
    // BÅDE sesjonen og profilraden: profilen er mock-backendens varige kopi, og
    // en test som skriver metadata skal ikke se to ulike utgaver av den.
    const um = Object.assign({ onboarding: { v: 3, status: 'done' },
      tips: { drag: true, trash: true, moveList: true, dragTrash: true } }, meta || {});
    db.profiles[0].user_metadata = um;
    localStorage.setItem('hk-mock-db', JSON.stringify(db));
    if (lang) localStorage.setItem('huskis-lang', lang);
    sessionStorage.setItem('hk-mock-session', JSON.stringify({
      id: 'u1', email: 'a@x.no', user_metadata: um,
    }));
  }, { db, lang, meta });
  await page.goto(BASE + '/?mock=1');
  // Står kontoen på et annet språk enn enheten, laster appen seg selv på nytt
  // her — ventingen må tåle den ekstra runden.
  await page.waitForFunction(() => {
    const H = window.__huskis;
    return H && H.authUser && H.lastMy && H.state.universes.length > 0;
  }, null, { timeout: RELOAD_MS, polling: 200 });
}

const htmlLang = (p) => p.evaluate(() => document.documentElement.lang);

async function run(label, viewport, mobile) {
  const browser = await chromium.launch();
  // Engelsk nettleserspråk med vilje: standarden skal IKKE følge nettleseren.
  const ctx = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, locale: 'en-US' });
  for (const host of FONT_HOSTS) await ctx.route(host, (route) => route.abort());
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  console.log('\n== ' + label + ' ==');

  /* ---------- 1) Uten et lagret valg: norsk, tross engelsk nettleser ---------- */
  await p.setViewportSize(viewport);
  await p.goto(BASE + '/?mock=1');
  await p.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await p.goto(BASE + '/?mock=1');
  await p.waitForSelector('#auth-screen:not([hidden])', { timeout: 8000 });
  let heading = await p.locator('#auth-heading').textContent();
  log('1: standarden er norsk selv med engelsk nettleserspråk',
    heading.trim() === 'Logg inn' && (await htmlLang(p)) === 'no',
    JSON.stringify({ heading: heading.trim(), lang: await htmlLang(p) }));

  /* ---------- 2) Språkvelgeren på innloggingsskjermen ---------- */
  const opts = await p.locator('#auth-lang-select option').allTextContents();
  log('2: velgeren tilbyr Norsk og English', opts.join(',') === 'Norsk,English', opts.join(','));

  await p.selectOption('#auth-lang-select', 'en');
  await waitForReload(p, () => document.readyState === 'complete' && !!window.__huskis &&
    !document.getElementById('auth-screen').hidden && document.documentElement.lang === 'en');
  const authEn = await p.evaluate(() => ({
    heading: document.getElementById('auth-heading').textContent.trim(),
    submit: document.getElementById('auth-submit').textContent.trim(),
    email: document.getElementById('auth-email').placeholder,
    links: [...document.querySelectorAll('.auth-link')].map((b) => b.textContent.trim()),
    stored: localStorage.getItem('huskis-lang'),
  }));
  log('2: innloggingen er engelsk etter byttet',
    authEn.heading === 'Sign in' && authEn.submit === 'Sign in' &&
    authEn.email === 'you@example.com' &&
    authEn.links.join('|') === 'New here? Create an account|Forgot your password?',
    JSON.stringify(authEn));
  log('2: valget er lagret på enheten', authEn.stored === 'en', String(authEn.stored));

  // Overlever en omlasting (det er enhetens valg, ikke en variabel i minnet).
  await p.reload();
  await p.waitForSelector('#auth-screen:not([hidden])', { timeout: RELOAD_MS });
  log('2: valget overlever en omlasting',
    (await p.locator('#auth-heading').textContent()).trim() === 'Sign in' &&
    (await htmlLang(p)) === 'en');

  /* ---------- 3) Innlogget: konto-modalen bytter HELE UI-et ---------- */
  const { db } = buildDB();
  await loadApp(p, db, 'no');
  const noUi = await p.evaluate(() => {
    const H = window.__huskis;
    return {
      lang: document.documentElement.lang,
      addList: document.getElementById('add-card-btn').title,
      crumb: document.getElementById('nav-crumb').title,
      account: document.getElementById('account-btn').getAttribute('aria-label'),
      // Fra en <template>-klon (fromTemplate): teksten må være oversatt der òg.
      // Malen har «Meny» som utgangspunkt; labelCardControls() skriver over med
      // det presise navnet — begge veier må gjennom ordboken.
      cardMenu: document.querySelector('#board .card .obj-menu-btn').getAttribute('aria-label'),
      addItem: document.querySelector('#board .card .add-item-btn').title,
      check: document.querySelector('#board .item .item-check').getAttribute('aria-label'),
      state: H.state.universes.length,
    };
  });
  log('3: norsk før byttet',
    noUi.lang === 'no' && noUi.addList === 'Ny liste' &&
    noUi.cardMenu === 'Meny for listen «Handleliste»' &&
    noUi.addItem === 'Legg til listepunkt i «Handleliste»' &&
    noUi.check === 'Merk «Melk» som gjort',
    JSON.stringify(noUi));

  await p.evaluate(() => window.__huskis.openAccount());
  await p.waitForTimeout(250);
  const langRow = await p.evaluate(() => {
    const row = document.getElementById('menu-language');
    return { visible: !!row && !row.hidden,
             label: row.querySelector('.menu-setting-label span:last-child').textContent.trim(),
             icon: !!row.querySelector('#language-icon svg'),
             value: document.getElementById('lang-select').value };
  });
  log('3: språkraden i konto-modalen med ikon og gjeldende valg',
    langRow.visible && langRow.label === 'Språk' && langRow.icon && langRow.value === 'no',
    JSON.stringify(langRow));

  await p.selectOption('#lang-select', 'en');
  await waitForReload(p, () => {
    const H = window.__huskis;
    return document.readyState === 'complete' && H && H.authUser && H.lastMy &&
      H.state.universes.length > 0 && document.documentElement.lang === 'en';
  });
  const enUi = await p.evaluate(() => ({
    lang: document.documentElement.lang,
    addList: document.getElementById('add-card-btn').title,
    crumb: document.getElementById('nav-crumb').title,
    account: document.getElementById('account-btn').getAttribute('aria-label'),
    cardMenu: document.querySelector('#board .card .obj-menu-btn').getAttribute('aria-label'),
    addItem: document.querySelector('#board .card .add-item-btn').title,
    check: document.querySelector('#board .item .item-check').getAttribute('aria-label'),
  }));
  log('3: hele UI-et er engelsk etter byttet',
    enUi.lang === 'en' && enUi.addList === 'New list' &&
    enUi.crumb === 'Areas and folders – switch, edit and share' &&
    enUi.account === 'Open your account' &&
    enUi.cardMenu === 'Menu for the list “Handleliste”' &&
    enUi.addItem === 'Add item to “Handleliste”' &&
    enUi.check === 'Mark “Melk” as done',
    JSON.stringify(enUi));

  // Objektmenyen bygges i JS ved åpning — radene skal være engelske.
  await p.locator('#board .card .obj-menu-btn').first().click();
  await p.waitForTimeout(300);
  const rows = await p.locator('#obj-menu-panel .obj-menu-row .obj-menu-label').allTextContents();
  await p.keyboard.press('Escape');
  log('3: objektmenyens rader er engelske',
    rows.indexOf('Rename') > -1 && rows.indexOf('Delete the list') > -1 && rows.indexOf('Move') > -1,
    rows.join(' | '));

  /* ---------- 4) Valget er skrevet til KONTOEN ---------- */
  const savedMeta = await p.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('hk-mock-db'));
    return (raw.profiles[0].user_metadata || {}).lang;
  });
  log('4: user_metadata.lang er skrevet til kontoen', savedMeta === 'en', String(savedMeta));

  /* ---------- 6) Datoformatet følger språket ---------- */
  const dueEn = await p.locator('#board .item .meta-due').first().getAttribute('title');
  log('6: engelsk datoformat på frist-chipen', dueEn === 'Due: 12 May 2031', String(dueEn));

  /* ---------- 5) Kontoen vinner over enheten ---------- */
  const { db: db2 } = buildDB({ lang: 'en' });
  await loadApp(p, db2, 'no', { lang: 'en' });
  await waitForReload(p, () => {
    const H = window.__huskis;
    return document.readyState === 'complete' && H && H.authUser && H.lastMy && H.state.universes.length > 0 &&
      document.documentElement.lang === 'en';
  });
  const adopted = await p.evaluate(() => ({
    lang: document.documentElement.lang,
    device: localStorage.getItem('huskis-lang'),
    addList: document.getElementById('add-card-btn').title,
  }));
  log('5: kontoens språk vinner over enhetens, og skrives til enheten',
    adopted.lang === 'en' && adopted.device === 'en' && adopted.addList === 'New list',
    JSON.stringify(adopted));

  // …og norsk konto gir norsk app, med norsk datoformat.
  const { db: db3 } = buildDB({ lang: 'no' });
  await loadApp(p, db3, 'en', { lang: 'no' });
  await waitForReload(p, () => {
    const H = window.__huskis;
    return document.readyState === 'complete' && H && H.authUser && H.lastMy && H.state.universes.length > 0 &&
      document.documentElement.lang === 'no';
  });
  const dueNo = await p.locator('#board .item .meta-due').first().getAttribute('title');
  log('5/6: norsk konto gir norsk app og norsk datoformat',
    (await htmlLang(p)) === 'no' && dueNo === 'Frist: 12. mai 2031', String(dueNo));

  log(label + ': ingen JS-feil', errs.length === 0, errs.join(' | '));
  await browser.close();
}

(async () => {
  await run('desktop', { width: 1200, height: 900 }, false);
  const ok = results.filter(Boolean).length;
  console.log('\n==== ' + ok + '/' + results.length + ' PASS ====');
  process.exit(ok === results.length ? 0 : 1);
})();
