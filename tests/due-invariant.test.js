/*
  Regresjonstest: DEN HARDE FRISTINVARIANTEN (docs/scheduling.md).

  Regelen: et barn kan aldri ha en senere frist enn en forelder som selv har
  frist. Foreldrekjeden er kategori → liste, kategorisert listepunkt →
  kategori → liste, ukategorisert listepunkt → liste.

  Poenget med fila er at regelen bor ÉTT sted — `setObjectTime()` — og at hver
  inngang i UI-et går gjennom den. Matrisen kjøres derfor gjennom setteren, og
  BEGGE UI-veiene (objektmenyens tidsskuff og tids-popoveren fra chipen) kjøres
  som ekte klikk for å bevise at de faktisk lander samme sted.

  Dekker:
     1. Barn FØR forelderens frist godtas.
     2. Barn med NØYAKTIG samme frist som forelderen godtas.
     3. Barn ETTER forelderens frist avvises, og verdien blir ikke skrevet.
     4. Forelder uten frist binder ingenting — barnet kan ha hvilken som helst.
     5. Kjeden er transitiv: et kategorisert listepunkt måles mot BÅDE
        kategorien og listen, også når kategorien ikke har frist selv.
     6. Å fjerne en frist er alltid lov, begge veier.
     7. Forelderen kan ikke flyttes foran et barns gyldige frist — verken
        listen foran en kategori, kategorien foran et medlem, eller listen
        foran et ukategorisert listepunkt.
     8. Låste tider teller ikke: et listepunkt hvis tider styres av listen har
        ingen aktiv egen verdi, og blokkerer derfor ikke listen.
     9. Dato uten klokkeslett måles med den felles semantikken — fristdatoen
        varer ut døgnet, så barn samme dag med klokkeslett er gyldig. Og
        dato-FØRST-inntasting virker: en dato som ennå kan reddes av et
        klokkeslett samme dag blir stående i feltet i stedet for å bli
        tilbakestilt, slik at neste halvdel av paret kan skrives inn.
    10. UI-veiene: både objektmenyens tidsskuff og tids-popoveren avviser en
        ugyldig frist, tilbakestiller feltet til forrige gyldige verdi og sier
        fra i en toast — uten bekreftelsesmodal.
    11. ELDRE DATA: et eksisterende brudd lastes, vises og synkes uten å bli
        migrert eller mutert — men det blokkerer ikke forelderen sin, det får
        en tydelig beskjed i tidseditoren, og det kan ikke bekreftes på nytt
        (neste skriving må lande innenfor taket).

  Kjør:
    python3 -m http.server 8000                        # fra repo-roten, i egen terminal
    NODE_PATH=$(npm root -g) node tests/due-invariant.test.js
*/
const { chromium } = require('playwright');

const BASE = process.env.HUSKIS_URL || 'http://localhost:8000';
const results = [];
const log = (n, ok, x = '') => { results.push(ok); console.log((ok ? 'PASS' : 'FAIL') + ' — ' + n + (x !== '' ? '  [' + (typeof x === 'string' ? x : JSON.stringify(x)) + ']' : '')); };

const U = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
  const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
});

/* Fikstur:
     Klinikk > Plan     (frist 20.06)
                 Kat     (kategori, frist 18.06)
                   Medlem      (frist 16.06)
                 Løst punkt    (frist 19.06)
              > Fri      (ingen frist)
                 Fritt punkt   (frist 31.12)
              > Låst     (frist 12.06, lockTimes)
                 Låst punkt    (skjult egen frist 25.12 — inert)
              > Gammel   (frist 10.06)
                 Brudd         (frist 25.06 — ELDRE BRUDD)
                 Lydig         (frist 09.06) */
