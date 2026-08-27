/*
  Regresjonstest: SLETT VED Å DRA OBJEKTET I SØPPELKASSEN.

  Søppelkassen for nivået man drar på vises fram i det draget starter (den er
  ellers skjult når den er tom), lyser opp når man sikter på den, og sletter
  objektet ved slipp. Én slettemåte, samme motor og samme gest på desktop og
  mobil, for alle objekttypene som HAR en kasse. Testen dekker:

    1. Kassen er skjult i hvile og dukker opp under draget — på alle fire
       nivåene (liste, listepunkt, område, mappe).
    2. Sikting markerer kassen (`.drop-target`) og gjør det løftede objektet
       gjennomskinnelig; slipp legger objektet i kassen.
    3. Slippet SLETTER, det flytter ikke: objektet havner ikke i containeren
       kassen ligger i, og det får ingen ny posisjon.
    4. Slipp UTENFOR kassen sletter ingenting, og kassen forsvinner igjen.
    5. KATEGORIER har ingen kasse — de løses opp fra menyen, og et
       kategori-drag armer derfor ingenting.
    6. Uten slette-rett (frossen liste) armes ingen kasse i det hele tatt.
    7. Angre-toasten kommer, og kassen kan tømmes med hold-og-sveip etterpå.
    8. En kasse som draget avdekket er tom, og viser derfor ingen «0»-teller —
       både der knappen selv var skjult og der wrapperen rundt den var det.
    9. Kassen blir stående i synsfeltet etter slettingen, så den kan tømmes med
       én gang (nav-modalen scroller, og draget kollapser kortene underveis).
   10. Kassen slår EKSTRAHERINGEN: den ligger utenfor listas innholdssone, så
       raden er teknisk «utenfor alle lister» når man er framme ved den. Sikter
       man på kassen, lover ikke ny-liste-placeholderen noe, og et slipp i
       treffsonen sletter i stedet for å lage en ny liste.

  Kjør:
    python3 -m http.server 8000                     # fra repo-roten, i egen terminal
    NODE_PATH=$(npm root -g) node tests/dnd-trash.test.js
*/
const { chromium } = require('playwright');

const BASE = process.env.HUSKIS_URL || 'http://localhost:8000';
const results = [];
const log = (n, ok, x = '') => { results.push(ok); console.log((ok ? 'PASS' : 'FAIL') + ' — ' + n + (x ? '  [' + x + ']' : '')); };

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

// To områder; det aktive har to mapper, to lister, to listepunkter og én
// kategori med ett medlem — nok til at alle fire kassene kan nås.
async function seed(p) {
  await p.evaluate(() => {
    const H = window.__huskis, st = H.state;
    const mk = (o) => Object.assign({ ts: 1, org: 't', pos: 0, posTs: 1, posOrg: 't',
      trashed: false, _role: 'owner' }, o);
    st.universes.length = 0;
    const u = mk({ id: 'UNI', name: 'Hjemme', collapsed: false, groups: [] });
    const g = mk({ id: 'GRP', uni: 'UNI', name: 'Ukesplan', cat: null, isCat: false, collapsed: false, cards: [] });
    u.groups.push(g);
    u.groups.push(mk({ id: 'G2', uni: 'UNI', name: 'Jobb', cat: null, isCat: false, collapsed: false, cards: [], pos: 1 }));
    const c1 = mk({ id: 'L1', group: 'GRP', title: 'Handleliste', collapsed: false, items: [] });
    c1.items.push(mk({ id: 'I1', home: 'L1', text: 'Melk', cat: null, isCat: false }));
    c1.items.push(mk({ id: 'I2', home: 'L1', text: 'Brød', cat: null, isCat: false, pos: 1 }));
    c1.items.push(mk({ id: 'C1', home: 'L1', text: 'Frukt', cat: null, isCat: true, collapsed: false, pos: 2 }));
    c1.items.push(mk({ id: 'I3', home: 'L1', text: 'Eple', cat: 'C1', isCat: false, pos: 3 }));
    g.cards.push(c1);
    g.cards.push(mk({ id: 'L2', group: 'GRP', title: 'Huskeliste', collapsed: false, items: [], pos: 1 }));
    st.universes.push(u, mk({ id: 'UNI2', name: 'Jobbområde', collapsed: false, groups: [], pos: 1 }));
    st.activeUniverse = 'UNI'; st.activeGroup = 'GRP';
    H.render();
  });
  await p.waitForTimeout(350);
}

const hidden = (p, sel) => p.evaluate((s) => {
  const el = document.querySelector(s);
  return !el || !!el.closest('[hidden]') || el.hidden;
}, sel);

