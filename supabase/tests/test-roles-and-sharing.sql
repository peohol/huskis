-- ============================================================
-- Testsuite for ROLLE-MODELLEN: mutable områdeeier-/mappeeier-roller,
-- effektivt medlemskap, capabilities, invitasjoner (medlem + eierskap),
-- låser, sletting/forlatelse og siste-eier-invarianten.
--
-- Kjøres mot en LOKAL PostgreSQL med tests/local-stub.sql +
-- users-and-sharing.sql lastet først (IKKE mot Supabase). Se run-tests.sh.
--
-- Brukere:
--   A = oppretter området → områdeeier
--   B = inviteres som MEDEIER av området
--   C = vanlig områdemedlem
--   D = DIREKTE mappemedlem (ingen rolle i området)
--   E = oppretter en mappe som vanlig medlem → eksplisitt mappeeier
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

\set A 'aa000000-1111-0000-0000-0000000000a1'
\set B 'bb000000-1111-0000-0000-0000000000b1'
\set C 'cc000000-1111-0000-0000-0000000000c1'
\set D 'dd000000-1111-0000-0000-0000000000d1'
\set E 'ee000000-1111-0000-0000-0000000000e1'
\set U  '10000000-1111-0000-0000-000000000001'
\set U2 '10000000-1111-0000-0000-000000000002'
\set G  '20000000-1111-0000-0000-000000000001'
\set G2 '20000000-1111-0000-0000-000000000002'
\set GE '20000000-1111-0000-0000-000000000003'
\set L  '30000000-1111-0000-0000-000000000001'
\set L2 '30000000-1111-0000-0000-000000000002'
\set I  '40000000-1111-0000-0000-000000000001'

insert into auth.users (id, email) values
  (:'A', 'role-a@example.com'), (:'B', 'role-b@example.com'),
  (:'C', 'role-c@example.com'), (:'D', 'role-d@example.com'),
  (:'E', 'role-e@example.com')
on conflict (id) do nothing;

-- ---------- 1. Oppretteren får eierrollen ----------
reset role; select set_config('request.jwt.claim.sub', :'A', false); set role authenticated;
insert into public.universes (id, owner_id, name, ts, org, pos) values (:'U', :'A', 'Felles', 1, 'a', 1);
insert into public.universes (id, owner_id, name, ts, org, pos) values (:'U2', :'A', 'Privat', 1, 'a', 2);
insert into public.groups (id, owner_id, universe_id, name, ts, org) values (:'G', :'A', :'U', 'A-mappe', 1, 'a');
insert into public.cards (id, owner_id, group_id, title, ts, org) values (:'L', :'A', :'G', 'A-liste', 1, 'a');

select public.t_check('oppretteren av et område får rollen owner',
  public.universe_role(:'U', :'A') = 'owner' and public.universe_owner_count(:'U') = 1);
select public.t_check('områdeeieren er dynamisk mappeeier uten egen mapperad',
  public.is_group_owner(:'G', :'A')
  and public.group_role(:'G', :'A') is null);

-- ---------- 2. Invitasjoner: medlem, medeier, avvisninger ----------
select public.create_share_invite('universe', :'U', 'role-b@example.com', 'owner') ->> 'id' as inv_b \gset
select public.create_share_invite('universe', :'U', 'role-c@example.com') ->> 'id' as inv_c \gset
select public.create_share_invite('group', :'G', 'role-d@example.com') ->> 'id' as inv_d \gset
select public.create_share_invite('universe', :'U', 'role-e@example.com') ->> 'id' as inv_e \gset

select public.t_fails('en LISTE kan ikke deles',
  format('select public.create_share_invite(''card'', %L, ''role-b@example.com'')', :'L'));
select public.t_fails('rå insert av liste-medlemskap avvises av databasen',
  format('insert into public.memberships (user_id, card_id, role) values (%L, %L, ''member'')', :'B', :'L'));

-- ---------- 3. Aksept krever INGEN forelder ----------
reset role; select set_config('request.jwt.claim.sub', :'B', false); set role authenticated;
select public.accept_share_invite(:'inv_b'::uuid);
reset role; select set_config('request.jwt.claim.sub', :'C', false); set role authenticated;
select public.accept_share_invite(:'inv_c'::uuid);
reset role; select set_config('request.jwt.claim.sub', :'D', false); set role authenticated;
select public.accept_share_invite(:'inv_d'::uuid);
reset role; select set_config('request.jwt.claim.sub', :'E', false); set role authenticated;
select public.accept_share_invite(:'inv_e'::uuid);

