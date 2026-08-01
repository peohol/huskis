-- ============================================================
-- Testsuite for SLETTING AV EGEN KONTO (public.delete_account()).
-- Kjøres mot en LOKAL PostgreSQL med tests/local-stub.sql +
-- users-and-sharing.sql lastet først (IKKE mot Supabase). Se run-tests.sh.
--
-- Det interessante er ikke at kontoen forsvinner, men GRENSEN mot andres
-- innhold. Fire brukere:
--   D = brukeren som sletter kontoen sin
--   A = eier av et univers D er MEDEIER av, og et univers D bare er medlem av
--   B = vanlig medlem av D sitt eget univers (mister det når D forsvinner)
--   C = utenforstående (skal ikke merke noe som helst)
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

\set D 'dddd0001-0000-0000-0000-0000000000d1'
\set A 'aaaa0002-0000-0000-0000-0000000000a2'
\set B 'bbbb0003-0000-0000-0000-0000000000b3'
\set C 'cccc0004-0000-0000-0000-0000000000c4'

-- D sitt EGET univers (delt med B) — skal forsvinne helt.
\set DU '1d000000-cccc-0000-0000-000000000001'
\set DG '2d000000-cccc-0000-0000-000000000001'
\set DC '3d000000-cccc-0000-0000-000000000001'
\set DI '4d000000-cccc-0000-0000-000000000001'
-- A sitt univers der D er MEDEIER — skal overleve. Gruppen/listen/listepunktet
-- er OPPRETTET AV D (SG/SC/SI).
\set SU '1a000000-cccc-0000-0000-000000000002'
\set SG '2a000000-cccc-0000-0000-000000000002'
\set SC '3a000000-cccc-0000-0000-000000000002'
\set SI '4a000000-cccc-0000-0000-000000000002'
-- A sitt univers der D bare er MEDLEM — skal overleve urørt. MC er A sin liste
-- (med D som ansvarlig), MI er D sitt listepunkt inne i den.
\set MU '1a000000-cccc-0000-0000-000000000003'
\set MG '2a000000-cccc-0000-0000-000000000003'
\set MC '3a000000-cccc-0000-0000-000000000003'
\set MI '4a000000-cccc-0000-0000-000000000003'
-- C sitt eget univers — helt uvedkommende.
\set CU '1c000000-cccc-0000-0000-000000000004'

-- ---------- 0. brukere ----------
insert into auth.users (id, email) values
  (:'D', 'slett-meg@example.com'), (:'A', 'medeier@example.com'),
  (:'B', 'medlem@example.com'),    (:'C', 'utenfor@example.com')
on conflict (id) do nothing;

-- ---------- 1. D sitt eget univers, delt med B ----------
reset role; select set_config('request.jwt.claim.sub', :'D', false); set role authenticated;
insert into public.universes (id, owner_id, name, ts, org) values (:'DU', :'D', 'Mitt univers', 1, 'd');
insert into public.groups (id, owner_id, universe_id, name, ts, org) values (:'DG', :'D', :'DU', 'Min gruppe', 1, 'd');
insert into public.cards  (id, owner_id, group_id, title, ts, org)  values (:'DC', :'D', :'DG', 'Min liste', 1, 'd');
insert into public.items  (id, owner_id, card_id, text, ts, org)    values (:'DI', :'D', :'DC', 'Melk', 1, 'd');
select public.create_share_invite('universe', :'DU', 'medlem@example.com') ->> 'id' as inv_b \gset
reset role; select set_config('request.jwt.claim.sub', :'B', false); set role authenticated;
select public.accept_share_invite(:'inv_b'::uuid);

-- ---------- 2. A sitt univers der D er MEDEIER ----------
reset role; select set_config('request.jwt.claim.sub', :'A', false); set role authenticated;
insert into public.universes (id, owner_id, name, ts, org) values (:'SU', :'A', 'Fellesuniverset', 1, 'a');
select public.create_share_invite('universe', :'SU', 'slett-meg@example.com', 'owner') ->> 'id' as inv_d \gset
reset role; select set_config('request.jwt.claim.sub', :'D', false); set role authenticated;
select public.accept_share_invite(:'inv_d'::uuid);
-- D oppretter innhold i fellesuniverset (det er de ANDRES innhold like mye som D sitt).
insert into public.groups (id, owner_id, universe_id, name, ts, org) values (:'SG', :'D', :'SU', 'Felles gruppe', 1, 'd');
insert into public.cards  (id, owner_id, group_id, title, ts, org)  values (:'SC', :'D', :'SG', 'Felles liste', 1, 'd');
insert into public.items  (id, owner_id, card_id, text, ts, org)    values (:'SI', :'D', :'SC', 'Brød', 1, 'd');

