-- ============================================================
-- Testsuite for OPPSKRIFTENE (docs/oppskrifter.md). Kjøres mot en LOKAL
-- PostgreSQL med tests/local-stub.sql + users-and-sharing.sql lastet først.
-- Se run-tests.sh.
--
-- Oppskriftene bor i notattabellene med `kind = 'recipe'` (kokebok = bokhylle,
-- kapittel = notatbok, oppskrift = notat), så rettighetsmodellen er den samme
-- som test-note-sharing.sql allerede beviser. Denne fila dekker det som er
-- NYTT:
--
--   1. `kind` arves nedover og kan ikke endres — heller ikke av en klient som
--      sender feil verdi
--   2. ingen flytting mellom notater og oppskrifter, på noe nivå
--   3. oppskriftsinnholdet rir på innholdsregisteret (LWW + lås)
--   4. deling med medlemmer: arven går bare nedover
--   5. offentlige lenker: hvem som kan lage dem, hva de viser (og ikke viser),
--      at de følger innholdet, og at de dør når de trekkes tilbake, når
--      objektet slettes og når oppretteren mister eierskapet
--   6. anon når INGENTING annet enn lesingen bak en gyldig nøkkel
--
-- Fire brukere:
--   A = eier kokeboken
--   B = medlem (redaktør) av kokeboken
--   C = får ett KAPITTEL delt direkte — og skal ikke se kokeboken
--   D = får én OPPSKRIFT delt direkte
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

\set A 'ae000000-7777-0000-0000-0000000000a1'
\set B 'be000000-7777-0000-0000-0000000000b1'
\set C 'ce000000-7777-0000-0000-0000000000c1'
\set D 'de000000-7777-0000-0000-0000000000d1'
-- K = kokebok (A), KA = kapittel i K, R1 = oppskrift i KA, R2 = oppskrift rett i K.
\set K  '7e000000-7777-0000-0000-000000000001'
\set KA '7e000000-7777-0000-0000-000000000002'
\set R1 '7e000000-7777-0000-0000-000000000003'
\set R2 '7e000000-7777-0000-0000-000000000004'
-- KB = et annet kapittel i K; R3 = oppskrift i KB (slettes underveis).
\set KB '7e000000-7777-0000-0000-000000000005'
\set R3 '7e000000-7777-0000-0000-000000000006'
-- NP/NF/NN = As NOTATER (bokhylle, notatbok, notat).
\set NP '7e000000-7777-0000-0000-000000000007'
\set NF '7e000000-7777-0000-0000-000000000008'
\set NN '7e000000-7777-0000-0000-000000000009'
-- K2 = As andre, PRIVATE kokebok.
\set K2 '7e000000-7777-0000-0000-00000000000a'
\set R4 '7e000000-7777-0000-0000-00000000000b'

insert into auth.users (id, email) values
  (:'A', 'opp-a@example.com'), (:'B', 'opp-b@example.com'),
  (:'C', 'opp-c@example.com'), (:'D', 'opp-d@example.com')
on conflict (id) do nothing;

-- ---------- 1. `kind` arves nedover ----------
reset role; select set_config('request.jwt.claim.sub', :'A', false); set role authenticated;
insert into public.note_projects (id, owner_id, name, kind, ts, org, pos, pos_ts, pos_org)
  values (:'K', :'A', 'Familiens kokebok', 'recipe', 1, 'a', 1, 1, 'a');
-- Klienten «glemmer» kind på kapitlet og sender feil verdi på en oppskrift:
-- serveren utleder den fra kokeboken uansett.
insert into public.note_folders (id, owner_id, project_id, name, ts, org, pos, pos_ts, pos_org)
  values (:'KA', :'A', :'K', 'Middag', 1, 'a', 1, 1, 'a');
insert into public.note_folders (id, owner_id, project_id, name, kind, ts, org, pos, pos_ts, pos_org)
  values (:'KB', :'A', :'K', 'Dessert', 'recipe', 1, 'a', 2, 1, 'a');
