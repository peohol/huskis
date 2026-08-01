/*
  Regresjonstest: PERMANENT SLETTEDE OBJEKTER SKAL ALDRI GJENOPPSTÅ.

  Feilen: `cloudBase` (3-veis-flettingens base) levde bare i minnet. Ved hver
  oppstart var den `null`, så første synk var i praksis
  `reconcile(emptyDoc(), lokal, fjern)` — og kombinasjonen «finnes lokalt, ikke
  på serveren, ikke i base» ble lest som en LOKAL NYOPPRETTELSE. En klient med
  utdatert cache (en annen enhet, en gammel fane, eller det andre domenet, som
  har sin egen localStorage) satte da inn igjen alt den hadde og serveren ikke
  hadde — inkludert objekter som var slettet permanent. `state._tomb` og
  `tombstones`-tabellen fantes, men ingen av dem ble konsultert.

  Testen dekker:

    1. Enhet A sletter permanent; enhet B åpner senere med gammel cache
       (base i behold → fletteren ser at raden ER fjern-slettet).
    2. Samme, men cachen mangler `cloudBase` (gammel klientversjon): den
       manglende basen skal behandles som UKJENT HISTORIKK — klienten spør
       serveren om gravsteiner før den skriver noe.
    3. Det andre domenet (egen localStorage, samme server).
    4. Rå INSERT med en gravlagt id avvises av databasen (PT409).
    5. Gjentatt synk etter permanent sletting gjenoppliver ingenting.
    6. Vanlig sletting til papirkurven + gjenoppretting virker fortsatt.
    7. En genuint ny liste opprettes og synkes som før.
    8. Utlogging + innlogging som en annen bruker arver verken base eller
       gravsteiner fra forrige konto.

  Kjør (fra repo-roten, med `python3 -m http.server 8000` i egen terminal):
    NODE_PATH=$(npm root -g) node tests/sync-resurrection.test.js
*/
const { chromium } = require('playwright');

const BASE = process.env.HUSKIS_URL || 'http://localhost:8000';
// «Det andre domenet»: samme server, egen localStorage-krok (som
// huskis.vercel.app vs www.huskis.no).
const ALT = process.env.HUSKIS_ALT_URL || 'http://127.0.0.1:8000';

const CACHE_PREFIX = 'mine-lister-v1:';
const DB_KEY = 'hk-mock-db';

// Mocken avviser id-er som ikke er UUID-er (som ekte Postgres).
const ID = {
  doomed: 'aa000000-0000-4000-8000-000000000001', // slettes permanent
  itemA: 'aa000000-0000-4000-8000-000000000002',
  itemB: 'aa000000-0000-4000-8000-000000000003',
  keeper: 'bb000000-0000-4000-8000-000000000001', // kun til papirkurv-testen
  keepIt: 'bb000000-0000-4000-8000-000000000002',
  fresh: 'cc000000-0000-4000-8000-000000000001', // opprettes etter slettingen
  raw: 'aa000000-0000-4000-8000-000000000001', // = doomed, brukt i rå-insert-testen
  second: 'ee000000-0000-4000-8000-000000000001', // slettes i vakt-scenarioene
  secondIt: 'ee000000-0000-4000-8000-000000000002',
  proof: 'ee000000-0000-4000-8000-000000000003', // bevis på at synken går videre
};

