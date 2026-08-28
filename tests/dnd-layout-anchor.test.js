/*
  Regresjonstest: DRA-ANKERET — layouten flytter seg BORT fra siktet.

  Mens en rad dras, kommer og går kasseraden i kortene: den står i den
  containeren objektet er i NÅ, og forsvinner fra den det forlot. I normal flyt
  absorberes hver slik endring nedover — alt under den flytter seg — og da
  smetter det man sikter på unna fingeren i samme øyeblikk som det ble laget.

  Ankeret holder den nærmeste faste kanten på eller under siktet i ro og lar
  board-et gjøre jobben OVER den: `padding-top` skyver innholdet ned, og skal det
  opp, scroller vi i stedet (og lager rommet først, så scrollen ikke klemmes).

  Testen dekker:

    1. Kassen bytter vert på det SAMME svaret som plasseringen bruker
       (`dragOverCard`: objektets midtre 1/3 innenfor kortet) — altså FØR raden
       svever over radene i den nye lista, som er der DOM-forelderen skifter.
    2. Kasseraden i lista man forlot forsvinner HELT. Den holder ingen plass.
    3. Nedover: kortet man kommer inn i står stille, og kortet man forlot
       beholder underkanten sin — det er ekstraher-terskelen. Rommet legger seg
       over lista i stedet (`padding-top`).
    4. Hullet som forlater lista OVER siktet settes også av: kortet man svever
       over rykker ikke oppover når raden bytter liste.
    5. Oppover: kassen som opprettes i lista over kommer MOT fingeren — siktet
       havner INNI den nye kasseraden — kortet under står stille, og
       scrollområdet vokser like mye som board-toppen flyttet seg, så toppen er
       fortsatt å nå.
    6. Ingen drift: fram og tilbake fire ganger gir en stabil syklus, ikke et
       board som vandrer.
    7. Ved slipp er alt ryddet: ingen padding, ingen hevet min-høyde, og
       scrollen tilbake der den var.

  Kjør:
    python3 -m http.server 8000                     # fra repo-roten, i egen terminal
    NODE_PATH=$(npm root -g) node tests/dnd-layout-anchor.test.js
*/
const { chromium } = require('playwright');

const BASE = process.env.HUSKIS_URL || 'http://localhost:8000';
const results = [];
const log = (n, ok, x = '') => { results.push(ok); console.log((ok ? 'PASS' : 'FAIL') + ' — ' + n + (x ? '  [' + x + ']' : '')); };
const nær = (a, b, slark = 1.5) => Math.abs(a - b) <= slark;

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
  await p.waitForTimeout(1200);
  // Demoen legger et overlegg over board-et; et drag under det er ikke et drag.
  await p.evaluate(() => { try { window.__huskis.tour.skipAll(); } catch (e) { /* alt sett */ } });
  await p.waitForTimeout(250);
}

/* To lister i ÉN kolonne, over hverandre: hele poenget er den loddrette
   rekkefølgen. Liste B har to rader, så den ikke blir tom og bytter til
   tom-tilstanden midt i målingen. */
async function seed(p) {
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
  await p.waitForTimeout(400);
}

// Alt målingen trenger, i ett oppslag.
const snap = (p) => p.evaluate(() => {
  const q = (s) => document.querySelector(s);
  const boks = (el) => { if (!el) return null; const r = el.getBoundingClientRect();
    return { top: +r.top.toFixed(1), bottom: +r.bottom.toFixed(1), h: +r.height.toFixed(1) }; };
  const dratt = q('[data-dnd-dragging]');
  const d = dratt ? dratt.getBoundingClientRect() : null;
  return {
    y: window.scrollY,
    maks: Math.max(0, document.documentElement.scrollHeight - window.innerHeight),
    pad: parseFloat(getComputedStyle(q('.board')).paddingTop) || 0,
    minH: q('.board').style.minHeight,
    L1: boks(q('.card[data-id="L1"]')), L2: boks(q('.card[data-id="L2"]')),
    L1kasse: boks(q('.card[data-id="L1"] .item-trash')),
    L2kasse: boks(q('.card[data-id="L2"] .item-trash')),
    // Siktelinjen ankeret regner med: objektets eget senter.
    sikte: d ? +(d.top + d.height / 2).toFixed(1) : null,
    // Kortet raden ligger i som DOM-node — dnd-kits sortering, som skifter
    // først når objektet svever over RADENE i den nye lista.
    domVert: dratt ? (dratt.closest('.card') ? dratt.closest('.card').dataset.id : 'LUFT') : null,
    armert: [...document.querySelectorAll('.trashcan.drag-trash')]
      .map((t) => { const c = t.closest('.card'); return c ? c.dataset.id : 'TOPP'; }),
    // Mangler hooken (et bygg uten ankeret), er `on` usann og sjekkene under sier fra.
    anker: window.__huskis.dragAnchor || { on: false, pad: 0, floor: 0, scroll: 0 },
  };
});

