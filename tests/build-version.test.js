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
    5. To builds gir to forskjellige build-ID-er, og Vercels deploy-ID brukes
       når den finnes.
    5b. releaseId: den plattformuavhengige release-identiteten (de 12 første
       tegnene av commit-SHA-en) står i version.json OG i klienten, er den
       SAMME for to builds av samme commit — altså for web og Android — og er
       aldri Vercels deploy-ID.
    6. Tester/dokumentasjon/SQL publiseres ikke — og heller ikke npm-,
       Capacitor- eller native tooling (`docs/mobilapp-plan.md`): mobilskallet
       bygger PÅ `dist/`, det er ikke en del av den. `dist/` inneholder
       NØYAKTIG kildefilene og ingenting annet — en fil som ligger igjen i
       repo-roten deployes ellers stille.
    7. package.json uten `version` beholder `version.json.version = null`, slik
       at mobilprosjektets package.json ikke smugler inn SemVer-semantikk.
    8. vercel.json: no-store på /version.json, revalidering av HTML-en,
       langtidscache på de versjonerte filene, og ingen npm-install i
       produksjonsbuilden (`node build.js` har ingen avhengigheter).

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
function metaReleaseId(html) {
  const m = /<meta\s+name="huskis-release"\s+content="([^"]*)"/.exec(html);
  return m ? m[1] : null;
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'huskis-build-'));
const outA = path.join(tmp, 'a'), outB = path.join(tmp, 'b'), outC = path.join(tmp, 'c');
const outD = path.join(tmp, 'd'), outE = path.join(tmp, 'e');

// 1–4) En helt vanlig build (uten Vercel-variabler).
const a = runBuild(outA);
check('version.json finnes', fs.existsSync(path.join(outA, 'version.json')));
check('version.json har en ikke-tom buildId', typeof a.version.buildId === 'string' && a.version.buildId.length > 0);
check('version.json har version-feltet (SemVer eller null uten package.json)',
  a.version.version === null || typeof a.version.version === 'string');
/* Repoet HAR en package.json (den finnes kun for Capacitor-skallet), men uten
   `version`. Da skal `version` forbli null, og release-identiteten fortsatt
   utledes av commiten (`releaseId` under) — ellers ville mobilprosjektet
   stille ha innført SemVer i webreleasen. Se docs/auto-update.md og
   docs/mobilapp-plan.md. */
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
check('package.json har ikke et version-felt', !('version' in pkg));
check('version.json.version er null når package.json mangler version',
  a.version.version === null);
check('builtAt er et gyldig ISO-tidspunkt',
  typeof a.version.builtAt === 'string' && !isNaN(Date.parse(a.version.builtAt)) &&
  new Date(a.version.builtAt).toISOString() === a.version.builtAt);
check('klientens innebygde build-ID er identisk med version.json', metaBuildId(a.html) === a.version.buildId);

const src = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
check('kildekoden står fortsatt på «dev» (auto-oppdatering av i lokal utvikling)', metaBuildId(src) === 'dev');

const bid = a.version.buildId;
['app.js', 'icons.js', 'i18n.js', 'theme.js', 'config.js', 'update-check.js'].forEach((f) => {
  check('index.html laster ' + f + ' med ?b=<build-ID>', a.html.indexOf('src="' + f + '?b=' + bid + '"') > -1);
});
check('index.html laster styles.css med ?b=<build-ID>', a.html.indexOf('href="styles.css?b=' + bid + '"') > -1);
check('ingen uversjonerte app.js/styles.css-referanser igjen',
  !/(src|href)="(app\.js|styles\.css|icons\.js|i18n\.js|theme\.js|config\.js|update-check\.js)"/.test(a.html));

// 5) Unikhet + Vercels deploy-ID.
const b = runBuild(outB);
check('to builds gir forskjellige build-ID-er', b.version.buildId !== a.version.buildId);
const c = runBuild(outC, { VERCEL_DEPLOYMENT_ID: 'dpl_7Gw5ZMBpQA8h9GF832KGp7nwbuh3' });
check('Vercels deploy-ID brukes når den finnes', c.version.buildId === 'dpl_7Gw5ZMBpQA8h9GF832KGp7nwbuh3');
check('deploy-ID-en bygges også inn i klienten', metaBuildId(c.html) === c.version.buildId);

/* 5b) Release-ID-en: identiteten som følger KILDEN, ikke deployen.

   Den er det fase 4 i docs/mobilapp-plan.md handler om: web og Android bygges
   av hver sin `node build.js` over det samme treet, får hver sin build-ID —
   og skal likevel kunne si at de er den samme releasen. Derfor testes den på
   den egenskapen som skiller den fra build-ID-en: to builds av samme commit
   har LIK releaseId og ULIK buildId. Se docs/auto-update.md. */
check('version.json har en releaseId (12-tegns commit-SHA eller null)',
  a.version.releaseId === null || /^[0-9a-f]{12}$/.test(a.version.releaseId));
check('klientens innebygde release-ID er identisk med version.json',
  metaReleaseId(a.html) === (a.version.releaseId || 'dev'));
check('kildekoden står fortsatt på «dev» også for release-ID-en', metaReleaseId(src) === 'dev');
check('to builds av samme commit er SAMME release (lik releaseId)',
  'releaseId' in a.version && a.version.releaseId === b.version.releaseId);
check('…men hver sin build (ulik buildId)', a.version.buildId !== b.version.buildId);
/* Den ene misbruken fase 4 eksplisitt skal utelukke: Vercels deploy-ID er
   infrastruktur, ikke produktversjon. Den eier build-ID-en og bare den. */
