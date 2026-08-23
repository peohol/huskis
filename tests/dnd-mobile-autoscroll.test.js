/*
  Regresjonstest for mobil liste-DnD (touch): auto-scroll-fortegnsklemme,
  normal-flow-vakten rundt board-et, og pointercancel-rollback.

  Kjør:
    python3 -m http.server 8000                    # fra repo-roten, i egen terminal
    NODE_PATH=$(npm root -g) node tests/dnd-mobile-autoscroll.test.js

  Testen driver den ekte DnD-koden med EKTE input (`tests/dnd-gestures.js`) mot
  mock-backenden (?mock=1). Merk: Playwright reproduserer ikke Android Chromes
  reelle scroll-klemme/`pointercancel` — testen verifiserer derfor INVARIANTENE:
  (a) board-bunnen (og dermed dokumentets maxScroll) faller ikke under touch-drag
      (board-vakten, `boardCollapseCardsForDrag`),
  (b) en nedover-auto-scroll-frame reduserer ALDRI scrollY når board-bunnen ligger
      over scrollY (den gamle fortegns-feilen — auto-scrollen er dnd-kits nå, og
      påstanden skal holde der også), og
  (c) et avbrudd ruller tilbake uten å lagre et drop, og
  (d) den ØVRE auto-scroll-sonen rekker under den faste toppmenyen — dnd-kits
      `AutoScroller` bruker en brøkdel av containeren der vår egen sone ble målt
      fra toppmenyens bunn (`docs/dndkit-plan.md`, risiko 6).

  Liste-draget kjøres av dnd-kit (`docs/drag-and-drop.md`), så det løftede kortet
  merkes med `[data-dnd-dragging]` og plassen holdes av en KLONE — som bærer de
  samme klassene og derfor må filtreres bort når rekkefølgen leses.
*/
const { chromium } = require('playwright');
const G = require('./dnd-gestures.js');

const BASE = process.env.HUSKIS_URL || 'http://localhost:8000';
const VW = 390, VH = 780;

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
  // Mock signUp gir ingen sesjon (simulerer e-postbekreftelse) → logg inn
  await p.getByText('Tilbake til innlogging').click(); await p.waitForTimeout(300);
  await p.locator('#auth-email').fill(email);
  await p.locator('#auth-password').fill('passord123');
  await p.locator('#auth-submit').click();
  // `lastMy` settes først når get_my_doc har svart — da er kontoen innlogget
  // og dokumentet hentet. (En fersk konto har null områder — board er tomt.)
  await p.waitForFunction(() => {
    const H = window.__huskis;
    return H && H.authUser && H.lastMy;
  }, null, { timeout: 10000, polling: 200 });
  // Introduksjonen (docs/introduksjon.md) møter enhver ny konto: omvisningen
  // legger seg over appen, og et gest-tips legger seg nederst på skjermen —
  // ingen av delene er det denne testen handler om.
  await p.evaluate(() => window.__huskis.tour.skipAll());
  await p.waitForTimeout(150);
}