select public.t_check('områdeinvitasjon uten forelder gir rollen fra invitasjonen',
  public.universe_role(:'U', :'B') = 'owner'
  and public.universe_role(:'U', :'C') = 'member'
  and public.universe_owner_count(:'U') = 2);
select public.t_check('mappeinvitasjon uten forelder gir direkte mappemedlemskap',
  public.group_role(:'G', :'D') = 'member'
  and public.universe_role(:'U', :'D') is null);

-- ---------- 4. Seksjonene (get_my_doc): eier / delt område / fri mappe ----------
reset role; select set_config('request.jwt.claim.sub', :'A', false); set role authenticated;
select public.t_check('A: eget område har rolle owner',
  (select x ->> 'role' from jsonb_array_elements(public.get_my_doc() -> 'universes') x
    where x ->> 'id' = :'U') = 'owner');
reset role; select set_config('request.jwt.claim.sub', :'C', false); set role authenticated;
select public.t_check('C: delt område har rolle member',
  (select x ->> 'role' from jsonb_array_elements(public.get_my_doc() -> 'universes') x
    where x ->> 'id' = :'U') = 'member');
reset role; select set_config('request.jwt.claim.sub', :'D', false); set role authenticated;
select public.t_check('D: direkte mappe uten områdeadgang er FRI',
  (select (x -> 'free')::boolean from jsonb_array_elements(public.get_my_doc() -> 'groups') x
    where x ->> 'id' = :'G') = true
  and jsonb_array_length(public.get_my_doc() -> 'universes') = 0);
select public.t_check('D ser ikke områdets navn (ingen lekkasje)',
  (select count(*) from public.universes where id = :'U') = 0);
select public.t_check('D ser lista i den delte mappen',
  (select count(*) from public.cards where id = :'L') = 1);

-- ---------- 5. Medlemsliste: dedupliserte kategorier og presedens ----------
reset role; select set_config('request.jwt.claim.sub', :'A', false); set role authenticated;
select public.t_check('områdets medlemsliste har 2 eiere + 2 medlemmer',
  (select count(*) from jsonb_array_elements(public.get_members('universe', :'U') -> 'members') m
    where m ->> 'category' = 'universeOwner') = 2
  and (select count(*) from jsonb_array_elements(public.get_members('universe', :'U') -> 'members') m
    where m ->> 'category' = 'universeMember') = 2);
select public.t_check('mappens medlemsliste viser områdefolkene + det direkte medlemmet',
  (select count(*) from jsonb_array_elements(public.get_members('group', :'G') -> 'members')) = 5);
select public.t_check('ingen bruker vises to ganger i mappens medlemsliste',
  (select count(distinct m ->> 'id') from jsonb_array_elements(public.get_members('group', :'G') -> 'members') m) = 5);
select public.t_check('kategoripresedens: A og B er universeOwner, C/E universeMember, D groupMember',
  (select m ->> 'category' from jsonb_array_elements(public.get_members('group', :'G') -> 'members') m where m ->> 'id' = :'A') = 'universeOwner'
  and (select m ->> 'category' from jsonb_array_elements(public.get_members('group', :'G') -> 'members') m where m ->> 'id' = :'C') = 'universeMember'
  and (select m ->> 'category' from jsonb_array_elements(public.get_members('group', :'G') -> 'members') m where m ->> 'id' = :'D') = 'groupMember');
select public.t_check('arvede områdemedlemmer kan ikke fjernes fra mappen',
  (select (m -> 'removable')::boolean from jsonb_array_elements(public.get_members('group', :'G') -> 'members') m where m ->> 'id' = :'C') = false
  and (select m ->> 'removeHint' from jsonb_array_elements(public.get_members('group', :'G') -> 'members') m where m ->> 'id' = :'C')
      = 'Har tilgang via området og må fjernes der');
-- Klienten oversetter selv, og trenger derfor en SPRÅKNØYTRAL kode ved siden av
-- den norske teksten (docs/sprak.md). Teksten blir stående for eldre klienter.
select public.t_check('removeHintCode er språknøytral ved siden av removeHint',
  (select m ->> 'removeHintCode' from jsonb_array_elements(public.get_members('group', :'G') -> 'members') m where m ->> 'id' = :'C')
      = 'inherited');
select public.t_check('direkte mappemedlem KAN fjernes fra mappen',
  (select (m -> 'removable')::boolean from jsonb_array_elements(public.get_members('group', :'G') -> 'members') m where m ->> 'id' = :'D') = true);
select public.t_fails('en områdearvet bruker kan ikke fjernes fra én enkelt mappe',
  format('select public.revoke_share(''group'', %L, %L)', :'G', :'C'));

