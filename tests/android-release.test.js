#!/usr/bin/env node
/* ============================================================
   Vakt for BUTIKKBINÆREN: identiteten Google Play låser, og signeringen som
   gjør den til én stabil app i stedet for en ny app for hver build.

   Bakgrunn og faseinndeling: `docs/mobilapp-plan.md`, fase 6. Alt her deler ett
   trekk: feilen koster mer enn den ville gjort noe annet sted i dette repoet.
   Package ID-en kan ikke endres etter første opplasting, `versionCode` kan ikke
   gjenbrukes, og en binær signert med feil nøkkel kan ikke oppgradere den
   forrige — brukeren må avinstallere og miste appdata. Ingen av de tre feilene
   ser gale ut i et grønt bygg.

   Skallets ØVRIGE invarianter — `webDir`, ingen `server.url`, pinnede
   Capacitor-versjoner, OTA-pluginens konfigurasjon, manifestet, debug-APK-
   workflowen — står i `tests/capacitor-android.test.js` og gjentas ikke her.
   Forholdet mellom `versionCode` og OTA-manifestspennet står i
   `tests/release-pipeline.test.js`.

   Dekker:
     1. Package ID: `no.huskis.app` står likt i ALLE seks stedene som navngir
        den, den er en gyldig Android application ID, og ingen annen ID er
        erklært i det som pakkes.
     2. `versionCode`/`versionName`: ett tall i to roller (butikkens
        opplastingsnummer og OTA-ens kompatibilitetsnivå), `versionName` utledet
        av det samme tallet, og en PR-vakt mot at tallet senkes.
     3. Release-signeringen i Gradle: materialet kommer utenfra (miljøvariabler
        eller en gitignorert properties-fil), aldri fra repoet; signingConfig
        settes kun når materialet finnes; og en task-graf-vakt avviser
        release-pakking uten det. Debugveien er urørt.
     4. Ingen hemmeligheter i repoet: ingen sporet keystore, ingen privatnøkkel,
        mønstrene er gitignorert, og den lokale properties-fila ligger et sted
        `build.js` uansett holder utenfor `dist/`.
     5. `.github/workflows/android-release.yml`: samme dist/-kjede som resten av
        mobilappen, testene før artifactet, fail closed i to lag, secretene
        skrives aldri ut, riktig variant (`bundleRelease`), signaturen og
        identiteten LEST UT AV det ferdige artifactet, og AAB-en lastet opp som
        artifact.

   Ren node-test — ingen server, ingen nettleser, ingen Android SDK.

   Kjør:
     node tests/android-release.test.js
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
function ignorert(rel) {
  return spawnSync('git', ['check-ignore', '-q', '--no-index', rel], { cwd: ROOT }).status === 0;
}
/* Linjene med KJØRENDE kode, kommentarene fjernet — samme behov som i
   tests/capacitor-android.test.js: sjekkene under handler om hva Gradle-skriptet
   GJØR, og kommentarene der omtaler både passord og nøkkelfiler i klartekst.
   Groovy og JS har samme kommentarsyntaks, så én funksjon dekker begge. */
function kode(src) {
  let iBlokk = false;
  return src.split('\n').map((raw) => {
    let l = raw;
    if (iBlokk) {
      const slutt = l.indexOf('*/');
      if (slutt === -1) return '';
      l = l.slice(slutt + 2);
      iBlokk = false;
    }
    for (;;) {
      const start = l.indexOf('/*');
      if (start === -1) break;
      const slutt = l.indexOf('*/', start + 2);
      if (slutt === -1) { l = l.slice(0, start); iBlokk = true; break; }
      l = l.slice(0, start) + l.slice(slutt + 2);
    }
    return l.replace(/\/\/.*$/, '');
  }).join('\n');
}
// Heltlinje-kommentarer i YAML. Samme grunn som over.
const utenKommentarer = (y) => y.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');

const APP_ID = 'no.huskis.app';
const appGradle = les('android', 'app', 'build.gradle');
const appGradleKode = kode(appGradle);

/* ---- 1. Package ID: én verdi, seks steder, endelig -------------------------

   Application ID-en er LÅST for appens levetid i det øyeblikket den første
   binæren er lastet opp til Google Play: den er primærnøkkelen til
   Play-oppføringen, til installasjonen på hver telefon og til App
   Signing-nøkkelen. En «ny» ID er en ny app — ny oppføring, nye testere, ingen
   oppgradering av den installerte.

   `no.huskis.app` er derfor behandlet som endelig (docs/mobilapp-plan.md,
   fase 6). Den er reversert domenenavn for huskis.no, den er en gyldig
   Android application ID (sjekket maskinelt under), og ingenting i repoet
   krever noe annet. Det som gjenstår er å holde den LIK alle steder — en
   halv omdøping gir en app som bygger, installerer og oppfører seg riktig
   helt til noe slår opp `package_name` eller custom-scheme og ikke finner
   seg selv. */
