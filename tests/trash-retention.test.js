/*
  Den automatiske tømmingen av søppelkassene (docs/trash.md, «Automatisk
  tømming»), sett fra appen og mot mock-backenden (?mock=1), som speiler
  seksjon 9g i users-and-sharing.sql.

  Dekker:
    1. Konto-modalen har valget, med fem tider og 30 dager som standard.
    2. Et slettet listepunkt får serverens klokke (`trashed_at`/`trashed_by`)
       når slettingen lander — og toasten sier «Lagt i søppelkassen».
    3. Kassen sier hvor lenge det ligger der («30 dager»).
    4. Kjøreplanens tikk: 29 døgn i kassen → blir liggende; 31 døgn → slettet
       for godt (gravstein), og raden forsvinner fra appen ved neste synk.
    5. Bytter man til «1 time», tømmes det som allerede er utløpt etter den nye
       fristen med én gang — uten å vente på kjøreplanen.
    6. «Umiddelbart»: toasten sier «Slettet», og listepunktet er slettet for
       godt på serveren og borte fra appen uten noe tikk i kjøreplanen.
    7. Ingen JS-feil.

  Logikk, ikke layout: ett viewport holder.

  Kjør:
    python3 -m http.server 8000                     # fra repo-roten, i egen terminal
    NODE_PATH=$(npm root -g) node tests/trash-retention.test.js
*/
const { chromium } = require('playwright');

const BASE = process.env.HUSKIS_URL || 'http://localhost:8000';
const DAY = 24 * 3600 * 1000;

const results = [];
const log = (n, ok, x = '') => { results.push(ok); console.log((ok ? 'PASS' : 'FAIL') + ' — ' + n + (x ? '  [' + x + ']' : '')); };

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
  await p.evaluate(() => window.__huskis.tour.skipAll());
  await p.waitForTimeout(150);
}

// Ett område, én mappe, én liste med fire listepunkter — med ekte UUID-er,
// for de skal ut på (mock-)serveren.
async function seed(p) {
  await p.evaluate(() => { window.__huskis.addUniverse(); }); await p.waitForTimeout(150);
  await p.keyboard.press('Escape'); await p.waitForTimeout(150);
  await p.evaluate(() => { window.__huskis.addGroup(); }); await p.waitForTimeout(150);
  await p.keyboard.press('Escape'); await p.waitForTimeout(150);
  const ids = await p.evaluate(() => {
    const H = window.__huskis, st = H.state;
    const u = st.universes.find((x) => x.id === st.activeUniverse);
    const g = u.groups.find((x) => x.id === st.activeGroup);
    const mk = (pos) => ({ ts: 1, org: 't', pos, posTs: 1, posOrg: 't' });
    const cid = crypto.randomUUID();
    const c = Object.assign({ id: cid, group: g.id, title: 'Liste', trashed: false, k: true, p: true, labTs: 0, labOrg: 't', items: [] }, mk(0));
    const ids = ['Gammel', 'Nesten', 'Timen', 'Straks'].map((text, i) => {
      const id = crypto.randomUUID();
      c.items.push(Object.assign({ id, text, home: cid, cat: null, trashed: false, done: false }, mk(i)));
      return id;
    });
    g.cards = [c];
    H.render();
    H.save();
    return { card: cid, items: ids };
  });
  await p.waitForFunction((ids) => {
    const db = window.HK_MOCK._loadDB();
    return ids.every((id) => db.items.some((r) => r.id === id));
  }, ids.items, { timeout: 15000, polling: 200 });
  return ids;
}

const dbItem = (p, id) => p.evaluate((id) => {
  const db = window.HK_MOCK._loadDB();
  const r = db.items.find((x) => x.id === id);
  return r ? { trashed: !!r.trashed, at: r.trashed_at || null, by: r.trashed_by || null } : null;
}, id);
const tombed = (p, id) => p.evaluate((id) =>
  window.HK_MOCK._loadDB().tombstones.some((t) => t.resource_type === 'item' && t.resource_id === id), id);
const inState = (p, id) => p.evaluate((id) => {
  for (const u of window.__huskis.state.universes)
    for (const g of u.groups || []) for (const c of g.cards || []) if ((c.items || []).some((i) => i.id === id)) return true;
  return false;
}, id);
const toastText = (p) => p.evaluate(() => (document.getElementById('toast') || {}).textContent || '');

