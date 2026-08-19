/*
  Test for OTA-FLYTEN (fase 5 — docs/mobilapp-plan.md): manifestet leses på
  URL-en det native nivået bestemmer, valideres ved systemgrensen, en annen
  release lastes ned med downloadBundle() og stilles opp med setNextBundle() —
  etter at karantenen har sagt ja. Kildeform og gating låses i
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
    8. En bundle som ALT ligger i pluginens lager (andre kaldstart) skilles
       fra en ekte feil: pluginen avviser den med ERROR_BUNDLE_EXISTS, og
       den skal ikke kunne leses som en avvist signatur — og den regnes som
       KLARGJORT: oppstillingen skjer også da.
    9. Ett manifest-oppslag per oppstart, og ingen andre metoder enn de seks
       kjente kalles på broen.
   10. Oppstillingen: setNextBundle() kalles med nøyaktig bundleId-en fra
       manifestet, og FØRST etter at karantenen er spurt.
   11. Karantenen avviser: en bundleId i pluginens blokkliste ELLER i
       klientens egen liste stilles ikke opp — og en liste som ikke kan leses
       (fra broen eller fra localStorage) er også et nei (fail closed).
   12. En feilet oppstilling er stille, og etterlater ingenting stilt opp.
   13. Stoppeklokken mot `readyTimeout`: `readyMs.disarmedAt` er tidspunktet
       `ready()` RESOLVERTE, ikke tidspunktet skjermen ble malt — og den er
       `null` uten en plugin å spørre.

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
  versionCode: 3,
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
    window.__otaBro = { kall: [], download: [], stage: [] };
    /* Klientens EGEN karanteneliste, som app.js leser før oppstillingen.
       ?quar=<id> seeder den; ?quar=corrupt legger inn noe som ikke lar seg
       lese; ?quar=throw gjør selve lesningen umulig. De to siste er
       fail closed-tilfellene: en liste vi ikke kan stole på er ikke en tom
       liste. */
    const QK = 'huskis:ota-blocked';
    const q0 = q.get('quar');
    if (q0 === 'corrupt') {
      localStorage.setItem(QK, '{ikke en liste');
    } else if (q0 === 'throw') {
      const ekte = Storage.prototype.getItem;
      Storage.prototype.getItem = function (k) {
        if (k === QK) throw new Error('storage blocked (test)');
        return ekte.call(this, k);
      };
    } else if (q0) {
      localStorage.setItem(QK, JSON.stringify([q0]));
    } else {
      localStorage.removeItem(QK);   // localStorage overlever navigasjon
    }
    window.Capacitor = {
      isNativePlatform: () => true,
      Plugins: {
        LiveUpdate: {
          // ?ready=slow gjør avvæpningen målbart treg, slik at stoppeklokken
          // kan vise at `disarmedAt` er broens svar og ikke malingstidspunktet.
          ready: async () => {
            window.__otaBro.kall.push('ready');
            if (q.get('ready') === 'slow') await new Promise((r) => setTimeout(r, 250));
            return {};
          },
          getVersionCode: async () => { window.__otaBro.kall.push('getVersionCode'); return { versionCode: '3' }; },
          downloadBundle: async (opts) => {
            window.__otaBro.kall.push('downloadBundle');
            window.__otaBro.download.push(opts);
            if (q.get('dl') === 'fail') throw new Error('signature verification failed (test)');
            // Pluginens egen melding, ordrett fra LiveUpdatePlugin.java
            // (ERROR_BUNDLE_EXISTS) — den kaster denne når bundleId alt
            // ligger i lageret, altså ved hver kaldstart etter den første.
            if (q.get('dl') === 'exists') throw new Error('bundle already exists.');
            return {};
          },
          // ?blocked=<id> legger den id-en i pluginens blokkliste;
          // ?blocked=err får oppslaget til å kaste (fail closed-tilfellet).
          getBlockedBundles: async () => {
            window.__otaBro.kall.push('getBlockedBundles');
            const b = q.get('blocked');
            if (b === 'err') throw new Error('blocklist unavailable (test)');
            return { bundleIds: b ? [b] : [] };
          },
          setNextBundle: async (opts) => {
            window.__otaBro.kall.push('setNextBundle');
            window.__otaBro.stage.push(opts);
            if (q.get('set') === 'fail') throw new Error('bundle not found (test)');
            return {};
          },
          reload: async () => { window.__otaBro.kall.push('reload'); return {}; },
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

  /* Flyten er ferdig når hentingen har stoppet OG oppstillingen har tatt
     stilling — ellers ville en sjekk kunne lese en halvferdig klargjøring. */
  const ferdig = () => page.waitForFunction(() => {
    const H = window.__huskis;
    if (!H) return false;
    if (H.otaStage.state !== 'idle') return true;   // oppstillingen har tatt stilling
    return ['no-manifest', 'same-release', 'download-failed'].indexOf(H.otaFetch.state) > -1;
  }, null, { timeout: 10000, polling: 200 });
  const tilstand = () => page.evaluate(() => window.__huskis.otaFetch);
  const oppstilling = () => page.evaluate(() => window.__huskis.otaStage);
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
    manifestTreff.length === 1 && manifestTreff[0] === '/ota/android/3.json', manifestTreff);
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
    ['versionCode er ikke nivået det ble bedt om', { status: 200, body: JSON.stringify(Object.assign(gyldigManifest(), { versionCode: 4 })) }],
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
  const KJENTE = ['ready', 'getVersionCode', 'downloadBundle', 'getBlockedBundles', 'setNextBundle', 'reload'];
  check('ingen andre metoder enn de seks kjente på broen',
    b.kall.every((k) => KJENTE.indexOf(k) > -1), b.kall);
  check('fortsatt ETT manifest-oppslag denne oppstarten', manifestTreff.length === 1, manifestTreff);
  /* Oppstillingen: karantenen spørres FØRST, og setNextBundle får nøyaktig
     manifestets bundleId. Rekkefølgen er hele vakten — `setNextBundle()`
     konsulterer aldri blokklisten selv (LiveUpdate.java 8.4.0). */
  check("oppstilt: setNextBundle kalt én gang med manifestets bundleId ('staged')",
    (await oppstilling()).state === 'staged' && b.stage.length === 1
      && Object.keys(b.stage[0]).join(',') === 'bundleId' && b.stage[0].bundleId === BUNDLE,
    { stage: b.stage, otaStage: await oppstilling() });
  check('karantenen ble spurt FØR oppstillingen',
    b.kall.indexOf('getBlockedBundles') > -1
      && b.kall.indexOf('getBlockedBundles') < b.kall.indexOf('setNextBundle'), b.kall);
  check('ingenting byttes av seg selv: reload() kalles ikke ved oppstart',
    b.kall.indexOf('reload') === -1, b.kall);
  /* Banneret hører til update-check.js, og motoren starter ikke uten en ekte
     build-ID (meta-taggen står på «dev» i kildekoden). Oppstillingen alene
     viser altså ingenting — den virker ved neste kaldstart. */
  check('oppstillingen viser intet banner av seg selv', !(await banner()));

  /* ---------- 7) Avvist nedlasting (f.eks. signaturfeil) er stille ---------- */
  manifestTreff = [];
  manifestSvar = { status: 200, body: JSON.stringify(gyldigManifest()) };
  await page.goto(BASE + '/?mock=1&cap=1&dl=fail');
  await ferdig();
  check("avvist downloadBundle: stille, med feilen i otaFetch ('download-failed')",
    (await tilstand()).state === 'download-failed' && /signature/.test((await tilstand()).detail || ''),
    await tilstand());
  check('avvist nedlasting: intet banner', !(await banner()));

  /* ---------- 8) Andre kaldstart: bundelen ligger alt i lageret ----------
     Pluginen avviser en `bundleId` den allerede har (`ERROR_BUNDLE_EXISTS`,
     lest i LiveUpdate.java), og det treffer HVER kaldstart etter den første
     vellykkede nedlastingen. Det er ikke en feil, og det skal ikke kunne
     leses som en avvist SIGNATUR: `otaFetch` er enhetsøktens instrument, og
     de to utfallene fører til helt ulike konklusjoner om telefonen
     (docs/mobilapp-plan.md, «Hva som krever en enhetsøkt»). */
  manifestTreff = [];
  manifestSvar = { status: 200, body: JSON.stringify(gyldigManifest()) };
  await page.goto(BASE + '/?mock=1&cap=1&dl=exists');
  await ferdig();
  const b8 = await bro();
  check("allerede nedlastet bundle skilles fra en ekte feil ('already-downloaded')",
    (await tilstand()).state === 'already-downloaded', await tilstand());
  /* Og den er KLARGJORT. Gjorde oppstillingen seg avhengig av at et FERSKT
     downloadBundle() lyktes, ville en app som lastet ned i går aldri kommet
     videre i dag — pluginen avviser den samme bundleId-en hver kaldstart. */
  check('…og den stilles likevel opp: «klargjort» dekker begge veier',
    (await oppstilling()).state === 'staged' && b8.stage.length === 1 && b8.stage[0].bundleId === BUNDLE,
    { stage: b8.stage, otaStage: await oppstilling() });
  check('…og fortsatt intet banner', !(await banner()));

  /* ---------- 9) En avvist nedlasting stiller ingenting opp ---------- */
  {
    manifestSvar = { status: 200, body: JSON.stringify(gyldigManifest()) };
    await page.goto(BASE + '/?mock=1&cap=1&dl=fail');
    await ferdig();
    const bf = await bro();
    check('avvist nedlasting: ingenting stilt opp', (await oppstilling()).state === 'idle' && bf.stage.length === 0,
      { stage: bf.stage, otaStage: await oppstilling() });
  }

  /* ---------- 10) Karantene: en blokkert bundleId stilles ikke opp ----------
     `readyTimeout` gjenoppretter den innebygde bundelen, men hindrer ikke at
     NESTE kaldstart stiller opp nøyaktig den samme bundleId-en på nytt —
     `setNextBundle()` spør aldri blokklisten selv (docs/mobilapp-plan.md, «En
     rullet-tilbake bundle må være varig sperret»). */
  manifestTreff = [];
  manifestSvar = { status: 200, body: JSON.stringify(gyldigManifest()) };
  await page.goto(BASE + '/?mock=1&cap=1&blocked=' + BUNDLE);
  await ferdig();
  const bb = await bro();
  check("blokkert bundle: ingen oppstilling ('blocked')",
    (await oppstilling()).state === 'blocked' && bb.stage.length === 0,
    { stage: bb.stage, otaStage: await oppstilling() });
  check('blokkert bundle: den lastes ikke engang ned',
    bb.download.length === 0, bb.download);

  /* Klientens EGEN liste sperrer like godt — og den er den som dekker det ene
     tilfellet pluginens ikke kan (docs/mobilapp-plan.md, «En rullet-tilbake
     bundle må være varig sperret»). */
  manifestSvar = { status: 200, body: JSON.stringify(gyldigManifest()) };
  await page.goto(BASE + '/?mock=1&cap=1&quar=' + BUNDLE);
  await ferdig();
  const bq = await bro();
  check('bundle i klientens egen karantene: ingen oppstilling, ingen nedlasting',
    (await oppstilling()).state === 'blocked' && bq.stage.length === 0 && bq.download.length === 0,
    { otaStage: await oppstilling(), download: bq.download });

  /* Fail closed på VÅR side også: en karanteneliste som ikke lar seg lese er
     ikke det samme som en tom liste. Uten dette ville en blokkert lagring
     stilltiende slått av hele vakten. */
  for (const [navn, verdi] of [['ødelagt innhold', 'corrupt'], ['lagringen kaster', 'throw']]) {
    manifestSvar = { status: 200, body: JSON.stringify(gyldigManifest()) };
    await page.goto(BASE + '/?mock=1&cap=1&quar=' + verdi);
    await ferdig();
    const bu = await bro();
    check('uleselig karanteneliste (' + navn + '): fail closed, ingen oppstilling',
      (await oppstilling()).state === 'blocked' && bu.stage.length === 0 && bu.download.length === 0,
      { otaStage: await oppstilling(), otaBlocked: await page.evaluate(() => window.__huskis.otaBlocked) });
  }

  /* Fail closed: en blokkliste som ikke kan leses er også et nei. Kan vi ikke
     vite om målet er sperret, stiller vi ingenting opp. */
  manifestSvar = { status: 200, body: JSON.stringify(gyldigManifest()) };
  await page.goto(BASE + '/?mock=1&cap=1&blocked=err');
  await ferdig();
  const be = await bro();
  check('blokkliste som ikke kan leses: fail closed, ingen oppstilling',
    (await oppstilling()).state === 'blocked' && be.stage.length === 0 && be.download.length === 0,
    { stage: be.stage, download: be.download, otaStage: await oppstilling() });

  /* ---------- 11) En feilet oppstilling er stille ---------- */
  manifestSvar = { status: 200, body: JSON.stringify(gyldigManifest()) };
  await page.goto(BASE + '/?mock=1&cap=1&set=fail');
  await ferdig();
  const bs = await bro();
  check("feilet setNextBundle: stille, med feilen i otaStage ('stage-failed')",
    (await oppstilling()).state === 'stage-failed' && bs.kall.indexOf('reload') === -1,
    await oppstilling());
  check('feilet oppstilling: intet banner', !(await banner()));

  /* ---------- 12) Stoppeklokken mot readyTimeout ----------
     Enhetsøkten skal kunne si om avvæpningen kom godt innenfor de 10 000 ms
     pluginen gir, og `appReady` alene kan ikke svare på det: den blir `true`
     også når timeren rakk å utløse først (docs/mobilapp-plan.md, «Slik kjører
     du enhetsøkten»). Det som måles her er at de to tallene betyr det de
     heter — en treg bro skal flytte `disarmedAt`, ikke `reachedAt`. */
  {
    manifestSvar = { status: 404, body: '' };
    await page.goto(BASE + '/?mock=1&cap=1&ready=slow');
    await page.waitForFunction(() => {
      const r = window.__huskis && window.__huskis.readyMs;
      return !!r && r.disarmedAt != null;
    }, null, { timeout: 10000, polling: 100 });
    const t = await page.evaluate(() => window.__huskis.readyMs);
    check('stoppeklokken: begge tallene er ms fra navigasjonsstart',
      Number.isFinite(t.reachedAt) && Number.isFinite(t.disarmedAt) && t.reachedAt >= 0, t);
    check('stoppeklokken: en treg ready() flytter disarmedAt, ikke reachedAt',
      t.disarmedAt - t.reachedAt >= 200, t);
  }
  /* Uten en plugin å spørre finnes det ingen timer å avvæpne, og da skal
     tallet være `null` — ikke et malingstidspunkt som utgir seg for å være en
     avvæpning. */
  {
    await page.goto(BASE + '/?mock=1');
    await page.waitForFunction(() => {
      const r = window.__huskis && window.__huskis.readyMs;
      return !!r && r.reachedAt != null;
    }, null, { timeout: 10000, polling: 100 });
    const t = await page.evaluate(() => window.__huskis.readyMs);
    check('nettleser: reachedAt måles, disarmedAt er null (ingen timer å avvæpne)',
      Number.isFinite(t.reachedAt) && t.disarmedAt === null, t);
  }

  check('ingen ukontrollerte JS-feil i noen av scenarioene', pageErrors.length === 0, pageErrors);

  await browser.close();
  console.log(`\n==== ${passed}/${passed + failed} PASS ====`);
  process.exit(failed ? 1 : 0);
})();
