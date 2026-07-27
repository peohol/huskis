/*
  Regresjonstest: toast-designet (gjennomsiktig flate + backdrop-blur) og
  sveip-til-lukk.

  - Flaten er halvgjennomsiktig (alfa < 0.8) og har backdrop-filter med blur.
  - Toasten er interaktiv mens den vises (så den KAN dras) og ikke-interaktiv i
    hvile (klikk-gjennom når den er skjult).
  - Sveip til HØYRE forbi terskelen lukker toasten umiddelbart. For slette-
    toasten betyr det at slettingen committes med en gang (ikke lenger buffret) —
    man slipper å vente på angre-timeren.
  - Kort sveip (under terskelen) spretter tilbake: toasten står, og slettingen er
    fortsatt buffret/angrbar.
  - Venstre-drag flytter ikke toasten; vertikalt drag lukker den ikke.
  - Et fullført sveip som startet oppå «Angre» trykker ikke «Angre».

  Kjør:
    python3 -m http.server 8000                     # fra repo-roten, i egen terminal
    NODE_PATH=$(npm root -g) node tests/toast-swipe.test.js
*/
const { chromium } = require('playwright');

const BASE = process.env.HUSKIS_URL || 'http://localhost:8000';

// Mocken avviser id-er som ikke er UUID-er (som ekte Postgres). Siden en skriving
// som avvises gjentatte ganger nå gir en synlig advarsel-toast, må seed-radene
// bruke ekte UUID-er — ellers ville testen målt vår egen feilmelding.
const CARD = 'aaaaaaaa-0000-4000-8000-00000000000a';
const IT = ['bbbbbbbb-0000-4000-8000-00000000000b',
            'cccccccc-0000-4000-8000-00000000000c',
            'dddddddd-0000-4000-8000-00000000000d'];

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
  await p.locator('#auth-submit').click(); await p.waitForTimeout(1600);
}

async function seed(p) {
  await p.evaluate(() => { window.__huskis.addUniverse(); }); await p.waitForTimeout(150);
  await p.keyboard.press('Escape'); await p.waitForTimeout(150);
  await p.evaluate(() => { window.__huskis.addGroup(); }); await p.waitForTimeout(150);
  await p.keyboard.press('Escape'); await p.waitForTimeout(150);
  await p.evaluate((ids) => {
    const H = window.__huskis, st = H.state;
    const u = st.universes.find((x) => x.id === st.activeUniverse);
    const g = u.groups.find((x) => x.id === st.activeGroup);
    const mk = () => ({ ts: 0, org: 't', pos: 0, posTs: 0, posOrg: 't' });
    const c = Object.assign({ id: ids.CARD, group: g.id, title: 'A', trashed: false, k: true, p: true, labTs: 0, labOrg: 't', items: [] }, mk());
    ['Punkt 1', 'Punkt 2', 'Punkt 3'].forEach((text, i) => {
      c.items.push(Object.assign({ id: ids.IT[i], text, home: ids.CARD, cat: null, trashed: false, done: false }, mk(), { pos: i }));
    });
    g.cards = [c];
    H.render();
  }, { CARD, IT });
  await p.waitForTimeout(300);
}

// Slett et listepunkt (× på raden) → buffret sletting + sticky angre-toast.
async function deleteItem(p, id) {
  await p.locator('.item[data-id="' + id + '"] .item-delete').click();
  await p.waitForTimeout(500); // fly-i-søpla-animasjonen
}

// Tilstanden til ett listepunkt: buffret (angrbar) vs committet (i søpla).
const itemState = (p, id) => p.evaluate(({ iid, cardId }) => {
  const H = window.__huskis, st = H.state;
  const u = st.universes.find((x) => x.id === st.activeUniverse);
  const g = u.groups.find((x) => x.id === st.activeGroup);
  const it = g.cards.find((x) => x.id === cardId).items.find((i) => i.id === iid);
  return { pending: !!it._pendingDelete, trashed: !!it.trashed };
}, { iid: id, cardId: CARD });

