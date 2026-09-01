#!/usr/bin/env bash
# ============================================================
# SAMTIDIGHET: en automatisk fornyelse kan ikke spise et «slå av».
#
# Resten av SQL-suiten kjører i ÉN databaseøkt, og en enkelt økt kan ikke
# vise det som er farlig her: to operasjoner på det samme abonnementet
# samtidig. Uten en lås er dette hullet:
#
#   A (fornyelsen)  leser `revoked_at = null`
#   B (avslåingen)  setter `revoked_at` og committer
#   A               skriver videre, og UPSERT-en setter `revoked_at = null`
#
# Da er brukerens valg borte, og ingen gjorde noe galt. `push_subscribe()`
# låser derfor raden med `for update` før den leser tilstanden.
#
# Men den farligste varianten er to ULIKE endepunkter i den SAMME
# klientkonteksten: ruller nettleseren endepunktet sitt, oppretter fornyelsen
# `E2` mens avslåingen tar `E1`. To rader — ingen felles radlås, og enheten
# ville stått igjen som PÅ etter at brukeren slo den av. Låsen ligger derfor på
# BRUKEREN (`push_lock()`), og `push_revoke()` slår av hele klientkonteksten.
#
# Testen kjører begge rekkefølgene i begge variantene — samme endepunkt, og to
# ulike i samme kontekst — og krever at alle fire ender med AV.
#
# Kjøres av run-tests.sh mot den samme databasen som resten av suiten.
# Autoritativt for modellen: docs/varsler.md.
# ============================================================
set -euo pipefail
cd "$(dirname "$0")/.."

PSQL="psql -X -v ON_ERROR_STOP=1 --quiet --no-psqlrc -t -A"

R='dddd000b-0000-0000-0000-0000000000dd'
EP='https://push.example.com/kapplop'
EP2='https://push.example.com/kapplop-rotert'   # samme klient, nytt endepunkt
K1="BP$(printf 'k%.0s' $(seq 83))r1"
K2="BP$(printf 'k%.0s' $(seq 83))r2"
S1="$(printf 's%.0s' $(seq 20))r1"

feil() { echo "FAIL: $1" >&2; exit 1; }
ok()   { echo "PASS: $1"; }

# Hva står det i basen NÅ? Leses som eier, utenom RLS — testen skal se
# sannheten, ikke det klienten får se.
tilstand() { $PSQL -c "select coalesce((select case when revoked_at is null then 'aktiv' else 'av' end
                                          from public.push_subscriptions where endpoint = '$EP'), 'borte')"; }

# En vanlig, automatisk fornyelse — nøyaktig kallet klienten gjør hver runde.
# Endepunktet er et argument: den samme klienten kan ha rullert det.
fornyelse() {
  $PSQL -c "select set_config('request.jwt.claim.sub', '$R', false);
            set role authenticated;
            select public.push_subscribe('${1:-$EP}', '$K2', '$S1', '{}'::jsonb, 'Europe/Oslo',
                                         'Chrome', 'Android', 'www.huskis.no', 'd-kapp')" | tail -n 1
}

# Hvor mange AKTIVE rader klientkonteksten har. Det er dette tallet invarianten
# handler om: etter et «slå av» skal det være null, uansett hvor mange
# endepunkter nettleseren rakk å ha.
aktive() {
  $PSQL -c "select count(*) from public.push_subscriptions
             where user_id = '$R' and device_id = 'd-kapp' and origin = 'www.huskis.no'
               and revoked_at is null and disabled_at is null"
}

# Brukeren står ved klienten og slår varslene på igjen. Det rydder også sporene
# i konteksten, så neste scenario starter på blanke ark.
paa_igjen() {
  $PSQL >/dev/null -c "select set_config('request.jwt.claim.sub', '$R', false);
            set role authenticated;
            select public.push_subscribe('$EP', '$K1', '$S1', '{}'::jsonb, 'Europe/Oslo',
                                         'Chrome', 'Android', 'www.huskis.no', 'd-kapp', true)"
  $PSQL >/dev/null -c "reset role; delete from public.push_subscriptions
                        where user_id = '$R' and endpoint = '$EP2'"
}