insert into public.notes (id, owner_id, project_id, folder_id, title, kind, recipe, ts, org, pos, pos_ts, pos_org)
  values (:'R1', :'A', :'K', :'KA', 'Lasagne', 'note',
          '{"v":1,"desc":"Klassiker","serv":4,"ing":{"items":[{"id":"i1","q":500,"u":"g","t":"kjøttdeig"}],"subs":[]},"step":{"items":[{"id":"s1","t":"Brun kjøttet"}],"subs":[]}}',
          1, 'a', 1, 1, 'a');
insert into public.notes (id, owner_id, project_id, title, recipe, ts, org, pos, pos_ts, pos_org)
  values (:'R2', :'A', :'K', 'Grøt', '{"v":1,"serv":2}', 1, 'a', 2, 1, 'a');
insert into public.notes (id, owner_id, project_id, folder_id, title, recipe, ts, org, pos, pos_ts, pos_org)
  values (:'R3', :'A', :'K', :'KB', 'Sjokoladekake', '{"v":1}', 1, 'a', 1, 1, 'a');
insert into public.note_projects (id, owner_id, name, ts, org, pos, pos_ts, pos_org)
  values (:'NP', :'A', 'Jobbnotater', 1, 'a', 2, 1, 'a');
insert into public.note_folders (id, owner_id, project_id, name, ts, org, pos, pos_ts, pos_org)
  values (:'NF', :'A', :'NP', 'Møter', 1, 'a', 1, 1, 'a');
insert into public.notes (id, owner_id, project_id, folder_id, title, ts, org, pos, pos_ts, pos_org)
  values (:'NN', :'A', :'NP', :'NF', 'Referat', 1, 'a', 1, 1, 'a');
insert into public.note_projects (id, owner_id, name, kind, ts, org, pos, pos_ts, pos_org)
  values (:'K2', :'A', 'Hemmelige oppskrifter', 'recipe', 1, 'a', 3, 1, 'a');
insert into public.notes (id, owner_id, project_id, title, recipe, ts, org, pos, pos_ts, pos_org)
  values (:'R4', :'A', :'K2', 'Bestemors saus', '{"v":1,"desc":"HEMMELIG"}', 1, 'a', 1, 1, 'a');

select public.t_check('kapitler og oppskrifter arver kokebokens kind — også når klienten sender feil',
  (select kind from public.note_folders where id = :'KA') = 'recipe'
  and (select kind from public.notes where id = :'R1') = 'recipe'
  and (select kind from public.notes where id = :'R2') = 'recipe');
select public.t_check('notater er fortsatt notater (default)',
  (select kind from public.note_projects where id = :'NP') = 'note'
  and (select kind from public.note_folders where id = :'NF') = 'note'
  and (select kind from public.notes where id = :'NN') = 'note'
  and (select recipe from public.notes where id = :'NN') is null);
select public.t_check('oppretteren av en kokebok får eierrollen',
  public.note_project_role(:'K', :'A') = 'owner');

update public.note_projects set kind = 'note', ts = 5, org = 'a' where id = :'K';
update public.notes set kind = 'note', ts = 5, org = 'a' where id = :'R2';
select public.t_check('kind kan ikke endres etterpå, verken på kokeboken eller en oppskrift',
  (select kind from public.note_projects where id = :'K') = 'recipe'
  and (select kind from public.notes where id = :'R2') = 'recipe');

-- ---------- 2. Ingen flytting mellom notater og oppskrifter ----------
select public.t_fails('en oppskrift kan ikke flyttes til en bokhylle med notater',
  format('update public.notes set project_id = %L, folder_id = null, pos_ts = 9, pos_org = %L where id = %L',
         :'NP', 'a', :'R2'));
select public.t_fails('en oppskrift kan ikke flyttes inn i en notatbok',
  format('update public.notes set folder_id = %L, pos_ts = 9, pos_org = %L where id = %L',
         :'NF', 'a', :'R1'));
