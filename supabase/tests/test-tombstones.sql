-- ============================================================
-- Testsuite for GRAVSTEINENE som autoritativ sperre mot at et
-- permanent slettet objekt gjenoppstår.
-- Kjøres mot en LOKAL PostgreSQL med tests/local-stub.sql +
-- users-and-sharing.sql lastet først (IKKE mot Supabase). Se run-tests.sh.
--
-- Bakgrunnen: `tombstones` ble skrevet ved sletting, men aldri
-- konsultert. En klient med utdatert lokal cache kunne derfor sende en
-- helt ordinær INSERT og få det permanent slettede objektet tilbake i
-- basen — og siden klienten setter `owner_id` til seg selv, kunne delt
-- innhold komme tilbake med FEIL eier. Vakten `guard_object_insert`
-- flytter avgjørelsen dit den hører hjemme: i databasen, uavhengig av
-- hvilken klientversjon som ringer på.
--
-- To brukere:
--   T = eier av universet (deler en liste med S)
--   S = mottaker av delingen
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
-- Som t_fails, men krever i tillegg en BESTEMT SQLSTATE: klienten skiller
-- gravsteins-avvisningen fra alle andre feil på nettopp koden.
create or replace function public.t_fails_with(name text, code text, cmd text)
returns text language plpgsql as $$
begin
  begin execute cmd; exception when others then
    if sqlstate is distinct from code then
      raise exception 'FAIL (feil SQLSTATE for %): fikk % (%), ventet %', name, sqlstate, sqlerrm, code;
    end if;
    return 'PASS (blokkert med ' || code || '): ' || name;
  end;
  raise exception 'FAIL (skulle vært blokkert): %', name;
end $$;
grant execute on function public.t_check(text, boolean) to public;
grant execute on function public.t_fails(text, text) to public;
grant execute on function public.t_fails_with(text, text, text) to public;

\set T  'eeee0001-0000-0000-0000-0000000000e1'
\set S  'ffff0002-0000-0000-0000-0000000000f2'
\set TU '1a000000-bbbb-0000-0000-000000000001'
\set TG '2a000000-bbbb-0000-0000-000000000001'
\set TC '3a000000-bbbb-0000-0000-000000000001'
\set TI '4a000000-bbbb-0000-0000-000000000001'
-- Egen gren som KUN skal i papirkurven (aldri gravlegges).
\set KC '3a000000-bbbb-0000-0000-000000000002'
\set KI '4a000000-bbbb-0000-0000-000000000002'
-- Et helt nytt objekt opprettet etter slettingen.
\set NC '3a000000-bbbb-0000-0000-000000000003'

-- ---------- 0. brukere + tre ----------
insert into auth.users (id, email) values
  (:'T', 'tomb-eier@example.com'), (:'S', 'tomb-mottaker@example.com')
on conflict (id) do nothing;

reset role; select set_config('request.jwt.claim.sub', :'T', false); set role authenticated;
insert into public.universes (id, owner_id, name, ts, org) values (:'TU', :'T', 'Gravtest', 1, 't');
insert into public.groups (id, owner_id, universe_id, name, ts, org) values (:'TG', :'T', :'TU', 'Gruppe', 1, 't');
insert into public.cards  (id, owner_id, group_id, title, ts, org) values (:'TC', :'T', :'TG', 'Delt liste', 1, 't');
insert into public.items  (id, owner_id, card_id, text, ts, org) values (:'TI', :'T', :'TC', 'Melk', 1, 't');
insert into public.cards  (id, owner_id, group_id, title, ts, org) values (:'KC', :'T', :'TG', 'Beholdes', 1, 't');
insert into public.items  (id, owner_id, card_id, text, ts, org) values (:'KI', :'T', :'KC', 'Brød', 1, 't');

-- S blir DIREKTE gruppemedlem (lister deles ikke lenger — tilgangen arves fra
-- gruppen) og har dermed en lokal kopi av listen.
select public.create_share_invite('group', :'TG', 'tomb-mottaker@example.com') ->> 'id' as inv \gset
reset role; select set_config('request.jwt.claim.sub', :'S', false); set role authenticated;
select public.accept_share_invite(:'inv'::uuid);
select public.t_check('mottakeren ser den delte listen før slettingen',
  (select count(*) from public.cards where id = :'TC') = 1);

