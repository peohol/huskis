/*
  Regresjonstest: DEN SIKRE SONEN og SKJERMTASTATURET.

  I et native skall tegner Huskis under systemets egne flater (statusfelt/hakk
  øverst, gestelinje nederst, hakk i sidene i landskap) — `viewport-fit=cover` i
  index.html. Til gjengjeld rapporterer runtimen målene som
  `env(safe-area-inset-*)`, og styles.css fanger dem i fire tokens
  (--safe-top/-right/-bottom/-left). Alt som ligger fast mot en viewport-kant
  skal legge dem PÅ sin egen avstand.

  En vanlig nettleser har ingen inset-er å rapportere, så env() er 0 der og
  hele mekanismen er en no-op — det er nettopp derfor sonen kan testes her:
  testen SETTER de fire tokenene og måler at chromet flytter seg nøyaktig så
  mye. Uten tokenene (env() skrevet rett inn i hver regel) ville det ikke
  finnes noe å sette.

  Dekker:
    1. Nettleseren er urørt: de fire tokenene er 0, og de faste elementene står
       på sine gamle avstander (browserutgaven skal ikke betale for native).
    2. Toppmenyen og kontoknappen legger sonen på: innholdet havner ikke under
       statusfeltet, og de to flukter fortsatt.
    3. Board-ets klaring følger med: `syncHeaderHeight()` måler den FAKTISKE
       toppmeny-høyden, så første kort ligger fortsatt under menyen.
    4. Bunn-chromet (toast, lagringsstatus, oppdateringsbanner) og board-ets
       bunn holder seg over gestelinjen.
    5. Modal-skallet: panelet holder seg innenfor sonen — også nav-modalen med
       sitt eget board (begge scope).
    6. Demonstrasjonens kort klemmes mot sonen, ikke mot skjermkanten.
    7. Skjermtastaturet: et tastatur som krymper viewportet skal ikke legge seg
       over feltet som redigeres — feltet rulles tilbake i syne, og havner
       ikke under den faste toppmenyen på veien.
    8. Innloggingsskjermen: et skjema som er høyere enn det som er igjen av
       skjermen klippes ikke på toppen (sentreringen gir fra seg plass).

  Kjør:
    python3 -m http.server 8000                     # fra repo-roten, i egen terminal
    NODE_PATH=$(npm root -g) node tests/safe-area.test.js
*/
const { chromium } = require('playwright');

const BASE = process.env.HUSKIS_URL || 'http://localhost:8000';
const results = [];
const log = (n, ok, x = '') => { results.push(ok); console.log((ok ? 'PASS' : 'FAIL') + ' — ' + n + (x ? '  [' + x + ']' : '')); };
const nær = (a, b, slack = 1) => Math.abs(a - b) <= slack;

// Sonen testen later som telefonen rapporterer. Fire ULIKE tall, så en regel
// som bruker feil kant blir synlig.
const SONE = { top: 48, right: 24, bottom: 32, left: 16 };

async function register(p) {
  await p.goto(BASE + '/?mock=1');
  await p.waitForTimeout(500);
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
  await p.evaluate(() => window.__huskis.tour.skipAll());
  await p.waitForTimeout(150);
}

// Ett område, én mappe, én liste med to listepunkter.
async function seed(p) {
  await p.evaluate(() => {
    const H = window.__huskis, st = H.state;
    const mk = (o) => Object.assign({ ts: 1, org: 't', pos: 0, posTs: 1, posOrg: 't',
      trashed: false, _role: 'owner' }, o);
    st.universes.length = 0;
    const u = mk({ id: 'UNI', name: 'Hjemme', collapsed: false, groups: [] });
    const g = mk({ id: 'GRP', uni: 'UNI', name: 'Ukesplan', cat: null, isCat: false, collapsed: false, cards: [] });
    const c1 = mk({ id: 'L1', group: 'GRP', title: 'Handleliste', collapsed: false, items: [] });
    c1.items.push(mk({ id: 'I1', home: 'L1', text: 'Melk', cat: null, isCat: false }));
    c1.items.push(mk({ id: 'I2', home: 'L1', text: 'Brød', cat: null, isCat: false, pos: 1 }));
    g.cards.push(c1);
    // Nok lister til at board-et er høyere enn skjermen i begge viewportene:
    // både bunn-luften, auto-scrollen og tastatur-sjekkene trenger et board
    // man faktisk kan rulle i.
    for (let i = 0; i < 12; i++) {
      g.cards.push(mk({ id: 'X' + i, group: 'GRP', title: 'Liste ' + i, collapsed: false, pos: i + 1,
        items: [mk({ id: 'XI' + i, home: 'X' + i, text: 'Punkt ' + i, cat: null, isCat: false })] }));
    }
    u.groups.push(g);
    st.universes.push(u);
    st.activeUniverse = 'UNI'; st.activeGroup = 'GRP';
    H.render();
  });
  await p.waitForTimeout(350);
}

