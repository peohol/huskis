/*
  Regresjonstest: NAV-MODALEN KJØRER PÅ dnd-kit (gjennom Smett).

  Områder, mapper og mappekategorier dras ikke lenger av motoren i app.js, men
  av dnd-kit — mens hovedsidens board fortsatt kjører den gamle. De to
  MOTORENE er byttet; POLITIKKEN skal være den samme. Denne fila dekker det som
  bare kan gå galt fordi motoren er en annen; hva et slipp betyr (flytting
  mellom områder, søppelkassen, ekstrahering, låste mål) er dekket av
  `nav-modal`, `dnd-trash` og `group-move`.

  Dekker:
    1. Nav-modalen har dnd-kits kroker: det løftede objektet får
       `[data-dnd-dragging]`, og klonen som holder plassen
       `[data-dnd-placeholder]`. Hovedsidens board bruker fortsatt `.dragging`
       og sin egen `.item-placeholder` — de to motorene lever side om side.
    2. Klonen er ikke en NABO. Den ligger rett etter det løftede objektet og
       bærer de samme klassene, så en `pos` regnet mot den ville alltid blitt
       «sist i lista» uansett hvor man slapp. En mappe sluppet MIDT i lista skal
       få en pos mellom naboenes — både på radnivå og kortnivå.
    3. Klikket etter draget undertrykkes — også når slippet endte på en ANNEN
       rad enn den man tok tak i. En mapperad navigerer ved klikk, så uten dette
       ville et fullført drag lukket modalen og båret brukeren av gårde.
    4. En LÅST mappe kan ikke løftes (`data-dnd-ignore` på raden), og
       menyknappen løfter aldri noe.
    5. Kategoriens hylle og ＋-knappen i den løfter ikke kategorien — bare
       overskriften gjør det.
    6. Opplesningen under draget er NORSK: dnd-kits live-område får setningene
       sine fra ordboken (`dnd.a11y*`), ikke fra bibliotekets egne engelske.
    7. En LÅST mappe kan ikke løftes (`data-dnd-ignore` på raden).
    8. Peek-åpningen virker på den nye motoren også: blir man værende over et
       KOLLAPSET område, folder det seg midlertidig ut, og et slipp der lander i
       det — og lar det stå åpent.

  Kjør:
    python3 -m http.server 8000                         # fra repo-roten, i egen terminal
    NODE_PATH=$(npm root -g) node tests/dnd-nav-engine.test.js
*/
'use strict';
const { chromium } = require('playwright');
const G = require('./dnd-gestures.js');

const BASE = process.env.HUSKIS_URL || 'http://localhost:8000';

const results = [];
const log = (n, ok, x = '') => {
  results.push(ok);
  console.log((ok ? 'PASS' : 'FAIL') + ' — ' + n + (x ? '  [' + x + ']' : ''));
};

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
  await p.locator('#auth-submit').click();
  await p.waitForFunction(() => {
    const H = window.__huskis;
    return H && H.authUser && H.lastMy;
  }, null, { timeout: 15000, polling: 200 });
  // Introduksjonen legger seg over appen og slipper bare gjennom klikkene sine.
  await p.evaluate(() => window.__huskis.tour.skipAll());
  await p.waitForTimeout(150);
}

/* Objektene opprettes gjennom UI-et, ikke ved å skrive i `state`: rekkefølgen
   på områder er PERSONLIG (`memberships.pos`), og en rad som aldri har vært på
   serveren får ingen personlig posisjon å skrive til. Escape avbryter
   navneredigereren som ＋-knappen åpner; objektet blir stående. */
async function addUniverses(p, n) {
  for (let i = 0; i < n; i++) {
    await p.evaluate(() => window.__huskis.addUniverse());
    await p.waitForTimeout(220);
    await p.keyboard.press('Escape');
    await p.waitForTimeout(180);
  }
}
async function addGroups(p, n) {
  for (let i = 0; i < n; i++) {
    await p.evaluate(() => window.__huskis.addGroup());
    await p.waitForTimeout(220);
    await p.keyboard.press('Escape');
    await p.waitForTimeout(180);
  }
}
const openNav = async (p) => {
  await p.evaluate(() => window.__huskis.openNavModal());
  await p.waitForTimeout(400);
};
/* Escape lukker ØVERSTE lag. Et musetrykk på en knapp gir et klikk og åpner
   objektmenyen; en avbrutt berøring gir ingen — og et Escape ville da lukket
   nav-modalen i stedet. Lukk derfor bare menyen, og bare når den faktisk står
   åpen. */
const closeMenuIfOpen = async (p) => {
  const open = await p.evaluate(() => {
    const m = document.getElementById('obj-menu');
    return !!m && !m.hidden;
  });
  if (!open) return;
  await p.keyboard.press('Escape');
  await p.waitForTimeout(250);
};
const closeNav = async (p) => {
  await p.evaluate(() => window.__huskis.closeNavModal());
  await p.waitForTimeout(250);
};

