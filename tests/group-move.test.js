/*
  Nettlesertest for MAPPEFLYTTING mellom områder (mot mock-backend, ?mock=1).

  Serversemantikken er dekket av supabase/tests/test-group-moves.sql; her testes
  KLIENTEN:
    1. Samme eierskapsdomene → ren reparenting, ingen bekreftelse, samme id-er
    2. Ulikt eierskapsdomene → eksplisitt bekreftelse FØR flyttingen
    3. Avbrutt bekreftelse ruller mappen tilbake til kildeområdet
    4. Bekreftet kryssdomene-flytting bytter id-ene lokalt (mapping) uten at
       mappen forsvinner fra visningen, og gravlegger de gamle id-ene
    5. En mappe kan ikke slippes i et område man ikke kan opprette i
    6. `groups.universe_id` kan ikke skrives direkte (databasen avviser det)
    7. Et eierskifte hos ANDRE (som ikke endrer innhold, capabilities, rolle,
       `shared`, medlemstall eller eiertall) når likevel fram, så neste flytting
       ikke leser to ULIKE eierskapsdomener som like og hopper over bekreftelsen

  Kjør:
    python3 -m http.server 8000
    NODE_PATH=$(npm root -g) node tests/group-move.test.js
*/
const { chromium } = require(require('path').join(process.env.NODE_PATH || require('child_process').execSync('npm root -g').toString().trim(), 'playwright'));
const BASE = process.env.HUSKIS_URL || 'http://localhost:8000';

const results = [];
const log = (n, ok, x = '') => { results.push(ok); console.log((ok ? 'PASS' : 'FAIL') + ' — ' + n + (x ? '  [' + x + ']' : '')); };

const U = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
  const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
});

/* A eier U1 og U3 (domene {A}); U2 er co-eid av A og B (domene {A,B}).
   Mappen G ligger i U1 med én liste og ett listepunkt.
   U4 eies av B alene — A er ikke medlem og kan ikke opprette der. */
function buildDB() {
  const uA = 'uA', uB = 'uB', uC = 'uC';
  const U1 = U(), U2 = U(), U3 = U(), U4 = U(), U5 = U(), U6 = U();
  const G = U(), L = U(), I = U(), GX = U();
  const base = (x) => Object.assign({ trashed: false, locked: false, unlocked: false,
    invite_policy: 'inherit', collapsed: false, is_cat: false, cat_id: null,
    ts: 1, org: 'a', pos: 0, pos_ts: 1, pos_org: 'a' }, x);
  const mem = (user, on, role, pos) => Object.assign(
    { id: U(), user_id: user, universe_id: null, group_id: null, role, pos: pos || 0, created_at: 1 }, on);
  return {
    ids: { uA, uB, uC, U1, U2, U3, U4, U5, U6, G, GX, L, I },
    db: {
      _rolesBackfilled: true,
      profiles: [
        { id: uA, email: 'a@x.no', display_name: 'Alice', user_metadata: {} },
        { id: uB, email: 'b@x.no', display_name: 'Bo', user_metadata: {} },
        { id: uC, email: 'c@x.no', display_name: 'Cato', user_metadata: {} },
      ],
      passwords: { 'a@x.no': 'x', 'b@x.no': 'x', 'c@x.no': 'x' },
      universes: [
        base({ id: U1, owner_id: uA, name: 'Mitt ett', pos: 0 }),
        base({ id: U3, owner_id: uA, name: 'Mitt to', pos: 1 }),
        base({ id: U2, owner_id: uA, name: 'Delt med Bo', pos: 2 }),
        base({ id: U4, owner_id: uB, name: 'Bo sitt', pos: 3 }),
        // U5 og U6 har BEGGE eiersettet {A,C} → samme domene. B er medlem av U6.
        base({ id: U5, owner_id: uA, name: 'Med Cato I', pos: 4 }),
        base({ id: U6, owner_id: uA, name: 'Med Cato II', pos: 5 }),
      ],
      groups: [
        base({ id: G, owner_id: uA, universe_id: U1, name: 'Flyttbar' }),
        base({ id: GX, owner_id: uA, universe_id: U5, name: 'Domenetest' }),
      ],
      cards: [base({ id: L, owner_id: uA, group_id: G, title: 'Innhold', k: true, p: true, lab_ts: 0, lab_org: '' })],
      items: [base({ id: I, owner_id: uA, card_id: L, text: 'Punkt' })],
      memberships: [
        mem(uA, { universe_id: U1 }, 'owner', 0),
        mem(uA, { universe_id: U3 }, 'owner', 1),
        mem(uA, { universe_id: U2 }, 'owner', 2),
        mem(uB, { universe_id: U2 }, 'owner', 0),
        mem(uB, { universe_id: U4 }, 'owner', 1),
        mem(uA, { universe_id: U5 }, 'owner', 3),
        mem(uC, { universe_id: U5 }, 'owner', 0),
        mem(uA, { universe_id: U6 }, 'owner', 4),
        mem(uC, { universe_id: U6 }, 'owner', 1),
        mem(uB, { universe_id: U6 }, 'member', 3),
      ],
      share_invites: [], tombstones: [],
    },
  };
}

