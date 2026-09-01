-- ============================================================
-- Testsuite for NATIVE VARSELENHETER: Android-appens plass i «Enheter med
-- varsler». Kjøres mot en LOKAL PostgreSQL med tests/local-stub.sql +
-- users-and-sharing.sql lastet først (run-tests.sh).
--
-- Poenget med fila: «Enheter med varsler» skal beskrive ALLE klienter som
-- faktisk varsler utenfor appen — ikke bare nettleserne med web push. Android
-- planlegger lokale alarmer og har intet abonnement, så den halvdelen av
-- listen kommer fra `native_notif_devices`. Det som må være vanntett:
--   * en Android-klient med kanalen på er ÉN rad i listen, også med flere økter;
--   * en som er slått av lokalt, eller logget ut, er IKKE en varselenhet;
--   * en fjern-avslåing er varig: den automatiske statusrunden kan ikke
--     oppheve den, bare et EKSPLISITT «slå på» på nettopp den klienten;
--   * «slå av alle andre enheter» dekker begge kanaltypene og sparer kalleren;
--   * ingen kan røre en annen brukers enhet, og tabellen er låst for klienter.
--
-- To brukere:
--   A = Android-appen (to økter) + en nettleser med web push
--   B = en annen bruker med samme enhets-id (skal være upåvirket)
-- Autoritativt for modellen: docs/varsler.md.
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

-- Tabellen er LÅST (seksjon 9 beviser det). Testen leser den gjennom en
-- SECURITY DEFINER-luke som bare finnes her — ikke ved å svekke tabellen.
create or replace function public.t_native(p_uid uuid, p_dev text, p_org text)
returns jsonb language sql security definer set search_path = public as $$
  select coalesce(to_jsonb(n), 'null'::jsonb)
    from public.native_notif_devices n
   where n.user_id = p_uid and n.device_id = p_dev and n.origin = p_org;
$$;
create or replace function public.t_nativecount(p_uid uuid)
returns bigint language sql security definer set search_path = public as $$
  select count(*) from public.native_notif_devices n where n.user_id = p_uid;
$$;
grant execute on function public.t_native(uuid, text, text) to public;
grant execute on function public.t_nativecount(uuid) to public;

\set A   'aaaa00de-0000-0000-0000-0000000000ae'
\set B   'bbbb00de-0000-0000-0000-0000000000be'
\set SA1 '51110000-0000-0000-0000-0000000000e1'
\set SA2 '52220000-0000-0000-0000-0000000000e2'
\set SW  '53330000-0000-0000-0000-0000000000e3'
\set SB  '54440000-0000-0000-0000-0000000000e4'
\set EW  'https://push.example.com/web-abo'

-- ---------- 0. brukere, økter og et web push-abonnement ----------
insert into auth.users (id, email) values
  (:'A', 'nat-a@example.com'), (:'B', 'nat-b@example.com')
on conflict (id) do nothing;

-- A har logget inn i appen TO ganger (samme telefon), og står dessuten i en
-- nettleser. B har sin egen økt fra en telefon med tilfeldigvis samme
-- enhets-id — den skal aldri blandes inn.
insert into auth.sessions (id, user_id, created_at, updated_at, refreshed_at, user_agent, ip)
values
  (:'SA1', :'A', now() - interval '2 days', now(), now(), 'Mozilla/5.0 (Linux; Android 14)', '203.0.113.9'),
  (:'SA2', :'A', now() - interval '1 days', now(), now(), 'Mozilla/5.0 (Linux; Android 14)', '203.0.113.9'),
  (:'SW',  :'A', now() - interval '5 days', now(), now(), 'Mozilla/5.0 (Windows NT 10.0)', '198.51.100.4'),
  (:'SB',  :'B', now(), now(), now(), 'Mozilla/5.0 (Linux; Android 14)', '192.0.2.7')
on conflict (id) do nothing;

-- ---------- 1. appen melder seg som varselenhet ----------
-- Først: en klient som aldri har hatt varsler PÅ skal ikke lage en rad. Runden
-- går fra hver innlogging på hver Android-enhet; uten regelen ville tabellen
-- fylt seg med rader som bare sier «av».
reset role;
select set_config('request.jwt.claim.sub', :'A', false);
select set_config('request.jwt.claim.session_id', :'SA1', false);
set role authenticated;
select public.native_notif_touch(false, 'Huskis', 'Android', 'localhost', 'd-telefon') as n0 \gset
select public.t_check('en klient uten varsler på lager ingen rad',
  (:'n0'::jsonb -> 'id') = 'null'::jsonb and public.t_nativecount(:'A'::uuid) = 0);