/* Løft objektet og før det til `targetSel`. Kassen MÅLES PÅ NYTT rett før
   innsiktingen: å avdekke den endrer containerens høyde (og nav-modalen er
   loddrett sentrert), så knappen kan ha flyttet seg siden draget startet.
   Returnerer tilstanden i det øyeblikket pekeren står på målet. */
async function dragOnto(p, fromSel, targetSel, opts = {}) {
  const b = await p.locator(fromSel).boundingBox();
  const sx = b.x + Math.min(b.width / 2, 120);
  const sy = b.y + Math.min(b.height / 2, 16);
  await p.mouse.move(sx, sy);
  await p.mouse.down();
  await p.waitForTimeout(60);
  await p.mouse.move(sx + 12, sy + 12);   // forbi dra-terskelen → draget starter
  await p.waitForTimeout(100);
  const armed = await p.evaluate((s) => {
    const el = document.querySelector(s);
    const n = el && el.querySelector('.trashcan-count');
    return { finnes: !!el, synlig: !!el && !el.hidden && !el.closest('[hidden]'),
      armert: !!el && el.classList.contains('drag-trash'),
      tellerSkjult: !!n && getComputedStyle(n).display === 'none' };
  }, targetSel);
  let t = await p.locator(targetSel).boundingBox().catch(() => null);
  if (t) {
    for (let i = 1; i <= 10; i++) {
      await p.mouse.move(sx + (t.x + t.width / 2 - sx) * i / 10, sy + (t.y + t.height / 2 - sy) * i / 10);
      await p.waitForTimeout(25);
    }
    t = await p.locator(targetSel).boundingBox();
    for (let i = 0; i < 4; i++) { await p.mouse.move(t.x + t.width / 2, t.y + t.height / 2); await p.waitForTimeout(30); }
  }
  const aiming = await p.evaluate((s) => {
    const el = document.querySelector(s);
    return { sikter: !!el && el.classList.contains('drop-target'),
      gjennomskinnelig: !!document.querySelector('[data-dnd-dragging].to-trash') };
  }, targetSel);
  if (opts.shot) await p.screenshot({ path: opts.shot });
  if (opts.abortAway) {
    // Slipp langt unna kassen i stedet — ingenting skal slettes.
    await p.mouse.move(t.x + t.width / 2, t.y - 220);
    await p.waitForTimeout(80);
  }
  await p.mouse.up();
  await p.waitForTimeout(800);
  return { armed, aiming };
}

