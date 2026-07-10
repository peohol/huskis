# CLAUDE.md — Arbeidsdokument

Personlig arbeidsnotat for utvikling av **Huskekurv-appen**. Oppdateres underveis.

## Mål (fra oppgaven)

> **Universer (juli 2026):** Det er innført et nytt nivå over gruppene:
> **Univers > Gruppe > Liste > Element**. Universer er **helt uavhengige
> områder** — grupper kan ALDRI flyttes på tvers av universer. Universer
> administreres i en **meny-modal** (☰) sammen med «Logg ut». Gammel data
> migreres inn i standard-universet (`uni-standard`, se «Migrering»).

Appen er organisert som **Univers > Gruppe > Liste > Element**:
- **Universer**: bytt/opprett/omdøp/slett i meny-modalen (☰). Egen søppelkasse der.
- **Grupper** (gruppemenyen): opprett/slett/omdøp/dra-rekkefølge. Egen søppelkasse.
- **Lister** («kort», tidl. «kategorier») i hver gruppe: samme CRUD + dra-og-slipp;
  kortene vises kolonnevis (CSS multi-column) og kan dras **på tvers av kolonner**
  og **til en annen gruppe** (slipp på et gruppekort i gruppemenyen — kun innen
  samme univers, siden bare det aktive universets grupper vises).
- **Elementer** i hvert kort: samme CRUD + dra-og-slipp, inkl. overføring mellom
  lister (i samme gruppe).
- **Søppelkasse på alle fire nivåer** (`trashed`-flagg, gjenopprettbart; gravstein
  først ved tømming). Se «Søppelkasser».
- Klikk på navn (aktiv gruppe / aktivt univers / kort-tittel / element) = omdøp inline.

## Design- og UX-føringer (VIKTIG — videreføres av fremtidige agenter)

Appen skal føles **visuelt ryddig, konsistent og forutsigbar**. Konkret:

**Designsystem (styles.css, øverst):**
- **Tokens, ikke hardkoding**: `--control-h` (38px), `--control-radius` (12px),
  `--control-bg` (rgba(255,255,255,.75)), `--side-pad`, `--fade-h`, `--text-shadow`,
  skygge- og radius-variablene. Nye kontroller skal bruke disse — aldri egne ad
  hoc-verdier. Endres et token, skal hele appen følge med.
- **Alle knapper i samme knapperad har identisk høyde/radius/flate** (`--control-h`
  / `--control-radius`). Gjelder ＋-knapper, søppelkasser, filterkortet og ☰.
- **Delte klasser — gjenbruk før du lager nye**:
  - `.panel-head` + `.panel-title` + `.panel-actions`: overskrift («GRUPPER»/
    «LISTER»/«UNIVERSER», uppercase via CSS) på egen linje + knapperad under.
    Brukes i gruppemenyen, listemenyen og meny-modalen.
  - `.btn-add` (+ `.icon-only` for kvadratisk ＋): ALLE ＋-knapper — grønn gradient,
    **hvit tekst m/ `--text-shadow`**.
  - `.trashcan`: ALLE søppelkasse-knapper — hvit avrundet beholder, antall i grå
    sirkel (`.trashcan-count`), **skjult (`hidden`) når tom**.
  - `.menu-btn`: ☰ (tre linjer via `.menu-bars` + box-shadow).
  - `.chip` / `.chip-name` / `.chip-count`: fargede kort med hvit skrift — deles av
    gruppekort og univers-rader. Aktiv = grønn brand-ring (`outline --primary`).
  - Sletteknapper: felles regel (dempet ✕ → rød ved hover), `margin-left: auto` på
    chips (alltid helt til høyre). Element-✕ alltid synlig, dempet (`opacity .55`).
  - Håndtak (`.drag-handle`): alltid **mørkere enn flaten sin** (kortets/gruppens
    aksentfarge `--card-accent`/`--g-accent`), grid-sentrert (vertikalt midtstilt).
- **Flate-mønsteret**: hvile = halvgjennomsiktig hvit (`--control-bg`), hover =
  helt ugjennomsiktig hvit. Gjelder søppelkasser, filterkortet og ☰.
- `[hidden]` har en global `display:none !important`-regel — den MÅ beholdes
  (klasse-display som `inline-flex` ville ellers overstyre `hidden`-attributtet).

