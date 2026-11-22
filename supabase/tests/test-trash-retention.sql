-- ============================================================
-- Testsuite for den AUTOMATISKE TØMMINGEN av søppelkassene
-- (users-and-sharing.sql seksjon 9g, docs/trash.md).
-- Kjøres mot en LOKAL PostgreSQL med tests/local-stub.sql +
-- users-and-sharing.sql lastet først (IKKE mot Supabase). Se run-tests.sh.
--
--   1. klokka stemples av serveren når noe legges i kassen, nullstilles ved
--      gjenoppretting, og kan ikke flyttes av klienten
--   2. en utdatert skriving (LWW-vakten ruller den tilbake) rører ikke klokka
--   3. standarden er 30 døgn
--   4. valget («1 time») styrer DEN SOM SLETTET sine rader — ikke andres
--   5. «umiddelbart» (0): purge_my_expired_trash tømmer straks
--   6. et ugyldig eller for langt valg gir standarden
--   7. innhold som er blitt låst etter slettingen, blir liggende
--   8. et område tas med hele undertreet sitt, og gravsteinene skrives
--   9. en notatbok tar ikke notatene med seg; idéene tømmes også
--  10. rader fra før feltet fantes (uten `trashed_by`) følger opphavspersonen
--  11. tømmingen er ikke en RPC — bare «mitt eget» er det
--
-- To brukere:
--   A = eier av alt
--   B = direkte mappemedlem i A sin mappe
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

-- Flytt klokka på ÉN rad tilbake i tid. Stempelet kan ikke overstyres gjennom
-- tabellen (det er hele poenget), så testen går rundt triggerne.
create or replace function public.t_age(tbl text, rid uuid, ago interval)
returns void language plpgsql as $$
begin
  set local session_replication_role = replica;
  execute format('update public.%I set trashed_at = now() - $1 where id = $2', tbl) using ago, rid;
end $$;

\set A  'aaaa7001-0000-0000-0000-0000000000a1'
\set B  'bbbb7002-0000-0000-0000-0000000000b2'
\set U  '1b000000-7777-0000-0000-000000000001'
\set G  '2b000000-7777-0000-0000-000000000001'
\set C1 '3b000000-7777-0000-0000-000000000001'
\set C2 '3b000000-7777-0000-0000-000000000002'
\set C3 '3b000000-7777-0000-0000-000000000003'
\set I1 '4b000000-7777-0000-0000-000000000001'
\set I2 '4b000000-7777-0000-0000-000000000002'
\set I3 '4b000000-7777-0000-0000-000000000003'
\set U2 '1b000000-7777-0000-0000-000000000002'
\set G2 '2b000000-7777-0000-0000-000000000002'
\set C9 '3b000000-7777-0000-0000-000000000009'
\set I9 '4b000000-7777-0000-0000-000000000009'
\set D1 '5b000000-7777-0000-0000-000000000001'
\set DK '5b000000-7777-0000-0000-000000000002'
\set D2 '5b000000-7777-0000-0000-000000000003'
\set NP '6b000000-7777-0000-0000-000000000001'
\set NF '7b000000-7777-0000-0000-000000000001'
\set N1 '8b000000-7777-0000-0000-000000000001'

-- ---------- 0. brukere + tre ----------
insert into auth.users (id, email) values
  (:'A', 'trash-a@example.com'), (:'B', 'trash-b@example.com')
on conflict (id) do nothing;

reset role; select set_config('request.jwt.claim.sub', :'A', false); set role authenticated;
insert into public.universes (id, owner_id, name, ts, org) values (:'U', :'A', 'Kasse', 1, 'a');
insert into public.groups (id, owner_id, universe_id, name, ts, org) values (:'G', :'A', :'U', 'Mappe', 1, 'a');
insert into public.cards (id, owner_id, group_id, title, ts, org) values
  (:'C1', :'A', :'G', 'En', 1, 'a'), (:'C2', :'A', :'G', 'To', 1, 'a'), (:'C3', :'A', :'G', 'Tre', 1, 'a');
