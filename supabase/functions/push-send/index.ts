/* ============================================================
   Edge-funksjonen `push-send` — SENDEREN for web push.

   Den er med vilje dum. All tilstand, rekkefølge og idempotens ligger i
   databasen (`push_deliveries`, `push_claim()`, `push_report()`); denne
   funksjonen gjør bare det databasen ikke kan: signere med VAPID, kryptere
   etter RFC 8291 og gjøre HTTP-kallet. Den tolker ingen terskler, leser ingen
   lister og vet ingenting om hva et varsel BETYR — radene den sender er alt
   logget av generatoren i klienten (docs/varsler.md).

   Kjøreplanen er `pg_cron` → `public.push_tick()` → `pg_net` → hit, ett tikk i
   minuttet. Funksjonen kan også kalles for hånd; den er idempotent, for
   `push_claim()` LÅSER det den leverer ut.

   AUTENTISERING. Dette er et service-to-service-kall (pg_cron → pg_net → hit),
   og Supabase har ett mønster for nettopp det: send en SECRET KEY på
   `apikey`-headeren, og slå av plattformens JWT-verifisering
   (`--no-verify-jwt`), siden en secret key ikke er et JWT. Sjekken under er da
   den eneste porten, og den sammenligner hele nøkkelen i konstant tid.

   Nøkkelen leses av miljøet, i den rekkefølgen Supabase selv anbefaler:

     SUPABASE_SECRET_KEYS      — JSON-ordbok med de NYE nøklene
                                 (`sb_secret_…`). Den anbefalte veien.
     SUPABASE_SERVICE_ROLE_KEY — den gamle JWT-nøkkelen. Merket «legacy» i
                                 Supabases egen dokumentasjon og på vei ut,
                                 men fortsatt satt i eldre prosjekter.

   Begge veier virker, og koden foretrekker den nye. Ingen av dem finnes i
   repoet — de settes som funksjonens secrets.

   De øvrige hemmelighetene:

     SUPABASE_URL       (settes av plattformen)
     VAPID_PUBLIC_KEY   — base64url, 65 byte. Samme verdi som `pushPublicKey`
                          i config.js; stemmer de ikke, avviser push-tjenesten
                          hver eneste melding.
     VAPID_PRIVATE_KEY  — base64url, 32 byte. Ligger KUN her.
     VAPID_SUBJECT      — 'mailto:…' eller en https-URL, som RFC 8292 krever.

   Oppsettet (nøkkelpar, secrets, pg_cron, app_config) står i TODO.md.
   ============================================================ */
import { sendPush } from './webpush.mjs';

// Ett tikk tar høyst så mange leveringer. Resten venter til neste minutt —
// køen er persistent, så et tak koster forsinkelse, ikke leveranser.
const BATCH = 200;
// Så mange samtidige HTTP-kall. Push-tjenestene tåler langt mer; taket er her
// for at én treg tjeneste ikke skal spise hele kjøretiden.
const PARALLELL = 10;

function env(navn: string): string {
  const v = Deno.env.get(navn);
  if (!v) throw new Error('mangler miljøvariabel ' + navn);
  return v;
}

/* Prosjektets secret keys, nye først. `SUPABASE_SECRET_KEYS` er en JSON-ordbok
   (`{"default": "sb_secret_…"}`) — plattformen kan ha flere navngitte nøkler,
   og alle er gyldige avsendere. Den gamle `SUPABASE_SERVICE_ROLE_KEY` tas med
   sist, så et eldre prosjekt fortsatt virker uten endringer.

   Rekkefølgen betyr noe ett sted til: den FØRSTE er den funksjonen selv bruker
   mot PostgREST. Da flytter et prosjekt seg til den nye modellen ved å sette
   secrets, uten at koden røres. */
