-- ============================================================
-- Testsuite for WEB PUSH: abonnementer, utboksen, idempotens, RLS og
-- senderens to funksjoner. Kjøres mot en LOKAL PostgreSQL med
-- tests/local-stub.sql + users-and-sharing.sql lastet først. Se run-tests.sh.
--
-- Poenget med fila: push er en LEVERINGSKANAL, ikke en varselmodell. Radene
-- kommer fra notify_record(), utboksen fylles av den samme operasjonen, og
-- serveren tolker aldri en terskel. Det som må være vanntett her er derfor:
--   * at ingen kan lese, skrive eller slette en annens abonnement;
--   * at det samme logiske varselet ikke kan sendes to ganger til det samme
--     abonnementet, uansett hvor mange ganger generatoren kjører;
--   * at en avlyst plan (slettet rad) tar leveringen med seg;
--   * at senderens funksjoner er stengt for alle andre enn service_role.
--
-- To brukere:
--   A = eier av et område med en liste
--   B = en annen bruker med sitt eget abonnement
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
create or replace function public.t_fails(name text, cmd text)
returns text language plpgsql as $$
begin
  begin execute cmd; exception when others then
    return 'PASS (blokkert): ' || name || ' — ' || sqlerrm; end;
  raise exception 'FAIL (skulle vært blokkert): %', name;
end $$;
grant execute on function public.t_check(text, boolean) to public;
grant execute on function public.t_fails(text, text) to public;

-- Utboksen er en LÅST tabell: `authenticated` har ingen SELECT (det er nettopp
-- det seksjon 5 beviser). Testen må likevel kunne telle den, og gjør det
-- gjennom en SECURITY DEFINER-luke som bare finnes her — ikke ved å svekke
-- tabellen.
create or replace function public.t_deliveries(p_uid uuid default null, p_status text default null)
returns bigint language sql security definer set search_path = public as $$
  select count(*) from public.push_deliveries d
   where (p_uid is null or d.user_id = p_uid)
     and (p_status is null or d.status = p_status);
$$;
grant execute on function public.t_deliveries(uuid, text) to public;

\set A  'aaaa000b-0000-0000-0000-0000000000ab'
\set B  'bbbb000b-0000-0000-0000-0000000000bb'
\set AU '1b000000-9999-0000-0000-000000000001'
\set AG '2b000000-9999-0000-0000-000000000001'
\set AC '3b000000-9999-0000-0000-000000000001'
\set AI '4b000000-9999-0000-0000-000000000001'

-- Alt som er «fram i tid» må ligge foran serverens egen klokke, ikke foran et
-- fast tall: utboksen fylles av `n.at > now_ms`, der now_ms er now(). Faste
-- millisekunder fra 2026 ville blitt fortid før eller siden, og testen ville
-- da stille sluttet å teste det den heter.
select ((extract(epoch from now()) * 1000)::bigint + 3600000)::text as fram \gset
select ((extract(epoch from now()) * 1000)::bigint - 3600000)::text as bak \gset

-- ---------- 0. brukere + innhold ----------
insert into auth.users (id, email) values
  (:'A', 'push-a@example.com'), (:'B', 'push-b@example.com')
on conflict (id) do nothing;

reset role; select set_config('request.jwt.claim.sub', :'A', false); set role authenticated;
insert into public.universes (id, owner_id, name, ts, org) values (:'AU', :'A', 'Pushområde', 1, 'a');
insert into public.groups (id, owner_id, universe_id, name, ts, org) values (:'AG', :'A', :'AU', 'Mappe', 1, 'a');
insert into public.cards  (id, owner_id, group_id, title, due_at, ts, org)
  values (:'AC', :'A', :'AG', 'Frist-liste', '2026-01-10', 1, 'a');
insert into public.items  (id, owner_id, card_id, text, ts, org) values (:'AI', :'A', :'AC', 'Punkt', 1, 'a');

-- ---------- 1. abonnementet registreres og fornyes idempotent ----------
select public.push_subscribe('https://push.example.com/a1', 'p256-a', 'auth-a',
  jsonb_build_object('dueOver', 'Frist utløpt', 'dueSoon', 'Frist innen en uke',
                     'startNow', 'Begynner nå', 'startSoon', 'Begynner innen en uke'),
  'Europe/Oslo') as sub_a \gset
