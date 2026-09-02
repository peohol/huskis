-- ============================================================
-- Testsuite for VARSLENE: per-bruker historikk, idempotent logging,
-- generator-markøren, preferansene og at ingen ser en annens varsler.
-- Kjøres mot en LOKAL PostgreSQL med tests/local-stub.sql +
-- users-and-sharing.sql lastet først (IKKE mot Supabase). Se run-tests.sh.
--
-- Poenget med fila: varslene er den første tabellen i Huskis som IKKE er
-- innhold. De deles aldri, de skrives ikke av klienten direkte, og RLS er
-- eneste sperre mot at et delt objekt lekker en annens varselhistorikk.
--
-- To brukere:
--   A = eier av et område med en delt mappe
--   B = medlem i den samme mappen (ser det samme innholdet, egne varsler)
-- Autoritativt for modellen: docs/varsler.md.
-- ============================================================

\set ON_ERROR_STOP on
reset role;

create or replace function public.t_check(name text, cond boolean)
returns text language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FAIL: %', name; end if;
  return 'PASS: ' || name;
end $$;
create or replace function public.t_fails(name text, cmd text)
returns text language plpgsql as $$
begin
  begin execute cmd; exception when others then
    return 'PASS (blokkert): ' || name || ' — ' || sqlerrm; end;
  raise exception 'FAIL (skulle vært blokkert): %', name;
end $$;
grant execute on function public.t_check(text, boolean) to public;
grant execute on function public.t_fails(text, text) to public;

\set A  'aaaa0009-0000-0000-0000-0000000000a9'
\set B  'bbbb0009-0000-0000-0000-0000000000b9'
\set AU '1a000000-9999-0000-0000-000000000001'
\set AG '2a000000-9999-0000-0000-000000000001'
\set AC '3a000000-9999-0000-0000-000000000001'
\set AI '4a000000-9999-0000-0000-000000000001'

-- ---------- 0. brukere + delt tre ----------
insert into auth.users (id, email) values
  (:'A', 'varsel-a@example.com'), (:'B', 'varsel-b@example.com')
on conflict (id) do nothing;

reset role; select set_config('request.jwt.claim.sub', :'A', false); set role authenticated;
insert into public.universes (id, owner_id, name, ts, org) values (:'AU', :'A', 'Varselområde', 1, 'a');
insert into public.groups (id, owner_id, universe_id, name, ts, org) values (:'AG', :'A', :'AU', 'Mappe', 1, 'a');
insert into public.cards  (id, owner_id, group_id, title, due_at, ts, org)
  values (:'AC', :'A', :'AG', 'Frist-liste', '2026-01-10', 1, 'a');
insert into public.items  (id, owner_id, card_id, text, ts, org) values (:'AI', :'A', :'AC', 'Punkt', 1, 'a');
select public.create_share_invite('group', :'AG', 'varsel-b@example.com') ->> 'id' as inv \gset
reset role; select set_config('request.jwt.claim.sub', :'B', false); set role authenticated;
select public.accept_share_invite(:'inv'::uuid);
select public.t_check('B ser den delte listen (samme innhold, egne varsler)',
  (select count(*) from public.cards where id = :'AC') = 1);

-- ---------- 1. første runde: prefs-raden lages med standardene ----------
reset role; select set_config('request.jwt.claim.sub', :'A', false); set role authenticated;
/* Én fast tidsbase for hele fila. `at` er hendelsens faktiske tidspunkt, og
   radene har en LEVETID på 30 døgn (notify_max_age_ms()) — en sentinelverdi
   som 2000 ms ville vært 1970 og blitt ryddet bort med en gang. `\gset` gir et
   tall som er det samme i hver setning; `now()` ville vært nytt per
   transaksjon. */
select (extract(epoch from now()) * 1000)::bigint as t0 \gset
select public.t_check('A har ingen prefs-rad før første logging',
  (select count(*) from public.notification_prefs where user_id = :'A') = 0);
