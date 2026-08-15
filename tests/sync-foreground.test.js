/*
  Nettlesertest for HVA SOM STARTER EN SYNK-RUNDE NÅR APPEN KOMMER TILBAKE
  (mot mock-backend, ?mock=1).

  Bakgrunn: synken hentes fram av tre ting — realtime, pollet (5 s) og
  `online`. Pollet hopper over runder mens siden er skjult, så etter en pause i
  bakgrunnen er det INTERVALLET som skal ta appen igjen. Det er nettopp den
  mekanismen en app-runtime ikke lover noe om: en skjult side får timerne sine
  strupet, og en bakgrunnsprosess kan fryses helt. Gjenopptakelsen er derimot en
  hendelse, og den finnes i både browser og WebView
  (`visibilitychange` — docs/mobilapp-plan.md, fase 3).

  Verifiserer:
    1. Skjult side: gjenopptakelses-lytteren fyrer IKKE på veien inn i
       bakgrunnen. En app som ligger i bakgrunnen skal ikke polle.
    2. Regresjon (feiler uten fiksen): med pollet slått av — altså akkurat den
       situasjonen en strupet/fryst timer gir — henter appen inn det en annen
       enhet gjorde, MED ÉN GANG den er synlig igjen. Uten lytteren kommer
       ingen runde i det hele tatt.
    3. Ingen runde uten sesjon: er brukeren logget ut, skal en gjenopptakelse
       ikke røre skyen.
    4. Websignalene er tilstrekkelige for NETTET: uten at `navigator.onLine`
       noen gang er falsk og uten én eneste `online`-hendelse — nøyaktig det en
       Android-WebView uten `ACCESS_NETWORK_STATE` gir — kommer en endring som
       ikke nådde fram, fram av seg selv. Pollet er nettet under, ikke
       hendelsen. (Denne står ikke og faller med lytteren over; den låser
       forutsetningen for at ingenting native trengs.)

  Ett viewport: dette er synk-logikk, uten avhengighet av layout eller pekertype
  (tests/CLAUDE.md).

  Kjør:
    python3 -m http.server 8000
    NODE_PATH=$(npm root -g) node tests/sync-foreground.test.js
*/
const { chromium } = require(require('path').join(process.env.NODE_PATH || require('child_process').execSync('npm root -g').toString().trim(), 'playwright'));
const BASE = process.env.HUSKIS_URL || 'http://localhost:8000';

let passed = 0, failed = 0;
function check(name, cond, evidence) {
  if (cond) { passed++; console.log('  ✓', name); return; }
  failed++;
  console.log('  ✗ FAIL:', name, evidence === undefined ? '' : '→ ' + JSON.stringify(evidence));
}

const U = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16); });

// Én egen-eid liste med ett listepunkt. `NEW` er id-en «den andre enheten»
// bruker når den lager en liste til underveis i testen.
function buildDB() {
  const uid = 'uMe';
  const PU = U(), PG = U(), PL = U(), PI = U(), NEW = U();
  const base = (extra) => Object.assign({ trashed: false, locked: false, unlocked: false,
    invite_policy: 'inherit', ts: 1, org: 'a', pos: 0, pos_ts: 0, pos_org: '' }, extra);
  return {
    ids: { uid, PU, PG, PL, PI, NEW },
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

async function load(page, db) {
  await page.goto(BASE + '/?mock=1');
  await page.evaluate((db) => {
    localStorage.clear(); sessionStorage.clear();
    localStorage.setItem('hk-mock-db', JSON.stringify(db));
    // Kontoen har sett HELE introduksjonen (docs/introduksjon.md): demoen bytter
    // ut `state` med en kulisse og stenger synken mens den står på.
    sessionStorage.setItem('hk-mock-session', JSON.stringify({ id: 'uMe', email: 'me@x.no', user_metadata: { onboarding: { v: 3, status: 'done' }, tips: { drag: true, trash: true, moveList: true, dragTrash: true } } }));
  }, db);
  await page.goto(BASE + '/?mock=1');
  // `lastMy` settes først når get_my_doc har svart — da er første runde ferdig.
  await page.waitForFunction(() => window.__huskis && window.__huskis.authUser && window.__huskis.lastMy, { timeout: 8000 });
  await page.waitForFunction(() => document.getElementById('sync-status').dataset.state === 'saved', null, { timeout: 8000 });
  // Teller pullene. Runder er det som skal påvises/avkreftes her, og `get_my_doc`
  // er første steg i hver eneste av dem.
  await page.evaluate(() => {
    const client = window.__huskis.client;
    const realRpc = client.rpc.bind(client);
    window.__pulls = 0;
    client.rpc = function (name) {
      if (name === 'get_my_doc') window.__pulls++;
      return realRpc.apply(null, arguments);
    };
  });
}

// Skjul/vis siden slik nettleseren gjør det, og fyr signalet appen lytter på.
const setVisible = (page, visible) => page.evaluate((v) => {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => !v });
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (v ? 'visible' : 'hidden') });
  document.dispatchEvent(new Event('visibilitychange'));
}, visible);