-- ---------- 1. oppretteren bestemmes av databasen ----------
reset role; select set_config('request.jwt.claim.sub', :'S', false); set role authenticated;
select public.t_fails_with('owner_id kan ikke settes til en annen bruker ved insert', '42501',
  format('insert into public.items (id, owner_id, card_id, text, ts, org) values (%L, %L, %L, ''snik'', 9, ''s'')',
         '4a000000-bbbb-0000-0000-0000000000ff', :'T', :'TC'));

-- ---------- 2. vanlig papirkurv rører ikke gravsteinene ----------
reset role; select set_config('request.jwt.claim.sub', :'T', false); set role authenticated;
update public.cards set trashed = true, ts = 10, org = 't' where id = :'KC';
select public.t_check('sletting til papirkurven er bare et flagg (ingen gravstein)',
  (select trashed from public.cards where id = :'KC') = true
  and (select count(*) from public.tombstones where resource_id = :'KC') = 0);
update public.cards set trashed = false, ts = 20, org = 't' where id = :'KC';
select public.t_check('gjenoppretting fra papirkurven virker fortsatt',
  (select trashed from public.cards where id = :'KC') = false
  and (select count(*) from public.cards where id = :'KC') = 1);

-- ---------- 3. permanent sletting → gravstein for hele undertreet ----------
delete from public.cards where id = :'TC';
select public.t_check('permanent sletting gravlegger både listen og punktene (kaskade)',
  (select count(*) from public.tombstones where resource_type = 'card' and resource_id = :'TC') = 1
  and (select count(*) from public.tombstones where resource_type = 'item' and resource_id = :'TI') = 1);
select public.t_check('den slettede listen er borte for alle',
  (select count(*) from public.cards where id = :'TC') = 0);

-- ---------- 4. EIERENS egen utdaterte klient kan ikke sette den inn igjen ----------
select public.t_fails_with('eierens gamle kopi kan ikke gjenopplive listen', 'PT409',
  format('insert into public.cards (id, owner_id, group_id, title, ts, org) values (%L, %L, %L, ''Delt liste'', 1, ''t'')',
         :'TC', :'T', :'TG'));
select public.t_fails_with('eierens gamle kopi kan ikke gjenopplive listepunktet', 'PT409',
  format('insert into public.items (id, owner_id, card_id, text, ts, org) values (%L, %L, %L, ''Melk'', 1, ''t'')',
         :'TI', :'T', :'KC'));

-- Gjentatte forsøk gir samme svar (idempotent — ingen tilstand som «brukes opp»).
select public.t_fails_with('gjentatt forsøk avvises likt', 'PT409',
  format('insert into public.cards (id, owner_id, group_id, title, ts, org) values (%L, %L, %L, ''Delt liste'', 1, ''t'')',
         :'TC', :'T', :'TG'));
select public.t_check('ingen rad snek seg inn underveis',
  (select count(*) from public.cards where id = :'TC') = 0);

-- ---------- 5. MOTTAKEREN kan ikke gjenopplive den som SIN ----------
-- Nøyaktig scenarioet «delt innhold gjenopprettet med feil owner_id»: S har en
-- gammel lokal kopi av T sin liste, og S sin klient ville satt owner_id = S.
reset role; select set_config('request.jwt.claim.sub', :'S', false); set role authenticated;
select public.t_fails_with('mottakeren kan ikke gjenopplive den delte listen som sin egen', 'PT409',
  format('insert into public.cards (id, owner_id, group_id, title, ts, org) values (%L, %L, %L, ''Delt liste'', 1, ''s'')',
         :'TC', :'S', :'TG'));
select public.t_check('listen finnes fortsatt ikke', (select count(*) from public.cards where id = :'TC') = 0);

-- ---------- 6. gravsteinene er lesbare for klientens oppslag ----------
-- Synken slår opp «er disse id-ene gravlagt?» på resource_id (den kjenner ikke
-- nivået til en rad den bare har lokalt).
select public.t_check('en innlogget klient kan slå opp gravsteiner på id',
  (select count(*) from public.tombstones where resource_id = any (array[:'TC', :'TI']::uuid[])) = 2);

-- ---------- 7. ekte nyopprettelser er upåvirket ----------
reset role; select set_config('request.jwt.claim.sub', :'T', false); set role authenticated;
insert into public.cards (id, owner_id, group_id, title, ts, org) values (:'NC', :'T', :'TG', 'Helt ny', 30, 't');
select public.t_check('en genuint ny liste opprettes som før',
  (select title from public.cards where id = :'NC') = 'Helt ny');