const toastInfo = (p) => p.evaluate(() => {
  const t = document.getElementById('toast');
  if (!t) return { exists: false };
  const cs = getComputedStyle(t);
  const r = t.getBoundingClientRect();
  return {
    exists: true, shown: t.classList.contains('show'),
    bg: cs.backgroundColor,
    blur: (cs.backdropFilter || cs.webkitBackdropFilter || ''),
    pe: cs.pointerEvents,
    // Inline-sporene fra sveipet: skal være tomme i hvile (CSS eier plasseringen).
    inline: { transform: t.style.transform, opacity: t.style.opacity },
    cls: t.className,
    x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2),
    left: Math.round(r.left), width: Math.round(r.width),
  };
});

// Syntetisk peker (samme mønster som DnD-testene). pointerdown treffer elementet
// under punktet; move/up går på window, som dra-motoren lytter på.
async function ptr(p, type, x, y, kind) {
  await p.evaluate(([type, x, y, kind]) => {
    const ev = new PointerEvent(type, {
      bubbles: true, cancelable: true, composed: true,
      clientX: x, clientY: y, pointerId: 11, pointerType: kind, button: 0, isPrimary: true,
    });
    (type === 'pointerdown' ? (document.elementFromPoint(x, y) || document.body) : window).dispatchEvent(ev);
  }, [type, x, y, kind]);
}

// Dra fra toastens midtpunkt dx px til høyre (dy valgfri) og slipp.
async function swipe(p, dx, dy, kind, opts) {
  opts = opts || {};
  const t = await toastInfo(p);
  const x = opts.fromX != null ? opts.fromX : t.x;
  const y = opts.fromY != null ? opts.fromY : t.y;
  await ptr(p, 'pointerdown', x, y, kind); await p.waitForTimeout(40);
  for (const f of [0.25, 0.6, 1]) {
    await ptr(p, 'pointermove', Math.round(x + dx * f), Math.round(y + dy * f), kind);
    await p.waitForTimeout(40);
  }
  if (!opts.hold) { await ptr(p, 'pointerup', Math.round(x + dx), Math.round(y + dy), kind); await p.waitForTimeout(350); }
}

const alpha = (rgb) => {
  const m = /rgba?\(([^)]+)\)/.exec(rgb || '');
  if (!m) return 1;
  const parts = m[1].split(',').map((s) => parseFloat(s));
  return parts.length > 3 ? parts[3] : 1;
};

const results = [];
const log = (n, ok, x = '') => { results.push(ok); console.log((ok ? 'PASS' : 'FAIL') + ' — ' + n + (x ? '  [' + x + ']' : '')); };

