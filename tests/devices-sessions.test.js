/*
  Regresjonstest: ENHETER OG ØKTER (docs/accounts.md + docs/varsler.md).

  Kontoen kan være innlogget flere steder, og flere nettlesere kan ha varsler
  på. Det er to ulike ting, og appen skal si dem hver for seg — men med samme
  ord, samme rekkefølge og samme «Denne enheten»-markering.

  Ingen ekte pushtjeneste finnes i en testrunde. Det som fakes er derfor
  NØYAKTIG plattformen (`Notification`, `serviceWorker`), som i
  `notif-channels.test.js`; alt Huskis selv gjør er ekte kode — RPC-ene,
  listene, bekreftelsene og utloggingen.

  Dekker:
     1. Preview-porten: produksjonsdomenet og `huskis.vercel.app` får melde seg
        på web push, en flyktig Vercel-preview-host får det ikke, og et
        build-stempel som sier `preview` stenger den uansett host. `localhost`
        er åpen, så testinfrastrukturen virker som før.
     2. Varselpanelet på en preview: bryteren finnes ikke, og teksten forklarer
        hvorfor — ikke «denne enheten kan ikke», som ville vært usant.
     3. «Innloggede enheter»: begge øktene vises, gjeldende økt er merket og
        står øverst, og bare de andre har en utloggingsknapp.
     4. Fjern-utlogging av ÉN økt: raden forsvinner, øktraden er borte hos
        «Supabase», og denne økten står urørt.
     5. «Logg ut på alle andre enheter» beholder denne økten.
     6. Vanlig «Logg ut» er LOKAL: de andre øktene overlever.
     7. En fjern-utlogget klient oppdager det i neste synk-runde og går til
        innloggingssiden med en beskjed — uten å miste den lokale bufferen.
     8. «Enheter med varsler»: to nettleserkontekster (to origins) står som
        hver sin rad, denne enheten er merket, og «Slå av» tar riktig rad.
     9. «Slå av varsler på alle andre enheter» beholder denne enheten.
    10. Et abonnement som er fjern-avslått kommer IKKE tilbake av seg selv:
        klienten oppdager tilbakekallingen i neste runde og rigger ned kanalen
        sin, og først et eksplisitt «slå på varsler» her aktiverer den igjen.
    11. Listen spør bare når noen ser den: en åpen skuff følger synk-runden, en
        LUKKET modal gjør det ikke (trekkspillet nullstilles først ved neste
        åpning), og et svar som var i lufta da kontoen byttet forkastes i
        stedet for å male forrige brukers enheter.
    12. Et abonnement som ALLEREDE lå på en forhåndsvisning ryddes når siden
        åpnes: meldt av, service workeren avregistrert, bryteren av og
        serverraden borte — og ingen ny påmelding skjer etterpå. Andre enheters
        abonnementer røres ikke.
    13. Feiler SERVERKALLET i den opprydningen, beholdes endepunktet: klienten
        hamrer ikke, men en senere runde rydder raden når serveren er i orden.
    14. Opprydningen virker også i en build UTEN avsendernøkkel — å rydde et
        abonnement krever mindre enn å lage et.
    15. Mock-backenden holder databasens kontrakt: et RULLERT endepunkt fra en
        avslått klient avvises (test-push.sql 12f), og et «slå av» slår av HELE
        klientkonteksten — også en rad fra en rullering (12g).

  Kjør:
    python3 -m http.server 8000                        # fra repo-roten, i egen terminal
    NODE_PATH=$(npm root -g) node tests/devices-sessions.test.js
*/
const { chromium } = require('playwright');

const BASE = process.env.HUSKIS_URL || 'http://localhost:8000';
const results = [];
const log = (n, ok, x = '') => {
  results.push(ok);
  console.log((ok ? 'PASS' : 'FAIL') + ' — ' + n +
    (x !== '' ? '  [' + (typeof x === 'string' ? x : JSON.stringify(x)) + ']' : ''));
};

const U = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
  const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
});

const uid = 'uE';
const SESS_HER = '11110000-0000-4000-8000-000000000001';
const SESS_DER = '22220000-0000-4000-8000-000000000002';
const SUB_HER = '33330000-0000-4000-8000-000000000003';
const SUB_DER = '44440000-0000-4000-8000-000000000004';
const ENDE_HER = 'https://push.test/abc';        // det fakePlattform() gir oss
const ENDE_DER = 'https://push.test/annen';

const id = {};
['UA', 'GA', 'LA', 'IA'].forEach((k) => { id[k] = U(); });

