/*
  Regresjonstest: peek-åpning av KOLLAPSEDE dra-mål.

  Drar man et listepunkt over en kollapset liste eller kategori — eller en hel
  kategori over en kollapset liste — og blir værende der i PEEK_MS (200 ms),
  åpnes målet MIDLERTIDIG så man ser hvor det vil lande. Flytter man videre uten
  å slippe, kollapses målet tilbake. Slipper man i det peek-åpnede målet, forblir
  det åpent, og objektet lander der (kategori → INN i en annen liste, en ny
  kapasitet). Rask slipp (før 200 ms) inn i en kollapset liste lander også, og
  «(N)»-telleren oppdateres.

  Kjør:
    python3 -m http.server 8000                     # fra repo-roten, i egen terminal
    NODE_PATH=$(npm root -g) node tests/dnd-peek-collapsed.test.js
*/
const { chromium } = require('playwright');

const BASE = process.env.HUSKIS_URL || 'http://localhost:8000';

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
  await p.locator('#auth-submit').click(); await p.waitForTimeout(1600);
}

// Seed: to lister. A = ukategorisert + 1 kategori m/2 medlemmer. B = 2 listepunkter.
async function seed(p) {
  await p.evaluate(() => { window.__huskis.addUniverse(); }); await p.waitForTimeout(150);
  await p.keyboard.press('Escape'); await p.waitForTimeout(150);
  await p.evaluate(() => { window.__huskis.addGroup(); }); await p.waitForTimeout(150);
  await p.keyboard.press('Escape'); await p.waitForTimeout(150);
  await p.evaluate(() => {
    const H = window.__huskis, st = H.state;
    const u = st.universes.find((x) => x.id === st.activeUniverse);
    const g = u.groups.find((x) => x.id === st.activeGroup);
    const mk = () => ({ ts: 0, org: 't', pos: 0, posTs: 0, posOrg: 't' });
    const mkI = (id, t, h, extra) => Object.assign({ id, text: t, home: h, cat: null, isCat: false, trashed: false, done: false, collapsed: false }, mk(), extra || {});
    const mkCard = (id, title, pos) => Object.assign({ id, group: g.id, title, trashed: false, k: true, p: true, labTs: 0, labOrg: 't', collapsed: false, items: [] }, mk(), { pos });
    const A = mkCard('card-A', 'Liste A', 0);
    A.items.push(mkI('a-free', 'A fri', 'card-A', { pos: 0 }));
    A.items.push(mkI('cat-1', 'Kategori 1', 'card-A', { isCat: true, pos: 1 }));
    A.items.push(mkI('a-m1', 'Medlem 1', 'card-A', { cat: 'cat-1', pos: 0 }));
    A.items.push(mkI('a-m2', 'Medlem 2', 'card-A', { cat: 'cat-1', pos: 1 }));
    const B = mkCard('card-B', 'Liste B', 1);
    B.items.push(mkI('b-1', 'B ett', 'card-B', { pos: 0 }));
    B.items.push(mkI('b-2', 'B to', 'card-B', { pos: 1 }));
    g.cards = [A, B];
    H.render();
  });
  await p.waitForTimeout(300);
}

async function touch(p, type, x, y) {
  await p.evaluate(({ type, x, y }) => {
    const ev = new PointerEvent(type, { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, pointerId: 7, pointerType: 'touch', button: 0, isPrimary: true });
    (type === 'pointerdown' ? (document.elementFromPoint(x, y) || document.body) : window).dispatchEvent(ev);
  }, { type, x, y });
}

