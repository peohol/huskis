-- ============================================================
-- Testsuite for INNLOGGEDE ØKTER: hvem ser hvilke økter, hva som lagres om
-- dem, og hva fjern-utlogging faktisk gjør. Kjøres mot en LOKAL PostgreSQL
-- med tests/local-stub.sql + users-and-sharing.sql lastet først (run-tests.sh).
--
-- Poenget med fila: Supabase Auth EIER øktene. Huskis legger bare et lesbart
-- lag over `auth.sessions`, og det laget må være vanntett på fire ting:
--   * jeg ser bare mine egne økter;
--   * jeg kan bare avslutte mine egne, og en fremmed id svarer «nei» uten å
--     røpe at raden finnes;
--   * fjern-utlogging sletter ØKTEN hos Supabase (og refresh-tokenet), ikke
--     bare en rad i vårt eget sidebord;
--   * det som lagres er gjenkjennelig, ikke identifiserende: hverken IP eller
--     hele user-agenten forlater databasen.
--
-- To brukere:
--   A = to økter (denne enheten + en gammel)
--   B = en annen bruker med sin egen økt
-- Autoritativt for modellen: docs/accounts.md.
-- ============================================================

\set ON_ERROR_STOP on
reset role;

create or replace function public.t_check(name text, cond boolean)
returns text language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FAIL: %', name; end if;
  return 'PASS: ' || name;
end $$;
grant execute on function public.t_check(text, boolean) to public;

-- Sidebordet er en LÅST tabell: `authenticated` har ingen SELECT (det er
-- nettopp det seksjon 5 beviser). Testen må likevel kunne lese den, og gjør
-- det gjennom en SECURITY DEFINER-luke som bare finnes her — ikke ved å
-- svekke tabellen.
create or replace function public.t_devsess(p_session uuid)
returns jsonb language sql security definer set search_path = public as $$
  select coalesce(to_jsonb(d), 'null'::jsonb)
    from public.device_sessions d where d.session_id = p_session;
$$;
create or replace function public.t_devcount(p_uid uuid default null, p_session uuid default null)
returns bigint language sql security definer set search_path = public as $$
  select count(*) from public.device_sessions d
   where (p_uid is null or d.user_id = p_uid)
     and (p_session is null or d.session_id = p_session);
$$;
grant execute on function public.t_devsess(uuid) to public;
grant execute on function public.t_devcount(uuid, uuid) to public;

\set A  'aaaa000c-0000-0000-0000-0000000000ac'
\set B  'bbbb000c-0000-0000-0000-0000000000bc'
\set S1 '11110000-0000-0000-0000-0000000000c1'
\set S2 '22220000-0000-0000-0000-0000000000c2'
\set SB '33330000-0000-0000-0000-0000000000c3'
\set SX '99990000-0000-0000-0000-0000000000c9'

-- ---------- 0. brukere og økter ----------
insert into auth.users (id, email) values
  (:'A', 'sess-a@example.com'), (:'B', 'sess-b@example.com')
on conflict (id) do nothing;

-- Øktene er Supabase sine. Fiksturen skriver dem direkte, med nøyaktig det
-- GoTrue selv legger inn — inkludert de to feltene som ALDRI skal ut igjen.
insert into auth.sessions (id, user_id, created_at, updated_at, refreshed_at, user_agent, ip)
values
  (:'S1', :'A', now() - interval '3 days', now(), now(),
   'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/131', '203.0.113.9'),
  (:'S2', :'A', now() - interval '30 days', now() - interval '2 days',
   now() - interval '2 days',
   'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130', '198.51.100.4'),
  (:'SB', :'B', now(), now(), now(), 'Mozilla/5.0 (Macintosh) Safari/17', '192.0.2.7')
on conflict (id) do nothing;
insert into auth.refresh_tokens (session_id, token) values (:'S1', 't1'), (:'S2', 't2'), (:'SB', 'tb');

-- ---------- 1. session_touch(): denne økten, aldri en annen ----------
reset role;
select set_config('request.jwt.claim.sub', :'A', false);
select set_config('request.jwt.claim.session_id', :'S1', false);
set role authenticated;
select public.session_touch('Chrome', 'Android', 'www.huskis.no', 'd-mobil') as t1 \gset
select public.t_check('session_touch() svarer at økten lever, og navngir den riktige',
  (:'t1'::jsonb ->> 'ok') = 'true' and (:'t1'::jsonb ->> 'session') = :'S1');
