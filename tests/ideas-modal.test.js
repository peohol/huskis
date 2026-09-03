/*
  Regresjonstest: IDÉMODALEN (docs/ideer.md).

  Idéene er kontoens egen hurtigblokk: de henger på BRUKEREN, ikke på et område
  eller en mappe, og de rendres av det samme rad-maskineriet som en liste.
  Filen dekker nettopp de to påstandene, og alt som følger av dem:

     1. Knappen finnes i toppkontrollgruppen, RETT TIL VENSTRE for draktknappen,
        og åpner modalen.
     2. Den grønne idéknappen lager en ukategorisert idé, den gule en kategori,
        og idéknappen NEDERST i en kategori lager en idé direkte i den.
        Navnefeltet åpnes straks; et navnløst objekt blir ikke liggende igjen.
     3. Redigering skjer på TEKSTEN, og feltet er FLERLINJET (<textarea> som
        vokser) — både for idéer og for listepunkter, som deler `editText`.
        Hele teksten skal kunne leses mens den redigeres.
     4. En idékategori omdøpes ved å klikke på navnet, og løses opp med sin ene
        knapp: medlemmene blir stående, som ukategoriserte idéer.
     5. Idéens ene knapp SLETTER: idéen havner i idéenes EGEN søppelkasse, kan
        hentes tilbake derfra, og tømmes for godt derfra.
     6. Dra-og-slipp er det samme systemet som ellers: en idé omrokkeres på
        nivå 1, kan dras INN i en kategori, og et slipp i kassen sletter den
        (kassen vises fram av draget, som på de andre nivåene).
     7. Idéene er KONTOENS: bytter man mappe eller område, står de samme idéene
        der. De skrives dessuten til `ideas`-tabellen, ikke til `items`.
     8. Utloggingen etterlater INGEN åpen overlay og ingen av kontoens idéer i
        DOM-en. `body.no-auth` skjuler bare toppmenyen, board-et og
        hjørneknappene — en modal ligger OVER innloggingsskjermen.

  Kjøres i BEGGE viewportene: dra-og-slipp avhenger av pekertype (mus =
  avstand, touch = trykk-og-hold), og modalens bredde avgjør hvor teksten
  bryter. Gestene bruker den delte `dnd-gestures`-modulen, som gir ekte
  pekerinput.

  Kjør:
    python3 -m http.server 8000                        # fra repo-roten, i egen terminal
    NODE_PATH=$(npm root -g) node tests/ideas-modal.test.js
*/
const { chromium } = require('playwright');
const { centre, past, lift, travel, drop } = require('./dnd-gestures');

const BASE = process.env.HUSKIS_URL || 'http://localhost:8000';
const results = [];
const log = (n, ok, x = '') => { results.push(ok); console.log((ok ? 'PASS' : 'FAIL') + ' — ' + n + (x ? '  [' + x + ']' : '')); };

const U = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
  const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
});

// Et LANGT listepunkt: flerlinjeredigering kan bare måles på tekst som faktisk
// bryter. Den samme teksten brukes til idéen i punkt 3.
const LANG = 'Et ganske langt punkt som helt sikkert går over flere linjer når det står i en smal liste';

function buildDB() {
  const uid = U(), UA = U(), GA = U(), GB = U(), LA = U(), IA = U();
  const base = (x) => Object.assign({ trashed: false, locked: false, unlocked: false,
    invite_policy: 'inherit', collapsed: false, is_cat: false, cat_id: null,
    ts: 1, org: 'a', pos: 0, pos_ts: 1, pos_org: 'a' }, x);
  return {
    ids: { uid, UA, GA, GB, LA, IA },
    db: {
      _rolesBackfilled: true,
      profiles: [{ id: uid, email: 'a@x.no', display_name: 'Ada Idé', user_metadata: {} }],
      passwords: { 'a@x.no': 'x' },
      universes: [base({ id: UA, owner_id: uid, name: 'Området' })],
      groups: [
        base({ id: GA, owner_id: uid, universe_id: UA, name: 'Mappe A' }),
        base({ id: GB, owner_id: uid, universe_id: UA, name: 'Mappe B', pos: 1 }),
      ],
      cards: [base({ id: LA, owner_id: uid, group_id: GA, title: 'Liste A', k: true, p: true, lab_ts: 0, lab_org: '' })],
      items: [base({ id: IA, owner_id: uid, card_id: LA, text: LANG })],
      ideas: [],
      memberships: [{ id: U(), user_id: uid, universe_id: UA, group_id: null, role: 'owner', pos: 0, created_at: 1 }],
      share_invites: [], tombstones: [],
    },
  };
}

