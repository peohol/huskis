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
-- Samme luke, men per ABONNEMENT: fjern-avslåingen (seksjon 12) måles på
-- køen til én rad, ikke på brukerens samlede utboks.
create or replace function public.t_sub_deliveries(p_sub uuid, p_status text default null)
returns bigint language sql security definer set search_path = public as $$
  select count(*) from public.push_deliveries d
   where d.subscription_id = p_sub
     and (p_status is null or d.status = p_status);
$$;
grant execute on function public.t_sub_deliveries(uuid, text) to public;

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
-- NØKLENE har en fast form i RFC 8291 — `p256dh` er et ukomprimert P-256-punkt
-- (65 byte → 87 base64url-tegn) og `auth` er 16 byte (22 tegn) — og
-- push_subscribe() håndhever den (seksjon 1b). Fiksturen bruker derfor ekte
-- lengder, ikke «p256-a».
select 'BP' || repeat('k', 83) || 'a1' as k_a1, 'BP' || repeat('k', 83) || 'a2' as k_a2,
       'BP' || repeat('k', 83) || 'b0' as k_b,  'BP' || repeat('k', 83) || 'c0' as k_c,
       'BP' || repeat('k', 83) || 'b1' as k_bb, 'BP' || repeat('k', 83) || 'd0' as k_d,
       'BP' || repeat('k', 83) || 'd2' as k_d2,
       repeat('s', 20) || 'a1' as s_a1, repeat('s', 20) || 'a2' as s_a2,
       repeat('s', 20) || 'b0' as s_b,  repeat('s', 20) || 'c0' as s_c,
       repeat('s', 20) || 'b1' as s_bb, repeat('s', 20) || 'd0' as s_d,
       repeat('s', 20) || 'd2' as s_d2 \gset

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
-- Svaret er `{ "id": …, "revoked": … }`: klienten må kunne se at et
-- abonnement brukeren har slått av fra en annen enhet IKKE ble slått på igjen.
select (public.push_subscribe('https://push.example.com/a1', :'k_a1', :'s_a1',
  jsonb_build_object('dueOver', 'Frist utløpt', 'dueSoon', 'Frist innen en uke',
                     'startNow', 'Begynner nå', 'startSoon', 'Begynner innen en uke'),
  'Europe/Oslo', 'Chrome', 'Android', 'www.huskis.no', 'd-a1') ->> 'id') as sub_a \gset
select public.t_check('abonnementet ble registrert på den innloggede brukeren',
  (select user_id from public.push_subscriptions where id = :'sub_a'::uuid) = :'A'::uuid);
select public.t_check('… med nøklene, etikettene og sonen',
  (select p256dh = :'k_a1' and auth = :'s_a1' and tz = 'Europe/Oslo'
          and labels ->> 'dueOver' = 'Frist utløpt'
     from public.push_subscriptions where id = :'sub_a'::uuid));
-- Metadataen er det som gjør raden gjenkjennelig i «Enheter med varsler».
select public.t_check('… og den gjenkjennelige metadataen (nettleser, plattform, vert, enhets-id)',
  (select browser = 'Chrome' and platform = 'Android' and origin = 'www.huskis.no'
          and device_id = 'd-a1'
     from public.push_subscriptions where id = :'sub_a'::uuid));

-- Fornyelse: den SAMME nettleseren melder seg på nytt (nye nøkler etter en
-- pushsubscriptionchange). Én rad, ikke to.
select public.push_subscribe('https://push.example.com/a1', :'k_a2', :'s_a2',
  '{"dueOver": "Frist utløpt"}'::jsonb, 'Europe/Oslo');
select public.t_check('samme endepunkt to ganger gir ÉN rad (fornyelse, ikke dublett)',
  (select count(*) from public.push_subscriptions where user_id = :'A') = 1);
select public.t_check('… og nøklene ble oppdatert',
  (select p256dh from public.push_subscriptions where user_id = :'A') = :'k_a2');