// Lar testen styre hva gravsteins-oppslaget svarer, uten å røre appen: en
// init-script fanger `window.HK_MOCK` når mock-backenden setter den, og legger
// et lag rundt `from('tombstones')`. Modus leses fra localStorage ved hvert kall.
//   'real'  (standard) — vanlig oppslag
//   'error' — oppslaget feiler (offline / manglende lesetilgang)
//   'empty' — oppslaget finner ingenting (klienten vet ikke bedre)
const TOMB_MODE_KEY = 'hk-test-tomb-mode';
function installTombLookupHook(page) {
  return page.addInitScript((key) => {
    let real;
    Object.defineProperty(window, 'HK_MOCK', {
      configurable: true,
      get() { return real; },
      set(v) {
        const origCreate = v.createClient;
        v.createClient = function () {
          const c = origCreate.apply(this, arguments);
          const origFrom = c.from.bind(c);
          c.from = function (t) {
            const mode = localStorage.getItem(key) || 'real';
            if (t !== 'tombstones' || mode === 'real') return origFrom(t);
            return {
              select: () => ({
                in: () => Promise.resolve(mode === 'error'
                  ? { data: null, error: { message: 'gravsteins-oppslaget er nede' } }
                  : { data: [], error: null }),
              }),
            };
          };
          return c;
        };
        real = v;
      },
    });
  }, TOMB_MODE_KEY);
}
const setTombMode = (p, mode) => p.evaluate(({ k, m }) => localStorage.setItem(k, m), { k: TOMB_MODE_KEY, m: mode });

const results = [];
const log = (n, ok, x = '') => { results.push(ok); console.log((ok ? 'PASS' : 'FAIL') + ' — ' + n + (x ? '  [' + x + ']' : '')); };

/* ---------------- felleshjelpere ---------------- */

async function register(p, base) {
  await p.goto(base + '/?mock=1');
  await p.waitForTimeout(500);
  const email = 'u' + Math.floor(Math.random() * 1e9) + '@test.no';
  await p.getByText('Registrer deg').click(); await p.waitForTimeout(300);
  await p.locator('#auth-first-name').fill('Test');
  await p.locator('#auth-last-name').fill('Bruker');
  await p.locator('#auth-email').fill(email);
  await p.locator('#auth-password').fill('passord123');
  await p.locator('#auth-submit').click(); await p.waitForTimeout(700);
  await p.getByText('Tilbake til innlogging').click(); await p.waitForTimeout(300);
  await login(p, email);
  return email;
}
async function login(p, email) {
  await p.locator('#auth-email').fill(email);
  await p.locator('#auth-password').fill('passord123');
  await p.locator('#auth-submit').click();
  await p.waitForTimeout(1700);
}

// Rader rett fra mock-«serveren» — altså det som FAKTISK ligger i databasen.
const serverRows = (p, table) => p.evaluate((t) => {
  const db = JSON.parse(localStorage.getItem('hk-mock-db') || '{}');
  return (db[t] || []).map((r) => ({ id: r.id, owner_id: r.owner_id, trashed: !!r.trashed }));
}, table);
const serverHas = async (p, table, id) => (await serverRows(p, table)).some((r) => r.id === id);
const localHas = (p, id) => p.evaluate((x) => !!window.__huskis.docFromMyState().cards.find((c) => c.id === x)
  || !!window.__huskis.docFromMyState().items.find((c) => c.id === x), id);

// Legg en liste med to listepunkter i den aktive gruppen (som en vanlig
// opprettelse: synken tar den på neste runde).
const addCard = (p, cardId, itemIds, title) => p.evaluate(({ cardId, itemIds, title }) => {
  const H = window.__huskis, st = H.state;
  const now = Date.now();
  const mk = (o) => Object.assign({ ts: now, org: 'test', pos: 0, posTs: now, posOrg: 'test', trashed: false, _role: 'owner' }, o);
  const g = st.universes[0].groups[0];
  const c = mk({ id: cardId, group: g.id, title: title, collapsed: false, k: true, p: true, items: [] });
  itemIds.forEach((id, i) => c.items.push(mk({ id, home: cardId, text: 'Punkt ' + (i + 1), done: false, cat: null, isCat: false, pos: i })));
  g.cards.push(c);
  H.render();
}, { cardId, itemIds, title });

