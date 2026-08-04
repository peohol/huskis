/*
  Regresjonstest: INTRODUKSJON FOR NYE BRUKERE (interaktiv innføring + tips).

  Innføringen er TILSTANDSBASERT: den går videre når objektet steget ber om
  faktisk finnes hos riktig forelder — aldri fordi en knapp ble trykket.
  Framdriften huskes på KONTOEN (`user_metadata.onboarding`, v2), så et
  påbegynt løp gjenopptas etter reload, ny innlogging og på en annen enhet.
  Autoritativt: docs/introduksjon.md. Testen dekker:

    1. Tom, ny konto starter den interaktive flyten (steg 1 av 8, role=dialog).
    2. Et fortellesteg er modalt; et handlingssteg er det IKKE (aria-modal
       fjernes, laget slipper klikk gjennom til ekte UI).
    3. Steget går IKKE videre kun fordi en knapp ble trykket — ＋ oppretter
       objektet og åpner navnefeltet, og innføringen blir stående.
    4. Avbrutt navngiving (Escape) regnes ikke som fullført: raden forsvinner
       igjen, og steget står.
    5. Hvert nivå må ligge hos RIKTIG forelder (gruppe i universet steget lagde,
       liste i gruppen, listepunkt i listen).
    6. Fokus står på den EKTE kontrollen, og Enter der utfører handlingen.
    7. Skjermleser: role=dialog, live-område, aria-modal kun på fortellesteg.
    8. Ventende invitasjon blokkeres ikke — konto-knappen er klikkbar under et
       handlingssteg, og badgen står.
    9. «Hopp over» virker på ethvert steg og lagres som «skipped».
   10. Reload midt i et steg gjenopptar samme steg med samme kontekst.
   11. Ny innlogging (annen enhet) gjenopptar også.
   12. Slettede referanser låser ikke: gjenopptakelsen faller tilbake.
   13. Fullført innføring vises ikke automatisk igjen.
   14. Eksisterende v1-brukere («done»/«skipped») tvinges ikke inn i v2.
   15. «Vis på nytt» på en etablert konto kjører REPETISJON — ingen duplikater.
   16. Bruker uten opprettelsesrett får ikke et umulig steg («Hopp over steget»).
   17. En synk-avvisning markerer ikke steget som fullført, og sier fra.
   18. En bakgrunnsrendring/synk-runde river ikke ned innføringen.
   19. En feilet metadataoppdatering prøves på nytt — mot RIKTIG konto.
   20. «Reduser bevegelse».
   21. Kontekstuelle tips (etter at innføringen er ferdig).

  Kjøres på både desktop- og mobil-viewport.

  Kjør:
    python3 -m http.server 8000                  # fra repo-roten, i egen terminal
    NODE_PATH=$(npm root -g) node tests/onboarding.test.js
*/
const { chromium } = require('playwright');

const BASE = process.env.HUSKIS_URL || 'http://localhost:8000';

const results = [];
const log = (n, ok, x = '') => { results.push(ok); console.log((ok ? 'PASS' : 'FAIL') + ' — ' + n + (x ? '  [' + x + ']' : '')); };

const U = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
  const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
});

/* ---------------- Felles hjelpere ---------------- */

// Registrer + logg inn en fersk konto (som nav-modal.test.js).
async function register(p) {
  await p.goto(BASE + '/?mock=1');
  await p.waitForFunction(() => !!window.__huskis, null, { timeout: 10000, polling: 100 });
  const email = 'u' + Math.floor(Math.random() * 1e9) + '@test.no';
  await p.getByText('Registrer deg').click();
  await p.locator('#auth-first-name').waitFor({ state: 'visible' });
  await p.locator('#auth-first-name').fill('Test');
  await p.locator('#auth-last-name').fill('Bruker');
  await p.locator('#auth-email').fill(email);
  await p.locator('#auth-password').fill('passord123');
  await p.locator('#auth-submit').click();
  await p.getByText('Tilbake til innlogging').click();
  await p.locator('#auth-email').waitFor({ state: 'visible' });
  await p.locator('#auth-email').fill(email);
  await p.locator('#auth-password').fill('passord123');
  await p.locator('#auth-submit').click();
  // Fersk konto skal ALLTID få innføringen: ferdig når den står på skjermen.
  await waitStep(p, 'welcome');
  return email;
}

// Vent på at innføringen står på ET BESTEMT steg — testens grunnleggende
// tilstandsventing. Ingen klokke: steget er signalet.
const waitStep = (p, id, timeout = 10000) => p.waitForFunction(
  (want) => {
    const H = window.__huskis;
    return !!H && !!H.authUser && H.tour.active && H.tour.id === want &&
      !document.getElementById('tour').hidden;
  }, id, { timeout, polling: 100 });

// Tilstanden innføringen er i, lest fra DOM-en + den eksponerte tour-fasaden.
const tourState = (p) => p.evaluate(() => {
  const el = document.getElementById('tour');
  const card = document.getElementById('tour-card');
  const spot = document.getElementById('tour-spot');
  const H = window.__huskis;
  return {
    open: !el.hidden,
    id: H.tour.active ? H.tour.id : null,
    index: H.tour.index,
    mode: H.tour.mode,
    ctx: H.tour.ctx,
    narrated: H.tour.active ? H.tour.narrated : null,
    guided: el.classList.contains('guided'),
    noSpot: el.classList.contains('no-spot'),
    bodyGuided: document.body.classList.contains('tour-guided'),
    step: document.getElementById('tour-step').textContent,
    title: document.getElementById('tour-title').textContent,
    note: document.getElementById('tour-note').textContent,
    noteError: document.getElementById('tour-note').classList.contains('is-error'),
    nextHidden: document.getElementById('tour-next').hidden,
    skipStepHidden: document.getElementById('tour-skip-step').hidden,
    role: card.getAttribute('role'),
    modal: card.getAttribute('aria-modal'),
    live: !!card.querySelector('[aria-live="polite"]'),
    labelledby: card.getAttribute('aria-labelledby'),
    focusId: document.activeElement.id,
    spotRect: el.hidden ? null : spot.getBoundingClientRect().toJSON(),
    cardRect: el.hidden ? null : card.getBoundingClientRect().toJSON(),
  };
});

