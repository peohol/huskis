/*
  Regresjonstest: DnD-layoutmodus følger BOARD-LAYOUTEN (én/flere kolonner),
  ikke bare pointerType. Normal-flow-vakten (freezeBoardForDrag → min-height +
  padding-top) aktiveres KUN når input er touch/pen OG board-et er i énkolonne-
  layout. I flerkolonnelayout (bredt vindu, inkl. Androids «Side for datamaskin»
  på touch) får DnD desktop-oppførsel: naturlig kollaps, ingen vakt.

  Kjør:
    python3 -m http.server 8000                     # fra repo-roten, i egen terminal
    NODE_PATH=$(npm root -g) node tests/dnd-layout-modes.test.js
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

// Syntetisk touch-peker (som de øvrige DnD-testene).
async function touch(p, type, x, y) {
  await p.evaluate(({ type, x, y }) => {
    const ev = new PointerEvent(type, { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, pointerId: 7, pointerType: 'touch', button: 0, isPrimary: true });
    (type === 'pointerdown' ? (document.elementFromPoint(x, y) || document.body) : window).dispatchEvent(ev);
  }, { type, x, y });
}

const guardStyles = (p) => p.evaluate(() => {
  const bd = document.querySelector('.board');
  return { minH: bd.style.minHeight || '', pad: bd.style.paddingTop || '' };
});
const colMode = (p) => p.evaluate(() => ({
  single: getComputedStyle(document.querySelector('.board')).getPropertyValue('--mobile-dnd-flow-guard').trim() === '1',
  colCount: getComputedStyle(document.querySelector('.board')).columnCount,
}));
const headRectOf = (p, id) => p.evaluate((id) => {
  const r = document.querySelector('.card[data-id="' + id + '"] .card-head').getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}, id);

const results = [];
const log = (n, ok, x = '') => { results.push(ok); console.log((ok ? 'PASS' : 'FAIL') + ' — ' + n + (x ? '  [' + x + ']' : '')); };

(async () => {
  const b = await chromium.launch();

  /* ---------- 1) Flerkolonne + EKTE MUS (page.mouse) ---------- */
  {
    const p = await b.newPage({ viewport: { width: 1200, height: 800 } });
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await register(p);
    await seed(p, [['A', 3], ['B', 3], ['C', 3], ['D', 3], ['E', 3], ['F', 3]]);
    const mode = await colMode(p);
    log('1 desktop/mus: board i FLERKOLONNE', !mode.single && mode.colCount !== '1', JSON.stringify(mode));

    const before = await p.evaluate(() => [...document.querySelectorAll('.card')].map((c) => c.dataset.id));
    const h = await headRectOf(p, before[0]);
    // Ekte muse-drag: down på korthodet, beveg > HOLD_MOVE for å starte, så flytt.
    await p.mouse.move(h.x, h.y);
    await p.mouse.down();
    await p.mouse.move(h.x + 30, h.y + 30, { steps: 4 });
    await p.mouse.move(h.x + 300, h.y + 260, { steps: 8 }); // mot en annen kolonne
    await p.waitForTimeout(80);
    const during = await guardStyles(p);
    const dragging = await p.evaluate(() => document.querySelectorAll('.card.dragging').length);
    const collapsed = await p.evaluate(() => document.querySelectorAll('.card.collapsed').length);
    log('1 desktop/mus: lister kollapset under drag', collapsed >= 1, 'collapsed=' + collapsed);
    log('1 desktop/mus: INGEN board-vakt (minHeight+paddingTop tomme)', during.minH === '' && during.pad === '', JSON.stringify(during));
    log('1 desktop/mus: draget aktivt', dragging === 1, 'dragging=' + dragging);
    await p.mouse.up();
    await p.waitForTimeout(1000); // smooth-scroll + drop-transform ferdig

    const after = await p.evaluate(() => {
      const cards = [...document.querySelectorAll('.card')];
      const moved = document.querySelector('.card[data-id="card-A"]');
      const r = moved.getBoundingClientRect();
      const topbar = document.querySelector('.topbar') || document.querySelector('header');
      return {
        order: cards.map((c) => c.dataset.id),
        dragging: document.querySelectorAll('.card.dragging').length,
        ph: document.querySelectorAll('.card-placeholder').length,
        movedTop: Math.round(r.top), vh: window.innerHeight,
        topbarBottom: Math.round(topbar ? topbar.getBoundingClientRect().bottom : 0),
        trans: moved.style.transition || '', transform: moved.style.transform || '',
        guard: (document.querySelector('.board').style.minHeight || '') + '/' + (document.querySelector('.board').style.paddingTop || ''),
      };
    });
    log('1 desktop/mus: rekkefølge endret (omorganisert mellom kolonner)', JSON.stringify(after.order) !== JSON.stringify(before), before + ' → ' + after.order);
    log('1 desktop/mus: opprydding (ingen dragging/placeholder, inline-stiler ryddet)',
      after.dragging === 0 && after.ph === 0 && after.trans === '' && after.transform === '', JSON.stringify(after));
    log('1 desktop/mus: scrollet til slupt liste (under toppmeny, i viewport)',
      after.movedTop >= after.topbarBottom - 6 && after.movedTop < after.vh - 20, 'top=' + after.movedTop + ' tbBottom=' + after.topbarBottom);
    log('1 desktop/mus: board-vakt ryddet', after.guard === '/', 'guard=' + after.guard);
    log('1 desktop/mus: ingen JS-feil', errs.length === 0, errs.join(' | '));
    await p.close();
  }

  /* ---------- 2) Flerkolonne + BRED TOUCH («Side for datamaskin») ---------- */
  {
    const p = await b.newPage({ viewport: { width: 1200, height: 800 }, hasTouch: true });
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await register(p);
    await seed(p, [['A', 6], ['B', 6], ['C', 6], ['D', 6], ['E', 6], ['F', 6]]);
    const mode = await colMode(p);
    log('2 bred touch: board i FLERKOLONNE', !mode.single && mode.colCount !== '1', JSON.stringify(mode));

    const before = await p.evaluate(() => [...document.querySelectorAll('.card')].map((c) => c.dataset.id));
    const h = await headRectOf(p, before[0]);
    await touch(p, 'pointerdown', h.x, h.y); await p.waitForTimeout(260); // touch-hold
    await touch(p, 'pointermove', h.x + 6, h.y + 6); await p.waitForTimeout(50);
    const during = await guardStyles(p);
    const collapsed = await p.evaluate(() => document.querySelectorAll('.card.collapsed').length);
    const dragging = await p.evaluate(() => document.querySelectorAll('.card.dragging').length);
    log('2 bred touch: lister kollapser MOMENTANT', collapsed >= 1, 'collapsed=' + collapsed);
    log('2 bred touch: freezeBoardForDrag IKKE aktivert (minHeight tom)', during.minH === '', 'minH=' + JSON.stringify(during.minH));
    log('2 bred touch: ingen midlertidig padding-top', during.pad === '', 'pad=' + JSON.stringify(during.pad));
    log('2 bred touch: draget aktivt', dragging === 1, 'dragging=' + dragging);
    // Overskriftene skal følge kolonneflyten (ikke flokke seg): den dratte listas
    // slot-etterfølgere er fordelt i flere kolonner → minst to distinkte kolonne-x.
    const distinctCols = await p.evaluate(() => {
      const xs = new Set([...document.querySelectorAll('.card:not(.dragging)')].map((c) => Math.round(c.getBoundingClientRect().left)));
      return xs.size;
    });
    log('2 bred touch: overskriftene følger flerkolonneflyt (≥2 kolonner)', distinctCols >= 2, 'kolonner=' + distinctCols);

    // Reorder + drop
    await touch(p, 'pointermove', h.x + 200, h.y + 220); await p.waitForTimeout(80);
    await touch(p, 'pointerup', h.x + 200, h.y + 220); await p.waitForTimeout(900);
    const after = await p.evaluate(() => ({
      dragging: document.querySelectorAll('.card.dragging').length,
      ph: document.querySelectorAll('.card-placeholder').length,
      guard: (document.querySelector('.board').style.minHeight || '') + '/' + (document.querySelector('.board').style.paddingTop || ''),
    }));
    log('2 bred touch: drop rydder opp + ingen vakt-rester', after.dragging === 0 && after.ph === 0 && after.guard === '/', JSON.stringify(after));

    // pointercancel-rollback i flerkolonne-touch
    const before2 = await p.evaluate(() => [...document.querySelectorAll('.card')].map((c) => c.dataset.id));
    const h2 = await headRectOf(p, before2[0]);
    await touch(p, 'pointerdown', h2.x, h2.y); await p.waitForTimeout(260);
    await touch(p, 'pointermove', h2.x + 8, h2.y + 40); await p.waitForTimeout(50);
    await touch(p, 'pointermove', h2.x + 8, h2.y + 160); await p.waitForTimeout(50);
    await touch(p, 'pointercancel', h2.x + 8, h2.y + 160); await p.waitForTimeout(200);
    const cancel = await p.evaluate(() => ({
      order: [...document.querySelectorAll('.card')].map((c) => c.dataset.id),
      dragging: document.querySelectorAll('.card.dragging').length,
      ph: document.querySelectorAll('.card-placeholder').length,
    }));
    log('2 bred touch: pointercancel ruller tilbake (rekkefølge uendret, opprydding)',
      JSON.stringify(cancel.order) === JSON.stringify(before2) && cancel.dragging === 0 && cancel.ph === 0, JSON.stringify(cancel));
    log('2 bred touch: ingen JS-feil', errs.length === 0, errs.join(' | '));
    await p.close();
  }

  /* ---------- 3) Énkolonne + TOUCH (vanlig mobil): vakten AKTIV ---------- */
  {
    const p = await b.newPage({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true });
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await register(p);
    await seed(p, [['Hoy', 20], ['Kort', 2]]);
    const mode = await colMode(p);
    log('3 mobil: board i ÉNKOLONNE', mode.single && mode.colCount === '1', JSON.stringify(mode));
    await p.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight)); await p.waitForTimeout(120);
    const hh = await headRectOf(p, 'card-Kort');
    await touch(p, 'pointerdown', hh.x, hh.y); await p.waitForTimeout(260);
    await touch(p, 'pointermove', hh.x + 3, hh.y - 3); await p.waitForTimeout(60);
    const during = await guardStyles(p);
    log('3 mobil: board-vakt AKTIV (minHeight + padding-top satt)', during.minH !== '' && during.pad !== '', JSON.stringify(during));
    await touch(p, 'pointerup', hh.x + 3, hh.y - 3); await p.waitForTimeout(900);
    const after = await guardStyles(p);
    log('3 mobil: vakt ryddet etter slipp', after.minH === '' && after.pad === '', JSON.stringify(after));
    log('3 mobil: ingen JS-feil', errs.length === 0, errs.join(' | '));
    await p.close();
  }

  /* ---------- 4) Layoutgrensen: 560 (vakt) vs 561 (ingen vakt), touch ---------- */
  for (const [w, wantGuard] of [[560, true], [561, false]]) {
    const p = await b.newPage({ viewport: { width: w, height: 800 }, hasTouch: true });
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await register(p);
    await seed(p, [['Hoy', 12], ['Midt', 8], ['Kort', 2]]);
    // Dra den ØVERSTE lista (alltid synlig uten scroll). freezeBoardForDrag setter
    // min-height uansett removedAbove, så minH-tilstedeværelse = vakt aktiv.
    const h = await headRectOf(p, 'card-Hoy');
    await touch(p, 'pointerdown', h.x, h.y); await p.waitForTimeout(260);
    await touch(p, 'pointermove', h.x + 4, h.y - 4); await p.waitForTimeout(60);
    const during = await guardStyles(p);
    const guardActive = during.minH !== '';
    log('4 grense ' + w + 'px (touch): vakt ' + (wantGuard ? 'AKTIV' : 'IKKE aktiv'), guardActive === wantGuard, JSON.stringify(during));
    await touch(p, 'pointercancel', h.x + 4, h.y - 4); await p.waitForTimeout(150);
    await p.close();
    if (errs.length) log('4 grense ' + w + ': ingen JS-feil', false, errs.join(' | '));
  }

  /* ---------- 5) prefers-reduced-motion: momentan scroll, ingen drop-tween ---------- */
  {
    const p = await b.newPage({ viewport: { width: 1200, height: 800 } });
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await p.emulateMedia({ reducedMotion: 'reduce' });
    await register(p);
    await seed(p, [['A', 3], ['B', 3], ['C', 3], ['D', 3], ['E', 3], ['F', 3]]);
    const before = await p.evaluate(() => [...document.querySelectorAll('.card')].map((c) => c.dataset.id));
    const h = await headRectOf(p, before[0]);
    await p.mouse.move(h.x, h.y);
    await p.mouse.down();
    await p.mouse.move(h.x + 30, h.y + 30, { steps: 3 });
    await p.mouse.move(h.x + 300, h.y + 260, { steps: 6 });
    await p.mouse.up();
    await p.waitForTimeout(120); // momentant: ingen tween/smooth-scroll å vente på
    const res = await p.evaluate(() => {
      const moved = document.querySelector('.card[data-id="card-A"]');
      const r = moved.getBoundingClientRect();
      const topbar = document.querySelector('.topbar') || document.querySelector('header');
      return {
        transform: moved.style.transform || '', trans: moved.style.transition || '',
        top: Math.round(r.top), vh: window.innerHeight,
        topbarBottom: Math.round(topbar ? topbar.getBoundingClientRect().bottom : 0),
        dragging: document.querySelectorAll('.card.dragging').length,
        ph: document.querySelectorAll('.card-placeholder').length,
      };
    });
    log('5 redusert bevegelse: ingen drop-tween (transform/transition tomme straks)', res.transform === '' && res.trans === '', JSON.stringify(res));
    log('5 redusert bevegelse: momentan scroll → lista under toppmenyen i viewport', res.top >= res.topbarBottom - 6 && res.top < res.vh - 20, 'top=' + res.top);
    log('5 redusert bevegelse: opprydding', res.dragging === 0 && res.ph === 0);
    log('5 redusert bevegelse: ingen JS-feil', errs.length === 0, errs.join(' | '));
    await p.close();
  }

  await b.close();
  const failed = results.filter((x) => !x).length;
  console.log('\n==== ' + (results.length - failed) + '/' + results.length + ' PASS ====');
  process.exit(failed ? 1 : 0);
})();
