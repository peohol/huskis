# CLAUDE.md — Arbeidsdokument

Personlig arbeidsnotat for utvikling av **Huskeliste-appen**. Oppdateres underveis.

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

## Sky-synk (Supabase, synk-kode)

Listene kan synkes mellom enheter via **Supabase**. Første variant bruker en **synk-kode**
(ingen innlogging): alle enheter som skriver samme hemmelige kode deler de samme listene.

- **`config.js`** holder `window.SUPABASE_CONFIG` (`url` + `anonKey`). Så lenge plassholderne
  (`DIN_...`) står, kjører appen lokalt (localStorage) uten synk. Appen **degraderer pent** hvis
  Supabase-biblioteket ikke lastes / nettet er nede → fortsetter lokalt.
- **Datamodell i skyen**: hele `state`-objektet lagres som **ett `jsonb`-felt** i én rad,
  identifisert av `sha256(synk-kode)`. Tabellen er låst med Row Level Security (ingen policy),
  og all tilgang går via to `SECURITY DEFINER`-funksjoner slik at man trenger koden for å nå dataene:
  - `get_list(p_code text) → jsonb`
  - `save_list(p_code text, p_data jsonb) → void`
- **Klient**: `app.js` lager en Supabase-klient lazy og kaller `rpc('get_list' | 'save_list')`.
  `save()` pusher til skyen (debouncet 800 ms, serialisert – én lagring om gangen). Ved oppstart
  hentes skyens versjon (**skyen vinner** ved oppstart). Modellen er ellers **«sist lagret vinner»**.
- **UI**: «Synk»-knapp i verktøylinja med statusprikk (grå=av, grønn=tilkoblet, gul=lagrer, rød=feil)
  og en modal for å koble til/fra med kode.

### SQL som må kjøres i Supabase (SQL Editor)

```sql
create extension if not exists pgcrypto;

create table public.lists (
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
```

## Papirkurv

- Å slette en **kategori** flytter den til `tabs[tab].trash` (per fane) i stedet for å slette den.
- «Papirkurv»-knappen i verktøylinja viser antall og åpner en modal med de slettede kategoriene.
- Der kan man **Gjenopprett**e enkeltkategorier eller trykke **Tøm papirkurv** for å slette **permanent**
  (med bekreftelse). Sletting av enkelt-**elementer** i et kort er fortsatt permanent.

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
- [x] Papirkurv (slett kategori → papirkurv, gjenopprett, tøm permanent)
- [x] Testet i nettleser (Playwright) — kort-reorder, element-reorder, element-overføring, papirkurv
- [x] Mobiltilpasning (touch-action, responsiv layout)

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
