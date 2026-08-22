/*
  Regresjonstest: ⟲-knappen på «Utført»-linja (gjenopprett alle utførte).

  Knappen står på SAMME linje som «Utført»-tittelen, til HØYRE for skillelinja
  — foran 🗑-knappen som sletter alle utførte (egen test: delete-all-done.test.js).
  Et klikk reaktiverer ALLE avkryssede listepunkter i lista på én gang: de går
  tilbake til plassene sine (pos er urørt) — kategoriserte tilbake INN i
  kategorien sin — «Utført»-seksjonen skjules, og endringen overlever reload.
  I en låst liste er knappen skjult.

  Kjør:
    python3 -m http.server 8000                     # fra repo-roten, i egen terminal
    NODE_PATH=$(npm root -g) node tests/restore-all-done.test.js
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

// Kort med tre nivå-1-listepunkter + en kategori med to medlemmer.
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

const doneFlags = (p) => p.evaluate(() => {
  const H = window.__huskis, st = H.state;
  const u = st.universes.find((x) => x.id === st.activeUniverse);
  const g = u.groups.find((x) => x.id === st.activeGroup);
  return g.cards.find((x) => x.id === 'card-A').items
    .filter((i) => !i.isCat).map((i) => ({ id: i.id, done: !!i.done, pos: i.pos, cat: i.cat || null }));
});

// Rekkefølgen slik den STÅR i DOM-en, per seksjon.
const dom = (p) => p.evaluate(() => {
  const c = document.querySelector('.card[data-id="card-A"]');
  const txt = (sel) => [...c.querySelectorAll(sel)].map((e) => e.querySelector('.item-text').textContent);
  return {
    level1: txt(':scope > .card-body > .items-container > .item'),
    inCat: txt('.category[data-id="cat-1"] .cat-items > .item'),
    done: txt('.items-done > .item'),
    doneWrapHidden: c.querySelector('.items-done-wrap').hidden,
  };
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
  log(label + ' 1: «Utført»-seksjonen (og ⟲) er skjult når ingenting er avkrysset',
    (await dom(p)).doneWrapHidden === true);

  /* ---------- 2) Kryss av fire (to på nivå 1, to i kategorien) ---------- */
  for (const id of ['it-0', 'it-2', 'it-3', 'it-4']) {
    await card.locator('.item[data-id="' + id + '"] .item-check').click();
    await p.waitForTimeout(380);
  }
  let d = await dom(p);
  log(label + ' 2: fire listepunkter ligger i «Utført», ett igjen på nivå 1',
    d.done.length === 4 && d.level1.length === 1 && d.inCat.length === 0,
    JSON.stringify(d));

  /* ---------- 3) Plassering: samme linje som «Utført», ⟲ FØR 🗑 (se
     delete-all-done.test.js), begge til høyre for skillelinja ---------- */
  const geom = await p.evaluate(() => {
    const c = document.querySelector('.card[data-id="card-A"]');
    const div = c.querySelector('.done-divider');
    const lbl = div.querySelector('span').getBoundingClientRect();
    const btn = div.querySelector('.done-restore').getBoundingClientRect();
    const del = div.querySelector('.done-delete').getBoundingClientRect();
    const dr = div.getBoundingClientRect();
    return {
      visible: !div.querySelector('.done-restore').hidden,
      overlapY: Math.min(lbl.bottom, btn.bottom) - Math.max(lbl.top, btn.top),
      btnLeftOfLabel: btn.left > lbl.right,
      insideDivider: btn.right <= dr.right + 0.5,
      // Skillelinja (divider-ens ::after, flex: 1) fyller alt mellom tittelen og
      // knappen — er den bredden > 0, ligger linja MELLOM dem, altså knappen
      // til høyre for linja slik oppgaven ber om.
      lineWidth: Math.round(btn.left - lbl.right - 20),  // minus de to 10px-gapene
      // 🗑 (delete-all-done.test.js) står til høyre for ⟲ — det er DEN som nå
      // flukter med listepunktenes menyknapp-kolonne, ikke ⟲ selv.
      deleteRightOfRestore: del.left >= btn.right,
      w: Math.round(btn.width), h: Math.round(btn.height),
    };
  });
  log(label + ' 3: ⟲ er synlig', geom.visible === true);
  log(label + ' 3: ⟲ står på SAMME linje som «Utført» (vertikal overlapp)',
    geom.overlapY > 0, 'overlapp=' + geom.overlapY);
  log(label + ' 3: ⟲ står til HØYRE for tittelen/skillelinja',
    geom.btnLeftOfLabel === true && geom.insideDivider === true && geom.lineWidth > 0,
    JSON.stringify(geom));
  log(label + ' 3: 🗑 står til HØYRE for ⟲',
    geom.deleteRightOfRestore === true, JSON.stringify(geom));
  log(label + ' 3: ⟲ har full trykkflate (36×36)',
    geom.w === 36 && geom.h === 36, geom.w + '×' + geom.h);

  /* ---------- 4) Klikk gjenoppretter ALLE på én gang ---------- */
  await card.locator('.done-restore').click(); await p.waitForTimeout(500);
  d = await dom(p);
  let st = await doneFlags(p);
  log(label + ' 4: ingen listepunkter er lenger utført (state)',
    st.every((i) => !i.done), JSON.stringify(st));
  log(label + ' 4: «Utført»-seksjonen er tom og skjult',
    d.done.length === 0 && d.doneWrapHidden === true, JSON.stringify(d));
  log(label + ' 4: nivå 1 er tilbake i pos-rekkefølge',
    JSON.stringify(d.level1) === JSON.stringify(['Ett', 'To', 'Tre']), JSON.stringify(d.level1));
  log(label + ' 4: kategoriserte havnet tilbake INNE i kategorien',
    JSON.stringify(d.inCat) === JSON.stringify(['I kat A', 'I kat B']), JSON.stringify(d.inCat));
  log(label + ' 4: pos er urørt av gjenopprettingen',
    st.map((i) => i.pos).join(',') === '0,1,3,4,5', st.map((i) => i.pos).join(','));

  /* ---------- 5) Overlever reload (lagret, ikke bare DOM) ---------- */
  await p.reload();
  await p.waitForFunction(() => {
    const H = window.__huskis;
    return H && H.authUser && H.lastMy;
  }, null, { timeout: 10000, polling: 200 });
  st = await doneFlags(p);
  d = await dom(p);
  log(label + ' 5: fortsatt ingen utførte etter reload',
    st.length === 5 && st.every((i) => !i.done) && d.doneWrapHidden === true, JSON.stringify(st));

  /* ---------- 6) Låst liste: ⟲ er skjult ---------- */
  await card.locator('.item[data-id="it-0"] .item-check').click(); await p.waitForTimeout(380);
  const lockedHidden = await p.evaluate(() => {
    const H = window.__huskis, st2 = H.state;
    const u = st2.universes.find((x) => x.id === st2.activeUniverse);
    const g = u.groups.find((x) => x.id === st2.activeGroup);
    // Frosset liste: låst av en ANNEN (jeg er verken eier eller admin oppover) —
    // samme tilstand som en delt, låst liste. Flaggene settes på nytt ved neste
    // pull, så knappen leses av med én gang, i samme oppgave som render().
    const c = g.cards.find((x) => x.id === 'card-A');
    u._role = 'member'; g._role = null; c._locked = true;
    H.render();
    const el = document.querySelector('.card[data-id="card-A"] .done-restore');
    return { hidden: !!el.hidden, checkDisabled: !!document.querySelector('.card[data-id="card-A"] .items-done .item-check').disabled };
  });
  await p.waitForTimeout(200);
  log(label + ' 6: ⟲ er skjult i en låst liste (som avmerkingsboksene er deaktivert)',
    lockedHidden.hidden === true && lockedHidden.checkDisabled === true, JSON.stringify(lockedHidden));

  log(label + ': ingen JS-feil', errs.length === 0, errs.join(' | '));
  await p.close();
  await b.close();
}

