/*
  Regresjonstest: PLANEN FRAMOVER (docs/varsler.md, «Planen»).

  PR 3B leverer de samme varslene ut av appen. Det som gjør det mulig når appen
  er LUKKET er at generatoren også ser framover: `planNotifications()` er den
  samme rene funksjonen som `collectNotifications()`, med vinduet snudd. Radene
  den gir logges med `at` fram i tid — usynlige til de forfaller, akkurat som et
  utsatt varsel — og det er de radene Android planlegger lokalt og web push
  leverer fra serveren.

  Dekker:
     1. Horisonten: en terskel innenfor 30 døgn er planlagt, en utenfor er det
        ikke — og en hendelse kan ha den ene terskelen inne og den andre ute.
     2. Planen er de SAMME tersklene som historikken, bare framover: ingen ny
        type, ingen ny nøkkel, samme `at` som terskelen faktisk har.
     3. De fire preferansene styrer planen på nøyaktig samme måte.
     4. Taket: aldri mer enn 40 planlagte rader, og det er de NÆRMESTE som
        beholdes.
     5. Hele veien gjennom serveren: planen logges, den er USYNLIG i modalen og
        teller ikke som ulest, og en ny runde dupliserer den ikke.
     6. Utboksen for web push fylles av den samme operasjonen — én rad per
        (planlagt varsel, aktivt abonnement) — og bare for PLANLAGTE rader.
     7. Avlysning: fullføres listepunktet, forsvinner den planlagte raden (og
        leveringen med den) — mens et varsel som ALLEREDE er levert blir
        stående i historikken. Det er forskjellen på en plan og en historikk.
     8. Endret frist: den gamle planen forsvinner, den nye legges.
     9. Tidssonen: en enhet som ikke holder sonen planen tilhører, planlegger
        ikke og rører ikke andres plan — men logger historikk som før.

  Kjør:
    python3 -m http.server 8000                        # fra repo-roten, i egen terminal
    NODE_PATH=$(npm root -g) node tests/notif-plan.test.js
*/
const { chromium } = require('playwright');

const BASE = process.env.HUSKIS_URL || 'http://localhost:8000';
const results = [];
const log = (n, ok, x = '') => {
  results.push(ok);
  console.log((ok ? 'PASS' : 'FAIL') + ' — ' + n +
    (x !== '' ? '  [' + (typeof x === 'string' ? x : JSON.stringify(x)) + ']' : ''));
};

const U = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
  const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
});

const uid = 'uP';
const id = {};
['UA', 'GA', 'L10', 'L35', 'L60', 'LFERDIG', 'I10', 'I35', 'I60', 'IFERDIG'].forEach((k) => { id[k] = U(); });

/* Fiksturens datoer regnes ut I SIDEN, ikke i node: serverveien går på den ekte
   klokka, og «om ti døgn» må være ti døgn i NETTLESERENS lokale tid — ellers
   ville et døgnskifte i en annen sone flyttet en terskel over horisonten og
   gjort testen tilfeldig. */
async function fiksturDatoer(p) {
  return p.evaluate(() => {
    const stamp = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') +
      '-' + String(d.getDate()).padStart(2, '0') + 'T12:00';
    const om = (n) => stamp(new Date(Date.now() + n * 24 * 3600 * 1000));
    return { d10: om(10), d35: om(35), d60: om(60), d20: om(20) };
  });
}