async function loadAs(page, db, uid, email, viewport) {
  await page.setViewportSize(viewport);
  await page.goto(BASE + '/?mock=1');
  await page.evaluate(({ db, uid, email }) => {
    localStorage.clear(); sessionStorage.clear();
    localStorage.setItem('hk-mock-db', JSON.stringify(db));
    // Kontoen har sett HELE introduksjonen (docs/introduksjon.md): verken
    // omvisningen eller et gest-tips skal legge seg over det som testes.
    sessionStorage.setItem('hk-mock-session', JSON.stringify({ id: uid, email, user_metadata: { onboarding: { v: 1, status: 'done' }, tips: { drag: true, trash: true, moveList: true } } }));
  }, { db, uid, email });
  await page.goto(BASE + '/?mock=1');
  // `lastMy` settes først når get_my_doc har svart — da er dokumentet hentet og
  // det seedede innholdet flettet inn og rendret.
  await page.waitForFunction(() => {
    const H = window.__huskis;
    return H && H.authUser && H.lastMy && H.state.universes.length > 0;
  }, null, { timeout: 8000, polling: 200 });
}
const openNav = async (p) => { await p.evaluate(() => window.__huskis.openNavModal()); await p.waitForTimeout(400); };

// Dra en mapperad til midten av et annet områdekorts innholdssone.
async function dragGroupTo(p, groupId, uniId) {
  // Modalen kan være høyere enn mobilskjermen, så raden man drar fra kan ligge
  // delvis under modal-headeren. Rull den fram først; auto-scrollen i modalen
  // henter målet inn mens draget pågår.
  await p.locator('#nav-board .item[data-id="' + groupId + '"]').scrollIntoViewIfNeeded();
  await p.waitForTimeout(150);
  const a = await p.locator('#nav-board .item[data-id="' + groupId + '"]').boundingBox();
  await p.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await p.mouse.down();
  await p.mouse.move(a.x + a.width / 2 + 8, a.y + a.height / 2 + 8, { steps: 3 });
  await p.waitForTimeout(90);
  for (let i = 0; i < 14; i++) {
    const t = await p.locator('#nav-board .card[data-id="' + uniId + '"] .add-item-row').boundingBox();
    await p.mouse.move(t.x + t.width / 2, t.y + 2, { steps: 5 });
    await p.waitForTimeout(80);
  }
  await p.mouse.up();
  await p.waitForTimeout(500);
}

const groupUni = (p, gid) => p.evaluate((id) => {
  const g = window.__huskis.state.universes.flatMap((u) => u.groups).find((x) => x.id === id);
  return g ? g.uni : null;
}, gid);
const groupIds = (p) => p.evaluate(() => window.__huskis.state.universes
  .flatMap((u) => (u.groups || []).map((g) => ({ id: g.id, uni: u.id, name: g.name }))));

