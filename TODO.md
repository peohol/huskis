# TODO — brukere, e-postregistrering og deling

Løypekart for overgangen fra mønster-lås + felles synk-doc til ekte
brukerkontoer med deling. Full design: [docs/arkitektur-brukere-deling.md](docs/arkitektur-brukere-deling.md).
Oppdater denne fila etter hvert som ting fullføres, så nye økter kan
plukke opp tråden.

## Fase 1 — grunnmur i databasen (✅ ferdig)

- [x] Arkitektur valgt og dokumentert (`docs/arkitektur-brukere-deling.md`):
      Supabase Auth + relasjonelle tabeller med RLS, deling via
      invitasjon → aksept → mount (memberships), eier-lås, gravsteiner,
      server-side felt-nivå LWW (samme registre som dagens synk-doc)
- [x] `supabase/users-and-sharing.sql` (idempotent migrering): profiles +
      auth-triggere, universes/groups/cards/items, memberships,
      share_invites, tombstones, tilgangs-/vakt-/LWW-triggere, RLS,
      RPC-er (`create/accept/decline/revoke_share_invite`, `revoke_share`,
      `leave_share`, `set_locked`, `get_members`, `get_my_doc`,
      `import_doc`), grants, realtime-publikasjon
- [x] Hermetisk testsuite (`supabase/tests/`, ren PostgreSQL): 70 sjekker
      grønne — RLS-isolasjon, delingsflyt alle nivåer, låsing, utkastelse,
      LWW, import-idempotens, gravsteiner, anon-avvisning; migreringen
      kjørt dobbelt (idempotens)
- [x] GitHub-Actions-workflowen «Supabase DB-oppsett» kjører nå begge
      SQL-filene
- [x] **Migreringen kjørt mot Supabase**: run 29117524478 (db-setup.yml,
      grenen `claude/user-registration-sharing-arch-1ly3io`) — grønn,
      «Kjør SQL-filene mot Supabase»-steget fullførte på 19s. To runder
      trengtes: (1) secreten `SUPABASE_DB_URL` manglet først (run
      29099343073), (2) direct-connection-adressen
      (`db.<ref>.supabase.co:5432`) er IPv6-only og GitHub Actions-
      runnere har ikke IPv6 → «Network is unreachable» (run 29117143019).
      Løst ved å bytte secreten til Supabase sin **Session pooler**-
      adresse (`aws-0-<region>.pooler.supabase.com:5432`, IPv4-
      kompatibel, brukernavn `postgres.<prosjekt-ref>`). **Husk denne
      pooler-adressen ved evt. fremtidige kjøringer/dokumentasjon** —
      direct connection vil feile fra GitHub Actions med mindre Supabase
      sin IPv4-tilleggstjeneste er kjøpt.

## Skjema-endring: avkryssing av elementer (`items.done`)

Design-overhalingen la til **avkryssing av elementer** (gjort/ikke gjort). Feltet
`items.done` rir på det eksisterende innholds-registeret (`ts`/`org`), som
`text`/`trashed`. `supabase/users-and-sharing.sql` er oppdatert idempotent
(`alter table … add column if not exists done …`, LWW-trigger, `get_my_doc`,
`import_doc`).

- [x] **«Supabase DB-oppsett»-workflowen kjørt** (run #4 på `main`,
      workflow_dispatch, conclusion `success`, 2026-07-12) — `items.done`-
      kolonnen (+ LWW-trigger/`get_my_doc`/`import_doc`) er nå på ekte Supabase,
      så avkryssing persisteres i kontomodus.

## Skjema-endring: navn + ansvarlig (`display_name` / `items.responsible`)

Brukernavn (fornavn + etternavn ved registrering → `profiles.display_name`) og
**ansvarlig for elementer** i delte lister (`items.responsible`, FK til
`profiles`, `on delete set null`, rir på innholds-registeret). `supabase/users-
and-sharing.sql` er oppdatert idempotent (`add column if not exists responsible`,
LWW-trigger, `get_my_doc`, `import_doc`) og har en **engangs-seed** som setter
navnene «Karin Falch» / «Peder Holman» på de to eksisterende kontoene (kun hvis
navnet fortsatt er auto-standarden, så re-kjøring ikke overskriver). Klient-UI
(registrering med navn, initialer/navn i del-modalen, ansvarsknapp/-popover) er
implementert og verifisert i nettleser (mock-backend) — se `docs/accounts.md`.

- [x] **«Supabase DB-oppsett»-workflowen kjørt** (run #5, workflow_dispatch på
      grenen `claude/user-names-responsibility-2nbd0z`, conclusion `success`,
      2026-07-13) — `items.responsible`-kolonnen (+ LWW/`get_my_doc`/
      `import_doc`) og navne-seeden («Karin Falch» / «Peder Holman») er nå på
      ekte Supabase.

## Skjema-endring: tidsplan + liste-ansvarlig (`start_at`/`due_at`/`lock_times`/`cards.responsible`)

