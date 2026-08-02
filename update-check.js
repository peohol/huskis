/* ============================================================
   Automatisk oppdatering av åpne klienter.

   En fane som har stått åpen i dagevis kjører fortsatt koden fra den deployen
   den ble lastet med. Denne modulen oppdager at produksjonen har fått en NYERE
   build og laster siden på nytt — men bare når det ikke koster brukeren noe.

   Mekanikken:
     • Hver produksjonsbuild får en unik build-ID (se build.js). Den bygges inn
       to steder med nøyaktig samme verdi: i <meta name="huskis-build"> i den
       kjørende HTML-en, og i /version.json.
     • Vi henter /version.json fra VÅRT EGET origin (rot-relativ URL — også en
       preview-deploy skal måles mot seg selv), uten cache, og sammenligner
       ID-ene som IDENTITET — aldri «større/mindre».
     • Er de forskjellige, finnes det en nyere klient. Da venter vi på et trygt
       øyeblikk (se `isSafe` → app.js `updateSafety()`) og laster på nytt.

   Utviklingsmodus: meta-taggen står på «dev» i kildekoden og byttes først av
   build.js. Uten en ekte build-ID starter modulen ikke — lokal server og
   nettlesertestene er altså urørt (testene lager sin egen instans med
   injiserte avhengigheter).
   ============================================================ */
