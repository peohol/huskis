#!/usr/bin/env node
/* ============================================================
   Regresjonstest: FARGENE I IKONSETTET (docs/design-system.md → «Ikoner»,
   docs/mork-drakt.md → «Ikonene snur uten at en eneste SVG endres»).

   Fargene er PRESENTASJONSATTRIBUTTER i markup — `fill="…"` i `icons.js` og i
   de innlimte SVG-ene i `index.html` — og CSS maler om nøyaktig tre av dem
   (`#ffffff` → --icon-paper, `#c0c4c9` → --icon-grey, `#111` → --icon-ink).
   Alt annet fyll står stille i begge draktene. Det gjør fyllfargen til en
   KONTRAKT, ikke en detalj: et fyll utenfor paletten snur ikke med drakten og
   er ikke målt mot noen flate.

   Derfor to slag sjekk her:

     1. HVERT motiv har den fargen det skal ha — bjella gull, kalenderens
        øverste felt rødt over en hvit hovedflate, søkelinsa lyseblå, sol/måne
        lysegul. Motivene finnes i FLERE eksemplarer (toppkontrollene,
        modalhodene, `icons.js`), og alle skal males likt.
     2. INGEN fyllfarge utenfor det tillatte settet finnes noe sted. Uten den
        vakten kan et nytt ikon komme inn med sin egen hex uten at noe sier fra
        — den ville sett riktig ut i lys drakt og feil i mørk.

   Ren node-test — ingen server, ingen nettleser.

   Kjør:
     node tests/icon-colors.test.js
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const icons = fs.readFileSync(path.join(ROOT, 'icons.js'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');

let pass = 0, fail = 0;
const check = (navn, ok, evidens) => {
  if (ok) { pass++; console.log('PASS — ' + navn + (evidens ? '  [' + evidens + ']' : '')); }
  else { fail++; console.log('FAIL — ' + navn + (evidens ? '  [' + evidens + ']' : '')); }
};

/* Palettens seks farger (S=20 %, L=60 %) + den lyse tonen av farge 2 (L=75),
   som sol/måne bruker, + «papir» og «grå» — de to CSS maler om.
   docs/design-system.md har fargekartet. */
const PALETTE = ['#ad8585', '#adad85', '#85ad85', '#85adad', '#8585ad', '#ad85ad'];
const LOVLIGE = new Set([...PALETTE, '#ccccb3', '#ffffff', '#c0c4c9', '#111', '#111111', 'none']);

const GULL = '#adad85';      // bjella (palettfarge 2)
const ROD = '#ad8585';       // kalenderens øverste felt (palettfarge 1)
const LYSEBLA = '#85adad';   // søkelinsa (palettfarge 4)
const LYSEGUL = '#ccccb3';   // sol/måne (palettfarge 2 på L=75)

/* ---- 1. Bjella (varsler) ---- */
// Klokkeflaten, i alle eksemplarer. Den ENE bjella som IKKE er med er
// «varsler av»-glyfen på en massiv fargeknapp: den er `.btn-glyph` med
// currentColor og har ingen fyllflate i det hele tatt.
{
  const alle = [...html.matchAll(/<path d="M6\.8 16\.4v-4\.6a5\.2 5\.2 0 0 1 10\.4 0v4\.6z"([^>]*)>/g)]
    .map((m) => m[1]);
  check('fant bjelle-motivet i index.html', alle.length >= 3, alle.length + ' forekomster');
  const fylte = alle.filter((a) => /fill=/.test(a));
  check('bjellene med fyllflate er GULL (' + GULL + ')',
    fylte.length >= 2 && fylte.every((a) => a.includes('fill="' + GULL + '"')),
    fylte.join(' | '));
  const glyf = alle.filter((a) => !/fill=/.test(a));
  check('«varsler av»-glyfen på fargeknappen har fortsatt ingen fyllflate',
    glyf.length === 1, glyf.length + ' uten fill');
}

