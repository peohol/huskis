-- ============================================================
-- Testsuite for MIGRERINGEN AV DIREKTE LISTEDELINGER.
--
-- Forutsetter at tests/legacy-share-fixture.sql (den gamle databasefasongen
-- med data) er lastet FØRST, og deretter users-and-sharing.sql (gjerne to
-- ganger, for idempotens). Se run-tests.sh.
--
-- Kravet: den tidligere EFFEKTIVE tilgangen skal bevares NØYAKTIG — ingen får
-- tilgang til søskenlister de ikke kunne lese før.
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

\set O '01000000-3333-0000-0000-00000000000a'
\set M '01000000-3333-0000-0000-00000000000b'
\set X '01000000-3333-0000-0000-00000000000c'
\set Y '01000000-3333-0000-0000-00000000000d'
\set W '01000000-3333-0000-0000-00000000000e'
\set Z '01000000-3333-0000-0000-00000000000f'
\set U  '11000000-3333-0000-0000-000000000001'
\set G1 '12000000-3333-0000-0000-000000000001'
\set G2 '12000000-3333-0000-0000-000000000002'
\set C1 '13000000-3333-0000-0000-000000000001'
\set CY '13000000-3333-0000-0000-000000000002'
\set CS '13000000-3333-0000-0000-000000000003'
\set G3 '12000000-3333-0000-0000-000000000003'
\set CZ '13000000-3333-0000-0000-000000000004'
\set CZS '13000000-3333-0000-0000-000000000005'

-- ---------- 1. Roller er backfillet fra oppretterne ----------
select public.t_check('universets oppretter ble universeier',
  public.universe_role(:'U', :'O') = 'owner' and public.universe_owner_count(:'U') = 1);
select public.t_check('eksisterende direkte universmedlemskap ble rollen member',
  public.universe_role(:'U', :'M') = 'member');
select public.t_check('gruppens oppretter fikk INGEN ekstra rad (allerede universeier)',
  public.group_role(:'G1', :'O') is null and public.is_group_owner(:'G1', :'O'));
select public.t_check('eksisterende direkte gruppemedlemskap ble rollen member',
  public.group_role(:'G2', :'W') = 'member');

-- ---------- 2. Alle listedelinger er borte, og nye avvises ----------
select public.t_check('ingen medlemskap eller invitasjoner på listenivå igjen',
  (select count(*) from public.memberships where card_id is not null) = 0
  and (select count(*) from public.share_invites where card_id is not null) = 0);
select public.t_fails('nye liste-medlemskap avvises av databasen',
  format('insert into public.memberships (user_id, card_id, role) values (%L, %L, ''member'')', :'X', :'C1'));
reset role; select set_config('request.jwt.claim.sub', :'O', false); set role authenticated;
select public.t_fails('nye liste-invitasjoner avvises av RPC-en',
  format('select public.create_share_invite(''card'', %L, ''noen@example.com'')', :'C1'));

-- ---------- 3. Redundant listedeling ble bare fjernet ----------
select public.t_check('M (universmedlem) har ingen egen rad for søskenlista',
  (select count(*) from public.memberships
    where user_id = :'M' and group_id = :'G2') = 0);
select public.t_check('… men har fortsatt tilgang via universet',
  public.is_group_member(:'G2', :'M') and public.can_read_card(:'CS', :'M'));

-- ---------- 4. Én-liste-gruppe: mottakeren ble direkte gruppemedlem ----------
select public.t_check('X ble direkte gruppemedlem i én-liste-gruppen',
  public.group_role(:'G1', :'X') = 'member');
select public.t_check('lista ble liggende der den var',
  (select group_id from public.cards where id = :'C1') = :'G1'::uuid);
reset role; select set_config('request.jwt.claim.sub', :'X', false); set role authenticated;
select public.t_check('X ser lista, men ikke universet',
  (select count(*) from public.cards where id = :'C1') = 1
  and (select count(*) from public.universes where id = :'U') = 0);
select public.t_check('X ser gruppen som FRI (Grupper delt med meg)',
  (select (x -> 'free')::boolean from jsonb_array_elements(public.get_my_doc() -> 'groups') x
    where x ->> 'id' = :'G1') = true);

-- ---------- 5. Flerliste-gruppe: lista ble splittet ut i en NY søskengruppe ----------
reset role; select set_config('request.jwt.claim.sub', :'O', false); set role authenticated;
select id as newg from public.groups
 where universe_id = :'U' and name = 'Y-lista' and not is_cat \gset
