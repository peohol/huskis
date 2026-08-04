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

- [ ] **Egen SMTP-avsender.** Authentication → Emails → SMTP Settings. Supabases
      innebygde utsending er ratebegrenset til utviklingsbruk og deler
      avsenderdomene med alle andre prosjekter. Sett en avsender på `huskis.no`
      (samme adresse som `email_from` i `app_config`:
      `Huskis <noreply@huskis.no>`), og verifiser SPF/DKIM for domenet hos
      leverandøren.
      *Verifiser:* be om «glemt passord» på en testkonto og les
      `Return-Path`/`DKIM-Signature` i den mottatte meldingen — den skal komme
      fra `huskis.no`, ikke fra `mail.app.supabase.io`.

- [ ] **URL Configuration.** Authentication → URL Configuration.
      *Site URL* skal være `https://huskis.no`, og *Redirect URLs* skal
      inneholde KUN `https://huskis.no/**` (pluss `http://localhost:8000/**`
      hvis man tester ekte Supabase-e-post lokalt). Ingen oppføringer for de
      alternative domenene eller det pensjonerte — ingen klient kan kjøre der,
      og hver ekstra oppføring utvider listen over adresser en auth-lenke kan
      sendes til. Fasiten på hvilke verter det gjelder:
      `docs/domains-and-urls.md`.
      *Verifiser:* feltene leses av på skjermen.

- [ ] **Auth-e-postmalene** (Confirm signup / Reset password / Change email).
      Authentication → Email Templates. Malene ligger kun i Dashboard.
      Sjekklisten står i «Auth-e-postmalene» i `docs/domains-and-urls.md`, og et
      ferdig, likt-stilt utkast i `supabase/email-templates/confirm-signup.html`.
      *Verifiser:* kjør registrering, «glemt passord» og e-postendring ende til
      ende på en testkonto, og kontroller at hver lenke peker til
      `https://huskis.no` og lander med gyldig sesjon.

- [ ] **Resend-nøkkelens omfang.** Nøkkelen ligger riktig (Vault, se under), men
      Resend-dashbordet er ikke tilgjengelig herfra. Kontroller at nøkkelen har
      KUN *Sending access* og er begrenset til domenet `huskis.no` — og at
      domenet står som *Verified* under Domains.
      *Verifiser:* Resend → API Keys (kolonnen «Permission») og Resend →
      Domains (status «Verified»).

## Gjenoppstått rad i produksjon (én gruppe) — krever en beslutning

Kontrollert mot produksjon 2026-08-04 med kollisjonsspørringen under: det finnes
fortsatt **nøyaktig én** kollisjon, den samme gruppen som før (gravlagt
2026-07-27, gjenoppstått seks minutter senere).

**Men raden er tatt i bruk igjen.** Etter gjenoppstandelsen er det opprettet
fire lister og fem listepunkter i gruppen, alle med innhold, og alt sammen ble
sist endret 2026-08-03. Dette er altså ikke en tom ghost — det er en uke med
ekte brukerinnhold, nøyaktig det tilfellet `guard_object_insert()` bevisst lot
være å rydde i.

Å slette gruppen «på nytt i appen» ville derfor kastet innholdet. Valget er
brukerens, ikke en agents, og det står mellom to veier:

- **Behold innholdet.** Fjern den foreldede gravsteinen i stedet — da er
  kollisjonen borte, og raden lever videre som en helt vanlig gruppe:
  `delete from public.tombstones where resource_type = 'group' and resource_id = '<id>';`
  Merk at gravsteiner ellers aldri slettes (`docs/trash.md`); dette er et
  engangsunntak for en rad som beviselig er i bruk.
- **Slett den likevel.** Gjør det som eieren i appen (søppelkasse → tøm), ikke
  med en direkte `DELETE` mot produksjon. Innholdet er borte for godt.

Id-en står ikke her — hent den ut selv med spørringen under, så beslutningen
tas mot ferske tall og ikke mot et notat.

- [ ] Bestem hvilken vei, utfør den, og kjør kollisjonsspørringen på nytt. Den
      skal gi null rader:

      ```sql
      select t.resource_type, t.resource_id from public.tombstones t
        where (t.resource_type = 'universe' and exists (select 1 from public.universes x where x.id = t.resource_id))
           or (t.resource_type = 'group'    and exists (select 1 from public.groups    x where x.id = t.resource_id))
           or (t.resource_type = 'card'     and exists (select 1 from public.cards     x where x.id = t.resource_id))
           or (t.resource_type = 'item'     and exists (select 1 from public.items     x where x.id = t.resource_id));
      ```

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
