/*
  Regresjonstest: TILGJENGELIGHET I DEN KJØRENDE APPEN — navn på ikonknapper,
  tastaturflytting, fokushåndtering og berøringsflater. Det tokenbaserte
  kontrastkravet ligger i tests/a11y-contrast.test.js (ren node); her måles det
  nettleseren FAKTISK rendrer, og alt som bare finnes når appen kjører.

  Autoritativt for mekanismene: docs/design-system.md («Tastatur og fokus»).

  Dekker:
    1. Ikonknapper: hver synlige knapp UTEN synlig tekst har et tilgjengelig
       navn, og navnet er PRESIST — knapper som gjelder ett bestemt objekt har
       objektets navn i seg, så tjue like rader ikke leses opp likt. `title`
       alene teller ikke: sjekken leser aria-label.
    2. Sortering fra tastatur (Alt+pil) på alle fire nivåene: listepunkt,
       kategori, liste og gruppe/univers i nav-modalen.
    3. Sorteringen bytter plass, akkurat som draget: to trykk fram og tilbake
       lander på den opprinnelige rekkefølgen.
    4. Et listepunkt som passerer en kategorigrense havner INNE i kategorien.
    5. «Flytt til …» (Alt+M) flytter et listepunkt til en annen liste.
    6. Fokus blir på objektet som ble flyttet — også etter at en bakgrunnssynk
       har re-rendret board-et under føttene på brukeren.
    7. Fokus etter sletting lander på naboraden, ikke på <body>.
    8. F2 åpner navneredigereren; Escape avbryter den uten å lukke noe annet.
    9. Modaler: fokus flyttes inn ved åpning, Tab holdes inne, og fokus går
       tilbake til knappen som åpnet modalen når den lukkes.
   10. Opplesning: flyttinger havner i #a11y-live (role="status").
   11. Berøringsflater er IKKE blitt mindre: ikonknapper ≥ 36 px, kontroller i
       knapperadene ≥ 49 px (--control-h), i begge viewporter.
   12. Rendret kontrast: den gule knappen bærer mørk tekst uten tekstskygge, og
       fokusringen males i --focus (ikke den gamle brand-grønne).

  Kjør:
    python3 -m http.server 8000                  # fra repo-roten, i egen terminal
    NODE_PATH=$(npm root -g) node tests/a11y-runtime.test.js
*/
const { chromium } = require('playwright');

const BASE = process.env.HUSKIS_URL || 'http://localhost:8000';
const results = [];
const log = (n, ok, x = '') => {
  results.push(ok);
  console.log((ok ? 'PASS' : 'FAIL') + ' — ' + n + (x !== '' ? '  [' + (typeof x === 'string' ? x : JSON.stringify(x)) + ']' : ''));
};

let seq = 0;
const U = () => 'id' + (++seq);

/* Fikstur: ett univers med to grupper (den ene i en gruppekategori), og en
   aktiv gruppe med to lister — den første med tre listepunkter, en kategori og
   ett listepunkt inne i kategorien. Dekker alle nivåene i én lasting. */
