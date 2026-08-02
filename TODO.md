# TODO — det som fortsatt gjenstår

Kun oppgaver som ikke er gjort på dagens `main`. Alt annet — hvilke migreringer
som er kjørt, hvilke funksjoner som finnes og hvordan de virker — leses i
`supabase/users-and-sharing.sql`, `docs/` og git-historikken.

Skjemaet trenger ingen manuell kjøring: «Release»
(`.github/workflows/release.yml`) kjører `supabase/setup.sql` +
`supabase/users-and-sharing.sql` mot produksjon ved hver push til `main`, og
slipper først frontenden ut på Vercel etter at smoke-testen er grønn. Se
`docs/release-og-deploy.md`.

## Supabase Dashboard (krever Peders tilgang)

- [ ] Verifiser at **Confirm email** står PÅ (Authentication → Sign In / Up —
      det er standard).
- [ ] Egen **SMTP**-avsender før reell bruk; Supabases innebygde utsending er
      ratebegrenset til utviklingsbruk.
- [ ] **Authentication → URL Configuration**: *Site URL* = `https://huskis.no`,
      og fjern eventuelle *Redirect URLs* for `www.huskis.no` /
      `huskis.vercel.app` — de alternative domenene 308-redirecter nå til det
      kanoniske originet og kjører aldri en klient. Se «Supabase Auth: URL
      Configuration» i `docs/domains-and-urls.md`.
- [ ] Auth-e-postmalene (Confirm signup / Reset password / Change email):
      sjekkliste i «Auth-e-postmalene» i `docs/domains-and-urls.md`, og et
      ferdig, likt-stilt utkast i `supabase/email-templates/confirm-signup.html`.
      Malene ligger i Dashboard og kan ikke leses eller skrives herfra.

## E-postvarsel ved deling (Resend)

Klientsiden og databasetriggeren (`send_invite_email` i
`supabase/users-and-sharing.sql`) er ferdige. Uten nøkkel gjør triggeren
ingenting — delingen fungerer som før i appen. Gjenstår manuelt:

- [ ] Supabase → Database → Extensions: aktiver **pg_net**.
- [ ] **Resend**: opprett en API-nøkkel med KUN *Sending access*, begrenset til
      domenet `huskis.no`.
- [ ] Legg nøkkelen i **Supabase Vault** under secret-navnet `resend_api_key`
      (Dashboard → Vault → New secret). Nøkkelen skal ALDRI skrives til Git,
      PR-er, logger eller chat. `app_config` er kun fallback for det lokale,
      hermetiske testmiljøet — legg den ikke der i produksjon.
- [ ] Legg ikke-hemmelig konfig i `public.app_config` (trygt å lime inn):

      ```sql
      insert into public.app_config(key, value) values
        ('email_from', 'Huskis <noreply@huskis.no>'),
        ('app_url',    'https://huskis.no/')
      on conflict (key) do update set value = excluded.value;
      ```

      `app_url` er kanonisk, uten `www` — se `docs/domains-and-urls.md`.
- [ ] Ligger en gammel `resend_api_key` i `public.app_config`, slett den når
      Vault-oppsettet er verifisert:
      `delete from public.app_config where key = 'resend_api_key';`
- [ ] Verifiser at `https://huskis.no/assets/email/huskis-logo.png` svarer 200 +
      `image/png` uten innlogging.

Diagnostikk når en invitasjon ikke kommer fram:

- `select id, invite_id, variant, net_request_id, enqueue_status, error from
  public.email_send_log order by id desc;` — `enqueue_status` sier KUN om
  forespørselen ble lagt i pg_net-køen, ikke om den ble levert.
- `select * from net._http_response order by id desc;` — det faktiske
  Resend-svaret, korrelert via `net_request_id`. pg_net rydder tabellen etter en
  stund; for varig leveringsstatus, se Resend-dashbordet.

## Gjenoppstått rad i produksjon (én gruppe)

`guard_object_insert()` hindrer NYE innsettinger av en gravlagt id, men rydder
bevisst ikke i rader som allerede var gjenoppstått da vakten kom — å slette rader
i en migrering er irreversibelt, og en av dem kan være noe brukeren har tatt i
bruk igjen. Kontrollert mot produksjon 2026-08-02: **én gruppe** ligger fortsatt
både i `tombstones` (slettet 2026-07-27) og som aktiv rad.

- [ ] Slett gruppen på nytt i appen — denne gangen blir den borte for godt.
      Finn kollisjonene med:

      ```sql
      select t.resource_type, t.resource_id from public.tombstones t
        where (t.resource_type = 'universe' and exists (select 1 from public.universes x where x.id = t.resource_id))
           or (t.resource_type = 'group'    and exists (select 1 from public.groups    x where x.id = t.resource_id))
           or (t.resource_type = 'card'     and exists (select 1 from public.cards     x where x.id = t.resource_id))
           or (t.resource_type = 'item'     and exists (select 1 from public.items     x where x.id = t.resource_id));
      ```

## Vercel

- [ ] Bekreft 308-redirecten mot ekte produksjon etter neste deploy (utgående
      HTTPS er sperret i utviklingsmiljøet, så den er ikke sjekket live):

      ```bash
      curl -sI "https://www.huskis.no/en/side?a=1"      # HTTP/2 308 + Location: https://huskis.no/en/side?a=1
      curl -sI "https://huskis.vercel.app/?code=x"      # HTTP/2 308 + Location: https://huskis.no/?code=x
      curl -sI "https://huskekurv.vercel.app/"          # HTTP/2 308 + Location: https://huskis.no/
      ```

      Reglene selv ligger i `vercel.json` og deployes med appen — se
      «Redirect til det kanoniske originet» i `docs/domains-and-urls.md`.
