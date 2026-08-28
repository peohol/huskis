/*
  Regresjonstest: RANGERINGEN i det globale søket (docs/sok-og-navigering.md).

  Søkelogikken er ren: `searchObjects(q)` bygger indeksen fra `state` og
  returnerer treffene ferdig sortert. Den kjøres derfor gjennom
  `window.__huskis` i stedet for gjennom UI-et — det er rekkefølgen som testes
  her, ikke modalen (den har sin egen fil, `search-navigation.test.js`).

  Dekker:
     1. Tom / kun blank søketekst gir INGEN treff (ingen resultatdump).
     2. Prefikstreff før infikstreff.
     3. Typeprioritet: område → mappe → liste → kategori → listepunkt,
        anvendt INNENFOR hver av de to gruppene.
     4. Eksakt treff før lengre navn innen samme type.
     5. Alfabetisk rekkefølge, med NORSK alfabet (æ, ø, å sist).
     6. Case-insensitivitet.
     7. Norske tegn/Unicode: «å» ≠ «a», og dekomponert «å» (NFD) matcher den
        komponerte.
     8. Stabile ties: like navn i ulike stier får en fast rekkefølge (sti, så
        id), og to søk på rad gir nøyaktig samme liste.
     9. Papirkurvinnhold ekskluderes — på alle nivåer, også listepunkter som
        ligger i en slettet liste.
    10. Ferdige (avkryssede) listepunkter er MED: søk er navigasjon, ikke en
        oppgavelistefiltrering.
    11. Mappekategorier er ikke søkbare objekter (de er overskrifter, ikke
        steder man kan navigere til).
    12. Kontekststien er forfedrene, i rekkefølge — og den skiller to objekter
        med samme navn.

  Kjør:
    python3 -m http.server 8000                        # fra repo-roten, i egen terminal
    NODE_PATH=$(npm root -g) node tests/search-ranking.test.js
*/
const { chromium } = require('playwright');

const BASE = process.env.HUSKIS_URL || 'http://localhost:8000';
const results = [];
const log = (n, ok, x = '') => { results.push(ok); console.log((ok ? 'PASS' : 'FAIL') + ' — ' + n + (x ? '  [' + x + ']' : '')); };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const U = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
  const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
});

/* Fiksturen er bygget rundt søketeksten «ka», som treffer minst ett objekt av
   HVER type i BEGGE gruppene (prefiks og infiks) — pluss et sett navn som bare
   finnes for å bli utelatt (papirkurven) eller for å bevise en tie-regel. */