-- En bruker kan ha flere nettlesere.
select public.push_subscribe('https://push.example.com/a2', :'k_b', :'s_b',
  '{"dueOver": "Frist utløpt"}'::jsonb, 'Europe/Oslo');
select public.t_check('flere enheter per bruker: to endepunkter, to rader',
  (select count(*) from public.push_subscriptions where user_id = :'A') = 2);

-- ---------- 1b. hva et abonnement FÅR være ----------
-- Endepunktet blir målet for et HTTP-kall senderen gjør på vegne av serveren,
-- og en innlogget konto er hele inngangsbilletten. Uten grensene under er
-- push_subscribe() en forsterker: vilkårlig mange rader, hver med sitt eget
-- mål, og hver av dem multipliserer både utboksen og antall HTTP-kall.
select public.t_fails('et endepunkt uten https avvises',
  format($$select public.push_subscribe('http://push.example.com/x', %L, %L)$$, :'k_c', :'s_c'));
select public.t_fails('… en bar IP-adresse er ingen pushtjeneste',
  format($$select public.push_subscribe('https://10.0.0.5/x', %L, %L)$$, :'k_c', :'s_c'));
select public.t_fails('… og heller ikke localhost',
  format($$select public.push_subscribe('https://localhost:8000/x', %L, %L)$$, :'k_c', :'s_c'));
select public.t_fails('et endepunkt uten vertsnavn avvises',
  format($$select public.push_subscribe('https:///x', %L, %L)$$, :'k_c', :'s_c'));
select public.t_fails('et endepunkt med kontrolltegn avvises',
  format($$select public.push_subscribe(%L, %L, %L)$$,
         'https://push.example.com/' || chr(10) || 'x', :'k_c', :'s_c'));
select public.t_fails('et endepunkt over 2000 tegn avvises',
  format($$select public.push_subscribe('https://push.example.com/' || repeat('x', 2000), %L, %L)$$,
         :'k_c', :'s_c'));

-- Nøklene har en fast form i RFC 8291. Serveren krever den ikke på byten (en
-- nettleser kan kode med padding), men søppel skal ikke inn i en tabell
-- senderen leser fra.
select public.t_fails('en p256dh-nøkkel av feil lengde avvises',
  format($$select public.push_subscribe('https://push.example.com/x1', 'kort', %L)$$, :'s_c'));
select public.t_fails('en auth-nøkkel av feil lengde avvises',
  format($$select public.push_subscribe('https://push.example.com/x2', %L, 'kort')$$, :'k_c'));
select public.t_fails('en nøkkel som ikke er base64url avvises',
  format($$select public.push_subscribe('https://push.example.com/x3', %L, %L)$$,
         repeat('a', 86) || '!', :'s_c'));

-- TAKET. En bruker har en håndfull nettlesere. Her melder A på langt flere enn
-- taket, og resultatet skal være at taket holder, at den SISTE påmeldingen er
-- den som står igjen (det er den brukeren faktisk sitter med), og at køen til
-- dem som røk forsvant med dem.
do $$
declare i integer;
begin
  for i in 1..(public.push_sub_max() + 6) loop
    perform public.push_subscribe('https://push.example.com/tak-' || i,
      'BP' || repeat('t', 83) || lpad(i::text, 2, '0'),
      repeat('u', 20) || lpad(i::text, 2, '0'));
  end loop;
end $$;
select public.t_check('taket holder: en bruker får ikke flere aktive abonnementer enn maks',
  (select count(*) from public.push_subscriptions where user_id = :'A') = public.push_sub_max());
select public.t_check('… og det er den SISTE påmeldingen som står igjen',
  exists (select 1 from public.push_subscriptions
           where user_id = :'A'
             and endpoint = 'https://push.example.com/tak-' || (public.push_sub_max() + 6)));