// Kontoens lagrede metadata, lest fra den DELTE mock-«databasen» (det som ville
// ligget på serveren) — ikke fra fanens egen sesjon.
const accountMeta = (p, email) => p.evaluate((mail) => {
  const db = JSON.parse(localStorage.getItem('hk-mock-db') || '{}');
  const prof = (db.profiles || []).find((x) => x.email === mail);
  return (prof && prof.user_metadata) || null;
}, email);

// «Logg inn på en annen enhet»: bygg fanens sesjon på nytt fra kontoens rad i
// databasen (nøyaktig det signInWithPassword gjør) og last siden på nytt.
async function loginOnOtherDevice(p, email) {
  await p.evaluate((mail) => {
    const db = JSON.parse(localStorage.getItem('hk-mock-db') || '{}');
    const prof = (db.profiles || []).find((x) => x.email === mail);
    sessionStorage.setItem('hk-mock-session', JSON.stringify({
      id: prof.id, email: prof.email, user_metadata: prof.user_metadata || {},
    }));
    // Den lokale kopien tømmes: en annen enhet har ikke sett denne kontoen før.
    Object.keys(localStorage).filter((k) => /^hk-(?!mock-db)/.test(k))
      .forEach((k) => localStorage.removeItem(k));
  }, email);
  await p.goto(BASE + '/?mock=1');
  await p.waitForFunction(() => {
    const H = window.__huskis;
    return H && H.authUser && H.lastMy;
  }, null, { timeout: 10000, polling: 200 });
}

// Innlogget og ferdig med første synk-runde, uten å kreve at innføringen kom.
const waitReady = (p) => p.waitForFunction(() => {
  const H = window.__huskis;
  return H && H.authUser && H.lastMy;
}, null, { timeout: 10000, polling: 200 });

// Rektanglene overlapper i hovedsak (spotlighten har 6px luft rundt målet).
function covers(spot, target) {
  if (!spot || !target) return false;
  return spot.x <= target.x + 1 && spot.y <= target.y + 1 &&
    spot.x + spot.width >= target.x + target.width - 1 &&
    spot.y + spot.height >= target.y + target.height - 1;
}

// Er punktet midt i elementet faktisk elementet selv? (= laget slipper klikk
// gjennom, og ingenting usynlig ligger oppå.)
const hittable = (p, sel) => p.evaluate((s) => {
  const el = document.querySelector(s);
  if (!el) return false;
  const r = el.getBoundingClientRect();
  const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
  return !!hit && (el.contains(hit) || hit.contains(el));
}, sel);

/* Kjør de fire handlingsstegene til ende. Brukes av flere løp; hvert steg
   ventes ut på TILSTAND, aldri på klokka. */
async function doUniverse(p, name) {
  await waitStep(p, 'create_universe');
  await p.locator('.nav-add-uni button').click();
  await p.locator('.edit-input').waitFor({ state: 'visible' });
  await p.keyboard.type(name);
  await p.keyboard.press('Enter');
}
async function doGroup(p, name) {
  await waitStep(p, 'create_group');
  await p.locator('.uni-card .add-item-row .add-item-btn').first().click();
  await p.locator('.edit-input').waitFor({ state: 'visible' });
  await p.keyboard.type(name);
  await p.keyboard.press('Enter');
}
async function doOpenGroup(p) {
  await waitStep(p, 'open_group');
  const gid = (await tourState(p)).ctx.groupId;
  await p.locator('.uni-card .item[data-id="' + gid + '"]').click();
}
async function doCard(p, name) {
  await waitStep(p, 'create_card');
  await p.locator('#add-card-btn').click();
  await p.locator('.edit-input').waitFor({ state: 'visible' });
  await p.keyboard.type(name);
  await p.keyboard.press('Enter');
}
async function doItem(p, text) {
  await waitStep(p, 'create_item');
  const cid = (await tourState(p)).ctx.cardId;
  await p.locator('.board .card[data-id="' + cid + '"] .add-item-row .add-item-btn').click();
  await p.locator('.edit-input').waitFor({ state: 'visible' });
  await p.keyboard.type(text);
  await p.keyboard.press('Enter');
}

/* ============================================================
   HOVEDLØP — hele den interaktive flyten, desktop + mobil
   ============================================================ */
