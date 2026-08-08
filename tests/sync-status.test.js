/*
  Nettlesertest for LAGRINGSSTATUSEN (`#sync-status`, mot mock-backend, ?mock=1).
  Statusen erstatter de forbigående synk-toastene med én diskret, vedvarende
  linje som leses av den faktiske operasjonstilstanden.

  Verifiserer:
    1. Vellykket synk: statusen står på «Lagret», uten «Prøv igjen» og uten
       toast — og den FADER HELT UT (opacity 0) etter ro-vinduet, uten å
       forlate DOM-en, så neste aktivitet kan fade den inn igjen.
    2. Frakoblet: `navigator.onLine === false` + en klient som ikke når fram gir
       «Frakoblet – endringene lagres på denne enheten». Endringen ligger
       faktisk i den lokale bufferen (påstanden er sann), den er IKKE på
       «serveren», og statusen blir stående runde etter runde uten én eneste
       toast.
    3. Retry: når nettet er tilbake lander den ventende endringen på «serveren»
       av seg selv, og statusen går til «Lagret».
    4. Nettverksfeil uten offline-flagg: ÉN feilet runde er ikke «frakoblet»
       (terskel = 2), to på rad er det. Ingen toast underveis.
    5. Delvis avvisning: et skjema-avvik på items gir «Noen endringer kunne ikke
       lagres på kontoen din» + «Prøv igjen», teknikken KUN i konsollen/
       diagnostikken, ingen toast, ingen påstand om at «resten er lagret» —
       og statusen forsvinner ikke selv om synken kjører videre.
    6. «Prøv igjen» tømmer først avvisningen når serveren faktisk har tatt imot
       skrivingen (avvisningen står så lenge feilen står).
    7. Terskelen for gjentatte radavvisninger: første avvisning er stille,
       den tredje melder seg som avvist.
    8. Tilstandene skilles fra hverandre i diagnostikken (offline/pending/
       rejected er tre uavhengige felt).
    9. Regresjon: en SKRIVE-only nettverksfeil (pull-en går gjennom, hver
       insert/update dør i transporten) må nå frakoblet-terskelen. Verdikten
       felles per runde, ikke når pull-en er ferdig — ellers nullstilte hver
       runde tellingen og statusen sto på «Lagrer …» for alltid.
   10. Regresjon: en feilet localStorage-skriving (full kvote) meldes som
       avvist. «Lagret»/«lagres på denne enheten» skal ikke påstås når
       endringene bare ligger i minnet, og en synk-runde uten divergens skal
       ikke kunne blanke den (serveren vet ingenting om localStorage).
   11. Regresjon: ÉN lagring gir ÉN tilstandsovergang. Statusen skal gå
       «Lagret» → «Lagrer …» → «Lagret» og bli der — ikke blinke tilbake til
       «Lagrer …» hver gang synken skriver ned sitt eget resultat i den samme
       lokale bufferen (fletteresultat, base, gravsteiner).
   12. Trafikklyset: prikken er grønn ved «Lagret», gul ved «Lagrer …», grå ved
       «Frakoblet» (lyset er av) og rød ved avvisning — og pillen er synlig i
       alle tre problem-/aktivitetstilstandene, aldri utfadet.
  Kjøres på BÅDE desktop- og mobil-viewport (pillen er fast plassert og skal
  holde seg innenfor viewporten på begge).

  Kjør:
    python3 -m http.server 8000
    NODE_PATH=$(npm root -g) node tests/sync-status.test.js
*/
const { chromium } = require(require('path').join(process.env.NODE_PATH || require('child_process').execSync('npm root -g').toString().trim(), 'playwright'));
const BASE = process.env.HUSKIS_URL || 'http://localhost:8000';

let passed = 0, failed = 0;
function check(name, cond, evidence) {
  if (cond) { passed++; return; }
  failed++;
  console.log('  ✗ FAIL:', name, evidence === undefined ? '' : '→ ' + JSON.stringify(evidence));
}

const U = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16); });

