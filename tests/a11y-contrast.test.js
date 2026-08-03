/*
  Test for KONTRASTKONTRAKTEN (WCAG AA) — fargetokenene i styles.css og reglene
  som bruker dem. Ingen nettleser: ren lesing av styles.css, så den kjører på
  millisekunder og kan stå først i suiten.

  Hvorfor tokens og ikke skjermbilder: fargene er definert ÉN gang i `:root`, og
  alle flater/tekster arver dem. Regner vi ratioene direkte på tokenene, fanger
  vi et regelbrudd i samme øyeblikk noen endrer en verdi — uten et board fullt av
  testdata og uten piksellesing. Det rendrede laget (der farger blandes med
  gjennomsiktighet) dekkes av tests/a11y-runtime.test.js.

  Autoritativ beskrivelse av fargesystemet: docs/design-system.md.

  Verifiserer:
    1. Hvit tekst på .btn-green og .btn-red når 4.5:1 — på BEGGE endene av
       gradienten, ikke bare den mørke.
    2. .btn-yellow bærer MØRK tekst (en gul flate kan ikke bære hvit tekst og
       fortsatt være gul), og den mørke teksten når 4.5:1 mot begge endene.
       Regelen som setter fargen finnes faktisk i fila, og text-shadow er slått
       av for den (skygge under mørk tekst gjør den bare uskarp).
    3. --danger, --warn, --primary og --ink-soft er lovlige TEKSTfarger på hvit
       (4.5:1) — de brukes som det i statuslinja, chip-ene og faresonen.
    4. --focus når 3:1 mot ALLE flater ringen kan havne på: hvit, board-
       bakgrunnen, alle seks palettfarger og alle tre knappefarger.
    5. --focus-on-dark (toast + oppdateringsbanner) når 3:1 mot de mørke flatene.
    6. Ikonstreken (#111) når 3:1 mot alle de samme flatene.
    7. INGEN :focus-visible-regel maler ringen i noe annet enn --focus/
       --focus-on-dark. Det er dette punktet som hindrer at en ny kontroll får
       en «pen» ring som forsvinner mot halve paletten — slik de hvite ringene
       på korthodene gjorde.
    8. De pensjonerte fargeverdiene er borte fra hele kildetreet, så en gammel
       hardkodet gul/rød/grønn ikke kan snike seg inn igjen.

  Kjør:
    node tests/a11y-contrast.test.js
*/
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const css = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');

let passed = 0, failed = 0;
function check(name, cond, extra) {
  if (cond) { passed++; console.log('PASS — ' + name); }
  else { failed++; console.log('  ✗ FAIL: ' + name + (extra !== undefined ? '  [' + JSON.stringify(extra) + ']' : '')); }
}

