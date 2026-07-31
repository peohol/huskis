-- ============================================================
-- LEGACY-FIXTUR: databasen slik den så ut FØR rolle-omleggingen.
--
-- Brukes KUN av migrerings-testen (se run-tests.sh): den lager tabellene i
-- den gamle fasongen (memberships/share_invites med `card_id`, uten `role`;
-- mount-kolonner; ingen roller) og fyller dem med de fire situasjonene
-- docs/rettigheter-og-deling.md beskriver for migrering av listedelinger.
-- Deretter kjøres users-and-sharing.sql OVENPÅ, og testen sjekker at den
-- tidligere EFFEKTIVE tilgangen er bevart uten at noen har fått tilgang til
-- søskenlister.
--
-- Skal ALDRI kjøres mot Supabase.
-- ============================================================

create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  email        text not null,
  display_name text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table public.universes (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references public.profiles (id) on delete cascade,
  name       text not null default '',
  trashed    boolean not null default false,
  locked     boolean not null default false,
  ts         bigint not null default 0,
  org        text   not null default '',
  pos        double precision not null default 0,
  pos_ts     bigint not null default 0,
  pos_org    text   not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.groups (
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

create table public.cards (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references public.profiles (id) on delete cascade,
  group_id   uuid not null references public.groups (id) on delete cascade,
  title      text not null default '',
  trashed    boolean not null default false,
  locked     boolean not null default false,
  k          boolean not null default true,
  p          boolean not null default true,
  ts         bigint not null default 0,
  org        text   not null default '',
  lab_ts     bigint not null default 0,
  lab_org    text   not null default '',
  pos        double precision not null default 0,
  pos_ts     bigint not null default 0,
  pos_org    text   not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.items (
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

-- Den GAMLE mount-modellen: eieren hadde aldri medlemskapsrad, og mottakeren
-- valgte selv hvor det delte objektet skulle ligge.
create table public.memberships (
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
  updated_at         timestamptz not null default now(),
  check (num_nonnulls(universe_id, group_id, card_id) = 1)
);

create table public.share_invites (
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

-- ------------------------------------------------------------
-- Data: fire situasjoner fra migreringsregelen
--   O  = eier av universet          M  = universmedlem
--   X  = direkte LISTE-mottaker (én-liste-gruppe)   → skal bli gruppemedlem
--   Y  = direkte LISTE-mottaker (flerliste-gruppe)  → skal få en NY gruppe
--   W  = direkte GRUPPE-medlem i flerliste-gruppen  → skal følge med til den nye
-- ------------------------------------------------------------

insert into auth.users (id, email) values
  ('01000000-3333-0000-0000-00000000000a', 'mig-o@example.com'),
  ('01000000-3333-0000-0000-00000000000b', 'mig-m@example.com'),
  ('01000000-3333-0000-0000-00000000000c', 'mig-x@example.com'),
  ('01000000-3333-0000-0000-00000000000d', 'mig-y@example.com'),
  ('01000000-3333-0000-0000-00000000000e', 'mig-w@example.com');
insert into public.profiles (id, email, display_name)
  select id, email, split_part(email, '@', 1) from auth.users;

insert into public.universes (id, owner_id, name, pos) values
  ('11000000-3333-0000-0000-000000000001', '01000000-3333-0000-0000-00000000000a', 'Legacy', 1);

insert into public.groups (id, owner_id, universe_id, name, pos) values
  -- G1: ÉN liste, delt direkte med X
  ('12000000-3333-0000-0000-000000000001', '01000000-3333-0000-0000-00000000000a',
   '11000000-3333-0000-0000-000000000001', 'Én liste', 1),
  -- G2: TO lister; den ene delt med Y, den andre delt med M (redundant)
  ('12000000-3333-0000-0000-000000000002', '01000000-3333-0000-0000-00000000000a',
   '11000000-3333-0000-0000-000000000001', 'Flere lister', 2);

insert into public.cards (id, owner_id, group_id, title, pos) values
  ('13000000-3333-0000-0000-000000000001', '01000000-3333-0000-0000-00000000000a',
   '12000000-3333-0000-0000-000000000001', 'Alenelista', 1),
  ('13000000-3333-0000-0000-000000000002', '01000000-3333-0000-0000-00000000000a',
   '12000000-3333-0000-0000-000000000002', 'Y-lista', 1),
  ('13000000-3333-0000-0000-000000000003', '01000000-3333-0000-0000-00000000000a',
   '12000000-3333-0000-0000-000000000002', 'Søskenlista', 2);

insert into public.items (id, owner_id, card_id, text, pos) values
  ('14000000-3333-0000-0000-000000000001', '01000000-3333-0000-0000-00000000000a',
   '13000000-3333-0000-0000-000000000002', 'Y ser denne', 1),
  ('14000000-3333-0000-0000-000000000002', '01000000-3333-0000-0000-00000000000a',
   '13000000-3333-0000-0000-000000000003', 'Y skal IKKE se denne', 1);

-- M er universmedlem (gammel modell: medlemskapsrad på universet)
insert into public.memberships (user_id, universe_id, pos) values
  ('01000000-3333-0000-0000-00000000000b', '11000000-3333-0000-0000-000000000001', 1);
-- W er direkte gruppemedlem i flerliste-gruppen, montert i sitt eget syn
insert into public.memberships (user_id, group_id, pos) values
  ('01000000-3333-0000-0000-00000000000e', '12000000-3333-0000-0000-000000000002', 1);
-- X og Y er direkte LISTE-mottakere; M har en REDUNDANT listedeling
insert into public.memberships (user_id, card_id, pos) values
  ('01000000-3333-0000-0000-00000000000c', '13000000-3333-0000-0000-000000000001', 1),
  ('01000000-3333-0000-0000-00000000000d', '13000000-3333-0000-0000-000000000002', 2),
  ('01000000-3333-0000-0000-00000000000b', '13000000-3333-0000-0000-000000000003', 3);

-- Ventende invitasjon på Y-lista til en adresse uten konto ennå
insert into public.share_invites (inviter_id, invitee_email, card_id, status) values
  ('01000000-3333-0000-0000-00000000000a', 'mig-ny@example.com',
   '13000000-3333-0000-0000-000000000002', 'pending');
