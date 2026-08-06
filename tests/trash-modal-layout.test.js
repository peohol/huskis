/*
  Regresjonstest: layouten i søppelkasse-modalens rader (alle fire nivåene).

  Bakgrunnen er en rapportert feil: på en smal mobilskjerm ble et langt objektnavn
  presset ned til en loddrett søyle på omtrent én bokstav per linje, og resten av
  raden («Gjenopprett»-knappen) ble samtidig dyttet ut av modalens synlige flate.
  Årsaken lå i .trash-row: prikken, metadataen og knappen hadde alle fast bredde,
  navnet fikk resten — og `word-break: break-word` gjorde navnets min-content-
  bredde til ETT tegn, så flex hadde ingen nedre grense å stoppe på.

  Testen måler RENDRET GEOMETRI (bounding boxes + computed styles), ikke
  skjermbilder, i tre viewporter (desktop / mobil / smal mobil) og for alle fire
  søppelkassene:

    1. Navnefeltet har en rimelig minimumsbredde
    2. Et langt navn brytes ikke til ~én bokstav per linje (målt tegn per linje)
    3. Ingen rad går utenfor modalens innvendige bredde
    4. Ingen horisontal scrolling — verken i dokumentet, modalen eller lista
    5. «Gjenopprett» er fullt synlig, klikkbar og minst like stor som på desktop
    6. Ingen to klikkflater i modalen overlapper
    7. Alle fire søppelkassetypene bruker den samme, korrigerte layouten
    8. Desktop: raden ligger fortsatt på ÉN linje (ingen regresjon), og et kort
       navn ser ut som før
    9. Tastaturfokus på «Gjenopprett» har fortsatt en synlig ring
   10. Ingen JS-feil ved åpning, gjenoppretting og lukking — og gjenopprettingen
       virker fortsatt (raden forsvinner, objektet er tilbake i state)

  Innholdsvariantene ligger i fiksturet: kort navn, langt navn med mange ord og
  norske bokstaver, ett svært langt ord uten mellomrom, manglende metadata
  (listepunkter), lang metadata («128 listepunkter» / «Mappekategori»), avskrudd
  gjenopprettingsknapp (et delt område jeg bare er medlem av), rader med og uten
  fargeprikk, og flere rader i hver kasse samtidig.

  Kjør:
    python3 -m http.server 8000
    NODE_PATH=$(npm root -g) node tests/trash-modal-layout.test.js
*/
const { chromium } = require(require('path').join(process.env.NODE_PATH || require('child_process').execSync('npm root -g').toString().trim(), 'playwright'));
const BASE = process.env.HUSKIS_URL || 'http://localhost:8000';

const results = [];
const log = (n, ok, x = '') => { results.push(ok); console.log((ok ? 'PASS' : 'FAIL') + ' — ' + n + (x ? '  [' + x + ']' : '')); };

const U = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
  const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
});

/* Innholdsvariantene. SHORT skal se ut som før; LONG er det som brakk til en
   bokstavsøyle; NOSPACE har ingen mellomrom å bryte på og må brytes midt i
   ordet uten å skyve raden ut i bredden. Begge de lange har norske bokstaver. */
const SHORT = 'Ost';
const LONG = 'Blåbærsyltetøy og røkelaks til søndagsmiddagen hos svigerforeldrene på Åsgårdstrand';
const NOSPACE = 'Blåbærsyltetøyglassoppskriftsamlingsdokumentasjonsvedleggæøå';
const LONGISH = [SHORT, LONG, NOSPACE];

/* Fikstur — uC er innlogget:
     UB   eid av uC, aktivt område
            G1   mappe med lista C1 (som har de slettede listepunktene)
            + tre slettede mapper (én av dem en mappekategori → lang metadata)
            + tre slettede lister i G1 (én med 128 listepunkter → lang metadata)
     tre slettede områder: det med det lange navnet er eid av uA, der er uC bare
     MEDLEM → «Gjenopprett» AVSKRUDD (can_delete_object for et område er
     is_universe_owner). De to andre eier uC selv → aktiv knapp. */
