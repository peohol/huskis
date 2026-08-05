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
\set g2     '20000000-0000-0000-0000-000000000004'
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

select public.t_check('alice ser sitt eget område',
  (select count(*) from public.universes) = 1);

select public.t_fails('alice kan ikke opprette område for andre',
  format('insert into public.universes (owner_id, name) values (%L, ''x'')', :'bob'));

-- ---------- C. Bob ser ingenting og kommer ikke inn ----------
reset role;
select set_config('request.jwt.claim.sub', :'bob', false);
set role authenticated;

select public.t_check('bob ser ingen områder', (select count(*) from public.universes) = 0);
select public.t_check('bob ser ingen mapper',   (select count(*) from public.groups) = 0);
select public.t_check('bob ser ingen lister',    (select count(*) from public.cards) = 0);
select public.t_check('bob ser ingen elementer', (select count(*) from public.items) = 0);
select public.t_check('bob ser kun egen profil', (select count(*) from public.profiles) = 1);

select public.t_fails('bob kan ikke opprette mappe i alices område',
  format('insert into public.groups (owner_id, universe_id, name) values (%L, %L, ''inntrenger'')', :'bob', :'u1'));

select public.t_fails('profil-e-post er skrivebeskyttet for klienter',
  format('update public.profiles set email = ''kapring@example.com'' where id = %L', :'bob'));
update public.profiles set display_name = 'Bob B.' where id = :'bob';
select public.t_check('display_name kan endres av brukeren selv',
  (select display_name from public.profiles where id = :'bob') = 'Bob B.');

insert into public.universes (id, owner_id, name, ts, org) values (:'ub', :'bob', 'Bobs område', 1, 'bob');
insert into public.groups (id, owner_id, universe_id, name, ts, org) values (:'gb', :'bob', :'ub', 'Bobs mappe', 1, 'bob');

-- ---------- D. mappedeling: Alice -> Bob (direkte mappemedlem) ----------
reset role;
select set_config('request.jwt.claim.sub', :'alice', false);
set role authenticated;

select public.create_share_invite('group', :'g1', 'bob@example.com') ->> 'id' as inv1 \gset

-- En ny invitasjon til samme person OPPDATERER den ventende i stedet for å
-- feile (det er slik et medlem løftes til eier), og lager aldri en duplikat.
select public.create_share_invite('group', :'g1', 'bob@example.com') ->> 'id' as inv1b \gset
select public.t_check('ny invitasjon til samme person oppdaterer den ventende',
  :'inv1' = :'inv1b'
  and (select count(*) from public.share_invites
        where group_id = :'g1' and lower(invitee_email) = 'bob@example.com'
          and status = 'pending') = 1);
select public.t_check('rollen kan gå OPP på en ventende invitasjon',
  (public.create_share_invite('group', :'g1', 'bob@example.com', 'owner') ->> 'role') = 'owner');
select public.t_check('… men ikke NED igjen',
  (public.create_share_invite('group', :'g1', 'bob@example.com', 'member') ->> 'role') = 'owner');
-- Tilbake til en medlemsinvitasjon for resten av seksjonen (rollen kan ikke
-- settes ned via RPC-en, og klienter har ingen UPDATE-rett på tabellen).
reset role;
update public.share_invites set role = 'member' where id = :'inv1'::uuid;
select set_config('request.jwt.claim.sub', :'alice', false);
set role authenticated;
select public.t_fails('kan ikke dele med seg selv',
  format('select public.create_share_invite(''group'', %L, ''alice@example.com'')', :'g1'));

reset role;
select set_config('request.jwt.claim.sub', :'bob', false);
set role authenticated;

select public.t_check('bob ser invitasjonen i get_my_doc',
  jsonb_array_length(public.get_my_doc() -> 'invites_in') = 1);
select public.accept_share_invite(:'inv1'::uuid) is not null as ok \gset
select public.t_check('mappeinvitasjon godtas UTEN å velge forelder', :'ok');
select public.t_check('bob ser den delte mappen', (select count(*) from public.groups where id = :'g1') = 1);
select public.t_check('bob ser listen i den delte mappen', (select count(*) from public.cards where id = :'c1') = 1);
select public.t_check('bob ser listepunktene', (select count(*) from public.items where id = :'i1') = 1);
select public.t_check('bob ser IKKE området mappen ligger i',
  (select count(*) from public.universes where id = :'u1') = 0);
select public.t_check('mappen er FRI for bob (Mapper delt med meg)',
  (select (g -> 'free')::boolean from jsonb_array_elements(public.get_my_doc() -> 'groups') g
    where g ->> 'id' = :'g1') = true);

