/*
  Nettlesertest for OPPSKRIFTENE — den tredje hoveddelen (docs/oppskrifter.md)
  — mot mock-backenden (?mock=1).

  Dekker:
    1. Tre hovedfaner: Oppskrifter viser sin egen flate, og Lister og Notater
       tegnes fortsatt når man bytter tilbake
    2. Kokebokmenyen: kokeboken som kort, kapitlene som kategorier,
       oppskriftene som rader, «Uten kapittel» først
    3. Dra-og-slipp i kokebokmenyen: en oppskrift flyttes inn i et kapittel, og
       den nye plasseringen lagres
    4. Nytt kapittel med den gule knappen
    5. Løs opp et kapittel: kapittelet forsvinner, oppskriftene blir liggende
       rett i kokeboken — ingen går tapt
    6. Lesevisningen: ingredienser og nummererte steg, porsjonsvelgeren
       skalerer mengdene, og det lagrede grunnlaget endres ALDRI av det
    7. Redigeringsmodusen: ny ingrediensgruppe, «Øvrige ingredienser» når det
       finnes grupper, dra en linje inn i en gruppe, og en ingrediens kan ALDRI
       slippes blant stegene
    8. Oppløs en gruppe: linjene blir, i samme rekkefølge
    9. Søket: scopen «Oppskrifter» finner en oppskrift på en ingrediens, og
       treffet åpner den
   10. Deling med medlemmer: et medlem av kokeboken ser kapitler og oppskrifter
       (arv nedover), kan redigere, men får ingen kontroll for offentlig lenke;
       en uten rolle ser ingenting
   11. Offentlig lenke: lages i delingsvinduet, åpnes UTEN innlogging, viser
       bare det som er delt, svaret inneholder verken id-er eller personer,
       den anonyme leseren kan ikke skrive, endringer vises, og en avslått
       lenke slutter å virke
   12. Ingen JS-feil

  Kjøres på BÅDE desktop- og mobil-viewport (dra-og-slipp og layout); delingen
  og den offentlige lenken på desktop.

  Kjør:
    python3 -m http.server 8000
    NODE_PATH=$(npm root -g) node tests/recipes.test.js
*/
const { chromium } = require(require('path').join(process.env.NODE_PATH ||
  require('child_process').execSync('npm root -g').toString().trim(), 'playwright'));
const G = require('./dnd-gestures.js');
const BASE = process.env.HUSKIS_URL || 'http://localhost:8000';

const results = [];
const log = (n, ok, x = '') => { results.push(ok); console.log((ok ? 'PASS' : 'FAIL') + ' — ' + n + (x ? '  [' + x + ']' : '')); };

const U = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
  const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
});

/* Fikstur:
     A eier kokeboken B med kapittelet «Supper» (Tomatsuppe) og den frie
     oppskriften «Brød». Ved siden av ligger kapittelet «Kaker» (Sjokoladekake),
     så en lenke til ÉTT kapittel kan vise at naboen ikke følger med.
     Bm er MEDLEM av kokeboken. Cn har ingen rolle i den. */
