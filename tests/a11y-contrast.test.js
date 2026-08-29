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
    9. VARSEL-TOASTENE (docs/varsler.md) bærer varseltypens egen farge,
       halvgjennomsiktig — flaten er altså ikke en kjent verdi. Teksten måles
       derfor mot begge ytterpunktene (hvitt og svart bak), og tinten må være
       den mørkeste enden av den samme gradienten ikonet står på.
   10. LYSRETNINGEN: alle knappe-gradientene er loddrette (180deg) med den
       LYSESTE enden først, altså øverst. Skyggene i appen er forskjøvet
       nedover — lys skrått ovenfra — og en flate som lysner nedover ville
       lyssatt seg motsatt av sin egen skygge. Regnet ut på samme relative
       luminans som ratioene over, så «lysest» er målt og ikke øyemål.
   11. DEN MØRKE DRAKTEN har sin egen halvdel av kontrakten (docs/mork-drakt.md).
       Kravene er de samme, flatene er andre — og noen av dem er blandinger, så
       de regnes ut her i stedet for å stå som en verdi noen kan glemme å
       oppdatere:
         a. blekket (--ink/--ink-soft) og de tre -ink-tokenene på de mørke
            flatene;
         b. --focus mot board-bakgrunnen, panelflaten og ALLE 36 mørke
            palettfargene — det er derfor ringen snur til hvit;
         c. ikonstreken (--icon-ink) mot de samme flatene, pluss platene;
         d. KORTSUBTREET (`:root[data-theme="dark"] .card`): platene, korthodet,
            kategorifordypningen og meta-chipen er `color-mix()`-blandinger av
            kortets EGEN palettfarge og en nøytral reserve (ikke lenger en fast
            mørk verdi) — testen simulerer blandingen per palettfarge og
            sjekker --ink/--ink-soft oppå (4.5:1), den tonale trappa mellom
            flatene, og at avkryssingskanten/aksentstripen (--card-accent,
            speilet fra paintCardColor() i app.js) holder 3:1 mot platen;
         e. trafikklyset mot den mørke statuspillen;
         f. at L-settene faktisk speiler hverandre: den mørke rekka gir samme
            spredning mot sin bakgrunn som den lyse gir mot sin.

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

/* ---------- 10. Den mørke drakten ----------
   Samme regnestykke, andre flater. Tokenene leses ut av `:root[data-theme=
   "dark"]`-blokken på nøyaktig samme måte som de lyse leses ut av `:root`, så
   en endret verdi der slår ut her og ikke i produksjon. */
