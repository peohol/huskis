/*
  Nettlesertest for AUTOMATISK KLIENT-OPPDATERING (update-check.js +
  __huskis.updateSafety()). Kjøres mot mock-backenden (?mock=1) på både
  desktop- og mobil-viewport.

  Del A — oppdateringsmotoren med injiserte avhengigheter (falsk klokke, falsk
  fetch, falsk reload/sessionStorage), så testene er uavhengige av ekte tid,
  nett og Vercel:
     • oppdager en annen build-ID, reagerer ikke på samme build-ID
     • cachefri forespørsel (cache: no-store + cache-bustende parameter)
     • samtidige kontroller dedupliseres til én forespørsel
     • offline, nettverksfeil, HTTP-feil og ugyldig JSON håndteres STILLE
     • automatisk reload når fanen er skjult og tilstanden er trygg
     • ingen reload når tilstanden ikke er trygg — men den utsatte reloaden
       gjennomføres når den blir trygg
     • inaktivitetsgrensen (60 s) og utsettelse ved brukeraktivitet
     • maks ETT automatisk forsøk per mål-build per fane (ingen reload-løkke)
     • kontrollene som fyres av synlighet/fokus/pageshow/online/poll
     • banneret: tilgjengelig, ikke-modalt, stjeler ikke fokus
     • stop() rydder timere, lyttere og banner

  Del B — integrasjon mot den EKTE appen: updateSafety() sier «nei» under
  redigering, åpen modal og buffret sletting, og «ja» igjen når alt er lagret —
  og den utsatte reloaden skjer først da.

  Kjør:
    python3 -m http.server 8000
    NODE_PATH=$(npm root -g) node tests/auto-update.test.js
*/
const { chromium } = require(require('path').join(process.env.NODE_PATH || require('child_process').execSync('npm root -g').toString().trim(), 'playwright'));
const BASE = process.env.HUSKIS_URL || 'http://localhost:8000';

let passed = 0, failed = 0;
function check(name, cond) { if (cond) { passed++; } else { failed++; console.log('  ✗ FAIL:', name); } }

const U = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16); });

function buildDB() {
  const uid = 'uMe';
  const PU = U(), PG = U(), PL = U(), PI = U(), PI2 = U();
  const base = (extra) => Object.assign({ trashed: false, locked: false, unlocked: false,
    invite_policy: 'inherit', ts: 1, org: 'a', pos: 0, pos_ts: 0, pos_org: '' }, extra);
  return {
    ids: { uid, PU, PG, PL, PI, PI2 },
    db: {
      profiles: [{ id: uid, email: 'me@x.no', display_name: 'Meg Selv', user_metadata: {} }],
      passwords: { 'me@x.no': 'x' },
      universes: [base({ id: PU, owner_id: uid, name: 'Mitt område' })],
      groups: [base({ id: PG, owner_id: uid, universe_id: PU, name: 'Min mappe' })],
      cards: [base({ id: PL, owner_id: uid, group_id: PG, title: 'Min liste', k: true, p: true, lab_ts: 0, lab_org: '' })],
      items: [base({ id: PI, owner_id: uid, card_id: PL, text: 'Punkt 1' }),
              base({ id: PI2, owner_id: uid, card_id: PL, text: 'Punkt 2', pos: 1 })],
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
    sessionStorage.setItem('hk-mock-session', JSON.stringify({ id: 'uMe', email: 'me@x.no', user_metadata: { onboarding: { v: 3, status: 'done' }, tips: { drag: true, trash: true, moveList: true } } }));
  }, db);
  await page.goto(BASE + '/?mock=1');
  await page.waitForFunction(() => {
    const H = window.__huskis;
    return H && H.authUser && H.lastMy && H.state.universes.length > 0;
  }, null, { timeout: 8000, polling: 200 });
}

