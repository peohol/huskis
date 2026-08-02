/*
  Nettlesertest for BETRODD APP-URL VED AUTH-REDIRECTS (config.js →
  window.HUSKIS_CONFIG, app.js → canonicalAppUrl()/authRedirectUrl()).

  Bakgrunn: en registrering ble sendt til det pensjonerte domenet
  huskekurv.vercel.app fordi klienten brukte `location.origin +
  location.pathname` som emailRedirectTo/redirectTo — en gammel fane, et
  utdatert domene eller en ukjent host ble dermed videreført ukritisk inn i
  selve auth-lenken. Se docs/domains-and-urls.md.

  Verifiserer:
    1. authRedirectUrl(origin) — den rene funksjonen — for hvert oppgitte
       origin i kravtabellen: det kanoniske domenet, de alternative domenene
       (www.huskis.no, huskis.vercel.app), det gamle domenet (negativt
       testtilfelle) og et vilkårlig ukjent origin gir ALLE
       https://huskis.no/; localhost/127.0.0.1 beholder sin egen origin
       (lokal utvikling).
    2. Trailing-slash-normalisering (med og uten avsluttende «/» inn).
    3. window.HUSKIS_CONFIG navngir KUN det kanoniske domenet — verken de
       alternative domenene (de 308-redirectes, se tests/canonical-origin.test.js)
       eller det gamle.
    4. Reell E2E-kobling: registrering (signUp), glemt passord
       (resetPasswordForEmail) og e-postendring (updateUser({ email }))
       sender FAKTISK authRedirectUrl() som emailRedirectTo/redirectTo — ikke
       bare at hjelpefunksjonen i isolasjon regner riktig.

  Ren logikk (ingen layout-avhengighet) → kjøres i én viewport, ikke
  desktop+mobil.

  Kjør:
    python3 -m http.server 8000
    NODE_PATH=$(npm root -g) node tests/auth-redirect.test.js
*/
const { chromium } = require('playwright');

const BASE = process.env.HUSKIS_URL || 'http://localhost:8000';