// Én egen-eid liste med ett listepunkt — skrivingene ville normalt lykkes.
function buildDB() {
  const uid = 'uMe';
  const PU = U(), PG = U(), PL = U(), PI = U();
  const base = (extra) => Object.assign({ trashed: false, locked: false, unlocked: false,
    invite_policy: 'inherit', ts: 1, org: 'a', pos: 0, pos_ts: 0, pos_org: '' }, extra);
  return {
    ids: { uid, PU, PG, PL, PI },
    db: {
      _PL: PL,
      profiles: [{ id: uid, email: 'me@x.no', display_name: 'Meg Selv', user_metadata: {} }],
      passwords: { 'me@x.no': 'x' },
      universes: [base({ id: PU, owner_id: uid, name: 'Mitt område' })],
      groups: [base({ id: PG, owner_id: uid, universe_id: PU, name: 'Min mappe' })],
      cards: [base({ id: PL, owner_id: uid, group_id: PG, title: 'Min liste', k: true, p: true, lab_ts: 0, lab_org: '' })],
      items: [base({ id: PI, owner_id: uid, card_id: PL, text: 'Punkt' })],
      memberships: [], share_invites: [], tombstones: [],
    },
  };
}

async function load(page, db, viewport) {
  await page.setViewportSize(viewport);
  await page.goto(BASE + '/?mock=1');
  await page.evaluate((db) => {
    localStorage.clear(); sessionStorage.clear();
    localStorage.setItem('hk-mock-db', JSON.stringify(db));
    // Kontoen har sett HELE introduksjonen (docs/introduksjon.md): verken
    // omvisningen eller et gest-tips skal legge seg over det som testes.
    sessionStorage.setItem('hk-mock-session', JSON.stringify({ id: 'uMe', email: 'me@x.no', user_metadata: { onboarding: { v: 3, status: 'done' }, tips: { drag: true, trash: true, moveList: true, dragTrash: true } } }));
  }, db);
  await page.goto(BASE + '/?mock=1');
  await page.waitForFunction(() => window.__huskis && window.__huskis.authUser, { timeout: 5000 });
  await page.waitForFunction((plid) => {
    const h = window.__huskis; if (!h || !h.state) return false;
    for (const u of h.state.universes) for (const g of (u.groups || [])) for (const c of (g.cards || [])) if (c.id === plid) return true;
    return false;
  }, db._PL, { timeout: 5000 });
  // Teller HVER gang toasten slås på — «ingen toast» skal kunne påstås for hele
  // scenarioet, ikke bare i øyeblikket vi tilfeldigvis kikker.
  await page.evaluate(() => {
    window.__toastShows = 0;
    window.__errs = [];
    const origErr = console.error;
    console.error = function () { window.__errs.push([].slice.call(arguments).join(' ')); origErr.apply(console, arguments); };
    let wasShown = false;
    new MutationObserver(() => {
      const el = document.getElementById('toast');
      const shown = !!(el && el.classList.contains('show'));
      if (shown && !wasShown) window.__toastShows++;
      wasShown = shown;
    }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
  });
}

// Alt testene trenger å vite om statuslinjen, i ett oppslag. `opacity` og `dot`
// leses RENDRET (getComputedStyle), ikke som klassenavn: påstanden er at pillen
// faktisk er usynlig i ro og at prikken faktisk har trafikklysfargen.
function readStatus(page) {
  return page.evaluate(() => {
    const el = document.getElementById('sync-status');
    const btn = document.getElementById('sync-retry-btn');
    const dot = document.querySelector('.sync-status-dot');
    const r = el ? el.getBoundingClientRect() : null;
    // Tokenene i samme form som getComputedStyle gir dem, så en fargesjekk
    // sammenligner mot paletten i styles.css og ikke mot en kopi her.
    const rgbToken = (name) => {
      const h = getComputedStyle(document.documentElement).getPropertyValue(name).trim().replace('#', '');
      return 'rgb(' + [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).join(', ') + ')';
    };
    return {
      hidden: !el || el.hidden,
      state: el ? el.dataset.state : null,
      text: el ? document.getElementById('sync-status-text').textContent : '',
      quiet: !!(el && el.classList.contains('is-quiet')),
      opacity: el ? getComputedStyle(el).opacity : null,
      dot: dot ? getComputedStyle(dot).backgroundColor : null,
      lights: { green: rgbToken('--primary-dark'), yellow: rgbToken('--warn'),
        grey: rgbToken('--ink-soft'), red: rgbToken('--danger') },
      retryVisible: !!(btn && !btn.hidden),
      retryLabel: btn ? btn.textContent : '',
      rect: r ? { left: r.left, right: r.right, top: r.top, bottom: r.bottom } : null,
      snapshot: window.__huskis.syncStatus.snapshot(),
      toastShows: window.__toastShows,
      toastText: (document.getElementById('toast') || {}).textContent || '',
    };
  });
}

// Kutt forbindelsen på ordentlig: både flagget UI-et leser og klienten som
// faktisk skal nå fram. Uten det andre ville mock-backenden svart som normalt.
function goOffline(page) {
  return page.evaluate(() => {
    const client = window.__huskis.client;
    if (!window.__realFrom) { window.__realFrom = client.from.bind(client); window.__realRpc = client.rpc.bind(client); }
    const fail = () => Promise.reject(new TypeError('Failed to fetch'));
    client.rpc = fail;
    client.from = () => ({ insert: fail, update: () => ({ eq: fail }), delete: () => ({ eq: fail }), select: () => ({ in: fail }) });
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => false });
    window.dispatchEvent(new Event('offline'));
  });
}
function goOnline(page) {
  return page.evaluate(() => {
    const client = window.__huskis.client;
    if (window.__realFrom) { client.from = window.__realFrom; client.rpc = window.__realRpc; }
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => true });
    window.dispatchEvent(new Event('online'));
  });
}

