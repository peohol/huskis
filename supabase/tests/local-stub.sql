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
