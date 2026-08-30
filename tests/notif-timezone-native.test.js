/*
  Regresjonstest: TIDSSONEBYTTE MENS APPEN ER HELT LUKKET (docs/varsler.md).

  Det finnes to helt ulike tilfeller, og de løses av hvert sitt lag:

    1. Appen KJØRER når sonen endres. Da speiler `syncNotifChannel()` planen på
       nytt i enhetens egen sone, og alarmene erstattes. Det er dekket av
       `notif-channels` 2s–2v, og det er alt DEN testen kan bevise: at Huskis
       retter alarmene når JavaScript får kjøre.

    2. Appen er LUKKET. Da kjører ingenting av Huskis. Alarmen ble satt med
       `AlarmManager.RTC_WAKEUP` og et ABSOLUTT millisekund, og pluginen lytter
       bare på oppstart — så uten et ekstra ledd blir en alarm som var ment
       kl. 09:00 i Oslo stående på det gamle instantet og ringer kl. 17:00 i
       Tokyo.

  Det ekstra leddet er `no.huskis.app.TimeZoneAlarmReceiver` +
  `HuskisWallClock`. Selve OMREGNINGEN prøves der den bor, som en ekte
  JVM-test på produksjonskoden (`android/app/src/test/…/HuskisWallClockTest`,
  kjørt av `./gradlew testDebugUnitTest` i debug-APK-jobben).

  Denne fila låser det den testen ikke kan se: at de to lagene henger sammen,
  og at ingen fjerner et ledd uten å merke det.

  Dekker:
     1. `notifWallClock()` — den rene JS-funksjonen: formen, presisjonen og at
        den er LOKAL (ikke UTC).
     2. Formen er NØYAKTIG den Java-siden parser, tegn for tegn.
     3. Android-adapteren legger `wall` i `extra` på hvert planlagte varsel.
     4. Manifestet registrerer receiveren for TIMEZONE_CHANGED, og den er ikke
        eksportert.
     5. Receiveren skriver den korrigerte tiden TILBAKE til lagringen før den
        planlegger — ellers gjenoppstår det gamle tidspunktet ved reboot.
     6. Ingen ny tillatelse, og SCHEDULE_EXACT_ALARM er fortsatt trukket
        tilbake.
     7. CI kjører faktisk JVM-testen.

  Kjør:
    node tests/notif-timezone-native.test.js
*/
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const les = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

const results = [];
const check = (n, ok, x = '') => {
  results.push(ok);
  console.log((ok ? 'PASS' : 'FAIL') + ' — ' + n +
    (x !== '' ? '  [' + (typeof x === 'string' ? x : JSON.stringify(x)) + ']' : ''));
};

const appJs = les('app.js');
const manifest = les('android', 'app', 'src', 'main', 'AndroidManifest.xml');
const wallClock = les('android', 'app', 'src', 'main', 'java', 'no', 'huskis', 'app', 'HuskisWallClock.java');
const receiver = les('android', 'app', 'src', 'main', 'java', 'no', 'huskis', 'app', 'TimeZoneAlarmReceiver.java');
const enhetstest = les('android', 'app', 'src', 'test', 'java', 'no', 'huskis', 'app', 'HuskisWallClockTest.java');
const debugWf = les('.github', 'workflows', 'android-debug.yml');

/* ---- 1. Den rene JS-funksjonen ----
   Hentes ut av app.js og kjøres for seg: fila er et IIFE med DOM-avhengigheter,
   og formen på denne ene strengen er det eneste som skal prøves her. */
const kilde = appJs.slice(appJs.indexOf('function notifWallClock(ms) {'));
const notifWallClock = new Function('return ' + kilde.slice(0, kilde.indexOf('\n  }') + 4))();

// Et fast lokalt tidspunkt, uttrykt gjennom Date-konstruktøren — altså i
// nøyaktig den sonen node kjører i, hva den nå enn er.
const t = new Date(2026, 8, 4, 9, 0, 0, 0).getTime();
check('1a formen er lokal ISO uten sone, med millisekunder',
  notifWallClock(t) === '2026-09-04T09:00:00.000', notifWallClock(t));
check('1b millisekundene bevares (en dato-frist har terskel 23:59:59.999)',
  notifWallClock(new Date(2026, 8, 4, 23, 59, 59, 999).getTime()) === '2026-09-04T23:59:59.999',
  notifWallClock(new Date(2026, 8, 4, 23, 59, 59, 999).getTime()));
check('1c ettsifrede felt er nullpolstret',
  notifWallClock(new Date(2026, 0, 2, 3, 4, 5, 6).getTime()) === '2026-01-02T03:04:05.006',
  notifWallClock(new Date(2026, 0, 2, 3, 4, 5, 6).getTime()));
check('1d strengen bærer INGEN sone — det er hele poenget',
  !/[Zz]$|[+-]\d\d:?\d\d$/.test(notifWallClock(t)));

/* ---- 2. Samme form på begge sider ---- */
const veggFormat = (wallClock.match(/VEGG_FORMAT\s*=\s*"([^"]+)"/) || [])[1];
check('2a Java-siden parser "yyyy-MM-dd\'T\'HH:mm:ss.SSS"',
  veggFormat === "yyyy-MM-dd'T'HH:mm:ss.SSS", veggFormat);
