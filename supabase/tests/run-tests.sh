#!/usr/bin/env bash
# Kjører SQL-testsuiten for users-and-sharing.sql mot en LOKAL PostgreSQL.
# Forutsetter en kjørende server og en tom testdatabase, f.eks.:
#   initdb -D /tmp/hkpg/data -U postgres --auth=trust
#   pg_ctl -D /tmp/hkpg/data -o "-p 5433 -k /tmp/hkpg" start
#   psql -h /tmp/hkpg -p 5433 -U postgres -c 'create database hk_test'
# Bruk:  PGHOST=/tmp/hkpg PGPORT=5433 PGUSER=postgres PGDATABASE=hk_test ./run-tests.sh
set -euo pipefail
cd "$(dirname "$0")/.."

PSQL="psql -X -v ON_ERROR_STOP=1 --quiet"

fresh_schema() {
  $PSQL -c 'drop schema if exists public cascade; create schema public;
            grant usage on schema public to public;
            drop schema if exists auth cascade;'
  $PSQL -f tests/local-stub.sql
}

# ---- 1. Vanlig løp: nytt skjema, migreringen kjørt to ganger (idempotens) ----
fresh_schema
$PSQL -f users-and-sharing.sql
$PSQL -f users-and-sharing.sql   # idempotens: må tåle re-kjøring
$PSQL --no-psqlrc --echo-errors -f tests/test-users-and-sharing.sql
$PSQL --no-psqlrc --echo-errors -f tests/test-roles-and-sharing.sql
$PSQL --no-psqlrc --echo-errors -f tests/test-group-moves.sql
$PSQL --no-psqlrc --echo-errors -f tests/test-email-sharing.sql
$PSQL --no-psqlrc --echo-errors -f tests/test-tombstones.sql
$PSQL --no-psqlrc --echo-errors -f tests/test-account-deletion.sql

# ---- 2. Oppgraderingsløp: den GAMLE databasefasongen med data, migrert ----
fresh_schema
$PSQL -f tests/legacy-share-fixture.sql
$PSQL -f users-and-sharing.sql
$PSQL -f users-and-sharing.sql   # idempotens også på migreringen av gamle data
$PSQL --no-psqlrc --echo-errors -f tests/test-list-share-migration.sql

echo "✅ Alle SQL-tester grønne (roller, capabilities, gruppeflytting, e-postvarsel,"
echo "   gravsteiner, kontosletting og migrering av gamle listedelinger — begge løp)."
