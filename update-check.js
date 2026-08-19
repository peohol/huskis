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
     • Er de forskjellige, finnes det en nyere klient. Da KLARGJØRES målet
       (`prepare` → app.js `prepareUpdate()`; i nettleseren er det et rent ja,
       i det native skallet er det nedlasting + oppstilling av bundelen), og
       vi venter på et trygt øyeblikk (se `isSafe` → app.js `updateSafety()`)
       før vi laster på nytt (`reload` → app.js `applyUpdate()`).

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

  /* Klargjøringen: er mål-builden i det hele tatt noe denne klienten KAN laste?
     I en nettleser er svaret alltid ja — målet ligger på serveren, og en reload
     henter det. I det native skallet må bundelen først lastes ned og stilles
     opp, og det er app.js som eier den koden (docs/mobilapp-plan.md, «Hvor
     hente-koden bor»). Samme sene binding som `defaultIsSafe`: modulen lastes
     etter app.js, men instansen opprettes uten injiserte avhengigheter, så
     `window.__huskis` slås opp ved HVERT kall i stedet for å fanges én gang.

     Mangler kroken, er det ingenting å klargjøre. Det er ikke fail open: i
     native er det app.js som melder mål-builden i det hele tatt (`noteBuild`),
     så en app.js som ikke finnes gir heller ikke noe mål å laste. */
  function defaultPrepare(win) {
    return function (id) {
      var h = win.__huskis;
      if (!h || typeof h.prepareUpdate !== 'function') return true;
      return h.prepareUpdate(id);
    };
  }

  /* Selve reloaden. I nettleseren er den `location.reload()`. I det native
     skallet må den gå gjennom pluginens egen `reload()`, ellers laster
     WebView-en den bundelen den allerede kjører — den nye er stilt opp som
     NESTE. app.js eier også det valget, bak den samme gaten. */
  function defaultReload(win) {
    return function () {
      var h = win.__huskis;
      if (h && typeof h.applyUpdate === 'function') {
        try { h.applyUpdate(); return; } catch (e) { /* faller tilbake under */ }
      }
      win.location.reload();
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
    var reload = o.reload || defaultReload(win);
    var isSafe = o.isSafe || defaultIsSafe(win);
    var prepare = o.prepare || defaultPrepare(win);
    var isHidden = o.isHidden || function () { return !!doc.hidden; };
    var isOnline = o.isOnline || function () { return !win.navigator || win.navigator.onLine !== false; };
    var storage = ('storage' in o) ? o.storage : sessionStore(win);
    var pollMs = o.pollMs == null ? 10 * 60 * 1000 : o.pollMs;
    var idleMs = o.idleMs == null ? 60 * 1000 : o.idleMs;
    var safetyPollMs = o.safetyPollMs == null ? 5000 : o.safetyPollMs;
    var initialDelayMs = o.initialDelayMs == null ? 1500 : o.initialDelayMs;
    var channelName = ('channelName' in o) ? o.channelName : 'huskis-update';

    var target = null;      // build-ID-en vi vil over til (null = ingen kjent)
    var prepared = null;    // build-ID-en klargjøringen har lykkes for
    var preparing = null;   // pågående klargjøring (dedupliserer samtidige kall)
    var manualWanted = false;  // brukeren trykket «Oppdater nå» før målet var klart
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
          // En klargjøring som feilet forrige gang prøves igjen her — i
          // motorens egen rytme, ikke i en egen retry-løkke.
          prepareTarget();
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
        prepared = null;                   // nytt mål ⇒ ny klargjøring
        if (!fromPeer) broadcast(id);
        prepareTarget();
      }
      evaluate();
    }

    /* ---------------- Klargjøring: er målet i det hele tatt lastbart? -------
       Et mål er ikke reloadbart før klargjøringen har lykkes. I nettleseren er
       den et rent ja (målet ligger på serveren); i det native skallet dekker
       den nedlasting OG oppstilling av bundelen (docs/mobilapp-plan.md, fase 5).

       To fail closed-regler bor her:
         • en FEILET klargjøring koster ingenting — den brenner ikke
           ett-forsøk-vakten (som skrives først i `autoReload`), og prøves på
           nytt ved neste naturlige anledning, altså neste `check()`;
         • banneret vises FØRST når målet er klart. «Oppdater nå» går utenom
           trygghetsvakten med vilje, men kan ikke gå utenom klargjøringen —
           er det ingenting stilt opp, er det ingenting å laste. */
    function prepareTarget() {
      if (stopped || !target || prepared === target || preparing) return;
      var id = target;
      preparing = id;
      Promise.resolve()
        .then(function () { return prepare(id); })
        .then(function (ok) { if (!stopped && target === id && ok) prepared = id; })
        .catch(function () { /* stille: prøves igjen ved neste kontroll */ })
        .then(function () {
          if (preparing === id) preparing = null;
          if (stopped || target !== id || prepared !== id) return;
          showBanner();
          startSafetyTicker();
          if (manualWanted) { manualWanted = false; reload(); return; }
          evaluate();
        });
    }

    /* ---------------- Er det trygt å laste på nytt nå? ---------------- */
    function evaluate() {
      if (stopped || !target) return;
      if (prepared !== target) return;     // ikke klargjort ⇒ ingenting å laste
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

    /* Teksten i banneret følger appens språkvalg. Ordboken ligger i i18n.js,
       som lastes FØR denne fila — men banneret skal virke uansett, så
       fallbacken (norsk) står her og brukes hvis ordboken mangler. */
    function txt(key, fallback) {
      var I = win.HUSKIS_I18N;
      if (!I) return fallback;
      var s = I.t(key);
      return s === key ? fallback : s;
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
      msg.textContent = txt('update.available', 'En ny versjon av Huskis er tilgjengelig.');
      bannerNote = doc.createElement('span');
      bannerNote.className = 'update-banner-note';
      bannerNote.textContent = txt('update.waiting', 'Siden oppdateres når endringene dine er lagret.');
      bannerNote.hidden = true;
      text.appendChild(msg);
      text.appendChild(bannerNote);

      var btn = doc.createElement('button');
      btn.type = 'button';
      btn.className = 'update-banner-btn';
      btn.textContent = txt('update.now', 'Oppdater nå');
      // Brukeren ber selv om oppdateringen: ingen trygghets- eller ett-forsøk-vakt.
      // Klargjøringen er den ene vakten knappen IKKE går utenom: er målet ikke
      // stilt opp, settes den i gang, og reloaden skjer når den har lykkes.
      btn.addEventListener('click', function () { manualReload(); });

      banner.appendChild(text);
      banner.appendChild(btn);
      doc.body.appendChild(banner);
      requestPaint();
    }
    function manualReload() {
      if (target && prepared === target) { reload(); return; }
      manualWanted = true;
      prepareTarget();
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
      preparing = null; manualWanted = false;
    }

    var api = {
      start: start,
      stop: stop,
      check: check,
      evaluate: evaluate,
      // Meldes utenfra av app.js i det native skallet: der er /version.json
      // klientens EGEN, innebygde kopi, så motoren kan bare måle seg mot seg
      // selv. Målet kommer fra OTA-manifestet (docs/mobilapp-plan.md, fase 5).
      noteBuild: function (id) { noteBuild(id, false); },
      markActivity: markActivity,
      get buildId() { return buildId; },
      get target() { return target; },
      get prepared() { return prepared; },
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
