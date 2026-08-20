#!/usr/bin/env node
/* ============================================================
   MÅLERIGGEN: en bevisst ødelagt OTA-bundle, uten at produksjonen er involvert
   (fase 5, `docs/mobilapp-plan.md`, «Den ødelagte bundelen kan ikke være en
   produksjonsrelease»).

   To av punktene enhetsøkten skal måle — at en dårlig bundle RULLES TILBAKE,
   og at den deretter havner i KARANTENEN — krever en bundle som aldri når
   readiness-punktet. Produksjonsbundelen kan aldri være den: `release.yml`
   pakker nøyaktig den `dist/`-en som deployes til huskis.no, så en ødelagt
   bundle der ville vært en ødelagt nettside for alle.

   Riggen løser det ved å bygge et EGET skall som ikke kan nå produksjon i det
   hele tatt. Nøyaktig fem konstanter skiller det fra produksjonsskallet, og
   fire av dem er det samme svaret på ett spørsmål — hvilken adresse skallet
   hører hjemme på:

     1. `config.js`            → `canonicalAppUrl` peker på riggens vert
     2. `index.html`           → CSP-ens `connect-src` slipper riggens vert
                                 INN og produksjonsverten UT
     3. `index.html`           → `CANONICAL_ORIGIN` i origin-vakten
     4. `app.js`               → reserveverdien i `canonicalAppUrl()`, den
                                 `config.js` overstyrer
     5. `capacitor.config.json`→ `LiveUpdate.publicKey` er riggens egen nøkkel

   Punkt 3 og 4 er inerte i selve målingen — origin-vakten treffer bare på de
   navngitte produksjonshostene, og reserveverdien leses aldri når `config.js`
   er satt — men de MÅ likevel byttes: `tests/capacitor-android.test.js` regner
   enhver absolutt adresse utenom Supabase og `canonicalAppUrl` som fremmed, og
   den testen er et byggesteg i «Android debug-APK». Uten dem kan riggskallets
   APK ikke bygges i det hele tatt.

   Ingen av de fem leses av rollback-timeren, pluginens blokkliste eller
   klientens egen karantene — den koden er byte for byte produksjonens. Det er
   derfor målingen kan overføres, og `tests/ota-rig.test.js` måler at patchen
   ikke rører noe annet enn de fem.

   Det riggen IKKE kan svare på, og som må leses av det EKTE skallet i den
   samme økten: at telefonen godtar PRODUKSJONSSIGNATUREN, og at manifestet kan
   leses fra huskis.no (CSP + CORS). Riggen signerer med sin egen nøkkel og
   leser fra sin egen vert — begge deler ville vært et selvbevis.

   RIGGGRENEN SKAL ALDRI MERGES. Den bærer et skall som peker bort fra
   produksjon og en `ota/`-mappe med en ødelagt bundle; `tests/ota-rig.test.js`
   og `tests/canonical-origin.test.js` feiler med vilje på den.

   Kjør (fra riggrenen, etter `node build.js`):
     node .github/scripts/ota-rig.js --host https://huskis-git-<gren>-<team>.vercel.app

   Flagg:
     --host <url>   riggens vert (grenens egen Vercel-preview). Påkrevd.
     --id <navn>    bundleId. Standard: neste ledige `rig-broken-<n>`.
                    HVER måling trenger et nytt navn — en bundle som er hentet
                    én gang avvises som «already exists», og en som er rullet
                    tilbake er sperret for alltid.
     --mode throw   (standard) hele `dist/`, men `app.js` byttet mot et skript
                    som maler en riggmelding og kaster. Bundelen laster fint og
                    feiler i initen — tilfellet planen kaller «laster scriptene
                    fint, men feiler FØR skjermen er brukbar».
     --mode blank   en `index.html` alene, uten skript. Tilfellet «når aldri
                    `ready()`» i sin enkleste form.
     --dist <dir>   web-builden bundelen lages av (standard `dist`).
     --out <dir>    hvor `bundles/` og `android/` skrives (standard `ota`).
     --keys <dir>   riggens nøkkelpar (standard `.ota-rig`, gitignorert).
                    Lages første gang, gjenbrukes etterpå — bytter nøkkelen,
                    må APK-en bygges på nytt.
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const ota = require('./ota-bundle.js');

/* Produksjonsverten riggen aldri får være. Den står i `config.js`, og leses
   derfra, slik at riggen ikke kan bli stående på en gammel kopi av navnet. */
