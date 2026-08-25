/*
  Regresjonstest: det løftede DnD-objektet holdes ALLTID innenfor viewporten, og
  toppmenyens elementer (kontoknappen) rører seg ikke av et drag.

  Feilen som testes: drar man et listepunkt/en kategori UT i board-lufta, bytter
  placeholderen til «ny liste»-modus og board-ets kort FLIP-animeres. Kilde-kortet
  er en FORFAR til det løftede objektet, og et transformert element blir containing
  block for absolutt posisjonerte etterkommere — dokument-koordinatene fra dragPos*
  ble dermed plutselig tolket relativt til kortet, så objektet hoppet langt ut til
  høyre, utvidet sidens scroll-bredde og (på iOS WebKit) skjøv den høyre-forankrede
  `position: fixed`-kontoknappen ut av viewporten.

  Alle fem nivåene kjører på dnd-kit (se `docs/drag-and-drop.md`), som løfter
  objektet inn i TOP LAYER via `popover`. Hele den feilklassen er dermed borte —
  ingen forfar kan nå et element i top layer. Forankringen skal likevel holde,
  og det er den påstanden som måles her: objektet ligger under pekeren, innenfor
  viewporten, og toppmenyen rører seg ikke.

  SAMME FALLGRUVE, ANDRE KILDE (siste blokk): en DRAKT-regel som posisjonerer en
  forfar. Et forsøk med `position: relative` på `.card` (for å tegne en
  aksentstripe med `::before`) traff to ganger samtidig — `.card` ble containing
  block for listepunkter og kategorier, og selektoren var dessuten sterkere enn
  løfte-regelen, så det løftede KORTET mistet sin egen posisjonering.
  Objektene la seg da ~114 px nedenfor fingeren, og
  områdekortet i navigasjonsmodalen langt utenfor viewporten. Derfor kjøres
  forankringen i MØRK drakt også: draktene deler geometri, og en regel som bare
  gjelder den ene er nettopp den som ellers slipper gjennom.

  Gestene er EKTE input (`tests/dnd-gestures.js`).

  Kjør:
    python3 -m http.server 8000                     # fra repo-roten, i egen terminal
    NODE_PATH=$(npm root -g) node tests/dnd-viewport-clamp.test.js
*/
const { chromium } = require('playwright');
const G = require('./dnd-gestures.js');

const BASE = process.env.HUSKIS_URL || 'http://localhost:8000';

/* Det løftede objektet, på alle fem nivåene: dnd-kit merker det med
   `[data-dnd-dragging]`. Bare ett drag kan være aktivt om gangen. */
const DRAGGED = '[data-dnd-dragging]';

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

// Seed: `cards` = [[tittel, antall listepunkter, antall kategorimedlemmer], …].
// Er tredje felt satt, får kortet i tillegg en kategori med så mange medlemmer.
async function seed(p, cards) {
  await p.evaluate(() => { window.__huskis.addUniverse(); }); await p.waitForTimeout(150);
  await p.keyboard.press('Escape'); await p.waitForTimeout(150);
  await p.evaluate(() => { window.__huskis.addGroup(); }); await p.waitForTimeout(150);
  await p.keyboard.press('Escape'); await p.waitForTimeout(150);
  await p.evaluate((cards) => {
    const H = window.__huskis, st = H.state;
    const u = st.universes.find((x) => x.id === st.activeUniverse);
    const g = u.groups.find((x) => x.id === st.activeGroup);
    const mk = () => ({ ts: 0, org: 't', pos: 0, posTs: 0, posOrg: 't' });
    const mkI = (id, t, h) => Object.assign({ id, text: t, home: h, cat: null, trashed: false, done: false }, mk());
    g.cards = cards.map(([title, n, catN], pos) => {
      const id = 'card-' + title;
      const c = Object.assign({ id, group: g.id, title, trashed: false, k: true, p: true, labTs: 0, labOrg: 't', items: [] }, mk());
      c.pos = pos;
      for (let i = 0; i < n; i++) { const it = mkI('it-' + id + '-' + i, title + ' ' + i, id); it.pos = i; c.items.push(it); }
      if (catN) {
        const cat = mkI('cat-' + id, 'Kategori ' + title, id);
        cat.isCat = true; cat.lockTimes = false; cat.collapsed = false; cat.pos = n;
        c.items.push(cat);
        for (let i = 0; i < catN; i++) {
          const m = mkI('cm-' + id + '-' + i, 'Medlem ' + i, id);
          m.cat = cat.id; m.pos = i; c.items.push(m);
        }
      }
      return c;
    });
    H.render();
  }, cards);
  await p.waitForTimeout(300);
}