function buildDB() {
  seq = 0;
  const uA = 'uA';
  const UNI = 'UNI', UNI2 = 'UNI2', GA = 'GA', GB = 'GB', GCAT = 'GCAT';
  const L1 = 'L1', L2 = 'L2', CAT = 'CAT';
  const base = (x) => Object.assign({
    trashed: false, locked: false, unlocked: false, invite_policy: 'inherit',
    collapsed: false, is_cat: false, cat_id: null,
    ts: 1, org: 'a', pos: 0, pos_ts: 1, pos_org: 'a',
  }, x);
  const items = [
    base({ id: 'I1', owner_id: uA, card_id: L1, text: 'Melk', pos: 0 }),
    base({ id: 'I2', owner_id: uA, card_id: L1, text: 'Brød', pos: 1 }),
    base({ id: 'I3', owner_id: uA, card_id: L1, text: 'Ost', pos: 2 }),
    base({ id: CAT, owner_id: uA, card_id: L1, text: 'Frukt', is_cat: true, pos: 3 }),
    base({ id: 'I4', owner_id: uA, card_id: L1, text: 'Eple', cat_id: CAT, pos: 0 }),
    // Frist satt → meta-chip i raden, som er inngangen til tids-POPOVEREN
    // (.switcher-overlay). Den er ikke en modal, men skal ha samme fokusregler.
    base({ id: 'I5', owner_id: uA, card_id: L2, text: 'Ringe rørlegger', pos: 0, due_at: '2030-01-01' }),
  ];
  return {
    ids: { uA, UNI, UNI2, GA, GB, GCAT, L1, L2, CAT },
    db: {
      _rolesBackfilled: true,
      profiles: [
        { id: uA, email: 'a@x.no', display_name: 'Alice Eier', user_metadata: {} },
        { id: 'uB', email: 'b@x.no', display_name: 'Bo Annen', user_metadata: {} },
      ],
      passwords: { 'a@x.no': 'x', 'b@x.no': 'x' },
      universes: [
        base({ id: UNI, owner_id: uA, name: 'Hjemme', pos: 0 }),
        base({ id: UNI2, owner_id: uA, name: 'Jobb', pos: 1 }),
        // Eid av en ANNEN → havner i «Universer delt med meg», altså en annen
        // seksjon i nav-modalen. Gruppen i den er LÅST, så A (som bare er
        // medlem) verken kan omrokkere eller flytte listene i den.
        base({ id: 'UNI3', owner_id: 'uB', name: 'Delt univers', pos: 0 }),
      ],
      groups: [
        base({ id: GA, owner_id: uA, universe_id: UNI, name: 'Handel', pos: 0 }),
        base({ id: GCAT, owner_id: uA, universe_id: UNI, name: 'Arkiv', is_cat: true, pos: 1 }),
        base({ id: GB, owner_id: uA, universe_id: UNI, name: 'Prosjekt', cat_id: GCAT, pos: 0 }),
        // Slettet gruppe → gruppe-søppelkassen dukker opp i universkortet, og
        // gir en modal som kan STABLES over nav-modalen (se 9d).
        base({ id: 'GDEL', owner_id: uA, universe_id: UNI, name: 'Gammelt', trashed: true, pos: 2 }),
        base({ id: 'GC', owner_id: 'uB', universe_id: 'UNI3', name: 'Låst gruppe', locked: true, pos: 0 }),
        // En ÅPEN nabogruppe i samme univers: uten kildesjekken finnes det da et
        // gyldig mål, velgeren åpner seg, og lista flyttes optimistisk ut av den
        // låste gruppen. Med den finnes målet fortsatt, men kilden sier nei.
        base({ id: 'GD', owner_id: 'uB', universe_id: 'UNI3', name: 'Åpen gruppe', pos: 1 }),
      ],
      cards: [
        base({ id: L1, owner_id: uA, group_id: GA, title: 'Handleliste', k: true, p: true, lab_ts: 0, lab_org: '' }),
        base({ id: L2, owner_id: uA, group_id: GA, title: 'Huskeliste', k: true, p: true, lab_ts: 0, lab_org: '', pos: 1 }),
        base({ id: 'LC', owner_id: 'uB', group_id: 'GC', title: 'Låst liste', k: true, p: true, lab_ts: 0, lab_org: '' }),
      ],
      items,
      memberships: [
        { id: U(), user_id: uA, universe_id: UNI, group_id: null, role: 'owner', pos: 0, created_at: 1 },
        { id: U(), user_id: uA, universe_id: UNI2, group_id: null, role: 'owner', pos: 1, created_at: 1 },
        { id: U(), user_id: 'uB', universe_id: 'UNI3', group_id: null, role: 'owner', pos: 0, created_at: 1 },
        // A er kun MEDLEM her — låser gjelder derfor for A (eiere omgår dem).
        { id: U(), user_id: uA, universe_id: 'UNI3', group_id: null, role: 'member', pos: 2, created_at: 1 },
      ],
      share_invites: [], tombstones: [],
    },
  };
}

