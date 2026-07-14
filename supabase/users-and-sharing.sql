-- ============================================================
-- Huskekurv: brukere, eierskap og deling (GRUNNMUR — fase 1)
-- Idempotent: trygg å kjøre flere ganger.
--
-- Dette skjemaet ERSTATTER på sikt den gamle éndoc-modellen
-- (public.lists + get_list/save_list), men rører den IKKE:
-- dagens app fortsetter å virke uendret til UI-et for
-- innlogging/deling er implementert (fase 2).
--
-- Modell (se docs/arkitektur-brukere-deling.md for full design):
--
--   * Supabase Auth (e-post + passord, bekreftelseslenke på e-post)
--     står for identitet. public.profiles speiler auth.users.
--   * Relasjonelle tabeller per nivå: universes > groups > cards
--     ("lister" i UI-et) > items. Hver rad har owner_id.
--   * Deling skjer via invitasjoner (share_invites, på e-post) som
--     mottakeren aksepterer. Aksept oppretter et medlemskap
--     (memberships) = "mount": mottakerens egen plassering av det
--     delte objektet (delt gruppe -> velg univers, delt liste ->
--     velg gruppe). Innholdet er felles; kun montasjepunktet er
--     per bruker.
--   * Eieren har ALDRI en medlemskapsrad (kan derfor aldri kastes
--     ut), kan kaste ut andre (revoke_share) og kan låse/åpne
--     objektet for redigering av andre (locked-flagget).
--   * Sletting: mottaker som "sletter" et delt objekt fjerner bare
--     sitt eget medlemskap (leave_share / membership.trashed) —
--     objektet består hos eieren. Eierens sletting er reell.
--   * Konflikthåndtering: samme felt-nivå LWW-registre som i dag
--     (ts/org for innhold, pos_ts/pos_org for plassering,
--     lab_ts/lab_org for K/P-merkelapper) håndheves nå OGSÅ på
--     serveren av BEFORE UPDATE-triggere: en utdatert skriving
--     taper mot nyere data i stedet for å overskrive.
--   * Gravsteiner (tombstones) skrives automatisk ved sletting,
--     slik at offline-klienter ikke gjenoppliver slettede objekter.
--   * get_my_doc() gir hele brukerens datasett som ETT flatt
--     jsonb-doc i samme fasong som dagens synk-doc (universes/
--     groups/cards/items + mounts + invitasjoner) — klientens
--     eksisterende applyDoc-maskineri kan gjenbrukes.
--   * import_doc(p_doc) migrerer et lokalt/legacy doc inn som
--     brukerens egne data (deterministiske id-er, idempotent).
--
-- Krever (manuelt, i Supabase-dashboardet — se TODO.md):
--   * Auth: "Confirm email" PÅ (standard), Site URL + Redirect URLs
--     satt til appens adresse. Ev. egen SMTP for produksjonsvolum.
-- ============================================================

create extension if not exists pgcrypto with schema extensions;

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
--    Registre som i dagens synk-doc:
--      innhold:   ts / org           (navn/tekst/trashed, K/P for kort
--                                     har eget register lab_ts/lab_org)
--      plassering: pos_ts / pos_org  (pos + forelder-peker følger
--                                     posisjonsregisteret, som i dag)
-- ------------------------------------------------------------

create table if not exists public.universes (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references public.profiles (id) on delete cascade,
  name       text not null default '',
  trashed    boolean not null default false,
  locked     boolean not null default false,   -- eier-lås: andre kan ikke redigere
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
-- Avkryssing av elementer (gjort/ikke gjort): rir på innholds-registeret
-- (ts/org), som text/trashed. Idempotent for databaser opprettet før feltet.
alter table public.items add column if not exists done boolean not null default false;
-- Ansvarlig bruker for et element (den som «tar oppgaven» i en delt liste).
-- Peker på en profil (medlem eller eier av delingen). Rir på innholds-
-- registeret (ts/org), som text/trashed/done. `on delete set null` så en
-- slettet konto bare nullstiller ansvaret. Idempotent for eldre databaser.
alter table public.items add column if not exists responsible uuid references public.profiles (id) on delete set null;

-- Tidsplanlegging (start/frist) + ansvarlig for HELE lister. Tidsverdiene er
-- klientens lokale «vegg-tid» som tekst ('YYYY-MM-DD' eller 'YYYY-MM-DDTHH:MM',
-- klokkeslett valgfritt) — bevisst IKKE timestamptz: en frist «14. juli» skal
-- bety 14. juli på alle enheter uansett tidssone, og klienten trenger å vite
-- om et klokkeslett faktisk er definert. `cards.lock_times` låser listens
-- tider til elementene (elementene kan da ikke ha egne). Alt rir på
-- innholds-registeret (ts/org). Idempotent for eldre databaser.
alter table public.cards add column if not exists start_at text;
alter table public.cards add column if not exists due_at text;
alter table public.cards add column if not exists lock_times boolean not null default false;
alter table public.cards add column if not exists responsible uuid references public.profiles (id) on delete set null;
alter table public.items add column if not exists start_at text;
alter table public.items add column if not exists due_at text;

-- Kategorier: en kategori er en nivå-1-«rad» i en liste som grupperer elementer
-- (nivå 2) under en felles overskrift. Den lagres SOM et element (samme tabell),
-- markert `is_cat = true`; leaf-elementer peker på kategorien sin via `cat_id`
-- (null = ukategorisert). `on delete set null` løsner elementene om kategori-raden
-- slettes. `lock_times` (som cards) låser kategoriens tider til elementene sine.
-- `cat_id` følger posisjonsregisteret (som `card_id`); `is_cat`/`lock_times` rir
-- på innholds-registeret (ts/org). Idempotent for eldre databaser.
-- `deferrable initially deferred`: import_doc kan sette inn et element FØR
-- kategori-raden det peker på (doc-rekkefølgen er vilkårlig) — FK-en sjekkes
-- da først ved commit, når alle radene finnes.
alter table public.items add column if not exists cat_id uuid references public.items (id) on delete set null deferrable initially deferred;
alter table public.items add column if not exists is_cat boolean not null default false;
alter table public.items add column if not exists lock_times boolean not null default false;

-- Unntak fra arvet lås: et objekt under et låst univers/gruppe er automatisk
-- låst for andre, men eieren kan sette `unlocked = true` for NETTOPP dette
-- objektet så det likevel kan redigeres (og alt under det, med mindre et enda
-- lavere nivå låses på nytt). `locked` og `unlocked` er gjensidig utelukkende
-- per rad (set_locked/set_unlocked holder dem det). Idempotent for eldre databaser.
alter table public.universes add column if not exists unlocked boolean not null default false;
alter table public.groups    add column if not exists unlocked boolean not null default false;
alter table public.cards     add column if not exists unlocked boolean not null default false;

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
-- 3. MEDLEMSKAP (mounts) og INVITASJONER
-- ------------------------------------------------------------

-- Ett medlemskap = én mottakers tilgang til + plassering av ett delt
-- objekt. Nøyaktig én av universe_id/group_id/card_id er satt.
-- Eieren har aldri medlemskapsrad (kan derfor aldri kastes ut).
--   * universe-deling: ingen forelder å velge; pos ordner blant
--     mottakerens egne universer.
--   * gruppe-deling:  parent_universe_id = mottakerens valgte univers.
--   * liste-deling:   parent_group_id    = mottakerens valgte gruppe.
-- Slettes mottakerens forelder settes pekeren til null ("umontert");
-- UI-et kan da be om ny plassering uten at delingen går tapt.
-- trashed = mottakerens egen søppelkasse for selve delingen
-- (gjenopprettbar); tømming = slett raden (forlat delingen).
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
  updated_at         timestamptz not null default now(),
  check (num_nonnulls(universe_id, group_id, card_id) = 1),
  check (universe_id is null or (parent_universe_id is null and parent_group_id is null)),
  check (group_id is null or parent_group_id is null),
  check (card_id is null or parent_universe_id is null)
);

