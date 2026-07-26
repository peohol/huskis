/*
  Regresjonstest: AUTO-SCROLL-TAKT, AVBRUDDS-SIKKERHETSNETT og EKSTERN SCROLL.

  7.  Auto-scrollen normaliseres mot faktisk forløpt tid: like lang simulert tid
      ved 60 og 120 RAF-steg gir tilnærmet lik scrollavstand, og et diger `dt`
      (bakgrunnsfane/pause) klemmes så scrollen ikke hopper.
  8.  `lostpointercapture` og `blur` avbryter et hengende drag: ingen `.dragging`,
      placeholder, auto-scroll, global cursor eller inline-posisjonsstil blir igjen.
  9.  Manuelt window-scroll under listepunkt-/kategori-drag holder objektet under
      pekeren (før: bare lister ble reposisjonert).

  Kjør:
    python3 -m http.server 8000                    # fra repo-roten, i egen terminal
    NODE_PATH=$(npm root -g) node tests/dnd-recovery-scroll.test.js
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

// cards = [[tittel, antall listepunkter, antallKategorimedlemmer?], …]
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
    g.cards = cards.map(([title, n, cat], pos) => {
      const id = 'card-' + title;
      const c = Object.assign({ id, group: g.id, title, trashed: false, k: true, p: true, labTs: 0, labOrg: 't', items: [] }, mk());
      c.pos = pos;
      const add = (o) => { c.items.push(Object.assign({ home: id, cat: null, trashed: false, done: false }, mk(), o)); };
      for (let i = 0; i < n; i++) add({ id: 'it-' + title + '-' + i, text: title + ' ' + i, pos: i });
      if (cat) {
        const cid = 'cat-' + title;
        add({ id: cid, text: 'Kategori ' + title, isCat: true, pos: n });
        for (let i = 0; i < cat; i++) add({ id: 'ci-' + title + '-' + i, text: 'K' + i, cat: cid, pos: i });
      }
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

const centerOf = (p, sel) => p.evaluate((sel) => {
  const r = document.querySelector(sel).getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, top: r.top, bottom: r.bottom, h: r.height };
}, sel);

// Avstanden fra pekeren til det løftede objektets LAYOUT-topp i viewporten.
// Leses fra `style.top` (dokument-koordinat) − scrollY, ikke fra
// getBoundingClientRect: kategorien kollapser (animert høyde) og roterer under
// draget, så både senter og omslutningsboks flytter seg av andre grunner enn
// scrollen vi tester.
const dragTopOffset = (p, sel, py) => p.evaluate(({ sel, py }) => {
  const el = document.querySelector(sel);
  return py - (parseFloat(el.style.top) - window.scrollY);
}, { sel, py });

// Restene et drag ALDRI skal etterlate seg.
const residue = (p) => p.evaluate(() => {
  const dragged = document.querySelector('.card[style*="left"], .item[style*="left"]');
  return {
    dragging: document.querySelectorAll('.dragging').length,
    ph: document.querySelectorAll('.card-placeholder, .item-placeholder, .group-placeholder, .new-list-placeholder').length,
    isDragging: document.body.classList.contains('is-dragging'),
    cursor: getComputedStyle(document.body).cursor,
    inlinePos: dragged ? (dragged.getAttribute('style') || '') : '',
    overflowAnchor: document.documentElement.style.overflowAnchor || '',
    boardGuard: (document.querySelector('.board').style.minHeight || '') + '|' + (document.querySelector('.board').style.paddingTop || ''),
  };
});

const results = [];
const log = (n, ok, x = '') => { results.push(ok); console.log((ok ? 'PASS' : 'FAIL') + ' — ' + n + (x ? '  [' + x + ']' : '')); };

(async () => {
  const b = await chromium.launch();

  /* ===== 7) Auto-scroll: samme fysiske tid → samme avstand på 60 og 120 fps ===== */
  {
    const p = await b.newPage({ viewport: { width: 420, height: 820 }, hasTouch: true, isMobile: true });
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await register(p); await seed(p, [['A', 25], ['B', 25], ['C', 25]]);
    await p.evaluate(() => window.scrollTo(0, 0)); await p.waitForTimeout(150);

    // Løft et listepunkt (ingen kollaps → board-et forblir høyt) og hold fingeren
    // i bunn-sonen så auto-scrollen går kontinuerlig.
    const it = await centerOf(p, '.item[data-id="it-A-2"]');
    await pointer(p, 'pointerdown', it.x, it.y); await p.waitForTimeout(260);
    await pointer(p, 'pointermove', it.x, 700); await p.waitForTimeout(60);
    await pointer(p, 'pointermove', it.x, 806); await p.waitForTimeout(120);

    // Overta rAF: loopen re-scheduler seg mot den GLOBALE funksjonen, så den
    // flytter seg inn i vår falske klokke ved neste frame.
    await p.evaluate(() => {
      const st = { t: performance.now(), cbs: new Map(), next: 1 };
      window.__raf = st;
      window.requestAnimationFrame = (cb) => { st.cbs.set(st.next, cb); return st.next++; };
      window.cancelAnimationFrame = (id) => { st.cbs.delete(id); };
      window.__step = (dt, n) => {
        for (let i = 0; i < n; i++) {
          st.t += dt;
          const due = [...st.cbs.entries()];
          st.cbs.clear();
          due.forEach(([, cb]) => cb(st.t));
        }
      };
    });
    await p.waitForTimeout(120); // siste ekte frame flytter loopen inn i den falske

    const run = (dt, n) => p.evaluate(({ dt, n }) => {
      const y0 = window.scrollY;
      window.__step(dt, n);
      return window.scrollY - y0;
    }, { dt, n });

    const d60 = await run(1000 / 60, 12);   // 200 ms i 60 fps
    const d120 = await run(1000 / 120, 24); // 200 ms i 120 fps
    const dPause = await run(5000, 1);      // «fanen lå i bakgrunnen»
    const perFrame = d60 / 12;
    log('7 auto-scroll kjører i det hele tatt', d60 > 40, 'd60=' + d60.toFixed(1));
    log('7 lik simulert tid → tilnærmet lik avstand ved 60 og 120 RAF-steg',
      Math.abs(d120 - d60) / Math.max(1, d60) < 0.15,
      'd60=' + d60.toFixed(1) + ' d120=' + d120.toFixed(1));
    log('7 stort dt (bakgrunnsfane) klemmes — ingen hopp',
      dPause <= perFrame * 3.5 + 1, 'dPause=' + dPause.toFixed(1) + ' per frame=' + perFrame.toFixed(1));

    await p.evaluate(() => { window.requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now()), 16); });
    await pointer(p, 'pointerup', it.x, 806); await p.waitForTimeout(500);
    log('7 ingen JS-feil', errs.length === 0, errs.join(' | '));
    await p.close();
  }

  /* ===== 8) lostpointercapture / blur avbryter et hengende drag ===== */
  for (const C of [{ n: 'lostpointercapture', fire: (p) => p.evaluate(() => {
      const el = document.querySelector('.dragging') || document.body;
      el.dispatchEvent(new PointerEvent('lostpointercapture', { bubbles: true, composed: true, pointerId: 7, pointerType: 'touch' }));
    }) },
    { n: 'window blur', fire: (p) => p.evaluate(() => window.dispatchEvent(new Event('blur'))) }]) {
    const p = await b.newPage({ viewport: { width: 420, height: 820 }, hasTouch: true, isMobile: true });
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await register(p); await seed(p, [['A', 8], ['B', 8], ['C', 8]]);

    const order0 = await p.evaluate(() => [...document.querySelectorAll('.board .card')].map((c) => c.dataset.id));
    const h = await centerOf(p, '.card[data-id="card-A"] .card-head');
    await pointer(p, 'pointerdown', h.x, h.y); await p.waitForTimeout(260);
    await pointer(p, 'pointermove', h.x, 790); await p.waitForTimeout(200); // auto-scroll i gang
    const lifted = await p.evaluate(() => document.querySelectorAll('.card.dragging').length);
    log('8 ' + C.n + ': draget var aktivt før avbruddet', lifted === 1, 'dragging=' + lifted);

    await C.fire(p); await p.waitForTimeout(200);
    const r = await residue(p);
    log('8 ' + C.n + ': ingen .dragging / placeholder igjen', r.dragging === 0 && r.ph === 0, JSON.stringify(r));
    log('8 ' + C.n + ': global dra-cursor fjernet', r.isDragging === false && r.cursor !== 'grabbing', 'cursor=' + r.cursor);
    log('8 ' + C.n + ': ingen inline-posisjonsstil igjen på objektet',
      !/left:|top:|width:|height:/.test(r.inlinePos), 'style=' + r.inlinePos);
    log('8 ' + C.n + ': board-vakt + overflowAnchor ryddet',
      r.boardGuard === '|' && r.overflowAnchor === '', 'guard=' + r.boardGuard + ' anchor=' + r.overflowAnchor);

    // Auto-scrollen skal være stoppet: scroll-posisjonen står stille etterpå.
    const y1 = await p.evaluate(() => window.scrollY);
    await p.waitForTimeout(400);
    const y2 = await p.evaluate(() => window.scrollY);
    log('8 ' + C.n + ': auto-scroll stoppet', Math.abs(y2 - y1) < 2, 'y1=' + y1 + ' y2=' + y2);

    const order1 = await p.evaluate(() => [...document.querySelectorAll('.board .card')].map((c) => c.dataset.id));
    log('8 ' + C.n + ': avbrutt drag lagret ingen ny rekkefølge',
      JSON.stringify(order1) === JSON.stringify(order0), order0.join(',') + ' → ' + order1.join(','));
    log('8 ' + C.n + ': ingen JS-feil', errs.length === 0, errs.join(' | '));
    await p.close();
  }

  /* ===== 9) Ekstern window-scroll under listepunkt-/kategori-drag ===== */
  for (const K of [{ n: 'listepunkt', sel: '.item[data-id="it-A-3"]', drag: '.item.dragging' },
    { n: 'kategori', sel: '.category[data-id="cat-A"] .cat-head', drag: '.category.dragging' }]) {
    const p = await b.newPage({ viewport: { width: 420, height: 820 }, hasTouch: true, isMobile: true });
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await register(p); await seed(p, [['A', 12, 4], ['B', 20]]);
    // Rull målet inn i syne (kategorien ligger langt nede) — og la det være rom
    // igjen under, så den eksterne scrollen under draget faktisk kan skje.
    await p.evaluate((sel) => document.querySelector(sel).scrollIntoView({ block: 'center' }), K.sel);
    await p.waitForTimeout(250);

    const src = await centerOf(p, K.sel);
    await pointer(p, 'pointerdown', src.x, src.y); await p.waitForTimeout(260);
    await pointer(p, 'pointermove', src.x, src.y + 6); await p.waitForTimeout(400); // kategori-kollapsen ferdig
    const off1 = await dragTopOffset(p, K.drag, src.y + 6);
    // Siden scroller UTENFOR draget (momentum/klemme/tastatur) — objektet ligger i
    // dokument-koordinater og må reposisjoneres for å bli liggende under pekeren.
    await p.evaluate(() => window.scrollBy(0, 150)); await p.waitForTimeout(150);
    const off2 = await dragTopOffset(p, K.drag, src.y + 6);
    const scrolled = await p.evaluate(() => Math.round(window.scrollY));
    log('9 ' + K.n + ': siden scrollet faktisk', scrolled > 100, 'scrollY=' + scrolled);
    log('9 ' + K.n + ': objektet ligger fortsatt under pekeren etter ekstern scroll',
      Math.abs(off2 - off1) < 3, 'off1=' + off1.toFixed(1) + ' off2=' + off2.toFixed(1));
    await pointer(p, 'pointerup', src.x, src.y + 6); await p.waitForTimeout(500);
    log('9 ' + K.n + ': ingen JS-feil', errs.length === 0, errs.join(' | '));
    await p.close();
  }

  await b.close();
  const failed = results.filter((x) => !x).length;
  console.log('\n==== ' + (results.length - failed) + '/' + results.length + ' PASS ====');
  process.exit(failed ? 1 : 0);
})();
