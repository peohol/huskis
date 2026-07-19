-- ============================================================
-- Testsuite for den HIERARKISKE RETTIGHETSMODELLEN (oppretter/eier,
-- arvet lås + unntak, posisjon-vs-innhold, tretilstands invitasjonspolicy).
-- Kjøres mot en LOKAL PostgreSQL med tests/local-stub.sql +
-- users-and-sharing.sql lastet først (IKKE mot Supabase). Se run-tests.sh.
--
-- Fire brukere (jf. docs/rettigheter-og-deling.md):
--   A = universets EIER
--   B = oppretter av en GRUPPE i universet
--   C = oppretter av en LISTE i gruppen
--   D = vanlig MEDLEM (universdeling)
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

\set A 'a1111111-0000-0000-0000-0000000000a1'
\set B 'b2222222-0000-0000-0000-0000000000b2'
\set C 'c3333333-0000-0000-0000-0000000000c3'
\set D 'd4444444-0000-0000-0000-0000000000d4'
\set PU  '11111111-aaaa-0000-0000-000000000001'
\set PU2 '11111111-aaaa-0000-0000-000000000002'
\set PG  '22222222-aaaa-0000-0000-000000000001'
\set PGB '22222222-aaaa-0000-0000-000000000002'
\set PG2 '22222222-aaaa-0000-0000-000000000003'
\set PL  '33333333-aaaa-0000-0000-000000000001'
\set PL2 '33333333-aaaa-0000-0000-000000000002'
\set PI  '44444444-aaaa-0000-0000-000000000001'
\set PI2 '44444444-aaaa-0000-0000-000000000002'

-- ---------- 0. brukere ----------
insert into auth.users (id, email) values
  (:'A', 'perm-a@example.com'), (:'B', 'perm-b@example.com'),
  (:'C', 'perm-c@example.com'), (:'D', 'perm-d@example.com')
on conflict (id) do nothing;

-- Hjelper: logg inn som en gitt bruker (JWT-sub + rolle authenticated).
-- (psql har ingen funksjoner for \set-substitusjon i en løkke, så vi gjentar.)

-- ---------- 1. A bygger universet og deler det med B, C, D ----------
reset role; select set_config('request.jwt.claim.sub', :'A', false); set role authenticated;
insert into public.universes (id, owner_id, name, ts, org) values (:'PU', :'A', 'Felles', 1, 'a');
insert into public.universes (id, owner_id, name, ts, org) values (:'PU2', :'A', 'Privat', 1, 'a');
insert into public.groups (id, owner_id, universe_id, name, ts, org) values (:'PGB', :'A', :'PU', 'A-gruppe', 1, 'a');
insert into public.groups (id, owner_id, universe_id, name, ts, org) values (:'PG2', :'A', :'PU2', 'Privat gruppe', 1, 'a');
select public.create_share_invite('universe', :'PU', 'perm-b@example.com') ->> 'id' as ib \gset
select public.create_share_invite('universe', :'PU', 'perm-c@example.com') ->> 'id' as ic \gset
select public.create_share_invite('universe', :'PU', 'perm-d@example.com') ->> 'id' as id \gset

reset role; select set_config('request.jwt.claim.sub', :'B', false); set role authenticated;
select public.accept_share_invite(:'ib'::uuid);
insert into public.groups (id, owner_id, universe_id, name, ts, org) values (:'PG', :'B', :'PU', 'B-gruppe', 1, 'b');
select public.t_check('B (medlem) kan opprette gruppe i delt univers',
  (select count(*) from public.groups where id = :'PG') = 1);

reset role; select set_config('request.jwt.claim.sub', :'C', false); set role authenticated;
select public.accept_share_invite(:'ic'::uuid);
insert into public.cards (id, owner_id, group_id, title, ts, org) values (:'PL', :'C', :'PG', 'C-liste', 1, 'c');
insert into public.cards (id, owner_id, group_id, title, ts, org) values (:'PL2', :'C', :'PG', 'C-liste 2', 1, 'c');
insert into public.items (id, owner_id, card_id, text, ts, org) values (:'PI', :'C', :'PL', 'Punkt 1', 1, 'c');
insert into public.items (id, owner_id, card_id, text, ts, org) values (:'PI2', :'C', :'PL', 'Punkt 2', 1, 'c');
select public.t_check('C (medlem) kan opprette liste + punkter i B sin gruppe',
  (select count(*) from public.cards where group_id = :'PG') = 2
  and (select count(*) from public.items where card_id = :'PL') = 2);

