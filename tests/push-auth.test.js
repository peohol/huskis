/*
  Regresjonstest: HEADERNE på service-to-service-kallene rundt web push
  (docs/varsler.md).

  Supabase har byttet nøkkelmodell. De nye API-nøklene (`sb_secret_…`) er IKKE
  JWT-er, og Supabases egen dokumentasjon er eksplisitt på to ting:

    · de skal sendes på `apikey`
    · sendes de SAMTIDIG på `Authorization: Bearer`, prøver plattformen å tolke
      dem som JWT og avviser HELE kallet med «Invalid JWT»

  Det siste er hele grunnen til at denne testen finnes. «Send begge for
  sikkerhets skyld» er den intuitive løsningen, den ser trygg ut i en diff, og
  den ødelegger nøyaktig den veien vi vil bruke. Den gamle
  `service_role`-nøkkelen ER et JWT og skal fortsatt ha begge.

  Testen sjekker ikke at ordet «apikey» finnes i en fil — den KJØRER
  `supabase/functions/push-send/auth.mjs` og ser på headerobjektet som faktisk
  blir bygget, og på at `Authorization` da ikke finnes i det i det hele tatt.
  I tillegg leses `index.ts` og `users-and-sharing.sql` for å fange den andre
  måten feilen kan komme tilbake på: at noen bygger headere utenom auth.mjs /
  push_headers() igjen.

  Dekker:
     1. `erJwt()` skiller de to formene.
     2. UTGÅENDE: ny secret key → kun `apikey`, ingen `Authorization`.
     3. UTGÅENDE: legacy JWT → begge, som før.
     4. INNKOMMENDE: nøkkel på `apikey` godtas; feil nøkkel avvises.
     5. INNKOMMENDE: legacy JWT godtas på `Authorization: Bearer`.
     6. INNKOMMENDE: en `sb_secret_…` på Bearer godtas IKKE — den veien er en
        feilkonfigurasjon, og å godta den ville skjult den til plattformen
        selv begynte å avvise kallene.
     7. Sammenligningen er konstant i tid over lik lengde.
     8. Kilden: verken senderen eller SQL-en bygger disse headerne selv.

  Kjør:
    node tests/push-auth.test.js
*/
'use strict';
const fs = require('fs');
const path = require('path');

const results = [];
const log = (n, ok, x = '') => {
  results.push(ok);
  console.log((ok ? 'PASS' : 'FAIL') + ' — ' + n +
    (x !== '' ? '  [' + (typeof x === 'string' ? x : JSON.stringify(x)) + ']' : ''));
};

const FN = path.join(__dirname, '..', 'supabase', 'functions', 'push-send');
const SQL = path.join(__dirname, '..', 'supabase', 'users-and-sharing.sql');

// En ny secret key, og en legacy service_role-nøkkel i riktig FORM (tre
// base64url-segmenter). Signaturen betyr ingenting her — det er formen
// plattformen reagerer på.
const NY = 'sb_secret_v1_QmVyZ2VuUmVnbmVyTWVzdA';
const LEGACY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'
  + '.eyJyb2xlIjoic2VydmljZV9yb2xlIiwiaXNzIjoic3VwYWJhc2UifQ'
  + '.dGhpc19pc19ub3RfYV9yZWFsX3NpZ25hdHVyZV9vaw';

const hdrs = (o) => ({ get: (n) => o[n.toLowerCase()] ?? null });

