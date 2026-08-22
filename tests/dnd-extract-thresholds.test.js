/*
  Regresjonstest: 1/3-tersklene for ny-liste-placeholderen (ekstrahering), og at
  et listepunkt dratt UT av en kategori forblir synlig.

  (A) Terskler (dragOverCard i app.js): hvilken liste det løftede objektet «er i»
      avgjøres av OBJEKTETS boks, ikke pekeren, og av listas INNHOLDSSONE
      (midt i tittelraden … midt i +-knapperaden), ikke kortets ytterkanter — de
      samme linjene både inn og ut:
      - Ved TITTELEN: objektets øvre 1/3 passerer tittelradens midtlinje (ned =
        inn, opp = ut).
      - Ved KNAPPENE: objektets nedre 1/3 passerer knapperadens midtlinje (opp =
        inn, ned = ut).
      Halve rammeraden er slark hver vei, så FØRSTE og SISTE plass i lista er like
      lett å treffe som plassene mellom radene.
      Dvs. objektet er i lista når dets midtre 1/3 ligger innenfor sonen.
      Symmetrisk begge veier (før dukket placeholderen opp mye lettere oppover enn
      nedover), og uten flimring i overgangen. Gjelder både énkolonne (mobil) og
      flerkolonne (desktop). En TOM liste har ingen sone å sikte på — der gjelder
      hele kortet (som for en kollapset liste).

  (B) Et listepunkt dratt ut av en kategori til nivå 1 i SAMME liste ble usynlig:
      skillelinje-forhåndsvisningen ga kategorien `position: relative`, og siden
      kategorien er FORFAR til det løftede (absolutt posisjonerte) listepunktet ble
      den containing block for det → koordinatene tolket relativt til kategorien,
      og kortets `overflow: hidden` klippet det bort. Linja males nå fra raden over
      (`.sep-below`).

  Gestene er EKTE input (`tests/dnd-gestures.js`).

  Kjør:
    python3 -m http.server 8000                     # fra repo-roten, i egen terminal
    NODE_PATH=$(npm root -g) node tests/dnd-extract-thresholds.test.js
*/
const { chromium } = require('playwright');
const G = require('./dnd-gestures.js');

const BASE = process.env.HUSKIS_URL || 'http://localhost:8000';

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

// n lister med 2 listepunkter hver. `withCat` gir liste A en kategori med to
// medlemmer (for (B)-testen).
async function seed(p, n, withCat, sizes) {
  if (sizes) await p.evaluate((s) => { window.__seedSizes = s; }, sizes);
  await p.evaluate(() => { window.__huskis.addUniverse(); }); await p.waitForTimeout(150);
  await p.keyboard.press('Escape'); await p.waitForTimeout(150);
  await p.evaluate(() => { window.__huskis.addGroup(); }); await p.waitForTimeout(150);
  await p.keyboard.press('Escape'); await p.waitForTimeout(150);
  await p.evaluate(({ n, withCat }) => {
    const H = window.__huskis, st = H.state;
    const u = st.universes.find((x) => x.id === st.activeUniverse);
    const g = u.groups.find((x) => x.id === st.activeGroup);
    const mk = () => ({ ts: 0, org: 't', pos: 0, posTs: 0, posOrg: 't' });
    const mkI = (id, t, h, extra) => Object.assign({ id, text: t, home: h, cat: null, isCat: false, trashed: false, done: false, collapsed: false }, mk(), extra || {});
    const mkCard = (id, title, pos) => Object.assign({ id, group: g.id, title, trashed: false, k: true, p: true, labTs: 0, labOrg: 't', collapsed: false, items: [] }, mk(), { pos });
    g.cards = [];
    for (let i = 0; i < n; i++) {
      const id = 'card-' + i;
      const c = mkCard(id, 'Liste ' + i, i);
      // `sizes` (valgfri) gir antall listepunkter per liste — 0 = tom liste.
      const count = window.__seedSizes ? window.__seedSizes[i] : 2;
      if (count > 0) c.items.push(mkI(id + '-a', 'Punkt A', id, { pos: 0 }));
      if (count > 1) c.items.push(mkI(id + '-b', 'Punkt B', id, { pos: 1 }));
      if (withCat && i === 0) {
        c.items.push(mkI('cat-1', 'Kategori', id, { isCat: true, pos: 2 }));
        c.items.push(mkI('m-1', 'Medlem 1', id, { cat: 'cat-1', pos: 0 }));
        c.items.push(mkI('m-2', 'Medlem 2', id, { cat: 'cat-1', pos: 1 }));
      }
      g.cards.push(c);
    }
    H.render();
  }, { n, withCat });
  await p.waitForTimeout(300);
}