function buildDB() {
  const uA = 'uA', uB = 'uB', uC = 'uC';
  const UA = U(), B = U(), C1 = U(), C2 = U(), R1 = U(), R2 = U(), R3 = U();
  const base = (x) => Object.assign({
    trashed: false, archived: false, locked: false, unlocked: false,
    invite_policy: 'inherit', collapsed: false, kind: 'recipe',
    ts: 1, org: 'a', pos: 0, pos_ts: 1, pos_org: 'a',
  }, x);
  const mem = (user, on, role) => Object.assign({
    id: U(), user_id: user, universe_id: null, group_id: null,
    note_project_id: null, note_folder_id: null, note_id: null,
    role, pos: 0, created_at: 1,
  }, on);
  const soup = {
    v: 1, desc: 'Rask hverdagssuppe.', serv: 4,
    ing: { items: [
      { id: 'i1', q: 400, q2: null, f: 0, qs: '', u: 'g', t: 'hermetiske tomater' },
      { id: 'i2', q: 1.5, q2: null, f: 1, qs: '', u: 'ss', t: 'olivenolje' },
      { id: 'i3', q: null, q2: null, f: 0, qs: '', u: '', t: 'salt etter smak' },
    ], subs: [] },
    step: { items: [{ id: 's1', t: 'Fres løk.' }, { id: 's2', t: 'Kok i 20 minutter.' }], subs: [] },
  };
  const empty = { v: 1, desc: '', serv: null, ing: { items: [], subs: [] }, step: { items: [], subs: [] } };
  return {
    ids: { uA, uB, uC, B, C1, C2, R1, R2, R3 },
    db: {
      _rolesBackfilled: true,
      profiles: [
        { id: uA, email: 'a@x.no', display_name: 'Alice Eier', user_metadata: {} },
        { id: uB, email: 'b@x.no', display_name: 'Bo Medlem', user_metadata: {} },
        { id: uC, email: 'c@x.no', display_name: 'Cato Utenfor', user_metadata: {} },
      ],
      passwords: { 'a@x.no': 'x', 'b@x.no': 'x', 'c@x.no': 'x' },
      universes: [Object.assign(base({ id: UA, owner_id: uA, name: 'Området', kind: undefined }),
        { is_cat: false, cat_id: null })],
      groups: [], cards: [], items: [], ideas: [],
      note_projects: [base({ id: B, owner_id: uA, name: 'Middag' })],
      note_folders: [
        base({ id: C1, owner_id: uA, project_id: B, name: 'Supper', pos: 0 }),
        base({ id: C2, owner_id: uA, project_id: B, name: 'Kaker', pos: 1 }),
      ],
      notes: [
        base({ id: R1, owner_id: uA, project_id: B, folder_id: C1, title: 'Tomatsuppe', body: '', recipe: soup }),
        base({ id: R2, owner_id: uA, project_id: B, folder_id: null, title: 'Brød', body: '', recipe: empty }),
        base({ id: R3, owner_id: uA, project_id: B, folder_id: C2, title: 'Sjokoladekake', body: '', recipe: empty }),
      ],
      memberships: [
        mem(uA, { universe_id: UA }, 'owner'),
        mem(uA, { note_project_id: B }, 'owner'),
        mem(uB, { note_project_id: B }, 'member'),
      ],
      share_invites: [], tombstones: [], recipe_links: [],
    },
  };
}

const SEEN_META = { onboarding: { v: 3, status: 'done' },
  tips: { drag: true, trash: true, moveList: true, dragTrash: true } };

async function seed(p, db) {
  await p.goto(BASE + '/?mock=1');
  await p.evaluate((db) => { localStorage.clear(); localStorage.setItem('hk-mock-db', JSON.stringify(db)); }, db);
}
async function loginAs(p, uid, email) {
  await p.goto(BASE + '/?mock=1');
  await p.evaluate(({ uid, email, meta }) => {
    sessionStorage.setItem('hk-mock-session', JSON.stringify({ id: uid, email, user_metadata: meta }));
  }, { uid, email, meta: SEEN_META });
  await p.goto(BASE + '/?mock=1');
  await p.waitForFunction(() => { const H = window.__huskis; return H && H.authUser && H.lastMy; },
    null, { timeout: 20000, polling: 200 });
  await p.evaluate(() => window.__huskis.tour.skipAll());
}
const dbRow = (p, table, id) => p.evaluate(({ table, id }) => {
  const db = JSON.parse(localStorage.getItem('hk-mock-db') || '{}');
  return (db[table] || []).find((r) => r.id === id) || null;
}, { table, id });
const waitDb = (p, table, id, fnSrc, timeout = 8000) => p.waitForFunction(({ table, id, fnSrc }) => {
  const db = JSON.parse(localStorage.getItem('hk-mock-db') || '{}');
  const row = (db[table] || []).find((r) => r.id === id);
  return new Function('row', 'return ' + fnSrc)(row);
}, { table, id, fnSrc }, { timeout, polling: 150 }).then(() => true, () => false);
const sync = (p) => p.evaluate(() => window.__huskis.cloudCycle && window.__huskis.cloudCycle());
const settle = (p) => p.waitForFunction(() => {
  const s = document.getElementById('sync-status');
  return !s || s.dataset.state !== 'saving';
}, null, { timeout: 8000, polling: 150 }).catch(() => {});