function buildDB() {
  const uid = 'uD';
  const id = {};
  ['UA', 'GA', 'LPLAN', 'LFRI', 'LLÅST', 'LGML', 'CKAT',
    'IMED', 'ILØS', 'IFRI', 'ILÅS', 'IBRUDD', 'ILYDIG'].forEach((k) => { id[k] = U(); });
  const base = (x) => Object.assign({
    trashed: false, locked: false, unlocked: false, invite_policy: 'inherit',
    collapsed: false, is_cat: false, cat_id: null,
    start_at: null, due_at: null, lock_times: false,
    ts: 1, org: 'd', pos: 0, pos_ts: 1, pos_org: 'd',
  }, x);
  const card = (i, t, e) => base(Object.assign(
    { id: i, owner_id: uid, group_id: id.GA, title: t, k: true, p: true, lab_ts: 0, lab_org: '' }, e || {}));
  const item = (i, c, t, e) => base(Object.assign(
    { id: i, owner_id: uid, card_id: c, text: t, done: false }, e || {}));
  return { id, uid, db: {
    _rolesBackfilled: true,
    profiles: [{ id: uid, email: 'd@x.no', display_name: 'Frist', user_metadata: {} }],
    passwords: { 'd@x.no': 'x' },
    universes: [base({ id: id.UA, owner_id: uid, name: 'Arbeid' })],
    groups: [base({ id: id.GA, owner_id: uid, universe_id: id.UA, name: 'Klinikk' })],
    cards: [
      card(id.LPLAN, 'Plan', { due_at: '2026-06-20' }),
      card(id.LFRI, 'Fri', { pos: 1 }),
      card(id.LLÅST, 'Låst', { pos: 2, due_at: '2026-06-12', lock_times: true }),
      card(id.LGML, 'Gammel', { pos: 3, due_at: '2026-06-10' }),
    ],
    items: [
      item(id.CKAT, id.LPLAN, 'Kat', { is_cat: true, due_at: '2026-06-18' }),
      item(id.IMED, id.LPLAN, 'Medlem', { pos: 1, cat_id: id.CKAT, due_at: '2026-06-16' }),
      item(id.ILØS, id.LPLAN, 'Løst punkt', { pos: 2, due_at: '2026-06-19' }),
      item(id.IFRI, id.LFRI, 'Fritt punkt', { due_at: '2026-12-31' }),
      item(id.ILÅS, id.LLÅST, 'Låst punkt', { due_at: '2026-12-25' }),
      item(id.IBRUDD, id.LGML, 'Brudd', { due_at: '2026-06-25' }),
      item(id.ILYDIG, id.LGML, 'Lydig', { pos: 1, due_at: '2026-06-09' }),
    ],
    memberships: [{ id: U(), user_id: uid, universe_id: id.UA, group_id: null, role: 'owner', pos: 0, created_at: 1 }],
    share_invites: [], tombstones: [],
  } };
}

/* Sett en frist gjennom den sentrale setteren — nøyaktig den funksjonen begge
   UI-veiene committer i. Returnerer om den ble godtatt, og hva som står igjen. */
const setDue = (p, cardTitle, text, value) => p.evaluate(({ cardTitle, text, value }) => {
  const H = window.__huskis;
  const card = H.state.universes[0].groups[0].cards.find((c) => c.title === cardTitle);
  const obj = text ? card.items.find((i) => i.text === text) : card;
  const kind = !text ? 'card' : (obj.isCat ? 'category' : 'item');
  const ok = H.setObjectTime({ kind: kind, obj: obj, card: card }, 'due', value);
  return { ok: ok, due: obj.due || null };
}, { cardTitle, text: text || null, value: value || null });

const readDue = (p, cardTitle, text) => p.evaluate(({ cardTitle, text }) => {
  const H = window.__huskis;
  const card = H.state.universes[0].groups[0].cards.find((c) => c.title === cardTitle);
  return (text ? card.items.find((i) => i.text === text).due : card.due) || null;
}, { cardTitle, text: text || null });