/* ---------------- Del A: motoren med injiserte avhengigheter ---------------- */
async function engineScenario(page) {
  return page.evaluate(async () => {
    const out = {};
    const H = window.HuskisUpdate;
    const flush = async () => { for (let i = 0; i < 8; i++) await new Promise(r => window.setTimeout(r, 0)); };

    // Falsk klokke: setTimeout/clearTimeout/now under vår kontroll.
    function mkClock(t0) {
      const c = { t: t0 || 100000, timers: [], seq: 1 };
      c.setTimeout = (fn, ms) => { const id = c.seq++; c.timers.push({ id, at: c.t + (ms || 0), fn }); return id; };
      c.clearTimeout = (id) => { c.timers = c.timers.filter(x => x.id !== id); };
      c.advance = (ms) => {
        const end = c.t + ms;
        for (let guard = 0; guard < 5000; guard++) {
          let next = null;
          for (const x of c.timers) if (x.at <= end && (!next || x.at < next.at)) next = x;
          if (!next) break;
          c.timers = c.timers.filter(x => x !== next);
          c.t = next.at; next.fn();
        }
        c.t = end;
      };
      return c;
    }
    function mkFetch(plan) {
      const f = (url, init) => { f.calls.push({ url: url, init: init }); return Promise.resolve().then(() => plan(f.calls.length)); };
      f.calls = [];
      return f;
    }
    const okJson = (obj) => ({ ok: true, json: () => Promise.resolve(obj) });
    function mkStore() {
      const m = {};
      return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); } };
    }
    // Standardoppsett: build «A» kjører, «B» ligger på serveren.
    function mk(opts) {
      const o = opts || {};
      const clock = o.clock || mkClock();
      const fetchImpl = o.fetch || mkFetch(() => okJson({ buildId: 'B', version: '1.0.0', builtAt: new Date(0).toISOString() }));
      const rl = { n: 0 };
      const cfg = Object.assign({
        buildId: 'A',
        fetch: fetchImpl,
        now: () => clock.t,
        setTimeout: clock.setTimeout,
        clearTimeout: clock.clearTimeout,
        reload: () => { rl.n++; },
        isSafe: o.safe || (() => true),
        isHidden: o.hidden || (() => true),
        isOnline: o.online || (() => true),
        channelName: null,          // egen kanal-test er ikke poenget her
        initialDelayMs: 0,
      }, o.extra || {});
      // 'real' = ikke sett feltet, så modulen bruker ekte sessionStorage.
      // (`storage: null` slippes gjennom som null — «ingen lagring».)
      if (o.storage !== 'real') cfg.storage = ('storage' in o) ? o.storage : mkStore();
      return { inst: H.create(cfg), clock, fetchImpl, rl };
    }

    /* 1) Oppdager en annen build-ID. */
    {
      const e = mk({ hidden: () => false, safe: () => false });
      e.inst.start(); e.clock.advance(1); await flush();
      out.detectTarget = e.inst.target === 'B';
      out.detectBanner = !!document.getElementById('update-banner');
      out.detectNoReload = e.rl.n === 0;
      e.inst.stop();
    }

    /* 2) Ingen reaksjon når build-ID-ene er like. */
    {
      const e = mk({ fetch: mkFetch(() => okJson({ buildId: 'A' })), hidden: () => false });
      e.inst.start(); e.clock.advance(1); await flush();
      out.sameNoTarget = e.inst.target === null;
      out.sameNoBanner = !document.getElementById('update-banner');
      out.sameNoReload = e.rl.n === 0;
      e.inst.stop();
    }

    /* 3) Cachefri forespørsel. */
    {
      const e = mk({ safe: () => false });
      e.inst.start(); e.clock.advance(1); await flush();
      await e.inst.check(); await flush();
      const c = e.fetchImpl.calls;
      out.noStore = c.length >= 2 && c.every(x => x.init && x.init.cache === 'no-store');
      out.bustParam = c.every(x => /[?&]b=/.test(x.url)) && c[0].url !== c[1].url;
      out.sameOrigin = c.every(x => x.url.indexOf('/version.json') === 0);
      e.inst.stop();
    }

    /* 4) Samtidige kontroller dedupliseres. */
    {
      const e = mk({ safe: () => false });
      const p1 = e.inst.check(), p2 = e.inst.check(), p3 = e.inst.check();
      const rs = await Promise.all([p1, p2, p3]);
      out.dedupOneCall = e.fetchImpl.calls.length === 1;
      out.dedupSameResult = rs.every(r => r === 'B');
      await e.inst.check();   // etterpå kan en NY kontroll kjøre
      out.dedupReleases = e.fetchImpl.calls.length === 2;
      e.inst.stop();
    }

    /* 5) Offline, nettverksfeil, HTTP-feil og ugyldig JSON — stille. */
    {
      const e = mk({ online: () => false });
      await e.inst.check(); await flush();
      out.offlineNoFetch = e.fetchImpl.calls.length === 0;
      out.offlineNoBanner = !document.getElementById('update-banner');
      e.inst.stop();

      const cases = {
        netErr: () => { throw new Error('Failed to fetch'); },
        httpErr: () => ({ ok: false, json: () => Promise.resolve({ buildId: 'B' }) }),
        badJson: () => ({ ok: true, json: () => Promise.reject(new SyntaxError('Unexpected token <')) }),
        emptyObj: () => okJson({}),
        arrayBody: () => okJson([{ buildId: 'B' }]),
        numberId: () => okJson({ buildId: 42 }),
        blankId: () => okJson({ buildId: '   ' }),
        nullBody: () => okJson(null),
      };
      out.silent = {};
      for (const k of Object.keys(cases)) {
        const q = mk({ fetch: mkFetch(cases[k]) });
        let threw = false;
        try { await q.inst.check(); } catch (err) { threw = true; }
        await flush();
        out.silent[k] = !threw && q.inst.target === null && q.rl.n === 0 && !document.getElementById('update-banner');
        q.inst.stop();
      }
    }

    /* 6) Skjult fane + trygg tilstand → automatisk reload. */
    {
      const e = mk({ hidden: () => true, safe: () => true });
      e.inst.start(); e.clock.advance(1); await flush();
      out.hiddenSafeReload = e.rl.n === 1;
      e.inst.stop();
    }

    /* 7) Ikke trygg → ingen reload, og banneret forklarer ventingen. */
    {
      const e = mk({ hidden: () => true, safe: () => false });
      e.inst.start(); e.clock.advance(1); await flush();
      e.clock.advance(120000); await flush();
      out.unsafeNoReload = e.rl.n === 0;
      const note = document.querySelector('#update-banner .update-banner-note');
      out.unsafeNote = !!note && note.hidden === false && /lagret/.test(note.textContent);
      e.inst.stop();
    }

    /* 8) Utsatt reload: gjennomføres når tilstanden senere blir trygg. */
    {
      const safe = { v: false };
      const e = mk({ hidden: () => true, safe: () => safe.v });
      e.inst.start(); e.clock.advance(1); await flush();
      e.clock.advance(30000); await flush();
      out.deferredWaits = e.rl.n === 0;
      safe.v = true;
      e.clock.advance(6000); await flush();
      out.deferredRuns = e.rl.n === 1;
      const note = document.querySelector('#update-banner .update-banner-note');
      out.safeNoteHidden = !!note && note.hidden === true;
      e.inst.stop();
    }

    /* 9) Inaktivitetsgrense (60 s) og utsettelse ved brukeraktivitet. */
    {
      const e = mk({ hidden: () => false, safe: () => true });
      e.inst.start(); e.clock.advance(1); await flush();
      out.visibleNoInstantReload = e.rl.n === 0;
      e.clock.advance(30000); await flush();
      out.visibleWaitsUnderIdle = e.rl.n === 0;
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));  // aktivitet ved t≈30 s
      e.clock.advance(45000); await flush();
      out.activityDefers = e.rl.n === 0;
      e.clock.advance(30000); await flush();                               // 75 s siden aktiviteten
      out.idleReloads = e.rl.n === 1;
      e.inst.stop();
    }

    /* 10) Maks ett automatisk forsøk per mål-build (ekte sessionStorage). */
    {
      sessionStorage.removeItem('huskis:auto-reload-build');
      const build = { id: 'B' };
      const e = mk({ hidden: () => true, safe: () => true, storage: 'real',
        fetch: mkFetch(() => okJson({ buildId: build.id })) });
      e.inst.start(); e.clock.advance(1); await flush();
      out.attemptOnce = e.rl.n === 1;
      out.attemptStored = sessionStorage.getItem('huskis:auto-reload-build') === 'B';
      // Den gamle klienten kjører fortsatt (reload-en var en attrapp): flere
      // runder skal IKKE gi flere forsøk — men banneret skal stå.
      for (let i = 0; i < 5; i++) { await e.inst.check(); e.clock.advance(20000); await flush(); }
      out.attemptNoLoop = e.rl.n === 1;
      out.attemptBannerStays = !!document.getElementById('update-banner');
      // En NY mål-build får sitt eget ene forsøk.
      build.id = 'C';
      await e.inst.check(); await flush();
      out.newTargetNewAttempt = e.rl.n === 2 && sessionStorage.getItem('huskis:auto-reload-build') === 'C';
      e.inst.stop();
      sessionStorage.removeItem('huskis:auto-reload-build');

      // Uten lagring (privat modus/blokkert/full kvote) kan ett-forsøk-regelen
      // ikke garanteres → ingen AUTOMATISK reload i det hele tatt, men banneret
      // og «Oppdater nå» står.
      const blocked = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
      for (const store of [null, blocked]) {
        const q = mk({ hidden: () => true, safe: () => true, storage: store });
        q.inst.start(); q.clock.advance(1); await flush();
        q.clock.advance(60000); await flush();
        const key = store === null ? 'noStorage' : 'throwingStorage';
        const btn = document.querySelector('#update-banner .update-banner-btn');
        out[key + 'NoAutoReload'] = q.rl.n === 0 && !!btn;
        btn.click(); await flush();
        out[key + 'ManualWorks'] = q.rl.n === 1;
        q.inst.stop();
      }
    }

    /* 11) Når kontrollene fyres: pageshow, synlighet, fokus, online, poll. */
    {
      const hidden = { v: false };
      const e = mk({ hidden: () => hidden.v, safe: () => false });
      e.inst.start(); e.clock.advance(1); await flush();
      const n0 = e.fetchImpl.calls.length;
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
      await flush();
      out.pageshowChecks = e.fetchImpl.calls.length === n0 + 1;
      window.dispatchEvent(new Event('online')); await flush();
      out.onlineChecks = e.fetchImpl.calls.length === n0 + 2;
      window.dispatchEvent(new Event('focus')); await flush();
      out.focusChecks = e.fetchImpl.calls.length === n0 + 3;
      document.dispatchEvent(new Event('visibilitychange')); await flush();
      out.visibleChecks = e.fetchImpl.calls.length === n0 + 4;
      const n1 = e.fetchImpl.calls.length;
      e.clock.advance(10 * 60 * 1000 + 10); await flush();
      out.pollChecks = e.fetchImpl.calls.length === n1 + 1;
      hidden.v = true;                       // skjult fane poller ikke
      const n2 = e.fetchImpl.calls.length;
      e.clock.advance(10 * 60 * 1000 + 10); await flush();
      out.hiddenNoPoll = e.fetchImpl.calls.length === n2;
      e.inst.stop();
    }

    /* 12) Banneret: tilgjengelig, ikke-modalt, stjeler ikke fokus. */
    {
      document.body.focus();
      const before = document.activeElement;
      const e = mk({ hidden: () => false, safe: () => false });
      e.inst.start(); e.clock.advance(1); await flush();
      const b = document.getElementById('update-banner');
      const btn = b && b.querySelector('.update-banner-btn');
      const msg = b && b.querySelector('.update-banner-msg');
      out.bannerRole = !!b && b.getAttribute('role') === 'status';
      out.bannerLive = !!b && b.getAttribute('aria-live') === 'polite';
      out.bannerMsg = !!msg && msg.textContent === 'En ny versjon av Huskis er tilgjengelig.';
      out.bannerBtn = !!btn && btn.tagName === 'BUTTON' && btn.textContent === 'Oppdater nå' &&
        btn.type === 'button' && btn.tabIndex >= 0;
      out.bannerNoFocusSteal = document.activeElement === before;
      out.bannerNotModal = !b.hasAttribute('aria-modal') && !document.querySelector('.update-banner[role="dialog"]');
      out.bannerVisible = !!b && getComputedStyle(b).opacity === '1' && b.getBoundingClientRect().width > 0;
      // «Oppdater nå» laster uansett trygghet og ett-forsøk-vakt — brukeren ba om det.
      btn.click(); await flush();
      out.bannerBtnReloads = e.rl.n === 1;
      btn.focus();
      out.bannerBtnFocusable = document.activeElement === btn;
      e.inst.stop();
    }

    /* 13) Opprydding: timere, lyttere og banner. */
    {
      const e = mk({ hidden: () => false, safe: () => false });
      e.inst.start(); e.clock.advance(1); await flush();
      const before = e.fetchImpl.calls.length;
      out.cleanupHadListeners = e.inst.listenerCount > 0;
      out.cleanupHadTimers = e.clock.timers.length > 0;
      e.inst.stop();
      out.cleanupListeners = e.inst.listenerCount === 0;
      out.cleanupTimers = e.clock.timers.length === 0;
      out.cleanupBanner = !document.getElementById('update-banner');
      window.dispatchEvent(new Event('online'));
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: false }));
      window.dispatchEvent(new Event('focus'));
      document.dispatchEvent(new Event('visibilitychange'));
      e.clock.advance(60 * 60 * 1000);
      await flush();
      out.cleanupNoMoreFetches = e.fetchImpl.calls.length === before;
      out.cleanupCheckIsNoop = (await e.inst.check()) === '' && e.fetchImpl.calls.length === before;
    }

    /* 14) Flere faner: en ny build meldt over BroadcastChannel gir banner. */
    {
      const e = mk({ hidden: () => false, safe: () => false, extra: { channelName: 'huskis-update-test' } });
      e.inst.start();
      const peer = new BroadcastChannel('huskis-update-test');
      peer.postMessage({ type: 'huskis-build', buildId: 'Z' });
      await flush(); await new Promise(r => window.setTimeout(r, 60));
      out.peerTarget = e.inst.target === 'Z';
      out.peerBanner = !!document.getElementById('update-banner');
      peer.close(); e.inst.stop();
    }

    return out;
  });
}

