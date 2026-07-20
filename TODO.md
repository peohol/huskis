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

## Skjema-endring: avkryssing av listepunkter (`items.done`)

Design-overhalingen la til **avkryssing av listepunkter** (gjort/ikke gjort). Feltet
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
**ansvarlig for listepunkter** i delte lister (`items.responsible`, FK til
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
på både listepunkter og lister (`items.start_at`/`due_at`, `cards.start_at`/
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
listepunkter under nivå-1-overskrifter. En kategori lagres SOM et listepunkt
(`items.is_cat = true`); leaf-listepunkter peker på den via `items.cat_id`
(self-FK, `on delete set null`, `deferrable initially deferred` for
import-rekkefølge), og en kategori kan låse tidene til listepunktene sine
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
      avviste hver kort-/listepunkt-insert/update (manglende kolonner) og
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

## Skjema-endring: lukketilstand for lister (`cards.collapsed`)

Listekollaps-runden (se `docs/design-system.md` + `docs/drag-and-drop.md`) la til
**rullgardin-kollaps** av lister: klikk på korthodet folder listen sammen, og
lukketilstanden (`cards.collapsed`, boolean) lagres og synkes som annet innhold.
Rir på innholds-registeret (`ts`/`org`), som `lock_times`/`responsible`.
`supabase/users-and-sharing.sql` er oppdatert idempotent (`add column if not
exists collapsed …`, LWW-triggeren, `get_my_doc`, `import_doc`); mock-backenden
speiler det; klienten pusher/leser feltet via samme rad-CRUD (`cleanCard`/
`mergeCardScalar`/`insertPayload`/`updatePayload`). Implementert og verifisert i
nettleser (mock-backend, desktop + mobil).

- [ ] **Kjør «Supabase DB-oppsett»-workflowen** slik at `cards.collapsed`-kolonnen
      (+ LWW-trigger/`get_my_doc`/`import_doc`) kommer på ekte Supabase. Uten den
      avviser PostgREST hver kort-insert/-update (manglende kolonne) og
      kontomodus-synken for lister brytes — kjør den FØR denne runden merges til
      produksjon (samme lærdom som kategori-migreringen).

## Skjema-endring: lukketilstand for kategorier (`items.collapsed`)

Kategori-ekstraherings-runden (se `docs/drag-and-drop.md` + `docs/design-system.md`)
la til **rullgardin-kollaps av kategorier** (samme som lister). En kategori lagres
som et element, så feltet bor på `items.collapsed` (boolean; kun meningsfullt for
`is_cat`-rader — leaf-elementer holder det false). Rir på innholds-registeret
(`ts`/`org`), som `is_cat`/`lock_times`. `supabase/users-and-sharing.sql` er
oppdatert idempotent (`add column if not exists collapsed …` på `items`, item-LWW-
triggeren, `get_my_doc`, `import_doc`); mock-backenden speiler det; klienten pusher/
leser feltet via samme rad-CRUD (`cleanItem`/`mergeItem`/`insertPayload`/
`updatePayload`). Implementert og verifisert i nettleser (mock-backend, desktop +
mobil).

- [ ] **Kjør «Supabase DB-oppsett»-workflowen** slik at `items.collapsed`-kolonnen
      (+ item-LWW-trigger/`get_my_doc`/`import_doc`) kommer på ekte Supabase. Uten
      den avviser PostgREST hver element-insert/-update (manglende kolonne) og
      kontomodus-synken for elementer brytes — kjør den FØR denne runden merges til
      produksjon (samme lærdom som kategori-/`cards.collapsed`-migreringene).

## Skjema-/logikk-endring: hierarkiske rettigheter + invitasjonspolicy (`invite_policy`)

Rettighetsrunden (se `docs/rettigheter-og-deling.md`) generaliserte «eier» til
**oppretter/eier-hierarki** (privilegerte administratorer), skilte **posisjon** fra
**innholdslås**, og innførte en **tretilstands invitasjonspolicy**. `supabase/users-
and-sharing.sql` er oppdatert idempotent:

- Ny kolonne `invite_policy text not null default 'inherit'` (+ CHECK) på
  universes/groups/cards. Eksisterende rader får `inherit` ved kolonne-tillegg →
  effektiv **tillat** (dagens oppførsel bevares).
- Nye/omskrevne SECURITY DEFINER-hjelpere (`can_admin_resource`, `can_edit_content`,
  `can_reorder_in_parent`, `effective_lock_source`, `can_manage_lock_exception`,
  `effective_invite_policy`, `can_invite_to`, `can_manage_invite_policy` m.fl.),
  omskrevne `*_before_update`-vakter (feltnivå-autorisasjon), oppdaterte RLS-
  `update`-policyer (innhold ELLER posisjon), oppdaterte RPC-er
  (`create_share_invite`/`revoke_share_invite`/`revoke_share`/`set_locked`/
  `set_unlocked`), ny RPC `set_invite_policy`, `get_members` med `viewer`-flagg +
  policy + per-invitasjon `by`/`by_name`/`mine`, og `get_my_doc` som eksponerer
  `invitePolicy`. Mock-backenden speiler alt; klient-UI + tester er på plass.

- [x] **«Supabase DB-oppsett»-workflowen kjørt** (run 29703783105,
      workflow_dispatch på grenen `claude/hierarchical-permissions-sharing-3hzg61`,
      conclusion `success`, 2026-07-19) — `invite_policy`-kolonnene + de omskrevne
      funksjonene/policyene/vaktene er nå på ekte Supabase. Migreringen er idempotent
      (testet med dobbel kjøring) og bakoverkompatibel: den bevarer alle eksisterende
      data (opprettere, låser, delinger, mounts), gir effektiv invitasjonspolicy
      «tillat», og den gamle klienten på `main` er upåvirket (sender ikke
      `invite_policy`/`locked`/`unlocked` i rad-oppdateringer). Kjørt FØR merge, som
      for kategori-/`collapsed`-migreringene.

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

Den profilerte e-posten (branded HTML + text/plain, PNG-logo, escaping,
`url_encode`, Vault-first, `email_send_log`) ligger i `send_invite_email()` i
`supabase/users-and-sharing.sql` (kjøres av «Supabase DB-oppsett»-workflowen).
Gjenstår manuelt:

- [ ] Supabase → Database → Extensions: aktiver **pg_net**
- [ ] **Resend**: domenet `huskis.no` er verifisert, sending aktivert, region
      `eu-west-1`, åpnings-/klikksporing AV. Opprett en API-nøkkel med KUN
      *Sending access*, begrenset til domenet `huskis.no`.
- [ ] **Legg Resend-nøkkelen i Supabase Vault** under secret-navnet
      `resend_api_key`. Nøkkelen skal ALDRI skrives til Git, PR, logger eller
      chat. To måter:

      **A. Anbefalt (produksjon):** la Claude Code / Supabase-integrasjonen
      opprette hemmeligheten direkte i Vault (secret-navn `resend_api_key`), så
      selve nøkkelverdien aldri passerer gjennom en fil eller terminal.

      **B. Manuelt via dashboard:** Supabase Dashboard → **Vault** → **New
      secret**:
      - **Name:** `resend_api_key`
      - **Secret:** (lim inn Resend-nøkkelen her — feltet er kryptert, ikke
        versjonert)
      - **Description:** `Resend sending API key, begrenset til huskis.no`

      (Kommandolinje-varianten `select vault.create_secret(...)` finnes, men
      krever psql-variabler for å unngå å eksponere nøkkelen — bruk A eller B
      i stedet for å slippe det.)
- [ ] Legg **ikke-hemmelig** konfig i `public.app_config` (Supabase SQL editor
      — dette er trygt å lime inn, ingen hemmelighet):
      ```sql
      insert into public.app_config(key, value) values
        ('email_from', 'Huskis <noreply@huskis.no>'),
        ('app_url',    'https://www.huskis.no/')
      on conflict (key) do update set value = excluded.value;
      ```
      Triggeren leser nøkkelen fra Vault først; app_config-nøkkelen er KUN en
      fallback for det lokale, hermetiske test-miljøet (som ikke har Vault) —
      legg derfor IKKE `resend_api_key` i app_config i produksjon. Uten en
      nøkkel gjør triggeren ingenting (delingen fungerer via appen som før).
      `app_config` er RLS-låst uten policyer (revoke fra public/anon/
      authenticated) → kun SECURITY DEFINER-triggeren leser verdiene.
- [ ] Hvis en tidligere `resend_api_key` allerede ligger i `public.app_config`:
      slett den etter at Vault-oppsettet er verifisert (`delete from
      public.app_config where key = 'resend_api_key';`) — nøkkelen skal bo i
      Vault, ikke i en tabell.
- [ ] Etter deploy: verifiser at `https://www.huskis.no/assets/email/huskis-logo.png`
      returnerer 200 + `image/png` uten innlogging/preview-beskyttelse.
- [ ] Diagnostikk ved behov:
      - `select id, invite_id, variant, net_request_id, enqueue_status, error
        from public.email_send_log order by id desc;` — `enqueue_status` sier KUN
        om forespørselen ble lagt i pg_net-køen (`enqueued`) eller feilet synkront
        før kølegging (`enqueue_error`); det betyr **ikke** accepted/delivered.
      - `select * from net._http_response order by id desc;` — det FAKTISKE
        Resend-HTTP-svaret (status 2xx/4xx/5xx), korrelert via `net_request_id`.
        pg_net rydder denne tabellen etter en stund, så det er kortvarig
        diagnostikk. For varig leveringsstatus: sjekk Resend-dashbordet (eller
        vurder Resend-webhooks som en senere forbedring).

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
