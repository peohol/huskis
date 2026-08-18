/*
  Test for OTA-HENTINGEN (fase 5, «hente og verifisere» — docs/mobilapp-plan.md):
  manifestet leses på URL-en det native nivået bestemmer, valideres ved
  systemgrensen, og en annen release lastes ned med downloadBundle() — uten at
  noe stilles opp eller byttes. Kildeform og gating låses i
  tests/capacitor-android.test.js; her KJØRES flyten i ekte nettleser, med
  pluginbroen faket slik skallet injiserer den (samme mønster som
  tests/system-back.test.js) og manifest-URL-en rutet i Playwright.

  Verifiserer:
    1. Vanlig nettleser (ingen Capacitor): ingenting hentes, tilstanden står
       på 'idle' — flyten finnes ikke utenfor skallet.
    2. 404 (skallet er utenfor spennet manifestene skrives for) er et STILLE
       no-op: ingen nedlasting, intet banner, ingen JS-feil. Og URL-en som ble
       spurt er nøyaktig ota/android/<getVersionCode()>.json på det kanoniske
       originet — vakten ER URL-en.
    3. Nettverksfeil er det samme stille no-op-et.
    4. Manifest som ikke består valideringen ved systemgrensen — ikke-JSON,
       url utenfor det kanoniske originet, versionCode som ikke er nivået det
       ble bedt om — gir ingen nedlasting.
    5. Samme releaseId som klientens egen (===): ingen nedlasting.
    6. En ANNEN releaseId: downloadBundle kalles nøyaktig én gang, med
       nøyaktig feltene url/bundleId/signature — ingen checksum — og verdiene
       fra manifestet. Fortsatt intet banner: ingenting byttes i denne runden.
    7. En avvist downloadBundle (f.eks. signaturfeil på enheten) er også
       stille; utfallet står i window.__huskis.otaFetch for enhetsøkten.
    8. Ett manifest-oppslag per oppstart, og ingen andre metoder enn
       ready/getVersionCode/downloadBundle kalles på broen.

  Ren logikk uten layout-avhengighet → én viewport.

  Kjør:
    python3 -m http.server 8000                    # fra repo-roten, i egen terminal
    NODE_PATH=$(npm root -g) node tests/ota-fetch.test.js
*/
'use strict';
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const BASE = process.env.HUSKIS_URL || 'http://localhost:8000';
const ROOT = path.join(__dirname, '..');

// Det kanoniske originet hentes fra config.js — samme ene kilde som appen
// bruker (canonicalAppUrl). Testen navngir ingen vert selv.
const cfgSrc = fs.readFileSync(path.join(ROOT, 'config.js'), 'utf8');
const KANONISK = new URL((/canonicalAppUrl:\s*'([^']+)'/.exec(cfgSrc) || [])[1]).origin;

// Klientens «egen» release og manifestets. Meta-taggen står på «dev» i
// kildekoden (den byttes av build.js), så dokument-ruten under stempler inn
// EGEN — uten den ville flyten korrekt gjort ingenting.
const EGEN = 'aaaa1111bbbb';
const ANNEN = 'cccc2222dddd';
const BUNDLE = ANNEN + '-t3st1';
const gyldigManifest = () => ({
  releaseId: ANNEN,
  bundleId: BUNDLE,
  versionCode: 2,
  url: KANONISK + '/ota/bundles/' + BUNDLE + '.zip',
  signature: 'dGVzdHNpZ25hdHVyZW4=',
  commit: ANNEN + '0000000000000000000000000000',
  builtAt: '2026-01-01T00:00:00.000Z',
});