-- ---------- 8. import_doc rydder gravsteinene for SINE EGNE id-er ----------
-- Importen er brukerens egen, eksplisitte handling på id-er utledet av
-- brukerens uid; uten oppryddingen ville insert-vakten blokkert hele importen
-- for en bruker som tidligere har slettet noe permanent.
select public.import_doc(jsonb_build_object(
  'universes', jsonb_build_array(jsonb_build_object('id', 'legacy-u', 'name', 'Importert')),
  'groups',    jsonb_build_array(jsonb_build_object('id', 'legacy-g', 'uni', 'legacy-u', 'name', 'G')),
  'cards',     jsonb_build_array(jsonb_build_object('id', 'legacy-c', 'group', 'legacy-g', 'title', 'L')),
  'items',     '[]'::jsonb));
select public.t_check('import la inn legacy-treet',
  (select count(*) from public.cards where id = public.legacy_uuid(:'T', 'legacy-c')) = 1);
delete from public.universes where id = public.legacy_uuid(:'T', 'legacy-u');
select public.t_check('permanent sletting av det importerte gravla det',
  (select count(*) from public.tombstones
    where resource_id = public.legacy_uuid(:'T', 'legacy-c')) = 1);
select public.import_doc(jsonb_build_object(
  'universes', jsonb_build_array(jsonb_build_object('id', 'legacy-u', 'name', 'Importert')),
  'groups',    jsonb_build_array(jsonb_build_object('id', 'legacy-g', 'uni', 'legacy-u', 'name', 'G')),
  'cards',     jsonb_build_array(jsonb_build_object('id', 'legacy-c', 'group', 'legacy-g', 'title', 'L')),
  'items',     '[]'::jsonb));
select public.t_check('re-import etter permanent sletting lykkes (gravsteinene ryddet for egne id-er)',
  (select count(*) from public.cards where id = public.legacy_uuid(:'T', 'legacy-c')) = 1
  and (select count(*) from public.tombstones
        where resource_id = public.legacy_uuid(:'T', 'legacy-c')) = 0);

-- ---------- 9. gravsteiner er LESBARE, aldri skrivbare, for en klient ----------
-- En klient som selv kunne skrive i tombstones kunne enten gravlegge andres
-- objekter (ren sabotasje) eller RYDDE BORT sin egen gravstein og deretter
-- sette inn igjen det som var permanent slettet — nøyaktig hullet vakten
-- finnes for å tette. Grant-en er det ytterste laget: RLS har uansett ingen
-- write-policy her, men Supabases standardprivilegier gir ALL på en ny tabell,
-- så rettigheten må være EKSPLISITT trukket tilbake.
reset role; select set_config('request.jwt.claim.sub', :'T', false); set role authenticated;
select public.t_check('authenticated har SELECT på tombstones',
  has_table_privilege('authenticated', 'public.tombstones', 'SELECT'));
select public.t_check('authenticated har IKKE INSERT på tombstones',
  not has_table_privilege('authenticated', 'public.tombstones', 'INSERT'));
select public.t_check('authenticated har IKKE UPDATE på tombstones',
  not has_table_privilege('authenticated', 'public.tombstones', 'UPDATE'));
select public.t_check('authenticated har IKKE DELETE på tombstones',
  not has_table_privilege('authenticated', 'public.tombstones', 'DELETE'));
select public.t_fails('en klient kan ikke gravlegge et objekt selv',
  'insert into public.tombstones (resource_type, resource_id, ts) values (''card'', gen_random_uuid(), 1)');
select public.t_fails('en klient kan ikke fjerne sin egen gravstein',
  'delete from public.tombstones where resource_id = ' || quote_literal(:'TC') || '::uuid');
select public.t_check('gravsteinen står fortsatt etter forsøkene',
  (select count(*) from public.tombstones where resource_id = :'TC'::uuid) = 1);

-- ---------- 10. anon kommer ingen vei ----------
reset role; select set_config('request.jwt.claim.sub', '', false); set role anon;
select public.t_fails('anon kan ikke lese gravsteiner', 'select count(*) from public.tombstones');

reset role;
select 'ALLE GRAVSTEINS-TESTER GRØNNE' as resultat;
