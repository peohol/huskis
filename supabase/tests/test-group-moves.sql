-- ============================================================
-- Testsuite for move_group(): den ENESTE veien en mappe bytter område.
--   * samme område          → ren omplassering (delt posisjon/kategori)
--   * samme eierskapsdomene  → ekte REPARENTING (id-er, roller og medlemmer består)
--   * ulikt eierskapsdomene  → KOPIER-OG-SLETT (nye id-er + gravsteiner)
--
-- Kjøres mot en LOKAL PostgreSQL med tests/local-stub.sql +
-- users-and-sharing.sql lastet først. Se run-tests.sh.
--
-- Brukere:
--   P = eier av U1 og U3 (eierskapsdomene {P})
--   Q = MEDEIER av U2 sammen med P (eierskapsdomene {P,Q})
--   R = vanlig medlem av U1
--   S = DIREKTE mappemedlem i G (ingen områderolle)
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

\set P 'aa000000-2222-0000-0000-0000000000a2'
\set Q 'bb000000-2222-0000-0000-0000000000b2'
\set R 'cc000000-2222-0000-0000-0000000000c2'
\set S 'dd000000-2222-0000-0000-0000000000d2'
\set U1 '10000000-2222-0000-0000-000000000001'
\set U2 '10000000-2222-0000-0000-000000000002'
\set U3 '10000000-2222-0000-0000-000000000003'
\set G  '20000000-2222-0000-0000-000000000001'
\set GB '20000000-2222-0000-0000-000000000002'
\set GC '20000000-2222-0000-0000-000000000003'
\set L  '30000000-2222-0000-0000-000000000001'
\set IC '40000000-2222-0000-0000-000000000001'
\set IT '40000000-2222-0000-0000-000000000002'

insert into auth.users (id, email) values
  (:'P', 'move-p@example.com'), (:'Q', 'move-q@example.com'),
  (:'R', 'move-r@example.com'), (:'S', 'move-s@example.com')
on conflict (id) do nothing;

-- ---------- 0. Tre områder, to eierskapsdomener ----------
reset role; select set_config('request.jwt.claim.sub', :'P', false); set role authenticated;
insert into public.universes (id, owner_id, name, ts, org, pos) values (:'U1', :'P', 'Mitt', 1, 'p', 1);
insert into public.universes (id, owner_id, name, ts, org, pos) values (:'U2', :'P', 'Delt', 1, 'p', 2);
insert into public.universes (id, owner_id, name, ts, org, pos) values (:'U3', :'P', 'Mitt to', 1, 'p', 3);
select public.create_share_invite('universe', :'U2', 'move-q@example.com', 'owner') ->> 'id' as inv_q \gset
select public.create_share_invite('universe', :'U1', 'move-r@example.com') ->> 'id' as inv_r \gset
reset role; select set_config('request.jwt.claim.sub', :'Q', false); set role authenticated;
select public.accept_share_invite(:'inv_q'::uuid);
reset role; select set_config('request.jwt.claim.sub', :'R', false); set role authenticated;
select public.accept_share_invite(:'inv_r'::uuid);

reset role; select set_config('request.jwt.claim.sub', :'P', false); set role authenticated;
insert into public.groups (id, owner_id, universe_id, name, ts, org, pos) values (:'G', :'P', :'U1', 'Flyttbar', 1, 'p', 1);
insert into public.groups (id, owner_id, universe_id, name, ts, org, pos) values (:'GB', :'P', :'U1', 'Naboen', 1, 'p', 2);
insert into public.groups (id, owner_id, universe_id, name, is_cat, ts, org, pos) values (:'GC', :'P', :'U3', 'Kategori', true, 1, 'p', 1);
insert into public.cards (id, owner_id, group_id, title, ts, org) values (:'L', :'P', :'G', 'Innhold', 1, 'p');
insert into public.items (id, owner_id, card_id, text, is_cat, ts, org, pos) values (:'IC', :'P', :'L', 'Kat', true, 1, 'p', 1);
insert into public.items (id, owner_id, card_id, cat_id, text, responsible, ts, org, pos)
  values (:'IT', :'P', :'L', :'IC', 'Punkt', :'R', 1, 'p', 2);
select public.create_share_invite('group', :'G', 'move-s@example.com') ->> 'id' as inv_s \gset
reset role; select set_config('request.jwt.claim.sub', :'S', false); set role authenticated;
select public.accept_share_invite(:'inv_s'::uuid);

select public.t_check('eierskapsdomenene: U1 = U3 = {P}, U2 = {P,Q}',
  public.universe_owner_set(:'U1') = public.universe_owner_set(:'U3')
  and public.universe_owner_set(:'U1') <> public.universe_owner_set(:'U2'));

