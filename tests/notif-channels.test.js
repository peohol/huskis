/*
  Regresjonstest: DE EKSTERNE VARSELKANALENE (docs/varsler.md).

  De samme varslene, levert ut av appen. To kanaler, én per enhet: Android
  planlegger LOKALE varsler på telefonen, nettleseren melder seg på web push og
  får dem fra serveren. Ingen av dem er en generator — begge leverer planen
  (`planNotifications`), som `notif-plan.test.js` dekker for seg.

  Ingen ekte telefon og ingen ekte pushtjeneste finnes i en testrunde. Det som
  fakes er derfor NØYAKTIG plattformen — pluginbroen, `Notification`,
  `serviceWorker` — mens alt Huskis selv gjør er ekte kode: tilstandsmaskinen,
  diffen, RPC-ene, panelet og rutingen.

  Dekker:
     1. Den deterministiske native ID-en: samme nøkkel gir samme heltall, ulike
        nøkler gir ulike, og tallet er alltid et positivt 31-bits int (Androids
        varsel-ID er et Java-`int`).
     2. Android-adapteren: tillatelse spørres kun etter et brukertrykk, planen
        speiles som en DIFF (ingen dubletter ved gjentatt synk), en avlyst
        terskel kanselleres, og alarmen er UPRESIS — appen ber aldri om
        SCHEDULE_EXACT_ALARM.
     3. Trykk på et native varsel navigerer til objektet.
     4. Web push-kanalen: uten avsendernøkkel finnes den ikke; med nøkkel kan
        den slås på, den skriver et abonnement, den fornyer seg selv, og den
        slås av igjen — abonnementet forsvinner fra serveren.
     5. Blokkert tillatelse: bryteren maser ikke, den forklarer.
     6. Panelet: bryteren og statusteksten for hver av tilstandene, og at de
        fire typebryterne er urørt.
     7. Service workeren (`sw.js`): en push blir et varsel med navnet som
        overskrift og typeteksten som kropp, nøkkelen er `tag` (så det samme
        varselet ikke stabler seg), og et klikk fokuserer en åpen fane med
        pekeren — eller åpner appen med `?notif=<type>:<id>`.
     8. `?notif=` i adressen navigerer til objektet og fjernes fra adressen.

  Kjør:
    python3 -m http.server 8000                        # fra repo-roten, i egen terminal
    NODE_PATH=$(npm root -g) node tests/notif-channels.test.js
*/
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

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

const uid = 'uK';
const id = {};
['UA', 'GA', 'LA', 'IA'].forEach((k) => { id[k] = U(); });

function buildDB(due) {
  const base = (x) => Object.assign({
    trashed: false, locked: false, unlocked: false, invite_policy: 'inherit',
    collapsed: false, is_cat: false, cat_id: null,
    start_at: null, due_at: null, lock_times: false,
    ts: 1, org: 'v', pos: 0, pos_ts: 1, pos_org: 'v',
  }, x);
  return {
    _rolesBackfilled: true,
    profiles: [{ id: uid, email: 'k@x.no', display_name: 'Kanal', user_metadata: {} }],
    passwords: { 'k@x.no': 'x' },
    universes: [base({ id: id.UA, owner_id: uid, name: 'Kanalområde' })],
    groups: [base({ id: id.GA, owner_id: uid, universe_id: id.UA, name: 'Mappe' })],
    cards: [base({ id: id.LA, owner_id: uid, group_id: id.GA, title: 'Tannlegetime',
      k: true, p: true, lab_ts: 0, lab_org: '', due_at: due })],
    items: [base({ id: id.IA, owner_id: uid, card_id: id.LA, text: 'Punkt', done: false })],
    memberships: [{ id: U(), user_id: uid, universe_id: id.UA, group_id: null, role: 'owner', pos: 0, created_at: 1 }],
    share_invites: [], tombstones: [], notifications: [], notification_prefs: [],
    push_subscriptions: [], push_deliveries: [],
  };
}