function buildDB(now) {
  const base = (x) => Object.assign({
    trashed: false, locked: false, unlocked: false, invite_policy: 'inherit',
    collapsed: false, is_cat: false, cat_id: null,
    start_at: null, due_at: null, lock_times: false,
    ts: 1, org: 'v', pos: 0, pos_ts: 1, pos_org: 'v',
  }, x);
  return {
    _rolesBackfilled: true,
    profiles: [{ id: uid, email: 'e@x.no', display_name: 'Enhet Testesen', user_metadata: {} }],
    passwords: { 'e@x.no': 'x' },
    universes: [base({ id: id.UA, owner_id: uid, name: 'Enhetsområde' })],
    groups: [base({ id: id.GA, owner_id: uid, universe_id: id.UA, name: 'Mappe' })],
    cards: [base({ id: id.LA, owner_id: uid, group_id: id.GA, title: 'Liste' })],
    items: [base({ id: id.IA, owner_id: uid, card_id: id.LA, text: 'Punkt', done: false })],
    memberships: [{ id: U(), user_id: uid, universe_id: id.UA, group_id: null, role: 'owner', pos: 0, created_at: 1 }],
    share_invites: [], tombstones: [], notifications: [], notification_prefs: [],
    push_deliveries: [],
    /* To nettleserkontekster med varsler: denne, og en på en annen vert.
       Det er nettopp poenget — `localStorage` og et push-abonnement er
       ORIGIN-avgrenset, så samme maskin kan ha to. */
    push_subscriptions: [
      { id: SUB_HER, user_id: uid, endpoint: ENDE_HER,
        p256dh: 'BP' + 'k'.repeat(83) + 'h1', auth: 's'.repeat(22),
        labels: {}, tz: 'Europe/Oslo', browser: 'Chrome', platform: 'Android',
        origin: 'www.huskis.no', device_id: 'd-her',
        created_at: now - 86400000, seen_at: now - 1000, disabled_at: null, revoked_at: null },
      { id: SUB_DER, user_id: uid, endpoint: ENDE_DER,
        p256dh: 'BP' + 'k'.repeat(83) + 'd1', auth: 't'.repeat(22),
        labels: {}, tz: 'Europe/Oslo', browser: 'Chrome', platform: 'Windows',
        origin: 'gammel-preview.example.app', device_id: 'd-der',
        created_at: now - 8 * 86400000, seen_at: now - 3 * 86400000,
        disabled_at: null, revoked_at: null },
    ],
    // «auth.sessions» hos Supabase: to innlogginger, denne og en eldre.
    auth_sessions: [
      { id: SESS_HER, user_id: uid, created_at: now - 3600000, refreshed_at: now - 1000,
        user_agent: 'Mozilla/5.0 (Linux; Android 14) Chrome/131', ip: '203.0.113.9' },
      { id: SESS_DER, user_id: uid, created_at: now - 30 * 86400000,
        refreshed_at: now - 2 * 86400000,
        user_agent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/130', ip: '198.51.100.4' },
    ],
    device_sessions: [
      { session_id: SESS_DER, user_id: uid, browser: 'Chrome', platform: 'Windows',
        origin: 'www.huskis.no', device_id: 'd-laptop',
        created_at: now - 30 * 86400000, seen_at: now - 2 * 86400000 },
    ],
  };
}

/* Plattformen, og bare den — samme grep som notif-channels.test.js.
   Avsendernøkkelen settes fast, så kanalen finnes uansett hva som står i
   produksjons-config.js; `?nokkel=0` fjerner den igjen. */
function fakePlattform() {
  const q = new URLSearchParams(location.search);
  window.__kanal = { perm: q.get('perm') || 'granted', spurt: 0 };

  /* `?feilrpc=<navn>` lar SERVEREN svare med feil på nettopp den RPC-en —
     `{ data: null, error }`, slik PostgREST melder en avvist forespørsel.
     Testen skrur den av igjen ved å nullstille `__kanal.feilrpc`. */
  window.__kanal.feilrpc = q.get('feilrpc') || null;
  /* Klienten venter et minutt før den prøver et feilet serverkall på nytt.
     Testen kan ikke vente så lenge, og skal heller ikke måtte det: her flyttes
     KLOKKA i stedet, så pausen måles på ekte kode. */
  window.__kanal.hopp = 0;
  const ekteNå = Date.now.bind(Date);
  Date.now = () => ekteNå() + (window.__kanal.hopp || 0);

  /* RPC-laget instrumenteres: `__kanal.kall` teller kall per navn, og
     `__kanal.hold` holder ETT svar tilbake til testen slipper det.
     Innpakningen må sitte på `createClient` FØR mock-backenden tas i bruk. */
  window.__kanal.kall = {};
  window.__kanal.hold = null;
  Object.defineProperty(window, 'HK_MOCK', {
    configurable: true,
    set(v) {
      const lagKlient = v.createClient;
      v.createClient = function () {
        const c = lagKlient.apply(this, arguments);
        const ekte = c.rpc.bind(c);
        c.rpc = function (navn, params) {
          window.__kanal.kall[navn] = (window.__kanal.kall[navn] || 0) + 1;
          if (window.__kanal.feilrpc === navn) {
            return Promise.resolve({ data: null,
              error: { message: 'nettverket falt ut', code: 'PGRST000' } });
          }
          const svar = ekte(navn, params);
          if (window.__kanal.hold === navn) {
            window.__kanal.hold = null;
            return new Promise((slipp) => {
              window.__kanal.slippSvar = () => svar.then(slipp);
            });
          }
          return svar;
        };
        return c;
      };
      Object.defineProperty(window, 'HK_MOCK', { value: v, writable: true, configurable: true });
    },
    get() { return undefined; },
  });

  class FakeNotification {
    static get permission() { return window.__kanal.perm; }
    static async requestPermission() {
      window.__kanal.spurt++;
      window.__kanal.perm = 'granted';
      return 'granted';
    }
  }
  Object.defineProperty(window, 'Notification', { value: FakeNotification, configurable: true, writable: true });

  const nøkkel = (n) => new Uint8Array(n === 'auth' ? 16 : 65).fill(n === 'auth' ? 7 : 4).buffer;
  const lagAbo = () => ({
    endpoint: 'https://push.test/abc', getKey: nøkkel,
    unsubscribe: async () => { window.__kanal.avmeldt = true; abo = null; return true; },
  });
  /* `?forhaand=1` etterligner en nettleser som ALLEREDE har et Huskis-
     abonnement og en registrert service worker fra før — situasjonen på en
     forhåndsvisning som ble åpnet før porten fantes. */
  const fraFør = q.get('forhaand') === '1';
  let abo = null;
  const reg = {
    pushManager: {
      getSubscription: async () => abo,
      subscribe: async () => { abo = lagAbo(); return abo; },
    },
    unregister: async () => { window.__kanal.avregistrert = true; registrert = null; return true; },
  };
  let registrert = null;
  if (fraFør) { abo = lagAbo(); registrert = reg; }
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: {
      register: async () => { registrert = reg; return reg; },
      getRegistration: async () => registrert,
      get ready() { return Promise.resolve(registrert || reg); },
      addEventListener() {},
    },
  });

  /* `?nokkel=0` etterligner en build UTEN avsendernøkkel. Da kan siden ikke
     OPPRETTE et abonnement — men den skal fortsatt kunne rydde et gammelt. */
  Object.defineProperty(window, 'HUSKIS_CONFIG', {
    configurable: true,
    set(v) {
      v.pushPublicKey = q.get('nokkel') === '0' ? ''
        : 'BKf-0z47jqWLUVd_3r4-JbyhdGwgWERsrt1l0Cfur7vPXM7644P_EyKSDC1aGhvm7kr5plt9zOpvdaz_WTuJoII';
      Object.defineProperty(window, 'HUSKIS_CONFIG', { value: v, writable: true, configurable: true });
    },
    get() { return undefined; },
  });
}

/* Stempler siden som en Vercel preview-deploy — nøyaktig slik `build.js` gjør
   det. HTML-en skrives om i transporten, ikke i DOM-et etterpå: appen leser
   stempelet mens den laster, og et skript som kappløper med parseren ville
   gjort testen tilfeldig. */
