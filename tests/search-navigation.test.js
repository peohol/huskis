/*
  Regresjonstest: SØKEMODALEN og navigeringen til et objekt
  (docs/sok-og-navigering.md). Rangeringen har sin egen fil
  (`search-ranking.test.js`); her testes veien fra knappen til at brukeren
  faktisk står ved objektet.

  Dekker:
     1. Søkeknappen er skjult før innlogging og synlig etter.
     2. Modalen åpner med fokus i feltet, tomtilstand og ingen resultatdump.
     3. Treffene viser type + kontekststi, så to objekter med samme navn i
        ulike mapper er til å skille fra hverandre.
     4. Tastatur: pil ned/opp flytter det aktive treffet (med
        `aria-activedescendant` og `aria-selected`), og listen går rundt.
     5. Enter åpner det aktive treffet — og lander på riktig ID når to objekter
        heter det samme.
     6. Escape lukker modalen og gir fokus tilbake til søkeknappen.
     7. Museklikk på en rad gjør det samme som Enter.
     8. Område: lukker søket, åpner nav-modalen, peker ut kortet — og velger
        IKKE en mappe i det.
     9. Mappe: bytter område + mappe, lukker nav-modalen, markerer breadcrumben.
    10. Liste i en ANNEN mappe: navigerer, ruller kortet inn i visningen og
        markerer det.
    11. Listepunkt i en KOLLAPSET liste og en KOLLAPSET kategori: begge foldes
        ut, målet rulles inn i visningen, fokuseres og markeres.
    12. Et ferdig (avkrysset) listepunkt kan navigeres til.
    13. Et mål som ikke finnes lenger gir en beskjed i stedet for en krasj.
    14. i18n: modalen finnes på både norsk og engelsk.
    15. `prefers-reduced-motion`: markeringen pulserer ikke og rullingen er
        momentan — men målet havner like riktig, og ringen står der.

  Kjøres på BÅDE desktop- og mobil-viewport: modalen, rullingen og
  board-kolonnene oppfører seg ulikt over og under 560 px.

  Kjør:
    python3 -m http.server 8000                        # fra repo-roten, i egen terminal
    NODE_PATH=$(npm root -g) node tests/search-navigation.test.js
*/
const { chromium } = require('playwright');

const BASE = process.env.HUSKIS_URL || 'http://localhost:8000';
const results = [];
const log = (n, ok, x = '') => { results.push(ok); console.log((ok ? 'PASS' : 'FAIL') + ' — ' + n + (x ? '  [' + x + ']' : '')); };

const U = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
  const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
});

/* Fikstur:
     Arbeid  > Klinikk        > Vaktdager (KOLLAPSET)
                                  September (kategori, KOLLAPSET) > Mandag
                                  Fredag
             > Administrasjon > Vaktdager (samme navn!) > Mandag (samme navn!)
     Hjemme  > Kjøkkenet      > Handleliste > Melk, Makrell (FERDIG) */
