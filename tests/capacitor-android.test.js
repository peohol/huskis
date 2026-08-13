#!/usr/bin/env node
/* ============================================================
   Vakt for mobilfundamentet: Capacitor-skallet skal pakke NØYAKTIG den samme
   `dist/` som Vercel deployer, og ingenting av toolingen rundt skal lekke
   verken inn i webbuilden eller ut av repoet.

   Bakgrunn og faseinndeling: `docs/mobilapp-plan.md`. Reglene som testes her er
   de arkitekturreglene fasene hviler på — de er billige å bryte ved et uhell og
   dyre å oppdage sent (en app som viser huskis.no i en WebView ser helt riktig
   ut helt til telefonen er offline eller Vercel er nede).

   Dekker:
     1. capacitor.config.json: `webDir = dist`, riktig appId/appName, og INGEN
        `server`-blokk — appen skal kjøre lokale web-assets, ikke laste UI-et fra
        huskis.no.
     2. package.json: privat, uten `version` (SemVer-semantikken i
        `version.json` er uendret), uten bundler/frontendrammeverk, og med
        Capacitor-versjonene pinnet EKSAKT.
     3. package-lock.json er sjekket inn og peker på de samme versjonene.
     4. build.js holder npm-/Capacitor-/native tooling utenfor `dist/`
        (utfallet testes i tests/build-version.test.js — her testes at regelen
        står i SKIP-listen, altså at invarianten uttrykkes ett sted).
     5. .gitignore: node_modules og genererte native buildoutputs er ignorert,
        mens de native prosjektfilene som MÅ være kildekode ikke er det.
     6. Android-prosjektet har den identiteten planen har bestemt, og
        INTERNET-tillatelsen synken trenger.
     7. Fase 1 er avgrenset: ingen iOS, ingen ekstra native plugins.
     8. .github/workflows/android-debug.yml bygger debug-APK-en via den samme
        kjeden (node build.js → cap sync → assembleDebug), uten å signere en
        release eller røre release-kjeden.

   Ren node-test — ingen server, ingen nettleser, ingen Android SDK.

   Kjør:
     node tests/capacitor-android.test.js
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');

let pass = 0, fail = 0;
function check(navn, ok, evidens) {
  if (ok) { pass++; console.log('PASS — ' + navn + (evidens ? '  [' + evidens + ']' : '')); }
  else { fail++; console.log('FAIL — ' + navn + (evidens ? '  [' + evidens + ']' : '')); }
}
const les = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const json = (...p) => JSON.parse(les(...p));
const finnes = (...p) => fs.existsSync(path.join(ROOT, ...p));
// `git check-ignore` er fasiten på hva som faktisk blir ignorert — den tar med
// alle .gitignore-filene i kjeden, inkludert den Capacitor legger i `android/`.
function ignorert(rel) {
  return spawnSync('git', ['check-ignore', '-q', '--no-index', rel], { cwd: ROOT }).status === 0;
}

/* ---- 1. Capacitor peker på dist/, og ikke på huskis.no ---- */
const cfg = json('capacitor.config.json');
check('capacitor.config.json bruker dist/ som web-assets', cfg.webDir === 'dist', cfg.webDir);
check('appId er no.huskis.app', cfg.appId === 'no.huskis.app', cfg.appId);
check('appName er Huskis', cfg.appName === 'Huskis', cfg.appName);
/* En `server.url` ville gjort appen til en WebView som henter UI-et over nett:
   ingen offline oppstart, og butikkbinæren ville sluttet å bety noe.
   `docs/mobilapp-plan.md` — «Ingen ekstern server.url i produksjon». */
check('ingen produksjons-server.url i Capacitor-konfigurasjonen',
  !cfg.server || (!cfg.server.url && !cfg.server.hostname),
  JSON.stringify(cfg.server || null));
/* Konfigurasjonen kopieres inn i APK-en ved hver sync. Den kopien er
   gitignorert generert utdata, men når den finnes lokalt skal den bevise at det
   faktisk er dette som ender opp i appen. */
const APK_CFG = 'android/app/src/main/assets/capacitor.config.json';
if (finnes(APK_CFG)) {
  const innebygd = json(APK_CFG);
  check('den innebygde konfigurasjonen i APK-en har heller ingen server.url',
    !innebygd.server || (!innebygd.server.url && !innebygd.server.hostname),
    JSON.stringify(innebygd.server || null));
  check('den innebygde konfigurasjonen har samme appId', innebygd.appId === cfg.appId);
} else {
  console.log('(hopper over den innebygde konfigurasjonen — kjør `npm run sync:android` først)');
}

