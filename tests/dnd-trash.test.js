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
   11. Kassen i et KORT er radbred mens draget står på — den skal treffes med en
       finger, ikke med en musepeker — og treffer man ytterkanten av raden, er
       det fortsatt kassen man sikter på.
   12. Kassen FØLGER objektet: drar man en rad til en annen container, flytter
       kassen seg dit — én om gangen — og et slipp i den NYE verten sletter
       raden i dens EGEN container. Forlater raden alle containere, blir kassen
       stående; å skjule den ville krympet kortet og flyttet raden ut og inn av
       containeren én gang per frame.
   13. ETT MALT HULL OM GANGEN, og bare der raden faktisk lander. Sikter man på
       kassen, sletter slippet — da skal ingen plassholder love en plassering,
       heller ikke hullet raden kom fra, som kan ligge igjen i en HELT ANNEN
       liste enn den man sikter i. Rødvasken på det som dras og et malt hull
       utelukker hverandre, og males hullet i det hele tatt, ligger det i lista
       slippet faktisk lander i. Et hull i FEIL liste tar heller ingen plass
       der — den lista komprimeres — og kantene draget nærmer seg står likevel
       stille, så terskelen ikke flytter seg.

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
    const d = document.querySelector('[data-dnd-dragging]');
    const cs = d && getComputedStyle(d);
    // Rødvasken males som `background-image` OVER den halvgjennomsiktige flaten.
    // «Her slettes det» kan IKKE uttrykkes med mer gjennomsikt: alt som dras er
    // allerede gjennomsiktig, og de to tilstandene ville lest likt. Derfor leser
    // vi fargen, og krever samtidig at objektet står i full styrke.
    const rgb = cs && /(\d+),\s*(\d+),\s*(\d+)/.exec(cs.backgroundImage);
    return { sikter: !!el && el.classList.contains('drop-target'),
      merket: !!document.querySelector('[data-dnd-dragging].to-trash'),
      vask: rgb ? rgb.slice(1, 4).map(Number) : null,
      opacity: cs ? cs.opacity : null };
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
  log(label + ' 2: sikting markerer kassen og gir objektet RØD bakgrunn',
    it.aiming.sikter === true && it.aiming.merket === true &&
    !!it.aiming.vask && it.aiming.vask[0] > it.aiming.vask[1] + 60 &&
    it.aiming.vask[0] > it.aiming.vask[2] + 60, JSON.stringify(it.aiming));
  log(label + ' 2: … og objektet toner IKKE ut — fargen bærer signalet alene',
    it.aiming.opacity === '1', JSON.stringify(it.aiming));
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

  /* ---------- 11) Kassen i kortet er RADBRED under draget ---------- */
  // Knappen er ~48 px i hvile — den forsvinner under en fingertupp, og på
  // berøring finnes ingen peker som viser hvor man egentlig sikter. Under et
  // drag strekker den seg over hele radbredden. Bare BREDDEN endres: høyden
  // står, altså står kortets boks, og ekstraher-terskelen (`cardBand` =
  // kortets egen kant) rører seg ikke.
  const bredde = await p.evaluate(() => {
    const btn = document.querySelector('.card[data-id="L1"] .item-trash-btn');
    const kort = document.querySelector('.card[data-id="L1"]');
    const r = btn.getBoundingClientRect(), kr = kort.getBoundingClientRect();
    return { kasse: Math.round(r.width), kort: Math.round(kr.width),
      innenfor: r.left >= kr.left && r.right <= kr.right };
  });
  log(label + ' 11: den armerte kassen er radbred (og holder seg innenfor kortet)',
    bredde.kasse >= bredde.kort - 24 && bredde.innenfor === true, JSON.stringify(bredde));

  // Ytterkanten av raden — målt fra KORTETS venstrekant, altså et punkt den
  // smale hvileknappen aldri nådde. Treffer man der, er det fortsatt kassen.
  t = await p.locator('.card[data-id="L1"] .item-trash-btn').boundingBox();
  const kortBoks = await p.locator('.card[data-id="L1"]').boundingBox();
  for (let i = 0; i < 3; i++) { await p.mouse.move(kortBoks.x + 24, t.y + t.height / 2); await p.waitForTimeout(40); }
  const iYtterkant = await state();
  log(label + ' 11: ytterkanten av kasseraden sikter på kassen',
    iYtterkant.siktet === true && iYtterkant.lover === false, JSON.stringify(iYtterkant));

  // Rett under knappen: innenfor treffsonen, utenfor selve knappen — der en
  // finger faktisk lander.
  t = await p.locator('.card[data-id="L1"] .item-trash-btn').boundingBox();
  for (let i = 0; i < 3; i++) { await p.mouse.move(t.x + t.width / 2, t.y + t.height + 9); await p.waitForTimeout(40); }
  const iRingen = await state();
  log(label + ' 10: ringen rundt knappen lover heller ingen ny liste',
    iRingen.lover === false && iRingen.siktet === true, JSON.stringify(iRingen));

  // Og markeringen slipper taket når man drar videre ned, forbi treffsonen.
  // Smetts `onDropTarget` fyrer bare når MÅLET endrer seg, og i ringen er målet
  // null hele tiden — uten at vi selv tar markeringen av, ble kassen stående som
  // om den var klar til å ta imot mens raden lå nede ved ny-liste-stripa.
  t = await p.locator('.card[data-id="L1"] .item-trash-btn').boundingBox();
  for (let i = 0; i < 3; i++) { await p.mouse.move(t.x + t.width / 2, t.y + t.height + 90); await p.waitForTimeout(40); }
  const langtUnder = await state();
  log(label + ' 10: markeringen slipper når man drar videre forbi kassen',
    langtUnder.siktet === false, JSON.stringify(langtUnder));

  // Tilbake i ringen for selve slippet.
  t = await p.locator('.card[data-id="L1"] .item-trash-btn').boundingBox();
  for (let i = 0; i < 3; i++) { await p.mouse.move(t.x + t.width / 2, t.y + t.height + 9); await p.waitForTimeout(40); }
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