function buildDB(lang) {
  const uid = 'uN';
  const id = {};
  ['UA', 'UB', 'GA', 'GB', 'GC', 'L1', 'L2', 'L3',
    'C1', 'I1', 'I2', 'I3', 'I4', 'I5'].forEach((k) => { id[k] = U(); });
  const base = (x) => Object.assign({
    trashed: false, locked: false, unlocked: false, invite_policy: 'inherit',
    collapsed: false, is_cat: false, cat_id: null,
    ts: 1, org: 'n', pos: 0, pos_ts: 1, pos_org: 'n',
  }, x);
  const uni = (i, name, extra) => base(Object.assign({ id: i, owner_id: uid, name }, extra || {}));
  const grp = (i, u, name, extra) => base(Object.assign({ id: i, owner_id: uid, universe_id: u, name }, extra || {}));
  const card = (i, g, title, extra) => base(Object.assign(
    { id: i, owner_id: uid, group_id: g, title, k: true, p: true, lab_ts: 0, lab_org: '' }, extra || {}));
  const item = (i, c, text, extra) => base(Object.assign(
    { id: i, owner_id: uid, card_id: c, text, done: false }, extra || {}));
  const mem = (on, role, pos) => Object.assign(
    { id: U(), user_id: uid, universe_id: null, group_id: null, role, pos: pos || 0, created_at: 1 }, on);
  const meta = { onboarding: { v: 3, status: 'done' }, tips: { drag: true, trash: true, moveList: true, dragTrash: true } };
  if (lang) meta.lang = lang;
  return { id, uid, meta, db: {
    _rolesBackfilled: true,
    profiles: [{ id: uid, email: 'n@x.no', display_name: 'Navigatør', user_metadata: meta }],
    passwords: { 'n@x.no': 'x' },
    universes: [uni(id.UA, 'Arbeid'), uni(id.UB, 'Hjemme', { pos: 1 })],
    groups: [
      grp(id.GA, id.UA, 'Klinikk'),
      grp(id.GB, id.UA, 'Administrasjon', { pos: 1 }),
      grp(id.GC, id.UB, 'Kjøkkenet'),
    ],
    cards: [
      card(id.L1, id.GA, 'Vaktdager', { collapsed: true }),
      card(id.L2, id.GB, 'Vaktdager'),
      card(id.L3, id.GC, 'Handleliste'),
    ],
    items: [
      item(id.C1, id.L1, 'September', { is_cat: true, collapsed: true }),
      item(id.I1, id.L1, 'Mandag', { pos: 1, cat_id: id.C1 }),
      item(id.I2, id.L1, 'Fredag', { pos: 2 }),
      item(id.I3, id.L2, 'Mandag'),
      item(id.I4, id.L3, 'Melk'),
      item(id.I5, id.L3, 'Makrell', { pos: 1, done: true }),
    ],
    memberships: [mem({ universe_id: id.UA }, 'owner', 0), mem({ universe_id: id.UB }, 'owner', 1)],
    share_invites: [], tombstones: [],
  } };
}

async function seedAndLoad(p, fx) {
  await p.goto(BASE + '/?mock=1');
  await p.evaluate(({ db, uid, meta }) => {
    localStorage.clear(); sessionStorage.clear();
    localStorage.setItem('hk-mock-db', JSON.stringify(db));
    sessionStorage.setItem('hk-mock-session', JSON.stringify({ id: uid, email: 'n@x.no', user_metadata: meta }));
  }, { db: fx.db, uid: fx.uid, meta: fx.meta });
  await p.goto(BASE + '/?mock=1');
  await p.waitForFunction(() => {
    const H = window.__huskis;
    return H && H.authUser && H.lastMy && H.state.universes.length > 0;
  }, null, { timeout: 15000, polling: 200 });
  await p.waitForTimeout(200);
}

// Radene i resultatlisten: navn, meta-linje og om raden er aktiv.
const rows = (p) => p.evaluate(() => [...document.querySelectorAll('.search-result')].map((r) => ({
  id: r.dataset.id, type: r.dataset.type,
  name: r.querySelector('.search-result-name').textContent,
  meta: r.querySelector('.search-result-meta').textContent,
  active: r.classList.contains('is-active'),
  selected: r.getAttribute('aria-selected'),
})));

// Er elementet innenfor viewportet?
const inView = (p, sel) => p.evaluate((s) => {
  const el = document.querySelector(s);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { top: Math.round(r.top), bottom: Math.round(r.bottom), vh: window.innerHeight,
    ok: r.top >= 0 && r.bottom <= window.innerHeight };
}, sel);

// Åpne søket og skriv `q`.
async function search(p, q) {
  await p.locator('#search-btn').click();
  await p.waitForFunction(() => !document.getElementById('search-modal').hidden, null, { timeout: 4000 });
  await p.waitForTimeout(120);
  if (q) { await p.keyboard.type(q); await p.waitForTimeout(150); }
}

