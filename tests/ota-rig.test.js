#!/usr/bin/env node
/* ============================================================
   MÅLERIGGEN (fase 5, `docs/mobilapp-plan.md`, «Den ødelagte bundelen kan ikke
   være en produksjonsrelease»).

   To av punktene enhetsøkten skal måle — rollback og karantene — krever en
   bundle som ALDRI når readiness-punktet. Produksjonsbundelen kan aldri være
   den: `release.yml` pakker nøyaktig den `dist/`-en som deployes til huskis.no.
   `.github/scripts/ota-rig.js` bygger derfor et eget skall som ikke kan nå
   produksjon i det hele tatt.

   Riggen er bare troverdig så lenge den er SMAL. Målingen kan overføres til
   produksjonsskallet fordi de to skiller seg i nøyaktig fem konstanter — hvem
   som signerer, og de fire stedene skallets egen adresse står (config.js,
   CSP-ens connect-src, origin-vakten i index.html og reserveverdien i
   canonicalAppUrl()) — og ingen av dem leses av rollback-timeren, pluginens
   blokkliste eller klientens karantene. Denne filen måler nettopp det, og at
   riggen ikke kan røre produksjon:

     1. patchen endrer de fem konstantene og ingenting annet
     2. riggmanifestet har samme form som produksjonens, og passerer klientens
        systemgrense — men bare med riggens egen vert som base
     3. bundelen er faktisk ødelagt: ingen readiness, og den kaster
     4. riggsignaturen verifiserer mot riggnøkkelen og IKKE mot den innebygde
        produksjonsnøkkelen
     5. riggen rører aldri produksjonens signeringsnøkkel
     6. riggens privatnøkkel kan ikke committes, og `ota/` er ikke i repoet

   Sjekk 6 er også vakten mot at en riggren merges: en gren med `ota/` i treet
   feiler HER, med vilje.

   Ren node-test — ingen server, ingen nettleser.

   Kjør:
     node tests/ota-rig.test.js
   ============================================================ */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const rig = require(path.join(ROOT, '.github', 'scripts', 'ota-rig.js'));
const ota = require(path.join(ROOT, '.github', 'scripts', 'ota-bundle.js'));

let pass = 0, fail = 0;
function check(navn, ok, evidens) {
  if (ok) { pass++; console.log('PASS — ' + navn + (evidens ? '  [' + evidens + ']' : '')); }
  else { fail++; console.log('FAIL — ' + navn + (evidens ? '  [' + evidens + ']' : '')); }
}

const rigKilde = fs.readFileSync(path.join(ROOT, '.github', 'scripts', 'ota-rig.js'), 'utf8');
const RIG_VERT = 'https://huskis-git-rigg-eksempel.vercel.app';

/* ---- 1. Patchen: nøyaktig fem konstanter, kjørt over de EKTE filene ---- */

