/*
  Nettlesertest for ROLLE-MODELLEN i UI-et (mot mock-backend, ?mock=1).

  Dekker den klientvendte oppførselen SQL-testene ikke ser:
    1. De tre seksjonene i nav-modalen (overskrifter + skillelinjer + tomtilstand)
    2. Klassifisering etter NÅVÆRENDE rolle: eier → «Mine universer»,
       medlem → «Universer delt med meg», direkte gruppe → «Grupper delt med meg»
    3. Capability-styrte knapper (del/forlat/slett/opprett) på hvert nivå
    4. Medlemslisten: kategorioverskrifter, «Eier» vs. «Medeiere», deduplisering,
       forklaring når et arvet universmedlem ikke kan fjernes
    5. Rolleinvitasjon (medeier) — rollevelgeren finnes kun for den som kan det
    6. Breadcrumbs: [ressursikon][delt-ikon]Navn, og den virtuelle «Delte grupper»-roten
    7. Lister har INGEN delings-seksjon i innstillingsmodalen
    8. Tap av tilgang navigerer brukeren ut av den ugyldige visningen

  Kjøres på BÅDE desktop- og mobil-viewport, med tastatur-/skjermleserattributter.

  Kjør:
    python3 -m http.server 8000
    NODE_PATH=$(npm root -g) node tests/roles-and-sections.test.js
*/
const { chromium } = require(require('path').join(process.env.NODE_PATH || require('child_process').execSync('npm root -g').toString().trim(), 'playwright'));
const BASE = process.env.HUSKIS_URL || 'http://localhost:8000';

const results = [];
const log = (n, ok, x = '') => { results.push(ok); console.log((ok ? 'PASS' : 'FAIL') + ' — ' + n + (x ? '  [' + x + ']' : '')); };

const U = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
  const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
});

/* Fikstur (id-ene er faste per kjøring):
     A eier universet UA og gruppen GA + GB.
     B er MEDEIER av UA.
     C er vanlig MEDLEM av UA.
     D er DIREKTE gruppemedlem i GB — ingen rolle i UA.
   Alle roller ligger i memberships, slik databasen ville hatt dem. */