async function run(label, vp, mobile) {
  const kind = mobile ? 'touch' : 'mouse';
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: vp, isMobile: mobile, hasTouch: mobile });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  console.log('\n== ' + label + ' ==');
  await register(p);
  await seed(p);

  /* ---------- 1) Utseende: gjennomsiktig flate + backdrop-blur ---------- */
  await deleteItem(p, IT[0]);
  let t = await toastInfo(p);
  log(label + ' 1: toasten vises', t.exists && t.shown, JSON.stringify({ shown: t.shown }));
  log(label + ' 1: bakgrunnen er gjennomsiktig (alfa < 0.8)', alpha(t.bg) > 0 && alpha(t.bg) < 0.8, 'bg=' + t.bg);
  log(label + ' 1: backdrop-filter med blur', /blur\(\s*[1-9]/.test(t.blur), 'filter=' + JSON.stringify(t.blur));
  log(label + ' 1: interaktiv mens den vises (kan dras)', t.pe === 'auto', 'pointer-events=' + t.pe);

  /* ---------- 2) Kort sveip (under terskelen) spretter tilbake ---------- */
  const startLeft = t.left;
  await swipe(p, 24, 0, kind);
  t = await toastInfo(p);
  let st = await itemState(p, IT[0]);
  log(label + ' 2: kort sveip → toasten står igjen', t.shown && t.left === startLeft,
    JSON.stringify({ shown: t.shown, left: t.left, start: startLeft }));
  log(label + ' 2: slettingen er fortsatt buffret (angrbar)', st.pending && !st.trashed, JSON.stringify(st));

  /* ---------- 3) Venstre-drag flytter ikke toasten ---------- */
  await swipe(p, -120, 0, kind);
  t = await toastInfo(p);
  log(label + ' 3: venstre-drag → uendret posisjon, fortsatt åpen', t.shown && t.left === startLeft,
    JSON.stringify({ shown: t.shown, left: t.left }));

  /* ---------- 4) Vertikalt drag = scroll, ikke lukking ---------- */
  await swipe(p, 6, 140, kind);
  t = await toastInfo(p);
  log(label + ' 4: vertikalt drag lukker ikke toasten', t.shown && t.left === startLeft,
    JSON.stringify({ shown: t.shown, left: t.left }));

  /* ---------- 5) Draget følger fingeren mens det pågår ---------- */
  await swipe(p, 100, 0, kind, { hold: true });
  const during = await toastInfo(p);
  log(label + ' 5: toasten følger fingeren til høyre under draget', during.left > startLeft + 60,
    'left=' + during.left + ' start=' + startLeft);
  await ptr(p, 'pointerup', during.x + 400, during.y, kind); await p.waitForTimeout(400);

  /* ---------- 6) Fullført sveip lukker OG committer slettingen straks ---------- */
  t = await toastInfo(p);
  st = await itemState(p, IT[0]);
  log(label + ' 6: toasten er lukket etter sveipet', !t.shown, JSON.stringify({ shown: t.shown }));
  log(label + ' 6: slettingen ble committet umiddelbart (i søpla, ikke buffret)',
    st.trashed && !st.pending, JSON.stringify(st));
  log(label + ' 6: sveipe-sporene er ryddet (CSS eier plasseringen igjen)',
    t.inline.transform === '' && t.inline.opacity === '' && !/toast-(dragging|swipe-out)/.test(t.cls),
    JSON.stringify(t.inline) + ' cls=' + t.cls);
  log(label + ' 6: ikke-interaktiv i hvile (klikk-gjennom)', t.pe === 'none', 'pointer-events=' + t.pe);

  /* ---------- 7) Ny toast vises på normal plass etter et sveip ---------- */
  await deleteItem(p, IT[1]);
  t = await toastInfo(p);
  log(label + ' 7: neste toast dukker opp sentrert som før', t.shown && t.left === startLeft,
    JSON.stringify({ shown: t.shown, left: t.left, start: startLeft }));

  /* ---------- 8) Sveip som starter oppå «Angre» trykker ikke «Angre» ---------- */
  const btn = await p.evaluate(() => {
    const r = document.querySelector('#toast .toast-action').getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  });
  await swipe(p, 260, 0, kind, { fromX: btn.x, fromY: btn.y });
  st = await itemState(p, IT[1]);
  t = await toastInfo(p);
  log(label + ' 8: sveip fra «Angre»-knappen lukker og committer (ingen angring)',
    !t.shown && st.trashed && !st.pending, JSON.stringify(st) + ' shown=' + t.shown);

  /* ---------- 9) «Angre» virker fortsatt på et rent klikk ---------- */
  await deleteItem(p, IT[2]);
  await p.locator('#toast .toast-action').click(); await p.waitForTimeout(300);
  st = await itemState(p, IT[2]);
  t = await toastInfo(p);
  log(label + ' 9: klikk på «Angre» gjenoppretter listepunktet', !st.trashed && !st.pending, JSON.stringify(st));
  log(label + ' 9: toasten lukkes av angringen', !t.shown, 'shown=' + t.shown);

  /* ---------- 10) Enkel (ikke-sticky) toast kan også sveipes bort ---------- */
  await p.evaluate(() => { window.__huskis.showToast('Testmelding'); }); await p.waitForTimeout(300);
  await swipe(p, 300, 0, kind);
  t = await toastInfo(p);
  log(label + ' 10: vanlig varsel-toast lukkes av sveip', !t.shown, 'shown=' + t.shown);

  log(label + ': ingen JS-feil', errs.length === 0, errs.join(' | '));
  await p.close();
  await b.close();
}

(async () => {
  await run('desktop', { width: 1200, height: 900 }, false);
  await run('mobil', { width: 390, height: 780 }, true);
  const failed = results.filter((x) => !x).length;
  console.log('\n==== ' + (results.length - failed) + '/' + results.length + ' PASS ====');
  process.exit(failed ? 1 : 0);
})();