-- ---------- 6. Vanlig medlem: opprette, redigere, slette — og hva de IKKE kan ----------
reset role; select set_config('request.jwt.claim.sub', :'E', false); set role authenticated;
insert into public.groups (id, owner_id, universe_id, name, ts, org) values (:'GE', :'E', :'U', 'E-mappe', 1, 'e');
select public.t_check('vanlig områdemedlem kan opprette mappe og blir eksplisitt mappeeier',
  public.group_role(:'GE', :'E') = 'owner' and public.is_group_owner(:'GE', :'E'));
insert into public.cards (id, owner_id, group_id, title, ts, org) values (:'L2', :'E', :'G', 'E sin liste i A-mappa', 1, 'e');
select public.t_check('vanlig medlem kan opprette liste i en åpen mappe andre eier',
  (select count(*) from public.cards where id = :'L2') = 1);
update public.cards set title = 'E omdøpte A sin liste', ts = 5, org = 'e' where id = :'L';
select public.t_check('vanlig medlem kan redigere en åpen liste andre opprettet',
  (select title from public.cards where id = :'L') = 'E omdøpte A sin liste');
select public.t_check('listeoppretteren har ingen særrett (E er ikke privilegert på A-mappa)',
  not public.is_group_owner(:'G', :'E')
  and not (public.group_caps(:'G', :'E') -> 'manageSettings')::boolean);
select public.t_fails('vanlig medlem kan ikke låse en mappe hen ikke eier',
  format('select public.set_locked(''group'', %L, true)', :'G'));
delete from public.universes where id = :'U';   -- RLS filtrerer bort raden
select public.t_check('vanlig medlem kan ikke slette området',
  (select count(*) from public.universes where id = :'U') = 1);
select public.t_check('vanlig områdemedlem KAN slette en effektivt åpen mappe',
  (public.group_caps(:'G', :'E') -> 'delete')::boolean);

-- Direkte mappemedlem (D) har mindre myndighet enn et områdemedlem.
reset role; select set_config('request.jwt.claim.sub', :'D', false); set role authenticated;
select public.t_check('direkte mappemedlem kan IKKE slette eller flytte mappen',
  not (public.group_caps(:'G', :'D') -> 'delete')::boolean
  and not (public.group_caps(:'G', :'D') -> 'move')::boolean);
select public.t_check('direkte mappemedlem kan opprette og redigere lister i mappen',
  (public.group_caps(:'G', :'D') -> 'createList')::boolean
  and (public.group_caps(:'G', :'D') -> 'editContent')::boolean);
select public.t_check('direkte mappemedlem kan ikke omrokkere mapper i området',
  not public.can_reorder_in_parent('group', :'G', :'D'));

-- ---------- 7. Låser ----------
reset role; select set_config('request.jwt.claim.sub', :'A', false); set role authenticated;
select public.set_locked('universe', :'U', true);
select public.t_check('områdeeier omgår sin egen lås',
  public.can_edit_content('universe', :'U', :'A')
  and public.can_edit_content('group', :'G', :'A')
  and public.can_edit_content('card', :'L', :'A'));
select public.t_check('medeier omgår også låsen',
  public.can_edit_content('group', :'G', :'B'));
select public.t_check('eksplisitt mappeeier kan redigere SIN mappe under et låst område',
  public.can_edit_content('group', :'GE', :'E'));
select public.t_check('men ikke en annen mappe i det låste området',
  not public.can_edit_content('group', :'G', :'E'));
select public.t_check('vanlig medlem og direkte mappemedlem følger den effektive låsen',
  not public.can_edit_content('group', :'G', :'C')
  and not public.can_edit_content('card', :'L', :'D'));
select public.t_check('reordering følger forelderens lås',
  not public.can_reorder_in_parent('group', :'G', :'C')
  and public.can_reorder_in_parent('group', :'G', :'A'));

reset role; select set_config('request.jwt.claim.sub', :'E', false); set role authenticated;
select public.t_fails('mappeeier kan IKKE åpne mappen for andre i strid med områdelåsen',
  format('select public.set_unlocked(''group'', %L, true)', :'GE'));
reset role; select set_config('request.jwt.claim.sub', :'A', false); set role authenticated;
select public.set_unlocked('group', :'GE', true);
select public.t_check('områdeeieren kan gjøre unntak fra områdelåsen',
  public.can_edit_content('group', :'GE', :'C'));

