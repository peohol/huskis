# Dra-og-slipp-logikk

Les denne når oppgaven berører reorder, overføring mellom lister/grupper, eller
selve dra-motoren i app.js.

Bytte utløses av **overlapp**, ikke av et punkt:

- ≥ **20 %** høyde-/breddeoverlapp bytter plass; **retningsstyrt** (hysterese mot
  flimring): nedover-drag bytter kun med kortet under, oppover kun med kortet over
  (transponert for horisontale rader).
- **Anti-flimring-lås** (`SWAP_LOCK_MS` = 200 ms, litt over FLIP_MS): rett etter et
  bytte ligger geometrien ofte slik at det MOTSATTE byttet umiddelbart trigges
  igjen (pekeren står nær grensen mens et nabo-element nettopp har relokert via
  FLIP) → objektene hopper frem og tilbake. `swapReversesRecent`/`recordSwap`
  blokkerer derfor KUN det direkte omvendte av forrige bytte (samme nabo-`ref`,
  motsatt `pos`) innen låsvinduet; all annen fremdrift (andre naboer, `append`,
  samme retning videre) slipper alltid gjennom, og en bevisst tilbakeføring virker
  igjen etter 200 ms. Låsen nullstilles per drag (`drag.recentSwap`) og gjelder
  kort/element/gruppe/univers (kategori-plasseringen er ren senterbasert og
  flimrer ikke). Fjerner det umiddelbare auto-tilbake-byttet; en rask, bevisst
  frem-og-tilbake begrenses til ett bytte per vindu (ikke øyeblikkelig).
- **Kolonne** = kort med ≥ 50 % horisontal overlapp; kryss-kolonne plasseres etter
  vertikal senterposisjon. For elementer = overføring til annen `.items-container`.
- **FLIP-animasjon (150 ms)** ved hver placeholder-flytting og ved slipp.
  `layoutRect()` trekker fra pågående FLIP-transform → stabil treffdeteksjon.
- Under draging manipuleres DOM direkte; state bygges fra DOM ved slipp (kirurgisk:
  kun det flyttede objektets posisjonsregister stemples).
- **Dynamisk rotasjon** av dra-kort (`cardRotation()`, ±5° ut fra horisontal
  posisjon); elementer roterer ikke. **Auto-scroll** ved vindus-kant for kort, og
  av gruppefeltet ved feltets kanter under gruppe-drag.
- **Posisjonering av det løftede elementet**: kort/element/kategori dras på selve
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
- **Kort-auto-scrollens ankerpunkt** (`updateAutoScroll`): symmetrisk og kant-
  forankret. OPPOVER måles kortets ØVRE kant mot toppen av området rett UNDER den
  faste headeren (`topbarEl`-bunn + `ZONE`), ikke mot viewportens øvre kant — ellers
  måtte man dra lista opp bak headeren før scrollingen slo inn (spesielt på mobil).
  NEDOVER måles kortets NEDRE kant mot viewportens nedre kant. Er kortet høyere enn
  gapet mellom sonene (ligger i begge samtidig), avgjør pekerens halvdel retningen.
- Kun én drag om gangen (`if (drag.active) return`); `finishDrag()` feier bort
  evt. foreldreløse placeholdere.