const ID_STEDER = [
  ['capacitor.config.json → appId',
    () => json('capacitor.config.json').appId === APP_ID,
    () => json('capacitor.config.json').appId],
  ['android/app/build.gradle → applicationId',
    () => new RegExp('applicationId "' + APP_ID.replace(/\./g, '\\.') + '"').test(appGradleKode),
    () => (appGradleKode.match(/applicationId\s+"([^"]*)"/) || [])[1]],
  ['android/app/build.gradle → namespace',
    () => new RegExp('namespace = "' + APP_ID.replace(/\./g, '\\.') + '"').test(appGradleKode),
    () => (appGradleKode.match(/namespace\s*=\s*"([^"]*)"/) || [])[1]],
  ['strings.xml → package_name',
    () => les('android/app/src/main/res/values/strings.xml')
      .indexOf('<string name="package_name">' + APP_ID + '</string>') > -1,
    () => (les('android/app/src/main/res/values/strings.xml')
      .match(/<string name="package_name">([^<]*)</) || [])[1]],
  /* Custom-schemet er det Capacitor bruker som URL-skjema for appen. Står det
     noe annet enn application ID-en, kan en intent som treffer schemet havne i
     en annen app — eller ingen. */
  ['strings.xml → custom_url_scheme',
    () => les('android/app/src/main/res/values/strings.xml')
      .indexOf('<string name="custom_url_scheme">' + APP_ID + '</string>') > -1,
    () => (les('android/app/src/main/res/values/strings.xml')
      .match(/<string name="custom_url_scheme">([^<]*)</) || [])[1]],
  ['MainActivity.java → package-erklæringen',
    () => /^package no\.huskis\.app;/m.test(les('android/app/src/main/java/no/huskis/app/MainActivity.java')),
    () => (les('android/app/src/main/java/no/huskis/app/MainActivity.java')
      .match(/^package ([^;]*);/m) || [])[1]],
];
for (const [navn, ok, evidens] of ID_STEDER) {
  let bestått = false, ev = '';
  try { bestått = ok(); ev = String(evidens()); } catch (e) { ev = 'kunne ikke leses: ' + e.message; }
  check('package ID står som ' + APP_ID + ' i ' + navn, bestått, ev);
}
// Kildestien MÅ speile pakken — javac godtar ikke noe annet for appmodulen.
check('MainActivity.java ligger i katalogen pakkenavnet krever',
  finnes('android/app/src/main/java/' + APP_ID.split('.').join('/') + '/MainActivity.java'),
  'android/app/src/main/java/' + APP_ID.split('.').join('/') + '/MainActivity.java');

/* Og ingen ANNEN ID erklært i noe Gradle-skript i prosjektet. En variant eller
   en flavor med `applicationIdSuffix` ville gitt butikken en annen ID enn den
   over — appen ville installert side om side med seg selv. */
function gradleFiler(dir, ut = []) {
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = dir + '/' + e.name;
    if (e.isDirectory()) {
      if (e.name === 'build' || e.name === '.gradle' || e.name === 'node_modules') continue;
      gradleFiler(rel, ut);
    } else if (/\.gradle$/.test(e.name)) ut.push(rel);
  }
  return ut;
}
const idErklaeringer = [];
for (const f of gradleFiler('android')) {
  const k = kode(les(f));
  for (const m of k.matchAll(/(applicationId|applicationIdSuffix|namespace)\s*=?\s*"([^"]*)"/g)) {
    idErklaeringer.push({ f, felt: m[1], verdi: m[2] });
  }
}
check('ingen andre application ID-er eller suffikser er erklært i Gradle-prosjektet',
  idErklaeringer.every((e) => e.felt !== 'applicationIdSuffix' && e.verdi === APP_ID),
  idErklaeringer.map((e) => e.f + ':' + e.felt + '=' + e.verdi).join(', '));

/* Og pakkenavnene i det som faktisk PAKKES. `src/test` og `src/androidTest` er
   utenfor med vilje: de kompileres aldri inn i appen, og Capacitor-malens egne
   eksempelklasser ligger der under `com.getcapacitor.myapp`. */