-- Mappelås: mappeeieren styrer unntak på lister UNDER mappen.
select public.set_locked('universe', :'U', false);
reset role; select set_config('request.jwt.claim.sub', :'E', false); set role authenticated;
select public.set_unlocked('group', :'GE', false);
select public.set_locked('group', :'GE', true);
insert into public.cards (id, owner_id, group_id, title, ts, org)
  values ('30000000-1111-0000-0000-00000000000e', :'E', :'GE', 'Under lås', 1, 'e');
select public.set_unlocked('card', '30000000-1111-0000-0000-00000000000e', true);
select public.t_check('mappeeier kan gjøre unntak fra SIN mappelås på en liste',
  public.can_edit_content('card', '30000000-1111-0000-0000-00000000000e', :'C'));
select public.set_locked('group', :'GE', false);

-- ---------- 8. Invitasjonspolicy og eierskapsinvitasjoner ----------
reset role; select set_config('request.jwt.claim.sub', :'A', false); set role authenticated;
select public.t_check('standard: vanlige medlemmer kan invitere',
  public.can_invite_to('universe', :'U', :'C'));
select public.set_invite_policy('universe', :'U', 'deny');
reset role; select set_config('request.jwt.claim.sub', :'C', false); set role authenticated;
select public.t_check('deny sperrer videreinvitasjon for vanlige medlemmer',
  not public.can_invite_to('universe', :'U', :'C')
  and not public.can_invite_to('group', :'G', :'C'));
select public.t_fails('vanlig medlem kan ALDRI invitere noen som eier',
  format('select public.create_share_invite(''universe'', %L, ''ny@example.com'', ''owner'')', :'U'));
reset role; select set_config('request.jwt.claim.sub', :'E', false); set role authenticated;
select public.t_fails('mappeeier kan ikke invitere til eierskap i OMRÅDET',
  format('select public.create_share_invite(''universe'', %L, ''ny@example.com'', ''owner'')', :'U'));
select public.t_check('mappeeier kan invitere til eierskap i SIN mappe',
  public.can_invite_owner('group', :'GE', :'E'));
reset role; select set_config('request.jwt.claim.sub', :'A', false); set role authenticated;
select public.set_invite_policy('universe', :'U', 'inherit');
select public.t_fails('redundant medlemsinvitasjon til et områdemedlem avvises',
  format('select public.create_share_invite(''group'', %L, ''role-c@example.com'')', :'G'));
select public.create_share_invite('group', :'G', 'role-c@example.com', 'owner') ->> 'id' as inv_co \gset
select public.t_check('… men en EIERSKAPS-invitasjon til samme person er gyldig',
  (select count(*) from public.share_invites where id = :'inv_co'::uuid and status = 'pending') = 1);
select public.t_check('rolleinvitasjonen gir ingen rolle før den er godtatt',
  public.group_role(:'G', :'C') is null);
reset role; select set_config('request.jwt.claim.sub', :'C', false); set role authenticated;
select public.accept_share_invite(:'inv_co'::uuid);
select public.t_check('etter aksept er C eksplisitt mappeeier',
  public.group_role(:'G', :'C') = 'owner' and public.is_group_owner(:'G', :'C'));
reset role; select set_config('request.jwt.claim.sub', :'A', false); set role authenticated;
select public.t_check('rolleendring flytter C mellom kategoriene i mappens medlemsliste',
  (select m ->> 'category' from jsonb_array_elements(public.get_members('group', :'G') -> 'members') m
    where m ->> 'id' = :'C') = 'groupOwner');

-- ---------- 8b. En medlemsinvitasjon kan ikke kapre en ventende EIER-invitasjon ----------
-- `inviter_id` gir rett til å trekke invitasjonen tilbake. Sender et vanlig
-- medlem en MEDLEMS-invitasjon til en adresse som alt har en ventende EIER-
-- invitasjon, skal avsenderen stå urørt — ellers ville medlemmet fått makt over
-- en invitasjon det aldri kunne opprettet.
reset role; select set_config('request.jwt.claim.sub', :'A', false); set role authenticated;
select public.create_share_invite('universe', :'U', 'kapring@example.com', 'owner') ->> 'id' as inv_hj \gset
select public.t_check('eieren står som avsender av eierinvitasjonen',
  (select inviter_id from public.share_invites where id = :'inv_hj'::uuid) = :'A'::uuid);
reset role; select set_config('request.jwt.claim.sub', :'C', false); set role authenticated;
select public.t_check('et vanlig medlem har lov til å invitere medlemmer',
  public.can_invite_to('universe', :'U', :'C'));
select public.create_share_invite('universe', :'U', 'kapring@example.com');  -- samme adresse, som MEDLEM
select public.t_fails('medlemmet kan ikke trekke tilbake eierinvitasjonen',
  format('select public.revoke_share_invite(%L)', :'inv_hj'));