/* ---------- 12) Kassen følger objektet mellom containere ---------- */
async function runTrashFollows(label, viewport) {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport });
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await register(p);
  // To lister med hvert sitt innhold, og korte nok til at begge kassene ligger
  // innenfor skjermen på mobil — auto-scroll midt i gesten ville flyttet
  // knappen under pekeren, og da måler testen rulling, ikke regelen.
  await p.evaluate(() => {
    const H = window.__huskis, st = H.state;
    const mk = (o) => Object.assign({ ts: 1, org: 't', pos: 0, posTs: 1, posOrg: 't',
      trashed: false, _role: 'owner' }, o);
    st.universes.length = 0;
    const u = mk({ id: 'UNI', name: 'Hjemme', collapsed: false, groups: [] });
    const g = mk({ id: 'GRP', uni: 'UNI', name: 'Ukesplan', cat: null, isCat: false, collapsed: false, cards: [] });
    u.groups.push(g);
    const a = mk({ id: 'L1', group: 'GRP', title: 'Liste A', collapsed: false, items: [] });
    a.items.push(mk({ id: 'A0', home: 'L1', text: 'Melk', cat: null, isCat: false }));
    a.items.push(mk({ id: 'A1', home: 'L1', text: 'Brød', cat: null, isCat: false, pos: 1 }));
    const c = mk({ id: 'L2', group: 'GRP', title: 'Liste B', collapsed: false, items: [], pos: 1 });
    c.items.push(mk({ id: 'B0', home: 'L2', text: 'Sykkel', cat: null, isCat: false }));
    g.cards.push(a, c);
    st.universes.push(u);
    st.activeUniverse = 'UNI'; st.activeGroup = 'GRP';
    H.render();
  });
  await p.waitForTimeout(350);

  // Hvilke kasser er armert, og i hvilke kort?
  const verter = () => p.evaluate(() => [...document.querySelectorAll('.trashcan.drag-trash')]
    .map((t) => { const c = t.closest('.card'); return c ? c.dataset.id : 'TOPP'; }));

  const src = await p.locator('.item[data-id="A1"]').boundingBox();
  const sx = src.x + Math.min(src.width / 2, 120), sy = src.y + src.height / 2;
  await p.mouse.move(sx, sy);
  await p.mouse.down(); await p.waitForTimeout(60);
  await p.mouse.move(sx + 12, sy + 12); await p.waitForTimeout(140);
  const vedLoft = await verter();
  log(label + ' 12: kassen står i lista raden ble løftet fra',
    vedLoft.length === 1 && vedLoft[0] === 'L1', JSON.stringify(vedLoft));

  // Inn i liste B.
  const mål = await p.locator('.item[data-id="B0"]').boundingBox();
  await p.mouse.move(mål.x + Math.min(mål.width / 2, 120), mål.y + mål.height / 2, { steps: 14 });
  await p.waitForTimeout(300);
  const overB = await verter();
  log(label + ' 12: kassen fulgte med til liste B — og bare ÉN er armert',
    overB.length === 1 && overB[0] === 'L2', JSON.stringify(overB));

  // Står raden i ro, skal kassen stå i ro. Nederst i kortet er prøven hardest:
  // der ligger raden nær kanten, og en kasse som ble skjult ville krympet
  // kortet og flyttet raden ut av det.
  const kort = await p.locator('.card[data-id="L2"]').boundingBox();
  await p.mouse.move(mål.x + Math.min(mål.width / 2, 120), kort.y + kort.height - 6, { steps: 8 });
  await p.waitForTimeout(200);
  const iRo = await p.evaluate(() => new Promise((res) => {
    const sett = new Set(); let n = 0;
    const tick = () => {
      sett.add([...document.querySelectorAll('.trashcan.drag-trash')]
        .map((t) => { const c = t.closest('.card'); return c ? c.dataset.id : 'TOPP'; }).join(','));
      if (++n < 60) requestAnimationFrame(tick); else res([...sett]);
    };
    requestAnimationFrame(tick);
  }));
  log(label + ' 12: kassen står i ro når pekeren gjør det (60 frames)',
    iRo.length === 1, JSON.stringify(iRo));

  // Slipp i B-ens kasse. Boksen måles PÅ NYTT etter reisen: kassen som dukket
  // opp i B gjorde kortet høyere.
  let t = await p.locator('.card[data-id="L2"] .item-trash-btn').boundingBox().catch(() => null);
  // Fulgte ikke kassen med, er B-ens kasse fortsatt skjult og har ingen boks.
  // Da er resten av blokken meningsløs — si fra og gå videre i stedet for å
  // kaste, så de andre viewportene fortsatt kjører.
  if (!t) {
    log(label + ' 12: den nye verten markeres, og raden blir rød', false, 'B-ens kasse er skjult');
    log(label + ' 12: slippet slettet raden i dens EGEN liste, og B er urørt', false, 'B-ens kasse er skjult');
    await p.mouse.up(); await p.waitForTimeout(400);
    log(label + ' 12: ingen JS-feil', errs.length === 0, errs.join(' | '));
    await p.close(); await b.close();
    return;
  }
  await p.mouse.move(t.x + t.width / 2, t.y + t.height / 2, { steps: 10 });
  await p.waitForTimeout(200);
  t = await p.locator('.card[data-id="L2"] .item-trash-btn').boundingBox();
  for (let i = 0; i < 4; i++) { await p.mouse.move(t.x + t.width / 2, t.y + t.height / 2); await p.waitForTimeout(40); }
  const siktet = await p.evaluate(() => ({
    kassen: !!document.querySelector('.card[data-id="L2"] .item-trash-btn.drop-target'),
    rød: !!document.querySelector('[data-dnd-dragging].to-trash'),
  }));
  log(label + ' 12: den nye verten markeres, og raden blir rød',
    siktet.kassen === true && siktet.rød === true, JSON.stringify(siktet));

  await p.mouse.up(); await p.waitForTimeout(900);
  const etter = await p.evaluate(() => {
    const g = window.__huskis.state.universes[0].groups[0];
    const it = g.cards.flatMap((c) => c.items).find((x) => x.id === 'A1');
    const lev = (id) => g.cards.find((c) => c.id === id).items
      .filter((x) => !x.trashed && !x._pendingDelete).map((x) => x.id);
    return { slettet: !!(it && (it.trashed || it._pendingDelete)),
      home: it && it.home, L1: lev('L1'), L2: lev('L2') };
  });
  // Slippet SLETTER, og raden havner i sin EGEN listes kasse — verten var bare
  // hvor knappen sto. Liste B skal være urørt.
  log(label + ' 12: slippet slettet raden i dens EGEN liste, og B er urørt',
    etter.slettet === true && etter.home === 'L1' &&
    etter.L1.join(',') === 'A0' && etter.L2.join(',') === 'B0', JSON.stringify(etter));
  log(label + ' 12: ingen JS-feil', errs.length === 0, errs.join(' | '));
  await p.close();
  await b.close();
}

