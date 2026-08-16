/*
  Regresjonstest: LYS OG MØRK DRAKT (docs/mork-drakt.md).

  Drakten er ikke et stilark til: den er ÉN blokk med fargetokens som byttes ut,
  pluss ett tall i paletten som speiles. Testen dekker de seks stedene det kan gå
  galt:

    1. Attributtet står FØR første maling. `theme.js` lastes i <head> nettopp
       for å unngå at skjermen blinker hvitt før den blir mørk; her måles
       `data-theme` og den oppløste `--bg` i den FØRSTE rAF-en, altså før
       nettleseren har malt noe.
    2. Standarden er «følg systemet», og den følger det LEVENDE: en endring i
       operativsystemets `prefers-color-scheme` slår gjennom uten omlasting —
       og maler board-et på nytt, siden kortfargene ikke bor i CSS.
    3. Et eksplisitt valg overstyrer systemet og overlever en omlasting. Begge
       velgerne (innloggingsskjermen og konto-modalen) gjør det samme.
    4. Kortfargene speiles: SAMME tone, invertert lyshet. Kortene er lysere enn
       board-et i lys drakt og fortsatt lysere i mørk (bakgrunnen er da
       mørkere enn kortene) — det er separasjonen som må overleve, ikke tallet.
    5. Det som ikke er vårt eget: `color-scheme` på rot-elementet, så
       <select>-nedtrekk, dato-/klokkeslettvelgere og rullefelt følger med, og
       `<meta name="theme-color">` som farger nettleserens egen ramme.
    6. Et draktbytte RENDRER IKKE. Alle palettflatene males kirurgisk — kortene
       (custom properties) og ansvarssirklene (stemplet med kilden til fargen
       sin) — så en pågående inline navngiving blir stående, og `save()` (som
       renderBoardInner kaller ubetinget) kjører ikke for et rent lokalt
       fargebytte.
    7. Søppelkassens prikker utleder fargen fra id-en i den drakten som gjelder,
       aldri fra objektets hurtiglagrede `.color`. Dekkes både for et bytte i
       appen og for kaldstarten (drakten malt før noen lytter finnes, med en
       lys farge liggende i den lokale bufferen).

  Punkt 3 kjøres i BEGGE viewportene: på innloggingsskjermen står språk- og
  draktvelgeren på samme rad, og raden skal brekke MELLOM parene — aldri mellom
  en etikett og velgeren sin.

  Kjør:
    python3 -m http.server 8000                  # fra repo-roten, i egen terminal
    NODE_PATH=$(npm root -g) node tests/dark-mode.test.js
*/
const { chromium } = require('playwright');

const BASE = process.env.HUSKIS_URL || 'http://localhost:8000';

let passed = 0, failed = 0;
function check(name, cond, extra) {
  if (cond) { passed++; console.log('PASS — ' + name); }
  else { failed++; console.log('  ✗ FAIL: ' + name + (extra !== undefined ? '  [' + JSON.stringify(extra) + ']' : '')); }
}

// Draktens sannhet, lest fra tre uavhengige kilder samtidig: attributtet, den
// oppløste bakgrunnen og det lagrede valget.
const themeState = (p) => p.evaluate(() => ({
  attr: document.documentElement.getAttribute('data-theme'),
  mode: window.HUSKIS_THEME.mode(),
  bg: getComputedStyle(document.documentElement).getPropertyValue('--bg').trim(),
  colorScheme: getComputedStyle(document.documentElement).colorScheme,
  meta: document.querySelector('meta[name="theme-color"]').getAttribute('content'),
  stored: localStorage.getItem('huskis-theme'),
}));

