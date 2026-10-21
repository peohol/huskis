/*
  Nettlesertest for OPPSKRIFTENE — den tredje hoveddelen (docs/oppskrifter.md)
  — mot mock-backenden (?mock=1).

  Dekker:
    1. Tre hovedfaner: Oppskrifter viser sin egen flate, og Lister og Notater
       tegnes fortsatt når man bytter tilbake
    2. Kokebokmenyen: kokeboken som områdekort, kapitlene som mappekategorier
       og oppskriftene som mapper — en fri oppskrift står MELLOM kapitlene på
       nivå 1, uten noen «Uten kapittel»-rad; de grønne og gule ＋-knappene
       bærer ikonet for det de lager
    2b. Et kapittel dras som en mappekategori: løftet er én linje med
       kapittelikonet foran, og den nye rekkefølgen lagres
    3. Dra-og-slipp i kokebokmenyen: en oppskrift flyttes inn i et kapittel, og
       den nye plasseringen lagres
    3b. Kassen for kapitler og oppskrifter står i kokeboken, som mappekassen i
       et område — draget folder ut bokens kasse, ikke fotens — og et slipp der
       sletter med «Angre»
    4. Nytt kapittel med den gule knappen
    4b. Kokebøkene bytter plass som områdene: det løftede kortet følger
       pekeren, og rekkefølgen står seg etter en omlasting
    5. Løs opp et kapittel: kapittelet forsvinner, oppskriftene blir liggende
       rett i kokeboken på kapittelets plass — ingen går tapt
    6. Lesevisningen: ingredienser og nummererte steg, porsjonsvelgeren
       skalerer mengdene, og det lagrede grunnlaget endres ALDRI av det
    7. Redigeringsmodusen: ny ingrediensgruppe (den gule knappen bærer
       kategori-ikonet), «Øvrige ingredienser» når det finnes grupper, et
       håndtak nesten like høyt som feltene og midtstilt på raden, en linje som
       står i ro sidelengs mens den dras, dra en linje inn i en gruppe, og en
       ingrediens kan ALDRI slippes blant stegene
    8. Oppløs en gruppe: linjene blir, i samme rekkefølge
    9. Søket: scopen «Oppskrifter» finner en oppskrift på en ingrediens, og
       treffet åpner den
   10. Deling med medlemmer: et medlem av kokeboken ser kapitler og oppskrifter
       (arv nedover), kan redigere, men får ingen kontroll for offentlig lenke;
       en uten rolle ser ingenting
   11. Offentlig lenke: lages i delingsvinduet, åpnes UTEN innlogging, viser
       bare det som er delt, svaret inneholder verken id-er eller personer,
       den anonyme leseren kan ikke skrive, endringer vises, og en avslått
       lenke slutter å virke; et fragment som byttes midt i en henting viser
       den nye lenken, en tvetydig tittel gir innholdslisten, og lenken i
       testmodus peker på adressen appen kjører på
   12. Et kapittel delt DIREKTE med en egen eier som ikke har tilgang til
       kokeboken: «Løs opp kapittelet» vises ikke, og et direkte kall endrer
       ingenting — ingen halv oppløsning der kapittelet forsvinner mens
       oppskriftene ikke kan flyttes. En offentlig lenke eieren laget, dør
       varig når hen mister eierskapet, også om det kommer tilbake.
   13. Rettighetene endres mellom klientens sjekk og serverens: en oppskrift i
       kapittelet låses mens medlemmet løser det opp. Serveren avviser HELE
       oppløsningen, og verken databasen eller visningen er halvveis endret.
   14. Ingen JS-feil

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
        // Brød står MELLOM de to kapitlene på bokens nivå 1.
        base({ id: R2, owner_id: uA, project_id: B, folder_id: null, title: 'Brød', body: '', recipe: empty, pos: 0.5 }),
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

/* Et løft rett etter et slipp kan komme før brettet er løftbart igjen, og i en
   modal er et mislykket forsøk dyrt: gestens nytt-forsøk slipper musa på
   bakteppet (`dnd-gestures.js`, AWAY), og det lukker modalen. Vent derfor til
   raden har stått som den SAMME noden en stund før neste løft. */
