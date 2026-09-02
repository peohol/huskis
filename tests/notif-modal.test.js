/*
  Regresjonstest: VARSELKNAPPEN og VARSELMODALEN (docs/varsler.md).
  Generatoren og synkingen har sin egen fil (`notifications.test.js`); her
  testes flaten.

  Radene seedes rett inn i mock-databasen, ikke gjennom generatoren: da er
  rekkefølge, lest/ulest, angre-vinduet og «Utsett» det som faktisk måles.

  Dekker:
     1. Bjelleknappen ligger FØRST i toppkontrollgruppen, og badgen viser
        antall uleste — skjult ved 0, «99+» over hundre, og antallet er med i
        knappens ARIA-navn (badgen selv er aria-hidden).
     2. Modalen: dialogsemantikk, nyeste ØVERST, ikon/flate per varseltype, og
        raden i tre linjer — kontekststi (svært liten), objektnavn og melding.
        Ingen rad bærer et eget tidsstempel; datoen står over bunken.
     3. Tomtilstand.
     4. Åpning markerer lest — men bare det som sto der da modalen ble åpnet.
        Et varsel som ankommer ETTERPÅ forblir ulest, også med modalen åpen.
     5. Trykk på en rad navigerer via `navigateToObject()`.
     6. Et varsel som ikke gjelder lenger SLETTES: målet er borte, eller tiden
        varselet gjaldt er endret.
     7. «Tøm varsler»: øyeblikksbildet skjules straks, knappen blir «Angre · 10»
        og teller ned, «Angre» gjenoppretter, og et varsel som ankommer ETTER
        øyeblikksbildet blir ikke slettet med det.
     8. Lukking av modalen committer slettingen med én gang.
     9. «Utsett» åpner en POPOVER forankret i knappen, med overskrift og fire
        valg (1 time / 6 timer / 1 døgn / Egendefinert). Den egendefinerte
        skuffen avviser et tidspunkt som alt er passert og logger ett varsel på
        nøyaktig det tidspunktet som velges — usynlig til det forfaller, og med
        det opprinnelige kvittert som lest.
    10. Preferansepanelet: fire varseltypebrytere, et bytte lagres på kontoen,
        en separat enhetskanal kan komme i tillegg, og hodets to tilstander —
        tannhjulet inn, tilbakeknappen til venstre for overskriften ut, og ingen
        forklaringstekst over bryterne.
    11. Tastatur og fokus: Escape lukker, og fokus går tilbake til bjellen.
    12. i18n: hele flaten på engelsk.
    13. Kontobytte UTEN utlogging (Supabase kan gå rett fra én bruker til en
        annen): historikken og badgen nullstilles med én gang, ikke først når
        den nye brukerens pull svarer — den kan utebli helt offline.
    14. Datooverskriftene («I dag», «I går», ukedag + full dato) og meldingene,
        som navngir de tre nærmeste døgnene i stedet for å skrive datoen ut.
    15. Varsel-toastene: historikken toaster ikke, et nytt varsel gjør det —
        med typens tone, halvgjennomsiktig flate og blur, ut fra bjelleknappen.
        Sveip fjerner den, trykk fører til varselet i modalen og rydder hele
        stabelen, og ingen toast kommer oppå et lag som alt står åpent
        (varselmodalen selv eller en annen modal).
    16. Midnatt: en modal som står ÅPEN over midnatt maler seg om av seg selv
        («I dag» → «I går»), også når appen ligger stille og ingen synk-runde
        rører den. Klokka pinnes rett før midnatt og spoles forbi.
    17. Slett-knappen på raden tar ÉN rad, også fra kontoen.
    18. Døgnskiftet kan ikke treffe et LØP: hver kontekst pinnes midt på dagen,
        så fiksturens døgn og appens er det samme fra første til siste sjekk —
        uansett hva riggens klokke sto på da suiten ble startet.
    19. Sommertid: et lokalt døgn er 23 eller 25 timer gjennom en overgang, og
        fiksturens tidspunkter regnes fra døgnets egne grenser — ikke i
        millisekunder fra midnatt. Målt på Oslos to overganger i 2026.

  MERK om fiksturen: objektene BÆRER tidene varslene handler om. En rad hvis
  verdi ikke lenger stemmer med objektets tid ryddes bort av appen selv
  (docs/varsler.md), så et tidløst objekt ville tømt historikken i første
  synk-runde. `settTid()` holder de to i takt der en test endrer tid.

  MERK om TIDEN: hver kontekst lages av `nySide`, som setter tidssonen OG
  pinner klokka til kl. 12 lokalt før siden navigerer. Alle tider fiksturen
  bruker hentes så fra SIDEN (`sideklokke`), aldri fra `new Date()` i
  testprosessen — den står i en annen sone og på en annen klokke. Tre feller,
  alle tre stengt:
    · sonen        — nettleseren daterer i `TZ`, Node i CI i UTC;
    · døgnstarten  — «nå minus en time» er i går hver gang testen kjører den
                     første timen etter midnatt (`nettopp` klemmer innenfor);
    · døgnskiftet  — et løp som selv krysser midnatt daterer i ett døgn og
                     sjekker i et annet (pinningen holder midnatt tolv timer
                     unna; 18 er regresjonstesten).

  Kjøres på BÅDE desktop- og mobil-viewport.

  Kjør:
    python3 -m http.server 8000                        # fra repo-roten, i egen terminal
    NODE_PATH=$(npm root -g) node tests/notif-modal.test.js
    HUSKIS_TZ=Etc/GMT+8 NODE_PATH=$(npm root -g) node tests/notif-modal.test.js
*/
const { chromium } = require('playwright');

const BASE = process.env.HUSKIS_URL || 'http://localhost:8000';
const results = [];
const log = (n, ok, x = '') => { results.push(ok); console.log((ok ? 'PASS' : 'FAIL') + ' — ' + n + (x !== '' ? '  [' + (typeof x === 'string' ? x : JSON.stringify(x)) + ']' : '')); };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/* ÉN tidssone for hele filen, og den settes på KONTEKSTEN — ikke på
   testprosessen. Appen daterer alt etter NETTLESERENS klokke, så sonen her er
   fasiten på hva «i dag» betyr; `HUSKIS_TZ` lar den samme filen kjøres i andre
   døgnkonstellasjoner uten å vente på klokka. */
const TZ = process.env.HUSKIS_TZ || 'Europe/Oslo';

// Klokkeslettet `kl` ([time, minutt, sekund] lokalt) i SIDENS inneværende
// døgn, som absolutt øyeblikk. Regnes i siden, som er den eneste som kjenner
// sonen sin — og som etter en `clock.install` er den eneste som kjenner
// klokka si.
const lokaltKl = (p, kl) => p.evaluate((kl) => {
  const d = new Date();
  d.setHours(kl[0], kl[1] || 0, kl[2] || 0, 0);
  return d.getTime();
}, kl);

/* KONTEKST OG SIDE I ETT, MED KLOKKA PINNET MIDT PÅ DAGEN.

   Fiksturen daterer radene sine i sidens døgn (`sideklokke`), og appen tegner
   dem i det samme døgnet. Det holder bare så lenge løpet ikke KRYSSER et
   døgnskifte underveis: skjer det, er radene datert i går mens appen tegner i
   dag, og «I dag»-sjekkene faller — ikke fordi appen tar feil, men fordi
   kalenderen skiftet midt i løpet.

   Klokka settes derfor til kl. 12 lokalt i den datoen riggen står i, og får
   så gå normalt videre (`resume`): timerne — synk, nedtellinger, toaster —
   måles på ekte tid som før, men midnatt er tolv timer unna uansett når
   suiten startes. Et løp på et minutt kan da ikke nå fram til det.

   Fordi klokka må pinnes FØR siden navigerer, lages konteksten og siden her
   sammen — et nytt løp kan da verken komme inn med sin egen sone eller uten
   pinningen.

   - `kl`   pinner et annet klokkeslett; løpet som SKAL over midnatt (16)
            bruker det.
   - `rigg` later som om riggens egen klokke sto et annet sted da pinningen
            regnet: `[time, minutt, sekund]` i dagens dato, eller et absolutt
            øyeblikk (ms eller Date) for et løp som må stå på en BESTEMT dato.
            Brukes av regresjonstestene — 18, som viser at pinningen virker fra
            en rigg rett før midnatt, og 19, som må stå på en kjent
            sommertidsovergang — uten å vente til klokka faktisk er der. */
async function nySide(browser, opts) {
  const o = Object.assign({ timezoneId: TZ, locale: 'nb-NO' }, opts || {});
  const kl = o.kl || [12, 0, 0];
  const rigg = o.rigg;
  delete o.kl; delete o.rigg;
  const ctx = await browser.newContext(o);
  const p = await ctx.newPage();
  // Riggens klokke først (ekte, eller den `rigg` later som), så pinningen —
  // ett løp gjennom den samme koden i alle tilfeller.
  const riggTid = Array.isArray(rigg) ? await lokaltKl(p, rigg) : rigg;
  await p.clock.install(rigg ? { time: new Date(riggTid) } : {});
  await p.clock.resume();
  await p.clock.setSystemTime(new Date(await lokaltKl(p, kl)));
  return p;
}

/* FIKSTURENS TIDER REGNES I SIDEN, IKKE I NODE.
   Nettleseren står i `TZ` og på en pinnet klokke (`nySide`); testprosessen
   står i sin egen sone (UTC i CI) og på riggens klokke. Regnes «i dag» eller
   «for et minutt siden» i Node, er de to ute av takt — og filen går rødt av
   kalenderen i stedet for av koden (issue #173). Ett oppslag i siden gir
   grunnlaget; resten regnes ut av det.

   Én gang per løp: sonen står fast, klokka er pinnet, og radene ligger
   sekunder — ikke timer — fra hverandre. */