select public.t_check('abonnementet ble registrert på den innloggede brukeren',
  (select user_id from public.push_subscriptions where id = :'sub_a'::uuid) = :'A'::uuid);
select public.t_check('… med nøklene, etikettene og sonen',
  (select p256dh = 'p256-a' and auth = 'auth-a' and tz = 'Europe/Oslo'
          and labels ->> 'dueOver' = 'Frist utløpt'
     from public.push_subscriptions where id = :'sub_a'::uuid));

-- Fornyelse: den SAMME nettleseren melder seg på nytt (nye nøkler etter en
-- pushsubscriptionchange). Én rad, ikke to.
select public.push_subscribe('https://push.example.com/a1', 'p256-a2', 'auth-a2',
  '{"dueOver": "Frist utløpt"}'::jsonb, 'Europe/Oslo');
select public.t_check('samme endepunkt to ganger gir ÉN rad (fornyelse, ikke dublett)',
  (select count(*) from public.push_subscriptions where user_id = :'A') = 1);
select public.t_check('… og nøklene ble oppdatert',
  (select p256dh from public.push_subscriptions where user_id = :'A') = 'p256-a2');

-- En bruker kan ha flere nettlesere.
select public.push_subscribe('https://push.example.com/a2', 'p256-b', 'auth-b',
  '{"dueOver": "Frist utløpt"}'::jsonb, 'Europe/Oslo');
select public.t_check('flere enheter per bruker: to endepunkter, to rader',
  (select count(*) from public.push_subscriptions where user_id = :'A') = 2);

-- Endepunktet er ugyldig hvis det ikke er https: feltet ender opp som mål for
-- et HTTP-kall fra senderen.
select public.t_fails('et endepunkt uten https avvises',
  $$select public.push_subscribe('http://push.example.com/x', 'k', 'a')$$);

-- ---------- 2. utboksen fylles av notify_record(), og bare for PLANLAGTE rader ----------
select public.notify_record(jsonb_build_array(
  jsonb_build_object('key', 'dueOver|card|' || :'AC' || '|2026-01-10', 'type', 'dueOver',
    'obj_type', 'card', 'obj_id', :'AC', 'name', 'Frist-liste', 'path', 'x',
    'value', '2026-01-10', 'at', :'bak'::bigint),
  jsonb_build_object('key', 'dueSoon|card|' || :'AC' || '|2026-09-01', 'type', 'dueSoon',
    'obj_type', 'card', 'obj_id', :'AC', 'name', 'Frist-liste', 'path', 'x',
    'value', '2026-09-01', 'at', :'fram'::bigint)));
select public.t_check('to varsler ble logget', (select count(*) from public.notifications where user_id = :'A') = 2);
select public.t_check('utboksen fikk KUN den planlagte raden — én per aktivt abonnement',
  public.t_deliveries(:'A'::uuid) = 2);
reset role;
select public.t_check('… og en rad som allerede var passert ved logging gir INGEN levering',
  (select count(*) from public.push_deliveries d
     join public.notifications n on n.id = d.notification_id
    where n.key like 'dueOver|%') = 0);
select public.t_check('leveringen forfaller når varselet forfaller',
  (select bool_and(d.due_at = n.at) from public.push_deliveries d
     join public.notifications n on n.id = d.notification_id where d.user_id = :'A'));
select set_config('request.jwt.claim.sub', :'A', false); set role authenticated;

-- En ny runde med nøyaktig det samme skal ikke lage flere leveringer.
select public.notify_record(jsonb_build_array(
  jsonb_build_object('key', 'dueSoon|card|' || :'AC' || '|2026-09-01', 'type', 'dueSoon',
    'obj_type', 'card', 'obj_id', :'AC', 'name', 'Frist-liste', 'path', 'x',
    'value', '2026-09-01', 'at', :'fram'::bigint)));
select public.t_check('en ny generator-runde dupliserer ikke utboksen',
  public.t_deliveries(:'A'::uuid) = 2);

-- ---------- 3. et nytt abonnement får det som ALT er planlagt ----------
select public.push_subscribe('https://push.example.com/a3', 'p256-c', 'auth-c',
  '{"dueSoon": "Frist innen en uke"}'::jsonb, 'Europe/Oslo');
