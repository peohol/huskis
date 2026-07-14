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

  /* ---------------- Brukernavn og initialer ----------------
     display_name = «Fornavn Etternavn» (lagt inn ved registrering). Initialer =
     første bokstav i fornavn + første bokstav i etternavn (vises i sirkler i
     del-modalen og på ansvarsknappen). Uten navn faller vi tilbake på e-posten. */
  function initialsFromName(name, email) {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return String(email || '?').slice(0, 1).toUpperCase();
  }
  // Visningsnavn for en person (profil fra get_members/get_my_doc): navnet hvis
  // satt, ellers e-posten (uregistrerte/ventende invitasjoner har bare e-post).
  function personName(p) {
    return (p && p.display_name && p.display_name.trim()) || (p && p.email) || '';
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
      id: uid(), text, home: homeId, cat: null, trashed: false, done: false,
      ts: 0, org: deviceId,           // innholdsregister (tekst/trashed/done)
      pos: 0, posTs: 0, posOrg: deviceId, // posisjonsregister (rekkefølge/forelder + cat)
    };
  }
  // En kategori er en nivå-1-«rad» i en liste som grupperer elementer (nivå 2)
  // under en felles overskrift. Den lagres SOM et element i kortets `items`
  // (rir dermed på hele element-synken), men markert `isCat: true` — den har
  // navn (`text`), egen tidsplan (`start`/`due`) og kan låse tidene til
  // elementene sine (`lockTimes`, som lister). Leaf-elementer peker på kategorien
  // sin via `cat` (null = ukategorisert, nivå 1). Kategorier nøstes aldri
  // (har alltid `cat: null`) og krysses aldri av (`done`).
  function makeCategory(name, homeId) {
    const c = makeItem(name, homeId);
    c.isCat = true;
    c.lockTimes = false;
    return c;
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
  // Univers-/gruppebytter (popover/modal), åpnet fra panel-title-knappene.
  const uniSwitchBtn = document.getElementById('uni-switch-btn');
  const uniSwitcherOverlay = document.getElementById('uni-switcher');
  const uniSwitcherPanel = document.getElementById('uni-switcher-panel');
  const groupSwitchBtn = document.getElementById('group-switch-btn');
  const groupSwitcherOverlay = document.getElementById('group-switcher');
  const groupSwitcherPanel = document.getElementById('group-switcher-panel');
  const respSwitcherOverlay = document.getElementById('resp-switcher');
  const respSwitcherPanel = document.getElementById('resp-switcher-panel');
  const addCardBtn = document.getElementById('add-card-btn');
  const shareUniBtn = document.getElementById('share-uni-btn');
  const shareGroupBtn = document.getElementById('share-group-btn');
  const toolbarEl = document.querySelector('.toolbar');
  const filterSwitchesEl = document.getElementById('filter-switches');
  const groupTpl = document.getElementById('group-template');
  const uniTpl = document.getElementById('uni-template');
  const cardTpl = document.getElementById('card-template');
  const itemTpl = document.getElementById('item-template');
  const catTpl = document.getElementById('category-template');

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
  // `_pendingDelete` (buffret sletting, se DELETE-BUFFER lenger nede): objektet
  // er skjult fra de synlige listene og vist i søppel-visningen,
  // men er ENNÅ ikke `trashed` i state og skrives ikke til databasen — det skjer
  // først når toasten utløper (eller committes ved unload). Derfor teller det som
  // «i søppel» for visning, men ikke som aktivt.
  const activeUniverseObj = () => state.universes.find((u) => u.id === state.activeUniverse && !u.trashed && !u._pendingDelete) || null;
  const visibleUniverses = () => state.universes.filter((u) => !u.trashed && !u._pendingDelete).sort(posCmp); // i meny-modalen
  const trashedUniverses = () => state.universes.filter((u) => u.trashed || u._pendingDelete);               // i univers-søppelkassen
  const findUniverse = (id) => state.universes.find((u) => u.id === id) || null;
  const allGroups = () => { const u = activeUniverseObj(); return u ? u.groups : []; };
  const activeGroupObj = () => allGroups().find((g) => g.id === state.activeGroup && !g.trashed && !g._pendingDelete) || null;
  const visibleGroups = () => allGroups().filter((g) => !g.trashed && !g._pendingDelete).sort(posCmp); // vist i gruppemenyen
  const trashedGroups = () => allGroups().filter((g) => g.trashed || g._pendingDelete);               // i gruppe-søppelkassen
  const findGroup = (id) => allGroups().find((g) => g.id === id) || null;
  const allCards = () => { const g = activeGroupObj(); return g ? g.cards : []; };
  const activeCards = () => allCards().filter((c) => !c.trashed && !c._pendingDelete).sort(posCmp);
  const trashedCards = () => allCards().filter((c) => c.trashed || c._pendingDelete);
  const findCard = (id) => allCards().find((c) => c.id === id);
  const trashedItemsOf = (cardData) => (cardData.items || []).filter((it) => it.trashed || it._pendingDelete);
  function findItemById(id) {
    for (const c of allCards()) {
      const it = c.items.find((x) => x.id === id);
      if (it) return it;
    }
    return null;
  }
  // Kategorier og ukategoriserte elementer deler nivå-1-posisjonsrommet (begge
  // har `cat` falsy); en ny nivå-1-rad legges bakerst der.
  function level1MaxPos(cardData) { return maxPos(cardData.items.filter((it) => !it.cat)); }
  // Kategori-objektet et element ligger i (eller null for ukategorisert / ukjent).
  function catOf(cardData, catId) {
    return catId ? cardData.items.find((x) => x.id === catId && x.isCat) || null : null;
  }

  // Aktiv gruppe settes alltid via denne, så per-univers-minnet (activeGroups)
  // holdes i takt og man lander på samme gruppe når man bytter tilbake.
  function setActiveGroup(id) {
    state.activeGroup = id || null;
    if (state.activeUniverse) state.activeGroups[state.activeUniverse] = state.activeGroup;
    saveNavPref(); // husk posisjonen på kontoen (kontomodus)
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
  // Søppelkasse-badgen (univers/gruppe/liste): antall, og knappen skjules når
  // kassen er tom. Delt av de tre faste knappene (element-nivået er annerledes
  // — se updateItemsTrashBadge, som slår opp badgen i DOM).
  function updateTrashBadge(trashedSel, countEl, btnEl) {
    const list = trashedSel();
    countEl.textContent = list.length;
    btnEl.hidden = list.length === 0;
  }
  // Lister-søppelkassen vises kun når den har innhold (samme logikk som de andre).
  function updateTrashCount() { updateTrashBadge(trashedCards, trashCount, trashBtn); }

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
        '<p>Trykk <span class="hint-chip">＋ ' + ICONS.folder + '</span> for å komme i gang.</p>';
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
        const p2 = document.createElement('p');
        p2.innerHTML = 'Trykk <span class="hint-chip">＋ ' + ICONS.list + '</span> for å komme i gang.';
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
  function updateGroupsTrash() { updateTrashBadge(trashedGroups, groupsTrashCount, groupsTrashBtn); }

  // Chip-farge (gruppe- og univers-rader): posisjonsfarge --g-bg + mørkere
  // --g-accent. Listekort bruker egne --card-*-variabler (se buildCard), så de
  // deler ikke denne.
  function applyChipColor(el, obj) {
    const base = obj.color || colorForId(obj.id);
    el.style.setProperty('--g-bg', base);
    el.style.setProperty('--g-accent', darken(base, 0.34));
  }
  // Delings-/låse-status (kontomodus): toggler .is-shared og fyller .share-badge
  // (lås hvis frosset av andre, ellers «people»-ikon). Returnerer {shared, canEdit}
  // som byggerne gjenbruker — canEdit gater redigering; buildCard toggler dessuten
  // .is-locked selv (kun listekort har den).
  function applyShareBadge(el, obj) {
    const shared = accountsMode() && (obj._shared || obj._mount);
    const canEdit = !frozen(obj);
    el.classList.toggle('is-shared', !!shared);
    if (shared) {
      const badge = el.querySelector('.share-badge');
      badge.hidden = false;
      badge.innerHTML = !canEdit ? ICONS.lock : ICONS.people;
      badge.title = obj._mount ? 'Delt med deg' : 'Delt med andre';
    }
    return { shared, canEdit };
  }

  function buildGroupCard(groupData) {
    const el = groupTpl.content.firstElementChild.cloneNode(true);
    el.dataset.id = groupData.id;
    const isActive = groupData.id === state.activeGroup;
    el.classList.toggle('active', isActive);
    el.setAttribute('aria-selected', isActive ? 'true' : 'false');

    // Farge etter posisjon (samme system som listekort); aksent = mørkere variant.
    applyChipColor(el, groupData);
    // Delings-/låse-status (kontomodus).
    const gCanEdit = applyShareBadge(el, groupData).canEdit;
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
    bufferDelete(groupData, 'group', (g) => setTrashed(g, 'group', true));
    if (state.activeGroup === groupData.id) {
      const first = visibleGroups()[0]; // ekskluderer nå den buffer-slettede
      setActiveGroup(first ? first.id : null);
    }
    render(); // gruppe-søppelkassen blir synlig FØR animasjonen starter
    flyGhost(ghost, groupsTrashBtn);
    pushDeleteToast('group', groupData.id, groupData.name);
  }

  // Tøm gruppe-søppelkassen (aktivt univers) permanent: gravsteiner for hver
  // slettet gruppe + alle dens lister + elementer (hindrer gjenoppstandelse).
  function emptyGroupsTrash() {
    const u = activeUniverseObj();
    if (!u) return;
    commitBufferedFor(trashedGroups().map((g) => g.id));
    const trash = trashedGroups();
    if (!trash.length) return;
    trash.forEach((g) => {
      const idx = u.groups.indexOf(g);
      if (g._mount) {
        // Mottaker forlater delingen (rører ikke eierens innhold). cloudLeave
        // undertrykker raden fra pull-ene til forlatelsen har landet.
        if (idx > -1) u.groups.splice(idx, 1);
        cloudLeave('group', g.id);
        return;
      }
      tombSubtree(g, 'group');
      if (idx > -1) u.groups.splice(idx, 1);
    });
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
    // Delt-indikatoren ligger i meta-raden under tittelen (fillMetaRow), ikke
    // som badge i headeren; .is-locked (egen kant-styling) settes her.
    const shared = accountsMode() && (cardData._shared || cardData._mount);
    const canEdit = !frozen(cardData);
    el.classList.toggle('is-shared', !!shared);
    el.classList.toggle('is-locked', accountsMode() && !canEdit);

    // Tannhjulet åpner listens innstillingsmodal (navn/deling/ansvarlig/tidsplan).
    el.querySelector('.card-cog').addEventListener('click', () =>
      openSettings('card', cardData.id, cardData.id));

    // Indikator-chips (delt/ansvarlig/start/frist) under tittelen.
    fillMetaRow(el.querySelector('.card-meta'),
      { kind: 'card', obj: cardData, card: cardData }, canEdit);

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
        bufferDelete(cardData, 'card', (c) => setTrashed(c, 'card', true));
        render(); // søppelkasse-knappen blir synlig FØR animasjonen starter
        flyGhost(ghost, trashBtn);
        pushDeleteToast('card', cardData.id, cardData.title);
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

    // Elementer (kun ikke-slettede; sortert på posisjon). To nivåer: nivå 1 er
    // kortets direkte rader — ukategoriserte elementer OG kategorier, om
    // hverandre; nivå 2 er elementene inne i hver kategori (buildCategory).
    // Avkryssede («Utført») samles i egen seksjon nederst uansett kategori.
    // Slettede ligger i element-søppelkassen. Et element hvis `cat` peker på en
    // kategori som ikke finnes (f.eks. oppløst på en annen enhet) faller tilbake
    // til nivå 1 (ukategorisert).
    const list = el.querySelector('.items-container');
    const doneWrap = el.querySelector('.items-done-wrap');
    const doneList = el.querySelector('.items-done');
    const active = cardData.items.filter((it) => !it.trashed && !it._pendingDelete);
    const catIds = new Set(active.filter((it) => it.isCat).map((c) => c.id));
    const level1 = active.filter((it) => !it.done && (it.isCat || !it.cat || !catIds.has(it.cat))).sort(posCmp);
    level1.forEach((row) => list.appendChild(row.isCat ? buildCategory(row, cardData) : buildItem(row, cardData)));
    const doneItems = active.filter((it) => it.done && !it.isCat).sort(posCmp);
    doneItems.forEach((it) => doneList.appendChild(buildItem(it, cardData)));
    doneWrap.hidden = doneItems.length === 0;

    // Legg til element / kategori. ＋-knappen er disablet (dempet) til feltet har
    // tekst. Kort trykk = legg til element; klikk-og-hold (CAT_HOLD_MS) = opprett
    // en kategori med det innskrevne navnet i stedet (se attachAddHold).
    const form = el.querySelector('.add-item-form');
    const input = form.querySelector('.add-item-input');
    const addBtn = form.querySelector('.add-item-btn');
    if (accountsMode() && !canEdit) form.hidden = true;
    const syncAddBtn = () => { addBtn.disabled = !input.value.trim(); };
    syncAddBtn();
    input.addEventListener('input', syncAddBtn);

    const addItemNow = () => {
      if (!canEdit) return;
      const text = input.value.trim();
      if (!text) return;
      const it = makeItem(text, cardData.id);
      it.pos = level1MaxPos(cardData) + 1;
      stampContent(it);
      stampPos(it);
      cardData.items.push(it);
      list.appendChild(buildItem(it, cardData));
      input.value = '';
      syncAddBtn();
      input.focus();
      save();
    };
    const addCategoryNow = () => {
      if (!canEdit) return;
      const name = input.value.trim();
      if (!name) return;
      const cat = makeCategory(name, cardData.id);
      cat.pos = level1MaxPos(cardData) + 1;
      stampContent(cat);
      stampPos(cat);
      cardData.items.push(cat);
      list.appendChild(buildCategory(cat, cardData));
      input.value = '';
      syncAddBtn();
      input.focus();
      save();
    };
    attachAddHold(form, input, addBtn, () => canEdit, addItemNow, addCategoryNow);

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
  // Buffrede slettinger committes først, så tømming aldri venter på angre-vinduet.
  function emptyItemsTrash(cardData) {
    commitBufferedFor(trashedItemsOf(cardData).map((it) => it.id));
    const trash = trashedItemsOf(cardData);
    if (!trash.length) return;
    trash.forEach((it) => {
      tombSubtree(it, 'item'); // gravstein hindrer gjenoppstandelse
      const idx = cardData.items.indexOf(it);
      if (idx > -1) cardData.items.splice(idx, 1);
    });
    refreshCard(cardData);
    save();
  }

  /* ---------------- Ansvarlig for elementer i delte lister ----------------
     Elementer i en delt liste (eller en liste under en delt gruppe/univers) får
     en ansvarsknapp: hånd-opp-ikonet → popover/modal med alle i «delegruppen»
     (eier + medlemmer av nærmeste delte forelder). Velger man en ansvarlig,
     erstattes ikonet med en farget sirkel med initialene deres. Fargen følger
     personens alfabetiske plass i delegruppen (samme palett-syklus som resten av
     appen). Ansvaret (`item.responsible`) rir på innholds-registeret og synkes
     som tekst/avkryssing; alle med redigeringstilgang kan endre det. */

  // Nivåtype ut fra formen på state-objektet (kort har items, gruppe har cards,
  // univers har groups).
  function nodeType(n) {
    if (!n) return null;
    if (n.items) return 'card';
    if (n.cards) return 'group';
    return 'universe';
  }
  // Nærmeste forelder (eller objektet selv) som er en ekte delings-rot: enten
  // delt av meg (`_shared` = har medlemmer) eller montert av meg som mottaker
  // (`_mount`). MERK: et ikke-eid *barn* av en delt gruppe/univers har også
  // `_mine === false`, men er IKKE selv delings-roten (ingen egen medlemsliste)
  // — derfor stopper vi kun på `_shared`/`_mount`, ikke på `_mine === false`,
  // ellers ville ansvars-velgeren hentet get_members for feil (medlemsløst)
  // objekt for arvede delinger. Null utenfor kontomodus / for private objekter.
  function shareRootFor(node) {
    if (!accountsMode()) return null;
    let n = node;
    while (n) {
      if (n._shared || n._mount) return n;
      n = n._parent;
    }
    return null;
  }

  // Cache av delegrupper per delte forelder: rootKey → sortert personliste
  // (eier + medlemmer, alfabetisk på navn) + id→indeks-oppslag. Fylles lat via
  // get_members; personens indeks gir paletten (colorForIndex).
  const shareGroupCache = new Map();
  const shareGroupLoading = new Set();
  function rootKey(type, id) { return type + ':' + id; }
  function personEntry(p) {
    return { id: p.id, email: p.email, name: personName(p), initials: initialsFromName(p.display_name, p.email) };
  }
  function buildShareGroup(info) {
    const people = [];
    if (info.owner) people.push(personEntry(info.owner));
    (info.members || []).forEach((m) => people.push(personEntry(m)));
    people.sort((a, b) => a.name.localeCompare(b.name, 'nb'));
    const byId = new Map();
    people.forEach((p, i) => byId.set(p.id, { person: p, index: i }));
    return { people, byId };
  }
  async function fetchShareGroup(type, id) {
    const { data, error } = await acli().rpc('get_members', { p_type: type, p_id: id });
    if (error) throw error;
    return buildShareGroup(data || {});
  }
  // Sørg for at delegruppen for et delt objekt er i cachen; hent lat og tegn på
  // nytt når den lander (så ansvarssirkelen kan vise riktig farge/initialer).
  function ensureShareGroup(type, id) {
    const key = rootKey(type, id);
    if (shareGroupCache.has(key) || shareGroupLoading.has(key)) return;
    shareGroupLoading.add(key);
    fetchShareGroup(type, id).then((g) => {
      shareGroupCache.set(key, g);
      shareGroupLoading.delete(key);
      render();
    }).catch(() => { shareGroupLoading.delete(key); });
  }

  // En farget sirkel med initialer (ansvarssirkelen). Fargen fra paletten via
  // personens indeks i delegruppen; ukjent person → stabil id-farge.
  function respAvatar(person, index) {
    const s = document.createElement('span');
    s.className = 'resp-avatar';
    s.textContent = person ? person.initials : '?';
    const color = index != null && index >= 0 ? colorForIndex(index)
      : (person ? colorForId(person.id) : '#8496a6');
    s.style.background = color;
    return s;
  }
  /* ---------------- Tidsplan (start/frist) ----------------
     Tidsverdi: null | 'YYYY-MM-DD' | 'YYYY-MM-DDTHH:MM' — klokkeslettet er
     valgfritt (dato + tid er to felt i UI-et). Rir på innholds-registeret
     (ts/org) som tekst/done/responsible. Starttid = når noe BØR påbegynnes,
     frist = når det bør være utført; ingen av dem håndheves. Lister har i
     tillegg `lockTimes`: listens tider gjelder da elementene, som ikke kan ha
     egne. Alle statuser regnes på DATO-nivå (lokal tid):
       start:  nøytral frem til startdatoen, grønn f.o.m. den.
       frist:  nøytral → gul dagen før fristen → rød f.o.m. fristdatoen. */
  function timeDatePart(v) { return v ? String(v).slice(0, 10) : null; }
  function timeClockPart(v) { v = String(v || ''); return v.length > 10 ? v.slice(11, 16) : null; }
  function localDateStr(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') +
      '-' + String(d.getDate()).padStart(2, '0');
  }
  function todayStr() { return localDateStr(new Date()); }
  function addDaysStr(dateStr, days) {
    const p = dateStr.split('-').map(Number);
    return localDateStr(new Date(p[0], p[1] - 1, p[2] + days));
  }
  const MONTHS_NO = ['jan', 'feb', 'mar', 'apr', 'mai', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'des'];
  function fmtDay(dateStr) {
    const p = dateStr.split('-').map(Number);
    const yr = p[0] !== new Date().getFullYear() ? ' ' + p[0] : '';
    return p[2] + '. ' + (MONTHS_NO[p[1] - 1] || '') + yr;
  }
  function fmtTimeFull(v) {
    const clock = timeClockPart(v);
    return fmtDay(timeDatePart(v)) + (clock ? ' kl. ' + clock : '');
  }
  function startStatus(v) { // 'future' | 'started'
    const d = timeDatePart(v);
    return d && todayStr() >= d ? 'started' : 'future';
  }
  function dueStatus(v) { // 'later' | 'soon' (dagen før) | 'over' (f.o.m. fristdatoen)
    const d = timeDatePart(v);
    if (!d) return 'later';
    const t = todayStr();
    if (t >= d) return 'over';
    if (t >= addDaysStr(d, -1)) return 'soon';
    return 'later';
  }
  // Sammenlign to tidsverdier: på dato-nivå når minst én mangler klokkeslett
  // (samme dag regnes da som «innenfor»), ellers på fullt tidspunkt.
  function cmpTime(a, b) {
    const A = timeClockPart(a) && timeClockPart(b) ? a : timeDatePart(a);
    const B = timeClockPart(a) && timeClockPart(b) ? b : timeDatePart(b);
    return A < B ? -1 : A > B ? 1 : 0;
  }
  // Er elementets start/frist utenfor tidsrommet til containeren (liste eller
  // kategori)? (Subtil beskjed i tidsmodulen — fullt lovlig, bare et hint.)
  function outsideFlags(item, container) {
    const chk = (v) => !!v && ((container.start && cmpTime(v, container.start) < 0) ||
                               (container.due && cmpTime(v, container.due) > 0));
    return { start: chk(item.start), due: chk(item.due) };
  }
  // Hva styrer et elements tider når `lockTimes` er på? Listen (kort) har
  // forrang; ellers en kategori elementet ligger i som selv låser tidene. Null
  // → elementet har sine egne tider. Returnerer kort-/kategori-objektet.
  function timeController(item, card) {
    if (!item || item.isCat) return null;
    if (card && card.lockTimes) return card;
    const cat = item.cat ? catOf(card, item.cat) : null;
    if (cat && cat.lockTimes) return cat;
    return null;
  }

  /* ---------------- Indikator-chips (meta-raden under navnet) ----------------
     Under liste-/elementnavnet vises en rad med chips for innstillingene som
     faktisk er satt: delt (kun lister), ansvarlig, start og frist. Chipene er
     knapper: delt → innstillingsmodalen, ansvarlig → ansvarlig-velgeren,
     start/frist → tids-popoveren. Datoen vises med kalenderikon — bortsett fra
     når datoen er i dag OG et klokkeslett er definert: da vises klokkeslettet
     med klokkeikon i stedet. */
  function metaChipEl(cls) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'meta-chip ' + cls;
    return b;
  }
  function appendTimeChip(row, target, field, canEdit) {
    const v = target.obj[field];
    if (!v) return;
    const isDue = field === 'due';
    const chip = metaChipEl(isDue ? 'meta-due' : 'meta-start');
    if (isDue) {
      const st = dueStatus(v);
      if (st === 'soon') chip.classList.add('is-soon');
      else if (st === 'over') chip.classList.add('is-over');
    } else if (startStatus(v) === 'started') {
      chip.classList.add('is-started');
    }
    const clock = timeClockPart(v);
    const showClock = clock && timeDatePart(v) === todayStr();
    chip.innerHTML = (showClock ? ICONS.clock : (isDue ? ICONS.calendarDue : ICONS.calendar)) +
      '<span>' + (showClock ? clock : fmtDay(timeDatePart(v))) + '</span>';
    chip.title = (isDue ? 'Frist: ' : 'Start: ') + fmtTimeFull(v);
    chip.setAttribute('aria-label', chip.title + (canEdit ? '. Trykk for å endre' : ''));
    if (canEdit) chip.addEventListener('click', (ev) => { ev.stopPropagation(); openTimeQuick(target, field, chip); });
    else chip.disabled = true;
    row.appendChild(chip);
  }
  // Fyll meta-raden for en liste eller et element. target = { kind, obj, card }
  // (for lister er obj === card). Raden skjules når ingen chips er satt.
  function fillMetaRow(row, target, canEdit) {
    row.innerHTML = '';
    const obj = target.obj;
    const isCard = target.kind === 'card';
    if (isCard && accountsMode() && (obj._shared || obj._mount)) {
      const chip = metaChipEl('meta-shared');
      chip.innerHTML = !canEdit ? ICONS.lock : ICONS.people;
      chip.title = obj._mount ? 'Delt med deg' : 'Delt med andre';
      chip.setAttribute('aria-label', chip.title + '. Trykk for delingsinnstillinger');
      chip.addEventListener('click', (ev) => { ev.stopPropagation(); openSettings(target.kind, obj.id, target.card.id); });
      row.appendChild(chip);
    }
    if (obj.responsible) {
      const shareRoot = shareRootFor(target.card);
      const rType = shareRoot ? nodeType(shareRoot) : null;
      const group = shareRoot ? shareGroupCache.get(rootKey(rType, shareRoot.id)) : null;
      if (shareRoot && !group) ensureShareGroup(rType, shareRoot.id);
      const entry = group ? group.byId.get(obj.responsible) : null;
      const chip = metaChipEl('meta-resp');
      chip.appendChild(respAvatar(entry ? entry.person : null, entry ? entry.index : -1));
      chip.title = entry ? 'Ansvarlig: ' + entry.person.name : 'Ansvarlig valgt';
      chip.setAttribute('aria-label', chip.title + '. Trykk for å endre');
      if (shareRoot && canEdit) {
        chip.addEventListener('click', (ev) => { ev.stopPropagation(); openResponsible(target, shareRoot, rType, chip); });
      } else {
        chip.disabled = true;
      }
      row.appendChild(chip);
    }
    // Lister og kategorier viser alltid sine egne tider. Elementer viser sine
    // egne kun når ingen container (liste ELLER kategori) styrer tidene deres.
    if (isCard || target.kind === 'category' || !timeController(obj, target.card)) {
      appendTimeChip(row, target, 'start', canEdit);
      appendTimeChip(row, target, 'due', canEdit);
    }
    row.hidden = !row.children.length;
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
      checkBtn.addEventListener('click', () => toggleItemDone(el, itemData, cardData));
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
        const it = owner.items.find((i) => i.id === itemData.id);
        if (!it) return;
        const ghost = ghostFrom(el); // klone FØR refreshCard fjerner raden
        bufferDelete(it, 'item', (x) => setTrashed(x, 'item', true));
        refreshCard(owner); // element-søppelkassen dukker opp FØR animasjonen
        flyGhost(ghost, board.querySelector(
          '.card[data-id="' + owner.id + '"] .item-trash-btn'));
        pushDeleteToast('item', it.id, it.text);
      });
      // Avkryssede elementer dras/reorderes ikke (de ligger i «Utført»).
      itemHandle.addEventListener('pointerdown', (ev) => { if (itemData.done) return; startItemDrag(ev, el); });
      // Tastatur-reordering: piltaster opp/ned flytter det fokuserte elementet.
      itemHandle.addEventListener('keydown', (ev) => {
        if (itemData.done) return;
        const dir = arrowDir(ev, false);
        if (!dir) return;
        ev.preventDefault();
        const owner = ownerCardOf(el) || cardData;
        // Flytt blant SØSKEN i samme nivå: inne i en kategori kun kategoriens
        // egne elementer; ellers nivå-1-rader (ukategoriserte + kategorier).
        const cids = new Set(owner.items.filter((x) => x.isCat).map((x) => x.id));
        const inCat = itemData.cat && cids.has(itemData.cat);
        const sorted = owner.items.filter((it) => !it.trashed && !it.done && !it._pendingDelete &&
          (inCat ? (it.cat === itemData.cat && !it.isCat) : (it.isCat || !it.cat || !cids.has(it.cat)))).sort(posCmp);
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

    // Tannhjulet åpner elementets innstillingsmodal (navn/ansvarlig/tidsplan).
    const cogBtn = el.querySelector('.item-cog');
    if (!canEdit) cogBtn.disabled = true;
    else cogBtn.addEventListener('click', () => openSettings('item', itemData.id, cardData.id));

    // Indikator-chips (ansvarlig/start/frist) under teksten.
    fillMetaRow(el.querySelector('.item-meta'),
      { kind: 'item', obj: itemData, card: cardData }, canEdit);
    return el;
  }

  // Finn hvilket kort (i state) et element-DOM ligger i akkurat nå
  function ownerCardOf(itemEl) {
    const cardEl = itemEl.closest('.card');
    if (!cardEl) return null;
    return findCard(cardEl.dataset.id);
  }

  /* ---------------- Kategorier (nivå-1-rad som grupperer elementer) ----------------
     En kategori bygges som en <li class="category"> med et header (håndtak +
     tittel/meta + tannhjul + oppløs-knapp) og en nøstet <ul class="cat-items">
     med kategoriens elementer (nivå 2, indent-linje til venstre). Kategorien er
     et element i kortets `items` (isCat), så den rir på element-synken. */
  function buildCategory(catData, cardData) {
    const el = catTpl.content.firstElementChild.cloneNode(true);
    el.dataset.id = catData.id;
    const canEdit = !(accountsMode() && frozen(cardData));

    const titleEl = el.querySelector('.cat-title');
    titleEl.textContent = catData.text || 'Kategori';
    titleEl.addEventListener('click', () => {
      if (!canEdit) return;
      editText(titleEl, catData.text, (val) => {
        catData.text = val || 'Kategori';
        titleEl.textContent = catData.text;
        stampContent(catData);
        save();
      });
    });

    // Innstillinger for kategorien (navn/ansvarlig/tidsplan m/ tidslås).
    const cog = el.querySelector('.cat-cog');
    cog.innerHTML = ICONS.gear;
    if (!canEdit) cog.disabled = true;
    else cog.addEventListener('click', () => openSettings('category', catData.id, cardData.id));

    // Oppløs kategorien: elementene blir stående som ukategoriserte på samme plass.
    const dissolve = el.querySelector('.cat-dissolve');
    dissolve.innerHTML = ICONS.bubbleBurst;
    if (!canEdit) dissolve.disabled = true;
    else dissolve.addEventListener('click', () => dissolveCategory(catData, cardData));

    const handle = el.querySelector('.cat-handle');
    if (!canEdit) {
      handle.style.visibility = 'hidden';
    } else {
      handle.addEventListener('pointerdown', (ev) => startCategoryDrag(ev, el));
      // Tastatur-reordering: piltaster flytter kategorien blant nivå-1-radene.
      handle.addEventListener('keydown', (ev) => {
        const dir = arrowDir(ev, false);
        if (!dir) return;
        ev.preventDefault();
        const sorted = cardData.items.filter((it) => !it.trashed && !it._pendingDelete && !it.done && !it.cat).sort(posCmp);
        const i = sorted.findIndex((o) => o.id === catData.id);
        if (i < 0 || i + dir < 0 || i + dir >= sorted.length) return;
        catData.pos = neighborPos(sorted, i, dir);
        stampPos(catData);
        refreshCard(cardData);
        save();
        const h = board.querySelector('.card[data-id="' + cardData.id +
          '"] .category[data-id="' + catData.id + '"] .cat-handle');
        if (h) h.focus();
      });
    }

    fillMetaRow(el.querySelector('.cat-meta'),
      { kind: 'category', obj: catData, card: cardData }, canEdit);

    const inner = el.querySelector('.cat-items');
    const members = cardData.items.filter((it) => !it.trashed && !it._pendingDelete &&
      !it.done && !it.isCat && it.cat === catData.id).sort(posCmp);
    members.forEach((it) => inner.appendChild(buildItem(it, cardData)));
    return el;
  }

  // Oppløs en kategori: elementene beholder rekkefølge og «arver» kategoriens
  // plass i nivå-1-lista (fordeles jevnt i pos-gapet mellom kategorien og neste
  // nivå-1-rad), blir ukategoriserte, og selve kategorien tombstones + fjernes.
  function dissolveCategory(catData, cardData) {
    const cat = cardData.items.find((x) => x.id === catData.id && x.isCat);
    if (!cat) return;
    const level1 = cardData.items.filter((it) => !it.trashed && !it._pendingDelete && !it.done && !it.cat).sort(posCmp);
    const idx = level1.findIndex((o) => o.id === cat.id);
    const startP = cat.pos || 0;
    const nextP = idx > -1 && idx + 1 < level1.length ? level1[idx + 1].pos : null;
    const members = cardData.items.filter((it) => it.cat === cat.id && !it.isCat);
    const active = members.filter((it) => !it.trashed && !it._pendingDelete && !it.done).sort(posCmp);
    const n = active.length;
    active.forEach((it, i) => {
      it.cat = null;
      it.pos = nextP == null ? startP + (i + 1) : startP + (nextP - startP) * ((i + 1) / (n + 1));
      stampPos(it);
    });
    // Avkryssede/slettede medlemmer: bare løsne fra kategorien (beholder pos).
    members.filter((it) => it.trashed || it._pendingDelete || it.done).forEach((it) => {
      it.cat = null;
      stampPos(it);
    });
    tombSubtree(cat, 'item'); // gravstein hindrer at kategorien gjenoppstår ved synk
    const ci = cardData.items.indexOf(cat);
    if (ci > -1) cardData.items.splice(ci, 1);
    refreshCard(cardData);
    save();
  }

  /* ---------------- Legg til: kort trykk = element, klikk-og-hold = kategori ----------------
     ＋-knappen er type=submit. Et kort trykk (eller Enter) legger til et element;
     holdes knappen inne i CAT_HOLD_MS opprettes i stedet en kategori med det
     innskrevne navnet. Under holdingen fylles knappen (`.holding`) som en
     progresjon. Den påfølgende klikk-/submit-hendelsen undertrykkes når holdet
     allerede har utført handlingen. */
  const CAT_HOLD_MS = 400;
  function attachAddHold(form, input, addBtn, canEdit, addItem, addCategory) {
    let holdTimer = null;
    let didHold = false;
    const cancelHold = () => {
      if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
      addBtn.classList.remove('holding');
    };
    addBtn.addEventListener('pointerdown', (ev) => {
      if (ev.button != null && ev.button !== 0) return;
      if (addBtn.disabled || !canEdit() || !input.value.trim()) return;
      didHold = false;
      addBtn.classList.add('holding');
      holdTimer = setTimeout(() => {
        holdTimer = null;
        didHold = true;
        addBtn.classList.remove('holding');
        addCategory();
      }, CAT_HOLD_MS);
    });
    addBtn.addEventListener('pointerup', cancelHold);
    addBtn.addEventListener('pointerleave', cancelHold);
    addBtn.addEventListener('pointercancel', cancelHold);
    // Undertrykk klikket som følger et fullført hold (ellers ville submit lagt
    // til et element i tillegg til kategorien).
    addBtn.addEventListener('click', (ev) => {
      if (didHold) { ev.preventDefault(); didHold = false; }
    });
    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      if (didHold) { didHold = false; return; }
      addItem();
    });
  }

  /* ---------------- Avkryssing: flytt til/fra «Utført»-seksjonen ----------------
     Når et element krysses av (eller reaktiveres) flyttes det mellom aktiv-lista
     og «Utført»-seksjonen med en FLIP-animasjon: alle berørte rader måles før
     flyttingen og glir smidig på plass, slik at destinasjonen «vokser» for å ta
     imot raden (de under glir ned) mens raden lander. pos endres IKKE (kun
     innholds-registeret stemples via stampContent), så et reaktivert element
     sorterer tilbake til nøyaktig sin gamle plass blant de aktive — og skyver
     den som nå står der, ett hakk ned. */
  const DONE_FLIP_MS = 300;
  function toggleItemDone(itemEl, itemData, cardData) {
    const cardEl = itemEl.closest('.card');
    if (!cardEl) return;
    const activeUl = cardEl.querySelector('.items-container');
    const doneWrap = cardEl.querySelector('.items-done-wrap');
    const doneUl = cardEl.querySelector('.items-done');
    const toDone = !itemData.done;
    const reduce = prefersReducedMotion();

    // FLIP: mål alle elementers posisjon FØR flyttingen.
    const snap = reduce ? null : snapshotRects([...cardEl.querySelectorAll('.item')]);

    itemData.done = toDone;
    stampContent(itemData);
    itemEl.classList.toggle('done', toDone);
    const chk = itemEl.querySelector('.item-check');
    if (chk) chk.setAttribute('aria-pressed', toDone ? 'true' : 'false');

    // Vis «Utført»-seksjonen så den kan ta imot elementet (og måles i FLIP-en).
    if (toDone) doneWrap.hidden = false;

    // Flytt elementet til riktig seksjon, innsatt på pos-sortert plass. Ved
    // reaktivering av et kategorisert element går det tilbake INN i kategorien
    // sin (om den fortsatt finnes), ellers til nivå 1.
    const destUl = toDone ? doneUl
      : ((itemData.cat && cardEl.querySelector('.category[data-id="' + itemData.cat + '"] .cat-items')) || activeUl);
    let ref = null;
    for (const s of destUl.querySelectorAll('.item')) {
      if (s === itemEl) continue;
      const sd = cardData.items.find((it) => it.id === s.dataset.id);
      if (sd && sd.pos > itemData.pos) { ref = s; break; }
    }
    if (ref) destUl.insertBefore(itemEl, ref); else destUl.appendChild(itemEl);

    // Skjul seksjonen igjen hvis den ble tom (siste element reaktivert).
    if (!doneUl.querySelector('.item')) doneWrap.hidden = true;

    if (!reduce) flipFrom(snap, DONE_FLIP_MS);
    save();
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
  // Sett `trashed`-flagget på ett objekt. Én kilde for mount/else-splitten som
  // både sletting (commit-callback, `trashed = true`) og gjenoppretting
  // (`trashed = false`) trenger: en montert deling speiler flagget i
  // montasjepunktet + pusher til skyen, en egen-eid rad stemples lokalt.
  // Elementer monteres aldri (kun univers/gruppe/liste kan være share-røtter),
  // så else-grenen kjører alltid for `kind === 'item'`.
  function setTrashed(o, kind, val) {
    if (o._mount) { o.trashed = val; o._mount.trashed = val; cloudMountUpdate(kind, o.id, { trashed: val }); }
    else { o.trashed = val; stampContent(o); }
  }
  // Sett gravstein på objektet + hele undertreet (hindrer gjenoppstandelse ved
  // fletting, se docs/sync.md). Delt av alle fire «tøm permanent»-funksjonene.
  function tombSubtree(o, kind) {
    state._tomb[kind + 's'][o.id] = tick();
    if (kind === 'universe') (o.groups || []).forEach((g) => tombSubtree(g, 'group'));
    else if (kind === 'group') (o.cards || []).forEach((c) => tombSubtree(c, 'card'));
    else if (kind === 'card') (o.items || []).forEach((it) => tombSubtree(it, 'item'));
  }
  // Alle fire gjenopprett-hjelperne slår opp objektet på nytt via id FØR de
  // muterer det — aldri den (potensielt foreldede) referansen som ble sendt inn.
  // Søppel-modalen kan stå åpen mens synken bygger state-treet på nytt
  // (`applyDoc`/`applyMyDoc` bytter ut hele `state.universes` med ferske
  // objekter), så en fanget referanse fra da modalen ble åpnet peker på et
  // foreldreløst tre. Uten oppslaget satte «Gjenopprett» `trashed = false` på den
  // foreldreløse kopien — modalen så tom ut, men treet hadde objektet slettet.
  function restoreUniverse(u) {
    const f = findAnyById(u.id); if (!f || f.kind !== 'universe') return; u = f.obj;
    setTrashed(u, 'universe', false);
    if (!activeUniverseObj()) setActiveUniverse(u.id); // ingen aktiv? aktivér den gjenopprettede
    render(); save();
  }
  function restoreGroup(g) {
    const f = findAnyById(g.id); if (!f || f.kind !== 'group') return; g = f.obj;
    setTrashed(g, 'group', false);
    if (!activeGroupObj()) setActiveGroup(g.id);
    render(); save();
  }
  function restoreCard(c) {
    const f = findAnyById(c.id); if (!f || f.kind !== 'card') return; c = f.obj;
    setTrashed(c, 'card', false);
    render(); save();
  }
  function restoreItem(it) {
    const f = findAnyById(it.id); if (!f || f.kind !== 'item') return;
    setTrashed(f.obj, 'item', false); refreshCard(f.card); save();
  }

  /* ---------------- DELETE-BUFFER (optimistisk sletting med angre) ----------------
     Sletting skriver IKKE til databasen med en gang. Objektet får et lokalt
     `_pendingDelete`-flagg (skjules fra visning, ligger som vanlig rad i
     søppel-modalen) + en «Angre»-toast. Angrer man innen vinduet — via toasten
     eller «Gjenopprett» i modalen — fjernes flagget lokalt: ingen database-
     trafikk, umiddelbart. Ellers committes slettingen når timeren utløper, når
     fanen skjules, ELLER når en «Tøm»-sti trenger den committet
     (commitBufferedFor): `trashed = true` + stempling/mount-push. Ingenting i
     søppel-flyten venter altså på bufferet.
     ALT gjøres via id-oppslag (ikke fangede objekt-referanser), så det tåler at
     synken bygger state-treet på nytt underveis; `reapplyPendingDeletes()`
     gjenpåfører flagget etter hver applyDoc/applyMyDoc. */
  const DELETE_BUFFER_MS = 5000;
  const pendingDeletes = new Map(); // id → { kind, commit, timer }

  function findAnyById(id) {
    for (const u of state.universes) {
      if (u.id === id) return { kind: 'universe', obj: u };
      for (const g of (u.groups || [])) {
        if (g.id === id) return { kind: 'group', obj: g };
        for (const c of (g.cards || [])) {
          if (c.id === id) return { kind: 'card', obj: c };
          for (const it of (c.items || [])) if (it.id === id) return { kind: it.isCat ? 'category' : 'item', obj: it, card: c };
        }
      }
    }
    return null;
  }
  // Buffrer sletting (skjuler + registrerer), men starter INGEN egen timer —
  // commit/angre styres av samle-toasten (se pushDeleteToast under), så en gruppe
  // slettinger committes samlet når den felles timeren utløper.
  function bufferDelete(obj, kind, commit) {
    obj._pendingDelete = true;
    pendingDeletes.set(obj.id, { kind, commit });
  }
  // Committer ETT objekt (trashed=true + stempling/mount) uten å tegne på nytt —
  // objektet var allerede skjult (buffret), så board-et endres ikke visuelt.
  function commitDeleteOne(id) {
    const entry = pendingDeletes.get(id);
    if (!entry) return null;
    pendingDeletes.delete(id);
    const found = findAnyById(id);
    if (!found) return null;
    delete found.obj._pendingDelete;
    entry.commit(found.obj);
    return found; // { kind, obj, card? } — brukes til å rydde riktig badge (se under)
  }
  // Angrer ETT objekt (fjern flagget) uten å tegne på nytt.
  function undoDeleteOne(id) {
    const entry = pendingDeletes.get(id);
    if (!entry) return;
    pendingDeletes.delete(id);
    const found = findAnyById(id);
    if (found) delete found.obj._pendingDelete;
  }
  // Fjern id-er fra samle-toasten (etter enkelt-angre/commit utenom timeren);
  // tom gruppe → toasten og timeren ryddes helt.
  function pruneDeleteToast(ids) {
    if (!deleteToast) return;
    deleteToast.ids = deleteToast.ids.filter((x) => !ids.includes(x));
    if (!deleteToast.ids.length) {
      clearTimeout(deleteToast.timer);
      deleteToast = null;
      hideToast();
    } else {
      // Oppdater antallet i toasten (uten å restarte commit-timeren).
      showToast(deleteMsg(deleteToast.kind, deleteToast.ids, deleteToast.lastName),
        deleteToastAction(), { sticky: true });
    }
  }
  // «Gjenopprett» på en buffret (ennå ikke committet) sletting: bare angre
  // bufferet — umiddelbart, ingen databasetrafikk (objektet ble aldri trashed).
  function undoBufferedDelete(id) {
    undoDeleteOne(id);
    pruneDeleteToast([id]);
    render();
  }
  // Committer buffrede slettinger blant `ids` UMIDDELBART (uten å vente på
  // angre-vinduet) — brukes av «Tøm»-stiene, så tømming aldri må vente på at
  // bufferet skal utløpe. Objektene var allerede skjult, så ingen re-rendring.
  function commitBufferedFor(ids) {
    const mine = ids.filter((id) => pendingDeletes.has(id));
    if (!mine.length) return;
    mine.forEach(commitDeleteOne);
    pruneDeleteToast(mine);
  }
  // Oppdaterer KUN element-søppel-badgen på ett kort (antallet), uten å bygge
  // kortet på nytt — så en pågående inline-redigering i samme kort (eller andre
  // kort) ikke forstyrres. Badgen finnes allerede i DOM-en fra da elementet
  // ble slettet.
  function updateItemsTrashBadge(cardData) {
    const count = board.querySelector('.card[data-id="' + cardData.id + '"] .item-trash-btn .trashcan-count');
    if (!count) return;
    count.textContent = trashedItemsOf(cardData).length;
  }
  // Oppdaterer badge-tellerne som hørte til nettopp committede objekter — uten en
  // full render() (som ville revet ned en pågående inline-redigering et annet
  // sted i UI-et). `committed` er resultatene fra commitDeleteOne (kan inneholde
  // null for allerede fjernede/ukjente id-er).
  function refreshTrashBadgesAfterCommit(committed) {
    const kinds = new Set(), cards = new Set();
    committed.forEach((f) => {
      if (!f) return;
      kinds.add(f.kind);
      if (f.kind === 'item' && f.card) cards.add(f.card);
    });
    if (kinds.has('universe')) updateUniversesTrash();
    if (kinds.has('group')) updateGroupsTrash();
    if (kinds.has('card')) updateTrashCount();
    cards.forEach(updateItemsTrashBadge);
  }
  function commitAllPending() {
    if (deleteToast) { clearTimeout(deleteToast.timer); deleteToast = null; hideToast(); }
    if (!pendingDeletes.size) return;
    const committed = [...pendingDeletes.keys()].map(commitDeleteOne);
    save();
    refreshTrashBadgesAfterCommit(committed);
    if (!trashModal.hidden) renderTrashModalBody();
  }
  // Etter at synken har bygget state-treet på nytt: gjenpåfør buffer-flagget på
  // de friske objektene (ellers ville et buffret objekt dukket opp igjen).
  function reapplyPendingDeletes() {
    if (!pendingDeletes.size) return;
    for (const id of [...pendingDeletes.keys()]) {
      const found = findAnyById(id);
      if (found) found.obj._pendingDelete = true;
      else pendingDeletes.delete(id);
    }
  }
  // Ikke la en buffret sletting «henge» hvis fanen lukkes/skjules før timeren —
  // commit den da (så den faktisk havner i søppel og synkes).
  document.addEventListener('visibilitychange', () => { if (document.hidden) commitAllPending(); });
  window.addEventListener('pagehide', commitAllPending);

  /* ---------- Samle-toast for slettinger ----------
     Slettes flere objekter av SAMME kategori mens toasten er åpen, slås de sammen
     til én toast og timeren startes på nytt (én «Angre» gjelder alle). Slettes et
     objekt av en ANNEN kategori, antas den forrige toasten unødvendig → den
     forrige gruppen committes straks, og en fersk toast starter for den nye
     kategorien. Toasten er «sticky» (auto-skjules ikke) — den felles timeren
     styrer både commit og skjuling. */
  let deleteToast = null; // { kind, ids: [], lastName, timer }
  function deleteMsg(kind, ids, lastName) {
    if (ids.length === 1) return 'Slettet «' + (lastName || '') + '»';
    const w = kind === 'item' ? itemWord : kind === 'card' ? listWord : kind === 'group' ? groupWord : uniWord;
    return 'Slettet ' + w(ids.length);
  }
  function armDeleteTimer() {
    clearTimeout(deleteToast.timer);
    deleteToast.timer = setTimeout(() => {
      const g = deleteToast; deleteToast = null;
      const committed = g.ids.map(commitDeleteOne);
      save();
      refreshTrashBadgesAfterCommit(committed);
      hideToast();
      if (!trashModal.hidden) renderTrashModalBody();
    }, DELETE_BUFFER_MS);
  }
  // Angre-knappen i samle-toasten (deles med pruneDeleteToast, som maler toasten
  // på nytt med oppdatert antall etter en enkelt-gjenoppretting fra modalen).
  function deleteToastAction() {
    return {
      label: 'Angre',
      fn: () => {
        if (!deleteToast) { hideToast(); return; }
        const g = deleteToast; deleteToast = null;
        clearTimeout(g.timer);
        g.ids.forEach(undoDeleteOne);
        render();
        if (!trashModal.hidden) renderTrashModalBody();
        hideToast();
      },
    };
  }
  function pushDeleteToast(kind, id, name) {
    // Ny kategori → commit den forrige gruppen straks (ikke lenger angrbar).
    if (deleteToast && deleteToast.kind !== kind) {
      const old = deleteToast; deleteToast = null;
      clearTimeout(old.timer);
      const committed = old.ids.map(commitDeleteOne);
      save();
      refreshTrashBadgesAfterCommit(committed);
      if (!trashModal.hidden) renderTrashModalBody();
    }
    if (deleteToast && deleteToast.kind === kind) {
      deleteToast.ids.push(id);
      deleteToast.lastName = name;
    } else {
      deleteToast = { kind, ids: [id], lastName: name, timer: null };
    }
    armDeleteTimer();
    showToast(deleteMsg(kind, deleteToast.ids, deleteToast.lastName), deleteToastAction(), { sticky: true });
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

  // Direkte-barn-rader i en drop-container som deltar i rekkefølgen: elementer
  // (og på nivå 1 også kategorier), unntatt det som dras. Placeholderen er
  // hverken `.item` eller `.category`, så den utelates automatisk. Bruker
  // direkte barn (ikke querySelectorAll('.item')) så vi ikke plukker elementer
  // som ligger INNE i en kategori når vi ser på nivå-1-containeren.
  function rowChildren(cont) {
    return [...cont.children].filter((c) =>
      (c.classList.contains('item') && !c.classList.contains('dragging')) ||
      (c.classList.contains('category') && !c.classList.contains('dragging')));
  }
  // Pos-en til en DOM-rad (element ELLER kategori) via state-oppslaget.
  function rowPos(sib) {
    if (!sib || !(sib.classList.contains('item') || sib.classList.contains('category'))) return null;
    const o = findItemById(sib.dataset.id);
    return o ? (o.pos || 0) : null;
  }

  function onItemMove(ev) {
    if (!drag.active) return;
    const dy = ev.clientY - drag.lastY;
    drag.lastX = ev.clientX;
    drag.lastY = ev.clientY;
    moveElement();

    const dragRect = draggedRect();
    const flipEls = [...document.querySelectorAll('.item:not(.dragging), .category:not(.dragging)')];

    // 1) Nivå 2 først: er pekeren inne i en kategori? → kategoriens .cat-items
    //    (slipp på overskriften ELLER blant elementene legger elementet i den).
    let targetCont = null;
    for (const cat of document.querySelectorAll('.category:not(.dragging)')) {
      const r = cat.getBoundingClientRect();
      if (ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom) {
        targetCont = cat.querySelector('.cat-items'); break;
      }
    }
    // 2) Nivå 1: kortets .items-container (håndterer overføring mellom kort).
    if (!targetCont) {
      const containers = [...document.querySelectorAll('.items-container')];
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
    }
    if (!targetCont) return;

    const ph = drag.ph;
    const rows = rowChildren(targetCont);
    const phInCont = ph.parentNode === targetCont;
    const hasCat = rows.some((r) => r.classList.contains('category'));

    let action = null; // {pos:'before'|'after'|'append', ref?}

    if (!phInCont || hasCat) {
      // Overføring til en annen container, ELLER nivå 1 med kategorier (blandede
      // radhøyder): senterbasert innsetting — robust der overlapp-hysteresen
      // ellers ville feilet mot en høy kategori-blokk.
      const cy = dragRect.top + dragRect.height / 2;
      let ref = null;
      for (const it of rows) {
        const r = layoutRect(it);
        if (cy < r.top + r.height / 2) { ref = it; break; }
      }
      action = ref ? { ref, pos: 'before' } : { pos: 'append' };
    } else if (dy > 0) {
      let best = null, bestTop = Infinity;
      for (const it of rows) {
        const r = layoutRect(it);
        if (r.top >= dragRect.top && vOverlap(dragRect, r) >= SWAP_RATIO * r.height && r.top < bestTop) {
          bestTop = r.top; best = it;
        }
      }
      if (best) action = { ref: best, pos: 'after' };
    } else if (dy < 0) {
      let best = null, bestTop = -Infinity;
      for (const it of rows) {
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
    const catEl = el.closest('.category'); // ligger elementet nå inne i en kategori?
    const prev = el.previousElementSibling;
    const next = el.nextElementSibling;

    // Ta et øyeblikksbilde av alle elementer FØR reconcile: ved overføring til et
    // annet kort må mål-kortet finne det flyttede elementet selv om kilde-kortet
    // reconciles først (ellers droppes det fra pool-en før målet ser det).
    const pool = itemPool();
    reconcileItems(sourceCardId, pool);
    if (targetCardId !== sourceCardId) reconcileItems(targetCardId, pool);

    // Kirurgisk: sett kun det flyttede elementets forelder (home), kategori (cat)
    // og posisjon. `cat` rir på posisjonsregisteret (som `home`).
    const moved = findItemById(el.dataset.id);
    if (moved) {
      moved.home = targetCardId;
      moved.cat = catEl ? catEl.dataset.id : null;
      moved.pos = between(rowPos(prev), rowPos(next));
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

  // Bygg items-array for et kort ut fra gjeldende DOM (medlemskap OG kategori):
  // nivå-1-rader leses fra `.items-container` (ukategoriserte + kategorier), og
  // hver kategoris elementer fra dens `.cat-items` (setter `it.cat`). `pool` =
  // felles øyeblikksbilde av alle elementer (så en overføring ikke faller ut
  // mellom kilde- og mål-reconcile); bygges her hvis ikke gitt.
  function reconcileItems(cardId, pool) {
    const cardData = findCard(cardId);
    if (!cardData) return;
    const cardEl = board.querySelector('.card[data-id="' + cardId + '"]');
    if (!cardEl) return;
    pool = pool || itemPool();
    const level1 = cardEl.querySelector('.items-container');
    const result = [];
    const seen = new Set();
    const push = (id, cat) => {
      const o = pool[id];
      if (!o || seen.has(id)) return;
      seen.add(id);
      o.cat = cat;
      result.push(o);
    };
    [...level1.children].forEach((child) => {
      if (child.classList.contains('item')) {
        push(child.dataset.id, null);
      } else if (child.classList.contains('category')) {
        push(child.dataset.id, null); // kategorien selv er en nivå-1-rad
        const inner = child.querySelector('.cat-items');
        if (inner) [...inner.children].forEach((li) => {
          if (li.classList.contains('item')) push(li.dataset.id, child.dataset.id);
        });
      }
    });
    // Bevar rader UTENFOR nivå-1-containeren: slettede (søppel), avkryssede
    // («Utført»-seksjonen) og buffer-slettede. Kategori-medlemskapet (cat) deres
    // beholdes urørt (de er ikke i DOM-en her). Rekkefølgen bevares av pos.
    const preserved = cardData.items.filter((it) => !seen.has(it.id) && (it.trashed || it.done || it._pendingDelete));
    cardData.items = result.concat(preserved);
  }

  /* ---------------- KATEGORI-DRAGING (nivå-1-rad) ----------------
     En kategori dras kun innen sin egen liste (nivå 1); den kan ikke nøstes i en
     annen kategori (slipp på en annen kategori = vanlig bytte-plass). Idet
     draget starter kollapser kategorien (CAT_COLLAPSE_MS) til bare overskriften;
     ved slipp folder den seg ut igjen med den reverserte animasjonen. */
  const CAT_COLLAPSE_MS = 300;
  function liftCategory() {
    const el = drag.el;
    el.style.width = drag.width + 'px'; // ingen fast høyde → følger den kollapsende høyden
    el.style.left = (drag.lastX - drag.grabX) + 'px';
    el.style.top = (drag.lastY - drag.grabY) + 'px';
    el.classList.add('dragging');
  }
  function collapseCategory(catEl, ph) {
    const catItems = catEl.querySelector('.cat-items');
    const headH = catEl.querySelector('.cat-head').getBoundingClientRect().height;
    const collapsedH = headH + 8; // header + kategoriens dra-padding (.category.dragging)
    drag.height = collapsedH;      // treffdeteksjon bruker den kollapsede boksen
    if (prefersReducedMotion()) {
      catItems.style.overflow = 'hidden';
      catItems.style.height = '0px'; catItems.style.opacity = '0';
      catItems.style.paddingTop = '0'; catItems.style.paddingBottom = '0';
      ph.style.height = collapsedH + 'px';
      return;
    }
    const startH = catItems.getBoundingClientRect().height;
    catItems.style.overflow = 'hidden';
    catItems.style.height = startH + 'px';
    void catItems.offsetWidth; // registrer starttilstanden
    catItems.style.transition = 'height ' + CAT_COLLAPSE_MS + 'ms ease, opacity ' + CAT_COLLAPSE_MS + 'ms ease, padding ' + CAT_COLLAPSE_MS + 'ms ease';
    ph.style.transition = 'height ' + CAT_COLLAPSE_MS + 'ms ease';
    requestAnimationFrame(() => {
      catItems.style.height = '0px'; catItems.style.opacity = '0';
      catItems.style.paddingTop = '0'; catItems.style.paddingBottom = '0';
      ph.style.height = collapsedH + 'px';
    });
  }
  function expandCategory(catEl) {
    const catItems = catEl.querySelector('.cat-items');
    const clear = () => {
      catItems.style.transition = ''; catItems.style.height = ''; catItems.style.opacity = '';
      catItems.style.overflow = ''; catItems.style.paddingTop = ''; catItems.style.paddingBottom = '';
    };
    if (prefersReducedMotion()) { clear(); return; }
    catItems.style.transition = 'none';
    catItems.style.height = 'auto'; catItems.style.paddingTop = ''; catItems.style.paddingBottom = '';
    const full = catItems.getBoundingClientRect().height;
    catItems.style.height = '0px';
    void catItems.offsetWidth;
    catItems.style.transition = 'height ' + CAT_COLLAPSE_MS + 'ms ease, opacity ' + CAT_COLLAPSE_MS + 'ms ease';
    requestAnimationFrame(() => { catItems.style.opacity = '1'; catItems.style.height = full + 'px'; });
    catItems.addEventListener('transitionend', function te(e) {
      if (e.propertyName !== 'height') return;
      clear();
      catItems.removeEventListener('transitionend', te);
    });
  }
  // Senterbasert placeholder-innsetting blant nivå-1-rader (blandede høyder).
  function placeRowPlaceholder(cont) {
    const ph = drag.ph;
    const dragRect = draggedRect();
    const cy = dragRect.top + dragRect.height / 2;
    const rows = rowChildren(cont);
    let ref = null;
    for (const r of rows) {
      const rr = layoutRect(r);
      if (cy < rr.top + rr.height / 2) { ref = r; break; }
    }
    const action = ref ? { ref, pos: 'before' } : { pos: 'append' };
    const willMove = action.pos === 'append' ? cont.lastElementChild !== ph : wouldMove(ph, action.ref, 'before');
    if (!willMove) return;
    const snap = snapshotRects(rows);
    if (action.pos === 'append') cont.appendChild(ph);
    else placePlaceholder(cont, ph, action.ref, 'before');
    flipFrom(snap, FLIP_MS);
  }
  function startCategoryDrag(ev, catEl) {
    if (ev.button != null && ev.button !== 0) return;
    if (drag.active) return; // ignorer ny drag mens en pågår
    beginDragCommon(ev, catEl);
    drag.kind = 'category';
    drag.card = catEl.closest('.card'); // kategorier flyttes kun innen egen liste

    const ph = document.createElement('li');
    ph.className = 'item-placeholder cat-placeholder';
    ph.style.height = drag.height + 'px';
    catEl.parentNode.insertBefore(ph, catEl);
    drag.ph = ph;

    liftCategory();
    collapseCategory(catEl, ph);
    window.addEventListener('pointermove', onCategoryMove);
    window.addEventListener('pointerup', onCategoryUp);
    window.addEventListener('pointercancel', onCategoryUp);
  }
  function onCategoryMove(ev) {
    if (!drag.active) return;
    drag.lastX = ev.clientX;
    drag.lastY = ev.clientY;
    moveElement();
    const cont = drag.card && drag.card.querySelector('.items-container');
    if (cont) placeRowPlaceholder(cont);
  }
  function onCategoryUp() {
    if (!drag.active) return;
    window.removeEventListener('pointermove', onCategoryMove);
    window.removeEventListener('pointerup', onCategoryUp);
    window.removeEventListener('pointercancel', onCategoryUp);

    const el = drag.el;
    const cont = drag.ph.parentNode;
    cont.insertBefore(el, drag.ph);
    drag.ph.remove();
    dropIntoPlaceholder(el, false); // fly inn i sloten (kollapset) …
    expandCategory(el);             // … og fold ut igjen (reversert animasjon)
    finishDrag();

    const prev = el.previousElementSibling;
    const next = el.nextElementSibling;
    const cat = findItemById(el.dataset.id);
    if (cat) { cat.pos = between(rowPos(prev), rowPos(next)); stampPos(cat); }
    save();
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

  // Delt slipp-håndtering for de to «kolonne»-nivåene (grupper og universer):
  // begge er rene vertikale lister uten kryss-kolonne-overføring (i motsetning
  // til kort/element), så eneste forskjell er beholder/søsken-klasse/id-oppslag/
  // mount-kind/reindeks + hvilke move/up-lyttere som skal kobles fra. Ny pos =
  // mellom DOM-naboene; montert rad speiler rekkefølgen i membership-raden.
  function finishColumnDrop(o) {
    if (!drag.active) return;
    window.removeEventListener('pointermove', o.move);
    window.removeEventListener('pointerup', o.up);
    window.removeEventListener('pointercancel', o.up);

    const el = drag.el;
    const rot = cardRotation();
    o.container.insertBefore(el, drag.ph);
    drag.ph.remove();
    dropIntoPlaceholder(el, rot);
    finishDrag();

    const prev = el.previousElementSibling;
    const next = el.nextElementSibling;
    const obj = o.find(el.dataset.id);
    if (obj) {
      const prevO = prev && prev.classList.contains(o.siblingClass) ? o.find(prev.dataset.id) : null;
      const nextO = next && next.classList.contains(o.siblingClass) ? o.find(next.dataset.id) : null;
      const np = between(prevO ? prevO.pos : null, nextO ? nextO.pos : null);
      if (obj._mount) { obj.pos = np; obj._mount.pos = np; cloudMountUpdate(o.kind, obj.id, { pos: np }); }
      else { obj.pos = np; stampPos(obj); }
    }
    o.reindex();
    save();
  }
  function onGroupUp() {
    finishColumnDrop({ container: groupsBar, siblingClass: 'group-card', find: findGroup,
      kind: 'group', reindex: reindexGroupColors, move: onGroupMove, up: onGroupUp });
  }

  // Posisjonsbasert farge: en omrokkering påvirker flere korts farge, ikke bare
  // det flyttede. Delt av gruppe- og univers-nivået — begge bruker --g-bg/
  // --g-accent + colorForIndex/darken(…, 0.34). Kort er egne (--card-*), se
  // reindexCardColors.
  function reindexColors(list, container, cls) {
    list().forEach((o, i) => {
      o.color = colorForIndex(i);
      const el = container.querySelector('.' + cls + '[data-id="' + o.id + '"]');
      if (!el) return;
      el.style.setProperty('--g-bg', o.color);
      el.style.setProperty('--g-accent', darken(o.color, 0.34));
    });
  }
  function reindexGroupColors() { reindexColors(visibleGroups, groupsBar, 'group-card'); }

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
    finishColumnDrop({ container: uniList, siblingClass: 'uni-row', find: findUniverse,
      kind: 'universe', reindex: reindexUniverseColors, move: onUniverseMove, up: onUniverseUp });
  }
  function reindexUniverseColors() { reindexColors(visibleUniverses, uniList, 'uni-row'); }

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
    const settings = document.getElementById('settings-modal');
    const timeSw = document.getElementById('time-switcher');
    document.body.classList.toggle('modal-open',
      !trashModal.hidden || !menuModal.hidden ||
      (share && !share.hidden) || (place && !place.hidden) ||
      (confirmEl && !confirmEl.hidden) || (settings && !settings.hidden) ||
      (timeSw && !timeSw.hidden) || !!openSwitcherKind || respOpen);
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
      // Buffret (ennå ikke committet) sletting gjenopprettes ved å angre
      // bufferet — umiddelbart og uten databasetrafikk; committede rader
      // gjenopprettes som før (trashed=false).
      restore.addEventListener('click', () => {
        if (r.pending) undoBufferedDelete(r.id);
        else r.restore();
        renderTrashModalBody();
      });
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
  const uniWord = (n) => n + ' ' + (n === 1 ? 'univers' : 'universer');

  /* ---------- De fire søppelkassene ---------- */
  function openUniversesTrash() {
    showTrashModal({
      title: 'Slettede universer',
      note: TRASH_NOTE,
      emptyMsg: 'Ingen slettede universer.',
      rows: () => trashedUniverses().sort(posCmp).map((u) => ({
        id: u.id,
        color: u.color || colorForId(u.id),
        name: u.name,
        meta: groupWord(u.groups.filter((g) => !g.trashed).length),
        pending: !!u._pendingDelete,
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
        id: g.id,
        color: g.color || colorForId(g.id),
        name: g.name,
        meta: listWord(g.cards.filter((c) => !c.trashed).length),
        pending: !!g._pendingDelete,
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
        id: c.id,
        color: c.color || colorForId(c.id),
        name: c.title,
        meta: itemWord(c.items.filter((it) => !it.trashed).length),
        pending: !!c._pendingDelete,
        restore: () => restoreCard(c),
      })),
      empty: emptyCardsTrash,
    });
  }

  function openItemsTrash(cardData) {
    // De tre andre søppelkassene leser ferskt fra `state` i hver `rows()`-kall
    // (`trashedGroups()`/…); elementmodalen må gjøre det samme via id-oppslag i
    // stedet for å fange `cardData` én gang — ellers peker den på et foreldreløst
    // kort etter at synken har bygget treet på nytt («Gjenopprett» som ikke
    // fester seg). Se restore-hjelperne over.
    const cardId = cardData.id;
    const liveCard = () => { const f = findAnyById(cardId); return f && f.kind === 'card' ? f.obj : null; };
    showTrashModal({
      title: 'Slettede elementer – ' + cardData.title,
      note: TRASH_NOTE,
      emptyMsg: 'Ingen slettede elementer.',
      rows: () => {
        const c = liveCard();
        return c ? trashedItemsOf(c).sort(posCmp).map((it) => ({
          id: it.id,
          name: it.text,
          pending: !!it._pendingDelete,
          restore: () => restoreItem(it),
        })) : [];
      },
      empty: () => { const c = liveCard(); if (c) emptyItemsTrash(c); },
    });
  }

  // Tøm lister-søppelkassen (aktiv gruppe) permanent: gravstein per liste + element.
  // Buffrede slettinger committes først, så tømming aldri venter på angre-vinduet.
  function emptyCardsTrash() {
    commitBufferedFor(trashedCards().map((c) => c.id));
    const trash = trashedCards();
    if (!trash.length) return;
    const arr = allCards();
    trash.forEach((c) => {
      const i = arr.indexOf(c);
      if (c._mount) {
        if (i > -1) arr.splice(i, 1);
        cloudLeave('card', c.id);
        return;
      }
      tombSubtree(c, 'card'); // permanent gravstein hindrer gjenoppstandelse
      if (i > -1) arr.splice(i, 1);
    });
    render();
    save();
  }

  // Tøm univers-søppelkassen permanent: gravsteiner for hvert slettet univers +
  // alle dets grupper, lister og elementer (hindrer gjenoppstandelse).
  function emptyUniversesTrash() {
    commitBufferedFor(trashedUniverses().map((u) => u.id));
    const trash = trashedUniverses();
    if (!trash.length) return;
    trash.forEach((u) => {
      const i = state.universes.indexOf(u);
      if (u._mount) {
        if (i > -1) state.universes.splice(i, 1);
        cloudLeave('universe', u.id);
        return;
      }
      tombSubtree(u, 'universe');
      if (i > -1) state.universes.splice(i, 1);
    });
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
      '<span class="swipe-label">Tøm</span>' +
      '<span class="swipe-arrow" aria-hidden="true"></span>';
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
      if (api.count() <= 0) return; // ingenting å tømme
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
      // Symmetrisk: like mye luft til høyre for pilen som til venstre for ikonet.
      field.style.paddingRight = padLeft + 'px';
      field.classList.add('open');
      setProgress(0);
      void field.offsetWidth;                  // reflow → animér utvidelsen
      field.style.transition = '';

      // Utvid mot høyre så langt det trengs/er plass (venstre kant og høyde
      // ligger fast → ingen vertikal asymmetri, ikonet står i ro).
      const width = Math.max(Math.round(r.width),
        Math.min(207, vw - EDGE - Math.round(r.left)));
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

    // Fanger tilfellet der knappen fjernes fra DOM-en midt i et trykk/sveip
    // (f.eks. et kort bygges på nytt av en synk mens man holder inne) — da
    // frigis pekerfangsten implisitt, UTEN at pointerup/pointercancel noensinne
    // fyres på den (nå frakoblede) knappen, og feltet ble hengende åpent til
    // neste trykk. Nettleseren leverer i dette tilfellet lostpointercapture på
    // `document` (ikke på knappen selv), filtrert på pointerId — koblet til/fra
    // per trykk (ikke i selve attachTrashHold) for å unngå at hvert re-bygde
    // element-søppel-ikon (buildCard kaller attachTrashHold på nytt hver gang)
    // legger igjen en varig lytter på document.
    function onLostCapture(ev) {
      if (ev.pointerId !== pid) return;
      document.removeEventListener('lostpointercapture', onLostCapture, true);
      if (mode == null) return;
      clearTimeout(holdTimer); holdTimer = null;
      if (mode === 'swiping') collapseField(); // rydder feltet uten å tømme
      if (mode !== 'done') mode = null;
    }
    btn.addEventListener('pointerdown', (ev) => {
      if (ev.button != null && ev.button > 0) return;
      ev.preventDefault();
      pid = ev.pointerId;
      try { btn.setPointerCapture(pid); } catch (e) { /* ignore */ }
      document.addEventListener('lostpointercapture', onLostCapture, true);
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
      document.removeEventListener('lostpointercapture', onLostCapture, true);
      clearTimeout(holdTimer); holdTimer = null;
      // Svelg det etterfølgende (peker-genererte) klikket uansett, så det verken
      // åpner modalen på nytt (etter sveip) eller treffer modal-overlay-en.
      ignoreClick = true; setTimeout(() => { ignoreClick = false; }, 350);
      // Feltet ble aldri faktisk åpnet (mode fortsatt 'pending') — enten et kort
      // trykk, ELLER et sveipeforsøk som openField() avviste (tom kasse). I begge
      // tilfeller er ingenting synlig endret, så vi åpner modalen uansett liten
      // bevegelse — ellers ble trykket helt uten respons (utsatt til etter
      // click-sekvensen).
      if (mode === 'pending') {
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
    if (timeQuickOpen) { closeTimeQuick(); return; } // tids-popoveren ligger øverst
    if (respOpen) { closeResponsible(); return; } // ansvarlig-velgeren ligger øverst
    if (openSwitcherKind) { closeSwitcher(); return; } // popover/modal ligger øverst av alle
    if (confirmModalEl && !confirmModalEl.hidden) { closeConfirm(false); return; } // øverst
    const share = document.getElementById('share-modal');
    const place = document.getElementById('place-modal');
    if (place && !place.hidden) { place.hidden = true; updateModalOpenClass(); }
    else if (share && !share.hidden) { share.hidden = true; updateModalOpenClass(); }
    else if (settingsModal && !settingsModal.hidden) closeSettings();
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

  /* ============================================================
     UNIVERS-/GRUPPEBYTTER (panel-title-knappene)
     ------------------------------------------------------------
     En ekstra, rask måte å bytte univers/gruppe på — i tillegg til
     meny-modalen (universer) og gruppekortene (grupper): klikk på selve
     navnet øverst i gruppemenyen/listemenyen åpner en enkel bytte-liste
     (farge vises, men ingen omdøping/sletting/rekkefølge herfra). Desktop:
     popover rett til høyre for knappen som åpnet den. Mobil: sentrert modal
     med intern scroll (se .switcher-* i styles.css). */
  let openSwitcherKind = null; // 'universe' | 'group' | null

  function switcherConfig(kind) {
    return kind === 'universe'
      ? { overlay: uniSwitcherOverlay, panel: uniSwitcherPanel, btn: uniSwitchBtn, items: visibleUniverses, activeId: () => state.activeUniverse }
      : { overlay: groupSwitcherOverlay, panel: groupSwitcherPanel, btn: groupSwitchBtn, items: visibleGroups, activeId: () => state.activeGroup };
  }

  function buildSwitcherRow(kind, obj, isActive) {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'switcher-row';
    el.dataset.id = obj.id;
    el.setAttribute('role', 'option');
    el.setAttribute('aria-selected', isActive ? 'true' : 'false');
    el.classList.toggle('active', isActive);
    applyChipColor(el, obj);
    const icon = document.createElement('span');
    icon.className = 'switcher-row-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.innerHTML = kind === 'universe' ? ICONS.globe : ICONS.folder;
    el.appendChild(icon);
    const name = document.createElement('span');
    name.className = 'switcher-row-name';
    name.textContent = obj.name;
    el.appendChild(name);
    el.addEventListener('click', () => {
      if (kind === 'universe') {
        if (obj.id !== state.activeUniverse) { setActiveUniverse(obj.id); render(); save(); }
      } else if (obj.id !== state.activeGroup) {
        setActiveGroup(obj.id); render();
      }
      closeSwitcher();
    });
    return el;
  }

  // Plasser popoveren rett til høyre for knappen (desktop); klem til
  // viewportet så den aldri havner utenfor skjermen.
  function positionSwitcherPanel(panel, btn) {
    const r = btn.getBoundingClientRect();
    const gap = 8;
    panel.style.visibility = 'hidden';
    panel.style.top = '0px';
    panel.style.left = '0px';
    const pr = panel.getBoundingClientRect();
    const top = Math.max(10, Math.min(r.top, window.innerHeight - pr.height - 10));
    let left = r.right + gap;
    if (left + pr.width > window.innerWidth - 10) left = Math.max(10, r.left - pr.width - gap);
    panel.style.top = top + 'px';
    panel.style.left = left + 'px';
    panel.style.visibility = '';
  }

  function openSwitcher(kind) {
    const cfg = switcherConfig(kind);
    const vis = cfg.items();
    vis.forEach((o, i) => { o.color = colorForIndex(i); }); // samme fargesystem som menyene
    cfg.panel.innerHTML = '';
    cfg.panel.style.top = '';
    cfg.panel.style.left = '';
    const activeId = cfg.activeId();
    let activeRow = null;
    vis.forEach((o) => {
      const isActive = o.id === activeId;
      const row = buildSwitcherRow(kind, o, isActive);
      if (isActive) activeRow = row;
      cfg.panel.appendChild(row);
    });
    openSwitcherKind = kind;
    cfg.overlay.hidden = false;
    updateModalOpenClass();
    if (window.matchMedia('(min-width: 561px)').matches) positionSwitcherPanel(cfg.panel, cfg.btn);
    (activeRow || cfg.panel.firstElementChild || cfg.panel).focus();
  }

  function closeSwitcher() {
    if (!openSwitcherKind) return;
    switcherConfig(openSwitcherKind).overlay.hidden = true;
    openSwitcherKind = null;
    updateModalOpenClass();
  }

  uniSwitchBtn.addEventListener('click', () => openSwitcher('universe'));
  groupSwitchBtn.addEventListener('click', () => openSwitcher('group'));
  [uniSwitcherOverlay, groupSwitcherOverlay].forEach((overlay) => {
    overlay.addEventListener('click', (ev) => { if (ev.target === overlay) closeSwitcher(); });
  });
  // Piltaster opp/ned flytter fokus mellom radene (kun navigasjon — rekkefølgen
  // kan ikke endres herfra, det er forbeholdt de fulle menyene).
  [uniSwitcherPanel, groupSwitcherPanel].forEach((panel) => {
    panel.addEventListener('keydown', (ev) => {
      if (ev.key !== 'ArrowDown' && ev.key !== 'ArrowUp') return;
      const rows = [...panel.querySelectorAll('.switcher-row')];
      const i = rows.indexOf(document.activeElement);
      if (i < 0) return;
      ev.preventDefault();
      rows[(i + (ev.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length].focus();
    });
  });

  /* ---------------- Ansvarlig-velger (popover/modal) ----------------
     Samme skall som univers-/gruppebytteren (popover på desktop, sentrert modal
     på mobil), men radene viser en farget initial-sirkel + fullt navn for hver i
     delegruppen (alfabetisk). Gjelder både elementer og hele lister (target =
     { kind: 'card'|'item', obj, card }); valg skriver `obj.responsible` og synker. */
  let respOpen = false;
  let respToken = 0; // skiller gjenåpninger — en sen medlems-henting skal ikke male en lukket/nyåpnet popover
  function closeResponsible() {
    if (!respOpen) return;
    respSwitcherOverlay.hidden = true;
    respOpen = false;
    updateModalOpenClass();
  }
  // Slå opp DET LEVENDE objektet på id — popoveren/modalen kan ha fanget et
  // foreldet objekt hvis en synk-rebuild kjørte mens den var åpen.
  function liveTarget(target) {
    const f = findAnyById(target.obj.id);
    if (!f || f.kind !== target.kind) return null;
    // card = selve kortet for kort-mål; for element/kategori det eiende kortet.
    return { kind: target.kind, obj: f.obj, card: f.kind === 'card' ? f.obj : f.card };
  }
  function setResponsible(target, userId) {
    // Endringen vises umiddelbart og kan byttes igjen med en gang: hvert valg
    // stempler et nytt ts på innholds-registeret, så doc-synken (seriell
    // cloudCycle + felt-LWW) pusher alltid det siste valget — ingen venting.
    const live = liveTarget(target) || target;
    const obj = live.obj;
    if ((obj.responsible || null) === (userId || null)) return;
    obj.responsible = userId || null;
    stampContent(obj);
    refreshCard(live.card || findCard(target.card.id) || target.card);
    save();
    repaintSettings(); // innstillingsmodalen kan stå åpen på samme objekt
  }
  function openResponsible(target, shareRoot, rType, anchorBtn) {
    respSwitcherPanel.innerHTML = '';
    respSwitcherPanel.style.top = '';
    respSwitcherPanel.style.left = '';
    const key = rootKey(rType, shareRoot.id);
    const token = ++respToken;
    let didFocus = false;

    // Bygg (ev. bygg om) radene fra en delegruppe. Ansvaret leses LIVE på id,
    // så en ombygging etter en synk-rebuild markerer riktig person som aktiv.
    const paint = (group) => {
      const live = liveTarget(target);
      const curResp = ((live || target).obj.responsible) || null;
      const makeRow = (person, index, isRemove) => {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'resp-row' + (isRemove ? ' resp-row-clear' : '');
        row.setAttribute('role', 'option');
        const isActive = isRemove ? !curResp : curResp === person.id;
        row.setAttribute('aria-selected', isActive ? 'true' : 'false');
        row.classList.toggle('active', isActive);
        if (isRemove) {
          row.innerHTML = '<span class="resp-avatar resp-avatar-none">' + ICONS.handRaise + '</span>';
          const nm = document.createElement('span');
          nm.className = 'resp-row-name'; nm.textContent = 'Ingen ansvarlig';
          row.appendChild(nm);
        } else {
          row.appendChild(respAvatar(person, index));
          const nm = document.createElement('span');
          nm.className = 'resp-row-name'; nm.textContent = person.name;
          row.appendChild(nm);
        }
        row.addEventListener('click', () => {
          setResponsible(target, isRemove ? null : person.id);
          closeResponsible();
        });
        return row;
      };

      respSwitcherPanel.innerHTML = '';
      // «Ingen ansvarlig» først når noen er valgt (så man kan nullstille).
      if (curResp) respSwitcherPanel.appendChild(makeRow(null, -1, true));
      let activeRow = null;
      group.people.forEach((p, i) => {
        const row = makeRow(p, i, false);
        if (p.id === curResp) activeRow = row;
        respSwitcherPanel.appendChild(row);
      });
      if (!group.people.length) {
        const p = document.createElement('p');
        p.className = 'uni-empty'; p.textContent = 'Ingen medlemmer ennå.';
        respSwitcherPanel.appendChild(p);
      }
      // Reposisjoner ved ombygging (radantallet kan ha endret seg) — men aldri
      // mot en anker-knapp som en synk-rebuild har revet ut av DOM-en.
      if (anchorBtn.isConnected && window.matchMedia('(min-width: 561px)').matches) {
        positionSwitcherPanel(respSwitcherPanel, anchorBtn);
      }
      if (!didFocus) {
        didFocus = true;
        (activeRow || respSwitcherPanel.firstElementChild || respSwitcherPanel).focus();
      }
    };

    // Åpne UMIDDELBART med cachet delegruppe (normalt varm via ensureShareGroup
    // fra ansvarsknapp-rendringen); hent ferskt i bakgrunnen og bygg om når det
    // lander (medlemmer kan ha endret seg siden forrige cache).
    respOpen = true;
    respSwitcherOverlay.hidden = false;
    updateModalOpenClass();
    const cached = shareGroupCache.get(key);
    if (cached) paint(cached);
    fetchShareGroup(rType, shareRoot.id).then((g) => {
      shareGroupCache.set(key, g);
      if (respOpen && token === respToken) paint(g);
    }).catch(() => {
      // Uten cache har vi ingenting å vise → lukk med beskjed (som før).
      if (!shareGroupCache.has(key) && respOpen && token === respToken) {
        closeResponsible();
        showToast('Kunne ikke hente medlemmer');
      }
    });
  }
  respSwitcherOverlay.addEventListener('click', (ev) => { if (ev.target === respSwitcherOverlay) closeResponsible(); });
  respSwitcherPanel.addEventListener('keydown', (ev) => {
    if (ev.key !== 'ArrowDown' && ev.key !== 'ArrowUp') return;
    const rows = [...respSwitcherPanel.querySelectorAll('.resp-row')];
    const i = rows.indexOf(document.activeElement);
    if (i < 0) return;
    ev.preventDefault();
    rows[(i + (ev.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length].focus();
  });

  /* ============================================================
     INNSTILLINGSMODAL (liste/element) + TIDSPLAN
     ------------------------------------------------------------
     Tannhjulet på et listekort/element åpner én felles innstillingsmodal:
       1) navn (redigerbart felt, liste-ikon for lister)
       2) deling (kun lister — samme innhold som del-modalen)
       3) ansvarlig (delt kontekst — åpner ansvarlig-velgeren)
       4) tidsplan (start + frist; lister kan låse tidene til elementene)
     ALT lagres fortløpende uten bekreftelsesknapp: innholds-endringer
     (navn/tider/ansvar/lås-avkryssing) stemples med stampContent og går
     gjennom doc-synken (optimistisk, LWW); delings-handlingene ligger i
     operasjonskøen (opQueue) som før. Modalen slår alltid opp det LEVENDE
     objektet på id (liveTarget), så den tåler synk-rebuilds mens den er åpen. */
  const settingsModal = document.getElementById('settings-modal');
  const settingsBody = document.getElementById('settings-body');
  const settingsTitleEl = document.getElementById('settings-title');
  const settingsCloseBtn = document.getElementById('settings-close');
  let settingsCtx = null;       // { kind: 'card'|'item', id }
  let settingsRespPaint = null; // repaint-hook for ansvarlig-raden (satt av renderSettings)

  function settingsTarget() {
    return settingsCtx ? liveTarget({ kind: settingsCtx.kind, obj: { id: settingsCtx.id } }) : null;
  }
  // Ansvarlig-raden males på nytt etter et valg i velgeren (setResponsible).
  function repaintSettings() { if (settingsRespPaint) settingsRespPaint(); }

  function openSettings(kind, id) {
    settingsCtx = { kind, id };
    renderSettings();
    if (!settingsCtx) return; // objektet fantes ikke (renderSettings lukket)
    settingsModal.hidden = false;
    updateModalOpenClass();
  }
  function closeSettings() {
    if (settingsModal.hidden && !settingsCtx) return;
    settingsModal.hidden = true;
    settingsCtx = null;
    settingsRespPaint = null;
    updateModalOpenClass();
    render(); // navn/chips kan ha endret seg mens modalen var åpen
  }

  function settingsSection(icon, label) {
    const sec = document.createElement('section');
    sec.className = 'settings-section';
    const h = document.createElement('div');
    h.className = 'settings-section-title';
    h.innerHTML = icon + '<span>' + label + '</span>';
    sec.appendChild(h);
    return sec;
  }

  function renderSettings() {
    const t = settingsTarget();
    if (!t) { closeSettings(); return; }
    const obj = t.obj;
    const isCard = t.kind === 'card';
    const isCat = t.kind === 'category';
    const canEdit = !(accountsMode() && frozen(isCard ? obj : t.card));

    settingsTitleEl.innerHTML = ICONS.gear;
    settingsTitleEl.appendChild(document.createTextNode(' Innstillinger'));
    settingsBody.innerHTML = '';
    settingsRespPaint = null;

    // 1) Navn — redigeres rett i feltet, lagres fortløpende (tomt felt
    //    committes ikke og gjenopprettes ved blur). Lister/kategorier har et
    //    ikon foran; navnet ligger i `title` (lister) eller `text` (element/kat.).
    const nameWrap = document.createElement('div');
    nameWrap.className = 'settings-name';
    if (isCard || isCat) {
      const ic = document.createElement('span');
      ic.className = 'settings-name-icon';
      ic.setAttribute('aria-hidden', 'true');
      ic.innerHTML = isCard ? ICONS.list : ICONS.category;
      nameWrap.appendChild(ic);
    }
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'field settings-name-input';
    nameInput.value = isCard ? obj.title : obj.text;
    nameInput.setAttribute('aria-label', isCard ? 'Listens navn' : isCat ? 'Kategoriens navn' : 'Elementets tekst');
    nameInput.disabled = !canEdit;
    nameInput.addEventListener('input', () => {
      const live = settingsTarget();
      const val = nameInput.value.trim();
      if (!live || !val) return;
      const sel = isCard ? '.card[data-id="' + live.obj.id + '"] .card-title'
        : isCat ? '.category[data-id="' + live.obj.id + '"] .cat-title'
        : '.item[data-id="' + live.obj.id + '"] .item-text';
      if (isCard) live.obj.title = val; else live.obj.text = val;
      const dispEl = board.querySelector(sel);
      if (dispEl) dispEl.textContent = val;
      stampContent(live.obj);
      save();
    });
    nameInput.addEventListener('blur', () => {
      const live = settingsTarget();
      if (live && !nameInput.value.trim()) {
        nameInput.value = isCard ? live.obj.title : live.obj.text;
      }
    });
    nameWrap.appendChild(nameInput);
    settingsBody.appendChild(nameWrap);

    // 2) Deling (kun lister; eget eller montert objekt, kontomodus). Samme
    //    innhold som del-modalen — invitasjoner/lås/utkast går via opQueue.
    //    isMine (ikke _mine): en NYOPPRETTET liste mangler metadata til første
    //    pull, men er min — delingen skal ikke mangle rett etter opprettelse.
    if (isCard && accountsMode() && (isMine(obj) || obj._mount)) {
      const sec = settingsSection(ICONS.people, 'Deling');
      const shareWrap = document.createElement('div');
      shareWrap.className = 'share-body settings-share-body';
      if (obj._mine === false) renderShareRecipient('card', obj.id, obj, shareWrap, closeSettings);
      else renderShareOwner('card', obj.id, obj, shareWrap);
      sec.appendChild(shareWrap);
      settingsBody.appendChild(sec);
    }

    // 3) Ansvarlig (delt kontekst — også for HELE listen): rad med nåværende
    //    ansvarlig; klikk åpner ansvarlig-velgeren forankret i raden.
    const shareRoot = shareRootFor(t.card);
    if (shareRoot) {
      const rType = nodeType(shareRoot);
      ensureShareGroup(rType, shareRoot.id);
      const sec = settingsSection(ICONS.handRaise, 'Ansvarlig');
      const respBtn = document.createElement('button');
      respBtn.type = 'button';
      respBtn.className = 'settings-resp-btn';
      respBtn.disabled = !canEdit;
      const nameSpan = (txt) => {
        const s = document.createElement('span');
        s.className = 'settings-resp-name';
        s.textContent = txt;
        return s;
      };
      const paintRespRow = () => {
        const live = settingsTarget();
        if (!live) return;
        const rid = live.obj.responsible || null;
        const group = shareGroupCache.get(rootKey(rType, shareRoot.id));
        const entry = rid && group ? group.byId.get(rid) : null;
        respBtn.innerHTML = '';
        if (entry) {
          respBtn.appendChild(respAvatar(entry.person, entry.index));
          respBtn.appendChild(nameSpan(entry.person.name));
        } else if (rid) {
          respBtn.appendChild(respAvatar(null, -1)); // delegruppen ikke lastet ennå
          respBtn.appendChild(nameSpan('Ansvarlig valgt'));
        } else {
          const none = document.createElement('span');
          none.className = 'resp-avatar resp-avatar-none';
          none.innerHTML = ICONS.handRaise;
          respBtn.appendChild(none);
          respBtn.appendChild(nameSpan('Velg ansvarlig'));
        }
      };
      respBtn.addEventListener('click', () => {
        const live = settingsTarget();
        if (live) openResponsible(live, shareRoot, rType, respBtn);
      });
      paintRespRow();
      settingsRespPaint = paintRespRow;
      sec.appendChild(respBtn);
      settingsBody.appendChild(sec);
    }

    // 4) Tidsplan (alltid).
    const timeSec = settingsSection(ICONS.calendar, 'Tidsplan');
    timeSec.appendChild(buildTimeEditor(settingsTarget));
    settingsBody.appendChild(timeSec);
  }

  settingsCloseBtn.addEventListener('click', closeSettings);
  settingsModal.addEventListener('click', (ev) => { if (ev.target === settingsModal) closeSettings(); });

  /* ---------------- Tids-editoren (deles av modalen og popoveren) ----------------
     getTarget() slår opp det levende objektet per interaksjon. opts.only
     begrenser til én rad ('start'/'due' — tids-popoveren); ellers vises begge
     + lås-avkryssingen for lister. Endringer committes på input-change:
     stampContent + save (doc-synken pusher optimistisk), og kortet males på
     nytt så indikator-chipene følger med umiddelbart. */
  function buildTimeEditor(getTarget, opts) {
    opts = opts || {};
    const wrap = document.createElement('div');
    wrap.className = 'time-editor';
    const t0 = getTarget();
    if (!t0) return wrap;
    const isCard = t0.kind === 'card';
    const isCat = t0.kind === 'category';
    // Elementets tider kan være låst av listen ELLER en kategori (timeController).
    const controller = (!isCard && !isCat) ? timeController(t0.obj, t0.card) : null;
    const locked = !!controller;
    const ctrlIsCat = locked && !!controller.isCat;
    const canEdit = !locked && !(accountsMode() && frozen(isCard ? t0.obj : t0.card));

    // Containeren elementets tider måles mot (utenfor-hint): kategorien om den
    // finnes og har tider, ellers listen.
    const outsideContainer = () => {
      const cat = (!isCard && !isCat && t0.obj.cat) ? catOf(t0.card, t0.obj.cat) : null;
      return cat && (cat.start || cat.due) ? cat : t0.card;
    };

    const note = document.createElement('p');
    note.className = 'time-note';
    note.hidden = true;
    const updateNote = () => {
      const t = getTarget();
      if (!t) return;
      if (locked) {
        const which = ctrlIsCat ? 'kategorien' : 'listen';
        const nm = ctrlIsCat ? (controller.text || 'Kategori') : (controller.title || 'Uten navn');
        note.textContent = 'Tidene styres av ' + which + ' «' + nm + '».';
        note.classList.add('is-muted');
        note.hidden = false;
        return;
      }
      if (isCard || isCat) { note.hidden = true; return; }
      // Subtil beskjed når elementets tider ligger utenfor containerens tidsrom
      // (tre varianter: start / frist / begge). Fullt lovlig — bare et hint.
      const fl = outsideFlags(t.obj, outsideContainer());
      if (fl.start && fl.due) note.textContent = 'Starttiden og fristen er utenfor tidsrommet.';
      else if (fl.start) note.textContent = 'Starttiden er utenfor tidsrommet.';
      else if (fl.due) note.textContent = 'Fristen er utenfor tidsrommet.';
      note.hidden = !(fl.start || fl.due);
    };

    const makeRow = (field) => {
      const isDue = field === 'due';
      const row = document.createElement('div');
      row.className = 'time-row';
      const label = document.createElement('span');
      label.className = 'time-row-label';
      label.innerHTML = (isDue ? ICONS.calendarDue : ICONS.calendar) +
        '<span>' + (isDue ? 'Frist' : 'Start') + '</span>';
      const dateIn = document.createElement('input');
      dateIn.type = 'date';
      dateIn.className = 'field time-date';
      dateIn.placeholder = 'dd.mm.åååå';
      dateIn.setAttribute('aria-label', isDue ? 'Fristdato' : 'Startdato');
      // Klokkeikon til venstre for klokkeslettet, så feltet leses tydelig som
      // klokkeslett (ikke en andre dato) selv når det står tomt.
      const clockWrap = document.createElement('span');
      clockWrap.className = 'time-clock-wrap';
      const clockIcon = document.createElement('span');
      clockIcon.className = 'time-clock-icon';
      clockIcon.setAttribute('aria-hidden', 'true');
      clockIcon.innerHTML = ICONS.clock;
      const timeIn = document.createElement('input');
      timeIn.type = 'time';
      timeIn.className = 'field time-clock';
      timeIn.placeholder = 'tt:mm';
      timeIn.setAttribute('aria-label', 'Klokkeslett (valgfritt)');
      clockWrap.append(clockIcon, timeIn);
      const clearBtn = document.createElement('button');
      clearBtn.type = 'button';
      clearBtn.className = 'icon-btn time-clear';
      clearBtn.textContent = '✕';
      clearBtn.title = 'Fjern tiden';
      clearBtn.setAttribute('aria-label', isDue ? 'Fjern fristen' : 'Fjern starttiden');

      const src = locked ? controller : t0.obj;
      dateIn.value = timeDatePart(src[field]) || '';
      timeIn.value = timeClockPart(src[field]) || '';
      clearBtn.hidden = !src[field];
      if (!canEdit) { dateIn.disabled = true; timeIn.disabled = true; clearBtn.hidden = true; }

      const commit = () => {
        const t = getTarget();
        if (!t || !canEdit) return;
        const v = dateIn.value
          ? (timeIn.value ? dateIn.value + 'T' + timeIn.value.slice(0, 5) : dateIn.value)
          : null;
        clearBtn.hidden = !v;
        if ((t.obj[field] || null) === v) return;
        t.obj[field] = v;
        stampContent(t.obj);
        refreshCard(t.card); // indikator-chipene følger med umiddelbart
        updateNote();
        save();
      };
      dateIn.addEventListener('change', commit);
      timeIn.addEventListener('change', commit);
      clearBtn.addEventListener('click', () => { dateIn.value = ''; timeIn.value = ''; commit(); });
      row.append(label, dateIn, clockWrap, clearBtn);
      return row;
    };

    if (!opts.only || opts.only === 'start') wrap.appendChild(makeRow('start'));
    if (!opts.only || opts.only === 'due') wrap.appendChild(makeRow('due'));

    // Lister og kategorier: lås tidene til elementene (elementene kan da ikke ha
    // egne tider). For en liste gjelder det alle elementer (også de i kategorier);
    // for en kategori bare dens egne.
    if ((isCard || isCat) && !opts.only) {
      const lockLabel = document.createElement('label');
      lockLabel.className = 'time-lock';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = !!t0.obj.lockTimes;
      cb.disabled = !canEdit;
      const txt = document.createElement('span');
      txt.textContent = isCat ? 'Lås tidene til elementene i kategorien' : 'Lås tidene også til elementene i listen';
      lockLabel.append(cb, txt);
      cb.addEventListener('change', () => {
        const t = getTarget();
        if (!t) { cb.checked = !cb.checked; return; }
        t.obj.lockTimes = cb.checked;
        stampContent(t.obj);
        refreshCard(t.card);
        save();
      });
      wrap.appendChild(lockLabel);
    }

    updateNote();
    wrap.appendChild(note);
    return wrap;
  }

  /* ---------------- Tids-popover (fra start-/frist-chipene) ----------------
     Rask redigering av ÉN av tidene — samme skall som bytterne (popover på
     desktop, sentrert modal på mobil). Chip-raden males om fortløpende
     (refreshCard i commit), så ankeret kan forsvinne — panelet blir stående
     der det ble åpnet. */
  const timeSwitcherOverlay = document.getElementById('time-switcher');
  const timeSwitcherPanel = document.getElementById('time-switcher-panel');
  let timeQuickOpen = false;
  function closeTimeQuick() {
    if (!timeQuickOpen) return;
    timeSwitcherOverlay.hidden = true;
    timeQuickOpen = false;
    updateModalOpenClass();
  }
  function openTimeQuick(target, field, anchorBtn) {
    const ctx = { kind: target.kind, id: target.obj.id };
    const getT = () => liveTarget({ kind: ctx.kind, obj: { id: ctx.id } });
    timeSwitcherPanel.innerHTML = '';
    timeSwitcherPanel.style.top = '';
    timeSwitcherPanel.style.left = '';
    const head = document.createElement('div');
    head.className = 'time-panel-title';
    head.innerHTML = field === 'due'
      ? ICONS.calendarDue + '<span>Frist</span>'
      : ICONS.calendar + '<span>Starttid</span>';
    timeSwitcherPanel.append(head, buildTimeEditor(getT, { only: field }));
    timeQuickOpen = true;
    timeSwitcherOverlay.hidden = false;
    updateModalOpenClass();
    if (anchorBtn && anchorBtn.isConnected && window.matchMedia('(min-width: 561px)').matches) {
      positionSwitcherPanel(timeSwitcherPanel, anchorBtn);
    }
    const firstInput = timeSwitcherPanel.querySelector('input:not([disabled])');
    if (firstInput) firstInput.focus();
  }
  timeSwitcherOverlay.addEventListener('click', (ev) => { if (ev.target === timeSwitcherOverlay) closeTimeQuick(); });

  // Univers-søppelkassen (i menyen): vises kun når den har innhold.
  function updateUniversesTrash() { updateTrashBadge(trashedUniverses, uniTrashCount, uniTrashBtn); }

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

    applyChipColor(el, u);
    const uCanEdit = applyShareBadge(el, u).canEdit;
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
    // Mottaker (montert): «slett» = legg mounten i egen søppel (kan forlates ved
    // tømming) — håndteres av setTrashed sin mount-gren.
    bufferDelete(u, 'universe', (x) => setTrashed(x, 'universe', true));
    if (state.activeUniverse === u.id) {
      const first = visibleUniverses()[0]; // ekskluderer nå den buffer-slettede
      setActiveUniverse(first ? first.id : null);
    }
    render(); // univers-søppelkassen blir synlig FØR animasjonen starter
    flyGhost(ghost, uniTrashBtn);
    pushDeleteToast('universe', u.id, u.name);
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
      id: it.id, text: it.text, home: it.home || homeId, cat: it.cat || null,
      isCat: !!it.isCat, lockTimes: !!it.lockTimes,
      trashed: !!it.trashed, done: !!it.done,
      responsible: it.responsible || null,
      start: it.start || null, due: it.due || null,
      ts: it.ts || 0, org: it.org || '',
      pos: it.pos || 0, posTs: it.posTs || 0, posOrg: it.posOrg || '',
    };
  }
  function cleanCard(c) {
    return {
      // Farge synkes ikke: den utledes av posisjon på hver enhet (colorForIndex).
      id: c.id, group: c.group || null, title: c.title, trashed: !!c.trashed,
      k: c.k !== false, p: c.p !== false,
      responsible: c.responsible || null,
      start: c.start || null, due: c.due || null, lockTimes: !!c.lockTimes,
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
  //
  // Går gjennom nøstet state og bygger de fire flate rad-arrayene. `rowFn(obj,
  // type, parent)` gir raden per objekt — `cleanRow` (v1/mergeState) eller
  // `canonRow` (v2/kontomodus). Ett nøstet element har alltid home = kortets id,
  // så `it.home || parent.id` gir samme resultat begge veier.
  function flattenNested(s, rowFn) {
    const universes = [], groups = [], cards = [], items = [];
    (s.universes || []).forEach((u) => {
      universes.push(rowFn(u, 'universe', null));
      (u.groups || []).forEach((g) => {
        groups.push(rowFn(g, 'group', u));
        (g.cards || []).forEach((c) => {
          cards.push(rowFn(c, 'card', g));
          (c.items || []).forEach((it) => items.push(rowFn(it, 'item', c)));
        });
      });
    });
    return { universes, groups, cards, items };
  }
  function cleanRow(o, type, parent) {
    if (type === 'universe') return cleanUniverse(o);
    if (type === 'group') return cleanGroup(Object.assign({}, o, { uni: o.uni || parent.id }));
    if (type === 'card') return cleanCard(Object.assign({}, o, { group: o.group || parent.id }));
    return cleanItem(o, o.home || parent.id);
  }
  function docFromState() {
    return Object.assign(flattenNested(state, cleanRow), {
      tomb: {
        universes: Object.assign({}, state._tomb.universes),
        groups: Object.assign({}, state._tomb.groups),
        cards: Object.assign({}, state._tomb.cards),
        items: Object.assign({}, state._tomb.items),
      },
      hlc: hlc,
    });
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
      reapplyPendingDeletes(); // hold buffer-slettede skjult etter rebuild
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
      isCat: !!content.isCat, lockTimes: !!content.lockTimes, // innhold: kategori-markør + tidslås
      responsible: content.responsible || null,
      start: content.start || null, due: content.due || null,
      ts: content.ts || 0, org: content.org || '',
      // `cat` (kategori-medlemskap) er en forelder-endring → følger posisjonsregisteret, som `home`.
      home: posw.home, cat: posw.cat || null, pos: posw.pos || 0, posTs: posw.posTs || 0, posOrg: posw.posOrg || '',
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
      responsible: content.responsible || null,
      start: content.start || null, due: content.due || null, lockTimes: !!content.lockTimes,
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
    // Fokusert «legg til element»-felt regnes som aktiv redigering selv når det er
    // TOMT — ellers river neste synk-runde ned board-et og stjeler fokuset før man
    // rekker å skrive noe.
    if (ae && ae.classList && ae.classList.contains('add-item-input')) return true;
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
  // opts.sticky: ikke auto-skjul — kalleren styrer skjuling selv (samle-toasten
  // for slettinger, der en felles timer styrer både commit og skjuling).
  function showToast(msg, action, opts) {
    opts = opts || {};
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
      btn.addEventListener('click', () => { action.fn(); });
      t.appendChild(btn);
    }
    t.classList.add('show');
    clearTimeout(toastTimer);
    if (!opts.sticky) toastTimer = setTimeout(() => t.classList.remove('show'), action ? 5000 : 2200);
  }
  function hideToast() {
    const t = document.getElementById('toast');
    if (t) t.classList.remove('show');
    clearTimeout(toastTimer);
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

  let authUser = null;         // innlogget bruker { id, email, meta } | null
  let aclient = null;          // backend-klient (Supabase eller mock)
  function acli() {
    if (aclient) return aclient;
    if (useMock() && window.HK_MOCK) { aclient = window.HK_MOCK.createClient(); return aclient; }
    aclient = ensureClient();
    return aclient;
  }

  /* ---------------- Aktiv posisjon (univers/gruppe) på kontoen ----------------
     Hvilket univers og hvilken gruppe man står i huskes på selve brukerkontoen
     (Supabase Auth user_metadata) — så man lander på samme sted når appen lastes
     på nytt, også på tvers av enheter. Gjelder kun kontomodus (uten konto finnes
     ingen konto å lagre på; da holder den gamle per-enhet-oppførselen). Skrives
     debouncet ved navigering, gjenopprettes ved første sky-pull etter innlogging.
     `authUser.meta.nav` = sist BEKREFTET skrevet posisjon; `navPending` = ønsket
     posisjon som ennå ikke er bekreftet. Vi markerer først som lagret når skrivingen
     lykkes, og prøver igjen ved feil — så en forbigående offline/rate-limit-feil ikke
     låser posisjonen ute permanent. */
  let navSaveTimer = null;
  let navRestored = false;
  let navPending = null;
  const navEq = (a, b) => !!a && !!b && a.u === b.u && a.g === b.g;
  function saveNavPref() {
    if (!accountsMode() || !authUser || applyingRemote || !navRestored) return;
    const nav = { u: state.activeUniverse || null, g: state.activeGroup || null };
    if (navEq(nav, authUser.meta && authUser.meta.nav) && !navPending) return; // allerede lagret
    if (navEq(nav, navPending)) return; // allerede planlagt
    navPending = nav;
    clearTimeout(navSaveTimer);
    navSaveTimer = setTimeout(flushNavPref, 800);
  }
  async function flushNavPref() {
    const nav = navPending;
    if (!nav) return;
    const client = acli();
    if (!client || !authUser) return;
    try {
      const { error } = await client.auth.updateUser({ data: { nav } });
      if (error) throw error;
      authUser.meta = Object.assign({}, authUser.meta, { nav }); // marker lagret KUN ved suksess
      if (navEq(navPending, nav)) navPending = null; // (ellers kom en nyere posisjon → la timeren ta den)
    } catch (e) {
      clearTimeout(navSaveTimer);
      navSaveTimer = setTimeout(flushNavPref, 5000); // behold navPending, prøv igjen senere
    }
  }
  // Sett aktivt univers/gruppe fra kontoens husket posisjon (hvis den fremdeles
  // peker på synlige entiteter). Kalles én gang, ved første sky-pull.
  function restoreNavPref() {
    const nav = authUser && authUser.meta && authUser.meta.nav;
    if (!nav || !nav.u) return;
    const uni = state.universes.find((u) => u.id === nav.u && !u.trashed && !u._pendingDelete);
    if (!uni) return;
    state.activeUniverse = uni.id;
    const vis = uni.groups.filter((g) => !g.trashed && !g._pendingDelete).sort(posCmp);
    const grp = vis.find((g) => g.id === nav.g);
    state.activeGroup = grp ? grp.id : (vis[0] ? vis[0].id : null);
    state.activeGroups[uni.id] = state.activeGroup;
  }

  /* ---------------- Auth-UI (registrering/innlogging/glemt) ---------------- */
  const authScreen = document.getElementById('auth-screen');
  const authForm = document.getElementById('auth-form');
  const authHeading = document.getElementById('auth-heading');
  const authHeadingIcon = document.getElementById('auth-heading-icon');
  const authEmail = document.getElementById('auth-email');
  const authNameFields = document.getElementById('auth-name-fields');
  const authFirstName = document.getElementById('auth-first-name');
  const authLastName = document.getElementById('auth-last-name');
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
    // Navnefeltene (fornavn/etternavn) vises kun ved registrering.
    const reg = mode === 'register';
    authNameFields.hidden = !reg;
    authFirstName.required = reg;
    authLastName.required = reg;
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
        const firstName = authFirstName.value.trim();
        const lastName = authLastName.value.trim();
        if (!firstName || !lastName) { authMsg('Skriv inn både fornavn og etternavn.'); return; }
        const displayName = firstName + ' ' + lastName;
        const { data, error } = await client.auth.signUp({
          email, password,
          options: {
            emailRedirectTo: location.origin + location.pathname,
            data: { display_name: displayName },
          },
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
  // Optimistisk forlatte delinger (leave_share i kø, se suppressedRows): filtrer
  // bort share-roten OG alt under den fra fjern-doc'et til operasjonen har
  // landet. Uten dette ville reconcile enten gjenopplivet raden lokalt (flimmer)
  // eller — for undertreet, som også er fjernet lokalt men fortsatt finnes i
  // basen — pushet delete på EIERENS rader.
  function suppressedSetsFor(my) {
    const supU = new Set(), supG = new Set(), supC = new Set();
    (my.universes || []).forEach((u) => { if (suppressedRows.has(u.id)) supU.add(u.id); });
    (my.groups || []).forEach((g) => { if (suppressedRows.has(g.id) || supU.has(g.uni)) supG.add(g.id); });
    (my.cards || []).forEach((c) => { if (suppressedRows.has(c.id) || supG.has(c.group)) supC.add(c.id); });
    return { supU, supG, supC };
  }
  function contentDocFromMy(my) {
    const { supU, supG, supC } = suppressedSetsFor(my);
    let maxTs = 0;
    const bump = (r) => { maxTs = Math.max(maxTs, r.ts || 0, r.posTs || 0, r.labTs || 0); };
    const universes = (my.universes || []).filter((u) => !supU.has(u.id)).map((u) => { const r = cleanUniverse(u); bump(r); return r; });
    const groups = (my.groups || []).filter((g) => !supG.has(g.id)).map((g) => { const r = cleanGroup(g); bump(r); return r; });
    const cards = (my.cards || []).filter((c) => !supC.has(c.id)).map((c) => { const r = cleanCard(c); bump(r); return r; });
    const items = (my.items || []).filter((it) => !supC.has(it.home)).map((it) => { const r = cleanItem(it, it.home); bump(r); return r; });
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
        responsible: o.responsible || null,
        start: o.start || null, due: o.due || null, lockTimes: !!o.lockTimes,
        labTs: o.labTs || 0, labOrg: o.labOrg || '',
      });
    }
    if (type === 'universe') return cleanUniverse(o);
    if (type === 'group') return cleanGroup(o);
    if (type === 'card') return cleanCard(o);
    return cleanItem(o, o.home);
  }
  function docFromMyState() {
    // canonRow(o, type) ignorerer parent-argumentet flattenNested sender med;
    // element-grenen gir cleanItem(it, it.home) som før.
    return flattenNested(state, canonRow);
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
        // Optimistiske overlays: en køet set_locked/membership-patch skal ikke
        // visuelt «hoppe tilbake» hvis en pull rekker å kjøre før den lander.
        obj._locked = lockOverrides.has(id) ? !!lockOverrides.get(id) : (m ? m.locked : false);
        obj._shared = m ? m.shared : false;
        obj._mount = m && m.mount ? Object.assign({}, m.mount, mountOverrides.get(id) || null) : null;
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
      // Første pull etter innlogging: land på posisjonen kontoen husker.
      if (!navRestored) { navRestored = true; restoreNavPref(); }
      reapplyPendingDeletes(); // hold buffer-slettede skjult etter rebuild
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
      k: row.k !== false, p: row.p !== false, lab_ts: row.labTs || 0, lab_org: row.labOrg || '',
      responsible: row.responsible || null,
      start_at: row.start || null, due_at: row.due || null, lock_times: !!row.lockTimes });
    return Object.assign(base, { text: row.text || '', card_id: row.home, cat_id: row.cat || null,
      is_cat: !!row.isCat, lock_times: !!row.lockTimes, done: !!row.done,
      responsible: row.responsible || null,
      start_at: row.start || null, due_at: row.due || null });
  }
  function updatePayload(t, row) {
    const base = { trashed: !!row.trashed, ts: row.ts || 0, org: row.org || '',
      pos: row.pos || 0, pos_ts: row.posTs || 0, pos_org: row.posOrg || '' };
    if (t === 'universe') return Object.assign(base, { name: row.name || '' });
    if (t === 'group') return Object.assign(base, { name: row.name || '', universe_id: row.uni });
    if (t === 'card') return Object.assign(base, { title: row.title || '', group_id: row.group,
      k: row.k !== false, p: row.p !== false, lab_ts: row.labTs || 0, lab_org: row.labOrg || '',
      responsible: row.responsible || null,
      start_at: row.start || null, due_at: row.due || null, lock_times: !!row.lockTimes });
    return Object.assign(base, { text: row.text || '', card_id: row.home, cat_id: row.cat || null,
      is_cat: !!row.isCat, lock_times: !!row.lockTimes, done: !!row.done,
      responsible: row.responsible || null,
      start_at: row.start || null, due_at: row.due || null });
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

  /* ---------------- Bakgrunns-operasjonskø (RPC-operasjoner) ----------------
     Delings-operasjonene (inviter/lås/kast ut/forlat/godta + mount-skrivinger)
     går ikke gjennom doc-synken, og ventet tidligere i UI-et (deaktiverte
     knapper/spinnere) til de hadde landet. Nå utføres de optimistisk i UI-et og
     legges i ÉN seriell kø i bakgrunnen: neste operasjon starter først når
     forrige er ferdig, så to skrivinger på samme rad aldri kan lande i feil
     rekkefølge — uansett hvor fort brukeren klikker.

       • `key` + `merge`: en operasjon med samme nøkkel som en som VENTER i køen
         koalesceres inn i den (siste tilstand vinner — lås-spam og gjentatte
         mount-flytt blir én skriving). En kjørende operasjon røres ikke.
       • Nettverksfeil (offline): operasjonen legges fremst igjen og prøves på
         nytt med backoff (rekkefølgen bevares); `online`-hendelsen napper køen
         i gang straks.
       • Serveravvisning: operasjonens `onError` ruller UI-et tilbake (resynk/
         fjern optimistisk rad) + viser feilen — samme sluttilstand som om
         operasjonen aldri var mulig.
       • `op.value` settes til run()-resultatet, så en senere køet operasjon kan
         kjede på det (f.eks. «trekk tilbake» som venter på invitasjons-id-en
         fra en «inviter» lenger frem i køen).
       • `waitFor`: en forutsetning som må være sann før operasjonen starter —
         køen venter (og prøver jevnlig) i stedet for å kjøre for tidlig. Brukes
         av operasjoner som avhenger av at doc-synken har fått pushet en rad
         først (f.eks. «del en nettopp opprettet liste»: invitasjonen ligger i
         kø til kort-raden finnes på serveren). Gir opp med onError etter en
         romslig frist, så en rad som aldri dukker opp ikke låser køen evig.
     Optimistisk lokal visning holdes stabil over synk-rebuilds med overlayene
     under (lockOverrides/mountOverrides/suppressedRows) til operasjonen har
     landet — se applyMyDoc/contentDocFromMy. */
  const opQueue = (() => {
    const queue = [];
    let running = null;
    let retryTimer = null;
    let retryDelay = 1000;
    // Epoke: bumpes av clear() (utlogging). En operasjon som var I LUFTA da
    // køen ble tømt, kan ikke avbrytes — men resultatet forkastes når den
    // lander (ingen callbacks, ingen retry), så arbeid fra en gammel sesjon
    // aldri kjører videre under en ny konto.
    let epoch = 0;
    const WAIT_POLL_MS = 400;
    const WAIT_MAX_POLLS = 150; // ≈ 60 s

    function isNetworkErr(e) {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
      const m = String((e && e.message) || e || '');
      return /failed to fetch|networkerror|network request failed|load failed|fetch failed/i.test(m);
    }
    function hasPending(key) {
      return (running && running.key === key) || queue.some((o) => o.key === key);
    }
    async function pump() {
      if (running || !queue.length) return;
      // Forutsetning ikke oppfylt ennå → la operasjonen bli stående fremst og
      // prøv igjen om litt (rekkefølgen bevares).
      const head = queue[0];
      if (head.waitFor && !head.waitFor()) {
        head._waited = (head._waited || 0) + 1;
        if (head._waited <= WAIT_MAX_POLLS) {
          clearTimeout(retryTimer);
          retryTimer = setTimeout(pump, WAIT_POLL_MS);
          return;
        }
        queue.shift();
        try { if (head.onError) head.onError(new Error('Endringen er ikke lagret i skyen ennå — prøv igjen')); }
        catch (e) { /* callback-feil skal ikke stoppe køen */ }
        pump();
        return;
      }
      const op = running = queue.shift();
      let value, err = null;
      try { value = await op.run(); }
      catch (e) { err = e; }
      running = null;
      if (op._epoch !== epoch) { pump(); return; } // køen ble tømt (utlogging) mens den var i lufta → forkast
      if (err && isNetworkErr(err)) {
        // Offline/nett-glipp: behold rekkefølgen (fremst igjen) og prøv senere.
        queue.unshift(op);
        clearTimeout(retryTimer);
        retryTimer = setTimeout(pump, retryDelay);
        retryDelay = Math.min(retryDelay * 2, 15000);
        return;
      }
      retryDelay = 1000;
      op.value = value;
      try {
        if (err) { if (op.onError) op.onError(err); }
        else if (op.onDone) op.onDone(value);
      } catch (e) { /* callback-feil skal ikke stoppe køen */ }
      pump();
    }
    function enqueue(op) {
      op._epoch = epoch;
      if (op.key) {
        const dup = queue.find((o) => o.key === op.key);
        if (dup) {
          if (dup.merge) dup.merge(op);
          else { dup.run = op.run; dup.onDone = op.onDone; dup.onError = op.onError; }
          return dup;
        }
      }
      queue.push(op);
      pump();
      return op;
    }
    // Kontrollert avbrudd: fjerner en operasjon som ennå ikke har startet.
    function cancel(op) {
      const i = queue.indexOf(op);
      if (i > -1) { queue.splice(i, 1); return true; }
      return false;
    }
    function clear() {
      epoch++; // forkaster også en ev. operasjon som er i lufta akkurat nå
      queue.length = 0;
      clearTimeout(retryTimer);
      retryDelay = 1000;
    }
    window.addEventListener('online', () => { clearTimeout(retryTimer); retryDelay = 1000; pump(); });
    return { enqueue, cancel, clear, hasPending };
  })();

  /* ---------------- Optimistiske overlays (til operasjonen har landet) ----------------
     applyMyDoc bygger state fra SERVERENS metadata hver synk-runde; uten
     overlayene ville en optimistisk endring visuelt hoppet tilbake hvis en pull
     rakk å kjøre før den køede skrivingen landet. Ryddes av operasjonens
     onDone/onError (når køen ikke har flere operasjoner for samme nøkkel). */
  const lockOverrides = new Map();  // id → ønsket locked-verdi (set_locked i kø)
  const mountOverrides = new Map(); // id → { pos?, trashed?, parent? } (membership-patch i kø)
  const suppressedRows = new Set(); // share-rot-id-er fjernet lokalt (leave_share i kø)

  // Er raden (share-roten) kjent på serveren ennå? Delings-RPC-er mot et NYTT
  // objekt (inviter/lås rett etter opprettelse) må vente i køen til doc-synken
  // har fått pushet raden — ellers avviser serveren dem («finnes ikke»).
  // lastMy er forrige pull; cloudCycle kjører en bekreftelses-pull etter hver
  // push, så ventetiden er kort.
  function rowKnownToServer(id) {
    if (!lastMy) return false;
    const has = (list) => (list || []).some((r) => r.id === id);
    return has(lastMy.universes) || has(lastMy.groups) || has(lastMy.cards);
  }

  /* ---------------- Mount-skrivinger (membership) ---------------- */
  // Patch-kolonner → overlay-felt (samme fasong som meta.mount i applyMyDoc).
  function mountOverrideFrom(patch) {
    const o = {};
    if ('pos' in patch) o.pos = patch.pos;
    if ('trashed' in patch) o.trashed = patch.trashed;
    if ('parent_universe_id' in patch) o.parent = patch.parent_universe_id;
    if ('parent_group_id' in patch) o.parent = patch.parent_group_id;
    return o;
  }
  function cloudMountUpdate(type, id, patch) {
    mountOverrides.set(id, Object.assign(mountOverrides.get(id) || {}, mountOverrideFrom(patch)));
    const key = 'mount:' + id;
    const col = type === 'universe' ? 'universe_id' : type === 'group' ? 'group_id' : 'card_id';
    const op = {
      key,
      patch: Object.assign({}, patch),
      merge: (next) => { Object.assign(op.patch, next.patch); },
      run: async () => {
        const client = acli();
        if (!client || !authUser) return;
        const { error } = await client.from('memberships').update(op.patch)
          .eq('user_id', authUser.id).eq(col, id);
        if (error) throw error;
      },
      onDone: () => {
        if (!opQueue.hasPending(key)) { mountOverrides.delete(id); scheduleCloud(0); }
      },
      onError: () => {
        mountOverrides.delete(id);
        showToast('Kunne ikke lagre endringen av delt innhold');
        scheduleCloud(0); // server-sannheten gjenoppretter visningen
      },
    };
    opQueue.enqueue(op);
  }
  // Forlat en deling: share-roten er allerede fjernet lokalt (optimistisk);
  // undertrykkes fra pull-ene til leave har landet, så den verken gjenoppstår
  // lokalt eller (verre) får reconcile til å pushe delete på eierens rader.
  function cloudLeave(type, id) {
    suppressedRows.add(id);
    const key = 'leave:' + type + ':' + id;
    if (opQueue.hasPending(key)) return;
    opQueue.enqueue({
      key,
      run: async () => {
        const client = acli();
        if (!client || !authUser) return;
        const { error } = await client.rpc('leave_share', { p_type: type, p_id: id });
        if (error) throw error;
      },
      onDone: () => { suppressedRows.delete(id); scheduleCloud(0); },
      onError: (e) => {
        suppressedRows.delete(id);
        showToast(friendlyAuthError(e));
        scheduleCloud(0); // objektet kommer tilbake fra serveren hvis vi fortsatt er medlem
      },
    });
  }
  // Fjern en montert share-rot fra det lokale treet (optimistisk «forlat» fra
  // del-modalen — motstykket til splice-ene i emptyXTrash-stiene).
  function removeMountLocally(id) {
    const f = findAnyById(id);
    if (!f) return;
    const arr = f.kind === 'universe' ? state.universes
      : f.kind === 'group' ? (f.obj._parent ? f.obj._parent.groups : null)
      : f.obj._parent ? f.obj._parent.cards : null;
    if (!arr) return;
    const i = arr.indexOf(f.obj);
    if (i > -1) arr.splice(i, 1);
    validateActive(state); // delingen kan ha vært aktivt univers/gruppe
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
      // Bruk fletteresultatet lokalt — men ikke avbryt aktiv redigering/draging.
      // Planlegg et raskt nytt forsøk KUN når det faktisk er en utsatt endring
      // (merged ≠ lokal); ellers ville et fokusert (tomt) felt hot-loope get_my_doc.
      if (!isBusyEditing()) applyMyDoc(merged, meta);
      else if (canonical(merged) !== canonical(local)) cloudAgain = true;
      if (ops.length) {
        await pushOps(ops);
        // Bekreftelses-pull straks etter push: lastMy/metadata friskes opp, så
        // køede operasjoner som venter på en nypushet rad (rowKnownToServer)
        // slipper å vente på neste poll. Løper ikke løpsk: neste runde ser
        // remote == lokal → ingen nye ops → ingen ny runde.
        cloudAgain = true;
      }
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
    return flattenNested(s, cleanRow);
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
    const invites = ((my && my.invites_in) || []).filter((inv) => !suppressedInvites.has(inv.id));
    const placements = pendingPlacements || [];
    const total = invites.length + placements.length;
    menuBadge.textContent = String(total);
    menuBadge.hidden = total === 0;
    if (authUser) {
      menuAccount.hidden = false;
      const prof = (my && my.user) || {};
      accountEmail.textContent = personName(prof) || authUser.email || '';
      accountAvatar.textContent = initialsFromName(prof.display_name, authUser.email);
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

  // Optimistisk besvarte invitasjoner (svar-RPC-en ligger i køen): raden holdes
  // ute av innboksen så en synk-pull ikke gjenoppliver den før svaret har landet.
  const suppressedInvites = new Set();
  function acceptInvite(inv) {
    askPlacement(inv.type, inv.name, (parent) => {
      // Optimistisk: raden forsvinner straks; selve aksepten ligger i køen.
      // Innholdet dukker opp når neste pull ser det nye medlemskapet.
      suppressedInvites.add(inv.id);
      updateInbox(lastMy);
      showToast('Deling godtatt');
      opQueue.enqueue({
        run: async () => {
          const { error } = await acli().rpc('accept_share_invite',
            { p_invite: inv.id, p_parent: parent, p_pos: Date.now() });
          if (error) throw error;
        },
        onDone: () => {
          suppressedInvites.delete(inv.id);
          cloudBase = null;
          scheduleCloud(0);
        },
        onError: (e) => {
          suppressedInvites.delete(inv.id);
          updateInbox(lastMy); // raden kommer tilbake
          showToast(friendlyAuthError(e));
        },
      });
    });
  }
  function declineInvite(inv) {
    suppressedInvites.add(inv.id);
    updateInbox(lastMy);
    opQueue.enqueue({
      run: async () => {
        const { error } = await acli().rpc('decline_share_invite', { p_invite: inv.id });
        if (error) throw error;
      },
      onDone: () => { suppressedInvites.delete(inv.id); scheduleCloud(0); },
      onError: (e) => {
        suppressedInvites.delete(inv.id);
        updateInbox(lastMy);
        showToast(friendlyAuthError(e));
      },
    });
  }
  function placeMount(pl) {
    askPlacement(pl.type, pl.name, (parent) => {
      // Optimistisk: raden forsvinner straks; mount-patchen ligger i køen, og
      // mount-overlayet gjør at neste pull monterer objektet lokalt også før
      // patchen har landet.
      const patch = pl.type === 'group'
        ? { parent_universe_id: parent } : { parent_group_id: parent };
      cloudMountUpdate(pl.type, pl.id, patch);
      pendingPlacements = pendingPlacements.filter((p) => p.id !== pl.id);
      updateInbox(lastMy);
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
  function openShare(type, id, obj) {
    shareCtx = { type, id, obj };
    shareTitle.innerHTML = ICONS[SHARE_TYPE_ICON[type]] || '';
    shareTitle.appendChild(document.createTextNode(
      (obj.name || obj.title || '') + ' — Innstillinger for deling'));
    shareModal.hidden = false;
    updateModalOpenClass2();
    // Åpne UMIDDELBART — eierskapet (_mine) kjenner vi synkront, så riktig
    // visning tegnes med en gang. Medlemslisten/eier-informasjonen hentes i
    // bakgrunnen og fylles inn når den lander (se renderShareOwner/-Recipient).
    if (obj._mine === false) renderShareRecipient(type, id, obj, shareBody, closeShare);
    else renderShareOwner(type, id, obj, shareBody);
  }

  // Avatar for en person i del-modalen: rund sirkel med initialer (navn hvis
  // satt, ellers e-post). Eieren beholder den grønne markeringen; øvrige den
  // nøytrale grå. Navn/e-post vises som tekst ved siden av (kallstedet).
  function avatarFor(person, owner) {
    const s = document.createElement('span');
    s.className = 'member-avatar' + (owner ? ' owner' : '');
    s.textContent = initialsFromName(person && person.display_name, person && person.email);
    return s;
  }
  // Eieren selv, fra kontoens egne data — så medlemslisten kan tegnes UMIDDELBART
  // (uten å vente på get_members); medlemmer/ventende invitasjoner fylles inn
  // når hentingen lander.
  function myOwnerInfo() {
    const prof = (lastMy && lastMy.user) || {};
    return {
      owner: {
        id: authUser && authUser.id,
        email: prof.email || (authUser && authUser.email),
        display_name: prof.display_name || (authUser && authUser.meta && authUser.meta.display_name),
      },
      members: [], pending_invites: [],
    };
  }
  // Tegner eier-visningen inn i `body` — brukes både av del-modalen (univers/
  // gruppe) og av listers innstillingsmodal (deling-seksjonen).
  function renderShareOwner(type, id, obj, body) {
    body.innerHTML = '';
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
    // Optimistiske «Venter på svar»-rader (invitasjoner som ligger i køen):
    // renderMembers tegner medlemslisten fra serverens svar og henger disse på
    // etterpå, så en oppdatering for én invitasjon ikke sluker en annen som
    // fortsatt er underveis.
    const optimisticRows = new Set();

    function renderMembers(inf) {
      membersWrap.innerHTML = '';
      if (inf.owner) {
        const row = document.createElement('div');
        row.className = 'member-row';
        const box = document.createElement('div'); box.className = 'member-info';
        box.innerHTML = '<span class="member-name"></span><span class="member-role">Eier (deg)</span>';
        box.querySelector('.member-name').textContent = personName(inf.owner);
        row.append(avatarFor(inf.owner, true), box);
        membersWrap.appendChild(row);
      }
      (inf.members || []).forEach((mbr) => {
        const row = document.createElement('div');
        row.className = 'member-row';
        const box = document.createElement('div'); box.className = 'member-info';
        box.innerHTML = '<span class="member-name"></span><span class="member-role">Medlem</span>';
        box.querySelector('.member-name').textContent = personName(mbr);
        const kick = document.createElement('button');
        kick.className = 'btn btn-solid btn-red btn-small'; kick.type = 'button'; kick.textContent = 'Kast ut';
        kick.addEventListener('click', async () => {
          if (!await askConfirm({ title: 'Kaste ut', message: 'Fjerne ' + mbr.email + ' fra delingen?', okLabel: 'Kast ut' })) return;
          row.remove(); // optimistisk — refreshMembers gjenoppretter hvis serveren avviser
          opQueue.enqueue({
            run: async () => {
              const { error } = await acli().rpc('revoke_share', { p_type: type, p_id: id, p_user: mbr.id });
              if (error) throw error;
            },
            onDone: () => { refreshMembers(); scheduleCloud(0); },
            onError: (e) => { showToast(friendlyAuthError(e)); refreshMembers(); },
          });
        });
        row.append(avatarFor(mbr, false), box, kick);
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
        cancel.addEventListener('click', () => {
          row.remove(); // optimistisk
          opQueue.enqueue({
            run: async () => {
              const { error } = await acli().rpc('revoke_share_invite', { p_invite: inv.id });
              if (error) throw error;
            },
            onDone: refreshMembers,
            onError: (e) => { showToast(friendlyAuthError(e)); refreshMembers(); },
          });
        });
        row.append(avatarFor({ email: inv.email }, false), box, cancel);
        membersWrap.appendChild(row);
      });
      optimisticRows.forEach((r) => membersWrap.appendChild(r));
    }
    async function refreshMembers() {
      try {
        const { data } = await acli().rpc('get_members', { p_type: type, p_id: id });
        if (data) renderMembers(data);
      } catch (e) { /* behold forrige */ }
    }

    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const email = input.value.trim().toLowerCase();
      if (!email) return;
      input.value = '';
      msg.textContent = ''; msg.classList.remove('ok');
      // Optimistisk: raden vises straks, feltet er klart for neste e-post —
      // selve invitasjonen ligger i køen (flere invitasjoner køes etter hverandre).
      const row = document.createElement('div');
      row.className = 'member-row member-pending';
      const box = document.createElement('div'); box.className = 'member-info';
      box.innerHTML = '<span class="member-name"></span><span class="member-role">Venter på svar</span>';
      box.querySelector('.member-name').textContent = email;
      const cancel = document.createElement('button');
      cancel.className = 'btn btn-small btn-ghost'; cancel.type = 'button'; cancel.textContent = 'Trekk tilbake';
      row.append(avatarFor({ email }, false), box, cancel);
      optimisticRows.add(row);
      membersWrap.appendChild(row);
      const op = opQueue.enqueue({
        waitFor: () => rowKnownToServer(id), // et nyopprettet objekt må først være pushet
        run: async () => {
          const { data, error } = await acli().rpc('create_share_invite',
            { p_type: type, p_id: id, p_email: email });
          if (error) throw error;
          return data;
        },
        onDone: () => {
          // La raden stå til refreshMembers tegner den ekte (ingen blink-lucke).
          optimisticRows.delete(row);
          msg.textContent = 'Invitasjon sendt til ' + email; msg.classList.add('ok');
          refreshMembers();
        },
        onError: (e) => {
          optimisticRows.delete(row);
          row.remove();
          msg.textContent = friendlyAuthError(e);
        },
      });
      // «Trekk tilbake» på en optimistisk rad: avbryt kontrollert — fjernes fra
      // køen hvis opprettelsen ikke har startet; ellers køes en tilbaketrekking
      // som (pga. seriell kø) først kjører når opprettelsen har landet, og
      // bruker invitasjons-id-en fra dens resultat.
      cancel.addEventListener('click', () => {
        optimisticRows.delete(row);
        row.remove();
        if (opQueue.cancel(op)) return;
        opQueue.enqueue({
          run: async () => {
            const inv = op.value;
            if (!inv || !inv.id) return; // opprettelsen feilet → ingenting å trekke tilbake
            const { error } = await acli().rpc('revoke_share_invite', { p_invite: inv.id });
            if (error) throw error;
          },
          onDone: refreshMembers,
          onError: (e) => { showToast(friendlyAuthError(e)); refreshMembers(); },
        });
      });
    });
    lockBtn.addEventListener('click', () => {
      // Optimistisk: statusen vender straks (lockOverrides holder den stabil
      // over synk-rebuilds); koalescert kø-skriving gjør rask av/på-veksling
      // til én skriving med sluttilstanden.
      obj._locked = !obj._locked;
      lockOverrides.set(id, obj._locked);
      paintLock();
      const key = 'lock:' + type + ':' + id;
      opQueue.enqueue({
        key,
        waitFor: () => rowKnownToServer(id), // et nyopprettet objekt må først være pushet
        run: async () => {
          const want = lockOverrides.has(id) ? lockOverrides.get(id) : obj._locked;
          const { error } = await acli().rpc('set_locked', { p_type: type, p_id: id, p_locked: want });
          if (error) throw error;
        },
        onDone: () => {
          if (!opQueue.hasPending(key)) { lockOverrides.delete(id); scheduleCloud(0); }
        },
        onError: (e) => {
          lockOverrides.delete(id);
          obj._locked = !obj._locked;
          if (lockBtn.isConnected) paintLock(); // visningen kan ha byttet objekt
          showToast(friendlyAuthError(e));
          scheduleCloud(0); // server-sannheten gjenoppretter visningen
        },
      });
    });

    body.append(form, msg, title, membersWrap, lockRow);
    renderMembers(myOwnerInfo()); // eieren (deg) vises straks
    refreshMembers();             // medlemmer/ventende fylles inn når de lander
  }
  // Mottaker-visningen («Delt av …» + Forlat deling) inn i `body`; closeFn
  // lukker den omsluttende modalen (del-modalen eller innstillingsmodalen).
  function renderShareRecipient(type, id, obj, body, closeFn) {
    body.innerHTML = '';
    const line = document.createElement('div');
    line.className = 'owner-line';
    const ownerPerson = { display_name: obj._ownerName, email: obj._ownerEmail };
    line.append(avatarFor(ownerPerson, true));
    const inf = document.createElement('div'); inf.className = 'member-info';
    const ownerLabel = personName(ownerPerson);
    inf.innerHTML = '<span class="member-name"></span>' +
      '<span class="member-role">' + (obj._locked ? 'Skrivebeskyttet' : 'Du kan redigere') + '</span>';
    inf.querySelector('.member-name').textContent = ownerLabel ? ('Delt av ' + ownerLabel) : 'Delt med deg';
    line.appendChild(inf);
    body.appendChild(line);
    const leave = document.createElement('button');
    leave.className = 'btn btn-solid btn-red share-leave'; leave.type = 'button'; leave.textContent = 'Forlat deling';
    leave.addEventListener('click', async () => {
      if (!await askConfirm({ title: 'Forlat deling', message: 'Forlate denne delingen? Den forsvinner fra dine lister.', okLabel: 'Forlat' })) return;
      closeFn();
      // Optimistisk: delingen forsvinner fra treet straks; leave_share ligger i
      // køen (cloudLeave undertrykker raden fra pull-ene til den har landet).
      removeMountLocally(id);
      cloudLeave(type, id);
      render();
      save();
    });
    body.appendChild(leave);
    // Eier-navnet hentes i bakgrunnen første gang (og huskes på objektet);
    // visningen over er komplett uten det («Delt med deg»). Tegn kun på nytt
    // hvis akkurat denne visningen fortsatt står i DOM-en.
    if (!obj._ownerName && !obj._ownerEmail) {
      acli().rpc('get_members', { p_type: type, p_id: id }).then(({ data }) => {
        if (!data || !data.owner) return;
        obj._ownerEmail = data.owner.email;
        obj._ownerName = data.owner.display_name;
        if (line.isConnected) renderShareRecipient(type, id, obj, body, closeFn);
      }).catch(() => { /* behold «Delt med deg» */ });
    }
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
    navRestored = false; // gjenopprett husket posisjon ved neste (første) pull
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
    shareGroupCache.clear(); shareGroupLoading.clear();
    // Køede operasjoner tilhører den utloggede sesjonen — dropp dem (de ville
    // uansett blitt avvist uten sesjon) og nullstill de optimistiske overlayene.
    opQueue.clear();
    lockOverrides.clear(); mountOverrides.clear(); suppressedRows.clear();
    suppressedInvites.clear();
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
        authUser = { id: user.id, email: user.email, meta: user.user_metadata || {} };
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
      if (user && !authUser) { authUser = { id: user.id, email: user.email, meta: user.user_metadata || {} }; cloudStart(); }
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
    openShare, openSettings,
    get authUser() { return authUser; },
    get lastMy() { return lastMy; },
    get pendingPlacements() { return pendingPlacements; },
  };
})();
