-- ============================================================
-- Testsuite for e-postvarsel ved deling (send_invite_email + url_encode +
-- html_escape + email_send_log). Kjøres mot en LOKAL PostgreSQL etter
-- local-stub.sql + users-and-sharing.sql + test-users-and-sharing.sql
-- (som definerer t_check/t_fails). Se tests/run-tests.sh.
--
-- ADVARSEL: skal ALDRI kjøres mot ekte Supabase — filen lager net-/vault-
-- STUBBER (dropper og gjenoppretter schema `net` og `vault`) for å fange
-- Resend-kallet uten faktisk HTTP. På ekte Supabase ville det ødelagt pg_net.
--
-- pg_net er asynkron: `net.http_post` kan i praksis bare KØLEGGE forespørselen;
-- en ekte Resend HTTP 4xx/5xx kommer senere i net._http_response og er IKKE en
-- trigger-exception. Stubben her simulerer derfor bare det synkrone laget
-- (kølegging OK / kølegging kaster) — den beviser IKKE noe om ekte async-svar.
-- ============================================================

\set ON_ERROR_STOP on
reset role;

-- t_check/t_fails er allerede definert av test-users-and-sharing.sql, men vi
-- gjenskaper dem så filen også kan kjøres frittstående.
create or replace function public.t_check(name text, cond boolean)
returns text language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FAIL: %', name; end if;
  return 'PASS: ' || name;
end $$;
create or replace function public.t_fails(name text, cmd text)
returns text language plpgsql as $$
begin
  begin execute cmd;
  exception when others then return 'PASS (blokkert): ' || name || ' — ' || sqlerrm; end;
  raise exception 'FAIL (skulle vært blokkert): %', name;
end $$;
grant execute on function public.t_check(text, boolean) to public;
grant execute on function public.t_fails(text, text) to public;

-- ---------- 1. url_encode (byte-sikker RFC 3986) ----------
select public.t_check('url_encode: + @ & mellomrom',
  public.url_encode('a b+c@d&e') = 'a%20b%2Bc%40d%26e');
select public.t_check('url_encode: bevarer unreserved (- . _ ~) og ASCII-alfanum',
  public.url_encode('Az9-._~') = 'Az9-._~');
select public.t_check('url_encode: Unicode (æ = UTF-8 C3 A6)',
  public.url_encode('æ') = '%C3%A6');
select public.t_check('url_encode: full e-post med +',
  public.url_encode('ny+bruker@example.com') = 'ny%2Bbruker%40example.com');