select public.t_check('en enhet som melder seg på ETTER planleggingen får de planlagte varslene',
  public.t_deliveries(:'A'::uuid) = 3);

-- ---------- 4. avlysning: sletter man raden, forsvinner leveringen ----------
delete from public.notifications where user_id = :'A' and key like 'dueSoon|%';
select public.t_check('en avlyst plan tar leveringene med seg (kaskade)',
  public.t_deliveries(:'A'::uuid) = 0);

-- ---------- 5. RLS: ingen ser eller rører en annens abonnement ----------
reset role; select set_config('request.jwt.claim.sub', :'B', false); set role authenticated;
select public.push_subscribe('https://push.example.com/b1', 'p256-b1', 'auth-b1',
  '{"dueOver": "Deadline passed"}'::jsonb, 'America/New_York');
select public.t_check('B ser bare sitt eget abonnement',
  (select count(*) from public.push_subscriptions) = 1);
delete from public.push_subscriptions where user_id = :'A';
reset role; select set_config('request.jwt.claim.sub', :'A', false); set role authenticated;
select public.t_check('B kunne ikke slette A sine abonnementer',
  (select count(*) from public.push_subscriptions where user_id = :'A') = 3);
select public.t_fails('ingen klient kan skrive et abonnement direkte (INSERT er trukket tilbake)',
  $$insert into public.push_subscriptions (user_id, endpoint, p256dh, auth)
    values (auth.uid(), 'https://push.example.com/direkte', 'k', 'a')$$);
select public.t_fails('utboksen er ikke lesbar for klienten i det hele tatt',
  $$select count(*) from public.push_deliveries$$);

-- «Slå av i denne nettleseren» tar mitt eget abonnement — og bare det.
select public.push_unsubscribe('https://push.example.com/a3');
select public.t_check('push_unsubscribe() fjerner endepunktet',
  (select count(*) from public.push_subscriptions where user_id = :'A') = 2);
select public.push_unsubscribe('https://push.example.com/b1');
reset role;
select public.t_check('… men aldri en annen brukers endepunkt',
  (select count(*) from public.push_subscriptions where user_id = :'B') = 1);
select set_config('request.jwt.claim.sub', :'A', false); set role authenticated;

-- ---------- 5b. EIERSKIFTE: køen tilhører den forrige brukeren ----------
-- Endepunktet ER nettleseren. Logger noen andre inn i den samme nettleseren,
-- flyttes abonnementet — og da skal ikke den forrige brukerens køede varsler,
-- som hver bærer et objektnavn, bli levert til den nye.
select public.push_subscribe('https://push.example.com/delt', 'p256-d', 'auth-d',
  '{"dueSoon": "Frist innen en uke"}'::jsonb, 'Europe/Oslo') as sub_delt \gset
select public.notify_record(jsonb_build_array(
  jsonb_build_object('key', 'dueSoon|card|' || :'AC' || '|2027-06-01', 'type', 'dueSoon',
    'obj_type', 'card', 'obj_id', :'AC', 'name', 'Hemmelig avtale', 'path', 'x',
    'value', '2027-06-01', 'at', :'fram'::bigint)));
select public.t_check('A har en køet levering til den delte nettleseren',
  public.t_deliveries(:'A'::uuid, 'pending') > 0);

reset role; select set_config('request.jwt.claim.sub', :'B', false); set role authenticated;
select public.push_subscribe('https://push.example.com/delt', 'p256-d2', 'auth-d2',
  '{"dueSoon": "Deadline within a week"}'::jsonb, 'America/New_York');
reset role;
select public.t_check('B overtar endepunktet — og A sin kø til det er borte',
  (select count(*) from public.push_deliveries d
    where d.subscription_id = :'sub_delt'::uuid and d.user_id = :'A'::uuid) = 0);
select public.t_check('… mens abonnementet nå står på B',
  (select user_id from public.push_subscriptions where id = :'sub_delt'::uuid) = :'B'::uuid);
-- Andre lag: en levering som LIKEVEL skulle blitt hengende igjen etter et
-- eierskifte skal være inert for senderen, ikke leveres til feil bruker.
insert into public.push_deliveries (notification_id, subscription_id, user_id, due_at)
select n.id, :'sub_delt'::uuid, :'A'::uuid, :'bak'::bigint
  from public.notifications n where n.user_id = :'A' limit 1;