const toastText = (p) => p.evaluate(() => {
  const t = document.getElementById('toast');
  return t && t.classList.contains('show') ? (t.querySelector('.toast-msg') || {}).textContent : null;
});
const clearToast = (p) => p.evaluate(() => {
  const t = document.getElementById('toast');
  if (t) t.classList.remove('show');
});

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 }, timezoneId: 'Europe/Oslo' });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));

  const { id, uid, db } = buildDB();
  await p.goto(BASE + '/?mock=1');
  await p.evaluate(({ db, uid }) => {
    localStorage.clear(); sessionStorage.clear();
    localStorage.setItem('hk-mock-db', JSON.stringify(db));
    sessionStorage.setItem('hk-mock-session', JSON.stringify({
      id: uid, email: 'd@x.no',
      user_metadata: { onboarding: { v: 3, status: 'done' }, tips: { drag: true, trash: true, moveList: true, dragTrash: true } },
    }));
  }, { db, uid });
  await p.goto(BASE + '/?mock=1');
  await p.waitForFunction(() => {
    const H = window.__huskis;
    return H && H.authUser && H.lastMy && H.state.universes.length > 0;
  }, null, { timeout: 15000, polling: 200 });

  /* ---------- 11a) Eldre brudd overlever lastingen urørt ---------- */
  log('11a: et eksisterende brudd lastes uten å bli migrert eller mutert',
    (await readDue(p, 'Gammel', 'Brudd')) === '2026-06-25', await readDue(p, 'Gammel', 'Brudd'));

  /* ---------- 1–3) Barn mot forelder ---------- */
  let r = await setDue(p, 'Plan', 'Medlem', '2026-06-17');
  log('1: barn FØR forelderens frist godtas', r.ok === true && r.due === '2026-06-17', JSON.stringify(r));
  r = await setDue(p, 'Plan', 'Medlem', '2026-06-18');
  log('2: barn med NØYAKTIG samme frist som forelderen godtas',
    r.ok === true && r.due === '2026-06-18', JSON.stringify(r));
  r = await setDue(p, 'Plan', 'Medlem', '2026-06-19');
  log('3a: barn ETTER forelderens frist avvises', r.ok === false, JSON.stringify(r));
  log('3b: den ugyldige verdien ble ikke skrevet', r.due === '2026-06-18', JSON.stringify(r));
  log('3c: avvisningen sier hvilken forelder som stopper den, og når',
    /Kat/.test(await toastText(p) || '') && /18/.test(await toastText(p) || ''), await toastText(p));
  await clearToast(p);

  /* ---------- 4) Forelder uten frist ---------- */
  r = await setDue(p, 'Fri', 'Fritt punkt', '2030-01-01');
  log('4: har forelderen ingen frist, kan barnet ha hvilken som helst',
    r.ok === true && r.due === '2030-01-01', JSON.stringify(r));

  /* ---------- 5) Transitivt: kategorien uten egen frist ---------- */
  await setDue(p, 'Plan', 'Medlem', '2026-06-15');
  let k = await setDue(p, 'Plan', 'Kat', null);
  log('5a: kategoriens frist kan fjernes', k.ok === true && k.due === null, JSON.stringify(k));
  r = await setDue(p, 'Plan', 'Medlem', '2026-06-21');
  log('5b: uten frist på kategorien måles listepunktet mot LISTEN (20.06) — avvist',
    r.ok === false && r.due === '2026-06-15', JSON.stringify(r));
  r = await setDue(p, 'Plan', 'Medlem', '2026-06-20');
  log('5c: … og godtas når det er innenfor listens frist',
    r.ok === true && r.due === '2026-06-20', JSON.stringify(r));
  // Rekkefølgen betyr noe: barnet må inn under taket FØR taket senkes igjen.
  await setDue(p, 'Plan', 'Medlem', '2026-06-16');
  await setDue(p, 'Plan', 'Kat', '2026-06-18');

  /* ---------- 6) Å fjerne en frist er alltid lov ---------- */
  const før = await readDue(p, 'Plan', 'Løst punkt');
  r = await setDue(p, 'Plan', 'Løst punkt', null);
  log('6: å fjerne barnets frist er alltid lov', r.ok === true && r.due === null, JSON.stringify(r));
  await setDue(p, 'Plan', 'Løst punkt', før);

  /* ---------- 7) Forelderen kan ikke flyttes foran barna ---------- */
  r = await setDue(p, 'Plan', 'Kat', '2026-06-15');
  log('7a: kategorien kan ikke flyttes foran medlemmets frist (16.06)',
    r.ok === false && r.due === '2026-06-18', JSON.stringify(r));
  log('7b: beskjeden navngir barnet som må endres først',
    /Medlem/.test(await toastText(p) || ''), await toastText(p));
  await clearToast(p);
  r = await setDue(p, 'Plan', null, '2026-06-17');
  log('7c: listen kan ikke flyttes foran kategorien (18.06)',
    r.ok === false && r.due === '2026-06-20' && /Kat/.test(await toastText(p) || ''),
    JSON.stringify(r) + ' ' + await toastText(p));
  await clearToast(p);
  r = await setDue(p, 'Plan', null, '2026-06-18');
  log('7d: et UKATEGORISERT listepunkt (19.06) blokkerer listen på samme måte',
    r.ok === false && /Løst punkt/.test(await toastText(p) || ''),
    JSON.stringify(r) + ' ' + await toastText(p));
  await clearToast(p);
  await setDue(p, 'Plan', 'Løst punkt', '2026-06-18');
  r = await setDue(p, 'Plan', null, '2026-06-18');
  log('7e: … og går gjennom når alle barna er innenfor',
    r.ok === true && r.due === '2026-06-18', JSON.stringify(r));
  r = await setDue(p, 'Plan', null, null);
  log('7f: å fjerne forelderens frist frigjør barna og er alltid lov',
    r.ok === true && r.due === null, JSON.stringify(r));
  await setDue(p, 'Plan', null, '2026-06-20');

  /* ---------- 8) Låste tider blokkerer ikke ---------- */
  r = await setDue(p, 'Låst', null, '2026-06-11');
  log('8a: et listepunkt med LÅSTE tider har ingen aktiv egen verdi og blokkerer ikke listen',
    r.ok === true && r.due === '2026-06-11', JSON.stringify(r));
  log('8b: den skjulte verdien er fortsatt urørt i data',
    (await readDue(p, 'Låst', 'Låst punkt')) === '2026-12-25', await readDue(p, 'Låst', 'Låst punkt'));

  /* ---------- 9) Dato uten klokkeslett ---------- */
  r = await setDue(p, 'Plan', 'Medlem', '2026-06-18T23:30');
  log('9a: fristdatoen varer UT døgnet — barnet samme dag kl. 23:30 er gyldig',
    r.ok === true && r.due === '2026-06-18T23:30', JSON.stringify(r));
  await setDue(p, 'Plan', 'Medlem', '2026-06-18T19:00');
  await setDue(p, 'Plan', 'Kat', '2026-06-18T20:00');
  r = await setDue(p, 'Plan', 'Medlem', '2026-06-18T20:30');
  log('9b: … men har forelderen klokkeslett, er det klokkeslettet som er taket',
    r.ok === false && r.due === '2026-06-18T19:00', JSON.stringify(r));
  await clearToast(p);
  await setDue(p, 'Plan', 'Kat', '2026-06-18');

  /* ---------- 9c) Dato først, klokkeslett etterpå ----------
     Forelderen har klokkeslett; barnets DATO alene tolkes som døgnets slutt og
     avvises. Da skal feltet likevel bli stående, ellers er den normale
     rekkefølgen (dato → klokkeslett) umulig å skrive. */
  // Barnet ryddes bort FØR taket senkes — ellers avviser setteren senkingen.
  await setDue(p, 'Plan', 'Medlem', null);
  await setDue(p, 'Plan', 'Kat', '2026-06-18T17:00');
  await p.evaluate((cid) => {
    const H = window.__huskis;
    H.setActiveGroup(H.state.universes[0].groups[0].id);
    H.state.universes[0].groups[0].cards.find((c) => c.id === cid).collapsed = false;
    H.render();
  }, id.LPLAN);
  await p.waitForTimeout(300);
  await p.locator('.item[data-id="' + id.IMED + '"] > .obj-menu-btn').click();
  await p.waitForTimeout(250);
  await p.locator('#obj-menu-panel .obj-menu-toggle', { hasText: 'Tidsplan' }).click();
  await p.waitForTimeout(400);
  const dF = '#obj-menu-panel .obj-menu-sub .time-group:nth-of-type(2) input[type="date"]';
  const tF = '#obj-menu-panel .obj-menu-sub .time-group:nth-of-type(2) input[type="time"]';
  await p.fill(dF, '2026-06-18');
  await p.locator(dF).blur();
  await p.waitForTimeout(250);
  log('9c: datoen blir stående når et klokkeslett samme dag fortsatt kan redde den',
    (await p.inputValue(dF)) === '2026-06-18' && (await readDue(p, 'Plan', 'Medlem')) === null,
    (await p.inputValue(dF)) + ' / data ' + await readDue(p, 'Plan', 'Medlem'));
  await p.fill(tF, '16:00');
  await p.locator(tF).blur();
  await p.waitForTimeout(250);
  log('9d: … og klokkeslettet etterpå fullfører den gyldige verdien',
    (await readDue(p, 'Plan', 'Medlem')) === '2026-06-18T16:00', await readDue(p, 'Plan', 'Medlem'));
  // En dato som IKKE kan reddes av noe klokkeslett tilbakestilles som før.
  await p.fill(dF, '2026-06-25');
  await p.locator(dF).blur();
  await p.waitForTimeout(250);
  log('9e: en dato utenfor rekkevidde tilbakestilles fortsatt',
    (await p.inputValue(dF)) === '2026-06-18' && (await readDue(p, 'Plan', 'Medlem')) === '2026-06-18T16:00',
    (await p.inputValue(dF)) + ' / data ' + await readDue(p, 'Plan', 'Medlem'));
  await p.keyboard.press('Escape');
  await clearToast(p);
  await p.waitForTimeout(200);
  // Taket løftes FØRST (dato uten klokkeslett varer ut døgnet), så barnet.
  await setDue(p, 'Plan', 'Kat', '2026-06-18');
  await setDue(p, 'Plan', 'Medlem', '2026-06-18T19:00');

  /* ---------- 10) De to UI-veiene ---------- */
  // 10a: tids-popoveren fra frist-chipen på listepunktet.
  await p.evaluate((cid) => {
    const H = window.__huskis;
    H.setActiveGroup(H.state.universes[0].groups[0].id);
    const kort = H.state.universes[0].groups[0].cards.find((c) => c.id === cid);
    kort.collapsed = false;
    H.render();
  }, id.LPLAN);
  await p.waitForTimeout(300);
  await p.locator('.item[data-id="' + id.IMED + '"] .meta-due').click();
  await p.waitForSelector('#time-switcher:not([hidden])');
  const popFør = await p.inputValue('#time-switcher-panel input[type="date"]');
  await p.fill('#time-switcher-panel input[type="date"]', '2026-06-25');
  await p.locator('#time-switcher-panel input[type="date"]').blur();
  await p.waitForTimeout(250);
  const popEtter = await p.inputValue('#time-switcher-panel input[type="date"]');
  const popToast = await toastText(p);
  log('10a: tids-popoveren avviser en ugyldig frist og lar dataene stå',
    (await readDue(p, 'Plan', 'Medlem')) === '2026-06-18T19:00', await readDue(p, 'Plan', 'Medlem'));
  log('10b: feltet tilbakestilles til forrige gyldige verdi',
    popEtter === popFør && popEtter === '2026-06-18', popFør + ' → ' + popEtter);
  log('10c: en kort beskjed, ingen bekreftelsesmodal',
    !!popToast && /Kat/.test(popToast) && (await p.locator('#confirm-modal:not([hidden])').count()) === 0, popToast);
  await p.keyboard.press('Escape');
  await clearToast(p);
  await p.waitForTimeout(200);

  // 10d: objektmenyens tidsskuff på kategorien.
  await p.locator('.category[data-id="' + id.CKAT + '"] > .cat-head > .obj-menu-btn').click();
  await p.waitForTimeout(250);
  await p.locator('#obj-menu-panel .obj-menu-toggle', { hasText: 'Tidsplan' }).click();
  await p.waitForTimeout(400);
  const dueField = '#obj-menu-panel .obj-menu-sub .time-group:nth-of-type(2) input[type="date"]';
  const menyFør = await p.inputValue(dueField);
  await p.fill(dueField, '2026-06-28');
  await p.locator(dueField).blur();
  await p.waitForTimeout(250);
  const menyEtter = await p.inputValue(dueField);
  const menyToast = await toastText(p);
  log('10d: objektmenyens tidsskuff avviser den samme fristen — samme validering',
    (await readDue(p, 'Plan', 'Kat')) === '2026-06-18', await readDue(p, 'Plan', 'Kat'));
  log('10e: feltet tilbakestilles der også',
    menyEtter === menyFør && menyEtter === '2026-06-18', menyFør + ' → ' + menyEtter);
  log('10f: og beskjeden peker på listen som taket',
    !!menyToast && /Plan/.test(menyToast), menyToast);
  await p.keyboard.press('Escape');
  await clearToast(p);
  await p.waitForTimeout(200);

  /* ---------- 11) Eldre brudd ---------- */
  r = await setDue(p, 'Gammel', null, '2026-06-11');
  log('11b: et barn som ALLEREDE bryter regelen blokkerer ikke forelderen',
    r.ok === true && r.due === '2026-06-11', JSON.stringify(r));
  log('11c: bruddet ble fortsatt ikke mutert',
    (await readDue(p, 'Gammel', 'Brudd')) === '2026-06-25', await readDue(p, 'Gammel', 'Brudd'));
  r = await setDue(p, 'Gammel', 'Brudd', '2026-06-24');
  log('11d: bruddet kan ikke bekreftes på nytt — også en NY ugyldig verdi avvises',
    r.ok === false && r.due === '2026-06-25', JSON.stringify(r));
  await clearToast(p);
  r = await setDue(p, 'Gammel', 'Brudd', '2026-06-10');
  log('11e: … men en verdi innenfor taket går gjennom og retter opp bruddet',
    r.ok === true && r.due === '2026-06-10', JSON.stringify(r));
  // Tilbake til brudd, og se at tidseditoren sier fra.
  await p.evaluate(() => {
    const H = window.__huskis;
    const kort = H.state.universes[0].groups[0].cards.find((c) => c.title === 'Gammel');
    kort.items.find((i) => i.text === 'Brudd').due = '2026-06-25';
    H.render();
  });
  await p.waitForTimeout(300);
  await p.locator('.card[data-id="' + id.LGML + '"] .item[data-id="' + id.IBRUDD + '"] > .obj-menu-btn').click();
  await p.waitForTimeout(250);
  await p.locator('#obj-menu-panel .obj-menu-toggle', { hasText: 'Tidsplan' }).click();
  await p.waitForTimeout(400);
  const note = await p.evaluate(() => {
    const n = document.querySelector('#obj-menu-panel .obj-menu-sub .time-note');
    return n && !n.hidden ? { tekst: n.textContent, dempet: n.classList.contains('is-muted') } : null;
  });
  log('11f: tidseditoren viser bruddet som en tydelig, ikke-blokkerende beskjed',
    !!note && /Gammel/.test(note.tekst) && note.dempet === false, JSON.stringify(note));
  await p.keyboard.press('Escape');
  await p.waitForTimeout(200);

  /* ---------- 11g) Synken tåler bruddet ---------- */
  await p.evaluate(() => window.__huskis.cloudCycle());
  await p.waitForFunction(() => {
    const el = document.getElementById('sync-status');
    return el && el.dataset.state === 'saved';
  }, null, { timeout: 15000, polling: 200 });
  const iDB = await p.evaluate(() => {
    const db = JSON.parse(localStorage.getItem('hk-mock-db') || '{}');
    const row = (db.items || []).find((i) => i.text === 'Brudd');
    return row ? row.due_at : null;
  });
  log('11g: bruddet synkes uendret — ingen normalisering rører det',
    iDB === '2026-06-25', iDB);

  log('ingen JS-feil', errs.length === 0, errs.join(' | '));
  await browser.close();

  const ok = results.filter(Boolean).length;
  console.log('\n==== ' + ok + '/' + results.length + ' PASS ====');
  process.exit(ok === results.length ? 0 : 1);
})();