function readCanonical(configJsText) {
  const m = configJsText.match(/canonicalAppUrl:\s*'([^']+)'/);
  if (!m) throw new Error('Fant ingen canonicalAppUrl i config.js');
  return m[1].replace(/\/+$/, '');
}

/* ---- De fem patchene. Rene tekst-inn/tekst-ut, slik at testen kan kjøre dem
   over de EKTE filene uten å røre treet. ---- */

function patchConfigJs(text, host) {
  const ut = text.replace(/(canonicalAppUrl:\s*')([^']+)(')/, '$1' + host + '$3');
  if (ut === text) throw new Error('config.js: canonicalAppUrl ble ikke byttet');
  return ut;
}

/* Verten BYTTES i `connect-src`, den legges ikke til: et riggskall som fortsatt
   kunne nå huskis.no ville kunne hente produksjonsmanifestet og stille opp en
   bundle det ikke har nøkkelen til — en stille `download-failed` midt i en
   måling som handler om noe helt annet. */
function patchCsp(html, gammelVert, nyVert) {
  const linje = html.match(/^.*connect-src[^\n]*$/m);
  if (!linje) throw new Error('index.html: fant ingen connect-src i CSP-en');
  if (linje[0].indexOf(gammelVert) === -1) {
    throw new Error('index.html: connect-src nevner ikke ' + gammelVert);
  }
  return html.replace(linje[0], linje[0].split(gammelVert).join(nyVert));
}

/* Origin-vakten i `index.html` navngir produksjonsadressen som det stedet en
   fane på et pensjonert domene skal sendes hjem til. Den treffer bare på de
   hostene den selv lister, så i APK-en (`https://localhost`) gjør den
   ingenting — men adressen STÅR der, og skanningen i
   `tests/capacitor-android.test.js` leser den. */
function patchCanonicalOrigin(html, gammelVert, nyVert) {
  const re = /(var CANONICAL_ORIGIN = ')([^']+)(')/;
  const m = html.match(re);
  if (!m) throw new Error('index.html: fant ingen CANONICAL_ORIGIN i origin-vakten');
  if (m[2].replace(/\/+$/, '') !== gammelVert) {
    throw new Error('index.html: CANONICAL_ORIGIN er ikke ' + gammelVert);
  }
  return html.replace(re, '$1' + nyVert + '$3');
}

/* Reserveverdien i `canonicalAppUrl()`: den leses bare når `config.js` mangler
   feltet, og riggen setter nettopp det feltet. Linjen byttes likevel, av samme
   grunn som CANONICAL_ORIGIN. Det er den ENESTE linjen riggen rører i `app.js`
   — rollback-timeren, blokklisten og karantenen står urørt. */
function patchAppFallback(text, gammelVert, nyVert) {
  const re = /(window\.HUSKIS_CONFIG\.canonicalAppUrl\) \|\| ')([^']+)(')/;
  const m = text.match(re);
  if (!m) throw new Error('app.js: fant ingen reserveverdi i canonicalAppUrl()');
  if (m[2].replace(/\/+$/, '') !== gammelVert) {
    throw new Error('app.js: reserveverdien er ikke ' + gammelVert);
  }
  return text.replace(re, '$1' + nyVert + '$3');
}

/* Nøkkelen er det eneste som endres i konfigurasjonen — samme fil, samme
   formatering (JSON med to mellomrom, som den står i repoet). */
function patchCapConfig(jsonText, publicKeyPem) {
  const cfg = JSON.parse(jsonText);
  if (!cfg.plugins || !cfg.plugins.LiveUpdate) {
    throw new Error('capacitor.config.json: ingen LiveUpdate-blokk');
  }
  cfg.plugins.LiveUpdate.publicKey = publicKeyPem;
  return JSON.stringify(cfg, null, 2) + '\n';
}

/* ---- Den ødelagte bundelen ---- */

/* `app.js` byttes mot dette. Det maler en umiskjennelig melding — riggen skal
   kunne kjennes igjen på skjermen mens rollback-timeren teller — og kaster
   deretter. Ingenting her kaller `LiveUpdate.ready()`, og det er hele poenget:
   readiness-punktet nås aldri, så pluginen ruller tilbake etter `readyTimeout`.
   Ingen inline stil (CSP-en tillater den ikke); teksten alene holder. */
