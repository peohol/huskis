/*
  Regresjonstest: DEL-MODALEN OPPDATERES FORTLØPENDE.

  Del-modalen hentet medlemslisten ÉN gang — ved åpning, og etter brukerens
  EGNE handlinger. Godtok mottakeren invitasjonen mens modalen sto åpen, ble
  den stående med kvitteringen «Invitasjon sendt» og en ventende rad helt til
  brukeren lukket og åpnet modalen på nytt. Nå friskes den åpne modalen opp fra
  hver synk-runde (`refreshOpenShare`), så den viser serverens nåtilstand.

  To faner deler mock-«serveren» (localStorage), men har hver sin sesjon
  (sessionStorage) — altså to brukere mot samme database, slik de andre
  flerbrukertestene gjør det.

  Testen dekker:

    1. Invitasjon sendt fra UI-et: ventende rad + kvitteringen «Invitasjon sendt»
    2. Mottakeren godtar i den ANDRE fanen → avsenderens ÅPNE modal viser det
       nye medlemmet uten at modalen lukkes og åpnes
    3. Den ventende raden forsvinner, og den nå utdaterte kvitteringen med den
    4. En synk-runde UTEN endring tegner IKKE listen om: radene skal ikke rives
       ut av DOM-en under et klikk hvert femte sekund
    5. Lukket modal kobles fra: synk-runder etterpå spør ikke om medlemslisten
    6. En optimistisk fjernet rad kommer TILBAKE når serveren avviser — selv om
       serversvaret da er identisk med det radene alt står med

  Oppførselen henger ikke på layout eller pekertype (synk + tilstandsendring),
  så ett viewport holder — se tests/CLAUDE.md.

  Kjør (fra repo-roten, med `python3 -m http.server 8000` i egen terminal):
    NODE_PATH=$(npm root -g) node tests/share-modal-live.test.js
*/
const { chromium } = require(require('path').join(process.env.NODE_PATH || require('child_process').execSync('npm root -g').toString().trim(), 'playwright'));
const BASE = process.env.HUSKIS_URL || 'http://localhost:8000';

const results = [];
const log = (n, ok, x = '') => { results.push(ok); console.log((ok ? 'PASS' : 'FAIL') + ' — ' + n + (x ? '  [' + x + ']' : '')); };

const U = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
  const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
});

/* Fikstur: A eier området UA (og er eneste medlem). B har en konto, men ingen
   rolle noe sted — det er B som skal inviteres underveis i testen. */
function buildDB() {
  const UA = U();
  const base = (x) => Object.assign({ trashed: false, locked: false, unlocked: false,
    invite_policy: 'inherit', collapsed: false, is_cat: false, cat_id: null,
    ts: 1, org: 'a', pos: 0, pos_ts: 1, pos_org: 'a' }, x);
  return {
    ids: { uA: 'uA', uB: 'uB', UA },
    db: {
      _rolesBackfilled: true,
      profiles: [
        { id: 'uA', email: 'a@x.no', display_name: 'Alice Eier', user_metadata: {} },
        { id: 'uB', email: 'b@x.no', display_name: 'Bo Mottaker', user_metadata: {} },
      ],
      passwords: { 'a@x.no': 'x', 'b@x.no': 'x' },
      universes: [base({ id: UA, owner_id: 'uA', name: 'Felles område' })],
      groups: [base({ id: U(), owner_id: 'uA', universe_id: UA, name: 'Mappe A' })],
      cards: [], items: [],
      memberships: [{ id: U(), user_id: 'uA', universe_id: UA, group_id: null, role: 'owner', pos: 0, created_at: 1 }],
      share_invites: [], tombstones: [],
    },
  };
}

// Seed «serveren» + sesjonen for denne fanen, og last appen. `withContent`
// skiller eieren (som HAR et område) fra mottakeren (som ennå ikke har noe).
async function loadAs(page, db, uid, email, withContent) {
  await page.goto(BASE + '/?mock=1');
  await page.evaluate(({ db, uid, email }) => {
    localStorage.clear(); sessionStorage.clear();
    localStorage.setItem('hk-mock-db', JSON.stringify(db));
    // Kontoen har sett HELE introduksjonen (docs/introduksjon.md): verken
    // demoen eller et gest-tips skal legge seg over det som testes.
    sessionStorage.setItem('hk-mock-session', JSON.stringify({ id: uid, email,
      user_metadata: { onboarding: { v: 3, status: 'done' }, tips: { drag: true, trash: true, moveList: true, dragTrash: true } } }));
  }, { db, uid, email });
  await page.goto(BASE + '/?mock=1');
  await page.waitForFunction((wantContent) => {
    const H = window.__huskis;
    return !!(H && H.authUser && H.lastMy && (!wantContent || H.state.universes.length > 0));
  }, withContent, { timeout: 8000, polling: 200 });
}