const groupRows = (p) => p.evaluate(() => [...document.querySelectorAll(
  '#nav-board .card .items-container > .item')].map((e) => e.dataset.id));
const uniCards = (p) => p.evaluate(() => [...document.querySelectorAll(
  '#nav-board .board-col > .card')].map((e) => e.dataset.id).filter(Boolean));
const posOf = (p, id) => p.evaluate((x) => {
  const o = window.__huskis.state.universes.find((u) => u.id === x) ||
    window.__huskis.state.universes.flatMap((u) => u.groups).find((g) => g.id === x);
  return o ? o.pos : null;
}, id);

async function run(label, viewport, mobile) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  const touch = mobile;

  await register(p);
  await addUniverses(p, 1);
  await addGroups(p, 3);
  await openNav(p);

  /* ---------- 1) Motorens egne kroker ---------- */
  const rows = await groupRows(p);
  const rowSel = (i) => '#nav-board .item[data-id="' + rows[i] + '"]';
  // Sikt på et punkt målt FØR løftet: klonen holder plassen, så geometrien står
  // stille selv om radene bytter plass under gesten (se tests/dnd-gestures.js).
  const target = await G.past(p, rowSel(1), 0.9);
  await G.lift(p, await G.centre(p, rowSel(0)), touch);
  const lifted = await p.evaluate(() => {
    const el = document.querySelector('#nav-board [data-dnd-dragging]');
    const ph = document.querySelector('#nav-board [data-dnd-placeholder]');
    return {
      løftet: el && el.dataset.id,
      gammelKlasse: document.querySelectorAll('#nav-board .dragging').length,
      klone: !!ph,
      kloneEtterLøftet: !!(el && el.nextElementSibling === ph),
      kloneUtenId: !!(ph && !ph.dataset.id),
    };
  });
  log(label + ' 1: det løftede objektet er merket av dnd-kit, ikke av den gamle motoren',
    lifted.løftet === rows[0] && lifted.gammelKlasse === 0, JSON.stringify(lifted));
  log(label + ' 1: klonen holder plassen rett etter objektet, og har gitt fra seg id-en',
    lifted.klone === true && lifted.kloneEtterLøftet === true && lifted.kloneUtenId === true,
    JSON.stringify(lifted));

  /* ---------- 2) Klonen er ikke en nabo (rad) ---------- */
  await G.travel(p, target, touch);
  await G.drop(p, undefined, touch);
  await p.waitForTimeout(400);
  const after = await groupRows(p);
  const pos = { a: await posOf(p, rows[0]), b: await posOf(p, rows[1]), c: await posOf(p, rows[2]) };
  log(label + ' 2: mappen havnet mellom de to andre',
    after.indexOf(rows[0]) === 1 && after.indexOf(rows[1]) === 0 &&
    after.indexOf(rows[2]) === 2, after.join(',') + ' (var ' + rows.join(',') + ')');
  log(label + ' 2: … og fikk en pos MELLOM naboenes, ikke bakerst',
    pos.b < pos.a && pos.a < pos.c, JSON.stringify(pos));

  /* ---------- 3) Klikket etter draget ---------- */
  // Slippet endte på en ANNEN rad enn den man tok tak i. Et klikk der ville
  // navigert til den mappen og lukket modalen.
  const navigated = await p.evaluate(() => ({
    lukket: document.getElementById('nav-modal').hidden,
    aktiv: window.__huskis.state.activeGroup,
  }));
  log(label + ' 3: et fullført drag navigerte ikke — modalen står fortsatt åpen',
    navigated.lukket === false, JSON.stringify(navigated));

  /* ---------- 4) Menyknappen løfter aldri noe ---------- */
  // Den ligger midt i dra-sonen på hver eneste rad.
  const menuAt = await G.centre(p, '#nav-board .item[data-id="' + rows[0] + '"] .obj-menu-btn');
  if (touch) {
    await G.touchStart(p, menuAt.x, menuAt.y);
    await p.waitForTimeout(G.HOLD_WAIT);
  } else {
    await p.mouse.move(menuAt.x, menuAt.y);
    await p.mouse.down();
    await p.mouse.move(menuAt.x, menuAt.y + G.NUDGE, { steps: 3 });
    await p.waitForTimeout(120);
  }
  log(label + ' 4: menyknappen løfter ingenting', (await G.liftedCount(p)) === 0);
  if (touch) await G.touchCancel(p); else await p.mouse.up();
  await p.waitForTimeout(250);
  await closeMenuIfOpen(p);

  /* ---------- 5) Kategoriens hylle løfter ikke kategorien ---------- */
  // Mappekategorien lages med den gule knappen i områdekortet. Den åpner
  // navneredigereren på et TOMT navn, og et avbrutt navn fjerner objektet igjen
  // — så den må navngis.
  await p.locator('#nav-board .card .add-cat-btn').first().click();
  await p.waitForTimeout(300);
  await p.keyboard.type('Prosjekter');
  await p.keyboard.press('Enter');
  await p.waitForTimeout(350);
  const catSel = '#nav-board .category';
  log(label + ' 5: mappekategorien er bygget',
    (await p.locator(catSel).count()) === 1);
  const addAt = await G.centre(p, catSel + ' .cat-add-btn');
  if (touch) {
    await G.touchStart(p, addAt.x, addAt.y);
    await p.waitForTimeout(G.HOLD_WAIT);
  } else {
    await p.mouse.move(addAt.x, addAt.y);
    await p.mouse.down();
    await p.mouse.move(addAt.x, addAt.y + G.NUDGE, { steps: 3 });
    await p.waitForTimeout(120);
  }
  log(label + ' 5: ＋-knappen i kategorien løfter ikke kategorien',
    (await G.liftedCount(p)) === 0);
  if (touch) await G.touchCancel(p); else await p.mouse.up();
  await p.waitForTimeout(250);
  // Et musetrykk på ＋ oppretter en ny mappe i kategorien og åpner navnefeltet;
  // en avbrutt berøring gjør ingenting. Rydd bare når det faktisk skjedde.
  if (await p.evaluate(() => !!document.querySelector('.edit-input'))) {
    await p.keyboard.press('Escape');
    await p.waitForTimeout(250);
  }

  const headAt = await G.centre(p, catSel + ' .cat-head');
  await G.lift(p, headAt, touch);
  log(label + ' 5: … men overskriften gjør det',
    (await p.evaluate(() => {
      const el = document.querySelector('#nav-board [data-dnd-dragging]');
      return !!el && el.classList.contains('category');
    })) === true);

  /* ---------- 6) Opplesningen er norsk ---------- */
  // Live-områdene er små og skjulte; de store `aria-live`-flatene i appen (selve
  // board-et) er ikke det som leses opp under et drag.
  const spoken = await p.evaluate(() => [...document.querySelectorAll('[aria-live="polite"]')]
    .map((e) => (e.textContent || '').trim())
    .filter((t) => t && t.length < 200));
  log(label + ' 6: dnd-kits live-område snakker norsk (fra ordboken)',
    spoken.some((t) => /^Løftet /.test(t)) && !spoken.some((t) => /^Picked up /.test(t)),
    JSON.stringify(spoken.filter((t) => /Løftet|Picked up/.test(t))));
  await G.drop(p, undefined, touch);
  await p.waitForTimeout(400);

  /* ---------- 2b) Klonen er ikke en nabo (kort) ---------- */
  await closeNav(p);
  await addUniverses(p, 2);   // tre områder til sammen
  await openNav(p);
  const cards = await uniCards(p);
  log(label + ' 2b: tre områdekort å omrokkere', cards.length === 3, cards.join(','));
  const headSel = (i) => '#nav-board .card[data-id="' + cards[i] + '"] .card-head';
  await G.lift(p, await G.centre(p, headSel(0)), touch);
  /* Kortdraget KOLLAPSER alle områdene, så målet måles ETTER løftet — og det er
     SENTERET av den sloten kortet skal ende i, ikke et punkt forbi naboen.
     Et kort som bytter plass med naboen TAR naboens slot, og naboen tar dens:
     sikter man forbi naboen, ligger punktet etter byttet i sloten under, og
     kortet fortsetter nedover. Senteret av målsloten er det ene punktet som
     står stille gjennom byttet. */
  const cardTarget = await G.centre(p, '#nav-board .card[data-id="' + cards[1] + '"]');
  await G.travel(p, cardTarget, touch);
  await G.drop(p, undefined, touch);
  await p.waitForTimeout(500);
  const cardsAfter = await uniCards(p);
  const cPos = { a: await posOf(p, cards[0]), b: await posOf(p, cards[1]), c: await posOf(p, cards[2]) };
  log(label + ' 2b: området havnet mellom de to andre',
    cardsAfter.indexOf(cards[0]) === 1 && cardsAfter.indexOf(cards[1]) === 0,
    cardsAfter.join(',') + ' (var ' + cards.join(',') + ')');
  log(label + ' 2b: … og fikk en pos MELLOM naboenes, ikke bakerst',
    cPos.b < cPos.a && cPos.a < cPos.c, JSON.stringify(cPos));
  log(label + ' 2b: områdene er foldet ut igjen etter draget',
    (await p.evaluate(() => [...document.querySelectorAll('#nav-board .card')]
      .filter((c) => c.classList.contains('collapsed')).length)) === 0);

  /* ---------- 8) Peek-åpning av et kollapset område ---------- */
  // Målet er området som ligger ØVERST etter omrokkeringen i 2b: da er både
  // kilden og målet i visningen samtidig, uten at modalen må scrolle midt i
  // gesten.
  await p.evaluate((uid) => {
    const u = window.__huskis.state.universes.find((x) => x.id === uid);
    u.collapsed = true;
    window.__huskis.render();
  }, cards[1]);
  await p.waitForTimeout(350);
  const peekSel = '#nav-board .card[data-id="' + cards[1] + '"]';
  log(label + ' 8: mål-området er kollapset i utgangspunktet',
    await p.evaluate((s2) => document.querySelector(s2).classList.contains('collapsed'), peekSel));
  const peekRow = '#nav-board .item[data-id="' + rows[1] + '"]';
  await p.evaluate((s2) => document.querySelector(s2).scrollIntoView({ block: 'center' }), peekRow);
  await p.waitForTimeout(200);
  await G.lift(p, await G.centre(p, peekRow), touch);
  // Bli VÆRENDE over det kollapsede kortet: peek-timeren er 200 ms, og
  // `travel` venter godt forbi det i to omganger.
  await G.travel(p, () => G.centre(p, peekSel + ' .card-head'), touch);
  log(label + ' 8: å bli værende over det foldet området midlertidig ut',
    await p.evaluate((s2) => !document.querySelector(s2).classList.contains('collapsed'), peekSel));
  await G.drop(p, undefined, touch);
  await p.waitForTimeout(600);
  const landed = await p.evaluate(({ gid, uid }) => {
    const st = window.__huskis.state;
    const g = st.universes.flatMap((u) => u.groups).find((x) => x.id === gid);
    const u = st.universes.find((x) => x.id === uid);
    return { uni: g && g.uni, collapsed: u && !!u.collapsed };
  }, { gid: rows[1], uid: cards[1] });
  log(label + ' 8: mappen landet i det peek-åpnede området, og det ble stående åpent',
    landed.uni === cards[1] && landed.collapsed === false, JSON.stringify(landed));

  /* ---------- 7) En LÅST mappe kan ikke løftes ---------- */
  // Låsen settes på OMRÅDET, og gjelder da mappene i det: en eier omgår enhver
  // lås, så både området og mappen må stå som «vanlig medlem» for at låsen skal
  // gjelde for meg (se `privilegedLocal` i app.js).
  const lockedRow = await p.evaluate((gid) => {
    const st = window.__huskis.state;
    const u = st.universes.find((x) => (x.groups || []).some((g) => g.id === gid));
    if (!u) return null;
    u._role = 'member'; u._locked = true;
    u._caps = { editContent: false, createGroup: false, delete: false, leave: true };
    // Låsen settes på mappen SELV også: `frozen()` går oppover og stopper ved
    // nærmeste eksplisitte tilstand, og en lokalt opprettet rad har ikke
    // nødvendigvis fått `_parent` fra serveren ennå.
    u.groups.forEach((g) => {
      g._role = 'member'; g._locked = true; g._caps = { editContent: false };
    });
    window.__huskis.render();
    return gid;
  }, rows[0]);
  await p.waitForTimeout(350);
  const lockSel = '#nav-board .item[data-id="' + lockedRow + '"]';
  log(label + ' 7: den låste mappen er merket som udragbar',
    await p.evaluate((s2) => {
      const el = document.querySelector(s2);
      return !!el && el.hasAttribute('data-dnd-ignore');
    }, lockSel), lockSel);
  // Et ekte forsøk: `G.lift` prøver til det lykkes, så her brukes primitivene
  // og fraværet påstås selv.
  const lockAt = await G.centre(p, lockSel);
  if (touch) {
    await G.touchStart(p, lockAt.x, lockAt.y);
    await p.waitForTimeout(G.HOLD_WAIT);
  } else {
    await p.mouse.move(lockAt.x, lockAt.y);
    await p.mouse.down();
    await p.mouse.move(lockAt.x, lockAt.y + G.NUDGE, { steps: 3 });
    await p.waitForTimeout(120);
  }
  log(label + ' 7: … og et ekte løft på den starter ingen drag',
    (await G.liftedCount(p)) === 0);
  if (touch) await G.touchCancel(p); else await p.mouse.up();
  await p.waitForTimeout(250);

  log(label + ': ingen JS-feil', errs.length === 0, errs.join(' | '));
  await browser.close();
}

(async () => {
  await run('desktop', { width: 1200, height: 900 }, false);
  await run('mobil', { width: 390, height: 780 }, true);
  const ok = results.filter(Boolean).length;
  console.log('\n==== ' + ok + '/' + results.length + ' PASS ====');
  process.exit(ok === results.length ? 0 : 1);
})();
