# Dra-og-slipp-logikk

Les denne når oppgaven berører reorder, overføring mellom lister/grupper, eller
selve dra-motoren i app.js.

Bytte utløses av **overlapp**, ikke av et punkt:

- ≥ **20 %** høyde-/breddeoverlapp bytter plass; **retningsstyrt** (hysterese mot
  flimring): nedover-drag bytter kun med kortet under, oppover kun med kortet over
  (transponert for horisontale rader).
- **Anti-flimring** (`SWAP_LOCK_MS` = 300 ms + `SWAP_REV_RATIO` = 0.5): rett etter
  et bytte ligger geometrien ofte slik at det MOTSATTE byttet umiddelbart trigges
  igjen (pekeren står nær grensen mens et nabo-element nettopp har relokert via
  FLIP, og 20 %-overlappterskelen er lav) → objektene hopper frem og tilbake. To
  milde tiltak gjelder KUN reverseringen av forrige bytte (`swapReversesRecent`:
  samme nabo-`ref`, motsatt `pos`); vanlige (fremover) bytter er urørt (20 %):
  (a) **tidslås** — reverseringen blokkeres i 300 ms etter byttet; (b) **overlapp-
  hysterese** — reverseringen krever ≥ 50 % overlapp mot naboen, ikke bare 20 %.
  Bevisst dette milde (ikke full senter-kryssing, som overskjøt inn i NESTE
  nabo): det tar unna det meste av flimringen, men en bevisst tilbakeføring er
  fortsatt lett. `recordSwap` lagrer `{refId, pos, t}`, nullstilles per drag
  (`drag.recentSwap`), og gjelder kort/listepunkt/gruppe/univers (kategori-
  plasseringen er ren senterbasert og flimrer ikke). Aksen for overlapp-målingen
  velges etter hvor nabo og dra-senter er mest adskilt (vertikale lister → Y-
  overlapp; horisontal kort-rad → X-overlapp).
- **Kolonne** = kort med ≥ 50 % horisontal overlapp; kryss-kolonne plasseres etter
  vertikal senterposisjon. For listepunkter = overføring til annen `.items-container`.
- **FLIP-animasjon (150 ms)** ved hver placeholder-flytting og ved slipp.
  `layoutRect()` trekker fra pågående FLIP-transform → stabil treffdeteksjon.
- Under draging manipuleres DOM direkte; state bygges fra DOM ved slipp (kirurgisk:
  kun det flyttede objektets posisjonsregister stemples).
- **Dynamisk rotasjon** av det løftede objektet (`cardRotation()`, ±5° ut fra
  horisontal posisjon: −5° inntil venstre kant, +5° inntil høyre). Gjelder
  **globalt** — ALLE objekt-typer (univers/gruppe/liste/listepunkt/kategori)
  roterer likt under draging (`start*Drag`/`on*Move` setter `rotate(…) scale(…)`)
  og ved slipp (`dropIntoPlaceholder(el, rot)`). Unntak: kategori-slippet folder
  seg ut igjen (`expandCategory`) og hopper derfor over drop-rotasjonen, ellers
  ville en rotert `.cat-items` blåst opp utfoldings-høyde-målingen; rotasjonen
  under selve draging gjelder også kategorier. **Auto-scroll** ved vindus-kant for
  kort, og av gruppefeltet ved feltets kanter under gruppe-drag.
