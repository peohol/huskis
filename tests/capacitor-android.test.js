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
     9. Native runtime: webkoden kjenner Capacitor på ÉN gated linje (broen for
        systemets tilbakeknapp) og ingen andre steder, og ingenting i den peker
        appen ut av sine egne innebygde filer.
    10. Systemets tilbakeknapp: skallet spør web-laget først og lar OS ta
        trykket når web-laget ikke tok det.

   `/version.json` i den innebygde builden er en KJEDE av invarianter som
   allerede er dekket hver for seg, og som derfor ikke gjentas her:
   `build.js` skriver samme build-ID i `index.html` og `version.json`
   (tests/build-version.test.js), Capacitor pakker nøyaktig den mappa
   (`webDir` under), og `update-check.js` som møter sin egen ID gjør ingenting
   — ingen mål-build, intet banner, ingen reload (tests/auto-update.test.js).
   Appen leser altså alltid seg selv, og oppdaterer aldri web-assetene sine.
   Selve OTA-en er fase 5.

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
/* `git check-ignore` er fasiten på hva som faktisk blir ignorert — den tar med
   alle .gitignore-filene i kjeden, inkludert den Capacitor legger i `android/`.

   MERK skråstreken på katalogene under. Et mønster som slutter på `/` (`dist/`,
   `node_modules/`, `build/`) treffer bare kataloger, og `--no-index` leser en
   sti UTEN skråstrek som en fil når den ikke finnes på disk. I et rent checkout
   finnes ingen av de genererte katalogene, så uten skråstreken ville sjekken
   svart «ikke ignorert» — og bestått lokalt, der katalogene tilfeldigvis
   finnes. Katalog skrives derfor som katalog. */
function ignorert(rel) {
  return spawnSync('git', ['check-ignore', '-q', '--no-index', rel], { cwd: ROOT }).status === 0;
}
/* Linjene med KJØRENDE kode, kommentarene fjernet. Sjekkene under handler om
   hva koden gjør; hva kommentarene omtaler er de likegyldige til (og
   Capacitor-broen omtales i flere av dem). Blokkkommentarene i denne kodebasen
   fortsetter på linjer uten `*`, så blokken må spores — den kan ikke
   gjenkjennes linje for linje. Forenkling: en `//` inne i en streng (`https://`)
   kapper resten av linja. Det gjør ingen av sjekkene her falskt grønne, de
   leter etter navn som ikke står i noen URL. Brukes både på JS og Java. */
