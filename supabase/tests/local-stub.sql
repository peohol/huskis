-- ============================================================
-- Lokal etterligning av Supabase-miljøet, KUN for testing av
-- users-and-sharing.sql mot en vanlig PostgreSQL (16+).
-- Skal ALDRI kjøres mot selve Supabase-databasen (der finnes
-- auth-skjemaet og rollene fra før).
--
-- Bruk (se supabase/tests/run-tests.sh):
--   psql -f tests/local-stub.sql
--   psql -f users-and-sharing.sql        (x2 for idempotens)
--   psql -f tests/test-users-and-sharing.sql
-- ============================================================

create schema if not exists extensions;
create schema if not exists auth;

-- Minimal auth.users (kun kolonnene triggerne våre bruker).
create table if not exists auth.users (
  id                 uuid primary key default gen_random_uuid(),
  email              text unique,
  raw_user_meta_data jsonb not null default '{}'::jsonb
);

-- Minimal auth.sessions (kolonnene økt-RPC-ene våre leser). Supabase Auth
-- eier tabellen i produksjon; her stubbes den så økt-testene kan kjøre uten
-- Supabase. `user_agent`/`ip` er med fordi de FINNES i produksjon — og fordi
-- testene skal kunne bevise at de aldri forlater databasen.
create table if not exists auth.sessions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  refreshed_at timestamptz,
  user_agent   text,
  ip           text,
  not_after    timestamptz
);

-- Kaskaden fra auth.sessions, som i GoTrue. `revoke_my_session()` sletter
-- radene eksplisitt først, men tabellen skal finnes så den veien faktisk
-- kjøres i test.
create table if not exists auth.refresh_tokens (
  id         bigint generated always as identity primary key,
  session_id uuid references auth.sessions (id) on delete cascade,
  token      text
);

-- Som Supabase: auth.uid() leser sub-claimet fra JWT-en.
-- Testene setter det via set_config('request.jwt.claim.sub', ...).
create or replace function auth.uid()
returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

-- Supabase-rollene.
do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
grant usage on schema public to anon, authenticated;

-- Supabases STANDARDRETTIGHETER. Uten disse er en naken PostgreSQL strengere
-- enn produksjon: der får hver nye tabell i `public` ALL for anon/authenticated
-- automatisk, så en rettighet som bare er «utelatt» i migreringen finnes
-- likevel. Å utelate dem her gjorde at rettighetssjekkene i smoke-test.sql
-- passerte lokalt mens produksjon faktisk ga `authenticated` INSERT på
-- memberships. Testmiljøet må ha samme utgangspunkt som produksjon, ellers
-- tester suiten en snillere database enn den som deployes til.
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on functions to anon, authenticated;
alter default privileges in schema public grant all on sequences to anon, authenticated;