function hemmeligeNøkler(): string[] {
  const ut: string[] = [];
  const rå = Deno.env.get('SUPABASE_SECRET_KEYS');
  if (rå) {
    try {
      const d = JSON.parse(rå);
      if (d && typeof d === 'object') {
        // `default` først når den finnes; ellers ordbokens egen rekkefølge.
        if (typeof d.default === 'string' && d.default) ut.push(d.default);
        for (const [k, v] of Object.entries(d)) {
          if (k !== 'default' && typeof v === 'string' && v) ut.push(v);
        }
      }
    } catch { /* en ugyldig ordbok skal ikke felle den gamle veien */ }
  }
  const gammel = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (gammel) ut.push(gammel);
  if (!ut.length) {
    throw new Error('mangler SUPABASE_SECRET_KEYS eller SUPABASE_SERVICE_ROLE_KEY');
  }
  return ut;
}

/* Sammenligning uten tidslekkasje. Verdien er en hemmelighet, og en `===` på
   strenger stopper ved første ulike tegn — det er nok til å gjette den tegn for
   tegn. Lengden lekker fortsatt, og det er greit: nøkkelformatene er kjente. */
function likeHemmeligheter(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

async function rpc(navn: string, key: string, args: unknown) {
  const url = env('SUPABASE_URL') + '/rest/v1/rpc/' + navn;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: key,
      Authorization: 'Bearer ' + key,
    },
    body: JSON.stringify(args),
  });
  if (!res.ok) throw new Error(navn + ' svarte ' + res.status + ': ' + (await res.text()).slice(0, 200));
  return await res.json();
}

async function iBiter<T, R>(liste: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const ut: R[] = [];
  for (let i = 0; i < liste.length; i += n) {
    ut.push(...await Promise.all(liste.slice(i, i + n).map(fn)));
  }
  return ut;
}

Deno.serve(async (req) => {
  /* PORTEN. Funksjonen deployes med `--no-verify-jwt` (se toppen), så
     plattformen slipper alle gjennom og denne sjekken er den som gjelder:
     kalleren må vise en av prosjektets secret keys.

     `apikey` er headeren Supabase dokumenterer for service-to-service; vi tar
     også imot den på `Authorization: Bearer`, siden `pg_net` sender begge og en
     PostgREST-klient gjør det samme. `push_claim()` avviser uansett alt annet
     enn service_role, så dette er den ytre av to porter. */
  const nøkler = hemmeligeNøkler();
  const vist = (req.headers.get('apikey') || '')
    || (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!vist || !nøkler.some((k) => likeHemmeligheter(vist, k))) {
    return new Response('nei', { status: 401 });
  }
  const nøkkel = nøkler[0];      // den funksjonen selv bruker mot PostgREST

  const vapid = {
    publicKey: env('VAPID_PUBLIC_KEY'),
    privateKey: env('VAPID_PRIVATE_KEY'),
    subject: env('VAPID_SUBJECT'),
  };

  const due = await rpc('push_claim', nøkkel, { p_limit: BATCH });
  if (!Array.isArray(due) || due.length === 0) {
    return Response.json({ claimed: 0, sent: 0 });
  }

  const results = await iBiter(due, PARALLELL, async (d: any) => {
    try {
      const r = await sendPush(
        { endpoint: d.endpoint, p256dh: d.p256dh, auth: d.auth },
        JSON.stringify(d.payload), vapid);
      // Statuskoden, aldri kroppen: den kan inneholde hva som helst fra en
      // tredjepart, og loggen skal ikke bli et sted innhold samler seg.
      return { id: d.id, ok: r.ok, gone: r.gone, error: r.ok ? null : String(r.status) };
    } catch (e) {
      return { id: d.id, ok: false, gone: false, error: String((e as Error).message || e).slice(0, 200) };
    }
  });

  await rpc('push_report', nøkkel, { p_results: results });
  return Response.json({
    claimed: due.length,
    sent: results.filter((r) => r.ok).length,
    gone: results.filter((r) => r.gone).length,
  });
});
