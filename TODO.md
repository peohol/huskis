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

## Fase 2 — klient/UI (ny økt starter her)

- [ ] **Auth-UI**: registrering (e-post + passord + «sjekk innboksen»-visning),
      innlogging, glemt passord (`resetPasswordForEmail`), logg ut; erstatter
      mønster-låsen (behold gammel flyt som fallback bak feature-flagg til alt
      er verifisert)
- [ ] **Sesjon**: `supabase.auth.onAuthStateChange`; husket innlogging via
      Supabase-sesjonen (erstatter `mine-lister-auth`)
- [ ] **Synk-motor v2**: hent `get_my_doc()` → gjenbruk `applyDoc`-maskineriet
      (doc-fasongen er bevisst lik); skriv endringer som rad-CRUD med
      `ts/org`-stempling (serveren håndhever LWW); realtime
      `postgres_changes` + poll-fallback; offline-kø
- [ ] **Mount-rendring**: delte grupper/lister tegnes inn i mottakerens valgte
      forelder (`mount.parent`/`mount.pos`); «umontert» deling (parent = null)
      må få en «velg plassering»-dialog; delte objekter merkes visuelt
      (delt-ikon + ev. eierens navn + låst-indikator)
- [ ] **Delings-UI**: «Del …»-valg på univers/gruppe/liste (kun eier):
      inviter på e-post, se medlemmer/ventende (`get_members`), kaste ut,
      lås/åpne; innboks for mottatte invitasjoner (aksepter med
      plasseringsvalg / avslå)
- [ ] **Søppel-semantikk for delinger**: skjul/deaktiver «slett»-knappen på
      selve det delte objektet (share-roten) for mottakere — deres handling
      der er «forlat deling» (mount i søppel `membership.trashed`, tømming →
      `leave_share`). Innhold UNDER det delte objektet slettes som vanlig, og
      siden `trashed` er felles ser alle sletting/gjenoppretting samtidig
      (vis gjerne hvem/at det er delt). Eiers sletting av selve objektet som
      i dag (trashed → tøm = hard delete m/ advarsel om at delingen ryker for
      alle). Serveren håndhever allerede reglene (RLS + trashed-vakter)
- [ ] **Migreringsflyt**: ved første innlogging med lokale data → tilby
      `import_doc(docFromState())`; behold localStorage-kopi til bekreftet
- [ ] **Verifisering**: Playwright mot lokal server med to innloggede
      testbrukere (Supabase-stub eller test-prosjekt), desktop + mobil,
      screenshots; deretter oppdater CLAUDE.md + denne fila
- [ ] **Opprydding (fase 3)**: pensjoner mønster-lås, `lists`-tabellen og
      `get_list`/`save_list` når fase 2 har kjørt stabilt

## Kjente beslutninger (ikke spør på nytt — se arkitekturdok for hvorfor)

- Mottaker kan ALDRI slette share-roten (trashe/hardslette) — kun forlate
  (leave_share). Innhold UNDER en deling slettes fritt, og sletting/
  gjenoppretting er felles (gjelder alle). Eier-sletting av objektet er reell
- Lås gjelder nedover i hierarkiet; eieren kan alltid redigere selv
- Mottakere flytter delte objekter via mount, aldri eierens plassering
- Import-id-er: `md5(uid ':' gammel_id) → uuid` (idempotent per bruker)
- `cards` i databasen = «lister» i UI-et (samme navnebruk som app.js)
