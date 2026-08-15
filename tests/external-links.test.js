/*
  Nettlesertest for invarianten «appen produserer ingen utgående lenker»
  (docs/domains-and-urls.md, «Eksterne lenker»), mot mock-backend (?mock=1).

  Dette er den KJØRENDE motstykket til tekstvakten i
  tests/capacitor-android.test.js del 12. Den vakten leser kildekoden, og en
  tekstvakt kan alltid omgås av en ny skrivemåte — en lenke satt sammen av
  biter (`'<' + 'a hr' + 'ef="' + adresse + '">'`) har ingen av tokenene i
  behold. Denne testen ser i stedet på det FERDIGE DOM-et: uansett hvordan
  markupen ble stavet, er en `<a href>` en `<a href>` når nettleseren har
  tolket den.

  De to nettene utfyller hverandre:
    • tekstvakten fanger en lenke som ikke er rendret ennå (og kjører uten
      nettleser, i hver CI-shard);
    • denne fanger enhver stavemåte, men bare der testen faktisk får appen til
      å rendre.

  Dekker:
    1. Etter innlogging og rendret innhold: ingen destinasjon i DOM-et peker
       utenfor appens eget origin — `a[href]`, `area[href]`, `form[action]`,
       `[formaction]`, `base[href]` og `meta[http-equiv=refresh]`
    2. Det samme etter at nav-modalen og en objektmeny er åpnet (de bygger mye
       markup som ikke finnes ved første render)
    3. Ingen `target="_blank"` noe sted i DOM-et

  Kjøres på BÅDE desktop- og mobil-viewport: markup bygges betinget av layout.

  Kjør:
    python3 -m http.server 8000
    NODE_PATH=$(npm root -g) node tests/external-links.test.js
*/
const { chromium } = require(require('path').join(process.env.NODE_PATH || require('child_process').execSync('npm root -g').toString().trim(), 'playwright'));
const BASE = process.env.HUSKIS_URL || 'http://localhost:8000';

const results = [];
const log = (n, ok, x = '') => { results.push(ok); console.log((ok ? 'PASS' : 'FAIL') + ' — ' + n + (x ? '  [' + x + ']' : '')); };

const U = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
  const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
});

/* Nok innhold til at alle fire nivåene rendres: område → mappe → liste →
   listepunkt. Teksten i punktet inneholder med vilje en URL — brukertekst SKAL
   forbli ren tekst, og det er nettopp det denne testen beviser at den gjør
   (docs/domains-and-urls.md: «URL-er i brukertekst»). */
function buildDB() {
  const uid = 'u1';
  const UA = U(), GA = U(), LA = U(), IA = U(), IB = U();
  const base = (x) => Object.assign({ trashed: false, locked: false, unlocked: false,
    invite_policy: 'inherit', collapsed: false, is_cat: false, cat_id: null,
    ts: 1, org: 'a', pos: 0, pos_ts: 1, pos_org: 'a' }, x);
  return {
    uid,
    db: {
      _rolesBackfilled: true,
      profiles: [{ id: uid, email: 'a@x.no', display_name: 'Alice', user_metadata: {} }],
      passwords: { 'a@x.no': 'x' },
      universes: [base({ id: UA, owner_id: uid, name: 'Området' })],
      groups: [base({ id: GA, owner_id: uid, universe_id: UA, name: 'Mappa' })],
      cards: [base({ id: LA, owner_id: uid, group_id: GA, title: 'Lista', k: true, p: true, lab_ts: 0, lab_org: '' })],
      items: [
        base({ id: IA, owner_id: uid, card_id: LA, text: 'Se https://example.com/ for mer' }),
        base({ id: IB, owner_id: uid, card_id: LA, text: 'og www.example.org', pos: 1 }),
      ],
      memberships: [{ id: U(), user_id: uid, universe_id: UA, group_id: null, role: 'owner', pos: 0, created_at: 1 }],
      share_invites: [], tombstones: [],
    },
  };
}

