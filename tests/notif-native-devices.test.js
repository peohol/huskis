/*
  Regresjonstest: ANDROID I «ENHETER MED VARSLER» (docs/varsler.md).

  «Enheter med varsler» skal beskrive ALLE klienter som varsler utenfor appen,
  ikke bare nettleserne med web push. Android planlegger LOKALE alarmer på
  telefonen og har intet abonnement — uten en status på serveren ville en
  telefon som varslet helt korrekt vært usynlig fra huskis.no, og ingen annen
  enhet kunne slått den av.

  Ingen ekte telefon og ingen ekte pushtjeneste finnes i en testrunde. Det som
  fakes er derfor NØYAKTIG plattformen — pluginbroen, `Notification`,
  `serviceWorker` — som i `notif-channels.test.js`; alt Huskis selv gjør er
  ekte kode: RPC-ene, listen, bryteren, diffen og utloggingen.

  Dekker:
     1. Nettleseren SER Android-appen: begge kanaltypene står i den samme
        listen, appen heter «Huskis · Android», bærer ingen vert (appens
        interne er en kontekstnøkkel, ikke en adresse), og telleren i
        varselpanelet dekker begge.
     2. En Android-app uten en levende økt er IKKE en varselenhet — utlogging
        skal ikke være avhengig av at den utloggede klienten samarbeider.
     3. Nettleseren slår av Android: raden forsvinner, serveren har registrert
        valget, og kvitteringen lover ikke mer enn den kan holde (alarmene
        ligger på telefonen — en lukket app tar dem ned neste gang den brukes).
     4. «Slå av varsler på alle andre enheter» dekker BEGGE kanaltypene og
        beholder gjeldende klient.
     5. Appen melder seg selv: ingen rad før varslene er slått på, én rad med
        det samme etterpå, og den står som «denne enheten» i appens egen liste.
     6. Lokalt AV melder fra med det samme, og lokalt PÅ igjen likeså.
     7. Fjern-avslåing mens appen er ÅPEN gjennomføres i neste synk-runde: de
        planlagte alarmene avlyses, bryteren går av, serverstatusen står, og
        ingen automatisk runde kan slå dem på igjen.
     8. Et EKSPLISITT «slå på varsler» i appen opphever avslåingen, planlegger
        alarmene på nytt, og appen står i listen igjen.
     9. Utlogging tar varselstatusen med seg — og alarmene.

  Kjør:
    python3 -m http.server 8000                        # fra repo-roten, i egen terminal
    NODE_PATH=$(npm root -g) node tests/notif-native-devices.test.js
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

const uid = 'uN';
const SESS_WEB = '11110000-0000-4000-8000-0000000000a1';   // nettleseren
const SESS_APP = '22220000-0000-4000-8000-0000000000a2';   // Android-appen
const SESS_DØD = '33330000-0000-4000-8000-0000000000a3';   // en app som er logget ut
const SUB_WEB = '44440000-0000-4000-8000-0000000000a4';
const NAT_APP = '55550000-0000-4000-8000-0000000000a5';
const NAT_DØD = '66660000-0000-4000-8000-0000000000a6';
const ENDE_WEB = 'https://push.test/abc';   // det fakePlattform() gir oss

const id = {};
['UA', 'GA', 'LA', 'IA'].forEach((k) => { id[k] = U(); });

/* `due` gjør at det finnes en PLAN å speile ut som alarmer — uten en frist er
   det ingenting å avlyse, og da beviser en «alarmene ble tatt ned»-sjekk
   ingenting. Ti dager fram gir både «frist om mindre enn en uke» og selve
   fristen som terskler i framtiden. */