select set_config('request.jwt.claims', '{"role":"service_role"}', false);
select public.t_check('senderen plukker aldri opp en levering som ikke hører til abonnementets eier',
  not exists (
    select 1 from jsonb_array_elements(public.push_claim(50, 0)) x
     where (x ->> 'endpoint') = 'https://push.example.com/delt'));
delete from public.push_deliveries where subscription_id = :'sub_delt'::uuid;
delete from public.push_subscriptions where id = :'sub_delt'::uuid;
-- Rydd fiksturen tilbake dit seksjon 6 forventer den.
delete from public.notifications where user_id = :'A' and name = 'Hemmelig avtale';
select set_config('request.jwt.claims', '', false);
select set_config('request.jwt.claim.sub', :'A', false); set role authenticated;

-- ---------- 6. senderens funksjoner er stengt for klienten ----------
select public.t_fails('push_claim() er ikke kallbar som innlogget bruker',
  $$select public.push_claim(10)$$);
select public.t_fails('push_report() er ikke kallbar som innlogget bruker',
  $$select public.push_report('[]'::jsonb)$$);

-- ---------- 7. senderen: hent, send, meld tilbake ----------
select public.notify_record(jsonb_build_array(
  jsonb_build_object('key', 'startSoon|card|' || :'AC' || '|2026-10-01', 'type', 'startSoon',
    'obj_type', 'card', 'obj_id', :'AC', 'name', 'Frist-liste', 'path', 'x',
    'value', '2026-10-01', 'at', :'bak'::bigint + 1)));
-- Terskelen ligger bak oss, så den gir ingen levering. Vi planlegger i stedet
-- én fram i tid og trekker den så tilbake i tid, slik senderen ser den forfalt.
select public.notify_record(jsonb_build_array(
  jsonb_build_object('key', 'dueOver|card|' || :'AC' || '|2026-12-24', 'type', 'dueOver',
    'obj_type', 'card', 'obj_id', :'AC', 'name', 'Julefrist', 'path', 'x',
    'value', '2026-12-24', 'at', :'fram'::bigint)));
select public.t_check('to abonnementer gir to leveringer av det samme varselet',
  public.t_deliveries(:'A'::uuid, 'pending') = 2);

reset role;
update public.push_deliveries set due_at = :'bak'::bigint;
select set_config('request.jwt.claims', '{"role":"service_role"}', false);
select jsonb_array_length(public.push_claim(10)) as antall \gset
select public.t_check('senderen henter begge de forfalte leveringene', :'antall'::int = 2);
select public.t_check('… låst, så en samtidig kjøring ikke sender det samme igjen',
  jsonb_array_length(public.push_claim(10)) = 0);
select public.t_check('kroppen bærer navnet og typeteksten på brukerens språk — ingen sti, ingen token',
  (select (public.push_claim(10, 0) -> 0 -> 'payload' ->> 'n') = 'Julefrist'
      and (public.push_claim(10, 0) -> 0 -> 'payload' ->> 'b') = 'Frist utløpt'
      and not (public.push_claim(10, 0) -> 0 -> 'payload') ? 'path'));

-- Den ene gikk gjennom, den andre er død.
select id as d1 from public.push_deliveries where user_id = :'A' order by id limit 1 \gset
select id as d2 from public.push_deliveries where user_id = :'A' order by id desc limit 1 \gset
select public.push_report(jsonb_build_array(
  jsonb_build_object('id', :'d1'::bigint, 'ok', true),
  jsonb_build_object('id', :'d2'::bigint, 'gone', true)));
select public.t_check('en levert push er markert sendt',
  (select status from public.push_deliveries where id = :'d1'::bigint) = 'sent');
select public.t_check('et dødt endepunkt (404/410) slås av for godt',
  (select status from public.push_deliveries where id = :'d2'::bigint) = 'gone'
  and (select disabled_at is not null from public.push_subscriptions
        where id = (select subscription_id from public.push_deliveries where id = :'d2'::bigint)));
select public.t_check('… og et avslått abonnement får ingen nye leveringer',
  (select public.push_enqueue(:'A'::uuid)) = 0);