**UX-prinsipper (samme mønster på alle nivåer):**
- Klikk = bytt/aktivér; klikk på det **aktive** navnet = omdøp inline (autosize).
- Slett = `trashed`-flagg → søppelkasse; **søppelkasser vises kun med innhold**;
  kort trykk = modal (gjenopprett/tøm), klikk-og-hold = sveipefelt for tømming.
  Destruktivt er alltid reversibelt frem til tømming (gravstein først da).
- Nytt objekt (univers/gruppe/liste) aktiveres og går rett i navneredigering.
- «＋ Gruppe» skal alltid bare virke: uten univers opprettes standard-universet i
  farten (`ensureUniverse`).
- Escape lukker øverste modal — men avbryter kun inline-redigering hvis en pågår.

**Arbeidsfilosofi:**
- Jobb autonomt; ikke still oppfølgingsspørsmål — bruk beste skjønn og dokumentér valg her.
- **Verifiser alltid i ekte nettleser** (Playwright mot `python3 -m http.server`,
  desktop- OG mobil-viewport, blokker eksterne kall for hermetikk) før du sier deg
  ferdig — funksjonelt (CRUD/DnD/synk/migrering) og visuelt (screenshots).
- Oppdater CLAUDE.md (denne fila) med endringer, beslutninger og status.

## Valgt arkitektur