async function run(label, viewport, mobile) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext(Object.assign({ viewport }, mobile ? { isMobile: true, hasTouch: true } : {}));
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  console.log('\n== ' + label + ' ==');
  const fx = buildDB();

  /* ---------- 1) Skjult før innlogging ---------- */
  await p.goto(BASE + '/?mock=1');
  await p.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await p.goto(BASE + '/?mock=1');
  await p.waitForTimeout(700);
  log(label + ' 1a: søkeknappen er skjult før innlogging',
    !(await p.locator('#search-btn').isVisible()),
    'body: ' + await p.evaluate(() => document.body.className));

  await seedAndLoad(p, fx);
  log(label + ' 1b: søkeknappen er synlig etter innlogging', await p.locator('#search-btn').isVisible());

  /* ---------- 2) Åpning: fokus, tomtilstand ---------- */
  await search(p, '');
  const åpen = await p.evaluate(() => ({
    focus: document.activeElement && document.activeElement.id,
    verdi: document.getElementById('search-input').value,
    hint: !document.getElementById('search-hint').hidden,
    treff: document.querySelectorAll('.search-result').length,
    expanded: document.getElementById('search-input').getAttribute('aria-expanded'),
    rolle: document.querySelector('#search-modal .modal').getAttribute('role'),
    modal: document.querySelector('#search-modal .modal').getAttribute('aria-modal'),
    listbox: document.getElementById('search-results').getAttribute('role'),
  }));
  log(label + ' 2a: fokus lander i søkefeltet', åpen.focus === 'search-input', åpen.focus);
  log(label + ' 2b: feltet er tomt og hintet vises', åpen.verdi === '' && åpen.hint, JSON.stringify(åpen));
  log(label + ' 2c: tom søketekst gir ingen resultatdump', åpen.treff === 0, String(åpen.treff));
  log(label + ' 2d: dialog- og listbox-semantikken er på plass',
    åpen.rolle === 'dialog' && åpen.modal === 'true' && åpen.listbox === 'listbox' && åpen.expanded === 'false',
    JSON.stringify(åpen));

  /* ---------- 3) Kontekststi skiller like navn ---------- */
  await p.keyboard.type('vaktdager');
  await p.waitForTimeout(150);
  let r = await rows(p);
  log(label + ' 3a: begge listene med samme navn er med', r.length === 2, JSON.stringify(r.map((x) => x.name)));
  log(label + ' 3b: kontekststien skiller dem',
    r.length === 2 && r[0].meta.indexOf('Administrasjon') > -1 && r[1].meta.indexOf('Klinikk') > -1,
    JSON.stringify(r.map((x) => x.meta)));
  log(label + ' 3c: typen står i klartekst i raden',
    r.every((x) => x.meta.indexOf('Liste') === 0), JSON.stringify(r.map((x) => x.meta)));

  /* ---------- 4) Tastaturnavigasjon ---------- */
  log(label + ' 4a: første treff er aktivt fra start', r[0].active && r[0].selected === 'true');
  const aktivId = () => p.evaluate(() => document.getElementById('search-input').getAttribute('aria-activedescendant'));
  log(label + ' 4b: aria-activedescendant peker på det aktive treffet',
    (await aktivId()) === 'search-opt-0', await aktivId());
  await p.keyboard.press('ArrowDown'); await p.waitForTimeout(80);
  r = await rows(p);
  log(label + ' 4c: pil ned flytter det aktive treffet',
    r[1].active && r[1].selected === 'true' && !r[0].active && (await aktivId()) === 'search-opt-1');
  await p.keyboard.press('ArrowDown'); await p.waitForTimeout(80);
  log(label + ' 4d: listen går rundt på siste', (await aktivId()) === 'search-opt-0');
  await p.keyboard.press('ArrowUp'); await p.waitForTimeout(80);
  log(label + ' 4e: pil opp går motsatt vei (og rundt)', (await aktivId()) === 'search-opt-1');

  /* ---------- 5 + 10) Enter åpner riktig ID i en annen mappe ---------- */
  // Rad 1 er «Vaktdager» i Klinikk (rad 0 er Administrasjon, alfabetisk på sti).
  const målKort = r[1].id;
  await p.keyboard.press('Enter');
  await p.waitForTimeout(900);
  const etter = await p.evaluate((mål) => {
    const H = window.__huskis;
    const el = document.querySelector('.card:not(.uni-card)[data-id="' + mål + '"] > .card-head');
    const g = H.state.universes.flatMap((u) => u.groups).find((x) => x.id === H.state.activeGroup);
    return {
      lukket: document.getElementById('search-modal').hidden,
      gruppe: g ? g.name : null,
      finnes: !!el,
      flash: !!el && el.classList.contains('nav-flash'),
      fokus: !!el && document.activeElement === el,
      crumb: document.getElementById('crumb-group-name').textContent,
    };
  }, målKort);
  log(label + ' 5a: modalen lukket seg', etter.lukket);
  log(label + ' 10a: navigeringen byttet til riktig mappe',
    etter.gruppe === 'Klinikk' && etter.crumb === 'Klinikk', JSON.stringify(etter));
  log(label + ' 10b: målkortet er markert og fokusert', etter.finnes && etter.flash && etter.fokus, JSON.stringify(etter));
  const kortSyn = await inView(p, '.card:not(.uni-card)[data-id="' + målKort + '"] > .card-head');
  log(label + ' 10c: kortet er rullet inn i visningen', kortSyn && kortSyn.ok, JSON.stringify(kortSyn));

  /* ---------- 6) Escape lukker og gir fokus tilbake ---------- */
  await search(p, 'melk');
  await p.keyboard.press('Escape');
  await p.waitForTimeout(300);
  const esc = await p.evaluate(() => ({
    lukket: document.getElementById('search-modal').hidden,
    fokus: document.activeElement && document.activeElement.id,
  }));
  log(label + ' 6: Escape lukker, og fokus er tilbake på søkeknappen',
    esc.lukket && esc.fokus === 'search-btn', JSON.stringify(esc));

  /* ---------- 8) Område: nav-modalen, uten å velge mappe ---------- */
  const førUni = await p.evaluate(() => ({ u: window.__huskis.state.activeUniverse, g: window.__huskis.state.activeGroup }));
  await search(p, 'hjemme');
  await p.keyboard.press('Enter');
  await p.waitForTimeout(900);
  const uni = await p.evaluate((ub) => {
    const H = window.__huskis;
    const head = document.querySelector('.uni-card[data-id="' + ub + '"] > .card-head');
    return {
      nav: !document.getElementById('nav-modal').hidden,
      søk: document.getElementById('search-modal').hidden,
      finnes: !!head,
      flash: !!head && head.classList.contains('nav-flash'),
      fokus: !!head && document.activeElement === head,
      u: H.state.activeUniverse, g: H.state.activeGroup,
    };
  }, fx.id.UB);
  log(label + ' 8a: søket lukket seg og nav-modalen åpnet seg', uni.søk && uni.nav, JSON.stringify(uni));
  log(label + ' 8b: områdekortet er markert og fokusert', uni.finnes && uni.flash && uni.fokus, JSON.stringify(uni));
  log(label + ' 8c: ingen mappe ble valgt automatisk',
    uni.u === førUni.u && uni.g === førUni.g, JSON.stringify({ før: førUni, etter: { u: uni.u, g: uni.g } }));
  const uniSyn = await p.evaluate((ub) => {
    const head = document.querySelector('.uni-card[data-id="' + ub + '"] > .card-head');
    const box = document.getElementById('nav-modal-body').getBoundingClientRect();
    const r = head.getBoundingClientRect();
    return { ok: r.top >= box.top - 1 && r.bottom <= box.bottom + 1, r: Math.round(r.top), box: Math.round(box.top) };
  }, fx.id.UB);
  log(label + ' 8d: kortet er rullet inn i modalens synlige felt', uniSyn.ok, JSON.stringify(uniSyn));
  await p.keyboard.press('Escape');
  await p.waitForTimeout(250);

  /* ---------- 9) Mappe i et annet område ---------- */
  await search(p, 'kjøkkenet');
  await p.keyboard.press('Enter');
  await p.waitForTimeout(900);
  const mappe = await p.evaluate(() => {
    const H = window.__huskis;
    const crumb = document.getElementById('nav-crumb');
    return {
      nav: document.getElementById('nav-modal').hidden,
      u: H.state.activeUniverse, g: H.state.activeGroup,
      uniNavn: document.getElementById('crumb-uni-name').textContent,
      grpNavn: document.getElementById('crumb-group-name').textContent,
      flash: crumb.classList.contains('nav-flash'),
    };
  });
  log(label + ' 9a: mappenavigeringen byttet både område og mappe',
    mappe.u === fx.id.UB && mappe.g === fx.id.GC, JSON.stringify(mappe));
  log(label + ' 9b: breadcrumben viser den nye posisjonen og er markert',
    mappe.uniNavn === 'Hjemme' && mappe.grpNavn === 'Kjøkkenet' && mappe.flash && mappe.nav,
    JSON.stringify(mappe));

  /* ---------- 11) Listepunkt i kollapset liste OG kollapset kategori ---------- */
  const førKollaps = await p.evaluate((ids) => {
    const H = window.__huskis;
    const c = H.state.universes.flatMap((u) => u.groups).flatMap((g) => g.cards || []).find((x) => x.id === ids.L1);
    const cat = c.items.find((x) => x.id === ids.C1);
    return { kort: !!c.collapsed, kat: !!cat.collapsed };
  }, fx.id);
  log(label + ' 11a: lista OG kategorien er kollapset før navigeringen',
    førKollaps.kort && førKollaps.kat, JSON.stringify(førKollaps));
  await search(p, 'mandag');
  // To «Mandag»: velg den som ligger under September (Klinikk-lista).
  const idx = (await rows(p)).findIndex((x) => x.meta.indexOf('September') > -1);
  for (let i = 0; i < idx; i++) { await p.keyboard.press('ArrowDown'); await p.waitForTimeout(60); }
  await p.keyboard.press('Enter');
  await p.waitForTimeout(1000);
  const punkt = await p.evaluate((ids) => {
    const H = window.__huskis;
    const c = H.state.universes.flatMap((u) => u.groups).flatMap((g) => g.cards || []).find((x) => x.id === ids.L1);
    const cat = c.items.find((x) => x.id === ids.C1);
    const el = document.querySelector('.item[data-id="' + ids.I1 + '"]');
    const r = el ? el.getBoundingClientRect() : null;
    return {
      g: H.state.activeGroup, kort: !!c.collapsed, kat: !!cat.collapsed,
      finnes: !!el, flash: !!el && el.classList.contains('nav-flash'),
      fokus: !!el && document.activeElement === el,
      iSyne: !!r && r.top >= 0 && r.bottom <= window.innerHeight,
      domKollapset: !!document.querySelector('.card[data-id="' + ids.L1 + '"].collapsed'),
    };
  }, fx.id);
  log(label + ' 11b: navigeringen gikk til riktig mappe', punkt.g === fx.id.GA, JSON.stringify(punkt));
  log(label + ' 11c: den kollapsede lista ble foldet ut',
    !punkt.kort && !punkt.domKollapset, JSON.stringify(punkt));
  log(label + ' 11d: den kollapsede kategorien ble foldet ut', !punkt.kat, JSON.stringify(punkt));
  log(label + ' 11e: listepunktet er markert, fokusert og i syne',
    punkt.finnes && punkt.flash && punkt.fokus && punkt.iSyne, JSON.stringify(punkt));

  /* ---------- 7) Museklikk på en rad ---------- */
  await search(p, 'fredag');
  await p.locator('.search-result').first().click();
  await p.waitForTimeout(900);
  const klikk = await p.evaluate((iid) => {
    const el = document.querySelector('.item[data-id="' + iid + '"]');
    return { lukket: document.getElementById('search-modal').hidden, flash: !!el && el.classList.contains('nav-flash') };
  }, fx.id.I2);
  log(label + ' 7: klikk på en rad navigerer som Enter', klikk.lukket && klikk.flash, JSON.stringify(klikk));

  /* ---------- 12) Ferdig listepunkt ---------- */
  await search(p, 'makrell');
  const ferdigRader = await rows(p);
  log(label + ' 12a: et avkrysset listepunkt er søkbart', ferdigRader.length === 1, JSON.stringify(ferdigRader));
  await p.keyboard.press('Enter');
  await p.waitForTimeout(900);
  const ferdig = await p.evaluate((iid) => {
    const el = document.querySelector('.item[data-id="' + iid + '"]');
    const r = el ? el.getBoundingClientRect() : null;
    return { finnes: !!el, done: !!el && el.classList.contains('done'),
      iUtført: !!el && !!el.closest('.items-done'),
      flash: !!el && el.classList.contains('nav-flash'),
      iSyne: !!r && r.top >= 0 && r.bottom <= window.innerHeight };
  }, fx.id.I5);
  log(label + ' 12b: navigeringen fant det i «Utført»-seksjonen',
    ferdig.finnes && ferdig.done && ferdig.iUtført && ferdig.flash && ferdig.iSyne, JSON.stringify(ferdig));

  /* ---------- 13) Mål som ikke finnes ---------- */
  const borte = await p.evaluate(() => window.__huskis.navigateToObject({ type: 'item', id: 'finnes-ikke' }));
  await p.waitForTimeout(250);
  const toast = await p.evaluate(() => {
    const t = document.querySelector('.toast');
    return t && !t.hidden ? t.textContent.trim() : '';
  });
  log(label + ' 13: et forsvunnet mål gir beskjed, ikke en krasj',
    borte === false && toast.indexOf('finnes ikke lenger') > -1, JSON.stringify({ borte, toast }));

  log(label + ': ingen JS-feil', errs.length === 0, errs.join(' | '));
  await browser.close();
}