// … og den formen skal matche det JS faktisk skriver, tegn for tegn.
const somRegex = veggFormat
  .replace(/'T'/g, 'T').replace(/yyyy/, '\\d{4}').replace(/MM/, '\\d{2}')
  .replace(/dd/, '\\d{2}').replace(/HH/, '\\d{2}').replace(/mm/, '\\d{2}')
  .replace(/ss/, '\\d{2}').replace(/SSS/, '\\d{3}').replace(/\./g, '\\.');
check('2b JS-strengen går opp i Java-mønsteret',
  new RegExp('^' + somRegex + '$').test(notifWallClock(t)), somRegex);
check('2c Java-siden parser STRENGT (hale-tekst godtas ikke)',
  /ParsePosition/.test(wallClock) && /pos\.getIndex\(\) != tekst\.length\(\)/.test(wallClock));

/* ---- 3. Adapteren legger veggtiden ved ---- */
check('3a hvert planlagt varsel bærer sin egen veggtid i extra',
  /extra:\s*\{[^}]*wall:\s*notifWallClock\(r\.at\)/.test(appJs),
  (appJs.match(/extra:\s*\{[^}]*\}/) || ['—'])[0].slice(0, 100));
check('3b feltet heter det samme på begge sider',
  /extra\.optString\("wall"/.test(wallClock) || /optString\("wall"/.test(wallClock));

/* ---- 4. Manifestet ---- */
const blokk = (manifest.match(/<receiver[^>]*TimeZoneAlarmReceiver[\s\S]*?<\/receiver>/) || [''])[0];
check('4a receiveren er registrert', !!blokk);
check('4b … for TIMEZONE_CHANGED',
  /android\.intent\.action\.TIMEZONE_CHANGED/.test(blokk));
check('4c … og er IKKE eksportert (bare systemet sender den)',
  /android:exported="false"/.test(blokk));
check('4d klassenavnet i manifestet finnes som fil',
  /android:name="\.TimeZoneAlarmReceiver"/.test(blokk) &&
  /class TimeZoneAlarmReceiver extends BroadcastReceiver/.test(receiver));
check('4e receiveren avviser alt annet enn TIMEZONE_CHANGED',
  /ACTION_TIMEZONE_CHANGED\.equals\(intent\.getAction\(\)\)/.test(receiver));

/* ---- 5. Reboot: lagringen skrives FØR alarmen ---- */
const iLagring = receiver.indexOf('storage.appendNotifications(');
const iPlan = receiver.indexOf('.schedule(null, endret)');
check('5a den korrigerte tiden skrives tilbake til pluginens lagring',
  iLagring !== -1, iLagring);
check('5b … FØR alarmen settes (ellers gjenoppstår gammel tid ved reboot)',
  iLagring !== -1 && iPlan !== -1 && iLagring < iPlan, [iLagring, iPlan]);
check('5c pluginens egne klasser brukes — ingen fork, ingen kopi',
  /import com\.capacitorjs\.plugins\.localnotifications\.NotificationStorage;/.test(receiver) &&
  /import com\.capacitorjs\.plugins\.localnotifications\.LocalNotificationManager;/.test(receiver));
check('5d en alarm som ALT har ringt røres aldri (ingen dublett)',
  /gammel <= now\) return null;/.test(wallClock));
check('5e uendret tid gir ingen skriving',
  /ny == gammel\) return null;/.test(wallClock));

/* ---- 6. Ingen ny tillatelse ---- */
check('6a receiveren krever ingen ny uses-permission',
  (manifest.match(/<uses-permission/g) || []).length === 3,
  (manifest.match(/android:name="android\.permission\.[A-Z_]+"/g) || []).join(' '));
check('6b SCHEDULE_EXACT_ALARM er fortsatt trukket tilbake',
  /SCHEDULE_EXACT_ALARM"\s*\n?\s*tools:node="remove"/.test(manifest));
check('6c adapteren planlegger fortsatt upresist',
  /isExactNotification:\s*false/.test(appJs));
check('6d omregningen rører aldri isExactNotification',
  !/isExactNotification/.test(wallClock.replace(/\/\*[\s\S]*?\*\//g, '')));

/* ---- 7. JVM-testen kjøres faktisk ---- */
check('7a JVM-testen finnes og prøver reisen',
  /alarmenFlytterSegTilSammeVeggtidIDenNyeSonen/.test(enhetstest) &&
  /Asia\/Tokyo/.test(enhetstest) && /Europe\/Oslo/.test(enhetstest));
check('7b … og at en alarm som alt har ringt ikke røres',
  /enAlarmSomAltHarRingtRoresIkke/.test(enhetstest));
check('7c … og at den korrigerte tiden overlever reboot',
  /denKorrigerteTidenErDENSomLagres/.test(enhetstest));
check('7d debug-APK-jobben kjører testDebugUnitTest',
  /testDebugUnitTest/.test(debugWf),
  (debugWf.match(/.*gradlew.*/g) || []).join(' | '));
check('7e org.json er på testklassestien (android.jar-stubben kaster ellers)',
  /testImplementation "org\.json:json:\$orgJsonVersion"/.test(les('android', 'app', 'build.gradle')) &&
  /orgJsonVersion = '[\d.]+'/.test(les('android', 'variables.gradle')));

const feil = results.filter((r) => !r).length;
console.log('\n' + (results.length - feil) + ' passed, ' + feil + ' failed');
process.exit(feil ? 1 : 0);