# ---------- fikstur ----------
$PSQL >/dev/null <<SQL
insert into auth.users (id, email) values ('$R', 'push-race@example.com')
on conflict (id) do nothing;
delete from public.push_subscriptions where user_id = '$R';
select set_config('request.jwt.claim.sub', '$R', false);
set role authenticated;
select public.push_subscribe('$EP', '$K1', '$S1', '{}'::jsonb, 'Europe/Oslo',
                             'Chrome', 'Android', 'www.huskis.no', 'd-kapp');
SQL
SUB=$($PSQL -c "select id from public.push_subscriptions where endpoint = '$EP'")
[ -n "$SUB" ] || feil "fiksturen fikk ikke registrert et abonnement"

# ---------- 1. avslåingen kommer FØRST, fornyelsen er allerede i lufta ----------
# Den andre enheten holder raden i en åpen transaksjon i to sekunder. Fornyelsen
# starter et halvt sekund inn — altså MENS avslåingen er uavklart — og må vente
# på låsen og lese den nye verdien når den slippes.
(
  $PSQL >/dev/null <<SQL
begin;
select set_config('request.jwt.claim.sub', '$R', false);
set local role authenticated;
select public.push_revoke('$SUB'::uuid);
select pg_sleep(2);
commit;
SQL
) &
avslaer=$!
sleep 0.5

start=$(date +%s%N)
svar=$(fornyelse)
gikk=$(( ($(date +%s%N) - start) / 1000000 ))
wait "$avslaer" || feil "avslåingen feilet"

case "$svar" in
  *'"revoked": true'*) ok 'fornyelsen som løp inn i en samtidig avslåing ble avvist' ;;
  *) feil "fornyelsen slo på varslene igjen: $svar" ;;
esac
[ "$(tilstand)" = av ] || feil "raden står aktiv etter en samtidig avslåing"
ok '… og raden står fortsatt som avslått'
[ "$gikk" -ge 1000 ] || feil "fornyelsen ventet ikke på låsen (${gikk} ms) — leste den tilstanden før avslåingen?"
ok "… og den ventet på låsen i stedet for å lese en foreldet tilstand (${gikk} ms)"

# ---------- 2. fornyelsen kommer FØRST, avslåingen kommer mens den skriver ----------
# Samme to operasjoner, motsatt rekkefølge. Her er det avslåingen som må vente,
# og den skal vinne til slutt: brukeren ba om AV, og en fornyelse som tilfeldigvis
# var i gang skal ikke overstyre det.
$PSQL >/dev/null -c "select set_config('request.jwt.claim.sub', '$R', false);
                     set role authenticated;
                     select public.push_subscribe('$EP', '$K1', '$S1', '{}'::jsonb, 'Europe/Oslo',
                                                  'Chrome', 'Android', 'www.huskis.no', 'd-kapp', true)"
[ "$(tilstand)" = aktiv ] || feil "det eksplisitte «slå på» tok ikke"

(
  $PSQL >/dev/null <<SQL
begin;
select set_config('request.jwt.claim.sub', '$R', false);
set local role authenticated;
select public.push_subscribe('$EP', '$K2', '$S1', '{}'::jsonb, 'Europe/Oslo',
                             'Chrome', 'Android', 'www.huskis.no', 'd-kapp');
select pg_sleep(2);
commit;
SQL
) &
fornyer=$!
sleep 0.5

start=$(date +%s%N)
$PSQL >/dev/null -c "select set_config('request.jwt.claim.sub', '$R', false);
                     set role authenticated;
                     select public.push_revoke('$SUB'::uuid)"
gikk=$(( ($(date +%s%N) - start) / 1000000 ))
wait "$fornyer" || feil "fornyelsen feilet"

[ "$(tilstand)" = av ] || feil "avslåingen forsvant bak en samtidig fornyelse"
ok 'avslåingen som kom mens en fornyelse skrev, vant likevel'
[ "$gikk" -ge 1000 ] || feil "avslåingen ventet ikke på fornyelsen (${gikk} ms)"
ok "… og den ventet på fornyelsens lås (${gikk} ms)"

