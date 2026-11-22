#!/usr/bin/env bash
# ============================================================
# SAMTIDIGHET I DEN AUTOMATISKE TØMMINGEN: det test-trash-retention.sql ikke
# kan bevise fra én databaseøkt.
#
# EN GJENOPPRETTING SOM LYKKES, SKAL ALDRI BLI SLETTET ETTERPÅ.
# `purge_expired_trash()` velger kandidatene og sletter dem i to steg. Uten
# lås kunne en gjenoppretting komme imellom:
#
#   T  velger raden (den er i kassen og utløpt)
#   A  gjenoppretter raden og committer        ← brukeren ser den tilbake
#   T  sletter på id, og gravlegger den        ← borte for godt likevel
#
# Kandidatene låses derfor (`for update … skip locked`). To scenarioer, ett i
# hver rekkefølge:
#
#   1. Gjenopprettingen står med raden når tømmingen kommer: tømmingen hopper
#      over den, og gjenopprettingen vinner.
#   2. Tømmingen står med raden når gjenopprettingen kommer: gjenopprettingen
#      venter, og finner raden borte — den kan ikke «lykkes» og så forsvinne.
#
# Kjøres av run-tests.sh mot den samme databasen som resten av suiten.
# Autoritativt: docs/trash.md, «Automatisk tømming».
# ============================================================
set -euo pipefail
cd "$(dirname "$0")/.."

PSQL="psql -X -v ON_ERROR_STOP=1 --quiet --no-psqlrc -t -A"

A='aaaa000e-0000-0000-0000-0000000000aa'
U='eeee000e-0000-0000-0000-000000000001'
G='eeee000e-0000-0000-0000-000000000002'
C='eeee000e-0000-0000-0000-000000000003'

feil() { echo "FAIL: $1" >&2; exit 1; }
ok()   { echo "PASS: $1"; }

# Et registerstempel som alltid er nyere enn det forrige.
nå() { $PSQL -c "select (extract(epoch from clock_timestamp()) * 1000)::bigint"; }

# Listen C i kassen, utløpt for lenge siden (A står på «1 time»).
i_kassen() {
  local ts; ts=$(nå)
  $PSQL >/dev/null <<SQL
select set_config('request.jwt.claim.sub', '$A', false);
set role authenticated;
update public.cards set trashed = true, ts = $ts, org = 'a' where id = '$C';
reset role;
set session_replication_role = replica;
update public.cards set trashed_at = now() - interval '2 hours' where id = '$C';
SQL
}
# Gjenopprett C som A, og hold transaksjonen åpen en stund FØR den committer.
# Skriver antall rader UPDATE traff.
gjenopprett_treigt() {
  local ts; ts=$(nå)
  $PSQL <<SQL | grep -E '^[0-9]+$' | tail -n 1
begin;
select set_config('request.jwt.claim.sub', '$A', false);
set local role authenticated;
with r as (update public.cards set trashed = false, ts = $ts, org = 'a' where id = '$C' returning 1)
select count(*) from r;
select pg_sleep(1.5);
commit;
SQL
}
tom_treigt() {
  $PSQL >/dev/null <<SQL
begin;
select public.purge_expired_trash();
select pg_sleep(1.5);
commit;
SQL
}
finnes()  { $PSQL -c "select count(*) from public.cards where id = '$C'"; }
i_kasse() { $PSQL -c "select coalesce((select trashed::text from public.cards where id = '$C'), 'borte')"; }

# ---------- fikstur ----------
$PSQL >/dev/null <<SQL
insert into auth.users (id, email, raw_user_meta_data)
  values ('$A', 'trash-race-a@example.com', '{"trash_retention": 3600}')
  on conflict (id) do update set raw_user_meta_data = excluded.raw_user_meta_data;
select set_config('request.jwt.claim.sub', '$A', false);
set role authenticated;
insert into public.universes (id, owner_id, name, ts, org) values ('$U', '$A', 'Kappløp', 1, 'a');
insert into public.groups (id, owner_id, universe_id, name, ts, org) values ('$G', '$A', '$U', 'Mappe', 1, 'a');
insert into public.cards (id, owner_id, group_id, title, ts, org) values ('$C', '$A', '$G', 'Liste', 1, 'a');
SQL

# ---------- 1. gjenopprettingen står med raden ----------
i_kassen
gjenopprett_treigt > /tmp/trash-race-1.out &
sleep 0.5
$PSQL -c "select public.purge_expired_trash()" >/dev/null
wait
[ "$(cat /tmp/trash-race-1.out)" = "1" ] || feil "scenario 1: gjenopprettingen traff ikke raden"
[ "$(finnes)" = "1" ] && [ "$(i_kasse)" = "false" ] \
  || feil "scenario 1: en gjenoppretting som lyktes, ble slettet likevel (finnes=$(finnes), trashed=$(i_kasse))"
ok "1: tømmingen hopper over en rad som gjenopprettes i samme øyeblikk — gjenopprettingen vinner"

# ---------- 2. tømmingen står med raden ----------
i_kassen
tom_treigt &
sleep 0.5
traff=$(gjenopprett_treigt)
wait
[ "$traff" = "0" ] || feil "scenario 2: gjenopprettingen «lyktes» på en rad som ble slettet (traff=$traff)"
[ "$(finnes)" = "0" ] || feil "scenario 2: raden ble ikke tømt"
[ "$($PSQL -c "select count(*) from public.tombstones where resource_id = '$C'")" = "1" ] \
  || feil "scenario 2: tømmingen skrev ingen gravstein"
ok "2: en gjenoppretting som kommer mens tømmingen står med raden, finner den borte"
rm -f /tmp/trash-race-1.out