console.log('\n=================== MØRK DRAKT ===================');
// Kommentarene strippes først: blokken er full av «/* på --surface: 12.76:1 */»,
// og et naivt token-søk ville plukket opp tallet i forklaringen i stedet for
// verdien i deklarasjonen.
const darkBlock = ((css.match(/:root\[data-theme="dark"\]\s*\{([\s\S]*?)\n\}/) || [])[1] || '')
  .replace(/\/\*[\s\S]*?\*\//g, '') || null;
check('styles.css har en :root[data-theme="dark"]-blokk', !!darkBlock);
if (darkBlock) {
  const dtoken = (name) => {
    const m = darkBlock.match(new RegExp('--' + name + '\\s*:\\s*([^;]+);'));
    return m ? m[1].trim() : token(name);   // ikke overstyrt ⇒ arvet fra :root
  };

  /* De 18 mørke palettfargene regnes ut av de SAMME konstantene som app.js
     bruker, lest ut av app.js — ikke skrevet av her. Endrer noen L-settet,
     flytter tallene under seg. */
  const appSrc = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
  const setsRaw = (appSrc.match(/COLOR_LIGHTNESS_BY_THEME\s*=\s*\{([^}]*)\}/) || [])[1] || '';
  const readSet = (name) => {
    const m = setsRaw.match(new RegExp(name + '\\s*:\\s*\\[([^\\]]*)\\]'));
    return m ? m[1].split(',').map((s) => parseFloat(s)) : [];
  };
  const L_LIGHT = readSet('light');
  const L_DARK = readSet('dark');
  const SAT = parseFloat((appSrc.match(/const COLOR_SAT\s*=\s*(\d+)/) || [])[1]);
  check('L-settene og metningen ble lest ut av app.js',
    L_LIGHT.length === 3 && L_DARK.length === 3 && SAT > 0, { L_LIGHT, L_DARK, SAT });

  function hslHex(h, s, l) {
    s /= 100; l /= 100;
    const a = s * Math.min(l, 1 - l);
    const f = (n) => {
      const k = (n + h / 30) % 12;
      const c = l - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)));
      return Math.round(255 * c).toString(16).padStart(2, '0');
    };
    return '#' + f(0) + f(8) + f(4);
  }
  // Tonene er de samme i begge drakter (buildHueOrder, 12 toner à 30°).
  const HUES = Array.from({ length: 12 }, (_, i) => i * 30);
  const paletteFor = (Ls) => Ls.flatMap((L) => HUES.map((h) => hslHex(h, SAT, L)));
  const DARK_PALETTE = paletteFor(L_DARK);

  const D_BG = dtoken('bg');
  const D_SURFACES = [
    ['board-bakgrunnen', D_BG],
    ['panelflaten (--surface)', dtoken('surface')],
    ['seksjonsflaten (--surface-2)', dtoken('surface-2')],
    ['feltflaten (--surface-3)', dtoken('surface-3')],
  ];
  // Statuspillen er --control-bg (nå et hvitt LØFT) over board-bakgrunnen.
  const D_PILL = over(dtoken('control-bg'), D_BG);

  console.log('\n--- Blekk på de mørke flatene ---');
  for (const t of ['ink', 'ink-soft', 'danger-ink', 'primary-ink', 'note-ink']) {
    for (const [what, s] of D_SURFACES.slice(1)) {
      contrast(`--${t} (${dtoken(t)}) som tekst på ${what}`, dtoken(t), s, 4.5);
    }
  }

  console.log('\n--- Fokusringen (--focus) i mørk drakt ---');
  // Den LYSE ringen er ulovlig her, og den mørke er ulovlig der — det er hele
  // grunnen til at tokenet snur. Begge halvdelene låses.
  for (const [what, s] of D_SURFACES) contrast(`--focus (${dtoken('focus')}) mot ${what}`, dtoken('focus'), s, 3);
  contrast(`--focus mot statuspillen (${D_PILL})`, dtoken('focus'), D_PILL, 3);
  {
    const worst = DARK_PALETTE
      .map((c) => [c, ratio(dtoken('focus'), c)])
      .reduce((a, b) => (a[1] < b[1] ? a : b));
    check(`--focus mot alle ${DARK_PALETTE.length} mørke palettfarger — svakeste ${worst[1].toFixed(2)}:1 (${worst[0]}, krav 3:1)`,
      worst[1] >= 3, { farge: worst[0], ratio: +worst[1].toFixed(2) });
    const lys = ratio(FOCUS, D_BG);
    check(`den LYSE drakts fokusring ville vært usynlig her (${lys.toFixed(2)}:1) — derfor snur tokenet`,
      lys < 3, +lys.toFixed(2));
  }

  console.log('\n--- Ikonstreken (--icon-ink) i mørk drakt ---');
  for (const [what, s] of D_SURFACES) contrast(`--icon-ink (${dtoken('icon-ink')}) mot ${what}`, dtoken('icon-ink'), s, 3);
  {
    const worst = DARK_PALETTE
      .map((c) => [c, ratio(dtoken('icon-ink'), c)])
      .reduce((a, b) => (a[1] < b[1] ? a : b));
    check(`--icon-ink mot alle mørke palettfarger — svakeste ${worst[1].toFixed(2)}:1 (${worst[0]}, krav 3:1)`,
      worst[1] >= 3, { farge: worst[0], ratio: +worst[1].toFixed(2) });
  }
  // …og at ikonene på de fargede knappene IKKE fulgte med. Gradientene er de
  // samme i begge drakter, så et lyst ikon der ville falt under 3:1.
  {
    const pin = (css.match(/\n\.btn-solid\s*\{([^}]*)\}/) || [])[1] || '';
    check('.btn-solid pinner --icon-ink/--icon-paper/--ink tilbake til de lyse verdiene',
      /--icon-ink:\s*#111111/.test(pin) && /--icon-paper:\s*#ffffff/.test(pin) && /--ink:\s*#37343f/.test(pin),
      pin.replace(/\s+/g, ' ').trim());
  }

  /* ---------- Kortsubtreet: color-mix() mot :root[data-theme="dark"] .card ----------
     Platene, korthodet, kortflaten og kategorifordypningen er ikke lenger en
     fast mørk verdi eller en halvgjennomsiktig plate: de er en `color-mix()`-
     blanding av kortets EGEN palettfarge og en nøytral reserve, satt PER kort
     (custom properties på `.card`, ikke i :root — se docs/mork-drakt.md).
     Blokken parses her på samme måte som `:root[data-theme="dark"]`, og
     blandingen simuleres per palettfarge — nøyaktig det nettleseren selv
     regner ut. */
  const cardDarkBlock = ((css.match(/:root\[data-theme="dark"\]\s*\.card\s*\{([\s\S]*?)\n\}/) || [])[1] || '')
    .replace(/\/\*[\s\S]*?\*\//g, '') || null;
  check('styles.css har en :root[data-theme="dark"] .card-blokk', !!cardDarkBlock);
  // «X % av var(--card-bg) blandet med #hex» — leser den SISTE (vinnende)
  // deklarasjonen av tokenet: fallback-hexen står FØR color-mix()-utgaven på
  // samme token (for nettlesere uten color-mix), så regexen treffer bevisst
  // kun color-mix()-formen.
  function cardMixToken(name) {
    const re = new RegExp('--' + name + '\\s*:\\s*color-mix\\(in srgb, var\\(--card-bg\\) (\\d+)%, (#[0-9a-f]{6})\\)', 'i');
    const m = cardDarkBlock && cardDarkBlock.match(re);
    return m ? { pct: Number(m[1]) / 100, neutral: m[2] } : null;
  }
  function mix(pct, base, neutral) {
    const [br, bg, bb] = rgb(base), [nr, ng, nb] = rgb(neutral);
    const to = (v) => Math.round(v).toString(16).padStart(2, '0');
    return '#' + to(br * pct + nr * (1 - pct)) + to(bg * pct + ng * (1 - pct)) + to(bb * pct + nb * (1 - pct));
  }
  // Speiler lighten() i app.js (paintCardColor): --card-accent finnes ikke som
  // et CSS-token — det settes inline per kort av JS — så testen regner det ut
  // selv, akkurat som DARK_PALETTE speiler colorForIndex(). Faktoren (0,34)
  // leses ut av selve linja i app.js, ikke skrevet av her — endrer noen den,
  // flytter tallene under seg i stedet for å stå og lyve om en verdi som ikke
  // lenger finnes.
  // Ankret til EGENSKAPSNAVNET, ikke bare mønsteret «dark ? lighten(base, …)» —
  // det mønsteret finnes også på linja over (--card-head, faktor 0,08), og et
  // uanker søk traff den i stedet ved en tidligere runde av denne testen.
  const accentFactor = parseFloat((appSrc.match(
    /setProperty\('--card-accent',\s*dark \? lighten\(base, ([\d.]+)\)/) || [])[1]);
  check('lysne-faktoren til --card-accent ble lest ut av app.js', accentFactor > 0, accentFactor);
  function jsLighten(hex, amt) {
    const [r, g, b] = rgb(hex);
    const to = (c) => Math.min(255, Math.round(c + (255 - c) * amt)).toString(16).padStart(2, '0');
    return '#' + to(r) + to(g) + to(b);
  }
  const CARD_ACCENT = DARK_PALETTE.map((c) => jsLighten(c, accentFactor || 0.34));

  console.log('\n--- Kortflatene i mørk drakt (color-mix mot palettfargen) ---');
  for (const [what, tok, ink, need] of [
    ['korthodet', 'card-head-face', 'ink', 4.5],
    ['korthodet (dempet blekk)', 'card-head-face', 'ink-soft', 4.5],
    ['listepunkt-platen', 'plate', 'ink', 4.5],
    ['listepunkt-platen (dempet blekk)', 'plate', 'ink-soft', 4.5],
    ['den utførte platen', 'plate-done', 'ink', 4.5],
    ['meta-chipen', 'chip-bg', 'ink-soft', 4.5],
    ['kategorifordypningen', 'cat-face', 'ink', 4.5],
  ]) {
    const m = cardMixToken(tok);
    check(`--${tok} er en color-mix() mot --card-bg`, !!m);
    if (!m) continue;
    const worst = DARK_PALETTE
      .map((c) => { const s = mix(m.pct, c, m.neutral); return [c + ' → ' + s, ratio(dtoken(ink), s)]; })
      .reduce((a, b) => (a[1] < b[1] ? a : b));
    check(`--${ink} på ${what} over alle mørke kortfarger — svakeste ${worst[1].toFixed(2)}:1 (${worst[0]}, krav ${need}:1)`,
      worst[1] >= need, { verst: worst[0], ratio: +worst[1].toFixed(2) });
  }

  console.log('\n--- Kortets tonale trapp (mørk drakt) ---');
  // Rekkefølgen dokumentert i docs/mork-drakt.md: board < kategorifordypning <
  // kortflate < listepunkt < korthode — hvert NABOPAR i den kjeden, ikke bare
  // ytterpunktene, ellers ville et par kunnet kollapse eller bytte plass midt i
  // uten at testen la merke til det.
  //
  // `ratio()` er SYMMETRISK (samme forhold uansett hvilken side som er lysest),
  // så den alene kan ikke fange at et trinn har snudd RETNING — bare at det har
  // en viss AVSTAND. Hvert par sjekkes derfor to ting: relativ luminans i riktig
  // retning (B strengt lysere enn A, for samtlige 36 fargetoner) OG ratioen som
  // et separat minimumsgulv, satt med god margin under de faktisk målte
  // verdiene (se steps.js-verifiseringen i PR-en).
  {
    const face = cardMixToken('card-face'), head = cardMixToken('card-head-face'),
      plate = cardMixToken('plate'), cat = cardMixToken('cat-face');
    const alle = !!(face && head && plate && cat);
    check('--card-face/--card-head-face/--plate/--cat-face er alle color-mix()', alle);
    if (alle) {
      // `spec` er enten en fast hex-streng (board-bakgrunnen) eller
      // {pct, neutral} fra cardMixToken — begge løses til den faktiske
      // flaten for en gitt palettfarge.
      const at = (spec, c) => (typeof spec === 'string' ? spec : mix(spec.pct, c, spec.neutral));
      const orderedStep = (specA, specB, floor, label) => {
        const rows = DARK_PALETTE.map((c) => {
          const a = at(specA, c), b = at(specB, c);
          return { a, b, retning: lum(b) > lum(a), ratio: ratio(a, b) };
        });
        const feilRetning = rows.filter((r) => !r.retning);
        check(`${label}: B er lysere enn A for alle ${DARK_PALETTE.length} fargene (riktig retning)`,
          feilRetning.length === 0, feilRetning.slice(0, 3).map((r) => r.a + ' → ' + r.b));
        const worst = Math.min(...rows.map((r) => r.ratio));
        check(`${label} — svakeste trinn ${worst.toFixed(2)}:1 (gulv ${floor}:1)`, worst >= floor, +worst.toFixed(2));
      };
      orderedStep(D_BG, cat, 1.02, 'board → kategorifordypning');
      orderedStep(cat, face, 1.05, 'kategorifordypning → kortflate');
      orderedStep(face, plate, 1.03, 'kortflate → listepunkt');
      orderedStep(plate, head, 1.05, 'listepunkt → korthode');
    }
  }

  console.log('\n--- Aksentstripen og avkryssingskanten (--card-accent) i mørk drakt ---');
  {
    const plateMix = cardMixToken('plate'), headMix = cardMixToken('card-head-face');
    const beggeFinnes = !!(plateMix && headMix);
    check('--plate/--card-head-face finnes for stripe-/avkryssingssjekkene', beggeFinnes);
    if (beggeFinnes) {
      // Avkryssingskanten er en EKTE UI-kontroll (kanten rundt boksen) — 3:1 er
      // et hardt krav, og er det som BINDER hvor mye platen kan lysnes (se
      // docs/mork-drakt.md).
      const accentPlate = DARK_PALETTE.map((c, i) => ratio(CARD_ACCENT[i], mix(plateMix.pct, c, plateMix.neutral)));
      const worstPlate = Math.min(...accentPlate);
      check(`avkryssingskanten (--card-accent) mot platen — svakeste ${worstPlate.toFixed(2)}:1 (krav 3:1)`,
        worstPlate >= 3, +worstPlate.toFixed(2));

      // Aksentstripen er SAMME token, men mot korthodet — og er dekorativ
      // (ingen tekst står på den). Kravet er ikke et nytt 3:1-gulv (se --scrim
      // under for samme presedens), men at den ikke svekkes under det som er
      // målt og dokumentert: en regresjonsvakt, ikke en ny kontrakt.
      const accentHead = DARK_PALETTE.map((c, i) => ratio(CARD_ACCENT[i], mix(headMix.pct, c, headMix.neutral)));
      const worstHead = Math.min(...accentHead);
      check(`aksentstripen (--card-accent) mot korthodet holder seg synlig — svakeste ${worstHead.toFixed(2)}:1 (gulv 2.7:1, dekorativ — ikke et 3:1-krav)`,
        worstHead >= 2.7, +worstHead.toFixed(2));
    }
  }

  console.log('\n--- Ikonene på de fargede statuschipene ---');
  /* Chipen har seks toner — de samme seks bøttene som «Kommende hendelser»
     (docs/scheduling.md). De er fargede flater som IKKE er .btn-solid, så de
     fanges ikke av knappenes pinning. I mørk drakt snur ikonstreken til
     --icon-ink, og det er en forbedring på de MØRKE flatene (blågrønt, rødt) —
     men de LYSE (gul, grønn, lilla, blå) kan like lite bære en lys strek som en
     hvit tekst. De pinner derfor streken mørk, som .btn-yellow gjør. */
  {
    // De fire lyse flatene pinner; de to mørke gjør det ikke.
    const LYSE = [['is-soon', 'grad-yellow'], ['is-later', 'grad-green'],
      ['is-startsoon', 'grad-purple'], ['is-startlater', 'grad-blue']];
    // Pinningen står i den DELTE regelen (alle fire i én selektorliste), så den
    // leses ut derfra og ikke fra hver enkelt flate-regel.
    const pinRule = (css.match(/\.meta-chip\.is-soon,[\s\S]*?\{([^}]*)\}/) || [])[1] || '';
    const pinned = (pinRule.match(/--icon-ink:\s*(#[0-9a-f]{3,8})/i) || [])[1];
    const paper = (pinRule.match(/--icon-paper:\s*(#[0-9a-f]{3,8})/i) || [])[1];
    check('de LYSE chipene pinner en MØRK ikonstrek (en lys flate bærer ikke lyse merker)',
      !!pinned && lum(pinned) < 0.1, { regel: pinRule.replace(/\s+/g, ' ').trim(), pinned });
    /* Og «papiret» sammen med den: kalender-/klokkeikonene har en hvit flate
       under strekene. Pinnes bare streken, møter mørk strek mørkt papir. */
    check('de LYSE chipene pinner «papiret» sammen med streken',
      !!paper && lum(paper) > 0.5, { paper });
    if (paper && pinned) {
      contrast('den pinnede streken mot det pinnede papiret på chipene', pinned, paper, 3);
    }
    for (const [navn, g] of LYSE) {
      // Flaten må være med i den pinnede selektorlisten — en ny tone som glemmes
      // der ville fått en lys strek på en lys flate uten at noe annet sa fra.
      check(`.meta-chip.${navn} er med i den pinnede regelen`,
        new RegExp('\\.meta-chip\\.' + navn + '[,\\s]').test(pinRule ? css.slice(0, css.indexOf(pinRule)) : ''),
        { tone: navn });
      const stops = gradientStops(g);
      for (const stop of stops) {
        contrast(`den pinnede streken (${pinned}) på .meta-chip.${navn} (${stop})`, pinned || '#111111', stop, 3);
      }
      /* …og BEGRUNNELSEN for pinningen: en lys strek ville falt igjennom et
         sted på flaten. Kravet er per GRADIENT, ikke per stopp — en gradient
         males som én flate, og faller streken på det lyseste stoppet, er hele
         flaten uegnet. (På grønt klarer det mørkeste stoppet så vidt 3:1 med
         lys strek; det lyseste gjør det ikke, og da pinnes begge.) */
      const verst = Math.min(...stops.map((stop) => ratio(dtoken('icon-ink'), stop)));
      check(`lys strek ville falt igjennom på .meta-chip.${navn} (svakeste ${verst.toFixed(2)}:1) — derfor pinningen`,
        verst < 3, +verst.toFixed(2));
    }
    // De to MØRKE chipene beholder den lyse streken, og skal være BEDRE enn
    // den svarte de har i lys drakt.
    for (const [navn, g] of [['is-started', 'grad-accent'], ['is-over', 'grad-red']]) {
      for (const stop of gradientStops(g)) {
        contrast(`lys strek på .meta-chip.${navn} (${stop})`, dtoken('icon-ink'), stop, 3);
      }
    }
  }

  console.log('\n--- Statusflatene i «Kommende hendelser» ---');
  /* PINNINGEN FØLGER PLATEN, ikke modalen: gruppens statusikon (`.event-icon`)
     står på en kontraktsgradient som er den samme i begge drakter, så det
     pinner streken mørk for seg selv — se docs/kommende-hendelser.md. Da må
     hver eneste gruppeflate bære den svarte streken på 3:1, også de to som
     bare finnes her (startgruppene skal ikke låne varselfargene).

     Modalen som HELHET skal ikke pinne noe. Radens typeikon står rett på
     modalflaten, som snur med drakten, og kategori-ikonet er bare streker uten
     «papir» å bli sett på — pinnet mørkt forsvant det i en mørk rad. Streken
     der er --icon-ink, som allerede måles mot --surface-2 lenger oppe. */
  {
    const modalRule = (css.match(/\.events-modal\s*\{([^}]*)\}/) || [])[1] || '';
    check('.events-modal pinner IKKE ikonfargene — radens typeikon følger drakten',
      !/--icon-(ink|paper|grey)\s*:/.test(modalRule), { regel: modalRule.trim() });
    const iconRule = (css.match(/\.event-icon\s*\{([^}]*)\}/) || [])[1] || '';
    const pinned = iconRule.match(/--icon-ink:\s*(#[0-9a-f]{3,8})/i);
    check('.event-icon pinner en MØRK ikonstrek på sin egen kontraktsflate',
      !!pinned && lum(pinned[1]) < 0.1, { pinned: pinned && pinned[1] });
    const paper = iconRule.match(/--icon-paper:\s*(#[0-9a-f]{3,8})/i);
    check('.event-icon pinner «papiret» sammen med streken',
      !!paper && lum(paper[1]) > 0.5, { paper: paper && paper[1] });
    const strek = (pinned && pinned[1]) || '#111111';
    const ark = (paper && paper[1]) || '#ffffff';
    /* Ikonene her er PLATE-ikoner: en hvit flate med mørke streker oppå. Streken
       tegnes altså på «papiret», ikke rett på gruppeflaten, og det er derfor
       ikke streken alene som må skille seg fra flaten — det holder at ÉN av de
       to gjør det. På de lyse flatene (gul, grønn, lilla, blå) er det streken,
       på de mørke (rød, blågrønn) er det papiret. Kravet er at hver eneste
       gruppeflate har minst én av delene på 3:1, ellers blir glyfen en klatt. */
    for (const g of ['grad-red', 'grad-yellow', 'grad-green', 'grad-accent', 'grad-purple', 'grad-blue']) {
      for (const stop of gradientStops(g)) {
        const vStrek = ratio(strek, stop);
        const vArk = ratio(ark, stop);
        check(`--${g} (${stop}) skiller seg fra ikonet — strek ${vStrek.toFixed(2)}:1 / papir ${vArk.toFixed(2)}:1 (krav 3:1 på én av dem)`,
          Math.max(vStrek, vArk) >= 3, { strek: +vStrek.toFixed(2), papir: +vArk.toFixed(2) });
      }
    }
    // Og streken må alltid skille seg fra papiret den faktisk ligger på.
    contrast('den pinnede streken mot det pinnede papiret i modalen', strek, ark, 3);

    /* Varselmodalen (docs/varsler.md) GJENBRUKER de samme statusflatene: et
       varsel om en utløpt frist skal se ut som gruppen «Frist utløpt» gjør, og
       arver dermed pinningen og målingene over. Kravet her er bare at modalen
       selv ikke pinner noe — da ville radenes øvrige tekst og glyfer sluttet å
       snu med drakten. */
    const notifRule = (css.match(/\.notif-modal\s*\{([^}]*)\}/) || [])[1] || '';
    check('.notif-modal pinner IKKE ikonfargene — den arver statusflatene fra .event-icon',
      !/--icon-(ink|paper|grey)\s*:/.test(notifRule), { regel: notifRule.trim() });
    const notifIcon = /\.notif-[a-z-]*\s*\{[^}]*--icon-(ink|paper|grey)\s*:/.test(css);
    check('ingen .notif-regel pinner sine egne ikonfarger', !notifIcon);
  }

  console.log('\n--- Varsel-toastene ---');
  /* Toasten som springer ut fra bjellen (docs/varsler.md) bærer varseltypens
     EGEN farge, halvgjennomsiktig med backdrop-blur. Da er flaten ikke lenger
     en kjent verdi: den blandes med hva som enn ligger under. Kravet regnes
     derfor på begge ytterpunktene — helt hvitt og helt svart bak — og teksten
     må klare 4.5:1 mot BEGGE. Tinten skal dessuten være den MØRKESTE enden av
     den samme gradienten ikonet står på: det er den som bærer tekstfargen sin
     med margin, og det er den som knytter toasten til statusflaten. */
  {
    const TONES = [['is-over', 'grad-red'], ['is-soon', 'grad-yellow'],
      ['is-started', 'grad-accent'], ['is-startsoon', 'grad-purple']];
    const hex2 = (n) => Math.round(n).toString(16).padStart(2, '0');
    const composite = (tint, alpha, backdrop) => {
      const C = rgb(tint), B = rgb(backdrop);
      return '#' + [0, 1, 2].map((i) => hex2(alpha * C[i] + (1 - alpha) * B[i])).join('');
    };
    for (const [tone, grad] of TONES) {
      const rule = (css.match(new RegExp('\\.notif-toast\\.' + tone + '\\s*\\{([^}]*)\\}')) || [])[1] || '';
      const bg = rule.match(/background:\s*rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)/);
      const ink = (rule.match(/--toast-ink:\s*(#[0-9a-f]{3,8})/i) || [])[1];
      check(`.notif-toast.${tone} har en halvgjennomsiktig flate og en pinnet tekstfarge`,
        !!bg && !!ink, { regel: rule.replace(/\s+/g, ' ').trim() });
      if (!bg || !ink) continue;
      const tint = '#' + [1, 2, 3].map((i) => hex2(+bg[i])).join('');
      const alpha = parseFloat(bg[4]);
      check(`.notif-toast.${tone} bruker den mørkeste enden av --${grad} (${tint})`,
        gradientStops(grad).slice(-1)[0].toLowerCase() === tint.toLowerCase(),
        { tint, gradient: gradientStops(grad) });
      // Delvis gjennomsiktig, men ikke så mye at flaten forsvinner.
      check(`.notif-toast.${tone} er faktisk gjennomsiktig (alfa ${alpha})`,
        alpha > 0 && alpha < 1, { alpha });
      for (const [navn, backdrop] of [['hvit bakgrunn', '#ffffff'], ['svart bakgrunn', '#000000']]) {
        contrast(`teksten (${ink}) på .notif-toast.${tone} over ${navn}`,
          ink, composite(tint, alpha, backdrop), 4.5);
      }
    }
    // Fokusringen på toasten er den samme som på de andre mørke flatene.
    check('varsel-toasten bruker --focus-on-dark som fokusring',
      /\.notif-toast:focus-visible\s*\{[^}]*--focus-on-dark/.test(css));
  }

  console.log('\n--- Kontroller som bytter farge ved hover / under draging ---');
  /* To signaler tegnes med en FAST farge oppå noe som skifter med drakten, og
     begge falt igjennom da paletten ble mørk. Kravet her er ikke bare 3:1 der
     det er oppnåelig — det er at den mørke drakten ikke skal være DÅRLIGERE
     enn den lyse. Derfor måles begge draktene mot hver sin palett. */
  {
    // Avkryssingsboksens hover-kant, mot platen den ligger på (nå en
    // color-mix()-blanding — se cardMixToken over). Hvilekanten (--card-accent)
    // klarer 3:1; hover skal ikke gjøre kontrollen utydeligere.
    const plateForHover = cardMixToken('plate');
    check('--plate finnes for hover-sjekken', !!plateForHover);
    const worst = plateForHover && DARK_PALETTE
      .map((c) => { const p = mix(plateForHover.pct, c, plateForHover.neutral); return [c + ' → ' + p, ratio(dtoken('check-hover'), p)]; })
      .reduce((a, b) => (a[1] < b[1] ? a : b));
    if (worst) {
      check(`--check-hover (${dtoken('check-hover')}) mot platen over alle mørke kortfarger — svakeste ${worst[1].toFixed(2)}:1 (${worst[0]}, krav 3:1)`,
        worst[1] >= 3, { verst: worst[0], ratio: +worst[1].toFixed(2) });
      // Den lyse drakts --primary klarer så vidt 3:1 mot den NYE, lysere platen
      // (den gjorde det ikke mot den gamle, halvgjennomsiktig svarte platen) —
      // men med langt mindre margin enn det dedikerte hover-tokenet. Kravet er
      // derfor ikke lenger «ville vært ulovlig», men at --check-hover gir en
      // TRYGGERE margin enn å bare arve den lyse drakts grønnfarge ville gjort.
      const naiv = DARK_PALETTE
        .map((c) => ratio(token('primary'), mix(plateForHover.pct, c, plateForHover.neutral)))
        .reduce((a, b) => Math.min(a, b));
      check(`--check-hover gir bedre margin (${worst[1].toFixed(2)}:1) enn den lyse drakts --primary ville gjort (${naiv.toFixed(2)}:1) — derfor et eget token`,
        worst[1] > naiv, { checkHover: +worst[1].toFixed(2), naiv: +naiv.toFixed(2) });
    }

    // Placeholderen: paritetskravet, mot board-bakgrunnen den ligger på. INGEN
    // av draktene når 3:1 der — den lyse bunner ut på ~1,2:1 — og flaten kommer
    // sammen med andre signaler. Kravet er derfor PARITET: den mørke drakten
    // skal ikke være dårligere enn den lyse.
    const phLight = ratio(over(token('scrim'), token('bg')), token('bg'));
    const phDark = ratio(over(dtoken('scrim'), D_BG), D_BG);
    check(`drag-placeholderen er minst like synlig i mørk drakt som i lys (mørk ${phDark.toFixed(2)}:1 mot lys ${phLight.toFixed(2)}:1)`,
      phDark >= phLight, { lys: +phLight.toFixed(2), mork: +phDark.toFixed(2) });
  }

  console.log('\n--- Trafikklyset mot den mørke statuspillen ---');
  for (const [what, t] of [['grønt «Lagret»', 'primary-ink'], ['gult «Lagrer …»', 'warn'],
    ['grått «Frakoblet»', 'ink-soft'], ['rødt «kunne ikke lagres»', 'danger-ink']]) {
    contrast(`statusprikk, ${what} = --${t} (${dtoken(t)}) mot pillen (${D_PILL})`, dtoken(t), D_PILL, 3);
  }

  console.log('\n--- L-settene speiler hverandre ---');
  /* Poenget med den mørke rekka er at kortene skiller seg fra board-et LIKE
     godt som de lyse gjør fra sitt. Kontrastforhold speiles ikke lineært i L,
     så en ren 100−L ville gitt et bunnsett som forsvant i bakgrunnen. Testen
     måler spredningen i begge drakter og krever at gulvet er det samme. */
  const spread = (pal, bg) => {
    const rs = pal.map((c) => ratio(c, bg));
    return { min: Math.min(...rs), max: Math.max(...rs) };
  };
  const sLight = spread(paletteFor(L_LIGHT), token('bg'));
  const sDark = spread(DARK_PALETTE, D_BG);
  check(`kortene skiller seg fra board-et i BEGGE drakter — lys ${sLight.min.toFixed(2)}–${sLight.max.toFixed(2)}:1, mørk ${sDark.min.toFixed(2)}–${sDark.max.toFixed(2)}:1`,
    sDark.min >= sLight.min * 0.9 && sDark.max >= sLight.max * 0.9,
    { lys: sLight, mork: sDark });
  check('tonene og metningen er de SAMME i begge drakter — kun L snur',
    !/COLOR_SAT_BY_THEME|HUE_ORDER_BY_THEME/.test(appSrc));

  console.log('\n--- Hvit korttittel på de mørke kortfargene (lys drakt sitt eget regnestykke) ---');
  /* Korttittelen er hvit med tekst-skygge og en tynn svart kontur i LYS drakt
     (.card-title, direkte på --card-bg). I MØRK drakt er tittelen i stedet
     --ink på --card-head-face — det dekkes av «Kortflatene i mørk drakt» over.
     Denne sjekken er ren dokumentasjon av LYS drakts egen kontur-begrunnelse:
     hvit tekst rett på den lyse paletten er det konturen kompenserer for. */
  const worstWhite = (pal) => pal.map((c) => ratio(WHITE, c)).reduce((a, b) => Math.min(a, b));
  const wLight = worstWhite(paletteFor(L_LIGHT));
  check(`hvit tittel på den lyse paletten trenger konturen (${wLight.toFixed(2)}:1, under 4.5:1)`,
    wLight < 4.5, +wLight.toFixed(2));
}

console.log(`\n==== ${passed}/${passed + failed} PASS ====`);
process.exit(failed ? 1 : 0);