function buildDB() {
  const uA = 'uA', uC = 'uC';
  const ids = { uA, uC, UB: U(), UT: {}, G1: U(),
    GT: {}, CT: {}, IT: {}, C1: U(), I1: U(), FILL: [] };
  const base = (x) => Object.assign({ trashed: false, locked: false, unlocked: false,
    invite_policy: 'inherit', collapsed: false, is_cat: false, cat_id: null,
    ts: 1, org: 'a', pos: 0, pos_ts: 1, pos_org: 'a' }, x);
  const cardRow = (x) => base(Object.assign({ k: true, p: true, lab_ts: 0, lab_org: '' }, x));

  const groups = [base({ id: ids.G1, owner_id: uC, universe_id: ids.UB, name: 'Uke', pos: 0 })];
  const cards = [cardRow({ id: ids.C1, owner_id: uC, group_id: ids.G1, title: 'Liste', pos: 0 })];
  const items = [base({ id: ids.I1, owner_id: uC, card_id: ids.C1, text: 'Punkt', pos: 0 })];

  const universes = [base({ id: ids.UB, owner_id: uC, name: 'Hjem', pos: 0 })];
  const memberships = [{ id: U(), user_id: uC, universe_id: ids.UB, group_id: null, role: 'owner', pos: 0, created_at: 1 }];

  LONGISH.forEach((navn, i) => {
    ids.GT[navn] = U(); ids.CT[navn] = U(); ids.IT[navn] = U(); ids.UT[navn] = U();
    // Området med det LANGE navnet eies av uA; uC er bare medlem der og får
    // en avskrudd «Gjenopprett». De to andre eier uC selv.
    const delt = navn === LONG;
    universes.push(base({ id: ids.UT[navn], owner_id: delt ? uA : uC, name: navn, trashed: true, pos: i + 1 }));
    if (delt) memberships.push({ id: U(), user_id: uA, universe_id: ids.UT[navn], group_id: null, role: 'owner', pos: 0, created_at: 1 });
    memberships.push({ id: U(), user_id: uC, universe_id: ids.UT[navn], group_id: null,
      role: delt ? 'member' : 'owner', pos: i + 1, created_at: 1 });
    // Den midterste slettede mappen er en MAPPEKATEGORI → metadataen blir
    // «Mappekategori» i stedet for «N lister».
    groups.push(base({ id: ids.GT[navn], owner_id: uC, universe_id: ids.UB, name: navn,
      trashed: true, is_cat: i === 1, pos: i + 1 }));
    cards.push(cardRow({ id: ids.CT[navn], owner_id: uC, group_id: ids.G1, title: navn,
      trashed: true, pos: i + 1 }));
    items.push(base({ id: ids.IT[navn], owner_id: uC, card_id: ids.C1, text: navn,
      trashed: true, pos: i + 1 }));
  });
  // Lang metadata i lister-kassen: 128 levende listepunkter i den slettede lista
  // gir «128 listepunkter» — den lengste metadata-strengen appen kan lage.
  for (let i = 0; i < 128; i++) {
    const id = U(); ids.FILL.push(id);
    items.push(base({ id, owner_id: uC, card_id: ids.CT[LONG], text: 'F' + i, pos: i }));
  }

  return { ids, db: {
    _rolesBackfilled: true,
    profiles: [
      { id: uA, email: 'a@x.no', display_name: 'Alice Eier', user_metadata: {} },
      { id: uC, email: 'c@x.no', display_name: 'Cato Medlem', user_metadata: {} },
    ],
    passwords: { 'a@x.no': 'x', 'c@x.no': 'x' },
    universes, groups, cards, items, memberships,
    share_invites: [], tombstones: [],
  } };
}

async function loadAs(page, db, viewport) {
  await page.setViewportSize(viewport);
  await page.goto(BASE + '/?mock=1');
  await page.evaluate((db) => {
    localStorage.clear(); sessionStorage.clear();
    localStorage.setItem('hk-mock-db', JSON.stringify(db));
    // Kontoen har sett HELE introduksjonen (docs/introduksjon.md): verken
    // omvisningen eller et gest-tips skal legge seg over det som måles.
    sessionStorage.setItem('hk-mock-session', JSON.stringify({ id: 'uC', email: 'c@x.no',
      user_metadata: { onboarding: { v: 3, status: 'done' }, tips: { drag: true, trash: true, moveList: true } } }));
  }, db);
  await page.goto(BASE + '/?mock=1');
  await page.waitForFunction(() => {
    const H = window.__huskis;
    return H && H.authUser && H.lastMy && H.state.universes.length > 0;
  }, null, { timeout: 15000, polling: 200 });
}

