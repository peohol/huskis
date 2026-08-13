/*
  Test for BUILD-STEGET (build.js + vercel.json) — ingen nettleser, ingen
  Vercel-miljø. Kjører den ekte builden mot en midlertidig utdata-mappe.

  Verifiserer:
    1. /version.json finnes, har gyldig form (buildId/version/builtAt) og
       ISO-tidspunkt.
    2. Build-ID-en i version.json er NØYAKTIG den som er bygget inn i
       klienten (<meta name="huskis-build"> i index.html).
    3. Kildekoden er urørt: index.html i repoet står fortsatt på «dev», så
       lokal utvikling og nettlesertestene ikke får en falsk build-ID.
    4. JS/CSS lastes med ?b=<build-ID> (så en reload av HTML-en garantert
       henter ny kode, mens filene kan caches lenge).
    5. To builds gir to forskjellige ID-er, og Vercels deploy-ID brukes når
       den finnes.
    6. Tester/dokumentasjon/SQL publiseres ikke.
    7. vercel.json: no-store på /version.json, revalidering av HTML-en,
       langtidscache på de versjonerte filene.

  Kjør:
    node tests/build-version.test.js
*/
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;
function check(name, cond) { if (cond) { passed++; } else { failed++; console.log('  ✗ FAIL:', name); } }

function runBuild(out, env) {
  execFileSync(process.execPath, [path.join(ROOT, 'build.js'), '--out', out], {
    cwd: ROOT,
    env: Object.assign({}, process.env, { VERCEL_DEPLOYMENT_ID: '', VERCEL_GIT_COMMIT_SHA: '' }, env || {}),
    stdio: 'pipe',
  });
  return {
    version: JSON.parse(fs.readFileSync(path.join(out, 'version.json'), 'utf8')),
    html: fs.readFileSync(path.join(out, 'index.html'), 'utf8'),
    dir: out,
  };
}
function metaBuildId(html) {
  const m = /<meta\s+name="huskis-build"\s+content="([^"]*)"/.exec(html);
  return m ? m[1] : null;
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'huskis-build-'));
const outA = path.join(tmp, 'a'), outB = path.join(tmp, 'b'), outC = path.join(tmp, 'c');

// 1–4) En helt vanlig build (uten Vercel-variabler).
const a = runBuild(outA);
check('version.json finnes', fs.existsSync(path.join(outA, 'version.json')));
check('version.json har en ikke-tom buildId', typeof a.version.buildId === 'string' && a.version.buildId.length > 0);
check('version.json har version-feltet (SemVer eller null uten package.json)',
  a.version.version === null || typeof a.version.version === 'string');
check('builtAt er et gyldig ISO-tidspunkt',
  typeof a.version.builtAt === 'string' && !isNaN(Date.parse(a.version.builtAt)) &&
  new Date(a.version.builtAt).toISOString() === a.version.builtAt);
check('klientens innebygde build-ID er identisk med version.json', metaBuildId(a.html) === a.version.buildId);

const src = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
check('kildekoden står fortsatt på «dev» (auto-oppdatering av i lokal utvikling)', metaBuildId(src) === 'dev');

const bid = a.version.buildId;
['app.js', 'icons.js', 'i18n.js', 'config.js', 'update-check.js'].forEach((f) => {
  check('index.html laster ' + f + ' med ?b=<build-ID>', a.html.indexOf('src="' + f + '?b=' + bid + '"') > -1);
});
check('index.html laster styles.css med ?b=<build-ID>', a.html.indexOf('href="styles.css?b=' + bid + '"') > -1);
check('ingen uversjonerte app.js/styles.css-referanser igjen',
  !/(src|href)="(app\.js|styles\.css|icons\.js|i18n\.js|config\.js|update-check\.js)"/.test(a.html));

// 5) Unikhet + Vercels deploy-ID.
const b = runBuild(outB);
check('to builds gir forskjellige build-ID-er', b.version.buildId !== a.version.buildId);
const c = runBuild(outC, { VERCEL_DEPLOYMENT_ID: 'dpl_7Gw5ZMBpQA8h9GF832KGp7nwbuh3' });
check('Vercels deploy-ID brukes når den finnes', c.version.buildId === 'dpl_7Gw5ZMBpQA8h9GF832KGp7nwbuh3');
check('deploy-ID-en bygges også inn i klienten', metaBuildId(c.html) === c.version.buildId);

// 6) Kun appen publiseres.
const names = fs.readdirSync(outA);
['tests', 'docs', 'supabase', 'build.js', 'vercel.json', 'CLAUDE.md', 'TODO.md']
  .forEach((n) => check('publiserer ikke ' + n, names.indexOf(n) === -1));
['app.js', 'styles.css', 'icons.js', 'i18n.js', 'config.js', 'update-check.js', 'favicon.svg', 'assets', 'vendor']
  .forEach((n) => check('publiserer ' + n, names.indexOf(n) > -1));

// 7) Cache-headerne.
const vc = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
const headerFor = (src) => {
  const e = (vc.headers || []).find((h) => h.source === src);
  const cc = e && (e.headers || []).find((x) => x.key === 'Cache-Control');
  return cc ? cc.value : '';
};
check('vercel.json bygger med build.js', vc.buildCommand === 'node build.js' && vc.outputDirectory === 'dist');
check('/version.json caches ikke', /no-store/.test(headerFor('/version.json')));
check('/version.json caches heller ikke på CDN-et', ((vc.headers || [])
  .find((h) => h.source === '/version.json').headers || [])
  .some((x) => x.key === 'CDN-Cache-Control' && /no-store/.test(x.value)));
check('HTML-en revalideres (reload henter ny side)',
  /must-revalidate/.test(headerFor('/')) && /must-revalidate/.test(headerFor('/index.html')));
['/app.js', '/icons.js', '/i18n.js', '/config.js', '/update-check.js', '/styles.css'].forEach((s) => {
  check('langtidscache på ' + s, /immutable/.test(headerFor(s)) && /max-age=31536000/.test(headerFor(s)));
});
// vendor/ får ikke ?b=<build-ID>: versjonen står i filnavnet, så URL-en endrer
// seg av seg selv når innholdet gjør det.
check('langtidscache på /vendor/(.*)',
  /immutable/.test(headerFor('/vendor/(.*)')) && /max-age=31536000/.test(headerFor('/vendor/(.*)')));
// Fontfilene får ?b=<build-ID> like lite som vendor/: de lastes fra styles.css,
// ikke fra HTML-en, og versjonen står i filnavnet.
check('langtidscache på /assets/fonts/(.*)',
  /immutable/.test(headerFor('/assets/fonts/(.*)')) && /max-age=31536000/.test(headerFor('/assets/fonts/(.*)')));

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