(function () {
  'use strict';

  var META_NAME = 'huskis-build';
  var PLACEHOLDER = 'dev';
  var STORAGE_KEY = 'huskis:auto-reload-build';

  // Build-ID-en som ER bygget inn i denne klienten. Tom/«dev» = ubygget kildekode.
  function readBuildId(doc) {
    var el = doc && doc.querySelector ? doc.querySelector('meta[name="' + META_NAME + '"]') : null;
    var v = el ? String(el.getAttribute('content') || '').trim() : '';
    return v && v !== PLACEHOLDER ? v : '';
  }

  // Fail closed: kan vi ikke spørre appen, er svaret «ikke trygt».
  function defaultIsSafe(win) {
    return function () {
      var h = win.__huskis;
      if (!h || typeof h.updateSafety !== 'function') return false;
      try { return !!h.updateSafety().safe; } catch (e) { return false; }
    };
  }
  function sessionStore(win) {
    try { return win.sessionStorage || null; } catch (e) { return null; } // privat modus o.l.
  }

  // Valider svaret FØR ID-ene sammenlignes: en feilkonfigurert cache eller en
  // HTML-feilside må aldri kunne leses som «ny build».
  function validBuildId(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return '';
    var id = data.buildId;
    if (typeof id !== 'string') return '';
    id = id.trim();
    return id && id.length <= 200 ? id : '';
  }

  function create(options) {
    var o = options || {};
    var win = o.win || window;
    var doc = o.doc || win.document;
    var buildId = String(o.buildId || '');
    var url = o.url || '/version.json';
    var fetchImpl = o.fetch || function (u, init) { return win.fetch(u, init); };
    var now = o.now || function () { return Date.now(); };
    var setT = o.setTimeout || function (fn, ms) { return win.setTimeout(fn, ms); };
    var clearT = o.clearTimeout || function (id) { return win.clearTimeout(id); };
    var reload = o.reload || function () { win.location.reload(); };
    var isSafe = o.isSafe || defaultIsSafe(win);
    var isHidden = o.isHidden || function () { return !!doc.hidden; };
    var isOnline = o.isOnline || function () { return !win.navigator || win.navigator.onLine !== false; };
    var storage = ('storage' in o) ? o.storage : sessionStore(win);
    var pollMs = o.pollMs == null ? 10 * 60 * 1000 : o.pollMs;
    var idleMs = o.idleMs == null ? 60 * 1000 : o.idleMs;
    var safetyPollMs = o.safetyPollMs == null ? 5000 : o.safetyPollMs;
    var initialDelayMs = o.initialDelayMs == null ? 1500 : o.initialDelayMs;
    var channelName = ('channelName' in o) ? o.channelName : 'huskis-update';

    var target = null;      // build-ID-en vi vil over til (null = ingen kjent)
    var inFlight = null;    // pågående kontroll (dedupliserer samtidige kall)
    var pollTimer = null, safetyTimer = null, startTimer = null;
    var lastActivity = now();
    var stopped = false, started = false;
    var chan = null;
    var checks = 0;         // antall FAKTISK utførte hentinger (testkrok)
    var reloads = 0;        // antall automatiske reload-forsøk (testkrok)
    var bustSeq = 0;
    var banner = null, bannerNote = null;
    var listeners = [];

    /* ---------------- Kontroll mot /version.json ---------------- */
    function check() {
      if (stopped) return Promise.resolve('');
      if (inFlight) return inFlight;                 // samtidige kall → én forespørsel
      if (!isOnline()) return Promise.resolve('');   // offline: stille, prøv ved neste anledning
      bustSeq++;
      var bust = 'b=' + now().toString(36) + '-' + bustSeq;
      var full = url + (url.indexOf('?') > -1 ? '&' : '?') + bust;
      checks++;
      var p = Promise.resolve()
        .then(function () {
          return fetchImpl(full, {
            cache: 'no-store',
            credentials: 'omit',
            headers: { 'cache-control': 'no-cache' },
          });
        })
        .then(function (res) { return res && res.ok ? res.json() : null; })
        .then(function (data) {
          var id = validBuildId(data);
          if (id) noteBuild(id, false);
          return id;
        })
        .catch(function () { return ''; })   // nettverksfeil/ugyldig JSON: stille
        .then(function (v) { if (inFlight === p) inFlight = null; return v; });
      inFlight = p;
      return p;
    }

    // En build-ID vi har sett — fra vår egen kontroll eller fra en annen fane.
    function noteBuild(id, fromPeer) {
      if (stopped || !id || !buildId) return;
      if (id === buildId) return;          // ren identitet, ingen rangering av SHA-er
      if (target !== id) {
        target = id;
        if (!fromPeer) broadcast(id);
        showBanner();
        startSafetyTicker();
      }
      evaluate();
    }

    /* ---------------- Er det trygt å laste på nytt nå? ---------------- */
    function evaluate() {
      if (stopped || !target) return;
      var safe = isOnline() && !!isSafe();
      paintBanner(safe);
      if (!safe) return;
      // Skjult fane: ingen å forstyrre. Synlig fane: bare når brukeren har vært
      // i ro lenge nok (tastetrykk/peker/berøring/input utsetter).
      if (isHidden() || (now() - lastActivity) >= idleMs) autoReload();
    }

    // Maks ETT automatisk forsøk per mål-build per fane: kjører den gamle
    // klienten fortsatt etterpå (cache-glipp, forsinket deploy), blir det med
    // banneret — ingen reload-løkke.
    function attempted(id) {
      if (!storage) return false;
      try { return storage.getItem(STORAGE_KEY) === id; } catch (e) { return false; }
    }
    // Registrerer forsøket OG bekrefter at det faktisk ble lagret. Uten lagring
    // (privat modus, blokkert, full kvote) kan vi ikke garantere ett-forsøk-
    // regelen — og en automatisk reload ville da kunne gjenta seg i det
    // uendelige mot en klient som blir gammel.
    function markAttempt(id) {
      if (!storage) return false;
      try { storage.setItem(STORAGE_KEY, id); return storage.getItem(STORAGE_KEY) === id; }
      catch (e) { return false; }
    }
    function autoReload() {
      if (attempted(target)) return;
      if (!markAttempt(target)) return;  // ingen vakt → kun banneret/«Oppdater nå»
      reloads++;
      reload();
    }

    /* ---------------- Banner (samme formspråk som toasten) ----------------
       Diskret, vedvarende og ikke-modalt. Stjeler ikke fokus: `role="status"` +
       `aria-live="polite"` leser meldingen opp uten å flytte fokuset, og
       knappen er en vanlig <button> (altså tastaturtilgjengelig). */
    function showBanner() {
      if (banner || !doc.body) return;
      banner = doc.createElement('div');
      banner.className = 'update-banner';
      banner.id = 'update-banner';
      banner.setAttribute('role', 'status');
      banner.setAttribute('aria-live', 'polite');

      var text = doc.createElement('span');
      text.className = 'update-banner-text';
      var msg = doc.createElement('span');
      msg.className = 'update-banner-msg';
      msg.textContent = 'En ny versjon av Huskis er tilgjengelig.';
      bannerNote = doc.createElement('span');
      bannerNote.className = 'update-banner-note';
      bannerNote.textContent = 'Siden oppdateres når endringene dine er lagret.';
      bannerNote.hidden = true;
      text.appendChild(msg);
      text.appendChild(bannerNote);

      var btn = doc.createElement('button');
      btn.type = 'button';
      btn.className = 'update-banner-btn';
      btn.textContent = 'Oppdater nå';
      // Brukeren ber selv om oppdateringen: ingen trygghets- eller ett-forsøk-vakt.
      btn.addEventListener('click', function () { reload(); });

      banner.appendChild(text);
      banner.appendChild(btn);
      doc.body.appendChild(banner);
      requestPaint();
    }
    function requestPaint() {
      if (banner) banner.classList.add('show');
    }
    // Utrygt → forklar hvorfor det venter. Trygt → bare hovedmeldingen.
    function paintBanner(safe) {
      if (bannerNote) bannerNote.hidden = !!safe;
    }

    /* ---------------- Timere ---------------- */
    function schedulePoll() {
      if (stopped || !pollMs) return;
      clearT(pollTimer);
      pollTimer = setT(function () {
        pollTimer = null;
        if (stopped) return;
        if (!isHidden()) check();   // «omtrent hvert tiende minutt mens fanen er synlig»
        schedulePoll();
      }, pollMs);
    }
    function startSafetyTicker() {
      if (stopped || safetyTimer || !safetyPollMs) return;
      var tick = function () {
        safetyTimer = null;
        if (stopped || !target) return;
        evaluate();
        safetyTimer = setT(tick, safetyPollMs);
      };
      safetyTimer = setT(tick, safetyPollMs);
    }

    /* ---------------- Hendelser ---------------- */
    function on(node, type, fn, opts) {
      if (!node || !node.addEventListener) return;
      node.addEventListener(type, fn, opts);
      listeners.push([node, type, fn, opts]);
    }
    function markActivity() { lastActivity = now(); }
    function onVisibility() {
      if (isHidden()) { evaluate(); return; }  // ble borte: kan være trygt å bytte nå
      markActivity();                          // brukeren er tilbake — ikke reload under nesen
      check();
    }
    function onFocus() { markActivity(); check(); }
    function onPageShow() { markActivity(); check(); }  // også retur fra bfcache
    function onOnline() { check(); }

    function attach() {
      on(doc, 'visibilitychange', onVisibility);
      on(win, 'focus', onFocus);
      on(win, 'pageshow', onPageShow);
      on(win, 'online', onOnline);
      var act = { passive: true, capture: true };
      ['keydown', 'pointerdown', 'pointermove', 'touchstart', 'wheel', 'input']
        .forEach(function (t) { on(doc, t, markActivity, act); });
      on(win, 'scroll', markActivity, { passive: true });
    }

    /* ---------------- Flere faner på samme origin ----------------
       BroadcastChannel er origin-avgrenset, så en preview-deploy roper aldri
       inn i en produksjonsfane. Kun en beskjed om at en ny build finnes —
       hver fane avgjør selv når den er trygg å laste. */
    function openChannel() {
      if (!channelName || !win.BroadcastChannel) return;
      try {
        chan = new win.BroadcastChannel(channelName);
        chan.onmessage = function (ev) {
          var d = ev && ev.data;
          if (d && d.type === 'huskis-build' && typeof d.buildId === 'string') noteBuild(d.buildId, true);
        };
      } catch (e) { chan = null; }
    }
    function broadcast(id) {
      if (!chan) return;
      try { chan.postMessage({ type: 'huskis-build', buildId: id }); } catch (e) { /* lukket */ }
    }

    /* ---------------- Livssyklus ---------------- */
    function start() {
      if (started || stopped || !buildId) return api;
      started = true;
      attach();
      openChannel();
      schedulePoll();
      startTimer = setT(function () { startTimer = null; check(); }, initialDelayMs);
      return api;
    }
    function stop() {
      stopped = true;
      clearT(pollTimer); clearT(safetyTimer); clearT(startTimer);
      pollTimer = safetyTimer = startTimer = null;
      listeners.forEach(function (l) { l[0].removeEventListener(l[1], l[2], l[3]); });
      listeners = [];
      if (chan) { try { chan.close(); } catch (e) {} chan = null; }
      if (banner && banner.parentNode) banner.parentNode.removeChild(banner);
      banner = bannerNote = null;
    }

    var api = {
      start: start,
      stop: stop,
      check: check,
      evaluate: evaluate,
      markActivity: markActivity,
      get buildId() { return buildId; },
      get target() { return target; },
      get checks() { return checks; },
      get reloads() { return reloads; },
      get started() { return started; },
      get stopped() { return stopped; },
      get listenerCount() { return listeners.length; },
      get banner() { return banner; },
    };
    return api;
  }

  window.HuskisUpdate = {
    create: create,
    readBuildId: readBuildId,
    validBuildId: validBuildId,
    instance: null,
  };

  // Auto-start kun i en ekte build (meta-taggen er byttet ut av build.js).
  var id = readBuildId(document);
  if (id) window.HuskisUpdate.instance = create({ buildId: id }).start();
})();