function buildDB() {
  const uid = 'uS';
  const id = {};
  ['UA', 'UB', 'UTRASH', 'GA', 'GB', 'GC', 'GE', 'GCAT', 'GTRASH',
    'L1', 'L2', 'L3', 'L4', 'L6', 'LTRASH', 'C1', 'C2',
    'I1', 'I2', 'I3', 'ITRASH', 'ILOST', 'IMA', 'IMAA',
    'B1', 'B2', 'B3', 'B4', 'B5'].forEach((k) => { id[k] = U(); });

  const base = (x) => Object.assign({
    trashed: false, locked: false, unlocked: false, invite_policy: 'inherit',
    collapsed: false, is_cat: false, cat_id: null,
    ts: 1, org: 's', pos: 0, pos_ts: 1, pos_org: 's',
  }, x);
  const uni = (i, name, extra) => base(Object.assign({ id: i, owner_id: uid, name }, extra || {}));
  const grp = (i, u, name, extra) => base(Object.assign({ id: i, owner_id: uid, universe_id: u, name }, extra || {}));
  const card = (i, g, title, extra) => base(Object.assign(
    { id: i, owner_id: uid, group_id: g, title, k: true, p: true, lab_ts: 0, lab_org: '' }, extra || {}));
  const item = (i, c, text, extra) => base(Object.assign(
    { id: i, owner_id: uid, card_id: c, text, done: false }, extra || {}));
  const mem = (on, role, pos) => Object.assign(
    { id: U(), user_id: uid, universe_id: null, group_id: null, role, pos: pos || 0, created_at: 1 }, on);

  return { id, db: {
    _rolesBackfilled: true,
    profiles: [{ id: uid, email: 's@x.no', display_name: 'Søker', user_metadata: {} }],
    passwords: { 's@x.no': 'x' },
    uid,
    universes: [
      uni(id.UA, 'Kanal'),                       // prefiks
      uni(id.UB, 'Ukas', { pos: 1 }),            // infiks
      uni(id.UTRASH, 'Kanon', { pos: 2, trashed: true }),  // i papirkurven
    ],
    groups: [
      grp(id.GA, id.UA, 'Kaffe'),                          // prefiks
      grp(id.GB, id.UA, 'Ukast', { pos: 1 }),              // infiks
      grp(id.GE, id.UA, 'Kanne', { pos: 2 }),              // prefiks
      grp(id.GCAT, id.UA, 'Kasserolle', { pos: 3, is_cat: true }), // MAPPEKATEGORI: ikke søkbar
      grp(id.GTRASH, id.UA, 'Kappe', { pos: 4, trashed: true }),   // i papirkurven
      grp(id.GC, id.UB, 'Kaffe'),                          // samme navn, annen sti
    ],
    cards: [
      card(id.L1, id.GA, 'Ka'),                            // EKSAKT treff
      card(id.L2, id.GA, 'Kaker', { pos: 1 }),
      card(id.L6, id.GA, 'Bokstaver', { pos: 2 }),         // bærer alfabet-testen
      card(id.LTRASH, id.GA, 'Kalender', { pos: 3, trashed: true }),
      card(id.L3, id.GB, 'Sjokka'),                        // infiks
      card(id.L4, id.GC, 'Kaker'),                         // samme navn, annen sti
    ],
    items: [
      item(id.C1, id.L1, 'Kanel', { is_cat: true }),                    // kategori, prefiks
      item(id.I1, id.L1, 'Kanin', { pos: 1, cat_id: id.C1 }),           // listepunkt i kategorien
      item(id.I2, id.L1, 'Bokashi', { pos: 2 }),                        // listepunkt, infiks
      item(id.C2, id.L2, 'Makaroni', { is_cat: true }),                 // kategori, infiks
      item(id.I3, id.L2, 'Kavring', { pos: 1, done: true }),            // FERDIG listepunkt
      item(id.ITRASH, id.L2, 'Kasse', { pos: 2, trashed: true }),       // i papirkurven
      item(id.ILOST, id.LTRASH, 'Kalorier'),                            // i en SLETTET liste
      item(id.IMA, id.L2, 'Måned', { pos: 3 }),
      item(id.IMAA, id.L2, 'Maned', { pos: 4 }),
      // Norsk alfabet: æ, ø og å kommer ETTER z.
      item(id.B1, id.L6, 'Bar'),
      item(id.B2, id.L6, 'Byte', { pos: 1 }),
      item(id.B3, id.L6, 'Bær', { pos: 2 }),
      item(id.B4, id.L6, 'Bøk', { pos: 3 }),
      item(id.B5, id.L6, 'Bål', { pos: 4 }),
    ],
    memberships: [mem({ universe_id: id.UA }, 'owner', 0), mem({ universe_id: id.UB }, 'owner', 1),
      mem({ universe_id: id.UTRASH }, 'owner', 2)],
    share_invites: [], tombstones: [],
  } };
}

// «type:navn» for hvert treff — nok til å lese rekkefølgen av en feilende linje.
const hits = (p, q) => p.evaluate((query) =>
  window.__huskis.searchObjects(query).map((h) => h.type + ':' + h.name), q);