function buildDB(due, opts) {
  const o = opts || {};
  const now = Date.now();
  const base = (x) => Object.assign({
    trashed: false, locked: false, unlocked: false, invite_policy: 'inherit',
    collapsed: false, is_cat: false, cat_id: null,
    start_at: null, due_at: null, lock_times: false,
    ts: 1, org: 'v', pos: 0, pos_ts: 1, pos_org: 'v',
  }, x);
  const db = {
    _rolesBackfilled: true,
    profiles: [{ id: uid, email: 'n@x.no', display_name: 'Native Testesen', user_metadata: {} }],
    passwords: { 'n@x.no': 'x' },
    universes: [base({ id: id.UA, owner_id: uid, name: 'Varselområde' })],
    groups: [base({ id: id.GA, owner_id: uid, universe_id: id.UA, name: 'Mappe' })],
    cards: [base({ id: id.LA, owner_id: uid, group_id: id.GA, title: 'Tannlegetime',
      k: true, p: true, lab_ts: 0, lab_org: '', due_at: due })],
    items: [base({ id: id.IA, owner_id: uid, card_id: id.LA, text: 'Punkt', done: false })],
    memberships: [{ id: U(), user_id: uid, universe_id: id.UA, group_id: null, role: 'owner', pos: 0, created_at: 1 }],
    share_invites: [], tombstones: [], notifications: [], notification_prefs: [],
    push_deliveries: [], push_subscriptions: [],
    auth_sessions: [], device_sessions: [], native_notif_devices: [],
  };
  if (o.web) {
    // Nettleseren: en økt og et web push-abonnement (endepunktet er det
    // fakePlattform() gir siden, så «denne enheten» blir merket av seg selv).
    db.auth_sessions.push({ id: SESS_WEB, user_id: uid, created_at: now - 3600000,
      refreshed_at: now - 1000, user_agent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/131',
      ip: '198.51.100.4' });
    db.device_sessions.push({ session_id: SESS_WEB, user_id: uid, browser: 'Chrome',
      platform: 'Windows', origin: 'localhost', device_id: 'd-web',
      created_at: now - 3600000, seen_at: now - 1000 });
    db.push_subscriptions.push({ id: SUB_WEB, user_id: uid, endpoint: ENDE_WEB,
      p256dh: 'BP' + 'k'.repeat(83) + 'h1', auth: 's'.repeat(22), labels: {}, tz: 'Europe/Oslo',
      browser: 'Chrome', platform: 'Windows', origin: 'localhost', device_id: 'd-web',
      created_at: now - 86400000, seen_at: now - 1000, disabled_at: null, revoked_at: null });
  }
  if (o.appØkt || o.app) {
    // Android-appens innlogging hos «Supabase». Uten den ville appens egen økt
    // vært fjern-utlogget, og siden hadde gått rett til innloggingsskjermen.
    db.auth_sessions.push({ id: SESS_APP, user_id: uid, created_at: now - 7200000,
      refreshed_at: now - 60000, user_agent: 'Mozilla/5.0 (Linux; Android 14)', ip: '203.0.113.9' });
  }
  if (o.app) {
    /* … og en app som IKKE kjører nå: sidebordsraden og en påslått native
       varselkanal, altså nøyaktig det en telefon etterlater seg. Kjører appen
       selv (del 5–9), skriver `session_touch()` og statusrunden dette selv. */
    db.device_sessions.push({ session_id: SESS_APP, user_id: uid, browser: 'Huskis',
      platform: 'Android', origin: 'localhost', device_id: 'd-app',
      created_at: now - 7200000, seen_at: now - 60000 });
    db.native_notif_devices.push({ id: NAT_APP, user_id: uid, device_id: 'd-app',
      origin: 'localhost', browser: 'Huskis', platform: 'Android', enabled: true,
      created_at: now - 7200000, seen_at: now - 60000, revoked_at: null });
  }
  if (o.utlogget) {
    /* En app som er logget ut: statusraden står igjen med `enabled`, men økten
       er borte. Den skal IKKE være en varselenhet — det er hele poenget med at
       listen krever en levende økt i klientkonteksten. */
    db.native_notif_devices.push({ id: NAT_DØD, user_id: uid, device_id: 'd-gammel-app',
      origin: 'localhost', browser: 'Huskis', platform: 'Android', enabled: true,
      created_at: now - 30 * 86400000, seen_at: now - 20 * 86400000, revoked_at: null });
  }
  if (o.annenWeb) {
    // Enda en nettleser med varsler — «alle andre» må ta både den og appen.
    db.push_subscriptions.push({ id: U(), user_id: uid, endpoint: 'https://push.test/annen',
      p256dh: 'BP' + 'k'.repeat(83) + 'd1', auth: 't'.repeat(22), labels: {}, tz: 'Europe/Oslo',
      browser: 'Firefox', platform: 'macOS', origin: 'www.huskis.no', device_id: 'd-mac',
      created_at: now - 8 * 86400000, seen_at: now - 3 * 86400000,
      disabled_at: null, revoked_at: null });
  }
  return db;
}

