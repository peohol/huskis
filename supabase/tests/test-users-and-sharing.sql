-- ============================================================
-- Testsuite for users-and-sharing.sql — kjøres mot en LOKAL
-- PostgreSQL med tests/local-stub.sql lastet først (IKKE mot
-- Supabase). Se tests/run-tests.sh.
--
-- Mønster: hver bruker «logges inn» ved å sette JWT-sub-claimet
-- og bytte til rollen authenticated — nøyaktig slik PostgREST
-- gjør det i Supabase. t_check/t_fails feiler hardt (ON_ERROR_STOP).
-- ============================================================

\set ON_ERROR_STOP on

-- ---------- testhjelpere (som superbruker) ----------
reset role;

create or replace function public.t_check(name text, cond boolean)
returns text language plpgsql as $$
begin
  if cond is distinct from true then
    raise exception 'FAIL: %', name;
  end if;
  return 'PASS: ' || name;
end $$;

create or replace function public.t_fails(name text, cmd text)
returns text language plpgsql as $$
begin
  begin
    execute cmd;
  exception when others then
    return 'PASS (blokkert): ' || name || ' — ' || sqlerrm;
  end;
  raise exception 'FAIL (skulle vært blokkert): %', name;
end $$;

grant execute on function public.t_check(text, boolean) to public;
grant execute on function public.t_fails(text, text) to public;

-- ---------- faste id-er ----------
\set alice  'aaaaaaaa-0000-0000-0000-000000000001'
\set bob    'bbbbbbbb-0000-0000-0000-000000000002'
\set carol  'cccccccc-0000-0000-0000-000000000003'
\set dave   'dddddddd-0000-0000-0000-000000000004'
\set u1     '10000000-0000-0000-0000-000000000001'
\set ub     '10000000-0000-0000-0000-000000000002'
\set g1     '20000000-0000-0000-0000-000000000001'
\set gb     '20000000-0000-0000-0000-000000000002'
\set gcarol '20000000-0000-0000-0000-000000000003'
\set c1     '30000000-0000-0000-0000-000000000001'
\set i1     '40000000-0000-0000-0000-000000000001'

-- ---------- A. registrering => profil (trigger) ----------
insert into auth.users (id, email) values
  (:'alice', 'alice@example.com'),
  (:'bob',   'Bob@Example.com'),          -- blandet case => lower()
  (:'carol', 'carol@example.com')
on conflict (id) do nothing;

select public.t_check('profil opprettes automatisk ved registrering',
  (select count(*) from public.profiles) = 3);
select public.t_check('e-post lagres lowercase',
  exists (select 1 from public.profiles where id = :'bob' and email = 'bob@example.com'));

-- ---------- B. Alice bygger sitt eget innhold ----------
select set_config('request.jwt.claim.sub', :'alice', false);
set role authenticated;

insert into public.universes (id, owner_id, name, ts, org) values (:'u1', :'alice', 'Hjemme', 1, 'alice');
insert into public.groups (id, owner_id, universe_id, name, ts, org) values (:'g1', :'alice', :'u1', 'Huskelister', 1, 'alice');
insert into public.cards (id, owner_id, group_id, title, ts, org) values (:'c1', :'alice', :'g1', 'Handleliste', 1, 'alice');
insert into public.items (id, owner_id, card_id, text, ts, org) values (:'i1', :'alice', :'c1', 'Melk', 1, 'alice');

select public.t_check('alice ser sitt eget univers',
  (select count(*) from public.universes) = 1);

select public.t_fails('alice kan ikke opprette univers for andre',
  format('insert into public.universes (owner_id, name) values (%L, ''x'')', :'bob'));

-- ---------- C. Bob ser ingenting og kommer ikke inn ----------
reset role;
select set_config('request.jwt.claim.sub', :'bob', false);
set role authenticated;

select public.t_check('bob ser ingen universer', (select count(*) from public.universes) = 0);
select public.t_check('bob ser ingen grupper',   (select count(*) from public.groups) = 0);
select public.t_check('bob ser ingen lister',    (select count(*) from public.cards) = 0);
select public.t_check('bob ser ingen elementer', (select count(*) from public.items) = 0);
select public.t_check('bob ser kun egen profil', (select count(*) from public.profiles) = 1);

select public.t_fails('bob kan ikke opprette gruppe i alices univers',
  format('insert into public.groups (owner_id, universe_id, name) values (%L, %L, ''inntrenger'')', :'bob', :'u1'));