reset role; select set_config('request.jwt.claim.sub', :'D', false); set role authenticated;
select public.accept_share_invite(:'id'::uuid);

-- ============================================================
-- 2. OPPRETTERHIERARKI (can_admin_resource)
-- ============================================================
-- A = eier: full myndighet over alt.
reset role; select set_config('request.jwt.claim.sub', :'A', false); set role authenticated;
select public.t_check('A kan administrere gruppen (annen oppretter B)',  public.can_admin_resource('group', :'PG', :'A'));
select public.t_check('A kan administrere listen (annen oppretter C)',   public.can_admin_resource('card',  :'PL', :'A'));
select public.set_locked('group', :'PG', true);  -- eier kan låse annens gruppe
select public.t_check('A låste B sin gruppe', (select locked from public.groups where id = :'PG'));
select public.set_locked('group', :'PG', false);

-- B = gruppeoppretter: myndighet over gruppen + ALT under (også C sin liste),
-- men IKKE over universet.
reset role; select set_config('request.jwt.claim.sub', :'B', false); set role authenticated;
select public.t_check('B kan administrere sin gruppe',            public.can_admin_resource('group', :'PG', :'B'));
select public.t_check('B kan administrere C sin liste (subobjekt)', public.can_admin_resource('card',  :'PL', :'B'));
select public.t_check('B kan administrere punkt i C sin liste',    public.can_admin_resource('item',  :'PI', :'B'));
select public.t_check('B kan IKKE administrere universet', not public.can_admin_resource('universe', :'PU', :'B'));
select public.set_locked('card', :'PL', true);   -- B kan låse subobjekt (C sin liste)
select public.t_check('B kan låse C sin liste', (select locked from public.cards where id = :'PL'));
select public.set_locked('card', :'PL', false);
select public.t_fails('B kan ikke låse universet',
  format('select public.set_locked(''universe'', %L, true)', :'PU'));

-- C = listeoppretter: myndighet over listen + punktene, ikke over gruppen.
reset role; select set_config('request.jwt.claim.sub', :'C', false); set role authenticated;
select public.t_check('C kan administrere sin liste',      public.can_admin_resource('card', :'PL', :'C'));
select public.t_check('C kan administrere punktene',       public.can_admin_resource('item', :'PI', :'C'));
select public.t_check('C kan IKKE administrere gruppen', not public.can_admin_resource('group', :'PG', :'C'));
select public.t_fails('C kan ikke låse gruppen',
  format('select public.set_locked(''group'', %L, true)', :'PG'));

-- D = vanlig medlem: ingen admin-myndighet.
reset role; select set_config('request.jwt.claim.sub', :'D', false); set role authenticated;
select public.t_check('D har ingen admin-myndighet på listen', not public.can_admin_resource('card', :'PL', :'D'));
select public.t_fails('D kan ikke låse listen',
  format('select public.set_locked(''card'', %L, true)', :'PL'));

-- ============================================================
-- 3. LÅSING (arv + unntak + opprettere)
-- ============================================================
-- A låser universet.
reset role; select set_config('request.jwt.claim.sub', :'A', false); set role authenticated;
select public.set_locked('universe', :'PU', true);

-- D: kun lesing.
reset role; select set_config('request.jwt.claim.sub', :'D', false); set role authenticated;
update public.items set text = 'HACK', ts = 100, org = 'd' where id = :'PI';
select public.t_check('universlås: D sin redigering biter ikke',
  (select text from public.items where id = :'PI') = 'Punkt 1');
