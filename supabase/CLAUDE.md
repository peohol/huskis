# CLAUDE.md — supabase/

`users-and-sharing.sql` ER databasen: tabeller, RLS-policyer, triggere, vakter
og RPC-er i én idempotent fil. Det finnes ingen migreringsmappe og ingen
versjonerte migreringsfiler — en endring gjøres på riktig sted i fila, og hele
fila kjøres på nytt. `setup.sql` pensjonerer den gamle v1-modellen og er også
idempotent.

`.github/workflows/db-setup.yml` kjører begge filene mot produksjon ved push til
`main` (path-filtrert til SQL-filene) og manuelt fra Actions-fanen. Skjemaet
migreres altså omtrent samtidig som klienten deployes.

## Regler

- **Idempotens er et krav.** `create or replace function`, `add column if not
  exists`, `drop policy if exists` før `create policy`. Testsuiten kjører fila
  to ganger for å bevise det, og workflowen prøver på nytt ved feil — begge
  deler forutsetter at re-kjøring er trygt.
- **Skjemaendringer skal være additive.** Databasen migreres mens den forrige
  klienten fortsatt kjører: nye kolonner må ha default eller være nullable, og
  en kolonne fjernes tidligst en runde etter at klienten sluttet å bruke den.
- **Skjemaet og klienten må følges ad.** Skriver klienten et felt som ikke
  finnes, avviser PostgREST hver skriving og synken stopper — legg
  skjemaendringen i SAMME PR som klientendringen som trenger den.
- **Autorisasjon hører hjemme her.** Vurder RLS-policyer, `BEFORE UPDATE`-vakter,
  capability-funksjonene og RPC-ene som ett hele. En ny `security definer`-
  funksjon omgår RLS og må selv sjekke rettighetene.
- **Speil regelendringer i `mock-backend.js`** i samme endring — nettlesertestene
  kjører mot den, ikke mot ekte Supabase.
- **DDL kjører mot en levende database** som klientene poller hvert 5. sekund.
  Hold transaksjonene korte; unngå unødvendig tunge låser (workflowen setter
  `lock_timeout` og prøver på nytt, men en deadlock kan ellers etterlate
  produksjonen halvmigrert).
- Rettighetsmodellen er dokumentert i
  [`docs/rettigheter-og-deling.md`](../docs/rettigheter-og-deling.md)
  (autoritativ) og databasearkitekturen i
  [`docs/arkitektur-brukere-deling.md`](../docs/arkitektur-brukere-deling.md).
  Endrer du en regel, oppdater dokumentet i samme endring.

## Tester

`tests/run-tests.sh` kjører hele SQL-suiten mot en LOKAL PostgreSQL i to løp:
nytt skjema, og det gamle skjemaet med data migrert. Kommandoene for å sette opp
en midlertidig server står øverst i skriptet; deretter:

```bash
PGHOST=/tmp/hkpg PGPORT=5433 PGUSER=postgres PGDATABASE=hk_test \
  supabase/tests/run-tests.sh
```

`tests/local-stub.sql` stubber `auth`-skjemaet, så fila kan kjøres helt uten
Supabase. En ny serverside-regel skal ha en ny sjekk i den testfilen som dekker
området (roller/deling, gruppeflytting, gravsteiner, kontosletting,
e-postvarsel, migrering av gamle listedelinger).