let passed = 0, failed = 0;
function check(name, cond, extra) {
  if (cond) { passed++; console.log('PASS — ' + name); }
  else { failed++; console.log('  ✗ FAIL: ' + name + (extra !== undefined ? '  [' + JSON.stringify(extra) + ']' : '')); }
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));

  /* Pluginbroen, slik skallet injiserer den før sidens skript (jf.
     tests/system-back.test.js). ?cap=1 slår den på; ?dl=fail får
     downloadBundle til å avvise, som en telefon som underkjenner signaturen.
     Alle kall på broen føres i __otaBro, så testen ser både HVA som ble kalt
     og hva downloadBundle fikk. */
  await ctx.addInitScript(() => {
    const q = new URLSearchParams(location.search);
    if (q.get('cap') !== '1') return;
    window.__otaBro = { kall: [], download: [] };
    window.Capacitor = {
      isNativePlatform: () => true,
      Plugins: {
        LiveUpdate: {
          ready: async () => { window.__otaBro.kall.push('ready'); return {}; },
          getVersionCode: async () => { window.__otaBro.kall.push('getVersionCode'); return { versionCode: '2' }; },
          downloadBundle: async (opts) => {
            window.__otaBro.kall.push('downloadBundle');
            window.__otaBro.download.push(opts);
            if (q.get('dl') === 'fail') throw new Error('signature verification failed (test)');
            return {};
          },
        },
      },
    };
  });

  // Dokumentet: stemple inn en ekte releaseId der build.js ellers gjør det.
  await ctx.route((u) => u.origin === new URL(BASE).origin && u.pathname === '/', async (route) => {
    const res = await route.fetch();
    const body = (await res.text())
      .replace('<meta name="huskis-release" content="dev"', '<meta name="huskis-release" content="' + EGEN + '"');
    await route.fulfill({ response: res, body });
  });

  // Manifest-URL-en: hva den svarer styres per scenario. `abort` er
  // nettverksfeil; ellers svares det Vercel ville svart, inkludert
  // CORS-headeren produksjonen setter (vercel.json — uten den blokkeres
  // svaret av nettleseren, siden sidens origin er et annet enn det kanoniske).
  let manifestSvar = { status: 404, body: '' };
  let manifestTreff = [];
  await ctx.route((u) => u.href.indexOf(KANONISK + '/ota/') === 0, async (route) => {
    manifestTreff.push(new URL(route.request().url()).pathname);
    if (manifestSvar === 'abort') return route.abort('failed');
    return route.fulfill({
      status: manifestSvar.status,
      headers: { 'access-control-allow-origin': '*', 'content-type': manifestSvar.type || 'application/json' },
      body: manifestSvar.body,
    });
  });

  const ferdig = () => page.waitForFunction(() => {
    const H = window.__huskis;
    return H && ['no-manifest', 'same-release', 'downloaded', 'download-failed'].indexOf(H.otaFetch.state) > -1;
  }, null, { timeout: 10000, polling: 200 });
  const tilstand = () => page.evaluate(() => window.__huskis.otaFetch);
  const bro = () => page.evaluate(() => window.__otaBro);
  const banner = () => page.evaluate(() => !!document.getElementById('update-banner'));

  /* ---------- 1) Vanlig nettleser: flyten finnes ikke ---------- */
  await page.goto(BASE + '/?mock=1');
  // Fraværsbevis: at ingenting SKJER kan bare påstås etter at det ville
  // rukket å skje (jf. tests/CLAUDE.md om faste ventinger).
  await page.waitForTimeout(700);
  check('nettleser: ingen manifest-forespørsel', manifestTreff.length === 0, manifestTreff);
  check("nettleser: tilstanden står på 'idle'", (await tilstand()).state === 'idle', await tilstand());

  /* ---------- 2) 404: skallet er utenfor spennet ---------- */
  manifestTreff = [];
  manifestSvar = { status: 404, body: '' };
  await page.goto(BASE + '/?mock=1&cap=1');
  await ferdig();
  check('404: nøyaktig ETT oppslag, på ota/android/<versionCode>.json',
    manifestTreff.length === 1 && manifestTreff[0] === '/ota/android/2.json', manifestTreff);
  check("404: stille no-op ('no-manifest', ingen nedlasting)",
    (await tilstand()).state === 'no-manifest' && (await bro()).download.length === 0,
    await tilstand());
  check('404: intet banner', !(await banner()));

  /* ---------- 3) Nettverksfeil ---------- */
  manifestTreff = [];
  manifestSvar = 'abort';
  await page.goto(BASE + '/?mock=1&cap=1');
  await ferdig();
  check("nettverksfeil: stille no-op ('no-manifest', ingen nedlasting)",
    (await tilstand()).state === 'no-manifest' && (await bro()).download.length === 0,
    await tilstand());

  /* ---------- 4) Manifest som ikke består systemgrensen ---------- */
  const ugyldige = [
    ['ikke JSON (feilside fra en cache)', { status: 200, type: 'text/html', body: '<html>oops</html>' }],
    ['url utenfor det kanoniske originet', { status: 200, body: JSON.stringify(Object.assign(gyldigManifest(), { url: 'https://cdn.example.invalid/x.zip' })) }],
    ['versionCode er ikke nivået det ble bedt om', { status: 200, body: JSON.stringify(Object.assign(gyldigManifest(), { versionCode: 3 })) }],
  ];
  for (const [navn, svar] of ugyldige) {
    manifestTreff = [];
    manifestSvar = svar;
    await page.goto(BASE + '/?mock=1&cap=1');
    await ferdig();
    check('ugyldig manifest (' + navn + '): ingen nedlasting',
      (await tilstand()).state === 'no-manifest' && (await bro()).download.length === 0,
      await tilstand());
  }

  /* ---------- 5) Samme release: ingenting å hente ---------- */
  manifestTreff = [];
  manifestSvar = { status: 200, body: JSON.stringify(Object.assign(gyldigManifest(), { releaseId: EGEN })) };
  await page.goto(BASE + '/?mock=1&cap=1');
  await ferdig();
  check("samme releaseId (===): ingen nedlasting ('same-release')",
    (await tilstand()).state === 'same-release' && (await bro()).download.length === 0,
    await tilstand());

  /* ---------- 6) En annen release: hentes — og bare hentes ---------- */
  manifestTreff = [];
  manifestSvar = { status: 200, body: JSON.stringify(gyldigManifest()) };
  await page.goto(BASE + '/?mock=1&cap=1');
  await ferdig();
  const b = await bro();
  check("annen releaseId: downloadBundle kalt nøyaktig én gang ('downloaded')",
    (await tilstand()).state === 'downloaded' && b.download.length === 1, await tilstand());
  check('downloadBundle fikk nøyaktig url, bundleId og signature — ingen checksum',
    b.download.length === 1 && Object.keys(b.download[0]).sort().join(',') === 'bundleId,signature,url',
    b.download[0]);
  check('…og verdiene er manifestets',
    b.download.length === 1
      && b.download[0].url === gyldigManifest().url
      && b.download[0].bundleId === BUNDLE
      && b.download[0].signature === gyldigManifest().signature,
    b.download[0]);
  check('ingen andre metoder enn ready/getVersionCode/downloadBundle på broen',
    b.kall.every((k) => ['ready', 'getVersionCode', 'downloadBundle'].indexOf(k) > -1), b.kall);
  check('fortsatt ETT manifest-oppslag denne oppstarten', manifestTreff.length === 1, manifestTreff);
  check('nedlastingen viser intet banner — ingenting byttes i denne runden', !(await banner()));

  /* ---------- 7) Avvist nedlasting (f.eks. signaturfeil) er stille ---------- */
  manifestTreff = [];
  manifestSvar = { status: 200, body: JSON.stringify(gyldigManifest()) };
  await page.goto(BASE + '/?mock=1&cap=1&dl=fail');
  await ferdig();
  check("avvist downloadBundle: stille, med feilen i otaFetch ('download-failed')",
    (await tilstand()).state === 'download-failed' && /signature/.test((await tilstand()).detail || ''),
    await tilstand());
  check('avvist nedlasting: intet banner', !(await banner()));

  check('ingen ukontrollerte JS-feil i noen av scenarioene', pageErrors.length === 0, pageErrors);

  await browser.close();
  console.log(`\n==== ${passed}/${passed + failed} PASS ====`);
  process.exit(failed ? 1 : 0);
})();