// Hva del-modalen viser NÅ.
const shareView = (p) => p.evaluate(() => {
  const body = document.getElementById('share-body');
  const msg = body.querySelector('.share-msg');
  return {
    open: !document.getElementById('share-modal').hidden,
    members: [...body.querySelectorAll('.member-row:not(.member-pending)')]
      .map((r) => (r.querySelector('.member-name') || {}).textContent || ''),
    pending: [...body.querySelectorAll('.member-pending')]
      .map((r) => (r.querySelector('.member-name') || {}).textContent || ''),
    msg: msg && !msg.hidden ? msg.textContent : '',
    marked: body.querySelectorAll('.member-row[data-live-mark]').length,
  };
});

async function run() {
  const browser = await chromium.launch();
  // ÉN kontekst = én delt «server» (mock-databasen i localStorage); sesjonen
  // ligger i sessionStorage, som er per fane → to faner = to brukere.
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  const errs = [];
  const { ids, db } = buildDB();

  const owner = await ctx.newPage();
  owner.on('pageerror', (e) => errs.push('eier: ' + e.message));
  await loadAs(owner, db, ids.uA, 'a@x.no', true);

  // Tell `get_members`-kallene: de er selve mekanismen som holder modalen
  // levende, og fraværet av dem etter lukking er påstanden i punkt 5.
  // `__failRpc` lar testen få serveren til å si nei (punkt 6).
  await owner.evaluate(() => {
    const c = window.__huskis.client;
    const orig = c.rpc.bind(c);
    window.__memberCalls = 0;
    window.__failRpc = null;
    c.rpc = function (name, params) {
      if (name === 'get_members') window.__memberCalls++;
      if (name === window.__failRpc) {
        window.__failed = (window.__failed || 0) + 1;
        return Promise.resolve({ data: null, error: { message: 'nei' } });
      }
      return orig(name, params);
    };
  });

  /* ---------- 1) Inviter B fra UI-et ---------- */
  await owner.evaluate(() => {
    const H = window.__huskis, u = H.state.universes.find((x) => !x._virtual);
    H.openShare('universe', u.id, u, null);
  });
  await owner.locator('#share-body .share-invite-form input[type=email]').fill('b@x.no');
  await owner.locator('#share-body .share-invite-form button[type=submit]').click();
  // Ferdig når invitasjonen faktisk ligger på «serveren».
  await owner.waitForFunction(() => window.HK_MOCK._loadDB().share_invites
    .some((s) => s.invitee_email === 'b@x.no' && s.status === 'pending'),
  null, { timeout: 8000, polling: 200 });
  await owner.waitForFunction(() => !!document.querySelector('#share-body .member-pending'),
    null, { timeout: 8000, polling: 200 });
  let view = await shareView(owner);
  log('1: invitasjonen vises som ventende rad',
    view.pending.some((t) => /b@x\.no/.test(t)), JSON.stringify(view.pending));
  log('1: kvitteringen «Invitasjon sendt» vises',
    /Invitasjon sendt til b@x\.no/.test(view.msg), view.msg);
  log('1: mottakeren er ennå ikke medlem',
    !view.members.some((t) => /Bo/.test(t)), JSON.stringify(view.members));

  /* ---------- 4) Uendret runde skal ikke tegne listen om ---------- */
  // Merk de nåværende radene: overlever merket flere synk-runder, ble de ikke
  // revet ut og bygget på nytt. (Merket settes FØR aksepten, så punkt 2 under
  // også beviser at en ekte endring FAKTISK tegner om.)
  await owner.evaluate(() => {
    document.querySelectorAll('#share-body .member-row')
      .forEach((r, i) => { r.dataset.liveMark = String(i); });
  });
  const markedBefore = (await shareView(owner)).marked;
  const callsBefore = await owner.evaluate(() => window.__memberCalls);
  for (let i = 0; i < 3; i++) await owner.evaluate(() => window.__huskis.cloudCycle());
  await owner.waitForFunction((n) => window.__memberCalls > n, callsBefore,
    { timeout: 8000, polling: 200 }).catch(() => {});
  view = await shareView(owner);
  log('4: modalen spør serveren på nytt i hver runde',
    await owner.evaluate(() => window.__memberCalls) > callsBefore,
    'før: ' + callsBefore + ', etter: ' + await owner.evaluate(() => window.__memberCalls));
  log('4: … men uendret svar tegner ikke radene om',
    view.marked === markedBefore && markedBefore > 0,
    'merket før: ' + markedBefore + ', etter: ' + view.marked);

  /* ---------- 2+3) B godtar i den andre fanen ---------- */
  const dbNow = await owner.evaluate(() => window.HK_MOCK._loadDB());
  const recip = await ctx.newPage();
  recip.on('pageerror', (e) => errs.push('mottaker: ' + e.message));
  await loadAs(recip, dbNow, ids.uB, 'b@x.no', false);
  await recip.waitForFunction(() => ((window.__huskis.lastMy || {}).invites_in || []).length > 0,
    null, { timeout: 8000, polling: 200 });
  const accepted = await recip.evaluate(async () => {
    const H = window.__huskis;
    const r = await H.client.rpc('accept_share_invite', { p_invite: H.lastMy.invites_in[0].id });
    return r.error ? r.error.message : 'ok';
  });
  log('2: mottakeren fikk godtatt invitasjonen', accepted === 'ok', String(accepted));

  // Avsenderens modal står fortsatt åpen — ingen lukking, ingen ny openShare.
  await owner.waitForFunction(() =>
    [...document.querySelectorAll('#share-body .member-row:not(.member-pending) .member-name')]
      .some((el) => /Bo/.test(el.textContent || '')),
  null, { timeout: 15000, polling: 200 }).catch(() => {});
  view = await shareView(owner);
  log('2: den åpne modalen viser det nye medlemmet — uten å lukkes og åpnes',
    view.open && view.members.some((t) => /Bo/.test(t)), JSON.stringify(view));
  log('3: den ventende raden forsvinner når invitasjonen er godtatt',
    view.pending.length === 0, JSON.stringify(view.pending));
  log('3: den utdaterte kvitteringen «Invitasjon sendt» forsvinner med den',
    view.msg === '', view.msg);
  log('3: en ekte endring tegner radene om (merket er borte)',
    view.marked === 0, 'merkede rader: ' + view.marked);

  /* ---------- 6) Avvist handling rulles tilbake ---------- */
  // Raden fjernes optimistisk. Sier serveren nei, er svaret på den påfølgende
  // `get_members` IDENTISK med det radene alt står med — gjentegningen som
  // skal sette raden tilbake må derfor ikke bli hoppet over.
  await owner.evaluate(() => { window.__failRpc = 'revoke_share'; window.__failed = 0; });
  await owner.evaluate(() => {
    const r = [...document.querySelectorAll('#share-body .member-row')]
      .find((x) => /^Bo/.test((x.querySelector('.member-name') || {}).textContent || ''));
    [...r.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Fjern').click();
  });
  await owner.locator('#confirm-ok').click();
  await owner.waitForFunction(() => window.__failed > 0, null, { timeout: 8000, polling: 100 }).catch(() => {});
  log('6: serveren avviste fjerningen', await owner.evaluate(() => window.__failed) > 0);
  // Fraværsbevis snudd på hodet: raden må komme tilbake, og den kommer i samme
  // gjentegning som `onError` utløser — den korte ventingen dekker rundturen.
  await owner.waitForFunction(() =>
    [...document.querySelectorAll('#share-body .member-row .member-name')]
      .some((el) => /^Bo/.test(el.textContent || '')),
  null, { timeout: 6000, polling: 200 }).catch(() => {});
  view = await shareView(owner);
  log('6: den optimistisk fjernede raden kommer tilbake',
    view.members.some((t) => /Bo/.test(t)), JSON.stringify(view.members));
  await owner.evaluate(() => { window.__failRpc = null; });

  /* ---------- 5) Lukket modal spør ikke lenger ---------- */
  await owner.keyboard.press('Escape');
  await owner.waitForFunction(() => document.getElementById('share-modal').hidden,
    null, { timeout: 4000, polling: 200 });
  const callsAtClose = await owner.evaluate(() => window.__memberCalls);
  for (let i = 0; i < 3; i++) await owner.evaluate(() => window.__huskis.cloudCycle());
  // Fraværsbevis: rundene må ha rukket å gå før fraværet kan påstås.
  await owner.waitForTimeout(1200);
  const callsAfterClose = await owner.evaluate(() => window.__memberCalls);
  log('5: lukket modal friskes ikke opp',
    callsAfterClose === callsAtClose, 'ved lukking: ' + callsAtClose + ', etterpå: ' + callsAfterClose);

  log('ingen JS-feil', errs.length === 0, errs.slice(0, 3).join(' | '));
  await browser.close();
}

(async () => {
  await run();
  const failed = results.filter((x) => !x).length;
  console.log('\n==== ' + (results.length - failed) + '/' + results.length + ' PASS ====');
  process.exit(failed ? 1 : 0);
})();
