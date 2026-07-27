/*
  Regresjonstest: EN AVVIST SKRIVING SKAL IKKE LÅSE SYNKEN.

  `items.cat_id`/`groups.cat_id` er fremmednøkler til SIN EGEN tabell. To ting
  har brutt synken i produksjon:

    1. REKKEFØLGE — `pushOps` sorterte bare på radtype, og en kategori og
       medlemmene er samme type. Lå medlemmet først i state, ble det sendt
       først, og Postgres avviste det (FK-brudd, HTTP 409).
    2. HENGENDE PEKER — peker `cat` på en kategori som ikke finnes i doc-en i
       det hele tatt, er raden umulig å skrive. Den avviste op-en ble regenerert
       hver runde, og `cloudCycle` planla en ny runde etter HVER push → en varm
       løkke som hamret get_my_doc + den samme 409-en ~1 gang i sekundet, uten
       et eneste signal til brukeren.

  Testen dekker:

    1. Medlem FØR kategorien i state → begge lander (kategorien sendes først).
    2. Hengende `cat` → raden lander på nivå 1 (cat = null) i stedet for å bli
       borte, og en vanlig endring etterpå synkes som normalt.
    3. Ingen varm løkke: en skriving som avvises hver gang skal ikke planlegge
       en ny runde med det samme.

  Kjør:
    python3 -m http.server 8000                  # fra repo-roten, i egen terminal
    NODE_PATH=$(npm root -g) node tests/sync-dangling-category.test.js
*/
const { chromium } = require('playwright');

const BASE = process.env.HUSKIS_URL || 'http://localhost:8000';

// Mocken avviser id-er som ikke er UUID-er (som ekte Postgres), så testradene
// bruker faste, gyldige UUID-er.
const ID = {
  card:    '11111111-1111-4111-8111-111111111111',
  kat:     '22222222-2222-4222-8222-222222222222',
  medlem:  '33333333-3333-4333-8333-333333333333',
  loshode: '44444444-4444-4444-8444-444444444444',
  etterpa: '55555555-5555-4555-8555-555555555555',
  avvist:  '66666666-6666-4666-8666-666666666666',
  borte:   '99999999-9999-4999-8999-999999999999', // kategori som aldri finnes
};


async function register(p) {
  await p.goto(BASE + '/?mock=1');
  await p.waitForTimeout(500);
  const email = 'u' + Math.floor(Math.random() * 1e9) + '@test.no';
  await p.getByText('Registrer deg').click(); await p.waitForTimeout(300);
  await p.locator('#auth-first-name').fill('Test');
  await p.locator('#auth-last-name').fill('Bruker');
  await p.locator('#auth-email').fill(email);
  await p.locator('#auth-password').fill('passord123');
  await p.locator('#auth-submit').click(); await p.waitForTimeout(700);
  await p.getByText('Tilbake til innlogging').click(); await p.waitForTimeout(300);
  await p.locator('#auth-email').fill(email);
  await p.locator('#auth-password').fill('passord123');
  await p.locator('#auth-submit').click(); await p.waitForTimeout(1700);
}

// Rader rett fra mock-«serveren», altså det som FAKTISK er synket.
const server = (p, table) => p.evaluate((t) => {
  const db = JSON.parse(localStorage.getItem('hk-mock-db') || '{}');
  return (db[t] || []).map((r) => ({ id: r.id, cat_id: r.cat_id, is_cat: r.is_cat }));
}, table);

// Legg listepunkter i et kort i state. Pushen tas av den vanlige synk-runden
// (pollet hvert 5. sekund) — `cloudCycle` no-op-er hvis en runde alt er i gang,
// så vi venter på resultatet i stedet for å kalle den direkte.
const addItems = (p, rows, cardId) => p.evaluate(({ specs, cardId }) => {
  const H = window.__huskis, st = H.state;
  const now = Date.now();
  const mk = (o) => Object.assign({ ts: now, org: 'test', pos: 0, posTs: now, posOrg: 'test', trashed: false, _mine: true }, o);
  let c = st.universes[0].groups[0].cards.find((x) => x.id === cardId);
  if (!c) {
    c = mk({ id: cardId, group: st.universes[0].groups[0].id, title: 'Handleliste', collapsed: false, items: [] });
    st.universes[0].groups[0].cards.push(c);
  }
  specs.forEach((s) => c.items.push(mk(Object.assign({ home: cardId, done: false }, s))));
  H.render();
}, { specs: rows, cardId });

// Vent til en rad dukker opp på mock-«serveren» (eller gi opp).
async function waitForRow(p, table, id, ms = 14000) {
  const t0 = Date.now();
  for (;;) {
    const rows = await server(p, table);
    const hit = rows.find((r) => r.id === id);
    if (hit) return hit;
    if (Date.now() - t0 > ms) return null;
    await p.waitForTimeout(500);
  }
}

const results = [];
const log = (n, ok, x = '') => { results.push(ok); console.log((ok ? 'PASS' : 'FAIL') + ' — ' + n + (x ? '  [' + x + ']' : '')); };