function javaFiler(dir, ut = []) {
  if (!finnes(dir)) return ut;
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = dir + '/' + e.name;
    if (e.isDirectory()) javaFiler(rel, ut);
    else if (/\.java$/.test(e.name)) ut.push(rel);
  }
  return ut;
}
const fremmedePakker = javaFiler('android/app/src/main/java')
  .map((f) => ({ f, pakke: (les(f).match(/^package ([^;]*);/m) || [])[1] }))
  .filter((x) => x.pakke !== APP_ID);
check('all Java-kode som pakkes ligger i ' + APP_ID,
  fremmedePakker.length === 0,
  fremmedePakker.map((x) => x.f + ' → ' + x.pakke).join(', ') || 'ingen fremmede pakker');

/* At ID-en er GYLDIG er ikke en smakssak: Play avviser en ugyldig ID, og en
   ID som inneholder et Java-nøkkelord kan ikke kompileres som pakkenavn i det
   hele tatt. Sjekken står her fordi den er grunnen til at ID-en kan erklæres
   endelig uten å ha vært innom Play Console. */
const JAVA_NOKKELORD = new Set([
  'abstract', 'assert', 'boolean', 'break', 'byte', 'case', 'catch', 'char', 'class',
  'const', 'continue', 'default', 'do', 'double', 'else', 'enum', 'extends', 'final',
  'finally', 'float', 'for', 'goto', 'if', 'implements', 'import', 'instanceof', 'int',
  'interface', 'long', 'native', 'new', 'package', 'private', 'protected', 'public',
  'return', 'short', 'static', 'strictfp', 'super', 'switch', 'synchronized', 'this',
  'throw', 'throws', 'transient', 'try', 'void', 'volatile', 'while',
  '_', 'true', 'false', 'null',
]);
const segmenter = APP_ID.split('.');
check('application ID-en har minst to segmenter (Play krever et punktum)',
  segmenter.length >= 2, segmenter.join(' / '));
check('hvert segment starter med en bokstav og er alfanumerisk',
  segmenter.every((s) => /^[a-zA-Z][a-zA-Z0-9_]*$/.test(s)), segmenter.join(' / '));
check('ingen segmenter er et Java-nøkkelord (ville ikke kunnet kompileres som pakke)',
  segmenter.every((s) => !JAVA_NOKKELORD.has(s)), segmenter.join(' / '));

/* ---- 2. Ett tall i to roller ----------------------------------------------

   `versionCode` er OTA-ens kompatibilitetsnivå (fase 5) OG Google Plays
   monotont økende opplastingsnummer (fase 6). Det skal fortsette å være ETT
   tall: en parallell butikkversjon ville måttet holdes i takt med den første
   for hånd, og den dagen de sprikte ville OTA-manifestet blitt publisert for
   et annet spenn enn skallene som står ute. */
const versionCode = Number((appGradleKode.match(/^\s*versionCode\s+(\d+)\s*$/m) || [])[1]);
check('versionCode står som ETT heltallsliteral på sin egen linje',
  Number.isInteger(versionCode), String(versionCode));
/* Formen er ikke kosmetikk. `.github/scripts/ota-bundle.js` leser tallet med
   nøyaktig dette mønsteret for å regne ut manifestspennet, og et uttrykk
   (`versionCode gitTeller()`) ville ikke latt seg lese der — OTA ville stoppet
   stille. */
const ota = require('../.github/scripts/ota-bundle.js');
check('OTA-byggets egen parser leser det samme tallet',
  ota.readVersionCode(appGradle) === versionCode,
  'ota-bundle.js: ' + ota.readVersionCode(appGradle));

const versionName = (appGradleKode.match(/^\s*versionName\s+"([^"]*)"\s*$/m) || [])[1];
check('versionName er satt', typeof versionName === 'string' && versionName.length > 0,
  versionName || 'mangler');
/* Play krever ingenting av `versionName` — den er en visningsstreng, ikke en
   nøkkel. Men testerne ser den, og Play navngir releasen i konsollen med den,
   så en konstant «1.0» ville gjort to interne testreleaser umulige å skille.
   Beslutningen (docs/mobilapp-plan.md, fase 6) er derfor: fast prefiks +
   versionCode. Da er det fortsatt ETT tall som økes, og navnet kan ikke bli
   stående igjen når nummeret økes. Det er IKKE SemVer — prefikset er en
   etikett og økes ikke. */