reset role;
select public.t_check('… og utboksen har ingen levering til et abonnement som er kastet ut',
  (select count(*) from public.push_deliveries d
    where not exists (select 1 from public.push_subscriptions s where s.id = d.subscription_id)) = 0);
select set_config('request.jwt.claim.sub', :'A', false); set role authenticated;

-- Tilbake til fiksturen seksjon 2 og utover forventer: nøyaktig de to
-- endepunktene a1 og a2, og ingenting annet.
delete from public.push_subscriptions where user_id = :'A';
select public.push_subscribe('https://push.example.com/a1', :'k_a2', :'s_a2',
  '{"dueOver": "Frist utløpt"}'::jsonb, 'Europe/Oslo');
select public.push_subscribe('https://push.example.com/a2', :'k_b', :'s_b',
  '{"dueOver": "Frist utløpt"}'::jsonb, 'Europe/Oslo');
select public.t_check('fiksturen er tilbake til to abonnementer',
  (select count(*) from public.push_subscriptions where user_id = :'A') = 2);

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

-- ---------- 2b. et PLANLAGT varsel bærer et FERSKT navn ----------
/* Navnet på en varselrad er et øyeblikksbilde. For HISTORIKK er det riktig: et
   varsel beskriver hva som het hva da det skjedde. En PLANLAGT rad er ikke
   historikk — den kan ligge en måned før den forfaller, og det er DEN teksten
   web push leverer (`push_claim()` bygger kroppen av `notifications.name`).
   Døpes objektet om i mellomtiden, skal varselet si det nye navnet. */
select public.notify_record(jsonb_build_array(
  jsonb_build_object('key', 'dueSoon|card|' || :'AC' || '|2026-09-01', 'type', 'dueSoon',
    'obj_type', 'card', 'obj_id', :'AC', 'name', 'Legetime', 'path', 'y',
    'value', '2026-09-01', 'at', :'fram'::bigint),
  jsonb_build_object('key', 'dueOver|card|' || :'AC' || '|2026-01-10', 'type', 'dueOver',
    'obj_type', 'card', 'obj_id', :'AC', 'name', 'Legetime', 'path', 'y',
    'value', '2026-01-10', 'at', :'bak'::bigint)));
select public.t_check('en PLANLAGT rad får det nye navnet og den nye stien',
  (select name = 'Legetime' and path = 'y' from public.notifications
    where user_id = :'A' and key like 'dueSoon|%'));
select public.t_check('… mens historikken beholder navnet den ble logget med',
  (select name = 'Frist-liste' and path = 'x' from public.notifications
    where user_id = :'A' and key like 'dueOver|%'));
select public.t_check('… og oppdateringen lager ingen dublett i utboksen',
  public.t_deliveries(:'A'::uuid) = 2);
-- Tilbake til navnet seksjonene under forventer.
select public.notify_record(jsonb_build_array(
  jsonb_build_object('key', 'dueSoon|card|' || :'AC' || '|2026-09-01', 'type', 'dueSoon',
    'obj_type', 'card', 'obj_id', :'AC', 'name', 'Frist-liste', 'path', 'x',
    'value', '2026-09-01', 'at', :'fram'::bigint)));

-- ---------- 3. et nytt abonnement får det som ALT er planlagt ----------
select public.push_subscribe('https://push.example.com/a3', :'k_c', :'s_c',
  '{"dueSoon": "Frist innen en uke"}'::jsonb, 'Europe/Oslo');
select public.t_check('en enhet som melder seg på ETTER planleggingen får de planlagte varslene',
  public.t_deliveries(:'A'::uuid) = 3);

-- ---------- 4. avlysning: sletter man raden, forsvinner leveringen ----------
delete from public.notifications where user_id = :'A' and key like 'dueSoon|%';
select public.t_check('en avlyst plan tar leveringene med seg (kaskade)',
  public.t_deliveries(:'A'::uuid) = 0);