const configJs = fs.readFileSync(path.join(ROOT, 'config.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const capJson = fs.readFileSync(path.join(ROOT, 'capacitor.config.json'), 'utf8');
const PROD_VERT = rig.readCanonical(configJs);

check('produksjonsverten leses ut av config.js', PROD_VERT === ota.BASE_URL.replace(/\/ota$/, ''),
  PROD_VERT);

// Antall linjer som skiller to tekster, og hvilke de er.
function endredeLinjer(f, e) {
  const a = f.split('\n'), b = e.split('\n');
  const ut = [];
  if (a.length !== b.length) return ['ULIKT ANTALL LINJER'];
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) ut.push(b[i].trim());
  return ut;
}

const nyConfig = rig.patchConfigJs(configJs, RIG_VERT);
const configDiff = endredeLinjer(configJs, nyConfig);
check('config.js: nøyaktig én linje endres', configDiff.length === 1, configDiff.join(' | '));
check('…og det er canonicalAppUrl, satt til riggverten',
  configDiff.length === 1 && configDiff[0] === "canonicalAppUrl: '" + RIG_VERT + "',", configDiff[0]);

const nyIndex = rig.patchCsp(indexHtml, PROD_VERT, RIG_VERT);
const indexDiff = endredeLinjer(indexHtml, nyIndex);
check('index.html: nøyaktig én linje endres', indexDiff.length === 1, indexDiff.join(' | '));
check('…og det er connect-src', indexDiff.length === 1 && /^connect-src /.test(indexDiff[0]));
/* Verten BYTTES, den legges ikke til: et riggskall som fortsatt nådde huskis.no
   ville hentet produksjonsmanifestet og fått en signatur det ikke har nøkkelen
   til — en stille `download-failed` midt i en måling om noe helt annet. */
check('riggverten er inne i connect-src', indexDiff.length === 1 && indexDiff[0].indexOf(RIG_VERT) > -1);
check('produksjonsverten er UTE av connect-src',
  indexDiff.length === 1 && indexDiff[0].indexOf(PROD_VERT + ';') === -1
    && indexDiff[0].indexOf(PROD_VERT + ' ') === -1, indexDiff[0]);

/* CANONICAL_ORIGIN i origin-vakten og reserveverdien i `canonicalAppUrl()` er
   inerte i selve målingen — vakten treffer bare på de produksjonshostene den
   selv lister, og reserveverdien leses aldri når `config.js` er satt. De må
   likevel byttes: `tests/capacitor-android.test.js` regner enhver absolutt
   adresse utenom Supabase og `canonicalAppUrl` som fremmed, og den testen er et
   BYGGESTEG i «Android debug-APK». Uten patchen kan riggskallets APK ikke
   bygges. */
const nyIndexHele = rig.patchCanonicalOrigin(nyIndex, PROD_VERT, RIG_VERT);
const indexHeleDiff = endredeLinjer(indexHtml, nyIndexHele);
check('index.html: nøyaktig to linjer endres i alt', indexHeleDiff.length === 2,
  indexHeleDiff.join(' | '));
check('…og den andre er CANONICAL_ORIGIN, satt til riggverten',
  indexHeleDiff.length === 2
    && indexHeleDiff.some((l) => l === "var CANONICAL_ORIGIN = '" + RIG_VERT + "';"),
  indexHeleDiff.join(' | '));

const appJs = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
const nyApp = rig.patchAppFallback(appJs, PROD_VERT, RIG_VERT);
const appDiff = endredeLinjer(appJs, nyApp);
check('app.js: nøyaktig én linje endres', appDiff.length === 1, appDiff.join(' | '));
check('…og det er reserveverdien i canonicalAppUrl()',
  appDiff.length === 1
    && appDiff[0] === "const raw = (window.HUSKIS_CONFIG && window.HUSKIS_CONFIG.canonicalAppUrl) || '"
      + RIG_VERT + "';",
  appDiff[0]);
/* Den ene linjen er hele riggens fotavtrykk i `app.js`: koden målingen gjelder
   — rollback-signaturen fra `ready()`, karantenen og blokklisten — står urørt. */
for (const symbol of ['otaBlocked', 'liveReady', 'setNextBundle', 'markAppReady', 'readyMs']) {
  check('app.js: ' + symbol + ' er uendret av riggpatchen',
    (appJs.split(symbol).length) === (nyApp.split(symbol).length)
      && appJs.split(symbol).length > 1,
    symbol + ' × ' + (nyApp.split(symbol).length - 1));
}

const testPar = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});
const nyCap = rig.patchCapConfig(capJson, testPar.publicKey);
const capFor = JSON.parse(capJson), capEtter = JSON.parse(nyCap);
check('capacitor.config.json: publicKey byttes til riggnøkkelen',
  capEtter.plugins.LiveUpdate.publicKey === testPar.publicKey);
/* Alt annet i konfigurasjonen må stå urørt — særlig `readyTimeout` (rollbacken
   riggen skal måle) og `autoBlockRolledBackBundles` (karantenen). */
capFor.plugins.LiveUpdate.publicKey = capEtter.plugins.LiveUpdate.publicKey;
check('…og ingenting annet i konfigurasjonen endres',
  JSON.stringify(capFor) === JSON.stringify(capEtter));