select public.notify_record('[]'::jsonb, 1000);
select public.t_check('notify_record() lager prefs-raden med alle fire typene PÅ',
  (select due_over and due_soon and start_now and start_soon
     from public.notification_prefs where user_id = :'A') = true);
select public.t_check('markøren står der klienten satte den',
  (select cursor_at from public.notification_prefs where user_id = :'A') = 1000);

-- ---------- 2. logging + idempotens på (user_id, key) ----------
select public.notify_record(jsonb_build_array(jsonb_build_object(
  'key', 'dueOver|card|' || :'AC' || '|2026-01-10', 'type', 'dueOver',
  'obj_type', 'card', 'obj_id', :'AC', 'name', 'Frist-liste',
  'path', 'Varselområde › Mappe', 'value', '2026-01-10', 'at', :t0 - 8000)), 2000);
select public.t_check('varselet ble logget', (select count(*) from public.notifications where user_id = :'A') = 1);
select public.t_check('… og notify_record() svarte med antall rader som FAKTISK ble lagt inn',
  (select public.notify_record(jsonb_build_array(jsonb_build_object(
     'key', 'startNow|card|' || :'AC' || '|2026-01-05', 'type', 'startNow',
     'obj_type', 'card', 'obj_id', :'AC', 'name', 'Frist-liste',
     'path', 'x', 'value', '2026-01-05', 'at', :t0 - 7500)))) = 1
  and (select public.notify_record(jsonb_build_array(jsonb_build_object(
     'key', 'startNow|card|' || :'AC' || '|2026-01-05', 'type', 'startNow',
     'obj_type', 'card', 'obj_id', :'AC', 'name', 'Frist-liste',
     'path', 'x', 'value', '2026-01-05', 'at', :t0 - 7500)))) = 0);
delete from public.notifications where key like 'startNow|%';
-- Den ANDRE enheten regner ut nøyaktig det samme varselet.
select public.notify_record(jsonb_build_array(jsonb_build_object(
  'key', 'dueOver|card|' || :'AC' || '|2026-01-10', 'type', 'dueOver',
  'obj_type', 'card', 'obj_id', :'AC', 'name', 'Frist-liste',
  'path', 'Varselområde › Mappe', 'value', '2026-01-10', 'at', :t0 - 8000)), 2100);
select public.t_check('samme nøkkel to ganger gir ÉN rad (to enheter dupliserer ikke)',
  (select count(*) from public.notifications where user_id = :'A') = 1);
select public.t_check('varselet er ulest fra starten',
  (select read_at is null from public.notifications where user_id = :'A') = true);

-- En ENDRET frist gir en ny logisk identitet (nøkkelen bærer tidsverdien).
select public.notify_record(jsonb_build_array(jsonb_build_object(
  'key', 'dueOver|card|' || :'AC' || '|2026-02-01', 'type', 'dueOver',
  'obj_type', 'card', 'obj_id', :'AC', 'name', 'Frist-liste',
  'path', 'Varselområde › Mappe', 'value', '2026-02-01', 'at', :t0 - 7000)), 3000);
select public.t_check('endret tidsverdi gir et NYTT varsel',
  (select count(*) from public.notifications where user_id = :'A') = 2);

-- ---------- 3. markøren går bare framover, og aldri forbi serverklokka ----------
select public.notify_record('[]'::jsonb, 500);
select public.t_check('en enhet med etterslepende klokke kan ikke trekke markøren tilbake',
  (select cursor_at from public.notification_prefs where user_id = :'A') = 3000);
select public.notify_record('[]'::jsonb, 99999999999999);
select public.t_check('en enhet med klokka langt fram klemmes til serverens nå',
  (select cursor_at from public.notification_prefs where user_id = :'A')
    <= (extract(epoch from now()) * 1000)::bigint);

-- ---------- 4. ugyldige rader slipper ikke inn ----------
select public.notify_record(jsonb_build_array(jsonb_build_object(
  'key', 'tull|card|x|y', 'type', 'ikkeEnType', 'obj_type', 'card',
  'obj_id', :'AC', 'at', :t0 - 6000)));
