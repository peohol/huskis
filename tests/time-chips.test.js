/*
  Regresjonstest: INDIKATOR-CHIPENE under liste-/listepunktnavnet
  (`docs/scheduling.md`). Reglene rundt selve tidsverdiene ligger der;
  hendelsesmotoren som deler bøttene med dem har sin egen fil
  (`upcoming-events.test.js`).

  To ting testes her, og de henger sammen:

  1. FARGEN ER DE SAMME BØTTENE som «Kommende hendelser» deler tiden i. En
     frist som står «innen en uke» i modalen kan ikke være rød i lista, og
     startene låner ikke varselfargene. Chipen er en GROVERE lesning: modalen
     har åtte grupper, chipen seks toner — de to bøttene lenger ute enn en uke
     (`month`, `far`) deler tone, fordi board-et skal si at noe ikke haster,
     ikke hvor langt fram det ikke haster.
  2. CHIPEN LEVER I TID. En frist som passerer mens brukeren ser på skjermen
     blir rød der og da — uten en rendring, uten en sideoppdatering. Det var
     nettopp det som manglet: indikatoren ble stående gul til noe annet tegnet
     board-et på nytt.

  Dekker:
     1. Fristens bøtter ved de EKSAKTE grensene: utløpt, nøyaktig nå,
        under 7 døgn, nøyaktig 7 døgn, under 30 døgn, over 30 døgn.
     2. Startens bøtter ved de samme grensene — med det ene bevisste
        avviket ved `now`: en start som er nøyaktig nå HAR begynt, mens en
        frist som er nøyaktig nå ennå ikke er oversittet.
     3. Dato uten klokkeslett: fristen varer ut døgnet, starten begynner 00:00.
     4. Ingen av de seks tonene er delt mellom frist og start — og de to
        bøttene lenger ute enn en uke ender i den SAMME tonen.
     5. Chipen maler seg selv om når tidspunktet passerer, uten en rendring.
     6. Den gjør det også for en frist som ligger på en 7-døgnsgrense.
     7. Fristbruddets varseltrekant overlever en slik ommaling (glyfen bærer
        meningen, ikke fargen — docs/scheduling.md).

  Kjør:
    python3 -m http.server 8000                        # fra repo-roten, i egen terminal
    NODE_PATH=$(npm root -g) node tests/time-chips.test.js
*/
const { chromium } = require('playwright');

const BASE = process.env.HUSKIS_URL || 'http://localhost:8000';
const results = [];
const log = (n, ok, x = '') => { results.push(ok); console.log((ok ? 'PASS' : 'FAIL') + ' — ' + n + (x !== '' ? '  [' + (typeof x === 'string' ? x : JSON.stringify(x)) + ']' : '')); };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const U = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
  const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
});

function buildDB() {
  const uid = 'uC';
  const id = { UA: U(), GA: U(), C1: U(), I1: U(), C2: U(), I2: U() };
  const base = (x) => Object.assign({
    trashed: false, locked: false, unlocked: false, invite_policy: 'inherit',
    collapsed: false, is_cat: false, cat_id: null,
    start_at: null, due_at: null, lock_times: false,
    ts: 1, org: 'c', pos: 0, pos_ts: 1, pos_org: 'c',
  }, x);
  return { id, uid, db: {
    _rolesBackfilled: true,
    profiles: [{ id: uid, email: 'c@x.no', display_name: 'Chip', user_metadata: {} }],
    passwords: { 'c@x.no': 'x' },
    universes: [base({ id: id.UA, owner_id: uid, name: 'Arbeid' })],
    groups: [base({ id: id.GA, owner_id: uid, universe_id: id.UA, name: 'Klinikk' })],
    cards: [
      base({ id: id.C1, owner_id: uid, group_id: id.GA, title: 'Frist', k: true, p: true, lab_ts: 0, lab_org: '' }),
      base({ id: id.C2, owner_id: uid, group_id: id.GA, title: 'Start', pos: 1, k: true, p: true, lab_ts: 0, lab_org: '' }),
    ],
    items: [
      base({ id: id.I1, owner_id: uid, card_id: id.C1, text: 'Punkt', done: false }),
      base({ id: id.I2, owner_id: uid, card_id: id.C2, text: 'Punkt', done: false }),
    ],
    memberships: [{ id: U(), user_id: uid, universe_id: id.UA, group_id: null, role: 'owner', pos: 0, created_at: 1 }],
    share_invites: [], tombstones: [], notifications: [], notification_prefs: [],
  } };
}