check('rollback og blokkliste står urørt i riggskallet',
  capEtter.plugins.LiveUpdate.readyTimeout === 10000
    && capEtter.plugins.LiveUpdate.autoBlockRolledBackBundles === true,
  'readyTimeout=' + capEtter.plugins.LiveUpdate.readyTimeout);

/* Patchen skal aldri kunne bli en stille no-op: en fil som ikke har formen
   riggen forventer må STOPPE riggen, ikke gi et skall som peker på produksjon. */
const kaster = (f) => { try { f(); return false; } catch (e) { return true; } };
check('en config.js uten canonicalAppUrl stopper riggen',
  kaster(() => rig.patchConfigJs('const x = 1;\n', RIG_VERT)));
check('en index.html uten connect-src stopper riggen',
  kaster(() => rig.patchCsp('<!doctype html>\n', PROD_VERT, RIG_VERT)));
check('en connect-src uten produksjonsverten stopper riggen',
  kaster(() => rig.patchCsp("connect-src 'self';\n", PROD_VERT, RIG_VERT)));
check('en index.html uten CANONICAL_ORIGIN stopper riggen',
  kaster(() => rig.patchCanonicalOrigin('<!doctype html>\n', PROD_VERT, RIG_VERT)));
check('en CANONICAL_ORIGIN som ikke er produksjonsverten stopper riggen',
  kaster(() => rig.patchCanonicalOrigin("var CANONICAL_ORIGIN = 'https://andre.no';\n",
    PROD_VERT, RIG_VERT)));
check('en app.js uten reserveverdien stopper riggen',
  kaster(() => rig.patchAppFallback('const x = 1;\n', PROD_VERT, RIG_VERT)));
check('en reserveverdi som ikke er produksjonsverten stopper riggen',
  kaster(() => rig.patchAppFallback(
    "const raw = (window.HUSKIS_CONFIG && window.HUSKIS_CONFIG.canonicalAppUrl) || 'https://andre.no';\n",
    PROD_VERT, RIG_VERT)));

/* ---- 2. Manifestet: samme form som produksjonens, egen vert ---- */

const prodManifest = ota.buildManifest({
  releaseId: 'abc123def456', bundleId: 'abc123def456-x', versionCode: 3,
  signature: 'AAAA', commit: null, builtAt: null,
});
const rManifest = rig.rigManifest({
  releaseId: 'rig-broken-1', bundleId: 'rig-broken-1', versionCode: '3',
  host: RIG_VERT, signature: 'AAAA',
});
check('riggmanifestet har nøyaktig produksjonsmanifestets felter',
  Object.keys(rManifest).sort().join(',') === Object.keys(prodManifest).sort().join(','),
  Object.keys(rManifest).join(','));

/* Klientens systemgrense (`validOtaManifest()` i app.js) speilet her: et
   manifest riggen skriver må passere den, ellers måler økten ingenting — og det
   ville sett ut som en 404, altså «vakten virket». */
function gyldig(m, versionCode, base) {
  const str = (v, max) => typeof v === 'string' && v.length > 0 && v.length <= max;
  if (!m || typeof m !== 'object' || Array.isArray(m)) return false;
  if (!str(m.releaseId, 64) || /\s/.test(m.releaseId)) return false;
  if (!str(m.bundleId, 200) || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(m.bundleId)) return false;
  if (!str(m.url, 2000) || m.url.indexOf(base) !== 0) return false;
  if (!str(m.signature, 4096) || !/^[A-Za-z0-9+/]+=*$/.test(m.signature)) return false;
  if (String(m.versionCode) !== versionCode) return false;
  return true;
}
check('riggmanifestet passerer klientens validering med riggverten som base',
  gyldig(rManifest, '3', RIG_VERT + '/') === true);
/* Og bare den: en klient med produksjonens `canonicalAppUrl` forkaster
   riggmanifestet på url-vakten alene, før noe lastes ned. */
check('…og forkastes av en klient som står på produksjonsverten',
  gyldig(rManifest, '3', PROD_VERT + '/') === false);