/* ---- 2. package.json ---- */
const pkg = json('package.json');
check('package.json er privat (publiseres aldri til npm)', pkg.private === true);
/* build.js leser `version` herfra. Uten feltet forblir version.json.version
   null, og build-ID-en er fortsatt den eneste release-identiteten
   (docs/auto-update.md). Testes også fra utfallssiden i build-version.test.js. */
check('package.json har ikke et version-felt', !('version' in pkg));

const CAP = ['@capacitor/core', '@capacitor/cli', '@capacitor/android'];
const alleDeps = Object.assign({}, pkg.dependencies, pkg.devDependencies);
for (const p of CAP) {
  check(p + ' er en avhengighet', typeof alleDeps[p] === 'string', alleDeps[p] || 'mangler');
  check(p + ' er pinnet eksakt (ingen ^, ~ eller latest)',
    /^\d+\.\d+\.\d+$/.test(alleDeps[p] || ''), alleDeps[p] || '');
}
check('core, cli og android står i samme versjon',
  new Set(CAP.map((p) => alleDeps[p])).size === 1, CAP.map((p) => alleDeps[p]).join(', '));
check('Capacitor-majoren er 8', /^8\./.test(alleDeps['@capacitor/core'] || ''),
  alleDeps['@capacitor/core']);

/* Huskis er fortsatt vanilla HTML/CSS/JS. Mobilprosjektet skal ikke være
   bakveien inn for en bundler eller et frontendrammeverk
   (docs/mobilapp-plan.md, arkitekturregel 1). */
const FORBUDT = /^(vite|webpack|rollup|esbuild|parcel|typescript|react|react-dom|vue|svelte|@angular\/|@ionic\/|@babel\/|next)/;
const smugling = Object.keys(alleDeps).filter((d) => FORBUDT.test(d));
check('ingen bundler, transpiler eller frontendrammeverk blant avhengighetene',
  smugling.length === 0, smugling.join(', ') || 'ingen');

check('npm-skriptet for webbuilden kjører build.js',
  (pkg.scripts || {}).build === 'node build.js', (pkg.scripts || {}).build);
check('npm-skriptet for sync bygger først og synker så til android',
  /build/.test((pkg.scripts || {})['sync:android'] || '')
    && /cap sync android/.test((pkg.scripts || {})['sync:android'] || ''),
  (pkg.scripts || {})['sync:android']);
check('npm-skriptet for Android-builden kjører gradlew assembleDebug',
  /assembleDebug/.test((pkg.scripts || {})['android:debug'] || ''),
  (pkg.scripts || {})['android:debug']);

/* ---- 3. Lockfila ---- */
check('package-lock.json er sjekket inn', finnes('package-lock.json') && !ignorert('package-lock.json'));
const lock = json('package-lock.json');
for (const p of CAP) {
  const node = (lock.packages || {})['node_modules/' + p];
  check('lockfila låser ' + p + ' til den samme versjonen',
    !!node && node.version === alleDeps[p], (node && node.version) || 'mangler');
}

/* ---- 4. Invarianten står i build.js, ikke bare i utfallet ---- */
const build = les('build.js');
const skipBlokk = (build.match(/const SKIP = new Set\(\[[\s\S]*?\]\);/) || [''])[0];
for (const n of ['package.json', 'package-lock.json', 'capacitor.config.json', 'android', 'ios', 'node_modules']) {
  check('build.js SKIP-listen holder ' + n + ' utenfor dist/',
    skipBlokk.indexOf("'" + n + "'") > -1);
}

/* ---- 5. .gitignore: kildekode inn, generert utdata ut ---- */
for (const g of ['node_modules', 'dist']) {
  check(g + ' er gitignorert', ignorert(g));
}
/* Uten disse kan ikke et rent checkout bygge APK-en — de ER den native
   kildekoden (docs/mobilapp-plan.md, arkitekturregel 4). */
const NATIV_KILDE = [
  'android/build.gradle',
  'android/settings.gradle',
  'android/variables.gradle',
  'android/gradle.properties',
  'android/gradlew',
  'android/gradle/wrapper/gradle-wrapper.jar',
  'android/gradle/wrapper/gradle-wrapper.properties',
  'android/app/build.gradle',
  'android/app/src/main/AndroidManifest.xml',
  'android/app/src/main/java/no/huskis/app/MainActivity.java',
  'android/app/src/main/res/values/strings.xml',
];
for (const f of NATIV_KILDE) {
  check('native kildefil finnes og er IKKE ignorert: ' + f, finnes(f) && !ignorert(f));
}
/* Generert eller maskinspesifikt. Alt her gjenskapes av `npm run sync:android`
   + Gradle, og skal aldri havne i git. */