/* Plattformen, og bare den. `?ch=native` gir pluginbroen, `?ch=web` gir
   Notification + serviceWorker. Uten `?nokkel=0` settes avsendernøkkelen inn i
   konfigurasjonen — den står tom i repoet (den lages én gang, manuelt), og uten
   den melder web push-kanalen seg selv som ikke støttet. */
function fakePlattform() {
  const q = new URLSearchParams(location.search);
  const ch = q.get('ch');
  window.__kanal = { schedule: [], cancel: [], pending: [], perm: q.get('perm') || 'prompt',
    spurt: 0, vist: [], meldt: [] };

  if (q.get('nokkel') !== '0') {
    // config.js setter HUSKIS_CONFIG; vi tar imot den og legger nøkkelen inn
    // FØR app.js leser den.
    Object.defineProperty(window, 'HUSKIS_CONFIG', {
      configurable: true,
      set(v) {
        v.pushPublicKey = 'BKf-0z47jqWLUVd_3r4-JbyhdGwgWERsrt1l0Cfur7vPXM7644P_EyKSDC1aGhvm7kr5plt9zOpvdaz_WTuJoII';
        Object.defineProperty(window, 'HUSKIS_CONFIG', { value: v, writable: true, configurable: true });
      },
      get() { return undefined; },
    });
  }

  if (ch === 'native') {
    window.Capacitor = {
      isNativePlatform: () => true,
      Plugins: {
        LocalNotifications: {
          checkPermissions: async () => ({ display: window.__kanal.perm }),
          requestPermissions: async () => {
            window.__kanal.spurt++;
            window.__kanal.perm = window.__kanal.svar || 'granted';
            return { display: window.__kanal.perm };
          },
          getPending: async () => ({ notifications: window.__kanal.pending.slice() }),
          schedule: async (o) => {
            window.__kanal.schedule.push(o.notifications);
            o.notifications.forEach((n) => window.__kanal.pending.push({ id: n.id }));
          },
          cancel: async (o) => {
            window.__kanal.cancel.push(o.notifications);
            const vekk = new Set(o.notifications.map((n) => n.id));
            window.__kanal.pending = window.__kanal.pending.filter((n) => !vekk.has(n.id));
          },
          addListener: async (navn, fn) => {
            if (navn === 'localNotificationActionPerformed') window.__kanal.trykk = fn;
            return { remove() {} };
          },
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

  if (ch !== 'web') return;
  // Nettleserens tre ledd. `PushManager` finnes allerede i Chromium.
  class FakeNotification {
    static get permission() { return window.__kanal.perm; }
    static async requestPermission() {
      window.__kanal.spurt++;
      window.__kanal.perm = window.__kanal.svar || 'granted';
      return window.__kanal.perm;
    }
  }
  Object.defineProperty(window, 'Notification', { value: FakeNotification, configurable: true, writable: true });

  const nøkkel = (n) => new Uint8Array(n === 'auth' ? 16 : 65).fill(n === 'auth' ? 7 : 4).buffer;
  let abo = null;
  const reg = {
    pushManager: {
      getSubscription: async () => abo,
      subscribe: async (o) => {
        window.__kanal.subscribe = { userVisibleOnly: o.userVisibleOnly,
          nøkkelLengde: o.applicationServerKey.length };
        abo = { endpoint: 'https://push.test/' + (window.__kanal.endepunkt || 'abc'),
          getKey: nøkkel, unsubscribe: async () => { abo = null; return true; } };
        return abo;
      },
    },
    unregister: async () => { window.__kanal.avregistrert = true; return true; },
  };
  let registrert = null;
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: {
      register: async (url) => { window.__kanal.registrerte = url; registrert = reg; return reg; },
      getRegistration: async () => registrert,
      get ready() { return Promise.resolve(registrert || reg); },
      addEventListener() {},
    },
  });
}

async function seed(p, url, db) {
  await p.goto(url);
  await p.evaluate(({ db, uid }) => {
    localStorage.clear(); sessionStorage.clear();
    localStorage.setItem('hk-mock-db', JSON.stringify(db));
    sessionStorage.setItem('hk-mock-session', JSON.stringify({
      id: uid, email: 'k@x.no',
      user_metadata: { onboarding: { v: 3, status: 'done' }, tips: { drag: true, trash: true, moveList: true, dragTrash: true } },
    }));
  }, { db, uid });
  await p.goto(url);
  await p.waitForFunction(() => {
    const H = window.__huskis;
    return H && H.authUser && H.lastMy && H.state.universes.length > 0;
  }, null, { timeout: 15000, polling: 200 });
}

async function cycle(p) {
  await p.evaluate(() => window.__huskis.cloudCycle());
  await p.waitForFunction(() => {
    const el = document.getElementById('sync-status');
    return !el || el.dataset.state !== 'saving';
  }, null, { timeout: 8000, polling: 100 }).catch(() => {});
  await p.waitForTimeout(400);
}

const db = (p) => p.evaluate(() => window.HK_MOCK._loadDB());

async function nyKontekst(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 },
    timezoneId: 'Europe/Oslo', locale: 'nb-NO' });
  await ctx.addInitScript(fakePlattform);
  return ctx;
}