select public.t_fails('universlås: D kan ikke legge til punkt',
  format('insert into public.items (owner_id, card_id, text, ts, org) values (%L, %L, ''nei'', 2, ''d'')', :'D', :'PL'));
select public.t_check('universlås: D kan fortsatt LESE', (select count(*) from public.items where id = :'PI') = 1);

-- B og C kan fortsatt arbeide i sine undertrær (opprettere).
reset role; select set_config('request.jwt.claim.sub', :'B', false); set role authenticated;
update public.groups set name = 'B-gruppe v2', ts = 200, org = 'b' where id = :'PG';
select public.t_check('universlås: B (gruppeoppretter) kan redigere sin gruppe',
  (select name from public.groups where id = :'PG') = 'B-gruppe v2');
reset role; select set_config('request.jwt.claim.sub', :'C', false); set role authenticated;
update public.items set text = 'C redigerer', ts = 300, org = 'c' where id = :'PI';
select public.t_check('universlås: C (listeoppretter) kan redigere sitt punkt',
  (select text from public.items where id = :'PI') = 'C redigerer');

-- B kan IKKE åpne gruppen for D i strid med A sin universlås.
reset role; select set_config('request.jwt.claim.sub', :'B', false); set role authenticated;
select public.t_fails('B kan ikke gjøre unntak mot A sin universlås',
  format('select public.set_unlocked(''group'', %L, true)', :'PG'));

-- A kan gjøre gruppen til et unntak.
reset role; select set_config('request.jwt.claim.sub', :'A', false); set role authenticated;
select public.set_unlocked('group', :'PG', true);
reset role; select set_config('request.jwt.claim.sub', :'D', false); set role authenticated;
update public.items set text = 'D via unntak', ts = 400, org = 'd' where id = :'PI';
select public.t_check('A sitt unntak på gruppen: D kan redigere under universlåsen',
  (select text from public.items where id = :'PI') = 'D via unntak');

-- Lavere eksplisitt lås vinner over høyere unntak: B låser listen (egen lås) inni
-- gruppe-unntaket. PL er nå DIREKTE låst (ikke arvet), så D fryses igjen.
reset role; select set_config('request.jwt.claim.sub', :'B', false); set role authenticated;
select public.set_locked('card', :'PL', true);
reset role; select set_config('request.jwt.claim.sub', :'D', false); set role authenticated;
update public.items set text = 'HACK2', ts = 500, org = 'd' where id = :'PI';
select public.t_check('lavere lås vinner over høyere unntak: D biter ikke',
  (select text from public.items where id = :'PI') = 'D via unntak');
-- Å oppheve PL sin EGNE lås (set_locked false, ikke et unntak) åpner den igjen.
reset role; select set_config('request.jwt.claim.sub', :'B', false); set role authenticated;
select public.set_locked('card', :'PL', false);

-- Rydd opp universlås + gruppe-unntak.
reset role; select set_config('request.jwt.claim.sub', :'A', false); set role authenticated;
select public.set_unlocked('group', :'PG', false);
select public.set_locked('universe', :'PU', false);

-- --- Gruppe-lås + liste-unntak (arvet lås fra gruppen) ---
reset role; select set_config('request.jwt.claim.sub', :'B', false); set role authenticated;
select public.set_locked('group', :'PG', true);
reset role; select set_config('request.jwt.claim.sub', :'D', false); set role authenticated;
update public.items set text = 'HACK3', ts = 550, org = 'd' where id = :'PI';
select public.t_check('B låser gruppen: D kan ikke redigere punkt i lista',
  (select text from public.items where id = :'PI') = 'D via unntak');
-- B (oppretter av den låsende gruppen) ELLER A kan gjøre lista til et unntak.
reset role; select set_config('request.jwt.claim.sub', :'B', false); set role authenticated;
select public.set_unlocked('card', :'PL', true);
reset role; select set_config('request.jwt.claim.sub', :'D', false); set role authenticated;
update public.items set text = 'D via liste-unntak', ts = 600, org = 'd' where id = :'PI';
select public.t_check('B sitt liste-unntak (mot egen gruppelås): D kan redigere',
  (select text from public.items where id = :'PI') = 'D via liste-unntak');