select public.t_check('ukjent varseltype forkastes',
  (select count(*) from public.notifications where user_id = :'A') = 2);
select public.t_check('markøren står stille når p_cursor er utelatt («Utsett»-veien)',
  (select cursor_at from public.notification_prefs where user_id = :'A')
    <= (extract(epoch from now()) * 1000)::bigint);

-- ---------- 4b. LEVETIDEN: 30 døgn etter at raden ble historikk ----------
-- Radene skrives her direkte som EIER (ingen insert-policy for klienten), fordi
-- poenget er en rad som har fått LIGGE og bli gammel — ikke en logging.
-- Levetiden måles fra det SENESTE av `created_at` og `at`, altså fra det
-- øyeblikket raden ble historikk. De fire siste radene her er hver sin grunn
-- til at ingen av de to tidene duger alene.
reset role;
\set MND 'public.notify_max_age_ms()'
insert into public.notifications (user_id, key, type, obj_type, obj_id, name, path, value, at, created_at)
values
  -- Ringte for lenge siden OG ble skrevet for lenge siden → skal bort.
  (:'A', 'dueOver|card|gammel',    'dueOver',  'card', :'AC', 'Gammel',    'x', '2020-01-01',
   :t0 - :MND - 2000, :t0 - :MND - 2000),
  -- Så vidt innenfor levetiden → blir stående.
  (:'A', 'dueOver|card|nesten',    'dueOver',  'card', :'AC', 'Nesten',    'x', '2020-01-02',
   :t0 - :MND + 3600000, :t0 - :MND + 3600000),
  -- Gammel rad som ennå ikke har ringt: det er PLANEN, ikke historikk.
  (:'A', 'startNow|card|planlagt', 'startNow', 'card', :'AC', 'Planlagt',  'x', '2030-01-01',
   :t0 + 3600000, :t0 - :MND - 2000),
  /* Fersk rad om en 90 døgn gammel hendelse (appen har vært lukket lenge).
     Bare `at` ville slettet den i den samme runden den ble logget. */
  (:'A', 'dueOver|card|etterslep', 'dueOver',  'card', :'AC', 'Etterslep', 'x', '2020-01-03',
   :t0 - 90::bigint * 24 * 60 * 60 * 1000, :t0 - 1000),
  /* PLANEN legges opp til en måned fram, så en rad ved horisontens ytterkant er
     allerede en måned gammel i det den ringer. Bare `created_at` ville ryddet
     den bort i nøyaktig det øyeblikket den ble relevant. */
  (:'A', 'dueOver|card|nyringt',   'dueOver',  'card', :'AC', 'Nyringt',   'x', '2020-01-04',
   :t0 - 2000, :t0 - :MND - 2000);
select set_config('request.jwt.claim.sub', :'A', false); set role authenticated;
select public.t_check('get_my_doc() leverer ikke en rad som ble historikk for mer enn levetiden siden',
  not exists (select 1 from jsonb_array_elements(public.get_my_doc() -> 'notifications') e
               where e ->> 'name' = 'Gammel'));
select public.notify_record('[]'::jsonb);
select public.t_check('… og første logging etterpå SLETTER den',
  (select count(*) from public.notifications where user_id = :'A' and name = 'Gammel') = 0);
select public.t_check('en rad så vidt innenfor levetiden står urørt',
  (select count(*) from public.notifications where user_id = :'A' and name = 'Nesten') = 1);
select public.t_check('en rad som ennå ikke har ringt er ikke historikk og røres ikke, uansett alder',
  (select count(*) from public.notifications where user_id = :'A' and name = 'Planlagt') = 1);
select public.t_check('en FERSK rad om en gammel hendelse blir stående — den er ikke sett ennå',
  (select count(*) from public.notifications where user_id = :'A' and name = 'Etterslep') = 1);
select public.t_check('en PLANLAGT rad som nettopp ringte overlever at den ble LAGT for en måned siden',
  (select count(*) from public.notifications where user_id = :'A' and name = 'Nyringt') = 1);
