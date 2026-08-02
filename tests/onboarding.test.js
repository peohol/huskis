/*
  Regresjonstest: INTRODUKSJON FOR NYE BRUKERE (omvisning + kontekstuelle tips).

  Omvisningen er fem steg som spotlighter EKTE UI, vises én gang etter første
  vellykkede innlogging, og huskes på KONTOEN (user_metadata) — ikke per enhet.
  De avanserte gestene læres bort etterpå, som korte tips i den vanlige toasten.
  Autoritativt: docs/introduksjon.md. Testen dekker:

    1. Førstegangsvisning: omvisningen starter av seg selv etter innlogging,
       på steg 1 av 5, med kortet i en role="dialog".
    2. Spotlighten ligger på det ekte elementet steget handler om
       (steg 2 → navigasjonsknappen, steg 3 → «＋ Liste»).
    3. Fram og tilbake: «Neste»/«Tilbake» blar, «Tilbake» er avskrudd på steg 1.
    4. Tastatur/skjermleser: aria-modal + live-område, Tab holdes inne i kortet,
       Escape avslutter.
    5. «Hopp over» lagres på kontoen (status «skipped»).
    6. Lagret fullføring: en NY innlogging med kontoens metadata (= en annen
       enhet) viser den ikke igjen.
    7. Gjennomført omvisning lagres som «done».
    8. Omstart fra konto-modalen («Vis på nytt»).
    9. Kontekstuelle tips: første gang gesten er relevant, én gang per konto,
       som en ikke-blokkerende toast (ingen modal, ingen fokusfangst).
   10. «Reduser bevegelse»: omvisningen virker uten animasjon, og et steg uten
       et synlig mål demper hele flaten i stedet for å tegne en ring i lufta.

  Kjør:
    python3 -m http.server 8000                  # fra repo-roten, i egen terminal
    NODE_PATH=$(npm root -g) node tests/onboarding.test.js
*/
const { chromium } = require('playwright');

const BASE = process.env.HUSKIS_URL || 'http://localhost:8000';

const results = [];
const log = (n, ok, x = '') => { results.push(ok); console.log((ok ? 'PASS' : 'FAIL') + ' — ' + n + (x ? '  [' + x + ']' : '')); };

// Registrer + logg inn en fersk konto (som nav-modal.test.js).
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
  await p.locator('#auth-submit').click(); await p.waitForTimeout(1700);
  return email;
}

// Tilstanden omvisningen faktisk er i, lest fra DOM-en (ikke fra __huskis).
const tourState = (p) => p.evaluate(() => {
  const el = document.getElementById('tour');
  const card = document.getElementById('tour-card');
  const spot = document.getElementById('tour-spot');
  return {
    open: !el.hidden,
    noSpot: el.classList.contains('no-spot'),
    step: document.getElementById('tour-step').textContent,
    title: document.getElementById('tour-title').textContent,
    prevDisabled: document.getElementById('tour-prev').disabled,
    nextLabel: document.getElementById('tour-next').textContent,
    role: card.getAttribute('role'),
    modal: card.getAttribute('aria-modal'),
    live: !!card.querySelector('[aria-live="polite"]'),
    labelledby: card.getAttribute('aria-labelledby'),
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
  }, email);
  await p.goto(BASE + '/?mock=1');
  await p.waitForTimeout(1800);
}

// Rektanglene overlapper i hovedsak (spotlighten har 6px luft rundt målet).
function covers(spot, target) {
  if (!spot || !target) return false;
  return spot.x <= target.x + 1 && spot.y <= target.y + 1 &&
    spot.x + spot.width >= target.x + target.width - 1 &&
    spot.y + spot.height >= target.y + target.height - 1;
}

// Én liste med to listepunkter i den aktive gruppen (for tips-triggerne).
async function seedLists(p, n) {
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
  }, n);
  await p.waitForTimeout(350);
}