insert into public.universes (id, owner_id, name, ts, org) values (:'ub', :'bob', 'Bobs univers', 1, 'bob');
insert into public.groups (id, owner_id, universe_id, name, ts, org) values (:'gb', :'bob', :'ub', 'Bobs gruppe', 1, 'bob');

-- ---------- D. gruppe-deling: Alice -> Bob ----------
reset role;
select set_config('request.jwt.claim.sub', :'alice', false);
set role authenticated;

select public.create_share_invite('group', :'g1', 'bob@example.com') ->> 'id' as inv1 \gset

select public.t_fails('duplikat ventende invitasjon avvises',
  format('select public.create_share_invite(''group'', %L, ''bob@example.com'')', :'g1'));
select public.t_fails('kan ikke dele med seg selv',
  format('select public.create_share_invite(''group'', %L, ''alice@example.com'')', :'g1'));

reset role;
select set_config('request.jwt.claim.sub', :'bob', false);
set role authenticated;

select public.t_check('bob ser invitasjonen i get_my_doc',
  jsonb_array_length(public.get_my_doc() -> 'invites_in') = 1);
select public.t_fails('gruppe-deling krever valg av univers',
  format('select public.accept_share_invite(%L)', :'inv1'));
select public.t_fails('kan ikke montere i univers uten tilgang',
  format('select public.accept_share_invite(%L, %L)', :'inv1', :'u1'));

select public.accept_share_invite(:'inv1'::uuid, :'ub'::uuid, 5) is not null as ok \gset
select public.t_check('bob aksepterte med plassering i eget univers', :'ok');
select public.t_check('bob ser den delte gruppen', (select count(*) from public.groups where id = :'g1') = 1);
select public.t_check('bob ser listen i den delte gruppen', (select count(*) from public.cards where id = :'c1') = 1);
select public.t_check('bob ser elementene', (select count(*) from public.items where id = :'i1') = 1);
select public.t_check('mount peker på bobs univers',
  (select jsonb_path_query_first(public.get_my_doc(), '$.groups[*] ? (@.id == $gid).mount.parent',
     jsonb_build_object('gid', :'g1'::text)) = to_jsonb(:'ub'::text)));

-- redigering + felt-nivå LWW
update public.items set text = 'Melk og brød', ts = 100, org = 'bob' where id = :'i1';
select public.t_check('bob kan redigere delt innhold',
  (select text from public.items where id = :'i1') = 'Melk og brød');

update public.items set text = 'GAMMEL', ts = 5, org = 'bob' where id = :'i1';
select public.t_check('utdatert skriving taper (LWW beholder nyeste)',
  (select text || ':' || ts from public.items where id = :'i1') = 'Melk og brød:100');

select public.t_fails('owner_id kan ikke endres',
  format('update public.groups set owner_id = %L where id = %L', :'bob', :'g1'));
select public.t_fails('bare eier kan låse',
  format('select public.set_locked(''group'', %L, true)', :'g1'));
select public.t_fails('bare eier kan dele videre',
  format('select public.create_share_invite(''group'', %L, ''carol@example.com'')', :'g1'));
select public.t_fails('bare eier kan kaste ut',
  format('select public.revoke_share(''group'', %L, %L)', :'g1', :'alice'));

-- lås: eieren fryser redigering for andre
reset role;
select set_config('request.jwt.claim.sub', :'alice', false);
set role authenticated;
select public.set_locked('group', :'g1', true);

reset role;
select set_config('request.jwt.claim.sub', :'bob', false);
set role authenticated;
update public.cards set title = 'HACK', ts = 200, org = 'bob' where id = :'c1';
select public.t_check('låst gruppe: bobs redigering biter ikke',
  (select title from public.cards where id = :'c1') = 'Handleliste');
select public.t_fails('låst gruppe: bob kan ikke legge til element',
  format('insert into public.items (owner_id, card_id, text) values (%L, %L, ''nei'')', :'bob', :'c1'));
select public.t_check('låst gruppe: bob kan fortsatt LESE',
  (select count(*) from public.cards where id = :'c1') = 1);

reset role;
select set_config('request.jwt.claim.sub', :'alice', false);
set role authenticated;
update public.cards set title = 'Handleliste 2', ts = 300, org = 'alice' where id = :'c1';
select public.t_check('eieren kan redigere selv om låst',
  (select title from public.cards where id = :'c1') = 'Handleliste 2');
select public.set_locked('group', :'g1', false);
select public.set_locked('universe', :'u1', true);   -- lås på forelder gjelder nedover

reset role;
select set_config('request.jwt.claim.sub', :'bob', false);
set role authenticated;
update public.items set text = 'HACK', ts = 400, org = 'bob' where id = :'i1';
select public.t_check('låst UNIVERS fryser også delt gruppe under',
  (select text from public.items where id = :'i1') = 'Melk og brød');