-- ---------- 1. Omplassering i SAMME område ----------
reset role; select set_config('request.jwt.claim.sub', :'P', false); set role authenticated;
select public.move_group(:'G', :'U1', null, 5) ->> 'mode' as m1 \gset
select public.t_check('samme område = ren omplassering (ingen flytting)',
  :'m1' = 'reorder'
  and (select pos from public.groups where id = :'G') = 5
  and (select universe_id from public.groups where id = :'G') = :'U1'::uuid);

-- ---------- 2. Rettighetskrav ----------
reset role; select set_config('request.jwt.claim.sub', :'S', false); set role authenticated;
select public.t_fails('et vanlig direkte mappemedlem kan ikke flytte mappen',
  format('select public.move_group(%L, %L)', :'G', :'U3'));
reset role; select set_config('request.jwt.claim.sub', :'R', false); set role authenticated;
select public.t_fails('kilde krever destruktiv myndighet — låst mappe kan ikke flyttes av et medlem',
  format('select public.move_group(%L, %L)', :'GB', :'U2'));
select public.t_check('… fordi R mangler opprettelsesrett i U2 (og ikke er medlem der)',
  not public.can_create_child('universe', :'U2', :'R'));
select public.t_check('ingenting endret seg av det avviste forsøket (full rollback)',
  (select universe_id from public.groups where id = :'GB') = :'U1'::uuid
  and (select count(*) from public.groups where universe_id = :'U2') = 0);

-- ---------- 3. SAMME eierskapsdomene: ekte reparenting ----------
reset role; select set_config('request.jwt.claim.sub', :'P', false); set role authenticated;
select public.move_group(:'G', :'U3', :'GC', 7) ->> 'mode' as m2 \gset
select public.t_check('samme domene → reparenting med samme id',
  :'m2' = 'reparent'
  and (select universe_id from public.groups where id = :'G') = :'U3'::uuid
  and (select cat_id from public.groups where id = :'G') = :'GC'::uuid
  and (select pos from public.groups where id = :'G') = 7);
select public.t_check('lister, kategorier og listepunkter beholder id-ene sine',
  (select count(*) from public.cards where id = :'L' and group_id = :'G') = 1
  and (select count(*) from public.items where id = :'IT' and cat_id = :'IC') = 1);
select public.t_check('direkte mappemedlemmer og roller består',
  public.group_role(:'G', :'S') = 'member');
select public.t_check('ansvarstildeling til R nullstilles (R mistet effektiv tilgang)',
  (select responsible from public.items where id = :'IT') is null);
reset role; select set_config('request.jwt.claim.sub', :'R', false); set role authenticated;
select public.t_check('kildeområdets arvede medlem mister tilgang',
  not public.is_group_member(:'G', :'R')
  and (select count(*) from public.cards where id = :'L') = 0);
reset role; select set_config('request.jwt.claim.sub', :'S', false); set role authenticated;
select public.t_check('det direkte mappemedlemmet beholder tilgang, fortsatt som FRI mappe',
  (select (x -> 'free')::boolean from jsonb_array_elements(public.get_my_doc() -> 'groups') x
    where x ->> 'id' = :'G') = true);

-- ---------- 4. ULIKT eierskapsdomene: kopier-og-slett ----------
reset role; select set_config('request.jwt.claim.sub', :'P', false); set role authenticated;
select public.move_group(:'G', :'U2', null, 9) as res \gset
select (:'res'::jsonb) ->> 'mode' as m3 \gset
select (:'res'::jsonb) ->> 'group' as newg \gset
select ((:'res'::jsonb) -> 'mapping') ->> :'L' as newl \gset
select ((:'res'::jsonb) -> 'mapping') ->> :'IT' as newit \gset
select public.t_check('ulikt domene → kopier-og-slett med NYE id-er',
  :'m3' = 'copy' and :'newg' <> :'G' and :'newl' <> :'L' and :'newit' <> :'IT');
select public.t_check('den nye mappen ligger i målområdet, med aktøren som oppretter',
  (select universe_id from public.groups where id = :'newg'::uuid) = :'U2'::uuid
  and (select owner_id from public.groups where id = :'newg'::uuid) = :'P'::uuid);
select public.t_check('innholdet fulgte med (liste + kategori + listepunkt), med bevart nøsting',
  (select title from public.cards where id = :'newl'::uuid) = 'Innhold'
  and (select count(*) from public.items where card_id = :'newl'::uuid) = 2
  and (select cat_id from public.items where id = :'newit'::uuid) is not null);
select public.t_check('det GAMLE treet er borte',
  (select count(*) from public.groups where id = :'G') = 0
  and (select count(*) from public.cards where id = :'L') = 0
  and (select count(*) from public.items where id in (:'IC', :'IT')) = 0);
select public.t_check('gravsteiner for hver eneste gamle id',
  (select count(*) from public.tombstones where resource_id in (:'G', :'L', :'IC', :'IT')) = 4);
select public.t_check('gamle medlemskap/eiere følger IKKE med over domenegrensen',
  (select count(*) from public.memberships where group_id = :'newg'::uuid and user_id = :'S') = 0);
