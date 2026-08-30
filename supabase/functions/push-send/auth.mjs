/* HEADERNE for service-to-service-kallene rundt web push — og bare dem.

   Ligger for seg selv av samme grunn som `webpush.mjs`: den er ren, den er
   viktig å ha rett, og da skal den kunne kjøres av en test i node uten Deno,
   uten nett og uten et Supabase-prosjekt (`tests/push-auth.test.js`).

   HELE POENGET er at de to nøkkeltypene IKKE har de samme headerne:

     sb_secret_…      De nye API-nøklene. IKKE JWT-er. Supabase dokumenterer
                      at de skal sendes på `apikey` — og at sender du dem
                      SAMTIDIG på `Authorization: Bearer`, prøver plattformen
                      å tolke dem som JWT og avviser hele kallet med
                      «Invalid JWT». Å sende begge «for sikkerhets skyld» er
                      altså ikke forsiktig, det er ødeleggende.

     service_role     Den gamle nøkkelen, som ER et JWT. PostgREST leser
                      rollen ut av `Authorization`, så den trenger begge, og
                      det er det mønsteret pg_net og alle Supabase-klienter
                      har brukt til nå.

   Derfor: avgjør hva nøkkelen ER, og velg headere etter det. */

/* Et JWT er tre base64url-segmenter med punktum mellom. Vi verifiserer ikke
   signaturen — spørsmålet her er bare FORMEN, altså om plattformen kommer til
   å prøve å tolke verdien som et token. En `sb_secret_…`-nøkkel inneholder
   ikke punktum og faller aldri igjennom her. */
export function erJwt(nøkkel) {
  if (typeof nøkkel !== 'string' || !nøkkel) return false;
  const d = nøkkel.split('.');
  return d.length === 3 && d.every((s) => s.length > 0 && /^[A-Za-z0-9_-]+$/.test(s));
}

/* Headerne ET UTGÅENDE kall skal ha. Merk at den nye veien ikke setter
   `Authorization` i det hele tatt — ikke tom, ikke utelatt-men-mulig: nøkkelen
   finnes ett sted, på `apikey`. */
export function tjenesteHeadere(nøkkel) {
  const h = { apikey: nøkkel };
  if (erJwt(nøkkel)) h.Authorization = 'Bearer ' + nøkkel;
  return h;
}

/* Nøkkelen en INNKOMMENDE forespørsel viser fram, eller `null`.

   `apikey` er den dokumenterte headeren og godtas alltid. `Authorization:
   Bearer` godtas KUN når verdien er et JWT — altså den gamle nøkkelen, som
   pg_net og eldre klienter sender den veien. En `sb_secret_…` på Bearer er per
   definisjon en feilkonfigurasjon, og å godta den her ville gjort nettopp den
   feilen usynlig helt til plattformen selv begynte å avvise kallet. */
export function vistNøkkel(headers) {
  const les = (n) => (typeof headers?.get === 'function' ? headers.get(n) : headers?.[n]) || '';
  const påApikey = les('apikey').trim();
  if (påApikey) return påApikey;
  const påBearer = les('authorization').replace(/^Bearer\s+/i, '').trim();
  return erJwt(påBearer) ? påBearer : null;
}

/* Sammenligning uten tidslekkasje. Verdien er en hemmelighet, og en `===` på
   strenger stopper ved første ulike tegn — det er nok til å gjette den tegn for
   tegn. Lengden lekker fortsatt, og det er greit: nøkkelformatene er kjente. */
export function likeHemmeligheter(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

/* Porten: er kalleren en av prosjektets secret keys? */
export function godkjentKaller(headers, nøkler) {
  const vist = vistNøkkel(headers);
  if (!vist) return false;
  return nøkler.some((k) => likeHemmeligheter(vist, k));
}