/* Plattformen, og bare den. `?ch=native` gir pluginbroen (og dermed
   `nativeShell`), ellers settes nettleserens tre ledd opp med et abonnement
   som finnes fra før — det er `myPushEndpoint()` sin kilde til «denne
   enheten». `userAgentData` fjernes så plattformen leses av user-agenten,
   som Playwright kan sette. */
function fakePlattform() {
  const q = new URLSearchParams(location.search);
  const ch = q.get('ch');
  window.__kanal = { schedule: [], cancel: [], pending: [], alarmer: [],
    perm: q.get('perm') || 'granted', spurt: 0, kall: {}, broKall: 0 };

  Object.defineProperty(navigator, 'userAgentData', { value: undefined, configurable: true });

  /* RPC-laget instrumenteres: `__kanal.kall` teller kall per navn. Uten det
     kan ingen test se forskjell på «statusrunden går» og «statusrunden SKRIVER
     hver runde» — og den forskjellen er hele dempingen. Innpakningen må sitte
     på `createClient` FØR mock-backenden tas i bruk. */
  Object.defineProperty(window, 'HK_MOCK', {
    configurable: true,
    set(v) {
      const lagKlient = v.createClient;
      v.createClient = function () {
        const c = lagKlient.apply(this, arguments);
        const ekte = c.rpc.bind(c);
        c.rpc = function (navn, params) {
          window.__kanal.kall[navn] = (window.__kanal.kall[navn] || 0) + 1;
          return ekte(navn, params);
        };
        return c;
      };
      Object.defineProperty(window, 'HK_MOCK', { value: v, writable: true, configurable: true });
    },
    get() { return undefined; },
  });

  // Avsendernøkkelen settes fast, så web push-kanalen finnes uansett hva som
  // står i produksjons-config.js.
  Object.defineProperty(window, 'HUSKIS_CONFIG', {
    configurable: true,
    set(v) {
      v.pushPublicKey = 'BKf-0z47jqWLUVd_3r4-JbyhdGwgWERsrt1l0Cfur7vPXM7644P_EyKSDC1aGhvm7kr5plt9zOpvdaz_WTuJoII';
      Object.defineProperty(window, 'HUSKIS_CONFIG', { value: v, writable: true, configurable: true });
    },
    get() { return undefined; },
  });

  if (ch === 'native') {
    window.Capacitor = {
      isNativePlatform: () => true,
      Plugins: {
        LocalNotifications: {
          // Telles: en tur over pluginbroen skal ikke gå hvert femte sekund.
          checkPermissions: async () => {
            window.__kanal.broKall++;
            return { display: window.__kanal.perm };
          },
          requestPermissions: async () => {
            window.__kanal.spurt++;
            window.__kanal.perm = 'granted';
            return { display: 'granted' };
          },
          getPending: async () => ({ notifications: window.__kanal.pending.slice() }),
          schedule: async (o) => {
            window.__kanal.schedule.push(o.notifications);
            o.notifications.forEach((n) => {
              window.__kanal.pending.push({ id: n.id });
              window.__kanal.alarmer.push({ id: n.id, at: n.schedule.at });
            });
          },
          cancel: async (o) => {
            window.__kanal.cancel.push(o.notifications);
            const vekk = new Set(o.notifications.map((n) => n.id));
            window.__kanal.alarmer = window.__kanal.alarmer.filter((n) => !vekk.has(n.id));
            window.__kanal.pending = window.__kanal.pending.filter((n) => !vekk.has(n.id));
          },
          addListener: async () => ({ remove() {} }),
        },
        // OTA-pluginen finnes i det ekte skallet; uten stubbene ville
        // oppstarten feilet på noe som ikke er det denne testen handler om.
        LiveUpdate: {
          ready: async () => ({}),
          getVersionCode: async () => ({ versionCode: '3' }),
          getBlockedBundles: async () => ({ bundleIds: [] }),
        },
      },
    };
    return;
  }

  class FakeNotification {
    static get permission() { return window.__kanal.perm; }
    static async requestPermission() { window.__kanal.spurt++; return 'granted'; }
  }
  Object.defineProperty(window, 'Notification', { value: FakeNotification, configurable: true, writable: true });

  const nøkkel = (n) => new Uint8Array(n === 'auth' ? 16 : 65).fill(n === 'auth' ? 7 : 4).buffer;
  let abo = { endpoint: 'https://push.test/abc', getKey: nøkkel,
    unsubscribe: async () => { abo = null; return true; } };
  const reg = {
    pushManager: { getSubscription: async () => abo, subscribe: async () => abo },
    unregister: async () => true,
  };
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: {
      register: async () => reg,
      getRegistration: async () => reg,
      get ready() { return Promise.resolve(reg); },
      addEventListener() {},
    },
  });
}

