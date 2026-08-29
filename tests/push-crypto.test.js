/*
  Regresjonstest: WEB PUSH-KRYPTOGRAFIEN (docs/varsler.md).

  `supabase/functions/push-send/webpush.mjs` er den eneste kryptografien i
  Huskis, og den er skrevet for hånd — ikke fordi det er gøy, men fordi
  alternativet var å dra et npm-avhengighetstre inn i et prosjekt uten
  avhengigheter. Da må den også PRØVES, ikke bare leses.

  Testen kjører i node (samme WebCrypto som Deno bruker i Edge-funksjonen),
  uten server og uten nettleser.

  Dekker:
     1. Rammen (RFC 8188 §2.1): salt, rekordstørrelse, nøkkellengde og
        avsenderens offentlige nøkkel står på riktig plass, og kroppen har
        nøyaktig den lengden én rekord skal ha.
     2. Et FAST vektor: med faste nøkler, fast salt og fast klartekst skal
        chifferteksten være nøyaktig den samme byten for byten. Verdien er
        regnet ut av `http_ece` 1.2.1 — referanseimplementasjonen `web-push`
        selv bruker — og ligger her som et tall, ikke som en påstand. Driver
        implementasjonen, er det denne linjen som sier fra.
     3. Nøkkelavtalen er BUNDET til begge parter: et annet abonnement (en
        annen `p256dh`) eller en annen `auth`-hemmelighet gir en annen
        chiffertekst. Uten den bindingen ville en melding kunne leses av feil
        mottaker.
     4. Saltet er ferskt per melding: to kall med samme innhold gir ulik kropp.
        Gjenbruk av salt + nøkkel bryter AES-GCM.
     5. VAPID (RFC 8292): tokenet er et ES256-JWT som VERIFISERER mot den
        offentlige nøkkelen, `aud` er endepunktets ORIGIN (ikke hele adressen —
        den ville lekket abonnementet), `exp` ligger innenfor 24 timer, og
        headeren bærer `k=<offentlig nøkkel>`.
     6. Utfallet av et forsøk: 201 → ok, 410/404 → gone (abonnementet er dødt),
        503 → verken ok eller gone (prøves igjen).
     7. Avvisning av ugyldige nøkler — en `p256dh` med feil lengde skal feile
        her, ikke hos push-tjenesten.

  Kjør:
    node tests/push-crypto.test.js
*/
'use strict';
const path = require('path');

const results = [];
const log = (n, ok, x = '') => {
  results.push(ok);
  console.log((ok ? 'PASS' : 'FAIL') + ' — ' + n +
    (x !== '' ? '  [' + (typeof x === 'string' ? x : JSON.stringify(x)) + ']' : ''));
};

const MOD = path.join(__dirname, '..', 'supabase', 'functions', 'push-send', 'webpush.mjs');

/* Det faste vektoret. Nøklene er vilkårlige, men FASTE, og `body` er det
   `http_ece` 1.2.1 (`ece.encrypt(..., {version: 'aes128gcm'})`) gir for
   nøyaktig disse verdiene. Regnes det ut på nytt, er kommandoen:

     npm pack http_ece@1.2.1 && tar xzf http_ece-1.2.1.tgz
     node -e "const e=require('./package/ece.js'), c=require('crypto'); …"
*/
const V = {
  uaPublic: 'BKf-0z47jqWLUVd_3r4-JbyhdGwgWERsrt1l0Cfur7vPXM7644P_EyKSDC1aGhvm7kr5plt9zOpvdaz_WTuJoII',
  asPublic: 'BH-aHx-RmE2R0fgNXgkv_Ezms8TIzCY1jWp4EWfq0MAzaE7m-_PX2FLR1OxEykJAlfXDZMV7RFaUJhYKspkFtos',
  asPrivate: 'Gz1feaHD5QcZstT2CKHD5QcbLU9giascLT5PUGFyg5Q',
  auth: 'AQIDBAUGBwgJCgsMDQ4PEA',
  salt: 'obLD1OX2BxgpOktcbX6PkA',
  plaintext: '{"n":"Julefrist","b":"Frist utløpt"}',
  body: 'obLD1OX2BxgpOktcbX6PkAAAEABBBH-aHx-RmE2R0fgNXgkv_Ezms8TIzCY1jWp4EWfq0MAzaE7m-' +
    '_PX2FLR1OxEykJAlfXDZMV7RFaUJhYKspkFtous9cZPbmvzHEdXo0gtxwr_gj8Pfr123F1xEvODhQVE7oNkKxTmzSzIoPs9rttHiXNnesUmiTM',
};

// Et annet, gyldig abonnement — til bindings-testen.
const ANNEN_UA = 'BIqboT1bBoLttEgYCpThJsQJE53DOmYwAV2sFRvLw15moWrjCM_GIvBtmu8CXiq9LEaprJcyKVlhMy_Od6u2xxg';