Innstillings-/tidsplan-runden (se `docs/scheduling.md`) la til **start/frist**
på både elementer og lister (`items.start_at`/`due_at`, `cards.start_at`/
`due_at` — text, lokal vegg-tid), **tids-lås** på lister (`cards.lock_times`,
boolean) og **ansvarlig for hele listen** (`cards.responsible`, FK til
`profiles`, `on delete set null`). Alt rir på innholds-registeret (`ts`/`org`).
`supabase/users-and-sharing.sql` er oppdatert idempotent (`add column if not
exists`, LWW-triggerne, `get_my_doc`, `import_doc`); mock-backenden speiler det.

- [x] **«Supabase DB-oppsett»-workflowen kjørt** (run 29356822695, `main`,
      workflow_dispatch, conclusion `success`, 2026-07-14) — `cards.start_at`/
      `due_at`/`lock_times`/`responsible` og `items.start_at`/`due_at` er nå på
      ekte Supabase.

## Skjema-endring: kategorier (`items.cat_id`/`is_cat`/`lock_times`)

Kategori-runden (se `docs/data-model.md` + `docs/drag-and-drop.md`) grupperer
elementer under nivå-1-overskrifter. En kategori lagres SOM et element
(`items.is_cat = true`); leaf-elementer peker på den via `items.cat_id`
(self-FK, `on delete set null`, `deferrable initially deferred` for
import-rekkefølge), og en kategori kan låse tidene til elementene sine
(`items.lock_times`, som lister). `cat_id` følger posisjonsregisteret (som
`card_id`); `is_cat`/`lock_times` innholds-registeret. `supabase/users-and-
sharing.sql` er oppdatert idempotent (`add column if not exists`, LWW-triggeren,
`get_my_doc`, `import_doc`); mock-backenden speiler det. Verifisert i nettleser
(Playwright, default-modus + synk-doc-round-trip via `docFromState`/
`mergeStates`/`canonical`).

- [x] **«Supabase DB-oppsett»-workflowen kjørt** (run 29356822695, `main`,
      workflow_dispatch, conclusion `success`, 2026-07-14) — `items.cat_id`/
      `is_cat`/`lock_times` er nå på ekte Supabase. Disse to migreringene sto
      igjen mens `accounts: true` allerede var live i produksjon, så PostgREST
      avviste hver kort-/element-insert/update (manglende kolonner) og
      kontomodus-synken var brutt — se PR-en for denne runden.

## Skjema-endring: unntak fra arvet lås (`universes/groups/cards.unlocked`)

Hierarkisk deling/låsing-runden (se `docs/arkitektur-brukere-deling.md` +
`docs/accounts.md`) la til et **unntak** fra arvet lås: et objekt under et låst
univers/gruppe er automatisk låst for andre, men eieren kan sette `unlocked =
true` for nettopp det objektet så det likevel kan redigeres (og alt under det,
med mindre et lavere nivå låses på nytt). `locked` og `unlocked` er gjensidig
utelukkende per rad (`set_locked`/`set_unlocked` holder dem det). `supabase/
users-and-sharing.sql` er oppdatert idempotent (`add column if not exists
unlocked …` på universes/groups/cards, `set_unlocked`-RPC + grant, `can_edit_*`
oppdatert til nærmeste-eksplisitt-tilstand-semantikk, eier-vakt i BEFORE UPDATE,
`get_my_doc` eksponerer `unlocked`); mock-backenden speiler det. Klient-UI (auto-
lås-melding + «Gjør unntak» i del-/innstillingsmodalen, arvede medlemmer i
delingslisten) er implementert og verifisert i nettleser (mock-backend, to/tre
testbrukere, desktop + mobil) — se `docs/accounts.md`.

- [x] **«Supabase DB-oppsett»-workflowen kjørt** (run 29360860503,
      workflow_dispatch på grenen `claude/hierarchical-sharing-permissions-
      1n7w49`, conclusion `success`, 2026-07-14) — `unlocked`-kolonnene +
      `set_unlocked` (+ oppdatert `can_edit_*`/`get_my_doc`) er nå på ekte
      Supabase, så unntaks-knappen fungerer i kontomodus.

## Manuelle steg (krever dashboard-tilgang — Peder)

- [x] ~~GitHub → Settings → Secrets and variables → Actions: legg inn
      secreten `SUPABASE_DB_URL`~~ — gjort (se merknad over ang. pooler-
      adresse vs. direct connection)
- [ ] Supabase → Authentication → URL Configuration: sett **Site URL** +
      **Redirect URLs** til appens adresse (bekreftelseslenken peker dit)
- [ ] Verifiser at **Confirm email** står PÅ (Authentication → Sign In / Up;
      det er standard)
- [ ] (Før reell bruk) egen **SMTP**-avsender — innebygd utsending er
      ratebegrenset til utviklingsbruk
- [ ] (Valgfritt) tilpass e-postmalen for bekreftelse (norsk tekst)