-- Ryddes bort igjen, så resten av fila måler mot de to opprinnelige radene.
delete from public.notifications where user_id = :'A'
   and name in ('Nesten', 'Planlagt', 'Etterslep', 'Nyringt');

-- ---------- 5. RLS: B ser ALDRI A sine varsler ----------
reset role; select set_config('request.jwt.claim.sub', :'B', false); set role authenticated;
select public.t_check('B ser ingen av A sine varsler, selv om innholdet er delt',
  (select count(*) from public.notifications) = 0);
select public.t_check('B ser ingen av A sine preferanser',
  (select count(*) from public.notification_prefs) = 0);
select public.t_check('get_my_doc() for B har en tom varselliste',
  jsonb_array_length(public.get_my_doc() -> 'notifications') = 0);
-- B kan verken lese, merke lest eller slette A sine rader.
update public.notifications set read_at = 1 where true;
delete from public.notifications where true;
reset role; select set_config('request.jwt.claim.sub', :'A', false); set role authenticated;
select public.t_check('A sine varsler er urørt etter B sitt forsøk',
  (select count(*) from public.notifications where user_id = :'A') = 2
  and (select count(*) from public.notifications where user_id = :'A' and read_at is not null) = 0);

-- ---------- 6. A merker sine egne lest, og tømmer ----------
reset role; select set_config('request.jwt.claim.sub', :'A', false); set role authenticated;
update public.notifications set read_at = 5000 where read_at is null;
select public.t_check('A kan merke sine egne som lest',
  (select count(*) from public.notifications where user_id = :'A' and read_at = 5000) = 2);
select public.t_check('get_my_doc() leverer A sine varsler, nyeste først',
  (public.get_my_doc() -> 'notifications' -> 0 ->> 'at') = (:t0 - 7000)::text
  and jsonb_array_length(public.get_my_doc() -> 'notifications') = 2);
select public.t_check('get_my_doc() leverer preferansene med markøren',
  (public.get_my_doc() -> 'notify_prefs' ->> 'dueOver') = 'true'
  and (public.get_my_doc() -> 'notify_prefs' ->> 'cursor') is not null);

-- ---------- 7. preferansene: bytte flytter markøren til nå ----------
select public.notify_set_prefs('{"dueSoon": false, "startSoon": false}'::jsonb);
select public.t_check('to typer slått av, de to andre urørt',
  (select due_over and not due_soon and start_now and not start_soon
     from public.notification_prefs where user_id = :'A') = true);
select public.t_check('et preferansebytte flytter markøren fram til nå',
  (select cursor_at from public.notification_prefs where user_id = :'A')
    >= (extract(epoch from now()) * 1000)::bigint - 5000);

-- ---------- 8. «Tøm varsler» sletter KUN mine egne rader ----------
delete from public.notifications where user_id = :'A';
select public.t_check('A sin historikk er tom etter tømming',
  (select count(*) from public.notifications where user_id = :'A') = 0);
select public.t_check('preferansene og markøren overlever en tømming',
  (select count(*) from public.notification_prefs where user_id = :'A') = 1);

-- ---------- 9. kontosletting tar historikken med seg ----------
reset role; select set_config('request.jwt.claim.sub', :'B', false); set role authenticated;
select public.notify_record(jsonb_build_array(jsonb_build_object(
  'key', 'startNow|item|' || :'AI' || '|2026-03-01', 'type', 'startNow',
  'obj_type', 'item', 'obj_id', :'AI', 'name', 'Punkt', 'path', 'x',
  'value', '2026-03-01', 'at', :t0 - 4000)), 6000);
select public.t_check('B har sitt eget varsel om det samme objektet',
  (select count(*) from public.notifications where user_id = :'B') = 1);
select public.delete_account();
reset role; select set_config('request.jwt.claim.sub', :'A', false); set role authenticated;
select public.t_check('B sine varsler og preferanser er borte med kontoen',
  (select count(*) from public.notifications where user_id = :'B') = 0
  and (select count(*) from public.notification_prefs where user_id = :'B') = 0);

reset role;
\echo '✅ test-notifications.sql: alle sjekker grønne'