async function sideklokke(p) {
  const t = await p.evaluate((spenn) => {
    const n = new Date();
    const pad2 = (x) => String(x).padStart(2, '0');
    /* Lokal midnatt for hvert døgn fiksturene kan trenge, regnet av
       kalenderen i siden — ikke som `midnatt ± n · 24 t`, som bommer med en
       time gjennom en sommertidsovergang. */
    const midnatt = {};
    for (let o = -spenn; o <= spenn; o++) {
      const d = new Date();
      // Kl. 12 FØRST: et døgnbytte regnet fra et klokkeslett som ikke finnes
      // (timen sommertiden hopper over) normaliseres videre og kan skli en dag.
      // Kl. 12 finnes hver eneste dag.
      d.setHours(12, 0, 0, 0);
      d.setDate(d.getDate() + o);
      d.setHours(0, 0, 0, 0);
      midnatt[o] = d.getTime();
    }
    return { ms: Date.now(), midnatt: midnatt,
      iDag: n.getFullYear() + '-' + pad2(n.getMonth() + 1) + '-' + pad2(n.getDate()) };
  }, 8);   // ett hakk mer enn `dag`/`døgnstart` brukes med: `midtPåDøgnet` leser off + 1
  /* Døgnet `off` dager fra sidens i dag, som datostreng. UTC-regningen er et
     rent kalendertriks: en datostreng bærer ingen sone, og et UTC-døgn er
     alltid 24 timer, så månedsskifte og skuddår treffer uten at sommertid kan
     skli inn i regnestykket. */
  const dag = (off) => {
    const d = new Date(t.iDag + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + off);
    return d.toISOString().slice(0, 10);
  };
  /* Lokal midnatt `off` døgn unna — og MIDT i det døgnet, regnet som halvveis
     mellom denne døgnstarten og den neste. Ikke «midnatt + 12 t»: et lokalt
     døgn er 23 eller 25 timer gjennom en sommertidsovergang, og da er
     midnatt + 12 t hverken kl. 12 eller midt i noe. Midtpunktet er det
     fiksturen faktisk vil ha — et tidspunkt som ikke kan skli ut av døgnet
     sitt. */
  const døgnstart = (off) => t.midnatt[off];
  const midtPåDøgnet = (off) => t.midnatt[off] + (t.midnatt[off + 1] - t.midnatt[off]) / 2;
  /* Rett etter at døgnet `off` begynte, og rett før det slutter. Begge er
     uttrykt fra døgnets EGNE grenser — en halvtime inn fra hver ende — så de
     ligger i det døgnet enten det er 23, 24 eller 25 timer langt. Et
     klokkeslett regnet i millisekunder fra midnatt ville sklidd ut. */
  const tidligIDøgnet = (off) => t.midnatt[off] + 30 * 60000;
  const sentIDøgnet = (off) => t.midnatt[off + 1] - 30 * 60000;
  /* «For et øyeblikk siden» — men aldri før midnatt, og aldri fram i tid. En
     rad må være PASSERT for å være synlig, og samtidig ligge i DAGENS døgn:
     seedes den som «nå minus en time», havner den i går hver gang testen
     kjører den første timen etter midnatt. `k` teller ett trinn bakover per
     rad, nyeste først; trinnet er ett sekund når det er plass og krymper mot
     midnatt, så tretti rader får plass uansett hvor ungt døgnet er. */
  const steg = Math.max(0, Math.min(30000, t.ms - t.midnatt[0])) / 30;
  const nettopp = (k) => Math.round(t.ms - (k + 1) * steg);
  /* «For `ms` millisekunder siden», målt på SIDENS klokke. Radene må ligge i
     fortiden for å være synlige, og siden klokka er pinnet er testprosessens
     `Date.now()` et helt annet tall — den kan ikke brukes til dette. */
  const sidenNå = (ms) => t.ms - ms;
  return { dag, døgnstart, midtPåDøgnet, tidligIDøgnet, sentIDøgnet, nettopp, sidenNå };
}

/* Døgnet fiksturen ble datert i skal stå til siste sjekk i løpet. Pinningen i
   `nySide` gjør at det ikke KAN skli; dette er nettet som sier fra hvis den
   noen gang blir borte. */
const sammeDøgn = (p, k) => p.evaluate((d) => {
  const n = new Date();
  const q = (x) => String(x).padStart(2, '0');
  return n.getFullYear() + '-' + q(n.getMonth() + 1) + '-' + q(n.getDate()) === d;
}, k.dag(0));

const U = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
  const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
});

function buildDB() {
  const uid = 'uM';
  const id = { UA: U(), GA: U(), C1: U(), C2: U(), C3: U(), I1: U(), I2: U(), I3: U() };
  const base = (x) => Object.assign({
    trashed: false, locked: false, unlocked: false, invite_policy: 'inherit',
    collapsed: false, is_cat: false, cat_id: null,
    start_at: null, due_at: null, lock_times: false,
    ts: 1, org: 'm', pos: 0, pos_ts: 1, pos_org: 'm',
  }, x);
  const card = (i, t, pos, tid) => base(Object.assign({ id: i, owner_id: uid, group_id: id.GA,
    title: t, pos: pos, k: true, p: true, lab_ts: 0, lab_org: '' }, tid || {}));
  const item = (i, c, t, tid) => base(Object.assign({ id: i, owner_id: uid, card_id: c,
    text: t, done: false }, tid || {}));
  return { id, uid, db: {
    _rolesBackfilled: true,
    // Bruker B finnes bare for kontobytte-testen nederst: Supabase kan gå rett
    // fra én innlogget bruker til en annen UTEN et SIGNED_OUT imellom.
    profiles: [
      { id: uid, email: 'm@x.no', display_name: 'Modal', user_metadata: {} },
      { id: 'uB', email: 'b@x.no', display_name: 'Bytte', user_metadata: {} },
    ],
    passwords: { 'm@x.no': 'x', 'b@x.no': 'x' },
    universes: [base({ id: id.UA, owner_id: uid, name: 'Arbeid' })],
    groups: [base({ id: id.GA, owner_id: uid, universe_id: id.UA, name: 'Klinikk' })],
    /* Objektene BÆRER tidene varslene handler om. Et varsel beskriver én
       tidsplan for ett objekt, og en rad hvis verdi ikke lenger stemmer med
       objektets tid ryddes bort av appen (docs/varsler.md) — en fikstur med
       tidløse objekter ville derfor blitt tømt i det første synk-rundet. */
    cards: [
      card(id.C1, 'Skattemelding', 0, { due_at: '2026-06-14T12:00' }),
      card(id.C2, 'Sykkeltur', 1, { due_at: '2026-06-20' }),
      card(id.C3, 'Flyttedag', 2, { start_at: '2026-06-25' }),
    ],
    items: [
      item(id.I1, id.C1, 'Levere'),
      item(id.I2, id.C2, 'Pumpe dekk'),
      item(id.I3, id.C3, 'Pakke', { start_at: '2026-06-10T08:00' }),
    ],
    memberships: [{ id: U(), user_id: uid, universe_id: id.UA, group_id: null, role: 'owner', pos: 0, created_at: 1 }],
    share_invites: [], tombstones: [], notifications: [], notification_prefs: [],
  } };
}

async function seed(p, db, uid, lang) {
  await p.goto(BASE + '/?mock=1');
  await p.evaluate(({ db, uid, lang }) => {
    localStorage.clear(); sessionStorage.clear();
    if (lang) localStorage.setItem('hk-lang', lang);
    localStorage.setItem('hk-mock-db', JSON.stringify(db));
    sessionStorage.setItem('hk-mock-session', JSON.stringify({
      id: uid, email: 'm@x.no',
      user_metadata: { lang: lang || 'no', onboarding: { v: 3, status: 'done' },
        tips: { drag: true, trash: true, moveList: true, dragTrash: true } },
    }));
  }, { db, uid, lang });
  await p.goto(BASE + '/?mock=1');
  await p.waitForFunction(() => {
    const H = window.__huskis;
    return H && H.authUser && H.lastMy && H.state.universes.length > 0;
  }, null, { timeout: 15000, polling: 200 });
  await p.waitForTimeout(400);
}

// Legg rader rett i «databasen» — som om generatoren hadde logget dem.
async function addNotifs(p, rows) {
  await p.evaluate((rows) => {
    const db = window.HK_MOCK._loadDB();
    const uid = window.__huskis.authUser.id;
    const uuid = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
    rows.forEach((r) => db.notifications.push(Object.assign({
      id: uuid(), user_id: uid, key: 'k-' + Math.random(), snoozed: false,
      name: '', path: 'Arbeid › Klinikk', value: '2026-06-14T12:00',
      created_at: Date.now(), read_at: null,
    }, r)));
    window.HK_MOCK._saveDB(db);
  }, rows);
}

/* Sett en tid på et objekt gjennom appens egen setter (den stempler og
   lagrer). Brukes fordi objektets tid MÅ stemme med varselets verdi: en rad om
   en tidsplan som ikke finnes lenger ryddes bort av appen (docs/varsler.md). */
async function settTid(p, objId, field, value) {
  await p.evaluate(({ objId, field, value }) => {
    const H = window.__huskis;
    for (const u of H.state.universes) {
      for (const g of (u.groups || [])) {
        for (const c of (g.cards || [])) {
          if (c.id === objId) { H.setObjectTime({ kind: 'card', obj: c, card: c }, field, value); return; }
          for (const it of (c.items || [])) {
            if (it.id === objId) { H.setObjectTime({ kind: 'item', obj: it, card: c }, field, value); return; }
          }
        }
      }
    }
  }, { objId: objId, field: field, value: value });
  await p.waitForTimeout(250);
}

async function cycle(p) {
  await p.evaluate(() => window.__huskis.cloudCycle());
  await p.waitForTimeout(500);
}

const badgeInfo = (p) => p.evaluate(() => {
  const b = document.getElementById('notif-badge');
  const btn = document.getElementById('notif-btn');
  return { hidden: b.hidden, text: b.textContent, ariaHidden: b.getAttribute('aria-hidden'),
    label: btn.getAttribute('aria-label') };
});

const rowsOf = (p) => p.evaluate(() => [...document.querySelectorAll('#notif-body .notif-item')].map((li) => {
  const btn = li.querySelector('.notif-row');
  const dag = li.closest('.notif-day');
  return {
    id: li.dataset.id,
    name: btn.querySelector('.notif-name').textContent,
    meta: btn.querySelector('.notif-meta').textContent,
    // Stien er nå en egen, svært liten linje ØVERST i raden.
    path: (btn.querySelector('.notif-path') || {}).textContent || '',
    // … og datoen står i overskriften over bunken, ikke i raden.
    dag: dag ? dag.querySelector('.notif-day-head').textContent : null,
    tone: [...btn.querySelector('.event-icon').classList].filter((c) => c.indexOf('is-') === 0).join(''),
    unread: btn.classList.contains('is-unread'),
    gone: btn.classList.contains('is-gone'),
    label: btn.getAttribute('aria-label'),
  };
}));