- **Posisjonering av det løftede elementet**: kort/listepunkt/kategori dras på selve
  board-et (window kan være scrollet) og er `position: absolute` med DOKUMENT-
  koordinater (`dragPos*` = peker − grep + `window.scroll{X,Y}`). Det er bevisst
  IKKE `position: fixed`: på iOS WebKit (bl.a. Chrome for iPhone) legges et
  `fixed`-element SOM HAR en transform (skala/rotasjon under draging) relativt til
  dokumentet i stedet for viewporten, så det «scroller vekk» og hopper rett opp —
  ofte forbi viewporten — idet man tar tak. Absolute unngår dette (uendret på
  Android/desktop). Under auto-scroll flyttes kortet hver frame (`moveElement()` i
  scroll-loopen) så det blir liggende under fingeren. Gruppe/univers dras i en
  modal der window-scroll aldri endres og er derfor fortsatt `fixed` (viewport-
  koordinater — `dragUsesPageCoords()` skiller på `drag.kind`). Fordi et absolutt-
  posisjonert barn teller i sidens scroll-område (et `fixed` gjorde ikke det),
  klemmes to nye ting: (1) nedover-auto-scroll stopper ved board-ets faktiske bunn
  (ellers uendelig scroll ut i blankt), og (2) `dragPosLeft` klemmer kortets
  horisontale plassering (mot dets FAKTISK RENDREDE boks: skala + maks rotasjon)
  innenfor viewporten, ellers ville et kort dratt mot siden gitt horisontal
  scrollbar og — på iOS WebKit — forskjøvet høyre-forankrede `fixed`-elementer
  (kontoknappen). Klemmen slår kun inn helt ute ved kanten.
- **Auto-scrollens ankerpunkt** (`updateAutoScroll`): symmetrisk og kant-
  forankret. OPPOVER måles kortets ØVRE kant mot toppen av området rett UNDER den
  faste headeren (`topbarEl`-bunn + `ZONE`), ikke mot viewportens øvre kant — ellers
  måtte man dra lista opp bak headeren før scrollingen slo inn (spesielt på mobil).
  NEDOVER måles kortets NEDRE kant mot viewportens nedre kant. Er kortet høyere enn
  gapet mellom sonene (ligger i begge samtidig), avgjør pekerens halvdel retningen.
  **Gjelder kort, listepunkt OG kategori** (`windowScrollDrag()` — alle tre dras på
  board-et med dokument-koordinater; gruppe/univers har egen modal-auto-scroll).
  Etter hver scroll-frame re-evalueres plasseringen via `reapplyPlacement(dir)`
  (kort → `updateCardPlacement`, listepunkt → `updateItemPlacement(lastX, lastY, dir)`,
  kategori → `placeRowPlaceholder`) med rulleretningen som dra-retning siden pekeren
  står stille. For kategorier settes `grabY` relativt til `.cat-head` (ikke hele den
  u-kollapsede boksen), ellers ville en `::before`-skillelinje over headeren gjort
  grabY større enn den kollapsede høyden → fingeren utenfor boksen, og nedre kant nådde
  aldri scroll-sonen.
- Kun én drag om gangen (`if (drag.active) return`); `finishDrag()` feier bort
  evt. foreldreløse placeholdere.