async function run(label, vp, mobile) {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: vp, isMobile: mobile, hasTouch: mobile });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  console.log('\n== ' + label + ' ==');
  const email = await register(p);

  /* ---------- 1) Førstegangsvisning ---------- */
  const s1 = await tourState(p);
  log(label + ' 1: omvisningen starter av seg selv etter første innlogging',
    s1.open && /Steg 1 av 5/.test(s1.step) && s1.role === 'dialog' && s1.modal === 'true',
    JSON.stringify({ open: s1.open, step: s1.step, role: s1.role }));
  log(label + ' 1b: første steg forklarer hierarkiet',
    /univers/i.test(await p.locator('#tour-text').innerText()) &&
    /listepunkt/i.test(await p.locator('#tour-text').innerText()) &&
    /kategori/i.test(await p.locator('#tour-text').innerText()),
    (await p.locator('#tour-text').innerText()).replace(/\s+/g, ' ').slice(0, 80));
  log(label + ' 1c: «Tilbake» er avskrudd på steg 1', s1.prevDisabled, 'disabled=' + s1.prevDisabled);

  /* ---------- 2) Spotlight på ekte UI ---------- */
  await p.locator('#tour-next').click(); await p.waitForTimeout(450);
  const s2 = await tourState(p);
  const crumb = await p.locator('#nav-crumb').boundingBox();
  log(label + ' 2: steg 2 spotlighter navigasjonsknappen',
    !s2.noSpot && covers(s2.spotRect, crumb),
    JSON.stringify({ spot: s2.spotRect, crumb }));
  log(label + ' 2b: kortet dekker ikke det markerte elementet',
    s2.cardRect.y >= crumb.y + crumb.height || s2.cardRect.y + s2.cardRect.height <= crumb.y,
    JSON.stringify({ card: s2.cardRect, crumb }));

  await p.locator('#tour-next').click(); await p.waitForTimeout(450);
  const s3 = await tourState(p);
  const addBtn = await p.locator('#add-card-btn').boundingBox();
  log(label + ' 3: steg 3 spotlighter «＋ Liste»',
    /Steg 3 av 5/.test(s3.step) && covers(s3.spotRect, addBtn),
    JSON.stringify({ step: s3.step, spot: s3.spotRect, knapp: addBtn }));

  /* ---------- 3) Fram og tilbake ---------- */
  await p.locator('#tour-prev').click(); await p.waitForTimeout(350);
  const back = await tourState(p);
  log(label + ' 4: «Tilbake» går ett steg tilbake',
    /Steg 2 av 5/.test(back.step), back.step);

  /* ---------- 4) Tastatur ---------- */
  // Tab skal aldri forlate kortet (fokusfelle), uansett hvor mange ganger.
  await p.locator('#tour-next').focus();
  for (let i = 0; i < 8; i++) await p.keyboard.press('Tab');
  const inside = await p.evaluate(() =>
    document.getElementById('tour-card').contains(document.activeElement));
  log(label + ' 5: Tab holdes inne i omvisningskortet', inside, 'aktiv=' + await p.evaluate(() => document.activeElement.id));

  // …også fra kortet SELV, som er der fokuset står rett etter åpning: Shift+Tab
  // derfra gikk tidligere rett ut av dialogen og ned i appen bak.
  await p.evaluate(() => document.getElementById('tour-card').focus());
  await p.keyboard.press('Shift+Tab');
  const backInside = await p.evaluate(() => ({
    inne: document.getElementById('tour-card').contains(document.activeElement),
    id: document.activeElement.id,
  }));
  log(label + ' 5a: Shift+Tab fra selve kortet blir i dialogen',
    backInside.inne && backInside.id === 'tour-close', JSON.stringify(backInside));
  log(label + ' 5b: teksten ligger i et polite live-område', back.live && back.labelledby === 'tour-title');

  // Piltast blar, Escape avslutter.
  await p.keyboard.press('ArrowRight'); await p.waitForTimeout(300);
  const arrowed = await tourState(p);
  log(label + ' 5c: pil høyre blar ett steg fram', /Steg 3 av 5/.test(arrowed.step), arrowed.step);
  await p.keyboard.press('Escape'); await p.waitForTimeout(400);
  log(label + ' 5d: Escape avslutter omvisningen', !(await tourState(p)).open);

  /* ---------- 5) Avslutning lagres på kontoen ---------- */
  const metaSkip = await accountMeta(p, email);
  log(label + ' 6: avsluttet omvisning er lagret på kontoen',
    !!metaSkip && !!metaSkip.onboarding && metaSkip.onboarding.v === 1 &&
    metaSkip.onboarding.status === 'skipped',
    JSON.stringify(metaSkip && metaSkip.onboarding));

  /* ---------- 6) Ikke igjen på en annen enhet ---------- */
  await loginOnOtherDevice(p, email);
  const other = await tourState(p);
  log(label + ' 7: omvisningen vises IKKE igjen på en annen enhet',
    !other.open, 'åpen=' + other.open);

  /* ---------- 7) Omstart fra konto-modalen ---------- */
  await p.locator('#account-btn').click(); await p.waitForTimeout(350);
  log(label + ' 8: konto-modalen har raden «Introduksjon til Huskis»',
    await p.locator('#menu-tour').isVisible());
  await p.locator('#tour-restart').click(); await p.waitForTimeout(500);
  const restarted = await tourState(p);
  log(label + ' 8b: «Vis på nytt» starter omvisningen på steg 1 og lukker konto-modalen',
    restarted.open && /Steg 1 av 5/.test(restarted.step) &&
    (await p.locator('#account-modal').isHidden()),
    restarted.step);

  /* ---------- 8) Gjennomført omvisning lagres som «done» ---------- */
  for (let i = 0; i < 4; i++) { await p.locator('#tour-next').click(); await p.waitForTimeout(300); }
  const lastStep = await tourState(p);
  log(label + ' 9: siste steg har knappen «Ferdig»',
    /Steg 5 av 5/.test(lastStep.step) && lastStep.nextLabel === 'Ferdig',
    lastStep.step + ' / ' + lastStep.nextLabel);
  await p.locator('#tour-next').click(); await p.waitForTimeout(500);
  const metaDone = await accountMeta(p, email);
  log(label + ' 9b: fullført omvisning lagres som «done»',
    !(await tourState(p)).open && metaDone.onboarding.status === 'done',
    JSON.stringify(metaDone.onboarding));

  /* ---------- 9) Kontekstuelle tips ---------- */
  // To lister i gruppen → flytte-gesten er relevant, og tipset kommer én gang.
  await seedLists(p, 2);
  await p.waitForTimeout(400);
  const tip = await p.evaluate(() => {
    const t = document.getElementById('toast');
    return {
      vist: !!t && t.classList.contains('show'),
      tekst: t ? t.innerText.replace(/\s+/g, ' ').trim() : '',
      tips: !!t && t.classList.contains('toast-tip'),
      modal: document.body.classList.contains('modal-open'),
      stjalFokus: !!t && t.contains(document.activeElement),
      // Board-et skal fortsatt ta imot klikk: ingenting ligger oppå det.
      boardKlikkbart: (() => {
        const card = document.querySelector('.board .card .card-head');
        if (!card) return false;
        const r = card.getBoundingClientRect();
        const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        return !!hit && card.contains(hit);
      })(),
    };
  });
  log(label + ' 10: første relevante gest gir et kontekstuelt tips',
    tip.vist && tip.tips && /hold/i.test(tip.tekst), tip.tekst);
  log(label + ' 10b: tipset blokkerer ikke bruken (ingen modal, ingen fokusfangst, board-et tar imot klikk)',
    !tip.modal && !tip.stjalFokus && tip.boardKlikkbart, JSON.stringify(tip));

  const metaTips = await accountMeta(p, email);
  log(label + ' 10c: tipset er lagret på kontoen',
    !!metaTips.tips && metaTips.tips.drag === true, JSON.stringify(metaTips.tips));

  // …og gjentas ikke: skjul toasten og tegn board-et på nytt.
  await p.evaluate(() => { document.getElementById('toast').classList.remove('show'); });
  await p.waitForTimeout(100);
  await p.evaluate(() => window.__huskis.render());
  await p.waitForTimeout(400);
  const again = await p.evaluate(() => {
    const t = document.getElementById('toast');
    return !!t && t.classList.contains('show');
  });
  log(label + ' 10d: det samme tipset kommer ikke igjen', !again, 'toast=' + again);

  /* ---------- 10) …og et tips fortrenger aldri «Angre» ---------- */
  // En sletting tegner board-et på nytt FØR den viser angre-toasten sin. Uten
  // vakten ville søppelkasse-tipset blitt vist (og merket sett) i det gapet, og
  // så straks blitt overskrevet av «Angre» — altså aldri lest.
  await p.locator('.board .card .card-delete').first().click();
  await p.waitForTimeout(600);
  const etterSletting = await p.evaluate(() => {
    const t = document.getElementById('toast');
    return { tekst: t ? t.innerText.replace(/\s+/g, ' ').trim() : '', vist: !!t && t.classList.contains('show') };
  });
  log(label + ' 10e: angre-toasten står — tipset fortrengte den ikke',
    etterSletting.vist && /ngre/.test(etterSletting.tekst), etterSletting.tekst);
  const metaEtter = await accountMeta(p, email);
  log(label + ' 10f: søppelkasse-tipset er IKKE merket sett ennå',
    !metaEtter.tips.trash, JSON.stringify(metaEtter.tips));

  log(label + ' 11: ingen JS-feil', errs.length === 0, errs.join(' | '));
  await b.close();
}