/* Service workeren kjøres i NODE, ikke i siden: appens
   innholdssikkerhetspolicy forbyr `unsafe-eval` (docs/sikkerhetsheadere.md), så
   en `new Function(kildekoden)` inne i nettleseren blir — helt riktig —
   blokkert. `sw.js` trenger uansett ingen DOM: den snakker bare med
   `self.registration` og `self.clients`, og begge fakes her. */
async function swSjekker() {
  const ventet = [];
  const ferdig = () => { const p = Promise.all(ventet); ventet.length = 0; return p; };
  const vent = (x) => { ventet.push(x); return x; };
  const vist = [];
  const meldt = [];
  let åpnet = null;
  let klienter = [];
  const lyttere = {};
  const scope = 'https://huskis.no/';
  const self_ = {
    addEventListener: (n, f) => { lyttere[n] = f; },
    skipWaiting: () => {},
    registration: {
      scope,
      showNotification: (t, o) => { vist.push({ t, o }); return Promise.resolve(); },
    },
    clients: {
      claim: () => Promise.resolve(),
      matchAll: () => Promise.resolve(klienter),
      openWindow: (u) => { åpnet = u; return Promise.resolve(); },
    },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8'),
    vm.createContext({ self: self_, console, URL, encodeURIComponent }));

  const kropp = { k: 'dueOver|card|abc|2026-01-01', t: 'dueOver', n: 'Tannlegetime',
    b: 'Frist utløpt', ot: 'card', oi: 'abc' };
  lyttere.push({ data: { json: () => kropp }, waitUntil: vent });
  await ferdig();
  const data = vist[0].o.data;
  lyttere.notificationclick({ notification: { close() {}, data }, waitUntil: vent });
  await ferdig();
  const utenFane = åpnet;
  let fokusert = false;
  klienter = [{ url: scope, focus: () => { fokusert = true; }, postMessage: (m) => meldt.push(m) }];
  åpnet = null;
  lyttere.notificationclick({ notification: { close() {}, data }, waitUntil: vent });
  await ferdig();
  const medFane = åpnet;
  lyttere.push({ data: null, waitUntil: vent });
  await ferdig();

  log('7a: service workeren har INGEN fetch-lytter (oppdateringsmodellen er urørt)',
    Object.keys(lyttere).indexOf('fetch') === -1, Object.keys(lyttere).join(', '));
  log('7b: en push blir et varsel med navnet som overskrift og typeteksten som kropp',
    vist[0].t === 'Tannlegetime' && vist[0].o.body === 'Frist utløpt',
    JSON.stringify({ t: vist[0].t, b: vist[0].o.body }));
  log('7c: nøkkelen er `tag`, så det samme varselet ikke stabler seg',
    vist[0].o.tag === 'dueOver|card|abc|2026-01-01', vist[0].o.tag);
  log('7d: varselet bærer pekeren, og ingen sti eller token',
    JSON.stringify(data) === JSON.stringify(
      { objType: 'card', objId: 'abc', key: 'dueOver|card|abc|2026-01-01' }), JSON.stringify(data));
  log('7e: uten en åpen fane åpnes appen med pekeren i adressen',
    utenFane === scope + '?notif=card%3Aabc', utenFane);
  log('7f: med en åpen fane fokuseres DEN, og får pekeren som en melding',
    fokusert === true && medFane === null &&
    JSON.stringify(meldt) === JSON.stringify(
      [{ type: 'huskis-notif-open', objType: 'card', objId: 'abc' }]), JSON.stringify(meldt));
  log('7g: en push uten lesbar kropp blir likevel et synlig varsel',
    vist.length === 2 && vist[1].t === 'Huskis' && vist[1].o.tag === 'huskis',
    JSON.stringify(vist[1] && { t: vist[1].t, tag: vist[1].o.tag }));
}