create unique index if not exists memberships_universe_user_key
  on public.memberships (universe_id, user_id) where universe_id is not null;
create unique index if not exists memberships_group_user_key
  on public.memberships (group_id, user_id) where group_id is not null;
create unique index if not exists memberships_card_user_key
  on public.memberships (card_id, user_id) where card_id is not null;
create index if not exists memberships_user_idx on public.memberships (user_id);

alter table public.memberships enable row level security;

-- Invitasjon til deling, adressert til en e-post (mottakeren trenger
-- ikke ha konto ennå; kobles ved registrering). Aksept skjer i appen
-- (accept_share_invite) fordi mottakeren må velge plassering.
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
  responded_at  timestamptz,
  check (num_nonnulls(universe_id, group_id, card_id) = 1)
);

create unique index if not exists share_invites_universe_pending_key
  on public.share_invites (universe_id, lower(invitee_email))
  where status = 'pending' and universe_id is not null;
create unique index if not exists share_invites_group_pending_key
  on public.share_invites (group_id, lower(invitee_email))
  where status = 'pending' and group_id is not null;
create unique index if not exists share_invites_card_pending_key
  on public.share_invites (card_id, lower(invitee_email))
  where status = 'pending' and card_id is not null;
create index if not exists share_invites_invitee_idx
  on public.share_invites (lower(invitee_email)) where status = 'pending';

alter table public.share_invites enable row level security;

-- ------------------------------------------------------------
-- 4. GRAVSTEINER — hindrer at offline-klienter gjenoppliver
--    hardslettede objekter ved neste synk.
-- ------------------------------------------------------------

create table if not exists public.tombstones (
  resource_type text not null check (resource_type in ('universe', 'group', 'card', 'item')),
  resource_id   uuid not null,
  ts            bigint not null default 0,   -- HLC-tid for slettingen
  deleted_at    timestamptz not null default now(),
  primary key (resource_type, resource_id)
);

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

-- ------------------------------------------------------------
-- 5. TILGANGSFUNKSJONER (security definer => omgår RLS internt,
--    ingen policy-rekursjon). Lese-tilgang følger kjeden
--    element -> liste -> gruppe -> univers: eierskap ELLER direkte
--    medlemskap ELLER medlemskap på en forelder.
--    Redigerings-tilgang = lese-tilgang + at ingen lås på veien
--    (objektet selv eller en forelder) er satt av noen andre enn
--    brukeren: eieren av et låst objekt kan alltid redigere selv.
-- ------------------------------------------------------------

create or replace function public.can_read_universe(p_id uuid, p_uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.universes u where u.id = p_id and u.owner_id = p_uid)
      or exists (select 1 from public.memberships m where m.universe_id = p_id and m.user_id = p_uid);
$$;

create or replace function public.can_edit_universe(p_id uuid, p_uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.universes u
    where u.id = p_id
      and (u.owner_id = p_uid
           or (not u.locked
               and exists (select 1 from public.memberships m
                           where m.universe_id = u.id and m.user_id = p_uid)))
  );
$$;

create or replace function public.can_read_group(p_id uuid, p_uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.groups g
    where g.id = p_id
      and (g.owner_id = p_uid
           or exists (select 1 from public.memberships m
                      where m.group_id = g.id and m.user_id = p_uid)
           or public.can_read_universe(g.universe_id, p_uid))
  );
$$;

-- Redigering: nærmeste nivå (objektet, så oppover) med en eksplisitt lås-
-- tilstand satt av en ANNEN avgjør — et unntak (unlocked) åpner grenen, en lås
-- (locked) fryser den. Egne låser/unntak blokkerer aldri en selv.
create or replace function public.can_edit_group(p_id uuid, p_uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.groups g
    join public.universes u on u.id = g.universe_id
    where g.id = p_id
      and public.can_read_group(g.id, p_uid)
      and case
            when g.owner_id <> p_uid and g.locked   then false
            when g.owner_id <> p_uid and g.unlocked then true
            when u.owner_id <> p_uid and u.locked   then false
            when u.owner_id <> p_uid and u.unlocked then true
            else true
          end
  );
$$;