select public.t_devsess(:'S1'::uuid) as d1 \gset
select public.t_check('… og skrev metadataen på MIN økt',
  (:'d1'::jsonb ->> 'browser') = 'Chrome' and (:'d1'::jsonb ->> 'platform') = 'Android'
  and (:'d1'::jsonb ->> 'origin') = 'www.huskis.no'
  and (:'d1'::jsonb ->> 'device_id') = 'd-mobil'
  and (:'d1'::jsonb ->> 'user_id') = :'A');

-- Idempotent: en runde til gir ikke en rad til.
select public.session_touch('Chrome', 'Android', 'www.huskis.no', 'd-mobil');
select public.t_check('to runder gir ÉN rad (oppdatering, ikke dublett)',
  public.t_devcount(null, :'S1'::uuid) = 1);

-- Den andre økten til A, sett fra den andre nettleseren.
reset role; select set_config('request.jwt.claim.session_id', :'S2', false); set role authenticated;
select public.session_touch('Chrome', 'Windows', 'www.huskis.no', 'd-laptop');
reset role; select set_config('request.jwt.claim.session_id', :'S1', false); set role authenticated;

-- ---------- 2. list_my_devices(): mine økter, og hvilken er min ----------
select public.list_my_devices() as liste \gset
select public.t_check('jeg ser begge mine økter',
  jsonb_array_length(:'liste'::jsonb -> 'sessions') = 2);
select public.t_check('… og ingen av B sine',
  not exists (select 1 from jsonb_array_elements(:'liste'::jsonb -> 'sessions') e
               where e ->> 'id' = :'SB'));
select public.t_check('gjeldende økt er korrekt identifisert (og bare den ene)',
  (select count(*) from jsonb_array_elements(:'liste'::jsonb -> 'sessions') e
    where (e ->> 'current')::boolean) = 1
  and (select e ->> 'id' from jsonb_array_elements(:'liste'::jsonb -> 'sessions') e
        where (e ->> 'current')::boolean) = :'S1');
select public.t_check('denne enheten står ØVERST, resten etter sist sett',
  ((:'liste'::jsonb -> 'sessions' -> 0) ->> 'id') = :'S1'
  and ((:'liste'::jsonb -> 'sessions' -> 1) ->> 'id') = :'S2');
select public.t_check('raden bærer en lesbar beskrivelse',
  ((:'liste'::jsonb -> 'sessions' -> 1) ->> 'browser') = 'Chrome'
  and ((:'liste'::jsonb -> 'sessions' -> 1) ->> 'platform') = 'Windows'
  and ((:'liste'::jsonb -> 'sessions' -> 1) ->> 'origin') = 'www.huskis.no');

/* INGEN FINGERAVTRYKK. `auth.sessions` har både hele user-agenten og
   IP-adressen. Ingen av dem er nødvendig for å kjenne igjen en økt, og begge
   er identifiserende — de skal derfor ikke finnes noe sted i svaret, hverken
   som eget felt eller inne i en tekst. */
select public.t_check('hverken IP eller hele user-agenten forlater databasen',
  :'liste' not like '%203.0.113.9%' and :'liste' not like '%198.51.100.4%'
  and :'liste' not like '%Mozilla%' and :'liste' not like '%AppleWebKit%'
  and :'liste' not like '%user_agent%' and :'liste' not like '%"ip"%');

-- ---------- 3. get_my_doc().session_ok ----------
select (public.get_my_doc() ->> 'session_ok') as ok1 \gset
select public.t_check('en levende økt melder seg som levende', :'ok1' = 'true');

-- Et token UTEN session_id-claim er ikke en tilbakekalt økt. Feiler dette
-- åpent-lukket galt, logger appen ut brukere den ikke skulle rørt.
reset role; select set_config('request.jwt.claim.session_id', '', false); set role authenticated;
select (public.get_my_doc() ->> 'session_ok') as ok2 \gset
select public.t_check('et token uten session_id leses ALDRI som tilbakekalt', :'ok2' = 'true');
reset role; select set_config('request.jwt.claim.session_id', :'S1', false); set role authenticated;