/* ---------- WCAG-regnestykket (2.x relativ luminans) ---------- */
function srgb(c) { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
function rgb(hex) {
  let h = hex.trim().replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}
function lum(hex) { const [r, g, b] = rgb(hex).map(srgb); return 0.2126 * r + 0.7152 * g + 0.0722 * b; }
function ratio(a, b) {
  const l1 = lum(a), l2 = lum(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}
// «a mot b når kravet» — tar med den faktiske ratioen som evidens.
function contrast(label, a, b, need) {
  const v = ratio(a, b);
  check(`${label} — ${v.toFixed(2)}:1 (krav ${need}:1)`, v >= need, { a, b, ratio: +v.toFixed(2) });
}

/* ---------- Tokens leses ut av :root, ikke duplisert her ---------- */
const rootBlock = (css.match(/:root\s*\{([\s\S]*?)\n\}/) || [])[1];
if (!rootBlock) { console.log('  ✗ FAIL: fant ikke :root-blokken i styles.css'); process.exit(1); }
function token(name) {
  const m = rootBlock.match(new RegExp('--' + name + '\\s*:\\s*([^;]+);'));
  return m ? m[1].trim() : null;
}
// Gradient-endene: begge fargestoppene i en `linear-gradient(...)`, med
// var(--x) løst opp mot de andre tokenene.
function gradientStops(name) {
  let v = token(name) || '';
  for (let i = 0; i < 5 && /var\(--/.test(v); i++) {
    v = v.replace(/var\(--([a-z0-9-]+)\)/gi, (_, t) => token(t) || '');
  }
  return (v.match(/#[0-9a-f]{3,8}/gi) || []);
}

const INK = token('ink');
const FOCUS = token('focus');
const FOCUS_DARK = token('focus-on-dark');
const WHITE = '#ffffff';

// Flatene en fokusring/et ikon faktisk kan havne på i denne appen.
// Palettfargene er de seks HSL-fargene (S=20 %, L=60 %) fra docs/colors-and-labels.md.
const PALETTE = ['#ad8585', '#adad85', '#85ad85', '#85adad', '#8585ad', '#ad85ad'];
const SURFACES = [
  ['hvit flate', WHITE],
  ['board-bakgrunnen', token('bg')],
  ...PALETTE.map((c, i) => [`palettfarge ${i + 1}`, c]),
  ['grå ikonflate', '#c0c4c9'],
  ['grønn knapp', token('primary')],
  ['rød knapp', token('danger')],
  ['gul knapp', gradientStops('grad-yellow')[0]],
];

/* ---------- 1–2. Fargede knapper ---------- */
console.log('\n--- Fargede knapper (.btn-solid) ---');
for (const [stopI, stop] of gradientStops('grad-green').entries()) {
  contrast(`hvit tekst på .btn-green, gradientstopp ${stopI + 1} (${stop})`, WHITE, stop, 4.5);
}
for (const [stopI, stop] of gradientStops('grad-red').entries()) {
  contrast(`hvit tekst på .btn-red, gradientstopp ${stopI + 1} (${stop})`, WHITE, stop, 4.5);
}
const yellowStops = gradientStops('grad-yellow');
for (const [stopI, stop] of yellowStops.entries()) {
  contrast(`mørk tekst på .btn-yellow, gradientstopp ${stopI + 1} (${stop})`, INK, stop, 4.5);
}
// Gult MÅ ha en egen tekstfarge-regel; uten den arver den hvit fra .btn-solid.
const yellowRule = (css.match(/\.btn-solid\.btn-yellow\s*\{([^}]*)\}/) || [])[1] || '';
check('.btn-yellow overstyrer .btn-solid sin hvite tekst med var(--ink)',
  /color:\s*var\(--ink\)/.test(yellowRule), yellowRule.trim());
check('.btn-yellow slår av text-shadow (skygge under mørk tekst gjør den uskarp)',
  /text-shadow:\s*none/.test(yellowRule), yellowRule.trim());
// Og hvit tekst på gult skal IKKE kunne komme snikende tilbake.
for (const stop of yellowStops) {
  const v = ratio(WHITE, stop);
  check(`hvit tekst på gult ville vært ulovlig (${v.toFixed(2)}:1) — derfor mørk tekst`, v < 4.5, +v.toFixed(2));
}

/* ---------- 3. Tokens brukt som tekstfarge på lys flate ---------- */
console.log('\n--- Tokens som tekstfarge på hvit ---');
for (const t of ['danger', 'warn', 'primary', 'primary-dark', 'ink', 'ink-soft']) {
  contrast(`--${t} (${token(t)}) som tekst på hvit`, token(t), WHITE, 4.5);
}

/* ---------- 4–6. Fokusring og ikonstrek mot alle flater ---------- */
console.log('\n--- Fokusring (--focus) mot alle flater ---');
for (const [name, surface] of SURFACES) contrast(`--focus mot ${name} (${surface})`, FOCUS, surface, 3);

console.log('\n--- Fokusring på mørke flater (--focus-on-dark) ---');
// Toasten (rgba(45,38,70,.62) over vilkårlig innhold) og oppdateringsbanneret.
// Verste tilfelle for en hvit ring er den LYSESTE varianten flaten kan få: helt
// gjennomsiktig toast over hvit bakgrunn.
for (const [name, surface] of [['toast-flaten', '#6e6880'], ['oppdateringsbanneret', '#3f3a52']]) {
  contrast(`--focus-on-dark mot ${name} (${surface})`, FOCUS_DARK, surface, 3);
}

console.log('\n--- Ikonstrek (#111) mot alle flater ---');
for (const [name, surface] of SURFACES) {
  if (surface === WHITE) continue; // trivielt
  contrast(`ikonstrek #111 mot ${name} (${surface})`, '#111111', surface, 3);
}

/* ---------- 7. Ingen fokusring i en annen farge ---------- */
console.log('\n--- Fokusringene bruker bare de godkjente tokenene ---');
const focusRules = css.split('\n')
  .map((l, i) => [i + 1, l])
  .filter(([, l]) => /:focus-visible/.test(l) || /^\s*outline:/.test(l));
// Alle outline-deklarasjoner som står i en :focus-visible-regel.
const badRings = [];
const ruleRe = /([^{}]*:focus-visible[^{}]*)\{([^}]*)\}/g;
let m;
while ((m = ruleRe.exec(css))) {
  const outline = (m[2].match(/outline:\s*([^;]+);/) || [])[1];
  if (!outline) continue;
  if (/none/.test(outline)) continue;
  if (!/var\(--focus\)|var\(--focus-on-dark\)|var\(--card-accent\)/.test(outline)) {
    badRings.push(m[1].trim().replace(/\s+/g, ' ') + ' → ' + outline.trim());
  }
}
check('alle :focus-visible-ringer bruker --focus / --focus-on-dark', badRings.length === 0, badRings);
check('fokusringen er minst 2px bred', parseFloat(token('focus-w')) >= 2, token('focus-w'));
void focusRules;

/* ---------- 8. Pensjonerte fargeverdier er borte ---------- */
console.log('\n--- Gamle fargeverdier finnes ikke lenger ---');
const RETIRED = {
  '#668866': 'gammel --primary (hvit tekst 3.98:1)',
  '#7fa77f': 'gammel lys grønn gradientende (2.71:1)',
  '#ef6b7d': 'gammel --danger (2.97:1)',
  '#f4788a': 'gammel lys rød gradientende (2.66:1)',
  '#dfaf46': 'gammel lys gul gradientende (2.03:1 mot hvit tekst)',
  '#c99a2e': 'gammel --warn (2.58:1)',
  'rgba(102, 136, 102': 'gammel grønn i rgba-form',
  'rgba(239, 107, 125': 'gammel rød i rgba-form',
};
const SRC = ['styles.css', 'index.html', 'app.js', 'icons.js', 'update-check.js']
  .map((f) => [f, fs.readFileSync(path.join(ROOT, f), 'utf8')]);
for (const [needle, why] of Object.entries(RETIRED)) {
  const hits = SRC.filter(([, body]) => body.toLowerCase().includes(needle.toLowerCase())).map(([f]) => f);
  check(`${needle} (${why}) finnes ikke i kilden`, hits.length === 0, hits);
}

console.log(`\n==== ${passed}/${passed + failed} PASS ====`);
process.exit(failed ? 1 : 0);