async function deleteAndLand(p, ids, id) {
  await p.evaluate(({ card, id }) => window.__huskis.deleteItem({ id, home: card }), { card: ids.card, id });
  await p.waitForTimeout(100);
  const msg = await toastText(p);
  // Angre-vinduet (5 s) må gå ut før slettingen sendes — det er det som måles.
  await p.waitForFunction((id) => {
    const r = window.HK_MOCK._loadDB().items.find((x) => x.id === id);
    return !r || (r.trashed && r.trashed_at);
  }, id, { timeout: 20000, polling: 200 });
  return msg;
}
async function age(p, id, ms) {
  await p.evaluate(({ id, ms }) => window.HK_MOCK._edit((db) => {
    const r = db.items.find((x) => x.id === id);
    if (r) r.trashed_at = Date.now() - ms;
  }), { id, ms });
}

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1200, height: 900 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await register(p);
  const ids = await seed(p);
  const [OLD, NEAR, HOUR, NOW] = ids.items;

  /* ---------- 1. valget i konto-modalen ---------- */
  await p.evaluate(() => window.__huskis.openAccount());
  await p.waitForTimeout(200);
  const sel = await p.evaluate(() => {
    const s = document.getElementById('trash-retention-select');
    const row = document.getElementById('menu-trash-retention');
    return s && { visible: !!(row && !row.hidden && s.offsetParent), value: s.value,
      options: [...s.options].map((o) => o.value + '=' + o.textContent) };
  });
  log('1: konto-modalen viser valget med fem tider, 30 dager som standard',
    !!sel && sel.visible && sel.options.length === 5 && sel.value === String(30 * 86400),
    JSON.stringify(sel));
  await p.evaluate(() => window.__huskis.closeAccount());

  /* ---------- 2. klokka stemples når slettingen lander ---------- */
  const uid = await p.evaluate(() => window.__huskis.authUser.id);
  const msg1 = await deleteAndLand(p, ids, OLD);
  await deleteAndLand(p, ids, NEAR);
  const r1 = await dbItem(p, OLD);
  log('2: slettingen får serverens klokke og hvem som slettet',
    !!r1 && r1.trashed && Math.abs(Date.now() - r1.at) < 60000 && r1.by === uid, JSON.stringify(r1));
  log('2b: toasten sier «Lagt i søppelkassen»', /Lagt i søppelkassen/.test(msg1), msg1);

  /* ---------- 3. kassen sier hvor lenge ---------- */
  await p.evaluate((card) => {
    const H = window.__huskis;
    for (const u of H.state.universes) for (const g of u.groups || []) for (const c of g.cards || [])
      if (c.id === card) H.openItemsTrash(c);
  }, ids.card);
  await p.waitForFunction(() => !document.getElementById('trash-modal').hidden, null, { timeout: 3000 });
  const note = await p.evaluate(() => document.getElementById('trash-note').textContent);
  log('3: kassen sier at det ligger der i 30 dager', /30 dager/.test(note), note);
  await p.keyboard.press('Escape');
  await p.waitForTimeout(200);

  /* ---------- 4. kjøreplanens tikk ---------- */
  await age(p, OLD, 31 * DAY);
  await age(p, NEAR, 29 * DAY);
  const purged = await p.evaluate(() => window.HK_MOCK.purgeExpiredTrash());
  log('4: tikket sletter det som har ligget i 31 døgn, med gravstein',
    purged === 1 && !(await dbItem(p, OLD)) && await tombed(p, OLD), 'slettet ' + purged);
  log('4b: … og lar det som har ligget i 29 døgn være', !!(await dbItem(p, NEAR)));
  await p.waitForFunction((id) => {
    for (const u of window.__huskis.state.universes)
      for (const g of u.groups || []) for (const c of g.cards || []) if ((c.items || []).some((i) => i.id === id)) return false;
    return true;
  }, OLD, { timeout: 15000, polling: 200 }).catch(() => {});
  log('4c: raden forsvinner fra appen ved neste synk', !(await inState(p, OLD)));

  /* ---------- 5. bytte til «1 time» tømmer det utløpte straks ---------- */
  await p.evaluate(() => window.__huskis.openAccount());
  await p.waitForTimeout(200);
  await p.locator('#trash-retention-select').selectOption(String(3600));
  await p.waitForFunction((id) => !window.HK_MOCK._loadDB().items.some((x) => x.id === id),
    NEAR, { timeout: 10000, polling: 200 }).catch(() => {});
  const meta = await p.evaluate(() => {
    const db = window.HK_MOCK._loadDB();
    const me = db.profiles.find((x) => x.id === window.__huskis.authUser.id);
    return me && me.user_metadata && me.user_metadata.trash_retention;
  });
  log('5: valget lagres på kontoen', meta === 3600, String(meta));
  log('5b: det som var utløpt etter den nye fristen, er slettet uten et tikk',
    !(await dbItem(p, NEAR)) && await tombed(p, NEAR));
  await p.evaluate(() => window.__huskis.closeAccount());

  /* ---------- 6. «Umiddelbart» ---------- */
  await p.evaluate(() => window.__huskis.openAccount());
  await p.waitForTimeout(200);
  await p.locator('#trash-retention-select').selectOption('0');
  await p.waitForFunction(() => {
    const db = window.HK_MOCK._loadDB();
    const me = db.profiles.find((x) => x.id === window.__huskis.authUser.id);
    return me && me.user_metadata && me.user_metadata.trash_retention === 0;
  }, null, { timeout: 5000, polling: 100 });
  await p.evaluate(() => window.__huskis.closeAccount());
  const msg2 = await deleteAndLand(p, ids, NOW);
  log('6: toasten sier «Slettet», ikke «Lagt i søppelkassen»',
    /^Slettet/.test(msg2) && !/søppelkassen/.test(msg2), msg2);
  await p.waitForFunction((id) => !window.HK_MOCK._loadDB().items.some((x) => x.id === id),
    NOW, { timeout: 15000, polling: 200 }).catch(() => {});
  log('6b: listepunktet er slettet for godt på serveren — uten noe tikk i kjøreplanen',
    !(await dbItem(p, NOW)) && await tombed(p, NOW));
  await p.waitForFunction((id) => {
    for (const u of window.__huskis.state.universes)
      for (const g of u.groups || []) for (const c of g.cards || []) if ((c.items || []).some((i) => i.id === id)) return false;
    return true;
  }, NOW, { timeout: 15000, polling: 200 }).catch(() => {});
  log('6c: … og borte fra appen', !(await inState(p, NOW)));
  log('6d: «Timen» som aldri ble slettet, står urørt', !!(await dbItem(p, HOUR)) && await inState(p, HOUR));

  log('7: ingen JS-feil', errs.length === 0, errs.join(' | '));
  await b.close();
  const ok = results.filter(Boolean).length;
  console.log('\n==== ' + ok + '/' + results.length + ' PASS ====');
  process.exit(ok === results.length ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