async function run(label, vp, mobile) {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: vp, isMobile: mobile, hasTouch: mobile });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  console.log('\n== ' + label + ' ==');
  const email = await register(p);

  /* ---------- 1) Førstegangsvisning ---------- */
  const s1 = await tourState(p);
  log(label + ' 1: tom, ny konto starter den interaktive innføringen',
    s1.open && s1.id === 'welcome' && /Steg 1 av 8/.test(s1.step) && s1.role === 'dialog',
    JSON.stringify({ id: s1.id, step: s1.step, role: s1.role }));
  log(label + ' 1b: velkomsten er kort og sier hva som skal gjøres',
    /univers/i.test(await p.locator('#tour-text').innerText()) &&
    /listepunkt/i.test(await p.locator('#tour-text').innerText()),
    (await p.locator('#tour-text').innerText()).replace(/\s+/g, ' ').slice(0, 70));
  log(label + ' 2: fortellesteget er modalt (aria-modal, fokus i kortet)',
    s1.narrated === true && s1.modal === 'true' && s1.focusId === 'tour-card' && !s1.bodyGuided,
    JSON.stringify({ modal: s1.modal, focus: s1.focusId }));

  /* ---------- 2) Handlingssteg: ekte UI, ikke en kopi ---------- */
  await p.locator('#tour-next').click();
  await waitStep(p, 'open_nav');
  const s2 = await tourState(p);
  const crumb = await p.locator('#nav-crumb').boundingBox();
  log(label + ' 3: handlingssteget spotlighter navigasjonsknappen',
    !s2.noSpot && covers(s2.spotRect, crumb), JSON.stringify({ spot: s2.spotRect, crumb }));
  log(label + ' 3b: kortet dekker ikke det markerte elementet',
    s2.cardRect.y >= crumb.y + crumb.height || s2.cardRect.y + s2.cardRect.height <= crumb.y,
    JSON.stringify({ card: s2.cardRect, crumb }));
  log(label + ' 4: handlingssteget er IKKE modalt (aria-modal fjernet, laget dempet)',
    s2.narrated === false && s2.modal === null && s2.guided && s2.bodyGuided,
    JSON.stringify({ modal: s2.modal, guided: s2.guided }));
  log(label + ' 4b: målet tar imot klikk gjennom laget', await hittable(p, '#nav-crumb'));
  log(label + ' 5: fokus står på den EKTE kontrollen, ikke i kortet',
    s2.focusId === 'nav-crumb', 'fokus=' + s2.focusId);
  log(label + ' 5b: «Neste» finnes ikke på et handlingssteg',
    s2.nextHidden, 'skjult=' + s2.nextHidden);
  log(label + ' 5c: instruksjonen står i kortet',
    /Trykk på knappen/.test(s2.note), s2.note);

  // …og Enter på det fokuserte målet utfører handlingen: steget går videre uten
  // at testen rørte en eneste knapp i innføringskortet.
  await p.keyboard.press('Enter');
  await waitStep(p, 'create_universe');
  log(label + ' 6: Enter på det fokuserte målet fører innføringen videre (tastatur)', true,
    'steg=' + (await tourState(p)).id);

  /* ---------- 3) En knapp alene fullfører ikke et steg ---------- */
  const before = await tourState(p);
  await p.locator('.nav-add-uni button').click();
  await p.locator('.edit-input').waitFor({ state: 'visible' });
  // Vent på TILSTAND: instruksjonen males av observatøren, som går hvert
  // TOUR_POLL_MS. Å lese den i samme øyeblikk som feltet dukket opp ville vært
  // et kappløp — og påstanden her er uansett at steget IKKE gikk videre.
  await p.waitForFunction(() => /Skriv navnet/.test(
    document.getElementById('tour-note').textContent), null, { timeout: 5000, polling: 100 });
  const during = await tourState(p);
  log(label + ' 7: ＋ alene fører IKKE innføringen videre (navnefeltet står åpent)',
    during.id === 'create_universe' && during.index === before.index &&
    /Skriv navnet/.test(during.note),
    JSON.stringify({ id: during.id, note: during.note }));

  await p.keyboard.type('Hjemme');
  await p.keyboard.press('Enter');
  await waitStep(p, 'create_group');
  const afterUni = await tourState(p);
  const uniOk = await p.evaluate((id) => {
    const u = window.__huskis.state.universes.find((x) => x.id === id);
    return !!u && !u.trashed && String(u.name).trim() === 'Hjemme';
  }, afterUni.ctx.universeId);
  log(label + ' 8: universet må finnes (med navn) før gruppesteget begynner',
    uniOk && !!afterUni.ctx.universeId, JSON.stringify(afterUni.ctx));

  /* ---------- 4) Avbrutt navngiving er ikke en fullført handling ---------- */
  await p.locator('.uni-card .add-item-row .add-item-btn').first().click();
  await p.locator('.edit-input').waitFor({ state: 'visible' });
  await p.keyboard.press('Escape');
  // FAST venting med vilje: dette er et FRAVÆRSBEVIS («steget gikk IKKE
  // videre»), og fravær kan først påstås etter at observatøren har rukket
  // minst én runde (TOUR_POLL_MS = 250 ms).
  await p.waitForTimeout(700);
  const cancelled = await tourState(p);
  const groupsNow = await p.evaluate((id) => {
    const u = window.__huskis.state.universes.find((x) => x.id === id);
    return u ? u.groups.filter((g) => !g.trashed && !g._pendingDelete).length : -1;
  }, afterUni.ctx.universeId);
  log(label + ' 9: avbrutt navngiving regnes ikke som fullført',
    cancelled.id === 'create_group' && !cancelled.ctx.groupId && groupsNow === 0,
    JSON.stringify({ id: cancelled.id, grupper: groupsNow }));

  /* ---------- 5) Riktig forelder på hvert nivå ---------- */
  await doGroup(p, 'Ukesplan');
  await waitStep(p, 'open_group');
  const afterGroup = await tourState(p);
  const groupParent = await p.evaluate((c) => {
    const u = window.__huskis.state.universes.find((x) => x.id === c.universeId);
    const g = u && u.groups.find((x) => x.id === c.groupId);
    return { funnet: !!g, uni: g ? g.uni : null, navn: g ? g.name : null };
  }, afterGroup.ctx);
  log(label + ' 10: gruppen ligger i universet innføringen lagde',
    groupParent.funnet && groupParent.uni === afterGroup.ctx.universeId &&
    groupParent.navn === 'Ukesplan', JSON.stringify(groupParent));

  await doOpenGroup(p);
  await waitStep(p, 'create_card');
  const opened = await p.evaluate(() => window.__huskis.state.activeGroup);
  log(label + ' 11: gruppen er faktisk aktiv før listesteget begynner',
    opened === afterGroup.ctx.groupId, opened);

  await doCard(p, 'Handleliste');
  await waitStep(p, 'create_item');
  const afterCard = await tourState(p);
  const cardParent = await p.evaluate((c) => {
    const u = window.__huskis.state.universes.find((x) => x.id === c.universeId);
    const g = u && u.groups.find((x) => x.id === c.groupId);
    const k = g && g.cards.find((x) => x.id === c.cardId);
    return { funnet: !!k, gruppe: k ? k.group : null, tittel: k ? k.title : null };
  }, afterCard.ctx);
  log(label + ' 12: listen ligger i gruppen innføringen lagde',
    cardParent.funnet && cardParent.gruppe === afterCard.ctx.groupId &&
    cardParent.tittel === 'Handleliste', JSON.stringify(cardParent));

  /* ---------- 6) Invitasjoner blokkeres ikke midt i et steg ---------- */
  log(label + ' 13: konto-knappen (innboksen) er klikkbar under et handlingssteg',
    await hittable(p, '#account-btn'));

  await doItem(p, 'Melk');
  await waitStep(p, 'finish');
  const afterItem = await tourState(p);
  const itemParent = await p.evaluate((c) => {
    const u = window.__huskis.state.universes.find((x) => x.id === c.universeId);
    const g = u && u.groups.find((x) => x.id === c.groupId);
    const k = g && g.cards.find((x) => x.id === c.cardId);
    const items = k ? k.items.filter((it) => !it.isCat && !it.trashed) : [];
    return { antall: items.length, hjem: items[0] ? items[0].home : null, tekst: items[0] ? items[0].text : null };
  }, afterCard.ctx);
  log(label + ' 14: listepunktet ligger i listen innføringen lagde',
    itemParent.antall === 1 && itemParent.hjem === afterCard.ctx.cardId &&
    itemParent.tekst === 'Melk', JSON.stringify(itemParent));

  /* ---------- 7) Avslutning ---------- */
  const fin = await tourState(p);
  log(label + ' 15: avslutningen er et fortellesteg med «Ferdig»',
    fin.narrated === true && fin.modal === 'true' && !fin.nextHidden &&
    (await p.locator('#tour-next').innerText()).trim() === 'Ferdig',
    JSON.stringify({ narrated: fin.narrated, id: fin.id }));
  log(label + ' 15b: avslutningen peker på det som IKKE var obligatorisk',
    /kategori/i.test(await p.locator('#tour-text').innerText()) &&
    /del/i.test(await p.locator('#tour-text').innerText()));
  log(label + ' 16: skjermlesersemantikk (dialog + live-område + tittel)',
    fin.role === 'dialog' && fin.live && fin.labelledby === 'tour-title');

  await p.locator('#tour-next').click();
  await p.waitForFunction(() => document.getElementById('tour').hidden,
    null, { timeout: 5000, polling: 100 });
  const metaDone = await accountMeta(p, email);
  log(label + ' 17: fullført innføring lagres som «done» på v2, med steg + kontekst',
    !!metaDone && metaDone.onboarding.v === 2 && metaDone.onboarding.status === 'done' &&
    metaDone.onboarding.step === 'finish' &&
    metaDone.onboarding.context.cardId === afterCard.ctx.cardId,
    JSON.stringify(metaDone && metaDone.onboarding));
  log(label + ' 17b: det som ble laget står igjen (ekte innhold, ikke demo)',
    await p.evaluate(() => {
      const st = window.__huskis.state;
      const u = st.universes.filter((x) => !x.trashed && !x._virtual);
      return u.length === 1 && u[0].groups.filter((g) => !g.trashed).length === 1;
    }));
  log(label + ' 17c: kroppen er ryddet etter innføringen (ingen dempet UI igjen)',
    !(await p.evaluate(() => document.body.classList.contains('tour-guided'))));

  /* ---------- 8) Ikke igjen på en annen enhet ---------- */
  await loginOnOtherDevice(p, email);
  // FAST venting med vilje: fraværsbevis («innføringen kommer IKKE igjen»).
  await p.waitForTimeout(900);
  log(label + ' 18: fullført innføring vises ikke automatisk igjen',
    !(await tourState(p)).open);

  /* ---------- 9) «Vis på nytt» på en etablert konto = repetisjon ---------- */
  const førRestart = await p.evaluate(() => JSON.stringify(window.__huskis.state.universes.length));
  await p.locator('#account-btn').click();
  await p.locator('#menu-tour').waitFor({ state: 'visible' });
  log(label + ' 19: konto-modalen har raden «Introduksjon til Huskis»',
    await p.locator('#menu-tour').isVisible());
  await p.locator('#tour-restart').click();
  await waitStep(p, 'welcome');
  const rest = await tourState(p);
  log(label + ' 19b: «Vis på nytt» starter i repetisjonsmodus på en konto med innhold',
    rest.mode === 'review' && rest.index === 0 &&
    (await p.locator('#account-modal').isHidden()), rest.mode);

  await p.locator('#tour-next').click();
  await waitStep(p, 'open_nav');
  await p.locator('#nav-crumb').click();
  await waitStep(p, 'create_universe');
  const review = await tourState(p);
  log(label + ' 20: repetisjonen peker på universet som ALLEREDE finnes',
    review.mode === 'review' && !review.skipStepHidden,
    JSON.stringify({ mode: review.mode, hoppSteg: !review.skipStepHidden }));
  // …og går videre uten at noe nytt ble laget.
  await waitStep(p, 'create_group');
  const etterRestart = await p.evaluate(() => JSON.stringify(window.__huskis.state.universes.length));
  log(label + ' 20b: repetisjonen lager ingen duplikater',
    førRestart === etterRestart, førRestart + ' → ' + etterRestart);

  /* ---------- 10) «Hopp over» på et vilkårlig steg ---------- */
  await p.locator('#tour-skip').click();
  await p.waitForFunction(() => document.getElementById('tour').hidden,
    null, { timeout: 5000, polling: 100 });
  const metaSkip = await accountMeta(p, email);
  log(label + ' 21: «Hopp over» midt i et løp lagres som «skipped»',
    metaSkip.onboarding.status === 'skipped' && metaSkip.onboarding.v === 2,
    JSON.stringify(metaSkip.onboarding));

  log(label + ' 22: ingen JS-feil', errs.length === 0, errs.join(' | '));
  await b.close();
}

