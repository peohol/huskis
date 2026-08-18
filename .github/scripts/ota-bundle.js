#!/usr/bin/env node
/* ============================================================
   Bygger, signerer og publiserer OTA-bundelen for Android (fase 5,
   `docs/mobilapp-plan.md`).

   Kjøres av `.github/workflows/release.yml` i deployjobben — altså bak
   `needs: smoke`, på NØYAKTIG den commiten som nettopp ble migrert og
   smoke-testet — og legger utdataene i treet FØR `vercel deploy`. Vercel-
   builden kopierer dem ut i `dist/` (mappen står ikke i SKIP-listen i
   `build.js`), slik at de serveres fra huskis.no sammen med resten av appen.

   Tre ting produseres:

     ota/bundles/<bundleId>.zip   web-assetene, zippet fra `dist/`
     ota/android/<versionCode>.json  ett manifest per STØTTET native nivå
     (signaturen, som står inne i manifestet)

   MANIFEST-URL-EN BÆRER DEN NATIVE KOMPATIBILITETSGRENSEN. Det er den valgte
   formen av de to planen stilte opp, og den er valgt fordi vakten da ikke
   ligger i klientkoden: et skall spør etter manifestet for SITT eget
   `versionCode`, og finnes ikke det nivået, får det 404 og gjør ingenting.
   Klienten trenger verken å parse et tall eller sammenligne — den bygger en
   URL av strengen `getVersionCode()` gir den. Et nivå er støttet nøyaktig når
   denne kjøringen skrev en fil for det.

   SIGNATUREN er `SHA256withRSA` over ZIP-ens bytes, base64 — laget med Nodes
   standardbibliotek alene (`crypto.createSign('sha256')`). Pluginen verifiserer
   med `Signature.getInstance("SHA256withRSA")` og en X.509-nøkkel den leser fra
   `publicKey` i `capacitor.config.json`; ingen leverandørformat i mellom, og
   derfor ingen ny avhengighet i byggesteget.

   OG SIGNATUREN VERIFISERES HER, FØR MANIFESTET SKRIVES. Privatnøkkelen er en
   Actions-secret og den offentlige halvdelen er pakket inn i APK-en: kommer de
   to i utakt, kan INGEN telefon verifisere bundelen (pluginen er fail closed på
   signatur og faller ikke tilbake til checksum). Da skal releasen stoppe her,
   ikke oppdages som en stille OTA-stopp senere.

   INGEN `checksum` i manifestet — med vilje. Lest i pluginens kilde: `checksum`
   sjekkes kun i `else`-grenen når `publicKey` IKKE er satt. Et checksum-felt
   ved siden av signaturen ville påstått en kontroll som aldri kjører.

   Kjør (miljøvariablene release.yml setter):
     OTA_SIGNING_KEY='<privat RSA-nøkkel, PKCS#8 PEM>' \
     OTA_MIN_VERSION_CODE=2 \
     node .github/scripts/ota-bundle.js
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');

/* Det kanoniske originet, det samme `config.js` navngir som `canonicalAppUrl`
   og `index.html` sender de alternative domenene til. Bundelen lastes ned av
   NATIV kode (OkHttp), ikke av WebView-en, så URL-en må være absolutt —
   en rot-relativ sti ville pekt på `https://localhost` inne i appen. */
const BASE_URL = 'https://huskis.no/ota';

/* ---- Rene funksjoner: det testene kjører uten runner og uten secrets ---- */

// `SHA256withRSA` over filens bytes, base64. Nodes standardvalg for en
// RSA-nøkkel er PKCS#1 v1.5-padding, som er nøyaktig det Java-navnet betyr.
function signFile(filePath, privateKeyPem) {
  const sign = crypto.createSign('sha256');
  sign.update(fs.readFileSync(filePath));
  sign.end();
  return sign.sign(privateKeyPem, 'base64');
}

function verifyFile(filePath, signatureBase64, publicKeyPem) {
  const verify = crypto.createVerify('sha256');
  verify.update(fs.readFileSync(filePath));
  verify.end();
  return verify.verify(publicKeyPem, signatureBase64, 'base64');
}