-- Et direkte mappemedlem kan redigere åpent innhold, men ikke slette mappen.
update public.items set text = 'Bob endret', ts = 500, org = 'bob' where id = :'i1';
select public.t_check('bob kan redigere listepunkt i den delte mappen',
  (select text from public.items where id = :'i1') = 'Bob endret');
delete from public.groups where id = :'g1';   -- RLS: 0 rader
select public.t_check('bob kan ikke hardslette mappen',
  (select count(*) from public.groups where id = :'g1') = 1);
select public.t_fails('bob kan ikke legge mappen i felles søppel',
  format('update public.groups set trashed = true, ts = 700, org = ''bob'' where id = %L', :'g1'));
select public.t_fails('bob kan ikke flytte mappen',
  format('update public.groups set universe_id = %L, pos_ts = 999, pos_org = ''bob'' where id = %L', :'ub', :'g1'));

-- Utkastelse: alice fjerner bob fra mappen.
reset role;
select set_config('request.jwt.claim.sub', :'alice', false);
set role authenticated;
select public.revoke_share('group', :'g1', :'bob'::uuid);
reset role;
select set_config('request.jwt.claim.sub', :'bob', false);
set role authenticated;
select public.t_check('etter utkastelse: bob ser ikke mappen',
  (select count(*) from public.groups where id = :'g1') = 0);

-- ---------- E. områdedeling: Alice -> Carol ----------
reset role;
select set_config('request.jwt.claim.sub', :'alice', false);
set role authenticated;
select public.create_share_invite('universe', :'u1', 'carol@example.com') ->> 'id' as inv3 \gset

reset role;
select set_config('request.jwt.claim.sub', :'carol', false);
set role authenticated;
select public.accept_share_invite(:'inv3'::uuid);
select public.t_check('carol ser hele området (mappe/liste/listepunkt)',
  (select count(*) from public.groups where id = :'g1') = 1
  and (select count(*) from public.cards where id = :'c1') = 1
  and (select count(*) from public.items where id = :'i1') = 1);

insert into public.groups (id, owner_id, universe_id, name, ts, org)
  values (:'gcarol', :'carol', :'u1', 'Carols mappe', 1, 'carol');
select public.t_check('carol kan opprette mappe i delt område og blir mappeeier',
  (select count(*) from public.groups where id = :'gcarol') = 1
  and public.group_role(:'gcarol', :'carol') = 'owner');
select public.t_check('carol er IKKE eier av området',
  public.universe_role(:'u1', :'carol') = 'member'
  and not (public.universe_caps(:'u1', :'carol') -> 'delete')::boolean);

reset role;
select set_config('request.jwt.claim.sub', :'alice', false);
set role authenticated;
select public.t_check('alice ser medlemslisten (eier + medlem)',
  jsonb_array_length(public.get_members('universe', :'u1') -> 'members') = 2);
select public.t_check('området er nå markert som delt i get_my_doc',
  (select (u -> 'shared')::boolean from jsonb_array_elements(public.get_my_doc() -> 'universes') u
    where u ->> 'id' = :'u1') = true);

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
select public.t_check('dave kom inn i området', (select count(*) from public.cards where id = :'c1') = 1);

-- ---------- H. import av legacy-doc (deterministisk + idempotent) ----------
reset role;
select set_config('request.jwt.claim.sub', :'bob', false);
set role authenticated;

select public.import_doc('{
  "universes": [{"id": "uni-standard", "name": "Standard", "ts": 10, "org": "x", "pos": 1}],
  "groups": [
    {"id": "grp-1", "uni": "uni-standard", "name": "Gamle mapper", "ts": 10, "org": "x", "pos": 1},
    {"id": "grp-orphan", "uni": "finnes-ikke", "name": "Foreldreløs", "ts": 10, "org": "x"}
  ],
  "cards": [{"id": "card-1", "group": "grp-1", "title": "Gammel liste", "k": true, "p": false, "ts": 10, "org": "x"}],
  "items": [{"id": "item-1", "home": "card-1", "text": "Gammelt element", "ts": 10, "org": "x"}]
}'::jsonb) as import1 \gset

