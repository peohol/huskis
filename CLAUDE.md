# CLAUDE.md — Arbeidsdokument

Personlig arbeidsnotat for utvikling av **Huskekurv-appen**. Oppdateres underveis.

## Mål (fra oppgaven)

> **Omorganisering (juli 2026):** De to faste fanene (Huskelister/Handlelister) er
> erstattet av et **selvvalgt antall grupper**. Inndelingen er nå
> **Gruppe > Liste > Element** (der «Liste» = det gamle «kategori»-kortet, og
> «Element» er uendret). Apptittelen «🧺 Huskekurv» er fjernet fra headeren, som
> i stedet viser en rad med gruppene (se «Grupper (header)»). Gammel data
> migreres til to grupper «Huskelister»/«Handlelister» (se «Migrering»).

En app organisert som **Gruppe > Liste > Element**:
- Opprette / slette / endre rekkefølge på / endre navn på **grupper** (i headeren).
- **Søppelkasse på alle tre nivåer** (grupper, lister, elementer): sletting legger i en
  gjenopprettbar søppelkasse (`trashed`-flagg), ikke permanent. Se «Søppelkasser».

I hver gruppe (helt som de gamle fanene fungerte):
- Legge til / slette / redigere / endre rekkefølge på **lister** (tidl. «kategorier»).
- Hver liste er sitt eget **kort**.
- Kortene vises **kolonnevis** (masonry-aktig) slik at man ser flest mulig kort samtidig.
- Endre rekkefølge på kort via **dra-og-slipp** med håndtak:
  - Når man tar tak i et kort løftes det opp og følger musepekeren.
  - En **placeholder** vises der kortet var.
  - Når dra-kortets **øvre kant** passerer **nederste femtedel** av et annet kort, bytter de plass;
    det andre kortet flyttes, og en ny placeholder avdekkes der dra-kortet vil lande.
  - Tilsvarende oppover og nedover.
  - Kort kan bytte plass **på tvers av kolonner**.
- Endre **navn** på kategori ved å klikke på tittelen.