const navText = (p) => p.evaluate(() => [...document.querySelectorAll('#recipes-nav-board .recipe-book-card')]
  .map((c) => [...c.querySelectorAll('.recipe-row .item-text, .recipe-chapter .cat-title')].map((e) => e.textContent)));
const rowSel = (id) => '#recipes-nav-board .recipe-row[data-id="' + id + '"] .item-text';

async function runOwner(navn, viewport, touch) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport, isMobile: touch, hasTouch: touch });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  const { db, ids } = buildDB();
  await seed(p, db);
  await loginAs(p, ids.uA, 'a@x.no');

  /* 1. Tre hovedfaner */
  const tabs = await p.evaluate(() => [...document.querySelectorAll('.main-tabs [data-tab], #main-tabs button')]
    .map((b) => b.textContent.trim()));
  log(navn + ': tre hovedfaner — Lister, Notater, Oppskrifter',
    tabs.length === 3 && /Oppskrifter/.test(tabs[2]), JSON.stringify(tabs));
  await p.click('#tab-recipes');
  await p.waitForTimeout(250);
  const flate = await p.evaluate(() => ({
    recipes: !document.getElementById('recipes-board').hidden,
    notes: document.getElementById('notes-board').hidden,
    lists: document.getElementById('board').hidden,
    crumb: document.getElementById('recipes-crumb').textContent.replace(/\s+/g, ' ').trim(),
  }));
  log(navn + ': Oppskrifter-fanen viser sin egen flate og kokeboken i brødsmulen',
    flate.recipes && flate.notes && flate.lists && /Middag/.test(flate.crumb), JSON.stringify(flate));

  /* 2. Kokebokmenyen */
  await p.click('#recipes-crumb');
  await p.waitForTimeout(350);
  const tre = await navText(p);
  log(navn + ': kokebokmenyen viser «Uten kapittel», den frie oppskriften og kapitlene med oppskriftene sine',
    JSON.stringify(tre) === JSON.stringify([['Uten kapittel', 'Brød', 'Supper', 'Tomatsuppe', 'Kaker', 'Sjokoladekake']]),
    JSON.stringify(tre));

  /* 3. Dra Brød inn i Supper */
  const fra = await G.centre(p, rowSel(ids.R2));
  const til = await G.past(p, rowSel(ids.R1), 0.8);
  await G.dragFromTo(p, fra, til, { touch });
  await p.waitForTimeout(300);
  const etter = await p.evaluate((id) => window.__huskis.findRecipe(id).folder, ids.R2);
  log(navn + ': en oppskrift dras inn i et kapittel', etter === ids.C1, String(etter));
  await sync(p);
  log(navn + ': den nye plasseringen lagres på serveren',
    await waitDb(p, 'notes', ids.R2, 'row && row.folder_id === ' + JSON.stringify(ids.C1)));

  /* 4. Nytt kapittel */
  await p.click('#recipes-nav-board .recipe-book-card .add-cat-btn');
  await p.waitForTimeout(250);
  await p.keyboard.type('Desserter');
  await p.keyboard.press('Enter');
  await p.waitForTimeout(250);
  await sync(p);
  const nytt = await p.waitForFunction(() => {
    const db = JSON.parse(localStorage.getItem('hk-mock-db'));
    return db.note_folders.some((f) => f.name === 'Desserter' && f.kind === 'recipe');
  }, null, { timeout: 8000, polling: 150 }).then(() => true, () => false);
  log(navn + ': den gule knappen lager et nytt kapittel', nytt);

  /* 5. Løs opp «Supper» fra kapittelmenyen */
  await p.click('#recipes-nav-board .recipe-chapter[data-id="' + ids.C1 + '"] .cat-cog');
  await p.waitForTimeout(250);
  await p.click('.obj-menu-row:has-text("Løs opp kapittelet")');
  await p.waitForTimeout(400);
  const løst = await p.evaluate((ids) => ({
    chapter: !!document.querySelector('#recipes-nav-board .recipe-chapter[data-id="' + ids.C1 + '"]'),
    r1: window.__huskis.findRecipe(ids.R1), r2: window.__huskis.findRecipe(ids.R2),
  }), ids);
  log(navn + ': et oppløst kapittel forsvinner, og oppskriftene blir liggende rett i kokeboken',
    !løst.chapter && løst.r1 && løst.r2 && løst.r1.folder === null && løst.r2.folder === null,
    JSON.stringify({ c: løst.chapter, r1: løst.r1 && løst.r1.folder, r2: løst.r2 && løst.r2.folder }));
  await sync(p);
  log(navn + ': oppløsningen lagres — oppskriftene finnes fortsatt, uten kapittel',
    await waitDb(p, 'notes', ids.R1, 'row && !row.trashed && row.folder_id === null') &&
    await waitDb(p, 'notes', ids.R2, 'row && !row.trashed && row.folder_id === null'));

  /* 5b. Endre navn på kokeboken, slett en oppskrift og angre */
  await p.click('#recipes-nav-board .recipe-book-card .card-cog');
  await p.click('.obj-menu-row:has-text("Endre navn")');
  await p.waitForTimeout(200);
  await p.keyboard.press('ControlOrMeta+a');
  await p.keyboard.type('Hverdagsmat');
  await p.keyboard.press('Enter');
  await sync(p);
  log(navn + ': kokeboken får nytt navn', await waitDb(p, 'note_projects', ids.B, 'row && row.name === "Hverdagsmat"'));
  await p.click('#recipes-nav-board .recipe-row[data-id="' + ids.R2 + '"] .item-cog');
  await p.click('.obj-menu-row:has-text("Slett oppskriften")');
  await p.waitForTimeout(300);
  const borte = await p.evaluate((id) => !document.querySelector('#recipes-nav-board .recipe-row[data-id="' + id + '"]'), ids.R2);
  await p.click('.toast-action');
  await p.waitForTimeout(300);
  const tilbake = await p.evaluate((id) => !!document.querySelector('#recipes-nav-board .recipe-row[data-id="' + id + '"]'), ids.R2);
  log(navn + ': en slettet oppskrift forsvinner og kommer tilbake med «Angre»', borte && tilbake,
    JSON.stringify({ borte, tilbake }));
  await p.evaluate(() => window.__huskis.closeRecipesNav());

  /* 6. Lesevisningen og porsjonene */
  await p.evaluate((id) => window.__huskis.openRecipe(id), ids.R1);
  await p.waitForTimeout(300);
  const lese = await p.evaluate(() => ({
    ing: [...document.querySelectorAll('#recipe-sheet .recipe-ing-list li')].map((l) => l.textContent),
    steg: document.querySelectorAll('#recipe-sheet ol.recipe-step-list li').length,
    serv: (document.querySelector('.recipe-serv-value') || {}).textContent,
    edit: !!document.querySelector('#recipe-sheet input, #recipe-sheet textarea'),
  }));
  log(navn + ': lesevisningen viser ingrediensene, nummererte steg og antall porsjoner — uten redigeringsfelt',
    lese.ing[0] === '400 g hermetiske tomater' && lese.steg === 2 && lese.serv === '4 porsjoner' && !lese.edit,
    JSON.stringify(lese));
  await p.click('.recipe-serv-more');
  await p.click('.recipe-serv-more');
  await p.waitForTimeout(150);
  const skalert = await p.evaluate(() => [...document.querySelectorAll('#recipe-sheet .recipe-ing-list li')]
    .map((l) => l.textContent));
  log(navn + ': 6 porsjoner skalerer mengdene (desimal og brøk), tekst uten tall står urørt',
    skalert[0] === '600 g hermetiske tomater' && skalert[1] === '2¼ ss olivenolje' &&
    skalert[2] === 'salt etter smak', JSON.stringify(skalert));
  await sync(p);
  const grunnlag = await dbRow(p, 'notes', ids.R1);
  log(navn + ': porsjonsvalget endrer ALDRI de lagrede mengdene',
    grunnlag.recipe.serv === 4 && grunnlag.recipe.ing.items[0].q === 400,
    JSON.stringify({ serv: grunnlag.recipe.serv, q: grunnlag.recipe.ing.items[0].q }));

  /* 7. Redigeringsmodusen */
  await p.click('#recipe-edit-btn');
  await p.waitForTimeout(250);
  await p.click('.recipe-sec[data-sec="ing"] .recipe-add-row .btn-yellow');
  await p.waitForTimeout(200);
  await p.keyboard.type('Topping');
  await p.waitForTimeout(200);
  const gruppe = await p.evaluate(() => ({
    subs: document.querySelectorAll('.recipe-sec[data-sec="ing"] .recipe-sub').length,
    other: (document.querySelector('.recipe-sec[data-sec="ing"] .recipe-main > .recipe-other-name') || {}).textContent,
  }));
  log(navn + ': den gule knappen lager en ingrediensgruppe, og resten blir «Øvrige ingredienser»',
    gruppe.subs === 1 && gruppe.other === 'Øvrige ingredienser', JSON.stringify(gruppe));

  const grip = (id) => '.recipe-line[data-id="' + id + '"] .recipe-grip';
  // Saltet inn i gruppa.
  await G.dragFromTo(p, await G.centre(p, grip('i3')),
    () => G.centre(p, '.recipe-sec[data-sec="ing"] .recipe-sub .recipe-lines'), { touch });
  await p.waitForTimeout(400);
  const inn = await p.evaluate((id) => {
    const d = window.__huskis.findRecipe(id).recipe;
    return { sub: d.ing.subs[0].items.map((l) => l.id), main: d.ing.items.map((l) => l.id) };
  }, ids.R1);
  log(navn + ': en ingrediens dras inn i en gruppe', JSON.stringify(inn.sub) === '["i3"]' &&
    JSON.stringify(inn.main) === '["i1","i2"]', JSON.stringify(inn));

  // Tomatene ned blant stegene — skal avvises.
  await G.dragFromTo(p, await G.centre(p, grip('i1')),
    () => G.centre(p, '.recipe-sec[data-sec="step"] .recipe-lines'), { touch });
  await p.waitForTimeout(400);
  const blokk = await p.evaluate((id) => {
    const d = window.__huskis.findRecipe(id).recipe;
    return { ing: d.ing.items.map((l) => l.id), step: d.step.items.map((l) => l.id) };
  }, ids.R1);
  log(navn + ': en ingrediens kan ikke slippes blant stegene',
    blokk.ing.indexOf('i1') > -1 && blokk.step.indexOf('i1') === -1, JSON.stringify(blokk));

  /* 8. Oppløs gruppa */
  await p.click('.recipe-sec[data-sec="ing"] .recipe-sub .recipe-sub-dissolve');
  await p.waitForTimeout(300);
  const oppløst = await p.evaluate((id) => {
    const d = window.__huskis.findRecipe(id).recipe;
    return { subs: d.ing.subs.length, main: d.ing.items.map((l) => l.id) };
  }, ids.R1);
  log(navn + ': en oppløst gruppe beholder linjene sine', oppløst.subs === 0 &&
    oppløst.main.length === 3 && oppløst.main.indexOf('i3') > -1, JSON.stringify(oppløst));
  await p.click('#recipe-edit-btn');
  await p.evaluate(() => window.__huskis.flushRecipeSave());
  await sync(p);
  log(navn + ': redigeringen lagres på serveren',
    await waitDb(p, 'notes', ids.R1, 'row && row.recipe.ing.items.length === 3 && row.recipe.ing.subs.length === 0'));
  await p.evaluate(() => window.__huskis.closeRecipe());
  await p.waitForTimeout(200);

  /* 9. Søket */
  await p.evaluate(() => { window.__huskis.openSearchModal(); window.__huskis.setSearchScope('recipes'); });
  await p.fill('#search-input', 'tomater');
  await p.waitForTimeout(300);
  const treff = await p.evaluate(() => [...document.querySelectorAll('#search-results [role="option"], #search-results li')]
    .map((r) => r.textContent.replace(/\s+/g, ' ').trim()));
  log(navn + ': søket i Oppskrifter finner oppskriften på en ingrediens',
    treff.length >= 1 && /Tomatsuppe/.test(treff[0]), JSON.stringify(treff.slice(0, 3)));
  await p.keyboard.press('Enter');
  await p.waitForTimeout(400);
  const åpnet = await p.evaluate(() => window.__huskis.recipeOpenId);
  log(navn + ': treffet åpner oppskriften', åpnet === ids.R1, String(åpnet));
  await p.evaluate(() => window.__huskis.closeRecipe());

  /* Lister og Notater lever fortsatt */
  await p.click('#tab-lists');
  await p.waitForTimeout(200);
  const lister = await p.evaluate(() => !document.getElementById('board').hidden &&
    document.getElementById('recipes-board').hidden);
  await p.click('#tab-notes');
  await p.waitForTimeout(200);
  const notater = await p.evaluate(() => !document.getElementById('notes-board').hidden &&
    window.__huskis.state.noteProjects.filter((x) => x.kind !== 'recipe').length === 0 &&
    !document.querySelector('#notes-board .note-card[data-id]'));
  log(navn + ': Lister og Notater tegnes som før, og oppskriftene lekker ikke inn i Notater', lister && notater);

  log(navn + ': ingen JS-feil', errs.length === 0, errs.slice(0, 3).join(' | '));
  await browser.close();
}

