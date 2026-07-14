# Dra-og-slipp-logikk

Les denne når oppgaven berører reorder, overføring mellom lister/grupper, eller
selve dra-motoren i app.js.

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
- Håndtak (`.drag-handle`) har `touch-action: none`; draging starter kun fra
  håndtaket. `pointercapture` brukes så draging ikke mister eventer. Placeholder
  lever kun under draging; `finishDrag()` har sikkerhetsnett.
- **Alle håndtak er tre vertikale prikker** tegnet i CSS (`::before` + to
  prikker via `box-shadow` — ingen glyf/SVG i templatene), og er alltid
  nøyaktig vertikalt midtstilt i raden sin (`align-self: stretch` +
  grid-sentrering). **Alle placeholders deler én stil** (felles regel for
  `.card-/.item-/.group-placeholder`): 1px stiplet kant med lav opacity, svakt
  mørknet flate og en subtil inset-skygge («hull som skal fylles») — kun
  radius/margens varierer per type.
- **Tastatur-reordering**: håndtakene er `<button>` (fokuserbare). Piltaster
  opp/ned (+ venstre/høyre for gruppe-rader) flytter det fokuserte objektet ett
  hakk blant sine synlige søsken — `arrowDir()` + `neighborPos()` gir en ny
  fraksjons-`pos` mellom de nye naboene, samme kirurgiske pos-stempling som
  peker-draging, så fokus følger med til det flyttede objektet. Gjelder
  element/kort/gruppe/univers. Redusert bevegelse hopper over FLIP-tweenen.
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

## Univers-rader (meny-modalen)

Samme håndtak + placeholder + FLIP-motor som gruppekortene, men kun i én
variant: `uni-list` er alltid en vertikal kolonne (ingen mobil/desktop-bytte
som gruppelista), så `updateUniversePlacement` er en transponert kopi av kun
`updateGroupPlacementV`. Auto-scroll under draging ruller `.menu-body`
(modalens `overflow-y: auto`-container), ikke `uni-list` selv — `uni-list` har
ingen egen scroll.

## Overføring av lister mellom grupper (innen samme univers)

Dra en liste opp på et gruppekort i gruppemenyen: gruppekortet markeres
(`.drop-target`), dra-kortet blir gjennomskinnelig (`.to-group`), board-et fryses
mens man sikter. Slipp = kirurgisk flytting (`card.group` + `pos` bakerst, kun
posisjonsregisteret stemples) + toast + puls på målgruppen (`pulseReceivedGroup`).

Kun mulig innen samme univers — kun det aktive universets grupper vises i
gruppemenyen, se `docs/data-model.md`.