async function loadAs(page, db, uid, email) {
  await page.goto(BASE + '/?mock=1');
  await page.evaluate(({ db, uid, email }) => {
    localStorage.clear(); sessionStorage.clear();
    localStorage.setItem('hk-mock-db', JSON.stringify(db));
    // Kontoen har sett hele introduksjonen: verken omvisningen eller et
    // gest-tips skal legge seg over det som testes.
    sessionStorage.setItem('hk-mock-session', JSON.stringify({ id: uid, email,
      user_metadata: { onboarding: { v: 3, status: 'done' },
        tips: { drag: true, trash: true, moveList: true, dragTrash: true } } }));
  }, { db, uid, email });
  await page.goto(BASE + '/?mock=1');
  await page.waitForFunction(() => {
    const H = window.__huskis;
    return H && H.authUser && H.lastMy && H.state.universes.length > 0;
  }, null, { timeout: 15000, polling: 200 });
}

// Skriv i det åpne navnefeltet og avslutt. Feltet lager ALLTID neste rad
// automatisk (idékjeden), så den kjedede redigeringen avbrytes med Escape.
async function skrivNavn(p, sel, tekst, { kjede = true } = {}) {
  await p.waitForSelector(sel + ' .edit-input', { timeout: 5000 });
  await p.fill(sel + ' .edit-input', tekst);
  await p.keyboard.press('Enter');
  await p.waitForTimeout(150);
  if (kjede) { await p.keyboard.press('Escape'); await p.waitForTimeout(120); }
}

// Radene på nivå 1, i rekkefølge: 'idé'/'kategori' + navnet.
const nivå1 = (p) => p.evaluate(() => [...document.querySelectorAll('#ideas-list > li')].map((li) => ({
  slag: li.classList.contains('category') ? 'kategori' : 'idé',
  navn: (li.querySelector('.cat-title, .item-text') || {}).textContent,
})));
const kategoriMedlemmer = (p) => p.evaluate(() => [...document.querySelectorAll('#ideas-list > .category .cat-items > .item')]
  .map((li) => li.querySelector('.item-text').textContent));
// Radene i mock-databasen — beviset for at de er skrevet som IDÉER.
const dbIdeer = (p) => p.evaluate(() => {
  const d = JSON.parse(localStorage.getItem('hk-mock-db') || '{}');
  return (d.ideas || []).map((x) => ({ text: x.text, isCat: !!x.is_cat, iKat: !!x.cat_id, trashed: !!x.trashed }));
});
const ventPåLagret = (p) => p.waitForFunction(
  () => { const el = document.getElementById('sync-status'); return el && el.dataset.state !== 'saving'; },
  null, { timeout: 10000, polling: 200 });