const zoneOf = (p, sel) => p.evaluate((sel) => {
  const r = document.querySelector(sel).getBoundingClientRect();
  return { x: r.left + Math.min(60, r.width / 2), y: r.top + r.height / 2 };
}, sel);

// Måler alt vi bryr oss om i én runde: det løftede objektets rendrede boks,
// sidens scroll-bredde, og de faste toppelementenes plassering.
const probe = (p) => p.evaluate((sel) => {
  const d = document.querySelector(sel);
  const a = document.getElementById('account-btn').getBoundingClientRect();
  const t = document.getElementById('topbar').getBoundingClientRect();
  const r = d ? d.getBoundingClientRect() : null;
  /* Hvor mye ROTASJONEN alene får stikke utenfor.
     Klemmen (`SafeViewport`) holder den boksen dnd-kit har MÅLT, og målingen tar
     ikke med rotasjonen appen maler objektet med etterpå (`dndPaintRotation`,
     ±5°). En rotert boks er både høyere og bredere enn den den ble målt som, og
     differansen stikker ut med halvparten på hver kant. Objektet ligger i top
     layer (`position: fixed`), så et hjørne utenfor kanten lager hverken
     scrollbar eller overflow — det er kosmetikk. Å klemme mot den roterte boksen
     i stedet ville kostet det som betyr noe: grepet, som da hadde løsnet fra
     fingeren med den samme slarken hver gang objektet nærmet seg en kant
     (`dnd-layout-modes` sjekk 1). */
  let slack = { x: 1, y: 1 };
  if (d) {
    const a = Math.abs(parseFloat(d.style.rotate) || 0) * Math.PI / 180;
    const cos = Math.cos(a), sin = Math.sin(a);
    const w = d.offsetWidth, h = d.offsetHeight;
    slack = { x: Math.ceil(Math.max(0, (w * cos + h * sin - w) / 2)) + 1,
      y: Math.ceil(Math.max(0, (h * cos + w * sin - h) / 2)) + 1 };
  }
  return {
    dragging: !!d,
    slack,
    box: r ? { l: Math.round(r.left), r: Math.round(r.right), t: Math.round(r.top), b: Math.round(r.bottom) } : null,
    vw: window.innerWidth, vh: window.innerHeight,
    scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth,
    acct: { l: Math.round(a.left), r: Math.round(a.right), t: Math.round(a.top) },
    topbar: { l: Math.round(t.left), r: Math.round(t.right), t: Math.round(t.top) },
    phMode: document.querySelector('.new-list-placeholder') ? 'extract'
      : (document.querySelector('[data-dnd-placeholder]') ? 'reorder' : 'none'),
  };
}, DRAGGED);

const results = [];
const log = (n, ok, x = '') => { results.push(ok); console.log((ok ? 'PASS' : 'FAIL') + ' — ' + n + (x ? '  [' + x + ']' : '')); };

