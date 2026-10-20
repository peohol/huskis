#!/usr/bin/env bash
# ============================================================
# SAMTIDIGHET I OPPSKRIFTENE: to ting test-recipes.sql ikke kan bevise fra én
# databaseøkt.
#
# 1. EN OFFENTLIG LENKE SOM SKULLE VÆRT DØD, KAN ALDRI GJENOPPSTÅ.
#    En lenke slettes i det øyeblikket oppretteren mister eierskapet (en
#    rolleendring eller en flytting) — av en trigger. Men en trigger ser bare
#    det som er committet, så uten mer kunne et kappløp latt en lenke overleve:
#
#      A  recipe_link_create: B er eier → setter inn lenken (ikke committet)
#      B  degraderes; triggeren rydder — men ser ikke lenken
#      A  committer   ← en lenke hvis oppretter ikke lenger er eier
#
#    og omvendt (degraderingen er ikke committet når opprettelsen sjekker).
#    Får B eierskapet tilbake senere, virker den gamle nøkkelen igjen.
#    Alt som skaper eller dreper en lenke i en kokebok tar derfor den SAMME
#    rådgivende låsen (`recipe_links_lock`) før det leser rettighetene.
#    Scenario 1–4 kjører degradering og flytting mot opprettelsen, i begge
#    rekkefølger, og krever at lenken er død — også etter at B har fått
#    eierskapet tilbake. Scenario 5: låsen serialiserer, den svelger ikke — en
#    eier som IKKE mister noe, beholder lenken sin.
#
# 2. «LØS OPP KAPITTELET» ER ALT ELLER INGENTING, også når rettighetene endres
#    midt i. `recipe_chapter_dissolve` låser kapitlet og oppskriftene før den
#    sjekker rettighetene, og gjør alt i én transaksjon. Scenario 6–7 låser en
#    oppskrift (B mister flytteretten på den) samtidig med oppløsningen, i
#    begge rekkefølger: enten er ALT gjort (kapitlet borte, alle oppskriftene
#    rett i kokeboken), eller INGENTING (kapitlet står med alle oppskriftene).
#
# Kjøres av run-tests.sh mot den samme databasen som resten av suiten.
# Autoritativt for modellen: docs/oppskrifter.md.
# ============================================================
set -euo pipefail
cd "$(dirname "$0")/.."

PSQL="psql -X -v ON_ERROR_STOP=1 --quiet --no-psqlrc -t -A"

A='aaaa000d-0000-0000-0000-0000000000aa'
B='bbbb000d-0000-0000-0000-0000000000bb'
K='cccc000d-0000-0000-0000-000000000001'   # kokebok: A eier, B eier/medlem
K2='cccc000d-0000-0000-0000-000000000002'  # As private kokebok
R='cccc000d-0000-0000-0000-000000000003'   # oppskrift i K
K3='cccc000d-0000-0000-0000-000000000004'  # kokebok: A eier, B medlem
F='cccc000d-0000-0000-0000-000000000005'   # kapittel i K3
S1='cccc000d-0000-0000-0000-000000000006'
S2='cccc000d-0000-0000-0000-000000000007'

feil() { echo "FAIL: $1" >&2; exit 1; }
ok()   { echo "PASS: $1"; }

# Én setning som en av brukerne — nøyaktig kallet klienten gjør.
som() {
  $PSQL -c "select set_config('request.jwt.claim.sub', '$1', false);
            set role authenticated;
            $2" | tail -n 1
}
# Det samme, men i en transaksjon som holdes åpen en stund FØR den committer.
# Det er dette som gjør kappløpet reproduserbart i stedet for tilfeldig.
treigt() {
  $PSQL >/dev/null 2>&1 <<SQL || true
begin;
select set_config('request.jwt.claim.sub', '$1', false);
set local role authenticated;
$2;
select pg_sleep(1.5);
commit;
SQL
}
# Et registerstempel som alltid er nyere enn det forrige.
nå() { $PSQL -c "select (extract(epoch from clock_timestamp()) * 1000)::bigint"; }