/* «Reduser bevegelse» + steg uten et element å peke på.
   Begge deler er egne løp fordi de krever sin egen nettleserkontekst / en
   konto uten innhold — resten av oppførselen dekkes av run(). */
async function runReducedMotion() {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1200, height: 900 }, reducedMotion: 'reduce' });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  console.log('\n== reduser bevegelse ==');
  await register(p);

  const s = await tourState(p);
  log('rm 1: omvisningen starter også med «reduser bevegelse»',
    s.open && /Steg 1 av 5/.test(s.step), s.step);
  // En fersk konto har ingen lister: steg 1 har ikke noe element å peke på, og
  // skal da dempe hele flaten og midtstille kortet i stedet.
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

  await p.locator('#tour-next').click(); await p.waitForTimeout(400);
  const s2 = await tourState(p);
  const crumb = await p.locator('#nav-crumb').boundingBox();
  log('rm 4: spotlighten treffer likevel målet', !s2.noSpot && covers(s2.spotRect, crumb),
    JSON.stringify({ spot: s2.spotRect, crumb }));
  log('rm 5: ingen JS-feil', errs.length === 0, errs.join(' | '));
  await b.close();
}

(async () => {
  await run('desktop', { width: 1200, height: 900 }, false);
  await run('mobil', { width: 390, height: 780 }, true);
  await runReducedMotion();
  const ok = results.filter(Boolean).length;
  console.log('\n==== ' + ok + '/' + results.length + ' PASS ====');
  process.exit(ok === results.length ? 0 : 1);
})();
