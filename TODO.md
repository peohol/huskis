# TODO — det som fortsatt gjenstår

Kun oppgaver som ikke er gjort på dagens `main`, og som ikke kan gjøres herfra.
Alt annet — hvilke migreringer som er kjørt, hvilke funksjoner som finnes og
hvordan de virker — leses i `supabase/users-and-sharing.sql`, `docs/` og
git-historikken.

Skjemaet trenger ingen manuell kjøring: «Release»
(`.github/workflows/release.yml`) kjører `supabase/setup.sql` +
`supabase/users-and-sharing.sql` mot produksjon ved hver push til `main`, og
slipper først frontenden ut på Vercel etter at smoke-testen er grønn. Se
`docs/release-og-deploy.md`.

## Android: fra debug-APK til Google Plays interne testspor

Repo-siden er på plass — signering, release-AAB-workflow, package ID og
`versionCode`-regelen. Det som gjenstår er manuelt og kan ikke gjøres herfra:
Google Play Developer-kontoen, upload-nøkkelen, de fire `ANDROID_UPLOAD_*`-
secretene og første opplasting. Stegene i rekkefølge står i
`docs/mobilapp-plan.md`, fase 6.

## Web push: nøkkelpar, secrets og kjøreplan

Native Android-varsler virker uten noe av dette — de er lokale alarmer på
enheten. **Web push** trenger derimot en sender, og senderen trenger et
nøkkelpar og et sted å kjøre. Koden er på plass (`sw.js`,
`supabase/functions/push-send/`, tabellene og RPC-ene); det som gjenstår er
manuelt og kan ikke gjøres herfra. Modellen står i `docs/varsler.md`.

Uten stegene under er kanalen inert: `pushPublicKey` i `config.js` er tom,
bryteren «Varsler på denne enheten» melder seg selv som ikke støttet i
nettleseren, og `push_tick()` gjør ingenting.

1. **Lag VAPID-nøkkelparet** (P-256, base64url). Den offentlige halvdelen er
   ment å ligge i frontend; den private skal aldri inn i repoet, en PR, en logg
   eller en chat:

   ```bash
   node -e '
   const c = require("crypto");
   const e = c.createECDH("prime256v1"); e.generateKeys();
   console.log("public :", e.getPublicKey().toString("base64url"));
   console.log("private:", e.getPrivateKey().toString("base64url"));'
   ```

2. **Legg den offentlige halvdelen inn i `config.js`** (`pushPublicKey`) og
   merge. Verdien må være NØYAKTIG den samme som senderen signerer med — ellers
   avviser push-tjenesten hver eneste melding.

3. **Sett funksjonens secrets** i Supabase (Edge Functions → Secrets), eller
   med CLI-en:

   ```bash
   # `npx`, ikke `npm install -g supabase`: pakken nekter en global
   # installasjon (det samme gjelder deployjobben i release.yml).
   npx --yes supabase@2.60.0 secrets set --project-ref <ref> \
     VAPID_PUBLIC_KEY=<public> VAPID_PRIVATE_KEY=<private> \
     VAPID_SUBJECT=mailto:<en adresse som kan nås>
   ```

4. **Legg inn GitHub-secretene** `SUPABASE_ACCESS_TOKEN` (Supabase → Account →
   Access Tokens) og `SUPABASE_PROJECT_REF`. Da deployer «Release» funksjonen
   ved hver merge til `main`; uten dem hopper jobben over med en advarsel og
   releasen er fortsatt grønn (`docs/release-og-deploy.md`).

5. **Slå på `pg_cron`** i Supabase (Database → Extensions). Skjemafila
   registrerer da jobben `huskis-push-tick` selv, ett tikk i minuttet, ved neste
   migrering. Er utvidelsen ikke på, hoppes registreringen over uten å feile.

6. **Fortell `push_tick()` hvor funksjonen bor.** Adressen er ikke hemmelig og
   ligger i `app_config`; service-nøkkelen hører hjemme i Vault, som
   Resend-nøkkelen:

   ```sql
   insert into public.app_config (key, value)
   values ('push_function_url', 'https://<ref>.supabase.co/functions/v1/push-send')
   on conflict (key) do update set value = excluded.value;
   -- og i Vault (Dashboard → Project Settings → Vault):
   --   navn: push_service_key   verdi: en SECRET KEY (sb_secret_…)
   ```

   **Bruk en `sb_secret_…`-nøkkel**, ikke den gamle `service_role`-nøkkelen.
   Lag den under Settings → API Keys → Secret keys. Supabase har merket
   `anon`/`service_role` som «legacy» og faser dem ut, og nye prosjekter får dem
   ikke i det hele tatt. Funksjonen tar imot begge (`SUPABASE_SECRET_KEYS` først,
   `SUPABASE_SERVICE_ROLE_KEY` som fallback), så et gammelt prosjekt virker
   uendret — men det som settes opp NÅ bør settes opp på den nye modellen.
   Nøkkelen skal aldri inn i repoet, en PR, en logg eller frontend.

   Headerne trenger du ikke tenke på: databasen kjenner igjen hva slags nøkkel
   den har fått, og sender en `sb_secret_…` KUN på `apikey` (den er ikke et JWT
   — ligger den også på `Authorization`, avviser Supabase hele kallet med
   «Invalid JWT»), mens en gammel `service_role`-nøkkel får begge som før.

7. **Kjør «Release» én gang til, manuelt** — Actions → «Release» → «Run
   workflow» på `main`. Dette er steget som faktisk SLÅR PÅ de to tingene
   stegene over bare gjorde mulige, og det er lett å tro at det er unødvendig:

   - migreringen kjøres på nytt, og NÅ registrerer den `huskis-push-tick` i
     pg_cron. Steg 5 slår bare PÅ utvidelsen; selve registreringen skjer i
     skjemafila, altså ved neste migrering;
   - `push-send` deployes, fordi GitHub-secretene fra steg 4 nå finnes. Jobben
     hopper over seg selv med en advarsel når de mangler, og det gjorde den
     sist den kjørte.

   Merge-en i steg 2 utløser riktignok en release, men den skjer FØR steg 3–6.
   Uten denne siste runden står alt riktig satt opp uten at noe tikker.

Kontroll etterpå: `select public.push_tick();` skal gi en request-id (eller
`null` når køen er tom), og `select * from net._http_response order by id desc
limit 5;` viser hva funksjonen svarte.

## Diagnostikk: når en delingsinvitasjon ikke kommer fram

Oppsettet er verifisert i produksjon (pg_net aktivert, nøkkel i Vault,
`app_config` satt, logoen svarer 200 + `image/png`, og siste invitasjon fikk
HTTP 200 fra Resend). Når noe likevel glipper:

- `select id, invite_id, variant, net_request_id, enqueue_status, error from
  public.email_send_log order by id desc;` — `enqueue_status` sier KUN om
  forespørselen ble lagt i pg_net-køen, ikke om den ble levert.
- `select * from net._http_response order by id desc;` — det faktiske
  Resend-svaret, korrelert via `net_request_id`. pg_net rydder tabellen etter en
  stund; for varig leveringsstatus, se Resend-dashbordet.