async function run(label, viewport) {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport });
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await register(p);
  await seed(p);

  /* ---------- 1+2+3) Listepunkt → kortets kasse ---------- */
  log(label + ' 1: element-kassen er skjult i hvile',
    await hidden(p, '.card[data-id="L1"] .item-trash-btn'));
  const it = await dragOnto(p, '.item[data-id="I1"]', '.card[data-id="L1"] .item-trash-btn');
  log(label + ' 1: kassen dukket opp og ble armert under draget',
    it.armed.synlig === true && it.armed.armert === true, JSON.stringify(it.armed));
  log(label + ' 8: den avdekkede element-kassen viser ingen «0»-teller',
    it.armed.tellerSkjult === true, JSON.stringify(it.armed));
  log(label + ' 2: sikting markerer kassen og gjør objektet gjennomskinnelig',
    it.aiming.sikter === true && it.aiming.gjennomskinnelig === true, JSON.stringify(it.aiming));
  const afterItem = await p.evaluate(() => {
    const c = window.__huskis.state.universes[0].groups[0].cards.find((x) => x.id === 'L1');
    const o = c.items.find((x) => x.id === 'I1');
    return {
      iKassen: !!(o && (o.trashed || o._pendingDelete)),
      iDom: !!document.querySelector('.item[data-id="I1"]'),
      iKategori: !!(o && o.cat),               // slippet skal ikke ha FLYTTET den
      kasseSynlig: !document.querySelector('.card[data-id="L1"] .item-trash').hidden,
      toast: (document.querySelector('.toast') || {}).textContent || '',
    };
  });
  log(label + ' 2: slippet la listepunktet i kassen',
    afterItem.iKassen === true && afterItem.iDom === false && afterItem.kasseSynlig === true,
    JSON.stringify(afterItem));
  log(label + ' 3: slippet SLETTET — det flyttet ikke raden inn i noe annet',
    afterItem.iKategori === false);
  log(label + ' 7: angre-toasten kom', /ngre|søppel/i.test(afterItem.toast), afterItem.toast);

  /* ---------- 4) Slipp utenfor kassen sletter ingenting ---------- */
  await dragOnto(p, '.item[data-id="I2"]', '.card[data-id="L1"] .item-trash-btn', { abortAway: true });
  const spared = await p.evaluate(() => {
    const c = window.__huskis.state.universes[0].groups[0].cards.find((x) => x.id === 'L1');
    const o = c.items.find((x) => x.id === 'I2');
    return { lever: !!(o && !o.trashed && !o._pendingDelete),
      kasseArmert: !!document.querySelector('.trashcan.drag-trash') };
  });
  log(label + ' 4: slipp utenfor kassen sletter ingenting, og markeringen ryddes',
    spared.lever === true && spared.kasseArmert === false, JSON.stringify(spared));

  /* ---------- 5) Kategorier har ingen kasse ---------- */
  const catBox = await p.locator('.category[data-id="C1"] > .cat-head').boundingBox();
  await p.mouse.move(catBox.x + 60, catBox.y + 14);
  await p.mouse.down(); await p.waitForTimeout(60);
  await p.mouse.move(catBox.x + 74, catBox.y + 30); await p.waitForTimeout(120);
  const catArmed = await p.evaluate(() => document.querySelectorAll('.trashcan.drag-trash').length);
  await p.mouse.up(); await p.waitForTimeout(500);
  log(label + ' 5: et kategori-drag armer ingen kasse (kategorier løses opp, slettes ikke)',
    catArmed === 0, 'armerte kasser=' + catArmed);

  /* ---------- 1+2) Liste → toppmenyens kasse ---------- */
  const card = await dragOnto(p, '.card[data-id="L2"] .card-head', '#trash-btn');
  log(label + ' 1: liste-kassen i toppmenyen dukket opp under draget',
    card.armed.synlig === true && card.armed.armert === true, JSON.stringify(card.armed));
  log(label + ' 8: den avdekkede liste-kassen viser ingen «0»-teller',
    card.armed.tellerSkjult === true, JSON.stringify(card.armed));
  const afterCard = await p.evaluate(() => {
    const g = window.__huskis.state.universes[0].groups[0];
    const c = g.cards.find((x) => x.id === 'L2');
    return { iKassen: !!(c && (c.trashed || c._pendingDelete)),
      iDom: !!document.querySelector('.card[data-id="L2"]'),
      kasseSynlig: !document.getElementById('trash-btn').hidden };
  });
  log(label + ' 2: slippet la lista i kassen',
    afterCard.iKassen === true && afterCard.iDom === false && afterCard.kasseSynlig === true,
    JSON.stringify(afterCard));

  /* ---------- 7) Kassen tømmes med hold-og-sveip etterpå ---------- */
  const tb = await p.locator('#trash-btn').boundingBox();
  await p.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2);
  await p.mouse.down();
  await p.waitForTimeout(450);            // FAST: gest-fysikk (HOLD_EXPAND_MS)
  for (let i = 1; i <= 20; i++) {
    await p.mouse.move(tb.x + tb.width / 2 + i * 14, tb.y + tb.height / 2);
    await p.waitForTimeout(15);
  }
  await p.mouse.up();
  await p.waitForTimeout(700);
  log(label + ' 7: den samme kassen tømmes permanent med hold-og-sveip',
    await p.evaluate(() => !window.__huskis.state.universes[0].groups[0]
      .cards.some((x) => x.id === 'L2')));

  /* ---------- 1+2) Mappe og område i nav-modalen ---------- */
  await p.evaluate(() => window.__huskis.openNavModal());
  await p.waitForTimeout(400);
  log(label + ' 1: mappe-kassen er skjult i hvile',
    await hidden(p, '#nav-board .card[data-id="UNI"] .group-trash-btn'));
  const grp = await dragOnto(p, '#nav-board .item[data-id="G2"]',
    '#nav-board .card[data-id="UNI"] .group-trash-btn');
  log(label + ' 1: mappe-kassen dukket opp i områdekortet under draget',
    grp.armed.synlig === true && grp.armed.armert === true, JSON.stringify(grp.armed));
  log(label + ' 8: den avdekkede mappe-kassen viser ingen «0»-teller',
    grp.armed.tellerSkjult === true, JSON.stringify(grp.armed));
  log(label + ' 2: mappa havnet i kassen',
    await p.evaluate(() => {
      const u = window.__huskis.state.universes.find((x) => x.id === 'UNI');
      const g = u.groups.find((x) => x.id === 'G2');
      return !!(g && (g.trashed || g._pendingDelete)) &&
        !document.querySelector('#nav-board .item[data-id="G2"]');
    }));

  const uni = await dragOnto(p, '#nav-board .card[data-id="UNI2"] .card-head', '#uni-trash-btn');
  log(label + ' 1: område-kassen nederst i modalen dukket opp under draget',
    uni.armed.synlig === true && uni.armed.armert === true, JSON.stringify(uni.armed));
  log(label + ' 8: den avdekkede område-kassen viser ingen «0»-teller',
    uni.armed.tellerSkjult === true, JSON.stringify(uni.armed));
  log(label + ' 2: området havnet i kassen',
    await p.evaluate(() => {
      const u = window.__huskis.state.universes.find((x) => x.id === 'UNI2');
      return !!(u && (u.trashed || u._pendingDelete)) &&
        !document.querySelector('#nav-board .card[data-id="UNI2"]');
    }));
  await p.keyboard.press('Escape'); await p.waitForTimeout(300);

  /* ---------- 6) Uten slette-rett armes ingen kasse ---------- */
  await p.evaluate(() => {
    const H = window.__huskis, u = H.state.universes[0], g = u.groups[0];
    // Frossen (låst for meg) mappe: verken lista eller listepunktene kan slettes.
    u._role = 'member'; g._parent = u;
    g.cards.forEach((c) => { c._parent = g; c.items.forEach((i) => { i._parent = c; }); });
    g._shared = true; g._role = 'member'; g._locked = true;
    g._caps = { editContent: false, leave: true, delete: false };
    H.render();
  });
  await p.waitForTimeout(350);
  const frozenBox = await p.locator('.item[data-id="I2"]').boundingBox();
  await p.mouse.move(frozenBox.x + 60, frozenBox.y + 16);
  await p.mouse.down(); await p.waitForTimeout(60);
  await p.mouse.move(frozenBox.x + 74, frozenBox.y + 32); await p.waitForTimeout(120);
  const frozenArmed = await p.evaluate(() => document.querySelectorAll('.trashcan.drag-trash').length);
  await p.mouse.up(); await p.waitForTimeout(400);
  log(label + ' 6: en frossen liste armer ingen kasse (serveren ville avvist slettingen)',
    frozenArmed === 0, 'armerte kasser=' + frozenArmed);

  /* ---------- 9) Kassen blir stående i synsfeltet etter slettingen ----------
     Nok områder til at nav-modalen scroller. Står man NEDERST (der kassen er)
     og drar det siste området i den, skal man fortsatt se kassen etterpå —
     ellers må man scrolle ned igjen for å tømme den. */
  await p.evaluate(() => {
    const H = window.__huskis, st = H.state;
    st.universes = Array.from({ length: 12 }, (_, i) => ({
      id: 'S' + i, name: 'Område ' + i, pos: i, posTs: 0, posOrg: 't',
      ts: 0, org: 't', groups: [], trashed: false, _role: 'owner',
    }));
    st.activeUniverse = 'S0';
    H.render();
    H.openNavModal();
  });
  await p.waitForTimeout(400);
  await p.evaluate(() => { const b = document.getElementById('nav-modal-body'); b.scrollTop = b.scrollHeight; });
  await p.waitForTimeout(200);
  await dragOnto(p, '#nav-board .card[data-id="S11"] .card-head', '#uni-trash-btn');
  const kasseSyn = await p.evaluate(() => {
    const b = document.getElementById('nav-modal-body'), t = document.getElementById('uni-trash-btn');
    if (!b || !t || t.hidden) return { synlig: false, grunn: 'kassen mangler/er skjult' };
    const r = t.getBoundingClientRect(), br = b.getBoundingClientRect();
    return { synlig: r.top >= br.top - 1 && r.bottom <= br.bottom + 1,
      topp: Math.round(r.top), bunn: Math.round(r.bottom), boks: Math.round(br.bottom) };
  });
  log(label + ' 9: område-kassen er fortsatt synlig etter slette-DnD-en',
    kasseSyn.synlig === true, JSON.stringify(kasseSyn));
  await p.keyboard.press('Escape'); await p.waitForTimeout(250);

  log(label + ': ingen JS-feil', errs.length === 0, errs.join(' | '));
  await p.close();
  await b.close();
}