// #rrggbb → HSL, så vi kan snakke om tone og lyshet hver for seg.
function hsl(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  const l = (max + min) / 2;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h = (h * 60 + 360) % 360;
  }
  return { h: Math.round(h), l: Math.round(l * 100) };
}
function srgb(c) { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
function lum(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => srgb(parseInt(hex.slice(i, i + 2), 16)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrast = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);

// Kortfargene slik de FAKTISK står i DOM-en (inline custom property fra
// paintCardColor), ikke slik vi tror paletten regner dem ut.
const cardColors = (p) => p.evaluate(() => [...document.querySelectorAll('#board .card')]
  .map((c) => c.style.getPropertyValue('--card-bg').trim()));

async function login(p) {
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
  await p.waitForFunction(() => {
    const H = window.__huskis;
    return H && H.authUser && H.lastMy;
  }, null, { timeout: 15000, polling: 200 });
  // Demoen og gest-tipsene legger seg over appen for enhver ny konto.
  await p.evaluate(() => window.__huskis.tour.skipAll());
  await p.waitForTimeout(150);
  return email;
}

// Ett område > én mappe > fire lister, så vi har kort i flere L-sett å måle på.
async function seed(p) {
  await p.evaluate(() => {
    const H = window.__huskis, st = H.state;
    const mk = (o) => Object.assign({ ts: 1, org: 't', pos: 0, posTs: 1, posOrg: 't', trashed: false, _role: 'owner' }, o);
    st.universes.length = 0;
    // EKTE UUID-er: de relasjonelle tabellene har uuid-kolonner, så seedede
    // «uni-A»-id-er ville blitt avvist av PostgREST og latt synk-pillen stå på
    // «rejected» — nettopp den tilstanden en av sjekkene under måler mot.
    const id = () => crypto.randomUUID();
    const uniId = id(), grpId = id();
    const u = mk({ id: uniId, name: 'Hjemme', collapsed: false, groups: [] });
    const g = mk({ id: grpId, uni: uniId, name: 'Ukesplan', cat: null, isCat: false, collapsed: false, cards: [] });
    for (let i = 0; i < 4; i++) {
      const cid = id();
      const c = mk({ id: cid, group: grpId, title: 'Liste ' + (i + 1), pos: i, collapsed: false, items: [] });
      c.items.push(mk({ id: id(), home: cid, text: 'Et listepunkt', done: false, cat: null, isCat: false }));
      g.cards.push(c);
    }
    u.groups.push(g);
    st.universes.push(u);
    st.activeUniverse = uniId; st.activeGroup = grpId;
    H.render();
  });
  await p.waitForTimeout(300);
}

(async () => {
  const browser = await chromium.launch();
  const errs = [];

  /* ---------- 1. Attributtet står før første maling ---------- */
  console.log('\n--- Drakten settes før første maling ---');
  for (const [what, scheme, want] of [['mørkt system', 'dark', 'dark'], ['lyst system', 'light', 'light']]) {
    const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 }, colorScheme: scheme });
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errs.push('[' + what + '] ' + e));
    // Kjører FØR all sidekode. rAF-en her fyrer før nettleseren maler første
    // bilde, så det den ser er nøyaktig det brukeren ville sett først.
    await p.addInitScript(() => {
      window.__firstFrame = new Promise((res) => {
        requestAnimationFrame(() => res({
          attr: document.documentElement.getAttribute('data-theme'),
          bg: getComputedStyle(document.documentElement).getPropertyValue('--bg').trim(),
          body: getComputedStyle(document.body).backgroundColor,
        }));
      });
    });
    await p.goto(BASE + '/?mock=1');
    const first = await p.evaluate(() => window.__firstFrame);
    check(`${what}: data-theme er «${want}» allerede i første frame`, first.attr === want, first);
    check(`${what}: --bg er løst opp før første maling`, /^#[0-9a-f]{6}$/i.test(first.bg), first.bg);
    const st = await themeState(p);
    check(`${what}: standarden er «følg systemet» — ingenting lagret ennå`,
      st.mode === 'system' && st.stored === null, st);
    check(`${what}: første frame og den ferdig lastede siden er enige om --bg`,
      first.bg === st.bg, { first: first.bg, etter: st.bg });
    check(`${what}: <meta name="theme-color"> følger --bg`, st.meta === st.bg, st);
    check(`${what}: color-scheme på rot-elementet er «${want}»`, st.colorScheme === want, st.colorScheme);
    await ctx.close();
  }

  /* ---------- 2–5. Bytte, speiling og varighet ---------- */
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 }, colorScheme: 'light' });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errs.push(String(e)));
  await p.goto(BASE + '/?mock=1');
  await p.waitForTimeout(500);

  console.log('\n--- Innloggingsskjermens draktvelger ---');
  check('draktvelgeren finnes før innlogging', await p.locator('#auth-theme-select').count() === 1);
  check('den har de tre valgene fra theme.js',
    (await p.locator('#auth-theme-select option').allTextContents()).length === 3,
    await p.locator('#auth-theme-select option').allTextContents());
  await p.selectOption('#auth-theme-select', 'dark');
  await p.waitForTimeout(250);
  let st = await themeState(p);
  check('valget slår gjennom med én gang', st.attr === 'dark' && st.mode === 'dark', st);
  check('valget er lagret på enheten', st.stored === 'dark', st.stored);
  const darkBg = st.bg;

  await login(p);
  await seed(p);

  console.log('\n--- Kortfargene speiles ---');
  const darkCards = await cardColors(p);
  check('board-et har kort å måle på', darkCards.length >= 4, darkCards);

  /* --- Den mørke kortflaten: nøytral skifer + palettpreg + aksentstripe ---
     `:root[data-theme="dark"] .card` i styles.css maler kortflaten OPPÅ
     palettfargen med `color-mix()` (se kommentaren der). Sjekkene her er to:

       • at det faktisk BLIR malt om, ikke bare deklarert. En regel som stille
         slutter å gjelde (feil selektor, en kommentar som lukkes for tidlig og
         spiser regelen etter seg) gir ingen feilmelding noe sted — appen ser
         bare ut som før. Derfor måles den RENDREDE flaten mot den inline
         palettfargen kortet bærer, ikke bare kildeteksten i styles.css.
       • at ingen av reglene posisjonerer kortet. `.card` MÅ bli stående
         `static`: et posisjonert kort blir containing block for de absolutt
         posisjonerte dra-elementene, og hele DnD-geometrien forskyves (se
         tests/dnd-viewport-clamp.test.js, som måler følgene — dette er
         nøyaktig feilen en tidligere utgave av dette designet hadde). */
  const flate = await p.evaluate(() => {
    const c = document.querySelector('#board .card');
    if (!c) return null;
    const cs = getComputedStyle(c);
    return {
      palett: c.style.getPropertyValue('--card-bg').trim(),
      malt: cs.backgroundColor,
      stripe: cs.backgroundImage,
      position: cs.position,
      hode: getComputedStyle(c.querySelector('.card-head')).backgroundColor,
    };
  });
  /* Kanalene i 0–255, uansett skrivemåte. En `color-mix()`-blanding regnes ut i
     en fargerom-form, så getComputedStyle svarer `color(srgb 0.15 0.16 0.19)`
     der en vanlig farge gir `rgb(38, 44, 53)` — begge må leses likt. */
  const kanaler = (s) => {
    const t = String(s), n = (t.match(/[\d.]+/g) || []).map(Number).slice(0, 3);
    const rgb = /^color\(/.test(t) ? n.map((v) => v * 255) : n;
    return rgb.length === 3 ? rgb : [-1, -1, -1];
  };
  const hexKanaler = (h) => [1, 3, 5].map((i) => parseInt(String(h).slice(i, i + 2), 16));
  const sum = (a) => a.reduce((x, y) => x + y, 0);
  const maltRgb = flate && kanaler(flate.malt);
  check('kortflaten er malt om til den nøytrale skiferflaten, ikke palettfargen',
    !!flate && maltRgb.every((v) => v >= 0 && v < 80)
      && Math.abs(sum(maltRgb) - sum(hexKanaler(flate.palett))) > 40,
    { ...flate, maltRgb, palettRgb: flate && hexKanaler(flate.palett) });
  check('aksentstripen står på kortet og på hodet',
    !!flate && /gradient/.test(flate.stripe), flate && flate.stripe);
  check('korthodet ligger lysere enn kortflaten',
    !!flate && sum(kanaler(flate.hode)) > sum(maltRgb),
    { hode: flate && kanaler(flate.hode), flate: maltRgb });
  check('INGEN drakt-regel posisjonerer kortet (containing block for DnD)',
    !!flate && flate.position === 'static', flate && flate.position);
  // Tilbake til lys fra konto-modalen — den andre av de to velgerne.
  await p.evaluate(() => window.__huskis.openAccount());
  await p.waitForTimeout(300);
  check('draktvelgeren finnes i konto-modalen', await p.locator('#theme-select').count() === 1);
  check('den står synlig utenfor trekkspillet, ved siden av språkraden',
    await p.locator('#menu-theme').isVisible());
  await p.selectOption('#theme-select', 'light');
  await p.waitForTimeout(300);
  await p.evaluate(() => window.__huskis.closeAccount());
  await p.waitForTimeout(250);
  st = await themeState(p);
  check('konto-modalens velger bytter tilbake', st.attr === 'light' && st.stored === 'light', st);
  const lightBg = st.bg;
  const lightCards = await cardColors(p);

  check('kortene er de samme, i samme rekkefølge', lightCards.length === darkCards.length,
    { lys: lightCards.length, mork: darkCards.length });
  for (let i = 0; i < Math.min(lightCards.length, darkCards.length); i++) {
    const L = hsl(lightCards[i]), D = hsl(darkCards[i]);
    check(`kort ${i + 1}: SAMME tone i begge drakter (${L.h}° / ${D.h}°)`, L.h === D.h, { lys: lightCards[i], mork: darkCards[i] });
    check(`kort ${i + 1}: lysheten er speilet (L ${L.l} → ${D.l})`, D.l < L.l && D.l < 50 && L.l > 50,
      { lys: lightCards[i], mork: darkCards[i] });
  }
  // Det som faktisk betyr noe er at kortet skiller seg fra board-et. Kravet er
  // ikke et tall her — det er at den mørke drakten ikke er dårligere.
  const sep = (cards, bg) => Math.min(...cards.map((c) => contrast(c, bg)));
  const sepLight = sep(lightCards, lightBg), sepDark = sep(darkCards, darkBg);
  check(`kortene skiller seg fra board-et i begge drakter (lys ${sepLight.toFixed(2)}:1, mørk ${sepDark.toFixed(2)}:1)`,
    sepDark >= sepLight * 0.9, { lys: +sepLight.toFixed(2), mork: +sepDark.toFixed(2) });
  check('board-et er mørkere enn kortene i mørk drakt',
    darkCards.every((c) => lum(c) > lum(darkBg)), { bg: darkBg, kort: darkCards });

  console.log('\n--- Den virtuelle beholderen holdes utenfor omfargingen ---');
  /* «Mapper delt med meg» er en virtuell beholder uten palettfarge: flaten er
     et nøytralt --free-*-sett fra klassen, og buildUniverseCard() hopper over
     paintCardColor for den. reindexContainerColors må hoppe over den også —
     ellers skriver den en inline --card-bg som slår klassen, OG forskyver
     indeksen for alle områdene etter den (fargen er posisjonsbasert, og
     renderNav indekserer den FILTRERTE lista). */
  await p.evaluate(() => {
    const H = window.__huskis, st = H.state;
    st.universes.push({
      id: crypto.randomUUID(), name: 'Mapper delt med meg', _virtual: true,
      collapsed: false, groups: [], trashed: false,
      ts: 1, org: 't', pos: -1, posTs: 1, posOrg: 't',
    });
    H.openNavModal();
  });
  await p.waitForTimeout(400);
  const førVirt = await p.evaluate(() => {
    const el = document.querySelector('#nav-board .free-groups-card');
    const ekte = [...document.querySelectorAll('#nav-board .card:not(.free-groups-card)')]
      .map((c) => c.style.getPropertyValue('--card-bg').trim());
    return { finnes: !!el, inline: el ? el.style.getPropertyValue('--card-bg').trim() : null, ekte };
  });
  check('forutsetning: den virtuelle beholderen er tegnet, uten inline kortfarge',
    førVirt.finnes && !førVirt.inline, førVirt);
  await p.evaluate(() => window.HUSKIS_THEME.setMode('light'));
  await p.waitForTimeout(350);
  const etterVirt = await p.evaluate(() => {
    const el = document.querySelector('#nav-board .free-groups-card');
    const ekte = [...document.querySelectorAll('#nav-board .card:not(.free-groups-card)')]
      .map((c) => c.style.getPropertyValue('--card-bg').trim());
    return {
      inline: el ? el.style.getPropertyValue('--card-bg').trim() : null,
      flate: el ? getComputedStyle(el).backgroundColor : null,
      ekte,
    };
  });
  check('draktbyttet gir den ikke en palettfarge',
    !etterVirt.inline, etterVirt);
  check('de EKTE områdene fikk sine farger, uten at den virtuelle forskjøv indeksen',
    etterVirt.ekte.length > 0 && etterVirt.ekte.every((c) => /^#[0-9a-f]{6}$/i.test(c)),
    etterVirt.ekte);
  await p.evaluate(() => {
    const st = window.__huskis.state;
    st.universes = st.universes.filter((u) => !u._virtual);
    window.__huskis.closeNavModal();
  });
  await p.waitForTimeout(250);
  await p.evaluate(() => window.HUSKIS_THEME.setMode('dark'));
  await p.waitForTimeout(250);

  console.log('\n--- Søppelkassens prikker følger drakten, også etter en kaldstart ---');
  /* Radene utleder fargen fra id-en (`colorForId`) i den drakten som gjelder
     NÅ — de tar ikke den hurtiglagrede `.color`. Det er den eneste varianten
     som også holder ved KALDSTART: `theme.js` maler drakten før `app.js`
     rekker å registrere lytteren sin, så et OS-modusbytte mens appen var
     lukket når aldri fram til noen opprydding. Og `.color` overlever i den
     lokale bufferen — `stateReplacer` fjerner bare `_`-prefiksede nøkler. */
  const dotHex = async () => p.evaluate(() => {
    const d = document.querySelector('#trash-modal .trash-dot');
    if (!d) return null;
    const m = getComputedStyle(d).backgroundColor.match(/\d+/g).map(Number);
    return '#' + m.slice(0, 3).map((v) => v.toString(16).padStart(2, '0')).join('');
  });

  await p.evaluate(() => window.HUSKIS_THEME.setMode('light'));
  await p.waitForTimeout(250);
  const trashetLys = await p.evaluate(() => {
    const c = window.__huskis.state.universes[0].groups[0].cards[0];
    c.trashed = true;                 // farget mens den var synlig
    window.__huskis.render();
    return c.color;
  });
  check('forutsetning: den slettede lista bærer en hurtiglagret LYS farge',
    /^#[0-9a-f]{6}$/i.test(trashetLys || '') && hsl(trashetLys).l > 50, trashetLys);

  await p.evaluate(() => window.HUSKIS_THEME.setMode('dark'));
  await p.waitForTimeout(300);
  await p.locator('#trash-btn').click();
  await p.waitForTimeout(400);
  const varmPrikk = await dotHex();
  check(`prikken er fra det mørke settet etter et bytte i appen (${varmPrikk})`,
    !!varmPrikk && hsl(varmPrikk).l < 50, varmPrikk);
  await p.keyboard.press('Escape');
  await p.waitForTimeout(250);

  /* KALDSTARTEN, modellert direkte. Ved et OS-modusbytte mens appen var
     lukket fyrer ingen lytter — `theme.js` maler drakten før `app.js` rekker å
     registrere seg — og `.color` overlever i den lokale bufferen fordi
     `stateReplacer` bare fjerner `_`-prefiksede nøkler. Tilstanden det gir er
     nøyaktig denne: mørk drakt OG en trashet liste som bærer en lys
     hurtiglagret farge. Invarianten er at radene ikke bryr seg om den. */
  const kaldPrikk = await p.evaluate(async () => {
    const c = window.__huskis.state.universes[0].groups[0].cards.find((x) => x.trashed);
    c.color = '#ebe0e0';                 // som lastet fra buffer, lys drakt (L=90)
    return c.color;
  });
  check('forutsetning: den trashede lista bærer en lys buffret farge i mørk drakt',
    hsl(kaldPrikk).l > 50, kaldPrikk);
  await p.locator('#trash-btn').click();
  await p.waitForTimeout(400);
  const kaldHex = await dotHex();
  check(`prikken er fra det mørke settet, ikke den buffrede fargen (${kaldHex})`,
    !!kaldHex && hsl(kaldHex).l < 50, { kaldHex, buffret: kaldPrikk });
  await p.keyboard.press('Escape');
  await p.waitForTimeout(250);

  console.log('\n--- Valget overlever en omlasting ---');
  await p.selectOption('#auth-theme-select', 'dark').catch(() => { /* skjult etter innlogging */ });
  await p.evaluate(() => window.HUSKIS_THEME.setMode('dark'));
  await p.reload();
  await p.waitForFunction(() => document.readyState === 'complete', null, { timeout: 15000, polling: 200 });
  st = await themeState(p);
  check('drakten står der den ble satt etter en omlasting', st.attr === 'dark' && st.mode === 'dark', st);

  console.log('\n--- «Følg systemet» følger systemet, levende ---');
  await p.evaluate(() => window.HUSKIS_THEME.setMode('system'));
  await p.waitForTimeout(200);
  await p.emulateMedia({ colorScheme: 'dark' });
  await p.waitForTimeout(300);
  st = await themeState(p);
  check('systemet slår mørkt på → appen blir mørk uten omlasting', st.attr === 'dark' && st.mode === 'system', st);
  await p.emulateMedia({ colorScheme: 'light' });
  await p.waitForTimeout(300);
  st = await themeState(p);
  check('…og lyst igjen', st.attr === 'light' && st.mode === 'system', st);
  // Et eksplisitt valg skal IKKE la seg overstyre av operativsystemet.
  await p.evaluate(() => window.HUSKIS_THEME.setMode('dark'));
  await p.emulateMedia({ colorScheme: 'light' });
  await p.waitForTimeout(300);
  st = await themeState(p);
  check('et eksplisitt valg lar seg ikke overstyre av systemet', st.attr === 'dark', st);
  console.log('\n--- Et systembytte river ikke ned en pågående navngiving ---');
  /* Regresjon: draktbyttet malte board-et på nytt med en gang. Et OS-bytte
     kommer når det kommer — gjerne midt i en inline omdøping — og `render()`
     fjerner den fokuserte `.edit-input`-noden. `captureFocusIn` bevarer den
     ikke, og en fjernet, fokusert node fyrer ikke pålitelig sin egen `blur`, så
     teksten forsvant. Kortfargene skal likevel følge drakten, kirurgisk. */
  await p.evaluate(() => window.HUSKIS_THEME.setMode('system'));
  await p.emulateMedia({ colorScheme: 'light' });
  await p.waitForTimeout(250);
  // Start en omdøping og skriv noe UTEN å bekrefte. F2 på en fokusert rad er
  // den samme veien inn som tastatursnarveien ellers i appen.
  await p.locator('#board .card .item').first().focus();
  await p.keyboard.press('F2');
  await p.waitForTimeout(300);
  await p.keyboard.type('Halvskrevet navn');
  await p.waitForTimeout(150);
  const før = await p.evaluate(() => {
    const el = document.querySelector('#board .edit-input');
    return { finnes: !!el, verdi: el && el.value, fokusert: el === document.activeElement };
  });
  check('forutsetning: navnefeltet står åpent med ubekreftet tekst',
    før.finnes && før.verdi === 'Halvskrevet navn' && før.fokusert, før);
  await p.evaluate(() => { window.__kortFor = document.querySelector('#board .card'); });
  await p.emulateMedia({ colorScheme: 'dark' });
  await p.waitForTimeout(400);
  const etter = await p.evaluate(() => {
    const el = document.querySelector('#board .edit-input');
    return {
      sammeNode: document.querySelector('#board .card') === window.__kortFor,
      theme: document.documentElement.getAttribute('data-theme'),
      finnes: !!el,
      verdi: el && el.value,
      fokusert: el === document.activeElement,
      kortfarge: (document.querySelector('#board .card') || {}).style
        && document.querySelector('#board .card').style.getPropertyValue('--card-bg').trim(),
    };
  });
  check('drakten byttet likevel', etter.theme === 'dark', etter);
  check('navnefeltet står fortsatt der, med teksten og fokuset i behold',
    etter.finnes && etter.verdi === 'Halvskrevet navn' && etter.fokusert, etter);
  check('…og kortfargene fulgte drakten kirurgisk (mørkt sett)',
    /^#[0-9a-f]{6}$/i.test(etter.kortfarge) && hsl(etter.kortfarge).l < 50, etter.kortfarge);

  /* …og det gjorde den UTEN å bygge board-et om. Denne ene sjekken dekker to
     regresjoner, for begge følger av at `render()` kjørte:

       • navnefeltet rives ned (målt over), og
       • `renderBoardInner()` kaller `save()` — som stempler dokumentet som
         endret, køer en synk-runde og blokkerer auto-oppdateringens
         trygghetssjekk, for et rent lokalt fargebytte.

     Den andre er målt her og ikke på synk-pillen: pillen rakk ikke å slå ut på
     én ekstra `save()` i mock-backenden, så en sjekk på den ville passert også
     med feilen inne. Node-identiteten er derimot entydig — palettflatene males
     kirurgisk, så board-noden skal være den SAMME etterpå. */
  check('board-noden er ikke bygget om — draktbyttet rendrer ikke',
    etter.sammeNode, etter);
  await p.keyboard.press('Escape');
  await p.waitForTimeout(250);

  await p.emulateMedia({ colorScheme: null });
  await ctx.close();

  /* ---------- Innloggingsskjermens rad, begge viewporter ---------- */
  console.log('\n--- Språk + drakt på innloggingsskjermen (begge viewporter) ---');
  for (const [what, viewport, isMobile] of [
    ['desktop', { width: 1200, height: 900 }, false],
    ['mobil', { width: 390, height: 780 }, true],
  ]) {
    const c2 = await browser.newContext({ viewport, isMobile, hasTouch: isMobile });
    const p2 = await c2.newPage();
    p2.on('pageerror', (e) => errs.push('[' + what + '] ' + e));
    await p2.goto(BASE + '/?mock=1');
    await p2.waitForTimeout(500);
    // Etiketten og velgeren sin skal alltid stå på SAMME linje; brekker raden,
    // brekker den mellom de to parene.
    const rows = await p2.evaluate(() => [...document.querySelectorAll('.auth-lang-pair')].map((pair) => {
      const label = pair.querySelector('label').getBoundingClientRect();
      const sel = pair.querySelector('select').getBoundingClientRect();
      return { sammeLinje: Math.abs(label.top - sel.top) < label.height, top: Math.round(pair.getBoundingClientRect().top) };
    }));
    check(`${what}: begge parene finnes`, rows.length === 2, rows);
    check(`${what}: etiketten står på samme linje som velgeren sin`, rows.every((r) => r.sammeLinje), rows);
    await c2.close();
  }

  check('ingen JS-feil underveis', errs.length === 0, errs);
  await browser.close();
  console.log(`\n==== ${passed}/${passed + failed} PASS ====`);
  process.exit(failed ? 1 : 0);
})();