select public.t_check('aktøren har full myndighet i den nye mappen',
  public.is_group_owner(:'newg'::uuid, :'P'));

reset role; select set_config('request.jwt.claim.sub', :'S', false); set role authenticated;
select public.t_check('det gamle mappemedlemmet mister ALL tilgang',
  (select count(*) from public.groups where id = :'newg'::uuid) = 0
  and (select count(*) from public.cards where id = :'newl'::uuid) = 0
  and jsonb_array_length(public.get_my_doc() -> 'groups') = 0);
select public.t_fails('en gammel offline-klient kan ikke gjenopplive det gamle treet',
  format('insert into public.cards (id, owner_id, group_id, title, ts, org) values (%L, %L, %L, ''Innhold'', 99, ''s'')',
         :'L', :'S', :'G'));

-- ---------- 5. Målområdets medlemmer får tilgang ----------
reset role; select set_config('request.jwt.claim.sub', :'Q', false); set role authenticated;
select public.t_check('medeieren i målområdet ser den nye mappen inne i området',
  (select (x -> 'free')::boolean from jsonb_array_elements(public.get_my_doc() -> 'groups') x
    where x ->> 'id' = :'newg') = false
  and (select count(*) from public.cards where id = :'newl'::uuid) = 1);

select public.t_fails('Q kan ikke flytte mappen til et område Q ikke er medlem av',
  format('select public.move_group(%L, %L)', :'newg', :'U1'));

-- ---------- 6. Delt → eget område (også en domenekryssing) ----------
reset role; select set_config('request.jwt.claim.sub', :'P', false); set role authenticated;
select public.move_group(:'newg'::uuid, :'U1', null, 3) as res2 \gset
select (:'res2'::jsonb) ->> 'mode' as m4 \gset
select (:'res2'::jsonb) ->> 'group' as newg2 \gset
select public.t_check('delt → eget område krysser domenegrensen',
  :'m4' = 'copy' and :'newg2' <> :'newg');
select public.t_check('P ser den nye mappen i U1',
  (select universe_id from public.groups where id = :'newg2'::uuid) = :'U1'::uuid);
reset role; select set_config('request.jwt.claim.sub', :'Q', false); set role authenticated;
select public.t_check('… og Q (som ikke er medlem av U1) mister tilgangen',
  (select count(*) from public.groups where id = :'newg2'::uuid) = 0
  and (select count(*) from public.groups where id = :'newg'::uuid) = 0);
reset role; select set_config('request.jwt.claim.sub', :'P', false); set role authenticated;

-- ---------- 7. Fri mappe → område, og ugyldige mål ----------
select public.t_fails('en mappekategori kan ikke flyttes til et annet område',
  format('select public.move_group(%L, %L)', :'GC', :'U1'));
select public.t_fails('ukjent målområdet avvises',
  format('select public.move_group(%L, ''00000000-0000-0000-0000-0000000000ff'')', :'GB'));
select public.t_fails('en mappekategori fra et ANNET område er ugyldig mål-kategori',
  format('select public.move_group(%L, %L, %L)', :'GB', :'U1', :'GC'));
select public.t_check('kilden er uendret etter de avviste forsøkene',
  (select universe_id from public.groups where id = :'GB') = :'U1'::uuid
  and (select cat_id from public.groups where id = :'GB') is null);

-- En FRI mappe (mottakeren er ikke medlem av det kanoniske området) kan
-- flyttes inn i et område mottakeren kan opprette i — det krysser domenet.
reset role; select set_config('request.jwt.claim.sub', :'P', false); set role authenticated;
insert into public.groups (id, owner_id, universe_id, name, ts, org, pos)
  values ('20000000-2222-0000-0000-00000000000f', :'P', :'U1', 'Til S', 1, 'p', 9);
select public.create_share_invite('group', '20000000-2222-0000-0000-00000000000f', 'move-s@example.com', 'owner') ->> 'id' as inv_s2 \gset
reset role; select set_config('request.jwt.claim.sub', :'S', false); set role authenticated;
select public.accept_share_invite(:'inv_s2'::uuid);
insert into public.universes (id, owner_id, name, ts, org, pos)
  values ('10000000-2222-0000-0000-00000000000f', :'S', 'S sitt', 1, 's', 1);
select public.move_group('20000000-2222-0000-0000-00000000000f',
                         '10000000-2222-0000-0000-00000000000f', null, 1) ->> 'mode' as m5 \gset
select public.t_check('fri mappe → eget område er en domenekryssing (kopier-og-slett)',
  :'m5' = 'copy');
select public.t_check('mappen vises nå INNE i S sitt område',
  (select count(*) from public.groups where universe_id = '10000000-2222-0000-0000-00000000000f') = 1
  and (select count(*) from public.groups where id = '20000000-2222-0000-0000-00000000000f') = 0);

reset role;
select 'ALLE MAPPEFLYTTINGS-TESTER GRØNNE' as resultat;