reset role; select set_config('request.jwt.claim.sub', :'B', false); set role authenticated;
select public.set_unlocked('card', :'PL', false);   -- fjern unntaket

-- C kan redigere egen liste under B sin gruppelås (oppretter), men kan IKKE åpne
-- den for andre (unntaket styres av B/A, ikke av liste-oppretteren C).
reset role; select set_config('request.jwt.claim.sub', :'C', false); set role authenticated;
update public.cards set title = 'C-liste under lås', ts = 700, org = 'c' where id = :'PL';
select public.t_check('C kan redigere egen liste under B sin gruppelås (oppretter)',
  (select title from public.cards where id = :'PL') = 'C-liste under lås');
select public.t_fails('C kan ikke gjøre unntak mot B sin gruppelås (åpne for andre)',
  format('select public.set_unlocked(''card'', %L, true)', :'PL'));

-- Rydd opp all lås/unntak.
reset role; select set_config('request.jwt.claim.sub', :'B', false); set role authenticated;
select public.set_locked('group', :'PG', false);

-- ============================================================
-- 4. REKKEFØLGE vs INNHOLD (posisjon skilt fra innholdslås)
-- ============================================================
-- A låser listen PL (innholdslås), men gruppen er åpen.
reset role; select set_config('request.jwt.claim.sub', :'A', false); set role authenticated;
select public.set_locked('card', :'PL', true);

-- D kan flytte den låste listen blant søsken (gruppen er åpen), men ikke endre navn.
reset role; select set_config('request.jwt.claim.sub', :'D', false); set role authenticated;
update public.cards set title = 'NYTT NAVN', pos = 99, pos_ts = 1000, pos_org = 'd', ts = 1000, org = 'd' where id = :'PL';
select public.t_check('låst liste + åpen gruppe: D kan endre POSISJON',
  (select pos from public.cards where id = :'PL') = 99);
select public.t_check('låst liste: D kan IKKE endre navnet samtidig',
  (select title from public.cards where id = :'PL') = 'C-liste under lås');

-- Gruppen låses → D kan ikke lenger endre listens rekkefølge.
reset role; select set_config('request.jwt.claim.sub', :'A', false); set role authenticated;
select public.set_locked('group', :'PG', true);
reset role; select set_config('request.jwt.claim.sub', :'D', false); set role authenticated;
update public.cards set pos = 5, pos_ts = 2000, pos_org = 'd' where id = :'PL';
select public.t_check('låst gruppe: D kan IKKE endre listens rekkefølge',
  (select pos from public.cards where id = :'PL') = 99);
reset role; select set_config('request.jwt.claim.sub', :'A', false); set role authenticated;
select public.set_locked('group', :'PG', false);
select public.set_locked('card', :'PL', false);

-- Tilsvarende for PUNKTER i en liste: lås listen, D kan reordne punkt men ikke tekst.
select public.set_locked('universe', :'PU', false);
reset role; select set_config('request.jwt.claim.sub', :'A', false); set role authenticated;
select public.set_locked('card', :'PL', true);
reset role; select set_config('request.jwt.claim.sub', :'D', false); set role authenticated;
-- Punkt-reorder styres av listens innhold (superobjektet) → listen er låst → NEKT.
update public.items set pos = 42, pos_ts = 3000, pos_org = 'd' where id = :'PI';
select public.t_check('låst liste: D kan ikke reordne punktene (superobjektet er låst)',
  (select pos from public.items where id = :'PI') = 0);
reset role; select set_config('request.jwt.claim.sub', :'A', false); set role authenticated;
select public.set_locked('card', :'PL', false);
-- Nå åpen liste: D KAN reordne punkt.
reset role; select set_config('request.jwt.claim.sub', :'D', false); set role authenticated;
update public.items set pos = 7, pos_ts = 3100, pos_org = 'd' where id = :'PI';
select public.t_check('åpen liste: D kan reordne punktene',
  (select pos from public.items where id = :'PI') = 7);