-- Direkte sletting avvises nå av GRANT-en, før RLS i det hele tatt får
-- filtrere: invitasjoner muteres kun gjennom RPC-ene. Begge lagene sier nei,
-- og det ytterste sier det først.
select public.t_fails('medlemmet kan ikke slette invitasjonsraden direkte heller',
  format('delete from public.share_invites where id = %L::uuid', :'inv_hj'));
-- Selve raden inspiseres uten RLS (medlemmet får uansett ikke se den).
reset role;
select public.t_check('rollen står fortsatt som eier',
  (select role from public.share_invites where id = :'inv_hj'::uuid) = 'owner');
select public.t_check('… og avsenderen er IKKE overtatt av medlemmet',
  (select inviter_id from public.share_invites where id = :'inv_hj'::uuid) = :'A'::uuid);
select public.t_check('… og raden ble ikke slettet av medlemmet',
  (select status from public.share_invites where id = :'inv_hj'::uuid) = 'pending');
-- Eieren beholder retten, og en NY eierinvitasjon fra en annen eier overtar som før.
reset role; select set_config('request.jwt.claim.sub', :'A', false); set role authenticated;
select public.revoke_share_invite(:'inv_hj'::uuid);
select public.t_check('eieren kan trekke den tilbake',
  (select status from public.share_invites where id = :'inv_hj'::uuid) = 'revoked');

-- ---------- 9. Siste-eier-invarianten ----------
reset role; select set_config('request.jwt.claim.sub', :'B', false); set role authenticated;
select public.leave_share('universe', :'U');   -- OK: A er igjen som eier
select public.t_check('en medeier kan forlate når det finnes en annen eier',
  public.universe_role(:'U', :'B') is null and public.universe_owner_count(:'U') = 1);
reset role; select set_config('request.jwt.claim.sub', :'A', false); set role authenticated;
select public.t_check('siste eier kan ikke forlate (capability)',
  not public.can_leave('universe', :'U', :'A'));
select public.t_fails('siste eier kan ikke forlate (RPC)',
  format('select public.leave_share(''universe'', %L)', :'U'));
select public.t_fails('siste eier kan ikke degraderes',
  format('select public.set_member_role(''universe'', %L, %L, ''member'')', :'U', :'A'));
select public.t_fails('siste eier kan ikke kastes ut',
  format('select public.revoke_share(''universe'', %L, %L)', :'U', :'A'));
select public.t_fails('siste eier kan ikke slettes med rå DELETE',
  format('delete from public.memberships where universe_id = %L and user_id = %L', :'U', :'A'));
select public.t_check('siste eier kan derimot slette området for alle',
  (public.universe_caps(:'U', :'A') -> 'delete')::boolean);

-- ---------- 10. Degradering av den opprinnelige oppretteren ----------
select public.create_share_invite('universe', :'U', 'role-b@example.com', 'owner') ->> 'id' as inv_b2 \gset
reset role; select set_config('request.jwt.claim.sub', :'B', false); set role authenticated;
select public.accept_share_invite(:'inv_b2'::uuid);
select public.set_member_role('universe', :'U', :'A', 'member');
select public.t_check('den opprinnelige oppretteren kan degraderes til vanlig medlem',
  public.universe_role(:'U', :'A') = 'member'
  and (select owner_id from public.universes where id = :'U') = :'A'::uuid);
reset role; select set_config('request.jwt.claim.sub', :'A', false); set role authenticated;
select public.t_check('created_by gir INGEN myndighet etter degraderingen',
  not (public.universe_caps(:'U', :'A') -> 'manageSettings')::boolean
  and not (public.universe_caps(:'U', :'A') -> 'delete')::boolean
  and not public.is_group_owner(:'G', :'A'));
select public.t_fails('den degraderte oppretteren kan ikke låse området',
  format('select public.set_locked(''universe'', %L, true)', :'U'));
reset role; select set_config('request.jwt.claim.sub', :'B', false); set role authenticated;
select public.set_member_role('universe', :'U', :'A', 'member');  -- idempotent no-op
select public.create_share_invite('universe', :'U', 'role-a@example.com', 'owner') ->> 'id' as inv_a2 \gset
reset role; select set_config('request.jwt.claim.sub', :'A', false); set role authenticated;
select public.accept_share_invite(:'inv_a2'::uuid);
select public.t_check('A er eier igjen etter en ny eierskapsinvitasjon',
  public.universe_role(:'U', :'A') = 'owner');