-- ---------- 3. A sitt univers der D bare er MEDLEM ----------
reset role; select set_config('request.jwt.claim.sub', :'A', false); set role authenticated;
insert into public.universes (id, owner_id, name, ts, org) values (:'MU', :'A', 'A sitt univers', 1, 'a');
insert into public.groups (id, owner_id, universe_id, name, ts, org) values (:'MG', :'A', :'MU', 'A sin gruppe', 1, 'a');
insert into public.cards  (id, owner_id, group_id, title, ts, org)  values (:'MC', :'A', :'MG', 'A sin liste', 1, 'a');
select public.create_share_invite('universe', :'MU', 'slett-meg@example.com') ->> 'id' as inv_m \gset
reset role; select set_config('request.jwt.claim.sub', :'D', false); set role authenticated;
select public.accept_share_invite(:'inv_m'::uuid);
insert into public.items (id, owner_id, card_id, text, ts, org) values (:'MI', :'D', :'MC', 'Ost', 1, 'd');
-- D er ansvarlig for både listen og sitt eget listepunkt. Listepunktet får et
-- stempel LANGT foran serverklokka (en enhet med klokka i forkant): vaktene
-- hopper aldri over `reg_newer`, så et stempel basert på klokka alene ville
-- blitt rullet tilbake — og FK-ens `on delete set null` hadde nullet feltet uten
-- nytt stempel, hvorpå den gamle verdien vant LWW-en igjen.
update public.cards set responsible = :'D', ts = 5, org = 'd' where id = :'MC';
update public.items set responsible = :'D', ts = 99999999999999, org = 'z' where id = :'MI';

-- ---------- 4. invitasjoner begge veier + C sitt urørte univers ----------
-- D har invitert C (ubesvart), og A har invitert D til en gruppe (ubesvart).
select public.create_share_invite('universe', :'MU', 'utenfor@example.com') ->> 'id' as inv_out \gset
reset role; select set_config('request.jwt.claim.sub', :'A', false); set role authenticated;
insert into public.groups (id, owner_id, universe_id, name, ts, org)
  values ('2a000000-cccc-0000-0000-00000000000f', :'A', :'SU', 'Egen gruppe', 1, 'a');
reset role; select set_config('request.jwt.claim.sub', :'C', false); set role authenticated;
insert into public.universes (id, owner_id, name, ts, org) values (:'CU', :'C', 'C sitt univers', 1, 'c');

-- E-postloggen har rader for begge invitasjonene D er innblandet i.
reset role;
insert into public.email_send_log (invite_id, variant, enqueue_status)
  values (:'inv_b'::uuid, 'existing', 'enqueued'), (:'inv_out'::uuid, 'unregistered', 'enqueued');

select public.t_check('fikstur: alt innhold på plass før slettingen',
  (select count(*) from public.universes where id in (:'DU', :'SU', :'MU', :'CU')) = 4
  and (select count(*) from public.items where owner_id = :'D') = 3
  and (select count(*) from public.memberships where user_id = :'D') = 3
  and (select count(*) from public.share_invites
        where status = 'pending'
          and (inviter_id = :'D' or lower(invitee_email) = 'slett-meg@example.com')) = 1);

-- ---------- 5. anon/uinnlogget kommer ingen vei ----------
reset role; select set_config('request.jwt.claim.sub', '', false); set role anon;
select public.t_fails('anon kan ikke slette en konto', 'select public.delete_account()');

-- ---------- 6. D sletter kontoen sin ----------
reset role; select set_config('request.jwt.claim.sub', :'D', false); set role authenticated;
select public.delete_account();
reset role;

-- ---------- 7. kontoen og profilen er borte ----------
select public.t_check('auth-brukeren er slettet',
  (select count(*) from auth.users where id = :'D') = 0);
select public.t_check('profilraden er slettet',
  (select count(*) from public.profiles where id = :'D') = 0);

-- ---------- 8. D sitt eget univers er borte for ALLE, med gravsteiner ----------
select public.t_check('universet D var eneste eier av er slettet med hele treet',
  (select count(*) from public.universes where id = :'DU') = 0
  and (select count(*) from public.groups where id = :'DG') = 0
  and (select count(*) from public.cards  where id = :'DC') = 0
  and (select count(*) from public.items  where id = :'DI') = 0);
select public.t_check('hver slettede rad har fått gravstein (ingen gjenoppstandelse)',
  (select count(*) from public.tombstones
    where resource_id in (:'DU', :'DG', :'DC', :'DI')) = 4);