function kodeLinjer(src) {
  let iBlokk = false;
  return src.split('\n').map((raw, i) => {
    let kode = raw;
    if (iBlokk) {
      const slutt = kode.indexOf('*/');
      if (slutt === -1) return { nr: i + 1, l: '' };
      kode = kode.slice(slutt + 2);
      iBlokk = false;
    }
    for (;;) {
      const start = kode.indexOf('/*');
      if (start === -1) break;
      const slutt = kode.indexOf('*/', start + 2);
      if (slutt === -1) { kode = kode.slice(0, start); iBlokk = true; break; }
      kode = kode.slice(0, start) + kode.slice(slutt + 2);
    }
    return { nr: i + 1, l: kode.replace(/\/\/.*$/, '') };
  });
}
const kode = (src) => kodeLinjer(src).map((x) => x.l).join('\n');

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
for (const g of ['node_modules/', 'dist/']) {
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
  'android/app/build/',
  'android/local.properties',
  'android/app/src/main/assets/public/',
  'android/app/src/main/assets/capacitor.config.json',
  'android/capacitor-cordova-android-plugins/',
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

/* ---- 9. Native runtime: appen kjører seg selv, og webkoden er uavhengig ----

   Capacitor serverer de innebygde filene fra `https://localhost`. To ting kan
   ryke der uten at noen test i dag sier fra:

     a) webkoden begynner å kalle Capacitor-API-er, og browserutgaven blir
        avhengig av en runtime den ikke har (arkitekturregel 2);
     b) noe i klienten sender appen til huskis.no — da slutter den innebygde
        builden å bety noe, og appen blir en WebView med et nettkrav.

   Auth-siden av (b) — at `authRedirectUrl()` ikke tar WebView-originet for en
   utviklingsserver — testes i ekte nettleser (tests/auth-redirect.test.js),
   det samme gjør guardens oppførsel (tests/canonical-origin.test.js). */
const WEB_KILDE = ['index.html', 'app.js', 'config.js', 'i18n.js', 'icons.js', 'update-check.js', 'styles.css'];
const NEVNER_CAP = /\bCapacitor\b|@capacitor|capacitor\.js|cordova/i;
/* Alle andre web-kildefiler enn app.js skal fortsatt være helt uvitende om at
   det finnes en native runtime. */
const capBruk = WEB_KILDE.filter((f) => f !== 'app.js' && NEVNER_CAP.test(les(f)));
check('webkoden nevner ikke Capacitor — browserutgaven er ikke avhengig av native runtime',
  capBruk.length === 0, capBruk.join(', ') || 'ingen');

/* Unntaket (fase 3, docs/mobilapp-plan.md): app.js SKAL kjenne native-runtimen
   ett sted — gaten som setter opp broen for systemets tilbakeknapp. Unntaket er
   avgrenset, ikke opphevet: én kodelinje, den må gå gjennom `window.Capacitor`,
   og den må spørre `isNativePlatform()`. Da kan ikke et Capacitor-kall snike
   seg inn i vanlig app-logikk uten at denne testen sier fra, og browserutgaven
   kan ikke bli avhengig av en runtime den ikke har (arkitekturregel 2).
   Kommentarer får omtale broen fritt — de kjører ikke. */
const capKode = kodeLinjer(les('app.js')).filter(({ l }) => NEVNER_CAP.test(l));
check('app.js nevner Capacitor i kjørende kode kun på ÉN linje',
  capKode.length === 1, capKode.map((x) => 'linje ' + x.nr).join(', ') || 'ingen');
check('den ene linjen er gaten: window.Capacitor + isNativePlatform()',
  capKode.length === 1
    && /window\.Capacitor\b/.test(capKode[0].l)
    && /isNativePlatform/.test(capKode[0].l),
  (capKode[0] ? capKode[0].l.trim() : 'mangler'));
/* Broen skal bare finnes når gaten slipper den gjennom. Står tilordningen
   utenfor en `if`, får browserutgaven den også — og da er gaten pynt.
   Oppførselen i seg selv testes i ekte nettleser (tests/system-back.test.js). */
check('broen tilordnes bak gaten, ikke ubetinget',
  /if \(nativeShell\) window\.__huskisSystemBack = systemBack;/.test(les('app.js'))
    && (les('app.js').match(/window\.__huskisSystemBack\s*=/g) || []).length === 1);

/* At forespørselen faktisk går rot-relativt til eget origin, testes i ekte
   nettleser (tests/auto-update.test.js). Det som ikke fanges der, er en
   absolutt URL skrevet inn her: appen ville da målt seg mot huskis.no og
   reloadet seg selv til en build den ikke har (docs/auto-update.md). */
const absolutt = les('update-check.js').match(/https?:\/\/[^\s'")]*/g) || [];
check('update-check.js navngir ingen vert — den måler seg alltid mot sitt eget origin',
  absolutt.length === 0, absolutt.join(', ') || 'ingen');

/* Guarden i index.html flytter en fane til det kanoniske originet. Står
   WebView-verten på den lista, navigerer appen seg selv ut på nett ved
   oppstart. Hostene som ER der, testes i tests/canonical-origin.test.js. */
const guardHosts = (les('index.html').match(/REDIRECT_HOSTS\s*=\s*\[([^\]]*)\]/) || [, ''])[1];
check('guardens hostliste navngir ingen localhost-vert (appen redirecter ikke seg selv ut)',
  !/localhost|127\.0\.0\.1/.test(guardHosts), guardHosts.trim());

/* ---- 10. Systemets tilbakeknapp ----

   Capacitor gjør ingenting med tilbakeknappen selv: `@capacitor/android` har
   ingen back-håndtering, så BridgeActivity arver AppCompats standard og første
   trykk forlater appen — uansett hva som står åpent. Det native skallet skal
   derfor spørre web-laget først, og bare la OS ta trykket når web-laget sier at
   det ikke tok det. Selve stigen (hvilket lag som lukkes når) testes i ekte
   nettleser: tests/system-back.test.js. */
const mainAct = les('android/app/src/main/java/no/huskis/app/MainActivity.java');
check('MainActivity registrerer en OnBackPressedCallback',
  /OnBackPressedCallback/.test(mainAct) && /getOnBackPressedDispatcher\(\)\.addCallback/.test(mainAct));
check('MainActivity spør web-laget via __huskisSystemBack',
  /window\.__huskisSystemBack/.test(mainAct));
/* Uten videresendingen ville et «nei» fra web-laget blitt et dødt tilbaketrykk:
   appen ville aldri kunne forlates med tilbakeknappen. */
check('et ubesvart trykk sendes videre til OS, ikke svelges',
  /setEnabled\(false\)/.test(mainAct)
    && /getOnBackPressedDispatcher\(\)\.onBackPressed\(\)/.test(mainAct)
    && /setEnabled\(true\)/.test(mainAct));
/* `finish()` ville avgjort på OS-ets vegne hva et tilbaketrykk på rot-
   aktiviteten betyr (Android bærer i dag oppgaven i bakgrunnen i stedet for å
   rive den ned). Videresending til dispatcheren beholder plattformens egen
   oppførsel. */
check('skallet kaller ikke finish() selv', !/\bfinish\(\)/.test(kode(mainAct)));
/* androidx.activity kommer inn i Capacitor som `implementation`, altså ikke på
   appmodulens kompileringssti. MainActivity bruker API-et direkte. */
check('android/app/build.gradle har androidx.activity på kompileringsstien',
  /implementation "androidx\.activity:activity:\$androidxActivityVersion"/.test(appGradle));

console.log('\n==== ' + pass + '/' + (pass + fail) + ' PASS ====');
process.exit(fail === 0 ? 0 : 1);
