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

  Verifiserer — merk at KRAVET FØLGER AV HVA SOM LIGGER OPPÅ FLATEN:
    1. .btn-green bærer bare SVARTE IKONER (＋-knappene), og de når 3:1 mot begge
       gradientendene. Grønnfargen er derfor bevisst LYS; testen slår også fast
       at hvit tekst på den ville vært ulovlig, som er hele grunnen til at
       tekstknappene ligger på .btn-accent i stedet.
    2. .btn-accent og .btn-red bærer HVIT tekst → 4.5:1 mot BEGGE endene av
       gradienten, ikke bare den mørke.
    3. .btn-yellow bærer MØRK tekst (en gul flate kan ikke bære hvit tekst og
       fortsatt være gul), og den mørke teksten når 4.5:1 mot begge endene.
       Regelen som setter fargen finnes faktisk i fila, og text-shadow er slått
       av for den (skygge under mørk tekst gjør den bare uskarp).
    4. --danger, --warn, --accent og --ink-soft er lovlige TEKSTfarger på hvit
       (4.5:1) — de brukes som det i statuslinja, chip-ene og faresonen.
       --primary er derimot kun ikon-/kantfarge, med 3:1-kravet som følger.
    4b. Lagringsstatusens trafikklys (grønn/gul/grå/rød prikk) når 3:1 mot
       pilleflaten — som ikke er hvit, men --control-bg over board-bakgrunnen.
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
    9. LYSRETNINGEN: alle knappe-gradientene er loddrette (180deg) med den
       LYSESTE enden først, altså øverst. Skyggene i appen er forskjøvet
       nedover — lys skrått ovenfra — og en flate som lysner nedover ville
       lyssatt seg motsatt av sin egen skygge. Regnet ut på samme relative
       luminans som ratioene over, så «lysest» er målt og ikke øyemål.

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
  ['blågrønn knapp', token('accent')],
  ['rød knapp', token('danger')],
  ['gul knapp', gradientStops('grad-yellow')[0]],
];