/* ============================================================
   GJENOPPTAKELSE — reload, ny innlogging, slettet referanse
   ============================================================ */
async function runResume() {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1200, height: 900 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  console.log('\n== gjenopptakelse ==');
  const email = await register(p);

  await p.locator('#tour-next').click();
  await waitStep(p, 'open_nav');
  await p.locator('#nav-crumb').click();
  await doUniverse(p, 'Hjemme');
  await doGroup(p, 'Ukesplan');
  await doOpenGroup(p);
  await waitStep(p, 'create_card');
  const midt = await tourState(p);

  const lagret = await accountMeta(p, email);
  log('res 1: framdriften lagres underveis som «in_progress» med steg + kontekst',
    lagret.onboarding.status === 'in_progress' && lagret.onboarding.step === 'create_card' &&
    lagret.onboarding.context.groupId === midt.ctx.groupId,
    JSON.stringify(lagret.onboarding));

  /* Reload midt i steget. */
  await p.reload();
  await waitStep(p, 'create_card');
  const etterReload = await tourState(p);
  log('res 2: reload midt i et steg gjenopptar samme steg med samme kontekst',
    etterReload.id === 'create_card' &&
    etterReload.ctx.groupId === midt.ctx.groupId &&
    etterReload.ctx.universeId === midt.ctx.universeId,
    JSON.stringify(etterReload.ctx));

  /* Ny innlogging / annen enhet. */
  await loginOnOtherDevice(p, email);
  await waitStep(p, 'create_card');
  const annenEnhet = await tourState(p);
  log('res 3: ny innlogging (annen enhet) gjenopptar samme steg',
    annenEnhet.id === 'create_card' && annenEnhet.ctx.groupId === midt.ctx.groupId,
    JSON.stringify(annenEnhet.ctx));

  /* Framdriften går ikke bakover fordi en eldre lagret tilstand dukker opp. */
  await doCard(p, 'Handleliste');
  await waitStep(p, 'create_item');
  await p.evaluate((c) => {
    // Simuler et sent svar/en eldre enhet: skriv et LAVERE steg til kontoen.
    window.__huskis.authUser.meta = Object.assign({}, window.__huskis.authUser.meta, {
      onboarding: { v: 2, status: 'in_progress', step: 'open_nav', context: c },
    });
  }, annenEnhet.ctx);
  await p.waitForTimeout(600);   // fraværsbevis: steget skal IKKE rykke tilbake
  const ikkeBakover = await tourState(p);
  log('res 4: framdriften går ikke bakover av en eldre metadatatilstand',
    ikkeBakover.id === 'create_item', ikkeBakover.id);

  /* Slettede referanser låser ikke: gjenopptakelsen faller tilbake. */
  const ctx = (await tourState(p)).ctx;
  await p.evaluate((c) => {
    const db = JSON.parse(localStorage.getItem('hk-mock-db') || '{}');
    const prof = db.profiles.find((x) => x.id === JSON.parse(sessionStorage.getItem('hk-mock-session')).id);
    prof.user_metadata = Object.assign({}, prof.user_metadata, {
      onboarding: { v: 2, status: 'in_progress', step: 'create_item', context: c },
    });
    // Gruppen (og dermed listen) er borte når økten starter neste gang.
    db.groups = db.groups.filter((g) => g.id !== c.groupId);
    db.cards = db.cards.filter((k) => k.group_id !== c.groupId);
    db.items = [];
    localStorage.setItem('hk-mock-db', JSON.stringify(db));
  }, ctx);
  await loginOnOtherDevice(p, email);
  await waitStep(p, 'create_group');
  const falt = await tourState(p);
  log('res 5: slettede referanser låser ikke — gjenopptakelsen faller tilbake',
    falt.id === 'create_group', falt.id);

  log('res 6: ingen JS-feil', errs.length === 0, errs.join(' | '));
  await b.close();
}