// Ett drag: løft `sel`, før pekeren langt utenfor hver kant, og sjekk hele veien
// at objektet ligger innenfor viewporten og at headeren står stille.
async function dragOutOfBounds(p, label, sel, kind, opts) {
  opts = opts || {};
  // Forrige drag kan ha scrollet siden (auto-scroll / scroll-til-slupt-liste);
  // start hvert drag fra toppen så dra-sonen ikke ligger bak den faste toppmenyen.
  await p.evaluate(() => window.scrollTo(0, 0)); await p.waitForTimeout(120);
  const base = await probe(p);
  const touch = kind !== 'mouse';
  const z = await zoneOf(p, sel);
  await G.lift(p, z, touch);
  if (touch) await G.touchMove(p, z.x + 4, z.y + 4);
  else await p.mouse.move(z.x + 20, z.y + 4);
  await p.waitForTimeout(80);

  const started = await probe(p);
  log(label + ': draget startet', started.dragging, 'phMode=' + started.phMode);

  const vw = base.vw, vh = base.vh;
  // Langt utenfor hver kant, med et par mellomsteg (auto-scroll/FLIP rekker å kjøre).
  const stops = [
    ['høyre', vw + 400, vh / 2], ['høyre-hjørne', vw + 400, vh + 300],
    ['venstre', -400, vh / 2], ['over', vw / 2, -300], ['under', vw / 2, vh + 300],
  ];
  const bad = [];
  let sawExtract = false;
  for (const [where, x, y] of stops) {
    // TO omganger til hvert stopp. Klemmen (`SafeViewport`) leser den FAKTISK
    // MALTE boksen, og rotasjonen settes av OSS etter at dnd-kit har regnet ut
    // flyttingen — ett enkelt hopp klemmes derfor mot forrige frames boks, og en
    // bred rad som nettopp fikk full rotasjon stikker ut med differansen.
    for (const pass of [0, 1]) {
      if (touch) await G.touchMove(p, x, y);
      else await p.mouse.move(x, y, { steps: pass ? 1 : 4 });
      await p.waitForTimeout(pass ? 140 : 60); // FLIP (150 ms) og auto-scroll får løpe
    }
    const s = await probe(p);
    if (!s.dragging) { bad.push(where + ': draget døde'); continue; }
    if (s.phMode === 'extract') sawExtract = true;
    const b = s.box;
    if (b.l < -s.slack.x || b.r > s.vw + s.slack.x || b.t < -s.slack.y || b.b > s.vh + s.slack.y) {
      bad.push(where + ': boks ' + JSON.stringify(b) + ' utenfor ' + s.vw + '×' + s.vh +
        ' (rotasjonsslark ' + JSON.stringify(s.slack) + ')');
    }
    if (s.scrollW > s.clientW) bad.push(where + ': horisontal overflow ' + s.scrollW + '>' + s.clientW);
    if (s.acct.l !== base.acct.l || s.acct.r !== base.acct.r || s.acct.t !== base.acct.t) bad.push(where + ': kontoknappen flyttet seg ' + JSON.stringify(s.acct));
    if (s.topbar.l !== base.topbar.l || s.topbar.r !== base.topbar.r) bad.push(where + ': toppmenyen flyttet seg ' + JSON.stringify(s.topbar));
  }
  log(label + ': objektet holdt seg innenfor viewporten + headeren sto stille', bad.length === 0, bad.join(' | '));
  // Ekstrahering finnes kun for listepunkt/kategori — en liste dras aldri ut i «board-lufta».
  if (!opts.noExtract) log(label + ': ny-liste-placeholderen (extract) ble faktisk aktivert underveis', sawExtract);

  // Touch kan avbrytes for ekte. En mus kan ikke: dagens motor avbryter ikke på
  // Escape, og en oppdiktet `pointercancel` er nettopp det denne omskrivingen
  // fjerner. Musedraget avsluttes derfor med et ekte slipp — det er klemmen og
  // headeren denne fila vokter, og de skal holde uansett hvordan gesten ender.
  if (touch) await G.touchCancel(p);
  else await p.mouse.up();
  // Vent på TILSTANDEN, ikke på klokka: dnd-kit bærer `[data-dnd-dragging]`
  // gjennom hele drop-animasjonen, så et fast tall måler midt i den.
  await p.waitForFunction((sel) => !document.querySelector(sel), DRAGGED, { timeout: 5000 });
  await p.waitForTimeout(120);
  const after = await probe(p);
  log(label + ': ryddet opp etter ' + (touch ? 'avbrutt' : 'avsluttet') + ' drag (ingen overflow, header urørt)',
    !after.dragging && after.scrollW <= after.clientW && after.acct.r === base.acct.r, JSON.stringify(after.acct));
  /* Et musedrag ender i et ekte SLIPP, og slippet skjer i board-lufta — altså en
     EKSTRAHERING. Den nye lista åpner navneredigereren med det samme
     (`nameNewRow`), og et felt som står åpent inn i neste drag rives ned av det
     første trykket: raden blir byttet ut midt i løftet, og draget starter aldri.
     Escape lukker feltet (og fjerner den navnløse lista igjen) før neste runde. */
  // …men BARE når det faktisk står et felt åpent: Escape lukker ellers
  // nav-modalen, og resten av runden ville da siktet på et tomt board.
  if (await p.evaluate(() => !!document.querySelector('.edit-input'))) {
    await p.keyboard.press('Escape');
    await p.waitForTimeout(250);
  }
}