/* Modalen åpnes med `pop-in` (translate + scale 0.98). Måler man midt i den, er
   ALLE tallene skalerte — vent på at animasjonene i modalen er ferdige. */
const settled = (p) => p.waitForFunction(() => {
  const m = document.querySelector('#trash-modal .modal');
  return m && !document.getElementById('trash-modal').hidden
    && m.getAnimations({ subtree: true }).every((a) => a.playState === 'finished');
}, null, { timeout: 8000, polling: 100 });

async function openTrash(p, kind, ids) {
  if (kind === 'lister') {
    await p.click('#trash-btn');
  } else if (kind === 'listepunkter') {
    await p.click('.card[data-id="' + ids.C1 + '"] .item-trash-btn');
  } else {
    await p.evaluate(() => window.__huskis.openNavModal());
    await p.waitForSelector('#nav-modal:not([hidden])');
    if (kind === 'områder') await p.click('#uni-trash-btn');
    else await p.click('#nav-board .card[data-id="' + ids.UB + '"] .group-trash-btn');
  }
  await settled(p);
}

async function closeTrash(p, kind) {
  await p.click('#trash-close');
  await p.waitForFunction(() => document.getElementById('trash-modal').hidden, null, { timeout: 8000, polling: 100 });
  if (kind === 'områder' || kind === 'mapper') {
    await p.evaluate(() => window.__huskis.closeNavModal());
    await p.waitForFunction(() => document.getElementById('nav-modal').hidden, null, { timeout: 8000, polling: 100 });
  }
}

/* All geometrien i ett kall. Linjene i navnet telles med Range.getClientRects():
   én rect per linjeboks, altså det faktiske antallet tekstlinjer — mye mer
   presist enn å dele høyden på en antatt line-height.

   MERK om vertikal retning: `#trash-list` scroller (modalen er `max-height:
   82vh`), så en rad kan ligge under folden. Vertikale påstander måles derfor
   ikke mot modalflaten — de ville bare målt at lista har flere rader enn den
   viser samtidig. Feilen denne testen vokter er horisontal. */
const snapshot = (p) => p.evaluate(() => {
  const box = (el) => { const r = el.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; };
  const list = document.getElementById('trash-list');
  const lr = list.getBoundingClientRect();
  const cs = getComputedStyle(list);
  const inner = { l: lr.left + parseFloat(cs.paddingLeft), r: lr.right - parseFloat(cs.paddingRight) };
  const modal = document.querySelector('#trash-modal .modal');
  const rowEls = [...document.querySelectorAll('#trash-list .trash-row')];
  return {
    modal: box(modal),
    inner,
    listVisible: { l: lr.left, t: lr.top, r: lr.right, b: lr.bottom },
    scrollX: {
      doc: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      body: document.body.scrollWidth > document.body.clientWidth + 1,
      list: list.scrollWidth > list.clientWidth + 1,
      // Radene selv skal aldri ha noe å scrolle bort i bredden.
      rows: rowEls.some((r) => r.scrollWidth > r.clientWidth + 1),
    },
    // Knappene utenfor lista (✕ i hodet, «Slett … for godt» i foten) ligger i et
    // ANNET scroll-rom enn radene, og sammenlignes derfor mot radenes SYNLIGE
    // (klippede) flate — ikke mot en rad som er scrollet ut av syne.
    outerBtns: [...document.querySelectorAll('#trash-modal button')]
      .filter((b) => !b.closest('.trash-row'))
      .map((b) => ({ box: box(b), what: b.id || b.textContent.trim().slice(0, 14) })),
    rows: rowEls.map((row) => {
      const nameEl = row.querySelector('.trash-name');
      const metaEl = row.querySelector('.trash-meta');
      const dotEl = row.querySelector('.trash-dot');
      const btn = row.querySelector('button');
      // Navneblokka. Uten .trash-main (koden før denne rettelsen) er den unionen
      // av navn + metadata, slik at påstandene under gir lesbare tall i stedet
      // for å krasje på en manglende node.
      const mainEl = row.querySelector('.trash-main');
      const parts = [nameEl, metaEl].filter(Boolean).map((e) => e.getBoundingClientRect());
      const main = mainEl ? box(mainEl) : {
        l: Math.min(...parts.map((r) => r.left)), t: Math.min(...parts.map((r) => r.top)),
        r: Math.max(...parts.map((r) => r.right)), b: Math.max(...parts.map((r) => r.bottom)),
        w: 0, h: 0,
      };
      const rng = document.createRange();
      rng.selectNodeContents(nameEl);
      const lines = [...rng.getClientRects()].filter((r) => r.width > 0.5 && r.height > 0.5).length;
      return {
        text: nameEl.textContent,
        chars: nameEl.textContent.length,
        lines,
        hasDot: !!dotEl,
        row: box(row),
        rowPad: parseFloat(getComputedStyle(row).paddingLeft),
        main,
        name: box(nameEl),
        meta: metaEl ? box(metaEl) : null,
        metaText: metaEl ? metaEl.textContent : null,
        btn: box(btn),
        btnDisabled: btn.disabled,
        btnLabel: btn.getAttribute('aria-label'),
      };
    }),
  };
});