const løft = async (p, id) => {
  const r = await p.locator('.item[data-id="' + id + '"]').boundingBox();
  const x = r.x + Math.min(r.width / 2, 120), y = r.y + r.height / 2;
  await p.mouse.move(x, y);
  await p.mouse.down(); await p.waitForTimeout(60);
  await p.mouse.move(x + 10, y + 10); await p.waitForTimeout(200);
  return { x, y };
};
const dra = async (p, x, y, steg = 3) => { await p.mouse.move(x, y, { steps: steg }); await p.waitForTimeout(70); };

/* ============ Nedover: A1 fra liste A til liste B ============ */
async function nedover(label, viewport) {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await register(p); await seed(p);

  const { x, y } = await løft(p, 'A1');
  const start = await snap(p);

  // Steg nedover til kassen har byttet vert, og hold på det siste bildet FØR
  // byttet: det er referansen alt måles mot.
  let før = start, etter = null;
  for (let dy = 12; dy <= 320 && !etter; dy += 8) {
    await dra(p, x, y + dy);
    const s = await snap(p);
    if (s.armert.join() === 'L2') etter = s; else før = s;
  }
  if (!etter) {
    log(label + ' 1: kassen bytter vert på plasseringens eget svar', false, 'byttet aldri vert');
    await p.close(); await b.close(); return;
  }

  // 1) Byttet skjer FØR dnd-kit flytter raden inn blant radene i liste B.
  log(label + ' 1: kassen bytter vert før raden svever over radene i den nye lista',
    etter.armert.join() === 'L2' && etter.domVert === 'L1',
    JSON.stringify({ armert: etter.armert, domVert: etter.domVert, sikte: etter.sikte, L2topp: etter.L2.top }));

  // 2) Kasseraden i lista man forlot forsvinner HELT (uten fiksen: h = 49).
  log(label + ' 2: kasseraden i lista man forlot holder ingen plass',
    før.L1kasse.h > 20 && etter.L1kasse.h === 0,
    JSON.stringify({ før: før.L1kasse.h, etter: etter.L1kasse.h }));

  // 3) Kortet man kommer inn i står stille, og kortet man forlot beholder
  //    underkanten sin — den er ekstraher-terskelen.
  log(label + ' 3: kortet man kommer inn i står stille gjennom byttet',
    nær(etter.L2.top, før.L2.top),
    JSON.stringify({ før: før.L2.top, etter: etter.L2.top }));
  log(label + ' 3: kortet man forlot beholder underkanten sin (terskelen)',
    nær(etter.L1.bottom, før.L1.bottom),
    JSON.stringify({ før: før.L1.bottom, etter: etter.L1.bottom }));
  // … og rommet la seg OVER lista i stedet (uten fiksen: pad = 0).
  const kasse = før.L1kasse.h;
  log(label + ' 3: rommet kasseraden ga fra seg la seg over lista',
    etter.pad - før.pad > kasse - 2 && etter.pad - før.pad < kasse + 14,
    JSON.stringify({ pad: etter.pad - før.pad, kasserad: kasse }));

  // 4) Hullet som forlater liste A (over siktet) settes også av: fortsett
  //    nedover til dnd-kit har flyttet raden inn i liste B.
  let inne = null;
  for (let dy = 320; dy <= 520 && !inne; dy += 8) {
    await dra(p, x, y + dy);
    const s = await snap(p);
    if (s.domVert === 'L2') inne = s;
  }
  log(label + ' 4: kortet man svever over rykker ikke oppover når hullet bytter liste',
    !!inne && nær(inne.L2.top, etter.L2.top),
    JSON.stringify({ før: etter.L2.top, etter: inne && inne.L2.top }));

  await p.mouse.up(); await p.waitForTimeout(900);

  // 7) Alt ryddet ved slipp.
  const slutt = await snap(p);
  log(label + ' 7: polstring, min-høyde og scroll er ryddet ved slipp',
    slutt.pad === start.pad && !slutt.minH && slutt.y === start.y && slutt.anker.on === false,
    JSON.stringify({ pad: slutt.pad, minH: slutt.minH, y: slutt.y, anker: slutt.anker }));
  log(label + ' nedover: ingen JS-feil', errs.length === 0, errs.join(' | '));
  await p.close(); await b.close();
}