let passed = 0, failed = 0;
function check(name, cond, extra) {
  if (cond) { passed++; } else { failed++; console.log('  ✗ FAIL:', name, extra !== undefined ? JSON.stringify(extra) : ''); }
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));

  await page.goto(BASE + '/?mock=1');
  await page.waitForFunction(() => window.__huskis && typeof window.__huskis.authRedirectUrl === 'function');

  // ---------- 1) Kravtabellen: authRedirectUrl(origin) for oppgitte origins ----------
  const table = [
    ['https://huskis.no', 'https://huskis.no/'],
    ['https://www.huskis.no', 'https://huskis.no/'],
    ['https://huskis.vercel.app', 'https://huskis.no/'],
    ['https://huskekurv.vercel.app', 'https://huskis.no/'], // gammelt domene — negativt testtilfelle
    ['https://en-helt-ukjent-host.example', 'https://huskis.no/'],
    ['http://localhost:8000', 'http://localhost:8000/'],
    ['http://127.0.0.1:5500', 'http://127.0.0.1:5500/'],
  ];
  for (const [origin, expected] of table) {
    const got = await page.evaluate((o) => window.__huskis.authRedirectUrl(o), origin);
    check('authRedirectUrl(' + origin + ') === ' + expected, got === expected, got);
  }

  // ---------- 2) Trailing-slash-normalisering ----------
  const already = await page.evaluate(() => window.__huskis.authRedirectUrl('https://huskis.no/'));
  check('authRedirectUrl med avsluttende «/» dobler den ikke', already === 'https://huskis.no/', already);
  const localSlash = await page.evaluate(() => window.__huskis.authRedirectUrl('http://localhost:8000/'));
  check('localhost med avsluttende «/» dobler den ikke', localSlash === 'http://localhost:8000/', localSlash);
  const canon = await page.evaluate(() => window.__huskis.canonicalAppUrl());
  check('canonicalAppUrl() === https://huskis.no/', canon === 'https://huskis.no/', canon);

  // ---------- 3) window.HUSKIS_CONFIG ----------
  const cfg = await page.evaluate(() => window.HUSKIS_CONFIG);
  check('HUSKIS_CONFIG.canonicalAppUrl === https://huskis.no', cfg && cfg.canonicalAppUrl === 'https://huskis.no', cfg);
  check('HUSKIS_CONFIG navngir INGEN andre domener enn det kanoniske',
    !!cfg && !/www\.huskis\.no|vercel\.app|huskekurv/i.test(JSON.stringify(cfg)), cfg);

  // ---------- 4) Faktisk E2E: signUp / resetPasswordForEmail / updateUser({ email }) ----------
  // Monkey-patch den mock-klientens auth-metoder for å fange de FAKTISKE
  // opsjonene appen sender — ikke bare hva den rene funksjonen regner ut i
  // isolasjon. Flere kall til updateUser skjer i bakgrunnen (nav-posisjon,
  // display_name) — vi samler ALLE kall og plukker ut den med `.email`.
  await page.waitForFunction(() => window.__huskis && window.__huskis.client && window.__huskis.client.auth);
  await page.evaluate(() => {
    const c = window.__huskis.client;
    window.__captured = { signUp: [], resetPasswordForEmail: [], updateUser: [] };
    ['signUp', 'resetPasswordForEmail', 'updateUser'].forEach((name) => {
      const orig = c.auth[name].bind(c.auth);
      c.auth[name] = (...args) => { window.__captured[name].push(args); return orig(...args); };
    });
  });

  const expected = await page.evaluate(() => window.__huskis.authRedirectUrl());
  check('authRedirectUrl() uten argument beholder egen origin i lokal utvikling',
    expected === BASE.replace(/\/+$/, '') + '/', expected);

  // -- Registrering (signUp) --
  const email = 'u' + Math.floor(Math.random() * 1e9) + '@test.no';
  await page.getByText('Registrer deg').click();
  await page.locator('#auth-first-name').fill('Kari');
  await page.locator('#auth-last-name').fill('Nordmann');
  await page.locator('#auth-email').fill(email);
  await page.locator('#auth-password').fill('passord123');
  await page.locator('#auth-submit').click();
  await page.waitForTimeout(500);
  const signUpCall = await page.evaluate(() => window.__captured.signUp[0]);
  check('signUp: nøyaktig ett kall', signUpCall !== undefined);
  check('signUp: options.emailRedirectTo === authRedirectUrl()',
    !!signUpCall && signUpCall[0].options && signUpCall[0].options.emailRedirectTo === expected,
    signUpCall && signUpCall[0].options);
  check('signUp: emailRedirectTo er ALDRI det gamle domenet',
    !!signUpCall && signUpCall[0].options.emailRedirectTo.indexOf('huskekurv') === -1);

  // -- Glemt passord (resetPasswordForEmail) --
  await page.locator('#auth-sent-back').click();
  await page.waitForTimeout(200);
  await page.locator('.auth-link[data-mode="forgot"]').click();
  await page.locator('#auth-email').fill(email);
  await page.locator('#auth-submit').click();
  await page.waitForTimeout(500);
  const resetCall = await page.evaluate(() => window.__captured.resetPasswordForEmail[0]);
  check('resetPasswordForEmail: nøyaktig ett kall', resetCall !== undefined);
  check('resetPasswordForEmail: redirectTo === authRedirectUrl()',
    !!resetCall && resetCall[1] && resetCall[1].redirectTo === expected, resetCall && resetCall[1]);

  // -- E-postendring (updateUser({ email })) --
  await page.locator('#auth-sent-back').click();
  await page.waitForTimeout(200);
  await page.locator('#auth-email').fill(email);
  await page.locator('#auth-password').fill('passord123');
  await page.locator('#auth-submit').click();
  await page.waitForTimeout(1200);
  await page.locator('#account-btn').click();
  await page.waitForTimeout(300);
  const newEmail = 'ny' + Math.floor(Math.random() * 1e9) + '@test.no';
  await page.locator('#account-email-input').fill(newEmail);
  await page.locator('#account-email-form button[type=submit]').click();
  await page.waitForTimeout(500);
  const emailChangeCall = await page.evaluate(() => window.__captured.updateUser.find((a) => a[0] && a[0].email));
  check('updateUser({ email }): funnet blant kallene', emailChangeCall !== undefined);
  check('updateUser({ email }): options.emailRedirectTo === authRedirectUrl()',
    !!emailChangeCall && emailChangeCall[1] && emailChangeCall[1].emailRedirectTo === expected,
    emailChangeCall && emailChangeCall[1]);

  check('ingen ukontrollerte JS-feil på siden', pageErrors.length === 0, pageErrors);

  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