-- Grupper i universet: D reordner når universet er åpent.
update public.groups set pos = 3, pos_ts = 3200, pos_org = 'd' where id = :'PG';
select public.t_check('åpent univers: D kan reordne grupper',
  (select pos from public.groups where id = :'PG') = 3);

-- Flytting til ny forelder krever rettigheter i MÅL-forelderen.
select public.t_fails('D kan ikke flytte liste til gruppe i univers uten tilgang',
  format('update public.cards set group_id = %L, pos_ts = 4000, pos_org = ''d'' where id = %L', :'PG2', :'PL'));

-- ============================================================
-- 5. INVITASJONER (tretilstands dynamisk arv)
-- ============================================================
-- Standard effektiv policy = tillat.
reset role; select set_config('request.jwt.claim.sub', :'A', false); set role authenticated;
select public.t_check('standard effektiv invitasjonspolicy = tillat (univers)', public.effective_invite_policy('universe', :'PU'));
select public.t_check('standard effektiv invitasjonspolicy = tillat (gruppe)',  public.effective_invite_policy('group', :'PG'));
select public.t_check('standard effektiv invitasjonspolicy = tillat (liste)',   public.effective_invite_policy('card', :'PL'));

-- D kan invitere til listen når policy tillater.
reset role; select set_config('request.jwt.claim.sub', :'D', false); set role authenticated;
select public.t_check('D kan invitere når policy tillater',
  public.create_share_invite('card', :'PL', 'ext-d@example.com') ->> 'id' is not null);
-- D kan trekke tilbake SIN EGEN ventende invitasjon.
select public.revoke_share_invite((select id from public.share_invites
  where card_id = :'PL' and lower(invitee_email) = 'ext-d@example.com' and status = 'pending'));
select public.t_check('D trakk tilbake sin egen invitasjon',
  (select status from public.share_invites where card_id = :'PL' and lower(invitee_email) = 'ext-d@example.com') = 'revoked');

-- En sperre på gruppen: D kan ikke lenger invitere til listen (arvet 'deny').
reset role; select set_config('request.jwt.claim.sub', :'B', false); set role authenticated;
select public.set_invite_policy('group', :'PG', 'deny');
reset role; select set_config('request.jwt.claim.sub', :'D', false); set role authenticated;
select public.t_check('gruppe-sperre arves til listen (effektiv = nekt)', not public.effective_invite_policy('card', :'PL'));
select public.t_fails('D kan ikke invitere når nærmeste policy er nekt',
  format('select public.create_share_invite(''card'', %L, ''ext2@example.com'')', :'PL'));

-- A, B, C kan invitere innenfor sitt myndighetsområde uavhengig av policy.
reset role; select set_config('request.jwt.claim.sub', :'A', false); set role authenticated;
select public.t_check('A kan invitere til listen tross sperre',
  public.create_share_invite('card', :'PL', 'ext-a@example.com') ->> 'id' is not null);
reset role; select set_config('request.jwt.claim.sub', :'B', false); set role authenticated;
select public.t_check('B kan invitere til listen tross sperre (superobjekt-oppretter)',
  public.create_share_invite('card', :'PL', 'ext-b@example.com') ->> 'id' is not null);
reset role; select set_config('request.jwt.claim.sub', :'C', false); set role authenticated;
select public.t_check('C kan invitere til egen liste tross B sin sperre',
  public.create_share_invite('card', :'PL', 'ext-c@example.com') ->> 'id' is not null);
-- ... men C kan IKKE slå på videreinvitasjon for andre mot B sin sperre.
select public.t_fails('C kan ikke lage allow-unntak mot B sin gruppe-sperre',
  format('select public.set_invite_policy(''card'', %L, ''allow'')', :'PL'));

-- Autorisert unntak: B (gruppeoppretteren som satte sperren) åpner listen igjen.
reset role; select set_config('request.jwt.claim.sub', :'B', false); set role authenticated;
select public.set_invite_policy('card', :'PL', 'allow');
reset role; select set_config('request.jwt.claim.sub', :'D', false); set role authenticated;
select public.t_check('B sitt allow-unntak på listen: D kan invitere igjen',
  public.create_share_invite('card', :'PL', 'ext-d2@example.com') ->> 'id' is not null);