reset role;
select set_config('request.jwt.claim.sub', :'A', false);
select set_config('request.jwt.claim.session_id', :'SA1', false);
set role authenticated;
-- Øktlaget først: den native raden er ikke en varselenhet uten en levende økt
-- i den SAMME klientkonteksten (det er utloggingsgarantien, se seksjon 8).
select public.session_touch('Huskis', 'Android', 'localhost', 'd-telefon');
select public.native_notif_touch(true, 'Huskis', 'Android', 'localhost', 'd-telefon') as n1 \gset
select public.t_check('native_notif_touch() svarer at kanalen er på og ikke avslått',
  (:'n1'::jsonb ->> 'enabled') = 'true' and (:'n1'::jsonb ->> 'revoked') = 'false');
select public.t_native(:'A'::uuid, 'd-telefon', 'localhost') as r1 \gset
select public.t_check('… og raden bærer klassifikasjonen, ikke råtekst',
  (:'r1'::jsonb ->> 'browser') = 'Huskis' and (:'r1'::jsonb ->> 'platform') = 'Android'
  and (:'r1'::jsonb ->> 'user_id') = :'A');

-- Den andre økten på den SAMME telefonen. Raden er konteksten, ikke økten.
reset role; select set_config('request.jwt.claim.session_id', :'SA2', false); set role authenticated;
select public.session_touch('Huskis', 'Android', 'localhost', 'd-telefon');
select public.native_notif_touch(true, 'Huskis', 'Android', 'localhost', 'd-telefon');
select public.t_check('to økter på samme telefon gir ÉN rad, ikke to',
  public.t_nativecount(:'A'::uuid) = 1);

-- ---------- 2. nettleseren ser telefonen ----------
reset role; select set_config('request.jwt.claim.session_id', :'SW', false); set role authenticated;
select public.session_touch('Chrome', 'Windows', 'www.huskis.no', 'd-laptop');
select public.push_subscribe(:'EW', 'BP' || repeat('k', 83) || 'h1', repeat('s', 22),
  '{}'::jsonb, 'Europe/Oslo', 'Chrome', 'Windows', 'www.huskis.no', 'd-laptop');
select public.list_my_devices(:'EW', 'd-laptop', 'www.huskis.no') as l1 \gset
select public.t_check('listen viser BEGGE kanaltypene',
  jsonb_array_length(:'l1'::jsonb -> 'push') = 2);
select public.t_check('… nettleseren er «denne enheten», telefonen er ikke',
  (select count(*) from jsonb_array_elements(:'l1'::jsonb -> 'push') e
    where (e ->> 'current')::boolean) = 1
  and (select e ->> 'kind' from jsonb_array_elements(:'l1'::jsonb -> 'push') e
        where (e ->> 'current')::boolean) = 'web');
select public.t_check('… og den native raden er navngitt «Huskis · Android»',
  (select count(*) from jsonb_array_elements(:'l1'::jsonb -> 'push') e
    where e ->> 'kind' = 'native' and e ->> 'browser' = 'Huskis'
      and e ->> 'platform' = 'Android') = 1);
/* Appens interne vert er en KONTEKSTNØKKEL, ikke en adresse brukeren har vært
   på. Den skal ikke ut i UI-et — og ingen IP eller user-agent heller. */
select public.t_check('den native raden bærer ingen vert, og ingen fingeravtrykk',
  (select (e -> 'origin') = 'null'::jsonb from jsonb_array_elements(:'l1'::jsonb -> 'push') e
    where e ->> 'kind' = 'native')
  and :'l1' not like '%203.0.113.9%' and :'l1' not like '%Mozilla%');
select public.t_check('… og aldri endepunktet til abonnementet',
  :'l1' not like '%push.example.com%');

-- Telleren i doc-et dekker begge kanaltypene: den er også SIGNALET klientene
-- bruker til å oppdage at noen slo dem av.
select (public.get_my_doc() ->> 'push_devices')::int as c1 \gset
select public.t_check('get_my_doc() teller både web og native', :'c1' = '2');

-- ---------- 3. appen slår varslene av LOKALT ----------
reset role; select set_config('request.jwt.claim.session_id', :'SA1', false); set role authenticated;
select public.native_notif_touch(false, 'Huskis', 'Android', 'localhost', 'd-telefon');
reset role; select set_config('request.jwt.claim.session_id', :'SW', false); set role authenticated;
select public.list_my_devices(:'EW', 'd-laptop', 'www.huskis.no') as l2 \gset
select public.t_check('en telefon som har slått av lokalt er ikke lenger en varselenhet',
  jsonb_array_length(:'l2'::jsonb -> 'push') = 1
  and ((:'l2'::jsonb -> 'push' -> 0) ->> 'kind') = 'web');