reset role;
select set_config('request.jwt.claim.sub', :'alice', false);
set role authenticated;
select public.set_locked('universe', :'u1', false);

-- mottakeren forlater (= «slett» hos mottakeren) — eierens data består
reset role;
select set_config('request.jwt.claim.sub', :'bob', false);
set role authenticated;
select public.leave_share('group', :'g1');
select public.t_check('etter leave: bob ser ikke gruppen lenger',
  (select count(*) from public.groups where id = :'g1') = 0);

reset role;
select set_config('request.jwt.claim.sub', :'alice', false);
set role authenticated;
select public.t_check('etter leave: alices gruppe består urørt',
  (select count(*) from public.groups where id = :'g1') = 1);

-- eieren kaster ut (revoke)
select public.create_share_invite('group', :'g1', 'bob@example.com') ->> 'id' as inv2 \gset
reset role;
select set_config('request.jwt.claim.sub', :'bob', false);
set role authenticated;
select public.accept_share_invite(:'inv2'::uuid, :'ub'::uuid);
select public.t_check('bob er inne igjen', (select count(*) from public.groups where id = :'g1') = 1);

reset role;
select set_config('request.jwt.claim.sub', :'alice', false);
set role authenticated;
select public.revoke_share('group', :'g1', :'bob');

reset role;
select set_config('request.jwt.claim.sub', :'bob', false);
set role authenticated;
select public.t_check('etter utkastelse: bob ser ikke gruppen',
  (select count(*) from public.groups where id = :'g1') = 0);

-- ---------- E. univers-deling: Alice -> Carol ----------
reset role;
select set_config('request.jwt.claim.sub', :'alice', false);
set role authenticated;
select public.create_share_invite('universe', :'u1', 'carol@example.com') ->> 'id' as inv3 \gset

reset role;
select set_config('request.jwt.claim.sub', :'carol', false);
set role authenticated;
select public.accept_share_invite(:'inv3'::uuid);
select public.t_check('carol ser hele universet (gruppe/liste/element)',
  (select count(*) from public.groups where id = :'g1') = 1
  and (select count(*) from public.cards where id = :'c1') = 1
  and (select count(*) from public.items where id = :'i1') = 1);

insert into public.groups (id, owner_id, universe_id, name, ts, org)
  values (:'gcarol', :'carol', :'u1', 'Carols gruppe', 1, 'carol');
select public.t_check('carol kan opprette gruppe i delt univers',
  (select count(*) from public.groups where id = :'gcarol') = 1);

update public.memberships set trashed = true where user_id = :'carol' and universe_id = :'u1';
select public.t_check('carols mount kan legges i HENNES søppelkasse',
  (select jsonb_path_query_first(public.get_my_doc(), '$.universes[*] ? (@.id == $uid).mount.trashed',
     jsonb_build_object('uid', :'u1'::text)) = 'true'::jsonb));
update public.memberships set trashed = false where user_id = :'carol' and universe_id = :'u1';

reset role;
select set_config('request.jwt.claim.sub', :'alice', false);
set role authenticated;
select public.t_check('alice ser carols gruppe i sitt univers',
  (select count(*) from public.groups where universe_id = :'u1') = 2);
select public.t_check('alice ser medlemslisten',
  jsonb_array_length(public.get_members('universe', :'u1') -> 'members') = 1);

-- ---------- F. liste-deling: Alice -> Bob (direkte kort) ----------
select public.create_share_invite('card', :'c1', 'bob@example.com') ->> 'id' as inv4 \gset

reset role;
select set_config('request.jwt.claim.sub', :'bob', false);
set role authenticated;
select public.accept_share_invite(:'inv4'::uuid, :'gb'::uuid, 2);
select public.t_check('bob ser den delte listen + elementer, men IKKE gruppen dens',
  (select count(*) from public.cards where id = :'c1') = 1
  and (select count(*) from public.items where id = :'i1') = 1
  and (select count(*) from public.groups where id = :'g1') = 0);

select public.t_fails('mottaker kan ikke flytte kanonisk forelder (må bruke mount)',
  format('update public.cards set group_id = %L, pos_ts = 999, pos_org = ''bob'' where id = %L', :'gb', :'c1'));
select public.t_fails('mount kan ikke flyttes til gruppe uten tilgang',
  format('update public.memberships set parent_group_id = %L where card_id = %L and user_id = %L', :'g1', :'c1', :'bob'));

