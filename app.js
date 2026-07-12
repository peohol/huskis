/* ============================================================
   Huskekurv — app.js
   Vanilla JS. Egen dra-og-slipp-motor på Pointer Events.
   ============================================================ */
(function () {
  'use strict';

  /* ---------------- Konstanter ---------------- */
  const STORAGE_KEY = 'mine-lister-v1';

  // Faste, deterministiske gruppe-id-er brukt ved migrering fra den gamle
  // to-fane-modellen (Huskelister/Handlelister) og for eksempeldata. Faste id-er
  // gjør at alle enheter migrerer til de SAMME gruppene → ingen duplisering ved
  // fletting.
  const LEGACY_TABS = [
    { id: 'grp-huskelister', name: 'Huskelister', key: 'huskelister' },
    { id: 'grp-handlelister', name: 'Handlelister', key: 'handlelister' },
  ];

  // Fast, deterministisk id/navn for universet eksisterende data migreres inn i
  // (Univers > Gruppe > Liste > Element). Fast id → alle enheter migrerer til
  // det SAMME universet, uten duplisering ved fletting.
  const DEFAULT_UNI = { id: 'uni-standard', name: 'Standard' };

  /* ---------------- Fargesystem (HSL, posisjonsbasert) ----------------
     Kort (og gruppekort) får farge ut fra POSISJONEN sin (indeks i den synlige,
     sorterte lista) — ikke en lagret tilfeldig farge. Derfor re-indekseres og
     re-fargelegges de fortløpende når man legger til, sletter eller endrer
     rekkefølge. Målet er maksimal separasjon mellom nabo-kort:
       • Alle farger deler samme S.
       • Flere L-nivåer utgjør «sett»; man fyller sett 1 først, så sett 2, osv.
       • Innen et sett hopper fargetonen (H) i lange steg (HUE_STEP), fordelt på
         flere forskjøvne «sveip», så to nabo-indekser ligger langt fra hverandre
         på fargehjulet.
     Alt styres av konstantene under (justerbart/skalerbart — endre antall nivåer
     eller steg uten å røre resten). Farger lagres ikke/synkes ikke; de utledes
     ved rendring (rekkefølgen `pos` synkes, så alle enheter får samme farger). */
  const COLOR_SAT = 20;                 // S (%) — likt for alle farger
  const COLOR_LIGHTNESS = [60, 75, 90]; // L (%) per sett (sett 1, 2, 3 …)
  const HUE_STEP = 60;                  // hopp mellom nabo-indekser (grader)
  const HUE_COUNT = 12;                 // antall toner per sett

  // Bygg tone-rekkefølgen: start på 0° og øk med HUE_STEP til vi er rundt, så
  // start forskjøvet (med den fine oppløsningen) og øk med HUE_STEP igjen, til vi
  // har HUE_COUNT toner. HUE_STEP=60, HUE_COUNT=12 gir:
  //   [0,60,120,180,240,300, 30,90,150,210,270,330].
  function buildHueOrder(count, step) {
    const fine = 360 / count;                             // fin oppløsning (30° for 12)
    const perSweep = Math.max(1, Math.round(360 / step)); // toner pr. sveip (6)
    const sweeps = Math.max(1, Math.round((count * step) / 360)); // antall sveip (2)
    const order = [];
    for (let s = 0; s < sweeps && order.length < count; s++) {
      for (let k = 0; k < perSweep && order.length < count; k++) {
        order.push(((s * fine) + (k * step)) % 360);
      }
    }
    return order;
  }
  const HUE_ORDER = buildHueOrder(HUE_COUNT, HUE_STEP);
  const COLOR_COUNT = HUE_ORDER.length * COLOR_LIGHTNESS.length; // farger før repetisjon

  function hslToHex(h, s, l) {
    s /= 100; l /= 100;
    const a = s * Math.min(l, 1 - l);
    const f = (n) => {
      const k = (n + h / 30) % 12;
      const c = l - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)));
      return Math.round(255 * c).toString(16).padStart(2, '0');
    };
    return '#' + f(0) + f(8) + f(4);
  }

  // Farge for indeks i: tonen velges av (i % antall toner), settet (L-nivå) av
  // hvor mange hele runder vi har fylt (floor(i / antall toner)). Wrapper rundt.
  function colorForIndex(i) {
    i = ((i % COLOR_COUNT) + COLOR_COUNT) % COLOR_COUNT;
    const hue = HUE_ORDER[i % HUE_ORDER.length];
    const level = Math.floor(i / HUE_ORDER.length) % COLOR_LIGHTNESS.length;
    return hslToHex(hue, COLOR_SAT, COLOR_LIGHTNESS[level]);
  }
  // Stabil reservefarge (f.eks. til søppelkasse-prikker) når en entitet ikke er
  // synlig og derfor mangler posisjonsfarge: utled deterministisk fra id-en.
  function colorForId(id) {
    const s = String(id);
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) >>> 0;
    return colorForIndex(h % COLOR_COUNT);
  }

  /* ---------------- Hjelpere ---------------- */
  // Ekte UUID-er: de relasjonelle fase 2-tabellene har `uuid`-kolonner (id +
  // forelder-FK-er), så nye objekter MÅ ha gyldige UUID-er ellers avviser
  // PostgREST insert-en. crypto.randomUUID() finnes i sikre kontekster
  // (https/localhost); ellers en RFC4122-kompatibel reserve. UUID-er er også
  // gyldige streng-id-er i synk-doc v1 (mønster-lås), så dette gjelder begge modi.
  function uid() {
    try { if (window.crypto && crypto.randomUUID) return crypto.randomUUID(); } catch (e) { /* ignore */ }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });
  }

  function hexToRgb(hex) {
    const h = hex.replace('#', '');
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
    };
  }
  function darken(hex, amt) {
    const { r, g, b } = hexToRgb(hex);
    const f = (c) => Math.max(0, Math.round(c * (1 - amt)));
    const to = (c) => c.toString(16).padStart(2, '0');
    return '#' + to(f(r)) + to(f(g)) + to(f(b));
  }

  // Respekter operativsystemets «reduser bevegelse»-innstilling: fly-/FLIP-/
  // sprett-animasjoner hoppes over når den er på (tilgjengelighet).
  function prefersReducedMotion() {
    try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
    catch (e) { return false; }
  }

  /* ---------------- Synk-metadata: enhet, klokke, stempling ----------------
     For å kunne flette endringer fra flere enheter (à la git) har hver
     entitet (kort/element) to «registre»:
       • innhold  (tittel/tekst/farge/trashed)  → felt: ts, org
       • posisjon (rekkefølge + evt. ny forelder) → felt: pos, posTs, posOrg
     Ved fletting velges nyeste register per felt (LWW). Å endre ulike
     entiteter/felter gir aldri konflikt; kun endring på samme register
     på to enheter «konflikter», og da vinner den nyeste. */
  const DEVICE_KEY = 'mine-lister-device';
  let deviceId = localStorage.getItem(DEVICE_KEY);
  if (!deviceId) {
    deviceId = 'd-' + Math.random().toString(36).slice(2, 10);
    try { localStorage.setItem(DEVICE_KEY, deviceId); } catch (e) { /* ignore */ }
  }

  // Hybrid logisk klokke: monotont voksende tidsstempel. Robust mot at
  // enhetenes veggklokker går litt i utakt (bruker max av lokal tid og sist sette).
  let hlc = 0;
  function tick() { hlc = Math.max(hlc + 1, Date.now()); return hlc; }
  function observeTs(t) { if (typeof t === 'number' && t > hlc) hlc = t; }

  function stampContent(e) { e.ts = tick(); e.org = deviceId; }   // tittel/tekst/farge/trashed
  function stampPos(e) { e.posTs = tick(); e.posOrg = deviceId; } // rekkefølge/forelder

  // Nyere av to registre: sammenlign (ts, org). org bryter uavgjort deterministisk.
  function newer(aTs, aOrg, bTs, bOrg) {
    aTs = aTs || 0; bTs = bTs || 0;
    if (aTs !== bTs) return aTs > bTs;
    return String(aOrg || '') > String(bOrg || '');
  }

  // Fraksjonsindeksering for rekkefølge: en pos-verdi mellom to naboer.
  function between(a, b) {
    if (a == null && b == null) return 0;
    if (a == null) return b - 1;
    if (b == null) return a + 1;
    return (a + b) / 2;
  }
  function maxPos(arr) { return arr.reduce((m, e) => Math.max(m, e.pos || 0), 0); }

  // Tastatur-reordering: ny pos-verdi når objektet på indeks i i den sorterte,
  // synlige lista flyttes ett hakk (dir −1 opp / +1 ned) — mellom de nye naboene.
  function neighborPos(sorted, i, dir) {
    if (dir < 0) return between(i - 2 >= 0 ? sorted[i - 2].pos : null, sorted[i - 1].pos);
    return between(sorted[i + 1].pos, i + 2 < sorted.length ? sorted[i + 2].pos : null);
  }
  // Piltast → retning. horizontal=true tar også med venstre/høyre (gruppe-rader
  // kan ligge horisontalt på mobil).
  function arrowDir(ev, horizontal) {
    if (ev.key === 'ArrowUp') return -1;
    if (ev.key === 'ArrowDown') return 1;
    if (horizontal && ev.key === 'ArrowLeft') return -1;
    if (horizontal && ev.key === 'ArrowRight') return 1;
    return 0;
  }

  /* ---------------- State ---------------- */
  function makeItem(text, homeId) {
    return {
      id: uid(), text, home: homeId, trashed: false, done: false,
      ts: 0, org: deviceId,           // innholdsregister (tekst/trashed/done)
      pos: 0, posTs: 0, posOrg: deviceId, // posisjonsregister (rekkefølge/forelder)
    };
  }

  function card(title, items, groupId) {
    const id = uid();
    const c = {
      // Farge lagres ikke: den utledes av posisjon ved rendring (colorForIndex).
      id, group: groupId || null, title, trashed: false, k: true, p: true,
      ts: 0, org: deviceId,           // innholdsregister (tittel/farge/trashed)
      labTs: 0, labOrg: deviceId,     // merkelapp-register (k/p) — uavhengig av innhold
      pos: 0, posTs: 0, posOrg: deviceId, // posisjonsregister (rekkefølge + gruppe-forelder)
      items: [],
    };
    (items || []).forEach((t, i) => {
      const it = makeItem(t, id);
      it.pos = i;
      c.items.push(it);
    });
    return c;
  }

  // En gruppe er nivå to (Univers > Gruppe > Liste > Element). Den har innholds-
  // register (navn) og posisjonsregister (rekkefølge + univers-forelder), og
  // eier sine lister.
  function makeGroup(name, id, uniId) {
    return {
      id: id || uid(), uni: uniId || null, name, trashed: false,
      ts: 0, org: deviceId,               // innholdsregister (navn/trashed)
      pos: 0, posTs: 0, posOrg: deviceId, // posisjonsregister (rekkefølge + univers)
      cards: [],
    };
  }

  // Et univers er øverste nivå — et helt uavhengig område med egne grupper.
  // Grupper kan aldri flyttes på tvers av universer.
  function makeUniverse(name, id) {
    return {
      id: id || uid(), name, trashed: false,
      ts: 0, org: deviceId,               // innholdsregister (navn/trashed)
      pos: 0, posTs: 0, posOrg: deviceId, // posisjonsregister (rekkefølge)
      groups: [],
    };
  }

  // Eksempeldata (kun uten sky): to grupper som speiler de gamle fanene,
  // pakket inn i standard-universet.
  function seedUniverses() {
    const u = makeUniverse(DEFAULT_UNI.name, DEFAULT_UNI.id);
    const defs = [
      { g: LEGACY_TABS[0], lists: [
        ['Ukens gjøremål', ['Rydde garasjen', 'Ringe tannlegen', 'Vanne blomstene']],
        ['Pakke til tur', ['Regnjakke', 'Ladekabel', 'Drikkeflaske', 'Kart']],
        ['Ideer', ['Male gjerdet', 'Prøve ny kaffebar']],
      ] },
      { g: LEGACY_TABS[1], lists: [
        ['Dagligvarer', ['Melk', 'Brød', 'Egg', 'Smør', 'Kaffe']],
        ['Middag i kveld', ['Kyllingfilet', 'Ris', 'Brokkoli', 'Soyasaus']],
        ['Apotek', ['Plaster', 'Solkrem']],
      ] },
    ];
    u.groups = defs.map((d, gi) => {
      const g = makeGroup(d.g.name, d.g.id, u.id);
      g.pos = gi;
      d.lists.forEach((l, i) => { const c = card(l[0], l[1], g.id); c.pos = i; g.cards.push(c); });
      return g;
    });
    return [u];
  }

  function baseState(seeded) {
    const universes = seeded ? seedUniverses() : [];
    const firstGroups = universes.length ? universes[0].groups : [];
    return {
      activeUniverse: universes.length ? universes[0].id : null, // per enhet, synkes ikke
      activeGroup: firstGroups.length ? firstGroups[0].id : null, // per enhet, synkes ikke
      activeGroups: {}, // uniId → sist aktive gruppe der (per enhet, synkes ikke)
      universes,
      _tomb: { universes: {}, groups: {}, cards: {}, items: {} }, // gravsteiner: id → tidsstempel
      _hlc: 0,
    };
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return null;
      // Godta ny (universes), forrige (groups) og eldste (tabs) form — normalize migrerer.
      if (!Array.isArray(parsed.universes) && !Array.isArray(parsed.groups) && !parsed.tabs) return null;
      return parsed;
    } catch (e) {
      return null;
    }
  }

  let saveTimer = null;
  // Serialisering hopper over intern backend-metadata (_parent/_mount/_canon/…),
  // som ellers ville gitt sykliske referanser i kontomodus. State-nivå _tomb/_hlc
  // beholdes. _mine (en ren boolsk verdi, ingen sirkulær referanse) beholdes også,
  // slik at Mine/Delte-filteret har et riktig eierskaps-signal fra cachet state
  // på kalde reloads/offline — før en vellykket get_my_doc overskriver den friskt.
  function stateReplacer(k, v) {
    return (k && k[0] === '_' && k !== '_tomb' && k !== '_hlc' && k !== '_mine') ? undefined : v;
  }
  function save() {
    clearTimeout(saveTimer);
    const accounts = accountsMode() && authUser;
    const key = accounts ? (STORAGE_KEY + ':' + authUser.id) : STORAGE_KEY;
    saveTimer = setTimeout(() => {
      try {
        state._hlc = hlc;
        localStorage.setItem(key, JSON.stringify(state, stateReplacer));
      } catch (e) {
        /* ignore quota */
      }
    }, 120);
    if (applyingRemote) return;
    if (accountsMode()) {
      if (authUser) scheduleCloud();
    } else if (syncCode && cloudConfigured()) {
      // Sky-synk v1 (mønster-lås): flett + push (debouncet).
      scheduleSync();
    }
  }

  // Første gang (ingen lokal state): start tom når sky-synk er konfigurert
  // (skyen fyller på / tom-tilstanden veileder), ellers med eksempeldata.
  const state = load() || baseState(!cloudConfigured());

  // Migrering (steg 1): gjør om den gamle to-fane-modellen til grupper. To faste
  // grupper (Huskelister/Handlelister) med deterministiske id-er, slik at alle
  // enheter migrerer likt. Kjøres på gammel lagret state.
  function migrateTabsToGroups(s) {
    if (Array.isArray(s.universes) || Array.isArray(s.groups) || !s.tabs) return;
    s.groups = LEGACY_TABS.map((m, gi) => {
      const g = makeGroup(m.name, m.id);
      g.pos = gi;
      const tab = s.tabs[m.key] || {};
      const list = Array.isArray(tab.cards) ? tab.cards.slice() : [];
      // Gammel papirkurv (egen array) → trashed-flagg på kortene.
      if (Array.isArray(tab.trash)) tab.trash.forEach((c) => { c.trashed = true; list.push(c); });
      list.forEach((c) => { c.group = m.id; g.cards.push(c); });
      return g;
    });
    s.activeGroup = s.activeTab === 'handlelister' ? 'grp-handlelister' : 'grp-huskelister';
    delete s.tabs;
    delete s.activeTab;
  }

  // Migrering (steg 2): pakk en flat gruppe-tilstand inn i standard-universet.
  // Fast id (uni-standard) → alle enheter migrerer likt, ingen duplisering.
  function migrateGroupsToUniverses(s) {
    if (Array.isArray(s.universes) || !Array.isArray(s.groups)) return;
    const u = makeUniverse(DEFAULT_UNI.name, DEFAULT_UNI.id);
    s.groups.forEach((g) => { g.uni = u.id; u.groups.push(g); });
    s.universes = [u];
    s.activeUniverse = u.id;
    delete s.groups;
  }

  // Normaliser: gi (evt. eldre) lagret state forventet struktur og synk-metadata.
  function normalizeItem(it, homeId, j) {
    if (!it.home) it.home = homeId;
    if (typeof it.trashed !== 'boolean') it.trashed = false;
    if (typeof it.done !== 'boolean') it.done = false;
    if (typeof it.ts !== 'number') it.ts = 0;
    if (!it.org) it.org = deviceId;
    if (typeof it.pos !== 'number') it.pos = j;
    if (typeof it.posTs !== 'number') it.posTs = 0;
    if (!it.posOrg) it.posOrg = deviceId;
  }
  function normalizeCard(c, groupId, i) {
    if (!c.group) c.group = groupId;
    if (typeof c.trashed !== 'boolean') c.trashed = false;
    if (typeof c.k !== 'boolean') c.k = true;
    if (typeof c.p !== 'boolean') c.p = true;
    if (typeof c.ts !== 'number') c.ts = 0;
    if (!c.org) c.org = deviceId;
    if (typeof c.labTs !== 'number') c.labTs = 0;
    if (!c.labOrg) c.labOrg = deviceId;
    if (typeof c.pos !== 'number') c.pos = i;
    if (typeof c.posTs !== 'number') c.posTs = 0;
    if (!c.posOrg) c.posOrg = deviceId;
    if (!Array.isArray(c.items)) c.items = [];
    c.items.forEach((it, j) => normalizeItem(it, c.id, j));
  }
  function normalizeGroup(g, i, uniId) {
    if (!g.id) g.id = uid();
    if (!g.uni) g.uni = uniId || null;
    if (typeof g.name !== 'string') g.name = 'Uten navn';
    if (typeof g.trashed !== 'boolean') g.trashed = false;
    if (typeof g.ts !== 'number') g.ts = 0;
    if (!g.org) g.org = deviceId;
    if (typeof g.pos !== 'number') g.pos = i;
    if (typeof g.posTs !== 'number') g.posTs = 0;
    if (!g.posOrg) g.posOrg = deviceId;
    if (!Array.isArray(g.cards)) g.cards = [];
    g.cards.forEach((c, ci) => normalizeCard(c, g.id, ci));
  }
  function normalizeUniverse(u, i) {
    if (!u.id) u.id = uid();
    if (typeof u.name !== 'string') u.name = 'Uten navn';
    if (typeof u.trashed !== 'boolean') u.trashed = false;
    if (typeof u.ts !== 'number') u.ts = 0;
    if (!u.org) u.org = deviceId;
    if (typeof u.pos !== 'number') u.pos = i;
    if (typeof u.posTs !== 'number') u.posTs = 0;
    if (!u.posOrg) u.posOrg = deviceId;
    if (!Array.isArray(u.groups)) u.groups = [];
    u.groups.forEach((g, gi) => normalizeGroup(g, gi, u.id));
  }
  // activeUniverse/activeGroup må peke på eksisterende, ikke-slettede entiteter;
  // activeGroups-minnet (per univers) brukes som fallback før «første synlige».
  function validateActive(s) {
    if (!s.activeGroups || typeof s.activeGroups !== 'object') s.activeGroups = {};
    if (!s.universes.some((u) => u.id === s.activeUniverse && !u.trashed)) {
      let first = null;
      s.universes.forEach((u) => { if (!u.trashed && (!first || u.pos < first.pos)) first = u; });
      s.activeUniverse = first ? first.id : null;
    }
    const uni = s.universes.find((u) => u.id === s.activeUniverse && !u.trashed) || null;
    const groups = uni ? uni.groups.filter((g) => !g.trashed) : [];
    const ok = (id) => id && groups.some((g) => g.id === id);
    if (!ok(s.activeGroup)) {
      const remembered = uni ? s.activeGroups[uni.id] : null;
      let first = null;
      groups.forEach((g) => { if (!first || g.pos < first.pos) first = g; });
      s.activeGroup = ok(remembered) ? remembered : (first ? first.id : null);
    }
    if (s.activeUniverse) s.activeGroups[s.activeUniverse] = s.activeGroup;
  }
  function normalize(s) {
    migrateTabsToGroups(s);
    migrateGroupsToUniverses(s);
    if (!Array.isArray(s.universes)) s.universes = [];
    if (!s._tomb || typeof s._tomb !== 'object') s._tomb = { universes: {}, groups: {}, cards: {}, items: {} };
    if (!s._tomb.universes) s._tomb.universes = {};
    if (!s._tomb.groups) s._tomb.groups = {};
    if (!s._tomb.cards) s._tomb.cards = {};
    if (!s._tomb.items) s._tomb.items = {};
    if (typeof s._hlc !== 'number') s._hlc = 0;
    s.universes.forEach((u, i) => normalizeUniverse(u, i));
    validateActive(s);
    observeTs(s._hlc);
  }
  normalize(state);
  hlc = Math.max(hlc, state._hlc || 0);

  /* ---------------- DOM-referanser ---------------- */
  const board = document.getElementById('board');
  const appHeader = document.getElementById('app-header');
  const groupsBar = document.getElementById('groups-bar');
  const addGroupBtn = document.getElementById('add-group-btn');
  const groupsPanelTitle = document.getElementById('groups-panel-title');
  const listerPanelTitle = document.getElementById('lister-panel-title');
  const addCardBtn = document.getElementById('add-card-btn');
  const shareUniBtn = document.getElementById('share-uni-btn');
  const shareGroupBtn = document.getElementById('share-group-btn');
  const toolbarEl = document.querySelector('.toolbar');
  const filterSwitchesEl = document.getElementById('filter-switches');
  const groupTpl = document.getElementById('group-template');
  const uniTpl = document.getElementById('uni-template');
  const cardTpl = document.getElementById('card-template');
  const itemTpl = document.getElementById('item-template');

  const trashBtn = document.getElementById('trash-btn');
  const trashCount = document.getElementById('trash-count');
  const trashTitle = document.getElementById('trash-title-text');
  const trashModal = document.getElementById('trash-modal');
  const trashList = document.getElementById('trash-list');
  const trashClose = document.getElementById('trash-close');
  const trashEmptyBtn = document.getElementById('trash-empty');
  const modalNote = document.getElementById('trash-note');

  // Gruppe-søppelkasse: i knapperaden øverst i gruppemenyen, ved siden av «＋ Gruppe».
  const groupsTrashBtn = document.getElementById('groups-trash-btn');
  const groupsTrashCount = document.getElementById('groups-trash-count');

  // Meny-modal (☰): logg ut + universer (bytt/opprett/omdøp/slett + søppelkasse).
  const menuModal = document.getElementById('menu-modal');
  const menuClose = document.getElementById('menu-close');
  const menuBtn = document.getElementById('menu-btn');
  const uniList = document.getElementById('uni-list');
  const addUniBtn = document.getElementById('add-uni-btn');
  const uniTrashBtn = document.getElementById('uni-trash-btn');
  const uniTrashCount = document.getElementById('uni-trash-count');

  const posCmp = (a, b) => (a.pos - b.pos) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  // Univers-scope: «aktive» grupper gjelder alltid det aktive universet, og
  // «aktive» kort/elementer den aktive gruppen. Universer er helt uavhengige
  // områder — alt gruppe-UI (header, søppelkasse, DnD) er scopet hit.
  const activeUniverseObj = () => state.universes.find((u) => u.id === state.activeUniverse && !u.trashed) || null;
  const visibleUniverses = () => state.universes.filter((u) => !u.trashed).sort(posCmp); // i meny-modalen
  const trashedUniverses = () => state.universes.filter((u) => u.trashed);               // i univers-søppelkassen
  const findUniverse = (id) => state.universes.find((u) => u.id === id) || null;
  const allGroups = () => { const u = activeUniverseObj(); return u ? u.groups : []; };
  const activeGroupObj = () => allGroups().find((g) => g.id === state.activeGroup && !g.trashed) || null;
  const visibleGroups = () => allGroups().filter((g) => !g.trashed).sort(posCmp); // vist i gruppemenyen
  const trashedGroups = () => allGroups().filter((g) => g.trashed);               // i gruppe-søppelkassen
  const findGroup = (id) => allGroups().find((g) => g.id === id) || null;
  const allCards = () => { const g = activeGroupObj(); return g ? g.cards : []; };
  const activeCards = () => allCards().filter((c) => !c.trashed).sort(posCmp);
  const trashedCards = () => allCards().filter((c) => c.trashed);
  const findCard = (id) => allCards().find((c) => c.id === id);
  const trashedItemsOf = (cardData) => (cardData.items || []).filter((it) => it.trashed);
  function findItemById(id) {
    for (const c of allCards()) {
      const it = c.items.find((x) => x.id === id);
      if (it) return it;
    }
    return null;
  }

  // Aktiv gruppe settes alltid via denne, så per-univers-minnet (activeGroups)
  // holdes i takt og man lander på samme gruppe når man bytter tilbake.
  function setActiveGroup(id) {
    state.activeGroup = id || null;
    if (state.activeUniverse) state.activeGroups[state.activeUniverse] = state.activeGroup;
  }
  function setActiveUniverse(id) {
    state.activeUniverse = id || null;
    const vis = visibleGroups();
    const remembered = id ? state.activeGroups[id] : null;
    setActiveGroup(remembered && vis.some((g) => g.id === remembered)
      ? remembered
      : (vis[0] ? vis[0].id : null));
  }

  /* ---------------- Filter (Mine / Delte) ----------------
     Per enhet (ikke synket). To uavhengige brytere: «Mine» (lister du selv har
     opprettet) og «Delte» (lister andre har delt med deg — kun kontomodus;
     alltid tomt utenfor kontomodus siden deling ikke finnes der). Begge kan stå
     på samtidig (viser alt), eller begge av (skjuler alt). Kort trykk på en
     bryter = vanlig toggle; hold i FILTER_HOLD_MS → aktiver kun den bryteren
     (skru av den andre) — se klikk-/hold-håndteringen ved filterSwitchesEl. */
  const FILTER_KEY = 'mine-lister-filter';
  const FILTERS = ['mine', 'delt'];
  function loadFilter() {
    try {
      const f = JSON.parse(localStorage.getItem(FILTER_KEY));
      if (f && typeof f === 'object') return { mine: f.mine !== false, delt: f.delt !== false };
    } catch (e) { /* ignore */ }
    return { mine: true, delt: true };
  }
  const filter = loadFilter();
  function saveFilter() {
    try { localStorage.setItem(FILTER_KEY, JSON.stringify(filter)); } catch (e) { /* ignore */ }
  }
  // Er kortet delt med meg av noen andre? (Utenfor kontomodus er alt «mine».)
  function cardIsShared(c) { return accountsMode() && c._mine === false; }
  function cardMatchesFilter(c) {
    return cardIsShared(c) ? filter.delt : filter.mine;
  }

  /* ---------------- Render ---------------- */
  // Lister-søppelkassen vises kun når den har innhold (samme logikk som de andre).
  function updateTrashCount() {
    const n = trashedCards().length;
    trashCount.textContent = n;
    trashBtn.hidden = n === 0;
  }

  function render() {
    renderGroups();
    renderUniverses();
    updateTrashCount();
    renderFilterSwitches();
    updateToolbarState();
    updateShareButtons();

    board.innerHTML = '';
    const group = activeGroupObj();
    updatePanelTitles(group);

    // Ingen aktiv gruppe (evt. heller ikke noe univers — «＋ Gruppe» ordner begge).
    if (!group) {
      board.classList.add('empty');
      const es = document.createElement('div');
      es.className = 'empty-state';
      es.innerHTML = '<div class="big">' + ICONS.folder + '</div><p>Ingen grupper ennå.</p>' +
        '<p>Trykk «＋ Gruppe» for å komme i gang.</p>';
      board.appendChild(es);
      fixBoardBottomGap();
      save();
      return;
    }

    const active = activeCards();
    // Posisjonsbasert farge: kortene re-fargelegges her (etter add/slett/omrokkering)
    // ut fra sin indeks i den synlige, sorterte lista — uavhengig av filteret.
    active.forEach((c, i) => { c.color = colorForIndex(i); });
    const cards = active.filter(cardMatchesFilter);

    if (cards.length === 0) {
      board.classList.add('empty');
      const es = document.createElement('div');
      es.className = 'empty-state';
      if (active.length === 0) {
        const big = document.createElement('div'); big.className = 'big'; big.innerHTML = ICONS.list;
        const p1 = document.createElement('p'); p1.textContent = 'Ingen lister i «' + group.name + '» ennå.';
        const p2 = document.createElement('p'); p2.textContent = 'Trykk «＋ Liste» for å komme i gang.';
        es.append(big, p1, p2);
      } else {
        es.innerHTML = '<div class="big">' + ICONS.eye + '</div><p>Ingen lister passer filteret.</p>' +
          '<p>Skru på Mine eller Delte for å se flere.</p>';
      }
      board.appendChild(es);
      fixBoardBottomGap();
      save();
      return;
    }

    board.classList.remove('empty');
    cards.forEach((c) => board.appendChild(buildCard(c)));
    fixBoardBottomGap();
    save();
  }

  // «＋ Liste» gir bare mening med en aktiv gruppe. («＋ Gruppe» virker alltid:
  // finnes ikke noe univers, opprettes standard-universet i farten.)
  function updateToolbarState() {
    addCardBtn.disabled = !activeGroupObj();
  }

  // Del-knappene i menyene (kontomodus): del-univers ved siden av «＋ Gruppe»
  // (deler det AKTIVE universet), del-gruppe ved siden av «＋ Liste» (deler den
  // AKTIVE gruppen). Vises kun når objektet er ens eget eller montert — samme
  // vilkår som de gamle per-kort-del-knappene. Klikk-handlere er koblet én gang
  // (leser aktivt objekt ved klikk); her toggles bare synligheten.
  function updateShareButtons() {
    const acc = accountsMode();
    const uni = activeUniverseObj();
    const grp = activeGroupObj();
    shareUniBtn.hidden = !(acc && uni && (uni._mine || uni._mount));
    shareGroupBtn.hidden = !(acc && grp && (grp._mine || grp._mount));
  }
  shareUniBtn.addEventListener('click', () => {
    const u = activeUniverseObj();
    if (u) openShare('universe', u.id, u);
  });
  shareGroupBtn.addEventListener('click', () => {
    const g = activeGroupObj();
    if (g) openShare('group', g.id, g);
  });

  // Panel-overskriftene viser navnet på gjeldende univers/gruppe, ikke bare
  // nivånavnet — så man alltid ser hvor i hierarkiet man er.
  function updatePanelTitles(group) {
    const uni = activeUniverseObj();
    groupsPanelTitle.textContent = uni ? uni.name : 'Grupper';
    listerPanelTitle.textContent = group ? group.name : 'Lister';
  }

  /* ---------------- Grupper (gruppemenyen) ---------------- */
  // Tegn gruppekortene til det aktive universet inn i gruppelista. Kun
  // ikke-slettede grupper vises; slettede ligger i gruppe-søppelkassen
  // (i knapperaden over kortene).
  function renderGroups() {
    [...groupsBar.querySelectorAll('.group-card')].forEach((el) => el.remove());
    const vis = visibleGroups();
    // Gruppekort får farge etter samme posisjonssystem som listekort.
    vis.forEach((g, i) => { g.color = colorForIndex(i); });
    vis.forEach((g) => groupsBar.appendChild(buildGroupCard(g)));
    updateGroupsTrash();
  }

  // Gruppe-søppelkassen (per univers): vises kun når det ligger grupper i den.
  function updateGroupsTrash() {
    const n = trashedGroups().length;
    groupsTrashCount.textContent = n;
    groupsTrashBtn.hidden = n === 0;
  }

  function buildGroupCard(groupData) {
    const el = groupTpl.content.firstElementChild.cloneNode(true);
    el.dataset.id = groupData.id;
    const isActive = groupData.id === state.activeGroup;
    el.classList.toggle('active', isActive);
    el.setAttribute('aria-selected', isActive ? 'true' : 'false');

    // Farge etter posisjon (samme system som listekort); aksent = mørkere variant.
    const gBase = groupData.color || colorForId(groupData.id);
    el.style.setProperty('--g-bg', gBase);
    el.style.setProperty('--g-accent', darken(gBase, 0.34));

    // Delings-/låse-status (kontomodus).
    const gShared = accountsMode() && (groupData._shared || groupData._mount);
    const gCanEdit = !frozen(groupData);
    el.classList.toggle('is-shared', !!gShared);
    const gBadge = el.querySelector('.share-badge');
    if (gShared) {
      gBadge.hidden = false;
      gBadge.innerHTML = !gCanEdit ? ICONS.lock : ICONS.people;
      gBadge.title = groupData._mount ? 'Delt med deg' : 'Delt med andre';
    }
    const nameEl = el.querySelector('.group-name');
    nameEl.textContent = groupData.name;

    // Antall lister i gruppen (ikke papirkurv): liten pill med liste-ikon + tall.
    const countEl = el.querySelector('.group-count');
    const gListN = groupData.cards.filter((c) => !c.trashed).length;
    countEl.innerHTML = ICONS.list + '<span>' + gListN + '</span>';
    countEl.title = listWord(gListN);

    // Bytt til gruppen; er den allerede aktiv → rediger navnet.
    const activate = () => {
      if (nameEl.dataset.editing === '1') return;
      if (groupData.id !== state.activeGroup) {
        setActiveGroup(groupData.id);
        render();
      } else if (gCanEdit) {
        startGroupRename(nameEl, groupData);
      }
    };

    el.addEventListener('click', (ev) => {
      if (ev.target.closest('.group-handle') || ev.target.closest('.group-delete')) return;
      activate();
    });
    // Tastatur: kortet er role="tab" (tabindex=0). Enter/Mellomrom aktiverer det
    // (bytt gruppe / omdøp den aktive), og fokus følger til den nye aktive gruppen.
    el.addEventListener('keydown', (ev) => {
      if (ev.target !== el) return; // slett/håndtak har egen tastaturoppførsel
      if (ev.key === 'Enter' || ev.key === ' ' || ev.key === 'Spacebar') {
        ev.preventDefault();
        const wasActive = groupData.id === state.activeGroup;
        activate();
        if (!wasActive) {
          const card = groupsBar.querySelector('.group-card[data-id="' + groupData.id + '"]');
          if (card) card.focus();
        }
      }
    });

    const gDelBtn = el.querySelector('.group-delete');
    if (accountsMode() && !gCanEdit && !groupData._mount) {
      gDelBtn.hidden = true;
    } else {
      gDelBtn.addEventListener('click', (ev) => { ev.stopPropagation(); deleteGroup(groupData); });
    }

    const gHandle = el.querySelector('.group-handle');
    if (accountsMode() && !gCanEdit && !groupData._mount) {
      gHandle.style.visibility = 'hidden';
    } else {
      gHandle.addEventListener('pointerdown', (ev) => startGroupDrag(ev, el));
      // Tastatur-reordering: piltaster (opp/ned + venstre/høyre for mobil-rad).
      gHandle.addEventListener('keydown', (ev) => {
        const dir = arrowDir(ev, true);
        if (!dir) return;
        ev.preventDefault();
        const sorted = visibleGroups();
        const i = sorted.indexOf(groupData);
        if (i < 0 || i + dir < 0 || i + dir >= sorted.length) return;
        const np = neighborPos(sorted, i, dir);
        if (groupData._mount) { groupData.pos = np; groupData._mount.pos = np; cloudMountUpdate('group', groupData.id, { pos: np }); }
        else { groupData.pos = np; stampPos(groupData); }
        render(); save();
        const h = groupsBar.querySelector('.group-card[data-id="' + groupData.id + '"] .group-handle');
        if (h) h.focus();
      });
    }
    return el;
  }

  function startGroupRename(nameEl, groupData) {
    editText(nameEl, groupData.name, (val) => {
      groupData.name = val || 'Uten navn';
      nameEl.textContent = groupData.name;
      stampContent(groupData);
      save();
      renderGroups(); // bredde/overflow kan endre seg med navnet
      updatePanelTitles(activeGroupObj()); // navnet kan stå i «GRUPPE: …»-overskriften
    }, { cls: 'group-edit', autosize: true });
  }

  // Finnes ikke noe aktivt univers (helt fersk / alt slettet), opprettes et nytt
  // standard-univers i farten — «＋ Gruppe» skal alltid bare virke. (Ny tilfeldig
  // id, ikke den faste migrerings-id-en, så en evt. gravstein ikke dreper det.)
  function ensureUniverse() {
    let u = activeUniverseObj();
    if (u) return u;
    u = makeUniverse(DEFAULT_UNI.name);
    u.pos = state.universes.length ? maxPos(state.universes) + 1 : 0;
    stampContent(u);
    stampPos(u);
    state.universes.push(u);
    setActiveUniverse(u.id);
    return u;
  }

  function addGroup() {
    const u = ensureUniverse();
    const g = makeGroup('Ny gruppe', null, u.id);
    g.pos = u.groups.length ? maxPos(u.groups) + 1 : 0;
    stampContent(g);
    stampPos(g);
    u.groups.push(g);
    setActiveGroup(g.id);
    render();
    // Rull den nye gruppen inn i syne og start redigering av navnet.
    const el = groupsBar.querySelector('.group-card[data-id="' + g.id + '"]');
    if (el) {
      try { el.scrollIntoView({ inline: 'end', block: 'nearest' }); } catch (e) { /* ignore */ }
      startGroupRename(el.querySelector('.group-name'), g);
    }
  }

  // Slett en gruppe → legg i gruppe-søppelkassen (trashed-flagg; gjenopprettbar).
  // Permanent sletting (med gravsteiner) skjer først når søppelkassen tømmes.
  function deleteGroup(groupData) {
    const ghost = ghostFrom(
      groupsBar.querySelector('.group-card[data-id="' + groupData.id + '"]'));
    if (groupData._mount) {
      groupData.trashed = true; groupData._mount.trashed = true;
      cloudMountUpdate('group', groupData.id, { trashed: true });
    } else {
      groupData.trashed = true;
      stampContent(groupData);
    }
    if (state.activeGroup === groupData.id) {
      const first = visibleGroups()[0];
      setActiveGroup(first ? first.id : null);
    }
    render(); // gruppe-søppelkassen blir synlig FØR animasjonen starter
    save();
    flyGhost(ghost, groupsTrashBtn);
    showToast('Slettet «' + groupData.name + '»', { label: 'Angre', fn: () => restoreGroup(groupData) });
  }

  // Tøm gruppe-søppelkassen (aktivt univers) permanent: gravsteiner for hver
  // slettet gruppe + alle dens lister + elementer (hindrer gjenoppstandelse).
  function emptyGroupsTrash() {
    const u = activeUniverseObj();
    const trash = trashedGroups();
    if (!u || !trash.length) return;
    let left = false;
    trash.forEach((g) => {
      const idx = u.groups.indexOf(g);
      if (g._mount) {
        // Mottaker forlater delingen (rører ikke eierens innhold).
        if (idx > -1) u.groups.splice(idx, 1);
        cloudLeave('group', g.id); left = true;
        return;
      }
      state._tomb.groups[g.id] = tick();
      g.cards.forEach((c) => {
        state._tomb.cards[c.id] = tick();
        c.items.forEach((it) => { state._tomb.items[it.id] = tick(); });
      });
      if (idx > -1) u.groups.splice(idx, 1);
    });
    if (left) cloudBase = null;
    render();
    save();
  }

  function buildCard(cardData) {
    const el = cardTpl.content.firstElementChild.cloneNode(true);
    el.dataset.id = cardData.id;

    // Fargen settes normalt av render() (posisjonsbasert); fall tilbake på en
    // stabil id-farge om kortet bygges utenfor en full render.
    const base = cardData.color || colorForId(cardData.id);
    el.style.setProperty('--card-bg', base);
    el.style.setProperty('--card-head', darken(base, 0.08));
    el.style.setProperty('--card-accent', darken(base, 0.32));

    // Delings-/låse-status (kontomodus). canEdit=false fryser redigering, men en
    // montert liste-rot (mottakerens egen) kan alltid dras/legges i egen søppel.
    const shared = accountsMode() && (cardData._shared || cardData._mount);
    const canEdit = !frozen(cardData);
    el.classList.toggle('is-shared', !!shared);
    el.classList.toggle('is-locked', accountsMode() && !canEdit);
    const cardBadge = el.querySelector('.share-badge');
    if (shared) {
      cardBadge.hidden = false;
      cardBadge.innerHTML = !canEdit ? ICONS.lock : ICONS.people;
      cardBadge.title = cardData._mount ? 'Delt med deg' : 'Delt med andre';
    }
    const cardShareBtn = el.querySelector('.card-share');
    if (accountsMode() && (cardData._mine || cardData._mount)) {
      cardShareBtn.hidden = false;
      cardShareBtn.addEventListener('click', () => openShare('card', cardData.id, cardData));
    }

    const titleEl = el.querySelector('.card-title');
    titleEl.textContent = cardData.title;
    titleEl.addEventListener('click', () => {
      if (!canEdit) return;
      editText(titleEl, cardData.title, (val) => {
        cardData.title = val || 'Uten navn';
        titleEl.textContent = cardData.title;
        stampContent(cardData);
        save();
      });
    });

    // Slett kategori -> legg i papirkurv (trashed-flagg; permanent først ved «Tøm papirkurv»).
    // Frosset (låst av andre) og ikke egen mount → ingen slett-knapp.
    const cardDelBtn = el.querySelector('.card-delete');
    if (accountsMode() && !canEdit && !cardData._mount) {
      cardDelBtn.hidden = true;
    } else {
      cardDelBtn.addEventListener('click', () => {
        const ghost = ghostFrom(el); // klone FØR render (render fjerner kortet)
        if (cardData._mount) {
          cardData.trashed = true; cardData._mount.trashed = true;
          cloudMountUpdate('card', cardData.id, { trashed: true });
        } else {
          cardData.trashed = true;
          stampContent(cardData);
        }
        render(); // søppelkasse-knappen blir synlig FØR animasjonen starter
        save();
        flyGhost(ghost, trashBtn);
        showToast('Slettet «' + cardData.title + '»', { label: 'Angre', fn: () => restoreCard(cardData) });
      });
    }

    // Håndtak for kort-draging. Frosset (låst av andre) og ikke egen mount → skjul.
    const cardHandle = el.querySelector('.card-handle');
    if (accountsMode() && !canEdit && !cardData._mount) {
      cardHandle.style.visibility = 'hidden';
    } else {
      cardHandle.addEventListener('pointerdown', (ev) => startCardDrag(ev, el));
      // Tastatur-reordering: piltaster opp/ned flytter kortet blant de synlige.
      cardHandle.addEventListener('keydown', (ev) => {
        const dir = arrowDir(ev, false);
        if (!dir) return;
        ev.preventDefault();
        const sorted = activeCards().filter(cardMatchesFilter);
        const i = sorted.indexOf(cardData);
        if (i < 0 || i + dir < 0 || i + dir >= sorted.length) return;
        const np = neighborPos(sorted, i, dir);
        if (cardData._mount) { cardData.pos = np; cardData._mount.pos = np; cloudMountUpdate('card', cardData.id, { pos: np }); }
        else { cardData.pos = np; stampPos(cardData); }
        render(); save();
        const h = board.querySelector('.card[data-id="' + cardData.id + '"] .card-handle');
        if (h) h.focus();
      });
    }

    // Elementer (kun ikke-slettede; sortert på posisjon). Slettede ligger i
    // element-søppelkassen nederst i kortet.
    const list = el.querySelector('.items-container');
    cardData.items.filter((it) => !it.trashed).sort(posCmp)
      .forEach((it) => list.appendChild(buildItem(it, cardData)));

    // Legg til element
    const form = el.querySelector('.add-item-form');
    const input = form.querySelector('.add-item-input');
    if (accountsMode() && !canEdit) form.hidden = true;
    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      if (!canEdit) return;
      const text = input.value.trim();
      if (!text) return;
      const it = makeItem(text, cardData.id);
      it.pos = maxPos(cardData.items) + 1;
      stampContent(it);
      stampPos(it);
      cardData.items.push(it);
      list.appendChild(buildItem(it, cardData));
      input.value = '';
      input.focus();
      save();
    });

    // Element-søppelkasse: midtstilt nederst i kortet, kun når det ligger
    // slettede elementer i kortet. Emoji + antall (ingen tekst-etikett).
    const trashed = trashedItemsOf(cardData);
    if (trashed.length) {
      const wrap = document.createElement('div');
      wrap.className = 'item-trash';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'trashcan item-trash-btn';
      btn.title = 'Slettede elementer – trykk for å åpne, hold og sveip for å tømme';
      btn.setAttribute('aria-label', 'Slettede elementer');
      const icon = document.createElement('span');
      icon.className = 'trashcan-icon';
      icon.setAttribute('aria-hidden', 'true');
      icon.innerHTML = ICONS.trash;
      const count = document.createElement('span');
      count.className = 'trashcan-count';
      count.textContent = trashed.length;
      btn.append(icon, count);
      attachTrashHold(btn, {
        count: () => trashedItemsOf(cardData).length,
        open: () => openItemsTrash(cardData),
        empty: () => emptyItemsTrash(cardData),
      });
      wrap.appendChild(btn);
      el.appendChild(wrap);
    }

    return el;
  }

  // Bygg ett kort på nytt i DOM (etter element-endringer: slett/gjenopprett/tøm).
  // Beholder kolonnelayouten; kun det ene kortet erstattes.
  function refreshCard(cardData) {
    const oldEl = board.querySelector('.card[data-id="' + cardData.id + '"]');
    if (oldEl) oldEl.replaceWith(buildCard(cardData));
  }

  // Tøm kortets element-søppelkasse permanent: gravstein per slettet element.
  function emptyItemsTrash(cardData) {
    const trash = trashedItemsOf(cardData);
    if (!trash.length) return;
    trash.forEach((it) => {
      state._tomb.items[it.id] = tick(); // gravstein hindrer gjenoppstandelse
      const idx = cardData.items.indexOf(it);
      if (idx > -1) cardData.items.splice(idx, 1);
    });
    refreshCard(cardData);
    save();
  }

  function buildItem(itemData, cardData) {
    const el = itemTpl.content.firstElementChild.cloneNode(true);
    el.dataset.id = itemData.id;
    const canEdit = !(accountsMode() && frozen(cardData));

    const textEl = el.querySelector('.item-text');
    textEl.textContent = itemData.text;
    textEl.addEventListener('click', () => {
      if (!canEdit) return;
      editText(textEl, itemData.text, (val) => {
        if (!val) return; // tom redigering = ingen endring
        itemData.text = val;
        textEl.textContent = val;
        stampContent(itemData);
        save();
      });
    });

    // Avkryssing (gjort/ikke gjort): rir på innholds-registeret (som tekst/
    // trashed) — LWW ved samtidig endring, som resten. Kun visuell markering
    // (gjennomstreking); elementet beholder plassen sin.
    const checkBtn = el.querySelector('.item-check');
    el.classList.toggle('done', !!itemData.done);
    checkBtn.setAttribute('aria-pressed', itemData.done ? 'true' : 'false');
    if (!canEdit) {
      checkBtn.disabled = true;
    } else {
      checkBtn.addEventListener('click', () => {
        itemData.done = !itemData.done;
        stampContent(itemData);
        el.classList.toggle('done', itemData.done);
        checkBtn.setAttribute('aria-pressed', itemData.done ? 'true' : 'false');
        save();
      });
    }

    // Slett element → legg i kortets element-søppelkasse (trashed-flagg;
    // gjenopprettbar). Permanent sletting (gravstein) skjer først ved tømming.
    const itemDel = el.querySelector('.item-delete');
    const itemHandle = el.querySelector('.item-handle');
    if (!canEdit) {
      itemDel.hidden = true;
      itemHandle.style.visibility = 'hidden';
    } else {
      itemDel.addEventListener('click', () => {
        const owner = ownerCardOf(el) || cardData;
        const ghost = ghostFrom(el); // klone FØR refreshCard fjerner raden
        const it = owner.items.find((i) => i.id === itemData.id);
        if (it) { it.trashed = true; stampContent(it); }
        refreshCard(owner); // element-søppelkassen dukker opp FØR animasjonen
        save();
        flyGhost(ghost, board.querySelector(
          '.card[data-id="' + owner.id + '"] .item-trash-btn'));
        if (it) showToast('Slettet «' + it.text + '»', { label: 'Angre', fn: () => restoreItem(it, owner) });
      });
      itemHandle.addEventListener('pointerdown', (ev) => startItemDrag(ev, el));
      // Tastatur-reordering: piltaster opp/ned flytter det fokuserte elementet.
      itemHandle.addEventListener('keydown', (ev) => {
        const dir = arrowDir(ev, false);
        if (!dir) return;
        ev.preventDefault();
        const owner = ownerCardOf(el) || cardData;
        const sorted = owner.items.filter((it) => !it.trashed).sort(posCmp);
        const i = sorted.indexOf(itemData);
        if (i < 0 || i + dir < 0 || i + dir >= sorted.length) return;
        itemData.home = owner.id;
        itemData.pos = neighborPos(sorted, i, dir);
        stampPos(itemData);
        refreshCard(owner);
        save();
        const h = board.querySelector('.card[data-id="' + owner.id +
          '"] .item[data-id="' + itemData.id + '"] .item-handle');
        if (h) h.focus();
      });
    }
    return el;
  }

  // Finn hvilket kort (i state) et element-DOM ligger i akkurat nå
  function ownerCardOf(itemEl) {
    const cardEl = itemEl.closest('.card');
    if (!cardEl) return null;
    return findCard(cardEl.dataset.id);
  }

  /* ---------------- Slette-animasjon («pakk sammen og fly i søpla») ----------------
     Når et objekt slettes: 1) ta en klone av DOM-elementet FØR re-render
     (ghostFrom), 2) oppdater state + render — slik at søppelkasse-knappen
     finnes/er synlig FØR animasjonen starter, 3) flyGhost: innholdet fader ut,
     boksen krymper til en sirkel (kun de avrundede hjørnene igjen), og
     sirkelen svever inn i søppelkasse-knappen og fader rett før den er fremme.
     ~200 ms totalt — signaliserer HVOR det slettede havnet (og at det kan
     gjenopprettes derfra). */
  function ghostFrom(el) {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const ghost = el.cloneNode(true);
    const cs = getComputedStyle(el);
    ghost.classList.add('fly-ghost');
    ghost.style.left = r.left + 'px';
    ghost.style.top = r.top + 'px';
    ghost.style.width = r.width + 'px';
    ghost.style.height = r.height + 'px';
    ghost.style.background = cs.backgroundColor;
    ghost.style.borderRadius = cs.borderRadius;
    ghost.style.boxShadow = 'none';
    return { ghost, rect: r, radius: cs.borderRadius };
  }
  const FLY_MS = 600;                               // total varighet på fly-i-søpla
  function flyGhost(g, targetBtn) {
    if (!g) return;
    if (!targetBtn || targetBtn.hidden || !targetBtn.isConnected) return;
    if (prefersReducedMotion()) return;             // ingen bevegelse → ingen ghost
    const { ghost, rect, radius } = g;
    document.body.appendChild(ghost);
    const t = targetBtn.getBoundingClientRect();
    const D = 30;                                   // «bare hjørnene igjen»-sirkelen
    const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
    const tx = t.left + t.width / 2, ty = t.top + t.height / 2;
    if (typeof ghost.animate !== 'function') { ghost.remove(); return; }
    // Innholdet forsvinner først (raskt, men synlig — ~30 % av forløpet) …
    [...ghost.children].forEach((ch) => {
      if (typeof ch.animate === 'function') {
        ch.animate([{ opacity: 1 }, { opacity: 0 }],
          { duration: FLY_MS * 0.3, easing: 'ease-out', fill: 'forwards' });
      }
    });
    // … så pakkes boksen sammen til en sirkel (halvveis) som svever inn i knappen
    // og fader like før den er fremme. Selve boksen holder full opacity lenge, så
    // sammenpakkingen er godt synlig også for store listekort.
    const anim = ghost.animate([
      { left: rect.left + 'px', top: rect.top + 'px', width: rect.width + 'px',
        height: rect.height + 'px', borderRadius: radius, opacity: 1 },
      { left: (cx - D / 2) + 'px', top: (cy - D / 2) + 'px', width: D + 'px',
        height: D + 'px', borderRadius: '50%', opacity: 1, offset: 0.5 },
      { left: (tx - 4) + 'px', top: (ty - 4) + 'px', width: '8px', height: '8px',
        borderRadius: '50%', opacity: 0 },
    ], { duration: FLY_MS, easing: 'cubic-bezier(.35,.5,.35,1)' });
    const cleanup = () => ghost.remove();
    anim.onfinish = cleanup;
    anim.oncancel = cleanup;
  }

  /* ---------------- Gjenopprett-hjelpere (delt av søppel-modal + angre-toast) ----------------
     Ett sted for «trashed = false»-logikken per nivå (håndterer også monterte
     delinger via mount-oppdatering), så både «Gjenopprett» i søppel-modalen og
     «Angre» i slette-toasten bruker nøyaktig samme kode. */
  function restoreUniverse(u) {
    if (u._mount) { u.trashed = false; u._mount.trashed = false; cloudMountUpdate('universe', u.id, { trashed: false }); }
    else { u.trashed = false; stampContent(u); }
    if (!activeUniverseObj()) setActiveUniverse(u.id); // ingen aktiv? aktivér den gjenopprettede
    render(); save();
  }
  function restoreGroup(g) {
    if (g._mount) { g.trashed = false; g._mount.trashed = false; cloudMountUpdate('group', g.id, { trashed: false }); }
    else { g.trashed = false; stampContent(g); }
    if (!activeGroupObj()) setActiveGroup(g.id);
    render(); save();
  }
  function restoreCard(c) {
    if (c._mount) { c.trashed = false; c._mount.trashed = false; cloudMountUpdate('card', c.id, { trashed: false }); }
    else { c.trashed = false; stampContent(c); }
    render(); save();
  }
  function restoreItem(it, cardData) {
    it.trashed = false; stampContent(it); refreshCard(cardData); save();
  }

  /* ---------------- Inline-redigering ---------------- */
  // opts.cls: ekstra klasse på input. opts.autosize: la input vokse med innholdet
  // (brukes til gruppenavn i headeren, som ikke skal ta full bredde).
  function editText(displayEl, current, onSave, opts) {
    opts = opts || {};
    if (displayEl.dataset.editing === '1') return;
    displayEl.dataset.editing = '1';
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'edit-input' + (opts.cls ? ' ' + opts.cls : '');
    input.value = current;
    displayEl.replaceWith(input);
    if (opts.autosize) {
      const resize = () => { input.style.width = Math.max(4, input.value.length + 1) + 'ch'; };
      input.addEventListener('input', resize);
      resize();
    }
    input.focus();
    input.setSelectionRange(0, input.value.length);

    let done = false;
    const finish = (commit) => {
      if (done) return;
      done = true;
      const val = input.value.trim();
      input.replaceWith(displayEl);
      delete displayEl.dataset.editing;
      if (commit) onSave(val);
    };
    input.addEventListener('blur', () => finish(true));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); finish(true); }
      else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    });
  }

  /* ============================================================
     DRA-OG-SLIPP-MOTOR
     Kort og elementer bytter plass når de overlapper et annet
     kort/element med minst 20 % av høyden. For å unngå flimring er
     byttet retningsstyrt: nedover-drag bytter kun med kortet under,
     oppover-drag kun med kortet over. Bytter animeres med FLIP (150 ms).
     Kryss-kolonne / overføring mellom kort skjer når dra-elementet
     føres inn i en annen kolonne/kategori.
     Spesialtilfelle: hvis ingen kolonne har mer enn ett kort (alle
     kategorier ligger på samme horisontale rad), er vertikalt bytte
     umulig — da gjelder i stedet en tilsvarende 20 %-regel for
     bredde-overlapp, retningsstyrt mot venstre/høyre.
     ============================================================ */

  const SWAP_RATIO = 0.2; // 20 % høydeoverlapp utløser bytte
  const FLIP_MS = 150;

  const drag = { active: false };

  /* ------- Geometri-hjelpere ------- */
  function vOverlap(a, b) {
    return Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  }
  function hOverlap(a, b) {
    return Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
  }
  function hOverlapFrac(a, b) {
    return hOverlap(a, b) / Math.max(1, Math.min(a.width, b.width));
  }
  function vOverlapFrac(a, b) {
    return vOverlap(a, b) / Math.max(1, Math.min(a.height, b.height));
  }
  // Sant når ingen to kort deler kolonne (>= 50 % horisontal overlapp),
  // altså at kortene ligger på én enkelt horisontal rad.
  function isSingleRowLayout(rects) {
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        if (hOverlapFrac(rects[i], rects[j]) >= 0.5) return false;
      }
    }
    return true;
  }
  // Layout-boks uten evt. pågående FLIP-transform, så treffdeteksjon er stabil
  // selv mens kort animerer på plass.
  function layoutRect(el) {
    const r = el.getBoundingClientRect();
    const t = getComputedStyle(el).transform;
    if (t && t !== 'none') {
      try {
        const m = new DOMMatrixReadOnly(t);
        return {
          left: r.left - m.e, right: r.right - m.e,
          top: r.top - m.f, bottom: r.bottom - m.f,
          width: r.width, height: r.height,
        };
      } catch (e) { /* faller tilbake til r */ }
    }
    return r;
  }
  // Dra-elementets logiske boks ut fra pekerposisjon (urørt av rotasjon/skala).
  function draggedRect() {
    const left = drag.lastX - drag.grabX;
    const top = drag.lastY - drag.grabY;
    return { left, top, right: left + drag.width, bottom: top + drag.height, width: drag.width, height: drag.height };
  }

  // Dynamisk rotasjon av dra-kortet ut fra horisontal posisjon på siden:
  // −5° når kortet ligger inntil venstre ytterkant, 0° midtstilt, +5° inntil
  // høyre ytterkant. Vi normaliserer mot det oppnåelige senter-området
  // (halve kortbredden inn fra hver kant) så ytterpunktene faktisk nås.
  const MAX_ROT = 5;
  function cardRotation() {
    const r = draggedRect();
    const vw = window.innerWidth || document.documentElement.clientWidth || 1;
    const half = r.width / 2;
    const min = half, max = vw - half;   // senter når kortet er inntil venstre/høyre kant
    const cx = r.left + half;
    let t = max > min ? ((cx - min) / (max - min)) * 2 - 1 : 0; // −1 venstre, +1 høyre
    t = Math.max(-1, Math.min(1, t));
    return t * MAX_ROT;
  }

  /* ------- FLIP-animasjon ------- */
  function snapshotRects(els) {
    const m = new Map();
    els.forEach((el) => m.set(el, el.getBoundingClientRect()));
    return m;
  }
  function flipFrom(prev, dur) {
    if (prefersReducedMotion()) return;   // hopp over FLIP-tween (snap på plass)
    prev.forEach((old, el) => {
      if (!el.isConnected) return;
      const now = el.getBoundingClientRect();
      const dx = old.left - now.left;
      const dy = old.top - now.top;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
      el.style.transition = 'none';
      el.style.transform = `translate(${dx}px, ${dy}px)`;
      void el.offsetWidth; // tving reflow så starttilstanden registreres
      requestAnimationFrame(() => {
        el.style.transition = `transform ${dur}ms cubic-bezier(.2,.75,.3,1)`;
        el.style.transform = '';
        el.addEventListener('transitionend', function te(e) {
          if (e.propertyName !== 'transform') return;
          el.style.transition = '';
          el.style.transform = '';
          el.removeEventListener('transitionend', te);
        });
      });
    });
  }

  /* ------- Felles start / bevegelse / slutt ------- */
  function beginDragCommon(ev, el) {
    ev.preventDefault();
    const rect = el.getBoundingClientRect();
    drag.el = el;
    drag.width = rect.width;
    drag.height = rect.height;
    drag.grabX = ev.clientX - rect.left;
    drag.grabY = ev.clientY - rect.top;
    drag.pointerId = ev.pointerId;
    drag.lastX = ev.clientX;
    drag.lastY = ev.clientY;
    drag.active = true;
    try { ev.target.setPointerCapture(ev.pointerId); } catch (e) {}
    document.body.classList.add('is-dragging');
  }

  function liftElement() {
    const el = drag.el;
    el.style.width = drag.width + 'px';
    el.style.height = drag.height + 'px';
    el.style.left = (drag.lastX - drag.grabX) + 'px';
    el.style.top = (drag.lastY - drag.grabY) + 'px';
    el.classList.add('dragging');
  }

  function moveElement() {
    const el = drag.el;
    el.style.left = (drag.lastX - drag.grabX) + 'px';
    el.style.top = (drag.lastY - drag.grabY) + 'px';
  }

  function wouldMove(ph, refEl, pos) {
    if (refEl === ph) return false;
    if (pos === 'before') return refEl.previousElementSibling !== ph;
    return refEl.nextElementSibling !== ph; // 'after'
  }
  function placePlaceholder(container, ph, refEl, pos) {
    if (pos === 'before') container.insertBefore(ph, refEl);
    else container.insertBefore(ph, refEl.nextElementSibling);
  }

  // Animer dra-elementet fra flytende posisjon inn i placeholder-sloten.
  // rot = grader kortet skal starte rotert i (0/false for elementer → ingen spin).
  function dropIntoPlaceholder(el, rot) {
    const floatLeft = drag.lastX - drag.grabX;
    const floatTop = drag.lastY - drag.grabY;
    el.classList.remove('dragging');
    el.style.left = el.style.top = el.style.width = el.style.height = '';
    el.style.transform = ''; // fjern evt. dynamisk drag-rotasjon før vi måler hvileposisjonen
    if (prefersReducedMotion()) return;   // ingen drop-tween ved redusert bevegelse
    const now = el.getBoundingClientRect();
    const dx = floatLeft - now.left;
    const dy = floatTop - now.top;
    el.style.transition = 'none';
    el.style.transform = `translate(${dx}px, ${dy}px)${rot ? ` rotate(${rot}deg) scale(1.02)` : ''}`;
    void el.offsetWidth;
    requestAnimationFrame(() => {
      el.style.transition = `transform ${FLIP_MS}ms cubic-bezier(.2,.75,.3,1)`;
      el.style.transform = '';
      el.addEventListener('transitionend', function te(e) {
        if (e.propertyName !== 'transform') return;
        el.style.transition = '';
        el.style.transform = '';
        el.removeEventListener('transitionend', te);
      });
    });
  }

  function finishDrag() {
    drag.active = false;
    // Sikkerhetsnett: en placeholder skal kun eksistere mens draging pågår.
    // Fjern den aktive om den fortsatt henger i DOM, og fei bort evt. foreldreløse
    // (f.eks. hvis en drag ble avbrutt uvanlig) så ingen blir stående etter slipp.
    if (drag.ph && drag.ph.parentNode) drag.ph.remove();
    drag.el = null;
    drag.ph = null;
    document.querySelectorAll('.group-placeholder, .card-placeholder, .item-placeholder')
      .forEach((el) => el.remove());
    stopAutoScroll();
    stopGroupAutoScroll();
    stopUniverseAutoScroll();
    document.body.classList.remove('is-dragging');
  }

  /* ------- Auto-scroll når dra-kortet nærmer seg topp/bunn av vinduet -------
     Sakte når kortet nærmer seg kanten, raskere jo lengre ut i sonen — og
     raskest når det holdes forbi selve kanten. Fungerer begge veier. */
  let autoScrollRAF = null;
  let autoScrollSpeed = 0;

  function edgeSpeed(p) {
    // p: 0 ved sonens indre kant, 1 ved vinduskanten, >1 forbi kanten.
    const MIN = 4, MAX = 20, BEYOND = 34;
    if (p <= 0) return 0;
    if (p <= 1) return MIN + (MAX - MIN) * p;
    return MAX + (BEYOND - MAX) * Math.min(1, p - 1);
  }
  function updateAutoScroll() {
    if (!drag.active || drag.kind !== 'card') { stopAutoScroll(); return; }
    const y = drag.lastY;
    const vh = window.innerHeight || document.documentElement.clientHeight || 1;
    const ZONE = 120;
    const down = edgeSpeed((y - (vh - ZONE)) / ZONE);
    const up = edgeSpeed((ZONE - y) / ZONE);
    autoScrollSpeed = down > 0 ? down : (up > 0 ? -up : 0);
    if (autoScrollSpeed !== 0) startAutoScroll(); else stopAutoScroll();
  }
  function startAutoScroll() {
    if (autoScrollRAF != null) return;
    const step = () => {
      if (!drag.active || autoScrollSpeed === 0) { autoScrollRAF = null; return; }
      const before = window.scrollY;
      window.scrollBy(0, autoScrollSpeed);
      // Kortet er fixed, men de andre kortene flytter seg når siden ruller →
      // re-evaluer plassering med rulleretningen som «drag-retning».
      if (window.scrollY !== before) updateCardPlacement(0, autoScrollSpeed > 0 ? 1 : -1);
      autoScrollRAF = requestAnimationFrame(step);
    };
    autoScrollRAF = requestAnimationFrame(step);
  }
  function stopAutoScroll() {
    if (autoScrollRAF != null) { cancelAnimationFrame(autoScrollRAF); autoScrollRAF = null; }
    autoScrollSpeed = 0;
  }

  /* ---------------- KORT-DRAGING ---------------- */
  function startCardDrag(ev, cardEl) {
    if (ev.button != null && ev.button !== 0) return;
    if (drag.active) return; // ignorer ny drag mens en pågår (unngår foreldreløs placeholder)
    beginDragCommon(ev, cardEl);
    drag.kind = 'card';
    drag.groupTarget = null; // evt. gruppekort lista slippes på (overføring mellom grupper)

    const ph = document.createElement('div');
    ph.className = 'card-placeholder';
    ph.style.height = drag.height + 'px';
    board.insertBefore(ph, cardEl);
    drag.ph = ph;

    liftElement();
    drag.el.style.transform = `rotate(${cardRotation()}deg) scale(1.02)`;
    window.addEventListener('pointermove', onCardMove);
    window.addEventListener('pointerup', onCardUp);
    window.addEventListener('pointercancel', onCardUp);
  }

  /* ------- Overføring av en liste til en annen gruppe -------
     Samme idé som å dra et element fra én liste til en annen: slippes lista over
     et gruppekort i headeren, får den ny forelder (`group`) + posisjon. Mål-
     gruppens board vises ikke akkurat nå, så vi markerer gruppekortet som mål
     mens man sikter, og gir et lite kvitteringsvarsel + puls ved slipp. */
  function pointerInHeader(x, y) {
    const r = appHeader.getBoundingClientRect();
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  }
  // Gyldig mål-gruppe under pekeren: et gruppekort som IKKE er den aktive gruppen
  // (å slippe på egen gruppe overfører ingenting). Slettede grupper ligger ikke i
  // raden. Returnerer gruppekort-DOM eller null.
  function cardTransferGroupAt(x, y) {
    const cards = groupsBar.querySelectorAll('.group-card:not(.dragging)');
    for (const gc of cards) {
      if (gc.dataset.id === state.activeGroup) continue;
      const r = gc.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return gc;
    }
    return null;
  }
  // Sett/fjern gjeldende mål-gruppe: highlight på gruppekortet + gjør dra-kortet
  // gjennomskinnelig så gruppekortet under vises (dra-kortet ligger over headeren).
  function setCardGroupTarget(gt) {
    if (drag.groupTarget === gt) return;
    if (drag.groupTarget) drag.groupTarget.classList.remove('drop-target');
    drag.groupTarget = gt || null;
    if (drag.groupTarget) drag.groupTarget.classList.add('drop-target');
    if (drag.el) drag.el.classList.toggle('to-group', !!drag.groupTarget);
  }
  // Kort puls på gruppekortet som nettopp mottok en liste (kalles etter render()).
  function pulseReceivedGroup(id) {
    const gc = groupsBar.querySelector('.group-card[data-id="' + id + '"]');
    if (!gc) return;
    gc.classList.remove('received');
    void gc.offsetWidth; // tving reflow så animasjonen kan starte på nytt
    gc.classList.add('received');
    gc.addEventListener('animationend', function done() {
      gc.classList.remove('received');
      gc.removeEventListener('animationend', done);
    });
  }

  function onCardMove(ev) {
    if (!drag.active) return;
    const dx = ev.clientX - drag.lastX;
    const dy = ev.clientY - drag.lastY;
    drag.lastX = ev.clientX;
    drag.lastY = ev.clientY;
    moveElement();
    drag.el.style.transform = `rotate(${cardRotation()}deg) scale(1.02)`;

    // Over headeren sikter vi på en gruppe (overføring) i stedet for å omorganisere
    // board-et: marker evt. mål-gruppe, og la board-et + siden ligge i ro så lista
    // ikke bytter plass mens man løfter den opp mot gruppene.
    if (pointerInHeader(ev.clientX, ev.clientY)) {
      setCardGroupTarget(cardTransferGroupAt(ev.clientX, ev.clientY));
      stopAutoScroll();
      return;
    }
    setCardGroupTarget(null);
    updateAutoScroll();
    updateCardPlacement(dx, dy);
  }

  // Finn og utfør evt. placeholder-flytting ut fra dra-retningen (dx, dy).
  // Kalles både fra peker-bevegelse og fra auto-scroll (med syntetisk retning).
  function updateCardPlacement(dx, dy) {
    if (!drag.active || drag.kind !== 'card') return;
    const dragRect = draggedRect();
    const cards = [...board.querySelectorAll('.card:not(.dragging)')];
    if (!cards.length) return;
    const rects = new Map(cards.map((c) => [c, layoutRect(c)]));
    const ph = drag.ph;

    let action = null;

    // Spesialtilfelle: ingen kolonne har mer enn ett kort → vertikalt
    // bytte er umulig. Bruk i stedet en 20 %-regel for bredde-overlapp,
    // retningsstyrt mot venstre/høyre.
    const restRects = cards.map((c) => rects.get(c)).concat([layoutRect(ph)]);
    if (isSingleRowLayout(restRects)) {
      if (dx > 0) {
        // Høyre: nærmeste kort til høyre med >= 20 % breddeoverlapp.
        let best = null, bestLeft = Infinity;
        for (const c of cards) {
          const r = rects.get(c);
          if (r.left >= dragRect.left && hOverlap(dragRect, r) >= SWAP_RATIO * r.width && r.left < bestLeft) {
            bestLeft = r.left; best = c;
          }
        }
        if (best) action = { ref: best, pos: 'after' };
      } else if (dx < 0) {
        // Venstre: nærmeste kort til venstre med >= 20 % breddeoverlapp.
        let best = null, bestLeft = -Infinity;
        for (const c of cards) {
          const r = rects.get(c);
          if (r.left <= dragRect.left && hOverlap(dragRect, r) >= SWAP_RATIO * r.width && r.left > bestLeft) {
            bestLeft = r.left; best = c;
          }
        }
        if (best) action = { ref: best, pos: 'before' };
      }
    } else {
      // Kolonne = kort som ligger på samme horisontale spor som dra-kortet.
      const col = cards.filter((c) => hOverlapFrac(dragRect, rects.get(c)) >= 0.5);
      const phInCol = col.length && hOverlapFrac(dragRect, layoutRect(ph)) >= 0.5;

      if (col.length && !phInCol) {
        // Bytte kolonne: plasser etter vertikal senterposisjon.
        const cy = dragRect.top + dragRect.height / 2;
        const sorted = col.slice().sort((a, b) => rects.get(a).top - rects.get(b).top);
        let ref = null;
        for (const c of sorted) {
          const r = rects.get(c);
          if (cy < r.top + r.height / 2) { ref = c; break; }
        }
        action = ref ? { ref, pos: 'before' } : { ref: sorted[sorted.length - 1], pos: 'after' };
      } else if (col.length && dy > 0) {
        // Nedover: nærmeste kort under med >= 20 % overlapp.
        let best = null, bestTop = Infinity;
        for (const c of col) {
          const r = rects.get(c);
          if (r.top >= dragRect.top && vOverlap(dragRect, r) >= SWAP_RATIO * r.height && r.top < bestTop) {
            bestTop = r.top; best = c;
          }
        }
        if (best) action = { ref: best, pos: 'after' };
      } else if (col.length && dy < 0) {
        // Oppover: nærmeste kort over med >= 20 % overlapp.
        let best = null, bestTop = -Infinity;
        for (const c of col) {
          const r = rects.get(c);
          if (r.top <= dragRect.top && vOverlap(dragRect, r) >= SWAP_RATIO * r.height && r.top > bestTop) {
            bestTop = r.top; best = c;
          }
        }
        if (best) action = { ref: best, pos: 'before' };
      }
    }

    if (!action || !wouldMove(ph, action.ref, action.pos)) return;
    const snap = snapshotRects(cards);
    placePlaceholder(board, ph, action.ref, action.pos);
    flipFrom(snap, FLIP_MS);
  }

  function onCardUp(ev) {
    if (!drag.active) return;
    window.removeEventListener('pointermove', onCardMove);
    window.removeEventListener('pointerup', onCardUp);
    window.removeEventListener('pointercancel', onCardUp);

    const el = drag.el;
    // Bestem drop-mål ut fra de FAKTISKE slipp-koordinatene, ikke det som lå
    // mellomlagret fra siste pointermove: slippes lista like utenfor gruppekortet
    // (rask/koalescerte bevegelse, eller pointercancel), skal den ikke overføres
    // til den sist markerte gruppen. Faller tilbake på siste peker-posisjon bare
    // hvis hendelsen mangler koordinater.
    const relX = ev && typeof ev.clientX === 'number' ? ev.clientX : drag.lastX;
    const relY = ev && typeof ev.clientY === 'number' ? ev.clientY : drag.lastY;
    const groupTarget = pointerInHeader(relX, relY) ? cardTransferGroupAt(relX, relY) : null;
    setCardGroupTarget(null); // fjern evt. highlight uansett utfall

    // --- Overføring til en annen gruppe (samme logikk som elementer mellom lister) ---
    // Slippes lista over et gruppekort i headeren, flytter vi den til den gruppen:
    // sett kortets forelder (`group`) + posisjon (kirurgisk — kun posisjonsregisteret,
    // som «forelder følger posisjon»), og flytt kort-objektet mellom gruppenes lister.
    if (groupTarget) {
      const c = findCard(el.dataset.id);
      const dest = findGroup(groupTarget.dataset.id);
      const src = activeGroupObj();
      if (c && dest && src && dest.id !== c.group && dest.id !== (c._mount && c._mount.parent)) {
        drag.ph.remove();
        finishDrag();
        const i = src.cards.indexOf(c);
        if (i > -1) src.cards.splice(i, 1);
        const np = maxPos(dest.cards) + 1; // legg bakerst i mål-gruppen
        if (c._mount) {
          // Montert liste: flytt mottakerens mount til ny gruppe (ikke eierens plassering).
          c._mount.parent = dest.id; c._mount.pos = np; c.pos = np;
          c._parent = dest;
          cloudMountUpdate('card', c.id, { parent_group_id: dest.id, pos: np });
        } else {
          c.group = dest.id;
          c.pos = np;
          stampPos(c);
        }
        dest.cards.push(c);
        save();
        render();                       // lista forsvinner fra dette board-et
        showToast('Flyttet «' + c.title + '» til «' + dest.name + '»');
        pulseReceivedGroup(dest.id);
        return;
      }
    }

    const rot = cardRotation();
    board.insertBefore(el, drag.ph);
    drag.ph.remove();
    dropIntoPlaceholder(el, rot);
    finishDrag();

    // Ny rekkefølge: gi kortet en pos mellom DOM-naboene. Kirurgisk – kun
    // dette kortets posisjonsregister endres, så samtidige endringer på
    // andre kort/enheter flettes uten konflikt.
    const prev = el.previousElementSibling;
    const next = el.nextElementSibling;
    const c = findCard(el.dataset.id);
    if (c) {
      const pPrev = prev && prev.classList.contains('card') ? (findCard(prev.dataset.id) || {}).pos : null;
      const pNext = next && next.classList.contains('card') ? (findCard(next.dataset.id) || {}).pos : null;
      const np = between(pPrev == null ? null : pPrev, pNext == null ? null : pNext);
      if (c._mount) {
        c.pos = np; c._mount.pos = np;
        cloudMountUpdate('card', c.id, { pos: np });
      } else {
        c.pos = np;
        stampPos(c);
      }
    }
    reindexCardColors();
    save();
  }

  // Fargene er posisjonsbaserte (colorForIndex): en omrokkering endrer alle
  // kortenes posisjon i den sorterte lista, ikke bare det flyttede kortets —
  // reindekser derfor alltid samtlige (kirurgisk: kun CSS-variabler på
  // eksisterende DOM-noder, ingen full re-rendring av board-et).
  function reindexCardColors() {
    activeCards().forEach((c, i) => {
      c.color = colorForIndex(i);
      const el = board.querySelector('.card[data-id="' + c.id + '"]');
      if (!el) return;
      el.style.setProperty('--card-bg', c.color);
      el.style.setProperty('--card-head', darken(c.color, 0.08));
      el.style.setProperty('--card-accent', darken(c.color, 0.32));
    });
  }

  /* ---------------- ELEMENT-DRAGING ---------------- */
  function startItemDrag(ev, itemEl) {
    if (ev.button != null && ev.button !== 0) return;
    if (drag.active) return; // ignorer ny drag mens en pågår (unngår foreldreløs placeholder)
    beginDragCommon(ev, itemEl);
    drag.kind = 'item';

    const ph = document.createElement('li');
    ph.className = 'item-placeholder';
    ph.style.height = drag.height + 'px';
    itemEl.parentNode.insertBefore(ph, itemEl);
    drag.ph = ph;

    liftElement();
    window.addEventListener('pointermove', onItemMove);
    window.addEventListener('pointerup', onItemUp);
    window.addEventListener('pointercancel', onItemUp);
  }

  function onItemMove(ev) {
    if (!drag.active) return;
    const dy = ev.clientY - drag.lastY;
    drag.lastX = ev.clientX;
    drag.lastY = ev.clientY;
    moveElement();

    const dragRect = draggedRect();
    const flipEls = [...document.querySelectorAll('.item:not(.dragging)')];

    // Finn hvilken items-container pekeren er over (håndterer overføring mellom kort).
    const containers = [...document.querySelectorAll('.items-container')];
    let targetCont = null;
    for (const cont of containers) {
      const r = cont.getBoundingClientRect();
      if (ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top - 12 && ev.clientY <= r.bottom + 12) {
        targetCont = cont; break;
      }
    }
    if (!targetCont) {
      for (const cont of containers) {
        const cr = cont.closest('.card').getBoundingClientRect();
        if (ev.clientX >= cr.left && ev.clientX <= cr.right && ev.clientY >= cr.top && ev.clientY <= cr.bottom) {
          targetCont = cont; break;
        }
      }
    }
    if (!targetCont) return;

    const ph = drag.ph;
    const items = [...targetCont.querySelectorAll('.item:not(.dragging)')];
    const phInCont = ph.parentNode === targetCont;

    let action = null; // {pos:'before'|'after'|'append', ref?}

    if (!phInCont) {
      // Overføring til en annen kategori: plasser etter vertikal posisjon.
      const cy = dragRect.top + dragRect.height / 2;
      let ref = null;
      for (const it of items) {
        const r = layoutRect(it);
        if (cy < r.top + r.height / 2) { ref = it; break; }
      }
      action = ref ? { ref, pos: 'before' } : { pos: 'append' };
    } else if (dy > 0) {
      let best = null, bestTop = Infinity;
      for (const it of items) {
        const r = layoutRect(it);
        if (r.top >= dragRect.top && vOverlap(dragRect, r) >= SWAP_RATIO * r.height && r.top < bestTop) {
          bestTop = r.top; best = it;
        }
      }
      if (best) action = { ref: best, pos: 'after' };
    } else if (dy < 0) {
      let best = null, bestTop = -Infinity;
      for (const it of items) {
        const r = layoutRect(it);
        if (r.top <= dragRect.top && vOverlap(dragRect, r) >= SWAP_RATIO * r.height && r.top > bestTop) {
          bestTop = r.top; best = it;
        }
      }
      if (best) action = { ref: best, pos: 'before' };
    }

    if (!action) return;
    const willMove = action.pos === 'append'
      ? targetCont.lastElementChild !== ph
      : wouldMove(ph, action.ref, action.pos);
    if (!willMove) return;

    const snap = snapshotRects(flipEls);
    if (action.pos === 'append') targetCont.appendChild(ph);
    else placePlaceholder(targetCont, ph, action.ref, action.pos);
    flipFrom(snap, FLIP_MS);
  }

  function onItemUp() {
    if (!drag.active) return;
    window.removeEventListener('pointermove', onItemMove);
    window.removeEventListener('pointerup', onItemUp);
    window.removeEventListener('pointercancel', onItemUp);

    const el = drag.el;
    const sourceCardId = el.closest('.card') ? el.closest('.card').dataset.id : null;
    const targetContainer = drag.ph.parentNode;
    targetContainer.insertBefore(el, drag.ph);
    drag.ph.remove();
    dropIntoPlaceholder(el, false);
    finishDrag();

    const targetCardId = el.closest('.card').dataset.id;
    const prev = el.previousElementSibling;
    const next = el.nextElementSibling;

    // Ta et øyeblikksbilde av alle elementer FØR reconcile: ved overføring til et
    // annet kort må mål-kortet finne det flyttede elementet selv om kilde-kortet
    // reconciles først (ellers droppes det fra pool-en før målet ser det).
    const pool = itemPool();
    reconcileItems(sourceCardId, pool);
    if (targetCardId !== sourceCardId) reconcileItems(targetCardId, pool);

    // Kirurgisk: sett kun det flyttede elementets forelder (home) + posisjon.
    const moved = findItemById(el.dataset.id);
    if (moved) {
      moved.home = targetCardId;
      const pPrev = prev && prev.classList.contains('item') ? (findItemById(prev.dataset.id) || {}).pos : null;
      const pNext = next && next.classList.contains('item') ? (findItemById(next.dataset.id) || {}).pos : null;
      moved.pos = between(pPrev == null ? null : pPrev, pNext == null ? null : pNext);
      stampPos(moved);
    }
    save();
  }

  // Alle elementer på tvers av kortene i aktiv gruppe, oppslag på id.
  function itemPool() {
    const pool = {};
    allCards().forEach((c) => c.items.forEach((it) => { pool[it.id] = it; }));
    return pool;
  }

  // Bygg items-array for et kort ut fra gjeldende DOM-rekkefølge (medlemskap).
  // `pool` = felles øyeblikksbilde av alle elementer (så en overføring ikke faller
  // ut mellom kilde- og mål-reconcile); bygges her hvis ikke gitt.
  function reconcileItems(cardId, pool) {
    const cardData = findCard(cardId);
    if (!cardData) return;
    const cardEl = board.querySelector('.card[data-id="' + cardId + '"]');
    if (!cardEl) return;
    pool = pool || itemPool();
    const domIds = [...cardEl.querySelectorAll('.items-container > .item')].map((i) => i.dataset.id);
    const visible = domIds.map((id) => pool[id]).filter(Boolean);
    // Bevar slettede elementer: de er skjult fra `.items-container`, så de ligger
    // ikke i DOM-rekkefølgen — men de skal ikke falle ut av state (uten gravstein)
    // når man drar/omorganiserer et synlig element i samme kort.
    const trashedHere = cardData.items.filter((it) => it.trashed);
    cardData.items = visible.concat(trashedHere);
  }

  /* ---------------- GRUPPE-DRAGING (header-rad) ----------------
     Gruppekortene ligger på en horisontal rad (som bryter til flere rader på
     desktop, og scroller horisontalt på mobil). Rekkefølgen endres med samme
     placeholder + FLIP-oppførsel som kort/elementer. Innsettingspunktet
     bestemmes i lese-rekkefølge: placeholderen legges foran det første kortet
     dra-senteret ligger «foran» (tidligere rad, eller samme rad + venstre for
     senter), ellers etter siste kort (foran «＋»-knappen). */
  function startGroupDrag(ev, groupEl) {
    if (ev.button != null && ev.button !== 0) return;
    if (drag.active) return; // ignorer ny drag mens en pågår (unngår foreldreløs placeholder)
    beginDragCommon(ev, groupEl);
    drag.kind = 'group';

    const ph = document.createElement('div');
    ph.className = 'group-placeholder';
    ph.style.width = drag.width + 'px';
    ph.style.height = drag.height + 'px';
    groupsBar.insertBefore(ph, groupEl);
    drag.ph = ph;

    liftElement();
    drag.el.style.transform = `rotate(${cardRotation()}deg) scale(1.05)`;
    window.addEventListener('pointermove', onGroupMove);
    window.addEventListener('pointerup', onGroupUp);
    window.addEventListener('pointercancel', onGroupUp);
  }

  function onGroupMove(ev) {
    if (!drag.active) return;
    const dx = ev.clientX - drag.lastX;
    const dy = ev.clientY - drag.lastY;
    drag.lastX = ev.clientX;
    drag.lastY = ev.clientY;
    moveElement();
    drag.el.style.transform = `rotate(${cardRotation()}deg) scale(1.05)`;
    updateGroupAutoScroll(ev);
    updateGroupPlacement(dx, dy);
  }

  // Er gruppelista en vertikal kolonne (desktop) eller en horisontal rad (mobil)?
  function groupsVertical() { return !window.matchMedia('(max-width: 560px)').matches; }

  // Dispatch: samme «ivrige», retningsstyrte bytte-logikk som kort/elementer,
  // transponert til gruppelistas orientering (vertikal kolonne / horisontal rad).
  function updateGroupPlacement(dx, dy) {
    if (groupsVertical()) updateGroupPlacementV(dx, dy);
    else updateGroupPlacementH(dx, dy);
  }

  // DESKTOP (vertikal kolonne): som elementer i én kolonne — bytt med kortet
  // over/under ut fra dra-retningen når de overlapper >= 20 % i høyden.
  function updateGroupPlacementV(dx, dy) {
    if (!drag.active || drag.kind !== 'group') return;
    const dragRect = draggedRect();
    const cards = [...groupsBar.querySelectorAll('.group-card:not(.dragging)')];
    if (!cards.length) return;
    const rects = new Map(cards.map((c) => [c, layoutRect(c)]));
    const ph = drag.ph;
    let action = null;
    if (dy > 0) {
      let best = null, bestTop = Infinity;
      for (const c of cards) {
        const r = rects.get(c);
        if (r.top >= dragRect.top && vOverlap(dragRect, r) >= SWAP_RATIO * r.height && r.top < bestTop) {
          bestTop = r.top; best = c;
        }
      }
      if (best) action = { ref: best, pos: 'after' };
    } else if (dy < 0) {
      let best = null, bestTop = -Infinity;
      for (const c of cards) {
        const r = rects.get(c);
        if (r.top <= dragRect.top && vOverlap(dragRect, r) >= SWAP_RATIO * r.height && r.top > bestTop) {
          bestTop = r.top; best = c;
        }
      }
      if (best) action = { ref: best, pos: 'before' };
    }
    if (!action || !wouldMove(ph, action.ref, action.pos)) return;
    const snap = snapshotRects(cards);
    placePlaceholder(groupsBar, ph, action.ref, action.pos); // 'after' siste kort → foran «＋»
    flipFrom(snap, FLIP_MS);
  }

  // MOBIL (horisontal rad): en **rad** = kort med >= 50 % vertikal overlapp med
  // dra-kortet (analogt til «kolonne» for kort). Innen raden byttes retningsstyrt
  // ved >= 20 % BREDDE-overlapp (dra høyre → kortet til høyre; dra venstre → til
  // venstre). Føres kortet til en annen rad (wrap), plasseres placeholderen ut fra
  // horisontal senterposisjon (kryss-rad, analogt til kryss-kolonne).
  function updateGroupPlacementH(dx, dy) {
    if (!drag.active || drag.kind !== 'group') return;
    const dragRect = draggedRect();
    const cards = [...groupsBar.querySelectorAll('.group-card:not(.dragging)')];
    if (!cards.length) return;
    const rects = new Map(cards.map((c) => [c, layoutRect(c)]));
    const ph = drag.ph;

    const row = cards.filter((c) => vOverlapFrac(dragRect, rects.get(c)) >= 0.5);
    const phInRow = row.length && vOverlapFrac(dragRect, layoutRect(ph)) >= 0.5;

    let action = null;
    if (row.length && !phInRow) {
      // Kryss-rad: plasser etter horisontal senterposisjon.
      const cx = dragRect.left + dragRect.width / 2;
      const sorted = row.slice().sort((a, b) => rects.get(a).left - rects.get(b).left);
      let ref = null;
      for (const c of sorted) {
        const r = rects.get(c);
        if (cx < r.left + r.width / 2) { ref = c; break; }
      }
      action = ref ? { ref, pos: 'before' } : { ref: sorted[sorted.length - 1], pos: 'after' };
    } else if (row.length && dx > 0) {
      // Høyre: nærmeste kort til høyre med >= 20 % breddeoverlapp.
      let best = null, bestLeft = Infinity;
      for (const c of row) {
        const r = rects.get(c);
        if (r.left >= dragRect.left && hOverlap(dragRect, r) >= SWAP_RATIO * r.width && r.left < bestLeft) {
          bestLeft = r.left; best = c;
        }
      }
      if (best) action = { ref: best, pos: 'after' };
    } else if (row.length && dx < 0) {
      // Venstre: nærmeste kort til venstre med >= 20 % breddeoverlapp.
      let best = null, bestLeft = -Infinity;
      for (const c of row) {
        const r = rects.get(c);
        if (r.left <= dragRect.left && hOverlap(dragRect, r) >= SWAP_RATIO * r.width && r.left > bestLeft) {
          bestLeft = r.left; best = c;
        }
      }
      if (best) action = { ref: best, pos: 'before' };
    }

    if (!action || !wouldMove(ph, action.ref, action.pos)) return;
    const snap = snapshotRects(cards);
    placePlaceholder(groupsBar, ph, action.ref, action.pos); // 'after' siste kort → foran «＋»
    flipFrom(snap, FLIP_MS);
  }

  function onGroupUp() {
    if (!drag.active) return;
    window.removeEventListener('pointermove', onGroupMove);
    window.removeEventListener('pointerup', onGroupUp);
    window.removeEventListener('pointercancel', onGroupUp);

    const el = drag.el;
    const rot = cardRotation();
    groupsBar.insertBefore(el, drag.ph);
    drag.ph.remove();
    dropIntoPlaceholder(el, rot);
    finishDrag();

    // Ny rekkefølge: pos mellom DOM-naboene (kun dette gruppe-kortets pos-register).
    const prev = el.previousElementSibling;
    const next = el.nextElementSibling;
    const g = findGroup(el.dataset.id);
    if (g) {
      const prevG = prev && prev.classList.contains('group-card') ? findGroup(prev.dataset.id) : null;
      const nextG = next && next.classList.contains('group-card') ? findGroup(next.dataset.id) : null;
      const np = between(prevG ? prevG.pos : null, nextG ? nextG.pos : null);
      if (g._mount) {
        // Montert gruppe: mottakerens egen rekkefølge ligger i membership-raden.
        g.pos = np; g._mount.pos = np;
        cloudMountUpdate('group', g.id, { pos: np });
      } else {
        g.pos = np;
        stampPos(g);
      }
    }
    reindexGroupColors();
    save();
  }

  // Samme resonnement som reindexCardColors: posisjonsbasert farge betyr at en
  // omrokkering påvirker flere gruppekorts farge, ikke bare det flyttede.
  function reindexGroupColors() {
    visibleGroups().forEach((g, i) => {
      g.color = colorForIndex(i);
      const el = groupsBar.querySelector('.group-card[data-id="' + g.id + '"]');
      if (!el) return;
      el.style.setProperty('--g-bg', g.color);
      el.style.setProperty('--g-accent', darken(g.color, 0.34));
    });
  }

  /* ------- Auto-scroll av gruppelista under draging (ved overflow) -------
     Desktop scroller vertikalt (kolonne), mobil horisontalt (rad). */
  let groupScrollRAF = null, groupScrollSpeed = 0, groupScrollAxis = 'x';
  function updateGroupAutoScroll(ev) {
    if (!drag.active || drag.kind !== 'group') { stopGroupAutoScroll(); return; }
    const r = groupsBar.getBoundingClientRect();
    const EDGE = 52;
    let speed = 0;
    if (groupsVertical()) {
      groupScrollAxis = 'y';
      const y = ev.clientY;
      if (y < r.top + EDGE) speed = -Math.ceil(((r.top + EDGE - y) / EDGE) * 16);
      else if (y > r.bottom - EDGE) speed = Math.ceil(((y - (r.bottom - EDGE)) / EDGE) * 16);
    } else {
      groupScrollAxis = 'x';
      const x = ev.clientX;
      if (x < r.left + EDGE) speed = -Math.ceil(((r.left + EDGE - x) / EDGE) * 16);
      else if (x > r.right - EDGE) speed = Math.ceil(((x - (r.right - EDGE)) / EDGE) * 16);
    }
    groupScrollSpeed = speed;
    if (speed !== 0) startGroupAutoScroll(); else stopGroupAutoScroll();
  }
  function startGroupAutoScroll() {
    if (groupScrollRAF != null) return;
    const step = () => {
      if (!drag.active || groupScrollSpeed === 0) { groupScrollRAF = null; return; }
      // Kortene flytter seg når feltet ruller → re-evaluer med rulleretningen som
      // syntetisk drag-retning (som kort-auto-scroll), på rett akse.
      if (groupScrollAxis === 'y') {
        const before = groupsBar.scrollTop;
        groupsBar.scrollTop += groupScrollSpeed;
        if (groupsBar.scrollTop !== before) updateGroupPlacement(0, groupScrollSpeed > 0 ? 1 : -1);
      } else {
        const before = groupsBar.scrollLeft;
        groupsBar.scrollLeft += groupScrollSpeed;
        if (groupsBar.scrollLeft !== before) updateGroupPlacement(groupScrollSpeed > 0 ? 1 : -1, 0);
      }
      groupScrollRAF = requestAnimationFrame(step);
    };
    groupScrollRAF = requestAnimationFrame(step);
  }
  function stopGroupAutoScroll() {
    if (groupScrollRAF != null) { cancelAnimationFrame(groupScrollRAF); groupScrollRAF = null; }
    groupScrollSpeed = 0;
  }

  /* ---------------- UNIVERS-DRAGING (meny-modalen) ----------------
     Univers-radene ligger alltid i én vertikal kolonne i uni-list (ingen
     mobil/desktop-veksling som gruppelista) — samme placeholder + FLIP-mønster
     og samme retningsstyrte bytte-logikk som gruppekortenes desktop-variant
     (updateGroupPlacementV), bare transponert til uni-list/.uni-row. */
  function startUniverseDrag(ev, uniEl) {
    if (ev.button != null && ev.button !== 0) return;
    if (drag.active) return; // ignorer ny drag mens en pågår (unngår foreldreløs placeholder)
    beginDragCommon(ev, uniEl);
    drag.kind = 'universe';

    const ph = document.createElement('div');
    ph.className = 'group-placeholder';
    ph.style.width = drag.width + 'px';
    ph.style.height = drag.height + 'px';
    uniList.insertBefore(ph, uniEl);
    drag.ph = ph;

    liftElement();
    drag.el.style.transform = `rotate(${cardRotation()}deg) scale(1.05)`;
    window.addEventListener('pointermove', onUniverseMove);
    window.addEventListener('pointerup', onUniverseUp);
    window.addEventListener('pointercancel', onUniverseUp);
  }

  function onUniverseMove(ev) {
    if (!drag.active) return;
    const dy = ev.clientY - drag.lastY;
    drag.lastX = ev.clientX;
    drag.lastY = ev.clientY;
    moveElement();
    drag.el.style.transform = `rotate(${cardRotation()}deg) scale(1.05)`;
    updateUniverseAutoScroll(ev);
    updateUniversePlacement(dy);
  }

  function updateUniversePlacement(dy) {
    if (!drag.active || drag.kind !== 'universe') return;
    const dragRect = draggedRect();
    const rows = [...uniList.querySelectorAll('.uni-row:not(.dragging)')];
    if (!rows.length) return;
    const rects = new Map(rows.map((r) => [r, layoutRect(r)]));
    const ph = drag.ph;
    let action = null;
    if (dy > 0) {
      let best = null, bestTop = Infinity;
      for (const r of rows) {
        const rc = rects.get(r);
        if (rc.top >= dragRect.top && vOverlap(dragRect, rc) >= SWAP_RATIO * rc.height && rc.top < bestTop) {
          bestTop = rc.top; best = r;
        }
      }
      if (best) action = { ref: best, pos: 'after' };
    } else if (dy < 0) {
      let best = null, bestTop = -Infinity;
      for (const r of rows) {
        const rc = rects.get(r);
        if (rc.top <= dragRect.top && vOverlap(dragRect, rc) >= SWAP_RATIO * rc.height && rc.top > bestTop) {
          bestTop = rc.top; best = r;
        }
      }
      if (best) action = { ref: best, pos: 'before' };
    }
    if (!action || !wouldMove(ph, action.ref, action.pos)) return;
    const snap = snapshotRects(rows);
    placePlaceholder(uniList, ph, action.ref, action.pos); // 'after' siste rad → foran «＋ Univers»
    flipFrom(snap, FLIP_MS);
  }

  function onUniverseUp() {
    if (!drag.active) return;
    window.removeEventListener('pointermove', onUniverseMove);
    window.removeEventListener('pointerup', onUniverseUp);
    window.removeEventListener('pointercancel', onUniverseUp);

    const el = drag.el;
    const rot = cardRotation();
    uniList.insertBefore(el, drag.ph);
    drag.ph.remove();
    dropIntoPlaceholder(el, rot);
    finishDrag();

    // Ny rekkefølge: pos mellom DOM-naboene (kun dette universets pos-register).
    const prev = el.previousElementSibling;
    const next = el.nextElementSibling;
    const u = findUniverse(el.dataset.id);
    if (u) {
      const prevU = prev && prev.classList.contains('uni-row') ? findUniverse(prev.dataset.id) : null;
      const nextU = next && next.classList.contains('uni-row') ? findUniverse(next.dataset.id) : null;
      const np = between(prevU ? prevU.pos : null, nextU ? nextU.pos : null);
      if (u._mount) {
        // Montert univers: mottakerens egen rekkefølge ligger i membership-raden.
        u.pos = np; u._mount.pos = np;
        cloudMountUpdate('universe', u.id, { pos: np });
      } else {
        u.pos = np;
        stampPos(u);
      }
    }
    reindexUniverseColors();
    save();
  }

  // Samme resonnement som reindexCardColors/reindexGroupColors.
  function reindexUniverseColors() {
    visibleUniverses().forEach((u, i) => {
      u.color = colorForIndex(i);
      const el = uniList.querySelector('.uni-row[data-id="' + u.id + '"]');
      if (!el) return;
      el.style.setProperty('--g-bg', u.color);
      el.style.setProperty('--g-accent', darken(u.color, 0.34));
    });
  }

  /* ------- Auto-scroll av uni-list under draging (alltid vertikal — menyens
     scroll-container er .menu-body, ikke selve uni-list). ------- */
  let uniScrollRAF = null, uniScrollSpeed = 0;
  function updateUniverseAutoScroll(ev) {
    const scroller = menuModal.querySelector('.menu-body');
    if (!drag.active || drag.kind !== 'universe' || !scroller) { stopUniverseAutoScroll(); return; }
    const r = scroller.getBoundingClientRect();
    const EDGE = 52;
    let speed = 0;
    const y = ev.clientY;
    if (y < r.top + EDGE) speed = -Math.ceil(((r.top + EDGE - y) / EDGE) * 16);
    else if (y > r.bottom - EDGE) speed = Math.ceil(((y - (r.bottom - EDGE)) / EDGE) * 16);
    uniScrollSpeed = speed;
    if (speed !== 0) startUniverseAutoScroll(scroller); else stopUniverseAutoScroll();
  }
  function startUniverseAutoScroll(scroller) {
    if (uniScrollRAF != null) return;
    const step = () => {
      if (!drag.active || uniScrollSpeed === 0) { uniScrollRAF = null; return; }
      const before = scroller.scrollTop;
      scroller.scrollTop += uniScrollSpeed;
      if (scroller.scrollTop !== before) updateUniversePlacement(uniScrollSpeed > 0 ? 1 : -1);
      uniScrollRAF = requestAnimationFrame(step);
    };
    uniScrollRAF = requestAnimationFrame(step);
  }
  function stopUniverseAutoScroll() {
    if (uniScrollRAF != null) { cancelAnimationFrame(uniScrollRAF); uniScrollRAF = null; }
    uniScrollSpeed = 0;
  }

  // Faste (position: fixed) header + verktøylinje er ute av flyten, så board-et må
  // få nøyaktig klaring: mobil = gruppemeny-høyde + verktøylinje-høyde, desktop =
  // kun verktøylinje-høyde (venstre-kolonnen klareres av margin-left i CSS).
  // --header-h eksponeres uansett (brukes av .toolbar sin egen topp-posisjon på
  // mobil). Selve padding-top for board-et regnes ut HER (ikke i en CSS calc())
  // og adderer --board-gap slik at avstanden ned til første kort blir
  // PIKSELNØYAKTIG lik gapet ellers (venstre/høyre/bunn-padding, kolonne-gap,
  // kort-til-kort). --board-gap er en clamp()/vw-verdi — å lese den direkte fra
  // :root ville gitt oss selve uttrykket (som streng), ikke tallet den løses til;
  // vi leser den derfor fra board sin FAKTISK OPPLØSTE column-gap i stedet.
  function syncHeaderHeight() {
    const root = document.documentElement.style;
    const headerH = appHeader.getBoundingClientRect().height;
    const toolbarH = toolbarEl ? toolbarEl.getBoundingClientRect().height : 0;
    root.setProperty('--header-h', headerH + 'px');
    const gap = parseFloat(getComputedStyle(board).columnGap) || 0;
    const mobile = window.matchMedia('(max-width: 560px)').matches;
    const topPad = (mobile ? headerH + toolbarH : toolbarH) + gap;
    root.setProperty('--board-pad-top', topPad + 'px');
  }
  if (typeof ResizeObserver === 'function') {
    const ro = new ResizeObserver(syncHeaderHeight);
    ro.observe(appHeader);
    if (toolbarEl) ro.observe(toolbarEl);
  }
  window.addEventListener('resize', () => { syncHeaderHeight(); fixBoardBottomGap(); });

  // Bunn-luft etter siste kort — uansett hvilken kolonne som ender opp høyest.
  // Kortenes EGEN margin-bottom (--board-gap) er upålitelig her: ved balanserte
  // kolonner (column-fill: balance, default) kan nettlesere se helt bort fra
  // siste korts margin når board-ets auto-høyde regnes ut (bidrar 0 i noen
  // kolonnefordelinger, hele verdien i andre — f.eks. når alt havner i én
  // kolonne). Vi måler derfor det FAKTISKE utfallet (nullstill → tving reflow →
  // les av) og legger PÅ akkurat nok padding til at totalen alltid blir
  // nøyaktig --board-gap, aldri mer og aldri mindre.
  function fixBoardBottomGap() {
    const cards = board.querySelectorAll('.card');
    if (!cards.length) { board.style.paddingBottom = '0px'; return; }
    board.style.paddingBottom = '0px';
    const boardBottom = board.getBoundingClientRect().bottom; // tvinger reflow
    let lastBottom = 0;
    cards.forEach((c) => { lastBottom = Math.max(lastBottom, c.getBoundingClientRect().bottom); });
    const gap = parseFloat(getComputedStyle(board).columnGap) || 0;
    const natural = boardBottom - lastBottom;
    board.style.paddingBottom = Math.max(0, gap - natural) + 'px';
  }

  /* ---------------- Topp-knapper ---------------- */
  addGroupBtn.addEventListener('click', addGroup);

  addCardBtn.addEventListener('click', () => {
    const g = activeGroupObj();
    if (!g) return;
    const c = card('Ny liste', [], g.id);
    c.pos = maxPos(g.cards) + 1;
    stampContent(c);
    stampPos(c);
    g.cards.push(c);
    render();
    // Fokuser den nye tittelen for redigering
    const el = board.querySelector('.card[data-id="' + c.id + '"] .card-title');
    if (el) el.click();
  });

  /* ---------------- Filter-brytere (verktøylinja) ----------------
     Kort trykk = uavhengig toggle. Hold i FILTER_HOLD_MS → aktiver kun den
     bryteren man holder (skru av den andre) — samme pointerdown/-up/-move-mønster
     som `attachTrashHold`, uten sveipefeltet. */
  function renderFilterSwitches() {
    filterSwitchesEl.querySelectorAll('.switch').forEach((sw) => {
      const on = filter[sw.dataset.flag] !== false;
      sw.classList.toggle('on', on);
      sw.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }
  const FILTER_HOLD_MS = 250;
  filterSwitchesEl.querySelectorAll('.switch').forEach((sw) => {
    const flag = sw.dataset.flag;
    const other = FILTERS.find((f) => f !== flag);
    let holdTimer = null, held = false;
    sw.addEventListener('pointerdown', (ev) => {
      if (ev.button != null && ev.button > 0) return;
      held = false;
      clearTimeout(holdTimer);
      holdTimer = setTimeout(() => {
        held = true;
        filter[flag] = true;
        filter[other] = false;
        saveFilter();
        render();
      }, FILTER_HOLD_MS);
    });
    const cancelHold = () => { clearTimeout(holdTimer); holdTimer = null; };
    sw.addEventListener('pointerup', cancelHold);
    sw.addEventListener('pointercancel', cancelHold);
    sw.addEventListener('pointerleave', cancelHold);
    sw.addEventListener('click', () => {
      if (held) { held = false; return; } // allerede håndtert av holdet
      filter[flag] = !filter[flag];
      saveFilter();
      render(); // tegner også bryterne på nytt via renderFilterSwitches()
    });
  });

  /* ============================================================
     SØPPELKASSER (universer / grupper / lister / elementer)
     ------------------------------------------------------------
     Fire nivåer, samme knapp (hvit beholder, emoji + antall i grå
     sirkel) og samme oppførsel; alle vises KUN når de har innhold:
       • universer → i meny-modalen (☰), ved siden av «＋ Univers».
       • grupper   → i gruppemenyens knapperad, ved siden av «＋ Gruppe».
       • lister    → i listemenyens knapperad, ved siden av «＋ Liste».
       • elementer → midtstilt nederst i hvert listekort.
     Interaksjon (attachTrashHold): kort trykk åpner modalen (gjenopprett/tøm
     derfra); klikk-og-hold utvider knappen til et sveipefelt («Sveip for å tømme
     →») der man sveiper mot høyre for å tømme (se attachTrashHold). */

  /* ---------- Felles modal (deles av alle fire nivåer) ---------- */
  let modalCfg = null;
  let modalOpenedAt = 0; // tid modalen ble åpnet — ignorér overlay-klikk rett etter

  // To modaler kan være åpne samtidig (søppelkassen over menyen); body låses
  // så lenge minst én er åpen.
  function updateModalOpenClass() {
    const share = document.getElementById('share-modal');
    const place = document.getElementById('place-modal');
    const confirmEl = document.getElementById('confirm-modal');
    document.body.classList.toggle('modal-open',
      !trashModal.hidden || !menuModal.hidden ||
      (share && !share.hidden) || (place && !place.hidden) ||
      (confirmEl && !confirmEl.hidden));
  }

  /* ---------- Felles bekreftelses-modal (erstatter native confirm()) ----------
     askConfirm(opts) → Promise<boolean>. Stables øverst (DOM sist blant modalene
     → over dem ved lik z-index), så den kan brukes fra del-modalen. */
  const confirmModalEl = document.getElementById('confirm-modal');
  const confirmTitleEl = document.getElementById('confirm-title');
  const confirmMsgEl = document.getElementById('confirm-msg');
  const confirmOkBtn = document.getElementById('confirm-ok');
  const confirmCancelBtn = document.getElementById('confirm-cancel');
  let confirmResolve = null;
  function askConfirm(opts) {
    opts = opts || {};
    confirmTitleEl.textContent = opts.title || 'Bekreft';
    confirmMsgEl.textContent = opts.message || '';
    confirmOkBtn.textContent = opts.okLabel || 'OK';
    confirmCancelBtn.textContent = opts.cancelLabel || 'Avbryt';
    // Grønn OK når handlingen ikke er destruktiv (danger: false), ellers rød.
    confirmOkBtn.className = 'btn btn-solid ' + (opts.danger === false ? 'btn-green' : 'btn-red');
    confirmModalEl.hidden = false;
    updateModalOpenClass();
    return new Promise((resolve) => {
      confirmResolve = resolve;
      confirmOkBtn.focus();
    });
  }
  function closeConfirm(result) {
    if (!confirmResolve) return;
    const done = confirmResolve;
    confirmResolve = null;
    confirmModalEl.hidden = true;
    updateModalOpenClass();
    done(result);
  }
  confirmOkBtn.addEventListener('click', () => closeConfirm(true));
  confirmCancelBtn.addEventListener('click', () => closeConfirm(false));
  confirmModalEl.addEventListener('click', (ev) => { if (ev.target === confirmModalEl) closeConfirm(false); });

  function showTrashModal(cfg) {
    modalCfg = cfg;
    trashTitle.textContent = cfg.title;
    modalNote.textContent = cfg.note;
    renderTrashModalBody();
    trashModal.hidden = false;
    modalOpenedAt = Date.now();
    updateModalOpenClass();
  }
  function renderTrashModalBody() {
    if (!modalCfg) return;
    const rows = modalCfg.rows();
    trashList.innerHTML = '';
    if (!rows.length) {
      const p = document.createElement('p');
      p.className = 'trash-empty-msg';
      p.textContent = modalCfg.emptyMsg;
      trashList.appendChild(p);
      trashEmptyBtn.disabled = true;
      return;
    }
    trashEmptyBtn.disabled = false;
    rows.forEach((r) => {
      const row = document.createElement('div');
      row.className = 'trash-row';
      if (r.color) {
        const dot = document.createElement('span');
        dot.className = 'trash-dot';
        dot.style.background = r.color;
        row.appendChild(dot);
      }
      const name = document.createElement('span');
      name.className = 'trash-name';
      name.textContent = r.name;
      row.appendChild(name);
      if (r.meta != null) {
        const meta = document.createElement('span');
        meta.className = 'trash-meta';
        meta.textContent = r.meta;
        row.appendChild(meta);
      }
      const restore = document.createElement('button');
      restore.className = 'btn btn-solid btn-green btn-small';
      restore.type = 'button';
      restore.textContent = 'Gjenopprett';
      restore.addEventListener('click', () => { r.restore(); renderTrashModalBody(); });
      row.appendChild(restore);
      trashList.appendChild(row);
    });
  }
  function closeTrash() {
    trashModal.hidden = true;
    updateModalOpenClass();
    modalCfg = null;
  }

  const TRASH_NOTE = 'Gjenopprett enkeltvis, eller tøm for å slette permanent. ' +
    'Tips: hold inne søppelkasse-knappen og sveip mot høyre for å tømme direkte.';
  const groupWord = (n) => n + ' ' + (n === 1 ? 'gruppe' : 'grupper');
  const listWord = (n) => n + ' ' + (n === 1 ? 'liste' : 'lister');
  const itemWord = (n) => n + ' ' + (n === 1 ? 'element' : 'elementer');

  /* ---------- De fire søppelkassene ---------- */
  function openUniversesTrash() {
    showTrashModal({
      title: 'Slettede universer',
      note: TRASH_NOTE,
      emptyMsg: 'Ingen slettede universer.',
      rows: () => trashedUniverses().sort(posCmp).map((u) => ({
        color: u.color || colorForId(u.id),
        name: u.name,
        meta: groupWord(u.groups.filter((g) => !g.trashed).length),
        restore: () => restoreUniverse(u),
      })),
      empty: emptyUniversesTrash,
    });
  }

  function openGroupsTrash() {
    showTrashModal({
      title: 'Slettede grupper',
      note: TRASH_NOTE,
      emptyMsg: 'Ingen slettede grupper.',
      rows: () => trashedGroups().sort(posCmp).map((g) => ({
        color: g.color || colorForId(g.id),
        name: g.name,
        meta: listWord(g.cards.filter((c) => !c.trashed).length),
        restore: () => restoreGroup(g),
      })),
      empty: emptyGroupsTrash,
    });
  }

  function openCardsTrash() {
    const g = activeGroupObj();
    if (!g) return; // lister-søppelkassen er per gruppe
    showTrashModal({
      title: 'Slettede lister – ' + g.name,
      note: TRASH_NOTE,
      emptyMsg: 'Ingen slettede lister.',
      rows: () => trashedCards().map((c) => ({
        color: c.color || colorForId(c.id),
        name: c.title,
        meta: itemWord(c.items.filter((it) => !it.trashed).length),
        restore: () => restoreCard(c),
      })),
      empty: emptyCardsTrash,
    });
  }

  function openItemsTrash(cardData) {
    showTrashModal({
      title: 'Slettede elementer – ' + cardData.title,
      note: TRASH_NOTE,
      emptyMsg: 'Ingen slettede elementer.',
      rows: () => trashedItemsOf(cardData).sort(posCmp).map((it) => ({
        name: it.text,
        restore: () => restoreItem(it, cardData),
      })),
      empty: () => emptyItemsTrash(cardData),
    });
  }

  // Tøm lister-søppelkassen (aktiv gruppe) permanent: gravstein per liste + element.
  function emptyCardsTrash() {
    const trash = trashedCards();
    if (!trash.length) return;
    const arr = allCards();
    let left = false;
    trash.forEach((c) => {
      const i = arr.indexOf(c);
      if (c._mount) {
        if (i > -1) arr.splice(i, 1);
        cloudLeave('card', c.id); left = true;
        return;
      }
      state._tomb.cards[c.id] = tick(); // permanent gravstein hindrer gjenoppstandelse
      c.items.forEach((it) => { state._tomb.items[it.id] = tick(); });
      if (i > -1) arr.splice(i, 1);
    });
    if (left) cloudBase = null;
    render();
    save();
  }

  // Tøm univers-søppelkassen permanent: gravsteiner for hvert slettet univers +
  // alle dets grupper, lister og elementer (hindrer gjenoppstandelse).
  function emptyUniversesTrash() {
    const trash = trashedUniverses();
    if (!trash.length) return;
    let left = false;
    trash.forEach((u) => {
      const i = state.universes.indexOf(u);
      if (u._mount) {
        if (i > -1) state.universes.splice(i, 1);
        cloudLeave('universe', u.id); left = true;
        return;
      }
      state._tomb.universes[u.id] = tick();
      u.groups.forEach((g) => {
        state._tomb.groups[g.id] = tick();
        g.cards.forEach((c) => {
          state._tomb.cards[c.id] = tick();
          c.items.forEach((it) => { state._tomb.items[it.id] = tick(); });
        });
      });
      if (i > -1) state.universes.splice(i, 1);
    });
    if (left) cloudBase = null;
    render();
    save();
  }

  /* ---------- Sveip-for-å-tømme (felles for alle tre knappene) ----------
     • Kort trykk → api.open() (modalen).
     • Klikk-og-hold → knappen utvider seg til et SVEIPEFELT («🗑️ Sveip for å
       tømme →»). Sveiper man mot høyre ende roterer søppelkasse-ikonet gradvis og
       blir opp-ned helt til høyre; da tømmes den (ikonet rister 500 ms, roterer
       tilbake mens feltet kollapser). Slipper man før høyre ende, kollapser feltet
       uten å tømme. api = { count, open, empty }. */
  const HOLD_EXPAND_MS = 320; // hold så lenge (grensen tap/hold) → utvid til sveipefelt
  const SWIPE_MOVE = 8;       // px bevegelse som også starter sveipet
  const SHAKE_MS = 500;       // rist-varighet etter tømming

  // Ett gjenbrukt, fixed sveipefelt (deles av alle knappene). Feltet starter
  // med KNAPPENS eksakte geometri (posisjon/størrelse/radius) og vokser ut av
  // den mens selve knappen skjules — det ser ut som knappen selv utvider seg
  // til sveipefeltet, ikke som en popover. Ved kollaps krymper det tilbake til
  // knappens bredde før knappen tar over igjen.
  let swipeEl = null, swipeIconEl = null, swipeLidEl = null;
  function ensureSwipeField() {
    if (swipeEl) return swipeEl;
    swipeEl = document.createElement('div');
    swipeEl.className = 'swipe-field';
    swipeEl.innerHTML =
      ICONS.trashSwipe +
      '<span class="swipe-label">Sveip for å tømme</span>' +
      '<span class="swipe-arrow" aria-hidden="true">→</span>';
    document.body.appendChild(swipeEl);
    swipeIconEl = swipeEl.querySelector('.swipe-icon');
    swipeLidEl = swipeEl.querySelector('.swipe-icon-lid');
    return swipeEl;
  }
  // Holdes i takt med .swipe-icon sin font-size i styles.css (ikon-boksens
  // bredde brukes til å plassere ikonet nøyaktig over knappens eget ikon).
  const SWIPE_ICON_BOX = 34;
  const COLLAPSE_MS = 200; // litt over CSS-bredde-transisjonen (0.18s)
  // Feltet er delt mellom alle søppelkasse-knappene → eierskap/kollaps-timer
  // må også være delt, ellers kan knapp A sin ventende kollaps skjule feltet
  // mens knapp B nettopp har åpnet det.
  let swipeOwnerBtn = null, swipeCollapseTimer = null;

  function attachTrashHold(btn, api) {
    let pid = null, startX = 0, startY = 0;
    let mode = null;           // null | 'pending' | 'swiping' | 'done'
    let holdTimer = null, ignoreClick = false;
    let swStart = 0, swEnd = 0; // sveip-strekk i klient-koordinater
    let btnRect = null;         // knappens geometri ved åpning (for kollaps tilbake)

    function setProgress(p) {
      if (!swipeEl) return;
      const pc = Math.min(1, Math.max(0, p));
      swipeEl.style.setProperty('--p', p.toFixed(3));
      swipeIconEl.style.transform = 'rotate(' + (p * 180) + 'deg)';
      // Lokket svinger stadig lenger opp gjennom hele sveipet (aldri tilbake
      // til lukket) — når kassen er helt opp-ned (p=1) henger den løst av,
      // ikke smekket igjen på nytt. Kropp + ribber er urørt og roterer kun
      // med hele ikonet (satt via swipeIconEl over).
      swipeLidEl.style.transform = 'rotate(' + (-95 * pc) + 'deg)';
    }
    function openField() {
      if (api.count() <= 0) return;    // ingenting å tømme
      mode = 'swiping';
      clearTimeout(swipeCollapseTimer);
      swipeOwnerBtn = btn;
      const r = btn.getBoundingClientRect();
      const iconEl = btn.querySelector('.trashcan-icon') || btn;
      const iconR = iconEl.getBoundingClientRect();
      const vw = window.innerWidth || document.documentElement.clientWidth || 360;
      const EDGE = 8;

      const field = ensureSwipeField();
      // Start = knappens eksakte flate; padding-left plasserer sveipe-ikonets
      // senter nøyaktig over knappens ikon-senter (samme visuelle størrelse).
      const iconCx = iconR.left + iconR.width / 2;
      const padLeft = Math.max(6, Math.round(iconCx - r.left - SWIPE_ICON_BOX / 2));
      swipeIconEl.classList.remove('shake');
      field.style.transition = 'none';
      field.style.left = r.left + 'px';
      field.style.top = r.top + 'px';
      field.style.height = r.height + 'px';
      field.style.width = r.width + 'px';
      field.style.borderRadius = getComputedStyle(btn).borderRadius;
      field.style.paddingLeft = padLeft + 'px';
      field.style.paddingRight = '15px';
      field.classList.add('open');
      setProgress(0);
      void field.offsetWidth;                  // reflow → animér utvidelsen
      field.style.transition = '';

      // Utvid mot høyre så langt det trengs/er plass (venstre kant og høyde
      // ligger fast → ingen vertikal asymmetri, ikonet står i ro).
      const width = Math.max(Math.round(r.width),
        Math.min(310, vw - EDGE - Math.round(r.left)));
      field.style.width = width + 'px';
      btnRect = r;
      // Knappen skjules IKKE: det opake feltet starter med knappens eksakte
      // geometri og dekker den fullstendig (og vokser utover), så det ser ut
      // som knappen selv utvider seg. Å skjule knappen ville dessuten droppet
      // pekerfangsten (setPointerCapture) midt i sveipet.

      // Sveip-strekk: fra ikon-senter til nær feltets høyre ende.
      swStart = iconCx;
      swEnd = r.left + width - 18;
      if (swEnd - swStart < 90) swEnd = swStart + 90;
    }
    function collapseField() {
      if (!swipeEl) return;
      setProgress(0); // roter kasse/lokk tilbake til hviletilstand
      swipeEl.style.removeProperty('--p');
      if (btnRect) swipeEl.style.width = btnRect.width + 'px'; // krymp til knappen
      clearTimeout(swipeCollapseTimer);
      swipeCollapseTimer = setTimeout(() => {
        // Skjul feltet KUN hvis denne knappen fortsatt eier det (en annen kan
        // ha åpnet det i mellomtiden — delt felt).
        if (swipeOwnerBtn === btn) {
          swipeEl.classList.remove('open');
          swipeOwnerBtn = null;
        }
        btnRect = null;
      }, COLLAPSE_MS);
    }
    function fireEmpty() {
      mode = 'done';
      setProgress(1);
      swipeIconEl.classList.add('shake'); // opp-ned + rist 500 ms
      api.empty();
      setTimeout(() => {
        if (swipeIconEl) swipeIconEl.classList.remove('shake');
        collapseField();                  // roter tilbake + kollaps
      }, SHAKE_MS);
    }

    btn.addEventListener('pointerdown', (ev) => {
      if (ev.button != null && ev.button > 0) return;
      ev.preventDefault();
      pid = ev.pointerId;
      try { btn.setPointerCapture(pid); } catch (e) { /* ignore */ }
      startX = ev.clientX; startY = ev.clientY;
      mode = 'pending';
      clearTimeout(holdTimer);
      holdTimer = setTimeout(() => { if (mode === 'pending') openField(); }, HOLD_EXPAND_MS);
    });
    btn.addEventListener('pointermove', (ev) => {
      if (mode === 'pending' &&
          (Math.abs(ev.clientX - startX) > SWIPE_MOVE || Math.abs(ev.clientY - startY) > SWIPE_MOVE)) {
        clearTimeout(holdTimer); holdTimer = null;
        openField();                        // rask sveip rett fra trykket
      }
      if (mode === 'swiping') {
        const p = Math.max(0, Math.min(1, (ev.clientX - swStart) / (swEnd - swStart)));
        setProgress(p);
        if (p >= 1) fireEmpty();            // nådd høyre ende (opp-ned) → tøm
      }
    });
    const onUp = (ev) => {
      if (pid != null) { try { btn.releasePointerCapture(pid); } catch (e) { /* ignore */ } }
      clearTimeout(holdTimer); holdTimer = null;
      // Svelg det etterfølgende (peker-genererte) klikket uansett, så det verken
      // åpner modalen på nytt (etter sveip) eller treffer modal-overlay-en.
      ignoreClick = true; setTimeout(() => { ignoreClick = false; }, 350);
      const moved = Math.abs(ev.clientX - startX) > SWIPE_MOVE || Math.abs(ev.clientY - startY) > SWIPE_MOVE;
      // Slapp før feltet rakk å utvide seg (mode fortsatt 'pending'), uten bevegelse
      // → kort trykk → åpne modalen (utsatt til etter click-sekvensen).
      if (mode === 'pending' && !moved) {
        mode = null;
        setTimeout(() => api.open(), 0);
        return;
      }
      if (mode === 'swiping') collapseField(); // slapp før høyre ende → kollaps uten tømming
      if (mode !== 'done') mode = null;        // 'done' rydder seg selv (fireEmpty)
    };
    btn.addEventListener('pointerup', onUp);
    btn.addEventListener('pointercancel', onUp);
    // Tastatur (Enter/Mellomrom) → syntetisk click uten peker: åpne modalen.
    btn.addEventListener('click', (ev) => {
      if (ignoreClick) { ignoreClick = false; ev.preventDefault(); ev.stopPropagation(); return; }
      api.open();
    });
  }

  /* ---------- Kobling: faste knapper (universer/grupper/lister) + modal-kontroller ---------- */
  attachTrashHold(trashBtn, {
    count: () => trashedCards().length,
    open: openCardsTrash,
    empty: emptyCardsTrash,
  });
  attachTrashHold(groupsTrashBtn, {
    count: () => trashedGroups().length,
    open: openGroupsTrash,
    empty: emptyGroupsTrash,
  });
  attachTrashHold(uniTrashBtn, {
    count: () => trashedUniverses().length,
    open: openUniversesTrash,
    empty: emptyUniversesTrash,
  });

  trashClose.addEventListener('click', closeTrash);
  // Klikk på selve overlay-en (utenfor modal-boksen) lukker — men ignorér det
  // (evt. forsinkede) klikket fra trykket som nettopp ÅPNET modalen. Uten dette
  // lukket åpnings-trykkets etter-klikk modalen igjen for gruppe-/liste-kurven
  // (som ligger nær kanten, der etter-klikket treffer overlay-en, ikke modal-boksen).
  trashModal.addEventListener('click', (ev) => {
    if (ev.target === trashModal && Date.now() - modalOpenedAt > 450) closeTrash();
  });
  // Escape lukker øverste modal først (søppelkassen kan ligge over menyen) —
  // men ikke midt i en inline-redigering (der avbryter Escape bare redigeringen).
  document.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Escape') return;
    if (ev.target && ev.target.classList && ev.target.classList.contains('edit-input')) return;
    if (confirmModalEl && !confirmModalEl.hidden) { closeConfirm(false); return; } // øverst
    const share = document.getElementById('share-modal');
    const place = document.getElementById('place-modal');
    if (place && !place.hidden) { place.hidden = true; updateModalOpenClass(); }
    else if (share && !share.hidden) { share.hidden = true; updateModalOpenClass(); }
    else if (!trashModal.hidden) closeTrash();
    else if (!menuModal.hidden) closeMenu();
  });
  // Ingen ekstra bekreftelse: sveipe-tømming har heller ingen, og tømming er
  // et bevisst valg i en modal man allerede har åpnet.
  trashEmptyBtn.addEventListener('click', () => {
    if (!modalCfg || !modalCfg.rows().length) return;
    modalCfg.empty();
    renderTrashModalBody();
  });

  /* ============================================================
     MENY-MODAL (☰) + UNIVERSER
     ------------------------------------------------------------
     Menyknappen (☰ i gruppemenyen på mobil / listemenyen på desktop) åpner en
     modal med «Logg ut» og univers-administrasjon. Universer er helt uavhengige
     områder (Univers > Gruppe > Liste > Element); de byttes/opprettes/omdøpes/
     slettes her, og har sin egen søppelkasse (samme oppførsel som de andre).
     Grupper kan aldri flyttes på tvers av universer. */
  function openMenu() {
    renderUniverses();
    menuModal.hidden = false;
    updateModalOpenClass();
  }
  function closeMenu() {
    menuModal.hidden = true;
    updateModalOpenClass();
  }
  menuBtn.addEventListener('click', openMenu);
  menuClose.addEventListener('click', closeMenu);
  menuModal.addEventListener('click', (ev) => {
    if (ev.target === menuModal) closeMenu();
  });

  // Univers-søppelkassen (i menyen): vises kun når den har innhold.
  function updateUniversesTrash() {
    const n = trashedUniverses().length;
    uniTrashCount.textContent = n;
    uniTrashBtn.hidden = n === 0;
  }

  // Tegn univers-radene i menyen. Kalles fra render() (så fjern-endringer
  // reflekteres straks også mens menyen er åpen) og ved åpning av menyen.
  function renderUniverses() {
    updateUniversesTrash();
    uniList.innerHTML = '';
    const vis = visibleUniverses();
    // Samme posisjonsbaserte fargesystem som gruppe-/listekort.
    vis.forEach((u, i) => { u.color = colorForIndex(i); });
    if (!vis.length) {
      const p = document.createElement('p');
      p.className = 'uni-empty';
      p.textContent = 'Ingen universer ennå.';
      uniList.appendChild(p);
      return;
    }
    vis.forEach((u) => uniList.appendChild(buildUniverseRow(u)));
  }

  function buildUniverseRow(u) {
    const el = uniTpl.content.firstElementChild.cloneNode(true);
    el.dataset.id = u.id;
    const isActive = u.id === state.activeUniverse;
    el.classList.toggle('active', isActive);
    el.setAttribute('aria-pressed', isActive ? 'true' : 'false');

    const base = u.color || colorForId(u.id);
    el.style.setProperty('--g-bg', base);
    el.style.setProperty('--g-accent', darken(base, 0.34));

    const uShared = accountsMode() && (u._shared || u._mount);
    const uCanEdit = !frozen(u);
    el.classList.toggle('is-shared', !!uShared);
    const uBadge = el.querySelector('.share-badge');
    if (uShared) {
      uBadge.hidden = false;
      uBadge.innerHTML = !uCanEdit ? ICONS.lock : ICONS.people;
      uBadge.title = u._mount ? 'Delt med deg' : 'Delt med andre';
    }
    const nameEl = el.querySelector('.uni-name');
    nameEl.textContent = u.name;
    // Antall grupper i universet: liten pill med gruppe-ikon (mappe) + tall.
    const uCountEl = el.querySelector('.uni-count');
    const uGroupN = u.groups.filter((g) => !g.trashed).length;
    uCountEl.innerHTML = ICONS.folder + '<span>' + uGroupN + '</span>';
    uCountEl.title = groupWord(uGroupN);

    // Bytt til universet (og lukk menyen — man bytter kontekst og går videre);
    // er det allerede aktivt → rediger navnet (samme mønster som gruppekort).
    const activate = () => {
      if (nameEl.dataset.editing === '1') return;
      if (u.id !== state.activeUniverse) {
        setActiveUniverse(u.id);
        render();
        save();
        closeMenu();
      } else if (uCanEdit) {
        startUniverseRename(nameEl, u);
      }
    };
    el.addEventListener('click', (ev) => {
      if (ev.target.closest('.uni-delete') || ev.target.closest('.group-handle')) return;
      activate();
    });
    el.addEventListener('keydown', (ev) => {
      if (ev.target !== el) return;
      if (ev.key === 'Enter' || ev.key === ' ' || ev.key === 'Spacebar') {
        ev.preventDefault();
        activate();
      }
    });
    const uDelBtn = el.querySelector('.uni-delete');
    if (accountsMode() && !uCanEdit && !u._mount) {
      uDelBtn.hidden = true;
    } else {
      uDelBtn.addEventListener('click', (ev) => { ev.stopPropagation(); deleteUniverse(u); });
    }

    const uHandle = el.querySelector('.group-handle');
    if (accountsMode() && !uCanEdit && !u._mount) {
      uHandle.style.visibility = 'hidden';
    } else {
      uHandle.addEventListener('pointerdown', (ev) => startUniverseDrag(ev, el));
      // Tastatur-reordering: piltaster opp/ned flytter universet i menylista.
      uHandle.addEventListener('keydown', (ev) => {
        const dir = arrowDir(ev, false);
        if (!dir) return;
        ev.preventDefault();
        const sorted = visibleUniverses();
        const i = sorted.indexOf(u);
        if (i < 0 || i + dir < 0 || i + dir >= sorted.length) return;
        const np = neighborPos(sorted, i, dir);
        if (u._mount) { u.pos = np; u._mount.pos = np; cloudMountUpdate('universe', u.id, { pos: np }); }
        else { u.pos = np; stampPos(u); }
        renderUniverses(); save();
        const h = uniList.querySelector('.uni-row[data-id="' + u.id + '"] .group-handle');
        if (h) h.focus();
      });
    }
    return el;
  }

  function startUniverseRename(nameEl, u) {
    editText(nameEl, u.name, (val) => {
      u.name = val || 'Uten navn';
      stampContent(u);
      save();
      renderUniverses();
      updatePanelTitles(activeGroupObj()); // navnet kan stå i «UNIVERS: …»-overskriften
    }, { cls: 'chip-edit', autosize: true });
  }

  function addUniverse() {
    const u = makeUniverse('Nytt univers');
    u.pos = state.universes.length ? maxPos(state.universes) + 1 : 0;
    stampContent(u);
    stampPos(u);
    state.universes.push(u);
    setActiveUniverse(u.id);
    render(); // tegner også univers-radene (nytt univers er tomt → tomt board)
    const nameEl = uniList.querySelector('.uni-row[data-id="' + u.id + '"] .uni-name');
    if (nameEl) startUniverseRename(nameEl, u);
  }
  addUniBtn.addEventListener('click', addUniverse);

  // Slett et univers → legg i univers-søppelkassen (trashed-flagg; gjenopprettbar).
  // Permanent sletting (med gravsteiner) skjer først når søppelkassen tømmes.
  function deleteUniverse(u) {
    const ghost = ghostFrom(uniList.querySelector('.uni-row[data-id="' + u.id + '"]'));
    if (u._mount) {
      // Mottaker: «slett» = legg mounten i egen søppel (kan forlates ved tømming).
      u.trashed = true; u._mount.trashed = true;
      cloudMountUpdate('universe', u.id, { trashed: true });
    } else {
      u.trashed = true;
      stampContent(u);
    }
    if (state.activeUniverse === u.id) {
      const first = visibleUniverses()[0];
      setActiveUniverse(first ? first.id : null);
    }
    render(); // univers-søppelkassen blir synlig FØR animasjonen starter
    save();
    flyGhost(ghost, uniTrashBtn);
    showToast('Slettet «' + u.name + '»', { label: 'Angre', fn: () => restoreUniverse(u) });
  }

  /* ============================================================
     SANNTIDS-SYNK (Supabase) MED FELT-NIVÅ FLETTING
     ------------------------------------------------------------
     Enheter som deler samme hemmelige synk-kode holdes fortløpende i
     synk. To mekanismer sørger for at ingenting går tapt:

       1) Fletting (à la git): hele tilstanden ligger som ett jsonb-doc,
          men hver entitet har egne «registre» med tidsstempel. Ved
          fletting velges nyeste verdi per felt. Endringer på ulike
          kort/elementer/felter kolliderer aldri; kun samme register
          endret på to enheter «konflikter», og da vinner nyeste.

       2) Optimistisk samtidighetskontroll (CAS) i databasen: save_list
          skriver kun hvis versjonen stemmer. Ellers får klienten gjeldende
          tilstand tilbake, fletter, og prøver igjen. Slik kan aldri én
          enhet overskrive en annens samtidige endring.

     Live-oppdatering skjer via Supabase Realtime (broadcast) med polling
     som fallback + oppdatering når fanen får fokus. Degraderer pent til
     ren localStorage hvis Supabase mangler / nettet er nede. */
  const SYNC_CODE_KEY = 'mine-lister-sync-code';

  let sb = null;              // Supabase-klient (lazy)
  let syncCode = null;        // aktiv synk-kode (utledet fra mønster), eller null
  let channelId = null;       // realtime-kanalnavn (sha256 av koden)
  let rtChannel = null;       // Supabase realtime-kanal
  let rtConnected = false;
  let serverVersion = 0;      // sist kjente versjon i databasen
  let lastServerCanon = null; // kanonisk form av doc vi vet ligger i databasen
  let applyingRemote = false; // sant mens vi skriver fjern-tilstand lokalt (unngå re-push)
  let legacyMode = false;     // databasen mangler ny save_list-signatur (før migrering)
  let cycleRunning = false, cycleAgain = false;
  let pollTimer = null, pollTick = 0, syncDebounce = null;

  const logoutBtn = document.getElementById('logout-btn');

  function cloudConfigured() {
    const c = window.SUPABASE_CONFIG;
    return !!(
      c && typeof c.url === 'string' && typeof c.anonKey === 'string' &&
      c.url.indexOf('DIN_') !== 0 && c.anonKey.indexOf('DIN_') !== 0 &&
      window.supabase && typeof window.supabase.createClient === 'function'
    );
  }

  function ensureClient() {
    if (sb) return sb;
    if (!cloudConfigured()) return null;
    sb = window.supabase.createClient(window.SUPABASE_CONFIG.url, window.SUPABASE_CONFIG.anonKey, {
      realtime: { params: { eventsPerSecond: 5 } },
    });
    return sb;
  }

  /* ---------- Kanonisk serialisering (rekkefølge-uavhengig likhet) ---------- */
  function canonValue(v) {
    if (Array.isArray(v)) {
      const arr = v.map(canonValue);
      if (arr.length && arr[0] && typeof arr[0] === 'object' && 'id' in arr[0]) {
        arr.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      }
      return arr;
    }
    if (v && typeof v === 'object') {
      const o = {};
      Object.keys(v).sort().forEach((k) => { o[k] = canonValue(v[k]); });
      return o;
    }
    return v;
  }
  function canonical(doc) { return JSON.stringify(canonValue(doc)); }

  /* ---------- Doc <-> state ---------- */
  // Synk-doc: kun det som deles (ikke activeUniverse/activeGroup, som er per enhet).
  function cleanItem(it, homeId) {
    return {
      id: it.id, text: it.text, home: it.home || homeId, trashed: !!it.trashed, done: !!it.done,
      ts: it.ts || 0, org: it.org || '',
      pos: it.pos || 0, posTs: it.posTs || 0, posOrg: it.posOrg || '',
    };
  }
  function cleanCard(c) {
    return {
      // Farge synkes ikke: den utledes av posisjon på hver enhet (colorForIndex).
      id: c.id, group: c.group || null, title: c.title, trashed: !!c.trashed,
      k: c.k !== false, p: c.p !== false,
      ts: c.ts || 0, org: c.org || '',
      labTs: c.labTs || 0, labOrg: c.labOrg || '',
      pos: c.pos || 0, posTs: c.posTs || 0, posOrg: c.posOrg || '',
    };
  }
  function cleanGroup(g) {
    return {
      id: g.id, uni: g.uni || null, name: g.name, trashed: !!g.trashed,
      ts: g.ts || 0, org: g.org || '',
      pos: g.pos || 0, posTs: g.posTs || 0, posOrg: g.posOrg || '',
    };
  }
  function cleanUniverse(u) {
    return {
      id: u.id, name: u.name, trashed: !!u.trashed,
      ts: u.ts || 0, org: u.org || '',
      pos: u.pos || 0, posTs: u.posTs || 0, posOrg: u.posOrg || '',
    };
  }
  // Synk-doc er flatt: fire parallelle tabeller (universer/grupper/lister/
  // elementer) med forelder-peker (gruppe.uni, kort.group, element.home).
  // Rekkefølge-uavhengig likhet via canonical(); activeUniverse/activeGroup
  // deles ikke (per enhet).
  function docFromState() {
    const universes = [], groups = [], cards = [], items = [];
    state.universes.forEach((u) => {
      universes.push(cleanUniverse(u));
      (u.groups || []).forEach((g) => {
        groups.push(cleanGroup(Object.assign({}, g, { uni: g.uni || u.id })));
        (g.cards || []).forEach((c) => {
          cards.push(cleanCard(Object.assign({}, c, { group: c.group || g.id })));
          (c.items || []).forEach((it) => items.push(cleanItem(it, c.id)));
        });
      });
    });
    return {
      universes, groups, cards, items,
      tomb: {
        universes: Object.assign({}, state._tomb.universes),
        groups: Object.assign({}, state._tomb.groups),
        cards: Object.assign({}, state._tomb.cards),
        items: Object.assign({}, state._tomb.items),
      },
      hlc: hlc,
    };
  }

  // Skriv et (flettet) flatt doc inn i state (nøstet igjen), behold
  // activeUniverse/activeGroup (validert), tegn på nytt.
  function applyDoc(doc) {
    applyingRemote = true;
    try {
      const universes = (doc.universes || []).map((u) => Object.assign(cleanUniverse(u), { groups: [] }));
      const uById = new Map(universes.map((u) => [u.id, u]));
      const gById = new Map();
      const cById = new Map();
      (doc.groups || []).forEach((raw) => {
        const g = cleanGroup(raw);
        const parent = uById.get(g.uni);
        if (!parent) return;      // foreldreløs gruppe → dropp
        g.cards = [];
        gById.set(g.id, g);
        parent.groups.push(g);
      });
      (doc.cards || []).forEach((raw) => {
        const c = cleanCard(raw);
        const parent = gById.get(c.group);
        if (!parent) return;      // foreldreløs liste → dropp
        c.items = [];
        cById.set(c.id, c);
        parent.cards.push(c);
      });
      (doc.items || []).forEach((raw) => {
        const it = cleanItem(raw, raw.home);
        const parent = cById.get(it.home);
        if (parent) parent.items.push(it); // foreldreløst element → dropp
      });
      universes.sort(posCmp);
      universes.forEach((u) => {
        u.groups.sort(posCmp);
        u.groups.forEach((g) => { g.cards.sort(posCmp); g.cards.forEach((c) => c.items.sort(posCmp)); });
      });

      state.universes = universes;
      state._tomb = {
        universes: Object.assign({}, (doc.tomb && doc.tomb.universes) || {}),
        groups: Object.assign({}, (doc.tomb && doc.tomb.groups) || {}),
        cards: Object.assign({}, (doc.tomb && doc.tomb.cards) || {}),
        items: Object.assign({}, (doc.tomb && doc.tomb.items) || {}),
      };
      state._hlc = doc.hlc || 0;
      observeTs(doc.hlc);
      validateActive(state);
      render();
    } finally {
      applyingRemote = false;
    }
  }

  /* ---------- Fletting (CRDT-lett, felt-nivå LWW + gravsteiner) ---------- */
  function deadBy(tombTs, ts, posTs, labTs) {
    if (tombTs == null) return false;
    return tombTs >= Math.max(ts || 0, posTs || 0, labTs || 0); // gravstein nyere/lik siste aktivitet
  }
  function mergeItem(a, b) {
    const content = newer(a.ts, a.org, b.ts, b.org) ? a : b;
    const posw = newer(a.posTs, a.posOrg, b.posTs, b.posOrg) ? a : b;
    return {
      id: a.id, text: content.text, trashed: !!content.trashed, done: !!content.done,
      ts: content.ts || 0, org: content.org || '',
      home: posw.home, pos: posw.pos || 0, posTs: posw.posTs || 0, posOrg: posw.posOrg || '',
    };
  }
  function mergeCardScalar(a, b) {
    const content = newer(a.ts, a.org, b.ts, b.org) ? a : b;
    const labw = newer(a.labTs, a.labOrg, b.labTs, b.labOrg) ? a : b; // merkelapper (k/p) flettes for seg
    const posw = newer(a.posTs, a.posOrg, b.posTs, b.posOrg) ? a : b;
    return {
      id: a.id,
      group: posw.group != null ? posw.group : (a.group || b.group || null), // forelder følger posisjon
      title: content.title,
      trashed: !!content.trashed,
      k: labw.k !== false, p: labw.p !== false,
      ts: content.ts || 0, org: content.org || '',
      labTs: labw.labTs || 0, labOrg: labw.labOrg || '',
      pos: posw.pos || 0, posTs: posw.posTs || 0, posOrg: posw.posOrg || '',
    };
  }
  function mergeGroupScalar(a, b) {
    const content = newer(a.ts, a.org, b.ts, b.org) ? a : b;
    const posw = newer(a.posTs, a.posOrg, b.posTs, b.posOrg) ? a : b;
    return {
      id: a.id,
      uni: posw.uni != null ? posw.uni : (a.uni || b.uni || null), // forelder følger posisjon
      name: content.name, trashed: !!content.trashed,
      ts: content.ts || 0, org: content.org || '',
      pos: posw.pos || 0, posTs: posw.posTs || 0, posOrg: posw.posOrg || '',
    };
  }
  function mergeUniverseScalar(a, b) {
    const content = newer(a.ts, a.org, b.ts, b.org) ? a : b;
    const posw = newer(a.posTs, a.posOrg, b.posTs, b.posOrg) ? a : b;
    return {
      id: a.id, name: content.name, trashed: !!content.trashed,
      ts: content.ts || 0, org: content.org || '',
      pos: posw.pos || 0, posTs: posw.posTs || 0, posOrg: posw.posOrg || '',
    };
  }
  function mergeTomb(a, b) {
    const out = { universes: {}, groups: {}, cards: {}, items: {} };
    ['universes', 'groups', 'cards', 'items'].forEach((k) => {
      const ax = (a && a[k]) || {}, bx = (b && b[k]) || {};
      Object.keys(ax).forEach((id) => { out[k][id] = ax[id]; });
      Object.keys(bx).forEach((id) => { out[k][id] = Math.max(out[k][id] || 0, bx[id]); });
    });
    return out;
  }
  // Flett to flate doc-er felt for felt. Universer/grupper/lister/elementer
  // flettes hver for seg på id (LWW per register); forelderløse (univers/gruppe/
  // kort borte) forkastes; gravlagte fjernes. Endringer på ulike entiteter/
  // felter kolliderer aldri.
  function mergeStates(a, b) {
    const tomb = mergeTomb(a.tomb, b.tomb);

    const universes = new Map();
    const addUniverses = (list) => (list || []).forEach((raw) => {
      const u = cleanUniverse(raw);
      const prev = universes.get(u.id);
      universes.set(u.id, prev ? mergeUniverseScalar(prev, u) : u);
    });
    addUniverses(a.universes); addUniverses(b.universes);
    universes.forEach((u, id) => { if (deadBy(tomb.universes[id], u.ts, u.posTs)) universes.delete(id); });

    const groups = new Map();
    const addGroups = (list) => (list || []).forEach((raw) => {
      const g = cleanGroup(raw);
      const prev = groups.get(g.id);
      groups.set(g.id, prev ? mergeGroupScalar(prev, g) : g);
    });
    addGroups(a.groups); addGroups(b.groups);
    groups.forEach((g, id) => { if (deadBy(tomb.groups[id], g.ts, g.posTs)) groups.delete(id); });
    groups.forEach((g, id) => { if (!universes.has(g.uni)) groups.delete(id); }); // foreldreløs gruppe

    const cards = new Map();
    const addCards = (list) => (list || []).forEach((raw) => {
      const c = cleanCard(raw);
      const prev = cards.get(c.id);
      cards.set(c.id, prev ? mergeCardScalar(prev, c) : c);
    });
    addCards(a.cards); addCards(b.cards);
    cards.forEach((c, id) => { if (deadBy(tomb.cards[id], c.ts, c.posTs, c.labTs)) cards.delete(id); });
    cards.forEach((c, id) => { if (!groups.has(c.group)) cards.delete(id); }); // foreldreløs liste

    const items = new Map();
    const addItems = (list) => (list || []).forEach((raw) => {
      const it = cleanItem(raw, raw.home);
      const prev = items.get(it.id);
      items.set(it.id, prev ? mergeItem(prev, it) : it);
    });
    addItems(a.items); addItems(b.items);
    items.forEach((it, id) => { if (deadBy(tomb.items[id], it.ts, it.posTs)) items.delete(id); });
    items.forEach((it, id) => { if (!cards.has(it.home)) items.delete(id); }); // foreldreløst element

    return {
      universes: [...universes.values()],
      groups: [...groups.values()],
      cards: [...cards.values()],
      items: [...items.values()],
      tomb, hlc: Math.max(a.hlc || 0, b.hlc || 0),
    };
  }

  /* ---------- Migrering av gamle former (fra databasen) ----------
     Alle tidligere doc-former løftes til den flate univers-formen:
       • to-fane-form (hel-tilstand ELLER forrige synk-doc med {tabs, …})
         → to faste grupper (Huskelister/Handlelister) …
       • flat gruppe-form ({groups, cards, items, …} uten universer)
     … og i begge tilfeller pakkes gruppene inn i standard-universet
     (uni-standard) med nøytrale registre (ts 0, org '') → alle enheter
     migrerer identisk og fletting dedupliserer av seg selv. Bevarer
     gravsteiner uansett om de lå som _tomb (state) eller tomb (doc). */
  function defaultUniverseRow() {
    return {
      id: DEFAULT_UNI.id, name: DEFAULT_UNI.name, trashed: false,
      ts: 0, org: '', pos: 0, posTs: 0, posOrg: '',
    };
  }
  function migrateBareState(s) {
    const src = s || {};
    const rawTomb = src._tomb || src.tomb || {};
    const tomb = {
      universes: rawTomb.universes || {},
      groups: rawTomb.groups || {}, cards: rawTomb.cards || {}, items: rawTomb.items || {},
    };
    const groups = [], cards = [], items = [];
    LEGACY_TABS.forEach((m, gi) => {
      groups.push({ id: m.id, uni: DEFAULT_UNI.id, name: m.name, ts: 0, org: '', pos: gi, posTs: 0, posOrg: '' });
      const tab = (src.tabs && src.tabs[m.key]) || {};
      const list = Array.isArray(tab.cards) ? tab.cards.slice() : [];
      if (Array.isArray(tab.trash)) tab.trash.forEach((c) => list.push(Object.assign({}, c, { trashed: true })));
      list.forEach((c, ci) => {
        cards.push(cleanCard(Object.assign({ pos: ci }, c, { group: m.id })));
        (c.items || []).forEach((it, ii) => items.push(cleanItem(Object.assign({ pos: ii }, it), c.id)));
      });
    });
    return { universes: [defaultUniverseRow()], groups, cards, items, tomb, hlc: src._hlc || src.hlc || 0 };
  }

  /* ---------- RPC-innpakninger (tolerante for før/etter DB-migrering) ---------- */
  async function rpcGet() {
    const client = ensureClient();
    if (!client || !syncCode) return null;
    const { data, error } = await client.rpc('get_list', { p_code: syncCode });
    if (error) throw error;
    if (data == null) return null;
    if (typeof data === 'object' && 'version' in data && 'data' in data) {
      // Ny form: { data, version }
      return { data: data.data ? normalizeRemoteDoc(data.data) : null, version: data.version || 0 };
    }
    if (data.tabs || data.groups || data.universes) return { data: normalizeRemoteDoc(data), version: 0 }; // bar tilstand
    return null;
  }
  // Normaliser fjern-doc: to-fane-form → migreres helt; flat gruppe-form (uten
  // universer) → gruppene pakkes inn i standard-universet; ny univers-form →
  // renses. Diskriminatorer: `tabs` (eldst), `universes` (nyest), ellers `groups`.
  function normalizeRemoteDoc(d) {
    if (!d || typeof d !== 'object') return migrateBareState(d || {});
    if (d.tabs) return migrateBareState(d);
    const tomb = {
      universes: (d.tomb && d.tomb.universes) || {},
      groups: (d.tomb && d.tomb.groups) || {},
      cards: (d.tomb && d.tomb.cards) || {},
      items: (d.tomb && d.tomb.items) || {},
    };
    if (!Array.isArray(d.universes)) {
      // Forrige flate form: grupper uten univers-nivå → inn i standard-universet.
      return {
        universes: [defaultUniverseRow()],
        groups: (Array.isArray(d.groups) ? d.groups : [])
          .map((g) => cleanGroup(Object.assign({}, g, { uni: DEFAULT_UNI.id }))),
        cards: (Array.isArray(d.cards) ? d.cards : []).map(cleanCard),
        items: (Array.isArray(d.items) ? d.items : []).map((it) => cleanItem(it, it.home)),
        tomb,
        hlc: typeof d.hlc === 'number' ? d.hlc : 0,
      };
    }
    return {
      universes: d.universes.map(cleanUniverse),
      groups: (Array.isArray(d.groups) ? d.groups : []).map(cleanGroup),
      cards: (Array.isArray(d.cards) ? d.cards : []).map(cleanCard),
      items: (Array.isArray(d.items) ? d.items : []).map((it) => cleanItem(it, it.home)),
      tomb,
      hlc: typeof d.hlc === 'number' ? d.hlc : 0,
    };
  }
  function isMissingFunction(error) {
    return !!error && (error.code === 'PGRST202' ||
      (typeof error.message === 'string' && /save_list|function|does not exist|schema cache/i.test(error.message)));
  }
  async function rpcSave(doc, prevVersion) {
    const client = ensureClient();
    if (!client || !syncCode) return null;
    if (!legacyMode) {
      const { data, error } = await client.rpc('save_list', {
        p_code: syncCode, p_data: doc, p_prev_version: prevVersion | 0,
      });
      if (!error) {
        if (data && data.ok) return { ok: true, version: data.version || 0 };
        if (data && data.ok === false) return { conflict: true, version: data.version || 0 };
        return { ok: true, version: (prevVersion | 0) + 1 };
      }
      if (isMissingFunction(error)) { legacyMode = true; } // fall tilbake til gammel signatur
      else throw error;
    }
    // Legacy (før migrering): gammel save_list(text,jsonb) uten CAS.
    const { error } = await client.rpc('save_list', { p_code: syncCode, p_data: doc });
    if (error) throw error;
    return { ok: true, version: (prevVersion | 0) + 1 };
  }

  /* ---------- Kjerne: én serialisert synk-runde (pull → flett → push) ---------- */
  function isBusyEditing() {
    if (drag.active) return true;
    const ae = document.activeElement;
    if (ae && ae.classList && ae.classList.contains('edit-input')) return true;
    if (ae && ae.classList && ae.classList.contains('add-item-input') && ae.value) return true;
    return false;
  }
  function scheduleSync(delay) {
    clearTimeout(syncDebounce);
    syncDebounce = setTimeout(syncCycle, delay == null ? 300 : delay);
  }
  async function syncCycle() {
    if (!syncCode || !cloudConfigured()) return;
    if (cycleRunning) { cycleAgain = true; return; }
    cycleRunning = true;
    try {
      const remote = await rpcGet();                    // { data, version } | null
      const ver = remote ? (remote.version || 0) : 0;
      const remoteDoc = remote && remote.data ? remote.data : null;
      if (remoteDoc) observeTs(remoteDoc.hlc);

      const localDoc = docFromState();
      const localCanon = canonical(localDoc);
      const mergedDoc = remoteDoc ? mergeStates(localDoc, remoteDoc) : localDoc;
      const mergedCanon = canonical(mergedDoc);
      const remoteCanon = remoteDoc ? canonical(remoteDoc) : null;

      // Reflekter fletteresultatet lokalt (hvis noe endret seg) — men ikke
      // avbryt aktiv redigering/draging; prøv da igjen straks etter.
      if (mergedCanon !== localCanon) {
        if (isBusyEditing()) { cycleAgain = true; }
        else { applyDoc(mergedDoc); showToast('Oppdatert fra en annen enhet'); }
      }

      // Push hvis vår (flettede) tilstand avviker fra det som ligger i databasen.
      if (mergedCanon !== remoteCanon) {
        const res = await rpcSave(mergedDoc, ver);
        if (res && res.ok) {
          serverVersion = res.version;
          lastServerCanon = mergedCanon;
          broadcastChanged(res.version);
        } else if (res && res.conflict) {
          serverVersion = res.version || ver;
          cycleAgain = true; // noen skrev i mellomtiden → flett på nytt
        } else {
          cycleAgain = true;
        }
      } else {
        serverVersion = ver;
        lastServerCanon = remoteCanon;
      }
    } catch (e) {
      // Offline / feil — realtime/poll prøver igjen senere.
    } finally {
      cycleRunning = false;
      if (cycleAgain) { cycleAgain = false; scheduleSync(150); }
    }
  }

  /* ---------- Realtime (broadcast) + poll-fallback ---------- */
  function broadcastChanged(version) {
    if (rtChannel && rtConnected) {
      try { rtChannel.send({ type: 'broadcast', event: 'changed', payload: { v: version, from: deviceId } }); }
      catch (e) { /* ignore */ }
    }
  }
  function startRealtime() {
    const client = ensureClient();
    if (!client || !channelId) return;
    if (rtChannel) { try { client.removeChannel(rtChannel); } catch (e) { /* ignore */ } rtChannel = null; }
    rtChannel = client.channel('hk-' + channelId, { config: { broadcast: { self: false } } });
    rtChannel.on('broadcast', { event: 'changed' }, (msg) => {
      const p = msg && msg.payload;
      if (!p || p.from === deviceId) return;
      scheduleSync(120); // en annen enhet skrev → hent + flett straks
    });
    rtChannel.subscribe((status) => {
      if (status === 'SUBSCRIBED') { rtConnected = true; scheduleSync(0); }
      else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        rtConnected = false;
        setTimeout(() => { if (!rtConnected && syncCode) startRealtime(); }, 4000);
      }
    });
  }
  function startPoll() {
    clearInterval(pollTimer);
    pollTimer = setInterval(() => {
      if (document.hidden || !syncCode) return;
      // Poll sjeldnere når realtime er tilkoblet (kun sikkerhetsnett).
      if (rtConnected && (pollTick++ % 4 !== 0)) return;
      syncCycle();
    }, 4000);
  }

  /* ---------- Lett, forbigående varsel (ingen fast statusindikator) ---------- */
  let toastTimer = null;
  // action (valgfri): { label, fn } → knapp i toasten (f.eks. «Angre»). Med
  // handling står toasten lenger (5 s) siden brukeren skal rekke å trykke.
  function showToast(msg, action) {
    let t = document.getElementById('toast');
    if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; document.body.appendChild(t); }
    t.innerHTML = '';
    const span = document.createElement('span');
    span.className = 'toast-msg';
    span.textContent = msg;
    t.appendChild(span);
    if (action && action.label && typeof action.fn === 'function') {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'toast-action';
      btn.textContent = action.label;
      btn.addEventListener('click', () => {
        t.classList.remove('show');
        clearTimeout(toastTimer);
        action.fn();
      });
      t.appendChild(btn);
    }
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), action ? 5000 : 2200);
  }

  /* ---------- Logg ut (i meny-modalen, ☰) ----------
     Synken går fortløpende i bakgrunnen; ingen egen synk-knapp trengs.
     Ved fjern-endringer vises et lite «oppdatert»-varsel (showToast). */
  logoutBtn.addEventListener('click', async () => {
    const q = accountsMode()
      ? 'Logge ut? Listene dine ligger trygt i skyen og kommer tilbake når du logger inn igjen.'
      : 'Logge ut? Listene dine ligger trygt i skyen og kommer tilbake når du tegner mønsteret igjen.';
    if (await askConfirm({ title: 'Logg ut', message: q, okLabel: 'Logg ut' })) logout();
  });

  // Hold i synk når fanen kommer i forgrunnen igjen (mobil suspenderer sockets/timere).
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && syncCode) {
      if (!rtConnected) startRealtime();
      scheduleSync(0);
    }
  });
  window.addEventListener('online', () => { if (syncCode) { startRealtime(); scheduleSync(0); } });
  window.addEventListener('focus', () => { if (syncCode) scheduleSync(200); });

  // Koble til: abonnér på realtime, start poll, kjør første synk-runde.
  async function syncConnect(code) {
    syncCode = code;
    try { localStorage.setItem(SYNC_CODE_KEY, code); } catch (e) { /* ignore */ }
    if (!cloudConfigured()) return;
    try { channelId = await sha256Hex('rt|' + code); } catch (e) { channelId = code; }
    startRealtime();
    startPoll();
    await syncCycle();
  }

  // Ved oppstart (allerede innlogget): koble til med den lagrede koden.
  async function syncInit() {
    const savedCode = localStorage.getItem(SYNC_CODE_KEY);
    if (!savedCode) return;
    await syncConnect(savedCode);
  }

  /* ---------------- Innlogging (mønster-lås) ----------------
     Splash-screen der man tegner et mønster i et 3x3-rutenett. Fasiten
     ligger kun som en hash i koden. Innlogging huskes til man logger ut.
     Synk-koden utledes fra mønsteret, så samme mønster gir samme lister. */
  const AUTH_KEY = 'mine-lister-auth';
  const FAIL_KEY = 'mine-lister-lock-fails';
  const UNTIL_KEY = 'mine-lister-lock-until';
  const MAX_FAILS = 5;                 // «mer enn 5 gale forsøk» → lås
  const LOCK_MS = 5 * 60 * 1000;       // 5 minutter
  const PATTERN_HASH = 'd49f889217daf70b19763a1491179f690d3b131ef10e2e2d849ce50d0f6e12ba';

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const lockScreen = document.getElementById('lock-screen');
  const lockSvg = document.getElementById('lock-svg');
  const lockPath = document.getElementById('lock-path');
  const lockLive = document.getElementById('lock-live');
  const lockNodesLayer = document.getElementById('lock-nodes');
  const lockMsg = document.getElementById('lock-msg');

  // Rutenett i 300x300-viewBox: sentre på 50/150/250, cellebredde 100.
  const LOCK_NODES = [];
  for (let r = 1; r <= 3; r++) {
    for (let c = 1; c <= 3; c++) {
      LOCK_NODES.push({ r, c, id: r + ',' + c, x: 50 + (c - 1) * 100, y: 50 + (r - 1) * 100 });
    }
  }
  const SNAP_R = 44;                   // treffradius ≈ halve cellebredden
  const lockNodeById = (id) => LOCK_NODES.find((n) => n.id === id);

  let drawSeq = [];
  const drawUsed = new Set();
  let drawing = false;
  let lockTimer = null;

  async function sha256Hex(str) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  function buildLockNodes() {
    LOCK_NODES.forEach((n) => {
      const g = document.createElementNS(SVG_NS, 'g');
      g.setAttribute('class', 'lock-node');
      g.setAttribute('data-id', n.id);
      const ring = document.createElementNS(SVG_NS, 'circle');
      ring.setAttribute('class', 'lock-ring');
      ring.setAttribute('cx', n.x); ring.setAttribute('cy', n.y); ring.setAttribute('r', 44);
      const dot = document.createElementNS(SVG_NS, 'circle');
      dot.setAttribute('class', 'lock-dot');
      dot.setAttribute('cx', n.x); dot.setAttribute('cy', n.y); dot.setAttribute('r', 9);
      g.appendChild(ring); g.appendChild(dot);
      lockNodesLayer.appendChild(g);
    });
  }

  function isLockedOut() {
    return Date.now() < (+localStorage.getItem(UNTIL_KEY) || 0);
  }

  function pointToViewBox(clientX, clientY) {
    const rect = lockSvg.getBoundingClientRect();
    return {
      x: (clientX - rect.left) / rect.width * 300,
      y: (clientY - rect.top) / rect.height * 300,
    };
  }

  function resetDraw() {
    drawSeq = [];
    drawUsed.clear();
    lockPath.setAttribute('points', '');
    lockLive.setAttribute('x1', 0); lockLive.setAttribute('y1', 0);
    lockLive.setAttribute('x2', 0); lockLive.setAttribute('y2', 0);
    lockScreen.classList.remove('err');
    [...lockNodesLayer.querySelectorAll('.lock-node')].forEach((g) => g.classList.remove('on'));
  }

  function redrawPath() {
    lockPath.setAttribute(
      'points',
      drawSeq.map((id) => { const n = lockNodeById(id); return n.x + ',' + n.y; }).join(' ')
    );
  }

  function pushNode(n) {
    drawSeq.push(n.id);
    drawUsed.add(n.id);
    const g = lockNodesLayer.querySelector('.lock-node[data-id="' + n.id + '"]');
    if (g) g.classList.add('on');
    redrawPath();
  }

  // Kun til nærmeste nabo (Chebyshev-avstand 1). Rett linje 2 unna
  // (horisontalt/vertikalt/diagonalt) → sett inn mellompunktet først.
  function tryAddNode(n) {
    if (drawUsed.has(n.id)) return;
    if (drawSeq.length === 0) { pushNode(n); return; }
    const last = lockNodeById(drawSeq[drawSeq.length - 1]);
    const dr = n.r - last.r, dc = n.c - last.c;
    const cheb = Math.max(Math.abs(dr), Math.abs(dc));
    if (cheb === 1) { pushNode(n); return; }
    if ((dr === 0 || Math.abs(dr) === 2) && (dc === 0 || Math.abs(dc) === 2) && cheb === 2) {
      const mid = lockNodeById(((last.r + n.r) / 2) + ',' + ((last.c + n.c) / 2));
      if (mid && !drawUsed.has(mid.id)) { pushNode(mid); pushNode(n); }
    }
    // ellers: ignorér (aldri lengre enn nærmeste nabo)
  }

  function snapAt(p) {
    for (const n of LOCK_NODES) {
      const dx = p.x - n.x, dy = p.y - n.y;
      if (dx * dx + dy * dy <= SNAP_R * SNAP_R) { tryAddNode(n); return; }
    }
  }

  function updateLive(p) {
    if (drawSeq.length === 0) {
      lockLive.setAttribute('x1', p.x); lockLive.setAttribute('y1', p.y);
      lockLive.setAttribute('x2', p.x); lockLive.setAttribute('y2', p.y);
      return;
    }
    const last = lockNodeById(drawSeq[drawSeq.length - 1]);
    lockLive.setAttribute('x1', last.x); lockLive.setAttribute('y1', last.y);
    lockLive.setAttribute('x2', p.x); lockLive.setAttribute('y2', p.y);
  }

  function onLockDown(ev) {
    if (isLockedOut()) return;
    ev.preventDefault();
    drawing = true;
    resetDraw();
    try { lockSvg.setPointerCapture(ev.pointerId); } catch (e) { /* ignore */ }
    const p = pointToViewBox(ev.clientX, ev.clientY);
    snapAt(p); updateLive(p);
  }
  function onLockMove(ev) {
    if (!drawing) return;
    const p = pointToViewBox(ev.clientX, ev.clientY);
    snapAt(p); updateLive(p);
  }
  async function onLockUp() {
    if (!drawing) return;
    drawing = false;
    lockLive.setAttribute('x2', lockLive.getAttribute('x1'));
    lockLive.setAttribute('y2', lockLive.getAttribute('y1'));
    const seqStr = drawSeq.join('-');
    if (drawSeq.length < 2) { resetDraw(); return; }
    if ((await sha256Hex('verify|' + seqStr)) === PATTERN_HASH) {
      localStorage.removeItem(FAIL_KEY);
      localStorage.removeItem(UNTIL_KEY);
      localStorage.setItem(AUTH_KEY, '1');
      const code = await sha256Hex('sync|' + seqStr);
      await unlockApp(code);
    } else {
      onLockFail();
    }
  }

  function onLockFail() {
    lockScreen.classList.add('err');
    const fails = (+localStorage.getItem(FAIL_KEY) || 0) + 1;
    localStorage.setItem(FAIL_KEY, String(fails));
    if (fails > MAX_FAILS) {
      localStorage.setItem(UNTIL_KEY, String(Date.now() + LOCK_MS));
      localStorage.removeItem(FAIL_KEY);
      startLockCountdown();
    } else {
      const left = MAX_FAILS + 1 - fails;
      lockMsg.textContent = 'Feil mønster – ' + left + ' forsøk igjen.';
      setTimeout(() => { if (!drawing) resetDraw(); }, 700);
    }
  }

  function startLockCountdown() {
    clearInterval(lockTimer);
    const tick = () => {
      const ms = (+localStorage.getItem(UNTIL_KEY) || 0) - Date.now();
      if (ms <= 0) {
        clearInterval(lockTimer);
        lockScreen.classList.remove('locked-out');
        lockMsg.textContent = 'Tegn mønsteret for å låse opp.';
        resetDraw();
        return;
      }
      const m = Math.floor(ms / 60000);
      const s = Math.floor((ms % 60000) / 1000);
      lockScreen.classList.add('locked-out');
      lockMsg.textContent = 'For mange forsøk. Låst i ' + m + ':' + String(s).padStart(2, '0');
    };
    tick();
    lockTimer = setInterval(tick, 500);
  }

  let appStarted = false;
  async function unlockApp(code) {
    lockScreen.hidden = true;
    document.body.classList.remove('locked');
    if (!appStarted) {
      appStarted = true;
      render();
    }
    if (code) await syncConnect(code);
    else await syncInit();
  }

  function logout() {
    if (accountsMode()) {
      closeMenu();
      const client = acli();
      cloudStop();
      if (client) { try { client.auth.signOut(); } catch (e) { /* ignore */ } }
      return;
    }
    try { if (rtChannel && sb) sb.removeChannel(rtChannel); } catch (e) { /* ignore */ }
    clearInterval(pollTimer);
    clearTimeout(syncDebounce);
    localStorage.removeItem(AUTH_KEY);
    localStorage.removeItem(SYNC_CODE_KEY);
    location.reload();
  }

  /* ============================================================
     FASE 2 — BRUKERKONTOER OG DELING (klient)
     ------------------------------------------------------------
     Ekte kontoer (Supabase Auth) med e-post/passord erstatter
     mønster-låsen. Data ligger relasjonelt (universes/groups/cards/
     items + memberships) med RLS og server-side felt-nivå LWW.
     Synk-motor v2: get_my_doc() (pull) → 3-veis fletting mot en
     base-snapshot → rad-CRUD (push); realtime postgres_changes +
     poll. Delte objekter «monteres» inn i mottakerens valgte
     forelder via membership-rader. Se docs/arkitektur-brukere-
     deling.md og docs/auth.md.
     ============================================================ */

  // Kontomodus: på når Supabase er konfigurert (kan tvinges av / av med
  // query-parametere for testing). ?mock=1 kjører mot en hermetisk
  // in-memory-backend (mock-backend.js) for to-bruker-testing.
  function useMock() { return /[?&]mock=1/.test(location.search); }
  // Kontomodus er bevisst BAK et flagg inntil fase 2 er verifisert mot ekte
  // Supabase (Auth-dashboard-stegene i TODO.md må gjøres først: Site URL,
  // Redirect URLs, «Confirm email»). Slås på med `window.SUPABASE_CONFIG.accounts
  // = true` (config.js), `?accounts=1`, eller `?mock=1` (hermetisk testbackend).
  // Til da kjører den gamle mønster-låsen + synk-doc-modellen uendret.
  function accountsMode() {
    if (useMock()) return true;
    if (/[?&]patternlock=1/.test(location.search)) return false;
    if (/[?&]accounts=1/.test(location.search)) return cloudConfigured();
    if (window.SUPABASE_CONFIG && window.SUPABASE_CONFIG.accounts === true) return cloudConfigured();
    return false;
  }

  let authUser = null;         // innlogget bruker { id, email } | null
  let aclient = null;          // backend-klient (Supabase eller mock)
  function acli() {
    if (aclient) return aclient;
    if (useMock() && window.HK_MOCK) { aclient = window.HK_MOCK.createClient(); return aclient; }
    aclient = ensureClient();
    return aclient;
  }

  /* ---------------- Auth-UI (registrering/innlogging/glemt) ---------------- */
  const authScreen = document.getElementById('auth-screen');
  const authForm = document.getElementById('auth-form');
  const authHeading = document.getElementById('auth-heading');
  const authHeadingIcon = document.getElementById('auth-heading-icon');
  const authEmail = document.getElementById('auth-email');
  const authPassword = document.getElementById('auth-password');
  const authPassField = document.getElementById('auth-pass-field');
  const authMsgEl = document.getElementById('auth-msg');
  const authSubmit = document.getElementById('auth-submit');
  const authLinks = document.getElementById('auth-links');
  const authSent = document.getElementById('auth-sent');
  const authSentMsg = document.getElementById('auth-sent-msg');
  const authSentBack = document.getElementById('auth-sent-back');
  let authModeCur = 'login';

  const AUTH_MODES = {
    login:    { title: 'Logg inn',       submit: 'Logg inn',        pass: true,  icon: 'login' },
    register: { title: 'Registrer deg',  submit: 'Opprett konto',   pass: true,  icon: 'profile' },
    forgot:   { title: 'Glemt passord',  submit: 'Send lenke',      pass: false, icon: 'lock' },
  };
  function setAuthMode(mode) {
    authModeCur = mode;
    const m = AUTH_MODES[mode];
    authHeading.textContent = m.title;
    authHeadingIcon.innerHTML = ICONS[m.icon];
    authSubmit.textContent = m.submit;
    authPassField.hidden = !m.pass;
    authPassword.required = m.pass;
    authPassword.autocomplete = mode === 'register' ? 'new-password' : 'current-password';
    authMsg('');
    authForm.hidden = false;
    authSent.hidden = true;
    // Lenkene bytter ut fra modus.
    authLinks.innerHTML = '';
    const link = (label, target) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'auth-link'; b.dataset.mode = target; b.textContent = label;
      b.addEventListener('click', () => setAuthMode(target));
      authLinks.appendChild(b);
    };
    if (mode === 'login') { link('Ny bruker? Registrer deg', 'register'); link('Glemt passord?', 'forgot'); }
    else if (mode === 'register') { link('Har du konto? Logg inn', 'login'); }
    else { link('Tilbake til innlogging', 'login'); }
  }
  function authMsg(text, ok) {
    authMsgEl.textContent = text || '';
    authMsgEl.classList.toggle('ok', !!ok);
  }
  function showAuthSent(html) {
    authForm.hidden = true;
    authSent.hidden = false;
    authSentMsg.innerHTML = html;
  }
  // Brukerinput som skal inn i en HTML-streng (f.eks. e-post i «sjekk
  // innboksen»-meldingen) escapes alltid først.
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }
  function friendlyAuthError(err) {
    const msg = (err && err.message) || String(err || 'Noe gikk galt');
    if (/invalid login credentials/i.test(msg)) return 'Feil e-post eller passord.';
    if (/email not confirmed/i.test(msg)) return 'E-posten er ikke bekreftet ennå – sjekk innboksen.';
    if (/already registered|already exists|user already/i.test(msg)) return 'Denne e-posten er allerede registrert.';
    if (/password should be at least|weak password/i.test(msg)) return 'Passordet må ha minst 6 tegn.';
    if (/rate limit|too many/i.test(msg)) return 'For mange forsøk – vent litt og prøv igjen.';
    return msg;
  }

  authForm && authForm.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const client = acli();
    if (!client) { authMsg('Sky-synk er ikke konfigurert.'); return; }
    const email = authEmail.value.trim().toLowerCase();
    const password = authPassword.value;
    if (!email) { authMsg('Skriv inn e-postadressen din.'); return; }
    authSubmit.disabled = true;
    authMsg('');
    try {
      if (authModeCur === 'login') {
        const { error } = await client.auth.signInWithPassword({ email, password });
        if (error) throw error;
        // onAuthStateChange starter appen.
      } else if (authModeCur === 'register') {
        const { data, error } = await client.auth.signUp({
          email, password,
          options: { emailRedirectTo: location.origin + location.pathname },
        });
        if (error) throw error;
        if (data && data.session) {
          // Bekreftelse er av → onAuthStateChange logger inn direkte.
        } else {
          showAuthSent('Vi har sendt en bekreftelseslenke til <strong>' + escapeHtml(email) +
            '</strong>. Åpne den for å fullføre registreringen, så kan du logge inn.');
        }
      } else if (authModeCur === 'forgot') {
        const { error } = await client.auth.resetPasswordForEmail(email, {
          redirectTo: location.origin + location.pathname,
        });
        if (error) throw error;
        showAuthSent('Hvis <strong>' + escapeHtml(email) + '</strong> har en konto, har vi sendt en ' +
          'lenke for å velge nytt passord. Sjekk innboksen.');
      }
    } catch (e) {
      authMsg(friendlyAuthError(e));
    } finally {
      authSubmit.disabled = false;
    }
  });
  authSentBack && authSentBack.addEventListener('click', () => setAuthMode('login'));

  async function handleRecovery() {
    const np = prompt('Velg et nytt passord (minst 6 tegn):');
    if (!np || np.length < 6) { showToast('Passordet må ha minst 6 tegn'); return; }
    try {
      const { error } = await acli().auth.updateUser({ password: np });
      if (error) throw error;
      showToast('Passordet er oppdatert');
    } catch (e) { showToast(friendlyAuthError(e)); }
  }

  /* ---------------- Backend-metadata på state-objektene ----------------
     Hvert nested objekt får (utenfor synk-doc'et): _owner/_mine/_locked/
     _shared/_mount/_parent. _mount finnes kun på en «share-rot» mottakeren
     har montert; da speiler objektets .pos/.trashed montasjepunktet (per
     bruker), mens de kanoniske verdiene ligger i _canon (til push). */
  function isMounted(o) { return !!(o && o._mount); }
  function effTrashed(o) { return o && o._mount ? !!o._mount.trashed : !!(o && o.trashed); }
  // Frosset = objektet selv eller en forelder er låst av noen andre enn meg.
  function frozen(o) {
    let n = o;
    while (n) {
      if (n._locked && !n._mine) return true;
      n = n._parent;
    }
    return false;
  }
  const isMine = (o) => !o || o._mine !== false; // lokalt nye (uten meta) er «mine»

  /* ---------------- get_my_doc → kanonisk innholds-doc + metadata ---------------- */
  function contentDocFromMy(my) {
    let maxTs = 0;
    const bump = (r) => { maxTs = Math.max(maxTs, r.ts || 0, r.posTs || 0, r.labTs || 0); };
    const universes = (my.universes || []).map((u) => { const r = cleanUniverse(u); bump(r); return r; });
    const groups = (my.groups || []).map((g) => { const r = cleanGroup(g); bump(r); return r; });
    const cards = (my.cards || []).map((c) => { const r = cleanCard(c); bump(r); return r; });
    const items = (my.items || []).map((it) => { const r = cleanItem(it, it.home); bump(r); return r; });
    return { universes, groups, cards, items, hlc: maxTs };
  }
  function metaFromMy(my) {
    const meta = new Map();
    const add = (list, type) => (list || []).forEach((r) => meta.set(r.id, {
      type, owner: r.owner, mine: r.mine !== false, locked: !!r.locked,
      shared: !!r.shared, mount: r.mount || null,
    }));
    add(my.universes, 'universe');
    add(my.groups, 'group');
    add(my.cards, 'card');
    add(my.items, 'item');
    return meta;
  }

  /* ---------------- Lokal state → kanonisk innholds-doc (for push) ----------------
     For monterte røtter brukes kanoniske verdier (fra _canon) for pos/
     forelder/trashed, mens innhold (navn/tekst/k/p) leses live (kan være
     redigert). For alt annet leses alt live. */
  function canonRow(o, type) {
    if (o._mount && o._canon) {
      const c = o._canon;
      const base = {
        id: o.id, ts: o.ts || 0, org: o.org || '',
        trashed: !!c.trashed, pos: c.pos || 0, posTs: c.posTs || 0, posOrg: c.posOrg || '',
      };
      if (type === 'universe') return Object.assign(base, { name: o.name });
      if (type === 'group') return Object.assign(base, { name: o.name, uni: c.parent });
      if (type === 'card') return Object.assign(base, {
        title: o.title, group: c.parent, k: o.k !== false, p: o.p !== false,
        labTs: o.labTs || 0, labOrg: o.labOrg || '',
      });
    }
    if (type === 'universe') return cleanUniverse(o);
    if (type === 'group') return cleanGroup(o);
    if (type === 'card') return cleanCard(o);
    return cleanItem(o, o.home);
  }
  function docFromMyState() {
    const universes = [], groups = [], cards = [], items = [];
    state.universes.forEach((u) => {
      universes.push(canonRow(u, 'universe'));
      (u.groups || []).forEach((g) => {
        groups.push(canonRow(g, 'group'));
        (g.cards || []).forEach((c) => {
          cards.push(canonRow(c, 'card'));
          (c.items || []).forEach((it) => items.push(cleanItem(it, it.home)));
        });
      });
    });
    return { universes, groups, cards, items };
  }

  /* ---------------- 3-veis fletting (base/lokal/fjern) → merged + push-ops ----------------
     base = forrige serverkjente doc. For hver rad:
       lokal & fjern  → felt-LWW; push oppdatering hvis vår vant på et register
       lokal, !fjern, base → fjern-slettet → droppes
       lokal, !fjern, !base → lokalt ny → beholdes + push insert
       !lokal, fjern, base → lokalt slettet → droppes + push delete
       !lokal, fjern, !base → fjern-ny → legges til
     Innhold-LWW gjenbruker merge*Scalar/mergeItem fra synk v1. */
  function emptyDoc() { return { universes: [], groups: [], cards: [], items: [] }; }
  function reconcile(base, local, remote) {
    const merged = { universes: [], groups: [], cards: [], items: [] };
    const ops = [];
    const TYPES = [
      { key: 'universes', t: 'universe', merge: mergeUniverseScalar },
      { key: 'groups', t: 'group', merge: mergeGroupScalar },
      { key: 'cards', t: 'card', merge: mergeCardScalar },
      { key: 'items', t: 'item', merge: mergeItem },
    ];
    TYPES.forEach(({ key, t, merge }) => {
      const bMap = new Map((base[key] || []).map((r) => [r.id, r]));
      const lMap = new Map((local[key] || []).map((r) => [r.id, r]));
      const rMap = new Map((remote[key] || []).map((r) => [r.id, r]));
      const ids = new Set([...lMap.keys(), ...rMap.keys()]);
      ids.forEach((id) => {
        const L = lMap.get(id), R = rMap.get(id), B = bMap.get(id);
        if (L && R) {
          const m = merge(L, R);
          merged[key].push(m);
          if (canonical(m) !== canonical(R)) ops.push({ op: 'update', t, row: m });
        } else if (L && !R && !B) {
          merged[key].push(L);
          ops.push({ op: 'insert', t, row: L });
        } else if (!L && R && B) {
          ops.push({ op: 'delete', t, id });
        } else if (!L && R && !B) {
          merged[key].push(R);
        }
        // L && !R && B  → fjern-slettet → dropp (ingen op)
      });
    });
    return { merged, ops };
  }

  /* ---------------- merged (kanonisk) + metadata → nested state ----------------
     Monterte røtter re-foreldres til montasjepunktet (mount.parent); .pos/
     .trashed speiler mounten (per bruker), kanoniske verdier i _canon.
     «Umonterte» delinger (mount uten parent) samles til plassering. */
  let pendingPlacements = [];
  function applyMyDoc(doc, meta) {
    applyingRemote = true;
    try {
      pendingPlacements = [];
      const attachMeta = (obj, id, canonParent) => {
        const m = meta.get(id);
        obj._mine = m ? m.mine : true;
        obj._owner = m ? m.owner : (authUser && authUser.id);
        obj._locked = m ? m.locked : false;
        obj._shared = m ? m.shared : false;
        obj._mount = m && m.mount ? m.mount : null;
        if (obj._mount) {
          obj._canon = { parent: canonParent, pos: obj.pos, posTs: obj.posTs, posOrg: obj.posOrg, trashed: obj.trashed };
          obj.pos = obj._mount.pos || 0;
          obj.trashed = !!obj._mount.trashed;
        }
      };

      const universes = (doc.universes || []).map((u) => Object.assign(cleanUniverse(u), { groups: [] }));
      universes.forEach((u) => attachMeta(u, u.id, null));
      const uById = new Map(universes.map((u) => [u.id, u]));

      const gById = new Map();
      (doc.groups || []).forEach((raw) => {
        const g = Object.assign(cleanGroup(raw), { cards: [] });
        attachMeta(g, g.id, g.uni);
        const parentId = g._mount ? g._mount.parent : g.uni;
        const parent = parentId != null ? uById.get(parentId) : null;
        if (!parent) {
          if (g._mount) { pendingPlacements.push({ type: 'group', id: g.id, name: g.name, obj: g }); }
          return; // foreldreløs / umontert
        }
        g._parent = parent;
        gById.set(g.id, g);
        parent.groups.push(g);
      });

      const cById = new Map();
      (doc.cards || []).forEach((raw) => {
        const c = Object.assign(cleanCard(raw), { items: [] });
        attachMeta(c, c.id, c.group);
        const parentId = c._mount ? c._mount.parent : c.group;
        const parent = parentId != null ? gById.get(parentId) : null;
        if (!parent) {
          if (c._mount) { pendingPlacements.push({ type: 'card', id: c.id, name: c.title, obj: c }); }
          return;
        }
        c._parent = parent;
        cById.set(c.id, c);
        parent.cards.push(c);
      });

      (doc.items || []).forEach((raw) => {
        const it = cleanItem(raw, raw.home);
        const parent = cById.get(it.home);
        if (parent) { it._parent = parent; it._mine = true; parent.items.push(it); }
      });

      universes.sort(posCmp);
      universes.forEach((u) => {
        u.groups.sort(posCmp);
        u.groups.forEach((g) => { g.cards.sort(posCmp); g.cards.forEach((c) => c.items.sort(posCmp)); });
      });

      state.universes = universes;
      state._hlc = doc.hlc || state._hlc || 0;
      observeTs(doc.hlc);
      validateActive(state);
      render();
    } finally {
      applyingRemote = false;
    }
  }

  /* ---------------- Push: rad-CRUD mot tabellene ---------------- */
  const TABLE = { universe: 'universes', group: 'groups', card: 'cards', item: 'items' };
  function insertPayload(t, row, uid) {
    const base = { id: row.id, owner_id: uid, trashed: !!row.trashed,
      ts: row.ts || 0, org: row.org || '', pos: row.pos || 0, pos_ts: row.posTs || 0, pos_org: row.posOrg || '' };
    if (t === 'universe') return Object.assign(base, { name: row.name || '' });
    if (t === 'group') return Object.assign(base, { name: row.name || '', universe_id: row.uni });
    if (t === 'card') return Object.assign(base, { title: row.title || '', group_id: row.group,
      k: row.k !== false, p: row.p !== false, lab_ts: row.labTs || 0, lab_org: row.labOrg || '' });
    return Object.assign(base, { text: row.text || '', card_id: row.home, done: !!row.done });
  }
  function updatePayload(t, row) {
    const base = { trashed: !!row.trashed, ts: row.ts || 0, org: row.org || '',
      pos: row.pos || 0, pos_ts: row.posTs || 0, pos_org: row.posOrg || '' };
    if (t === 'universe') return Object.assign(base, { name: row.name || '' });
    if (t === 'group') return Object.assign(base, { name: row.name || '', universe_id: row.uni });
    if (t === 'card') return Object.assign(base, { title: row.title || '', group_id: row.group,
      k: row.k !== false, p: row.p !== false, lab_ts: row.labTs || 0, lab_org: row.labOrg || '' });
    return Object.assign(base, { text: row.text || '', card_id: row.home, done: !!row.done });
  }
  async function pushOps(ops) {
    const client = acli();
    if (!client || !authUser) return;
    const uid = authUser.id;
    const order = { universe: 0, group: 1, card: 2, item: 3 };
    // Insert/oppdater ovenfra-ned (foreldre først), slett nedenfra-opp.
    const ins = ops.filter((o) => o.op === 'insert').sort((a, b) => order[a.t] - order[b.t]);
    const upd = ops.filter((o) => o.op === 'update').sort((a, b) => order[a.t] - order[b.t]);
    const del = ops.filter((o) => o.op === 'delete').sort((a, b) => order[b.t] - order[a.t]);
    for (const o of ins) {
      try { await client.from(TABLE[o.t]).insert(insertPayload(o.t, o.row, uid)); } catch (e) { /* RLS/konflikt */ }
    }
    for (const o of upd) {
      try { await client.from(TABLE[o.t]).update(updatePayload(o.t, o.row)).eq('id', o.row.id); } catch (e) { /* ignore */ }
    }
    for (const o of del) {
      try { await client.from(TABLE[o.t]).delete().eq('id', o.id); } catch (e) { /* ignore */ }
    }
  }

  /* ---------------- Mount-skrivinger (membership) ---------------- */
  async function cloudMountUpdate(type, id, patch) {
    const client = acli();
    if (!client || !authUser) return;
    const col = type === 'universe' ? 'universe_id' : type === 'group' ? 'group_id' : 'card_id';
    try {
      await client.from('memberships').update(patch).eq('user_id', authUser.id).eq(col, id);
    } catch (e) { /* ignore */ }
  }
  async function cloudLeave(type, id) {
    const client = acli();
    if (!client || !authUser) return;
    try { await client.rpc('leave_share', { p_type: type, p_id: id }); } catch (e) { /* ignore */ }
  }

  /* ---------------- Synk-syklus v2 ---------------- */
  let cloudBase = null;
  let cloudRunning = false, cloudAgain = false;
  let cloudDebounce = null, cloudPoll = null, cloudChan = null, cloudRt = false;
  let lastMy = null;

  function scheduleCloud(delay) {
    clearTimeout(cloudDebounce);
    cloudDebounce = setTimeout(cloudCycle, delay == null ? 300 : delay);
  }
  async function rpcMyDoc() {
    const client = acli();
    if (!client || !authUser) return null;
    const { data, error } = await client.rpc('get_my_doc');
    if (error) throw error;
    return data || null;
  }
  async function cloudCycle() {
    if (!authUser || !acli()) return;
    if (cloudRunning) { cloudAgain = true; return; }
    cloudRunning = true;
    try {
      const my = await rpcMyDoc();
      if (!my) return;
      lastMy = my;
      const remote = contentDocFromMy(my);
      const meta = metaFromMy(my);
      const local = docFromMyState();
      const { merged, ops } = reconcile(cloudBase || emptyDoc(), local, remote);
      cloudBase = remote;
      if (!isBusyEditing()) applyMyDoc(merged, meta);
      else cloudAgain = true;
      if (ops.length) await pushOps(ops);
      updateInbox(my);
      maybeOfferMigration(my);
    } catch (e) {
      /* offline / feil — poll/realtime prøver igjen */
    } finally {
      cloudRunning = false;
      if (cloudAgain) { cloudAgain = false; scheduleCloud(150); }
    }
  }

  /* ---------------- Realtime (postgres_changes) + poll ---------------- */
  function startCloudRealtime() {
    const client = acli();
    if (!client || !authUser) return;
    if (cloudChan) { try { client.removeChannel(cloudChan); } catch (e) {} cloudChan = null; }
    cloudChan = client.channel('hk-user-' + authUser.id);
    ['universes', 'groups', 'cards', 'items', 'memberships', 'share_invites'].forEach((t) => {
      cloudChan.on('postgres_changes', { event: '*', schema: 'public', table: t }, () => scheduleCloud(150));
    });
    cloudChan.subscribe((status) => {
      if (status === 'SUBSCRIBED') { cloudRt = true; scheduleCloud(0); }
      else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        cloudRt = false;
        setTimeout(() => { if (!cloudRt && authUser) startCloudRealtime(); }, 4000);
      }
    });
  }
  function startCloudPoll() {
    clearInterval(cloudPoll);
    cloudPoll = setInterval(() => {
      if (document.hidden || !authUser) return;
      scheduleCloud(0);
    }, 5000);
  }

  /* ---------------- Migreringsflyt (lokale data → import_doc) ---------------- */
  function flattenState(s) {
    const universes = [], groups = [], cards = [], items = [];
    (s.universes || []).forEach((u) => {
      universes.push(cleanUniverse(u));
      (u.groups || []).forEach((g) => {
        groups.push(cleanGroup(Object.assign({}, g, { uni: g.uni || u.id })));
        (g.cards || []).forEach((c) => {
          cards.push(cleanCard(Object.assign({}, c, { group: c.group || g.id })));
          (c.items || []).forEach((it) => items.push(cleanItem(it, c.id)));
        });
      });
    });
    return { universes, groups, cards, items };
  }
  function legacyFlatDoc() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const s = JSON.parse(raw);
      if (!s || typeof s !== 'object') return null;
      migrateTabsToGroups(s);
      migrateGroupsToUniverses(s);
      if (!Array.isArray(s.universes) || !s.universes.length) return null;
      const doc = flattenState(s);
      return doc.universes.length ? doc : null;
    } catch (e) { return null; }
  }
  let migrationChecked = false;
  async function maybeOfferMigration(my) {
    if (migrationChecked || !authUser) return;
    migrationChecked = true;
    const flag = 'hk-migrated:' + authUser.id;
    if (localStorage.getItem(flag)) return;
    const remoteEmpty = !(my.universes && my.universes.length);
    const legacy = legacyFlatDoc();
    if (!remoteEmpty || !legacy) { localStorage.setItem(flag, '1'); return; }
    const n = legacy.cards.length;
    if (!await askConfirm({
      title: 'Importer lokale lister',
      message: 'Vi fant lokale lister på denne enheten (' + listWord(n) +
        '). Vil du importere dem til kontoen din?',
      okLabel: 'Importer', danger: false,
    })) { localStorage.setItem(flag, '1'); return; }
    try {
      const { error } = await acli().rpc('import_doc', { p_doc: legacy });
      if (error) throw error;
      localStorage.setItem(flag, '1');
      showToast('Lokale lister importert');
      cloudBase = null;
      scheduleCloud(0);
    } catch (e) {
      migrationChecked = false; // la brukeren prøve igjen senere
      showToast('Import feilet – prøv igjen senere');
    }
  }

  /* ---------------- Innboks + konto-visning i menyen ---------------- */
  const menuAccount = document.getElementById('menu-account');
  const accountAvatar = document.getElementById('account-avatar');
  const accountEmail = document.getElementById('account-email');
  const menuInvites = document.getElementById('menu-invites');
  const inviteListEl = document.getElementById('invite-list');
  const menuBadge = document.getElementById('menu-badge');

  function updateInbox(my) {
    const invites = (my && my.invites_in) || [];
    const placements = pendingPlacements || [];
    const total = invites.length + placements.length;
    menuBadge.textContent = String(total);
    menuBadge.hidden = total === 0;
    if (authUser) {
      menuAccount.hidden = false;
      accountEmail.textContent = authUser.email || '';
      accountAvatar.textContent = (authUser.email || '?').slice(0, 1);
    }
    if (!total) { menuInvites.hidden = true; inviteListEl.innerHTML = ''; return; }
    menuInvites.hidden = false;
    inviteListEl.innerHTML = '';
    const typeLabel = { universe: 'Univers', group: 'Gruppe', card: 'Liste' };
    invites.forEach((inv) => {
      const row = document.createElement('div');
      row.className = 'invite-row';
      const info = document.createElement('div');
      info.className = 'invite-info';
      info.innerHTML = '<span class="invite-type-tag">' + (typeLabel[inv.type] || '') + '</span> ' +
        '<span class="invite-name"></span><span class="invite-from"></span>';
      info.querySelector('.invite-name').textContent = inv.name || '(uten navn)';
      info.querySelector('.invite-from').textContent = 'fra ' + (inv.from || '');
      const actions = document.createElement('div');
      actions.className = 'invite-actions';
      const acc = document.createElement('button');
      acc.className = 'btn btn-solid btn-green btn-small'; acc.type = 'button'; acc.textContent = 'Godta';
      acc.addEventListener('click', () => acceptInvite(inv));
      const dec = document.createElement('button');
      dec.className = 'btn btn-small btn-ghost'; dec.type = 'button'; dec.textContent = 'Avslå';
      dec.addEventListener('click', () => declineInvite(inv));
      actions.append(acc, dec);
      row.append(info, actions);
      inviteListEl.appendChild(row);
    });
    placements.forEach((pl) => {
      const row = document.createElement('div');
      row.className = 'invite-row';
      const info = document.createElement('div');
      info.className = 'invite-info';
      info.innerHTML = '<span class="invite-type-tag">' + (typeLabel[pl.type] || '') + '</span> ' +
        '<span class="invite-name"></span><span class="invite-from">uten plassering</span>';
      info.querySelector('.invite-name').textContent = pl.name || '(uten navn)';
      const actions = document.createElement('div');
      actions.className = 'invite-actions';
      const place = document.createElement('button');
      place.className = 'btn btn-solid btn-green btn-small'; place.type = 'button'; place.textContent = 'Plasser';
      place.addEventListener('click', () => placeMount(pl));
      actions.append(place);
      row.append(info, actions);
      inviteListEl.appendChild(row);
    });
  }

  /* ---------------- Plasseringsvalg (aksept / remount) ---------------- */
  const placeModal = document.getElementById('place-modal');
  const placeBody = document.getElementById('place-body');
  const placeClose = document.getElementById('place-close');
  function closePlace() { placeModal.hidden = true; updateModalOpenClass2(); }
  placeClose && placeClose.addEventListener('click', closePlace);
  placeModal && placeModal.addEventListener('click', (ev) => { if (ev.target === placeModal) closePlace(); });
  function updateModalOpenClass2() { updateModalOpenClass(); }
  // Velg forelder for et delt objekt: univers-deling → ingen; gruppe → et av
  // mine universer; liste → en av mine grupper (på tvers av universer).
  function askPlacement(type, name, onPick) {
    if (type === 'universe') { onPick(null); return; }
    placeBody.innerHTML = '';
    const hint = document.createElement('p');
    hint.className = 'place-hint';
    const options = [];
    if (type === 'group') {
      hint.textContent = 'Velg hvilket univers «' + name + '» skal ligge i:';
      visibleUniverses().filter((u) => isMine(u) || !u._mount).forEach((u) =>
        options.push({ id: u.id, label: u.name }));
    } else {
      hint.textContent = 'Velg hvilken gruppe «' + name + '» skal ligge i:';
      state.universes.filter((u) => !u.trashed).forEach((u) => {
        (u.groups || []).filter((g) => !effTrashed(g)).forEach((g) =>
          options.push({ id: g.id, label: u.name + ' › ' + g.name }));
      });
    }
    placeBody.appendChild(hint);
    if (!options.length) {
      const p = document.createElement('p');
      p.className = 'place-hint';
      p.textContent = type === 'group'
        ? 'Du har ingen universer ennå – opprett ett først.'
        : 'Du har ingen grupper ennå – opprett en først.';
      placeBody.appendChild(p);
    }
    options.forEach((o) => {
      const b = document.createElement('button');
      b.className = 'place-option'; b.type = 'button'; b.textContent = o.label;
      b.addEventListener('click', () => { closePlace(); onPick(o.id); });
      placeBody.appendChild(b);
    });
    placeModal.hidden = false;
    updateModalOpenClass2();
  }

  async function acceptInvite(inv) {
    askPlacement(inv.type, inv.name, async (parent) => {
      try {
        const pos = Date.now();
        const { error } = await acli().rpc('accept_share_invite',
          { p_invite: inv.id, p_parent: parent, p_pos: pos });
        if (error) throw error;
        showToast('Deling godtatt');
        cloudBase = null;
        scheduleCloud(0);
      } catch (e) { showToast(friendlyAuthError(e)); }
    });
  }
  async function declineInvite(inv) {
    try {
      const { error } = await acli().rpc('decline_share_invite', { p_invite: inv.id });
      if (error) throw error;
      scheduleCloud(0);
    } catch (e) { showToast(friendlyAuthError(e)); }
  }
  function placeMount(pl) {
    askPlacement(pl.type, pl.name, async (parent) => {
      const patch = pl.type === 'group'
        ? { parent_universe_id: parent } : { parent_group_id: parent };
      await cloudMountUpdate(pl.type, pl.id, patch);
      cloudBase = null;
      scheduleCloud(0);
    });
  }

  /* ---------------- Del-modal (eier: inviter/medlemmer/lås; mottaker: forlat) ---------------- */
  const shareModal = document.getElementById('share-modal');
  const shareBody = document.getElementById('share-body');
  const shareTitle = document.getElementById('share-title');
  const shareClose = document.getElementById('share-close');
  let shareCtx = null; // { type, id, obj }
  function closeShare() { shareModal.hidden = true; shareCtx = null; updateModalOpenClass2(); }
  shareClose && shareClose.addEventListener('click', closeShare);
  shareModal && shareModal.addEventListener('click', (ev) => { if (ev.target === shareModal) closeShare(); });

  // Overskrift: «[objekttype-ikon] [navn] — Innstillinger for deling» — gir
  // mening både for eier og mottaker (mottaker kan ikke dele videre, men har
  // fortsatt innstillinger her). Navnet settes som tekstnode (aldri innerHTML).
  const SHARE_TYPE_ICON = { universe: 'globe', group: 'folder', card: 'list' };
  async function openShare(type, id, obj) {
    shareCtx = { type, id, obj };
    shareTitle.innerHTML = ICONS[SHARE_TYPE_ICON[type]] || '';
    shareTitle.appendChild(document.createTextNode(
      (obj.name || obj.title || '') + ' — Innstillinger for deling'));
    shareBody.innerHTML = '<p class="place-hint">Laster …</p>';
    shareModal.hidden = false;
    updateModalOpenClass2();
    let info = { owner: null, members: [], pending_invites: [] };
    try {
      const { data, error } = await acli().rpc('get_members', { p_type: type, p_id: id });
      if (error) throw error;
      info = data || info;
    } catch (e) { /* vis skjema likevel */ }
    if (obj._mine === false) {
      if (info.owner) obj._ownerEmail = info.owner.email;
      renderShareRecipient(obj);
      return;
    }
    renderShareOwner(type, id, obj, info);
  }

  function avatarFor(email, owner) {
    const s = document.createElement('span');
    s.className = 'member-avatar' + (owner ? ' owner' : '');
    s.textContent = (email || '?').slice(0, 1);
    return s;
  }
  function renderShareOwner(type, id, obj, info) {
    shareBody.innerHTML = '';
    // Inviter på e-post
    const form = document.createElement('form');
    form.className = 'share-invite-form';
    const input = document.createElement('input');
    input.className = 'field';
    input.type = 'email'; input.placeholder = 'E-post å invitere'; input.required = true;
    const btn = document.createElement('button');
    btn.className = 'btn btn-solid btn-green btn-small'; btn.type = 'submit'; btn.textContent = 'Inviter';
    form.append(input, btn);
    const msg = document.createElement('p');
    msg.className = 'share-msg';
    // Lås/åpne
    const lockRow = document.createElement('div');
    lockRow.className = 'share-lock-row';
    const lockBtn = document.createElement('button');
    lockBtn.className = 'btn btn-solid btn-yellow btn-small'; lockBtn.type = 'button';
    lockRow.innerHTML = '<div><span class="share-lock-label">Skrivebeskyttet</span>' +
      '<span class="share-lock-hint">Andre kan se, men ikke endre</span></div>';
    const paintLock = () => {
      lockBtn.innerHTML = (obj._locked ? ICONS.lock : ICONS.unlock) +
        '<span>' + (obj._locked ? 'Lås opp' : 'Lås') + '</span>';
    };
    paintLock();
    lockRow.appendChild(lockBtn);
    // Medlemsliste (egen beholder → oppdateres uten å nullstille skjema/melding)
    const title = document.createElement('div');
    title.className = 'share-section-title'; title.textContent = 'Medlemmer';
    const membersWrap = document.createElement('div');

    function renderMembers(inf) {
      membersWrap.innerHTML = '';
      if (inf.owner) {
        const row = document.createElement('div');
        row.className = 'member-row';
        const box = document.createElement('div'); box.className = 'member-info';
        box.innerHTML = '<span class="member-name"></span><span class="member-role">Eier (deg)</span>';
        box.querySelector('.member-name').textContent = inf.owner.email;
        row.append(avatarFor(inf.owner.email, true), box);
        membersWrap.appendChild(row);
      }
      (inf.members || []).forEach((mbr) => {
        const row = document.createElement('div');
        row.className = 'member-row';
        const box = document.createElement('div'); box.className = 'member-info';
        box.innerHTML = '<span class="member-name"></span><span class="member-role">Medlem</span>';
        box.querySelector('.member-name').textContent = mbr.email;
        const kick = document.createElement('button');
        kick.className = 'btn btn-solid btn-red btn-small'; kick.type = 'button'; kick.textContent = 'Kast ut';
        kick.addEventListener('click', async () => {
          if (!await askConfirm({ title: 'Kaste ut', message: 'Fjerne ' + mbr.email + ' fra delingen?', okLabel: 'Kast ut' })) return;
          try {
            const { error } = await acli().rpc('revoke_share', { p_type: type, p_id: id, p_user: mbr.id });
            if (error) throw error;
            refreshMembers(); scheduleCloud(0);
          } catch (e) { showToast(friendlyAuthError(e)); }
        });
        row.append(avatarFor(mbr.email, false), box, kick);
        membersWrap.appendChild(row);
      });
      (inf.pending_invites || []).forEach((inv) => {
        const row = document.createElement('div');
        row.className = 'member-row member-pending';
        const box = document.createElement('div'); box.className = 'member-info';
        box.innerHTML = '<span class="member-name"></span><span class="member-role">Venter på svar</span>';
        box.querySelector('.member-name').textContent = inv.email;
        const cancel = document.createElement('button');
        cancel.className = 'btn btn-small btn-ghost'; cancel.type = 'button'; cancel.textContent = 'Trekk tilbake';
        cancel.addEventListener('click', async () => {
          try {
            const { error } = await acli().rpc('revoke_share_invite', { p_invite: inv.id });
            if (error) throw error;
            refreshMembers();
          } catch (e) { showToast(friendlyAuthError(e)); }
        });
        row.append(avatarFor(inv.email, false), box, cancel);
        membersWrap.appendChild(row);
      });
    }
    async function refreshMembers() {
      try {
        const { data } = await acli().rpc('get_members', { p_type: type, p_id: id });
        if (data) renderMembers(data);
      } catch (e) { /* behold forrige */ }
    }

    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const email = input.value.trim().toLowerCase();
      if (!email) return;
      btn.disabled = true; msg.textContent = ''; msg.classList.remove('ok');
      try {
        const { error } = await acli().rpc('create_share_invite',
          { p_type: type, p_id: id, p_email: email });
        if (error) throw error;
        msg.textContent = 'Invitasjon sendt til ' + email; msg.classList.add('ok');
        input.value = '';
        refreshMembers();
      } catch (e) { msg.textContent = friendlyAuthError(e); }
      finally { btn.disabled = false; }
    });
    lockBtn.addEventListener('click', async () => {
      lockBtn.disabled = true;
      try {
        const { error } = await acli().rpc('set_locked',
          { p_type: type, p_id: id, p_locked: !obj._locked });
        if (error) throw error;
        obj._locked = !obj._locked;
        paintLock();
        scheduleCloud(0);
      } catch (e) { showToast(friendlyAuthError(e)); }
      finally { lockBtn.disabled = false; }
    });

    shareBody.append(form, msg, lockRow, title, membersWrap);
    renderMembers(info);
  }
  function renderShareRecipient(obj) {
    shareBody.innerHTML = '';
    const line = document.createElement('div');
    line.className = 'owner-line';
    const ownerEmail = obj._ownerEmail || '';
    line.append(avatarFor(ownerEmail || '?', true));
    const inf = document.createElement('div'); inf.className = 'member-info';
    inf.innerHTML = '<span class="member-name">Delt med deg</span>' +
      '<span class="member-role">' + (obj._locked ? 'Skrivebeskyttet' : 'Du kan redigere') + '</span>';
    line.appendChild(inf);
    shareBody.appendChild(line);
    const leave = document.createElement('button');
    leave.className = 'btn btn-solid btn-red share-leave'; leave.type = 'button'; leave.textContent = 'Forlat deling';
    leave.addEventListener('click', async () => {
      if (!await askConfirm({ title: 'Forlat deling', message: 'Forlate denne delingen? Den forsvinner fra dine lister.', okLabel: 'Forlat' })) return;
      await cloudLeave(shareCtx.type, shareCtx.id);
      closeShare();
      cloudBase = null;
      scheduleCloud(0);
    });
    shareBody.appendChild(leave);
  }

  /* ---------------- Start/stopp av kontomodus ---------------- */
  function cacheKey() { return authUser ? STORAGE_KEY + ':' + authUser.id : STORAGE_KEY; }
  function loadCache() {
    try {
      const raw = localStorage.getItem(cacheKey());
      if (!raw) return false;
      const s = JSON.parse(raw);
      if (!s || !Array.isArray(s.universes)) return false;
      normalize(s);
      state.universes = s.universes;
      state._tomb = s._tomb || state._tomb;
      state._hlc = s._hlc || 0;
      validateActive(state);
      return true;
    } catch (e) { return false; }
  }

  let cloudStarted = false;
  async function cloudStart() {
    document.body.classList.remove('no-auth', 'locked');
    authScreen.hidden = true;
    lockScreen.hidden = true;
    if (!cloudStarted) {
      cloudStarted = true;
      if (!loadCache()) {           // ingen buffer for denne brukeren → start tomt (ikke vis annen brukers data)
        state.universes = [];
        state._tomb = { universes: {}, groups: {}, cards: {}, items: {} };
        validateActive(state);
      }
      render();
    }
    cloudBase = null;
    migrationChecked = false;
    startCloudRealtime();
    startCloudPoll();
    await cloudCycle();
  }
  function cloudStop() {
    clearInterval(cloudPoll);
    clearTimeout(cloudDebounce);
    if (cloudChan && aclient) { try { aclient.removeChannel(cloudChan); } catch (e) {} }
    cloudChan = null; cloudRt = false; cloudBase = null; lastMy = null;
    cloudStarted = false;
    authUser = null;
    state.universes = [];
    document.body.classList.add('no-auth');
    authScreen.hidden = false;
    setAuthMode('login');
    menuAccount.hidden = true;
    menuInvites.hidden = true;
    menuBadge.hidden = true;
  }

  async function initAccounts() {
    const client = acli();
    if (!client) {
      // Ingen backend → fall tilbake til mønster-lås.
      initPatternLock();
      return;
    }
    document.body.classList.add('no-auth');
    document.body.classList.remove('locked');
    authScreen.hidden = false;
    setAuthMode('login');
    client.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') { handleRecovery(); return; }
      const user = session && session.user;
      if (user) {
        if (authUser && authUser.id === user.id) return; // allerede i gang
        authUser = { id: user.id, email: user.email };
        cloudStart();
      } else if (event === 'SIGNED_OUT') {
        cloudStop();
      }
    });
    // Gjenopprett evt. eksisterende sesjon (onAuthStateChange kan allerede ha
    // gjort det via INITIAL_SESSION — ikke start på nytt da).
    try {
      const { data } = await client.auth.getSession();
      const user = data && data.session && data.session.user;
      if (user && !authUser) { authUser = { id: user.id, email: user.email }; cloudStart(); }
    } catch (e) { /* ingen sesjon */ }
  }

  /* ---------------- Innlogging: velg modus ---------------- */
  function initPatternLock() {
    buildLockNodes();
    lockSvg.addEventListener('pointerdown', onLockDown);
    lockSvg.addEventListener('pointermove', onLockMove);
    lockSvg.addEventListener('pointerup', onLockUp);
    lockSvg.addEventListener('pointercancel', onLockUp);

    if (localStorage.getItem(AUTH_KEY) === '1') {
      unlockApp();
    } else {
      document.body.classList.add('locked');
      lockScreen.hidden = false;
      if (isLockedOut()) startLockCountdown();
      else lockMsg.textContent = 'Tegn mønsteret for å låse opp.';
    }
  }

  function initAuth() {
    if (accountsMode()) initAccounts();
    else initPatternLock();
  }

  /* ---------------- Start ---------------- */
  initAuth();

  // Eksponer for enkel feilsøking/testing
  window.__huskekurv = {
    state, render, logout, addGroup, deleteGroup,
    addUniverse, deleteUniverse, setActiveUniverse, setActiveGroup, openMenu, closeMenu,
    // Synk-interne (for testing av fletting/synk):
    mergeStates, canonical, docFromState, applyDoc, syncCycle, normalizeRemoteDoc, migrateBareState,
    get syncCode() { return syncCode; },
    get serverVersion() { return serverVersion; },
    get rtConnected() { return rtConnected; },
    // Kontomodus (fase 2):
    accountsMode, reconcile, docFromMyState, contentDocFromMy, applyMyDoc, cloudCycle,
    openShare,
    get authUser() { return authUser; },
    get lastMy() { return lastMy; },
    get pendingPlacements() { return pendingPlacements; },
  };
})();