/* ---------- 1–2. Fargede knapper ---------- */
console.log('\n--- Fargede knapper (.btn-solid) ---');
// GRØNT bærer bare svarte ikoner (＋-knappene) — kravet er 3:1 for et grafisk
// objekt. Det er nettopp derfor grønnfargen får være LYS: en grønn mørk nok til
// hvit tekst presset det svarte ikonet ned mot gulvet.
for (const [stopI, stop] of gradientStops('grad-green').entries()) {
  contrast(`svart ikon på .btn-green, gradientstopp ${stopI + 1} (${stop})`, '#111111', stop, 3);
}
// BLÅGRØNT bærer hvit tekst og hvite glyfer (Lagre, Inviter, bryterne, haken).
for (const [stopI, stop] of gradientStops('grad-accent').entries()) {
  contrast(`hvit tekst på .btn-accent, gradientstopp ${stopI + 1} (${stop})`, WHITE, stop, 4.5);
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
for (const t of ['danger', 'warn', 'accent', 'accent-dark', 'ink', 'ink-soft']) {
  contrast(`--${t} (${token(t)}) som tekst på hvit`, token(t), WHITE, 4.5);
}
// --primary er IKKE en tekstfarge. Den brukes som ikonfarge (.auth-title .icon,
// .item-cog:hover) og som kantfarge — begge grafiske objekter med 3:1-krav.
contrast(`--primary (${token('primary')}) som ikon-/kantfarge på hvit`, token('primary'), WHITE, 3);

// Hvit tekst på grønt er nettopp det som IKKE skal skje: da ville grønnfargen
// måtte mørknes, og det svarte ＋-ikonet blitt utydelig. Runtime-testen sjekker
// at ingen synlig .btn-green faktisk har tekst; her låser vi begrunnelsen.
for (const stop of gradientStops('grad-green')) {
  const v = ratio(WHITE, stop);
  check(`hvit tekst på grønt ville vært ulovlig (${v.toFixed(2)}:1) — grønt er kun ikonflate`, v < 4.5, +v.toFixed(2));
}

/* ---------- 3c. Tekst UTENFOR det hvite kortet på innloggingsskjermen ----------
   `.auth-lang-label` (språkvelgeren, docs/sprak.md) ligger rett på skiferflaten,
   ikke på hvitt. Tokenene over er tekstfarger for LYS bakgrunn — `--ink-soft`
   gir 1,4:1 her — så etiketten er hvit, og det er den som skal måles. */
console.log('\n--- Tekst på skiferflaten (innloggingsskjermen) ---');
{
  const declared = /\.auth-lang-label\s*\{[^}]*color:\s*([^;]+);/.exec(css);
  check('.auth-lang-label har en egen tekstfarge (ikke arvet fra en lys flate)',
    !!declared, declared && declared[1].trim());
  const color = declared ? declared[1].trim() : '';
  check('.auth-lang-label er hvit — den ligger på skifer, ikke på hvitt',
    color === '#ffffff' || color === '#fff', color);
  contrast('.auth-lang-label på skiferflaten (--bg)', WHITE, token('bg'), 4.5);
}

/* ---------- 3b. Lagringsstatusens trafikklys ---------- */
console.log('\n--- Lagringsstatusens trafikklys (.sync-status-dot) ---');
// Prikken er et grafisk objekt (3:1), og flaten den ligger på er IKKE hvit:
// pillen er --control-bg (halvgjennomsiktig hvit) over board-bakgrunnen. Det er
// nettopp derfor det grønne lyset er --primary-dark og ikke --primary — den
// lyse grønnfargen faller under kravet mot denne blandingen.
// HVILKEN tilstand som får hvilken farge sjekkes rendret, i
// tests/sync-status.test.js; her låses at fargene i det hele tatt er lovlige.
function over(rgba, backdrop) {
  const m = String(rgba || '').match(/rgba?\(([^)]+)\)/);
  if (!m) return rgba;
  const p = m[1].split(',').map((x) => parseFloat(x));
  const a = p.length > 3 ? p[3] : 1;
  const b = rgb(backdrop);
  return '#' + [0, 1, 2]
    .map((i) => Math.round(p[i] * a + b[i] * (1 - a)).toString(16).padStart(2, '0'))
    .join('');
}
const PILL = over(token('control-bg'), token('bg'));
for (const [what, t] of [['grønt «Lagret»', 'primary-dark'], ['gult «Lagrer …»', 'warn'],
  ['grått «Frakoblet»', 'ink-soft'], ['rødt «kunne ikke lagres»', 'danger']]) {
  contrast(`statusprikk, ${what} = --${t} (${token(t)}) mot pilleflaten (${PILL})`, token(t), PILL, 3);
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
// Sikkerhetsnettet: uten den bare `:focus-visible`-regelen arver enhver ny
// kontroll nettleserens egen ring — en farge ingen av testene her kan måle.
check('det finnes en global :focus-visible-regel som fanger alt annet',
  /(^|\n)\s*:focus-visible\s*\{[^}]*outline:\s*var\(--focus-w\)\s+solid\s+var\(--focus\)/.test(css));
void focusRules;

/* ---------- 8. Pensjonerte fargeverdier er borte ---------- */
console.log('\n--- Gamle fargeverdier finnes ikke lenger ---');
const RETIRED = {
  '#ef6b7d': 'gammel --danger (2.97:1)',
  '#f4788a': 'gammel lys rød gradientende (2.66:1)',
  '#dfaf46': 'gammel lys gul gradientende (2.03:1 mot hvit tekst)',
  '#c99a2e': 'gammel --warn (2.58:1)',
  'rgba(239, 107, 125': 'gammel rød i rgba-form',
};
const SRC = ['styles.css', 'index.html', 'app.js', 'icons.js', 'update-check.js']
  .map((f) => [f, fs.readFileSync(path.join(ROOT, f), 'utf8')]);
for (const [needle, why] of Object.entries(RETIRED)) {
  const hits = SRC.filter(([, body]) => body.toLowerCase().includes(needle.toLowerCase())).map(([f]) => f);
  check(`${needle} (${why}) finnes ikke i kilden`, hits.length === 0, hits);
}

/* ---------- 9. Lysretning: loddrette gradienter, lysest øverst ---------- */
console.log('\n--- Knappe-gradientenes lysretning ---');
for (const g of ['grad-green', 'grad-accent', 'grad-red', 'grad-yellow']) {
  const raw = token(g) || '';
  check(`--${g} er loddrett (180deg)`, /linear-gradient\(\s*180deg\s*,/.test(raw), raw);
  const [top, bottom] = gradientStops(g);
  check(`--${g} har den lyseste enden ØVERST (${top} → ${bottom})`,
    top && bottom && lum(top) > lum(bottom),
    { top, topLum: +lum(top).toFixed(4), bottom, bottomLum: +lum(bottom).toFixed(4) });
}
// …og ingen ANNEN gradient i fila får være diagonal heller. Flatene er 180deg;
// de eneste 90deg-ene er sveipefeltenes fyll, som følger fingeren vannrett og
// derfor ikke er lyssetting i det hele tatt.
const diagonals = css.split('\n')
  .map((l, i) => [i + 1, l])
  .filter(([, l]) => {
    const m = l.match(/linear-gradient\(\s*(-?[\d.]+)deg/);
    return m && Number(m[1]) % 90 !== 0;
  })
  .map(([n, l]) => n + ': ' + l.trim());
check('ingen gradient i styles.css er diagonal (kun 180deg-flater / 90deg-sveipefyll)',
  diagonals.length === 0, diagonals);

console.log(`\n==== ${passed}/${passed + failed} PASS ====`);
process.exit(failed ? 1 : 0);