- **Ren statisk app**: `index.html` + `styles.css` + `app.js`. Ingen byggesteg, ingen rammeverk.
- **Vanilla JS** med egen dra-og-slipp-motor på **Pointer Events** (mus + touch likt).
- **Persistens** i `localStorage`; sanntids-synk via Supabase (se lenger ned).
- **Datamodell** (nøstet i minnet for rendring, flat i synk-doc'et):
  ```js
  state = {
    activeUniverse: <uniId>,     // per enhet, synkes ikke
    activeGroup: <groupId>,      // per enhet, synkes ikke
    activeGroups: { uniId: groupId }, // per enhet: sist aktive gruppe per univers
    universes: [
      { id, name, trashed, pos,  // + registre: ts/org (innhold), posTs/posOrg (rekkefølge)
        groups: [
          { id, uni, name, trashed, pos,   // uni = univers-forelder
            cards: [                        // «lister»
              { id, group, title, color, trashed, k, p,
                items: [ { id, text, trashed, home } ] } ] } ] }
    ],
    _tomb: { universes:{}, groups:{}, cards:{}, items:{} }, // gravsteiner: id → ts
  }
  ```
  Forelder-peker på hvert nivå: `element.home → kort`, `kort.group → gruppe`,
  `gruppe.uni → univers`. Aktiv gruppe settes ALLTID via `setActiveGroup()` /
  `setActiveUniverse()` så per-univers-minnet holdes i takt.

## Gruppemenyen (header)

Fast panel (`position: fixed`), **én felles DOM** delt i to media-queryer:

- **Desktop (`min-width: 561px`)**: fast, full-høyde **kolonne til venstre**
  (`--sidebar-w`). Øverst `.panel-top`: overskriften **GRUPPER** og knapperaden
  **«＋ Gruppe» + gruppe-søppelkassen side om side**. Gruppekortene scroller i
  kolonnen under og **oppløses i en fade** (CSS `mask-image`, høyde `--fade-h`,
  tilsvarende fade i bunnen; hvile-padding = fade-høyden så ingenting er falmet
  i ro). Masken slås av under draging (`body.is-dragging`) fordi den ellers
  ville klippe det løftede (fixed) dra-kortet. Ingen pinnede soner lenger.
- **Mobil (`max-width: 560px`)**: fast panel øverst: overskrift, knapperad
  («＋ Gruppe» + søppelkasse) og gruppekortene på **én horisontalt scrollende
  rad** under — **uten fader** (kun en diskret, app-tilpasset scrollbar). ☰
  ligger IKKE i denne DOM-en (se «Menyknapp»), men overlapper panelet visuelt.

- **Gruppekort** (`.group-card.chip`): håndtak (mørkt, `--g-accent`), navn, dempet
  antall, ✕ helt til høyre. Posisjonsbasert farge; aktiv = grønn ring. Klikk =
  bytt gruppe; klikk på aktivt navn = omdøp (`editText` autosize).
- **Rekkefølge**: dra-og-slipp via håndtaket med placeholder + FLIP
  (`updateGroupPlacement` dispatcher på orientering: vertikal kolonne på desktop
  (`…V`), horisontal rad på mobil (`…H`)); auto-scroll av feltet ved kantene.
- Header- og verktøylinje-høyder måles (`ResizeObserver`) → `--header-h`/`--toolbar-h`.

## Listemenyen (verktøylinja)

Fast meny (`position: fixed`; desktop: øverst til høyre for kolonnen, mobil: rett
under gruppemenyen). To linjer: overskriften **LISTER** og knapperaden **«＋
Liste» + liste-søppelkassen + filterkortet (👁️ K/P/KP)**. Filterkortet følger
flate-mønsteret (halvgjennomsiktig → opak ved hover). Logg ut-knappen er FLYTTET
til meny-modalen. ☰ er ikke en del av denne DOM-en (se «Menyknapp»), men
overlapper panelet visuelt på desktop.

## Menyknapp (☰)

**Én knapp** (`#menu-btn`, direkte i `<body>` — ikke inni gruppemenyen eller
listemenyen), **fast posisjonert i øvre høyre hjørne av VIEWPORTET**
(`position: fixed; top: 12px; right: …`), uavhengig av begge menyenes DOM/flyt.
Samme knapp/posisjon-strategi brukes på både mobil og desktop — kun selve
høyre-offset-tokenet byttes (se under) — det er IKKE to knapper med vis/skjul.
- z-index (35) over begge faste paneler (header 30, toolbar 20) men under
  modaler (200), så den ligger alltid synlig oppå uansett scroll-posisjon.
- **Mobil**: overlapper gruppemenyen (det faste toppanelet der) — bruker
  `--side-pad` (samme token som gruppemenyens egen sidepolstring) som høyre-
  offset, så den havner nøyaktig i det panelets hjørne.
- **Desktop**: overlapper listemenyen (til høyre for gruppemeny-kolonnen) —
  bruker i stedet `--toolbar-pad` (`clamp(12px, 3vw, 40px)`, listemenyens egen,
  viewport-relative sidepolstring — egen token, satt via en desktop-override av
  `.menu-btn { right: … }`), så den flukter nøyaktig med LISTER-linjens kant.
- Skjules på låseskjermen (`body.locked #menu-btn { display: none; }`).
- Effekt: knappen «arver» riktig hjørne fra hvilket som helst panel som faktisk
  ligger der på gjeldende skjermstørrelse, uten skjermstørrelse-spesifikk
  DOM-plassering eller flere knapper.

## Meny-modal + universer

Menyknappen (☰, se over) åpner `#menu-modal`:
- **«Logg ut»** øverst (med bekreftelse), deretter en delelinje (`<hr class=
  "menu-divider">`) i **samme border-stil som `.modal-head`** (`border-bottom:
  1px solid var(--line)`, kant-til-kant via negativ side-margin som kansellerer
  `.modal-body`s side-padding) — IKKE en vanlig innrykket `<hr>`.
- **UNIVERSER**-seksjon: univers-rader (`.uni-row.chip` — farget, aktiv m/ ring,
  antall grupper dempet, ✕ helt til høyre), «＋ Univers» og univers-søppelkassen
  (samme knapp/oppførsel som de andre).
- Klikk på en rad = **bytt univers + lukk menyen** (bytt kontekst og gå); klikk på
  det aktive navnet = omdøp. Slett = i søppelkassen (menyen forblir åpen så man
  kan angre). `setActiveUniverse` gjenoppretter sist aktive gruppe i universet.
- Søppelkasse-modalen kan ligge **over** menyen (ligger etter i DOM, samme
  z-index); `body.modal-open` styres samlet (`updateModalOpenClass`).
- Universer er **helt uavhengige**: alt gruppe-/liste-UI er scopet til det aktive
  universet (`allGroups()` osv.), så kryss-univers-flytting er umulig i UI-et.

## Listevisningen (board): luft-system

**Ett tall, `--board-gap` (`clamp(12px, 4vw, 40px)`), styrer ALL luft i board-et**
— venstre/høyre-padding på `.app-main`, kolonne-gap (`.board`), og kort-til-kort-
avstand (`.card`s `margin-bottom`). Samme variabel overalt → luften er alltid
identisk, uansett viewport-bredde (verdien er responsiv, men leses fra ÉN kilde).

- **Bunn**: `.app-main` har `padding-bottom: 0` — luften under SISTE kort kommer
  fra kortets EGEN `margin-bottom` (samme `--board-gap`), ikke fra en egen
  bunn-padding (det ville lagt gap oppå gap). Multi-column-layouten
  (`column-fill: balance`, default) kan imidlertid **ignorere nettopp den
  margin-en** når den regner ut board-ets auto-høyde ved ujevnt balanserte
  kolonner (bidrar 0 i noen kolonnefordelinger, hele verdien i andre — en kjent
  nettleser-kvirk, ikke noe vi kan style oss vekk fra). Løsning: `fixBoardBottomGap()`
  i app.js måler det FAKTISKE utfallet (nullstiller `.board`s `padding-bottom`,
  tvinger reflow, sammenligner board- og siste-korts bunnkant) og legger på
  akkurat nok padding til at total bunn-luft alltid blir nøyaktig `--board-gap` —
  aldri mer, aldri mindre. Kalles ved hver `render()` og ved vindus-resize.
- **Topp**: `.app-main`s `padding-top` settes IKKE via CSS `calc()`, men regnes
  ut i JS (`syncHeaderHeight`, samme funksjon som måler `--header-h`/
  `--toolbar-h`): eksakt meny-høyde (mobil: gruppemeny + listemeny; desktop: kun
  listemeny, siden gruppemenyen er en venstre-kolonne) **+ `--board-gap`**, satt
  som `--board-pad-top`. `--board-gap` kan IKKE leses direkte fra `:root` i
  JS (en `clamp()`/`vw`-custom-property gir tilbake selve uttrykket som streng,
  ikke tallet den løses til) — den leses derfor fra `.board`s FAKTISK OPPLØSTE
  `column-gap` (`getComputedStyle(board).columnGap`), som ER et vanlig,
  oppløst tall. Resultat: avstanden fra menyenes nedre kant til første kort er
  PIKSELNØYAKTIG lik gapet ellers, ikke en tilnærmet verdi fra en separat
  `clamp()` (slik det var før).
- **Mobil, én kolonne**: `column-count: 1` (IKKE `column-width: 100%` — prosent
  er ugyldig for `column-width` per spec og blir stille ignorert av nettlesere).
  Kortene (`width: 100%`, base-regelen) fyller dermed hele den ene kolonnen →
  jevn luft på alle sider siden `--board-gap` uansett brukes konsekvent.
- Endres `--board-gap`, følger ALT (padding, gap, kort-margin, og — via JS —
  topp/bunn-utregningen) automatisk med. Ikke hardkod en egen verdi noe sted i
  board-et; bruk `--board-gap`.

## Dra-og-slipp-logikk (kjernen)

Bytte utløses av **overlapp**, ikke av et punkt:
- ≥ **20 %** høyde-/breddeoverlapp bytter plass; **retningsstyrt** (hysterese mot
  flimring): nedover-drag bytter kun med kortet under, oppover kun med kortet over
  (transponert for horisontale rader).
- **Kolonne** = kort med ≥ 50 % horisontal overlapp; kryss-kolonne plasseres etter
  vertikal senterposisjon. For elementer = overføring til annen `.items-container`.
- **FLIP-animasjon (150 ms)** ved hver placeholder-flytting og ved slipp.
  `layoutRect()` trekker fra pågående FLIP-transform → stabil treffdeteksjon.
- Under draging manipuleres DOM direkte; state bygges fra DOM ved slipp (kirurgisk:
  kun det flyttede objektets posisjonsregister stemples).
- **Dynamisk rotasjon** av dra-kort (`cardRotation()`, ±5° ut fra horisontal
  posisjon); elementer roterer ikke. **Auto-scroll** ved vindus-kant for kort, og
  av gruppefeltet ved feltets kanter under gruppe-drag.
- Kun én drag om gangen (`if (drag.active) return`); `finishDrag()` feier bort
  evt. foreldreløse placeholdere.

### Overføring av lister mellom grupper (innen samme univers)

Dra en liste opp på et gruppekort i gruppemenyen: gruppekortet markeres
(`.drop-target`), dra-kortet blir gjennomskinnelig (`.to-group`), board-et fryses
mens man sikter. Slipp = kirurgisk flytting (`card.group` + `pos` bakerst, kun
posisjonsregisteret stemples) + toast + puls på målgruppen (`pulseReceivedGroup`).

## Søppelkasser (universer / grupper / lister / elementer)

Fire nivåer, samme knapp (`.trashcan`: hvit beholder, 🗑️ + antall i grå sirkel) og
samme oppførsel; **alle vises kun når de har innhold** (`hidden`):
- **Universer**: i meny-modalen, ved siden av «＋ Univers».
- **Grupper**: i gruppemenyens knapperad (per aktivt univers).
- **Lister**: i listemenyens knapperad (per aktiv gruppe).
- **Elementer**: midtstilt nederst i hvert listekort.

**Interaksjon (`attachTrashHold`)**: kort trykk → felles modal (`showTrashModal`:
gjenopprett enkeltvis / tøm med bekreftelse; modalen åpnes utsatt og ignorerer
overlay-klikk de første ~450 ms). Klikk-og-hold (> `HOLD_EXPAND_MS`) → **sveipefelt**
(«🗑️ Sveip for å tømme →», fixed overlay): sveip helt til høyre roterer ikonet
opp-ned og **tømmer** (rist 500 ms, kollaps); slipp før enden = avbryt. Tømming
setter **gravsteiner** rekursivt (univers → grupper → lister → elementer:
`emptyUniversesTrash`/`emptyGroupsTrash`/`emptyCardsTrash`/`emptyItemsTrash`).
Alle tekster/titler sier «hold og sveip for å tømme» (den gamle «hold i 3
sekunder»-teksten er utfaset).

## Sanntids-synk (Supabase) med felt-nivå fletting

Som før: ett `jsonb`-doc per synk-kode, CAS (`version`) i databasen, Realtime
broadcast + poll-fallback, felt-nivå LWW-fletting med hybrid logisk klokke og
gravsteiner. **Ingen databaseendring var nødvendig for universer** (samme
`get_list`/`save_list`; SQL i `supabase/setup.sql`).

- **Flatt doc**: fire parallelle tabeller + gravsteiner:
  `{ universes, groups, cards, items, tomb: {universes, groups, cards, items}, hlc }`
  med forelder-pekere (`gruppe.uni`, `kort.group`, `element.home`). Fletting per
  register (innhold `ts/org`; merkelapp `labTs/labOrg` (kort); posisjon
  `posTs/posOrg` — **forelder følger posisjonsregisteret**). Forelderløse forkastes
  (gruppe uten univers, liste uten gruppe, element uten liste).
- `activeUniverse`/`activeGroup`/`activeGroups` er per enhet og synkes ikke.
- **Migrering** (deterministisk, uten duplisering — alle enheter migrerer likt):
  1. To-fane-form (`tabs`) → to faste grupper (`grp-huskelister`/`grp-handlelister`).
  2. Flat/nøstet gruppe-form (uten `universes`) → alt inn i **standard-universet**
     `uni-standard` («Standard») med nøytrale registre (ts 0, org '').
  Steg 1+2 kjøres både på lagret state (`migrateTabsToGroups` +
  `migrateGroupsToUniverses` i `normalize`) og på fjern-doc
  (`migrateBareState`/`normalizeRemoteDoc`).
- `syncCycle()` (pull → flett → evt. push), `docFromState()`/`applyDoc()`,
  `canonical()` som før. Interne funksjoner eksponert på `window.__huskekurv`.

## Brukere og deling (GRUNNMUR klar — UI gjenstår)

Databasegrunnmuren for ekte brukerkontoer (Supabase Auth: e-post + passord,
bekreftelseslenke) og deling av universer/grupper/lister ligger i
`supabase/users-and-sharing.sql` (idempotent, kjøres av samme Action som
setup.sql). Full design i `docs/arkitektur-brukere-deling.md`, løypekart i
`TODO.md` (fase 2 = klient/UI). Kortversjon:

- Relasjonelle tabeller `profiles`, `universes`, `groups`, `cards`
  (= «lister»), `items` med `owner_id` + RLS; `anon` har null tilgang.
- Samme LWW-registre som synk-doc'et (`ts/org`, `pos_ts/pos_org`,
  `lab_ts/lab_org`) håndheves nå OGSÅ server-side (BEFORE UPDATE-triggere);
  gravsteiner skrives automatisk ved hard sletting.