select public.t_check('import: riktige antall (foreldreløs mappe hoppet over)',
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

-- ---------- H2. mappekategorier + kollaps (groups.cat_id/is_cat/collapsed,
--                universes.collapsed) ----------
-- Områder og mapper bruker samme oppsett som lister og listepunkter: et
-- område kan kollapses, og mappene i det kan ligge i MAPPEKATEGORIER (en
-- mappe med is_cat = true). `cat_id` følger POSISJONS-registeret (som
-- universe_id); `is_cat`/`collapsed` innholds-registeret (som name).
-- (Faste id-er + rene INSERT-er, som resten av fila: `insert … returning` ville
-- brutt på RLS — SELECT-policyen slår inn på RETURNING, og can_read leser
-- tabellen med kommandoens egen, eldre snapshot.)
\set unav   '10000000-0000-0000-0000-000000000009'
\set gkat   '20000000-0000-0000-0000-000000000009'
\set gmed   '20000000-0000-0000-0000-00000000000a'
reset role;
select set_config('request.jwt.claim.sub', :'alice', false);
set role authenticated;
insert into public.universes (id, owner_id, name, ts, org, pos, pos_ts, pos_org)
  values (:'unav', :'alice', 'Nav-område', 1, 'a', 0, 1, 'a');
insert into public.groups (id, owner_id, universe_id, name, is_cat, ts, org, pos, pos_ts, pos_org)
  values (:'gkat', :'alice', :'unav', 'Prosjekter', true, 1, 'a', 0, 1, 'a');
insert into public.groups (id, owner_id, universe_id, cat_id, name, ts, org, pos, pos_ts, pos_org)
  values (:'gmed', :'alice', :'unav', :'gkat', 'Hagen', 1, 'a', 1, 1, 'a');

select public.t_check('mappekategori + medlem lagret (is_cat/cat_id)',
  (select is_cat from public.groups where id = :'gkat') = true
  and (select cat_id from public.groups where id = :'gmed') = :'gkat');

-- get_my_doc leverer feltene klienten trenger for å bygge nivå 1 / nivå 2.
select public.t_check('get_my_doc gir cat/isCat på mapper og collapsed på begge nivåer',
  (select (g ->> 'isCat')::boolean from jsonb_array_elements(public.get_my_doc() -> 'groups') g
     where g ->> 'id' = :'gkat') = true
  and (select g ->> 'cat' from jsonb_array_elements(public.get_my_doc() -> 'groups') g
     where g ->> 'id' = :'gmed') = :'gkat'
  and (select (g -> 'collapsed') is not null from jsonb_array_elements(public.get_my_doc() -> 'groups') g
     where g ->> 'id' = :'gkat')
  and (select (u -> 'collapsed') is not null from jsonb_array_elements(public.get_my_doc() -> 'universes') u
     where u ->> 'id' = :'unav'));

-- Kollaps rir på innholds-registeret (LWW), som name/trashed.
update public.universes set collapsed = true, ts = 50, org = 'a' where id = :'unav';
update public.groups set collapsed = true, ts = 50, org = 'a' where id = :'gkat';
select public.t_check('kollaps lagret på område og mappekategori',
  (select collapsed from public.universes where id = :'unav') = true
  and (select collapsed from public.groups where id = :'gkat') = true);
update public.universes set collapsed = false, ts = 2, org = 'a' where id = :'unav';
update public.groups set is_cat = false, collapsed = false, ts = 2, org = 'a' where id = :'gkat';
select public.t_check('utdatert innholds-skriving taper for collapsed/is_cat (LWW)',
  (select collapsed from public.universes where id = :'unav') = true
  and (select collapsed and is_cat from public.groups where id = :'gkat') = true);

-- cat_id følger POSISJONS-registeret: en utdatert pos-skriving reverteres.
update public.groups set cat_id = null, pos_ts = 0, pos_org = 'a' where id = :'gmed';
select public.t_check('utdatert posisjons-skriving taper for cat_id (LWW)',
  (select cat_id from public.groups where id = :'gmed') = :'gkat');
update public.groups set cat_id = null, pos_ts = 60, pos_org = 'a' where id = :'gmed';
select public.t_check('nyere posisjons-skriving flytter mappen ut av kategorien',
  (select cat_id from public.groups where id = :'gmed') is null);

delete from public.universes where id = :'unav';   -- rydd opp før slette-testene

-- ---------- I. hard sletting + gravsteiner ----------
reset role;
select set_config('request.jwt.claim.sub', :'carol', false);
set role authenticated;
delete from public.universes where id = :'u1';   -- RLS filtrerer stille: 0 rader
select public.t_check('bare eieren kan hardslette området (RLS: 0 rader slettet)',
  (select count(*) from public.universes where id = :'u1') = 1);

reset role;
select set_config('request.jwt.claim.sub', :'alice', false);
set role authenticated;
delete from public.universes where id = :'u1';
select public.t_check('alice slettet sitt område', (select count(*) from public.universes) = 0);
select public.t_check('gravsteiner skrevet for alle nivåer',
  (select count(*) from public.tombstones where resource_type = 'universe') >= 1
  and (select count(*) from public.tombstones where resource_type = 'group') >= 2
  and (select count(*) from public.tombstones where resource_type = 'card') >= 1
  and (select count(*) from public.tombstones where resource_type = 'item') >= 1);

reset role;
select set_config('request.jwt.claim.sub', :'carol', false);
set role authenticated;
select public.t_check('carols medlemskap forsvant med området',
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