insert into public.items (id, owner_id, card_id, text, ts, org) values
  (:'I1', :'A', :'C1', 'x', 1, 'a'), (:'I2', :'A', :'C1', 'y', 1, 'a'), (:'I3', :'A', :'C1', 'z', 1, 'a');
-- Et eget område som skal tømmes med hele undertreet.
insert into public.universes (id, owner_id, name, ts, org) values (:'U2', :'A', 'Hele treet', 1, 'a');
insert into public.groups (id, owner_id, universe_id, name, ts, org) values (:'G2', :'A', :'U2', 'Under', 1, 'a');
insert into public.cards (id, owner_id, group_id, title, ts, org) values (:'C9', :'A', :'G2', 'Under', 1, 'a');
insert into public.items (id, owner_id, card_id, text, ts, org) values (:'I9', :'A', :'C9', 'Under', 1, 'a');
insert into public.ideas (id, owner_id, text, ts, org) values (:'D1', :'A', 'Idé', 1, 'a');
insert into public.ideas (id, owner_id, text, is_cat, ts, org) values (:'DK', :'A', 'Kategori', true, 1, 'a');
insert into public.ideas (id, owner_id, text, cat_id, ts, org, pos_ts, pos_org) values (:'D2', :'A', 'Medlem', :'DK', 1, 'a', 1, 'a');
insert into public.note_projects (id, owner_id, name, ts, org) values (:'NP', :'A', 'Hylle', 1, 'a');
insert into public.note_folders (id, owner_id, project_id, name, ts, org) values (:'NF', :'A', :'NP', 'Bok', 1, 'a');
insert into public.notes (id, owner_id, project_id, folder_id, title, ts, org) values (:'N1', :'A', :'NP', :'NF', 'Notat', 1, 'a');

select public.create_share_invite('group', :'G', 'trash-b@example.com') ->> 'id' as inv \gset
reset role; select set_config('request.jwt.claim.sub', :'B', false); set role authenticated;
select public.accept_share_invite(:'inv'::uuid);

-- ---------- 1. klokka er serverens ----------
reset role; select set_config('request.jwt.claim.sub', :'A', false); set role authenticated;
update public.cards set trashed = true, ts = 2, org = 'a' where id = :'C1';
select public.t_check('å legge i kassen stempler tidspunktet og hvem',
  (select trashed_at is not null and trashed_at > now() - interval '1 minute' and trashed_by = :'A'
     from public.cards where id = :'C1'));
update public.cards set trashed_at = now() - interval '100 days', trashed_by = :'B', ts = 3, org = 'a' where id = :'C1';
select public.t_check('klienten kan ikke flytte klokka eller bytte hvem som slettet',
  (select trashed_at > now() - interval '1 minute' and trashed_by = :'A' from public.cards where id = :'C1'));
update public.cards set trashed = false, ts = 4, org = 'a' where id = :'C1';
select public.t_check('gjenoppretting nullstiller klokka',
  (select trashed_at is null and trashed_by is null from public.cards where id = :'C1'));
insert into public.cards (id, owner_id, group_id, title, trashed, trashed_at, ts, org)
  values ('3b000000-7777-0000-0000-0000000000ff', :'A', :'G', 'Født i kassen', true, now() - interval '100 days', 1, 'a');
select public.t_check('en rad som settes inn i kassen får serverens klokke, ikke klientens',
  (select trashed_at > now() - interval '1 minute' and trashed_by = :'A'
     from public.cards where id = '3b000000-7777-0000-0000-0000000000ff'));

-- ---------- 2. utdatert skriving ----------
update public.cards set trashed = true, ts = 1, org = 'a' where id = :'C2';
select public.t_check('en utdatert skriving (eldre register) verken legger i kassen eller starter klokka',
  (select not trashed and trashed_at is null from public.cards where id = :'C2'));

