-- ============================================================
-- Huskis: brukere, roller, eierskap og deling
-- Idempotent: trygg å kjøre flere ganger.
--
-- Modell (se docs/rettigheter-og-deling.md for full design):
--
--   * Supabase Auth (e-post + passord, bekreftelseslenke på e-post)
--     står for identitet. public.profiles speiler auth.users.
--   * Relasjonelle tabeller per nivå: universes > groups > cards
--     («lister» i UI-et) > items. Hver rad har `owner_id`, som er
--     OPPRETTEREN (created_by) — ren historikk, uten myndighet.
--   * DELING skjer KUN på universer og grupper. Lister arver alltid
--     tilgang fra gruppen sin; listepunkter/kategorier fra listen.
--   * MYNDIGHET ligger i MUTABLE ROLLER (public.memberships.role):
--       - universe + role 'owner'  → universeier (medeier når flere)
--       - universe + role 'member' → vanlig universmedlem
--       - group    + role 'owner'  → eksplisitt gruppeeier
--       - group    + role 'member' → direkte gruppemedlem
--     Universeiere er DYNAMISKE supereiere av alle grupper/lister i
--     universet og trenger ingen egne grupperader. Effektivt gruppe-
--     medlemskap = deduplisert union av universeiere, eksplisitte
--     gruppeeiere, universmedlemmer og direkte gruppemedlemmer.
--   * INVARIANT: et univers har alltid minst én `owner`. Håndheves i
--     databasen (memberships_last_owner_guard) — ikke bare i RPC-ene.
--   * AUTORISASJON er capability-basert (`*_caps`-funksjonene under),
--     beregnet serverside og returnert til klienten. RLS + BEFORE
--     UPDATE-vakter håndhever; klientens flagg er kun visning.
--   * Konflikthåndtering: felt-nivå LWW-registre (ts/org for innhold,
--     pos_ts/pos_org for plassering, lab_ts/lab_org for K/P), håndhevet
--     også på serveren: en utdatert skriving taper mot nyere data.
--   * Gravsteiner (tombstones) skrives automatisk ved sletting, slik at
--     offline-klienter ikke gjenoppliver slettede objekter.
--   * PERSONLIG rekkefølge (universer på toppnivå, frie grupper) ligger
--     på medlemskapsraden (`memberships.pos`) — også for eiere. Delt
--     rekkefølge (grupper i et univers, lister i en gruppe, listepunkter)
--     ligger på objektraden (`pos`).
--   * get_my_doc() gir hele brukerens datasett som ETT flatt jsonb-doc
--     (universes/groups/cards/items + roller + capabilities + invitasjoner).
--   * move_group() er den ENESTE veien en gruppe bytter univers:
--     samme eierskapsdomene → ekte reparenting; ulikt domene → atomisk
--     kopier-og-slett med nye id-er + gravsteiner for de gamle.
--   * import_doc(p_doc) migrerer et lokalt/legacy doc inn som brukerens
--     egne data (deterministiske id-er, idempotent).
--
-- Krever (manuelt, i Supabase-dashboardet — se TODO.md):
--   * Auth: "Confirm email" PÅ (standard), Site URL + Redirect URLs
--     satt til appens adresse. Ev. egen SMTP for produksjonsvolum.
-- ============================================================

create extension if not exists pgcrypto with schema extensions;

-- ------------------------------------------------------------
-- 0. MIGRERINGSLOGG — engangsjobber som IKKE skal kjøres på nytt
--    (en rolle-backfill som kjørte om igjen ville gjeninnsatt en
--    rolle eieren bevisst har fjernet).
-- ------------------------------------------------------------

create table if not exists public.migration_log (
  key    text primary key,
  ran_at timestamptz not null default now()
);
alter table public.migration_log enable row level security;
revoke all on public.migration_log from public, anon, authenticated;

-- ------------------------------------------------------------
-- 1. PROFILES — speil av auth.users
-- ------------------------------------------------------------

create table if not exists public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  email        text not null,
  display_name text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Profilbilde: det ferdig beskårne, kvadratiske bildet som en data-URI
-- (256x256 JPEG fra klientens bilderedigering — noen få titalls kB). Lagres
-- her, ikke i Storage: raden er allerede den vi henter personen fra, og
-- get_members kan levere den sammen med navn/e-post. Størrelsen er en
-- systemgrense (klienten kan sende hva som helst), så den håndheves her.
alter table public.profiles add column if not exists avatar text;
alter table public.profiles drop constraint if exists profiles_avatar_size;
alter table public.profiles add constraint profiles_avatar_size
  check (avatar is null or length(avatar) <= 200000);

create unique index if not exists profiles_email_key on public.profiles (lower(email));

alter table public.profiles enable row level security;

-- Opprettes/oppdateres automatisk fra auth.users. Kobler også
-- ventende invitasjoner (sendt til e-posten før brukeren fantes).
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, display_name)
  values (
    new.id,
    lower(new.email),
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1))
  )
  on conflict (id) do update set email = excluded.email, updated_at = now();

  update public.share_invites
     set invitee_id = new.id
   where invitee_id is null
     and lower(invitee_email) = lower(new.email)
     and status = 'pending';

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.handle_user_email_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.profiles
     set email = lower(new.email), updated_at = now()
   where id = new.id;
  return new;
end;
$$;

drop trigger if exists on_auth_user_email_changed on auth.users;
create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row when (old.email is distinct from new.email)
  execute function public.handle_user_email_change();

-- ------------------------------------------------------------
-- 2. OBJEKTTABELLER — universes > groups > cards > items
--    Registre som i synk-doc-et:
--      innhold:    ts / org          (navn/tekst/trashed; K/P for kort
--                                     har eget register lab_ts/lab_org)
--      plassering: pos_ts / pos_org  (pos + forelder-peker følger
--                                     posisjonsregisteret)
--    `owner_id` = OPPRETTER (created_by). Uforanderlig, og gir INGEN
--    rettigheter — myndighet kommer utelukkende fra roller.
-- ------------------------------------------------------------