// Kollaps en liste/kategori via DIREKTE state (ikke et klikk → save()): et klikk
// planlegger en mock-synk som kan re-rendre og bytte ut det dratte nodet MENS
// trykk-holdet pågår (200 ms) → holdet dropper draget (dragEl frakoblet). Direkte
// state + én render + settle-vent unngår den test-timing-artefakten.
async function collapse(p, id, kind) {
  await p.evaluate(({ id, kind }) => {
    const H = window.__huskis, st = H.state;
    const g = st.universes.find((u) => u.id === st.activeUniverse).groups.find((x) => x.id === st.activeGroup);
    if (kind === 'category') { g.cards.forEach((c) => { const it = c.items.find((i) => i.id === id); if (it) it.collapsed = true; }); }
    else { const c = g.cards.find((c) => c.id === id); if (c) c.collapsed = true; }
    H.render();
  }, { id, kind });
  await p.waitForTimeout(600); // la evt. bakgrunns-synk falle til ro før draget
}

// Senter av navnesonen til et objekt (starter draget der).
const centerOf = (p, sel) => p.evaluate((sel) => {
  const el = document.querySelector(sel);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
}, sel);

const state = (p) => p.evaluate(() => {
  const H = window.__huskis;
  const g = H.state.universes.find((u) => u.id === H.state.activeUniverse).groups.find((x) => x.id === H.state.activeGroup);
  const dump = {};
  g.cards.forEach((c) => { dump[c.id] = { collapsed: !!c.collapsed, items: c.items.map((it) => ({ id: it.id, home: it.home, cat: it.cat, isCat: !!it.isCat })) }; });
  return dump;
});
const isCollapsedDom = (p, id, kind) => p.evaluate(({ id, kind }) => {
  const sel = kind === 'category' ? '.category[data-id="' + id + '"]' : '.card[data-id="' + id + '"]';
  const el = document.querySelector(sel);
  return el ? el.classList.contains('collapsed') : null;
}, { id, kind });

const results = [];
const log = (n, ok, x = '') => { results.push(ok); console.log((ok ? 'PASS' : 'FAIL') + ' — ' + n + (x ? '  [' + x + ']' : '')); };

