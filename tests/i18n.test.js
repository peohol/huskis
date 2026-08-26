#!/usr/bin/env node
/* ============================================================
   Språkordboken (i18n.js) og bruken av den. REN node-test — ingen server,
   ingen nettleser: dette er kildekode-kontrakten, ikke oppførsel i UI-et.

   Dekker:
     1. Hver rad i ordboken har BEGGE språk, som ikke-tomme strenger.
     2. `{felt}`-plassholderne er de samme i begge språkene (en oversettelse
        som mangler et felt gir et hull i setningen — ingen feilmelding).
     3. Ingen nøkkel er duplisert i fila.
     4. Hver nøkkel appen slår opp finnes i ordboken.
     5. Ingen ubrukte nøkler blir liggende igjen.
     6. Ingen brukerrettet norsk tekst er skrevet rett inn i app.js,
        index.html eller update-check.js utenom ordboken.
     7. index.html laster i18n.js FØR app.js, og build.js versjonerer den.
     8. `t()` faller tilbake på nøkkelen, fyller felt, og bytter språk.

   Kjør:
     node tests/i18n.test.js
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

let pass = 0, fail = 0;
function check(name, cond, evidence) {
  if (cond) { pass++; console.log('PASS: ' + name); }
  else { fail++; console.log('FAIL: ' + name + (evidence ? ' — ' + evidence : '')); }
}

/* ---------- Last i18n.js i et minimalt DOM-skall ---------- */
const win = {};
global.window = win;
global.document = { documentElement: { setAttribute() {} }, querySelectorAll: () => [] };
global.localStorage = { getItem: () => null, setItem() {} };
require(path.join(ROOT, 'i18n.js'));
const I18N = win.HUSKIS_I18N;
const T = I18N.T;
const LANGS = I18N.LANGS.map((l) => l.code);

check('i18n.js eksponerer window.HUSKIS_I18N', !!I18N);
check('språkene er nøyaktig norsk og engelsk, i den rekkefølgen',
  LANGS.join(',') === 'no,en', LANGS.join(','));
check('standardspråket er norsk', I18N.DEFAULT === 'no', I18N.DEFAULT);

/* ---------- 1–2. Radene i ordboken ---------- */
const fields = (s) => (s.match(/\{\w+\}/g) || []).sort().join(',');
const badRows = [];
const badFields = [];
Object.keys(T).forEach((k) => {
  const row = T[k];
  if (!Array.isArray(row) || row.length !== LANGS.length ||
      row.some((v) => typeof v !== 'string' || v === '')) { badRows.push(k); return; }
  if (fields(row[0]) !== fields(row[1])) badFields.push(k + ' (' + fields(row[0]) + ' vs ' + fields(row[1]) + ')');
});
check('hver rad har begge språk som ikke-tomme strenger', badRows.length === 0, badRows.join(', '));
check('{felt}-plassholderne er like i begge språkene', badFields.length === 0, badFields.join(', '));
check('ordboken er ikke tom', Object.keys(T).length > 100, Object.keys(T).length + ' nøkler');

/* ---------- 3. Ingen dupliserte nøkler i kildefila ---------- */
const i18nSrc = read('i18n.js');
const dictSrc = i18nSrc.slice(i18nSrc.indexOf('HUSKIS_I18N_DICT_START'),
                              i18nSrc.indexOf('HUSKIS_I18N_DICT_END'));
const declared = [...dictSrc.matchAll(/^\s*'([^']+)':\s*\[/gm)].map((m) => m[1]);
const dupes = declared.filter((k, i) => declared.indexOf(k) !== i);
check('ingen nøkkel er skrevet to ganger i i18n.js', dupes.length === 0, dupes.join(', '));
check('alle deklarerte nøkler kom med i ordboken',
  declared.length === Object.keys(T).length,
  declared.length + ' deklarert vs ' + Object.keys(T).length + ' i T');

/* ---------- 4–5. Nøklene appen faktisk bruker ---------- */
// Nøkler som slås opp dynamisk (`tr('count.' + kind + …)`). Prefikset står her
// fordi et statisk søk aldri kan finne den sammensatte nøkkelen.
// `theme.light`/`theme.dark` slås opp som `tr('theme.' + mode)` når
// innloggingsskjermens draktvelger bygges — men `theme.label`/`theme.aria`/
// `theme.notStored`/`theme.toLight`/`theme.toDark` står statisk, så hele
// prefikset kan ikke unntas.
const DYNAMIC_PREFIXES = ['count.', 'kindDef.'];
const DYNAMIC_KEYS = ['theme.light', 'theme.dark'];
const isDynamic = (k) => DYNAMIC_PREFIXES.some((p) => k.indexOf(p) === 0) || DYNAMIC_KEYS.indexOf(k) > -1;

const appSrc = read('app.js');
const htmlSrc = read('index.html');
const updSrc = read('update-check.js');