async function run(label, viewport, touch) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext(Object.assign({ viewport },
    touch ? { isMobile: true, hasTouch: true } : {}));
  const p = await ctx.newPage();
  const jsFeil = [];
  p.on('pageerror', (e) => jsFeil.push(String(e)));

  const { ids, db } = buildDB();
  await loadAs(p, db, ids.uid, 'a@x.no');

  /* ---- 1. Knappen: plass og virkning ---- */
  const rekkefølge = await p.$$eval('#corner-controls .corner-btn', (els) => els.map((e) => e.id));
  log(label + ': idéknappen ligger rett til VENSTRE for draktknappen',
    rekkefølge.indexOf('ideas-btn') === rekkefølge.indexOf('theme-toggle-btn') - 1,
    rekkefølge.join(' > '));
  log(label + ': idéknappen har lyspære-ikonet (samme motiv som «Tips» i kontomodalen)',
    await p.$eval('#ideas-btn svg path', (el) => el.getAttribute('d').indexOf('M12 3.2a5.8 5.8 0') === 0));
  await p.click('#ideas-btn');
  await p.waitForSelector('#ideas-modal:not([hidden])');
  log(label + ': knappen åpner idémodalen', true);
  log(label + ': tom modal viser tom-tilstanden',
    await p.$eval('.ideas-empty', (el) => getComputedStyle(el).display !== 'none'));

  /* ---- 2. Opprettelse: idé, kategori, idé i kategori ---- */
  await p.click('#add-idea-btn');
  await skrivNavn(p, '#ideas-list', LANG);
  await p.click('#add-idea-cat-btn');
  await skrivNavn(p, '#ideas-list', 'Ferieplaner', { kjede: false });
  await p.click('#ideas-list .category .cat-add-btn');
  await skrivNavn(p, '#ideas-list .cat-items', 'Sykle langs kysten');

  let rader = await nivå1(p);
  log(label + ': den grønne knappen ga en ukategorisert idé, den gule en kategori',
    rader.length === 2 && rader[0].slag === 'idé' && rader[1].slag === 'kategori' &&
    rader[1].navn === 'Ferieplaner', JSON.stringify(rader));
  log(label + ': idéknappen nederst i kategorien la idéen INNI den',
    JSON.stringify(await kategoriMedlemmer(p)) === JSON.stringify(['Sykle langs kysten']));
  log(label + ': tom-tilstanden er borte når det finnes idéer',
    await p.$eval('.ideas-empty', (el) => getComputedStyle(el).display === 'none'));

  // Et navnløst objekt skal ikke bli liggende igjen.
  const førAvbrutt = (await nivå1(p)).length;
  await p.click('#add-idea-btn');
  await p.waitForSelector('#ideas-list .edit-input');
  await p.keyboard.press('Escape');
  await p.waitForTimeout(150);
  log(label + ': en avbrutt navngiving etterlater ingen navnløs idé',
    (await nivå1(p)).length === førAvbrutt, førAvbrutt + ' rader før og etter');

  /* ---- 3. Redigering skjer på teksten, og er FLERLINJET ---- */
  const idéMål = async () => p.evaluate(() => {
    const el = document.querySelector('#ideas-list > .item .item-text');
    const r = el.getBoundingClientRect();
    // `line-height` er `normal` her, så antall linjer måles med et Range i
    // stedet: én klientboks per linje teksten faktisk brøt i.
    const rng = document.createRange();
    rng.selectNodeContents(el);
    return { h: r.height, linjer: rng.getClientRects().length };
  });
  const iHvile = await idéMål();
  await p.click('#ideas-list > .item .item-text');
  await p.waitForSelector('#ideas-list .edit-input');
  const felt = await p.$eval('#ideas-list .edit-input', (el) => ({
    tag: el.tagName, h: el.getBoundingClientRect().height, rullet: el.scrollHeight - el.clientHeight,
  }));
  log(label + ': idéen redigeres i et FLERLINJET felt (<textarea>)', felt.tag === 'TEXTAREA', felt.tag);
  log(label + ': teksten brøt faktisk over flere linjer i hvile (ellers måler vi ingenting)',
    iHvile.linjer >= 2, iHvile.linjer + ' linjer');
  log(label + ': feltet er høyt nok til hele teksten (ingenting rullet vekk, samme høyde som i hvile)',
    felt.rullet <= 1 && Math.abs(felt.h - iHvile.h) <= 2,
    'hvile ' + Math.round(iHvile.h) + 'px (' + iHvile.linjer + ' linjer) → felt ' + Math.round(felt.h) + 'px, skjult ' + felt.rullet + 'px');
  await p.fill('#ideas-list .edit-input', 'Kjøpe blomster');
  await p.keyboard.press('Enter');
  await p.waitForTimeout(150);
  log(label + ': klikk på teksten redigerte idéen',
    (await nivå1(p))[0].navn === 'Kjøpe blomster');

  /* ---- 4. Kategorien: omdøping og oppløsning ---- */
  await p.click('#ideas-list .category .cat-title');
  await p.waitForSelector('#ideas-list .category .edit-input');
  await p.fill('#ideas-list .category .edit-input', 'Sommer');
  await p.keyboard.press('Enter');
  await p.waitForTimeout(150);
  rader = await nivå1(p);
  log(label + ': klikk på kategorinavnet omdøper den', rader[1] && rader[1].navn === 'Sommer', JSON.stringify(rader));
  log(label + ': kategorien har KUN oppløs-knappen (ingen objektmeny, ingen slett)',
    await p.$eval('#ideas-list .category .cat-head', (el) =>
      el.querySelectorAll('button').length === 1 && !!el.querySelector('.idea-dissolve-btn')));
  log(label + ': idéen har KUN slett-knappen',
    await p.$eval('#ideas-list > .item', (el) =>
      el.querySelectorAll('button').length === 1 && !!el.querySelector('.idea-del-btn')));

  await p.click('#ideas-list .category .idea-dissolve-btn');
  await p.waitForTimeout(200);
  rader = await nivå1(p);
  log(label + ': oppløsning fjerner kategorien og lar medlemmene stå som idéer',
    rader.length === 2 && rader.every((r) => r.slag === 'idé') &&
    rader.some((r) => r.navn === 'Sykle langs kysten'), JSON.stringify(rader));

  /* ---- 5. Sletting og idéenes egen søppelkasse ---- */
  await ventPåLagret(p);
  const antallFørSlett = (await dbIdeer(p)).length;
  await p.click('#ideas-list > .item:first-child .idea-del-btn');
  await p.waitForTimeout(300);
  log(label + ': sletting tar idéen ut av listen', (await nivå1(p)).length === 1);
  log(label + ': idéenes egen søppelkasse dukker opp med antallet',
    await p.$eval('#idea-trash', (el) => !el.hidden) &&
    await p.$eval('#idea-trash-btn .trashcan-count', (el) => el.textContent === '1'));
  await p.click('#idea-trash-btn');
  await p.waitForSelector('#trash-modal:not([hidden])');
  const iKassen = await p.$$eval('#trash-list .trash-name', (els) => els.map((e) => e.textContent));
  log(label + ': søppelkassen viser den slettede idéen', iKassen.length === 1, JSON.stringify(iKassen));
  await p.click('#trash-list .trash-restore, #trash-list button');
  await p.waitForTimeout(250);
  await p.click('#trash-close');
  await p.waitForTimeout(200);
  log(label + ': «Gjenopprett» henter idéen tilbake i listen', (await nivå1(p)).length === 2,
    JSON.stringify(await nivå1(p)));
  await ventPåLagret(p);
  log(label + ': ingen idé gikk tapt underveis', (await dbIdeer(p)).length === antallFørSlett,
    antallFørSlett + ' → ' + (await dbIdeer(p)).length);

  /* ---- 6. Dra-og-slipp: omrokkering og inn i en kategori ---- */
  // Bygg et kjent utgangspunkt: to idéer + én kategori, i den rekkefølgen.
  await p.click('#add-idea-cat-btn');
  await skrivNavn(p, '#ideas-list', 'Bokser', { kjede: false });
  const førDrag = (await nivå1(p)).map((r) => r.navn);
  const idAv = (n) => p.$eval('#ideas-list > li:nth-child(' + n + ')', (el) => el.dataset.id);
  const id1 = await idAv(1), id2 = await idAv(2);
  const sel = (id) => '#ideas-list > li[data-id="' + id + '"]';
  // Målet måles FØR løftet: klonen som holder plassen er en `li` den også, så
  // en `nth-child`-måling under draget ville pekt på den og ikke på naboen.
  const mål = await past(p, sel(id2), 0.9);
  await lift(p, await centre(p, sel(id1) + ' .item-text'), touch);
  await travel(p, mål, touch);
  await drop(p, undefined, touch);
  await p.waitForTimeout(400);
  const etterDrag = (await nivå1(p)).map((r) => r.navn);
  log(label + ': en idé kan omrokkeres med dra-og-slipp',
    etterDrag[0] === førDrag[1] && etterDrag[1] === førDrag[0],
    førDrag.join(' | ') + '  →  ' + etterDrag.join(' | '));

  // … og dras INN i kategorien (den siste raden på nivå 1).
  const idFørst = await idAv(1);
  await lift(p, await centre(p, sel(idFørst) + ' .item-text'), touch);
  await travel(p, () => centre(p, '#ideas-list > .category .cat-items'), touch);
  await drop(p, undefined, touch);
  await p.waitForTimeout(400);
  const medlemmer = await kategoriMedlemmer(p);
  log(label + ': en idé kan dras INN i en kategori', medlemmer.length === 1, JSON.stringify(medlemmer));
  await ventPåLagret(p);
  log(label + ': kategori-medlemskapet er skrevet til databasen',
    (await dbIdeer(p)).some((x) => x.iKat), JSON.stringify(await dbIdeer(p)));

  /* ---- 6b. Slipp i kassen sletter, som på de andre nivåene ---- */
  // Kassen er skjult når den er tom; et drag skal vise den fram som slippmål.
  const førKassen = (await nivå1(p)).length;
  const idDrag = await idAv(1);
  await lift(p, await centre(p, sel(idDrag) + ' .item-text'), touch);
  log(label + ': draget avdekker idé-kassen som slippmål',
    await p.$eval('#idea-trash', (el) => !el.hidden));
  await travel(p, () => centre(p, '#idea-trash-btn'), touch);
  await drop(p, undefined, touch);
  await p.waitForTimeout(500);
  log(label + ': slipp i kassen sletter idéen', (await nivå1(p)).length === førKassen - 1,
    førKassen + ' → ' + (await nivå1(p)).length);
  await p.click('#idea-trash-btn');
  await p.waitForSelector('#trash-modal:not([hidden])');
  const etterSlipp = await p.$$eval('#trash-list .trash-name', (els) => els.map((e) => e.textContent));
  log(label + ': den slupne idéen ligger i idéenes egen kasse', etterSlipp.length === 1,
    JSON.stringify(etterSlipp));
  await p.click('#trash-list .trash-restore, #trash-list button');
  await p.waitForTimeout(250);
  await p.click('#trash-close');
  await p.waitForTimeout(200);

  /* ---- 7. Idéene hører til KONTOEN, ikke til mappen ---- */
  const fasit = JSON.stringify(await nivå1(p));
  await p.click('#ideas-close');
  await p.waitForTimeout(150);
  await p.evaluate((gid) => window.__huskis.setActiveGroup(gid), ids.GB);
  await p.waitForTimeout(400);
  await p.click('#ideas-btn');
  await p.waitForSelector('#ideas-modal:not([hidden])');
  log(label + ': de samme idéene vises i en annen mappe', JSON.stringify(await nivå1(p)) === fasit, fasit);
  const alle = await dbIdeer(p);
  log(label + ': idéene er skrevet til `ideas`-tabellen, ikke til `items`',
    alle.length >= 3 && alle.some((x) => x.isCat),
    JSON.stringify(alle));
  const itemsTekster = await p.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('hk-mock-db') || '{}');
    return (d.items || []).map((x) => x.text);
  });
  log(label + ': ingen idé havnet blant listepunktene',
    !itemsTekster.some((t) => t === 'Kjøpe blomster' || t === 'Bokser'), JSON.stringify(itemsTekster));

  /* ---- 8. Utloggingen etterlater ingenting av kontoen på skjermen ----
     `body.no-auth` skjuler bare toppmenyen, board-et og hjørneknappene. En
     modal er en overlay OVER innloggingsskjermen, så en som ble stående igjen
     viste den utloggede kontoens innhold til noen lukket den. Påstanden er
     derfor generell — INGEN overlay overlever utloggingen — og ikke bare om
     idémodalen: et nytt lag skal være dekket av å ligge i `closeTopLayer`.
     Modalen står allerede åpen fra 7 — det er nettopp tilstanden som skal
     rives ned. */
  const synligeIdéer = await p.$$eval('#ideas-list .item-text', (els) => els.map((e) => e.textContent));
  log(label + ': idémodalen står åpen med innhold før utloggingen',
    synligeIdéer.length > 0, JSON.stringify(synligeIdéer));
  await p.evaluate(() => window.__huskis.logout());
  await p.waitForFunction(() => document.body.classList.contains('no-auth'), null, { timeout: 8000, polling: 100 });
  await p.waitForTimeout(300);
  const etterUtlogging = await p.evaluate(() => ({
    åpne: [...document.querySelectorAll('.modal-overlay, .switcher-overlay')]
      .filter((o) => !o.hidden).map((o) => o.id || o.className),
    idéerIDom: [...document.querySelectorAll('#ideas-list .item-text')].map((e) => e.textContent),
  }));
  log(label + ': ingen overlay overlever utloggingen',
    etterUtlogging.åpne.length === 0, JSON.stringify(etterUtlogging.åpne));
  log(label + ': ingen av den utloggede kontoens idéer ligger igjen i DOM-en',
    etterUtlogging.idéerIDom.length === 0, JSON.stringify(etterUtlogging.idéerIDom));

  log(label + ': ingen JS-feil under hele løpet', jsFeil.length === 0, jsFeil.join(' | '));

  await browser.close();
}

(async () => {
  await run('desktop', { width: 1200, height: 900 }, false);
  await run('mobil', { width: 390, height: 780 }, true);
  const ok = results.filter(Boolean).length;
  console.log('\n==== ' + ok + '/' + results.length + ' PASS ====');
  process.exit(ok === results.length ? 0 : 1);
})();