async function run(label, viewport, mobile) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  console.log('\n== ' + label + ' ==');
  const { ids, db } = buildDB();

  await loadAs(p, db, ids.uA, 'a@x.no', viewport);

  /* ---------- 1) Samme eierskapsdomene: ren reparenting ---------- */
  await openNav(p);
  await dragGroupTo(p, ids.G, ids.U3);
  await p.waitForTimeout(400);
  const confirmVisible = await p.evaluate(() => !document.getElementById('confirm-modal').hidden);
  log(label + ' 1: samme domene spør IKKE om bekreftelse', confirmVisible === false);
  log(label + ' 1: mappen ligger nå i det andre egne området',
    await groupUni(p, ids.G) === ids.U3);
  // Vent på selve serverraden (uteblir den, feiler sjekken under med verdien).
  await p.waitForFunction(({ g, u }) =>
    (window.HK_MOCK._loadDB().groups.find((x) => x.id === g) || {}).universe_id === u,
    { g: ids.G, u: ids.U3 }, { timeout: 8000, polling: 200 }).catch(() => {});
  const serverUni = await p.evaluate((g) => (window.HK_MOCK._loadDB().groups.find((x) => x.id === g) || {}).universe_id, ids.G);
  log(label + ' 1: … og serveren har fått den samme flyttingen (samme id)',
    serverUni === ids.U3, String(serverUni));
  log(label + ' 1: innholdet beholdt id-ene sine',
    await p.evaluate((x) => {
      const db = window.HK_MOCK._loadDB();
      return !!db.cards.find((c) => c.id === x.L && c.group_id === x.G) &&
             !!db.items.find((i) => i.id === x.I);
    }, ids));

  /* ---------- 2+3) Ulikt domene: bekreftelse, og avbrudd ruller tilbake ---------- */
  await openNav(p);
  await dragGroupTo(p, ids.G, ids.U2);
  await p.waitForTimeout(300);
  const dlg = await p.evaluate(() => {
    const m = document.getElementById('confirm-modal');
    return { open: !m.hidden, msg: (document.getElementById('confirm-msg') || {}).textContent || '' };
  });
  log(label + ' 2: kryssdomene-flytting krever eksplisitt bekreftelse', dlg.open === true);
  log(label + ' 2: bekreftelsen forklarer at medlemskretsen endres',
    /mister/i.test(dlg.msg) && /tilgang/i.test(dlg.msg), dlg.msg.slice(0, 90));
  await p.locator('#confirm-cancel').click();
  await p.waitForTimeout(600);
  log(label + ' 3: avbrutt flytting ruller mappen tilbake til kildeområdet',
    await groupUni(p, ids.G) === ids.U3);

  /* ---------- 4) Bekreftet kryssdomene-flytting bytter id-ene ---------- */
  await openNav(p);
  await dragGroupTo(p, ids.G, ids.U2);
  await p.waitForTimeout(300);
  await p.locator('#confirm-ok').click();
  // Kryssdomene-flytting bytter id: ferdig når den gamle id-en er borte både
  // lokalt og på serveren (uteblir det, feiler sjekkene under med verdiene).
  await p.waitForFunction((G) => {
    const db = window.HK_MOCK._loadDB();
    return !db.groups.some((x) => x.id === G)
      && !window.__huskis.state.universes.flatMap((u) => u.groups).some((g) => g.id === G);
  }, ids.G, { timeout: 10000, polling: 200 }).catch(() => {});
  const after = await groupIds(p);
  const moved = after.find((g) => g.name === 'Flyttbar');
  log(label + ' 4: mappen står i målområdet med en NY id',
    !!moved && moved.uni === ids.U2 && moved.id !== ids.G, JSON.stringify(moved));
  log(label + ' 4: den gamle id-en finnes ikke lenger, verken lokalt eller på serveren',
    !after.some((g) => g.id === ids.G) &&
    !(await p.evaluate((g) => window.HK_MOCK._loadDB().groups.some((x) => x.id === g), ids.G)));
  log(label + ' 4: gravsteiner for de gamle id-ene',
    await p.evaluate((x) => {
      const t = window.HK_MOCK._loadDB().tombstones.map((r) => r.resource_id);
      return t.includes(x.G) && t.includes(x.L) && t.includes(x.I);
    }, ids));
  log(label + ' 4: innholdet fulgte med (ny liste + nytt listepunkt)',
    await p.evaluate((n) => {
      const st = window.__huskis.state;
      const g = st.universes.flatMap((u) => u.groups).find((x) => x.name === n);
      return !!g && g.cards.length === 1 && g.cards[0].items.length === 1;
    }, 'Flyttbar'));

  /* ---------- 5) Ugyldig mål: et område man ikke kan opprette i ---------- */
  const inU2 = (await groupIds(p)).find((g) => g.name === 'Flyttbar');
  const rejected = await p.evaluate(async ({ gid, uid }) => {
    const r = await window.__huskis.client.rpc('move_group',
      { p_group: gid, p_universe: uid, p_cat: null, p_pos: 0 });
    return r.error ? r.error.message : null;
  }, { gid: inU2.id, uid: ids.U4 });
  log(label + ' 5: serveren avviser flytting til et område man ikke er medlem av',
    !!rejected && /myndighet/i.test(rejected), String(rejected));
  log(label + ' 5: … og mappen står urørt',
    await groupUni(p, inU2.id) === ids.U2);

  /* ---------- 6) Direkte skriving av universe_id avvises ---------- */
  const rawWrite = await p.evaluate(async ({ gid, uid }) => {
    const r = await window.__huskis.client.from('groups')
      .update({ universe_id: uid, pos: 5, pos_ts: Date.now(), pos_org: 'raw', ts: Date.now(), org: 'raw' })
      .eq('id', gid);
    return r && r.error ? r.error.message : null;
  }, { gid: inU2.id, uid: ids.U1 });
  log(label + ' 6: rå skriving av groups.universe_id avvises (move_group eier flyttingen)',
    !!rawWrite && /move_group/i.test(rawWrite), String(rawWrite));

  /* ---------- 7) Et eierskifte hos ANDRE må nå fram før neste flytting ----------
     U5 og U6 har begge eiersettet {A,C}, så en flytting mellom dem spør ikke.
     Byttes så B og C om på rolle i U6 (utenfor denne fanen), endres verken
     innholdet, mine capabilities, min rolle, `shared`, medlemstallet ELLER
     eiertallet — bare selve eiersettet. Blir ikke det plukket opp, ville neste
     flytting lest to ULIKE domener som like og hoppet over den destruktive
     bekreftelsen. */
  await loadAs(p, db, ids.uA, 'a@x.no', viewport);
  const keyOf = (x) => p.evaluate((id) => {
    const u = window.__huskis.state.universes.find((z) => z.id === id) || {};
    return { key: u._ownerKey, owners: u._ownerCount, members: u._memberCount, caps: JSON.stringify(u._caps) };
  }, x);
  const u5Before = await keyOf(ids.U5), u6Before = await keyOf(ids.U6);
  log(label + ' 7: U5 og U6 er i SAMME eierskapsdomene før byttet',
    !!u5Before.key && u5Before.key === u6Before.key, JSON.stringify({ u5: u5Before.key, u6: u6Before.key }));
  await openNav(p);
  await dragGroupTo(p, ids.GX, ids.U6);
  await p.waitForTimeout(300);
  log(label + ' 7: … så flyttingen dit spør ikke',
    await p.evaluate(() => !!document.getElementById('confirm-modal').hidden) === true);
  // La flyttingen nå serveren før rollebyttet simuleres der.
  await p.waitForFunction(({ g, u }) =>
    (window.HK_MOCK._loadDB().groups.find((x) => x.id === g) || {}).universe_id === u,
    { g: ids.GX, u: ids.U6 }, { timeout: 8000, polling: 200 }).catch(() => {});

  // B og C bytter rolle i U6: eiersettet blir {A,B} i stedet for {A,C}.
  await p.evaluate(async ({ b, c, u6 }) => {
    const db = window.HK_MOCK._loadDB();
    db.memberships.find((m) => m.user_id === b && m.universe_id === u6).role = 'owner';
    db.memberships.find((m) => m.user_id === c && m.universe_id === u6).role = 'member';
    window.HK_MOCK._saveDB(db);
    return window.__huskis.cloudCycle();
  }, { b: ids.uB, c: ids.uC, u6: ids.U6 });
  // Eierskiftet er poenget: ferdig når nøkkelen faktisk har endret seg
  // (uteblir det, feiler sjekken under med før/etter-verdiene).
  await p.waitForFunction(({ id, was }) => {
    const u = window.__huskis.state.universes.find((z) => z.id === id) || {};
    return !!u._ownerKey && u._ownerKey !== was;
  }, { id: ids.U6, was: u6Before.key }, { timeout: 8000, polling: 200 }).catch(() => {});
  const u6After = await keyOf(ids.U6);
  log(label + ' 7: byttet endret INGENTING annet enn eiersettet',
    u6After.owners === u6Before.owners && u6After.members === u6Before.members &&
    u6After.caps === u6Before.caps,
    JSON.stringify({ before: u6Before, after: u6After }));
  log(label + ' 7: … og eierskiftet nådde likevel fram til klienten',
    !!u6After.key && u6After.key !== u6Before.key, JSON.stringify({ før: u6Before.key, etter: u6After.key }));

  await openNav(p);
  await dragGroupTo(p, ids.GX, ids.U5);
  await p.waitForTimeout(300);
  log(label + ' 7: flytting tilbake krever nå bekreftelse (domenene er ulike)',
    await p.evaluate(() => !document.getElementById('confirm-modal').hidden) === true);
  await p.locator('#confirm-cancel').click();
  await p.waitForTimeout(600);

  log(label + ': ingen JS-feil', errs.length === 0, errs.slice(0, 3).join(' | '));
  await browser.close();
}

(async () => {
  await run('desktop', { width: 1200, height: 900 }, false);
  await run('mobil', { width: 390, height: 780 }, true);
  const failed = results.filter((x) => !x).length;
  console.log('\n==== ' + (results.length - failed) + '/' + results.length + ' PASS ====');
  process.exit(failed ? 1 : 0);
})();