const quiet = (p, sel) => p.evaluate(() => { window.__stille = null; }).then(() => p.waitForFunction((s) => {
  const el = document.querySelector(s);
  const w = window.__stille || (window.__stille = { el: null, t: 0, bytt: 0 });
  if (el !== w.el) { w.el = el; w.t = performance.now(); w.bytt++; return false; }
  return !!el && performance.now() - w.t > 400;
}, sel, { timeout: 8000, polling: 100 })).catch(() => {});

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
  const ekstraRad = await p.evaluate(() => [...document.querySelectorAll('#recipes-nav-board .recipe-row')]
    .filter((r) => !r.dataset.id || !window.__huskis.findRecipe(r.dataset.id)).length);
  log(navn + ': kokebokmenyen blander den frie oppskriften med kapitlene, uten noen «Uten kapittel»-rad',
    JSON.stringify(tre) === JSON.stringify([['Supper', 'Tomatsuppe', 'Brød', 'Kaker', 'Sjokoladekake']]) &&
    ekstraRad === 0, JSON.stringify({ tre, ekstraRad }));
  const ikoner = await p.evaluate(() => {
    const card = document.querySelector('#recipes-nav-board .recipe-book-card');
    // «＋» foran ikonet for det knappen lager — også den gule kapittelknappen.
    const has = (sel) => {
      const b = card.querySelector(sel);
      return !!b && !!b.querySelector('.add-kind-icon svg') && !!b.querySelector(':scope > svg.icon');
    };
    return { oppskrift: has('.add-item-btn'), kapittel: has('.add-cat-btn'), iKapittel: has('.cat-add-btn') };
  });
  log(navn + ': ＋-knappene viser ＋ og ikonet for det de lager (oppskrift, kapittel, oppskrift i kapittel)',
    ikoner.oppskrift && ikoner.kapittel && ikoner.iKapittel, JSON.stringify(ikoner));

  /* 2b. Kaker over Supper — som en mappekategori */
  const kapHode = (id) => '#recipes-nav-board .recipe-chapter[data-id="' + id + '"] > .cat-head';
  const kapMål = await G.centre(p, kapHode(ids.C1));
  await G.lift(p, await G.centre(p, kapHode(ids.C2) + ' .cat-title'), touch);
  const løftet = await p.evaluate(() => {
    const el = document.querySelector('#recipes-nav-board .recipe-chapter[data-dnd-dragging]');
    if (!el) return null;
    const t = el.querySelector('.cat-title');
    const icon = el.querySelector('.cat-drag-icon');
    return {
      linjer: Math.round(t.getBoundingClientRect().height / parseFloat(getComputedStyle(t).lineHeight)),
      ikon: getComputedStyle(icon).display !== 'none' && !!icon.querySelector('svg'),
    };
  });
  await G.travel(p, { x: kapMål.x, y: kapMål.y - 8 }, touch);
  await G.drop(p, undefined, touch);
  const kapOrden = await navText(p);
  log(navn + ': et løftet kapittel er én linje med kapittelikonet foran, og bytter plass som en mappekategori',
    !!løftet && løftet.linjer <= 1 && løftet.ikon && kapOrden[0][0] === 'Kaker' && kapOrden[0][2] === 'Supper',
    JSON.stringify({ løftet, kapOrden }));
  await sync(p);
  log(navn + ': kapittelrekkefølgen lagres',
    await waitDb(p, 'note_folders', ids.C2, 'row && row.pos < 0'));

  /* 2c. Hullet ved kantene: over et kapittel (den øvre halvdelen av hodet) og
     i gapet mellom to kapitler står plassholderen på bokens nivå 1 — der
     slippet lander — og ikke inne i kapittelet. */
  await settle(p);
  const hull = () => p.evaluate(() => {
    const ph = document.querySelector('#recipes-nav-board .recipe-book-card [data-dnd-placeholder]');
    if (!ph) return null;
    const nivå1 = ph.parentNode.classList.contains('items-container');
    const neste = ph.nextElementSibling;
    return { nivå1, i: ph.parentNode.className, foran: neste && neste.dataset.id, synlig: !document.body.classList.contains('is-hole-gone') };
  });
  const hodeTopp = (id) => p.evaluate((sel) => {
    const r = document.querySelector(sel).getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + 3 };
  }, kapHode(id));
  // Hullet flytter layouten mens pekeren er på vei, så målet siktes inn på nytt
  // der det står når pekeren er framme.
  let hodeSikt = null;
  const siktHode = async (id) => {
    for (let i = 0; i < 3; i++) { hodeSikt = await G.travel(p, await hodeTopp(id), touch); await p.waitForTimeout(120); }
    hodeSikt = Object.assign({}, hodeSikt, { hode: await p.evaluate((sel) => {
      const r = document.querySelector(sel).getBoundingClientRect(); return [Math.round(r.top), Math.round(r.bottom)];
    }, kapHode(id)) });
  };
  await quiet(p, rowSel(ids.R2));
  await G.lift(p, await G.centre(p, rowSel(ids.R2)), touch);
  await siktHode(ids.C2);
  const overFørste = await hull();
  await G.drop(p, undefined, touch);
  await p.waitForTimeout(300);
  const førstNå = await navText(p);
  log(navn + ': over øverste kapittel står plassholderen foran kapittelet, og oppskriften lander der',
    !!overFørste && overFørste.nivå1 && overFørste.foran === ids.C2 && overFørste.synlig && førstNå[0][0] === 'Brød',
    JSON.stringify({ overFørste, førstNå, hodeSikt }));
  await settle(p);
  await quiet(p, rowSel(ids.R2));
  await G.lift(p, await G.centre(p, rowSel(ids.R2)), touch);
  await siktHode(ids.C1);
  const mellom = await hull();
  await G.drop(p, undefined, touch);
  await p.waitForTimeout(300);
  const mellomNå = await navText(p);
  log(navn + ': mellom to kapitler står plassholderen mellom dem, og oppskriften lander der',
    !!mellom && mellom.nivå1 && mellom.foran === ids.C1 && mellom.synlig &&
    JSON.stringify(mellomNå[0]) === JSON.stringify(['Kaker', 'Sjokoladekake', 'Brød', 'Supper', 'Tomatsuppe']),
    JSON.stringify({ mellom, mellomNå, hodeSikt }));

  /* 3. Dra Brød inn i Supper. Synk-runden etter kapittel-slippet tegner menyen
     på nytt; et løft midt i den mister raden under fingeren. */
  await settle(p);
  const fra = await G.centre(p, rowSel(ids.R2));
  const til = await G.past(p, rowSel(ids.R1), 0.8);
  await G.dragFromTo(p, fra, til, { touch });
  await p.waitForTimeout(300);
  const etter = await p.evaluate((id) => window.__huskis.findRecipe(id).folder, ids.R2);
  log(navn + ': en oppskrift dras inn i et kapittel', etter === ids.C1, String(etter));
  await sync(p);
  log(navn + ': den nye plasseringen lagres på serveren',
    await waitDb(p, 'notes', ids.R2, 'row && row.folder_id === ' + JSON.stringify(ids.C1)));

  /* 3b. Kassen for kapitler og oppskrifter står i boken, som mappekassen i et
     område: draget folder ut BOKENS kasse, foten (bøkenes kasse) blir skjult,
     og et slipp der legger oppskriften i bokens kasse. «Angre» tar den
     tilbake. */
  const bokKasse = '#recipes-nav-board .recipe-book-card[data-id="' + ids.B + '"] .recipe-row-trash-btn';
  // Raden øverst i rullefeltet, så kassen under den står i synsfeltet.
  await p.evaluate((sel) => document.querySelector(sel).scrollIntoView({ block: 'start' }), rowSel(ids.R2));
  await G.lift(p, await G.centre(p, rowSel(ids.R2)), touch);
  const kasseUnderDrag = await p.evaluate((sel) => {
    const btn = document.querySelector(sel);
    return {
      iBoken: !!btn && !btn.hidden && !btn.closest('[hidden]') && btn.classList.contains('drag-trash'),
      foten: !document.getElementById('recipe-nav-trash').hidden,
    };
  }, bokKasse);
  await G.travel(p, await G.centre(p, bokKasse), touch);
  await G.drop(p, undefined, touch);
  await p.waitForTimeout(300);
  const iKassen = await p.evaluate(({ sel, id }) => {
    const btn = document.querySelector(sel);
    return {
      borte: !document.querySelector('#recipes-nav-board .recipe-row[data-id="' + id + '"]'),
      antall: btn && !btn.closest('[hidden]') ? btn.querySelector('.trashcan-count').textContent : null,
      foten: !document.getElementById('recipe-nav-trash').hidden,
    };
  }, { sel: bokKasse, id: ids.R2 });
  await p.click('.toast-action');
  await p.waitForTimeout(300);
  const angret = await p.evaluate((id) => !!document.querySelector('#recipes-nav-board .recipe-row[data-id="' + id + '"]'), ids.R2);
  log(navn + ': kokeboken har sin egen kasse for kapitler og oppskrifter, som mappekassen i et område',
    kasseUnderDrag.iBoken && !kasseUnderDrag.foten && iKassen.borte && iKassen.antall === '1' && !iKassen.foten && angret,
    JSON.stringify({ kasseUnderDrag, iKassen, angret }));

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

  /* 4b. En ny kokebok, og den første dras ned under den — som et område.
     Den ØVERSTE løftes: kassen i foten folder seg ut ved løft, og et kort
     løftet helt nederst ville havnet under den (det samme gjør områdene). */
  await p.click('#recipes-nav-board .recipes-add-book button');
  await p.waitForTimeout(250);
  await p.keyboard.type('Bakst');
  await p.keyboard.press('Enter');
  await p.waitForTimeout(250);
  const bøker = () => p.evaluate(() => [...document.querySelectorAll('#recipes-nav-board .recipe-book-card .card-title')]
    .map((t) => t.textContent));
  const førBøker = await bøker();
  const middagHode = '#recipes-nav-board .recipe-book-card:first-of-type > .card-head';
  await p.evaluate((s) => document.querySelector(s).scrollIntoView({ block: 'start' }), middagHode);
  await G.lift(p, await G.centre(p, middagHode + ' .uni-icon'), touch);
  // Kortene kollapser ved løft, så målet måles ETTER løftet: under den andre boken.
  const over = await p.evaluate(() => {
    const r = [...document.querySelectorAll('#recipes-nav-board .recipe-book-card:not([data-dnd-dragging]) > .card-head')]
      .find((h) => h.querySelector('.card-title').textContent === 'Bakst').getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.bottom - 4 };
  });
  const sikt = await G.travel(p, over, touch);
  const følger = await p.evaluate((pt) => {
    const r = document.querySelector('#recipes-nav-board .recipe-book-card[data-dnd-dragging]').getBoundingClientRect();
    return pt.x >= r.left && pt.x <= r.right && pt.y >= r.top && pt.y <= r.bottom;
  }, sikt);
  await G.drop(p, undefined, touch);
  const etterBøker = await bøker();
  log(navn + ': kokebøkene bytter plass som områdene, og det løftede kortet følger pekeren',
    JSON.stringify(førBøker) === '["Middag","Bakst"]' && JSON.stringify(etterBøker) === '["Bakst","Middag"]' && følger,
    JSON.stringify({ førBøker, etterBøker, følger }));
  await sync(p);
  await settle(p);
  await p.reload();
  await p.waitForFunction(() => window.__huskis && window.__huskis.lastMy, null, { timeout: 20000, polling: 200 });
  await p.evaluate(() => window.__huskis.openRecipesNav());
  await p.waitForTimeout(300);
  const lagretBøker = await bøker();
  log(navn + ': bokrekkefølgen står seg etter en omlasting', JSON.stringify(lagretBøker) === '["Bakst","Middag"]',
    JSON.stringify(lagretBøker));

  /* 5. Løs opp «Supper» fra kapittelmenyen */
  await p.click('#recipes-nav-board .recipe-chapter[data-id="' + ids.C1 + '"] .cat-cog');
  await p.waitForTimeout(250);
  await p.click('.obj-menu-row:has-text("Løs opp kapittelet")');
  // Oppløsningen går som ÉN operasjon på serveren; visningen følger svaret.
  await p.waitForFunction((id) => !document.querySelector('#recipes-nav-board .recipe-chapter[data-id="' + id + '"]'),
    ids.C1, { timeout: 8000, polling: 150 }).catch(() => {});
  const løst = await p.evaluate((ids) => ({
    chapter: !!document.querySelector('#recipes-nav-board .recipe-chapter[data-id="' + ids.C1 + '"]'),
    r1: window.__huskis.findRecipe(ids.R1), r2: window.__huskis.findRecipe(ids.R2),
  }), ids);
  // Supper står mellom Kaker og Desserter: oppskriftene arver plassen dens.
  const løstOrden = (await navText(p)).find((b) => b.includes('Kaker'));
  const påPlassen = JSON.stringify(løstOrden.slice(0, 2)) === '["Kaker","Sjokoladekake"]' &&
    JSON.stringify(løstOrden.slice(2, 4).sort()) === '["Brød","Tomatsuppe"]' && løstOrden[4] === 'Desserter';
  log(navn + ': et oppløst kapittel forsvinner, og oppskriftene blir liggende rett i kokeboken, på kapittelets plass',
    !løst.chapter && løst.r1 && løst.r2 && løst.r1.folder === null && løst.r2.folder === null && påPlassen,
    JSON.stringify({ c: løst.chapter, r1: løst.r1 && løst.r1.folder, r2: løst.r2 && løst.r2.folder, løstOrden }));
  await sync(p);
  log(navn + ': oppløsningen lagres — oppskriftene finnes fortsatt, uten kapittel',
    await waitDb(p, 'notes', ids.R1, 'row && !row.trashed && row.folder_id === null') &&
    await waitDb(p, 'notes', ids.R2, 'row && !row.trashed && row.folder_id === null'));

  /* 5b. Endre navn på kokeboken, slett en oppskrift og angre */
  await p.click('#recipes-nav-board .recipe-book-card[data-id="' + ids.B + '"] .card-cog');
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
  const redKnapper = await p.evaluate(() => {
    const row = document.querySelector('.recipe-sec[data-sec="ing"] .recipe-add-row');
    const gul = row.querySelector('.btn-yellow');
    // Kategoriens klamme — samme ikon som den gule knappen i en liste.
    return { gul: !!gul && gul.innerHTML.indexOf('M8.5 4.5H6.5') > -1 };
  });
  log(navn + ': den gule knappen i redigeringen bærer kategori-ikonet', redKnapper.gul);
  const håndtak = await p.evaluate((sel) => {
    const g = document.querySelector(sel).getBoundingClientRect();
    const f = document.querySelector(sel).closest('.recipe-line').querySelector('input').getBoundingClientRect();
    return { høyde: g.height / f.height, skjevhet: Math.abs((g.top + g.bottom) / 2 - (f.top + f.bottom) / 2) };
  }, grip('i1'));
  log(navn + ': håndtaket er nesten like høyt som feltene og midtstilt på raden',
    håndtak.høyde >= 0.8 && håndtak.høyde <= 1 && håndtak.skjevhet <= 1, JSON.stringify(håndtak));
  // Pekeren drar skrått ut til siden og tilbake: raden står i ro sidelengs.
  const linjeFra = await G.centre(p, grip('i1'));
  await G.lift(p, linjeFra, touch);
  const venstre0 = await p.evaluate(() => document.querySelector('.recipe-line[data-dnd-dragging]').getBoundingClientRect().left);
  await G.travel(p, { x: linjeFra.x + 70, y: linjeFra.y + 6 }, touch);
  const venstre1 = await p.evaluate(() => document.querySelector('.recipe-line[data-dnd-dragging]').getBoundingClientRect().left);
  const radFør = await p.evaluate(() => document.querySelector('.recipe-line').getBoundingClientRect().left);
  await G.travel(p, linjeFra, touch);
  await G.drop(p, undefined, touch);
  log(navn + ': en linje som dras står i ro sidelengs, der den lå',
    Math.abs(venstre1 - venstre0) <= 1 && Math.abs(venstre0 - radFør) <= 1,
    JSON.stringify({ venstre0, venstre1, radFør }));
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
  await p.click('.recipe-sec[data-sec="ing"] .recipe-sub .recipe-sub-head .cat-cog');
  await p.click('.obj-menu-row:has-text("Løs opp gruppen")');
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

  /* 8b. Draget i redigeringen svarer bare i sin egen seksjon. En oppskrift med
     ingredienser og ingen steg: en løftet ingrediens rører ikke
     fremgangsmåten. En løftet ingrediensgruppe foldes sammen med søsknene
     sine, mens gruppene i fremgangsmåten står urørt. Hullet er malt, og det
     som dras slipper lys gjennom, som alt annet som dras. */
  await p.evaluate((id) => window.__huskis.openRecipe(id, { edit: true }), ids.R3);
  await p.waitForTimeout(300);
  const sec = (k) => '.recipe-sec[data-sec="' + k + '"]';
  const nyGruppe = async (k, navn2) => {
    await p.click(sec(k) + ' .recipe-add-row .btn-yellow');
    await p.waitForTimeout(150);
    await p.keyboard.type(navn2);
  };
  await p.click(sec('ing') + ' .recipe-add-row .btn-green');
  await p.waitForTimeout(150);
  await p.keyboard.type('mel');
  await nyGruppe('ing', 'Deig');
  await nyGruppe('ing', 'Fyll');
  await p.waitForTimeout(250);
  const stegHøyde = () => p.evaluate((s) => document.querySelector(s).getBoundingClientRect().height, sec('step'));
  const malt = () => p.evaluate(() => {
    const ph = document.querySelector('#recipe-sheet [data-dnd-placeholder]');
    const dr = document.querySelector('#recipe-sheet [data-dnd-dragging]');
    // `color-mix` kan gi både rgba(…) og color(srgb … / a).
    const alfa = (c) => {
      const slash = c.match(/\/\s*([\d.]+)\s*\)\s*$/);
      if (slash) return parseFloat(slash[1]);
      const v = (c.match(/rgba?\(([^)]+)\)/) || [])[1];
      const parts = v ? v.split(/[\s,]+/).filter(Boolean) : [];
      return parts.length > 3 ? parseFloat(parts[3]) : 1;
    };
    return { hull: !!ph && getComputedStyle(ph).visibility === 'visible',
      gjennomsiktig: !!dr && alfa(getComputedStyle(dr).backgroundColor) < 1 };
  });
  const melGrep = await p.evaluate((s) => {
    const l = [...document.querySelectorAll(s + ' .recipe-main .recipe-line')].pop();
    return l ? '.recipe-line[data-id="' + l.dataset.id + '"] .recipe-grip' : null;
  }, sec('ing'));
  const h0 = await stegHøyde();
  const melFra = await G.centre(p, melGrep);
  await G.lift(p, melFra, touch);
  await G.travel(p, { x: melFra.x, y: melFra.y + 4 }, touch);
  await p.waitForTimeout(150);
  const h1 = await stegHøyde();
  const linjeMalt = await malt();
  await G.travel(p, melFra, touch);
  await G.drop(p, undefined, touch);
  await p.waitForTimeout(300);
  // Løftet der kassen folder seg ut (nederst på telefonen) og sluppet på
  // samme sted: kassen tar ikke imot før pekeren har vært utenfor den.
  const melIgjen = await p.evaluate((id) => window.__huskis.findRecipe(id).recipe.ing.items.length, ids.R3);
  log(navn + ': en løftet ingrediens rører ikke fremgangsmåten, hullet er malt og linjen slipper lys gjennom — og den finnes fortsatt etter slippet',
    Math.abs(h1 - h0) < 1 && linjeMalt.hull && linjeMalt.gjennomsiktig && melIgjen === 1,
    JSON.stringify({ h0, h1, linjeMalt, melIgjen }));
  await nyGruppe('step', 'Forberedelse');
  await p.waitForTimeout(250);
  const fyllFra = await G.centre(p, sec('ing') + ' .recipe-sub:last-child .recipe-sub-head .recipe-sub-title');
  await G.lift(p, fyllFra, touch);
  await G.travel(p, { x: fyllFra.x, y: fyllFra.y + 4 }, touch);
  await p.waitForTimeout(150);
  const foldet = await p.evaluate(([ing, step]) => {
    const shown = (el) => !!el && getComputedStyle(el).display !== 'none';
    const subs = (s) => [...document.querySelectorAll(s + ' .recipe-sub:not([data-dnd-placeholder])')]
      .map((u) => shown(u.querySelector('.recipe-sub-body')));
    return { ing: subs(ing), step: subs(step) };
  }, [sec('ing'), sec('step')]);
  const gruppeMalt = await malt();
  await G.travel(p, fyllFra, touch);
  await G.drop(p, undefined, touch);
  await p.waitForTimeout(400);
  const utfoldet = await p.evaluate((s) => [...document.querySelectorAll(s + ' .recipe-sub .recipe-sub-body')]
    .every((el) => getComputedStyle(el).display !== 'none'), sec('ing'));
  log(navn + ': en løftet ingrediensgruppe foldes sammen med søsknene, og gruppene i fremgangsmåten står urørt',
    foldet.ing.length === 2 && foldet.ing.every((v) => !v) && foldet.step.length === 1 && foldet.step[0] &&
    gruppeMalt.hull && gruppeMalt.gjennomsiktig && utfoldet, JSON.stringify({ foldet, gruppeMalt, utfoldet }));

  /* 8c. Gruppene er overskrifter over et kort, og alt flyttes og slettes også
     uten dra-og-slipp: fra menyknappen. Kassen i foten sletter direkte. */
  const doc3 = () => p.evaluate((id) => window.__huskis.findRecipe(id).recipe, ids.R3);
  const oppsett = await p.evaluate((s) => {
    const u = document.querySelector(s + ' .recipe-sub');
    const head = u.querySelector(':scope > .recipe-sub-head');
    const body = u.querySelector(':scope > .recipe-sub-body');
    const t = head.querySelector('.recipe-sub-title').getBoundingClientRect();
    const m = head.querySelector('.cat-cog').getBoundingClientRect();
    return { over: head.getBoundingClientRect().bottom <= body.getBoundingClientRect().top + 0.5,
      utenforKortet: !body.contains(head), menyTilHøyre: m.left >= t.right - 0.5,
      ingenSlettX: !document.querySelector('#recipe-sheet .recipe-line .icon-btn'),
      linjemeny: document.querySelectorAll('#recipe-sheet .recipe-line .item-cog.obj-menu-btn').length ===
        document.querySelectorAll('#recipe-sheet .recipe-line').length,
      småBokstaver: [...document.querySelectorAll('#recipe-sheet .recipe-unit-input, #recipe-sheet .recipe-name-input')]
        .every((f) => f.getAttribute('autocapitalize') === 'none') };
  }, sec('ing'));
  log(navn + ': gruppens tittel står over kortet med menyen til høyre; linjene har meny i stedet for slett-kryss, og ingrediensfeltene gir ikke stor forbokstav',
    Object.values(oppsett).every(Boolean), JSON.stringify(oppsett));

  const menyFlytt = async (knapp, retning) => {
    await p.click(knapp);
    await p.locator('.obj-menu-row.obj-menu-toggle', { hasText: 'Flytt' }).click();
    await p.waitForTimeout(250);
    await p.click('.obj-menu-row[data-move="' + retning + '"]');
    await p.waitForTimeout(200);
    await p.keyboard.press('Escape');
    await p.waitForTimeout(200);
  };
  await menyFlytt(sec('ing') + ' .recipe-sub:last-child .recipe-sub-head .cat-cog', '-1');
  const gruppeOpp = (await doc3()).ing.subs.map((u) => u.name);
  log(navn + ': «Flytt opp» i gruppens meny flytter gruppen', JSON.stringify(gruppeOpp) === '["Fyll","Deig"]',
    JSON.stringify(gruppeOpp));
  await menyFlytt(sec('ing') + ' .recipe-main .recipe-line .item-cog', '-1');
  const linjeOpp = await doc3();
  log(navn + ': «Flytt opp» på første linje utenfor gruppene legger den sist i gruppen over',
    linjeOpp.ing.items.length === 0 && linjeOpp.ing.subs[1].items.map((l) => l.t || l.qs).join() === 'mel',
    JSON.stringify(linjeOpp.ing));

  // Kassen i foten: synlig mens noe dras, sletter med én gang ved slipp.
  const melId = linjeOpp.ing.subs[1].items[0].id;
  const kasseFra = await G.centre(p, '.recipe-line[data-id="' + melId + '"] .recipe-grip');
  await G.lift(p, kasseFra, touch);
  await G.travel(p, () => G.centre(p, '#recipe-edit-trash-btn'), touch);
  const kasse = await p.evaluate(() => {
    const r = document.getElementById('recipe-edit-trash-btn').getBoundingClientRect();
    return { synlig: !document.getElementById('recipe-edit-trash').hidden && r.height > 0,
      nederst: Math.abs(r.bottom - innerHeight) < 60, bred: r.width > innerWidth * 0.6,
      sikter: document.getElementById('recipe-edit-trash-btn').classList.contains('drop-target') };
  });
  await G.drop(p, undefined, touch);
  await p.waitForTimeout(300);
  const etterKasse = await p.evaluate(() => ({ skjult: document.getElementById('recipe-edit-trash').hidden,
    modal: !document.getElementById('confirm-modal').hidden }));
  const ingEtter = (await doc3()).ing;
  log(navn + ': kassen i foten vises under draget og sletter linjen direkte, uten spørsmål',
    Object.values(kasse).every(Boolean) && etterKasse.skjult && !etterKasse.modal &&
    !ingEtter.subs.some((u) => u.items.some((l) => l.id === melId)), JSON.stringify({ kasse, etterKasse }));
  await G.dragFromTo(p, await G.centre(p, sec('step') + ' .recipe-sub .recipe-sub-title'),
    () => G.centre(p, '#recipe-edit-trash-btn'), { touch });
  await p.waitForTimeout(300);
  log(navn + ': en gruppe slippes i kassen og er borte', (await doc3()).step.subs.length === 0);

  // En tom linje forsvinner når man går ut av den — med klikk andre steder eller Enter.
  await p.click(sec('step') + ' .recipe-add-row .btn-green');
  await p.waitForTimeout(200);
  const tomInne = (await doc3()).step.items.length;
  await p.click('.recipe-desc-input');
  await p.waitForTimeout(300);
  const tomUte = (await doc3()).step.items.length;
  await p.click(sec('step') + ' .recipe-add-row .btn-green');
  await p.waitForTimeout(200);
  await p.keyboard.type('Rør');
  await p.keyboard.press('Enter');
  await p.waitForTimeout(200);
  const nesteRad = (await doc3()).step.items.length;
  await p.keyboard.press('Enter');
  await p.waitForTimeout(300);
  const stegEtter = (await doc3()).step.items.map((l) => l.t);
  log(navn + ': en tom ny linje forsvinner når man klikker et annet sted eller trykker Enter i den',
    tomInne === 1 && tomUte === 0 && nesteRad === 2 && JSON.stringify(stegEtter) === '["Rør"]',
    JSON.stringify({ tomInne, tomUte, nesteRad, stegEtter }));

  // «Øvrige ingredienser» er dempet bare mens man redigerer.
  await p.click(sec('ing') + ' .recipe-add-row .btn-green');
  await p.waitForTimeout(150);
  await p.keyboard.type('sukker');
  await p.waitForTimeout(150);
  const farge = () => p.evaluate((s) => {
    const c = (el) => el && getComputedStyle(el).color;
    return { øvrige: c(document.querySelector(s + ' .recipe-other-name')),
      gruppe: c(document.querySelector(s + ' .recipe-sub-name:not(.recipe-other-name)')) };
  }, sec('ing'));
  const iRed = await farge();
  await p.click('#recipe-edit-btn');
  await p.waitForTimeout(300);
  const iLes = await farge();
  log(navn + ': «Øvrige ingredienser» er grå i redigeringen og som de andre overskriftene ellers',
    !!iRed.øvrige && iRed.øvrige !== iRed.gruppe && !!iLes.øvrige && iLes.øvrige === iLes.gruppe,
    JSON.stringify({ iRed, iLes }));
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

  const topp = await anon.evaluate(() => ({
    tilbake: !document.getElementById('pub-back').hidden,
    hjem: document.querySelector('.pub-bar .pub-brand').href === location.origin + '/'
      && document.querySelector('.pub-invite-cta').href === location.origin + '/',
    logo: !!document.querySelector('.pub-bar .pub-brand img.pub-logo'),
    lesing: /kun lesing/.test(document.querySelector('.pub-bar').textContent),
    invitasjon: !document.getElementById('pub-invite').hidden,
  }));
  log('lenke: toppmenyen har Huskis-logoen som lenke til appens forside (huskis.no), ingen «kun lesing» og ingen Tilbake i innholdslisten',
    !topp.tilbake && topp.hjem && topp.logo && !topp.lesing, JSON.stringify(topp));
  log('lenke: en som ikke er logget inn får invitasjonen nederst', topp.invitasjon, JSON.stringify(topp));
  // Stripa: to midtstilte tekstlinjer, knappen midtstilt UNDER dem. Linjene
  // brytes ikke når det er plass — heller ikke på en vanlig telefon.
  const stripe = () => anon.evaluate(() => {
    const r = (s) => document.querySelector(s).getBoundingClientRect();
    // Linjene teksten faktisk står på: toppene til tekstboksene, med slingring
    // for logoen midt i tittelen.
    const linjer = (s) => {
      const rg = document.createRange();
      rg.selectNodeContents(document.querySelector(s));
      const tops = [...rg.getClientRects()].filter((q) => q.width > 0).map((q) => q.top).sort((a, b) => a - b);
      return tops.filter((t, i) => i === 0 || t - tops[i - 1] > 10).length;
    };
    const box = r('#pub-invite'), cta = r('.pub-invite-cta'), tekst = r('.pub-invite-text');
    return { tittel: linjer('.pub-invite-title'), under: linjer('.pub-invite-sub'),
      knappMidt: Math.abs((cta.left + cta.right) / 2 - (box.left + box.right) / 2) <= 2,
      knappUnder: cta.top >= tekst.bottom - 0.5 };
  });
  // Merket står i vater: «Huskis» på samme linje som teksten foran, og logoen
  // midtstilt på den linja. Ingen hjerte.
  const vater = await anon.evaluate(() => {
    const t = document.querySelector('.pub-invite-title');
    const brand = t.querySelector('.pub-invite-brand');
    const rect = (node) => { const r = document.createRange(); r.selectNodeContents(node); return r.getBoundingClientRect(); };
    const foran = rect(t.firstChild), navn = rect(brand.lastChild);
    const logo = brand.querySelector('img').getBoundingClientRect();
    return { navn: Math.abs(navn.bottom - foran.bottom), logo: Math.abs((logo.top + logo.bottom) / 2 - (foran.top + foran.bottom) / 2),
      hjerte: /[❤♥]/.test(t.textContent) };
  });
  log('lenke: logoen og «Huskis» står i vater med resten av invitasjonen, uten hjerte',
    vater.navn <= 1 && vater.logo <= 2 && !vater.hjerte, JSON.stringify(vater));
  const stripeBred = await stripe();
  await anon.setViewportSize({ width: 390, height: 780 });
  await anon.waitForTimeout(200);
  const stripeSmal = await stripe();
  await anon.setViewportSize(viewport);
  log('lenke: invitasjonen er to linjer tekst med «Meld deg inn nå» midtstilt under (desktop og telefon)',
    [stripeBred, stripeSmal].every((x) => x.tittel === 1 && x.knappMidt && x.knappUnder) && stripeBred.under === 1,
    JSON.stringify({ stripeBred, stripeSmal }));
  await anon.click('.pub-recipe');
  await anon.waitForSelector('.recipe-serv-more');
  log('lenke: inne i en oppskrift står Tilbake i toppmenyen',
    await anon.evaluate(() => !document.getElementById('pub-back').hidden && !document.querySelector('#pub-main .pub-back')));
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

  // Et fragment som byttes mens den forrige hentingen er på vei: den NYE
  // nøkkelen hentes, og svaret for den gamle kastes — ellers viser siden den
  // gamle lenkens innhold under den nye adressen.
  const tok2 = await a.evaluate(async (id) => {
    const r = await window.HK_MOCK.createClient().rpc('recipe_link_create', { p_type: 'note_folder', p_id: id });
    return r.data;
  }, ids.C2);
  await anon.goto(url.replace('?mock=1', '?mock=1&lag=700'));
  await anon.evaluate((t) => { location.hash = t; }, tok2);
  await anon.waitForSelector('.pub-index', { timeout: 8000 });
  await anon.waitForTimeout(1200);  // fraværsbevis: det gamle svaret skal ikke tegnes over
  const byttet = await anon.evaluate(() => [...document.querySelectorAll('.pub-recipe-title')].map((e) => e.textContent));
  log('lenke: et byttet fragment viser den nye lenkens innhold, ikke svaret for den gamle',
    JSON.stringify(byttet) === '["Sjokoladekake"]', JSON.stringify(byttet));

  // Et valgt antall porsjoner følger ikke med til en annen oppskrift som får
  // samme plass i en annen lenke.
  await a.evaluate(async (ids) => {
    await window.HK_MOCK._edit((db) => { db.notes.find((n) => n.id === ids.R3).recipe.serv = 2; });
  }, ids);
  await anon.goto(url);
  await anon.waitForSelector('.pub-index', { timeout: 8000 });
  await anon.click('.pub-recipe');
  await anon.waitForSelector('.recipe-serv-more', { timeout: 8000 });
  await anon.click('.recipe-serv-more');
  await anon.evaluate((t) => { location.hash = t; }, tok2);
  await anon.waitForSelector('.pub-index', { timeout: 8000 });
  await anon.click('.pub-recipe');
  await anon.waitForSelector('.recipe-serv-value', { timeout: 8000 });
  const annenOppskrift = await anon.evaluate(() => document.querySelector('.recipe-serv-value').textContent);
  log('lenke: porsjonsvalget i én oppskrift følger ikke med til en annen på samme plass',
    annenOppskrift === '2 porsjoner', annenOppskrift);
  await a.evaluate(async (ids) => {
    await window.HK_MOCK._edit((db) => { db.notes.find((n) => n.id === ids.R3).recipe.serv = null; });
  }, ids);

  // To oppskrifter med samme tittel kan ikke skilles uten id-er: står leseren i
  // den ene når innholdet hentes på nytt, går hen til innholdslisten i stedet
  // for å vise den andre.
  await anon.goto(url);
  await anon.waitForSelector('.pub-index', { timeout: 8000 });
  await anon.click('.pub-recipe');
  await anon.waitForSelector('.recipe-ing-list', { timeout: 8000 });
  const dupId = U();
  await a.evaluate(async ({ ids, dupId }) => {
    await window.HK_MOCK._edit((db) => {
      const r = db.notes.find((n) => n.id === ids.R1);
      db.notes.push(Object.assign(JSON.parse(JSON.stringify(r)), { id: dupId, pos: -1,
        recipe: Object.assign({}, r.recipe, { desc: 'En helt annen suppe.' }) }));
    });
  }, { ids, dupId });
  await anon.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  const tilListe = await anon.waitForSelector('.pub-index', { timeout: 8000 }).then(() => true, () => false);
  const annenSuppe = await anon.evaluate(() => /En helt annen suppe/.test(document.body.textContent));
  log('lenke: en tvetydig tittel etter ny henting gir innholdslisten, ikke en annen oppskrift',
    tilListe && !annenSuppe, 'liste=' + tilListe + ' annen=' + annenSuppe);
  await a.evaluate(async (dupId) => {
    await window.HK_MOCK._edit((db) => { db.notes = db.notes.filter((n) => n.id !== dupId); });
  }, dupId);

  // I testmodus (lokalt OG i en preview-deploy) peker lenken på DENNE adressen,
  // der mock-databasen finnes — ikke på det kanoniske domenet.
  const altBase = BASE.replace(/\/\/(localhost|127\.0\.0\.1)(?=[:/]|$)/, '//127.0.0.2');
  const alt = await ctx.newPage();
  await alt.goto(altBase + '/?mock=1');
  await alt.waitForFunction(() => window.__huskis && window.__huskis.recipePublicUrl, null, { timeout: 8000 });
  const altUrl = await alt.evaluate(() => window.__huskis.recipePublicUrl('abc'));
  log('lenke: i testmodus peker lenken på adressen appen kjører på',
    altUrl === altBase + '/oppskrift.html?mock=1#abc', altUrl);
  // En preview-deploy viser sin EGEN versjon av siden; produksjonen lenker til
  // det kanoniske domenet.
  const deployUrl = await alt.evaluate(() => ({
    preview: window.__huskis.recipePublicUrl('abc', { mock: false, deploy: 'preview' }),
    production: window.__huskis.recipePublicUrl('abc', { mock: false, deploy: 'production' }),
  }));
  log('lenke: en preview peker på seg selv, produksjonen på huskis.no',
    deployUrl.preview === altBase + '/oppskrift.html#abc'
      && deployUrl.production === 'https://huskis.no/oppskrift.html#abc', JSON.stringify(deployUrl));
  await alt.close();

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

  // Invitasjonen: × lukker den for godt i nettleseren, og en innlogget
  // Huskis-bruker (her: Alices fane) ser den aldri.
  const tokNy = '#' + ny;
  await anon.goto(url.split('#')[0] + tokNy);
  await anon.waitForSelector('.pub-index', { timeout: 8000 });
  await anon.click('#pub-invite-close');
  await anon.reload();
  await anon.waitForSelector('.pub-index', { timeout: 8000 });
  const lukket = await anon.evaluate(() => document.getElementById('pub-invite').hidden);
  await anon.evaluate(() => localStorage.removeItem('hk-pub-invite-closed'));
  await a.goto(url.split('#')[0] + tokNy);
  await a.waitForSelector('.pub-index', { timeout: 8000 });
  const innlogget = await a.evaluate(() => document.getElementById('pub-invite').hidden);
  log('lenke: invitasjonen kan lukkes for godt, og en innlogget bruker ser den ikke', lukket && innlogget,
    JSON.stringify({ lukket, innlogget }));

  log('deling og lenke: ingen JS-feil', errs.length === 0, errs.slice(0, 3).join(' | '));
  await browser.close();
}