/* Kassen slår EKSTRAHERINGEN, ikke omvendt.

   Egen økt, fordi den handler om det FØRSTE draget mot kassen i en urørt liste:
   de andre sjekkene har alt slettet rader, og en liste som har krympet stiller
   kassen et annet sted i forhold til innholdssonen. */
async function runTrashVsExtract(label, viewport) {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport });
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await register(p);
  // Egen, kort seed: ÉN liste med to rader. Kassen skal ligge godt innenfor
  // skjermen på mobil også — auto-scroll midt i gesten ville flyttet knappen
  // under pekeren, og da måler testen rulling, ikke regelen.
  await p.evaluate(() => {
    const H = window.__huskis, st = H.state;
    const mk = (o) => Object.assign({ ts: 1, org: 't', pos: 0, posTs: 1, posOrg: 't',
      trashed: false, _role: 'owner' }, o);
    st.universes.length = 0;
    const u = mk({ id: 'UNI', name: 'Hjemme', collapsed: false, groups: [] });
    const g = mk({ id: 'GRP', uni: 'UNI', name: 'Ukesplan', cat: null, isCat: false, collapsed: false, cards: [] });
    u.groups.push(g);
    const c1 = mk({ id: 'L1', group: 'GRP', title: 'Handleliste', collapsed: false, items: [] });
    c1.items.push(mk({ id: 'I1', home: 'L1', text: 'Melk', cat: null, isCat: false }));
    c1.items.push(mk({ id: 'I2', home: 'L1', text: 'Brød', cat: null, isCat: false, pos: 1 }));
    g.cards.push(c1);
    st.universes.push(u);
    st.activeUniverse = 'UNI'; st.activeGroup = 'GRP';
    H.render();
  });
  await p.waitForTimeout(350);

  const cardsBefore = await p.evaluate(() =>
    window.__huskis.state.universes[0].groups[0].cards.filter((c) => !c.trashed).length);
  const src = await p.locator('.item[data-id="I2"]').boundingBox();
  const sx = src.x + Math.min(src.width / 2, 120), sy = src.y + src.height / 2;
  await p.mouse.move(sx, sy);
  await p.mouse.down(); await p.waitForTimeout(60);
  await p.mouse.move(sx + 12, sy + 12); await p.waitForTimeout(120);
  let t = await p.locator('.card[data-id="L1"] .item-trash-btn').boundingBox();
  for (let i = 1; i <= 10; i++) {
    await p.mouse.move(sx + (t.x + t.width / 2 - sx) * i / 10, sy + (t.y + t.height / 2 - sy) * i / 10);
    await p.waitForTimeout(30);
  }
  t = await p.locator('.card[data-id="L1"] .item-trash-btn').boundingBox();
  for (let i = 0; i < 3; i++) { await p.mouse.move(t.x + t.width / 2, t.y + t.height / 2); await p.waitForTimeout(40); }
  const state = () => p.evaluate(() => {
    const ph = document.querySelector('.new-list-placeholder');
    return { lover: !!ph && getComputedStyle(ph).visibility !== 'hidden',
      siktet: !!document.querySelector('.card[data-id="L1"] .item-trash-btn.drop-target') };
  });
  const paaKassen = await state();
  log(label + ' 10: kassen lover ingen ny liste mens man sikter på den',
    paaKassen.lover === false && paaKassen.siktet === true, JSON.stringify(paaKassen));

  // Rett under knappen: innenfor treffsonen, utenfor selve knappen — der en
  // finger faktisk lander.
  t = await p.locator('.card[data-id="L1"] .item-trash-btn').boundingBox();
  for (let i = 0; i < 3; i++) { await p.mouse.move(t.x + t.width / 2, t.y + t.height + 9); await p.waitForTimeout(40); }
  const iRingen = await state();
  log(label + ' 10: ringen rundt knappen lover heller ingen ny liste',
    iRingen.lover === false && iRingen.siktet === true, JSON.stringify(iRingen));

  await p.mouse.up(); await p.waitForTimeout(800);
  const etter = await p.evaluate(() => {
    const g = window.__huskis.state.universes[0].groups[0];
    const o = g.cards.flatMap((c) => c.items || []).find((x) => x.id === 'I2');
    return { slettet: !!(o && (o.trashed || o._pendingDelete)),
      kort: g.cards.filter((c) => !c.trashed).length };
  });
  log(label + ' 10: slipp i ringen SLETTER — det lager ingen ny liste',
    etter.slettet === true && etter.kort === cardsBefore,
    JSON.stringify(Object.assign({ kortFoer: cardsBefore }, etter)));
  log(label + ' 10: ingen JS-feil', errs.length === 0, errs.join(' | '));
  await p.close();
  await b.close();
}

(async () => {
  await run('desktop', { width: 1280, height: 900 });
  await run('mobil', { width: 390, height: 780 });
  await runTrashVsExtract('desktop', { width: 1280, height: 900 });
  await runTrashVsExtract('mobil', { width: 390, height: 780 });
  const failed = results.filter((x) => !x).length;
  console.log('\n==== ' + (results.length - failed) + '/' + results.length + ' PASS ====');
  process.exit(failed ? 1 : 0);
})();