/* `document.querySelectorAll` går IKKE inn i en shadow root, og en lenke
   rendret der er like klikkbar som en i lysets DOM. En åpen rot kan man klatre
   ned i via `el.shadowRoot`, men en LUKKET rot er per definisjon utilgjengelig
   utenfra — den ville vært et hull testen ikke engang kunne se.

   Derfor krokes `attachShadow` FØR appen kjører (`addInitScript`), og hver rot
   den lager føres opp uansett modus. Kroken returnerer den ekte roten til
   kalleren, så appen merker ingenting; vi har bare en referanse til den også.
   Appen bruker ikke shadow DOM i dag, og da er registeret tomt — men det er nå
   en MÅLT null, ikke en antatt. */
const SHADOW_KROK = () => {
  const orig = Element.prototype.attachShadow;
  window.__hkRøtter = [];
  Element.prototype.attachShadow = function (init) {
    const rot = orig.call(this, init);
    window.__hkRøtter.push({ rot, lukket: !!(init && init.mode === 'closed') });
    return rot;
  };
};

/* Alt i DOM-et som KAN sende nettleseren et sted, lest som ATTRIBUTT og
   resolvert mot `document.baseURI`.

   Attributtet, ikke egenskapen: på en SVG-`<a>` er `el.href` et
   `SVGAnimatedString`, ikke en streng. `new URL(objektet, base)` gjør det til
   «[object SVGAnimatedString]», som resolverer relativt og dermed ser
   likeorigins ut — en SVG-lenke rett ut av appen ville blitt lest som trygg.
   Den rå adressen har ikke det problemet, og `document.baseURI` tar med en
   eventuell `<base>` slik nettleseren selv ville gjort.

   `xlink:href` er med fordi det er den gamle (og fortsatt gyldige) formen i
   SVG, og `[href]` som selektor ikke treffer den. */
const destinasjoner = (p) => p.evaluate(() => {
  const ut = [];
  const her = location.origin;
  const XLINK = 'http://www.w3.org/1999/xlink';
  const legg = (hva, rå) => {
    if (rå === null || rå === undefined || rå === '') return;
    let o = null;
    try { o = new URL(String(rå), document.baseURI).origin; } catch (e) { o = 'ugyldig'; }
    if (o !== her) ut.push(hva + ' ' + rå + ' → ' + o);
  };
  const røtter = [document, ...(window.__hkRøtter || []).map((x) => x.rot)];
  for (const rot of røtter) {
    rot.querySelectorAll('*').forEach((el) => {
      const navn = el.tagName.toLowerCase();
      for (const a of ['href', 'action', 'formaction']) {
        if (el.hasAttribute(a)) legg(navn + '[' + a + ']', el.getAttribute(a));
      }
      if (el.hasAttributeNS(XLINK, 'href')) legg(navn + '[xlink:href]', el.getAttributeNS(XLINK, 'href'));
      if (navn === 'meta' && /refresh/i.test(el.getAttribute('http-equiv') || '')) {
        ut.push('meta refresh ' + el.getAttribute('content'));
      }
    });
  }
  return ut;
});

const blanke = (p) => p.evaluate(() =>
  [document, ...(window.__hkRøtter || []).map((x) => x.rot)]
    .flatMap((rot) => [...rot.querySelectorAll('[target]')])
    .filter((el) => /_blank/i.test(el.getAttribute('target') || ''))
    .map((el) => el.tagName.toLowerCase() + '[target=_blank]'));

/* Evidens for at kroken faktisk står, og hva den har sett. */
const skygger = (p) => p.evaluate(() => ({
  krok: Element.prototype.attachShadow.toString().indexOf('__hkRøtter') > -1,
  totalt: (window.__hkRøtter || []).length,
  lukkede: (window.__hkRøtter || []).filter((x) => x.lukket).length,
}));

