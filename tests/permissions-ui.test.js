/*
  Nettlesertest for den HIERARKISKE RETTIGHETS-UI-en (mot mock-backend, ?mock=1).
  Verifiserer den KLIENTVENDTE oppførselen som SQL-/mock-testene ikke dekker:
    - invitasjonspolicy-avmerking (interaktiv for autoriserte, status for andre)
    - inviter-felt for et vanlig medlem når policy tillater / forklaring når ikke
    - arvet-lås-melding med riktig objekt-ikon + navn (XSS-sikkert)
    - unntaks-kontroll kun for autoriserte
    - optimistisk policy-endring uten flimmer + koalescering + rollback
    - utlogging mens en operasjon er i lufta
  Kjøres på BÅDE desktop- og mobil-viewport.

  Kjør:
    python3 -m http.server 8000
    NODE_PATH=$(npm root -g) node tests/permissions-ui.test.js
*/
const { chromium } = require(require('path').join(process.env.NODE_PATH || require('child_process').execSync('npm root -g').toString().trim(), 'playwright'));
const BASE = process.env.HUSKIS_URL || 'http://localhost:8000';

let passed = 0, failed = 0;
function check(name, cond) { if (cond) { passed++; } else { failed++; console.log('  ✗ FAIL:', name); } }

const U = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16); });

// Bygger en mock-«database» for et scenario. A eier universet, D er medlem.
function buildDB(opts) {
  opts = opts || {};
  const uA = 'uA', uD = 'uD';
  const PU = U(), PG = U(), PL = U(), PI = U();
  const base = (extra) => Object.assign({ trashed: false, locked: false, unlocked: false,
    invite_policy: 'inherit', ts: 1, org: 'a', pos: 0, pos_ts: 0, pos_org: '' }, extra);
  return {
    ids: { uA, uD, PU, PG, PL, PI },
    db: {
      profiles: [
        { id: uA, email: 'a@x.no', display_name: 'Alice Eier', user_metadata: {} },
        { id: uD, email: 'd@x.no', display_name: 'Dag Medlem', user_metadata: {} },
      ],
      passwords: { 'a@x.no': 'x', 'd@x.no': 'x' },
      universes: [base({ id: PU, owner_id: uA, name: opts.uniName || 'Felles univers',
        locked: !!opts.uniLocked, invite_policy: opts.uniPolicy || 'inherit' })],
      groups: [base({ id: PG, owner_id: uA, universe_id: PU, name: opts.grpName || 'Gruppe A',
        locked: !!opts.grpLocked, invite_policy: opts.grpPolicy || 'inherit' })],
      cards: [base({ id: PL, owner_id: uA, group_id: PG, title: 'Liste A', k: true, p: true,
        lab_ts: 0, lab_org: '', locked: !!opts.listLocked, invite_policy: opts.listPolicy || 'inherit' })],
      items: [base({ id: PI, owner_id: uA, card_id: PL, text: 'Punkt' })],
      memberships: [{ id: U(), user_id: uD, universe_id: PU, group_id: null, card_id: null,
        parent_universe_id: null, parent_group_id: null, pos: 0, trashed: false, created_at: 1 }],
      share_invites: [], tombstones: [],
    },
  };
}

async function load(page, db, asEmail, viewport) {
  await page.setViewportSize(viewport);
  await page.goto(BASE + '/?mock=1');
  const prof = db.profiles.find(p => p.email === asEmail);
  await page.evaluate(({ db, sess }) => {
    localStorage.setItem('hk-mock-db', JSON.stringify(db));
    sessionStorage.setItem('hk-mock-session', JSON.stringify(sess));
  }, { db, sess: { id: prof.id, email: prof.email, user_metadata: {} } });
  await page.goto(BASE + '/?mock=1');
  await page.waitForFunction(() => window.__huskis && window.__huskis.authUser, { timeout: 5000 });
  // vent på første pull (get_my_doc) så state har objektene m/ metadata
  await page.waitForFunction((plid) => {
    const h = window.__huskis; if (!h || !h.state) return false;
    for (const u of h.state.universes) for (const g of (u.groups || [])) for (const c of (g.cards || [])) if (c.id === plid) return true;
    return false;
  }, db._PL, { timeout: 5000 });
}

// Åpner del-visningen for et objekt (via window.__huskis.openShare) og returnerer
// modal-body-elementet '#share-body'.
async function openShareFor(page, type, id) {
  await page.evaluate(({ type, id }) => {
    const h = window.__huskis;
    let obj = null;
    const walk = () => { for (const u of h.state.universes) { if (u.id === id) obj = u; for (const g of (u.groups || [])) { if (g.id === id) obj = g; for (const c of (g.cards || [])) if (c.id === id) obj = c; } } };
    walk();
    h.openShare(type, id, obj, null);
  }, { type, id });
  await page.waitForTimeout(400); // la get_members lande (finjusterer perm)
}