/* Nivåene det skrives et manifest for: fra det laveste native skallet denne
   web-bundelen fortsatt virker i, til og med skallet repoet bygger nå.

   Nedre grense kan ALDRI være 1: en APK bygget før OTA-pluginen og en bygget
   etter er native forskjellige, men begge melder Capacitor-malens `versionCode
   1`. Grensen 1 ville sluppet begge inn (`docs/mobilapp-plan.md`). */
function manifestLevels(min, current) {
  if (!Number.isInteger(min) || !Number.isInteger(current)) {
    throw new Error('versionCode-nivåene må være hele tall (fikk ' + min + ', ' + current + ')');
  }
  if (min < 2) throw new Error('Nedre versionCode-grense må være over 1, ikke ' + min);
  if (current < min) {
    throw new Error('versionCode (' + current + ') er lavere enn nedre grense (' + min + ')');
  }
  const ut = [];
  for (let v = min; v <= current; v++) ut.push(v);
  return ut;
}

function readVersionCode(gradleText) {
  const kode = gradleText.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
  const m = kode.match(/^\s*versionCode\s+(\d+)\s*$/m);
  if (!m) throw new Error('Fant ingen versionCode i android/app/build.gradle');
  return Number(m[1]);
}

function bundleUrl(bundleId) {
  return BASE_URL + '/bundles/' + bundleId + '.zip';
}

/* `buildId` ER bundelens identitet mot pluginen. Den beholder rollen den har i
   web-laget (cache og reload, `docs/auto-update.md`) og får denne i tillegg, slik
   at to bygg av samme release ikke kolliderer i pluginens lager. Navnebyttet
   skjer HER, ett sted: `version.json` kjenner bare `buildId`, `downloadBundle()`
   bare `bundleId`. */
function idsFromVersion(version) {
  return {
    bundleId: version.buildId || null,
    releaseId: version.releaseId || null,
    commit: version.commit || null,
    builtAt: version.builtAt || null,
  };
}

/* Manifestet et skall på `versionCode` leser. `versionCode` står også INNE i
   filen, ikke som vakten (den er URL-en), men som en selvkontroll: en klient —
   og testen — kan slå fast at filen den fikk er filen den ba om. */
function buildManifest(felt) {
  return {
    releaseId: felt.releaseId,
    bundleId: felt.bundleId,
    versionCode: felt.versionCode,
    url: bundleUrl(felt.bundleId),
    signature: felt.signature,
    commit: felt.commit,
    builtAt: felt.builtAt,
  };
}

/* ---- Selve jobben ----
   Skilt fra `main()` slik at den kan kjøres med et engangsnøkkelpar over en
   liten testmappe (`tests/release-pipeline.test.js`) — hele veien zip →
   signering → verifisering → manifest, uten secrets og uten en release. */