-- ---------- 10b. Rolleløft av et EKSISTERENDE medlem ----------
-- Et medlem som allerede er inne skal kunne løftes til eier — men aldri ved at
-- rollen skrives direkte: den gis via en invitasjon mottakeren må godta.
reset role; select set_config('request.jwt.claim.sub', :'C', false); set role authenticated;
select public.t_check('C er vanlig medlem av området',
  public.universe_role(:'U', :'C') = 'member');
reset role; select set_config('request.jwt.claim.sub', :'A', false); set role authenticated;
select public.t_check('eieren ser C som promotable i medlemslisten',
  (select (m -> 'promotable')::boolean from jsonb_array_elements(public.get_members('universe', :'U') -> 'members') m
    where m ->> 'id' = :'C') = true);
select public.t_fails('rollen kan ikke løftes direkte med set_member_role',
  format('select public.set_member_role(''universe'', %L, %L, ''owner'')', :'U', :'C'));
select public.t_check('… og medlemmet er fortsatt bare medlem',
  public.universe_role(:'U', :'C') = 'member');
-- Invitasjonen: C har alt tilgang, så «brukeren har allerede tilgang» skal IKKE
-- slå inn for en EIER-invitasjon.
select public.create_share_invite('universe', :'U', 'role-c@example.com', 'owner') ->> 'id' as inv_c2 \gset
select public.t_check('en eierinvitasjon til et eksisterende medlem er tillatt',
  (select role from public.share_invites where id = :'inv_c2'::uuid) = 'owner');
select public.t_check('promotable er av mens eierinvitasjonen ligger og venter',
  (select (m -> 'promotable')::boolean from jsonb_array_elements(public.get_members('universe', :'U') -> 'members') m
    where m ->> 'id' = :'C') = false);
select public.t_check('C er fortsatt bare medlem før invitasjonen er godtatt',
  public.universe_role(:'U', :'C') = 'member');
select public.universe_owner_count(:'U') as eiere_for \gset
-- En ny invitasjon til samme person kolliderer ikke: den oppdateres.
select public.create_share_invite('universe', :'U', 'role-c@example.com', 'owner') ->> 'id' as inv_c3 \gset
select public.t_check('ny invitasjon til samme person oppdaterer den ventende',
  :'inv_c2' = :'inv_c3'
  and (select count(*) from public.share_invites
        where universe_id = :'U' and lower(invitee_email) = 'role-c@example.com'
          and status = 'pending') = 1);
reset role; select set_config('request.jwt.claim.sub', :'C', false); set role authenticated;
select public.accept_share_invite(:'inv_c2'::uuid);
select public.t_check('etter aksept er C medeier med full myndighet',
  public.universe_role(:'U', :'C') = 'owner'
  and (public.universe_caps(:'U', :'C') -> 'manageSettings')::boolean
  and (public.universe_caps(:'U', :'C') -> 'delete')::boolean);
select public.t_check('… og området har fått nøyaktig én eier til',
  public.universe_owner_count(:'U') = :eiere_for + 1);
-- Tilbake til utgangspunktet, så senere seksjoner ser samme tilstand.
reset role; select set_config('request.jwt.claim.sub', :'A', false); set role authenticated;
select public.set_member_role('universe', :'U', :'C', 'member');
select public.t_check('C er degradert til medlem igjen',
  public.universe_role(:'U', :'C') = 'member'
  and public.universe_owner_count(:'U') = :eiere_for);

-- ---------- 11. Personlig rekkefølge ----------
reset role; select set_config('request.jwt.claim.sub', :'C', false); set role authenticated;
update public.memberships set pos = 99 where universe_id = :'U' and user_id = :'C';
select public.t_check('C sin personlige posisjon endret seg',
  (select pos from public.memberships where universe_id = :'U' and user_id = :'C') = 99);
reset role; select set_config('request.jwt.claim.sub', :'A', false); set role authenticated;
select public.t_check('… uten å påvirke A sin',
  (select pos from public.memberships where universe_id = :'U' and user_id = :'A') <> 99);
update public.memberships set pos = 5 where universe_id = :'U' and user_id = :'C';
select public.t_check('man kan ikke endre andres personlige posisjon (RLS filtrerer)',
  (select pos from public.memberships where universe_id = :'U' and user_id = :'C') = 99);
reset role; select set_config('request.jwt.claim.sub', :'C', false); set role authenticated;
select public.t_fails('roller kan ikke endres med rå UPDATE (egen rad)',
  format('update public.memberships set role = ''owner'' where universe_id = %L and user_id = %L', :'U', :'C'));
reset role; select set_config('request.jwt.claim.sub', :'A', false); set role authenticated;