/* ============================================================
   EKSISTERENDE BRUKERE, RETTIGHETER, SYNK-FEIL, INVITASJON
   ============================================================ */

// Seed en konto direkte i mock-databasen (som roles-and-sections.test.js).
async function loadSeeded(p, db, uid, email) {
  await p.goto(BASE + '/?mock=1');
  await p.evaluate(({ db, uid, email, meta }) => {
    localStorage.clear(); sessionStorage.clear();
    localStorage.setItem('hk-mock-db', JSON.stringify(db));
    sessionStorage.setItem('hk-mock-session', JSON.stringify({ id: uid, email, user_metadata: meta }));
  }, { db, uid, email, meta: (db.profiles.find((x) => x.id === uid) || {}).user_metadata || {} });
  await p.goto(BASE + '/?mock=1');
  await waitReady(p);
}

function seedDB(opts) {
  opts = opts || {};
  const uid = U(), UA = U(), GA = U(), LA = U(), inviter = U(), INV = U();
  const base = (x) => Object.assign({ trashed: false, locked: false, unlocked: false,
    invite_policy: 'inherit', collapsed: false, is_cat: false, cat_id: null,
    ts: 1, org: 'a', pos: 0, pos_ts: 1, pos_org: 'a' }, x);
  const db = {
    _rolesBackfilled: true,
    profiles: [
      { id: uid, email: 'seed@x.no', display_name: 'Seed Bruker', user_metadata: opts.meta || {} },
      { id: inviter, email: 'inviter@x.no', display_name: 'Ida Inviterer', user_metadata: {} },
    ],
    passwords: { 'seed@x.no': 'x', 'inviter@x.no': 'x' },
    universes: [], groups: [], cards: [], items: [],
    memberships: [], share_invites: [], tombstones: [],
  };
  if (opts.content) {
    db.universes.push(base({ id: UA, owner_id: uid, name: 'Mitt univers' }));
    db.groups.push(base({ id: GA, owner_id: uid, universe_id: UA, name: 'Min gruppe',
      locked: !!opts.locked }));
    db.memberships.push({ id: U(), user_id: uid, universe_id: UA, group_id: null, role: 'owner', pos: 0, created_at: 1 });
    if (opts.card) {
      db.cards.push(base({ id: LA, owner_id: uid, group_id: GA, title: 'Min liste', k: true, p: true, lab_ts: 0, lab_org: '' }));
    }
  }
  if (opts.invite) {
    // Invitasjonen gjelder et univers inviteren eier (kolonnenavnene er
    // databasens: invitee_email / inviter_id — se share_invites).
    const UB = U();
    db.universes.push(base({ id: UB, owner_id: inviter, name: 'Delt univers' }));
    db.memberships.push({ id: U(), user_id: inviter, universe_id: UB, group_id: null, role: 'owner', pos: 0, created_at: 1 });
    db.share_invites.push({ id: INV, universe_id: UB, group_id: null,
      invitee_email: 'seed@x.no', invitee_id: null, inviter_id: inviter,
      role: 'member', status: 'pending', created_at: 1 });
  }
  return { uid, ids: { UA, GA, LA, INV }, db };
}