- Deling: eier inviterer på e-post (`share_invites`) → mottaker aksepterer
  og velger plassering → membership-rad = **mount** (tilgang + mottakerens
  egen plassering; innholdet er felles). Eier har aldri membership → kan
  aldri kastes ut; eier kan kaste ut andre (`revoke_share`) og låse/åpne
  (`set_locked`, gjelder nedover; eier kan alltid redigere selv).
  Mottakers «sletting» = forlate delingen; eiers sletting er reell.
- `get_my_doc()` returnerer alt som ETT flatt doc i samme fasong som dagens
  synk-doc (gjenbruk `applyDoc`); `import_doc()` migrerer lokal state
  (deterministiske id-er, idempotent).
- Hermetisk testsuite i `supabase/tests/` (ren PostgreSQL 16 + stub av
  auth-skjemaet); 57 sjekker. Den gamle éndoc-modellen under er urørt og
  kjører parallelt til fase 2 er ferdig.

## Innlogging (mønster-lås)

Uendret: 3×3-mønster på splash-screen, fasit kun som SHA-256-hash, lås i 5 min
etter > 5 feil, husket innlogging (`mine-lister-auth`), synk-koden utledes av
mønsteret (`sha256('sync|' + mønster)`). «Logg ut» ligger nå i meny-modalen
(`logout()` → tømmer auth/synk-kode og laster på nytt).