select (public.get_my_doc() ->> 'push_devices')::int as c2 \gset
select public.t_check('… og telleren følger med', :'c2' = '1');

-- … og på igjen.
reset role; select set_config('request.jwt.claim.session_id', :'SA1', false); set role authenticated;
select public.native_notif_touch(true, 'Huskis', 'Android', 'localhost', 'd-telefon');
select public.t_check('en vanlig statusrunde slår den på igjen når brukeren vil det',
  ((public.t_native(:'A'::uuid, 'd-telefon', 'localhost')) ->> 'enabled') = 'true');

-- ---------- 4. FJERN-AVSLÅING fra nettleseren ----------
reset role; select set_config('request.jwt.claim.session_id', :'SW', false); set role authenticated;
select public.list_my_devices(:'EW', 'd-laptop', 'www.huskis.no') as l3 \gset
select (select e ->> 'id' from jsonb_array_elements(:'l3'::jsonb -> 'push') e
         where e ->> 'kind' = 'native') as nid \gset
select public.native_notif_revoke(:'nid'::uuid) as rv \gset
select public.t_check('native_notif_revoke() sier at den traff', :'rv' = 't');
select public.t_check('… og den er borte fra listen med det samme',
  jsonb_array_length((public.list_my_devices(:'EW', 'd-laptop', 'www.huskis.no')) -> 'push') = 1);
-- Idempotent: to faner som slår av den samme enheten har begge fått viljen sin.
select public.t_check('to avslåinger på rad er ikke en feil',
  public.native_notif_revoke(:'nid'::uuid) = true);

-- ---------- 5. den automatiske runden kan ikke oppheve valget ----------
reset role; select set_config('request.jwt.claim.session_id', :'SA1', false); set role authenticated;
select public.native_notif_touch(true, 'Huskis', 'Android', 'localhost', 'd-telefon') as n2 \gset
select public.t_check('appens neste statusrunde får VITE at den er avslått',
  (:'n2'::jsonb ->> 'revoked') = 'true' and (:'n2'::jsonb ->> 'enabled') = 'false');
select public.t_check('… og raden er fortsatt avslått etterpå',
  ((public.t_native(:'A'::uuid, 'd-telefon', 'localhost')) ->> 'enabled') = 'false'
  and ((public.t_native(:'A'::uuid, 'd-telefon', 'localhost')) -> 'revoked_at') <> 'null'::jsonb);
select public.t_check('… selv etter mange runder',
  ((public.native_notif_touch(true, 'Huskis', 'Android', 'localhost', 'd-telefon')) ->> 'revoked') = 'true');

-- ---------- 6. bare et EKSPLISITT «slå på» tar det tilbake ----------
select public.native_notif_touch(true, 'Huskis', 'Android', 'localhost', 'd-telefon', true) as n3 \gset
select public.t_check('et eksplisitt «slå på varsler» opphever avslåingen',
  (:'n3'::jsonb ->> 'revoked') = 'false' and (:'n3'::jsonb ->> 'enabled') = 'true');
select public.t_check('… og sporet er borte',
  ((public.t_native(:'A'::uuid, 'd-telefon', 'localhost')) -> 'revoked_at') = 'null'::jsonb);
reset role; select set_config('request.jwt.claim.session_id', :'SW', false); set role authenticated;
select public.t_check('… så telefonen står i listen igjen',
  jsonb_array_length((public.list_my_devices(:'EW', 'd-laptop', 'www.huskis.no')) -> 'push') = 2);

-- ---------- 7. «slå av varsler på alle andre enheter» ----------
-- Nettleseren står med endepunktet sitt; telefonen er «en annen enhet».
select public.notif_revoke_others(:'EW', 'd-laptop', 'www.huskis.no') as ro \gset
select public.t_check('«alle andre» slo av den native klienten', :'ro' = '1');
select public.list_my_devices(:'EW', 'd-laptop', 'www.huskis.no') as l4 \gset
select public.t_check('… og gjeldende enhet står igjen, alene',
  jsonb_array_length(:'l4'::jsonb -> 'push') = 1
  and ((:'l4'::jsonb -> 'push' -> 0) ->> 'kind') = 'web'
  and ((:'l4'::jsonb -> 'push' -> 0) ->> 'current') = 'true');