// Med sti, der stien er poenget.
const hitsFull = (p, q) => p.evaluate((query) =>
  window.__huskis.searchObjects(query).map((h) => h.type + ':' + h.name + '|' + h.path.join('/')), q);

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));

  const { id, db } = buildDB();
  const uid = db.uid; delete db.uid;
  await p.goto(BASE + '/?mock=1');
  await p.evaluate(({ db, uid }) => {
    localStorage.clear(); sessionStorage.clear();
    localStorage.setItem('hk-mock-db', JSON.stringify(db));
    // Ferdig introduksjon: demoen bytter ut hele state og ville testet noe annet.
    sessionStorage.setItem('hk-mock-session', JSON.stringify({
      id: uid, email: 's@x.no',
      user_metadata: { onboarding: { v: 3, status: 'done' }, tips: { drag: true, trash: true, moveList: true, dragTrash: true } },
    }));
  }, { db, uid });
  await p.goto(BASE + '/?mock=1');
  await p.waitForFunction(() => {
    const H = window.__huskis;
    return H && H.authUser && H.lastMy && H.state.universes.length > 0;
  }, null, { timeout: 15000, polling: 200 });

  /* ---------- 1) Tom søketekst ---------- */
  log('1a: tom søketekst gir ingen treff', eq(await hits(p, ''), []));
  log('1b: bare blanktegn gir ingen treff', eq(await hits(p, '   '), []));

  /* ---------- 2–4, 9–11) Hele rekkefølgen for «ka» ---------- */
  const FASIT = [
    // Prefiksgruppen, i typerekkefølge
    'universe:Kanal',
    'group:Kaffe', 'group:Kaffe', 'group:Kanne',
    'card:Ka', 'card:Kaker', 'card:Kaker',      // eksakt «Ka» før de lengre
    'category:Kanel',
    'item:Kanin', 'item:Kavring',               // «Kavring» er FERDIG og er med
    // Infiksgruppen, samme typerekkefølge
    'universe:Ukas',
    'group:Ukast',
    'card:Sjokka',
    'category:Makaroni',
    'item:Bokashi',
  ];
  const alle = await hits(p, 'ka');
  log('2/3/4: prefiks før infiks, typeprioritet og eksakt-før-lengre',
    eq(alle, FASIT), JSON.stringify(alle));

  /* ---------- 6) Case-insensitivitet ---------- */
  log('6a: STORE bokstaver gir samme liste', eq(await hits(p, 'KA'), FASIT));
  log('6b: blandet skrivemåte gir samme liste', eq(await hits(p, 'Ka'), FASIT));
  log('6c: søketeksten trimmes', eq(await hits(p, '  ka  '), FASIT));

  /* ---------- 7) Norske tegn ---------- */
  const maa = await hits(p, 'må');
  log('7a: «må» treffer «Måned», ikke «Maned»', eq(maa, ['item:Måned']), JSON.stringify(maa));
  log('7b: «MÅ» treffer det samme', eq(await hits(p, 'MÅ'), ['item:Måned']));
  const ma = await hits(p, 'maned');
  log('7c: «maned» treffer «Maned», ikke «Måned» (diakritikk beholdes)',
    eq(ma, ['item:Maned']), JSON.stringify(ma));
  // Dekomponert å (a + ring): NFC-normaliseringen gjør de to like.
  const nfd = await p.evaluate(() => window.__huskis.searchObjects('ma\u030Aned').map((h) => h.name));
  log('7d: dekomponert «å» (NFD) matcher det komponerte navnet',
    eq(nfd, ['Måned']), JSON.stringify(nfd));

  /* ---------- 5) Norsk alfabet ---------- */
  const bok = await p.evaluate(() =>
    window.__huskis.searchObjects('b').filter((h) => h.type === 'item').map((h) => h.name));
  log('5: æ, ø og å sorteres SIST (norsk alfabet)',
    eq(bok, ['Bar', 'Bokashi', 'Byte', 'Bær', 'Bøk', 'Bål']), JSON.stringify(bok));

  /* ---------- 8) Stabile ties ---------- */
  const kaker = await hitsFull(p, 'kaker');
  log('8a: like navn skilles på sti, i fast rekkefølge',
    eq(kaker, ['card:Kaker|Kanal/Kaffe', 'card:Kaker|Ukas/Kaffe']), JSON.stringify(kaker));
  const igjen = await hits(p, 'ka');
  log('8b: to søk på rad gir nøyaktig samme liste', eq(igjen, alle));
  // Samme navn, samme sti-lengde, ulikt område: id-en er siste tie-breaker og
  // holder rekkefølgen i ro over flere kall.
  const kaffe = await p.evaluate(() =>
    window.__huskis.searchObjects('kaffe').map((h) => h.id).join(','));
  const kaffe2 = await p.evaluate(() =>
    window.__huskis.searchObjects('kaffe').map((h) => h.id).join(','));
  log('8c: id-rekkefølgen er den samme i to påfølgende søk', kaffe === kaffe2, kaffe);

  /* ---------- 9) Papirkurven ---------- */
  const søppel = ['Kanon', 'Kappe', 'Kalender', 'Kasse', 'Kalorier'];
  const funnet = søppel.filter((n) => alle.some((h) => h.endsWith(':' + n)));
  log('9a: slettet område/mappe/liste/listepunkt er ikke med', funnet.length === 0, funnet.join(', '));
  const kal = await hits(p, 'kalorier');
  log('9b: et listepunkt i en SLETTET liste er heller ikke med', eq(kal, []), JSON.stringify(kal));

  /* ---------- 10) Ferdige listepunkter ---------- */
  log('10: et avkrysset listepunkt er søkbart', alle.indexOf('item:Kavring') > -1);
  const ferdig = await p.evaluate(() => {
    const H = window.__huskis;
    const it = H.buildSearchIndex().find((r) => r.name === 'Kavring');
    const card = H.state.universes.flatMap((u) => u.groups).flatMap((g) => g.cards || [])
      .find((c) => (c.items || []).some((x) => x.text === 'Kavring'));
    return { indeksert: !!it, done: !!card.items.find((x) => x.text === 'Kavring').done };
  });
  log('10b: og det er faktisk avkrysset i state', ferdig.indeksert && ferdig.done, JSON.stringify(ferdig));

  /* ---------- 11) Mappekategorier ---------- */
  const kass = await hits(p, 'kasserolle');
  log('11: en mappekategori er ikke et søkbart objekt', eq(kass, []), JSON.stringify(kass));

  /* ---------- 12) Kontekststien ---------- */
  const stier = await p.evaluate(() => {
    const H = window.__huskis;
    const by = (n) => H.buildSearchIndex().filter((r) => r.name === n).map((r) => r.type + ':' + r.path.join(' > '));
    return { uni: by('Kanal'), grp: by('Kanne'), card: by('Ka'), cat: by('Kanel'), item: by('Kanin') };
  });
  log('12a: et område har ingen sti', eq(stier.uni, ['universe:']), JSON.stringify(stier.uni));
  log('12b: en mappe har området', eq(stier.grp, ['group:Kanal']), JSON.stringify(stier.grp));
  log('12c: en liste har område > mappe', eq(stier.card, ['card:Kanal > Kaffe']), JSON.stringify(stier.card));
  log('12d: en kategori har område > mappe > liste',
    eq(stier.cat, ['category:Kanal > Kaffe > Ka']), JSON.stringify(stier.cat));
  log('12e: et listepunkt i en kategori har kategorien sist',
    eq(stier.item, ['item:Kanal > Kaffe > Ka > Kanel']), JSON.stringify(stier.item));

  log('ingen JS-feil', errs.length === 0, errs.join(' | '));

  await browser.close();
  const pass = results.filter(Boolean).length;
  console.log('\n==== ' + pass + '/' + results.length + ' PASS ====');
  process.exit(pass === results.length ? 0 : 1);
})();