## Databaseoppsett via GitHub Actions

Uendret: `supabase/setup.sql` (idempotent) kjøres via Actionen «Supabase
DB-oppsett» (krever secret `SUPABASE_DB_URL`) eller limes inn i SQL Editor.
Husk `extensions` i `search_path` (pgcrypto/`digest()`).

## Fargesystem (HSL, posisjonsbasert)

Uendret prinsipp: farge utledes av **posisjon** i den synlige, sorterte lista
(S=`COLOR_SAT` 20 %, L-sett `[60,75,90]`, tone-rekkefølge fra `buildHueOrder`
(12 toner, 60°-hopp)); re-fargelegges ved add/slett/omrokkering; ikke lagret/synket
(`colorForId` som stabil reserve i søppelkasse-modalen). Gjelder nå også
**univers-radene** i menyen. Hvit skrift m/ `--text-shadow` på alle fargede flater
og grønne knapper.

## Merkelapper (K/P) + filter

Uendret: K/P-brytere per kort (minst én på; eget synk-register `labTs/labOrg`),
filter (👁️ K/P/KP) i listemenyen, per enhet (`mine-lister-filter`).

## Status / TODO

- [x] Alt til og med «Design: venstre-kolonne header, fast verktøylinje, HSL-farger» (se git-historikk)
- [x] **Universer: nytt toppnivå (Univers > Gruppe > Liste > Element)** — helt
      uavhengige områder; state/normalisering/synk-doc/fletting/gravsteiner/
      migrering (lokal + fjern, deterministisk `uni-standard`); per-univers-scoping
      av alt gruppe-/liste-UI; `activeGroups`-minne per univers