async function main() {
  const wp = await import('file://' + MOD);
  const enc = new TextEncoder();

  /* ---------- 1) Rammen ---------- */
  const body = await wp.encryptPayload(enc.encode(V.plaintext), V.uaPublic, V.auth, {
    salt: wp.b64urlToBytes(V.salt),
    keyPair: await fastNokkelpar(wp),
    recordSize: 4096,
  });
  const dv = new DataView(body.buffer, body.byteOffset, body.byteLength);
  log('1a: rammen starter med de 16 saltbytene',
    wp.bytesToB64url(body.slice(0, 16)) === V.salt, wp.bytesToB64url(body.slice(0, 16)));
  log('1b: rekordstørrelsen står som 4 byte big-endian', dv.getUint32(16) === 4096, dv.getUint32(16));
  log('1c: nøkkellengden er 65 (ukomprimert P-256)', body[20] === 65, body[20]);
  log('1d: avsenderens offentlige nøkkel står i rammen',
    wp.bytesToB64url(body.slice(21, 86)) === V.asPublic, wp.bytesToB64url(body.slice(21, 86)));
  // 21 rammebyte + 65 nøkkel + klartekst + 1 skilletegn + 16 GCM-tag
  const ventet = 21 + 65 + enc.encode(V.plaintext).length + 1 + 16;
  log('1e: kroppen er nøyaktig én rekord lang (ramme + nøkkel + tekst + skilletegn + tag)',
    body.length === ventet, body.length + ' av ' + ventet);

  /* ---------- 2) Det faste vektoret ---------- */
  log('2: chifferteksten er byte for byte den http_ece gir for de samme nøklene',
    wp.bytesToB64url(body) === V.body, wp.bytesToB64url(body).slice(0, 40) + '…');

  /* ---------- 3) Bundet til begge parter ---------- */
  const annetAbo = await wp.encryptPayload(enc.encode(V.plaintext), ANNEN_UA, V.auth, {
    salt: wp.b64urlToBytes(V.salt), keyPair: await fastNokkelpar(wp), recordSize: 4096,
  });
  log('3a: et annet abonnement (annen p256dh) gir en annen chiffertekst',
    wp.bytesToB64url(annetAbo) !== V.body);
  const annenAuth = await wp.encryptPayload(enc.encode(V.plaintext), V.uaPublic, 'EA8ODQwLCgkIBwYFBAMCAQ', {
    salt: wp.b64urlToBytes(V.salt), keyPair: await fastNokkelpar(wp), recordSize: 4096,
  });
  log('3b: en annen auth-hemmelighet gir en annen chiffertekst',
    wp.bytesToB64url(annenAuth) !== V.body);

  /* ---------- 4) Ferskt salt per melding ---------- */
  const a = await wp.encryptPayload(enc.encode(V.plaintext), V.uaPublic, V.auth);
  const b = await wp.encryptPayload(enc.encode(V.plaintext), V.uaPublic, V.auth);
  log('4: to meldinger med samme innhold får hver sitt salt og hver sin kropp',
    wp.bytesToB64url(a) !== wp.bytesToB64url(b) &&
    wp.bytesToB64url(a.slice(0, 16)) !== wp.bytesToB64url(b.slice(0, 16)));

  /* ---------- 5) VAPID ---------- */
  const vapid = await lagVapid(wp);
  const NÅ = 1800000000;
  const h = await wp.vapidHeaders('https://fcm.googleapis.com/fcm/send/abc123', vapid, NÅ);
  const m = /^vapid t=([\w-]+\.[\w-]+\.[\w-]+), k=(.+)$/.exec(h.Authorization);
  log('5a: headeren har formen «vapid t=<jwt>, k=<offentlig nøkkel>»', !!m,
    h.Authorization.slice(0, 30) + '…');
  const [head, payload, sig] = m[1].split('.');
  const krav = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  log('5b: k= er den offentlige nøkkelen fra config.js', m[2] === vapid.publicKey);
  log('5c: alg er ES256', JSON.parse(Buffer.from(head, 'base64url').toString('utf8')).alg === 'ES256');
  log('5d: aud er endepunktets ORIGIN — ikke hele adressen (den ville lekket abonnementet)',
    krav.aud === 'https://fcm.googleapis.com', krav.aud);
  log('5e: exp ligger fram i tid og innenfor 24 timer',
    krav.exp > NÅ && krav.exp - NÅ <= 24 * 3600, krav.exp - NÅ + ' s');
  log('5f: sub er kontaktadressen', krav.sub === vapid.subject, krav.sub);
  // Selve signaturen: verifiser med den OFFENTLIGE nøkkelen. Uten dette leddet
  // ville en hvilken som helst 64-bytestreng bestått testen over.
  const pub = wp.b64urlToBytes(vapid.publicKey);
  const verKey = await crypto.subtle.importKey('jwk', {
    kty: 'EC', crv: 'P-256',
    x: wp.bytesToB64url(pub.slice(1, 33)), y: wp.bytesToB64url(pub.slice(33, 65)), ext: true,
  }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  const gyldig = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, verKey,
    wp.b64urlToBytes(sig), enc.encode(head + '.' + payload));
  log('5g: signaturen verifiserer mot den offentlige nøkkelen', gyldig === true);
  const tull = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, verKey,
    wp.b64urlToBytes(sig), enc.encode(head + '.' + payload + 'x'));
  log('5h: … og ikke mot en endret kropp', tull === false);
  log('5i: pushAudience() tar originet ut av et hvilket som helst endepunkt',
    wp.pushAudience('https://updates.push.services.mozilla.com/wpush/v2/gAAA?x=1') ===
      'https://updates.push.services.mozilla.com');

  /* ---------- 6) Utfallet av et forsøk ---------- */
  const sub = { endpoint: 'https://push.example.com/x', p256dh: V.uaPublic, auth: V.auth };
  const svar = (status) => async () => ({ status });
  const r201 = await wp.sendPush(sub, '{}', vapid, { fetch: svar(201) });
  const r410 = await wp.sendPush(sub, '{}', vapid, { fetch: svar(410) });
  const r404 = await wp.sendPush(sub, '{}', vapid, { fetch: svar(404) });
  const r503 = await wp.sendPush(sub, '{}', vapid, { fetch: svar(503) });
  log('6a: 201 er levert', r201.ok === true && r201.gone === false, r201);
  log('6b: 410 er et dødt abonnement — slås av for godt', r410.gone === true && r410.ok === false, r410);
  log('6c: 404 er det samme', r404.gone === true, r404);
  log('6d: 503 er midlertidig — verken levert eller dødt', r503.ok === false && r503.gone === false, r503);

  // Headerne som faktisk sendes.
  let sett = null;
  let settUrl = null;
  const HEMMELIG = '{"n":"Tannlegetime","b":"Frist utløpt"}';
  await wp.sendPush(sub, HEMMELIG, vapid,
    { fetch: async (u, o) => { settUrl = u; sett = o; return { status: 201 }; }, ttl: 3600 });
  log('6e: forespørselen er en POST til endepunktet, med aes128gcm-koding og TTL',
    settUrl === sub.endpoint && sett.method === 'POST' &&
    sett.headers['Content-Encoding'] === 'aes128gcm' &&
    sett.headers['Content-Type'] === 'application/octet-stream' && sett.headers.TTL === '3600',
    { enc: sett.headers['Content-Encoding'], ttl: sett.headers.TTL });
  // Push-tjenesten skal ikke kunne lese et eneste ord av varselet.
  log('6f: kroppen er den krypterte blokken — klarteksten finnes ikke i den',
    sett.body instanceof Uint8Array &&
    Buffer.from(sett.body).indexOf(Buffer.from('Tannlegetime', 'utf8')) === -1 &&
    sett.body.length === 21 + 65 + Buffer.byteLength(HEMMELIG) + 1 + 16,
    sett.body.length + ' byte');

  /* ---------- 7) Ugyldige nøkler avvises her ---------- */
  const feiler = async (fn) => { try { await fn(); return false; } catch (e) { return true; } };
  log('7a: en p256dh med feil lengde avvises',
    await feiler(() => wp.encryptPayload(enc.encode('x'), 'AAAA', V.auth)));
  log('7b: en auth-hemmelighet med feil lengde avvises',
    await feiler(() => wp.encryptPayload(enc.encode('x'), V.uaPublic, 'AAAA')));
  log('7c: en VAPID-privatnøkkel med feil lengde avvises',
    await feiler(() => wp.vapidHeaders('https://x.example/y',
      { publicKey: vapid.publicKey, privateKey: 'AAAA', subject: 'mailto:a@b.no' })));

  const ok = results.filter(Boolean).length;
  console.log('\n==== ' + ok + '/' + results.length + ' PASS ====');
  process.exit(ok === results.length ? 0 : 1);
}