select public.t_check('en ny søskengruppe med listetittelen ble opprettet i samme univers',
  (select count(*) from public.groups where id = :'newg'::uuid) = 1
  and (select universe_id from public.groups where id = :'newg'::uuid) = :'U'::uuid);
select public.t_check('lista ble flyttet dit med UENDRET id',
  (select group_id from public.cards where id = :'CY') = :'newg'::uuid);
select public.t_check('søskenlista ble liggende igjen i den gamle gruppen',
  (select group_id from public.cards where id = :'CS') = :'G2'::uuid);
select public.t_check('Y ble direkte gruppemedlem i den NYE gruppen — ikke i den gamle',
  public.group_role(:'newg'::uuid, :'Y') = 'member'
  and public.group_role(:'G2', :'Y') is null);
select public.t_check('W (direkte gruppemedlem i den gamle gruppen) fulgte med til den nye',
  public.group_role(:'newg'::uuid, :'W') = 'member'
  and public.group_role(:'G2', :'W') = 'member');
select public.t_check('den ventende listeinvitasjonen ble en gruppeinvitasjon',
  (select count(*) from public.share_invites
    where group_id = :'newg'::uuid and status = 'pending'
      and lower(invitee_email) = 'mig-ny@example.com') = 1);

reset role; select set_config('request.jwt.claim.sub', :'Y', false); set role authenticated;
select public.t_check('Y ser sin liste og innholdet i den',
  (select count(*) from public.cards where id = :'CY') = 1
  and (select count(*) from public.items where card_id = :'CY') = 1);
select public.t_check('Y får IKKE tilgang til søskenlista',
  (select count(*) from public.cards where id = :'CS') = 0
  and not public.can_read_card(:'CS', :'Y'));
select public.t_check('Y ser den nye gruppen i «Grupper delt med meg»',
  (select (x -> 'free')::boolean from jsonb_array_elements(public.get_my_doc() -> 'groups') x
    where x ->> 'id' = :'newg') = true
  and jsonb_array_length(public.get_my_doc() -> 'universes') = 0);

reset role; select set_config('request.jwt.claim.sub', :'W', false); set role authenticated;
select public.t_check('W beholder tilgangen til BEGGE gruppene sine lister',
  (select count(*) from public.cards where id in (:'CY', :'CS')) = 2);

reset role; select set_config('request.jwt.claim.sub', :'M', false); set role authenticated;
select public.t_check('universmedlemmet ser alt i universet, inkludert den nye gruppen',
  (select count(*) from public.cards where id in (:'C1', :'CY', :'CS')) = 3);

-- ---------- 5b. En TRASHET delt liste promoterer ikke mottakeren ----------
-- Lista selv ligger i søpla, men gruppen har en AKTIV søskenliste. Promotering
-- ville gitt mottakeren tilgang til nettopp den søskenlista.
reset role; select set_config('request.jwt.claim.sub', :'O', false); set role authenticated;
select public.t_check('en trashet delt liste ble splittet ut, ikke promotert',
  public.group_role(:'G3', :'Z') is null
  and (select group_id from public.cards where id = :'CZ') <> :'G3'::uuid
  and (select group_id from public.cards where id = :'CZS') = :'G3'::uuid);
reset role; select set_config('request.jwt.claim.sub', :'Z', false); set role authenticated;
select public.t_check('Z ser sin egen (trashede) liste …',
  (select count(*) from public.cards where id = :'CZ') = 1);
select public.t_check('… men IKKE den aktive søskenlista',
  (select count(*) from public.cards where id = :'CZS') = 0
  and not public.can_read_card(:'CZS', :'Z'));

-- ---------- 6. Idempotens ----------
-- users-and-sharing.sql er allerede kjørt to ganger av run-tests.sh; her
-- kontrollerer vi at det ikke ble duplikater av noe slag.
reset role;
select public.t_check('ingen dupliserte roller etter dobbel kjøring',
  (select count(*) from (
     select user_id, coalesce(universe_id::text, group_id::text) k, count(*) n
       from public.memberships group by 1, 2 having count(*) > 1) d) = 0);
select public.t_check('ingen dupliserte grupper etter dobbel kjøring',
  (select count(*) from public.groups where universe_id = :'U' and name = 'Y-lista') = 1
  and (select count(*) from public.groups where universe_id = :'U') = 5);

select 'ALLE MIGRERINGSTESTER FOR LISTEDELING GRØNNE' as resultat;
