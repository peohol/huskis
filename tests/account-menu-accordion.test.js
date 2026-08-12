/*
  Regresjonstest: KONTO-MODALENS TREKKSPILL (docs/menus.md → «Konto-modalen»).

  Konto-modalen var én lang rull med alt på én gang. Nå ligger innholdet i tre
  skuffer, og det som IKKE hører hjemme bak en skuff står utenfor dem.

  Dekker:
    1. Modalen åpner sammenslått: alle tre skuffene er lukket, og den lukker seg
       sammen igjen neste gang den åpnes (en åpen skuff overlever ikke).
    2. Kun ÉN skuff er åpen om gangen — å åpne en ny lukker den forrige, og et
       nytt trykk på den åpne lukker den.
    3. Åpningen er animert: høyden vokser gradvis, den spretter ikke rett opp.
    4. En lukket skuff er `inert` — Tab går ikke gjennom felter ingen ser.
    5. Innholdet ligger i riktig skuff: bilde/navn/e-post + varsel/passord i
       kontoopplysningene (med skillelinjer mellom seksjonene), demo +
       tastatursnarveier i Tips, logg ut + slett konto i den siste.
    6. Språkraden står UTENFOR trekkspillet, nederst, med etiketten på begge
       språk («Språk · Language») — den skal kunne finnes av en som ikke kan
       lese resten av menyen. Invitasjons-innboksen står også utenfor.
    7. Overskriftene er ekte knapper med aria-expanded/aria-controls, og
       skuffene er regioner med navn.

  Kjøres på BÅDE desktop- og mobil-viewport (skuffene er hele menyens layout).

  Kjør:
    python3 -m http.server 8000                                # fra repo-roten
    NODE_PATH=$(npm root -g) node tests/account-menu-accordion.test.js
*/
const { chromium } = require('playwright');

const BASE = process.env.HUSKIS_URL || 'http://localhost:8000';
const results = [];
const log = (n, ok, x = '') => { results.push(ok); console.log((ok ? 'PASS' : 'FAIL') + ' — ' + n + (x ? '  [' + x + ']' : '')); };
const U = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16); });

const KEYS = ['profile', 'tips', 'session'];

/* Seedet konto med ett område: raskere enn å klikke gjennom registreringen, og
   introduksjonen er allerede avviklet (se tests/CLAUDE.md). */
function seed() {
  const uid = U(), uni = U();
  return {
    uid,
    db: {
      profiles: [{ id: uid, email: 'k@x.no', display_name: 'Kari Nordmann', user_metadata: {} }],
      passwords: { 'k@x.no': 'x' },
      universes: [{ id: uni, owner_id: uid, name: 'Mitt område', trashed: false, locked: false,
        unlocked: false, invite_policy: 'inherit', ts: 1, org: 'a', pos: 0, pos_ts: 0, pos_org: '' }],
      groups: [], cards: [], items: [], memberships: [], share_invites: [], tombstones: [],
    },
  };
}

async function load(p, s) {
  await p.goto(BASE + '/?mock=1');
  await p.evaluate(({ db, sess }) => {
    localStorage.clear();
    localStorage.setItem('hk-mock-db', JSON.stringify(db));
    sessionStorage.setItem('hk-mock-session', JSON.stringify(sess));
  }, { db: s.db, sess: { id: s.uid, email: 'k@x.no',
       user_metadata: { onboarding: { v: 3, status: 'done' },
                        tips: { drag: true, trash: true, moveList: true, dragTrash: true } } } });
  await p.goto(BASE + '/?mock=1');
  await p.waitForFunction(() => window.__huskis && window.__huskis.authUser && window.__huskis.lastMy,
    null, { timeout: 15000, polling: 100 });
}

// Skuffen animerer på høyde; `slideSub` rydder bort den eksplisitte høyden når
// animasjonen er ferdig. Det er ferdig-signalet — ikke klokka.
const settled = (p, key) => p.waitForFunction((k) => {
  const s = document.getElementById('acc-' + k);
  return !!s && !s.classList.contains('is-closed') && s.style.height === '';
}, key, { timeout: 5000, polling: 30 });

const openDrawer = async (p, key) => { await p.locator('#acc-' + key + '-head').click(); await settled(p, key); };

const drawerState = (p) => p.evaluate((keys) => keys.map((k) => {
  const sub = document.getElementById('acc-' + k);
  const head = document.getElementById('acc-' + k + '-head');
  return {
    key: k,
    open: !sub.classList.contains('is-closed'),
    expanded: head.getAttribute('aria-expanded'),
    inert: sub.hasAttribute('inert'),
    height: Math.round(sub.getBoundingClientRect().height),
  };
}), KEYS);