function publishBundle(opt) {
  const { privateKeyPem, publicKeyPem, ids, versionCode, minVersionCode } = opt;
  /* Absolutte stier hele veien: `zip` kjøres med cwd inne i dist/, og en
     relativ utdata-sti ville da pekt et helt annet sted enn kalleren mente. */
  const distDir = path.resolve(opt.distDir);
  const outDir = path.resolve(opt.outDir);
  const nivaaer = manifestLevels(minVersionCode, versionCode);
  if (!ids.bundleId) throw new Error('Bundelen mangler bundleId (dist/version.json)');
  if (!ids.releaseId) throw new Error('Bundelen mangler releaseId — en ukjent release skal ikke publiseres');
  if (!fs.existsSync(path.join(distDir, 'index.html'))) {
    throw new Error('Fant ingen index.html i ' + distDir + ' — er webbuilden kjørt?');
  }

  const bundlesDir = path.join(outDir, 'bundles');
  fs.mkdirSync(bundlesDir, { recursive: true });
  const zipPath = path.join(bundlesDir, ids.bundleId + '.zip');
  fs.rmSync(zipPath, { force: true });

  /* Zippes fra INNSIDEN av dist/, slik at `index.html` ligger i roten av
     arkivet. Pluginen leter riktignok rekursivt etter den (lest i
     `LiveUpdate.java`), men et arkiv med en ekstra toppmappe ville gjort
     bundelen avhengig av den letingen. */
  const zip = spawnSync('zip', ['-r', '-q', '-X', zipPath, '.'], { cwd: distDir, encoding: 'utf8' });
  if (zip.error && zip.error.code === 'ENOENT') throw new Error('`zip` mangler på maskinen');
  if (zip.status !== 0) throw new Error('zip feilet (' + zip.status + '): ' + (zip.stderr || '').trim());

  // Etterprøving av arkivet, ikke av kommandoen: leter appen forgjeves etter
  // index.html, er bundelen ubrukelig — og det oppdages i så fall her.
  const liste = spawnSync('unzip', ['-Z1', zipPath], { encoding: 'utf8' });
  if (liste.status !== 0) throw new Error('Fikk ikke lest innholdslisten i ' + zipPath);
  const navn = liste.stdout.split('\n').map((l) => l.trim()).filter(Boolean);
  if (navn.indexOf('index.html') === -1) {
    throw new Error('ZIP-en har ingen index.html i roten (' + navn.length + ' oppføringer)');
  }

  const signature = signFile(zipPath, privateKeyPem);
  /* Nøkkelparet må HENGE SAMMEN. Den offentlige halvdelen er pakket inn i
     APK-en og kan ikke endres uten en ny butikkbinær; passer den ikke
     secreten, er bundelen uverifiserbar på hver eneste telefon. */
  if (!verifyFile(zipPath, signature, publicKeyPem)) {
    throw new Error(
      'Signaturen verifiserer ikke mot publicKey i capacitor.config.json. '
      + 'Secreten OTA_SIGNING_KEY og den innebygde nøkkelen er ikke to halvdeler av samme par.'
    );
  }

  const androidDir = path.join(outDir, 'android');
  fs.mkdirSync(androidDir, { recursive: true });
  const manifester = nivaaer.map((versjon) => {
    const manifest = buildManifest({
      releaseId: ids.releaseId,
      bundleId: ids.bundleId,
      versionCode: versjon,
      signature,
      commit: ids.commit || null,
      builtAt: ids.builtAt || null,
    });
    const fil = path.join(androidDir, versjon + '.json');
    fs.writeFileSync(fil, JSON.stringify(manifest, null, 2) + '\n');
    return { versionCode: versjon, path: fil, manifest };
  });

  return { zipPath, signature, levels: nivaaer, manifests: manifester, bytes: fs.statSync(zipPath).size };
}

/* ---- main(): henter konfigurasjonen fra disk og miljø ---- */
function main() {
  const distDir = path.join(ROOT, 'dist');
  const outDir = path.join(ROOT, 'ota');

  const privateKeyPem = process.env.OTA_SIGNING_KEY;
  if (!privateKeyPem) {
    throw new Error('Mangler OTA_SIGNING_KEY (privat RSA-nøkkel, PKCS#8 PEM) i miljøet');
  }
  const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'capacitor.config.json'), 'utf8'));
  const publicKeyPem = ((cfg.plugins || {}).LiveUpdate || {}).publicKey;
  if (!publicKeyPem) {
    throw new Error('capacitor.config.json har ingen LiveUpdate.publicKey — uten den kan ingen telefon verifisere bundelen');
  }

  const versionCode = readVersionCode(fs.readFileSync(path.join(ROOT, 'android', 'app', 'build.gradle'), 'utf8'));
  const minVersionCode = process.env.OTA_MIN_VERSION_CODE
    ? Number(process.env.OTA_MIN_VERSION_CODE)
    : versionCode;

  const ids = idsFromVersion(JSON.parse(fs.readFileSync(path.join(distDir, 'version.json'), 'utf8')));

  const res = publishBundle({
    distDir, outDir, privateKeyPem, publicKeyPem, ids, versionCode, minVersionCode,
  });

  console.log('✅ OTA-bundle ' + ids.bundleId + ' — release ' + ids.releaseId
    + ' (' + Math.round(res.bytes / 1024) + ' kB, signatur verifisert mot den innebygde publicKey)');
  console.log('   ' + bundleUrl(ids.bundleId));
  console.log('   manifest for versionCode ' + res.levels.join(', ') + ' → '
    + res.manifests.map((m) => 'ota/android/' + m.versionCode + '.json').join(', '));
}

if (require.main === module) {
  try {
    main();
  } catch (e) {
    console.error('::error::OTA-bundelen ble ikke publisert: ' + e.message);
    process.exit(1);
  }
}

module.exports = {
  BASE_URL, signFile, verifyFile, manifestLevels, readVersionCode, bundleUrl, buildManifest,
  idsFromVersion, publishBundle,
};