svar=$(fornyelse)
case "$svar" in
  *'"revoked": true'*) ok '… og den neste automatiske fornyelsen blir avvist' ;;
  *) feil "den neste fornyelsen slo på varslene igjen: $svar" ;;
esac

# ---------- 3. avslåingen tar E1 mens fornyelsen oppretter E2 ----------
# Nettleseren har rullert endepunktet. Avslåingen gjelder raden brukeren SÅ
# (E1), mens fornyelsen er i ferd med å lage en helt ny rad (E2) for den samme
# klienten. Uten en lås på brukeren møtes de aldri — E1 blir av, E2 blir på.
paa_igjen
[ "$(aktive)" = 1 ] || feil "fikstur: klienten skulle hatt nøyaktig ett aktivt abonnement"

(
  $PSQL >/dev/null <<SQL
begin;
select set_config('request.jwt.claim.sub', '$R', false);
set local role authenticated;
select public.push_revoke('$SUB'::uuid);
select pg_sleep(2);
commit;
SQL
) &
avslaer=$!
sleep 0.5

start=$(date +%s%N)
svar=$(fornyelse "$EP2")
gikk=$(( ($(date +%s%N) - start) / 1000000 ))
wait "$avslaer" || feil "avslåingen feilet"

case "$svar" in
  *'"revoked": true'*) ok 'et ROTERT endepunkt fra en samtidig avslått klient blir avvist' ;;
  *) feil "det roterte endepunktet ble aktivt: $svar" ;;
esac
[ "$(aktive)" = 0 ] || feil "klienten har fortsatt et aktivt abonnement etter avslåingen"
ok '… og ingen rad i klientkonteksten står igjen som aktiv'
[ "$gikk" -ge 1000 ] || feil "fornyelsen ventet ikke på avslåingen (${gikk} ms)"
ok "… og den ventet på avslåingen i stedet for å passere den (${gikk} ms)"

# ---------- 4. fornyelsen oppretter E2 FØRST, avslåingen kommer etterpå ----------
# Motsatt rekkefølge: E2 rekker å bli aktiv før brukeren slår av. Avslåingen
# gjelder E1, men skal ta hele klienten — ellers står E2 igjen som på.
paa_igjen
(
  $PSQL >/dev/null <<SQL
begin;
select set_config('request.jwt.claim.sub', '$R', false);
set local role authenticated;
select public.push_subscribe('$EP2', '$K2', '$S1', '{}'::jsonb, 'Europe/Oslo',
                             'Chrome', 'Android', 'www.huskis.no', 'd-kapp');
select pg_sleep(2);
commit;
SQL
) &
fornyer2=$!
sleep 0.5

start=$(date +%s%N)
$PSQL >/dev/null -c "select set_config('request.jwt.claim.sub', '$R', false);
                     set role authenticated;
                     select public.push_revoke('$SUB'::uuid)"
gikk=$(( ($(date +%s%N) - start) / 1000000 ))
wait "$fornyer2" || feil "fornyelsen feilet"

[ "$(aktive)" = 0 ] || feil "det roterte endepunktet overlevde avslåingen"
ok 'avslåingen tok HELE klienten, også endepunktet som nettopp ble opprettet'
[ "$gikk" -ge 1000 ] || feil "avslåingen ventet ikke på fornyelsen (${gikk} ms)"
ok "… og den ventet på fornyelsen (${gikk} ms)"

svar=$(fornyelse "$EP2")
case "$svar" in
  *'"revoked": true'*) ok '… og den neste automatiske fornyelsen av E2 blir avvist' ;;
  *) feil "fornyelsen av E2 slo på varslene igjen: $svar" ;;
esac

# ---------- opprydning ----------
$PSQL >/dev/null -c "reset role; delete from auth.users where id = '$R'"

echo '✅ test-push-race.sh: alle fire rekkefølgene ender med AV'