async function seed(p, url, db, sid, lokalt) {
  await p.goto(url);
  await p.evaluate(({ db, uid, sid, lokalt }) => {
    localStorage.clear(); sessionStorage.clear();
    localStorage.setItem('hk-mock-db', JSON.stringify(db));
    Object.keys(lokalt || {}).forEach((k) => localStorage.setItem(k, lokalt[k]));
    sessionStorage.setItem('hk-mock-session', JSON.stringify({
      id: uid, email: 'n@x.no', session_id: sid,
      user_metadata: { onboarding: { v: 3, status: 'done' },
        tips: { drag: true, trash: true, moveList: true, dragTrash: true } },
    }));
  }, { db, uid, sid, lokalt: lokalt || {} });
  await p.goto(url);
  await p.waitForFunction(() => {
    const H = window.__huskis;
    return H && H.authUser && H.lastMy && H.state.universes.length > 0;
  }, null, { timeout: 20000, polling: 200 });
}

const dbOf = (p) => p.evaluate(() => window.HK_MOCK._loadDB());
const natRad = (d, dev) => (d.native_notif_devices || [])
  .find((x) => x.device_id === dev) || null;

async function cycle(p) {
  await p.evaluate(() => window.__huskis.cloudCycle());
  await p.waitForTimeout(500);
}

async function åpneEnheter(p) {
  await p.evaluate(() => window.__huskis.openAccount());
  await p.click('#acc-devices-head');
  await p.waitForFunction(() => {
    const el = document.getElementById('push-device-list');
    return el && el.querySelectorAll('.device-row').length > 0;
  }, null, { timeout: 10000, polling: 100 });
}

const rader = (p, sel) => p.$$eval(sel + ' .device-row', (els) => els.map((el) => ({
  id: el.dataset.id,
  kind: el.dataset.kind || null,
  navn: (el.querySelector('.device-name') || {}).textContent || '',
  her: !!el.querySelector('.device-here'),
  origin: (el.querySelector('.device-origin') || {}).textContent || '',
  knapp: (el.querySelector('.device-action') || {}).textContent || null,
})));

async function bekreft(p) {
  await p.waitForSelector('#confirm-modal:not([hidden]) #confirm-ok', { timeout: 5000 });
  await p.click('#confirm-modal #confirm-ok');
}

const toast = (p) => p.evaluate(() => {
  const el = document.getElementById('toast');
  return el ? el.textContent : '';
});

/* Fristen ti dager fram. Regnes ut I SIDEN, så den følger nettleserens egen
   sone — planen gjør det samme. */
const omTiDager = (p) => p.evaluate(() => {
  const d = new Date(Date.now() + 10 * 86400000);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0') + 'T12:00';
});