/* ---------------- Del B: integrasjon mot den ekte appen ---------------- */
async function safetyScenario(page, ids) {
  // Utgangspunktet: alt er synket → trygt.
  await page.waitForFunction(() => window.__huskis && window.__huskis.updateSafety().safe, null, { timeout: 8000 })
    .catch(() => {});
  check('B: idle + ferdig synket = trygt', await page.evaluate(() => window.__huskis.updateSafety().safe));

  // Åpen modal (nav) = utrygt.
  await page.evaluate(() => window.__huskis.openNavModal());
  await page.waitForTimeout(150);
  let s = await page.evaluate(() => window.__huskis.updateSafety());
  check('B: åpen modal = utrygt («modal»)', s.safe === false && s.reason === 'modal');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);

  // Inline redigering = utrygt.
  await page.locator('.card .item .item-text').first().click();
  await page.waitForTimeout(250);
  s = await page.evaluate(() => window.__huskis.updateSafety());
  check('B: inline redigering = utrygt («editing»)', s.safe === false && s.reason === 'editing');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);

  // Buffret sletting = utrygt til bufferet er committet og synket.
  await page.locator('.card .item .obj-menu-btn').first().click();
  await page.waitForTimeout(250);
  await page.locator('#obj-menu-panel .obj-menu-row', { hasText: 'Slett listepunktet' }).click();
  await page.waitForTimeout(500); // fly-i-søpla-animasjonen
  s = await page.evaluate(() => window.__huskis.updateSafety());
  check('B: buffret sletting = utrygt («pending-delete»)', s.safe === false && s.reason === 'pending-delete');

  // Selve poenget: den utsatte reloaden skjer først når alt er lagret. Ekte
  // updateSafety(), ekte timere (korte), attrapp-reload.
  const r = await page.evaluate(async () => {
    const rl = { n: 0, reasons: [] };
    const mem = {};
    const inst = window.HuskisUpdate.create({
      buildId: 'gammel-build',
      fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve({ buildId: 'ny-build' }) }),
      reload: () => { rl.n++; },
      isHidden: () => true,          // skjult fane: kun trygghet avgjør
      storage: { getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = v; } },
      channelName: null,
      safetyPollMs: 150,
      initialDelayMs: 0,
      pollMs: 0,
    });
    inst.start();
    await inst.check();
    rl.reasons.push(window.__huskis.updateSafety().reason);
    const early = rl.n;                                   // ennå ikke trygt
    await new Promise(r => setTimeout(r, 9000));          // slettebuffer (5 s) + synk
    const after = rl.n;
    rl.reasons.push(window.__huskis.updateSafety().reason);
    const banner = !!document.getElementById('update-banner');
    inst.stop();
    return { early, after, banner, reasons: rl.reasons, target: inst.target };
  });
  check('B: oppdaget ny build og viste banner', r.target === 'ny-build' && r.banner);
  check('B: ingen reload mens slettingen lå i bufferet', r.early === 0);
  check('B: reload gjennomført først da tilstanden ble trygg (' + r.reasons.join(' → ') + ')', r.after === 1);

  // Offline = alltid utrygt.
  await page.context().setOffline(true);
  await page.waitForTimeout(200);
  s = await page.evaluate(() => window.__huskis.updateSafety());
  check('B: offline = utrygt', s.safe === false && s.reason === 'offline');
  await page.context().setOffline(false);
  await page.waitForTimeout(300);
}