function brokenAppJs(bundleId) {
  return [
    "/* MÅLERIGG — bevisst ødelagt bundle (" + bundleId + ").",
    "   Erstatter app.js i riggbundelen. Readiness-punktet nås aldri — ingenting",
    "   her avvæpner pluginen, så rollback-timeren utløser etter readyTimeout.",
    "   docs/mobilapp-plan.md, «Den ødelagte bundelen kan ikke være en",
    "   produksjonsrelease». */",
    "'use strict';",
    "document.title = 'RIGG — ødelagt bundle';",
    "document.addEventListener('DOMContentLoaded', function () {",
    "  var p = document.createElement('p');",
    "  p.textContent = 'MÅLERIGG: bevisst ødelagt bundle " + bundleId
      + " — skal rulles tilbake av readyTimeout.';",
    "  document.body.prepend(p);",
    "});",
    "throw new Error('rigg: bevisst ødelagt bundle " + bundleId + "');",
    '',
  ].join('\n');
}

function blankIndexHtml(bundleId) {
  return [
    '<!doctype html>',
    '<html lang="no"><head><meta charset="utf-8" />',
    '<title>RIGG — ødelagt bundle</title></head>',
    '<body><p>MÅLERIGG: bevisst ødelagt bundle ' + bundleId + '.',
    'Ingen skript, ingen readiness — skal rulles tilbake av readyTimeout.</p>',
    '</body></html>',
    '',
  ].join('\n');
}

/* Kopierer web-builden inn i riggmappen. `ota/` hoppes over: `build.js`
   kopierer den inn i `dist/`, og uten unntaket ville hver rigg-runde pakket
   forrige rundes ZIP inn i den neste. */
function copyDist(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const navn of fs.readdirSync(from)) {
    if (navn === 'ota') continue;
    const src = path.join(from, navn);
    const dst = path.join(to, navn);
    if (fs.statSync(src).isDirectory()) copyDist(src, dst);
    else fs.copyFileSync(src, dst);
  }
}

function buildBrokenTree(distDir, treeDir, mode, bundleId) {
  fs.rmSync(treeDir, { recursive: true, force: true });
  fs.mkdirSync(treeDir, { recursive: true });
  if (mode === 'blank') {
    fs.writeFileSync(path.join(treeDir, 'index.html'), blankIndexHtml(bundleId));
    return;
  }
  if (!fs.existsSync(path.join(distDir, 'index.html'))) {
    throw new Error('Fant ingen index.html i ' + distDir + ' — er `node build.js` kjørt?');
  }
  copyDist(distDir, treeDir);
  fs.writeFileSync(path.join(treeDir, 'app.js'), brokenAppJs(bundleId));
}

/* Samme form som manifestet `release.yml` skriver (`buildManifest()` i
   ota-bundle.js) — feltene MÅ være de samme, for klienten validerer hele
   formen ved systemgrensen (`validOtaManifest()` i app.js) og forkaster alt
   som ikke stemmer. Det eneste riggen endrer er hvor `url` peker og hvilken
   release den navngir. */
function rigManifest(felt) {
  return {
    releaseId: felt.releaseId,
    bundleId: felt.bundleId,
    versionCode: felt.versionCode,
    url: felt.host + '/ota/bundles/' + felt.bundleId + '.zip',
    signature: felt.signature,
    commit: null,
    builtAt: null,
  };
}

/* Neste ledige riggnavn. Hver måling trenger sitt eget: pluginen avviser en
   `bundleId` den alt har lastet ned, og en rullet-tilbake `bundleId` er sperret
   for alltid i begge karantenelagene. */
function nextRigId(bundlesDir) {
  let n = 0;
  if (fs.existsSync(bundlesDir)) {
    for (const navn of fs.readdirSync(bundlesDir)) {
      const m = navn.match(/^rig-broken-(\d+)\.zip$/);
      if (m) n = Math.max(n, Number(m[1]));
    }
  }
  return 'rig-broken-' + (n + 1);
}

/* ---- Nøkkelparet ----
   Riggens egen halvdel av kontrakten. Den lages her og bor i en gitignorert
   mappe: produksjonsnøkkelen ligger i en Actions-secret og skal aldri brukes
   til å signere noe vi VET er ødelagt. */
