/*
  Nettlesertest for OVERFLATING AV SKJEMA-AVVIK i synk-skrivingene (mot mock-
  backend, ?mock=1). Dekker fiksen for den stille synk-stoppen der klienten
  sender en kolonne databasen ikke har (cards/items.collapsed-hendelsen):
  PostgREST avviser hver insert/update, `pushOps` svelget feilen, og synken
  stoppet uten et eneste signal.

  Verifiserer:
    1. isSchemaMismatch(): klassifiserer ukjent-kolonne/-tabell som avvik, men
       IKKE RLS-avvisning, konflikt, nettverksfeil eller tom feil.
    2. E2E: en ekte PGRST204 på items-skrivinger (via patchet mock-klient) gir
       ÉN bruker-toast + en console.error — og den svelges ikke lenger.
    3. Regresjon: en normal redigering synker til «server» UTEN skjema-varsel.
  Kjøres på BÅDE desktop- og mobil-viewport.

  Kjør:
    python3 -m http.server 8000
    NODE_PATH=$(npm root -g) node tests/sync-schema-error.test.js
*/
const { chromium } = require(require('path').join(process.env.NODE_PATH || require('child_process').execSync('npm root -g').toString().trim(), 'playwright'));
const BASE = process.env.HUSKIS_URL || 'http://localhost:8000';

let passed = 0, failed = 0;
function check(name, cond) { if (cond) { passed++; } else { failed++; console.log('  ✗ FAIL:', name); } }

const U = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16); });

// Én egen-eid liste med ett listepunkt — skrivingene ville normalt lykkes.
function buildDB() {
  const uid = 'uMe';
  const PU = U(), PG = U(), PL = U(), PI = U();
  const base = (extra) => Object.assign({ trashed: false, locked: false, unlocked: false,
    invite_policy: 'inherit', ts: 1, org: 'a', pos: 0, pos_ts: 0, pos_org: '' }, extra);
  return {
    ids: { uid, PU, PG, PL, PI },
    db: {
      _PL: PL,
      profiles: [{ id: uid, email: 'me@x.no', display_name: 'Meg Selv', user_metadata: {} }],
      passwords: { 'me@x.no': 'x' },
      universes: [base({ id: PU, owner_id: uid, name: 'Mitt univers' })],
      groups: [base({ id: PG, owner_id: uid, universe_id: PU, name: 'Min gruppe' })],
      cards: [base({ id: PL, owner_id: uid, group_id: PG, title: 'Min liste', k: true, p: true, lab_ts: 0, lab_org: '' })],
      items: [base({ id: PI, owner_id: uid, card_id: PL, text: 'Punkt' })],
      memberships: [], share_invites: [], tombstones: [],
    },
  };
}

async function load(page, db, viewport) {
  await page.setViewportSize(viewport);
  await page.goto(BASE + '/?mock=1');
  await page.evaluate((db) => {
    // Full nullstilling mellom scenarioer: uten dette lekker den per-bruker
    // offline-bufferen (mine-lister-v1:<uid>) fra forrige scenario inn (samme
    // uid + origin) og forurenser state.
    localStorage.clear(); sessionStorage.clear();
    localStorage.setItem('hk-mock-db', JSON.stringify(db));
    sessionStorage.setItem('hk-mock-session', JSON.stringify({ id: 'uMe', email: 'me@x.no', user_metadata: {} }));
  }, db);
  await page.goto(BASE + '/?mock=1');
  await page.waitForFunction(() => window.__huskis && window.__huskis.authUser, { timeout: 5000 });
  await page.waitForFunction((plid) => {
    const h = window.__huskis; if (!h || !h.state) return false;
    for (const u of h.state.universes) for (const g of (u.groups || [])) for (const c of (g.cards || [])) if (c.id === plid) return true;
    return false;
  }, db._PL, { timeout: 5000 });
}

// Endrer teksten på det første listepunktet i state og bumper innholds-ts-en,
// så neste cloudCycle genererer en ekte update-op mot items-tabellen.
async function editFirstItemAndSync(page, newText) {
  await page.evaluate((txt) => {
    const h = window.__huskis;
    let it = null;
    for (const u of h.state.universes) for (const g of (u.groups || [])) for (const c of (g.cards || [])) for (const x of (c.items || [])) { if (!it) it = x; }
    it.text = txt; it.ts = 8e15; it.org = 'zzz'; // vinner felt-LWW → update-op
    return h.cloudCycle();
  }, newText);
  await page.waitForTimeout(300);
}