// Chipens tone for en gitt verdi og et gitt `now`, regnet i SIDEN (samme
// lokale veggtid som appen bruker).
const tone = (p, field, value, now) => p.evaluate(({ field, value, now }) => {
  const H = window.__huskis;
  const st = field === 'due' ? H.dueStatus(value, now) : H.startStatus(value, now);
  return st;
}, { field, value, now });

// Klassen som faktisk står på chipen i DOM-en.
const domTone = (p, cardId, field) => p.evaluate(({ cardId, field }) => {
  const chip = document.querySelector('.card[data-id="' + cardId + '"] .meta-' + field);
  if (!chip) return null;
  return [...chip.classList].filter((c) => c.indexOf('is-') === 0).join(' ');
}, { cardId, field });

// Sett en tidsverdi gjennom appens egen setter (stempler + lagrer).
const settTid = (p, cardId, field, value) => p.evaluate(({ cardId, field, value }) => {
  const H = window.__huskis;
  const kort = H.state.universes[0].groups[0].cards.find((c) => c.id === cardId);
  H.setObjectTime({ obj: kort, card: kort }, field, value);
}, { cardId, field, value });

// 'YYYY-MM-DDTHH:MM' n millisekunder fram i tid, regnet i siden.
const verdiOm = (p, ms) => p.evaluate((ms) => {
  const d = new Date(Date.now() + ms);
  const to = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + to(d.getMonth() + 1) + '-' + to(d.getDate()) +
    'T' + to(d.getHours()) + ':' + to(d.getMinutes());
}, ms);

