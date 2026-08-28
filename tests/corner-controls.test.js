/*
  Regresjonstest: TOPPKONTROLLGRUPPEN i øvre høyre hjørne
  (`.corner-controls` — søk, drakt, konto). Se docs/menus.md
  («Toppkontrollene») og docs/design-system.md.

  Gruppen erstattet to knapper som hver hadde sin egen `right:`-utregning.
  Poenget med denne fila er å låse at den TÅLER FLERE: kalenderknappen (PR 2)
  og varselknappen (PR 3) skal kunne legges til uten en ny utregning noe sted.

  Dekker:
     1. Gruppen finnes, og knappene ligger i rekkefølgen søk → drakt → konto
        (DOM og visuelt), med kontoknappen ytterst.
     2. Alle knappene har kontrollhøyden, samme overkant og lik luft mellom seg
        — ingen av dem er mindre enn berøringsmålet.
     3. Kontoknappen flukter fortsatt med toppmenyens høyre kant.
     4. `--corner-btns-w` MÅLES av appen (gruppens bredde + luften), og er det
        toppmenyen holder av plass med: `.toolbar`s margin på én linje,
        `.breadcrumb`s padding i det stablede mobiloppsettet.
     5. Ingen kollisjon: verken breadcrumben eller listefunksjonene når inn
        under gruppen.
     6. Board-ets klaring ligger under HELE chromet, også når gruppen er
        lavere/høyere enn toppmenyen.
     7. Den sikre sonen: gruppen legger insetene på sin egen avstand, holder
        seg innenfor det brukbare feltet og flukter fortsatt med toppmenyen.
     8. Gruppen SKALERER: legger man til flere knapper, følger den målte
        bredden med, rekkefølgen holder, ingenting kolliderer, og når raden er
        full brytes gruppen nedover — med board-klaringen etter seg.
     9. Hele gruppen er skjult før innlogging.

  Kjøres på BÅDE desktop- og mobil-viewport (toppmenyen er én linje over
  560 px og to rader under).

  Kjør:
    python3 -m http.server 8000                        # fra repo-roten, i egen terminal
    NODE_PATH=$(npm root -g) node tests/corner-controls.test.js
*/
const { chromium } = require('playwright');

const BASE = process.env.HUSKIS_URL || 'http://localhost:8000';
const results = [];
const log = (n, ok, x = '') => { results.push(ok); console.log((ok ? 'PASS' : 'FAIL') + ' — ' + n + (x ? '  [' + x + ']' : '')); };
const nær = (a, b, slack = 1) => Math.abs(a - b) <= slack;

// Fire ULIKE tall, så en regel som bruker feil kant blir synlig.
const SONE = { top: 48, right: 24, bottom: 32, left: 16 };

const U = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
  const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
});

function buildDB() {
  const uid = 'uC';
  const UA = U(), GA = U();
  const base = (x) => Object.assign({
    trashed: false, locked: false, unlocked: false, invite_policy: 'inherit',
    collapsed: false, is_cat: false, cat_id: null,
    ts: 1, org: 'c', pos: 0, pos_ts: 1, pos_org: 'c',
  }, x);
  const cards = [];
  const items = [];
  for (let i = 0; i < 6; i++) {
    const cid = U();
    cards.push(base({ id: cid, owner_id: uid, group_id: GA, title: 'Liste ' + i, pos: i,
      k: true, p: true, lab_ts: 0, lab_org: '' }));
    items.push(base({ id: U(), owner_id: uid, card_id: cid, text: 'Punkt ' + i, done: false }));
  }
  return { uid, db: {
    _rolesBackfilled: true,
    profiles: [{ id: uid, email: 'c@x.no', display_name: 'Kontroll', user_metadata: {} }],
    passwords: { 'c@x.no': 'x' },
    universes: [base({ id: UA, owner_id: uid, name: 'Hjemme' })],
    groups: [base({ id: GA, owner_id: uid, universe_id: UA, name: 'Ukesplan' })],
    cards, items,
    memberships: [{ id: U(), user_id: uid, universe_id: UA, group_id: null, role: 'owner', pos: 0, created_at: 1 }],
    share_invites: [], tombstones: [],
  } };
}