async function scenario(page, viewport, label) {
  console.log('\n== ' + label + ' ==');
  const s = buildDB();
  await load(page, s.db, viewport);

  check('auto-start er AV uten en ekte build-ID (lokal utvikling)',
    await page.evaluate(() => window.HuskisUpdate.instance === null && window.HuskisUpdate.readBuildId(document) === ''));

  const a = await engineScenario(page);
  check('A: oppdager en annen build-ID', a.detectTarget);
  check('A: viser banner ved ny build', a.detectBanner);
  check('A: ny build alene utløser ikke reload når det er utrygt', a.detectNoReload);
  check('A: ingen mål-build når ID-ene er like', a.sameNoTarget);
  check('A: ingen banner når ID-ene er like', a.sameNoBanner);
  check('A: ingen reload når ID-ene er like', a.sameNoReload);
  check('A: forespørselen bruker cache: no-store', a.noStore);
  check('A: cache-bustende parameter, ny per kontroll', a.bustParam);
  check('A: henter fra samme origin (rot-relativ /version.json)', a.sameOrigin);
  check('A: samtidige kontroller gir én forespørsel', a.dedupOneCall);
  check('A: alle samtidige kall får samme svar', a.dedupSameResult);
  check('A: dedup slipper taket etter at forespørselen er ferdig', a.dedupReleases);
  check('A: offline gir ingen forespørsel', a.offlineNoFetch);
  check('A: offline gir ingen banner', a.offlineNoBanner);
  Object.keys(a.silent).forEach((k) => check('A: stille håndtering — ' + k, a.silent[k]));
  check('A: skjult fane + trygt → automatisk reload', a.hiddenSafeReload);
  check('A: utrygt → ingen reload', a.unsafeNoReload);
  check('A: utrygt → banneret forklarer ventingen', a.unsafeNote);
  check('A: utsatt reload venter', a.deferredWaits);
  check('A: utsatt reload gjennomføres når det blir trygt', a.deferredRuns);
  check('A: forklaringen forsvinner når det er trygt', a.safeNoteHidden);
  check('A: synlig fane reloader ikke umiddelbart', a.visibleNoInstantReload);
  check('A: synlig fane venter ut inaktivitetsgrensen', a.visibleWaitsUnderIdle);
  check('A: brukeraktivitet utsetter reload', a.activityDefers);
  check('A: reload etter 60 s inaktivitet', a.idleReloads);
  check('A: ett automatisk forsøk per mål-build', a.attemptOnce);
  check('A: forsøket registreres i sessionStorage', a.attemptStored);
  check('A: ingen reload-løkke når klienten fortsatt er gammel', a.attemptNoLoop);
  check('A: banneret står igjen etter et brukt forsøk', a.attemptBannerStays);
  check('A: en ny mål-build får sitt eget ene forsøk', a.newTargetNewAttempt);
  check('A: uten sessionStorage: ingen automatisk reload', a.noStorageNoAutoReload);
  check('A: uten sessionStorage: «Oppdater nå» virker fortsatt', a.noStorageManualWorks);
  check('A: sessionStorage som kaster: ingen automatisk reload', a.throwingStorageNoAutoReload);
  check('A: sessionStorage som kaster: «Oppdater nå» virker fortsatt', a.throwingStorageManualWorks);
  check('A: pageshow (inkl. bfcache) kontrollerer', a.pageshowChecks);
  check('A: online kontrollerer', a.onlineChecks);
  check('A: fokus kontrollerer', a.focusChecks);
  check('A: fanen blir synlig → kontrollerer', a.visibleChecks);
  check('A: poll ca. hvert tiende minutt', a.pollChecks);
  check('A: skjult fane poller ikke', a.hiddenNoPoll);
  check('A: banneret har role="status"', a.bannerRole);
  check('A: banneret har aria-live="polite"', a.bannerLive);
  check('A: banneret har riktig melding', a.bannerMsg);
  check('A: knappen er en ekte, tastaturtilgjengelig <button>', a.bannerBtn);
  check('A: banneret stjeler ikke fokus', a.bannerNoFocusSteal);
  check('A: banneret er ikke modalt', a.bannerNotModal);
  check('A: banneret er synlig', a.bannerVisible);
  check('A: «Oppdater nå» laster på nytt', a.bannerBtnReloads);
  check('A: knappen kan fokuseres med tastatur', a.bannerBtnFocusable);
  check('A: stop() fjerner lytterne', a.cleanupListeners && a.cleanupHadListeners);
  check('A: stop() rydder timerne', a.cleanupTimers && a.cleanupHadTimers);
  check('A: stop() fjerner banneret', a.cleanupBanner);
  check('A: ingen kontroller etter stop()', a.cleanupNoMoreFetches);
  check('A: check() etter stop() er en no-op', a.cleanupCheckIsNoop);
  check('A: ny build meldt fra en annen fane gir mål-build', a.peerTarget);
  check('A: ny build fra en annen fane viser banner', a.peerBanner);

  await safetyScenario(page, s.ids);
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(e.message));
  await scenario(page, { width: 1200, height: 900 }, 'DESKTOP (1200×900)');
  await scenario(page, { width: 390, height: 780 }, 'MOBIL (390×780)');
  check('ingen ukontrollerte JS-feil på siden', pageErrors.length === 0);
  if (pageErrors.length) pageErrors.slice(0, 6).forEach(e => console.log('  PAGEERROR:', e));
  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
