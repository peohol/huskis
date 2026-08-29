/* ============================================================
   Web Push: VAPID-signering (RFC 8292) og kryptering (RFC 8291).

   Ren, avhengighetsfri ES-modul over WebCrypto. Den kjører uendret i Deno
   (Edge-funksjonen ved siden av) og i Node 22 (`tests/push-crypto.test.js`) —
   og det er hele grunnen til at den er en egen fil: den eneste kryptografien i
   Huskis skal kunne prøves mot RFC-ens egne tall uten å pakke en runtime.

   Ingen npm-pakke er innført for dette. Huskis har ingen klientavhengigheter
   (docs/sikkerhetsheadere.md), og en pushsender som drar inn et
   avhengighetstre ville vært det første stedet den regelen sprakk.

   Hva som skjer, i rekkefølge:

     1. Avsenderen lager et FLYKTIG P-256-nøkkelpar per melding.
     2. ECDH mot nettleserens offentlige nøkkel (`p256dh`) gir et delt
        hemmelighet, som sammen med abonnementets `auth`-hemmelighet og BEGGE
        offentlige nøkler blir innholdsnøkkelen (HKDF, «WebPush: info»).
     3. Kroppen krypteres med AES-128-GCM og pakkes i aes128gcm-rammen
        (RFC 8188): salt, rekordstørrelse, avsenderens offentlige nøkkel,
        chiffertekst.
     4. Forespørselen signeres med VAPID-nøkkelparet, som identifiserer
        SENDEREN overfor push-tjenesten — den offentlige halvdelen står i
        config.js, den private finnes bare i Vault.

   Push-tjenesten (Google, Mozilla, Apple) ser altså aldri innholdet: bare et
   endepunkt, en signatur og en ugjennomsiktig blokk.
   ============================================================ */

const subtle = globalThis.crypto.subtle;
const enc = new TextEncoder();