select public.t_fails('et notat kan ikke flyttes inn i en kokebok',
  format('update public.notes set project_id = %L, folder_id = null, pos_ts = 9, pos_org = %L where id = %L',
         :'K', 'a', :'NN'));
select public.t_fails('et kapittel kan ikke flyttes til en bokhylle med notater',
  format('update public.note_folders set project_id = %L, pos_ts = 9, pos_org = %L where id = %L',
         :'NP', 'a', :'KB'));
-- En rad som peker på et kapittel får kapitlets kokebok OG kind, uansett hva
-- klienten sendte: invarianten utledes, den avvises ikke (som notes_fix_parent).
insert into public.notes (id, owner_id, project_id, folder_id, title, kind)
  values ('7e000000-7777-0000-0000-0000000000ff', :'A', :'NP', :'KA', 'Snik', 'note');
select public.t_check('en rad i et kapittel blir en oppskrift i kapitlets kokebok',
  (select kind = 'recipe' and project_id = :'K' from public.notes
    where id = '7e000000-7777-0000-0000-0000000000ff'));
delete from public.notes where id = '7e000000-7777-0000-0000-0000000000ff';
select public.t_check('… og ingenting ble flyttet',
  (select project_id from public.notes where id = :'R2') = :'K'
  and (select folder_id from public.notes where id = :'R1') = :'KA'
  and (select project_id from public.notes where id = :'NN') = :'NP'
  and (select project_id from public.note_folders where id = :'KB') = :'K');

-- Flytting INNENFOR kokebøkene virker som før: oppskrift til et annet kapittel,
-- rett i boken, og kapittel med oppskrifter til en annen kokebok.
update public.notes set folder_id = :'KB', pos_ts = 10, pos_org = 'a' where id = :'R1';
select public.t_check('en oppskrift kan flyttes til et annet kapittel',
  (select folder_id from public.notes where id = :'R1') = :'KB');
update public.notes set folder_id = :'KA', pos_ts = 11, pos_org = 'a' where id = :'R1';
update public.note_folders set project_id = :'K2', pos_ts = 12, pos_org = 'a' where id = :'KB';
select public.t_check('et kapittel kan flyttes til en annen kokebok, og oppskriftene følger med',
  (select project_id from public.notes where id = :'R3') = :'K2');
update public.note_folders set project_id = :'K', pos_ts = 13, pos_org = 'a' where id = :'KB';

-- ---------- 3. Innholdet rir på innholdsregisteret ----------
update public.notes set recipe = '{"v":1,"desc":"Gammel"}', ts = 0, org = 'z' where id = :'R1';
select public.t_check('en ELDRE skriving overskriver ikke oppskriften',
  (select recipe ->> 'desc' from public.notes where id = :'R1') = 'Klassiker');
update public.notes set recipe = jsonb_set(recipe, '{serv}', '6'), ts = 20, org = 'a' where id = :'R1';
select public.t_check('en nyere skriving gjør det',
  (select (recipe ->> 'serv')::int from public.notes where id = :'R1') = 6);
select public.t_fails('innholdet må være et objekt',
  format('update public.notes set recipe = %L, ts = 21, org = %L where id = %L', '[1,2]', 'a', :'R1'));

-- ---------- 4. Deling med medlemmer: arven går nedover ----------
select public.create_share_invite('note_project', :'K', 'opp-b@example.com') ->> 'id' as inv_b \gset
select public.create_share_invite('note_folder', :'KA', 'opp-c@example.com') ->> 'id' as inv_c \gset
select public.create_share_invite('note', :'R2', 'opp-d@example.com') ->> 'id' as inv_d \gset

reset role; select set_config('request.jwt.claim.sub', :'B', false); set role authenticated;
select public.t_check('innkommende invitasjon sier at det er en oppskriftsting',
  (select bool_and(i ->> 'kind' = 'recipe') from jsonb_array_elements(public.get_my_doc() -> 'invites_in') i));
