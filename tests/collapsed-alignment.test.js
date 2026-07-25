/*
  Regresjonstest: vertikal justering i KOLLAPSEDE lister og kategorier.

   1. «(N)»-telleren står på samme skriftlinje som tittelen (samme baseline) —
      før koblet `align-self: flex-start` på titlene ut `.title-line`s baseline-
      justering, så telleren leste som hevet skrift.
   2. En kollapset kategori er nøyaktig sin overskriftslinje, med LIK luft over og
      under (den nullhøye `.cat-items` la igjen et ekstra 4px-gap under headeren).
   3. Innholdet er vertikalt sentrert: tittel og knapper har samme senter som
      headeren, i både kollapset liste og kollapset kategori.

  Kjør:
    python3 -m http.server 8000                        # fra repo-roten, i egen terminal
    NODE_PATH=$(npm root -g) node tests/collapsed-alignment.test.js
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

// Én liste: et listepunkt, en kategori med to medlemmer, og et listepunkt til —
// kategorien får da skillelinjer både over (::before) og under (::after) seg.
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
    const c = Object.assign({ id: 'card-A', group: g.id, title: 'Liste 1', trashed: false, k: true, p: true, labTs: 0, labOrg: 't', items: [] }, mk());
    const row = (id, text, pos, extra) => Object.assign({ id, text, home: 'card-A', cat: null, trashed: false, done: false }, mk(), { pos }, extra);
    c.items.push(
      row('it-1', 'Punkt over', 0),
      row('cat-1', 'Kategori 1', 1, { isCat: true }),
      row('it-2', 'I kategorien', 1, { cat: 'cat-1' }),
      row('it-3', 'Også i kategorien', 2, { cat: 'cat-1' }),
      row('it-4', 'Punkt under', 2),
    );
    g.cards = [c];
    H.render();
  });
  await p.waitForTimeout(300);
}

// Baseline + sentre. Baselinen måles med en 0×0 `inline-block`-sonde med
// `overflow: hidden`: da er dens BUNNKANT elementets baseline, og siden den er
// høydeløs vokser ikke linjeboksen (en sonde med tekst forskjøv målingen).
const geom = (p) => p.evaluate(() => {
  const baseline = (el) => {
    const probe = document.createElement('span');
    probe.style.cssText = 'display:inline-block;vertical-align:baseline;width:0;height:0;overflow:hidden';
    el.appendChild(probe);
    const b = probe.getBoundingClientRect().bottom;
    probe.remove();
    return +b.toFixed(2);
  };
  const mid = (el) => { const r = el.getBoundingClientRect(); return +((r.top + r.bottom) / 2).toFixed(2); };
  const card = document.querySelector('.card');
  const head = card.querySelector('.card-head');
  const cat = card.querySelector('.category');
  const ch = cat.querySelector('.cat-head');
  const rHead = ch.getBoundingClientRect(), rCat = cat.getBoundingClientRect();
  return {
    card: {
      collapsed: card.classList.contains('collapsed'),
      titleBase: baseline(head.querySelector('.card-title')),
      countBase: baseline(head.querySelector('.collapse-count')),
      headMid: mid(head), titleMid: mid(head.querySelector('.card-title')),
      cogMid: mid(head.querySelector('.card-cog')), delMid: mid(head.querySelector('.card-delete')),
    },
    cat: {
      collapsed: cat.classList.contains('collapsed'),
      titleBase: baseline(ch.querySelector('.cat-title')),
      countBase: baseline(ch.querySelector('.collapse-count')),
      headMid: mid(ch), titleMid: mid(ch.querySelector('.cat-title')),
      cogMid: mid(ch.querySelector('.cat-cog')), disMid: mid(ch.querySelector('.cat-dissolve')),
      // Luft fra kategoriens boks-kant til overskriften: over/under skal være lik
      // (boksen rommer skillelinjene med margene sine).
      above: +(rHead.top - rCat.top).toFixed(2),
      below: +(rCat.bottom - rHead.bottom).toFixed(2),
    },
  };
});

(async () => {
  const b = await chromium.launch();
  const results = [];
  const log = (n, ok, x = '') => { results.push(ok); console.log((ok ? 'PASS' : 'FAIL') + ' — ' + n + (x ? '  [' + x + ']' : '')); };
  const near = (a, c, tol = 0.6) => Math.abs(a - c) <= tol;

  for (const [name, viewport] of [['desktop', { width: 1280, height: 900 }], ['mobil', { width: 420, height: 900 }]]) {
    const p = await b.newPage({ viewport });
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await register(p); await seed(p);

    // Kollaps kategorien (klikk på overskriftslinjen).
    await p.locator('.card .category .cat-head').click(); await p.waitForTimeout(400);
    let g = await geom(p);
    log(name + ': kategorien er kollapset', g.cat.collapsed === true);
    log(name + ': «(N)» på samme baseline som kategori-tittelen', near(g.cat.titleBase, g.cat.countBase),
      'tittel=' + g.cat.titleBase + ' teller=' + g.cat.countBase);
    log(name + ': lik luft over og under en kollapset kategori', near(g.cat.above, g.cat.below),
      'over=' + g.cat.above + ' under=' + g.cat.below);
    log(name + ': kategori-innholdet er vertikalt sentrert i overskriftslinjen',
      near(g.cat.titleMid, g.cat.headMid) && near(g.cat.cogMid, g.cat.headMid) && near(g.cat.disMid, g.cat.headMid),
      'head=' + g.cat.headMid + ' tittel=' + g.cat.titleMid + ' tannhjul=' + g.cat.cogMid + ' oppløs=' + g.cat.disMid);

    // Kollaps lista (klikk på korthodet).
    await p.locator('.card .card-head').click(); await p.waitForTimeout(400);
    g = await geom(p);
    log(name + ': lista er kollapset', g.card.collapsed === true);
    log(name + ': «(N)» på samme baseline som listetittelen', near(g.card.titleBase, g.card.countBase),
      'tittel=' + g.card.titleBase + ' teller=' + g.card.countBase);
    log(name + ': liste-innholdet er vertikalt sentrert i korthodet',
      near(g.card.titleMid, g.card.headMid) && near(g.card.cogMid, g.card.headMid) && near(g.card.delMid, g.card.headMid),
      'head=' + g.card.headMid + ' tittel=' + g.card.titleMid + ' tannhjul=' + g.card.cogMid + ' ×=' + g.card.delMid);

    log(name + ': ingen JS-feil', errs.length === 0, errs.join(' | '));
    await p.close();
  }

  await b.close();
  const failed = results.filter((x) => !x).length;
  console.log('\n==== ' + (results.length - failed) + '/' + results.length + ' PASS ====');
  process.exit(failed ? 1 : 0);
})();