// Geometrien til gruppen og knappene i den, pluss tallene toppmenyen bruker.
const geo = (p) => p.evaluate(() => {
  const g = document.getElementById('corner-controls');
  const gr = g.getBoundingClientRect();
  const kids = [...g.children].map((k) => {
    const r = k.getBoundingClientRect();
    return { id: k.id || null, left: Math.round(r.left), right: Math.round(r.right),
      top: Math.round(r.top), bottom: Math.round(r.bottom),
      w: Math.round(r.width), h: Math.round(r.height) };
  });
  const bar = document.getElementById('topbar').getBoundingClientRect();
  const barCs = getComputedStyle(document.getElementById('topbar'));
  const toolbar = document.querySelector('.topbar .toolbar');
  const first = document.querySelector('.app-main .card');
  /* Kontrollenes EGNE kanter, ikke beholdernes: i det stablede mobiloppsettet
     strekker både `.breadcrumb` og `.toolbar` seg over hele bredden, og det er
     paddingen/marginen i dem som holder innholdet unna hjørnegruppen. */
  const høyreKant = (sel) => {
    const el = document.querySelector(sel);
    if (!el || el.hidden || !el.offsetParent) return 0;
    return Math.round(el.getBoundingClientRect().right);
  };
  const rootCs = getComputedStyle(document.documentElement);
  return {
    group: { left: Math.round(gr.left), right: Math.round(gr.right), top: Math.round(gr.top),
      bottom: Math.round(gr.bottom), w: Math.round(gr.width), h: Math.round(gr.height) },
    kids,
    gap: parseFloat(getComputedStyle(g).columnGap) || 0,
    kontrollH: parseFloat(rootCs.getPropertyValue('--control-h')),
    token: parseFloat(rootCs.getPropertyValue('--corner-btns-w')),
    padTop: parseFloat(rootCs.getPropertyValue('--board-pad-top')),
    barBottom: Math.round(bar.bottom),
    barPadRight: parseFloat(barCs.paddingRight),
    crumbRight: høyreKant('#nav-crumb'),
    crumbPadRight: parseFloat(getComputedStyle(document.querySelector('.breadcrumb')).paddingRight),
    toolbarRight: Math.max(høyreKant('#add-card-btn'), høyreKant('#trash-btn')),
    toolbarMarginRight: parseFloat(getComputedStyle(toolbar).marginRight),
    førsteKortTopp: first ? Math.round(first.getBoundingClientRect().top) : null,
    vw: window.innerWidth,
  };
});

// Vent på at ResizeObserver-en har skrevet den målte bredden.
async function ventPåMåling(p, før) {
  await p.waitForFunction((f) => {
    const v = document.documentElement.style.getPropertyValue('--corner-btns-w');
    return v && v !== f;
  }, før, { timeout: 4000, polling: 50 }).catch(() => { /* uendret bredde er lov */ });
  await p.waitForTimeout(120);
}

async function settSone(p, s) {
  await p.evaluate((sone) => {
    const r = document.documentElement.style;
    if (!sone) { ['top', 'right', 'bottom', 'left'].forEach((k) => r.removeProperty('--safe-' + k)); return; }
    Object.keys(sone).forEach((k) => r.setProperty('--safe-' + k, sone[k] + 'px'));
  }, s || null);
  await p.waitForTimeout(200);
}