// Endrer teksten på det første listepunktet og lagrer som en ekte brukerendring
// (save() ⇒ lokal buffer + saveSeq + planlagt synk-runde).
function editFirstItem(page, txt) {
  return page.evaluate((txt) => {
    const h = window.__huskis;
    let it = null;
    for (const u of h.state.universes) for (const g of (u.groups || [])) for (const c of (g.cards || [])) for (const x of (c.items || [])) { if (!it) it = x; }
    it.text = txt; it.ts = 8e15; it.org = 'zzz'; // vinner felt-LWW → update-op
    h.save();
  }, txt);
}
const cycle = (page) => page.evaluate(() => window.__huskis.cloudCycle());
// `cloudCycle()` returnerer med én gang hvis en runde ALLEREDE kjører (den ber
// bare om en ny runde etterpå), så testene venter på den tilstanden de er ute
// etter i stedet for å anta at ett kall = én ferdig runde.
const waitState = (page, want) => page.waitForFunction(
  (w) => document.getElementById('sync-status').dataset.state === w, want, { timeout: 8000 });
// Der DET Å NÅ tilstanden er selve påstanden: uten dette kaster ventingen, og
// en regresjon ville avbrutt hele filen i stedet for å skrive en lesbar FAIL.
const softWait = (page, want) => waitState(page, want).catch(() => {});
// Fader pillen dit vi venter? Ventes FRAM i stedet for å sove ut et tall:
// ro-vinduet (`QUIET_AFTER_MS`) og overgangstiden er smaksverdier som godt kan
// justeres, mens påstanden — at pillen faktisk NÅR verdien — står uansett.
// Mellomverdier under overgangen er brøker («0.53»), så en eksakt «0»/«1»
// treffer først når fadingen er ferdig.
const opacityBecomes = (page, want) => page.waitForFunction(
  (w) => getComputedStyle(document.getElementById('sync-status')).opacity === w,
  want, { timeout: 5000 }).then(() => true).catch(() => false);
const serverItemText = (page) => page.evaluate(() => (JSON.parse(localStorage.getItem('hk-mock-db')).items || [])[0].text);
const cachedItemText = (page) => page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('mine-lister-v1:uMe') || '{}');
  for (const u of (s.universes || [])) for (const g of (u.groups || [])) for (const c of (g.cards || [])) for (const x of (c.items || [])) return x.text;
  return null;
});

