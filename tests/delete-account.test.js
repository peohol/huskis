/*
  Nettlesertest for SLETT KONTO (mot mock-backend, ?mock=1).

  Dekker:
    1. Konto-modalens bunnrad: «Logg ut» (gul) til venstre, «Slett konto» (rød)
       til høyre — på samme linje.
    2. Advarselen: modalen forklarer konsekvensene og har ingen OK-knapp.
       Avbryt/Escape lukker uten å slette.
    3. Sveipet: et for kort sveip spretter tilbake og sletter INGENTING; et
       fullt sveip til høyre bekrefter. Tastatur (piltastene) når det samme.
    4. Utfallet i «databasen»: området brukeren var eneste eier av er borte
       med hele undertreet (og gravsteiner), fellesområdet står igjen med den
       andre eieren som ny OPPRETTER av det brukeren hadde laget der, ansvaret
       er nullet, roller/invitasjoner/profil er borte.
    5. Klienten: lokal cache + migreringsflagg fjernet, og siden står på
       innloggingssiden.

  Kjør:
    python3 -m http.server 8000
    NODE_PATH=$(npm root -g) node tests/delete-account.test.js
*/
const { chromium } = require(require('path').join(process.env.NODE_PATH || require('child_process').execSync('npm root -g').toString().trim(), 'playwright'));
const BASE = process.env.HUSKIS_URL || 'http://localhost:8000';

const results = [];
const log = (n, ok, x = '') => { results.push(ok); console.log((ok ? 'PASS' : 'FAIL') + ' — ' + n + (x ? '  [' + x + ']' : '')); };

const U = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
  const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
});

/* Fikstur:
     D (den som sletter) eier «Mitt område» (mappe + liste + listepunkt) og
       har delt det med B som vanlig medlem.
     A eier «Fellesområdet»; D er MEDEIER der og har laget en egen mappe med
       liste og listepunkt inni — og er ansvarlig for begge.
   Etter slettingen skal det første treet være borte for alle, og det andre stå
   igjen med A som oppretter. */
