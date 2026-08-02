/*
  Regresjonstest: NAVIGASJONSMODALEN (universer + grupper).

  Én nav-knapp i toppmenyen viser hele lokasjonen (🌐 univers › 📁 gruppe) og
  åpner ÉN modal for begge nivåene. Der er universene KORT og gruppene RADER —
  nøyaktig samme oppsett (og samme dra-og-slipp-motor) som lister og
  listepunkter, bare alltid i én kolonne. Testen dekker:

    1. Én nav-knapp; de gamle to modalene finnes ikke lenger.
    2. Universer rendres som `.card` med gruppene som `.item` i `.items-container`,
       i ÉN kolonne.
    3. Universer/grupper har KUN del-knapp (ingen tannhjul); gruppekategorier har
       kun oppløs-knapp.
    4. Kollaps av et univers viser [gruppe-ikon] + antall (ikke «(N)»).
    5. Klikk på gruppenavnet redigerer; klikk ellers på raden navigerer + lukker.
    6. DnD: gruppe mellom universer, gruppe ut i «lufta» → nytt univers,
       gruppe inn i en gruppekategori.
    7. Drar man gruppa man STÅR i til et annet univers, følger lokasjonen med.
    8. Tastatur: Enter/Mellomrom navigerer, omdøper og kollapser uten peker.
    9. Slipp i et LÅST univers rulles tilbake (DB-guarden ville avvist det).
   10. [univers-/gruppe-ikon][delt-ikon]Navn, og ingen lys innerkant på kortet.
   11. Gruppe-søppelkassen ligger i universkortet; univers-søppelkassen nederst.

  Kjør:
    python3 -m http.server 8000                  # fra repo-roten, i egen terminal
    NODE_PATH=$(npm root -g) node tests/nav-modal.test.js
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
  await p.locator('#auth-submit').click(); await p.waitForTimeout(1700);
  // Introduksjonen (docs/introduksjon.md) starter av seg selv for en ny konto
  // og legger seg over appen — den er ikke det denne testen handler om.
  await p.evaluate(() => window.__huskis.tour.end('skipped'));
  await p.waitForTimeout(150);
}

// To universer: «Hjemme» (gruppe + gruppekategori med ett medlem) og «Jobb».
async function seed(p) {
  await p.evaluate(() => {
    const H = window.__huskis, st = H.state;
    const mk = (o) => Object.assign({ ts: 1, org: 't', pos: 0, posTs: 1, posOrg: 't', trashed: false, _role: 'owner' }, o);
    st.universes.length = 0;
    const uA = mk({ id: 'uni-A', name: 'Hjemme', collapsed: false, groups: [] });
    const uB = mk({ id: 'uni-B', name: 'Jobb', collapsed: false, groups: [], pos: 1 });
    uA.groups.push(mk({ id: 'g-a1', uni: 'uni-A', name: 'Ukesplan', cat: null, isCat: false, collapsed: false, cards: [] }));
    uA.groups.push(mk({ id: 'gc-1', uni: 'uni-A', name: 'Prosjekter', cat: null, isCat: true, collapsed: false, cards: [], pos: 1 }));
    uA.groups.push(mk({ id: 'g-a2', uni: 'uni-A', name: 'Hagen', cat: 'gc-1', isCat: false, collapsed: false, cards: [], pos: 2 }));
    uB.groups.push(mk({ id: 'g-b1', uni: 'uni-B', name: 'Møter', cat: null, isCat: false, collapsed: false, cards: [] }));
    st.universes.push(uA, uB);
    st.activeUniverse = 'uni-A'; st.activeGroup = 'g-a1';
    H.render();
  });
  await p.waitForTimeout(300);
}

// Universene med gruppene sine (nivå 1 + kategorimedlemmer), fra STATE.
const model = (p) => p.evaluate(() => window.__huskis.state.universes
  .filter((u) => !u.trashed && !u._pendingDelete)
  .sort((a, b) => a.pos - b.pos)
  .map((u) => u.name + '[' + u.groups
    .filter((g) => !g.trashed && !g._pendingDelete)
    .sort((a, b) => a.pos - b.pos)
    .map((g) => g.name + (g.isCat ? '*' : '') + (g.cat ? '@' + g.cat : ''))
    .join(',') + ']')
  .join(' '));

const open = async (p) => { await p.evaluate(() => window.__huskis.openNavModal()); await p.waitForTimeout(350); };

// Musedrag (desktop starter draget umiddelbart på bevegelse). `to` kan være en
// funksjon som måler målet på nytt underveis — layouten flytter seg mens man drar.
async function drag(p, fromSel, to, rounds = 8) {
  // Modalen er høyere enn mobilskjermen (tre seksjoner), så raden man drar fra
  // kan ligge delvis under modal-headeren. Rull den fram først — ellers treffer
  // pointerdown headeren i stedet for raden.
  await p.locator(fromSel).scrollIntoViewIfNeeded();
  await p.waitForTimeout(120);
  const a = await p.locator(fromSel).boundingBox();
  await p.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await p.mouse.down();
  await p.mouse.move(a.x + a.width / 2 + 8, a.y + a.height / 2 + 8, { steps: 3 });
  await p.waitForTimeout(90);
  for (let i = 0; i < rounds; i++) {
    const t = typeof to === 'function' ? await to() : to;
    await p.mouse.move(t.x, t.y, { steps: 5 });
    await p.waitForTimeout(80);
  }
  await p.mouse.up();
  await p.waitForTimeout(650);
}

const results = [];
const log = (n, ok, x = '') => { results.push(ok); console.log((ok ? 'PASS' : 'FAIL') + ' — ' + n + (x ? '  [' + x + ']' : '')); };

async function run(label, vp, mobile) {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: vp, isMobile: mobile, hasTouch: mobile });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  console.log('\n== ' + label + ' ==');
  await register(p);
  await seed(p);

  /* ---------- 1) Én nav-knapp, én modal ---------- */
  const nav = await p.evaluate(() => ({
    crumbs: document.querySelectorAll('.breadcrumb .crumb-btn').length,
    oldModals: !!document.getElementById('uni-modal') || !!document.getElementById('group-modal'),
    text: document.getElementById('nav-crumb').innerText.replace(/\s+/g, ' ').trim(),
  }));
  log(label + ' 1: én navigasjonsknapp med hele lokasjonen',
    nav.crumbs === 1 && nav.text === 'Hjemme › Ukesplan', JSON.stringify(nav));
  log(label + ' 1: de gamle univers-/gruppe-modalene er borte', nav.oldModals === false);

  await open(p);
  const title = await p.evaluate(() => {
    const h = document.getElementById('nav-modal-title');
    return { text: h.innerText.replace(/\s+/g, ' ').trim(), icons: h.querySelectorAll('svg.icon').length };
  });
  log(label + ' 1: modaltittelen er «[univers] Universer og [gruppe] grupper»',
    title.text === 'Universer og grupper' && title.icons === 2, JSON.stringify(title));

  /* ---------- 2) Samme oppsett som lister/listepunkter, én kolonne ---------- */
  const shape = await p.evaluate(() => {
    const cards = [...document.querySelectorAll('#nav-board .board-col > .card')];
    const board = document.getElementById('nav-board');
    return {
      cards: cards.map((c) => ({
        id: c.dataset.id,
        title: c.querySelector('.card-title').textContent,
        rows: [...c.querySelectorAll(':scope > .card-body > .items-container > .item')].map((i) => i.querySelector('.item-text').textContent),
        cats: [...c.querySelectorAll(':scope > .card-body > .items-container > .category')].map((k) => k.querySelector('.cat-title').textContent),
        catRows: [...c.querySelectorAll('.category .cat-items > .item')].map((i) => i.querySelector('.item-text').textContent),
        addBtns: c.querySelectorAll('.add-item-row > button').length,
      })),
      // Alle kort ligger på samme venstre kant → én kolonne.
      singleColumn: new Set(cards.map((c) => Math.round(c.getBoundingClientRect().left))).size === 1,
      columnCount: board.querySelectorAll('.board-col').length,
    };
  });
  log(label + ' 2: hvert univers er et kort med gruppene som rader',
    shape.cards.length === 2 &&
    shape.cards[0].title === 'Hjemme' && shape.cards[0].rows.join() === 'Ukesplan' &&
    shape.cards[0].cats.join() === 'Prosjekter' && shape.cards[0].catRows.join() === 'Hagen' &&
    shape.cards[1].rows.join() === 'Møter',
    JSON.stringify(shape.cards));
  log(label + ' 2: alltid ÉN kolonne', shape.singleColumn === true && shape.columnCount === 1,
    'kolonner=' + shape.columnCount);
  log(label + ' 2: ＋-gruppe og gruppekategori-knapp i hvert univers',
    shape.cards.every((c) => c.addBtns === 2));

  /* ---------- 3) Kun del-knapper; kategorien har kun oppløs ---------- */
  const btns = await p.evaluate(() => {
    const card = document.querySelector('#nav-board .card[data-id="uni-A"]');
    const row = card.querySelector('.item[data-id="g-a1"]');
    const cat = card.querySelector('.category[data-id="gc-1"]');
    return {
      uniShare: !!card.querySelector('.card-head .uni-share') && !card.querySelector('.card-head .uni-share').hidden,
      uniCog: card.querySelectorAll('.card-head .card-cog:not(.uni-share)').length,
      rowShare: !!row.querySelector('.group-share') && !row.querySelector('.group-share').hidden,
      rowCheck: row.querySelectorAll('.item-check').length,
      rowCog: row.querySelectorAll('.item-cog:not(.group-share)').length,
      catDissolve: !!cat.querySelector('.cat-head .cat-dissolve'),
      catCog: cat.querySelectorAll('.cat-head .cat-cog').length,
      catShare: cat.querySelectorAll('.cat-head .group-share').length,
    };
  });
  log(label + ' 3: universet har del-knapp og ikke tannhjul',
    btns.uniShare === true && btns.uniCog === 0, JSON.stringify(btns));
  log(label + ' 3: gruppa har del-knapp, ingen avmerkingsboks og ikke tannhjul',
    btns.rowShare === true && btns.rowCheck === 0 && btns.rowCog === 0);
  log(label + ' 3: gruppekategorien har kun oppløs-knapp',
    btns.catDissolve === true && btns.catCog === 0 && btns.catShare === 0);

  /* ---------- 4) Kollaps viser [gruppe-ikon] + antall ---------- */
  // Treff korthodet MELLOM tittelen og knappene: klikk på tittelen redigerer, og
  // på knappene deler/sletter — bare «resten» av headeren kollapser universet.
  // Måles på NYTT hver gang: modalen krymper når et univers kollapser, og siden
  // den er vertikalt sentrert flytter kortene seg.
  const headHit = async () => p.evaluate(() => {
    const head = document.querySelector('#nav-board .card[data-id="uni-B"] .card-head');
    const t = head.querySelector('.card-title').getBoundingClientRect();
    const s = head.querySelector('.uni-share').getBoundingClientRect();
    const r = head.getBoundingClientRect();
    return { x: (t.right + s.left) / 2, y: r.top + r.height / 2 };
  });
  const clickHead = async () => { const h = await headHit(); await p.mouse.click(h.x, h.y); };
  await clickHead();
  await p.waitForTimeout(300);
  const cnt = await p.evaluate(() => {
    const c = document.querySelector('#nav-board .card[data-id="uni-B"] .collapse-count');
    return { hidden: c.hidden, text: c.textContent, icons: c.querySelectorAll('svg.icon').length,
      collapsed: !!window.__huskis.state.universes.find((u) => u.id === 'uni-B').collapsed };
  });
  log(label + ' 4: kollapset univers viser [gruppe-ikon] + antall (ikke «(N)»)',
    cnt.hidden === false && cnt.text === '1' && cnt.icons === 1 && cnt.collapsed === true,
    JSON.stringify(cnt));
  await clickHead(); // åpne igjen
  await p.waitForTimeout(300);

  /* ---------- 5) Klikk på navnet redigerer, klikk ellers navigerer ---------- */
  await p.locator('#nav-board .item[data-id="g-b1"] .item-text').click();
  await p.waitForTimeout(250);
  const editing = await p.evaluate(() => !!document.querySelector('#nav-board .item[data-id="g-b1"] .edit-input'));
  log(label + ' 5: klikk på gruppenavnet åpner navneredigering', editing === true);
  await p.keyboard.press('Escape'); await p.waitForTimeout(250);

  const main = await p.locator('#nav-board .item[data-id="g-b1"] .item-main').boundingBox();
  await p.mouse.click(main.x + main.width - 8, main.y + main.height / 2);
  await p.waitForTimeout(450);
  const navigated = await p.evaluate(() => ({
    closed: document.getElementById('nav-modal').hidden,
    u: window.__huskis.state.activeUniverse, g: window.__huskis.state.activeGroup,
    crumb: document.getElementById('nav-crumb').innerText.replace(/\s+/g, ' ').trim(),
  }));
  log(label + ' 5: klikk ellers på raden navigerer til gruppen og lukker modalen',
    navigated.closed === true && navigated.u === 'uni-B' && navigated.g === 'g-b1' &&
    navigated.crumb === 'Jobb › Møter', JSON.stringify(navigated));

  /* ---------- 6-10) DnD og rendring: pull + gruppeflytting stubbes ----------
     Fikstur-radene har ikke UUID-er og finnes derfor ALDRI på «serveren». En
     pull ville nullstilt dem midt i scenarioet, og `move_group`-RPC-en (som en
     gruppe som bytter univers går gjennom) ville ventet forgjeves på at raden
     dukket opp. Begge deler hører til synken, som `sync-*`-testene dekker; her
     handler alt om dra-og-slipp og rendring. */
  await p.evaluate(() => {
    const c = window.__huskis.client;
    window.__navRealRpc = c.rpc.bind(c);
    c.rpc = (name, params) => {
      if (name === 'get_my_doc') return Promise.resolve({ data: null, error: { message: 'pull pauset i test' } });
      if (name === 'move_group') return Promise.resolve({ data: { mode: 'reparent', group: params.p_group, mapping: {} }, error: null });
      return window.__navRealRpc(name, params);
    };
  });

  /* ---------- 6) DnD: samme motor som lister/listepunkter ---------- */
  await open(p);
  // 6a) gruppe fra Hjemme → Jobb
  await drag(p, '#nav-board .item[data-id="g-a1"]', async () => {
    const t = await p.locator('#nav-board .card[data-id="uni-B"] .items-container').boundingBox();
    return { x: t.x + t.width / 2, y: t.y + t.height / 2 };
  });
  const m6a = await model(p);
  log(label + ' 6a: gruppa flyttet til et annet univers',
    m6a.startsWith('Hjemme[Prosjekter*,Hagen@gc-1] Jobb[') &&
    m6a.includes('Ukesplan') && m6a.includes('Møter'), m6a);

  // 6b) gruppe ut i board-lufta under kortene → nytt univers
  await open(p);
  await drag(p, '#nav-board .item[data-id="g-b1"]', async () => {
    const t = await p.locator('#nav-board').boundingBox();
    return { x: t.x + t.width / 2, y: t.y + t.height + 14 };
  });
  const extracted = await p.evaluate(() => {
    const st = window.__huskis.state;
    const nu = st.universes.find((u) => !['uni-A', 'uni-B'].includes(u.id));
    return nu ? nu.groups.map((g) => g.name).join() : 'INGEN';
  });
  log(label + ' 6b: gruppe sluppet utenfor universene lager et NYTT univers',
    extracted === 'Møter', extracted);
  await p.keyboard.press('Escape'); await p.waitForTimeout(250); // avbryt navngivingen

  // 6c) gruppe inn i en gruppekategori (slipp på overskriften)
  await open(p);
  await drag(p, '#nav-board .item[data-id="g-a1"]', async () => {
    const t = await p.locator('#nav-board .category[data-id="gc-1"] .cat-head').boundingBox();
    return { x: t.x + t.width / 2, y: t.y + t.height / 2 };
  });
  const inCat = await p.evaluate(() => {
    const g = window.__huskis.state.universes.flatMap((u) => u.groups).find((x) => x.id === 'g-a1');
    return g ? (g.uni + '/' + (g.cat || '-')) : 'BORTE';
  });
  log(label + ' 6c: gruppa ligger i gruppekategorien', inCat === 'uni-A/gc-1', inCat);

  // 6d) hele gruppekategorien ut i lufta → nytt univers med medlemmene som grupper.
  // Frisk state først: 6a–6c har flyttet gruppene rundt, og et kjent utgangspunkt
  // gjør at «under alle kortene» faktisk er board-luft og ikke det siste kortet.
  await seed(p);
  await open(p);
  await drag(p, '#nav-board .category[data-id="gc-1"] .cat-head', async () => {
    const t = await p.locator('#nav-board').boundingBox();
    return { x: t.x + t.width / 2, y: t.y + t.height + 40 };
  });
  const catOut = await p.evaluate(() => {
    const st = window.__huskis.state;
    const old = st.universes.find((u) => u.id === 'uni-A');
    const nu = st.universes.find((u) => u.groups.some((g) => g.id === 'g-a2'));
    return {
      kvar: old ? old.groups.filter((g) => !g.trashed).map((g) => g.name).join() : 'BORTE',
      nytt: nu ? nu.id + '|' + nu.name + ':' + nu.groups.map((g) => g.name + (g.cat ? '@' : '')).join() : 'INGEN',
    };
  });
  // Kategorien tar navnet sitt med seg; medlemmet «Hagen» blir en UKATEGORISERT
  // gruppe i det nye universet (ingen «@»), og «Ukesplan» blir igjen i uni-A.
  log(label + ' 6d: gruppekategori sluppet utenfor universene blir et NYTT univers',
    catOut.nytt.endsWith('|Prosjekter:Hagen') && !catOut.nytt.startsWith('uni-A|') &&
    catOut.kvar === 'Ukesplan', JSON.stringify(catOut));

  /* ---------- 7) Den aktive gruppen følger med når den bytter univers ---------- */
  // Står man I gruppa man drar til et annet univers, må hovedsiden og
  // breadcrumben følge etter — ellers leter activeGroupObj() i det gamle
  // universet og board-et faller til «Ingen grupper ennå.».
  await seed(p);
  await open(p);
  await drag(p, '#nav-board .card[data-id="uni-A"] .item[data-id="g-a1"]', async () => {
    const t = await p.locator('#nav-board .card[data-id="uni-B"] .item[data-id="g-b1"]').boundingBox();
    return { x: t.x + t.width / 2, y: t.y + t.height / 2 + 6 };
  });
  const follow = await p.evaluate(() => {
    const H = window.__huskis, st = H.state;
    H.closeNavModal();
    const g = st.universes.flatMap((u) => u.groups).find((x) => x.id === 'g-a1');
    return {
      gUni: g ? g.uni : 'BORTE',
      aktivtUnivers: st.activeUniverse,
      aktivGruppe: st.activeGroup,
      crumb: document.getElementById('nav-crumb').innerText.replace(/\s+/g, ' ').trim(),
      // «Ingen grupper ennå.» = board-et fant ikke gruppa (den gamle feilen).
      // Gruppa er tom for lister, så list-nivåets tomtilstand er RIKTIG her.
      board: (document.querySelector('#board .empty-state') || document.body).innerText
        .replace(/\s+/g, ' ').trim().slice(0, 40),
    };
  });
  log(label + ' 7: den aktive gruppen tar med seg lokasjonen til det nye universet',
    follow.gUni === 'uni-B' && follow.aktivtUnivers === 'uni-B' && follow.aktivGruppe === 'g-a1' &&
    follow.crumb === 'Jobb › Ukesplan' && follow.board.startsWith('Ingen lister i «Ukesplan»'),
    JSON.stringify(follow));

  /* ---------- 8) Tastatur: navigering uten peker ---------- */
  await seed(p);
  await open(p);
  // Enter på en ANNEN gruppes rad = naviger dit (og lukk modalen), som et klikk.
  await p.locator('#nav-board .card[data-id="uni-B"] .item[data-id="g-b1"]').focus();
  await p.keyboard.press('Enter');
  await p.waitForTimeout(400);
  const kbNav = await p.evaluate(() => ({
    lukket: document.getElementById('nav-modal').hidden,
    u: window.__huskis.state.activeUniverse,
    g: window.__huskis.state.activeGroup,
  }));
  log(label + ' 8: Enter på en grupperad navigerer dit og lukker modalen',
    kbNav.lukket === true && kbNav.u === 'uni-B' && kbNav.g === 'g-b1', JSON.stringify(kbNav));

  // Enter på raden man ALLEREDE står i redigerer navnet (ellers ville Enter der
  // bare lukket modalen — det var slik chip-radene oppførte seg før).
  await open(p);
  await p.locator('#nav-board .card[data-id="uni-B"] .item[data-id="g-b1"]').focus();
  await p.keyboard.press('Enter');
  await p.waitForTimeout(300);
  const kbRename = await p.evaluate(() => ({
    input: !!document.querySelector('#nav-board .item[data-id="g-b1"] .edit-input'),
    apen: !document.getElementById('nav-modal').hidden,
  }));
  log(label + ' 8: Enter på den aktive gruppa åpner navneredigering',
    kbRename.input === true && kbRename.apen === true, JSON.stringify(kbRename));
  await p.keyboard.press('Escape');
  await p.waitForTimeout(250);

  // Mellomrom på univershodet kollapser/utvider — det klikk der gjør.
  await p.locator('#nav-board .card[data-id="uni-A"] .card-head').focus();
  await p.keyboard.press(' ');
  await p.waitForTimeout(300);
  const kbCollapse = await p.evaluate(() => {
    const c = document.querySelector('#nav-board .card[data-id="uni-A"]');
    return {
      kollapset: c.classList.contains('collapsed'),
      lagret: window.__huskis.state.universes.find((u) => u.id === 'uni-A').collapsed,
      aria: c.querySelector('.card-head').getAttribute('aria-expanded'),
    };
  });
  log(label + ' 8: Mellomrom på univershodet kollapser universet',
    kbCollapse.kollapset === true && kbCollapse.lagret === true && kbCollapse.aria === 'false',
    JSON.stringify(kbCollapse));

  /* ---------- 9) Slipp i et LÅST univers rulles tilbake ---------- */
  // DB-guarden krever redigeringsrett på BÅDE gammel og ny forelder, så en
  // flytting inn i et frosset univers ville blitt avvist og snappet tilbake ved
  // neste synk. Klienten må avvise den med en gang i stedet.
  //
  // Fikstur: «vanlig medlem av et låst univers» settes direkte på state-objektet
  // (`_role`/`_locked`/`_caps`). Pullen er allerede pauset (se 6-10 over).
  await seed(p);
  await p.evaluate(() => {
    const u = window.__huskis.state.universes.find((x) => x.id === 'uni-B');
    // Vanlig medlem (ikke eier) av et låst univers: låsen gjelder for meg.
    u._role = 'member'; u._locked = true;
    u._caps = { editContent: false, createGroup: false, delete: false, leave: true };
    window.__huskis.render();
  });
  await open(p);
  await drag(p, '#nav-board .card[data-id="uni-A"] .item[data-id="g-a1"]', async () => {
    const t = await p.locator('#nav-board .card[data-id="uni-B"] .item[data-id="g-b1"]').boundingBox();
    return { x: t.x + t.width / 2, y: t.y + t.height / 2 + 6 };
  });
  const locked = await p.evaluate(() => ({
    uni: window.__huskis.state.universes.flatMap((u) => u.groups).find((g) => g.id === 'g-a1').uni,
    iKildekortet: !!document.querySelector('#nav-board .card[data-id="uni-A"] .item[data-id="g-a1"]'),
    toast: (document.querySelector('.toast') || {}).textContent || '',
  }));
  log(label + ' 9: gruppe sluppet i et låst univers rulles tilbake med beskjed',
    locked.uni === 'uni-A' && locked.iKildekortet === true && /låst/i.test(locked.toast),
    JSON.stringify(locked));

  /* ---------- 10) Type-ikon + delt-merke foran navnet ---------- */
  await seed(p);
  await p.evaluate(() => {
    const u = window.__huskis.state.universes.find((x) => x.id === 'uni-A');
    u._shared = true;
    u.groups.find((g) => g.id === 'g-a1')._shared = true;
    window.__huskis.openNavModal();
  });
  await p.waitForTimeout(350);
  const marks = await p.evaluate(() => {
    const card = document.querySelector('#nav-board .card[data-id="uni-A"]');
    const row = card.querySelector('.item[data-id="g-a1"]');
    const kids = (el) => [...el.children].map((c) => c.className.split(' ')[0]);
    return {
      hode: kids(card.querySelector('.card-head')).slice(0, 3),
      rad: kids(row).slice(0, 3),
      uniIkon: card.querySelectorAll(':scope > .card-head > .uni-icon svg').length,
      gruppeIkon: row.querySelectorAll(':scope > .group-icon svg').length,
      delt: !card.querySelector(':scope > .card-head > .share-badge').hidden,
      // Den lyse innerkanten («border» rundt gruppelista) skal være borte.
      innerkant: getComputedStyle(card).boxShadow.includes('inset'),
    };
  });
  log(label + ' 10: [univers-ikon][delt-ikon]Navn på universkortet',
    marks.hode.join() === 'kind-icon,share-badge,card-title-wrap' &&
    marks.uniIkon === 1 && marks.delt === true, JSON.stringify(marks));
  log(label + ' 10: [gruppe-ikon][delt-ikon]Navn på grupperaden',
    marks.rad.join() === 'kind-icon,share-badge,item-main' && marks.gruppeIkon === 1);
  log(label + ' 10: delt univers har ingen lys innerkant rundt gruppelista',
    marks.innerkant === false);
  await p.evaluate(() => { window.__huskis.client.rpc = window.__navRealRpc; }); // pullen i gang igjen

  /* ---------- 11) Søppelkassene ---------- */
  // Frisk state: dra-testene over har flyttet gruppene rundt (og laget nye
  // universer), så søppel-sjekkene får sitt eget kjente utgangspunkt.
  await seed(p);
  await open(p);
  await p.locator('#nav-board .card[data-id="uni-A"] .item[data-id="g-a2"] .group-delete').click();
  await p.waitForTimeout(650);
  const trash = await p.evaluate(() => ({
    inUniCard: !!document.querySelector('#nav-board .card[data-id="uni-A"] .group-trash-btn'),
    count: (document.querySelector('#nav-board .card[data-id="uni-A"] .group-trash-btn .trashcan-count') || {}).textContent,
    otherUni: !!document.querySelector('#nav-board .card[data-id="uni-B"] .group-trash-btn'),
    uniTrashHidden: document.getElementById('uni-trash-btn').hidden,
    uniTrashInModalFooter: !!document.querySelector('#nav-modal .nav-actions #uni-trash-btn'),
  }));
  log(label + ' 11: gruppe-søppelkassen ligger i universkortet gruppa hørte til',
    trash.inUniCard === true && trash.count === '1' && trash.otherUni === false, JSON.stringify(trash));
  log(label + ' 11: univers-søppelkassen ligger nederst i modalen (skjult når tom)',
    trash.uniTrashInModalFooter === true && trash.uniTrashHidden === true);

  await p.locator('#nav-board .card[data-id="uni-A"] .uni-delete').click();
  await p.waitForTimeout(650);
  const uniTrash = await p.evaluate(() => ({
    hidden: document.getElementById('uni-trash-btn').hidden,
    count: document.getElementById('uni-trash-count').textContent,
  }));
  log(label + ' 11: univers-søppelkassen dukker opp med antall',
    uniTrash.hidden === false && uniTrash.count === '1', JSON.stringify(uniTrash));

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

