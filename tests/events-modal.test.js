/*
  Regresjonstest: MODALEN «Kommende hendelser» og kalenderknappen
  (docs/kommende-hendelser.md). Reglene bak innholdet har sin egen fil
  (`upcoming-events.test.js`); her testes veien fra knappen til at brukeren
  står ved objektet.

  Fiksturen bruker datoer RELATIVE til i dag, fordi modalen regner mot den
  ekte klokken. Avstandene er valgt med god margin til grensene, så testen
  ikke kan vippe over en bøttegrense mens den kjører.

  Dekker:
     1. Kalenderknappen er skjult før innlogging, synlig etter, og ligger
        FØRST i toppkontrollgruppen (geometrien er `corner-controls.test.js`).
     2. Modalen åpner med tittel, og seksjonene kommer i rekkefølgen
        «Tidsfrister» → «Starttider».
     3. Gruppene har overskrift, ikon og antall — og bare de som har rader.
     4. Raden viser navn, type + kontekststi og et konkret tidspunkt.
     5. Tomtilstand når ingenting har tider.
     6. Tastatur og fokus: fokus flyttes inn i dialogen, Tab holdes inne,
        Escape lukker og gir fokus tilbake til kalenderknappen.
     7. Trykk på en rad lukker modalen og navigerer via PR 1-mekanismen:
        riktig mappe, målet rullet fram, markert (`.nav-flash`) og fokusert,
        med opplesning i `#a11y-live`.
     8. Innholdet OPPDATERES mens modalen står åpen: krysser man av det siste
        uferdige listepunktet, forsvinner listens hendelser uten at modalen
        lukkes — og en frist som PASSERER mens modalen står åpen flytter seg
        til «Frist utløpt» uten at noe i tilstanden endret seg.
     9. i18n: modalen finnes på både norsk og engelsk.
    10. Farge er aldri eneste bærer, og den gule/grønne statusflaten pinner en
        MØRK ikonstrek (kontraktsfargene er de samme i begge drakter).

  Kjøres på BÅDE desktop- og mobil-viewport: modalen legger tidspunktet på
  egen linje under 560 px, og kalenderknappen skal virke begge steder.

  Kjør:
    python3 -m http.server 8000                        # fra repo-roten, i egen terminal
    NODE_PATH=$(npm root -g) node tests/events-modal.test.js
*/
const { chromium } = require('playwright');

const BASE = process.env.HUSKIS_URL || 'http://localhost:8000';
const results = [];
const log = (n, ok, x = '') => { results.push(ok); console.log((ok ? 'PASS' : 'FAIL') + ' — ' + n + (x !== '' ? '  [' + (typeof x === 'string' ? x : JSON.stringify(x)) + ']' : '')); };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const U = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
  const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
});
// Dato n døgn fra i dag, i lokal tid — samme format som appen lagrer.
const dag = (off) => {
  const x = new Date();
  x.setDate(x.getDate() + off);
  return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0');
};

/* Fikstur:
     Arbeid > Klinikk    > Vaktdager   (frist for 30 dager siden, start −20)
                            Mandag
              Kontoret   > Rapport     (frist om 3 dager)
                            Skrive
              Kontoret   > Ferie       (start om 30 dager, frist om 40)
                            Bestille
     Den aktive mappen er Klinikk, så en rad i Kontoret må BYTTE mappe. */