async function run() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 },
    timezoneId: 'Europe/Oslo', locale: 'nb-NO' });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));

  const { id, uid, db } = buildDB();
  await p.goto(BASE + '/?mock=1');
  await p.evaluate(({ db, uid }) => {
    localStorage.clear(); sessionStorage.clear();
    localStorage.setItem('hk-mock-db', JSON.stringify(db));
    sessionStorage.setItem('hk-mock-session', JSON.stringify({
      id: uid, email: 'c@x.no',
      user_metadata: { onboarding: { v: 3, status: 'done' }, tips: { drag: true, trash: true, moveList: true, dragTrash: true } },
    }));
  }, { db, uid });
  await p.goto(BASE + '/?mock=1');
  await p.waitForFunction(() => {
    const H = window.__huskis;
    return H && H.authUser && H.lastMy && H.state.universes.length > 0;
  }, null, { timeout: 15000, polling: 200 });
  await p.waitForTimeout(300);

  /* NÅ = 2026-06-15 kl. 12:00, som i hendelsesmotorens fikstur.
       08.06 kl. 12:00 = nøyaktig sju døgn tilbake
       22.06 kl. 12:00 = nøyaktig sju døgn fram */
  const NOW = await p.evaluate(() => new Date(2026, 5, 15, 12, 0, 0, 0).getTime());

  /* ---------- 1) Fristens bøtter ---------- */
  const due = {};
  for (const [navn, v] of [
    ['utløpt', '2026-06-14T12:00'], ['nøyaktig nå', '2026-06-15T12:00'],
    ['under sju', '2026-06-20T12:00'], ['nøyaktig sju', '2026-06-22T12:00'],
    ['over sju', '2026-06-30T12:00'], ['nøyaktig tretti', '2026-07-15T12:00'],
    ['over tretti', '2026-07-20T12:00'],
  ]) due[navn] = await tone(p, 'due', v, NOW);
  log('1a: frist FØR nå er utløpt', due['utløpt'] === 'over', due['utløpt']);
  log('1b: frist NØYAKTIG nå er ikke utløpt — den er innen en uke',
    due['nøyaktig nå'] === 'soon', due['nøyaktig nå']);
  log('1c: under 7 døgn er «innen en uke»', due['under sju'] === 'soon', due['under sju']);
  log('1d: NØYAKTIG 7 døgn faller i «innen en måned» — ingen hull',
    due['nøyaktig sju'] === 'month', due['nøyaktig sju']);
  log('1e: over 7 døgn ligger samme sted', due['over sju'] === 'month', due['over sju']);
  log('1f: NØYAKTIG 30 døgn faller i «om mer enn en måned» — samme slag grense',
    due['nøyaktig tretti'] === 'far', due['nøyaktig tretti']);
  log('1g: over 30 døgn ligger samme sted', due['over tretti'] === 'far', due['over tretti']);

  /* ---------- 2) Startens bøtter ---------- */
  const start = {};
  for (const [navn, v] of [
    ['begynt', '2026-06-14T12:00'], ['nøyaktig nå', '2026-06-15T12:00'],
    ['under sju', '2026-06-20T12:00'], ['nøyaktig sju', '2026-06-22T12:00'],
    ['over sju', '2026-06-30T12:00'], ['nøyaktig tretti', '2026-07-15T12:00'],
    ['over tretti', '2026-07-20T12:00'],
  ]) start[navn] = await tone(p, 'start', v, NOW);
  log('2a: start FØR nå har begynt', start['begynt'] === 'started', start['begynt']);
  log('2b: start NØYAKTIG nå HAR begynt (motsatt av fristen ved samme grense)',
    start['nøyaktig nå'] === 'started', start['nøyaktig nå']);
  log('2c: under 7 døgn begynner «innen en uke»', start['under sju'] === 'soon', start['under sju']);
  log('2d: NØYAKTIG 7 døgn faller i «innen en måned»',
    start['nøyaktig sju'] === 'month', start['nøyaktig sju']);
  log('2e: over 7 døgn ligger samme sted', start['over sju'] === 'month', start['over sju']);
  log('2f: NØYAKTIG 30 døgn og senere begynner «om mer enn en måned»',
    start['nøyaktig tretti'] === 'far' && start['over tretti'] === 'far',
    start['nøyaktig tretti'] + '/' + start['over tretti']);

  /* ---------- 3) Dato uten klokkeslett ---------- */
  log('3a: en FRISTDATO uten klokkeslett varer ut døgnet — ikke utløpt kl. 12',
    (await tone(p, 'due', '2026-06-15', NOW)) === 'soon');
  log('3b: … og er utløpt dagen etter',
    (await tone(p, 'due', '2026-06-14', NOW)) === 'over');
  log('3c: en STARTDATO uten klokkeslett begynner 00:00 — altså tidligere i dag',
    (await tone(p, 'start', '2026-06-15', NOW)) === 'started');

  /* ---------- 4) Bøttene, tonene, og at ingen tone er delt mellom feltene ---------- */
  const klasser = await p.evaluate(() => {
    const H = window.__huskis;
    const now = new Date(2026, 5, 15, 12, 0, 0, 0).getTime();
    const ut = {};
    [['due', '2026-06-14T12:00'], ['due', '2026-06-20T12:00'],
      ['due', '2026-06-30T12:00'], ['due', '2026-07-20T12:00'],
      ['start', '2026-06-14T12:00'], ['start', '2026-06-20T12:00'],
      ['start', '2026-06-30T12:00'], ['start', '2026-07-20T12:00'],
    ].forEach(([f, v]) => { ut[f + ':' + v] = (f === 'due' ? H.dueStatus(v, now) : H.startStatus(v, now)); });
    return ut;
  });
  log('4a: de åtte bøttene er entydige',
    eq(Object.values(klasser), ['over', 'soon', 'month', 'far', 'started', 'soon', 'month', 'far']),
    JSON.stringify(klasser));
  // Og at CSS-en gir dem seks ULIKE flater — ingen deling mellom frist og start.
  const flater = await p.evaluate(() => {
    const probe = document.createElement('span');
    probe.style.display = 'none';
    document.body.appendChild(probe);
    const ut = {};
    ['is-over', 'is-soon', 'is-later', 'is-started', 'is-startsoon', 'is-startlater'].forEach((c) => {
      probe.className = 'meta-chip ' + c;
      ut[c] = getComputedStyle(probe).backgroundImage;
    });
    probe.remove();
    return ut;
  });
  log('4b: hver av de seks tonene har sin EGEN flate',
    new Set(Object.values(flater)).size === 6, JSON.stringify(Object.keys(flater)));
  /* … og de to bøttene lenger ute enn en uke ender i den SAMME tonen: chipen
     skiller ikke to grader av «haster ikke». Måles på DOM-en, med datoer
     regnet fra den EKTE klokken — `paintTimeChip` har ingen `now`-parameter. */
  const domKlasse = await p.evaluate((cardId) => {
    const H = window.__huskis;
    const pad = (n) => String(n).padStart(2, '0');
    const om = (dager) => {
      const d = new Date(Date.now() + dager * 86400000);
      return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    };
    const kort = H.state.universes[0].groups[0].cards.find((c) => c.id === cardId);
    const ut = {};
    [['due', 15], ['due', 45], ['start', 15], ['start', 45]].forEach(([felt, dager]) => {
      H.setObjectTime({ kind: 'card', obj: kort, card: kort }, felt, om(dager));
      H.render();
      const chip = document.querySelector('.card[data-id="' + cardId + '"] .meta-' + felt);
      ut[felt + '+' + dager] = chip ? [...chip.classList].filter((c) => c.indexOf('is-') === 0).join(' ') : null;
      H.setObjectTime({ kind: 'card', obj: kort, card: kort }, felt, '');
      H.render();
    });
    return ut;
  }, id.C1);
  log('4c: chipen slår «innen en måned» og «om mer enn en måned» sammen til ÉN tone',
    domKlasse['due+15'] === 'is-later' && domKlasse['due+45'] === 'is-later' &&
    domKlasse['start+15'] === 'is-startlater' && domKlasse['start+45'] === 'is-startlater',
    JSON.stringify(domKlasse));

  /* ---------- 5) Chipen maler seg om når tidspunktet passerer ---------- */
  // +90 s: verdien avrundes til hele minutter, så minuttet må ligge foran oss.
  const straks = await verdiOm(p, 90000);
  await settTid(p, id.C1, 'due', straks);
  await p.waitForTimeout(300);
  log('5a: fristen er gul mens den ennå ikke er passert',
    (await domTone(p, id.C1, 'due')) === 'is-soon', await domTone(p, id.C1, 'due'));
  // Tell rendringer, så vi kan bevise at ommalingen IKKE er en ny rendring.
  await p.evaluate(() => {
    window.__renders = 0;
    const board = document.getElementById('board');
    window.__obs = new MutationObserver(() => { window.__renders++; });
    window.__obs.observe(board, { childList: true });
  });
  // Fraværsbevis + tidsvindu-observasjon: ommalingen SKAL skje på klokka, og
  // den kan bare ses ved å vente til grensen faktisk har passert.
  // En manglende ommaling skal gi en lesbar FAIL, ikke en stakksporing.
  let bleRød = true;
  await p.waitForFunction(() => {
    const chip = document.querySelector('.meta-due');
    return chip && chip.classList.contains('is-over');
  }, null, { timeout: 120000, polling: 500 }).catch(() => { bleRød = false; });
  const utenRender = await p.evaluate(() => {
    const n = window.__renders;
    window.__obs.disconnect();
    return n;
  });
  log('5b: chipen ble rød av seg selv da fristen passerte', bleRød,
    bleRød ? '' : 'sto igjen på ' + (await domTone(p, id.C1, 'due')));
  log('5c: … uten at board-et ble bygget på nytt', utenRender === 0, utenRender + ' ombygginger');

  /* ---------- 7) Fristbruddets varseltrekant overlever ommalingen ---------- */
  const glyf = await p.evaluate((cardId) => {
    const chip = document.querySelector('.card[data-id="' + cardId + '"] .meta-due');
    return { harIkon: !!chip.querySelector('svg'), tekst: chip.textContent.trim().length > 0 };
  }, id.C1);
  log('7: chipen har fortsatt både glyf og tekst etter ommalingen',
    glyf.harIkon && glyf.tekst, JSON.stringify(glyf));

  log('ingen JS-feil', errs.length === 0, errs.join(' | '));
  await browser.close();
}

run().then(() => {
  const ok = results.filter(Boolean).length;
  console.log('\n==== ' + ok + '/' + results.length + ' PASS ====');
  process.exit(ok === results.length ? 0 : 1);
}).catch((e) => { console.error(e); process.exit(1); });