- **Draging startes ulikt på touch og mus** (`attachHoldDrag`). Dra-håndtakene er
  FJERNET; draging inviteres på objektets navn-/tittelsone — men ikke på knappene
  (`except`-selektoren, med `closest`) og heller ikke på interaktive/redigerbare
  etterkommere i sonen (`HOLD_SKIP` = `.edit-input` (inline omdøping — et hold
  ville blokkert caret/markering) + `.meta-chip` (egne hurtigredigerings-knapper
  — et tregt trykk skal åpne dem, ikke løfte kortet)). To modi etter inn-enhet
  (`ev.pointerType`):
  - **Touch/pen (mobil)**: trykk og HOLD (`HOLD_MS` = 200 ms) løfter — nødvendig
    for å skille drag fra scroll på en berøringsskjerm. Beveger fingeren seg >
    `HOLD_MOVE` (10 px) FØR holdet er ferdig, tolkes det som scroll/sveip og
    avbrytes (siden scroller da nativt — sonene har normal `touch-action`).
  - **Mus (desktop)**: INGEN delay — draget starter idet pekeren beveger seg >
    `HOLD_MOVE` px med knappen nede (klassisk desktop-drag). På desktop er det
    ingen konflikt mellom scroll og drag, så et hold trengs ikke. Et rent klikk
    (ingen bevegelse) forblir et klikk.

  Soner/unntak: **univers-/gruppe-rad** = hele chip-en unntatt ×-knappen; **liste**
  = hele korthodet (`.card-head`) unntatt tannhjul + × (klikk ellers på headeren
  kollapser/utvider lista, se under); **listepunkt** = hele `.item` unntatt
  avmerkingsboks + tannhjul + ×; **kategori** = hele overskriftslinjen
  (`.cat-head`) unntatt tannhjul + oppløs-knapp. **Cursor:** dra-sonene for
  listepunkt/kategori får `cursor: grab` (åpen hånd — «klikk-og-hold/dra drar»),
  mens univers/gruppe/liste har `cursor: pointer` (pekende hånd — der er klikk den
  primære handlingen: bytt/kollaps). `attachHoldDrag(zone, dragEl, startDrag,
  canDrag, except)` gir `startXxxDrag` et syntetisk event med pekerinfoen fra
  `pointerdown` (knappen er fortsatt nede når draget starter, så `pointerId`-en er
  aktiv → `setPointerCapture` på `dragEl` virker). Et kort trykk/klikk gjør
  fortsatt det klikket pleide (omdøp/bytt/kryss/kollaps); ved et fullført drag
  undertrykkes det påfølgende klikket (capture + `stopImmediatePropagation`).
  `pointercancel` avbryter også. Avbrudds-
  lytterne (`pointermove`/`pointerup`/`pointercancel`) sitter på **window** mens
  man venter (ikke på `zone`): før holdet er ferdig er ikke pekeren fanget, så
  flyttes/slippes den utenfor sonen ville zone-lyttere aldri fyre og timeren
  startet et drag etter at knappen alt var sluppet. En synk-
  rebuild kan bytte ut noden mens man holder → timeren dropper draget om
  `dragEl` ikke lenger er `isConnected`. `canDrag` gater på frossen/mount/`done`.
  Under et pågående drag blokkeres native scroll av en ikke-passiv `touchmove`-
  lytter (`preventTouchScroll`, av/på i `beginDragCommon`/`finishDrag`). Mens
  holdet registreres (KUN touch/pen, der holdet tar tid) får `dragEl` et lite
  «press» (`.drag-hold`, scale) — hoppes over ved `prefers-reduced-motion` og på
  mus (draget starter der umiddelbart på bevegelse). `pointercapture` brukes så
  draging ikke mister eventer. Placeholder lever kun under draging; `finishDrag()`
  har sikkerhetsnett.
- **Lister kollapser mens en liste dras** (`collapseCardsForDrag`/
  `restoreCardsAfterDrag`): idet et liste-drag starter, kollapses BÅDE den dratte
  lista og alle de andre til bare korthodet (som kategorienes kollaps under drag)
  → board-et blir kompakt og dra-avstanden kort. Den dratte lista slipper sin
  faste høyde (følger den kollapsende body-en, som `liftCategory`), placeholderen
  krymper i takt til header-høyden, og `drag.height` settes til header-høyden for
  treffdeteksjon. `card.collapsed` røres IKKE under draget; ved slipp
  gjenopprettes hver liste til sin lagrede lukketilstand (animert utvidelse for de
  som skal være åpne) — robust mot en samtidig synk-rebuild, som uansett bygger
  kortene fra `card.collapsed`. Se listekollaps i `docs/design-system.md`.
  - **Anker-scroll under kollapsen** (`anchorScrollDuringCollapse`): kollapser en
    HØY liste OVER den dratte, blir board-et brått kortere enn scroll-posisjonen.
    Uten mottiltak justerer nettleseren scroll-posisjonen selv (scroll-anchoring/
    -klemme) — det løftede kortet «drifter» langt bort fra placeholderen, og på
    Chrome for Android avbrytes hele draget (man sitter igjen med markert tekst).
    Derfor: (1) `overflowAnchor='none'` på `<html>` mens draget pågår (av/på i
    `beginDragCommon`/`finishDrag`) slår av nettleserens auto-justering; (2) en
    RAF-loop gjennom kollaps-animasjonen scroller så placeholderen står i ro i
    viewporten og flytter det løftede kortet med (`moveElement`) → fingeren beholder
    både kortet og slotten under seg. Scrollingen skjer gradvis (som auto-scroll,
    trygt på mobil) i stedet for nettleserens brå hopp. `drag.anchoring` stopper
    loopen straks brukeren faktisk drar (`onCardMove` > 2 px) så den ikke kjemper mot
    omrokkeringen; ellers stopper den når animasjonen er ferdig. Ved redusert
    bevegelse (momentan kollaps) holder én korreksjon.