const pulls = (page) => page.evaluate(() => window.__pulls);
const hasCard = (page, id) => page.evaluate((id) => {
  const h = window.__huskis;
  for (const u of h.state.universes) for (const g of (u.groups || [])) for (const c of (g.cards || [])) if (c.id === id) return true;
  return false;
}, id);

async function scenario(page) {
  /* 1–3) Gjenopptakelsen som synk-signal. Pollet slås AV med vilje: det er den
     tilstanden en strupet eller fryst timer setter appen i, og uten det ville
     pollet levert svaret innen 5 s uansett — da beviser testen ingenting. */
  {
    const { ids, db } = buildDB();
    await load(page, db);

    const kuttet = await page.evaluate(() => {
      const p = (window.__intervals || []).filter((i) => i.ms === 5000);
      p.forEach((i) => clearInterval(i.id));
      return p.length;
    });
    check('oppsett: synk-pollet (5 s) er slått av for denne runden', kuttet >= 1, kuttet);

    // 1) Inn i bakgrunnen: ingen runde skal starte av det.
    const førSkjult = await pulls(page);
    await setVisible(page, false);
    await page.waitForTimeout(600); // fraværsbevis: en runde ville rukket å starte
    check('skjult: gjenopptakelses-lytteren fyrer ikke på vei INN i bakgrunnen',
      await pulls(page) === førSkjult, { før: førSkjult, etter: await pulls(page) });

    // «En annen enhet» lager en liste mens vi ligger i bakgrunnen. Skrivingen
    // skjer i vårt eget vindu, så mock-backendens realtime-ping (et `storage`-
    // event fra en ANNEN fane) fyrer ikke — ingen skjult vei inn.
    await page.evaluate((ids) => {
      const db = window.HK_MOCK._loadDB();
      db.cards.push({ id: ids.NEW, owner_id: ids.uid, group_id: ids.PG,
        title: 'Laget på en annen enhet', k: true, p: true, lab_ts: 0, lab_org: '',
        trashed: false, locked: false, unlocked: false, invite_policy: 'inherit',
        ts: 2, org: 'b', pos: 1, pos_ts: 0, pos_org: '' });
      window.HK_MOCK._saveDB(db);
    }, ids);
    await page.waitForTimeout(600); // fraværsbevis: uten poll kommer den ikke av seg selv
    check('skjult: den fremmede lista er ikke hentet inn (pollet er jo av)',
      await hasCard(page, ids.NEW) === false);

    // 2) Tilbake i forgrunnen: runden skal komme NÅ, ikke ved neste tikk.
    const førSynlig = await pulls(page);
    await setVisible(page, true);
    const kom = await page.waitForFunction((id) => {
      const h = window.__huskis;
      for (const u of h.state.universes) for (const g of (u.groups || [])) for (const c of (g.cards || [])) if (c.id === id) return true;
      return false;
    }, ids.NEW, { timeout: 3000 }).then(() => true).catch(() => false);
    check('forgrunn: en synk-runde starter på gjenopptakelsen (uten pollet)',
      await pulls(page) > førSynlig, { før: førSynlig, etter: await pulls(page) });
    check('forgrunn: det den andre enheten laget er hentet inn', kom === true);
    check('forgrunn: og det står på skjermen',
      (await page.evaluate(() => document.body.innerText)).includes('Laget på en annen enhet'));

    // 3) Uten sesjon skal gjenopptakelsen ikke røre skyen i det hele tatt.
    await page.waitForFunction(() => document.getElementById('sync-status').dataset.state === 'saved', null, { timeout: 8000 });
    await page.evaluate(() => window.__huskis.logout());
    await page.waitForFunction(() => !window.__huskis.authUser, null, { timeout: 5000 });
    await page.evaluate(() => { window.__pulls = 0; });
    await setVisible(page, false);
    await setVisible(page, true);
    await page.waitForTimeout(600); // fraværsbevis
    check('utlogget: en gjenopptakelse gir ingen synk-runde', await pulls(page) === 0, await pulls(page));
  }

  /* 4) Nettet kommer tilbake UTEN at noen hendelse sier fra, og uten at
        `navigator.onLine` noen gang har vært falsk — slik en WebView uten
        ACCESS_NETWORK_STATE oppfører seg. Pollet skal ta det. */
  {
    const { db } = buildDB();
    await load(page, db);
    const onLineHeleVeien = [];
    await page.evaluate(() => {
      // Ingen `offline`-hendelse, ingen flagg: KUN en klient som ikke når fram.
      const client = window.__huskis.client;
      window.__realFrom = client.from.bind(client); window.__realRpc = client.rpc.bind(client);
      const fail = () => Promise.reject(new TypeError('Failed to fetch'));
      client.rpc = fail;
      client.from = () => ({ insert: fail, update: () => ({ eq: fail }), delete: () => ({ eq: fail }), select: () => ({ in: fail }) });
      window.addEventListener('online', () => { window.__onlineEvents = (window.__onlineEvents || 0) + 1; });
      window.__onlineEvents = 0;
    });
    onLineHeleVeien.push(await page.evaluate(() => navigator.onLine));

    await page.evaluate(() => {
      const h = window.__huskis;
      let it = null;
      for (const u of h.state.universes) for (const g of (u.groups || [])) for (const c of (g.cards || [])) for (const x of (c.items || [])) { if (!it) it = x; }
      it.text = 'Skrevet mens nettet var borte'; it.ts = 8e15; it.org = 'zzz'; // vinner felt-LWW
      h.save();
    });
    // To runder som ikke når fram er terskelen for «Frakoblet» (OFFLINE_AFTER_FAILURES).
    await page.evaluate(() => window.__huskis.cloudCycle());
    await page.evaluate(() => window.__huskis.cloudCycle());
    const frakoblet = await page.waitForFunction(
      () => document.getElementById('sync-status').dataset.state === 'offline', null, { timeout: 8000 })
      .then(() => true).catch(() => false);
    check('nett borte: statusen sier «Frakoblet» uten at navigator.onLine er falsk', frakoblet === true);
    onLineHeleVeien.push(await page.evaluate(() => navigator.onLine));

    /* `save()` planla en debouncet runde (300 ms) i tillegg til de to kalte.
       Den MÅ ha fyrt — og feilet — før nettet slås på igjen: ellers kunne
       nettopp den timeren pushet endringen straks klienten ble frisk, og
       scenarioet ville stått grønt selv med et ødelagt poll. `updateSafety()`
       er fasiten på hva som er i kø: 'syncing' = runde i lufta eller planlagt,
       'unsaved' = buffer-skrivingen venter, 'unsynced' = alt er stille, men
       endringen ligger fortsatt bare her. Ventes på TILSTAND, ikke på klokka. */
    await page.waitForFunction(() => window.__huskis.updateSafety().reason === 'unsynced', null, { timeout: 8000 });
    check('nett borte: ingen runde står i kø når nettet slås på igjen — pollet er det eneste igjen',
      await page.evaluate(() => window.__huskis.updateSafety().reason) === 'unsynced',
      await page.evaluate(() => window.__huskis.updateSafety()));

    // Nettet er tilbake — men INGEN sier fra. Ingen `online`, ingen
    // visibilitychange, ingen ny brukerendring. Da er pollet det eneste igjen.
    await page.evaluate(() => {
      const client = window.__huskis.client;
      client.from = window.__realFrom; client.rpc = window.__realRpc;
    });
    const landet = await page.waitForFunction(
      () => (JSON.parse(localStorage.getItem('hk-mock-db')).items || [])[0].text === 'Skrevet mens nettet var borte',
      null, { timeout: 12000 }).then(() => true).catch(() => false);
    check('nett tilbake: endringen lander av seg selv, uten en `online`-hendelse', landet === true);
    check('nett tilbake: statusen går til «Lagret»',
      await page.waitForFunction(() => document.getElementById('sync-status').dataset.state === 'saved', null, { timeout: 8000 })
        .then(() => true).catch(() => false) === true);
    check('hele scenarioet: `navigator.onLine` var sann hele veien (som i WebView-en)',
      onLineHeleVeien.every((v) => v === true), onLineHeleVeien);
    check('hele scenarioet: ingen `online`-hendelse ble fyrt',
      await page.evaluate(() => window.__onlineEvents) === 0);
  }
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  const page = await ctx.newPage();
  // Intervallene må fanges FØR appen kjører: testen slår av synk-pollet for å
  // vise hva som er igjen når timeren ikke kan stoles på.
  await page.addInitScript(() => {
    const real = window.setInterval;
    window.__intervals = [];
    window.setInterval = function (fn, ms) {
      const id = real.apply(window, arguments);
      window.__intervals.push({ id: id, ms: ms });
      return id;
    };
  });
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(e.message));
  await scenario(page);
  check('ingen ukontrollerte JS-feil på siden', pageErrors.length === 0, pageErrors.slice(0, 6));
  await browser.close();
  console.log(`\n==== ${passed}/${passed + failed} PASS ====`);
  process.exit(failed ? 1 : 0);
})();
