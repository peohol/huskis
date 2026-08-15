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
    10. Safe areas og skjermtastaturet: erklæringene sonen hviler på —
        `viewport-fit=cover` i index.html, `adjustResize` i manifestet, og
        systemfeltenes utseende i temaet (lyst tema, gjennomsiktige felt,
        mørke glyfer) som gjør klokka lesbar over Huskis' lyse flate.
    11. Systemets tilbakeknapp: skallet spør web-laget først og lar OS ta
        trykket når web-laget ikke tok det.
    12. Eksterne lenker: bare appens eget origin lastes INNE i appen, alt annet
        hører hjemme i systembrowseren (docs/domains-and-urls.md, «Eksterne
        lenker»).

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

/* ---- 10. Safe areas, systemfeltene og skjermtastaturet ----

   Runtimen rapporterer systemflatenes mål som `env(safe-area-inset-*)` KUN når
   siden ber om å få tegne under dem, altså med `viewport-fit=cover`. Uten den
   krymper skallet i stedet WebView-en, `env()` er 0, og appen står med en
   fremmedfarget stripe øverst og nederst. Selve sonen (at chromet faktisk
   flytter seg) testes i ekte nettleser: tests/safe-area.test.js. Her voktes de
   to erklæringene den hviler på — de står i hver sin fil og kan ellers komme i
   utakt uten at noe sier fra. */
const indexHtml = les('index.html');
const viewportTag = (indexHtml.match(/<meta name="viewport"[^>]*>/) || [''])[0];
check('index.html ber om å få tegne under systemfeltene (viewport-fit=cover)',
  /viewport-fit\s*=\s*cover/.test(viewportTag), viewportTag.trim() || 'ingen viewport-tagg');
/* Uten en eksplisitt modus står den på «unspecified», og om tastaturet krymper
   eller skyver vinduet er da systemets valg. Web-laget regner med krymping:
   resize-lytteren i app.js ruller feltet som redigeres tilbake i syne. */
check('android: skjermtastaturet krymper vinduet (adjustResize)',
  /android:windowSoftInputMode="adjustResize"/.test(manifest));

/* Systemfeltenes GLYFER hører til den samme mekanismen: når siden tegner under
   feltene, er det Huskis' egen — alltid lyse — flate som ligger bak klokka og
   gestelinjen. Uten en eksplisitt erklæring beholder feltene systemets egne
   farger, og lyse glyfer over en lys flate er i praksis uleselige (målt på
   telefon: grei kontrast i mørk modus, dårlig i lys). DayNight-foreldretemaet
   var dessuten halve problemet: night-varianten malte en SVART statusfelt-
   bakgrunn oppå siden, så flaten vår ikke nådde skjermkanten i mørk modus.
   Ingenting av dette kan ses fra web-laget — derfor voktes erklæringene her. */
const styles = les('android/app/src/main/res/values/styles.xml');
const stylesV27 = les('android/app/src/main/res/values-v27/styles.xml');
/* Kun `parent=`-attributtene leses — ordet DayNight står også i kommentaren
   som forklarer hvorfor det ikke er foreldretemaet, og den skal ikke felle
   sin egen test. */