-- ---------- 3. standarden er 30 døgn ----------
update public.items set trashed = true, ts = 2, org = 'a' where id in (:'I1', :'I2');
reset role;
select public.t_age('items', :'I1', interval '29 days');
select public.t_age('items', :'I2', interval '31 days');
select public.purge_expired_trash();
select public.t_check('29 døgn i kassen: ligger fortsatt der',
  exists (select 1 from public.items where id = :'I1'));
select public.t_check('31 døgn i kassen: slettet for godt, med gravstein',
  not exists (select 1 from public.items where id = :'I2')
  and exists (select 1 from public.tombstones where resource_type = 'item' and resource_id = :'I2'));

-- ---------- 4. valget gjelder den som slettet ----------
-- B legger C2 i kassen (mappemedlem i en åpen mappe har sletterett), A velger
-- «1 time». B står på standarden.
reset role; select set_config('request.jwt.claim.sub', :'B', false); set role authenticated;
update public.cards set trashed = true, ts = 5, org = 'b' where id = :'C2';
reset role;
update auth.users set raw_user_meta_data = '{"trash_retention": 3600}' where id = :'A';
select public.t_check('fristen leses fra kontoens metadata',
  public.trash_retention(:'A') = interval '1 hour' and public.trash_retention(:'B') = interval '30 days');
select public.t_age('items', :'I1', interval '2 hours');
select public.t_age('cards', :'C2', interval '2 hours');
select public.purge_expired_trash();
select public.t_check('A sitt valg («1 time») tømmer det A la i kassen for to timer siden',
  not exists (select 1 from public.items where id = :'I1'));
select public.t_check('… men ikke det B la der — B står på 30 døgn',
  exists (select 1 from public.cards where id = :'C2'));

-- ---------- 5. «umiddelbart» ----------
update auth.users set raw_user_meta_data = '{"trash_retention": 0}' where id = :'A';
select set_config('request.jwt.claim.sub', :'A', false); set role authenticated;
update public.items set trashed = true, ts = 2, org = 'a' where id = :'I3';
update public.cards set trashed = true, ts = 2, org = 'a' where id = :'C3';
-- Hvert kall i sin egen setning: en spørring ser ikke slettinger en funksjon
-- gjør i den SAMME setningen (øyeblikksbildet er tatt før).
select public.purge_my_expired_trash() as tømt \gset
select public.t_check('purge_my_expired_trash tømmer straks når fristen er «umiddelbart»',
  :tømt >= 2
  and not exists (select 1 from public.items where id = :'I3')
  and not exists (select 1 from public.cards where id = :'C3'));
select public.t_check('… og rører ikke det B la i kassen',
  exists (select 1 from public.cards where id = :'C2'));
reset role; select set_config('request.jwt.claim.sub', :'B', false); set role authenticated;
select public.purge_my_expired_trash() as tømt \gset
select public.t_check('B sin «tøm mitt» når ikke As søppel og ikke sitt eget før fristen',
  :tømt = 0 and exists (select 1 from public.cards where id = :'C2'));

select set_config('request.jwt.claim.sub', :'A', false); set role authenticated;
select public.t_check('get_my_doc bærer kontoens frist, så en åpen fane ser et bytte',
  (public.get_my_doc() -> 'user' ->> 'trash_retention') = '0');
reset role;

-- ---------- 6. ugyldige valg ----------
reset role;
update auth.users set raw_user_meta_data = '{"trash_retention": "tull"}' where id = :'B';
select public.t_check('et ugyldig valg gir standarden', public.trash_retention(:'B') = interval '30 days');
update auth.users set raw_user_meta_data = '{"trash_retention": 999999999}' where id = :'B';
select public.t_check('et valg lenger enn standarden gir standarden', public.trash_retention(:'B') = interval '30 days');
update auth.users set raw_user_meta_data = '{"trash_retention": -5}' where id = :'B';
select public.t_check('et negativt valg gir standarden', public.trash_retention(:'B') = interval '30 days');