/* PEKERFORANKRINGEN: ett løft, pekeren ført til et fast punkt godt inne i
   viewporten (klemmen over skal ikke slå inn), og så det ene spørsmålet som
   avslører enhver containing-block-feil uansett årsak — LIGGER FINGEREN
   FORTSATT PÅ OBJEKTET? Blir koordinatene tolket mot feil forfar, glir boksen
   vekk fra pekeren og svaret er nei.
   `position` sjekkes i samme slengen: alt som dras av dnd-kit løftes `fixed` i
   top layer — og etter steg 5 er det ALLE nivåene i begge scopene. En
   drakt-regel som overdøver den er den andre halvdelen av den samme feilen. */
async function anchorHolds(p, label, sel, kind, expectPos) {
  await p.evaluate(() => window.scrollTo(0, 0)); await p.waitForTimeout(120);
  const touch = kind !== 'mouse';
  const z = await zoneOf(p, sel);
  await G.lift(p, z, touch);
  if (touch) await G.touchMove(p, z.x + 4, z.y + 4);
  else await p.mouse.move(z.x + 20, z.y + 4);
  await p.waitForTimeout(120);
  const t = await p.evaluate(() => ({ x: Math.round(window.innerWidth / 2), y: Math.round(window.innerHeight / 2) }));
  if (touch) await G.touchMove(p, t.x, t.y);
  else await p.mouse.move(t.x, t.y, { steps: 6 });
  await p.waitForTimeout(160);
  const s = await p.evaluate(({ tx, ty, sel }) => {
    const d = document.querySelector(sel);
    if (!d) return { dragging: false };
    const r = d.getBoundingClientRect();
    return {
      dragging: true, position: getComputedStyle(d).position,
      dx: Math.round(tx - r.left), dy: Math.round(ty - r.top),
      w: Math.round(r.width), h: Math.round(r.height),
    };
  }, { tx: t.x, ty: t.y, sel: DRAGGED });
  const inside = s.dragging && s.dx >= 0 && s.dx <= s.w && s.dy >= 0 && s.dy <= s.h;
  log(label + ': pekeren ligger fortsatt på det løftede objektet', inside, JSON.stringify(s));
  log(label + ': løftes som `' + expectPos + '`', s.position === expectPos, 'fikk ' + s.position);
  if (touch) await G.touchCancel(p);
  else await p.mouse.up();
  await p.waitForFunction((sel) => !document.querySelector(sel), DRAGGED, { timeout: 5000 });
  await p.waitForTimeout(120);
  // Musedraget ender i et ekte SLIPP midt på board-et — altså i board-lufta, som
  // for et listepunkt eller en kategori betyr EKSTRAHERING til en ny liste. Den
  // åpner navneredigereren med det samme, og et felt som står åpent inn i neste
  // drag rives ned av det første trykket: raden byttes ut midt i løftet, og
  // draget starter aldri. Escape lukker feltet (og fjerner den navnløse lista).
  // …men BARE når det faktisk står et felt åpent: Escape lukker ellers
  // nav-modalen, og resten av runden ville da siktet på et tomt board.
  if (await p.evaluate(() => !!document.querySelector('.edit-input'))) {
    await p.keyboard.press('Escape');
    await p.waitForTimeout(250);
  }
}

