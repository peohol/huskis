/* ============================================================
   TESTMODUS — laster mock-backenden når adressen har `?mock=1`.

   Denne fila og `mock-backend.js` er de eneste to filene i kildekoden som
   IKKE deployes: `build.js` hopper over begge og river ut `kun-dev`-blokken i
   `index.html`, slik at produksjonsbygget verken har filene eller taggen som
   ber om dem. `?mock=1` i produksjon gjør derfor ingenting — se
   `docs/sikkerhetsheadere.md`.

   `document.write()` (og ikke en dynamisk `<script>`-node) fordi
   `mock-backend.js` må være ferdig kjørt FØR `app.js` starter: en
   parser-innsatt tagg beholder rekkefølgen, en `appendChild` gjør ikke det.

   Kjøres som en egen fil, ikke inline, slik at innholdssikkerhetspolicyen
   klarer seg med `script-src 'self'`.
   ============================================================ */
if (/[?&]mock=1/.test(location.search)) {
  document.write('<script src="mock-backend.js"><\/script>');
}