create or replace function public.can_read_card(p_id uuid, p_uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.cards c
    where c.id = p_id
      and (c.owner_id = p_uid
           or exists (select 1 from public.memberships m
                      where m.card_id = c.id and m.user_id = p_uid)
           or public.can_read_group(c.group_id, p_uid))
  );
$$;

create or replace function public.can_edit_card(p_id uuid, p_uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.cards c
    join public.groups g on g.id = c.group_id
    join public.universes u on u.id = g.universe_id
    where c.id = p_id
      and public.can_read_card(c.id, p_uid)
      and case
            when c.owner_id <> p_uid and c.locked   then false
            when c.owner_id <> p_uid and c.unlocked then true
            when g.owner_id <> p_uid and g.locked   then false
            when g.owner_id <> p_uid and g.unlocked then true
            when u.owner_id <> p_uid and u.locked   then false
            when u.owner_id <> p_uid and u.unlocked then true
            else true
          end
  );
$$;

-- Eier-oppslag på tvers av typer (for deling/kasting/låsing).
create or replace function public.resource_owner(p_type text, p_id uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select case p_type
    when 'universe' then (select owner_id from public.universes where id = p_id)
    when 'group'    then (select owner_id from public.groups    where id = p_id)
    when 'card'     then (select owner_id from public.cards     where id = p_id)
  end;
$$;

-- ------------------------------------------------------------
-- 6. VAKT- OG LWW-TRIGGERE (BEFORE INSERT/UPDATE)
--    * owner_id kan aldri endres; locked kan kun endres av eieren.
--    * Flytting til ny forelder krever redigeringstilgang der.
--    * Felt-nivå LWW: en skriving med eldre register-tidsstempel
--      taper mot dataene som allerede står (per register).
--    * auth.uid() is null = admin/psql (vedlikehold) — slipper forbi.
-- ------------------------------------------------------------

create or replace function public.reg_newer(a_ts bigint, a_org text, b_ts bigint, b_org text)
returns boolean language sql immutable as $$
  select coalesce(a_ts, 0) > coalesce(b_ts, 0)
      or (coalesce(a_ts, 0) = coalesce(b_ts, 0) and coalesce(a_org, '') > coalesce(b_org, ''));
$$;

create or replace function public.universes_before_update()
returns trigger language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if new.owner_id is distinct from old.owner_id then
    raise exception 'owner_id kan ikke endres';
  end if;
  if new.locked is distinct from old.locked and uid is not null and uid <> old.owner_id then
    raise exception 'kun eieren kan låse/åpne';
  end if;
  if new.unlocked is distinct from old.unlocked and uid is not null and uid <> old.owner_id then
    raise exception 'kun eieren kan endre unntak';
  end if;
  -- En mottaker kan ALDRI slette/gjenopprette selve det delte universet
  -- (trashed er felles). Deres «fjern fra mitt syn» er leave_share (mount).
  -- Innhold NEDE i universet kan de derimot slette fritt (felles søppel).
  if new.trashed is distinct from old.trashed and uid is not null and uid <> old.owner_id then
    raise exception 'mottakere kan ikke slette et delt univers (bruk leave_share)';
  end if;
  if not public.reg_newer(new.ts, new.org, old.ts, old.org) then
    new.name := old.name; new.trashed := old.trashed;
    new.ts := old.ts; new.org := old.org;
  end if;
  if not public.reg_newer(new.pos_ts, new.pos_org, old.pos_ts, old.pos_org) then
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
declare uid uuid := auth.uid();
begin
  if new.owner_id is distinct from old.owner_id then
    raise exception 'owner_id kan ikke endres';
  end if;
  if new.locked is distinct from old.locked and uid is not null and uid <> old.owner_id then
    raise exception 'kun eieren kan låse/åpne';
  end if;
  if new.unlocked is distinct from old.unlocked and uid is not null and uid <> old.owner_id then
    raise exception 'kun eieren kan endre unntak';
  end if;
  -- Mottaker av en DIREKTE gruppe-deling kan ikke slette/gjenopprette selve
  -- gruppen (bruk leave_share). Innhold under gruppen — og en gruppe man kun
  -- når via et delt UNIVERS (ingen direkte gruppe-medlemskap) — kan slettes
  -- fritt (felles søppel, gjelder for alle).
  if new.trashed is distinct from old.trashed and uid is not null and uid <> old.owner_id
     and exists (select 1 from public.memberships m
                 where m.group_id = old.id and m.user_id = uid) then
    raise exception 'mottakere kan ikke slette en delt gruppe (bruk leave_share)';
  end if;
  if new.universe_id is distinct from old.universe_id and uid is not null then
    -- Mottakere av en direkte gruppe-deling flytter via sin egen
    -- mount (memberships.parent_universe_id), ikke eierens plassering.
    if uid <> old.owner_id and exists (
      select 1 from public.memberships m
      where m.group_id = old.id and m.user_id = uid
    ) then
      raise exception 'delte objekter flyttes via egen plassering (mount)';
    end if;
    if not public.can_edit_universe(new.universe_id, uid) then
      raise exception 'mangler tilgang til mål-universet';
    end if;
  end if;
  if not public.reg_newer(new.ts, new.org, old.ts, old.org) then
    new.name := old.name; new.trashed := old.trashed;
    new.ts := old.ts; new.org := old.org;
  end if;
  if not public.reg_newer(new.pos_ts, new.pos_org, old.pos_ts, old.pos_org) then
    new.universe_id := old.universe_id;   -- forelder følger posisjonsregisteret
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
declare uid uuid := auth.uid();
begin
  if new.owner_id is distinct from old.owner_id then
    raise exception 'owner_id kan ikke endres';
  end if;
  if new.locked is distinct from old.locked and uid is not null and uid <> old.owner_id then
    raise exception 'kun eieren kan låse/åpne';
  end if;
  if new.unlocked is distinct from old.unlocked and uid is not null and uid <> old.owner_id then
    raise exception 'kun eieren kan endre unntak';
  end if;
  -- Mottaker av en DIREKTE liste-deling kan ikke slette/gjenopprette selve
  -- listen (bruk leave_share). Elementer i listen — og en liste man kun når
  -- via et delt univers/gruppe (ingen direkte liste-medlemskap) — kan slettes
  -- fritt (felles søppel, gjelder for alle).
  if new.trashed is distinct from old.trashed and uid is not null and uid <> old.owner_id
     and exists (select 1 from public.memberships m
                 where m.card_id = old.id and m.user_id = uid) then
    raise exception 'mottakere kan ikke slette en delt liste (bruk leave_share)';
  end if;
  if new.group_id is distinct from old.group_id and uid is not null then
    -- Mottakere av en direkte liste-deling flytter via sin egen
    -- mount (memberships.parent_group_id), ikke eierens plassering.
    if uid <> old.owner_id and exists (
      select 1 from public.memberships m
      where m.card_id = old.id and m.user_id = uid
    ) then
      raise exception 'delte objekter flyttes via egen plassering (mount)';
    end if;
    if not public.can_edit_group(new.group_id, uid) then
      raise exception 'mangler tilgang til mål-gruppen';
    end if;
  end if;
  if not public.reg_newer(new.ts, new.org, old.ts, old.org) then
    new.title := old.title; new.trashed := old.trashed;
    new.responsible := old.responsible;
    new.start_at := old.start_at; new.due_at := old.due_at; new.lock_times := old.lock_times;
    new.ts := old.ts; new.org := old.org;
  end if;
  if not public.reg_newer(new.lab_ts, new.lab_org, old.lab_ts, old.lab_org) then
    new.k := old.k; new.p := old.p;
    new.lab_ts := old.lab_ts; new.lab_org := old.lab_org;
  end if;
  if not public.reg_newer(new.pos_ts, new.pos_org, old.pos_ts, old.pos_org) then
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
declare uid uuid := auth.uid();
begin
  if new.owner_id is distinct from old.owner_id then
    raise exception 'owner_id kan ikke endres';
  end if;
  if new.card_id is distinct from old.card_id
     and uid is not null
     and not public.can_edit_card(new.card_id, uid) then
    raise exception 'mangler tilgang til mål-listen';
  end if;
  if not public.reg_newer(new.ts, new.org, old.ts, old.org) then
    new.text := old.text; new.trashed := old.trashed; new.done := old.done;
    new.responsible := old.responsible;
    new.start_at := old.start_at; new.due_at := old.due_at;
    new.is_cat := old.is_cat; new.lock_times := old.lock_times;
    new.ts := old.ts; new.org := old.org;
  end if;
  if not public.reg_newer(new.pos_ts, new.pos_org, old.pos_ts, old.pos_org) then
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
drop policy if exists universes_select on public.universes;
create policy universes_select on public.universes
  for select using (public.can_read_universe(id, auth.uid()));
drop policy if exists universes_insert on public.universes;
create policy universes_insert on public.universes
  for insert with check (owner_id = auth.uid());
drop policy if exists universes_update on public.universes;
create policy universes_update on public.universes
  for update using (public.can_edit_universe(id, auth.uid()));
drop policy if exists universes_delete on public.universes;
create policy universes_delete on public.universes
  for delete using (owner_id = auth.uid());   -- kun eier hardsletter

-- groups: opprettelse krever redigeringstilgang i universet.
-- Hardsletting: eieren, ELLER redigeringstilgang (tømming av felles
-- søppelkasse i et delt univers) — men ALDRI av en som har direkte
-- medlemskap på objektet (share-roten): mottakerens «sletting» er å
-- forlate delingen (leave_share), ikke å slette eierens data.
drop policy if exists groups_select on public.groups;
create policy groups_select on public.groups
  for select using (public.can_read_group(id, auth.uid()));
drop policy if exists groups_insert on public.groups;
create policy groups_insert on public.groups
  for insert with check (owner_id = auth.uid()
                         and public.can_edit_universe(universe_id, auth.uid()));
drop policy if exists groups_update on public.groups;
create policy groups_update on public.groups
  for update using (public.can_edit_group(id, auth.uid()));
drop policy if exists groups_delete on public.groups;
create policy groups_delete on public.groups
  for delete using (
    owner_id = auth.uid()
    or (public.can_edit_group(id, auth.uid())
        and not exists (select 1 from public.memberships m
                        where m.group_id = groups.id and m.user_id = auth.uid()))
  );

-- cards («lister»)
drop policy if exists cards_select on public.cards;
create policy cards_select on public.cards
  for select using (public.can_read_card(id, auth.uid()));
drop policy if exists cards_insert on public.cards;
create policy cards_insert on public.cards
  for insert with check (owner_id = auth.uid()
                         and public.can_edit_group(group_id, auth.uid()));
drop policy if exists cards_update on public.cards;
create policy cards_update on public.cards
  for update using (public.can_edit_card(id, auth.uid()));
drop policy if exists cards_delete on public.cards;
create policy cards_delete on public.cards
  for delete using (
    owner_id = auth.uid()
    or (public.can_edit_card(id, auth.uid())
        and not exists (select 1 from public.memberships m
                        where m.card_id = cards.id and m.user_id = auth.uid()))
  );

-- items
drop policy if exists items_select on public.items;
create policy items_select on public.items
  for select using (public.can_read_card(card_id, auth.uid()));
drop policy if exists items_insert on public.items;
create policy items_insert on public.items
  for insert with check (owner_id = auth.uid()
                         and public.can_edit_card(card_id, auth.uid()));
drop policy if exists items_update on public.items;
create policy items_update on public.items
  for update using (public.can_edit_card(card_id, auth.uid()));
drop policy if exists items_delete on public.items;
create policy items_delete on public.items
  for delete using (owner_id = auth.uid() or public.can_edit_card(card_id, auth.uid()));

-- memberships: egen rad (mottaker) kan leses/justeres/slettes (forlate);
-- eieren av objektet ser radene og kan slette dem (kaste ut).
-- Opprettelse skjer KUN via accept_share_invite (security definer).
drop policy if exists memberships_select on public.memberships;
create policy memberships_select on public.memberships
  for select using (
    user_id = auth.uid()
    or coalesce(public.resource_owner('universe', universe_id),
                public.resource_owner('group', group_id),
                public.resource_owner('card', card_id)) = auth.uid()
  );
drop policy if exists memberships_update on public.memberships;
create policy memberships_update on public.memberships
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists memberships_delete on public.memberships;
create policy memberships_delete on public.memberships
  for delete using (
    user_id = auth.uid()
    or coalesce(public.resource_owner('universe', universe_id),
                public.resource_owner('group', group_id),
                public.resource_owner('card', card_id)) = auth.uid()
  );

-- Mottakeren kan bare endre sin egen plassering/rekkefølge/søppel —
-- ikke hvilket objekt medlemskapet gjelder eller hvem det tilhører.
create or replace function public.memberships_before_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.user_id     is distinct from old.user_id
     or new.universe_id is distinct from old.universe_id
     or new.group_id    is distinct from old.group_id
     or new.card_id     is distinct from old.card_id then
    raise exception 'medlemskapets objekt/bruker kan ikke endres';
  end if;
  if new.parent_universe_id is distinct from old.parent_universe_id
     and new.parent_universe_id is not null
     and auth.uid() is not null
     and not public.can_read_universe(new.parent_universe_id, auth.uid()) then
    raise exception 'mangler tilgang til mål-universet';
  end if;
  if new.parent_group_id is distinct from old.parent_group_id
     and new.parent_group_id is not null
     and auth.uid() is not null
     and not public.can_read_group(new.parent_group_id, auth.uid()) then
    raise exception 'mangler tilgang til mål-gruppen';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists memberships_guard on public.memberships;
create trigger memberships_guard before update on public.memberships
  for each row execute function public.memberships_before_update();

-- share_invites: avsender ser sine; mottaker ser sine (på id eller
-- e-post). Opprettelse/respons kun via RPC-ene. Avsender kan slette
-- (trekke tilbake) en ventende invitasjon.
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
-- ------------------------------------------------------------

-- Eieren inviterer en e-postadresse til et univers / en gruppe / en
-- liste. Mottakeren trenger ikke ha konto ennå. Returnerer invitasjonen.
create or replace function public.create_share_invite(p_type text, p_id uuid, p_email text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid    uuid := auth.uid();
  em     text := lower(trim(p_email));
  target uuid;
  inv    public.share_invites;
begin
  if uid is null then raise exception 'ikke innlogget'; end if;
  if p_type not in ('universe', 'group', 'card') then
    raise exception 'ugyldig type: %', p_type;
  end if;
  if em = '' or position('@' in em) = 0 then
    raise exception 'ugyldig e-postadresse';
  end if;
  if public.resource_owner(p_type, p_id) is distinct from uid then
    raise exception 'kun eieren kan dele';
  end if;
  if em = (select lower(email) from public.profiles where id = uid) then
    raise exception 'kan ikke dele med deg selv';
  end if;

  select id into target from public.profiles where lower(email) = em;

  if target is not null and exists (
    select 1 from public.memberships m
    where m.user_id = target
      and ((p_type = 'universe' and m.universe_id = p_id)
        or (p_type = 'group'    and m.group_id    = p_id)
        or (p_type = 'card'     and m.card_id     = p_id))
  ) then
    raise exception 'brukeren har allerede tilgang';
  end if;

  insert into public.share_invites (inviter_id, invitee_email, invitee_id,
                                    universe_id, group_id, card_id)
  values (uid, em, target,
          case when p_type = 'universe' then p_id end,
          case when p_type = 'group'    then p_id end,
          case when p_type = 'card'     then p_id end)
  returning * into inv;

  return to_jsonb(inv);
exception
  when unique_violation then
    raise exception 'det finnes allerede en ventende invitasjon til %', em;
end;
$$;

-- Mottakeren aksepterer og velger plassering: p_parent = eget univers
-- (for delt gruppe) / egen gruppe (for delt liste); null for univers.
create or replace function public.accept_share_invite(
  p_invite uuid, p_parent uuid default null, p_pos double precision default 0)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  inv public.share_invites;
  mem public.memberships;
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

  if inv.universe_id is not null then
    if p_parent is not null then raise exception 'univers-deling tar ingen plassering'; end if;
    insert into public.memberships (user_id, universe_id, pos)
    values (uid, inv.universe_id, p_pos)
    on conflict (universe_id, user_id) where universe_id is not null
      do update set trashed = false, pos = excluded.pos
    returning * into mem;
  elsif inv.group_id is not null then
    if p_parent is null or not public.can_read_universe(p_parent, uid) then
      raise exception 'velg et univers du har tilgang til';
    end if;
    insert into public.memberships (user_id, group_id, parent_universe_id, pos)
    values (uid, inv.group_id, p_parent, p_pos)
    on conflict (group_id, user_id) where group_id is not null
      do update set trashed = false, parent_universe_id = excluded.parent_universe_id,
                    pos = excluded.pos
    returning * into mem;
  else
    if p_parent is null or not public.can_read_group(p_parent, uid) then
      raise exception 'velg en gruppe du har tilgang til';
    end if;
    insert into public.memberships (user_id, card_id, parent_group_id, pos)
    values (uid, inv.card_id, p_parent, p_pos)
    on conflict (card_id, user_id) where card_id is not null
      do update set trashed = false, parent_group_id = excluded.parent_group_id,
                    pos = excluded.pos
    returning * into mem;
  end if;

  update public.share_invites
     set status = 'accepted', invitee_id = uid, responded_at = now()
   where id = inv.id;

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

-- Eieren trekker tilbake en ventende invitasjon.
create or replace function public.revoke_share_invite(p_invite uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.share_invites
     set status = 'revoked', responded_at = now()
   where id = p_invite and inviter_id = auth.uid() and status = 'pending';
  if not found then raise exception 'fant ingen ventende invitasjon'; end if;
end;
$$;

-- Eieren kaster ut en annen bruker (sletter medlemskapet + ev.
-- ventende invitasjoner). Eieren selv har aldri medlemskap og kan
-- derfor aldri kastes ut.
create or replace function public.revoke_share(p_type text, p_id uuid, p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'ikke innlogget'; end if;
  if public.resource_owner(p_type, p_id) is distinct from uid then
    raise exception 'kun eieren kan kaste ut andre';
  end if;
  delete from public.memberships m
   where m.user_id = p_user
     and ((p_type = 'universe' and m.universe_id = p_id)
       or (p_type = 'group'    and m.group_id    = p_id)
       or (p_type = 'card'     and m.card_id     = p_id));
  update public.share_invites s
     set status = 'revoked', responded_at = now()
   where s.status = 'pending'
     and (s.invitee_id = p_user
          or lower(s.invitee_email) = (select lower(email) from public.profiles where id = p_user))
     and ((p_type = 'universe' and s.universe_id = p_id)
       or (p_type = 'group'    and s.group_id    = p_id)
       or (p_type = 'card'     and s.card_id     = p_id));
end;
$$;

-- Mottakeren forlater en deling selv (= «slett» hos mottakeren).
create or replace function public.leave_share(p_type text, p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'ikke innlogget'; end if;
  delete from public.memberships m
   where m.user_id = uid
     and ((p_type = 'universe' and m.universe_id = p_id)
       or (p_type = 'group'    and m.group_id    = p_id)
       or (p_type = 'card'     and m.card_id     = p_id));
  if not found then raise exception 'du er ikke medlem av dette objektet'; end if;
end;
$$;

-- Eieren låser/åpner et delt objekt for redigering av andre.
create or replace function public.set_locked(p_type text, p_id uuid, p_locked boolean)
returns void language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'ikke innlogget'; end if;
  if public.resource_owner(p_type, p_id) is distinct from uid then
    raise exception 'kun eieren kan låse/åpne';
  end if;
  -- locked og unlocked er gjensidig utelukkende: å låse fjerner et ev. unntak.
  if p_type = 'universe' then update public.universes set locked = p_locked, unlocked = (unlocked and not p_locked) where id = p_id;
  elsif p_type = 'group' then update public.groups set locked = p_locked, unlocked = (unlocked and not p_locked) where id = p_id;
  elsif p_type = 'card'  then update public.cards  set locked = p_locked, unlocked = (unlocked and not p_locked) where id = p_id;
  else raise exception 'ugyldig type: %', p_type;
  end if;
end;
$$;

-- Eieren gjør/opphever et UNNTAK fra en arvet lås for et objekt: `unlocked`
-- åpner grenen for andre selv om en forelder er låst. Gjensidig utelukkende med
-- objektets egen `locked` (å sette unntak fjerner en ev. egen lås).
create or replace function public.set_unlocked(p_type text, p_id uuid, p_unlocked boolean)
returns void language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'ikke innlogget'; end if;
  if public.resource_owner(p_type, p_id) is distinct from uid then
    raise exception 'kun eieren kan endre unntak';
  end if;
  if p_type = 'universe' then update public.universes set unlocked = p_unlocked, locked = (locked and not p_unlocked) where id = p_id;
  elsif p_type = 'group' then update public.groups set unlocked = p_unlocked, locked = (locked and not p_unlocked) where id = p_id;
  elsif p_type = 'card'  then update public.cards  set unlocked = p_unlocked, locked = (locked and not p_unlocked) where id = p_id;
  else raise exception 'ugyldig type: %', p_type;
  end if;
end;
$$;

-- Medlemsliste (+ ventende invitasjoner) for et objekt man har
-- tilgang til. Eier + medlemmer ser hverandres navn/e-post.
create or replace function public.get_members(p_type text, p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  ok  boolean;
begin
  if uid is null then raise exception 'ikke innlogget'; end if;
  ok := case p_type
    when 'universe' then public.can_read_universe(p_id, uid)
    when 'group'    then public.can_read_group(p_id, uid)
    when 'card'     then public.can_read_card(p_id, uid)
  end;
  if not coalesce(ok, false) then raise exception 'ingen tilgang'; end if;

  return jsonb_build_object(
    'owner', (
      select jsonb_build_object('id', pr.id, 'email', pr.email, 'display_name', pr.display_name)
      from public.profiles pr where pr.id = public.resource_owner(p_type, p_id)
    ),
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', pr.id, 'email', pr.email, 'display_name', pr.display_name,
               'since', m.created_at) order by m.created_at)
      from public.memberships m
      join public.profiles pr on pr.id = m.user_id
      where (p_type = 'universe' and m.universe_id = p_id)
         or (p_type = 'group'    and m.group_id    = p_id)
         or (p_type = 'card'     and m.card_id     = p_id)
    ), '[]'::jsonb),
    'pending_invites', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', s.id, 'email', s.invitee_email, 'created_at', s.created_at)
             order by s.created_at)
      from public.share_invites s
      where s.status = 'pending'
        and ((p_type = 'universe' and s.universe_id = p_id)
          or (p_type = 'group'    and s.group_id    = p_id)
          or (p_type = 'card'     and s.card_id     = p_id))
    ), '[]'::jsonb)
  );
