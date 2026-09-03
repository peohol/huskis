-- ============================================================
-- Testsuite for IDÉENE (docs/ideer.md): tabellen `public.ideas`.
-- Kjøres mot en LOKAL PostgreSQL med tests/local-stub.sql +
-- users-and-sharing.sql lastet først (IKKE mot Supabase). Se run-tests.sh.
--
-- Idéene er den ene innholdstabellen som IKKE henger i hierarkiet: de hører
-- til kontoen, deles aldri, og `owner_id = auth.uid()` ER hele
-- autorisasjonen. Nettopp derfor må den testes for seg — alle de andre
-- objekttabellene beskyttes av capability-funksjonene, og en feil her ville
-- ikke blitt fanget av en eneste av de eksisterende sjekkene.
--
-- To brukere:
--   A = eier idéene
--   B = en helt annen konto, som ikke skal se eller røre noe av dem
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

\set A  'aaaa1111-0000-0000-0000-00000000aa11'
\set B  'bbbb2222-0000-0000-0000-00000000bb22'
-- K  = idékategori (A), I1 = idé i kategorien, I2 = ukategorisert idé,
-- I3 = idé som slettes permanent, BI = B sin egen idé.
-- (`\set` tar HELE resten av linjen, kommentaren inkludert — derfor står de her.)
\set K  '5a000000-cccc-0000-0000-000000000001'
\set I1 '5a000000-cccc-0000-0000-000000000002'
\set I2 '5a000000-cccc-0000-0000-000000000003'
\set I3 '5a000000-cccc-0000-0000-000000000004'
\set BI '5a000000-cccc-0000-0000-000000000005'

insert into auth.users (id, email) values
  (:'A', 'ide-a@example.com'), (:'B', 'ide-b@example.com')
on conflict (id) do nothing;

-- ---------- 1. A oppretter idéer og en kategori ----------
reset role; select set_config('request.jwt.claim.sub', :'A', false); set role authenticated;
insert into public.ideas (id, owner_id, text, is_cat, ts, org, pos, pos_ts, pos_org)
  values (:'K', :'A', 'Ferieplaner', true, 1, 'a', 1, 1, 'a');
insert into public.ideas (id, owner_id, cat_id, text, ts, org, pos, pos_ts, pos_org)
  values (:'I1', :'A', :'K', 'Sykle langs kysten', 1, 'a', 2, 1, 'a');
insert into public.ideas (id, owner_id, text, ts, org, pos, pos_ts, pos_org)
  values (:'I2', :'A', 'Kjøpe blomster', 1, 'a', 3, 1, 'a');
select public.t_check('A ser sine tre idérader',
  (select count(*) from public.ideas) = 3);

-- ---------- 2. Ingen andre ser dem, og ingen kan skrive på dem ----------
reset role; select set_config('request.jwt.claim.sub', :'B', false); set role authenticated;
select public.t_check('B ser INGEN av A sine idéer',
  (select count(*) from public.ideas) = 0);
-- RLS gjør en fremmed rad usynlig, så en UPDATE/DELETE treffer null rader i
-- stedet for å kaste. Beviset er derfor at raden står UENDRET etterpå.
update public.ideas set text = 'kapret', ts = 99, org = 'b' where id = :'I2';
delete from public.ideas where id = :'I2';
select public.t_fails('B kan ikke sette inn en idé i A sitt navn',
  format('insert into public.ideas (id, owner_id, text, ts, org) values (%L, %L, ''snik'', 9, ''b'')',
         '5a000000-cccc-0000-0000-0000000000ff', :'A'));
-- B har sine EGNE idéer, uavhengig av A sine.
insert into public.ideas (id, owner_id, text, ts, org, pos, pos_ts, pos_org)
  values (:'BI', :'B', 'B sin idé', 1, 'b', 1, 1, 'b');
select public.t_check('B ser kun sin egen idé',
  (select count(*) from public.ideas) = 1
  and (select text from public.ideas where id = :'BI') = 'B sin idé');

reset role; select set_config('request.jwt.claim.sub', :'A', false); set role authenticated;
select public.t_check('A sin idé er urørt etter B sine forsøk',
  (select text from public.ideas where id = :'I2') = 'Kjøpe blomster'
  and (select count(*) from public.ideas where id = :'I2') = 1);
select public.t_check('A ser ikke B sin idé',
  (select count(*) from public.ideas where id = :'BI') = 0);

-- ---------- 3. get_my_doc() leverer KUN mine idéer ----------
select public.t_check('get_my_doc() gir A sine tre idéer',
  jsonb_array_length(public.get_my_doc() -> 'ideas') = 3);
select public.t_check('get_my_doc() bærer kategori-markøren og medlemskapet',
  (select count(*) from jsonb_array_elements(public.get_my_doc() -> 'ideas') e
    where (e ->> 'isCat')::boolean) = 1
  and (select count(*) from jsonb_array_elements(public.get_my_doc() -> 'ideas') e
    where e ->> 'cat' = :'K') = 1);
reset role; select set_config('request.jwt.claim.sub', :'B', false); set role authenticated;
select public.t_check('get_my_doc() for B gir bare B sin ene idé',
  jsonb_array_length(public.get_my_doc() -> 'ideas') = 1);

-- ---------- 4. Felt-nivå-LWW: en eldre skriving taper ----------
reset role; select set_config('request.jwt.claim.sub', :'A', false); set role authenticated;
update public.ideas set text = 'Kjøpe blomster og kake', ts = 50, org = 'a' where id = :'I2';
select public.t_check('en NYERE innholdsskriving lander',
  (select text from public.ideas where id = :'I2') = 'Kjøpe blomster og kake');