// Sett/nullstill sonen slik runtimen ville gjort det. Toppmenyen endrer høyde,
// så vi venter på at ResizeObserver-en har oppdatert --board-pad-top.
async function settSone(p, s) {
  const før = await p.evaluate(() => document.documentElement.style.getPropertyValue('--board-pad-top'));
  await p.evaluate((sone) => {
    const r = document.documentElement.style;
    if (!sone) {
      ['top', 'right', 'bottom', 'left'].forEach((k) => r.removeProperty('--safe-' + k));
      return;
    }
    Object.keys(sone).forEach((k) => r.setProperty('--safe-' + k, sone[k] + 'px'));
  }, s || null);
  await p.waitForFunction((f) => document.documentElement.style.getPropertyValue('--board-pad-top') !== f,
    før, { timeout: 4000, polling: 50 }).catch(() => { /* uendret høyde er lov */ });
  await p.waitForTimeout(120);
}

// Rektangelet som faktisk er brukbart: viewportet minus sonen.
const sikkerRekt = (p, s) => p.evaluate((sone) => ({
  left: sone.left, top: sone.top,
  right: window.innerWidth - sone.right, bottom: window.innerHeight - sone.bottom,
}), s);

// Ligger elementet helt innenfor det brukbare rektangelet?
async function innenfor(p, sel, rekt, slack = 1) {
  const r = await p.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { left: b.left, top: b.top, right: b.right, bottom: b.bottom };
  }, sel);
  if (!r) return { ok: false, evidens: sel + ' finnes ikke' };
  const ok = r.left >= rekt.left - slack && r.top >= rekt.top - slack
    && r.right <= rekt.right + slack && r.bottom <= rekt.bottom + slack;
  return {
    ok,
    evidens: sel + ' ' + JSON.stringify({
      l: Math.round(r.left), t: Math.round(r.top), r: Math.round(r.right), b: Math.round(r.bottom),
    }) + ' i ' + JSON.stringify(rekt),
  };
}

const css = (p, sel, props) => p.evaluate(({ s, ps }) => {
  const el = document.querySelector(s);
  if (!el) return null;
  const c = getComputedStyle(el);
  const out = {};
  ps.forEach((k) => { out[k] = parseFloat(c[k]); });
  return out;
}, { s: sel, ps: props });