async function run(navn, viewport) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext(Object.assign({ viewport },
    viewport.width < 600 ? { isMobile: true, hasTouch: true } : {}));
  await ctx.addInitScript(SHADOW_KROK);
  const p = await ctx.newPage();
  const feil = [];
  p.on('pageerror', (e) => feil.push(String(e)));

  const { uid, db } = buildDB();
  await p.goto(BASE + '/?mock=1');
  await p.evaluate(({ db, uid }) => {
    localStorage.clear(); sessionStorage.clear();
    localStorage.setItem('hk-mock-db', JSON.stringify(db));
    sessionStorage.setItem('hk-mock-session', JSON.stringify({ id: uid, email: 'a@x.no',
      user_metadata: { onboarding: { v: 3, status: 'done' }, tips: { drag: true, trash: true, moveList: true, dragTrash: true } } }));
  }, { db, uid });
  await p.goto(BASE + '/?mock=1');
  await p.waitForFunction(() => {
    const H = window.__huskis;
    return H && H.authUser && H.lastMy && H.state.universes.length > 0;
  }, null, { timeout: 8000, polling: 200 });

  // 1. Grunnvisningen, med innhold på alle fire nivåene rendret.
  let d = await destinasjoner(p);
  log(navn + ': ingen utgående destinasjon i DOM-et etter render',
    d.length === 0, d.join(', ') || 'ingen');

  // Brukerteksten inneholder en URL. Den skal være TEKST — finner vi den som
  // en lenke, er «URL-er i brukertekst» blitt klikkbart uten at beslutningen
  // i docs/domains-and-urls.md er tatt om igjen.
  const iTekst = await p.evaluate(() => {
    const t = [...document.querySelectorAll('.item-text, .item')].map((el) => el.textContent).join(' ');
    return { harTekst: /example\.com/.test(t), harLenke: !!document.querySelector('a[href*="example"]') };
  });
  log(navn + ': URL i listepunkt er ren tekst, ikke en lenke',
    iTekst.harTekst && !iTekst.harLenke, JSON.stringify(iTekst));

  // 2. Nav-modalen og en objektmeny bygger markup som ikke finnes ved første
  //    render — begge må inspiseres mens de står åpne.
  await p.evaluate(() => window.__huskis.openNavModal());
  await p.waitForTimeout(400);
  d = await destinasjoner(p);
  log(navn + ': ingen utgående destinasjon med nav-modalen åpen',
    d.length === 0, d.join(', ') || 'ingen');
  await p.keyboard.press('Escape');
  await p.waitForTimeout(250);

  const meny = await p.locator('.obj-menu-btn').first();
  if (await meny.count()) {
    await meny.click();
    await p.waitForTimeout(300);
    d = await destinasjoner(p);
    log(navn + ': ingen utgående destinasjon med objektmenyen åpen',
      d.length === 0, d.join(', ') || 'ingen');
    await p.keyboard.press('Escape');
    await p.waitForTimeout(200);
  } else {
    log(navn + ': objektmenyen finnes å åpne', false, 'fant ingen .obj-menu-btn');
  }

  // 3. Ingen ny fane noe sted.
  const b = await blanke(p);
  log(navn + ': ingen target="_blank" i DOM-et', b.length === 0, b.join(', ') || 'ingen');

  // 4. Shadow-registeret: kroken må stå, ellers har sjekkene over bare sett
  //    lysets DOM uten å vite det.
  const s = await skygger(p);
  log(navn + ': shadow-kroken står, og hver rot er talt (også de lukkede)',
    s.krok === true, JSON.stringify(s));

  log(navn + ': ingen JS-feil underveis', feil.length === 0, feil.join(' | '));
  await browser.close();
}

(async () => {
  await run('desktop', { width: 1200, height: 900 });
  await run('mobil', { width: 390, height: 780 });
  const ok = results.filter(Boolean).length;
  console.log('\n==== ' + ok + '/' + results.length + ' PASS ====');
  process.exit(ok === results.length ? 0 : 1);
})();
