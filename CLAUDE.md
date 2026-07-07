# CLAUDE.md — Arbeidsdokument

Personlig arbeidsnotat for utvikling av **Huskekurv-appen**. Oppdateres underveis.

## Mål (fra oppgaven)

En app med to faner: **Huskelister** og **Handlelister**. De fungerer helt likt.

I hver fane:
- Legge til / slette / redigere / endre rekkefølge på **kategorier**.
- Hver kategori er sitt eget **kort**.
- Kortene vises **kolonnevis** (masonry-aktig) slik at man ser flest mulig kort samtidig.
- Endre rekkefølge på kort via **dra-og-slipp** med håndtak:
  - Når man tar tak i et kort løftes det opp og følger musepekeren.
  - En **placeholder** vises der kortet var.
  - Når dra-kortets **øvre kant** passerer **nederste femtedel** av et annet kort, bytter de plass;
    det andre kortet flyttes, og en ny placeholder avdekkes der dra-kortet vil lande.
  - Tilsvarende oppover og nedover.
  - Kort kan bytte plass **på tvers av kolonner**.
- Endre **navn** på kategori ved å klikke på tittelen.

Inne i kortene:
- Legge til / slette / redigere / endre rekkefølge på **elementer**.
- Samme dra-og-slipp-oppførsel.
- Elementer kan **overføres mellom kategorier**.

Design:
- Fint, ryddig, oversiktlig, brukervennlig UI. Responsivt (desktop + mobil).
- **Quicksand**-fonten (Google Fonts) på alt.
- Kortene har **ulike, tilfeldige farger** fra en **pen fargepalett** for visuell separasjon.

## Valgt arkitektur

- **Ren statisk app**: `index.html` + `styles.css` + `app.js`. Ingen byggesteg, ingen rammeverk.
  - Enkelt å kjøre (`python3 -m http.server`) og enkelt å deploye hvor som helst.
- **Vanilla JS** med egen dra-og-slipp-motor bygget på **Pointer Events** (fungerer likt for mus og touch).
  - Egen motor fordi kravene (øvre kant vs. nederste femtedel, kryss-kolonne, placeholder) er svært spesifikke.
- **Persistens** i `localStorage`.
- **Datamodell**:
  ```js
  state = {
    activeTab: 'huskelister' | 'handlelister',
    tabs: {
      huskelister: { cards: [ { id, title, color, items: [ { id, text } ] } ] },
      handlelister: { cards: [ ... ] }
    }
  }
  ```

## Dra-og-slipp-logikk (kjernen)

Bytte utløses av **overlapp**, ikke av et punkt:
- Når dra-elementets boks overlapper et annet kort/element med **≥ 20 % av høyden**, bytter de plass.
- Byttet er **retningsstyrt** (hysterese mot flimring): drar man **nedover** byttes kun med kortet **under**,
  drar man **oppover** kun med kortet **over**. Rett etter et bytte forskyves nabokortet så mye at det
  motsatte byttet ikke trigges umiddelbart → stabilt, men «ivrig» (bytter tidlig).
- **Kolonne** = kort som ligger på samme horisontale spor (≥ 50 % horisontal overlapp med dra-kortet).
  Føres dra-kortet inn i en **annen kolonne**, plasseres placeholderen ut fra vertikal senterposisjon
  (kryss-kolonne). For elementer tilsvarer dette **overføring til en annen `.items-container`** (kategori).
- **FLIP-animasjon (150 ms)**: før hver placeholder-flytting tas et øyeblikksbilde av kortenes/elementenes
  posisjoner (`getBoundingClientRect`); etter flyttingen inverteres differansen med `transform` og animeres
  til 0. Ved slipp animeres dra-elementet fra flytende posisjon inn i placeholder-sloten.
- `layoutRect()` trekker fra en evt. pågående FLIP-`transform` (via `DOMMatrix`) slik at treffdeteksjonen
  bruker **hvilende** layout-posisjoner selv midt i en animasjon → ingen dobbeltbytter.
