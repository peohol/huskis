#!/usr/bin/env bash
# Kjører testsuiten for users-and-sharing.sql mot en LOKAL PostgreSQL.
# Forutsetter en kjørende server og en tom testdatabase, f.eks.:
#   initdb -D /tmp/hkpg/data -U postgres --auth=trust
#   pg_ctl -D /tmp/hkpg/data -o "-p 5433 -k /tmp/hkpg" start
#   psql -h /tmp/hkpg -p 5433 -U postgres -c 'create database hk_test'
# Bruk:  PGHOST=/tmp/hkpg PGPORT=5433 PGUSER=postgres PGDATABASE=hk_test ./run-tests.sh
set -euo pipefail
cd "$(dirname "$0")/.."

PSQL="psql -X -v ON_ERROR_STOP=1 --quiet"

# Frisk skjema-tilstand i testdatabasen (rører aldri Supabase).
$PSQL -c 'drop schema if exists public cascade; create schema public;
          grant usage on schema public to public;
          drop schema if exists auth cascade;'

$PSQL -f tests/local-stub.sql
$PSQL -f users-and-sharing.sql
$PSQL -f users-and-sharing.sql   # idempotens: må tåle re-kjøring
$PSQL --no-psqlrc --echo-errors -f tests/test-users-and-sharing.sql
$PSQL --no-psqlrc --echo-errors -f tests/test-permissions.sql
$PSQL --no-psqlrc --echo-errors -f tests/test-email-sharing.sql

echo "✅ Alle tester grønne (inkl. dobbel kjøring av migreringen + e-postvarsel + rettigheter)."