/* Treffbarhet må måles på en rad som FAKTISK er synlig: `elementFromPoint` på et
   punkt utenfor scroll-klippet svarer med det som ligger der, ikke med knappen.
   Hver rad rulles derfor inn i midten av lista før den treffpunkt-testes. */
const hitTest = (p) => p.evaluate(async () => {
  const rows = [...document.querySelectorAll('#trash-list .trash-row')];
  const out = [];
  for (const row of rows) {
    row.scrollIntoView({ block: 'center', behavior: 'instant' });
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const btn = row.querySelector('button');
    const b = btn.getBoundingClientRect();
    const hit = document.elementFromPoint((b.left + b.right) / 2, (b.top + b.bottom) / 2);
    out.push({
      name: row.querySelector('.trash-name').textContent.slice(0, 12),
      ok: !!(hit && (hit === btn || btn.contains(hit))),
      got: hit ? (hit.tagName.toLowerCase() + '.' + (hit.className || '')).slice(0, 24) : 'null',
    });
  }
  document.getElementById('trash-list').scrollTop = 0;
  return out;
});

const overlap = (a, b) => a.l < b.r - 0.5 && b.l < a.r - 0.5 && a.t < b.b - 0.5 && b.t < a.b - 0.5;
/* Snittet mellom en flate og det scroll-vinduet som klipper den — null hvis
   flaten er rullet helt ut av syne (da er den ingen klikkflate). */
const clip = (a, w) => {
  const r = { l: Math.max(a.l, w.l), t: Math.max(a.t, w.t), r: Math.min(a.r, w.r), b: Math.min(a.b, w.b) };
  return (r.r - r.l > 0.5 && r.b - r.t > 0.5) ? r : null;
};

/* Absolutt gulv for navnebredden. Rundt 150 px er ~11 tegn på --fs-base/600 —
   godt over «én bokstav», og godt under det smaleste vi faktisk måler (~199 px
   på 320 px viewport). Feilen ga 20 px. */
const NAME_MIN = 150;
/* Minste akseptable snitt for tegn per linje i et langt navn. Feilen ga ~1,3. */
const CHARS_PER_LINE_MIN = 8;