async function run(label, viewport, mobile) {
  const browser = await chromium.launch();
  const p = await nySide(browser, Object.assign({ viewport },
    mobile ? { isMobile: true, hasTouch: true } : {}));
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  console.log('\n== ' + label + ' ==');

  const { id, uid, db } = buildDB();
  await seed(p, db, uid);

  /* ---------- 1) Knappen og badgen ---------- */
  const plass = await p.evaluate(() => {
    const g = document.getElementById('corner-controls');
    return [...g.children].map((k) => k.id);
  });
  log(label + ' 1a: bjellen ligger FØRST i toppkontrollgruppen, til venstre for kalenderen',
    plass[0] === 'notif-btn' && plass[1] === 'events-btn', JSON.stringify(plass));
  const tom = await badgeInfo(p);
  log(label + ' 1b: badgen er skjult når ingenting er ulest',
    tom.hidden === true && tom.label === 'Varsler', JSON.stringify(tom));

  /* Alle tre skal ligge under «I dag» (2i), så de dateres av SIDENS klokke og
     klemmes innenfor dagens døgn. «Nå minus en time» ville vært i går hver
     gang testen kjørte den første timen etter midnatt. */
  const k = await sideklokke(p);
  await addNotifs(p, [
    { type: 'dueOver', obj_type: 'card', obj_id: id.C1, name: 'Skattemelding', at: k.nettopp(3), value: '2026-06-14T12:00' },
    { type: 'dueSoon', obj_type: 'card', obj_id: id.C2, name: 'Sykkeltur', at: k.nettopp(4), value: '2026-06-20' },
    { type: 'startNow', obj_type: 'item', obj_id: id.I3, name: 'Pakke', at: k.nettopp(5), value: '2026-06-10T08:00' },
  ]);
  await cycle(p);
  const tre = await badgeInfo(p);
  log(label + ' 1c: badgen viser antall uleste, og antallet står i knappens navn',
    tre.hidden === false && tre.text === '3' && tre.label === 'Varsler, 3 uleste' &&
    tre.ariaHidden === 'true', JSON.stringify(tre));

  /* ---------- 2) Modalen ---------- */
  await p.click('#notif-btn');
  await p.waitForTimeout(300);
  const dialog = await p.evaluate(() => {
    const d = document.querySelector('#notif-modal .modal');
    return { role: d.getAttribute('role'), modal: d.getAttribute('aria-modal'),
      tittel: document.getElementById('notif-modal-title').textContent.trim(),
      status: document.getElementById('notif-count').textContent };
  });
  log(label + ' 2a: dialogsemantikk og tittel', dialog.role === 'dialog' &&
    dialog.modal === 'true' && dialog.tittel === 'Varsler', JSON.stringify(dialog));
  log(label + ' 2b: antallet leses opp ved åpning', dialog.status === '3 varsler, 3 uleste.', dialog.status);
  const rader = await rowsOf(p);
  log(label + ' 2c: NYESTE øverst',
    eq(rader.map((r) => r.name), ['Skattemelding', 'Sykkeltur', 'Pakke']),
    JSON.stringify(rader.map((r) => r.name)));
  log(label + ' 2d: hver rad har flaten som hører til varseltypen',
    eq(rader.map((r) => r.tone), ['is-over', 'is-soon', 'is-started']),
    JSON.stringify(rader.map((r) => r.tone)));
  log(label + ' 2e: meldingen sier hva som skjedde, uten sti og uten tidsstempel',
    rader[0].meta.indexOf('Fristen er utløpt') === 0 &&
    rader[0].meta.indexOf('Arbeid › Klinikk') === -1, rader[0].meta);
  log(label + ' 2f: stien står som en egen, subtil linje øverst i raden',
    rader[0].path === 'Arbeid › Klinikk' &&
    parseFloat(await p.evaluate(() => getComputedStyle(document.querySelector('.notif-path')).fontSize)) <
      parseFloat(await p.evaluate(() => getComputedStyle(document.querySelector('.notif-name')).fontSize)),
    rader[0].path);
  log(label + ' 2i: radene som kom i dag ligger under datooverskriften «I dag»',
    rader.every((r) => r.dag === 'I dag'), JSON.stringify(rader.map((r) => r.dag)));
  log(label + ' 2j: ingen rad bærer et eget tidsstempel lenger',
    (await p.locator('#notif-body .notif-when').count()) === 0);
  log(label + ' 2g: opplesningen bærer tilstand, type, navn og sti i klartekst',
    rader[0].label.indexOf('Ulest') === 0 && rader[0].label.indexOf('Frist utløpt') > -1 &&
    rader[0].label.indexOf('Skattemelding') > -1 &&
    rader[0].label.indexOf('Arbeid › Klinikk') > -1, rader[0].label);
  log(label + ' 2h: radene åpningen merket lest beholder markeringen til modalen lukkes',
    rader.every((r) => r.unread === true), JSON.stringify(rader.map((r) => r.unread)));

  /* ---------- 4) Åpning markerer lest ---------- */
  await p.waitForTimeout(400);
  const etterÅpning = await badgeInfo(p);
  log(label + ' 4a: åpningen markerer alt som sto der som lest — badgen forsvinner',
    etterÅpning.hidden === true, JSON.stringify(etterÅpning));
  const iDb = await p.evaluate(() => window.HK_MOCK._loadDB().notifications.filter((n) => n.read_at).length);
  log(label + ' 4b: lest-merkingen ligger på KONTOEN, ikke bare i denne fanen', iDb === 3, String(iDb));

  // Et varsel som ankommer MENS modalen står åpen skal ikke bli lest.
  await addNotifs(p, [{ type: 'startSoon', obj_type: 'card', obj_id: id.C3,
    name: 'Flyttedag', at: k.nettopp(0), value: '2026-06-25' }]);
  await cycle(p);
  const medNytt = await rowsOf(p);
  const nyBadge = await badgeInfo(p);
  const ulestPåKontoen = await p.evaluate(() =>
    window.__huskis.notifRows.filter((r) => !r.readAt).map((r) => r.name));
  log(label + ' 4c: et varsel som ankommer etter åpningen dukker opp …',
    medNytt.length === 4 && medNytt[0].name === 'Flyttedag',
    JSON.stringify(medNytt.map((r) => r.name)));
  log(label + ' 4d: … og forblir ULEST — grensen er satt ved åpningen, ikke på klokka',
    eq(ulestPåKontoen, ['Flyttedag']) && nyBadge.hidden === false && nyBadge.text === '1',
    JSON.stringify({ ulest: ulestPåKontoen, badge: nyBadge.text }));

  /* ---------- 9) «Utsett» ---------- */
  await p.click('#notif-body .notif-item:first-child .notif-snooze-btn');
  await p.waitForSelector('#notif-snooze-switcher:not([hidden])');
  const meny = await p.evaluate(() => ({
    tittel: document.querySelector('#notif-snooze-panel .notif-snooze-title').textContent,
    valg: [...document.querySelectorAll('#notif-snooze-panel .notif-snooze-choice')].map((b) => b.textContent),
    // Valgene ligger i en popover, ikke lenger som en rad mellom to kort.
    iBody: document.querySelectorAll('#notif-body .notif-snooze-choice').length,
    utfoldet: document.querySelector('#notif-body .notif-item:first-child .notif-snooze-btn')
      .getAttribute('aria-expanded'),
  }));
  log(label + ' 9a: «Utsett» åpner en popover med overskrift og fire valg',
    meny.tittel === 'Varsle på nytt om' && meny.iBody === 0 && meny.utfoldet === 'true' &&
    eq(meny.valg, ['1 time', '6 timer', '1 døgn', 'Egendefinert']), JSON.stringify(meny));
  if (!mobile) {
    // Popoveren skal stå I DIREKTE TILKNYTNING til knappen — det var nettopp
    // det raden under kortet ikke gjorde. (På mobil er skallet et sentrert ark.)
    const nær = await p.evaluate(() => {
      const b = document.querySelector('#notif-body .notif-item:first-child .notif-snooze-btn')
        .getBoundingClientRect();
      const pn = document.getElementById('notif-snooze-panel').getBoundingClientRect();
      return { dx: Math.round(Math.min(Math.abs(pn.left - b.right), Math.abs(b.left - pn.right))),
        dy: Math.round(Math.abs(pn.top - b.top)) };
    });
    log(label + ' 9b: popoveren er forankret i knappen', nær.dx <= 24 && nær.dy <= 40, JSON.stringify(nær));
  }

  // «Egendefinert»: en skuff med dato + klokkeslett. Et tidspunkt som alt er
  // passert er ingen utsettelse, og skal avvises i stedet for å logges.
  await p.click('#notif-snooze-panel .notif-snooze-more');
  await p.waitForTimeout(200);
  await p.fill('#notif-snooze-panel input[type="date"]', k.dag(-1));
  await p.fill('#notif-snooze-panel input[type="time"]', '09:00');
  const førUtsett = await p.evaluate(() => window.HK_MOCK._loadDB().notifications.length);
  await p.click('#notif-snooze-panel .btn');
  await p.waitForTimeout(400);
  const avvist = await p.evaluate(() => ({
    åpen: !document.getElementById('notif-snooze-switcher').hidden,
    note: (document.querySelector('#notif-snooze-panel .time-note') || {}).textContent || '',
    antall: window.HK_MOCK._loadDB().notifications.length,
  }));
  log(label + ' 9c: «Egendefinert» avviser et tidspunkt som alt er passert',
    avvist.åpen === true && avvist.note === 'Velg et tidspunkt fram i tid.' &&
    avvist.antall === førUtsett, JSON.stringify(avvist));

  // … og et tidspunkt fram i tid logger varselet på nøyaktig det tidspunktet.
  await p.fill('#notif-snooze-panel input[type="date"]', k.dag(1));
  await p.fill('#notif-snooze-panel input[type="time"]', '07:30');
  await p.click('#notif-snooze-panel .btn');
  await p.waitForTimeout(600);
  await cycle(p);
  const utsatt = await p.evaluate((d) => {
    const db = window.HK_MOCK._loadDB();
    const ny = db.notifications.filter((n) => n.snoozed);
    const mål = new Date(d + 'T07:30:00').getTime();
    return { antall: db.notifications.length, snoozed: ny.length,
      lukket: document.getElementById('notif-snooze-switcher').hidden,
      treffer: ny.length === 1 && Math.abs(ny[0].at - mål) < 60000,
      synlige: document.querySelectorAll('#notif-body .notif-item').length,
      badge: document.getElementById('notif-badge').hidden };
  }, k.dag(1));
  log(label + ' 9d: et egendefinert tidspunkt logger ETT varsel på akkurat det tidspunktet',
    utsatt.antall === førUtsett + 1 && utsatt.snoozed === 1 && utsatt.treffer && utsatt.lukket,
    JSON.stringify(utsatt));
  log(label + ' 9e: det utsatte varselet er usynlig til det forfaller, og teller ikke som ulest',
    utsatt.synlige === 4 && utsatt.badge === true, JSON.stringify(utsatt));

  /* ARMERT: knappen på raden man utsatte skal si at et nytt varsel er bestilt,
     og popoveren skal da ikke tilby ett til — den sier når det kommer. */
  const armert = await p.evaluate(() => {
    const b = document.querySelector('#notif-body .notif-item:first-child .notif-snooze-btn');
    return { klasse: b.classList.contains('is-armed'), navn: b.getAttribute('aria-label') };
  });
  log(label + ' 9f: utsett-knappen er ARMERT når et nytt varsel er bestilt',
    armert.klasse === true && /planlagt/.test(armert.navn || ''), JSON.stringify(armert));
  await p.click('#notif-body .notif-item:first-child .notif-snooze-btn');
  await p.waitForSelector('#notif-snooze-switcher:not([hidden])');
  const armertPanel = await p.evaluate(() => ({
    note: (document.querySelector('#notif-snooze-panel .notif-snooze-note') || {}).textContent || '',
    valg: document.querySelectorAll('#notif-snooze-panel .notif-snooze-choice').length,
    avbryt: (document.querySelector('#notif-snooze-panel .btn') || {}).textContent || '',
  }));
  log(label + ' 9g: popoveren sier NÅR varselet kommer, og tilbyr ingen ny utsettelse',
    /^Du vil bli varslet igjen kl\. \d{2}:\d{2}/.test(armertPanel.note) &&
    armertPanel.valg === 0 && armertPanel.avbryt === 'Avbryt det planlagte varselet',
    JSON.stringify(armertPanel));
  await p.click('#notif-snooze-panel .btn');
  await p.waitForTimeout(700);
  await cycle(p);
  const avbrutt = await p.evaluate(() => ({
    snoozed: window.HK_MOCK._loadDB().notifications.filter((n) => n.snoozed).length,
    armert: document.querySelector('#notif-body .notif-item:first-child .notif-snooze-btn')
      .classList.contains('is-armed'),
  }));
  log(label + ' 9h: «Avbryt» sletter det planlagte varselet, og knappen faller tilbake',
    avbrutt.snoozed === 0 && avbrutt.armert === false, JSON.stringify(avbrutt));

  // Bestill det på nytt (den raske veien), så tilstanden inn i «Tøm varsler»
  // er den samme som før: fire synlige rader og ett utsatt varsel i framtiden.
  await p.click('#notif-body .notif-item:first-child .notif-snooze-btn');
  await p.waitForSelector('#notif-snooze-switcher:not([hidden])');
  await p.click('#notif-snooze-panel .notif-snooze-choice:nth-child(3)');   // 1 døgn
  await p.waitForTimeout(600);
  await cycle(p);

  /* ---------- 7) «Tøm varsler» med angre ---------- */
  const idFørTømming = (await rowsOf(p)).map((r) => r.id);
  await p.click('#notif-clear');
  await p.waitForTimeout(250);
  const tømt = await p.evaluate(() => ({
    rader: document.querySelectorAll('#notif-body .notif-item').length,
    knapp: document.getElementById('notif-clear').textContent,
    iDb: window.HK_MOCK._loadDB().notifications.length,
  }));
  log(label + ' 7a: øyeblikksbildet skjules med én gang, uten bekreftelse …',
    tømt.rader === 0 && tømt.iDb > 0, JSON.stringify(tømt));
  log(label + ' 7b: … og knappen blir «Angre · 10»', tømt.knapp === 'Angre · 10', tømt.knapp);
  // Nedtellingen er en tidsvindu-observasjon: den MÅ ses på klokka.
  await p.waitForTimeout(1300);
  const teller = await p.evaluate(() => document.getElementById('notif-clear').textContent);
  log(label + ' 7c: nedtellingen teller ned', teller === 'Angre · 9', teller);

  // Et varsel som ankommer ETTER øyeblikksbildet skal ikke slettes med det.
  await addNotifs(p, [{ type: 'dueOver', obj_type: 'card', obj_id: id.C2,
    name: 'Etterpå', at: k.sidenNå(1000), value: '2026-06-20' }]);
  await cycle(p);
  const underAngre = await rowsOf(p);
  log(label + ' 7d: et varsel som ankommer under angre-vinduet vises …',
    underAngre.length === 1 && underAngre[0].name === 'Etterpå',
    JSON.stringify(underAngre.map((r) => r.name)));

  await p.click('#notif-clear');   // Angre
  await p.waitForTimeout(250);
  const angret = await rowsOf(p);
  log(label + ' 7e: «Angre» gjenoppretter nøyaktig øyeblikksbildet',
    angret.length === 5 && idFørTømming.every((x) => angret.some((r) => r.id === x)),
    JSON.stringify(angret.map((r) => r.name)));

  /* ---------- 8) Lukking committer ---------- */
  await p.click('#notif-clear');
  await p.waitForTimeout(200);
  const snapshot = 5;
  await p.click('#notif-close');
  await p.waitForTimeout(700);
  const etterLukking = await p.evaluate(() => {
    const db = window.HK_MOCK._loadDB();
    return { igjen: db.notifications.length, navn: db.notifications.map((n) => n.name) };
  });
  log(label + ' 8: lukking committer slettingen med én gang — det utsatte varselet overlever',
    etterLukking.igjen === 1 && etterLukking.navn[0] === 'Flyttedag',
    JSON.stringify(etterLukking) + ' (øyeblikksbilde: ' + snapshot + ')');

  /* ---------- 3) Tomtilstand ---------- */
  await cycle(p);
  await p.click('#notif-btn');
  await p.waitForTimeout(300);
  const tomtilstand = await p.evaluate(() => ({
    tekst: (document.querySelector('#notif-body .notif-empty') || {}).textContent || '',
    knapp: document.getElementById('notif-clear').disabled,
  }));
  log(label + ' 3: tomtilstand, og «Tøm varsler» er avskrudd',
    tomtilstand.tekst === 'Ingen varsler ennå.' && tomtilstand.knapp === true,
    JSON.stringify(tomtilstand));

  /* ---------- 10) Preferansene ---------- */
  await p.click('#notif-settings-btn');
  await p.waitForTimeout(250);
  const brytere = await p.evaluate(() => [...document.querySelectorAll('#notif-body .toggle-switch[data-pref]')]
    .map((b) => b.dataset.pref + '=' + b.getAttribute('aria-checked')));
  log(label + ' 10a: fire varseltypebrytere, alle PÅ som standard',
    eq(brytere, ['dueOver=true', 'dueSoon=true', 'startNow=true', 'startSoon=true']),
    JSON.stringify(brytere));
  // Hodet bytter tilstand: tannhjulet er veien INN og forsvinner der, og
  // tilbakeknappen til venstre for overskriften er veien ut.
  const hode = await p.evaluate(() => ({
    tittel: document.getElementById('notif-title-text').textContent,
    tilbake: !document.getElementById('notif-back').hidden,
    tannhjul: !document.getElementById('notif-settings-btn').hidden,
    bjelle: !document.getElementById('notif-title-bell').hidden,
    gear: !document.getElementById('notif-title-gear').hidden,
    // Tilbakeknappen står FØR overskriften i hodet.
    førstIHodet: document.querySelector('.notif-modal .modal-head').children[0].id,
    hint: document.querySelectorAll('#notif-body .notif-settings-hint').length,
  }));
  log(label + ' 10c: innstillingene har egen overskrift med tannhjul, tilbakeknapp til venstre, og ingen forklaringstekst',
    hode.tittel === 'Varselinnstillinger' && hode.tilbake === true &&
    hode.tannhjul === false && hode.bjelle === false && hode.gear === true &&
    hode.førstIHodet === 'notif-back' && hode.hint === 0, JSON.stringify(hode));
  await p.click('#notif-body .toggle-switch[data-pref="dueSoon"]');
  await p.waitForTimeout(500);
  const lagret = await p.evaluate(() => {
    const db = window.HK_MOCK._loadDB();
    const row = db.notification_prefs.find((r) => r.user_id === window.__huskis.authUser.id);
    return { due_soon: row.due_soon, klient: window.__huskis.notifPrefs.dueSoon,
      aria: document.querySelector('#notif-body .toggle-switch[data-pref="dueSoon"]').getAttribute('aria-checked') };
  });
  log(label + ' 10b: et bytte lagres på kontoen (ikke bare i denne fanen)',
    lagret.due_soon === false && lagret.klient === false && lagret.aria === 'false',
    JSON.stringify(lagret));
  await p.click('#notif-back');
  await p.waitForTimeout(250);
  const tilbake = await p.evaluate(() => ({
    tittel: document.getElementById('notif-title-text').textContent,
    tilbake: !document.getElementById('notif-back').hidden,
    tannhjul: !document.getElementById('notif-settings-btn').hidden,
    liste: document.querySelectorAll('#notif-body .notif-list').length > 0 ||
      document.querySelectorAll('#notif-body .notif-empty').length > 0,
  }));
  log(label + ' 10d: tilbakeknappen fører tilbake til varslene',
    tilbake.tittel === 'Varsler' && tilbake.tilbake === false &&
    tilbake.tannhjul === true && tilbake.liste === true, JSON.stringify(tilbake));

  /* ---------- 5–6) Navigering og et slettet mål ---------- */
  await p.click('#notif-close');
  await p.waitForTimeout(200);
  await addNotifs(p, [
    { type: 'dueOver', obj_type: 'card', obj_id: id.C1, name: 'Skattemelding', at: k.sidenNå(5000), value: '2026-06-14T12:00' },
    { type: 'dueOver', obj_type: 'card', obj_id: 'ffffffff-ffff-4fff-bfff-ffffffffffff', name: 'Borte', at: k.sidenNå(9000), value: '2026-06-01' },
  ]);
  await cycle(p);
  await p.click('#notif-btn');
  await p.waitForTimeout(300);
  /* Et varsel om et objekt som ikke finnes lenger beskriver en tidsplan som
     ikke finnes — det ryddes bort ved synk-runden, ikke stående merket. */
  const medBorte = await rowsOf(p);
  const iDbEtterpå = await p.evaluate(() =>
    window.HK_MOCK._loadDB().notifications.some((n) => n.name === 'Borte'));
  log(label + ' 6a: et varsel hvis mål er borte slettes — både lokalt og på kontoen',
    !medBorte.some((r) => r.name === 'Borte') && iDbEtterpå === false,
    JSON.stringify({ rader: medBorte.map((r) => r.name), iDb: iDbEtterpå }));

  /* … og det samme gjelder når TIDEN varselet gjaldt blir en annen: den gamle
     tidsplanen finnes ikke lenger, og raden om den skal ikke bli stående. */
  const førEndring = (await rowsOf(p)).filter((r) => r.name === 'Skattemelding').length;
  await settTid(p, id.C1, 'due', '2026-06-30');
  await cycle(p);
  await p.waitForTimeout(400);
  const etterEndring = await rowsOf(p);
  log(label + ' 6b: endres fristen, slettes varselet om den gamle',
    førEndring > 0 && !etterEndring.some((r) => r.name === 'Skattemelding'),
    JSON.stringify({ før: førEndring, etter: etterEndring.map((r) => r.name) }));

  // Sett fristen tilbake, så resten av løpet står på den samme fiksturen.
  await settTid(p, id.C1, 'due', '2026-06-14T12:00');
  await addNotifs(p, [{ type: 'dueOver', obj_type: 'card', obj_id: id.C1,
    name: 'Skattemelding', at: k.sidenNå(5000), value: '2026-06-14T12:00' }]);
  await cycle(p);
  await p.click('#notif-body .notif-item .notif-row');
  await p.waitForFunction(() => document.getElementById('notif-modal').hidden, null, { timeout: 4000 });
  await p.waitForTimeout(900);
  const navigert = await p.evaluate((cid) => {
    const el = document.querySelector('.card[data-id="' + cid + '"]');
    return { finnes: !!el, markert: !!document.querySelector('.nav-flash') };
  }, id.C1);
  log(label + ' 5: trykk på en rad lukker modalen og navigerer til objektet',
    navigert.finnes && navigert.markert, JSON.stringify(navigert));

  /* ---------- 1d) «99+» ---------- */
  const mange = [];
  for (let i = 0; i < 120; i++) {
    mange.push({ type: 'dueOver', obj_type: 'card', obj_id: id.C1, name: 'Masse ' + i,
      at: k.sidenNå(20000 + i * 1000), value: '2026-06-14T12:00' });
  }
  await addNotifs(p, mange);
  await cycle(p);
  const stor = await badgeInfo(p);
  log(label + ' 1d: svært mange uleste vises som «99+», og antallet står i navnet',
    stor.text === '99+' && /^Varsler, \d+ uleste$/.test(stor.label), JSON.stringify(stor));

  /* ---------- 17) Slett ÉN rad ---------- */
  await p.click('#notif-btn');
  await p.waitForTimeout(300);
  const førSlett = await p.evaluate(() => ({
    antall: document.querySelectorAll('#notif-body .notif-item').length,
    navn: (document.querySelector('#notif-body .notif-name') || {}).textContent,
  }));
  await p.click('#notif-body .notif-item:first-child .notif-del-btn');
  await p.waitForTimeout(700);
  const etterSlett = await p.evaluate((navn) => ({
    antall: document.querySelectorAll('#notif-body .notif-item').length,
    første: (document.querySelector('#notif-body .notif-name') || {}).textContent,
    iDb: window.HK_MOCK._loadDB().notifications.some((n) => n.name === navn),
  }), førSlett.navn);
  log(label + ' 17: slett-knappen fjerner ÉN rad — også fra kontoen',
    etterSlett.antall === førSlett.antall - 1 && etterSlett.første !== førSlett.navn &&
    etterSlett.iDb === false, JSON.stringify({ før: førSlett, etter: etterSlett }));
  await p.click('#notif-close');
  await p.waitForTimeout(250);

  /* ---------- 11) Tastatur og fokus ---------- */
  await p.evaluate(() => document.getElementById('notif-btn').focus());
  await p.keyboard.press('Enter');
  await p.waitForTimeout(400);
  const fokusInne = await p.evaluate(() =>
    !!document.getElementById('notif-modal').contains(document.activeElement));
  log(label + ' 11a: fokus flyttes inn i modalen ved åpning', fokusInne === true, String(fokusInne));
  await p.keyboard.press('Escape');
  await p.waitForTimeout(400);
  const etterEscape = await p.evaluate(() => ({
    skjult: document.getElementById('notif-modal').hidden,
    fokus: document.activeElement && document.activeElement.id,
  }));
  log(label + ' 11b: Escape lukker, og fokus går tilbake til bjellen',
    etterEscape.skjult === true && etterEscape.fokus === 'notif-btn', JSON.stringify(etterEscape));

  log(label + ': døgnet fiksturen ble datert i står til siste sjekk',
    await sammeDøgn(p, k) === true);
  log(label + ': ingen JS-feil', errs.length === 0, errs.join(' | '));
  await browser.close();
}