select public.accept_share_invite(:'inv_b'::uuid);
select public.t_check('B (kokebok delt) ser kokeboken, begge kapitlene og alle tre oppskriftene — ikke As private',
  (select count(*) from public.note_projects) = 1
  and (select count(*) from public.note_folders) = 2
  and (select count(*) from public.notes) = 3);
select public.t_check('B kan redigere og opprette (åpen kokebok = redaktør)',
  public.can_edit_content('note', :'R1', :'B')
  and public.can_create_child('note_project', :'K', :'B'));
select public.t_check('get_my_doc gir B kind og innhold',
  (select bool_and(p ->> 'kind' = 'recipe') from jsonb_array_elements(public.get_my_doc() -> 'noteProjects') p)
  and (select n -> 'recipe' ->> 'desc' from jsonb_array_elements(public.get_my_doc() -> 'notes') n
        where n ->> 'id' = :'R1') = 'Klassiker');

reset role; select set_config('request.jwt.claim.sub', :'C', false); set role authenticated;
select public.accept_share_invite(:'inv_c'::uuid);
select public.t_check('C (kapittel delt) ser kapitlet og oppskriften i det — ikke kokeboken',
  (select count(*) from public.note_projects) = 0
  and (select count(*) from public.note_folders) = 1
  and (select count(*) from public.notes) = 1);
select public.t_check('get_my_doc markerer kapitlet som delt direkte (free)',
  (select (f ->> 'free')::boolean from jsonb_array_elements(public.get_my_doc() -> 'noteFolders') f) is true);

reset role; select set_config('request.jwt.claim.sub', :'D', false); set role authenticated;
select public.accept_share_invite(:'inv_d'::uuid);
select public.t_check('D (oppskrift delt) ser bare den ene oppskriften',
  (select count(*) from public.note_projects) = 0
  and (select count(*) from public.note_folders) = 0
  and (select count(*) from public.notes) = 1);

-- Ren leser: A låser kokeboken → B kan lese, men ikke endre oppskriften.
reset role; select set_config('request.jwt.claim.sub', :'A', false); set role authenticated;
select public.set_locked('note_project', :'K', true);
reset role; select set_config('request.jwt.claim.sub', :'B', false); set role authenticated;
update public.notes set recipe = '{"v":1,"desc":"B prøvde"}', ts = 99, org = 'b' where id = :'R1';
select public.t_check('en leser (låst kokebok) kan ikke endre oppskriften',
  (select recipe ->> 'desc' from public.notes where id = :'R1') = 'Klassiker');
reset role; select set_config('request.jwt.claim.sub', :'A', false); set role authenticated;
select public.set_locked('note_project', :'K', false);

-- ---------- 5. Offentlige lenker ----------
-- Bare en eier lager dem.
reset role; select set_config('request.jwt.claim.sub', :'B', false); set role authenticated;
select public.t_fails('et medlem (ikke eier) kan ikke lage en offentlig lenke',
  format('select public.recipe_link_create(%L, %L)', 'note_project', :'K'));
select public.t_fails('… eller lese den',
  format('select public.recipe_link_get(%L, %L)', 'note_project', :'K'));
reset role; select set_config('request.jwt.claim.sub', :'A', false); set role authenticated;
select public.t_fails('et NOTAT kan ikke få en offentlig lenke',
  format('select public.recipe_link_create(%L, %L)', 'note', :'NN'));
select public.t_check('ingen lenke før den lages',
  public.recipe_link_get('note_project', :'K') is null);

select public.recipe_link_create('note_project', :'K') as tok_book \gset
select public.recipe_link_create('note_folder', :'KA') as tok_chap \gset
select public.recipe_link_create('note', :'R2') as tok_rec \gset
select public.t_check('nøkkelen er lang, tilfeldig og stabil',
  length(:'tok_book') >= 32 and :'tok_book' <> :'tok_chap'
  and public.recipe_link_create('note_project', :'K') = :'tok_book'
  and public.recipe_link_get('note_project', :'K') = :'tok_book');
select public.t_check('den innloggede klienten når ikke tabellen direkte',
  not has_table_privilege('authenticated', 'public.recipe_links', 'SELECT'));