async function scenario(page, viewport, label) {
  console.log('\n== ' + label + ' ==');

  /* 1) Vellykket synk → «Lagret», grønt lys, og så fader pillen helt ut. */
  {
    await load(page, buildDB().db, viewport);
    await waitState(page, 'saved');
    // Synligheten leses FØRST: kvitteringen står bare ro-vinduet ut
    // (`QUIET_AFTER_MS`, ett sekund) før fadingen begynner. Alt annet under —
    // tekst, tilstand, farge, plassering — er uendret mens den fader.
    const shown = await opacityBecomes(page, '1');
    const s = await readStatus(page);
    check('lagret: statusen er synlig', s.hidden === false, s);
    check('lagret: tilstand = saved', s.state === 'saved', s.state);
    check('lagret: teksten er «Lagret»', s.text === 'Lagret', s.text);
    check('lagret: ingen «Prøv igjen»', s.retryVisible === false, s);
    check('lagret: ingen toast', s.toastShows === 0, s.toastShows);
    check('lagret: pillen ligger innenfor viewporten', s.rect && s.rect.left >= 0 &&
      s.rect.right <= viewport.width && s.rect.bottom <= viewport.height, s.rect);
    check('lagret: grønt lys', s.dot === s.lights.green, { dot: s.dot, vil: s.lights.green });
    check('lagret: pillen er synlig mens kvitteringen står', shown === true, s.opacity);
    // Etter ro-vinduet fader pillen HELT ut: ingen aktivitet, ingenting å vise.
    // Ventes fram i stedet for å sove ut et tall: ro-vinduet (QUIET_AFTER_MS) er
    // en smaksverdi som kan endres, mens PÅSTANDEN — at den faktisk når 0 — står.
    const faded = await opacityBecomes(page, '0');
    check('ro: pillen fader til 100 % gjennomsiktig', faded === true, faded);
    const q = await readStatus(page);
    check('ro: den blir liggende i DOM-en (kan fade inn igjen)', q.hidden === false && q.quiet === true, q);
    // … og fader inn igjen ved neste aktivitet, uten en reload.
    await editFirstItem(page, 'Vekker pillen');
    const back = await opacityBecomes(page, '1');
    const w = await readStatus(page);
    check('aktivitet: pillen fader inn igjen', back === true && w.quiet === false, w);
  }

  /* 2) Frakoblet: riktig tekst, endringen ligger lokalt, ikke på serveren,
        statusen står gjennom flere runder — og ingen toast. */
  {
    await load(page, buildDB().db, viewport);
    await waitState(page, 'saved');
    await goOffline(page);
    await editFirstItem(page, 'Skrevet offline');
    await cycle(page);
    await page.waitForTimeout(300); // den debouncede buffer-skrivingen

    const s = await readStatus(page);
    check('offline: tilstand = offline', s.state === 'offline', s.state);
    check('offline: teksten nevner at endringene lagres på enheten',
      s.text === 'Frakoblet – endringene lagres på denne enheten', s.text);
    check('offline: ingen «Prøv igjen» (nettet, ikke brukeren, er problemet)', s.retryVisible === false, s);
    check('offline: diagnostikken skiller offline fra avvist',
      s.snapshot.offline === true && s.snapshot.rejected.length === 0, s.snapshot);
    check('offline: det er faktisk noe som venter', s.snapshot.pending === true, s.snapshot);
    check('offline: påstanden er sann — endringen ligger i den lokale bufferen',
      await cachedItemText(page) === 'Skrevet offline', await cachedItemText(page));
    check('offline: endringen nådde IKKE «serveren»',
      await serverItemText(page) === 'Punkt', await serverItemText(page));

    // Flere runder med samme problem: statusen står, og ingen toast gjentas.
    await cycle(page); await cycle(page); await cycle(page);
    const s2 = await readStatus(page);
    check('offline: statusen står gjennom flere runder', s2.state === 'offline' && s2.hidden === false, s2);
    check('offline: statusen fader ikke bort mens problemet varer',
      s2.quiet === false && parseFloat(s2.opacity) === 1, s2);
    check('offline: ingen toast i det hele tatt', s2.toastShows === 0, s2.toastShows);

    /* 3) Nettet tilbake → den ventende endringen lander av seg selv. */
    await goOnline(page);
    await page.waitForFunction(() => document.getElementById('sync-status').dataset.state === 'saved', null, { timeout: 6000 });
    const s3 = await readStatus(page);
    check('retry: statusen går til «Lagret» når nettet er tilbake', s3.text === 'Lagret', s3.text);
    check('retry: endringen landet på «serveren»',
      await serverItemText(page) === 'Skrevet offline', await serverItemText(page));
    check('retry: fortsatt ingen toast', s3.toastShows === 0, s3.toastShows);
  }

  /* 4) Nettverksfeil UTEN offline-flagg: ett glipp er ikke «frakoblet». */
  {
    await load(page, buildDB().db, viewport);
    await waitState(page, 'saved');
    // Rundene telles her, så hele forløpet kjøres i ÉN evaluering: da rekker
    // verken pollet eller den debouncede runden å skyte inn en ekstra feiling.
    const r = await page.evaluate(async () => {
      const h = window.__huskis;
      const client = h.client;
      await new Promise((r) => setTimeout(r, 400)); // la en ev. runde i lufta bli ferdig
      window.__realRpc = client.rpc.bind(client);
      client.rpc = () => Promise.reject(new TypeError('Failed to fetch'));
      // Noe må vente, ellers er «alt lagret» det sanne svaret.
      let it = null;
      for (const u of h.state.universes) for (const g of (u.groups || [])) for (const c of (g.cards || [])) for (const x of (c.items || [])) { if (!it) it = x; }
      it.text = 'Uten nett'; it.ts = 8e15; it.org = 'zzz';
      h.save();
      await h.cloudCycle();
      const after1 = h.syncStatus.snapshot();
      await h.cloudCycle();
      const after2 = h.syncStatus.snapshot();
      client.rpc = window.__realRpc;
      return { after1, after2 };
    });
    check('terskel: én feilet runde er IKKE «frakoblet»',
      r.after1.netFailures === 1 && r.after1.offline === false && r.after1.state === 'saving', r.after1);
    check('terskel: to feilede runder på rad ER «frakoblet»',
      r.after2.netFailures === 2 && r.after2.offline === true && r.after2.state === 'offline', r.after2);
    await cycle(page);
    await page.waitForFunction(() => document.getElementById('sync-status').dataset.state === 'saved', null, { timeout: 6000 });
    const s = await readStatus(page);
    check('terskel: én vellykket runde nullstiller frakoblet-tellingen',
      s.snapshot.netFailures === 0 && s.state === 'saved', s.snapshot);
    check('terskel: ingen toast underveis', s.toastShows === 0, s.toastShows);
  }

  /* 5) Delvis avvisning (skjema-avvik på items) + 6) «Prøv igjen». */
  {
    const st = buildDB();
    await load(page, st.db, viewport);
    await waitState(page, 'saved');
    // items-skrivinger avvises som om kolonnen manglet i basen; alt annet går.
    await page.evaluate(() => {
      const client = window.__huskis.client;
      window.__realFrom = client.from.bind(client);
      const errRes = { data: null, error: { code: 'PGRST204', message: "Could not find the 'collapsed' column of 'items' in the schema cache" } };
      client.from = function (table) {
        if (table === 'items') return {
          insert: () => Promise.resolve(errRes),
          update: () => ({ eq: () => Promise.resolve(errRes) }),
          delete: () => ({ eq: () => Promise.resolve(errRes) }),
          select: window.__realFrom(table).select,
        };
        return window.__realFrom(table);
      };
    });
    await editFirstItem(page, 'Avvist A');
    await waitState(page, 'rejected');

    const s = await readStatus(page);
    check('avvist: tilstand = rejected', s.state === 'rejected', s.state);
    check('avvist: teksten er «Noen endringer kunne ikke lagres på kontoen din.»',
      s.text === 'Noen endringer kunne ikke lagres på kontoen din.', s.text);
    check('avvist: «Prøv igjen» tilbys', s.retryVisible === true && s.retryLabel === 'Prøv igjen', s);
    check('avvist: INGEN toast', s.toastShows === 0, s.toastShows);
    check('avvist: UI-et påstår ikke at «resten er lagret»',
      !/[Rr]esten er lagret/.test(s.text + ' ' + s.toastText), s.text + ' | ' + s.toastText);
    check('avvist: UI-teksten er fri for teknikk (kode/tabell/kolonne)',
      !/PGRST|collapsed|items|schema/i.test(s.text), s.text);
    check('avvist: diagnostikken har teknikken', s.snapshot.rejected.length === 1 &&
      s.snapshot.rejected[0].kind === 'schema' && s.snapshot.rejected[0].table === 'items' &&
      s.snapshot.rejected[0].code === 'PGRST204', s.snapshot.rejected);
    check('avvist: diagnostikken skiller avvist fra frakoblet', s.snapshot.offline === false, s.snapshot);
    const errs = await page.evaluate(() => (window.__errs || []).filter(m => /mangler en kolonne/.test(m)).length);
    check('avvist: konsollen har detaljene', errs >= 1, errs);

    // Problemet varer: statusen står, loggen dedupliseres, ingen toast dukker opp.
    await editFirstItem(page, 'Avvist B');
    await cycle(page); await cycle(page);
    const s2 = await readStatus(page);
    check('avvist: statusen står så lenge problemet står', s2.state === 'rejected', s2.state);
    check('avvist: fortsatt ingen toast etter flere runder', s2.toastShows === 0, s2.toastShows);
    const errs2 = await page.evaluate(() => (window.__errs || []).filter(m => /mangler en kolonne/.test(m)).length);
    check('avvist: konsoll-loggen dedupliseres (én signatur)', errs2 === 1, errs2);

    // «Prøv igjen» mens feilen STÅR: avvisningen skal komme tilbake, ikke bli borte.
    await page.click('#sync-retry-btn');
    await page.waitForFunction(() => document.getElementById('sync-status').dataset.state !== 'saving', null, { timeout: 6000 });
    const s3 = await readStatus(page);
    check('prøv igjen: avvisningen står så lenge feilen står', s3.state === 'rejected', s3.state);

    // Feilen rettes (migreringen kommer) → «Prøv igjen» skal faktisk løse det.
    await page.evaluate(() => { window.__huskis.client.from = window.__realFrom; });
    await page.click('#sync-retry-btn');
    await page.waitForFunction(() => document.getElementById('sync-status').dataset.state === 'saved', null, { timeout: 6000 });
    const s4 = await readStatus(page);
    check('prøv igjen: statusen går til «Lagret» først når serveren tok imot', s4.text === 'Lagret', s4.text);
    check('prøv igjen: avvisningslisten er tom', s4.snapshot.rejected.length === 0, s4.snapshot.rejected);
    check('prøv igjen: endringen landet faktisk på «serveren»',
      await serverItemText(page) === 'Avvist B', await serverItemText(page));
    check('prøv igjen: ingen toast gjennom hele forløpet', s4.toastShows === 0, s4.toastShows);
  }

  /* 7) Gjentatte radavvisninger (ikke skjema): stille først, meldes ved terskel. */
  {
    await load(page, buildDB().db, viewport);
    await waitState(page, 'saved');
    // Som i 4): rundene telles, så hele forløpet kjøres i én evaluering.
    const r = await page.evaluate(async () => {
      const h = window.__huskis;
      const client = h.client;
      await new Promise((r) => setTimeout(r, 400)); // la en ev. runde i lufta bli ferdig
      window.__realFrom = client.from.bind(client);
      const errRes = { data: null, error: { code: '42501', message: 'new row violates row-level security policy for table "items"' } };
      client.from = function (table) {
        if (table === 'items') return {
          insert: () => Promise.resolve(errRes),
          update: () => ({ eq: () => Promise.resolve(errRes) }),
          delete: () => ({ eq: () => Promise.resolve(errRes) }),
          select: window.__realFrom(table).select,
        };
        return window.__realFrom(table);
      };
      let it = null;
      for (const u of h.state.universes) for (const g of (u.groups || [])) for (const c of (g.cards || [])) for (const x of (c.items || [])) { if (!it) it = x; }
      it.text = 'RLS-avvist'; it.ts = 8e15; it.org = 'zzz';
      h.save();
      const snaps = [];
      for (let i = 0; i < 3; i++) { await h.cloudCycle(); snaps.push(h.syncStatus.snapshot()); }
      return snaps;
    });
    check('terskel: første avvisning er stille (fortsatt «Lagrer …»)',
      r[0].state === 'saving' && r[0].rejected.length === 0, r[0]);
    check('terskel: andre avvisning er fortsatt stille',
      r[1].state === 'saving' && r[1].rejected.length === 0, r[1]);
    check('terskel: tredje avvisning på samme rad meldes som avvist',
      r[2].state === 'rejected' && r[2].rejected.length === 1 &&
      r[2].rejected[0].kind === 'reject' && r[2].rejected[0].table === 'items', r[2]);
    const s3 = await readStatus(page);
    check('terskel: ingen toast underveis', s3.toastShows === 0, s3.toastShows);
  }

  /* 9) Regresjon: SKRIVE-only nettverksfeil må nå frakoblet-terskelen.
        Pull-en går gjennom, hver skriving dør i transporten. Feltes verdikten
        når pull-en er ferdig, nullstiller hver runde tellingen og statusen står
        på «Lagrer …» i det uendelige i stedet for å si «Frakoblet». */
  {
    await load(page, buildDB().db, viewport);
    await waitState(page, 'saved');
    const r = await page.evaluate(async () => {
      const h = window.__huskis;
      const client = h.client;
      await new Promise((r) => setTimeout(r, 400)); // la en ev. runde i lufta bli ferdig
      // KUN skrivingene dør — `rpc` (get_my_doc) og `select` går som normalt.
      window.__realFrom = client.from.bind(client);
      const boom = () => { throw new TypeError('Failed to fetch'); };
      client.from = function (table) {
        const real = window.__realFrom(table);
        return {
          insert: boom,
          update: () => ({ eq: boom }),
          delete: () => ({ eq: boom }),
          select: real.select.bind(real),
        };
      };
      let it = null;
      for (const u of h.state.universes) for (const g of (u.groups || [])) for (const c of (g.cards || [])) for (const x of (c.items || [])) { if (!it) it = x; }
      it.text = 'Skriving dør'; it.ts = 8e15; it.org = 'zzz';
      h.save();
      const snaps = [];
      for (let i = 0; i < 2; i++) { await h.cloudCycle(); snaps.push(h.syncStatus.snapshot()); }
      client.from = window.__realFrom;
      return snaps;
    });
    check('skrive-only: første runde teller ÉN nettverksfeil (ikke én per rad)',
      r[0].netFailures === 1 && r[0].offline === false, r[0]);
    check('skrive-only: to runder på rad gir «Frakoblet» — pull-en nullstiller ikke tellingen',
      r[1].netFailures === 2 && r[1].offline === true && r[1].state === 'offline', r[1]);
    await softWait(page, 'saved');
    check('skrive-only: statusen kommer tilbake til «Lagret» når skrivingene går igjen',
      (await readStatus(page)).snapshot.netFailures === 0);
    check('skrive-only: endringen landet til slutt',
      await serverItemText(page) === 'Skriving dør', await serverItemText(page));
  }

  /* 10) Regresjon: feilet localStorage-skriving skal ikke skjules. */
  {
    await load(page, buildDB().db, viewport);
    await waitState(page, 'saved');
    // Kvoten er full: setItem kaster for appens egen buffer-nøkkel (mock-basen
    // og sesjonen må fortsatt kunne skrives, ellers faller backenden sammen).
    await page.evaluate(() => {
      const real = Storage.prototype.setItem;
      window.__realSetItem = real;
      Storage.prototype.setItem = function (k, v) {
        if (/^mine-lister-v1:/.test(k)) { const e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; throw e; }
        return real.call(this, k, v);
      };
    });
    await editFirstItem(page, 'Får ikke plass');
    await softWait(page, 'rejected');
    const s = await readStatus(page);
    check('buffer: en feilet localStorage-skriving meldes som avvist',
      s.state === 'rejected', s);
    // Teksten skal peke på ENHETEN, ikke kontoen: synken kan godt ha fått
    // endringen fram til serveren samtidig (se sjekken lenger ned).
    check('buffer: teksten sier at det er DENNE ENHETEN som ikke lagrer',
      s.text === 'Endringene lagres ikke på denne enheten.', s.text);
    check('buffer: diagnostikken sier at det er BUFFEREN, ikke serveren',
      s.snapshot.rejected.length === 1 && s.snapshot.rejected[0].kind === 'cache', s.snapshot.rejected);
    check('buffer: ingen toast', s.toastShows === 0, s.toastShows);

    // Synken lykkes fint mot serveren — men det sier ingenting om localStorage,
    // så runden uten divergens skal IKKE blanke buffer-avvisningen.
    await cycle(page); await cycle(page);
    const s2 = await readStatus(page);
    check('buffer: en synk-runde uten divergens blanker ikke buffer-avvisningen',
      s2.state === 'rejected' && s2.snapshot.rejected.length === 1, s2.snapshot);
    check('buffer: endringen nådde likevel serveren (den lever i minnet)',
      await serverItemText(page) === 'Får ikke plass', await serverItemText(page));

    // Plass igjen → «Prøv igjen» bestiller en ny buffer-skriving, som rydder.
    await page.evaluate(() => { Storage.prototype.setItem = window.__realSetItem; });
    await page.click('#sync-retry-btn');
    await softWait(page, 'saved');
    const s3 = await readStatus(page);
    check('buffer: «Prøv igjen» rydder først når skrivingen faktisk gikk gjennom',
      s3.text === 'Lagret' && s3.snapshot.rejected.length === 0, s3.snapshot);
    check('buffer: endringen ligger nå i den lokale bufferen',
      await cachedItemText(page) === 'Får ikke plass', await cachedItemText(page));
  }

  /* 11) Regresjon: ÉN lagring gir ÉN tilstandsovergang.
        Synken skriver til den samme lokale bufferen som brukeren — flette-
        resultatet, basen, gravsteiner (`saveLocal`). Telles de skrivingene som
        ventende brukerarbeid, faller statusen tilbake til «Lagrer …» hver gang
        en runde skriver ned sitt eget resultat, og blinker «Lagrer …» →
        «Lagret» → «Lagrer …» → «Lagret» etter hver eneste lagring. */
  {
    await load(page, buildDB().db, viewport);
    await waitState(page, 'saved');
    await page.waitForTimeout(800); // la oppstartsrundene falle helt til ro
    await page.evaluate(() => {
      window.__seq = [];
      const el = document.getElementById('sync-status');
      const push = () => {
        const s = el.dataset.state;
        if (window.__seq[window.__seq.length - 1] !== s) window.__seq.push(s);
      };
      push();
      window.__seqObs = new MutationObserver(push);
      window.__seqObs.observe(el, { attributes: true, attributeFilter: ['data-state'] });
    });
    await editFirstItem(page, 'Én lagring');
    // Lenger enn pollet (5 s): bekreftelsesrunden OG en helt vanlig runde til
    // rekker å skrive ned resultatet sitt mens vi ser på.
    await page.waitForTimeout(6000);
    const seq = await page.evaluate(() => { window.__seqObs.disconnect(); return window.__seq; });
    check('én lagring: forløpet er «Lagret» → «Lagrer …» → «Lagret», og der blir det',
      seq.join(' → ') === 'saved → saving → saved', seq);
    check('én lagring: statusen går inn i «Lagrer …» nøyaktig én gang',
      seq.filter((s) => s === 'saving').length === 1, seq);
    check('én lagring: endringen landet faktisk på «serveren»',
      await serverItemText(page) === 'Én lagring', await serverItemText(page));
  }

  /* 12) Trafikklyset. Fargene leses RENDRET og sammenlignes med tokenene i
        styles.css, ikke med en kopi her. */
  {
    await load(page, buildDB().db, viewport);
    await waitState(page, 'saved');
    // «Lagrer …» varer bare et øyeblikk, så fargen fanges i samme øyeblikk
    // tilstanden settes — ikke ved å prøve å treffe vinduet med en timeout.
    await page.evaluate(() => {
      window.__yellow = null;
      const el = document.getElementById('sync-status');
      const dot = document.querySelector('.sync-status-dot');
      window.__lightObs = new MutationObserver(() => {
        if (el.dataset.state === 'saving' && !window.__yellow) {
          window.__yellow = getComputedStyle(dot).backgroundColor;
        }
      });
      window.__lightObs.observe(el, { attributes: true, attributeFilter: ['data-state'] });
    });
    await editFirstItem(page, 'Gult lys');
    await page.waitForFunction(() => !!window.__yellow, null, { timeout: 5000 }).catch(() => {});
    const yellow = await page.evaluate(() => { window.__lightObs.disconnect(); return window.__yellow; });
    const lights = (await readStatus(page)).lights;
    check('trafikklys: «Lagrer …» er gult', yellow === lights.yellow, { dot: yellow, vil: lights.yellow });

    // Frakoblet → grått: lyset er «av», vi vet ikke hva serveren har.
    await softWait(page, 'saved');
    await goOffline(page);
    await editFirstItem(page, 'Grått lys');
    await cycle(page); await cycle(page);
    await softWait(page, 'offline');
    const off = await readStatus(page);
    check('trafikklys: «Frakoblet» er grått', off.dot === off.lights.grey, { dot: off.dot, vil: off.lights.grey });
    check('trafikklys: pillen er synlig når vi er frakoblet', parseFloat(off.opacity) === 1, off.opacity);
    await goOnline(page);
    await softWait(page, 'saved');
  }

  /* 12b) … og rødt når noe faktisk gikk galt. */
  {
    await load(page, buildDB().db, viewport);
    await waitState(page, 'saved');
    await page.evaluate(() => {
      const client = window.__huskis.client;
      window.__realFrom = client.from.bind(client);
      const errRes = { data: null, error: { code: 'PGRST204', message: "Could not find the 'collapsed' column of 'items' in the schema cache" } };
      client.from = function (table) {
        if (table === 'items') return {
          insert: () => Promise.resolve(errRes),
          update: () => ({ eq: () => Promise.resolve(errRes) }),
          delete: () => ({ eq: () => Promise.resolve(errRes) }),
          select: window.__realFrom(table).select,
        };
        return window.__realFrom(table);
      };
    });
    await editFirstItem(page, 'Rødt lys');
    await softWait(page, 'rejected');
    const bad = await readStatus(page);
    check('trafikklys: en avvisning er rød', bad.dot === bad.lights.red, { dot: bad.dot, vil: bad.lights.red });
    check('trafikklys: pillen er synlig når noe gikk galt', parseFloat(bad.opacity) === 1, bad.opacity);
    await page.evaluate(() => { window.__huskis.client.from = window.__realFrom; });
  }
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(e.message));
  await scenario(page, { width: 1200, height: 900 }, 'DESKTOP (1200×900)');
  await scenario(page, { width: 390, height: 780 }, 'MOBIL (390×780)');
  check('ingen ukontrollerte JS-feil på siden', pageErrors.length === 0, pageErrors.slice(0, 6));
  await browser.close();
  console.log(`\n==== ${passed}/${passed + failed} PASS ====`);
  process.exit(failed ? 1 : 0);
})();