-- slettes mottakerens forelder, blir mounten «umontert» (ikke slettet)
delete from public.groups where id = :'gb';
select public.t_check('mount overlever at forelderen slettes (parent = null)',
  (select parent_group_id is null from public.memberships where card_id = :'c1' and user_id = :'bob')
  and (select count(*) from public.cards where id = :'c1') = 1);

-- ---------- G. invitasjon før konto finnes (kobles ved registrering) ----------
reset role;
select set_config('request.jwt.claim.sub', :'alice', false);
set role authenticated;
select public.create_share_invite('universe', :'u1', 'dave@example.com') ->> 'id' as inv5 \gset

reset role;
insert into auth.users (id, email) values (:'dave', 'dave@example.com');
select public.t_check('ventende invitasjon kobles til ny bruker ved registrering',
  (select invitee_id from public.share_invites where id = :'inv5') = :'dave'::uuid);

select set_config('request.jwt.claim.sub', :'dave', false);
set role authenticated;
select public.accept_share_invite(:'inv5'::uuid);
select public.t_check('dave kom inn i universet', (select count(*) from public.cards where id = :'c1') = 1);

-- ---------- H. import av legacy-doc (deterministisk + idempotent) ----------
reset role;
select set_config('request.jwt.claim.sub', :'bob', false);
set role authenticated;

select public.import_doc('{
  "universes": [{"id": "uni-standard", "name": "Standard", "ts": 10, "org": "x", "pos": 1}],
  "groups": [
    {"id": "grp-1", "uni": "uni-standard", "name": "Gamle grupper", "ts": 10, "org": "x", "pos": 1},
    {"id": "grp-orphan", "uni": "finnes-ikke", "name": "Foreldreløs", "ts": 10, "org": "x"}
  ],
  "cards": [{"id": "card-1", "group": "grp-1", "title": "Gammel liste", "k": true, "p": false, "ts": 10, "org": "x"}],
  "items": [{"id": "item-1", "home": "card-1", "text": "Gammelt element", "ts": 10, "org": "x"}]
}'::jsonb) as import1 \gset

select public.t_check('import: riktige antall (foreldreløs gruppe hoppet over)',
  (:'import1'::jsonb) = '{"universes": 1, "groups": 1, "cards": 1, "items": 1}'::jsonb);
select public.t_check('import: data på plass med deterministisk id',
  (select count(*) from public.universes where id = public.legacy_uuid(:'bob', 'uni-standard')) = 1
  and (select count(*) from public.items where id = public.legacy_uuid(:'bob', 'item-1')) = 1);

select (select count(*) from public.universes) as uni_before \gset
select public.import_doc('{
  "universes": [{"id": "uni-standard", "name": "Standard", "ts": 10, "org": "x", "pos": 1}]
}'::jsonb) is not null as ok2 \gset
select public.t_check('import er idempotent (ingen duplikater ved re-kjøring)',
  (select count(*) from public.universes) = :'uni_before');

-- ---------- I. hard sletting + gravsteiner ----------
reset role;
select set_config('request.jwt.claim.sub', :'carol', false);
set role authenticated;
delete from public.universes where id = :'u1';   -- RLS filtrerer stille: 0 rader
select public.t_check('bare eieren kan hardslette universet (RLS: 0 rader slettet)',
  (select count(*) from public.universes where id = :'u1') = 1);

reset role;
select set_config('request.jwt.claim.sub', :'alice', false);
set role authenticated;
delete from public.universes where id = :'u1';
select public.t_check('alice slettet sitt univers', (select count(*) from public.universes) = 0);
select public.t_check('gravsteiner skrevet for alle nivåer',
  (select count(*) from public.tombstones where resource_type = 'universe') >= 1
  and (select count(*) from public.tombstones where resource_type = 'group') >= 2
  and (select count(*) from public.tombstones where resource_type = 'card') >= 1
  and (select count(*) from public.tombstones where resource_type = 'item') >= 1);

reset role;
select set_config('request.jwt.claim.sub', :'carol', false);
set role authenticated;
select public.t_check('carols medlemskap forsvant med universet',
  (select count(*) from public.memberships where user_id = :'carol') = 0);

-- ---------- J. anon har null tilgang til de nye tabellene ----------
reset role;
select set_config('request.jwt.claim.sub', '', false);
set role anon;
select public.t_fails('anon kan ikke lese universes',  'select count(*) from public.universes');
select public.t_fails('anon kan ikke lese profiles',   'select count(*) from public.profiles');
select public.t_fails('anon kan ikke kalle get_my_doc', 'select public.get_my_doc()');

reset role;
select 'ALLE TESTER GRØNNE' as resultat;