function buildDB(D) {
  const base = (x) => Object.assign({
    trashed: false, locked: false, unlocked: false, invite_policy: 'inherit',
    collapsed: false, is_cat: false, cat_id: null,
    start_at: null, due_at: null, lock_times: false,
    ts: 1, org: 'v', pos: 0, pos_ts: 1, pos_org: 'v',
  }, x);
  const card = (i, t, e) => base(Object.assign(
    { id: i, owner_id: uid, group_id: id.GA, title: t, k: true, p: true, lab_ts: 0, lab_org: '' }, e || {}));
  const item = (i, c, t, e) => base(Object.assign(
    { id: i, owner_id: uid, card_id: c, text: t, done: false }, e || {}));
  return {
    _rolesBackfilled: true,
    profiles: [{ id: uid, email: 'p@x.no', display_name: 'Plan', user_metadata: {} }],
    passwords: { 'p@x.no': 'x' },
    universes: [base({ id: id.UA, owner_id: uid, name: 'Planområde' })],
    groups: [base({ id: id.GA, owner_id: uid, universe_id: id.UA, name: 'Mappe' })],
    cards: [
      // Ti døgn fram: BEGGE tersklene er innenfor horisonten (dueSoon om 3, dueOver om 10).
      card(id.L10, 'Om ti', { due_at: D.d10 }),
      // 35 døgn fram: dueSoon (om 28) er innenfor, dueOver (om 35) er utenfor.
      card(id.L35, 'Om trettifem', { pos: 1, due_at: D.d35 }),
      // 60 døgn fram: begge tersklene er utenfor horisonten.
      card(id.L60, 'Om seksti', { pos: 2, due_at: D.d60 }),
      // Til avlysningstesten.
      card(id.LFERDIG, 'Blir ferdig', { pos: 3, due_at: D.d20 }),
    ],
    items: [
      item(id.I10, id.L10, 'Punkt'),
      item(id.I35, id.L35, 'Punkt'),
      item(id.I60, id.L60, 'Punkt'),
      item(id.IFERDIG, id.LFERDIG, 'Punkt'),
    ],
    memberships: [{ id: U(), user_id: uid, universe_id: id.UA, group_id: null, role: 'owner', pos: 0, created_at: 1 }],
    share_invites: [], tombstones: [], notifications: [], notification_prefs: [],
    push_subscriptions: [], push_deliveries: [],
  };
}

async function seed(p, db) {
  await p.evaluate(({ db, uid }) => {
    localStorage.clear(); sessionStorage.clear();
    localStorage.setItem('hk-mock-db', JSON.stringify(db));
    sessionStorage.setItem('hk-mock-session', JSON.stringify({
      id: uid, email: 'p@x.no',
      user_metadata: { onboarding: { v: 3, status: 'done' }, tips: { drag: true, trash: true, moveList: true, dragTrash: true } },
    }));
  }, { db, uid });
  await p.goto(BASE + '/?mock=1');
  await p.waitForFunction(() => {
    const H = window.__huskis;
    return H && H.authUser && H.lastMy && H.state.universes.length > 0;
  }, null, { timeout: 15000, polling: 200 });
}

async function cycle(p) {
  await p.evaluate(() => window.__huskis.cloudCycle());
  await p.waitForFunction(() => {
    const el = document.getElementById('sync-status');
    return !el || el.dataset.state !== 'saving';
  }, null, { timeout: 8000, polling: 100 }).catch(() => {});
  await p.waitForTimeout(400);
}

const db = (p) => p.evaluate(() => window.HK_MOCK._loadDB());