Inne i kortene (listene):
- Legge til / slette / redigere / endre rekkefølge på **elementer**.
- Samme dra-og-slipp-oppførsel.
- Elementer kan **overføres mellom lister** (i samme gruppe).

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
- **Datamodell** (nøstet i minnet for rendring, flat i synk-doc'et):
  ```js
  state = {
    activeGroup: <groupId>,        // per enhet, synkes ikke (erstatter activeTab)
    groups: [
      { id, name, trashed, pos,    // + synk-registre: ts/org (navn/trashed), posTs/posOrg (rekkefølge)
        cards: [                   // «lister» (tidl. kategorier)
          { id, group, title, color, trashed, k, p,
            items: [ { id, text, trashed, home } ] }   // home = kortets id (forelder)
        ] }
    ],
    _tomb: { groups:{}, cards:{}, items:{} },  // gravsteiner: id → tidsstempel
  }
  ```
  Hierarkiet har forelder-peker på hvert nivå: `element.home → kort`, `kort.group → gruppe`.
  (`k`/`p` = merkelapp-brytere per liste, se «Merkelapper (K/P) + filter».)

## Grupper (header)

Headeren ligger **fast øverst** (`position: fixed`, uavhengig av scrolling — mer robust
enn `sticky`, som svikter med `backdrop-filter` på iOS Safari) og alt annet innhold scroller
bak den. Siden en fast header er ute av flyten, måles høyden i JS (`ResizeObserver`) og
eksponeres som `--header-h` så `.app-main` får riktig topp-padding (høyden varierer med
gruppe-radens ombrekking / antall grupper / mobil↔desktop). Headeren viser en
**venstreorientert rad** med gruppekort (`#groups-bar`), etterfulgt av en **«＋»-knapp** som
oppretter ny gruppe.

- **Gruppekort** (`.group-card`, mal `#group-template`) ser ut som et liste-element:
  håndtak til venstre, navn i midten, slett-knapp til høyre — men **bredden følger navnet**
  (`display: inline-flex`, `flex: 0 0 auto`; svært lange navn kappes med ellipsis ved
  `max-width`). Etter navnet vises **antall lister i gruppen** som et **dempet tall**
  (`.group-count`, `opacity ~0.42`) — mindre «pop» enn navnet. Det aktive kortet er grønt.
- **Bytte gruppe**: klikk på et kort gjør gruppen aktiv (board-et tegner dens lister).
  Klikk på **navnet til den allerede aktive** gruppen redigerer navnet inline (input som
  vokser med innholdet, `editText(..., { cls:'group-edit', autosize:true })`).
- **Slette gruppe**: sletter gruppen + **alle dens lister/elementer permanent** (bekreftelse
  om den ikke er tom) og legger gravsteiner (`_tomb.groups/cards/items`).
- **Rekkefølge**: dra-og-slipp via håndtaket, med **placeholder + FLIP** som kort/elementer
  (`startGroupDrag`/`updateGroupPlacement`/`onGroupUp`). Samme **ivrige, retningsstyrte
  bytte** som lister/elementer, men transponert til den horisontale raden: en **rad** =
  gruppekort med ≥ 50 % vertikal overlapp med dra-kortet (analogt til «kolonne» for kort).
  Innen raden byttes ved ≥ 20 % **breddeoverlapp** retningsstyrt (dra høyre → kortet til
  høyre; dra venstre → til venstre). Føres kortet til en **annen rad** (desktop-wrap),
  plasseres placeholderen ut fra horisontal senterposisjon (kryss-rad, analogt til
  kryss-kolonne). «Etter siste kort» legger placeholderen foran «＋». Løftet kort roterer
  som vanlige kort (`cardRotation()`).

**Responsiv layout:**
- **Desktop**: raden **bryter til flere rader** (`flex-wrap: wrap`) når gruppene fyller
  bredden; «＋» flyter etter siste kort på siste rad.
- **Mobil** (`max-width: 560px`): gruppene ligger alltid på **én rad** med **horisontal
  scroll**. Ved overflow vises en **diskret, app-tilpasset scrollbar** (tynn «flytende»
  thumb i dempet ink-tone, med luft rundt via transparent kant + `background-clip`, og
  header-paddingen som luft ned mot kanten). På ekte touch-enheter er nettleserens scrollbar
  uansett overlay/skjult, så dette treffer først og fremst **smale PC-vinduer** (der
  mobil-layoutet også slår inn) og gir en synlig scroll-indikator. Får kortene plass, vises
  «＋» (og evt. søppelkassen) inline i raden.
  **Overskrider** kortene bredden (`updateGroupsOverflow()` setter `.groups-overflow` på
  headeren), legges **to faste, full-høyde soner** utenfor scroll-feltet: **«＋» til høyre**
  (`.groups-pin`) og **søppelkassen til venstre** (`.groups-trash-pin`, kun når den har
  innhold) — begge `position: absolute`, `top/bottom: 0`. Hver sone er en **ugjennomsiktig**
  blokk (`--header-solid`) med en **smal fade på innsiden** (mot kortene), satt som én
  gradient på selve sonen (solid → transparent) så det ikke blir noen synlig skjøt. Selve
  scroll-feltet (gruppe-raden) er **klemt mellom sonene** via bar-marger (`margin-left/right`
  = sonenes solide bredde), så kortene scroller **aldri bak** sonene — feltet slutter nøyaktig
  der en sone begynner, og kortene oppløses i innsidefaden. Fadene er **like brede** på begge
  sider (`--fade-w: 14px`), og kortenes **hvile-innrykk = fade-bredden** (`padding: 0 var(--fade-w)`).
  De faste sonene er `pointer-events: none` (kun knappene fanger), så et kort delvis under en
  fade er fortsatt trykkbart. Overflow-**målingen** er flip-flop-fri: den summerer kortenes egne
  bredder + faste sone-/fade-bredder og sammenligner mot viewporten (uavhengig av
  `.groups-overflow`-klassen, som ellers endrer bar-bredden). På desktop / uten overflow er
  søppelkassen i stedet **inline** i raden (`#groups-trash`); ved overflow skjules den og
  `.groups-trash-pin` overtar. Under gruppe-draging auto-scroller raden horisontalt når
  pekeren nærmer seg venstre/høyre kant (`updateGroupAutoScroll`).

## Dra-og-slipp-logikk (kjernen)

Bytte utløses av **overlapp**, ikke av et punkt:
- Når dra-elementets boks overlapper et annet kort/element med **≥ 20 % av høyden**, bytter de plass.
- Byttet er **retningsstyrt** (hysterese mot flimring): drar man **nedover** byttes kun med kortet **under**,
  drar man **oppover** kun med kortet **over**. Rett etter et bytte forskyves nabokortet så mye at det
  motsatte byttet ikke trigges umiddelbart → stabilt, men «ivrig» (bytter tidlig).
- **Kolonne** = kort som ligger på samme horisontale spor (≥ 50 % horisontal overlapp med dra-kortet).
  Føres dra-kortet inn i en **annen kolonne**, plasseres placeholderen ut fra vertikal senterposisjon
  (kryss-kolonne). For elementer tilsvarer dette **overføring til en annen `.items-container`** (liste).
- **FLIP-animasjon (150 ms)**: før hver placeholder-flytting tas et øyeblikksbilde av kortenes/elementenes
  posisjoner (`getBoundingClientRect`); etter flyttingen inverteres differansen med `transform` og animeres
  til 0. Ved slipp animeres dra-elementet fra flytende posisjon inn i placeholder-sloten.
- `layoutRect()` trekker fra en evt. pågående FLIP-`transform` (via `DOMMatrix`) slik at treffdeteksjonen
  bruker **hvilende** layout-posisjoner selv midt i en animasjon → ingen dobbeltbytter.
- Kort-DnD reflower automatisk fordi layouten er `CSS multi-column` og rekkefølgen bestemmes av DOM-rekkefølge.
- Under draging manipuleres DOM direkte (for ytelse); state bygges opp igjen fra DOM ved slipp, så re-render.
- **Dynamisk rotasjon av dra-kortet** (`cardRotation()`, `MAX_ROT = 5`): kortet vippes ut fra sin
  horisontale posisjon — `−5°` inntil venstre ytterkant, `0°` midtstilt, `+5°` inntil høyre ytterkant.
  Normaliseres mot det oppnåelige senter-området (halve kortbredden inn fra hver kant) så
  ytterpunktene faktisk nås. Settes inline som `transform: rotate(…) scale(1.02)` på hver
  peker-bevegelse; `.card.dragging` har kun `scale(1.02)` som fallback. Elementer roterer ikke.
- **Auto-scroll ved kant** (`updateAutoScroll` + `startAutoScroll`, kun for kort): når pekeren nærmer
  seg topp/bunn av vinduet ruller siden — **sakte** i ytterkanten av sonen, **raskere** jo lengre ut,
  og raskest når kortet holdes forbi selve kanten (`edgeSpeed`, sone = 120 px). Kortet er `fixed`, så
  for at de andre kortene skal bytte plass under rullingen re-kjøres plasseringslogikken
  (`updateCardPlacement(0, ±1)`) med rulleretningen som syntetisk drag-retning på hver frame.

## Sanntids-synk (Supabase) med felt-nivå fletting

Listene synkes **fortløpende** mellom enheter via **Supabase**. Alle enheter som deler samme
hemmelige synk-kode (utledet fra innloggingsmønsteret) holdes i synk uten å laste siden på nytt.
Endringer på én enhet dukker opp på de andre «med det samme».

Målet er at enheter alltid er **reelt** i synk, og at samtidige endringer på ulike
kort/elementer aldri overskriver hverandre (à la hvordan git merger brancher — konflikt kun
når *samme* element endres to steder).

### To mekanismer sikrer at ingenting går tapt

1. **Fletting på felt-nivå (CRDT-lett)** — hele tilstanden ligger fortsatt som **ett `jsonb`-doc**.
   Doc'et er **flatt**: tre parallelle tabeller (`groups` / `cards` / `items`) med forelder-peker
   (`kort.group`, `element.home`), slik at gruppe/liste/element flettes hver for seg på `id` og
   forelderløse forkastes. Hver entitet har egne «registre» med logisk tidsstempel:
   - **innhold** (`ts`, `org`): gruppens navn/`trashed`; kortets tittel/farge/`trashed`;
     elementets tekst/`trashed`. (`trashed` = søppelkasse-flagg; se «Søppelkasser».)
   - **merkelapp** (`labTs`, `labOrg`): kortets `k`/`p`-brytere. Eget register så en merkelapp-endring
     på én enhet ikke overskrives av en samtidig tittel-/farge-endring på en annen (og omvendt).
     `k` og `p` deler register (flettes som ett par) så «minst én på» aldri brytes av fletting.
   - **posisjon** (`posTs`, `posOrg`): rekkefølge (`pos`, fraksjonsindeksering) + **forelder**
     (elementets `home`, kortets `group`) — forelder følger posisjonsregisteret siden flytting
     endrer forelder + plassering samtidig.
   Ved fletting velges nyeste verdi per register (LWW; `org`/enhets-id bryter uavgjort
   deterministisk). Endringer på ulike grupper/kort/elementer/felter kolliderer aldri; kun samme
   register endret to steder «konflikter», og da vinner nyeste. `tick()` er en **hybrid logisk
   klokke** (monotont voksende) så den tåler at enhetenes veggklokker går i utakt.
   - **Sletting** bruker **gravsteiner** (`_tomb.groups` / `_tomb.cards` / `_tomb.items`:
     id → tidsstempel) så en sletting ikke «gjenoppstår» fra en foreldet enhet. Gravstein
     settes **først når en søppelkasse tømmes permanent** (gruppe-, liste- eller element-nivå);
     vanlig sletting setter kun `trashed: true` (gjenopprettbart). Søppelkasse = entitet med
     `trashed: true`.
   - `activeGroup` er **per enhet** og synkes ikke.
   - **Migrering**: gammel to-fane-form (både hel-tilstand og forrige synk-doc) gjøres om til to
     grupper med **faste, deterministiske id-er** (`grp-huskelister`/`grp-handlelister`) i
     `migrateBareState`/`normalizeRemoteDoc`, så alle enheter migrerer likt uten duplisering.
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
- **UI**: Det finnes ingen «Synk»-knapp eller synk-modal lenger — synken bare virker fortløpende i
  bakgrunnen. Når en endring kommer fra en annen enhet, vises et lite, forbigående varsel
  («Oppdatert fra en annen enhet», `showToast`). Utlogging skjer via **«Logg ut»**-knappen i
  verktøylinja (`logout()` → tømmer auth/synk-kode i `localStorage` og laster siden på nytt).

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

## Søppelkasser (grupper / lister / elementer)

Alle tre nivåene har en søppelkasse. Sletting setter `trashed: true` (gjenopprettbart);
permanent sletting (med gravstein) skjer **først når søppelkassen tømmes**. En slettet entitet
skjules fra sitt nivå (`visibleGroups()` / `activeCards()` / ikke-`trashed` elementer i kortet).

**Tre søppelkasse-knapper** — hver viser **kun en søppelkasse-emoji + et tall** (ingen tekst-etikett):
- **Grupper**: helt til **venstre i headeren**, vises **kun når det ligger grupper i den**
  (`updateGroupsTrash` → `appHeader.has-trashed-groups`). To varianter: **inline** i raden
  (`#groups-trash`) på desktop / uten overflow, og en **fast full-høyde sone**
  (`#groups-trash-pin`) ved mobil-overflow. Ved overflow ligger søppelkassen (venstre) og «＋»
  (høyre) som faste, ugjennomsiktige soner med en **smal innsidefade** UTENFOR scroll-feltet;
  gruppe-raden er klemt mellom dem, så kortene scroller **aldri bak** sonene (se «Grupper
  (header) → Responsiv layout» for detaljer: like brede fader `--fade-w`, padding = fade-bredde,
  full-høyde soner uten skygge, flip-flop-fri overflow-måling). Gruppekortene har en **tett
  boks-skygge** (ikke `shadow-md`) og bar-en har vertikal luft (`padding: 9px 0`) så skyggene
  får plass uten å klippes av radens `overflow`.
- **Lister** (`#trash-btn`, verktøylinja): per **aktiv gruppe** (`trashedCards()`/`allCards()` er
  gruppe-scopet). Tidligere «Papirkurv»-tekst er fjernet; kun emoji + tellepille.
- **Elementer** (`.item-trash`, i hvert listekort): **midtstilt nederst i kortet**, under «Legg
  til»-feltet, og vises **kun når kortet har slettede elementer**.

**Interaksjon (`attachTrashHold`)** — felles for alle tre knappene:
- **Kort trykk** → åpner **søppelkasse-modalen** (felles `#trash-modal`, fylt av
  `showTrashModal({title, note, rows, empty})`). Der kan man **Gjenopprett**e enkeltvis
  (`trashed: false`) eller **Tøm permanent** (med bekreftelse). Modalen åpnes via `setTimeout(…, 0)`
  (etter click-sekvensen), og overlay-en ignorerer klikk de første ~450 ms (`modalOpenedAt`) — ellers
  lukket åpnings-trykkets (evt. forsinkede) etter-klikk modalen igjen for gruppe-/liste-kurven, som
  ligger nær kanten der etter-klikket treffer overlay-en i stedet for modal-boksen (elementkurven,
  midt på skjermen, traff modal-boksen og «virket» derfor).
- **Klikk-og-hold** (> `HOLD_EXPAND_MS`, eller start med bevegelse) → knappen utvider seg til et
  **sveipefelt** (ett gjenbrukt, `position: fixed` overlay `.swipe-field`, plassert ved knappen og
  klemt innenfor viewporten med plass til å sveipe litt forbi høyre ende): «🗑️ Sveip for å tømme →».
  Sveiper man mot høyre roterer søppelkasse-ikonet gradvis (`rotate(p·180°)`) og blir **opp-ned** helt
  til høyre (`p ≥ 1`); da **tømmes** den — ikonet **rister i 500 ms** (`SHAKE_MS`), roterer tilbake og
  feltet **kollapser**. Slipper man **før** høyre ende, kollapser feltet **uten** å tømme. `--p` (0→1)
  driver en grønn fylling i feltet.
- Tømming gir permanente **gravsteiner**: `emptyGroupsTrash` (gruppe + dens lister + elementer),
  `emptyCardsTrash` (liste + dens elementer), `emptyItemsTrash` (elementer). `refreshCard()`
  bygger ett kort på nytt etter element-endringer (uten å tegne hele tavla). Sveipefeltet er
  frikoblet fra knappen (ligger på `body`), så tømming som fjerner knappen (element-kortet bygges
  på nytt) ikke avbryter rist/kollaps-animasjonen.

## Fargepalett

- **Bakgrunn**: `#667788` (dempet skifer-blå). **Primær aksentfarge**: `#668866` (dempet grønn,
  `--primary`; `--primary-dark` = mørkere grønn). Knapper o.l. er fortsatt hvite.
- **Kortfarger** velges tilfeldig fra en fast liste med 20 varme oker-/jordtoner (`PALETTE` i
  `app.js`). Header-farge = litt mørkere variant av kortfargen (via `darken()`). Farge lagres per
  kort så den er stabil, og velges tilfeldig men unngår å gjenta forrige korts farge.
- **Fargemigrering** (`recolorOldCards`): kort med en farge utenfor den nye paletten (dvs. laget før
  paletten ble byttet) får en ny høstfarge ved oppstart og under synk. Fargen er **deterministisk fra
  kort-id** (`paletteColorForId`) så alle enheter velger samme farge → ingen synk-flimmer. Idempotent
  (kort som allerede har palett-farge røres ikke), og endringen stemples/synkes som vanlig innhold.
- Mørk tekst (`#37343f`) på lyse flater; lys tekst direkte på bakgrunnen (tom-tilstand, lås-skjerm).

## Merkelapper (K/P) + filter

- Hvert kort har to **brytere**, `K` og `P` (felt `k`/`p`, default begge på), vist som bokstaver i små
  sirkler vertikalt stablet til venstre for slett-knappen. Sirkelen blir **lysere** når bryteren er på.
  **Minst én** bryter må alltid være på — forsøk på å skru av den siste gir en liten risting (`flashDeny`).
- Hvert kort tilhører nøyaktig **én kategori** ut fra bryterne (`cardCategory`): kun **K**, kun **P**,
  eller **KP** (begge på). I verktøylinja, ved siden av lister-søppelkassen, ligger et **filter**
  (`#filter-switches`) med tre brytere: `K`, `P`, `KP`. Et kort vises hvis bryteren for kortets
  kategori er på (`cardMatchesFilter`) — velger man f.eks. `K` + `KP`, vises kun-K-kort og KP-kort,
  men ikke kun-P-kort. Minst ett filter må være på. Filteret er per enhet (`localStorage`,
  `mine-lister-filter`) og synkes ikke; `k`/`p` synkes i sitt **eget merkelapp-register**
  (`labTs`/`labOrg`), uavhengig av tittel/farge (se «To mekanismer …»).
- **Verktøylinja** har «Ny liste», lister-**søppelkassen** (per gruppe, se «Søppelkasser»), filteret
  og en **«Logg ut»**-knapp til høyre (synken går uansett fortløpende i bakgrunnen; se under). «Ny
  liste»/søppelkassen er deaktivert når det ikke finnes noen aktiv gruppe. (K/P + filter gjelder
  lister, uendret.)

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
- [x] Ny fargepalett: bakgrunn `#667788`, aksent `#668866`, 20 varme kortfarger
- [x] Fjernet «Synk»-knapp/modal + «# kategorier»-tekst; lagt til «Logg ut»-knapp
- [x] Dynamisk rotasjon av dra-kort ut fra horisontal posisjon (−10°/0°/+10°)
- [x] Auto-scroll når dra-kort holdes nær/forbi topp- eller bunnkant
- [x] Merkelapp-brytere K/P per kort (minst én på) + filter ved siden av papirkurv
- [x] Testet i nettleser (Playwright): palett, brytere/filter, rotasjon, auto-scroll
- [x] **Omorganisering: Gruppe > Liste > Element.** Fjernet apptittel + de to faste fanene
- [x] Header viser en rad med gruppekort (håndtak/navn/dempet antall/slett; bredde følger navnet)
- [x] Grupper: opprett/slett/omdøp + dra-og-slipp-rekkefølge (placeholder + FLIP)
- [x] Papirkurv per gruppe; slett hel gruppe → permanent (gravsteiner `_tomb.groups`)
- [x] Desktop: gruppene bryter til flere rader + inline «＋»; Mobil: én rad + horisontal scroll,
      «＋» festet til høyre med fade-gradient når kortene overskrider bredden
- [x] Flat synk-doc (`groups`/`cards`/`items` m/ forelder-peker); migrering fra to-fane-form
- [x] Testet i nettleser (Playwright): gruppe-CRUD/-reorder, per-gruppe papirkurv, migrering
      (lokal + fjern), mobil-overflow/pinned/fade, desktop-wrap, felt-nivå fletting (43 sjekker)
- [x] **Søppelkasse på alle tre nivåer** (grupper/lister/elementer): `trashed`-flagg (gjenopprettbart),
      gravstein først ved tømming. Gruppe- og element-sletting er ikke lenger permanent.
- [x] Gruppe-søppelkasse helt til venstre i headeren (kun når den har innhold); mobil-overflow: festet
      til venstre med fade, gruppekortene scroller bak den. Lister-søppelkasse: fjernet «Papirkurv»-tekst
- [x] Element-søppelkasse midtstilt nederst i hvert listekort (kun når den har slettede elementer)
- [x] Kort trykk åpner felles søppelkasse-modal (gjenopprett/tøm); modalen åpnes utsatt så det
      etterfølgende klikket ikke lukker den igjen (fikset: modal åpnet ikke for gruppe-/liste-kurv)
- [x] **Sveip-for-å-tømme** (`attachTrashHold` + `.swipe-field`): klikk-og-hold utvider knappen til et
      sveipefelt («Sveip for å tømme →»); sveip til høyre roterer ikonet til opp-ned og tømmer (rister
      500 ms, kollapser); slipp før høyre ende kollapser uten å tømme. Erstatter hold-3s-animasjonen
      (som ble skjult bak tommelen på mobil)
- [x] Mobil: smalere fader (`--fade-w: 22px`) + bar-`padding-right` så siste gruppe-korts sletteknapp
      ikke gjemmes bak «＋»; fade-sonene er `pointer-events: none` så kort bak dem er trykkbare
- [x] Mobil-overflow omdesignet: scroll-feltet **klemt mellom** to faste full-høyde soner (søppelkasse
      venstre + «＋» høyre), kortene scroller ikke lenger bak sonene; like brede smale innsidefader
      (`--fade-w: 14px`), padding = fade-bredde; flip-flop-fri overflow-måling (kortbredder vs viewport)
- [x] Fast header (`position: fixed`, uavhengig av scrolling; robust mot iOS-`backdrop-filter`-bug);
      `.app-main` topp-padding følger målt header-høyde via `--header-h` (`ResizeObserver`)
- [x] Fikset (fra før, uavhengig): element-overføring mistet det flyttede elementet + reconcile
      droppet skjulte slettede elementer — `reconcileItems` bruker nå ett felles pool-øyeblikksbilde
      og bevarer `trashed`-elementer
- [x] Testet i nettleser (Playwright): 3 nivåer tap→modal/gjenopprett/tøm-via-modal, sveip-tøm på alle
      tre (inkl. knapp som destrueres), delvis sveip avbryter, mobil fade/overflow + siste-kort-klarering,
      element-DnD (reorder + overføring, med/uten slettede), felt-nivå fletting av `trashed`

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
