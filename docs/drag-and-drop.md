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
- **Posisjonsbasert farge reindekseres alltid ved en fullført omrokkering**
  (ikke bare ved add/slett): `onCardUp`/`onGroupUp`/`onUniverseUp` kaller hhv.
  `reindexCardColors()`/`reindexGroupColors()`/`reindexUniverseColors()` etter
  `stampPos()`. Disse går gjennom den sorterte lista (samme kilde som
  `render()`/`renderGroups()`/`renderUniverses()` bruker) og setter
  `colorForIndex(i)` + oppdaterer CSS-variablene direkte på de allerede
  eksisterende DOM-nodene — kirurgisk, ingen full re-rendring (som ville
  kuttet FLIP/drop-avslutningsanimasjonen).

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