// Ekte pekerinput, i den steg-for-steg-formen denne fila er skrevet rundt.
// Sekvensene under er uendret; det er leveringen som er ekte nå.
const ptr = (p, type, x, y, kind) => G.sendPointer(p, type, x, y, kind);

const centerOf = (p, sel) => p.evaluate((sel) => {
  const el = document.querySelector(sel); if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
}, sel);

// Alt vi måler i én runde. Dra-boksen leses fra style.left/top/width/height
// (layout-boksen som treffdeteksjonen bruker — getBoundingClientRect ville
// inkludert dra-skala/rotasjon).
const probe = (p) => p.evaluate(() => {
  const d = document.querySelector('.item.dragging, .category.dragging');
  const box = (el) => { const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right }; };
  const cards = {};
  document.querySelectorAll('.card').forEach((c) => {
    cards[c.dataset.id] = {
      rect: box(c),
      head: box(c.querySelector('.card-head')),
      add: c.querySelector('.add-item-row') ? box(c.querySelector('.add-item-row')) : null,
    };
  });
  const ph = document.querySelector('.item-placeholder, .card-placeholder');
  const dTop = d ? parseFloat(d.style.top) - window.scrollY : null;
  const dH = d ? parseFloat(d.style.height) : null;
  return {
    dragging: !!d,
    drag: d ? { top: dTop, bottom: dTop + dH, height: dH } : null,
    mode: document.querySelector('.new-list-placeholder') ? 'extract' : (ph ? 'reorder' : 'none'),
    phCard: ph && ph.closest('.card') ? ph.closest('.card').dataset.id : null,
    cards,
  };
});

// Nedre referanselinje: MIDT i +-knapperaden (slark, se cardBand i app.js).
const addLine = (c) => (c.add.top + c.add.bottom) / 2;
// Øvre referanselinje: MIDT i tittelraden (samme slark, se cardBand i app.js).
const headLine = (c) => (c.head.top + c.head.bottom) / 2;

const results = [];
const log = (n, ok, x = '') => { results.push(ok); console.log((ok ? 'PASS' : 'FAIL') + ' — ' + n + (x ? '  [' + x + ']' : '')); };

// Løft et listepunkt (touch-hold) og før pekeren i `step`-piksler til `steps`
// prøver er tatt. Returnerer prøvene (mode + geometri før hver bevegelse).
async function liftItem(p, sel, kind) {
  const z = await centerOf(p, sel);
  await ptr(p, 'pointerdown', z.x, z.y, kind);
  if (kind === 'mouse') await ptr(p, 'pointermove', z.x, z.y + 12, kind);
  else { await p.waitForTimeout(250); await ptr(p, 'pointermove', z.x, z.y + 4, kind); }
  await p.waitForTimeout(80);
  return z;
}

async function sweep(p, x, fromY, step, count, kind) {
  const samples = [];
  for (let i = 0; i < count; i++) {
    const y = fromY + step * i;
    await ptr(p, 'pointermove', x, y, kind);
    await p.waitForTimeout(45);
    const s = await probe(p);
    s.y = y;
    samples.push(s);
  }
  return samples;
}

// Første prøve der modus ble `mode` (evt. i kortet `card`), med prøven FØR den
// (geometrien terskelen ble målt mot — et modusbytte flytter placeholderen og
// dermed kortenes høyde/plassering).
// Modus-sekvensen (uten gjentakelser) frem til og med første `stopAt`.
function modeSeq(samples, stopAt) {
  const seq = [];
  for (const s of samples) {
    const v = s.mode + ':' + (s.phCard || '-');
    if (seq[seq.length - 1] !== v) seq.push(v);
    if (v === stopAt) break;
  }
  return seq;
}
function firstWhere(samples, pred) {
  for (let i = 1; i < samples.length; i++) if (pred(samples[i]) && !pred(samples[i - 1])) return { at: samples[i], before: samples[i - 1] };
  return null;
}

