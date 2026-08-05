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

## Supabase Dashboard (krever Peders tilgang)

Alt her ligger i GoTrue-konfigurasjonen eller i Dashboard-maler. Ingen
tilgjengelig integrasjon kan lese eller skrive dem, så de må gjøres i
nettleseren og kontrolleres der.

- [ ] **«Change email address» mangler bekreftelseslenken.** Malen inneholder i
      dag varselteksten «Your email address was changed from … to …» — som
      hører hjemme i sikkerhetsvarselet «Email address changed», ikke her. To
      følger: `{{ .OldEmail }}` finnes ikke i denne malen og rendres som tom
      tekst, og uten `{{ .ConfirmationURL }}` kan **ingen fullføre et
      adressebytte** — `auth.updateUser({ email })` i konto-modalen lander
      aldri. Lim inn `supabase/email-templates/change-email-address.html`.
      *Verifiser:* endre e-post på en testkonto, og se at meldingen har en
      knapp som lander på `https://huskis.no` med gyldig sesjon, og at den nye
      adressen faktisk er i bruk etterpå.

- [ ] **Resten av malene stilles likt.** Authentication → Email Templates. Lim
      inn utkastene fra `supabase/email-templates/` (se README-en der for
      hvilken fil som hører til hvilket felt):
      `confirm-signup.html` → Confirm signup,
      `reset-password.html` → Reset password,
      `email-changed-notification.html` → Email address changed (kun aktuell
      hvis sikkerhetsvarsler er slått på).
      *Verifiser:* kjør registrering og «glemt passord» ende til ende på en
      testkonto, og kontroller at hver lenke peker til `https://huskis.no` og
      lander med gyldig sesjon.


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