-- Motsatt vei: telefonen slår av alle andre. Da skal NETTLESEREN ryke og
-- telefonen stå igjen — også når kalleren ikke har noe endepunkt.
reset role; select set_config('request.jwt.claim.session_id', :'SA1', false); set role authenticated;
select public.native_notif_touch(true, 'Huskis', 'Android', 'localhost', 'd-telefon', true);
select public.notif_revoke_others(null, 'd-telefon', 'localhost') as ro2 \gset
select public.t_check('fra appen slås nettleserens abonnement av', :'ro2'::int >= 1);
select public.list_my_devices(null, 'd-telefon', 'localhost') as l5 \gset
select public.t_check('… og telefonen står igjen som «denne enheten»',
  jsonb_array_length(:'l5'::jsonb -> 'push') = 1
  and ((:'l5'::jsonb -> 'push' -> 0) ->> 'kind') = 'native'
  and ((:'l5'::jsonb -> 'push' -> 0) ->> 'current') = 'true');

-- ---------- 8. en utlogget app er ikke en varselenhet ----------
-- Begge appøktene fjern-utlogges. Raden står igjen med `enabled`, men uten en
-- levende økt i konteksten er den ikke en enhet brukeren har varsler på.
reset role; select set_config('request.jwt.claim.session_id', :'SA1', false); set role authenticated;
select public.revoke_my_session(:'SA2'::uuid);
select public.t_check('raden er fortsatt påslått i tabellen',
  ((public.t_native(:'A'::uuid, 'd-telefon', 'localhost')) ->> 'enabled') = 'true');
reset role; select set_config('request.jwt.claim.session_id', :'SW', false); set role authenticated;
select public.revoke_my_session(:'SA1'::uuid);
select public.t_check('… men en app uten en levende økt er IKKE en varselenhet',
  jsonb_array_length((public.list_my_devices(:'EW', 'd-laptop', 'www.huskis.no')) -> 'push') = 0);
select (public.get_my_doc() ->> 'push_devices')::int as c3 \gset
select public.t_check('… og telleren ser den heller ikke', :'c3' = '0');

-- ---------- 9. en annen brukers enhet er urørlig ----------
-- B har tilfeldigvis den samme enhets-id-en. Konteksten er `user_id` FØRST.
reset role;
select set_config('request.jwt.claim.sub', :'B', false);
select set_config('request.jwt.claim.session_id', :'SB', false);
set role authenticated;
select public.session_touch('Huskis', 'Android', 'localhost', 'd-telefon');
select public.native_notif_touch(true, 'Huskis', 'Android', 'localhost', 'd-telefon');
select public.t_check('B fikk sin EGEN rad, ikke A sin',
  public.t_nativecount(:'B'::uuid) = 1 and public.t_nativecount(:'A'::uuid) = 1);
select public.t_check('B ser kun sin egen enhet',
  jsonb_array_length((public.list_my_devices(null, 'd-telefon', 'localhost')) -> 'push') = 1);
select public.t_check('B kan ikke slå av A sin enhet — og svaret røper ikke at den finnes',
  public.native_notif_revoke(:'nid'::uuid) = false);
select public.t_check('… A sin rad er urørt',
  ((public.t_native(:'A'::uuid, 'd-telefon', 'localhost')) ->> 'enabled') = 'true');

-- Tabellen er låst: ingen klient kan skrive en rad for en annen bruker.
reset role;
do $$
declare ok boolean := false;
begin
  begin
    execute 'set local role authenticated';
    execute $q$insert into public.native_notif_devices (user_id, device_id, origin, enabled)
              values ('aaaa00de-0000-0000-0000-0000000000ae'::uuid, 'd-kapret', 'localhost', true)$q$;
  exception when others then ok := true;
  end;
  if not ok then raise exception 'FAIL: native_notif_devices var skrivbar for authenticated'; end if;
  raise notice 'PASS: native_notif_devices er låst — ingen klient kan skrive direkte';
end $$;

-- En klient uten kontekst har ingen rad å skrive, og skal avvises.
reset role;
select set_config('request.jwt.claim.sub', :'B', false);
select set_config('request.jwt.claim.session_id', :'SB', false);
set role authenticated;
do $$
declare ok boolean := false;
begin
  begin
    perform public.native_notif_touch(true, 'Huskis', 'Android', null, null);
  exception when others then ok := true;
  end;
  if not ok then raise exception 'FAIL: native_notif_touch() godtok en rad uten klientkontekst'; end if;
  raise notice 'PASS: native_notif_touch() krever en klientkontekst';
end $$;

-- ---------- 10. kontosletting tar radene med seg ----------
select public.delete_account();
reset role;
select public.t_check('kontosletting tar de native varselradene med seg',
  public.t_nativecount(:'B'::uuid) = 0);

reset role;
select set_config('request.jwt.claim.sub', '', false);
select set_config('request.jwt.claim.session_id', '', false);
\echo '✅ test-native-notif.sql: alle sjekker grønne'