async function run(label, viewport, touchMode) {
  const b = await chromium.launch();
  const ctx = await b.newContext(Object.assign({ viewport }, touchMode ? { hasTouch: true, isMobile: true } : {}));
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await register(p);
  await seed(p);

  /* ---------- 1) Nettleseren er urørt ---------- */
  // env() erstattes når custom-propertyen regnes ut, så tokenene løser seg til
  // vanlige px-verdier — det er dem både CSS-reglene og safeInsets() i app.js
  // leser.
  const inert = await p.evaluate(() => {
    const c = getComputedStyle(document.documentElement);
    return ['top', 'right', 'bottom', 'left'].map((k) => c.getPropertyValue('--safe-' + k).trim());
  });
  log(label + ': nettleseren rapporterer ingen sone (alle fire tokenene er 0)',
    inert.every((v) => parseFloat(v) === 0), JSON.stringify(inert));

  const bar0 = await css(p, '.topbar', ['paddingTop', 'paddingLeft', 'paddingRight']);
  const konto0 = await p.evaluate(() => {
    const b = document.getElementById('account-btn').getBoundingClientRect();
    return { top: b.top, right: window.innerWidth - b.right };
  });
  const main0 = await css(p, '.app-main', ['paddingBottom']);
  log(label + ': toppmenyen står på sin vanlige polstring uten sone',
    bar0.paddingTop === 12, 'padding-top ' + bar0.paddingTop);
  log(label + ': kontoknappen står på sin vanlige avstand uten sone',
    nær(konto0.top, 12), 'top ' + Math.round(konto0.top));
  log(label + ': board-ets bunn er fortsatt 0 uten sone',
    main0.paddingBottom === 0, 'padding-bottom ' + main0.paddingBottom);

  /* ---------- 2) Med sone: toppmenyen og kontoknappen ---------- */
  await settSone(p, SONE);
  const rekt = await sikkerRekt(p, SONE);

  const bar1 = await css(p, '.topbar', ['paddingTop', 'paddingLeft', 'paddingRight']);
  log(label + ': toppmenyens innhold skyves ned forbi statusfeltet',
    nær(bar1.paddingTop, bar0.paddingTop + SONE.top),
    bar0.paddingTop + ' → ' + bar1.paddingTop + ' (sone ' + SONE.top + ')');
  log(label + ': toppmenyens sidepolstring tar hakket i sidene',
    nær(bar1.paddingLeft, bar0.paddingLeft + SONE.left)
      && nær(bar1.paddingRight, bar0.paddingRight + SONE.right),
    'v ' + bar1.paddingLeft + ' / h ' + bar1.paddingRight);

  const krumme = await innenfor(p, '#nav-crumb', rekt);
  log(label + ': navigasjonsknappen ligger innenfor den sikre sonen', krumme.ok, krumme.evidens);
  const konto = await innenfor(p, '#account-btn', rekt);
  log(label + ': kontoknappen ligger innenfor den sikre sonen', konto.ok, konto.evidens);
  const flukt = await p.evaluate(() => {
    const k = document.getElementById('account-btn').getBoundingClientRect();
    const t = document.querySelector('.topbar');
    const pad = parseFloat(getComputedStyle(t).paddingRight);
    return Math.abs((window.innerWidth - k.right) - pad);
  });
  log(label + ': kontoknappen flukter fortsatt med toppmenyens høyre kant',
    flukt <= 1, 'avvik ' + Math.round(flukt) + ' px');

  /* ---------- 3) Board-ets klaring følger toppmenyens høyde ---------- */
  const klaring = await p.evaluate(() => {
    const bar = document.querySelector('.topbar').getBoundingClientRect();
    const kort = document.querySelector('.app-main .card');
    return { barBunn: bar.bottom, kortTopp: kort ? kort.getBoundingClientRect().top : null };
  });
  log(label + ': første kort ligger fortsatt under toppmenyen',
    klaring.kortTopp !== null && klaring.kortTopp >= klaring.barBunn - 1,
    'meny bunn ' + Math.round(klaring.barBunn) + ', kort topp ' + Math.round(klaring.kortTopp));

  /* ---------- 4) Bunn-chromet holder seg over gestelinjen ---------- */
  const main1 = await css(p, '.app-main', ['paddingBottom', 'paddingLeft', 'paddingRight']);
  log(label + ': board-ets bunn får plass til gestelinjen',
    nær(main1.paddingBottom, SONE.bottom), 'padding-bottom ' + main1.paddingBottom);
  log(label + ': board-ets sider tar hakket i sidene',
    nær(main1.paddingLeft - SONE.left, main1.paddingRight - SONE.right),
    'v ' + main1.paddingLeft + ' / h ' + main1.paddingRight);

  // Siste kort skal kunne RULLES helt fram. Board-ets bunn-padding er det som
  // gjør at dokumentet i det hele tatt rekker forbi gestelinjen.
  const bunnKort = await p.evaluate((sone) => {
    window.scrollTo(0, document.documentElement.scrollHeight);
    const kort = document.querySelectorAll('.app-main .card');
    const siste = kort[kort.length - 1];
    if (!siste) return null;
    return { bunn: siste.getBoundingClientRect().bottom, grense: window.innerHeight - sone.bottom };
  }, SONE);
  log(label + ': siste kort kan rulles helt fram over gestelinjen',
    !!bunnKort && bunnKort.bunn <= bunnKort.grense + 1,
    bunnKort ? 'kort bunn ' + Math.round(bunnKort.bunn) + ', grense ' + Math.round(bunnKort.grense) : '—');
  await p.evaluate(() => window.scrollTo(0, 0));
  await p.waitForTimeout(150);

  await p.evaluate(() => window.__huskis.showToast('Testmelding'));
  await p.waitForTimeout(350);
  const toast = await innenfor(p, '.toast.show', rekt);
  log(label + ': toasten ligger over gestelinjen', toast.ok, toast.evidens);

  /* En LANG toast går helt ut til `max-width` (90vw). Den er sentrert på
     `left: 50%` + `translate(-50%)`, så uten at både senteret og bredden tar
     hensyn til sidene, legger den seg under hakket i landskap. */
  await p.evaluate(() => window.__huskis.showToast(
    'En svært lang melding som tvinger toasten helt ut til sin maksimale bredde'));
  await p.waitForTimeout(350);
  const bredToast = await innenfor(p, '.toast.show', rekt);
  log(label + ': en toast i full bredde holder seg innenfor hakket i sidene',
    bredToast.ok, bredToast.evidens);

  const bunnCss = await p.evaluate(() => {
    // Lagringsstatusen og oppdateringsbanneret kan stå skjult akkurat nå;
    // det som testes er REGELEN, så den leses av på flatene selv.
    const les = (sel, lag) => {
      let el = document.querySelector(sel);
      let midlertidig = null;
      if (!el) { midlertidig = document.createElement('div'); midlertidig.className = lag; document.body.appendChild(midlertidig); el = midlertidig; }
      const v = parseFloat(getComputedStyle(el).bottom);
      if (midlertidig) midlertidig.remove();
      return v;
    };
    return { status: les('.sync-status', 'sync-status'), banner: les('.update-banner', 'update-banner') };
  });
  log(label + ': lagringsstatusen løftes over gestelinjen',
    nær(bunnCss.status, 16 + SONE.bottom), 'bottom ' + bunnCss.status);
  log(label + ': oppdateringsbanneret løftes over gestelinjen',
    nær(bunnCss.banner, 24 + SONE.bottom), 'bottom ' + bunnCss.banner);

  /* ---------- 5) Modal-skallet, begge scope ---------- */
  await p.evaluate(() => window.__huskis.openNavModal());
  await p.waitForTimeout(300);
  const navPanel = await innenfor(p, '#nav-modal .modal', rekt);
  log(label + ': nav-modalens panel holder seg innenfor sonen', navPanel.ok, navPanel.evidens);
  const navKort = await innenfor(p, '#nav-board .card', rekt);
  log(label + ': områdekortet i nav-scopet holder seg innenfor sonen', navKort.ok, navKort.evidens);
  await p.evaluate(() => window.__huskis.closeNavModal());
  await p.waitForTimeout(200);

  await p.evaluate(() => window.__huskis.openAccount());
  await p.waitForTimeout(300);
  const kontoPanel = await innenfor(p, '#account-modal .modal', rekt);
  log(label + ': konto-modalens panel holder seg innenfor sonen', kontoPanel.ok, kontoPanel.evidens);
  await p.evaluate(() => window.__huskis.closeAccount());
  await p.waitForTimeout(200);

  // Popover-skallet: forankret i knappen på desktop, sentrert ark på mobil —
  // begge veier skal panelet holde seg innenfor sonen.
  await p.locator('.item[data-id="I1"] .obj-menu-btn').first().click();
  await p.waitForTimeout(300);
  const objPanel = await innenfor(p, '#obj-menu-panel', rekt);
  log(label + ': objektmenyens panel holder seg innenfor sonen', objPanel.ok, objPanel.evidens);
  await p.keyboard.press('Escape');
  await p.waitForTimeout(200);

  /* ---------- 5b) Dra-og-slipp: bunnen er den BRUKBARE bunnen ----------
     Auto-scrollen under et drag stopper ved board-ets bunn, og
     `scrollDroppedIntoView()` sjekker om det slupne kortet er synlig. Begge
     målte mot viewportbunnen, som med en gestelinje ligger UNDER det man kan
     se: siste kort ble stående delvis under linja til man rullet videre selv. */
  await p.evaluate(() => window.scrollTo(0, 0));
  await p.waitForTimeout(150);
  const kortHode = await p.evaluate(() => {
    const el = document.querySelector('.app-main .card[data-id="L1"] .card-head');
    const b = el.getBoundingClientRect();
    return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) };
  });
  const pek = (type, x, y) => p.evaluate(({ t, cx, cy }) => {
    const ev = new PointerEvent(t, { bubbles: true, cancelable: true, composed: true,
      clientX: cx, clientY: cy, pointerId: 7, pointerType: 'touch', button: 0, isPrimary: true });
    (t === 'pointerdown' ? (document.elementFromPoint(cx, cy) || document.body) : window).dispatchEvent(ev);
  }, { t: type, cx: x, cy: y });
  await pek('pointerdown', kortHode.x, kortHode.y);
  await p.waitForTimeout(260);                 // trykk-og-hold: gest-fysikk, ikke tilstand
  await pek('pointermove', kortHode.x, kortHode.y - 6);
  await p.waitForTimeout(60);
  // Hold kortet i nedre auto-scroll-sone og la den rulle til den stopper selv.
  await pek('pointermove', kortHode.x, viewport.height - 20);
  await p.waitForTimeout(1800);                // auto-scroll-fysikk: rAF over tid
  const rullet = await p.evaluate(() => ({
    y: window.scrollY,
    maks: document.documentElement.scrollHeight - window.innerHeight,
  }));
  await pek('pointerup', kortHode.x, viewport.height - 20);
  await p.waitForTimeout(700);                 // slipp-animasjon + scrollDroppedIntoView
  log(label + ': auto-scrollen under et drag rekker helt til dokumentets ende',
    rullet.maks <= 0 || rullet.y >= rullet.maks - 1,
    'scrollY ' + Math.round(rullet.y) + ' av maks ' + Math.round(rullet.maks));
  const slupp = await p.evaluate((sone) => {
    const el = document.querySelector('.app-main .card[data-id="L1"]');
    if (!el) return null;
    const b = el.getBoundingClientRect();
    const bar = document.querySelector('.topbar').getBoundingClientRect();
    return { høyde: b.height, top: b.top, bunn: b.bottom,
      grense: window.innerHeight - sone.bottom, barBunn: bar.bottom };
  }, SONE);
  // Et kort som er HØYERE enn det synlige feltet får ikke plass uansett, og
  // prioriterer da toppen (samme regel som uten sone). Unntaket gjelder bare
  // der — ellers ville det svelget nettopp den feilen vi tester.
  const forHøyt = !!slupp && slupp.høyde > slupp.grense - slupp.barBunn;
  log(label + ': det slupne kortet blir ikke liggende under gestelinjen',
    !!slupp && (forHøyt ? slupp.top >= slupp.barBunn - 1 : slupp.bunn <= slupp.grense + 1),
    slupp ? 'kort ' + Math.round(slupp.top) + '–' + Math.round(slupp.bunn)
      + ' (h ' + Math.round(slupp.høyde) + '), felt ' + Math.round(slupp.barBunn) + '–' + Math.round(slupp.grense) : '—');

  /* ---------- 6) Demonstrasjonens kort ---------- */
  await p.evaluate(() => window.__huskis.tour.start());
  await p.waitForTimeout(500);
  const tourKort = await innenfor(p, '#tour-card', rekt);
  log(label + ': demonstrasjonens kort klemmes mot sonen, ikke skjermkanten',
    tourKort.ok, tourKort.evidens);
  await p.evaluate(() => window.__huskis.tour.end());
  await p.waitForTimeout(250);

  /* ---------- 7) Skjermtastaturet krymper viewportet ---------- */
  // Tastaturet er ikke en egen mekanisme for web-laget: det gir WebView-en en
  // bunn-inset like høy som seg selv, altså nøyaktig den resize-en vi gjør her.
  await settSone(p, null);
  // Rull helt ned og start redigering på det NEDERSTE listepunktet — det er
  // der et tastatur faktisk kommer i veien.
  await p.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await p.waitForTimeout(250);
  await p.locator('.item[data-id="XI11"] .item-text').click();
  await p.waitForTimeout(300);
  const redigerer = await p.evaluate(() => !!document.querySelector('.edit-input'));
  log(label + ': redigering er i gang før tastaturet kommer opp', redigerer === true, String(redigerer));

  const TASTATUR = 340;
  await p.setViewportSize({ width: viewport.width, height: viewport.height - TASTATUR });
  await p.waitForTimeout(450);
  const felt = await p.evaluate(() => {
    const i = document.querySelector('.edit-input');
    if (!i) return null;
    const b = i.getBoundingClientRect();
    const bar = document.querySelector('.topbar').getBoundingClientRect();
    return { top: b.top, bottom: b.bottom, vh: window.innerHeight, barBunn: bar.bottom, fokus: document.activeElement === i };
  });
  log(label + ': feltet er fortsatt i redigering etter at viewportet krympet',
    !!felt && felt.fokus === true, felt ? 'fokus ' + felt.fokus : 'borte');
  log(label + ': feltet havner IKKE under tastaturet',
    !!felt && felt.bottom <= felt.vh + 1,
    felt ? 'felt bunn ' + Math.round(felt.bottom) + ' av ' + felt.vh : '—');
  log(label + ': og ikke under den faste toppmenyen heller',
    !!felt && felt.top >= felt.barBunn - 1,
    felt ? 'felt topp ' + Math.round(felt.top) + ', meny bunn ' + Math.round(felt.barBunn) : '—');

  // Den andre halvdelen av det samme: et felt som ligger under den FASTE
  // toppmenyen er synlig for nettleseren (den vet ikke om faste lag), så
  // fokus-rullingen ville latt det bli liggende der. `scroll-margin-top` på
  // feltet er board-ets egen klaring, og gjør at rullingen tar det fram.
  await p.keyboard.press('Escape');
  await p.waitForTimeout(200);
  const plassert = await p.evaluate(() => {
    const el = document.querySelector('.item[data-id="XI2"] .item-text');
    if (!el) return false;
    const bar = document.querySelector('.topbar').getBoundingClientRect();
    // Legg raden midt under toppmenyen: synlig i layouten, dekket av panelet.
    window.scrollTo(0, window.scrollY + el.getBoundingClientRect().top - bar.bottom / 2);
    return true;
  });
  await p.waitForTimeout(200);
  await p.evaluate(() => { document.querySelector('.item[data-id="XI2"] .item-text').click(); });
  await p.waitForTimeout(350);
  const dekket = await p.evaluate(() => {
    const i = document.querySelector('.edit-input');
    if (!i) return null;
    const b = i.getBoundingClientRect();
    return { top: b.top, barBunn: document.querySelector('.topbar').getBoundingClientRect().bottom };
  });
  log(label + ': et felt som åpnes under toppmenyen rulles fram under den',
    plassert && !!dekket && dekket.top >= dekket.barBunn - 1,
    dekket ? 'felt topp ' + Math.round(dekket.top) + ', meny bunn ' + Math.round(dekket.barBunn) : '—');

  log(label + ': ingen JS-feil', errs.length === 0, errs.join(' | ') || 'ingen');
  await b.close();
}