const arver = (s) => (s.match(/parent="[^"]*"/g) || []).join(' ');
check('android: kjøretidstemaet er lyst, ikke DayNight (appen har én drakt)',
  /name="AppTheme\.NoActionBar"[^>]*parent="Theme\.AppCompat\.Light\.NoActionBar"/.test(styles)
  && !/DayNight/.test(arver(styles)) && !/DayNight/.test(arver(stylesV27)),
  arver(styles));
check('android: statusfeltet er gjennomsiktig (Huskis-flaten når skjermkanten)',
  /android:statusBarColor">@android:color\/transparent/.test(styles));
/* Bunnfeltet er unntaket på API 24–26: der finnes ikke
   `windowLightNavigationBar`, og runtime-veien er en no-op, så treknappsradens
   glyfer er LYSE uansett. Et gjennomsiktig felt ville lagt hvite knapper oppå
   vår lyse flate — de versjonene får derfor en mørk stripe å ligge på, og først
   values-v27 gjør feltet gjennomsiktig. */
check('android: bunnfeltet er en mørk stripe før API 27, ikke gjennomsiktig',
  /android:navigationBarColor">@color\/systemNavScrim/.test(styles)
  && !/android:navigationBarColor">@android:color\/transparent/.test(styles)
  && /name="systemNavScrim"/.test(les('android/app/src/main/res/values/colors.xml')));
check('android: bunnfeltet blir gjennomsiktig fra API 27 (der glyfene kan snus)',
  /android:navigationBarColor">@android:color\/transparent/.test(stylesV27));
check('android: mørke glyfer i statusfeltet (windowLightStatusBar)',
  /android:windowLightStatusBar">true/.test(styles));
/* Temaet er ikke nok alene: `SystemBars`-pluginen SETTER utseendet i runtime
   (`setAppearanceLightStatusBars`), og med `style: DEFAULT` leser den
   telefonens nattmodus — i mørk modus ba den dermed om LYSE glyfer, oppå vår
   lyse flate. Med en eksplisitt `LIGHT` er den låst til mørke glyfer, også
   etter en konfigurasjonsendring (pluginen legger den resolverte stilen på
   igjen ved rotasjon/modusbytte). Nøkkelen er plugin-klassens navn. */
check('capacitor.config.json låser systemfeltene til mørke glyfer (SystemBars.style = LIGHT)',
  !!cfg.plugins && !!cfg.plugins.SystemBars && cfg.plugins.SystemBars.style === 'LIGHT',
  JSON.stringify((cfg.plugins || {}).SystemBars || null));
/* Attributten finnes først fra API 27, og hører derfor hjemme i values-v27/ —
   i values/ ville den vært død kode med lint-støy på kjøpet. */
check('android: mørke glyfer i gestelinjen fra API 27 (windowLightNavigationBar)',
  /android:windowLightNavigationBar">true/.test(stylesV27)
  && !/android:windowLightNavigationBar/.test(styles));

/* ---- 11. Systemets tilbakeknapp ----

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

/* ---- 12. Eksterne lenker ----

   Regelen (docs/domains-and-urls.md, «Eksterne lenker»): appens eget origin
   lastes INNE i appen, alt annet åpnes i systembrowseren. Den håndheves av
   Capacitors egen `BridgeWebViewClient.shouldOverrideUrlLoading()` →
   `Bridge.launchIntent()`, som sender enhver adresse med et annet
   skjema+vert enn appens ut som en `Intent.ACTION_VIEW`. Huskis skriver altså
   ingen kode for dette — og nettopp derfor er det de to måtene å MISTE regelen
   på som må voktes:

     a) `server.allowNavigation` slipper navngitte verter INN i WebView-en, som
        har Huskis' localStorage, Supabase-sesjonen og Capacitor-broen i samme
        kontekst. En side som lastes der er ikke et faneskifte, den er innsiden
        av appen;
     b) web-kildekoden begynner å produsere utgående lenker uten at noen har
        tatt stilling til hvor de skal havne.

   Alt her er tekstsjekker på kildekoden — hvor Android faktisk sender en
   ACTION_VIEW er telefonens sak, og kan bare ses der. */
const srv = cfg.server || {};
check('ingen server.allowNavigation (ingen fremmed vert lastes inne i appen)',
  !srv.allowNavigation || srv.allowNavigation.length === 0,
  JSON.stringify(srv.allowNavigation || null));
if (finnes(APK_CFG)) {
  const innebygdSrv = json(APK_CFG).server || {};
  check('den innebygde konfigurasjonen har heller ingen allowNavigation',
    !innebygdSrv.allowNavigation || innebygdSrv.allowNavigation.length === 0,
    JSON.stringify(innebygdSrv.allowNavigation || null));
}
/* Sjekkene under trenger en STRENGBEVISST kommentarfjerner, ikke kodeLinjer().
   Den forenklingen — kapp linja ved første `//` — er grei for navnesjekkene
   lenger oppe, men den blindet disse på to måter: `href="//vert"` forsvant helt,
   og på en kompakt linje som `const u = 'https://x'; window.open(u)` ble alt
   ETTER URL-en usynlig. Denne holder styr på strenger, blokk-kommentarer og
   HTML-kommentarer (index.html leses med den samme funksjonen), så `//` inne i
   en URL ikke kapper noe. Enkle og doble anførselstegn nullstilles ved
   linjeskift — de kan ikke spenne over linjer i JS, og et løsrevet apostrof i
   HTML-tekst skal ikke forgifte resten av fila. */
function kodeLinjerStreng(src, modus) {
  const linjer = src.split('\n');
  let iBlokk = false, iHtml = false, iSkript = false, streng = null;
  /* Sist SIGNIFIKANTE tegn, brukt til å skille et regex-literal fra divisjon:
     etter en VERDI (`)`, `]`, et navn, et tall) er `/` deling, ellers starter
     den et regex. Uten det skillet ville `/[/*]/` satt fjerneren i
     blokk-kommentarmodus og slukt resten av fila. Et nøkkelord slutter også på
     et ordtegn, men er ingen verdi — `return /re/` er et regex — så de
     sjekkes for seg.

     GRENSEN, bevisst: et regex kan også starte en setning etter en betingelse
     (`if (klar) /re/.test(x)`), og der kan ikke «forrige tegn» skille den fra
     divisjon — `(a + b) / c` ser likedan ut. Å avgjøre det krever
     setningskontekst, altså en JS-lexer, som ville vært større enn vakten den
     vokter. Huskis har ikke ett eneste regex med `/` eller `*` i en
     tegnklasse; formene som faktisk oppstår (etter operator, komma, `return`)
     er dekket, og en lenke måtte uansett navngi en adresse som URL-sjekken og
     dist-skanningen ser. Kommer et slikt regex inn i koden, er forutsetningen
     endret og dette er stedet å ta det opp igjen. */
  let forrige = '';
  return linjer.map((raw, i) => {
    if (streng !== '`') streng = null;
    const lav = raw.toLowerCase();
    let ren = '';
    for (let j = 0; j < raw.length; j++) {
      /* Inne i et inline-`<script>` gjelder JS-reglene, ikke markupens — og
         forskjellen er ikke akademisk: `<!--` er en LINJEkommentar der, mens
         markup ville kastet alt fram til en `-->` som kanskje aldri kommer. */
      const m = modus === 'html' && iSkript ? 'js' : modus;
      if (iBlokk) { if (raw.startsWith('*/', j)) { iBlokk = false; j++; } continue; }
      if (iHtml) { if (raw.startsWith('-->', j)) { iHtml = false; j += 2; } continue; }
      if (streng) {
        ren += raw[j];
        if (raw[j] === '\\') { if (j + 1 < raw.length) { ren += raw[j + 1]; j++; } continue; }
        if (raw[j] === streng) streng = null;
        continue;
      }
      if (modus === 'html' && lav.startsWith('</script', j)) { iSkript = false; }
      else if (modus === 'html' && !iSkript && lav.startsWith('<script', j)) {
        const slutt = raw.indexOf('>', j);
        if (slutt === -1) { ren += raw.slice(j); break; }
        ren += raw.slice(j, slutt + 1); j = slutt; iSkript = true; continue;
      }
      /* Regex-literal: konsumeres i sin helhet, med tegnklasser, slik at
         `/` og `*` inne i det ikke leses som kommentartegn. */
      const etterNokkelord = /(?:^|[^\w$])(?:return|throw|typeof|instanceof|in|of|new|delete|void|case|do|else|yield|await)\s*$/.test(ren);
      if (m !== 'css' && raw[j] === '/' && (!/[\w$)\]]/.test(forrige) || etterNokkelord)
        && !raw.startsWith('//', j) && !raw.startsWith('/*', j)) {
        let k = j + 1, iKlasse = false, lukket = false;
        for (; k < raw.length; k++) {
          if (raw[k] === '\\') { k++; continue; }
          if (iKlasse) { if (raw[k] === ']') iKlasse = false; continue; }
          if (raw[k] === '[') { iKlasse = true; continue; }
          if (raw[k] === '/') { lukket = true; break; }
        }
        if (lukket) { ren += raw.slice(j, k + 1); j = k; forrige = '/'; continue; }
      }
      if (raw.startsWith('/*', j)) { iBlokk = true; j++; continue; }
      /* `<!--` betyr to helt forskjellige ting. I markup åpner den en kommentar
         som løper til `-->`; i et klassisk skript er den en LINJEkommentar
         (samme for `-->` i starten av en linje). Behandles JS som markup, ville
         alt fra en `<!--` og ut fila blitt kastet — og skanningen stått grønn
         på tom tekst. */
      if (m === 'html' && raw.startsWith('<!--', j)) { iHtml = true; j += 3; continue; }
      if (m === 'js' && (raw.startsWith('<!--', j) || raw.startsWith('-->', j))) break;
      if (m !== 'css' && raw.startsWith('//', j)) break;   // `//` er IKKE en kommentar i CSS
      if (raw[j] === '"' || raw[j] === "'" || (m !== 'css' && raw[j] === '`')) streng = raw[j];
      ren += raw[j];
      if (!/\s/.test(raw[j])) forrige = raw[j];
    }
    return { nr: i + 1, l: ren };
  });
}
/* Kommentarsyntaksen følger filtypen, ikke innholdet. */
const modusFor = (navn) => (/\.html?$/i.test(navn) ? 'html' : /\.css$/i.test(navn) ? 'css' : 'js');
/* Hele fila som én strippet tekst, med posisjon → linjenummer for evidensen.
   Mønstre som kan spenne over linjeskift kjøres mot denne. */
const strippet = (src, modus) => kodeLinjerStreng(src, modus).map((x) => x.l).join('\n');
/* HTML-attributter kan skrive et hvilket som helst tegn som en tegnreferanse:
   `href="https&#58;//x"` er den samme adressen for nettleseren. Referansene
   dekodes derfor før mønstrene kjøres. Ingen av dem inneholder linjeskift, så
   linjenumrene holder. */
const dekodEntiteter = (t) => t
  /* Semikolon er VALGFRITT: nettleseren dekoder `&#58//x` like godt som
     `&#58;//x`, så mønstrene må se det samme. */
  .replace(/&#x([0-9a-f]+);?/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);?/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
  .replace(/&(colon|sol|period|lpar|rpar|quot|apos|amp);/gi,
    (_, n) => ({ colon: ':', sol: '/', period: '.', lpar: '(', rpar: ')', quot: '"', apos: "'", amp: '&' })[n.toLowerCase()]);
function strippetMedLinjer(src, modus) {
  const tekst = modus === 'html' ? dekodEntiteter(strippet(src, modus)) : strippet(src, modus);
  return { tekst, linjeFor: (idx) => tekst.slice(0, idx).split('\n').length };
}

/* Overtar skallet WebViewClient-en eller `shouldOverrideUrlLoading`, er det
   ikke lenger Capacitors ruting som gjelder, og regelen over er ikke lenger
   den som kjører. Da skal endringen være bevisst — og innom dokumentet.

   HELE den native kildekoden leses, ikke bare MainActivity: en hjelpeklasse
   som kalles derfra (`Navigation.install(bridge)`) kompileres og kjører like
   fullt, og kunne byttet ut rutingen uten at en sjekk på én fil så det. Alle
   source set-ene under `android/app/src` teller — `debug/` og `release/`
   kompileres inn i hver sin variant — men ikke `test/` og `androidTest/`, som
   aldri havner i APK-en.

   Mønsteret dekker to måter, ikke én. Å bytte ut KLIENTEN
   (`setWebViewClient`, `shouldOverrideUrlLoading`) flytter selve avgjørelsen
   bort fra Capacitor. Å navigere WebView-en DIREKTE fra Java (`loadUrl`,
   `postUrl`, `loadData…`) hopper over avgjørelsen: en app-initiert lasting
   spør ikke `shouldOverrideUrlLoading` i det hele tatt, så en fremmed side
   ville havnet inne i appen.

   Kilden leses STRENGBEVISST (se kodeLinjerStreng under), ikke med kode():
   den kapper linja ved første `//`, også inne i en streng, og
   `String u = "https://x"; webView.loadUrl(u);` ville da mistet kallet. Java
   har de samme kommentarformene som JS, så den samme funksjonen holder. */
const NATIV_SRC = path.join(ROOT, 'android', 'app', 'src');
function javaFiler(dir, rot) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    /* Bare source set-RØTTENE `src/test` og `src/androidTest` hoppes over. En
       pakkekatalog som tilfeldigvis heter `test` under `src/main` kompileres
       inn i appen som alt annet, og skal skannes. */
    if (d.isDirectory()) return rot && /^(test|androidTest)$/.test(d.name) ? [] : javaFiler(p, false);
    return /\.(java|kt)$/.test(d.name) ? [p] : [];
  });
}
const RUTING = /shouldOverrideUrlLoading|setWebViewClient|setWebChromeClient|WebViewClient|WebChromeClient|\bloadUrl\s*\(|\bpostUrl\s*\(|\bloadData(?:WithBaseURL)?\s*\(/;
const nativeFiler = javaFiler(NATIV_SRC, true);
const ruter = nativeFiler.filter((p) => RUTING.test(strippet(fs.readFileSync(p, 'utf8'), 'js')));
check('det native skallet overtar ikke og hopper ikke over navigasjonsrutingen',
  nativeFiler.length > 0 && ruter.length === 0,
  ruter.map((p) => path.relative(ROOT, p)).join(', ') || 'ingen av ' + nativeFiler.length + ' native kildefiler');

/* WEB_KILDE er en fast liste, og både sjekkene under og del 9 leser kun den.
   En produksjonsfil utenfor lista ville havnet i `dist/` og kjørt i appen uten
   noen gang å bli skannet, så lista låses fra TO kanter:

     a) alt index.html laster — dekker det vanlige tilfellet, og sier hvilken
        fil som mangler;
     b) alt `build.js` faktisk kopierer ut. Den fanger også en fil ingen
        `<script>`-tagg nevner: `import('./hjelper.js')` på kjøretid, en
        `<script>` bygget i JS, en `importScripts()`. Uansett hvordan den
        lastes MÅ den ligge i repo-roten og bli kopiert, ellers finnes den ikke
        i produksjon.

   Utenfor med vilje: tredjepartskopien i `vendor/` (byte for byte det npm
   publiserte, voktet i tests/security-headers.test.js) og testmodus-filene,
   som build.js river ut av produksjonsbygget.

   Alle tre attributtformene HTML tillater godtas — doble, enkle og helt uten
   anførselstegn — og `<link>` leses tagg for tagg, slik at rekkefølgen på
   `rel`/`href` heller ikke betyr noe. En gyldig variant skal ikke kunne snike
   en fil forbi skanningen. */
const utenKunDev = indexHtml.replace(/huskis:kun-dev:start[\s\S]*?huskis:kun-dev:slutt/g, '');
const attributt = (tag, navn) => {
  const m = tag.match(new RegExp('\\s' + navn + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|([^\\s"\'>]+))', 'i'));
  return m ? (m[1] !== undefined ? m[1] : m[2] !== undefined ? m[2] : m[3]) : null;
};
const lastet = [
  ...[...utenKunDev.matchAll(/<script\b[^>]*>/gi)].map((m) => attributt(m[0], 'src')),
  ...[...utenKunDev.matchAll(/<link\b[^>]*>/gi)]
    .filter((m) => /stylesheet/i.test(attributt(m[0], 'rel') || ''))
    .map((m) => attributt(m[0], 'href')),
].filter((s) => s && !s.startsWith('vendor/'));
const uskannet = lastet.filter((s) => WEB_KILDE.indexOf(s) === -1);
check('alle produksjonskildene index.html laster står i WEB_KILDE (og blir dermed skannet)',
  lastet.length > 0 && uskannet.length === 0, uskannet.join(', ') || lastet.join(', '));

/* Samme lås fra byggsiden: SKIP-listen og testmodus-filene leses ut av
   build.js, så de to kan ikke komme i utakt. */
const buildSkip = new Set(((build.match(/const SKIP = new Set\(\[([\s\S]*?)\]\);/) || [, ''])[1]
  .match(/'([^']+)'/g) || []).map((s) => s.slice(1, -1)));
const testModus = ((build.match(/const TEST_MODE_FILES = \[([^\]]*)\]/) || [, ''])[1]
  .match(/'([^']+)'/g) || []).map((s) => s.slice(1, -1));
const buildSkipExt = new Set(((build.match(/const SKIP_EXT = new Set\(\[([^\]]*)\]\)/) || [, ''])[1]
  .match(/'([^']+)'/g) || []).map((s) => s.slice(1, -1)));
/* build.js kopierer REKURSIVT (copyDir), så en `assets/hjelper.js` ville blitt
   med ut like fullt som en fil i roten. Inventaret går derfor samme vei:
   SKIP-listen gjelder bare øverste nivå, akkurat som i build.js. `vendor/` er
   tredjepartskopien, voktet i tests/security-headers.test.js. */
function utsendteFiler(dir, topp) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    /* Nøyaktig build.js' egen semantikk: SKIP-navnene, utelatte filtyper OG
       testmodus-filene gjelder bare ØVERSTE nivå. En `assets/dev-mock.js`
       kopieres altså ut, og skal derfor skannes. */
    if (topp && (buildSkip.has(d.name) || buildSkipExt.has(path.extname(d.name))
      || testModus.indexOf(d.name) > -1 || d.name === 'vendor')) return [];
    const p = path.join(dir, d.name);
    if (d.isDirectory()) return utsendteFiler(p, false);
    /* Filtypene som KAN inneholde en lenke eller en navigasjon. Et bilde eller
       en fontfil kopieres også ut, men har ingen kode å skanne. */
    return /\.(html?|[mc]?js|css)$/i.test(d.name) ? [path.relative(ROOT, p)] : [];
  });
}
const utsendt = utsendteFiler(ROOT, true);
const utsendtUskannet = utsendt.filter((n) => WEB_KILDE.indexOf(n) === -1);
check('alle web-kildefilene build.js kopierer ut står i WEB_KILDE',
  testModus.length > 0 && utsendt.length > 0 && utsendtUskannet.length === 0,
  utsendtUskannet.join(', ') || utsendt.join(', '));


/* Web-siden av regelen. Kjørende kode i ALLE web-kildefilene: kommentarer og
   dokumentasjon får omtale lenker fritt.

   Mønstrene kjøres mot HELE den strippede fila, ikke linje for linje. Et kall
   formatert over to linjer — `el.setAttribute(` og `'href', …)` på neste — har
   ellers verken metode eller attributt på samme linje, og ville sluppet forbi
   alle sammen. `\s` i mønstrene dekker linjeskiftet; treffets posisjon regnes
   om til linjenummer for evidensen.

   To slag av sjekk, med vilje forskjellig strenge:

   a) i MARKUP kreves et skjema, fordi `href` der også brukes helt legitimt
      (`href="favicon.svg"`, `href="#…"`). `geo:`, `sms:`, `intent:` og
      `market:` teller like mye som `https:` — skjemaet listes derfor ikke opp.
      `formaction` er med fordi en knapp med den navigerer når skjemaet sendes,
      og ordgrensen foran `action` ville ellers hoppet over den;
   b) gjennom DOM-API-et flagges destinasjonen UANSETT verdi. Appen setter ikke
      én eneste `href`/`action` fra JS i dag, så regelen kan være absolutt — og
      bare da fanger den `setAttribute('href', enVariabel)`, som ingen
      verdibasert sjekk kan se. `src` er ikke med: et bilde er en ressurs, ikke
      en navigasjon, og styres av CSP-ens `img-src`. */
const MARKUP = '\\b(?:href|(?:form)?action)\\s*=\\s*\\\\?["\']?\\s*';
const UT_MØNSTRE = [
  ['_blank', /target\s*=\s*["']?_blank/gi],
  /* Både `window.open(` og den globale, ukvalifiserte `open(` — samme
     navigasjon. Foranstilt `[^.\w$]` holder `api.open()` og `step.reopen()`
     utenfor. */
  ['open()', /(?:^|[^.\w$])(?:window\s*\.\s*)?open\s*\(/gm],
  ['setAttribute', /\.\s*setAttribute\s*\(\s*["'`](?:xlink:)?(?:href|(?:form)?action)["'`]\s*,/gi],
  ['.href =', /(?:^|[^.\w$])(?!location\b)[\w$\])]+\s*(?:\.\s*(?:href|formAction|action)|\[\s*["'`](?:href|formaction|action)["'`]\s*\])\s*(?:\*\*|<<|>>>?|\|\||&&|\?\?|[-+*/%|&^])?=(?!=)/gim],
  ['skjema i markup', new RegExp(MARKUP + '[a-z][a-z0-9+.\\-]*:', 'gi')],
  /* Protokoll-relativ, med begge skråstrekene. URL-parseren normaliserer
     omvendt skråstrek til vanlig for spesialskjemaer, så `href="\\\\vert"`
     lander på `//vert` — samme utgående lenke. */
  ['protokoll-relativ', new RegExp(MARKUP + '[\\\\/]{2}', 'gi')],
  /* Deklarativ navigasjon uten en eneste lenke: nettleseren drar av gårde selv.
     Huskis har ÉN http-equiv, og det er innholdssikkerhetspolicyen. */
  ['meta refresh', /http-equiv\s*=\s*["']?refresh/gi],
  /* Vendor-API-er som NAVIGERER for oss. supabase-js sender nettleseren til
     leverandøren med `location.assign()` inne i biblioteket, så kallstedet
     her har ingen navigasjon å se — men appen forlater WebView-en like fullt.
     Huskis bruker e-post + passord og ingen av disse i dag
     (docs/domains-and-urls.md); tas OAuth i bruk, er det en beslutning som
     hører hjemme i det dokumentet, ikke en stille tilføyelse. */
  ['vendor-API som navigerer', /\.\s*(?:signInWithOAuth|linkIdentity)\s*\(/g],
];
const utLenker = [];
for (const f of WEB_KILDE) {
  const { tekst, linjeFor } = strippetMedLinjer(les(f), modusFor(f));
  for (const [navn, re] of UT_MØNSTRE) {
    re.lastIndex = 0;
    for (const m of tekst.matchAll(re)) utLenker.push(f + ':' + linjeFor(m.index) + ' (' + navn + ')');
  }
}
check('web-kildekoden produserer ingen utgående lenke (ingen _blank, open(), DOM-satt destinasjon, meta refresh eller href/action med skjema)',
  utLenker.length === 0, utLenker.join(', ') || 'ingen');

/* VAKT FOR VAKTEN. Alle sjekkene over hviler på at kommentarfjerneren faktisk
   etterlater koden. Hver feil den har hatt — `<!--` lest som markup i JS, `//`
   inne i en URL, `/*` inne i et regex-literal — har samme signatur: teksten
   BLIR TOM fra et punkt og ut, og mønstrene finner selvsagt ingenting. Da står
   sjekkene grønne på ingenting, som er verre enn å ikke ha dem.

   Kanariet er derfor uavhengig av hvilken feil det er: koden må fortsatt være
   der. Slutter en fil å ha kjørende kode nær slutten, har fjerneren spist noe
   den ikke skulle. */
const svelget = [];
for (const f of WEB_KILDE) {
  const L = kodeLinjerStreng(les(f), modusFor(f));
  const sisteKode = L.length - 1 - [...L].reverse().findIndex((x) => x.l.trim());
  const andel = L.filter((x) => x.l.trim()).length / L.length;
  if (L.length - sisteKode > 5 || andel < 0.15) {
    svelget.push(f + ' (siste kode på linje ' + (sisteKode + 1) + ' av ' + L.length
      + ', ' + Math.round(andel * 100) + '% kodelinjer)');
  }
}
check('kommentarfjerneren spiser ikke kode — hver fil har kjørende kode helt ut',
  svelget.length === 0, svelget.join('; ') || WEB_KILDE.length + ' filer intakte');

/* Ryggraden bak alle formene over: hvilke FREMMEDE adresser frontend i det
   hele tatt navngir. Et tekstsøk kan aldri se en adresse som kommer inn som en
   variabel, men det kan holde lista over hardkodede adresser på nøyaktig de to
   dokumentet lover — og da må enhver ny utgående adresse, uansett hvilken
   API-form den brukes gjennom, innom denne sjekken først.

   Verdiene UTLEDES av config.js, så et bytte av Supabase-prosjekt eller
   kanonisk domene ikke feller testen. CSP-ens egne verter står i et flerlinjes
   attributt og dekkes av tests/security-headers.test.js. */
const cfgTekst = les('config.js');
const TILLATTE_URL = [
  (cfgTekst.match(/url:\s*'([^']+)'/) || [, ''])[1],
  (cfgTekst.match(/canonicalAppUrl:\s*'([^']+)'/) || [, ''])[1],
].filter(Boolean).flatMap((u) => [u.replace(/\/+$/, ''), u.replace(/\/+$/, '') + '/']);
const fremmedeUrl = [];
for (const f of WEB_KILDE) {
  for (const { nr, l } of kodeLinjerStreng(les(f), modusFor(f))) {
    for (const m of l.matchAll(/["'`](https?:\/\/[^"'`\s]*)/gi)) {
      if (TILLATTE_URL.indexOf(m[1]) === -1) fremmedeUrl.push(f + ':' + nr + ' → ' + m[1]);
    }
  }
}
check('kjørende webkode navngir ingen andre absolutte adresser enn Supabase-endepunktet og det kanoniske originet',
  TILLATTE_URL.length === 4 && fremmedeUrl.length === 0,
  fremmedeUrl.join(', ') || 'tillatt: ' + TILLATTE_URL.join(', '));

/* Appen navigerer seg selv nøyaktig ett sted, og det er guarden for kanonisk
   origin. Kommer det et sted til, kan appen sende seg selv ut av sine egne
   innebygde filer — og i WebView-en ville den navigasjonen dessuten blitt en
   ACTION_VIEW, altså en app som blir stående igjen på siden sin mens
   browseren åpner. `location.reload()` er ikke med: den går til den samme
   adressen, og dekkes av tests/auto-update.test.js. Lesing av
   `location.href`/`location.origin` er heller ikke navigasjon.

   Alle formene teller, ikke bare `location.href = …`: en tilordning rett til
   Location-objektet (`location = …`, `document.location = …`) navigerer like
   fullt, og ville dessuten gått klar av lenkesjekken over. Foranstilt
   `[^.\w$]` holder `elem.location = …` og lignende egenskaper utenfor, og den
   valgfrie `.href`-halen gjør at `redirectUrlFor(location.href)` — en LESING —
   ikke telles.

   `=(?!=)` og ikke `=[^=]`: en tilordning som brekker linja rett etter
   likhetstegnet («location.href =» + adressen på neste linje) har ingenting
   ETTER `=` å matche på, og ville sluppet unna. Lookahead-en skiller den
   likevel fra `==`/`===`. */
/* `location.assign/replace`, KLAMMENOTASJONEN av de samme
   (`location['assign'](…)`), og den moderne Navigation API-en
   (`navigation.navigate(…)`) — alle tre navigerer dokumentet. */
const NAV_KALL = /\blocation\s*(?:\.\s*(?:assign|replace)|\[\s*["'`](?:assign|replace)["'`]\s*\])\s*\(|(?:^|[^.\w$])(?:window\s*\.\s*)?navigation\s*\.\s*navigate\s*\(/gm;
/* Ikke bare `.href`: HVER skrivbar del av Location navigerer. Setter du
   `location.host`, `.protocol`, `.pathname` eller `.search`, laster siden på
   nytt mot en ny adresse — like mye en navigasjon som å sette hele href-en.
   `.hash` er med selv om den er same-document: den er også et sted appen
   flytter seg selv, og det finnes ingen i dag. */
const LOC_DEL = 'href|host|hostname|protocol|port|pathname|search|hash';
/* Også SAMMENSATT tilordning: `location.search += '&x=1'` kaller setteren og
   navigerer like fullt. `=(?!=)` alene godtok bare den bare formen. */
const TILDEL = '(?:\\*\\*|<<|>>>?|\\|\\||&&|\\?\\?|[-+*/%|&^])?=(?!=)';
const NAV_TILDEL = new RegExp(
  '(?:^|[^.\\w$])(?:(?:window|document|self|globalThis|top|parent)\\s*\\.\\s*)?location\\s*'
  + '(?:(?:\\.\\s*(?:' + LOC_DEL + ')|\\[\\s*["\'`](?:' + LOC_DEL + ')["\'`]\\s*\\])\\s*)?' + TILDEL, 'gm');
/* Som lenkesjekkene: mot HELE den strippede fila. Et uttrykk som brekker foran
   egenskapen — `location` på én linje, `.assign(…)` på neste — har ellers ikke
   begge delene på samme linje. */
const navSkriv = [];
for (const f of WEB_KILDE) {
  const { tekst, linjeFor } = strippetMedLinjer(les(f), modusFor(f));
  for (const re of [NAV_KALL, NAV_TILDEL]) {
    re.lastIndex = 0;
    for (const m of tekst.matchAll(re)) {
      const nr = linjeFor(m.index);
      navSkriv.push({ sted: f + ':' + nr, l: (tekst.split('\n')[nr - 1] || '').trim() });
    }
  }
}
/* ---- Det som FAKTISK pakkes ----

   Alt over leser repoets kildefiler. Men det er `dist/` Capacitor kopierer inn
   i APK-en, og `build.js` transformerer på veien: den stempler build-ID,
   river ut testmodus-blokken, og kunne i prinsippet lagt inn hva som helst.
   En lenke som oppstår i byggesteget ville aldri vist seg i kilden.

   Derfor kjøres en ekte build, og utfallet skannes med NØYAKTIG de samme
   mønstrene. `vendor/` er utenfor: den er tredjepartskoden, byte for byte
   verifisert i tests/security-headers.test.js, og den har sine egne
   `window.open`-forekomster som ikke er Huskis' lenker. */
const byggUt = spawnSync('node', ['build.js'], { cwd: ROOT, encoding: 'utf8' });
check('node build.js kjører (grunnlaget for skanningen av dist/)', byggUt.status === 0,
  (byggUt.stderr || '').trim().slice(0, 120) || 'ok');
function distFiler(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    if (d.name === 'vendor') return [];
    const q = path.join(dir, d.name);
    return d.isDirectory() ? distFiler(q)
      : /\.(html?|[mc]?js|css)$/i.test(d.name) ? [q] : [];
  });
}
const DIST = path.join(ROOT, 'dist');
const distTreff = [];
let distAntall = 0;
let guardFritatt = false;
if (byggUt.status === 0 && fs.existsSync(DIST)) {
  for (const q of distFiler(DIST)) {
    distAntall++;
    const rel = path.relative(ROOT, q);
    const { tekst, linjeFor } = strippetMedLinjer(fs.readFileSync(q, 'utf8'), modusFor(q));
    for (const [navn, re] of UT_MØNSTRE) {
      re.lastIndex = 0;
      for (const m of tekst.matchAll(re)) distTreff.push(rel + ':' + linjeFor(m.index) + ' (' + navn + ')');
    }
    for (const m of tekst.matchAll(/["'`](https?:\/\/[^"'`\s]*)/gi)) {
      if (TILLATTE_URL.indexOf(m[1]) === -1) distTreff.push(rel + ' → ' + m[1]);
    }
    /* Også navigasjonsmønstrene: byggesteget kunne like gjerne lagt inn en
       `location.assign(…)` som en `<a>`.

       Guardens ene egne navigasjon er ventet i dist, og fritas — men per
       TREFF, ikke per linje. Fritas hele linja, ville en ekstra navigasjon
       lagt inntil den (`{ location.replace(target); location.assign(target); }`)
       blitt fritatt på kjøpet. Selve treffet må altså BEGYNNE på guardens
       form, og bare det første. */
    for (const re of [NAV_KALL, NAV_TILDEL]) {
      re.lastIndex = 0;
      for (const m of tekst.matchAll(re)) {
        const etter = tekst.slice(m.index, m.index + 40);
          /* Fritaket gjelder ÉN gang, i dist/index.html — ikke én gang per fil.
           Ellers ville en injisert `location.replace(target)` i dist/app.js
           fått sitt eget fritak. */
        if (!guardFritatt && rel === path.join('dist', 'index.html')
          && /location\.replace\(\s*target\s*\)/.test(etter)) { guardFritatt = true; continue; }
        distTreff.push(rel + ':' + linjeFor(m.index) + ' (navigasjon) ' + etter.split('\n')[0].trim());
      }
    }
  }
}
check('den BYGDE dist/ har ingen utgående lenke heller (byggesteget legger ingen inn)',
  byggUt.status === 0 && distAntall > 0 && distTreff.length === 0,
  distTreff.join(', ') || distAntall + ' filer skannet');

check('web-kildekoden navigerer seg selv på nøyaktig ÉN linje',
  navSkriv.length === 1, navSkriv.map((x) => x.sted).join(', ') || 'ingen');
check('den ene linjen er guardens location.replace(target) i index.html',
  navSkriv.length === 1
    && navSkriv[0].sted.startsWith('index.html:')
    && /location\.replace\(target\)/.test(navSkriv[0].l),
  navSkriv.length === 1 ? navSkriv[0].sted + '  ' + navSkriv[0].l : 'mangler');

console.log('\n==== ' + pass + '/' + (pass + fail) + ' PASS ====');
process.exit(fail === 0 ? 0 : 1);