async function run(label, vp, mobile) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: vp, isMobile: mobile, hasTouch: mobile });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  console.log('\n== ' + label + ' ==');

  await load(p, seed());

  /* ---------- 1) Modalen åpner sammenslått ---------- */
  await p.locator('#account-btn').click();
  await p.waitForFunction(() => !document.getElementById('account-modal').hidden,
    null, { timeout: 5000, polling: 50 });
  let st = await drawerState(p);
  log(label + ' 1: alle tre skuffene er lukket når modalen åpnes',
    st.length === 3 && st.every((d) => !d.open && d.expanded === 'false' && d.height === 0),
    JSON.stringify(st));

  /* ---------- 2) Kun én åpen om gangen ---------- */
  await openDrawer(p, 'profile');
  st = await drawerState(p);
  log(label + ' 2: den åpnede skuffen har høyde og aria-expanded=true',
    st[0].open && st[0].expanded === 'true' && st[0].height > 40, JSON.stringify(st[0]));

  await openDrawer(p, 'tips');
  st = await drawerState(p);
  log(label + ' 2: å åpne en ny lukker den forrige — kun én er åpen',
    st.filter((d) => d.open).length === 1 && st[1].open &&
    st[0].height === 0 && st[2].height === 0, JSON.stringify(st));

  await p.locator('#acc-tips-head').click();
  await p.waitForFunction(() => {
    const s = document.getElementById('acc-tips');
    return s.classList.contains('is-closed') && Math.round(s.getBoundingClientRect().height) === 0;
  }, null, { timeout: 5000, polling: 30 });
  st = await drawerState(p);
  log(label + ' 2: et nytt trykk på den åpne skuffen lukker den',
    st.every((d) => !d.open), JSON.stringify(st));

  /* ---------- 3) Åpningen er animert ---------- */
  // Fysikk-måling: høyden leses MENS den beveger seg. En skuff uten animasjon
  // ville stått på full høyde allerede i første måling.
  const growth = await p.evaluate(() => new Promise((resolve) => {
    const sub = document.getElementById('acc-profile');
    document.getElementById('acc-profile-head').click();
    const seen = [];
    const tick = () => {
      seen.push(Math.round(sub.getBoundingClientRect().height));
      if (seen.length < 8) requestAnimationFrame(tick);
      else resolve(seen);
    };
    requestAnimationFrame(tick);
  }));
  await settled(p, 'profile');
  const full = (await drawerState(p))[0].height;
  log(label + ' 3: skuffen vokser gradvis (animert), den spretter ikke rett opp',
    growth[0] < full && growth[growth.length - 1] > growth[0] && full > 100,
    JSON.stringify({ growth, full }));

  /* ---------- 4) En lukket skuff er inert ---------- */
  const reach = await p.evaluate(() => {
    const inClosed = document.getElementById('logout-btn');   // «Logg ut / slett konto» er lukket
    const inOpen = document.getElementById('account-name-input');
    inClosed.focus();
    const closedTookFocus = document.activeElement === inClosed;
    inOpen.focus();
    return {
      closedInert: !!inClosed.closest('[inert]'),
      openInert: !!inOpen.closest('[inert]'),
      closedTookFocus,
      openTookFocus: document.activeElement === inOpen,
    };
  });
  log(label + ' 4: kontrollene i en LUKKET skuff er inert og kan ikke få fokus',
    reach.closedInert && !reach.closedTookFocus, JSON.stringify(reach));
  log(label + ' 4: kontrollene i den ÅPNE skuffen er helt vanlige',
    !reach.openInert && reach.openTookFocus, JSON.stringify(reach));

  // Tab-runden i modalen skal aldri lande i en lukket skuff.
  let strayed = '';
  for (let i = 0; i < 25 && !strayed; i++) {
    await p.keyboard.press('Tab');
    strayed = await p.evaluate(() => {
      const a = document.activeElement;
      return a && a.closest && a.closest('[inert]') ? (a.id || a.className) : '';
    });
  }
  log(label + ' 4: Tab går aldri inn i en lukket skuff (25 trykk)', strayed === '', strayed);

  /* ---------- 5) Innholdet ligger i riktig skuff ---------- */
  const place = await p.evaluate(() => {
    const where = (id) => {
      const el = document.getElementById(id);
      if (!el) return 'MANGLER';
      const sub = el.closest('.menu-acc-sub');
      return sub ? sub.dataset.acc : 'utenfor';
    };
    const profileBody = document.querySelector('#acc-profile .menu-acc-body');
    return {
      photo: where('menu-account'), name: where('account-name-form'),
      email: where('account-email-form'), emailPref: where('menu-email-pref'),
      pass: where('account-pass-form'),
      tour: where('menu-tour'), keys: where('acc-tips') === 'tips'
        ? (document.querySelector('#acc-tips .menu-keys') ? 'tips' : 'MANGLER') : 'MANGLER',
      logout: where('logout-btn'), del: where('delete-account-btn'),
      lang: where('menu-language'), invites: where('menu-invites'),
      // Skillelinjer mellom seksjonene i kontoopplysnings-skuffen.
      lines: profileBody.querySelectorAll('hr.menu-divider').length,
      // Linjene skal gå kant-til-kant, som resten av delelinjene i modalene.
      lineFlush: (() => {
        const hr = profileBody.querySelector('hr.menu-divider');
        if (!hr) return false;
        const a = hr.getBoundingClientRect(), b = profileBody.parentElement.getBoundingClientRect();
        return Math.abs(a.left - b.left) < 1.5 && Math.abs(a.right - b.right) < 1.5;
      })(),
    };
  });
  log(label + ' 5: bilde, navn, e-post (+ varselvalget) og passord i kontoopplysningene',
    place.photo === 'profile' && place.name === 'profile' && place.email === 'profile' &&
    place.emailPref === 'profile' && place.pass === 'profile', JSON.stringify(place));
  log(label + ' 5: demonstrasjonen og tastatursnarveiene i Tips',
    place.tour === 'tips' && place.keys === 'tips', JSON.stringify(place));
  log(label + ' 5: logg ut og slett konto i den siste skuffen',
    place.logout === 'session' && place.del === 'session', JSON.stringify(place));
  log(label + ' 5: tre skillelinjer i kontoopplysningene, kant-til-kant',
    place.lines === 3 && place.lineFlush, JSON.stringify({ lines: place.lines, flush: place.lineFlush }));

  /* ---------- 6) Språkraden står utenfor trekkspillet ---------- */
  const lang = await p.evaluate(() => {
    const row = document.getElementById('menu-language');
    const acc = document.getElementById('account-acc');
    return {
      outside: row.closest('.menu-acc-sub') === null,
      label: row.querySelector('.menu-setting-label span:last-child').textContent.trim(),
      belowAccordion: row.getBoundingClientRect().top >= acc.getBoundingClientRect().bottom - 1,
      reachable: !row.closest('[inert]') && row.offsetParent !== null,
      selectEnabled: !document.getElementById('lang-select').disabled,
    };
  });
  log(label + ' 6: språkraden ligger utenfor trekkspillet, nederst, og er synlig med en gang',
    lang.outside && lang.belowAccordion && lang.reachable && lang.selectEnabled, JSON.stringify(lang));
  log(label + ' 6: etiketten står på begge språk', lang.label === 'Språk · Language', lang.label);
  log(label + ' 6: invitasjons-innboksen står også utenfor trekkspillet',
    place.invites === 'utenfor', place.invites);

  /* ---------- 7) Overskriftene er knapper med riktig semantikk ---------- */
  const aria = await p.evaluate((keys) => keys.map((k) => {
    const head = document.getElementById('acc-' + k + '-head');
    const sub = document.getElementById('acc-' + k);
    return {
      key: k,
      tag: head.tagName + ':' + head.type,
      controls: head.getAttribute('aria-controls') === sub.id,
      hasExpanded: head.hasAttribute('aria-expanded'),
      region: sub.getAttribute('role') === 'region',
      named: sub.getAttribute('aria-labelledby') === head.id,
      label: head.querySelector('.menu-acc-label').textContent.trim(),
    };
  }), KEYS);
  log(label + ' 7: hver overskrift er en knapp som styrer sin egen skuff',
    aria.every((a) => a.tag === 'BUTTON:button' && a.controls && a.hasExpanded),
    JSON.stringify(aria.map((a) => a.key + ':' + a.tag + ':' + a.controls)));
  log(label + ' 7: hver skuff er en navngitt region',
    aria.every((a) => a.region && a.named), JSON.stringify(aria.map((a) => a.key + ':' + a.region + a.named)));
  log(label + ' 7: overskriftene er de tre avtalte',
    aria.map((a) => a.label).join(' | ') === 'Rediger kontoopplysninger | Tips | Logg ut / slett konto',
    aria.map((a) => a.label).join(' | '));

  /* ---------- 1b) Neste åpning starter sammenslått igjen ---------- */
  await p.locator('#account-close').click();
  await p.waitForFunction(() => document.getElementById('account-modal').hidden,
    null, { timeout: 5000, polling: 50 });
  await p.locator('#account-btn').click();
  await p.waitForFunction(() => !document.getElementById('account-modal').hidden,
    null, { timeout: 5000, polling: 50 });
  st = await drawerState(p);
  log(label + ' 1: en åpen skuff overlever ikke at modalen lukkes',
    st.every((d) => !d.open && d.expanded === 'false' && d.inert && d.height === 0), JSON.stringify(st));

  log(label + ': ingen JS-feil', errs.length === 0, errs.join(' | '));
  await browser.close();
}

(async () => {
  await run('desktop', { width: 1200, height: 900 }, false);
  await run('mobil', { width: 390, height: 780 }, true);
  const pass = results.filter(Boolean).length;
  console.log('\n==== ' + pass + '/' + results.length + ' PASS ====');
  process.exit(pass === results.length ? 0 : 1);
})();