- **Alle placeholders deler én stil** (felles regel for `.card-/.item-/.group-
  placeholder`): 1px stiplet kant med lav opacity, svakt mørknet flate og en
  subtil inset-skygge («hull som skal fylles») — kun radius/margens varierer per
  type.
- **Tastatur-reordering er fjernet** sammen med håndtakene (den bodde på håndtak-
  knappene, som var det eneste fokuserbare inngangspunktet). Trykk-og-hold er en
  ren peker-gest; det finnes ikke lenger en tastatur-vei til omrokkering.
- **Posisjonsbasert farge reindekseres alltid ved en fullført omrokkering**
  (ikke bare ved add/slett): `onCardUp`/`onGroupUp`/`onUniverseUp` kaller hhv.
  `reindexCardColors()`/`reindexGroupColors()`/`reindexUniverseColors()` etter
  `stampPos()`. Disse går gjennom den sorterte lista (samme kilde som
  `render()`/`renderGroups()`/`renderUniverses()` bruker) og setter
  `colorForIndex(i)` + oppdaterer CSS-variablene direkte på de allerede
  eksisterende DOM-nodene — kirurgisk, ingen full re-rendring (som ville
  kuttet FLIP/drop-avslutningsanimasjonen).

## Kategorier: to nivåer i en liste (`docs/data-model.md`)

En liste har nivå 1 (ukategoriserte listepunkter + kategorier, om hverandre) og
nivå 2 (listepunktene inne i hver kategori). DOM: kortets `.items-container` holder
nivå-1-radene (`.item` og `.category`); hver `.category` har en overskrift på
listeflaten + en nøstet `.cat-items`-liste (nivå 2) som er en innrykket
fordypning («hylle», se `docs/design-system.md`).

- **Listepunkt-draging** (`onItemMove`/`onItemUp`) finner mål-container i to steg:
  først om pekeren er inne i en `.category` → dens `.cat-items` (slipp på
  overskriften ELLER blant listepunktene legger listepunktet i kategorien); ellers
  kortets `.items-container` (nivå 1, inkl. overføring mellom lister). Listepunkter
  flyttes fritt mellom nivå 1, kategorier og lister. Søsken-rader leses fra
  **direkte barn** (`rowChildren`, ikke `querySelectorAll('.item')`) så nivå-1
  ikke plukker listepunkter inne i kategorier. Innsetting er senterbasert når
  containeren har kategorier (blandede radhøyder) eller ved overføring; ellers
  den vanlige retningsstyrte overlapp-hysteresen. `reconcileItems` bygger nå
  kortets `items` fra HELE DOM-treet (nivå 1 + hver kategoris `.cat-items`) og
  setter `it.cat`; ved slipp stemples kun det flyttede listepunktets `home`/`cat`/
  `pos` (kirurgisk, `cat` på posisjonsregisteret som `home`).