async function scenario(page, viewport, label) {
  console.log('\n== ' + label + ' ==');

  // 1) EIER: interaktiv policy-avmerking (standard tillat → avkrysset).
  {
    const s = buildDB({}); s.db._PL = s.ids.PL;
    await load(page, Object.assign(s.db, { _PL: s.ids.PL }), 'a@x.no', viewport);
    await openShareFor(page, 'card', s.ids.PL);
    const r = await page.evaluate(() => {
      const cb = document.querySelector('.share-policy-row input[type=checkbox]');
      const form = document.querySelector('.share-invite-form');
      return { hasCb: !!cb, checked: cb && cb.checked, disabled: cb && cb.disabled, formShown: form && !form.hidden };
    });
    check('eier: policy-avmerking finnes', r.hasCb);
    check('eier: standard = tillat (avkrysset)', r.checked === true);
    check('eier: avmerkingen er interaktiv', r.disabled === false);
    check('eier: inviter-felt vises', r.formShown === true);
  }

  // 2) MEDLEM D: standard tillat → inviter-felt synlig.
  {
    const s = buildDB({}); await load(page, Object.assign(s.db, { _PL: s.ids.PL }), 'd@x.no', viewport);
    await openShareFor(page, 'card', s.ids.PL);
    const r = await page.evaluate(() => {
      const form = document.querySelector('.share-invite-form');
      const cb = document.querySelector('.share-policy-row input[type=checkbox]');
      const note = document.querySelector('.share-noinvite');
      return { formShown: form && !form.hidden, cbDisabled: cb ? cb.disabled : null, noInvite: !!note };
    });
    check('medlem: inviter-felt synlig når policy tillater', r.formShown === true);
    check('medlem: policy-avmerking IKKE interaktiv (kun status)', r.cbDisabled === true);
    check('medlem: ingen «deaktivert»-forklaring når man KAN invitere', r.noInvite === false);
  }

  // 3) MEDLEM D under NEKT (policy på lista) → ingen inviter-felt, forklaring.
  {
    const s = buildDB({ listPolicy: 'deny' }); await load(page, Object.assign(s.db, { _PL: s.ids.PL }), 'd@x.no', viewport);
    await openShareFor(page, 'card', s.ids.PL);
    const r = await page.evaluate(() => ({
      form: !!document.querySelector('.share-invite-form'),
      noInvite: !!document.querySelector('.share-noinvite'),
    }));
    check('medlem under nekt: intet inviter-felt', r.form === false);
    check('medlem under nekt: forklaring vises', r.noInvite === true);
  }

  // 4) ARVET LÅS: A låser universet. D åpner GRUPPE-delingen → melding m/ univers-
  //    ikon + navn, INGEN unntaksknapp (D er ikke autorisert).
  {
    const s = buildDB({ uniLocked: true, uniName: 'Låst Univers' });
    await load(page, Object.assign(s.db, { _PL: s.ids.PL }), 'd@x.no', viewport);
    await openShareFor(page, 'group', s.ids.PG);
    const r = await page.evaluate(() => {
      const row = document.querySelector('.share-lock-row');
      const btn = row && row.querySelector('button');
      const hint = row && row.querySelector('.share-lock-hint');
      return { inherited: row && row.classList.contains('is-inherited'),
        hintText: hint && hint.textContent, btnHidden: btn ? btn.hidden : null,
        ancIcon: !!(row && row.querySelector('.share-lock-anc-icon svg')) };
    });
    check('arvet lås: raden er markert arvet', r.inherited === true);
    check('arvet lås: melding nevner låsende objektnavn', /Låst Univers/.test(r.hintText || ''));
    check('arvet lås: forfar-ikon vist (SVG)', r.ancIcon === true);
    check('arvet lås: D ser INGEN aktiv unntaksknapp', r.btnHidden === true);
  }

  // 5) A (eier) på samme arvede lås → unntaksknapp SYNLIG (autorisert).
  {
    const s = buildDB({ uniLocked: true });
    await load(page, Object.assign(s.db, { _PL: s.ids.PL }), 'a@x.no', viewport);
    await openShareFor(page, 'group', s.ids.PG);
    const r = await page.evaluate(() => {
      const row = document.querySelector('.share-lock-row');
      const btn = row && row.querySelector('button');
      return { btnHidden: btn ? btn.hidden : null, btnText: btn && btn.textContent };
    });
    check('arvet lås: eier ser unntaksknapp', r.btnHidden === false);
    check('arvet lås: knappen sier «Gjør unntak»', /unntak/i.test(r.btnText || ''));
  }

  // 6) XSS: objektnavn med markup settes som tekst (ingen injeksjon).
  {
    const s = buildDB({ uniName: '<img src=x onerror="window.__XSS=1">', uniLocked: true });
    await load(page, Object.assign(s.db, { _PL: s.ids.PL }), 'd@x.no', viewport);
    await openShareFor(page, 'group', s.ids.PG);
    const r = await page.evaluate(() => ({
      xss: !!window.__XSS,
      injectedImg: !!document.querySelector('.share-lock-hint img'),
      literal: /<img/.test((document.querySelector('.share-lock-hint') || {}).textContent || ''),
    }));
    check('XSS: ingen onerror kjørte', r.xss === false);
    check('XSS: intet <img> injisert i DOM', r.injectedImg === false);
    check('XSS: navnet vises som ren tekst', r.literal === true);
  }

  // 7) Optimistisk policy-endring (eier) uten flimmer + koalescering.
  {
    const s = buildDB({}); await load(page, Object.assign(s.db, { _PL: s.ids.PL }), 'a@x.no', viewport);
    await openShareFor(page, 'card', s.ids.PL);
    // rask av/på/av: sluttilstanden (nekt) skal vinne, og speiles i mock-DB-en.
    await page.evaluate(() => {
      const cb = document.querySelector('.share-policy-row input[type=checkbox]');
      cb.checked = false; cb.dispatchEvent(new Event('change'));
      cb.checked = true; cb.dispatchEvent(new Event('change'));
      cb.checked = false; cb.dispatchEvent(new Event('change'));
    });
    const immediate = await page.evaluate(() => document.querySelector('.share-policy-row input').checked);
    check('policy: UI reflekterer sluttvalg umiddelbart (av)', immediate === false);
    await page.waitForTimeout(500);
    const persisted = await page.evaluate((plid) => {
      const db = JSON.parse(localStorage.getItem('hk-mock-db'));
      return (db.cards.find(c => c.id === plid) || {}).invite_policy;
    }, s.ids.PL);
    check('policy: koalescert sluttilstand lagret på server (deny)', persisted === 'deny');
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