/* ============ 13) Ett malt hull om gangen ============
   dnd-kits sortering flytter hullet bare ved å bytte med en RAD, så drar man en
   rad ned i lista under og deretter opp til KASSEN i lista over, blir hullet
   liggende igjen i lista under: kassen ligger utenfor radene, og det er ingen
   rad å bytte med på veien tilbake. Da lover to ting hver sin plassering
   samtidig — hullet sier «her lander raden», kassen sier «her slettes den» — og
   bare den ene er sann. Hullet males derfor ikke mens man sikter på kassen. */
async function runEttHull(label, viewport) {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport });
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await register(p);
  // Samme to-liste-oppsett som sjekk 12, men liste B beholder en rad etter
  // flyttingen, så den ikke bytter til tom-tilstand midt i målingen.
  await p.evaluate(() => {
    const H = window.__huskis, st = H.state;
    const mk = (o) => Object.assign({ ts: 1, org: 't', pos: 0, posTs: 1, posOrg: 't',
      trashed: false, _role: 'owner' }, o);
    st.universes.length = 0;
    const u = mk({ id: 'UNI', name: 'Hjemme', collapsed: false, groups: [] });
    const g = mk({ id: 'GRP', uni: 'UNI', name: 'Ukesplan', cat: null, isCat: false, collapsed: false, cards: [] });
    u.groups.push(g);
    const a = mk({ id: 'L1', group: 'GRP', title: 'Liste A', collapsed: false, items: [] });
    a.items.push(mk({ id: 'A0', home: 'L1', text: 'Melk', cat: null, isCat: false }));
    a.items.push(mk({ id: 'A1', home: 'L1', text: 'Brød', cat: null, isCat: false, pos: 1 }));
    const c = mk({ id: 'L2', group: 'GRP', title: 'Liste B', collapsed: false, items: [], pos: 1 });
    c.items.push(mk({ id: 'B0', home: 'L2', text: 'Sykkel', cat: null, isCat: false }));
    c.items.push(mk({ id: 'B1', home: 'L2', text: 'Sko', cat: null, isCat: false, pos: 1 }));
    g.cards.push(a, c);
    st.universes.push(u);
    st.activeUniverse = 'UNI'; st.activeGroup = 'GRP';
    H.render();
  });
  await p.waitForTimeout(350);

  // Hva LOVER layouten akkurat nå? Et hull teller bare når det faktisk males.
  const lovnader = () => p.evaluate(() => {
    const malt = (el) => {
      if (!el) return false;
      const cs = getComputedStyle(el);
      return cs.visibility === 'visible' && cs.display !== 'none' &&
        el.getBoundingClientRect().height > 0;
    };
    const klone = document.querySelector('[data-dnd-placeholder]');
    const kant = (id, side) => { const c = document.querySelector('.card[data-id="' + id + '"]');
      return c ? +c.getBoundingClientRect()[side].toFixed(1) : null; };
    return {
      hull: malt(klone),
      /* Plassen hullet tar i LISTA. Klonens egen boks står urørt — den er
         dra-objektets geometri — så det som måles er containeren den ligger i:
         lover hullet ingenting, skal raden og gapet være borte derfra. */
      hullH: klone ? +klone.getBoundingClientRect().height.toFixed(0) : null,
      listeH: klone && klone.parentNode
        ? +klone.parentNode.getBoundingClientRect().height.toFixed(0) : null,
      hullIKort: klone && klone.closest('.card') ? klone.closest('.card').dataset.id : null,
      stripe: malt(document.querySelector('.new-list-placeholder')),
      rød: !!document.querySelector('[data-dnd-dragging].to-trash'),
      vert: (document.querySelector('.trashcan.drag-trash') || {}).closest
        ? (document.querySelector('.trashcan.drag-trash').closest('.card') || {}).dataset?.id || 'TOPP' : null,
      // Kantene draget nærmer seg: L1 møtes NEDENFRA (underkanten er terskelen),
      // L2 forlates OPPOVER (overkanten). Begge skal stå stille.
      L1bunn: kant('L1', 'bottom'), L2topp: kant('L2', 'top'),
    };
  });

  const src = await p.locator('.item[data-id="A1"]').boundingBox();
  const sx = src.x + Math.min(src.width / 2, 120), sy = src.y + src.height / 2;
  await p.mouse.move(sx, sy);
  await p.mouse.down(); await p.waitForTimeout(60);
  await p.mouse.move(sx + 12, sy + 12); await p.waitForTimeout(160);

  // Ned i liste B, så dnd-kit flytter hullet dit …
  const b0 = await p.locator('.item[data-id="B0"]').boundingBox();
  const yNed = b0.y + b0.height / 2 + 10;
  await p.mouse.move(sx, yNed, { steps: 14 });
  await p.waitForTimeout(300);
  const iB = await lovnader();

  /* … og så OPP igjen, steg for steg, helt fram til kassen i liste A. Hullet
     blir liggende i B hele veien: sorteringen flytter det bare ved å bytte med
     en RAD, og over ＋-raden finnes det ingen. */
  const a0 = await p.locator('.item[data-id="A0"]').boundingBox();
  const kasse0 = await p.locator('.card[data-id="L1"] .item-trash-btn').boundingBox()
    .catch(() => null);
  const yOpp = (kasse0 ? kasse0.y + kasse0.height / 2 : a0.y + a0.height / 2);
  const prøver = [];
  for (let i = 1; i <= 16; i++) {
    await p.mouse.move(sx, yNed + (yOpp - yNed) * i / 16, { steps: 2 });
    await p.waitForTimeout(70);
    prøver.push(await lovnader());
  }
  const iA = prøver[prøver.length - 1];
  log(label + ' 13: fiksturet stemmer — hullet lå igjen i den ANDRE lista',
    iB.hullIKort === 'L2' && prøver.some((s) => s.hullIKort === 'L2' && s.vert === 'L1'),
    JSON.stringify({ iB: iB.hullIKort, spor: prøver.map((s) => s.hullIKort + '/' + s.vert).join(' ') }));

  // Boksen måles på nytt: kasseraden kan ha flyttet seg mens vi gikk.
  const kasse = await p.locator('.card[data-id="L1"] .item-trash-btn').boundingBox();
  for (let i = 0; i < 4; i++) {
    await p.mouse.move(kasse.x + kasse.width / 2, kasse.y + kasse.height / 2);
    await p.waitForTimeout(60);
  }
  const påKassen = await lovnader();
  prøver.push(påKassen);

  const begge = prøver.filter((s) => s.rød && s.hull);
  log(label + ' 13: rødvask og malt hull opptrer aldri samtidig (' + prøver.length + ' prøver)',
    begge.length === 0, JSON.stringify(begge.slice(0, 2)));
  // Og males hullet i det hele tatt, ligger det i lista slippet lander i —
  // den samme lista kassen står i (`dragOverCard` svarer begge).
  const feilListe = prøver.filter((s) => s.hull && s.vert && s.hullIKort !== s.vert);
  log(label + ' 13: et malt hull ligger alltid i lista raden faktisk lander i',
    feilListe.length === 0, JSON.stringify(feilListe.slice(0, 2)));
  log(label + ' 13: på kassen males verken hullet eller ny-liste-stripa',
    påKassen.rød === true && påKassen.hull === false && påKassen.stripe === false,
    JSON.stringify(påKassen));
  /* Og et hull som ligger i FEIL liste tar heller ingen plass der: den lista har
     ingen grunn til å stå med en åpen rad. Måles på CONTAINEREN — klonens egen
     boks er dra-objektets geometri og skal stå urørt.

     Ligger hullet i lista slippet gjelder (samme kort som kassen), beholder det
     plassen: der er kortets boks samtidig ekstraher-linja og kassens plass. */
  const iFeil = [...new Set(prøver.filter((s) => s.hullIKort !== s.vert).map((s) => s.listeH))];
  const iEgen = [...new Set(prøver.filter((s) => s.hullIKort === s.vert).map((s) => s.listeH))];
  log(label + ' 13: et hull i feil liste tar heller ingen plass der',
    iFeil.length === 1 && iEgen.length === 1 && iEgen[0] - iFeil[0] >= 40,
    JSON.stringify({ iFeil, iEgen, klonH: [...new Set(prøver.map((s) => s.hullH))] }));
  /* Kortene krymper med en radhøyde når hullet lukkes — men kantene draget
     NÆRMER SEG står stille: kompensasjonen er en `margin-top` på kortet selv, så
     underkanten (og dermed terskelen) er urørt, og kortet man forlater slipper
     plassen nedover, bort fra fingeren. */
  const l1 = [...new Set(prøver.map((s) => s.L1bunn))];
  const l2 = [...new Set(prøver.map((s) => s.L2topp))];
  log(label + ' 13: kantene draget nærmer seg står stille gjennom hele turen',
    l1.length === 1 && l2.length === 1, JSON.stringify({ 'L1-bunn': l1, 'L2-topp': l2 }));

  // Og slippet betyr fortsatt det samme: raden slettes i sin EGEN liste.
  await p.mouse.up(); await p.waitForTimeout(900);
  const etter = await p.evaluate(() => {
    const g = window.__huskis.state.universes[0].groups[0];
    const it = g.cards.flatMap((c) => c.items).find((x) => x.id === 'A1');
    const lev = (id) => g.cards.find((c) => c.id === id).items
      .filter((x) => !x.trashed && !x._pendingDelete).map((x) => x.id);
    return { slettet: !!(it && (it.trashed || it._pendingDelete)),
      home: it && it.home, L1: lev('L1'), L2: lev('L2') };
  });
  log(label + ' 13: slippet sletter fortsatt i radens EGEN liste',
    etter.slettet === true && etter.home === 'L1' &&
    etter.L1.join(',') === 'A0' && etter.L2.join(',') === 'B0,B1', JSON.stringify(etter));
  log(label + ' 13: ingen JS-feil', errs.length === 0, errs.join(' | '));
  await p.close();
  await b.close();
}

(async () => {
  await run('desktop', { width: 1280, height: 900 });
  await run('mobil', { width: 390, height: 780 });
  await runTrashVsExtract('desktop', { width: 1280, height: 900 });
  await runTrashVsExtract('mobil', { width: 390, height: 780 });
  await runTrashFollows('desktop', { width: 1280, height: 900 });
  await runTrashFollows('mobil', { width: 390, height: 780 });
  await runEttHull('desktop', { width: 1280, height: 900 });
  await runEttHull('mobil', { width: 390, height: 780 });
  const failed = results.filter((x) => !x).length;
  console.log('\n==== ' + (results.length - failed) + '/' + results.length + ' PASS ====');
  process.exit(failed ? 1 : 0);
})();