export function b64urlToBytes(s) {
  const pad = '='.repeat((4 - (String(s).length % 4)) % 4);
  const raw = atob(String(s).replace(/-/g, '+').replace(/_/g, '/') + pad);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export function bytesToB64url(buf) {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function bytes(...parts) {
  let n = 0;
  parts.forEach((p) => { n += p.length; });
  const out = new Uint8Array(n);
  let i = 0;
  parts.forEach((p) => { out.set(p, i); i += p.length; });
  return out;
}

async function hmac(keyBytes, dataBytes) {
  const k = await subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await subtle.sign('HMAC', k, dataBytes));
}

/* HKDF i to halvdeler, som RFC 5869. Bare ÉN blokk trengs her — alt vi henter
   ut er 32 byte eller mindre — så tellerbyten er alltid 0x01. */
async function hkdf(salt, ikm, info, len) {
  const prk = await hmac(salt, ikm);
  const okm = await hmac(prk, bytes(info, new Uint8Array([1])));
  return okm.slice(0, len);
}

/* Krypterer én melding til ett abonnement (aes128gcm, én rekord).

   `salt` og `keyPair` kan sendes inn — det er det testen bruker for å regne ut
   nøyaktig de bytene RFC 8291 §5 oppgir. I drift genereres begge friskt per
   melding: gjenbruk av et salt med den samme nøkkelen ville brutt GCM. */
export async function encryptPayload(payloadBytes, p256dh, authSecret, opts) {
  const o = opts || {};
  const uaPublic = typeof p256dh === 'string' ? b64urlToBytes(p256dh) : p256dh;
  const auth = typeof authSecret === 'string' ? b64urlToBytes(authSecret) : authSecret;
  if (uaPublic.length !== 65) throw new Error('p256dh må være 65 byte (ukomprimert P-256)');
  if (auth.length !== 16) throw new Error('auth må være 16 byte');

  const salt = o.salt || globalThis.crypto.getRandomValues(new Uint8Array(16));
  const rs = o.recordSize || 4096;

  const pair = o.keyPair || await subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPublic = new Uint8Array(await subtle.exportKey('raw', pair.publicKey));

  const uaKey = await subtle.importKey('raw', uaPublic,
    { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdh = new Uint8Array(await subtle.deriveBits(
    { name: 'ECDH', public: uaKey }, pair.privateKey, 256));

  // Innholdsnøkkelen bindes til BEGGE partene: mottakerens nøkkel først, så
  // avsenderens. Bytter man rekkefølge, dekrypterer ingen nettleser meldingen.
  const ikm = await hkdf(auth, ecdh,
    bytes(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);

  // 0x02 = «dette var siste rekord». Vi sender alltid nøyaktig én.
  const padded = bytes(payloadBytes, new Uint8Array([2]));
  const aesKey = await subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['encrypt']);
  const ct = new Uint8Array(await subtle.encrypt(
    { name: 'AES-GCM', iv: nonce, tagLength: 128 }, aesKey, padded));

  // aes128gcm-rammen (RFC 8188 §2.1): salt | rs (4, big-endian) | idlen | keyid
  const head = new Uint8Array(5);
  new DataView(head.buffer).setUint32(0, rs);
  head[4] = asPublic.length;
  return bytes(salt, head, asPublic, ct);
}

/* VAPID-JWT-et (RFC 8292): ES256 over {aud, exp, sub}. `aud` er ORIGINET til
   endepunktet — ikke hele adressen: den identifiserer push-tjenesten, og et
   token som bar hele endepunktet ville lekket abonnementet til enhver som fikk
   se tokenet. */
export function pushAudience(endpoint) {
  const u = new URL(endpoint);
  return u.origin;
}

async function vapidKey(privateKeyB64, publicKeyB64) {
  const d = b64urlToBytes(privateKeyB64);
  const pub = b64urlToBytes(publicKeyB64);
  if (d.length !== 32) throw new Error('VAPID-privatnøkkelen må være 32 byte (rå d)');
  if (pub.length !== 65 || pub[0] !== 4) {
    throw new Error('VAPID-offentlignøkkelen må være 65 byte (ukomprimert P-256)');
  }
  return subtle.importKey('jwk', {
    kty: 'EC', crv: 'P-256',
    d: bytesToB64url(d),
    x: bytesToB64url(pub.slice(1, 33)),
    y: bytesToB64url(pub.slice(33, 65)),
    ext: true,
  }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
}

export async function vapidHeaders(endpoint, vapid, nowSec) {
  const now = nowSec == null ? Math.floor(Date.now() / 1000) : nowSec;
  const head = bytesToB64url(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  // 12 timer. Push-tjenestene avviser et token som varer lenger enn 24.
  const body = bytesToB64url(enc.encode(JSON.stringify({
    aud: pushAudience(endpoint), exp: now + 12 * 60 * 60, sub: vapid.subject,
  })));
  const key = await vapidKey(vapid.privateKey, vapid.publicKey);
  const sig = new Uint8Array(await subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(head + '.' + body)));
  return {
    Authorization: 'vapid t=' + head + '.' + body + '.' + bytesToB64url(sig) +
      ', k=' + vapid.publicKey,
  };
}

/* Sender ÉN push. Returnerer `{ ok, status, gone }`:

     gone = true  → 404/410: endepunktet finnes ikke lenger. Abonnementet skal
                    slås av for godt, ikke prøves igjen.
     ok = false, gone = false → midlertidig; køen prøver igjen.

   Selve avgjørelsen om hva som skal skje med raden tas i databasen
   (`push_report`), ikke her: da ligger den ett sted, og en senere sender arver
   den uten å kunne noe om HTTP. */
export async function sendPush(sub, payloadText, vapid, opts) {
  const o = opts || {};
  const body = await encryptPayload(enc.encode(payloadText), sub.p256dh, sub.auth, o);
  const headers = Object.assign({
    'Content-Encoding': 'aes128gcm',
    'Content-Type': 'application/octet-stream',
    TTL: String(o.ttl == null ? 24 * 60 * 60 : o.ttl),
    // «normal» er standarden, men den skrives ut: en push som ikke er
    // tidskritisk nok til å vekke en telefon fra dvale er nettopp det Huskis
    // sender, og push-tjenestene batcher deretter.
    Urgency: o.urgency || 'normal',
  }, await vapidHeaders(sub.endpoint, vapid, o.nowSec));

  const fetchFn = o.fetch || globalThis.fetch;
  const res = await fetchFn(sub.endpoint, { method: 'POST', headers, body });
  return {
    ok: res.status >= 200 && res.status < 300,
    status: res.status,
    gone: res.status === 404 || res.status === 410,
  };
}