async function waitForServerRow(p, table, id, ms = 14000) {
  const t0 = Date.now();
  for (;;) {
    if (await serverHas(p, table, id)) return true;
    if (Date.now() - t0 > ms) return false;
    await p.waitForTimeout(400);
  }
}
async function waitForServerGone(p, table, id, ms = 14000) {
  const t0 = Date.now();
  for (;;) {
    if (!await serverHas(p, table, id)) return true;
    if (Date.now() - t0 > ms) return false;
    await p.waitForTimeout(400);
  }
}
// Kjør noen fulle synk-runder og la køen tømme seg.
async function settle(p, rounds = 3) {
  for (let i = 0; i < rounds; i++) {
    await p.evaluate(() => window.__huskis.cloudCycle());
    await p.waitForTimeout(400);
  }
}

/* ---------------- selve testløpet ---------------- */

async function run(label, vp, mobile) {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: vp, isMobile: mobile, hasTouch: mobile });
  const p = await ctx.newPage();
  await installTombLookupHook(p);
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  console.log('\n== ' + label + ' ==');

  const email = await register(p, BASE);
  await p.evaluate(() => window.__huskis.addGroup());
  await p.waitForTimeout(1000);

  await addCard(p, ID.doomed, [ID.itemA, ID.itemB], 'Skal slettes');
  await addCard(p, ID.keeper, [ID.keepIt], 'Skal beholdes');
  const landed = await waitForServerRow(p, 'cards', ID.doomed);
  log(label + ' 0: listen ble synket til serveren', landed);

  // «Enhet B» er akkurat denne cachen, tatt før slettingen.
  const staleCache = await p.evaluate((pfx) => localStorage.getItem(pfx + window.__huskis.authUser.id), CACHE_PREFIX);
  const uid = await p.evaluate(() => window.__huskis.authUser.id);
  log(label + ' 0: cachen inneholder en versjonert base', (() => {
    try { const s = JSON.parse(staleCache); return !!s._base && s._baseV === 1; } catch (e) { return false; }
  })());

  /* ---------- Permanent sletting på «enhet A» ---------- */
  await p.evaluate((id) => {
    const H = window.__huskis;
    const c = H.state.universes[0].groups[0].cards.find((x) => x.id === id);
    c.trashed = true; c.ts = Date.now(); c.org = 'test';
    H.render();
  }, ID.doomed);
  await p.waitForTimeout(700);
  await p.evaluate(() => window.__huskis.emptyCardsTrash());
  const gone = await waitForServerGone(p, 'cards', ID.doomed);
  log(label + ' 1: permanent sletting fjernet listen fra serveren', gone);
  const tombOk = await p.evaluate(() => {
    const db = JSON.parse(localStorage.getItem('hk-mock-db') || '{}');
    return (db.tombstones || []).length;
  });
  log(label + ' 1: serveren skrev gravsteiner (liste + listepunkter)', tombOk >= 3, 'antall=' + tombOk);

  /* ---------- 1) Enhet B med gammel cache (base i behold) ---------- */
  await p.evaluate(({ pfx, uid, raw }) => localStorage.setItem(pfx + uid, raw), { pfx: CACHE_PREFIX, uid, raw: staleCache });
  await p.reload();
  await p.waitForTimeout(2500);
  await settle(p);
  log(label + ' 2: gammel cache MED base gjenoppliver ikke listen lokalt',
    !await localHas(p, ID.doomed));
  log(label + ' 2: … og skriver den ikke tilbake til serveren',
    !await serverHas(p, 'cards', ID.doomed));
  log(label + ' 2: … heller ikke listepunktene',
    !await serverHas(p, 'items', ID.itemA) && !await serverHas(p, 'items', ID.itemB));

  /* ---------- 2) Gammel klient UTEN base (ukjent historikk) ---------- */
  await p.evaluate(({ pfx, uid, raw }) => {
    const s = JSON.parse(raw);
    delete s._base; delete s._baseV;   // klienten som lagret dette kjente ikke basen
    delete s._tomb;                    // … og hadde ingen anelse om slettingen
    localStorage.setItem(pfx + uid, JSON.stringify(s));
  }, { pfx: CACHE_PREFIX, uid, raw: staleCache });
  await p.reload();
  await p.waitForTimeout(2500);
  await settle(p);
  log(label + ' 3: cache UTEN base gjenoppliver ikke listen lokalt',
    !await localHas(p, ID.doomed));
  log(label + ' 3: … og skriver den ikke til serveren',
    !await serverHas(p, 'cards', ID.doomed));
  log(label + ' 3: gravsteinen er lært lokalt (spørringen mot serveren traff)',
    await p.evaluate((id) => window.__huskis.tombIds().has(id), ID.doomed));
  log(label + ' 3: basen er gjenopprettet etter runden',
    await p.evaluate(() => window.__huskis.cloudBase !== null));
  log(label + ' 3: den BEHOLDTE listen overlevde runden (ingen overivrig opprydding)',
    await localHas(p, ID.keeper) && await serverHas(p, 'cards', ID.keeper));

  /* ---------- 3) Gjentatt synk ---------- */
  await settle(p, 4);
  log(label + ' 4: gjentatt synk gjenoppliver ingenting',
    !await localHas(p, ID.doomed) && !await serverHas(p, 'cards', ID.doomed));

  /* ---------- 4) Rå INSERT med gravlagt id ---------- */
  const rawInsert = await p.evaluate(async ({ id, uid }) => {
    const H = window.__huskis;
    const g = H.state.universes[0].groups[0];
    const res = await H.client.from('cards').insert({
      id: id, owner_id: uid, group_id: g.id, title: 'Snikinnført', trashed: false,
      ts: Date.now(), org: 'raw', pos: 0, pos_ts: Date.now(), pos_org: 'raw',
    });
    return { err: res && res.error ? { code: res.error.code, message: res.error.message } : null,
             tomb: !!(res && res.error && H.isTombstoneReject(res.error)) };
  }, { id: ID.raw, uid });
  log(label + ' 5: en rå INSERT med gravlagt id avvises av databasen',
    !!rawInsert.err && rawInsert.tomb, JSON.stringify(rawInsert.err));
  log(label + ' 5: … og raden finnes fortsatt ikke', !await serverHas(p, 'cards', ID.raw));

  /* ---------- 5) Vanlig papirkurv + gjenoppretting ---------- */
  await p.evaluate((id) => {
    const H = window.__huskis;
    const c = H.state.universes[0].groups[0].cards.find((x) => x.id === id);
    c.trashed = true; c.ts = Date.now(); c.org = 'test';
    H.render();
  }, ID.keeper);
  await settle(p);
  const trashedOnServer = (await serverRows(p, 'cards')).find((r) => r.id === ID.keeper);
  log(label + ' 6: sletting til papirkurven synkes som et flagg (raden består)',
    !!trashedOnServer && trashedOnServer.trashed === true);
  await p.evaluate((id) => {
    const H = window.__huskis;
    const c = H.state.universes[0].groups[0].cards.find((x) => x.id === id);
    c.trashed = false; c.ts = Date.now(); c.org = 'test';
    H.render();
  }, ID.keeper);
  await settle(p);
  const restored = (await serverRows(p, 'cards')).find((r) => r.id === ID.keeper);
  log(label + ' 6: gjenoppretting fra papirkurven virker fortsatt',
    !!restored && restored.trashed === false && await localHas(p, ID.keeper));

  /* ---------- 6) Genuint ny liste ---------- */
  await addCard(p, ID.fresh, [], 'Helt ny');
  log(label + ' 7: en genuint ny liste synkes som før', await waitForServerRow(p, 'cards', ID.fresh));

  /* ---------- 7a) Gravsteins-oppslaget feiler ---------- */
  // Én uavklart id skal ikke stoppe all synk: de uverifiserte radene blir
  // stående lokalt uten å skrives, mens resten av runden går som normalt.
  await addCard(p, ID.second, [ID.secondIt], 'Runde to');
  await waitForServerRow(p, 'cards', ID.second);
  const staleTwo = await p.evaluate((pfx) => localStorage.getItem(pfx + window.__huskis.authUser.id), CACHE_PREFIX);
  await p.evaluate((id) => {
    const H = window.__huskis;
    const c = H.state.universes[0].groups[0].cards.find((x) => x.id === id);
    c.trashed = true; c.ts = Date.now(); c.org = 'test';
    H.render();
  }, ID.second);
  await p.waitForTimeout(700);
  await p.evaluate(() => window.__huskis.emptyCardsTrash());
  await waitForServerGone(p, 'cards', ID.second);

  const reopenStale = async (mode) => {
    await setTombMode(p, mode);
    await p.evaluate(({ pfx, uid, raw }) => {
      const s = JSON.parse(raw);
      delete s._base; delete s._baseV; delete s._tomb;
      localStorage.setItem(pfx + uid, JSON.stringify(s));
    }, { pfx: CACHE_PREFIX, uid, raw: staleTwo });
    await p.reload();
    await p.waitForTimeout(2500);
    await settle(p, 3);
  };

  await reopenStale('error');
  log(label + ' 9: uten svar fra gravsteins-oppslaget skrives den uavklarte raden IKKE',
    !await serverHas(p, 'cards', ID.second));
  log(label + ' 9: … men den blir stående lokalt (ingen data kastes på tvil)',
    await localHas(p, ID.second));
  await addCard(p, ID.proof, [], 'Går videre');
  log(label + ' 9: … og resten av synken går som normalt (tvilen gjelder kun cachens id-er)',
    await waitForServerRow(p, 'cards', ID.proof));
  // Tvilen lever bare i minnet. Skrives en GYLDIG base til disk mens den står
  // uavklart, ville neste oppstart lest basen som «vi vet hva serveren hadde»,
  // mistet tvilen, og skrevet radene som nyopprettelser — mot en database uten
  // insert-vakten ville det gjenopplivet dem. Basen skal derfor være ugyldig på
  // disk så lenge historikken er uavklart …
  const baseOnDisk = await p.evaluate((pfx) => {
    const s = JSON.parse(localStorage.getItem(pfx + window.__huskis.authUser.id) || '{}');
    return { base: s._base, v: s._baseV };
  }, CACHE_PREFIX);
  log(label + ' 9: uavklart historikk gir ingen gyldig base på disk',
    baseOnDisk.v !== 1 && !baseOnDisk.base, JSON.stringify(baseOnDisk));
  // … og en reload MENS oppslaget fortsatt er nede må derfor holde igjen på nytt.
  await p.reload();
  await p.waitForTimeout(2500);
  await settle(p, 3);
  log(label + ' 9: en reload med oppslaget fortsatt nede gjenoppliver ingenting',
    !await serverHas(p, 'cards', ID.second));
  await setTombMode(p, 'real');
  await settle(p, 3);
  log(label + ' 9: når oppslaget svarer igjen, avklares raden uten et eneste skriveforsøk',
    await p.evaluate((id) => window.__huskis.tombIds().has(id), ID.second)
    && !await serverHas(p, 'cards', ID.second) && !await localHas(p, ID.second));

  /* ---------- 7b) Databasen er siste forsvarslag ---------- */
  // Nå «finner» oppslaget ingenting (som en klient mot en database uten
  // gravsteins-lesetilgang, eller et kappløp): klienten skriver, og
  // insert-vakten avviser. Klienten skal lære av avvisningen, ikke prøve igjen.
  await reopenStale('empty');
  log(label + ' 10: insert-vakten hindret gjenoppstandelsen',
    !await serverHas(p, 'cards', ID.second));
  log(label + ' 10: klienten lærte gravsteinen av avvisningen',
    await p.evaluate((id) => window.__huskis.tombIds().has(id), ID.second));
  await settle(p, 3);
  log(label + ' 10: … og prøver ikke igjen ved neste runde',
    !await serverHas(p, 'cards', ID.second) && !await localHas(p, ID.second));
  await setTombMode(p, 'real');

  /* ---------- 7) Det andre domenet ---------- */
  // Samme «server» (mock-databasen kopieres over), egen localStorage — og en
  // utdatert app-cache uten base, slik et domene som ikke har vært brukt på en
  // stund faktisk ser ut.
  const serverDb = await p.evaluate((k) => localStorage.getItem(k), DB_KEY);
  const alt = await ctx.newPage();
  const altErrs = []; alt.on('pageerror', (e) => altErrs.push(e.message));
  await alt.goto(ALT + '/?mock=1');
  await alt.waitForTimeout(400);
  await alt.evaluate(({ dbKey, db, pfx, uid, raw }) => {
    localStorage.setItem(dbKey, db);
    const s = JSON.parse(raw);
    delete s._base; delete s._baseV; delete s._tomb;
    localStorage.setItem(pfx + uid, JSON.stringify(s));
  }, { dbKey: DB_KEY, db: serverDb, pfx: CACHE_PREFIX, uid, raw: staleCache });
  await alt.goto(ALT + '/?mock=1');
  await alt.waitForTimeout(600);
  await login(alt, email);
  await settle(alt);
  log(label + ' 8: det andre domenet gjenoppliver ikke listen lokalt',
    !await localHas(alt, ID.doomed));
  log(label + ' 8: … og skriver den ikke til den delte serveren',
    !await serverHas(alt, 'cards', ID.doomed));
  log(label + ' 8: det andre domenet ser det som FAKTISK finnes',
    await localHas(alt, ID.fresh));
  log(label + ' 8: ingen JS-feil på det andre domenet', altErrs.length === 0, altErrs.join(' | '));
  await alt.close();

  /* ---------- 8) Bytte av bruker ---------- */
  await p.evaluate(() => window.__huskis.logout());
  await p.waitForTimeout(1200);
  const afterLogout = await p.evaluate(() => ({
    tombs: window.__huskis.tombIds().size,
    base: window.__huskis.cloudBase,
    universes: window.__huskis.state.universes.length,
  }));
  log(label + ' 9: utlogging tømmer base, gravsteiner og innhold i minnet',
    afterLogout.tombs === 0 && afterLogout.base === null && afterLogout.universes === 0,
    JSON.stringify(afterLogout));
  const email2 = 'v' + Math.floor(Math.random() * 1e9) + '@test.no';
  await p.getByText('Registrer deg').click(); await p.waitForTimeout(300);
  await p.locator('#auth-first-name').fill('Andre');
  await p.locator('#auth-last-name').fill('Bruker');
  await p.locator('#auth-email').fill(email2);
  await p.locator('#auth-password').fill('passord123');
  await p.locator('#auth-submit').click(); await p.waitForTimeout(700);
  await p.getByText('Tilbake til innlogging').click(); await p.waitForTimeout(300);
  await login(p, email2);
  await settle(p);
  const asOther = await p.evaluate(() => ({
    tombs: window.__huskis.tombIds().size,
    cards: window.__huskis.docFromMyState().cards.length,
  }));
  log(label + ' 9: den nye brukeren arver hverken gravsteiner eller innhold',
    asOther.tombs === 0 && asOther.cards === 0, JSON.stringify(asOther));
  await p.evaluate(() => window.__huskis.addGroup());
  await p.waitForTimeout(300);
  await addCard(p, 'dd000000-0000-4000-8000-000000000001', [], 'Bruker 2 sin');
  log(label + ' 9: den nye brukeren kan opprette og synke som normalt',
    await waitForServerRow(p, 'cards', 'dd000000-0000-4000-8000-000000000001'));

  log(label + ': ingen JS-feil', errs.length === 0, errs.join(' | '));
  await p.close();
  await ctx.close();
  await b.close();
}

(async () => {
  await run('desktop', { width: 1200, height: 900 }, false);
  await run('mobil', { width: 390, height: 780 }, true);
  const failed = results.filter((x) => !x).length;
  console.log('\n==== ' + (results.length - failed) + '/' + results.length + ' PASS ====');
  process.exit(failed ? 1 : 0);
})();