## E-postvarsel ved deling (siste runde) — manuell konfig gjenstår

Delingsinvitasjoner sender nå e-post via en `share_invites`-insert-trigger
(`send_invite_email`, `supabase/users-and-sharing.sql`) som POSTer til Resend
med pg_net. Uregistrerte får en `?signup=<e-post>`-lenke til registreringssiden;
registrerte får en åpne-appen-lenke (kun hvis e-postvarsel er PÅ). Klienten er
ferdig og verifisert mot mock-backend; selve e-postutsendingen krever at Peder:

- [ ] Supabase → Database → Extensions: aktiver **pg_net**
- [ ] Opprett en **Resend**-konto, verifiser et avsenderdomene (eller bruk
      `onboarding@resend.dev` til egen e-post for test), hent en **API-nøkkel**
- [ ] Legg nøkkelen + avsender + app-URL i `public.app_config` (Supabase SQL
      editor):
      ```sql
      insert into public.app_config(key, value) values
        ('resend_api_key', 're_...'),
        ('email_from',      'Huskis <noreply@huskis.no>'),
        ('app_url',         'https://huskis.no/')
      on conflict (key) do update set value = excluded.value;
      ```
      Uten `resend_api_key` gjør triggeren ingenting (delingen fungerer via
      appen som før). `app_config` er RLS-låst uten policyer → kun triggeren
      leser nøklene, aldri klienten.

## Fase 2 — klient/UI (✅ implementert — se `docs/accounts.md`)

Alt under er implementert i `app.js` og verifisert i nettleser (Playwright) mot
`mock-backend.js` (`?mock=1`). Appen kjører nå KUN på kontomodus — mønster-låsen
og synk-doc v1 er fjernet (setup.sql pensjonerer `lists`/`get_list`/`save_list`).

- [x] **Auth-UI**: registrering (e-post + passord + «sjekk innboksen»-visning),
      innlogging, glemt passord (`resetPasswordForEmail`), logg ut
- [x] **Sesjon**: `supabase.auth.onAuthStateChange`; husket innlogging via
      Supabase-sesjonen
- [x] **Synk-motor v2**: `get_my_doc()` → 3-veis fletting (base-snapshot) →
      rad-CRUD med `ts/org`-stempling (serveren håndhever LWW); realtime
      `postgres_changes` + poll-fallback; per-bruker offline-buffer
- [x] **Mount-rendring**: delte grupper/lister tegnes inn i mottakerens valgte
      forelder (`mount.parent`/`mount.pos`); «umontert» deling får «velg
      plassering»-dialog; delt-/låst-merker på univers/gruppe/liste
- [x] **Delings-UI**: «Del …» (🔗, kun eier): inviter på e-post, se medlemmer/
      ventende (`get_members`), kaste ut, lås/åpne; innboks for mottatte
      invitasjoner (aksepter med plasseringsvalg / avslå)
- [x] **Søppel-semantikk for delinger**: mottakerens «slett» på share-roten =
      mount i søppel (`membership.trashed`), tømming → `leave_share`. Innhold
      UNDER slettes som vanlig (felles). Serveren håndhever reglene
- [x] **Migreringsflyt**: ved første innlogging med tom konto + lokale data →
      tilby `import_doc(legacyFlatDoc())`; localStorage-kopi beholdes
- [x] **Verifisering**: Playwright, to innloggede testbrukere via mock-backend,
      desktop + mobil, screenshots; CLAUDE.md/docs/TODO.md oppdatert

### Gjenstår før produksjon (Peder / manuelt)

- [ ] Supabase → Authentication → URL Configuration: Site URL + Redirect URLs
      (jf. de manuelle stegene over)
- [ ] Verifiser «Confirm email» PÅ; ev. egen SMTP
- [ ] Kjør **«Supabase DB-oppsett»**-workflowen på nytt slik at setup.sql (v1-
      pensjonering) og e-post-triggeren i users-and-sharing.sql kommer på ekte
      Supabase
- [x] **Opprydding: mønster-lås + synk-doc v1 fjernet** — pattern-lock-UI/JS,
      v1 synk-motor (`get_list`/`save_list`, `syncCycle`) og `accountsMode`-
      flagget er borte; `config.js` har ikke lenger `accounts`-flagget; setup.sql
      dropper `lists`-tabellen + RPC-ene

## Kjente beslutninger (ikke spør på nytt — se arkitekturdok for hvorfor)

- Mottaker kan ALDRI slette share-roten (trashe/hardslette) — kun forlate
  (leave_share). Innhold UNDER en deling slettes fritt, og sletting/
  gjenoppretting er felles (gjelder alle). Eier-sletting av objektet er reell
- Lås gjelder nedover i hierarkiet; eieren kan alltid redigere selv
- Mottakere flytter delte objekter via mount, aldri eierens plassering
- Import-id-er: `md5(uid ':' gammel_id) → uuid` (idempotent per bruker)
- `cards` i databasen = «lister» i UI-et (samme navnebruk som app.js)