// Engelsk: hele flaten går gjennom ordboken (docs/sprak.md).
async function runEngelsk() {
  const browser = await chromium.launch();
  const p = await nySide(browser, { viewport: { width: 1200, height: 900 } });
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  console.log('\n== engelsk ==');
  const { id, uid, db } = buildDB();
  await seed(p, db, uid, 'en');
  // Raden skal stå under «Today» (12b), så den dateres av sidens klokke.
  const k = await sideklokke(p);
  await addNotifs(p, [{ type: 'dueOver', obj_type: 'card', obj_id: id.C1,
    name: 'Tax return', at: k.nettopp(0), value: '2026-06-14T12:00' }]);
  await cycle(p);
  const knapp = await badgeInfo(p);
  await p.click('#notif-btn');
  await p.waitForTimeout(300);
  const tekst = await p.evaluate(() => ({
    tittel: document.getElementById('notif-modal-title').textContent.trim(),
    melding: document.querySelector('.notif-meta').textContent,
    dag: document.querySelector('.notif-day-head').textContent,
    tøm: document.getElementById('notif-clear').textContent,
  }));
  log('12a: knappens navn er engelsk', knapp.label === 'Notifications, 1 unread', knapp.label);
  log('12b: modalen er engelsk', tekst.tittel === 'Notifications' &&
    tekst.tøm === 'Clear notifications' && tekst.melding.indexOf('The deadline') === 0 &&
    tekst.dag === 'Today', JSON.stringify(tekst));
  await p.click('#notif-body .notif-item:first-child .notif-snooze-btn');
  await p.waitForSelector('#notif-snooze-switcher:not([hidden])');
  const snoozeEn = await p.evaluate(() => ({
    tittel: document.querySelector('#notif-snooze-panel .notif-snooze-title').textContent,
    valg: [...document.querySelectorAll('#notif-snooze-panel .notif-snooze-choice')].map((b) => b.textContent),
  }));
  log('12e: utsett-popoveren er engelsk', snoozeEn.tittel === 'Notify me again in' &&
    eq(snoozeEn.valg, ['1 hour', '6 hours', '1 day', 'Custom']), JSON.stringify(snoozeEn));
  await p.keyboard.press('Escape');
  await p.waitForTimeout(200);
  await p.click('#notif-clear');
  await p.waitForTimeout(250);
  const undo = await p.evaluate(() => document.getElementById('notif-clear').textContent);
  log('12c: angre-nedtellingen er engelsk', undo === 'Undo · 10', undo);
  await p.click('#notif-settings-btn');
  await p.waitForTimeout(250);
  const prefs = await p.evaluate(() => [...document.querySelectorAll('#notif-body .menu-setting')]
    .map((r) => r.querySelector('.menu-setting-label span:last-child').textContent));
  log('12f: innstillingsoverskriften er engelsk',
    (await p.evaluate(() => document.getElementById('notif-title-text').textContent)) === 'Notification settings');
  log('12d: preferansene og kanalraden er engelske',
    eq(prefs, ['Deadline passed', 'Deadline in less than a week', 'Starting now',
      'Starts in less than a week', 'Notifications on this device']),
    JSON.stringify(prefs));
  log('engelsk: døgnet fiksturen ble datert i står til siste sjekk',
    await sammeDøgn(p, k) === true);
  log('engelsk: ingen JS-feil', errs.length === 0, errs.join(' | '));
  await browser.close();
}

