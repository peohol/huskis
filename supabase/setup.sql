-- ============================================================
-- Pensjonering av v1 (mønster-lås + felles synk-doc).
-- ------------------------------------------------------------
-- Appen bruker nå Supabase Auth (e-post/passord) + relasjonelle
-- tabeller med RLS — se users-and-sharing.sql. Den gamle modellen
-- (ett jsonb-doc i public.lists, nådd via get_list/save_list og en
-- synk-kode utledet av mønster-låsen) brukes ikke av noen klient
-- lenger og fjernes her.
--
-- Idempotent: trygg å kjøre flere ganger. Kjøres av GitHub-Actionen
-- «Supabase DB-oppsett» sammen med users-and-sharing.sql.
-- ============================================================

drop function if exists public.get_list(text);
drop function if exists public.save_list(text, jsonb, bigint);
drop function if exists public.save_list(text, jsonb);
drop table if exists public.lists;