async function runAccounts() {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1200, height: 900 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  console.log('\n== eksisterende brukere, rettigheter, invitasjon ==');

  /* --- v1-brukere tvinges ikke inn i v2 --- */
  for (const status of ['done', 'skipped']) {
    const f = seedDB({ content: true, card: true, meta: { onboarding: { v: 1, status }, tips: {} } });
    await loadSeeded(p, f.db, f.uid, 'seed@x.no');
    // FAST venting: fraværsbevis («innføringen starter IKKE»).
    await p.waitForTimeout(900);
    const st = await tourState(p);
    log('konto 1 (' + status + '): v1-bruker tvinges ikke inn i v2',
      !st.open, 'åpen=' + st.open);
  }

  /* --- en konto uten markør i det hele tatt ER ny --- */
  const fresh = seedDB({ meta: {} });
  await loadSeeded(p, fresh.db, fresh.uid, 'seed@x.no');
  await waitStep(p, 'welcome');
  log('konto 2: konto uten onboardingmarkør regnes som ny og starter flyten',
    (await tourState(p)).id === 'welcome');
  await p.locator('#tour-skip').click();

  /* --- ventende invitasjon blokkeres ikke --- */
  const inv = seedDB({ invite: true, meta: {} });
  await loadSeeded(p, inv.db, inv.uid, 'seed@x.no');
  await waitStep(p, 'welcome');
  await p.locator('#tour-next').click();
  await waitStep(p, 'open_nav');
  const badge = await p.evaluate(() => {
    const el = document.getElementById('account-badge');
    return { skjult: el.hidden, tekst: el.textContent };
  });
  log('konto 3: ventende invitasjon er synlig mens innføringen står på',
    !badge.skjult && badge.tekst === '1', JSON.stringify(badge));
  log('konto 3b: konto-knappen er klikkbar midt i et handlingssteg',
    await hittable(p, '#account-btn'));
  await p.locator('#account-btn').click();
  await p.locator('#menu-invites').waitFor({ state: 'visible' });
  const kanGodta = await p.evaluate(() =>
    !!document.querySelector('#invite-list .invite-row button'));
  log('konto 3c: invitasjonen kan håndteres uten å avslutte innføringen',
    kanGodta && (await p.evaluate(() => window.__huskis.tour.active)) === true);
  await p.keyboard.press('Escape');   // lukker konto-modalen, ikke innføringen
  await p.waitForTimeout(400);
  log('konto 3d: Escape i appen lukker modalen, ikke innføringen',
    (await p.evaluate(() => window.__huskis.tour.active)) === true &&
    (await p.locator('#account-modal').isHidden()));
  await p.evaluate(() => window.__huskis.tour.end('skipped'));

  /* --- uten opprettelsesrett: ingen umulig oppgave --- */
  const locked = seedDB({ content: true, locked: true, meta: { onboarding: { v: 1, status: 'done' } } });
  await loadSeeded(p, locked.db, locked.uid, 'seed@x.no');
  await p.locator('#account-btn').click();
  await p.locator('#tour-restart').waitFor({ state: 'visible' });
  await p.locator('#tour-restart').click();
  await waitStep(p, 'welcome');
  await p.locator('#tour-next').click();
  await waitStep(p, 'open_nav');
  await p.locator('#nav-crumb').click();
  await waitStep(p, 'create_group');   // universet finnes → repetisjonen hopper hit
  await p.waitForTimeout(400);
  const gid = (await tourState(p)).ctx.groupId ||
    await p.evaluate(() => window.__huskis.state.universes[0].groups[0].id);
  await p.locator('.uni-card .item[data-id="' + gid + '"]').click();
  await waitStep(p, 'create_card');
  await p.waitForTimeout(500);
  const blocked = await tourState(p);
  log('konto 4: en låst gruppe gir en forklaring, ikke en umulig oppgave',
    /kan ikke opprette lister/i.test(blocked.note) && blocked.noteError,
    blocked.note);
  log('konto 4b: steget kan hoppes over når det ikke KAN utføres',
    !blocked.skipStepHidden);
  await p.locator('#tour-skip-step').click();
  await waitStep(p, 'create_item');
  log('konto 4c: «Hopp over steget» går videre uten å kreve handlingen', true);
  await p.evaluate(() => window.__huskis.tour.end('skipped'));

  log('konto 5: ingen JS-feil', errs.length === 0, errs.join(' | '));
  await b.close();
}