/* Kontobytte uten utlogging. Supabase kan gå rett fra én innlogget bruker til
   en annen uten et SIGNED_OUT imellom (`cloudStart` har en egen gren for det),
   og da må varselhistorikken byttes ut MED ÉN GANG — ikke først når den nye
   brukerens pull svarer. Serverforsinkelsen (`&lag=`) er hele poenget: den
   holder pullen i lufta mens vi ser etter, så det som måles er nullstillingen
   og ikke det nye svaret. */
async function runKontobytte() {
  const browser = await chromium.launch();
  const p = await nySide(browser, { viewport: { width: 1200, height: 900 } });
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  console.log('\n== kontobytte ==');

  // Fang klientinstansen appen bruker, så testen kan logge inn som en ANNEN
  // bruker i den samme fanen og få den ekte SIGNED_IN-hendelsen.
  await p.addInitScript(() => {
    let real = null;
    Object.defineProperty(window, 'HK_MOCK', {
      configurable: true,
      get() { return real; },
      set(v) {
        const orig = v.createClient;
        v.createClient = function () {
          const c = orig.apply(this, arguments);
          window.__client = c;
          return c;
        };
        real = v;
      },
    });
  });

  const { id, uid, db } = buildDB();
  await p.goto(BASE + '/?mock=1&lag=1200');
  await p.evaluate(({ db, uid }) => {
    localStorage.clear(); sessionStorage.clear();
    localStorage.setItem('hk-mock-db', JSON.stringify(db));
    sessionStorage.setItem('hk-mock-session', JSON.stringify({
      id: uid, email: 'm@x.no',
      user_metadata: { onboarding: { v: 3, status: 'done' },
        tips: { drag: true, trash: true, moveList: true, dragTrash: true } },
    }));
  }, { db, uid });
  await p.goto(BASE + '/?mock=1&lag=1200');
  await p.waitForFunction(() => {
    const H = window.__huskis;
    return H && H.authUser && H.lastMy && H.state.universes.length > 0;
  }, null, { timeout: 25000, polling: 200 });

  const k = await sideklokke(p);
  await addNotifs(p, [
    { type: 'dueOver', obj_type: 'card', obj_id: id.C1, name: 'Skattemelding',
      at: k.sidenNå(60000), value: '2026-06-14T12:00' },
    { type: 'dueSoon', obj_type: 'card', obj_id: id.C2, name: 'Sykkeltur',
      at: k.sidenNå(90000), value: '2026-06-20' },
  ]);
  await p.evaluate(() => window.__huskis.cloudCycle());
  await p.waitForFunction(() => window.__huskis.notifRows.length === 2, null,
    { timeout: 20000, polling: 200 });
  const før = await badgeInfo(p);
  log('13a: bruker A har to uleste varsler før byttet',
    før.hidden === false && før.text === '2', JSON.stringify(før));

  // Bytt konto uten å logge ut: den nye brukerens pull er på vei, men treg.
  await p.evaluate(() => window.__client.auth.signInWithPassword({ email: 'b@x.no', password: 'x' }));
  await p.waitForFunction(() => window.__huskis.authUser && window.__huskis.authUser.id === 'uB',
    null, { timeout: 8000, polling: 50 });
  const etter = await p.evaluate(() => ({
    rader: window.__huskis.notifRows.length,
    prefs: window.__huskis.notifPrefs,
    markør: window.__huskis.notifCursor,
    badge: document.getElementById('notif-badge').hidden,
    navn: document.getElementById('notif-btn').getAttribute('aria-label'),
    lastMy: !!window.__huskis.lastMy,
  }));
  log('13b: historikken er borte FØR den nye brukerens pull har svart',
    etter.rader === 0 && etter.prefs === null && etter.markør === null &&
    etter.badge === true && etter.navn === 'Varsler', JSON.stringify(etter));

  log('kontobytte: ingen JS-feil', errs.length === 0, errs.join(' | '));
  await browser.close();
}

