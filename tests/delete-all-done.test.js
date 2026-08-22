/*
  Regresjonstest: 🗑-knappen på «Utført»-linja (slett alle utførte).

  Knappen står på SAMME linje som «Utført»-tittelen, til HØYRE for ⟲-knappen
  (gjenopprett alle, se restore-all-done.test.js) — ytterst på linja, i samme
  kolonne som listepunktenes menyknapp. Et klikk sender ALLE avkryssede
  listepunkter i lista til element-søppelkassen på én gang, akkurat som ved
  enkeltsletting (× på raden): buffret sletting + sticky angre-toast, «Utført»-
  seksjonen tømmes og skjules med én gang, og slettingen committes (trashed =
  true) først når angre-vinduet utløper. I en låst liste er knappen skjult.

  Kjør:
    python3 -m http.server 8000                     # fra repo-roten, i egen terminal
    NODE_PATH=$(npm root -g) node tests/delete-all-done.test.js
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
  await p.locator('#auth-submit').click();
  await p.waitForFunction(() => {
    const H = window.__huskis;
    return H && H.authUser && H.lastMy;
  }, null, { timeout: 10000, polling: 200 });
  // Introduksjonen (docs/introduksjon.md) møter enhver ny konto — se
  // tests/CLAUDE.md. Ikke det denne testen handler om.
  await p.evaluate(() => window.__huskis.tour.skipAll());
  await p.waitForTimeout(150);
}

// Kort med tre nivå-1-listepunkter + en kategori med to medlemmer — samme
// oppsett som restore-all-done.test.js, så de to testene dekker samme form.
async function seed(p) {
  await p.evaluate(() => { window.__huskis.addUniverse(); }); await p.waitForTimeout(150);
  await p.keyboard.press('Escape'); await p.waitForTimeout(150);
  await p.evaluate(() => { window.__huskis.addGroup(); }); await p.waitForTimeout(150);
  await p.keyboard.press('Escape'); await p.waitForTimeout(150);
  await p.evaluate(() => {
    const H = window.__huskis, st = H.state;
    const u = st.universes.find((x) => x.id === st.activeUniverse);
    const g = u.groups.find((x) => x.id === st.activeGroup);
    const mk = (pos) => ({ ts: 0, org: 't', pos, posTs: 0, posOrg: 't' });
    const c = Object.assign({ id: 'card-A', group: g.id, title: 'A', trashed: false, k: true, p: true, labTs: 0, labOrg: 't', items: [] }, mk(0));
    const item = (id, text, pos, cat) => Object.assign(
      { id, text, home: 'card-A', cat: cat || null, trashed: false, done: false }, mk(pos));
    const cat = Object.assign(
      { id: 'cat-1', text: 'Kategori', home: 'card-A', cat: null, isCat: true, trashed: false, done: false }, mk(2));
    c.items.push(item('it-0', 'Ett', 0), item('it-1', 'To', 1), cat,
      item('it-2', 'Tre', 3), item('it-3', 'I kat A', 4, 'cat-1'), item('it-4', 'I kat B', 5, 'cat-1'));
    g.cards = [c];
    H.render();
  });
  await p.waitForTimeout(300);
}

const itemsState = (p) => p.evaluate(() => {
  const H = window.__huskis, st = H.state;
  const u = st.universes.find((x) => x.id === st.activeUniverse);
  const g = u.groups.find((x) => x.id === st.activeGroup);
  return g.cards.find((x) => x.id === 'card-A').items
    .filter((i) => !i.isCat).map((i) => ({
      id: i.id, done: !!i.done, pending: !!i._pendingDelete, trashed: !!i.trashed,
    }));
});

const dom = (p) => p.evaluate(() => {
  const c = document.querySelector('.card[data-id="card-A"]');
  const txt = (sel) => [...c.querySelectorAll(sel)].map((e) => e.querySelector('.item-text').textContent);
  const trashBtn = c.querySelector('.item-trash-btn');
  return {
    level1: txt(':scope > .card-body > .items-container > .item'),
    inCat: txt('.category[data-id="cat-1"] .cat-items > .item'),
    done: txt('.items-done > .item'),
    doneWrapHidden: c.querySelector('.items-done-wrap').hidden,
    trashWrapHidden: trashBtn.closest('.item-trash').hidden,
    trashCount: trashBtn.querySelector('.trashcan-count').textContent,
  };
});

const toastInfo = (p) => p.evaluate(() => {
  const t = document.getElementById('toast');
  return t ? { shown: t.classList.contains('show'), text: t.textContent } : { shown: false, text: '' };
});

const results = [];
const log = (n, ok, x = '') => { results.push(ok); console.log((ok ? 'PASS' : 'FAIL') + ' — ' + n + (x ? '  [' + x + ']' : '')); };

async function run(label, vp, mobile) {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: vp, isMobile: mobile, hasTouch: mobile });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  console.log('\n== ' + label + ' ==');
  await register(p);
  await seed(p);
  const card = p.locator('.card[data-id="card-A"]');

  /* ---------- 1) Knappen er skjult sammen med «Utført»-seksjonen ---------- */
  let d = await dom(p);
  log(label + ' 1: «Utført»-seksjonen (og 🗑) er skjult når ingenting er avkrysset',
    d.doneWrapHidden === true);

  /* ---------- 2) Kryss av fire (to på nivå 1, to i kategorien) ---------- */
  for (const id of ['it-0', 'it-2', 'it-3', 'it-4']) {
    await card.locator('.item[data-id="' + id + '"] .item-check').click();
    await p.waitForTimeout(380);
  }
  d = await dom(p);
  log(label + ' 2: fire listepunkter ligger i «Utført», ett igjen på nivå 1',
    d.done.length === 4 && d.level1.length === 1 && d.inCat.length === 0, JSON.stringify(d));

  /* ---------- 3) Plassering: samme linje som «Utført», til HØYRE for ⟲ ---------- */
  const geom = await p.evaluate(() => {
    const c = document.querySelector('.card[data-id="card-A"]');
    const div = c.querySelector('.done-divider');
    const restore = div.querySelector('.done-restore').getBoundingClientRect();
    const del = div.querySelector('.done-delete').getBoundingClientRect();
    const dr = div.getBoundingClientRect();
    const x = c.querySelector('.items-done .obj-menu-btn').getBoundingClientRect();
    return {
      visible: !div.querySelector('.done-delete').hidden,
      overlapY: Math.min(restore.bottom, del.bottom) - Math.max(restore.top, del.top),
      rightOfRestore: del.left > restore.right,
      insideDivider: del.right <= dr.right + 0.5,
      xCenterDelta: Math.round((del.left + del.width / 2) - (x.left + x.width / 2)),
      w: Math.round(del.width), h: Math.round(del.height),
    };
  });
  log(label + ' 3: 🗑 er synlig', geom.visible === true);
  log(label + ' 3: 🗑 står på SAMME linje som ⟲ (vertikal overlapp)',
    geom.overlapY > 0, 'overlapp=' + geom.overlapY);
  log(label + ' 3: 🗑 står til HØYRE for ⟲, innenfor linja',
    geom.rightOfRestore === true && geom.insideDivider === true, JSON.stringify(geom));
  log(label + ' 3: 🗑 flukter med listepunktenes menyknapp-kolonne',
    Math.abs(geom.xCenterDelta) <= 1, 'delta=' + geom.xCenterDelta);
  log(label + ' 3: 🗑 har full trykkflate (36×36)',
    geom.w === 36 && geom.h === 36, geom.w + '×' + geom.h);

  /* ---------- 4) Klikk sender ALLE utførte til søppelkassen på én gang ---------- */
  await card.locator('.done-delete').click(); await p.waitForTimeout(500);
  d = await dom(p);
  let st = await itemsState(p);
  log(label + ' 4: «Utført»-seksjonen er tom og skjult',
    d.done.length === 0 && d.doneWrapHidden === true, JSON.stringify(d));
  log(label + ' 4: de fire utførte er buffret i søpla (ikke committet ennå)',
    st.filter((i) => ['it-0', 'it-2', 'it-3', 'it-4'].includes(i.id))
      .every((i) => i.pending === true && i.trashed === false), JSON.stringify(st));
  log(label + ' 4: det femte (aldri avkrysset) er urørt',
    st.find((i) => i.id === 'it-1').pending === false, JSON.stringify(st));
  log(label + ' 4: nivå 1 og kategorien er urørt bortsett fra de slettede',
    JSON.stringify(d.level1) === JSON.stringify(['To']) && d.inCat.length === 0, JSON.stringify(d));
  log(label + ' 4: element-søppelkassen viser de fire, og er synlig',
    d.trashCount === '4' && d.trashWrapHidden === false, JSON.stringify(d));
  const toast = await toastInfo(p);
  log(label + ' 4: en angrbar toast kom',
    toast.shown === true && /ngre|søppel/i.test(toast.text), JSON.stringify(toast));

  /* ---------- 5) «Angre» i toasten gjenoppretter alle fire ---------- */
  await p.locator('#toast .toast-action').click(); await p.waitForTimeout(400);
  d = await dom(p);
  st = await itemsState(p);
  log(label + ' 5: «Angre» fjerner bufferet — ingen er lenger pending/trashed',
    st.every((i) => i.pending === false && i.trashed === false), JSON.stringify(st));
  log(label + ' 5: de fire er tilbake i «Utført»',
    d.done.length === 4 && d.doneWrapHidden === false, JSON.stringify(d));
  log(label + ' 5: element-søppelkassen er tom og skjult igjen',
    d.trashWrapHidden === true, JSON.stringify(d));

  /* ---------- 6) Uten angring: committes (trashed=true) og overlever reload ---------- */
  await card.locator('.done-delete').click(); await p.waitForTimeout(500);
  await p.waitForTimeout(5200); // FAST: venter ut DELETE_BUFFER_MS (angre-vinduet)
  st = await itemsState(p);
  log(label + ' 6: etter angre-vinduet er de fire committet til søpla (trashed)',
    st.filter((i) => ['it-0', 'it-2', 'it-3', 'it-4'].includes(i.id)).every((i) => i.trashed === true),
    JSON.stringify(st));
  await p.reload();
  await p.waitForFunction(() => {
    const H = window.__huskis;
    return H && H.authUser && H.lastMy;
  }, null, { timeout: 10000, polling: 200 });
  st = await itemsState(p);
  log(label + ' 6: overlever reload',
    st.filter((i) => ['it-0', 'it-2', 'it-3', 'it-4'].includes(i.id)).every((i) => i.trashed === true) &&
    st.find((i) => i.id === 'it-1').trashed === false, JSON.stringify(st));

  /* ---------- 7) Låst liste: 🗑 er skjult ---------- */
  const lockedHidden = await p.evaluate(() => {
    const H = window.__huskis, st2 = H.state;
    const u = st2.universes.find((x) => x.id === st2.activeUniverse);
    const g = u.groups.find((x) => x.id === st2.activeGroup);
    const c = g.cards.find((x) => x.id === 'card-A');
    u._role = 'member'; g._role = null; c._locked = true;
    H.render();
    const el = document.querySelector('.card[data-id="card-A"] .done-delete');
    return { hidden: !!el.hidden };
  });
  await p.waitForTimeout(200);
  log(label + ' 7: 🗑 er skjult i en låst liste (som ⟲ og avmerkingsboksene)',
    lockedHidden.hidden === true, JSON.stringify(lockedHidden));

  log(label + ': ingen JS-feil', errs.length === 0, errs.join(' | '));
  await p.close();
  await b.close();
}

(async () => {
  await run('desktop', { width: 1200, height: 900 }, false);
  await run('mobil', { width: 390, height: 780 }, true);
  const failed = results.filter((x) => !x).length;
  console.log('\n==== ' + (results.length - failed) + '/' + results.length + ' PASS ====');
  process.exit(failed ? 1 : 0);
})();