(async () => {
  const b = await chromium.launch();

  /* ============ A) Mobil (énkolonne): symmetriske ut-terskler ============ */
  const mobil = { width: 390, height: 900 };
  let downOvershoot = null, upOvershoot = null;
  {
    const p = await b.newPage({ viewport: mobil, hasTouch: true });
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await register(p); await seed(p, 2);
    const base = await probe(p);
    log('0 forutsetning: siden scroller ikke (auto-scroll er da en no-op)',
      await p.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight + 1),
      'h=' + (await p.evaluate(() => document.documentElement.scrollHeight)));

    // NEDOVER ut av liste 0 (øverst).
    const z = await liftItem(p, '.item[data-id="card-0-b"]', 'touch');
    const s = await sweep(p, z.x, z.y + 4, 6, 26, 'touch');
    const hit = firstWhere(s, (x) => x.mode === 'extract');
    if (hit) {
      const h = hit.at.drag.height;
      // «nedre 1/3 har passert +-knappenes øvre kant» = (bunn − h/3) > knapperaden
      downOvershoot = (hit.at.drag.bottom - h / 3) - addLine(hit.before.cards['card-0']);
      // Pekeren skal fortsatt være innenfor kildekortet på det tidspunktet —
      // det var umulig med den gamle, pekerbaserte regelen.
      log('A1 nedover: extract slår inn MENS pekeren ennå er over kildelista',
        hit.at.y <= hit.before.cards['card-0'].rect.bottom,
        'peker=' + Math.round(hit.at.y) + ' kortbunn=' + Math.round(hit.before.cards['card-0'].rect.bottom));
    } else log('A1 nedover: extract slo inn i det hele tatt', false, JSON.stringify(s.map((x) => x.mode)));
    await ptr(p, 'pointercancel', z.x, z.y, 'touch'); await p.waitForTimeout(200);

    // OPPOVER ut av liste 1 (nederst).
    const z2 = await liftItem(p, '.item[data-id="card-1-a"]', 'touch');
    const s2 = await sweep(p, z2.x, z2.y - 4, -6, 26, 'touch');
    const hit2 = firstWhere(s2, (x) => x.mode === 'extract');
    if (hit2) {
      const h = hit2.at.drag.height;
      // «øvre 1/3 har passert listetittelens nedre kant» = (topp + h/3) < tittelbunn
      upOvershoot = headLine(hit2.before.cards['card-1']) - (hit2.at.drag.top + h / 3);
      log('A2 oppover: extract slår inn MENS pekeren ennå er over kildelista',
        hit2.at.y >= hit2.before.cards['card-1'].rect.top,
        'peker=' + Math.round(hit2.at.y) + ' korttopp=' + Math.round(hit2.before.cards['card-1'].rect.top));
    } else log('A2 oppover: extract slo inn i det hele tatt', false, JSON.stringify(s2.map((x) => x.mode)));
    await ptr(p, 'pointercancel', z2.x, z2.y, 'touch'); await p.waitForTimeout(200);

    const sym = downOvershoot != null && upOvershoot != null && Math.abs(downOvershoot - upOvershoot) <= 8;
    log('A3 SYMMETRI: like langt forbi sonen opp som ned (≤ 8 px forskjell)', sym,
      'ned=' + (downOvershoot == null ? '-' : downOvershoot.toFixed(1)) + ' opp=' + (upOvershoot == null ? '-' : upOvershoot.toFixed(1)));
    log('A4 terskelen treffer 1/3-linja (0..steglengde forbi sonen)',
      downOvershoot != null && downOvershoot >= 0 && downOvershoot <= 8 &&
      upOvershoot != null && upOvershoot >= 0 && upOvershoot <= 8,
      'ned=' + (downOvershoot == null ? '-' : downOvershoot.toFixed(1)) + ' opp=' + (upOvershoot == null ? '-' : upOvershoot.toFixed(1)));
    log('A ingen JS-feil', errs.length === 0, errs.join(' | '));
    await p.close();
    void base;
  }

  /* ============ B) Mobil: inn i neste liste + ingen flimring ============ */
  {
    const p = await b.newPage({ viewport: mobil, hasTouch: true });
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await register(p); await seed(p, 2);

    // Hele veien fra liste 0 ned i liste 1, i små steg.
    const z = await liftItem(p, '.item[data-id="card-0-b"]', 'touch');
    const s = await sweep(p, z.x, z.y + 4, 6, 60, 'touch');
    const inNext = firstWhere(s, (x) => x.mode === 'reorder' && x.phCard === 'card-1');
    if (inNext) {
      const h = inNext.at.drag.height;
      // «øvre 1/3 har passert nedre kant av listetittelen» (samme linje som ut-
      // terskelen oppover — det er midtre 1/3 som skal ligge innenfor sonen)
      const over = (inNext.at.drag.top + h / 3) - headLine(inNext.before.cards['card-1']);
      log('B1 inn i neste liste nedover: øvre 1/3 har akkurat passert tittelradens midtlinje',
        over >= 0 && over <= 8, 'forbi tittelmidten=' + over.toFixed(1));
    } else log('B1 inn i neste liste nedover: placeholderen havnet i liste 1', false, JSON.stringify(s.map((x) => x.mode + '/' + x.phCard)));

    // Monoton bevegelse → nøyaktig sekvensen reorder(0) → extract → reorder(1)
    // frem til listepunktet er inne i liste 1 (sveipet fortsetter forbi den, og
    // extract UNDER liste 1 er riktig).
    const seq = modeSeq(s, 'reorder:card-1');
    log('B2 ingen flimring: én overgang hver vei (reorder/0 → extract → reorder/1)',
      seq.length === 3 && seq[0] === 'reorder:card-0' && seq[1] === 'extract:-' && seq[2] === 'reorder:card-1',
      seq.join(' → '));
    await ptr(p, 'pointercancel', z.x, z.y, 'touch'); await p.waitForTimeout(200);

    // Oppover inn i liste 0 igjen: terskelen er +-knappenes øvre kant.
    const z2 = await liftItem(p, '.item[data-id="card-1-a"]', 'touch');
    const s2 = await sweep(p, z2.x, z2.y - 4, -6, 60, 'touch');
    const inPrev = firstWhere(s2, (x) => x.mode === 'reorder' && x.phCard === 'card-0');
    if (inPrev) {
      const h = inPrev.at.drag.height;
      const over = addLine(inPrev.before.cards['card-0']) - (inPrev.at.drag.bottom - h / 3);
      log('B3 inn i forrige liste oppover: nedre 1/3 har akkurat passert knapperadens midtlinje',
        over >= 0 && over <= 8, 'forbi knappemidten=' + over.toFixed(1));
    } else log('B3 inn i forrige liste oppover: placeholderen havnet i liste 0', false, JSON.stringify(s2.map((x) => x.mode + '/' + x.phCard)));
    const seq2 = modeSeq(s2, 'reorder:card-0');
    log('B4 ingen flimring oppover',
      seq2.length === 3 && seq2[0] === 'reorder:card-1' && seq2[1] === 'extract:-' && seq2[2] === 'reorder:card-0',
      seq2.join(' → '));
    await ptr(p, 'pointercancel', z2.x, z2.y, 'touch'); await p.waitForTimeout(200);
    log('B ingen JS-feil', errs.length === 0, errs.join(' | '));
    await p.close();
  }

  /* ============ C) Desktop, FLERKOLONNE: samme terskler innen en kolonne ============ */
  {
    const p = await b.newPage({ viewport: { width: 1200, height: 900 } });
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await register(p); await seed(p, 4);
    const cols = await p.evaluate(() => getComputedStyle(document.getElementById('board')).columnCount);
    log('C0 forutsetning: board i FLERKOLONNE', cols !== '1', 'column-count=' + cols);
    // Finn to kort som ligger i SAMME kolonne (samme venstrekant), øverste først.
    const pair = await p.evaluate(() => {
      const cs = [...document.querySelectorAll('.card')].map((c) => ({ id: c.dataset.id, r: c.getBoundingClientRect() }));
      for (const a of cs) for (const b2 of cs) {
        if (a.id !== b2.id && Math.abs(a.r.left - b2.r.left) < 2 && b2.r.top > a.r.bottom) return { top: a.id, bottom: b2.id };
      }
      return null;
    });
    log('C0 forutsetning: to kort i samme kolonne', !!pair, JSON.stringify(pair));
    if (pair) {
      const z = await liftItem(p, '.item[data-id="' + pair.top + '-b"]', 'mouse');
      // Nok steg til å nå HELT ned i kortet under: ny-liste-placeholderen legger
      // seg mellom kortene og skyver det nedre kortet et stykke ned underveis.
      const s = await sweep(p, z.x, z.y + 4, 6, 90, 'mouse');
      const out = firstWhere(s, (x) => x.mode === 'extract');
      const into = firstWhere(s, (x) => x.mode === 'reorder' && x.phCard === pair.bottom);
      if (out) {
        const h = out.at.drag.height;
        const over = (out.at.drag.bottom - h / 3) - addLine(out.before.cards[pair.top]);
        log('C1 desktop: ut-terskelen er nedre 1/3 forbi knapperadens midtlinje', over >= 0 && over <= 8, 'forbi=' + over.toFixed(1));
        log('C2 desktop: extract mens pekeren ennå er over kildelista',
          out.at.y <= out.before.cards[pair.top].rect.bottom,
          'peker=' + Math.round(out.at.y) + ' kortbunn=' + Math.round(out.before.cards[pair.top].rect.bottom));
      } else log('C1 desktop: extract slo inn', false, JSON.stringify(s.map((x) => x.mode)));
      if (into) {
        const h = into.at.drag.height;
        const over = (into.at.drag.top + h / 3) - headLine(into.before.cards[pair.bottom]);
        log('C3 desktop: inn-terskelen er øvre 1/3 forbi tittelradens midtlinje', over >= 0 && over <= 8, 'forbi=' + over.toFixed(1));
        log('C4 desktop: ingen flimring i kolonnen', (() => {
          const q = modeSeq(s, 'reorder:' + pair.bottom);
          return q.length === 3 && q[1] === 'extract:-';
        })(), modeSeq(s, 'reorder:' + pair.bottom).join(' → '));
      } else log('C3 desktop: placeholderen havnet i kortet under', false, JSON.stringify(s.map((x) => x.mode + '/' + x.phCard)));
      await ptr(p, 'pointercancel', z.x, z.y, 'mouse'); await p.waitForTimeout(200);
    }
    log('C ingen JS-feil', errs.length === 0, errs.join(' | '));
    await p.close();
  }

  /* ============ E) Små lister: tom og ettradig liste er fortsatt treffbare ============
     En tom liste har nesten ingen innholdssone mellom tittelen og +-knappene; da
     gjelder hele kortet (cardBand). Uten det ville sonen vært umulig å treffe — og
     verre: idet man går inn, forsvinner ny-liste-placeholderen og lista hopper opp
     mot objektet, så et for smalt vindu ville sluppet objektet ut igjen (flimring). */
  {
    const p = await b.newPage({ viewport: mobil, hasTouch: true });
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await register(p); await seed(p, 3, false, [2, 0, 1]); // liste 1 TOM, liste 2 med ett listepunkt
    const z = await liftItem(p, '.item[data-id="card-0-b"]', 'touch');
    const s = await sweep(p, z.x, z.y + 4, 6, 90, 'touch');
    const seq = modeSeq(s, 'reorder:card-2');
    log('E1 tom liste: objektet kommer INN i den', s.some((x) => x.phCard === 'card-1'),
      seq.join(' → '));
    log('E2 ettradig liste under: objektet kommer inn der også', s.some((x) => x.phCard === 'card-2'),
      seq.join(' → '));
    // Ingen liste skal besøkes to ganger (extract mellom hvert kort er riktig).
    const dedup = s.map((x) => x.mode + ':' + (x.phCard || '-')).filter((v, i, a) => i === 0 || v !== a[i - 1]);
    const visits = dedup.filter((v) => v.startsWith('reorder:'));
    log('E3 ingen flimring gjennom tom + ettradig liste', new Set(visits).size === visits.length, dedup.join(' → '));
    await ptr(p, 'pointercancel', z.x, z.y, 'touch'); await p.waitForTimeout(200);
    log('E ingen JS-feil', errs.length === 0, errs.join(' | '));
    await p.close();
  }

  /* ============ F) Slipp NEDERST i en liste (siste plass) ============
     Den trangeste plassen etter innstrammingen: sonen slutter ved +-knappene, og
     for å havne SIST må objektets senter forbi siste rads senter. Slippet skal
     lande i lista — ikke lage en ny. */
  {
    const p = await b.newPage({ viewport: mobil, hasTouch: true });
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await register(p); await seed(p, 2);
    const z = await liftItem(p, '.item[data-id="card-0-a"]', 'touch');
    // Grovt inn i liste 1, deretter rett under siste rad der (måles på nytt).
    const mid = await centerOf(p, '.card[data-id="card-1"] .items-container');
    await ptr(p, 'pointermove', mid.x, mid.y, 'touch'); await p.waitForTimeout(120);
    const belowLast = await p.evaluate(() => {
      const c = document.querySelector('.card[data-id="card-1"]');
      const rows = [...c.querySelectorAll('.items-container > .item')];
      const last = rows[rows.length - 1].getBoundingClientRect();
      // Siste rads senter: der bytter det løftede listepunktet plass med raden
      // (overlapp-regelen krever at objektets topp har nådd radens topp), og det er
      // fortsatt godt innenfor sonen (som slutter ved +-knappene).
      return { x: Math.round(last.left + last.width / 2), y: Math.round(last.top + last.height / 2) };
    });
    await ptr(p, 'pointermove', belowLast.x, belowLast.y - 10, 'touch'); await p.waitForTimeout(80);
    // Anti-flimringen (SWAP_LOCK_MS = 300 ms) blokkerer det motsatte byttet rett
    // etter innsettingen i lista — vent den ut før den siste nudgen.
    await p.waitForTimeout(350);
    await ptr(p, 'pointermove', belowLast.x, belowLast.y, 'touch'); await p.waitForTimeout(150);
    const modeBefore = (await probe(p)).mode;
    await ptr(p, 'pointerup', belowLast.x, belowLast.y, 'touch'); await p.waitForTimeout(400);
    const st = await p.evaluate(() => {
      const H = window.__huskis;
      const g = H.state.universes.find((u) => u.id === H.state.activeUniverse).groups.find((x) => x.id === H.state.activeGroup);
      return g.cards.map((c) => ({ id: c.id, items: c.items.filter((i) => !i.trashed).sort((a, b) => a.pos - b.pos).map((i) => i.id) }));
    });
    const c1 = st.find((c) => c.id === 'card-1');
    log('F1 slipp nederst i lista: landet SIST i liste 1 (ingen ny liste)',
      st.length === 2 && c1 && c1.items[c1.items.length - 1] === 'card-0-a',
      'modus før slipp=' + modeBefore + ' ' + JSON.stringify(st));
    log('F ingen JS-feil', errs.length === 0, errs.join(' | '));
    await p.close();
  }

  /* ============ F2) Kategori slippes SIST i sin egen liste ============
     Den aller trangeste plassen: lista krymper ~25 px i samme øyeblikk som
     kategori-placeholderen blir siste rad (skillelinja under den forsvinner), så
     nedre grense kommer opp mot objektet mens man sikter. Slarken i cardBand
     (halve knapperaden) skal gjøre dette til en helt vanlig bevegelse. */
  {
    const p = await b.newPage({ viewport: mobil, hasTouch: true });
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await register(p); await seed(p, 2, true);
    await p.evaluate(() => { // kategorien ØVERST, så den faktisk må flyttes ned
      const H = window.__huskis, st = H.state;
      const g = st.universes.find((u) => u.id === st.activeUniverse).groups.find((x) => x.id === st.activeGroup);
      g.cards.find((c) => c.id === 'card-0').items.find((i) => i.id === 'cat-1').pos = -1;
      H.render();
    });
    await p.waitForTimeout(300);
    const z = await centerOf(p, '.category[data-id="cat-1"] .cat-head');
    await ptr(p, 'pointerdown', z.x, z.y, 'touch'); await p.waitForTimeout(250);
    await ptr(p, 'pointermove', z.x, z.y + 6, 'touch'); await p.waitForTimeout(400); // la kategorien kollapse ferdig
    const bottom = await p.evaluate(() => {
      const r = document.querySelector('.card[data-id="card-0"] .items-container').getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.bottom - 6) };
    });
    for (let i = 1; i <= 6; i++) {
      await ptr(p, 'pointermove', bottom.x, Math.round(z.y + (bottom.y - z.y) * i / 6), 'touch');
      await p.waitForTimeout(60);
    }
    // Siste nudge under siste rads senter (kategori-plassering er senterbasert).
    // Måles på nytt: lista vokser/krymper ~25 px mens placeholderen flytter seg,
    // fordi skillelinjene rundt den kommer og går.
    const past = await p.evaluate(() => {
      const rows = [...document.querySelectorAll('.card[data-id="card-0"] .items-container > .item')];
      const last = rows[rows.length - 1].getBoundingClientRect();
      return Math.round(last.top + last.height / 2 + 10);
    });
    await ptr(p, 'pointermove', bottom.x, past, 'touch'); await p.waitForTimeout(120);
    bottom.y = past;
    const modeBefore = (await probe(p)).mode;
    await ptr(p, 'pointerup', bottom.x, bottom.y, 'touch'); await p.waitForTimeout(500);
    const st2 = await p.evaluate(() => {
      const H = window.__huskis;
      const g = H.state.universes.find((u) => u.id === H.state.activeUniverse).groups.find((x) => x.id === H.state.activeGroup);
      return g.cards.map((c) => ({
        id: c.id,
        level1: c.items.filter((i) => !i.trashed && !i.cat).sort((a, b) => a.pos - b.pos).map((i) => i.id),
      }));
    });
    const c0 = st2.find((c) => c.id === 'card-0');
    log('F2 kategori sluppet nederst: ble SISTE rad i sin egen liste (ingen ny liste)',
      st2.length === 2 && c0 && c0.level1[c0.level1.length - 1] === 'cat-1',
      'modus før slipp=' + modeBefore + ' ' + JSON.stringify(st2));
    log('F2 ingen JS-feil', errs.length === 0, errs.join(' | '));
    await p.close();
  }

  /* ============ G) Listepunkt OVER en kategori som ligger ØVERST i lista ============
     Kategoriens overkant ligger bare ~10 px under tittelraden, og pekeren må være
     der (over kategorien) for å treffe nivå 1 i stedet for inne i kategorien. Uten
     slarken i tittelraden var vinduet 0 px — placeholderen gikk rett fra «inne i
     kategorien» til «ny liste». */
  {
    const p = await b.newPage({ viewport: mobil, hasTouch: true });
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await register(p); await seed(p, 2, true);
    await p.evaluate(() => { // kategorien ØVERST
      const H = window.__huskis, st = H.state;
      const g = st.universes.find((u) => u.id === st.activeUniverse).groups.find((x) => x.id === st.activeGroup);
      g.cards.find((c) => c.id === 'card-0').items.find((i) => i.id === 'cat-1').pos = -1;
      H.render();
    });
    await p.waitForTimeout(300);
    const headTop = await p.evaluate(() => Math.round(document.querySelector('.card[data-id="card-0"] .card-head').getBoundingClientRect().top));
    // Hvor står placeholderen? nivå 1 øverst / inne i kategorien / ny liste.
    const slot = () => p.evaluate(() => {
      const ph = document.querySelector('.item-placeholder, .card-placeholder');
      if (!ph) return 'ingen';
      if (ph.classList.contains('new-list-placeholder')) return 'ny-liste';
      if (ph.closest('.cat-items')) return 'i-kategorien';
      const rows = [...ph.parentNode.children].filter((c) => c.classList.contains('item') || c.classList.contains('category') || c === ph);
      return 'niva1@' + rows.indexOf(ph);
    });
    const z = await liftItem(p, '.item[data-id="card-0-b"]', 'touch');
    let window20 = 0, lastTop = null;
    for (let y = z.y - 8; y > headTop - 20; y -= 3) {
      await ptr(p, 'pointermove', z.x, y, 'touch'); await p.waitForTimeout(45);
      if (await slot() === 'niva1@0') { window20 += 3; lastTop = y; }
    }
    log('G1 det FINNES et vindu for «over kategorien øverst» (≥ 20 px)', window20 >= 20, 'vindu=' + window20 + ' px');
    // Sveipet endte over lista (ny-liste-modus, layouten har flyttet seg). Kom
    // tilbake ned i lista og kryp oppover til placeholderen står øverst — som en
    // bruker som ser hvor den lander — og slipp der.
    void lastTop;
    const back = await centerOf(p, '.card[data-id="card-0"] .items-container');
    await ptr(p, 'pointermove', z.x, back.y, 'touch'); await p.waitForTimeout(120);
    let dropY = null;
    for (let y = back.y; y > headTop - 10; y -= 3) {
      await ptr(p, 'pointermove', z.x, y, 'touch'); await p.waitForTimeout(45);
      if (await slot() === 'niva1@0') { dropY = y; break; }
    }
    if (dropY != null) { await ptr(p, 'pointerup', z.x, dropY, 'touch'); await p.waitForTimeout(400); }
    else { await ptr(p, 'pointercancel', z.x, z.y, 'touch'); await p.waitForTimeout(200); }
    const st = await p.evaluate(() => {
      const H = window.__huskis;
      const g = H.state.universes.find((u) => u.id === H.state.activeUniverse).groups.find((x) => x.id === H.state.activeGroup);
      const c = g.cards.find((c) => c.id === 'card-0');
      return { cards: g.cards.length, level1: c.items.filter((i) => !i.trashed && !i.cat).sort((a, b) => a.pos - b.pos).map((i) => i.id) };
    });
    log('G2 slippet der landet ØVERST på nivå 1, over kategorien',
      st.cards === 2 && st.level1[0] === 'card-0-b' && st.level1[1] === 'cat-1', JSON.stringify(st));
    log('G ingen JS-feil', errs.length === 0, errs.join(' | '));
    await p.close();
  }

  /* ============ D) Listepunkt UT av en kategori: forblir synlig ============ */
  for (const [label, vp, kind] of [['desktop', { width: 1200, height: 900 }, 'mouse'], ['mobil', mobil, 'touch']]) {
    const p = await b.newPage({ viewport: vp, hasTouch: true });
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await register(p); await seed(p, 2, true);

    const z = await liftItem(p, '.item[data-id="m-1"]', kind);
    // Opp til nivå 1 i SAMME liste (over «Punkt A»).
    const t = await centerOf(p, '.item[data-id="card-0-a"]');
    await ptr(p, 'pointermove', t.x, t.y - 4, kind); await p.waitForTimeout(80);
    await ptr(p, 'pointermove', t.x, t.y - 6, kind); await p.waitForTimeout(120);

    const view = await p.evaluate(() => {
      const d = document.querySelector('.item.dragging');
      if (!d) return { none: true };
      const r = d.getBoundingClientRect();
      const cat = document.querySelector('.category[data-id="cat-1"]');
      const cont = document.querySelector('.card[data-id="card-0"] .items-container');
      const rows = [...cont.children].map((c) => (c.dataset.id || c.className) + (c.classList.contains('sep-above') ? '|over' : '') + (c.classList.contains('sep-below') ? '|under' : ''));
      return {
        // Ligger dra-elementet fortsatt der stilen sier (dvs. ingen forfar er blitt
        // containing block)? Sammenlign SENTERET av den malte boksen med
        // style.left/top — dra-skalaen og -rotasjonen blåser opp boksen (og dermed
        // top/left) på et bredt listepunkt, men flytter aldri senteret.
        drift: Math.abs((r.top + r.bottom) / 2 - (parseFloat(d.style.top) - window.scrollY + parseFloat(d.style.height) / 2)) +
               Math.abs((r.left + r.right) / 2 - (parseFloat(d.style.left) - window.scrollX + parseFloat(d.style.width) / 2)),
        offsetParentIsAncestorRow: !!(d.offsetParent && d.offsetParent.classList &&
          (d.offsetParent.classList.contains('category') || d.offsetParent.classList.contains('item'))),
        catPositioned: cat ? getComputedStyle(cat).position !== 'static' : null,
        catSepAbove: cat ? cat.classList.contains('sep-above') : null,
        rows,
        phInLevel1: !!cont.querySelector(':scope > .item-placeholder'),
      };
    });
    // Skala/rotasjon flytter den malte boksen noen piksler — drift på titalls
    // piksler betyr at koordinatsystemet har byttet (buggen).
    log('D ' + label + ': det løftede listepunktet står der det skal (ikke klippet vekk)',
      !view.none && view.drift < 12 && !view.offsetParentIsAncestorRow, JSON.stringify(view));
    log('D ' + label + ': kategorien (forfar) er IKKE gjort til containing block',
      view.catPositioned === false && view.catSepAbove === false, 'position=' + view.catPositioned + ' sep-above=' + view.catSepAbove);
    log('D ' + label + ': placeholderen ligger på nivå 1, og linja males fra raden over',
      view.phInLevel1 && view.rows.some((r) => /\|under$/.test(r)), view.rows.join(' , '));
    await p.screenshot({ path: '/tmp/dnd-extract-' + label + '.png' });
    await ptr(p, 'pointercancel', t.x, t.y, kind); await p.waitForTimeout(200);
    log('D ' + label + ': ingen JS-feil', errs.length === 0, errs.join(' | '));
    await p.close();
  }

  await b.close();
  const pass = results.filter(Boolean).length;
  console.log('\n==== ' + pass + '/' + results.length + ' PASS ====');
  process.exit(pass === results.length ? 0 : 1);
})();