function buildDB() {
  const uA = 'uA', uB = 'uB', uC = 'uC', uD = 'uD';
  const UA = U(), GA = U(), GB = U(), LA = U(), IA = U();
  const base = (x) => Object.assign({ trashed: false, locked: false, unlocked: false,
    invite_policy: 'inherit', collapsed: false, is_cat: false, cat_id: null,
    ts: 1, org: 'a', pos: 0, pos_ts: 1, pos_org: 'a' }, x);
  const mem = (user, on, role, pos) => Object.assign(
    { id: U(), user_id: user, universe_id: null, group_id: null, role, pos: pos || 0, created_at: 1 }, on);
  return {
    ids: { uA, uB, uC, uD, UA, GA, GB, LA, IA },
    db: {
      _rolesBackfilled: true,  // fiksturen har allerede riktige roller
      profiles: [
        { id: uA, email: 'a@x.no', display_name: 'Alice Eier', user_metadata: {} },
        { id: uB, email: 'b@x.no', display_name: 'Bo Medeier', user_metadata: {} },
        { id: uC, email: 'c@x.no', display_name: 'Cato Medlem', user_metadata: {} },
        { id: uD, email: 'd@x.no', display_name: 'Dina Gruppe', user_metadata: {} },
      ],
      passwords: { 'a@x.no': 'x', 'b@x.no': 'x', 'c@x.no': 'x', 'd@x.no': 'x' },
      universes: [base({ id: UA, owner_id: uA, name: 'Felles univers' })],
      groups: [
        base({ id: GA, owner_id: uA, universe_id: UA, name: 'Gruppe A' }),
        base({ id: GB, owner_id: uA, universe_id: UA, name: 'Gruppe B', pos: 1 }),
      ],
      cards: [base({ id: LA, owner_id: uA, group_id: GA, title: 'Liste A', k: true, p: true, lab_ts: 0, lab_org: '' })],
      items: [base({ id: IA, owner_id: uA, card_id: LA, text: 'Punkt' })],
      memberships: [
        mem(uA, { universe_id: UA }, 'owner', 0),
        mem(uB, { universe_id: UA }, 'owner', 0),
        mem(uC, { universe_id: UA }, 'member', 0),
        mem(uD, { group_id: GB }, 'member', 0),
        // B har i tillegg en GAMMEL eksplisitt gruppeeierrolle i GA — slik
        // rolle-backfill-en satte den for gruppens oppretter, før B ble medeier
        // av universet. Raden er overflødig ved siden av universrollen (se 11).
        mem(uB, { group_id: GA }, 'owner', 0),
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
    sessionStorage.setItem('hk-mock-session', JSON.stringify({ id: uid, email, user_metadata: {} }));
  }, { db, uid, email });
  await page.goto(BASE + '/?mock=1');
  await page.waitForFunction(() => window.__huskis && window.__huskis.authUser, { timeout: 8000 });
  await page.waitForTimeout(900);
}
const openNav = async (p) => { await p.evaluate(() => window.__huskis.openNavModal()); await p.waitForTimeout(400); };

// Seksjonsoverskrifter + hvilke universkort som ligger under hver av dem.
const sections = (p) => p.evaluate(() => {
  const col = document.querySelector('#nav-board .board-col');
  const out = [];
  let cur = null;
  [...col.children].forEach((el) => {
    if (el.classList.contains('nav-section-head')) { cur = { title: el.textContent.trim(), cards: [], empty: false }; out.push(cur); return; }
    if (!cur) return;
    if (el.classList.contains('nav-section-empty')) cur.empty = true;
    if (el.classList.contains('card')) cur.cards.push(el.querySelector('.card-title').textContent.trim());
  });
  return out;
});

async function run(label, viewport, mobile) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  console.log('\n== ' + label + ' ==');
  const { ids, db } = buildDB();

  /* ---------- 1) Eieren: universet i «Mine universer» ---------- */
  await loadAs(p, db, ids.uA, 'a@x.no', viewport);
  await openNav(p);
  let s = await sections(p);
  log(label + ' 1: tre overskrifter i riktig rekkefølge',
    s.length === 2 && /Mine universer/.test(s[0].title) && /Universer delt med meg/.test(s[1].title),
    JSON.stringify(s.map((x) => x.title)));
  log(label + ' 1: eierens univers ligger i «Mine universer»',
    s[0].cards.includes('Felles univers') && s[1].cards.length === 0 && s[1].empty === true);
  log(label + ' 1: «Nytt univers» finnes KUN i «Mine universer»',
    await p.locator('.nav-add-uni').count() === 1);
  log(label + ' 1: seksjonene har skillelinje mellom seg',
    await p.evaluate(() => {
      const h = document.querySelectorAll('.nav-section-head')[1];
      return getComputedStyle(h).borderTopWidth !== '0px';
    }));
  log(label + ' 1: eieren kan slette, men ikke forlate (siste … nei — to eiere)',
    await p.locator('#nav-board .uni-delete:visible').count() === 1 &&
    await p.locator('#nav-board .uni-leave:visible').count() === 1);
  log(label + ' 1: eieren kan opprette grupper',
    await p.locator('#nav-board .add-item-row:visible').count() === 1);

  /* ---------- 2) Medlemslisten: «Medeiere», kategorier, deduplisering ---------- */
  await p.locator('#nav-board .uni-share').first().click();
  await p.waitForTimeout(700);
  const uniTitles = await p.locator('#share-body .share-section-title').allTextContents();
  log(label + ' 2: to eiere gir overskriften «Medeiere»',
    uniTitles.includes('Medeiere') && uniTitles.includes('Medlemmer'), JSON.stringify(uniTitles));
  log(label + ' 2: medlemslisten viser alle tre med universrolle, ingen dobbelt',
    await p.locator('#share-body .member-row').count() === 3);
  log(label + ' 2: rollevelgeren finnes (eier kan invitere medeiere)',
    await p.locator('#share-body .share-role-select:visible').count() === 1);
  log(label + ' 2: både «Forlat» og «Slett for alle» er tilgjengelig for en medeier',
    await p.locator('#share-body .share-leave').count() === 1 &&
    await p.locator('#share-body .share-delete').count() === 1);
  log(label + ' 2: «Forlat»-knappen har eget tilgjengelig navn (ikke «Logg ut»)',
    /Forlat universet/i.test(await p.locator('#share-body .share-leave').getAttribute('aria-label') || ''));
  await p.locator('#share-close').click(); await p.waitForTimeout(250);

  /* ---------- 3) Gruppens medlemsliste: arvede + direkte ---------- */
  await openNav(p);
  await p.locator('#nav-board .item.group-row .group-share').nth(1).click();
  await p.waitForTimeout(700);
  const grpTitles = await p.locator('#share-body .share-section-title').allTextContents();
  log(label + ' 3: gruppens kategorier har universprefiks og utelater tomme',
    grpTitles.includes('Medeiere av universet') && grpTitles.includes('Medlemmer av universet') &&
    grpTitles.includes('Medlemmer av gruppen') && !grpTitles.includes('Eier av gruppen'),
    JSON.stringify(grpTitles));
  log(label + ' 3: fire personer, ingen vist to ganger',
    await p.locator('#share-body .member-row').count() === 4);
  const hints = await p.locator('#share-body .member-hint').allTextContents();
  log(label + ' 3: arvet universmedlem kan ikke fjernes her, med forklaring',
    hints.some((h) => /via universet/i.test(h)), JSON.stringify(hints));
  log(label + ' 3: det DIREKTE gruppemedlemmet kan fjernes',
    await p.evaluate(() => [...document.querySelectorAll('#share-body .member-row')]
      .filter((r) => /Dina/.test(r.textContent)).some((r) => /Fjern/.test(r.textContent))));
  await p.locator('#share-close').click(); await p.waitForTimeout(250);

  /* ---------- 4) Vanlig medlem: universet i «delt med meg» ---------- */
  await loadAs(p, db, ids.uC, 'c@x.no', viewport);
  await openNav(p);
  s = await sections(p);
  log(label + ' 4: medlemmets univers ligger i «Universer delt med meg»',
    s[0].cards.length === 0 && s[1].cards.includes('Felles univers'), JSON.stringify(s));
  log(label + ' 4: ingen sletteknapp for et vanlig medlem, men forlat finnes',
    await p.locator('#nav-board .uni-delete:visible').count() === 0 &&
    await p.locator('#nav-board .uni-leave:visible').count() === 1);
  log(label + ' 4: et vanlig medlem kan fortsatt opprette grupper i et åpent univers',
    await p.locator('#nav-board .add-item-row:visible').count() === 1);
  await p.locator('#nav-board .uni-share').first().click();
  await p.waitForTimeout(700);
  log(label + ' 4: medlemmet ser medlemslisten …',
    await p.locator('#share-body .member-row').count() === 3);
  log(label + ' 4: … men får ingen rollevelger (kan ikke invitere eiere)',
    await p.locator('#share-body .share-role-select:visible').count() === 0);
  log(label + ' 4: … og ingen «Slett for alle»',
    await p.locator('#share-body .share-delete').count() === 0);
  await p.locator('#share-close').click(); await p.waitForTimeout(250);

  /* ---------- 5) Direkte gruppemedlem: fri seksjon ---------- */
  await loadAs(p, db, ids.uD, 'd@x.no', viewport);
  await openNav(p);
  s = await sections(p);
  log(label + ' 5: tre seksjoner, og gruppen ligger i «Grupper delt med meg»',
    s.length === 3 && /Grupper delt med meg/.test(s[2].title), JSON.stringify(s.map((x) => x.title)));
  log(label + ' 5: den frie beholderen har ingen del-/slett-/opprett-knapper',
    await p.evaluate(() => {
      const c = document.querySelector('#nav-board .free-groups-card');
      if (!c) return false;
      return c.querySelector('.uni-share').hidden && c.querySelector('.uni-delete').hidden &&
             c.querySelector('.add-item-row').hidden;
    }));
  log(label + ' 5: gruppen vises med forlat-knapp, uten slett',
    await p.locator('#nav-board .group-leave:visible').count() === 1 &&
    await p.locator('#nav-board .group-delete:visible').count() === 0);
  log(label + ' 5: universets navn lekkes ikke til den frie mottakeren',
    !(await p.locator('#nav-board').textContent()).includes('Felles univers'));

  /* ---------- 6) Breadcrumb for en fri gruppe ---------- */
  await p.locator('#nav-board .item.group-row').first().click();
  await p.waitForTimeout(500);
  const crumb = await p.evaluate(() => ({
    uni: document.getElementById('crumb-uni-name').textContent,
    uniIcon: document.getElementById('crumb-uni-icon').innerHTML.length,
    uniShared: !document.getElementById('crumb-uni-shared').hidden,
    grp: document.getElementById('crumb-group-name').textContent,
    grpIcon: document.getElementById('crumb-group-icon').innerHTML.length,
    grpShared: !document.getElementById('crumb-group-shared').hidden,
  }));
  log(label + ' 6: fri gruppe får den virtuelle roten «Delte grupper» UTEN universikon',
    crumb.uni === 'Delte grupper' && crumb.uniIcon === 0 && crumb.uniShared === true,
    JSON.stringify(crumb));
  log(label + ' 6: gruppeleddet har gruppeikon + delt-ikon (ikke gruppeikon to ganger)',
    crumb.grp === 'Gruppe B' && crumb.grpIcon > 0 && crumb.grpShared === true);

  /* ---------- 7) Lister har ingen deling ---------- */
  await loadAs(p, db, ids.uA, 'a@x.no', viewport);
  await p.waitForTimeout(400);
  await p.evaluate((id) => window.__huskis.openSettings('card', id, id), ids.LA);
  await p.waitForTimeout(500);
  const settingsSections = await p.locator('#settings-body .settings-section-label').allTextContents();
  log(label + ' 7: innstillingsmodalen for en liste har INGEN «Deling»-seksjon',
    !settingsSections.some((t) => /Deling/i.test(t)), JSON.stringify(settingsSections));
  log(label + ' 7: … og ingen inviter-felt',
    await p.locator('#settings-body .share-invite-form').count() === 0);
  await p.keyboard.press('Escape'); await p.waitForTimeout(250);
  const listShare = await p.evaluate(async (id) => {
    const r = await window.__huskis.client.rpc('create_share_invite',
      { p_type: 'card', p_id: id, p_email: 'ny@x.no' });
    return r.error ? r.error.message : null;
  }, ids.LA);
  log(label + ' 7: serveren avviser en liste-invitasjon også via rå RPC',
    !!listShare && /kun universer og grupper/i.test(listShare), String(listShare));

  /* ---------- 8) Tap av tilgang navigerer ut ---------- */
  await loadAs(p, db, ids.uD, 'd@x.no', viewport);
  await p.waitForTimeout(400);
  const before = await p.evaluate(() => window.__huskis.state.activeGroup);
  await p.evaluate(({ gid, uid }) => {
    // Eieren kaster ut D (simulert direkte i mock-databasen, som en annen fane).
    const db = window.HK_MOCK._loadDB();
    db.memberships = db.memberships.filter((m) => !(m.user_id === uid && m.group_id === gid));
    window.HK_MOCK._saveDB(db);
    return window.__huskis.cloudCycle();
  }, { gid: ids.GB, uid: ids.uD });
  await p.waitForTimeout(1200);
  const after = await p.evaluate(() => ({
    active: window.__huskis.state.activeGroup,
    toast: (document.querySelector('.toast') || {}).textContent || '',
    groups: window.__huskis.state.universes.flatMap((u) => u.groups).map((g) => g.id),
  }));
  log(label + ' 8: gruppen forsvinner når tilgangen fjernes',
    !after.groups.includes(ids.GB) && before === ids.GB, JSON.stringify(after.groups));
  log(label + ' 8: brukeren navigeres ut og får beskjed',
    after.active !== ids.GB && /ikke lenger delt|slettet|flyttet/i.test(after.toast), after.toast);

  /* ---------- 9) Rolleendring på et EKSISTERENDE medlem ---------- */
  await loadAs(p, db, ids.uA, 'a@x.no', viewport);
  const openUniShare = async () => {
    await p.evaluate(() => {
      const H = window.__huskis, u = H.state.universes.find((x) => !x._virtual);
      H.openShare('universe', u.id, u, null);
    });
    await p.waitForTimeout(900);
  };
  // Radene, med knappetekstene sine.
  const memberRows = () => p.evaluate(() => [...document.querySelectorAll('#share-body .member-row')].map((r) => ({
    name: (r.querySelector('.member-name') || {}).textContent || '',
    role: (r.querySelector('.member-role') || {}).textContent || '',
    btns: [...r.querySelectorAll('button')].map((b) => b.textContent.trim()),
  })));
  await openUniShare();
  let rows = await memberRows();
  const rowFor = (list, frag) => list.find((r) => r.name.indexOf(frag) === 0) || { btns: [], role: '' };
  log(label + ' 9: et vanlig medlem kan løftes til medeier',
    rowFor(rows, 'Cato').btns.includes('Gjør til medeier'), JSON.stringify(rowFor(rows, 'Cato')));
  log(label + ' 9: en som alt er medeier tilbys degradering, ikke løft',
    rowFor(rows, 'Bo').btns.includes('Gjør til medlem') &&
    !rowFor(rows, 'Bo').btns.includes('Gjør til medeier'), JSON.stringify(rowFor(rows, 'Bo')));
  // Egen rad: å tre av som medeier er en ekte handling («Forlat» beholder ikke
  // tilgangen), men «Fjern» på seg selv er bare «Forlat» med feil merkelapp.
  log(label + ' 9: man kan tre av som medeier på egen rad',
    rowFor(rows, 'Alice').btns.includes('Tre av som medeier'), JSON.stringify(rowFor(rows, 'Alice')));
  log(label + ' 9: men ikke «Fjern» seg selv',
    !rowFor(rows, 'Alice').btns.includes('Fjern'), JSON.stringify(rowFor(rows, 'Alice')));

  // Løftet sendes som en INVITASJON — rollen endres ikke før den er godtatt.
  await p.evaluate(() => {
    const r = [...document.querySelectorAll('#share-body .member-row')]
      .find((x) => /^Cato/.test((x.querySelector('.member-name') || {}).textContent || ''));
    [...r.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Gjør til medeier').click();
  });
  await p.waitForTimeout(300);
  await p.locator('#confirm-ok').click();
  await p.waitForTimeout(1400);
  const afterInvite = await p.evaluate(() => ({
    pending: [...document.querySelectorAll('#share-body .member-pending')].map((r) => r.textContent.replace(/\s+/g, ' ').trim()),
    invites: window.HK_MOCK._loadDB().share_invites.map((s) => s.invitee_email + ':' + s.role + ':' + s.status),
    roles: window.HK_MOCK._loadDB().memberships.filter((m) => m.user_id === 'uC').map((m) => m.role),
  }));
  log(label + ' 9: løftet sendes som en eierinvitasjon',
    afterInvite.invites.some((x) => x === 'c@x.no:owner:pending'), JSON.stringify(afterInvite.invites));
  log(label + ' 9: rollen er UENDRET til invitasjonen er godtatt',
    afterInvite.roles.join() === 'member', JSON.stringify(afterInvite.roles));
  log(label + ' 9: invitasjonen vises som ventende medeier-invitasjon',
    afterInvite.pending.some((t) => /Invitert som medeier/.test(t)), JSON.stringify(afterInvite.pending));
  rows = await memberRows();
  log(label + ' 9: løft-knappen forsvinner mens invitasjonen ligger og venter',
    !rowFor(rows, 'Cato').btns.includes('Gjør til medeier'), JSON.stringify(rowFor(rows, 'Cato')));

  // C godtar → blir medeier, og eieren kan nå degradere igjen. `loadAs` sår
  // fiksturen på nytt, så vi må ta med «serveren» slik den ser ut NÅ (med
  // invitasjonen i) inn i neste innlogging.
  const dbWithInvite = await p.evaluate(() => window.HK_MOCK._loadDB());
  await loadAs(p, dbWithInvite, ids.uC, 'c@x.no', viewport);
  await p.waitForFunction(
    () => ((window.__huskis.lastMy || {}).invites_in || []).length > 0, { timeout: 8000 });
  await p.evaluate(async () => {
    const H = window.__huskis;
    const inv = H.lastMy.invites_in[0];
    await H.client.rpc('accept_share_invite', { p_invite: inv.id });
    await H.cloudCycle();
  });
  await p.waitForTimeout(1200);
  log(label + ' 9: etter aksept er medlemmet medeier med eier-rettigheter',
    await p.evaluate(() => {
      const u = window.__huskis.state.universes.find((x) => !x._virtual);
      return !!u && u._role === 'owner' && !!(u._caps && u._caps.manageMembers && u._caps.delete);
    }));
  const dbAfterAccept = await p.evaluate(() => window.HK_MOCK._loadDB());
  await loadAs(p, dbAfterAccept, ids.uA, 'a@x.no', viewport);
  await openUniShare();
  rows = await memberRows();
  log(label + ' 9: den nye medeieren kan degraderes igjen',
    rowFor(rows, 'Cato').role === 'Eier' && rowFor(rows, 'Cato').btns.includes('Gjør til medlem'),
    JSON.stringify(rowFor(rows, 'Cato')));

  /* ---------- 10) Uten capabilities fra serveren feiles det LUKKET ----------
     En database der migreringen ikke har kjørt ennå svarer uten `caps`. Da skal
     et vanlig medlem ikke se eier-kontroller det uansett ville blitt avvist på. */
  await loadAs(p, db, ids.uC, 'c@x.no', viewport);
  const capless = await p.evaluate(() => {
    const H = window.__huskis, u = H.state.universes.find((x) => !x._virtual);
    delete u._caps;                    // som et svar fra en før-migrering-server
    H.openShare('universe', u.id, u, null);
    const vis = [...document.querySelectorAll('#share-body button')]
      .filter((b) => !b.hidden).map((b) => b.textContent.trim());
    return vis;
  });
  log(label + ' 10: ingen lås-knapp uten capabilities',
    !capless.some((t) => /Lås nå|Åpne nå/.test(t)), JSON.stringify(capless));
  log(label + ' 10: ingen slett-for-alle uten capabilities',
    !capless.some((t) => /Slett .* for alle/.test(t)), JSON.stringify(capless));
  log(label + ' 10: forlat-knappen er derimot tilgjengelig',
    capless.some((t) => /Forlat/.test(t)), JSON.stringify(capless));
  await p.keyboard.press('Escape'); await p.waitForTimeout(200);

  /* ---------- 11) Medeier med en overflødig eksplisitt gruppeeierrolle ----------
     Rolle-backfill-en gjorde gruppens oppretter til eksplisitt gruppeeier. Blir
     vedkommende SENERE medeier av universet, er raden overflødig — og en
     forlat-knapp på gruppen ville løyet: den sletter raden uten å fjerne noen
     tilgang, så gruppen kommer rett tilbake ved neste synk. */
  await loadAs(p, db, ids.uB, 'b@x.no', viewport);
  await openNav(p);
  log(label + ' 11: medeieren har fortsatt den eksplisitte gruppeeierrollen',
    await p.evaluate((g) => (window.__huskis.state.universes.flatMap((u) => u.groups)
      .find((x) => x.id === g) || {})._role === 'owner', ids.GA));
  log(label + ' 11: medeieren kan forlate UNIVERSET …',
    await p.locator('#nav-board .uni-leave:visible').count() === 1);
  log(label + ' 11: … men ingen av gruppene i det',
    await p.locator('#nav-board .group-leave:visible').count() === 0);
  await p.locator('#nav-board .item.group-row .group-share').first().click();
  await p.waitForTimeout(700);
  log(label + ' 11: gruppens delemodal har heller ingen «Forlat gruppen»',
    await p.locator('#share-body .share-leave').count() === 0);
  // Serveren er autoritativ og avviser også et rått kall — med en forklaring
  // som peker på universet, der tilgangen faktisk ligger.
  const leaveErr = await p.evaluate(async (id) => {
    const r = await window.__huskis.client.rpc('leave_share', { p_type: 'group', p_id: id });
    return r.error ? r.error.message : null;
  }, ids.GA);
  log(label + ' 11: rå RPC avvises og peker på universet',
    !!leaveErr && /via universet/i.test(leaveErr), String(leaveErr));
  await p.keyboard.press('Escape'); await p.waitForTimeout(200);

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