-- ---------- 4. fjern-utlogging av ÉN økt ----------
select public.revoke_my_session(:'S2'::uuid) as r2 \gset
select public.t_check('revoke_my_session() sier at den traff', :'r2' = 't');
reset role;
select public.t_check('… og økten er borte hos Supabase, ikke bare hos oss',
  (select count(*) from auth.sessions where id = :'S2'::uuid) = 0);
select public.t_check('… refresh-tokenet er borte med den (klienten kan ikke fornye seg)',
  (select count(*) from auth.refresh_tokens where session_id = :'S2'::uuid) = 0);
select public.t_check('… og sidebordsraden ryddet med',
  public.t_devcount(null, :'S2'::uuid) = 0);
select public.t_check('den GJELDENDE økten står urørt',
  (select count(*) from auth.sessions where id = :'S1'::uuid) = 1);

-- Den fjern-utloggede klienten oppdager tilstanden i sin neste synk-runde.
select set_config('request.jwt.claim.session_id', :'S2', false); set role authenticated;
select (public.get_my_doc() ->> 'session_ok') as ok3 \gset
select public.t_check('den fjern-utloggede klienten ser at økten er borte', :'ok3' = 'false');
select public.session_touch('Chrome', 'Windows', 'www.huskis.no', 'd-laptop') as t3 \gset
select public.t_check('… og session_touch() skriver ikke en rad for en død økt',
  (:'t3'::jsonb ->> 'ok') = 'false'
  and public.t_devcount(null, :'S2'::uuid) = 0);

-- ---------- 5. en annen brukers økt er urørlig ----------
reset role; select set_config('request.jwt.claim.session_id', :'S1', false); set role authenticated;
select public.revoke_my_session(:'SB'::uuid) as rb \gset
select public.t_check('en annen brukers økt kan ikke termineres — og svaret røper ikke at den finnes',
  :'rb' = 'f');
reset role;
select public.t_check('… B sin økt lever fortsatt', (select count(*) from auth.sessions where id = :'SB'::uuid) = 1);
select public.t_check('en økt-id som ikke finnes svarer det samme',
  (select public.revoke_my_session(:'SX'::uuid)) is not distinct from false);

-- B ser bare sin egen.
select set_config('request.jwt.claim.sub', :'B', false);
select set_config('request.jwt.claim.session_id', :'SB', false);
set role authenticated;
select public.list_my_devices() as bliste \gset
select public.t_check('B ser KUN sin egen økt',
  jsonb_array_length(:'bliste'::jsonb -> 'sessions') = 1
  and ((:'bliste'::jsonb -> 'sessions' -> 0) ->> 'id') = :'SB');

-- B kan heller ikke navngi A sin økt ved å skrive direkte i sidebordet.
reset role;
do $$
declare ok boolean := false;
begin
  begin
    execute 'set local role authenticated';
    execute $q$insert into public.device_sessions (session_id, user_id, browser)
              values ('11110000-0000-0000-0000-0000000000c1'::uuid,
                      'bbbb000c-0000-0000-0000-0000000000bc'::uuid, 'Kapret')$q$;
  exception when others then ok := true;
  end;
  if not ok then raise exception 'FAIL: device_sessions var skrivbar for authenticated'; end if;
  raise notice 'PASS: device_sessions er låst — ingen klient kan navngi en økt direkte';
end $$;

-- ---------- 6. kontosletting tar øktene med seg ----------
reset role;
select set_config('request.jwt.claim.sub', :'B', false);
select set_config('request.jwt.claim.session_id', :'SB', false);
set role authenticated;
select public.session_touch('Safari', 'macOS', 'www.huskis.no', 'd-mac');
select public.delete_account();
reset role;
select public.t_check('kontosletting tar sidebordsradene med seg',
  public.t_devcount(:'B'::uuid) = 0);

reset role;
select set_config('request.jwt.claim.sub', '', false);
select set_config('request.jwt.claim.session_id', '', false);
\echo '✅ test-sessions.sql: alle sjekker grønne'