end;
$$;

-- ------------------------------------------------------------
-- 9. get_my_doc() — hele brukerens datasett som ett flatt doc,
--    samme fasong som dagens synk-doc + mounts og invitasjoner.
--    Klientens applyDoc/merge-maskineri kan gjenbrukes (fase 2).
-- ------------------------------------------------------------

create or replace function public.get_my_doc()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  result jsonb;
begin
  if uid is null then raise exception 'ikke innlogget'; end if;

  with my_universes as (
    select u.*, m.id as mount_id, m.pos as mount_pos, m.trashed as mount_trashed
    from public.universes u
    left join public.memberships m on m.universe_id = u.id and m.user_id = uid
    where u.owner_id = uid or m.id is not null
  ),
  my_groups as (
    select g.*, m.id as mount_id, m.parent_universe_id as mount_parent,
           m.pos as mount_pos, m.trashed as mount_trashed
    from public.groups g
    left join public.memberships m on m.group_id = g.id and m.user_id = uid
    where g.owner_id = uid or m.id is not null
       or g.universe_id in (select id from my_universes)
  ),
  my_cards as (
    select c.*, m.id as mount_id, m.parent_group_id as mount_parent,
           m.pos as mount_pos, m.trashed as mount_trashed
    from public.cards c
    left join public.memberships m on m.card_id = c.id and m.user_id = uid
    where c.owner_id = uid or m.id is not null
       or c.group_id in (select id from my_groups)
  ),
  my_items as (
    select i.* from public.items i where i.card_id in (select id from my_cards)
  )
  select jsonb_build_object(
    'user', (select jsonb_build_object('id', pr.id, 'email', pr.email,
                                       'display_name', pr.display_name)
             from public.profiles pr where pr.id = uid),
    'universes', coalesce((select jsonb_agg(jsonb_build_object(
        'id', u.id, 'owner', u.owner_id, 'mine', u.owner_id = uid,
        'name', u.name, 'trashed', u.trashed, 'locked', u.locked, 'unlocked', u.unlocked,
        'ts', u.ts, 'org', u.org,
        'pos', u.pos, 'posTs', u.pos_ts, 'posOrg', u.pos_org,
        'shared', exists (select 1 from public.memberships mm where mm.universe_id = u.id),
        'mount', case when u.mount_id is null then null else jsonb_build_object(
          'pos', u.mount_pos, 'trashed', u.mount_trashed) end)) from my_universes u), '[]'::jsonb),
    'groups', coalesce((select jsonb_agg(jsonb_build_object(
        'id', g.id, 'owner', g.owner_id, 'mine', g.owner_id = uid,
        'uni', g.universe_id,
        'name', g.name, 'trashed', g.trashed, 'locked', g.locked, 'unlocked', g.unlocked,
        'ts', g.ts, 'org', g.org,
        'pos', g.pos, 'posTs', g.pos_ts, 'posOrg', g.pos_org,
        'shared', exists (select 1 from public.memberships mm where mm.group_id = g.id),
        'mount', case when g.mount_id is null then null else jsonb_build_object(
          'parent', g.mount_parent, 'pos', g.mount_pos, 'trashed', g.mount_trashed) end)) from my_groups g), '[]'::jsonb),
    'cards', coalesce((select jsonb_agg(jsonb_build_object(
        'id', c.id, 'owner', c.owner_id, 'mine', c.owner_id = uid,
        'group', c.group_id,
        'title', c.title, 'trashed', c.trashed, 'locked', c.locked, 'unlocked', c.unlocked,
        'k', c.k, 'p', c.p, 'labTs', c.lab_ts, 'labOrg', c.lab_org,
        'responsible', c.responsible,
        'start', c.start_at, 'due', c.due_at, 'lockTimes', c.lock_times,
        'ts', c.ts, 'org', c.org,
        'pos', c.pos, 'posTs', c.pos_ts, 'posOrg', c.pos_org,
        'shared', exists (select 1 from public.memberships mm where mm.card_id = c.id),
        'mount', case when c.mount_id is null then null else jsonb_build_object(
          'parent', c.mount_parent, 'pos', c.mount_pos, 'trashed', c.mount_trashed) end)) from my_cards c), '[]'::jsonb),
    'items', coalesce((select jsonb_agg(jsonb_build_object(
        'id', i.id, 'owner', i.owner_id, 'mine', i.owner_id = uid,
        'home', i.card_id, 'cat', i.cat_id, 'isCat', i.is_cat, 'lockTimes', i.lock_times,
        'text', i.text, 'trashed', i.trashed, 'done', i.done,
        'responsible', i.responsible,
        'start', i.start_at, 'due', i.due_at,
        'ts', i.ts, 'org', i.org,
        'pos', i.pos, 'posTs', i.pos_ts, 'posOrg', i.pos_org)) from my_items i), '[]'::jsonb),
    'invites_in', coalesce((select jsonb_agg(jsonb_build_object(
        'id', s.id, 'type', case when s.universe_id is not null then 'universe'
                                 when s.group_id is not null then 'group'
                                 else 'card' end,
        'name', coalesce((select name from public.universes where id = s.universe_id),
                         (select name from public.groups    where id = s.group_id),
                         (select title from public.cards    where id = s.card_id)),
        'from', (select email from public.profiles where id = s.inviter_id),
        'created_at', s.created_at) order by s.created_at)
      from public.share_invites s
      where s.status = 'pending'
        and (s.invitee_id = uid
             or lower(s.invitee_email) = (select lower(email) from public.profiles where id = uid))), '[]'::jsonb),
    'invites_out', coalesce((select jsonb_agg(jsonb_build_object(
        'id', s.id, 'type', case when s.universe_id is not null then 'universe'
                                 when s.group_id is not null then 'group'
                                 else 'card' end,
        'target_id', coalesce(s.universe_id, s.group_id, s.card_id),
        'email', s.invitee_email, 'created_at', s.created_at) order by s.created_at)
      from public.share_invites s
      where s.status = 'pending' and s.inviter_id = uid), '[]'::jsonb)
  ) into result;

  return result;
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

  for r in select * from jsonb_array_elements(coalesce(p_doc -> 'universes', '[]'::jsonb)) loop
    insert into public.universes as t (id, owner_id, name, trashed, ts, org, pos, pos_ts, pos_org)
    values (public.legacy_uuid(uid, r ->> 'id'), uid,
            coalesce(r ->> 'name', ''), coalesce((r ->> 'trashed')::boolean, false),
            coalesce((r ->> 'ts')::bigint, 0), coalesce(r ->> 'org', ''),
            coalesce((r ->> 'pos')::double precision, 0),
            coalesce((r ->> 'posTs')::bigint, 0), coalesce(r ->> 'posOrg', ''))
    on conflict (id) do update
      set name = excluded.name, trashed = excluded.trashed,
          ts = excluded.ts, org = excluded.org,
          pos = excluded.pos, pos_ts = excluded.pos_ts, pos_org = excluded.pos_org
      where t.owner_id = uid;
    n_uni := n_uni + 1;
  end loop;

  for r in select * from jsonb_array_elements(coalesce(p_doc -> 'groups', '[]'::jsonb)) loop
    continue when not exists (
      select 1 from public.universes u
      where u.id = public.legacy_uuid(uid, r ->> 'uni') and u.owner_id = uid);
    insert into public.groups as t (id, owner_id, universe_id, name, trashed, ts, org, pos, pos_ts, pos_org)
    values (public.legacy_uuid(uid, r ->> 'id'), uid, public.legacy_uuid(uid, r ->> 'uni'),
            coalesce(r ->> 'name', ''), coalesce((r ->> 'trashed')::boolean, false),
            coalesce((r ->> 'ts')::bigint, 0), coalesce(r ->> 'org', ''),
            coalesce((r ->> 'pos')::double precision, 0),
            coalesce((r ->> 'posTs')::bigint, 0), coalesce(r ->> 'posOrg', ''))
    on conflict (id) do update
      set universe_id = excluded.universe_id, name = excluded.name,
          trashed = excluded.trashed, ts = excluded.ts, org = excluded.org,
          pos = excluded.pos, pos_ts = excluded.pos_ts, pos_org = excluded.pos_org
      where t.owner_id = uid;
    n_grp := n_grp + 1;
  end loop;

  for r in select * from jsonb_array_elements(coalesce(p_doc -> 'cards', '[]'::jsonb)) loop
    continue when not exists (
      select 1 from public.groups g
      where g.id = public.legacy_uuid(uid, r ->> 'group') and g.owner_id = uid);
    insert into public.cards as t (id, owner_id, group_id, title, trashed, k, p,
                                   start_at, due_at, lock_times,
                                   ts, org, lab_ts, lab_org, pos, pos_ts, pos_org)
    values (public.legacy_uuid(uid, r ->> 'id'), uid, public.legacy_uuid(uid, r ->> 'group'),
            coalesce(r ->> 'title', ''), coalesce((r ->> 'trashed')::boolean, false),
            coalesce((r ->> 'k')::boolean, true), coalesce((r ->> 'p')::boolean, true),
            r ->> 'start', r ->> 'due', coalesce((r ->> 'lockTimes')::boolean, false),
            coalesce((r ->> 'ts')::bigint, 0), coalesce(r ->> 'org', ''),
            coalesce((r ->> 'labTs')::bigint, 0), coalesce(r ->> 'labOrg', ''),
            coalesce((r ->> 'pos')::double precision, 0),
            coalesce((r ->> 'posTs')::bigint, 0), coalesce(r ->> 'posOrg', ''))
    on conflict (id) do update
      set group_id = excluded.group_id, title = excluded.title,
          trashed = excluded.trashed, k = excluded.k, p = excluded.p,
          start_at = excluded.start_at, due_at = excluded.due_at,
          lock_times = excluded.lock_times,
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
    insert into public.items as t (id, owner_id, card_id, cat_id, is_cat, lock_times, text, trashed, done,
                                   start_at, due_at, ts, org, pos, pos_ts, pos_org)
    values (public.legacy_uuid(uid, r ->> 'id'), uid, public.legacy_uuid(uid, r ->> 'home'),
            case when r ->> 'cat' is null then null else public.legacy_uuid(uid, r ->> 'cat') end,
            coalesce((r ->> 'isCat')::boolean, false), coalesce((r ->> 'lockTimes')::boolean, false),
            coalesce(r ->> 'text', ''), coalesce((r ->> 'trashed')::boolean, false),
            coalesce((r ->> 'done')::boolean, false),
            r ->> 'start', r ->> 'due',
            coalesce((r ->> 'ts')::bigint, 0), coalesce(r ->> 'org', ''),
            coalesce((r ->> 'pos')::double precision, 0),
            coalesce((r ->> 'posTs')::bigint, 0), coalesce(r ->> 'posOrg', ''))
    on conflict (id) do update
      set card_id = excluded.card_id, cat_id = excluded.cat_id,
          is_cat = excluded.is_cat, lock_times = excluded.lock_times, text = excluded.text,
          trashed = excluded.trashed, done = excluded.done,
          start_at = excluded.start_at, due_at = excluded.due_at,
          ts = excluded.ts, org = excluded.org,
          pos = excluded.pos, pos_ts = excluded.pos_ts, pos_org = excluded.pos_org
      where t.owner_id = uid;
    n_item := n_item + 1;
  end loop;

  return jsonb_build_object('universes', n_uni, 'groups', n_grp,
                            'cards', n_card, 'items', n_item);