-- ---------- 2. html_escape ( < > & " ' ) ----------
select public.t_check('html_escape: alle fem tegn',
  public.html_escape('a<b>c&d"e''f') = 'a&lt;b&gt;c&amp;d&quot;e&#39;f');

-- ---------- 3. stubber + konfig ----------
drop schema if exists net cascade;
create schema net;
create table net._sent(id bigint generated always as identity primary key,
                       url text, headers jsonb, body jsonb);
create function net.http_post(url text, headers jsonb default '{}'::jsonb,
                              body jsonb default '{}'::jsonb)
returns bigint language plpgsql as $$
declare rid bigint;
begin
  insert into net._sent(url, headers, body) values (url, headers, body) returning id into rid;
  return rid;
end $$;

drop schema if exists vault cascade;
create schema vault;
create table vault._secrets(name text, decrypted_secret text);
create view vault.decrypted_secrets as select name, decrypted_secret from vault._secrets;

-- app_config-nøkkel er fallback (vault er tom foreløpig).
insert into public.app_config(key, value) values
  ('resend_api_key', 're_APPCONFIG'),
  ('email_from',     'Huskis <noreply@huskis.no>'),
  ('app_url',        'https://www.huskis.no/')
on conflict (key) do update set value = excluded.value;

-- testbrukere (distinkte id-er/e-poster) + ett univers med "farlig" navn.
\set inviter 'ee111111-0000-0000-0000-000000000001'
\set reg     'ee222222-0000-0000-0000-000000000002'
\set off     'ee333333-0000-0000-0000-000000000003'
\set uni     'eeaa1111-0000-0000-0000-000000000001'

insert into auth.users (id, email) values
  (:'inviter', 'e-inviter@example.com'),
  (:'reg',     'reg@example.com'),
  (:'off',     'off@example.com');
-- profiles opprettes av handle_new_user; sett navnene (inviter har "farlige" tegn).
update public.profiles set display_name = 'Ann <b> & "Q" '' O' where id = :'inviter';
update public.profiles set display_name = 'Reg Regson'        where id = :'reg';
update public.profiles set display_name = 'Off Person'         where id = :'off';
insert into public.universes (id, owner_id, name, pos)
  values (:'uni', :'inviter', 'Fam <x> & "y" '' z', 1);

-- ---------- 4. VARIANT A: uregistrert (invitee_id null, e-post med +) ----------
insert into public.share_invites (inviter_id, invitee_email, universe_id)
  values (:'inviter', 'ny+bruker@example.com', :'uni');

select public.t_check('A: share_invites-rad opprettet',
  (select count(*) from public.share_invites where invitee_email = 'ny+bruker@example.com') = 1);
select public.t_check('A: e-post kølagt (enqueued)',
  (select count(*) from net._sent where body->>'to' = 'ny+bruker@example.com') = 1
  and (select enqueue_status from public.email_send_log order by id desc limit 1) = 'enqueued');
select public.t_check('A: fallback til app_config-nøkkel når vault er tom',
  (select headers->>'Authorization' from net._sent where body->>'to' = 'ny+bruker@example.com')
    = 'Bearer re_APPCONFIG');

-- JSON-kropp: både html og text + emne/avsender.
select public.t_check('A: JSON-kroppen har BÅDE html og text',
  (select (body ? 'html') and (body ? 'text') from net._sent where body->>'to' = 'ny+bruker@example.com'));
select public.t_check('A: emne + avsender korrekt',
  (select body->>'subject' from net._sent where body->>'to' = 'ny+bruker@example.com')
    = 'Ann <b> & "Q" '' O har delt «Fam <x> & "y" '' z» med deg på Huskis'
  and (select body->>'from' from net._sent where body->>'to' = 'ny+bruker@example.com')
    = 'Huskis <noreply@huskis.no>');

-- HTML: heading + inviter-navn + objektnavn er ESCAPET (ingen rå markup).
select public.t_check('A: heading «Du er invitert» i HTML',
  (select body->>'html' from net._sent where body->>'to' = 'ny+bruker@example.com') like '%Du er invitert til Huskis%');
select public.t_check('A: inviter-navn escapet i HTML',
  (select body->>'html' from net._sent where body->>'to' = 'ny+bruker@example.com')
    like '%Ann &lt;b&gt; &amp; &quot;Q&quot; &#39; O%');
select public.t_check('A: objektnavn escapet i HTML',
  (select body->>'html' from net._sent where body->>'to' = 'ny+bruker@example.com')
    like '%Fam &lt;x&gt; &amp; &quot;y&quot; &#39; z%');
select public.t_check('A: ingen rå <script i HTML',
  (select body->>'html' from net._sent where body->>'to' = 'ny+bruker@example.com') not like '%<script%');
select public.t_check('A: logo-PNG med absolutt produksjons-URL',
  (select body->>'html' from net._sent where body->>'to' = 'ny+bruker@example.com')
    like '%https://www.huskis.no/assets/email/huskis-logo.png%');

-- signup-lenken er korrekt prosentkodet (+ → %2B, @ → %40) i HTML og text.
select public.t_check('A: signup-lenke prosentkodet i HTML',
  (select body->>'html' from net._sent where body->>'to' = 'ny+bruker@example.com')
    like '%signup=ny%2Bbruker%40example.com%');
select public.t_check('A: signup-lenke prosentkodet i text',
  (select body->>'text' from net._sent where body->>'to' = 'ny+bruker@example.com')
    like '%https://www.huskis.no/?signup=ny%2Bbruker%40example.com%');

-- text/plain beholder LESBAR råtekst (ikke escapet), med reell CTA.
select public.t_check('A: text beholder lesbar råtekst (ikke HTML-escapet)',
  (select body->>'text' from net._sent where body->>'to' = 'ny+bruker@example.com')
    like '%Ann <b> & "Q" '' O har delt «Fam <x> & "y" '' z» med deg på Huskis.%');
select public.t_check('A: text har CTA-tekst',
  (select body->>'text' from net._sent where body->>'to' = 'ny+bruker@example.com') like '%Opprett konto og bli med%');

-- ---------- 5. VARIANT B: registrert bruker, varsel PÅ ----------
insert into public.share_invites (inviter_id, invitee_email, invitee_id, universe_id)
  values (:'inviter', 'reg@example.com', :'reg', :'uni');
select public.t_check('B: e-post kølagt til registrert bruker',
  (select count(*) from net._sent where body->>'to' = 'reg@example.com') = 1);
select public.t_check('B: heading «… er delt med deg» + CTA «Åpne Huskis»',
  (select body->>'html' from net._sent where body->>'to' = 'reg@example.com') like '%er delt med deg%'
  and (select body->>'html' from net._sent where body->>'to' = 'reg@example.com') like '%Åpne Huskis%');
select public.t_check('B: ingen signup-lenke for registrert bruker',
  (select body->>'html' from net._sent where body->>'to' = 'reg@example.com') not like '%?signup=%');
select public.t_check('B: text-variant er med',
  (select body ? 'text' from net._sent where body->>'to' = 'reg@example.com'));

-- ---------- 6. VARIANT B2: registrert bruker, email_notifications=false ----------
update auth.users set raw_user_meta_data = '{"email_notifications":"false"}'::jsonb where id = :'off';
insert into public.share_invites (inviter_id, invitee_email, invitee_id, universe_id)
  values (:'inviter', 'off@example.com', :'off', :'uni');
select public.t_check('B2: varsel AV → ingen e-post kølagt',
  (select count(*) from net._sent where body->>'to' = 'off@example.com') = 0);
select public.t_check('B2: men share_invites-raden opprettes likevel',
  (select count(*) from public.share_invites where invitee_email = 'off@example.com') = 1);
select public.t_check('B2: ingen logg-rad når det ikke sendes',
  (select count(*) from public.email_send_log l
     join public.share_invites s on s.id = l.invite_id
    where s.invitee_email = 'off@example.com') = 0);

-- ---------- 7. Synkron kø-feil ruller IKKE tilbake delingen + logges ----------
create or replace function net.http_post(url text, headers jsonb default '{}'::jsonb,
                                          body jsonb default '{}'::jsonb)
returns bigint language plpgsql as $$
begin raise exception 'simulert synkron kø-feil'; end $$;
insert into public.share_invites (inviter_id, invitee_email, universe_id)
  values (:'inviter', 'feil@example.com', :'uni');
select public.t_check('FEIL: share_invites-rad opprettes tross synkron kø-feil',
  (select count(*) from public.share_invites where invitee_email = 'feil@example.com') = 1);
select public.t_check('FEIL: logges som enqueue_error med feilmelding',
  (select l.enqueue_status from public.email_send_log l
     join public.share_invites s on s.id = l.invite_id
    where s.invitee_email = 'feil@example.com' order by l.id desc limit 1) = 'enqueue_error'
  and (select l.error from public.email_send_log l
     join public.share_invites s on s.id = l.invite_id
    where s.invitee_email = 'feil@example.com' order by l.id desc limit 1) like '%simulert synkron kø-feil%');

-- ---------- 8. Vault-nøkkel foretrekkes fremfor app_config-fallback ----------
create or replace function net.http_post(url text, headers jsonb default '{}'::jsonb,
                                          body jsonb default '{}'::jsonb)
returns bigint language plpgsql as $$
declare rid bigint;
begin insert into net._sent(url, headers, body) values (url, headers, body) returning id into rid; return rid; end $$;
insert into vault._secrets(name, decrypted_secret) values ('resend_api_key', 're_VAULT');
insert into public.share_invites (inviter_id, invitee_email, universe_id)
  values (:'inviter', 'vault@example.com', :'uni');
select public.t_check('VAULT: nøkkel fra vault.decrypted_secrets foretrekkes over app_config',
  (select headers->>'Authorization' from net._sent where body->>'to' = 'vault@example.com') = 'Bearer re_VAULT');

-- ---------- 9. anon/authenticated har ingen tilgang til hemmelig-lag ----------
reset role;
select set_config('request.jwt.claim.sub', '', false);
set role anon;
select public.t_fails('anon kan ikke lese app_config',      'select count(*) from public.app_config');
select public.t_fails('anon kan ikke lese email_send_log',  'select count(*) from public.email_send_log');
-- send_invite_email er en triggerfunksjon og kan ikke kalles direkte uansett
-- rettigheter (PostgreSQL blokkerer «select public.send_invite_email()» med en
-- egen feil), så en t_fails-test hadde vært grønn uansett EXECUTE-ACL. Sjekk i
-- stedet privilegiet direkte i katalogen.
select public.t_check(
  'anon har ikke EXECUTE på send_invite_email',
  not has_function_privilege('anon', 'public.send_invite_email()', 'EXECUTE'));
reset role;
select set_config('request.jwt.claim.sub', :'reg', false);
set role authenticated;
select public.t_fails('authenticated kan ikke lese app_config',     'select count(*) from public.app_config');
select public.t_fails('authenticated kan ikke lese email_send_log', 'select count(*) from public.email_send_log');
select public.t_check(
  'authenticated har ikke EXECUTE på send_invite_email',
  not has_function_privilege('authenticated', 'public.send_invite_email()', 'EXECUTE'));

reset role;

-- ---------- 10. send_invite_email gir ikke EXECUTE via PUBLIC ----------
-- Funksjoner får EXECUTE til PUBLIC som standard; REVOKE-linjen i
-- users-and-sharing.sql fjerner den. En NULL proacl betyr standard (= EXECUTE
-- til PUBLIC), så coalesce(..., true) sikrer at testen FEILER dersom
-- REVOKE-linjen fjernes.
select public.t_check(
  'send_invite_email sin ACL gir ikke EXECUTE til PUBLIC',
  not coalesce(
    (select bool_or(a.grantee = 0 and a.privilege_type = 'EXECUTE')
       from pg_proc p, aclexplode(p.proacl) a
      where p.oid = 'public.send_invite_email()'::regprocedure),
    true));

reset role;
select 'ALLE E-POSTTESTER GRØNNE' as resultat;