- Kort-DnD reflower automatisk fordi layouten er `CSS multi-column` og rekkefølgen bestemmes av DOM-rekkefølge.
- Under draging manipuleres DOM direkte (for ytelse); state bygges opp igjen fra DOM ved slipp, så re-render.

## Sanntids-synk (Supabase) med felt-nivå fletting

Listene synkes **fortløpende** mellom enheter via **Supabase**. Alle enheter som deler samme
hemmelige synk-kode (utledet fra innloggingsmønsteret) holdes i synk uten å laste siden på nytt.
Endringer på én enhet dukker opp på de andre «med det samme».

Målet er at enheter alltid er **reelt** i synk, og at samtidige endringer på ulike
kort/elementer aldri overskriver hverandre (à la hvordan git merger brancher — konflikt kun
når *samme* element endres to steder).

### To mekanismer sikrer at ingenting går tapt

1. **Fletting på felt-nivå (CRDT-lett)** — hele tilstanden ligger fortsatt som **ett `jsonb`-doc**,
   men hver entitet har egne «registre» med logisk tidsstempel:
   - **innhold** (`ts`, `org`): kortets tittel/farge/`trashed`, elementets tekst.
   - **posisjon** (`posTs`, `posOrg`): rekkefølge (`pos`, fraksjonsindeksering) + elementets
     forelder (`home`).
   Ved fletting velges nyeste verdi per register (LWW; `org`/enhets-id bryter uavgjort
   deterministisk). Endringer på ulike kort/elementer/felter kolliderer aldri; kun samme register
   endret to steder «konflikter», og da vinner nyeste. `tick()` er en **hybrid logisk klokke**
   (monotont voksende) så den tåler at enhetenes veggklokker går i utakt.
   - **Sletting** bruker **gravsteiner** (`_tomb.cards` / `_tomb.items`: id → tidsstempel) så en
     sletting ikke «gjenoppstår» fra en foreldet enhet. Å tømme papirkurven gir permanent
     gravstein; sletting av enkelt-element likeså. Papirkurv = kort med `trashed: true`.
   - `activeTab` er **per enhet** og synkes ikke.
2. **Optimistisk samtidighetskontroll (CAS) i databasen** — raden har en `version`-teller.
   `save_list` skriver kun hvis klientens forventede versjon stemmer; ellers får klienten
   gjeldende `{data, version}` tilbake, **fletter lokalt, og prøver igjen**. Dermed kan aldri
   én enhet overskrive en annen enhets samtidige skriving.

### Live-oppdatering

- **Supabase Realtime (broadcast)**: hver enhet abonnerer på en kanal utledet fra synk-koden
  (`sha256('rt|' + kode)`). Etter en vellykket skriving kringkastes «changed» + versjon, og de
  andre enhetene henter + fletter straks. Broadcast krever **ingen** ekstra databaseoppsett.
- **Poll-fallback**: enhetene poller også (hyppig når realtime er nede, sjeldnere ellers), og
  synker straks når fanen får fokus / nettet kommer tilbake. Slik er man i synk selv om realtime
  skulle feile eller mobilen suspenderer socket-en.
- **UI**: «Synk»-knappen har ikke lenger en (misvisende) statusprikk — synken bare virker. Når en
  endring kommer fra en annen enhet, vises et lite, forbigående varsel («Oppdatert fra en annen
  enhet»). Modalen forklarer synken og har «Logg ut».

### Klient (kort)

- **`config.js`** holder `window.SUPABASE_CONFIG` (`url` + `anonKey`). Så lenge plassholderne
  (`DIN_...`) står, eller Supabase-biblioteket ikke lastes / nettet er nede, kjører appen lokalt
  (localStorage) og **degraderer pent**. Ny enhet med sky konfigurert starter **tom** (skyen
  fyller på); helt uten sky brukes eksempeldata.