(async () => {
  const b = await chromium.launch();

  /* ---------- Desktop (flerkolonne, mus) ---------- */
  {
    const p = await b.newPage({ viewport: { width: 1200, height: 800 } });
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await register(p);
    // Fire kort → flere kolonner, så kilde-kortet ligger i venstre kolonne og en
    // feilaktig containing-block-forskyvning slår ut i full bredde.
    await seed(p, [['A', 4, 3], ['B', 4], ['C', 4], ['D', 4]]);
    await dragOutOfBounds(p, 'desktop/listepunkt', '.card[data-id="card-A"] .items-container > .item .item-text', 'mouse');
    await dragOutOfBounds(p, 'desktop/kategori', '.card[data-id="card-A"] .category .cat-head', 'mouse');
    await dragOutOfBounds(p, 'desktop/liste', '.card[data-id="card-A"] .card-head', 'mouse', { noExtract: true });
    log('desktop: ingen JS-feil', errs.length === 0, errs.join(' | '));
    await p.close();
  }

  /* ---------- Mobil (énkolonne, touch) ---------- */
  {
    const p = await b.newPage({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true });
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await register(p);
    await seed(p, [['A', 4, 3], ['B', 4]]);
    await dragOutOfBounds(p, 'mobil/listepunkt', '.card[data-id="card-A"] .items-container > .item .item-text', 'touch');
    await dragOutOfBounds(p, 'mobil/kategori', '.card[data-id="card-A"] .category .cat-head', 'touch');
    await dragOutOfBounds(p, 'mobil/liste', '.card[data-id="card-A"] .card-head', 'touch', { noExtract: true });
    log('mobil: ingen JS-feil', errs.length === 0, errs.join(' | '));
    await p.close();
  }

  /* ---------- Mørk drakt: forankringen på ALLE fem nivåene ----------
     Område, mappe og liste dras av dnd-kit og løftes `fixed` i top layer;
     kategori og listepunkt dras fortsatt `absolute`. Begge halvdelene kjøres,
     fordi de to øverste nivåene er bygget av de samme komponentene som de to
     nederste — en drakt-regel på `.card` treffer dem alle. */
  {
    const p = await b.newPage({ viewport: { width: 1200, height: 800 } });
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await register(p);
    await p.evaluate(() => window.HUSKIS_THEME.setMode('dark'));
    await p.waitForTimeout(200);
    await seed(p, [['A', 4, 3], ['B', 4], ['C', 4], ['D', 4]]);
    const dark = await p.evaluate(() => document.documentElement.getAttribute('data-theme'));
    log('mørk drakt: attributtet står', dark === 'dark', String(dark));

    await anchorHolds(p, 'mørk/listepunkt', '.card[data-id="card-A"] .items-container > .item .item-text', 'mouse', 'fixed');
    await anchorHolds(p, 'mørk/kategori', '.card[data-id="card-A"] .category .cat-head', 'mouse', 'fixed');
    await anchorHolds(p, 'mørk/liste', '.card[data-id="card-A"] .card-head', 'mouse', 'fixed');
    // Samme runde som i lys drakt: en forskyvning som ikke slår ut på
    // forankringen ville fortsatt kunne skyve objektet ut av viewporten.
    await dragOutOfBounds(p, 'mørk/listepunkt', '.card[data-id="card-A"] .items-container > .item .item-text', 'mouse');
    await dragOutOfBounds(p, 'mørk/liste', '.card[data-id="card-A"] .card-head', 'mouse', { noExtract: true });

    await p.evaluate(() => window.__huskis.openNavModal());
    await p.waitForTimeout(350);
    await anchorHolds(p, 'mørk/område', '#nav-board .card .card-head', 'mouse', 'fixed');
    await anchorHolds(p, 'mørk/mappe', '#nav-board .card .items-container > .item', 'mouse', 'fixed');

    log('mørk drakt: ingen JS-feil', errs.length === 0, errs.join(' | '));
    await p.close();
  }

  await b.close();
  const failed = results.filter((x) => !x).length;
  console.log('\n==== ' + (results.length - failed) + '/' + results.length + ' PASS ====');
  process.exit(failed ? 1 : 0);
})();