check('Vercels deploy-ID blir ALDRI release-ID-en',
  c.version.releaseId !== c.version.buildId
  && (c.version.releaseId === null || /^[0-9a-f]{12}$/.test(c.version.releaseId)),
  String(c.version.releaseId));

const SHA = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
const d = runBuild(outD, { VERCEL_GIT_COMMIT_SHA: SHA, VERCEL_DEPLOYMENT_ID: 'dpl_annen_deploy_samme_commit' });
check('releaseId er de 12 første tegnene av commit-SHA-en',
  d.version.releaseId === SHA.slice(0, 12), String(d.version.releaseId));
check('commit beholder hele SHA-en ved siden av', d.version.commit === SHA);
check('release-ID-en bygges også inn i klienten', metaReleaseId(d.html) === SHA.slice(0, 12));
/* Samme commit, en annen deploy: dette ER web-mot-Android-tilfellet, uttrykt
   med de miljøvariablene de to byggene faktisk kjører med. */
const e = runBuild(outE, { GITHUB_SHA: SHA });
check('samme commit fra en ANNEN byggekjede gir samme releaseId',
  e.version.releaseId === d.version.releaseId, String(e.version.releaseId));
check('…og fortsatt hver sin buildId', e.version.buildId !== d.version.buildId);

// 6) Kun appen publiseres.
const names = fs.readdirSync(outA);
['tests', 'docs', 'supabase', 'build.js', 'vercel.json', 'CLAUDE.md', 'TODO.md']
  .forEach((n) => check('publiserer ikke ' + n, names.indexOf(n) === -1));
/* Byggetooling er IKKE web-assets. `dist/` er det som serveres fra huskis.no;
   npm-manifestet, lockfila, Capacitor-konfigurasjonen og de native prosjektene
   er input til builden. Havner de i `dist/`, publiseres avhengighetsgrafen og
   den native konfigurasjonen på et offentlig domene. `ios/` finnes ikke ennå,
   men står i SKIP-listen i build.js nettopp for at den aldri skal rekke å bli
   publisert den dagen den genereres. */
['package.json', 'package-lock.json', 'capacitor.config.json', 'android', 'ios', 'node_modules']
  .forEach((n) => check('publiserer ikke tooling: ' + n, names.indexOf(n) === -1));
/* …og heller ikke lenger nede i treet: `copyDir` filtrerer bare på toppnivå,
   så en tooling-fil i en underkatalog ville sluppet gjennom usett. */
function walk(dir, base, ut) {
  for (const n of fs.readdirSync(dir)) {
    const p = path.join(dir, n), rel = base ? base + '/' + n : n;
    if (fs.statSync(p).isDirectory()) walk(p, rel, ut); else ut.push(rel);
  }
  return ut;
}
const alle = walk(outA, '', []);
const lekkasjer = alle.filter((f) => /(^|\/)(package(-lock)?\.json|capacitor\.config\.json)$/.test(f)
  || /(^|\/)(node_modules|android|ios)\//.test(f));
check('ingen tooling-filer noe sted i dist/ [' + (lekkasjer.join(', ') || 'ingen') + ']',
  lekkasjer.length === 0);

['app.js', 'styles.css', 'icons.js', 'i18n.js', 'theme.js', 'config.js', 'update-check.js', 'favicon.svg', 'assets', 'vendor']
  .forEach((n) => check('publiserer ' + n, names.indexOf(n) > -1));

/* Og INGENTING ELLERS. Nektelistene over fanger bare det de nevner ved navn,
   mens `copyDir` kopierer ALT annet på toppnivå som ikke står i SKIP. En fil
   som blir liggende igjen i repo-roten — et skjermbilde, en notatfil, en dump
   — deployes dermed til huskis.no uten at noe sier fra. Fasiten under er hele
   innholdet i en produksjonsbuild; testmodusens to filer kommer kun med i en
   preview-deploy (`security-headers`, `csp-enforced`). Legger du til en ekte
   kildefil, hører den hjemme her. */
const FASIT = ['index.html', 'version.json', 'favicon.svg', 'app.js', 'styles.css',
  'icons.js', 'i18n.js', 'theme.js', 'config.js', 'update-check.js', 'assets', 'vendor'];
const uventet = names.filter((n) => FASIT.indexOf(n) === -1);
check('publiserer ingenting utenom kildekoden [' + (uventet.join(', ') || 'ingen') + ']',
  uventet.length === 0);

// 7–8) Cache-headerne + install-steget.
const vc = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
const headerFor = (src) => {
  const e = (vc.headers || []).find((h) => h.source === src);
  const cc = e && (e.headers || []).find((x) => x.key === 'Cache-Control');
  return cc ? cc.value : '';
};
check('vercel.json bygger med build.js', vc.buildCommand === 'node build.js' && vc.outputDirectory === 'dist');
/* package.json finnes kun for Capacitor-skallet. `node build.js` har ingen
   avhengigheter, så produksjonsdeployen skal ikke installere Android-toolingen
   for å kopiere statiske filer. Tom streng = Vercel hopper over install-steget. */
check('vercel.json installerer ikke npm-avhengigheter i produksjonsbuilden',
  vc.installCommand === '');
check('/version.json caches ikke', /no-store/.test(headerFor('/version.json')));
check('/version.json caches heller ikke på CDN-et', ((vc.headers || [])
  .find((h) => h.source === '/version.json').headers || [])
  .some((x) => x.key === 'CDN-Cache-Control' && /no-store/.test(x.value)));
check('HTML-en revalideres (reload henter ny side)',
  /must-revalidate/.test(headerFor('/')) && /must-revalidate/.test(headerFor('/index.html')));
['/app.js', '/icons.js', '/i18n.js', '/theme.js', '/config.js', '/update-check.js', '/styles.css'].forEach((s) => {
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
