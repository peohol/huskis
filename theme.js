/* ============================================================
   Huskis — theme.js

   Drakten i UI-et: lys eller mørk. Hele draktmodellen — hvor valget lagres,
   hva «system» betyr, og hvordan fargene snus — er beskrevet i
   docs/mork-drakt.md, som er autoritativ.

   Fila er søsteren til i18n.js: ren tilstand + noen få funksjoner, ingen
   avhengigheter, og den rører ingenting utenom `<html data-theme>`,
   `<meta name="theme-color">` og `localStorage['huskis-theme']`.

   DEN LASTES I <head>, IKKE NEDERST I <body> — det er hele poenget. Draktens
   farger ligger i CSS-tokens som velges av `data-theme` på rot-elementet, så
   attributtet MÅ stå der før nettleseren maler første bilde. Lastes fila sist
   (som i18n.js og app.js), rekker skjermen å blinke hvitt før den blir mørk.
   Den er noen få hundre byte og hentes fra samme opphav, så
   render-blokkeringen er ikke målbar.

   TRE VERDIER, IKKE TO: 'system' (standard) følger operativsystemets
   `prefers-color-scheme` og skifter med det mens appen står åpen; 'light' og
   'dark' er brukerens eksplisitte overstyring og er upåvirket av OS-et.

   VALGET ER ENHETENS, ikke kontoens — i motsetning til språket (docs/sprak.md).
   Drakten avhenger av skjermen og lyset man sitter i, ikke av hvem man er, og
   den har ingen serverside-effekt slik språket har (invitasjons-e-postene).
   Derfor ingen `user_metadata` og ingen synk.
   ============================================================ */
(function () {
  'use strict';

  // Rekkefølgen her er rekkefølgen i draktvelgeren.
  var MODES = ['system', 'light', 'dark'];
  var DEFAULT = 'system';
  var STORAGE_KEY = 'huskis-theme';

  // `<meta name="theme-color">` farger nettleserens egen ramme (adresselinja på
  // Android, statuslinja i den native app-skallet). Verdiene er board-
  // bakgrunnen — `--bg` — i hver drakt, og MÅ holdes i takt med den i
  // styles.css; tests/dark-mode.test.js sammenligner dem.
  var THEME_COLOR = { light: '#667788', dark: '#141922' };

  var listeners = [];

  function normalize(m) {
    return MODES.indexOf(m) > -1 ? m : DEFAULT;
  }

  function stored() {
    try { return normalize(localStorage.getItem(STORAGE_KEY)); }
    catch (e) { return DEFAULT; }   // privat modus / blokkerte nettsteddata
  }

  var current = stored();

  function systemPrefersDark() {
    try { return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches); }
    catch (e) { return false; }
  }

  // Draktet som faktisk gjelder nå: 'light' eller 'dark'. 'system' løses opp
  // her, og bare her — resten av appen forholder seg til svaret.
  function effective() {
    return current === 'system' ? (systemPrefersDark() ? 'dark' : 'light') : current;
  }

  function apply() {
    var eff = effective();
    document.documentElement.setAttribute('data-theme', eff);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', THEME_COLOR[eff]);
    return eff;
  }

  /* Setter drakten for DENNE fanen: attributtet males med én gang, og
     lytterne (app.js re-rendrer kortfargene) får beskjed.

     RETURNERER om valget faktisk ble LAGRET — samme kontrakt som
     `I18N.setLang`. I privat modus kaster `setItem`, og drakten ville da falt
     tilbake til standarden ved neste lasting uten at noen sa fra. Kalleren
     bruker svaret til å si det. */
  function setMode(m) {
    current = normalize(m);
    var saved = false;
    try { localStorage.setItem(STORAGE_KEY, current); saved = true; } catch (e) { /* privat modus */ }
    var eff = apply();
    for (var i = 0; i < listeners.length; i++) {
      try { listeners[i](eff, current); } catch (e) { /* en lytter skal ikke velte de andre */ }
    }
    return saved;
  }

  function onChange(fn) {
    if (typeof fn === 'function') listeners.push(fn);
  }

  apply();

  /* «System» skal følge OS-et også MENS appen står åpen (nattmodus som slår inn
     kl. 22, en bryter i kontrollsenteret). Lytteren står permanent, men gjør
     ingenting når brukeren har valgt lys eller mørk eksplisitt — da er OS-et
     nettopp det de har overstyrt. `addEventListener` finnes ikke på
     MediaQueryList i eldre Safari; `addListener` er reserven. */
  try {
    var mq = window.matchMedia('(prefers-color-scheme: dark)');
    var onSystem = function () {
      if (current !== 'system') return;
      var eff = apply();
      for (var i = 0; i < listeners.length; i++) {
        try { listeners[i](eff, current); } catch (e) { /* som over */ }
      }
    };
    if (mq.addEventListener) mq.addEventListener('change', onSystem);
    else if (mq.addListener) mq.addListener(onSystem);
  } catch (e) { /* ingen matchMedia: drakten blir stående der den er */ }

  window.HUSKIS_THEME = {
    MODES: MODES,
    DEFAULT: DEFAULT,
    STORAGE_KEY: STORAGE_KEY,
    THEME_COLOR: THEME_COLOR,
    mode: function () { return current; },
    effective: effective,
    setMode: setMode,
    onChange: onChange,
  };
})();