- **`syncCycle()`** er én serialisert runde: **pull → flett → (evt.) push**. Den kalles debouncet
  ved lokale endringer, på broadcast, ved poll, og når fanen får fokus. `docFromState()` /
  `applyDoc()` mapper mellom synk-doc og `state`; `canonical()` gir rekkefølge-uavhengig likhet
  (så en runde uten reell endring ikke pusher).
- Interne synk-funksjoner er eksponert på `window.__huskekurv` for testing
  (`mergeStates`, `canonical`, `docFromState`, `syncCycle`, …).

### SQL som må kjøres i Supabase (SQL Editor)

**Etter denne endringen må SQL-en kjøres på nytt** (idempotent — kan også kjøres via GitHub
Actionen «Supabase DB-oppsett»). Den legger til `version`-kolonnen og bytter `save_list` til
CAS-varianten. Full SQL ligger i `supabase/setup.sql`. Kort oppsummert:

```sql
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.lists (
  code_hash  text primary key,
  data       jsonb not null,
  version    bigint not null default 0,
  updated_at timestamptz not null default now()
);
alter table public.lists add column if not exists version bigint not null default 0;

alter table public.lists enable row level security;  -- ingen policy → ingen direkte tilgang

-- get_list returnerer nå BÅDE data og versjon: { data, version }
create or replace function public.get_list(p_code text)
returns jsonb language sql security definer set search_path = public, extensions as $$
  select jsonb_build_object('data', data, 'version', version)
  from public.lists
  where code_hash = encode(digest(p_code, 'sha256'), 'hex');
$$;

drop function if exists public.save_list(text, jsonb);

-- save_list gjør compare-and-swap: skriver kun hvis p_prev_version stemmer,
-- ellers returneres gjeldende { ok:false, version, data } for fletting + nytt forsøk.
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
  return jsonb_build_object('ok', false,
    'version', (select version from public.lists where code_hash = h),
    'data',    (select data    from public.lists where code_hash = h));
end;
$$;

grant execute on function public.get_list(text)                 to anon;
grant execute on function public.save_list(text, jsonb, bigint) to anon;
```

**Merk:** i Supabase ligger `pgcrypto` (og dermed `digest()`) normalt i skjemaet
`extensions`, ikke `public`. Funksjonene må derfor ha `extensions` i `search_path` i
tillegg til `public` — ellers feiler kallet med
`function digest(text, unknown) does not exist`.

## Innlogging (mønster-lås)

Appen åpner med en **splash-screen** der man tegner et mønster i et **3x3-rutenett**
(à la Android). Ingen appinnhold vises før riktig mønster er tegnet (`body.locked`
skjuler `.app-header` + `.app-main`; en fast overlay `#lock-screen` ligger over).

- **Punkter** nummereres `rad,kolonne` (1-basert). Hvert punkt har en sirkel med
  treffradius ≈ halve cellebredden (`SNAP_R = 44` i et `300x300`-viewBox). Når pekeren
  er innenfor sirkelen, låses linjen til punktet.
- **Bevegelse kun til nærmeste nabo** (Chebyshev-avstand 1), horisontalt/vertikalt/diagonalt.
  Trekker man en rett linje **2 unna** (f.eks. `1,1`→`1,3`), settes **mellompunktet**
  (`1,2`) automatisk inn. «Knight»-hopp og lengre sprang ignoreres.
- **Fasit** ligger kun som en **SHA-256-hash** i koden (`PATTERN_HASH`), ikke i klartekst.
  Riktig mønster: `1,1-2,1-2,2-1,2-1,3-2,3-3,3-3,2-3,1`.
- **Lås ved for mange feil**: mer enn 5 gale forsøk → innlogging **låst i 5 minutter**
  (nedtelling vises; teller/tidspunkt i `localStorage`).
- **Husket innlogging**: ved suksess settes `mine-lister-auth` i `localStorage` – huskes
  til man **logger ut** (knapp i Synk-modalen → `location.reload()`).
