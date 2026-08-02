/*
  Regresjonstest: DROP-ANIMASJONEN.

  5. Slippes objektet ved (eller utenfor) viewportkanten, skal fly-inn-animasjonen
     starte fra objektets FAKTISK RENDREDE boks — ikke fra den UKLEMTE
     `drag.lastX - grabX`, som ligger utenfor skjermen når klemmen har slått inn
     (ga et synlig hopp idet man slapp).
  6. Startskalaen i drop-animasjonen følger objekttypen (dragScale: liste 1.02,
     listepunkt 1.03, gruppe/univers 1.05) — ikke en hardkodet 1.02 for alt.

  Kjør:
    python3 -m http.server 8000                    # fra repo-roten, i egen terminal
    NODE_PATH=$(npm root -g) node tests/dnd-drop-animation.test.js
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
  // Introduksjonen (docs/introduksjon.md) møter enhver ny konto: omvisningen
  // legger seg over appen, og et gest-tips legger seg nederst på skjermen —
  // ingen av delene er det denne testen handler om.
  await p.evaluate(() => window.__huskis.tour.skipAll());
  await p.waitForTimeout(150);
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
    g.cards = cards.map(([title, n], pos) => {
      const id = 'card-' + title;
      const c = Object.assign({ id, group: g.id, title, trashed: false, k: true, p: true, labTs: 0, labOrg: 't', items: [] }, mk());
      c.pos = pos;
      for (let i = 0; i < n; i++) {
        const it = Object.assign({ id: 'it-' + title + '-' + i, text: title + ' ' + i, home: id, cat: null, trashed: false, done: false }, mk());
        it.pos = i; c.items.push(it);
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
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}, sel);

// Slipp pekeren og les AV SAMME SYNKRONE TASK hvor drop-animasjonen starter:
// dropIntoPlaceholder setter start-transformen før nettleseren maler igjen.
// `from` = objektets faktiske (u-roterte) boks der det stod malt under draget,
// `rest` = hvileboksen etter slippet. Start-transformens translate skal føre
// hvileboksen NØYAKTIG tilbake til `from` — da starter animasjonen der objektet
// faktisk var, uansett om klemmen holdt det innenfor viewporten.
const dropAndMeasure = (p, sel, x, y) => p.evaluate(({ sel, x, y }) => {
  const box = (el) => {
    const t = el.style.transform, tr = el.style.transition;
    el.style.transition = 'none'; el.style.transform = 'none';
    const r = el.getBoundingClientRect();
    el.style.transform = t; el.style.transition = tr;
    return { left: r.left, top: r.top };
  };
  const el = document.querySelector(sel);
  const from = box(el);
  window.dispatchEvent(new PointerEvent('pointerup', {
    bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y,
    pointerId: 7, pointerType: 'touch', button: 0, isPrimary: true,
  }));
  const transform = el.style.transform || '';
  const m = /translate\(([-\d.e+]+)px,\s*([-\d.e+]+)px\)/.exec(transform);
  const rest = box(el);
  return {
    from, rest, transform,
    dx: m ? parseFloat(m[1]) : NaN,
    dy: m ? parseFloat(m[2]) : NaN,
  };
}, { sel, x, y });

const scaleIn = (t) => { const m = /scale\(([\d.]+)\)/.exec(t); return m ? parseFloat(m[1]) : null; };

const results = [];
const log = (n, ok, x = '') => { results.push(ok); console.log((ok ? 'PASS' : 'FAIL') + ' — ' + n + (x ? '  [' + x + ']' : '')); };

(async () => {
  const b = await chromium.launch();

  /* ===== 5) Slipp ved/utenfor viewportkanten (klemmen aktiv) ===== */
  for (const M of [{ n: 'mobil', vw: 420, vh: 820, mob: true }, { n: 'desktop', vw: 1200, vh: 900, mob: false }]) {
    const p = await b.newPage({ viewport: { width: M.vw, height: M.vh }, hasTouch: true, isMobile: M.mob });
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await register(p); await seed(p, [['A', 4], ['B', 4], ['C', 4]]);

    const h = await centerOf(p, '.card[data-id="card-B"] .card-head');
    await pointer(p, 'pointerdown', h.x, h.y); await p.waitForTimeout(260);
    // Langt UT til høyre for viewporten: klemmen (clampToViewport) holder kortet
    // synlig, mens den uklemte posisjonen ligger flere hundre px utenfor.
    const farX = M.vw + 260;
    await pointer(p, 'pointermove', farX, h.y); await p.waitForTimeout(120);
    const clamped = await p.evaluate(() => {
      const r = document.querySelector('.card.dragging').getBoundingClientRect();
      return { right: Math.round(r.right), vw: window.innerWidth };
    });
    log('5 ' + M.n + ': kortet er klemt innenfor viewporten før slippet',
      clamped.right <= clamped.vw + 2, JSON.stringify(clamped));

    const res = await dropAndMeasure(p, '.card.dragging', farX, h.y);
    const ex = Math.abs(res.rest.left + res.dx - res.from.left);
    const ey = Math.abs(res.rest.top + res.dy - res.from.top);
    log('5 ' + M.n + ': drop-animasjonen starter der kortet FAKTISK stod (ingen hopp)',
      ex < 2 && ey < 2, 'avvik x=' + ex.toFixed(1) + ' y=' + ey.toFixed(1) + ' transform=' + res.transform);
    await p.waitForTimeout(700);
    log('5 ' + M.n + ': ingen JS-feil', errs.length === 0, errs.join(' | '));
    await p.close();
  }

  /* ===== 6) Startskala per objekttype ===== */
  {
    const p = await b.newPage({ viewport: { width: 1200, height: 900 }, hasTouch: true });
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await register(p); await seed(p, [['A', 6], ['B', 6]]);

    // LISTE → 1.02
    const ch = await centerOf(p, '.card[data-id="card-A"] .card-head');
    await pointer(p, 'pointerdown', ch.x, ch.y); await p.waitForTimeout(260);
    await pointer(p, 'pointermove', ch.x - 40, ch.y + 30); await p.waitForTimeout(120);
    const rCard = await dropAndMeasure(p, '.card.dragging', ch.x - 40, ch.y + 30);
    log('6 liste: startskala 1.02', scaleIn(rCard.transform) === 1.02, 'transform=' + rCard.transform);
    await p.waitForTimeout(700);

    // LISTEPUNKT → 1.03
    const it = await centerOf(p, '.item[data-id="it-A-2"]');
    await pointer(p, 'pointerdown', it.x, it.y); await p.waitForTimeout(260);
    await pointer(p, 'pointermove', it.x, it.y + 40); await p.waitForTimeout(120);
    const rItem = await dropAndMeasure(p, '.item.dragging', it.x, it.y + 40);
    log('6 listepunkt: startskala 1.03', scaleIn(rItem.transform) === 1.03, 'transform=' + rItem.transform);
    await p.waitForTimeout(600);

    // GRUPPE (rad i et univers-kort) → samme skala som et listepunkt (1.03)
    for (let i = 0; i < 2; i++) {
      await p.evaluate(() => { window.__huskis.addGroup(); }); await p.waitForTimeout(200);
    }
    await p.evaluate(() => { window.__huskis.openNavModal(); }); await p.waitForTimeout(400);
    const uSel = '#nav-board .card[data-id="' + await p.evaluate(() => window.__huskis.state.activeUniverse) + '"]';
    const gIds = await p.evaluate((sel) => [...document.querySelectorAll(sel + ' .items-container > .item')].map((g) => g.dataset.id), uSel);
    const g0 = await centerOf(p, uSel + ' .item[data-id="' + gIds[0] + '"]');
    await pointer(p, 'pointerdown', g0.x, g0.y); await p.waitForTimeout(260);
    // Til venstre, så dra-rotasjonen (og dermed rotate/scale-suffikset) ikke blir 0.
    await pointer(p, 'pointermove', g0.x - 90, g0.y + 30); await p.waitForTimeout(120);
    const rGroup = await dropAndMeasure(p, '#nav-board .item.dragging', g0.x - 90, g0.y + 30);
    log('6 gruppe: startskala 1.03', scaleIn(rGroup.transform) === 1.03, 'transform=' + rGroup.transform);
    await p.waitForTimeout(600);

    // UNIVERS (kort) → samme skala som en liste (1.02)
    for (let i = 0; i < 2; i++) {
      await p.evaluate(() => { window.__huskis.addUniverse(); }); await p.waitForTimeout(200);
      await p.keyboard.press('Escape'); await p.waitForTimeout(180);
    }
    await p.evaluate(() => { window.__huskis.openNavModal(); }); await p.waitForTimeout(400);
    await p.evaluate(() => { document.querySelector('#nav-modal .menu-body').scrollTop = 0; });
    await p.waitForTimeout(150);
    const uIds = await p.evaluate(() => [...document.querySelectorAll('#nav-board .card')].map((u) => u.dataset.id));
    const u0 = await centerOf(p, '#nav-board .card[data-id="' + uIds[0] + '"] .card-head');
    await pointer(p, 'pointerdown', u0.x, u0.y); await p.waitForTimeout(260);
    await pointer(p, 'pointermove', u0.x - 90, u0.y + 30); await p.waitForTimeout(120);
    const rUni = await dropAndMeasure(p, '#nav-board .card.dragging', u0.x - 90, u0.y + 30);
    log('6 univers: startskala 1.02', scaleIn(rUni.transform) === 1.02, 'transform=' + rUni.transform);
    await p.waitForTimeout(600);

    log('6 ingen JS-feil', errs.length === 0, errs.join(' | '));
    await p.close();
  }

  await b.close();
  const failed = results.filter((x) => !x).length;
  console.log('\n==== ' + (results.length - failed) + '/' + results.length + ' PASS ====');
  process.exit(failed ? 1 : 0);
})();
