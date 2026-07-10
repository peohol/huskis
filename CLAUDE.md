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
  (`--sidebar-w`). Øverst `.panel-top`: overskriften **GRUPPER** (linjen er
  `--control-h` høy så den flukter med LISTER-linjen i verktøylinja) og
  knapperaden **«＋ Gruppe» + gruppe-søppelkassen side om side**. Gruppekortene
  scroller i kolonnen under og **oppløses i en fade** (CSS `mask-image`, høyde
  `--fade-h`, tilsvarende fade i bunnen; hvile-padding = fade-høyden så ingenting
  er falmet i ro). Masken slås av under draging (`body.is-dragging`) fordi den
  ellers ville klippe det løftede (fixed) dra-kortet. Ingen pinnede soner lenger.
- **Mobil (`max-width: 560px`)**: fast panel øverst: overskrift, knapperad
  («＋ Gruppe» + søppelkasse) og gruppekortene på **én horisontalt scrollende
  rad** under — **uten fader** (kun en diskret, app-tilpasset scrollbar). ☰
  ligger IKKE her (se «Listemenyen») — den skal ikke stå på nivå med «＋ Gruppe».

- **Gruppekort** (`.group-card.chip`): håndtak (mørkt, `--g-accent`), navn, dempet
  antall, ✕ helt til høyre. Posisjonsbasert farge; aktiv = grønn ring. Klikk =
  bytt gruppe; klikk på aktivt navn = omdøp (`editText` autosize).
- **Rekkefølge**: dra-og-slipp via håndtaket med placeholder + FLIP
  (`updateGroupPlacement` dispatcher på orientering: vertikal kolonne på desktop
  (`…V`), horisontal rad på mobil (`…H`)); auto-scroll av feltet ved kantene.
- Header- og verktøylinje-høyder måles (`ResizeObserver`) → `--header-h`/`--toolbar-h`.

## Listemenyen (verktøylinja)

Fast meny (`position: fixed`; desktop: øverst til høyre for kolonnen, mobil: rett
under gruppemenyen). To linjer: overskriften **LISTER** med **☰ helt til høyre**
på samme linje (**både mobil og desktop** — ett felles `#menu-btn-toolbar`, ikke
to knapper; ☰ bor ALDRI i gruppemenyen/knapperaden med «＋ Gruppe») og knapperaden
**«＋ Liste» + liste-søppelkassen + filterkortet (👁️ K/P/KP)**. Filterkortet
følger flate-mønsteret (halvgjennomsiktig → opak ved hover). Logg ut-knappen er
FLYTTET til meny-modalen.

## Meny-modal (☰) + universer

Menyknappen (☰, `.menu-btn`, kun i listemenyen — se over) åpner `#menu-modal`:
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
      bunn), av under drag; pinnede soner/overflow-JS fjernet. ☰ bor IKKE her —
      se listemenyen (skal ikke stå på nivå med «＋ Gruppe»)
- [x] **Listemenyen**: overskrift «LISTER» på egen linje med **☰ helt til høyre
      på samme linje — både mobil og desktop** (ett felles `#menu-btn-toolbar`,
      ikke to knapper); GRUPPER/LISTER + de to knapperadene flukter på desktop;
      «＋ Liste»
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
      `border-bottom` + negativ side-margin (kansellerer paddingen). ☰ lå først
      i gruppemenyen på mobil (nivå med «＋ Gruppe») og i listemenyen på desktop
      (to separate knapper, `#menu-btn-header` + `#menu-btn-toolbar`, vist/skjult
      via CSS) — forenklet til ÉN knapp (`#menu-btn-toolbar`) i listemenyens
      `.panel-head`, brukt på begge skjermstørrelser
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
- ☰ er ÉN knapp (`#menu-btn-toolbar`) som alltid bor i listemenyens `.panel-head`
  (øvre høyre hjørne av LISTER-linjen, både mobil og desktop) — IKKE i
  gruppemenyen, og IKKE på nivå med «＋ Gruppe». Ikke gjeninnfør en egen
  header-knapp for mobil.
- Delelinjer i modaler (f.eks. meny-modalens Logg ut/Universer-skille) skal se ut
  som `.modal-head`s `border-bottom` — kant-til-kant, IKKE en innrykket `<hr>`
  med vanlig margin (den ville stoppe ved `.modal-body`s side-padding og se
  kortere ut enn linja over). Bruk `border-bottom: 1px solid var(--line)` +
  negativ side-margin som kansellerer den omsluttende paddingen.
