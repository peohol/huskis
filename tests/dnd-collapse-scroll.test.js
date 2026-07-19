/*
  Regresjonstest for to DnD/liste-atferder:
   1. Åpning/lukking av lister er MOMENTAN (ingen animasjon) — både rullgardinen
      (klikk på korthodet) og kollaps-alle under DnD.
   2. Etter et fullført liste-drag scroller siden til den slupne lista (toppen
      like under den faste toppmenyen).

  Kjør:
    python3 -m http.server 8000                      # fra repo-roten, i egen terminal
    NODE_PATH=$(npm root -g) node tests/dnd-collapse-scroll.test.js
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
    const mkI = (t, h, i) => Object.assign({ id: 'it-' + h + '-' + i, text: t, home: h, cat: null, trashed: false, done: false }, mk());
    g.cards = cards.map(([title, n], pos) => {
      const id = 'card-' + title;
      const c = Object.assign({ id, group: g.id, title, trashed: false, k: true, p: true, labTs: 0, labOrg: 't', items: [] }, mk());
      c.pos = pos;
      for (let i = 0; i < n; i++) { const it = mkI(title + ' ' + i, id, i); it.pos = i; c.items.push(it); }
      return c;
    });
    H.render();
  }, cards);
  await p.waitForTimeout(300);
}

async function pointer(p, type, x, y) {
  await p.evaluate(({ type, x, y }) => {
    const ev = new PointerEvent(type, { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, pointerId: 7, pointerType: 'touch', button: 0, isPrimary: true });
    (type === 'pointerdown' ? (document.elementFromPoint(x, y) || document.body) : window).dispatchEvent(ev);
  }, { type, x, y });
}

(async () => {
  const b = await chromium.launch();
  const results = [];
  const log = (n, ok, x = '') => { results.push(ok); console.log((ok ? 'PASS' : 'FAIL') + ' — ' + n + (x ? '  [' + x + ']' : '')); };

  // ---- (1) Rullgardin: momentan åpning/lukking (desktop) ----
  const d = await b.newPage({ viewport: { width: 1200, height: 800 } });
  const derrs = []; d.on('pageerror', (e) => derrs.push(e.message));
  await register(d);
  await seed(d, [['Alfa', 5]]);
  const click = () => d.evaluate(() => {
    const head = document.querySelector('.card[data-id="card-Alfa"] .card-head');
    const r = head.getBoundingClientRect();
    head.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: r.left + r.width * 0.55, clientY: r.top + r.height / 2 }));
  });
  const bodyH = () => d.evaluate(() => Math.round(document.querySelector('.card[data-id="card-Alfa"] .card-body').getBoundingClientRect().height));
  const collapsedFlag = () => d.evaluate(() => document.querySelector('.card[data-id="card-Alfa"]').classList.contains('collapsed'));
  const h0 = await bodyH();
  await click(); await d.waitForTimeout(40); // ingen animasjon → momentant 0
  const closed = { h: await bodyH(), c: await collapsedFlag(), saved: await d.evaluate(() => window.__huskis.state.universes.find((u) => u.id === window.__huskis.state.activeUniverse).groups.find((g) => g.id === window.__huskis.state.activeGroup).cards.find((c) => c.id === 'card-Alfa').collapsed) };
  await click(); await d.waitForTimeout(40);
  const open = { h: await bodyH(), c: await collapsedFlag() };
  log('rullgardin lukker MOMENTANT (bodyH=0 innen 40ms) + lagrer', closed.h === 0 && closed.c === true && closed.saved === true, 'h0=' + h0 + ' closed=' + JSON.stringify(closed));
  log('rullgardin åpner MOMENTANT', open.h > 0 && open.c === false, 'open=' + JSON.stringify(open));
  await d.close();

  // ---- (2) Scroll til den slupne lista etter et fullført touch-drag ----
  const p = await b.newPage({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await register(p);
  await seed(p, [['Hoy', 20], ['Midt', 10], ['Kort', 2]]);

  // Stå øverst, dra den ØVERSTE lista NED forbi de andre → slupt langt nede.
  await p.evaluate(() => window.scrollTo(0, 0)); await p.waitForTimeout(150);
  const R = await p.evaluate(() => {
    const r = document.querySelector('.card[data-id="card-Hoy"] .card-head').getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await pointer(p, 'pointerdown', R.x, R.y); await p.waitForTimeout(260);
  let y = R.y;
  for (let i = 0; i < 10; i++) { y = Math.min(740, y + 40); await pointer(p, 'pointermove', R.x, y); await p.waitForTimeout(50); }
  await p.waitForTimeout(400); // la auto-scroll dra draget nedover
  await pointer(p, 'pointerup', R.x, y);
  await p.waitForTimeout(900); // smooth-scroll + fly-inn ferdig

  const res = await p.evaluate(() => {
    const el = document.querySelector('.card[data-id="card-Hoy"]');
    const r = el.getBoundingClientRect();
    const topbar = document.querySelector('.topbar') || document.querySelector('header');
    const bd = document.querySelector('.board');
    return {
      top: Math.round(r.top), vh: window.innerHeight,
      topbarBottom: Math.round(topbar ? topbar.getBoundingClientRect().bottom : 0),
      order: [...document.querySelectorAll('.card')].map((c) => c.dataset.id),
      minH: bd.style.minHeight || '-', pad: bd.style.paddingTop || '-',
    };
  });
  log('slupt liste flyttet nederst i rekkefølgen', res.order[res.order.length - 1] === 'card-Hoy', JSON.stringify(res.order));
  log('siden scrollet til den slupne lista (topp under toppmenyen, i viewport)',
    res.top >= res.topbarBottom - 6 && res.top < res.vh - 40, 'top=' + res.top + ' topbarBottom=' + res.topbarBottom + ' vh=' + res.vh);
  log('board-vakten ryddet etter slipp', res.minH === '-' && res.pad === '-', 'minH=' + res.minH + ' pad=' + res.pad);
  log('ingen JS-feil', errs.length === 0 && derrs.length === 0, [...errs, ...derrs].join(' | '));
  await p.close();

  await b.close();
  const failed = results.filter((x) => !x).length;
  console.log('\n==== ' + (results.length - failed) + '/' + results.length + ' PASS ====');
  process.exit(failed ? 1 : 0);
})();