select public.revoke_share_invite((select id from public.share_invites
  where card_id = :'PL' and lower(invitee_email) = 'ext-d2@example.com' and status = 'pending'));

-- Dynamisk arv: A setter sperre på HELE universet → eksisterende grupper/lister
-- uten eget unntak sperres straks.
reset role; select set_config('request.jwt.claim.sub', :'B', false); set role authenticated;
select public.set_invite_policy('group', :'PG', 'inherit');   -- fjern gruppe-eksplisitten
select public.set_invite_policy('card', :'PL', 'inherit');    -- fjern liste-eksplisitten
reset role; select set_config('request.jwt.claim.sub', :'A', false); set role authenticated;
select public.set_invite_policy('universe', :'PU', 'deny');
select public.t_check('universsperre arves dynamisk til gruppen', not public.effective_invite_policy('group', :'PG'));
select public.t_check('universsperre arves dynamisk til listen',  not public.effective_invite_policy('card', :'PL'));
reset role; select set_config('request.jwt.claim.sub', :'D', false); set role authenticated;
select public.t_fails('D kan ikke invitere under universsperre (arvet)',
  format('select public.create_share_invite(''card'', %L, ''ext3@example.com'')', :'PL'));

-- Bare universets eier kan lage unntak mot en universsperre (B kan ikke).
reset role; select set_config('request.jwt.claim.sub', :'B', false); set role authenticated;
select public.t_fails('B kan ikke lage allow-unntak på gruppen mot universsperren',
  format('select public.set_invite_policy(''group'', %L, ''allow'')', :'PG'));
reset role; select set_config('request.jwt.claim.sub', :'A', false); set role authenticated;
select public.set_invite_policy('group', :'PG', 'allow');   -- eier lager unntak
reset role; select set_config('request.jwt.claim.sub', :'D', false); set role authenticated;
select public.t_check('A sitt allow-unntak på gruppen åpner videreinvitasjon',
  public.effective_invite_policy('group', :'PG'));
select public.t_check('lista arver A sitt gruppe-unntak (allow)', public.effective_invite_policy('card', :'PL'));

-- Lavere eksplisitt nekt vinner over høyere tillatelse.
reset role; select set_config('request.jwt.claim.sub', :'C', false); set role authenticated;
-- Ingen arvet sperre lenger (gruppen er allow), så C (listeoppretter) kan sette liste-policy.
select public.set_invite_policy('card', :'PL', 'deny');
reset role; select set_config('request.jwt.claim.sub', :'D', false); set role authenticated;
select public.t_check('lavere nekt på listen vinner over gruppe-tillatelse', not public.effective_invite_policy('card', :'PL'));
-- Rydd: tilbake til arv/tillat.
reset role; select set_config('request.jwt.claim.sub', :'A', false); set role authenticated;
select public.set_invite_policy('universe', :'PU', 'inherit');
select public.set_invite_policy('group', :'PG', 'inherit');
reset role; select set_config('request.jwt.claim.sub', :'C', false); set role authenticated;
select public.set_invite_policy('card', :'PL', 'inherit');

-- D kan ikke trekke tilbake ANDRES invitasjon; en admin kan trekke tilbake alle.
reset role; select set_config('request.jwt.claim.sub', :'A', false); set role authenticated;
select public.create_share_invite('card', :'PL', 'ext-admin@example.com') ->> 'id' as inv_a \gset
reset role; select set_config('request.jwt.claim.sub', :'D', false); set role authenticated;
select public.t_fails('D kan ikke trekke tilbake A sin invitasjon',
  format('select public.revoke_share_invite(%L)', :'inv_a'));
reset role; select set_config('request.jwt.claim.sub', :'B', false); set role authenticated;
select public.revoke_share_invite(:'inv_a'::uuid);   -- B (admin på listen) kan
reset role; select set_config('request.jwt.claim.sub', :'A', false); set role authenticated;
select public.t_check('B (admin) kan trekke tilbake A sin invitasjon',
  (select status from public.share_invites where id = :'inv_a') = 'revoked');