/* 12. Direkte delt kapittel med egen eier, uten boktilgang (desktop). */
async function runSharedChapterOwner() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  const errs = [];
  const { db, ids } = buildDB();
  const C2own = { id: U(), user_id: ids.uC, universe_id: null, group_id: null, note_project_id: null,
    note_folder_id: ids.C2, note_id: null, role: 'owner', pos: 0, created_at: 1 };
  db.memberships.push(C2own);
  const c = await ctx.newPage();
  c.on('pageerror', (e) => errs.push('C: ' + e.message));
  await seed(c, db);
  await loginAs(c, ids.uC, 'c@x.no');

  const ser = await c.evaluate((ids) => {
    const H = window.__huskis;
    const ch = H.findRecipeChapter(ids.C2);
    return { chapter: !!ch, book: !!H.state.noteProjects.find((x) => x.id === ids.B), recipe: !!H.findRecipe(ids.R3) };
  }, ids);
  log('kapitteleier uten boktilgang: ser kapittelet og oppskriften, men ikke kokeboken',
    ser.chapter && ser.recipe && !ser.book, JSON.stringify(ser));

  await c.evaluate(() => { window.__huskis.setMainTab('recipes'); window.__huskis.openRecipesNav(); });
  await c.waitForSelector('#recipes-nav-board .recipe-chapter[data-id="' + ids.C2 + '"] .cat-cog', { timeout: 8000 });
  await c.click('#recipes-nav-board .recipe-chapter[data-id="' + ids.C2 + '"] .cat-cog');
  await c.waitForSelector('.obj-menu-row', { timeout: 8000 });
  const rader = await c.evaluate(() => [...document.querySelectorAll('.obj-menu-row')].map((e) => e.textContent.trim()));
  log('kapitteleier uten boktilgang: menyen har ikke «Løs opp kapittelet» (men har «Slett»)',
    !rader.some((t) => /Løs opp/.test(t)) && rader.some((t) => /Slett/.test(t)), JSON.stringify(rader));
  await c.keyboard.press('Escape');

  await c.evaluate((id) => window.__huskis.dissolveRecipeChapter(id), ids.C2);
  await sync(c);
  await settle(c);
  // Og serveren selv — klientens skjuling er bare UX.
  const rpc = await c.evaluate(async (id) => {
    const r = await window.HK_MOCK.createClient().rpc('recipe_chapter_dissolve', { p_folder: id, p_ts: Date.now(), p_org: 'x' });
    return { data: r.data, error: r.error && r.error.message };
  }, ids.C2);
  log('kapitteleier uten boktilgang: serveren avviser oppløsningen',
    !rpc.data && /mangler/.test(rpc.error || ''), JSON.stringify(rpc));
  const etter = await c.evaluate((ids) => {
    const db = JSON.parse(localStorage.getItem('hk-mock-db'));
    const f = db.note_folders.find((x) => x.id === ids.C2);
    const r = db.notes.find((x) => x.id === ids.R3);
    return { lokalt: !!window.__huskis.findRecipeChapter(ids.C2), rad: !!f && !f.trashed,
      grav: (db.tombstones || []).some((t) => t.id === ids.C2), folder: r && r.folder_id === ids.C2 };
  }, ids);
  log('kapitteleier uten boktilgang: et direkte kall løser ikke opp kapittelet — alt står urørt',
    etter.lokalt && etter.rad && !etter.grav && etter.folder, JSON.stringify(etter));

  // Lenken: lages av kapitteleieren, dør når hen mister eierskapet og
  // gjenoppstår ikke når det kommer tilbake (ingen lesing imellom).
  const tok = await c.evaluate(async (id) => {
    const r = await window.HK_MOCK.createClient().rpc('recipe_link_create', { p_type: 'note_folder', p_id: id });
    return r.data;
  }, ids.C2);
  const setRole = (role) => c.evaluate(async ({ mid, role }) => {
    await window.HK_MOCK._edit((db) => { db.memberships.find((m) => m.id === mid).role = role; });
  }, { mid: C2own.id, role });
  const lesLenke = () => c.evaluate(async (t) => {
    const r = await window.HK_MOCK.createClient().rpc('recipe_public_get', { p_token: t });
    return r.data ? r.data.type : null;
  }, tok);
  const før = await lesLenke();
  await setRole('member');
  await setRole('owner');
  const gjenoppstått = await lesLenke();
  log('kapitteleier: en lenke som døde da eierskapet falt bort, gjenoppstår ikke når det kommer tilbake',
    !!tok && før === 'chapter' && gjenoppstått === null, 'før=' + før + ' etter=' + gjenoppstått);

  log('kapitteleier: ingen JS-feil', errs.length === 0, errs.slice(0, 3).join(' | '));
  await browser.close();
}