/* ---- 2. Kalenderen (alle: starttid, frist, hendelser, toppkontrollen) ---- */
{
  const BAND = '<path d="M3.5 9.5V7.5a2.5 2.5 0 0 1 2.5-2.5h11a2.5 2.5 0 0 1 2.5 2.5V9.5Z" fill="' + ROD + '" stroke="none">';
  const iHtml = html.split(BAND).length - 1;
  const iIcons = icons.split(BAND.replace(/"/g, '\\"')).length - 1 ||
                 icons.split(BAND).length - 1;
  check('kalenderens øverste felt er RØDT i index.html', iHtml >= 2, iHtml + ' forekomster');
  check('kalenderens øverste felt er RØDT i icons.js (calendar + calendarDue)',
    iIcons === 2, iIcons + ' forekomster');
  // Hovedflaten er fortsatt «papir» — det er den som snur med drakten.
  const flate = /<rect x="3\.5" y="5" width="17" height="16" rx="2\.5" fill="#ffffff" stroke="none"><\/rect>/g;
  check('kalenderens hovedflate er hvit (--icon-paper) i icons.js',
    (icons.match(flate) || []).length === 2);
  check('kalenderens hovedflate er hvit (--icon-paper) i index.html',
    (html.match(flate) || []).length >= 2);
  // Rammen tegnes PÅ NYTT etter fyllet, ellers spiser det røde feltet den
  // indre halvdelen av rammestreken (samme mønster som `trash`).
  const ramme = /<rect x="3\.5" y="5" width="17" height="16" rx="2\.5"><\/rect>/g;
  check('kalenderrammen strekes opp etter fyllet (icons.js)',
    (icons.match(ramme) || []).length === 2);
  check('kalenderrammen strekes opp etter fyllet (index.html)',
    (html.match(ramme) || []).length >= 2);
}

/* ---- 3. Søkelinsa ---- */
{
  const alle = [...html.matchAll(/<circle cx="10\.5" cy="10\.5" r="6\.5"([^>]*)>/g)].map((m) => m[1]);
  check('fant forstørrelsesglasset i index.html', alle.length >= 2, alle.length + ' forekomster');
  check('linsa er LYSEBLÅ (' + LYSEBLA + ')',
    alle.length >= 2 && alle.every((a) => a.includes('fill="' + LYSEBLA + '"')),
    alle.join(' | '));
}

/* ---- 4. Sol og måne (draktknappen) ---- */
{
  check('solskiven er LYSEGUL (' + LYSEGUL + ')',
    icons.includes('<circle cx="12" cy="12" r="5" fill="' + LYSEGUL + '"></circle>'));
  check('halvmånen er LYSEGUL (' + LYSEGUL + ')',
    icons.includes('A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z" fill="' + LYSEGUL + '"'));
  // Draktknappen bruker ICONS.sun/moon; ingen egen kopi i index.html skal ha
  // blitt liggende igjen med det gamle «papir»-fyllet.
  check('ingen sol-/månekopi i index.html med gammelt papirfyll',
    !/r="5" fill="#ffffff"/.test(html) && !/11\.21 3 7 7 0 0 0 21 12\.79Z" fill="#ffffff"/.test(html));
}

/* ---- 5. Ingen fyllfarge utenfor det tillatte settet ---- */
for (const [navn, kilde] of [['icons.js', icons], ['index.html', html]]) {
  const ukjente = [...new Set(
    [...kilde.matchAll(/fill="([^"]+)"/g)]
      .map((m) => m[1].toLowerCase())
      .filter((v) => v !== 'currentcolor' && !LOVLIGE.has(v)),
  )];
  check('alle fyllfarger i ' + navn + ' er fra paletten (eller papir/grå)',
    ukjente.length === 0,
    ukjente.length ? 'ukjente: ' + ukjente.join(', ') : 'ok');
}

/* ---- 6. De tre CSS maler om, står fortsatt ---- */
check('CSS maler om «papir», «grå» og streken (og dermed snur ikonene med drakten)',
  /\[fill="#ffffff"\]\s*\{\s*fill:\s*var\(--icon-paper\)/.test(css) &&
  /\[fill="#c0c4c9"\]\s*\{\s*fill:\s*var\(--icon-grey\)/.test(css) &&
  /\[stroke="#111"\]\s*\{\s*stroke:\s*var\(--icon-ink\)/.test(css));
// … og at palettfyllene IKKE gjør det: de skal stå stille i begge drakter.
check('ingen CSS-regel maler om et palettfyll',
  !PALETTE.concat([LYSEGUL]).some((c) => new RegExp('\\[fill="' + c + '"\\]').test(css)));

console.log('\n==== ' + pass + '/' + (pass + fail) + ' PASS ====');
process.exit(fail === 0 ? 0 : 1);