/* 10–11. Deling og offentlig lenke (desktop). */
async function runSharing() {
  const viewport = { width: 1200, height: 900 };
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport });
  const errs = [];
  const { db, ids } = buildDB();
  const a = await ctx.newPage();
  a.on('pageerror', (e) => errs.push('A: ' + e.message));
  await seed(a, db);
  await loginAs(a, ids.uA, 'a@x.no');
  // Hver side har sin egen økt (sessionStorage), men deler databasen.
  const b = await ctx.newPage();
  b.on('pageerror', (e) => errs.push('B: ' + e.message));
  await loginAs(b, ids.uB, 'b@x.no');
  const c = await ctx.newPage();
  c.on('pageerror', (e) => errs.push('C: ' + e.message));
  await loginAs(c, ids.uC, 'c@x.no');

  /* 10. Medlem ser alt under kokeboken */
  const bSer = await b.evaluate((ids) => ({
    book: !!window.__huskis.state.noteProjects.find((x) => x.id === ids.B),
    r1: !!window.__huskis.findRecipe(ids.R1), r3: !!window.__huskis.findRecipe(ids.R3),
  }), ids);
  log('deling: et medlem av kokeboken ser kapitlene og oppskriftene under den (arv)',
    bSer.book && bSer.r1 && bSer.r3, JSON.stringify(bSer));
  const cSer = await c.evaluate(() => window.__huskis.state.noteProjects.length + window.__huskis.state.notes.length);
  log('deling: en uten rolle ser ingenting av kokeboken', cSer === 0, String(cSer));

  await b.evaluate((id) => { window.__huskis.setMainTab('recipes'); window.__huskis.openRecipe(id, { edit: true }); }, ids.R1);
  await b.waitForTimeout(300);
  const kanRedigere = await b.evaluate(() => !document.getElementById('recipe-edit-btn').hidden &&
    !!document.querySelector('#recipe-sheet input'));
  log('deling: medlemmet kan redigere oppskriften', kanRedigere);
  await b.fill('#recipe-title-input', 'Tomatsuppe med basilikum');
  await b.evaluate(() => window.__huskis.flushRecipeSave());
  await sync(b);
  await waitDb(b, 'notes', ids.R1, 'row && row.title === "Tomatsuppe med basilikum"');
  await sync(a);
  const aSer = await a.waitForFunction((id) => {
    const r = window.__huskis.findRecipe(id);
    return r && r.title === 'Tomatsuppe med basilikum';
  }, ids.R1, { timeout: 10000, polling: 200 }).then(() => true, () => false);
  log('deling: eieren ser medlemmets endring', aSer);

  // Medlemmets delingsvindu: ingen kontroll for offentlig lenke.
  await b.evaluate(() => window.__huskis.closeRecipe());
  await b.evaluate(() => window.__huskis.openRecipesNav());
  await b.waitForTimeout(300);
  await b.click('#recipes-nav-board .recipe-book-card .card-cog');
  await b.click('.obj-menu-row:has-text("Deling")');
  await b.waitForTimeout(800);
  const bLenke = await b.evaluate(() => {
    const s = document.querySelector('#share-modal .share-public');
    return s ? !s.hidden : false;
  });
  log('deling: et medlem får ingen kontroll for offentlig lenke', !bLenke);
  const bRpc = await b.evaluate(async (id) => {
    const r = await window.HK_MOCK.createClient().rpc('recipe_link_create', { p_type: 'note_project', p_id: id });
    return { data: r.data, error: !!r.error };
  }, ids.B);
  log('deling: serveren nekter et medlem å lage en offentlig lenke', !bRpc.data, JSON.stringify(bRpc));

  /* 11. Offentlig lenke til kapittelet «Supper» */
  await a.evaluate(() => { window.__huskis.setMainTab('recipes'); window.__huskis.openRecipesNav(); });
  await a.waitForTimeout(300);
  await a.click('#recipes-nav-board .recipe-chapter[data-id="' + ids.C1 + '"] .cat-cog');
  await a.click('.obj-menu-row:has-text("Deling")');
  await a.waitForSelector('#share-modal .share-public:not([hidden]) button', { timeout: 8000 });
  const note = await a.textContent('#share-modal .share-public .share-policy-note');
  log('lenke: delingsvinduet sier at offentlige lenker bare gir lesetilgang',
    /Offentlige lenker gir utelukkende lesetilgang/.test(note), note);
  await a.click('#share-modal .share-public button:has-text("Lag lenke")');
  await a.waitForSelector('.share-public-url', { timeout: 8000 });
  const url = await a.inputValue('.share-public-url');
  const tok = url.split('#')[1] || '';
  log('lenke: lenken har en lang, tilfeldig nøkkel i fragmentet', /oppskrift\.html/.test(url) && tok.length >= 32, url);

  const anon = await ctx.newPage();
  anon.on('pageerror', (e) => errs.push('anon: ' + e.message));
  await anon.goto(url);
  await anon.waitForSelector('.pub-index, .pub-message', { timeout: 8000 });
  const vis = await anon.evaluate(() => ({
    titles: [...document.querySelectorAll('.pub-recipe-title')].map((e) => e.textContent),
    edit: !!document.querySelector('#pub-main input, #pub-main textarea, .recipe-edit-btn'),
  }));
  log('lenke: åpnes uten innlogging og viser kapittelets oppskrift — ikke naboens',
    JSON.stringify(vis.titles) === '["Tomatsuppe med basilikum"]' && !vis.edit, JSON.stringify(vis));

  const rå = await anon.evaluate(async (t) => {
    const r = await window.HK_MOCK.createClient().rpc('recipe_public_get', { p_token: t });
    return JSON.stringify(r.data);
  }, tok);
  // Linjene i oppskriften har sine egne korte nøkler (redigeringens), men
  // ingen databaseid-er, ingen pekere oppover i treet og ingen personer.
  log('lenke: svaret inneholder verken database-id-er, pekere eller personer',
    !/[0-9a-f]{8}-[0-9a-f]{4}-/.test(rå) && !/@x\.no|Alice|Bo Medlem|owner|project|folder|created_by|token/.test(rå),
    rå.slice(0, 160));

  const skriv = await anon.evaluate(async (ids) => {
    const cl = window.HK_MOCK.createClient();
    const u = await cl.from('notes').update({ title: 'Hacket' }).eq('id', ids.R1);
    const r = await cl.rpc('recipe_link_create', { p_type: 'note_folder', p_id: ids.C2 });
    const m = await cl.rpc('get_my_doc', {});
    return { update: !!u.error, link: !!r.error, doc: !!m.error };
  }, ids);
  const etterSkriv = await dbRow(a, 'notes', ids.R1);
  log('lenke: den anonyme leseren kan verken skrive eller lese noe annet',
    skriv.link && skriv.doc && etterSkriv.title === 'Tomatsuppe med basilikum', JSON.stringify(skriv));

  await anon.click('.pub-recipe');
  await anon.waitForSelector('.recipe-serv-more');
  await anon.click('.recipe-serv-more');
  const pubSkalert = await anon.evaluate(() => document.querySelector('.recipe-ing-list li').textContent);
  log('lenke: leseren kan skalere porsjonene lokalt', pubSkalert === '500 g hermetiske tomater', pubSkalert);

  // Eieren endrer — lenken viser det ved neste henting.
  await a.evaluate((id) => {
    const H = window.__huskis;
    H.closeRecipesNav && H.closeRecipesNav();
  }, ids.R1);
  await a.evaluate(() => { document.getElementById('share-close').click(); });
  await a.evaluate((id) => window.__huskis.openRecipe(id, { edit: true }), ids.R1);
  await a.waitForTimeout(300);
  await a.fill('#recipe-title-input', 'Tomatsuppe deluxe');
  await a.evaluate(() => window.__huskis.flushRecipeSave());
  await sync(a);
  await waitDb(a, 'notes', ids.R1, 'row && row.title === "Tomatsuppe deluxe"');
  await anon.reload();
  await anon.waitForSelector('.pub-index, .pub-message', { timeout: 8000 });
  const oppdatert = await anon.evaluate(() => [...document.querySelectorAll('.pub-recipe-title')].map((e) => e.textContent));
  log('lenke: oppdatert innhold vises', JSON.stringify(oppdatert) === '["Tomatsuppe deluxe"]', JSON.stringify(oppdatert));

  // Flyttes oppskriften ut av det delte kapittelet, følger den ikke med lenken.
  await a.evaluate((ids) => {
    const H = window.__huskis;
    H.closeRecipe();
  }, ids);
  await a.evaluate(async (ids) => {
    await window.HK_MOCK._edit((db) => { db.notes.find((n) => n.id === ids.R1).folder_id = ids.C2; });
  }, ids);
  await anon.reload();
  await anon.waitForSelector('.pub-index, .pub-message', { timeout: 8000 });
  const flyttet = await anon.evaluate(() => [...document.querySelectorAll('.pub-recipe-title')].map((e) => e.textContent));
  log('lenke: en oppskrift som flyttes ut av det delte kapittelet, vises ikke lenger', flyttet.length === 0,
    JSON.stringify(flyttet));
  await a.evaluate(async (ids) => {
    await window.HK_MOCK._edit((db) => { db.notes.find((n) => n.id === ids.R1).folder_id = ids.C1; });
  }, ids);

  // Slå av lenken.
  await a.evaluate((ids) => window.__huskis.openRecipesNav(), ids);
  await a.waitForTimeout(300);
  await a.click('#recipes-nav-board .recipe-chapter[data-id="' + ids.C1 + '"] .cat-cog');
  await a.click('.obj-menu-row:has-text("Deling")');
  await a.waitForSelector('.share-public-url', { timeout: 8000 });
  await a.click('#share-modal .share-public button:has-text("Slå av lenken")');
  await a.click('#confirm-ok, .confirm-ok, #confirm-modal .btn-red, #confirm-modal button:has-text("Slå av lenken")');
  await a.waitForSelector('#share-modal .share-public button:has-text("Lag lenke")', { timeout: 8000 });
  await anon.reload();
  await anon.waitForSelector('.pub-message', { timeout: 8000 });
  const død = await anon.textContent('.pub-message');
  log('lenke: en avslått lenke slutter å virke', /virker ikke lenger/.test(død), død.trim());
  const ny = await a.evaluate(async (id) => {
    const r = await window.HK_MOCK.createClient().rpc('recipe_link_create', { p_type: 'note_folder', p_id: id });
    return r.data;
  }, ids.C1);
  log('lenke: en ny lenke får en ny nøkkel', ny && ny !== tok);

  log('deling og lenke: ingen JS-feil', errs.length === 0, errs.slice(0, 3).join(' | '));
  await browser.close();
}

(async () => {
  await runOwner('desktop', { width: 1200, height: 900 }, false);
  await runOwner('mobil', { width: 390, height: 780 }, true);
  await runSharing();
  const ok = results.filter(Boolean).length;
  console.log('\n==== ' + ok + '/' + results.length + ' PASS ====');
  process.exit(ok === results.length ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