- **Kategori-draging** (`startCategoryDrag`) flytter en kategori KUN innen sin
  egen liste på nivå 1; den kan ikke nøstes i en annen kategori (slipp på en
  annen kategori = vanlig bytte-plass). Idet draget starter **kollapser**
  kategorien (`CAT_COLLAPSE_MS` = 300 ms) til bare overskriften — `.cat-items`
  animeres til høyde/opacity 0 og placeholderen krymper til header-høyden; ved
  slipp folder den seg ut igjen (`expandCategory`, reversert animasjon).
  `liftCategory` setter ingen fast høyde (så det løftede elementet følger den
  kollapsende høyden). Innsetting er senterbasert (`placeRowPlaceholder`) blant
  nivå-1-radene. `prefers-reduced-motion` hopper over kollaps/utvidelse.
  - **Utseende under draging** (`.category.dragging`): det løftede kortet skal lese
    som en kompakt rad, ikke et stort felt. Kategori-ikonet (`.cat-drag-icon`,
    `ICONS.category`, skjult i hvile) vises til venstre for tittelen; tittelen blir
    SVART uten skygge (hvit-på-hvit var uleselig mot den hvite dra-flaten); tannhjul
    + oppløs skjules `display:none` (ikke bare opacity) så headeren får element-høyde;
    `::before`/`::after`-skillelinjene skjules (`content:none`) så de ikke males på
    kortet; polstring/radius = et listepunkt (6px / 10px) + `gap:0`. `collapseCategory`
    måler header-høyden med `offsetHeight` (IKKE `getBoundingClientRect`, som ville
    inkludert dra-rotasjonen og blåst opp en bred, lav header) → `collapsedH = headH
    + 12` gir riktig placeholder-/treff-høyde.
- **Oppløs kategori** (`dissolveCategory`, boble-sprekk-knappen): listepunktene blir
  ukategoriserte og «arver» kategoriens plass i nivå-1-lista (fordeles jevnt i
  pos-gapet mellom kategorien og neste nivå-1-rad, rekkefølge bevart), og selve
  kategori-raden tombstones + fjernes.
- **Avkryssing**: et avkrysset listepunkt (også i en kategori) flyttes til kortets
  felles «Utført»-seksjon; reaktivering ruter det tilbake INN i kategorien sin
  (om den finnes), ellers til nivå 1 (se `toggleItemDone`).

## Univers- og gruppe-rader (i sine modaler)

Samme trykk-og-hold + placeholder + FLIP-motor som listekortene, men kun i én
variant: både `uni-list` (univers-modalen) og `group-list` (gruppe-modalen) er
alltid vertikale kolonner, så `updateUniversePlacement`/`updateGroupPlacement`
er transponerte kopier av kort-kolonelogikken (den gamle H-varianten for
mobil-gruppeRADEN er fjernet sammen med raden). Auto-scroll under draging
ruller modalens `.menu-body` (`overflow-y: auto`-containeren), ikke selve
listene — de har ingen egen scroll.

## Flytting av lister til en annen gruppe (innen samme univers)

Gruppene ligger ikke lenger som kort på hovedsiden. Dra i stedet lista opp på
**📁-breadcrumben** i toppmenyen: knappen markeres (`.drop-target`, kun når
det finnes andre grupper), dra-kortet blir gjennomskinnelig (`.to-group`), og
board-et fryses mens man sikter (ingen reorder over toppmenyen). Slipp legger
kortet normalt tilbake på board-et og åpner en velger («Flytt … til:», i
plasserings-modal-skallet via `openPicker`); valget gjør en kirurgisk flytting
(`moveCardToGroup`: `card.group` + `pos` bakerst, kun posisjonsregisteret
stemples — mounts flytter membershipen) + toast. Avbrytes velgeren blir lista
liggende. `moveCardToGroup` slår opp det LEVENDE kortet på id — en
synk-rebuild kan ha byttet ut objektet mens velgeren sto åpen.

Kun mulig innen samme univers — velgeren viser kun det aktive universets
grupper, se `docs/data-model.md`.