async function stemplePreview(ctx) {
  await ctx.route((u) => u.origin === new URL(BASE).origin &&
    (u.pathname === '/' || u.pathname === '/index.html'), async (route) => {
    const svar = await route.fetch();
    const html = (await svar.text()).replace(
      '<meta name="huskis-deploy" content="dev" />',
      '<meta name="huskis-deploy" content="preview" />');
    await route.fulfill({ response: svar, body: html });
  });
}

async function seed(p, url, db, lokalt) {
  await p.goto(url);
  await p.evaluate(({ db, uid, sid, lokalt }) => {
    localStorage.clear(); sessionStorage.clear();
    localStorage.setItem('hk-mock-db', JSON.stringify(db));
    Object.keys(lokalt || {}).forEach((k) => localStorage.setItem(k, lokalt[k]));
    sessionStorage.setItem('hk-mock-session', JSON.stringify({
      id: uid, email: 'e@x.no', session_id: sid,
      user_metadata: { onboarding: { v: 3, status: 'done' },
        tips: { drag: true, trash: true, moveList: true, dragTrash: true } },
    }));
  }, { db, uid, sid: SESS_HER, lokalt: lokalt || {} });
  await p.goto(url);
  await p.waitForFunction(() => window.__huskis && window.__huskis.authUser && window.__huskis.lastMy,
    null, { timeout: 20000, polling: 200 });
}

const dbOf = (p) => p.evaluate(() => window.HK_MOCK._loadDB());

async function åpneEnheter(p) {
  await p.evaluate(() => window.__huskis.openAccount());
  await p.click('#acc-devices-head');
  // Listen hentes fra serveren når skuffen åpnes.
  await p.waitForFunction(() => {
    const el = document.getElementById('session-list');
    return el && el.querySelectorAll('.device-row').length > 0;
  }, null, { timeout: 10000, polling: 100 });
}

const rader = (p, sel) => p.$$eval(sel + ' .device-row', (els) => els.map((el) => ({
  id: el.dataset.id,
  navn: (el.querySelector('.device-name') || {}).textContent || '',
  her: !!el.querySelector('.device-here'),
  origin: (el.querySelector('.device-origin') || {}).textContent || '',
  sett: (el.querySelector('.device-seen') || {}).textContent || '',
  knapp: (el.querySelector('.device-action') || {}).textContent || null,
})));

// Bekreftelsesdialogen (askConfirm) — den lette sorten, ikke sveipefeltet.
async function bekreft(p) {
  await p.waitForSelector('#confirm-modal:not([hidden]) #confirm-ok', { timeout: 5000 });
  await p.click('#confirm-modal #confirm-ok');
}

