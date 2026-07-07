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

  // Varm palett i oker-/jordtoner. Header og aksent utledes ved å mørkne bakgrunnen.
  const PALETTE = [
    '#F3D6A2', '#EBCB77', '#D8B45A', '#C99A53', '#E7A96B',
    '#D9875F', '#C9775A', '#E3B39A', '#D6A181', '#BFA36A',
    '#AFC17A', '#96B36E', '#B9C9A3', '#D6C7A1', '#E7D6B5',
    '#C6B089', '#B58D6A', '#D1A85F', '#E2C46F', '#C7A35A',
  ];
  const PALETTE_SET = new Set(PALETTE.map((c) => c.toLowerCase()));

  /* ---------------- Hjelpere ---------------- */
  const uid = () =>
    'id-' + Math.random().toString(36).slice(2, 9) + Math.random().toString(36).slice(2, 5);

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

  function randomColor(avoid) {
    let c = PALETTE[Math.floor(Math.random() * PALETTE.length)];
    if (avoid && PALETTE.length > 1) {
      let guard = 0;
      while (c === avoid && guard++ < 10) c = PALETTE[Math.floor(Math.random() * PALETTE.length)];
    }
    return c;
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
  function stampLabel(e) { e.labTs = tick(); e.labOrg = deviceId; } // merkelapper k/p (eget register)

  // Deterministisk palett-farge fra kort-id (samme farge på alle enheter, så en
  // fargemigrering ikke gir synk-flimmer). Brukes til å gi eldre kort høstfarger.
  function paletteColorForId(id) {
    const s = String(id);
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) >>> 0;
    return PALETTE[h % PALETTE.length];
  }
  // Engangs-migrering: gi kort som fortsatt har en farge utenfor den nye paletten
  // en ny (deterministisk) høstfarge, og stemple innholdsregisteret så den synkes.
  // Idempotent — kort som allerede har palett-farge røres ikke. Returnerer antall endret.
  function recolorOldCards(cards) {
    let n = 0;
    (cards || []).forEach((c) => {
      if (!c.color || !PALETTE_SET.has(String(c.color).toLowerCase())) {
        c.color = paletteColorForId(c.id);
        stampContent(c);
        n++;
      }
    });
    return n;
  }

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

  /* ---------------- State ---------------- */
  function makeItem(text, homeId) {
    return {
      id: uid(), text, home: homeId,
      ts: 0, org: deviceId,           // innholdsregister (tekst)
      pos: 0, posTs: 0, posOrg: deviceId, // posisjonsregister (rekkefølge/forelder)
    };
  }

  let lastColor = null;
  function card(title, items, groupId) {
    const color = randomColor(lastColor);
    lastColor = color;
    const id = uid();
    const c = {
      id, group: groupId || null, title, color, trashed: false, k: true, p: true,
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

  // En gruppe er øverste nivå (Gruppe > Liste > Element). Den har innholds-
  // register (navn) og posisjonsregister (rekkefølge), og eier sine lister.
  function makeGroup(name, id) {
    return {
      id: id || uid(), name,
      ts: 0, org: deviceId,               // innholdsregister (navn)
      pos: 0, posTs: 0, posOrg: deviceId, // posisjonsregister (rekkefølge)
      cards: [],
    };
  }

  // Eksempeldata (kun uten sky): to grupper som speiler de gamle fanene.
  function seedGroups() {
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
    return defs.map((d, gi) => {
      const g = makeGroup(d.g.name, d.g.id);
      g.pos = gi;
      d.lists.forEach((l, i) => { const c = card(l[0], l[1], g.id); c.pos = i; g.cards.push(c); });
      return g;
    });
  }

  function baseState(seeded) {
    const groups = seeded ? seedGroups() : [];
    return {
      activeGroup: groups.length ? groups[0].id : null, // per enhet, synkes ikke
      groups,
      _tomb: { groups: {}, cards: {}, items: {} }, // gravsteiner: id → tidsstempel
      _hlc: 0,
    };
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return null;
      // Godta både ny (groups) og gammel (tabs) form — normalize migrerer.
      if (!Array.isArray(parsed.groups) && !parsed.tabs) return null;
      return parsed;
    } catch (e) {
      return null;
    }
  }

  let saveTimer = null;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        state._hlc = hlc;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      } catch (e) {
        /* ignore quota */
      }
    }, 120);
    // Sky-synk: flett + push (debouncet). Ikke mens vi nettopp skrev fjern-tilstand.
    if (!applyingRemote && syncCode && cloudConfigured()) scheduleSync();
  }

  // Første gang (ingen lokal state): start tom når sky-synk er konfigurert
  // (skyen fyller på / tom-tilstanden veileder), ellers med eksempeldata.
  const state = load() || baseState(!cloudConfigured());

  // Migrering: gjør om den gamle to-fane-modellen til grupper. To faste grupper
  // (Huskelister/Handlelister) med deterministiske id-er, slik at alle enheter
  // migrerer likt. Kjøres på gammel lagret state og på gamle fjern-doc.
  function migrateTabsToGroups(s) {
    if (Array.isArray(s.groups) || !s.tabs) return;
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

  // Normaliser: gi (evt. eldre) lagret state forventet struktur og synk-metadata.
  function normalizeItem(it, homeId, j) {
    if (!it.home) it.home = homeId;
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
  function normalizeGroup(g, i) {
    if (!g.id) g.id = uid();
    if (typeof g.name !== 'string') g.name = 'Uten navn';
    if (typeof g.ts !== 'number') g.ts = 0;
    if (!g.org) g.org = deviceId;
    if (typeof g.pos !== 'number') g.pos = i;
    if (typeof g.posTs !== 'number') g.posTs = 0;
    if (!g.posOrg) g.posOrg = deviceId;
    if (!Array.isArray(g.cards)) g.cards = [];
    g.cards.forEach((c, ci) => normalizeCard(c, g.id, ci));
  }
  function normalize(s) {
    migrateTabsToGroups(s);
    if (!Array.isArray(s.groups)) s.groups = [];
    if (!s._tomb || typeof s._tomb !== 'object') s._tomb = { groups: {}, cards: {}, items: {} };
    if (!s._tomb.groups) s._tomb.groups = {};
    if (!s._tomb.cards) s._tomb.cards = {};
    if (!s._tomb.items) s._tomb.items = {};
    if (typeof s._hlc !== 'number') s._hlc = 0;
    s.groups.forEach((g, i) => normalizeGroup(g, i));
    // activeGroup må peke på en eksisterende gruppe.
    if (!s.groups.some((g) => g.id === s.activeGroup)) {
      let first = null;
      s.groups.forEach((g) => { if (!first || g.pos < first.pos) first = g; });
      s.activeGroup = first ? first.id : null;
    }
    observeTs(s._hlc);
  }
  normalize(state);
  hlc = Math.max(hlc, state._hlc || 0);

  // Gi eldre kort (fra før den nye paletten) høstfarger. Idempotent. Muterer
  // state; persisteres av første render()→save() (etter at synk-let-ene er init).
  state.groups.forEach((g) => recolorOldCards(g.cards));

  /* ---------------- DOM-referanser ---------------- */
  const board = document.getElementById('board');
  const appHeader = document.getElementById('app-header');
  const groupsBar = document.getElementById('groups-bar');
  const groupsPin = document.getElementById('groups-pin');
  const addGroupBtn = document.getElementById('add-group-btn');
  const addGroupPinned = document.getElementById('add-group-pinned');
  const addCardBtn = document.getElementById('add-card-btn');
  const filterSwitchesEl = document.getElementById('filter-switches');
  const groupTpl = document.getElementById('group-template');
  const cardTpl = document.getElementById('card-template');
  const itemTpl = document.getElementById('item-template');

  const trashBtn = document.getElementById('trash-btn');
  const trashCount = document.getElementById('trash-count');
  const trashTitle = document.getElementById('trash-title');
  const trashModal = document.getElementById('trash-modal');
  const trashList = document.getElementById('trash-list');
  const trashClose = document.getElementById('trash-close');
  const trashEmptyBtn = document.getElementById('trash-empty');

  const posCmp = (a, b) => (a.pos - b.pos) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  // Gruppe-scope: «aktive» kort/elementer gjelder alltid den aktive gruppen.
  const activeGroupObj = () => state.groups.find((g) => g.id === state.activeGroup) || null;
  const sortedGroups = () => state.groups.slice().sort(posCmp);
  const findGroup = (id) => state.groups.find((g) => g.id === id) || null;
  const allCards = () => { const g = activeGroupObj(); return g ? g.cards : []; };
  const activeCards = () => allCards().filter((c) => !c.trashed).sort(posCmp);
  const trashedCards = () => allCards().filter((c) => c.trashed);
  const findCard = (id) => allCards().find((c) => c.id === id);
  function findItemById(id) {
    for (const c of allCards()) {
      const it = c.items.find((x) => x.id === id);
      if (it) return it;
    }
    return null;
  }

  /* ---------------- Filter (K / P / KP) ----------------
     Per enhet (ikke synket). Hvert kort tilhører nøyaktig én kategori ut fra
     bryterne sine: kun K, kun P, eller begge (KP). Filteret har tre brytere
     (K, P, KP) og et kort vises hvis bryteren for kortets kategori er på.
     Velger man f.eks. K + KP, vises kun-K-kort og KP-kort, men ikke kun-P-kort.
     Minst ett filter må alltid være på. */
  const FILTER_KEY = 'mine-lister-filter';
  const FILTERS = ['k', 'p', 'kp'];
  function loadFilter() {
    try {
      const f = JSON.parse(localStorage.getItem(FILTER_KEY));
      if (f && (f.k || f.p || f.kp)) return { k: f.k !== false, p: f.p !== false, kp: f.kp !== false };
    } catch (e) { /* ignore */ }
    return { k: true, p: true, kp: true };
  }
  const filter = loadFilter();
  function saveFilter() {
    try { localStorage.setItem(FILTER_KEY, JSON.stringify(filter)); } catch (e) { /* ignore */ }
  }
  // Kortets kategori: kun K, kun P, eller begge (KP). (Minst én bryter er alltid på.)
  function cardCategory(c) {
    const k = c.k !== false, p = c.p !== false;
    if (k && p) return 'kp';
    return k ? 'k' : 'p';
  }
  function cardMatchesFilter(c) {
    return !!filter[cardCategory(c)];
  }
  // Liten «kan ikke»-risting når man prøver å skru av den siste bryteren.
  function flashDeny(el) {
    el.classList.remove('deny');
    void el.offsetWidth;
    el.classList.add('deny');
  }

  /* ---------------- Render ---------------- */
  function updateTrashCount() {
    const n = trashedCards().length;
    trashCount.textContent = n;
    trashBtn.classList.toggle('has-items', n > 0);
  }

  function render() {
    renderGroups();
    updateTrashCount();
    renderFilterSwitches();
    updateToolbarState();

    board.innerHTML = '';
    const group = activeGroupObj();

    // Ingen grupper i det hele tatt.
    if (!group) {
      board.classList.add('empty');
      const es = document.createElement('div');
      es.className = 'empty-state';
      es.innerHTML = '<div class="big">📂</div><p>Ingen grupper ennå.</p>' +
        '<p>Trykk «＋» oppe til venstre for å lage en gruppe.</p>';
      board.appendChild(es);
      save();
      return;
    }

    const active = activeCards();
    const cards = active.filter(cardMatchesFilter);

    if (cards.length === 0) {
      board.classList.add('empty');
      const es = document.createElement('div');
      es.className = 'empty-state';
      if (active.length === 0) {
        const big = document.createElement('div'); big.className = 'big'; big.textContent = '🗒️';
        const p1 = document.createElement('p'); p1.textContent = 'Ingen lister i «' + group.name + '» ennå.';
        const p2 = document.createElement('p'); p2.textContent = 'Trykk «Ny liste» for å komme i gang.';
        es.append(big, p1, p2);
      } else {
        es.innerHTML = '<div class="big">🫙</div><p>Ingen lister passer filteret.</p>' +
          '<p>Skru på K, P eller KP for å se flere.</p>';
      }
      board.appendChild(es);
      save();
      return;
    }

    board.classList.remove('empty');
    cards.forEach((c) => board.appendChild(buildCard(c)));
    save();
  }

  // «Ny liste» / «Papirkurv» gir bare mening med en aktiv gruppe.
  function updateToolbarState() {
    const has = !!activeGroupObj();
    addCardBtn.disabled = !has;
    trashBtn.disabled = !has;
  }

  /* ---------------- Grupper (header) ---------------- */
  // Tegn gruppekortene inn i headeren (foran inline-«＋»-knappen).
  function renderGroups() {
    [...groupsBar.querySelectorAll('.group-card')].forEach((el) => el.remove());
    sortedGroups().forEach((g) => groupsBar.insertBefore(buildGroupCard(g), addGroupBtn));
    updateGroupsOverflow();
  }

  function buildGroupCard(groupData) {
    const el = groupTpl.content.firstElementChild.cloneNode(true);
    el.dataset.id = groupData.id;
    const isActive = groupData.id === state.activeGroup;
    el.classList.toggle('active', isActive);
    el.setAttribute('aria-selected', isActive ? 'true' : 'false');

    const nameEl = el.querySelector('.group-name');
    nameEl.textContent = groupData.name;

    // Antall lister i gruppen (ikke papirkurv), dempet tall etter navnet.
    const countEl = el.querySelector('.group-count');
    countEl.textContent = groupData.cards.filter((c) => !c.trashed).length;

    // Bytt til gruppen; er den allerede aktiv → rediger navnet.
    const activate = () => {
      if (nameEl.dataset.editing === '1') return;
      if (groupData.id !== state.activeGroup) {
        state.activeGroup = groupData.id;
        render();
      } else {
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

    el.querySelector('.group-delete').addEventListener('click', (ev) => {
      ev.stopPropagation();
      deleteGroup(groupData);
    });

    el.querySelector('.group-handle').addEventListener('pointerdown', (ev) => startGroupDrag(ev, el));
    return el;
  }

  function startGroupRename(nameEl, groupData) {
    editText(nameEl, groupData.name, (val) => {
      groupData.name = val || 'Uten navn';
      nameEl.textContent = groupData.name;
      stampContent(groupData);
      save();
      renderGroups(); // bredde/overflow kan endre seg med navnet
    }, { cls: 'group-edit', autosize: true });
  }

  function addGroup() {
    const g = makeGroup('Ny gruppe');
    let maxP = 0;
    state.groups.forEach((x) => { maxP = Math.max(maxP, x.pos || 0); });
    g.pos = state.groups.length ? maxP + 1 : 0;
    stampContent(g);
    stampPos(g);
    state.groups.push(g);
    state.activeGroup = g.id;
    render();
    // Rull den nye gruppen inn i syne og start redigering av navnet.
    const el = groupsBar.querySelector('.group-card[data-id="' + g.id + '"]');
    if (el) {
      try { el.scrollIntoView({ inline: 'end', block: 'nearest' }); } catch (e) { /* ignore */ }
      startGroupRename(el.querySelector('.group-name'), g);
    }
  }

  function deleteGroup(groupData) {
    const total = groupData.cards.length;
    if (total > 0) {
      const word = total === 1 ? 'liste' : 'lister';
      if (!confirm('Slette gruppen «' + groupData.name + '» og alle ' + total + ' ' + word +
        ' i den permanent? Dette kan ikke angres.')) return;
    }
    // Gravsteiner for gruppen + alle dens lister + elementer (hindrer gjenoppstandelse).
    state._tomb.groups[groupData.id] = tick();
    groupData.cards.forEach((c) => {
      state._tomb.cards[c.id] = tick();
      c.items.forEach((it) => { state._tomb.items[it.id] = tick(); });
    });
    const idx = state.groups.indexOf(groupData);
    if (idx > -1) state.groups.splice(idx, 1);
    if (state.activeGroup === groupData.id) {
      const first = sortedGroups()[0];
      state.activeGroup = first ? first.id : null;
    }
    render();
    save();
  }

  function buildCard(cardData) {
    const el = cardTpl.content.firstElementChild.cloneNode(true);
    el.dataset.id = cardData.id;

    const head = darken(cardData.color, 0.08);
    const accent = darken(cardData.color, 0.32);
    el.style.setProperty('--card-bg', cardData.color);
    el.style.setProperty('--card-head', head);
    el.style.setProperty('--card-accent', accent);

    const titleEl = el.querySelector('.card-title');
    titleEl.textContent = cardData.title;
    titleEl.addEventListener('click', () => editText(titleEl, cardData.title, (val) => {
      cardData.title = val || 'Uten navn';
      titleEl.textContent = cardData.title;
      stampContent(cardData);
      save();
    }));

    // Slett kategori -> legg i papirkurv (trashed-flagg; permanent først ved «Tøm papirkurv»)
    el.querySelector('.card-delete').addEventListener('click', () => {
      cardData.trashed = true;
      stampContent(cardData);
      render();
    });

    // K/P-brytere: minst én må være på; lysere sirkel = på.
    el.querySelectorAll('.card-switches .switch').forEach((sw) => {
      const flag = sw.dataset.flag;
      const paint = () => {
        const on = cardData[flag] !== false;
        sw.classList.toggle('on', on);
        sw.setAttribute('aria-pressed', on ? 'true' : 'false');
      };
      paint();
      sw.addEventListener('click', () => {
        const other = flag === 'k' ? 'p' : 'k';
        const on = cardData[flag] !== false;
        if (on && cardData[other] === false) { flashDeny(sw); return; } // kan ikke skru av den siste
        cardData[flag] = !on;
        stampLabel(cardData); // eget register → merkelapp-endringer flettes uavhengig av tittel/farge
        paint();
        save();
        if (!cardMatchesFilter(cardData)) render(); // skjul hvis den ikke lenger passer filteret
      });
    });

    // Håndtak for kort-draging
    el.querySelector('.card-handle').addEventListener('pointerdown', (ev) => startCardDrag(ev, el));

    // Elementer (sortert på posisjon)
    const list = el.querySelector('.items-container');
    cardData.items.slice().sort(posCmp).forEach((it) => list.appendChild(buildItem(it, cardData)));

    // Legg til element
    const form = el.querySelector('.add-item-form');
    const input = form.querySelector('.add-item-input');
    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
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

    return el;
  }

  function buildItem(itemData, cardData) {
    const el = itemTpl.content.firstElementChild.cloneNode(true);
    el.dataset.id = itemData.id;

    const textEl = el.querySelector('.item-text');
    textEl.textContent = itemData.text;
    textEl.addEventListener('click', () => editText(textEl, itemData.text, (val) => {
      if (!val) return; // tom redigering = ingen endring
      itemData.text = val;
      textEl.textContent = val;
      stampContent(itemData);
      save();
    }));

    el.querySelector('.item-delete').addEventListener('click', () => {
      const owner = ownerCardOf(el) || cardData;
      const idx = owner.items.findIndex((i) => i.id === itemData.id);
      if (idx > -1) owner.items.splice(idx, 1);
      state._tomb.items[itemData.id] = tick(); // gravstein hindrer gjenoppstandelse
      el.remove();
      save();
    });

    el.querySelector('.item-handle').addEventListener('pointerdown', (ev) => startItemDrag(ev, el));
    return el;
  }

  // Finn hvilket kort (i state) et element-DOM ligger i akkurat nå
  function ownerCardOf(itemEl) {
    const cardEl = itemEl.closest('.card');
    if (!cardEl) return null;
    return findCard(cardEl.dataset.id);
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
    drag.el = null;
    drag.ph = null;
    stopAutoScroll();
    stopGroupAutoScroll();
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
    beginDragCommon(ev, cardEl);
    drag.kind = 'card';

    const ph = document.createElement('div');
    ph.className = 'card-placeholder';
    ph.style.height = drag.height + 'px';
    ph.style.setProperty('--card-accent', getComputedStyle(cardEl).getPropertyValue('--card-accent'));
    board.insertBefore(ph, cardEl);
    drag.ph = ph;

    liftElement();
    drag.el.style.transform = `rotate(${cardRotation()}deg) scale(1.02)`;
    window.addEventListener('pointermove', onCardMove);
    window.addEventListener('pointerup', onCardUp);
    window.addEventListener('pointercancel', onCardUp);
  }

  function onCardMove(ev) {
    if (!drag.active) return;
    const dx = ev.clientX - drag.lastX;
    const dy = ev.clientY - drag.lastY;
    drag.lastX = ev.clientX;
    drag.lastY = ev.clientY;
    moveElement();
    drag.el.style.transform = `rotate(${cardRotation()}deg) scale(1.02)`;
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

  function onCardUp() {
    if (!drag.active) return;
    window.removeEventListener('pointermove', onCardMove);
    window.removeEventListener('pointerup', onCardUp);
    window.removeEventListener('pointercancel', onCardUp);

    const el = drag.el;
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
      c.pos = between(pPrev == null ? null : pPrev, pNext == null ? null : pNext);
      stampPos(c);
    }
    save();
  }

  /* ---------------- ELEMENT-DRAGING ---------------- */
  function startItemDrag(ev, itemEl) {
    if (ev.button != null && ev.button !== 0) return;
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

    reconcileItems(sourceCardId);
    if (targetCardId !== sourceCardId) reconcileItems(targetCardId);

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

  // Bygg items-array for et kort ut fra gjeldende DOM-rekkefølge (medlemskap).
  function reconcileItems(cardId) {
    const cardData = findCard(cardId);
    if (!cardData) return;
    const cardEl = board.querySelector('.card[data-id="' + cardId + '"]');
    if (!cardEl) return;
    const domIds = [...cardEl.querySelectorAll('.items-container > .item')].map((i) => i.dataset.id);

    // Slå sammen elementer som kan ha kommet fra et annet kort
    const pool = {};
    allCards().forEach((c) => c.items.forEach((it) => { pool[it.id] = it; }));
    cardData.items = domIds.map((id) => pool[id]).filter(Boolean);
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
    drag.lastX = ev.clientX;
    drag.lastY = ev.clientY;
    moveElement();
    drag.el.style.transform = `rotate(${cardRotation()}deg) scale(1.05)`;
    updateGroupAutoScroll(ev);
    updateGroupPlacement();
  }

  function updateGroupPlacement() {
    if (!drag.active || drag.kind !== 'group') return;
    const dragRect = draggedRect();
    const dcx = dragRect.left + dragRect.width / 2;
    const dcy = dragRect.top + dragRect.height / 2;
    const cards = [...groupsBar.querySelectorAll('.group-card:not(.dragging)')];
    const ph = drag.ph;

    let ref = null;
    for (const c of cards) {
      const r = layoutRect(c);
      const cx = r.left + r.width / 2;
      if (dcy < r.top - 1 || (dcy <= r.bottom + 1 && dcx < cx)) { ref = c; break; }
    }

    // Endrer flyttingen faktisk noe?
    if (ref) { if (ref.previousElementSibling === ph) return; }
    else if (ph.nextElementSibling === addGroupBtn) return;

    const snap = snapshotRects(cards);
    if (ref) groupsBar.insertBefore(ph, ref);
    else groupsBar.insertBefore(ph, addGroupBtn); // etter siste kort, foran «＋»
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
      g.pos = between(prevG ? prevG.pos : null, nextG ? nextG.pos : null);
      stampPos(g);
    }
    updateGroupsOverflow();
    save();
  }

  /* ------- Horisontal auto-scroll av gruppe-raden (mobil-overflow) ------- */
  let groupScrollRAF = null, groupScrollSpeed = 0;
  function updateGroupAutoScroll(ev) {
    if (!drag.active || drag.kind !== 'group') { stopGroupAutoScroll(); return; }
    const r = groupsBar.getBoundingClientRect();
    const EDGE = 52, x = ev.clientX;
    let speed = 0;
    if (x < r.left + EDGE) speed = -Math.ceil(((r.left + EDGE - x) / EDGE) * 16);
    else if (x > r.right - EDGE) speed = Math.ceil(((x - (r.right - EDGE)) / EDGE) * 16);
    groupScrollSpeed = speed;
    if (speed !== 0) startGroupAutoScroll(); else stopGroupAutoScroll();
  }
  function startGroupAutoScroll() {
    if (groupScrollRAF != null) return;
    const step = () => {
      if (!drag.active || groupScrollSpeed === 0) { groupScrollRAF = null; return; }
      const before = groupsBar.scrollLeft;
      groupsBar.scrollLeft += groupScrollSpeed;
      if (groupsBar.scrollLeft !== before) updateGroupPlacement();
      groupScrollRAF = requestAnimationFrame(step);
    };
    groupScrollRAF = requestAnimationFrame(step);
  }
  function stopGroupAutoScroll() {
    if (groupScrollRAF != null) { cancelAnimationFrame(groupScrollRAF); groupScrollRAF = null; }
    groupScrollSpeed = 0;
  }

  /* ------- Overflow: på mobil legges «＋» statisk til høyre med fade ------- */
  function updateGroupsOverflow() {
    const mobile = window.matchMedia('(max-width: 560px)').matches;
    const overflow = mobile && (groupsBar.scrollWidth - groupsBar.clientWidth > 1);
    appHeader.classList.toggle('groups-overflow', overflow);
  }
  window.addEventListener('resize', updateGroupsOverflow);

  /* ---------------- Topp-knapper ---------------- */
  addGroupBtn.addEventListener('click', addGroup);
  addGroupPinned.addEventListener('click', addGroup);

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

  /* ---------------- Filter-brytere (verktøylinja) ---------------- */
  function renderFilterSwitches() {
    filterSwitchesEl.querySelectorAll('.switch').forEach((sw) => {
      const on = filter[sw.dataset.flag] !== false;
      sw.classList.toggle('on', on);
      sw.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }
  filterSwitchesEl.querySelectorAll('.switch').forEach((sw) => {
    sw.addEventListener('click', () => {
      const flag = sw.dataset.flag;
      const onCount = FILTERS.filter((f) => filter[f]).length;
      if (filter[flag] && onCount === 1) { flashDeny(sw); return; } // minst ett filter må være på
      filter[flag] = !filter[flag];
      saveFilter();
      render(); // tegner også bryterne på nytt via renderFilterSwitches()
    });
  });

  /* ---------------- Papirkurv ---------------- */
  function buildTrashList() {
    const trash = trashedCards();
    trashList.innerHTML = '';
    if (!trash.length) {
      const p = document.createElement('p');
      p.className = 'trash-empty-msg';
      p.textContent = 'Papirkurven er tom.';
      trashList.appendChild(p);
      trashEmptyBtn.disabled = true;
      return;
    }
    trashEmptyBtn.disabled = false;
    trash.forEach((c) => {
      const row = document.createElement('div');
      row.className = 'trash-row';

      const dot = document.createElement('span');
      dot.className = 'trash-dot';
      dot.style.background = c.color;

      const name = document.createElement('span');
      name.className = 'trash-name';
      name.textContent = c.title;

      const n = c.items.length;
      const meta = document.createElement('span');
      meta.className = 'trash-meta';
      meta.textContent = n + ' ' + (n === 1 ? 'element' : 'elementer');

      const restore = document.createElement('button');
      restore.className = 'btn btn-small';
      restore.type = 'button';
      restore.textContent = 'Gjenopprett';
      restore.addEventListener('click', () => {
        c.trashed = false;
        stampContent(c);
        buildTrashList();
        render();
      });

      row.append(dot, name, meta, restore);
      trashList.appendChild(row);
    });
  }

  function openTrash() {
    const g = activeGroupObj();
    if (!g) return; // papirkurv er per gruppe
    trashTitle.textContent = '🗑️ Papirkurv – ' + g.name;
    buildTrashList();
    trashModal.hidden = false;
    document.body.classList.add('modal-open');
  }
  function closeTrash() {
    trashModal.hidden = true;
    document.body.classList.remove('modal-open');
  }

  trashBtn.addEventListener('click', openTrash);
  trashClose.addEventListener('click', closeTrash);
  trashModal.addEventListener('click', (ev) => { if (ev.target === trashModal) closeTrash(); });
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && !trashModal.hidden) closeTrash();
  });

  trashEmptyBtn.addEventListener('click', () => {
    const trash = trashedCards();
    if (!trash.length) return;
    if (!confirm('Slette alt i papirkurven permanent? Dette kan ikke angres.')) return;
    const arr = allCards();
    trash.forEach((c) => {
      state._tomb.cards[c.id] = tick(); // permanent gravstein hindrer gjenoppstandelse
      const i = arr.indexOf(c);
      if (i > -1) arr.splice(i, 1);
    });
    buildTrashList();
    render();
    save();
  });

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
  // Synk-doc: kun det som deles (ikke activeGroup, som er per enhet).
  function cleanItem(it, homeId) {
    return {
      id: it.id, text: it.text, home: it.home || homeId,
      ts: it.ts || 0, org: it.org || '',
      pos: it.pos || 0, posTs: it.posTs || 0, posOrg: it.posOrg || '',
    };
  }
  function cleanCard(c) {
    return {
      id: c.id, group: c.group || null, title: c.title, color: c.color, trashed: !!c.trashed,
      k: c.k !== false, p: c.p !== false,
      ts: c.ts || 0, org: c.org || '',
      labTs: c.labTs || 0, labOrg: c.labOrg || '',
      pos: c.pos || 0, posTs: c.posTs || 0, posOrg: c.posOrg || '',
    };
  }
  function cleanGroup(g) {
    return {
      id: g.id, name: g.name,
      ts: g.ts || 0, org: g.org || '',
      pos: g.pos || 0, posTs: g.posTs || 0, posOrg: g.posOrg || '',
    };
  }
  // Synk-doc er flatt: tre parallelle tabeller (grupper/lister/elementer) med
  // forelder-peker (kort.group, element.home). Rekkefølge-uavhengig likhet via
  // canonical(); activeGroup deles ikke (per enhet).
  function docFromState() {
    const groups = [], cards = [], items = [];
    state.groups.forEach((g) => {
      groups.push(cleanGroup(g));
      (g.cards || []).forEach((c) => {
        cards.push(cleanCard(Object.assign({}, c, { group: c.group || g.id })));
        (c.items || []).forEach((it) => items.push(cleanItem(it, c.id)));
      });
    });
    return {
      groups, cards, items,
      tomb: {
        groups: Object.assign({}, state._tomb.groups),
        cards: Object.assign({}, state._tomb.cards),
        items: Object.assign({}, state._tomb.items),
      },
      hlc: hlc,
    };
  }

  // Skriv et (flettet) flatt doc inn i state (nøstet igjen), behold activeGroup, tegn på nytt.
  function applyDoc(doc) {
    applyingRemote = true;
    try {
      const groups = (doc.groups || []).map((g) => Object.assign(cleanGroup(g), { cards: [] }));
      const gById = new Map(groups.map((g) => [g.id, g]));
      const cById = new Map();
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
      groups.sort(posCmp);
      groups.forEach((g) => { g.cards.sort(posCmp); g.cards.forEach((c) => c.items.sort(posCmp)); });

      state.groups = groups;
      state._tomb = {
        groups: Object.assign({}, (doc.tomb && doc.tomb.groups) || {}),
        cards: Object.assign({}, (doc.tomb && doc.tomb.cards) || {}),
        items: Object.assign({}, (doc.tomb && doc.tomb.items) || {}),
      };
      state._hlc = doc.hlc || 0;
      observeTs(doc.hlc);
      if (!state.groups.some((g) => g.id === state.activeGroup)) {
        state.activeGroup = state.groups.length ? state.groups[0].id : null;
      }
      const ex = activeCards();
      if (ex.length) lastColor = ex[ex.length - 1].color;
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
      id: a.id, text: content.text, ts: content.ts || 0, org: content.org || '',
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
      title: content.title, color: content.color || a.color || b.color,
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
      id: a.id, name: content.name,
      ts: content.ts || 0, org: content.org || '',
      pos: posw.pos || 0, posTs: posw.posTs || 0, posOrg: posw.posOrg || '',
    };
  }
  function mergeTomb(a, b) {
    const out = { groups: {}, cards: {}, items: {} };
    ['groups', 'cards', 'items'].forEach((k) => {
      const ax = (a && a[k]) || {}, bx = (b && b[k]) || {};
      Object.keys(ax).forEach((id) => { out[k][id] = ax[id]; });
      Object.keys(bx).forEach((id) => { out[k][id] = Math.max(out[k][id] || 0, bx[id]); });
    });
    return out;
  }
  // Flett to flate doc-er felt for felt. Grupper/lister/elementer flettes hver for
  // seg på id (LWW per register); forelderløse (gruppe/kort borte) forkastes;
  // gravlagte fjernes. Endringer på ulike entiteter/felter kolliderer aldri.
  function mergeStates(a, b) {
    const tomb = mergeTomb(a.tomb, b.tomb);

    const groups = new Map();
    const addGroups = (list) => (list || []).forEach((raw) => {
      const g = cleanGroup(raw);
      const prev = groups.get(g.id);
      groups.set(g.id, prev ? mergeGroupScalar(prev, g) : g);
    });
    addGroups(a.groups); addGroups(b.groups);
    groups.forEach((g, id) => { if (deadBy(tomb.groups[id], g.ts, g.posTs)) groups.delete(id); });

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
      groups: [...groups.values()],
      cards: [...cards.values()],
      items: [...items.values()],
      tomb, hlc: Math.max(a.hlc || 0, b.hlc || 0),
    };
  }

  /* ---------- Migrering av gammel to-fane-form (fra databasen) ----------
     Både gammel hel-tilstand (activeTab + evt. trash-arrays) og forrige synk-doc
     ({tabs, tomb, hlc}) gjøres om til det flate gruppe-doc-et. To faste grupper
     (Huskelister/Handlelister) med deterministiske id-er → alle enheter migrerer
     likt. Bevarer gravsteiner uansett om de lå som _tomb (state) eller tomb (doc). */
  function migrateBareState(s) {
    const src = s || {};
    const rawTomb = src._tomb || src.tomb || {};
    const tomb = { groups: rawTomb.groups || {}, cards: rawTomb.cards || {}, items: rawTomb.items || {} };
    const groups = [], cards = [], items = [];
    LEGACY_TABS.forEach((m, gi) => {
      groups.push({ id: m.id, name: m.name, ts: 0, org: '', pos: gi, posTs: 0, posOrg: '' });
      const tab = (src.tabs && src.tabs[m.key]) || {};
      const list = Array.isArray(tab.cards) ? tab.cards.slice() : [];
      if (Array.isArray(tab.trash)) tab.trash.forEach((c) => list.push(Object.assign({}, c, { trashed: true })));
      list.forEach((c, ci) => {
        cards.push(cleanCard(Object.assign({ pos: ci }, c, { group: m.id })));
        (c.items || []).forEach((it, ii) => items.push(cleanItem(Object.assign({ pos: ii }, it), c.id)));
      });
    });
    return { groups, cards, items, tomb, hlc: src._hlc || src.hlc || 0 };
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
    if (data.tabs || data.groups) return { data: normalizeRemoteDoc(data), version: 0 }; // bar tilstand
    return null;
  }
  // Normaliser fjern-doc: gammel to-fane-form (hel-tilstand ELLER forrige synk-doc)
  // migreres til flatt gruppe-doc; ny gruppe-form renses. Diskriminatoren er enkel:
  // gammelt har `tabs`, nytt har `groups`.
  function normalizeRemoteDoc(d) {
    if (!d || typeof d !== 'object') return migrateBareState(d || {});
    if (d.tabs) return migrateBareState(d);
    const tomb = {
      groups: (d.tomb && d.tomb.groups) || {},
      cards: (d.tomb && d.tomb.cards) || {},
      items: (d.tomb && d.tomb.items) || {},
    };
    return {
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
      // Kort som kommer fra en eldre fjern-tilstand kan ha gamle farger → gi dem
      // høstfarger her også (idempotent), så de synkes ut til alle enheter.
      recolorOldCards(mergedDoc.cards);
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
  function showToast(msg) {
    let t = document.getElementById('toast');
    if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; document.body.appendChild(t); }
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
  }

  /* ---------- Logg ut (erstatter den gamle Synk-knappen) ----------
     Synken går fortløpende i bakgrunnen; ingen egen synk-knapp trengs.
     Ved fjern-endringer vises et lite «oppdatert»-varsel (showToast). */
  logoutBtn.addEventListener('click', () => {
    if (confirm('Logge ut? Listene dine ligger trygt i skyen og kommer tilbake når du tegner mønsteret igjen.')) logout();
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
      const existing = activeCards();
      if (existing.length) lastColor = existing[existing.length - 1].color;
      render();
    }
    if (code) await syncConnect(code);
    else await syncInit();
  }

  function logout() {
    try { if (rtChannel && sb) sb.removeChannel(rtChannel); } catch (e) { /* ignore */ }
    clearInterval(pollTimer);
    clearTimeout(syncDebounce);
    localStorage.removeItem(AUTH_KEY);
    localStorage.removeItem(SYNC_CODE_KEY);
    location.reload();
  }

  function initAuth() {
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

  /* ---------------- Start ---------------- */
  initAuth();

  // Eksponer for enkel feilsøking/testing
  window.__huskekurv = {
    state, render, logout, addGroup, deleteGroup,
    // Synk-interne (for testing av fletting/synk):
    mergeStates, canonical, docFromState, applyDoc, syncCycle, normalizeRemoteDoc, migrateBareState,
    get syncCode() { return syncCode; },
    get serverVersion() { return serverVersion; },
    get rtConnected() { return rtConnected; },
  };
})();