function buildDB(lang) {
  const uid = 'uM';
  const id = {};
  ['UA', 'GA', 'GB', 'L1', 'L2', 'L3', 'I1', 'I2', 'I3'].forEach((k) => { id[k] = U(); });
  const base = (x) => Object.assign({
    trashed: false, locked: false, unlocked: false, invite_policy: 'inherit',
    collapsed: false, is_cat: false, cat_id: null,
    start_at: null, due_at: null, lock_times: false,
    ts: 1, org: 'm', pos: 0, pos_ts: 1, pos_org: 'm',
  }, x);
  const card = (i, g, t, e) => base(Object.assign(
    { id: i, owner_id: uid, group_id: g, title: t, k: true, p: true, lab_ts: 0, lab_org: '' }, e || {}));
  const item = (i, c, t, e) => base(Object.assign(
    { id: i, owner_id: uid, card_id: c, text: t, done: false }, e || {}));
  const meta = { onboarding: { v: 3, status: 'done' }, tips: { drag: true, trash: true, moveList: true, dragTrash: true } };
  if (lang) meta.lang = lang;
  return { id, uid, meta, db: {
    _rolesBackfilled: true,
    profiles: [{ id: uid, email: 'm@x.no', display_name: 'Modal', user_metadata: meta }],
    passwords: { 'm@x.no': 'x' },
    universes: [base({ id: id.UA, owner_id: uid, name: 'Arbeid' })],
    groups: [
      base({ id: id.GA, owner_id: uid, universe_id: id.UA, name: 'Klinikk' }),
      base({ id: id.GB, owner_id: uid, universe_id: id.UA, name: 'Kontoret', pos: 1 }),
    ],
    cards: [
      card(id.L1, id.GA, 'Vaktdager', { due_at: dag(-30), start_at: dag(-20) }),
      card(id.L2, id.GB, 'Rapport', { due_at: dag(3) }),
      card(id.L3, id.GB, 'Ferie', { pos: 1, start_at: dag(30), due_at: dag(40) }),
    ],
    items: [
      item(id.I1, id.L1, 'Mandag'),
      item(id.I2, id.L2, 'Skrive'),
      item(id.I3, id.L3, 'Bestille'),
    ],
    memberships: [{ id: U(), user_id: uid, universe_id: id.UA, group_id: null, role: 'owner', pos: 0, created_at: 1 }],
    share_invites: [], tombstones: [],
  } };
}

async function seed(p, fx) {
  await p.goto(BASE + '/?mock=1');
  await p.evaluate(({ db, uid, meta }) => {
    localStorage.clear(); sessionStorage.clear();
    localStorage.setItem('hk-mock-db', JSON.stringify(db));
    sessionStorage.setItem('hk-mock-session', JSON.stringify({ id: uid, email: 'm@x.no', user_metadata: meta }));
  }, { db: fx.db, uid: fx.uid, meta: fx.meta });
  await p.goto(BASE + '/?mock=1');
  await p.waitForFunction(() => {
    const H = window.__huskis;
    return H && H.authUser && H.lastMy && H.state.universes.length > 0;
  }, null, { timeout: 15000, polling: 200 });
}

// Alt modalen faktisk viser, som lesbar struktur.
const modalTree = (p) => p.evaluate(() => {
  const body = document.getElementById('events-body');
  return [].slice.call(body.querySelectorAll('.events-section')).map((sec) => ({
    tittel: sec.querySelector('.events-section-head').textContent,
    grupper: [].slice.call(sec.querySelectorAll('.events-group-head')).map((h) => ({
      navn: h.childNodes.length ? h.children[1].textContent : '',
      antall: h.querySelector('.events-group-count').textContent,
      ikon: !!h.querySelector('.event-icon svg'),
      tone: (h.querySelector('.event-icon').className.match(/is-[a-z]+/) || [])[0],
    })),
    rader: [].slice.call(sec.querySelectorAll('.event-row')).map((r) => ({
      navn: r.querySelector('.event-row-name').textContent,
      meta: r.querySelector('.event-row-meta').textContent,
      tid: r.querySelector('.event-row-when').textContent,
      type: r.dataset.type,
    })),
  }));
});