select public.t_check('B sitt medlemskap i det slettede universet fulgte med',
  (select count(*) from public.memberships where universe_id = :'DU') = 0);

-- ---------- 9. fellesuniverset overlever, med A som eneste eier ----------
select public.t_check('universet med en annen medeier står igjen',
  (select count(*) from public.universes where id = :'SU') = 1
  and (select count(*) from public.memberships where universe_id = :'SU' and role = 'owner') = 1
  and (select user_id from public.memberships where universe_id = :'SU' and role = 'owner') = :'A'::uuid);
select public.t_check('innholdet D laget i fellesuniverset står igjen',
  (select count(*) from public.groups where id = :'SG') = 1
  and (select count(*) from public.cards where id = :'SC') = 1
  and (select count(*) from public.items where id = :'SI') = 1);
select public.t_check('oppretteren av det arves av en gjenværende eier',
  (select owner_id from public.groups where id = :'SG') = :'A'::uuid
  and (select owner_id from public.cards where id = :'SC') = :'A'::uuid
  and (select owner_id from public.items where id = :'SI') = :'A'::uuid);

-- ---------- 10. A sitt univers er urørt, ansvaret nullet ----------
select public.t_check('A sin liste og D sitt listepunkt i den står igjen',
  (select count(*) from public.cards where id = :'MC') = 1
  and (select text from public.items where id = :'MI') = 'Ost'
  and (select owner_id from public.items where id = :'MI') = :'A'::uuid);
select public.t_check('ansvaret som pekte på D er nullet med et NYTT innholds-stempel',
  (select responsible from public.cards where id = :'MC') is null
  and (select responsible from public.items where id = :'MI') is null
  and (select ts from public.cards where id = :'MC') > 5);
-- Radens eget register lå foran serverklokka: stempelet må likevel være nyere,
-- ellers ville vakten rullet skrivingen tilbake og den gamle verdien vunnet.
select public.t_check('… også når raden allerede har et stempel foran serverklokka',
  (select ts from public.items where id = :'MI') > 99999999999999
  and (select org from public.items where id = :'MI') = 'server');
select public.t_check('C sitt univers er helt urørt',
  (select count(*) from public.universes where id = :'CU') = 1
  and (select owner_id from public.universes where id = :'CU') = :'C'::uuid);

-- ---------- 11. ingen rester noe sted ----------
select public.t_check('ingen roller igjen',
  (select count(*) from public.memberships where user_id = :'D') = 0);
select public.t_check('ingen invitasjoner igjen — verken sendt, mottatt eller adressert til e-posten',
  (select count(*) from public.share_invites
    where inviter_id = :'D' or invitee_id = :'D'
       or lower(invitee_email) = 'slett-meg@example.com') = 0);
select public.t_check('e-postloggen for de invitasjonene er ryddet',
  (select count(*) from public.email_send_log
    where invite_id in (:'inv_b'::uuid, :'inv_out'::uuid)) = 0);
select public.t_check('ingen objektrad peker på den slettede brukeren',
  (select count(*) from public.universes where owner_id = :'D') = 0
  and (select count(*) from public.groups where owner_id = :'D') = 0
  and (select count(*) from public.cards where owner_id = :'D' or responsible = :'D') = 0
  and (select count(*) from public.items where owner_id = :'D' or responsible = :'D') = 0);

-- ---------- 12. gjenværende eier kan fortsatt jobbe videre ----------
-- Arven skal ikke ha låst noe: A redigerer innholdet D laget som før.
reset role; select set_config('request.jwt.claim.sub', :'A', false); set role authenticated;
update public.items set text = 'Grovbrød', ts = 99, org = 'a' where id = :'SI';
select public.t_check('A kan redigere det arvede innholdet',
  (select text from public.items where id = :'SI') = 'Grovbrød');
-- Og oppretteren er fortsatt uforanderlig for vanlige klientskrivinger.
select public.t_fails('owner_id kan fortsatt ikke endres av en klient',
  format('update public.items set owner_id = %L where id = %L', :'C', :'SI'));

-- ---------- 13. e-posten er ledig igjen ----------
-- Ingen unik-indeks-rester: adressen kan registreres på nytt.
reset role;
insert into auth.users (id, email) values
  ('dddd0009-0000-0000-0000-0000000000d9', 'slett-meg@example.com');
select public.t_check('e-postadressen kan registreres på nytt etterpå',
  (select count(*) from public.profiles where lower(email) = 'slett-meg@example.com') = 1);

reset role;
select 'ALLE KONTOSLETTINGS-TESTER GRØNNE' as resultat;