(async () => {
  const browser = await chromium.launch();
  const AND_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';

  /* ============ Del 1–4: NETTLESEREN ser og styrer Android ============ */
  {
    const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
    const p = await ctx.newPage();
    const feil = [];
    p.on('pageerror', (e) => feil.push(String(e)));
    await ctx.addInitScript(fakePlattform);
    const URL_W = BASE + '/?mock=1';
    await p.goto(URL_W);
    const due = await omTiDager(p);

    /* ---------- 1: begge kanaltypene i den samme listen ---------- */
    await seed(p, URL_W, buildDB(due, { web: true, app: true, utlogget: true }),
      SESS_WEB, { 'mine-lister-device': 'd-web' });
    await åpneEnheter(p);
    let pr = await rader(p, '#push-device-list');
    log('1a: «Enheter med varsler» viser BÅDE nettleseren og Android-appen',
      pr.length === 2, JSON.stringify(pr.map((r) => r.kind + ':' + r.navn)));
    const nativRad = pr.find((r) => r.kind === 'native');
    const webRad = pr.find((r) => r.kind === 'web');
    log('1b: Android-appen heter «Huskis · Android»',
      !!nativRad && nativRad.navn === 'Huskis · Android', nativRad && nativRad.navn);
    log('1c: … og bærer ingen vert — appens interne er en kontekstnøkkel, ikke en adresse',
      !!nativRad && nativRad.origin === '', nativRad && nativRad.origin);
    log('1d: … og er IKKE «denne enheten», men kan slås av herfra',
      !!nativRad && !nativRad.her && !!nativRad.knapp);
    log('1e: nettleserens egen rad er «denne enheten», uten «Slå av»',
      !!webRad && webRad.her && webRad.knapp === null);
    log('1f: telleren i varselpanelet dekker begge kanaltypene',
      (await p.evaluate(() => window.__huskis.notifPushDevices)) === 2,
      await p.evaluate(() => window.__huskis.notifPushDevices));

    /* ---------- 2: en utlogget app er ikke en varselenhet ---------- */
    const d0 = await dbOf(p);
    log('2a: den utloggede appens statusrad står fortsatt på i «databasen»',
      !!natRad(d0, 'd-gammel-app') && natRad(d0, 'd-gammel-app').enabled === true);
    log('2b: … men uten en levende økt er den IKKE en enhet med varsler',
      !pr.some((r) => r.id === NAT_DØD));

    /* ---------- 3: nettleseren slår av Android ---------- */
    await p.evaluate((id) => {
      const li = [...document.querySelectorAll('#push-device-list .device-row')]
        .find((el) => el.dataset.id === id);
      li.querySelector('.device-action').click();
    }, NAT_APP);
    await p.waitForFunction(() => document.querySelectorAll('#push-device-list .device-row').length === 1,
      null, { timeout: 8000, polling: 100 });
    pr = await rader(p, '#push-device-list');
    const d1 = await dbOf(p);
    log('3a: Android-raden forsvinner fra listen',
      pr.length === 1 && pr[0].kind === 'web');
    log('3b: … serveren har registrert avslåingen (varig, som for et abonnement)',
      !!natRad(d1, 'd-app') && !!natRad(d1, 'd-app').revoked_at &&
      natRad(d1, 'd-app').enabled === false, JSON.stringify(natRad(d1, 'd-app')));
    log('3c: … kvitteringen lover ikke mer enn den kan holde (appen tar dem ned selv)',
      /neste gang den er i bruk/i.test(await toast(p)), await toast(p));
    log('3d: … og nettleserens eget abonnement er urørt',
      d1.push_subscriptions.find((x) => x.id === SUB_WEB).revoked_at == null);

    /* ---------- 4: «slå av på alle andre enheter» dekker begge ---------- */
    await seed(p, URL_W, buildDB(due, { web: true, app: true, annenWeb: true }),
      SESS_WEB, { 'mine-lister-device': 'd-web' });
    await åpneEnheter(p);
    log('4a: tre varselenheter før handlingen',
      (await rader(p, '#push-device-list')).length === 3);
    await p.click('#push-off-others-btn');
    await bekreft(p);
    await p.waitForFunction(() => document.querySelectorAll('#push-device-list .device-row').length === 1,
      null, { timeout: 8000, polling: 100 });
    const d2 = await dbOf(p);
    pr = await rader(p, '#push-device-list');
    log('4b: bare gjeldende enhet står igjen', pr.length === 1 && pr[0].her);
    log('4c: … den andre nettleserens abonnement er slått av',
      !!d2.push_subscriptions.find((x) => x.endpoint === 'https://push.test/annen').revoked_at);
    log('4d: … og Android-appen er slått av i samme handling',
      !!natRad(d2, 'd-app') && !!natRad(d2, 'd-app').revoked_at);
    log('4e: … mens gjeldende abonnement er urørt',
      d2.push_subscriptions.find((x) => x.id === SUB_WEB).revoked_at == null);
    log('4f: kvitteringen nevner at appen tar sine ned selv',
      /neste gang den er i bruk/i.test(await toast(p)), await toast(p));

    log('1–4: ingen JS-feil i konsollen', feil.length === 0, feil.join(' | '));
    await ctx.close();
  }

  /* ============ Del 5–9: ANDROID-APPEN selv ============ */
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 780 },
      userAgent: AND_UA });
    const p = await ctx.newPage();
    const feil = [];
    p.on('pageerror', (e) => feil.push(String(e)));
    await ctx.addInitScript(fakePlattform);
    const URL_A = BASE + '/?mock=1&ch=native';
    await p.goto(URL_A);
    const due = await omTiDager(p);

    /* ---------- 5: appen melder seg selv ---------- */
    await seed(p, URL_A, buildDB(due, { web: true, appØkt: true }), SESS_APP,
      { 'mine-lister-device': 'd-app' });
    log('5a: kanalen er den native', (await p.evaluate(() => window.__huskis.notifChannel().id)) === 'native');
    log('5b: appen presenterer seg som «Huskis · Android»',
      (await p.evaluate(() => window.__huskis.clientBrowser() + ' · ' + window.__huskis.clientPlatform()))
        === 'Huskis · Android');
    await cycle(p);
    log('5c: en app UTEN varsler på lager ingen statusrad',
      (await dbOf(p)).native_notif_devices.length === 0);

    await p.evaluate(() => window.__huskis.setNotifChannel(true));
    await p.waitForFunction(() => window.__kanal.alarmer.length > 0, null, { timeout: 10000, polling: 100 });
    let d = await dbOf(p);
    log('5d: et «slå på varsler» melder statusen med det samme',
      !!natRad(d, 'd-app') && natRad(d, 'd-app').enabled === true &&
      natRad(d, 'd-app').revoked_at == null, JSON.stringify(natRad(d, 'd-app')));
    log('5e: … og alarmene er lagt på telefonen',
      (await p.evaluate(() => window.__kanal.alarmer.length)) > 0);
    /* DEMPINGEN. Statusen endrer seg bare når brukeren rører bryteren eller
       tillatelsen; en synk-runde som ikke har noe nytt å melde skal verken
       skrive til databasen eller gå over pluginbroen (docs/varsler.md,
       «Android i enhetslisten»). */
    const før = await p.evaluate(() => ({
      rpc: window.__kanal.kall.native_notif_touch || 0, bro: window.__kanal.broKall }));
    await cycle(p); await cycle(p); await cycle(p);
    const etter = await p.evaluate(() => ({
      rpc: window.__kanal.kall.native_notif_touch || 0, bro: window.__kanal.broKall }));
    log('5h: tre synk-runder uten ny status skriver ikke til serveren',
      etter.rpc === før.rpc, JSON.stringify({ før: før.rpc, etter: etter.rpc }));
    log('5i: … og går ikke over pluginbroen for ingenting',
      etter.bro === før.bro, JSON.stringify({ før: før.bro, etter: etter.bro }));

    await åpneEnheter(p);
    let pr = await rader(p, '#push-device-list');
    log('5f: appen står som «denne enheten» i sin egen liste, uten «Slå av»',
      pr.some((r) => r.kind === 'native' && r.her && r.knapp === null),
      JSON.stringify(pr.map((r) => r.kind + ':' + r.her)));
    log('5g: … og nettleserens abonnement er den andre raden',
      pr.length === 2 && pr.some((r) => r.kind === 'web' && !r.her));
    await p.evaluate(() => window.__huskis.closeAccount());

    /* ---------- 6: lokalt av og på igjen ---------- */
    await p.evaluate(() => window.__huskis.setNotifChannel(false));
    await p.waitForFunction(() => {
      const r = (window.HK_MOCK._loadDB().native_notif_devices || [])[0];
      return r && r.enabled === false;
    }, null, { timeout: 8000, polling: 100 }).catch(() => {});
    d = await dbOf(p);
    log('6a: et lokalt «slå av» melder fra med det samme',
      !!natRad(d, 'd-app') && natRad(d, 'd-app').enabled === false);
    log('6b: … alarmene er tatt ned',
      (await p.evaluate(() => window.__kanal.alarmer.length)) === 0);
    log('6c: … og appen er ikke lenger en varselenhet i listen',
      (await p.evaluate(async () => {
        await window.__huskis.loadDevices();
        return (window.__huskis.devices.push || []).filter((x) => x.kind === 'native').length;
      })) === 0);

    await p.evaluate(() => window.__huskis.setNotifChannel(true));
    await p.waitForFunction(() => window.__kanal.alarmer.length > 0, null, { timeout: 10000, polling: 100 });
    d = await dbOf(p);
    log('6d: og på igjen: statusen er på, alarmene er tilbake',
      !!natRad(d, 'd-app') && natRad(d, 'd-app').enabled === true);

    /* ---------- 7: fjern-avslåing mens appen er ÅPEN ---------- */
    /* En ANNEN enhet slår av denne appen. Handlingen gjøres gjennom den samme
       RPC-en en annen klient ville brukt — serveren kan ikke se forskjell, og
       det er hele poenget: valget ligger på KONTOEN, ikke i en økt. */
    const nid = await p.evaluate(async () => {
      const c = window.HK_MOCK.createClient();
      const liste = (await c.rpc('list_my_devices', { p_endpoint: null,
        p_device_id: 'd-annen', p_origin: 'localhost' })).data;
      const rad = (liste.push || []).find((x) => x.kind === 'native');
      await c.rpc('native_notif_revoke', { p_id: rad.id });
      return rad.id;
    });
    log('7a: en annen enhet slo av appen på serveren',
      !!natRad(await dbOf(p), 'd-app').revoked_at, nid);

    // ÉN vanlig synk-runde er alt appen får.
    await cycle(p);
    await p.waitForFunction(() => window.__kanal.alarmer.length === 0,
      null, { timeout: 10000, polling: 100 }).catch(() => {});
    log('7b: appen oppdager det i neste synk-runde og AVLYSER de planlagte alarmene',
      (await p.evaluate(() => window.__kanal.alarmer.length)) === 0,
      await p.evaluate(() => window.__kanal.alarmer.length));
    log('7c: … den lokale bryteren går av',
      (await p.evaluate(() => window.__huskis.notifChannelWanted())) === false &&
      (await p.evaluate(() => window.__huskis.notifChState)) === 'off');
    log('7d: … appen vet at valget ble tatt et annet sted',
      (await p.evaluate(() => window.__huskis.pushRevokedHere)) === true);
    d = await dbOf(p);
    log('7e: … og serverstatusen er FORTSATT avslått',
      !!natRad(d, 'd-app').revoked_at && natRad(d, 'd-app').enabled === false);

    // Flere automatiske runder skal ikke kunne slå dem på igjen.
    await cycle(p);
    await p.evaluate(() => window.__huskis.syncNativeNotifDevice());
    await cycle(p);
    await p.waitForTimeout(300);
    d = await dbOf(p);
    log('7f: automatisk synk kan ALDRI slå dem på igjen',
      !!natRad(d, 'd-app').revoked_at && natRad(d, 'd-app').enabled === false &&
      (await p.evaluate(() => window.__kanal.alarmer.length)) === 0 &&
      (await p.evaluate(() => window.__huskis.notifChannelWanted())) === false);

    /* ---------- 8: et EKSPLISITT «slå på» opphever ---------- */
    await p.evaluate(() => window.__huskis.setNotifChannel(true));
    await p.waitForFunction(() => window.__kanal.alarmer.length > 0, null, { timeout: 10000, polling: 100 });
    d = await dbOf(p);
    log('8a: brukeren slår dem på igjen HER, og avslåingen oppheves',
      natRad(d, 'd-app').revoked_at == null && natRad(d, 'd-app').enabled === true,
      JSON.stringify(natRad(d, 'd-app')));
    log('8b: … alarmene er planlagt på nytt',
      (await p.evaluate(() => window.__kanal.alarmer.length)) > 0);
    log('8c: … og appen står i varselenhetslisten igjen',
      (await p.evaluate(async () => {
        await window.__huskis.loadDevices();
        return (window.__huskis.devices.push || []).filter((x) => x.kind === 'native').length;
      })) === 1);
    await cycle(p);
    d = await dbOf(p);
    log('8d: … og den neste automatiske runden lar den stå på',
      natRad(d, 'd-app').revoked_at == null && natRad(d, 'd-app').enabled === true);

    /* ---------- 9: utlogging ---------- */
    await p.evaluate(() => window.__huskis.logout());
    await p.waitForFunction(() => {
      const r = (window.HK_MOCK._loadDB().native_notif_devices || [])[0];
      return r && r.enabled === false;
    }, null, { timeout: 10000, polling: 100 }).catch(() => {});
    d = await dbOf(p);
    log('9a: utlogging tar varselstatusen med seg — ingen falsk «enhet med varsler»',
      !!natRad(d, 'd-app') && natRad(d, 'd-app').enabled === false,
      JSON.stringify(natRad(d, 'd-app')));
    log('9b: … og de planlagte alarmene er tatt ned',
      (await p.evaluate(() => window.__kanal.alarmer.length)) === 0);

    log('5–9: ingen JS-feil i konsollen', feil.length === 0, feil.join(' | '));
    await ctx.close();
  }

  await browser.close();
  const ok = results.filter(Boolean).length;
  console.log('\n==== ' + ok + '/' + results.length + ' PASS ====');
  process.exit(ok === results.length ? 0 : 1);
})();