check('riggreleasen kan aldri kollidere med en ekte releaseId (12 hex)',
  !/^[0-9a-f]{12}$/.test(rManifest.releaseId), rManifest.releaseId);

/* Hver måling trenger sitt eget navn: pluginen avviser en `bundleId` den alt
   har lastet ned, og en rullet-tilbake `bundleId` er sperret for alltid. */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'huskis-rig-'));
try {
  fs.mkdirSync(path.join(tmp, 'tomt'));
  check('første riggnavn er rig-broken-1', rig.nextRigId(path.join(tmp, 'tomt')) === 'rig-broken-1');
  fs.writeFileSync(path.join(tmp, 'tomt', 'rig-broken-1.zip'), 'x');
  fs.writeFileSync(path.join(tmp, 'tomt', 'rig-broken-2.zip'), 'x');
  check('neste riggnavn teller opp forbi de som finnes',
    rig.nextRigId(path.join(tmp, 'tomt')) === 'rig-broken-3');

  /* ---- 3–4. Hele riggen kjørt: ødelagt bundle, signatur, manifest ---- */

  const dist = path.join(tmp, 'dist');
  fs.mkdirSync(path.join(dist, 'assets'), { recursive: true });
  fs.mkdirSync(path.join(dist, 'ota', 'bundles'), { recursive: true });
  fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>t</title>');
  fs.writeFileSync(path.join(dist, 'app.js'), 'live.ready(); // den ekte appen\n');
  fs.writeFileSync(path.join(dist, 'assets', 'a.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  fs.writeFileSync(path.join(dist, 'ota', 'bundles', 'forrige.zip'), 'PK-liksom');

  const res = rig.buildRig({
    host: RIG_VERT, bundleId: 'rig-broken-7', mode: 'throw', versionCode: '3',
    distDir: dist, outDir: path.join(tmp, 'ota'),
    privateKeyPem: testPar.privateKey, publicKeyPem: testPar.publicKey,
  });
  const innhold = spawnSync('unzip', ['-Z1', res.zipPath], { encoding: 'utf8' })
    .stdout.split('\n').map((l) => l.trim()).filter(Boolean);
  check('bundelen har index.html i roten', innhold.indexOf('index.html') > -1, innhold.join(' '));
  check('bundelen er hele web-builden, ikke bare en side',
    innhold.indexOf('assets/a.svg') > -1, innhold.length + ' oppføringer');
  /* `build.js` kopierer `ota/` inn i `dist/`. Uten unntaket ville hver runde
     pakket forrige rundes ZIP inn i den neste. */
  check('forrige rundes ota/ er IKKE med i bundelen',
    innhold.every((n) => n.indexOf('ota/') !== 0), innhold.filter((n) => n.indexOf('ota/') === 0).join(' '));

  const utpakket = path.join(tmp, 'ut');
  spawnSync('unzip', ['-q', res.zipPath, '-d', utpakket]);
  const brokenApp = fs.readFileSync(path.join(utpakket, 'app.js'), 'utf8');
  check('app.js i bundelen er byttet ut', brokenApp.indexOf('den ekte appen') === -1);
  /* Hele poenget: readiness-punktet nås aldri, så rollback-timeren utløser. */
  check('…og den kaller aldri ready()', !/\bready\s*\(/.test(brokenApp));
  check('…og den kaster', /^throw new Error\(/m.test(brokenApp));
  check('…og den navngir riggbundelen på skjermen', brokenApp.indexOf('rig-broken-7') > -1);

  const blank = rig.buildRig({
    host: RIG_VERT, bundleId: 'rig-broken-8', mode: 'blank', versionCode: '3',
    distDir: dist, outDir: path.join(tmp, 'ota'),
    privateKeyPem: testPar.privateKey, publicKeyPem: testPar.publicKey,
  });
  const blankInnhold = spawnSync('unzip', ['-Z1', blank.zipPath], { encoding: 'utf8' })
    .stdout.split('\n').map((l) => l.trim()).filter(Boolean);
  check('blank-modus er én index.html uten skript',
    blankInnhold.join(',') === 'index.html', blankInnhold.join(','));

  check('riggsignaturen verifiserer mot riggens egen nøkkel',
    ota.verifyFile(res.zipPath, res.manifest.signature, testPar.publicKey) === true);
  /* Det avgjørende: et PRODUKSJONSSKALL kan aldri aktivere riggbundelen. Selv
     om manifestet nådde det, er signaturen laget med feil nøkkel, og pluginen
     er fail closed på signatur når `publicKey` er satt. */
  const prodNokkel = JSON.parse(capJson).plugins.LiveUpdate.publicKey;
  check('…og IKKE mot den innebygde produksjonsnøkkelen',
    ota.verifyFile(res.zipPath, res.manifest.signature, prodNokkel) === false);

  const skrevet = JSON.parse(fs.readFileSync(res.manifestPath, 'utf8'));
  check('manifestet skrives på nivået skallet spør etter',
    path.basename(res.manifestPath) === '3.json' && String(skrevet.versionCode) === '3');
  check('det skrevne manifestet passerer klientens validering',
    gyldig(skrevet, '3', RIG_VERT + '/') === true);
  check('bundle-URL-en peker på riggverten, aldri på produksjon',
    skrevet.url.indexOf(RIG_VERT + '/ota/bundles/') === 0, skrevet.url);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

/* ---- 5. Riggen rører aldri produksjonens nøkler eller kjede ---- */

check('riggskriptet bruker bare Nodes standardbibliotek og signeringsskriptet',
  [...rigKilde.matchAll(/require\('([^']+)'\)/g)].map((m) => m[1])
    .every((r) => ['fs', 'path', 'crypto', 'child_process', './ota-bundle.js'].indexOf(r) > -1));
/* Produksjonsnøkkelen skal ALDRI signere noe vi vet er ødelagt. Riggen har sin
   egen, og kjenner ikke secretens navn i det hele tatt. */
check('riggen leser aldri OTA_SIGNING_KEY', rigKilde.indexOf('OTA_SIGNING_KEY') === -1);
check('riggen kan ikke bygges på main (patchen peker bort fra produksjon)',
  /rev-parse', '--abbrev-ref'/.test(rigKilde) && /aldri bygges på main/.test(rigKilde));
check('riggverten kan ikke være produksjonsverten',
  /--host er produksjonsverten/.test(rigKilde));

/* Ingen workflow skal kunne komme til å kjøre riggen: den er et håndverktøy
   for én måling, og en automatisk kjøring ville lagt en ødelagt bundle i et
   tre som deployes. */
const wfDir = path.join(ROOT, '.github', 'workflows');
const iWorkflow = fs.readdirSync(wfDir)
  .filter((f) => /\.ya?ml$/.test(f))
  .filter((f) => fs.readFileSync(path.join(wfDir, f), 'utf8').indexOf('ota-rig.js') > -1);
check('ingen workflow kjører riggen', iWorkflow.length === 0, iWorkflow.join(', ') || 'ingen');

/* ---- 6. Riggartefaktene kan ikke havne i repoet ---- */

check('riggens nøkkelmappe er gitignorert (privatnøkkelen kan ikke committes)',
  spawnSync('git', ['check-ignore', '-q', '--no-index', '.ota-rig/'], { cwd: ROOT }).status === 0);
/* Riggen skriver bundelen og manifestet til `ota/`, og den mappen MÅ committes
   på riggrenen for at previewen skal servere dem. Derfor er dette samtidig
   vakten mot at riggrenen merges: står `ota/` i git, feiler denne testen. */
const iGit = spawnSync('git', ['ls-files', 'ota/'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim();
check('ota/ er ikke sjekket inn (riggartefakter skal aldri merges til main)',
  iGit === '', iGit.split('\n').slice(0, 3).join(', ') || 'ingen');

console.log('\n==== ' + pass + '/' + (pass + fail) + ' PASS ====');
process.exit(fail === 0 ? 0 : 1);