update public.ideas set text = 'gammel enhet', ts = 20, org = 'a' where id = :'I2';
select public.t_check('en ELDRE innholdsskriving rulles tilbake av vakten',
  (select text from public.ideas where id = :'I2') = 'Kjøpe blomster og kake'
  and (select ts from public.ideas where id = :'I2') = 50);
-- Posisjonsregisteret er sitt eget: `cat_id` rir på det, som `card_id` gjør
-- for et listepunkt.
update public.ideas set cat_id = :'K', pos = 9, pos_ts = 60, pos_org = 'a' where id = :'I2';
select public.t_check('en NYERE posisjonsskriving flytter idéen inn i kategorien',
  (select cat_id from public.ideas where id = :'I2') = :'K'::uuid);
update public.ideas set cat_id = null, pos = 1, pos_ts = 30, pos_org = 'a' where id = :'I2';
select public.t_check('en ELDRE posisjonsskriving rulles tilbake',
  (select cat_id from public.ideas where id = :'I2') = :'K'::uuid
  and (select pos from public.ideas where id = :'I2') = 9);
-- Registrene er UAVHENGIGE: en fersk innholdsskriving skal ikke dra med seg
-- en foreldet posisjon.
update public.ideas set text = 'Blomster', ts = 70, org = 'a', cat_id = null, pos = 0, pos_ts = 1, pos_org = 'a'
  where id = :'I2';
select public.t_check('innholdet lander mens den foreldede posisjonen forkastes',
  (select text from public.ideas where id = :'I2') = 'Blomster'
  and (select cat_id from public.ideas where id = :'I2') = :'K'::uuid);

-- ---------- 5. Oppretteren er uforanderlig ----------
select public.t_fails('owner_id kan ikke endres på en idé',
  format('update public.ideas set owner_id = %L where id = %L', :'B', :'I2'));

-- ---------- 6. En slettet kategori tar ALDRI medlemmene med seg ----------
-- `cat_id` er `on delete set null`, ikke cascade: en kategori som forsvinner
-- skal etterlate idéene, ikke slette dem. Skrivevakten forsvarer likevel
-- posisjonsregisteret mot en oppdatering uten nyere stempel — og
-- fremmednøkkelens egen `set null` har ingen — så PEKEREN kan bli hengende
-- igjen mot en rad som er borte. Nøyaktig samme oppførsel som `items.cat_id`,
-- og klienten er bygget for den: en `cat` som ikke treffer en kategori rendres
-- som ukategorisert, og `pruneDanglingCats` nuller den før den skrives
-- (docs/data-model.md, docs/ideer.md). Det som MÅ holde, er at radene lever.
delete from public.ideas where id = :'K';
select public.t_check('kategorien er borte',
  (select count(*) from public.ideas where id = :'K') = 0);
select public.t_check('medlemmene står igjen (ingen kaskade fra kategorien)',
  (select count(*) from public.ideas where id in (:'I1', :'I2')) = 2);
-- Og en skriving MED nyere stempel rydder pekeren, som klienten gjør.
update public.ideas set cat_id = null, pos_ts = 100, pos_org = 'a' where id = :'I1';
select public.t_check('en stemplet skriving nuller den hengende kategori-pekeren',
  (select cat_id from public.ideas where id = :'I1') is null);

-- ---------- 7. Gravstein + insert-vakt ----------
select public.t_check('slettingen skrev en gravstein av typen «idea»',
  (select count(*) from public.tombstones where resource_type = 'idea' and resource_id = :'K') = 1);
insert into public.ideas (id, owner_id, text, ts, org) values (:'I3', :'A', 'Kortlevd', 1, 'a');
delete from public.ideas where id = :'I3';
select public.t_fails_with('en utdatert klient kan ikke gjenopplive en gravlagt idé', 'PT409',
  format('insert into public.ideas (id, owner_id, text, ts, org) values (%L, %L, ''Kortlevd'', 1, ''a'')',
         :'I3', :'A'));
select public.t_fails_with('gjentatt forsøk avvises likt (idempotent vakt)', 'PT409',
  format('insert into public.ideas (id, owner_id, text, ts, org) values (%L, %L, ''Kortlevd'', 1, ''a'')',
         :'I3', :'A'));

-- ---------- 8. Kontosletting tar idéene med seg ----------
select public.t_check('A har idéer før kontoslettingen',
  (select count(*) from public.ideas) = 2);
select public.delete_account();
reset role; select set_config('request.jwt.claim.sub', :'B', false); set role authenticated;
select public.t_check('B sin idé overlevde A sin kontosletting',
  (select count(*) from public.ideas where id = :'BI') = 1);
reset role;
select public.t_check('A sine idéer er borte fra tabellen',
  (select count(*) from public.ideas where owner_id = :'A'::uuid) = 0);
select public.t_check('… og de er gravlagt, så ingen gammel klient kan legge dem inn igjen',
  (select count(*) from public.tombstones where resource_type = 'idea' and resource_id in (:'I1', :'I2')) = 2);

-- ---------- 9. Rettighetene ----------
select public.t_check('authenticated har full CRUD på ideas (RLS gjør resten)',
  has_table_privilege('authenticated', 'public.ideas', 'SELECT, INSERT, UPDATE, DELETE'));
select public.t_check('anon har ingen tilgang til ideas',
  not has_table_privilege('anon', 'public.ideas', 'SELECT'));
reset role; select set_config('request.jwt.claim.sub', '', false); set role anon;
select public.t_fails('anon kan ikke lese idéer', 'select count(*) from public.ideas');

reset role;
select 'ALLE IDÉ-TESTER GRØNNE' as resultat;