(async () => {
  const b = await chromium.launch();

  /* ============ 1) Listepunkt → kollapset LISTE: peek åpner, flytt vekk lukker ============ */
  {
    const p = await b.newPage({ viewport: { width: 1200, height: 900 }, hasTouch: true });
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await register(p); await seed(p);
    await collapse(p, 'card-B', 'card');
    log('1 forutsetning: B kollapset', await isCollapsedDom(p, 'card-B', 'card') === true);

    const src = await centerOf(p, '.item[data-id="a-free"] .item-title, .item[data-id="a-free"]');
    const bHead = await centerOf(p, '.card[data-id="card-B"] .card-head');
    // Løft listepunktet (touch-hold), dra over kollapset B, HOLD i > 200 ms.
    await touch(p, 'pointerdown', src.x, src.y); await p.waitForTimeout(240);
    await touch(p, 'pointermove', src.x + 4, src.y + 4); await p.waitForTimeout(40);
    await touch(p, 'pointermove', bHead.x, bHead.y); await p.waitForTimeout(60);
    let collapsedDuring = await isCollapsedDom(p, 'card-B', 'card');
    log('1 rett etter ankomst (< 200 ms): B fortsatt kollapset', collapsedDuring === true, 'collapsed=' + collapsedDuring);
    // Bli værende over B og vent forbi PEEK_MS.
    await touch(p, 'pointermove', bHead.x + 1, bHead.y + 1); await p.waitForTimeout(300);
    let openPeek = await isCollapsedDom(p, 'card-B', 'card');
    log('1 etter ≥200 ms hover: B PEEK-ÅPNET', openPeek === false, 'collapsed=' + openPeek);

    // Flytt tilbake til A uten å slippe → B skal lukkes igjen.
    await touch(p, 'pointermove', src.x, src.y + 40); await p.waitForTimeout(120);
    let reclosed = await isCollapsedDom(p, 'card-B', 'card');
    log('1 flyttet vekk uten slipp: B kollapset tilbake', reclosed === true, 'collapsed=' + reclosed);
    // Slipp (tilbake i A) — B skal fortsatt være kollapset og state uendret for B.
    await touch(p, 'pointerup', src.x, src.y + 40); await p.waitForTimeout(300);
    const st1 = await state(p);
    log('1 slipp utenfor B: B fortsatt kollapset i state', st1['card-B'].collapsed === true, JSON.stringify(st1['card-B']));
    log('1 ingen JS-feil', errs.length === 0, errs.join(' | '));
    await p.close();
  }

  /* ============ 2) Listepunkt → kollapset liste: SLIPP i peek-åpnet → lander + forblir åpen ============ */
  {
    const p = await b.newPage({ viewport: { width: 1200, height: 900 }, hasTouch: true });
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await register(p); await seed(p);
    await collapse(p, "card-B", "card");
    const src = await centerOf(p, '.item[data-id="a-free"]');
    const bHead = await centerOf(p, '.card[data-id="card-B"] .card-head');
    await touch(p, 'pointerdown', src.x, src.y); await p.waitForTimeout(240);
    await touch(p, 'pointermove', src.x + 4, src.y + 4); await p.waitForTimeout(40);
    await touch(p, 'pointermove', bHead.x, bHead.y); await p.waitForTimeout(60);
    await touch(p, 'pointermove', bHead.x + 1, bHead.y + 20); await p.waitForTimeout(300); // peek åpner
    let openPeek = await isCollapsedDom(p, 'card-B', 'card');
    log('2 B peek-åpnet før slipp', openPeek === false, 'collapsed=' + openPeek);
    // Slipp inne i B.
    const drop = await centerOf(p, '.card[data-id="card-B"] .items-container');
    await touch(p, 'pointermove', drop.x, drop.y + 6); await p.waitForTimeout(80);
    await touch(p, 'pointerup', drop.x, drop.y + 6); await p.waitForTimeout(400);
    const st = await state(p);
    const inB = st['card-B'].items.some((it) => it.id === 'a-free' && it.home === 'card-B');
    const notInA = !st['card-A'].items.some((it) => it.id === 'a-free');
    log('2 listepunktet landet i B', inB && notInA, JSON.stringify(st['card-B'].items.map((x) => x.id)));
    log('2 B forblir ÅPEN (collapsed=false) etter slipp inn i peek', st['card-B'].collapsed === false, 'collapsed=' + st['card-B'].collapsed);
    log('2 ingen JS-feil', errs.length === 0, errs.join(' | '));
    await p.close();
  }

  /* ============ 3) Listepunkt → kollapset KATEGORI: peek åpner, slipp lander i kategorien ============ */
  {
    const p = await b.newPage({ viewport: { width: 1200, height: 900 }, hasTouch: true });
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await register(p); await seed(p);
    // Kollaps kategori 1 (klikk på overskriftslinja, ikke tittel/tannhjul).
    await collapse(p, "cat-1", "category");
    log('3 forutsetning: kategori kollapset', await isCollapsedDom(p, 'cat-1', 'category') === true);
    const src = await centerOf(p, '.item[data-id="a-free"]');
    const catHead = await centerOf(p, '.category[data-id="cat-1"] .cat-head');
    await touch(p, 'pointerdown', src.x, src.y); await p.waitForTimeout(240);
    await touch(p, 'pointermove', src.x + 4, src.y + 4); await p.waitForTimeout(40);
    await touch(p, 'pointermove', catHead.x, catHead.y); await p.waitForTimeout(60);
    await touch(p, 'pointermove', catHead.x + 1, catHead.y + 1); await p.waitForTimeout(300);
    let openPeek = await isCollapsedDom(p, 'cat-1', 'category');
    log('3 kategori PEEK-ÅPNET etter hover', openPeek === false, 'collapsed=' + openPeek);
    const drop = await centerOf(p, '.category[data-id="cat-1"] .cat-items');
    await touch(p, 'pointermove', drop.x, drop.y + 6); await p.waitForTimeout(80);
    await touch(p, 'pointerup', drop.x, drop.y + 6); await p.waitForTimeout(400);
    const st = await state(p);
    const landed = st['card-A'].items.find((it) => it.id === 'a-free');
    log('3 listepunktet landet i kategorien (cat=cat-1)', landed && landed.cat === 'cat-1', JSON.stringify(landed));
    log('3 ingen JS-feil', errs.length === 0, errs.join(' | '));
    await p.close();
  }

  /* ============ 4) KATEGORI → kollapset LISTE (ny kapasitet): peek åpner, slipp flytter inn ============ */
  {
    const p = await b.newPage({ viewport: { width: 1200, height: 900 }, hasTouch: true });
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await register(p); await seed(p);
    await collapse(p, "card-B", "card");
    log('4 forutsetning: B kollapset', await isCollapsedDom(p, 'card-B', 'card') === true);
    const src = await centerOf(p, '.category[data-id="cat-1"] .cat-head');
    const bHead = await centerOf(p, '.card[data-id="card-B"] .card-head');
    await touch(p, 'pointerdown', src.x, src.y); await p.waitForTimeout(240);
    await touch(p, 'pointermove', src.x + 4, src.y + 4); await p.waitForTimeout(40);
    await touch(p, 'pointermove', bHead.x, bHead.y); await p.waitForTimeout(60);
    await touch(p, 'pointermove', bHead.x + 1, bHead.y + 10); await p.waitForTimeout(320);
    let openPeek = await isCollapsedDom(p, 'card-B', 'card');
    log('4 B PEEK-ÅPNET under kategori-drag', openPeek === false, 'collapsed=' + openPeek);
    const drop = await centerOf(p, '.card[data-id="card-B"] .items-container');
    await touch(p, 'pointermove', drop.x, drop.y + 6); await p.waitForTimeout(80);
    await touch(p, 'pointerup', drop.x, drop.y + 6); await p.waitForTimeout(500);
    const st = await state(p);
    const catInB = st['card-B'].items.some((it) => it.id === 'cat-1' && it.isCat && it.home === 'card-B');
    const membersInB = ['a-m1', 'a-m2'].every((id) => st['card-B'].items.some((it) => it.id === id && it.home === 'card-B' && it.cat === 'cat-1'));
    const goneFromA = !st['card-A'].items.some((it) => ['cat-1', 'a-m1', 'a-m2'].includes(it.id));
    log('4 kategorien flyttet INN i B', catInB, JSON.stringify(st['card-B'].items));
    log('4 medlemmene fulgte med (home=B, cat=cat-1)', membersInB);
    log('4 borte fra A', goneFromA, JSON.stringify(st['card-A'].items.map((x) => x.id)));
    log('4 B forblir åpen etter slipp', st['card-B'].collapsed === false, 'collapsed=' + st['card-B'].collapsed);
    log('4 ingen JS-feil', errs.length === 0, errs.join(' | '));
    await p.close();
  }

  /* ============ 5) Integrasjon: peek virker i en økt ETTER et kategori-drag ============
     Røyktest at et kategori-drag (som er det ENESTE som setter `drag.card`) ikke
     etterlater tilstand som blokkerer et påfølgende listepunkt-peek. `drag.card`
     nullstilles per drag i `beginDragCommon` nettopp for at en stale kategori-kilde
     ikke skal kunne ekskludere et kort fra peek (`c !== drag.card`). */
  {
    const p = await b.newPage({ viewport: { width: 1200, height: 900 }, hasTouch: true });
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await register(p); await seed(p);
    // Kort kategori-drag i A (setter drag.card = card-A).
    const catH = await centerOf(p, '.category[data-id="cat-1"] .cat-head');
    await touch(p, 'pointerdown', catH.x, catH.y); await p.waitForTimeout(240);
    await touch(p, 'pointermove', catH.x + 4, catH.y + 4); await p.waitForTimeout(40);
    await touch(p, 'pointermove', catH.x + 4, catH.y - 30); await p.waitForTimeout(60);
    await touch(p, 'pointerup', catH.x + 4, catH.y - 30); await p.waitForTimeout(300);
    // Kollaps A (samme kort som var kategori-kilde) og dra et listepunkt fra B over det.
    await collapse(p, 'card-A', 'card');
    const src = await centerOf(p, '.item[data-id="b-1"]');
    const aHead = await centerOf(p, '.card[data-id="card-A"] .card-head');
    await touch(p, 'pointerdown', src.x, src.y); await p.waitForTimeout(240);
    await touch(p, 'pointermove', src.x + 4, src.y + 4); await p.waitForTimeout(40);
    await touch(p, 'pointermove', aHead.x, aHead.y); await p.waitForTimeout(60);
    await touch(p, 'pointermove', aHead.x + 1, aHead.y + 1); await p.waitForTimeout(300);
    log('5 peek åpner A i en økt etter et kategori-drag', await isCollapsedDom(p, 'card-A', 'card') === false);
    await touch(p, 'pointerup', aHead.x + 1, aHead.y + 1); await p.waitForTimeout(300);
    log('5 ingen JS-feil', errs.length === 0, errs.join(' | '));
    await p.close();
  }

  /* ============ 6) Kategori → LÅST mål-liste: rulles tilbake (ikke optimistisk snap) ============
     DB-guarden krever redigering på både gammelt og nytt card_id, så en flytting inn i
     en låst liste ville blitt avvist og snappet tilbake ved synk. Vi ruller derfor
     tilbake med en gang og sier fra. Låst mål peek-åpnes heller ikke. */
  {
    const p = await b.newPage({ viewport: { width: 1200, height: 900 }, hasTouch: true });
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await register(p); await seed(p);
    // Marker B som låst FOR MEG (ikke min, låst, mount-grense så localIsAdmin=false).
    await p.evaluate(() => {
      const H = window.__huskis, st = H.state;
      const g = st.universes.find((u) => u.id === st.activeUniverse).groups.find((x) => x.id === st.activeGroup);
      const B = g.cards.find((c) => c.id === 'card-B'); B._mine = false; B._locked = true; B._mount = true;
    });
    const src = await centerOf(p, '.category[data-id="cat-1"] .cat-head');
    const bHead = await centerOf(p, '.card[data-id="card-B"] .card-head');
    await touch(p, 'pointerdown', src.x, src.y); await p.waitForTimeout(240);
    await touch(p, 'pointermove', src.x + 4, src.y + 4); await p.waitForTimeout(40);
    await touch(p, 'pointermove', bHead.x, bHead.y); await p.waitForTimeout(60);
    await touch(p, 'pointermove', bHead.x + 1, bHead.y + 4); await p.waitForTimeout(60);
    await touch(p, 'pointerup', bHead.x + 1, bHead.y + 4); await p.waitForTimeout(400);
    const st = await state(p);
    const catStaysInA = st['card-A'].items.some((it) => it.id === 'cat-1');
    const notInB = !st['card-B'].items.some((it) => it.id === 'cat-1');
    const toastMsg = await p.evaluate(() => { const t = document.getElementById('toast'); return t ? t.textContent : ''; });
    log('6 kategorien ble IKKE flyttet inn i låst B', catStaysInA && notInB, JSON.stringify({ A: st['card-A'].items.map((x) => x.id), B: st['card-B'].items.map((x) => x.id) }));
    log('6 toast «Lista er låst» vist', /låst/i.test(toastMsg), 'toast=' + toastMsg);
    log('6 ingen JS-feil', errs.length === 0, errs.join(' | '));
    await p.close();
  }

  await b.close();
  const failed = results.filter((x) => !x).length;
  console.log('\n==== ' + (results.length - failed) + '/' + results.length + ' PASS ====');
  process.exit(failed ? 1 : 0);
})();