function checkModal(label, kind, snap, hits, desktop, btnFloor) {
  const tag = label + ' / ' + kind;
  const rows = snap.rows;

  log(tag + ': tre rader rendres', rows.length === 3, 'rader=' + rows.length);

  // 1 — navnefeltet har en rimelig minimumsbredde
  const narrow = rows.filter((r) => r.name.w < NAME_MIN);
  log(tag + ' 1: navnefeltet er minst ' + NAME_MIN + ' px bredt', narrow.length === 0,
    'bredder=' + rows.map((r) => Math.round(r.name.w)).join('/'));

  // 2 — et langt navn brytes ikke til ~én bokstav per linje. Gjelder kun de
  //     lange variantene; et navn på tre bokstaver kan ikke ha åtte per linje.
  const long = rows.filter((r) => r.chars >= 20);
  const dense = long.filter((r) => r.chars / Math.max(1, r.lines) < CHARS_PER_LINE_MIN);
  log(tag + ' 2: minst ' + CHARS_PER_LINE_MIN + ' tegn per linje i lange navn',
    long.length >= 2 && dense.length === 0,
    long.map((r) => r.chars + 't/' + r.lines + 'l=' + (r.chars / Math.max(1, r.lines)).toFixed(1)).join(' '));

  // 3 — ingen rad går utenfor modalens innvendige bredde
  const wide = rows.filter((r) => r.row.l < snap.inner.l - 0.5 || r.row.r > snap.inner.r + 0.5);
  log(tag + ' 3: ingen rad er bredere enn modalens innside', wide.length === 0,
    'innside=' + Math.round(snap.inner.l) + '..' + Math.round(snap.inner.r)
    + ' rader=' + rows.map((r) => Math.round(r.row.l) + '..' + Math.round(r.row.r)).join(' '));
  // …og heller ikke noe INNI raden (navn/metadata/knapp) stikker utenfor.
  const spill = rows.filter((r) => [r.name, r.meta, r.btn].filter(Boolean)
    .some((b) => b.l < r.row.l + r.rowPad - 0.5 || b.r > r.row.r - r.rowPad + 0.5));
  log(tag + ' 3b: navn, metadata og knapp holder seg innenfor raden', spill.length === 0,
    rows.map((r) => 'navn' + Math.round(r.name.r) + '/knapp' + Math.round(r.btn.r) + ' i ' + Math.round(r.row.r)).join(' '));

  // 4 — ingen horisontal scrolling: verken i dokumentet, i søppel-lista eller i
  //     radene selv. (`.modal` måles IKKE her: tøm-knappen i foten er `nowrap`
  //     og bredere enn en 320 px modal allerede før denne runden — en egen,
  //     eksisterende sak i bunnseksjonen, ikke i radene.)
  const sx = snap.scrollX;
  log(tag + ' 4: ingen horisontal scrolling', !sx.doc && !sx.body && !sx.list && !sx.rows, JSON.stringify(sx));

  // 5 — knappen er fullt synlig i bredden, klikkbar og ikke mindre enn på desktop
  const outside = rows.filter((r) => r.btn.l < snap.inner.l - 0.5 || r.btn.r > snap.inner.r + 0.5);
  log(tag + ' 5a: knappen ligger innenfor modalens innside', outside.length === 0,
    'innside=' + Math.round(snap.inner.l) + '..' + Math.round(snap.inner.r)
    + ' knapper=' + rows.map((r) => Math.round(r.btn.l) + '..' + Math.round(r.btn.r)).join(' '));
  log(tag + ' 5b: knappen treffes på sitt eget midtpunkt', hits.every((h) => h.ok),
    hits.map((h) => h.name + '=' + (h.ok ? 'ok' : h.got)).join(' '));
  const small = rows.filter((r) => r.btn.w < btnFloor.w - 0.5 || r.btn.h < btnFloor.h - 0.5);
  log(tag + ' 5c: berøringsflaten er minst like stor som på desktop ('
    + Math.round(btnFloor.w) + '×' + Math.round(btnFloor.h) + ')', small.length === 0,
    rows.map((r) => Math.round(r.btn.w) + '×' + Math.round(r.btn.h)).join(' '));

  // 6 — ingen to klikkflater overlapper. Radenes knapper sammenlignes med
  //     hverandre i sitt eget scroll-rom; mot ✕ og tøm-knappen brukes radens
  //     SYNLIGE flate (klippet mot lista), siden de ligger utenfor scrollen.
  const clash = [];
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      if (overlap(rows[i].btn, rows[j].btn)) clash.push('rad' + i + '×rad' + j);
    }
    const vis = clip(rows[i].btn, snap.listVisible);
    if (!vis) continue;
    snap.outerBtns.forEach((o) => { if (overlap(vis, o.box)) clash.push('rad' + i + '×' + o.what); });
  }
  log(tag + ' 6: ingen klikkflater overlapper (' + (rows.length + snap.outerBtns.length) + ' knapper)',
    clash.length === 0, clash.join(', '));

  // 8 — desktop skal ligge på ÉN linje (knappen til HØYRE for navneblokka);
  //     smal skjerm gir knappen sin egen linje UNDER den.
  if (desktop) {
    const wrapped = rows.filter((r) => r.btn.l < r.main.r - 0.5);
    log(tag + ' 8a: desktop holder raden på én linje', wrapped.length === 0,
      rows.map((r) => 'navneblokk→' + Math.round(r.main.r) + ' knapp→' + Math.round(r.btn.l)).join(' '));
    const shortRow = rows.find((r) => r.text === SHORT);
    if (shortRow) {
      log(tag + ' 8b: kort navn er fortsatt én tekstlinje i en lav rad',
        shortRow.lines === 1 && shortRow.row.h <= 80,
        'linjer=' + shortRow.lines + ' radhøyde=' + Math.round(shortRow.row.h));
    }
  } else {
    const inline = rows.filter((r) => r.btn.t < r.main.b - 0.5);
    log(tag + ' 8c: smal skjerm gir knappen sin egen linje under navnet', inline.length === 0,
      rows.map((r) => 'navneblokk↓' + Math.round(r.main.b) + ' knapp↓' + Math.round(r.btn.t)).join(' '));
    // Knappen skal fortsatt ligge til høyre, ikke midtstilt eller venstrestilt.
    const notRight = rows.filter((r) => Math.abs(r.btn.r - (r.row.r - r.rowPad)) > 1.5);
    log(tag + ' 8d: knappen er høyrestilt på sin egen linje', notRight.length === 0,
      rows.map((r) => Math.round(r.btn.r) + ' vs ' + Math.round(r.row.r - r.rowPad)).join(' '));
  }
}

