-- ============================================================
-- Databaseoppsett for sky-synk i Huskeliste-appen.
-- Idempotent: trygg å kjøre flere ganger.
--
-- Hele state-objektet lagres som ett jsonb-felt i én rad,
-- identifisert av sha256(synk-kode). Tabellen er låst med RLS
-- (ingen policy) og all tilgang går via to SECURITY DEFINER-
-- funksjoner, slik at man må kjenne koden for å nå dataene.
-- ============================================================

create extension if not exists pgcrypto;

create table if not exists public.lists (
  code_hash  text primary key,
  data       jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.lists enable row level security;  -- ingen policy → ingen direkte tilgang

create or replace function public.get_list(p_code text)
returns jsonb language sql security definer set search_path = public as $$
  select data from public.lists
  where code_hash = encode(digest(p_code, 'sha256'), 'hex');
$$;

create or replace function public.save_list(p_code text, p_data jsonb)
returns void language sql security definer set search_path = public as $$
  insert into public.lists (code_hash, data, updated_at)
  values (encode(digest(p_code, 'sha256'), 'hex'), p_data, now())
  on conflict (code_hash) do update
    set data = excluded.data, updated_at = now();
$$;

grant execute on function public.get_list(text)         to anon;
grant execute on function public.save_list(text, jsonb) to anon;