/* ============ Oppover: B0 fra liste B til liste A ============ */
async function oppover(label, viewport) {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await register(p); await seed(p);

  const { x, y } = await løft(p, 'B0');
  const start = await snap(p);

  let før = start, etter = null;
  for (let dy = -12; dy >= -320 && !etter; dy -= 8) {
    await dra(p, x, y + dy);
    const s = await snap(p);
    if (s.armert.join() === 'L1') etter = s; else før = s;
  }
  if (!etter) {
    log(label + ' 5: kassen som opprettes over kommer mot fingeren', false, 'byttet aldri vert');
    await p.close(); await b.close(); return;
  }

  // 5) Kassen vokser OPPOVER, mot fingeren: siktet havner inni den nye
  //    kasseraden i stedet for et stykke over den (uten fiksen ligger raden
  //    under siktet, og man må snu for å treffe den).
  log(label + ' 5: den nye kasseraden kommer MOT fingeren — siktet lander inni den',
    etter.L1kasse.h > 20 && etter.sikte >= etter.L1kasse.top - 2 && etter.sikte <= etter.L1kasse.bottom + 2,
    JSON.stringify({ sikte: etter.sikte, kasse: [etter.L1kasse.top, etter.L1kasse.bottom] }));
  log(label + ' 5: kortet under står stille mens kortet over vokser',
    nær(etter.L2.top, før.L2.top, 3),
    JSON.stringify({ før: før.L2.top, etter: etter.L2.top }));
  // Board-toppen gikk opp forbi toppmenyen — men scrollområdet vokste like
  // mye, så den er fortsatt å nå (uten det ville scrollen blitt klemt).
  log(label + ' 5: scrollområdet vokste like mye som board-et flyttet seg opp',
    etter.y > før.y && etter.maks >= etter.y,
    JSON.stringify({ y: [før.y, etter.y], maks: etter.maks, minH: etter.minH }));

  // 6) Fram og tilbake fire ganger: skiftet skal falle inn i en STABIL syklus,
  //    ikke vandre et hakk for hver runde.
  const skift = [];
  for (let runde = 0; runde < 4; runde++) {
    for (let dy = -40; dy >= -260; dy -= 20) await dra(p, x, y + dy, 2);
    for (let dy = -240; dy <= 40; dy += 20) await dra(p, x, y + dy, 2);
    const s = await snap(p);
    skift.push(+(s.anker.pad - s.anker.scroll).toFixed(1));
  }
  const sisteTre = skift.slice(1);
  log(label + ' 6: ingen drift — skiftet faller inn i en stabil syklus',
    sisteTre.every((v) => nær(v, sisteTre[0], 2)), JSON.stringify(skift));

  await p.mouse.up(); await p.waitForTimeout(900);
  const slutt = await snap(p);
  log(label + ' 7: polstring, min-høyde og scroll er ryddet ved slipp',
    slutt.pad === start.pad && !slutt.minH && slutt.y === start.y && slutt.anker.on === false,
    JSON.stringify({ pad: slutt.pad, minH: slutt.minH, y: slutt.y }));
  log(label + ' oppover: ingen JS-feil', errs.length === 0, errs.join(' | '));
  await p.close(); await b.close();
}

(async () => {
  await nedover('desktop', { width: 1280, height: 900 });
  await nedover('mobil', { width: 390, height: 780 });
  await oppover('desktop', { width: 1280, height: 900 });
  await oppover('mobil', { width: 390, height: 780 });
  const failed = results.filter((x) => !x).length;
  console.log('\n==== ' + (results.length - failed) + '/' + results.length + ' PASS ====');
  process.exit(failed ? 1 : 0);
})();