async function run(browser, label, viewport, mobile, ids, db) {
  const ctx = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(String(e.message || e)));

  await loadAs(p, db, viewport);
  const desktop = !mobile;

  // Gulvet for berøringsflaten: knappens størrelse på desktop, målt i samme
  // runde. Ingen viewport får gi en mindre knapp enn den.
  await openTrash(p, 'lister', ids);
  const first = await snapshot(p);
  const btnFloor = { w: 130, h: 34 };
  if (first.rows.length) { btnFloor.w = Math.min(btnFloor.w, first.rows[0].btn.w); btnFloor.h = Math.min(btnFloor.h, first.rows[0].btn.h); }
  await closeTrash(p, 'lister');

  // 7 — alle fire søppelkassetypene måles med de samme kravene
  const snaps = {};
  for (const kind of ['områder', 'mapper', 'lister', 'listepunkter']) {
    await openTrash(p, kind, ids);
    snaps[kind] = await snapshot(p);
    const hits = await hitTest(p);
    await closeTrash(p, kind);
    checkModal(label, kind, snaps[kind], hits, desktop, btnFloor);
  }
  log(label + ' 7: alle fire søppelkassene rendret rader',
    Object.values(snaps).every((s) => s.rows.length === 3),
    Object.keys(snaps).map((k) => k + '=' + snaps[k].rows.length).join(' '));

  // Innholdsvariantene som ikke er navn: prikk, metadata og avskrudd knapp.
  const dots = { områder: true, lister: true, mapper: false, listepunkter: false };
  log(label + ': fargeprikk kun der objektet har farge',
    Object.keys(dots).every((k) => snaps[k].rows.every((r) => r.hasDot === dots[k])),
    Object.keys(dots).map((k) => k + '=' + snaps[k].rows.map((r) => (r.hasDot ? '●' : '–')).join('')).join(' '));
  log(label + ': listepunkter har ingen metadata (og bryter ikke av det)',
    snaps.listepunkter.rows.every((r) => r.meta === null),
    JSON.stringify(snaps.listepunkter.rows.map((r) => r.metaText)));
  const longMeta = snaps.lister.rows.map((r) => r.metaText).concat(snaps.mapper.rows.map((r) => r.metaText));
  log(label + ': lang metadata finnes i fiksturet og holdt seg i raden',
    longMeta.includes('128 listepunkter') && longMeta.includes('Mappekategori'),
    JSON.stringify(longMeta));
  const uni = snaps.områder.rows;
  log(label + ': avskrudd «Gjenopprett» finnes, og har samme geometri som en aktiv',
    uni.some((r) => r.btnDisabled) && uni.some((r) => !r.btnDisabled)
      && new Set(uni.map((r) => Math.round(r.btn.w) + 'x' + Math.round(r.btn.h))).size === 1,
    uni.map((r) => (r.btnDisabled ? 'av' : 'på') + Math.round(r.btn.w) + 'x' + Math.round(r.btn.h)).join(' '));
  // Skjermlesernavnet skal være uendret: «Gjenopprett «X»» (+ grunn når avskrudd).
  log(label + ': aria-label på «Gjenopprett» er bevart',
    uni.every((r) => r.btnLabel && r.btnLabel.startsWith('Gjenopprett «' + r.text + '»'))
      && uni.filter((r) => r.btnDisabled).every((r) => /låst/.test(r.btnLabel)),
    JSON.stringify(uni.map((r) => r.btnLabel && r.btnLabel.slice(0, 40))));

  // 9 — tastaturfokus på «Gjenopprett» har fortsatt en synlig ring.
  // Fokus MÅ settes med ekte Tab: `:focus-visible` slår ikke inn på .focus().
  await openTrash(p, 'lister', ids);
  let ring = null;
  for (let i = 0; i < 12 && !ring; i++) {
    await p.keyboard.press('Tab');
    ring = await p.evaluate(() => {
      const el = document.activeElement;
      if (!el || !el.closest('.trash-row') || !el.matches(':focus-visible')) return null;
      const cs = getComputedStyle(el);
      return { style: cs.outlineStyle, width: parseFloat(cs.outlineWidth) || 0, color: cs.outlineColor,
        label: el.getAttribute('aria-label') };
    });
  }
  log(label + ' 9: tastaturfokus på «Gjenopprett» gir en synlig ring',
    !!ring && ring.style !== 'none' && ring.width > 0, JSON.stringify(ring));

  // 10 — gjenoppretting virker fortsatt, og lukking gir ingen JS-feil.
  const before = await p.evaluate(() => document.querySelectorAll('#trash-list .trash-row').length);
  const restored = await p.evaluate((navn) => {
    const row = [...document.querySelectorAll('#trash-list .trash-row')]
      .find((r) => r.querySelector('.trash-name').textContent === navn);
    if (!row) return null;
    const b = row.querySelector('button');
    if (b.disabled) return null;
    b.click();
    return navn;
  }, LONG);
  const after = await p.evaluate((navn) => ({
    rows: document.querySelectorAll('#trash-list .trash-row').length,
    live: window.__huskis.state.universes.flatMap((u) => u.groups).flatMap((g) => g.cards)
      .some((c) => c.title === navn && !c.trashed && !c._pendingDelete),
  }), LONG);
  log(label + ' 10a: «Gjenopprett» fjerner raden og henter lista tilbake',
    restored === LONG && after.rows === before - 1 && after.live,
    'før=' + before + ' etter=' + after.rows + ' levende=' + after.live);
  await closeTrash(p, 'lister');

  log(label + ' 10b: ingen JS-feil ved åpning, gjenoppretting og lukking',
    errors.length === 0, errors.join(' | '));

  await ctx.close();
}

(async () => {
  const browser = await chromium.launch();
  try {
    // Fiksturet bygges én gang og lastes ferskt i hver viewport.
    const { ids, db } = buildDB();
    await run(browser, 'desktop', { width: 1200, height: 900 }, false, ids, db);
    await run(browser, 'mobil', { width: 390, height: 780 }, true, ids, db);
    await run(browser, 'smal', { width: 320, height: 700 }, true, ids, db);
  } catch (e) {
    log('uventet feil', false, String(e && e.stack || e));
  }
  await browser.close();
  const ok = results.filter(Boolean).length;
  console.log('==== ' + ok + '/' + results.length + ' PASS ====');
  process.exit(ok === results.length ? 0 : 1);
})();