async function run(label, vp, mobile) {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: vp, isMobile: mobile, hasTouch: mobile });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  console.log('\n== ' + label + ' ==');
  await register(p);
  // Fersk konto: la appen lage univers + gruppe selv, så vi har et sted å
  // henge kortet vårt (og radene har ekte eier/registre).
  await p.evaluate(() => window.__huskis.addGroup());
  await p.waitForTimeout(1200);

  /* ---------- 1) Medlemmet ligger FØR kategorien i state ---------- */
  // Nøyaktig rekkefølgen som ga FK-brudd: kategorien må sendes først.
  await addItems(p, [
    { id: ID.medlem, text: 'Melk', cat: ID.kat, isCat: false, pos: 1 },
    { id: ID.kat, text: 'Meieri', cat: null, isCat: true, pos: 0 },
  ], ID.card);
  const kat = await waitForRow(p, 'items', ID.kat);
  const med = await waitForRow(p, 'items', ID.medlem);
  log(label + ' 1: kategorien landet på serveren', !!kat && kat.is_cat === true, JSON.stringify(kat || null));
  log(label + ' 1: medlemmet landet MED kategori-pekeren i behold',
    !!med && med.cat_id === ID.kat, JSON.stringify(med || null));

  /* ---------- 2) Hengende kategori-peker ---------- */
  // Peker på en kategori som ikke finnes noe sted. Før ble raden avvist for
  // alltid; nå lander den på nivå 1 så den er synlig og kan flyttes tilbake.
  await addItems(p, [{ id: ID.loshode, text: 'Ost', cat: ID.borte, isCat: false, pos: 2 }], ID.card);
  const orphan = await waitForRow(p, 'items', ID.loshode);
  log(label + ' 2: raden med hengende kategori-peker lander (på nivå 1)',
    !!orphan && !orphan.cat_id, JSON.stringify(orphan || null));

  await addItems(p, [{ id: ID.etterpa, text: 'Brød', cat: null, isCat: false, pos: 3 }], ID.card);
  // … og LOKALT må pekeren også være nullet, ellers ser fletteren en forskjell
  // mot serveren hver eneste runde og sender den samme oppdateringen i det
  // uendelige (en varm løkke av vellykkede skrivinger).
  const lokal = await p.evaluate((id) => {
    const it = window.__huskis.docFromMyState().items.find((r) => r.id === id);
    return it ? { id: it.id, cat: it.cat } : null;
  }, ID.loshode);
  log(label + ' 2: den hengende pekeren er nullet lokalt også (fletteren konvergerer)',
    !!lokal && lokal.cat === null, JSON.stringify(lokal));

  const etterpa = await waitForRow(p, 'items', ID.etterpa);
  log(label + ' 2: en vanlig endring etterpå synkes som normalt', !!etterpa,
    (await server(p, 'items')).map((r) => r.id).join(','));

  /* ---------- 3) En permanent avvist skriving skal ikke gi en varm løkke ---------- */
  // Vi tvinger fram en avvisning backend-siden (som en RLS- eller FK-feil vi
  // ikke kan sanere bort) og teller hvor mange synk-runder som kjøres. Før
  // planla hver push en ny runde 150 ms senere, uansett utfall.
  const loop = await p.evaluate(async (ID) => {
    const H = window.__huskis, st = H.state;
    const client = H.client;
    let cycles = 0;
    const origRpc = client.rpc.bind(client);
    client.rpc = function (name, params) { if (name === 'get_my_doc') cycles++; return origRpc(name, params); };
    const origFrom = client.from.bind(client);
    client.from = function (table) {
      const t = origFrom(table);
      const origInsert = t.insert.bind(t);
      t.insert = function (payload) {
        if (payload && payload.id === ID.avvist) {
          return Promise.resolve({ data: null, error: { code: '42501', message: 'avvist av testen' } });
        }
        return origInsert(payload);
      };
      return t;
    };
    const now = Date.now();
    const c = st.universes[0].groups[0].cards.find((x) => x.id === ID.card);
    c.items.push({ id: ID.avvist, home: ID.card, text: 'Nekt', cat: null, isCat: false, done: false,
      trashed: false, _mine: true, ts: now, org: 'test', pos: 9, posTs: now, posOrg: 'test' });
    await H.cloudCycle();
    const after = cycles;
    await new Promise((r) => setTimeout(r, 3000)); // 3 s ≈ under ett poll-intervall (5 s)
    const total = cycles;
    client.rpc = origRpc; client.from = origFrom;
    return { etterPush: after, totalt: total };
  }, ID);
  // Den varme løkken ga ~1 runde i sekundet. Uten den skal 3 sekunder uten
  // poll-tikk gi svært få nye runder.
  log(label + ' 3: en avvist skriving planlegger ikke en ny runde med det samme',
    loop.totalt - loop.etterPush <= 2, JSON.stringify(loop));

  log(label + ': ingen JS-feil', errs.length === 0, errs.join(' | '));
  await p.close();
  await b.close();
}

(async () => {
  await run('desktop', { width: 1200, height: 900 }, false);
  await run('mobil', { width: 390, height: 780 }, true);
  const failed = results.filter((x) => !x).length;
  console.log('\n==== ' + (results.length - failed) + '/' + results.length + ' PASS ====');
  process.exit(failed ? 1 : 0);
})();