/* Avsenderens FASTE nøkkelpar, importert fra vektorets `asPrivate`/`asPublic`.
   I drift lages et nytt par per melding; her må det være det samme, ellers
   finnes det ikke noe fast tall å sammenligne med. */
async function fastNokkelpar(wp) {
  const pub = wp.b64urlToBytes(V.asPublic);
  const jwk = {
    kty: 'EC', crv: 'P-256',
    x: wp.bytesToB64url(pub.slice(1, 33)),
    y: wp.bytesToB64url(pub.slice(33, 65)),
    ext: true,
  };
  return {
    privateKey: await crypto.subtle.importKey('jwk', Object.assign({ d: V.asPrivate }, jwk),
      { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']),
    publicKey: await crypto.subtle.importKey('jwk', jwk,
      { name: 'ECDH', namedCurve: 'P-256' }, true, []),
  };
}

// Et ferskt VAPID-par, i akkurat den formen produksjonen bruker: base64url av
// den rå d-en og av det ukomprimerte punktet.
async function lagVapid(wp) {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  const pub = new Uint8Array(65);
  pub[0] = 4;
  pub.set(wp.b64urlToBytes(jwk.x), 1);
  pub.set(wp.b64urlToBytes(jwk.y), 33);
  return { publicKey: wp.bytesToB64url(pub), privateKey: jwk.d, subject: 'mailto:post@huskis.no' };
}

main().catch((e) => { console.error(e); process.exit(1); });