- [x] **Meny-modal (☰)**: Logg ut (flyttet fra verktøylinja) + delelinje (samme
      border-stil som `.modal-head`, ikke en innrykket `<hr>`) + UNIVERSER
      (bytt/opprett/omdøp/slett + egen søppelkasse); søppelkasse-modal kan ligge
      over menyen; Escape lukker øverste (men avbryter inline-redigering først)
- [x] **Gruppemenyen omstrukturert**: overskrift «GRUPPER»; «＋ Gruppe» +
      gruppe-søppelkasse side om side ØVERST (over kortene); kortrad uten fader
      på mobil; desktop: kortene scroller under knapperaden med mask-fade (topp +
      bunn), av under drag; pinnede soner/overflow-JS fjernet. ☰ bor IKKE i denne
      DOM-en — se «Menyknapp» (overlapper panelet visuelt på mobil)
- [x] **Listemenyen**: overskrift «LISTER»; GRUPPER/LISTER + de to knapperadene
      flukter på desktop; «＋ Liste»
- [x] **Menyknapp (☰) som fast, viewport-pinnet element**: én knapp (`#menu-btn`,
      direkte i `<body>`, ikke inni noen av menyene), `position: fixed; top:
      12px;`, høyre-offset via `--side-pad` (mobil, matcher gruppemenyen) eller
      `--toolbar-pad` (desktop, matcher listemenyen — egen, viewport-relativ
      token), z-index 35 (over begge faste paneler, under modaler). Havner «for
      gratis» i riktig hjørne uten skjermstørrelse-spesifikk DOM/flere knapper;
      skjules på låseskjermen