/* ============================================================
   SYNK: avvist skriving, bakgrunnsrendring, metadata-retry
   ============================================================ */
async function runSync() {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1200, height: 900 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  console.log('\n== synk under innføringen ==');
  const email = await register(p);
  await p.locator('#tour-next').click();
  await waitStep(p, 'open_nav');
  await p.locator('#nav-crumb').click();
  await doUniverse(p, 'Hjemme');
  await waitStep(p, 'create_group');

  /* --- en synk-runde/bakgrunnsrendring river ikke ned innføringen --- */
  const før = await tourState(p);
  await p.evaluate(() => { window.__huskis.render(); return window.__huskis.cloudCycle(); });
  await p.waitForFunction(() => {
    const el = document.getElementById('sync-status');
    return el && el.dataset.state !== 'saving';
  }, null, { timeout: 10000, polling: 100 });
  const etter = await tourState(p);
  log('synk 1: en synk-runde/rendring river ikke ned innføringen',
    etter.open && etter.id === før.id && etter.index === før.index,
    JSON.stringify({ før: før.id, etter: etter.id }));
  const målOk = await p.evaluate(() => {
    const el = document.querySelector('.uni-card .add-item-row .add-item-btn');
    const spot = document.getElementById('tour-spot').getBoundingClientRect();
    const r = el.getBoundingClientRect();
    return spot.left <= r.left + 1 && spot.top <= r.top + 1;
  });
  log('synk 1b: spotlighten fant målet igjen etter rendringen', målOk);

  /* --- en avvist skriving fullfører ikke steget --- */
  await p.evaluate(() => {
    // Serveren sier nei til alt som skrives fra nå av (skjemafeil-modusen i
    // mock-backenden ville krevd reload; en direkte avvisning holder her).
    window.__huskis.syncStatus.noteRejected(
      { kind: 'server', table: 'groups', id: 'x', code: 'PGRST204', message: 'nei' });
  });
  await p.locator('.uni-card .add-item-row .add-item-btn').first().click();
  await p.locator('.edit-input').waitFor({ state: 'visible' });
  await p.keyboard.type('Ukesplan');
  await p.keyboard.press('Enter');
  // FAST venting: fraværsbevis («steget kvitteres IKKE ut»).
  await p.waitForTimeout(900);
  const avvist = await tourState(p);
  log('synk 2: en avvist skriving markerer ikke steget som fullført',
    avvist.id === 'create_group', avvist.id);
  log('synk 2b: brukeren får en forståelig beskjed om hvorfor',
    /ikke lagret på kontoen din/i.test(avvist.note) && avvist.noteError, avvist.note);

  // …og når avvisningen er ryddet, går steget videre av seg selv.
  await p.evaluate(() => window.__huskis.syncStatus.clearServerRejections());
  await waitStep(p, 'open_group');
  log('synk 3: steget går videre når skrivingen er lagret likevel', true);

  /* --- metadata-retry treffer riktig konto --- */
  const feil = await p.evaluate(async () => {
    const H = window.__huskis;
    const cli = H.client;
    const original = cli.auth.updateUser.bind(cli.auth);
    let forsok = 0;
    const sett = [];
    cli.auth.updateUser = (arg) => {
      forsok++;
      sett.push(H.authUser.id);
      if (forsok === 1) return Promise.resolve({ error: { message: 'nettverk' } });
      return original(arg);
    };
    H.tour.end('skipped');
    await new Promise((r) => setTimeout(r, 6000));   // retry-vinduet er 5 s
    cli.auth.updateUser = original;
    return { forsok, sett, bruker: H.authUser.id };
  });
  log('synk 4: en feilet metadataoppdatering prøves på nytt',
    feil.forsok >= 2, 'forsøk=' + feil.forsok);
  log('synk 4b: begge forsøkene gjelder DEN innloggede kontoen',
    feil.sett.every((id) => id === feil.bruker), JSON.stringify(feil.sett));
  const lagret = await accountMeta(p, email);
  log('synk 4c: merket landet til slutt',
    !!lagret && lagret.onboarding.status === 'skipped',
    JSON.stringify(lagret && lagret.onboarding));

  log('synk 5: ingen JS-feil', errs.length === 0, errs.join(' | '));
  await b.close();
}

/* ============================================================
   «REDUSER BEVEGELSE» + KONTEKSTUELLE TIPS
   ============================================================ */