async function run(label, viewport, mobile) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext(Object.assign({ viewport }, mobile ? { isMobile: true, hasTouch: true } : {}));
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  console.log('\n== ' + label + ' ==');
  const { uid, db } = buildDB();

  /* ---------- 9) Skjult før innlogging ---------- */
  await p.goto(BASE + '/?mock=1');
  await p.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await p.goto(BASE + '/?mock=1');
  await p.waitForTimeout(700);
  log(label + ' 9: hele gruppen er skjult før innlogging',
    !(await p.locator('#corner-controls').isVisible()));

  await p.evaluate(({ db, uid }) => {
    localStorage.clear(); sessionStorage.clear();
    localStorage.setItem('hk-mock-db', JSON.stringify(db));
    sessionStorage.setItem('hk-mock-session', JSON.stringify({ id: uid, email: 'c@x.no',
      user_metadata: { onboarding: { v: 3, status: 'done' }, tips: { drag: true, trash: true, moveList: true, dragTrash: true } } }));
  }, { db, uid });
  await p.goto(BASE + '/?mock=1');
  await p.waitForFunction(() => {
    const H = window.__huskis;
    return H && H.authUser && H.lastMy && H.state.universes.length > 0;
  }, null, { timeout: 15000, polling: 200 });
  await p.waitForTimeout(400);

  /* ---------- 1–2) Rekkefølge, størrelse, luft ---------- */
  const g = await geo(p);
  const ids = g.kids.map((k) => k.id);
  log(label + ' 1a: gruppen holder søk, drakt og konto i den rekkefølgen',
    JSON.stringify(ids) === JSON.stringify(['search-btn', 'theme-toggle-btn', 'account-btn']), JSON.stringify(ids));
  log(label + ' 1b: kontoknappen er ytterst til høyre',
    g.kids[2].right >= g.kids[1].right && g.kids[1].right >= g.kids[0].right,
    JSON.stringify(g.kids.map((k) => k.right)));
  log(label + ' 2a: alle knappene er kvadratiske og har kontrollhøyden',
    g.kids.every((k) => nær(k.w, g.kontrollH) && nær(k.h, g.kontrollH)),
    JSON.stringify(g.kids.map((k) => k.w + 'x' + k.h)) + ' vs ' + g.kontrollH);
  log(label + ' 2b: knappene står på samme linje',
    g.kids.every((k) => k.top === g.kids[0].top), JSON.stringify(g.kids.map((k) => k.top)));
  const gaps = [g.kids[1].left - g.kids[0].right, g.kids[2].left - g.kids[1].right];
  log(label + ' 2c: lik luft mellom knappene, og den er gruppens gap',
    gaps.every((x) => nær(x, g.gap)), JSON.stringify(gaps) + ' vs gap ' + g.gap);
  log(label + ' 2d: ingen knapp er under berøringsmålet på 44 px',
    g.kids.every((k) => k.w >= 44 && k.h >= 44), JSON.stringify(g.kids.map((k) => k.w)));

  /* ---------- 3) Fluktingen med toppmenyen ---------- */
  const flukt = g.vw - g.group.right;
  log(label + ' 3: gruppen flukter med toppmenyens høyre kant',
    nær(flukt, g.barPadRight), 'gruppe ' + Math.round(flukt) + ' vs panel-padding ' + g.barPadRight);

  /* ---------- 4) Den MÅLTE bredden ---------- */
  log(label + ' 4a: --corner-btns-w er gruppens målte bredde + luften',
    nær(g.token, g.group.w + g.gap), g.token + ' vs ' + (g.group.w + g.gap));
  if (mobile) {
    log(label + ' 4b: breadcrumben holder av plassen (stablet oppsett)',
      nær(g.crumbPadRight, g.token) && g.toolbarMarginRight === 0,
      'crumb-padding ' + g.crumbPadRight + ', toolbar-margin ' + g.toolbarMarginRight);
  } else {
    log(label + ' 4b: listefunksjonene holder av plassen (én linje)',
      nær(g.toolbarMarginRight, g.token) && g.crumbPadRight === 0,
      'toolbar-margin ' + g.toolbarMarginRight + ', crumb-padding ' + g.crumbPadRight);
  }

  /* ---------- 5) Ingen kollisjon ---------- */
  const sisteIToppmeny = mobile ? g.crumbRight : Math.max(g.crumbRight, g.toolbarRight);
  log(label + ' 5: toppmenyens innhold når ikke inn under gruppen',
    sisteIToppmeny <= g.group.left + 1, 'toppmeny høyre ' + sisteIToppmeny + ' ≤ gruppe venstre ' + g.group.left);

  /* ---------- 6) Board-klaringen ---------- */
  log(label + ' 6a: klaringen ligger under HELE chromet',
    g.padTop >= Math.max(g.barBottom, g.group.bottom) - 1,
    'pad-top ' + Math.round(g.padTop) + ', meny bunn ' + g.barBottom + ', gruppe bunn ' + g.group.bottom);
  log(label + ' 6b: første kort ligger under gruppen',
    g.førsteKortTopp !== null && g.førsteKortTopp >= g.group.bottom - 1,
    'kort topp ' + g.førsteKortTopp + ', gruppe bunn ' + g.group.bottom);

  /* ---------- 7) Den sikre sonen ---------- */
  const førSone = await p.evaluate(() => document.documentElement.style.getPropertyValue('--corner-btns-w'));
  await settSone(p, SONE);
  const s = await geo(p);
  log(label + ' 7a: gruppen skyves ned forbi statusfeltet',
    nær(s.group.top, g.group.top + SONE.top), g.group.top + ' → ' + s.group.top + ' (sone ' + SONE.top + ')');
  log(label + ' 7b: gruppen tar hakket i høyre side',
    nær(s.vw - s.group.right, (g.vw - g.group.right) + SONE.right),
    'høyre ' + (g.vw - g.group.right) + ' → ' + (s.vw - s.group.right));
  log(label + ' 7c: gruppen ligger innenfor det brukbare feltet',
    s.group.left >= SONE.left - 1 && s.group.right <= s.vw - SONE.right + 1 && s.group.top >= SONE.top - 1,
    JSON.stringify(s.group));
  log(label + ' 7d: gruppen flukter fortsatt med toppmenyens kant',
    nær(s.vw - s.group.right, s.barPadRight),
    'gruppe ' + (s.vw - s.group.right) + ' vs panel-padding ' + s.barPadRight);
  log(label + ' 7e: klaringen følger med', s.padTop >= Math.max(s.barBottom, s.group.bottom) - 1,
    'pad-top ' + Math.round(s.padTop) + ', chrome bunn ' + Math.max(s.barBottom, s.group.bottom));
  await settSone(p, null);
  await p.waitForTimeout(200);
  void førSone;

  /* ---------- 8) Gruppen skalerer ---------- */
  // To knapper til — nøyaktig det PR 2 (kalender) og PR 3 (varsler) gjør: en
  // ny `.corner-btn` FØRST i gruppen. Ingen CSS-verdi skal måtte endres.
  const førBredde = await p.evaluate(() => document.documentElement.style.getPropertyValue('--corner-btns-w'));
  await p.evaluate(() => {
    const g = document.getElementById('corner-controls');
    for (let i = 0; i < 2; i++) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'corner-btn';
      b.id = 'fremtid-' + i;
      g.insertBefore(b, g.firstElementChild);
    }
  });
  await ventPåMåling(p, førBredde);
  const f = await geo(p);
  log(label + ' 8a: de nye knappene står først, konto fortsatt ytterst',
    f.kids.length === 5 && f.kids[0].id === 'fremtid-1' && f.kids[4].id === 'account-btn',
    JSON.stringify(f.kids.map((k) => k.id)));
  log(label + ' 8b: den målte bredden vokste med de to knappene',
    nær(f.token, f.group.w + f.gap) && f.token > g.token,
    g.token + ' → ' + f.token);
  log(label + ' 8c: gruppen flukter fortsatt med toppmenyens kant',
    nær(f.vw - f.group.right, f.barPadRight),
    'gruppe ' + (f.vw - f.group.right) + ' vs panel-padding ' + f.barPadRight);
  const sisteNå = mobile ? f.crumbRight : Math.max(f.crumbRight, f.toolbarRight);
  log(label + ' 8d: toppmenyens innhold viker fortsatt for gruppen',
    sisteNå <= f.group.left + 1, 'toppmeny høyre ' + sisteNå + ' ≤ gruppe venstre ' + f.group.left);
  log(label + ' 8e: gruppen ligger innenfor viewportet',
    f.group.left >= 0 && f.group.right <= f.vw, JSON.stringify(f.group));

  // Fyll raden helt: da skal gruppen BRYTE nedover, ikke krympe knappene eller
  // renne ut av skjermen — og board-klaringen skal følge etter. Antallet
  // avhenger av skjermbredden, så det legges til knapper til raden faktisk er
  // full (med et tak, så en regresjon blir en FAIL og ikke en evig løkke).
  const antallFørBrudd = await p.evaluate(() => {
    const g = document.getElementById('corner-controls');
    const rader = () => new Set([...g.children].map((k) => Math.round(k.getBoundingClientRect().top))).size;
    let n = 0;
    while (rader() === 1 && n < 40) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'corner-btn';
      b.id = 'fyll-' + n;
      g.insertBefore(b, g.firstElementChild);
      n++;
    }
    return n;
  });
  await p.waitForTimeout(400);
  const w = await geo(p);
  const rader = new Set(w.kids.map((k) => k.top)).size;
  log(label + ' 8f: gruppen brytes til flere rader i stedet for å renne ut',
    rader > 1 && w.group.right <= w.vw && w.group.left >= 0,
    rader + ' rader etter ' + antallFørBrudd + ' ekstra knapper, gruppe '
      + JSON.stringify(w.group) + ', vw ' + w.vw);
  log(label + ' 8g: ingen knapp krympet under kontrollhøyden',
    w.kids.every((k) => nær(k.w, w.kontrollH) && nær(k.h, w.kontrollH)),
    JSON.stringify([...new Set(w.kids.map((k) => k.w + 'x' + k.h))]));
  log(label + ' 8h: board-klaringen følger gruppens nye underkant',
    w.padTop >= Math.max(w.barBottom, w.group.bottom) - 1,
    'pad-top ' + Math.round(w.padTop) + ', gruppe bunn ' + w.group.bottom);
  log(label + ' 8i: kontoknappen er fortsatt ytterst nederst til høyre',
    w.kids[w.kids.length - 1].id === 'account-btn'
      && w.kids[w.kids.length - 1].right === Math.max(...w.kids.map((k) => k.right)),
    JSON.stringify(w.kids[w.kids.length - 1]));

  log(label + ': ingen JS-feil', errs.length === 0, errs.join(' | '));
  await browser.close();
}

(async () => {
  await run('desktop', { width: 1200, height: 900 }, false);
  await run('mobil', { width: 390, height: 780 }, true);
  const pass = results.filter(Boolean).length;
  console.log('\n==== ' + pass + '/' + results.length + ' PASS ====');
  process.exit(pass === results.length ? 0 : 1);
})();