- [x] **Designsystem**: kontroll-tokens (`--control-h/-radius/-bg`), delte klasser
      (`.panel-*`, `.btn-add`, `.trashcan`, `.menu-btn`, `.chip`); alle
      søppelkasser like (hvit beholder, grå tellesirkel, halvgjennomsiktig → opak
      ved hover, skjult når tom — også lister-søppelkassen); alle ＋-knapper like
      (grønn, hvit tekst m/ skygge — også listekortenes ＋); alle sletteknapper
      like (dempet ✕ → rødt hover; helt til høyre i chips; element-✕ alltid
      synlig m/ opacity .55); håndtak mørkere enn flaten (også gruppekort) og
      vertikalt midtstilt; filterkort følger flate-mønsteret; `[hidden]`-regel
- [x] Oppdaterte søppelkasse-tekster («hold og sveip for å tømme» i titler + modal)
- [x] Verifisert i nettleser (Playwright, hermetisk): 77+ sjekker grønne — CRUD/
      bytte/omdøp/slett/gjenopprett/tøm på alle nivåer, sveip-tømming (inkl. inne
      i modalen), DnD-røyk (element/kort/gruppe/overføringer), migrering (lokal
      nøstet + fjern flat + to-fane), flette-idempotens, foreldreløs-dropp,
      layout-asserts (høyder, plasseringer, fader, ☰-plassering, delelinje-stil),
      screenshots desktop/mobil/meny/søppelkasse
- [x] **Etterjustering (brukertilbakemelding)**: meny-delelinjen brukte først
      `<hr>` med `border-top` + vanlig margin, som ble innrykket av
      `.modal-body`s side-padding (så den IKKE fluktet med `.modal-head`s
      kant-til-kant-linje mellom «Meny»-tittel og «Logg ut») — byttet til
      `border-bottom` + negativ side-margin (kansellerer paddingen). ☰ sin
      plassering gikk gjennom tre runder: (1) opprinnelig spec — to separate
      knapper (`#menu-btn-header` i gruppemenyen på mobil nivå med «＋ Gruppe»,
      `#menu-btn-toolbar` i listemenyen på desktop); (2) forenklet til ÉN knapp
      i listemenyens `.panel-head`, brukt på begge skjermstørrelser (mobil
      flyttet vekk fra «＋ Gruppe»-nivået, men da også vekk fra gruppemenyen);
      (3) presisert til det som faktisk var ønsket: fortsatt kun ÉN knapp, men nå
      et **fast, viewport-pinnet element** (`#menu-btn`, direkte i `<body>`) som
      alltid ligger i øvre høyre hjørne — det havner dermed automatisk over
      gruppemenyen på mobil og listemenyen på desktop, uten at knappen «tilhører»
      noen av dem i DOM-en. Se «Menyknapp (☰)»
- [x] **Listevisningens luft samlet i ett tall** (`--board-gap`): venstre/høyre-
      padding, kolonne-gap og kort-margin er nå samme variabel (var før en
      blanding av responsive clamp()-er og en hardkodet 20px). Bunn-padding
      (var 80px, langt større enn resten) er fjernet til fordel for siste korts
      egen margin; padding-top regnes nå ut i JS (eksakt meny-høyde + gap) i
      stedet for en tilnærmet CSS-`calc()`. Se «Listevisningen (board):
      luft-system» for detaljer, inkl. en multi-column-kvirk med balanserte
      kolonner som måtte løses i JS (`fixBoardBottomGap`)