async function main() {
  const a = await import('file://' + path.join(FN, 'auth.mjs'));

  /* 1 — formen */
  log('1a erJwt: en sb_secret_-nøkkel er ikke et JWT', a.erJwt(NY) === false);
  log('1b erJwt: legacy service_role ER et JWT', a.erJwt(LEGACY) === true);
  log('1c erJwt: tom/ugyldig verdi er ikke et JWT',
    a.erJwt('') === false && a.erJwt('a.b') === false && a.erJwt('a.b.c.d') === false
    && a.erJwt('a..c') === false && a.erJwt(null) === false);

  /* 2 — UTGÅENDE, ny nøkkel. Kjernen i hele testen. */
  const nyH = a.tjenesteHeadere(NY);
  log('2a ny secret key sendes på apikey', nyH.apikey === NY, nyH.apikey);
  log('2b ny secret key ligger IKKE i Authorization',
    !('Authorization' in nyH) && !('authorization' in nyH), Object.keys(nyH));
  log('2c ingen header i det hele tatt inneholder nøkkelen utenom apikey',
    Object.entries(nyH).filter(([, v]) => String(v).includes(NY)).length === 1,
    Object.keys(nyH));

  /* 3 — UTGÅENDE, legacy. Skal være uendret. */
  const gmH = a.tjenesteHeadere(LEGACY);
  log('3a legacy sendes på apikey', gmH.apikey === LEGACY);
  log('3b legacy sendes også som Bearer', gmH.Authorization === 'Bearer ' + LEGACY);

  /* 4–6 — INNKOMMENDE */
  log('4a nøkkel på apikey godtas', a.godkjentKaller(hdrs({ apikey: NY }), [NY]));
  log('4b feil nøkkel avvises', a.godkjentKaller(hdrs({ apikey: NY + 'x' }), [NY]) === false);
  log('4c ingen headere avvises', a.godkjentKaller(hdrs({}), [NY]) === false);
  log('4d en av flere navngitte nøkler godtas',
    a.godkjentKaller(hdrs({ apikey: NY }), ['sb_secret_annen_nokkel_her_1234', NY]));

  log('5a legacy JWT godtas på Authorization: Bearer',
    a.godkjentKaller(hdrs({ authorization: 'Bearer ' + LEGACY }), [LEGACY]));
  log('5b legacy JWT godtas også på apikey',
    a.godkjentKaller(hdrs({ apikey: LEGACY }), [LEGACY]));

  log('6a en ny secret key på Bearer godtas IKKE',
    a.godkjentKaller(hdrs({ authorization: 'Bearer ' + NY }), [NY]) === false);
  log('6b … heller ikke uten Bearer-prefikset',
    a.godkjentKaller(hdrs({ authorization: NY }), [NY]) === false);

  /* 7 — sammenligningen */
  log('7a like hemmeligheter er like', a.likeHemmeligheter(NY, NY));
  log('7b ulik lengde er ulikt', a.likeHemmeligheter(NY, NY + 'x') === false);
  log('7c siste tegn teller', a.likeHemmeligheter(NY, NY.slice(0, -1) + 'X') === false);

  /* 8 — kilden: ingen andre steder som bygger de samme headerne */
  const idx = fs.readFileSync(path.join(FN, 'index.ts'), 'utf8');
  // Kommentarene ut FØRST — dokumentasjonen under omtaler nettopp den
  // headeren testen skal se at koden ikke setter.
  const kode = idx.replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  log('8a senderen bygger headerne via auth.mjs',
    /tjenesteHeadere\(/.test(kode) && /from '\.\/auth\.mjs'/.test(kode));
  log('8b senderen setter ALDRI Authorization selv',
    !/Authorization\s*:/.test(kode) && !/'authorization'\s*:/i.test(kode),
    (kode.match(/.*[Aa]uthorization\s*:.*/g) || []).join(' | ').slice(0, 120));
  log('8c porten går gjennom godkjentKaller', /godkjentKaller\(req\.headers/.test(kode));

  const sql = fs.readFileSync(SQL, 'utf8');
  const tick = sql.slice(sql.indexOf('create or replace function public.push_tick()'));
  const tickKropp = tick.slice(0, tick.indexOf('$$;') + 3);
  log('8d push_tick() bruker push_headers()', /public\.push_headers\(svc_key\)/.test(tickKropp));
  log('8e push_tick() bygger ingen Authorization-header selv',
    !/Authorization/i.test(tickKropp),
    (tickKropp.match(/.*[Aa]uthorization.*/g) || []).join(' | ').slice(0, 120));

  const ph = sql.slice(sql.indexOf('create or replace function public.push_headers('));
  const phKropp = ph.slice(0, ph.indexOf('$$;') + 3);
  log('8f push_headers() setter Authorization kun i JWT-grenen',
    /when p_key ~ '\^\[A-Za-z0-9_-\]\+\\\.\[A-Za-z0-9_-\]\+\\\.\[A-Za-z0-9_-\]\+\$'/.test(phKropp)
    && (phKropp.match(/Authorization/g) || []).length === 1);
  log('8g push_headers() er stengt for klientroller',
    /revoke all on function public\.push_headers\(text\) from public, anon, authenticated;/.test(sql));

  const feil = results.filter((r) => !r).length;
  console.log('\n' + (results.length - feil) + ' passed, ' + feil + ' failed');
  process.exit(feil ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