/* ---------- 14) i18n ---------- */
async function runI18n() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  console.log('\n== i18n ==');

  const no = buildDB();
  await seedAndLoad(p, no);
  const norsk = await p.evaluate(() => ({
    knapp: document.getElementById('search-btn').getAttribute('aria-label'),
    tittel: document.querySelector('#search-modal-title span').textContent,
    plass: document.getElementById('search-input').getAttribute('placeholder'),
    felt: document.getElementById('search-input').getAttribute('aria-label'),
    liste: document.getElementById('search-results').getAttribute('aria-label'),
    hint: document.getElementById('search-hint').textContent,
  }));
  log('14a: kontrollene er norske',
    norsk.knapp === 'Søk' && norsk.tittel === 'Søk' && norsk.plass === 'Skriv for å søke'
      && norsk.felt === 'Søketekst' && norsk.liste === 'Søkeresultater' && norsk.hint.indexOf('Søket dekker') === 0,
    JSON.stringify(norsk));
  await search(p, 'vaktdager');
  const noRad = (await rows(p))[0];
  log('14b: typen i raden er norsk', noRad.meta.indexOf('Liste') === 0, noRad.meta);
  await p.keyboard.press('Escape');
  const noTom = await p.evaluate(() => {
    const i = document.getElementById('search-input');
    i.value = 'zzzz'; i.dispatchEvent(new Event('input', { bubbles: true }));
    return document.getElementById('search-empty').textContent;
  });
  log('14c: tomtilstanden er norsk', noTom.indexOf('Ingen treff') === 0, noTom);

  // Kontoens språk vinner ved innlogging (docs/sprak.md) — appen laster på nytt
  // på engelsk av seg selv.
  const en = buildDB('en');
  await seedAndLoad(p, en);
  await p.waitForFunction(() => window.__huskis && window.__huskis.lang === 'en', null, { timeout: 15000, polling: 200 });
  await p.waitForTimeout(300);
  const eng = await p.evaluate(() => ({
    knapp: document.getElementById('search-btn').getAttribute('aria-label'),
    tittel: document.querySelector('#search-modal-title span').textContent,
    plass: document.getElementById('search-input').getAttribute('placeholder'),
    felt: document.getElementById('search-input').getAttribute('aria-label'),
    liste: document.getElementById('search-results').getAttribute('aria-label'),
  }));
  log('14d: kontrollene er engelske',
    eng.knapp === 'Search' && eng.tittel === 'Search' && eng.plass === 'Type to search'
      && eng.felt === 'Search text' && eng.liste === 'Search results',
    JSON.stringify(eng));
  await search(p, 'vaktdager');
  const enRad = (await rows(p))[0];
  log('14e: typen i raden er engelsk', enRad.meta.indexOf('List') === 0, enRad.meta);
  const enTom = await p.evaluate(() => {
    const i = document.getElementById('search-input');
    i.value = 'zzzz'; i.dispatchEvent(new Event('input', { bubbles: true }));
    return document.getElementById('search-empty').textContent;
  });
  log('14f: tomtilstanden er engelsk', enTom.indexOf('No matches') === 0, enTom);

  log('i18n: ingen JS-feil', errs.length === 0, errs.join(' | '));
  await browser.close();
}