/* DATOOVERSKRIFTENE og MELDINGENE. Varslene samles i bunker per døgn — «I dag»,
   «I går», og ellers ukedagen foran den fulle datoen — og selve meldingen
   navngir de tre nærmeste døgnene i stedet for å skrive datoen ut («Begynte i
   dag kl. 07:00»). Radene seedes på faste avstander fra nå, så testen ikke er
   avhengig av hvilken dato den kjøres på. */
async function runDatoer() {
  const browser = await chromium.launch();
  const p = await nySide(browser, { viewport: { width: 1200, height: 900 } });
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  console.log('\n== datoer ==');
  const { id, uid, db } = buildDB();
  await seed(p, db, uid);

  const k = await sideklokke(p);

  // Objektenes tider settes FØRST: en rad hvis verdi ikke stemmer med objektet
  // ryddes bort (docs/varsler.md), så fiksturen må være i takt med varslene.
  await settTid(p, id.C1, 'due', k.dag(0) + 'T09:00');
  await settTid(p, id.C2, 'start', k.dag(0));
  await settTid(p, id.I3, 'start', k.dag(1) + 'T17:00');
  await settTid(p, id.I1, 'start', k.dag(-1) + 'T06:10');
  await settTid(p, id.I2, 'start', k.dag(-5) + 'T06:00');
  await addNotifs(p, [
    // I dag: en utløpt frist med klokkeslett, og en start uten klokkeslett.
    { type: 'dueOver', obj_type: 'card', obj_id: id.C1, name: 'Skattemelding',
      at: k.nettopp(0), value: k.dag(0) + 'T09:00' },
    { type: 'startNow', obj_type: 'card', obj_id: id.C2, name: 'Sykkeltur',
      at: k.nettopp(1), value: k.dag(0) },
    // … og et varsel om noe som begynner i MORGEN, logget i dag.
    { type: 'startSoon', obj_type: 'item', obj_id: id.I3, name: 'Pakke',
      at: k.nettopp(2), value: k.dag(1) + 'T17:00' },
    // I går — midt på dagen, og i BEGGE kantene av det samme døgnet. De tre
    // skal i én bunke: regnes bunkenøkkelen i UTC i stedet for lokalt,
    // sprekker kantene fra hverandre i enhver sone som ikke ER UTC, og det er
    // nettopp den forvekslingen som er lett å gjøre (14h).
    { type: 'startNow', obj_type: 'item', obj_id: id.I1, name: 'Levere',
      at: k.midtPåDøgnet(-1), value: k.dag(-1) + 'T06:10' },
    // Kantene: en halvtime inn fra hver ende av gårsdagen. De regnes fra
    // døgnets egne grenser, ikke i millisekunder fra midnatt (19).
    { type: 'startNow', obj_type: 'item', obj_id: id.I1, name: 'Ved døgnstart',
      at: k.tidligIDøgnet(-1), value: k.dag(-1) + 'T06:10' },
    { type: 'startNow', obj_type: 'item', obj_id: id.I1, name: 'Ved døgnslutt',
      at: k.sentIDøgnet(-1), value: k.dag(-1) + 'T06:10' },
    // Og en eldre bunke, som skal få ukedag + full dato.
    { type: 'startNow', obj_type: 'item', obj_id: id.I2, name: 'Pumpe dekk',
      at: k.midtPåDøgnet(-5), value: k.dag(-5) + 'T06:00' },
  ]);
  await cycle(p);
  await p.click('#notif-btn');
  await p.waitForTimeout(300);

  const bunker = await p.evaluate(() => [...document.querySelectorAll('#notif-body .notif-day')]
    .map((sec) => ({
      dag: sec.querySelector('.notif-day-head').textContent,
      rader: [...sec.querySelectorAll('.notif-item')].map((li) => ({
        navn: li.querySelector('.notif-name').textContent,
        melding: li.querySelector('.notif-meta').textContent,
      })),
    })));
  log('14a: varslene samles i bunker per døgn, nyeste bunke øverst',
    bunker.length === 3 && bunker[0].dag === 'I dag' && bunker[1].dag === 'I går',
    JSON.stringify(bunker.map((b) => b.dag)));
  /* Ukedagen og måneden leses ut av datostrengen fra siden. `new Date(år, mnd,
     dag)` er lokal veggtid i testprosessen, men ukedagen til en kalenderdato
     er den samme i enhver sone — datoen er alt hentet fra nettleseren. */
  const eldreDel = k.dag(-5).split('-').map(Number);
  const eldre = new Date(eldreDel[0], eldreDel[1] - 1, eldreDel[2]);
  const ukedager = ['Søndag', 'Mandag', 'Tirsdag', 'Onsdag', 'Torsdag', 'Fredag', 'Lørdag'];
  const måneder = ('januar februar mars april mai juni juli august september oktober ' +
    'november desember').split(' ');
  const ventet = ukedager[eldre.getDay()] + ' ' + eldre.getDate() + '. ' + måneder[eldre.getMonth()];
  log('14b: eldre bunker står med ukedag foran den fulle datoen',
    bunker.length === 3 && bunker[2].dag === ventet,
    (bunker.length === 3 ? bunker[2].dag : '(' + bunker.length + ' bunker)') +
      ' (ventet ' + ventet + ')');

  const m = {};
  bunker.forEach((b) => b.rader.forEach((r) => { m[r.navn] = r.melding; }));
  log('14c: en utløpt frist sier hva som skjedde og når den var',
    m.Skattemelding === 'Fristen er utløpt – den var i dag kl. 09:00.', m.Skattemelding);
  log('14d: en start uten klokkeslett nevner ikke noe klokkeslett',
    m.Sykkeltur === 'Begynte i dag.', m.Sykkeltur);
  log('14e: et døgn fram heter «i morgen», ikke en dato',
    m.Pakke === 'Begynner i morgen kl. 17:00.', m.Pakke);
  log('14f: gårsdagen heter «i går»', m.Levere === 'Begynte i går kl. 06:10.', m.Levere);
  const eldreDag = eldre.getDate() + '. ' + ('jan feb mar apr mai jun jul aug sep okt nov des'
    .split(' ')[eldre.getMonth()]);
  log('14g: lenger tilbake står den faktiske datoen i meldingen',
    m['Pumpe dekk'] === 'Begynte ' + eldreDag + ' kl. 06:00.', m['Pumpe dekk']);
  /* Hele kalenderdøgnet i ÉN bunke, kantene med. Bunkene brytes på det LOKALE
     døgnet (`localDateStr`); en nøkkel regnet i UTC ville lagt kl. 00:30 og
     kl. 23:30 samme dag i hver sin bunke overalt der sonen har et offset. */
  const iGår = bunker.find((b) => b.dag === 'I går');
  log('14h: hele døgnet havner i ÉN bunke — også radene i kantene av det',
    !!iGår && eq(iGår.rader.map((r) => r.navn),
      ['Ved døgnslutt', 'Levere', 'Ved døgnstart']),
    JSON.stringify(iGår ? iGår.rader.map((r) => r.navn) : null));

  log('datoer: døgnet fiksturen ble datert i står til siste sjekk',
    await sammeDøgn(p, k) === true);
  log('datoer: ingen JS-feil', errs.length === 0, errs.join(' | '));
  await browser.close();
}

/* VARSEL-TOASTENE. Et varsel som dukker opp mens appen står åpen springer ut
   fra bjelleknappen: farget etter typen, i tre sekunder, med trykk til
   varselet og sveip-til-høyre for å fjerne den før tiden er ute. */
