-- ============================================================
-- Databaseoppsett for sanntids-synk i Huskekurv-appen.
-- Idempotent: trygg å kjøre flere ganger.
--
-- Hele state-objektet lagres som ett jsonb-felt i én rad,
-- identifisert av sha256(synk-kode). Tabellen er låst med RLS
-- (ingen policy) og all tilgang går via to SECURITY DEFINER-
-- funksjoner, slik at man må kjenne koden for å nå dataene.
--
-- NYTT: raden har en «version»-teller. save_list bruker optimistisk
-- samtidighetskontroll (compare-and-swap): den skriver kun hvis
-- klientens forventede versjon stemmer. Ellers returneres gjeldende
-- {data, version} slik at klienten kan flette og prøve igjen. Da kan
-- aldri én enhet overskrive en annen enhets samtidige endring.
--
-- Live-oppdatering mellom enheter skjer via Supabase Realtime
-- (broadcast) og krever ingen ekstra database-oppsett — kanalen
-- utledes fra synk-koden på klienten.
--
-- Merk: i Supabase ligger pgcrypto (digest()) i skjemaet
-- "extensions", ikke "public". Funksjonene under har derfor
-- extensions i search_path i tillegg til public.
-- ============================================================

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.lists (
  code_hash  text primary key,
  data       jsonb not null,
  version    bigint not null default 0,
  updated_at timestamptz not null default now()
);

-- Oppgrader eldre tabeller: legg til versjonskolonnen om den mangler.
alter table public.lists add column if not exists version bigint not null default 0;

alter table public.lists enable row level security;  -- ingen policy → ingen direkte tilgang

-- get_list: returnerer både data og versjon slik at klienten kan gjøre CAS.
-- Returnerer null hvis raden ikke finnes ennå.
create or replace function public.get_list(p_code text)
returns jsonb language sql security definer set search_path = public, extensions as $$
  select jsonb_build_object('data', data, 'version', version)
  from public.lists
  where code_hash = encode(digest(p_code, 'sha256'), 'hex');
$$;

-- Den gamle 2-arg-varianten erstattes av CAS-varianten under.
drop function if exists public.save_list(text, jsonb);

-- save_list: optimistisk samtidighetskontroll (compare-and-swap).
--   • Ny rad → settes inn med versjon 1.
--   • Eksisterende rad og p_prev_version stemmer → oppdateres, versjon +1.
--   • Versjon stemmer ikke → INGEN skriving; returnerer gjeldende
--     {ok:false, version, data} slik at klienten kan flette og prøve igjen.
-- Alt skjer atomisk i én setning, så to samtidige skrivinger kan ikke
-- begge «vinne» og overskrive hverandre.
create or replace function public.save_list(p_code text, p_data jsonb, p_prev_version bigint)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  h text := encode(digest(p_code, 'sha256'), 'hex');
  new_version bigint;
begin
  insert into public.lists as l (code_hash, data, version, updated_at)
  values (h, p_data, 1, now())
  on conflict (code_hash) do update
    set data = p_data, version = l.version + 1, updated_at = now()
    where l.version = coalesce(p_prev_version, 0)
  returning l.version into new_version;

  if new_version is not null then
    return jsonb_build_object('ok', true, 'version', new_version);
  end if;

  -- Versjonskonflikt: returner gjeldende tilstand så klienten kan flette.
  return jsonb_build_object(
    'ok', false,
    'version', (select version from public.lists where code_hash = h),
    'data',    (select data    from public.lists where code_hash = h)
  );
end;
$$;

grant execute on function public.get_list(text)                 to anon;
grant execute on function public.save_list(text, jsonb, bigint) to anon;
