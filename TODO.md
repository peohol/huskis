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
- [x] Hermetisk testsuite (`supabase/tests/`, ren PostgreSQL): 57 sjekker
      grønne — RLS-isolasjon, delingsflyt alle nivåer, låsing, utkastelse,
      LWW, import-idempotens, gravsteiner, anon-avvisning; migreringen
      kjørt dobbelt (idempotens)
- [x] GitHub-Actions-workflowen «Supabase DB-oppsett» kjører nå begge
      SQL-filene
- [x] Migreringen kjørt mot Supabase via Actions

## Manuelle steg (krever dashboard-tilgang — Peder)

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
- [ ] **Søppel-semantikk for delinger**: mottakers sletting av delt objekt →
      mount i søppel (`membership.trashed`), tømming → `leave_share`;
      eiers sletting som i dag (trashed → tøm = hard delete m/ advarsel om
      at delingen ryker for alle)
- [ ] **Migreringsflyt**: ved første innlogging med lokale data → tilby
      `import_doc(docFromState())`; behold localStorage-kopi til bekreftet
- [ ] **Verifisering**: Playwright mot lokal server med to innloggede
      testbrukere (Supabase-stub eller test-prosjekt), desktop + mobil,
      screenshots; deretter oppdater CLAUDE.md + denne fila
- [ ] **Opprydding (fase 3)**: pensjoner mønster-lås, `lists`-tabellen og
      `get_list`/`save_list` når fase 2 har kjørt stabilt

## Kjente beslutninger (ikke spør på nytt — se arkitekturdok for hvorfor)

- Eier-sletting er reell for alle; mottaker-sletting = forlate delingen
- Lås gjelder nedover i hierarkiet; eieren kan alltid redigere selv
- Mottakere flytter delte objekter via mount, aldri eierens plassering
- Import-id-er: `md5(uid ':' gammel_id) → uuid` (idempotent per bruker)
- `cards` i databasen = «lister» i UI-et (samme navnebruk som app.js)