-- As private kokebok har en papirkurv-oppskrift; R3 slettes (søppelkassen).
update public.notes set trashed = true, ts = 30, org = 'a' where id = :'R3';

reset role; set role anon;
select public.t_check('anon når ikke lenketabellen eller notattabellene',
  not has_table_privilege('anon', 'public.recipe_links', 'SELECT')
  and not has_table_privilege('anon', 'public.notes', 'SELECT'));
select public.t_fails('anon kan ikke lage lenker',
  format('select public.recipe_link_create(%L, %L)', 'note_project', :'K'));
select public.t_fails('anon kan ikke spørre om objekter',
  format('select public.recipe_obj_live(%L, %L)', 'note_project', :'K'));
select public.t_check('ukjent eller tullete nøkkel gir null',
  public.recipe_public_get('x') is null
  and public.recipe_public_get(repeat('a', 40)) is null
  and public.recipe_public_get(null) is null);

select public.recipe_public_get(:'tok_book')::text as pub_book \gset
select public.t_check('kokeboklenken viser boken, kapitlene og oppskriftene — uten søppel',
  (public.recipe_public_get(:'tok_book') ->> 'type') = 'book'
  and (public.recipe_public_get(:'tok_book') ->> 'name') = 'Familiens kokebok'
  and jsonb_array_length(public.recipe_public_get(:'tok_book') -> 'chapters') = 2
  and (public.recipe_public_get(:'tok_book') -> 'chapters' -> 0 -> 'recipes' -> 0 ->> 'title') = 'Lasagne'
  and jsonb_array_length(public.recipe_public_get(:'tok_book') -> 'chapters' -> 1 -> 'recipes') = 0
  and (public.recipe_public_get(:'tok_book') -> 'recipes' -> 0 ->> 'title') = 'Grøt');
select public.t_check('svaret lekker ingen id-er, brukere, e-poster eller private oppskrifter',
  position(:'A' in :'pub_book') = 0 and position(:'K' in :'pub_book') = 0
  and position(:'R1' in :'pub_book') = 0 and position('example.com' in :'pub_book') = 0
  and position('HEMMELIG' in :'pub_book') = 0 and position('Sjokoladekake' in :'pub_book') = 0
  and position('owner' in :'pub_book') = 0);
select public.t_check('kapittellenken viser kapitlet uten kokebokens navn',
  (public.recipe_public_get(:'tok_chap') ->> 'type') = 'chapter'
  and (public.recipe_public_get(:'tok_chap') ->> 'name') = 'Middag'
  and position('Familiens' in public.recipe_public_get(:'tok_chap')::text) = 0
  and (public.recipe_public_get(:'tok_chap') -> 'recipes' -> 0 -> 'recipe' ->> 'desc') = 'Klassiker');
select public.t_check('oppskriftslenken viser én oppskrift',
  (public.recipe_public_get(:'tok_rec') ->> 'type') = 'recipe'
  and jsonb_array_length(public.recipe_public_get(:'tok_rec') -> 'recipes') = 1);

-- Lenken følger innholdet: en endring vises med en gang.
reset role; select set_config('request.jwt.claim.sub', :'A', false); set role authenticated;
update public.notes set title = 'Lasagne al forno', ts = 40, org = 'a' where id = :'R1';
reset role; set role anon;
select public.t_check('lenken viser alltid gjeldende innhold',
  (public.recipe_public_get(:'tok_chap') -> 'recipes' -> 0 ->> 'title') = 'Lasagne al forno');

-- Flytting ut av et delt kapittel: oppskriften forsvinner fra kapittellenken.
reset role; select set_config('request.jwt.claim.sub', :'A', false); set role authenticated;
update public.notes set folder_id = null, pos_ts = 41, pos_org = 'a' where id = :'R1';
reset role; set role anon;
select public.t_check('en oppskrift som flyttes ut av kapitlet vises ikke lenger i kapittellenken',
  jsonb_array_length(public.recipe_public_get(:'tok_chap') -> 'recipes') = 0);