# B blir eier av K (eierskap gis bare via en eierskapsinvitasjon).
forfrem() {
  local inv
  inv=$(som "$A" "select public.create_share_invite('note_project', '$K'::uuid,
                    'opp-race-b@example.com', 'owner') ->> 'id'")
  som "$B" "select public.accept_share_invite('$inv'::uuid) is not null" >/dev/null
  [ "$(som "$A" "select public.note_project_role('$K'::uuid, '$B'::uuid)")" = "owner" ] \
    || feil "fiksturen fikk ikke gjort B til eier"
}
degrader() { echo "select public.set_member_role('note_project', '$K'::uuid, '$B'::uuid, 'member')"; }
flytt() { echo "update public.notes set project_id = '$1', folder_id = null,
                  pos_ts = $(nå), pos_org = 'a' where id = '$R'"; }
lenker_fra_b() { $PSQL -c "select count(*) from public.recipe_links where note_id = '$R' and created_by = '$B'"; }
rydd_lenker() { $PSQL >/dev/null -c "delete from public.recipe_links where note_id = '$R'"; }
# Rett etter kappløpet, FØR noe annet rører rollene eller plasseringen: en
# senere forfremmelse eller flytting kan selv rydde, og da ville den — ikke
# låsen — fått æren for at lenken er borte.
straks() {
  local n
  n=$(lenker_fra_b)
  [ "$n" = "0" ] || feil "$1 ($n lenke(r) fra B rett etter kappløpet)"
}

# ---------- fikstur ----------
$PSQL >/dev/null <<SQL
insert into auth.users (id, email) values
  ('$A', 'opp-race-a@example.com'), ('$B', 'opp-race-b@example.com')
on conflict (id) do nothing;
-- Fiksturen skal kunne kjøres om igjen mot den samme databasen. En sletting
-- legger igjen en GRAVSTEIN, og insert-vakten avviser da id-en for godt.
delete from public.note_projects where id in ('$K', '$K2', '$K3');
delete from public.tombstones where resource_id in ('$K', '$K2', '$K3', '$R', '$F', '$S1', '$S2');
select set_config('request.jwt.claim.sub', '$A', false);
set role authenticated;
insert into public.note_projects (id, owner_id, name, kind, ts, org, pos, pos_ts, pos_org) values
  ('$K',  '$A', 'Felles kokebok', 'recipe', 1, 'a', 1, 1, 'a'),
  ('$K2', '$A', 'Privat kokebok', 'recipe', 1, 'a', 2, 1, 'a'),
  ('$K3', '$A', 'Kokebok med kapittel', 'recipe', 1, 'a', 3, 1, 'a');
insert into public.notes (id, owner_id, project_id, title, recipe, ts, org, pos, pos_ts, pos_org)
  values ('$R', '$A', '$K', 'Pannekaker', '{"v":1}', 1, 'a', 1, 1, 'a');
insert into public.note_folders (id, owner_id, project_id, name, ts, org, pos, pos_ts, pos_org)
  values ('$F', '$A', '$K3', 'Supper', 1, 'a', 1, 1, 'a');
insert into public.notes (id, owner_id, project_id, folder_id, title, recipe, ts, org, pos, pos_ts, pos_org)
  values ('$S1', '$A', '$K3', '$F', 'Tomatsuppe', '{"v":1}', 1, 'a', 1, 1, 'a'),
         ('$S2', '$A', '$K3', '$F', 'Løksuppe', '{"v":1}', 1, 'a', 2, 1, 'a');
SQL
INV=$(som "$A" "select public.create_share_invite('note_project', '$K3'::uuid, 'opp-race-b@example.com') ->> 'id'")
som "$B" "select public.accept_share_invite('$INV'::uuid) is not null" >/dev/null
[ "$(som "$A" "select public.note_project_role('$K3'::uuid, '$B'::uuid)")" = "member" ] \
  || feil "fiksturen ga ikke B en medlemsrolle i K3"

# ---------- 1. Opprettelsen er treig, degraderingen kommer inn imellom ----------
forfrem
( treigt "$B" "select public.recipe_link_create('note', '$R'::uuid)" ) &
treig=$!
sleep 0.4
som "$A" "$(degrader)" >/dev/null
wait $treig
straks "lenken overlevde en samtidig degradering"
forfrem
n=$(lenker_fra_b)
[ "$n" = "0" ] || feil "lenken overlevde en samtidig degradering og gjenoppsto ved ny forfremmelse ($n)"
ok "opprettelse treig, degradering imellom: lenken er død, også etter ny forfremmelse  [lenker=$n]"

# ---------- 2. Degraderingen er treig, opprettelsen kommer inn imellom ----------
rydd_lenker   # hvert scenario starter uten lenke, så det forrige ikke kan skjule noe
( treigt "$A" "$(degrader)" ) &
treig=$!
sleep 0.4
som "$B" "select public.recipe_link_create('note', '$R'::uuid)" >/dev/null 2>&1 || true
wait $treig
straks "en lenke ble laget mens degraderingen var uavklart"
forfrem
n=$(lenker_fra_b)
[ "$n" = "0" ] || feil "en lenke laget mens degraderingen var uavklart, gjenoppsto ved ny forfremmelse ($n)"
ok "degradering treig, opprettelse imellom: ingen lenke, heller ikke etter ny forfremmelse  [lenker=$n]"

# ---------- 3. Opprettelsen er treig, en flytting ut av Bs myndighet imellom ----------
rydd_lenker   # hvert scenario starter uten lenke, så det forrige ikke kan skjule noe
( treigt "$B" "select public.recipe_link_create('note', '$R'::uuid)" ) &
treig=$!
sleep 0.4
som "$A" "$(flytt "$K2")" >/dev/null
wait $treig
straks "lenken overlevde en samtidig flytting ut av Bs kokebok"
som "$A" "$(flytt "$K")" >/dev/null
n=$(lenker_fra_b)
[ "$n" = "0" ] || feil "lenken overlevde en samtidig flytting ut av Bs kokebok og tilbake ($n)"
ok "opprettelse treig, flytting ut og tilbake imellom: lenken er død  [lenker=$n]"

# ---------- 4. Flyttingen er treig, opprettelsen kommer inn imellom ----------
rydd_lenker   # hvert scenario starter uten lenke, så det forrige ikke kan skjule noe
( treigt "$A" "$(flytt "$K2")" ) &
treig=$!
sleep 0.4
som "$B" "select public.recipe_link_create('note', '$R'::uuid)" >/dev/null 2>&1 || true
wait $treig
straks "en lenke ble laget mens flyttingen var uavklart"
som "$A" "$(flytt "$K")" >/dev/null
n=$(lenker_fra_b)
[ "$n" = "0" ] || feil "en lenke laget mens flyttingen var uavklart, overlevde ($n)"
ok "flytting treig, opprettelse imellom: ingen lenke etter at oppskriften er tilbake  [lenker=$n]"

# ---------- 5. Låsen serialiserer, den svelger ikke ----------
# A er og forblir eier; at B degraderes samtidig skal ikke ta As lenke.
rydd_lenker
( treigt "$A" "select public.recipe_link_create('note', '$R'::uuid)" ) &
treig=$!
sleep 0.4
som "$A" "$(degrader)" >/dev/null
wait $treig
n=$($PSQL -c "select count(*) from public.recipe_links where note_id = '$R' and created_by = '$A'")
[ "$n" = "1" ] || feil "en eier som ikke mistet noe, mistet lenken sin ($n)"
ok "en samtidig degradering av en ANNEN tar ikke eierens lenke  [lenker=$n]"
rydd_lenker

# ---------- Løs opp kapittelet: alt eller ingenting ----------
tilstand() {
  $PSQL -c "select (exists (select 1 from public.note_folders where id = '$F'))::text || ':' ||
                   (select count(*) from public.notes where id in ('$S1', '$S2') and folder_id = '$F') || ':' ||
                   (select count(*) from public.notes where id in ('$S1', '$S2') and folder_id is null
                                                          and project_id = '$K3')"
}
oppløs() { echo "select public.recipe_chapter_dissolve('$F'::uuid, $(nå), 'b')"; }

# ---------- 6. Låsingen er treig, oppløsningen kommer inn imellom ----------
# B mister flytteretten på S1 i det samme øyeblikket: oppløsningen venter på
# radlåsen, ser låsen og avviser — og da endres INGENTING.
( treigt "$A" "select public.set_locked('note', '$S1'::uuid, true)" ) &
treig=$!
sleep 0.4
som "$B" "$(oppløs)" >/dev/null 2>&1 || true
wait $treig
t=$(tilstand)
[ "$t" = "true:2:0" ] || feil "oppløsning mot en samtidig låsing ble halvveis: $t (ventet true:2:0)"
ok "låsing treig, oppløsning imellom: ingenting endret — kapitlet står med begge oppskriftene  [$t]"
som "$A" "select public.set_locked('note', '$S1'::uuid, false)" >/dev/null

# ---------- 7. Oppløsningen er treig, låsingen kommer inn imellom ----------
# Oppløsningen holder radene; låsingen venter, og treffer oppskriften der den
# nå ligger. Alt er gjort.
( treigt "$B" "$(oppløs)" ) &
treig=$!
sleep 0.4
som "$A" "select public.set_locked('note', '$S1'::uuid, true)" >/dev/null
wait $treig
t=$(tilstand)
[ "$t" = "false:0:2" ] || feil "oppløsning før en samtidig låsing ble ikke fullført: $t (ventet false:0:2)"
[ "$($PSQL -c "select locked from public.notes where id = '$S1'")" = "t" ] \
  || feil "låsingen som ventet, gikk tapt"
ok "oppløsning treig, låsing imellom: alt gjort — kapitlet borte, begge oppskriftene i kokeboken  [$t]"

echo "──────── test-recipe-race.sh: alle grønne ────────"
