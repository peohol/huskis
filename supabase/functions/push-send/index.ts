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

   Hemmeligheter kommer fra funksjonens miljø og finnes ingen steder i repoet:

     SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   (settes av plattformen)
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

async function rpc(navn: string, args: unknown) {
  const url = env('SUPABASE_URL') + '/rest/v1/rpc/' + navn;
  const key = env('SUPABASE_SERVICE_ROLE_KEY');
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
  /* Plattformen verifiserer JWT-et før vi kommer hit (`verify_jwt`, standard).
     Sjekken her er det andre laget, og den er billig: bare service_role-nøkkelen
     får sende. `push_claim()` avviser uansett alt annet. */
  const auth = req.headers.get('authorization') || '';
  if (auth !== 'Bearer ' + env('SUPABASE_SERVICE_ROLE_KEY')) {
    return new Response('nei', { status: 401 });
  }

  const vapid = {
    publicKey: env('VAPID_PUBLIC_KEY'),
    privateKey: env('VAPID_PRIVATE_KEY'),
    subject: env('VAPID_SUBJECT'),
  };

  const due = await rpc('push_claim', { p_limit: BATCH });
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

  await rpc('push_report', { p_results: results });
  return Response.json({
    claimed: due.length,
    sent: results.filter((r) => r.ok).length,
    gone: results.filter((r) => r.gone).length,
  });
});