function buildDB() {
  const uD = 'uD', uA = 'uA', uB = 'uB';
  const MINE = U(), DG = U(), DC = U(), DI = U();
  const FELLES = U(), FG = U(), FC = U(), FI = U();
  const base = (x) => Object.assign({ trashed: false, locked: false, unlocked: false,
    invite_policy: 'inherit', collapsed: false, is_cat: false, cat_id: null,
    responsible: null, ts: 1, org: 'a', pos: 0, pos_ts: 1, pos_org: 'a' }, x);
  const mem = (user, on, role, pos) => Object.assign(
    { id: U(), user_id: user, universe_id: null, group_id: null, role, pos: pos || 0, created_at: 1 }, on);
  return {
    ids: { uD, uA, uB, MINE, DG, DC, DI, FELLES, FG, FC, FI },
    db: {
      _rolesBackfilled: true,
      profiles: [
        { id: uD, email: 'd@x.no', display_name: 'Dina Sletter', user_metadata: {} },
        { id: uA, email: 'a@x.no', display_name: 'Alice Eier', user_metadata: {} },
        { id: uB, email: 'b@x.no', display_name: 'Bo Medlem', user_metadata: {} },
      ],
      passwords: { 'd@x.no': 'x', 'a@x.no': 'x', 'b@x.no': 'x' },
      universes: [
        base({ id: MINE, owner_id: uD, name: 'Mitt område' }),
        base({ id: FELLES, owner_id: uA, name: 'Fellesområdet', pos: 1 }),
      ],
      groups: [
        base({ id: DG, owner_id: uD, universe_id: MINE, name: 'Min mappe' }),
        base({ id: FG, owner_id: uD, universe_id: FELLES, name: 'Felles mappe' }),
      ],
      cards: [
        base({ id: DC, owner_id: uD, group_id: DG, title: 'Min liste', k: true, p: true, lab_ts: 0, lab_org: '' }),
        base({ id: FC, owner_id: uD, group_id: FG, title: 'Felles liste', k: true, p: true, lab_ts: 0, lab_org: '', responsible: uD }),
      ],
      items: [
        base({ id: DI, owner_id: uD, card_id: DC, text: 'Melk' }),
        base({ id: FI, owner_id: uD, card_id: FC, text: 'Brød', responsible: uD }),
      ],
      memberships: [
        mem(uD, { universe_id: MINE }, 'owner', 0),
        mem(uB, { universe_id: MINE }, 'member', 0),
        mem(uA, { universe_id: FELLES }, 'owner', 0),
        mem(uD, { universe_id: FELLES }, 'owner', 1),
      ],
      // D har invitert C (ubesvart) — skal forsvinne med kontoen.
      share_invites: [{ id: U(), inviter_id: uD, invitee_email: 'c@x.no', invitee_id: null,
        universe_id: MINE, group_id: null, role: 'member', status: 'pending', created_at: 1 }],
      tombstones: [],
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
  await page.waitForFunction(() => {
    const H = window.__huskis;
    return H && H.authUser && H.lastMy && H.state.universes.length > 0;
  }, null, { timeout: 8000, polling: 200 });
}

const mockDB = (p) => p.evaluate(() => JSON.parse(localStorage.getItem('hk-mock-db')));

// Syntetisk peker (samme mønster som de andre gest-testene): pointerdown på
// elementet under punktet, move/up på window — der sveipe-motoren lytter.
async function ptr(p, type, x, y, kind) {
  await p.evaluate(([type, x, y, kind]) => {
    const ev = new PointerEvent(type, {
      bubbles: true, cancelable: true, composed: true,
      clientX: x, clientY: y, pointerId: 21, pointerType: kind, button: 0, isPrimary: true,
    });
    (type === 'pointerdown' ? (document.elementFromPoint(x, y) || document.body) : window).dispatchEvent(ev);
  }, [type, x, y, kind]);
}

// Feltets geometri + hvor langt sveipet er kommet (--p / aria-valuenow).
const swipeInfo = (p) => p.evaluate(() => {
  const el = document.getElementById('delete-account-swipe');
  const r = el.getBoundingClientRect();
  return {
    left: Math.round(r.left), right: Math.round(r.right),
    y: Math.round(r.top + r.height / 2),
    p: parseFloat(el.style.getPropertyValue('--p') || '0'),
    aria: parseInt(el.getAttribute('aria-valuenow') || '0', 10),
  };
});

// Sveip fra like innenfor feltets venstre kant og dx px mot høyre.
async function swipe(p, dx, kind) {
  const s = await swipeInfo(p);
  const x = s.left + 24;
  await ptr(p, 'pointerdown', x, s.y, kind); await p.waitForTimeout(40);
  for (const f of [0.3, 0.7, 1]) {
    await ptr(p, 'pointermove', Math.round(x + dx * f), s.y, kind);
    await p.waitForTimeout(40);
  }
  await ptr(p, 'pointerup', Math.round(x + dx), s.y, kind);
  await p.waitForTimeout(500);
}

async function run(label, vp, mobile) {
  const kind = mobile ? 'touch' : 'mouse';
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: vp, isMobile: mobile, hasTouch: mobile });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  console.log('\n== ' + label + ' ==');
  const { ids, db } = buildDB();

  await loadAs(p, db, ids.uD, 'd@x.no', vp);

  /* ---------- 1) Knapperaden i konto-modalen ---------- */
  await p.evaluate(() => window.__huskis.openAccount());
  await p.waitForTimeout(300);
  const btns = await p.evaluate(() => {
    const out = document.getElementById('logout-btn');
    const del = document.getElementById('delete-account-btn');
    const ro = out.getBoundingClientRect(), rd = del.getBoundingClientRect();
    return {
      outCls: out.className, delCls: del.className,
      delText: del.textContent.trim(), delHasIcon: !!del.querySelector('svg'),
      sameLine: Math.abs((ro.top + ro.height / 2) - (rd.top + rd.height / 2)) < 4,
      delRightOfOut: rd.left > ro.right,
      sameParent: out.parentElement === del.parentElement,
    };
  });
  log(label + ' 1: «Logg ut» er gul, ikke rød',
    /btn-yellow/.test(btns.outCls) && !/btn-red/.test(btns.outCls), btns.outCls);
  log(label + ' 1: «Slett konto» er rød, med ikon og tekst',
    /btn-red/.test(btns.delCls) && btns.delText === 'Slett konto' && btns.delHasIcon, btns.delText);
  log(label + ' 1: de står på samme linje, sletting til høyre',
    btns.sameLine && btns.delRightOfOut && btns.sameParent,
    JSON.stringify({ sameLine: btns.sameLine, right: btns.delRightOfOut }));

  /* ---------- 2) Advarselen ---------- */
  log(label + ' 2: advarselen er ikke åpen før man ber om den',
    await p.locator('#delete-account-modal').isHidden());
  await p.locator('#delete-account-btn').click(); await p.waitForTimeout(350);
  const warn = await p.evaluate(() => {
    const m = document.getElementById('delete-account-modal');
    return {
      open: !m.hidden,
      role: m.querySelector('.modal').getAttribute('role'),
      text: m.querySelector('.modal-body').textContent.replace(/\s+/g, ' ').trim(),
      bullets: m.querySelectorAll('.danger-list li').length,
      // Ingen OK-knapp: bekreftelsen ER gesten.
      buttons: [...m.querySelectorAll('.modal-foot button')].map((b) => b.textContent.trim()),
      swipeInView: (() => {
        const r = m.querySelector('.confirm-swipe').getBoundingClientRect();
        return r.width > 120 && r.top >= 0 && r.bottom <= window.innerHeight;
      })(),
      label: m.querySelector('.confirm-swipe .swipe-label').textContent.trim(),
    };
  });
  log(label + ' 2: modalen åpnes som en alertdialog', warn.open && warn.role === 'alertdialog');
  log(label + ' 2: den forklarer konsekvensene (tre punkter + «kan ikke angres»)',
    warn.bullets === 3 && /kan ikke angres/i.test(warn.text) && /eneste eier/i.test(warn.text));
  log(label + ' 2: eneste knapp er «Avbryt» — bekreftelsen er sveipet',
    warn.buttons.length === 1 && warn.buttons[0] === 'Avbryt' && warn.label === 'Slett kontoen',
    JSON.stringify(warn.buttons));
  log(label + ' 2: sveipefeltet er synlig i sin helhet', warn.swipeInView);

  /* ---------- 3) Escape og Avbryt lukker uten å slette ---------- */
  await p.keyboard.press('Escape'); await p.waitForTimeout(250);
  log(label + ' 3: Escape lukker advarselen, konto-modalen står igjen',
    await p.locator('#delete-account-modal').isHidden() &&
    await p.locator('#account-modal').isVisible());
  await p.locator('#delete-account-btn').click(); await p.waitForTimeout(300);
  await p.locator('#delete-account-cancel').click(); await p.waitForTimeout(250);
  log(label + ' 3: «Avbryt» lukker også',
    await p.locator('#delete-account-modal').isHidden() &&
    !!(await mockDB(p)).profiles.find((x) => x.id === 'uD'));

  /* ---------- 4) For kort sveip sletter ingenting ---------- */
  await p.locator('#delete-account-btn').click(); await p.waitForTimeout(300);
  await swipe(p, 60, kind);
  const short = await swipeInfo(p);
  log(label + ' 4: et for kort sveip spretter tilbake til null',
    short.p === 0 && short.aria === 0, JSON.stringify(short));
  log(label + ' 4: … og kontoen står urørt',
    !!(await mockDB(p)).profiles.find((x) => x.id === 'uD') &&
    (await p.evaluate(() => !!window.__huskis.authUser)));

  /* ---------- 5) Tastatur: piltastene fyller feltet ---------- */
  await p.locator('#delete-account-swipe').focus();
  await p.keyboard.press('ArrowRight'); await p.keyboard.press('ArrowRight');
  await p.waitForTimeout(150);
  const keyed = await swipeInfo(p);
  log(label + ' 5: piltast høyre flytter sveipet fremover', keyed.aria === 40, String(keyed.aria));
  await p.keyboard.press('Home'); await p.waitForTimeout(150);
  log(label + ' 5: Home nullstiller igjen', (await swipeInfo(p)).aria === 0);

  /* ---------- 6) Fullt sveip → slettet ---------- */
  await p.evaluate((uid) => {
    // Lokale spor som skal ryddes med kontoen (skrives normalt av synken).
    localStorage.setItem('mine-lister-v1:' + uid, '{"universes":[]}');
    localStorage.setItem('hk-migrated:' + uid, '1');
  }, ids.uD);
  const span = await swipeInfo(p);
  await swipe(p, span.right - span.left, kind);
  await p.waitForTimeout(700);

  const after = await mockDB(p);
  const tomb = (id) => after.tombstones.some((t) => t.resource_id === id);
  log(label + ' 6: brukeren er logget ut og står på innloggingssiden',
    (await p.evaluate(() => !window.__huskis.authUser && document.body.classList.contains('no-auth'))) &&
    await p.locator('#auth-screen').isVisible());
  log(label + ' 6: kvitteringen står på innloggingssiden (ikke i en toast under den)',
    /slettet/i.test(await p.locator('#auth-msg').textContent()));
  log(label + ' 6: profilen er borte fra databasen',
    !after.profiles.find((x) => x.id === ids.uD) && after.profiles.length === 2);
  log(label + ' 6: området D var eneste eier av er slettet med hele treet',
    !after.universes.find((u) => u.id === ids.MINE) &&
    !after.groups.find((g) => g.id === ids.DG) &&
    !after.cards.find((c) => c.id === ids.DC) &&
    !after.items.find((i) => i.id === ids.DI));
  log(label + ' 6: hver slettede rad har gravstein (ingen gjenoppstandelse)',
    [ids.MINE, ids.DG, ids.DC, ids.DI].every(tomb));
  log(label + ' 6: B sitt medlemskap i det slettede området fulgte med',
    !after.memberships.some((m) => m.universe_id === ids.MINE));
  log(label + ' 6: fellesområdet står igjen med A som eneste eier',
    !!after.universes.find((u) => u.id === ids.FELLES) &&
    after.memberships.filter((m) => m.universe_id === ids.FELLES && m.role === 'owner')
      .map((m) => m.user_id).join() === ids.uA);
  log(label + ' 6: innholdet D laget der står igjen, med A som oppretter',
    after.groups.find((g) => g.id === ids.FG).owner_id === ids.uA &&
    after.cards.find((c) => c.id === ids.FC).owner_id === ids.uA &&
    after.items.find((i) => i.id === ids.FI).owner_id === ids.uA);
  log(label + ' 6: ansvaret som pekte på D er nullet med nytt innholds-stempel',
    after.cards.find((c) => c.id === ids.FC).responsible === null &&
    after.items.find((i) => i.id === ids.FI).responsible === null &&
    after.items.find((i) => i.id === ids.FI).ts > 1);
  log(label + ' 6: ingen roller eller invitasjoner igjen',
    !after.memberships.some((m) => m.user_id === ids.uD) &&
    !after.share_invites.some((s) => s.inviter_id === ids.uD || s.invitee_id === ids.uD));
  log(label + ' 6: lokal cache og migreringsflagg er ryddet',
    await p.evaluate((uid) => !localStorage.getItem('mine-lister-v1:' + uid) &&
                              !localStorage.getItem('hk-migrated:' + uid), ids.uD));

  /* ---------- 7) Den slettede kontoen kommer ikke inn igjen ---------- */
  await p.locator('#auth-email').fill('d@x.no');
  await p.locator('#auth-password').fill('x');
  await p.locator('#auth-submit').click(); await p.waitForTimeout(800);
  log(label + ' 7: innlogging med den slettede kontoen avvises',
    await p.locator('#auth-screen').isVisible() &&
    (await p.evaluate(() => !window.__huskis.authUser)));

  /* ---------- 8) Den andre eieren ser fortsatt sitt ---------- */
  await loadAs(p, await mockDB(p), ids.uA, 'a@x.no', vp);
  const aSees = await p.evaluate(() => {
    const st = window.__huskis.state;
    return st.universes.map((u) => u.name).sort();
  });
  log(label + ' 8: A ser fellesområdet (og ikke det slettede)',
    aSees.length === 1 && aSees[0] === 'Fellesområdet', JSON.stringify(aSees));

  log(label + ': ingen JS-feil i konsollen', errs.length === 0, errs.join(' | '));
  await browser.close();
}

(async () => {
  await run('desktop', { width: 1280, height: 900 }, false);
  await run('mobil', { width: 390, height: 844 }, true);
  const bad = results.filter((r) => !r).length;
  console.log('\n' + (bad ? '❌ ' + bad + ' feilet' : '✅ alle ' + results.length + ' sjekker grønne'));
  process.exit(bad ? 1 : 0);
})();