- [x] **Grunnmur for brukere + deling (fase 1)**: `supabase/users-and-sharing.sql`
      (Supabase Auth-integrasjon, RLS, delings-RPC-er, mounts, lås, gravsteiner,
      server-side LWW), arkitekturdok (`docs/arkitektur-brukere-deling.md`),
      løypekart (`TODO.md`), hermetisk testsuite (`supabase/tests/`, 57 grønne),
      Action oppdatert til å kjøre begge SQL-filene
- [ ] **Fase 2: klient/UI for brukere + deling** — se `TODO.md` (auth-UI,
      synk-motor v2 på `get_my_doc`/rad-CRUD, mount-rendring, delings-UI,
      migreringsflyt). Mønster-låsen og `lists`-tabellen beholdes til fase 2
      er verifisert
- [ ] Evt.: dra-rekkefølge for universer i menyen (ikke etterspurt; pos-felt er klart)

```bash
cd /home/user/huskekurv
python3 -m http.server 8000
# åpne http://localhost:8000
```

## Notater / beslutninger

- Håndtak (`.drag-handle`) har `touch-action: none`; draging starter kun fra håndtak.
- `pointercapture` brukes så draging ikke mister eventer.
- Placeholder lever kun under draging; `finishDrag()` har sikkerhetsnett.
- **`[hidden]` display-regelen i styles.css må bestå** (ellers overstyrer
  `.trashcan`s `inline-flex` skjulingen).
- Desktop-fade på gruppekolonnen er `mask-image` på scroll-feltet — masken gjelder
  også fixed-posisjonerte barn, derfor slås den av med `body.is-dragging`.
- Bytte av univers lukker menyen (bytt kontekst og gå); sletting gjør det ikke
  (så man kan angre fra søppelkassen med én gang).
- «＋ Gruppe» uten univers auto-oppretter «Standard» (ny tilfeldig id — IKKE den
  faste `uni-standard`-id-en, som kan ha gravstein).
- Verifisering skjer med Playwright (globalt installert) mot en lokal
  `http.server`; eksterne kall blokkeres i testene (appen degraderer pent), og
  `localStorage['mine-lister-auth']='1'` hopper over mønster-låsen.
- ☰ er ÉN knapp (`#menu-btn`), `position: fixed` direkte i `<body>` — IKKE inni
  gruppemenyens eller listemenyens DOM, og IKKE på nivå med «＋ Gruppe». Den skal
  alltid ligge i øvre høyre hjørne av VIEWPORTET (ikke av et bestemt panel); at
  den visuelt havner over gruppemenyen på mobil og listemenyen på desktop er en
  konsekvens av at disse panelene selv ligger i det hjørnet på hver sin
  skjermstørrelse, ikke noe knappen aktivt oppsøker. Ikke gjeninnfør separate
  knapper per skjermstørrelse eller flytt den inn i et panels flex-flyt igjen —
  bruk i stedet `--side-pad`/`--toolbar-pad` for å style den responsivt.
- Delelinjer i modaler (f.eks. meny-modalens Logg ut/Universer-skille) skal se ut
  som `.modal-head`s `border-bottom` — kant-til-kant, IKKE en innrykket `<hr>`
  med vanlig margin (den ville stoppe ved `.modal-body`s side-padding og se
  kortere ut enn linja over). Bruk `border-bottom: 1px solid var(--line)` +
  negativ side-margin som kansellerer den omsluttende paddingen.
- **Board-ets bunn-luft kan IKKE styres med en fast `padding-bottom` alene**
  (verken på `.app-main` eller `.board`) — `column-fill: balance` (default på
  multi-column-layout) kan ignorere siste korts `margin-bottom` fullstendig ved
  ujevnt balanserte kolonner, mens den samme margin-en telles med normalt når
  alt havner i én kolonne. En statisk padding ville derfor gitt riktig luft i
  det ene tilfellet og DOBBEL luft i det andre (bekreftet empirisk under
  utvikling — se «Listevisningen (board): luft-system»). Riktig løsning:
  `fixBoardBottomGap()` i app.js MÅLER det faktiske utfallet per render og
  topper opp differansen. Ikke «forenkle» dette til en ren CSS-regel uten å
  re-teste med et ODDETALL kort som gir ujevnt balanserte kolonner (f.eks. 3
  kort ved en bredde som gir nøyaktig 2 kolonner) — det er nettopp det
  scenarioet som avslører kvirken.
