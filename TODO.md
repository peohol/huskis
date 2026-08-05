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