- **Synk-kobling**: synk-koden **utledes fra mønsteret** (`sha256('sync|' + mønster)`),
  så samme mønster gir de samme listene på alle enheter – ingen egen kode å taste.
  (Merk: for en ren statisk app er dette gate-nivå sikkerhet; ekte serverside-auth
  ville kreve f.eks. Supabase Auth med magisk lenke.)

## Databaseoppsett via GitHub Actions

- **`supabase/setup.sql`** inneholder hele skjemaet (tabell + `get_list`/`save_list` + grants), idempotent.
- **`.github/workflows/db-setup.yml`** kjører SQL-en mot Supabase med `psql` (følger med på
  ubuntu-runneren). Startes manuelt via **Actions → Supabase DB-oppsett → Run workflow**.
- Krever repository-secret **`SUPABASE_DB_URL`** = tilkoblingsstrengen (Project Settings →
  Database → Connection string → URI, med passordet innsatt). Alternativt kan SQL-en limes
  rett inn i Supabase sin SQL Editor.

## Papirkurv

- Å slette en **kategori** setter `trashed: true` på kortet (i stedet for en egen `trash`-array)
  slik at «papirkurv-tilstanden» er et felt som synkes/flettes som alt annet.
- «Papirkurv»-knappen i verktøylinja viser antall og åpner en modal med de slettede kategoriene.
- Der kan man **Gjenopprett**e enkeltkategorier (`trashed: false`) eller trykke **Tøm papirkurv**
  for å slette **permanent** (med bekreftelse) — det gir en **gravstein** (`_tomb.cards`).
  Sletting av enkelt-**elementer** er fortsatt permanent og gir gravstein (`_tomb.items`).

## Fargepalett

Myke, harmoniske pastellfarger. Mørk tekst (`#37343f`) for god kontrast. Header-farge = litt mørkere
variant av kortfargen (via `darken()`). Farge lagres per kort så den er stabil, og velges tilfeldig men
unngår å gjenta forrige korts farge.

## Status / TODO

- [x] Prosjektoppsett + CLAUDE.md
- [x] HTML-skjelett + faner
- [x] CSS (responsivt, Quicksand, palett, kolonner)
- [x] State + persistens
- [x] Render av kort og elementer
- [x] Klikk-for-å-redigere tittel og elementer
- [x] Legg til / slett kategori og element
- [x] Dra-og-slipp for kort (kryss-kolonne, placeholder, 20 % overlapp-terskel)
- [x] Dra-og-slipp for elementer (inkl. overføring mellom kort)
- [x] FLIP-animasjon (150 ms) ved bytte og ved slipp
- [x] Papirkurv (slett kategori → `trashed`, gjenopprett, tøm permanent → gravstein)
- [x] Testet i nettleser (Playwright) — kort-reorder, element-reorder, element-overføring, papirkurv
- [x] Mobiltilpasning (touch-action, responsiv layout)
- [x] Sanntids-synk mellom enheter (Supabase Realtime broadcast + poll-fallback)
- [x] Felt-nivå fletting (CRDT-lett): samtidige endringer på ulike kort/elementer går ikke tapt
- [x] CAS i databasen (`version` + `save_list`) så ingen enhet overskriver en annens skriving
- [x] Gravsteiner for sletting; `activeTab` per enhet (synkes ikke)
- [x] Fjernet misvisende synk-statusprikk; lite «oppdatert»-varsel ved fjern-endringer
- [x] Testet fletting + to-enhets-konvergens + live-broadcast (Playwright, falsk delt backend)

## Hvordan kjøre

```bash
cd /home/user/huskeliste
python3 -m http.server 8000
# åpne http://localhost:8000
```

## Notater / beslutninger

- Håndtak (`.drag-handle`) har `touch-action: none` så draging ikke scroller siden på mobil.
- Draging starter kun fra håndtaket; klikk på tittel/element-tekst redigerer i stedet.
- `pointercapture` brukes så draging ikke mister eventer.