(async () => {
  const browser = await chromium.launch();

  /* ---------- Del 1: preview-porten (ren logikk, i den ekte appen) ---------- */
  {
    const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
    const p = await ctx.newPage();
    const feil = [];
    p.on('pageerror', (e) => feil.push(String(e)));
    await p.goto(BASE + '/index.html?mock=1');
    await p.waitForFunction(() => window.__huskis && window.__huskis.pushDeployAllowed,
      null, { timeout: 20000, polling: 200 });

    const svar = await p.evaluate(() => {
      const f = window.__huskis.pushDeployAllowed;
      return {
        kanonisk: f('huskis.no', 'production'),
        www: f('www.huskis.no', 'production'),
        vercelAlias: f('huskis.vercel.app', 'production'),
        preview: f('huskis-abc123-peohols-projects.vercel.app', 'production'),
        annenPreview: f('huskis-git-min-gren-peohols-projects.vercel.app', 'production'),
        fremmed: f('ondsinnet.example.com', 'production'),
        lokal: f('localhost', 'dev'),
        loopback: f('127.0.0.1', 'dev'),
        stempletPreview: f('huskis.no', 'preview'),
        stempletDev: f('huskis.no', 'dev'),
        hosts: (window.__huskisCanonical || {}).redirectHosts,
      };
    });
    log('1a produksjonsdomenet får melde seg på web push', svar.kanonisk === true);
    log('1b www.huskis.no er et Huskis-domene og er tillatt', svar.www === true);
    log('1c huskis.vercel.app er et legitimt Huskis-domene og er tillatt',
      svar.vercelAlias === true);
    log('1d en flyktig Vercel-preview-host er IKKE tillatt',
      svar.preview === false && svar.annenPreview === false,
      { preview: svar.preview, gren: svar.annenPreview });
    log('1e en ukjent vert er heller ikke tillatt (regelen feiler LUKKET)',
      svar.fremmed === false);
    log('1f localhost er åpen, så testinfrastrukturen virker som før',
      svar.lokal === true && svar.loopback === true);
    log('1g build-stempelet «preview» stenger porten UANSETT host',
      svar.stempletPreview === false, { host: 'huskis.no', kind: 'preview' });
    log('1h … mens ubygget kildekode («dev») kjører som vanlig',
      svar.stempletDev === true);
    log('1i domenelisten leses fra guarden i index.html, ikke skrevet opp på nytt',
      Array.isArray(svar.hosts) && svar.hosts.indexOf('huskis.vercel.app') > -1, svar.hosts);
    log('1: ingen JS-feil i konsollen', feil.length === 0, feil.join(' | '));
    await ctx.close();
  }

  /* ---------- Del 2: varselpanelet på en preview ---------- */
  {
    const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
    const p = await ctx.newPage();
    const feil = [];
    p.on('pageerror', (e) => feil.push(String(e)));
    await p.addInitScript(fakePlattform);
    // Stemple siden som en preview-deploy FØR app.js leser stempelet.
    await stemplePreview(ctx);
    await seed(p, BASE + '/index.html?mock=1', buildDB(Date.now()));

    const st = await p.evaluate(async () => {
      await window.__huskis.refreshNotifChannelState();
      return {
        stempel: window.__huskis.deployKind(),
        tilstand: window.__huskis.notifChState,
        blokkert: window.__huskis.pushPreviewBlocked(),
        kanal: !!window.__huskis.notifChannel(),
      };
    });
    log('2a siden er stemplet som en preview-deploy', st.stempel === 'preview', st.stempel);
    log('2b kanalen finnes ikke der — ingen abonnementer kan legges igjen',
      st.kanal === false && st.blokkert === true, st);
    log('2c … og panelet melder det som «preview», ikke «støttes ikke»',
      st.tilstand === 'preview', st.tilstand);

    await p.evaluate(() => window.__huskis.openNotifModal());
    await p.click('#notif-settings-btn').catch(() => {});
    const panel = await p.evaluate(() => {
      const note = document.getElementById('notif-channel-note');
      return { tekst: note ? note.textContent : null,
        bryter: !!document.getElementById('notif-channel-toggle') };
    });
    log('2d teksten forklarer hvorfor, og det finnes ingen bryter å trykke på',
      panel.bryter === false && /forhåndsvisning/i.test(panel.tekst || ''), panel);
    log('2: ingen JS-feil i konsollen', feil.length === 0, feil.join(' | '));
    await ctx.close();
  }

  /* ---------- Del 3–10: listene, i en vanlig (ikke-preview) kjøring ---------- */
  async function kjør(navn, viewport, mobil) {
    const ctx = await browser.newContext(Object.assign({ viewport },
      mobil ? { isMobile: true, hasTouch: true } : {}));
    const p = await ctx.newPage();
    const feil = [];
    p.on('pageerror', (e) => feil.push(String(e)));
    await p.addInitScript(fakePlattform);
    const nå = Date.now();
    await seed(p, BASE + '/index.html?mock=1', buildDB(nå));

    /* ---- 3. Innloggede enheter ---- */
    await åpneEnheter(p);
    let økter = await rader(p, '#session-list');
    log(navn + ' 3a begge øktene vises', økter.length === 2, økter.map((r) => r.navn));
    log(navn + ' 3b gjeldende økt er merket «Denne enheten» og står ØVERST',
      økter[0].her === true && økter[0].id === SESS_HER &&
      /Denne enheten/i.test(økter[0].navn + økter[0].navn) === false, økter[0]);
    log(navn + ' 3c … og bare den andre har en utloggingsknapp',
      økter[0].knapp === null && !!økter[1].knapp, økter.map((r) => r.knapp));
    log(navn + ' 3d den andre raden er lesbar: nettleser, plattform og vert',
      økter[1].navn === 'Chrome · Windows' && økter[1].origin === 'www.huskis.no', økter[1]);
    log(navn + ' 3e «sist aktiv» står på raden', /Sist aktiv/i.test(økter[1].sett) &&
      /Aktiv nå/i.test(økter[0].sett), { her: økter[0].sett, der: økter[1].sett });

    /* ---- 4. Fjern-utlogging av ÉN økt ---- */
    await p.click('#session-list .device-row:not(.is-current) .device-action');
    await bekreft(p);
    await p.waitForFunction(() => document.querySelectorAll('#session-list .device-row').length === 1,
      null, { timeout: 10000, polling: 100 });
    let db = await dbOf(p);
    log(navn + ' 4a den fjern-utloggede økten er borte hos «Supabase»',
      db.auth_sessions.length === 1 && db.auth_sessions[0].id === SESS_HER,
      db.auth_sessions.map((x) => x.id));
    log(navn + ' 4b … og den gjenkjennelige metadataen ryddet med',
      !db.device_sessions.some((d) => d.session_id === SESS_DER));
    log(navn + ' 4c denne økten står urørt',
      await p.evaluate(() => !!window.__huskis.authUser));

    /* ---- 5. «Logg ut på alle andre enheter» ---- */
    await p.evaluate(({ s2, u }) => {
      const db = window.HK_MOCK._loadDB();
      db.auth_sessions.push({ id: s2, user_id: u, created_at: Date.now() - 1000,
        refreshed_at: Date.now() - 1000, user_agent: 'x', ip: 'y' });
      window.HK_MOCK._saveDB(db);
    }, { s2: SESS_DER, u: uid });
    await p.evaluate(() => window.__huskis.loadDevices());
    await p.waitForFunction(() => document.querySelectorAll('#session-list .device-row').length === 2,
      null, { timeout: 10000, polling: 100 });
    await p.click('#logout-others-btn');
    await bekreft(p);
    await p.waitForFunction(() => document.querySelectorAll('#session-list .device-row').length === 1,
      null, { timeout: 10000, polling: 100 });
    db = await dbOf(p);
    log(navn + ' 5a «alle andre» avsluttet de andre øktene',
      db.auth_sessions.length === 1 && db.auth_sessions[0].id === SESS_HER,
      db.auth_sessions.map((x) => x.id));
    log(navn + ' 5b … og lot DENNE stå innlogget',
      await p.evaluate(() => !!window.__huskis.authUser));

    /* ---- 8. Enheter med varsler ---- */
    // Slå på kanalen her, så klienten har sitt eget endepunkt å kjenne igjen.
    await p.evaluate(async () => { await window.__huskis.setNotifChannel(true); });

    /* Veien brukeren faktisk går: varselpanelet teller enhetene, og «Vis
       enheter» åpner listen. Ett sted for begge listene — ikke to halve. */
    await p.evaluate(() => window.__huskis.closeAccount());
    await p.evaluate(() => window.__huskis.openNotifModal());
    await p.click('#notif-settings-btn');
    await p.waitForSelector('#notif-devices-btn', { timeout: 10000 });
    log(navn + ' 8x varselpanelet teller enhetene og tilbyr «Vis enheter»',
      /annen enhet|andre enheter/i.test(await p.textContent('#notif-channel-note')),
      await p.textContent('#notif-channel-note'));
    await p.click('#notif-devices-btn');
    await p.waitForFunction(() => {
      const m = document.getElementById('account-modal');
      const h = document.getElementById('acc-devices-head');
      return m && !m.hidden && h && h.getAttribute('aria-expanded') === 'true' &&
        document.getElementById('notif-modal').hidden;
    }, null, { timeout: 10000, polling: 100 });
    log(navn + ' 8y … som lukker varselmodalen og åpner enhets-skuffen', true);

    await p.evaluate(() => window.__huskis.loadDevices());
    await p.waitForFunction(() => {
      const els = document.querySelectorAll('#push-device-list .device-row');
      return els.length === 2 && els[0].classList.contains('is-current');
    }, null, { timeout: 10000, polling: 100 });
    let push = await rader(p, '#push-device-list');
    log(navn + ' 8a to nettleserkontekster står som hver sin rad',
      push.length === 2, push.map((r) => r.navn + ' @ ' + r.origin));
    log(navn + ' 8b denne enheten er merket og står øverst',
      push[0].her === true && push[0].id === SUB_HER, push[0]);
    log(navn + ' 8c den andre viser verten sin — det er den som skiller dem',
      push[1].origin === 'gammel-preview.example.app', push[1].origin);
    log(navn + ' 8d … og bare den andre kan slås av herfra',
      push[0].knapp === null && !!push[1].knapp, push.map((r) => r.knapp));
    log(navn + ' 8e ingen endepunkter er med i det UI-et fikk',
      !JSON.stringify(await p.evaluate(() => window.__huskis.devices)).includes('push.test'));

    await p.click('#push-device-list .device-row:not(.is-current) .device-action');
    await p.waitForFunction(() => document.querySelectorAll('#push-device-list .device-row').length === 1,
      null, { timeout: 10000, polling: 100 });
    db = await dbOf(p);
    const der = db.push_subscriptions.find((x) => x.id === SUB_DER);
    const her = db.push_subscriptions.find((x) => x.id === SUB_HER);
    log(navn + ' 8f «Slå av» tok riktig abonnement — og MERKET det som tilbakekalt',
      !!der.revoked_at && !der.disabled_at, { revoked: !!der.revoked_at, disabled: !!der.disabled_at });
    log(navn + ' 8g … mens denne enhetens abonnement står urørt',
      !her.revoked_at && !her.disabled_at);

    /* ---- 9. «Slå av varsler på alle andre enheter» ---- */
    await p.evaluate(({ s, u, e }) => {
      const db = window.HK_MOCK._loadDB();
      db.push_subscriptions.push({ id: s, user_id: u, endpoint: e,
        p256dh: 'BP' + 'k'.repeat(83) + 'x1', auth: 'u'.repeat(22), labels: {}, tz: null,
        browser: 'Safari', platform: 'macOS', origin: 'www.huskis.no', device_id: 'd-mac',
        created_at: Date.now() - 1000, seen_at: Date.now() - 1000,
        disabled_at: null, revoked_at: null });
      window.HK_MOCK._saveDB(db);
    }, { s: '55550000-0000-4000-8000-000000000005', u: uid, e: 'https://push.test/tredje' });
    await p.evaluate(() => window.__huskis.loadDevices());
    await p.waitForFunction(() => document.querySelectorAll('#push-device-list .device-row').length === 2,
      null, { timeout: 10000, polling: 100 });
    await p.click('#push-off-others-btn');
    await bekreft(p);
    await p.waitForFunction(() => document.querySelectorAll('#push-device-list .device-row').length === 1,
      null, { timeout: 10000, polling: 100 });
    db = await dbOf(p);
    log(navn + ' 9a «slå av alle andre» beholdt DENNE enhetens abonnement',
      !db.push_subscriptions.find((x) => x.id === SUB_HER).revoked_at);
    log(navn + ' 9b … og slo av de andre',
      db.push_subscriptions.filter((x) => !x.revoked_at).length === 1,
      db.push_subscriptions.map((x) => x.origin + ':' + (x.revoked_at ? 'av' : 'på')));

    /* ---- 10. En fjern-avslått klient kommer ikke tilbake av seg selv ---- */
    // «En annen enhet» slår av NETTOPP dette abonnementet.
    await p.evaluate((sub) => {
      const db = window.HK_MOCK._loadDB();
      db.push_subscriptions.find((x) => x.id === sub).revoked_at = Date.now();
      window.HK_MOCK._saveDB(db);
    }, SUB_HER);
    // Neste synk-runde: telleren falt, så fornyelsen går — og serveren svarer
    // at abonnementet er tilbakekalt.
    await p.evaluate(() => window.__huskis.cloudCycle());
    await p.waitForFunction(() => window.__huskis.pushRevokedHere === true,
      null, { timeout: 10000, polling: 100 });
    db = await dbOf(p);
    log(navn + ' 10a klienten oppdaget at serveren har tilbakekalt abonnementet',
      await p.evaluate(() => window.__huskis.pushRevokedHere === true));
    log(navn + ' 10b … og slo av kanalen sin i stedet for å melde seg på igjen',
      await p.evaluate(() => localStorage.getItem('hk-notif-channel') !== 'on'),
      await p.evaluate(() => localStorage.getItem('hk-notif-channel')));
    log(navn + ' 10c abonnementet er FORTSATT tilbakekalt på serveren',
      !!db.push_subscriptions.find((x) => x.id === SUB_HER).revoked_at);

    // … og et EKSPLISITT «slå på varsler» her tar det tilbake.
    await p.evaluate(async () => { await window.__huskis.setNotifChannel(true); });
    db = await dbOf(p);
    log(navn + ' 10d et eksplisitt «slå på varsler» her aktiverer det igjen',
      !db.push_subscriptions.find((x) => x.endpoint === 'https://push.test/abc').revoked_at);

    /* ---- 6. Vanlig «Logg ut» er LOKAL ---- */
    await p.evaluate(({ s2, u }) => {
      const db = window.HK_MOCK._loadDB();
      db.auth_sessions.push({ id: s2, user_id: u, created_at: Date.now() - 1000,
        refreshed_at: Date.now() - 1000, user_agent: 'x', ip: 'y' });
      window.HK_MOCK._saveDB(db);
    }, { s2: SESS_DER, u: uid });
    await p.evaluate(() => window.__huskis.openAccount());
    await p.click('#acc-session-head');
    await p.click('#logout-btn');
    await bekreft(p);
    await p.waitForFunction(() => !window.__huskis.authUser, null, { timeout: 10000, polling: 100 });
    db = await dbOf(p);
    log(navn + ' 6a vanlig «Logg ut» avsluttet BARE denne økten',
      db.auth_sessions.length === 1 && db.auth_sessions[0].id === SESS_DER,
      db.auth_sessions.map((x) => x.id));
    log(navn + ' 6b … og den lokale bufferen står igjen (ingen datatap ved utlogging)',
      await p.evaluate((u) => !!localStorage.getItem('mine-lister-v1:' + u), uid));

    log(navn + ': ingen JS-feil i konsollen', feil.length === 0, feil.join(' | '));
    await ctx.close();
  }

  await kjør('desktop', { width: 1200, height: 900 }, false);
  await kjør('mobil', { width: 390, height: 780 }, true);

  /* ---------- Del 11: listen spør ikke når ingen ser den ---------- */
  {
    const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
    const p = await ctx.newPage();
    const feil = [];
    p.on('pageerror', (e) => feil.push(String(e)));
    await p.addInitScript(fakePlattform);
    await seed(p, BASE + '/index.html?mock=1', buildDB(Date.now()));

    await åpneEnheter(p);
    const åpen = await p.evaluate(() => window.__kanal.kall.list_my_devices || 0);
    await p.evaluate(async () => {
      await window.__huskis.cloudCycle();
    });
    const mensÅpen = await p.evaluate(() => window.__kanal.kall.list_my_devices || 0);
    log('11a en ÅPEN liste følger synk-runden', mensÅpen > åpen, { før: åpen, etter: mensÅpen });

    /* Modalen lukkes med krysset. Trekkspillet nullstilles først neste gang
       modalen ÅPNES, så uten en synlighetssjekk ville hver synk-runde resten
       av økten hentet en liste ingen ser. */
    await p.evaluate(() => window.__huskis.closeAccount());
    const førLukket = await p.evaluate(() => window.__kanal.kall.list_my_devices || 0);
    await p.evaluate(async () => {
      await window.__huskis.cloudCycle();
      await window.__huskis.cloudCycle();
    });
    const etterLukket = await p.evaluate(() => window.__kanal.kall.list_my_devices || 0);
    log('11b … men en LUKKET modal spør ikke, runde etter runde',
      etterLukket === førLukket, { før: førLukket, etter: etterLukket });

    /* Et svar som var i lufta da kontoen byttet, bærer den FORRIGE brukerens
       økter og enheter. Det skal forkastes, ikke males. */
    await p.evaluate(() => { window.__kanal.hold = 'list_my_devices'; });
    await p.evaluate(() => window.__huskis.openAccount('devices'));
    await p.waitForFunction(() => typeof window.__kanal.slippSvar === 'function',
      null, { timeout: 10000, polling: 50 });
    await p.evaluate(() => { window.__huskis.logout(); });
    await p.waitForFunction(() => !window.__huskis.authUser,
      null, { timeout: 10000, polling: 100 });
    await p.evaluate(async () => { await window.__kanal.slippSvar(); });
    log('11c et svar fra forrige konto forkastes i stedet for å fylle listene',
      await p.evaluate(() => window.__huskis.devices === null),
      JSON.stringify(await p.evaluate(() => window.__huskis.devices)));
    log('11: ingen JS-feil i konsollen', feil.length === 0, feil.join(' | '));
    await ctx.close();
  }

  /* ---------- Del 12: et gammelt abonnement på en preview ryddes ---------- */
  {
    const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
    const p = await ctx.newPage();
    const feil = [];
    p.on('pageerror', (e) => feil.push(String(e)));
    await p.addInitScript(fakePlattform);
    await stemplePreview(ctx);

    /* Nettleseren har ALLEREDE et Huskis-abonnement og en registrert service
       worker her — forhåndsvisningen ble åpnet før porten fantes — og
       serveren har raden. Porten alene ville bare sagt «slått av i
       forhåndsvisninger» mens abonnementet levde videre. */
    const nå = Date.now();
    await seed(p, BASE + '/index.html?mock=1&forhaand=1', buildDB(nå),
      { 'hk-notif-channel': 'on' });

    await p.waitForFunction(() => {
      const k = window.__kanal || {};
      return k.avmeldt === true && k.avregistrert === true;
    }, null, { timeout: 15000, polling: 100 });
    log('12a det gamle abonnementet er meldt av, og service workeren avregistrert',
      await p.evaluate(() => !!(window.__kanal.avmeldt && window.__kanal.avregistrert)));

    log('12b … bryteren for denne deployen står av',
      await p.evaluate(() => localStorage.getItem('hk-notif-channel') !== 'on'),
      await p.evaluate(() => localStorage.getItem('hk-notif-channel')));

    // Serverraden ryddes så snart det finnes en økt (cloudStart).
    await p.waitForFunction((e) => {
      const db = window.HK_MOCK._loadDB();
      return !db.push_subscriptions.some((x) => x.endpoint === e);
    }, ENDE_HER, { timeout: 15000, polling: 150 });
    const db12 = await dbOf(p);
    log('12c … og serverraden er borte, så den ikke teller som en enhet i produksjon',
      !db12.push_subscriptions.some((x) => x.endpoint === ENDE_HER),
      db12.push_subscriptions.map((x) => x.origin));
    log('12d … mens de andre enhetenes abonnementer står urørt',
      db12.push_subscriptions.some((x) => x.endpoint === ENDE_DER && !x.revoked_at && !x.disabled_at));

    /* Og den melder seg IKKE på igjen: porten stenger både bryteren og
       fornyelsen, runde etter runde. */
    const førSub = await p.evaluate(() => window.__kanal.kall.push_subscribe || 0);
    await p.evaluate(async () => {
      await window.__huskis.cloudCycle();
      await window.__huskis.syncNotifChannel();
      await window.__huskis.sweepBlockedPush();
    });
    log('12e … og ingen ny påmelding skjer, verken av synk-runden eller speilingen',
      (await p.evaluate(() => window.__kanal.kall.push_subscribe || 0)) === førSub &&
      (await p.evaluate(async () => {
        const reg = await navigator.serviceWorker.getRegistration();
        return !reg;
      })), { før: førSub, etter: await p.evaluate(() => window.__kanal.kall.push_subscribe || 0) });

    const st12 = await p.evaluate(() => ({
      tilstand: window.__huskis.notifChState, kanal: !!window.__huskis.notifChannel() }));
    log('12f panelet melder fortsatt «preview», ikke «på»',
      st12.tilstand === 'preview' && st12.kanal === false, st12);
    log('12: ingen JS-feil i konsollen', feil.length === 0, feil.join(' | '));
    await ctx.close();
  }

  /* ---------- Del 13: serveren svarer FEIL på opprydningen ---------- */
  /* PostgREST melder en avvist RPC i `error`, ikke som et unntak. Leser
     klienten bare `catch`, ser en helt vanlig serverfeil ut som en suksess:
     endepunktet slippes, serverraden blir stående som en aktiv enhet i
     produksjonskontoens liste, og ingen prøver igjen — for etter
     `unregister()` finnes endepunktet ikke å hente. */
  {
    const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
    const p = await ctx.newPage();
    const feil = [];
    p.on('pageerror', (e) => feil.push(String(e)));
    await p.addInitScript(fakePlattform);
    await stemplePreview(ctx);

    await seed(p, BASE + '/index.html?mock=1&forhaand=1&feilrpc=push_unsubscribe',
      buildDB(Date.now()), { 'hk-notif-channel': 'on' });

    // Den LOKALE nedriggingen står for seg og skjer uansett hva serveren svarer.
    await p.waitForFunction(() => {
      const k = window.__kanal || {};
      return k.avmeldt === true && k.avregistrert === true;
    }, null, { timeout: 15000, polling: 100 });
    await p.waitForFunction(() => (window.__kanal.kall.push_unsubscribe || 0) >= 1,
      null, { timeout: 15000, polling: 100 });
    log('13a nettleseren er ryddet selv om serverkallet feilet',
      await p.evaluate(() => !!(window.__kanal.avmeldt && window.__kanal.avregistrert)));

    const db13 = await dbOf(p);
    log('13b … og serverraden står der fortsatt, siden serveren sa nei',
      db13.push_subscriptions.some((x) => x.endpoint === ENDE_HER));

    /* Ingen hamring: synk-runden går hvert femte sekund, og et nytt forsøk
       skal vente på pausen — ikke banke på en server som nettopp sa nei. */
    const førAv = await p.evaluate(() => window.__kanal.kall.push_unsubscribe || 0);
    await p.evaluate(async () => {
      for (let i = 0; i < 3; i++) {
        await window.__huskis.cloudCycle();
        await window.__huskis.sweepBlockedPush();
      }
    });
    const etterAv = await p.evaluate(() => window.__kanal.kall.push_unsubscribe || 0);
    log('13c … og klienten hamrer ikke: ingen nye forsøk før pausen er ute',
      etterAv === førAv, { før: førAv, etter: etterAv });

    /* Endepunktet ble tatt vare på. Går serveren i orden — og pausen ut —
       rydder en helt vanlig synk-runde raden. */
    await p.evaluate(() => { window.__kanal.feilrpc = null; window.__kanal.hopp = 61000; });
    await p.evaluate(() => window.__huskis.cloudCycle());
    let ryddet = true;
    try {
      await p.waitForFunction((e) => !window.HK_MOCK._loadDB().push_subscriptions
        .some((x) => x.endpoint === e), ENDE_HER, { timeout: 15000, polling: 150 });
    } catch (e) { ryddet = false; }
    const db13b = await dbOf(p);
    log('13d … men endepunktet er tatt vare på, så en senere runde rydder raden',
      ryddet && !db13b.push_subscriptions.some((x) => x.endpoint === ENDE_HER),
      db13b.push_subscriptions.map((x) => x.origin));
    log('13e … mens de andre enhetenes abonnementer står urørt',
      db13b.push_subscriptions.some((x) => x.endpoint === ENDE_DER &&
        !x.revoked_at && !x.disabled_at));
    log('13f … og ingen ny påmelding skjedde underveis',
      (await p.evaluate(() => window.__kanal.kall.push_subscribe || 0)) === 0);
    log('13: ingen JS-feil i konsollen', feil.length === 0, feil.join(' | '));
    await ctx.close();
  }

  /* ---------- Del 14: opprydning UTEN avsendernøkkel ---------- */
  /* Å opprette et abonnement krever en VAPID-nøkkel og Notification-API-et; å
     rydde et krever bare service worker-registeret. Blandes de to, gjør en
     build uten nøkkel det umulig å bli kvitt abonnementet en tidligere build
     la igjen — nettopp den situasjonen der opprydningen trengs. */
  {
    const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
    const p = await ctx.newPage();
    const feil = [];
    p.on('pageerror', (e) => feil.push(String(e)));
    await p.addInitScript(fakePlattform);
    await stemplePreview(ctx);

    await seed(p, BASE + '/index.html?mock=1&forhaand=1&nokkel=0',
      buildDB(Date.now()), { 'hk-notif-channel': 'on' });

    log('14a denne builden har ingen avsendernøkkel, så den kan ikke lage push',
      await p.evaluate(() => !((window.HUSKIS_CONFIG || {}).pushPublicKey) &&
        window.__huskis.pushPreviewBlocked() === false &&
        window.__huskis.notifChannel() === null));

    /* Ventingene fanges: uten skillet mellom «kan lage» og «kan rydde» skjer
       ingenting her i det hele tatt, og testen skal da si FAIL — ikke stoppe
       resten av fila med en tidsavbrudds-feil. */
    try {
      await p.waitForFunction(() => {
        const k = window.__kanal || {};
        return k.avmeldt === true && k.avregistrert === true;
      }, null, { timeout: 15000, polling: 100 });
    } catch (e) { /* logges under */ }
    log('14b … men det gamle abonnementet ryddes likevel, og service workeren med',
      await p.evaluate(() => !!(window.__kanal.avmeldt && window.__kanal.avregistrert)));

    try {
      await p.waitForFunction((e) => !window.HK_MOCK._loadDB().push_subscriptions
        .some((x) => x.endpoint === e), ENDE_HER, { timeout: 15000, polling: 150 });
    } catch (e) { /* logges under */ }
    const db14 = await dbOf(p);
    log('14c … og serverraden er borte',
      !db14.push_subscriptions.some((x) => x.endpoint === ENDE_HER),
      db14.push_subscriptions.map((x) => x.origin));
    log('14d … mens de andre enhetenes abonnementer står urørt',
      db14.push_subscriptions.some((x) => x.endpoint === ENDE_DER &&
        !x.revoked_at && !x.disabled_at));
    log('14: ingen JS-feil i konsollen', feil.length === 0, feil.join(' | '));
    await ctx.close();
  }

  /* ---------- Del 15: mock-backenden holder den samme kontrakten ---------- */
  /* Nettlesertestene kjører mot mock-backenden, ikke mot Postgres. Da må den
     ha DEN SAMME regelen for et rullert endepunkt som `push_subscribe()` i
     `supabase/users-and-sharing.sql` (seksjon 12f i test-push.sql) — ellers
     ville alt her vært grønt mot en server som ikke finnes. */
  {
    const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
    const p = await ctx.newPage();
    const feil = [];
    p.on('pageerror', (e) => feil.push(String(e)));
    await p.addInitScript(fakePlattform);
    await seed(p, BASE + '/index.html?mock=1', buildDB(Date.now()));

    const kontrakt = await p.evaluate(async () => {
      const c = window.HK_MOCK.createClient();
      const K = 'BP' + 'k'.repeat(83) + 'r1';
      const A = 's'.repeat(22);
      const kall = (ende, mer) => c.rpc('push_subscribe', Object.assign({
        p_endpoint: ende, p_p256dh: K, p_auth: A, p_labels: {}, p_tz: 'Europe/Oslo',
        p_browser: 'Chrome', p_platform: 'Android', p_origin: 'www.huskis.no',
        p_device_id: 'd-roterer' }, mer || {}));
      const først = await kall('https://push.test/e1');
      await c.rpc('push_revoke', { p_id: først.data.id });
      // Nettleseren har rullert endepunktet mens klienten lå ubrukt.
      const rotert = await kall('https://push.test/e2');
      // En annen enhets-id er en annen klient, og er upåvirket.
      const annen = await kall('https://push.test/e3', { p_device_id: 'd-en-annen' });
      // Brukeren står ved nettopp denne klienten og slår varslene på.
      const påSlått = await kall('https://push.test/e2', { p_explicit: true });
      const etterpå = await kall('https://push.test/e2');
      const db = window.HK_MOCK._loadDB();
      return {
        rotert: rotert.data, annen: annen.data,
        påSlått: påSlått.data, etterpå: etterpå.data,
        e1Igjen: db.push_subscriptions.some((x) => x.endpoint === 'https://push.test/e1'),
        e2Aktiv: db.push_subscriptions.some((x) => x.endpoint === 'https://push.test/e2' &&
          !x.revoked_at && !x.disabled_at),
      };
    });
    log('15a et rullert endepunkt fra en avslått klient blir også avvist',
      kontrakt.rotert && kontrakt.rotert.revoked === true, kontrakt.rotert);
    log('15b … mens en annen klientkontekst er upåvirket',
      kontrakt.annen && kontrakt.annen.revoked === false, kontrakt.annen);
    log('15c et eksplisitt «slå på» aktiverer det nye endepunktet og rydder det gamle sporet',
      kontrakt.påSlått.revoked === false && kontrakt.e2Aktiv && !kontrakt.e1Igjen, kontrakt);
    log('15d … og den neste automatiske fornyelsen går som normalt',
      kontrakt.etterpå.revoked === false, kontrakt.etterpå);

    /* «Slå av» gjelder ENHETEN, ikke URL-en: etter en rullering kan den samme
       klienten ha to rader en stund, og begge skal av. Det krever ingen
       samtidighet — det holder at begge finnes. */
    const enhet = await p.evaluate(async () => {
      const c = window.HK_MOCK.createClient();
      const K = 'BP' + 'k'.repeat(83) + 'r2';
      const A = 't'.repeat(22);
      const kall = (ende, mer) => c.rpc('push_subscribe', Object.assign({
        p_endpoint: ende, p_p256dh: K, p_auth: A, p_labels: {}, p_tz: 'Europe/Oslo',
        p_browser: 'Chrome', p_platform: 'Android', p_origin: 'www.huskis.no',
        p_device_id: 'd-tvilling' }, mer || {}));
      const t1 = await kall('https://push.test/t1');
      const t2 = await kall('https://push.test/t2');            // samme klient, rullert
      const annen = await kall('https://push.test/t3', { p_device_id: 'd-annen' });
      await c.rpc('push_revoke', { p_id: t1.data.id });         // brukeren slår av ENHETEN
      const db = window.HK_MOCK._loadDB();
      const rad = (e) => db.push_subscriptions.find((x) => x.endpoint === e) || null;
      const auto = await kall('https://push.test/t2');
      return {
        t1: !!(rad('https://push.test/t1') || {}).revoked_at,
        t2: !!(rad('https://push.test/t2') || {}).revoked_at,
        t2Nøkler: (rad('https://push.test/t2') || {}).p256dh,
        annen: !!(rad('https://push.test/t3') || {}).revoked_at,
        annenId: annen.data && annen.data.revoked,
        auto: auto.data && auto.data.revoked,
      };
    });
    log('15e «slå av» på den ene raden slo av HELE klienten, også det rullerte endepunktet',
      enhet.t1 === true && enhet.t2 === true, enhet);
    log('15f … med nøklene tømt på begge', enhet.t2Nøkler === '');
    log('15g … mens en annen enhet står urørt',
      enhet.annen === false && enhet.annenId === false);
    log('15h … og den neste automatiske fornyelsen av det rullerte endepunktet blir avvist',
      enhet.auto === true);
    log('15: ingen JS-feil i konsollen', feil.length === 0, feil.join(' | '));
    await ctx.close();
  }

  /* ---------- Del 7: fjern-utlogget klient som står åpen ---------- */
  {
    const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
    const p = await ctx.newPage();
    const feil = [];
    p.on('pageerror', (e) => feil.push(String(e)));
    await p.addInitScript(fakePlattform);
    await seed(p, BASE + '/index.html?mock=1', buildDB(Date.now()));

    // Bufferen FØR utloggingen: den skal overleve, slik at usynkede lokale
    // endringer ikke går tapt når en annen enhet logger denne ut.
    await p.waitForFunction((u) => !!localStorage.getItem('mine-lister-v1:' + u),
      uid, { timeout: 15000, polling: 100 });
    const førCache = await p.evaluate((u) => localStorage.getItem('mine-lister-v1:' + u), uid);
    log('7a den lokale bufferen finnes før fjern-utloggingen', !!førCache);

    // «En annen enhet» logger denne ut mens fanen står åpen.
    await p.evaluate((sid) => {
      const db = window.HK_MOCK._loadDB();
      db.auth_sessions = db.auth_sessions.filter((x) => x.id !== sid);
      window.HK_MOCK._saveDB(db);
    }, SESS_HER);
    await p.evaluate(() => window.__huskis.cloudCycle());

    await p.waitForFunction(() => !window.__huskis.authUser && !document.getElementById('auth-screen').hidden,
      null, { timeout: 15000, polling: 100 });
    log('7b klienten oppdaget det og gikk til innloggingssiden',
      await p.evaluate(() => !window.__huskis.authUser &&
        !document.getElementById('auth-screen').hidden));
    const melding = await p.textContent('#auth-msg');
    log('7c … med en beskjed om hva som skjedde',
      /logget ut fra en annen enhet/i.test(melding || ''), melding);
    log('7d … og uten å røre den lokale bufferen (usynkede endringer overlever)',
      await p.evaluate((u) => localStorage.getItem('mine-lister-v1:' + u), uid) === førCache);
    log('7e synken er stoppet — ingen flere kall på den døde økten',
      await p.evaluate(() => window.__huskis.lastMy === null));
    log('7: ingen JS-feil i konsollen', feil.length === 0, feil.join(' | '));
    await ctx.close();
  }

  await browser.close();

  const ok = results.filter(Boolean).length;
  console.log('\n==== ' + ok + '/' + results.length + ' PASS ====');
  process.exit(ok === results.length ? 0 : 1);
})();