async function scenario(page, viewport, label) {
  console.log('\n== ' + label + ' ==');

  // 1) isSchemaMismatch-klassifisering (ren funksjon).
  {
    await load(page, buildDB().db, viewport);
    const r = await page.evaluate(() => {
      const f = window.__huskis.isSchemaMismatch;
      return {
        pgrst204: f({ code: 'PGRST204', message: "Could not find the 'collapsed' column of 'items' in the schema cache" }),
        pgrst205: f({ code: 'PGRST205', message: 'Could not find the table ... in the schema cache' }),
        undefinedCol: f({ code: '42703', message: 'column "collapsed" of relation "items" does not exist' }),
        msgOnly: f({ message: 'Could not find the "x" column of "cards" in the schema cache' }),
        rls: f({ code: '42501', message: 'new row violates row-level security policy for table "items"' }),
        conflict: f({ code: '23505', message: 'duplicate key value violates unique constraint' }),
        network: f({ message: 'TypeError: Failed to fetch' }),
        notLoggedIn: f({ message: 'ikke innlogget' }),
        empty: f(null),
      };
    });
    check('detekter: PGRST204 (ukjent kolonne) = avvik', r.pgrst204 === true);
    check('detekter: PGRST205 (ukjent tabell) = avvik', r.pgrst205 === true);
    check('detekter: 42703 undefined_column = avvik', r.undefinedCol === true);
    check('detekter: melding uten kode gjenkjennes også', r.msgOnly === true);
    check('detekter: RLS-avvisning (42501) = IKKE avvik', r.rls === false);
    check('detekter: konflikt (23505) = IKKE avvik', r.conflict === false);
    check('detekter: nettverksfeil = IKKE avvik', r.network === false);
    check('detekter: «ikke innlogget» = IKKE avvik', r.notLoggedIn === false);
    check('detekter: tom feil = IKKE avvik', r.empty === false);
  }

  // 2) E2E: ekte PGRST204 på items-skriving → én toast + console.error.
  {
    await load(page, buildDB().db, viewport);
    // Patch mock-klienten: items-skrivinger returnerer et skjema-avvik (som om
    // items.collapsed manglet i basen), alt annet delegeres til ekte mock.
    await page.evaluate(() => {
      window.__errs = [];
      const origErr = console.error; console.error = function () { window.__errs.push([].slice.call(arguments).join(' ')); origErr.apply(console, arguments); };
      // Patch den LEVENDE klient-instansen appen bruker (acli() cacher den):
      // items-skrivinger returnerer et skjema-avvik (som om items.collapsed
      // manglet i basen), alt annet delegeres til ekte mock.
      const client = window.__huskis.client;
      const realFrom = client.from.bind(client);
      const errRes = { data: null, error: { code: 'PGRST204', message: "Could not find the 'collapsed' column of 'items' in the schema cache" } };
      client.from = function (table) {
        if (table === 'items') return {
          insert: () => Promise.resolve(errRes),
          update: () => ({ eq: () => Promise.resolve(errRes) }),
          delete: () => ({ eq: () => Promise.resolve(errRes) }),
          select: realFrom(table).select,
        };
        return realFrom(table);
      };
    });
    await editFirstItemAndSync(page, 'Endret A');
    const r = await page.evaluate(() => {
      const t = document.getElementById('toast');
      return { shown: !!(t && t.classList.contains('show')), text: t ? t.textContent : '', errCount: (window.__errs || []).filter(m => /mangler en kolonne/.test(m)).length };
    });
    check('E2E: bruker-toast vises ved skjema-avvik', r.shown === true);
    check('E2E: toasten sier at endringen ikke nådde skyen', /kunne ikke synkes til skyen/.test(r.text));
    check('E2E: console.error logget avviket', r.errCount >= 1);

    // Andre runde med samme feil: fortsatt bare ÉN console.error-signatur (dedup),
    // og varselet nag-er ikke på nytt (schemaMismatchWarned holder).
    await editFirstItemAndSync(page, 'Endret B');
    const r2 = await page.evaluate(() => (window.__errs || []).filter(m => /mangler en kolonne/.test(m)).length);
    check('E2E: gjentatt avvik dedupliseres (én logg-signatur)', r2 === 1);
  }

  // 3) Regresjon: normal redigering (upatchet) synker uten skjema-varsel.
  {
    const s = buildDB();
    await load(page, s.db, viewport);
    await editFirstItemAndSync(page, 'Normalt endret');
    const r = await page.evaluate((plid) => {
      const t = document.getElementById('toast');
      const db = JSON.parse(localStorage.getItem('hk-mock-db'));
      const it = (db.items || []).find(i => i.card_id === plid);
      return { toastText: t ? t.textContent : '', persisted: it ? it.text : null };
    }, s.ids.PL);
    check('regresjon: endringen synket til «server»', r.persisted === 'Normalt endret');
    check('regresjon: INGEN skjema-varsel ved normal synk', !/kunne ikke synkes til skyen/.test(r.toastText));
  }
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(e.message));
  await scenario(page, { width: 1200, height: 900 }, 'DESKTOP (1200×900)');
  await scenario(page, { width: 390, height: 780 }, 'MOBIL (390×780)');
  check('ingen ukontrollerte JS-feil på siden', pageErrors.length === 0);
  if (pageErrors.length) pageErrors.slice(0, 6).forEach(e => console.log('  PAGEERROR:', e));
  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