/*
  Kantsituasjoner rundt selve innsettingen (`placeItemBySection`), med en
  kategori på nivå 1:
   - Kategoriens medlemmer er ETTERKOMMERE av .items-container. Et
     etterkommer-søk etter innsettingspunktet kunne plukke et nivå-2-listepunkt
     som `ref`, og insertBefore kastet da NotFoundError midt i løkka — altså
     etter at noen rader alt var endret, men før save().
   - Kategori-radene opptar sine egne pos-plasser på nivå 1: hoppes de over,
     havner en gjenopprettet rad på feil side av en kategori med høyere pos.
   - En KOLLAPSET kategori teller kun sine ikke-utførte medlemmer, så «(N)» må
     oppdateres når medlemmene blir utførte igjen.
*/
async function runEdgeCases(label, vp, mobile) {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: vp, isMobile: mobile, hasTouch: mobile });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  console.log('\n== ' + label + ' (kategori-kanter) ==');
  await register(p);
  await p.evaluate(() => { window.__huskis.addUniverse(); }); await p.waitForTimeout(150);
  await p.keyboard.press('Escape'); await p.waitForTimeout(150);
  await p.evaluate(() => { window.__huskis.addGroup(); }); await p.waitForTimeout(150);
  await p.keyboard.press('Escape'); await p.waitForTimeout(200);
  // Nivå 1: A(0) · kategori C(1) m/ medlem M(5) · B(10). Utført: X(0.5) og Y(7)
  // — X skal lande MELLOM A og C, Y MELLOM C og B.
  await p.evaluate(() => {
    const H = window.__huskis, st = H.state;
    const u = st.universes.find((x) => x.id === st.activeUniverse);
    const g = u.groups.find((x) => x.id === st.activeGroup);
    const mk = (pos) => ({ ts: 0, org: 't', pos, posTs: 0, posOrg: 't' });
    const c = Object.assign({ id: 'card-A', group: g.id, title: 'A', trashed: false, k: true, p: true, labTs: 0, labOrg: 't', items: [] }, mk(0));
    const it = (id, pos, extra) => Object.assign({ id, text: id, home: 'card-A', cat: null, trashed: false, done: false }, mk(pos), extra || {});
    c.items.push(it('A', 0), it('C', 1, { isCat: true }), it('M', 5, { cat: 'C' }),
      it('B', 10), it('X', 0.5, { done: true }), it('Y', 7, { done: true }));
    g.cards = [c]; H.render();
  });
  await p.waitForTimeout(300);

  await p.locator('.done-restore').click(); await p.waitForTimeout(500);
  const r = await p.evaluate(() => {
    const c = document.querySelector('.card[data-id="card-A"]');
    return {
      level1: [...c.querySelectorAll(':scope > .card-body > .items-container > :is(.item,.category)')].map((e) => e.dataset.id),
      inCat: [...c.querySelectorAll('.category[data-id="C"] .cat-items > .item')].map((e) => e.dataset.id),
      done: c.querySelectorAll('.items-done > .item').length,
    };
  });
  log(label + ' 7: ingen JS-feil (insertBefore mot et nivå-2-listepunkt)',
    errs.length === 0, errs.join(' | '));
  log(label + ' 7: gjenopprettede rader lander på riktig side av kategorien',
    JSON.stringify(r.level1) === JSON.stringify(['A', 'X', 'C', 'Y', 'B']), JSON.stringify(r.level1));
  log(label + ' 7: kategorien er urørt, «Utført» er tømt',
    JSON.stringify(r.inCat) === JSON.stringify(['M']) && r.done === 0, JSON.stringify(r));

  /* ---------- 8) Kollapset kategori: «(N)» oppdateres av gjenopprettingen ---------- */
  await p.evaluate(() => {
    const H = window.__huskis, st = H.state;
    const c = st.universes.flatMap((u) => u.groups).flatMap((g) => g.cards).find((x) => x.id === 'card-A');
    c.items.find((i) => i.id === 'M').done = true;       // eneste medlem er utført …
    c.items.find((i) => i.id === 'C').collapsed = true;  // … og kategorien er lukket
    H.render();
  });
  await p.waitForTimeout(300);
  const before = await p.textContent('.category[data-id="C"] .collapse-count');
  await p.locator('.done-restore').click(); await p.waitForTimeout(80);   // FØR neste synk-render
  const after = await p.textContent('.category[data-id="C"] .collapse-count');
  log(label + ' 8: kollapset kategori teller kun ikke-utførte før gjenopprettingen',
    before.trim() === '(0)', before);
  log(label + ' 8: telleren er oppdatert med én gang etter ⟲ (ikke først ved neste render)',
    after.trim() === '(1)', after);

  await p.close();
  await b.close();
}

(async () => {
  await run('desktop', { width: 1200, height: 900 }, false);
  await run('mobil', { width: 390, height: 780 }, true);
  await runEdgeCases('desktop', { width: 1200, height: 900 }, false);
  await runEdgeCases('mobil', { width: 390, height: 780 }, true);
  const failed = results.filter((x) => !x).length;
  console.log('\n==== ' + (results.length - failed) + '/' + results.length + ' PASS ====');
  process.exit(failed ? 1 : 0);
})();