end;
$$;

-- ------------------------------------------------------------
-- 11. RETTIGHETER — alt nytt er kun for innloggede (authenticated);
--     anon har ingen tilgang (den gamle lists-modellen beholder sin).
-- ------------------------------------------------------------

revoke all on public.profiles, public.universes, public.groups, public.cards,
              public.items, public.memberships, public.share_invites,
              public.tombstones from anon;

-- profiles: e-posten speiles KUN fra auth.users (triggerne over) og er
-- skrivebeskyttet for klienter — ellers kunne en bruker kapre ventende
-- invitasjoner (aksept sammenligner mot profiles.email) eller blokkere
-- andres registrering via unik-indeksen. Kun display_name kan endres.
grant select on public.profiles to authenticated;
revoke update on public.profiles from authenticated;
grant update (display_name) on public.profiles to authenticated;
grant select, insert, update, delete on public.universes, public.groups,
                                        public.cards, public.items to authenticated;
grant select, update, delete on public.memberships to authenticated;
grant select, delete on public.share_invites to authenticated;
grant select on public.tombstones to authenticated;

do $$
declare fn text;
begin
  foreach fn in array array[
    'public.create_share_invite(text, uuid, text)',
    'public.accept_share_invite(uuid, uuid, double precision)',
    'public.decline_share_invite(uuid)',
    'public.revoke_share_invite(uuid)',
    'public.revoke_share(text, uuid, uuid)',
    'public.leave_share(text, uuid)',
    'public.set_locked(text, uuid, boolean)',
    'public.set_unlocked(text, uuid, boolean)',
    'public.get_members(text, uuid)',
    'public.get_my_doc()',
    'public.import_doc(jsonb)'
  ] loop
    execute format('revoke execute on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
end $$;

-- ------------------------------------------------------------
-- 12. REALTIME — legg tabellene i supabase_realtime-publikasjonen
--     (postgres_changes med RLS-filtrering i klienten, fase 2).
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
-- 13. ENGANGS-SEED: navn på de to første kontoene
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