-- ---------- 12. Forlat/kast ut: tilgang, ansvar og innhold ----------
reset role; select set_config('request.jwt.claim.sub', :'A', false); set role authenticated;
insert into public.items (id, owner_id, card_id, text, responsible, ts, org)
  values (:'I', :'A', :'L', 'Ansvarlig D', :'D', 1, 'a');
select public.create_share_invite('group', :'GE', 'role-d@example.com') ->> 'id' as inv_d2 \gset
reset role; select set_config('request.jwt.claim.sub', :'D', false); set role authenticated;
select public.accept_share_invite(:'inv_d2'::uuid);
select public.t_check('D har nå to direkte mapperoller i området',
  (select count(*) from public.memberships where user_id = :'D' and group_id is not null) = 2);
select public.leave_share('group', :'G');
select public.t_check('forlatt mappe: rollen borte, innholdet urørt',
  public.group_role(:'G', :'D') is null
  and (select count(*) from public.cards where id = :'L') = 0);   -- D ser den ikke lenger
reset role; select set_config('request.jwt.claim.sub', :'A', false); set role authenticated;
select public.t_check('innholdet består for de andre, og ansvaret er nullstilt',
  (select count(*) from public.cards where id = :'L') = 1
  and (select responsible from public.items where id = :'I') is null);

-- D får områdemedlemskap → den frie mappen forsvinner fra fri-seksjonen, og
-- de redundante direkte mappemedlemskapene ryddes.
select public.create_share_invite('universe', :'U', 'role-d@example.com') ->> 'id' as inv_d3 \gset
reset role; select set_config('request.jwt.claim.sub', :'D', false); set role authenticated;
select public.accept_share_invite(:'inv_d3'::uuid);
select public.t_check('områdemedlemskap fjerner redundante direkte mappemedlemskap',
  public.group_role(:'GE', :'D') is null and public.is_group_member(:'GE', :'D'));
select public.t_check('mappen vises nå INNE i området (ikke fri)',
  (select (x -> 'free')::boolean from jsonb_array_elements(public.get_my_doc() -> 'groups') x
    where x ->> 'id' = :'GE') = false);

-- Områdeeier kaster ut D → all underliggende direkte tilgang forsvinner.
reset role; select set_config('request.jwt.claim.sub', :'B', false); set role authenticated;
select public.create_share_invite('group', :'GE', 'role-d@example.com', 'owner') ->> 'id' as inv_d4 \gset
reset role; select set_config('request.jwt.claim.sub', :'D', false); set role authenticated;
select public.accept_share_invite(:'inv_d4'::uuid);
select public.t_check('en mappeeierrolle ved siden av områdemedlemskap gir ingen forlat-rett',
  public.group_role(:'GE', :'D') = 'owner' and not public.can_leave('group', :'GE', :'D'));
reset role; select set_config('request.jwt.claim.sub', :'B', false); set role authenticated;
select public.revoke_share('universe', :'U', :'D');
select public.t_check('utkastelse fra området fjerner ALL direkte tilgang under det',
  public.universe_role(:'U', :'D') is null
  and public.group_role(:'GE', :'D') is null
  and public.group_role(:'G', :'D') is null
  and not public.is_group_member(:'GE', :'D'));

-- ---------- 13. Sletting gjelder for alle ----------
reset role; select set_config('request.jwt.claim.sub', :'C', false); set role authenticated;
select public.t_check('mappeeier (C) kan slette sin mappe for alle',
  (public.group_caps(:'G', :'C') -> 'delete')::boolean);
reset role; select set_config('request.jwt.claim.sub', :'A', false); set role authenticated;
select public.set_locked('group', :'G', true);
reset role; select set_config('request.jwt.claim.sub', :'E', false); set role authenticated;
select public.t_check('vanlig områdemedlem kan IKKE slette en låst mappe',
  not (public.group_caps(:'G', :'E') -> 'delete')::boolean);
delete from public.groups where id = :'G';       -- RLS filtrerer bort raden
select public.t_check('… og DELETE treffer ingen rader (RLS)',
  (select count(*) from public.groups where id = :'G') = 1);
reset role; select set_config('request.jwt.claim.sub', :'A', false); set role authenticated;
select public.set_locked('group', :'G', false);

-- ---------- 14. Overflødig mapperolle under et område man er MEDEIER av ----------
-- Produksjonsformen: rolle-backfill-en gjorde mappens oppretter til eksplisitt
-- mappeeier, og et SENERE medeierskap i området gjorde raden overflødig uten
-- å fjerne forlat-knappen. Å forlate mappen hadde ikke fjernet noen tilgang —
-- den kommer også fra området — så capability-en skal være av.
reset role; select set_config('request.jwt.claim.sub', :'A', false); set role authenticated;
select public.create_share_invite('universe', :'U', 'role-e@example.com', 'owner') ->> 'id' as inv_e \gset
reset role; select set_config('request.jwt.claim.sub', :'E', false); set role authenticated;
select public.accept_share_invite(:'inv_e'::uuid);
select public.t_check('medeierskap i området beholder den eksplisitte mappeeierrollen',
  public.universe_role(:'U', :'E') = 'owner' and public.group_role(:'GE', :'E') = 'owner');