async function load(page, viewport) {
  const { ids, db } = buildDB();
  await page.setViewportSize(viewport);
  await page.goto(BASE + '/?mock=1');
  await page.evaluate(({ db, uid }) => {
    localStorage.clear(); sessionStorage.clear();
    localStorage.setItem('hk-mock-db', JSON.stringify(db));
    // Kontoen har sett hele introduksjonen: verken omvisningen eller et
    // gest-tips skal legge seg over det som testes (tests/CLAUDE.md).
    sessionStorage.setItem('hk-mock-session', JSON.stringify({
      id: uid, email: 'a@x.no',
      user_metadata: { onboarding: { v: 1, status: 'done' }, tips: { drag: true, trash: true, moveList: true } },
    }));
  }, { db, uid: ids.uA });
  await page.goto(BASE + '/?mock=1');
  await page.waitForFunction(() => window.__huskis && window.__huskis.authUser, { timeout: 8000 });
  await page.waitForTimeout(900);
  return ids;
}

const openNav = async (p) => { await p.evaluate(() => window.__huskis.openNavModal()); await p.waitForTimeout(400); };
const itemOrder = (p) => p.$$eval('.card:not(.uni-card) .items-container > .item .item-text', (n) => n.map((x) => x.textContent));
const live = (p) => p.locator('#a11y-live').textContent();
const activeInfo = (p) => p.evaluate(() => {
  const a = document.activeElement;
  if (!a || a === document.body) return { tag: 'BODY', id: '', cls: '' };
  return { tag: a.tagName, id: a.dataset ? (a.dataset.id || '') : '', cls: a.className || '' };
});

/* Alle SYNLIGE knapper uten synlig tekst — de som bare er et ikon. */
const iconButtonsWithoutName = (p) => p.evaluate(() => {
  const out = [];
  document.querySelectorAll('button, [role="button"]').forEach((b) => {
    if (b.closest('[hidden]') || b.hidden || !b.offsetParent) return;
    const text = (b.textContent || '').replace(/\s+/g, ' ').trim();
    if (text) return;                       // har synlig tekst — trenger ikke aria-label
    const label = (b.getAttribute('aria-label') || '').trim();
    if (!label) {
      out.push({ cls: b.className, title: b.getAttribute('title') || '(ingen title)' });
    }
  });
  return out;
});