check('versionName ender på versionCode — samme tall, ingen parallell versjon',
  typeof versionName === 'string' && versionName.endsWith('.' + versionCode),
  versionName + ' / versionCode ' + versionCode);
check('versionName er ikke bare et nakent tall (Play viser den til testerne)',
  typeof versionName === 'string' && /^[0-9]+(\.[0-9]+)+$/.test(versionName), versionName);

/* ---- 3. Release-signeringen i Gradle --------------------------------------- */
const MILJO = [
  'HUSKIS_UPLOAD_KEYSTORE_FILE',
  'HUSKIS_UPLOAD_KEYSTORE_PASSWORD',
  'HUSKIS_UPLOAD_KEY_ALIAS',
  'HUSKIS_UPLOAD_KEY_PASSWORD',
];
for (const m of MILJO) {
  check('signeringsmaterialet leses fra miljøvariabelen ' + m,
    new RegExp("System\\.getenv\\('" + m + "'\\)|'" + m + "'").test(appGradleKode));
}
/* Den lokale veien inn. Den er standard Android, og den er grunnen til at en
   signert build kan prøves før noen GitHub-secret finnes i det hele tatt. */
check('en lokal, gitignorert properties-fil er alternativet til miljøvariablene',
  /rootProject\.file\('keystore\.properties'\)/.test(appGradleKode), 'android/keystore.properties');
check('miljøvariabelen vinner over den lokale fila',
  /System\.getenv\([^)]*\)[\s\S]{0,200}?getProperty\(/.test(appGradleKode));
/* Og verdien brukes NØYAKTIG som den er gitt. Et passord kan lovlig begynne
   eller slutte med blanktegn, og et `trim()` på vei ut ville endret det —
   uten å si fra. Verre: `keytool`-forsjekken i android-release.yml leser den
   RÅ secreten, så et trimmet passord ville gitt to forskjellige svar på den
   samme verdien (forsjekken ja, Gradle nei). Trimming hører derfor kun til
   tomhetstesten: en blank secret teller som usatt. */
check('tomhetstesten bruker trim', /trim\(\)\.isEmpty\(\)/.test(appGradleKode));
check('…men verdien returneres uendret (et passord kan lovlig ha blanktegn)',
  /erSatt\(v\) \? v : null/.test(appGradleKode)
    && !/[?:]\s*v\.trim\(\)/.test(appGradleKode),
  (appGradleKode.match(/erSatt\(v\) \?[^\n]*/) || ['fant ikke returuttrykket'])[0].trim());

/* Ingen verdi skrevet inn i skriptet. Et literal passord her ville vært en
   hemmelighet i repoet, uansett hvor «midlertidig» den var ment. */
