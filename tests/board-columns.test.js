/*
  Regresjonstest: board-kolonnene (fyll venstre først) + DnD-plasseringen av
  ny-liste-placeholderen i flerkolonne-layout.

  (1) FYLL-REKKEFØLGE: kolonne 1 fylles helt før kolonne 2 oppstår. Før brukte
      board-et CSS multi-column, som BALANSERER — tre lister ble tre kolonner med
      én liste hver, og en fjerde liste havnet i kolonne 2 mens kolonne 1 fortsatt
      hadde plass. Nå fordeler `relayoutBoard` grådig etter et kolonnebudsjett
      (skjermhøyden), og budsjettet vokser først når alt ikke får plass.

  (2) INGEN FLIMRING: drar man et listepunkt ut i board-lufta mellom to lister,
      skal placeholderen bli stående. Med multi-column dyttet placeholderen et kort
      over i neste kolonne, som endret svaret på «hvilken liste er objektet i?»,
      som fjernet placeholderen, som flyttet kortet tilbake … én runde per piksel.

  (3) RIKTIG KOLONNE: sikter man under den første lista i kolonne 1, skal
      placeholderen dukke opp DER — ikke nederst i siste kolonne (som `appendChild`
      på et flatt board ga: siste plass i DOM = bunnen av siste kolonne).

  (4) TO VEIER TIL SAMME PLASS: bunnen av kolonne 1 og toppen av kolonne 2 er samme
      plass i rekkefølgen. Placeholderen skal vises begge steder — der man sikter —
      og slippet skal gi nøyaktig samme rekkefølge.

  Kjør:
    python3 -m http.server 8000                     # fra repo-roten, i egen terminal
    NODE_PATH=$(npm root -g) node tests/board-columns.test.js
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

// `sizes` = antall listepunkter per liste. Listene heter L1, L2, … og har id-ene
// card-0, card-1, …
async function seed(p, sizes) {
  await p.evaluate(() => { window.__huskis.addUniverse(); }); await p.waitForTimeout(150);
  await p.keyboard.press('Escape'); await p.waitForTimeout(150);
  await p.evaluate(() => { window.__huskis.addGroup(); }); await p.waitForTimeout(150);
  await p.keyboard.press('Escape'); await p.waitForTimeout(150);
  await p.evaluate((sizes) => {
    const H = window.__huskis, st = H.state;
    const g = st.universes.find((u) => u.id === st.activeUniverse).groups.find((x) => x.id === st.activeGroup);
    const mk = () => ({ ts: 0, org: 't', pos: 0, posTs: 0, posOrg: 't' });
    const mkI = (id, t, h, extra) => Object.assign({ id, text: t, home: h, cat: null, isCat: false, trashed: false, done: false, collapsed: false }, mk(), extra || {});
    const mkCard = (id, title, pos) => Object.assign({ id, group: g.id, title, trashed: false, k: true, p: true, labTs: 0, labOrg: 't', collapsed: false, items: [] }, mk(), { pos });
    g.cards = sizes.map((count, i) => {
      const id = 'card-' + i;
      const c = mkCard(id, 'L' + (i + 1), i);
      for (let j = 0; j < count; j++) c.items.push(mkI(id + '-' + j, 'P' + (i + 1) + '.' + (j + 1), id, { pos: j }));
      return c;
    });
    H.render();
  }, sizes);
  await p.waitForTimeout(350);
}

async function ptr(p, type, x, y) {
  await p.evaluate(({ type, x, y }) => {
    const ev = new PointerEvent(type, { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, pointerId: 1, pointerType: 'mouse', button: 0, buttons: type === 'pointerup' || type === 'pointercancel' ? 0 : 1, isPrimary: true });
    (type === 'pointerdown' ? (document.elementFromPoint(x, y) || document.body) : window).dispatchEvent(ev);
  }, { type, x, y });
}

// Kolonnene som lister av rad-navn: kort → tittel, ny-liste-placeholder → «+».
const cols = (p) => p.evaluate(() => [...document.querySelectorAll('.board > .board-col')].map((col) =>
  [...col.children].map((el) => el.classList.contains('new-list-placeholder') ? '+'
    : (el.classList.contains('card-placeholder') ? '_' : (el.querySelector('.card-title') || {}).textContent))));
// Titlene i LESEREKKEFØLGE (= rekkefølgen som lagres som pos).
const order = (p) => p.evaluate(() => {
  const H = window.__huskis, st = H.state;
  const g = st.universes.find((u) => u.id === st.activeUniverse).groups.find((x) => x.id === st.activeGroup);
  return g.cards.filter((c) => !c.trashed).slice().sort((a, b) => a.pos - b.pos).map((c) => c.title || '(ny)');
});
const rectOf = (p, sel) => p.evaluate((sel) => {
  const el = document.querySelector(sel); if (!el) return null;
  const r = el.getBoundingClientRect();
  return { l: r.left, r: r.right, t: r.top, b: r.bottom, cx: Math.round(r.left + r.width / 2), cy: Math.round(r.top + r.height / 2) };
}, sel);

const results = [];
const log = (n, ok, x = '') => { results.push(ok); console.log((ok ? 'PASS' : 'FAIL') + ' — ' + n + (x ? '  [' + x + ']' : '')); };

// Løft et listepunkt med mus (ingen hold på desktop — 5 px bevegelse holder).
async function lift(p, sel) {
  const z = await rectOf(p, sel);
  await ptr(p, 'pointerdown', z.cx, z.cy);
  await ptr(p, 'pointermove', z.cx, z.cy + 8);
  await p.waitForTimeout(60);
  return z;
}

(async () => {
  const b = await chromium.launch();

  /* ============ 1) Fyll-rekkefølge: venstre kolonne først ============ */
  {
    const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await register(p);
    await seed(p, [1, 1, 1]);
    const c1 = await cols(p);
    log('1 tre korte lister: alle i kolonne 1 (ikke én per kolonne)',
      c1[0].join(',') === 'L1,L2,L3' && (c1[1] || []).length === 0, JSON.stringify(c1));
    log('1 board-et har flere KOLONNER tilgjengelig (bredt vindu)', c1.length >= 3, 'kolonner=' + c1.length);

    // Fyll opp med flere lister: en ny kolonne skal først tas i bruk når den
    // forrige ikke har plass til neste liste.
    await seed(p, [6, 6, 1, 1]);
    const c2 = await cols(p);
    const flat = c2.map((c) => c.join(',')).join(' | ');
    log('1 rekkefølgen leses kolonne for kolonne, venstre først',
      c2.flat().join(',') === 'L1,L2,L3,L4', flat);
    // Hver kolonneovergang må være tvungen: den første lista i neste kolonne
    // hadde IKKE fått plass i den forrige (kolonnehøyden er budsjettet, og den
    // høyeste kolonnen er en nedre grense for det).
    const forced = await p.evaluate(() => {
      const gap = parseFloat(getComputedStyle(document.querySelector('.board')).columnGap) || 0;
      const list = [...document.querySelectorAll('.board > .board-col')]
        .map((c) => [...c.children].map((el) => el.offsetHeight))
        .filter((h) => h.length);
      const used = (hs) => hs.reduce((a, h) => a + h, 0) + gap * Math.max(0, hs.length - 1);
      const budget = Math.max(...list.map(used));
      return list.slice(0, -1).every((hs, i) => used(hs) + gap + list[i + 1][0] > budget);
    });
    log('1 en ny kolonne oppstår kun når den forrige er full', forced, flat);
    log('1 ingen JS-feil', errs.length === 0, errs.join(' | '));
    await p.close();
  }

  /* ============ 2) Ingen flimring når et listepunkt dras ut i board-lufta ============ */
  {
    const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await register(p);
    await seed(p, [1, 1, 1]); // alle tre i kolonne 1
    const l1 = await rectOf(p, '.card[data-id="card-0"]');
    const z = await lift(p, '.card[data-id="card-1"] .item');
    // Sikt i board-lufta rett under L1 og beveg pekeren én piksel om gangen.
    const snaps = [];
    for (let i = 0; i < 14; i++) {
      await ptr(p, 'pointermove', Math.round(l1.cx), Math.round(l1.b) + 12 - i);
      await p.waitForTimeout(25);
      snaps.push((await cols(p)).map((c) => c.join(',')).join('|'));
    }
    const uniq = [...new Set(snaps)];
    log('2 layouten står i ro gjennom 14 piksler (ingen veksling)', uniq.length === 1, uniq.join('  ≠  '));
    log('2 placeholderen står mellom L1 og L2 i kolonne 1', /^L1,\+,L2/.test(snaps[snaps.length - 1]), snaps[snaps.length - 1]);
    await ptr(p, 'pointerup', Math.round(l1.cx), Math.round(l1.b) - 1);
    await p.waitForTimeout(400);
    log('2 ingen JS-feil', errs.length === 0, errs.join(' | '));
    await p.close();
  }

  /* ============ 3) Placeholderen havner i kolonnen man sikter på ============
     Én høy liste per kolonne (kort vindu + fulle lister). Sikter man under L1 i
     kolonne 1, skal placeholderen dukke opp der — ikke nederst i siste kolonne. */
  {
    const p = await b.newPage({ viewport: { width: 1400, height: 640 } });
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await register(p);
    await seed(p, [5, 5, 5]);
    const start = await cols(p);
    log('3 forutsetning: én liste per kolonne', start.map((c) => c.join(',')).join('|') === 'L1|L2|L3',
      JSON.stringify(start));
    const l1 = await rectOf(p, '.card[data-id="card-0"]');
    await lift(p, '.card[data-id="card-1"] .item');
    await ptr(p, 'pointermove', Math.round(l1.cx), Math.round(l1.b) + 20); await p.waitForTimeout(60);
    await ptr(p, 'pointermove', Math.round(l1.cx), Math.round(l1.b) + 24); await p.waitForTimeout(80);
    const during = await cols(p);
    log('3 placeholderen ligger under L1 i KOLONNE 1', (during[0] || []).join(',') === 'L1,+',
      during.map((c) => c.join(',')).join('|'));
    await ptr(p, 'pointerup', Math.round(l1.cx), Math.round(l1.b) + 24);
    await p.waitForTimeout(500);
    await p.keyboard.press('Escape'); await p.waitForTimeout(200);
    log('3 den nye lista havnet MELLOM L1 og L2 i rekkefølgen',
      (await order(p)).join(',') === 'L1,(ny),L2,L3', (await order(p)).join(','));
    log('3 ingen JS-feil', errs.length === 0, errs.join(' | '));
    await p.close();
  }

  /* ============ 4) To veier til samme plass: bunn av kolonne 1 / topp av kolonne 2 ============ */
  for (const path of ['bunnen av kolonne 1', 'toppen av kolonne 2']) {
    const p = await b.newPage({ viewport: { width: 1400, height: 640 } });
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await register(p);
    await seed(p, [5, 5, 5]);
    const l1 = await rectOf(p, '.card[data-id="card-0"]');
    const l2 = await rectOf(p, '.card[data-id="card-1"]');
    await lift(p, '.card[data-id="card-2"] .item');
    const aim = path === 'bunnen av kolonne 1'
      ? { x: Math.round(l1.cx), y: Math.round(l1.b) + 30 }   // under L1, i kolonne 1
      : { x: Math.round(l2.cx), y: Math.round(l2.t) - 20 };  // over L2, i kolonne 2
    await ptr(p, 'pointermove', aim.x, aim.y); await p.waitForTimeout(60);
    await ptr(p, 'pointermove', aim.x, aim.y + 2); await p.waitForTimeout(80);
    const during = (await cols(p)).map((c) => c.join(',')).join('|');
    const want = path === 'bunnen av kolonne 1' ? 'L1,+|L2|L3' : 'L1|+,L2|L3';
    log('4 ' + path + ': placeholderen vises DER man sikter', during === want, during);
    await ptr(p, 'pointerup', aim.x, aim.y + 2);
    await p.waitForTimeout(500);
    await p.keyboard.press('Escape'); await p.waitForTimeout(200);
    log('4 ' + path + ': samme sluttrekkefølge', (await order(p)).join(',') === 'L1,(ny),L2,L3',
      (await order(p)).join(','));
    log('4 ' + path + ': ingen JS-feil', errs.length === 0, errs.join(' | '));
    await p.close();
  }

  /* ============ 5) Alle kolonner fulle → budsjettet vokser, siden scroller ============ */
  {
    const p = await b.newPage({ viewport: { width: 900, height: 700 } }); // 2 kolonner
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await register(p);
    await seed(p, [5, 5]);
    const two = await cols(p);
    log('5 to fulle lister fyller de to kolonnene', two.map((c) => c.join(',')).join('|') === 'L1|L2',
      JSON.stringify(two));
    await seed(p, [5, 5, 5]);
    const three = await cols(p);
    log('5 en tredje liste får kolonnene til å VOKSE (ingen tredje kolonne finnes)',
      three.length === 2 && three.flat().join(',') === 'L1,L2,L3', JSON.stringify(three));
    log('5 den øverste i kolonne 2 gled ned som den nederste i kolonne 1',
      three[0].length === 2 && three[0][1] === 'L2' && three[1].join(',') === 'L3', JSON.stringify(three));
    const scrolls = await p.evaluate(() => document.documentElement.scrollHeight > window.innerHeight + 4);
    log('5 siden scroller når kolonnene er høyere enn skjermen', scrolls);
    log('5 ingen JS-feil', errs.length === 0, errs.join(' | '));
    await p.close();
  }

  /* ============ 6) Ingen flimring mot en KOLLAPSET liste under kilden ============
     Modusbyttet (ny-liste-placeholderen ut av kolonnen, reorder-placeholderen inn
     i lista) rykker alt under den gamle plassen OPPOVER. En kollapset liste har en
     kort sone, så hoppet rakk å legge sonen forbi objektet: det falt ut igjen,
     placeholderen kom tilbake, lista ble dyttet ned … én runde per piksel.
     `noteOverShift`/`drag.overGrace` lar stickiness-en holde lista gjennom hoppet. */
  {
    const p = await b.newPage({ viewport: { width: 1400, height: 760 } });
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await register(p);
    await seed(p, [2, 2, 2]);
    await p.evaluate(() => {
      const H = window.__huskis, st = H.state;
      const g = st.universes.find((u) => u.id === st.activeUniverse).groups.find((x) => x.id === st.activeGroup);
      g.cards.find((c) => c.id === 'card-1').collapsed = true;
      H.render();
    });
    await p.waitForTimeout(400);
    const z = await lift(p, '.card[data-id="card-0"] .item');
    const seq = [];
    for (let i = 0; i < 160; i++) {
      await ptr(p, 'pointermove', z.cx, z.cy + 8 + i * 2);
      const now = (await cols(p)).map((c) => c.join(',')).join('|');
      if (seq[seq.length - 1] !== now) seq.push(now);
    }
    await ptr(p, 'pointercancel', z.cx, z.cy);
    await p.waitForTimeout(300);
    const counts = {};
    seq.forEach((s) => { counts[s] = (counts[s] || 0) + 1; });
    const worst = Math.max(...Object.values(counts));
    // Layouten skal endre seg noen få ganger på veien ned (inn/ut av lister), men
    // ingen tilstand skal komme igjen om og om igjen — det er flimring.
    log('6 ingen tilstand gjentas mer enn to ganger gjennom 320 px', worst <= 2, 'verste=' + worst + '×');
    log('6 få layout-overganger totalt', seq.length <= 8, 'overganger=' + seq.length + ' :: ' + seq.join('  →  '));
    log('6 ingen JS-feil', errs.length === 0, errs.join(' | '));
    await p.close();
  }

  await b.close();
  const ok = results.filter(Boolean).length;
  console.log('\n==== ' + ok + '/' + results.length + (ok === results.length ? ' PASS ====' : ' — NOEN FEILET ===='));
  process.exit(ok === results.length ? 0 : 1);
})();