async function run(label, viewport) {
  const browser = await chromium.launch();
  const page = await browser.newPage(Object.assign({ viewport }, viewport.width < 600 ? { isMobile: true, hasTouch: true } : {}));
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  console.log('\n== ' + label + ' ==');
  const ids = await load(page, viewport);

  /* ---------- 1. Ikonknapper har presise navn ---------- */
  const nameless = await iconButtonsWithoutName(page);
  log(label + ' 1a: alle synlige ikonknapper på board-et har aria-label', nameless.length === 0, nameless);

  const cardLabels = await page.$$eval('.card:not(.uni-card) button[aria-label]',
    (n) => n.map((x) => x.getAttribute('aria-label')));
  const needsObjectName = ['Slett listen', 'Innstillinger for listen', 'Slett listepunktet',
    'Innstillinger for listepunktet', 'Oppløs kategorien'];
  const imprecise = needsObjectName.filter((prefix) => {
    const hit = cardLabels.filter((l) => l.startsWith(prefix));
    return hit.length > 0 && hit.some((l) => !/«[^»]+»/.test(l));
  });
  log(label + ' 1b: objektknappene har objektets navn i aria-label', imprecise.length === 0,
    imprecise.length ? imprecise : cardLabels.slice(0, 4));

  // To listepunkter må ikke få SAMME navn på slettknappen.
  const delLabels = await page.$$eval('.card:not(.uni-card) .item-delete',
    (n) => n.map((x) => x.getAttribute('aria-label')));
  log(label + ' 1c: sletteknappene skiller radene fra hverandre',
    new Set(delLabels).size === delLabels.length, delLabels);

  await openNav(page);
  const navNameless = await iconButtonsWithoutName(page);
  log(label + ' 1d: alle synlige ikonknapper i nav-modalen har aria-label', navNameless.length === 0, navNameless);
  const uniDel = await page.locator('.uni-card[data-id="UNI"] .uni-delete').getAttribute('aria-label');
  log(label + ' 1e: «Slett universet» navngir universet', /«Hjemme»/.test(uniDel || ''), uniDel);
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);

  // De tre modalene board-scanningen ikke når: innstillinger, deling og
  // søppelkassen. Det er her en ny ikonknapp lettest blir stående uten navn.
  for (const [navn, open] of [
    ['innstillingsmodalen', () => window.__huskis.openSettings('card', 'L1', 'L1')],
    ['del-modalen', () => {
      const u = window.__huskis.state.universes.find((x) => x.id === 'UNI');
      const g = u.groups.find((x) => x.id === 'GA');
      window.__huskis.openShare('group', 'GA', g);
    }],
  ]) {
    await page.evaluate(open);
    await page.waitForTimeout(500);
    const missing = await iconButtonsWithoutName(page);
    log(label + ' 1f: alle synlige ikonknapper i ' + navn + ' har aria-label',
      missing.length === 0, missing);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(350);
  }

  /* ---------- 2–3. Sortering av listepunkter ---------- */
  const before = await itemOrder(page);
  await page.locator('.item[data-id="I2"]').focus();
  await page.keyboard.press('Alt+ArrowUp');
  await page.waitForTimeout(350);
  const afterUp = await itemOrder(page);
  log(label + ' 2a: Alt+pil opp flytter listepunktet ett hakk opp',
    afterUp[0] === 'Brød' && afterUp[1] === 'Melk', { before, afterUp });

  await page.keyboard.press('Alt+ArrowDown');
  await page.waitForTimeout(350);
  const afterDown = await itemOrder(page);
  log(label + ' 3: fram og tilbake gir den opprinnelige rekkefølgen',
    JSON.stringify(afterDown) === JSON.stringify(before), { before, afterDown });

  /* ---------- 10. Opplesning ---------- */
  // Live-området holder den SISTE beskjeden — altså tilbakeflyttingen over.
  // Den skal navngi objektet og si både retning og hvor det havnet.
  const spoken = await live(page);
  log(label + ' 10: flyttingen ble lest opp i #a11y-live med navn og ny plass',
    /«Brød»/.test(spoken) && /flyttet ned/.test(spoken) && /plass \d+ av \d+/.test(spoken), spoken);
  const liveAttrs = await page.evaluate(() => {
    const el = document.getElementById('a11y-live');
    return { role: el.getAttribute('role'), live: el.getAttribute('aria-live'), hidden: el.hidden };
  });
  log(label + ' 10b: live-området er et role="status" som IKKE er hidden',
    liveAttrs.role === 'status' && liveAttrs.live === 'polite' && liveAttrs.hidden === false, liveAttrs);

  /* ---------- 6. Fokus følger objektet, også gjennom en re-rendring ---------- */
  const focusAfterMove = await activeInfo(page);
  log(label + ' 6a: fokus står fortsatt på det flyttede listepunktet',
    focusAfterMove.id === 'I2', focusAfterMove);
  // Tving en full re-rendring, slik en bakgrunnssynk gjør.
  await page.evaluate(() => window.__huskis.render());
  await page.waitForTimeout(200);
  const focusAfterRender = await activeInfo(page);
  log(label + ' 6b: fokus overlever en full render()', focusAfterRender.id === 'I2', focusAfterRender);

  /* ---------- 4. Over en kategorigrense ---------- */
  // «Ost» er siste nivå-1-rad; ett hakk ned skal ta den inn i kategorien «Frukt».
  await page.locator('.item[data-id="I3"]').focus();
  await page.keyboard.press('Alt+ArrowDown');
  await page.waitForTimeout(350);
  const inCat = await page.evaluate(() =>
    !!document.querySelector('.category[data-id="CAT"] .item[data-id="I3"]'));
  log(label + ' 4: et listepunkt som passerer kategorigrensen havner inne i kategorien', inCat,
    { catInnhold: await page.$$eval('.category[data-id="CAT"] .item .item-text', (n) => n.map((x) => x.textContent)) });

  /* ---------- 2b. Sortering av kategorier ---------- */
  const level1Before = await page.$$eval('.card[data-id="L1"] .items-container > *',
    (n) => n.map((x) => x.dataset.id));
  await page.locator('.category[data-id="CAT"] > .cat-head').focus();
  await page.keyboard.press('Alt+ArrowUp');
  await page.waitForTimeout(350);
  const level1After = await page.$$eval('.card[data-id="L1"] .items-container > *',
    (n) => n.map((x) => x.dataset.id));
  log(label + ' 2b: Alt+pil flytter en kategori blant nivå-1-radene',
    JSON.stringify(level1Before) !== JSON.stringify(level1After), { level1Before, level1After });

  /* ---------- 2c. Sortering av lister ---------- */
  const cardsBefore = await page.$$eval('.card:not(.uni-card)', (n) => n.map((x) => x.dataset.id));
  await page.locator('.card[data-id="L2"] > .card-head').focus();
  await page.keyboard.press('Alt+ArrowUp');
  await page.waitForTimeout(400);
  const cardsAfter = await page.$$eval('.card:not(.uni-card)', (n) => n.map((x) => x.dataset.id));
  log(label + ' 2c: Alt+pil flytter en liste på board-et',
    cardsAfter[0] === 'L2' && cardsBefore[0] === 'L1', { cardsBefore, cardsAfter });

  /* ---------- 2d. Sortering av grupper og universer i nav-modalen ---------- */
  await openNav(page);
  const uniBefore = await page.$$eval('.uni-card', (n) => n.map((x) => x.dataset.id));
  await page.locator('.uni-card[data-id="UNI2"] > .card-head').focus();
  await page.keyboard.press('Alt+ArrowUp');
  await page.waitForTimeout(400);
  const uniAfter = await page.$$eval('.uni-card', (n) => n.map((x) => x.dataset.id));
  log(label + ' 2d: Alt+pil flytter et univers i nav-modalen',
    uniAfter[0] === 'UNI2' && uniBefore[0] === 'UNI', { uniBefore, uniAfter });

  // 2e. Sorteringen skal holde seg innenfor SIN seksjon. «Mine universer» og
  // «Universer delt med meg» er to lister i nav-modalen, og renderNav() sorterer
  // på seksjon FØR pos — et bytte over grensen ville ikke flyttet noe dit man
  // ser, bare importert en fremmed pos-verdi og stokket om på resten.
  const posBefore = await page.evaluate(() => {
    const m = {};
    window.__huskis.state.universes.forEach((u) => { m[u.id] = u.pos; });
    return m;
  });
  const lastOwned = uniAfter[uniAfter.length - 1 - (uniAfter.indexOf('UNI3') === uniAfter.length - 1 ? 1 : 0)];
  await page.locator('.uni-card[data-id="' + lastOwned + '"] > .card-head').focus();
  await page.keyboard.press('Alt+ArrowDown');
  await page.waitForTimeout(400);
  const posAfter = await page.evaluate(() => {
    const m = {};
    window.__huskis.state.universes.forEach((u) => { m[u.id] = u.pos; });
    return m;
  });
  const spokenSection = await live(page);
  log(label + ' 2e: siste univers i en seksjon flyttes ikke over i den neste',
    posBefore.UNI3 === posAfter.UNI3 && /sist/.test(spokenSection),
    { lastOwned, spokenSection, UNI3: [posBefore.UNI3, posAfter.UNI3] });

  // 2f. En LÅST gruppe: A er bare medlem, så låsen gjelder. Alt+M skal avvises
  // på kildesiden — `moveTargetGroups` sjekker bare MÅL-gruppen, så uten en egen
  // kildesjekk ville lista blitt flyttet optimistisk før serveren rakk å si nei.
  await page.evaluate(() => {
    window.__huskis.setActiveUniverse('UNI3');
    window.__huskis.setActiveGroup('GC');
    window.__huskis.render();
  });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  const lockedHead = page.locator('.card[data-id="LC"] > .card-head');
  if (await lockedHead.count()) {
    await lockedHead.focus();
    await page.keyboard.press('Alt+KeyM');
    await page.waitForTimeout(400);
    const refused = await page.evaluate(() => ({
      picker: !document.getElementById('place-modal').hidden,
      sagt: document.getElementById('a11y-live').textContent,
      stillInGC: (window.__huskis.state.universes.find((u) => u.id === 'UNI3')
        .groups.find((g) => g.id === 'GC').cards || []).some((c) => c.id === 'LC'),
    }));
    log(label + ' 2f: Alt+M avvises på en liste jeg ikke kan ta ut av gruppen',
      !refused.picker && refused.stillInGC && /kan ikke flytte/i.test(refused.sagt), refused);
  } else {
    log(label + ' 2f: Alt+M avvises på en liste jeg ikke kan ta ut av gruppen', false,
      'fant ikke den låste lista — sjekk fiksturen');
  }
  // Tilbake til utgangspunktet for resten av sjekkene.
  await page.evaluate(() => {
    window.__huskis.setActiveUniverse('UNI');
    window.__huskis.setActiveGroup('GA');
    window.__huskis.render();
  });
  await page.waitForTimeout(400);
  await openNav(page);

  /* ---------- 9. Modalfokus: inn, fanget, og tilbake ---------- */
  await page.keyboard.press('Escape'); await page.waitForTimeout(350);
  await page.locator('#nav-crumb').focus();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(450);
  const focusInModal = await page.evaluate(() =>
    !!document.getElementById('nav-modal').contains(document.activeElement));
  log(label + ' 9a: fokus flyttes inn i modalen når den åpnes', focusInModal, await activeInfo(page));

  // Shift+Tab som FØRSTE tastetrykk etter åpning. Fokus står da på selve
  // dialogflaten (tabindex="-1"), som ikke er med i lista over fokuserbare —
  // uten en egen gren i fellen falt fokus bakover, ut til kontrollen foran
  // modalen i dokumentrekkefølgen.
  await page.keyboard.press('Shift+Tab');
  const afterShiftTab = await page.evaluate(() => {
    const m = document.getElementById('nav-modal');
    return { inside: m.contains(document.activeElement), cls: document.activeElement.className || document.activeElement.tagName };
  });
  log(label + ' 9b1: Shift+Tab rett etter åpning holdes inne i modalen',
    afterShiftTab.inside, afterShiftTab);

  // Tab rundt hele veien, begge retninger: fokus skal aldri forlate modalen.
  let escaped = null;
  for (const key of ['Tab', 'Shift+Tab']) {
    for (let i = 0; i < 30; i++) {
      await page.keyboard.press(key);
      const inside = await page.evaluate(() =>
        !!document.getElementById('nav-modal').contains(document.activeElement));
      if (!inside) { escaped = key + ' etter ' + (i + 1) + ' trykk'; break; }
    }
    if (escaped) break;
  }
  log(label + ' 9b: Tab og Shift+Tab holdes inne i modalen (30 trykk hver)', !escaped, escaped || '');

  // 9d. Stablede modaler: søppelkassen legger seg OVER nav-modalen. Escape skal
  // lukke én om gangen, og fokus skal falle ned i modalen under — ikke ut i
  // board-et bak begge to.
  const trashBtn = page.locator('.uni-card[data-id="UNI"] .group-trash-btn');
  await trashBtn.scrollIntoViewIfNeeded();
  await trashBtn.click();
  await page.waitForTimeout(500);
  const stacked = await page.evaluate(() => ({
    trashOpen: !document.getElementById('trash-modal').hidden,
    navStillOpen: !document.getElementById('nav-modal').hidden,
    focusInTrash: document.getElementById('trash-modal').contains(document.activeElement),
  }));
  log(label + ' 9d: søppelkassen stables over nav-modalen og tar fokus',
    stacked.trashOpen && stacked.navStillOpen && stacked.focusInTrash, stacked);

  await page.keyboard.press('Escape');
  await page.waitForTimeout(450);
  const afterFirstEsc = await page.evaluate(() => ({
    trashOpen: !document.getElementById('trash-modal').hidden,
    navStillOpen: !document.getElementById('nav-modal').hidden,
    focusInNav: document.getElementById('nav-modal').contains(document.activeElement),
  }));
  log(label + ' 9e: Escape lukker kun søppelkassen, og fokus faller ned i nav-modalen',
    !afterFirstEsc.trashOpen && afterFirstEsc.navStillOpen && afterFirstEsc.focusInNav, afterFirstEsc);

  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  const backOnCrumb = await page.evaluate(() => document.activeElement.id);
  log(label + ' 9c: fokus går tilbake til knappen som åpnet modalen',
    backOnCrumb === 'nav-crumb', backOnCrumb || '(body)');

  /* ---------- 9f. Popover: samme fokusregler som en modal ---------- */
  const dueChip = page.locator('.item[data-id="I5"] .meta-chip').first();
  if (await dueChip.count()) {
    await dueChip.click();
    await page.waitForTimeout(450);
    const popover = await page.evaluate(() => ({
      open: !document.getElementById('time-switcher').hidden,
      focusInside: document.getElementById('time-switcher').contains(document.activeElement),
    }));
    log(label + ' 9f: tids-popoveren tar fokus når den åpnes',
      popover.open && popover.focusInside, popover);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    const backOnChip = await page.evaluate(() => {
      const a = document.activeElement;
      return !!(a && a.classList && a.classList.contains('meta-chip'));
    });
    log(label + ' 9g: fokus går tilbake til chipen som åpnet popoveren', backOnChip,
      await activeInfo(page));
  } else {
    log(label + ' 9f: tids-popoveren tar fokus når den åpnes', false, 'fant ingen meta-chip');
    log(label + ' 9g: fokus går tilbake til chipen som åpnet popoveren', false, 'fant ingen meta-chip');
  }

  /* ---------- 8. F2 omdøper, Escape avbryter ---------- */
  await page.locator('.item[data-id="I1"]').focus();
  await page.keyboard.press('F2');
  await page.waitForTimeout(250);
  const editing = await page.evaluate(() => document.activeElement.className);
  log(label + ' 8a: F2 åpner navneredigereren', /edit-input/.test(editing), editing);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
  const stillThere = await page.evaluate(() => !!document.querySelector('.item[data-id="I1"]'));
  const noModalOpen = await page.evaluate(() => document.getElementById('nav-modal').hidden);
  log(label + ' 8b: Escape avbryter redigeringen uten å lukke noe annet', stillThere && noModalOpen,
    { stillThere, noModalOpen });

  /* ---------- 5. «Flytt til …» (Alt+M) ---------- */
  await page.locator('.item[data-id="I1"]').focus();
  await page.keyboard.press('Alt+KeyM');
  await page.waitForTimeout(400);
  const pickerOpen = await page.evaluate(() => !document.getElementById('place-modal').hidden);
  log(label + ' 5a: Alt+M åpner «Flytt til …»', pickerOpen);
  if (pickerOpen) {
    await page.locator('#place-body .place-option', { hasText: 'Huskeliste' }).first().click();
    await page.waitForTimeout(500);
    const movedTo = await page.evaluate(() => {
      const el = document.querySelector('.item[data-id="I1"]');
      const card = el && el.closest('.card');
      return card ? card.dataset.id : null;
    });
    log(label + ' 5b: listepunktet havnet i den valgte listen', movedTo === 'L2', movedTo);
  } else {
    log(label + ' 5b: listepunktet havnet i den valgte listen', false, 'velgeren åpnet seg ikke');
  }

  /* ---------- 7. Fokus etter sletting ---------- */
  await page.locator('.card[data-id="L1"] .item[data-id="I3"]').waitFor({ state: 'attached' }).catch(() => {});
  const target = await page.$('.item[data-id="I2"] .item-delete');
  if (target) {
    await target.click();
    await page.waitForTimeout(450);
    const after = await activeInfo(page);
    log(label + ' 7: fokus etter sletting lander på en nabo, ikke på <body>',
      after.tag !== 'BODY', after);
  } else {
    log(label + ' 7: fokus etter sletting lander på en nabo, ikke på <body>', false, 'fant ikke slettknappen');
  }


  /* ---------- 11. Berøringsflater ----------
     Gulvet er DAGENS mål, målt i nettleseren — poenget er at ingenting krymper.
     Tallene er de faktiske størrelsene kontrollene har i dag; en endring som gjør
     en av dem mindre skal feile her, ikke oppdages på en telefon. I tillegg
     kontrolleres WCAG 2.2 «Target Size (Minimum)» (24×24 px) for alt sammen. */
  const FLOOR = {
    '.icon-btn': 36, '.card-cog': 36, '.cat-cog': 36, '.cat-dissolve': 36,
    '.item-cog': 27, '.item-check': 26, '.btn-add': 34, '.crumb-btn': 49,
  };
  const measured = await page.evaluate((sels) => {
    const out = {};
    sels.forEach((sel) => {
      const els = [].slice.call(document.querySelectorAll(sel)).filter((e) => e.offsetParent);
      out[sel] = els.length ? Math.min.apply(null, els.map((e) => {
        const r = e.getBoundingClientRect();
        return Math.round(Math.min(r.width, r.height));
      })) : null;
    });
    return out;
  }, Object.keys(FLOOR));
  const shrunk = Object.keys(FLOOR).filter((s) => measured[s] !== null && measured[s] < FLOOR[s]);
  log(label + ' 11a: ingen kontroll er blitt mindre enn den var', shrunk.length === 0,
    shrunk.length ? shrunk.map((s) => s + ': ' + measured[s] + ' < ' + FLOOR[s]) : measured);
  const tooSmall = Object.keys(measured).filter((s) => measured[s] !== null && measured[s] < 24);
  log(label + ' 11b: alle kontroller er minst 24×24 px (WCAG 2.2 AA)', tooSmall.length === 0, tooSmall);

  /* ---------- 12. Rendret farge ---------- */
  const yellow = await page.evaluate(() => {
    const b = document.querySelector('.btn-yellow');
    if (!b) return null;
    const cs = getComputedStyle(b);
    return { color: cs.color, shadow: cs.textShadow };
  });
  log(label + ' 12a: den gule knappen bærer mørk tekst uten tekstskygge',
    !!yellow && yellow.color === 'rgb(55, 52, 63)' && yellow.shadow === 'none', yellow);

  const ring = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--focus').trim());
  log(label + ' 12b: fokusringen bruker --focus (mørk), ikke den gamle grønne',
    ring === '#10131a', ring);

  // 12c. Den FAKTISK malte ringen. Uten sikkerhetsnettet i styles.css arvet nye
  // kontroller (som listepunkt-raden) nettleserens innebygde ring — gullaktig på
  // Android, og utenfor vår kontroll. Fokus MÅ settes med ekte Tab her:
  // `:focus-visible` slår ikke inn på en programmatisk `.focus()`.
  await page.evaluate(() => { document.activeElement.blur(); window.scrollTo(0, 0); });
  const painted = [];
  for (let i = 0; i < 60; i++) {
    await page.keyboard.press('Tab');
    const hit = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body || !el.matches(':focus-visible')) return null;
      const cs = getComputedStyle(el);
      const what = el.classList.contains('item') ? 'rad'
        : el.classList.contains('card-head') ? 'korthode'
          : el.classList.contains('cat-head') ? 'kategorihode' : null;
      if (!what) return null;
      return { what, color: cs.outlineColor, style: cs.outlineStyle, width: parseFloat(cs.outlineWidth) };
    });
    if (hit) painted.push(hit);
    if (painted.length >= 3) break;
  }
  const bad = painted.filter((r) => r.color !== 'rgb(16, 19, 26)' || r.style !== 'solid' || r.width < 2);
  log(label + ' 12c: de nye tastaturhåndtakene maler --focus, ikke nettleserens egen ring',
    painted.length > 0 && bad.length === 0, bad.length ? bad : painted);

  /* ---------- 7b. Den siste lista (DESTRUKTIV — står sist med vilje) ----------
     renderBoard() returnerer tidlig når board-et blir tomt, så fokusønsket måtte
     innfris i innpakningen — ellers falt fokus til <body> nettopp i det
     tilfellet der brukeren trenger et sted å fortsette fra. Sjekken tømmer
     board-et og må derfor komme etter alt som trenger innhold. */
  await page.evaluate(() => {
    const dels = [].slice.call(document.querySelectorAll('.card:not(.uni-card) .card-delete'));
    dels.slice(0, -1).forEach((b) => b.click());
  });
  await page.waitForTimeout(600);
  const lastDel = await page.$('.card:not(.uni-card) .card-delete');
  if (lastDel) {
    await lastDel.click();
    await page.waitForTimeout(700);
    const emptied = await page.evaluate(() => ({
      cards: document.querySelectorAll('.card:not(.uni-card)').length,
      focus: document.activeElement === document.body
        ? 'BODY' : (document.activeElement.id || document.activeElement.className),
    }));
    log(label + ' 7b: fokus overlever at den SISTE lista slettes (tomt board)',
      emptied.cards === 0 && emptied.focus !== 'BODY', emptied);
  } else {
    log(label + ' 7b: fokus overlever at den SISTE lista slettes (tomt board)', false, 'fant ingen liste å slette');
  }

  log(label + ': ingen JS-feil', errors.length === 0, errors.join(' | '));
  await browser.close();
}

(async () => {
  await run('desktop', { width: 1200, height: 900 });
  await run('mobil', { width: 390, height: 780 });
  const pass = results.filter(Boolean).length;
  console.log(`\n==== ${pass}/${results.length} PASS ====`);
  process.exit(pass === results.length ? 0 : 1);
})();