// Alt som SER UT som en nøkkel i JS-kildene ('felt.underfelt'), pluss
// data-i18n*-attributtene i HTML-en.
const KEY_RE = /^[a-z][A-Za-z0-9]*(?:\.[A-Za-z0-9]+)+$/;
const used = new Set();
[appSrc, updSrc].forEach((src) => {
  // `(?:[^'\n\\]|\\.)*` og ikke `[^'\n\\]+`: en TOM streng («''») må
  // konsumere begge anførselstegnene sine, ellers spiser mønsteret det
  // avsluttende og løper videre inn i nabo-strengen.
  for (const m of src.matchAll(/'((?:[^'\n\\]|\\.)*)'/g)) if (KEY_RE.test(m[1])) used.add(m[1]);
});
for (const m of htmlSrc.matchAll(/data-i18n(?:-[a-z-]+)?="([^"]+)"/g)) used.add(m[1]);

// «Ser ut som en nøkkel» treffer også ekte filnavn og MIME-typer; kun de som
// faktisk finnes i ordboken teller som brukt, og resten sjekkes mot at de ikke
// LIGNER en ordboksnøkkel som mangler.
const knownPrefixes = new Set(Object.keys(T).map((k) => k.split('.')[0]));
const missing = [...used].filter((k) => !T[k] && knownPrefixes.has(k.split('.')[0]) && !isDynamic(k));
check('hver nøkkel appen slår opp finnes i ordboken', missing.length === 0, missing.join(', '));

const unused = Object.keys(T).filter((k) => !used.has(k) && !isDynamic(k));
check('ingen ubrukte nøkler i ordboken', unused.length === 0, unused.join(', '));

// De dynamiske familiene skal være komplette — ett hull gir en rå nøkkel i UI-et.
['universe', 'group', 'card', 'item'].forEach((kind) => {
  check('count.' + kind + ' finnes i entall og flertall',
    !!T['count.' + kind + '.one'] && !!T['count.' + kind + '.other']);
});
['universe', 'group', 'card', 'item', 'category', 'groupcat'].forEach((kind) => {
  check('kindDef.' + kind + ' finnes', !!T['kindDef.' + kind]);
});

/* ---------- 6. Ingen norsk tekst utenom ordboken ---------- */
/* Heuristikken: en streng med æ/ø/å, eller med et av de norske ordene under,
   er brukerrettet tekst som hører hjemme i i18n.js. Unntakene er
   utviklerrettede kanaler (konsollen) og ordboken selv. */
const NORWEGIAN = /[æøåÆØÅ]|\b(og|eller|ikke|til|som|kan|skal|din|ditt|dine|med|uten)\b/;
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"])\/\/[^\n]*/g, '$1');
}
function norwegianLiterals(file, src) {
  const out = [];
  const lines = stripComments(src).split('\n');
  let inDevCall = false;   // et console.*/new Error(…) som går over flere linjer
  lines.forEach((line, i) => {
    /* Utviklerkanaler er unntatt: konsollen og `new Error(...)` leses av den
       som feilsøker, aldri av brukeren — en oversettelse der ville bare gjort
       feilsøkingen vanskeligere. Begge kan gå over flere linjer, så unntaket
       varer til uttrykket faktisk er lukket. */
    const startsDev = /console\.(log|warn|error|info)\(|new Error\(/.test(line);
    const isDev = inDevCall || startsDev;
    if (isDev) inDevCall = !/\);\s*$/.test(line.trim()) && !/^\s*}/.test(line);
    // update-check.js har fallback-teksten sin ved siden av nøkkelen
    // (`txt('nøkkel', 'norsk')`) — den sjekkes mot ordboken for seg.
    if (isDev || /\btxt\('/.test(line)) return;
    for (const m of line.matchAll(/'((?:[^'\n\\]|\\.){4,})'|"((?:[^"\n\\]|\\.){4,})"/g)) {
      const v = m[1] || m[2];
      if (!NORWEGIAN.test(v)) continue;
      if (/^[a-z0-9_.\-#[\]=$>:*, ]+$/i.test(v) && !/\s[a-zæøå]/i.test(v)) continue; // selektor/klasse
      out.push(file + ':' + (i + 1) + ' ' + JSON.stringify(v));
    }
  });
  return out;
}
const strayJs = norwegianLiterals('app.js', appSrc).concat(norwegianLiterals('update-check.js', updSrc));
check('ingen norsk brukertekst skrevet rett inn i app.js/update-check.js',
  strayJs.length === 0, strayJs.slice(0, 8).join(' | '));

/* update-check.js laster uten å kunne ta for gitt at ordboken er der (den er en
   egen fil), så hver `txt(nøkkel, fallback)` bærer den norske teksten med seg.
   Da må de to være IDENTISKE — ellers står banneret plutselig med to ulike
   norske formuleringer, avhengig av lasterekkefølgen. */
const fallbackMismatch = [];
for (const m of updSrc.matchAll(/txt\('([^']+)',\s*'([^']*)'\)/g)) {
  const row = T[m[1]];
  if (!row || row[0] !== m[2]) fallbackMismatch.push(m[1]);
}
check('fallback-teksten i update-check.js er lik den norske i ordboken',
  fallbackMismatch.length === 0, fallbackMismatch.join(', '));

/* index.html: hver tekstnode og hvert synlige attributt må ha et data-i18n. */
const htmlNoComments = htmlSrc
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/<svg[\s\S]*?<\/svg>/g, '')
  .replace(/<script[\s\S]*?<\/script>/g, '');
const strayHtml = [];
for (const m of htmlNoComments.matchAll(/(<[a-zA-Z][^<>]*>)\s*([^<>]+?)\s*</g)) {
  const [, tag, text] = m;
  if (!/[A-Za-zÆØÅæøå]{2}/.test(text)) continue;
  if (tag.indexOf('data-i18n') > -1) continue;
  if (['Huskis', 'Alt', 'Esc'].indexOf(text) > -1) continue;  // merkenavn + tastenavn
  strayHtml.push(JSON.stringify(text));
}
for (const m of htmlNoComments.matchAll(/\b(title|aria-label|placeholder)="([^"]*)"/g)) {
  if (!T[m[2]]) strayHtml.push(m[1] + '="' + m[2] + '"');
}
check('all synlig tekst i index.html går gjennom data-i18n',
  strayHtml.length === 0, strayHtml.slice(0, 8).join(' | '));