select public.t_check('… men medeieren kan ikke «forlate» en mappe i sitt eget område',
  not public.can_leave('group', :'GE', :'E')
  and not (public.group_caps(:'GE', :'E') -> 'leave')::boolean);
select public.t_fails('… og RPC-en avviser forlatelsen i stedet for å slette raden',
  format('select public.leave_share(''group'', %L)', :'GE'));
select public.t_check('rollen består etter det avviste forsøket',
  public.group_role(:'GE', :'E') = 'owner');
-- Veien ut av en overflødig mappeeierrolle er å tre av som medeier av mappen.
select public.set_member_role('group', :'GE', :'E', 'member');
select public.t_check('«tre av som medeier» fjerner den overflødige raden, tilgangen består',
  public.group_role(:'GE', :'E') is null and public.is_group_member(:'GE', :'E'));

-- ---------- 15. MINSTEPRIVILEGIUM på memberships og share_invites ----------
-- Roller og invitasjoner muteres UTELUKKENDE av RPC-ene (security definer) og
-- av opprettelses-triggerne. Klienten leser dem (innboksen + realtime) og
-- skriver bare sin egen personlige rekkefølge (`memberships.pos`). Alt annet
-- må være eksplisitt trukket tilbake: Supabases standardprivilegier gir ALL på
-- en ny tabell, så en glemt REVOKE gir en klient som kan gi seg selv en rolle
-- eller kapre en invitasjon — uten at noen annen test slår ut.
reset role; select set_config('request.jwt.claim.sub', :'A', false); set role authenticated;
select public.t_check('authenticated leser memberships (og kan sortere dem selv)',
  has_table_privilege('authenticated', 'public.memberships', 'SELECT')
  and has_table_privilege('authenticated', 'public.memberships', 'UPDATE'));
select public.t_check('authenticated kan IKKE sette inn roller direkte',
  not has_table_privilege('authenticated', 'public.memberships', 'INSERT'));
select public.t_check('authenticated kan IKKE slette roller direkte',
  not has_table_privilege('authenticated', 'public.memberships', 'DELETE'));
select public.t_fails('en klient kan ikke gi seg selv en rolle',
  format('insert into public.memberships (user_id, universe_id, role) values (%L, %L, ''owner'')', :'E', :'U'));
select public.t_fails('en klient kan ikke slette en rolle direkte',
  format('delete from public.memberships where user_id = %L and universe_id = %L', :'E', :'U'));
select public.t_check('rollen står fortsatt etter de avviste forsøkene',
  public.universe_role(:'U', :'E') = 'owner');

select public.t_check('authenticated leser share_invites (innboksen + realtime)',
  has_table_privilege('authenticated', 'public.share_invites', 'SELECT'));
select public.t_check('authenticated kan IKKE opprette en invitasjon direkte',
  not has_table_privilege('authenticated', 'public.share_invites', 'INSERT'));
select public.t_check('authenticated kan IKKE endre en invitasjon direkte',
  not has_table_privilege('authenticated', 'public.share_invites', 'UPDATE'));
select public.t_check('authenticated kan IKKE slette en invitasjon direkte',
  not has_table_privilege('authenticated', 'public.share_invites', 'DELETE'));
select public.t_fails('en klient kan ikke skrive en invitasjon til seg selv',
  format('insert into public.share_invites (universe_id, inviter_id, invitee_email, role) values (%L, %L, ''kapret@example.com'', ''owner'')', :'U', :'A'));
-- …og RPC-veien virker fortsatt, som den skal.
select public.create_share_invite('universe', :'U', 'fortsatt-ok@example.com', 'member') ->> 'id' as inv_ok \gset
select public.t_check('RPC-en oppretter invitasjonen som før',
  (select count(*) from public.share_invites where id = :'inv_ok'::uuid) = 1);
select public.revoke_share_invite(:'inv_ok'::uuid);
select public.t_check('RPC-en trekker den tilbake som før',
  (select status from public.share_invites where id = :'inv_ok'::uuid) is distinct from 'pending');

reset role;
select 'ALLE ROLLE- OG DELINGSTESTER GRØNNE' as resultat;