-- ---------- 7. låst etter slettingen ----------
select set_config('request.jwt.claim.sub', :'A', false); set role authenticated;
select public.set_locked('group', :'G', true);
reset role;
update auth.users set raw_user_meta_data = '{"trash_retention": 3600}' where id = :'B';
select public.t_age('cards', :'C2', interval '2 hours');
select public.purge_expired_trash();
select public.t_check('en liste som er blitt LÅST etter at B slettet den, blir liggende i kassen',
  exists (select 1 from public.cards where id = :'C2'));
select set_config('request.jwt.claim.sub', :'A', false); set role authenticated;
select public.set_locked('group', :'G', false);
reset role;
select public.purge_expired_trash();
select public.t_check('… og tømmes når låsen er borte igjen',
  not exists (select 1 from public.cards where id = :'C2'));

-- ---------- 8. et område med hele undertreet ----------
update auth.users set raw_user_meta_data = '{"trash_retention": 3600}' where id = :'A';
select set_config('request.jwt.claim.sub', :'A', false); set role authenticated;
update public.universes set trashed = true, ts = 2, org = 'a' where id = :'U2';
reset role;
select public.t_age('universes', :'U2', interval '2 hours');
select public.purge_expired_trash();
select public.t_check('området er borte med mapper, lister og listepunkter',
  not exists (select 1 from public.universes where id = :'U2')
  and not exists (select 1 from public.groups where id = :'G2')
  and not exists (select 1 from public.cards where id = :'C9')
  and not exists (select 1 from public.items where id = :'I9'));
select public.t_check('… og hvert nivå har fått gravstein',
  (select count(*) from public.tombstones
    where resource_id in (:'U2', :'G2', :'C9', :'I9')) = 4);

-- ---------- 9. notatbok og idé ----------
select set_config('request.jwt.claim.sub', :'A', false); set role authenticated;
update public.note_folders set trashed = true, ts = 2, org = 'a' where id = :'NF';
update public.ideas set trashed = true, ts = 2, org = 'a' where id in (:'D1', :'DK');
reset role;
select public.t_age('note_folders', :'NF', interval '2 hours');
select public.t_age('ideas', :'D1', interval '2 hours');
select public.t_age('ideas', :'DK', interval '2 hours');
select public.purge_expired_trash();
select public.t_check('notatboken er tømt, men notatet ble et fritt notat i bokhyllen',
  not exists (select 1 from public.note_folders where id = :'NF')
  and exists (select 1 from public.notes where id = :'N1' and folder_id is null and not trashed));
select public.t_check('idéen er tømt',
  not exists (select 1 from public.ideas where id = :'D1'));
select public.t_check('en tømt idékategori løsner medlemmene sine i stedet for å slette dem',
  not exists (select 1 from public.ideas where id = :'DK')
  and exists (select 1 from public.ideas where id = :'D2' and cat_id is null));

-- ---------- 10. rader uten `trashed_by` ----------
set session_replication_role = replica;
update public.notes set trashed = true, trashed_at = now() - interval '2 hours', trashed_by = null where id = :'N1';
set session_replication_role = origin;
select public.purge_expired_trash();
select public.t_check('en søppelrad uten «hvem» følger opphavspersonens valg',
  not exists (select 1 from public.notes where id = :'N1'));

-- ---------- 11. ikke en RPC ----------
select set_config('request.jwt.claim.sub', :'B', false); set role authenticated;
select public.t_fails('purge_expired_trash kan ikke kalles av en innlogget bruker',
  'select public.purge_expired_trash()');
select public.t_fails('trash_retention kan ikke kalles av en innlogget bruker',
  format('select public.trash_retention(%L)', :'A'));
reset role;

drop function public.t_age(text, uuid, interval);