async function run(label, viewport, touchMode) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext(Object.assign({ viewport },
    touchMode ? { hasTouch: true, isMobile: true } : {}));
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));

  /* ---------- 1) Knappen ---------- */
  await p.goto(BASE + '/?mock=1');
  await p.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await p.goto(BASE + '/?mock=1');
  await p.waitForFunction(() => document.body.classList.contains('no-auth'), null, { timeout: 15000 });
  log(label + ' 1a: kalenderknappen er skjult før innlogging',
    !(await p.locator('#events-btn').isVisible()));

  const fx = buildDB();
  await seed(p, fx);
  await p.waitForTimeout(300);
  const knapp = await p.evaluate(() => {
    const b = document.getElementById('events-btn');
    const g = document.getElementById('corner-controls');
    return {
      synlig: !!b.offsetParent,
      først: g.firstElementChild === b,
      navn: b.getAttribute('aria-label'),
      dialog: b.getAttribute('aria-haspopup'),
    };
  });
  log(label + ' 1b: knappen er synlig etter innlogging, ligger FØRST i gruppen og har navn',
    knapp.synlig && knapp.først && !!knapp.navn && knapp.dialog === 'dialog', JSON.stringify(knapp));

  /* ---------- 2–4) Modalen ---------- */
  await p.locator('#events-btn').click();
  await p.waitForSelector('#events-modal:not([hidden])');
  const tittel = await p.locator('#events-modal-title').textContent();
  log(label + ' 2a: modalen har tittelen «Kommende hendelser»',
    (tittel || '').trim() === 'Kommende hendelser', tittel);
  const tre = await modalTree(p);
  log(label + ' 2b: seksjonene kommer i rekkefølgen Tidsfrister → Starttider',
    eq(tre.map((s) => s.tittel), ['Tidsfrister', 'Starttider']), JSON.stringify(tre.map((s) => s.tittel)));
  log(label + ' 3a: bare gruppene som HAR rader tegnes, med ikon og antall',
    eq(tre[0].grupper, [
      { navn: 'Frist utløpt', antall: '1', ikon: true, tone: 'is-over' },
      { navn: 'Frist innen 7 dager', antall: '1', ikon: true, tone: 'is-soon' },
      { navn: 'Frist om 7 dager eller mer', antall: '1', ikon: true, tone: 'is-later' },
    ]), JSON.stringify(tre[0].grupper));
  // Startgruppene bærer IKKE varselfargene: at noe begynner er ingen advarsel.
  log(label + ' 3b: startseksjonen har «Har begynt» (aksent) og en NØYTRAL fremtidsgruppe',
    eq(tre[1].grupper.map((g) => g.navn + '/' + g.tone),
      ['Har begynt/is-started', 'Begynner om 7 dager eller mer/is-neutral']),
    JSON.stringify(tre[1].grupper));
  const rad = tre[0].rader[0];
  log(label + ' 4: raden viser navn, type + kontekststi og et konkret tidspunkt',
    rad.navn === 'Vaktdager' && rad.meta === 'Liste · Arbeid › Klinikk' &&
    /\d/.test(rad.tid) && rad.type === 'card', JSON.stringify(rad));

  /* ---------- 6) Tastatur og fokus ---------- */
  const fokus = await p.evaluate(() => {
    const el = document.activeElement;
    return { iModal: !!(el && el.closest('#events-modal')), tag: el && el.tagName };
  });
  log(label + ' 6a: fokus står i dialogen etter åpning', fokus.iModal, JSON.stringify(fokus));
  await p.keyboard.press('Tab');
  await p.keyboard.press('Tab');
  const fokus2 = await p.evaluate(() => {
    const el = document.activeElement;
    return { iModal: !!(el && el.closest('#events-modal')), klasse: el && el.className };
  });
  log(label + ' 6b: Tab holder seg inne i dialogen og treffer radene',
    fokus2.iModal, JSON.stringify(fokus2));
  await p.keyboard.press('Escape');
  await p.waitForSelector('#events-modal', { state: 'hidden' });
  await p.waitForTimeout(200);
  log(label + ' 6c: Escape lukker og gir fokus tilbake til kalenderknappen',
    (await p.evaluate(() => document.activeElement && document.activeElement.id)) === 'events-btn',
    await p.evaluate(() => document.activeElement && document.activeElement.id));

  /* ---------- 7) Raden navigerer (PR 1-mekanismen) ---------- */
  await p.locator('#events-btn').click();
  await p.waitForSelector('#events-modal:not([hidden])');
  // «Rapport» ligger i mappen Kontoret — navigeringen må bytte mappe.
  await p.locator('.event-row', { hasText: 'Rapport' }).first().click();
  await p.waitForSelector('#events-modal', { state: 'hidden' });
  await p.waitForFunction((cid) => !!document.querySelector('.card[data-id="' + cid + '"] .card-head.nav-flash'),
    fx.id.L2, { timeout: 5000 });
  // `announce()` tømmer live-området og setter teksten 40 ms etter, slik at to
  // like beskjeder på rad begge blir lest opp. Vent på selve teksten.
  await p.waitForFunction(() => (document.getElementById('a11y-live').textContent || '').length > 0,
    null, { timeout: 5000 }).catch(() => {});
  const nav = await p.evaluate((cid) => {
    const head = document.querySelector('.card[data-id="' + cid + '"] .card-head');
    const r = head.getBoundingClientRect();
    return {
      mappe: document.getElementById('crumb-group-name').textContent,
      markert: head.classList.contains('nav-flash'),
      fokusert: document.activeElement === head,
      iSyne: r.top >= 0 && r.bottom <= window.innerHeight,
      opplest: document.getElementById('a11y-live').textContent,
    };
  }, fx.id.L2);
  log(label + ' 7a: raden bytter mappe og markerer målet',
    nav.mappe === 'Kontoret' && nav.markert, JSON.stringify(nav));
  log(label + ' 7b: målet er fokusert og rullet inn i visningen',
    nav.fokusert && nav.iSyne, JSON.stringify(nav));
  log(label + ' 7c: navigeringen leses opp', /Rapport/.test(nav.opplest || ''), nav.opplest);

  /* ---------- 8) Oppdatering mens modalen står åpen ---------- */
  await p.locator('#events-btn').click();
  await p.waitForSelector('#events-modal:not([hidden])');
  const førAvkryss = (await modalTree(p))[0].rader.map((r) => r.navn);
  await p.evaluate((iid) => {
    const H = window.__huskis;
    const el = document.querySelector('.item[data-id="' + iid + '"] .item-check');
    if (el) el.click();
  }, fx.id.I2);
  await p.waitForFunction(() =>
    ![].slice.call(document.querySelectorAll('.event-row-name')).some((n) => n.textContent === 'Rapport'),
  null, { timeout: 5000 });
  const etterAvkryss = (await modalTree(p))[0].rader.map((r) => r.navn);
  log(label + ' 8a: modalen står fortsatt åpen', !(await p.locator('#events-modal').isHidden()));
  log(label + ' 8b: listen forsvinner når det siste uferdige listepunktet krysses av',
    førAvkryss.includes('Rapport') && !etterAvkryss.includes('Rapport'),
    JSON.stringify(førAvkryss) + ' → ' + JSON.stringify(etterAvkryss));

  /* ---------- 8c) Tiden går, uten at tilstanden endrer seg ----------
     Modalen sover til den FØRSTE grensen en rad er på vei mot, i stedet for å
     pulse. En frist som passerer mens modalen står åpen skal derfor flytte seg
     til «Frist utløpt» av seg selv, uten at noe i tilstanden endret seg.

     Tidsverdier har minutt-oppløsning, så grensen er neste hele minutt: dette
     er en TIDSVINDU-OBSERVASJON, og ventingen kan ikke bindes til en
     tilstandsendring. Den kjøres derfor bare i ett viewport. */
  if (!touchMode) {
    await p.evaluate((iid) => {
      const H = window.__huskis;
      // Reaktiver listepunktet fra 8b, så «Rapport» er en aktiv liste igjen.
      const el = document.querySelector('.item[data-id="' + iid + '"] .item-check');
      if (el) el.click();
    }, fx.id.I2);
    const grense = await p.evaluate(() => {
      const H = window.__huskis;
      const kort = H.state.universes[0].groups
        .reduce((a, g) => a.concat(g.cards || []), []).find((c) => c.title === 'Rapport');
      const pad = (n) => String(n).padStart(2, '0');
      const d = new Date(Date.now() + 60000);   // neste hele minutt
      const v = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
        'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
      // Gjennom den ekte setteren: en rå tilordning ville manglet stemplingen,
      // og neste synk-runde ville rullet verdien tilbake til serverens.
      H.setObjectTime({ kind: 'card', obj: kort, card: kort }, 'due', v);
      H.render();
      return new Date(v).getTime();
    });
    const iGruppe = (navn) => p.evaluate((n) => {
      const heads = [].slice.call(document.querySelectorAll('.events-group-head'));
      const h = heads.find((x) => x.children[1].textContent === n);
      return h ? [].slice.call(h.nextElementSibling.querySelectorAll('.event-row-name')).map((e) => e.textContent) : [];
    }, navn);
    log(label + ' 8c: fristen står i «Frist innen 7 dager» før grensen',
      (await iGruppe('Frist innen 7 dager')).includes('Rapport'), await iGruppe('Frist innen 7 dager'));
    const flyttet = await p.waitForFunction(() => {
      const heads = [].slice.call(document.querySelectorAll('.events-group-head'));
      const h = heads.find((x) => x.children[1].textContent === 'Frist utløpt');
      return !!h && [].slice.call(h.nextElementSibling.querySelectorAll('.event-row-name'))
        .some((e) => e.textContent === 'Rapport');
    }, null, { timeout: 70000, polling: 500 }).then(() => true).catch(() => false);
    log(label + ' 8d: … og flytter seg til «Frist utløpt» av seg selv når den passerer',
      flyttet, 'grense ' + new Date(grense).toISOString());
    log(label + ' 8e: modalen står fortsatt åpen etter flyttingen',
      !(await p.locator('#events-modal').isHidden()));
  }

  /* ---------- 5) Tomtilstand ---------- */
  await p.evaluate(() => {
    const H = window.__huskis;
    H.state.universes.forEach((u) => (u.groups || []).forEach((g) => (g.cards || []).forEach((c) => {
      c.start = null; c.due = null;
      (c.items || []).forEach((it) => { it.start = null; it.due = null; });
    })));
    H.render();
  });
  await p.waitForSelector('#events-body .events-empty', { timeout: 5000 });
  log(label + ' 5: tomtilstand når ingenting har tider',
    (await p.locator('#events-body .events-empty').textContent()).length > 10 &&
    (await p.locator('#events-body .events-section').count()) === 0);
  await p.keyboard.press('Escape');

  /* ---------- 10) Farge er ikke eneste bærer ---------- */
  await seed(p, buildDB());
  await p.locator('#events-btn').click();
  await p.waitForSelector('#events-modal:not([hidden])');
  const farge = await p.evaluate(() => {
    const gul = document.querySelector('.event-icon.is-soon');
    const grønn = document.querySelector('.event-icon.is-later');
    const strek = (el) => el && getComputedStyle(el).getPropertyValue('--icon-ink').trim();
    return { gul: strek(gul), grønn: strek(grønn) };
  });
  log(label + ' 10a: den gule statusflaten pinner en MØRK ikonstrek',
    farge.gul === '#111111', JSON.stringify(farge));
  log(label + ' 10b: den grønne gjør det samme (samme kontraktsfarge i begge drakter)',
    farge.grønn === '#111111', JSON.stringify(farge));
  const tekstbærere = await p.evaluate(() => [].slice.call(document.querySelectorAll('.events-group-head'))
    .every((h) => h.textContent.replace(/\d+/g, '').trim().length > 3));
  log(label + ' 10c: hver gruppe sier i KLARTEKST hva den er, ikke bare med farge', tekstbærere);

  log(label + ': ingen JS-feil', errs.length === 0, errs.join(' | '));
  await browser.close();
}