reset role; select set_config('request.jwt.claim.sub', :'A', false); set role authenticated;
update public.notes set folder_id = :'KA', pos_ts = 42, pos_org = 'a' where id = :'R1';

-- Sletting (søppelkassen) stopper lenken; gjenoppretting vekker den.
update public.note_folders set trashed = true, ts = 43, org = 'a' where id = :'KA';
reset role; set role anon;
select public.t_check('et slettet kapittel: kapittellenken er død, og oppskriften det hadde er borte fra boklenken',
  public.recipe_public_get(:'tok_chap') is null
  and jsonb_array_length(public.recipe_public_get(:'tok_book') -> 'chapters') = 1);
reset role; select set_config('request.jwt.claim.sub', :'A', false); set role authenticated;
update public.note_folders set trashed = false, ts = 44, org = 'a' where id = :'KA';
reset role; set role anon;
select public.t_check('gjenopprettet kapittel: lenken virker igjen',
  (public.recipe_public_get(:'tok_chap') ->> 'name') = 'Middag');

-- Tilbaketrekking.
reset role; select set_config('request.jwt.claim.sub', :'A', false); set role authenticated;
select public.t_check('tilbaketrekking svarer sant',
  public.recipe_link_revoke('note', :'R2'));
reset role; set role anon;
select public.t_check('en tilbaketrukket lenke virker ikke lenger',
  public.recipe_public_get(:'tok_rec') is null);
reset role; select set_config('request.jwt.claim.sub', :'A', false); set role authenticated;
select public.recipe_link_create('note', :'R2') as tok_rec2 \gset
reset role; set role anon;
select public.t_check('en NY lenke får en ny nøkkel — den gamle forblir død',
  :'tok_rec2' <> :'tok_rec'
  and public.recipe_public_get(:'tok_rec') is null
  and public.recipe_public_get(:'tok_rec2') is not null);

-- Oppretteren mister eierskapet: lenken dør med det samme. B løftes til eier,
-- lager en lenke på R1, og settes så tilbake til medlem.
reset role; select set_config('request.jwt.claim.sub', :'A', false); set role authenticated;
select public.create_share_invite('note_project', :'K', 'opp-b@example.com', 'owner') ->> 'id' as inv_bo \gset
reset role; select set_config('request.jwt.claim.sub', :'B', false); set role authenticated;
select public.accept_share_invite(:'inv_bo'::uuid) is not null as b_owner;
select public.recipe_link_create('note', :'R1') as tok_b \gset
reset role; set role anon;
select public.t_check('lenken til en med-eier virker',
  public.recipe_public_get(:'tok_b') is not null);
reset role; select set_config('request.jwt.claim.sub', :'A', false); set role authenticated;
select public.set_member_role('note_project', :'K', :'B', 'member');
reset role; set role anon;
select public.t_check('… og dør når hen ikke lenger er eier',
  public.recipe_public_get(:'tok_b') is null);
reset role; select set_config('request.jwt.claim.sub', :'A', false); set role authenticated;
select public.t_check('den døde lenken ryddes, og eieren kan lage en ny',
  public.recipe_link_get('note', :'R1') is null
  and public.recipe_link_create('note', :'R1') is not null);

-- Permanent sletting tar lenken med seg.
delete from public.notes where id = :'R2';
reset role;
select public.t_check('permanent sletting fjerner lenkeraden',
  not exists (select 1 from public.recipe_links where token = :'tok_rec2'));

-- Kontosletting tar lenkene oppretteren laget med seg.
select public.t_check('lenkene hører til oppretteren',
  (select count(*) from public.recipe_links where created_by = :'A') >= 2);

-- ---------- 6. Opprydding ----------
reset role;
delete from public.note_projects where id in (:'K', :'K2', :'NP');
delete from auth.users where id in (:'A', :'B', :'C', :'D');
select public.t_check('ingen lenker igjen etter at alt er borte',
  not exists (select 1 from public.recipe_links));