- **Trykk-og-hold starter draging** (`attachHoldDrag`, `HOLD_MS` = 200 ms). Dra-
  håndtakene er FJERNET; i stedet inviteres draging ved å trykke og holde på
  objektets navn-/tittelsone — men ikke på knappene (`except`-selektoren, med
  `closest`) og heller ikke på interaktive/redigerbare etterkommere som ligger i
  sonen (`HOLD_SKIP` = `.edit-input` (inline omdøping — et hold ville blokkert
  caret/markering) + `.meta-chip` (egne hurtigredigerings-knapper — et tregt
  trykk skal åpne dem, ikke løfte kortet)). Soner/unntak: **univers-/gruppe-rad**
  = hele chip-en unntatt
  ×-knappen; **liste** = hele korthodet (`.card-head`) unntatt tannhjul + ×;
  **element** = hele `.item` unntatt avmerkingsboks + tannhjul + ×; **kategori**
  = hele overskriftslinjen (`.cat-head`) unntatt tannhjul + oppløs-knapp.
  `attachHoldDrag(zone, dragEl, startDrag, canDrag, except)` gir `startXxxDrag`
  et syntetisk event med pekerinfoen fra `pointerdown` (fingeren er fortsatt nede
  når timeren løser ut, så `pointerId`-en er aktiv → `setPointerCapture` på
  `dragEl` virker). Et kort trykk gjør fortsatt det klikket pleide (omdøp/bytt/
  kryss av); ved et fullført hold undertrykkes det påfølgende klikket (capture +
  `stopImmediatePropagation`). Beveger pekeren seg > `HOLD_MOVE` (10 px) før
  holdet er fullført, avbrytes det (scroll/sveip) og siden scroller nativt —
  sonene har normal `touch-action`. `pointercancel` avbryter også. Avbrudds-
  lytterne (`pointermove`/`pointerup`/`pointercancel`) sitter på **window** mens
  man venter (ikke på `zone`): før holdet er ferdig er ikke pekeren fanget, så
  flyttes/slippes den utenfor sonen ville zone-lyttere aldri fyre og timeren
  startet et drag etter at knappen alt var sluppet. En synk-
  rebuild kan bytte ut noden mens man holder → timeren dropper draget om
  `dragEl` ikke lenger er `isConnected`. `canDrag` gater på frossen/mount/`done`.
  Under et pågående drag blokkeres native scroll av en ikke-passiv `touchmove`-
  lytter (`preventTouchScroll`, av/på i `beginDragCommon`/`finishDrag`). Mens
  holdet registreres får `dragEl` et lite «press» (`.drag-hold`, scale) —
  hoppes over ved `prefers-reduced-motion`. `pointercapture` brukes så draging
  ikke mister eventer. Placeholder lever kun under draging; `finishDrag()` har
  sikkerhetsnett.
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

En liste har nivå 1 (ukategoriserte elementer + kategorier, om hverandre) og
nivå 2 (elementene inne i hver kategori). DOM: kortets `.items-container` holder
nivå-1-radene (`.item` og `.category`); hver `.category` har en overskrift på
listeflaten + en nøstet `.cat-items`-liste (nivå 2) som er en innrykket
fordypning («hylle», se `docs/design-system.md`).

- **Element-draging** (`onItemMove`/`onItemUp`) finner mål-container i to steg:
  først om pekeren er inne i en `.category` → dens `.cat-items` (slipp på
  overskriften ELLER blant elementene legger elementet i kategorien); ellers
  kortets `.items-container` (nivå 1, inkl. overføring mellom lister). Elementer
  flyttes fritt mellom nivå 1, kategorier og lister. Søsken-rader leses fra
  **direkte barn** (`rowChildren`, ikke `querySelectorAll('.item')`) så nivå-1
  ikke plukker elementer inne i kategorier. Innsetting er senterbasert når
  containeren har kategorier (blandede radhøyder) eller ved overføring; ellers
  den vanlige retningsstyrte overlapp-hysteresen. `reconcileItems` bygger nå
  kortets `items` fra HELE DOM-treet (nivå 1 + hver kategoris `.cat-items`) og
  setter `it.cat`; ved slipp stemples kun det flyttede elementets `home`/`cat`/
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
- **Oppløs kategori** (`dissolveCategory`, boble-sprekk-knappen): elementene blir
  ukategoriserte og «arver» kategoriens plass i nivå-1-lista (fordeles jevnt i
  pos-gapet mellom kategorien og neste nivå-1-rad, rekkefølge bevart), og selve
  kategori-raden tombstones + fjernes.
- **Avkryssing**: et avkrysset element (også i en kategori) flyttes til kortets
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