async function run() {
  const browser = await chromium.launch();
  const errs = [];

  /* ================= Android ================= */
  const ctxN = await nyKontekst(browser);
  const pn = await ctxN.newPage();
  pn.on('pageerror', (e) => errs.push('native: ' + e.message));
  const NURL = BASE + '/?mock=1&ch=native';
  await pn.goto(NURL);
  const due = await pn.evaluate(() => {
    const d = new Date(Date.now() + 10 * 86400000);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0') + 'T12:00';
  });
  await seed(pn, NURL, buildDB(due));

  /* ---------- 1) Den deterministiske ID-en ---------- */
  const ider = await pn.evaluate(() => {
    const f = window.__huskis.nativeNotifId;
    const a = f('dueOver|card|abc|2026-01-01');
    return {
      stabil: a === f('dueOver|card|abc|2026-01-01'),
      ulik: a !== f('dueSoon|card|abc|2026-01-01') && a !== f('dueOver|card|abd|2026-01-01'),
      heltall: Number.isInteger(a) && a >= 0 && a <= 0x7fffffff,
      spredning: new Set([...Array(500)].map((_, i) => f('dueOver|item|x' + i + '|2026-01-01'))).size,
    };
  });
  log('1a: samme nøkkel gir samme native ID', ider.stabil);
  log('1b: ulike nøkler gir ulike ID-er', ider.ulik);
  log('1c: ID-en er et positivt 31-bits heltall (Androids varsel-ID er et int)', ider.heltall);
  log('1d: 500 nøkler gir 500 ulike ID-er', ider.spredning === 500, ider.spredning);

  /* ---------- 2) Adapteren ---------- */
  log('2a: kanalen er den native når pluginbroen finnes',
    (await pn.evaluate(() => window.__huskis.notifChannel().id)) === 'native');
  log('2b: ingen tillatelse er spurt om av seg selv ved oppstart',
    (await pn.evaluate(() => window.__kanal.spurt)) === 0);
  log('2c: … og ingenting er planlagt før brukeren har slått kanalen på',
    (await pn.evaluate(() => window.__kanal.schedule.length)) === 0);

  await pn.evaluate(() => window.__huskis.setNotifChannel(true));
  await pn.waitForFunction(() => window.__kanal.schedule.length > 0, null, { timeout: 8000, polling: 100 });
  const s1 = await pn.evaluate(() => window.__kanal.schedule[0]);
  log('2d: bryteren er det som utløser systemdialogen — nøyaktig én gang',
    (await pn.evaluate(() => window.__kanal.spurt)) === 1);
  log('2e: planen ble speilet ut som native varsler', s1.length > 0, s1.length + ' varsler');
  log('2f: overskriften er objektets navn, kroppen er varseltypen i klartekst',
    s1.every((n) => n.title === 'Tannlegetime') &&
    s1.some((n) => n.body === 'Frist utløpt') && s1.some((n) => n.body === 'Frist om mindre enn en uke'),
    JSON.stringify(s1.map((n) => n.title + ' / ' + n.body)));
  log('2g: teksten bærer ingen sti og ingen id-er',
    s1.every((n) => !/›/.test(n.title + n.body) && !/[0-9a-f]{8}-/.test(n.title + n.body)));
  log('2h: alarmen er UPRESIS — appen ber aldri om SCHEDULE_EXACT_ALARM',
    s1.every((n) => n.isExactNotification === false && n.schedule.allowWhileIdle === true),
    JSON.stringify(s1[0].schedule));
  log('2i: tidspunktet er terskelens, som ISO-streng (pluginens eget format)',
    s1.every((n) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(n.schedule.at) &&
      new Date(n.schedule.at).getTime() > Date.now()), s1[0].schedule.at);
  log('2j: varselet bærer pekeren til objektet, ikke noe mer',
    s1.every((n) => n.extra.objId && n.extra.objType && n.extra.key &&
      Object.keys(n.extra).length === 3), JSON.stringify(s1[0].extra));
  log('2k: ID-en er den deterministiske fra nøkkelen',
    await pn.evaluate((ns) => ns.every((n) => n.id === window.__huskis.nativeNotifId(n.extra.key)), s1));

  // Ny runde med samme plan: ingenting skal skje.
  await pn.evaluate(() => { window.__kanal.schedule.length = 0; window.__kanal.cancel.length = 0; });
  await cycle(pn);
  await pn.waitForTimeout(300);
  log('2l: en ny synk-runde med uendret plan planlegger ingenting på nytt',
    (await pn.evaluate(() => window.__kanal.schedule.length)) === 0 &&
    (await pn.evaluate(() => window.__kanal.cancel.length)) === 0);

  // Fullfør listepunktet: planen forsvinner, og de native varslene avlyses.
  await pn.evaluate((iid) => {
    const H = window.__huskis;
    const c = H.state.universes[0].groups[0].cards[0];
    c.items.find((i) => i.id === iid).done = true;
    H.save();
  }, id.IA);
  await cycle(pn);
  await cycle(pn);
  await pn.waitForTimeout(300);
  const avlyst = await pn.evaluate(() => ({ cancel: window.__kanal.cancel.flat().length,
    pending: window.__kanal.pending.length }));
  log('2m: fullføring avlyser den native planen', avlyst.cancel > 0 && avlyst.pending === 0,
    JSON.stringify(avlyst));

  /* ---------- 3) Trykk på et native varsel ---------- */
  await pn.evaluate((iid) => {
    const H = window.__huskis;
    const c = H.state.universes[0].groups[0].cards[0];
    c.items.find((i) => i.id === iid).done = false;
    H.save();
  }, id.IA);
  const truffet = await pn.evaluate(async (lid) => {
    window.__kanal.trykk({ notification: { extra: { objType: 'card', objId: lid } } });
    await new Promise((r) => setTimeout(r, 400));
    const el = document.querySelector('.nav-flash, [data-id="' + lid + '"]');
    return { flash: !!document.querySelector('.nav-flash'), finnes: !!el };
  }, id.LA);
  log('3: et trykk på varselet navigerer til objektet', truffet.finnes, JSON.stringify(truffet));

  await ctxN.close();

  /* ================= Nettleser: uten avsendernøkkel ================= */
  const ctxU = await nyKontekst(browser);
  const pu = await ctxU.newPage();
  pu.on('pageerror', (e) => errs.push('utenNøkkel: ' + e.message));
  await seed(pu, BASE + '/?mock=1&ch=web&nokkel=0', buildDB(due));
  log('4a: uten avsendernøkkel finnes web push-kanalen ikke',
    (await pu.evaluate(() => window.__huskis.notifChannel())) === null);
  const utenNøkkelPanel = await pu.evaluate(async () => {
    window.__huskis.openNotifModal();
    document.getElementById('notif-settings-btn').click();
    await window.__huskis.refreshNotifChannelState();
    await new Promise((r) => setTimeout(r, 150));
    return {
      bryter: !!document.getElementById('notif-channel-toggle'),
      note: document.getElementById('notif-channel-note').textContent,
    };
  });
  log('4b: panelet sier fra i stedet for å vise en bryter som ikke kan virke',
    utenNøkkelPanel.bryter === false &&
    /kan ikke vise varsler utenfor Huskis/.test(utenNøkkelPanel.note), JSON.stringify(utenNøkkelPanel));
  await ctxU.close();

  /* ================= Nettleser: web push ================= */
  const ctxW = await nyKontekst(browser);
  const pw = await ctxW.newPage();
  pw.on('pageerror', (e) => errs.push('web: ' + e.message));
  const WURL = BASE + '/?mock=1&ch=web';
  await seed(pw, WURL, buildDB(due));

  log('4c: kanalen er nettleserens når det ikke finnes en native runtime',
    (await pw.evaluate(() => window.__huskis.notifChannel().id)) === 'web');
  log('4d: ingen tillatelse er spurt om av seg selv, og ingen service worker er registrert',
    (await pw.evaluate(() => window.__kanal.spurt)) === 0 &&
    (await pw.evaluate(() => window.__kanal.registrerte)) === undefined);

  await pw.evaluate(() => window.__huskis.setNotifChannel(true));
  await pw.waitForFunction(() => window.HK_MOCK._loadDB().push_subscriptions.length > 0,
    null, { timeout: 8000, polling: 100 });
  const w1 = await db(pw);
  log('4e: bryteren spør om tillatelse og registrerer service workeren',
    (await pw.evaluate(() => window.__kanal.spurt)) === 1 &&
    (await pw.evaluate(() => window.__kanal.registrerte)) === 'sw.js');
  log('4f: påmeldingen lover et SYNLIG varsel og bruker avsendernøkkelen',
    await pw.evaluate(() => window.__kanal.subscribe.userVisibleOnly === true &&
      window.__kanal.subscribe.nøkkelLengde === 65));
  const sub = w1.push_subscriptions[0];
  log('4g: abonnementet ligger på brukeren, med endepunkt og nøkler',
    sub.user_id === uid && /^https:\/\/push\.test\//.test(sub.endpoint) && !!sub.p256dh && !!sub.auth,
    JSON.stringify({ endpoint: sub.endpoint, tz: sub.tz }));
  log('4h: … og bærer de fire typetekstene på brukerens språk (service workeren har ingen ordbok)',
    sub.labels.dueOver === 'Frist utløpt' && sub.labels.startSoon === 'Begynner om mindre enn en uke',
    JSON.stringify(sub.labels));
  log('4i: utboksen fikk en levering per planlagt varsel',
    w1.push_deliveries.length === w1.notifications.filter((n) => n.at > Date.now()).length,
    w1.push_deliveries.length + ' leveringer');

  // Fornyelse: en ny runde skal ikke lage et abonnement til.
  await cycle(pw);
  log('4j: en ny synk-runde fornyer abonnementet i stedet for å lage et nytt',
    (await db(pw)).push_subscriptions.length === 1);

  // Av igjen.
  await pw.evaluate(() => window.__huskis.setNotifChannel(false));
  await pw.waitForFunction(() => window.HK_MOCK._loadDB().push_subscriptions.length === 0,
    null, { timeout: 8000, polling: 100 });
  const w2 = await db(pw);
  log('4k: å slå av fjerner abonnementet fra serveren og avregistrerer service workeren',
    w2.push_subscriptions.length === 0 && (await pw.evaluate(() => window.__kanal.avregistrert)) === true);
  log('4l: … og leveringene som lå og ventet forsvinner med det',
    w2.push_deliveries.length === 0, w2.push_deliveries.length);
  log('4m: historikken og planen er urørt — kanalen er en LEVERING, ikke modellen',
    w2.notifications.length === w1.notifications.length,
    w2.notifications.length + ' av ' + w1.notifications.length);

  /* ---------- 5) Blokkert tillatelse ---------- */
  await pw.evaluate(() => { window.__kanal.svar = 'denied'; });
  await pw.evaluate(() => window.__huskis.setNotifChannel(true));
  await pw.waitForFunction(() => window.__huskis.notifChState === 'denied',
    null, { timeout: 8000, polling: 100 });
  const blokkert = await pw.evaluate(async () => {
    const spurtFør = window.__kanal.spurt;
    window.__huskis.openNotifModal();
    document.getElementById('notif-settings-btn').click();
    await window.__huskis.refreshNotifChannelState();
    await new Promise((r) => setTimeout(r, 150));
    const t = document.getElementById('notif-channel-toggle');
    t.click();                                   // et nytt trykk skal ikke mase
    await new Promise((r) => setTimeout(r, 200));
    return { deaktivert: t.disabled, note: document.getElementById('notif-channel-note').textContent,
      nyeSpørsmål: window.__kanal.spurt - spurtFør, abo: window.HK_MOCK._loadDB().push_subscriptions.length };
  });
  log('5a: en avvist tillatelse gir ikke et abonnement', blokkert.abo === 0);
  log('5b: bryteren er deaktivert og teksten peker på enhetens innstillinger',
    blokkert.deaktivert === true && /[Bb]lokkert/.test(blokkert.note), JSON.stringify(blokkert.note));
  log('5c: … og et nytt trykk maser ikke med en ny systemdialog',
    blokkert.nyeSpørsmål === 0, blokkert.nyeSpørsmål);

  /* ---------- 6) Panelet ---------- */
  await pw.evaluate(() => { window.__kanal.svar = 'granted'; window.__kanal.perm = 'prompt'; });
  const panel = await pw.evaluate(async () => {
    await window.__huskis.refreshNotifChannelState();
    await new Promise((r) => setTimeout(r, 150));
    const rader = [...document.querySelectorAll('#notif-body .menu-setting')];
    return {
      antall: rader.length,
      siste: rader[rader.length - 1].querySelector('.menu-setting-label span:last-child').textContent,
      note: document.getElementById('notif-channel-note').textContent,
      typer: rader.slice(0, 4).map((r) => r.querySelector('.toggle-switch').getAttribute('aria-checked')),
      beskriver: document.getElementById('notif-channel-toggle').getAttribute('aria-describedby'),
    };
  });
  log('6a: kanalen er en femte rad under de fire typene',
    panel.antall === 5 && panel.siste === 'Varsler på denne enheten', JSON.stringify(panel.siste));
  log('6b: teksten under bryteren forklarer tillatelsen FØR den spørres om',
    /Enheten spør om tillatelse når du slår det på/.test(panel.note), JSON.stringify(panel.note));
  log('6c: … og er knyttet til bryteren for skjermlesere',
    panel.beskriver === 'notif-channel-note');
  log('6d: de fire typebryterne er urørt av kanalen',
    panel.typer.every((v) => v === 'true'), JSON.stringify(panel.typer));

  await pw.evaluate(() => window.__huskis.setNotifChannel(true));
  await pw.waitForFunction(() => window.__huskis.notifChState === 'on', null, { timeout: 8000, polling: 100 });
  const påTekst = await pw.evaluate(async () => {
    await new Promise((r) => setTimeout(r, 200));
    return document.getElementById('notif-channel-note').textContent;
  });
  log('6e: er kanalen på, sier teksten hva den faktisk gjør',
    /når Huskis er lukket/.test(påTekst), JSON.stringify(påTekst));
  await pw.evaluate(() => window.__huskis.closeNotifModal());

  await swSjekker();

  /* ---------- 8) `?notif=` i adressen ---------- */
  await pw.goto(WURL + '&notif=' + encodeURIComponent('card:' + id.LA));
  await pw.waitForFunction(() => {
    const H = window.__huskis;
    return H && H.authUser && H.lastMy && H.state.universes.length > 0;
  }, null, { timeout: 15000, polling: 200 });
  await pw.waitForTimeout(600);
  const rute = await pw.evaluate((lid) => ({
    adresse: location.search,
    fant: !!document.querySelector('[data-id="' + lid + '"]'),
  }), id.LA);
  log('8a: pekeren i adressen navigerer til objektet', rute.fant, JSON.stringify(rute));
  log('8b: … og fjernes fra adressen, så en reload ikke navigerer igjen',
    rute.adresse.indexOf('notif=') === -1, rute.adresse);

  await ctxW.close();
  log('ingen JS-feil', errs.length === 0, errs.join(' | ') || 'ingen');
  await browser.close();
}

run().then(() => {
  const ok = results.filter(Boolean).length;
  console.log('\n==== ' + ok + '/' + results.length + ' PASS ====');
  process.exit(ok === results.length ? 0 : 1);
}).catch((e) => { console.error(e); process.exit(1); });