async function runReducedMotion() {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1200, height: 900 }, reducedMotion: 'reduce' });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  console.log('\n== reduser bevegelse ==');
  await register(p);

  const s = await tourState(p);
  log('rm 1: innføringen starter også med «reduser bevegelse»',
    s.open && s.id === 'welcome', s.step);
  // Velkomsten har ikke noe element å peke på: hele flaten dempes i stedet for
  // at det tegnes en ring i lufta.
  log('rm 2: steg uten et synlig mål demper hele flaten (ingen spotlight)',
    s.noSpot, 'no-spot=' + s.noSpot);
  const motion = await p.evaluate(() => {
    const cs = getComputedStyle(document.getElementById('tour-spot'));
    const card = getComputedStyle(document.getElementById('tour-card'));
    return { spot: cs.transitionDuration, kort: card.animationDuration, reduce: matchMedia('(prefers-reduced-motion: reduce)').matches };
  });
  // «0s», «0.001ms», «1e-06s» — alt under et millisekund er praktisk talt av.
  const stille = (v) => parseFloat(String(v).split(',')[0]) * (/ms$/.test(v) ? 1 : 1000) < 1;
  log('rm 3: ingen bevegelse på spotlight/kort', motion.reduce && stille(motion.spot) && stille(motion.kort),
    JSON.stringify(motion));

  await p.locator('#tour-next').click();
  await waitStep(p, 'open_nav');
  const s2 = await tourState(p);
  const crumb = await p.locator('#nav-crumb').boundingBox();
  log('rm 4: spotlighten treffer likevel målet', !s2.noSpot && covers(s2.spotRect, crumb),
    JSON.stringify({ spot: s2.spotRect, crumb }));
  log('rm 5: ingen JS-feil', errs.length === 0, errs.join(' | '));
  await b.close();
}

/* Tipsene om de avanserte gestene — de kommer FØRST når innføringen er ferdig,
   og aldri oppå en melding som alt står. */
async function runTips() {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1200, height: 900 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  console.log('\n== kontekstuelle tips ==');
  const email = await register(p);
  await p.evaluate(() => window.__huskis.tour.end('done'));
  await p.waitForFunction(() => document.getElementById('tour').hidden,
    null, { timeout: 5000, polling: 100 });

  // To lister i gruppen → flytte-gesten er relevant, og tipset kommer én gang.
  await p.evaluate((count) => {
    const H = window.__huskis, st = H.state;
    const mk = (o) => Object.assign({ ts: 1, org: 't', pos: 0, posTs: 1, posOrg: 't', trashed: false, _role: 'owner' }, o);
    st.universes.length = 0;
    const u = mk({ id: 'uni-A', name: 'Hjemme', collapsed: false, groups: [] });
    const g = mk({ id: 'g-a1', uni: 'uni-A', name: 'Ukesplan', cat: null, isCat: false, collapsed: false, cards: [] });
    for (let i = 0; i < count; i++) {
      g.cards.push(mk({ id: 'c-' + i, group: 'g-a1', title: 'Liste ' + i, pos: i, k: true, p: true, items: [] }));
    }
    u.groups.push(g);
    st.universes.push(u);
    st.activeUniverse = 'uni-A'; st.activeGroup = 'g-a1';
    H.render();
  }, 2);
  await p.waitForFunction(() => {
    const t = document.getElementById('toast');
    return !!t && t.classList.contains('show');
  }, null, { timeout: 6000, polling: 100 });
  const tip = await p.evaluate(() => {
    const t = document.getElementById('toast');
    return {
      tekst: t.innerText.replace(/\s+/g, ' ').trim(),
      tips: t.classList.contains('toast-tip'),
      modal: document.body.classList.contains('modal-open'),
      stjalFokus: t.contains(document.activeElement),
      boardKlikkbart: (() => {
        const card = document.querySelector('.board .card .card-head');
        if (!card) return false;
        const r = card.getBoundingClientRect();
        const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        return !!hit && card.contains(hit);
      })(),
    };
  });
  log('tips 1: første relevante gest gir et kontekstuelt tips',
    tip.tips && /hold/i.test(tip.tekst), tip.tekst);
  log('tips 1b: tipset blokkerer ikke bruken (ingen modal, ingen fokusfangst)',
    !tip.modal && !tip.stjalFokus && tip.boardKlikkbart, JSON.stringify(tip));
  const metaTips = await accountMeta(p, email);
  log('tips 1c: tipset er lagret på kontoen',
    !!metaTips.tips && metaTips.tips.drag === true, JSON.stringify(metaTips.tips));

  // …og gjentas ikke.
  await p.evaluate(() => { document.getElementById('toast').classList.remove('show'); });
  await p.evaluate(() => window.__huskis.render());
  await p.waitForTimeout(600);   // fraværsbevis: tipset skal IKKE komme igjen
  log('tips 1d: det samme tipset kommer ikke igjen',
    !(await p.evaluate(() => document.getElementById('toast').classList.contains('show'))));

  // Et tips fortrenger aldri «Angre».
  await p.locator('.board .card .card-delete').first().click();
  await p.waitForFunction(() => {
    const t = document.getElementById('toast');
    return !!t && t.classList.contains('show') && /ngre/.test(t.innerText);
  }, null, { timeout: 6000, polling: 100 });
  const metaEtter = await accountMeta(p, email);
  log('tips 2: angre-toasten står — søppelkasse-tipset fortrengte den ikke',
    !metaEtter.tips.trash, JSON.stringify(metaEtter.tips));

  log('tips 3: ingen JS-feil', errs.length === 0, errs.join(' | '));
  await b.close();
}

(async () => {
  await run('desktop', { width: 1200, height: 900 }, false);
  await run('mobil', { width: 390, height: 780 }, true);
  await runResume();
  await runAccounts();
  await runSync();
  await runReducedMotion();
  await runTips();
  const ok = results.filter(Boolean).length;
  console.log('\n==== ' + ok + '/' + results.length + ' PASS ====');
  process.exit(ok === results.length ? 0 : 1);
})();