async function runToasts() {
  const browser = await chromium.launch();
  const p = await nySide(browser, { viewport: { width: 1200, height: 900 } });
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  console.log('\n== toasts ==');
  const { id, uid, db } = buildDB();
  // Klokka hentes før seedingen: raden under dateres av den, ikke av Node.
  const k = await sideklokke(p);
  /* HISTORIKKEN SKAL IKKE TOASTE. Raden ligger på kontoen FØR appen åpnes, og
     den første runden seeder «sett»-settet uten å vise noe — ellers ville en
     innlogging gitt en vegg av toaster. */
  db.notifications.push({ id: U(), user_id: uid, key: 'k-gammel', snoozed: false,
    type: 'dueOver', obj_type: 'card', obj_id: id.C1, name: 'Gammel',
    path: 'Arbeid › Klinikk', value: '2026-06-14T12:00',
    at: k.sidenNå(3600000), created_at: k.sidenNå(3600000), read_at: null });
  await seed(p, db, uid);
  await p.waitForTimeout(500);

  log('15a: historikken som alt lå der gir ingen toast',
    (await p.locator('.notif-toast').count()) === 0);

  // … men et varsel som kommer ETTERPÅ gjør det. Objektet får først den tiden
  // varselet handler om — ellers rydder appen raden bort som ugyldig.
  await settTid(p, id.C2, 'due', k.dag(3));
  await addNotifs(p, [{ type: 'dueSoon', obj_type: 'card', obj_id: id.C2, name: 'Sykkeltur',
    at: k.sidenNå(500), value: k.dag(3) }]);
  await cycle(p);
  await p.waitForSelector('.notif-toast', { timeout: 4000 });
  const toast = await p.evaluate(() => {
    const t = document.querySelector('.notif-toast');
    const r = t.getBoundingClientRect();
    const b = document.getElementById('notif-btn').getBoundingClientRect();
    const bg = getComputedStyle(t).backgroundColor;
    return {
      navn: t.querySelector('.notif-toast-name').textContent,
      melding: t.querySelector('.notif-toast-msg').textContent,
      tone: [...t.classList].filter((c) => c.indexOf('is-') === 0).join(''),
      ikon: !!t.querySelector('.event-icon svg'),
      label: t.getAttribute('aria-label'),
      // Springer ut fra bjellen: stabelen henger rett under knappen.
      underBjellen: r.top >= b.bottom && r.top - b.bottom < 40 && Math.abs(r.right - b.right) < 40,
      // Flaten er typens egen farge — halvgjennomsiktig, med blur bak.
      alfa: (bg.match(/rgba?\(([^)]*)\)/) || ['', ''])[1].split(',').map((x) => x.trim())[3],
      blur: getComputedStyle(t).backdropFilter || getComputedStyle(t).webkitBackdropFilter,
    };
  });
  log('15b: toasten viser navn og en kort setning, ikke radens fulle melding',
    toast.navn === 'Sykkeltur' && toast.melding === 'Fristen utløper om 3 dager' && toast.ikon,
    JSON.stringify(toast));
  log('15c: flaten bærer varseltypens tone, halvgjennomsiktig og med blur bak',
    toast.tone === 'is-soon' && parseFloat(toast.alfa) > 0 && parseFloat(toast.alfa) < 1 &&
    /blur/.test(toast.blur || ''), JSON.stringify({ tone: toast.tone, alfa: toast.alfa, blur: toast.blur }));
  log('15d: toasten springer ut fra bjelleknappen', toast.underBjellen === true,
    JSON.stringify(toast.underBjellen));
  log('15e: opplesningen bærer type, navn og melding',
    /^Frist om mindre enn en uke: Sykkeltur\./.test(toast.label || ''), toast.label);

  // Sveip til høyre fjerner den før de tre sekundene er gått.
  const boks = await p.locator('.notif-toast').boundingBox();
  await p.mouse.move(boks.x + 20, boks.y + boks.height / 2);
  await p.mouse.down();
  await p.mouse.move(boks.x + 260, boks.y + boks.height / 2, { steps: 12 });
  await p.mouse.up();
  await p.waitForTimeout(400);
  log('15f: sveip til høyre fjerner toasten før tiden er ute',
    (await p.locator('.notif-toast').count()) === 0);

  // Et nytt varsel → trykk på toasten skal åpne modalen ved NØYAKTIG det varselet.
  await settTid(p, id.I3, 'start', k.dag(0) + 'T07:00');
  await addNotifs(p, [{ type: 'startNow', obj_type: 'item', obj_id: id.I3, name: 'Pakke',
    at: k.sidenNå(300), value: k.dag(0) + 'T07:00' }]);
  await cycle(p);
  await p.waitForSelector('.notif-toast', { timeout: 4000 });
  const toast2 = await p.evaluate(() => ({
    melding: document.querySelector('.notif-toast .notif-toast-msg').textContent,
    tone: [...document.querySelector('.notif-toast').classList].filter((c) => c.indexOf('is-') === 0)[0],
  }));
  log('15g: «Starter nå» har startgruppens egen tone, ikke en varselfarge',
    toast2.melding === 'Starter nå' && toast2.tone === 'is-started', JSON.stringify(toast2));
  await p.click('.notif-toast');
  await p.waitForSelector('#notif-modal:not([hidden])');
  await p.waitForTimeout(400);
  const truffet = await p.evaluate(() => {
    const a = document.activeElement;
    return { iModalen: !!document.getElementById('notif-modal').contains(a),
      navn: a && a.querySelector ? (a.querySelector('.notif-name') || {}).textContent : null,
      toasterIgjen: document.querySelectorAll('.notif-toast').length };
  });
  log('15h: trykk på toasten åpner modalen ved det varselet toasten gjaldt',
    truffet.iModalen === true && truffet.navn === 'Pakke' && truffet.toasterIgjen === 0,
    JSON.stringify(truffet));

  /* Står modalen åpen, ER varselet allerede synlig der — da skal ingen toast
     legge seg oppå og peke på noe brukeren ser. */
  await settTid(p, id.C3, 'due', k.dag(0) + 'T08:00');
  await addNotifs(p, [{ type: 'dueOver', obj_type: 'card', obj_id: id.C3, name: 'Flyttedag',
    at: k.sidenNå(200), value: k.dag(0) + 'T08:00' }]);
  await cycle(p);
  await p.waitForTimeout(500);
  const medÅpenModal = await p.evaluate(() => ({
    toaster: document.querySelectorAll('.notif-toast').length,
    rader: [...document.querySelectorAll('#notif-body .notif-name')].map((e) => e.textContent),
  }));
  log('15i: ingen toast mens varselmodalen står åpen — raden er der allerede',
    medÅpenModal.toaster === 0 && medÅpenModal.rader.indexOf('Flyttedag') > -1,
    JSON.stringify(medÅpenModal));

  /* … og ingen toast oppå et ANNET lag heller. Et trykk på den ville stablet
     varselmodalen oppå laget brukeren står i, og Escape-stigen hadde lukket
     det underste først. */
  await p.keyboard.press('Escape');
  await p.waitForTimeout(300);
  await settTid(p, id.I1, 'start', k.dag(0) + 'T08:00');
  await p.click('#events-btn');
  await p.waitForSelector('#events-modal:not([hidden])');
  await addNotifs(p, [{ type: 'startNow', obj_type: 'item', obj_id: id.I1, name: 'Under kalenderen',
    at: k.sidenNå(30000), value: k.dag(0) + 'T08:00' }]);
  await cycle(p);
  // Raden MÅ ha kommet fram mens kalendermodalen sto åpen — ellers ville
  // fraværet av en toast bevist ingenting.
  const levert = await p.evaluate(() =>
    window.__huskis.notifRows.some((r) => r.name === 'Under kalenderen'));
  log('15j: ingen toast oppå en annen åpen modal',
    levert === true && (await p.locator('.notif-toast').count()) === 0, 'levert ' + levert);
  await p.keyboard.press('Escape');
  await p.waitForTimeout(300);

  /* Følger man ÉN toast inn i modalen, skal søsknene ikke bli liggende oppå
     den ut timeren sin — de viser rader modalen nå selv har. */
  // Tidspunktene settes godt tilbake i tid, og på SIDENS klokke: synligheten
  // (`at <= now`) måles der, ikke i testprosessen.
  await addNotifs(p, [
    { type: 'dueOver', obj_type: 'card', obj_id: id.C1, name: 'Første', at: k.sidenNå(30000), value: '2026-06-14T12:00' },
    { type: 'dueSoon', obj_type: 'card', obj_id: id.C2, name: 'Andre', at: k.sidenNå(20000), value: k.dag(3) },
  ]);
  await cycle(p);
  await p.waitForFunction(() => {
    const n = new Set(window.__huskis.notifRows.map((r) => r.name));
    return n.has('Første') && n.has('Andre');
  }, null, { timeout: 5000, polling: 100 });
  const toFør = await p.locator('.notif-toast').count();
  await p.locator('.notif-toast').first().click();
  await p.waitForSelector('#notif-modal:not([hidden])');
  await p.waitForTimeout(400);
  log('15k: å følge én toast inn i modalen rydder hele stabelen',
    toFør === 2 && (await p.locator('.notif-toast').count()) === 0,
    'før ' + toFør);

  log('toasts: døgnet fiksturen ble datert i står til siste sjekk',
    await sammeDøgn(p, k) === true);
  log('toasts: ingen JS-feil', errs.length === 0, errs.join(' | '));
  await browser.close();
}

/* MIDNATT. Datooverskriftene og dagsnavnene i meldingene avhenger av hvilket
   DØGN vi står i, ikke av radene: en modal som står åpen over midnatt uten at
   noe annet skjer må male seg om av seg selv. Klokka pinnes rett før midnatt
   og spoles forbi den. */
async function runMidnatt() {
  const browser = await chromium.launch();
  /* Dette er det ENE løpet som skal over midnatt, så det pinnes 20 sekunder
     før i stedet for midt på dagen. Klokkeslettet er lokalt og regnes i siden
     (`nySide`): et fast UTC-øyeblikk ville bare vært «rett før midnatt» i én
     bestemt sone, og i en annen gitt en spoling som ikke krysser noe
     døgnskifte i det hele tatt. */
  const p = await nySide(browser, { viewport: { width: 1200, height: 900 },
    kl: [23, 59, 40] });
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  console.log('\n== midnatt ==');
  const { id, uid, db } = buildDB();
  await seed(p, db, uid);

  /* Objektets frist må stemme med varselets verdi, ellers rydder appen raden
     bort. Begge dateres av SIDENS klokke, ikke testprosessens. */
  const fiktivDag = await p.evaluate(() => {
    const n = new Date();
    const pad = (x) => String(x).padStart(2, '0');
    return n.getFullYear() + '-' + pad(n.getMonth() + 1) + '-' + pad(n.getDate());
  });
  await settTid(p, id.C1, 'due', fiktivDag + 'T09:00');
  // Raden må dateres av SIDENS klokke, ikke testprosessens.
  await p.evaluate((cid) => {
    const db = window.HK_MOCK._loadDB();
    const uuid = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
    const n = new Date();
    const pad = (x) => String(x).padStart(2, '0');
    const dag = n.getFullYear() + '-' + pad(n.getMonth() + 1) + '-' + pad(n.getDate());
    db.notifications.push({ id: uuid(), user_id: window.__huskis.authUser.id,
      key: 'k-midnatt', snoozed: false, type: 'dueOver', obj_type: 'card', obj_id: cid,
      name: 'Skattemelding', path: 'Arbeid › Klinikk', value: dag + 'T09:00',
      at: Date.now() - 3600000, created_at: Date.now() - 3600000, read_at: null });
    window.HK_MOCK._saveDB(db);
  }, id.C1);
  await cycle(p);
  await p.click('#notif-btn');
  await p.waitForTimeout(300);
  const før = await p.evaluate(() => ({
    dag: (document.querySelector('.notif-day-head') || {}).textContent || '',
    melding: (document.querySelector('.notif-meta') || {}).textContent || '',
  }));
  log('16a: før midnatt står bunken under «I dag»',
    før.dag === 'I dag' && før.melding === 'Fristen er utløpt – den var i dag kl. 09:00.',
    JSON.stringify(før));

  /* Legg appen STILLE først. Synk-pollet hopper over runder når siden er
     skjult (`startCloudPoll`), så ingen pull maler modalen om — og det er
     nettopp det tilfellet som betyr noe: en modal som står åpen over midnatt
     uten at noe annet skjer. Uten midnattsvekkingen ville en synk-runde skjult
     hullet, og testen bevist ingenting. */
  await p.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
  });
  // Forbi midnatt. Ingen synk, ingen utsatte varsler, ingen `visibilitychange`
  // — bare klokka.
  await p.clock.fastForward('00:40');
  await p.waitForTimeout(600);
  const etter = await p.evaluate(() => ({
    åpen: !document.getElementById('notif-modal').hidden,
    dag: (document.querySelector('.notif-day-head') || {}).textContent || '',
    melding: (document.querySelector('.notif-meta') || {}).textContent || '',
  }));
  log('16b: modalen maler seg om ved midnatt — «I dag» blir «I går»',
    etter.åpen === true && etter.dag === 'I går' &&
    etter.melding === 'Fristen er utløpt – den var i går kl. 09:00.',
    JSON.stringify(etter));

  log('midnatt: ingen JS-feil', errs.length === 0, errs.join(' | '));
  await browser.close();
}