/* ---------- 6b. Omlastingen er betinget ----------
   Et språkbytte laster appen på nytt, men BARE når valget faktisk overlever
   omlastingen: enheten må ha lagret det, og kontoen må ha tatt imot det. Uten
   begge deler laster appen inn igjen på det gamle språket — og med en konto på
   et annet språk gjør den det om og om igjen. Vaktene er lette å fjerne ved et
   uhell, så de er festet her. */
check('setLanguage() laster bare på nytt når valget både er lagret og landet på kontoen',
  /if \(saved && onAccount\) \{ location\.reload\(\); return; \}/.test(appSrc));
check('setLanguage() sjekker Supabase sin `{ error }`, ikke bare unntak',
  /const \{ error \} = await acli\(\)\.auth\.updateUser\(\{ data: \{ lang/.test(appSrc) &&
  /authUser\.meta = prevMeta;/.test(appSrc));
check('adoptAccountLanguage() laster bare på nytt når enheten husket språket',
  /if \(I18N\.setLang\(want\)\) \{ location\.reload\(\); return; \}/.test(appSrc));

/* ---------- 7. Lasterekkefølge og build ---------- */
check('index.html laster i18n.js før app.js',
  htmlSrc.indexOf('src="i18n.js"') > -1 &&
  htmlSrc.indexOf('src="i18n.js"') < htmlSrc.indexOf('src="app.js"'));
const build = require(path.join(ROOT, 'build.js'));
check('build.js versjonerer i18n.js', build.VERSIONED.indexOf('i18n.js') > -1,
  build.VERSIONED.join(', '));
const vercel = JSON.parse(read('vercel.json'));
check('vercel.json langtidscacher /i18n.js',
  (vercel.headers || []).some((h) => h.source === '/i18n.js' &&
    (h.headers || []).some((x) => x.key === 'Cache-Control' && /immutable/.test(x.value))));

/* ---------- 8. t() ---------- */
check('t() gir norsk som standard', I18N.t('common.save') === 'Lagre', I18N.t('common.save'));
check('t() fyller {felt}',
  I18N.t('label.menuCard', { name: '«A»' }) === 'Meny for listen «A»',
  I18N.t('label.menuCard', { name: '«A»' }));
check('t() lar et ukjent {felt} stå urørt',
  I18N.t('label.menuCard') === 'Meny for listen {name}', I18N.t('label.menuCard'));
check('t() gir nøkkelen tilbake for en ukjent nøkkel',
  I18N.t('finnes.ikke') === 'finnes.ikke');
check('setLang() sier fra at valget ble lagret', I18N.setLang('en') === true);
check('setLang(en) bytter språk', I18N.t('common.save') === 'Save', I18N.t('common.save'));
check('chosen() er sann etter et eksplisitt valg', I18N.chosen() === true);
I18N.setLang('klingon');
check('ukjent språkkode faller til standarden', I18N.lang() === 'no', I18N.lang());

/* Privat modus / blokkerte nettsteddata: `setItem` kaster. Da MÅ `setLang`
   svare `false` — app.js laster bare appen på nytt når valget har overlevd, og
   uten det signalet ville en konto med et annet språk gitt en evig
   omlastingsløkke (se `adoptAccountLanguage` i app.js). */
global.localStorage.setItem = () => { throw new Error('QuotaExceededError'); };
check('setLang() sier fra når enheten IKKE kunne lagre valget',
  I18N.setLang('en') === false);
check('språket byttes i minnet likevel', I18N.lang() === 'en', I18N.lang());

console.log('\n==== ' + pass + '/' + (pass + fail) + ' PASS ====');
process.exit(fail ? 1 : 0);