/* ---------- 15) Redusert bevegelse ---------- */
async function runReducedMotion() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 }, reducedMotion: 'reduce' });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  console.log('\n== reduser bevegelse ==');
  const fx = buildDB();
  await seedAndLoad(p, fx);
  log('15a: nettleseren ber om redusert bevegelse',
    await p.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches));

  await search(p, 'melk');
  await p.keyboard.press('Enter');
  await p.waitForTimeout(900);
  const rm = await p.evaluate((iid) => {
    const el = document.querySelector('.item[data-id="' + iid + '"]');
    if (!el) return null;
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return {
      flash: el.classList.contains('nav-flash'),
      varighet: cs.animationDuration,
      ring: cs.boxShadow,
      fokus: document.activeElement === el,
      iSyne: r.top >= 0 && r.bottom <= window.innerHeight,
    };
  }, fx.id.I4);
  // «0s», «0.001ms», «1e-06s» — alt under et millisekund er praktisk talt av.
  const stille = (v) => parseFloat(String(v).split(',')[0]) * (/ms$/.test(v) ? 1 : 1000) < 1;
  log('15b: markeringen pulserer ikke', !!rm && rm.flash && stille(rm.varighet), JSON.stringify(rm));
  log('15c: ringen står der likevel', !!rm && rm.ring !== 'none' && rm.ring.indexOf('inset') > -1,
    rm ? rm.ring : 'ingen node');
  log('15d: målet er fortsatt fokusert og i syne', !!rm && rm.fokus && rm.iSyne, JSON.stringify(rm));
  log('reduser bevegelse: ingen JS-feil', errs.length === 0, errs.join(' | '));
  await browser.close();
}

(async () => {
  await run('desktop', { width: 1200, height: 900 }, false);
  await run('mobil', { width: 390, height: 780 }, true);
  await runI18n();
  await runReducedMotion();
  const pass = results.filter(Boolean).length;
  console.log('\n==== ' + pass + '/' + results.length + ' PASS ====');
  process.exit(pass === results.length ? 0 : 1);
})();