function rigKeys(keysDir) {
  const priv = path.join(keysDir, 'rig-private.pem');
  const pub = path.join(keysDir, 'rig-public.pem');
  if (fs.existsSync(priv) && fs.existsSync(pub)) {
    return { privateKey: fs.readFileSync(priv, 'utf8'), publicKey: fs.readFileSync(pub, 'utf8'), ny: false };
  }
  const par = crypto.generateKeyPairSync('rsa', {
    modulusLength: 4096,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  fs.mkdirSync(keysDir, { recursive: true });
  fs.writeFileSync(priv, par.privateKey, { mode: 0o600 });
  fs.writeFileSync(pub, par.publicKey);
  return { privateKey: par.privateKey, publicKey: par.publicKey, ny: true };
}

/* ---- Selve jobben ---- */
function buildRig(opt) {
  const { host, bundleId, mode, versionCode, privateKeyPem, publicKeyPem } = opt;
  const distDir = path.resolve(opt.distDir);
  const outDir = path.resolve(opt.outDir);
  const bundlesDir = path.join(outDir, 'bundles');
  const androidDir = path.join(outDir, 'android');
  fs.mkdirSync(bundlesDir, { recursive: true });
  fs.mkdirSync(androidDir, { recursive: true });

  const treeDir = path.join(outDir, '.rig-tree');
  buildBrokenTree(distDir, treeDir, mode, bundleId);

  const zipPath = path.join(bundlesDir, bundleId + '.zip');
  fs.rmSync(zipPath, { force: true });
  const zip = spawnSync('zip', ['-r', '-q', '-X', zipPath, '.'], { cwd: treeDir, encoding: 'utf8' });
  if (zip.error && zip.error.code === 'ENOENT') throw new Error('`zip` mangler på maskinen');
  if (zip.status !== 0) throw new Error('zip feilet (' + zip.status + '): ' + (zip.stderr || '').trim());
  fs.rmSync(treeDir, { recursive: true, force: true });

  // Samme etterprøving som produksjonsbundelen: uten index.html i roten er
  // bundelen ubrukelig, og da måler riggen noe annet enn den tror.
  const liste = spawnSync('unzip', ['-Z1', zipPath], { encoding: 'utf8' });
  if (liste.status !== 0) throw new Error('Fikk ikke lest innholdslisten i ' + zipPath);
  if (liste.stdout.split('\n').map((l) => l.trim()).indexOf('index.html') === -1) {
    throw new Error('ZIP-en har ingen index.html i roten');
  }

  const signature = ota.signFile(zipPath, privateKeyPem);
  if (!ota.verifyFile(zipPath, signature, publicKeyPem)) {
    throw new Error('Riggsignaturen verifiserer ikke mot riggens egen publicKey');
  }

  /* `releaseId` er riggens egen, og er bevisst det samme navnet som bundelen:
     den finnes bare for å være FORSKJELLIG fra APK-ens egen release, ellers
     svarer klienten `same-release` og ingenting skjer. Den kan heller ikke
     forveksles med en ekte release — en ekte `releaseId` er tolv hex-tegn. */
  const manifest = rigManifest({
    releaseId: bundleId, bundleId, versionCode, host, signature,
  });
  const manifestPath = path.join(androidDir, versionCode + '.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  return { zipPath, manifestPath, manifest, bytes: fs.statSync(zipPath).size };
}

/* ---- main(): flagg, vakter og oppskriften ---- */
function parseArgs(argv) {
  const ut = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!/^--/.test(argv[i])) throw new Error('Ukjent argument: ' + argv[i]);
    ut[argv[i].slice(2)] = argv[i + 1];
  }
  return ut;
}

function gjeldendeGren() {
  const r = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: ROOT, encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : '';
}

function main() {
  const arg = parseArgs(process.argv.slice(2));
  const mode = arg.mode || 'throw';
  if (mode !== 'throw' && mode !== 'blank') throw new Error('--mode må være throw eller blank');

  /* Vakt 1: aldri på main. Patchen peker skallet bort fra produksjon, og en
     `ota/` med en ødelagt bundle i treet skal aldri kunne følge en merge. */
  const gren = gjeldendeGren();
  if (gren === 'main') throw new Error('Riggen skal aldri bygges på main — lag en riggren først');

  const configPath = path.join(ROOT, 'config.js');
  const indexPath = path.join(ROOT, 'index.html');
  const capPath = path.join(ROOT, 'capacitor.config.json');
  const gammelVert = readCanonical(fs.readFileSync(configPath, 'utf8'));

  const host = (arg.host || '').replace(/\/+$/, '');
  if (!/^https:\/\/[^/]+$/.test(host)) throw new Error('--host må være en https-URL uten sti');
  /* Vakt 2: riggen kan ikke peke på produksjon. Da ville den ødelagte bundelen
     ligget på huskis.no, som er nøyaktig det den finnes for å unngå. Verten
     leses av `BASE_URL` i ota-bundle.js — den ene filen riggen aldri patcher,
     så vakten kan ikke bli sann fordi en tidligere runde flyttet `config.js`. */
  const produksjon = ota.BASE_URL.replace(/\/ota$/, '');
  if (host === produksjon) throw new Error('--host er produksjonsverten (' + produksjon + ')');

  const nokler = rigKeys(path.resolve(arg.keys || path.join(ROOT, '.ota-rig')));
  const versionCode = String(ota.readVersionCode(
    fs.readFileSync(path.join(ROOT, 'android', 'app', 'build.gradle'), 'utf8')));

  const outDir = path.resolve(arg.out || path.join(ROOT, 'ota'));
  const bundleId = arg.id || nextRigId(path.join(outDir, 'bundles'));
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(bundleId)) throw new Error('--id har tegn klienten avviser');

  // Skallet: de fem konstantene, idempotent (en ny bundle rører dem ikke).
  const appPath = path.join(ROOT, 'app.js');
  const patchet = [];
  if (gammelVert !== host) {
    let html = fs.readFileSync(indexPath, 'utf8');
    html = patchCsp(html, gammelVert, host);
    html = patchCanonicalOrigin(html, gammelVert, host);
    fs.writeFileSync(indexPath, html);
    fs.writeFileSync(configPath, patchConfigJs(fs.readFileSync(configPath, 'utf8'), host));
    fs.writeFileSync(appPath, patchAppFallback(fs.readFileSync(appPath, 'utf8'), gammelVert, host));
    patchet.push('config.js', 'index.html', 'app.js');
  }
  const capTekst = fs.readFileSync(capPath, 'utf8');
  const nyCap = patchCapConfig(capTekst, nokler.publicKey);
  if (nyCap !== capTekst) { fs.writeFileSync(capPath, nyCap); patchet.push('capacitor.config.json'); }

  const res = buildRig({
    host, bundleId, mode, versionCode, distDir: arg.dist || path.join(ROOT, 'dist'), outDir,
    privateKeyPem: nokler.privateKey, publicKeyPem: nokler.publicKey,
  });

  console.log('✅ Riggbundle ' + bundleId + ' (' + mode + ', ' + Math.round(res.bytes / 1024) + ' kB)');
  console.log('   ' + res.manifest.url);
  console.log('   manifest → ' + path.relative(ROOT, res.manifestPath)
    + ' (versionCode ' + versionCode + ', release ' + res.manifest.releaseId + ')');
  console.log('   skall: ' + (patchet.length ? patchet.join(', ') + ' patchet' : 'allerede patchet'));
  /* Rekkefølgen `node build.js` → rigg betyr at den FØRSTE riggbundelen pakkes
     av en dist/ som ble bygget før patchen, altså med produksjonens konstanter.
     Det endrer ingen måling — bundelen kaster før noe av den leses — men det
     skal ikke være en overraskelse for den som pakker ut ZIP-en. */
  if (mode === 'throw') {
    const distIndex = path.join(path.resolve(arg.dist || path.join(ROOT, 'dist')), 'index.html');
    const bygget = fs.existsSync(distIndex) ? fs.readFileSync(distIndex, 'utf8') : '';
    if (bygget.indexOf(host) === -1) {
      console.log('   merk: dist/ ble bygget FØR patchen, så riggbundelen bærer');
      console.log('   produksjonens konstanter. Uten betydning for målingen (den');
      console.log('   kaster først), men kjør `node build.js` og skriptet på nytt');
      console.log('   med et nytt --id om du vil ha en bundle lik skallet.');
    }
  }
  if (nokler.ny) console.log('   nøkkelpar laget — APK-en må bygges på nytt for at den skal gjelde');
  console.log('');
  console.log('   Neste: commit ota/ + de patchede filene, push riggrenen,');
  console.log('   la Vercel-previewen serveres fra ' + host + ',');
  console.log('   og bygg APK-en med workflowen «Android debug-APK» på DENNE grenen.');
  console.log('   Riggrenen skal aldri merges.');
}

if (require.main === module) {
  try {
    main();
  } catch (e) {
    console.error('::error::Riggen ble ikke bygget: ' + e.message);
    process.exit(1);
  }
}

module.exports = {
  readCanonical, patchConfigJs, patchCsp, patchCanonicalOrigin, patchAppFallback, patchCapConfig,
  brokenAppJs, blankIndexHtml, rigManifest, nextRigId, buildRig, rigKeys,
};