-- ---------- 5. RLS: ingen ser eller rører en annens abonnement ----------
reset role; select set_config('request.jwt.claim.sub', :'B', false); set role authenticated;
select public.push_subscribe('https://push.example.com/b1', :'k_bb', :'s_bb',
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
select (public.push_subscribe('https://push.example.com/delt', :'k_d', :'s_d',
  '{"dueSoon": "Frist innen en uke"}'::jsonb, 'Europe/Oslo') ->> 'id') as sub_delt \gset
select public.notify_record(jsonb_build_array(
  jsonb_build_object('key', 'dueSoon|card|' || :'AC' || '|2027-06-01', 'type', 'dueSoon',
    'obj_type', 'card', 'obj_id', :'AC', 'name', 'Hemmelig avtale', 'path', 'x',
    'value', '2027-06-01', 'at', :'fram'::bigint)));
select public.t_check('A har en køet levering til den delte nettleseren',
  public.t_deliveries(:'A'::uuid, 'pending') > 0);

reset role; select set_config('request.jwt.claim.sub', :'B', false); set role authenticated;
select public.push_subscribe('https://push.example.com/delt', :'k_d2', :'s_d2',
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

-- ---------- 7b. et dødt endepunkt tar KØEN sin med seg ----------
/* 404/410 betyr at endepunktet ikke finnes lenger. Da er ikke bare DEN ene
   leveringen tapt — hele køen til det endepunktet er like usendbar. Blir den
   liggende som `pending`, vekker den senderen hvert minutt for arbeid som
   aldri kan lykkes. Her tar den slutt, og i to lag: køen avsluttes, OG
   `push_claim()` plukker aldri opp en levering til et avslått abonnement. */
reset role; select set_config('request.jwt.claims', '', false);
select set_config('request.jwt.claim.sub', :'A', false); set role authenticated;
select (public.push_subscribe('https://push.example.com/dodt', :'k_bb', :'s_bb',
  '{"dueOver": "Frist utløpt"}'::jsonb, 'Europe/Oslo') ->> 'id') as sub_d \gset
select public.notify_record(jsonb_build_array(
  jsonb_build_object('key', 'dueOver|card|' || :'AC' || '|2027-03-01', 'type', 'dueOver',
    'obj_type', 'card', 'obj_id', :'AC', 'name', 'Mars 1', 'path', 'x',
    'value', '2027-03-01', 'at', :'fram'::bigint),
  jsonb_build_object('key', 'dueOver|card|' || :'AC' || '|2027-03-02', 'type', 'dueOver',
    'obj_type', 'card', 'obj_id', :'AC', 'name', 'Mars 2', 'path', 'x',
    'value', '2027-03-02', 'at', :'fram'::bigint),
  jsonb_build_object('key', 'dueOver|card|' || :'AC' || '|2027-03-03', 'type', 'dueOver',
    'obj_type', 'card', 'obj_id', :'AC', 'name', 'Mars 3', 'path', 'x',
    'value', '2027-03-03', 'at', :'fram'::bigint)));
reset role;
select count(*)::int as ko_d from public.push_deliveries
 where subscription_id = :'sub_d'::uuid and status = 'pending' \gset
select public.t_check('det nye abonnementet har flere ventende leveringer', :'ko_d' >= 3);
update public.push_deliveries set due_at = :'bak'::bigint where subscription_id = :'sub_d'::uuid;
select set_config('request.jwt.claims', '{"role":"service_role"}', false);
select id as dd from public.push_deliveries
 where subscription_id = :'sub_d'::uuid and status = 'pending' order by id limit 1 \gset
select public.push_report(jsonb_build_array(
  jsonb_build_object('id', :'dd'::bigint, 'gone', true)));
select public.t_check('endepunktet er slått av etter 410',
  (select disabled_at is not null from public.push_subscriptions where id = :'sub_d'::uuid));
select public.t_check('… og RESTEN av køen til det er avsluttet, ikke liggende',
  (select count(*) from public.push_deliveries
    where subscription_id = :'sub_d'::uuid and status = 'pending') = 0);
select public.t_check('… ingen ventende levering peker på et avslått abonnement',
  (select count(*) from public.push_deliveries d
     join public.push_subscriptions s on s.id = d.subscription_id
    where d.status = 'pending' and s.disabled_at is not null) = 0);

/* ANDRE LAG. En rad som likevel skulle bli stående — en eldre klient, en
   halvveis migrering — skal være INERT, ikke levert. Her settes køen tilbake
   til `pending` med vilje, og alt annet ryddes vekk, så tellingen er entydig. */
reset role;
update public.push_deliveries set status = 'sent', done_at = 0
 where subscription_id <> :'sub_d'::uuid and status = 'pending';
update public.push_deliveries set status = 'pending', claimed_at = null, done_at = null
 where subscription_id = :'sub_d'::uuid;
select set_config('request.jwt.claims', '{"role":"service_role"}', false);
select public.t_check('senderen henter aldri en levering til et avslått abonnement',
  not exists (select 1 from jsonb_array_elements(public.push_claim(50, 0)) e
               where (e ->> 'endpoint') = 'https://push.example.com/dodt'));
reset role;
select count(*)::int as ko_igjen from public.push_deliveries
 where subscription_id = :'sub_d'::uuid and status = 'pending' \gset
select set_config('request.jwt.claims', '{"role":"service_role"}', false);
select public.t_check('… og tikket ser ikke arbeid som aldri kan lykkes',
  public.push_due_count() = 0 and :'ko_igjen' >= 3);
reset role;
update public.push_deliveries set status = 'gone', done_at = 0
 where subscription_id = :'sub_d'::uuid;

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

-- ---------- 11. headerne tikket sender ----------
/* De to nøkkeltypene skal IKKE ha like headere. En `sb_secret_…` er ikke et
   JWT, og sendes den SAMTIDIG på `Authorization: Bearer`, prøver plattformen å
   tolke den som JWT og avviser hele kallet med «Invalid JWT» — altså nettopp
   den veien Supabase nå anbefaler. Den gamle service_role-nøkkelen er et JWT og
   skal fortsatt ha begge. Her kjøres avgjørelsen, den leses ikke. */
reset role;
select public.t_check('en ny secret key sendes på apikey',
  public.push_headers('sb_secret_v1_QmVyZ2VuUmVnbmVyTWVzdA') ->> 'apikey'
    = 'sb_secret_v1_QmVyZ2VuUmVnbmVyTWVzdA');
select public.t_check('… og ligger IKKE i Authorization',
  not (public.push_headers('sb_secret_v1_QmVyZ2VuUmVnbmVyTWVzdA') ? 'Authorization'));
select public.t_check('… og finnes bare i den ene headeren',
  (select count(*) from jsonb_each_text(
     public.push_headers('sb_secret_v1_QmVyZ2VuUmVnbmVyTWVzdA'))
    where value like '%QmVyZ2VuUmVnbmVyTWVzdA%') = 1);
select public.t_check('en legacy service_role-nøkkel sendes på begge, som før',
  public.push_headers('eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.c2ln')
    = jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey', 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.c2ln',
        'Authorization', 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.c2ln'));
select public.t_check('begge veier bærer Content-Type',
  public.push_headers('sb_secret_x') ->> 'Content-Type' = 'application/json');
set role authenticated;
select public.t_fails('push_headers() er stengt for vanlige brukere',
  $$select public.push_headers('sb_secret_x')$$);

-- ---------- 12. FJERN-AVSLÅING: brukerens eget valg, ikke en feil ----------
/* «Slå av» på en annen enhet må være VARIG. Var den bare en midlertidig
   avslåing på serveren, ville den avslåtte nettleseren meldt seg på igjen i
   neste synk-runde — og valget hadde i praksis ikke betydd noe.

   Derfor er `revoked_at` noe annet enn `disabled_at`: den første er brukerens
   valg og oppheves BARE av et eksplisitt «slå på varsler» på nettopp den
   klienten; den andre er push-tjenestens 404/410 og våkner av seg selv når
   nettleseren beviser at endepunktet lever igjen. */
reset role;
select set_config('request.jwt.claims', '', false);
select set_config('request.jwt.claim.sub', :'A', false); set role authenticated;
-- Blanke ark for denne seksjonen: både abonnementene og planen fra de
-- foregående, så tellingene under gjelder nøyaktig det som skjer her.
delete from public.push_subscriptions where user_id = :'A';
delete from public.notifications where user_id = :'A';

-- To ORIGINS på samme maskin er to uavhengige mottakere: hver nettleserkontekst
-- har sitt eget endepunkt, og en forhåndsvisning er ikke produksjonsenheten.
select (public.push_subscribe('https://push.example.com/her', :'k_a1', :'s_a1',
  '{"dueOver": "Frist utløpt"}'::jsonb, 'Europe/Oslo',
  'Chrome', 'Android', 'www.huskis.no', 'd-her') ->> 'id') as sub_her \gset
select (public.push_subscribe('https://push.example.com/der', :'k_b', :'s_b',
  '{"dueOver": "Frist utløpt"}'::jsonb, 'Europe/Oslo',
  'Chrome', 'Windows', 'forhaandsvisning.example.app', 'd-der') ->> 'id') as sub_der \gset
select public.t_check('to nettleserkontekster gir to abonnementer, hver med sin vert',
  (select count(*) from public.push_subscriptions where user_id = :'A') = 2
  and (select origin from public.push_subscriptions where id = :'sub_der'::uuid)
      = 'forhaandsvisning.example.app');

-- Metadata oppdateres uten å lage en dublett.
select public.push_subscribe('https://push.example.com/der', :'k_b', :'s_b',
  '{"dueOver": "Frist utløpt"}'::jsonb, 'Europe/Oslo',
  'Firefox', 'Windows', 'forhaandsvisning.example.app', 'd-der');
select public.t_check('oppdatert metadata gir ÉN rad, ikke en til',
  (select count(*) from public.push_subscriptions where user_id = :'A') = 2
  and (select browser from public.push_subscriptions where id = :'sub_der'::uuid) = 'Firefox');

-- Noe ligger i kø til begge.
select public.notify_record(jsonb_build_array(
  jsonb_build_object('key', 'dueOver|card|' || :'AC' || '|2028-01-01', 'type', 'dueOver',
    'obj_type', 'card', 'obj_id', :'AC', 'name', 'Nyttår', 'path', 'x',
    'value', '2028-01-01', 'at', :'fram'::bigint)));
select public.t_check('begge abonnementene har en ventende levering',
  public.t_deliveries(:'A'::uuid, 'pending') = 2);

-- Slå av DEN andre.
select public.push_revoke(:'sub_der'::uuid) as rv \gset
select public.t_check('push_revoke() slo av riktig abonnement', :'rv' = 't');
select public.t_check('… det teller ikke lenger som aktivt',
  (select count(*) from public.push_subscriptions
    where user_id = :'A' and disabled_at is null and revoked_at is null) = 1);
select public.t_check('… og den som ble slått av er MERKET som tilbakekalt, ikke som død',
  (select revoked_at is not null and disabled_at is null
     from public.push_subscriptions where id = :'sub_der'::uuid));
select public.t_check('… ventende leveringer til det er AVSLUTTET, ikke liggende',
  public.t_deliveries(:'A'::uuid, 'pending') = 1);
reset role; select set_config('request.jwt.claims', '{"role":"service_role"}', false);
select public.t_check('senderen plukker aldri opp en levering til et tilbakekalt abonnement',
  not exists (select 1 from jsonb_array_elements(public.push_claim(50, 0)) x
               where (x ->> 'endpoint') = 'https://push.example.com/der'));
select set_config('request.jwt.claims', '', false);
select set_config('request.jwt.claim.sub', :'A', false); set role authenticated;

-- Ingen nye leveringer heller: et tilbakekalt abonnement er ikke aktivt.
select public.notify_record(jsonb_build_array(
  jsonb_build_object('key', 'dueOver|card|' || :'AC' || '|2028-02-02', 'type', 'dueOver',
    'obj_type', 'card', 'obj_id', :'AC', 'name', 'Februar', 'path', 'x',
    'value', '2028-02-02', 'at', :'fram'::bigint)));
select public.t_check('en ny plan gir bare leveringer til det AKTIVE abonnementet',
  public.t_deliveries(:'A'::uuid, 'pending') = 2
  and public.t_sub_deliveries(:'sub_der'::uuid, 'pending') = 0);

/* DEN AVSLÅTTE KLIENTEN MELDER SEG PÅ IGJEN — automatisk, som hver synk-runde
   gjør. Den skal IKKE komme tilbake av seg selv, og svaret må si hvorfor, så
   klienten kan rigge ned sin egen ende. */
select public.push_subscribe('https://push.example.com/der', :'k_b', :'s_b',
  '{"dueOver": "Frist utløpt"}'::jsonb, 'Europe/Oslo',
  'Firefox', 'Windows', 'forhaandsvisning.example.app', 'd-der') as auto \gset
select public.t_check('en fjern-avslått klient registrerer seg IKKE automatisk på nytt',
  (:'auto'::jsonb ->> 'revoked') = 'true'
  and (select revoked_at is not null from public.push_subscriptions where id = :'sub_der'::uuid));

-- … men et EKSPLISITT «slå på varsler» på nettopp den klienten tar det tilbake.
select public.push_subscribe('https://push.example.com/der', :'k_b', :'s_b',
  '{"dueOver": "Frist utløpt"}'::jsonb, 'Europe/Oslo',
  'Firefox', 'Windows', 'forhaandsvisning.example.app', 'd-der', true) as eksp \gset
select public.t_check('… mens et eksplisitt «slå på» der aktiverer det igjen',
  (:'eksp'::jsonb ->> 'revoked') = 'false'
  and (select revoked_at is null from public.push_subscriptions where id = :'sub_der'::uuid));

-- ---------- 12b. «slå av på alle andre enheter» ----------
select public.push_revoke_others('https://push.example.com/her') as n_andre \gset
select public.t_check('«slå av alle andre» slo av de andre', :'n_andre'::int = 1);
select public.t_check('… og BEHOLDT denne enheten',
  (select revoked_at is null from public.push_subscriptions where id = :'sub_her'::uuid)
  and (select revoked_at is not null from public.push_subscriptions where id = :'sub_der'::uuid));

-- ---------- 12c. en annen bruker kommer ingen vei ----------
reset role; select set_config('request.jwt.claim.sub', :'B', false); set role authenticated;
select public.t_check('B kan ikke slå av A sitt abonnement — og svaret røper ikke at det finnes',
  public.push_revoke(:'sub_her'::uuid) = false);
select public.push_revoke_others(null) as b_andre \gset
reset role;
select public.t_check('… og «slå av alle andre» rører bare Bs egne rader',
  (select revoked_at is null from public.push_subscriptions where id = :'sub_her'::uuid));
select set_config('request.jwt.claim.sub', :'A', false); set role authenticated;
select public.t_fails('… og et abonnement kan ikke tilbakekalles ved å skrive i tabellen',
  $$update public.push_subscriptions set revoked_at = 1 where id is not null$$);

reset role;
\echo '✅ test-push.sql: alle sjekker grønne'
