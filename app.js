/* ============================================================
   Huskis — app.js
   Vanilla JS. Egen dra-og-slipp-motor på Pointer Events.
   ============================================================ */
(function () {
  'use strict';

  /* ---------------- Språk ----------------
     Ordboken og kjøretiden ligger i `i18n.js`, som lastes før denne fila.
     `tr(nøkkel, felt)` er den ENESTE veien til brukerrettet tekst herfra: en
     norsk streng skrevet rett inn i koden finnes ikke på engelsk, og
     tests/i18n.test.js stopper den. Autoritativt: docs/sprak.md. */
  const I18N = window.HUSKIS_I18N;
  const tr = I18N.t;
  /* Klon av en <template>. Malenes `data-i18n`-attributter må oversettes på
     KLONEN: innholdet i et <template> er et eget fragment, som oppstartens
     `applyStatic(document)` ikke går inn i. */
  function fromTemplate(tpl) {
    return I18N.applyStatic(tpl.content.firstElementChild.cloneNode(true));
  }

  /* ---------------- Drakt (lys/mørk) ----------------
     `theme.js` lastes i <head>, altså lenge før denne fila, og har allerede
     satt `data-theme` på <html> når vi kommer hit. Herfra trenger vi den bare
     til to ting: å vite hvilken drakt som gjelder når kortfargene regnes ut
     (paletten speiler L-en, se colorForIndex), og å male board-et på nytt når
     drakten skifter. Autoritativt: docs/mork-drakt.md. */
  const THEME = window.HUSKIS_THEME;

  /* ---------------- Konstanter ---------------- */
  const STORAGE_KEY = 'mine-lister-v1';

  // Faste, deterministiske mappe-id-er brukt ved migrering fra den gamle
  // to-fane-modellen (Huskelister/Handlelister) og for eksempeldata. Faste id-er
  // gjør at alle enheter migrerer til de SAMME mappene → ingen duplisering ved
  // fletting.
  const LEGACY_TABS = [
    { id: 'grp-huskelister', name: 'Huskelister', key: 'huskelister' },
    { id: 'grp-handlelister', name: 'Handlelister', key: 'handlelister' },
  ];

  // Fast, deterministisk id/navn for området eksisterende data migreres inn i
  // (Område > Mappe > Liste > Element). Fast id → alle enheter migrerer til
  // det SAMME området, uten duplisering ved fletting.
  const DEFAULT_UNI = { id: 'uni-standard', name: 'Standard' };

  /* ---------------- Fargesystem (HSL, posisjonsbasert) ----------------
     Kort (og mappekort) får farge ut fra POSISJONEN sin (indeks i den synlige,
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
  const COLOR_SAT = 20;                 // S (%) — likt for alle farger, i begge drakter
  /* L (%) per sett (sett 1, 2, 3 …), ett sett per drakt. H og S er de samme i
     begge — det er BARE lysheten som snus, slik at et kort beholder tonen sin
     når man bytter drakt.

     Den mørke rekka er IKKE en ren 100−L ([40,25,10]). Kontrastforhold speiles
     ikke lineært i L: mot en mørk board-bakgrunn faller L=10 til 1,0–1,1:1, og
     de tre settene ville smeltet sammen med bakgrunnen og med hverandre.
     [42,32,22] er speilingen komprimert opp i det området som fortsatt har
     spennvidde. Målt mot board-bakgrunnen gir den nesten nøyaktig samme
     spredning som den lyse rekka gir mot sin:

       lys  L=60/75/90 → 1,31–1,99 / 2,25–2,82 / 3,52–3,84 mot --bg
       mørk L=42/32/22 → 2,55–4,37 / 1,81–2,80 / 1,32–1,74 mot --bg

     altså samme gulv (1,3) og samme tak (3,8–4,4), bare med settene i motsatt
     rekkefølge — som er hele poenget med en speiling. tests/a11y-contrast.test.js
     regner tallene ut på nytt. Se docs/mork-drakt.md. */
  const COLOR_LIGHTNESS_BY_THEME = { light: [60, 75, 90], dark: [42, 32, 22] };
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
  // Antall sett er likt i begge drakter, så antall farger før repetisjon — og
  // dermed hvilket SETT en gitt indeks havner i — er uavhengig av drakten.
  const COLOR_COUNT = HUE_ORDER.length * COLOR_LIGHTNESS_BY_THEME.light.length;

  // Drakten som gjelder nå: 'light' eller 'dark' (theme.js løser opp 'system').
  function themeName() { return THEME.effective(); }
  function lightnessSet() {
    return COLOR_LIGHTNESS_BY_THEME[themeName()] || COLOR_LIGHTNESS_BY_THEME.light;
  }

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
    const L = lightnessSet();
    i = ((i % COLOR_COUNT) + COLOR_COUNT) % COLOR_COUNT;
    const hue = HUE_ORDER[i % HUE_ORDER.length];
    const level = Math.floor(i / HUE_ORDER.length) % L.length;
    return hslToHex(hue, COLOR_SAT, L[level]);
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
  // gyldige som uuid-kolonner i databasen (offline-first: id-en lages på klienten).
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
  function lighten(hex, amt) {
    const { r, g, b } = hexToRgb(hex);
    const f = (c) => Math.min(255, Math.round(c + (255 - c) * amt));
    const to = (c) => c.toString(16).padStart(2, '0');
    return '#' + to(f(r)) + to(f(g)) + to(f(b));
  }

  /* Kortets tre farger settes som inline custom properties, og alle tre utledes
     av palettfargen:

       --card-bg     kortflaten selv
       --card-head   korthodet — et hakk fra flaten, så hodet leser som eget felt
       --card-accent kanten rundt avkryssingsboksen (et grafisk objekt, 3:1)

     RETNINGEN SNUR MED DRAKTEN. I lys drakt er kortfargen lys, og de to
     avledede mørknes. I mørk drakt er kortfargen mørk: en mørkning ville gitt
     et korthode som forsvinner i bakgrunnen og en avkryssingskant som er borte
     (nesten svart på nesten svart). Der lysner de i stedet — samme kontrast,
     motsatt vei. Aksenten trenger et hakk mer (0,34 mot 0,32) for å holde 3:1
     mot den mørke platen den ligger oppå.

     Ett sted, ikke tre: alle som tegner et kort (liste, område, omfarging under
     draging) går gjennom denne. */
  function paintCardColor(el, base) {
    const dark = themeName() === 'dark';
    el.style.setProperty('--card-bg', base);
    el.style.setProperty('--card-head', dark ? lighten(base, 0.08) : darken(base, 0.08));
    el.style.setProperty('--card-accent', dark ? lighten(base, 0.34) : darken(base, 0.32));
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
    c.collapsed = false; // rullgardin-kollaps av kategorien (som lister)
    return c;
  }

  function card(title, items, groupId) {
    const id = uid();
    const c = {
      // Farge lagres ikke: den utledes av posisjon ved rendring (colorForIndex).
      id, group: groupId || null, title, trashed: false, k: true, p: true,
      ts: 0, org: deviceId,           // innholdsregister (tittel/farge/trashed)
      labTs: 0, labOrg: deviceId,     // merkelapp-register (k/p) — uavhengig av innhold
      pos: 0, posTs: 0, posOrg: deviceId, // posisjonsregister (rekkefølge + mappe-forelder)
      items: [],
    };
    (items || []).forEach((t, i) => {
      const it = makeItem(t, id);
      it.pos = i;
      c.items.push(it);
    });
    return c;
  }

  // En mappe er nivå to (Område > Mappe > Liste > Element). Den har innholds-
  // register (navn) og posisjonsregister (rekkefølge + område-forelder + `cat`),
  // og eier sine lister. `cat`/`isCat` speiler listepunktenes kategori-modell:
  // en MAPPEKATEGORI lagres som en mappe med `isCat: true`, og vanlige mapper
  // peker på den via `cat` (null = ukategorisert, nivå 1 i området).
  function makeGroup(name, id, uniId) {
    return {
      id: id || uid(), uni: uniId || null, name, trashed: false,
      cat: null, isCat: false, collapsed: false,
      _type: 'group', _role: 'owner', _createdByMe: true, // lokalt opprettet (synken bekrefter)
      ts: 0, org: deviceId,               // innholdsregister (navn/trashed/isCat/collapsed)
      pos: 0, posTs: 0, posOrg: deviceId, // posisjonsregister (rekkefølge + område + cat)
      cards: [],
    };
  }
  // Mappekategori: nivå-1-rad i et område som grupperer mapper under en
  // felles overskrift — nøyaktig samme mønster som listepunkt-kategorier.
  function makeGroupCategory(name, uniId) {
    const g = makeGroup(name, null, uniId);
    g.isCat = true;
    return g;
  }

  // Et område er øverste nivå — en beholder med egne mapper (og mappekategorier).
  function makeUniverse(name, id) {
    return {
      id: id || uid(), name, trashed: false, collapsed: false,
      _type: 'universe', _role: 'owner', _createdByMe: true, // lokalt opprettet (synken bekrefter)
      ts: 0, org: deviceId,               // innholdsregister (navn/trashed/collapsed)
      pos: 0, posTs: 0, posOrg: deviceId, // posisjonsregister (rekkefølge)
      groups: [],
    };
  }

  // Eksempeldata (kun uten sky): to mapper som speiler de gamle fanene,
  // pakket inn i standard-området.
  function seedUniverses() {
    const u = makeUniverse(DEFAULT_UNI.name, DEFAULT_UNI.id);
    const defs = [
      { g: LEGACY_TABS[0], lists: [
        [tr('seed.chores'), [tr('seed.garage'), tr('seed.dentist'), tr('seed.flowers')]],
        [tr('seed.packing'), [tr('seed.raincoat'), tr('seed.charger'), tr('seed.bottle'), tr('seed.map')]],
        [tr('seed.ideas'), [tr('seed.fence'), tr('seed.coffeeBar')]],
      ] },
      { g: LEGACY_TABS[1], lists: [
        [tr('seed.groceries'), [tr('seed.milk'), tr('seed.bread'), tr('seed.eggs'), tr('seed.butter'), tr('seed.coffee')]],
        [tr('seed.dinner'), [tr('seed.chicken'), tr('seed.rice'), tr('seed.broccoli'), tr('seed.soy')]],
        [tr('seed.pharmacy'), [tr('seed.plaster'), tr('seed.sunscreen')]],
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
      activeGroups: {}, // uniId → sist aktive mappe der (per enhet, synkes ikke)
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
  /* Sant mens DEMONSTRASJONEN kjører. Den er en SIMULERING: brukerens egne
     objekter er lagt til side, og alt demoen lager er en kulisse som rives ned
     igjen. Ingenting av det skal havne i den lokale bufferen eller på kontoen,
     så de fire veiene ut — bufferen, sky-runden, den huskede posisjonen og
     bakgrunnskøen — stenges her. Flagget står HER, ikke nede i demoseksjonen,
     fordi `save()` under leser det. Se DEMONSTRASJONEN FOR NYE BRUKERE. */
  let demoActive = false;
  // Serialisering hopper over intern backend-metadata (_parent/_canon/_caps/…),
  // som ellers ville gitt sykliske referanser i kontomodus. State-nivå _tomb/_hlc
  // beholdes. _createdByMe (en ren boolsk verdi, ingen sirkulær referanse) beholdes
  // også, slik at foreignIds() har et riktig signal fra cachet state på kalde
  // reloads/offline (se der) — før en vellykket get_my_doc overskriver den friskt.
  // _base/_baseV er synk-basen (forrige serverkjente doc, se cloudCycle): den MÅ
  // ligge i den samme localStorage-posten som innholdet, slik at basen og staten
  // den ble flettet mot alltid lagres i én og samme skriving. Havnet de i hver
  // sin post kunne den ene lande og den andre feile (kvote) — og en base som
  // beskriver rader staten ikke har, leses av fletteren som «slettet lokalt» og
  // ville pushet DELETE på gyldige rader.
  const CACHED_META = new Set(['_tomb', '_hlc', '_createdByMe', '_base', '_baseV']);
  function stateReplacer(k, v) {
    return (k && k[0] === '_' && !CACHED_META.has(k)) ? undefined : v;
  }
  // Nøkkelen den lokale bufferens skrivefeil meldes under i lagringsstatusen.
  // Én felles nøkkel: det er én buffer, og gjentatte feil er samme problem.
  const CACHE_REJECT_KEY = 'cache';
  /* Bærer den ventende buffer-skrivingen BRUKERENS egne endringer? Synken
     skriver til den samme bufferen hele tiden på vei NED fra serveren —
     fletteresultatet (render() under `applyingRemote`), basen (`persistBase`)
     og gravsteiner — og de skrivingene er bokføring, ikke arbeid som venter på
     å komme opp. Skiller vi dem ikke, leser lagringsstatusen hver eneste av dem
     som «ventende» og faller tilbake til «Lagrer …» hvert gang en runde skriver
     ned resultatet sitt: etter én lagring blinket den «Lagrer …» → «Lagret» →
     «Lagrer …» → «Lagret», én gang per runde som rørte bufferen.
     Flagget står til skrivingen faktisk gikk gjennom — feiler den (kvote), er
     endringene fortsatt bare i minnet, og neste skriving bærer dem igjen. */
  let cacheDirty = false;
  // Selve skrivingen (debouncet). Nøkkelen fanges når skrivingen bestilles, ikke
  // når den utføres, så en utlogging midt i vinduet ikke flytter en brukers data
  // over i en annen post.
  let pendingCacheKey = null; // nøkkelen den ventende skrivingen ble bestilt for
  function writeCacheNow() {
    saveTimer = null; // «ingen skriving venter» — leses av updateSafety()/syncStatus
    const key = pendingCacheKey || (authUser ? (STORAGE_KEY + ':' + authUser.id) : STORAGE_KEY);
    pendingCacheKey = null;
    try {
      state._hlc = hlc;
      localStorage.setItem(key, JSON.stringify(state, stateReplacer));
      cacheDirty = false; // brukerens endringer ligger nå i bufferen
      syncStatus.clearRejected(CACHE_REJECT_KEY);
    } catch (e) {
      // Full kvote, eller localStorage utilgjengelig (privat modus, blokkerte
      // nettsteddata). Da ligger endringene KUN i minnet, og både «Lagret» og
      // «endringene lagres på denne enheten» ville vært løgn — så dette må
      // meldes, ikke svelges. Statusen står til en skriving faktisk går
      // gjennom; «Prøv igjen» bestiller en ny.
      console.error('[huskis] Kunne ikke skrive den lokale bufferen — ' +
        'endringene ligger bare i minnet i denne fanen.', e);
      syncStatus.noteRejected(CACHE_REJECT_KEY, {
        kind: 'cache', message: String((e && e.message) || e),
      });
    }
    syncStatus.refresh();
  }
  function scheduleCacheWrite(userChange) {
    if (userChange) cacheDirty = true;
    clearTimeout(saveTimer);
    pendingCacheKey = authUser ? (STORAGE_KEY + ':' + authUser.id) : STORAGE_KEY;
    saveTimer = setTimeout(writeCacheNow, 120);
  }
  /* Skriv en ventende buffer-skriving NÅ. Demoen bytter ut `state` med en
     kulisse, og en skriving bestilt FØR byttet ville ellers fyrt etterpå og
     lagret kulissen — sammen med den ekte synk-basen. En reload midt i demoen
     leste da en buffer uten brukerens rader og en base som beskriver dem, og
     fletteren ville lest det som «slettet lokalt» og pushet DELETE på gyldige
     rader. Skrivingen bærer brukerens egne endringer, så den skal fullføres,
     ikke forkastes. */
  function flushCacheWrite() {
    if (!saveTimer) return;
    clearTimeout(saveTimer);
    writeCacheNow();
  }
  // Teller lokale endringer som skal til skyen. `syncedSeq` rykker fram til den
  // verdien `saveSeq` hadde da en synk-runde leste staten — men KUN når runden
  // fikk pushet alt. Er de ulike, ligger det lokale endringer serveren ikke har
  // fått ennå (se updateSafety(): da er en automatisk reload ikke trygg).
  let saveSeq = 0, syncedSeq = 0;
  function save() {
    if (demoActive) return; // simulering — se demoActive
    // En render UNDER `applyingRemote` kaller også save() (renderBoardInner), og
    // da er det fletteresultatet som skrives ned — ikke en ny brukerendring.
    scheduleCacheWrite(!applyingRemote);
    if (applyingRemote) return;
    if (authUser) { saveSeq++; scheduleCloud(); syncStatus.refresh(); }
  }
  // Som save(), men uten å planlegge en synk-runde: brukes av synken selv når
  // den skriver ned resultatet sitt (innhold + base) og altså nettopp har vært
  // hos serveren. Skrivingen bærer derfor ingen ny brukerendring.
  function saveLocal() { if (!demoActive) scheduleCacheWrite(false); }

  // Første gang (ingen lokal state): start tom når sky-synk er konfigurert
  // (skyen fyller på / tom-tilstanden veileder), ellers med eksempeldata.
  const state = load() || baseState(!cloudConfigured());

  // Migrering (steg 1): gjør om den gamle to-fane-modellen til mapper. To faste
  // mapper (Huskelister/Handlelister) med deterministiske id-er, slik at alle
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

  // Migrering (steg 2): pakk en flat mappe-tilstand inn i standard-området.
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
    if (typeof g.name !== 'string') g.name = tr('common.noName');
    if (typeof g.trashed !== 'boolean') g.trashed = false;
    if (typeof g.isCat !== 'boolean') g.isCat = false;
    if (typeof g.collapsed !== 'boolean') g.collapsed = false;
    if (g.cat === undefined) g.cat = null;
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
    if (typeof u.name !== 'string') u.name = tr('common.noName');
    if (typeof u.trashed !== 'boolean') u.trashed = false;
    if (typeof u.collapsed !== 'boolean') u.collapsed = false;
    if (typeof u.ts !== 'number') u.ts = 0;
    if (!u.org) u.org = deviceId;
    if (typeof u.pos !== 'number') u.pos = i;
    if (typeof u.posTs !== 'number') u.posTs = 0;
    if (!u.posOrg) u.posOrg = deviceId;
    if (!Array.isArray(u.groups)) u.groups = [];
    u.groups.forEach((g, gi) => normalizeGroup(g, gi, u.id));
  }
  // activeUniverse/activeGroup må peke på eksisterende, ikke-slettede entiteter;
  // activeGroups-minnet (per område) brukes som fallback før «første synlige».
  function validateActive(s) {
    if (!s.activeGroups || typeof s.activeGroups !== 'object') s.activeGroups = {};
    if (!s.universes.some((u) => u.id === s.activeUniverse && !u.trashed)) {
      let first = null;
      s.universes.forEach((u) => { if (!u.trashed && (!first || u.pos < first.pos)) first = u; });
      s.activeUniverse = first ? first.id : null;
    }
    const uni = s.universes.find((u) => u.id === s.activeUniverse && !u.trashed) || null;
    // Mappekategorier er overskrifter, ikke steder man kan stå.
    const groups = uni ? uni.groups.filter((g) => !g.trashed && !g.isCat) : [];
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
  const topbarEl = document.getElementById('topbar');
  // ÉN navigasjonsknapp i toppmenyen (🌐 område › 📁 mappe) → nav-modalen.
  const navCrumbBtn = document.getElementById('nav-crumb');
  const crumbUniName = document.getElementById('crumb-uni-name');
  const crumbGroupName = document.getElementById('crumb-group-name');
  const crumbUniIcon = document.getElementById('crumb-uni-icon');
  const crumbGroupIcon = document.getElementById('crumb-group-icon');
  const crumbUniShared = document.getElementById('crumb-uni-shared');
  const crumbGroupShared = document.getElementById('crumb-group-shared');
  const respSwitcherOverlay = document.getElementById('resp-switcher');
  const respSwitcherPanel = document.getElementById('resp-switcher-panel');
  const addCardBtn = document.getElementById('add-card-btn');
  const cardTpl = document.getElementById('card-template');
  const itemTpl = document.getElementById('item-template');
  const catTpl = document.getElementById('category-template');
  const uniCardTpl = document.getElementById('uni-card-template');
  const groupRowTpl = document.getElementById('group-row-template');
  const groupCatTpl = document.getElementById('group-cat-template');

  const trashBtn = document.getElementById('trash-btn');
  const trashCount = document.getElementById('trash-count');
  const trashTitle = document.getElementById('trash-title-text');
  const trashModal = document.getElementById('trash-modal');
  const trashList = document.getElementById('trash-list');
  const trashClose = document.getElementById('trash-close');
  const trashEmptyBtn = document.getElementById('trash-empty');
  const modalNote = document.getElementById('trash-note');

  // Navigasjonsmodal (nav-knappen): områder som kort med mappene sine som
  // rader — samme oppsett og samme dra-og-slipp-motor som lister/listepunkter.
  const navModal = document.getElementById('nav-modal');
  const navModalClose = document.getElementById('nav-modal-close');
  const navBoard = document.getElementById('nav-board');
  const navModalBody = document.getElementById('nav-modal-body');
  const uniTrashBtn = document.getElementById('uni-trash-btn');
  const uniTrashCount = document.getElementById('uni-trash-count');

  // Konto-modal (kontoknappen øverst til høyre).
  const accountBtn = document.getElementById('account-btn');
  const accountModal = document.getElementById('account-modal');
  const accountClose = document.getElementById('account-close');

  const posCmp = (a, b) => (a.pos - b.pos) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  // «Aktive» kort/listepunkter gjelder alltid den aktive mappen; områdene og
  // mappene deres lever i nav-modalen (alle områder vises samtidig, som
  // listekortene på board-et).
  // `_pendingDelete` (buffret sletting, se DELETE-BUFFER lenger nede): objektet
  // er skjult fra de synlige listene og vist i søppel-visningen,
  // men er ENNÅ ikke `trashed` i state og skrives ikke til databasen — det skjer
  // først når toasten utløper (eller committes ved unload). Derfor teller det som
  // «i søppel» for visning, men ikke som aktivt.
  const live = (o) => !o.trashed && !o._pendingDelete;
  const activeUniverseObj = () => state.universes.find((u) => u.id === state.activeUniverse && live(u)) || null;
  // Kortene i nav-modalen, i seksjonsrekkefølge (mine → delte → frie mapper) og
  // med personlig posisjon innenfor hver seksjon.
  const visibleUniverses = () => state.universes.filter(live)
    .sort((a, b) => (sectionRank(a) - sectionRank(b)) || posCmp(a, b));
  // Den virtuelle fri-mappe-beholderen kan aldri slettes, så den holdes utenfor.
  const trashedUniverses = () => state.universes.filter((u) => !live(u) && !u._virtual);
  const findUniverse = (id) => state.universes.find((u) => u.id === id) || null;
  const allGroups = () => { const u = activeUniverseObj(); return u ? u.groups : []; };
  const activeGroupObj = () => allGroups().find((g) => g.id === state.activeGroup && live(g) && !g.isCat) || null;
  // Mappene i ETT område (nav-modalen tegner alle områdene samtidig).
  const groupsOf = (u) => (u && u.groups) || [];
  const visibleGroupsOf = (u) => groupsOf(u).filter(live).sort(posCmp);
  const trashedGroupsOf = (u) => groupsOf(u).filter((g) => !live(g));
  const findGroup = (id) => allGroups().find((g) => g.id === id) || null;
  // Mapper på tvers av ALLE områder (nav-scopet: en mappe kan dras hvor
  // som helst, så oppslag kan ikke være scopet til det aktive området).
  function findGroupAnywhere(id) {
    for (const u of state.universes) {
      const g = u.groups.find((x) => x.id === id);
      if (g) return g;
    }
    return null;
  }
  const allCards = () => { const g = activeGroupObj(); return g ? g.cards : []; };
  const activeCards = () => allCards().filter(live).sort(posCmp);
  const trashedCards = () => allCards().filter((c) => !live(c));
  const findCard = (id) => allCards().find((c) => c.id === id);
  const trashedItemsOf = (cardData) => (cardData.items || []).filter((it) => !live(it));
  function findItemById(id) {
    for (const c of allCards()) {
      const it = c.items.find((x) => x.id === id);
      if (it) return it;
    }
    return null;
  }
  // Kategorier og ukategoriserte elementer deler nivå-1-posisjonsrommet (begge
  // har `cat` falsy); en ny nivå-1-rad legges bakerst der.
  function level1MaxPos(rows) { return maxPos(rows.filter((it) => !it.cat)); }
  // Kategori-objektet et element ligger i (eller null for ukategorisert / ukjent).
  function catOf(cardData, catId) {
    return catId ? cardData.items.find((x) => x.id === catId && x.isCat) || null : null;
  }
  // Antall listepunkter i en kollapset liste (alle aktive leaf-elementer, uansett
  // kategori eller avkryssing — kategorier telles IKKE). Samme regnestykke for
  // et område (aktive mapper, mappekategorier ikke medregnet).
  function leafCount(rows) {
    return rows.filter((it) => live(it) && !it.isCat).length;
  }
  // Antall rader i en kollapset kategori (dens synlige medlemmer på nivå 2).
  function catMemberCount(rows, catId) {
    return rows.filter((it) => live(it) && !it.done && !it.isCat && it.cat === catId).length;
  }
  // Sett kollaps-tellerens tekst og vis/skjul den etter kollaps-tilstand. Lister/
  // listepunkt-kategorier viser «(N)»; områder viser [mappe-ikon] N (`icon`).
  function setCollapseCount(headEl, n, collapsed, icon) {
    const c = headEl && headEl.querySelector('.collapse-count');
    if (!c) return;
    if (icon) c.innerHTML = icon + '<span>' + n + '</span>';
    else c.textContent = '(' + n + ')';
    c.hidden = !collapsed;
  }

  /* ============================================================
     TILGJENGELIGHET — navn, opplesning, fokus og tastaturflytting
     ------------------------------------------------------------
     Fire ting bor her fordi alle fire nivåene deler dem.

     1. NAVN PÅ IKONKNAPPER (`labelBtn`). En skjermleser som går gjennom tjue
        rader leser «Slett listepunkt» tjue ganger uten å si hvilket. Alle
        ikonknapper får derfor objektets navn inn i sitt eget navn. `title`
        settes samtidig, men er aldri alene om jobben: den leses ikke av alle
        skjermlesere og finnes ikke i det hele tatt på touch.

     2. OPPLESNING (`announce`). Et `aria-live`-område nederst i index.html.
        Brukes til det som skjer UTEN at fokus flytter seg — en flytting, en
        sortering — der en seende bruker ser resultatet og en skjermleserbruker
        ellers ikke ville fått vite noe.

     3. FOKUS SOM OVERLEVER EN RENDRING (`keepFocus`/`applyFocusIntent`).
        `renderBoard()` bygger board-et fra bunnen (`innerHTML = ''`), så enhver
        handling som re-rendrer ville sluppet fokus ned til <body>; da mister en
        tastatur-/skjermleserbruker plassen sin i lista. `keepFocus(sel)` noterer
        hva som skal ha fokus etterpå, og `applyFocusIntent()` — kalt sist i
        renderBoard() og renderNav() — setter det på den NYE noden.

     4. TASTATURFLYTTING. Dra-og-slipp er fortsatt den primære hurtigmekanismen;
        dette er en sidestilt inngang, ikke en erstatning. Håndtaket er nøyaktig
        den samme sonen musen drar i (objektets navn-/tittelrad), så det er én
        ting å lære — og det koster ingenting for den som bruker peker:

          Alt + pil opp/ned       flytt objektet ett hakk (sortering)
          Alt + pil venstre/høyre nøyaktig det samme — «forrige/neste» i
                                  leserekkefølgen. Kortene på board-et ligger i
                                  kolonner, så begge aksene er like naturlige å
                                  ta etter, og de skal ikke bety hver sin ting.
          Alt + M                 «Flytt til …» (ny forelder)
          F2                      omdøp (Enter gjør det samme på en rad)

        Sorteringen — den hyppige handlingen — er ett tastetrykk og ligger IKKE
        i noen meny. Bare flytting til en ny forelder åpner en velger, og det er
        en sjelden handling som allerede har nøyaktig samme velger fra draget
        (slipp på 📁-breadcrumben).
     ============================================================ */

  // Objektnavn i anførselstegn, med en trygg fallback for det navnløse.
  function quoted(name) {
    const s = String(name == null ? '' : name).trim();
    return s ? tr('common.quoted', { name: s }) : tr('common.unnamed');
  }
  // aria-label ER navnet på knappen; `title` er kun musehjelp og settes til det
  // samme med mindre kalleren vil ha en lengre forklaring der.
  function labelBtn(btn, label, tooltip) {
    if (!btn) return;
    btn.setAttribute('aria-label', label);
    btn.title = tooltip == null ? label : tooltip;
  }

  const liveRegion = document.getElementById('a11y-live');
  let liveTimer = null;
  function announce(msg) {
    if (!liveRegion || !msg) return;
    clearTimeout(liveTimer);
    // Et live-område leser ikke opp igjen en tekst som er identisk med den som
    // allerede står der. Tøm først, sett rett etterpå — da blir også to like
    // flyttinger på rad lest opp begge to.
    liveRegion.textContent = '';
    liveTimer = setTimeout(() => { liveRegion.textContent = msg; }, 40);
  }

  let focusIntent = null;
  function keepFocus(sel) { focusIntent = sel || null; }
  // Ønsket tømmes KUN når det faktisk ble innfridd. `render()` kjører renderNav()
  // før renderBoard(), og et ønske om et element på board-et finnes ikke ennå når
  // nav-modalen er ferdig — tømte vi her, ville board-rendringen etterpå ikke hatt
  // noe å sette fokus på. `render()` rydder bort det som ikke traff.
  function applyFocusIntent() {
    if (!focusIntent) return;
    let el = null;
    try { el = document.querySelector(focusIntent); } catch (e) { focusIntent = null; return; }
    if (!el) return;
    focusIntent = null;
    try { el.focus(); } catch (e) { /* noden kan ha rukket å forsvinne */ }
  }
  // En selektor som finner IGJEN det fokuserte elementet etter at board-et eller
  // nav-modalen er bygget på nytt. Ikke bare tastaturflyttinger river ned DOM-en:
  // hver bakgrunnssynk som lander kaller render(), og uten dette ville fokus falt
  // til <body> med noen sekunders mellomrom mens man jobber. `data-id` er unik i
  // hele appen, så den alene identifiserer raden; klassen peker ut hvilken kontroll
  // inne i raden det gjaldt.
  function selectorForFocused(el) {
    if (!el || el === document.body || el === document.documentElement) return null;
    if (el.id) return '#' + el.id.replace(/["\\]/g, '\\$&');
    const host = el.closest('[data-id]');
    if (!host || !host.dataset.id) return null;
    const hostSel = '[data-id="' + host.dataset.id.replace(/["\\]/g, '\\$&') + '"]';
    if (el === host) return hostSel;
    // Klassen må være entydig INNE i raden, ellers ville fokus kunne havne på
    // søskenraden sin knapp (alle rader har f.eks. .obj-menu-btn).
    const cls = [].slice.call(el.classList)
      .find((c) => host.querySelectorAll('.' + c).length === 1);
    return cls ? hostSel + ' .' + cls : hostSel;
  }
  // Kalles først i renderBoard()/renderNav(), FØR containeren tømmes.
  function captureFocusIn(root) {
    if (focusIntent || !root) return;
    const a = document.activeElement;
    if (!a || !root.contains(a)) return;
    // Et åpent navnefelt overlever ingen rendring uansett — og å sende fokus
    // tilbake til raden bak ville flyttet markøren bort fra det brukeren skrev.
    if (a.classList && a.classList.contains('edit-input')) return;
    keepFocus(selectorForFocused(a));
  }

  /* ---------------- Fokus i modaler og popovere ----------------
     Alle overlayene sier `aria-modal="true"`, altså «det bak meg finnes ikke».
     Det løftet må holdes, ellers tabber man rett ut i board-et bak og skriver i
     noe man ikke ser. Tre regler, like for alle:
       1. Fokus flyttes INN når overlayen åpnes.
       2. Tab holdes INNE så lenge den er åpen (øverste overlay eier tastaturet).
       3. Fokus går TILBAKE dit det kom fra når den lukkes.

     Koblingen skjer med én MutationObserver per overlay på `hidden`, ikke ved å
     endre de ni åpne-/lukkefunksjonene: modalene skjules fra mange steder (også
     rett `hidden = true` i Escape-håndtereren), og en observatør kan ikke gå
     glipp av en av dem. Omvisningen har sin egen felle (den er ikke en
     `.modal-overlay`) og røres ikke her. */
  const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), ' +
    'select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  // `[inert]` teller som utenfor: en lukket trekkspillskuff har høyde 0 og er
  // usynlig, men elementene i den har fortsatt en offsetParent. Uten dette
  // ville Tab gått gjennom felter ingen kan se.
  function focusablesIn(root) {
    return [].slice.call(root.querySelectorAll(FOCUSABLE))
      .filter((el) => !el.closest('[hidden], [inert]') && el.offsetParent !== null);
  }
  const overlayStack = [];              // åpne overlayer, nederst → øverst
  // overlay → { el, sel }: både selve noden OG en selektor som finner den igjen.
  // Selektoren er nødvendig fordi lukkingen ofte re-rendrer board-et (en endret
  // tid, en flyttet rad), og da er noden vi husket for lengst kastet — uten
  // selektoren falt fokus til <body> hver gang en popover ble lukket.
  const overlayReturn = new WeakMap();

  // Siste element som hadde fokus UTENFOR alle åpne overlayer. Vi kan ikke bare
  // lese `document.activeElement` når en overlay åpner: observatøren er en
  // mikrotask og kjører FØRST når hele åpne-rutinen er ferdig, og flere av dem
  // (tids-popoveren, innstillingsmodalen) fokuserer sitt eget felt synkront på
  // veien. Da ville «hvor kom vi fra» allerede vært inne i overlayen.
  let lastOutsideFocus = null;
  document.addEventListener('focusin', (ev) => {
    const t = ev.target;
    if (!t || t === document.body) return;
    if (t.closest && t.closest('.modal-overlay:not([hidden]), .switcher-overlay:not([hidden])')) return;
    lastOutsideFocus = { el: t, sel: selectorForFocused(t) };
  }, true);

  function overlayOpened(ov) {
    if (overlayStack.indexOf(ov) > -1) return;
    const prev = document.activeElement;
    const from = (prev && prev !== document.body && !ov.contains(prev))
      ? { el: prev, sel: selectorForFocused(prev) }
      : lastOutsideFocus;
    if (from && from.el && !ov.contains(from.el)) overlayReturn.set(ov, from);
    overlayStack.push(ov);
    // Flytt fokus inn — men bare hvis åpne-koden ikke allerede gjorde det selv
    // (bekreftelsesdialogen fokuserer OK-knappen, «Slett konto» sveipefeltet,
    // innstillingsmodalen navnefeltet). Panelet, ikke første knapp: da leser
    // skjermleseren dialogens navn før innholdet, og Tab går videre derfra.
    requestAnimationFrame(() => {
      if (ov.hidden || ov.contains(document.activeElement)) return;
      const panel = ov.querySelector('[role="dialog"], [role="alertdialog"], [role="listbox"]')
        || ov.querySelector('.modal, .switcher-panel');
      if (!panel) return;
      if (!panel.hasAttribute('tabindex')) panel.setAttribute('tabindex', '-1');
      try { panel.focus(); } catch (e) { /* ignorer */ }
    });
  }
  function overlayClosed(ov) {
    const i = overlayStack.indexOf(ov);
    if (i < 0) return;
    overlayStack.splice(i, 1);
    const back = overlayReturn.get(ov);
    overlayReturn.delete(ov);
    // Ligger det fortsatt en overlay åpen og den har fokus, er vi ferdige —
    // ellers ville en lukket topp-modal kastet fokus ut av den under.
    const top = overlayStack[overlayStack.length - 1];
    if (top && top.contains(document.activeElement)) return;
    // Lukkingen kan ha utløst en rendring som byttet ut noden vi husket; da
    // finner selektoren etterfølgeren på samme plass. Ett tick venting, slik at
    // en synkron render() rekker å bli ferdig først.
    const restore = () => {
      if (!back) return false;
      let el = back.el && back.el.isConnected ? back.el : null;
      if (!el && back.sel) { try { el = document.querySelector(back.sel); } catch (e) { el = null; } }
      if (!el || !el.offsetParent) return false;
      try { el.focus(); } catch (e) { return false; }
      return true;
    };
    if (restore()) return;
    requestAnimationFrame(() => {
      if (overlayStack.length) return;   // en ny overlay rakk å åpne seg
      if (document.activeElement && document.activeElement !== document.body) return;
      if (!restore() && top) { overlayReturn.delete(top); overlayOpened(top); }
    });
  }
  document.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Tab' || !overlayStack.length) return;
    if (demoRunning) return; // demoen styrer selv hva som kan nås
    const top = overlayStack[overlayStack.length - 1];
    const f = focusablesIn(top);
    if (!f.length) { ev.preventDefault(); return; }
    const first = f[0], last = f[f.length - 1];
    const cur = document.activeElement;
    if (!top.contains(cur)) { ev.preventDefault(); (ev.shiftKey ? last : first).focus(); return; }
    // Dialogflaten selv (tabindex="-1") er inne i overlayen, men er ikke med i
    // `f`. Uten denne grenen traff hverken `cur === first` eller `cur === last`,
    // og et Shift+Tab som FØRSTE tastetrykk etter åpning falt ut bakover til
    // kontrollen foran modalen i dokumentrekkefølgen.
    if (f.indexOf(cur) < 0) { ev.preventDefault(); (ev.shiftKey ? last : first).focus(); return; }
    if (ev.shiftKey && cur === first) { ev.preventDefault(); last.focus(); }
    else if (!ev.shiftKey && cur === last) { ev.preventDefault(); first.focus(); }
  }, true);
  [].slice.call(document.querySelectorAll('.modal-overlay, .switcher-overlay')).forEach((ov) => {
    if (!ov.hidden) overlayOpened(ov);
    new MutationObserver(() => (ov.hidden ? overlayClosed(ov) : overlayOpened(ov)))
      .observe(ov, { attributes: true, attributeFilter: ['hidden'] });
  });

  // Tastaturhåndtaket til et objekt — samme sone musen drar i. Brukes både til å
  // legge fokus tilbake etter en rendring og til å sende fokus videre til en
  // nabo etter en sletting.
  function handleSelector(kind, id) {
    const q = '[data-id="' + String(id).replace(/["\\]/g, '\\$&') + '"]';
    if (kind === 'item') return '.item' + q;
    if (kind === 'category' || kind === 'groupcat') return '.category' + q + ' > .cat-head';
    if (kind === 'card') return '.card:not(.uni-card)' + q + ' > .card-head';
    if (kind === 'group') return '.item.group-row' + q;
    if (kind === 'universe') return '.uni-card' + q + ' > .card-head';
    return null;
  }

  // Hvor fokus skal lande når et objekt fjernes (slettet, oppløst, flyttet
  // vekk): naboen under, ellers naboen over, ellers en fornuftig kontroll i
  // containeren. Må kalles FØR objektet forsvinner ut av state/DOM.
  function focusTargetAfterRemoval(kind, id, cont) {
    const ctx = moveCtx(kind, id);
    const rows = ctx ? ctx.rows : [];
    const i = rows.findIndex((r) => r.id === id);
    const nb = i < 0 ? null : (rows[i + 1] || rows[i - 1]);
    if (nb) return handleSelector(nb.isCat ? (kind === 'group' ? 'groupcat' : 'category') : kind, nb.id);
    // Tom container: ＋-knappen er det nærmeste stedet det gir mening å stå.
    const q = (o) => '[data-id="' + String(o.id).replace(/["\\]/g, '\\$&') + '"]';
    if ((kind === 'item' || kind === 'category') && cont) return '.card' + q(cont) + ' .add-item-btn';
    if ((kind === 'group' || kind === 'groupcat') && cont) return '.uni-card' + q(cont) + ' .add-item-btn';
    if (kind === 'card') return '#nav-crumb';
    if (kind === 'universe') return '.nav-add-uni button';
    return null;
  }

  /* ---------------- Rekkefølge og flytting fra tastatur ---------------- */

  // Radene i en container i VISUELL rekkefølge. Samme regnestykke som
  // buildCard()/buildUniverseCard() bruker når de bygger DOM-en — inkludert at
  // en rad hvis `cat` peker på en kategori som ikke finnes, regnes som nivå 1.
  //   'leaf'   → bladradene (listepunkt/mappe), kategoriene pakket ut
  //   'level1' → nivå-1-radene (ukategoriserte blad + kategorier om hverandre)
  function orderedRows(S, cont, mode) {
    if (!cont) return [];
    const rows = S.rowsOf(cont).filter(live);
    const catIds = new Set(rows.filter((r) => r.isCat).map((r) => r.id));
    const level1 = rows.filter((r) => r.isCat || !r.cat || !catIds.has(r.cat)).sort(posCmp);
    if (mode === 'level1') return level1;
    const out = [];
    level1.forEach((r) => {
      if (!r.isCat) { if (!r.done) out.push(r); return; }
      rows.filter((m) => !m.isCat && !m.done && m.cat === r.id).sort(posCmp)
        .forEach((m) => out.push(m));
    });
    return out;
  }

  // Skriv en ny posisjon med NØYAKTIG den regelen dra-motoren bruker ved slipp:
  // et objekt med `_canon` (områder og frie mapper) har PERSONLIG rekkefølge
  // og skrives til min egen medlemskapsrad; alt annet stemples i synk-doc'et.
  function commitPos(obj, kind, np) {
    obj.pos = np;
    if (obj._canon) cloudPersonalPos(kind === 'universe' ? 'universe' : 'group', obj.id, np);
    else stampPos(obj);
  }

  // Bytt plass på to naboer. Dette ER dra-motorens egen semantikk («≥ 20 %
  // overlapp BYTTER plass», docs/drag-and-drop.md), så et tastetrykk og et kort
  // drag gjør nøyaktig det samme. Containeren (`cat`) byttes sammen med
  // posisjonen: et listepunkt som passerer en kategorigrense havner INNE i
  // kategorien, og medlemmet det passerte havner utenfor — de bytter faktisk
  // plass, i stedet for at den ene forsvinner ut av rekka.
  function swapSiblings(a, b, kind) {
    const ap = a.pos, bp = b.pos;
    const ac = a.cat || null, bc = b.cat || null;
    if (ac !== bc) { a.cat = bc; b.cat = ac; }
    commitPos(a, kind, bp);
    commitPos(b, kind, ap);
  }

  // Har jeg lov til å endre rekkefølgen på dette objektet? Samme gating som
  // `canDrag` i attachHoldDrag på hvert nivå — klientens gating er kun UX og
  // skal feile LUKKET, så en manglende capability betyr «nei».
  function canReorderObj(kind, obj, cont) {
    if (kind === 'item') return !frozen(cont) && !obj.done;
    if (kind === 'category') return !frozen(cont);
    if (kind === 'card') return !frozen(obj) && canAddList(activeGroupObj());
    if (kind === 'group' || kind === 'groupcat') {
      if (cont && cont._virtual) return true;             // fri seksjon: personlig rekkefølge
      return cap(obj, 'reorderInParent', !frozen(obj)) || cap(obj, 'move', false);
    }
    if (kind === 'universe') return true;                 // områderekkefølgen er alltid min egen
    return false;
  }

  // Objektet + containeren + søskenrekka et tastaturtrykk skal jobbe på.
  function moveCtx(kind, id) {
    if (kind === 'item' || kind === 'category') {
      const obj = findItemById(id);
      const cont = obj ? findCard(obj.home) : null;
      if (!obj || !cont) return null;
      return { obj, cont, S: boardScope, name: obj.text,
        rows: orderedRows(boardScope, cont, kind === 'item' ? 'leaf' : 'level1') };
    }
    if (kind === 'card') {
      const obj = findCard(id);
      const g = activeGroupObj();
      if (!obj || !g) return null;
      return { obj, cont: g, S: boardScope, name: obj.title,
        rows: g.cards.filter(live).sort(posCmp) };
    }
    if (kind === 'group' || kind === 'groupcat') {
      const obj = findGroupAnywhere(id);
      const cont = obj ? findUniverse(obj.uni) || obj._parent : null;
      if (!obj || !cont) return null;
      return { obj, cont, S: navScope, name: obj.name,
        rows: orderedRows(navScope, cont, kind === 'group' ? 'leaf' : 'level1') };
    }
    if (kind === 'universe') {
      const obj = findUniverse(id);
      if (!obj) return null;
      // Kun områdene i SAMME seksjon. `visibleUniverses()` sorterer på
      // sectionRank FØR pos, og renderNav() bygger én seksjon om gangen — et
      // bytte over en seksjonsgrense ville derfor ikke flyttet noe dit man ser,
      // bare importert en fremmed pos-verdi inn i seksjonen og stokket om på
      // resten av den.
      const rank = sectionRank(obj);
      return { obj, cont: null, S: navScope, name: obj.name,
        rows: visibleUniverses().filter((u) => !u._virtual && sectionRank(u) === rank) };
    }
    return null;
  }

  // Ett hakk opp/ned (`step` = −1/+1). Selve sorteringen: ingen modal, ingen
  // meny, ingen bekreftelse — som et lite drag.
  function keyboardReorder(kind, id, step) {
    const ctx = moveCtx(kind, id);
    if (!ctx) return;
    if (!canReorderObj(kind, ctx.obj, ctx.cont)) {
      announce(tr('a11y.cannotReorder', { name: quoted(ctx.name) }));
      return;
    }
    const i = ctx.rows.findIndex((r) => r.id === id);
    if (i < 0) return;
    const target = ctx.rows[i + step];
    if (!target) {
      announce(tr(step < 0 ? 'a11y.alreadyFirst' : 'a11y.alreadyLast', { name: quoted(ctx.name) }));
      return;
    }
    if (!canReorderObj(kind, target, ctx.cont)) {
      announce(tr('a11y.cannotSwap', { name: quoted(nameOfAny(target)) }));
      return;
    }
    swapSiblings(ctx.obj, target, kind);
    save();
    keepFocus(handleSelector(kind, id));
    // Kort og områder får farge etter POSISJON, så de må gjennom en full
    // rendring; rader trenger bare sin egen container bygget om.
    if (kind === 'card' || kind === 'universe') render();
    else if (kind === 'group' || kind === 'groupcat') renderNav();
    else { refreshCard(ctx.cont); applyFocusIntent(); }
    announce(tr(step < 0 ? 'a11y.movedUp' : 'a11y.movedDown',
      { name: quoted(ctx.name), pos: i + step + 1, total: ctx.rows.length }));
  }

  // Navnet på et hvilket som helst state-objekt (nivåene bruker ulike felt).
  function nameOfAny(o) { return o && (o.title || o.text || o.name) || ''; }

  /* ---------------- «Flytt til …» (ny forelder) ----------------
     Tastaturets motstykke til de to draget har: en liste slept opp på
     📁-breadcrumben, og et listepunkt/en mappe slept over i en annen
     container. Gjenbruker den samme velger-modalen draget åpner. */
  function keyboardMoveTo(kind, id) {
    if (kind === 'card') {
      const c = findCard(id);
      if (!c) return;
      // `moveTargetGroups` sjekker bare om jeg kan legge lista i MÅL-mappen.
      // Å ta den UT av kildemappen krever i tillegg myndighet der — nøyaktig
      // samme gate som draget har (`canEdit && canAddList(activeGroupObj())` i
      // buildCard). Uten denne kunne Alt+M flytte en frossen liste optimistisk,
      // og først serveren ville sagt nei.
      if (!canReorderObj('card', c, activeGroupObj())) {
        announce(tr('a11y.cannotMoveOutOfGroup', { name: quoted(c.title) }));
        return;
      }
      if (!moveTargetGroups(c).length) {
        announce(tr('a11y.noOtherGroup', { name: quoted(c.title) }));
        return;
      }
      askCardMove(c);
      return;
    }
    if (kind === 'item') {
      const it = findItemById(id);
      const from = it ? findCard(it.home) : null;
      if (!it || !from || it.isCat) return;
      if (frozen(from)) { announce(tr('a11y.listLocked')); return; }
      // Målene: de andre listene i mappen, og kategoriene i listen den ligger i
      // (pluss «utenfor kategori» når den ligger i en). Det dekker begge
      // overføringene draget kan gjøre med et listepunkt.
      const g = activeGroupObj();
      const opts = [];
      if (it.cat) opts.push({ id: 'lvl1:' + from.id, label: tr('move.outOfCategory', { list: from.title }) });
      orderedRows(boardScope, from, 'level1')
        .filter((r) => r.isCat && r.id !== it.cat)
        .forEach((r) => opts.push({ id: 'cat:' + r.id, label: tr('move.toCategory', { name: r.text }) }));
      (g ? g.cards.filter(live).sort(posCmp) : [])
        .filter((c) => c.id !== from.id && !frozen(c))
        .forEach((c) => opts.push({ id: 'card:' + c.id, label: tr('move.toList', { name: c.title }) }));
      if (!opts.length) { announce(tr('a11y.noOtherListOrCategory')); return; }
      openPicker(tr('move.itemPrompt', { name: quoted(it.text) }), opts, '', (choice) => {
        const [what, target] = choice.split(':');
        if (what === 'card') {
          const dest = findCard(target);
          if (!dest || frozen(dest)) return;
          const i = from.items.indexOf(it);
          if (i > -1) from.items.splice(i, 1);
          it.home = dest.id; it.cat = null; it._parent = dest;
          commitPos(it, 'item', level1MaxPos(dest.items) + 1);
          dest.items.push(it);
          save(); render();
          keepFocus(handleSelector('item', it.id)); applyFocusIntent();
          showToast(tr('move.movedTo', { name: quoted(it.text), dest: quoted(dest.title) }));
          announce(tr('a11y.movedToList', { name: quoted(it.text), dest: quoted(dest.title) }));
          return;
        }
        it.cat = what === 'cat' ? target : null;
        commitPos(it, 'item', what === 'cat'
          ? catMemberMaxPos(from.items, target) + 1
          : level1MaxPos(from.items) + 1);
        save(); refreshCard(from);
        keepFocus(handleSelector('item', it.id)); applyFocusIntent();
        announce(tr(what === 'cat' ? 'a11y.movedIntoCategory' : 'a11y.movedOutOfCategory',
          { name: quoted(it.text) }));
      });
      return;
    }
    if (kind === 'group') {
      const g = findGroupAnywhere(id);
      if (!g) return;
      // Å ta mappen UT av området sitt er en flytting, ikke en omrokkering:
      // samme capability som dra-motorens `canExtract` i navScope krever.
      if (!cap(g, 'move', !frozen(g))) {
        announce(tr('a11y.cannotMoveToOtherUniverse', { name: quoted(g.name) }));
        return;
      }
      const opts = visibleUniverses()
        .filter((u) => !u._virtual && u.id !== g.uni && cap(u, 'createGroup', !frozen(u)))
        .map((u) => ({ id: u.id, label: u.name }));
      if (!opts.length) { announce(tr('a11y.noOtherUniverse')); return; }
      openPicker(tr('move.groupPrompt', { name: quoted(g.name) }), opts, '', (uid2) => {
        const dst = findUniverse(uid2);
        const from = g.uni;
        if (!dst) return;
        // Samme optimistiske skritt som dra-slippet gjør, før move_group-RPC-en
        // får avgjøre reparenting vs. kopier-og-slett (se commitGroupMove).
        state.universes.forEach((u) => {
          const i = (u.groups || []).indexOf(g);
          if (i > -1) u.groups.splice(i, 1);
        });
        const np = level1MaxPos(dst.groups) + 1;
        g.uni = dst.id; g.cat = null; g.pos = np; g._parent = dst;
        dst.groups.push(g);
        save(); render();
        keepFocus(handleSelector('group', g.id)); applyFocusIntent();
        announce(tr('a11y.movedToUniverse', { name: quoted(g.name), dest: quoted(dst.name) }));
        commitGroupMove(g, from, dst.id, null, np);
      });
      return;
    }
    announce(tr(kind === 'universe' ? 'a11y.universeIsTop' : 'a11y.categoryCannotMove'));
  }

  /* ---------------- Tastaturhåndtaket på en rad / et korthode ----------------
     Kobles på NØYAKTIG samme element som `attachHoldDrag` får: da er «det du
     drar» og «det du flytter med piltastene» samme sted, og ingen ny kontroll
     legges i UI-et. `rename` er valgfri — mangler den, er F2 uten virkning der. */
  function attachKeyHandle(el, kind, getId, opts) {
    opts = opts || {};
    el.setAttribute('tabindex', '0');
    el.setAttribute('aria-keyshortcuts', 'Alt+ArrowUp Alt+ArrowDown Alt+M F2');
    el.addEventListener('keydown', (ev) => {
      // Bare når håndtaket SELV har fokus: knappene inni raden har sine egne
      // taster, og et navnefelt under redigering skal ha alle sine.
      if (ev.target !== el) return;
      if (ev.target.classList && ev.target.classList.contains('edit-input')) return;
      const id = getId();
      if (!id) return;
      if (ev.altKey && !ev.ctrlKey && !ev.metaKey) {
        const step = (ev.key === 'ArrowUp' || ev.key === 'ArrowLeft') ? -1
          : (ev.key === 'ArrowDown' || ev.key === 'ArrowRight') ? 1 : 0;
        if (step) { ev.preventDefault(); keyboardReorder(kind, id, step); return; }
        // ev.code, ikke ev.key: Alt+M gir «µ» på macOS-tastaturer.
        if (ev.code === 'KeyM') { ev.preventDefault(); keyboardMoveTo(kind, id); return; }
      }
      if (ev.key === 'F2' && opts.rename) { ev.preventDefault(); opts.rename(); return; }
      // Enter på en RAD omdøper (raden har ingen annen handling); på et korthode
      // er Enter allerede kollaps/utvid, og det beholder den.
      if (ev.key === 'Enter' && opts.enterRenames && opts.rename) {
        ev.preventDefault(); opts.rename();
      }
    });
  }

  // Aktiv mappe settes alltid via denne, så per-område-minnet (activeGroups)
  // holdes i takt og man lander på samme mappe når man bytter tilbake.
  function setActiveGroup(id) {
    state.activeGroup = id || null;
    if (state.activeUniverse) state.activeGroups[state.activeUniverse] = state.activeGroup;
    saveNavPref(); // husk posisjonen på kontoen (kontomodus)
  }
  function setActiveUniverse(id) {
    state.activeUniverse = id || null;
    // Mappekategorier er overskrifter, ikke steder man kan stå.
    const vis = visibleGroupsOf(activeUniverseObj()).filter((g) => !g.isCat);
    const remembered = id ? state.activeGroups[id] : null;
    setActiveGroup(remembered && vis.some((g) => g.id === remembered)
      ? remembered
      : (vis[0] ? vis[0].id : null));
  }
  // Naviger til en mappe uansett hvilket område den ligger i (nav-modalen viser
  // alle områdene samtidig, så et mappevalg kan bytte område også).
  const containerIdOf = (g) => (g && g._free ? FREE_UNI_ID : (g && g.uni) || null);
  function goToGroup(g) {
    if (!g || g.isCat) return;
    state.activeUniverse = containerIdOf(g) || state.activeUniverse;
    setActiveGroup(g.id);
  }
  // Den aktive mappen kan ha byttet område mens man stod i den: dratt til et
  // annet område, ekstrahert til et nytt, eller båret med av en mappekategori.
  // `activeGroupObj()` leter bare i det aktive området, så uten dette ville
  // hovedsiden vist «Ingen mapper ennå.» selv om mappen fortsatt finnes.
  // Kalles fra renderBoard() slik at alle veiene inn dekkes av ett sted.
  function followActiveGroup() {
    if (!state.activeGroup) return;
    const g = findGroupAnywhere(state.activeGroup);
    const cont = containerIdOf(g);
    if (!g || g.isCat || !live(g) || !cont || cont === state.activeUniverse) return;
    state.activeUniverse = cont;
    setActiveGroup(g.id);
  }

  /* ---------------- Dra-og-slipp-scope: hovedsidens board vs. nav-modalen ----------------
     Områder og mapper bruker NØYAKTIG samme oppsett — og dermed nøyaktig
     samme dra-og-slipp-motor — som lister og listepunkter: et område er et
     «kort» (`.card`), en mappe en rad (`.item`) og en mappekategori en
     `.category`. `drag.kind` er derfor fortsatt 'card'/'item'/'category' i begge
     scopene; det eneste som skiller dem er hvilket state-tre man slår opp i, hva
     forelder-/navnefeltene heter, og hvor draget foregår (hovedsidens board med
     dokument-koordinater + window-scroll, vs. nav-modalens board med viewport-
     koordinater + modal-scroll). Alt det bor her; `drag.scope` velges ved
     dragstart ut fra hvilket board det løftede elementet ligger i. */
  const boardScope = {
    key: 'board',
    contKind: 'card', rowKind: 'item',
    pageCoords: true,                 // absolutt posisjonering i dokument-koordinater
    get root() { return board; },
    containers: () => activeCards(),
    findContainer: (id) => findCard(id) || null,
    findRow: (id) => findItemById(id),
    rowsOf: (c) => c.items,
    setRows: (c, rows) => { c.items = rows; },
    rowParent: (r) => r.home,
    setRowParent: (r, id) => { r.home = id; },
    rowName: (r) => r.text,
    setRowName: (r, v) => { r.text = v; },
    rowPool: () => {
      const p = {};
      allCards().forEach((c) => c.items.forEach((it) => { p[it.id] = it; }));
      return p;
    },
    // Ny container ved ekstrahering (listepunkt/kategori → ny liste). Krever
    // opprettelsesrett i mappen — se canExtract.
    canExtract: () => canAddList(activeGroupObj()),   // `row` er uten betydning her
    createContainer: (title) => {
      const g = activeGroupObj();
      if (!canAddList(g)) return null;
      const nc = card(title, [], g.id);
      g.cards.push(nc);
      return nc;
    },
    countIcon: null,                  // «(N)»
    refreshContainer: (c) => refreshCard(c),
    // Full re-rendring etter en strukturendring (ekstrahering/kryss-flytting).
    render: () => render(),
    // Overflate-oppdatering etter et kirurgisk drop (ingen rebuild av scopet).
    afterDrop: () => { /* board-et er allerede riktig */ },
    reindexColors: () => reindexContainerColors(boardScope),
    lockedTargetMsg: tr('dnd.listLocked'),  // avvist slipp i en frossen mål-container
  };
  const navScope = {
    key: 'nav',
    contKind: 'universe', rowKind: 'group',
    pageCoords: false,                // fast posisjonering (modalen scroller, ikke vinduet)
    get root() { return navBoard; },
    singleColumn: true,               // nav-modalen har alltid én kolonne
    containers: () => visibleUniverses(),
    findContainer: (id) => findUniverse(id),
    findRow: (id) => findGroupAnywhere(id),
    rowsOf: (u) => u.groups,
    setRows: (u, rows) => { u.groups = rows; },
    rowParent: (r) => r.uni,
    setRowParent: (r, id) => { r.uni = id; },
    rowName: (r) => r.name,
    setRowName: (r, v) => { r.name = v; },
    rowPool: () => {
      const p = {};
      state.universes.forEach((u) => u.groups.forEach((g) => { p[g.id] = g; }));
      return p;
    },
    // Ny container ved ekstrahering (mappe/mappekategori → nytt område). Det
    // NYE området blir alltid mitt, men å ta mappen UT av det gamle er en
    // flytting: `move_group` krever destruktiv myndighet i kilden. En låst mappe
    // kan altså omrokkeres i området sitt, men ikke løftes ut av det.
    canExtract: (row) => !!row && cap(row, 'move', !frozen(row)),
    createContainer: (name) => {
      const nu = makeUniverse(name);
      state.universes.push(nu);
      return nu;
    },
    get countIcon() { return ICONS.folder; }, // [mappe] N i stedet for «(N)»
    refreshContainer: (u) => {
      // Erstattes på plass i den ene kolonnen; ingen omfordeling å gjøre
      // (nav-scopet er alltid énkolonne), og scopet observeres ikke.
      const oldEl = navBoard.querySelector('.card[data-id="' + u.id + '"]');
      if (oldEl) oldEl.replaceWith(buildUniverseCard(u));
    },
    render: () => render(),
    // Et mappe-drag kan ha flyttet den AKTIVE mappen til et annet område (eller
    // inn i/ut av en kategori) — hovedsidens board og breadcrumben må følge med.
    // renderNav() kalles bevisst IKKE: nav-DOM-en er allerede kirurgisk oppdatert,
    // og en rebuild ville revet ned kortet midt i drop-animasjonen.
    afterDrop: () => { updateCrumbs(); renderBoard(); },
    reindexColors: () => reindexContainerColors(navScope),
    lockedTargetMsg: tr('dnd.universeLocked'),
  };
  const scopeForEl = (el) => (el && navBoard.contains(el) ? navScope : boardScope);
  const dragScope = () => drag.scope || boardScope;

  /* ---------------- Render ---------------- */
  // Søppelkasse-badgen (område/mappe/liste): antall, og knappen skjules når
  // kassen er tom. Delt av de tre faste knappene (element-nivået er annerledes
  // — se updateItemsTrashBadge, som slår opp badgen i DOM).
  // Kassen vises kun når den har innhold — med unntak av et pågående drag som
  // har avdekket den som slippmål (`data-drag-revealed`, se armDragTrash).
  function updateTrashBadge(trashedSel, countEl, btnEl) {
    const list = trashedSel();
    countEl.textContent = list.length;
    if (!btnEl.dataset.dragRevealed) btnEl.hidden = list.length === 0;
  }
  // Lister-søppelkassen vises kun når den har innhold (samme logikk som de andre).
  function updateTrashCount() { updateTrashBadge(trashedCards, trashCount, trashBtn); }

  /* ---------------- Board-kolonner: fyll venstre kolonne først ----------------
     Kolonnene er ekte containere (`.board-col`), og JS fordeler kortene i dem.
     Regelen er grådig og rent leserekkefølge-basert: fyll kolonne 1 til
     kolonnebudsjettet er brukt opp, så kolonne 2, osv. En ny kolonne oppstår
     altså først når den forrige er full — ikke som CSS multi-column, som
     BALANSERER (tre lister → tre kolonner med én liste hver).

     Budsjettet er skjermhøyden under toppmenyen. Får ikke alt plass i de
     kolonnene vinduet har rom til, økes budsjettet til det minste som holder
     (binærsøk) — kolonnene blir høyere, siden scroller, og den øverste lista i
     kolonne 2 glir ned som den nederste i kolonne 1.

     For DnD er dette ikke bare kosmetikk: med ekte kolonner kan en placeholder
     lagt i én kolonne ikke lenger dytte kort over i en annen. Med multi-column
     gjorde den det, og siden svaret på «hvilken liste er objektet i?»
     (`dragOverCard`) leses av den layouten placeholderen selv former, vekslet
     plasseringen frem og tilbake for hver piksel. Se `docs/drag-and-drop.md`.

     Fordelingen er FROSSET mens et drag pågår: kortene skal ligge i ro under
     fingeren, og en omfordeling midt i et drag ville gitt tilbake nettopp den
     tilbakekoblingen vi ble kvitt. Den kjøres på nytt ved slipp.

     Maskineriet er SCOPE-BEVISST (`boardScope`/`navScope`): nav-modalens board
     bruker det samme, bare med `singleColumn` — én kolonne uansett bredde. */
  const BOARD_COL_MIN = 380;   // minste kolonnebredde (var `.board { column-width }`)
  const BOARD_COL_MIN_H = 240; // nedre grense for kolonnebudsjettet (svært lav skjerm)

  const boardGap = (root) => parseFloat(getComputedStyle(root || board).columnGap) || 0;
  const boardColumns = (root) => [...(root || board).children].filter((c) => c.classList.contains('board-col'));
  // Board-et et element hører til (hovedsiden eller nav-modalen).
  const boardRootOf = (el) => (el && el.closest('.board')) || board;
  // Alle board-rader (kort + evt. ny-liste-placeholder) i LESEREKKEFØLGE:
  // kolonne 1 topp→bunn, så kolonne 2 … . DOM-rekkefølgen ER leserekkefølgen,
  // så `pos` kan fortsatt regnes fra naboene — men naboen over den første raden
  // i en kolonne ligger i kolonnen FØR, ikke i samme container.
  // En «board-rad» er et kort eller kortets placeholder under draging — ikke
  // nav-modalens seksjonsoverskrifter/tom-tilstander, som ligger i den samme
  // kolonnen men aldri er dra-mål.
  const isBoardRow = (el) => el.classList.contains('card') || el.classList.contains('card-placeholder');
  function boardRows(root) {
    const out = [];
    // Seksjonsoverskrifter/tom-tilstander i nav-modalen er ikke dra-rader.
    for (const col of boardColumns(root)) out.push(...[...col.children].filter(isBoardRow));
    return out;
  }
  function boardRowSibling(el, dir) {
    const rows = boardRows(boardRootOf(el));
    const i = rows.indexOf(el);
    return i < 0 ? null : (rows[i + dir] || null);
  }
  // Hvor mange kolonner får plass? Samme terskel som den gamle `column-width`.
  // Nav-modalen er alltid én kolonne (`S.singleColumn`).
  function boardColumnCount(S) {
    if (S.singleColumn) return 1;
    const gap = boardGap(S.root);
    return Math.max(1, Math.floor((S.root.clientWidth + gap) / (BOARD_COL_MIN + gap)));
  }
  // Grådig fordeling: neste rad blir liggende i gjeldende kolonne så lenge den
  // får plass innenfor budsjettet. Avstanden mellom radene er kortenes egen
  // margin-bottom (= --board-gap).
  function packBoardColumns(heights, gap, budget) {
    const cols = [[]];
    let used = 0;
    heights.forEach((h, i) => {
      const cur = cols[cols.length - 1];
      if (cur.length && used + gap + h > budget) { cols.push([i]); used = h; return; }
      used += (cur.length ? gap : 0) + h;
      cur.push(i);
    });
    return cols;
  }
  function boardColumnBudget(heights, gap, n) {
    if (n <= 1) return Infinity; // én kolonne: alt havner der uansett
    // Budsjettet er én SKJERMHØYDE under toppmenyen. Gestelinjen dekker de
    // nederste pikslene av viewportet, så de er ikke skjerm man kan bruke —
    // uten leddet blir kolonnen for høy, og siste kort i den havner under
    // linja (safeInsets() er null i en nettleser).
    const vh = window.innerHeight || document.documentElement.clientHeight || 0;
    const screen = Math.max(BOARD_COL_MIN_H,
      Math.round(vh - topbarEl.getBoundingClientRect().height - safeInsets().bottom - 2 * gap));
    if (packBoardColumns(heights, gap, screen).length <= n) return screen;
    // Alt får ikke plass på én skjermhøyde per kolonne → finn den minste høyden
    // som gjør det (monotont: større budsjett gir aldri flere kolonner).
    let lo = screen;
    let hi = heights.reduce((a, h) => a + h, 0) + gap * Math.max(0, heights.length - 1);
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (packBoardColumns(heights, gap, mid).length <= n) hi = mid; else lo = mid + 1;
    }
    return lo;
  }
  let relayoutPending = false;
  let relayoutRAF = null;
  function scheduleRelayout() {
    if (relayoutRAF != null) return;
    relayoutRAF = requestAnimationFrame(() => { relayoutRAF = null; relayoutBoard(boardScope); });
  }
  // Hold observatørens mål i takt med kortene som faktisk står på board-et.
  // `render()` river alle kortnodene (`board.innerHTML = ''`) og `refreshCard()`
  // bytter ut enkeltnoder — uten dette ville observasjonene av de gamle nodene
  // blitt liggende og hopet seg opp for hver render (denne appen re-rendrer ved
  // hver synk). Å `observe()` et mål som allerede observeres er en no-op per spec,
  // så re-observeringen kan ikke gi en ny runde med callbacks. Settet er PER SCOPE.
  // Et ÉNKOLONNE-scope (nav-modalen) observeres ikke i det hele tatt: fordelingen
  // kan aldri endre seg av en høyde-endring når det bare finnes én kolonne, og
  // `renderNav()` kaller `relayoutBoard` selv når den bygger kortene.
  function observeBoardRows(S, rows) {
    if (!boardRO || S.singleColumn) return;
    const seen = S._observed || (S._observed = new Set());
    const now = new Set(rows);
    seen.forEach((el) => {
      if (now.has(el)) return;
      boardRO.unobserve(el);
      seen.delete(el);
    });
    rows.forEach((el) => {
      if (seen.has(el)) return;
      boardRO.observe(el);
      seen.add(el);
    });
  }
  function relayoutBoard(scope) {
    const S = scope || boardScope;
    if (drag.active) return;                            // frosset under draging
    // Ett scope med bare én kolonne har ingenting å fordele — og i nav-modalen
    // ligger seksjonsoverskriftene i den samme kolonnen, så en omfordeling
    // ville flyttet kortene bort fra overskriften sin.
    if (S.singleColumn) return;
    if (S.root.classList.contains('empty')) { observeBoardRows(S, []); return; }
    // En node som flyttes i DOM mister fokus (og markøren i et navnefelt). Er
    // man midt i å skrive, venter vi til feltet forlates (`focusout` under).
    const focused = document.activeElement;
    if (focused && S.root.contains(focused) &&
        (focused.tagName === 'INPUT' || focused.tagName === 'TEXTAREA' || focused.isContentEditable)) {
      relayoutPending = true;
      return;
    }
    relayoutPending = false;
    const want = boardColumnCount(S);
    let cols = boardColumns(S.root);
    // Riktig antall kolonner FØRST: kolonnebredden — og dermed korthøydene vi
    // straks måler — avhenger av antallet.
    if (cols.length !== want) {
      const rows = boardRows(S.root);
      while (cols.length > want) cols.pop().remove();
      while (cols.length < want) {
        const c = document.createElement('div');
        c.className = 'board-col';
        S.root.appendChild(c);
        cols.push(c);
      }
      if (rows.length) cols[0].append(...rows);
    }
    const rows = boardRows(S.root);
    observeBoardRows(S, rows);
    if (!rows.length) return;
    const gap = boardGap(S.root);
    const heights = rows.map((el) => el.offsetHeight);
    const plan = packBoardColumns(heights, gap, boardColumnBudget(heights, gap, cols.length));
    cols.forEach((col, j) => {
      const next = (plan[j] || []).map((i) => rows[i]);
      const cur = [...col.children];
      // Skriv bare kolonner som faktisk endrer innhold — ellers ville hver
      // ResizeObserver-runde flyttet noder (og drept fokus/animasjoner) uten grunn.
      if (cur.length === next.length && next.every((el, k) => cur[k] === el)) return;
      col.append(...next);
    });
  }
  // Korthøyder endres av mye (kollaps, listepunkter inn/ut, tekst som brytes om) —
  // én observatør fanger alt. Fordelingen skrives bare når den faktisk endrer seg,
  // så observatøren kan ikke gå i løkke med seg selv. Board-ene selv observeres
  // permanent (bredde-endringer); kortene reconciles av `observeBoardRows`.
  const boardRO = typeof ResizeObserver === 'function' ? new ResizeObserver(scheduleRelayout) : null;
  if (boardRO) boardRO.observe(board);
  board.addEventListener('focusout', () => { if (relayoutPending) scheduleRelayout(); });

  // Full re-rendring: nav-modalen (områder/mapper) + hovedsidens board.
  function render() {
    renderNav();
    renderBoard();
    // Nav-modalen kan være lukket (renderNav() returnerer da tidlig), og board-et
    // kan ha vært tomt — siste sjanse til å innfri ønsket før det forkastes.
    applyFocusIntent();
    focusIntent = null; // begge lagene har hatt sjansen; et ubrukt ønske skal ikke bli liggende
  }

  // Kun hovedsidens board (+ toppmeny/filter/søppelkasse). Brukes etter et drag
  // i nav-modalen: DOM-en der er allerede kirurgisk oppdatert av dra-motoren, og
  // en full renderNav() ville revet ned det nettopp slupne kortet midt i
  // drop-animasjonen.
  // Fokusønsket må innfris uansett hvilken vei rendringen tar. Innmaten under
  // har flere tidlige returer (ingen mappe, ingen lister), og nettopp DA er
  // ønsket viktigst: sletter man den siste lista, er det den tomme tilstanden
  // fokus skal lande i — ikke <body>. Derfor ligger applyFocusIntent() her, i
  // innpakningen, i stedet for på hver enkelt utgang.
  function renderBoard() {
    captureFocusIn(board); // hvor fokus sto, FØR board-et rives ned
    renderBoardInner();
    applyFocusIntent();
  }
  function renderBoardInner() {
    followActiveGroup();
    updateTrashCount();
    updateToolbarState();

    board.innerHTML = '';
    const group = activeGroupObj();
    updateCrumbs();

    // Ingen aktiv mappe (evt. heller ikke noe område — «＋ Mappe» ordner begge).
    if (!group) {
      board.classList.add('empty');
      const es = document.createElement('div');
      es.className = 'empty-state';
      es.innerHTML = '<div class="big">' + ICONS.folder + '</div><p>' + tr('empty.noGroups') + '</p>' +
        '<p>' + tr('empty.noGroupsHint', {
          nav: '<span class="hint-chip">' + ICONS.globe + ' › ' + ICONS.folder + '</span>',
          plus: '<span class="hint-chip">' + ICONS.plus + '</span>',
        }) + '</p>';
      board.appendChild(es);
      fixBoardBottomGap();
      save();
      return;
    }

    const active = activeCards();
    // Posisjonsbasert farge: kortene re-fargelegges her (etter add/slett/omrokkering)
    // ut fra sin indeks i den synlige, sorterte lista.
    active.forEach((c, i) => { c.color = colorForIndex(i); });
    const cards = active;

    if (cards.length === 0) {
      board.classList.add('empty');
      const es = document.createElement('div');
      es.className = 'empty-state';
      const big = document.createElement('div'); big.className = 'big'; big.innerHTML = ICONS.list;
      const p1 = document.createElement('p');
      p1.textContent = tr('empty.noCards', { name: quoted(group.name) });
      const p2 = document.createElement('p');
      // «＋ Liste» er skrudd av i en låst mappe — da skal tomtilstanden si
      // hvorfor, ikke be om et trykk som ikke fører noe sted.
      if (canAddList(group)) {
        p2.innerHTML = tr('empty.noCardsHint',
          { plus: '<span class="hint-chip">' + ICONS.plus + ' ' + ICONS.list + '</span>' });
      } else {
        big.innerHTML = ICONS.lock;
        p2.textContent = tr('empty.groupLocked');
      }
      es.append(big, p1, p2);
      board.appendChild(es);
      fixBoardBottomGap();
      maybeContextualTips(0);
      save();
      return;
    }

    board.classList.remove('empty');
    // Alle kortene i leserekkefølge i én kolonne; `relayoutBoard` måler høydene
    // og fordeler dem utover kolonnene vinduet har plass til.
    const col = document.createElement('div');
    col.className = 'board-col';
    cards.forEach((c) => col.appendChild(buildCard(c)));
    board.appendChild(col);
    relayoutBoard();
    fixBoardBottomGap();
    // De avanserte gestene introduseres først når de er relevante (INTRODUKSJON).
    maybeContextualTips(cards.length);
    save();
  }

  // «＋ Liste» krever en aktiv mappe man faktisk kan opprette lister i: i en
  // LÅST mappe avviser serveren opprettelsen, og en lokalt opprettet liste ble
  // stående som et spøkelse — låst av mappelåsen, altså umulig å redigere eller
  // slette igjen. Knappen skrus av i stedet, som «＋ Mappe» i et låst område.
  function updateToolbarState() {
    addCardBtn.disabled = !canAddList(activeGroupObj());
  }

  // Breadcrumben (nav-knappen) viser navnet på gjeldende område og mappe, ikke
  // bare nivånavnet — så man alltid ser hvor i hierarkiet man er.
  // Breadcrumben følger den faste ikonrekkefølgen
  // `[ressursikon][delt-ikon ved behov] Ressursnavn`, aldri med mappeikonet to
  // ganger. En FRI mappe (delt direkte med meg, uten tilgang til det kanoniske
  // området) får en virtuell rot: `[delt-ikon] Delte mapper` — ingen
  // områdeikon, siden det ikke er noe område jeg kan se.
  function setCrumbShared(el, on, label) {
    el.hidden = !on;
    el.innerHTML = on ? ICONS.people : '';
    if (on) el.title = label;
    el.setAttribute('aria-hidden', on ? 'false' : 'true');
    if (on) el.setAttribute('aria-label', label); else el.removeAttribute('aria-label');
  }
  function updateCrumbs() {
    const uni = activeUniverseObj();
    const group = activeGroupObj();
    const free = !!(group && group._free);
    crumbUniIcon.innerHTML = free ? '' : ICONS.globe;
    crumbUniName.textContent = free ? S_TEXT.freeSection : (uni ? uni.name : tr('kind.universe'));
    setCrumbShared(crumbUniShared, free || !!(uni && uni._shared),
      free ? tr('section.sharedGroups') : tr('crumb.universeShared'));
    crumbGroupIcon.innerHTML = ICONS.folder;
    crumbGroupName.textContent = group ? group.name : tr('kind.group');
    setCrumbShared(crumbGroupShared, !!(group && group._shared), tr('crumb.groupShared'));
  }

  // Delings-/låse-status (kontomodus): toggler .is-shared og fyller .share-badge
  // (lås hvis frosset av andre, ellers «people»-ikon). Returnerer {shared, canEdit}
  // som byggerne gjenbruker — canEdit gater redigering; kort-byggerne toggler
  // dessuten .is-locked selv.
  function applyShareBadge(el, obj) {
    // AKTIVT delt = mer enn én bruker har effektiv tilgang. Ventende
    // invitasjoner teller ikke (serveren regner ut `shared` slik).
    const shared = !!obj._shared;
    const canEdit = !frozen(obj);
    el.classList.toggle('is-shared', shared);
    if (shared) {
      const badge = el.querySelector('.share-badge');
      badge.hidden = false;
      badge.innerHTML = !canEdit ? ICONS.lock : ICONS.people;
      badge.title = tr(obj._role === 'owner' ? 'share.withOthers' : 'share.withYou');
    }
    return { shared, canEdit };
  }

  /* ============================================================
     NAV-MODALEN: områder som kort, mapper som rader
     ------------------------------------------------------------
     Nøyaktig samme oppsett som hovedsidens board — bare alltid i én kolonne:
     hvert område er et `.card` (kan kollapses, viser da [mappe] N), mappene
     er `.item`-rader i kortets `.items-container`, og mappekategorier er
     `.category`-rader med sin egen hylle. Dermed gjelder også hele dra-og-
     slipp-motoren (reorder, flytt mellom områder, ekstraher til nytt
     område, peek-åpning, skillelinjer) uten en eneste egen kodelinje —
     se `navScope` over. */
  // Overskriften til én av de tre seksjonene: [ikon][ikon] Tittel.
  function navSectionHead(rank) {
    const h = document.createElement('h3');
    h.className = 'nav-section-head';
    h.dataset.section = String(rank);
    const icons = document.createElement('span');
    icons.className = 'nav-section-icons';
    icons.setAttribute('aria-hidden', 'true');
    if (rank === SECTION_OWNED) icons.innerHTML = ICONS.globe + ICONS.profile;
    else if (rank === SECTION_SHARED) icons.innerHTML = ICONS.globe + ICONS.people;
    else icons.innerHTML = ICONS.folder + ICONS.people;
    const txt = document.createElement('span');
    txt.textContent = S_TEXT.sections[rank];
    h.append(icons, txt);
    return h;
  }
  function renderNav() {
    updateUniversesTrash();
    updateCrumbs();
    captureFocusIn(navBoard); // hvor fokus sto, FØR modalens board rives ned
    // Modalen scroller i `#nav-modal-body`, og å rive board-et ned nullstiller
    // den. Sletter man et område ved å dra det i kassen, står man NEDERST (der
    // kassen er) — uten dette ville man blitt kastet til toppen og måtte
    // scrolle ned igjen for å tømme den. Sto man nederst, skal man BLI nederst
    // selv om lista ble kortere; ellers holdes den samme avstanden fra toppen.
    const keepScroll = navScrollState();
    navBoard.innerHTML = '';
    // Bygg kortene bare når modalen faktisk er åpen: en usett DOM-kopi av alle
    // områder/mapper koster ved hver render, og ville dessuten gitt doble
    // treff for `.card`/`.item` på tvers av de to board-ene.
    if (navModal.hidden) return;
    const vis = visibleUniverses();
    // Samme posisjonsbaserte fargesystem som listekortene (den virtuelle
    // fri-beholderen teller ikke med — den har ingen egen farge).
    vis.filter((u) => !u._virtual).forEach((u, i) => { u.color = colorForIndex(i); });
    navBoard.classList.toggle('empty', !vis.length);
    // Samme kolonne-container som hovedsidens board, bare at nav-scopet alltid
    // holder seg til ÉN kolonne (`singleColumn`). Seksjonsoverskriftene ligger
    // som egne rader i kolonnen — DnD-motoren hopper over dem (se `boardRows`).
    const col = document.createElement('div');
    col.className = 'board-col';
    // De to områdeseksjonene vises alltid (også tomme, med tom-tilstand);
    // fri-seksjonen kun når man faktisk har direkte delte mapper.
    [SECTION_OWNED, SECTION_SHARED, SECTION_FREE].forEach((rank) => {
      const inSection = vis.filter((u) => sectionRank(u) === rank);
      if (rank === SECTION_FREE && !inSection.length) return;
      col.appendChild(navSectionHead(rank));
      if (!inSection.length) {
        const es = document.createElement('p');
        es.className = 'nav-section-empty';
        es.textContent = tr(rank === SECTION_OWNED ? 'empty.noOwnUniverses' : 'empty.noSharedUniverses');
        col.appendChild(es);
      }
      inSection.forEach((u) => col.appendChild(buildUniverseCard(u)));
      // «Nytt område» hører KUN hjemme i «Mine områder».
      if (rank === SECTION_OWNED) col.appendChild(navAddUniverseRow());
    });
    navBoard.appendChild(col);
    relayoutBoard(navScope);
    applyFocusIntent(); // samme grunn som i renderBoard: modalen bygges fra bunnen
    // ETTER fokuseringen: `focus()` scroller elementet inn i visningen, og ville
    // ellers dratt visningen bort fra der brukeren faktisk sto.
    restoreNavScroll(keepScroll);
  }
  // Scrollposisjonen i nav-modalen over en ombygging. `atBottom` skilles ut
  // fordi en kortere liste har en ny bunn: den samme piksel-verdien ville da
  // ikke lenger vært nederst.
  function navScrollState() {
    if (!navModalBody) return null;
    const max = navModalBody.scrollHeight - navModalBody.clientHeight;
    return { top: navModalBody.scrollTop, atBottom: max > 0 && max - navModalBody.scrollTop <= 4 };
  }
  function restoreNavScroll(s) {
    if (!navModalBody || !s) return;
    if (s.atBottom) navModalBody.scrollTop = navModalBody.scrollHeight;
    else if (s.top) navModalBody.scrollTop = s.top;
  }
  // ＋-knappen for et nytt område, plassert nederst i «Mine områder».
  function navAddUniverseRow() {
    const wrap = document.createElement('div');
    wrap.className = 'nav-add-uni';
    const b = document.createElement('button');
    b.className = 'btn-add btn-solid btn-green'; b.type = 'button';
    b.title = tr('nav.newUniverse'); b.setAttribute('aria-label', tr('nav.newUniverse'));
    b.innerHTML = ICONS.plus + ' ' + ICONS.globe;
    b.addEventListener('click', () => addUniverse());
    wrap.appendChild(b);
    return wrap;
  }

  function buildUniverseCard(u) {
    const el = fromTemplate(uniCardTpl);
    el.dataset.id = u.id;

    // Den virtuelle fri-beholderen får ingen posisjonsfarge — den er en seksjon,
    // ikke et område (den nøytrale flaten kommer fra `.free-groups-card`).
    if (!u._virtual) {
      const base = u.color || colorForId(u.id);
      paintCardColor(el, base);
    }

    const isFree = !!u._virtual;   // «Mapper delt med meg» — ikke et ekte område
    el.classList.toggle('free-groups-card', isFree);
    const canEdit = applyShareBadge(el, u).canEdit && !isFree;
    el.classList.toggle('is-locked', !canEdit && !isFree);
    const isActiveUni = u.id === state.activeUniverse;
    el.classList.toggle('active', isActiveUni);
    // Som for mapperaden: ringen alene forteller ikke en skjermleser noe.
    if (isActiveUni) el.setAttribute('aria-current', 'true');
    else el.removeAttribute('aria-current');
    // [ressursikon]([delt-ikon])Navn — samme rekkefølge som breadcrumben.
    el.querySelector('.uni-icon').innerHTML = isFree ? ICONS.people : ICONS.globe;

    const titleEl = el.querySelector('.card-title');
    titleEl.textContent = u.name;
    const canRename = canEdit && cap(u, 'editContent');
    const renameUni = () => {
      if (!canRename) return;
      editText(titleEl, u.name, (val) => {
        u.name = val || tr('common.noName');
        titleEl.textContent = u.name;
        stampContent(u);
        save();
        updateCrumbs();
        labelUniControls();
      });
    };
    // Navnet omdøpes IKKE lenger ved klikk (menyen gjør det): et klikk på
    // tittelen kollapser kortet, som et klikk hvor som helst ellers på hodet.
    setRenameHook(titleEl, canRename ? renameUni : null);

    // Én menyknapp erstatter del-/forlat-/slett-knappene. Innholdet i menyen
    // gates av de samme capabilities som knappene gjorde.
    const head = el.querySelector('.card-head');
    const menuBtn = el.querySelector('.obj-menu-btn');
    const canDelUni = !isFree && cap(u, 'delete');
    // Fri-beholderen er en SEKSJON, ikke et område: den kan verken omdøpes,
    // deles, flyttes eller slettes, så den har ingen meny å åpne.
    if (isFree) menuBtn.hidden = true;
    attachObjMenu(menuBtn, {
      kind: 'universe',
      id: u.id,
      scope: navScope,
      rename: canRename ? renameUni : null,
      share: isFree ? null : () => {
        closeNavModal();
        openShare('universe', u.id, findUniverse(u.id) || u, openNavModal);
      },
      remove: canDelUni ? () => deleteUniverse(findUniverse(u.id) || u) : null,
      removeLabel: tr('menu.deleteUniverseForAll'),
    });

    // Draging + rullgardin-kollaps: nøyaktig som et listekort.
    head.setAttribute('aria-expanded', u.collapsed ? 'false' : 'true');
    // Områdenes rekkefølge er PERSONLIG — alle medlemmer kan dra dem. Den
    // virtuelle fri-beholderen står i ro.
    if (!isFree) {
      attachHoldDrag(head, el, startCardDrag, () => true, '.obj-menu-btn');
      attachKeyHandle(head, 'universe', () => u.id, { rename: canRename ? renameUni : null });
    }
    head.addEventListener('click', (ev) => {
      if (ev.target.closest('.obj-menu-btn, .edit-input')) return;
      toggleCardCollapsed(el, u, navScope);
    });
    // Tastatur: korthodet er fokuserbart (tittelen er det ikke), så Enter/
    // Mellomrom gjør det samme som et klikk på hodet — åpner/lukker området.
    head.addEventListener('keydown', (ev) => {
      if (ev.target !== head) return; // del-/slett-knappene har egen tastaturoppførsel
      if (ev.key !== 'Enter' && ev.key !== ' ' && ev.key !== 'Spacebar') return;
      ev.preventDefault();
      toggleCardCollapsed(el, u, navScope);
    });

    // Mappene: nivå 1 (ukategoriserte + mappekategorier om hverandre), nivå 2
    // inne i hver mappekategori. Samme regler som listepunkter i en liste.
    const list = el.querySelector('.items-container');
    const active = u.groups.filter(live);
    const catIds = new Set(active.filter((g) => g.isCat).map((g) => g.id));
    const level1 = active.filter((g) => g.isCat || !g.cat || !catIds.has(g.cat)).sort(posCmp);
    level1.forEach((g) => list.appendChild(g.isCat ? buildGroupCategory(g, u) : buildGroupRow(g, u)));

    // ＋ = ny mappe, gul knapp = ny mappekategori. Begge oppretter objektet med
    // én gang og åpner navneredigereren på det (som i en liste).
    const addRow = el.querySelector('.add-item-row');
    // Mapper og mappekategorier opprettes kun der man har opprettelsesrett —
    // aldri i fri-seksjonen (de mappene har allerede et kanonisk område).
    if (isFree || !cap(u, 'createGroup', canEdit)) addRow.hidden = true;
    const addRowNow = (obj, rowEl, titleSel) => {
      obj.pos = level1MaxPos(u.groups) + 1;
      stampContent(obj);
      stampPos(obj);
      u.groups.push(obj);
      list.appendChild(rowEl);
      save();
      nameNewRow(obj, u, rowEl, rowEl.querySelector(titleSel), navScope);
    };
    addRow.querySelector('.add-item-btn').addEventListener('click', () => {
      if (addRow.hidden) return;
      const g = makeGroup('', null, u.id);
      addRowNow(g, buildGroupRow(g, u), '.item-text');
    });
    addRow.querySelector('.add-cat-btn').addEventListener('click', () => {
      if (addRow.hidden) return;
      const gc = makeGroupCategory('', u.id);
      addRowNow(gc, buildGroupCategory(gc, u), '.cat-title');
    });

    // Mappe-søppelkassen: i området sitt, akkurat som listepunkt-søppelkassen
    // ligger i lista si (område-søppelkassen ligger nederst i modalen). Bygges
    // ALLTID (skjult når tom), så et mappe-drag kan vise den fram som slippmål.
    // Fri-beholderen er ingen ekte forelder og har ingen kasse.
    const trashedGroups = isFree ? [] : trashedGroupsOf(u);
    if (!isFree) {
      const gTrashWrap = document.createElement('div');
      gTrashWrap.className = 'item-trash';
      gTrashWrap.hidden = !trashedGroups.length;
      const gTrashBtn = document.createElement('button');
      gTrashBtn.type = 'button';
      gTrashBtn.className = 'trashcan group-trash-btn';
      gTrashBtn.title = tr('trash.groupsBtnTitle');
      gTrashBtn.setAttribute('aria-label',
        tr('trash.groupsCountIn', { count: trashedGroups.length, name: quoted(u.name) }));
      const gIcon = document.createElement('span');
      gIcon.className = 'trashcan-icon';
      gIcon.setAttribute('aria-hidden', 'true');
      gIcon.innerHTML = ICONS.trash;
      const gCount = document.createElement('span');
      gCount.className = 'trashcan-count';
      gCount.textContent = trashedGroups.length;
      gTrashBtn.append(gIcon, gCount);
      attachTrashHold(gTrashBtn, {
        count: () => trashedGroupsOf(findUniverse(u.id) || u).length,
        open: () => openGroupsTrash(u.id),
        empty: () => emptyGroupsTrash(u.id),
      });
      gTrashWrap.appendChild(gTrashBtn);
      el.querySelector('.card-body').appendChild(gTrashWrap);
    }

    // Presise navn på områdekortets knapper. «Slett området for alle» er den
    // mest inngripende knappen i appen — den skal aldri være anonym.
    function labelUniControls() {
      const n = quoted(u.name);
      const label = isFree ? u.name : tr('label.universe', { name: n });
      head.setAttribute('aria-label', label);
      el.setAttribute('aria-label', label); // se buildCard
      labelBtn(menuBtn, tr('label.menuUniverse', { name: n }));
      labelBtn(addRow.querySelector('.add-item-btn'), tr('label.addGroupIn', { name: n }));
      labelBtn(addRow.querySelector('.add-cat-btn'), tr('label.addGroupCatIn', { name: n }));
    }
    labelUniControls();

    if (u.collapsed) {
      collapseCardBody(el);
      setCollapseCount(head, leafCount(u.groups), true, ICONS.folder);
    }
    return el;
  }

  // En mappe er en rad som et listepunkt — men uten avmerkingsboks (mapper
  // krysses ikke av) og med del-knapp i stedet for tannhjul.
  function buildGroupRow(g, u) {
    const el = fromTemplate(groupRowTpl);
    el.dataset.id = g.id;
    const canEdit = !frozen(g);
    const isActive = g.id === state.activeGroup;
    el.classList.toggle('active', isActive);
    // Aktiv posisjon var kun en ring — altså usynlig for en skjermleser.
    // `aria-current` sier det samme uten å legge noe i UI-et.
    if (isActive) el.setAttribute('aria-current', 'true');
    else el.removeAttribute('aria-current');
    applyShareBadge(el, g);
    el.querySelector('.group-icon').innerHTML = ICONS.folder; // [mappe]([delt])Navn

    const textEl = el.querySelector('.item-text');
    textEl.textContent = g.name;
    const rename = () => {
      if (!canEdit) return;
      editText(textEl, g.name, (val) => {
        g.name = val || tr('common.noName');
        textEl.textContent = g.name;
        stampContent(g);
        save();
        updateCrumbs();
        labelGroupControls();
      });
    };
    const navigate = () => {
      goToGroup(g);
      renderNav();     // aktiv-markeringen flytter seg
      renderBoard();
      closeNavModal();
    };
    // Navnet omdøpes IKKE lenger ved klikk: omdøping og navigering kjempet om
    // det samme trykket. Klikk hvor som helst på raden — navnet inkludert —
    // navigerer nå; omdøping ligger i menyen (og på F2).

    // Klikk på raden (ikke menyknappen) = gå til mappen og lukk modalen.
    el.addEventListener('click', (ev) => {
      if (ev.target.closest('.obj-menu-btn, .edit-input')) return;
      navigate();
    });
    // Tastatur: raden er eneste fokuserbare punkt, og Enter/Mellomrom gjør nå
    // det samme som et klikk — navigerer. (Omdøping: F2, eller menyen.)
    el.addEventListener('keydown', (ev) => {
      if (ev.target !== el) return; // menyknappen har egen tastaturoppførsel
      if (ev.key !== 'Enter' && ev.key !== ' ' && ev.key !== 'Spacebar') return;
      ev.preventDefault();
      navigate();
    });

    // Én menyknapp: deling, lås, forlat, omdøp, flytt og sletting.
    const menuBtn = el.querySelector('.obj-menu-btn');
    const canDelGroup = cap(g, 'delete', canEdit);
    attachObjMenu(menuBtn, {
      kind: 'group',
      id: g.id,
      scope: navScope,
      rename: canEdit ? rename : null,
      share: () => {
        closeNavModal();
        openShare('group', g.id, findGroupAnywhere(g.id) || g, openNavModal);
      },
      remove: canDelGroup ? () => deleteGroup(findGroupAnywhere(g.id) || g) : null,
      removeLabel: tr('menu.deleteGroupForAll'),
    });

    // En fri mappe ordnes PERSONLIG (alltid dragbar); en mappe i et område
    // krever rett til å endre områdets struktur.
    attachHoldDrag(el, el, startItemDrag,
      () => (u && u._virtual) || cap(g, 'reorderInParent', canEdit) || cap(g, 'move', false),
      '.obj-menu-btn');
    // Raden er også mappens tastaturhåndtak. Enter/Mellomrom beholder sin
    // eksisterende betydning (naviger / omdøp i den aktive mappen) — F2 og
    // Alt-tastene legger seg ved siden av den.
    attachKeyHandle(el, 'group', () => g.id, { rename });
    setRenameHook(textEl, canEdit ? rename : null);

    // Presise navn: nav-modalen kan ha mange mapper, og «Slett mappen for
    // alle» må si HVILKEN før man trykker.
    function labelGroupControls() {
      const n = quoted(g.name);
      el.setAttribute('aria-label', tr('label.group', { name: n }));
      labelBtn(menuBtn, tr('label.menuGroup', { name: n }));
    }
    labelGroupControls();
    return el;
  }

  // Mappekategori: samme kategori-rad som i en liste, men uten innstillinger og
  // uten deling — kun oppløs-knappen (og ＋ for en ny mappe rett i kategorien).
  function buildGroupCategory(catData, u) {
    const el = fromTemplate(groupCatTpl);
    el.dataset.id = catData.id;
    const canEdit = !frozen(catData);

    el.querySelector('.cat-drag-icon').innerHTML = ICONS.groupCategory;

    const titleEl = el.querySelector('.cat-title');
    titleEl.textContent = catData.name || tr('kind.category');
    const renameGroupCat = () => {
      if (!canEdit) return;
      editText(titleEl, catData.name, (val) => {
        catData.name = val || tr('kind.category');
        titleEl.textContent = catData.name;
        stampContent(catData);
        save();
        labelGroupCatControls();
      });
    };
    titleEl.addEventListener('click', renameGroupCat);
    setRenameHook(titleEl, canEdit ? renameGroupCat : null);

    // Å løse opp en mappekategori er dens «sletting»: mappene blir stående.
    const dissolveGroupCat = () => {
      const live = findGroupAnywhere(catData.id) || catData;
      keepFocus(focusTargetAfterRemoval('groupcat', live.id, u));
      dissolveCategory(live, findUniverse(u.id) || u, navScope);
      applyFocusIntent();
    };
    const catHead = el.querySelector('.cat-head');
    const menuBtn = el.querySelector('.obj-menu-btn');
    attachObjMenu(menuBtn, {
      kind: 'groupcat',
      id: catData.id,
      scope: navScope,
      rename: canEdit ? renameGroupCat : null,
      remove: canEdit ? dissolveGroupCat : null,
      removeLabel: tr('menu.dissolveGroupCat'),
      removeIcon: ICONS.bubbleBurst,
    });

    attachHoldDrag(catHead, el, startCategoryDrag, () => canEdit, '.obj-menu-btn');
    catHead.addEventListener('click', (ev) => {
      if (ev.target.closest('.cat-title, .obj-menu-btn, .edit-input')) return;
      toggleCatCollapsed(el, catData, u, navScope);
    });
    catHead.setAttribute('role', 'button');
    catHead.setAttribute('aria-expanded', catData.collapsed ? 'false' : 'true');
    attachKeyHandle(catHead, 'groupcat', () => catData.id, { rename: renameGroupCat });
    catHead.addEventListener('keydown', (ev) => {
      if (ev.target !== catHead) return;
      if (ev.key !== 'Enter' && ev.key !== ' ' && ev.key !== 'Spacebar') return;
      ev.preventDefault();
      toggleCatCollapsed(el, catData, u, navScope);
    });

    const inner = el.querySelector('.cat-items');
    const addWrap = el.querySelector('.cat-add');
    const members = u.groups.filter((g) => live(g) && !g.isCat && g.cat === catData.id).sort(posCmp);
    members.forEach((g) => inner.appendChild(buildGroupRow(g, u)));
    inner.appendChild(addWrap); // ＋-knappen sist, under siste mappe

    const addBtn = el.querySelector('.cat-add-btn');
    if (!canEdit) addWrap.hidden = true;
    else addBtn.addEventListener('click', () => addRowToCategory(catData, u, el, navScope));

    function labelGroupCatControls() {
      const n = quoted(catData.name);
      labelBtn(menuBtn, tr('label.menuGroupCat', { name: n }));
      labelBtn(addBtn, tr('label.addGroupInCat', { name: n }));
      catHead.setAttribute('aria-label', tr('label.groupcat', { name: n }));
    }
    labelGroupCatControls();

    if (catData.collapsed) {
      collapseCatBody(el);
      setCollapseCount(el.querySelector('.cat-head'), members.length, true);
    }
    return el;
  }

  // Finnes ikke noe aktivt område (helt fersk / alt slettet), opprettes et nytt
  // standard-område i farten. (Ny tilfeldig id, ikke den faste migrerings-id-en,
  // så en evt. gravstein ikke dreper det.)
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

  // Programmatisk «ny mappe» (feilsøking/tester + tom-tilstanden): oppretter en
  // mappe med standardnavn i det aktive området. UI-veien er ＋-knappen i
  // områdekortet, som i stedet oppretter tomt og navngir på plassen.
  function addGroup() {
    const u = ensureUniverse();
    const g = makeGroup(tr('nav.newGroup'), null, u.id);
    g.pos = level1MaxPos(u.groups) + 1;
    stampContent(g);
    stampPos(g);
    u.groups.push(g);
    setActiveGroup(g.id);
    render();
    return g;
  }

  // Forlat et område eller en mappe: fjerner KUN min egen tilgang, aldri
  // innholdet. Optimistisk — objektet forsvinner straks, RPC-en ligger i køen.
  async function leaveObject(type, obj) {
    const word = tr(type === 'universe' ? 'kindDef.universe' : 'kindDef.group');
    if (!await askConfirm({
      title: tr('leave.title', { kind: word }),
      message: tr('leave.message', { name: quoted(obj.name || tr('common.theObject')) }),
      okLabel: tr('leave.ok'),
    })) return;
    removeSharedLocally(obj.id);
    cloudLeave(type, obj.id);
    render();
    save();
  }

  // Slett en mappe → legg i områdets mappe-søppelkasse (trashed-flagg;
  // gjenopprettbar). Permanent sletting skjer først når søppelkassen tømmes.
  function deleteGroup(groupData) {
    const uni = findUniverse(groupData.uni) || activeUniverseObj();
    const ghost = ghostFrom(navBoard.querySelector('.item[data-id="' + groupData.id + '"]'));
    keepFocus(focusTargetAfterRemoval('group', groupData.id, uni));
    bufferDelete(groupData, 'group', (g) => setTrashed(g, 'group', true));
    if (state.activeGroup === groupData.id) {
      const first = visibleGroupsOf(activeUniverseObj()).filter((g) => !g.isCat)[0];
      setActiveGroup(first ? first.id : null);
    }
    render(); // mappe-søppelkassen blir synlig FØR animasjonen starter
    flyGhost(ghost, uni ? navBoard.querySelector(
      '.card[data-id="' + uni.id + '"] .group-trash-btn') : null);
    pushDeleteToast('group', groupData.id, groupData.name);
  }

  // Tøm ett områdes mappe-søppelkasse permanent: gravsteiner for hver slettet
  // mappe + alle dens lister + elementer (hindrer gjenoppstandelse).
  function emptyGroupsTrash(uniId) {
    const u = findUniverse(uniId);
    if (!u) return;
    // Rader jeg ikke rår over utelates ALLEREDE fra commitBufferedFor: en buffret
    // sletting som rekker å bli låst i angre-vinduet (en annen eier låser mappen
    // mens toasten står) skal ikke committes til en `trashed = true` serveren
    // avviser — det ville kastet angre-muligheten og lagt igjen en skriving som
    // ble forsøkt på nytt ved hver synk-runde.
    commitBufferedFor(trashedGroupsOf(u).filter(canPurgeGroup).map((g) => g.id));
    const trash = trashedGroupsOf(u);
    if (!trash.length) return;
    let skipped = 0;
    trash.forEach((g) => {
      // En mappe man ikke kan slette for alle, forlater man i stedet — men bare
      // hvis man FAKTISK kan forlate den (en direkte mapperolle). Er grunnen til
      // at man ikke kan slette en LÅS, finnes det ingen rolle å gi fra seg: da
      // ville «forlat» både blitt avvist av serveren og fjernet mappen lokalt.
      if (!canPurgeGroup(g)) { skipped++; return; }
      const idx = u.groups.indexOf(g);
      if (!canDeleteGroup(g)) {
        if (idx > -1) u.groups.splice(idx, 1);
        cloudLeave('group', g.id);
        return;
      }
      tombSubtree(g, 'group');
      if (idx > -1) u.groups.splice(idx, 1);
    });
    if (skipped) showToast(LOCKED_PURGE_MSG);
    render();
    save();
  }

  /* Slett en liste → felles papirkurv (`trashed`-flagg; permanent først ved
     «Tøm papirkurv»). Slår opp DET LEVENDE kortet på id, så den tåler at en
     synk-rebuild har byttet ut objektet. Delt av objektmenyens «Slett listen»
     og av et slipp i søppelkassen — de to må gjøre nøyaktig det samme. */
  function deleteCard(cardData) {
    const live = findCard(cardData.id) || cardData;
    keepFocus(focusTargetAfterRemoval('card', live.id, activeGroupObj()));
    const ghost = ghostFrom(board.querySelector('.card[data-id="' + live.id + '"]'));
    bufferDelete(live, 'card', (c) => setTrashed(c, 'card', true));
    render(); // søppelkasse-knappen blir synlig FØR animasjonen starter
    flyGhost(ghost, trashBtn);
    pushDeleteToast('card', live.id, live.title);
  }

  /* Slett et listepunkt → kortets element-søppelkasse (gjenopprettbar;
     gravstein først ved tømming). Samme deling som deleteCard: menyen og
     slippet i kassen. */
  function deleteItem(itemData) {
    const owner = findCard(itemData.home);
    const it = owner && owner.items.find((i) => i.id === itemData.id);
    if (!owner || !it) return;
    // Fokus MÅ ha et sted å gå før raden forsvinner: uten dette faller det til
    // <body>, og en skjermleser mister plassen sin i lista.
    keepFocus(focusTargetAfterRemoval('item', it.id, owner));
    const ghost = ghostFrom(board.querySelector('.item[data-id="' + it.id + '"]'));
    bufferDelete(it, 'item', (x) => setTrashed(x, 'item', true));
    refreshCard(owner); // element-søppelkassen dukker opp FØR animasjonen
    applyFocusIntent();
    flyGhost(ghost, board.querySelector(
      '.card[data-id="' + owner.id + '"] .item-trash-btn'));
    pushDeleteToast('item', it.id, it.text);
  }

  function buildCard(cardData) {
    const el = fromTemplate(cardTpl);
    el.dataset.id = cardData.id;

    // Fargen settes normalt av render() (posisjonsbasert); fall tilbake på en
    // stabil id-farge om kortet bygges utenfor en full render.
    const base = cardData.color || colorForId(cardData.id);
    paintCardColor(el, base);

    // Delings-/låse-status (kontomodus). En liste arver delingen fra mappen —
    // den har ingen egen medlemsliste. Delt-indikatoren er en badge i
    // headeren, rett foran tittelen (som områder/mapper), ikke lenger en
    // chip i meta-raden. `.is-shared` styrer ikke lenger noen kant-styling —
    // lista skal se ut som en ikke-delt liste; kun `.is-locked` gir egen
    // kant-styling.
    const grp = nodeOfType(cardData, 'group');
    const shared = !!(grp && grp._shared);
    const canEdit = !frozen(cardData);
    el.classList.toggle('is-shared', !!shared);
    el.classList.toggle('is-locked', !canEdit);
    // Badgen er en ren INDIKATOR (som på områdekort og mapperader) — veien inn
    // til mappens delingsinnstillinger går via objektmenyen.
    const shareBadge = el.querySelector('.share-badge');
    shareBadge.hidden = !shared;
    if (shared) {
      shareBadge.innerHTML = !canEdit ? ICONS.lock : ICONS.people;
      shareBadge.title = tr(grp._role === 'owner' ? 'share.groupWithOthers' : 'share.groupWithYou');
    }

    // Indikator-chips (delt/ansvarlig/start/frist) under tittelen.
    fillMetaRow(el.querySelector('.card-meta'),
      { kind: 'card', obj: cardData, card: cardData }, canEdit);

    const titleEl = el.querySelector('.card-title');
    titleEl.textContent = cardData.title;
    const renameCard = () => {
      if (!canEdit) return;
      editText(titleEl, cardData.title, (val) => {
        cardData.title = val || tr('common.noName');
        titleEl.textContent = cardData.title;
        stampContent(cardData);
        save();
        labelCardControls(); // knappenavnene bærer tittelen — de må følge med
      });
    };
    // Navnet omdøpes IKKE lenger ved klikk (menyen/F2 gjør det): et klikk på
    // tittelen kollapser kortet, som ellers på hodet.
    setRenameHook(titleEl, canEdit ? renameCard : null);

    const headEl = el.querySelector('.card-head');
    const menuBtn = el.querySelector('.obj-menu-btn');
    attachObjMenu(menuBtn, {
      kind: 'card',
      id: cardData.id,
      scope: boardScope,
      rename: canEdit ? renameCard : null,
      // INGEN delerad. En liste kan ikke deles — den arver tilgangen fra mappen
      // (docs/rettigheter-og-deling.md), og en «Deling og medlemmer» i LISTENS
      // meny leses som om det er lista man deler. Delingen hører hjemme der
      // myndigheten ligger: i mappens meny. Delt-status vises fortsatt på
      // kortet (`.share-badge`).
      remove: canEdit ? () => deleteCard(cardData) : null,
      removeLabel: tr('menu.deleteCard'),
    });

    // Kort-draging: trykk-og-hold på korthodet (tittel-delen) unntatt
    // menyknappen. Frosset (låst for meg) → ingen draging.
    // Plasseringen blant søsknene tilhører MAPPEN, så den krever i tillegg rett
    // til å endre mappens innhold: under et lås-unntak på lista alene kan man
    // redigere den, men ikke omrokkere eller flytte den (mapperadene i
    // nav-modalen bruker `reorderInParent` på samme måte). Board-et viser kun den
    // aktive mappens lister, så den slås opp der — ikke via `_parent`, som en
    // nyopprettet liste ennå ikke har.
    attachHoldDrag(headEl, el, startCardDrag,
      () => canEdit && canAddList(activeGroupObj()), '.obj-menu-btn');

    // Klikk på korthodet (ikke menyknapp/meta-chip) kollapser/utvider kortet med
    // en rullgardin-animasjon (et fullført hold løfter i stedet kortet —
    // attachHoldDrag undertrykker da klikket). Lukketilstanden lagres i DB.
    headEl.addEventListener('click', (ev) => {
      if (ev.target.closest('.obj-menu-btn, .meta-chip, .edit-input')) return;
      toggleCardCollapsed(el, cardData);
    });
    // Korthodet er kortets tastaturhåndtak — samme element attachHoldDrag drar i,
    // og samme rolle det allerede har i nav-modalen: Enter/Mellomrom kollapser,
    // Alt+pil sorterer, Alt+M flytter til en annen mappe, F2 omdøper.
    headEl.setAttribute('role', 'button');
    headEl.setAttribute('aria-expanded', cardData.collapsed ? 'false' : 'true');
    attachKeyHandle(headEl, 'card', () => cardData.id, { rename: renameCard });
    headEl.addEventListener('keydown', (ev) => {
      if (ev.target !== headEl) return;
      if (ev.key !== 'Enter' && ev.key !== ' ' && ev.key !== 'Spacebar') return;
      ev.preventDefault();
      toggleCardCollapsed(el, cardData);
    });

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

    // ⟲ helt til høyre på «Utført»-linja: reaktiverer alle utførte på én gang.
    // Skjult i en frosset (låst) liste, som avmerkingsboksene ellers.
    const restoreDoneBtn = el.querySelector('.done-restore');
    if (!canEdit) restoreDoneBtn.hidden = true;
    else restoreDoneBtn.addEventListener('click', () => restoreAllDone(el, cardData));

    // Legg til listepunkt / kategori: to midtstilte knapper, ingen navnefelt.
    // Knappen oppretter objektet med én gang og åpner navneredigereren på det
    // (samme mønster som ＋-knappen inne i en kategori). Avsluttes navngivingen
    // uten tekst, fjernes objektet igjen — se nameNewRow().
    const addRow = el.querySelector('.add-item-row');
    const addBtn = addRow.querySelector('.add-item-btn');
    const addCatBtn = addRow.querySelector('.add-cat-btn');
    if (!canEdit) addRow.hidden = true;

    const addRowNow = (obj, rowEl, titleSel) => {
      obj.pos = level1MaxPos(cardData.items) + 1;
      stampContent(obj);
      stampPos(obj);
      cardData.items.push(obj);
      list.appendChild(rowEl);
      save();
      nameNewRow(obj, cardData, rowEl, rowEl.querySelector(titleSel), boardScope);
    };
    addBtn.addEventListener('click', () => {
      if (!canEdit) return;
      const it = makeItem('', cardData.id);
      addRowNow(it, buildItem(it, cardData), '.item-text');
    });
    addCatBtn.addEventListener('click', () => {
      if (!canEdit) return;
      const cat = makeCategory('', cardData.id);
      addRowNow(cat, buildCategory(cat, cardData), '.cat-title');
    });

    // Element-søppelkasse: midtstilt nederst i kortet. Den BYGGES ALLTID, men
    // står skjult når den er tom — et drag skal kunne vise den fram som
    // slippmål (se armDragTrash), og da må noden finnes.
    const trashed = trashedItemsOf(cardData);
    const trashWrap = document.createElement('div');
    trashWrap.className = 'item-trash';
    trashWrap.hidden = !trashed.length;
    const trashBtnEl = document.createElement('button');
    trashBtnEl.type = 'button';
    trashBtnEl.className = 'trashcan item-trash-btn';
    trashBtnEl.title = tr('trash.itemsBtnTitle');
    trashBtnEl.setAttribute('aria-label',
      tr('trash.itemsCountIn', { count: trashed.length, name: quoted(cardData.title) }));
    const trashIcon = document.createElement('span');
    trashIcon.className = 'trashcan-icon';
    trashIcon.setAttribute('aria-hidden', 'true');
    trashIcon.innerHTML = ICONS.trash;
    const trashCountEl = document.createElement('span');
    trashCountEl.className = 'trashcan-count';
    trashCountEl.textContent = trashed.length;
    trashBtnEl.append(trashIcon, trashCountEl);
    attachTrashHold(trashBtnEl, {
      // Kortet slås opp LIVE: `cardData` er fanget ved bygging, og en
      // synk-rebuild bytter ut state-objektene. Med en foreldet referanse
      // ville `count()` svart 0, sveipefeltet aldri åpnet seg — og det korte
      // trykket åpnet søppelkasse-modalen i stedet for å tømme den.
      count: () => trashedItemsOf(findCard(cardData.id) || cardData).length,
      open: () => openItemsTrash(findCard(cardData.id) || cardData),
      empty: () => emptyItemsTrash(findCard(cardData.id) || cardData),
    });
    trashWrap.appendChild(trashBtnEl);
    el.querySelector('.card-body').appendChild(trashWrap); // i body-en så den kollapser med resten

    // Presise navn på kortets ikonknapper. Uten listenavnet i navnet blir det
    // «Innstillinger for listen» én gang per liste på board-et, uten at
    // skjermleseren sier hvilken. Kalles på nytt etter omdøping.
    function labelCardControls() {
      const n = quoted(cardData.title);
      labelBtn(menuBtn, tr('label.menuCard', { name: n }));
      labelBtn(addBtn, tr('label.addItemIn', { name: n }));
      labelBtn(addCatBtn, tr('label.addCatIn', { name: n }));
      labelBtn(restoreDoneBtn, tr('label.restoreDoneIn', { name: n }));
      headEl.setAttribute('aria-label', tr('label.card', { name: n }));
      // Korthodet er `role="button"`, og en knapp har presentasjonelle barn:
      // <h2>-en inni blir dermed ikke lenger en overskrift man kan hoppe til.
      // Det navngitte <article>-et gir strukturnavigeringen tilbake — nå som en
      // navngitt region i stedet for en overskrift.
      el.setAttribute('aria-label', tr('label.card', { name: n }));
    }
    labelCardControls();

    // Gjenopprett lagret lukketilstand (uten animasjon) etter en (re)bygging.
    if (cardData.collapsed) {
      collapseCardBody(el);
      setCollapseCount(el.querySelector('.card-head'), leafCount(cardData.items), true);
    }

    return el;
  }

  /* ---------------- Liste-kollaps (rullgardin) ----------------
     Klikk på korthodet trekker kort-body-en opp som en rullgardin (samme
     collapse/expand-mekanikk som kategorienes .cat-items). Lukketilstanden
     (`card.collapsed`) lagres i DB via save() (doc-synken/køen), så den overlever
     reload og synkes mellom enheter — uten synlig forsinkelse (optimistisk UI).
     overflow settes kun inline mens/når kollapset: et permanent overflow:hidden
     ville klippet et løftet element under draging. */
  // Åpning/lukking av lister er MOMENTAN (ingen animasjon) — både rullgardinen
  // (klikk på korthodet) og kollaps-alle under DnD. En rullgardin-animasjon gjorde
  // systemet tregere uten å tilføre noe; momentan veksling er like tydelig.
  function collapseCardBody(el) {
    const body = el.querySelector('.card-body');
    if (!body) return;
    el.classList.add('collapsed');
    body.style.overflow = 'hidden';
    body.style.height = '0px'; body.style.opacity = '0';
    body.style.paddingTop = '0'; body.style.paddingBottom = '0';
  }
  function expandCardBody(el) {
    const body = el.querySelector('.card-body');
    if (!body) return;
    el.classList.remove('collapsed');
    body.style.transition = ''; body.style.height = ''; body.style.opacity = '';
    body.style.overflow = ''; body.style.paddingTop = ''; body.style.paddingBottom = '';
  }
  // Veksle lukketilstand + lagre. Tillates alltid (en visnings-preferanse); for et
  // frosset (låst av andre) kort skrives den ikke — serveren ville avvist innholds-
  // endringen — men den lokale visningen veksler uansett.
  function toggleCardCollapsed(el, cardData, scope) {
    const S = scope || boardScope;
    const nowCollapsed = !el.classList.contains('collapsed');
    if (nowCollapsed) collapseCardBody(el); else expandCardBody(el);
    // Kollapset liste viser antall listepunkter «(N)» til høyre for navnet; et
    // kollapset område viser [mappe] + antall mapper (S.countIcon).
    const head = el.querySelector('.card-head');
    setCollapseCount(head, leafCount(S.rowsOf(cardData)), nowCollapsed, S.countIcon);
    // Nav-modalens korthoder er fokuserbare knapper (områder); listekortene på
    // board-et har ingen tastaturrolle, og da står det ingen aria-expanded der.
    if (head.hasAttribute('aria-expanded')) head.setAttribute('aria-expanded', nowCollapsed ? 'false' : 'true');
    cardData.collapsed = nowCollapsed;
    if (!frozen(cardData)) { stampContent(cardData); save(); }
  }

  /* ---------------- Kategori-kollaps (rullgardin) ----------------
     Kategorier kan kollapses/gjenåpnes på samme måte som lister: klikk på
     overskriftslinjen (ikke tittel/tannhjul/oppløs/＋) folder `.cat-items` (og
     ＋-knappen) sammen. MOMENTANT (ingen animasjon, som liste-rullgardinen).
     Lukketilstanden (`cat.collapsed`, et element-felt) lagres/synkes i DB.
     `collapseCategory`/`expandCategory` (lenger nede) er en EGEN, animert variant
     som brukes UNDER kategori-draging — ikke å forveksle med disse. */
  function collapseCatBody(catEl) {
    const inner = catEl.querySelector('.cat-items');
    if (!inner) return;
    catEl.classList.add('collapsed');
    inner.style.overflow = 'hidden';
    inner.style.height = '0px'; inner.style.opacity = '0';
    inner.style.paddingTop = '0'; inner.style.paddingBottom = '0';
  }
  function expandCatBody(catEl) {
    const inner = catEl.querySelector('.cat-items');
    if (!inner) return;
    catEl.classList.remove('collapsed');
    inner.style.transition = ''; inner.style.height = ''; inner.style.opacity = '';
    inner.style.overflow = ''; inner.style.paddingTop = ''; inner.style.paddingBottom = '';
  }
  function toggleCatCollapsed(catEl, catData, cont, scope) {
    const S = scope || boardScope;
    const nowCollapsed = !catEl.classList.contains('collapsed');
    if (nowCollapsed) collapseCatBody(catEl); else expandCatBody(catEl);
    // Kollapset kategori viser antall (skjulte) rader «(N)» ved navnet.
    setCollapseCount(catEl.querySelector('.cat-head'),
      catMemberCount(S.rowsOf(cont), catData.id), nowCollapsed);
    catData.collapsed = nowCollapsed;
    if (!frozen(cont)) { stampContent(catData); save(); }
  }

  // Legg til en ny rad direkte i en kategori (grønn ＋-knapp nederst i kategorien):
  // raden opprettes tom og går straks i navneredigering (blank + fokusert) så den
  // kan navngis med en gang. Avsluttes navngivingen uten navn, fjernes raden igjen
  // (nameNewRow). Samme knapp/oppførsel for listepunkter i en listekategori og
  // mapper i en mappekategori.
  function addRowToCategory(catData, cont, catEl, scope) {
    const S = scope || boardScope;
    if (frozen(cont)) return;
    if (catEl.classList.contains('collapsed')) { expandCatBody(catEl); catData.collapsed = false; }
    const rows = S.rowsOf(cont);
    const row = S === navScope ? makeGroup('', null, cont.id) : makeItem('', cont.id);
    row.cat = catData.id;
    row.pos = catMemberMaxPos(rows, catData.id) + 1;
    stampContent(row);
    stampPos(row);
    rows.push(row);
    const rowEl = S === navScope ? buildGroupRow(row, cont) : buildItem(row, cont);
    appendToItemsEnd(catEl.querySelector('.cat-items'), rowEl);
    save();
    // Åpne navneredigereren straks (blank felt, fokusert).
    nameNewRow(row, cont, rowEl, rowEl.querySelector('.item-text'), S);
  }
  // Største pos blant en kategoris aktive medlemmer (for å legge et nytt bakerst).
  function catMemberMaxPos(rows, catId) {
    return maxPos(rows.filter((r) => live(r) && r.cat === catId));
  }

  // Bygg ett kort på nytt i DOM (etter element-endringer: slett/gjenopprett/tøm).
  // Kun det ene kortet erstattes — de andre står; kolonnefordelingen justeres
  // etterpå fordi det nye kortet kan ha fått en annen høyde.
  function refreshCard(cardData) {
    const oldEl = board.querySelector('.card[data-id="' + cardData.id + '"]');
    if (!oldEl) return;
    oldEl.replaceWith(buildCard(cardData));
    scheduleRelayout(); // ny node → ny høyde, og den gamle observasjonen døde med den
  }

  // Tøm kortets element-søppelkasse permanent: gravstein per slettet element.
  // Buffrede slettinger committes først, så tømming aldri venter på angre-vinduet.
  function emptyItemsTrash(cardData) {
    // Låst liste → serveren avviser slettingen, og en lokal gravstein ville bare
    // skjult listepunktene for meg mens de levde videre for alle andre.
    if (frozen(cardData)) { showToast(LOCKED_PURGE_MSG); return; }
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
     Elementer i en delt liste (eller en liste under en delt mappe/område) får
     en ansvarsknapp: hånd-opp-ikonet → popover/modal med alle i «delegruppen»
     (eier + medlemmer av nærmeste delte forelder). Velger man en ansvarlig,
     erstattes ikonet med en farget sirkel med initialene deres. Fargen følger
     personens alfabetiske plass i delegruppen (samme palett-syklus som resten av
     appen). Ansvaret (`item.responsible`) rir på innholds-registeret og synkes
     som tekst/avkryssing; alle med redigeringstilgang kan endre det. */

  // Nivåtype ut fra formen på state-objektet (kort har items, mappe har cards,
  // område har groups).
  // DELEGRUPPEN til et objekt = MAPPEN det ligger i. Lister, kategorier og
  // listepunkter deles aldri selv — de arver hele mappens effektive medlemsliste
  // (områdeeiere + områdemedlemmer + eksplisitte mappeeiere + direkte
  // mappemedlemmer, deduplisert). Ansvarlig-velgeren bruker nøyaktig den lista.
  function shareRootFor(node) { return nodeOfType(node, 'group'); }

  // Cache av delegrupper per mappe: rootKey → sortert personliste (alfabetisk
  // på navn) + id→indeks-oppslag. Fylles lat via get_members; personens indeks
  // gir paletten (colorForIndex).
  const shareGroupCache = new Map();
  const shareGroupLoading = new Set();
  // Bumpes når det cachede persondataet er blitt foreldet (nytt profilbilde).
  // En henting som allerede var i lufta da det skjedde, kan bære det gamle
  // bildet — den skal ikke få lov til å fylle den nettopp tømte cachen.
  let shareGroupEpoch = 0;
  function rootKey(type, id) { return type + ':' + id; }
  function personEntry(p) {
    return { id: p.id, email: p.email, name: personName(p), avatar: p.avatar || null,
      initials: initialsFromName(p.display_name, p.email) };
  }
  function buildShareGroup(info) {
    const people = (info.members || []).map(personEntry);
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
    const epoch = shareGroupEpoch;
    fetchShareGroup(type, id).then((g) => {
      shareGroupLoading.delete(key);
      if (epoch !== shareGroupEpoch) return; // svaret rakk å bli foreldet
      shareGroupCache.set(key, g);
      render();
    }).catch(() => { shareGroupLoading.delete(key); });
  }

  // En farget sirkel med initialer (ansvarssirkelen). Fargen fra paletten via
  // personens indeks i delegruppen; ukjent person → stabil id-farge.
  function respAvatar(person, index) {
    const s = document.createElement('span');
    s.className = 'resp-avatar';
    paintAvatar(s, person && person.avatar, person ? person.initials : '?');
    /* Sirkelen er en palettflate som males INLINE (ikke av CSS), og paletten
       speiler L-en per drakt. Kilden til fargen stemples derfor på elementet,
       slik at den kan males om ved et draktbytte uten en full rendring — se
       repaintAvatars(). Uten stempelet finnes ikke indeksen igjen: den er
       personens plass i delegruppen, ikke noe som står i DOM-en.
       Den navnløse varianten har en fast grå og stemples ikke. */
    if (index != null && index >= 0) s.dataset.palIndex = String(index);
    else if (person) s.dataset.palId = String(person.id);
    s.style.background = paletteOf(s) || '#8496a6';
    return s;
  }
  // Fargen et stemplet element skal ha NÅ, i den drakten som gjelder.
  function paletteOf(el) {
    if (el.dataset.palIndex != null) return colorForIndex(Number(el.dataset.palIndex));
    if (el.dataset.palId) return colorForId(el.dataset.palId);
    return null;
  }
  // Maler alle stemplede palettflater på nytt (ansvarssirkler på kort, rader,
  // meta-chips og i ansvarlig-velgeren). Kirurgisk: rører kun `background`.
  function repaintAvatars(root) {
    (root || document).querySelectorAll('[data-pal-index], [data-pal-id]').forEach((el) => {
      const c = paletteOf(el);
      if (c) el.style.background = c;
    });
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
  // Månedsnavn og datoformat er språkavhengige: «12. mai» mot «12 May».
  // Listen står som én streng i ordboken (mellomrom skiller) — tolv nøkler
  // per språk ville vært tolv steder å glemme.
  const monthsShort = () => tr('date.monthsShort').split(' ');
  function fmtDay(dateStr) {
    const p = dateStr.split('-').map(Number);
    const yr = p[0] !== new Date().getFullYear() ? String(p[0]) : '';
    return tr(yr ? 'date.dayMonthYear' : 'date.dayMonth',
      { d: p[2], mon: monthsShort()[p[1] - 1] || '', y: yr });
  }
  function fmtTimeFull(v) {
    const clock = timeClockPart(v);
    const day = fmtDay(timeDatePart(v));
    return clock ? tr('date.at', { date: day, clock: clock }) : day;
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
    chip.title = tr(isDue ? 'time.dueLabel' : 'time.startLabel', { time: fmtTimeFull(v) });
    chip.setAttribute('aria-label', canEdit ? tr('chip.tapToChange', { text: chip.title }) : chip.title);
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
    // Delt-indikatoren for lister ligger i korthodet (badge foran tittelen,
    // som områder/mapper), ikke lenger her.
    if (obj.responsible) {
      const shareRoot = shareRootFor(target.card);
      const rType = 'group';
      const group = shareRoot ? shareGroupCache.get(rootKey(rType, shareRoot.id)) : null;
      if (shareRoot && !group) ensureShareGroup(rType, shareRoot.id);
      const entry = group ? group.byId.get(obj.responsible) : null;
      const chip = metaChipEl('meta-resp');
      chip.appendChild(respAvatar(entry ? entry.person : null, entry ? entry.index : -1));
      chip.title = entry ? tr('resp.label', { name: entry.person.name }) : tr('resp.chosen');
      chip.setAttribute('aria-label', tr('chip.tapToChange', { text: chip.title }));
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
    const el = fromTemplate(itemTpl);
    el.dataset.id = itemData.id;
    const canEdit = !frozen(cardData);

    const textEl = el.querySelector('.item-text');
    textEl.textContent = itemData.text;
    const renameItem = () => {
      if (!canEdit) return;
      editText(textEl, itemData.text, (val) => {
        if (!val) return; // tom redigering = ingen endring
        itemData.text = val;
        textEl.textContent = val;
        stampContent(itemData);
        save();
        labelItemControls(); // knappenavnene bærer teksten — de må følge med
      });
    };
    textEl.addEventListener('click', renameItem);
    setRenameHook(textEl, canEdit ? renameItem : null);
    // Raden er tastaturets håndtak: samme element attachHoldDrag får under.
    // Enter omdøper (raden har ingen annen handling), Alt+pil sorterer.
    attachKeyHandle(el, 'item', () => itemData.id, { rename: renameItem, enterRenames: true });

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

    // Draging: trykk-og-hold på elementet unntatt avmerkingsboksen og
    // menyknappen. Avkryssede elementer dras ikke (ligger i «Utført»).
    attachHoldDrag(el, el, startItemDrag,
      () => canEdit && !itemData.done, '.item-check, .obj-menu-btn');

    const menuBtn = el.querySelector('.obj-menu-btn');
    attachObjMenu(menuBtn, {
      kind: 'item',
      id: itemData.id,
      scope: boardScope,
      rename: canEdit ? renameItem : null,
      remove: canEdit ? () => deleteItem(itemData) : null,
      removeLabel: tr('menu.deleteItem'),
    });

    // Presise navn: uten teksten med i navnet leser en skjermleser «Meny»
    // like mange ganger som det finnes rader, uten å si hvilken.
    // Kalles på nytt etter omdøping, så navnene ikke blir stående på gammel tekst.
    function labelItemControls() {
      const n = quoted(itemData.text);
      labelBtn(checkBtn, tr(itemData.done ? 'label.unmarkDone' : 'label.markDone', { name: n }));
      labelBtn(menuBtn, tr('label.menuItem', { name: n }));
      // Raden får bevisst INGEN aria-label: den er et `listitem`, og et navn her
      // ville erstattet innholdet — da forsvant indikator-chipene (ansvarlig,
      // start, frist) fra opplesningen når raden får fokus. Teksten i raden ER
      // navnet.
    }
    labelItemControls();

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
    const el = fromTemplate(catTpl);
    el.dataset.id = catData.id;
    const canEdit = !frozen(cardData);

    // Kategori-ikon — kun synlig mens kategorien dras (venstre for tittelen, se
    // .category.dragging i styles.css), så det løftede kortet leser som en
    // kategori mot den hvite dra-flaten.
    el.querySelector('.cat-drag-icon').innerHTML = ICONS.category;

    const titleEl = el.querySelector('.cat-title');
    titleEl.textContent = catData.text || tr('kind.category');
    const renameCat = () => {
      if (!canEdit) return;
      editText(titleEl, catData.text, (val) => {
        catData.text = val || tr('kind.category');
        titleEl.textContent = catData.text;
        stampContent(catData);
        save();
        labelCatControls();
      });
    };
    titleEl.addEventListener('click', renameCat);
    setRenameHook(titleEl, canEdit ? renameCat : null);

    // Oppløs kategorien: elementene blir stående som ukategoriserte på samme
    // plass. Dette ER kategoriens «sletting» — både i menyen og i sveipet.
    const dissolveThisCat = () => {
      const owner = findCard(cardData.id) || cardData;
      const live = findItemById(catData.id) || catData;
      keepFocus(focusTargetAfterRemoval('category', live.id, owner));
      dissolveCategory(live, owner, boardScope);
      applyFocusIntent();
    };

    const catHead = el.querySelector('.cat-head');
    const menuBtn = el.querySelector('.obj-menu-btn');
    attachObjMenu(menuBtn, {
      kind: 'category',
      id: catData.id,
      scope: boardScope,
      rename: canEdit ? renameCat : null,
      remove: canEdit ? dissolveThisCat : null,
      removeLabel: tr('menu.dissolveCategory'),
      removeIcon: ICONS.bubbleBurst,
    });

    // Draging: trykk-og-hold på overskriftslinjen unntatt menyknappen.
    attachHoldDrag(catHead, el, startCategoryDrag, () => canEdit, '.obj-menu-btn');

    // Klikk på overskriftslinjen (ikke tittel/meny/meta) kollapser/utvider
    // kategorien med en rullgardin (som lister). Et fullført hold løfter i
    // stedet kategorien — attachHoldDrag undertrykker da klikket.
    catHead.addEventListener('click', (ev) => {
      if (ev.target.closest('.cat-title, .obj-menu-btn, .meta-chip, .edit-input')) return;
      toggleCatCollapsed(el, catData, cardData, boardScope);
    });
    // Overskriftslinjen er kategoriens tastaturhåndtak — samme sone som draget.
    catHead.setAttribute('role', 'button');
    catHead.setAttribute('aria-expanded', catData.collapsed ? 'false' : 'true');
    attachKeyHandle(catHead, 'category', () => catData.id, { rename: renameCat });
    catHead.addEventListener('keydown', (ev) => {
      if (ev.target !== catHead) return;
      if (ev.key !== 'Enter' && ev.key !== ' ' && ev.key !== 'Spacebar') return;
      ev.preventDefault();
      toggleCatCollapsed(el, catData, cardData, boardScope);
    });

    fillMetaRow(el.querySelector('.cat-meta'),
      { kind: 'category', obj: catData, card: cardData }, canEdit);

    const inner = el.querySelector('.cat-items');
    const addWrap = el.querySelector('.cat-add');
    const members = cardData.items.filter((it) => !it.trashed && !it._pendingDelete &&
      !it.done && !it.isCat && it.cat === catData.id).sort(posCmp);
    members.forEach((it) => inner.appendChild(buildItem(it, cardData)));
    inner.appendChild(addWrap); // flytt ＋-knappen til sist, under det siste listepunktet

    // Grønn ＋-knapp inni hylle-fordypningen: nytt listepunkt direkte i kategorien.
    const addBtn = el.querySelector('.cat-add-btn');
    if (!canEdit) addWrap.hidden = true;
    else addBtn.addEventListener('click', () => addRowToCategory(catData, cardData, el, boardScope));

    // Presise navn: en liste kan ha flere kategorier, og «Oppløs kategorien» sier
    // ingenting om hvilken. Kalles på nytt etter omdøping.
    function labelCatControls() {
      const n = quoted(catData.text);
      labelBtn(menuBtn, tr('label.menuCategory', { name: n }));
      labelBtn(addBtn, tr('label.addItemInCat', { name: n }));
      catHead.setAttribute('aria-label', tr('label.category', { name: n }));
    }
    labelCatControls();

    // Gjenopprett lagret lukketilstand (uten animasjon) etter en (re)bygging.
    if (catData.collapsed) {
      collapseCatBody(el);
      setCollapseCount(el.querySelector('.cat-head'), members.length, true);
    }
    return el;
  }

  // «Slutten» av en items-container: rett FØR den grønne ＋-knappen for en
  // `.cat-items` (som selv ligger sist i containeren), ellers null (containerens
  // faktiske siste barn, f.eks. `.items-container`).
  function itemsEndAnchor(cont) {
    return cont.classList.contains('cat-items') ? cont.querySelector('.cat-add') : null;
  }
  // Legg `node` sist blant listepunktene, uten å havne etter en ev. ＋-knapp.
  function appendToItemsEnd(cont, node) {
    const anchor = itemsEndAnchor(cont);
    if (anchor) cont.insertBefore(node, anchor); else cont.appendChild(node);
  }
  // Er `node` allerede på siste plass blant listepunktene (samme forbehold)?
  function isAtItemsEnd(cont, node) {
    const anchor = itemsEndAnchor(cont);
    return anchor ? anchor.previousElementSibling === node : cont.lastElementChild === node;
  }

  // Oppløs en kategori: radene beholder rekkefølge og «arver» kategoriens plass i
  // nivå-1-lista (fordeles jevnt i pos-gapet mellom kategorien og neste nivå-1-rad),
  // blir ukategoriserte, og selve kategori-raden tombstones + fjernes. Samme
  // regnestykke for listekategorier og mappekategorier (scope gir rad-lista).
  function dissolveCategory(catData, cont, scope) {
    const S = scope || boardScope;
    const rows = S.rowsOf(cont);
    const cat = rows.find((x) => x.id === catData.id && x.isCat);
    if (!cat) return;
    const level1 = rows.filter((r) => live(r) && !r.done && !r.cat).sort(posCmp);
    const idx = level1.findIndex((o) => o.id === cat.id);
    const startP = cat.pos || 0;
    const nextP = idx > -1 && idx + 1 < level1.length ? level1[idx + 1].pos : null;
    const members = rows.filter((r) => r.cat === cat.id && !r.isCat);
    const active = members.filter((r) => live(r) && !r.done).sort(posCmp);
    const n = active.length;
    active.forEach((r, i) => {
      r.cat = null;
      r.pos = nextP == null ? startP + (i + 1) : startP + (nextP - startP) * ((i + 1) / (n + 1));
      stampPos(r);
    });
    // Avkryssede/slettede medlemmer: bare løsne fra kategorien (beholder pos).
    members.filter((r) => !live(r) || r.done).forEach((r) => {
      r.cat = null;
      stampPos(r);
    });
    tombSubtree(cat, S.rowKind); // gravstein hindrer at kategorien gjenoppstår ved synk
    const ci = rows.indexOf(cat);
    if (ci > -1) rows.splice(ci, 1);
    S.refreshContainer(cont);
    save();
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

    placeItemBySection(cardEl, cardData, itemEl, itemData);

    // Skjul seksjonen igjen hvis den ble tom (siste element reaktivert).
    if (!doneUl.querySelector('.item')) doneWrap.hidden = true;

    // En KOLLAPSET kategori teller bare sine ikke-utførte medlemmer, så «(N)» blir
    // stående feil når et medlem krysses av/reaktiveres mens kategorien er lukket.
    refreshAllCollapseCounts();

    if (!reduce) flipFrom(snap, DONE_FLIP_MS);
    save();
  }

  // Flytt en element-rad til seksjonen `done` tilsier, innsatt på pos-sortert
  // plass. Ved reaktivering av et kategorisert element går det tilbake INN i
  // kategorien sin (om den fortsatt finnes), ellers til nivå 1.
  function placeItemBySection(cardEl, cardData, itemEl, itemData) {
    const destUl = itemData.done ? cardEl.querySelector('.items-done')
      : ((itemData.cat && cardEl.querySelector('.category[data-id="' + itemData.cat + '"] .cat-items'))
        || cardEl.querySelector('.items-container'));
    // Kun DIREKTE barn, og kategori-radene teller med: en kategoris medlemmer er
    // ETTERKOMMERE av .items-container, så et etterkommer-søk kunne plukke et
    // nivå-2-listepunkt som `ref` (insertBefore hadde da kastet NotFoundError),
    // og kategoriene opptar sine egne pos-plasser på nivå 1 — hopper man over
    // dem, havner raden på feil side av en kategori med høyere pos.
    let ref = null;
    for (const s of destUl.querySelectorAll(':scope > .item, :scope > .category')) {
      if (s === itemEl) continue;
      const sd = cardData.items.find((it) => it.id === s.dataset.id);
      if (sd && sd.pos > itemData.pos) { ref = s; break; }
    }
    if (ref) destUl.insertBefore(itemEl, ref); else appendToItemsEnd(destUl, itemEl);
  }

  // ⟲-knappen på «Utført»-linja: reaktiver ALLE utførte listepunkter i lista på
  // én gang. Samme semantikk som å krysse av hvert enkelt (pos røres ikke, kun
  // innholds-registeret stemples), og hele flyttingen skjer i ÉN FLIP så radene
  // glir samlet tilbake på plassene sine.
  function restoreAllDone(cardEl, cardData) {
    const doneWrap = cardEl.querySelector('.items-done-wrap');
    const rows = [...cardEl.querySelectorAll('.items-done > .item')];
    if (!rows.length) return;
    const reduce = prefersReducedMotion();
    const snap = reduce ? null : snapshotRects([...cardEl.querySelectorAll('.item')]);

    rows.forEach((rowEl) => {
      const d = cardData.items.find((it) => it.id === rowEl.dataset.id);
      if (!d) return;
      d.done = false;
      stampContent(d);
      rowEl.classList.remove('done');
      const chk = rowEl.querySelector('.item-check');
      if (chk) chk.setAttribute('aria-pressed', 'false');
      placeItemBySection(cardEl, cardData, rowEl, d);
    });
    doneWrap.hidden = true;
    refreshAllCollapseCounts();   // se toggleItemDone: kollapsede kategorier teller kun ikke-utførte

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
    // Klonen er REN PYNT. Uten dette bærer den `data-id` og `id` til objektet
    // som nettopp forsvant, og enhver selektor som leter etter det igjen —
    // fokusgjenopprettingen etter en rendring, fokusfellen når en overlay
    // lukkes — finner klonen i stedet, fokuserer den, og mister fokus for godt
    // idet den fjernes 600 ms senere.
    ghost.removeAttribute('data-id');
    ghost.removeAttribute('id');
    ghost.querySelectorAll('[data-id], [id]').forEach((n) => {
      n.removeAttribute('data-id');
      n.removeAttribute('id');
    });
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
     Ett sted for «trashed = false»-logikken per nivå, så både «Gjenopprett» i
     søppel-modalen og «Angre» i slette-toasten bruker nøyaktig samme kode.
     Søpla er FELLES for alle med tilgang: `trashed` er et vanlig innholdsfelt
     som synkes som alt annet. Å FORLATE en deling er noe annet — det rører
     aldri innholdet, bare egen tilgang (se cloudLeave). */
  function setTrashed(o, kind, val) { o.trashed = val; stampContent(o); }
  // Sett gravstein på objektet + hele undertreet (lokal per-enhet-markør).
  // Delt av alle fire «tøm permanent»-funksjonene.
  function tombSubtree(o, kind) {
    state._tomb[kind + 's'][o.id] = tick();
    if (kind === 'universe') (o.groups || []).forEach((g) => tombSubtree(g, 'group'));
    else if (kind === 'group') (o.cards || []).forEach((c) => tombSubtree(c, 'card'));
    else if (kind === 'card') (o.items || []).forEach((it) => tombSubtree(it, 'item'));
  }
  /* ---------------- Gravsteiner: oppslag og påføring fra serveren ----------------
     `state._tomb` er registeret over id-er DENNE brukeren har slettet permanent
     («tøm søppelkassen»), og speiler serverens `tombstones`-tabell. Registeret
     ble tidligere skrevet, men aldri lest — så en utdatert lokal kopi kunne
     sette en permanent slettet rad inn igjen ved neste synk. Nå konsulterer
     synk-motoren det i BEGGE retninger (se reconcile): en gravlagt id settes
     aldri inn, og ligger den fortsatt på serveren, fullføres slettingen.
     Gravsteiner utløper aldri — en klient som har ligget i skuffen i et år må
     fortsatt møte dem. */
  function emptyTomb() { return { universes: {}, groups: {}, cards: {}, items: {} }; }
  const TOMB_BUCKET = { universe: 'universes', group: 'groups', card: 'cards', item: 'items' };
  // Alle gravlagte id-er som ett flatt oppslag (id-ene er UUID-er, altså unike
  // på tvers av nivåene).
  function tombIds() {
    const s = new Set();
    Object.keys(TOMB_BUCKET).forEach((type) => {
      Object.keys(state._tomb[TOMB_BUCKET[type]] || {}).forEach((id) => s.add(id));
    });
    return s;
  }
  // Gravlegg en id serveren har bekreftet som permanent slettet (funnet i
  // `tombstones`, eller avvist av insert-vakten). Finnes objektet fortsatt i det
  // lokale treet, gravlegges hele undertreet: serveren kaskade-slettet barna
  // sammen med forelderen, så de er like døde.
  function tombFromServer(type, id) {
    const f = findAnyById(id);
    if (f) { tombSubtree(f.obj, f.kind === 'category' ? 'item' : f.kind); return; }
    const bucket = TOMB_BUCKET[type];
    if (bucket) state._tomb[bucket][id] = tick();
  }
  // Alle fire gjenopprett-hjelperne slår opp objektet på nytt via id FØR de
  // muterer det — aldri den (potensielt foreldede) referansen som ble sendt inn.
  // Søppel-modalen kan stå åpen mens synken bygger state-treet på nytt
  // (`applyMyDoc` bytter ut hele `state.universes` med ferske
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
     gjenpåfører flagget etter hver applyMyDoc. */
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
  // commit/angre styres av samle-toasten (se pushDeleteToast under), så en mappe
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
  // tom bunke → toasten og timeren ryddes helt.
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
        deleteToastAction(), { sticky: true, onDismiss: commitDeleteToastNow });
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
  // Oppdaterer KUN element-søppel-badgen på ett kort (antallet + om kassen skal
  // vises), uten å bygge kortet på nytt — så en pågående inline-redigering i
  // samme kort (eller andre kort) ikke forstyrres. Kassen finnes ALLTID i
  // DOM-en (den vises fram som slippmål under et drag), så tellingen må styre
  // synligheten; et pågående drag som har avdekket den, får beholde den.
  function updateItemsTrashBadge(cardData) {
    const btn = board.querySelector('.card[data-id="' + cardData.id + '"] .item-trash-btn');
    if (!btn) return;
    const n = trashedItemsOf(cardData).length;
    btn.querySelector('.trashcan-count').textContent = n;
    const wrap = btn.closest('.item-trash');
    if (wrap && !wrap.dataset.dragRevealed) wrap.hidden = n === 0;
  }
  // Oppdaterer badge-tellerne som hørte til nettopp committede objekter — uten en
  // full render() (som ville revet ned en pågående inline-redigering et annet
  // sted i UI-et). `committed` er resultatene fra commitDeleteOne (kan inneholde
  // null for allerede fjernede/ukjente id-er).
  function refreshTrashBadgesAfterCommit(committed) {
    const kinds = new Set(), cards = new Set(), unis = new Set();
    committed.forEach((f) => {
      if (!f) return;
      kinds.add(f.kind);
      if (f.kind === 'item' && f.card) cards.add(f.card);
      // Mappe-søppelkassen ligger i områdekortet (som listepunkt-kassen i lista).
      if (f.kind === 'group') { const u = findUniverse(f.obj.uni); if (u) unis.add(u); }
    });
    if (kinds.has('universe')) updateUniversesTrash();
    if (kinds.has('card')) updateTrashCount();
    cards.forEach(updateItemsTrashBadge);
    unis.forEach(updateGroupsTrashBadge);
  }
  // Antallet i ETT områdes mappe-søppelkasse (uten å bygge kortet på nytt).
  // Som listepunkt-kassen: bygget alltid, skjult når tom.
  function updateGroupsTrashBadge(u) {
    const btn = navBoard.querySelector('.card[data-id="' + u.id + '"] .group-trash-btn');
    if (!btn) return;
    const n = trashedGroupsOf(u).length;
    btn.querySelector('.trashcan-count').textContent = n;
    const wrap = btn.closest('.item-trash');
    if (wrap && !wrap.dataset.dragRevealed) wrap.hidden = n === 0;
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
     forrige bunken committes straks, og en fersk toast starter for den nye
     kategorien. Toasten er «sticky» (auto-skjules ikke) — den felles timeren
     styrer både commit og skjuling. */
  let deleteToast = null; // { kind, ids: [], lastName, timer }
  // Sletting er ikke endelig — objektet ligger i søppelkassen til den tømmes.
  // Beskjeden sier hvor det ble av, ikke bare at det forsvant, og sier det
  // FØRST: navnet kan være vilkårlig langt, og det er navnet som skal brekke
  // nedover i toasten, ikke poenget.
  function deleteMsg(kind, ids, lastName) {
    if (ids.length === 1) return tr('trash.movedOne', { name: quoted(lastName || '') });
    const w = kind === 'item' ? itemWord : kind === 'card' ? listWord : kind === 'group' ? groupWord : uniWord;
    return tr('trash.movedMany', { what: w(ids.length) });
  }
  // Committer bunken i toasten nå (angre-vinduet er over — timeren utløp, en ny
  // kategori slettes, eller brukeren sveipet toasten bort). Skjuler ikke toasten:
  // kalleren styrer det (timeren skjuler, sveipet har allerede kastet den ut).
  function commitDeleteToastNow() {
    if (!deleteToast) return;
    const g = deleteToast; deleteToast = null;
    clearTimeout(g.timer);
    const committed = g.ids.map(commitDeleteOne);
    save();
    refreshTrashBadgesAfterCommit(committed);
    if (!trashModal.hidden) renderTrashModalBody();
  }
  function armDeleteTimer() {
    clearTimeout(deleteToast.timer);
    deleteToast.timer = setTimeout(() => {
      commitDeleteToastNow();
      hideToast();
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
    // Ny kategori → commit den forrige bunken straks (ikke lenger angrbar).
    if (deleteToast && deleteToast.kind !== kind) commitDeleteToastNow();
    if (deleteToast && deleteToast.kind === kind) {
      deleteToast.ids.push(id);
      deleteToast.lastName = name;
    } else {
      deleteToast = { kind, ids: [id], lastName: name, timer: null };
    }
    armDeleteTimer();
    showToast(deleteMsg(kind, deleteToast.ids, deleteToast.lastName), deleteToastAction(),
      { sticky: true, onDismiss: commitDeleteToastNow });
  }

  /* ---------------- Inline-redigering ---------------- */
  // Omdøpingen bor på selve TITTEL-ELEMENTET: menyens «Endre navn», F2 og de
  // programmatiske veiene (ny liste, nytt område, ny container etter et drag)
  // kaller den samme funksjonen. Nødvendig fordi et KLIKK på tittelen ikke
  // lenger omdøper områder, mapper og lister — der navigerer/kollapser det.
  function setRenameHook(titleEl, fn) { if (titleEl) titleEl.__rename = fn || null; }
  function startRename(titleEl) { if (titleEl && titleEl.__rename) titleEl.__rename(); }

  // opts.cls: ekstra klasse på input. opts.autosize: la input vokse med innholdet
  // (brukes til mappenavn i headeren, som ikke skal ta full bredde).
  // opts.onCancel: kalles ved Escape (avbrutt redigering) — brukes av nameNewRow
  // for å fjerne et nyopprettet objekt som aldri fikk noe navn.
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
      else if (opts.onCancel) opts.onCancel();
    };
    input.addEventListener('blur', () => finish(true));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); finish(true); }
      else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    });
  }

  // Navngi et NYOPPRETTET listepunkt/kategori: raden er allerede lagt inn (tom),
  // og navneredigereren åpnes straks på den. Avsluttes navngivingen uten tekst —
  // Enter på et tomt felt, klikk ut, eller Escape — fjernes raden igjen
  // (gravstein + ut av state), for et navnløst objekt er ingenting verdt og skal
  // ikke bli liggende igjen. Brukes av ＋-knappene i lista og i en kategori.
  function nameNewRow(obj, cont, rowEl, displayEl, scope) {
    const S = scope || boardScope;
    const rows = S.rowsOf(cont);
    const discard = () => {
      tombSubtree(obj, S.rowKind);
      const i = rows.indexOf(obj);
      if (i > -1) rows.splice(i, 1);
      rowEl.remove();
      save();
    };
    editText(displayEl, '', (val) => {
      if (!val) { discard(); return; }
      S.setRowName(obj, val);
      displayEl.textContent = val;
      stampContent(obj);
      save();
      if (S === navScope) updateCrumbs();
    }, { onCancel: discard });
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
  // Teller vellykkede slipp (se finishDrag). Leses av demoen, som har steg der
  // selve slippet ER handlingen.
  let dropSeq = 0, dragRolledBack = false;
  // Anti-flimring: rett etter et bytte ligger geometrien ofte slik at det motsatte
  // byttet straks trigges igjen (naboen har nettopp relokert via FLIP) → objektene
  // hopper frem og tilbake. To milde tiltak gjelder KUN reverseringen av forrige
  // bytte (samme nabo, motsatt side); vanlige (fremover) bytter er urørt:
  //  1) Tidslås (SWAP_LOCK_MS): reverseringen blokkeres et kort vindu etter byttet.
  //  2) Overlapp-hysterese (SWAP_REV_RATIO): reverseringen krever mer overlapp
  //     (50 %) enn et vanlig bytte (SWAP_RATIO, 20 %), så to objekter ikke bytter
  //     tilbake ved bare såvidt-berøring — men fortsatt tydelig mindre enn full
  //     senter-kryssing (som overskjøt inn i NESTE element).
  const SWAP_LOCK_MS = 300;
  const SWAP_REV_RATIO = 0.5;
  // Drar man et listepunkt (eller en kategori) OVER en kollapset liste/kategori og
  // BLIR VÆRENDE der i PEEK_MS, åpnes målet MIDLERTIDIG så man ser hvor det vil
  // lande. Flytter man videre uten å slippe, kollapses målet tilbake. Se peek-blokken.
  const PEEK_MS = 200;

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
  // Elementets FAKTISKE layout-boks (posisjon + størrelse) uten en evt. egen
  // transform. `getBoundingClientRect` på et rotert/skalert element gir den
  // ROTERTE omslutningsboksen — bredere og høyere enn boksen elementet ligger i —
  // så en måling under draging (dra-rotasjon) eller under en `.drag-hold`-
  // trykkskala må nøytralisere transformen først.
  function untransformedRect(el) {
    const prevT = el.style.transform, prevTr = el.style.transition;
    el.style.transition = 'none';
    el.style.transform = 'none';
    const r = el.getBoundingClientRect();
    el.style.transform = prevT;
    el.style.transition = prevTr;
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
      // ALDRI FLIP en FORFAR til det løftede objektet: et transformert element
      // blir containing block for sine absolutt posisjonerte etterkommere, så
      // dra-elementets dokument-koordinater (dragPos*) ville plutselig blitt
      // tolket relativt til forfaren — objektet hopper vekk fra fingeren og
      // langt ut til siden (helt ut av viewporten når kortet står i en høyre
      // kolonne). Skjer f.eks. når et listepunkt dras ut i board-lufta:
      // ny-liste-placeholderen omrokkerer kortene, og kilde-kortet er en forfar.
      // Slike forfedre snapper på plass uten tween i stedet.
      if (drag.active && drag.el && el !== drag.el && el.contains(drag.el)) return;
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
  /* ---------------- Trykk-og-hold / dra → dra-og-slipp ----------------
     Dra-håndtakene er fjernet. Draging inviteres på objektets navn-/tittelsone
     (ikke på knappene, `except`-selektoren). To modi etter inn-enhet:
     - **Touch/pen (mobil)**: trykk og HOLD (HOLD_MS) løfter objektet. Beveger
       fingeren seg mer enn HOLD_MOVE px før holdet er fullført, tolkes det som
       scroll/sveip og holdet avbrytes (siden scroller da nativt). Nødvendig for
       å skille draging fra scrolling på en berøringsskjerm.
     - **Mus (desktop)**: INGEN delay — draget starter idet pekeren beveger seg
       forbi HOLD_MOVE_MOUSE px med knappen nede (klassisk desktop-drag). På
       desktop er det ingen konflikt mellom scroll og drag, så et hold trengs ikke.
     Avstanden måles EUKLIDSK fra nedtrykkspunktet (kvadrert, ingen rot), så en
     diagonal bevegelse teller like mye som en akse-parallell.
     Et rent klikk (ingen bevegelse) gjør fortsatt det klikket pleide (omdøp/
     bytt/kryss/kollaps); et fullført drag undertrykker det påfølgende klikket.
     `startDrag` er den vanlige peker-drag-starteren; vi gir den et syntetisk
     event med pekerinfoen fra pointerdown (knappen er fortsatt nede, så
     pointerId-en er aktiv → setPointerCapture i beginDragCommon virker på
     `dragEl`) — men med SISTE kjente koordinater, ikke pointerdown-punktet, så
     objektet ikke rykker tilbake dit idet det løftes. */
  const HOLD_MS = 200;
  // Aktiveringsterskel (euklidsk avstand fra pointerdown). Touch/pen trenger
  // slark for at et hold ikke skal avbrytes av fingerens naturlige vandring;
  // mus har ingen slik vandring, så en lavere terskel gir et mer umiddelbart
  // desktop-drag uten å gjøre et vanlig klikk til et drag.
  const HOLD_MOVE = 10;
  const HOLD_MOVE_MOUSE = 5;
  // Interaktive/redigerbare etterkommere som ALDRI skal starte et drag, selv om
  // de ligger i dra-sonen (i tillegg til per-sone-`except`): den inline
  // redigereren (`editText` → `.edit-input`, hvor et hold ville blokkert caret-
  // plassering/markering) og meta-chipene (`fillMetaRow` → `.meta-chip`, egne
  // hurtigredigerings-knapper — et tregt trykk skal åpne dem, ikke løfte kortet).
  const HOLD_SKIP = '.edit-input, .meta-chip';
  function attachHoldDrag(zone, dragEl, startDrag, canDrag, except) {
    let timer = null, held = false, sx = 0, sy = 0, pid = null, mouse = false;
    // Siste kjente pekerposisjon/-tilstand MENS aktiveringen er armert. Draget
    // starter her, ikke i pointerdown-punktet: på touch rekker fingeren å vandre
    // i løpet av holdet, og på mus har pekeren pr. definisjon flyttet seg forbi
    // terskelen. Startet vi i nedtrykkspunktet, ville objektet rykke tilbake dit
    // idet det løftes (grabX/grabY måles mot start-koordinatene).
    let cx = 0, cy = 0, primary = true;
    function disarm() {
      if (timer) { clearTimeout(timer); timer = null; }
      dragEl.classList.remove('drag-hold');
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    }
    function startNow() {
      disarm();
      // Sjekk forutsetningene på nytt AKKURAT nå — mellom pointerdown og dette
      // øyeblikket kan alt ha endret seg: en synk-rebuild kan ha byttet ut noden
      // (peker-lytterne sitter da på den nye), objektet kan ha blitt låst/flyttet
      // (canDrag), et annet drag kan ha startet, eller pekeren kan ha blitt
      // sekundær (multitouch).
      if (!dragEl.isConnected || !canDrag() || drag.active || !primary) return;
      held = true;
      startDrag({ button: 0, clientX: cx, clientY: cy, pointerId: pid,
        pointerType: mouse ? 'mouse' : 'touch', target: dragEl, preventDefault() {} }, dragEl);
    }
    function onMove(ev) {
      if (ev.pointerId !== pid) return;
      cx = ev.clientX; cy = ev.clientY;
      if (ev.isPrimary === false) primary = false;
      // Euklidsk avstand (kvadrert — ingen rot nødvendig): en diagonal bevegelse
      // skal telle like mye som en akse-parallell, ikke kreve terskelen på hver
      // akse hver for seg.
      const lim = mouse ? HOLD_MOVE_MOUSE : HOLD_MOVE;
      const dx = cx - sx, dy = cy - sy;
      if (dx * dx + dy * dy <= lim * lim) return;
      // Mus: bevegelse forbi terskelen STARTER draget (ingen delay). Touch/pen:
      // bevegelse FØR holdet er fullført = scroll/sveip → avbryt.
      if (mouse) startNow(); else disarm();
    }
    function onUp(ev) { if (ev.pointerId === pid) disarm(); }
    zone.addEventListener('pointerdown', (ev) => {
      held = false;
      if (ev.button != null && ev.button !== 0) return;
      if (ev.isPrimary === false) return; // sekundær peker (multitouch) starter aldri et drag
      if (!canDrag()) return;
      if (ev.target.closest(HOLD_SKIP)) return;
      if (except && ev.target.closest(except)) return;
      ev.preventDefault(); // ingen tekstmarkering/fokus mens man holder/drar
      sx = cx = ev.clientX; sy = cy = ev.clientY; pid = ev.pointerId;
      primary = true;
      mouse = ev.pointerType === 'mouse';
      // Press-feedback (scale) kun på touch/pen der holdet faktisk tar tid; på
      // mus starter draget umiddelbart på bevegelse, så et press-blink ved hvert
      // klikk ville bare distrahert.
      if (!mouse) dragEl.classList.add('drag-hold');
      // Lytt på WINDOW (ikke bare zone): før draget er fanget kan pekeren flyttes/
      // slippes UTENFOR sonen; da ville zone-lyttere aldri fyre og timeren startet
      // et drag etter at knappen alt var sluppet. Fjernes idet draget starter/avbrytes.
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
      // Touch/pen: hold-timer. Mus: ingen timer — onMove starter draget på bevegelse.
      if (!mouse) timer = setTimeout(() => { timer = null; startNow(); }, HOLD_MS);
    });
    // Undertrykk klikket (omdøp/bytt/kryss/kollaps) som ellers ville fulgt et
    // fullført drag. Capture + stopImmediatePropagation stopper også lyttere på
    // samme element (f.eks. rad-aktivering på mappe-/område-radene).
    zone.addEventListener('click', (ev) => {
      if (held) { ev.stopImmediatePropagation(); ev.preventDefault(); held = false; }
    }, true);
  }

  // Blokkér native scroll mens et drag pågår (fingeren startet på en sone med
  // normal touch-action, så vi kan ikke la nettleseren panorere når draget først
  // er i gang). Ikke-passiv, så preventDefault faktisk stopper scrollingen.
  function preventTouchScroll(e) { if (drag.active && e.cancelable) e.preventDefault(); }

  function beginDragCommon(ev, el) {
    ev.preventDefault();
    // Mål boksen UTEN en evt. `.drag-hold`-skalering: på touch legges en liten
    // trykk-feedback-skala (scale .98) på under holdet, og den kan fortsatt tone ut
    // idet draget starter. En skalert getBoundingClientRect ga en placeholder ~10 px
    // for lav → board-et krympet ved løft → en 10 px scroll-klemme (som på mobil kan
    // avbryte touch-en). Nøytraliser transformen for selve målingen og gjenopprett
    // etterpå (start*Drag setter drag-transformen straks etter uansett).
    const rect = untransformedRect(el);
    drag.scope = scopeForEl(el); // hovedsidens board eller nav-modalens board
    drag.el = el;
    drag.width = rect.width;
    drag.height = rect.height;
    drag.grabX = ev.clientX - rect.left;
    drag.grabY = ev.clientY - rect.top;
    drag.pointerId = ev.pointerId;
    drag.lastX = ev.clientX;
    drag.lastY = ev.clientY;
    drag.active = true;
    // Opprinnelig DOM-plassering (FØR placeholderen settes inn): brukes av
    // on*Cancel for å føre elementet tilbake uten å beregne ny pos/lagre. Under
    // draging flyttes kun placeholderen — elementet blir liggende i denne sloten —
    // så dette er også dets faktiske posisjon, men vi registrerer den eksplisitt.
    drag.origParent = el.parentNode;
    drag.origNext = el.nextSibling;
    drag.recentSwap = null; // anti-flimring nullstilles per drag (se SWAP_LOCK_MS/SWAP_REV_RATIO)
    drag.card = null;       // kilde-/sonekort (settes av startCategoryDrag); nullstilt så en
                            // stale kategori-verdi ikke lekker inn i et påfølgende listepunkt-drag
    drag.peekCard = null;   // midlertidig peek-åpnet liste under draget (se peek-blokken)
    drag.peekCat = null;    // midlertidig peek-åpnet kategori under draget
    drag.overCard = el.closest('.card'); // lista objektet «er i» (1/3-hysterese, se dragOverCard)
    drag.overGrace = 0;     // slark for stickiness-en, satt av selve modusbyttet (noteOverShift)
    try { ev.target.setPointerCapture(ev.pointerId); } catch (e) {}
    document.body.classList.add('is-dragging');
    // Slå av nettleserens scroll-anchoring mens draget pågår: den ville ellers
    // justert scroll-posisjonen brått når board-et krymper (liste-kollaps).
    document.documentElement.style.overflowAnchor = 'none';
    window.addEventListener('touchmove', preventTouchScroll, { passive: false });
    // Hold det løftede objektet under pekeren om SIDEN scroller uten at vi gjorde
    // det (momentum, kollaps-klemme, tastatur, en synk-rebuild som endrer høyden).
    // Gjelder alle dokument-koordinat-drag (kort/listepunkt/kategori) — mappe/
    // område dras `fixed` i en modal og påvirkes ikke av window-scroll.
    // Reagerer KUN (reposisjonerer); den scroller aldri selv.
    window.addEventListener('scroll', onDragScroll, { passive: true });
  }
  // Ren reposisjonering (to style-skrivinger, ingen layout-lesing) → trygg å kjøre
  // synkront per scroll-event. Plasseringen re-evalueres IKKE her: pekeren har
  // ikke flyttet seg, og auto-scroll-loopen gjør allerede den jobben én gang per
  // animasjonsframe når det er VI som scroller.
  function onDragScroll() {
    if (drag.active && drag.el && dragUsesPageCoords()) moveElement();
  }

  // Posisjonen dra-elementet skal få via style.left/top.
  // Kort/element/kategori dras på selve board-et (window kan være scrollet) og
  // er `position: absolute` → DOKUMENT-koordinater (peker + window-scroll). Det
  // unngår en iOS-WebKit-bug der et `position: fixed`-element SOM HAR en transform
  // legges relativt til dokumentet og «scroller vekk» fra fingeren (kortet hopper
  // rett opp, ofte forbi viewporten, idet man tar tak). Mappe/område dras i en
  // modal og er fortsatt `position: fixed` (viewport-koordinater) — der endres
  // aldri window-scroll mens draget pågår, så de rammes ikke av buggen.
  function dragUsesPageCoords() {
    return dragScope().pageCoords;
  }
  // Skalaen det løftede objektet males med (start*Drag/on*Move setter
  // `rotate(…) scale(…)`, og CSS setter samme verdi i hvile-regelen): lister
  // 1.02, listepunkt/kategori 1.03, mappe/område 1.05.
  function dragScale() {
    return drag.kind === 'card' ? 1.02 : 1.03;
  }
  // Halvparten av den FAKTISK RENDREDE boksen (skala + maks rotasjon) langs hver
  // akse — transformen maler noen piksler utenfor layout-boksen.
  function dragRenderedHalf() {
    const rad = MAX_ROT * Math.PI / 180, s = dragScale();
    const c = Math.cos(rad), sn = Math.sin(rad);
    return {
      x: s * ((drag.width / 2) * c + (drag.height / 2) * sn),
      y: s * ((drag.width / 2) * sn + (drag.height / 2) * c),
    };
  }
  // Klem en akse slik at hele den rendrede boksen holder seg innenfor viewporten
  // (0..extent). Er objektet større enn viewporten langs aksen, sentreres det.
  function clampToViewport(base, size, half, extent) {
    const lo = half - size / 2;             // objektets kant treffer 0
    const hi = extent - size / 2 - half;    // objektets kant treffer `extent`
    return hi > lo ? Math.max(lo, Math.min(base, hi)) : (lo + hi) / 2;
  }
  // Det løftede objektet holdes ALLTID innenfor viewporten på begge akser: det
  // finnes ingen grunn til å dra noe utenfor skjermen, og et objekt som stikker ut
  // utvider sidens scroll-område (horisontal scrollbar — og på iOS WebKit forskyves
  // da høyre-forankrede `position: fixed`-elementer som kontoknappen). Klemmen slår
  // kun inn helt ute ved kanten, så den er usynlig for vanlig reorder/kolonnebytte.
  /* Klemmen går mot det BRUKBARE feltet, ikke mot skjermkanten: med
     `viewport-fit=cover` er hakkets og gestelinjens piksler en del av
     `innerWidth`/`innerHeight`, og et løftet objekt som stopper der ville lagt
     seg delvis under dem — mens board-et det kom fra står innenfor. Sonen er 0
     i en nettleser, så klemmen regner ut nøyaktig det samme som før der. */
  function dragPosLeft() {
    const safe = safeInsets();
    const vw = (window.innerWidth || document.documentElement.clientWidth || 0) - safe.left - safe.right;
    const half = dragRenderedHalf().x;
    const left = clampToViewport(drag.lastX - drag.grabX - safe.left, drag.width, half, vw) + safe.left;
    return left + (dragUsesPageCoords() ? window.scrollX : 0);
  }
  function dragPosTop() {
    const safe = safeInsets();
    const vh = (window.innerHeight || document.documentElement.clientHeight || 0) - safe.top - safe.bottom;
    const half = dragRenderedHalf().y;
    const top = clampToViewport(drag.lastY - drag.grabY - safe.top, drag.height, half, vh) + safe.top;
    return top + (dragUsesPageCoords() ? window.scrollY : 0);
  }

  function liftElement() {
    const el = drag.el;
    el.style.width = drag.width + 'px';
    el.style.height = drag.height + 'px';
    el.style.left = dragPosLeft() + 'px';
    el.style.top = dragPosTop() + 'px';
    el.classList.add('dragging');
  }

  function moveElement() {
    const el = drag.el;
    el.style.left = dragPosLeft() + 'px';
    el.style.top = dragPosTop() + 'px';
  }

  function wouldMove(ph, refEl, pos) {
    if (refEl === ph) return false;
    if (pos === 'before') return refEl.previousElementSibling !== ph;
    return refEl.nextElementSibling !== ph; // 'after'
  }
  // Placeholderen legges alltid i REFERANSERADENS egen container. På board-et er
  // det kolonnen ref ligger i — «nederst i kolonne 1» og «øverst i kolonne 2» er
  // samme plass i rekkefølgen, men to ulike containere, og placeholderen skal
  // vises der man faktisk siktet.
  function placePlaceholder(ph, refEl, pos) {
    const cont = refEl.parentNode;
    if (pos === 'before') cont.insertBefore(ph, refEl);
    else cont.insertBefore(ph, refEl.nextElementSibling);
  }

  // Anti-flimring (se SWAP_LOCK_MS/SWAP_REV_RATIO): et bytte plasserer
  // placeholderen foran/bak et nabo-element; det direkte omvendte er samme nabo
  // med motsatt side. Vanlige (fremover) bytter beholder den ivrige 20 %-terskelen;
  // REVERSERINGEN av siste bytte blokkeres (a) i et kort tidsvindu etter byttet, og
  // (b) til overlappen mot naboen når SWAP_REV_RATIO (50 %) — begge milde, så en
  // bevisst tilbakeføring fortsatt virker uten å måtte overskyte inn i neste
  // element. Aksen (V-overlapp vs H-overlapp) velges etter hvor nabo og dra-senter
  // er mest adskilt (vertikale lister → Y; horisontal kort-rad → X).
  function swapReversesRecent(action) {
    const rs = drag.recentSwap;
    if (!rs || !action.ref || action.ref.dataset.id !== rs.refId) return false;
    const isReverse = (action.pos === 'before' && rs.pos === 'after') ||
                      (action.pos === 'after' && rs.pos === 'before');
    if (!isReverse) return false;
    if (performance.now() - rs.t < SWAP_LOCK_MS) return true; // tidslås
    const dr = draggedRect(), nr = layoutRect(action.ref);
    const vertical = Math.abs((nr.top + nr.height / 2) - (dr.top + dr.height / 2)) >=
                     Math.abs((nr.left + nr.width / 2) - (dr.left + dr.width / 2));
    const frac = vertical ? vOverlap(dr, nr) / nr.height : hOverlap(dr, nr) / nr.width;
    return frac < SWAP_REV_RATIO; // for lite overlapp → blokkér reverseringen
  }
  function recordSwap(action) {
    drag.recentSwap = { refId: action.ref ? action.ref.dataset.id : null, pos: action.pos, t: performance.now() };
  }

  /* ------- Autoritativ SLUTTPLASSERING ved pointerup -------
     Den løpende plasseringen er retningsstyrt (20 %-overlapp + anti-reverserings-
     lås) og drives av `pointermove`. Men den siste bevegelsen før et slipp kan
     være koalescert bort eller helt utelatt (rask gest, eller en peker som bare
     hoppet fra nedtrykk til slipp), så placeholderen kan stå igjen fra NEST siste
     bevegelse. Ved slippet kjører vi derfor én siste, REN SENTERBASERT
     plassering fra de faktiske slipp-koordinatene: ingen retning (det finnes
     ingen ved et hopp), ingen 20 %-terskel og ingen anti-reverseringslås —
     slipp-punktet ER brukerens tydelige sluttintensjon, og et raskt slipp skal
     lande der og ikke ett hakk unna. */
  function centerPlaceRows(rows, rects, horizontal) {
    const ph = drag.ph;
    if (!ph || !rows.length) return;
    const d = draggedRect();
    const c = horizontal ? d.left + d.width / 2 : d.top + d.height / 2;
    const key = (r) => (horizontal ? r.left + r.width / 2 : r.top + r.height / 2);
    const sorted = rows.slice().sort((a, b) => key(rects.get(a)) - key(rects.get(b)));
    let ref = null;
    for (const el of sorted) if (c < key(rects.get(el))) { ref = el; break; }
    const action = ref ? { ref, pos: 'before' } : { ref: sorted[sorted.length - 1], pos: 'after' };
    if (!wouldMove(ph, action.ref, action.pos)) return;
    const snap = snapshotRects(rows);
    placePlaceholder(ph, action.ref, action.pos);
    flipFrom(snap, FLIP_MS);
    recordSwap(action);
  }

  // Animer dra-elementet fra flytende posisjon inn i placeholder-sloten.
  // rot = grader kortet skal starte rotert i (0/false for kategorier → ingen
  // spin/skala, se under).
  // `fromRect` = allerede målt dra-boks (for kallere som må rydde dra-stilene
  // før de kaller hit — onCardUp måler slot-posisjonen sin i mellomtiden).
  function dropIntoPlaceholder(el, rot, fromRect) {
    const reduced = prefersReducedMotion();
    // Startpunktet er objektets FAKTISKE boks der det står malt, mens det fortsatt
    // er `.dragging` — ikke den uklemte `drag.lastX - grabX`/`lastY - grabY`. Den
    // uklemte posisjonen ligger utenfor viewporten så snart klemmen
    // (clampToViewport) har slått inn, og animasjonen startet da et sted objektet
    // aldri var malt → et synlig hopp idet man slapp ved/utenfor kanten.
    const from = reduced ? null : (fromRect || untransformedRect(el));
    const scale = dragScale();
    el.classList.remove('dragging');
    el.style.left = el.style.top = el.style.width = el.style.height = '';
    el.style.transform = ''; // fjern evt. dynamisk drag-rotasjon før vi måler hvileposisjonen
    if (reduced) return;   // ingen drop-tween ved redusert bevegelse
    const now = el.getBoundingClientRect();
    const dx = from.left - now.left;
    const dy = from.top - now.top;
    el.style.transition = 'none';
    // Skalaen følger objekttypen (dragScale: liste 1.02, listepunkt 1.03,
    // mappe/område 1.05) — en hardkodet 1.02 ga et synlig krymp i starten av
    // drop-animasjonen for alt annet enn lister.
    el.style.transform = `translate(${dx}px, ${dy}px)${rot ? ` rotate(${rot}deg) scale(${scale})` : ''}`;
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

  /* ------- Normal-flow-vakt rundt board-et under liste-DnD på touch/pen -------
     Kollapsen av alle lister krymper board-INNHOLDET. Løfter man den nederste
     lista (siden nær maks scroll), ville board-bunnen — og dermed dokumentets
     maks-scroll — falt brått under gjeldende scrollY, og Android Chrome klemte
     scrollY oppover mens pekeren var nede → pointercancel. Vakten holder BÅDE
     dokumenthøyden og den dratte listas viewport-posisjon fast:
       1. Frys board sin min-height til høyden FØR kollaps → board-bunnen (og
          dermed dokumentets scrollHeight + maxScroll) kan ikke synke.
       2. Kompensér med padding-top = summen av body-høyder som fjernes for
          listene OVER den dratte (board bruker multi-column, så en padding-top
          skyver alle kolonner likt — et spacer-BARN ville i stedet flytt inn i
          kolonneflyten). Da beholder den dratte lista samme viewport-Y gjennom
          kollapsen, og de kompakte overskriftene bunkes rett over den — nær
          fingeren, ikke rullet vekk.
     Aktiveres KUN når (a) input er touch/pen (mus avbrytes ikke av en scroll-
     justering) OG (b) board-et er i ÉNKOLONNE-layout. I FLERKOLONNE-layout (bredt
     vindu, inkl. Androids «Side for datamaskin») får DnD desktop-oppførsel uansett
     inputtype: board-et krymper naturlig, ingen vakt — ellers ville padding-top-
     kompensasjonen blitt stor og stygg, og overskriftene flokket seg rundt den
     dratte lista i stedet for å følge kolonneflyten. Se `boardUsesSingleColumnLayout`. */
  let boardGuard = null;
  // Kilde til sannhet for én/flerkolonne = CSS-layouten, ikke enhet/pointerType.
  // `--mobile-dnd-flow-guard` settes til 1 KUN i mobil-media-regelen (column-count:1),
  // 0 ellers → terskelen finnes bare ett sted (styles.css). Se .board i styles.css.
  function boardUsesSingleColumnLayout() {
    return getComputedStyle(board).getPropertyValue('--mobile-dnd-flow-guard').trim() === '1';
  }
  function clearBoardGuardStyles() {
    board.style.transition = '';
    board.style.minHeight = '';
    board.style.paddingTop = '';
  }
  function freezeBoardForDrag(ph) {
    if (boardGuard) clearBoardGuardStyles(); // rydd evt. rest fra et avbrutt drag
    const boardH = board.getBoundingClientRect().height;
    // Body-høyde som forsvinner for hver ÅPEN liste OVER den dratte (før ph i
    // leserekkefølgen). Vakten brukes kun i énkolonne-layout, så «over» = før i
    // kolonnen — men `boardRows()` er uansett den riktige rekkefølgen.
    let removedAbove = 0;
    for (const row of boardRows()) {
      if (row === ph) break;
      if (row.classList.contains('card') && !row.classList.contains('collapsed')) {
        const body = row.querySelector('.card-body');
        if (body) removedAbove += body.getBoundingClientRect().height;
      }
    }
    const basePad = parseFloat(getComputedStyle(board).paddingTop) || 0;
    board.style.minHeight = boardH + 'px';
    board.style.paddingTop = (basePad + removedAbove) + 'px';
    boardGuard = { basePad, removedAbove };
  }
  // Ved slipp/kansellering: fjern min-height + padding-top-kompensasjonen. Kalles
  // MOMENTANT rett etter restoreCardsAfterDrag (som utvider listene momentant) i
  // samme oppgave → én reflow maler den ferdige, naturlige layouten uten et
  // mellomsteg (der padding-top + utvidede bodyer ville gitt et hopp).
  function releaseBoardAfterDrag() {
    if (!boardGuard) return;
    boardGuard = null;
    clearBoardGuardStyles();
  }

  function finishDrag() {
    /* Et VELLYKKET slipp, i motsetning til et tilbakerullet drag. Demoen har
       steg som skal kvitteres ut av selve slippet — også når objektet lander på
       samme plass, der verken pos eller rekkefølge endrer seg og en
       tilstandssjekk derfor ikke ville sett noe. Rollback-veiene er nøyaktig de
       som går via restoreDraggedToOrigin(), så flagget settes der. */
    if (!dragRolledBack) dropSeq++;
    dragRolledBack = false;
    drag.active = false;
    disarmDragTrash();        // skjul kassen igjen om draget ikke endte i den
    clearAllDragSeparators(); // tilbake til hvile-reglene (pseudo-linjene på .category)
    clearAllPeeks(true); // sikkerhetsnett: kollaps evt. peek-åpnede mål tilbake (no-op om alt alt er løst)
    window.removeEventListener('scroll', onDragScroll);
    document.documentElement.style.overflowAnchor = ''; // gjenopprett scroll-anchoring
    // Sikkerhetsnett: en placeholder skal kun eksistere mens draging pågår.
    // Fjern den aktive om den fortsatt henger i DOM, og fei bort evt. foreldreløse
    // (f.eks. hvis en drag ble avbrutt uvanlig) så ingen blir stående etter slipp.
    if (drag.ph && drag.ph.parentNode) drag.ph.remove();
    drag.el = null;
    drag.ph = null;
    drag.trashHost = null;
    document.querySelectorAll('.card-placeholder, .item-placeholder')
      .forEach((el) => el.remove());
    stopAutoScroll();
    stopModalAutoScroll();
    document.body.classList.remove('is-dragging');
    window.removeEventListener('touchmove', preventTouchScroll, { passive: false });
    // Kolonnefordelingen har vært frosset gjennom draget (og korthøydene kan ha
    // endret seg — et listepunkt flyttet mellom to lister). Kjør den på nytt nå
    // som draget er over; `onCardUp` har alt gjort det synkront (drop-tweenen må
    // sikte på den endelige sloten), så der blir dette en no-op.
    scheduleRelayout();
  }

  /* ------- Avbrutt drag (pointercancel) -------
     En kansellert pekersekvens (typisk Android Chrome som klemmer scroll-
     posisjonen) er IKKE et vellykket slipp: den skal ikke beregne ny pos,
     stampe eller lagre, og ikke åpne mappe-flyttevelgeren. Vi fører elementet
     tilbake til den registrerte opprinnelige sloten og rydder dra-stilene.
     Elementet står allerede der (kun placeholderen flyttes under draging), men
     re-innsettingen mot `origNext` er et sikkerhetsnett. Kaller IKKE finishDrag
     selv — hver on*Cancel gjør det (etter evt. nivå-spesifikk opprydding). */
  function restoreDraggedToOrigin() {
    dragRolledBack = true; // ikke et slipp — se finishDrag()
    const el = drag.el;
    if (!el) return;
    // Er noden allerede ute av dokumentet, har DOM-en gått videre uten den (en
    // rebuild har satt inn ferske noder). Å sette den inn igjen ville gitt et
    // spøkelses-duplikat — vi rydder bare dra-stilene og lar den ligge død.
    if (el.isConnected && drag.origParent) drag.origParent.insertBefore(el, drag.origNext);
    el.classList.remove('dragging');
    el.classList.remove('to-group', 'to-trash');
    el.style.left = el.style.top = el.style.width = el.style.height = '';
    el.style.transform = '';
    el.style.transition = '';
  }

  /* ------- Sikkerhetsnett: avbryt et drag som mistet OBJEKTET SITT -------
     Draget lever av `pointermove`/`pointerup` på WINDOW. De lytterne overlever
     alt annet enn at selve objektet forsvinner: rives noden ut av DOM (en synk-
     rebuild bytter den ut), får vi aldri et brukbart slipp — objektet blir
     hengende limt til pekeren, med placeholder i DOM og auto-scroll i gang.
     `cancelActiveDrag` kjører da den nivå-riktige kanselleringsflyten (rollback,
     ingen pos/lagring) og er idempotent: hver on*Cancel returnerer straks når
     `drag.active` er false, og finishDrag setter den false. Et vanlig
     `pointerup`/`pointercancel` har dermed allerede ryddet om nettet fyrer etterpå.

     VIKTIG — nettet henger på ÉN tilstand: at `drag.el` er frakoblet. Vi har
     bevisst IKKE hendelses-utløsere:
     - `window.blur`/`visibilitychange` sier ingenting om gesten. Fokus flytter
       seg av mange grunner (en innebygd iframe/verktøylinje som stjeler fokus,
       OS-nivå fokusbytte, nettleser-UI), pekeren er upåvirket, og å avbryte på
       dem fikk lister/listepunkter/kategorier til å «glippe» rett etter løft.
     - `lostpointercapture` fyrer også når alt er i orden, OG — når noden faktisk
       rives ut — dispatches den på en node som ikke lenger er i dokumentet, så
       den når uansett ikke en lytter på `document`. Ubrukelig i begge retninger.
     Derfor sjekker vi tilstanden der den betyr noe: ved neste bevegelse (rydd
     opp med én gang) og ved slippet (ikke commit et drop på en død node). */
  function cancelActiveDrag() {
    if (!drag.active) return;
    if (drag.kind === 'card') onCardCancel();
    else if (drag.kind === 'item') onItemCancel();
    else if (drag.kind === 'category') onCategoryCancel();
    else finishDrag();
  }
  // Sant når det løftede objektet er borte fra dokumentet — da rydder vi og
  // avbryter i stedet for å drive draget videre (eller committe et drop) på en
  // node ingen ser.
  function dragElDetached() {
    return drag.active && (!drag.el || !drag.el.isConnected);
  }

  /* ------- Auto-scroll når dra-kortet nærmer seg topp/bunn av vinduet -------
     Sakte når kortet nærmer seg kanten, raskere jo lengre ut i sonen — og
     raskest når det holdes forbi selve kanten. Fungerer begge veier. */
  let autoScrollRAF = null;
  let autoScrollSpeed = 0;

  /* Auto-scroll-fartene er px PER 60 Hz-FRAME. Uten normalisering scroller en
     120 Hz-skjerm dobbelt så fort som en 60 Hz-skjerm for samme fysiske tid (og
     en travel frame gir et hopp). `frameSteps` gjør om tiden siden forrige
     RAF-kall til antall 60 Hz-frames, klemt oppad: etter en bakgrunnsfane/pause
     kan dt være hundrevis av ms, og et ukjemmet dt ville rykket siden langt av
     gårde i én frame. Første frame (ingen forrige tid) teller som én. */
  const FRAME_MS = 1000 / 60;
  const MAX_FRAME_MS = 50;
  function frameSteps(prevTs, ts) {
    if (prevTs == null) return 1;
    const now = typeof ts === 'number' ? ts : performance.now();
    return Math.max(0, Math.min(MAX_FRAME_MS, now - prevTs)) / FRAME_MS;
  }
  const frameNow = (ts) => (typeof ts === 'number' ? ts : performance.now());

  function edgeSpeed(p) {
    // p: 0 ved sonens indre kant, 1 ved vinduskanten, >1 forbi kanten.
    const MIN = 4, MAX = 20, BEYOND = 34;
    if (p <= 0) return 0;
    if (p <= 1) return MIN + (MAX - MIN) * p;
    return MAX + (BEYOND - MAX) * Math.min(1, p - 1);
  }
  // Drag på hovedsidens board scroller VINDUET ved kanten (dokument-koordinater);
  // drag i nav-modalen scroller modalens `.menu-body` i stedet (se
  // updateModalAutoScroll). Skillet følger scopet, ikke nivået.
  function windowScrollDrag() {
    return dragScope().pageCoords;
  }
  // Re-evaluer plasseringen etter en auto-scroll-frame (pekeren står stille, så vi
  // bruker siste kjente pekerposisjon + rulleretningen som «drag-retning»).
  function reapplyPlacement(dir) {
    if (drag.kind === 'card') updateCardPlacement(0, dir);
    else if (drag.kind === 'item') updateItemPlacement(drag.lastX, drag.lastY, dir);
    else if (drag.kind === 'category') updateCategoryPlacement();
  }
  function updateAutoScroll() {
    if (!drag.active) { stopAutoScroll(); stopModalAutoScroll(); return; }
    if (!windowScrollDrag()) { stopAutoScroll(); updateModalAutoScroll(); return; }
    stopModalAutoScroll();
    const r = draggedRect();
    // Nedre kant av det BRUKBARE feltet: gestelinjen dekker de nederste
    // pikslene, og et kort som «bare så vidt er innenfor viewporten» ligger da
    // under den (safeInsets() er null i en nettleser).
    const vh = (window.innerHeight || document.documentElement.clientHeight || 1) - safeInsets().bottom;
    const ZONE = 120;
    // Symmetrisk, kant-forankret utløsning: OPPOVER måles kortets ØVRE kant mot
    // toppen av området rett UNDER den faste headeren (ikke viewportens øvre kant
    // — ellers måtte man dra lista opp bak headeren før scrollingen slo inn,
    // spesielt på mobil). NEDOVER måles kortets NEDRE kant mot viewportens nedre
    // kant.
    const headerBottom = topbarEl.getBoundingClientRect().bottom;
    const up = edgeSpeed((headerBottom + ZONE - r.top) / ZONE);
    const down = edgeSpeed((r.bottom - (vh - ZONE)) / ZONE);
    // Et kort som er høyere enn området mellom sonene kan ligge i begge samtidig;
    // da avgjør pekerens halvdel (øvre/nedre av det synlige området) retningen, så
    // brukeren styrer veien i stedet for at den flimrer.
    if (up > 0 && down > 0) {
      autoScrollSpeed = drag.lastY < (headerBottom + vh) / 2 ? -up : down;
    } else {
      autoScrollSpeed = down > 0 ? down : (up > 0 ? -up : 0);
    }
    if (autoScrollSpeed !== 0) startAutoScroll(); else stopAutoScroll();
  }
  function startAutoScroll() {
    if (autoScrollRAF != null) return;
    let prevTs = null, rest = 0; // `rest` = ubrukt sub-piksel-avstand, tas med neste frame
    const step = (ts) => {
      if (!drag.active || autoScrollSpeed === 0) { autoScrollRAF = null; return; }
      let delta = autoScrollSpeed * frameSteps(prevTs, ts) + rest;
      prevTs = frameNow(ts);
      if (delta > 0) {
        // Det løftede kortet er `position: absolute`, så dets dokument-posisjon
        // (scrollY + peker) ville selv utvidet sidens scroll-område hver frame og
        // gjort nedover-scrollingen uendelig ut i blankt. Stopp ved board-ets
        // FAKTISKE bunn: et absolutt-posisjonert barn teller ikke i board-ets egen
        // høyde (placeholderen holder kortets gamle slot), så board-ets bunn er den
        // ekte innholdsenden — uavhengig av kortet vi drar.
        //
        // Board-ets bunn er IKKE dokumentets ende: `.app-main` har i tillegg
        // gestelinjens bunn-inset som padding under board-et (styles.css). Uten
        // det leddet stopper auto-scrollen én inset for tidlig, og siste kort
        // blir liggende under gestelinjen til brukeren scroller videre selv.
        const vh = window.innerHeight || document.documentElement.clientHeight || 0;
        const maxScroll = Math.max(0,
          board.getBoundingClientRect().bottom + window.scrollY + safeInsets().bottom - vh);
        // Tillatt nedover-avstand er ALLTID ikke-negativ. Ligger den kompakte board-
        // bunnen OVER gjeldende scrollY (f.eks. etter at alle lister kollapset mens
        // dokumenthøyden holdes kunstig høy), blir (maxScroll - scrollY) negativ — en
        // positiv nedover-scroll skulle da STOPPE, ikke snus til et stort hopp OPPOVER
        // (som på mobil kan utløse pointercancel). Klem derfor til >= 0: en positiv
        // autoScrollSpeed reduserer aldri scrollY.
        delta = Math.min(delta, Math.max(0, maxScroll - window.scrollY));
      }
      const before = window.scrollY;
      if (delta !== 0) window.scrollBy(0, delta);
      // Ta vare på avstanden nettleseren ikke brukte (avrunding til hele piksler),
      // så en lav fart per frame på 120 Hz ikke forsvinner i avrundingen. Klemt til
      // ±1 px så den ikke hoper seg opp når scrollen står i en ende.
      rest = Math.max(-1, Math.min(1, delta - (window.scrollY - before)));
      // Kortet er `position: absolute` (dokument-koordinater) → flytt det med den
      // nye scroll-posisjonen så det blir liggende under fingeren, og re-evaluer
      // de andre kortenes plassering med rulleretningen som «drag-retning».
      if (window.scrollY !== before) { moveElement(); reapplyPlacement(autoScrollSpeed > 0 ? 1 : -1); }
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
    drag.crumbTarget = false; // sikter lista på 📁-breadcrumben? (flytt til annen mappe)

    const S = dragScope();
    const ph = document.createElement('div');
    ph.className = 'card-placeholder';
    ph.style.height = drag.height + 'px';
    cardEl.parentNode.insertBefore(ph, cardEl); // kortets egen kolonne
    drag.ph = ph;

    liftElement();
    // Kollaps ALLE lister (den dratte + de andre) mens draget pågår → kortere
    // avstand å dra. Momentant (ingen animasjon). Tilstanden gjenopprettes ved
    // slipp (fra `card.collapsed`).
    //
    // Normal-flow-vakten (`freezeBoardForDrag`, se der) brukes KUN når input er
    // touch/pen OG board-et er i ÉNKOLONNE-layout — beslutningen følger CSS-
    // layouten, ikke bare `pointerType`. I FLERKOLONNE-layout (bredt vindu, inkl.
    // Androids «Side for datamaskin» på touch) får DnD desktop-oppførsel: bare
    // kollaps, board-et krymper og siden justerer scroll naturlig, ingen vakt —
    // som i main. Mus i énkolonne trenger heller ingen vakt (et musedrag avbrytes
    // ikke av mobilens pointercancel-problem). Vakten (når aktiv) legges FØR
    // kollapsen i SAMME oppgave, så verken dokumenthøyden eller den dratte listas
    // viewport-Y endres mens fingeren er nede. Slippes i `onCardUp`/`onCardCancel`.
    // Vakten gjelder KUN hovedsidens board (nav-modalen scroller i sin egen
    // container og rammes ikke av window-scroll-klemmen).
    const useMobileFlowGuard = S === boardScope &&
      ev.pointerType !== 'mouse' && boardUsesSingleColumnLayout();
    if (useMobileFlowGuard) freezeBoardForDrag(ph);
    collapseCardsForDrag(drag.el, ph);
    drag.el.style.transform = `rotate(${cardRotation()}deg) scale(1.02)`;
    window.addEventListener('pointermove', onCardMove);
    window.addEventListener('pointerup', onCardUp);
    window.addEventListener('pointercancel', onCardCancel);
    armDragTrash(); // søppelkassen dukker opp som slippmål mens draget varer
  }

  /* ------- Midlertidig kollaps av alle lister under et liste-drag -------
     Alle lister (den dratte + de andre) kollapses til bare korthodet → board-et
     blir kompakt, så man ikke trenger dra langt for å omrokkere. MOMENTANT (ingen
     animasjon, se collapseCardBody). Den dratte lista slipper sin faste høyde og
     følger body-kollapsen; placeholderen settes til header-høyden. `card.collapsed`
     røres ikke, så `restoreCardsAfterDrag()` bare gjenoppretter lagret tilstand. */
  function collapseCardsForDrag(draggedEl, ph) {
    // offsetHeight (ikke getBoundingClientRect): en rotert bred header ville blåst
    // opp getBoundingClientRect-høyden (som for kategorien). offsetHeight er transform-fri.
    const headH = draggedEl.querySelector('.card-head').offsetHeight;
    draggedEl.style.height = ''; // slipp fast høyde → kortet følger body-kollapsen
    if (!draggedEl.classList.contains('collapsed')) collapseCardBody(draggedEl);
    drag.height = headH; // treffdeteksjon + placeholder bruker den kollapsede boksen
    ph.style.height = headH + 'px';
    dragScope().root.querySelectorAll('.card:not(.dragging)').forEach((cEl) => {
      if (!cEl.classList.contains('collapsed')) collapseCardBody(cEl);
    });
  }
  // Ved slipp: gjenopprett hver liste til sin lagrede lukketilstand (momentant).
  // Robust mot en samtidig synk-rebuild, som uansett bygger kortene fra
  // `card.collapsed`.
  function restoreCardsAfterDrag() {
    const S = dragScope();
    S.root.querySelectorAll('.card').forEach((cEl) => {
      const cd = S.findContainer(cEl.dataset.id);
      const want = cd ? !!cd.collapsed : false;
      const isCollapsed = cEl.classList.contains('collapsed');
      if (want && !isCollapsed) collapseCardBody(cEl);
      else if (!want && isCollapsed) expandCardBody(cEl);
    });
  }

  /* ------- SLETT VED Å DRA OBJEKTET I SØPPELKASSEN -------
     Søppelkassen for NIVÅET man drar på dukker opp i det draget starter (den er
     ellers skjult når den er tom), lyser opp når man sikter på den, og sletter
     objektet ved slipp. Etterpå tømmes den samme kassen permanent med det
     kjente hold-og-sveip-grepet.

     Hvorfor slik: det gir ÉN slettemåte som virker likt på desktop og mobil,
     for alle objekttypene, med den samme motoren som allerede flytter dem — og
     uten en egen ✕ på hvert objekt. Slettingen er dessuten det eneste stedet
     kassen er relevant, så den koster ingen plass i hvile.

     KATEGORIER har ingen kasse. En kategori slettes ikke — den LØSES OPP
     (listepunktene blir stående), og det gjøres fra objektmenyen. Derfor
     returnerer `dragTrashBtn()` null for dem, og ingenting armes.

     Kassen er BUNDET til draget: for et listepunkt/en mappe er det kassen i
     containeren raden kom FRA, ikke den man tilfeldigvis svever over. Slippet
     ruller draget tilbake som et avbrutt drag (ingen ny posisjon, ingen
     lagring) og lar slette-funksjonen gjøre resten — samme vei som menyens
     «Slett», med fly-i-kassen-animasjon og samlende angre-toast. */
  const DRAG_TRASH_PAD = 12;   // raus treffsone rundt kassen (den er et lite mål)

  // Kassen dette draget kan slippes i — eller null når nivået ikke har en.
  function dragTrashBtn() {
    if (!drag.active) return null;
    const S = dragScope();
    if (drag.kind === 'card') return S === navScope ? uniTrashBtn : trashBtn;
    if (drag.kind === 'item') {
      const host = drag.trashHost;
      if (!host || !host.isConnected) return null;
      return host.querySelector(S === navScope ? '.group-trash-btn' : '.item-trash-btn');
    }
    return null;
  }
  // Har jeg lov til å slette det jeg drar? Samme capabilities som menyens
  // «Slett»-rad, og feiler LUKKET: uten rett vises ingen kasse i det hele tatt,
  // så man kan ikke sikte på noe serveren ville avvist.
  function draggedCanBeTrashed() {
    const S = dragScope();
    const id = drag.el && drag.el.dataset.id;
    if (!id) return false;
    if (drag.kind === 'card') {
      if (S === navScope) {
        const u = findUniverse(id);
        return !!u && !u._virtual && cap(u, 'delete');
      }
      const c = findCard(id);
      return !!c && !frozen(c);
    }
    if (drag.kind === 'item') {
      if (S === navScope) {
        const g = findGroupAnywhere(id);
        return !!g && cap(g, 'delete', !frozen(g));
      }
      const it = findItemById(id);
      const owner = it && findCard(it.home);
      return !!owner && !frozen(owner);
    }
    return false;
  }
  // Vis kassen fram for draget. `data-drag-revealed` husker at det var VI som
  // avdekket den, så den går tilbake til å være skjult om draget ikke endte i
  // den (og forblir synlig om det gjorde — slettingen rendrer da uansett).
  function armDragTrash() {
    drag.overTrash = false;
    drag.trashArmed = false;
    if (!draggedCanBeTrashed()) return;
    const btn = dragTrashBtn();
    if (!btn) return;
    drag.trashArmed = true;
    btn.classList.add('drag-trash');
    if (btn.hidden) { btn.hidden = false; btn.dataset.dragRevealed = '1'; }
    const wrap = btn.closest('.item-trash');
    if (wrap && wrap.hidden) { wrap.hidden = false; wrap.dataset.dragRevealed = '1'; }
  }
  // Kalles fra finishDrag — altså på ALLE veier ut av et drag, også avbrudd.
  function disarmDragTrash() {
    document.querySelectorAll('.trashcan.drag-trash').forEach((btn) => {
      btn.classList.remove('drag-trash', 'drop-target');
      const wrap = btn.closest('.item-trash');
      if (btn.dataset.dragRevealed) { btn.hidden = true; delete btn.dataset.dragRevealed; }
      if (wrap && wrap.dataset.dragRevealed) { wrap.hidden = true; delete wrap.dataset.dragRevealed; }
    });
    drag.trashArmed = false;
    drag.overTrash = false;
  }
  function pointerOnDragTrash(x, y) {
    if (!drag.trashArmed) return false;
    const btn = dragTrashBtn();
    if (!btn || btn.hidden || !btn.isConnected) return false;
    const r = btn.getBoundingClientRect();
    if (!r.width || !r.height) return false;
    return x >= r.left - DRAG_TRASH_PAD && x <= r.right + DRAG_TRASH_PAD &&
           y >= r.top - DRAG_TRASH_PAD && y <= r.bottom + DRAG_TRASH_PAD;
  }
  // Siktemarkering på kassen + gjennomskinnelig dra-objekt, så kassen synes
  // gjennom det løftede kortet (samme grep som 📁-breadcrumben bruker).
  function setDragTrashTarget(on) {
    on = !!on;
    if (drag.overTrash === on) return;
    drag.overTrash = on;
    const btn = dragTrashBtn();
    if (btn) btn.classList.toggle('drop-target', on);
    if (drag.el) drag.el.classList.toggle('to-trash', on);
  }
  // Selve slettingen et slipp i kassen betyr. Kalles ETTER at draget er rullet
  // tilbake, så animasjonen og angre-toasten kjører på et board i normal flyt.
  // Etter en slette-DnD skal kassen fortsatt være innen synsvidde: neste steg
  // er som regel å tømme den (hold + sveip). Slettingen rendrer på nytt — og i
  // nav-modalen har draget dessuten kollapset kortene underveis, så listen
  // krymper og vokser igjen. Uten dette havner man et stykke over kassen.
  function keepTrashInView(btn) {
    if (btn && btn.isConnected && !btn.hidden && !btn.closest('[hidden]')) {
      btn.scrollIntoView({ block: 'nearest' });
    }
  }
  function dropIntoTrash(S, kind, id) {
    if (kind === 'card') {
      if (S === navScope) {
        const u = findUniverse(id);
        if (!u) return;
        deleteUniverse(u);
        keepTrashInView(uniTrashBtn);
      } else {
        const c = findCard(id);
        if (c) deleteCard(c);   // toppmenyens kasse står alltid i synsfeltet
      }
      return;
    }
    if (S === navScope) {
      const g = findGroupAnywhere(id);
      if (!g) return;
      const uni = g.uni;
      deleteGroup(g);
      keepTrashInView(navBoard.querySelector('.card[data-id="' + uni + '"] .group-trash-btn'));
    } else {
      const it = findItemById(id);
      if (!it) return;
      const home = it.home;
      deleteItem(it);
      keepTrashInView(board.querySelector('.card[data-id="' + home + '"] .item-trash-btn'));
    }
  }

  /* ------- Flytting av en liste til en annen mappe -------
     Mappene ligger ikke lenger på hovedsiden — i stedet slippes lista på
     📁-breadcrumben i toppmenyen: knappen lyser opp mens man sikter, og ved
     slipp åpnes en velger («Flytt … til:») med de andre mappene i området
     (samme modal-skall som plasseringsvalget). */
  function moveTargetGroups(c) {
    return visibleGroupsOf(activeUniverseObj()).filter((g) =>
      !g.isCat && g.id !== state.activeGroup && canAddList(g));
  }
  function pointerOnNavCrumb(x, y) {
    const r = navCrumbBtn.getBoundingClientRect();
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  }
  function pointerInTopbar(x, y) {
    const r = topbarEl.getBoundingClientRect();
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  }
  // Sett/fjern siktemarkeringen på 📁-breadcrumben + gjør dra-kortet
  // gjennomskinnelig så knappen synes gjennom det løftede kortet.
  function setCardCrumbTarget(on) {
    on = !!on;
    if (drag.crumbTarget === on) return;
    drag.crumbTarget = on;
    navCrumbBtn.classList.toggle('drop-target', on);
    if (drag.el) drag.el.classList.toggle('to-group', on);
  }
  // Velgeren ved slipp på 📁-breadcrumben: de andre mappene i området.
  function askCardMove(c) {
    const options = moveTargetGroups(c).map((g) => ({ id: g.id, label: g.name }));
    if (!options.length) return;
    openPicker(tr('move.cardPrompt', { name: quoted(c.title) }), options, '',
      (gid) => moveCardToGroup(c.id, gid));
  }
  // Flytt lista: ny forelder (`group`) + posisjon bakerst i mål-mappen
  // (kirurgisk — kun posisjonsregisteret, som «forelder følger posisjon»).
  // Slår opp DET LEVENDE kortet på id — en synk-rebuild kan ha byttet ut
  // objektet mens velgeren sto åpen.
  function moveCardToGroup(cardId, destId) {
    const dest = findGroup(destId);
    const src = activeGroupObj();
    const c = src && src.cards.find((x) => x.id === cardId);
    if (!c || !dest || !src) return;
    const i = src.cards.indexOf(c);
    if (i > -1) src.cards.splice(i, 1);
    const np = maxPos(dest.cards) + 1; // legg bakerst i mål-mappen
    c.group = dest.id;
    c.pos = np;
    c._parent = dest;
    stampPos(c);
    dest.cards.push(c);
    save();
    render(); // lista forsvinner fra dette board-et
    showToast(tr('move.movedTo', { name: quoted(c.title), dest: quoted(dest.name) }));
  }

  function onCardMove(ev) {
    if (!drag.active) return;
    if (dragElDetached()) { cancelActiveDrag(); return; }
    const dx = ev.clientX - drag.lastX;
    const dy = ev.clientY - drag.lastY;
    drag.lastX = ev.clientX;
    drag.lastY = ev.clientY;
    moveElement();
    drag.el.style.transform = `rotate(${cardRotation()}deg) scale(1.02)`;

    // Sikter man på søppelkassen, er det slettingen som gjelder — verken
    // omrokkering eller 📁-breadcrumben. (Liste-kassen ligger i toppmenyen,
    // område-kassen nederst i nav-modalen; sjekken dekker begge.)
    if (pointerOnDragTrash(ev.clientX, ev.clientY)) {
      setDragTrashTarget(true);
      setCardCrumbTarget(false);
      stopAutoScroll();
      return;
    }
    setDragTrashTarget(false);

    // Over toppmenyen sikter vi på 📁-breadcrumben (flytt til annen mappe) i
    // stedet for å omorganisere board-et: marker knappen, og la board-et +
    // siden ligge i ro så lista ikke bytter plass mens man løfter den opp.
    if (dragScope() === boardScope && pointerInTopbar(ev.clientX, ev.clientY)) {
      setCardCrumbTarget(pointerOnNavCrumb(ev.clientX, ev.clientY) &&
        moveTargetGroups(findCard(drag.el.dataset.id)).length > 0);
      stopAutoScroll();
      return;
    }
    setCardCrumbTarget(false);
    updateAutoScroll();
    updateCardPlacement(dx, dy);
  }

  // Finn og utfør evt. placeholder-flytting ut fra dra-retningen (dx, dy).
  // Kalles både fra peker-bevegelse og fra auto-scroll (med syntetisk retning).
  function updateCardPlacement(dx, dy) {
    if (!drag.active || drag.kind !== 'card') return;
    const dragRect = draggedRect();
    const root = dragScope().root;
    const cards = [...root.querySelectorAll('.card:not(.dragging)')];
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
    if (swapReversesRecent(action)) return;
    const snap = snapshotRects(cards);
    placePlaceholder(ph, action.ref, action.pos);
    flipFrom(snap, FLIP_MS);
    recordSwap(action);
  }

  // Sluttplassering ved slipp (se centerPlaceRows): rent senterbasert, slik at et
  // raskt slipp lander der kortet faktisk ble sluppet — også når det hoppet over
  // flere plasser siden forrige pointermove.
  function commitCardPlacement() {
    if (!drag.active || drag.kind !== 'card') return;
    const dragRect = draggedRect();
    const root = dragScope().root;
    const cards = [...root.querySelectorAll('.card:not(.dragging)')];
    if (!cards.length) return;
    const rects = new Map(cards.map((c) => [c, layoutRect(c)]));
    const restRects = cards.map((c) => rects.get(c)).concat([layoutRect(drag.ph)]);
    if (isSingleRowLayout(restRects)) { // én horisontal rad → senter langs X
      centerPlaceRows(cards, rects, true);
      return;
    }
    // Flerkolonne/kolonne: kortene som deler spor med dra-kortet, senter langs Y.
    // Ligger dra-kortet i et kolonnegap, lar vi placeholderen stå (den løpende
    // plasseringen har allerede valgt kolonne).
    const col = cards.filter((c) => hOverlapFrac(dragRect, rects.get(c)) >= 0.5);
    if (col.length) centerPlaceRows(col, rects, false);
  }

  function onCardUp(ev) {
    if (!drag.active) return;
    if (dragElDetached()) { cancelActiveDrag(); return; }
    window.removeEventListener('pointermove', onCardMove);
    window.removeEventListener('pointerup', onCardUp);
    window.removeEventListener('pointercancel', onCardCancel);

    const S = dragScope();
    const el = drag.el;
    const onBoard = S === boardScope;
    // Bestem drop-mål OG sluttplassering ut fra de FAKTISKE slipp-koordinatene,
    // ikke det som lå mellomlagret fra siste pointermove: den kan være koalescert
    // bort eller helt utelatt (rask gest), så både breadcrumb-treffet og
    // placeholderen kunne blitt hentet fra nest siste bevegelse.
    if (ev && typeof ev.clientX === 'number') {
      drag.lastX = ev.clientX; drag.lastY = ev.clientY;
    }
    /* Slipp i søppelkassen: draget rulles tilbake som et AVBRUTT drag (ingen ny
       pos, ingen lagring, ingen flytte-velger), og slettingen tar over. Sjekkes
       før plasseringen committes — et slipp i kassen skal ikke også omrokkere. */
    if (pointerOnDragTrash(drag.lastX, drag.lastY)) {
      const trashedId = el.dataset.id;
      onCardCancel();
      dropIntoTrash(S, 'card', trashedId);
      return;
    }
    if (ev && typeof ev.clientX === 'number') {
      // (Kortet flyttes IKKE hit visuelt: drop-tweenen starter fra der det faktisk
      // står malt, se dropIntoPlaceholder — et snapp hit først ville gitt et rykk.)
      if (!(onBoard && pointerInTopbar(drag.lastX, drag.lastY))) commitCardPlacement();
    }
    const relX = drag.lastX;
    const relY = drag.lastY;
    const cardObj = S.findContainer(el.dataset.id);
    const onCrumb = onBoard && pointerOnNavCrumb(relX, relY) &&
      moveTargetGroups(cardObj).length > 0;
    setCardCrumbTarget(false); // fjern evt. highlight uansett utfall

    const rot = cardRotation();
    drag.ph.parentNode.insertBefore(el, drag.ph); // placeholderens kolonne
    drag.ph.remove();
    finishDrag();
    restoreCardsAfterDrag();  // fold listene tilbake til lagret lukketilstand (momentant)
    releaseBoardAfterDrag();  // slipp touch-vakten momentant (no-op på mus) → layout satt

    // Ny rekkefølge: gi kortet en pos mellom naboene i LESEREKKEFØLGE (naboen
    // over den øverste raden i en kolonne ligger nederst i kolonnen før).
    // Kirurgisk – kun dette kortets posisjonsregister endres, så samtidige
    // endringer på andre kort/enheter flettes uten konflikt.
    const prev = boardRowSibling(el, -1);
    const next = boardRowSibling(el, 1);
    const c = S.findContainer(el.dataset.id);
    if (c) {
      const pPrev = prev && prev.classList.contains('card') ? (S.findContainer(prev.dataset.id) || {}).pos : null;
      const pNext = next && next.classList.contains('card') ? (S.findContainer(next.dataset.id) || {}).pos : null;
      const np = between(pPrev == null ? null : pPrev, pNext == null ? null : pNext);
      if (c._canon) {
        // Områder (og frie mapper) ordnes PERSONLIG — posisjonen ligger på
        // min egen medlemskapsrad og endrer aldri hva andre ser.
        c.pos = np;
        cloudPersonalPos(S.contKind, c.id, np);
      } else {
        c.pos = np;
        stampPos(c);
      }
    }
    S.reindexColors();
    save();

    // Visuell plassering (etter at layouten er satt av restore/release over): legg
    // kortet i normal flyt, mål slot-en, fly det inn fra slipp-punktet, og scroll
    // så den slupne lista inn i visning (endring 2). slotDocTop måles UTEN dra-
    // transformen (dropIntoPlaceholder setter den etterpå), og i DOKUMENT-koordinat
    // så den er upåvirket av selve scrollingen.
    // Mål den faktiske dra-boksen (uten dra-rotasjonen) før stilene ryddes —
    // drop-tweenen skal starte der kortet står malt (dropIntoPlaceholder).
    const fromRect = untransformedRect(el);
    el.classList.remove('dragging');
    el.style.left = el.style.top = el.style.width = el.style.height = '';
    el.style.transform = '';
    // Kortene er tilbake i normal flyt (og utvidet igjen) → fordel kolonnene på
    // nytt FØR vi måler sloten, så drop-tweenen sikter på den endelige plassen.
    relayoutBoard(S);
    const slotRect = el.getBoundingClientRect();
    const slotDocTop = slotRect.top + window.scrollY;
    const slotH = slotRect.height;
    dropIntoPlaceholder(el, rot, fromRect);
    // Scroll-til-slupt gjelder vindus-scrollen, altså kun hovedsidens board.
    if (onBoard && !onCrumb) scrollDroppedIntoView(slotDocTop, slotH);

    // Slipp på 📁-breadcrumben: kortet er lagt normalt tilbake på board-et
    // (posisjonen over), og flytte-velgeren åpnes — avbrytes den, blir lista
    // stående der den lå.
    if (onCrumb && cardObj) askCardMove(cardObj);
  }

  // Etter et fullført liste-drag: sørg for at den slupne lista er synlig — men så
  // lite påtrengende som mulig. Ligger den allerede komfortabelt i det trygge
  // området (mellom toppmenyen og viewportbunnen), gjør vi INGENTING; ellers
  // scroller vi den KORTEST MULIGE avstanden inn i det området i stedet for alltid
  // å toppjustere den. En liste som var synlig hele tiden skal ikke rykke rundt
  // bare fordi den ble omrokkert. `cardDocTop`/`cardH` = dokument-Y og høyde for
  // kortets hvileposisjon (målt FØR fly-inn-transformen).
  function scrollDroppedIntoView(cardDocTop, cardH) {
    const topbarH = topbarEl.getBoundingClientRect().height;
    const gap = parseFloat(getComputedStyle(board).columnGap) || 16;
    const vh = window.innerHeight || document.documentElement.clientHeight || 0;
    const safeTop = topbarH + gap;   // øverste synlige linje (rett under toppmenyen)
    // Nederste synlige linje: gestelinjen dekker de nederste pikslene, så
    // viewportbunnen alene ville latt kortet ligge delvis under den.
    const safeBottom = vh - safeInsets().bottom - gap;
    const y = window.scrollY;
    const top = cardDocTop - y;      // kortets viewport-Y akkurat nå
    let target = y;
    if (top < safeTop) target = cardDocTop - safeTop;                 // ligger (delvis) bak toppmenyen
    else if (top + cardH > safeBottom) {
      // Stikker under viewportbunnen: scroll ned akkurat nok — men aldri så langt
      // at toppen forsvinner bak toppmenyen (høye lister prioriterer toppen).
      target = y + Math.min(top + cardH - safeBottom, top - safeTop);
    }
    const maxScroll = Math.max(0, document.documentElement.scrollHeight - vh);
    target = Math.max(0, Math.min(target, maxScroll));
    if (Math.abs(target - y) < 1) return; // allerede komfortabelt synlig → ikke rør viewporten
    window.scrollTo({ top: target, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  }

  // pointercancel under et liste-drag: rull tilbake til utgangspunktet uten å
  // beregne pos, stampe, oppdatere farge/mount eller lagre — og uten å åpne
  // mappe-flyttevelgeren. Kollapsen foldes tilbake og touch-vakten slippes.
  function onCardCancel() {
    if (!drag.active) return;
    window.removeEventListener('pointermove', onCardMove);
    window.removeEventListener('pointerup', onCardUp);
    window.removeEventListener('pointercancel', onCardCancel);
    setCardCrumbTarget(false);
    restoreDraggedToOrigin();
    finishDrag();
    restoreCardsAfterDrag();
    releaseBoardAfterDrag();
  }

  // Fargene er posisjonsbaserte (colorForIndex): en omrokkering endrer alle
  // kortenes posisjon i den sorterte lista, ikke bare det flyttede kortets —
  // reindekser derfor alltid samtlige (kirurgisk: kun CSS-variabler på
  // eksisterende DOM-noder, ingen full re-rendring av board-et).
  function reindexContainerColors(scope) {
    const S = scope || boardScope;
    /* Den VIRTUELLE beholderen («Mapper delt med meg») filtreres bort først —
       nøyaktig som `renderNav()` gjør når den deler ut farger. To grunner, og
       begge betyr noe:

         • Den har ingen palettfarge. Flaten er et nøytralt `--free-*`-sett fra
           klassen `.free-groups-card`, og `buildUniverseCard()` hopper over
           `paintCardColor` for den med vilje. En inline `--card-bg` herfra
           ville overstyrt klassen.
         • Den skal ikke TELLE. Fargen er posisjonsbasert, og `renderNav()`
           indekserer den filtrerte lista. Tok vi den med her, ville hvert
           område etter den fått en annen farge enn rendringen ga dem. */
    S.containers().filter((c) => !c._virtual).forEach((c, i) => {
      c.color = colorForIndex(i);
      const el = S.root.querySelector('.card[data-id="' + c.id + '"]');
      if (!el) return;
      paintCardColor(el, c.color);
    });
  }

  /* ---------------- ELEMENT-DRAGING ---------------- */
  function startItemDrag(ev, itemEl) {
    if (ev.button != null && ev.button !== 0) return;
    if (drag.active) return; // ignorer ny drag mens en pågår (unngår foreldreløs placeholder)
    beginDragCommon(ev, itemEl);
    drag.kind = 'item';
    drag.phMode = 'reorder';
    // Kassen som gjelder er den i containeren raden kom FRA — ikke den man
    // tilfeldigvis svever over. Slettingen legger raden i kildens kasse.
    drag.trashHost = itemEl.closest('.card');

    const ph = document.createElement('li');
    ph.className = 'item-placeholder';
    ph.style.height = drag.height + 'px';
    itemEl.parentNode.insertBefore(ph, itemEl);
    drag.ph = ph;

    liftElement();
    applyDragSeparators(); // etter løftet: det dratte er da ute av flyten (ingen nabo)
    drag.el.style.transform = `rotate(${cardRotation()}deg) scale(1.03)`; // dynamisk rotasjon (globalt)
    window.addEventListener('pointermove', onItemMove);
    window.addEventListener('pointerup', onItemUp);
    window.addEventListener('pointercancel', onItemCancel);
    armDragTrash();
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
    const o = dragScope().findRow(sib.dataset.id);
    return o ? (o.pos || 0) : null;
  }

  /* ---------------- Skillelinjer under DnD (forhåndsvisning) ----------------
     I hvile males skillelinjene rundt en kategoris hylle av pseudo-elementer på
     selve kategorien (.category::before/::after i styles.css): en linje mellom to
     nabo-rader på nivå 1 når minst én av dem er en kategori. Under et listepunkt-
     eller kategori-drag holder ikke de reglene: de kjenner ikke PLACEHOLDEREN (som
     er den kommende plassen), og de teller det LØFTEDE objektet som nabo selv om
     det er absolutt posisjonert og ute av flyten. Da tar JS over i containerne
     draget berører — `.seps-managed` slår av pseudo-linjene, og hver rad som skal
     ha en linje OVER seg får `.sep-above` (margin + en absolutt posisjonert linje
     med samme geometri som i hvile). Placeholderen teller som den raden den
     representerer (kategori-placeholderen som en kategori), så man ser
     skillelinjene slik de BLIR hvis man slipper der den står. Klasser (ikke
     innsatte linje-elementer) nettopp fordi radenes DOM-naboskap brukes av
     plasserings- og pos-logikken (wouldMove/rowPos). */
  const sepConts = new Set();
  // Radene i en nivå-1-container som deltar: listepunkter, kategorier og
  // placeholderen. Det dratte objektet er ute av flyten og er ingen nabo.
  function sepRows(cont) {
    return [...cont.children].filter((c) => !c.classList.contains('dragging') &&
      (c.classList.contains('item') || c.classList.contains('category') ||
       c.classList.contains('item-placeholder')));
  }
  function isCatRow(el) {
    return el.classList.contains('category') || el.classList.contains('cat-placeholder');
  }
  function clearSepsIn(cont) {
    cont.classList.remove('seps-managed');
    [...cont.children].forEach((c) => c.classList.remove('sep-above', 'sep-below'));
    sepConts.delete(cont);
  }
  // Kalles ved dragstart og etter hver placeholder-flytting — FØR FLIP-en måler
  // den nye layouten, så linjene som dukker opp/forsvinner animeres med radene.
  function applyDragSeparators() {
    const level1 = (n) => (n && n.classList && n.classList.contains('items-container')) ? n : null;
    const conts = new Set();
    const src = level1(drag.origParent);   // kilden: det løftede objektet er ikke lenger en nabo
    if (src) conts.add(src);
    const dst = drag.ph && level1(drag.ph.parentNode); // målet: placeholderen er en ny nabo
    if (dst) conts.add(dst);
    for (const cont of [...sepConts]) if (!conts.has(cont)) clearSepsIn(cont);
    for (const cont of conts) {
      cont.classList.add('seps-managed');
      sepConts.add(cont);
      // Nullstill ALLE barn først (ikke bare radene): det løftede objektet kan ha
      // fått en linje mens det ennå lå i flyten, og skal ikke bære den med seg.
      [...cont.children].forEach((c) => c.classList.remove('sep-above', 'sep-below'));
      const rows = sepRows(cont);
      rows.forEach((row, i) => {
        const prev = i > 0 ? rows[i - 1] : null;
        if (!prev || !(isCatRow(prev) || isCatRow(row))) return;
        // En rad som er FORFAR til det løftede objektet må ALDRI posisjoneres:
        // `.sep-above` setter `position: relative`, og da blir raden containing
        // block for det absolutt posisjonerte dra-elementet — dets dokument-
        // koordinater tolkes plutselig relativt til raden, og kortets
        // `overflow: hidden` klipper det bort (et listepunkt dratt UT av en
        // kategori til nivå 1 i samme liste «forsvant»). Samme fallgruve som
        // flipFrom unngår. Linja males da fra raden OVER i stedet
        // (`.sep-below`, identisk geometri) — den er aldri en forfar.
        if (drag.el && row.contains(drag.el)) prev.classList.add('sep-below');
        else row.classList.add('sep-above');
      });
    }
  }
  function clearAllDragSeparators() {
    for (const cont of [...sepConts]) clearSepsIn(cont);
  }

  function onItemMove(ev) {
    if (!drag.active) return;
    if (dragElDetached()) { cancelActiveDrag(); return; }
    const dy = ev.clientY - drag.lastY;
    drag.lastX = ev.clientX;
    drag.lastY = ev.clientY;
    moveElement();
    drag.el.style.transform = `rotate(${cardRotation()}deg) scale(1.03)`;
    // Sikter man på kassen, står placeholderen i ro: slippet sletter, det
    // flytter ikke. (Se «Slett ved å dra objektet i søppelkassen».)
    if (pointerOnDragTrash(drag.lastX, drag.lastY)) {
      setDragTrashTarget(true);
      stopAutoScroll();
      return;
    }
    setDragTrashTarget(false);
    updateAutoScroll();
    updatePeek(drag.lastX, drag.lastY);
    updateItemPlacement(drag.lastX, drag.lastY, dy);
  }

  // Finn og utfør evt. placeholder-flytting for et listepunkt-drag. px/py =
  // pekerposisjon (viewport), dy = retning (peker-delta eller rulleretning fra
  // auto-scroll). Kalles fra onItemMove og fra auto-scroll-loopen (stille peker).
  function updateItemPlacement(px, py, dy, commit) {
    if (!drag.active || drag.kind !== 'item') return;
    // Utenfor alle lister (board-luft mellom/utenfor listene) → ny-liste-
    // placeholder (ekstrahering til en ny liste med bare dette listepunktet).
    const overCard = dragOverCard();
    if (!overCard) {
      // Uten opprettelsesrett i mappen finnes ingen ny liste å slippe i: da blir
      // reorder-placeholderen stående der den var, og et slipp i board-lufta
      // legger objektet tilbake der det kom fra.
      if (!canExtractDragged()) { setReorderMode(); return; }
      setExtractMode();
      placeNewListPlaceholder();
      return;
    }
    const beforeTop = overCard.getBoundingClientRect().top;
    setReorderMode();
    noteOverShift(overCard, beforeTop); // modusbyttet rykker lista — se noteOverShift
    const dragRect = draggedRect();
    const flipEls = [...dragScope().root.querySelectorAll('.item:not(.dragging), .category:not(.dragging)')];

    // 1) Nivå 2 først: er pekeren inne i en kategori i lista? → kategoriens
    //    .cat-items (slipp på overskriften ELLER blant listepunktene legger
    //    listepunktet i kategorien). Innenfor lista er det fortsatt PEKEREN som
    //    velger rad/kategori — 1/3-reglene gjelder kun grensen mellom lister.
    let targetCont = null;
    for (const cat of overCard.querySelectorAll('.category:not(.dragging)')) {
      if (pointerInRect(cat.getBoundingClientRect(), px, py)) {
        targetCont = cat.querySelector('.cat-items'); break;
      }
    }
    // 2) Nivå 1: kortets .items-container (håndterer overføring mellom kort).
    if (!targetCont) targetCont = overCard.querySelector('.items-container');
    if (!targetCont) return;

    // Er målet en KOLLAPSET (ennå ikke peek-åpnet) liste eller kategori? La
    // placeholderen bli der den er mens peek-timeren (200 ms) løper — flyttet vi den
    // inn nå, ville kildekortet krympet og målet stukket vekk under pekeren (peek
    // ville aldri rukket å åpne). `commit` (fra onItemUp) overstyrer: ved selve
    // slippet skal listepunktet lande i det kollapsede målet selv om peek ikke rakk.
    const tCardEl = targetCont.closest('.card');
    const tCatEl = targetCont.closest('.category');
    if (!commit && ((tCardEl && tCardEl.classList.contains('collapsed')) ||
                    (tCatEl && tCatEl.classList.contains('collapsed')))) return;

    const ph = drag.ph;
    const rows = rowChildren(targetCont);
    const phInCont = ph.parentNode === targetCont;
    const hasCat = rows.some((r) => r.classList.contains('category'));

    let action = null; // {pos:'before'|'after'|'append', ref?}

    if (!phInCont || hasCat || commit) {
      // Overføring til en annen container, ELLER nivå 1 med kategorier (blandede
      // radhøyder), ELLER sluttplasseringen ved slipp: senterbasert innsetting —
      // robust der overlapp-hysteresen ellers ville feilet mot en høy kategori-
      // blokk, og ved slipp finnes det ingen retning å styre etter (siste
      // pointermove kan mangle helt, se centerPlaceRows).
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
      ? !isAtItemsEnd(targetCont, ph)
      : wouldMove(ph, action.ref, action.pos);
    if (!willMove) return;
    // Anti-reverseringslåsen skal aldri overstyre slippet: den finnes for å dempe
    // flimring under bevegelse, mens slipp-punktet er en tydelig sluttintensjon.
    if (!commit && swapReversesRecent(action)) return;

    const snap = snapshotRects(flipEls);
    if (action.pos === 'append') appendToItemsEnd(targetCont, ph);
    else placePlaceholder(ph, action.ref, action.pos);
    applyDragSeparators();
    flipFrom(snap, FLIP_MS);
    recordSwap(action);
  }

  function onItemUp(ev) {
    if (!drag.active) return;
    if (dragElDetached()) { cancelActiveDrag(); return; }
    window.removeEventListener('pointermove', onItemMove);
    window.removeEventListener('pointerup', onItemUp);
    window.removeEventListener('pointercancel', onItemCancel);

    // Re-evaluer modus/plassering fra de FAKTISKE slipp-koordinatene før vi
    // avgjør extract vs. reorder: siste pointermove kan være koalescert eller
    // helt utelatt, så `drag.phMode`/placeholderen kan være foreldet (samme
    // fort/koalescert-peker-tilfelle som onCardUp håndterer for breadcrumben).
    // Retningen (dy) regnes FØR drag.lastY overskrives; med commit=true er
    // plasseringen uansett senterbasert, så et slipp uten forutgående bevegelse
    // (dy = 0) lander riktig også i en homogen liste — der den retningsstyrte
    // varianten tidligere ikke gjorde noe i det hele tatt.
    if (ev && typeof ev.clientX === 'number') {
      const dy = ev.clientY - drag.lastY;
      drag.lastX = ev.clientX; drag.lastY = ev.clientY;
      /* Slipp i søppelkassen avgjøres FØR plasseringen re-evalueres: raden skal
         hverken flyttes eller ekstraheres, bare slettes. Draget rulles tilbake
         som et avbrutt drag, og slette-funksjonen gjør resten. */
      if (pointerOnDragTrash(drag.lastX, drag.lastY)) {
        const trashScope = dragScope();
        const trashedId = drag.el.dataset.id;
        onItemCancel();
        dropIntoTrash(trashScope, 'item', trashedId);
        return;
      }
      updateItemPlacement(drag.lastX, drag.lastY, dy, true); // commit: lande i kollapset mål om peek ikke rakk
    }

    if (drag.phMode === 'extract') { extractRowToNewContainer(); return; }

    const S = dragScope();
    const el = drag.el;
    const rot = cardRotation();
    const sourceCardId = el.closest('.card') ? el.closest('.card').dataset.id : null;
    const targetContainer = drag.ph.parentNode;

    // Mål-containeren LÅST for meg? DB-guarden krever redigering på BÅDE gammel og
    // ny forelder, så en overføring dit ville blitt avvist og snappet tilbake ved
    // neste synk. Rull tilbake som et avbrutt drag i stedet (og si fra) — samme
    // sjekk som kryss-liste-flyttingen i onCategoryUp gjør.
    const targetHead = targetContainer.closest('.card');
    if (targetHead && targetHead.dataset.id !== sourceCardId) {
      const tc = S.findContainer(targetHead.dataset.id);
      // Ugyldig mål avvises MED EN GANG. Serveren ville uansett avvist skrivingen
      // og snappet objektet tilbake ved neste synk; her rulles draget tilbake som
      // et avbrutt drag, med en forklaring.
      let reason = null;
      if (tc && frozen(tc)) reason = S.lockedTargetMsg;
      else if (tc && tc._virtual) reason = tr('dnd.groupNeedsUniverse');
      else if (tc && S.rowKind === 'group' && !cap(tc, 'createGroup', !frozen(tc))) {
        reason = tr('dnd.cannotCreateGroupHere');
      }
      if (reason) {
        restoreDraggedToOrigin();
        finishDrag(); // rydder placeholder/skillelinjer + kollapser evt. peek-åpnet mål
        showToast(reason);
        return;
      }
    }

    targetContainer.insertBefore(el, drag.ph);
    drag.ph.remove();
    // Tilbake til hvile-skillelinjene FØR dropIntoPlaceholder måler hvileposisjonen
    // (ellers måles den uten en evt. linje over det slupne objektet → et hopp).
    clearAllDragSeparators();
    // Peek-oppgjør FØR finishDrag: et peek-åpnet mål elementet landet i forblir åpent,
    // andre peek-åpnede mål kollapses tilbake (finishDrag sitt sikkerhetsnett blir no-op).
    resolvePeekOnDrop(el.closest('.card'), el.closest('.category'));
    dropIntoPlaceholder(el, rot);
    finishDrag();

    const targetCardId = el.closest('.card').dataset.id;
    const catEl = el.closest('.category'); // ligger elementet nå inne i en kategori?
    const prev = el.previousElementSibling;
    const next = el.nextElementSibling;

    // Ta et øyeblikksbilde av alle rader FØR reconcile: ved overføring til en
    // annen container må mål-containeren finne den flyttede raden selv om kilden
    // reconciles først (ellers droppes den fra pool-en før målet ser den).
    const pool = S.rowPool();
    reconcileRows(S, sourceCardId, pool);
    if (targetCardId !== sourceCardId) reconcileRows(S, targetCardId, pool);

    // Kirurgisk: sett kun den flyttede radens forelder (home/uni), kategori (cat)
    // og posisjon. `cat` rir på posisjonsregisteret (som forelderen).
    const moved = S.findRow(el.dataset.id);
    let groupMove = null;
    if (moved) {
      const np = between(rowPos(prev), rowPos(next));
      const fromCont = S.rowParent(moved);
      if (S.rowKind === 'group' && targetCardId !== fromCont) {
        // En MAPPE som bytter område går gjennom move_group-RPC-en (databasen
        // avviser en direkte `universe_id`-skriving). Vi flytter den optimistisk
        // her og lar RPC-en avgjøre reparenting vs. kopier-og-slett.
        groupMove = { from: fromCont, to: targetCardId, cat: catEl ? catEl.dataset.id : null, pos: np };
        S.setRowParent(moved, targetCardId);
        moved._parent = S.findContainer(targetCardId) || moved._parent;
        moved.cat = groupMove.cat;
        moved.pos = np;
      } else if (moved._canon) {
        // Fri mappe omrokkert i sin egen seksjon: PERSONLIG rekkefølge.
        moved.cat = null;
        moved.pos = np;
        cloudPersonalPos(S.rowKind, moved.id, np);
      } else {
        S.setRowParent(moved, targetCardId);
        moved.cat = catEl ? catEl.dataset.id : null;
        moved.pos = np;
        stampPos(moved);
      }
    }
    // Et slipp inn i en fortsatt kollapset liste/kategori (rask slipp uten peek) har
    // endret leaf-antallet → oppdater «(N)»-tellerne.
    refreshAllCollapseCounts();
    save();
    S.afterDrop();
    if (groupMove) commitGroupMove(moved, groupMove.from, groupMove.to, groupMove.cat, groupMove.pos);
  }

  /* ---------------- Mappeflytting mellom områder (move_group) ----------------
     Én atomisk server-operasjon eier flyttingen: samme EIERSKAPSDOMENE (identisk
     sett områdeeiere) gir ekte reparenting med alle id-er, roller og medlemmer i
     behold; ULIKT domene behandles som «slett hos de gamle, opprett hos de nye» —
     serveren kopierer undertreet med NYE id-er og gravlegger de gamle. Derfor
     bekreftelsen: medlemskretsen endres, og de gamle mister tilgangen.

     Klienten viser flyttingen optimistisk (pendingGroupMoves) og holder mappens
     doc-rad på den GAMLE plasseringen til RPC-en har landet — ellers ville
     doc-synken forsøkt en skriving databasen uansett avviser. */
  // Eierskapsdomenet som sammenlignbar nøkkel. Et område som ennå ikke er
  // synket (nyopprettet lokalt) har ingen serververdi — men da er JEG eneste
  // eier, så nøkkelen er min egen id. Slik slipper «flytt mappen til et nytt
  // område» en unødig «dette bytter eierskap»-bekreftelse.
  const ownerKeyOf = (u) => {
    if (!u) return null;
    if (u._ownerKey != null) return u._ownerKey;
    return (u._role === 'owner' && !u._caps) ? myId() : null;
  };
  async function commitGroupMove(g, fromUni, toUni, toCat, toPos) {
    const src = findUniverse(fromUni);
    const dst = findUniverse(toUni);
    const canon = g._canon || {};
    const from = {
      fromUni: canon.parent != null ? canon.parent : fromUni,
      fromCat: canon.cat != null ? canon.cat : null,
      fromPos: canon.pos != null ? canon.pos : g.pos,
    };
    // Ukjent kilde-domene (fri mappe: kilde-området er ikke lesbart) regnes
    // som en domenekryssing — serveren avgjør uansett.
    const srcKey = ownerKeyOf(src), dstKey = ownerKeyOf(dst);
    const crossDomain = !srcKey || !dstKey || srcKey !== dstKey;
    if (crossDomain) {
      const ok = await askConfirm({
        title: tr('move.otherOwnersTitle'),
        message: tr('move.otherOwnersMsg', { name: quoted(g.name || tr('kind.group')) }),
        okLabel: tr('move.otherOwnersOk'),
      });
      if (!ok) { revertGroupMove(g, from); return; }
    }
    pendingGroupMoves.set(g.id, Object.assign({}, from, { toUni, toCat, toPos }));
    const key = 'move:' + g.id;
    opQueue.enqueue({
      key,
      waitFor: () => rowKnownToServer(g.id) && rowKnownToServer(toUni),
      run: async () => {
        const { data, error } = await acli().rpc('move_group',
          { p_group: g.id, p_universe: toUni, p_cat: toCat, p_pos: toPos });
        if (error) throw error;
        return data;
      },
      onDone: (res) => {
        pendingGroupMoves.delete(g.id);
        // Kryssdomene: serveren laget et NYTT undertre. Bytt id-ene lokalt med
        // den returnerte mappingen, så den optimistiske visningen glir over uten
        // flimmer, og gravlegg de gamle (serveren har allerede gjort det).
        if (res && res.mode === 'copy' && res.mapping) applyIdMapping(res.mapping);
        cloudBase = null;
        scheduleCloud(0);
      },
      onError: (e) => {
        pendingGroupMoves.delete(g.id);
        revertGroupMove(g, from);
        showToast(friendlyAuthError(e));
        scheduleCloud(0); // server-sannheten gjenoppretter visningen
      },
    });
  }
  function revertGroupMove(g, from) {
    const live = findGroupAnywhere(g.id) || g;
    const src = findUniverse(from.fromUni);
    // Fjern raden fra ALLE beholdere først: den optimistiske flyttingen bygde
    // om rad-arrayene, så `_parent` er ikke nødvendigvis der raden faktisk står.
    state.universes.forEach((u) => {
      const i = (u.groups || []).indexOf(live);
      if (i > -1) u.groups.splice(i, 1);
    });
    live.uni = from.fromUni; live.cat = from.fromCat; live.pos = from.fromPos;
    if (src) { live._parent = src; src.groups.push(live); }
    render();
    save();
  }
  // Bytt gamle id-er mot nye i hele det lokale treet, og gravlegg de gamle.
  function applyIdMapping(mapping) {
    const remap = (o) => (o && mapping[o] ? mapping[o] : o);
    state.universes.forEach((u) => (u.groups || []).forEach((g) => {
      if (mapping[g.id]) { state._tomb.groups[g.id] = tick(); g.id = mapping[g.id]; }
      if (g.cat) g.cat = remap(g.cat);
      (g.cards || []).forEach((c) => {
        if (mapping[c.id]) { state._tomb.cards[c.id] = tick(); c.id = mapping[c.id]; }
        c.group = g.id;
        (c.items || []).forEach((it) => {
          if (mapping[it.id]) { state._tomb.items[it.id] = tick(); it.id = mapping[it.id]; }
          it.home = c.id;
          if (it.cat) it.cat = remap(it.cat);
        });
      });
    }));
    if (state.activeGroup && mapping[state.activeGroup]) state.activeGroup = mapping[state.activeGroup];
    render();
    save();
  }

  // pointercancel under et listepunkt-drag: rull tilbake uten reconcile/pos/lagre.
  function onItemCancel() {
    if (!drag.active) return;
    window.removeEventListener('pointermove', onItemMove);
    window.removeEventListener('pointerup', onItemUp);
    window.removeEventListener('pointercancel', onItemCancel);
    restoreDraggedToOrigin();
    finishDrag();
  }
  // Slipp i ny-container-placeholderen: opprett en ny liste (board) / et nytt
  // område (nav) med bare denne raden, og fokusér navnet (blank input) straks.
  function extractRowToNewContainer() {
    const S = dragScope();
    const el = drag.el;
    const moved = S.findRow(el.dataset.id);
    const srcCont = moved ? S.findContainer(S.rowParent(moved)) : null;
    const np = extractionPos();
    const nc = moved && srcCont ? S.createContainer('') : null; // blank navn → fokuseres straks
    if (!nc) { // uventet (f.eks. ingen aktiv mappe) → rull tilbake
      restoreDraggedToOrigin();
      finishDrag();
      return;
    }
    nc.pos = np; stampContent(nc); stampPos(nc);

    const fromCont = S.rowParent(moved);
    const srcRows = S.rowsOf(srcCont);
    const si = srcRows.indexOf(moved);
    if (si > -1) srcRows.splice(si, 1);
    S.setRowParent(moved, nc.id); moved.cat = null; moved.pos = 0;
    if (S.rowKind !== 'group') stampPos(moved);
    S.rowsOf(nc).push(moved);
    moved._parent = nc;

    finishDrag();
    S.render();
    save();
    // En mappe som havner i et NYTT område krysser alltid et eierskapsdomene
    // (det nye området har bare meg som eier) → move_group avgjør og bekrefter.
    if (S.rowKind === 'group') commitGroupMove(moved, fromCont, nc.id, null, 0);
    // Fokuser navnet på den nye containeren (blank input) så den kan navngis straks.
    startRename(S.root.querySelector('.card[data-id="' + nc.id + '"] .card-title'));
  }

  // Bygg rad-arrayet for en container ut fra gjeldende DOM (medlemskap OG
  // kategori): nivå-1-rader leses fra `.items-container` (ukategoriserte +
  // kategorier), og hver kategoris rader fra dens `.cat-items` (setter `cat`).
  // `pool` = felles øyeblikksbilde av alle rader (så en overføring ikke faller ut
  // mellom kilde- og mål-reconcile); bygges her hvis ikke gitt.
  function reconcileRows(S, contId, pool) {
    const cardData = S.findContainer(contId);
    if (!cardData) return;
    const cardEl = S.root.querySelector('.card[data-id="' + contId + '"]');
    if (!cardEl) return;
    pool = pool || S.rowPool();
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
    const preserved = S.rowsOf(cardData).filter((r) => !seen.has(r.id) && (r.trashed || r.done || r._pendingDelete));
    S.setRows(cardData, result.concat(preserved));
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
    el.style.left = dragPosLeft() + 'px';
    el.style.top = dragPosTop() + 'px';
    el.classList.add('dragging');
  }
  function collapseCategory(catEl, ph) {
    const catItems = catEl.querySelector('.cat-items');
    // offsetHeight (ikke getBoundingClientRect): sistnevnte ville inkludert dra-
    // rotasjonen (som blåser opp en bred, lav header kraftig) → for høy placeholder.
    const headH = catEl.querySelector('.cat-head').offsetHeight;
    const collapsedH = headH + 12; // header + .category.dragging-polstring (6px topp/bunn, gap:0)
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
  // Etter et kategori-drag (slipp/kansellering): fold ut igjen MED MINDRE kategorien
  // er klikk-kollapset (rullgardin, `cat.collapsed`) — da beholdes den kollapset.
  function settleCategoryAfterDrag(catEl) {
    const catObj = dragScope().findRow(catEl.dataset.id);
    if (catObj && catObj.collapsed) {
      const inner = catEl.querySelector('.cat-items');
      if (inner) {
        inner.style.transition = ''; inner.style.overflow = 'hidden';
        inner.style.height = '0px'; inner.style.opacity = '0';
        inner.style.paddingTop = '0'; inner.style.paddingBottom = '0';
      }
      catEl.classList.add('collapsed');
    } else {
      expandCategory(catEl);
    }
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
    else placePlaceholder(ph, action.ref, 'before');
    applyDragSeparators();
    flipFrom(snap, FLIP_MS);
  }
  /* ---------------- Ekstrahering til ny liste (kategori/listepunkt → nytt kort) ----------------
     Drar man en kategori (eller et listepunkt) UT av listene og holder den over,
     under eller mellom dem, dukker en KORT-formet placeholder med et ＋-ikon opp på
     board-et — slipp der oppretter en NY liste. En kategori blir en liste med samme
     tittel og sine (ukategoriserte) listepunkter; et listepunkt blir en liste med
     bare seg selv (navneinputen blank + fokusert straks). Den som ekstraherer blir
     OPPRETTER (owner) av den nye lista: den lages lokalt med ny id og pushes som en
     ny rad eid av gjeldende bruker (insertPayload → owner_id = meg), uansett hvem som
     opprettet kilde-lista. Ekstrahering fra en LÅST (frosset) liste er umulig — selve
     draget er da avskrudd (attachHoldDrag canDrag = !frozen). `drag.phMode`
     ('reorder' | 'extract') styrer hvilken placeholder som er aktiv. */
  // Får det LØFTEDE objektet i det hele tatt bli sin egen container? Board-scopet
  // spør mappen om opprettelsesrett, nav-scopet spør mappen om den kan flyttes
  // ut av området sitt. Er svaret nei, dukker ny-liste-placeholderen aldri opp
  // (i stedet for å tilby en flytting serveren avviser).
  function canExtractDragged() {
    const S = dragScope();
    return !!S.canExtract(drag.el ? S.findRow(drag.el.dataset.id) : null);
  }
  function pointerInRect(r, x, y) { return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom; }
  /* Hvilken liste «er» det løftede objektet i? (null = board-luft → ekstrahering.)
     Avgjøres av OBJEKTETS EGEN BOKS, ikke pekeren: pekeren sitter der man tok tak,
     så med et pekerbasert svar dukket ny-liste-placeholderen opp mye senere på vei
     nedover ut av en liste enn oppover (og motsatt inn i den neste).

     Referanselinjene er listas INNHOLDSSONE — fra listetittelens (korthodets)
     nedre kant til midt i +-knapperaden — begge veier, både inn og ut. Kortets
     ytterkanter brukes ikke: tittelraden og knapperaden er «rammen», og et objekt
     som ligger oppå dem hører ikke til innholdet. Terskelen er den samme linja
     hver vei, og det er alltid 1/3 av objektet som passerer den:
     - INN/UT ved TITTELEN: objektets ØVRE 1/3 har passert tittelens nedre kant
       (nedover = inn, oppover = ut).
     - INN/UT ved KNAPPENE: objektets NEDRE 1/3 har passert midtlinja i
       +-knapperaden (oppover = inn, nedover = ut).
     Det er én regel: objektet er i lista når dets MIDTRE 1/3 ligger innenfor
     sonen. Vannrett (flerkolonne på desktop) avgjør pekerens kolonne som før;
     1/3-reglene er rent loddrette. Valget henger igjen i `drag.overCard`. */
  // Minste innholdssone vi tør sikte på (utover objektets midtre 1/3). Må dekke
  // layout-hoppet man får idet man går INN i en liste: ny-liste-placeholderen
  // (≥ 72 px) forsvinner fra board-et samtidig som reorder-placeholderen (én
  // radhøyde) legges inn i lista, så lista rykker et stykke oppover mot objektet.
  // Er sonen mindre enn dette, ville objektet falt ut igjen i samme bevegelse.
  const MIN_BAND_SLACK = 48;
  function cardBand(cardEl, third) {
    const r = cardEl.getBoundingClientRect();
    const collapsed = cardEl.classList.contains('collapsed');
    // En KOLLAPSET liste har ingen innholdssone å sikte på — der er hele det
    // (header-høye) kortet sonen. Det samme gjelder en PEEK-ÅPNET liste: den ble
    // åpnet nettopp fordi objektet siktet på den (over overskriften, det eneste
    // som fantes), og skal ikke falle ut av lista i det den folder seg ut.
    const peeked = drag.peekCard && drag.peekCard.el === cardEl && drag.peekCard.expanded;
    if (collapsed || peeked) return { top: r.top, bottom: r.bottom };
    const head = cardEl.querySelector('.card-head');
    const add = cardEl.querySelector('.add-item-row');
    const ar = add && !add.hidden ? add.getBoundingClientRect() : null;
    // Linjene går gjennom MIDTEN av rammeradene, ikke langs innerkantene deres:
    // halve tittelraden og halve knapperaden er slark, så FØRSTE og SISTE plass i
    // lista er like lett å treffe som plassene mellom radene.
    // - Nederst: for å havne sist må objektets senter forbi siste rads senter, og
    //   da stikker nedre 1/3 nesten ned i knapperaden. Lander man en KATEGORI sist,
    //   krymper lista samtidig ~25 px (skillelinja under placeholderen forsvinner
    //   når den blir siste rad), så linja kommer opp mot objektet mens man sikter.
    // - Øverst: ligger en KATEGORI først i lista, er det bare ~10 px mellom
    //   tittelraden og kategorien — og pekeren må være der for å treffe nivå 1 i
    //   stedet for inne i kategorien. Uten slarken var «over en kategori øverst»
    //   umulig (målt: 0 px vindu, mot 63 px over et vanlig listepunkt øverst).
    // En LÅST liste har ingen +-knapper → kortets bunn.
    const hr = head ? head.getBoundingClientRect() : null;
    const top = hr ? hr.top + hr.height / 2 : r.top;
    const bottom = ar && ar.height ? ar.top + ar.height / 2 : r.bottom;
    // Er sonen for liten til å sikte på — en TOM (eller nesten tom) liste har bare
    // noen få piksler mellom tittelen og +-knappene — gjelder hele kortet i stedet,
    // som for en kollapset liste. Størrelsen måles som om reorder-placeholderen
    // IKKE lå der: den ligger inne i lista man ER i, og uten korreksjonen ville
    // samme liste hatt en romsligere sone ute enn inne — objektet ville da gått inn,
    // falt ut igjen og flimret.
    const ph = drag.ph;
    const phH = ph && ph.parentNode && cardEl.contains(ph) ? ph.getBoundingClientRect().height + 8 : 0;
    if (bottom - top - phH < third + MIN_BAND_SLACK) return { top: r.top, bottom: r.bottom };
    return { top, bottom };
  }
  function dragOverCard() {
    const d = draggedRect(); // UKLEMT: pekerens intensjon (som treffdeteksjonen ellers)
    const third = d.height / 3;
    const topThird = d.top + third;     // «øvre 1/3 har passert» = denne linja over linja
    const botThird = d.bottom - third;  // «nedre 1/3 har passert» = denne linja under linja
    const inCard = (el, grace) => {
      const r = el.getBoundingClientRect();
      if (drag.lastX < r.left || drag.lastX > r.right) return false; // kolonnen (flerkolonne)
      const b = cardBand(el, third);
      return topThird >= b.top - grace && botThird <= b.bottom + grace;
    };
    const cur = drag.overCard;
    if (cur && cur.isConnected) {
      // Slarken skal dekke ETT layout-hopp, ikke bli liggende: er objektet inne i
      // sonen på egen hånd, er hoppet passert og slarken forbrukt (se noteOverShift).
      if (inCard(cur, 0)) { drag.overGrace = 0; return cur; }
      if (inCard(cur, drag.overGrace || 0)) return cur;
    }
    for (const c of dragScope().root.querySelectorAll('.card')) {
      if (inCard(c, 0)) { drag.overCard = c; drag.overGrace = 0; return c; }
    }
    drag.overCard = null;
    drag.overGrace = 0;
    return null;
  }
  /* Selve modusbyttet flytter kortet man nettopp gikk INN i (`drag.overGrace`).
     Går man fra board-luft inn i en liste, forsvinner ny-liste-placeholderen fra
     kolonnen og reorder-placeholderen legges inn i lista: alt under den gamle
     plassen rykker OPP. Har lista en høy sone (en vanlig, fylt liste), betyr det
     bare at sonen kommer objektet i møte. Har den en KORT sone — en kollapset
     liste, eller en tom der `MIN_BAND_SLACK` gjør hele kortet til sone — rekker
     hoppet å legge sonen forbi objektet, som dermed faller ut igjen, som legger
     placeholderen tilbake, som dytter lista ned igjen: én runde per piksel.

     Vi måler derfor hvor langt lista faktisk flyttet seg av byttet og lar
     stickiness-en i `dragOverCard` beholde den gjennom akkurat det hoppet. Å
     forlate lista krever da en tydelig bevegelse ut — ikke bare at gulvet flyttet
     seg under objektet. Grensen for å gå INN er uendret (`grace` er 0 til man er
     inne), så 1/3-tersklene måles som før.

     Slarken FORBRUKES så snart objektet ligger inne i sonen på egen hånd
     (`dragOverCard`): den er kompensasjon for ett hopp, ikke en varig utvidelse av
     lista. I det vanlige tilfellet (en fylt liste, høy sone) er den derfor borte
     allerede ved neste bevegelse, og ut-tersklene er nøyaktig de dokumenterte. */
  function noteOverShift(cardEl, beforeTop) {
    if (!cardEl || drag.overCard !== cardEl) return;
    drag.overGrace = Math.max(drag.overGrace || 0,
      Math.abs(cardEl.getBoundingClientRect().top - beforeTop));
  }
  /* ---------------- Peek-åpning av kollapsede mål under draging ----------------
     Drar man et listepunkt over en KOLLAPSET liste eller kategori (eller en hel
     kategori over en kollapset liste) og BLIR VÆRENDE der i PEEK_MS, åpnes målet
     MIDLERTIDIG så man ser hvor objektet vil lande. Flytter man videre uten å
     slippe, kollapses målet tilbake til sin opprinnelige lille tilstand — peek er
     ren forhåndsvisning og rører IKKE `card.collapsed`/`item.collapsed`. Lander
     slippet i et peek-åpnet mål, forblir det åpent (persisteres collapsed=false).

     To lag samtidig: `drag.peekCard` (en liste) + `drag.peekCat` (en kategori i den),
     så «listen OG/ELLER kategorien» kan åpnes progressivt. Kategori-laget gjelder
     bare listepunkt-drag (en kategori kan ikke slippes inne i en annen kategori). */
  function peekChip(el, kind, collapsed) {
    const head = el.querySelector(kind === 'category' ? '.cat-head' : '.card-head');
    const chip = head && head.querySelector('.collapse-count');
    if (chip) chip.hidden = !collapsed; // «(N)» skjules mens midlertidig åpen, vises igjen ved re-kollaps
  }
  function peekExpand(el, kind) {
    if (kind === 'category') expandCatBody(el); else expandCardBody(el);
    peekChip(el, kind, false);
  }
  function peekCollapse(el, kind) {
    if (kind === 'category') collapseCatBody(el); else collapseCardBody(el);
    peekChip(el, kind, true);
  }
  // Re-kjør plasseringen etter en peek-utvidelse (mål-containeren har fått høyde).
  function reapplyPeekPlacement() {
    if (drag.kind === 'item') updateItemPlacement(drag.lastX, drag.lastY, 0);
    else if (drag.kind === 'category') updateCategoryPlacement();
  }
  // Sett/oppdater ett peek-lag: start 200 ms-timer på nytt mål, riv ned forrige.
  function setPeekLayer(slot, kind, target) {
    const cur = drag[slot];
    if (cur && cur.el === target) return; // uendret — timer/utvidelse består
    if (cur) {
      if (cur.timer) clearTimeout(cur.timer);
      if (cur.expanded && cur.el.isConnected) peekCollapse(cur.el, kind);
      drag[slot] = null;
    }
    if (!target) return;
    const entry = { el: target, expanded: false, timer: null };
    drag[slot] = entry;
    entry.timer = setTimeout(() => {
      if (!drag.active || drag[slot] !== entry || !target.isConnected) return;
      entry.timer = null;
      peekExpand(target, kind);
      entry.expanded = true;
      reapplyPeekPlacement();
    }, PEEK_MS);
  }
  // Kalles hver pekerbevegelse: finn kollapset liste/kategori under pekeren og
  // styr peek-lagene. Et allerede peek-åpnet mål (ikke lenger `.collapsed`) beholdes
  // så lenge pekeren er innenfor det.
  // Er lista/kategorien LÅST for meg? (En kategori arver kortets låsestatus.) Låste
  // mål peek-åpnes ikke — et slipp der ville uansett blitt avvist av serveren.
  function cardElFrozen(cardEl) {
    const cd = cardEl && dragScope().findContainer(cardEl.dataset.id);
    return cd ? frozen(cd) : false;
  }
  function updatePeek(x, y) {
    if (drag.kind !== 'item' && drag.kind !== 'category') return;
    // Liste-laget (begge dra-typer): lista objektet er «i» (samme 1/3-vurdering som
    // plasseringen bruker — ellers kunne placeholderen stå og vente på en peek som
    // aldri startet fordi pekeren ennå ikke var inne i kortet). Et allerede peek-
    // åpnet mål er ikke lenger `.collapsed`, så det beholdes eksplisitt.
    const over = dragOverCard();
    let cardTarget = null;
    if (drag.peekCard && drag.peekCard.el.isConnected && over === drag.peekCard.el) {
      cardTarget = drag.peekCard.el;
    } else if (over && over !== drag.card && over.classList.contains('collapsed') && !cardElFrozen(over)) {
      cardTarget = over;
    }
    setPeekLayer('peekCard', 'card', cardTarget);
    // Kategori-laget (kun listepunkt-drag): tilsvarende for en kollapset kategori i
    // lista — der velger pekeren som ellers innenfor en liste.
    let catTarget = null;
    if (drag.kind === 'item' && over && !cardElFrozen(over)) {
      if (drag.peekCat && drag.peekCat.el.isConnected &&
          pointerInRect(drag.peekCat.el.getBoundingClientRect(), x, y)) {
        catTarget = drag.peekCat.el;
      } else {
        for (const cat of over.querySelectorAll('.category.collapsed')) {
          if (pointerInRect(cat.getBoundingClientRect(), x, y)) { catTarget = cat; break; }
        }
      }
    }
    setPeekLayer('peekCat', 'category', catTarget);
  }
  // Riv ned alle peek-lag. recollapse=true kollapser åpnede mål tilbake (avbrudd/
  // slipp utenfor); false kun rydder timere (før en render som uansett bygger på nytt).
  function clearAllPeeks(recollapse) {
    for (const [slot, kind] of [['peekCat', 'category'], ['peekCard', 'card']]) {
      const cur = drag[slot];
      if (!cur) continue;
      if (cur.timer) clearTimeout(cur.timer);
      if (recollapse && cur.expanded && cur.el && cur.el.isConnected) peekCollapse(cur.el, kind);
      drag[slot] = null;
    }
  }
  // Ved slipp: et peek-åpnet mål slippet LANDET i forblir åpent (persisteres
  // collapsed=false så det overlever synk/rebuild); et peek-åpnet mål man IKKE
  // landet i kollapses tilbake (ren midlertidig forhåndsvisning).
  function resolvePeekOnDrop(landedCardEl, landedCatEl) {
    const finalize = (slot, kind, landedEl) => {
      const cur = drag[slot];
      if (!cur) return;
      if (cur.timer) clearTimeout(cur.timer);
      if (cur.expanded && cur.el === landedEl && cur.el.isConnected) {
        const S = dragScope();
        const cardEl = kind === 'category' ? cur.el.closest('.card') : cur.el;
        const cardData = cardEl && S.findContainer(cardEl.dataset.id);
        const obj = kind === 'category' ? S.findRow(cur.el.dataset.id) : cardData;
        if (obj) { obj.collapsed = false; if (cardData && !frozen(cardData)) stampContent(obj); }
      } else if (cur.expanded && cur.el && cur.el.isConnected) {
        peekCollapse(cur.el, kind);
      }
      drag[slot] = null;
    };
    finalize('peekCat', 'category', landedCatEl);
    finalize('peekCard', 'card', landedCardEl);
  }
  // Oppdater «(N)»-tellerne på alle kollapsede lister/kategorier (leaf-antallet kan
  // ha endret seg av et slipp inn i en kollapset liste man ikke peek-åpnet).
  function refreshAllCollapseCounts() {
    const S = dragScope();
    S.root.querySelectorAll('.card.collapsed').forEach((cardEl) => {
      const cd = S.findContainer(cardEl.dataset.id);
      if (cd) setCollapseCount(cardEl.querySelector('.card-head'), leafCount(S.rowsOf(cd)), true, S.countIcon);
    });
    S.root.querySelectorAll('.category.collapsed').forEach((catEl) => {
      const cardEl = catEl.closest('.card');
      const cd = cardEl && S.findContainer(cardEl.dataset.id);
      if (cd) setCollapseCount(catEl.querySelector('.cat-head'), catMemberCount(S.rowsOf(cd), catEl.dataset.id), true);
    });
  }
  function makeNewListPlaceholder(height) {
    const ph = document.createElement('div');
    ph.className = 'card-placeholder new-list-placeholder';
    ph.style.height = height + 'px';
    ph.innerHTML = '<span class="new-list-plus" aria-hidden="true">' + ICONS.plus + '</span>';
    return ph;
  }
  // Bytt til ekstraherings-placeholderen (kort-formet, ＋, på board-et).
  function setExtractMode() {
    if (drag.phMode === 'extract') return;
    drag.phMode = 'extract';
    if (drag.ph && drag.ph.parentNode) drag.ph.remove();
    drag.ph = makeNewListPlaceholder(Math.max(72, drag.height));
    // Midlertidig sist i siste kolonne; `placeNewListPlaceholder` flytter den
    // straks til kolonnen/plassen man faktisk sikter på.
    const root = dragScope().root;
    const cols = boardColumns(root);
    (cols[cols.length - 1] || root).appendChild(drag.ph);
    applyDragSeparators(); // placeholderen forlot lista → linjene der uten den
  }
  // Bytt tilbake til reorder-placeholderen (element-/kategori-placeholder i lista).
  function setReorderMode() {
    if (drag.phMode === 'reorder') return;
    drag.phMode = 'reorder';
    if (drag.ph && drag.ph.parentNode) drag.ph.remove();
    const ph = document.createElement('li');
    ph.className = drag.kind === 'category' ? 'item-placeholder cat-placeholder' : 'item-placeholder';
    ph.style.height = drag.height + 'px';
    drag.ph = ph;
    // Legg den midlertidig i utgangs-containeren; plasseringslogikken flytter den
    // straks til rett container/plass (updateItemPlacement / placeRowPlaceholder).
    const home = drag.origParent || (drag.card && drag.card.querySelector('.items-container')) || dragScope().root;
    home.appendChild(ph);
    applyDragSeparators();
  }
  /* Plassér ny-liste-placeholderen blant board-ets kort.

     KOLONNEN velges av pekeren (som ellers vannrett), PLASSEN i kolonnen av
     objektets eget senter: ut-tersklene (1/3, se dragOverCard) slår inn mens
     pekeren fortsatt kan være godt inne i lista man forlot — da ville et
     pekerbasert y-valg lagt placeholderen på feil side av den.

     Plassen leses av den layouten man SER (kortenes faktiske bokser). Den er
     selvstabiliserende: flytter placeholderen seg forbi et kort, glir kortet
     samtidig en placeholderhøyde bort i samme retning, så vilkåret som utløste
     flyttingen holder seg oppfylt. Hysteresen er altså gratis — og «gå tilbake»
     krever en tydelig bevegelse den andre veien.

     Siden kolonnene er egne containere, kan en placeholder lagt i én kolonne
     ikke lenger dytte kort over i en annen. Det var nettopp DET som flimret før:
     et kort som skiftet kolonne endret svaret på «hvilken liste er objektet i?»,
     som flyttet placeholderen tilbake, som flyttet kortet tilbake … én runde per
     piksel. */
  function placeNewListPlaceholder() {
    const ph = drag.ph;
    const root = dragScope().root;
    const cols = boardColumns(root);
    if (!cols.length) return;
    const px = drag.lastX, py = draggedRect().top + drag.height / 2;
    // Kolonnen pekeren er i (±8 px slingring). Ingen treff (pekeren i et
    // kolonnegap) → behold den kolonnen placeholderen alt står i, ellers den
    // første. Klemmes til siste kolonne som har kort: en tom kolonne lenger til
    // høyre finnes bare fordi vinduet er bredt, og en ny liste havner aldri der
    // før kolonnene til venstre er fulle (`relayoutBoard` fyller fra venstre).
    let last = 0;
    cols.forEach((c, i) => { if (c.querySelector('.card')) last = i; });
    let ci = cols.findIndex((c) => {
      const r = c.getBoundingClientRect();
      return px >= r.left - 8 && px <= r.right + 8;
    });
    if (ci < 0) ci = ph.parentNode ? cols.indexOf(ph.parentNode) : 0;
    ci = Math.min(Math.max(ci, 0), last);
    const col = cols[ci];
    let ref = null;
    for (const row of col.children) {
      if (row === ph) continue;
      const r = layoutRect(row);
      if (py < r.top + r.height / 2) { ref = row; break; }
    }
    if (ref ? ref.previousElementSibling === ph : col.lastElementChild === ph) return;
    const snap = snapshotRects([...root.querySelectorAll('.card')]);
    if (ref) col.insertBefore(ph, ref); else col.appendChild(ph);
    flipFrom(snap, FLIP_MS);
  }
  // Ny pos for den ekstraherte lista, mellom placeholderens naboer i
  // LESEREKKEFØLGE (naboen over en placeholder øverst i en kolonne ligger
  // nederst i kolonnen før).
  function extractionPos() {
    const S = dragScope();
    const ph = drag.ph;
    const prev = ph && boardRowSibling(ph, -1);
    const next = ph && boardRowSibling(ph, 1);
    const pPrev = prev && prev.classList.contains('card') ? (S.findContainer(prev.dataset.id) || {}).pos : null;
    const pNext = next && next.classList.contains('card') ? (S.findContainer(next.dataset.id) || {}).pos : null;
    return between(pPrev == null ? null : pPrev, pNext == null ? null : pNext);
  }

  function startCategoryDrag(ev, catEl) {
    if (ev.button != null && ev.button !== 0) return;
    if (drag.active) return; // ignorer ny drag mens en pågår
    beginDragCommon(ev, catEl);
    drag.kind = 'category';
    drag.phMode = 'reorder';
    drag.card = catEl.closest('.card'); // kategorier flyttes kun innen egen liste
    // Grep-punktet måles relativt til OVERSKRIFTEN, ikke hele (u-kollapsede)
    // kategori-boksen: kategorien kollapser til bare overskriften under draging,
    // og en evt. ::before-skillelinje over headeren gjorde ellers grabY større
    // enn den kollapsede høyden → fingeren havnet utenfor boksen (skjev
    // plassering + auto-scroll ved kanten slo ikke inn).
    drag.grabY = ev.clientY - catEl.querySelector('.cat-head').getBoundingClientRect().top;

    const ph = document.createElement('li');
    ph.className = 'item-placeholder cat-placeholder';
    ph.style.height = drag.height + 'px';
    catEl.parentNode.insertBefore(ph, catEl);
    drag.ph = ph;

    liftCategory();
    applyDragSeparators(); // etter løftet: det dratte er da ute av flyten (ingen nabo)
    drag.el.style.transform = `rotate(${cardRotation()}deg) scale(1.03)`; // dynamisk rotasjon (globalt)
    collapseCategory(catEl, ph);
    window.addEventListener('pointermove', onCategoryMove);
    window.addEventListener('pointerup', onCategoryUp);
    window.addEventListener('pointercancel', onCategoryCancel);
  }
  function onCategoryMove(ev) {
    if (!drag.active) return;
    if (dragElDetached()) { cancelActiveDrag(); return; }
    drag.lastX = ev.clientX;
    drag.lastY = ev.clientY;
    moveElement();
    drag.el.style.transform = `rotate(${cardRotation()}deg) scale(1.03)`;
    updateAutoScroll();
    updatePeek(drag.lastX, drag.lastY);
    updateCategoryPlacement();
  }
  // Innenfor kildelisten → reorder på nivå 1; over en ANNEN liste → flytt kategorien
  // INN i den (nivå 1 — kategorier nøstes aldri); ellers (board-luft mellom/utenfor
  // listene) → ny-liste-placeholder (ekstrahering).
  function updateCategoryPlacement(commit) {
    if (!drag.active || drag.kind !== 'category') return;
    const overCard = dragOverCard();
    if (!overCard) {
      if (!canExtractDragged()) { setReorderMode(); return; } // se updateItemPlacement
      setExtractMode();
      placeNewListPlaceholder();
      return;
    }
    const beforeTop = overCard.getBoundingClientRect().top;
    setReorderMode();
    noteOverShift(overCard, beforeTop); // modusbyttet rykker lista — se noteOverShift
    // Kollapset (ennå ikke peek-åpnet) mål-liste: la placeholderen bli der den er
    // mens peek-timeren løper (se updateItemPlacement). `commit` (fra onCategoryUp)
    // overstyrer så kategorien lander i den kollapsede lista ved selve slippet.
    if (overCard !== drag.card && !commit && overCard.classList.contains('collapsed')) return;
    const cont = overCard.querySelector('.items-container');
    if (cont) placeRowPlaceholder(cont);
  }
  // Flytt en kategori (med alle medlemmene) fra kilde-lista til en annen liste på
  // nivå 1. Medlemmene beholder sin `cat`-peker; både kategori og medlemmer får ny
  // `home` (= mål-kortet) og stemples (home rir på posisjonsregisteret). Kategoriens
  // pos settes mellom slipp-naboene. Rebygges rent med render() etterpå.
  function moveCategoryToCard(S, catId, sourceCardId, targetCardId, prevPos, nextPos) {
    const srcCard = S.findContainer(sourceCardId);
    const tCard = S.findContainer(targetCardId);
    const srcRows = srcCard ? S.rowsOf(srcCard) : null;
    const cat = srcRows && srcRows.find((x) => x.id === catId && x.isCat);
    if (!srcCard || !tCard || !cat) return false;
    const members = srcRows.filter((r) => r.cat === catId && !r.isCat); // aktive + done + trashed
    const memberIds = new Set(members.map((r) => r.id));
    S.setRowParent(cat, targetCardId); cat.pos = between(prevPos, nextPos); stampPos(cat);
    members.forEach((r) => { S.setRowParent(r, targetCardId); stampPos(r); });
    S.setRows(srcCard, srcRows.filter((r) => r.id !== catId && !memberIds.has(r.id)));
    S.rowsOf(tCard).push(cat, ...members);
    return true;
  }
  function onCategoryUp(ev) {
    if (!drag.active) return;
    if (dragElDetached()) { cancelActiveDrag(); return; }
    window.removeEventListener('pointermove', onCategoryMove);
    window.removeEventListener('pointerup', onCategoryUp);
    window.removeEventListener('pointercancel', onCategoryCancel);

    // Re-evaluer modus/plassering fra de FAKTISKE slipp-koordinatene før vi
    // avgjør extract vs. reorder: siste pointermove kan være koalescert eller
    // utelatt, så `drag.phMode`/placeholderen kan være foreldet (samme
    // fort/koalescert-peker-tilfelle som onCardUp håndterer for breadcrumben).
    if (ev && typeof ev.clientX === 'number') {
      drag.lastX = ev.clientX; drag.lastY = ev.clientY;
      updateCategoryPlacement(true); // commit: lande i kollapset mål-liste om peek ikke rakk
    }

    if (drag.phMode === 'extract') { extractCategoryToNewContainer(); return; }

    const S = dragScope();
    const el = drag.el;
    const cont = drag.ph.parentNode;
    const targetCardEl = cont.closest('.card');
    const sourceCardId = drag.card ? drag.card.dataset.id
      : (el.closest('.card') ? el.closest('.card').dataset.id : null);
    const targetCardId = targetCardEl ? targetCardEl.dataset.id : sourceCardId;

    // Kryss-liste-flytting: kategorien (+ medlemmene) inn i en ANNEN liste. Mål-lista
    // rebygges med render(), så peek-DOM-en forkastes — rydd peek-slotene uten
    // re-kollaps. Et peek-åpnet mål slippet landet i forblir åpent (collapsed=false).
    if (targetCardId && targetCardId !== sourceCardId) {
      // Mål-lista LÅST for meg? DB-guarden krever redigering på BÅDE gammelt og nytt
      // card_id, så en flytting ville blitt avvist og snappet tilbake ved neste synk.
      // Rull tilbake som et avbrutt drag i stedet (og si fra).
      const tcCheck = S.findContainer(targetCardId);
      if (tcCheck && frozen(tcCheck)) {
        restoreDraggedToOrigin();
        settleCategoryAfterDrag(el);
        finishDrag(); // rydder + clearAllPeeks(true) kollapser evt. peek-åpnet mål tilbake
        showToast(S.lockedTargetMsg);
        return;
      }
      const keepOpen = !!(drag.peekCard && drag.peekCard.expanded && drag.peekCard.el === targetCardEl);
      const prevPos = rowPos(drag.ph.previousElementSibling);
      const nextPos = rowPos(drag.ph.nextElementSibling);
      clearAllPeeks(false);
      finishDrag();
      if (keepOpen) {
        const tc = S.findContainer(targetCardId);
        if (tc) { tc.collapsed = false; if (!frozen(tc)) stampContent(tc); }
      }
      moveCategoryToCard(S, el.dataset.id, sourceCardId, targetCardId, prevPos, nextPos);
      S.render();
      save();
      return;
    }

    // Samme liste: reorder på nivå 1.
    cont.insertBefore(el, drag.ph);
    drag.ph.remove();
    clearAllDragSeparators(); // hvile-linjene tilbake før hvileposisjonen måles
    dropIntoPlaceholder(el, false); // fly inn i sloten (kollapset) …
    settleCategoryAfterDrag(el);    // … og fold ut igjen (med mindre klikk-kollapset)
    finishDrag();

    const prev = el.previousElementSibling;
    const next = el.nextElementSibling;
    const cat = S.findRow(el.dataset.id);
    if (cat) { cat.pos = between(rowPos(prev), rowPos(next)); stampPos(cat); }
    save();
    S.afterDrop();
  }
  // Slipp i ny-liste-placeholderen: gjør kategorien til en ny liste (samme tittel),
  // medlemmene blir ukategoriserte listepunkter i den. Selve kategori-raden slettes.
  function extractCategoryToNewContainer() {
    const S = dragScope();
    const el = drag.el;
    const catId = el.dataset.id;
    const srcCard = drag.card && S.findContainer(drag.card.dataset.id);
    const srcRows = srcCard ? S.rowsOf(srcCard) : null;
    const cat = srcRows && srcRows.find((x) => x.id === catId && x.isCat);
    const np = extractionPos();
    const nc = cat ? S.createContainer(S.rowName(cat) || tr('common.noName')) : null;
    if (!nc) { // uventet → rull tilbake
      restoreDraggedToOrigin();
      if (el) expandCategory(el);
      finishDrag();
      return;
    }
    nc.pos = np; stampContent(nc); stampPos(nc);

    // Flytt medlemmene inn i den nye containeren (ukategorisert). Aktive medlemmer
    // får pos 0..n i bevart rekkefølge; avkryssede/slettede løsnes bare fra kategorien.
    const memberObjs = srcRows.filter((r) => r.cat === catId && !r.isCat);
    const memberIds = new Set(memberObjs.map((r) => r.id));
    const active = memberObjs.filter((r) => live(r) && !r.done).sort(posCmp);
    active.forEach((r, i) => { r.pos = i; });
    memberObjs.forEach((r) => { S.setRowParent(r, nc.id); r.cat = null; stampPos(r); });
    S.rowsOf(nc).push(...memberObjs);

    // Fjern kategori-raden (gravstein hindrer gjenoppstand ved synk) + medlemmene
    // fra kilde-containeren.
    tombSubtree(cat, S.rowKind);
    S.setRows(srcCard, srcRows.filter((r) => r.id !== catId && !memberIds.has(r.id)));

    finishDrag();
    S.render(); // rebygg rent (ny container + oppdatert kilde)
    save();
  }
  // pointercancel under et kategori-drag: rull tilbake uten pos/lagre og fold
  // kategorien ut igjen (den kollapset ved dragstart).
  function onCategoryCancel() {
    if (!drag.active) return;
    window.removeEventListener('pointermove', onCategoryMove);
    window.removeEventListener('pointerup', onCategoryUp);
    window.removeEventListener('pointercancel', onCategoryCancel);
    const el = drag.el;
    restoreDraggedToOrigin();
    if (el) settleCategoryAfterDrag(el);
    finishDrag();
  }

  /* ------- Auto-scroll av nav-modalen under draging -------
     Områder/mapper dras i en modal der VINDUET aldri scroller; scroll-
     containeren er modalens `.menu-body`. Samme sonelogikk/fart som vindus-
     auto-scrollen, og etter hver frame re-evalueres plasseringen (radene har
     flyttet seg mens pekeren står stille) — nøyaktig som `reapplyPlacement`
     gjør for board-et. */
  let modalScrollRAF = null, modalScrollSpeed = 0;
  function modalScroller() {
    return navModal.querySelector('.menu-body');
  }
  function updateModalAutoScroll() {
    const scroller = modalScroller();
    if (!drag.active || !scroller) { stopModalAutoScroll(); return; }
    const r = scroller.getBoundingClientRect();
    const EDGE = 52;
    const y = drag.lastY;
    let speed = 0;
    if (y < r.top + EDGE) speed = -Math.ceil(((r.top + EDGE - y) / EDGE) * 16);
    else if (y > r.bottom - EDGE) speed = Math.ceil(((y - (r.bottom - EDGE)) / EDGE) * 16);
    modalScrollSpeed = speed;
    if (speed !== 0) startModalAutoScroll(scroller); else stopModalAutoScroll();
  }
  function startModalAutoScroll(scroller) {
    if (modalScrollRAF != null) return;
    let prevTs = null, rest = 0;
    const step = (ts) => {
      if (!drag.active || modalScrollSpeed === 0) { modalScrollRAF = null; return; }
      const delta = modalScrollSpeed * frameSteps(prevTs, ts) + rest; // px per 60 Hz-frame
      prevTs = frameNow(ts);
      const before = scroller.scrollTop;
      scroller.scrollTop += delta;
      rest = Math.max(-1, Math.min(1, delta - (scroller.scrollTop - before)));
      if (scroller.scrollTop !== before) reapplyPlacement(modalScrollSpeed > 0 ? 1 : -1);
      modalScrollRAF = requestAnimationFrame(step);
    };
    modalScrollRAF = requestAnimationFrame(step);
  }
  function stopModalAutoScroll() {
    if (modalScrollRAF != null) { cancelAnimationFrame(modalScrollRAF); modalScrollRAF = null; }
    modalScrollSpeed = 0;
  }

  /* DEN SIKRE SONEN, for de lagene som plasseres i JS.
     De faste elementene får den fra CSS (`--safe-*`, se styles.css og
     docs/design-system.md), men to lag regnes ut i viewport-koordinater og må
     lese tallene: demonstrasjonens kort og popover-skallet. De klemmes mot
     rektangelet denne gir, ikke mot skjermkanten — ellers ville de kunnet
     havne under statusfeltet eller gestelinjen.
     `env()` erstattes når custom-propertyen regnes ut, så de fire løser seg
     til vanlige px-verdier her (i motsetning til --board-gap, som er en
     clamp() og derfor må leses fra en oppløst egenskap — se
     docs/board-layout.md). En runtime som ikke løser dem gir NaN, og
     fallbacken er 0: nøyaktig det en skjerm uten systemflater skal ha. */
  function safeInsets() {
    const cs = getComputedStyle(document.documentElement);
    const tall = (n) => parseFloat(cs.getPropertyValue('--safe-' + n)) || 0;
    return { top: tall('top'), right: tall('right'), bottom: tall('bottom'), left: tall('left') };
  }

  // Den faste (position: fixed) toppmenyen er ute av flyten, så board-et må få
  // nøyaktig klaring: målt toppmeny-høyde + --board-gap. Padding-top regnes ut
  // HER (ikke i en CSS calc()) slik at avstanden ned til første kort blir
  // PIKSELNØYAKTIG lik gapet ellers (venstre/høyre/bunn-padding, kolonne-gap,
  // kort-til-kort). --board-gap er en clamp()/vw-verdi — å lese den direkte fra
  // :root ville gitt oss selve uttrykket (som streng), ikke tallet den løses til;
  // vi leser den derfor fra board sin FAKTISK OPPLØSTE column-gap i stedet.
  function syncHeaderHeight() {
    const root = document.documentElement.style;
    const topH = topbarEl.getBoundingClientRect().height;
    const gap = parseFloat(getComputedStyle(board).columnGap) || 0;
    root.setProperty('--board-pad-top', (topH + gap) + 'px');
  }
  if (typeof ResizeObserver === 'function') {
    const ro = new ResizeObserver(syncHeaderHeight);
    ro.observe(topbarEl);
  }
  // Kolonneantallet følger vindusbredden og budsjettet skjermhøyden — begge deler
  // endres her. (ResizeObserver-en på board-et fanger bredde-endringer, men ikke
  // en ren HØYDE-endring der board-innholdet blir stående like stort.)
  window.addEventListener('resize', () => {
    syncHeaderHeight(); relayoutBoard(); fixBoardBottomGap();
    /* Skjermtastaturet KRYMPER viewportet (i det native skallet får WebView-en
       en bunn-inset like høy som tastaturet; i en mobilnettleser er det den
       samme resize-en). Da kan feltet som redigeres bli liggende under
       tastaturet, uten at noe annet flytter det tilbake. `nearest` ruller
       akkurat nok, og sidens `scroll-padding-top` (styles.css) holder det
       samtidig unna den faste toppmenyen. Etter syncHeaderHeight(), som er
       kilden til den paddingen. */
    const a = document.activeElement;
    if (a && a.classList && a.classList.contains('edit-input')) {
      try { a.scrollIntoView({ block: 'nearest' }); } catch (e) { /* ignore */ }
    }
    // En popover som står åpen er forankret i koordinater fra viewportet den
    // ble åpnet i — den må regnes ut på nytt her, ikke først ved neste åpning.
    repositionOpenPopovers();
  });

  // Bunn-luft etter siste kort — uansett hvilken kolonne som ender opp høyest.
  // Med flex-kolonner ER siste korts EGEN margin-bottom (--board-gap) bunn-luften
  // (marginer kollapser ikke ut av en flex-container), så dette er i praksis en
  // no-op. Vi måler likevel det FAKTISKE utfallet (nullstill → tving reflow →
  // les av) og legger PÅ akkurat nok padding til at totalen alltid blir nøyaktig
  // --board-gap: målingen er billig, og den fanger opp avrunding. Den ble skrevet
  // mot en multi-column-kvirk (`column-fill: balance` kunne se helt bort fra siste
  // korts margin ved ujevnt balanserte kolonner) — den layouten er borte, men
  // sikkerhetsnettet er beholdt.
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
  addCardBtn.addEventListener('click', () => {
    const g = activeGroupObj();
    if (!canAddList(g)) return;
    const c = card(tr('board.newList'), [], g.id);
    c.pos = maxPos(g.cards) + 1;
    stampContent(c);
    stampPos(c);
    g.cards.push(c);
    render();
    // Fokuser den nye tittelen for redigering
    startRename(board.querySelector('.card[data-id="' + c.id + '"] .card-title'));
  });

  /* ============================================================
     SØPPELKASSER (områder / mapper / lister / elementer)
     ------------------------------------------------------------
     Fire nivåer, samme knapp (hvit beholder, emoji + antall i grå
     sirkel) og samme oppførsel; alle vises KUN når de har innhold:
       • områder → i meny-modalen (☰), ved siden av «＋ Område».
       • mapper   → i mappemenyens knapperad, ved siden av «＋ Mappe».
       • lister    → i listemenyens knapperad, ved siden av «＋ Liste».
       • elementer → midtstilt nederst i hvert listekort.
     Interaksjon (attachTrashHold): kort trykk åpner modalen (gjenopprett/tøm
     derfra); klikk-og-hold utvider knappen til et sveipefelt («Sveip for å tømme
     →») der man sveiper mot høyre for å tømme (se attachTrashHold). */

  /* ---------- Felles modal (deles av alle fire nivåer) ---------- */
  let modalCfg = null;
  let modalOpenedAt = 0; // tid modalen ble åpnet — ignorér overlay-klikk rett etter

  // To modaler kan være åpne samtidig (søppelkassen over område-/mappe-
  // modalen); body låses så lenge minst én er åpen.
  function updateModalOpenClass() {
    const share = document.getElementById('share-modal');
    const place = document.getElementById('place-modal');
    const confirmEl = document.getElementById('confirm-modal');
    const objMenu = document.getElementById('obj-menu');
    const timeSw = document.getElementById('time-switcher');
    const avatarEd = document.getElementById('avatar-modal');
    const delAcc = document.getElementById('delete-account-modal');
    document.body.classList.toggle('modal-open',
      !trashModal.hidden || !navModal.hidden ||
      !accountModal.hidden ||
      (share && !share.hidden) || (place && !place.hidden) ||
      (confirmEl && !confirmEl.hidden) || (objMenu && !objMenu.hidden) ||
      (timeSw && !timeSw.hidden) || (avatarEd && !avatarEd.hidden) ||
      (delAcc && !delAcc.hidden) || respOpen);
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
    confirmOkBtn.className = 'btn btn-solid ' + (opts.danger === false ? 'btn-accent' : 'btn-red');
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
    /* Søppelkasse-knappen gjør TO ting — kort trykk åpner modalen, hold og
       sveip tømmer. Demoen viser dem i hvert sitt steg, og et bomtrykk på
       tømme-steget ville ellers lagt modalen oppå kontrollen brukeren skal
       holde inne. Gjelder kun mens demoen står på. */
    if (demoActive && !demoAllowsTrashModal()) return;
    modalCfg = cfg;
    trashTitle.textContent = cfg.title;
    modalNote.textContent = cfg.note;
    // Knappen navngir det den faktisk sletter — «Tøm» sa ingenting om hva som
    // forsvant, og de fire kassene deler samme knapp.
    trashEmptyBtn.textContent = cfg.emptyLabel || tr('trash.purge');
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
    // «Tøm» sletter permanent — like destruktivt som å slette. Er alt i kassen
    // låst for meg, kan ingenting tømmes, og knappen skal ikke se ut som den
    // virker (serveren ville avvist skrivingen, mens den lokale kopien forsvant).
    // `purge` skiller seg fra `manage` kun for områder/mapper, der «Tøm» også
    // kan bety å FORLATE; ellers er det samme svar.
    trashEmptyBtn.disabled = !rows.some((r) => (r.purge !== undefined ? r.purge : r.manage) !== false);
    rows.forEach((r) => {
      const row = document.createElement('div');
      row.className = 'trash-row';
      if (r.color) {
        const dot = document.createElement('span');
        dot.className = 'trash-dot';
        dot.style.background = r.color;
        row.appendChild(dot);
      }
      // Navn + metadata i én blokk: sammen får de en flex-basis å bryte på, så
      // navnet ikke kan presses ned til en bokstavsøyle av knappen ved siden av
      // (se .trash-main i styles.css). Blokka er ren layout — ingen rolle,
      // ingen tekst, ingenting en skjermleser skal lese.
      const main = document.createElement('div');
      main.className = 'trash-main';
      const name = document.createElement('span');
      name.className = 'trash-name';
      name.textContent = r.name;
      main.appendChild(name);
      if (r.meta != null) {
        const meta = document.createElement('span');
        meta.className = 'trash-meta';
        meta.textContent = r.meta;
        main.appendChild(meta);
      }
      row.appendChild(main);
      const restore = document.createElement('button');
      restore.className = 'btn btn-solid btn-accent btn-small';
      restore.type = 'button';
      restore.textContent = 'Gjenopprett';
      // Å gjenopprette er å skrive `trashed = false`, og det krever samme
      // myndighet som å slette (`can_delete_object`). Er objektet låst for meg,
      // avviser serveren skrivingen — da skal knappen være tydelig avskrudd i
      // stedet for å legge igjen en lokal kopi som aldri kommer fram.
      // (En BUFFRET sletting angres alltid: den er ren lokal tilstand, og den
      // som buffret den hadde myndigheten da knappen ble trykket.)
      if (r.manage === false && !r.pending) {
        restore.disabled = true;
        restore.title = tr('trash.lockedRestore');
        // Grunnen må ligge i NAVNET, ikke bare i title: en skjermleser leser
        // ikke title, og «Gjenopprett» alene forklarer ikke hvorfor den er av.
        restore.setAttribute('aria-label', tr('trash.restoreLockedAria', { name: quoted(r.name) }));
      } else {
        restore.setAttribute('aria-label', tr('trash.restoreAria', { name: quoted(r.name) }));
      }
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

  const TRASH_NOTE = tr('trash.note');
  // Sveipefeltet på søppelkasse-knappen går utenom modalen, så tømmingen må si
  // fra selv når den lot noe bli liggende.
  const LOCKED_PURGE_MSG = tr('trash.lockedRemains');
  // «3 mapper» / «3 folders» — entall og flertall er egne nøkler fordi
  // formen ikke lar seg regne ut på tvers av språk.
  const countWord = (kind, n) => tr('count.' + kind + (n === 1 ? '.one' : '.other'), { n: n });
  const groupWord = (n) => countWord('group', n);
  const listWord = (n) => countWord('card', n);
  const itemWord = (n) => countWord('item', n);
  const uniWord = (n) => countWord('universe', n);

  /* ---------- De fire søppelkassene ----------
     Søpla er FELLES, så en kasse kan godt inneholde objekter jeg ikke rår over:
     en liste som ble slettet FØR mappen ble låst, eller et delt område eieren
     har slettet for alle. Hver rad sier derfor hva jeg får gjøre med den:

       manage — «Gjenopprett» (skriver `trashed = false`, og krever nøyaktig
                samme myndighet som å slette: `can_delete_object`)
       purge  — teller med når «Tøm» skal være aktiv: enten kan jeg slette
                permanent, eller så kan jeg FORLATE objektet (områder/mapper
                jeg bare er medlem av — se emptyUniversesTrash)

     Uten sjekkene ble skrivingen avvist av serveren mens den lokale kopien
     forsvant (tømming) eller ble stående som et spøkelse (gjenoppretting).
     Områder og mapper har serverens capabilities; lister og listepunkter har
     ingen egne caps, og der er låse-anslaget (`frozen`) nøyaktig samme regel. */
  function canDeleteUniverse(u) { return cap(u, 'delete', true); }
  function canDeleteGroup(g) { return cap(g, 'delete', !frozen(g)); }
  function canPurgeUniverse(u) { return canDeleteUniverse(u) || cap(u, 'leave', false); }
  function canPurgeGroup(g) { return canDeleteGroup(g) || cap(g, 'leave', false); }
  function openUniversesTrash() {
    showTrashModal({
      title: tr('trash.universes'),
      note: TRASH_NOTE,
      emptyLabel: tr('trash.purgeUniverses'),
      emptyMsg: tr('trash.noUniverses'),
      rows: () => trashedUniverses().sort(posCmp).map((u) => ({
        id: u.id,
        color: colorForId(u.id),
        name: u.name,
        meta: groupWord(u.groups.filter((g) => !g.trashed && !g.isCat).length),
        pending: !!u._pendingDelete,
        manage: canDeleteUniverse(u),
        purge: canPurgeUniverse(u),
        restore: () => restoreUniverse(u),
      })),
      empty: emptyUniversesTrash,
    });
  }

  // Mappe-søppelkassen ligger i hvert område-kort (som listepunkt-søppelkassen
  // i en liste) — området slås derfor opp ferskt på id ved hver rows()-kall, så
  // en synk-rebuild ikke etterlater en foreldreløs referanse.
  function openGroupsTrash(uniId) {
    const liveUni = () => findUniverse(uniId);
    const u0 = liveUni();
    showTrashModal({
      title: tr('trash.groupsIn', { name: u0 ? u0.name : '' }),
      note: TRASH_NOTE,
      emptyLabel: tr('trash.purgeGroups'),
      emptyMsg: tr('trash.noGroups'),
      rows: () => {
        const u = liveUni();
        return u ? trashedGroupsOf(u).sort(posCmp).map((g) => ({
          id: g.id,
          name: g.name,
          meta: g.isCat ? tr('kind.groupcat') : listWord(g.cards.filter((c) => !c.trashed).length),
          pending: !!g._pendingDelete,
          manage: canDeleteGroup(g),
          purge: canPurgeGroup(g),
          restore: () => restoreGroup(g),
        })) : [];
      },
      empty: () => emptyGroupsTrash(uniId),
    });
  }

  function openCardsTrash() {
    const g = activeGroupObj();
    if (!g) return; // lister-søppelkassen er per mappe
    showTrashModal({
      title: tr('trash.cardsIn', { name: g.name }),
      note: TRASH_NOTE,
      emptyLabel: tr('trash.purgeCards'),
      emptyMsg: tr('trash.noCards'),
      rows: () => trashedCards().map((c) => ({
        id: c.id,
        color: colorForId(c.id),
        name: c.title,
        meta: itemWord(c.items.filter((it) => !it.trashed).length),
        pending: !!c._pendingDelete,
        manage: !frozen(c),
        restore: () => restoreCard(c),
      })),
      empty: emptyCardsTrash,
    });
  }

  function openItemsTrash(cardData) {
    // De tre andre søppelkassene leser ferskt fra `state` i hver `rows()`-kall
    // (`trashedGroupsOf(u)`/…); elementmodalen må gjøre det samme via id-oppslag i
    // stedet for å fange `cardData` én gang — ellers peker den på et foreldreløst
    // kort etter at synken har bygget treet på nytt («Gjenopprett» som ikke
    // fester seg). Se restore-hjelperne over.
    const cardId = cardData.id;
    const liveCard = () => { const f = findAnyById(cardId); return f && f.kind === 'card' ? f.obj : null; };
    showTrashModal({
      title: tr('trash.itemsIn', { name: cardData.title }),
      note: TRASH_NOTE,
      emptyLabel: tr('trash.purgeItems'),
      emptyMsg: tr('trash.noItems'),
      rows: () => {
        const c = liveCard();
        return c ? trashedItemsOf(c).sort(posCmp).map((it) => ({
          id: it.id,
          name: it.text,
          pending: !!it._pendingDelete,
          manage: !frozen(c),   // listepunkter har ingen egen lås — listens gjelder
          restore: () => restoreItem(it),
        })) : [];
      },
      empty: () => { const c = liveCard(); if (c) emptyItemsTrash(c); },
    });
  }

  // Tøm lister-søppelkassen (aktiv mappe) permanent: gravstein per liste + element.
  // Buffrede slettinger committes først, så tømming aldri venter på angre-vinduet.
  function emptyCardsTrash() {
    // Låste lister hoppes over (samme grunn som i emptyItemsTrash). En liste kan
    // ha havnet i søpla FØR mappen ble låst, så kassen kan godt være blandet.
    const all = trashedCards();
    commitBufferedFor(all.filter((c) => !frozen(c)).map((c) => c.id));
    const trash = trashedCards().filter((c) => !frozen(c)); // commit kan ha endret lista
    if (trash.length < all.length) showToast(LOCKED_PURGE_MSG);
    if (!trash.length) return;
    const arr = allCards();
    trash.forEach((c) => {
      const i = arr.indexOf(c);
      tombSubtree(c, 'card'); // permanent gravstein hindrer gjenoppstandelse
      if (i > -1) arr.splice(i, 1);
    });
    render();
    save();
  }

  // Tøm område-søppelkassen permanent: gravsteiner for hvert slettet område +
  // alle dets mapper, lister og elementer (hindrer gjenoppstandelse).
  function emptyUniversesTrash() {
    // Som i emptyGroupsTrash: rader jeg ikke rår over holdes utenfor commit-en også.
    commitBufferedFor(trashedUniverses().filter(canPurgeUniverse).map((u) => u.id));
    const trash = trashedUniverses();
    if (!trash.length) return;
    let skipped = 0;
    trash.forEach((u) => {
      const i = state.universes.indexOf(u);
      if (u._virtual) return;
      // Et område man bare er MEDLEM av kan man forlate, ikke slette. Kan man
      // ingen av delene, blir området stående i kassen — bedre enn å forsvinne
      // lokalt mens serveren avviser både slettingen og forlatelsen.
      if (!canPurgeUniverse(u)) { skipped++; return; }
      if (!canDeleteUniverse(u)) {
        if (i > -1) state.universes.splice(i, 1);
        cloudLeave('universe', u.id);
        return;
      }
      tombSubtree(u, 'universe');
      if (i > -1) state.universes.splice(i, 1);
    });
    if (skipped) showToast(LOCKED_PURGE_MSG);
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
      '<span class="swipe-label">' + tr('trash.swipeDeleteAll') + '</span>' +
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
      /* Høyre grense er den BRUKBARE kanten, ikke viewportkanten: i landskap
         med et hakk i høyre side ville feltet (og dermed sveipe-strekket, som
         regnes ut fra bredden) endt under hakket — etiketten og pilen blir
         uleselige, og enden av sveipet ligger et sted fingeren ikke når. 0 i en
         nettleser, se docs/design-system.md («Den sikre sonen»). */
      const høyreKant = vw - safeInsets().right;

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
        Math.min(207, høyreKant - EDGE - Math.round(r.left)));
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

  /* ---------- Kobling: faste knapper (områder/mapper/lister) + modal-kontroller ---------- */
  attachTrashHold(trashBtn, {
    count: () => trashedCards().length,
    open: openCardsTrash,
    empty: emptyCardsTrash,
  });
  attachTrashHold(uniTrashBtn, {
    count: () => trashedUniverses().length,
    open: openUniversesTrash,
    empty: emptyUniversesTrash,
  });

  trashClose.addEventListener('click', closeTrash);
  // Klikk på selve overlay-en (utenfor modal-boksen) lukker — men ignorér det
  // (evt. forsinkede) klikket fra trykket som nettopp ÅPNET modalen. Uten dette
  // lukket åpnings-trykkets etter-klikk modalen igjen for mappe-/liste-kurven
  // (som ligger nær kanten, der etter-klikket treffer overlay-en, ikke modal-boksen).
  trashModal.addEventListener('click', (ev) => {
    if (ev.target === trashModal && Date.now() - modalOpenedAt > 450) closeTrash();
  });
  /* ---------- Ett lag tilbake (Escape og systemets tilbakeknapp) ----------
     Lagene lukkes ovenfra og ned, i den rekkefølgen brukeren ser dem
     (søppelkassen kan ligge over menyen). ÉN stige med to innganger, så
     tastaturet og Androids tilbakeknapp aldri kan komme i utakt — se
     `docs/menus.md`.

     `viaBack` er systemets tilbakeknapp. Den ene forskjellen ligger i
     del-modalen: den har en egen ← tilbake til modalen den ble åpnet fra, og
     DET er ett nivå tilbake. Escape lukker fortsatt helt («lukk = ferdig»).

     Returnerer true når et lag faktisk ble lukket. */
  function closeTopLayer(viaBack) {
    if (timeQuickOpen) { closeTimeQuick(); return true; } // tids-popoveren ligger øverst
    if (respOpen) { closeResponsible(); return true; } // ansvarlig-velgeren ligger øverst
    if (confirmModalEl && !confirmModalEl.hidden) { closeConfirm(false); return true; } // øverst
    const delAcc = document.getElementById('delete-account-modal');
    if (delAcc && !delAcc.hidden) { closeDeleteAccount(); return true; } // over konto-modalen
    if (avatarModal && !avatarModal.hidden) { closeAvatarEditor(); return true; } // over konto-modalen
    const share = document.getElementById('share-modal');
    const place = document.getElementById('place-modal');
    if (place && !place.hidden) { place.hidden = true; updateModalOpenClass(); return true; }
    if (share && !share.hidden) {
      const back = viaBack ? shareBackTo : null;
      closeShare(); // uten `backTo`: helt lukk — tilbake til hovedsiden
      if (back) back();
      return true;
    }
    if (objMenuCtx) { closeObjMenu(); return true; }
    if (!trashModal.hidden) { closeTrash(); return true; }
    if (!navModal.hidden) { closeNavModal(); return true; }
    if (!accountModal.hidden) { closeAccount(); return true; }
    return false;
  }
  // Escape lukker øverste lag — men ikke midt i en inline-redigering (der
  // avbryter Escape bare redigeringen).
  document.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Escape') return;
    if (ev.target && ev.target.classList && ev.target.classList.contains('edit-input')) return;
    closeTopLayer(false);
  });

  /* ---------- Systemets tilbakeknapp (Android) ----------
     Kalles av det native skallet (`MainActivity.java`), som spør web-laget
     først og lar OS ta trykket når svaret er false. Uten dette avslutter
     Android appen ved FØRSTE trykk, uansett hva som står åpent — Capacitor
     legger ingen egen håndtering inn (`@capacitor/android` 8.5.0 har ingen
     `onBackPressed`; `BridgeActivity` arver AppCompats standard).

     Rekkefølgen:
       1. en pågående inline-redigering avbrytes (samme vei som Escape);
       2. øverste popover/modal lukkes, ett lag per trykk (`closeTopLayer`);
       3. ellers: OS tar trykket.

     Hovedsiden ER bunnen. Å åpne nav-modalen på et tilbaketrykk ville vært et
     lag NED igjen: neste trykk lukket den, trykket etter åpnet den på nytt, og
     man kom aldri ut av appen. «Ett Huskis-nivå tilbake» er derfor stigen over
     — inkludert del-modalens ← tilbake til nav-modalen.

     Demonstrasjonen slår av det samme her som Escape (`demoGate`): den bytter
     ut hele state-treet mens den står på, og ✕ i kortet er den ene utgangen.
     Returnerer false, så trykket blir et vanlig «forlat appen». */
  function systemBack() {
    if (demoRunning) return false;
    const el = document.activeElement;
    if (el && el.classList && el.classList.contains('edit-input')) {
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      return true;
    }
    return closeTopLayer(true);
  }
  /* Eneste stedet webkoden kjenner til native-runtimen, og den er eksplisitt
     gated: i en nettleser finnes `window.Capacitor` ikke, broen settes aldri
     opp, og ingenting av dette kjører. Vakten i
     `tests/capacitor-android.test.js` holder unntaket avgrenset til denne ene
     linjen (`docs/mobilapp-plan.md`, arkitekturregel 2). */
  const nativeShell = !!(window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function' && window.Capacitor.isNativePlatform());
  if (nativeShell) window.__huskisSystemBack = systemBack;
  // Ingen ekstra bekreftelse: sveipe-tømming har heller ingen, og tømming er
  // et bevisst valg i en modal man allerede har åpnet.
  trashEmptyBtn.addEventListener('click', () => {
    if (!modalCfg || !modalCfg.rows().length) return;
    modalCfg.empty();
    renderTrashModalBody();
  });

  /* ============================================================
     NAV- OG KONTO-MODALEN
     ------------------------------------------------------------
     Nav-knappen i toppmenyen åpner ÉN felles modal for områder og mapper:
     der byttes, opprettes, omdøpes, slettes, omrokkeres og deles begge nivåer.
     Kontoknappen (øverst til høyre) åpner konto-modalen. */
  function openNavModal() {
    navModal.hidden = false;   // renderNav() bygger kun når modalen er åpen
    renderNav();
    updateModalOpenClass();
  }
  function closeNavModal() {
    navModal.hidden = true;
    updateModalOpenClass();
  }
  /* ---------- Trekkspill-skuffer (delt mekanikk) ----------
     Animert åpning/lukking: høyden måles, settes eksplisitt og ryddes bort
     igjen etterpå, så en skuff som vokser (tidsfeltene, en feilmelding) ikke
     blir stående klippet. Brukes både av objektmenyens skuffer og av
     konto-modalens tre — se docs/menus.md. */
  const SUB_MS = 180;
  function slideSub(sub, open) {
    const h = sub.scrollHeight;
    sub.style.transition = 'none';
    sub.style.height = (open ? 0 : h) + 'px';
    void sub.offsetHeight;
    sub.style.transition = '';
    sub.classList.toggle('is-closed', !open);
    sub.style.height = (open ? h : 0) + 'px';
    if (open) setTimeout(() => { if (!sub.classList.contains('is-closed')) sub.style.height = ''; }, SUB_MS);
  }

  /* ---------- Konto-modalens trekkspill ----------
     Modalen er delt i tre skuffer — kontoopplysninger, tips og logg ut/slett
     konto — med invitasjons-innboksen og språkraden utenfor. Kun ÉN skuff er
     åpen om gangen: å åpne en ny lukker den forrige.

     En LUKKET skuff får `inert`. Uten det ville Tab gått rett gjennom feltene i
     den: høyden er 0 og innholdet usynlig, men elementene er fortsatt
     fokuserbare (`focusablesIn`). `inert` tar dem ut av både tabbrekkefølgen og
     skjermleserens tre, uten å røre høyde-animasjonen. */
  const accHeads = [].slice.call(document.querySelectorAll('#account-acc .menu-acc-head'));
  function setAccordionOpen(key) {
    accHeads.forEach((head) => {
      const sub = document.getElementById(head.getAttribute('aria-controls'));
      if (!sub) return;
      const want = head.dataset.accHead === key;
      const isOpen = !sub.classList.contains('is-closed');
      if (want !== isOpen) slideSub(sub, want);
      head.setAttribute('aria-expanded', want ? 'true' : 'false');
      if (want) sub.removeAttribute('inert');
      else sub.setAttribute('inert', '');
    });
  }
  accHeads.forEach((head) => {
    head.addEventListener('click', () => {
      const open = head.getAttribute('aria-expanded') === 'true';
      setAccordionOpen(open ? null : head.dataset.accHead);
    });
  });

  function openAccount() {
    paintAccountForms(true);
    // Nullstill FØR modalen vises: en `display:none`-flate animerer ikke, så
    // skuffene er lukket allerede i det modalen kommer opp. Menyen skal starte
    // sammenslått hver gang — det er hele poenget med å dele den opp.
    setAccordionOpen(null);
    accountModal.hidden = false;
    updateModalOpenClass();
  }
  function closeAccount() {
    accountModal.hidden = true;
    updateModalOpenClass();
  }
  navCrumbBtn.addEventListener('click', openNavModal);
  accountBtn.addEventListener('click', openAccount);
  navModalClose.addEventListener('click', closeNavModal);
  accountClose.addEventListener('click', closeAccount);
  navModal.addEventListener('click', (ev) => { if (ev.target === navModal) closeNavModal(); });
  accountModal.addEventListener('click', (ev) => { if (ev.target === accountModal) closeAccount(); });

  /* Knappen popoveren hører til, husket PÅ panelet. Den settes når panelet
     ÅPNES — uansett bredde, ikke bare når det åpnes som popover: på mobil er
     skallet et sentrert ark (CSS) og ankeret ubrukt, men snus telefonen til
     popover-bredde MENS panelet står åpent, er ankeret det eneste
     `repositionOpenPopovers` har å forankre mot. Uten det ville panelet blitt
     et `position: fixed`-element uten koordinater. */
  function rememberAnchor(panel, btn) {
    panel.__anchor = btn && btn.isConnected ? btn : null;
  }
  // Plasser popoveren (ansvarlig-velger/tids-popover) rett til høyre for
  // knappen (desktop); klem til den SIKRE sonen så den aldri havner utenfor
  // skjermen eller under en systemflate (safeInsets() er null i en nettleser).
  function positionSwitcherPanel(panel, btn) {
    const r = btn.getBoundingClientRect();
    const gap = 8;
    rememberAnchor(panel, btn);
    const safe = safeInsets();
    panel.style.visibility = 'hidden';
    panel.style.top = '0px';
    panel.style.left = '0px';
    const pr = panel.getBoundingClientRect();
    const top = Math.max(safe.top + 10, Math.min(r.top, window.innerHeight - safe.bottom - pr.height - 10));
    let left = r.right + gap;
    if (left + pr.width > window.innerWidth - safe.right - 10) left = Math.max(safe.left + 10, r.left - pr.width - gap);
    panel.style.top = top + 'px';
    panel.style.left = left + 'px';
    panel.style.visibility = '';
  }
  /* En popover som står åpen når viewportet endrer seg — rotasjon, delt skjerm,
     et tastatur som krymper — beholder ellers `top`/`left` fra det GAMLE
     viewportet: den kan bli liggende utenfor skjermen, eller (etter en rotasjon
     som flytter hakket fra én side til den andre) under hakket, helt til den
     lukkes og åpnes igjen. Plasseringen er ren geometri og kan trygt kjøres på
     nytt; på mobil er skallet en sentrert modal (CSS), og da settes ingen
     inline-koordinater i det hele tatt. */
  /* Siste utvei når ankeret er borte: flytt panelet minst mulig, men innenfor
     det brukbare feltet. Uten inline-koordinater (et ark som nettopp ble
     popover) leses posisjonen fra der CSS satte det, og det klemmes derfra. */
  function clampPanelToSafe(panel) {
    const safe = safeInsets();
    const r = panel.getBoundingClientRect();
    const maxX = window.innerWidth - safe.right - 10 - r.width;
    const maxY = window.innerHeight - safe.bottom - 10 - r.height;
    panel.style.left = Math.max(safe.left + 10, Math.min(r.left, maxX)) + 'px';
    panel.style.top = Math.max(safe.top + 10, Math.min(r.top, maxY)) + 'px';
  }
  function repositionOpenPopovers() {
    [[respSwitcherOverlay, respSwitcherPanel], [timeSwitcherOverlay, timeSwitcherPanel],
      [objMenuOverlay, objMenuPanel]].forEach(([overlay, panel]) => {
      if (!overlay || overlay.hidden || !panel) return;
      // Modal-varianten (mobil) plasseres av CSS — inline-koordinatene fra
      // desktop ville låst den fast i hjørnet.
      if (getComputedStyle(panel).position !== 'fixed') return;
      const btn = panel.__anchor;
      if (btn && btn.isConnected) { positionSwitcherPanel(panel, btn); return; }
      /* Ankeret kan ha blitt revet ut av DOM-en mens popoveren står åpen: en
         synk-rebuild eller `refreshCard()` bytter ut hele kortet knappen satt
         i. Da finnes det ingen knapp å forankre mot — men panelet skal likevel
         ikke bli liggende under en systemflate eller utenfor skjermen. */
      clampPanelToSafe(panel);
    });
  }

  /* ---------------- Ansvarlig-velger (popover/modal) ----------------
     Popover på desktop, sentrert modal på mobil (felles .switcher-*-skall
     med tids-popoveren); radene viser en farget initial-sirkel + fullt navn for hver i
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
    repaintObjMenu(); // objektmenyen kan stå åpen på samme objekt
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
          nm.className = 'resp-row-name'; nm.textContent = tr('resp.none');
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
        p.className = 'uni-empty'; p.textContent = tr('share.noMembers');
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
    rememberAnchor(respSwitcherPanel, anchorBtn);
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
        showToast(tr('share.membersFailed'));
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
     OBJEKTMENYEN (én knapp per objekt) + SVEIP FOR Å SLETTE
     ------------------------------------------------------------
     Alle seks objekttypene — område, mappe, mappekategori, liste, listepunkt og
     kategori — har NØYAKTIG én knapp til høyre: `.obj-menu-btn`. Den erstatter
     tannhjulet, ✕, del-knappen, forlat-knappen og oppløs-knappen, og samler alt
     objektet kan gjøre på ett sted:

       Endre navn · Ansvarlig · Tidsplan · Flytt · Deling og medlemmer ·
       Lås/Åpne · Forlat · Slett (eller «Løs opp kategorien»)

     Radene som ikke gjelder objektet utelates helt — en tom rad er verre enn
     ingen rad. Rettighetene gates av de SAMME capabilities som knappene brukte
     (`cap(...)`), og feiler lukket: mangler capabilities fra serveren, vises
     ikke raden. Se docs/rettigheter-og-deling.md.

     FORM: popover forankret i menyknappen på desktop, sentrert ark på mobil —
     samme `.switcher-*`-skall som ansvarlig-velgeren og tids-popoveren, så det
     finnes bare ÉN popover-mekanikk i appen. «Flytt», «Ansvarlig» og «Tidsplan»
     er undermenyer i et TREKKSPILL: å åpne én lukker den andre, med animert
     høyde, så menyen aldri blir lengre enn skjermen.

     Menyen slår alltid opp det LEVENDE objektet på id, så den tåler en
     synk-rebuild mens den står åpen; ankeret finnes igjen på nytt etter en
     rendring (`objMenuAnchor`). */
  const objMenuOverlay = document.getElementById('obj-menu');
  const objMenuPanel = document.getElementById('obj-menu-panel');
  let objMenuCtx = null;    // { spec, sub } mens menyen er åpen
  let objMenuReturn = null; // knappen fokus skal tilbake til ved lukking

  // Det levende state-objektet + containeren det ligger i, slått opp på id.
  function objMenuLive(kind, id) {
    if (kind === 'universe') return findUniverse(id);
    if (kind === 'group' || kind === 'groupcat') return findGroupAnywhere(id);
    if (kind === 'card') return findCard(id);
    return findItemById(id);
  }
  function objMenuCont(kind, obj) {
    if (!obj) return null;
    if (kind === 'universe') return null;
    if (kind === 'group' || kind === 'groupcat') return findUniverse(obj.uni) || obj._parent;
    if (kind === 'card') return activeGroupObj();
    return findCard(obj.home);
  }
  // Objekttypen i bestemt form, slik den leses inne i menyens overskrift og i
  // «Forlat …». Slås opp per kall — språket kan være et annet enn ved oppstart.
  const objMenuWord = (kind) => tr('kindDef.' + kind);
  // Type-ikonet i menyens overskrift (listepunkter har ingen egen glyf — der er
  // teksten identifikasjonen).
  const OBJ_MENU_HEAD_ICON = {
    universe: 'globe', group: 'folder', groupcat: 'groupCategory',
    card: 'list', item: null, category: 'category',
  };
  // Menyknappen for et objekt, funnet på nytt i DOM-en. Brukes etter en
  // rendring (sortering i menyen bygger board-et om) så popoveren kan bli
  // stående forankret i den NYE knappen i stedet for en frakoblet node.
  function objMenuAnchor(spec) {
    const host = objMenuHost(spec);
    if (!host) return null;
    return host.querySelector(':scope > .obj-menu-btn, :scope > .card-head > .obj-menu-btn,' +
      ' :scope > .cat-head > .obj-menu-btn');
  }
  function objMenuHost(spec) {
    const root = spec.scope === navScope ? navBoard : board;
    return (root && root.querySelector('[data-id="' + spec.id + '"]')) || null;
  }
  // Tittel-elementet slik det ser ut NÅ. `spec.rename` er en closure fra
  // byggetidspunktet og holder på tittel-noden fra DEN rendringen; board-et kan
  // ha blitt bygget om mens menyen sto åpen (ensureShareGroup henter medlemmer
  // og rendrer når cachen fylles, og enhver synk-pull rendrer også). Da ville
  // «Endre navn» redigert et frakoblet element — og brukeren fått ingenting.
  // Omdøpings-hooken på det LEVENDE elementet er alltid den riktige.
  const OBJ_MENU_TITLE_SEL = {
    universe: ':scope > .card-head .card-title',
    card: ':scope > .card-head .card-title',
    group: ':scope > .item-main > .item-text',
    item: ':scope > .item-main > .item-text',
    groupcat: ':scope > .cat-head .cat-title',
    category: ':scope > .cat-head .cat-title',
  };
  function renameFromObjMenu(spec) {
    const host = objMenuHost(spec);
    const titleEl = host && host.querySelector(OBJ_MENU_TITLE_SEL[spec.kind]);
    if (titleEl && titleEl.__rename) titleEl.__rename();
  }

  // Fokus tilbake til menyknappen ordnes av den felles fokusfellen
  // (`overlayClosed` observerer `hidden`), ikke her — én mekanikk for alle
  // overlayer, og den finner knappen igjen med selektor når en rendring har
  // byttet ut noden.
  function closeObjMenu() {
    if (!objMenuCtx) return;
    markObjMenuAnchor(false);
    objMenuOverlay.hidden = true;
    objMenuPanel.innerHTML = '';
    objMenuCtx = null;
    objMenuReturn = null;
    updateModalOpenClass();
    if (demoRunning) placeTour(); // demokortet kan legge seg tilbake
  }
  // `aria-expanded` på knappen mens menyen står åpen — og den lille flate-
  // markeringen som følger med, så knappen ikke ser «kald» ut under sin egen
  // popover. Ryddes ved lukking, også når en rendring har byttet ut noden.
  function markObjMenuAnchor(on) {
    const btn = (objMenuCtx && objMenuAnchor(objMenuCtx.spec)) || objMenuReturn;
    if (btn) btn.setAttribute('aria-expanded', on ? 'true' : 'false');
    if (btn && btn !== objMenuReturn && objMenuReturn) {
      objMenuReturn.setAttribute('aria-expanded', on ? 'true' : 'false');
    }
  }
  // Lukk menyen og kjør handlingen ETTERPÅ. Fokusfellen gir fokus tilbake til
  // menyknappen i en mikrotask (MutationObserver på `hidden`); en handling som
  // selv tar fokus — «Endre navn» åpner et navnefelt — ville ellers blitt
  // fratatt det i samme øyeblikk, og navnefeltet lukket seg på blur.
  function closeObjMenuThen(fn) { closeObjMenu(); setTimeout(fn, 0); }

  // Bygg radene på nytt uten å lukke (etter lås/ansvar/sortering). Den åpne
  // trekkspill-fanen beholdes.
  function repaintObjMenu() {
    if (!objMenuCtx) return;
    const spec = objMenuCtx.spec;
    const sub = objMenuCtx.sub;
    const btn = objMenuAnchor(spec) || objMenuReturn;
    if (!objMenuLive(spec.kind, spec.id)) { closeObjMenu(); return; }
    objMenuReturn = btn && btn.isConnected ? btn : objMenuReturn;
    paintObjMenu(spec, sub, false);
    markObjMenuAnchor(true);
  }

  /* ---------- Byggeklosser ---------- */
  function objMenuRow(icon, label, onClick, opts) {
    opts = opts || {};
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'obj-menu-row' + (opts.danger ? ' is-danger' : '');
    b.setAttribute('role', 'menuitem');
    const ic = document.createElement('span');
    ic.className = 'obj-menu-icon';
    ic.setAttribute('aria-hidden', 'true');
    ic.innerHTML = icon || '';
    const tx = document.createElement('span');
    tx.className = 'obj-menu-label';
    tx.textContent = label;
    b.append(ic, tx);
    if (opts.hint) {
      const h = document.createElement('span');
      h.className = 'obj-menu-hint';
      h.textContent = opts.hint;
      b.appendChild(h);
    }
    b.addEventListener('click', onClick);
    return b;
  }
  // Trekkspill-fane: overskriftsrad + skuff. Kun ÉN skuff er åpen om gangen —
  // å åpne en ny lukker den forrige (begge animert). Selve høyde-animasjonen er
  // felles med konto-modalens skuffer (`slideSub`).
  function objMenuAccordion(key, icon, label, buildBody, openNow) {
    const wrap = document.createElement('div');
    wrap.className = 'obj-menu-group';
    const head = objMenuRow(icon, label, () => toggleObjSub(key), {});
    head.classList.add('obj-menu-toggle');
    head.setAttribute('aria-expanded', openNow ? 'true' : 'false');
    const chev = document.createElement('span');
    chev.className = 'obj-menu-chev';
    chev.setAttribute('aria-hidden', 'true');
    chev.innerHTML = ICONS.chevron;
    head.appendChild(chev);
    const sub = document.createElement('div');
    sub.className = 'obj-menu-sub';
    sub.dataset.sub = key;
    sub.appendChild(buildBody());
    if (!openNow) { sub.style.height = '0px'; sub.classList.add('is-closed'); }
    wrap.append(head, sub);
    return wrap;
  }
  function toggleObjSub(key) {
    if (!objMenuCtx) return;
    const next = objMenuCtx.sub === key ? null : key;
    objMenuPanel.querySelectorAll('.obj-menu-sub').forEach((sub) => {
      const want = sub.dataset.sub === next;
      const isOpen = !sub.classList.contains('is-closed');
      if (want !== isOpen) slideSub(sub, want);
      const head = sub.previousElementSibling;
      if (head) head.setAttribute('aria-expanded', want ? 'true' : 'false');
    });
    objMenuCtx.sub = next;
    // Panelet endrer høyde → forankringen på desktop må følge med.
    if (objMenuIsPopover()) {
      setTimeout(() => {
        const a = objMenuAnchor(objMenuCtx ? objMenuCtx.spec : {}) || objMenuReturn;
        if (objMenuCtx && a && a.isConnected) positionSwitcherPanel(objMenuPanel, a);
      }, SUB_MS);
    }
  }
  function objMenuIsPopover() { return window.matchMedia('(min-width: 561px)').matches; }

  /* ---------- Ansvarlig-skuffen (delt kontekst) ---------- */
  // Samme rader som ansvarlig-velgeren, men INNE i menyen — en popover oppå en
  // popover ville lagt to lag over hverandre på samme knapp.
  function buildRespRows(target, shareRoot, rType) {
    const wrap = document.createElement('div');
    wrap.className = 'obj-menu-resp';
    const key = rootKey(rType, shareRoot.id);
    const paint = (group) => {
      const live = liveTarget(target);
      const cur = ((live || target).obj.responsible) || null;
      wrap.innerHTML = '';
      const mkRow = (person, index, isNone) => {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'resp-row' + (isNone ? ' resp-row-clear' : '');
        row.setAttribute('role', 'menuitemradio');
        const active = isNone ? !cur : cur === person.id;
        row.setAttribute('aria-checked', active ? 'true' : 'false');
        row.classList.toggle('active', active);
        if (isNone) {
          row.innerHTML = '<span class="resp-avatar resp-avatar-none">' + ICONS.handRaise + '</span>';
        } else {
          row.appendChild(respAvatar(person, index));
        }
        const nm = document.createElement('span');
        nm.className = 'resp-row-name';
        nm.textContent = isNone ? tr('resp.none') : person.name;
        row.appendChild(nm);
        row.addEventListener('click', () => {
          setResponsible(target, isNone ? null : person.id);
          paint(shareGroupCache.get(key) || group);
        });
        return row;
      };
      wrap.appendChild(mkRow(null, -1, true));
      group.people.forEach((p, i) => wrap.appendChild(mkRow(p, i, false)));
      if (!group.people.length) {
        const p = document.createElement('p');
        p.className = 'uni-empty';
        p.textContent = tr('share.noMembers');
        wrap.appendChild(p);
      }
    };
    const cached = shareGroupCache.get(key);
    if (cached) paint(cached);
    else wrap.innerHTML = '<p class="uni-empty">' + tr('share.loadingMembers') + '</p>';
    fetchShareGroup(rType, shareRoot.id).then((g) => {
      shareGroupCache.set(key, g);
      if (wrap.isConnected) paint(g);
    }).catch(() => { /* behold det som står */ });
    return wrap;
  }

  /* ---------- Selve menyen ---------- */
  function paintObjMenu(spec, openSub, focusFirst) {
    const kind = spec.kind;
    const obj = objMenuLive(kind, spec.id);
    if (!obj) { closeObjMenu(); return; }
    const cont = objMenuCont(kind, obj);
    const shareType = kind === 'universe' ? 'universe' : 'group';
    objMenuCtx = { spec, sub: openSub || null };
    objMenuPanel.innerHTML = '';

    // Overskrift: hvilket objekt menyen gjelder. Uten den er en popover som
    // dekker raden den kom fra umulig å plassere — særlig på mobil.
    const head = document.createElement('div');
    head.className = 'obj-menu-head';
    if (OBJ_MENU_HEAD_ICON[kind]) {
      const hIcon = document.createElement('span');
      hIcon.className = 'obj-menu-head-icon';
      hIcon.setAttribute('aria-hidden', 'true');
      hIcon.innerHTML = ICONS[OBJ_MENU_HEAD_ICON[kind]];
      head.appendChild(hIcon);
    }
    const hName = document.createElement('span');
    hName.className = 'obj-menu-head-name';
    hName.textContent = nameOfAny(obj) || tr('common.noName');
    head.appendChild(hName);
    objMenuPanel.appendChild(head);
    objMenuPanel.setAttribute('aria-label', tr('menu.forObject',
      { kind: objMenuWord(kind) || tr('common.theObject'), name: quoted(nameOfAny(obj)) }));

    const list = document.createElement('div');
    list.className = 'obj-menu-list';
    objMenuPanel.appendChild(list);

    /* 1) Endre navn — lukker menyen og åpner navneredigereren på plassen.
          For områder, mapper og lister er dette den ENESTE veien inn (klikk på
          navnet der navigerer/kollapser nå); listepunkter og kategorier kan
          fortsatt omdøpes ved å klikke rett på navnet. */
    if (spec.rename) {
      list.appendChild(objMenuRow(ICONS.pencil, tr('menu.rename'),
        () => closeObjMenuThen(() => renameFromObjMenu(spec))));
    }

    /* 2) Ansvarlig (liste/listepunkt/kategori i delt kontekst) — fra den gamle
          innstillingsmodalen, nå som trekkspill-skuff. */
    if (kind === 'card' || kind === 'item' || kind === 'category') {
      const target = liveTarget({ kind: kind, obj: { id: spec.id } });
      const shareRoot = target ? shareRootFor(target.card) : null;
      // Frosset (låst for meg) liste → ingen ansvarlig-rader: serveren avviser
      // innholds-endringen, og en optimistisk visning ville bare blitt rullet
      // tilbake ved neste synk. Innstillingsknappen var avskrudd på samme vis.
      if (target && shareRoot && shareRoot._shared && !frozen(target.card)) {
        ensureShareGroup('group', shareRoot.id);
        list.appendChild(objMenuAccordion('resp', ICONS.handRaise, tr('menu.responsible'),
          () => buildRespRows(target, shareRoot, 'group'), objMenuCtx.sub === 'resp'));
      }
    }

    /* 3) Tidsplan (liste/listepunkt/kategori) — hele tids-editoren fra den gamle
          innstillingsmodalen, uendret, i en skuff. */
    if (kind === 'card' || kind === 'item' || kind === 'category') {
      const getT = () => liveTarget({ kind: kind, obj: { id: spec.id } });
      if (getT()) {
        list.appendChild(objMenuAccordion('time', ICONS.calendar, tr('menu.schedule'),
          () => buildTimeEditor(getT), objMenuCtx.sub === 'time'));
      }
    }

    /* 4) Flytt — tastaturflyttingens knapper, for dem som ikke kan eller vil
          bruke dra-og-slipp. «Flytt opp/ned» lar menyen stå åpen så flere hakk
          kan tas etter hverandre; «Flytt til …» åpner velger-modalen. */
    const canOrder = canReorderObj(kind, obj, cont);
    const canRehome = kind === 'card' || kind === 'item' || kind === 'group';
    if (canOrder) {
      list.appendChild(objMenuAccordion('move', ICONS.moveArrows, tr('menu.move'), () => {
        const box = document.createElement('div');
        box.className = 'obj-menu-movebox';
        const step = (dir, icon, label) => objMenuRow(icon, label, () => {
          keyboardReorder(kind, spec.id, dir);
          repaintObjMenu();
          const again = objMenuPanel.querySelector('[data-move="' + dir + '"]');
          if (again) again.focus();
        });
        const up = step(-1, ICONS.arrowUp, tr('menu.moveUp'));
        up.dataset.move = '-1';
        const down = step(1, ICONS.arrowDown, tr('menu.moveDown'));
        down.dataset.move = '1';
        box.append(up, down);
        if (canRehome) {
          box.appendChild(objMenuRow(ICONS.folder, tr('menu.moveTo'),
            () => closeObjMenuThen(() => keyboardMoveTo(kind, spec.id))));
        }
        return box;
      }, objMenuCtx.sub === 'move'));
    }

    /* 5) Deling og medlemmer — kun område og mappe. Det er de to nivåene som
          kan deles; alt under dem arver tilgangen og har ingen egen
          medlemsliste (docs/rettigheter-og-deling.md). */
    if (spec.share) {
      list.appendChild(objMenuRow(ICONS.people, tr('menu.sharing'),
        () => closeObjMenuThen(spec.share)));
    }

    /* 6) Lås (delte områder/mapper). Nærmeste eksplisitte tilstand vinner: en
          EGEN lås går foran en arvet, ellers tilbys unntaket. Samme skriving som
          del-modalens knapp (toggleObjLock) — de kan ikke gli fra hverandre. */
    if ((kind === 'universe' || kind === 'group') && obj._shared) {
      const anc = obj._locked ? null : inheritedLockInfo(shareType, obj);
      const exception = !!anc;
      const allowed = exception ? cap(obj, 'lockException', false) : cap(obj, 'manageLock', false);
      if (allowed) {
        const on = exception ? !!obj._unlocked : !!obj._locked;
        // Ikonet viser tilstanden raden FØRER TIL, ikke den man står i.
        const icon = exception ? (on ? ICONS.lock : ICONS.unlock) : (on ? ICONS.unlock : ICONS.lock);
        const label = exception
          ? tr(on ? 'lock.removeException' : 'lock.makeException')
          : tr(on ? 'lock.openForEditing' : 'lock.lockForEditing');
        const hint = exception
          ? tr(on ? 'lock.exemptFromInherited' : 'lock.lockedByParent')
          : tr(on ? 'lock.othersCanView' : 'lock.everyoneCanEdit');
        list.appendChild(objMenuRow(icon, label, () => {
          toggleObjLock(shareType, spec.id, obj, exception, () => { render(); repaintObjMenu(); });
        }, { hint: hint }));
      }
    }

    /* 7) Forlat (delte områder/mapper) — gir fra seg MIN tilgang, aldri innholdet. */
    if ((kind === 'universe' || kind === 'group') && cap(obj, 'leave', false)) {
      list.appendChild(objMenuRow(ICONS.logout, tr('leave.title', { kind: objMenuWord(kind) }),
        () => closeObjMenuThen(() => {
          const live = objMenuLive(kind, spec.id);
          if (live) leaveObject(kind, live);
        })));
    }

    /* 8) Sletting sist, bak en skillelinje og i rødt: den er den eneste raden
          som fjerner noe, og den skal aldri ligge der fingeren treffer først. */
    if (spec.remove) {
      const sep = document.createElement('div');
      sep.className = 'obj-menu-sep';
      list.appendChild(sep);
      list.appendChild(objMenuRow(spec.removeIcon || ICONS.trash,
        spec.removeLabel || tr('menu.delete'),
        () => closeObjMenuThen(spec.remove), { danger: true }));
    }

    if (focusFirst) {
      const first = list.querySelector('.obj-menu-row');
      (first || objMenuPanel).focus();
    }
  }

  function openObjMenu(spec, anchorBtn) {
    if (objMenuCtx) closeObjMenu();
    objMenuReturn = anchorBtn || null;
    rememberAnchor(objMenuPanel, anchorBtn);
    objMenuOverlay.hidden = false;
    objMenuPanel.style.top = '';
    objMenuPanel.style.left = '';
    paintObjMenu(spec, null, false);
    if (!objMenuCtx) { objMenuOverlay.hidden = true; return; } // objektet fantes ikke
    updateModalOpenClass();
    markObjMenuAnchor(true);
    if (anchorBtn && anchorBtn.isConnected && objMenuIsPopover()) {
      positionSwitcherPanel(objMenuPanel, anchorBtn);
    }
    if (demoRunning) placeTour(); // demokortet må vike for popoveren
    const first = objMenuPanel.querySelector('.obj-menu-row');
    (first || objMenuPanel).focus();
  }

  // Kobler menyknappen på et objekt. `spec` beskriver KUN det byggeren vet
  // (omdøping, deling, sletting); resten utleder menyen selv fra kind + id.
  function attachObjMenu(btn, spec) {
    if (!btn) return;
    btn.innerHTML = ICONS.menuDots;
    btn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      openObjMenu(spec, btn);
    });
  }

  objMenuOverlay.addEventListener('click', (ev) => { if (ev.target === objMenuOverlay) closeObjMenu(); });
  // Piltaster mellom de synlige radene (menyen er en `menu`, ikke et skjema).
  objMenuPanel.addEventListener('keydown', (ev) => {
    if (ev.key !== 'ArrowDown' && ev.key !== 'ArrowUp') return;
    const rows = [...objMenuPanel.querySelectorAll('.obj-menu-row, .resp-row')]
      .filter((r) => r.offsetParent !== null);
    const i = rows.indexOf(document.activeElement);
    if (i < 0) return;
    ev.preventDefault();
    rows[(i + (ev.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length].focus();
  });

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
    const canEdit = !locked && !frozen(isCard ? t0.obj : t0.card);

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
        const which = tr(ctrlIsCat ? 'kindDef.category' : 'kindDef.card');
        const nm = ctrlIsCat ? (controller.text || tr('kind.category')) : (controller.title || tr('common.noName'));
        note.textContent = tr('time.controlledBy', { kind: which, name: quoted(nm) });
        note.classList.add('is-muted');
        note.hidden = false;
        return;
      }
      if (isCard || isCat) { note.hidden = true; return; }
      // Subtil beskjed når elementets tider ligger utenfor containerens tidsrom
      // (tre varianter: start / frist / begge). Fullt lovlig — bare et hint.
      const fl = outsideFlags(t.obj, outsideContainer());
      if (fl.start && fl.due) note.textContent = tr('time.bothOutside');
      else if (fl.start) note.textContent = tr('time.startOutside');
      else if (fl.due) note.textContent = tr('time.dueOutside');
      note.hidden = !(fl.start || fl.due);
    };

    const makeRow = (field) => {
      const isDue = field === 'due';
      const group = document.createElement('div');
      group.className = 'time-group';
      // Overskrift over feltparet («Starttid»/«Tidsfrist» + tilhørende ikon) —
      // kun i fullvisningen (modalen). Tids-popoveren har allerede egen
      // tilsvarende tittel (time-panel-title) for det ene feltet den viser.
      if (!opts.only) {
        const heading = document.createElement('div');
        heading.className = 'time-group-heading';
        heading.innerHTML = (isDue ? ICONS.calendarDue : ICONS.calendar) +
          '<span>' + tr(isDue ? 'time.due' : 'time.start') + '</span>';
        group.appendChild(heading);
      }
      const row = document.createElement('div');
      row.className = 'time-row';
      const dateIn = document.createElement('input');
      dateIn.type = 'date';
      dateIn.className = 'field time-date';
      dateIn.placeholder = tr('time.datePlaceholder');
      dateIn.setAttribute('aria-label', tr(isDue ? 'time.dueDate' : 'time.startDate'));
      // Klokkeikon til venstre for klokkeslett-feltet (egen ikon ved siden av,
      // ikke inni inputen — unngår at det overlapper med teksten som skrives).
      const clockIcon = document.createElement('span');
      clockIcon.className = 'time-clock-icon';
      clockIcon.setAttribute('aria-hidden', 'true');
      clockIcon.innerHTML = ICONS.clock;
      const timeIn = document.createElement('input');
      timeIn.type = 'time';
      timeIn.className = 'field time-clock';
      timeIn.placeholder = 'tt:mm';
      timeIn.setAttribute('aria-label', tr('time.clockOptional'));
      const clearBtn = document.createElement('button');
      clearBtn.type = 'button';
      clearBtn.className = 'icon-btn time-clear';
      clearBtn.innerHTML = ICONS.xmark;
      clearBtn.title = tr('time.clear');
      clearBtn.setAttribute('aria-label', tr(isDue ? 'time.clearDue' : 'time.clearStart'));

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
      row.append(dateIn, clockIcon, timeIn, clearBtn);
      group.appendChild(row);
      return group;
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
      txt.textContent = tr(isCat ? 'time.lockInCategory' : 'time.lockInCard');
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
      ? ICONS.calendarDue + '<span>' + tr('time.due') + '</span>'
      : ICONS.calendar + '<span>' + tr('time.start') + '</span>';
    timeSwitcherPanel.append(head, buildTimeEditor(getT, { only: field }));
    timeQuickOpen = true;
    rememberAnchor(timeSwitcherPanel, anchorBtn);
    timeSwitcherOverlay.hidden = false;
    updateModalOpenClass();
    if (anchorBtn && anchorBtn.isConnected && window.matchMedia('(min-width: 561px)').matches) {
      positionSwitcherPanel(timeSwitcherPanel, anchorBtn);
    }
    const firstInput = timeSwitcherPanel.querySelector('input:not([disabled])');
    if (firstInput) firstInput.focus();
  }
  timeSwitcherOverlay.addEventListener('click', (ev) => { if (ev.target === timeSwitcherOverlay) closeTimeQuick(); });

  // Område-søppelkassen (i menyen): vises kun når den har innhold.
  function updateUniversesTrash() { updateTrashBadge(trashedUniverses, uniTrashCount, uniTrashBtn); }

  function addUniverse() {
    const u = makeUniverse(tr('nav.newUniverse'));
    u.pos = state.universes.length ? maxPos(state.universes) + 1 : 0;
    stampContent(u);
    stampPos(u);
    state.universes.push(u);
    setActiveUniverse(u.id);
    render(); // tegner nav-modalen på nytt (nytt område er tomt → tomt board)
    // Rull det nye området inn i syne og start navneredigering (kun når
    // modalen er åpen — den programmatiske veien lar navnet stå som standard).
    const el = navBoard.querySelector('.card[data-id="' + u.id + '"]');
    if (el) {
      try { el.scrollIntoView({ block: 'nearest' }); } catch (e) { /* ignore */ }
      startRename(el.querySelector('.card-title'));
    }
    return u;
  }

  // Slett et område → legg i område-søppelkassen (trashed-flagg; gjenopprettbar).
  // Permanent sletting (med gravsteiner) skjer først når søppelkassen tømmes.
  function deleteUniverse(u) {
    if (u._virtual) return;
    const ghost = ghostFrom(navBoard.querySelector('.card[data-id="' + u.id + '"]'));
    keepFocus(focusTargetAfterRemoval('universe', u.id, null));
    bufferDelete(u, 'universe', (x) => setTrashed(x, 'universe', true));
    if (state.activeUniverse === u.id) {
      const first = visibleUniverses()[0]; // ekskluderer nå den buffer-slettede
      setActiveUniverse(first ? first.id : null);
    }
    render(); // område-søppelkassen blir synlig FØR animasjonen starter
    flyGhost(ghost, uniTrashBtn);
    pushDeleteToast('universe', u.id, u.name);
  }

  /* ============================================================
     SANNTIDS-SYNK (Supabase Auth + relasjonelle tabeller)
     ------------------------------------------------------------
     Brukeren logger inn med e-post/passord. Data ligger relasjonelt
     (universes/groups/cards/items + memberships) med RLS og server-
     side felt-nivå LWW. Synk-motoren (get_my_doc → 3-veis fletting →
     rad-CRUD) og delings-maskineriet ligger lenger ned; her defineres
     bare backend-klienten. Se docs/accounts.md. */
  let sb = null;              // Supabase-klient (lazy)
  let applyingRemote = false; // sant mens vi skriver fjern-tilstand lokalt (unngå re-push)

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
      isCat: !!it.isCat, lockTimes: !!it.lockTimes, collapsed: !!it.collapsed,
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
      collapsed: !!c.collapsed,
      ts: c.ts || 0, org: c.org || '',
      labTs: c.labTs || 0, labOrg: c.labOrg || '',
      pos: c.pos || 0, posTs: c.posTs || 0, posOrg: c.posOrg || '',
    };
  }
  function cleanGroup(g) {
    return {
      id: g.id, uni: g.uni || null, name: g.name, trashed: !!g.trashed,
      cat: g.cat || null, isCat: !!g.isCat, collapsed: !!g.collapsed,
      ts: g.ts || 0, org: g.org || '',
      pos: g.pos || 0, posTs: g.posTs || 0, posOrg: g.posOrg || '',
    };
  }
  function cleanUniverse(u) {
    return {
      id: u.id, name: u.name, trashed: !!u.trashed, collapsed: !!u.collapsed,
      ts: u.ts || 0, org: u.org || '',
      pos: u.pos || 0, posTs: u.posTs || 0, posOrg: u.posOrg || '',
    };
  }
  // Synk-doc er flatt: fire parallelle tabeller (områder/mapper/lister/
  // elementer) med forelder-peker (mappe.uni, kort.group, element.home).
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
      // «Mapper delt med meg» er en VIRTUELL beholder — den finnes ikke i
      // databasen og skal aldri pushes. Mappene i den skrives som vanlig
      // (canonRow beholder deres kanoniske område).
      if (!u._virtual) universes.push(rowFn(u, 'universe', null));
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
  /* ---------- Felt-nivå LWW-fletting (per register) ----------
     Gjenbrukes av 3-veis-fletteren (reconcile) i synk-motoren: for rader
     som finnes både lokalt og på serveren velges nyeste verdi per register
     (innhold `ts/org`, posisjon `posTs/posOrg`, merkelapp `labTs/labOrg`). */
  function mergeItem(a, b) {
    const content = newer(a.ts, a.org, b.ts, b.org) ? a : b;
    const posw = newer(a.posTs, a.posOrg, b.posTs, b.posOrg) ? a : b;
    return {
      id: a.id, text: content.text, trashed: !!content.trashed, done: !!content.done,
      isCat: !!content.isCat, lockTimes: !!content.lockTimes, collapsed: !!content.collapsed, // innhold: kategori-markør + tidslås + kollaps
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
      collapsed: !!content.collapsed,
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
      // `cat` (mappekategori-medlemskap) er en forelder-endring → posisjonsregisteret,
      // som `uni`. `isCat`/`collapsed` er innhold, som `name`.
      cat: posw.cat || null,
      name: content.name, trashed: !!content.trashed,
      isCat: !!content.isCat, collapsed: !!content.collapsed,
      ts: content.ts || 0, org: content.org || '',
      pos: posw.pos || 0, posTs: posw.posTs || 0, posOrg: posw.posOrg || '',
    };
  }
  function mergeUniverseScalar(a, b) {
    const content = newer(a.ts, a.org, b.ts, b.org) ? a : b;
    const posw = newer(a.posTs, a.posOrg, b.posTs, b.posOrg) ? a : b;
    return {
      id: a.id, name: content.name, trashed: !!content.trashed,
      collapsed: !!content.collapsed,
      ts: content.ts || 0, org: content.org || '',
      pos: posw.pos || 0, posTs: posw.posTs || 0, posOrg: posw.posOrg || '',
    };
  }
  /* ---------- Aktiv redigering (ikke riv ned board-et midt i) ---------- */
  function isBusyEditing() {
    if (drag.active) return true;
    const ae = document.activeElement;
    // Navneredigereren (`.edit-input`) dekker også nyopprettede, ennå navnløse
    // listepunkter/kategorier: en synk-rebuild midt i ville revet ned raden og
    // stjålet fokuset før man rakk å skrive noe.
    if (ae && ae.classList && ae.classList.contains('edit-input')) return true;
    return false;
  }
  /* ---------- Lett, forbigående varsel (ingen fast statusindikator) ---------- */
  let toastTimer = null;
  let toastDismiss = null; // onDismiss for toasten som vises nå (se showToast)
  // action (valgfri): { label, fn } → knapp i toasten (f.eks. «Angre»). Med
  // handling står toasten lenger (5 s) siden brukeren skal rekke å trykke.
  // opts.sticky: ikke auto-skjul — kalleren styrer skjuling selv (samle-toasten
  // for slettinger, der en felles timer styrer både commit og skjuling).
  // opts.onDismiss: kjøres når brukeren sveiper toasten bort — «jeg er ferdig
  // med denne, ikke vent på timeren». Slette-toasten committer da slettingen
  // med en gang (samme utfall som når timeren utløper).
  // opts.tip: kontekstuelt tips (se INTRODUKSJON) — samme toast, men teksten
  // får brekke over flere linjer i stedet for å kappes.
  function showToast(msg, action, opts) {
    opts = opts || {};
    let t = document.getElementById('toast');
    if (!t) {
      t = document.createElement('div'); t.id = 'toast'; t.className = 'toast';
      // Toasten er appens eneste kanal for «dette skjedde nettopp» — også for
      // de kontekstuelle tipsene. Uten et live-område ville en skjermleser
      // aldri fått med seg noen av dem.
      t.setAttribute('role', 'status');
      t.setAttribute('aria-live', 'polite');
      document.body.appendChild(t);
      attachToastSwipe(t);
    }
    t.classList.toggle('toast-tip', !!opts.tip); // elementet gjenbrukes
    resetToastTransform(t);
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
    toastDismiss = typeof opts.onDismiss === 'function' ? opts.onDismiss : null;
    t.classList.add('show');
    clearTimeout(toastTimer);
    if (!opts.sticky) toastTimer = setTimeout(() => t.classList.remove('show'), action ? 5000 : 2200);
  }
  function hideToast() {
    const t = document.getElementById('toast');
    if (t) { t.classList.remove('show'); resetToastTransform(t); }
    toastDismiss = null;
    clearTimeout(toastTimer);
  }
  // Nullstill sveipe-sporene, så CSS-en (.toast/.toast.show) igjen eier
  // plasseringen og neste visning glir inn fra riktig sted.
  function resetToastTransform(t) {
    t.classList.remove('toast-dragging', 'toast-swipe-out');
    t.style.transform = '';
    t.style.opacity = '';
  }

  /* ---------- Sveip toasten til høyre for å lukke ----------
     Toasten er sentrert med `translate(-50%, …)`, så draget legges inn i den
     samme transformen (`calc(-50% + Npx)`). Kun høyre-retning: venstre drag
     stopper på 0, og en overveiende vertikal bevegelse gir opp gesten så siden
     ruller nativt. Passerer draget terskelen kastes toasten ut og lukkes
     umiddelbart — timeren ventes ikke ut. */
  const TOAST_SWIPE_START_PX = 8;   // slark før draget «tar tak»
  const TOAST_SWIPE_OUT_MS = 180;   // matcher .toast-swipe-out-transisjonen
  function attachToastSwipe(t) {
    let sw = null;            // { id, x0, y0, dx, active }
    let swallowClick = false; // et fullført drag skal ikke også trykke «Angre»
    const threshold = () => Math.max(56, t.offsetWidth * 0.3);
    // Som de andre dra-motorene: move/up lyttes på window mens draget pågår, og
    // pekerfangsten holder eventene i gang om fingeren forlater toasten.
    function end() {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      sw = null;
    }
    function onMove(ev) {
      if (!sw || ev.pointerId !== sw.id) return;
      const dx = ev.clientX - sw.x0, dy = ev.clientY - sw.y0;
      if (!sw.active) {
        // Overveiende vertikalt = scroll på siden → gi gesten fra oss.
        if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > TOAST_SWIPE_START_PX) { end(); return; }
        if (dx < TOAST_SWIPE_START_PX) return;
        sw.active = true;
        t.classList.add('toast-dragging');
        try { t.setPointerCapture(sw.id); } catch (e) { /* ikke-aktiv peker */ }
      }
      sw.dx = Math.max(0, dx);   // kun høyre: venstre drag står stille på 0
      t.style.transform = 'translate(calc(-50% + ' + sw.dx + 'px), 0)';
      // Toner svakt ut underveis, men holder seg godt synlig til slippet avgjør.
      t.style.opacity = String(Math.max(0.35, 1 - sw.dx / (threshold() * 3)));
    }
    function onUp(ev) {
      if (!sw || ev.pointerId !== sw.id) return;
      const past = sw.active && sw.dx >= threshold();
      swallowClick = sw.active;
      end();
      if (past) swipeToastOut(t);
      else resetToastTransform(t);
    }
    function onCancel(ev) {
      if (!sw || ev.pointerId !== sw.id) return;
      end();
      resetToastTransform(t);
    }
    t.addEventListener('pointerdown', (ev) => {
      if (sw || ev.button > 0 || !t.classList.contains('show')) return;
      swallowClick = false;
      sw = { id: ev.pointerId, x0: ev.clientX, y0: ev.clientY, dx: 0, active: false };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onCancel);
    });
    // Klikket som følger et drag må stanses — ellers ville «Angre» fyre av på
    // slippet (draget kan godt starte oppå knappen).
    t.addEventListener('click', (ev) => {
      if (!swallowClick) return;
      swallowClick = false;
      ev.preventDefault(); ev.stopPropagation();
    }, true);
  }
  // Kast toasten ut av skjermen til høyre og lukk den. `toastDismiss` får si sitt
  // først (slette-toasten committer slettingen), deretter ryddes toasten.
  function swipeToastOut(t) {
    const dismiss = toastDismiss;
    t.classList.remove('toast-dragging');
    t.classList.add('toast-swipe-out');
    t.style.transform = 'translate(calc(-50% + ' + (window.innerWidth + 40) + 'px), 0)';
    t.style.opacity = '0';
    if (dismiss) dismiss();
    // Ikke rydd inline-stilene før utkastet er malt (ellers spretter den tilbake).
    setTimeout(() => { if (t.classList.contains('toast-swipe-out')) hideToast(); }, TOAST_SWIPE_OUT_MS);
  }

  /* ---------- Logg ut (i konto-modalen) ----------
     Synken går fortløpende i bakgrunnen; ingen egen synk-knapp trengs.
     Ved fjern-endringer vises et lite «oppdatert»-varsel (showToast). */
  logoutBtn.addEventListener('click', async () => {
    if (await askConfirm({ title: tr('account.logout'), message: tr('account.logoutMsg'),
      okLabel: tr('account.logout') })) logout();
  });

  function logout() {
    closeAccount();
    const client = acli();
    cloudStop();
    if (client) { try { client.auth.signOut(); } catch (e) { /* ignore */ } }
  }

  /* ---------- Slett konto (i konto-modalen) ----------
     Endelig og uopprettelig, så bekreftelsen er en GEST, ikke en knapp:
     advarselen forklarer hva som forsvinner (og hva som blir stående hos
     andre), og feltet må sveipes helt til høyre. Formspråket er søppelkassenes
     sveipefelt (ikon som roterer, fylling som følger sveipet), her i faresonens
     farger og som et fast felt i modalen. Tastatur kommer til det samme med
     piltastene (role="slider").
     Selve slettingen skjer serverside i én transaksjon (`delete_account`, se
     docs/rettigheter-og-deling.md); klienten rydder bare sine egne lokale spor
     og lander på innloggingssiden. */
  const delAccountBtn = document.getElementById('delete-account-btn');
  const delAccountModal = document.getElementById('delete-account-modal');
  const delAccountSwipe = document.getElementById('delete-account-swipe');
  const delAccountErrorEl = document.getElementById('delete-account-error');
  delAccountSwipe.innerHTML =
    ICONS.trashSwipe +
    '<span class="swipe-label">' + tr('account.deleteSwipeLabel') + '</span>' +
    '<span class="swipe-arrow" aria-hidden="true"></span>';
  const delSwipeIcon = delAccountSwipe.querySelector('.swipe-icon');
  const delSwipeLid = delAccountSwipe.querySelector('.swipe-icon-lid');
  const DEL_SWIPE_MIN = 120;   // minste strekk (px) et sveip må dekke
  const DEL_KEY_STEP = 0.2;    // ett piltast-trykk (fem trykk = bekreftet)
  let delDrag = null;          // { id, x0, span } mens fingeren er nede
  let deletingAccount = false; // sant fra bekreftet gest til utfallet er kjent

  function paintDeleteProgress(p) {
    const v = Math.min(1, Math.max(0, p));
    delAccountSwipe.style.setProperty('--p', v.toFixed(3));
    delSwipeIcon.style.transform = 'rotate(' + (v * 180) + 'deg)';
    // Lokket svinger opp gjennom hele sveipet — som i søppelkassenes felt.
    delSwipeLid.style.transform = 'rotate(' + (-95 * v) + 'deg)';
    delAccountSwipe.setAttribute('aria-valuenow', String(Math.round(v * 100)));
  }
  // Ett sted for «hvor langt er sveipet kommet»: helt fremme = slett.
  function advanceDelete(p) {
    if (deletingAccount) return;
    paintDeleteProgress(p);
    if (p >= 1) fireDeleteAccount();
  }
  function openDeleteAccount() {
    delAccountErrorEl.hidden = true;
    delAccountErrorEl.textContent = '';
    deletingAccount = false;
    delSwipeIcon.classList.remove('shake');
    paintDeleteProgress(0);
    delAccountModal.hidden = false;
    updateModalOpenClass();
    // Fokus på selve feltet: det er handlingen modalen finnes for, og
    // skjermlesere leser opp hvordan den bekreftes (aria-label).
    delAccountSwipe.focus();
  }
  function closeDeleteAccount() {
    delAccountModal.hidden = true;
    endDelDrag();
    updateModalOpenClass();
  }
  delAccountBtn.addEventListener('click', openDeleteAccount);
  document.getElementById('delete-account-cancel').addEventListener('click', closeDeleteAccount);
  document.getElementById('delete-account-close').addEventListener('click', closeDeleteAccount);
  delAccountModal.addEventListener('click', (ev) => {
    if (ev.target === delAccountModal) closeDeleteAccount();
  });

  // Sveipet måles fra der fingeren gikk NED (ikke fra feltets venstrekant): et
  // trykk i høyre ende skal ikke i seg selv være en bekreftelse. Strekket er
  // feltets brukbare bredde, så et sveip som starter der ikonet står ender
  // nøyaktig ved pilspissen. Som de andre dra-motorene lyttes move/up på window
  // mens gesten pågår, så den ikke mistes om fingeren forlater feltet.
  function onDelMove(ev) {
    if (!delDrag || ev.pointerId !== delDrag.id) return;
    advanceDelete((ev.clientX - delDrag.x0) / delDrag.span);
  }
  function onDelUp(ev) {
    if (!delDrag || ev.pointerId !== delDrag.id) return;
    endDelDrag();
    if (!deletingAccount) paintDeleteProgress(0); // sluppet for tidlig → tilbake
  }
  function endDelDrag() {
    window.removeEventListener('pointermove', onDelMove);
    window.removeEventListener('pointerup', onDelUp);
    window.removeEventListener('pointercancel', onDelUp);
    delDrag = null;
  }
  delAccountSwipe.addEventListener('pointerdown', (ev) => {
    if (delDrag || deletingAccount || (ev.button != null && ev.button > 0)) return;
    ev.preventDefault();
    const r = delAccountSwipe.getBoundingClientRect();
    const ir = delSwipeIcon.getBoundingClientRect();
    delDrag = { id: ev.pointerId, x0: ev.clientX,
                span: Math.max(DEL_SWIPE_MIN, r.right - 18 - (ir.left + ir.width / 2)) };
    try { delAccountSwipe.setPointerCapture(ev.pointerId); } catch (e) { /* ikke-aktiv peker */ }
    window.addEventListener('pointermove', onDelMove);
    window.addEventListener('pointerup', onDelUp);
    window.addEventListener('pointercancel', onDelUp);
  });
  // Tastatur: samme friksjon, uten peker. Enter/mellomrom gjør bevisst ingenting.
  delAccountSwipe.addEventListener('keydown', (ev) => {
    if (deletingAccount) return;
    const cur = parseFloat(delAccountSwipe.getAttribute('aria-valuenow') || '0') / 100;
    if (ev.key === 'ArrowRight' || ev.key === 'ArrowUp') advanceDelete(cur + DEL_KEY_STEP);
    else if (ev.key === 'ArrowLeft' || ev.key === 'ArrowDown') advanceDelete(cur - DEL_KEY_STEP);
    else if (ev.key === 'End') advanceDelete(1);
    else if (ev.key === 'Home') advanceDelete(0);
    else return;
    ev.preventDefault();
  });

  async function fireDeleteAccount() {
    if (deletingAccount || !authUser) return;
    deletingAccount = true;
    paintDeleteProgress(1);
    delSwipeIcon.classList.add('shake');
    const uid = authUser.id;
    const cache = cacheKey();
    const { error } = await acli().rpc('delete_account');
    if (error) {
      // Kontoen står — vis hvorfor, og la feltet kunne sveipes på nytt.
      deletingAccount = false;
      delSwipeIcon.classList.remove('shake');
      paintDeleteProgress(0);
      delAccountErrorEl.textContent = friendlyAuthError(error);
      delAccountErrorEl.hidden = false;
      return;
    }
    closeDeleteAccount();
    // Kvitteringen hører hjemme på innloggingssiden, ikke i en toast: toasten
    // ligger UNDER auth-skjermen (z-index 300 mot 400), og det er hit brukeren
    // nettopp er sendt. Settes FØR utloggingen — den maler skjermen selv.
    authNotice = tr('account.deleted');
    logout(); // stopper synken, tømmer minnet og viser innloggingssiden
    // Ingen lokale spor heller. En cache-skriving som allerede var bestilt ville
    // ellers ha skrevet posten inn igjen 120 ms senere (nøkkelen fanges når
    // skrivingen bestilles), så den avbestilles først.
    clearTimeout(saveTimer); saveTimer = null; cacheDirty = false;
    try {
      localStorage.removeItem(cache);
      localStorage.removeItem('hk-migrated:' + uid);
    } catch (e) { /* ignore */ }
  }

  /* ============================================================
     BRUKERKONTOER OG DELING (klient)
     ------------------------------------------------------------
     Brukeren logger inn med Supabase Auth (e-post/passord). Data
     ligger relasjonelt (universes/groups/cards/items + memberships)
     med RLS og server-side felt-nivå LWW. Synk-motor: get_my_doc()
     (pull) → 3-veis fletting mot en base-snapshot → rad-CRUD (push);
     realtime postgres_changes + poll. Delte objekter «monteres» inn i
     mottakerens valgte forelder via membership-rader. Se
     docs/accounts.md og docs/arkitektur-brukere-deling.md.
     ============================================================ */

  // ?mock=1 kjører mot en hermetisk in-memory-backend (mock-backend.js)
  // for to-bruker-testing uten ekte Supabase. Krever at backenden FAKTISK er
  // lastet: produksjonsbygget inneholder den ikke (build.js), og da skal
  // `?mock=1` ikke kunne vri appen ut av vanlig modus i det hele tatt.
  function useMock() { return !!window.HK_MOCK && /[?&]mock=1/.test(location.search); }

  let authUser = null;         // innlogget bruker { id, email, meta } | null
  let aclient = null;          // backend-klient (Supabase eller mock)
  function acli() {
    if (aclient) return aclient;
    if (useMock()) { aclient = window.HK_MOCK.createClient(); return aclient; }
    aclient = ensureClient();
    return aclient;
  }

  /* ---------------- Aktiv posisjon (område/mappe) på kontoen ----------------
     Hvilket område og hvilken mappe man står i huskes på selve brukerkontoen
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
    if (!authUser || applyingRemote || !navRestored) return;
    if (demoActive) return; // demoens posisjon er en kulisse, ikke brukerens
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
  // Sett aktivt område/mappe fra kontoens husket posisjon (hvis den fremdeles
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
    login:    { title: 'auth.login',    submit: 'auth.login',        pass: true,  icon: 'login' },
    register: { title: 'auth.register', submit: 'auth.createAccount', pass: true,  icon: 'profile' },
    forgot:   { title: 'auth.forgot',   submit: 'auth.sendLink',     pass: false, icon: 'lock' },
  };
  // Melding som skal bli STÅENDE på innloggingssiden etter at appen selv har
  // logget ut (kontosletting). Å sette den etter `logout()` holder ikke:
  // utloggingen gir TO runder med `setAuthMode('login')` — én synkron og én fra
  // `SIGNED_OUT`-hendelsen — og hver av dem tømmer meldingsfeltet. Den males
  // derfor av `setAuthMode` helt til brukeren selv gjør noe på skjermen.
  let authNotice = null;
  function setAuthMode(mode) {
    authModeCur = mode;
    const m = AUTH_MODES[mode];
    authHeading.textContent = tr(m.title);
    authHeadingIcon.innerHTML = ICONS[m.icon];
    authSubmit.textContent = tr(m.submit);
    authPassField.hidden = !m.pass;
    authPassword.required = m.pass;
    // Navnefeltene (fornavn/etternavn) vises kun ved registrering.
    const reg = mode === 'register';
    authNameFields.hidden = !reg;
    authFirstName.required = reg;
    authLastName.required = reg;
    authPassword.autocomplete = mode === 'register' ? 'new-password' : 'current-password';
    authMsg(authNotice || '', !!authNotice);
    authForm.hidden = false;
    authSent.hidden = true;
    // Lenkene bytter ut fra modus.
    authLinks.innerHTML = '';
    const link = (label, target) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'auth-link'; b.dataset.mode = target; b.textContent = label;
      // Brukeren tar over skjermen → beskjeden fra forrige økt har gjort sitt.
      b.addEventListener('click', () => { authNotice = null; setAuthMode(target); });
      authLinks.appendChild(b);
    };
    if (mode === 'login') { link(tr('auth.toRegister'), 'register'); link(tr('auth.toForgot'), 'forgot'); }
    else if (mode === 'register') { link(tr('auth.toLogin'), 'login'); }
    else { link(tr('auth.backToLogin'), 'login'); }
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
  /* ---------------- Vis passordet mens du skriver ----------------
     Hvert passordfelt har en øye-knapp inni seg (`data-pass-toggle="<felt-id>"`)
     som bytter input-typen mellom `password` og `text`. Ikonet er øyet i hvile
     og øyet med strek når passordet vises. Delt av auth-skjermen og
     konto-modalens passordbytte. */
  function paintPassToggle(btn, shown) {
    btn.innerHTML = shown ? ICONS.eyeOff : ICONS.eye;
    btn.setAttribute('aria-pressed', shown ? 'true' : 'false');
    const label = tr(shown ? 'auth.hidePassword' : 'auth.showPassword');
    btn.title = label;
    btn.setAttribute('aria-label', label);
  }
  document.querySelectorAll('.pass-toggle').forEach((btn) => {
    const input = document.getElementById(btn.dataset.passToggle);
    paintPassToggle(btn, false);
    btn.addEventListener('click', () => {
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      paintPassToggle(btn, show);
      input.focus();
    });
  });
  // Tøm passordfelt og skjul dem igjen (konto-modalen åpnes, endring lagret,
  // utlogging) — et skrevet passord skal ikke bli stående synlig i DOM-en.
  function clearPassFields(inputs) {
    inputs.forEach((el) => {
      el.value = '';
      el.type = 'password';
      const btn = document.querySelector('.pass-toggle[data-pass-toggle="' + el.id + '"]');
      if (btn) paintPassToggle(btn, false);
    });
  }

  /* ---------------- Betrodd app-URL for auth-redirects ----------------
     Supabase Auth trenger en returadresse for bekreftelses-/gjenopprettings-
     lenker (signUp/resetPasswordForEmail/e-postendring). Den kan ALDRI komme
     ukritisk fra location.origin — en gammel fane, et pensjonert domene eller
     en ukjent host ville da endt opp i selve auth-lenken (se historikken i
     docs/domains-and-urls.md). authRedirectUrl() bruker i stedet den sentrale,
     betrodde adressen i window.HUSKIS_CONFIG; kun den lokale utviklings-
     serveren beholder sin egen origin.
     `origin`-parameteren finnes kun for testing — appen kaller alltid uten
     den, og bruker da location.origin. Se docs/domains-and-urls.md. */
  function canonicalAppUrl() {
    const raw = (window.HUSKIS_CONFIG && window.HUSKIS_CONFIG.canonicalAppUrl) || 'https://huskis.no';
    return raw.replace(/\/+$/, '') + '/';
  }
  /* Den lokale utviklingsserveren, og bare den: http på localhost/127.0.0.1
     MED et eksplisitt portnummer (`python3 -m http.server 8000`). Mobilappen
     serverer de samme filene fra `https://localhost` — uten port, fra
     WebView-ens egen innebygde server (docs/mobilapp-plan.md). Det er ikke en
     utviklingsserver: en bekreftelses- eller gjenopprettingslenke dit ville
     pekt på en adresse som ikke finnes utenfor appen. Fail closed — alt annet
     enn den ene formen får den kanoniske adressen. */
  function isLocalDevOrigin(origin) {
    return /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin);
  }
  function authRedirectUrl(origin) {
    const o = (origin != null ? origin : location.origin).replace(/\/+$/, '');
    return isLocalDevOrigin(o) ? o + '/' : canonicalAppUrl();
  }

  function friendlyAuthError(err) {
    const msg = (err && err.message) || String(err || tr('error.generic'));
    if (/invalid login credentials/i.test(msg)) return tr('error.badCredentials');
    if (/email not confirmed/i.test(msg)) return tr('error.emailNotConfirmed');
    if (/already registered|already exists|user already/i.test(msg)) return tr('error.emailTaken');
    if (/password should be at least|weak password/i.test(msg)) return tr('error.passwordTooShort');
    if (/should be different from the old password/i.test(msg)) return tr('error.passwordSameAsOld');
    if (/rate limit|too many/i.test(msg)) return tr('error.rateLimited');
    return msg;
  }

  authForm && authForm.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const client = acli();
    if (!client) { authMsg(tr('auth.unavailable')); return; }
    const email = authEmail.value.trim().toLowerCase();
    const password = authPassword.value;
    if (!email) { authMsg(tr('auth.enterEmail')); return; }
    authSubmit.disabled = true;
    authNotice = null; // brukeren er i gang selv — beskjeden har gjort sitt
    authMsg('');
    try {
      if (authModeCur === 'login') {
        const { error } = await client.auth.signInWithPassword({ email, password });
        if (error) throw error;
        // onAuthStateChange starter appen.
      } else if (authModeCur === 'register') {
        const firstName = authFirstName.value.trim();
        const lastName = authLastName.value.trim();
        if (!firstName || !lastName) { authMsg(tr('auth.enterFullName')); return; }
        const displayName = firstName + ' ' + lastName;
        const { data, error } = await client.auth.signUp({
          email, password,
          options: {
            emailRedirectTo: authRedirectUrl(),
            data: { display_name: displayName },
          },
        });
        if (error) throw error;
        if (data && data.session) {
          // Bekreftelse er av → onAuthStateChange logger inn direkte.
        } else {
          showAuthSent(tr('auth.sentConfirm', { email: '<strong>' + escapeHtml(email) + '</strong>' }));
        }
      } else if (authModeCur === 'forgot') {
        const { error } = await client.auth.resetPasswordForEmail(email, {
          redirectTo: authRedirectUrl(),
        });
        if (error) throw error;
        showAuthSent(tr('auth.sentReset', { email: '<strong>' + escapeHtml(email) + '</strong>' }));
      }
    } catch (e) {
      authMsg(friendlyAuthError(e));
    } finally {
      authSubmit.disabled = false;
    }
  });
  authSentBack && authSentBack.addEventListener('click', () => setAuthMode('login'));

  async function handleRecovery() {
    const np = prompt(tr('auth.chooseNewPassword'));
    if (!np || np.length < 6) { showToast(tr('error.passwordTooShortShort')); return; }
    try {
      const { error } = await acli().auth.updateUser({ password: np });
      if (error) throw error;
      showToast(tr('account.passwordUpdatedShort'));
    } catch (e) { showToast(friendlyAuthError(e)); }
  }

  /* ---------------- Rolle- og capability-metadata på state-objektene ----------------
     Hvert nested objekt får (utenfor synk-doc'et): _type/_parent/_creator/
     _locked/_unlocked/_shared/_caps. Områder og mapper får i tillegg _role
     ('owner' | 'member' | null) og — for områder og FRIE mapper — en
     PERSONLIG posisjon i `.pos`, mens den kanoniske ligger i `_canon`.

     Myndighet kommer utelukkende fra ROLLER. `_creator` (objektets `owner_id`)
     er ren historikk og gir ingenting. Serverens `_caps` er autoritative;
     funksjonene under er lokale anslag for umiddelbar, optimistisk visning. */

  // Den virtuelle beholderen for «Mapper delt med meg»: mapper man har en
  // DIREKTE rolle i, men ingen rolle i det kanoniske området. Den er ikke et
  // ekte område — den pushes aldri, og har ingen delings-/opprettelseskontroller.
  const FREE_UNI_ID = '__free__';
  // Hvilken av de tre seksjonene et toppnivå-objekt hører til.
  const SECTION_OWNED = 0, SECTION_SHARED = 1, SECTION_FREE = 2;
  const sectionRank = (u) => (u._virtual ? SECTION_FREE
    : (u._role === 'owner' ? SECTION_OWNED : SECTION_SHARED));
  // Brukervendte tekster som gjenbrukes i flere visninger.
  const S_TEXT = {
    get freeSection() { return tr('section.freeGroups'); },
    get sections() {
      return [tr('section.mine'), tr('section.sharedUniverses'), tr('section.sharedGroups')];
    },
  };

  function effTrashed(o) { return !!(o && o.trashed); }

  // Nærmeste forfar (eller objektet selv) av en gitt type.
  function nodeOfType(o, type) {
    let n = o;
    while (n && n._type !== type) n = n._parent;
    return n && !n._virtual ? n : null;
  }
  // Er JEG eier på nivået som styrer objektet? Områdeeier for et område;
  // mappeeier (eksplisitt ELLER områdeeier) for mappe/liste/listepunkt.
  // Privilegerte påvirkes aldri av en lås for egen redigering. Lokalt anslag —
  // serverens `_caps` er autoritative.
  function privilegedLocal(o) {
    if (!o) return false;
    if (o._type === 'universe') return o._role === 'owner';
    const g = nodeOfType(o, 'group');
    if (g && g._role === 'owner') return true;
    const u = nodeOfType(o, 'universe');
    return !!(u && u._role === 'owner');
  }
  // Frosset = redigering er sperret for MEG. Nærmeste eksplisitte tilstand
  // oppover avgjør: et unntak (_unlocked) åpner grenen, en lås (_locked) fryser
  // den. Eiere på nivået omgår låsen helt.
  function frozen(o) {
    if (privilegedLocal(o)) return false;
    let n = o;
    while (n && !n._virtual) {
      if (n._unlocked) return false;
      if (n._locked) return true;
      n = n._parent;
    }
    return false;
  }
  // Serverens capability for objektet. Områder og mapper får dem fra
  // get_my_doc; for lokalt nyopprettede objekter (ennå ikke synket) faller vi
  // tilbake på `fallback` — brukeren laget dem nettopp selv.
  function cap(o, name, fallback) {
    const c = o && o._caps;
    if (c && name in c) return !!c[name];
    return fallback !== undefined ? fallback : true;
  }
  // Kan jeg endre MAPPENS innhold — altså opprette lister i den, og omrokkere/
  // flytte listene den inneholder? Den myndigheten ligger på MAPPEN, ikke på
  // lista: `frozen(liste)` svarer bare på om jeg kan redigere lista SELV. Under
  // et lås-unntak («Gjør unntak» på én liste i en låst mappe) spriker de to —
  // lista kan redigeres, men verken få en ny søskenliste eller flytte på seg.
  // Serverens capability er autoritativ (`createList` = `can_create_child` =
  // `can_edit_content` på mappen); mangler den, brukes det lokale låse-anslaget.
  function canAddList(g) { return !!g && cap(g, 'createList', !frozen(g)); }
  // Forfedrene til et objekt, nærmeste først, med type.
  const PARENT_TYPE = { card: 'group', group: 'universe', universe: null };
  function ancestorChain(type, obj) {
    const out = [];
    let t = PARENT_TYPE[type], n = obj && obj._parent;
    while (t && n && !n._virtual) { out.push({ type: t, id: n.id, obj: n }); t = PARENT_TYPE[t]; n = n._parent; }
    return out;
  }
  // Forelderen (m/ type) hvis lås faktisk gjelder for objektet — dvs. arvet
  // låsing. Et unntak (_unlocked) på veien opp bryter arven.
  function inheritedLockInfo(type, obj) {
    const chain = ancestorChain(type, obj);
    for (const a of chain) { if (a.obj._unlocked) return null; if (a.obj._locked) return a; }
    return null;
  }
  const myId = () => authUser && authUser.id;


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
      type, creator: r.creator, createdByMe: r.createdByMe !== false,
      role: r.role || null, free: !!r.free,
      personalPos: r.personalPos, caps: r.caps || null,
      ownerCount: r.ownerCount || 0, memberCount: r.memberCount || 0,
      ownerKey: r.ownerKey == null ? null : r.ownerKey,
      locked: !!r.locked, unlocked: !!r.unlocked, shared: !!r.shared,
      invitePolicy: r.invitePolicy || 'inherit',
    }));
    add(my.universes, 'universe');
    add(my.groups, 'group');
    add(my.cards, 'card');
    add(my.items, 'item');
    return meta;
  }

  /* ---------------- Lokal state → kanonisk innholds-doc (for push) ----------------
     PERSONLIG rekkefølge (områder på toppnivå, frie mapper) ligger på
     medlemskapsraden, ikke på objektet — `.pos` i state er da den personlige
     verdien, og den KANONISKE står i `_canon`. Den kanoniske skrives tilbake
     uendret, så en personlig omrokkering aldri kan endre hva andre ser. */
  function canonRow(o, type) {
    if (o._canon) {
      const c = o._canon;
      const base = {
        id: o.id, ts: o.ts || 0, org: o.org || '',
        trashed: !!o.trashed, pos: c.pos || 0, posTs: c.posTs || 0, posOrg: c.posOrg || '',
      };
      if (type === 'universe') return Object.assign(base, { name: o.name, collapsed: !!o.collapsed });
      // En FRI mappe (delt direkte med meg) har sin kanoniske plassering i et
      // område jeg ikke ser — den skrives tilbake uendret.
      if (type === 'group') return Object.assign(base, {
        name: o.name, uni: c.parent, cat: c.cat || null, isCat: !!o.isCat, collapsed: !!o.collapsed,
      });
    }
    if (type === 'universe') return cleanUniverse(o);
    if (type === 'group') {
      const r = cleanGroup(o);
      // En mappe som venter på move_group beholder sin GAMLE forelder i doc-et:
      // `groups.universe_id` kan ikke skrives direkte (databasen avviser det),
      // og RPC-en eier plasseringen til den har landet.
      const mv = pendingGroupMoves.get(o.id);
      if (mv) { r.uni = mv.fromUni; r.cat = mv.fromCat; r.pos = mv.fromPos; }
      return r;
    }
    if (type === 'card') return cleanCard(o);
    return cleanItem(o, o.home);
  }
  function docFromMyState() {
    // canonRow(o, type) ignorerer parent-argumentet flattenNested sender med;
    // element-grenen gir cleanItem(it, it.home) som før.
    // pruneDanglingCats: en `cat` som ikke treffer en kategori er uskrivbar
    // (FK) og ville låst synken — se kommentaren der.
    return pruneDanglingCats(flattenNested(state, canonRow));
  }
  // Rader den cachede staten sier er opprettet av NOEN ANDRE (`_createdByMe ===
  // false`). Forsvinner en slik rad fra serveren, er tilgangen opphørt eller
  // objektet slettet — begge veier skal vi la den gå, aldri sette den inn på nytt
  // (`insertPayload` ville satt OSS som oppretter, altså gjort en gammel kopi av
  // andres innhold til vår).
  // Listepunkter er utelatt med vilje: et listepunkt man selv har laget i en
  // delt liste er reelt sett ens eget.
  function foreignIds() {
    const s = new Set();
    state.universes.forEach((u) => {
      if (u._virtual) return;
      if (u._createdByMe === false) s.add(u.id);
      (u.groups || []).forEach((g) => {
        if (g._createdByMe === false) s.add(g.id);
        (g.cards || []).forEach((c) => { if (c._createdByMe === false) s.add(c.id); });
      });
    });
    return s;
  }

  /* ---------------- 3-veis fletting (base/lokal/fjern) → merged + push-ops ----------------
     base = forrige serverkjente doc. For hver rad:
       gravlagt (uansett)  → aldri i merged; ligger den på serveren, push delete
       lokal & fjern       → felt-LWW; push oppdatering hvis vår vant på et register
       lokal, !fjern, base → fjern-slettet → droppes
       lokal, !fjern, !base → lokalt ny → beholdes + push insert
                              … MEN ukjent historikk holdes tilbake (se `unknown`)
       !lokal, fjern, base → lokalt slettet → droppes + push delete
       !lokal, fjern, !base → fjern-ny → legges til
     Innhold-LWW gjenbruker merge*Scalar/mergeItem fra synk v1.

     `opts`:
       • `tombs`      — gravlagte id-er (state._tomb + det serveren har bekreftet).
       • `unknown`    — id-er med UKJENT HISTORIKK: radene som ble lest fra en
                        lokal cache uten gyldig synk-base. For dem er «finnes
                        lokalt, ikke på serveren» tvetydig — de kan være laget her
                        offline, eller slettet på en annen enhet. Det var nettopp
                        den forvekslingen som lot en utdatert cache gjenopplive
                        slettede objekter: uten base ble ALT lokalt lest som
                        «laget her nå» og pushet som insert. Slike rader samles i
                        `unverified` i stedet — de blir stående lokalt, men
                        skrives ikke før de er sjekket mot serverens gravsteiner
                        (cloudCycle). Alt som er laget ETTER cachen ble lest, er
                        utvilsomt nytt og skrives som før.
       • `foreign`    — id-er som ALDRI skal gjenskapes: rader cachen sier
                        er opprettet av noen andre. Er en slik rad
                        borte fra serveren, er delingen opphørt eller objektet
                        slettet; å sette den inn igjen ville gjort OSS til
                        oppretter av andres innhold. Hvem som havner i settet
                        bestemmes av kalleren (cloudCycle) — se der. */
  const NO_IDS = new Set();
  function emptyDoc() { return { universes: [], groups: [], cards: [], items: [] }; }
  function reconcile(base, local, remote, opts) {
    opts = opts || {};
    const tombs = opts.tombs || NO_IDS;
    const foreign = opts.foreign || NO_IDS;
    const unknown = opts.unknown || NO_IDS;
    const merged = { universes: [], groups: [], cards: [], items: [] };
    const ops = [];
    const unverified = [];
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
        // GRAVLAGT: permanent slettet er endelig. Raden skal verken settes inn
        // igjen eller vises — og ligger den fortsatt på serveren (slettingen
        // rakk aldri fram, eller basen gikk tapt før den ble pushet), fullfører
        // vi den nå i stedet for å la fjern-raden gjenopplive den lokalt.
        if (tombs.has(id)) { if (R) ops.push({ op: 'delete', t, id }); return; }
        if (L && R) {
          const m = merge(L, R);
          merged[key].push(m);
          if (canonical(m) !== canonical(R)) ops.push({ op: 'update', t, row: m });
        } else if (L && !R) {
          if (B) return;                 // fjern-slettet → dropp (ingen op)
          if (foreign.has(id)) return;   // andres rad, borte fra serveren → aldri gjenskap som vår
          if (!unknown.has(id)) { merged[key].push(L); ops.push({ op: 'insert', t, row: L }); return; }
          merged[key].push(L);           // ukjent historikk: behold synlig, men ikke skriv
          unverified.push({ t, id });
        } else if (!L && R) {
          if (B) ops.push({ op: 'delete', t, id });
          else merged[key].push(R);
        }
      });
    });
    return { merged, ops, unverified };
  }

  /* ---------------- merged (kanonisk) + metadata → nested state ----------------
     Tre seksjoner (se docs/rettigheter-og-deling.md):
       1. «Mine områder»          — rolle 'owner'
       2. «Områder delt med meg»  — rolle 'member'
       3. «Mapper delt med meg»    — mapper med DIREKTE rolle og ingen rolle i
                                      det kanoniske området (`free`). De samles
                                      i én VIRTUELL beholder som aldri pushes.
     Områder og frie mapper ordnes PERSONLIG: `.pos` er medlemskapsradens
     posisjon, den kanoniske ligger i `_canon` (skrives tilbake uendret). */
  function applyMyDoc(doc, meta) {
    applyingRemote = true;
    try {
      const attachMeta = (obj, id, type, canonParent, canonCat) => {
        const m = meta.get(id);
        obj._type = type;
        obj._creator = m ? m.creator : (authUser && authUser.id);
        obj._createdByMe = m ? m.createdByMe !== false : true;
        obj._role = m ? (m.role || null) : (type === 'universe' || type === 'group' ? 'owner' : null);
        // Optimistiske overlays: en køet set_locked/-policy-skriving skal ikke
        // visuelt «hoppe tilbake» hvis en pull rekker å kjøre før den lander.
        obj._locked = lockOverrides.has(id) ? !!lockOverrides.get(id) : (m ? m.locked : false);
        obj._unlocked = unlockOverrides.has(id) ? !!unlockOverrides.get(id) : (m ? m.unlocked : false);
        obj._invitePolicy = policyOverrides.has(id) ? policyOverrides.get(id) : (m && m.invitePolicy ? m.invitePolicy : 'inherit');
        obj._shared = m ? m.shared : false;
        obj._memberCount = m ? m.memberCount : 1;
        obj._ownerCount = m ? m.ownerCount : 1;
        obj._ownerKey = m ? m.ownerKey : null;
        obj._caps = m && m.caps ? m.caps : null;
        obj._free = !!(m && m.free);
        // Personlig posisjon (områder + frie mapper): den kanoniske tas vare
        // på i _canon, og `.pos` blir brukerens egen.
        const personal = m && m.personalPos != null &&
          (type === 'universe' || (type === 'group' && m.free));
        if (personal) {
          obj._canon = { parent: canonParent, cat: canonCat, pos: obj.pos, posTs: obj.posTs, posOrg: obj.posOrg };
          obj.pos = posOverrides.has(id) ? posOverrides.get(id) : (m.personalPos || 0);
        }
      };

      const universes = (doc.universes || []).map((u) => Object.assign(cleanUniverse(u), { groups: [] }));
      universes.forEach((u) => attachMeta(u, u.id, 'universe', null, null));
      const uById = new Map(universes.map((u) => [u.id, u]));

      // Den virtuelle beholderen for direkte delte mapper. Opprettes bare når
      // det finnes slike mapper, og legges alltid sist (egen seksjon i UI-et).
      let freeUni = null;
      const ensureFreeUni = () => {
        if (freeUni) return freeUni;
        freeUni = {
          id: FREE_UNI_ID, name: S_TEXT.freeSection, groups: [], pos: Infinity,
          _virtual: true, _type: 'universe', _role: null, _caps: {},
          _shared: false, _locked: false, _unlocked: false, _createdByMe: false,
        };
        universes.push(freeUni);
        return freeUni;
      };

      const gById = new Map();
      (doc.groups || []).forEach((raw) => {
        const g = Object.assign(cleanGroup(raw), { cards: [] });
        const m = meta.get(g.id);
        const mv = pendingGroupMoves.get(g.id);
        attachMeta(g, g.id, 'group', g.uni, g.cat);
        // En mappe som venter på move_group vises OPTIMISTISK der brukeren slapp
        // den, selv om serveren fortsatt svarer med den gamle plasseringen.
        if (mv) { g.uni = mv.toUni; g.cat = mv.toCat; g.pos = mv.toPos; g._free = false; }
        const parent = g._free ? ensureFreeUni() : (g.uni != null ? uById.get(g.uni) : null);
        if (!parent) return; // foreldreløs (kanonisk område ikke lesbart og ikke fri)
        if (g._free) g.cat = null;   // fri seksjon har ingen mappekategorier
        g._parent = parent;
        gById.set(g.id, g);
        parent.groups.push(g);
      });

      const cById = new Map();
      (doc.cards || []).forEach((raw) => {
        const c = Object.assign(cleanCard(raw), { items: [] });
        attachMeta(c, c.id, 'card', c.group, null);
        const parent = c.group != null ? gById.get(c.group) : null;
        if (!parent) return;
        c._parent = parent;
        cById.set(c.id, c);
        parent.cards.push(c);
      });

      (doc.items || []).forEach((raw) => {
        const it = cleanItem(raw, raw.home);
        const parent = cById.get(it.home);
        if (parent) { it._parent = parent; it._type = 'item'; parent.items.push(it); }
      });

      // Seksjonsrekkefølge først, personlig posisjon innenfor hver seksjon.
      universes.sort((a, b) => (sectionRank(a) - sectionRank(b)) || posCmp(a, b));
      universes.forEach((u) => {
        u.groups.sort(posCmp);
        u.groups.forEach((g) => { g.cards.sort(posCmp); g.cards.forEach((c) => c.items.sort(posCmp)); });
      });

      // Tap av tilgang (slettet, flyttet, kastet ut, rollen endret): naviger ut
      // av den ugyldige visningen i stedet for å la en gammel lokal kopi bli
      // stående redigerbar.
      const hadGroup = state.activeGroup && !!findGroupAnywhere(state.activeGroup);
      const hadUni = state.activeUniverse && !!findUniverse(state.activeUniverse);
      state.universes = universes;
      state._hlc = doc.hlc || state._hlc || 0;
      observeTs(doc.hlc);
      const lostGroup = hadGroup && state.activeGroup && !findGroupAnywhere(state.activeGroup);
      const lostUni = hadUni && state.activeUniverse && !findUniverse(state.activeUniverse);
      validateActive(state);
      if (lostGroup || lostUni) noteAccessLoss(lostGroup ? 'group' : 'universe');
      // Første pull etter innlogging: land på posisjonen kontoen husker.
      if (!navRestored) { navRestored = true; restoreNavPref(); }
      reapplyPendingDeletes(); // hold buffer-slettede skjult etter rebuild
      render();
    } finally {
      applyingRemote = false;
    }
  }

  /* ---------------- Tap av tilgang ----------------
     Objektet man står i kan forsvinne under føttene: det ble slettet for alle,
     flyttet til et annet eierskapsdomene, eller man ble kastet ut / degradert.
     Da lukkes visningen (og enhver åpen modal som peker på det), vi lander på
     nærmeste gyldige fallback (validateActive), og sier nøkternt fra. */
  function noteAccessLoss(kind) {
    if (!shareModal.hidden) closeShare();
    closeObjMenu();
    closeResponsible();
    showToast(tr(kind === 'group' ? 'access.lostGroup' : 'access.lostUniverse'));
  }

  /* ---------------- Push: rad-CRUD mot tabellene ---------------- */
  const TABLE = { universe: 'universes', group: 'groups', card: 'cards', item: 'items' };
  function insertPayload(t, row, uid) {
    const base = { id: row.id, owner_id: uid, trashed: !!row.trashed,
      ts: row.ts || 0, org: row.org || '', pos: row.pos || 0, pos_ts: row.posTs || 0, pos_org: row.posOrg || '' };
    if (t === 'universe') return Object.assign(base, { name: row.name || '', collapsed: !!row.collapsed });
    if (t === 'group') return Object.assign(base, { name: row.name || '', universe_id: row.uni,
      cat_id: row.cat || null, is_cat: !!row.isCat, collapsed: !!row.collapsed });
    if (t === 'card') return Object.assign(base, { title: row.title || '', group_id: row.group,
      k: row.k !== false, p: row.p !== false, lab_ts: row.labTs || 0, lab_org: row.labOrg || '',
      responsible: row.responsible || null,
      start_at: row.start || null, due_at: row.due || null, lock_times: !!row.lockTimes,
      collapsed: !!row.collapsed });
    return Object.assign(base, { text: row.text || '', card_id: row.home, cat_id: row.cat || null,
      is_cat: !!row.isCat, lock_times: !!row.lockTimes, done: !!row.done, collapsed: !!row.collapsed,
      responsible: row.responsible || null,
      start_at: row.start || null, due_at: row.due || null });
  }
  function updatePayload(t, row) {
    const base = { trashed: !!row.trashed, ts: row.ts || 0, org: row.org || '',
      pos: row.pos || 0, pos_ts: row.posTs || 0, pos_org: row.posOrg || '' };
    if (t === 'universe') return Object.assign(base, { name: row.name || '', collapsed: !!row.collapsed });
    if (t === 'group') return Object.assign(base, { name: row.name || '', universe_id: row.uni,
      cat_id: row.cat || null, is_cat: !!row.isCat, collapsed: !!row.collapsed });
    if (t === 'card') return Object.assign(base, { title: row.title || '', group_id: row.group,
      k: row.k !== false, p: row.p !== false, lab_ts: row.labTs || 0, lab_org: row.labOrg || '',
      responsible: row.responsible || null,
      start_at: row.start || null, due_at: row.due || null, lock_times: !!row.lockTimes,
      collapsed: !!row.collapsed });
    return Object.assign(base, { text: row.text || '', card_id: row.home, cat_id: row.cat || null,
      is_cat: !!row.isCat, lock_times: !!row.lockTimes, done: !!row.done, collapsed: !!row.collapsed,
      responsible: row.responsible || null,
      start_at: row.start || null, due_at: row.due || null });
  }
  /* ---------------- Synk-skrivefeil: overflate skjema-avvik ----------------
     Supabase-klienten KASTER ikke på en avvist skriving — feilen kommer i
     result.error (try/catch her fanger bare nettverksfeil). De aller fleste
     feilene skal forbli stille: RLS-avvisninger (en mottaker prøver å skrive på
     eierens rad) og transiente konflikter/FK er forventet og selv-legende. Men
     et SKJEMA-avvik — appen sender en kolonne databasen ikke har fordi en
     migrering henger etter deployen — får PostgREST til å avvise HVER insert/
     update for den radtypen, usynlig. Det stoppet all synk for lister/
     listepunkter uten ett eneste signal (nettopp cards/items.collapsed-
     hendelsen). Vi overflater derfor KUN den klassen: logg detaljene
     (deduplisert per tabell+kolonne) i konsollen, og meld tabellen inn som en
     AVVISNING i lagringsstatusen — der blir den stående til serveren faktisk
     har tatt imot en skriving på den tabellen. Ingen toast: et skjema-avvik er
     en tilstand, ikke en hendelse, og skal ikke kunne rulle forbi. */
  const schemaMismatchLogged = new Set();
  function isSchemaMismatch(error) {
    if (!error) return false;
    const code = String(error.code || '');
    if (code === 'PGRST204' || code === 'PGRST205' || code === '42703') return true; // ukjent kolonne/tabell
    return /could not find the .*column|schema cache|column .* does not exist/i.test(String(error.message || ''));
  }
  /* Insert-vakten i databasen avviser en id som har gravstein (permanent
     slettet). Det er ikke en feil å varsle om — det er serveren som forteller
     oss noe vi ikke visste: raden er borte for godt. Vi gravlegger den lokalt
     også, så fletteren aldri prøver igjen. Siste forsvarslag: det fanger både
     en klient som ikke rakk å hente gravsteinen, og kappløpet der en annen
     enhet sletter i samme øyeblikk som vi skriver. */
  function isTombstoneReject(error) {
    if (!error) return false;
    return String(error.code || '') === 'PT409' || /\bgravlagt\b/i.test(String(error.message || ''));
  }
  /* En skriving som avvises om og om igjen med SAMME feil er ikke transient —
     den kommer aldri til å lande av seg selv. Vi teller per (tabell, rad, kode)
     og melder raden inn i lagringsstatusen når terskelen er nådd, slik at en
     gift op ikke lenger kan blokkere synken i det stille (se
     PERSISTENT_REJECTS-kommentaren i pushOps). Telleren OG statusoppføringen
     nullstilles så snart raden går gjennom, så en forbigående konflikt verken
     når terskelen eller blir stående. */
  const PERSISTENT_REJECTS = 3;
  const rejectCounts = new Map();
  const rejectKey = (t, id) => t + ':' + id;
  const schemaKey = (t) => 'schema:' + t;
  function noteReject(t, id, error) {
    const key = rejectKey(t, id);
    const n = (rejectCounts.get(key) || 0) + 1;
    rejectCounts.set(key, n);
    if (n !== PERSISTENT_REJECTS) return;
    console.error('[huskis] Synk avvist gjentatte ganger (tabell «' + (TABLE[t] || t) +
      '», rad ' + id + '). Endringen ligger lokalt, men serveren nekter å ta imot den.', error);
    syncStatus.noteRejected(key, {
      kind: 'reject', table: TABLE[t] || t, id,
      code: (error && error.code) || '', message: (error && error.message) || '',
    });
  }
  function reportWriteResult(t, res, id) {
    const error = res && res.error;
    if (!error) {
      // Kvittering fra serveren: nettopp denne raden — og tabellen, som altså
      // ikke mangler kolonnen lenger — er ikke avvist. Dette er den ene
      // verifiserte måten en avvisning forsvinner på (den andre er en synk-
      // runde helt uten divergens, se cloudCycle).
      if (id) { rejectCounts.delete(rejectKey(t, id)); syncStatus.clearRejected(rejectKey(t, id)); }
      syncStatus.clearRejected(schemaKey(t));
      return true;
    }
    if (isSchemaMismatch(error)) {
      const sig = t + ':' + (error.code || '') + ':' + (error.message || '');
      if (!schemaMismatchLogged.has(sig)) {
        schemaMismatchLogged.add(sig);
        console.error('[huskis] Synk avvist – databasen mangler en kolonne appen sender (tabell «' +
          (TABLE[t] || t) + '»). Kjør «Supabase DB-oppsett»-migreringen.', error);
      }
      syncStatus.noteRejected(schemaKey(t), {
        kind: 'schema', table: TABLE[t] || t,
        code: error.code || '', message: error.message || '',
      });
    } else if (id) {
      noteReject(t, id, error); // RLS/FK/konflikt: stille til den gjentar seg
    }
    return false;
  }
  /* ---------------- Kategori-referanser: rekkefølge + selvheling ----------------
     `items.cat_id`/`groups.cat_id` er fremmednøkler til SIN EGEN tabell, så en
     rad kan ikke skrives før kategorien den peker på finnes på serveren. To ting
     må derfor stemme, og begge har brutt synken i praksis:

       1. REKKEFØLGE. `pushOps` sorterte bare på radtype, og en kategori og
          medlemmene er samme type. Lå medlemmet først i state-arrayen ble det
          sendt først → FK-brudd.
       2. HENGENDE PEKER. Peker `cat` på en kategori som ikke finnes i doc-en i
          det hele tatt (f.eks. slettet på en annen enhet mens medlemmet levde
          videre her), er raden umulig å skrive — for alltid.

     (2) er det farlige: den avviste op-en regenereres hver runde, og
     `cloudCycle` planla en ny runde etter hver push → en varm løkke som hamret
     get_my_doc + den samme 409-en ~1 gang i sekundet uten et eneste signal.
     Vi løser (1) ved å sende kategoriene først og (2) ved å sende `cat: null`
     når kategorien ikke finnes: raden lander på nivå 1 i lista si, synlig og
     flyttbar, i stedet for å bli borte i en usynlig retry-løkke. */
  // Nuller `cat`-pekere som ikke treffer en kategori i doc-en. Kjøres på VÅR
  // side av flettingen (docFromMyState), ikke bare på payloaden: gjorde vi det
  // bare i payloaden, ville lokal state fortsatt påstå den døde kategorien,
  // fletteren ville sett en forskjell mot serveren hver runde og sendt den
  // samme oppdateringen i det uendelige. Visningen behandler allerede en
  // hengende `cat` som nivå 1, så dette er å skrive ned det brukeren ser.
  function pruneDanglingCats(doc) {
    ['items', 'groups'].forEach((key) => {
      const rows = doc[key] || [];
      const cats = new Set(rows.filter((r) => r.isCat).map((r) => r.id));
      rows.forEach((r) => { if (r.cat && !cats.has(r.cat)) r.cat = null; });
    });
    return doc;
  }
  /* Returnerer `{ rejected, netFailed }`: hvor mange ops som ikke landet, og om
     minst én av dem feilet fordi kallet ALDRI kom fram. De to må skilles av
     runden som kaller: en avvist skriving betyr at vi er tilkoblet, en skriving
     som aldri kom fram betyr det motsatte. `netFailed` er en boolsk verdi og
     ikke en teller med vilje — en runde der ti rader ikke kom fram er ÉN
     nettverksfeil, ikke ti, ellers ville terskelen på to blitt meningsløs. */
  async function pushOps(ops) {
    const client = acli();
    if (!client || !authUser) return { rejected: 0, netFailed: false };
    const uid = authUser.id;
    const order = { universe: 0, group: 1, card: 2, item: 3 };
    // Ovenfra-ned (foreldre først) på type, og INNEN en type: kategorier før
    // medlemmene sine. Kategorier nøstes aldri, så ett nivå er nok.
    const byParentFirst = (a, b) => (order[a.t] - order[b.t]) ||
      ((b.row.isCat ? 1 : 0) - (a.row.isCat ? 1 : 0));
    const ins = ops.filter((o) => o.op === 'insert').sort(byParentFirst);
    const upd = ops.filter((o) => o.op === 'update').sort(byParentFirst);
    const del = ops.filter((o) => o.op === 'delete').sort((a, b) => order[b.t] - order[a.t]);
    let failed = 0;
    let netFailed = false;
    let tombed = false;
    // Et kall som kastet er transport, ikke svar: skill det fra en avvisning.
    const noteThrow = (e) => { failed++; if (isNetworkError(e)) netFailed = true; };
    for (const o of ins) {
      try {
        const res = await client.from(TABLE[o.t]).insert(insertPayload(o.t, o.row, uid));
        // Avvist fordi id-en er gravlagt: serveren har rett, og saken er
        // avgjort. Gravlegg den lokalt også (raden forsvinner fra fletteren og
        // dermed fra visningen ved neste applyMyDoc) og regn IKKE dette som en
        // feilet skriving — da hadde bekreftelses-pullen uteblitt og raden blitt
        // hengende til neste poll.
        if (res && res.error && isTombstoneReject(res.error)) {
          tombFromServer(o.t, o.row.id);
          tombed = true;
          continue;
        }
        if (!reportWriteResult(o.t, res, o.row.id)) failed++;
      } catch (e) { noteThrow(e); /* nettverk – poll/realtime prøver igjen */ }
    }
    if (tombed) saveLocal();
    for (const o of upd) {
      try {
        if (!reportWriteResult(o.t, await client.from(TABLE[o.t]).update(updatePayload(o.t, o.row)).eq('id', o.row.id), o.row.id)) failed++;
      } catch (e) { noteThrow(e); /* nettverk */ }
    }
    for (const o of del) {
      try {
        if (!reportWriteResult(o.t, await client.from(TABLE[o.t]).delete().eq('id', o.id), o.id)) failed++;
      } catch (e) { noteThrow(e); /* nettverk */ }
    }
    return { rejected: failed, netFailed };
  }

  /* ---------------- Nådde vi serveren i det hele tatt? ----------------
     En skriving som ALDRI kom fram (frakoblet, tapt forbindelse) er noe helt
     annet enn en serveren tok imot og sa nei til: den første skal prøves igjen
     til den lykkes, den andre skal fortelles om. Klassifiseringen deles av
     operasjonskøen og synk-runden, så begge melder det samme til statuslinjen. */
  function isNetworkError(e) {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
    const m = String((e && e.message) || e || '');
    return /failed to fetch|networkerror|network request failed|load failed|fetch failed/i.test(m);
  }

  /* ---------------- Lagringsstatus ----------------
     Én diskret, VEDVARENDE status i stedet for forbigående synk-toaster. Den
     leses av den faktiske operasjonstilstanden — ingen egen «tror vi er
     lagret»-variabel som kan komme i utakt med virkeligheten:

       • VENTENDE  (`pending`): en debouncet cache-skriving som bærer BRUKERENS
         endringer (`cacheDirty` — synkens egne skrivinger til den samme
         bufferen er bokføring på vei ned fra serveren, ikke ventende arbeid),
         en operasjon i `opQueue`, eller lokale endringer serveren ikke har
         kvittert for (`saveSeq !== syncedSeq`). Ingen svar fra serveren ennå
         (`!lastMy`) teller også som ventende — vi VET ikke at noe er lagret før
         serveren har sagt det.
       • FRAKOBLET (`offline`): `navigator.onLine === false`, eller
         `OFFLINE_AFTER_FAILURES` kall på rad som aldri nådde fram. Terskelen
         gjør at ett enkelt glipp ikke blinker «Frakoblet» — pollet henter det
         inn igjen. Endringene ligger trygt lokalt, og retryen fortsetter.
       • AVVIST    (`rejected`): en skriving ble sagt nei til. Serverside:
         skjema-avvik (per tabell) og rader som avvises gjentatte ganger (se
         `noteReject`). Lokalt: den debouncede localStorage-skrivingen som
         feiler (full kvote, blokkerte nettsteddata) — da ligger endringene bare
         i minnet, og verken «Lagret» eller «lagres på denne enheten» ville vært
         sant. Ingen av dem forsvinner av seg selv — derfor «Prøv igjen».

     Rekkefølgen er avvist → frakoblet → ventende → lagret: en avvisning er et
     uløst problem selv om vi akkurat nå også er frakoblet, og skal ikke skjules
     av en tilstand som løser seg selv.

     «Lagret» påstås KUN når alle tre er tomme. Avvisninger tømmes aldri på
     antakelse: enten kvitterer serveren for nettopp den raden
     (`reportWriteResult`), eller så finner fletteren ingen divergens igjen —
     altså ligger alt vi har også på serveren (`clearServerRejections` i
     `cloudCycle`). Den lokale bufferens skrivefeil (`kind: 'cache'`) er unntatt
     der: serveren vet ingenting om localStorage, så den ryddes kun av en
     vellykket skriving. Teknikken (tabell, rad, feilkode) går kun til konsollen
     og `__huskis.syncStatus.snapshot()`. */
  const syncStatus = (() => {
    const el = document.getElementById('sync-status');
    const textEl = document.getElementById('sync-status-text');
    const retryBtn = document.getElementById('sync-retry-btn');
    /* De to avvisningene rammer HVER SIN lagringsplass, og teksten må si
       hvilken: en skriving serveren sa nei til nådde aldri kontoen, mens en
       feilet localStorage-skriving kun gjelder denne enheten — synken kan godt
       ha fått endringen fram til kontoen samtidig (se `clearServerRejections`).
       Én felles «kunne ikke lagres på kontoen din» ville løyet i det andre
       tilfellet. */
    const TEXT = {
      get saved() { return tr('sync.saved'); },
      get saving() { return tr('sync.saving'); },
      get offline() { return tr('sync.offline'); },
      get rejected() { return tr('sync.rejected'); },
      get rejectedCache() { return tr('sync.rejectedCache'); },
    };
    const OFFLINE_AFTER_FAILURES = 2; // ett glipp er ikke «frakoblet»
    const QUIET_AFTER_MS = 1000;      // «Lagret» fader ut (kun DEN tilstanden)
    const HEARTBEAT_MS = 1000;        // sikkerhetsnett (maler kun ved endring)
    const RETRY_MAX_MS = 15000;       // «Prøver»-vinduet henger aldri fast

    let netFailures = 0;
    const rejected = new Map(); // nøkkel → { kind, table, id, code, message }
    let retrying = false;
    let retryGuard = null;
    let painted = null;         // sist malte tilstand — DOM røres kun ved endring
    let quietTimer = null;
    let heartbeat = null;

    function offline() {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
      return netFailures >= OFFLINE_AFTER_FAILURES;
    }
    // Ventende arbeid er BRUKERENS endringer som ennå ikke er kvittert — ikke
    // «en synk-runde kjører». Runder kjører hele tiden (poll hvert 5. s, og
    // hver realtime-hendelse fra en annen enhet); teller vi dem, blinker
    // statusen mellom «Lagrer …» og «Lagret» i det uendelige uten at brukeren
    // har gjort noe. `saveSeq !== syncedSeq` fanger uansett enhver lokal
    // endring en runde ikke har fått pushet, som er det påstanden gjelder.
    function pending() {
      if (saveTimer && cacheDirty) return true; // brukerens buffer-skriving venter
      if (opQueue.busy()) return true;          // delings-/lås-/mount-operasjon
      if (!lastMy) return true;                 // ikke ett svar fra serveren ennå
      return saveSeq !== syncedSeq;             // endringer uten kvittering
    }
    function state() {
      if (!authUser) return 'idle';
      // Et forsøk pågår: vis at vi jobber, og la utfallet avgjøre etterpå.
      if (retrying) return 'saving';
      if (rejected.size) return 'rejected';
      if (offline()) return 'offline';
      if (pending()) return 'saving';
      return 'saved';
    }
    // Rammer ALLE avvisningene kun den lokale bufferen? Da er det denne enheten
    // som ikke lagrer, ikke kontoen. Én serverside-avvisning i miksen er det
    // alvorligste, og den teksten vinner.
    function cacheOnly() {
      if (!rejected.size) return false;
      for (const v of rejected.values()) if (v.kind !== 'cache') return false;
      return true;
    }
    function paint() {
      if (!el) return;
      const s = state();
      // Tilstanden («rejected») styrer farge og «Prøv igjen»; nøkkelen velger
      // HVILKEN av de to avvisningstekstene som gjelder — og må derfor være
      // det som sammenlignes, ellers står en gammel tekst igjen.
      const key = s === 'rejected' && cacheOnly() ? 'rejectedCache' : s;
      if (key === painted) return;
      painted = key;
      clearTimeout(quietTimer);
      el.classList.remove('is-quiet');
      if (s === 'idle') { el.hidden = true; return; }
      el.hidden = false;
      el.dataset.state = s;
      el.title = TEXT[key];
      textEl.textContent = TEXT[key];
      retryBtn.hidden = s !== 'rejected';
      if (s === 'saved') quietTimer = setTimeout(() => el.classList.add('is-quiet'), QUIET_AFTER_MS);
    }
    // Serveren svarte (uansett hva den svarte) → vi er ikke frakoblet.
    function noteReachable() { netFailures = 0; paint(); }
    // Kallet nådde aldri fram. Køen/pollet prøver igjen med backoff.
    function noteNetworkFailure() { netFailures++; paint(); }
    function noteRejected(key, detail) { rejected.set(key, Object.assign({ key }, detail)); paint(); }
    function clearRejected(key) { if (rejected.delete(key)) paint(); }
    // Tømmer avvisningene SERVEREN eier. Den lokale bufferens skrivefeil får bli
    // stående: at fletteren ikke finner divergens mot serveren sier ingenting om
    // hvorvidt localStorage tok imot — den ryddes kun av en vellykket skriving.
    function clearServerRejections() {
      let changed = false;
      rejected.forEach((v, k) => { if (v.kind !== 'cache') { rejected.delete(k); changed = true; } });
      if (changed) paint();
    }
    function beginRetry() {
      retrying = true;
      clearTimeout(retryGuard);
      retryGuard = setTimeout(endRetry, RETRY_MAX_MS);
      paint();
    }
    function endRetry() {
      clearTimeout(retryGuard); retryGuard = null;
      if (retrying) { retrying = false; paint(); }
    }
    // Diagnostikk: hele bildet, med teknikken, for konsollen og testene.
    function snapshot() {
      return {
        state: state(), pending: pending(), offline: offline(),
        netFailures, retrying, rejected: [...rejected.values()],
      };
    }
    function start() {
      clearInterval(heartbeat);
      // Hendelsene under dekker det meste, men en tilstand kan også utløpe av
      // seg selv (den debouncede cache-skrivingen fyrer). Hjerteslaget regner
      // ut én kort streng og rører DOM-en kun når den faktisk er endret.
      heartbeat = setInterval(paint, HEARTBEAT_MS);
      paint();
    }
    function stop() {
      clearInterval(heartbeat); heartbeat = null;
      clearTimeout(quietTimer); clearTimeout(retryGuard); retryGuard = null;
      netFailures = 0; rejected.clear(); retrying = false; painted = null;
      if (el) { el.hidden = true; el.classList.remove('is-quiet'); }
    }
    if (retryBtn) retryBtn.addEventListener('click', () => retrySyncNow());
    // Nettet kom tilbake: nullstill frakoblet-tellingen og hent inn etterslepet
    // straks, i stedet for å vente ut pollet.
    window.addEventListener('online', () => { netFailures = 0; paint(); scheduleCloud(0); });
    window.addEventListener('offline', paint);
    return { refresh: paint, noteReachable, noteNetworkFailure, noteRejected,
      clearRejected, clearServerRejections, beginRetry, endRetry, snapshot, start, stop };
  })();

  /* «Prøv igjen»: napper både operasjonskøen og synk-runden i gang MED ÉN GANG
     (backoffen ventes ikke ut). Avvisningslisten røres IKKE — den tømmes først
     når serveren faktisk har kvittert, så knappen aldri kan lyve om utfallet.
     Mens forsøket pågår står statusen på «Lagrer …»; feiler det, kommer
     avvisningen tilbake av seg selv. */
  function retrySyncNow() {
    syncStatus.beginRetry();
    // En feilet buffer-skriving skal også prøves på nytt. Ingen NY brukerendring
    // her — `cacheDirty` står allerede hvis den forrige skrivingen ikke gikk.
    scheduleCacheWrite();
    opQueue.retryNow();
    scheduleCloud(0);
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
     under (lockOverrides/posOverrides/suppressedRows) til operasjonen har
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
        try { if (head.onError) head.onError(new Error(tr('sync.notSaved'))); }
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
      if (err && isNetworkError(err)) {
        // Offline/nett-glipp: behold rekkefølgen (fremst igjen) og prøv senere.
        queue.unshift(op);
        clearTimeout(retryTimer);
        retryTimer = setTimeout(pump, retryDelay);
        retryDelay = Math.min(retryDelay * 2, 15000);
        syncStatus.noteNetworkFailure();
        return;
      }
      retryDelay = 1000;
      syncStatus.noteReachable(); // serveren svarte — uansett hva den svarte
      op.value = value;
      try {
        if (err) {
          // Serveren tok imot og sa nei. Operasjonen rulles tilbake av onError
          // (det er ikke noe igjen å prøve om igjen), så den havner ikke i
          // avvisningslisten — men teknikken skal være å finne i konsollen.
          console.warn('[huskis] Operasjon avvist av serveren' +
            (op.key ? ' («' + op.key + '»)' : '') + '.', err);
          if (op.onError) op.onError(err);
        } else if (op.onDone) op.onDone(value);
      } catch (e) { /* callback-feil skal ikke stoppe køen */ }
      syncStatus.refresh();
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
      syncStatus.refresh();
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
    // Prøv nå, uten å vente ut backoffen: nettet kom tilbake, eller brukeren
    // trykket «Prøv igjen». Backoffen nullstilles samtidig, så neste ekte
    // nettverksfeil starter forfra på 1 s i stedet for der den slapp.
    function retryNow() {
      clearTimeout(retryTimer);
      retryDelay = 1000;
      pump();
    }
    // Er det noe på gang i det hele tatt? (kjørende operasjon eller kø som
    // venter/retryer) — updateSafety() bruker den til å la være å reloade midt
    // i en delings-/lås-skriving.
    function busy() { return !!running || queue.length > 0; }
    window.addEventListener('online', retryNow);
    return { enqueue, cancel, clear, hasPending, busy, retryNow };
  })();

  /* ---------------- Optimistiske overlays (til operasjonen har landet) ----------------
     applyMyDoc bygger state fra SERVERENS metadata hver synk-runde; uten
     overlayene ville en optimistisk endring visuelt hoppet tilbake hvis en pull
     rakk å kjøre før den køede skrivingen landet. Ryddes av operasjonens
     onDone/onError (når køen ikke har flere operasjoner for samme nøkkel). */
  const lockOverrides = new Map();  // id → ønsket locked-verdi (set_locked i kø)
  const unlockOverrides = new Map(); // id → ønsket unntak-verdi (set_unlocked i kø)
  const policyOverrides = new Map(); // id → ønsket invite_policy (set_invite_policy i kø)

  /* Lås / lås-unntak på et område eller en mappe. Veksler flagget optimistisk,
     legger RPC-en i operasjonskøen og ruller tilbake ved feil. DELT av
     objektmenyens «Lås for redigering» og del-modalens lås-knapp, så de to
     aldri kan gli fra hverandre — serveren er uansett den som håndhever.
       isException = true → «gjør/fjern unntak» under en ARVET lås (set_unlocked)
       isException = false → objektets EGEN lås (set_locked)
     `repaint` males på nytt både med én gang og etter et evt. tilbakerull. */
  function toggleObjLock(type, id, obj, isException, repaint) {
    const field = isException ? '_unlocked' : '_locked';
    const overrides = isException ? unlockOverrides : lockOverrides;
    const key = (isException ? 'unlock:' : 'lock:') + type + ':' + id;
    obj[field] = !obj[field];
    overrides.set(id, obj[field]);
    if (repaint) repaint();
    opQueue.enqueue({
      key,
      waitFor: () => rowKnownToServer(id),
      // RPC-navnene står som LITERALER i begge grenene: db-kontrakt-testen
      // leser `.rpc('…')` ut av app.js for å holde smoke-testen i takt, og et
      // navn bygget i en variabel ville vært usynlig for den.
      run: async () => {
        const want = overrides.has(id) ? overrides.get(id) : obj[field];
        const res = isException
          ? await acli().rpc('set_unlocked', { p_type: type, p_id: id, p_unlocked: want })
          : await acli().rpc('set_locked', { p_type: type, p_id: id, p_locked: want });
        if (res.error) throw res.error;
      },
      onDone: () => { if (!opQueue.hasPending(key)) { overrides.delete(id); scheduleCloud(0); } },
      onError: (e) => {
        overrides.delete(id);
        obj[field] = !obj[field];
        if (repaint) repaint();
        showToast(friendlyAuthError(e));
        scheduleCloud(0);
      },
    });
  }
  const posOverrides = new Map();    // id → ønsket PERSONLIG pos (membership-skriving i kø)
  const suppressedRows = new Set();  // id-er fjernet lokalt (leave_share i kø)
  // Mappeflyttinger som venter på move_group-RPC-en: id → { fromUni, fromCat,
  // fromPos, toUni, toCat, toPos }. Så lenge en flytting står her vises mappen
  // OPTIMISTISK på det nye stedet, mens doc-synken skriver den GAMLE plasseringen
  // (databasen avviser en direkte `universe_id`-skriving — RPC-en eier flyttingen).
  const pendingGroupMoves = new Map();

  // Er raden kjent på serveren ennå? Delings-/flytte-RPC-er mot et NYTT objekt
  // (inviter/lås/flytt rett etter opprettelse) må vente i køen til doc-synken har
  // fått pushet raden — ellers avviser serveren dem («finnes ikke»).
  function rowKnownToServer(id) {
    if (!lastMy) return false;
    const has = (list) => (list || []).some((r) => r.id === id);
    return has(lastMy.universes) || has(lastMy.groups) || has(lastMy.cards);
  }

  /* ---------------- Personlig rekkefølge (medlemskapsraden) ----------------
     Områdenes rekkefølge på toppnivå og de frie mappenes rekkefølge er
     PERSONLIGE: de ligger på brukerens egen medlemskapsrad og endrer aldri hva
     andre ser. Skrivingen koalesceres i køen (rask omrokkering blir én skriving). */
  function cloudPersonalPos(type, id, pos) {
    posOverrides.set(id, pos);
    const key = 'pos:' + id;
    const col = type === 'universe' ? 'universe_id' : 'group_id';
    const op = {
      key,
      pos,
      merge: (next) => { op.pos = next.pos; },
      run: async () => {
        const client = acli();
        if (!client || !authUser) return;
        const { error } = await client.from('memberships').update({ pos: op.pos })
          .eq('user_id', authUser.id).eq(col, id);
        if (error) throw error;
      },
      onDone: () => {
        if (!opQueue.hasPending(key)) { posOverrides.delete(id); scheduleCloud(0); }
      },
      onError: () => {
        posOverrides.delete(id);
        showToast(tr('sync.orderNotSaved'));
        scheduleCloud(0); // server-sannheten gjenoppretter visningen
      },
    };
    opQueue.enqueue(op);
  }
  // Forlat en deling: objektet er allerede fjernet lokalt (optimistisk);
  // undertrykkes fra pull-ene til leave har landet, så det verken gjenoppstår
  // lokalt eller (verre) får reconcile til å pushe delete på andres rader.
  function cloudLeave(type, id) {
    if (demoActive) return; // simulering — ingen bakgrunnsoperasjoner
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
        scheduleCloud(0); // objektet kommer tilbake fra serveren hvis vi fortsatt har tilgang
      },
    });
  }
  // Fjern et objekt fra det lokale treet (optimistisk «forlat»).
  function removeSharedLocally(id) {
    const f = findAnyById(id);
    if (!f) return;
    const arr = f.kind === 'universe' ? state.universes
      : f.kind === 'group' ? (f.obj._parent ? f.obj._parent.groups : null)
      : f.obj._parent ? f.obj._parent.cards : null;
    if (!arr) return;
    const i = arr.indexOf(f.obj);
    if (i > -1) arr.splice(i, 1);
    validateActive(state); // objektet kan ha vært aktivt område/mappe
  }

  /* ---------------- Synk-syklus v2 ---------------- */
  /* `cloudBase` er forrige serverkjente doc — 3-veis-flettingens base. Den
     OVERLEVER nå en omstart: uten den startet hver økt med en tom base, og
     kombinasjonen «finnes lokalt, ikke på serveren, ikke i base» ble lest som en
     lokal nyopprettelse. En utdatert cache satte da inn igjen alt den hadde som
     serveren ikke lenger hadde — inkludert permanent slettede objekter.

     Basen lagres i den BRUKERSPESIFIKKE cachen (`mine-lister-v1:<uid>`), i
     samme localStorage-post som innholdet, med et versjonsnummer så en framtidig
     endring av doc-fasongen forkaster gamle baser i stedet for å mistolke dem.
     Hver enhet og hver nettleser har sin egen post og dermed sin egen base —
     det er riktig: basen beskriver nettopp hva DENNE klienten sist så. Mangler
     den, faller vi tilbake på gravsteins-oppslaget i cloudCycle. */
  const BASE_VERSION = 1;
  let cloudBase = null;
  let persistedBaseSig = null;
  /* Id-ene som ble lest fra en cache UTEN gyldig base — radene med ukjent
     historikk. Bare for DEM er «finnes lokalt, ikke på serveren» tvetydig, og
     bare de holdes tilbake til serverens gravsteiner har svart. Alt brukeren
     lager etterpå er utvilsomt nytt og skrives som før, så en midlertidig feil i
     gravsteins-oppslaget aldri kan stoppe vanlig bruk. Tømmes så snart
     historikken er avklart (oppslaget svarte, eller ingen av radene er i tvil). */
  let unknownHistory = new Set();
  function persistBase(remote) {
    // Uavklart historikk (gravsteins-oppslaget har ikke svart ennå): basen må
    // IKKE gjøres gyldig på disk. Tvilen lever bare i minnet
    // (`unknownHistory`), så en reload ville lest en gyldig base som «vi vet hva
    // serveren hadde», mistet tvilen, og skrevet de uavklarte radene som
    // nyopprettelser. Vi merker basen ugyldig i stedet, så neste oppstart spør
    // på nytt.
    if (unknownHistory.size) {
      if (state._base === null && state._baseV === 0) return;
      state._base = null; state._baseV = 0; persistedBaseSig = null;
      saveLocal();
      return;
    }
    const sig = canonical(remote);
    if (sig === persistedBaseSig) return; // uendret siden sist skriving
    persistedBaseSig = sig;
    state._base = remote;
    state._baseV = BASE_VERSION;
    saveLocal();
  }
  let cloudRunning = false, cloudAgain = false;
  let cloudDebounce = null, cloudPoll = null, cloudChan = null, cloudRt = false;
  let lastMy = null;
  let lastViewSig = null; // signatur av sist anvendte visning (innhold + metadata + overlays)

  // applyMyDoc's utfall er en ren funksjon av (flettet innhold, server-metadata,
  // optimistiske overlays). Signaturen fanger alle tre, så cloudCycle kan hoppe
  // over en rebuild + render() når ingenting faktisk endret seg — ellers ville
  // hvert poll (og hver runde i en push-retry-løkke) tegnet hele board-et på
  // nytt og nullstilt hover-tilstanden (flimmer). Motstykket til v1-synkens
  // `mergedCanon !== localCanon`-vakt.
  function viewSignature(mergedDoc, meta) {
    const metaArr = [];
    // `ownerKey`/`ownerCount` MÅ være med: et eierskifte hos NOEN ANDRE endrer
    // verken innholdet, mine capabilities, min rolle eller `shared` — men det
    // flytter eierskapsdomenet. Uten dem ville `_ownerKey` blitt stående utdatert,
    // og en senere mappeflytting lest to nå ULIKE domener som like, hoppet over
    // den destruktive-flytting-bekreftelsen og latt serveren kopiere-og-slette.
    meta.forEach((m, id) => metaArr.push(
      id + ':' + (m.role || '-') + (m.free ? 'F' : '') + (m.locked ? 1 : 0) +
      (m.unlocked ? 1 : 0) + (m.shared ? 1 : 0) + ':' + (m.personalPos == null ? '' : m.personalPos) +
      ':' + (m.caps ? canonical(m.caps) : '') + ':' + (m.creator || '') +
      ':' + (m.ownerKey == null ? '' : m.ownerKey) + ':' + (m.ownerCount || 0) +
      ':' + (m.memberCount || 0)
    ));
    metaArr.sort();
    const lo = []; lockOverrides.forEach((v, k) => lo.push(k + '=' + (v ? 1 : 0))); lo.sort();
    const po = []; posOverrides.forEach((v, k) => po.push(k + '=' + v)); po.sort();
    const gm = []; pendingGroupMoves.forEach((v, k) => gm.push(k + '=' + canonical(v))); gm.sort();
    const sr = [...suppressedRows].sort();
    return canonical(mergedDoc) + '||' + metaArr.join(',') + '||' +
      lo.join(',') + '||' + po.join(',') + '||' + gm.join(',') + '||' + sr.join(',');
  }

  function scheduleCloud(delay) {
    if (demoActive) return; // simulering — se demoActive
    clearTimeout(cloudDebounce);
    // Nulles når den fyrer, så updateSafety() kan se om en runde står i kø.
    cloudDebounce = setTimeout(() => { cloudDebounce = null; cloudCycle(); }, delay == null ? 300 : delay);
  }
  async function rpcMyDoc() {
    const client = acli();
    if (!client || !authUser) return null;
    const { data, error } = await client.rpc('get_my_doc');
    if (error) throw error;
    return data || null;
  }
  /* ---------------- Server-gravsteiner: sjekk av ukjent historikk ----------------
     Uten en base kan ikke fletteren vite om en rad som finnes lokalt men ikke på
     serveren er ny her eller slettet der. Serveren vet: `tombstones` har en rad
     per permanent slettet objekt (skrevet av AFTER DELETE-triggerne, uten
     utløp). Vi spør derfor rett ut — men bare om de id-ene det faktisk er tvil
     om, og bare når basen mangler, så steady state ikke får en ekstra rundtur.

     Tabellen leses direkte (RLS: lesbar for innloggede) i stedet for via en ny
     RPC, med vilje: den har ligget der siden første versjon av skjemaet, så
     klienten virker også mot en database som ennå ikke har fått denne rundens
     migrering. Id-ene sendes i porsjoner så URL-en holder seg kort. */
  const TOMB_LOOKUP_CHUNK = 100;
  async function fetchServerTombs(ids) {
    const client = acli();
    const hits = [];
    for (let i = 0; i < ids.length; i += TOMB_LOOKUP_CHUNK) {
      const { data, error } = await client.from('tombstones')
        .select('resource_type,resource_id')
        .in('resource_id', ids.slice(i, i + TOMB_LOOKUP_CHUNK));
      if (error) throw error; // nettverk/tilgang → hele runden prøves igjen
      (data || []).forEach((r) => hits.push(r));
    }
    return hits;
  }
  async function cloudCycle() {
    if (!authUser || !acli()) return;
    /* Demoen har byttet ut `state` med en kulisse. En runde her ville både
       pushet kulissen og — verre — skrevet serverens svar inn over den, så
       brukerens egne objekter dukket opp midt i demoen. Runden tas igjen når
       demoen er ferdig (endDemo kaller scheduleCloud). */
    if (demoActive) return;
    if (cloudRunning) { cloudAgain = true; return; }
    cloudRunning = true;
    syncStatus.refresh();
    // Nådde HELE runden fram? null = ikke avgjort ennå. Verdikten felles først i
    // `finally`, aldri når pull-en er ferdig: en pull som går gjennom mens hver
    // SKRIVING dør i transporten ville ellers nullstilt frakoblet-tellingen
    // hver runde, og statusen ville stått på «Lagrer …» for alltid i stedet for
    // å si fra at endringene ikke kommer fram.
    let reached = null;
    try {
      const my = await rpcMyDoc();
      reached = true; // pull-en kom fram — skrivingene er ikke prøvd ennå
      if (!my) return;
      /* Demoen kan ha startet MENS pullen var i lufta. Da peker `state` på
         kulissen, og alt under — fletting, `applyMyDoc`, push — ville lest den
         som brukerens innhold: serverens rader ville dukket opp midt i demoen,
         og fletteren lest brukerens ekte rader som slettet og pushet DELETE.
         Vakten på toppen fanger bare runder som ikke har begynt; denne fanger
         den som allerede var i gang. Runden tas igjen når demoen er ferdig. */
      if (demoActive) return;
      lastMy = my;
      const remote = contentDocFromMy(my);
      const meta = metaFromMy(my);
      // `unknownHistory` er ikke-tom når cachen ble lest uten en gyldig base (kald
      // start, eller et domene som aldri har synket): de radene mangler kanskje på
      // serveren fordi de er slettet der, ikke fordi de er nye her.
      //
      // `doubted` fryser settet for HELE runden. Den andre flettingen (etter
      // gravsteins-oppslaget) må nemlig ta den SAMME avgjørelsen om fremmede
      // rader som den første: leste vi `foreign` av det da-tømte
      // `unknownHistory`, ville en tilbaketrukket deling — droppet i runde 1 —
      // sklidd gjennom som en «lokal nyopprettelse» i runde 2 og blitt skrevet
      // med OSS som oppretter.
      const doubted = new Set(unknownHistory);
      const doubtedForeign = () => {
        const f = new Set();
        foreignIds().forEach((id) => { if (doubted.has(id)) f.add(id); });
        return f;
      };
      const opts = () => ({ tombs: tombIds(), foreign: doubtedForeign(), unknown: unknownHistory });
      // Fanges FØR staten leses: en endring som kommer mens runden pågår teller
      // som usynket (fail closed — heller «vent» enn en reload som mister den).
      const seq = saveSeq;
      let r = reconcile(cloudBase || emptyDoc(), docFromMyState(), remote, opts());
      if (unknownHistory.size) {
        if (!r.unverified.length) {
          unknownHistory.clear(); // ingen av dem er i tvil lenger
        } else {
          // Spør serveren hvilke av dem som er gravlagt, gravlegg dem lokalt
          // også, og flett på nytt: de døde faller ut, resten er ekte lokale
          // nyopprettelser og pushes i samme runde.
          try {
            const hits = await fetchServerTombs(r.unverified.map((x) => x.id));
            if (hits.length) {
              hits.forEach((h) => tombFromServer(h.resource_type, h.resource_id));
              saveLocal();
            }
            if (demoActive) return; // demoen startet mens oppslaget var i lufta
            unknownHistory.clear();
            r = reconcile(cloudBase || emptyDoc(), docFromMyState(), remote, opts());
          } catch (e) {
            // Fikk ikke svar (offline, eller en database uten lesetilgang til
            // tabellen). Radene det gjelder blir STÅENDE lokalt uten å skrives,
            // og vi spør igjen neste runde. Resten av runden — oppdateringer,
            // slettinger, fjern-nye rader OG alt brukeren lager nå — går som
            // normalt: tvilen gjelder bare de id-ene som kom fra cachen.
          }
        }
      }
      const { merged, ops } = r;
      // Bruk fletteresultatet lokalt — men ikke avbryt aktiv redigering/draging,
      // og bare når visningen faktisk endrer seg (ellers tegner hvert poll / hver
      // runde i en push-retry-løkke board-et på nytt → hover-flimmer).
      const sig = viewSignature(merged, meta);
      if (!isBusyEditing()) {
        if (sig !== lastViewSig) { applyMyDoc(merged, meta); lastViewSig = sig; }
        // Basen rykker fram KUN når fletteresultatet faktisk er tatt i bruk i
        // `state`. Ellers ville basen beskrevet rader staten ikke har, og neste
        // runde lest dem som «slettet lokalt» → push DELETE på gyldige rader
        // (en fjern-opprettet rad som kom mens brukeren skrev, f.eks.).
        cloudBase = remote;
        persistBase(remote);
      } else if (sig !== lastViewSig) {
        cloudAgain = true; // utsatt visnings-endring → tegn på nytt når redigeringen er ferdig
      }
      let allPushed = true;
      if (ops.length) {
        if (demoActive) return; // siste sjanse før skrivingene forlater klienten
        const { rejected: failed, netFailed } = await pushOps(ops);
        if (netFailed) reached = false; // skrivingene kom ikke fram
        // Bekreftelses-pull straks etter push: lastMy/metadata friskes opp, så
        // køede operasjoner som venter på en nypushet rad (rowKnownToServer)
        // slipper å vente på neste poll. Landet ALT, ser neste runde remote ==
        // lokal → ingen nye ops → ingen ny runde. Ble noe avvist, ville den
        // samme op-en blitt regenerert og planlagt på nytt om 150 ms i det
        // uendelige (en varm løkke mot serveren) — da lar vi det vanlige
        // pollet/realtime prøve igjen i stedet.
        if (!failed) cloudAgain = true; else allPushed = false;
      } else {
        // Fletteren fant INGEN divergens: alt vi har lokalt ligger også på
        // serveren. Det er den eneste verifiserte grunnen til å blanke
        // server-avvisningene i ett jafs — en avvist rad som fortsatt
        // divergerer ville gitt en op her.
        syncStatus.clearServerRejections();
      }
      // Alt lokalt som fantes da staten ble lest, ligger nå på serveren.
      if (allPushed) syncedSeq = seq;
      updateInbox(my);
      refreshOpenShare(); // en åpen del-modal følger samme runde (medlemmer, invitasjoner, lås)
      maybeOfferMigration(my);
    } catch (e) {
      // Nådde vi ikke fram, er dette en FRAKOBLET-tilstand (poll/realtime
      // prøver igjen). Svarte serveren med en feil, er vi tilkoblet — da er det
      // skrivingenes egne avvisninger som eier statusen.
      reached = !isNetworkError(e);
    } finally {
      // Én verdikt per runde: ti rader som ikke kom fram er én nettverksfeil.
      if (reached === true) syncStatus.noteReachable();
      else if (reached === false) syncStatus.noteNetworkFailure();
      cloudRunning = false;
      if (cloudAgain) { cloudAgain = false; scheduleCloud(150); }
      else syncStatus.endRetry(); // ingen flere runder i kø → forsøket er avgjort
      syncStatus.refresh();
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
  /* Tilbake i forgrunnen ⇒ hent inn etterslepet MED ÉN GANG.
     Pollet over hopper over runder mens siden er skjult, så alt en annen enhet
     gjorde i mellomtiden venter på neste tikk. Hvor lenge det er, eier vi ikke:
     en skjult side får timerne sine strupet, og i en app-runtime kan hele
     prosessen fryses mens den ligger i bakgrunnen — intervallet er en
     bestilling, ikke et løfte om når. Selve gjenopptakelsen er derimot en
     HENDELSE, og den koster ingen native API-er: `visibilitychange` er det
     samme signalet i browseren og i WebView-en (docs/mobilapp-plan.md, fase 3).
     Realtime trenger ingen tilsvarende nudge — dør kanalen, melder den fra selv
     (`CLOSED`/`CHANNEL_ERROR` → ny subscribe), og pullen her dekker uansett
     hullet mens den kommer tilbake. */
  document.addEventListener('visibilitychange', () => {
    if (document.hidden || !authUser) return;
    scheduleCloud(0);
  });

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
      title: tr('import.title'),
      message: tr('import.message', { what: listWord(n) }),
      okLabel: tr('import.ok'), danger: false,
    })) { localStorage.setItem(flag, '1'); return; }
    try {
      const { error } = await acli().rpc('import_doc', { p_doc: legacy });
      if (error) throw error;
      localStorage.setItem(flag, '1');
      showToast(tr('import.done'));
      cloudBase = null; persistedBaseSig = null; // importen endret serveren under oss
      scheduleCloud(0);
    } catch (e) {
      migrationChecked = false; // la brukeren prøve igjen senere
      showToast(tr('import.failed'));
    }
  }

  /* ---------------- Innboks + profil (konto-modalen) ---------------- */
  const menuAccount = document.getElementById('menu-account');
  const accountAvatar = document.getElementById('account-avatar');
  const accountEmail = document.getElementById('account-email');
  const menuInvites = document.getElementById('menu-invites');
  const inviteListEl = document.getElementById('invite-list');
  const accountBadge = document.getElementById('account-badge');
  const menuEmailPref = document.getElementById('menu-email-pref');
  const emailPrefToggle = document.getElementById('email-pref-toggle');
  const accountEdit = document.getElementById('account-edit');
  const accountNameForm = document.getElementById('account-name-form');
  const accountNameInput = document.getElementById('account-name-input');
  const accountEmailForm = document.getElementById('account-email-form');
  const accountEmailInput = document.getElementById('account-email-input');
  const accountPassForm = document.getElementById('account-pass-form');
  const accountPassCurrent = document.getElementById('account-pass-current');
  const accountPassNew = document.getElementById('account-pass-new');
  const accountMsgEl = document.getElementById('account-msg');

  /* ---------------- Endre navn, e-post og passord ----------------
     Navnet (display_name) ligger i profiles-tabellen (RLS: kun egen rad) og
     speiles i user_metadata (fallback i myOwnerInfo); e-post og passord endres
     via Supabase Auth (`updateUser({ email })` — bekreftes via lenke på e-post,
     mock-backenden oppdaterer direkte — og `updateUser({ password })`). */
  function setAccountMsg(msg, isError) {
    accountMsgEl.textContent = msg || '';
    accountMsgEl.hidden = !msg;
    accountMsgEl.classList.toggle('error', !!isError);
  }
  // Fyll feltene fra kontoen. Uten force røres ikke et felt brukeren står i
  // (en synk-runde skal ikke overskrive halvskrevet input).
  function paintAccountForms(force) {
    if (!authUser) return;
    if (force) setAccountMsg('');
    const prof = (lastMy && lastMy.user) || {};
    if (force || document.activeElement !== accountNameInput) {
      accountNameInput.value = prof.display_name ||
        (authUser.meta && authUser.meta.display_name) || '';
    }
    if (force || document.activeElement !== accountEmailInput) {
      accountEmailInput.value = authUser.email || '';
    }
    // Passordfeltene fylles aldri fra kontoen — de tømmes hver gang modalen åpnes.
    if (force) clearPassFields([accountPassCurrent, accountPassNew]);
  }
  accountNameForm.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (!authUser) return;
    const name = accountNameInput.value.trim();
    if (!name) { setAccountMsg(tr('account.nameEmpty'), true); return; }
    setAccountMsg('');
    try {
      const { error } = await acli().from('profiles')
        .update({ display_name: name }).eq('id', authUser.id);
      if (error) throw error;
      // Hold user_metadata i takt (brukes som fallback før første pull).
      try { await acli().auth.updateUser({ data: { display_name: name } }); } catch (e) { /* uviktig */ }
      authUser.meta = Object.assign({}, authUser.meta, { display_name: name });
      if (lastMy && lastMy.user) lastMy.user.display_name = name;
      updateInbox(lastMy); // avatar + navnelinjen øverst
      setAccountMsg(tr('account.nameUpdated'));
      scheduleCloud(0); // frisk opp delte visninger (medlemslister o.l.)
    } catch (e) {
      setAccountMsg(friendlyAuthError(e), true);
    }
  });
  accountEmailForm.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (!authUser) return;
    const email = accountEmailInput.value.trim().toLowerCase();
    if (!email || email === (authUser.email || '').toLowerCase()) return;
    setAccountMsg('');
    try {
      const { error } = await acli().auth.updateUser({ email }, { emailRedirectTo: authRedirectUrl() });
      if (error) throw error;
      if (useMock()) {
        // Mock-backenden endrer direkte (ingen e-postbekreftelse i test).
        authUser.email = email;
        if (lastMy && lastMy.user) lastMy.user.email = email;
        updateInbox(lastMy);
        setAccountMsg(tr('account.emailUpdated'));
      } else {
        setAccountMsg(tr('account.emailConfirmPending'));
      }
    } catch (e) {
      setAccountMsg(friendlyAuthError(e), true);
    }
  });
  // Bytte passord: det nåværende passordet må skrives inn — vi bekrefter det med
  // en ny innlogging (samme bruker, så onAuthStateChange lar appen stå) før
  // Supabase Auth får det nye. Uten den sjekken kunne hvem som helst med en åpen
  // fane overtatt kontoen.
  accountPassForm.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (!authUser) return;
    const current = accountPassCurrent.value;
    const next = accountPassNew.value;
    if (!current) { setAccountMsg(tr('account.enterCurrentPassword'), true); return; }
    if (next.length < 6) { setAccountMsg(tr('account.newPasswordTooShort'), true); return; }
    if (next === current) { setAccountMsg(tr('error.passwordSameAsOld'), true); return; }
    setAccountMsg('');
    try {
      const check = await acli().auth.signInWithPassword({ email: authUser.email, password: current });
      if (check.error) { setAccountMsg(tr('account.wrongCurrentPassword'), true); return; }
      const { error } = await acli().auth.updateUser({ password: next });
      if (error) throw error;
      clearPassFields([accountPassCurrent, accountPassNew]);
      setAccountMsg(tr('account.passwordUpdated'));
    } catch (e) {
      setAccountMsg(friendlyAuthError(e), true);
    }
  });

  /* ---------------- Språk ----------------
     Valget ligger to steder, og de har hver sin jobb:

       • `localStorage['huskis-lang']` (i18n.js) — ENHETENS språk. Det eneste
         som finnes før innlogging, og det som avgjør hvilket språk appen
         starter på.
       • `user_metadata.lang` — KONTOENS språk. Det følger deg til en ny enhet,
         og det er dessuten det eneste serveren kan lese: e-postene appen sender
         (`send_invite_email()`) velger språk derfra.

     Kontoen vinner ved innlogging; et bytte skriver begge. Autoritativt:
     docs/sprak.md. */
  const langSelects = () => [document.getElementById('lang-select'),
    document.getElementById('auth-lang-select')].filter(Boolean);
  function paintLanguage() {
    const icon = document.getElementById('language-icon');
    if (icon && !icon.innerHTML) icon.innerHTML = ICONS.language;
    langSelects().forEach((sel) => {
      if (!sel.options.length) {
        // Språknavnene står på sitt EGET språk («Norsk», «English») — det er
        // slik man finner sitt eget i en liste man ellers ikke kan lese.
        I18N.LANGS.forEach((l) => {
          const o = document.createElement('option');
          o.value = l.code;
          o.textContent = l.label;
          sel.appendChild(o);
        });
        sel.addEventListener('change', () => setLanguage(sel.value));
      }
      sel.value = I18N.lang();
    });
  }
  /* Bytt språket UTEN omlasting. Brukes når en omlasting ikke er trygg (se
     under): den statiske teksten males på nytt, og resten følger av en vanlig
     rendring. Tekst som ble fanget i konstanter ved oppstart — demoens steg —
     blir stående på det gamle språket; det er prisen for å slippe løkka. */
  function repaintLanguage() {
    I18N.applyStatic(document);
    paintLanguage();
    paintTheme();   // draktvalgenes etiketter er også oversatt tekst
  }
  /* Bytt språk. Appen lastes normalt på nytt etterpå: språket sitter i hver
     eneste tekst som allerede er bygget — korttitler, menyer, demoens steg —
     og en omlasting er den ENESTE garantien for at ingenting blir stående
     igjen på det gamle språket.

     To ting må stemme FØR vi laster på nytt, ellers gjør omlastingen vondt
     verre:

       1. Valget må ha OVERLEVD på enheten. I privat modus kaster
          `localStorage.setItem`, og omlastingen ville kommet tilbake på det
          gamle språket — for en konto med et annet språk i en evig løkke.
       2. Kontoen må ha TATT IMOT det. Supabase svarer med `{ error }` i stedet
          for å kaste; ignorerte vi det, ville omlastingen lest kontoens GAMLE
          språk tilbake og stilltiende omgjort valget (kontoen vinner).

     Slår én av dem feil, bytter vi i minnet i stedet og sier fra. */
  async function setLanguage(code) {
    if (code === I18N.lang()) return;
    const saved = I18N.setLang(code);
    let onAccount = true;
    if (authUser) {
      const prevMeta = authUser.meta;
      authUser.meta = Object.assign({}, authUser.meta, { lang: I18N.lang() });
      try {
        const { error } = await acli().auth.updateUser({ data: { lang: I18N.lang() } });
        if (error) throw error;
      } catch (e) {
        authUser.meta = prevMeta;   // serverens sanne verdi står fortsatt der
        onAccount = false;
      }
    }
    if (saved && onAccount) { location.reload(); return; }
    repaintLanguage();
    render();
    showToast(tr(saved ? 'lang.notOnAccount' : 'lang.notStored'));
  }
  /* Ved innlogging vinner kontoens språk over enhetens. Har kontoen ikke noe
     språk ennå — en konto fra før språkvalget fantes, eller en fersk
     registrering — arver den enhetens: norsk for alle som var her før, og det
     man valgte på innloggingsskjermen for alle andre. */
  function adoptAccountLanguage() {
    if (!authUser) return;
    const want = (authUser.meta && authUser.meta.lang) || '';
    if (I18N.LANGS.some((l) => l.code === want)) {
      if (want === I18N.lang()) return;
      // Kan ikke enheten huske språket, ville omlastingen kommet tilbake hit
      // med det gamle igjen — og gjort det på nytt, og på nytt. Vi bytter i
      // minnet i stedet; `cloudStart()` rendrer rett etterpå.
      if (I18N.setLang(want)) { location.reload(); return; }
      repaintLanguage();
      return;
    }
    /* Kontoen har ikke noe språk ennå. Har enheten et EKSPLISITT valg — typisk
       tatt på innloggingsskjermen rett før — løftes det opp på kontoen. Står
       enheten bare på standarden, skrives INGENTING: kontoen og enheten er da
       enige uansett, og en skriving ved hver eneste innlogging ville vært ren
       støy (og en unødvendig runde mot Auth). */
    if (I18N.chosen()) saveAccountPref({ lang: I18N.lang() }, 1);
  }

  /* ---------------- Drakt (lys/mørk) ----------------
     Samme kontroll to steder som språket — konto-modalen og innloggings-
     skjermen — men valget er ENHETENS alene: det ligger bare i
     `localStorage['huskis-theme']` (theme.js), aldri på kontoen. Drakten følger
     skjermen og lyset man sitter i, ikke hvem man er, og den har ingen
     serverside-effekt slik språket har (invitasjons-e-postene er på kontoens
     språk). Autoritativt: docs/mork-drakt.md.

     Ingen omlasting, i motsetning til et språkbytte: drakten bor i CSS-tokens
     og i kortfargene, og begge deler kan males på nytt der de står. */
  const themeSelects = () => [document.getElementById('theme-select'),
    document.getElementById('auth-theme-select')].filter(Boolean);
  function paintTheme() {
    const icon = document.getElementById('theme-icon');
    if (icon && !icon.innerHTML) icon.innerHTML = ICONS.theme;
    themeSelects().forEach((sel) => {
      if (!sel.options.length) {
        THEME.MODES.forEach((m) => {
          const o = document.createElement('option');
          o.value = m;
          sel.appendChild(o);
        });
        sel.addEventListener('change', () => setTheme(sel.value));
      }
      // Etikettene males på nytt hver gang, ikke bare når valgene bygges: et
      // språkbytte uten omlasting (repaintLanguage) går gjennom her.
      Array.prototype.forEach.call(sel.options, (o) => { o.textContent = tr('theme.' + o.value); });
      sel.value = THEME.mode();
    });
  }
  function setTheme(mode) {
    if (mode === THEME.mode()) return;
    const saved = THEME.setMode(mode);   // maler data-theme + varsler lytterne
    paintTheme();
    if (!saved) showToast(tr('theme.notStored'));
  }
  /* Kortfargene er de eneste fargene som IKKE bor i CSS — de settes inline fra
     paletten (colorForIndex), og paletten speiler L-en per drakt. De må derfor
     males på nytt når drakten skifter, også når skiftet kom fra
     operativsystemet mens appen sto åpen ('system').

     KUN KIRURGISK — ALDRI EN FULL RENDRING. Begge funksjonene under bytter
     bare `background`/custom properties på noder som allerede står der:
     `reindexContainerColors` tar kortene, `repaintAvatars` tar ansvarssirklene.
     Til sammen er det hver eneste palettflate som lever i board-et, så en
     `render()` ville ikke tilført noe — men den ville kostet tre ting:

       • Den river ned board-et. En drakt-endring fra operativsystemet kommer
         når den kommer, gjerne midt i en inline navngiving, og
         `captureFocusIn` bevarer ikke et åpent `.edit-input`. En fjernet,
         fokusert node fyrer heller ikke pålitelig sin egen `blur`, så teksten
         brukeren holdt på å skrive ville gått tapt.
       • `renderBoardInner()` kaller `save()`. Drakten ligger i localStorage og
         rører ingen synket data, men rendringen ville likevel stemplet
         dokumentet som endret, køet en synk-runde og blokkert
         auto-oppdateringens trygghetssjekk — for et rent lokalt fargebytte.
       • Å utsette rendringen i stedet løser ingenting: den måtte da tømmes et
         sted, og `finishDrag()` (det nærliggende stedet) kalles av droppene
         FØR de har committet — `onCardUp` stempler `pos` og lagrer etterpå.
         En rendring der ville malt board-et fra tilstanden før slippet.

     Søppelkasse-modalens prikker er det ene unntaket: de males også fra
     paletten, men modalen bygger radene sine på nytt hver gang den åpnes, så
     en drakt-endring mens den STÅR åpen lar prikkene beholde den gamle fargen
     til den lukkes. De er rene identitetsmerker, og modalen er kortlevd. */
  THEME.onChange(() => {
    paintTheme();
    reindexContainerColors(boardScope);
    reindexContainerColors(navScope);   // no-op når nav-modalen er tom
    repaintAvatars();
  });

  // E-postvarsel-innstillingen ligger på kontoen (user_metadata.email_notifications).
  // Standard PÅ (ny bruker uten flagget → true). Endres optimistisk; skrivingen
  // til Supabase Auth skjer i bakgrunnen, og authUser.meta oppdateres ved suksess.
  function emailPrefOn() {
    return !(authUser && authUser.meta && authUser.meta.email_notifications === false);
  }
  function paintEmailPref() {
    if (!emailPrefToggle) return;
    emailPrefToggle.setAttribute('aria-checked', emailPrefOn() ? 'true' : 'false');
  }
  emailPrefToggle && emailPrefToggle.addEventListener('click', async () => {
    if (!authUser) return;
    const next = !emailPrefOn();
    authUser.meta = Object.assign({}, authUser.meta, { email_notifications: next });
    paintEmailPref();
    try {
      const { error } = await acli().auth.updateUser({ data: { email_notifications: next } });
      if (error) throw error;
    } catch (e) {
      // Rull tilbake ved feil (behold serverens sanne verdi).
      authUser.meta = Object.assign({}, authUser.meta, { email_notifications: !next });
      paintEmailPref();
      showToast(friendlyAuthError(e));
    }
  });

  /* ============================================================
     PROFILBILDE
     ------------------------------------------------------------
     Bildet lagres som en data-URI i `profiles.avatar`: ett kvadratisk JPEG på
     AVATAR_SIZE px — nok til at den største sirkelen i appen (56 px) er skarp
     også på 3x-skjermer, lite nok til at raden blir noen få titalls kB.
     Det hentes med et EGET kall (ikke via get_my_doc): doc-et pollet hvert 5.
     sekund skal ikke bære et bilde. Andres bilder kommer med get_members, som
     hentes lat og caches (`shareGroupCache`). */
  const AVATAR_SIZE = 256;
  const AVATAR_QUALITY = 0.82;
  const AVATAR_MAX_ZOOM = 5;
  const avatarModal = document.getElementById('avatar-modal');
  const avatarStage = document.getElementById('avatar-stage');
  const avatarCanvas = document.getElementById('avatar-canvas');
  const avatarZoomEl = document.getElementById('avatar-zoom');
  const avatarRotEl = document.getElementById('avatar-rot');
  const avatarRot90 = document.getElementById('avatar-rot90');
  const avatarSaveBtn = document.getElementById('avatar-save');
  const avatarCancelBtn = document.getElementById('avatar-cancel');
  const avatarCloseBtn = document.getElementById('avatar-close');
  const avatarFileInput = document.getElementById('avatar-file');
  const avatarPickBtn = document.getElementById('avatar-pick');
  const avatarRemoveBtn = document.getElementById('avatar-remove');
  let myAvatar = null;
  let avatarPainted = null; // (bilde|initialer) sist malt — updateInbox kjører hvert poll

  // Fyll en avatar-sirkel: bildet hvis personen har ett, ellers initialene.
  // Formen/fargen ligger i CSS (`.account-avatar`/`.member-avatar`/`.resp-avatar`).
  function paintAvatar(el, avatar, initials) {
    el.innerHTML = '';
    if (avatar) {
      const img = document.createElement('img');
      img.src = avatar;
      img.alt = '';
      el.appendChild(img);
    } else {
      el.textContent = initials;
    }
  }
  function paintAccountAvatar() {
    const prof = (lastMy && lastMy.user) || {};
    const initials = initialsFromName(
      prof.display_name || (authUser && authUser.meta && authUser.meta.display_name),
      authUser && authUser.email);
    const key = (myAvatar || '') + '|' + initials;
    if (key === avatarPainted) return; // ikke bygg <img> på nytt hvert poll
    avatarPainted = key;
    paintAvatar(accountAvatar, myAvatar, initials);
    const cam = document.createElement('span');
    cam.className = 'avatar-cam';
    cam.setAttribute('aria-hidden', 'true');
    cam.innerHTML = ICONS.camera;
    accountAvatar.appendChild(cam);
    avatarRemoveBtn.hidden = !myAvatar;
  }
  // Bildet vises tre steder: konto-modalen (males direkte fra `myAvatar`) og
  // delings-medlemslistene + ansvarssirklene (males fra get_members-cachen).
  // Cachen må derfor tømmes og hentes på nytt for at en endring skal slå
  // gjennom der — men FØRST når skrivingen har landet (se storeAvatar).
  function refreshAvatarViews() {
    paintAccountAvatar();
    shareGroupEpoch++;
    shareGroupCache.clear();
    shareGroupLoading.clear();
    render();
  }
  async function loadMyAvatar() {
    const uid = authUser && authUser.id;
    try {
      const { data, error } = await acli().from('profiles').select('avatar').eq('id', uid);
      if (error) throw error;
      if (!authUser || authUser.id !== uid) return; // byttet konto imens
      const found = (data && data[0] && data[0].avatar) || null;
      if (found === myAvatar) { paintAccountAvatar(); return; }
      myAvatar = found;
      refreshAvatarViews();
    } catch (e) { /* uten bilde vises initialene — hentes igjen ved neste innlogging */ }
  }
  // Skriv (eller fjern) bildet på egen profil-rad. Konto-sirkelen males
  // umiddelbart (der brukeren ser etter), mens get_members-cachen først tømmes
  // NÅR skrivingen har landet: en render før det ville startet en get_members
  // som kappløper med skrivingen, og et svar med det GAMLE bildet ville blitt
  // liggende i cachen til neste innlogging.
  async function storeAvatar(value, okMsg) {
    const prev = myAvatar;
    myAvatar = value;
    paintAccountAvatar();
    try {
      const { error } = await acli().from('profiles').update({ avatar: value }).eq('id', authUser.id);
      if (error) throw error;
      setAccountMsg(okMsg);
    } catch (e) {
      myAvatar = prev;
      setAccountMsg(friendlyAuthError(e), true);
    }
    refreshAvatarViews();
  }

  /* ---------------- Bilderedigering (zoom/forskyv/roter) ----------------
     Scenen er nøyaktig det kvadratiske utsnittet som lagres, og sirkelmasken
     over den viser hva appen faktisk tegner — forhåndsvisningen ER utsnittet.
     Tilstanden er tre tall: zoom (1 = bildets korteste side fyller utsnittet),
     rotasjon, og utsnittets forskyvning i andeler av utsnittets side. */
  const avEdit = { img: null, scale: 1, rot: 0, ox: 0, oy: 0 };
  const avPointers = new Map();
  let avPinch = null;

  // Minste zoom som fyller HELE utsnittet ved denne vinkelen: en akse-justert
  // firkant trenger |cos|+|sin| ganger sin egen side inni et rotert bilde.
  function avatarCover(rot) { return Math.abs(Math.cos(rot)) + Math.abs(Math.sin(rot)); }
  // Hold utsnittet innenfor bildet: uttrykk utsnittets senter i bildets eget
  // (roterte) koordinatsystem, klem det der, og roter tilbake.
  function clampAvatarOffset() {
    const im = avEdit.img;
    if (!im) return;
    const c = Math.cos(avEdit.rot), s = Math.sin(avEdit.rot);
    const k = avEdit.scale / Math.min(im.width, im.height); // utsnittets side = 1
    const half = 0.5 * avatarCover(avEdit.rot);
    const maxX = Math.max(0, im.width * k / 2 - half);
    const maxY = Math.max(0, im.height * k / 2 - half);
    const x = -avEdit.ox, y = -avEdit.oy;
    let ix = x * c + y * s, iy = -x * s + y * c;
    ix = Math.min(maxX, Math.max(-maxX, ix));
    iy = Math.min(maxY, Math.max(-maxY, iy));
    avEdit.ox = -(ix * c - iy * s);
    avEdit.oy = -(ix * s + iy * c);
  }
  // Samme tegning til forhåndsvisning og lagring — bare ulik oppløsning.
  function drawAvatar(ctx, size) {
    const im = avEdit.img;
    ctx.clearRect(0, 0, size, size);
    if (!im) return;
    const k = size * avEdit.scale / Math.min(im.width, im.height);
    ctx.save();
    ctx.imageSmoothingQuality = 'high';
    ctx.translate(size / 2 + avEdit.ox * size, size / 2 + avEdit.oy * size);
    ctx.rotate(avEdit.rot);
    ctx.drawImage(im, -im.width * k / 2, -im.height * k / 2, im.width * k, im.height * k);
    ctx.restore();
  }
  function renderAvatarPreview() {
    const box = avatarStage.getBoundingClientRect();
    const size = Math.round(box.width * Math.min(window.devicePixelRatio || 1, 3));
    if (!size) return;
    if (avatarCanvas.width !== size) { avatarCanvas.width = size; avatarCanvas.height = size; }
    drawAvatar(avatarCanvas.getContext('2d'), size);
  }
  function setAvatarZoom(v) {
    const min = avatarCover(avEdit.rot);
    avEdit.scale = Math.min(AVATAR_MAX_ZOOM, Math.max(min, v || min));
    avatarZoomEl.value = String(avEdit.scale);
    clampAvatarOffset();
    renderAvatarPreview();
  }
  function setAvatarRotation(deg) {
    avatarRotEl.value = String(deg);
    avEdit.rot = deg * Math.PI / 180;
    // Rotasjon krever mer zoom for å fylle utsnittet — skyv bunnen i brytern opp
    // og dra verdien med hvis den havnet under.
    const min = avatarCover(avEdit.rot);
    avatarZoomEl.min = min.toFixed(3);
    setAvatarZoom(Math.max(avEdit.scale, min));
  }
  // Dekod filen til noe drawImage kan tegne. createImageBitmap tar EXIF-
  // orienteringen (mobilbilder) med seg; <img> er reserven.
  async function loadEditableImage(file) {
    if (window.createImageBitmap) {
      try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); }
      catch (e) { /* eldre nettlesere kjenner ikke valget — fall tilbake på <img> */ }
    }
    return await new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const im = new Image();
      im.onload = () => { URL.revokeObjectURL(url); resolve(im); };
      im.onerror = () => { URL.revokeObjectURL(url); reject(new Error('kunne ikke lese bildet')); };
      im.src = url;
    });
  }
  async function openAvatarEditor(file) {
    let im;
    try { im = await loadEditableImage(file); }
    catch (e) { showToast(tr('avatar.readFailed')); return; }
    avEdit.img = im;
    avEdit.scale = 1; avEdit.rot = 0; avEdit.ox = 0; avEdit.oy = 0;
    avatarZoomEl.min = '1'; avatarZoomEl.value = '1';
    avatarRotEl.value = '0';
    avatarModal.hidden = false;   // scenen må være synlig før den kan måles
    updateModalOpenClass();
    renderAvatarPreview();
  }
  function closeAvatarEditor() {
    avatarModal.hidden = true;
    if (avEdit.img && avEdit.img.close) avEdit.img.close(); // frigi ImageBitmap
    avEdit.img = null;
    avPointers.clear();
    avPinch = null;
    avatarStage.classList.remove('is-panning');
    updateModalOpenClass();
  }
  function avPointerSpan() {
    const p = [...avPointers.values()];
    return Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
  }
  avatarStage.addEventListener('pointerdown', (ev) => {
    if (!avEdit.img) return;
    avatarStage.setPointerCapture(ev.pointerId);
    avPointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    avatarStage.classList.add('is-panning');
    if (avPointers.size === 2) avPinch = { span: avPointerSpan(), scale: avEdit.scale };
  });
  avatarStage.addEventListener('pointermove', (ev) => {
    const prev = avPointers.get(ev.pointerId);
    if (!prev) return;
    const side = avatarStage.getBoundingClientRect().width || 1;
    const dx = ev.clientX - prev.x, dy = ev.clientY - prev.y;
    avPointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (avPinch && avPointers.size >= 2) {
      // Knip: avstanden mellom fingrene styrer zoom, snittbevegelsen panorerer.
      const span = avPointerSpan();
      if (span > 0 && avPinch.span > 0) setAvatarZoom(avPinch.scale * span / avPinch.span);
      avEdit.ox += dx / side / 2; avEdit.oy += dy / side / 2;
    } else {
      avEdit.ox += dx / side; avEdit.oy += dy / side;
    }
    clampAvatarOffset();
    renderAvatarPreview();
  });
  const avPointerEnd = (ev) => {
    avPointers.delete(ev.pointerId);
    if (avPointers.size < 2) avPinch = null;
    if (!avPointers.size) avatarStage.classList.remove('is-panning');
  };
  avatarStage.addEventListener('pointerup', avPointerEnd);
  avatarStage.addEventListener('pointercancel', avPointerEnd);
  avatarStage.addEventListener('wheel', (ev) => {
    if (!avEdit.img) return;
    ev.preventDefault();
    setAvatarZoom(avEdit.scale * (ev.deltaY < 0 ? 1.12 : 1 / 1.12));
  }, { passive: false });
  avatarZoomEl.addEventListener('input', () => setAvatarZoom(parseFloat(avatarZoomEl.value)));
  avatarRotEl.addEventListener('input', () => setAvatarRotation(parseFloat(avatarRotEl.value) || 0));
  avatarRot90.addEventListener('click', () => {
    // Neste kvarte omdreining: retter samtidig opp en skjev vinkel, og lander
    // alltid på et multiplum av 90 (−180..180).
    let deg = Math.floor((parseFloat(avatarRotEl.value) || 0) / 90 + 1e-9) * 90 + 90;
    if (deg > 180) deg -= 360;
    setAvatarRotation(deg);
  });
  avatarRot90.innerHTML = ICONS.restoreArrow;
  window.addEventListener('resize', () => { if (!avatarModal.hidden) renderAvatarPreview(); });
  avatarSaveBtn.addEventListener('click', async () => {
    if (!avEdit.img) return;
    const c = document.createElement('canvas');
    c.width = AVATAR_SIZE; c.height = AVATAR_SIZE;
    drawAvatar(c.getContext('2d'), AVATAR_SIZE);
    const dataUrl = c.toDataURL('image/jpeg', AVATAR_QUALITY);
    closeAvatarEditor();
    await storeAvatar(dataUrl, tr('avatar.updated'));
  });
  avatarCancelBtn.addEventListener('click', closeAvatarEditor);
  avatarCloseBtn.addEventListener('click', closeAvatarEditor);
  avatarModal.addEventListener('click', (ev) => { if (ev.target === avatarModal) closeAvatarEditor(); });

  const pickAvatarFile = () => avatarFileInput.click();
  avatarPickBtn.addEventListener('click', pickAvatarFile);
  accountAvatar.addEventListener('click', pickAvatarFile);
  avatarFileInput.addEventListener('change', () => {
    const f = avatarFileInput.files && avatarFileInput.files[0];
    avatarFileInput.value = ''; // samme fil skal kunne velges to ganger på rad
    if (f) openAvatarEditor(f);
  });
  avatarRemoveBtn.addEventListener('click', async () => {
    if (!myAvatar) return;
    const ok = await askConfirm({
      title: tr('avatar.removeTitle'),
      message: tr('avatar.removeMsg'),
      okLabel: tr('common.remove'),
    });
    if (!ok) return;
    await storeAvatar(null, tr('avatar.removed'));
  });

  function updateInbox(my) {
    const invites = ((my && my.invites_in) || []).filter((inv) => !suppressedInvites.has(inv.id));
    const total = invites.length;
    accountBadge.textContent = String(total);
    accountBadge.hidden = total === 0;
    if (authUser) {
      menuAccount.hidden = false;
      menuEmailPref.hidden = false;
      if (menuTour) menuTour.hidden = false;
      accountEdit.hidden = false;
      paintEmailPref();
      paintAccountForms(false);
      const prof = (my && my.user) || {};
      accountEmail.textContent = personName(prof) || authUser.email || '';
      paintAccountAvatar();
    }
    if (!total) { menuInvites.hidden = true; inviteListEl.innerHTML = ''; return; }
    menuInvites.hidden = false;
    inviteListEl.innerHTML = '';
    const typeLabel = { universe: tr('kind.universe'), group: tr('kind.group') };
    invites.forEach((inv) => {
      const row = document.createElement('div');
      row.className = 'invite-row';
      const info = document.createElement('div');
      info.className = 'invite-info';
      info.innerHTML = '<span class="invite-type-tag">' + (typeLabel[inv.type] || '') + '</span> ' +
        '<span class="invite-name"></span><span class="invite-from"></span>';
      info.querySelector('.invite-name').textContent = inv.name || tr('common.noNameParen');
      // Eierskaps-invitasjoner sier det tydelig — de gir full myndighet.
      info.querySelector('.invite-from').textContent =
        tr(inv.role === 'owner' ? 'invite.asOwnerFrom' : 'invite.from',
          { from: inv.from_name || inv.from || '' });
      const actions = document.createElement('div');
      actions.className = 'invite-actions';
      const acc = document.createElement('button');
      acc.className = 'btn btn-solid btn-accent btn-small'; acc.type = 'button'; acc.textContent = tr('invite.accept');
      acc.addEventListener('click', () => acceptInvite(inv));
      const dec = document.createElement('button');
      dec.className = 'btn btn-small btn-ghost'; dec.type = 'button'; dec.textContent = tr('invite.decline');
      dec.addEventListener('click', () => declineInvite(inv));
      actions.append(acc, dec);
      row.append(info, actions);
      inviteListEl.appendChild(row);
    });
  }

  /* ---------------- Velger-modal (flytting av lister/mapper) ---------------- */
  const placeModal = document.getElementById('place-modal');
  const placeBody = document.getElementById('place-body');
  const placeClose = document.getElementById('place-close');
  function closePlace() { placeModal.hidden = true; updateModalOpenClass2(); }
  placeClose && placeClose.addEventListener('click', closePlace);
  placeModal && placeModal.addEventListener('click', (ev) => { if (ev.target === placeModal) closePlace(); });
  function updateModalOpenClass2() { updateModalOpenClass(); }
  // Generisk liste-velger: hint + klikkbare rader. Brukes av flytt-liste-velgeren
  // (DnD på 📁-breadcrumben).
  function openPicker(hintText, options, emptyMsg, onPick) {
    placeBody.innerHTML = '';
    const hint = document.createElement('p');
    hint.className = 'place-hint';
    hint.textContent = hintText;
    placeBody.appendChild(hint);
    if (!options.length && emptyMsg) {
      const p = document.createElement('p');
      p.className = 'place-hint';
      p.textContent = emptyMsg;
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
  // Aksept krever INGEN plassering: et område havner i «Mine områder» eller
  // «Områder delt med meg» etter rolle, og en mappe enten inne i området
  // (hvis man er områdemedlem) eller i «Mapper delt med meg».
  function acceptInvite(inv) {
    suppressedInvites.add(inv.id);
    updateInbox(lastMy);
    showToast(tr(inv.role === 'owner' ? 'invite.ownershipAccepted' : 'invite.shareAccepted'));
    opQueue.enqueue({
      run: async () => {
        const { error } = await acli().rpc('accept_share_invite', { p_invite: inv.id });
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

  /* ---------------- Del-modal (område/mappe) ----------------
     ÉN visning for alle: medlemslisten er synlig for enhver med tilgang, mens
     invitasjonsfelt, rolle- og medlemsadministrasjon, lås, «Forlat» og «Slett»
     vises etter serverens capabilities (get_members.viewer.caps). Lister,
     kategorier og listepunkter deles aldri — de arver mappens tilgang. */
  const shareModal = document.getElementById('share-modal');
  const shareBody = document.getElementById('share-body');
  const shareTitle = document.getElementById('share-title');
  const shareClose = document.getElementById('share-close');
  const shareBackBtn = document.getElementById('share-back');
  let shareCtx = null;    // { type, id, obj }
  let shareBackTo = null; // gjenåpner modalen del-modalen ble åpnet fra
  // Modalen står ofte åpen mens verden endrer seg under den: mottakeren godtar
  // invitasjonen, en medeier kaster ut noen, noen låser objektet. Den åpne
  // modalen legger igjen sin egen oppdaterer her, og synk-runden kaller den —
  // så medlemslisten følger serveren uten at man må lukke og åpne igjen.
  let shareRefresh = null;
  function refreshOpenShare() { if (shareRefresh) shareRefresh(); }
  function closeShare() {
    shareModal.hidden = true;
    shareCtx = null;
    shareBackTo = null;
    shareRefresh = null;
    updateModalOpenClass2();
  }
  shareClose && shareClose.addEventListener('click', closeShare);
  shareModal && shareModal.addEventListener('click', (ev) => { if (ev.target === shareModal) closeShare(); });
  // Tilbake: lukk del-modalen og gjenåpne nav-modalen. (✕/overlay/Escape lukker
  // helt — da havner man på hovedsiden, ikke i modalen bak.)
  shareBackBtn && shareBackBtn.addEventListener('click', () => {
    const back = shareBackTo;
    closeShare();
    if (back) back();
  });

  const SHARE_TYPE_ICON = { universe: 'globe', group: 'folder' };
  // Objekttypen i bestemt form, slik den leses inne i en setning.
  const typeWord = (type) => tr(type === 'universe' ? 'kindDef.universe' : 'kindDef.group');
  function openShare(type, id, obj, backTo) {
    shareCtx = { type, id, obj };
    shareBackTo = backTo || null;
    if (shareBackBtn) shareBackBtn.hidden = !shareBackTo;
    shareTitle.textContent = '';
    const objSpan = document.createElement('span');
    objSpan.className = 'share-title-obj';
    objSpan.innerHTML = ICONS[SHARE_TYPE_ICON[type]] || '';
    objSpan.appendChild(document.createTextNode(obj.name || obj.title || ''));
    shareTitle.appendChild(objSpan);
    shareTitle.appendChild(document.createTextNode(tr('share.settingsSuffix')));
    shareModal.hidden = false;
    updateModalOpenClass2();
    renderShareModal(type, id, obj, shareBody, closeShare);
  }

  // Avatar for en person: rund sirkel med initialer. Eiere beholder den grønne
  // markeringen; øvrige den nøytrale grå.
  function avatarFor(person, owner) {
    const s = document.createElement('span');
    s.className = 'member-avatar' + (owner ? ' owner' : '');
    paintAvatar(s, person && person.avatar,
      initialsFromName(person && person.display_name, person && person.email));
    return s;
  }
  // Meg selv, fra kontoens egne data — så medlemslisten kan tegnes UMIDDELBART
  // (uten å vente på get_members); resten fylles inn når hentingen lander.
  function mySelfInfo(type, id, obj) {
    const prof = (lastMy && lastMy.user) || {};
    const role = obj._role || 'member';
    const cat = type === 'universe'
      ? (role === 'owner' ? 'universeOwner' : 'universeMember')
      : (role === 'owner' ? 'groupOwner' : 'groupMember');
    return {
      type,
      ownerCount: obj._ownerCount || 1,
      viewer: { id: authUser && authUser.id, role, caps: obj._caps || {} },
      inviteEffective: (obj._invitePolicy || 'inherit') !== 'deny',
      members: [{
        id: authUser && authUser.id,
        email: prof.email || (authUser && authUser.email),
        display_name: prof.display_name || (authUser && authUser.meta && authUser.meta.display_name),
        avatar: myAvatar,
        category: cat, role, direct: true, removable: false, demotable: false,
      }],
      pendingInvites: [],
    };
  }

  // Overskriftene for hver medlemskategori. «Eier» blir «Medeiere» når det er
  // flere — samme backend-rolle, bare et annet visningsnavn.
  function memberCategoryTitle(type, category, count) {
    const many = count > 1;
    if (type === 'universe') {
      return category === 'universeOwner' ? tr(many ? 'share.coOwners' : 'share.owner') : tr('share.members');
    }
    if (category === 'universeOwner') return tr(many ? 'share.coOwnersUniverse' : 'share.ownerUniverse');
    if (category === 'groupOwner') return tr(many ? 'share.coOwnersGroup' : 'share.ownerGroup');
    if (category === 'universeMember') return tr('share.membersUniverse');
    return tr('share.membersGroup');
  }
  const MEMBER_CATEGORY_ORDER = ['universeOwner', 'groupOwner', 'universeMember', 'groupMember'];
  // Hvorfor et medlem ikke kan fjernes HER. Serveren sender koden, klienten
  // teksten — se `get_members` i supabase/users-and-sharing.sql.
  const REMOVE_HINT_KEY = {
    inherited: 'share.removeHintInherited',
    lastOwner: 'share.removeHintLastOwner',
  };

  function renderShareModal(type, id, obj, body, closeFn) {
    body.innerHTML = '';
    // Lokalt anslag straks (umiddelbar visning); serverens capabilities er
    // autoritative og overstyrer når get_members lander. Anslaget følger den
    // LOKALE rollen — aldri «alt er lov». Svarer serveren uten capabilities
    // (en eldre server, eller en database der migreringen ikke har kjørt
    // ennå), skal et vanlig medlem ikke se eier-kontroller det uansett ville
    // blitt avvist på: vi feiler heller lukket og lar serveren åpne opp.
    const mine = privilegedLocal(obj);
    let caps = Object.assign({}, obj._caps || {
      invite: true, inviteOwner: mine, manageMembers: mine, manageOwners: mine,
      manageLock: mine, managePolicy: mine, lockException: mine,
      delete: mine, leave: !mine,
    });

    /* --- Inviter på e-post (medlem eller eier) --- */
    const form = document.createElement('form');
    form.className = 'share-invite-form';
    const input = document.createElement('input');
    input.className = 'field';
    input.type = 'email'; input.placeholder = tr('share.invitePlaceholder'); input.required = true;
    input.setAttribute('aria-label', tr('share.inviteAria'));
    const roleSel = document.createElement('select');
    roleSel.className = 'field share-role-select';
    roleSel.setAttribute('aria-label', tr('share.roleAria'));
    [['member', tr('share.asMember')],
      ['owner', tr(type === 'universe' ? 'share.asCoOwner' : 'share.asCoOwnerGroup')]]
      .forEach(([v, label]) => {
        const o = document.createElement('option');
        o.value = v; o.textContent = label;
        roleSel.appendChild(o);
      });
    const btn = document.createElement('button');
    btn.className = 'btn btn-solid btn-accent btn-small'; btn.type = 'submit'; btn.textContent = tr('share.invite');
    form.append(input, roleSel, btn);

    /* --- Invitasjonspolicy: la vanlige medlemmer invitere flere --- */
    const policyRow = document.createElement('div');
    policyRow.className = 'share-policy-row';
    const policyLabel = document.createElement('label');
    policyLabel.className = 'share-policy-label';
    const policyCb = document.createElement('input');
    policyCb.type = 'checkbox';
    const policyTxt = document.createElement('span');
    policyTxt.textContent = tr('share.policyLabel', { kind: typeWord(type) });
    policyLabel.append(policyCb, policyTxt);
    const policyNote = document.createElement('p');
    policyNote.className = 'share-policy-note'; policyNote.hidden = true;
    policyRow.append(policyLabel, policyNote);
    const msg = document.createElement('p');
    msg.className = 'share-msg'; msg.hidden = true;
    let sentEmail = null; // e-posten kvitteringen i `msg` gjelder, mens den venter

    let inviteEffective = (obj._invitePolicy || 'inherit') !== 'deny';
    function applyPerm() {
      form.hidden = !(caps.invite || caps.inviteOwner);
      roleSel.hidden = !caps.inviteOwner;
      if (!caps.inviteOwner) roleSel.value = 'member';
      policyRow.hidden = !(caps.invite || caps.inviteOwner);
      if (!policyOverrides.has(id)) policyCb.checked = !!inviteEffective;
      policyCb.disabled = !caps.managePolicy;
      policyNote.hidden = caps.managePolicy || policyRow.hidden;
      if (!policyNote.hidden) {
        policyNote.textContent = tr(inviteEffective ? 'share.policyOn' : 'share.policyOff');
      }
    }
    policyCb.addEventListener('change', () => {
      const prev = obj._invitePolicy || 'inherit';
      const want = policyCb.checked ? 'allow' : 'deny';
      obj._invitePolicy = want; inviteEffective = policyCb.checked;
      policyOverrides.set(id, want);
      const key = 'policy:' + type + ':' + id;
      opQueue.enqueue({
        key,
        waitFor: () => rowKnownToServer(id),
        run: async () => {
          const w = policyOverrides.has(id) ? policyOverrides.get(id) : want;
          const { error } = await acli().rpc('set_invite_policy', { p_type: type, p_id: id, p_policy: w });
          if (error) throw error;
        },
        onDone: () => { if (!opQueue.hasPending(key)) { policyOverrides.delete(id); scheduleCloud(0); } },
        onError: (e) => {
          policyOverrides.delete(id);
          obj._invitePolicy = prev; inviteEffective = prev !== 'deny';
          if (policyCb.isConnected) applyPerm();
          showToast(friendlyAuthError(e)); scheduleCloud(0);
        },
      });
    });

    /* --- Lås / unntak --- */
    const lockRow = document.createElement('div');
    lockRow.className = 'share-lock-row';
    const lockBtn = document.createElement('button');
    lockBtn.className = 'btn btn-solid btn-yellow btn-small'; lockBtn.type = 'button';
    lockRow.innerHTML = '<div><span class="share-lock-title">' +
      '<span class="share-lock-icon"></span><span class="share-lock-label"></span></span>' +
      '<span class="share-lock-hint"></span></div>';
    const lockIcon = lockRow.querySelector('.share-lock-icon');
    const lockLabel = lockRow.querySelector('.share-lock-label');
    const lockHint = lockRow.querySelector('.share-lock-hint');
    // Nærmeste eksplisitte tilstand vinner: en EGEN lås på objektet går foran en
    // arvet lås, så vi viser den vanlige av/på-låsen (ikke unntaks-grenen).
    const effInheritedLock = () => (obj._locked ? null : inheritedLockInfo(type, obj));
    const paintLock = () => {
      const anc = effInheritedLock();
      lockRow.classList.toggle('is-inherited', !!anc);
      if (!anc) {
        lockIcon.innerHTML = obj._locked ? ICONS.lock : ICONS.unlock;
        lockLabel.textContent = tr(obj._locked ? 'lock.lockedForEditing' : 'lock.openForEditingState');
        lockHint.textContent = tr(obj._locked ? 'lock.othersCanView' : 'lock.everyoneCanEdit');
        lockBtn.textContent = tr(obj._locked ? 'lock.openNow' : 'lock.lockNow');
        lockBtn.hidden = !caps.manageLock;
        return;
      }
      const ex = !!obj._unlocked;
      lockIcon.innerHTML = ex ? ICONS.unlock : ICONS.lock;
      lockLabel.textContent = ex
        ? tr('lock.exceptionLabel', { kind: typeWord(type) })
        : tr('lock.autoLocked');
      lockHint.textContent = '';
      const ancIcon = document.createElement('span');
      ancIcon.className = 'share-lock-anc-icon';
      ancIcon.innerHTML = ICONS[SHARE_TYPE_ICON[anc.type]] || '';
      lockHint.appendChild(document.createTextNode(ex ? '' : tr('lock.becausePrefix')));
      lockHint.appendChild(ancIcon);
      lockHint.appendChild(document.createTextNode(' ' + (anc.obj.name || anc.obj.title || '')));
      lockHint.appendChild(document.createTextNode(
        tr(ex ? 'lock.isLockedExempt' : 'lock.isLocked')));
      lockBtn.textContent = tr(ex ? 'lock.removeExceptionShort' : 'lock.makeExceptionShort');
      lockBtn.hidden = !caps.lockException;
    };
    lockRow.appendChild(lockBtn);
    lockBtn.addEventListener('click', () => {
      toggleObjLock(type, id, obj, !!effInheritedLock(),
        () => { if (lockBtn.isConnected) paintLock(); });
    });

    /* --- Medlemsliste + ventende invitasjoner --- */
    const membersWrap = document.createElement('div');
    membersWrap.className = 'share-members';
    const optimisticRows = new Set(); // «Venter på svar» mens invitasjonen ligger i køen
    const actionsWrap = document.createElement('div');
    actionsWrap.className = 'share-actions';

    // Signaturen av det serversvaret radene sist ble tegnet fra (se
    // refreshMembers). Enhver OPTIMISTISK endring — en rad fjernet, en knapp
    // deaktivert — gjør at DOM-en ikke lenger stemmer med det svaret, og må
    // nullstille den: avviser serveren operasjonen, kommer det SAMME svaret
    // tilbake, og uten nullstillingen ville gjentegningen som skal rulle
    // endringen tilbake blitt hoppet over.
    let membersSig = null;
    const optimisticEdit = () => { membersSig = null; };

    function memberRow(mbr) {
      const row = document.createElement('div');
      row.className = 'member-row';
      const box = document.createElement('div'); box.className = 'member-info';
      box.innerHTML = '<span class="member-name"></span><span class="member-role"></span>';
      const me = authUser && mbr.id === authUser.id;
      box.querySelector('.member-name').textContent =
        me ? tr('share.you', { name: personName(mbr) }) : personName(mbr);
      box.querySelector('.member-role').textContent = tr(mbr.role === 'owner' ? 'share.roleOwner' : 'share.roleMember');
      // Forklar hvorfor en bruker ikke kan fjernes HER — men bare for den som
      // faktisk administrerer medlemmer, og aldri om seg selv.
      if ((mbr.removeHintCode || mbr.removeHint) && caps.manageMembers && !me) {
        const hint = document.createElement('span');
        hint.className = 'member-hint';
        // Serveren sender en språknøytral kode (`removeHintCode`) som vi
        // oversetter selv; `removeHint` er den gamle, norske teksten og brukes
        // kun hvis koden mangler (en server som ennå ikke er migrert).
        hint.textContent = REMOVE_HINT_KEY[mbr.removeHintCode]
          ? tr(REMOVE_HINT_KEY[mbr.removeHintCode]) : mbr.removeHint;
        box.appendChild(hint);
      }
      row.classList.toggle('is-inherited', mbr.direct === false);
      row.append(avatarFor(mbr, mbr.role === 'owner'), box);
      // Rolleløft: eierskap kan ikke settes på noen — det gis alltid via en
      // invitasjon mottakeren må godta. Knappen sender derfor en EIER-
      // invitasjon til et medlem som allerede er inne, og raden havner under
      // «Ventende invitasjoner» til den er godtatt.
      if (mbr.promotable) {
        const promote = document.createElement('button');
        promote.className = 'btn btn-small btn-ghost'; promote.type = 'button';
        promote.textContent = tr('share.promote');
        promote.addEventListener('click', async () => {
          if (!await askConfirm({
            title: tr('share.promoteTitle'),
            message: tr('share.promoteMsg', { name: personName(mbr), kind: typeWord(type) }),
            okLabel: tr('share.promoteOk'),
          })) return;
          promote.disabled = true; optimisticEdit();
          opQueue.enqueue({
            run: async () => {
              const { error } = await acli().rpc('create_share_invite',
                { p_type: type, p_id: id, p_email: mbr.email, p_role: 'owner' });
              if (error) throw error;
            },
            onDone: () => {
              showToast(tr('share.promoteSent', { name: personName(mbr) }));
              refreshMembers();
            },
            onError: (e) => { showToast(friendlyAuthError(e)); refreshMembers(); },
          });
        });
        row.appendChild(promote);
      }
      // Degradering: eierskap NEDOVER er en direkte handling (rolleløft krever
      // alltid en invitasjon mottakeren må godta).
      if (mbr.demotable) {
        const demote = document.createElement('button');
        demote.className = 'btn btn-small btn-ghost'; demote.type = 'button';
        demote.textContent = tr(me ? 'share.stepDown' : 'share.demote');
        demote.addEventListener('click', async () => {
          if (!await askConfirm({
            title: tr(me ? 'share.stepDown' : 'share.demoteTitle'),
            message: me ? tr('share.stepDownMsg') : tr('share.demoteMsg', { name: personName(mbr) }),
            okLabel: tr(me ? 'share.stepDownOk' : 'share.demote'),
          })) return;
          opQueue.enqueue({
            run: async () => {
              const { error } = await acli().rpc('set_member_role',
                { p_type: type, p_id: id, p_user: mbr.id, p_role: 'member' });
              if (error) throw error;
            },
            onDone: () => { refreshMembers(); scheduleCloud(0); },
            onError: (e) => { showToast(friendlyAuthError(e)); refreshMembers(); },
          });
        });
        row.appendChild(demote);
      }
      // «Fjern» gjelder ANDRE. Å fjerne seg selv er å forlate, og den
      // handlingen har sin egen knapp lenger nede — to knapper for det samme,
      // der den ene er feilmerket, er verre enn én.
      if (mbr.removable && !me) {
        const kick = document.createElement('button');
        kick.className = 'btn btn-solid btn-red btn-small'; kick.type = 'button'; kick.textContent = tr('common.remove');
        kick.addEventListener('click', async () => {
          if (!await askConfirm({
            title: tr('share.removeMemberTitle'),
            message: tr('share.removeMemberMsg', { name: personName(mbr), kind: typeWord(type) }),
            okLabel: tr('common.remove'),
          })) return;
          row.remove(); optimisticEdit(); // refreshMembers gjenoppretter hvis serveren avviser
          opQueue.enqueue({
            run: async () => {
              const { error } = await acli().rpc('revoke_share', { p_type: type, p_id: id, p_user: mbr.id });
              if (error) throw error;
            },
            onDone: () => { refreshMembers(); scheduleCloud(0); },
            onError: (e) => { showToast(friendlyAuthError(e)); refreshMembers(); },
          });
        });
        row.appendChild(kick);
      }
      return row;
    }

    function renderMembers(inf) {
      membersWrap.innerHTML = '';
      const byCat = new Map();
      (inf.members || []).forEach((m) => {
        if (!byCat.has(m.category)) byCat.set(m.category, []);
        byCat.get(m.category).push(m);
      });
      MEMBER_CATEGORY_ORDER.forEach((catKey) => {
        const list = byCat.get(catKey);
        if (!list || !list.length) return;   // tomme kategorier utelates
        const t = document.createElement('div');
        t.className = 'share-section-title';
        t.textContent = memberCategoryTitle(type, catKey, list.length);
        membersWrap.appendChild(t);
        list.forEach((m) => membersWrap.appendChild(memberRow(m)));
      });
      const pending = (inf.pendingInvites || []);
      if (pending.length || optimisticRows.size) {
        const t = document.createElement('div');
        t.className = 'share-section-title'; t.textContent = tr('share.pendingInvites');
        membersWrap.appendChild(t);
      }
      pending.forEach((inv) => {
        const row = document.createElement('div');
        row.className = 'member-row member-pending';
        const box = document.createElement('div'); box.className = 'member-info';
        box.innerHTML = '<span class="member-name"></span><span class="member-role"></span>';
        box.querySelector('.member-name').textContent = inv.email;
        box.querySelector('.member-role').textContent =
          tr(inv.role === 'owner' ? 'share.invitedAsOwner' : 'share.invitedAsMember');
        row.append(avatarFor({ email: inv.email }, false), box);
        if (caps.manageMembers || inv.mine) {
          const cancel = document.createElement('button');
          cancel.className = 'btn btn-small btn-ghost'; cancel.type = 'button'; cancel.textContent = tr('share.withdraw');
          cancel.addEventListener('click', () => {
            row.remove(); optimisticEdit(); // optimistisk
            opQueue.enqueue({
              run: async () => {
                const { error } = await acli().rpc('revoke_share_invite', { p_invite: inv.id });
                if (error) throw error;
              },
              onDone: refreshMembers,
              onError: (e) => { showToast(friendlyAuthError(e)); refreshMembers(); },
            });
          });
          row.appendChild(cancel);
        }
        membersWrap.appendChild(row);
      });
      optimisticRows.forEach((r) => membersWrap.appendChild(r));
    }

    /* --- Forlat / slett --- */
    function renderActions() {
      actionsWrap.innerHTML = '';
      if (caps.leave) {
        const leave = document.createElement('button');
        // Samme ikon som «logg ut», men med korrekt tilgjengelig navn.
        leave.className = 'btn btn-solid btn-red share-leave'; leave.type = 'button';
        leave.innerHTML = ICONS.logout || '';
        const leaveLabel = tr('leave.title', { kind: typeWord(type) });
        leave.appendChild(document.createTextNode(' ' + leaveLabel));
        leave.setAttribute('aria-label', leaveLabel);
        leave.addEventListener('click', async () => {
          if (!await askConfirm({
            title: tr('leave.title', { kind: typeWord(type) }),
            message: tr('leave.messageShort'),
            okLabel: tr('leave.ok'),
          })) return;
          if (closeFn) closeFn();
          removeSharedLocally(id);
          cloudLeave(type, id);
          render();
          save();
        });
        actionsWrap.appendChild(leave);
      }
      if (caps.delete) {
        const del = document.createElement('button');
        del.className = 'btn btn-solid btn-red share-delete'; del.type = 'button';
        // Søppelkasse-glyf + tekst, samme oppsett som «Slett konto» i konto-
        // modalen: de to mest endelige knappene i appen skal se like ut, så
        // formen alene sier «dette sletter noe» før man har lest etiketten.
        const delLabel = tr('share.deleteForAllLabel', { kind: typeWord(type) });
        del.innerHTML = ICONS.trashGlyph || '';
        del.appendChild(document.createTextNode(' ' + delLabel));
        del.setAttribute('aria-label', delLabel);
        del.addEventListener('click', async () => {
          if (!await askConfirm({
            title: tr('share.deleteForAll'),
            message: tr('share.deleteForAllMsg', { kind: typeWord(type) }),
            okLabel: tr('share.deleteForAll'),
          })) return;
          if (closeFn) closeFn();
          const live = findAnyById(id);
          if (!live) return;
          if (type === 'universe') deleteUniverse(live.obj);
          else deleteGroup(live.obj);
        });
        actionsWrap.appendChild(del);
      }
      // Én forklarende linje når man verken kan forlate eller slette.
      if (!caps.leave && !caps.delete && obj._role === 'owner' && type === 'universe') {
        const note = document.createElement('p');
        note.className = 'share-policy-note';
        note.textContent = tr('share.onlyOwnerNote');
        actionsWrap.appendChild(note);
      }
    }

    /* Én runde mot `get_members`. Kalles ved åpning, etter egne handlinger OG
       fra hver synk-runde (`refreshOpenShare`) — modalen skal vise serverens
       nåtilstand, ikke et øyeblikksbilde fra da den ble åpnet.

       To vakter gjør den løpende oppfriskningen trygg:
       * `membersSig` — tegn bare om når svaret faktisk er et ANNET enn det
         radene står med nå. Uten den ville hvert poll revet radene ut av
         DOM-en midt i et klikk (samme grep som `lastViewSig` i cloudCycle).
         En optimistisk endring nullstiller den, se `optimisticEdit`.
       * `membersBusy`/`membersAgain` — én runde av gangen; en forespørsel som
         kom mens en annen var i lufta tas igjen etterpå i stedet for å falle
         på gulvet. */
    let membersBusy = false, membersAgain = false;
    async function refreshMembers() {
      if (membersBusy) { membersAgain = true; return; }
      membersBusy = true;
      // Fanget FØR svaret: en runde som alt var i lufta da invitasjonen ble
      // sendt vet ingenting om den, og skal ikke fjerne kvitteringen for den.
      const wasSent = sentEmail;
      try {
        const { data } = await acli().rpc('get_members', { p_type: type, p_id: id });
        if (!data) return;
        if (!shareCtx || shareCtx.id !== id) return; // modalen er lukket eller viser noe annet nå
        // Hver anvendte pull bygger `state` på nytt (applyMyDoc), så objektet
        // modalen ble åpnet med er en forlatt kopi. Lås, rolle og policy leses
        // derfor fra den LEVENDE raden.
        const live = findAnyById(id);
        if (live && live.obj) obj = live.obj;
        if (data.viewer && data.viewer.caps) caps = data.viewer.caps;
        if (!policyOverrides.has(id) && 'inviteEffective' in data) inviteEffective = !!data.inviteEffective;
        // «Invitasjonen er sendt» gjelder bare så lenge den ligger og venter.
        // Er den besvart — godtatt (personen står i listen nå) eller avslått —
        // skal ikke modalen fortsatt påstå at den er underveis.
        if (wasSent && wasSent === sentEmail
            && !(data.pendingInvites || []).some((i) => (i.email || '').toLowerCase() === wasSent)) {
          sentEmail = null;
          msg.textContent = ''; msg.classList.remove('ok'); msg.hidden = true;
        }
        const anc = effInheritedLock();
        const sig = canonical(data) + '||' + (obj._role || '') +
          (obj._locked ? 'L' : '') + (obj._unlocked ? 'U' : '') + (anc ? ':' + anc.obj.id : '');
        if (sig === membersSig) return;
        membersSig = sig;
        applyPerm();
        paintLock();
        renderMembers(data);
        renderActions();
      } catch (e) { /* behold forrige */ }
      finally {
        membersBusy = false;
        // En runde som ble bedt om mens en annen var i lufta tas igjen — men
        // ikke for en modal som er lukket i mellomtiden.
        if (membersAgain) {
          membersAgain = false;
          if (shareCtx && shareCtx.id === id) refreshMembers();
        }
      }
    }

    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const email = input.value.trim().toLowerCase();
      if (!email) return;
      const role = roleSel.value === 'owner' ? 'owner' : 'member';
      input.value = '';
      msg.textContent = ''; msg.classList.remove('ok'); msg.hidden = true;
      // Optimistisk: raden vises straks, feltet er klart for neste e-post.
      const row = document.createElement('div');
      row.className = 'member-row member-pending';
      const box = document.createElement('div'); box.className = 'member-info';
      box.innerHTML = '<span class="member-name"></span><span class="member-role"></span>';
      box.querySelector('.member-name').textContent = email;
      box.querySelector('.member-role').textContent =
        tr(role === 'owner' ? 'share.invitedAsOwner' : 'share.invitedAsMember');
      const cancel = document.createElement('button');
      cancel.className = 'btn btn-small btn-ghost'; cancel.type = 'button'; cancel.textContent = tr('share.withdraw');
      row.append(avatarFor({ email }, false), box, cancel);
      optimisticRows.add(row);
      membersWrap.appendChild(row);
      const op = opQueue.enqueue({
        waitFor: () => rowKnownToServer(id), // et nyopprettet objekt må først være pushet
        run: async () => {
          const { data, error } = await acli().rpc('create_share_invite',
            { p_type: type, p_id: id, p_email: email, p_role: role });
          if (error) throw error;
          return data;
        },
        onDone: () => {
          optimisticRows.delete(row);
          msg.textContent = tr('share.inviteSent', { email: email }); msg.classList.add('ok'); msg.hidden = false;
          sentEmail = email;
          refreshMembers();
        },
        onError: (e) => {
          optimisticRows.delete(row);
          row.remove(); optimisticEdit();
          sentEmail = null;
          msg.textContent = friendlyAuthError(e); msg.hidden = false;
        },
      });
      cancel.addEventListener('click', () => {
        optimisticRows.delete(row);
        row.remove(); optimisticEdit();
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

    body.append(form, policyRow, msg, membersWrap, lockRow, actionsWrap);
    applyPerm();
    paintLock();
    renderMembers(mySelfInfo(type, id, obj)); // deg selv vises straks
    renderActions();
    shareRefresh = refreshMembers;             // hver synk-runde friskes modalen opp
    refreshMembers();                          // resten + autoritative capabilities
  }

  /* ---------------- Start/stopp av kontomodus ---------------- */
  function cacheKey() { return authUser ? STORAGE_KEY + ':' + authUser.id : STORAGE_KEY; }
  // ALL lokal synk-tilstand nullstilles sammen: innhold, gravsteiner OG basen.
  // De hører til én og samme bruker, og en base fra forrige konto ville fått
  // fletteren til å tro at den nye kontoens manglende rader var slettet.
  function resetLocalSync() {
    state.universes = [];
    state._tomb = emptyTomb();
    state._base = null;
    state._baseV = 0;
    cloudBase = null;
    persistedBaseSig = null;
    unknownHistory = new Set();
    validateActive(state);
  }
  // Alle id-ene i et (nestet) state-tre — brukes til å merke hvilke rader som
  // kom fra en cache uten base, altså har ukjent historikk.
  function allStateIds(s) {
    const set = new Set();
    (s.universes || []).forEach((u) => {
      set.add(u.id);
      (u.groups || []).forEach((g) => {
        set.add(g.id);
        (g.cards || []).forEach((c) => {
          set.add(c.id);
          (c.items || []).forEach((it) => set.add(it.id));
        });
      });
    });
    return set;
  }
  function loadCache() {
    try {
      const raw = localStorage.getItem(cacheKey());
      if (!raw) return false;
      const s = JSON.parse(raw);
      if (!s || !Array.isArray(s.universes)) return false;
      normalize(s);
      state.universes = s.universes;
      // Gravsteinene og basen tas ALLTID fra den lastede posten (ikke «|| det vi
      // hadde»): faller vi tilbake på det som lå i minnet, arver en ny konto
      // forrige brukers gravsteiner.
      state._tomb = s._tomb && typeof s._tomb === 'object' ? s._tomb : emptyTomb();
      ['universes', 'groups', 'cards', 'items'].forEach((k) => {
        if (!state._tomb[k] || typeof state._tomb[k] !== 'object') state._tomb[k] = {};
      });
      state._hlc = s._hlc || 0;
      // Basen brukes kun hvis versjonen stemmer OG den ser ut som et doc — en
      // base vi ikke stoler på skal gi «ukjent historikk», ikke gjetning.
      const base = (s._baseV === BASE_VERSION && s._base && Array.isArray(s._base.universes)) ? s._base : null;
      cloudBase = base;
      state._base = base;
      state._baseV = base ? BASE_VERSION : 0;
      persistedBaseSig = base ? canonical(base) : null;
      // Uten base vet vi ikke om disse radene er laget her eller slettet et
      // annet sted — de må sjekkes mot serverens gravsteiner før de skrives.
      unknownHistory = base ? new Set() : allStateIds(state);
      validateActive(state);
      return true;
    } catch (e) { return false; }
  }

  // Hvilken bruker den lokale synk-tilstanden er lastet FOR (ikke bare «er den
  // lastet»): Supabase kan gå rett fra én innlogget bruker til en annen uten en
  // SIGNED_OUT imellom, og da må innhold, gravsteiner og base byttes ut — ellers
  // ville den nye kontoen arvet forrige brukers historikk.
  let cloudStartedFor = null;
  async function cloudStart() {
    // Språket først: lander kontoen på et annet språk enn enheten står på,
    // lastes appen på nytt her — før det bygges noe UI som måtte rives ned igjen.
    adoptAccountLanguage();
    document.body.classList.remove('no-auth');
    authScreen.hidden = true;
    // Passordet har gjort jobben sin. La det ikke bli stående i feltet — med
    // «vis passordet» slått på ville det ellers ligget i klartekst på
    // innloggingsskjermen neste gang den vises (etter utlogging).
    clearPassFields([authPassword]);
    if (cloudStartedFor !== authUser.id) {
      cloudStartedFor = authUser.id;
      // Nullstill FØRST, last så denne brukerens egen post: uten buffer starter
      // vi helt tomt (og med ukjent historikk), aldri på noe fra en annen konto.
      // (Supabase kan gå rett fra én bruker til en annen uten SIGNED_OUT, så
      // profilbildet må nullstilles her og ikke bare i cloudStop.)
      myAvatar = null; avatarPainted = null;
      resetLocalSync();
      loadCache();
      render();
    }
    lastViewSig = null; // tving en full første render ved (ny) innlogging
    migrationChecked = false;
    navRestored = false; // gjenopprett husket posisjon ved neste (første) pull
    loadMyAvatar();      // eget kall: bildet ligger ikke i det pollede doc-et
    startCloudRealtime();
    startCloudPoll();
    syncStatus.start();
    await cloudCycle();
    // Demoen kommer FØR pollet rekker en ny runde, men etter at første pull har
    // malt board-et — ellers ville en runde landet midt i simuleringen. Den
    // vises kun hvis kontoen ikke har sett den (docs/introduksjon.md).
    maybeStartOnboarding();
  }
  function cloudStop() {
    clearInterval(cloudPoll);
    clearTimeout(cloudDebounce); cloudDebounce = null;
    if (cloudChan && aclient) { try { aclient.removeChannel(cloudChan); } catch (e) {} }
    cloudChan = null; cloudRt = false; lastMy = null; lastViewSig = null;
    cloudStartedFor = null;
    shareGroupCache.clear(); shareGroupLoading.clear();
    // Køede operasjoner tilhører den utloggede sesjonen — dropp dem (de ville
    // uansett blitt avvist uten sesjon) og nullstill de optimistiske overlayene.
    opQueue.clear();
    lockOverrides.clear(); unlockOverrides.clear(); policyOverrides.clear();
    posOverrides.clear(); pendingGroupMoves.clear(); suppressedRows.clear();
    suppressedInvites.clear();
    // Skrivefeilene gjaldt den utloggede sesjonen — la en ny sesjon melde fra
    // på nytt hvis databasen fortsatt henger etter. Avvisnings-tellerne er
    // per rad, og en ny konto kan ha helt andre rettigheter på samme rad, så de
    // nullstilles også (ellers ville terskelen kunne nås for tidlig).
    // syncStatus.stop() tømmer avvisningene og skjuler statuslinjen: den skal
    // ikke stå igjen og påstå noe om en konto som ikke er logget inn lenger.
    schemaMismatchLogged.clear();
    rejectCounts.clear();
    syncStatus.stop();
    /* Demoen tilhørte den utloggede kontoen. Uten dette blir laget, tidsuret og
       `body.tour-demo` stående for NESTE konto som logger inn — og verre:
       simuleringen ville blitt stående på, så alt den neste gjorde forsvant i
       stedet for å bli lagret. `resetTourState()` avvikler den uten å skrive
       noe; den halve runden skal verken merkes som sett eller gjelde noen andre. */
    resetTourState();
    authUser = null;
    // Innhold, gravsteiner og base tømmes SAMMEN. Cachen på disken er nøklet
    // per bruker og røres ikke (samme konto får sitt igjen ved neste innlogging)
    // — men ingenting av forrige brukers synk-tilstand skal ligge igjen i minnet
    // og bli lest som historikk for den neste som logger inn.
    resetLocalSync();
    document.body.classList.add('no-auth');
    authScreen.hidden = false;
    setAuthMode('login');
    menuAccount.hidden = true;
    menuEmailPref.hidden = true;
    if (menuTour) menuTour.hidden = true;
    menuInvites.hidden = true;
    accountBadge.hidden = true;
    accountEdit.hidden = true;
    setAccountMsg('');
    // Profilbildet og et evt. skrevet passord tilhørte den utloggede kontoen.
    myAvatar = null; avatarPainted = null;
    clearPassFields([accountPassCurrent, accountPassNew]);
    // Lukk evt. åpne modaler — de tilhørte den utloggede sesjonen. Demoen
    // avsluttes uten å lagre noe: den hører til kontoen som nettopp logget ut.
    resetTourState();
    closeNavModal(); closeAccount(); closeAvatarEditor();
  }

  // Dyplenke fra en delings-e-post til en UREGISTRERT mottaker: ?signup=<e-post>
  // åpner registreringssiden med e-posten utfylt, så mottakeren oppretter konto
  // og deretter godtar delingen i appen (invitasjonen kobles på e-post).
  function applySignupInvite() {
    const m = /[?&]signup=([^&]+)/.exec(location.search);
    if (!m) return;
    let email = '';
    try { email = decodeURIComponent(m[1]); } catch (e) { email = m[1]; }
    if (!email) return;
    setAuthMode('register');
    authEmail.value = email;
    authMsg(tr('auth.inviteSignup'), true);
  }

  async function initAccounts() {
    const client = acli();
    if (!client) {
      // Supabase er ikke konfigurert (skal ikke skje i produksjon) — vis
      // auth-skjermen med en tydelig feilmelding i stedet for et tomt board.
      document.body.classList.add('no-auth');
      authScreen.hidden = false;
      setAuthMode('login');
      authMsg(tr('auth.unavailable'));
      return;
    }
    document.body.classList.add('no-auth');
    authScreen.hidden = false;
    setAuthMode('login');
    applySignupInvite();
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

  /* ---------------- «Er det trygt å laste siden på nytt nå?» ----------------
     Ett samlet signal, satt sammen av de tilstandene appen ALLEREDE fører — ikke
     av gjetting på DOM-en (et fokusert input-felt sier for lite og for mye på én
     gang). Brukes av den automatiske klient-oppdateringen (update-check.js):
     en reload midt i en usynket endring ville kastet den, så vi svarer «nei»
     med mindre vi positivt vet at alt er landet.

     FAIL CLOSED: alt vi ikke kan fastslå regnes som utrygt.

     Utrygt når:
       • enheten er offline (endringer kan ikke ha nådd serveren)
       • et drag pågår, eller et navn/listepunkt redigeres inline (isBusyEditing)
       • en modal/velger står åpen (brukeren er midt i noe, og reload lukker den)
       • innloggingsskjemaet har tekst i seg (halvutfylt registrering/innlogging)
       • en sletting ligger i angre-bufferet (ennå ikke skrevet til databasen)
       • den debouncede localStorage-skrivingen ikke har kjørt ennå
       • operasjonskøen (deling/lås/mount) har noe på gang
       • en synk-runde kjører, er planlagt, eller ba om en ny runde
       • det finnes lokale endringer serveren ikke har kvittert for (saveSeq)
       • vi er innlogget uten å ha fått ett eneste svar fra serveren ennå */
  const SAFETY_MODALS = () => [navModal, accountModal, trashModal, objMenuOverlay,
    shareModal, placeModal, confirmModalEl, avatarModal, delAccountModal,
    respSwitcherOverlay, timeSwitcherOverlay, tourEl];
  function authFormDirty() {
    if (authScreen.hidden) return false;
    return [authEmail, authFirstName, authLastName, authPassword]
      .some((el) => el && !el.hidden && el.value.trim() !== '');
  }
  function updateSafety() {
    const no = (reason) => ({ safe: false, reason });
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return no('offline');
    if (drag.active) return no('drag');
    if (isBusyEditing()) return no('editing');
    if (SAFETY_MODALS().some((el) => el && !el.hidden)) return no('modal');
    if (authFormDirty()) return no('auth-form');
    if (pendingDeletes.size || deleteToast) return no('pending-delete');
    if (saveTimer) return no('unsaved');
    if (opQueue.busy()) return no('queue');
    if (authUser) {
      if (!lastMy) return no('sync-unknown');
      if (cloudRunning || cloudAgain || cloudDebounce) return no('syncing');
      if (saveSeq !== syncedSeq) return no('unsynced');
    }
    return { safe: true, reason: '' };
  }

  /* ============================================================
     DEMONSTRASJONEN FOR NYE BRUKERE
     ------------------------------------------------------------
     Autoritativt: docs/introduksjon.md.

     To deler, med ulik tyngde:

       1. DEMOEN — én sammenhengende runde gjennom alt man gjør i Huskis:
          opprette område → mappe → liste → listepunkter → kategori, prøve
          dra-og-slipp på begge nivåer, løse opp kategorien, og til slutt
          slette og tømme seg tilbake til utgangspunktet.

          Den kjører i en SIMULERING. Brukerens egne objekter legges til side
          (`demoSaved`), `state` får et tomt tre demoen bygger i, og alt rives
          ned igjen når demoen er over. Ingenting skrives til den lokale
          bufferen, kontoen eller databasen mens den står på — se `demoActive`
          og vaktene i save()/saveLocal()/scheduleCloud()/cloudCycle()/
          saveNavPref()/cloudLeave(). Det gjør demoen lik for alle: en tom
          konto og en konto med tre hundre lister ser nøyaktig det samme, og
          ingen kan miste noe på et bomtrykk.

          Hvert steg MÅ utføres. Det finnes ingen «neste» og ingen «hopp over
          steget»: `demoGate` slipper bare gjennom pekeren og tastene som
          treffer kontrollen steget faktisk handler om — alt annet svelges, så
          man verken kan slette når sletting ikke demonstreres, kollapse et
          kort når kollapsing ikke demonstreres, eller navigere seg bort fra
          steget. Man kan gå ETT steg tilbake, og da rulles tilstanden tilbake
          til slik den var da det steget begynte (`demoSnaps`), slik at
          handlingen kan gjøres om.

          Instruksjonen vises ALDRI før navigasjonen den forrige handlingen
          utløste er ferdig: `demoReady()` krever at riktig modal er åpen/
          lukket OG at målet finnes og er synlig, og kortet står skjult til da.

       2. TIPSENE — de avanserte gestene (trykk-og-hold, sveip, dra til
          navigasjonsknappen) læres bort først når de faktisk er relevante, ett
          kort tips om gangen, i den vanlige toasten. Et tips fortrenger aldri
          en melding som allerede står, avbryter aldri en redigering og fanger
          aldri fokus.

     Begge deler huskes på KONTOEN (`user_metadata`), ikke per enhet. */
  const TOUR_VERSION = 3;    // v1 = passiv omvisning, v2 = innføring i ekte data, v3 = demoen
  const TIP_QUIET_MS = 6000; // ro mellom to tips (ett budskap om gangen)
  /* Steget venter på en TILSTAND, ikke på en hendelse: objektet kan dukke opp
     fra en inline-navngiving, et slipp eller en angret sletting. Å lytte på
     alle veiene dit ville vært en liste som råtner; ett billig intervall som
     stiller det samme spørsmålet råtner ikke. */
  const DEMO_POLL_MS = 120;

  const tourEl = document.getElementById('tour');
  const tourArrow = document.getElementById('tour-arrow');
  const tourCard = document.getElementById('tour-card');
  const tourTitleEl = document.getElementById('tour-title');
  const tourTextEl = document.getElementById('tour-text');
  const tourNoteEl = document.getElementById('tour-note');
  const tourProgressEl = document.getElementById('tour-progress');
  const tourProgressFill = document.getElementById('tour-progress-fill');
  const tourActionsEl = tourCard.querySelector('.tour-actions');
  const tourNextBtn = document.getElementById('tour-next');
  const tourBackBtn = document.getElementById('tour-back');
  const tourCloseBtn = document.getElementById('tour-close');
  const tourRestartBtn = document.getElementById('tour-restart');
  const menuTour = document.getElementById('menu-tour');

  const demoQ = (id) => '[data-id="' + String(id || '').replace(/["\\]/g, '\\$&') + '"]';
  const demoNamed = (o, field) => !!o && String(o[field] || '').trim() !== '';

  /* ---------- Kulissen demoen bygger i ---------- */
  let demoSaved = null;       // brukerens egne objekter mens demoen står på
  let demoRunning = false;    // den guidede runden (demoActive = simuleringen)
  let demoIndex = 0;
  let demoPainted = -1;       // hvilket steg kortet faktisk viser nå
  let demoCtx = {};           // id-ene demoen har opprettet
  let demoBase = null;        // tellere ved inngangen til steget
  let demoSnaps = [];         // tilstanden ved inngangen til hvert steg
  let demoTimer = null;
  let demoReturnFocus = null;
  let demoLiveEl = null;      // kontrollen steget handler om (.tour-live)
  let onboardingWaits = 0;

  // `_parent` er den eneste sykliske referansen i treet (synken setter den);
  // demoens egne objekter har den ikke, men vakten koster ingenting.
  const demoClone = (v) => JSON.parse(JSON.stringify(v, (k, x) => (k === '_parent' ? undefined : x)));

  /* Legg brukerens objekter til side og gi `state` et tomt tre. Referansen til
     den gamle arrayen beholdes urørt — demoen får en HELT ny, så ingenting den
     gjør kan nå brukerens innhold, uansett hvor i appen mutasjonen skjer. */
  function demoSimStart() {
    if (demoActive) return;
    commitAllPending(); // brukerens egne buffrede slettinger hører til før demoen
    flushCacheWrite();  // en skriving bestilt før byttet skal bære BRUKERENS state
    demoSaved = {
      universes: state.universes,
      activeUniverse: state.activeUniverse,
      activeGroup: state.activeGroup,
      activeGroups: state.activeGroups,
      tomb: state._tomb,
    };
    demoActive = true;
    state.universes = [];
    state.activeUniverse = null;
    state.activeGroup = null;
    state.activeGroups = {};
    state._tomb = emptyTomb();
    closeTrash();
    closeNavModal();
    closeAccount();
    render();
  }
  // resync: ta igjen sky-rundene demoen holdt tilbake. Ved utlogging skal vi
  // ikke det — sesjonen er borte, og køen er allerede tømt.
  function demoSimStop(resync) {
    if (!demoActive) return;
    demoDropDeleteBuffer(); // buffrede slettinger av kulisser skal ikke committes
    state.universes = demoSaved.universes;
    state.activeUniverse = demoSaved.activeUniverse;
    state.activeGroup = demoSaved.activeGroup;
    state.activeGroups = demoSaved.activeGroups;
    state._tomb = demoSaved.tomb;
    demoSaved = null;
    demoActive = false;
    closeTrash();
    closeNavModal();
    render();
    if (resync) scheduleCloud(0);
  }
  /* Kast angre-bufferet uten å committe. Brukes når kulissen forsvinner (demoen
     avsluttes, eller et steg rulles tilbake): en timer som fyrer etterpå ville
     ellers ha lett etter objekter som ikke finnes lenger. */
  function demoDropDeleteBuffer() {
    pendingDeletes.forEach((entry, id) => {
      const f = findAnyById(id);
      if (f) delete f.obj._pendingDelete;
    });
    pendingDeletes.clear();
    if (deleteToast) { clearTimeout(deleteToast.timer); deleteToast = null; hideToast(); }
  }

  /* ---------- Oppslag i kulissen ---------- */
  const demoUnis = () => state.universes.filter((u) => live(u) && !u._virtual);
  const demoUni = () => demoUnis().find((u) => u.id === demoCtx.uniId) || null;
  const demoGroups = (u) => (u ? u.groups.filter((g) => live(g) && !g.isCat) : []);
  const demoGroup = () => demoGroups(demoUni()).find((g) => g.id === demoCtx.groupId) || null;
  const demoCards = () => { const g = demoGroup(); return g ? g.cards.filter(live) : []; };
  const demoCardOf = (id) => demoCards().find((c) => c.id === id) || null;
  const demoCard = () => demoCardOf(demoCtx.cardId);
  const demoItems = (c) => (c ? c.items.filter((it) => live(it) && !it.isCat) : []);
  const demoCat = () => {
    const c = demoCard();
    return c ? c.items.find((it) => live(it) && it.isCat && it.id === demoCtx.catId) || null : null;
  };
  const demoCatMembers = () => demoItems(demoCard()).filter((it) => it.cat === demoCtx.catId);
  const demoEditing = () => !!document.querySelector('.edit-input');

  // Tellere ved inngangen til et steg: det som ikke kan leses av et objekt
  // alene (et slipp som landet på samme plass, en tømming som fjernet en rad
  // som allerede var skjult).
  function demoCounters() {
    const g = demoGroup();
    const c = demoCard();
    return {
      drops: dropSeq,
      itemsAll: c ? c.items.length : 0,
      cardsAll: g ? g.cards.length : 0,
      unis: state.universes.length,
      catMembers: demoCatMembers().length,
    };
  }

  /* ---------- DOM-oppslag stegene peker på ---------- */
  const demoNavCard = () => navBoard.querySelector('.uni-card' + demoQ(demoCtx.uniId));
  const demoNavRow = () => navBoard.querySelector('.item' + demoQ(demoCtx.groupId));
  const demoCardEl = (id) => board.querySelector('.card' + demoQ(id));
  const demoCatEl = () => board.querySelector('.category' + demoQ(demoCtx.catId));
  // Navnefeltet som står åpent inne i `el` — ellers elementet som åpner det.
  const demoNameField = (el, fallbackSel) =>
    (el && (el.querySelector('.edit-input') || el.querySelector(fallbackSel))) || null;
  // Nivå-1-radene i listen (ikke kategorimedlemmer, ikke utførte).
  const demoRows = (id) => {
    const el = demoCardEl(id);
    return el ? Array.prototype.slice.call(el.querySelectorAll(':scope > .card-body > .items-container > .item')) : [];
  };
  // Navnet på den sist opprettede raden — den et navnesteg gjelder.
  const demoLastRowTitle = (id) => {
    const r = demoRows(id).slice(-1)[0];
    return r ? demoNameField(r, '.item-text') : null;
  };
  const demoLastCatRowTitle = () => {
    const el = demoCatEl();
    if (!el) return null;
    const rows = el.querySelectorAll('.cat-items > .item');
    const r = rows[rows.length - 1];
    return r ? demoNameField(r, '.item-text') : null;
  };

  /* ---------- Stegene ----------
     `done()` er hele fasiten for framdrift: sann når steget ER utført. Den
     leser TILSTAND, aldri et knappetrykk — ＋-knappene oppretter objektet og
     åpner navnefeltet i samme håndterer, så et klikk sier ingenting om hva
     brukeren faktisk fullførte.

     `premise()` sier om steget fortsatt gir mening. Faller den, rulles demoen
     tilbake til `rewind` (og tilstanden med den): en navngiving som avbrytes
     fjerner raden igjen, og da skal steget som LAGER raden komme tilbake.

     `target()` er kontrollen pilspissen peker på — og samtidig det eneste
     brukeren får røre (`demoZones`). `allow` legger til det som må være
     tilgjengelig i tillegg. */
  const DEMO_STEPS = [
    {
      id: 'welcome',
      narrated: true,
      title: tr('tour.welcomeTitle'),
      html: tr('tour.welcome', {
        list: ICONS.list, folder: ICONS.folder, globe: ICONS.globe, category: ICONS.category,
      }),
      note: tr('tour.welcomeNote'),
      cta: tr('tour.start'),
    },
    {
      id: 'open_nav',
      target: () => navCrumbBtn,
      html: tr('tour.openNav', { globe: ICONS.globe, folder: ICONS.folder }),
      done: () => !navModal.hidden,
    },
    {
      id: 'create_area',
      needsNav: true,
      target: () => navBoard.querySelector('.nav-add-uni button'),
      html: tr('tour.createArea', { globe: ICONS.globe }),
      done: () => {
        const u = demoUnis()[0];
        if (!u) return false;
        demoCtx.uniId = u.id;
        return true;
      },
    },
    {
      id: 'name_area',
      reopen: () => { const c = demoNavCard(); return c && c.querySelector('.card-title'); },
      needsNav: true,
      rewind: 'create_area',
      premise: () => !!demoUni(),
      target: () => demoNameField(demoNavCard(), '.card-title'),
      html: tr('tour.nameArea'),
      done: () => !demoEditing() && demoNamed(demoUni(), 'name'),
    },
    {
      id: 'create_folder',
      needsNav: true,
      rewind: 'create_area',
      premise: () => !!demoUni(),
      target: () => { const el = demoNavCard(); return el && el.querySelector('.add-item-row .add-item-btn'); },
      html: tr('tour.createFolder', { folder: ICONS.folder }),
      done: () => {
        const g = demoGroups(demoUni())[0];
        if (!g) return false;
        demoCtx.groupId = g.id;
        return true;
      },
    },
    {
      id: 'name_folder',
      reopen: () => { const r = demoNavRow(); return r && r.querySelector('.item-text'); },
      needsNav: true,
      rewind: 'create_folder',
      premise: () => !!demoGroup(),
      target: () => demoNameField(demoNavRow(), '.item-text'),
      html: tr('tour.nameFolder'),
      done: () => !demoEditing() && demoNamed(demoGroup(), 'name'),
    },
    {
      id: 'open_folder',
      needsNav: true,
      rewind: 'create_folder',
      premise: () => !!demoGroup(),
      target: () => demoNavRow(),
      html: tr('tour.openFolder'),
      done: () => state.activeGroup === demoCtx.groupId && navModal.hidden,
    },
    {
      id: 'create_list',
      target: () => addCardBtn,
      html: tr('tour.createList', { list: ICONS.list }),
      done: () => {
        const c = demoCards()[0];
        if (!c) return false;
        demoCtx.cardId = c.id;
        return true;
      },
    },
    {
      id: 'name_list',
      reopen: () => demoNameField(demoCardEl(demoCtx.cardId), '.card-title'),
      rewind: 'create_list',
      premise: () => !!demoCard(),
      target: () => demoNameField(demoCardEl(demoCtx.cardId), '.card-title'),
      html: tr('tour.nameList'),
      done: () => !demoEditing() && demoNamed(demoCard(), 'title'),
    },
    {
      id: 'create_item',
      rewind: 'create_list',
      premise: () => !!demoCard(),
      target: () => { const el = demoCardEl(demoCtx.cardId); return el && el.querySelector('.add-item-row .add-item-btn'); },
      html: tr('tour.createItem'),
      done: () => demoItems(demoCard()).length >= 1,
    },
    {
      id: 'name_item',
      reopen: () => demoLastRowTitle(demoCtx.cardId),
      rewind: 'create_item',
      premise: () => demoItems(demoCard()).length >= 1,
      target: () => { const el = demoCardEl(demoCtx.cardId); return el && el.querySelector('.edit-input'); },
      html: tr('tour.nameItem'),
      done: () => !demoEditing() && demoItems(demoCard()).every((it) => demoNamed(it, 'text')),
    },
    {
      id: 'create_item2',
      target: () => { const el = demoCardEl(demoCtx.cardId); return el && el.querySelector('.add-item-row .add-item-btn'); },
      html: tr('tour.createItem2'),
      done: () => demoItems(demoCard()).length >= 2,
    },
    {
      id: 'name_item2',
      reopen: () => demoLastRowTitle(demoCtx.cardId),
      rewind: 'create_item2',
      premise: () => demoItems(demoCard()).length >= 2,
      target: () => { const el = demoCardEl(demoCtx.cardId); return el && el.querySelector('.edit-input'); },
      html: tr('tour.nameItem'),
      done: () => !demoEditing() && demoItems(demoCard()).every((it) => demoNamed(it, 'text')),
    },
    {
      id: 'drag_item',
      target: () => demoRows(demoCtx.cardId).slice(-1)[0],
      html: tr('tour.dragItem'),
      done: () => dropSeq > demoBase.drops,
    },
    {
      id: 'create_list2',
      target: () => addCardBtn,
      html: tr('tour.createList2'),
      done: () => {
        const c = demoCards().find((x) => x.id !== demoCtx.cardId);
        if (!c) return false;
        demoCtx.card2Id = c.id;
        return true;
      },
    },
    {
      id: 'name_list2',
      reopen: () => demoNameField(demoCardEl(demoCtx.card2Id), '.card-title'),
      rewind: 'create_list2',
      premise: () => !!demoCardOf(demoCtx.card2Id),
      target: () => demoNameField(demoCardEl(demoCtx.card2Id), '.card-title'),
      html: tr('tour.nameList2'),
      done: () => !demoEditing() && demoNamed(demoCardOf(demoCtx.card2Id), 'title'),
    },
    {
      id: 'drag_list',
      target: () => { const el = demoCardEl(demoCtx.card2Id); return el && el.querySelector('.card-head'); },
      // «Oppover» stemmer bare i én kolonne; på en bred skjerm ligger listene
      // ved siden av hverandre. «Forbi» er riktig i begge tilfeller.
      html: tr('tour.dragList'),
      done: () => dropSeq > demoBase.drops,
    },
    {
      id: 'create_cat',
      target: () => { const el = demoCardEl(demoCtx.cardId); return el && el.querySelector('.add-cat-btn'); },
      html: tr('tour.createCat', { category: ICONS.category }),
      done: () => {
        const c = demoCard();
        const cat = c && c.items.find((it) => live(it) && it.isCat);
        if (!cat) return false;
        demoCtx.catId = cat.id;
        return true;
      },
    },
    {
      id: 'name_cat',
      reopen: () => { const el = demoCatEl(); return el && el.querySelector('.cat-title'); },
      rewind: 'create_cat',
      premise: () => !!demoCat(),
      target: () => demoNameField(demoCatEl(), '.cat-title'),
      html: tr('tour.nameCat'),
      done: () => !demoEditing() && demoNamed(demoCat(), 'text'),
    },
    {
      id: 'drag_into_cat',
      rewind: 'create_cat',
      premise: () => !!demoCat(),
      target: () => demoRows(demoCtx.cardId).filter((el) => !el.closest('.category'))[0],
      // Kategorien er destinasjonen: et kort oppå den gjør steget umulig.
      clear: () => demoCatEl(),
      html: tr('tour.dragIntoCat'),
      done: () => demoCatMembers().length > demoBase.catMembers,
    },
    {
      id: 'create_cat_item',
      rewind: 'create_cat',
      premise: () => !!demoCat(),
      target: () => { const el = demoCatEl(); return el && el.querySelector('.cat-add-btn'); },
      html: tr('tour.createCatItem'),
      done: () => demoCatMembers().length > demoBase.catMembers,
    },
    {
      id: 'name_cat_item',
      reopen: () => demoLastCatRowTitle(),
      rewind: 'create_cat_item',
      premise: () => demoCatMembers().length > 1,
      target: () => { const el = demoCatEl(); return el && el.querySelector('.edit-input'); },
      html: tr('tour.nameCatItem'),
      done: () => !demoEditing() && demoCatMembers().every((it) => demoNamed(it, 'text')),
    },
    {
      id: 'dissolve_cat',
      rewind: 'create_cat',
      premise: () => !!demoCat(),
      target: () => { const el = demoCatEl(); return el && el.querySelector('.obj-menu-btn'); },
      allow: ['#obj-menu-panel'],
      html: tr('tour.dissolveCat'),
      done: () => !demoCat(),
    },
    {
      id: 'delete_item',
      target: () => { const r = demoRows(demoCtx.cardId)[0]; return r && r.querySelector('.obj-menu-btn'); },
      allow: ['#obj-menu-panel'],
      html: tr('tour.deleteItem'),
      done: () => trashedItemsOf(demoCard()).length >= 1,
    },
    {
      id: 'open_item_trash',
      rewind: 'delete_item',
      premise: () => trashedItemsOf(demoCard()).length >= 1,
      target: () => { const el = demoCardEl(demoCtx.cardId); return el && el.querySelector('.item-trash-btn'); },
      trashModal: true,
      html: tr('tour.openItemTrash'),
      done: () => !trashModal.hidden,
    },
    {
      id: 'restore_item',
      needsTrash: true,
      rewind: 'delete_item',
      premise: () => trashedItemsOf(demoCard()).length >= 1 || !trashModal.hidden,
      target: () => trashList.querySelector('.trash-row button'),
      trashModal: true,
      html: tr('tour.restoreItem'),
      done: () => trashedItemsOf(demoCard()).length === 0,
    },
    {
      id: 'close_item_trash',
      needsTrash: true,
      target: () => trashClose,
      trashModal: true,
      html: tr('tour.closeItemTrash'),
      done: () => trashModal.hidden,
    },
    {
      id: 'delete_item2',
      target: () => { const r = demoRows(demoCtx.cardId)[0]; return r && r.querySelector('.obj-menu-btn'); },
      allow: ['#obj-menu-panel'],
      html: tr('tour.deleteItem2'),
      done: () => trashedItemsOf(demoCard()).length >= 1,
    },
    {
      id: 'empty_item_trash',
      rewind: 'delete_item2',
      premise: () => trashedItemsOf(demoCard()).length >= 1 || demoCard().items.length < demoBase.itemsAll,
      target: () => { const el = demoCardEl(demoCtx.cardId); return el && el.querySelector('.item-trash-btn'); },
      html: tr('tour.emptyItemTrash'),
      done: () => demoCard().items.length < demoBase.itemsAll,
    },
    {
      id: 'delete_list',
      target: () => { const el = demoCardEl(demoCtx.cardId); return el && el.querySelector('.obj-menu-btn'); },
      allow: ['#obj-menu-panel'],
      html: tr('tour.deleteList'),
      done: () => !demoCard(),
    },
    {
      id: 'empty_card_trash',
      rewind: 'delete_list',
      premise: () => trashedCards().length >= 1 || demoGroup().cards.length < demoBase.cardsAll,
      target: () => trashBtn,
      html: tr('tour.emptyCardTrash'),
      done: () => demoGroup().cards.length < demoBase.cardsAll,
    },
    {
      id: 'open_nav2',
      target: () => navCrumbBtn,
      html: tr('tour.openNav2'),
      done: () => !navModal.hidden,
    },
    {
      id: 'delete_area',
      needsNav: true,
      target: () => { const el = demoNavCard(); return el && el.querySelector('.obj-menu-btn'); },
      allow: ['#obj-menu-panel'],
      html: tr('tour.deleteArea'),
      done: () => !demoUni(),
    },
    {
      id: 'empty_uni_trash',
      needsNav: true,
      rewind: 'delete_area',
      premise: () => trashedUniverses().length >= 1 || state.universes.length < demoBase.unis,
      target: () => uniTrashBtn,
      html: tr('tour.emptyUniTrash'),
      done: () => state.universes.length < demoBase.unis,
    },
    {
      id: 'close_nav',
      needsNav: true,
      target: () => navModalClose,
      html: tr('tour.closeNav'),
      done: () => navModal.hidden,
    },
    {
      id: 'finish',
      target: () => accountBtn,
      title: tr('tour.finishTitle'),
      html: tr('tour.finish'),
      cta: tr('common.done'),
    },
  ];
  const DEMO_LAST = DEMO_STEPS.length - 1;
  const demoRank = (id) => DEMO_STEPS.findIndex((s) => s.id === id);
  const demoStep = () => DEMO_STEPS[demoIndex] || DEMO_STEPS[DEMO_LAST];

  /* ---------- Kontoens minne (user_metadata) ---------- */
  // Ett objekt-felt i user_metadata, alltid som et objekt (aldri null/streng —
  // metadata er klientskrevet og kan i prinsippet inneholde hva som helst).
  function accountPref(key) {
    const v = authUser && authUser.meta && authUser.meta[key];
    return v && typeof v === 'object' ? v : {};
  }
  /* Har kontoen sett DEMOEN? Markøren er versjonert, og v3 er demoen. En konto
     som kom gjennom en tidligere runde (v1s passive omvisning eller v2s
     innføring i egne data) har ALDRI sett denne, og skal derfor få tilbudet én
     gang til. Demoen koster dem ingenting: den rører ikke innholdet deres, og
     ✕ takker nei for godt. */
  function onboardingSeen() {
    const o = accountPref('onboarding');
    if (typeof o.v !== 'number' || o.v < TOUR_VERSION) return false;
    return o.status === 'done' || o.status === 'skipped';
  }
  // Skriv en metadata-nøkkel: lokalt med én gang (så den ikke gjentas i denne
  // økten), til kontoen i bakgrunnen. Landet ikke skrivingen, prøver vi igjen
  // én gang — og gir vi opp, dukker demoen heller opp igjen ved neste
  // innlogging enn at vi later som den er sett.
  function saveAccountPref(patch, retriesLeft) {
    if (!authUser) return;
    // Hvem skrivingen gjelder. Supabase kan gå fra én innlogget bruker til en
    // annen mens forsøket ligger og venter, og da hører verken metadataen eller
    // det nye forsøket hjemme hos den som overtok — det ville stemplet DERES
    // demo som sett.
    const forUser = authUser.id;
    authUser.meta = Object.assign({}, authUser.meta, patch);
    const client = acli();
    if (!client) return;
    client.auth.updateUser({ data: patch })
      .then((res) => { if (res && res.error) throw res.error; })
      .catch(() => {
        if (!retriesLeft) return;
        setTimeout(() => {
          if (!authUser || authUser.id !== forUser) return; // en annen konto har overtatt
          saveAccountPref(patch, retriesLeft - 1);
        }, 5000);
      });
  }
  /* Demoen er en simulering, ikke et arbeid som skal kunne gjenopptas: det
     finnes ingen halvferdig kulisse å komme tilbake til på en annen enhet.
     Derfor lagres bare UTFALLET, og bare når runden er over. */
  function saveOnboarding(status) {
    saveAccountPref({ onboarding: { v: TOUR_VERSION, status: status } }, 1);
  }

  /* ---------- Avgrensningen: bare det steget handler om ----------
     Vakten ligger i JS og ikke i et lag over appen, for laget måtte uansett
     slippe pekeren gjennom til den ekte kontrollen. Den fanger i
     WINDOW-CAPTURE, altså før enhver lytter i appen, og svelger hendelsen med
     stopImmediatePropagation.

     `preventDefault` brukes bevisst IKKE på pointerdown: et klikk utenfor et
     åpent navnefelt skal fortsatt flytte fokus, for det er sånn man bekrefter
     navnet. Klikk/tastetrykk får derimot både stopp og preventDefault. */
  const DEMO_GATE_EVENTS = ['pointerdown', 'mousedown', 'click', 'dblclick', 'contextmenu', 'keydown'];
  function demoZones() {
    const step = demoStep();
    const out = [];
    const t = demoTarget();
    if (t) out.push(t);
    (step.allow || []).forEach((sel) => {
      document.querySelectorAll(sel).forEach((el) => out.push(el));
    });
    return out;
  }
  /* Kontroller som ligger INNI en tillatt sone uten å være det steget handler
     om. En listepunkt-rad er hele sonen når den skal dras, men den bærer også
     avmerking, tannhjul og slette-kryss — og ingen av dem skal virke da. De
     slippes gjennom kun når de ER målet. */
  const DEMO_NEVER = '.obj-menu-btn, .item-check, .done-restore, .trashcan';
  function demoLets(node) {
    if (!node || !node.closest) return false;
    if (tourEl.contains(node)) return true;          // demokortet selv
    if (node.closest('.edit-input')) return true;    // navngivingen som pågår
    const zones = demoZones();
    if (!zones.some((z) => z && (z === node || z.contains(node)))) return false;
    const inner = node.closest(DEMO_NEVER);
    return !inner || zones.some((z) => z === inner);
  }
  function demoGate(ev) {
    if (!demoRunning) return;
    /* Kun det BRUKEREN gjør skal avgrenses. Appen dispatcher også hendelser
       selv — `addUniverse()` åpner navnefeltet med et `click()` på tittelen, og
       et blokkert syntetisk klikk der ville gitt et navnesteg uten navnefelt.
       `isTrusted` skiller de to, og er ikke noe en bruker kan forfalske. */
    if (ev.isTrusted === false) return;
    /* Escape er alltid av. Den ville ellers avbrutt navngivingen (og fjernet
       raden steget nettopp ba om), lukket modalen steget står i, eller
       avsluttet demoen bakveien. ✕ i kortet er den ene utgangen. */
    const escape = ev.type === 'keydown' && ev.key === 'Escape';
    if (!escape && demoLets(ev.target)) return;
    ev.stopPropagation();
    if (ev.stopImmediatePropagation) ev.stopImmediatePropagation();
    if (ev.type === 'keydown' && ev.key === 'Tab') return; // fokus får flytte seg
    if (ev.type !== 'pointerdown' && ev.type !== 'mousedown') ev.preventDefault();
  }
  DEMO_GATE_EVENTS.forEach((t) => window.addEventListener(t, demoGate, true));
  // Søppelkasse-knappen gjør to ting; modalen skal bare kunne åpnes i stegene
  // som handler om den (se showTrashModal).
  function demoAllowsTrashModal() {
    return !demoRunning || !!demoStep().trashModal;
  }

  /* ---------- Kortet ---------- */
  // Elementet steget peker på — men bare hvis det faktisk er synlig nå.
  function demoTarget() {
    const step = demoStep();
    if (!step.target) return null;
    let el = null;
    try { el = step.target(); } catch (e) { el = null; }
    if (!el || !el.getClientRects().length) return null;
    if (el.disabled || el.closest('[hidden]')) return null;
    return el;
  }
  // Kontrollen steget handler om står i full styrke; resten er dempet av
  // `body.tour-demo` (se styles.css).
  function demoMarkLive(el) {
    if (demoLiveEl === el) return;
    if (demoLiveEl) demoLiveEl.classList.remove('tour-live');
    demoLiveEl = el || null;
    if (demoLiveEl) demoLiveEl.classList.add('tour-live');
  }
  /* Plasser kortet ved siden av målet, med pilspissen mot det. Kortet legger
     seg ALDRI oppå målet: målet er det brukeren skal treffe, og et kort i veien
     gjør steget umulig. Får ikke et helt kort plass verken over eller under,
     velges den største luften og kortet kappes til den — da ruller teksten
     inni kortet, mens knapperaden blir stående (se `.tour-body` i styles.css). */
  function placeTour() {
    const step = demoStep();
    const el = step.narrated ? null : demoTarget();
    const margin = 12, gap = 16, half = 7;
    /* Mål kortet UKAPPET. Leses høyden mens forrige rundes `maxHeight` står
       på, måler vi vår egen forrige beslutning i stedet for kortet: en kappet
       høyde ser ut til å få plass, klippet fjernes, kortet vokser — og neste
       runde kapper det igjen. Der scroll/resize fyrer i ett kjør (en telefon)
       blir løkka synlig som at nederste del av kortet flimrer opp og ned.
       Nullstillingen skjer i samme oppgave som målingen, så ingen mellom-
       tilstand rekker å males.

       Men den koster lesestedet: uten klippet er kortet høyt nok til at
       `.tour-body` ikke lenger renner over, og nettleseren klemmer dermed
       `scrollTop` til 0. Er brukeren midt i å lese den nederste delen av
       velkomsten på en lav skjerm, spretter teksten tilbake til toppen for hver
       eneste plassering. Lesestedet tas derfor vare på og legges tilbake når
       klippet er satt igjen. */
    const tourBody = tourCard.querySelector('.tour-body');
    const lesested = tourBody ? tourBody.scrollTop : 0;
    const gjenopprettLesested = () => {
      if (tourBody && tourBody.scrollTop !== lesested) tourBody.scrollTop = lesested;
    };
    tourCard.style.maxHeight = '';
    const cw = tourCard.offsetWidth;
    const ch = tourCard.offsetHeight;
    /* Kortet klemmes mot den SIKRE sonen, ikke mot skjermkanten: i et native
       skall dekker statusfeltet og gestelinjen hver sin strimmel av
       viewportet, og et kort som stopper 12 px fra kanten ville ligget under
       dem. I en nettleser er alle fire null, og linjene under regner ut det
       samme som før. */
    const safe = safeInsets();
    const minX = safe.left + margin;
    const minY = safe.top + margin;
    const maxX = window.innerWidth - safe.right - margin;
    const maxY = window.innerHeight - safe.bottom - margin;
    const clamp = (lo, v, hi) => Math.max(lo, Math.min(v, Math.max(lo, hi)));
    /* Hele den brukbare høyden. Kortet er ALDRI høyere enn denne — verken
       midtstilt eller ved siden av et mål. Et kort som stikker ut over kanten
       er ikke bare stygt: knappen som driver steget videre havner utenfor
       skjermen, og på en lav skjerm (telefon i landskap) gjelder det nettopp
       velkomsten, der «Kom i gang» er eneste vei videre. */
    const room = maxY - minY;
    if (!el) {
      tourArrow.hidden = true;
      const h = Math.min(ch, room);
      tourCard.style.maxHeight = ch > room ? room + 'px' : '';
      tourCard.style.left = Math.max(minX, (minX + maxX - cw) / 2) + 'px';
      tourCard.style.top = Math.max(minY, (minY + maxY - h) / 2) + 'px';
      gjenopprettLesested();
      markTourOverflow();
      return;
    }
    const r = el.getBoundingClientRect();
    /* Pilspissen peker på MÅLET, men kortet må holde seg unna mer enn det: et
       drag har også et DESTINASJON, og et kort som dekker den gjør steget
       umulig å utføre. `clear()` gir det ekstra elementet, og plasseringen
       regnes på rektangelet som rommer begge. */
    let keep = r;
    const clearEls = [];
    if (step.clear) {
      try { const ce = step.clear(); if (ce) clearEls.push(ce); } catch (e) { /* borte */ }
    }
    /* Objektmenyen åpner seg MENS et steg pågår (målet er menyknappen, men
       handlingen ligger i en rad inne i popoveren). Den er ikke steg-målet, og
       kan derfor ikke stå i `clear` — men et kort oppå den gjør steget like
       umulig. Derfor holdes den alltid fri når den er åpen. */
    if (!objMenuOverlay.hidden) clearEls.push(objMenuPanel);
    clearEls.forEach((ce) => {
      if (!ce.getClientRects || !ce.getClientRects().length) return;
      const c = ce.getBoundingClientRect();
      keep = {
        left: Math.min(keep.left, c.left), right: Math.max(keep.right, c.right),
        top: Math.min(keep.top, c.top), bottom: Math.max(keep.bottom, c.bottom),
      };
    });
    const below = maxY - keep.bottom - gap;
    const above = keep.top - gap - minY;
    const right = maxX - keep.right - gap;
    const leftRoom = keep.left - gap - minX;
    /* Med et frisone-element velges siden der MÅLET er den nærmeste kanten av
       rektangelet — ellers ville pilspissen pekt på destinasjonen i stedet for
       på det brukeren skal ta tak i. */
    const prefer = keep === r ? null : (r.top <= keep.top + 1 ? 'above' : 'below');
    let side;
    if (prefer === 'above' && ch <= above) side = 'above';
    else if (prefer === 'below' && ch <= below) side = 'below';
    else if (ch <= below) side = 'below';
    else if (ch <= above) side = 'above';
    else if (cw <= right) side = 'right';
    else if (cw <= leftRoom) side = 'left';
    else side = below >= above ? 'below' : 'above';
    let top, left, maxH = '';
    if (side === 'below' || side === 'above') {
      const sideRoom = side === 'below' ? below : above;
      /* Gulvet på 120 px hindrer en ubrukelig strimmel av et kort når luften på
         den valgte siden er nesten null — men det kan aldri bli høyere enn hele
         den brukbare høyden, og topp-klemmen under holder kortet innenfor
         skjermen selv når gulvet er høyere enn luften (da legger kortet seg
         nødvendigvis litt oppå målet: et kort utenfor kanten er verre). */
      if (ch > sideRoom) maxH = Math.max(Math.min(120, room), sideRoom) + 'px';
      const h = maxH ? Math.min(ch, parseFloat(maxH)) : ch;
      top = clamp(minY, side === 'below' ? keep.bottom + gap : keep.top - gap - h, maxY - h);
      left = clamp(minX, r.left + r.width / 2 - cw / 2, maxX - cw);
      tourArrow.style.left = clamp(left + 14, r.left + r.width / 2 - half, left + cw - 14 - half * 2) + 'px';
      tourArrow.style.top = (side === 'below' ? top - half : top + h - half) + 'px';
    } else {
      /* Ved siden av målet er det ingen «luft på siden» som begrenser høyden —
         bare skjermen selv. Uten kappingen her ville et høyt kort stukket ut
         både over og under (klemmen kan bare velge én kant). */
      if (ch > room) maxH = room + 'px';
      const h = Math.min(ch, room);
      top = clamp(minY, r.top + r.height / 2 - h / 2, maxY - h);
      left = side === 'right' ? keep.right + gap : keep.left - gap - cw;
      tourArrow.style.top = clamp(top + 14, r.top + r.height / 2 - half, top + h - 14 - half * 2) + 'px';
      tourArrow.style.left = (side === 'right' ? left - half : left + cw - half) + 'px';
    }
    tourCard.style.maxHeight = maxH;
    tourCard.style.left = left + 'px';
    tourCard.style.top = top + 'px';
    tourArrow.hidden = false;
    gjenopprettLesested();
    markTourOverflow();
  }
  /* Avtoningen i bunnen av kortet: PÅ når det finnes uleste linjer under
     kanten, AV når man er nede (da skal siste linje være skarp). Kalles etter
     hver plassering og ved rulling i kortet — begge kan endre svaret. */
  function markTourOverflow() {
    const body = tourCard.querySelector('.tour-body');
    const mer = !!body && body.scrollHeight - body.scrollTop - body.clientHeight > 2;
    tourCard.classList.toggle('has-more', mer);
  }
  // Én linje under teksten: hva som står i veien akkurat nå.
  function demoNote() {
    const step = demoStep();
    // En åpen navngiving er handlingen som PÅGÅR, og linjen sier hva som
    // gjenstår. Demoen skriver aldri noe, så det finnes ingen feiltilstand her.
    const text = (!step.cta && demoEditing()) ? tr('tour.typeNameHint') : (step.note || '');
    tourNoteEl.hidden = !text;
    tourNoteEl.textContent = text;
  }
  function paintDemoStep() {
    const step = demoStep();
    const pct = Math.round((demoIndex / DEMO_LAST) * 100);
    tourProgressFill.style.width = pct + '%';
    tourProgressEl.setAttribute('aria-valuenow', String(pct));
    tourTitleEl.textContent = step.title || '';
    tourTitleEl.hidden = !step.title;
    tourTextEl.innerHTML = step.html;
    demoNote();
    tourNextBtn.hidden = !step.cta;
    tourNextBtn.textContent = step.cta || 'Neste';
    tourBackBtn.hidden = demoIndex === 0;
    tourActionsEl.classList.toggle('is-empty', tourNextBtn.hidden && tourBackBtn.hidden);
    tourEl.classList.toggle('narrated', !!step.narrated);
    if (step.narrated) tourCard.setAttribute('aria-modal', 'true');
    else tourCard.removeAttribute('aria-modal');
    const target = demoTarget();
    demoMarkLive(step.narrated ? null : target);
    if (target) {
      target.scrollIntoView({
        block: 'center', inline: 'nearest',
        behavior: prefersReducedMotion() ? 'auto' : 'smooth',
      });
    }
    tourCard.hidden = false;
    placeTour();
    demoFocus(target);
    demoPainted = demoIndex;
  }
  /* Fokus. På et steg med en knapp i kortet står det i kortet; ellers på den
     EKTE kontrollen, så en tastaturbruker kan trykke Enter der uten å lete. Vi
     rører aldri fokus mens brukeren skriver — en inline-navngiving er nettopp
     handlingen vi venter på. */
  function demoFocus(target) {
    const a = document.activeElement;
    if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.isContentEditable)) return;
    if (demoStep().cta) { tourCard.focus(); return; }
    if (target && typeof target.focus === 'function') {
      try { target.focus({ preventScroll: true }); return; } catch (e) { /* ikke fokuserbart */ }
    }
    tourCard.focus();
  }
  function demoHideCard() {
    tourCard.hidden = true;
    tourArrow.hidden = true;
    demoMarkLive(null);
    demoPainted = -1;
  }

  /* ---------- Framdrift ---------- */
  function demoSnapshot() {
    return {
      universes: demoClone(state.universes),
      activeUniverse: state.activeUniverse,
      activeGroup: state.activeGroup,
      activeGroups: Object.assign({}, state.activeGroups),
      tomb: demoClone(state._tomb),
      ctx: Object.assign({}, demoCtx),
    };
  }
  function demoApplySnapshot(snap) {
    demoDropDeleteBuffer();
    state.universes = demoClone(snap.universes);
    state.activeUniverse = snap.activeUniverse;
    state.activeGroup = snap.activeGroup;
    state.activeGroups = Object.assign({}, snap.activeGroups);
    state._tomb = demoClone(snap.tomb);
    demoCtx = Object.assign({}, snap.ctx);
  }
  /* Sett opp modalene slik steget forutsetter. Kalles KUN når vi går bakover
     (eller ruller tilbake): framover er det brukerens egen navigasjon som har
     ført oss hit, og da skal vi ikke rote i den. */
  function demoApplyUi(step) {
    if (step.needsTrash) {
      closeNavModal();
      const c = demoCard();
      if (c) openItemsTrash(c);
      return;
    }
    closeTrash();
    if (step.needsNav) openNavModal(); else closeNavModal();
  }
  // restore: gjenopprett tilstanden slik den var da steget begynte (bakover og
  // ved tilbakerulling). Framover tas et NYTT øyeblikksbilde.
  function demoGoTo(i, restore) {
    demoIndex = Math.max(0, Math.min(i, DEMO_LAST));
    if (restore && demoSnaps[demoIndex]) {
      const step = demoStep();
      demoApplySnapshot(demoSnaps[demoIndex]);
      demoApplyUi(step);
      render();
      /* Et navnesteg må få navnefeltet sitt tilbake. Objektet ble opprettet med
         et standardnavn av steget FØR, så uten dette ville steget vært oppfylt
         i det øyeblikk vi kom til det — og «Tilbake» sprettet rett fram igjen. */
      if (step.reopen) {
        try {
          const el = step.reopen();
          // Via omdøpings-hooken, ikke et klikk: et klikk på et område-/listenavn
          // kollapser nå, og på et mappenavn navigerer det (docs/menus.md).
          // `.click()` er igjen for det ene tilfellet reopen gir et ALLEREDE
          // åpent navnefelt (`.edit-input`), som ikke har noen hook.
          if (el && el.__rename) el.__rename();
          else if (el && el.click) el.click();
        } catch (e) { /* borte */ }
      }
    } else {
      demoSnaps[demoIndex] = demoSnapshot();
      demoSnaps.length = demoIndex + 1;
    }
    demoBase = demoCounters(); // regnes ETTER at tilstanden er på plass
    demoHideCard();
  }
  function demoAdvance() {
    if (demoIndex >= DEMO_LAST) { endTour('done'); return; }
    demoGoTo(demoIndex + 1, false);
  }
  /* Er steget klart til å VISES? Instruksjonen skal aldri stå der før
     navigasjonen forrige handling utløste er fullført — ellers peker pilen på
     en knapp som fortsatt ligger bak en modal. Kortet står skjult til da. */
  function demoReady(step) {
    if (step.needsNav && navModal.hidden) return false;
    if (!step.needsNav && !step.trashModal && !navModal.hidden) return false;
    if (step.needsTrash && trashModal.hidden) return false;
    if (!step.needsTrash && !step.trashModal && !trashModal.hidden) return false;
    if (step.narrated) return true;
    return !!demoTarget();
  }
  /* Observatøren. Kjøres på tidsur mens demoen står på, og er hele
     framdriftsmekanismen: den spør steget «er du utført?» og går videre kun når
     svaret er ja. Ingen klikkhåndterer kan kvittere ut et steg. */
  function demoObserve() {
    if (!demoRunning) return;
    const step = demoStep();
    /* «Utført» spørres FØR «står forutsetningen ennå». Et steg som FJERNER
       noe — løs opp kategorien, slett listen, tøm kassen — river selv bort sin
       egen forutsetning i samme øyeblikk som det fullføres, og motsatt
       rekkefølge ville rullet steget tilbake i stedet for å kvittere det ut.
       Kortet må ha stått minst ett tidsurslag først, ellers ville et steg som
       allerede er oppfylt blitt hoppet over uten å vises. */
    if (demoPainted === demoIndex && step.done) {
      let done = false;
      try { done = !!step.done(); } catch (e) { done = false; }
      if (done) { demoAdvance(); return; }
    }
    // Falt forutsetningen bort? (En avbrutt navngiving fjerner raden igjen.)
    if (step.premise) {
      let ok = false;
      try { ok = !!step.premise(); } catch (e) { ok = false; }
      if (!ok) { demoGoTo(demoRank(step.rewind), true); return; }
    }
    if (demoPainted !== demoIndex) {
      if (!demoReady(step)) { demoHideCard(); return; }
      paintDemoStep();
      return;
    }
    demoNote();
    demoMarkLive(step.narrated ? null : demoTarget());
    placeTour();
  }

  /* ---------- Start og slutt ---------- */
  // returnTo (valgfri): elementet fokuset skal tilbake til når demoen lukkes —
  // settes av kallere som selv lukker noe først (konto-modalen).
  function startTour(returnTo) {
    if (!authUser || demoRunning) return;
    demoReturnFocus = returnTo || document.activeElement;
    demoCtx = {};
    demoSnaps = [];
    demoIndex = 0;
    demoPainted = -1;
    demoRunning = true;
    document.body.classList.add('tour-demo');
    tourEl.hidden = false;
    tourCard.hidden = true;
    tourArrow.hidden = true;
    demoSimStart();
    demoGoTo(0, false);
    clearInterval(demoTimer);
    demoTimer = setInterval(demoObserve, DEMO_POLL_MS);
    demoObserve();
  }
  /* Riv ned demoen uten å skrive noe. Brukes ved UTLOGGING (`cloudStop`): den
     halve runden tilhørte kontoen som gikk, og skal verken merkes som sett
     eller bli stående og gjelde den neste som logger inn. */
  function resetTourState() {
    demoTeardown();
    demoSimStop(false);
    demoReturnFocus = null;
    onboardingWaits = 0;
  }
  function demoTeardown() {
    demoRunning = false;
    clearInterval(demoTimer); demoTimer = null;
    tourEl.hidden = true;
    tourEl.classList.remove('narrated');
    tourCard.hidden = true;
    tourArrow.hidden = true;
    demoMarkLive(null);
    document.body.classList.remove('tour-demo');
    demoPainted = -1;
  }
  // status: 'done' (kom gjennom) | 'skipped' (avsluttet underveis).
  // Begge betyr «sett» — demoen skal ikke mase igjen på neste enhet. Merket
  // settes også om den ikke står åpen: da er dette «jeg vil ikke ha den», og en
  // runde som er på vei opp skal ikke rekke å starte.
  function endTour(status) {
    const wasOpen = demoRunning;
    demoTeardown();
    demoSimStop(true);
    saveOnboarding(status);
    if (!wasOpen) return;
    if (demoReturnFocus && document.body.contains(demoReturnFocus)) {
      try { demoReturnFocus.focus(); } catch (e) { /* elementet kan være borte */ }
    }
    demoReturnFocus = null;
    flushPendingTip();
  }
  tourNextBtn.addEventListener('click', () => {
    if (demoIndex >= DEMO_LAST) endTour('done');
    else demoAdvance();
  });
  // Ett steg tilbake NULLSTILLER det man gjorde i det steget, så handlingen kan
  // gjøres om — ellers ville «Tilbake» stått og bedt om noe som alt er gjort.
  tourBackBtn.addEventListener('click', () => {
    if (demoIndex > 0) demoGoTo(demoIndex - 1, true);
  });
  tourCloseBtn.addEventListener('click', () => endTour('skipped'));
  tourRestartBtn && tourRestartBtn.addEventListener('click', () => {
    closeAccount();          // demoen peker på appen BAK modalen
    startTour(accountBtn);
  });
  /* Pilspissen og kortet skal følge målet: siden bak ruller fritt. Lytteren står
     i CAPTURE-fasen for å fange rulling i alle bokser, og da kommer også kortets
     EGEN rulling inn hit. Den skal ikke gi en ny plassering: kortet flytter seg
     ikke av at teksten inni det rulles, og plasseringen ville i tillegg
     nullstilt lesestedet (se `placeTour` — målingen tar av høydeklippet). */
  const tourReflow = (ev) => {
    if (ev && ev.target && ev.target.nodeType === 1 && tourEl.contains(ev.target)) {
      markTourOverflow();   // avtoningen skal av når man har rullet til bunnen
      return;
    }
    if (demoRunning && demoPainted === demoIndex) placeTour();
  };
  window.addEventListener('resize', tourReflow);
  window.addEventListener('scroll', tourReflow, true);

  /* Etter første vellykkede innlogging (cloudStart, når første synk-runde er
     ferdig og board-et er malt). Står noe annet i veien — importspørsmålet fra
     migreringen, en åpen modal, en pågående redigering — venter vi litt i
     stedet for å legge oss oppå det. En konto som har sett demoen får
     ingenting; en konto som bare har sett en TIDLIGERE runde får tilbudet. */
  function maybeStartOnboarding() {
    if (!authUser || demoRunning || onboardingSeen()) return;
    if (document.body.classList.contains('modal-open') || isBusyEditing()) {
      if (onboardingWaits++ > 20) return; // gir opp for denne økten
      setTimeout(maybeStartOnboarding, 900);
      return;
    }
    onboardingWaits = 0;
    startTour(null);
  }

  /* ---------- Kontekstuelle tips for de avanserte gestene ---------- */
  // Korte, med vilje: toasten ligger nederst på skjermen, og en lang tekst
  // brekker til en blokk som dekker det brukeren holder på med på mobil.
  const TIPS = {
    get drag() { return tr('tip.drag'); },
    get trash() { return tr('tip.trash'); },
    get moveList() { return tr('tip.moveList'); },
    get dragTrash() { return tr('tip.dragTrash'); },
  };
  let pendingTip = null;  // ba om et tips mens demoen sto på
  let lastTipAt = 0;
  function tipSeen(key) { return !!accountPref('tips')[key]; }
  // Viser tipset hvis det er relevant OG det ikke koster brukeren noe akkurat
  // nå. Returnerer om det ble vist, så kallerne kan nøye seg med ett om gangen.
  function showTip(key) {
    if (!authUser || !TIPS[key] || tipSeen(key)) return false;
    if (!onboardingSeen()) return false;         // demoen kommer først
    if (demoRunning) { pendingTip = key; return false; }
    // Aldri i veien: ikke midt i en redigering/et drag, ikke oppå en åpen
    // modal, og aldri ved å fortrenge en beskjed som allerede står — eller som
    // er på vei. En sletting tegner board-et på nytt FØR den viser «Angre»-
    // toasten sin (se sletteknappene), så en tom toast-flate her betyr ikke at
    // flaten blir stående tom. Tipset er ikke sett før det er VIST, så det
    // kommer igjen ved neste anledning.
    if (isBusyEditing() || document.body.classList.contains('modal-open')) return false;
    if (pendingDeletes.size || deleteToast) return false;
    const toastEl = document.getElementById('toast');
    if (toastEl && toastEl.classList.contains('show')) return false;
    if (Date.now() - lastTipAt < TIP_QUIET_MS) return false;
    lastTipAt = Date.now();
    const tips = Object.assign({}, accountPref('tips'));
    tips[key] = true;
    saveAccountPref({ tips: tips }, 1);
    showToast(TIPS[key], { label: tr('tip.gotIt'), fn: hideToast }, { tip: true });
    return true;
  }
  function flushPendingTip() {
    const key = pendingTip;
    pendingTip = null;
    if (key) showTip(key);
  }
  // Merk HELE introduksjonen som sett — demoen OG alle tipsene. Finnes for
  // testene som ikke handler om introduksjonen (`tests/CLAUDE.md`): der er både
  // demoen og en tips-toast i veien for det som faktisk testes, og toasten
  // ligger nederst på skjermen, akkurat der et mobil-drag tar tak.
  function skipIntroduction() {
    const tips = Object.assign({}, accountPref('tips'));
    Object.keys(TIPS).forEach((k) => { tips[k] = true; });
    endTour('skipped');
    saveAccountPref({ tips: tips }, 1);
  }
  // Kalles etter hver board-rendring: hvilke gester er relevante NÅ? Ett tips
  // om gangen — resten kommer neste gang de fortsatt er relevante.
  function maybeContextualTips(cardCount) {
    if (!trashBtn.hidden && showTip('trash')) return;
    if (cardCount >= 2 && showTip('drag')) return;
    // Søppelkassen dukker først opp UNDER et drag, så den er ikke selvforklarende
    // — men gesten er den samme på mus og finger, og tipset gjelder overalt.
    if (cardCount >= 1 && showTip('dragTrash')) return;
    if (cardCount >= 1 && groupTargetCount() >= 2) showTip('moveList');
  }
  // Antall mapper i det aktive området man kan flytte en liste til (samme
  // grunnlag som velgeren DnD på navigasjonsknappen åpner).
  function groupTargetCount() {
    const uni = activeUniverseObj();
    if (!uni) return 0;
    return uni.groups.filter((g) => !g.isCat && !g.trashed && !g._pendingDelete).length;
  }

  /* ---------------- Start ---------------- */
  // Den statiske teksten i index.html oversettes ÉN gang, før noe av appen
  // bygges — malene (`<template>`) tas av `fromTemplate()` når de klones.
  I18N.applyStatic(document);
  paintLanguage();
  paintTheme();
  initAccounts();

  // Eksponer for enkel feilsøking/testing
  window.__huskis = {
    state, render, logout, addGroup, deleteGroup,
    addUniverse, deleteUniverse, setActiveUniverse, setActiveGroup,
    emptyUniversesTrash, emptyGroupsTrash, emptyCardsTrash, emptyItemsTrash,
    openNavModal, closeNavModal,
    openAccount, closeAccount,
    canonical, reconcile, emptyDoc, docFromMyState, contentDocFromMy, applyMyDoc, cloudCycle,
    isSchemaMismatch, isTombstoneReject, isNetworkError, tombIds,
    syncStatus, retrySyncNow,
    canonicalAppUrl, authRedirectUrl,
    get cloudBase() { return cloudBase; },
    openShare, openObjMenu, closeObjMenu, showToast, updateSafety, save,
    systemBack, // Androids tilbakeknapp — broen settes bare opp i native runtime
    tour: {
      start: startTour,
      end: endTour,
      skipAll: skipIntroduction, // demoen + alle tips (se tests/CLAUDE.md)
      back: () => { if (demoRunning && demoIndex > 0) demoGoTo(demoIndex - 1, true); },
      steps: DEMO_STEPS.length,
      version: TOUR_VERSION,
      ids: DEMO_STEPS.map((s) => s.id),
      get active() { return demoRunning; },
      get sim() { return demoActive; },
      get index() { return demoIndex; },
      get id() { return demoStep().id; },
      get ctx() { return Object.assign({}, demoCtx); },
      get narrated() { return !!demoStep().narrated; },
      get shown() { return demoPainted === demoIndex && !tourCard.hidden; },
      seen: onboardingSeen,
    },
    get lang() { return I18N.lang(); },
    setLanguage,
    get authUser() { return authUser; },
    get lastMy() { return lastMy; },
    get client() { return aclient; },
  };
})();