/* DØGNSKIFTET UNDER ET LØP — regresjonstesten for issue #173.

   Fiksturen daterer radene sine i sidens døgn, og appen tegner dem i det
   samme. Krysser løpet et døgnskifte underveis, holder ikke det lenger: da er
   radene datert i går mens appen med rette tegner i dag. Vernet er at hver
   kontekst pinnes midt på dagen (`nySide`), så midnatt er tolv timer unna
   uansett når suiten startes.

   Begge tilfellene drives fram med Playwrights klokke, ikke med riggens egen,
   så beviset ikke henger på hva klokka tilfeldigvis er når testen kjøres:

     18a  et løp pinnet 23:59:40 spoles 40 minutter og MISTER døgnet — faren
          er ekte, og det er nettopp den `sammeDøgn` er satt til å fange;
     18b  et løp der riggen står 23:59:40, men pinningen har fått gjøre jobben
          sin, tåler den samme spolingen;
     18c  pinningen lander midt på dagen fra en hvilken som helst riggklokke.

   18b er den som blir rød hvis pinningen fjernes fra `nySide`: da blir sidens
   klokke stående der riggen sa, og de 40 minuttene bærer den over midnatt. */
async function døgnLøp(browser, opts) {
  const p = await nySide(browser, Object.assign({ viewport: { width: 1200, height: 900 } }, opts));
  const { id, uid, db } = buildDB();
  await seed(p, db, uid);
  const k = await sideklokke(p);
  await addNotifs(p, [{ type: 'dueOver', obj_type: 'card', obj_id: id.C1,
    name: 'Skattemelding', at: k.nettopp(0), value: '2026-06-14T12:00' }]);
  await cycle(p);
  await p.click('#notif-btn');
  await p.waitForTimeout(300);
  const før = await p.evaluate(() => (document.querySelector('.notif-day-head') || {}).textContent || '');
  /* 40 minutter: mer enn nok til å bære et løp pinnet 23:59:40 over midnatt,
     og mangedobbelt av det hele denne filen tar. Modalen står åpen, så
     omtegningen ved midnatt (16) treffer den. */
  await p.clock.fastForward('00:40');
  await p.waitForTimeout(600);
  const etter = await p.evaluate(() => (document.querySelector('.notif-day-head') || {}).textContent || '');
  const stårStille = await sammeDøgn(p, k);
  await p.context().close();
  return { før, etter, stårStille };
}

async function runDøgnskifte() {
  const browser = await chromium.launch();
  console.log('\n== døgnskifte ==');

  // a) Uten vernet: pinnet rett før midnatt, altså slik en urørt rigg ville
  //    stått hvis suiten ble startet 23:59.
  const utsatt = await døgnLøp(browser, { kl: [23, 59, 40] });
  log('18a: et løp som krysser midnatt mister døgnet fiksturen ble datert i',
    utsatt.før === 'I dag' && utsatt.etter === 'I går' && utsatt.stårStille === false,
    JSON.stringify(utsatt));

  // b) Med vernet: riggen står 23:59:40, men pinningen har flyttet løpet midt
  //    på dagen. Samme sekvens, samme spoling.
  const vernet = await døgnLøp(browser, { rigg: [23, 59, 40] });
  log('18b: pinningen holder det SAMME løpet i det samme døgnet',
    vernet.før === 'I dag' && vernet.etter === 'I dag' && vernet.stårStille === true,
    JSON.stringify(vernet));

  /* c) Og pinningen skal lande midt på dagen uansett hva riggens klokke sier —
        også på selveste døgnskiftet. Ingen app lastes her; det som måles er
        klokka siden får. */
  const riggtider = [[0, 0, 5], [6, 30, 0], [12, 0, 0], [18, 45, 0], [23, 59, 59]];
  const landinger = [];
  for (const rigg of riggtider) {
    const p = await nySide(browser, { rigg: rigg });
    landinger.push(await p.evaluate(() => {
      const n = new Date();
      const midnatt = new Date(n.getFullYear(), n.getMonth(), n.getDate(), 24, 0, 0, 0);
      return { time: n.getHours(), timerTilMidnatt: (midnatt - n) / 3600000 };
    }));
    await p.context().close();
  }
  log('18c: pinningen lander midt på dagen fra en hvilken som helst riggklokke',
    landinger.length === riggtider.length &&
    landinger.every((l) => l.time === 12 && l.timerTilMidnatt >= 11),
    JSON.stringify(landinger));

  await browser.close();
}

/* SOMMERTID — regresjonstesten mot 24-timers-antakelsen.

   Et lokalt døgn er ikke alltid 24 timer. I `Europe/Oslo` er søndag 29. mars
   2026 tjuetre timer (klokka hopper 02 → 03) og søndag 25. oktober tjuefem
   (03 → 02). Et tidspunkt som skal ligge i et bestemt døgn må derfor regnes
   fra DØGNETS EGNE grenser, ikke som et antall millisekunder fra midnatt:
   «midnatt + 23,5 t» er 00:30 NESTE døgn på den korte dagen, og en rad som
   skulle ligge sist i går bytter da bunke.

   Løpet står alltid i `Europe/Oslo` — overgangene er den sonens, og det er dem
   som skal testes — og pinnes på datoen ETTER hver overgang, så det er «i går»
   som er det skjeve døgnet. Ingen app lastes; det som måles er regningen. */
async function runSommertid() {
  const browser = await chromium.launch();
  console.log('\n== sommertid ==');
  const T = 3600000;
  /* Kl. 12 lokalt dagen etter hver overgang. Det grove øyeblikket trenger bare
     treffe riktig DATO — `nySide` snapper selv til kl. 12 lokalt derfra. */
  const døgn = [
    { navn: '30. mars (i går var 23 t)', tid: '2026-03-30T10:00:00Z', timer: 23 },
    { navn: '26. oktober (i går var 25 t)', tid: '2026-10-26T11:00:00Z', timer: 25 },
  ];
  const målt = [];
  for (const d of døgn) {
    const p = await nySide(browser, { timezoneId: 'Europe/Oslo', rigg: d.tid });
    const k = await sideklokke(p);
    /* Veggklokke og dato for et øyeblikk, lest i siden — det er den som
       kjenner sonen, og fasiten på hvilket døgn et tidspunkt havner i. */
    const veggtid = (ms) => p.evaluate((ms) => {
      const n = new Date(ms);
      const q = (x) => String(x).padStart(2, '0');
      return { dato: n.getFullYear() + '-' + q(n.getMonth() + 1) + '-' + q(n.getDate()),
        klokke: q(n.getHours()) + ':' + q(n.getMinutes()) };
    }, ms);
    // NØYAKTIG de hjelperne fiksturen selv bruker (14h) — ikke et uttrykk
    // skrevet om igjen her, som ville latt en feil i hjelperen slippe unna.
    const først = await veggtid(k.tidligIDøgnet(-1));
    const sist = await veggtid(k.sentIDøgnet(-1));
    // Slik en 24-timers-antakelse ville regnet det samme tidspunktet.
    const naivt = await veggtid(k.døgnstart(-1) + 23 * 3600000 + 30 * 60000);
    const midt = await veggtid(k.midtPåDøgnet(-1));
    målt.push({ navn: d.navn, venterTimer: d.timer,
      timer: (k.døgnstart(0) - k.døgnstart(-1)) / T,
      iGår: k.dag(-1), først: først, sist: sist, naivt: naivt, midt: midt });
    await p.context().close();
  }

  log('19a: de to overgangsdøgnene er faktisk 23 og 25 timer lange',
    målt.every((m) => m.timer === m.venterTimer),
    JSON.stringify(målt.map((m) => m.navn + ': ' + m.timer + ' t')));

  log('19b: begge kantene av i går ligger I går på overgangsdøgnene, 00:30 og 23:30',
    målt.every((m) => m.først.dato === m.iGår && m.først.klokke === '00:30' &&
      m.sist.dato === m.iGår && m.sist.klokke === '23:30'),
    JSON.stringify(målt.map((m) => [m.først, m.sist])));

  /* Tennene: den samme raden regnet som «midnatt + 23,5 t» sklir ut av døgnet
     sitt på den korte dagen — og lander på feil klokkeslett på den lange. */
  const kort = målt[0];
  const lang = målt[1];
  log('19c: millisekundregningen bommer — den korte dagen mister døgnet helt',
    kort.naivt.dato !== kort.iGår && lang.naivt.dato === lang.iGår &&
    lang.naivt.klokke !== '23:30',
    JSON.stringify({ kort: kort.naivt, lang: lang.naivt,
      iGår: [kort.iGår, lang.iGår] }));

  log('19d: midtpunktet ligger midt i det faktiske døgnet, ikke på kl. 12',
    målt.every((m) => m.midt.dato === m.iGår) &&
    kort.midt.klokke === '12:30' && lang.midt.klokke === '11:30',
    JSON.stringify(målt.map((m) => m.midt)));

  await browser.close();
}

(async () => {
  await run('desktop', { width: 1200, height: 900 }, false);
  await run('mobil', { width: 390, height: 780 }, true);
  await runDatoer();
  await runToasts();
  await runMidnatt();
  await runDøgnskifte();
  await runSommertid();
  await runEngelsk();
  await runKontobytte();
  const ok = results.filter(Boolean).length;
  console.log('\n==== ' + ok + '/' + results.length + ' PASS ====');
  process.exit(ok === results.length ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