const LITERAL = /\b(storePassword|keyPassword|keyAlias|storeFile)\s+(?:file\s*\(\s*)?['"]/;
const literalLinjer = appGradleKode.split('\n').filter((l) => LITERAL.test(l));
check('ingen nøkkelfil, alias eller passord er skrevet inn i build.gradle',
  literalLinjer.length === 0, literalLinjer.map((l) => l.trim()).join(' | ') || 'ingen');

/* Signeringen henges KUN på release, og kun når materialet finnes. Uten
   betingelsen ville Gradle feilet på et halvt utfylt signingConfig med en
   melding som peker et helt annet sted enn problemet. */
const signingBruk = (appGradleKode.match(/signingConfig\s+signingConfigs\./g) || []);
check('signingConfig settes nøyaktig ETT sted', signingBruk.length === 1,
  signingBruk.join(', ') || 'ingen');
check('…og det er release-blokken, bak betingelsen om at materialet finnes',
  /if \(signeringKlar\) signingConfig signingConfigs\.release/.test(appGradleKode));
check('debugbygget har ingen egen signingConfig (Androids debugnøkkel er urørt)',
  !/debug\s*\{[^}]*signingConfig/.test(appGradleKode));

/* FAIL CLOSED — den ene invarianten som ikke kan leses ut av et grønt bygg.
   Uten vakten fullfører `bundleRelease` uten signingConfig og legger fra seg en
   USIGNERT app-release.aab med det vanlige navnet. */
check('en task-graf-vakt avviser release-pakking uten signeringsmateriale',
  /gradle\.taskGraph\.whenReady/.test(appGradleKode)
    && /throw new GradleException/.test(appGradleKode));
const vaktMonster = (appGradleKode.match(/def RELEASE_PAKKING = ~\/([^/]+)\//) || [])[1];
check('vakten treffer appmodulens egne release-pakkeoppgaver',
  !!vaktMonster && /^\^:app:/.test(vaktMonster)
    && ['assembleRelease', 'bundleRelease', 'packageRelease']
      .every((t) => new RegExp(vaktMonster).test(':app:' + t)),
  vaktMonster || 'fant ikke mønsteret');
check('…og treffer IKKE debugbygget eller bibliotekmodulene',
  !!vaktMonster && !new RegExp(vaktMonster).test(':app:assembleDebug')
    && !new RegExp(vaktMonster).test(':capacitor-android:assembleRelease'),
  vaktMonster || '');
/* Vakten står på task-grafen og ikke i en `doFirst`: da avvises bygget FØR noen
   oppgave har kjørt, og det finnes ingen halvferdig artifact å forveksle med en
   ekte. */
check('vakten står før utførelsen, ikke i en doFirst midt i den',
  !/doFirst[\s\S]{0,400}GradleException/.test(appGradleKode));

/* Setningen workflowen faktisk leter etter i loggen. Står den to forskjellige
   steder, kan den endres ett sted — og da beviser fail-closed-prøven i
   workflowen ingenting mens den fortsatt står grønn. */
const VAKTSETNING = 'Release-signeringen er ikke konfigurert';
check('vakten sier hvorfor bygget ble avvist', appGradleKode.indexOf(VAKTSETNING) > -1, VAKTSETNING);

/* Verdiene forlater aldri prosessen. Navnene får stå i prosa og i
   feilmeldinger — det er VERDIENE som aldri skal nå en logg, altså
   variablene de ligger i. */
const VERDIVARIABLER = /uploadStorePassword|uploadKeyPassword|uploadKeyAlias|signeringsEgenskaper/;
const lekkendeUtskrift = appGradleKode.split('\n')
  .filter((l) => /println|logger\.|print\s*\(/.test(l))
  .filter((l) => VERDIVARIABLER.test(l));
check('Gradle-skriptet skriver aldri ut signeringsmaterialet',
  lekkendeUtskrift.length === 0, lekkendeUtskrift.map((l) => l.trim()).join(' | ') || 'ingen');
/* Feilmeldingen navngir hva som MANGLER — miljøvariabelnavnet — og setter
   aldri verdien inn i teksten. I Groovy skjer det med `+ variabel` eller med
   interpolasjon (`$variabel`, `${variabel}`), så det er de formene som ses
   etter. Unntaket er stien til keystoren (`uploadKeystoreFil`), som ikke er
   hemmelig og er nettopp det man trenger å se når vakten sier at fila ikke
   finnes. */
const innsatteVerdier = appGradleKode.split('\n')
  .filter((l) => new RegExp('(\\+\\s*|\\$\\{?)\\s*(' + VERDIVARIABLER.source + ')\\b').test(l));
check('feilmeldingen navngir hva som mangler, ikke hva verdiene er',
  innsatteVerdier.length === 0,
  innsatteVerdier.map((l) => l.trim()).join(' | ') || 'ingen verdier settes inn i tekst');

/* ---- 4. Ingenting hemmelig i repoet ---------------------------------------- */
const sporet = spawnSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' });
const sporedeFiler = (sporet.stdout || '').split('\n').filter(Boolean);
check('git ls-files svarte (ellers beviser sjekkene under ingenting)',
  sporedeFiler.length > 0, sporedeFiler.length + ' sporede filer');
const nokkelfiler = sporedeFiler.filter((f) => /\.(jks|keystore|p12|pfx)$/i.test(f)
  || /(^|\/)keystore\.properties$/.test(f));
check('ingen keystore eller nøkkellager er sjekket inn',
  nokkelfiler.length === 0, nokkelfiler.join(', ') || 'ingen');
/* Og ingen privatnøkkel i klartekst — `git grep` leser HELE det sporede treet,
   ikke bare filene denne testen ellers åpner. OTA-nøkkelen har allerede den
   samme regelen (docs/mobilapp-plan.md, «Nøkkelparet»); denne fanger begge. */
const pem = spawnSync('git', ['grep', '-lI', '-E', '-e', 'BEGIN [A-Z0-9 ]*PRIVATE KEY'],
  { cwd: ROOT, encoding: 'utf8' });
const pemFiler = (pem.stdout || '').split('\n').filter(Boolean);
check('ingen PEM-privatnøkkel finnes i det sporede treet',
  pemFiler.length === 0, pemFiler.join(', ') || 'ingen');

for (const m of ['keystore.properties', 'android/keystore.properties', 'android/app/upload.jks']) {
  check('gitignorert: ' + m, ignorert(m));
}
/* Den lokale properties-fila ligger under `android/`, som `build.js` uansett
   holder utenfor `dist/`. To uavhengige grunner til at den ikke kan bli
   publisert som web-asset — gitignore og SKIP-listen — der én ville holdt.
   Utfallet av SKIP-listen testes i tests/build-version.test.js. */
const skipBlokk = (les('build.js').match(/const SKIP = new Set\(\[[\s\S]*?\]\);/) || [''])[0];
check('den lokale nøkkelkonfigurasjonen ligger under android/, som build.js hopper over',
  /rootProject\.file\('keystore\.properties'\)/.test(appGradleKode)
    && skipBlokk.indexOf("'android'") > -1);

/* ---- 5. Workflowen som produserer AAB-en ----------------------------------- */
const WF = path.join(ROOT, '.github', 'workflows', 'android-release.yml');
check('.github/workflows/android-release.yml finnes', fs.existsSync(WF));
const wf = fs.existsSync(WF) ? fs.readFileSync(WF, 'utf8') : '';
const wfKode = utenKommentarer(wf);

check('workflowen startes manuelt (butikkbinærer bygges ikke av seg selv)',
  /\n {2}workflow_dispatch:/.test(wfKode));
check('…og kjører dessuten på de PR-ene som kan gjøre den ugyldig',
  /\n {2}pull_request:\s*\n {4}paths:/.test(wfKode));
for (const p of ['android/**', 'capacitor.config.json', 'package.json', 'package-lock.json', 'build.js']) {
  check('workflowen kjører når ' + p + ' endres', wfKode.indexOf("'" + p + "'") > -1);
}
check('workflowen har kun lesetilgang til repoet', /permissions:\s*\n\s*contents: read/.test(wfKode));
/* Den samme kjeden som resten av mobilappen. En egen «mobilbuild» her ville
   gjort butikkbinæren til noe annet enn det huskis.no serverer. */
check('workflowen bruker den samme pinnede Node-versjonen som ci.yml',
  /node-version: '22'/.test(wfKode));
check('workflowen installerer avhengighetene reproduserbart (npm ci)', /npm ci/.test(wfKode));
check('workflowen kjører den vanlige webbuilden', /node build\.js/.test(wfKode));
check('workflowen synkroniserer dist/ til Android', /cap sync android/.test(wfKode));

/* Rekkefølgen leses av STEG, ikke av fila som tekst: et rått `indexOf` fester
   seg like gjerne på et steg-navn eller en avsluttende kommentar, og da kan
   sjekken stå grønn med stegene i feil rekkefølge. Feiler oppdelingen i steg,
   blir indeksene -1 og sjekkene røde — de feiler lukket. */
const wfSteg = wfKode.split(/\n(?=[ \t]{2,}- (?:name|uses|run):)/);
const steg = (mnstr) => wfSteg.findIndex((s) => mnstr.test(s));
const iTester = steg(/^\s*(?:-\s*)?(?:name:[^\n]*\n)?[\s\S]*?run:[\s\S]*?tests\/[a-z-]+\.test\.js/);
const iSync = steg(/run:[^\n]*cap sync android/);
const iByggAab = steg(/run:[^\n]*gradlew[^\n]*bundleRelease\s*$/m);
const iOpplasting = steg(/name: huskis-release-aab/);
const iFailClosed = steg(new RegExp(VAKTSETNING));
check('testene kjøres FØR artifactet produseres',
  iTester > -1 && iByggAab > -1 && iTester < iByggAab,
  'tester: steg #' + iTester + ', bundleRelease: steg #' + iByggAab);
check('AAB-en bygges av den synkroniserte dist/-en, ikke før den',
  iSync > -1 && iByggAab > iSync, 'cap sync: steg #' + iSync + ', bundleRelease: steg #' + iByggAab);
check('artifactet lastes opp etter at det er bygget',
  iOpplasting > -1 && iOpplasting > iByggAab, 'opplasting: steg #' + iOpplasting);

/* Riktig variant. `assembleRelease` gir en APK, som Play ikke tar imot for nye
   apper; `bundleDebug` finnes ikke som butikkartifact i det hele tatt. */
check('workflowen bygger RELEASE-bundelen (AAB), ikke en APK',
  /gradlew[^\n]*bundleRelease/.test(wfKode)
    && !/gradlew[^\n]*assembleRelease/.test(wfKode));
check('artifactet er app-release.aab fra release-varianten',
  /path: android\/app\/build\/outputs\/bundle\/release\/app-release\.aab/.test(wfKode));
check('workflowen feiler hvis AAB-en mangler (ingen tom artifact)',
  /if-no-files-found: error/.test(wfKode));

/* Testene som faktisk kjøres. Nettlesersuiten hører til ci.yml; det som må
   kjøres HER er vaktene som dekker nøyaktig det denne jobben kan ødelegge. */
for (const t of ['build-version', 'capacitor-android', 'android-release', 'release-pipeline']) {
  check('workflowen kjører tests/' + t + '.test.js før bygget',
    new RegExp(t + '\\b').test(wfKode.slice(0, wfKode.indexOf('bundleRelease'))));
}

/* FAIL CLOSED, lag 1: secretene sjekkes samlet før noe arbeid gjøres. */
for (const s of ['ANDROID_UPLOAD_KEYSTORE_BASE64', 'ANDROID_UPLOAD_KEYSTORE_PASSWORD',
  'ANDROID_UPLOAD_KEY_ALIAS', 'ANDROID_UPLOAD_KEY_PASSWORD']) {
  check('workflowen krever secreten ' + s, wfKode.indexOf(s) > -1);
}
check('en manglende secret feller jobben (fail closed, ikke usignert artifact)',
  /if \[ -z "\$\{!s\}" \]/.test(wfKode) && /::error::Mangler secret/.test(wfKode));
/* Og porten står FØRST. Sto den etter testene, npm-installasjonen, webbuilden,
   synken, SDK-installasjonen og fail-closed-prøven, ville en manglende secret
   kostet nesten hele jobben — og, verre, en feil i et av de stegene ville
   stoppet jobben før meldingen «Mangler secret X» rakk å bli skrevet. Da er
   diagnosen borte nøyaktig når den trengs. */
const iSecretPort = steg(/::error::Mangler secret/);
const iNpmCi = steg(/run: npm ci/);
check('secret-porten står FØR alt arbeid som koster tid',
  iSecretPort > -1 && iNpmCi > -1 && iSecretPort < iNpmCi && iSecretPort < iFailClosed,
  'secret-port: steg #' + iSecretPort + ', npm ci: steg #' + iNpmCi
    + ', fail-closed: steg #' + iFailClosed);

/* FAIL CLOSED, lag 2: prøven som KJØRER et release-bygg uten materiale og
   krever at det avvises — av vakten i build.gradle, ikke av en tilfeldig annen
   feil, og uten at det ligger igjen en AAB. Dette er den ene invarianten som
   ikke kan leses ut av en fil, og den kjører også foran hvert signert bygg. */
check('workflowen prøver fail-closed-vakten ved å faktisk kjøre et release-bygg uten nøkkel',
  iFailClosed > -1 && /HUSKIS_UPLOAD_KEYSTORE_PASSWORD: ''/.test(wfKode),
  'steg #' + iFailClosed);
check('…og prøven leter etter NØYAKTIG den setningen vakten skriver',
  wfKode.indexOf(VAKTSETNING) > -1, VAKTSETNING);
check('…og krever at det ikke ligger igjen en AAB etter et avvist bygg',
  /Det ble liggende igjen en AAB/.test(wfKode));
check('…og prøven står FØR det signerte bygget',
  iFailClosed > -1 && iByggAab > -1 && iFailClosed < iByggAab,
  'prøve: steg #' + iFailClosed + ', bygg: steg #' + iByggAab);

/* FAIL CLOSED, lag 3: signaturen leses ut av det FERDIGE artifactet.
   `keytool -printcert -jarfile` feiler hardt på en usignert fil, så steget er
   i seg selv en port — ikke bare en utskrift. */
check('signaturen verifiseres på selve AAB-en etter bygget',
  /keytool -printcert -jarfile/.test(wfKode));
check('sertifikatets fingeravtrykk kan låses mot en kjent verdi (stabil identitet)',
  /vars\.ANDROID_UPLOAD_CERT_SHA256/.test(wfKode)
    && /signert med en ANNEN nøkkel/.test(wfKode));
/* Og identiteten LEST UT AV det bygde manifestet, ikke antatt av kilden. De to
   feltene som ikke kan rettes i ettertid er nettopp disse. */
check('package ID og versionCode leses ut av det bygde release-manifestet',
  /merged_manifest\*\/release/.test(wfKode)
    && /FORVENTET_APPLICATION_ID/.test(wfKode)
    && /FORVENTET_VERSION_CODE/.test(wfKode));

/* Secretene skal aldri kunne havne i en logg eller på disk i repoet. */
const wfLinjer = wfKode.split('\n');
const ekko = wfLinjer.filter((l) => /\b(echo|printf|cat)\b/.test(l)
  && /\$(\{)?ANDROID_UPLOAD_(KEYSTORE_PASSWORD|KEY_PASSWORD|KEY_ALIAS)/.test(l));
check('workflowen skriver aldri ut passordene eller aliaset',
  ekko.length === 0, ekko.map((l) => l.trim()).join(' | ') || 'ingen');
/* `printf` av base64-secreten er den ene som MÅ finnes — den skriver keystoren
   til disk — og den skal gå i en pipe til `base64 -d`, aldri til stdout. */
const base64Utskrift = wfLinjer.filter((l) => /\$ANDROID_UPLOAD_KEYSTORE_BASE64/.test(l)
  && /echo|printf/.test(l));
check('base64-secreten røres kun av dekodingen, aldri av en utskrift',
  base64Utskrift.every((l) => /\|\s*(tr|base64)/.test(l)),
  base64Utskrift.map((l) => l.trim()).join(' | ') || 'ingen');
check('keystoren skrives UTENFOR repoet ($RUNNER_TEMP)',
  /RUNNER_TEMP\/huskis-upload\.jks/.test(wfKode) && !/keystore\.properties/.test(wfKode));
check('keystoren fjernes fra runneren uansett utfall',
  /if: always\(\)\s*\n\s*run: rm -f "\$RUNNER_TEMP\/huskis-upload\.jks"/.test(wfKode));
/* Passordene settes på det ene steget som trenger dem — ikke i $GITHUB_ENV,
   som ville båret dem videre til hvert eneste steg etterpå, inkludert
   opplastingen. */
check('passordene går aldri gjennom $GITHUB_ENV',
  !/GITHUB_ENV[\s\S]{0,200}HUSKIS_UPLOAD_KEY(STORE)?_PASSWORD/.test(wfKode)
    && !/HUSKIS_UPLOAD_KEY(STORE)?_PASSWORD[^\n]*>>\s*"\$GITHUB_ENV"/.test(wfKode));
/* Keytool får passordet som miljøvariabel (`:env`). Et argument på
   kommandolinja er synlig for andre prosesser på runneren. */
check('keytool får passordet som miljøvariabel, ikke som kommandolinjeargument',
  !/-storepass\s+["$]/.test(wfKode));

/* Og det signerte bygget kjører KUN på manuell start. På en pull request —
   som kan komme fra en fork — er jobben ferdig etter fail-closed-prøven, og
   har aldri sett en secret. */
const signerteSteg = wfSteg.filter((s) => /secrets\.ANDROID_UPLOAD_/.test(s));
check('hvert steg som rører en secret er gated på workflow_dispatch',
  signerteSteg.length > 0 && signerteSteg.every((s) => /if: github\.event_name == 'workflow_dispatch'/.test(s)),
  signerteSteg.length + ' steg med secrets');

/* PR-vakten mot at `versionCode` senkes. Play avviser en gjenbrukt verdi, og en
   senket verdi ville dessuten krympet OTA-manifestspennet under skall som alt
   står ute — ingen av delene oppdages av et bygg. */
check('workflowen sjekker på PR at versionCode ikke er senket',
  /versionCode er senket/.test(wfKode)
    && /github\.event\.pull_request\.base\.sha/.test(wfKode));
check('…og leser tallet med den samme parseren som OTA-manifestet bruker',
  /ota-bundle\.js[\s\S]{0,200}readVersionCode/.test(wfKode));

/* ---- 6. Debugveien er urørt ------------------------------------------------
   Fase 6 skal ikke koste den sideloadede debug-APK-en, som fortsatt er måten
   en enhetsøkt gjøres på. */
const debugWf = utenKommentarer(les('.github/workflows/android-debug.yml'));
check('debug-workflowen bygger fortsatt assembleDebug',
  /gradlew[^\n]*assembleDebug/.test(debugWf));
check('debug-workflowen signerer fortsatt ingen release',
  !/assembleRelease|bundleRelease|signingConfig|KEYSTORE/.test(debugWf));
check('npm-skriptet for debug-APK-en er uendret',
  /assembleDebug/.test((json('package.json').scripts || {})['android:debug'] || ''),
  (json('package.json').scripts || {})['android:debug']);

console.log('\n==== ' + pass + '/' + (pass + fail) + ' PASS ====');
process.exit(fail === 0 ? 0 : 1);