/* 13. Rettighetene endres mens klienten står med gammel tilstand (desktop).
   Bo er medlem og har lov til å løse opp «Supper» — slik klienten hans ser
   det. Før kallet når serveren, låser Alice oppskriften i kapittelet, så Bo
   ikke lenger får flytte den. Serveren skal avvise HELE oppløsningen:
   kapittelet står, oppskriften ligger i det, og Bos visning er urørt. */
async function runDissolveStale() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  const errs = [];
  const { db, ids } = buildDB();
  const b = await ctx.newPage();
  b.on('pageerror', (e) => errs.push('B: ' + e.message));
  await seed(b, db);
  await loginAs(b, ids.uB, 'b@x.no');
  await b.evaluate(() => { window.__huskis.setMainTab('recipes'); window.__huskis.openRecipesNav(); });
  await b.waitForSelector('#recipes-nav-board .recipe-chapter[data-id="' + ids.C1 + '"] .cat-cog', { timeout: 8000 });
  await b.click('#recipes-nav-board .recipe-chapter[data-id="' + ids.C1 + '"] .cat-cog');
  await b.waitForSelector('.obj-menu-row', { timeout: 8000 });
  const tilbys = await b.evaluate(() => [...document.querySelectorAll('.obj-menu-row')].some((e) => /Løs opp/.test(e.textContent)));
  log('foreldet klient: medlemmet får tilbud om å løse opp kapittelet (alt er lov ennå)', tilbys);

  // Låsingen og klikket i SAMME tikk: klienten rekker ikke å hente de nye
  // rettighetene, så det er serveren som må stoppe det.
  await b.evaluate(async (id) => {
    await window.HK_MOCK._edit((db) => { db.notes.find((n) => n.id === id).locked = true; });
  }, ids.R1);
  await b.click('.obj-menu-row:has-text("Løs opp kapittelet")');
  const avvist = await b.waitForFunction(() => {
    const t = document.querySelector('.toast, #toast');
    return t && /ikke lov til å flytte alle oppskriftene.*Ingenting ble endret/.test(t.textContent);
  }, null, { timeout: 8000, polling: 150 }).then(() => true, () => false);
  await settle(b);
  const etter = await b.evaluate((ids) => {
    const db = JSON.parse(localStorage.getItem('hk-mock-db'));
    const r1 = db.notes.find((x) => x.id === ids.R1);
    const lokal = window.__huskis.findRecipe(ids.R1);
    return { rad: db.note_folders.some((f) => f.id === ids.C1),
             grav: (db.tombstones || []).some((t) => t.resource_id === ids.C1),
             folder: r1 && r1.folder_id === ids.C1,
             lokaltKapittel: !!window.__huskis.findRecipeChapter(ids.C1),
             lokaltFolder: lokal && lokal.folder === ids.C1 };
  }, ids);
  log('foreldet klient: serveren avviser hele oppløsningen, og brukeren får beskjed', avvist, '');
  log('foreldet klient: ingenting er endret — verken i databasen eller i visningen',
    etter.rad && !etter.grav && etter.folder && etter.lokaltKapittel && etter.lokaltFolder, JSON.stringify(etter));

  log('foreldet klient: ingen JS-feil', errs.length === 0, errs.slice(0, 3).join(' | '));
  await browser.close();
}

(async () => {
  await runOwner('desktop', { width: 1200, height: 900 }, false);
  await runOwner('mobil', { width: 390, height: 780 }, true);
  await runSharing();
  await runSharedChapterOwner();
  await runDissolveStale();
  const ok = results.filter(Boolean).length;
  console.log('\n==== ' + ok + '/' + results.length + ' PASS ====');
  process.exit(ok === results.length ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
