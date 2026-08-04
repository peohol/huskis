/*
  Nettlesertest for KONTOENS passord- og profilbilde-funksjoner (mock-backend):

    A) «Vis passordet»-knappen i passordfelt (auth-skjermen + konto-modalen)
    B) Bytte passord i konto-modalen (nåværende passord kreves) + ny innlogging
    C) Bilderedigereren: zoom, rotasjon, panorering — og at det lagrede,
       kvadratiske bildet ALLTID er helt dekket (ingen tomme hjørner)
    D) Bildet vises i avatar-sirklene (konto + del-modalens medlemsliste),
       overlever reload og kan fjernes igjen

  Kjøres på BÅDE desktop- og mobil-viewport.

  Kjør:
    python3 -m http.server 8000                                   # fra repo-roten
    NODE_PATH=$(npm root -g) node tests/account-password-avatar.test.js
*/
const { chromium } = require('playwright');
const zlib = require('zlib');

const BASE = process.env.HUSKIS_URL || 'http://localhost:8000';

const results = [];
const log = (n, ok, x = '') => { results.push(ok); console.log((ok ? 'PASS' : 'FAIL') + ' — ' + n + (x ? '  [' + x + ']' : '')); };
const U = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16); });

/* ---------- Testbilde: en minimal PNG-encoder (RGB, 8 bit) ----------
   Bildet er BEVISST ikke kvadratisk (600x400) og har ingen svarte piksler —
   så «dekker utsnittet hele kvadratet?» kan avgjøres ved å se etter svart i
   hjørnene av det lagrede bildet. */
const CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; }
  return t;
})();
function crc32(buf) { let c = -1; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function makePng(w, h, pixel) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  let o = 0;
  for (let y = 0; y < h; y++) {
    raw[o++] = 0; // filter: none
    for (let x = 0; x < w; x++) { const p = pixel(x, y); raw[o++] = p[0]; raw[o++] = p[1]; raw[o++] = p[2]; }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}
// Fire tydelige fargefelt + rutenett. Mørkeste verdi er (40,40,55) — aldri svart.
const PHOTO = makePng(600, 400, (x, y) => {
  if (x % 100 < 3 || y % 100 < 3) return [40, 40, 55];
  const q = (x < 300 ? 0 : 1) + (y < 200 ? 0 : 2);
  return [[220, 90, 90], [90, 160, 220], [240, 200, 80], [110, 190, 120]][q];
});
const upload = (p) => p.locator('#avatar-file').setInputFiles({ name: 'bilde.png', mimeType: 'image/png', buffer: PHOTO });
// Ferdig lagret «profilbilde» for en seedet profil (1x1 PNG — innholdet er
// likegyldig, det er <img> vs. initialer testen ser etter).
const PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

async function register(p, password) {
  await p.goto(BASE + '/?mock=1');
  await p.waitForTimeout(500);
  const email = 'u' + Math.floor(Math.random() * 1e9) + '@test.no';
  await p.getByText('Registrer deg').click(); await p.waitForTimeout(300);
  await p.locator('#auth-first-name').fill('Kari');
  await p.locator('#auth-last-name').fill('Nordmann');
  await p.locator('#auth-email').fill(email);
  await p.locator('#auth-password').fill(password);
  await p.locator('#auth-submit').click(); await p.waitForTimeout(700);
  await p.getByText('Tilbake til innlogging').click(); await p.waitForTimeout(300);
  return email;
}
async function signIn(p, email, password) {
  await p.locator('#auth-email').fill(email);
  await p.locator('#auth-password').fill(password);
  await p.locator('#auth-submit').click();
  // Brukes BÅDE for innlogging som skal lykkes og som skal avvises: ferdig når
  // enten kontoen er inne (authUser + lastMy) eller avvisningen står i #auth-msg.
  await p.waitForFunction(() => {
    const H = window.__huskis;
    return (H && H.authUser && H.lastMy) || !!document.getElementById('auth-msg').textContent;
  }, null, { timeout: 10000, polling: 200 });
  // Introduksjonen (docs/introduksjon.md) møter enhver ny konto: omvisningen
  // legger seg over appen, og et gest-tips legger seg nederst på skjermen —
  // ingen av delene er det denne testen handler om.
  await p.evaluate(() => window.__huskis.tour.skipAll());
  await p.waitForTimeout(150);
}
const openAccount = async (p) => { await p.locator('#account-btn').click(); await p.waitForTimeout(400); };
const savePass = async (p) => { await p.locator('#account-pass-form button[type=submit]').click(); await p.waitForTimeout(700); };

// Piksler i det LAGREDE bildet (data-URI): [hjørner …, midten].
const sampleSaved = (p) => p.evaluate(() => new Promise((res) => {
  const el = document.querySelector('#account-avatar img');
  if (!el) return res(null);
  const im = new Image();
  im.onload = () => {
    const c = document.createElement('canvas');
    c.width = im.naturalWidth; c.height = im.naturalHeight;
    c.getContext('2d').drawImage(im, 0, 0);
    const g = c.getContext('2d');
    const at = (x, y) => [...g.getImageData(x, y, 1, 1).data].slice(0, 3);
    const w = im.naturalWidth - 1, h = im.naturalHeight - 1;
    res({ w: im.naturalWidth, h: im.naturalHeight, bytes: el.src.length,
      corners: [at(1, 1), at(w - 1, 1), at(1, h - 1), at(w - 1, h - 1)],
      mid: at(im.naturalWidth >> 1, im.naturalHeight >> 1) });
  };
  im.src = el.src;
}));
// Svart = ingen bilde der (JPEG har ingen alfa). Testbildet er aldri svart.
const isBlack = (px) => px[0] < 24 && px[1] < 24 && px[2] < 24;

async function run(label, vp, mobile) {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: vp, isMobile: mobile, hasTouch: mobile });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  console.log('\n== ' + label + ' ==');

  /* ================= A) Vis passordet ================= */
  const email = await register(p, 'passord123');
  await p.locator('#auth-password').fill('hemmelig');
  const authToggle = p.locator('.pass-toggle[data-pass-toggle="auth-password"]');
  let t = await p.evaluate(() => document.getElementById('auth-password').type);
  log(label + ' A: passordet er skjult i utgangspunktet', t === 'password', t);
  await authToggle.click(); await p.waitForTimeout(120);
  let st = await p.evaluate(() => ({
    type: document.getElementById('auth-password').type,
    pressed: document.querySelector('.pass-toggle[data-pass-toggle="auth-password"]').getAttribute('aria-pressed'),
    slash: !!document.querySelector('.pass-toggle[data-pass-toggle="auth-password"] svg path[d^="M4.4"]'),
    value: document.getElementById('auth-password').value,
  }));
  log(label + ' A: knappen viser passordet (type=text, aria-pressed, øye m/ strek)',
    st.type === 'text' && st.pressed === 'true' && st.slash && st.value === 'hemmelig', JSON.stringify(st));
  await authToggle.click(); await p.waitForTimeout(120);
  st = await p.evaluate(() => ({
    type: document.getElementById('auth-password').type,
    pressed: document.querySelector('.pass-toggle[data-pass-toggle="auth-password"]').getAttribute('aria-pressed'),
  }));
  log(label + ' A: knappen skjuler det igjen', st.type === 'password' && st.pressed === 'false', JSON.stringify(st));

  await p.locator('#auth-password').fill('passord123');
  await authToggle.click(); await p.waitForTimeout(120); // logg inn med passordet SYNLIG
  await p.locator('#auth-email').fill(email);
  await p.locator('#auth-submit').click();
  await p.waitForFunction(() => {
    const H = window.__huskis;
    return H && H.authUser && H.lastMy;
  }, null, { timeout: 10000, polling: 200 });
  log(label + ' A: innlogget', await p.evaluate(() => !!window.__huskis.authUser));
  // Introduksjonen (docs/introduksjon.md) møter enhver ny konto: omvisningen
  // legger seg over appen, og et gest-tips legger seg nederst på skjermen —
  // ingen av delene er det denne testen handler om.
  await p.evaluate(() => window.__huskis.tour.skipAll());
  await p.waitForTimeout(150);
  // Passordfeltet skal ikke bære passordet videre — og slett ikke i klartekst,
  // som ville stått synlig på innloggingsskjermen etter neste utlogging.
  st = await p.evaluate(() => ({
    value: document.getElementById('auth-password').value,
    type: document.getElementById('auth-password').type,
    pressed: document.querySelector('.pass-toggle[data-pass-toggle="auth-password"]').getAttribute('aria-pressed'),
  }));
  log(label + ' A: passordfeltet tømmes og skjules ved innlogging',
    st.value === '' && st.type === 'password' && st.pressed === 'false', JSON.stringify(st));

  /* ================= B) Bytte passord ================= */
  await openAccount(p);
  const toggles = await p.evaluate(() => document.querySelectorAll('#account-pass-form .pass-toggle').length);
  log(label + ' B: begge passordfeltene har vis-knapp', toggles === 2, 'n=' + toggles);

  await p.locator('#account-pass-current').fill('feilpassord');
  await p.locator('#account-pass-new').fill('nyttpassord9');
  await savePass(p);
  let msg = await p.locator('#account-msg').textContent();
  log(label + ' B: feil nåværende passord avvises', /Feil nåværende passord/.test(msg), msg);

  await p.locator('#account-pass-current').fill('passord123');
  await p.locator('#account-pass-new').fill('kort');
  await savePass(p);
  msg = await p.locator('#account-msg').textContent();
  log(label + ' B: for kort nytt passord avvises', /minst 6 tegn/.test(msg), msg);

  await p.locator('#account-pass-current').fill('passord123');
  await p.locator('#account-pass-new').fill('nyttpassord9');
  await savePass(p);
  msg = await p.locator('#account-msg').textContent();
  const cleared = await p.evaluate(() => {
    const a = document.getElementById('account-pass-current'), b2 = document.getElementById('account-pass-new');
    return a.value === '' && b2.value === '' && a.type === 'password' && b2.type === 'password';
  });
  log(label + ' B: passordet byttes', /oppdatert/.test(msg), msg);
  log(label + ' B: feltene tømmes og skjules etter lagring', cleared);

  // Ut og inn: det gamle passordet virker ikke, det nye gjør det.
  await p.locator('#logout-btn').click(); await p.waitForTimeout(300);
  await p.locator('#confirm-ok').click();
  await p.waitForFunction(() => !window.__huskis.authUser
    && !document.getElementById('auth-screen').hidden, null, { timeout: 8000, polling: 200 });
  const afterLogout = await p.evaluate(() => document.getElementById('auth-password').value);
  log(label + ' B: innloggingsskjermen viser ikke forrige passord', afterLogout === '', afterLogout);
  await signIn(p, email, 'passord123');
  const stillOut = await p.evaluate(() => !window.__huskis.authUser && !document.getElementById('auth-screen').hidden);
  log(label + ' B: gammelt passord virker ikke lenger', stillOut);
  await signIn(p, email, 'nyttpassord9');
  log(label + ' B: nytt passord logger inn', await p.evaluate(() => !!window.__huskis.authUser));

  /* ================= C) Bilderedigereren ================= */
  await openAccount(p);
  const beforeImg = await p.locator('#account-avatar img').count();
  log(label + ' C: uten bilde vises initialene', beforeImg === 0 &&
    (await p.locator('#account-avatar').textContent()).trim() === 'KN');

  await upload(p); await p.waitForTimeout(700);
  let ed = await p.evaluate(() => ({
    open: !document.getElementById('avatar-modal').hidden,
    mask: !!document.querySelector('#avatar-stage .avatar-mask'),
    zoom: document.getElementById('avatar-zoom').value,
    rot: document.getElementById('avatar-rot').value,
  }));
  log(label + ' C: redigereren åpner med sirkelmaske, zoom 1 og rotasjon 0',
    ed.open && ed.mask && ed.zoom === '1' && ed.rot === '0', JSON.stringify(ed));

  const canvasSig = () => p.evaluate(() => document.getElementById('avatar-canvas').toDataURL().length + ':' +
    document.getElementById('avatar-canvas').getContext('2d').getImageData(20, 20, 1, 1).data.join(','));
  const sig0 = await canvasSig();

  // Zoom via glidebryteren.
  await p.locator('#avatar-zoom').fill('2.4');
  await p.dispatchEvent('#avatar-zoom', 'input'); await p.waitForTimeout(200);
  const sig1 = await canvasSig();
  log(label + ' C: zoom endrer forhåndsvisningen', sig1 !== sig0);

  // Panorering med draging.
  const box = await p.locator('#avatar-stage').boundingBox();
  await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await p.mouse.down();
  await p.mouse.move(box.x + box.width / 2 + 50, box.y + box.height / 2 + 35, { steps: 8 });
  await p.mouse.up(); await p.waitForTimeout(200);
  const sig2 = await canvasSig();
  log(label + ' C: draging flytter bildet', sig2 !== sig1);

  // Rotasjon: 45° krever mer zoom for å fylle kvadratet (|cos|+|sin| = 1.414).
  await p.locator('#avatar-rot').fill('45');
  await p.dispatchEvent('#avatar-rot', 'input'); await p.waitForTimeout(200);
  const zs = await p.evaluate(() => ({ min: parseFloat(document.getElementById('avatar-zoom').min),
    val: parseFloat(document.getElementById('avatar-zoom').value) }));
  log(label + ' C: rotasjon hever minste zoom til dekning (≈1.414)',
    Math.abs(zs.min - Math.SQRT2) < 0.01 && zs.val >= zs.min - 1e-6, JSON.stringify(zs));

  // Roter-90-knappen retter opp til nærmeste kvarte omdreining + ett hakk.
  await p.locator('#avatar-rot90').click(); await p.waitForTimeout(200);
  const rot90 = await p.evaluate(() => document.getElementById('avatar-rot').value);
  log(label + ' C: «roter 90°» går til neste kvarte omdreining', rot90 === '90', rot90);

  // Zoom helt ut igjen (bryteren klemmes til dekningsminimum) og lagre.
  await p.locator('#avatar-zoom').fill('1');
  await p.dispatchEvent('#avatar-zoom', 'input'); await p.waitForTimeout(150);
  await p.locator('#avatar-save').click();
  await p.waitForFunction(() => document.getElementById('avatar-modal').hidden
    && !!document.querySelector('#account-avatar img'), null, { timeout: 8000 });

  const saved = await sampleSaved(p);
  log(label + ' C: bildet er kvadratisk 256×256', saved && saved.w === 256 && saved.h === 256,
    saved ? saved.w + 'x' + saved.h : 'mangler');
  log(label + ' C: data-URI-en er liten (< 60 kB)', saved && saved.bytes < 60000,
    saved ? saved.bytes + ' tegn' : '-');
  log(label + ' C: hele kvadratet er dekket (ingen svarte hjørner)',
    saved && !saved.corners.some(isBlack), saved ? JSON.stringify(saved.corners) : '-');
  log(label + ' C: redigereren er lukket etter lagring',
    await p.evaluate(() => document.getElementById('avatar-modal').hidden));

  /* ================= D) Bildet i sirklene ================= */
  let shown = await p.evaluate(() => {
    const im = document.querySelector('#account-avatar img');
    return { img: !!im, jpeg: im ? im.src.slice(0, 15) : '', cam: !!document.querySelector('#account-avatar .avatar-cam'),
      remove: !document.getElementById('avatar-remove').hidden };
  });
  log(label + ' D: konto-sirkelen viser bildet (og beholder kamera-merket)',
    shown.img && shown.jpeg === 'data:image/jpeg' && shown.cam, JSON.stringify(shown));
  log(label + ' D: «Fjern bilde» dukker opp når det finnes et bilde', shown.remove);

  // Del-modalen: eier-raden er meg — sirkelen skal vise bildet, ikke initialene.
  // Bare universer og grupper deles, så det er gruppens del-visning vi åpner.
  await p.evaluate(() => {
    const H = window.__huskis;
    H.closeAccount();
    H.addUniverse();
  });
  await p.keyboard.press('Escape'); await p.waitForTimeout(200);
  await p.evaluate(() => window.__huskis.addGroup()); await p.waitForTimeout(200);
  await p.keyboard.press('Escape'); await p.waitForTimeout(200);
  // La gruppen nå «serveren» før del-visningen åpnes — vent på selve raden.
  await p.waitForFunction(() => {
    const H = window.__huskis;
    const db = window.HK_MOCK._loadDB();
    return H.state.activeGroup && db.groups.some((g) => g.id === H.state.activeGroup);
  }, null, { timeout: 8000, polling: 200 });
  await p.evaluate(() => {
    const H = window.__huskis, st = H.state;
    const u = st.universes.find((x) => x.id === st.activeUniverse);
    const g = u.groups.find((x) => x.id === st.activeGroup);
    H.openShare('group', g.id, g, null);
  });
  await p.waitForTimeout(700);
  const ownerAvatar = await p.evaluate(() => {
    const row = document.querySelector('#share-body .member-row .member-avatar');
    return { found: !!row, img: !!(row && row.querySelector('img')) };
  });
  log(label + ' D: del-modalens eier-sirkel viser bildet', ownerAvatar.found && ownerAvatar.img,
    JSON.stringify(ownerAvatar));
  await p.keyboard.press('Escape'); await p.waitForTimeout(300);

  /* ---------- Overlever reload ---------- */
  await p.reload();
  await p.waitForFunction(() => {
    const H = window.__huskis;
    return H && H.authUser && H.lastMy;
  }, null, { timeout: 10000, polling: 200 });
  await openAccount(p);
  log(label + ' D: bildet overlever reload', (await p.locator('#account-avatar img').count()) === 1);

  /* ---------- Fjern bilde ---------- */
  await p.locator('#avatar-remove').click(); await p.waitForTimeout(300);
  await p.locator('#confirm-ok').click();
  await p.waitForFunction(() => !document.querySelector('#account-avatar img'),
    null, { timeout: 8000 }).catch(() => {});
  const after = await p.evaluate(() => ({
    img: document.querySelectorAll('#account-avatar img').length,
    text: document.getElementById('account-avatar').textContent.trim(),
    remove: document.getElementById('avatar-remove').hidden,
  }));
  log(label + ' D: bildet fjernes og initialene kommer tilbake',
    after.img === 0 && after.text === 'KN' && after.remove === true, JSON.stringify(after));

  /* ================= E) Ansvarssirkelen (get_members → resp-avatar) =================
     Seedet «database»: universet er delt, og listepunktets ansvarlige har et
     profilbilde. Sirkelen i meta-raden skal da vise bildet, ikke initialene. */
  await p.evaluate(() => window.__huskis.closeAccount());
  const seed = (() => {
    const uA = 'uA', uD = 'uD', PU = U(), PG = U(), PL = U(), PI = U();
    const base = (extra) => Object.assign({ trashed: false, locked: false, unlocked: false,
      invite_policy: 'inherit', ts: 1, org: 'a', pos: 0, pos_ts: 0, pos_org: '' }, extra);
    return {
      ids: { uA, PU, PI },
      db: {
        profiles: [
          { id: uA, email: 'a@x.no', display_name: 'Alice Eier', user_metadata: {}, avatar: PIXEL },
          { id: uD, email: 'd@x.no', display_name: 'Dag Medlem', user_metadata: {} },
        ],
        passwords: { 'a@x.no': 'x', 'd@x.no': 'x' },
        universes: [base({ id: PU, owner_id: uA, name: 'Felles univers' })],
        groups: [base({ id: PG, owner_id: uA, universe_id: PU, name: 'Gruppe' })],
        cards: [base({ id: PL, owner_id: uA, group_id: PG, title: 'Delt liste', k: true, p: true, lab_ts: 0, lab_org: '' })],
        items: [base({ id: PI, owner_id: uA, card_id: PL, text: 'Punkt', responsible: uA })],
        memberships: [{ id: U(), user_id: uD, universe_id: PU, group_id: null, card_id: null,
          parent_universe_id: null, parent_group_id: null, pos: 0, trashed: false, created_at: 1 }],
        share_invites: [], tombstones: [],
      },
    };
  })();
  // Kontoen har sett HELE introduksjonen (docs/introduksjon.md): verken
  // omvisningen eller et gest-tips skal legge seg over det som testes.
  await p.evaluate(({ db, sess }) => {
    localStorage.clear();
    localStorage.setItem('hk-mock-db', JSON.stringify(db));
    sessionStorage.setItem('hk-mock-session', JSON.stringify(sess));
  }, { db: seed.db, sess: { id: seed.ids.uA, email: 'a@x.no',
       user_metadata: { onboarding: { v: 1, status: 'done' }, tips: { drag: true, trash: true, moveList: true } } } });
  // `lag` gir «serveren» en merkbar forsinkelse, så en get_members startet av en
  // for tidlig render rekker å kappløpe med skrivingen (se neste sjekk).
  await p.goto(BASE + '/?mock=1&lag=300');
  // Innlogging + get_my_doc + lat get_members: ferdig når ansvarssirkelen har
  // fått bildet sitt (uteblir det, feiler sjekken under med den faktiske verdien).
  await p.waitForFunction(() => !!document.querySelector('.item .resp-avatar img'),
    null, { timeout: 12000, polling: 200 }).catch(() => {});
  const resp = await p.evaluate(() => {
    const av = document.querySelector('.item .resp-avatar');
    const im = av && av.querySelector('img');
    return { found: !!av, img: !!im, src: im ? im.src.slice(0, 15) : '' };
  });
  log(label + ' E: ansvarssirkelen viser profilbildet', resp.found && resp.img, JSON.stringify(resp));

  // Nytt bilde MENS ansvarssirkelen står på skjermen: get_members-cachen skal
  // ikke kunne fylles med det GAMLE bildet av en henting som kappløper med
  // skrivingen (den ble ellers liggende til neste innlogging).
  await openAccount(p);
  await upload(p);
  await p.waitForFunction(() => !document.getElementById('avatar-modal').hidden,
    null, { timeout: 8000 });
  await p.locator('#avatar-save').click();
  // Skrivingen + members-oppfriskningen går med lag=300: ferdig når sirkelen
  // faktisk viser det NYE bildet (JPEG fra redigereren, ikke seedens PNG).
  await p.waitForFunction(() => {
    const im = document.querySelector('.item .resp-avatar img');
    return !!im && im.src.indexOf('data:image/jpeg') === 0;
  }, null, { timeout: 12000, polling: 200 }).catch(() => {});
  const respNew = await p.evaluate(() => {
    const im = document.querySelector('.item .resp-avatar img');
    return im ? im.src.slice(0, 15) : null;
  });
  log(label + ' E: ansvarssirkelen bytter til det NYE bildet (ingen foreldet cache)',
    resp.src === 'data:image/png;' && respNew === 'data:image/jpeg',
    'før=' + resp.src + ' etter=' + respNew);

  log(label + ': ingen JS-feil', errs.length === 0, errs.join(' | '));
  await p.close();
  await ctx.close();
  await b.close();
}

(async () => {
  await run('desktop', { width: 1200, height: 900 }, false);
  await run('mobil', { width: 390, height: 780 }, true);
  const failed = results.filter((x) => !x).length;
  console.log('\n==== ' + (results.length - failed) + '/' + results.length + ' PASS ====');
  process.exit(failed ? 1 : 0);
})();