-- En midlertidig feil skal prøves igjen, ikke gis opp.
reset role; select set_config('request.jwt.claim.sub', :'A', false); set role authenticated;
select public.notify_record(jsonb_build_array(
  jsonb_build_object('key', 'startNow|card|' || :'AC' || '|2027-01-01', 'type', 'startNow',
    'obj_type', 'card', 'obj_id', :'AC', 'name', 'Nyttår', 'path', 'x',
    'value', '2027-01-01', 'at', :'fram'::bigint)));
reset role;
update public.push_deliveries set due_at = :'bak'::bigint where status = 'pending';
select set_config('request.jwt.claims', '{"role":"service_role"}', false);
select jsonb_array_length(public.push_claim(10)) as n2 \gset
select public.t_check('den nye leveringen hentes', :'n2'::int = 1);
select id as d3 from public.push_deliveries where status = 'pending' order by id desc limit 1 \gset
select public.push_report(jsonb_build_array(jsonb_build_object('id', :'d3'::bigint, 'error', '503')));
select public.t_check('en midlertidig feil holder leveringen ventende og teller et forsøk',
  (select status = 'pending' and attempts = 1 and error = '503'
     from public.push_deliveries where id = :'d3'::bigint));
select public.t_check('… og den kan hentes igjen med det samme (låsen er sluppet)',
  jsonb_array_length(public.push_claim(10)) = 1);
-- Etter fem forsøk gis den opp.
update public.push_deliveries set attempts = 5, claimed_at = null where id = :'d3'::bigint;
select public.push_report(jsonb_build_array(jsonb_build_object('id', :'d3'::bigint, 'error', '500')));
select public.t_check('etter fem forsøk gis leveringen opp',
  (select status from public.push_deliveries where id = :'d3'::bigint) = 'failed');

-- ---------- 8. tidssonen planen tilhører ----------
reset role; select set_config('request.jwt.claims', '', false);
select set_config('request.jwt.claim.sub', :'A', false); set role authenticated;
select public.t_check('en tom prefs-sone hevdes med én gang',
  public.notify_claim_tz('Europe/Oslo', 21600000) = 'Europe/Oslo');
select public.t_check('en enhet i en ANNEN sone overtar ikke en fersk hevdelse',
  public.notify_claim_tz('America/New_York', 21600000) = 'Europe/Oslo');
select public.t_check('… men den samme sonen kan alltid fornye seg selv',
  public.notify_claim_tz('Europe/Oslo', 21600000) = 'Europe/Oslo');
-- Når hevdelsen er blitt gammel nok, overtar den andre enheten.
reset role; update public.notification_prefs set tz_at = 0 where user_id = :'A';
select set_config('request.jwt.claim.sub', :'A', false); set role authenticated;
select public.t_check('en gammel hevdelse kan overtas av en enhet i en ny sone',
  public.notify_claim_tz('America/New_York', 21600000) = 'America/New_York');
select public.t_fails('en tom tidssone avvises', $$select public.notify_claim_tz('')$$);

-- ---------- 9. doc-et forteller klienten hvor mange enheter som er på ----------
select public.t_check('get_my_doc() teller de AKTIVE abonnementene',
  (public.get_my_doc() ->> 'push_devices')::int
    = (select count(*) from public.push_subscriptions where user_id = :'A' and disabled_at is null));
select public.t_check('… og bærer sonen planen tilhører',
  (public.get_my_doc() -> 'notify_prefs' ->> 'tz') = 'America/New_York');

-- ---------- 10. kontosletting tar abonnementene og utboksen med seg ----------
reset role; select set_config('request.jwt.claim.sub', :'B', false); set role authenticated;
select public.t_check('B har sitt eget abonnement før slettingen',
  (select count(*) from public.push_subscriptions where user_id = :'B') = 1);
select public.delete_account();
reset role; select set_config('request.jwt.claim.sub', :'A', false); set role authenticated;
select public.t_check('B sine abonnementer og leveringer er borte med kontoen',
  (select count(*) from public.push_subscriptions where user_id = :'B') = 0
  and public.t_deliveries(:'B'::uuid) = 0);

reset role;
\echo '✅ test-push.sql: alle sjekker grønne'
