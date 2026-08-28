/*
  Regresjonstest: opprettelse av listepunkter og kategorier.

  «Legg til …»-inputen er borte. Knappene (grønn ＋ = listepunkt, gul = kategori)
  står midtstilt nederst i lista og oppretter objektet MED ÉN GANG — det dukker opp
  på plassen sin med navnefeltet blankt og fokusert. Bekrefter man uten å skrive
  noe (Enter på tomt felt, Escape, eller klikk ut), fjernes det nyopprettede
  objektet igjen. Når et listepunkt får navn, opprettes neste blanke punkt
  automatisk. Samme regel gjelder ＋-knappen inne i en kategori.

  Kjør:
    python3 -m http.server 8000                     # fra repo-roten, i egen terminal
    NODE_PATH=$(npm root -g) node tests/item-creation.test.js
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
    const c = Object.assign({ id: 'card-A', group: g.id, title: 'A', trashed: false, k: true, p: true, labTs: 0, labOrg: 't', items: [] }, mk());
    const it = Object.assign({ id: 'it-a-0', text: 'Finnes fra før', home: 'card-A', cat: null, trashed: false, done: false }, mk());
    c.items.push(it);
    g.cards = [c];
    H.render();
  });
  await p.waitForTimeout(300);
}

// Aktive (ikke-slettede) rader i kortet, som {text, isCat, cat}.
const rows = (p) => p.evaluate(() => {
  const H = window.__huskis, st = H.state;
  const u = st.universes.find((x) => x.id === st.activeUniverse);
  const g = u.groups.find((x) => x.id === st.activeGroup);
  return g.cards.find((x) => x.id === 'card-A').items
    .filter((i) => !i.trashed && !i._pendingDelete)
    .map((i) => ({ text: i.text, isCat: !!i.isCat, cat: i.cat || null }));
});
const domCount = (p) => p.evaluate(() => ({
  items: document.querySelectorAll('.card[data-id="card-A"] .item').length,
  cats: document.querySelectorAll('.card[data-id="card-A"] .category').length,
  editing: document.querySelectorAll('.card[data-id="card-A"] .edit-input').length,
}));

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

  /* ---------- 1) Ingen «Legg til …»-input; knappene er midtstilt ---------- */
  const layout = await p.evaluate(() => {
    const c = document.querySelector('.card[data-id="card-A"]');
    const row = c.querySelector('.add-item-row');
    const btns = [...row.querySelectorAll('button')];
    const rr = row.getBoundingClientRect();
    const first = btns[0].getBoundingClientRect(), last = btns[btns.length - 1].getBoundingClientRect();
    return {
      inputs: c.querySelectorAll('.add-item-input, .add-item-form').length,
      btnCount: btns.length,
      rowCenter: Math.round(rr.left + rr.width / 2),
      btnsCenter: Math.round((first.left + last.right) / 2),
    };
  });
  log(label + ' 1: «Legg til …»-input/form finnes ikke', layout.inputs === 0, 'funnet=' + layout.inputs);
  log(label + ' 1: to knapper (listepunkt + kategori)', layout.btnCount === 2, 'n=' + layout.btnCount);
  log(label + ' 1: knappene er horisontalt midtstilt', Math.abs(layout.rowCenter - layout.btnsCenter) <= 1,
    'rad=' + layout.rowCenter + ' knapper=' + layout.btnsCenter);

  /* ---------- 2) ＋ oppretter straks og åpner navnefeltet (blankt, fokusert) ---------- */
  await card.locator('.add-item-btn').click(); await p.waitForTimeout(250);
  const opened = await p.evaluate(() => {
    const ae = document.activeElement;
    return { cls: ae ? ae.className : '', val: ae ? ae.value : null, items: document.querySelectorAll('.card[data-id="card-A"] .item').length };
  });
  log(label + ' 2: navnefeltet er åpent, blankt og fokusert',
    opened.cls === 'edit-input' && opened.val === '', JSON.stringify(opened));
  log(label + ' 2: raden er allerede lagt inn i lista', opened.items === 2, 'items=' + opened.items);

  await p.keyboard.type('Nytt punkt'); await p.keyboard.press('Enter'); await p.waitForTimeout(250);
  let st = await rows(p);
  let dom = await domCount(p);
  log(label + ' 2: navngitt listepunkt lagret og nytt blankt punkt åpnet',
    st.length === 3 && st[1].text === 'Nytt punkt' && !st[1].isCat && st[2].text === '' && dom.editing === 1,
    JSON.stringify(st) + ' dom=' + JSON.stringify(dom));

  await p.keyboard.type('Punkt to'); await p.keyboard.press('Enter'); await p.waitForTimeout(250);
  st = await rows(p);
  dom = await domCount(p);
  log(label + ' 2: også det automatisk opprettede punktet fortsetter kjeden',
    st.length === 4 && st[2].text === 'Punkt to' && st[3].text === '' && dom.editing === 1,
    JSON.stringify(st) + ' dom=' + JSON.stringify(dom));
  await p.keyboard.press('Enter'); await p.waitForTimeout(250);
  st = await rows(p);
  log(label + ' 2: automatisk punkt uten navn slettes med Enter', st.length === 3, JSON.stringify(st));

  /* ---------- 3) Klikk ut lagrer navnet, lager neste punkt og fjerner et blankt neste punkt ---------- */
  await card.locator('.add-item-btn').click(); await p.waitForTimeout(200);
  await p.keyboard.type('Nytt med klikk');
  await p.locator('#topbar').click({ position: { x: 5, y: 5 } }); await p.waitForTimeout(250);
  st = await rows(p); dom = await domCount(p);
  log(label + ' 3: klikk ut lagrer og åpner et nytt blankt punkt',
    st.length === 5 && st[3].text === 'Nytt med klikk' && st[4].text === '' && dom.editing === 1,
    JSON.stringify(st) + ' dom=' + JSON.stringify(dom));
  await p.locator('#topbar').click({ position: { x: 5, y: 5 } }); await p.waitForTimeout(250);
  st = await rows(p); dom = await domCount(p);
  log(label + ' 3: klikk ut fra automatisk punkt uten navn sletter det',
    st.length === 4 && dom.editing === 0, JSON.stringify(st) + ' dom=' + JSON.stringify(dom));

  /* ---------- 4) Tomt navn + Enter → objektet slettes ---------- */
  await card.locator('.add-item-btn').click(); await p.waitForTimeout(200);
  await p.keyboard.press('Enter'); await p.waitForTimeout(250);
  st = await rows(p);
  dom = await domCount(p);
  log(label + ' 4: tomt listepunkt + Enter → slettet (state + DOM)',
    st.length === 4 && dom.items === 4 && dom.editing === 0, JSON.stringify(st) + ' dom=' + JSON.stringify(dom));

  /* ---------- 4) Kategori: navngitt beholdes, tom + Enter slettes ---------- */
  await card.locator('.add-cat-btn').click(); await p.waitForTimeout(200);
  await p.keyboard.type('Min kategori'); await p.keyboard.press('Enter'); await p.waitForTimeout(250);
  st = await rows(p);
  log(label + ' 4: navngitt kategori lagret',
    st.length === 5 && st[4].isCat && st[4].text === 'Min kategori', JSON.stringify(st));

  await card.locator('.add-cat-btn').click(); await p.waitForTimeout(200);
  await p.keyboard.press('Enter'); await p.waitForTimeout(250);
  st = await rows(p);
  dom = await domCount(p);
  log(label + ' 4: tom kategori + Enter → slettet (state + DOM)',
    st.length === 5 && dom.cats === 1, JSON.stringify(st) + ' dom=' + JSON.stringify(dom));

  /* ---------- 5) ＋ inne i kategorien: samme regel ---------- */
  await card.locator('.cat-add-btn').first().click(); await p.waitForTimeout(200);
  await p.keyboard.type('I kategorien'); await p.keyboard.press('Enter'); await p.waitForTimeout(250);
  st = await rows(p);
  const inCat = st.filter((r) => r.cat);
  log(label + ' 5: navngitt listepunkt i kategorien lagret (med cat-peker)',
    inCat.length === 2 && inCat[0].text === 'I kategorien' && inCat[1].text === '', JSON.stringify(st));

  await p.keyboard.press('Enter'); await p.waitForTimeout(250);
  st = await rows(p);
  log(label + ' 5: automatisk listepunkt i kategorien slettes uten navn',
    st.filter((r) => r.cat).length === 1 && st.length === 6, JSON.stringify(st));

  await card.locator('.cat-add-btn').first().click(); await p.waitForTimeout(200);
  await p.keyboard.press('Enter'); await p.waitForTimeout(250);
  st = await rows(p);
  log(label + ' 5: tomt listepunkt i kategorien + Enter → slettet',
    st.filter((r) => r.cat).length === 1 && st.length === 6, JSON.stringify(st));

  /* ---------- 6) Escape på et tomt, nyopprettet objekt sletter det også ---------- */
  await card.locator('.add-item-btn').click(); await p.waitForTimeout(200);
  await p.keyboard.press('Escape'); await p.waitForTimeout(250);
  st = await rows(p);
  log(label + ' 6: tomt listepunkt + Escape → slettet', st.length === 6, JSON.stringify(st));

  /* ---------- 7) Escape på et EKSISTERENDE listepunkt beholder det ---------- */
  await card.locator('.item .item-text').first().click(); await p.waitForTimeout(200);
  await p.keyboard.press('Escape'); await p.waitForTimeout(250);
  st = await rows(p);
  log(label + ' 7: Escape ved omdøping av et eksisterende listepunkt sletter det IKKE',
    st.length === 6 && st[0].text === 'Finnes fra før', JSON.stringify(st));

  /* ---------- 8) Overlever reload (de slettede kommer ikke tilbake) ---------- */
  await p.reload();
  await p.waitForFunction(() => {
    const H = window.__huskis;
    return H && H.authUser && H.lastMy;
  }, null, { timeout: 10000, polling: 200 });
  st = await rows(p);
  const texts = st.map((r) => r.text).sort();
  log(label + ' 8: etter reload står nøyaktig de navngitte igjen',
    st.length === 6 && JSON.stringify(texts) === JSON.stringify(['Finnes fra før', 'I kategorien', 'Min kategori', 'Nytt med klikk', 'Nytt punkt', 'Punkt to']),
    JSON.stringify(texts));

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