// Én HØY liste øverst + én KORT liste nederst i den aktive mappen.
async function buildScenario(p) {
  await p.evaluate(() => { window.__huskis.addUniverse(); }); await p.waitForTimeout(150);
  await p.keyboard.press('Escape'); await p.waitForTimeout(150);
  await p.evaluate(() => { window.__huskis.addGroup(); }); await p.waitForTimeout(150);
  await p.keyboard.press('Escape'); await p.waitForTimeout(150);
  await p.evaluate(() => {
    const H = window.__huskis, st = H.state;
    const u = st.universes.find((x) => x.id === st.activeUniverse);
    const g = u.groups.find((x) => x.id === st.activeGroup);
    const mk = () => ({ ts: 0, org: 't', pos: 0, posTs: 0, posOrg: 't' });
    const mkI = (t, h, i) => Object.assign({ id: 'it-' + h + '-' + i, text: t, home: h, cat: null, trashed: false, done: false }, mk());
    const mkC = (title, n, pos) => {
      const id = 'card-' + title;
      const c = Object.assign({ id, group: g.id, title, trashed: false, k: true, p: true, labTs: 0, labOrg: 't', items: [] }, mk());
      c.pos = pos;
      for (let i = 0; i < n; i++) { const it = mkI(title + ' ' + i, id, i); it.pos = i; c.items.push(it); }
      return c;
    };
    g.cards = [mkC('Hoy', 30, 0), mkC('Kort', 2, 1)];
    H.render();
  });
  await p.waitForTimeout(300);
}

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: VW, height: VH }, isMobile: true, hasTouch: true });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  const results = [];
  const log = (n, ok, x = '') => { results.push(ok); console.log((ok ? 'PASS' : 'FAIL') + ' — ' + n + (x ? '  [' + x + ']' : '')); };

  await register(p);
  // Instrumenter pointercancel + lostpointercapture
  await p.evaluate(() => {
    window.__ev = { cancel: 0, lost: 0 };
    window.addEventListener('pointercancel', () => window.__ev.cancel++, true);
    document.addEventListener('lostpointercapture', () => window.__ev.lost++, true);
  });
  await buildScenario(p);

  // Scroll helt ned og løft den nederste lista (kollaps + board-vakt).
  await p.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await p.waitForTimeout(150);
  const cardIds = () => p.evaluate(() => [...document.querySelectorAll('#board .card')]
    .filter((c) => !c.hasAttribute('data-dnd-placeholder')).map((c) => c.dataset.id));
  const lastCard = (await cardIds()).pop();
  const R = await G.centre(p, '.card[data-id="' + lastCard + '"] .card-head');
  await G.lift(p, R, true);
  await G.touchMove(p, R.x, R.y - 4); await p.waitForTimeout(60);

  const during = await p.evaluate(() => {
    const bd = document.querySelector('.board');
    const r = bd.getBoundingClientRect();
    return {
      dragging: document.querySelectorAll('#board .card[data-dnd-dragging]').length,
      collapsed: document.querySelectorAll('#board .card.collapsed').length,
      boardDocBottom: Math.round(r.bottom + window.scrollY),
      scrollY: Math.round(window.scrollY),
      scrollHeight: document.scrollingElement.scrollHeight,
    };
  });
  log('touch: draget aktivt', during.dragging === 1, 'dragging=' + during.dragging);
  log('touch: lister kollapser', during.collapsed >= 1, 'collapsed=' + during.collapsed);
  log('board-doc-bunn frøs (>= scrollY)', during.boardDocBottom >= during.scrollY,
    'bottom=' + during.boardDocBottom + ' scrollY=' + during.scrollY);

  // Start en NEDOVER-auto-scroll (fingeren i bunn-sonen).
  await G.touchMove(p, R.x, VH - 16); await p.waitForTimeout(120);

  // Reproduser fortegns-feil-tilstanden: hold DOKUMENTET høyt (ingen native klemme)
  // men gjør BOARD-bunnen kort → board.bottom havner OVER scrollY → maxScroll < scrollY.
  const cond = await p.evaluate(() => {
    const html = document.documentElement, bd = document.querySelector('.board');
    html.style.minHeight = (window.scrollY + 2000) + 'px';
    bd.style.minHeight = '0px';
    const r = bd.getBoundingClientRect();
    const maxScroll = Math.max(0, r.bottom + window.scrollY - window.innerHeight);
    return { scrollY: Math.round(window.scrollY), maxScroll: Math.round(maxScroll), buggy: maxScroll < window.scrollY };
  });
  // Instrumentér scrollY over flere auto-scroll-frames.
  const samples = [];
  for (let i = 0; i < 12; i++) { samples.push(await p.evaluate(() => Math.round(window.scrollY))); await p.waitForTimeout(24); }
  const drops = samples.filter((y) => y < cond.scrollY - 1);
  console.log('  maxScroll=' + cond.maxScroll + ' scrollY=' + cond.scrollY + ' samples=' + JSON.stringify(samples));

  log('testkondisjon gyldig: maxScroll < scrollY', cond.buggy === true, 'maxScroll=' + cond.maxScroll + ' scrollY=' + cond.scrollY);
  log('nedover-frame reduserer ALDRI scrollY', drops.length === 0, 'drops=' + drops.length + ' min=' + Math.min(...samples));

  // pointercancel → rollback (aldri et lagret drop).
  const before = await cardIds();
  await G.touchCancel(p);
  await p.waitForFunction(() => !document.querySelector('[data-dnd-dragging]'), null, { timeout: 5000 });
  await p.waitForTimeout(200);
  const after = {
    order: await cardIds(),
    ...(await p.evaluate(() => ({
      dragging: document.querySelectorAll('.dragging, [data-dnd-dragging]').length,
      ph: document.querySelectorAll('.card-placeholder, .item-placeholder, .group-placeholder, [data-dnd-placeholder]').length,
    }))),
  };
  log('pointercancel: opprydding (ingen dragging/placeholder)', after.dragging === 0 && after.ph === 0, JSON.stringify(after));
  log('pointercancel: rekkefølge uendret', JSON.stringify(after.order) === JSON.stringify(before));

  /* ---- Den ØVRE auto-scroll-sonen rekker UNDER den faste toppmenyen ----
     Vår gamle sone ble målt fra bunnen av toppmenyen, nettopp for at man ikke
     skulle måtte dra lista opp BAK headeren før scrollingen slo inn. dnd-kits
     `AutoScroller` bruker i stedet en brøkdel av containeren, og spørsmålet er
     om den brøkdelen rekker langt nok ned. Måles, ikke antas. */
  // Rydd bort testkondisjonen over (den kunstige dokumenthøyden), ellers ville
  // «bunnen» ligget langt under innholdet.
  await p.evaluate(() => {
    document.documentElement.style.minHeight = '';
    document.querySelector('#board').style.minHeight = '';
  });
  await p.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await p.waitForTimeout(250);
  const lastId = (await cardIds()).pop();
  const grip = await G.centre(p, '.card[data-id="' + lastId + '"] .card-head');
  await G.lift(p, grip, true);
  const zone = await p.evaluate(() => ({
    topbarBottom: Math.round(document.getElementById('topbar').getBoundingClientRect().bottom),
    y: Math.round(window.scrollY),
  }));
  // Rett UNDER toppmenyen — altså det høyeste punktet en finger kan sikte på
  // uten å gjemme lista bak headeren.
  await G.touchMove(p, grip.x, zone.topbarBottom + 12);
  await p.waitForTimeout(450);
  const scrolledUp = await p.evaluate(() => Math.round(window.scrollY));
  log('øvre auto-scroll-sone rekker under toppmenyen', scrolledUp < zone.y - 10,
    'fra=' + zone.y + ' til=' + scrolledUp + ' (toppmenyens bunn=' + zone.topbarBottom + ')');
  await G.touchCancel(p);
  await p.waitForFunction(() => !document.querySelector('[data-dnd-dragging]'), null, { timeout: 5000 });

  log('ingen JS-feil', errs.length === 0, errs.join(' | '));

  await b.close();
  const failed = results.filter((x) => !x).length;
  console.log('\n==== ' + (results.length - failed) + '/' + results.length + ' PASS ====');
  process.exit(failed ? 1 : 0);
})();