async function english() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await seed(p, buildDB('en'));
  await p.locator('#events-btn').click();
  await p.waitForSelector('#events-modal:not([hidden])');
  const en = await p.evaluate(() => ({
    tittel: (document.getElementById('events-modal-title').textContent || '').trim(),
    seksjoner: [].slice.call(document.querySelectorAll('.events-section-head')).map((h) => h.textContent),
    grupper: [].slice.call(document.querySelectorAll('.events-group-head')).map((h) => h.children[1].textContent),
    rad: (document.querySelector('.event-row-meta') || {}).textContent,
  }));
  log('9a: modalen finnes på engelsk', en.tittel === 'Upcoming events', en.tittel);
  log('9b: seksjonene er oversatt', eq(en.seksjoner, ['Deadlines', 'Start times']), JSON.stringify(en.seksjoner));
  log('9c: gruppene er oversatt',
    en.grupper.includes('Overdue') && en.grupper.includes('Due within 7 days'), JSON.stringify(en.grupper));
  log('9d: radens type er oversatt', /^List · /.test(en.rad || ''), en.rad);
  log('engelsk: ingen JS-feil', errs.length === 0, errs.join(' | '));
  await browser.close();
}

(async () => {
  await run('desktop', { width: 1200, height: 900 }, false);
  await run('mobil', { width: 390, height: 780 }, true);
  await english();
  const ok = results.filter(Boolean).length;
  console.log('\n==== ' + ok + '/' + results.length + ' PASS ====');
  process.exit(ok === results.length ? 0 : 1);
})();