async function run() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 },
    timezoneId: 'Europe/Oslo', locale: 'nb-NO' });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));

  await p.goto(BASE + '/?mock=1');
  const D = await fiksturDatoer(p);
  await seed(p, buildDB(D));

  const plan = () => p.evaluate(() => window.__huskis.planNotifications(null, Date.now(), null)
    .map((r) => ({ n: r.name, t: r.type, om: Math.round((r.at - Date.now()) / 86400000) })));

  /* ---------- 1) Horisonten ---------- */
  const P = await plan();
  const navn = P.map((r) => r.t + ':' + r.n);
  log('1a: begge tersklene til en frist ti døgn fram er planlagt',
    navn.includes('dueSoon:Om ti') && navn.includes('dueOver:Om ti'), JSON.stringify(navn));
  log('1b: 35 døgn fram: «under en uke»-terskelen er innenfor horisonten',
    navn.includes('dueSoon:Om trettifem'), JSON.stringify(navn));
  log('1c: … men selve fristen ligger utenfor og planlegges ikke ennå',
    !navn.includes('dueOver:Om trettifem'), JSON.stringify(navn));
  log('1d: 60 døgn fram gir ingen terskler i det hele tatt',
    !navn.some((x) => x.indexOf('Om seksti') > -1), JSON.stringify(navn));

  /* ---------- 2) Samme terskler, bare framover ---------- */
  const dagerTil = {};
  P.forEach((r) => { dagerTil[r.t + ':' + r.n] = r.om; });
  log('2a: «under en uke»-terskelen ligger nøyaktig sju døgn før fristen',
    dagerTil['dueSoon:Om ti'] === 3 && dagerTil['dueOver:Om ti'] === 10,
    JSON.stringify(dagerTil));
  log('2b: nøkkelen er den samme formen som historikkens (type|objekttype|id|tidsverdi)',
    await p.evaluate((cid) => window.__huskis.planNotifications(null, Date.now(), null)
      .every((r) => r.key === r.type + '|' + r.obj_type + '|' + r.obj_id + '|' + r.value) &&
      window.__huskis.planNotifications(null, Date.now(), null)
        .some((r) => r.obj_id === cid), id.L10));
  log('2c: alle planlagte terskler ligger FRAM i tid',
    P.every((r) => r.om > 0), JSON.stringify(P.map((r) => r.om)));

  /* ---------- 3) Preferansene ---------- */
  const utenSoon = await p.evaluate(() => window.__huskis
    .planNotifications(null, Date.now(), { dueOver: true, dueSoon: false, startNow: true, startSoon: true })
    .map((r) => r.type));
  log('3: en avslått type planlegges ikke — som den ikke logges',
    !utenSoon.includes('dueSoon') && utenSoon.includes('dueOver'), JSON.stringify(utenSoon));

  /* ---------- 4) Taket, og at det er de NÆRMESTE som beholdes ---------- */
  const tak = await p.evaluate(() => {
    const H = window.__huskis;
    const g = H.state.universes[0].groups[0];
    const før = g.cards.length;
    // 60 lister med hver sin frist, spredt over de neste 25 døgnene.
    for (let i = 0; i < 60; i++) {
      const d = new Date(Date.now() + (i % 25 + 1) * 86400000);
      g.cards.push({
        id: 'tak-' + i, title: 'Tak ' + i, trashed: false, locked: false, collapsed: false,
        k: true, p: true, start: null, due: d.getFullYear() + '-' +
          String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') + 'T12:00',
        lockTimes: false, items: [{ id: 'takp-' + i, text: 'x', done: false, trashed: false }],
      });
    }
    const rows = H.planNotifications(null, Date.now(), null);
    g.cards.length = før;    // rydd opp igjen
    const av = rows.map((r) => r.at - Date.now()).sort((a, b) => a - b);
    return { antall: rows.length, sortert: rows.every((r, i) => i === 0 || r.at >= rows[i - 1].at),
             lengst: Math.round(av[av.length - 1] / 86400000) };
  });
  log('4a: aldri mer enn 40 planlagte rader', tak.antall === 40, tak.antall);
  log('4b: … og det er de NÆRMESTE tersklene som beholdes (nærmest først, ingen langt ute)',
    tak.sortert && tak.lengst <= 25, JSON.stringify(tak));

  /* ---------- 5) Hele veien gjennom serveren ---------- */
  await cycle(p);   // første runde setter markøren
  await cycle(p);   // andre runde skriver planen
  const etter = await db(p);
  const planlagte = etter.notifications.filter((n) => n.at > Date.now());
  log('5a: planen ligger på serveren som vanlige varselrader, med `at` fram i tid',
    planlagte.length === P.length, planlagte.length + ' av ' + P.length);
  log('5b: ingen av dem er merket som utsatt — de er generatorens, ikke brukerens',
    planlagte.every((n) => !n.snoozed));
  const synlig = await p.evaluate(() => {
    window.__huskis.openNotifModal();
    const n = document.querySelectorAll('#notif-body .notif-row').length;
    const badge = document.getElementById('notif-badge');
    window.__huskis.closeNotifModal();
    return { rader: n, badgeSkjult: badge.hidden, tom: !!document.querySelector('#notif-body .notif-empty') };
  });
  log('5c: planen er USYNLIG i modalen og teller ikke som ulest',
    synlig.rader === 0 && synlig.badgeSkjult === true, JSON.stringify(synlig));
  const før6 = etter.notifications.length;
  await cycle(p);
  const etter6 = (await db(p)).notifications.length;
  log('5d: en ny runde dupliserer ikke planen', før6 === etter6, før6 + ' → ' + etter6);

  /* ---------- 6) Utboksen for web push ---------- */
  await p.evaluate(() => window.__huskis.webChannel.register({
    endpoint: 'https://push.test/enhet-1',
    getKey: (n) => new Uint8Array(n === 'auth' ? 16 : 65).buffer,
  }));
  await p.evaluate(() => window.__huskis.webChannel.register({
    endpoint: 'https://push.test/enhet-2',
    getKey: (n) => new Uint8Array(n === 'auth' ? 16 : 65).buffer,
  }));
  await cycle(p);
  const d6 = await db(p);
  const planIds = new Set(d6.notifications.filter((n) => n.at > Date.now()).map((n) => n.id));
  log('6a: to enheter gir to leveringer per planlagt varsel',
    d6.push_deliveries.length === planIds.size * 2,
    d6.push_deliveries.length + ' leveringer for ' + planIds.size + ' planlagte varsler × 2 enheter');
  log('6b: utboksen inneholder KUN planlagte varsler — ikke historikk',
    d6.push_deliveries.every((x) => planIds.has(x.notification_id)));
  log('6c: leveringen forfaller når varselet forfaller',
    d6.push_deliveries.every((x) => {
      const n = d6.notifications.find((y) => y.id === x.notification_id);
      return n && x.due_at === n.at;
    }));
  log('6d: doc-et forteller hvor mange enheter som er på',
    (await p.evaluate(() => window.__huskis.notifPushDevices)) === 2);

  /* ---------- 7) Avlysning ved fullføring ---------- */
  const førFerdig = (await db(p)).notifications.filter((n) => n.at > Date.now())
    .filter((n) => n.name === 'Blir ferdig').length;
  await p.evaluate((iid) => {
    const H = window.__huskis;
    const c = H.state.universes[0].groups[0].cards.find((x) => x.title === 'Blir ferdig');
    c.items.find((i) => i.id === iid).done = true;
    H.save();
  }, id.IFERDIG);
  await cycle(p);
  await cycle(p);
  const d7 = await db(p);
  const igjen = d7.notifications.filter((n) => n.name === 'Blir ferdig');
  log('7a: listen hadde planlagte varsler før fullføringen', førFerdig > 0, førFerdig);
  log('7b: fullføring avlyser den framtidige planen', igjen.length === 0, igjen.length);
  log('7c: … og leveringene forsvant med den (kaskaden)',
    d7.push_deliveries.every((x) => d7.notifications.some((n) => n.id === x.notification_id)));

  /* ---------- 8) Endret frist ---------- */
  const nøklerFør = (await db(p)).notifications.filter((n) => n.name === 'Om ti').map((n) => n.key).sort();
  const nyDato = await p.evaluate(() => {
    const d = new Date(Date.now() + 12 * 86400000);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0') + 'T12:00';
  });
  await p.evaluate((v) => {
    const H = window.__huskis;
    const c = H.state.universes[0].groups[0].cards.find((x) => x.title === 'Om ti');
    H.setObjectTime({ card: c, obj: c }, 'due', v);
  }, nyDato);
  await cycle(p);
  await cycle(p);
  const nøklerEtter = (await db(p)).notifications.filter((n) => n.name === 'Om ti').map((n) => n.key).sort();
  log('8a: den gamle planen for listen er borte',
    nøklerFør.length > 0 && nøklerEtter.every((k) => nøklerFør.indexOf(k) === -1),
    JSON.stringify({ før: nøklerFør.length, etter: nøklerEtter.length }));
  log('8b: … og den nye tidsplanen er lagt', nøklerEtter.length === nøklerFør.length,
    nøklerEtter.length + ' av ' + nøklerFør.length);

  /* ---------- 9) Tidssonen planen tilhører ---------- */
  const sone = await p.evaluate(() => ({
    min: window.__huskis.deviceTz(), planens: window.__huskis.notifPlanTz,
  }));
  log('9a: enheten hevdet sonen sin ved første runde',
    sone.min === 'Europe/Oslo' && sone.planens === 'Europe/Oslo', JSON.stringify(sone));

  /* En enhet i en ANNEN sone. Sonen leses ut av `Intl`, så den byttes der —
     en egen nettleserkontekst ville hatt sin egen mock-database, og da hadde
     det ikke vært den SAMME planen de to enhetene så på. */
  const planFør = (await db(p)).notifications.filter((n) => n.at > Date.now()).length;
  await p.evaluate(() => {
    const ekte = Intl.DateTimeFormat.prototype.resolvedOptions;
    window.__ekteSone = ekte;
    Intl.DateTimeFormat.prototype.resolvedOptions = function () {
      return Object.assign(ekte.call(this), { timeZone: 'Asia/Tokyo' });
    };
  });
  log('9b: enheten melder nå en annen sone enn den planen tilhører',
    (await p.evaluate(() => window.__huskis.deviceTz())) === 'Asia/Tokyo');
  await cycle(p);
  await cycle(p);
  const d9 = await db(p);
  log('9c: den overtar ikke planen med det samme (hevdelsen er fersk)',
    d9.notification_prefs[0].tz === 'Europe/Oslo', d9.notification_prefs[0].tz);
  log('9d: … og lar planen stå urørt i stedet for å regne den om i sin egen sone',
    d9.notifications.filter((n) => n.at > Date.now()).length === planFør,
    d9.notifications.filter((n) => n.at > Date.now()).length + ' av ' + planFør);
  // Når hevdelsen er blitt gammel nok, overtar den — og planen regnes om.
  await p.evaluate(() => {
    const d = window.HK_MOCK._loadDB();
    d.notification_prefs.forEach((r) => { r.tz_at = 0; });
    window.HK_MOCK._saveDB(d);
  });
  await cycle(p);
  await cycle(p);
  await cycle(p);
  const d9b = await db(p);
  log('9e: en gammel hevdelse overtas av enheten som faktisk er i bruk',
    d9b.notification_prefs[0].tz === 'Asia/Tokyo', d9b.notification_prefs[0].tz);
  log('9f: … og planen er regnet om, med like mange terskler som før',
    d9b.notifications.filter((n) => n.at > Date.now()).length === planFør,
    d9b.notifications.filter((n) => n.at > Date.now()).length + ' av ' + planFør);
  await p.evaluate(() => { Intl.DateTimeFormat.prototype.resolvedOptions = window.__ekteSone; });

  log('ingen JS-feil', errs.length === 0, errs.join(' | ') || 'ingen');
  await browser.close();
}

run().then(() => {
  const ok = results.filter(Boolean).length;
  console.log('\n==== ' + ok + '/' + results.length + ' PASS ====');
  process.exit(ok === results.length ? 0 : 1);
}).catch((e) => { console.error(e); process.exit(1); });