create table if not exists public.universes (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references public.profiles (id) on delete cascade,
  name       text not null default '',
  trashed    boolean not null default false,
  locked     boolean not null default false,   -- redigeringslås for vanlige medlemmer
  ts         bigint not null default 0,
  org        text   not null default '',
  pos        double precision not null default 0,
  pos_ts     bigint not null default 0,
  pos_org    text   not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.groups (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references public.profiles (id) on delete cascade,
  universe_id uuid not null references public.universes (id) on delete cascade,
  name        text not null default '',
  trashed     boolean not null default false,
  locked      boolean not null default false,
  ts          bigint not null default 0,
  org         text   not null default '',
  pos         double precision not null default 0,
  pos_ts      bigint not null default 0,
  pos_org     text   not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.cards (      -- «lister» i UI-et
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references public.profiles (id) on delete cascade,
  group_id   uuid not null references public.groups (id) on delete cascade,
  title      text not null default '',
  trashed    boolean not null default false,
  locked     boolean not null default false,
  k          boolean not null default true,    -- merkelapp K
  p          boolean not null default true,    -- merkelapp P
  ts         bigint not null default 0,
  org        text   not null default '',
  lab_ts     bigint not null default 0,        -- eget register for K/P
  lab_org    text   not null default '',
  pos        double precision not null default 0,
  pos_ts     bigint not null default 0,
  pos_org    text   not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.items (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references public.profiles (id) on delete cascade,
  card_id    uuid not null references public.cards (id) on delete cascade,
  text       text not null default '',
  trashed    boolean not null default false,
  done       boolean not null default false,
  responsible uuid references public.profiles (id) on delete set null,
  ts         bigint not null default 0,
  org        text   not null default '',
  pos        double precision not null default 0,
  pos_ts     bigint not null default 0,
  pos_org    text   not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Avkryssing av listepunkter (gjort/ikke gjort): rir på innholds-registeret
-- (ts/org), som text/trashed. Idempotent for databaser opprettet før feltet.
alter table public.items add column if not exists done boolean not null default false;
-- Ansvarlig bruker for et listepunkt (den som «tar oppgaven» i en delt liste).
-- Peker på en profil med effektiv tilgang til gruppen. Rir på innholds-
-- registeret (ts/org). `on delete set null` så en slettet konto bare nullstiller
-- ansvaret. Idempotent for eldre databaser.
alter table public.items add column if not exists responsible uuid references public.profiles (id) on delete set null;

-- Tidsplanlegging (start/frist) + ansvarlig for HELE lister. Tidsverdiene er
-- klientens lokale «vegg-tid» som tekst ('YYYY-MM-DD' eller 'YYYY-MM-DDTHH:MM',
-- klokkeslett valgfritt) — bevisst IKKE timestamptz: en frist «14. juli» skal
-- bety 14. juli på alle enheter uansett tidssone, og klienten trenger å vite
-- om et klokkeslett faktisk er definert. `cards.lock_times` låser listens
-- tider til listepunktene (de kan da ikke ha egne). Alt rir på innholds-
-- registeret (ts/org). Idempotent for eldre databaser.
alter table public.cards add column if not exists start_at text;
alter table public.cards add column if not exists due_at text;
alter table public.cards add column if not exists lock_times boolean not null default false;
alter table public.cards add column if not exists responsible uuid references public.profiles (id) on delete set null;
alter table public.items add column if not exists start_at text;
alter table public.items add column if not exists due_at text;

-- Kategorier: en kategori er en nivå-1-«rad» i en liste som grupperer listepunkter
-- (nivå 2) under en felles overskrift. Den lagres SOM et listepunkt (samme tabell),
-- markert `is_cat = true`; leaf-rader peker på kategorien sin via `cat_id`
-- (null = ukategorisert). `on delete set null` løsner radene om kategori-raden
-- slettes. `lock_times` (som cards) låser kategoriens tider til medlemmene.
-- `cat_id` følger posisjonsregisteret (som `card_id`); `is_cat`/`lock_times` rir
-- på innholds-registeret (ts/org). Idempotent for eldre databaser.
-- `deferrable initially deferred`: import_doc kan sette inn et listepunkt FØR
-- kategori-raden det peker på (doc-rekkefølgen er vilkårlig) — FK-en sjekkes
-- da først ved commit, når alle radene finnes.
alter table public.items add column if not exists cat_id uuid references public.items (id) on delete set null deferrable initially deferred;
alter table public.items add column if not exists is_cat boolean not null default false;
alter table public.items add column if not exists lock_times boolean not null default false;

-- Unntak fra arvet lås: et objekt under et låst univers/gruppe er automatisk
-- låst for vanlige medlemmer, men rett autoritet kan sette `unlocked = true` for
-- NETTOPP dette objektet så det likevel kan redigeres (og alt under det, med
-- mindre et enda lavere nivå låses på nytt). `locked` og `unlocked` er gjensidig
-- utelukkende per rad. Idempotent for eldre databaser.
alter table public.universes add column if not exists unlocked boolean not null default false;
alter table public.groups    add column if not exists unlocked boolean not null default false;
alter table public.cards     add column if not exists unlocked boolean not null default false;

-- Lukketilstand for lister (rullgardin-kollaps i UI-et): en visnings-preferanse
-- per liste som lagres og synkes som annet innhold. Rir på innholds-registeret.
alter table public.cards     add column if not exists collapsed boolean not null default false;

-- Lukketilstand for kategorier (samme rullgardin-kollaps som lister). En kategori
-- lagres som et listepunkt, så feltet bor på `items` (kun meningsfullt for
-- is_cat-rader). Rir på innholds-registeret (ts/org).
alter table public.items     add column if not exists collapsed boolean not null default false;

-- Universer og grupper vises med NØYAKTIG samme oppsett som lister og
-- listepunkter (navigasjonsmodalen): et univers er et kort som kan kollapses, og
-- gruppene i det er rader som kan ligge i GRUPPEKATEGORIER. Speiler derfor
-- kategori-modellen fra `items`. Idempotent for eldre databaser.
alter table public.groups    add column if not exists cat_id uuid references public.groups (id) on delete set null deferrable initially deferred;
alter table public.groups    add column if not exists is_cat boolean not null default false;
alter table public.groups    add column if not exists collapsed boolean not null default false;
alter table public.universes add column if not exists collapsed boolean not null default false;

-- Invitasjonspolicy (tretilstand: 'inherit' | 'allow' | 'deny') — styrer om
-- VANLIGE medlemmer (ikke eiere) kan invitere flere til objektet. DYNAMISK ARV:
-- den effektive tilstanden er den NÆRMESTE eksplisitte ('allow'/'deny') fra
-- objektet og oppover; ingen eksplisitt noe sted → tillat. Finnes KUN på
-- universer og grupper (lister deles ikke). `cards.invite_policy` er pensjonert:
-- kolonnen beholdes for eldre databaser, men leses aldri.
do $$ begin
  alter table public.universes add column if not exists invite_policy text not null default 'inherit';
  alter table public.groups    add column if not exists invite_policy text not null default 'inherit';
exception when others then null;
end $$;
do $$ begin
  alter table public.universes add constraint universes_invite_policy_chk check (invite_policy in ('inherit','allow','deny'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.groups    add constraint groups_invite_policy_chk    check (invite_policy in ('inherit','allow','deny'));
exception when duplicate_object then null; end $$;

create index if not exists universes_owner_idx on public.universes (owner_id);
create index if not exists groups_owner_idx    on public.groups (owner_id);
create index if not exists groups_universe_idx on public.groups (universe_id);
create index if not exists cards_owner_idx     on public.cards (owner_id);
create index if not exists cards_group_idx     on public.cards (group_id);
create index if not exists items_owner_idx     on public.items (owner_id);
create index if not exists items_card_idx      on public.items (card_id);

alter table public.universes enable row level security;
alter table public.groups    enable row level security;
alter table public.cards     enable row level security;
alter table public.items     enable row level security;

-- ------------------------------------------------------------
-- 3. ROLLER/MEDLEMSKAP og INVITASJONER
-- ------------------------------------------------------------

-- Én rad = én brukers ROLLE på ETT delbart objekt (univers eller gruppe).
-- Nøyaktig én av universe_id/group_id er satt.
--   * role 'owner'  → eier/medeier (universeier hhv. eksplisitt gruppeeier)
--   * role 'member' → vanlig medlem (universmedlem hhv. direkte gruppemedlem)
--   * pos           → brukerens PERSONLIGE rekkefølge (universer på toppnivå,
--                     frie grupper i «Grupper delt med meg»). Endrer aldri
--                     hva andre ser.
-- Eiere HAR en rad (i motsetning til den gamle modellen) — det er nettopp
-- den raden som gjør eierskapet mutabelt (degradering/overføring).
-- `card_id` er PENSJONERT (lister deles ikke lenger); kolonnen står igjen for
-- eldre databaser, men en CHECK holder den null. Se migreringen i del 11.
create table if not exists public.memberships (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references public.profiles (id) on delete cascade,
  universe_id        uuid references public.universes (id) on delete cascade,
  group_id           uuid references public.groups (id) on delete cascade,
  card_id            uuid references public.cards (id) on delete cascade,
  parent_universe_id uuid references public.universes (id) on delete set null,
  parent_group_id    uuid references public.groups (id) on delete set null,
  pos                double precision not null default 0,
  trashed            boolean not null default false,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

alter table public.memberships add column if not exists role text not null default 'member';
do $$ begin
  alter table public.memberships add constraint memberships_role_chk check (role in ('owner','member'));
exception when duplicate_object then null; end $$;

create unique index if not exists memberships_universe_user_key
  on public.memberships (universe_id, user_id) where universe_id is not null;
create unique index if not exists memberships_group_user_key
  on public.memberships (group_id, user_id) where group_id is not null;
create index if not exists memberships_user_idx on public.memberships (user_id);
create index if not exists memberships_universe_role_idx on public.memberships (universe_id, role);
create index if not exists memberships_group_role_idx on public.memberships (group_id, role);

alter table public.memberships enable row level security;

-- Invitasjon til et univers eller en gruppe, adressert til en e-post (mottakeren
-- trenger ikke ha konto ennå; kobles ved registrering). `role` avgjør om det er
-- en MEDLEMS- eller EIERSKAPS-invitasjon; begge må aksepteres av mottakeren.
-- Aksept krever ingen plassering — objektet havner i riktig seksjon av seg selv.
create table if not exists public.share_invites (
  id            uuid primary key default gen_random_uuid(),
  inviter_id    uuid not null references public.profiles (id) on delete cascade,
  invitee_email text not null,
  invitee_id    uuid references public.profiles (id) on delete cascade,
  universe_id   uuid references public.universes (id) on delete cascade,
  group_id      uuid references public.groups (id) on delete cascade,
  card_id       uuid references public.cards (id) on delete cascade,
  status        text not null default 'pending'
                check (status in ('pending', 'accepted', 'declined', 'revoked')),
  created_at    timestamptz not null default now(),
  responded_at  timestamptz
);

alter table public.share_invites add column if not exists role text not null default 'member';
do $$ begin
  alter table public.share_invites add constraint share_invites_role_chk check (role in ('owner','member'));
exception when duplicate_object then null; end $$;

create unique index if not exists share_invites_universe_pending_key
  on public.share_invites (universe_id, lower(invitee_email))
  where status = 'pending' and universe_id is not null;
create unique index if not exists share_invites_group_pending_key
  on public.share_invites (group_id, lower(invitee_email))
  where status = 'pending' and group_id is not null;
create index if not exists share_invites_invitee_idx
  on public.share_invites (lower(invitee_email)) where status = 'pending';

alter table public.share_invites enable row level security;

-- ------------------------------------------------------------
-- 4. GRAVSTEINER — hindrer at offline-klienter gjenoppliver
--    hardslettede objekter ved neste synk.
--
--    Gravsteinene er AUTORITATIVE og håndheves av databasen selv
--    (guard_object_insert under): en permanent slettet id kan ikke
--    settes inn igjen — heller ikke av en gammel klientversjon, en
--    modifisert klient eller en rå INSERT/UPSERT mot PostgREST.
--
--    De UTLØPER ALDRI. En klient som har ligget ubrukt i et år har
--    fortsatt sin gamle lokale kopi, og skal møte gravsteinen når
--    den endelig synker igjen. Se docs/trash.md.
-- ------------------------------------------------------------

create table if not exists public.tombstones (
  resource_type text not null check (resource_type in ('universe', 'group', 'card', 'item')),
  resource_id   uuid not null,
  ts            bigint not null default 0,   -- HLC-tid for slettingen
  deleted_at    timestamptz not null default now(),
  primary key (resource_type, resource_id)
);

create index if not exists tombstones_resource_idx on public.tombstones (resource_id);

alter table public.tombstones enable row level security;

create or replace function public.write_tombstone()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  rtype text := case tg_table_name
                  when 'universes' then 'universe'
                  when 'groups'    then 'group'
                  when 'cards'     then 'card'
                  when 'items'     then 'item'
                end;
begin
  insert into public.tombstones (resource_type, resource_id, ts)
  values (rtype, old.id, greatest(old.ts, old.pos_ts, (extract(epoch from now()) * 1000)::bigint))
  on conflict (resource_type, resource_id)
    do update set ts = excluded.ts, deleted_at = now();
  return old;
end;
$$;

drop trigger if exists universes_tombstone on public.universes;
create trigger universes_tombstone after delete on public.universes
  for each row execute function public.write_tombstone();
drop trigger if exists groups_tombstone on public.groups;
create trigger groups_tombstone after delete on public.groups
  for each row execute function public.write_tombstone();
drop trigger if exists cards_tombstone on public.cards;
create trigger cards_tombstone after delete on public.cards
  for each row execute function public.write_tombstone();
drop trigger if exists items_tombstone on public.items;
create trigger items_tombstone after delete on public.items
  for each row execute function public.write_tombstone();

-- BEFORE INSERT-vakt på de fire objekttabellene. To ting, og begge må ligge i
-- DATABASEN for å være noe verdt — en klient kan byttes ut, databasen ikke:
--   1. GJENOPPLIVING. Har id-en gravstein, avvises innsettingen (PT409), så
--      klienten kan gravlegge raden lokalt og slutte å prøve.
--   2. OPPRETTER. `owner_id` valideres mot den innloggede brukeren, uavhengig
--      av policy-oppsettet.
-- auth.uid() is null = psql/vedlikehold: owner_id sjekkes ikke, men gravsteinen
-- gjelder også der.
create or replace function public.guard_object_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  rtype text := case tg_table_name
                  when 'universes' then 'universe'
                  when 'groups'    then 'group'
                  when 'cards'     then 'card'
                  when 'items'     then 'item'
                end;
begin
  if exists (select 1 from public.tombstones t
              where t.resource_type = rtype and t.resource_id = new.id) then
    raise exception using
      errcode = 'PT409',
      message = 'gravlagt: ' || rtype || ' ' || new.id || ' er permanent slettet',
      hint    = 'Objektet er slettet for godt. En utdatert klient kan ikke sette det inn igjen.';
  end if;
  if uid is not null and new.owner_id is distinct from uid then
    raise exception using
      errcode = '42501',
      message = 'oppretter (owner_id) må være den innloggede brukeren';
  end if;
  return new;
end;
$$;

drop trigger if exists universes_insert_guard on public.universes;
create trigger universes_insert_guard before insert on public.universes
  for each row execute function public.guard_object_insert();
drop trigger if exists groups_insert_guard on public.groups;
create trigger groups_insert_guard before insert on public.groups
  for each row execute function public.guard_object_insert();
drop trigger if exists cards_insert_guard on public.cards;
create trigger cards_insert_guard before insert on public.cards
  for each row execute function public.guard_object_insert();
drop trigger if exists items_insert_guard on public.items;
create trigger items_insert_guard before insert on public.items
  for each row execute function public.guard_object_insert();

-- ------------------------------------------------------------
-- 5. ROLLER, LÅSER og CAPABILITIES
--
-- ============================================================================
-- TERMINOLOGI (se docs/rettigheter-og-deling.md for full modell):
--   * OPPRETTER  = `owner_id` på objektraden. REN HISTORIKK — gir ingen
--                  rettigheter. (Kolonnenavnet er beholdt teknisk; semantisk
--                  er det `created_by`.)
--   * UNIVERSEIER = memberships(universe_id, role 'owner'). Flere er likestilte
--                  («Medeiere»). Det finnes ALLTID minst én.
--   * GRUPPEEIER = memberships(group_id, role 'owner') — «eksplisitt» —
--                  ELLER en universeier, som er dynamisk supereier av alle
--                  grupper i universet.
--   * EFFEKTIVT GRUPPEMEDLEMSKAP = deduplisert union av universeiere,
--                  eksplisitte gruppeeiere, universmedlemmer og direkte
--                  gruppemedlemmer.
-- Autorisasjonen er CAPABILITY-basert; alt håndheves SERVERSIDE (RLS + BEFORE
-- UPDATE-vakter + SECURITY DEFINER-RPC-er), aldri kun i klienten.
-- ============================================================================
-- ------------------------------------------------------------

-- Policyene avhenger av tilgangsfunksjonene, så de må vike før funksjonene som
-- endrer signatur/semantikk kan droppes. Alle gjenopprettes i del 7.
drop policy if exists universes_select on public.universes;
drop policy if exists universes_insert on public.universes;
drop policy if exists universes_update on public.universes;
drop policy if exists universes_delete on public.universes;
drop policy if exists groups_select on public.groups;
drop policy if exists groups_insert on public.groups;
drop policy if exists groups_update on public.groups;
drop policy if exists groups_delete on public.groups;
drop policy if exists cards_select on public.cards;
drop policy if exists cards_insert on public.cards;
drop policy if exists cards_update on public.cards;
drop policy if exists cards_delete on public.cards;
drop policy if exists items_select on public.items;
drop policy if exists items_insert on public.items;
drop policy if exists items_update on public.items;
drop policy if exists items_delete on public.items;
drop policy if exists memberships_select on public.memberships;
drop policy if exists memberships_update on public.memberships;
drop policy if exists memberships_delete on public.memberships;

-- Pensjonerte funksjoner fra oppretter-modellen. «Administrator» finnes ikke
-- lenger som begrep: full myndighet kommer utelukkende fra eierroller.
drop function if exists public.can_admin_resource(text, uuid, uuid);
drop function if exists public.resource_owner(text, uuid);
drop function if exists public.resource_creator(text, uuid);
drop function if exists public.resource_universe_owner(text, uuid);
drop function if exists public.can_edit_universe(uuid, uuid);
drop function if exists public.can_edit_group(uuid, uuid);
drop function if exists public.can_edit_card(uuid, uuid);
drop function if exists public.effective_lock_source(text, uuid);
drop function if exists public.inherited_lock_source(text, uuid);
drop function if exists public.effective_invite_source(text, uuid);
drop function if exists public.inherited_invite_source(text, uuid);
-- Invitasjoner har fått en ROLLE-parameter. Den gamle 3-argumentsvarianten må
-- vekk, ellers blir et 3-argumentskall tvetydig (og ville sluppet unna
-- rolle-autorisasjonen).
drop function if exists public.create_share_invite(text, uuid, text);

-- Intern «privilegert operasjon»-kontekst: settes KUN av SECURITY DEFINER-
-- RPC-ene under (rolleendring, gruppeflytting, import) og leses av vaktene, så
-- kolonner som ellers er uforanderlige for klienter kan skrives der reglene
-- allerede ER kontrollert. Transaksjonslokal (`set_config(..., true)`), så den
-- kan ikke lekke til neste forespørsel i samme tilkobling.
create or replace function public.in_privileged_op()
returns boolean language sql stable set search_path = public as $$
  select coalesce(current_setting('huskis.privileged_op', true), '') = '1';
$$;

-- ---- Roller ----

create or replace function public.universe_role(p_universe uuid, p_uid uuid)
returns text language sql stable security definer set search_path = public as $$
  select m.role from public.memberships m
   where m.universe_id = p_universe and m.user_id = p_uid;
$$;

-- DIREKTE rolle på gruppen (arvet universrolle telles ikke med her).
create or replace function public.group_role(p_group uuid, p_uid uuid)
returns text language sql stable security definer set search_path = public as $$
  select m.role from public.memberships m
   where m.group_id = p_group and m.user_id = p_uid;
$$;

create or replace function public.group_universe(p_group uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select universe_id from public.groups where id = p_group;
$$;

create or replace function public.is_universe_owner(p_universe uuid, p_uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.memberships m
                  where m.universe_id = p_universe and m.user_id = p_uid and m.role = 'owner');
$$;

create or replace function public.is_universe_member(p_universe uuid, p_uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.memberships m
                  where m.universe_id = p_universe and m.user_id = p_uid);
$$;

-- EFFEKTIV gruppeeier: eksplisitt gruppeeierrolle ELLER universeier (dynamisk
-- supereier — trenger ingen egen grupperad).
create or replace function public.is_group_owner(p_group uuid, p_uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.memberships m
                  where m.group_id = p_group and m.user_id = p_uid and m.role = 'owner')
      or public.is_universe_owner(public.group_universe(p_group), p_uid);
$$;

-- EFFEKTIVT gruppemedlemskap: direkte grupperolle ELLER en hvilken som helst
-- universrolle på gruppens kanoniske univers.
create or replace function public.is_group_member(p_group uuid, p_uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.memberships m
                  where m.group_id = p_group and m.user_id = p_uid)
      or public.is_universe_member(public.group_universe(p_group), p_uid);
$$;

-- Antall universeiere — grunnlaget for siste-eier-invarianten og for om
-- rollen heter «Eier» eller «Medeiere».
create or replace function public.universe_owner_count(p_universe uuid)
returns integer language sql stable security definer set search_path = public as $$
  select count(*)::int from public.memberships m
   where m.universe_id = p_universe and m.role = 'owner';
$$;

-- Eierskapsdomenet til et univers: det NÅVÆRENDE, dedupliserte settet av
-- universeiere, sortert så to universer kan sammenlignes direkte. To universer
-- er i samme domene når settene er identiske (se move_group).
create or replace function public.universe_owner_set(p_universe uuid)
returns uuid[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(m.user_id order by m.user_id), '{}'::uuid[])
    from public.memberships m
   where m.universe_id = p_universe and m.role = 'owner';
$$;

-- ---- Lesetilgang ----
-- Universet leses KUN av universmedlemmer: en direkte gruppemottaker uten
-- universrolle skal aldri se universets navn eller medlemsliste.

create or replace function public.can_read_universe(p_id uuid, p_uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_universe_member(p_id, p_uid);
$$;

create or replace function public.can_read_group(p_id uuid, p_uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.groups g where g.id = p_id)
     and public.is_group_member(p_id, p_uid);
$$;

create or replace function public.can_read_card(p_id uuid, p_uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.can_read_group((select group_id from public.cards where id = p_id), p_uid);
$$;

create or replace function public.can_read(p_type text, p_id uuid, p_uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(case p_type
    when 'universe' then public.can_read_universe(p_id, p_uid)
    when 'group'    then public.can_read_group(p_id, p_uid)
    when 'card'     then public.can_read_card(p_id, p_uid)
    when 'item'     then public.can_read_card((select card_id from public.items where id = p_id), p_uid)
  end, false);
$$;

-- Universet et objekt av vilkårlig type hører til.
create or replace function public.resource_universe(p_type text, p_id uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select case p_type
    when 'universe' then p_id
    when 'group'    then (select universe_id from public.groups where id = p_id)
    when 'card'     then (select g.universe_id from public.cards c
                          join public.groups g on g.id = c.group_id where c.id = p_id)
    when 'item'     then (select g.universe_id from public.items i
                          join public.cards c on c.id = i.card_id
                          join public.groups g on g.id = c.group_id where i.id = p_id)
  end;
$$;

-- Gruppen et objekt av vilkårlig type hører til (null for universer).
create or replace function public.resource_group(p_type text, p_id uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select case p_type
    when 'group' then p_id
    when 'card'  then (select group_id from public.cards where id = p_id)
    when 'item'  then (select c.group_id from public.items i
                       join public.cards c on c.id = i.card_id where i.id = p_id)
  end;
$$;

-- PRIVILEGERT = eier på det nivået som styrer objektet: universeier for et
-- univers, gruppeeier (eksplisitt eller universeier) for gruppe/liste/listepunkt.
-- Privilegerte påvirkes ALDRI av en lås for egen redigering.
create or replace function public.is_privileged(p_type text, p_id uuid, p_uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select case p_type
    when 'universe' then public.is_universe_owner(p_id, p_uid)
    else coalesce(public.is_group_owner(public.resource_group(p_type, p_id), p_uid), false)
  end;
$$;

-- ---- Låser (tretilstand: eksplisitt låst / eksplisitt unntak / arv) ----
-- Nærmeste eksplisitte tilstand fra objektet og oppover avgjør. 0 rader = åpen.
-- Listepunkter har ingen egen lås → følger listen sin.

create or replace function public.effective_lock_source(p_type text, p_id uuid)
returns table(src_type text, src_id uuid, is_locked boolean)
language plpgsql stable security definer set search_path = public as $$
declare
  v_card uuid; v_group uuid; v_universe uuid;
  r record; vlocked boolean; vunlocked boolean;
begin
  if p_type = 'item' then select card_id into v_card from public.items where id = p_id;
  elsif p_type = 'card' then v_card := p_id;
  elsif p_type = 'group' then v_group := p_id;
  elsif p_type = 'universe' then v_universe := p_id;
  end if;
  if v_card is not null then select group_id into v_group from public.cards where id = v_card; end if;
  if v_group is not null then select universe_id into v_universe from public.groups where id = v_group; end if;

  for r in
    select * from (values (1, 'card', v_card), (2, 'group', v_group), (3, 'universe', v_universe))
      as ch(depth, t, id)
    where ch.id is not null order by ch.depth
  loop
    if r.t = 'card' then select locked, unlocked into vlocked, vunlocked from public.cards where id = r.id;
    elsif r.t = 'group' then select locked, unlocked into vlocked, vunlocked from public.groups where id = r.id;
    else select locked, unlocked into vlocked, vunlocked from public.universes where id = r.id;
    end if;
    if vlocked or vunlocked then
      src_type := r.t; src_id := r.id; is_locked := vlocked;
      return next; return;
    end if;
  end loop;
  return;
end;
$$;

create or replace function public.is_effectively_locked(p_type text, p_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select s.is_locked from public.effective_lock_source(p_type, p_id) s), false);
$$;

-- Nærmeste eksplisitte lås blant objektets STRENGE superobjekter — grunnlaget
-- for «hvem kan gjøre unntak fra en ARVET lås».
create or replace function public.inherited_lock_source(p_type text, p_id uuid)
returns table(src_type text, src_id uuid, is_locked boolean)
language plpgsql stable security definer set search_path = public as $$
declare v_pt text; v_pid uuid;
begin
  if p_type = 'card' then v_pt := 'group'; select group_id into v_pid from public.cards where id = p_id;
  elsif p_type = 'group' then v_pt := 'universe'; select universe_id into v_pid from public.groups where id = p_id;
  elsif p_type = 'item' then v_pt := 'card'; select card_id into v_pid from public.items where id = p_id;
  else return; end if;
  return query select * from public.effective_lock_source(v_pt, v_pid);
end;
$$;

-- Hvem kan opprette/fjerne et UNNTAK fra en ARVET lås:
--   * universeiere alltid (også fra en universlås — bare de kan åpne den);
--   * er den arvede låsen satt på en GRUPPE, kan også en EKSPLISITT gruppeeier
--     der styre unntaket for lister under gruppen.
-- En gruppeeier kan altså ikke åpne grenen for andre i strid med en universlås.
-- Finnes det INGEN arvet lås, er «unntak» bare en overflødig flaggverdi (den
-- gjør ingenting) — da kan den som ellers styrer objektets lås rydde den bort,
-- f.eks. etter at låsen over er fjernet.
create or replace function public.can_manage_lock_exception(p_type text, p_id uuid, p_uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_universe_owner(public.resource_universe(p_type, p_id), p_uid)
      or exists (
        select 1 from public.inherited_lock_source(p_type, p_id) s
        join public.memberships m on m.group_id = s.src_id and m.user_id = p_uid and m.role = 'owner'
        where s.is_locked and s.src_type = 'group')
      or (not exists (select 1 from public.inherited_lock_source(p_type, p_id) s where s.is_locked)
          and public.is_privileged(p_type, p_id, p_uid));
$$;

-- ---- Invitasjonspolicy (kun universer og grupper) ----

create or replace function public.effective_invite_source(p_type text, p_id uuid)
returns table(src_type text, src_id uuid, pol text)
language plpgsql stable security definer set search_path = public as $$
declare
  v_group uuid; v_universe uuid; r record; vpol text;
begin
  if p_type = 'group' then v_group := p_id;
  elsif p_type = 'universe' then v_universe := p_id;
  else return; end if;
  if v_group is not null then select universe_id into v_universe from public.groups where id = v_group; end if;

  for r in
    select * from (values (1, 'group', v_group), (2, 'universe', v_universe))
      as ch(depth, t, id)
    where ch.id is not null order by ch.depth
  loop
    if r.t = 'group' then select invite_policy into vpol from public.groups where id = r.id;
    else select invite_policy into vpol from public.universes where id = r.id;
    end if;
    if vpol in ('allow', 'deny') then
      src_type := r.t; src_id := r.id; pol := vpol; return next; return;
    end if;
  end loop;
  return;
end;
$$;

create or replace function public.effective_invite_policy(p_type text, p_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select s.pol = 'allow' from public.effective_invite_source(p_type, p_id) s), true);
$$;

create or replace function public.inherited_invite_source(p_type text, p_id uuid)
returns table(src_type text, src_id uuid, pol text)
language plpgsql stable security definer set search_path = public as $$
declare v_pid uuid;
begin
  if p_type <> 'group' then return; end if;
  select universe_id into v_pid from public.groups where id = p_id;
  return query select * from public.effective_invite_source('universe', v_pid);
end;
$$;

-- ---- Capabilities ----

-- Endre objektets INNHOLD (navn/tekst/tidsplan/avkryssing/trashed …).
-- Lesetilgang + (privilegert ELLER ikke effektivt låst).
create or replace function public.can_edit_content(p_type text, p_id uuid, p_uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.can_read(p_type, p_id, p_uid)
     and (public.is_privileged(p_type, p_id, p_uid)
          or not public.is_effectively_locked(p_type, p_id));
$$;

-- Opprette subobjekter (gruppe i univers, liste i gruppe, listepunkt i liste):
-- samme rett som å endre forelderens innhold.
create or replace function public.can_create_child(p_type text, p_id uuid, p_uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.can_edit_content(p_type, p_id, p_uid);
$$;

-- Endre objektets POSISJON blant søsken. Posisjonen tilhører FORELDERENS
-- organisering, så den styres av retten til å redigere forelderens innhold —
-- ikke av objektets egen lås. Universets toppnivåposisjon er PERSONLIG
-- (memberships.pos) og krever bare medlemskap.
create or replace function public.can_reorder_in_parent(p_type text, p_id uuid, p_uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(case p_type
    when 'universe' then public.is_universe_member(p_id, p_uid)
    when 'group'    then public.can_edit_content('universe', (select universe_id from public.groups where id = p_id), p_uid)
    when 'card'     then public.can_edit_content('group',    (select group_id    from public.cards  where id = p_id), p_uid)
    when 'item'     then public.can_edit_content('card',     (select card_id     from public.items  where id = p_id), p_uid)
  end, false);
$$;

-- Slette objektet FOR ALLE (felles søppel / permanent tømming).
--   * univers: kun universeiere
--   * gruppe:  gruppeeiere, ELLER et universMEDLEM når gruppen er effektivt åpen
--              (et rent direkte gruppemedlem kan aldri slette gruppen)
--   * liste/listepunkt: gruppeeiere, ELLER enhver med lesetilgang når objektet
--              er effektivt åpent
create or replace function public.can_delete_object(p_type text, p_id uuid, p_uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(case p_type
    when 'universe' then public.is_universe_owner(p_id, p_uid)
    when 'group' then public.is_group_owner(p_id, p_uid)
      or (public.is_universe_member(public.group_universe(p_id), p_uid)
          and not public.is_effectively_locked('group', p_id))
    else public.is_privileged(p_type, p_id, p_uid)
      or (public.can_read(p_type, p_id, p_uid)
          and not public.is_effectively_locked(p_type, p_id))
  end, false);
$$;

-- Forlate objektet (fjerner KUN egen tilgang, aldri innhold).
--   * univers: må ha en rolle; siste eier kan ikke forlate
--   * gruppe:  må ha en DIREKTE grupperolle (arvet universtilgang forlates i
--              universet, ikke i gruppen)
create or replace function public.can_leave(p_type text, p_id uuid, p_uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select case p_type
    when 'universe' then public.universe_role(p_id, p_uid) is not null
      and (public.universe_role(p_id, p_uid) <> 'owner' or public.universe_owner_count(p_id) > 1)
    when 'group' then public.group_role(p_id, p_uid) is not null
    else false
  end;
$$;

-- Administrere DIREKTE medlemmer (kaste ut) og EIERSKAP (invitere/degradere/
-- fjerne eiere), samt innstillinger, lås og invitasjonspolicy på nivået.
create or replace function public.can_manage_members(p_type text, p_id uuid, p_uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select case p_type
    when 'universe' then public.is_universe_owner(p_id, p_uid)
    when 'group'    then public.is_group_owner(p_id, p_uid)
    else false
  end;
$$;

-- Invitere VANLIGE medlemmer: eier på nivået, ELLER et effektivt medlem når
-- effektiv invitasjonspolicy tillater det.
create or replace function public.can_invite_to(p_type text, p_id uuid, p_uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.can_manage_members(p_type, p_id, p_uid)
      or (public.can_read(p_type, p_id, p_uid)
          and p_type in ('universe', 'group')
          and public.effective_invite_policy(p_type, p_id));
$$;

-- Invitere til EIERSKAP — aldri gjennom invitasjonspolicy; kun eiere på nivået.
create or replace function public.can_invite_owner(p_type text, p_id uuid, p_uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.can_manage_members(p_type, p_id, p_uid);
$$;

-- Låse/åpne objektet for andre. Universet: universeiere. Gruppe/liste:
-- gruppeeiere (eksplisitte + universeiere).
create or replace function public.can_manage_lock(p_type text, p_id uuid, p_uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_privileged(p_type, p_id, p_uid);
$$;

-- Endre objektets eksplisitte invitasjonspolicy. Under en arvet 'deny' fra
-- universet kan bare universeiere gjøre et 'allow'-unntak på gruppen.
create or replace function public.can_manage_invite_policy(p_type text, p_id uuid, p_uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when exists (select 1 from public.inherited_invite_source(p_type, p_id) s where s.pol = 'deny')
      then public.is_universe_owner(public.resource_universe(p_type, p_id), p_uid)
    else public.can_manage_members(p_type, p_id, p_uid)
  end;
$$;

-- Flytte gruppen ut av universet sitt: destruktiv myndighet i KILDEN. Ren
-- redigeringsrett holder ikke (se move_group, som i tillegg krever
-- opprettelsesrett i MÅLET).
create or replace function public.can_move_group(p_group uuid, p_uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.can_delete_object('group', p_group, p_uid);
$$;

-- ---- Delingsstatus ----
-- «Aktivt delt» = mer enn ÉN bruker har effektiv tilgang. Ventende invitasjoner
-- teller ikke. For en gruppe er det den DEDUPLISERTE unionen av universroller
-- og direkte grupperoller.

create or replace function public.universe_member_count(p_universe uuid)
returns integer language sql stable security definer set search_path = public as $$
  select count(*)::int from public.memberships m where m.universe_id = p_universe;
$$;

create or replace function public.group_member_count(p_group uuid)
returns integer language sql stable security definer set search_path = public as $$
  select count(*)::int from (
    select m.user_id from public.memberships m where m.universe_id = public.group_universe(p_group)
    union
    select m.user_id from public.memberships m where m.group_id = p_group
  ) s;
$$;

-- ---- Capability-pakker til klienten ----
-- Serveren er autoritativ; klienten gate-r kontroller på nøyaktig disse.

create or replace function public.universe_caps(p_id uuid, p_uid uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'read',              public.can_read_universe(p_id, p_uid),
    'editContent',       public.can_edit_content('universe', p_id, p_uid),
    'createGroup',       public.can_create_child('universe', p_id, p_uid),
    'reorderGroups',     public.can_edit_content('universe', p_id, p_uid),
    'manageSettings',    public.can_manage_members('universe', p_id, p_uid),
    'delete',            public.can_delete_object('universe', p_id, p_uid),
    'leave',             public.can_leave('universe', p_id, p_uid),
    'invite',            public.can_invite_to('universe', p_id, p_uid),
    'inviteOwner',       public.can_invite_owner('universe', p_id, p_uid),
    'manageMembers',     public.can_manage_members('universe', p_id, p_uid),
    'manageOwners',      public.can_manage_members('universe', p_id, p_uid),
    'manageLock',        public.can_manage_lock('universe', p_id, p_uid),
    'lockException',     public.can_manage_lock_exception('universe', p_id, p_uid),
    'managePolicy',      public.can_manage_invite_policy('universe', p_id, p_uid),
    'locked',            public.is_effectively_locked('universe', p_id));
$$;

create or replace function public.group_caps(p_id uuid, p_uid uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'read',              public.can_read_group(p_id, p_uid),
    'editContent',       public.can_edit_content('group', p_id, p_uid),
    'createList',        public.can_create_child('group', p_id, p_uid),
    'reorderInParent',   public.can_reorder_in_parent('group', p_id, p_uid),
    'manageSettings',    public.can_manage_members('group', p_id, p_uid),
    'delete',            public.can_delete_object('group', p_id, p_uid),
    'move',              public.can_move_group(p_id, p_uid),
    'leave',             public.can_leave('group', p_id, p_uid),
    'invite',            public.can_invite_to('group', p_id, p_uid),
    'inviteOwner',       public.can_invite_owner('group', p_id, p_uid),
    'manageMembers',     public.can_manage_members('group', p_id, p_uid),
    'manageOwners',      public.can_manage_members('group', p_id, p_uid),
    'manageLock',        public.can_manage_lock('group', p_id, p_uid),
    'lockException',     public.can_manage_lock_exception('group', p_id, p_uid),
    'managePolicy',      public.can_manage_invite_policy('group', p_id, p_uid),
    'locked',            public.is_effectively_locked('group', p_id));
$$;

-- ------------------------------------------------------------
-- 6. VAKT- OG LWW-TRIGGERE (BEFORE INSERT/UPDATE/DELETE)
--    * owner_id (oppretter) er uforanderlig og gir ingen rettigheter.
--    * locked/unlocked/invite_policy er priviligerte kolonner — endres kun av
--      rett autoritet, ellers RAISES (aldri via rå PostgREST av uvedkommende).
--    * INNHOLDS-felt reverteres uten can_edit_content ELLER med eldre register.
--    * POSISJON (pos + forelder-peker) reverteres uten can_reorder_in_parent
--      ELLER med eldre register — skilt fra innholdslåsen.
--    * `groups.universe_id` kan IKKE endres med en vanlig skriving: gruppeflytting
--      går gjennom move_group() (atomisk, med domenekontroll).
--    * Et univers har alltid minst én eier (memberships-vaktene).
--    * auth.uid() is null = admin/psql (vedlikehold) → hopper over autorisasjon
--      (kun LWW gjelder).
-- ------------------------------------------------------------

create or replace function public.reg_newer(a_ts bigint, a_org text, b_ts bigint, b_org text)
returns boolean language sql immutable as $$
  select coalesce(a_ts, 0) > coalesce(b_ts, 0)
      or (coalesce(a_ts, 0) = coalesce(b_ts, 0) and coalesce(a_org, '') > coalesce(b_org, ''));
$$;

-- ---- Eierrolle ved opprettelse ----
-- Den som oppretter et univers blir universeier; den som oppretter en gruppe blir
-- eksplisitt gruppeeier — MEN ikke hvis vedkommende allerede er universeier
-- (da er rollen arvet og en egen rad ville bare duplisert medlemslisten).
create or replace function public.universes_after_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.memberships (user_id, universe_id, role, pos)
  values (new.owner_id, new.id, 'owner', coalesce(new.pos, 0))
  on conflict (universe_id, user_id) where universe_id is not null do nothing;
  return new;
end;
$$;

drop trigger if exists universes_owner_seed on public.universes;
create trigger universes_owner_seed after insert on public.universes
  for each row execute function public.universes_after_insert();

create or replace function public.groups_after_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.is_universe_owner(new.universe_id, new.owner_id) then return new; end if;
  insert into public.memberships (user_id, group_id, role, pos)
  values (new.owner_id, new.id, 'owner', coalesce(new.pos, 0))
  on conflict (group_id, user_id) where group_id is not null do nothing;
  return new;
end;
$$;

drop trigger if exists groups_owner_seed on public.groups;
create trigger groups_owner_seed after insert on public.groups
  for each row execute function public.groups_after_insert();

-- ---- Objekt-vakter ----

create or replace function public.universes_before_update()
returns trigger language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); can_content boolean := true; can_reorder boolean := true;
begin
  -- Oppretteren er uforanderlig for klienter. Unntaket er en privilegert
  -- operasjon: kontosletting lar en gjenværende eier ARVE oppretterfeltet, for
  -- FK-en er `on delete cascade` og ville ellers tatt andres innhold med seg.
  if new.owner_id is distinct from old.owner_id and not public.in_privileged_op() then
    raise exception 'owner_id (oppretter) kan ikke endres';
  end if;
  if uid is not null then
    can_content := public.can_edit_content('universe', old.id, uid);
    can_reorder := public.can_reorder_in_parent('universe', old.id, uid);
  end if;
  if new.locked is distinct from old.locked and uid is not null
     and not public.can_manage_lock('universe', old.id, uid) then
    raise exception 'mangler myndighet til å låse/åpne';
  end if;
  if new.unlocked is distinct from old.unlocked and uid is not null
     and not public.can_manage_lock_exception('universe', old.id, uid) then
    raise exception 'mangler myndighet til å endre unntak';
  end if;
  if new.invite_policy is distinct from old.invite_policy and uid is not null
     and not public.can_manage_invite_policy('universe', old.id, uid) then
    raise exception 'mangler myndighet til å endre invitasjonspolicy';
  end if;
  -- Sletting/gjenoppretting av HELE universet (felles søppel) er en eierhandling.
  if new.trashed is distinct from old.trashed and uid is not null
     and not public.can_delete_object('universe', old.id, uid) then
    raise exception 'mangler myndighet til å slette universet';
  end if;
  if (uid is not null and not can_content and not public.in_privileged_op())
     or not public.reg_newer(new.ts, new.org, old.ts, old.org) then
    new.name := old.name; new.trashed := old.trashed;
    new.collapsed := old.collapsed;
    new.ts := old.ts; new.org := old.org;
  end if;
  if (uid is not null and not can_reorder and not public.in_privileged_op())
     or not public.reg_newer(new.pos_ts, new.pos_org, old.pos_ts, old.pos_org) then
    new.pos := old.pos; new.pos_ts := old.pos_ts; new.pos_org := old.pos_org;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists universes_guard on public.universes;
create trigger universes_guard before update on public.universes
  for each row execute function public.universes_before_update();

create or replace function public.groups_before_update()
returns trigger language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); can_content boolean := true; can_reorder boolean := true;
begin
  if new.owner_id is distinct from old.owner_id and not public.in_privileged_op() then
    raise exception 'owner_id (oppretter) kan ikke endres';
  end if;
  if uid is not null then
    can_content := public.can_edit_content('group', old.id, uid);
    can_reorder := public.can_reorder_in_parent('group', old.id, uid);
  end if;
  if new.locked is distinct from old.locked and uid is not null
     and not public.can_manage_lock('group', old.id, uid) then
    raise exception 'mangler myndighet til å låse/åpne';
  end if;
  if new.unlocked is distinct from old.unlocked and uid is not null
     and not public.can_manage_lock_exception('group', old.id, uid) then
    raise exception 'mangler myndighet til å endre unntak';
  end if;
  if new.invite_policy is distinct from old.invite_policy and uid is not null
     and not public.can_manage_invite_policy('group', old.id, uid) then
    raise exception 'mangler myndighet til å endre invitasjonspolicy';
  end if;
  -- Å slette en gruppe FOR ALLE krever destruktiv myndighet (gruppeeier, eller
  -- et universmedlem når gruppen er effektivt åpen) — ikke bare redigeringsrett.
  if new.trashed is distinct from old.trashed and uid is not null
     and not public.can_delete_object('group', old.id, uid) then
    raise exception 'mangler myndighet til å slette gruppen';
  end if;
  -- Gruppen bytter univers KUN via move_group(): den avgjør eierskapsdomene,
  -- kontrollerer rettigheter i både kilde og mål, og gjør alt i én transaksjon.
  if new.universe_id is distinct from old.universe_id and not public.in_privileged_op() then
    raise exception using
      errcode = '42501',
      message = 'grupper flyttes mellom universer med move_group()';
  end if;
  if (uid is not null and not can_content and not public.in_privileged_op())
     or not public.reg_newer(new.ts, new.org, old.ts, old.org) then
    new.name := old.name; new.trashed := old.trashed;
    new.is_cat := old.is_cat; new.collapsed := old.collapsed;
    new.ts := old.ts; new.org := old.org;
  end if;
  if (uid is not null and not can_reorder and not public.in_privileged_op())
     or not public.reg_newer(new.pos_ts, new.pos_org, old.pos_ts, old.pos_org) then
    new.universe_id := old.universe_id;   -- forelder følger posisjonsregisteret
    new.cat_id := old.cat_id;             -- … og gruppekategori-medlemskapet
    new.pos := old.pos; new.pos_ts := old.pos_ts; new.pos_org := old.pos_org;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists groups_guard on public.groups;
create trigger groups_guard before update on public.groups
  for each row execute function public.groups_before_update();

create or replace function public.cards_before_update()
returns trigger language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); can_content boolean := true; can_reorder boolean := true;
begin
  -- Se universes_before_update: kun kontosletting arver oppretterfeltet.
  if new.owner_id is distinct from old.owner_id and not public.in_privileged_op() then
    raise exception 'owner_id (oppretter) kan ikke endres';
  end if;
  if uid is not null then
    can_content := public.can_edit_content('card', old.id, uid);
    can_reorder := public.can_reorder_in_parent('card', old.id, uid);
  end if;
  if new.locked is distinct from old.locked and uid is not null
     and not public.can_manage_lock('card', old.id, uid) then
    raise exception 'mangler myndighet til å låse/åpne';
  end if;
  if new.unlocked is distinct from old.unlocked and uid is not null
     and not public.can_manage_lock_exception('card', old.id, uid) then
    raise exception 'mangler myndighet til å endre unntak';
  end if;
  if new.group_id is distinct from old.group_id and uid is not null then
    -- Flytting av en liste mellom grupper krever rettigheter i BÅDE kilde og mål.
    if not public.can_edit_content('group', old.group_id, uid) then
      raise exception 'mangler tilgang til kilde-gruppen';
    end if;
    if not public.can_create_child('group', new.group_id, uid) then
      raise exception 'mangler tilgang til mål-gruppen';
    end if;
  end if;
  if (uid is not null and not can_content and not public.in_privileged_op())
     or not public.reg_newer(new.ts, new.org, old.ts, old.org) then
    new.title := old.title; new.trashed := old.trashed;
    new.responsible := old.responsible;
    new.start_at := old.start_at; new.due_at := old.due_at; new.lock_times := old.lock_times;
    new.collapsed := old.collapsed;
    new.ts := old.ts; new.org := old.org;
  end if;
  if (uid is not null and not can_content and not public.in_privileged_op())
     or not public.reg_newer(new.lab_ts, new.lab_org, old.lab_ts, old.lab_org) then
    new.k := old.k; new.p := old.p;
    new.lab_ts := old.lab_ts; new.lab_org := old.lab_org;
  end if;
  if (uid is not null and not can_reorder and not public.in_privileged_op())
     or not public.reg_newer(new.pos_ts, new.pos_org, old.pos_ts, old.pos_org) then
    new.group_id := old.group_id;
    new.pos := old.pos; new.pos_ts := old.pos_ts; new.pos_org := old.pos_org;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists cards_guard on public.cards;
create trigger cards_guard before update on public.cards
  for each row execute function public.cards_before_update();

create or replace function public.items_before_update()
returns trigger language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); can_content boolean := true; can_reorder boolean := true;
begin
  -- Se universes_before_update: kun kontosletting arver oppretterfeltet.
  if new.owner_id is distinct from old.owner_id and not public.in_privileged_op() then
    raise exception 'owner_id (oppretter) kan ikke endres';
  end if;
  if uid is not null then
    can_content := public.can_edit_content('item', old.id, uid);
    can_reorder := public.can_reorder_in_parent('item', old.id, uid);
  end if;
  if new.card_id is distinct from old.card_id and uid is not null then
    if not public.can_edit_content('card', old.card_id, uid) then
      raise exception 'mangler tilgang til kilde-listen';
    end if;
    if not public.can_create_child('card', new.card_id, uid) then
      raise exception 'mangler tilgang til mål-listen';
    end if;
  end if;
  if (uid is not null and not can_content and not public.in_privileged_op())
     or not public.reg_newer(new.ts, new.org, old.ts, old.org) then
    new.text := old.text; new.trashed := old.trashed; new.done := old.done;
    new.responsible := old.responsible;
    new.start_at := old.start_at; new.due_at := old.due_at;
    new.is_cat := old.is_cat; new.lock_times := old.lock_times; new.collapsed := old.collapsed;
    new.ts := old.ts; new.org := old.org;
  end if;
  if (uid is not null and not can_reorder and not public.in_privileged_op())
     or not public.reg_newer(new.pos_ts, new.pos_org, old.pos_ts, old.pos_org) then
    new.card_id := old.card_id; new.cat_id := old.cat_id;
    new.pos := old.pos; new.pos_ts := old.pos_ts; new.pos_org := old.pos_org;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists items_guard on public.items;
create trigger items_guard before update on public.items
  for each row execute function public.items_before_update();

-- ---- Medlemskaps-/rolle-vakter ----
-- Rollen er MUTABEL, men kun gjennom set_member_role()/accept_share_invite()
-- (som setter privilegert kontekst etter å ha kontrollert myndigheten). En rå
-- PostgREST-oppdatering kan bare endre sin EGEN personlige posisjon.
create or replace function public.memberships_before_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.user_id      is distinct from old.user_id
     or new.universe_id is distinct from old.universe_id
     or new.group_id    is distinct from old.group_id then
    raise exception 'medlemskapets objekt/bruker kan ikke endres';
  end if;
  if new.role is distinct from old.role then
    if not public.in_privileged_op() then
      raise exception 'roller endres kun via set_member_role()';
    end if;
    -- SISTE-EIER-INVARIANTEN: et univers må alltid ha minst én eier.
    if old.universe_id is not null and old.role = 'owner' and new.role <> 'owner'
       and public.universe_owner_count(old.universe_id) <= 1 then
      raise exception using
        errcode = 'PT422',
        message = 'universet må ha minst én eier';
    end if;
  end if;
  if auth.uid() is not null and not public.in_privileged_op()
     and new.user_id <> auth.uid() then
    raise exception 'kan bare endre egen plassering';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists memberships_guard on public.memberships;
create trigger memberships_guard before update on public.memberships
  for each row execute function public.memberships_before_update();

-- Siste-eier-invarianten gjelder også sletting (forlat/kast ut/rå DELETE).
-- Kaskader hoppes over: forsvinner selve universet eller brukeren, er det ingen
-- invariant igjen å beskytte.
create or replace function public.memberships_before_delete()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.universe_id is not null and old.role = 'owner'
     and exists (select 1 from public.universes u where u.id = old.universe_id)
     and exists (select 1 from public.profiles p where p.id = old.user_id)
     and public.universe_owner_count(old.universe_id) <= 1 then
    raise exception using
      errcode = 'PT422',
      message = 'universet må ha minst én eier';
  end if;
  return old;
end;
$$;

drop trigger if exists memberships_last_owner_guard on public.memberships;
create trigger memberships_last_owner_guard before delete on public.memberships
  for each row execute function public.memberships_before_delete();

-- ------------------------------------------------------------
-- 7. RLS-POLICYER
-- ------------------------------------------------------------

-- profiles: kun egen rad (medlemslister hentes via get_members-RPC).
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select using (id = auth.uid());
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

-- universes
create policy universes_select on public.universes
  for select using (public.can_read_universe(id, auth.uid()));
create policy universes_insert on public.universes
  for insert with check (owner_id = auth.uid());
create policy universes_update on public.universes
  for update using (public.can_edit_content('universe', id, auth.uid())
                    or public.can_reorder_in_parent('universe', id, auth.uid()));
create policy universes_delete on public.universes
  for delete using (public.can_delete_object('universe', id, auth.uid()));

-- groups: opprettelse krever opprettelsesrett i universet.
create policy groups_select on public.groups
  for select using (public.can_read_group(id, auth.uid()));
create policy groups_insert on public.groups
  for insert with check (owner_id = auth.uid()
                         and public.can_create_child('universe', universe_id, auth.uid()));
-- Oppdatering tillates når brukeren kan endre INNHOLD ELLER bare POSISJON.
-- Vakten håndhever så feltnivået, så en reorder-only-tilgang ikke kan snike
-- inn låste innholdsfelt.
create policy groups_update on public.groups
  for update using (public.can_edit_content('group', id, auth.uid())
                    or public.can_reorder_in_parent('group', id, auth.uid()));
create policy groups_delete on public.groups
  for delete using (public.can_delete_object('group', id, auth.uid()));

-- cards («lister»)
create policy cards_select on public.cards
  for select using (public.can_read_card(id, auth.uid()));
create policy cards_insert on public.cards
  for insert with check (owner_id = auth.uid()
                         and public.can_create_child('group', group_id, auth.uid()));
create policy cards_update on public.cards
  for update using (public.can_edit_content('card', id, auth.uid())
                    or public.can_reorder_in_parent('card', id, auth.uid()));
create policy cards_delete on public.cards
  for delete using (public.can_delete_object('card', id, auth.uid()));

-- items
create policy items_select on public.items
  for select using (public.can_read_card(card_id, auth.uid()));
create policy items_insert on public.items
  for insert with check (owner_id = auth.uid()
                         and public.can_create_child('card', card_id, auth.uid()));
create policy items_update on public.items
  for update using (public.can_edit_content('item', id, auth.uid())
                    or public.can_reorder_in_parent('item', id, auth.uid()));
create policy items_delete on public.items
  for delete using (public.can_delete_object('item', id, auth.uid()));

-- memberships: egen rad (personlig posisjon, forlate) + eiere som administrerer
-- medlemslisten. Opprettelse skjer KUN via SECURITY DEFINER-veiene (aksept av
-- invitasjon, opprettelses-triggerne) — INSERT er ikke gitt til authenticated.
create policy memberships_select on public.memberships
  for select using (
    user_id = auth.uid()
    or (universe_id is not null and public.can_manage_members('universe', universe_id, auth.uid()))
    or (group_id is not null and public.can_manage_members('group', group_id, auth.uid()))
  );
create policy memberships_update on public.memberships
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy memberships_delete on public.memberships
  for delete using (
    user_id = auth.uid()
    or (universe_id is not null and public.can_manage_members('universe', universe_id, auth.uid()))
    or (group_id is not null and public.can_manage_members('group', group_id, auth.uid()))
  );

-- share_invites: avsender ser sine; mottaker ser sine (på id eller e-post).
-- Opprettelse/respons kun via RPC-ene.
drop policy if exists share_invites_select on public.share_invites;
create policy share_invites_select on public.share_invites
  for select using (
    inviter_id = auth.uid()
    or invitee_id = auth.uid()
    or lower(invitee_email) = (select lower(email) from public.profiles where id = auth.uid())
  );
drop policy if exists share_invites_delete on public.share_invites;
create policy share_invites_delete on public.share_invites
  for delete using (inviter_id = auth.uid());

-- tombstones: lesbare for innloggede (id-ene er ugjettbare uuid-er);
-- skrives kun av delete-triggerne.
drop policy if exists tombstones_select on public.tombstones;
create policy tombstones_select on public.tombstones
  for select using (auth.uid() is not null);

-- ------------------------------------------------------------
-- 8. DELINGS-RPC-ER (security definer)
--    Deling finnes KUN på universer og grupper. Alt som gjelder lister,
--    listepunkter og kategorier arves.
-- ------------------------------------------------------------

-- Fjerner ALL tilgang en bruker har UNDER et univers: universrollen, alle
-- direkte grupperoller i universet, ventende invitasjoner til universet og
-- gruppene, og ansvarstildelinger som peker på brukeren. Brukes av både
-- «forlat» og «kast ut» — en bruker skal aldri sitte igjen med skjult tilgang
-- til en enkeltgruppe etter å ha forlatt universet.
create or replace function public.purge_universe_access(p_universe uuid, p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
declare now_ms bigint := (extract(epoch from now()) * 1000)::bigint;
begin
  perform set_config('huskis.privileged_op', '1', true);
  delete from public.memberships m
   where m.user_id = p_user
     and m.group_id in (select g.id from public.groups g where g.universe_id = p_universe);
  delete from public.memberships m
   where m.user_id = p_user and m.universe_id = p_universe;

  update public.share_invites s
     set status = 'revoked', responded_at = now()
   where s.status = 'pending'
     and (s.invitee_id = p_user
          or lower(s.invitee_email) = (select lower(email) from public.profiles where id = p_user))
     and (s.universe_id = p_universe
          or s.group_id in (select g.id from public.groups g where g.universe_id = p_universe));

  update public.cards c
     set responsible = null, ts = now_ms, org = 'server'
   where c.responsible = p_user
     and c.group_id in (select g.id from public.groups g where g.universe_id = p_universe);
  update public.items i
     set responsible = null, ts = now_ms, org = 'server'
   where i.responsible = p_user
     and i.card_id in (select c.id from public.cards c
                       join public.groups g on g.id = c.group_id
                       where g.universe_id = p_universe);
end;
$$;

-- Fjerner en DIREKTE grupperolle (og ansvarstildelinger, hvis brukeren mister
-- den effektive tilgangen). Rører aldri universmedlemskap: en universarvet
-- bruker kan ikke fjernes fra én enkelt gruppe.
create or replace function public.purge_group_access(p_group uuid, p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
declare now_ms bigint := (extract(epoch from now()) * 1000)::bigint;
begin
  perform set_config('huskis.privileged_op', '1', true);
  delete from public.memberships m where m.user_id = p_user and m.group_id = p_group;

  update public.share_invites s
     set status = 'revoked', responded_at = now()
   where s.status = 'pending' and s.group_id = p_group
     and (s.invitee_id = p_user
          or lower(s.invitee_email) = (select lower(email) from public.profiles where id = p_user));

  if not public.is_group_member(p_group, p_user) then
    update public.cards c
       set responsible = null, ts = now_ms, org = 'server'
     where c.responsible = p_user and c.group_id = p_group;
    update public.items i
       set responsible = null, ts = now_ms, org = 'server'
     where i.responsible = p_user
       and i.card_id in (select c.id from public.cards c where c.group_id = p_group);
  end if;
end;
$$;

-- Inviterer en e-postadresse til et UNIVERS eller en GRUPPE.
--   * p_role = 'member' → vanlig medlemsinvitasjon: eier på nivået, ELLER et
--     effektivt medlem når invitasjonspolicyen tillater videreinvitasjon.
--   * p_role = 'owner'  → EIERSKAPS-invitasjon: kun eiere på nivået. En vanlig
--     invitasjonspolicy gir aldri rett til å invitere eiere.
-- Mottakeren trenger ikke ha konto ennå. Redundante MEDLEMS-invitasjoner
-- (mottakeren har allerede effektiv tilgang) avvises; en EIER-invitasjon til en
-- som allerede har tilgang er derimot gyldig — det er nettopp rolleløftet.
create or replace function public.create_share_invite(
  p_type text, p_id uuid, p_email text, p_role text default 'member')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid    uuid := auth.uid();
  em     text := lower(trim(p_email));
  target uuid;
  inv    public.share_invites;
begin
  if uid is null then raise exception 'ikke innlogget'; end if;
  if p_type not in ('universe', 'group') then
    raise exception 'kun universer og grupper kan deles (fikk: %)', p_type;
  end if;
  if p_role not in ('member', 'owner') then raise exception 'ugyldig rolle: %', p_role; end if;
  if em = '' or position('@' in em) = 0 then
    raise exception 'ugyldig e-postadresse';
  end if;
  if p_role = 'owner' then
    if not public.can_invite_owner(p_type, p_id, uid) then
      raise exception 'bare eiere kan invitere til eierskap';
    end if;
  elsif not public.can_invite_to(p_type, p_id, uid) then
    raise exception 'mangler myndighet til å invitere til dette objektet';
  end if;
  if em = (select lower(email) from public.profiles where id = uid) then
    raise exception 'kan ikke dele med deg selv';
  end if;

  select id into target from public.profiles where lower(email) = em;

  if target is not null then
    if p_role = 'member' and public.can_read(p_type, p_id, target) then
      raise exception 'brukeren har allerede tilgang';
    end if;
    if p_role = 'owner' and
       ((p_type = 'universe' and public.is_universe_owner(p_id, target))
        or (p_type = 'group' and public.is_group_owner(p_id, target))) then
      raise exception 'brukeren er allerede eier';
    end if;
  end if;

  -- Finnes det alt en VENTENDE invitasjon til samme person og objekt, er den
  -- riktige handlingen å oppdatere den, ikke å feile: å invitere et vanlig
  -- medlem til eierskap går nettopp via en (ny) invitasjon, og den samme
  -- personen kan allerede ha en ventende medlemsinvitasjon liggende. Vi lar
  -- rollen bare gå OPP (member → owner), så en ny medlemsinvitasjon ikke
  -- stille degraderer en eierinvitasjon som ligger og venter.
  -- `inviter_id` er ikke bare sporingsdata: den gir rett til å trekke tilbake
  -- invitasjonen (`revoke_share_invite`, og delete-policyen på tabellen). Et
  -- vanlig medlem som har lov til å invitere MEDLEMMER skal derfor ikke kunne
  -- overta en ventende EIER-invitasjon ved å sende en medlemsinvitasjon til den
  -- samme adressen — da ville det fått makt over en invitasjon det aldri kunne
  -- opprettet. Avsenderen overtas bare når kalleren selv er autorisert for
  -- rollen invitasjonen ender opp med.
  if p_type = 'universe' then
    insert into public.share_invites (inviter_id, invitee_email, invitee_id, universe_id, role)
    values (uid, em, target, p_id, p_role)
    on conflict (universe_id, lower(invitee_email)) where status = 'pending' and universe_id is not null
      do update set role = case when excluded.role = 'owner' then 'owner'
                                else public.share_invites.role end,
                    inviter_id = case
                      when excluded.role = 'owner' or public.share_invites.role <> 'owner'
                        then excluded.inviter_id
                      else public.share_invites.inviter_id end,
                    invitee_id = coalesce(excluded.invitee_id, public.share_invites.invitee_id)
    returning * into inv;
  else
    insert into public.share_invites (inviter_id, invitee_email, invitee_id, group_id, role)
    values (uid, em, target, p_id, p_role)
    on conflict (group_id, lower(invitee_email)) where status = 'pending' and group_id is not null
      do update set role = case when excluded.role = 'owner' then 'owner'
                                else public.share_invites.role end,
                    inviter_id = case
                      when excluded.role = 'owner' or public.share_invites.role <> 'owner'
                        then excluded.inviter_id
                      else public.share_invites.inviter_id end,
                    invitee_id = coalesce(excluded.invitee_id, public.share_invites.invitee_id)
    returning * into inv;
  end if;

  return to_jsonb(inv);
end;
$$;

-- Neste ledige PERSONLIGE toppnivåposisjon for en bruker (universer og frie
-- grupper deler samme personlige rekkefølgerom-per-seksjon; ny tilgang legges
-- alltid bakerst).
create or replace function public.next_personal_pos(p_user uuid)
returns double precision language sql stable security definer set search_path = public as $$
  select coalesce(max(m.pos), 0) + 1 from public.memberships m where m.user_id = p_user;
$$;

-- Mottakeren aksepterer. Ingen plassering å velge: et univers havner i «Mine
-- universer»/«Universer delt med meg» etter rolle, og en gruppe enten inne i
-- universet (hvis mottakeren er universmedlem) eller i «Grupper delt med meg».
create or replace function public.accept_share_invite(
  p_invite uuid, p_parent uuid default null, p_pos double precision default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  inv public.share_invites;
  mem public.memberships;
  newpos double precision;
begin
  if uid is null then raise exception 'ikke innlogget'; end if;

  select * into inv from public.share_invites where id = p_invite for update;
  if inv.id is null then raise exception 'invitasjonen finnes ikke'; end if;
  if inv.status <> 'pending' then raise exception 'invitasjonen er ikke lenger åpen'; end if;
  if coalesce(inv.invitee_id, uid) <> uid
     or (inv.invitee_id is null
         and lower(inv.invitee_email) <> (select lower(email) from public.profiles where id = uid)) then
    raise exception 'invitasjonen er ikke til deg';
  end if;

  newpos := coalesce(p_pos, public.next_personal_pos(uid));
  perform set_config('huskis.privileged_op', '1', true);

  if inv.universe_id is not null then
    insert into public.memberships (user_id, universe_id, role, pos)
    values (uid, inv.universe_id, inv.role, newpos)
    on conflict (universe_id, user_id) where universe_id is not null
      do update set role = case when excluded.role = 'owner' then 'owner'
                                else public.memberships.role end
    returning * into mem;
    -- Universmedlemskapet gjør ordinære DIREKTE gruppemedlemskap i universet
    -- redundante; eksplisitte gruppeeierroller beholdes (de gir ekstra myndighet).
    delete from public.memberships m
     where m.user_id = uid and m.role = 'member'
       and m.group_id in (select g.id from public.groups g where g.universe_id = inv.universe_id);
  else
    insert into public.memberships (user_id, group_id, role, pos)
    values (uid, inv.group_id, inv.role, newpos)
    on conflict (group_id, user_id) where group_id is not null
      do update set role = case when excluded.role = 'owner' then 'owner'
                                else public.memberships.role end
    returning * into mem;
  end if;

  update public.share_invites
     set status = 'accepted', invitee_id = uid, responded_at = now()
   where id = inv.id;

  perform set_config('huskis.privileged_op', '', true);
  return to_jsonb(mem);
end;
$$;

create or replace function public.decline_share_invite(p_invite uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  inv public.share_invites;
begin
  if uid is null then raise exception 'ikke innlogget'; end if;
  select * into inv from public.share_invites where id = p_invite for update;
  if inv.id is null or inv.status <> 'pending' then
    raise exception 'invitasjonen er ikke åpen';
  end if;
  if coalesce(inv.invitee_id, uid) <> uid
     or (inv.invitee_id is null
         and lower(inv.invitee_email) <> (select lower(email) from public.profiles where id = uid)) then
    raise exception 'invitasjonen er ikke til deg';
  end if;
  update public.share_invites
     set status = 'declined', invitee_id = uid, responded_at = now()
   where id = inv.id;
end;
$$;

-- Trekker tilbake en ventende invitasjon: sin egen, eller (som eier på nivået)
-- en hvilken som helst.
create or replace function public.revoke_share_invite(p_invite uuid)
returns void language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); inv public.share_invites;
begin
  if uid is null then raise exception 'ikke innlogget'; end if;
  select * into inv from public.share_invites where id = p_invite and status = 'pending' for update;
  if inv.id is null then raise exception 'fant ingen ventende invitasjon'; end if;
  if inv.inviter_id <> uid
     and not public.can_manage_members(
       case when inv.universe_id is not null then 'universe' else 'group' end,
       coalesce(inv.universe_id, inv.group_id), uid) then
    raise exception 'mangler myndighet til å trekke tilbake denne invitasjonen';
  end if;
  update public.share_invites set status = 'revoked', responded_at = now() where id = inv.id;
end;
$$;

-- Kaster ut et medlem (eller en medeier) fra et univers / en gruppe. Krever
-- eierrolle på nivået. Universeiere og universmedlemmer kan IKKE fjernes fra én
-- enkelt gruppe — de må fjernes fra universet (RPC-en avviser forsøket, så
-- feilen forklarer hvorfor i stedet for å bli en stille no-op).
create or replace function public.revoke_share(p_type text, p_id uuid, p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'ikke innlogget'; end if;
  if p_type not in ('universe', 'group') then raise exception 'ugyldig type: %', p_type; end if;
  if not public.can_manage_members(p_type, p_id, uid) then
    raise exception 'mangler myndighet til å fjerne medlemmer';
  end if;
  perform set_config('huskis.privileged_op', '1', true);
  if p_type = 'universe' then
    if public.universe_role(p_id, p_user) is null then
      raise exception 'brukeren er ikke medlem av universet';
    end if;
    perform public.purge_universe_access(p_id, p_user);
  else
    if public.group_role(p_id, p_user) is null then
      if public.is_group_member(p_id, p_user) then
        raise exception using
          errcode = 'PT409',
          message = 'brukeren har tilgang via universet og må fjernes der';
      end if;
      raise exception 'brukeren er ikke medlem av gruppen';
    end if;
    perform public.purge_group_access(p_id, p_user);
  end if;
  perform set_config('huskis.privileged_op', '', true);
end;
$$;

-- Endrer en eksisterende rolle NEDOVER (eier → vanlig medlem). Rolleløft går
-- alltid gjennom en eierskapsINVITASJON mottakeren må akseptere.
create or replace function public.set_member_role(p_type text, p_id uuid, p_user uuid, p_role text)
returns void language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); cur text;
begin
  if uid is null then raise exception 'ikke innlogget'; end if;
  if p_type not in ('universe', 'group') then raise exception 'ugyldig type: %', p_type; end if;
  if p_role not in ('member', 'owner') then raise exception 'ugyldig rolle: %', p_role; end if;
  if not public.can_manage_members(p_type, p_id, uid) then
    raise exception 'mangler myndighet til å endre roller';
  end if;
  cur := case p_type when 'universe' then public.universe_role(p_id, p_user)
                     else public.group_role(p_id, p_user) end;
  if cur is null then raise exception 'brukeren har ingen rolle her'; end if;
  if p_role = 'owner' and cur <> 'owner' then
    raise exception 'eierskap gis via en eierskapsinvitasjon mottakeren må godta';
  end if;
  if cur = p_role then return; end if;
  perform set_config('huskis.privileged_op', '1', true);
  if p_type = 'universe' then
    update public.memberships set role = p_role where universe_id = p_id and user_id = p_user;
  else
    -- En degradert gruppeeier som ellers ikke har tilgang, blir vanlig direkte
    -- gruppemedlem; er vedkommende universmedlem, er raden overflødig.
    if public.is_universe_member(public.group_universe(p_id), p_user) then
      delete from public.memberships where group_id = p_id and user_id = p_user;
    else
      update public.memberships set role = p_role where group_id = p_id and user_id = p_user;
    end if;
  end if;
  perform set_config('huskis.privileged_op', '', true);
end;
$$;

-- Brukeren forlater selv. Innholdet røres aldri — kun egen tilgang.
create or replace function public.leave_share(p_type text, p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'ikke innlogget'; end if;
  if p_type not in ('universe', 'group') then raise exception 'ugyldig type: %', p_type; end if;
  if p_type = 'universe' then
    if public.universe_role(p_id, uid) is null then
      raise exception 'du er ikke medlem av dette universet';
    end if;
    if not public.can_leave('universe', p_id, uid) then
      raise exception using
        errcode = 'PT422',
        message = 'du er siste eier — gi eierskap til noen andre først';
    end if;
    perform set_config('huskis.privileged_op', '1', true);
    perform public.purge_universe_access(p_id, uid);
  else
    if public.group_role(p_id, uid) is null then
      if public.is_group_member(p_id, uid) then
        raise exception using
          errcode = 'PT409',
          message = 'du har tilgang via universet — forlat universet i stedet';
      end if;
      raise exception 'du er ikke medlem av denne gruppen';
    end if;
    perform set_config('huskis.privileged_op', '1', true);
    perform public.purge_group_access(p_id, uid);
  end if;
  perform set_config('huskis.privileged_op', '', true);
end;
$$;

-- Låser/åpner objektet for vanlige medlemmer. En lavere eksplisitt lås vinner
-- over et høyere unntak (nærmeste-eksplisitt-semantikken).
create or replace function public.set_locked(p_type text, p_id uuid, p_locked boolean)
returns void language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'ikke innlogget'; end if;
  if p_type not in ('universe', 'group', 'card') then raise exception 'ugyldig type: %', p_type; end if;
  if not public.can_manage_lock(p_type, p_id, uid) then
    raise exception 'mangler myndighet til å låse/åpne';
  end if;
  if p_type = 'universe' then update public.universes set locked = p_locked, unlocked = (unlocked and not p_locked) where id = p_id;
  elsif p_type = 'group' then update public.groups set locked = p_locked, unlocked = (unlocked and not p_locked) where id = p_id;
  else update public.cards set locked = p_locked, unlocked = (unlocked and not p_locked) where id = p_id;
  end if;
end;
$$;

-- Gjør/opphever et UNNTAK fra en ARVET lås. Kun universeiere (alltid), eller —
-- når den arvede låsen er satt på en GRUPPE — en eksplisitt gruppeeier der.
create or replace function public.set_unlocked(p_type text, p_id uuid, p_unlocked boolean)
returns void language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'ikke innlogget'; end if;
  if p_type not in ('universe', 'group', 'card') then raise exception 'ugyldig type: %', p_type; end if;
  if not public.can_manage_lock_exception(p_type, p_id, uid) then
    raise exception 'mangler myndighet til å endre unntak';
  end if;
  if p_type = 'universe' then update public.universes set unlocked = p_unlocked, locked = (locked and not p_unlocked) where id = p_id;
  elsif p_type = 'group' then update public.groups set unlocked = p_unlocked, locked = (locked and not p_unlocked) where id = p_id;
  else update public.cards set unlocked = p_unlocked, locked = (locked and not p_unlocked) where id = p_id;
  end if;
end;
$$;

-- Setter objektets eksplisitte INVITASJONSPOLICY (tretilstand). Kun univers og
-- gruppe — lister deles ikke og har ingen policy.
create or replace function public.set_invite_policy(p_type text, p_id uuid, p_policy text)
returns void language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'ikke innlogget'; end if;
  if p_type not in ('universe', 'group') then raise exception 'ugyldig type: %', p_type; end if;
  if p_policy not in ('inherit', 'allow', 'deny') then raise exception 'ugyldig policy: %', p_policy; end if;
  if not public.can_manage_invite_policy(p_type, p_id, uid) then
    raise exception 'mangler myndighet til å endre invitasjonspolicy';
  end if;
  if p_type = 'universe' then update public.universes set invite_policy = p_policy where id = p_id;
  else update public.groups set invite_policy = p_policy where id = p_id;
  end if;
end;
$$;
-- ------------------------------------------------------------
-- 8b. E-postvarsel ved deling (valgfritt — krever konfig)
-- ------------------------------------------------------------
-- Når en invitasjon opprettes sendes en e-post via pg_net → Resend:
--   • UREGISTRERT mottaker  → «du er invitert, registrer deg» med en lenke
--     til appen (?signup=<e-post>) som åpner registreringssiden med e-posten
--     utfylt. Etter registrering kobles invitasjonen automatisk (handle_new_user)
--     og mottakeren godtar den i appen.
--   • REGISTRERT mottaker   → «X delte Y med deg» med lenke til appen, MEN kun
--     hvis mottakeren har e-postvarsler på (user_metadata.email_notifications,
--     standard på). Ellers vises delingen kun i appen (rød ring + innboks).
--
-- HEMMELIGHETER: selve Resend-API-nøkkelen foretrekkes lagret i **Supabase
-- Vault** (kryptert i ro; `vault.decrypted_secrets` er kun lesbar for
-- eier-rollen, aldri for anon/authenticated). Trigger-funksjonen leser Vault
-- først og faller tilbake til `public.app_config` KUN så det hermetiske
-- test-miljøet (uten Vault) fortsatt kan kjøre. Ikke-hemmelig konfig (avsender,
-- app-URL) ligger i app_config. Oppsettet (Vault via dashboard/integrasjon,
-- app_config-verdiene) er dokumentert i `TODO.md` — IKKE lim nøkkelen inn i
-- en versjonert fil, PR, logg eller chat.
--
-- app_config er en LÅST tabell — RLS på, ingen policyer, ingen grants → verken
-- anon eller authenticated kan lese den via PostgREST. Verdiene leses KUN inne
-- i trigger-funksjonen (SECURITY DEFINER, ikke kallbar som RPC), aldri via en
-- egen hjelpefunksjon — en slik ville Postgres gitt EXECUTE til PUBLIC og
-- dermed lekket nøkkelen. (Pensjoner en ev. tidligere `cfg`-variant.)
--
-- Uten en Resend-nøkkel (verken i Vault eller app_config) gjør triggeren
-- ingenting, så delingen fungerer som før.
--
-- pg_net er ASYNKRON: `net.http_post` legger forespørselen i en kø og returnerer
-- en request-id; selve HTTP-kallet til Resend skjer FØRST etter at transaksjonen
-- committer. Triggeren kan derfor bare vite om forespørselen ble KØLAGT — den
-- kan ikke se en senere Resend-respons (HTTP 2xx/4xx/5xx) som en trigger-
-- exception. Faktisk HTTP-resultat leses fra `net._http_response` via
-- `net_request_id` (kortvarig diagnostikk — pg_net rydder responstabellen etter
-- en stund). «enqueued» betyr altså IKKE accepted/delivered/successful.

do $$ begin
  create extension if not exists pg_net with schema extensions;
exception when others then null;  -- ikke tilgjengelig i test-/lokalmiljø
end $$;

create table if not exists public.app_config (
  key   text primary key,
  value text not null
);
alter table public.app_config enable row level security;
-- Ingen RLS-policyer + ingen grants → verken anon eller authenticated kan lese
-- verdiene via PostgREST. Leses KUN inne i trigger-funksjonen under (SECURITY
-- DEFINER, ikke kallbar som RPC), aldri via en egen hjelpefunksjon. Eksplisitt
-- REVOKE også fra PUBLIC som ekstra forsvar.
revoke all on public.app_config from public, anon, authenticated;
drop function if exists public.cfg(text);

-- Minimal, LÅST loggtabell for observabilitet på KØLEGGINGEN av e-posten. Lagrer
-- ALDRI API-nøkkelen, Authorization-headeren, e-postkroppen eller mottaker-
-- adressen — kun invitasjons-id, variant, pg_net-request-id og en ev. synkron
-- kø-feilmelding. `enqueue_status` gjelder BARE om forespørselen ble lagt i
-- pg_net-køen (`enqueued`) eller feilet synkront før kølegging (`enqueue_error`)
-- — det sier INGENTING om Resend faktisk aksepterte/leverte e-posten. Det
-- faktiske HTTP-resultatet korreleres via `net_request_id` mot
-- `net._http_response` (kortvarig diagnostikk). Samme lås som app_config.
create table if not exists public.email_send_log (
  id             bigint generated always as identity primary key,
  created_at     timestamptz not null default now(),
  invite_id      uuid,
  variant        text   check (variant in ('unregistered', 'existing')),
  net_request_id bigint,        -- pg_net request-id (korreleres mot net._http_response)
  enqueue_status text not null  check (enqueue_status in ('enqueued', 'enqueue_error')),
  error          text           -- SQLERRM ved synkron kø-feil (ingen nøkkel/header/kropp/adresse)
);
alter table public.email_send_log enable row level security;
revoke all on public.email_send_log from public, anon, authenticated;

-- Enkel HTML-escaping for brukerstyrt tekst (navn) i e-postkroppen — hindrer at
-- et navn med markup rendres i mottakerens e-postklient. Ren/immutabel.
create or replace function public.html_escape(p text)
returns text language sql immutable set search_path = public as $$
  select replace(replace(replace(replace(replace(
    coalesce(p, ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), '"', '&quot;'), '''', '&#39;');
$$;

-- Robust prosent-koding (RFC 3986) for URL-parametre — byte-sikker (UTF-8), så
-- den håndterer `+`, `@`, `&`, mellomrom osv. korrekt uten manuelle replace-
-- kjeder. Ren/immutabel; leser ingen hemmeligheter, så trygg som PUBLIC.
create or replace function public.url_encode(p text)
returns text language plpgsql immutable set search_path = public as $$
declare
  bytes bytea := convert_to(coalesce(p, ''), 'UTF8');
  out   text  := '';
  b     int;
  i     int;
begin
  for i in 0 .. length(bytes) - 1 loop
    b := get_byte(bytes, i);
    if (b between 48 and 57)   -- 0-9
       or (b between 65 and 90)  -- A-Z
       or (b between 97 and 122) -- a-z
       or b in (45, 46, 95, 126) then  -- - . _ ~  (unreserved)
      out := out || chr(b);
    else
      out := out || '%' || upper(lpad(to_hex(b), 2, '0'));
    end if;
  end loop;
  return out;
end;
$$;

create or replace function public.send_invite_email()
returns trigger language plpgsql security definer
set search_path = public, extensions, net as $$
declare
  -- Fast produksjons-URL for logoen (PNG i repoet, serveres statisk). Ikke
  -- brukerstyrt → trenger ingen escaping. Kanonisk domene (uten www) — se
  -- docs/domains-and-urls.md.
  logo_url    constant text := 'https://huskis.no/assets/email/huskis-logo.png';
  api_key     text;
  from_addr   text;
  app_url     text;
  inviter     text;   -- rått inviter-navn (brukerstyrt)
  obj_name    text;   -- rått objektnavn (brukerstyrt)
  inv_e       text;   -- HTML-escaped inviter-navn
  obj_e       text;   -- HTML-escaped objektnavn
  subject     text;
  heading     text;   -- ren tekst; escapes ved HTML-innsetting
  explanation text;   -- ren tekst; escapes ved HTML-innsetting
  action_text text;   -- ren tekst; escapes ved HTML-innsetting
  variant     text;   -- 'unregistered' | 'existing' (til loggen)
  link        text;
  body_html   text;
  body_text   text;
  net_req     bigint;
begin
  -- API-nøkkel: foretrekk Supabase Vault (kryptert i ro; kun eier-rollen kan
  -- dekryptere), fall tilbake til app_config. Vault-skjemaet finnes ikke i
  -- test-/lokalmiljø → fanges her uten å velte funksjonen.
  begin
    select decrypted_secret into api_key
      from vault.decrypted_secrets where name = 'resend_api_key';
  exception when others then
    api_key := null;
  end;
  if api_key is null or api_key = '' then
    select value into api_key from public.app_config where key = 'resend_api_key';
  end if;
  -- Ikke konfigurert → ingen e-post (delingen fungerer likevel via appen).
  if api_key is null or api_key = '' then return new; end if;

  select value into from_addr from public.app_config where key = 'email_from';
  from_addr := coalesce(nullif(from_addr, ''), 'Huskis <noreply@huskis.no>');
  select value into app_url from public.app_config where key = 'app_url';
  app_url := coalesce(nullif(app_url, ''), 'https://huskis.no/');

  select display_name into inviter from public.profiles where id = new.inviter_id;
  inviter := coalesce(inviter, 'Noen');
  obj_name := coalesce(
    (select name from public.universes where id = new.universe_id),
    (select name from public.groups    where id = new.group_id),
    'noe');
  -- Brukerstyrt tekst escapes før den settes inn i HTML-kroppen (subject er ren
  -- tekst i e-post og trenger ingen escaping).
  inv_e := public.html_escape(inviter);
  obj_e := public.html_escape(obj_name);
  subject := inviter || ' har delt «' || obj_name || '» med deg på Huskis';

  if new.invitee_id is null then
    -- Uregistrert mottaker → inviter til å registrere seg. E-posten går til
    -- invitee_email selv (self-targeted), men vi prosent-koder likevel korrekt.
    variant     := 'unregistered';
    link        := app_url || '?signup=' || public.url_encode(new.invitee_email);
    heading     := 'Du er invitert til Huskis';
    explanation := 'Opprett en konto med denne e-postadressen (' ||
                   new.invitee_email ||
                   '), så dukker delingen opp i appen og du kan godta den.';
    action_text := 'Opprett konto og bli med';
  else
    -- Registrert mottaker → respekter e-postvarsel-innstillingen (standard på).
    variant := 'existing';
    if (select coalesce(raw_user_meta_data ->> 'email_notifications', 'true')
          from auth.users where id = new.invitee_id) = 'false' then
      return new;
    end if;
    link        := app_url;
    heading     := obj_name || ' er delt med deg';
    explanation := 'Åpne Huskis for å se og godta invitasjonen.';
    action_text := 'Åpne Huskis';
  end if;

  -- text/plain-variant (leveres sammen med HTML for maks kompatibilitet).
  body_text :=
    heading || E'\n\n' ||
    inviter || ' har delt «' || obj_name || '» med deg på Huskis.' || E'\n\n' ||
    explanation || E'\n\n' ||
    action_text || ': ' || link || E'\n\n' ||
    'Denne meldingen ble sendt automatisk fordi noen delte innhold med deg i ' ||
    'Huskis. Du kan ikke svare på denne adressen.' || E'\n\n' ||
    'Huskis — https://huskis.no/';

  -- Tabellbasert, inline-stylet HTML for e-postklienter (Outlook m/ bgcolor).
  -- Trygg fontstakk (ingen webfont), maks 600px, avrundede flater, ingen JS.
  body_html :=
    '<!DOCTYPE html>' ||
    '<html lang="no" xmlns="http://www.w3.org/1999/xhtml">' ||
    '<head>' ||
      '<meta charset="utf-8" />' ||
      '<meta name="viewport" content="width=device-width, initial-scale=1.0" />' ||
      '<meta http-equiv="X-UA-Compatible" content="IE=edge" />' ||
      '<meta name="color-scheme" content="light only" />' ||
      '<title>' || public.html_escape(subject) || '</title>' ||
    '</head>' ||
    '<body style="margin:0;padding:0;background-color:#667788;">' ||
      -- Preheader / forhåndsvisningstekst (skjult, men fanges opp av innboksen).
      '<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:#667788;opacity:0;">' ||
        inv_e || ' har delt «' || obj_e || '» med deg på Huskis.' ||
        '&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;' ||
      '</div>' ||
      '<table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation" bgcolor="#667788" style="width:100%;background-color:#667788;">' ||
        '<tr><td align="center" style="padding:28px 14px;">' ||
          '<table width="600" cellpadding="0" cellspacing="0" border="0" role="presentation" style="width:100%;max-width:600px;">' ||
            -- Toppbånd: logo + ordmerke på skifer-bakgrunn.
            '<tr><td bgcolor="#667788" style="background-color:#667788;padding:8px 8px 20px 8px;">' ||
              '<table cellpadding="0" cellspacing="0" border="0" role="presentation"><tr>' ||
                '<td width="56" style="width:56px;vertical-align:middle;">' ||
                  '<img src="' || logo_url || '" width="52" height="52" alt="Huskis" border="0" style="display:block;border:0;width:52px;height:52px;" />' ||
                '</td>' ||
                '<td width="12" style="width:12px;font-size:1px;line-height:1px;">&nbsp;</td>' ||
                '<td style="font-family:Arial,Helvetica,sans-serif;font-size:26px;line-height:30px;font-weight:700;color:#ffffff;vertical-align:middle;">Huskis</td>' ||
              '</tr></table>' ||
            '</td></tr>' ||
            -- Hvitt innholdskort.
            '<tr><td bgcolor="#ffffff" style="background-color:#ffffff;border-radius:18px;">' ||
              '<table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation" style="width:100%;">' ||
                '<tr><td style="padding:34px 34px 8px 34px;font-family:Arial,Helvetica,sans-serif;">' ||
                  '<p style="margin:0 0 10px 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:16px;font-weight:700;letter-spacing:1.2px;color:#4d664d;">DELINGSINVITASJON</p>' ||
                  '<h1 style="margin:0 0 18px 0;font-family:Arial,Helvetica,sans-serif;font-size:26px;line-height:33px;font-weight:700;color:#37343f;">' || public.html_escape(heading) || '</h1>' ||
                  '<p style="margin:0 0 20px 0;font-family:Arial,Helvetica,sans-serif;font-size:17px;line-height:26px;color:#37343f;"><strong>' || inv_e || '</strong> har delt noe med deg:</p>' ||
                  -- Objekt-kort (lys grønn flate, grønn venstrekant).
                  '<table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation" bgcolor="#eef3ee" style="width:100%;background-color:#eef3ee;border-radius:12px;border-left:5px solid #668866;">' ||
                    '<tr><td style="padding:16px 20px;font-family:Arial,Helvetica,sans-serif;font-size:19px;line-height:25px;font-weight:700;color:#37343f;">' || obj_e || '</td></tr>' ||
                  '</table>' ||
                  '<p style="margin:22px 0 26px 0;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:25px;color:#37343f;">' || public.html_escape(explanation) || '</p>' ||
                  -- Handlingsknapp: stylet <a> på grønn flate (Outlook: bgcolor).
                  '<table cellpadding="0" cellspacing="0" border="0" role="presentation"><tr>' ||
                    '<td bgcolor="#4d664d" style="background-color:#4d664d;border-radius:12px;">' ||
                      '<a href="' || public.html_escape(link) || '" style="display:inline-block;padding:14px 28px;font-family:Arial,Helvetica,sans-serif;font-size:17px;line-height:20px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:12px;">' || public.html_escape(action_text) || '</a>' ||
                    '</td>' ||
                  '</tr></table>' ||
                  -- Fallback-lenke for klienter som ikke rendrer knappen.
                  '<p style="margin:24px 0 0 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:18px;color:#6b6577;">Virker ikke knappen? Kopier denne adressen:<br /><a href="' || public.html_escape(link) || '" style="color:#4d664d;text-decoration:underline;word-break:break-all;">' || public.html_escape(link) || '</a></p>' ||
                '</td></tr>' ||
                -- Bunntekst.
                '<tr><td style="padding:22px 34px 30px 34px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:18px;color:#6b6577;border-top:1px solid #e3e7e3;">' ||
                  'Denne meldingen ble sendt automatisk fordi noen delte innhold med deg i Huskis. Avsenderadressen overvåkes ikke og kan ikke motta svar.' ||
                '</td></tr>' ||
              '</table>' ||
            '</td></tr>' ||
          '</table>' ||
        '</td></tr>' ||
      '</table>' ||
    '</body></html>';

  -- pg_net er asynkron: http_post legger forespørselen i køen og returnerer en
  -- request-id NÅ; selve HTTP-kallet skjer etter commit, og Resend-svaret lander
  -- senere i net._http_response. Vi logger request-id-en for korrelasjon dit.
  -- «enqueued» betyr KUN kølagt — ikke at Resend har akseptert/levert.
  select net.http_post(
    url     := 'https://api.resend.com/emails',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || api_key,
      'Content-Type',  'application/json'),
    body    := jsonb_build_object(
      'from',    from_addr,
      'to',      new.invitee_email,
      'subject', subject,
      'html',    body_html,
      'text',    body_text)
  ) into net_req;

  insert into public.email_send_log(invite_id, variant, net_request_id, enqueue_status)
  values (new.id, variant, net_req, 'enqueued');
  return new;
exception when others then
  -- E-post er en bieffekt; en SYNKRON feil her (f.eks. kølegging feiler) skal
  -- ALDRI blokkere selve delingen. Vi logger den (uten nøkkel/header/kropp/
  -- adresse) så problemet kan diagnostiseres. Merk: dette fanger IKKE en senere
  -- asynkron Resend-feil — den finnes bare i net._http_response.
  begin
    insert into public.email_send_log(invite_id, variant, enqueue_status, error)
    values (new.id, variant, 'enqueue_error', left(sqlerrm, 500));
  exception when others then null;  -- logging skal heller aldri velte delingen
  end;
  return new;
end;
$$;

-- Trigger-funksjoner er ikke kallbare via PostgREST, men vi fjerner uansett
-- PUBLIC-EXECUTE som ekstra forsvar (funksjonen leser Resend-nøkkelen).
revoke all on function public.send_invite_email() from public, anon, authenticated;

drop trigger if exists on_share_invite_created on public.share_invites;
create trigger on_share_invite_created
  after insert on public.share_invites
  for each row execute function public.send_invite_email();

-- ------------------------------------------------------------
-- 8c. SLETT EGEN KONTO
--
-- `delete_account()` sletter kontoen og alle spor av den i ÉN transaksjon.
-- Det vanskelige er ikke slettingen, men grensen mot ANDRES innhold:
--
--   * Universer som blir stående UTEN EIER når jeg er borte (typisk: der jeg
--     er eneste eier) slettes HELT — kaskaden tar grupper/lister/listepunkter,
--     og AFTER DELETE-triggerne skriver gravstein for hver rad. Også for dem
--     jeg har delt med: innholdet er mitt, og det følger kontoen.
--   * Universer/grupper med andre eiere står igjen; jeg fjernes bare som
--     medlem, nøyaktig som «Forlat».
--   * `owner_id` (OPPRETTER) på rader som overlever ARVES av en gjenværende
--     universeier. Feltet er ren historikk uten rettigheter, men FK-en er
--     `on delete cascade` — uten arven ville profilslettingen revet vekk
--     innhold i andres delte universer (et listepunkt jeg la inn i en felles
--     liste er de andres innhold like mye som mitt).
--   * `responsible` som peker på meg nulles med et stempel som er nyere enn
--     BÅDE klokka og radens eget register. `on delete set null` alene ville
--     ikke holdt: en annen enhet med det gamle valget i cachen ville vunnet
--     LWW-en og skrevet den slettede brukeren tilbake — en rad som deretter er
--     umulig å skrive (FK).
--
-- I tillegg: invitasjoner begge veier (også de som bare er adressert til
-- e-postadressen min), e-postloggen for dem, rollene mine, profilraden og til
-- slutt selve auth-brukeren. Gravsteinene blir stående — de er id-er uten
-- personopplysninger, og de er nettopp det som hindrer at en gammel klient
-- legger innholdet inn igjen ved neste synk (docs/trash.md).
--
-- Alt skjer i én transaksjon: feiler siste steg, rulles ALT tilbake. En konto
-- uten data hadde vært verre enn en sletting som ikke gikk gjennom.
-- ------------------------------------------------------------

-- En gjenværende eier av universet (aldri p_uid). Deterministisk — eldste
-- medlemskap først — så arven blir den samme hver gang.
create or replace function public.surviving_universe_owner(p_universe uuid, p_uid uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select m.user_id from public.memberships m
   where m.universe_id = p_universe and m.role = 'owner' and m.user_id <> p_uid
   order by m.created_at, m.user_id
   limit 1;
$$;

create or replace function public.delete_account()
returns void language plpgsql security definer set search_path = public as $$
declare
  uid    uuid := auth.uid();
  em     text;
  now_ms bigint := (extract(epoch from now()) * 1000)::bigint;
begin
  if uid is null then raise exception 'ikke innlogget'; end if;
  select lower(p.email) into em from public.profiles p where p.id = uid;
  if em is null then raise exception 'fant ingen profil for kontoen'; end if;

  perform set_config('huskis.privileged_op', '1', true);

  -- 1. Invitasjoner begge veier (også de som bare er adressert til e-posten min)
  --    og e-postloggen for dem. FØRST, fordi en invitasjon til et univers som
  --    slettes i neste steg forsvinner med kaskaden — da ville loggraden dens
  --    ikke lenger vært mulig å finne.
  delete from public.email_send_log l
   where l.invite_id in (select s.id from public.share_invites s
                          where s.inviter_id = uid or s.invitee_id = uid
                             or lower(s.invitee_email) = em);
  delete from public.share_invites s
   where s.inviter_id = uid or s.invitee_id = uid or lower(s.invitee_email) = em;

  -- 2. Universer jeg er knyttet til som ikke har noen eier igjen etter meg.
  delete from public.universes u
   where public.surviving_universe_owner(u.id, uid) is null
     and (u.owner_id = uid
          or exists (select 1 from public.memberships m
                      where m.universe_id = u.id and m.user_id = uid));

  -- 3. Oppretter-arv på alt som overlever (universet har nå alltid en eier).
  update public.universes u
     set owner_id = public.surviving_universe_owner(u.id, uid)
   where u.owner_id = uid;
  update public.groups g
     set owner_id = public.surviving_universe_owner(g.universe_id, uid)
   where g.owner_id = uid;
  update public.cards c
     set owner_id = public.surviving_universe_owner(public.resource_universe('card', c.id), uid)
   where c.owner_id = uid;
  update public.items i
     set owner_id = public.surviving_universe_owner(public.resource_universe('item', i.id), uid)
   where i.owner_id = uid;

  -- 4. Ansvarstildelinger som peker på meg, og rollene mine.
  --    Stempelet må slå radens EGET register, ikke bare klokka: vaktene
  --    (`*_before_update`) hopper over autorisasjonen under en privilegert
  --    operasjon, men ALDRI over `reg_newer`. En rad skrevet av en enhet med
  --    klokka foran serverens ville derfor rullet skrivingen tilbake, og
  --    FK-ens `on delete set null` hadde nullet feltet UTEN nytt stempel —
  --    hvorpå den gamle verdien vinner LWW-en ved neste synk og gjør raden
  --    uskrivbar (FK-en peker på en slettet profil).
  update public.cards set responsible = null, ts = greatest(now_ms, ts + 1), org = 'server'
   where responsible = uid;
  update public.items set responsible = null, ts = greatest(now_ms, ts + 1), org = 'server'
   where responsible = uid;
  delete from public.memberships where user_id = uid;

  -- 5. Profilen og selve kontoen.
  delete from public.profiles where id = uid;
  delete from auth.users where id = uid;

  perform set_config('huskis.privileged_op', '', true);
end;
$$;


-- ------------------------------------------------------------
-- 9. MEDLEMSLISTE — deduplisert, kategorisert og med capabilities
--
--    Kategori-presedens (en bruker vises ALDRI to ganger):
--      1 universeier  2 eksplisitt gruppeeier  3 universmedlem  4 gruppemedlem
--    Universeiere/-medlemmer vises også i GRUPPERS medlemsliste, men kan ikke
--    fjernes der (`removable = false` + forklaring) — de må fjernes fra
--    universet. Ventende invitasjoner er en EGEN seksjon og teller ikke som
--    medlemmer.
-- ------------------------------------------------------------

create or replace function public.get_members(p_type text, p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  uid  uuid := auth.uid();
  uni  uuid;
  rows jsonb;
begin
  if uid is null then raise exception 'ikke innlogget'; end if;
  if p_type not in ('universe', 'group') then
    raise exception 'kun universer og grupper har medlemslister (fikk: %)', p_type;
  end if;
  if not public.can_read(p_type, p_id, uid) then raise exception 'ingen tilgang'; end if;
  uni := public.resource_universe(p_type, p_id);

  with acc as (
    select m.user_id,
           case when m.role = 'owner' then 1 else 3 end as prec,
           case when m.role = 'owner' then 'universeOwner' else 'universeMember' end as category,
           m.role as role,
           'universe'::text as source,
           (p_type = 'universe') as direct
      from public.memberships m
     where m.universe_id = uni
    union all
    select m.user_id,
           case when m.role = 'owner' then 2 else 4 end,
           case when m.role = 'owner' then 'groupOwner' else 'groupMember' end,
           m.role, 'group'::text, true
      from public.memberships m
     where p_type = 'group' and m.group_id = p_id
  ),
  best as (
    select distinct on (user_id) * from acc order by user_id, prec
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', pr.id, 'email', pr.email, 'display_name', pr.display_name,
           'avatar', pr.avatar,
           'category', b.category, 'role', b.role, 'source', b.source,
           'direct', b.direct,
           -- Kan denne brukeren fjernes HER? Arvede universmedlemmer i en
           -- gruppes liste kan det aldri; siste universeier heller ikke.
           'removable', b.direct
             and public.can_manage_members(p_type, p_id, uid)
             and not (p_type = 'universe' and b.role = 'owner'
                      and public.universe_owner_count(p_id) <= 1),
           'removeHint', case
             when not b.direct then 'Har tilgang via universet og må fjernes der'
             when p_type = 'universe' and b.role = 'owner'
                  and public.universe_owner_count(p_id) <= 1
               then 'Siste eier kan ikke fjernes'
             else null end,
           -- Kan degraderes fra eier til vanlig medlem?
           'demotable', b.direct and b.role = 'owner'
             and public.can_manage_members(p_type, p_id, uid)
             and not (p_type = 'universe' and public.universe_owner_count(p_id) <= 1),
           -- Kan LØFTES til eier? Rolleløft settes aldri direkte — det går via
           -- en invitasjon mottakeren må godta — så flagget speiler retten til
           -- å invitere til eierskap, ikke retten til å skrive rollen.
           'promotable', b.direct and b.role = 'member'
             and public.can_invite_owner(p_type, p_id, uid)
             and not exists (select 1 from public.share_invites s
                              where s.status = 'pending' and s.role = 'owner'
                                and lower(s.invitee_email) = lower(pr.email)
                                and ((p_type = 'universe' and s.universe_id = p_id)
                                  or (p_type = 'group'    and s.group_id    = p_id)))
         ) order by b.prec, lower(coalesce(pr.display_name, pr.email))), '[]'::jsonb)
    into rows
    from best b join public.profiles pr on pr.id = b.user_id;

  return jsonb_build_object(
    'type', p_type,
    'ownerCount', case when p_type = 'universe' then public.universe_owner_count(p_id)
                       else (select count(*)::int from public.memberships m
                              where m.group_id = p_id and m.role = 'owner') end,
    'memberCount', case when p_type = 'universe' then public.universe_member_count(p_id)
                        else public.group_member_count(p_id) end,
    -- Betrakterens EFFEKTIVE rettigheter (serverautoritativt) — klienten viser
    -- invitasjonsfelt/administrative kontroller ut fra disse, ikke ut fra gjetting.
    'viewer', jsonb_build_object(
      'id', uid,
      'role', case when p_type = 'universe' then public.universe_role(p_id, uid)
                   else public.group_role(p_id, uid) end,
      'caps', case when p_type = 'universe' then public.universe_caps(p_id, uid)
                   else public.group_caps(p_id, uid) end),
    'invitePolicy', case when p_type = 'universe'
                         then (select invite_policy from public.universes where id = p_id)
                         else (select invite_policy from public.groups where id = p_id) end,
    'inviteEffective', public.effective_invite_policy(p_type, p_id),
    'members', rows,
    'pendingInvites', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', s.id, 'email', s.invitee_email, 'role', s.role,
               'created_at', s.created_at, 'by', s.inviter_id,
               'by_name', (select display_name from public.profiles where id = s.inviter_id),
               'mine', s.inviter_id = uid) order by s.created_at)
      from public.share_invites s
      where s.status = 'pending'
        and ((p_type = 'universe' and s.universe_id = p_id)
          or (p_type = 'group'    and s.group_id    = p_id))
    ), '[]'::jsonb)
  );
end;
$$;

-- ------------------------------------------------------------
-- 9b. get_my_doc() — hele brukerens datasett som ett flatt doc
--     * universer brukeren har en rolle i (eier ELLER medlem)
--     * grupper i disse universene PLUSS direkte delte grupper med hele
--       undertreet — også når det kanoniske universet IKKE er lesbart
--       (`free = true`; universets navn/medlemsliste lekkes aldri)
--     * personlig rekkefølge, roller, capabilities og invitasjoner
-- ------------------------------------------------------------

create or replace function public.get_my_doc()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  result jsonb;
begin
  if uid is null then raise exception 'ikke innlogget'; end if;

  with my_universes as (
    select u.*, m.role as my_role, m.pos as personal_pos
    from public.universes u
    join public.memberships m on m.universe_id = u.id and m.user_id = uid
  ),
  my_groups as (
    select g.*, gm.role as direct_role, gm.pos as personal_pos,
           (mu.id is null) as free
    from public.groups g
    left join my_universes mu on mu.id = g.universe_id
    left join public.memberships gm on gm.group_id = g.id and gm.user_id = uid
    where mu.id is not null or gm.id is not null
  ),
  my_cards as (
    select c.* from public.cards c where c.group_id in (select id from my_groups)
  ),
  my_items as (
    select i.* from public.items i where i.card_id in (select id from my_cards)
  )
  select jsonb_build_object(
    'user', (select jsonb_build_object('id', pr.id, 'email', pr.email,
                                       'display_name', pr.display_name)
             from public.profiles pr where pr.id = uid),
    'universes', coalesce((select jsonb_agg(jsonb_build_object(
        'id', u.id, 'creator', u.owner_id, 'createdByMe', u.owner_id = uid,
        'role', u.my_role, 'personalPos', u.personal_pos,
        'name', u.name, 'trashed', u.trashed, 'locked', u.locked, 'unlocked', u.unlocked,
        'collapsed', u.collapsed,
        'invitePolicy', u.invite_policy,
        'ts', u.ts, 'org', u.org,
        'pos', u.pos, 'posTs', u.pos_ts, 'posOrg', u.pos_org,
        'ownerCount', public.universe_owner_count(u.id),
        -- Eierskapsdomenet som én sammenlignbar nøkkel: klienten bruker den til å
        -- vite OM en gruppeflytting krysser domenegrensen (og dermed må bekreftes)
        -- før den kaller move_group. Ingen ny informasjon — medlemslisten er
        -- allerede synlig for alle med tilgang.
        'ownerKey', array_to_string(public.universe_owner_set(u.id), ','),
        'memberCount', public.universe_member_count(u.id),
        'shared', public.universe_member_count(u.id) > 1,
        'caps', public.universe_caps(u.id, uid))) from my_universes u), '[]'::jsonb),
    'groups', coalesce((select jsonb_agg(jsonb_build_object(
        'id', g.id, 'creator', g.owner_id, 'createdByMe', g.owner_id = uid,
        'uni', g.universe_id, 'free', g.free,
        'role', g.direct_role, 'personalPos', g.personal_pos,
        'name', g.name, 'trashed', g.trashed, 'locked', g.locked, 'unlocked', g.unlocked,
        'cat', g.cat_id, 'isCat', g.is_cat, 'collapsed', g.collapsed,
        'invitePolicy', g.invite_policy,
        'ts', g.ts, 'org', g.org,
        'pos', g.pos, 'posTs', g.pos_ts, 'posOrg', g.pos_org,
        'memberCount', public.group_member_count(g.id),
        'shared', public.group_member_count(g.id) > 1,
        'caps', public.group_caps(g.id, uid))) from my_groups g), '[]'::jsonb),
    'cards', coalesce((select jsonb_agg(jsonb_build_object(
        'id', c.id, 'creator', c.owner_id, 'createdByMe', c.owner_id = uid,
        'group', c.group_id,
        'title', c.title, 'trashed', c.trashed, 'locked', c.locked, 'unlocked', c.unlocked,
        'k', c.k, 'p', c.p, 'labTs', c.lab_ts, 'labOrg', c.lab_org,
        'responsible', c.responsible,
        'start', c.start_at, 'due', c.due_at, 'lockTimes', c.lock_times,
        'collapsed', c.collapsed,
        'ts', c.ts, 'org', c.org,
        'pos', c.pos, 'posTs', c.pos_ts, 'posOrg', c.pos_org)) from my_cards c), '[]'::jsonb),
    'items', coalesce((select jsonb_agg(jsonb_build_object(
        'id', i.id, 'creator', i.owner_id, 'createdByMe', i.owner_id = uid,
        'home', i.card_id, 'cat', i.cat_id, 'isCat', i.is_cat, 'lockTimes', i.lock_times,
        'collapsed', i.collapsed,
        'text', i.text, 'trashed', i.trashed, 'done', i.done,
        'responsible', i.responsible,
        'start', i.start_at, 'due', i.due_at,
        'ts', i.ts, 'org', i.org,
        'pos', i.pos, 'posTs', i.pos_ts, 'posOrg', i.pos_org)) from my_items i), '[]'::jsonb),
    'invites_in', coalesce((select jsonb_agg(jsonb_build_object(
        'id', s.id,
        'type', case when s.universe_id is not null then 'universe' else 'group' end,
        'role', s.role,
        'name', coalesce((select name from public.universes where id = s.universe_id),
                         (select name from public.groups    where id = s.group_id)),
        'from', (select email from public.profiles where id = s.inviter_id),
        'from_name', (select display_name from public.profiles where id = s.inviter_id),
        'created_at', s.created_at) order by s.created_at)
      from public.share_invites s
      where s.status = 'pending'
        and (s.universe_id is not null or s.group_id is not null)
        and (s.invitee_id = uid
             or lower(s.invitee_email) = (select lower(email) from public.profiles where id = uid))), '[]'::jsonb),
    'invites_out', coalesce((select jsonb_agg(jsonb_build_object(
        'id', s.id,
        'type', case when s.universe_id is not null then 'universe' else 'group' end,
        'role', s.role,
        'target_id', coalesce(s.universe_id, s.group_id),
        'email', s.invitee_email, 'created_at', s.created_at) order by s.created_at)
      from public.share_invites s
      where s.status = 'pending' and s.inviter_id = uid
        and (s.universe_id is not null or s.group_id is not null)), '[]'::jsonb)
  ) into result;

  return result;
end;
$$;

-- ------------------------------------------------------------
-- 9c. move_group() — ATOMISK flytting av en gruppe
--
--   * samme univers        → ren omplassering (delt posisjon + gruppekategori)
--   * samme EIERSKAPSDOMENE (identisk sett universeiere) → ekte REPARENTING:
--     alle id-er, roller, direkte medlemmer, invitasjoner, innhold og låser
--     består; kun universe_id/kategori/posisjon endres.
--   * ULIKT domene        → KOPIER-OG-SLETT: nytt undertre med NYE id-er i
--     måluniverset (aktøren blir oppretter og eksplisitt gruppeeier), gamle
--     roller/medlemmer/invitasjoner følger IKKE med, og det gamle treet slettes
--     permanent i samme transaksjon (gravsteiner for hver eneste gamle id).
--
--   Rettigheter kontrolleres på nytt inne i transaksjonen: destruktiv myndighet
--   i KILDEN (can_move_group) + opprettelsesrett i MÅLET (can_create_child).
--   Radene låses (`for update`) så to samtidige flyttinger/slettinger
--   serialiseres. Returnerer { mode, group, mapping } — mappingen lar klienten
--   bytte den optimistiske visningen uten flimring.
-- ------------------------------------------------------------

create or replace function public.move_group(
  p_group uuid, p_universe uuid, p_cat uuid default null,
  p_pos double precision default 0)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid      uuid := auth.uid();
  g        public.groups;
  src_uni  uuid;
  now_ms   bigint := (extract(epoch from now()) * 1000)::bigint;
  mapping  jsonb := '{}'::jsonb;
  new_gid  uuid;
  src_card record;
  src_item record;
  new_cid  uuid;
  new_iid  uuid;
  mode     text;
begin
  if uid is null then raise exception 'ikke innlogget'; end if;

  select * into g from public.groups where id = p_group for update;
  if g.id is null then raise exception 'gruppen finnes ikke'; end if;
  if g.is_cat then raise exception 'en gruppekategori kan ikke flyttes til et annet univers'; end if;
  src_uni := g.universe_id;

  if not exists (select 1 from public.universes where id = p_universe) then
    raise exception 'måluniverset finnes ikke';
  end if;
  -- Lås begge universene i stabil rekkefølge (unngår vranglås ved to samtidige
  -- flyttinger i motsatt retning).
  perform 1 from public.universes u where u.id in (src_uni, p_universe)
    order by u.id for update;

  if p_cat is not null and not exists (
    select 1 from public.groups gc where gc.id = p_cat and gc.is_cat and gc.universe_id = p_universe) then
    raise exception 'ugyldig gruppekategori for måluniverset';
  end if;

  -- ---- Samme univers: ren omplassering (delt posisjon), ikke en flytting ----
  if src_uni = p_universe then
    if not public.can_reorder_in_parent('group', p_group, uid) then
      raise exception 'mangler myndighet til å endre rekkefølgen i universet';
    end if;
    update public.groups
       set cat_id = p_cat, pos = p_pos, pos_ts = now_ms, pos_org = 'server'
     where id = p_group;
    return jsonb_build_object('mode', 'reorder', 'group', p_group, 'mapping', mapping);
  end if;

  if not public.can_move_group(p_group, uid) then
    raise exception 'mangler myndighet til å flytte gruppen ut av universet';
  end if;
  if not public.can_create_child('universe', p_universe, uid) then
    raise exception 'mangler myndighet til å opprette grupper i måluniverset';
  end if;

  -- ---- Samme eierskapsdomene: ekte reparenting ----
  if public.universe_owner_set(src_uni) = public.universe_owner_set(p_universe) then
    perform set_config('huskis.privileged_op', '1', true);
    update public.groups
       set universe_id = p_universe, cat_id = p_cat,
           pos = p_pos, pos_ts = now_ms, pos_org = 'server'
     where id = p_group;
    -- Ansvarstildelinger til noen som ikke lenger har effektiv tilgang nullstilles.
    update public.cards set responsible = null, ts = now_ms, org = 'server'
     where group_id = p_group and responsible is not null
       and not public.is_group_member(p_group, responsible);
    update public.items set responsible = null, ts = now_ms, org = 'server'
     where responsible is not null
       and card_id in (select id from public.cards where group_id = p_group)
       and not public.is_group_member(p_group, responsible);
    perform set_config('huskis.privileged_op', '', true);
    return jsonb_build_object('mode', 'reparent', 'group', p_group, 'mapping', mapping);
  end if;

  -- ---- Ulikt eierskapsdomene: kopier-og-slett ----
  mode := 'copy';
  new_gid := gen_random_uuid();
  mapping := mapping || jsonb_build_object(p_group::text, new_gid::text);

  insert into public.groups (id, owner_id, universe_id, cat_id, is_cat, name, trashed,
                             locked, unlocked, collapsed, invite_policy,
                             ts, org, pos, pos_ts, pos_org)
  values (new_gid, uid, p_universe, p_cat, false, g.name, g.trashed,
          g.locked, g.unlocked, g.collapsed, g.invite_policy,
          now_ms, 'server', p_pos, now_ms, 'server');

  for src_card in select * from public.cards where group_id = p_group order by pos loop
    new_cid := gen_random_uuid();
    mapping := mapping || jsonb_build_object(src_card.id::text, new_cid::text);
    insert into public.cards (id, owner_id, group_id, title, trashed, locked, unlocked,
                              k, p, responsible, start_at, due_at, lock_times, collapsed,
                              ts, org, lab_ts, lab_org, pos, pos_ts, pos_org)
    values (new_cid, uid, new_gid, src_card.title, src_card.trashed, src_card.locked, src_card.unlocked,
            src_card.k, src_card.p,
            case when src_card.responsible is not null and public.is_group_member(new_gid, src_card.responsible)
                 then src_card.responsible end,
            src_card.start_at, src_card.due_at, src_card.lock_times, src_card.collapsed,
            now_ms, 'server', now_ms, 'server', src_card.pos, now_ms, 'server');
  end loop;

  -- Kategorier først, så leaf-radene: `cat_id` peker på en kategori i SAMME
  -- tabell, og mappingen må være kjent når leaf-raden settes inn.
  for src_item in select * from public.items
            where card_id in (select id from public.cards where group_id = p_group)
            order by is_cat desc, pos loop
    new_iid := gen_random_uuid();
    mapping := mapping || jsonb_build_object(src_item.id::text, new_iid::text);
    insert into public.items (id, owner_id, card_id, cat_id, is_cat, lock_times, collapsed,
                              text, trashed, done, responsible, start_at, due_at,
                              ts, org, pos, pos_ts, pos_org)
    values (new_iid, uid,
            (mapping ->> src_item.card_id::text)::uuid,
            case when src_item.cat_id is null then null else (mapping ->> src_item.cat_id::text)::uuid end,
            src_item.is_cat, src_item.lock_times, src_item.collapsed,
            src_item.text, src_item.trashed, src_item.done,
            case when src_item.responsible is not null and public.is_group_member(new_gid, src_item.responsible)
                 then src_item.responsible end,
            src_item.start_at, src_item.due_at,
            now_ms, 'server', src_item.pos, now_ms, 'server');
  end loop;

  -- Det gamle treet slettes PERMANENT: kaskaden fjerner lister, listepunkter,
  -- roller og ventende invitasjoner, og AFTER DELETE-triggerne skriver gravstein
  -- for hver eneste gamle id — så en gammel offline-klient aldri kan gjenopplive
  -- innholdet i det gamle domenet.
  delete from public.groups where id = p_group;

  return jsonb_build_object('mode', mode, 'group', new_gid, 'mapping', mapping);
end;
$$;
-- ------------------------------------------------------------
-- 10. import_doc(p_doc) — migrering av dagens (lokale) doc inn som
--     den innloggede brukerens egne data. Klienten normaliserer
--     doc-et først (samme migreringssteg som i dag) og sender
--     { universes, groups, cards, items } med gamle tekst-id-er.
--     Id-ene mappes deterministisk per bruker
--     (md5(uid || ':' || gammel_id) -> uuid), så re-kjøring er
--     idempotent og to brukere som importerer samme delte doc får
--     hver sin uavhengige kopi. Foreldreløse hopper over (som i
--     applyDoc). Gjenkjøring oppdaterer via LWW-triggerne.
-- ------------------------------------------------------------

create or replace function public.legacy_uuid(p_uid uuid, p_old text)
returns uuid language sql immutable as $$
  select md5(p_uid::text || ':' || p_old)::uuid;
$$;

create or replace function public.import_doc(p_doc jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  r jsonb;
  n_uni int := 0; n_grp int := 0; n_card int := 0; n_item int := 0;
begin
  if uid is null then raise exception 'ikke innlogget'; end if;
  -- Importen skriver forelder-pekere direkte; move_group-vakten skal ikke slå
  -- inn på brukerens egen migrering av lokale data.
  perform set_config('huskis.privileged_op', '1', true);

  -- Importen er en EKSPLISITT handling fra brukeren selv, på id-er som er
  -- utledet av brukerens egen uid (legacy_uuid) — altså ingen andres data. Har
  -- brukeren tidligere slettet noe av dette permanent, ville insert-vakten
  -- blokkert hele importen; vi fjerner derfor gravsteinene for nøyaktig de
  -- id-ene importen skriver, og bare dem. (Dette er den ENESTE veien en
  -- gravstein fjernes automatisk — synken kan det aldri.)
  delete from public.tombstones t
   using (
     select public.legacy_uuid(uid, x ->> 'id') as id
       from jsonb_array_elements(coalesce(p_doc -> 'universes', '[]'::jsonb)) x
     union all
     select public.legacy_uuid(uid, x ->> 'id')
       from jsonb_array_elements(coalesce(p_doc -> 'groups', '[]'::jsonb)) x
     union all
     select public.legacy_uuid(uid, x ->> 'id')
       from jsonb_array_elements(coalesce(p_doc -> 'cards', '[]'::jsonb)) x
     union all
     select public.legacy_uuid(uid, x ->> 'id')
       from jsonb_array_elements(coalesce(p_doc -> 'items', '[]'::jsonb)) x
   ) imported
   where t.resource_id = imported.id;

  for r in select * from jsonb_array_elements(coalesce(p_doc -> 'universes', '[]'::jsonb)) loop
    insert into public.universes as t (id, owner_id, name, trashed, collapsed, ts, org, pos, pos_ts, pos_org)
    values (public.legacy_uuid(uid, r ->> 'id'), uid,
            coalesce(r ->> 'name', ''), coalesce((r ->> 'trashed')::boolean, false),
            coalesce((r ->> 'collapsed')::boolean, false),
            coalesce((r ->> 'ts')::bigint, 0), coalesce(r ->> 'org', ''),
            coalesce((r ->> 'pos')::double precision, 0),
            coalesce((r ->> 'posTs')::bigint, 0), coalesce(r ->> 'posOrg', ''))
    on conflict (id) do update
      set name = excluded.name, trashed = excluded.trashed, collapsed = excluded.collapsed,
          ts = excluded.ts, org = excluded.org,
          pos = excluded.pos, pos_ts = excluded.pos_ts, pos_org = excluded.pos_org
      where t.owner_id = uid;
    n_uni := n_uni + 1;
  end loop;

  for r in select * from jsonb_array_elements(coalesce(p_doc -> 'groups', '[]'::jsonb)) loop
    continue when not exists (
      select 1 from public.universes u
      where u.id = public.legacy_uuid(uid, r ->> 'uni')
        and public.is_universe_owner(u.id, uid));
    insert into public.groups as t (id, owner_id, universe_id, cat_id, is_cat, name, trashed,
                                    collapsed, ts, org, pos, pos_ts, pos_org)
    values (public.legacy_uuid(uid, r ->> 'id'), uid, public.legacy_uuid(uid, r ->> 'uni'),
            case when r ->> 'cat' is null then null else public.legacy_uuid(uid, r ->> 'cat') end,
            coalesce((r ->> 'isCat')::boolean, false),
            coalesce(r ->> 'name', ''), coalesce((r ->> 'trashed')::boolean, false),
            coalesce((r ->> 'collapsed')::boolean, false),
            coalesce((r ->> 'ts')::bigint, 0), coalesce(r ->> 'org', ''),
            coalesce((r ->> 'pos')::double precision, 0),
            coalesce((r ->> 'posTs')::bigint, 0), coalesce(r ->> 'posOrg', ''))
    on conflict (id) do update
      set universe_id = excluded.universe_id, cat_id = excluded.cat_id,
          is_cat = excluded.is_cat, name = excluded.name,
          trashed = excluded.trashed, collapsed = excluded.collapsed,
          ts = excluded.ts, org = excluded.org,
          pos = excluded.pos, pos_ts = excluded.pos_ts, pos_org = excluded.pos_org
      where t.owner_id = uid;
    n_grp := n_grp + 1;
  end loop;

  for r in select * from jsonb_array_elements(coalesce(p_doc -> 'cards', '[]'::jsonb)) loop
    continue when not exists (
      select 1 from public.groups g
      where g.id = public.legacy_uuid(uid, r ->> 'group')
        and public.is_group_owner(g.id, uid));
    insert into public.cards as t (id, owner_id, group_id, title, trashed, k, p,
                                   start_at, due_at, lock_times, collapsed,
                                   ts, org, lab_ts, lab_org, pos, pos_ts, pos_org)
    values (public.legacy_uuid(uid, r ->> 'id'), uid, public.legacy_uuid(uid, r ->> 'group'),
            coalesce(r ->> 'title', ''), coalesce((r ->> 'trashed')::boolean, false),
            coalesce((r ->> 'k')::boolean, true), coalesce((r ->> 'p')::boolean, true),
            r ->> 'start', r ->> 'due', coalesce((r ->> 'lockTimes')::boolean, false),
            coalesce((r ->> 'collapsed')::boolean, false),
            coalesce((r ->> 'ts')::bigint, 0), coalesce(r ->> 'org', ''),
            coalesce((r ->> 'labTs')::bigint, 0), coalesce(r ->> 'labOrg', ''),
            coalesce((r ->> 'pos')::double precision, 0),
            coalesce((r ->> 'posTs')::bigint, 0), coalesce(r ->> 'posOrg', ''))
    on conflict (id) do update
      set group_id = excluded.group_id, title = excluded.title,
          trashed = excluded.trashed, k = excluded.k, p = excluded.p,
          start_at = excluded.start_at, due_at = excluded.due_at,
          lock_times = excluded.lock_times, collapsed = excluded.collapsed,
          ts = excluded.ts, org = excluded.org,
          lab_ts = excluded.lab_ts, lab_org = excluded.lab_org,
          pos = excluded.pos, pos_ts = excluded.pos_ts, pos_org = excluded.pos_org
      where t.owner_id = uid;
    n_card := n_card + 1;
  end loop;

  for r in select * from jsonb_array_elements(coalesce(p_doc -> 'items', '[]'::jsonb)) loop
    continue when not exists (
      select 1 from public.cards c
      where c.id = public.legacy_uuid(uid, r ->> 'home') and c.owner_id = uid);
    insert into public.items as t (id, owner_id, card_id, cat_id, is_cat, lock_times, collapsed, text, trashed, done,
                                   start_at, due_at, ts, org, pos, pos_ts, pos_org)
    values (public.legacy_uuid(uid, r ->> 'id'), uid, public.legacy_uuid(uid, r ->> 'home'),
            case when r ->> 'cat' is null then null else public.legacy_uuid(uid, r ->> 'cat') end,
            coalesce((r ->> 'isCat')::boolean, false), coalesce((r ->> 'lockTimes')::boolean, false),
            coalesce((r ->> 'collapsed')::boolean, false),
            coalesce(r ->> 'text', ''), coalesce((r ->> 'trashed')::boolean, false),
            coalesce((r ->> 'done')::boolean, false),
            r ->> 'start', r ->> 'due',
            coalesce((r ->> 'ts')::bigint, 0), coalesce(r ->> 'org', ''),
            coalesce((r ->> 'pos')::double precision, 0),
            coalesce((r ->> 'posTs')::bigint, 0), coalesce(r ->> 'posOrg', ''))
    on conflict (id) do update
      set card_id = excluded.card_id, cat_id = excluded.cat_id,
          is_cat = excluded.is_cat, lock_times = excluded.lock_times, collapsed = excluded.collapsed,
          text = excluded.text,
          trashed = excluded.trashed, done = excluded.done,
          start_at = excluded.start_at, due_at = excluded.due_at,
          ts = excluded.ts, org = excluded.org,
          pos = excluded.pos, pos_ts = excluded.pos_ts, pos_org = excluded.pos_org
      where t.owner_id = uid;
    n_item := n_item + 1;
  end loop;

  perform set_config('huskis.privileged_op', '', true);
  return jsonb_build_object('universes', n_uni, 'groups', n_grp,
                            'cards', n_card, 'items', n_item);
end;
$$;

-- ------------------------------------------------------------
-- 11. MIGRERING AV EKSISTERENDE DATA
--
--   11a. ROLLER: oppretteren av et univers blir universeier; oppretteren av en
--        gruppe blir eksplisitt gruppeeier (med mindre vedkommende allerede er
--        universeier). Eksisterende direkte medlemskap blir vanlige roller.
--        Kjøres ÉN gang (migration_log): en re-kjøring ville gjeninnsatt en
--        rolle som senere er fjernet med vilje.
--
--   11b. LISTEDELINGER: direkte deling av lister finnes ikke lenger. Hver liste
--        med direkte medlemmer/invitasjoner migreres slik at NØYAKTIG den
--        tidligere effektive tilgangen bevares — uten at noen får tilgang til
--        søskenlister de ikke kunne lese før. Trinnene følger
--        docs/rettigheter-og-deling.md. Naturlig idempotent: etter kjøringen
--        finnes ingen rader med card_id, så en re-kjøring gjør ingenting.
-- ------------------------------------------------------------

do $$
begin
  if exists (select 1 from public.migration_log where key = 'roles_backfill_v1') then return; end if;
  perform set_config('huskis.privileged_op', '1', true);

  -- Universeier = universets oppretter.
  insert into public.memberships (user_id, universe_id, role, pos)
  select u.owner_id, u.id, 'owner', u.pos from public.universes u
  on conflict (universe_id, user_id) where universe_id is not null
    do update set role = 'owner';

  -- Eksplisitt gruppeeier = gruppens oppretter, med mindre rollen alt er arvet
  -- som universeier (da ville raden bare duplisert medlemslisten).
  insert into public.memberships (user_id, group_id, role, pos)
  select g.owner_id, g.id, 'owner', g.pos from public.groups g
   where not exists (select 1 from public.memberships m
                      where m.universe_id = g.universe_id
                        and m.user_id = g.owner_id and m.role = 'owner')
  on conflict (group_id, user_id) where group_id is not null
    do update set role = 'owner';

  -- Dedupliser: et direkte gruppemedlemskap er overflødig når brukeren allerede
  -- har en universrolle (tilgangen er da arvet).
  delete from public.memberships m
   where m.group_id is not null and m.role = 'member'
     and exists (select 1 from public.memberships um
                 join public.groups g on g.id = m.group_id
                 where um.universe_id = g.universe_id and um.user_id = m.user_id);

  insert into public.migration_log(key) values ('roles_backfill_v1');
  perform set_config('huskis.privileged_op', '', true);
end $$;

do $$
declare
  c        record;
  g        public.groups;
  u        uuid;
  target   uuid;
  n_active int;
  new_gid  uuid;
  base_nm  text;
  nm       text;
  k        int;
  now_ms   bigint := (extract(epoch from now()) * 1000)::bigint;
begin
  if not exists (select 1 from public.memberships where card_id is not null)
     and not exists (select 1 from public.share_invites where card_id is not null) then
    return;
  end if;
  perform set_config('huskis.privileged_op', '1', true);

  for c in
    select ca.* from public.cards ca
     where exists (select 1 from public.memberships m where m.card_id = ca.id)
        or exists (select 1 from public.share_invites s where s.card_id = ca.id and s.status = 'pending')
     order by ca.id
  loop
    select * into g from public.groups where id = c.group_id;
    continue when g.id is null;
    u := g.universe_id;

    -- (1+2) Redundante listetilganger: mottakeren har allerede gruppetilgang.
    delete from public.memberships m
     where m.card_id = c.id and public.is_group_member(g.id, m.user_id);
    update public.share_invites s set status = 'revoked', responded_at = now()
     where s.card_id = c.id and s.status = 'pending'
       and s.invitee_id is not null and public.is_group_member(g.id, s.invitee_id);

    if not exists (select 1 from public.memberships where card_id = c.id)
       and not exists (select 1 from public.share_invites where card_id = c.id and status = 'pending') then
      continue;
    end if;

    -- Finnes det en ANNEN aktiv liste i gruppen? Det — ikke antallet aktive
    -- lister — avgjør om promotering er trygt: er `c` selv i søpla mens en annen
    -- liste er aktiv, ville promotering gitt mottakerne tilgang til nettopp den
    -- søskenlista de ikke kunne lese før.
    select count(*) into n_active
      from public.cards where group_id = g.id and not trashed and id <> c.id;

    if n_active = 0 then
      -- (3) Ingen andre aktive lister i gruppen: løft mottakerne til DIREKTE
      --     gruppemedlemmer. Lista blir liggende, og framtidige lister i gruppen
      --     deles etter den nye modellen med de samme folkene.
      target := g.id;
    else
      -- (4) Det finnes andre aktive lister: splitt ut en ny søskengruppe for
      --     NØYAKTIG denne lista, så mottakerne ikke får se søsknene. Samme
      --     univers, samme gruppekategori, rett ved siden av den gamle gruppen.
      base_nm := coalesce(nullif(btrim(c.title), ''), 'Delt liste');
      nm := base_nm; k := 1;
      while exists (select 1 from public.groups x
                     where x.universe_id = u and x.name = nm and not x.is_cat) loop
        k := k + 1; nm := base_nm || ' (' || k || ')';
      end loop;
      new_gid := gen_random_uuid();
      insert into public.groups (id, owner_id, universe_id, cat_id, is_cat, name,
                                 ts, org, pos, pos_ts, pos_org)
      values (new_gid, c.owner_id, u, g.cat_id, false, nm,
              now_ms, 'migration', g.pos + 0.5, now_ms, 'migration');
      update public.cards set group_id = new_gid, pos_ts = now_ms, pos_org = 'migration'
       where id = c.id;
      -- De som hadde tilgang til den gamle gruppen DIREKTE (ikke via universet)
      -- beholder tilgangen til lista — med samme rolle som før.
      insert into public.memberships (user_id, group_id, role, pos)
      select m.user_id, new_gid, m.role, m.pos
        from public.memberships m
       where m.group_id = g.id
         and not exists (select 1 from public.memberships um
                          where um.universe_id = u and um.user_id = m.user_id)
      on conflict (group_id, user_id) where group_id is not null do nothing;
      target := new_gid;
    end if;

    -- Direkte listemedlemmer → direkte gruppemedlemmer i målgruppen.
    insert into public.memberships (user_id, group_id, role, pos)
    select m.user_id, target, 'member', m.pos
      from public.memberships m where m.card_id = c.id
    on conflict (group_id, user_id) where group_id is not null do nothing;

    -- Ventende listeinvitasjoner → gruppeinvitasjoner. En adresse som allerede
    -- har en ventende invitasjon til målgruppen ville brutt unik-indeksen, så
    -- den trekkes tilbake i stedet (invitasjonen finnes jo allerede).
    update public.share_invites s set status = 'revoked', responded_at = now()
     where s.card_id = c.id and s.status = 'pending'
       and exists (select 1 from public.share_invites t
                    where t.group_id = target and t.status = 'pending'
                      and lower(t.invitee_email) = lower(s.invitee_email));
    update public.share_invites s set group_id = target, card_id = null
     where s.card_id = c.id and s.status = 'pending';

    delete from public.memberships where card_id = c.id;
  end loop;

  -- Rester: ikke-ventende listeinvitasjoner (avslått/tilbaketrukket/akseptert)
  -- og eventuelle medlemskap på lister uten gruppe. `card_id` skal være tomt
  -- overalt etter migreringen.
  delete from public.memberships where card_id is not null;
  update public.share_invites
     set card_id = null,
         status = case when status = 'pending' then 'revoked' else status end,
         responded_at = coalesce(responded_at, now())
   where card_id is not null;

  perform set_config('huskis.privileged_op', '', true);
end $$;

-- Mount-kolonnene er pensjonert: mottakeren velger ikke lenger sin egen
-- forelder for delt innhold (en gruppe har alltid ett kanonisk univers), og
-- «forlat» erstatter mottakerens egen søppelkasse for selve delingen.
alter table public.memberships drop column if exists parent_universe_id;
alter table public.memberships drop column if exists parent_group_id;
alter table public.memberships drop column if exists trashed;

-- Lister deles ikke: databasen avviser nye medlemskap og invitasjoner på
-- listenivå — også fra en gammel klient, en modifisert klient eller et rått
-- PostgREST-kall. (Kolonnen står igjen så migreringen over er re-kjørbar.)
do $$ begin
  alter table public.memberships add constraint memberships_no_card_chk check (card_id is null);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.share_invites add constraint share_invites_no_card_chk check (card_id is null);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.memberships add constraint memberships_target_chk
    check (num_nonnulls(universe_id, group_id) = 1);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.share_invites add constraint share_invites_target_chk
    check (num_nonnulls(universe_id, group_id) = 1);
exception when duplicate_object then null; end $$;

drop index if exists public.memberships_card_user_key;
drop index if exists public.share_invites_card_pending_key;

-- ------------------------------------------------------------
-- 12. RETTIGHETER — alt er kun for innloggede (authenticated);
--     anon har ingen tilgang.
-- ------------------------------------------------------------

revoke all on public.profiles, public.universes, public.groups, public.cards,
              public.items, public.memberships, public.share_invites,
              public.tombstones from anon;

-- profiles: e-posten speiles KUN fra auth.users (triggerne over) og er
-- skrivebeskyttet for klienter — ellers kunne en bruker kapre ventende
-- invitasjoner (aksept sammenligner mot profiles.email) eller blokkere
-- andres registrering via unik-indeksen. Kun display_name og avatar kan endres.
grant select on public.profiles to authenticated;
revoke update on public.profiles from authenticated;
grant update (display_name, avatar) on public.profiles to authenticated;
grant select, insert, update, delete on public.universes, public.groups,
                                        public.cards, public.items to authenticated;
-- INSERT på memberships er BEVISST utelatt: roller opprettes kun av
-- SECURITY DEFINER-veiene (aksept av invitasjon + opprettelses-triggerne).
grant select, update, delete on public.memberships to authenticated;
grant select, delete on public.share_invites to authenticated;
grant select on public.tombstones to authenticated;

do $$
declare fn text;
begin
  foreach fn in array array[
    'public.create_share_invite(text, uuid, text, text)',
    'public.accept_share_invite(uuid, uuid, double precision)',
    'public.decline_share_invite(uuid)',
    'public.revoke_share_invite(uuid)',
    'public.revoke_share(text, uuid, uuid)',
    'public.set_member_role(text, uuid, uuid, text)',
    'public.leave_share(text, uuid)',
    'public.set_locked(text, uuid, boolean)',
    'public.set_unlocked(text, uuid, boolean)',
    'public.set_invite_policy(text, uuid, text)',
    'public.get_members(text, uuid)',
    'public.get_my_doc()',
    'public.move_group(uuid, uuid, uuid, double precision)',
    'public.import_doc(jsonb)',
    'public.delete_account()'
  ] loop
    execute format('revoke execute on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
end $$;

-- Interne hjelpere skal ikke kunne kalles som RPC (de utfører privilegerte
-- opprydninger uten egen autorisasjonssjekk — kallerne kontrollerer myndighet).
revoke all on function public.purge_universe_access(uuid, uuid) from public, anon, authenticated;
revoke all on function public.purge_group_access(uuid, uuid) from public, anon, authenticated;

-- ------------------------------------------------------------
-- 13. REALTIME — legg tabellene i supabase_realtime-publikasjonen.
--     Hoppes over utenfor Supabase (ingen slik publikasjon).
-- ------------------------------------------------------------

do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['universes', 'groups', 'cards', 'items',
                             'memberships', 'share_invites'] loop
      if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
      ) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;

-- ------------------------------------------------------------
-- 14. ENGANGS-SEED: navn på de to første kontoene
--     Navn (fornavn + etternavn) ble innført etter at disse to kontoene
--     allerede fantes; nye brukere legger inn navn ved registrering.
--     Setter KUN navnet hvis det fortsatt er auto-standarden (e-post-
--     prefiksen eller tomt), så en manuelt endret display_name aldri
--     overskrives ved re-kjøring, og hopper stille over hvis kontoen
--     ikke finnes ennå.
-- ------------------------------------------------------------

update public.profiles set display_name = 'Karin Falch', updated_at = now()
 where lower(email) = 'kvfalch@gmail.com'
   and coalesce(display_name, '') in ('', split_part(email, '@', 1));
update public.profiles set display_name = 'Peder Holman', updated_at = now()
 where lower(email) = 'peder.holman@gmail.com'
   and coalesce(display_name, '') in ('', split_part(email, '@', 1));