const NATIV_GENERERT = [
  'android/app/build',
  'android/local.properties',
  'android/app/src/main/assets/public',
  'android/app/src/main/assets/capacitor.config.json',
  'android/capacitor-cordova-android-plugins',
];
for (const f of NATIV_GENERERT) {
  check('generert/maskinspesifikk sti er ignorert: ' + f, ignorert(f));
}

/* ---- 6. Android-prosjektets identitet ---- */
const strings = les('android/app/src/main/res/values/strings.xml');
check('android: app_name er Huskis', /<string name="app_name">Huskis<\/string>/.test(strings));
check('android: package_name er no.huskis.app',
  /<string name="package_name">no\.huskis\.app<\/string>/.test(strings));
const appGradle = les('android/app/build.gradle');
check('android: applicationId er no.huskis.app', /applicationId "no\.huskis\.app"/.test(appGradle));
check('android: namespace er no.huskis.app', /namespace = "no\.huskis\.app"/.test(appGradle));
const manifest = les('android/app/src/main/AndroidManifest.xml');
/* Uten INTERNET når appen verken Supabase eller /version.json. */
check('android: manifestet ber om INTERNET',
  /android\.permission\.INTERNET/.test(manifest));

/* ---- 7. Fase 1 er avgrenset ---- */
check('iOS-plattformen er ikke innført ennå',
  !finnes('ios') && !alleDeps['@capacitor/ios']);
/* Fase 1 skal ikke ha pushvarsler, biometrikk, haptics eller andre native
   plugins. Alt utover kjernen + plattformen er derfor en regresjon her, og skal
   komme som en bevisst endring i en senere fase. */
const capPakker = Object.keys(alleDeps).filter((d) => d.startsWith('@capacitor/'));
check('ingen native Capacitor-plugins utover kjerne, cli og android',
  capPakker.every((d) => CAP.indexOf(d) > -1), capPakker.join(', '));

/* ---- 8. Workflowen som produserer debug-APK-en ---- */
const WF = path.join(ROOT, '.github', 'workflows', 'android-debug.yml');
check('.github/workflows/android-debug.yml finnes', fs.existsSync(WF));
const wf = fs.existsSync(WF) ? fs.readFileSync(WF, 'utf8') : '';
const utenKommentarer = (y) => y.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
const wfKode = utenKommentarer(wf);
check('workflowen kan startes manuelt', /\n {2}workflow_dispatch:/.test(wfKode));
/* En Gradle-runde på hver eneste PR ville gjort alle ordinære Huskis-endringer
   tregere uten å teste noe nytt: de endrer `dist/`, som APK-en bare pakker inn.
   Derfor er pull_request-triggeren avgrenset med `paths`. */
check('pull_request-triggeren er avgrenset med paths',
  /\n {2}pull_request:\s*\n {4}paths:/.test(wfKode));
for (const p of ['android/**', 'capacitor.config.json', 'package.json', 'package-lock.json', 'build.js']) {
  check('workflowen kjører når ' + p + ' endres', wfKode.indexOf("'" + p + "'") > -1);
}
check('workflowen bruker den samme pinnede Node-versjonen som ci.yml',
  /node-version: '22'/.test(wfKode));
check('workflowen installerer avhengighetene reproduserbart (npm ci)',
  /npm ci/.test(wfKode));
check('workflowen kjører den vanlige webbuilden', /node build\.js/.test(wfKode));
check('workflowen synkroniserer dist/ til Android', /cap sync android/.test(wfKode));
check('workflowen bygger debug-APK-en med Gradle', /gradlew[^\n]*assembleDebug/.test(wfKode));
check('workflowen laster opp APK-en som artifact',
  /actions\/upload-artifact/.test(wfKode)
    && /app\/build\/outputs\/apk\/debug\/app-debug\.apk/.test(wfKode));
check('workflowen feiler hvis APK-en mangler (ingen tom artifact)',
  /if-no-files-found: error/.test(wfKode));
/* Signering, release-AAB og butikkopplasting hører til fase 6. Kommer de inn
   her, gjør de det uten nøkkelhåndteringen den fasen krever. */
check('workflowen signerer ikke en release',
  !/assembleRelease|bundleRelease|signingConfig|KEYSTORE/.test(wfKode));
check('workflowen har kun lesetilgang til repoet', /permissions:\s*\n\s*contents: read/.test(wfKode));

console.log('\n==== ' + pass + '/' + (pass + fail) + ' PASS ====');
process.exit(fail === 0 ? 0 : 1);