/* ---------- 8) Innloggingsskjermen når tastaturet krymper viewportet ----------
   Registreringsskjemaet er høyere enn innloggingen, og med et tastatur oppe blir
   det høyere enn det som er igjen av skjermen. Sentreres boksen med
   `align-items: center`, klippes den da på TOPPEN — overflow mot START-kanten
   kan ikke rulles fram — og logoen, overskriften og de første feltene blir
   liggende under statusfeltet til tastaturet lukkes. Auto-marginer sentrerer
   likt, men gir aldri fra seg mer plass enn det som finnes. */
async function authSkjerm(label, viewport) {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport, hasTouch: true, isMobile: true });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(BASE + '/?mock=1');
  await p.waitForFunction(() => !!window.__huskis, null, { timeout: 10000, polling: 100 });
  await p.evaluate((sone) => {
    Object.keys(sone).forEach((k) => document.documentElement.style.setProperty('--safe-' + k, sone[k] + 'px'));
  }, SONE);
  await p.getByText('Registrer deg').click();
  await p.locator('#auth-first-name').waitFor({ state: 'visible' });
  // Tastaturet er den samme krympingen som i punkt 7 — her bare så kraftig at
  // skjemaet garantert er høyere enn det som er igjen.
  await p.setViewportSize({ width: viewport.width, height: 420 });
  await p.waitForTimeout(300);
  const m = await p.evaluate(() => {
    const skjerm = document.querySelector('.auth-screen');
    skjerm.scrollTop = 0;
    const boks = document.querySelector('.auth-box').getBoundingClientRect();
    return { top: boks.top, høyde: boks.height, vh: window.innerHeight,
      rullbart: skjerm.scrollHeight > skjerm.clientHeight };
  });
  log(label + ': skjemaet er høyere enn skjermen (forutsetningen for sjekken)',
    m.høyde > m.vh - SONE.top - SONE.bottom, 'boks ' + Math.round(m.høyde) + ' av ' + m.vh);
  log(label + ': innloggingsboksen klippes ikke over den sikre sonen',
    m.top >= SONE.top - 1,
    'boks topp ' + Math.round(m.top) + ', sone topp ' + SONE.top + ', rullbar ' + m.rullbart);
  log(label + ': ingen JS-feil', errs.length === 0, errs.join(' | ') || 'ingen');
  await b.close();
}

(async () => {
  // Sonen er ren layout, og layout treffer begge viewportene: modalene er
  // sentrerte ark på mobil og popovere/paneler på desktop.
  await run('desktop', { width: 1200, height: 900 }, false);
  await run('mobil', { width: 390, height: 780 }, true);
  await authSkjerm('auth', { width: 390, height: 780 });

  const fail = results.filter((r) => !r).length;
  console.log('\n==== ' + (results.length - fail) + '/' + results.length + ' PASS ====');
  process.exit(fail === 0 ? 0 : 1);
})();