-- Redundant invitasjon (allerede effektiv tilgang, arvet) avvises.
reset role; select set_config('request.jwt.claim.sub', :'A', false); set role authenticated;
select public.t_fails('kan ikke invitere D redundant til listen (har arvet tilgang)',
  format('select public.create_share_invite(''card'', %L, ''perm-d@example.com'')', :'PL'));

-- D kan ikke kaste ut medlemmer; admin kan kaste ut DIREKTE medlemmer.
reset role; select set_config('request.jwt.claim.sub', :'D', false); set role authenticated;
select public.t_fails('D kan ikke kaste ut andre',
  format('select public.revoke_share(''universe'', %L, %L)', :'PU', :'C'));

-- Arvet medlem kan ikke fjernes på feil nivå: D sin tilgang til listen er ARVET
-- (universdeling) → revoke_share på listen fjerner ingen direkte medlemskap.
reset role; select set_config('request.jwt.claim.sub', :'B', false); set role authenticated;
select public.revoke_share('card', :'PL', :'D');   -- admin, men D har ingen direkte membership her
select public.t_check('arvet medlem beholder tilgang (fjernes ikke på feil nivå)',
  public.can_read_card(:'PL', :'D'));

-- Admin kan kaste ut et DIREKTE medlem (D forlater universet).
reset role; select set_config('request.jwt.claim.sub', :'A', false); set role authenticated;
select public.revoke_share('universe', :'PU', :'D');
reset role; select set_config('request.jwt.claim.sub', :'D', false); set role authenticated;
select public.t_check('etter utkastelse fra universet: D ser ikke listen', not public.can_read_card(:'PL', :'D'));
-- Sett D inn igjen for regresjonstester under.
reset role; select set_config('request.jwt.claim.sub', :'A', false); set role authenticated;
select public.create_share_invite('universe', :'PU', 'perm-d@example.com') ->> 'id' as id2 \gset
reset role; select set_config('request.jwt.claim.sub', :'D', false); set role authenticated;
select public.accept_share_invite(:'id2'::uuid);

-- ============================================================
-- 6. SIKKERHET / REGRESJON (rå PostgREST kan ikke omgå reglene)
-- ============================================================
reset role; select set_config('request.jwt.claim.sub', :'D', false); set role authenticated;
select public.t_fails('D kan ikke sette owner_id direkte',
  format('update public.cards set owner_id = %L where id = %L', :'D', :'PL'));
select public.t_fails('D kan ikke sette locked direkte (rå update)',
  format('update public.cards set locked = true where id = %L', :'PL'));
select public.t_fails('D kan ikke sette unlocked direkte (rå update)',
  format('update public.cards set unlocked = true where id = %L', :'PL'));
select public.t_fails('D kan ikke endre invite_policy direkte (rå update)',
  format('update public.groups set invite_policy = ''deny'' where id = %L', :'PG'));

-- Låst innhold kan ikke endres via rå update selv om andre felt sendes med.
reset role; select set_config('request.jwt.claim.sub', :'A', false); set role authenticated;
select public.set_locked('card', :'PL', true);
reset role; select set_config('request.jwt.claim.sub', :'D', false); set role authenticated;
update public.cards set title = 'OMGÅ', collapsed = true, ts = 9000, org = 'd' where id = :'PL';
select public.t_check('låst innhold biter ikke selv om andre felt sendes',
  (select title from public.cards where id = :'PL') = 'C-liste under lås');
reset role; select set_config('request.jwt.claim.sub', :'A', false); set role authenticated;
select public.set_locked('card', :'PL', false);

-- Anon har ingen tilgang til RPC-ene.
reset role; select set_config('request.jwt.claim.sub', '', false); set role anon;
select public.t_fails('anon kan ikke kalle can_admin via get_members', format('select public.get_members(''card'', %L)', :'PL'));

reset role;
select 'ALLE RETTIGHETSTESTER GRØNNE' as resultat;
