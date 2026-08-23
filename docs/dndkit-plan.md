# Migrering til dnd-kit + Smett — plan

En levende arbeidsplan, som `mobilapp-plan.md`: den viser hva som er avklart,
hva som gjenstår og hva som fortsatt er ubesvart. Nåtilstanden — hva som kjører
på hvilken motor akkurat nå — står i [`drag-and-drop.md`](drag-and-drop.md), og
den er autoritativ.

## Hvor vi er

| Steg | Status |
|---|---|
| 0. Blokker-avklaring | **ferdig** — iOS-risikoen er avkreftet på ekte maskinvare (se risiko 1) |
| 1. Smett-endringene | **ferdig** — IIFE-byggemål, `phrases`, `itemType`/`containerAccept` (smett@c97fe43) |
| 2. Testinfrastrukturen | **ferdig** — alle elleve DnD-testfilene drives av ekte input (`tests/dnd-gestures.js`) |
| 3. Nav-scopet | **ferdig** — `vendor/smett-0.1.0.js` er sjekket inn (smett@8a760a3, som pinner esbuild eksakt), og nav-modalen kjøres av dnd-kit |
| 4. Board-scopet, kortnivået | gjenstår |
| 5. Board-scopet, radnivået | gjenstår |
| 6. Ekstrahering til ny liste | gjenstår for board-scopet; nav-scopets versjon kom med steg 3 (se under) |
| 7. Rydding | gjenstår |

## Hva som har skjedd i Smett

`peohol/smett` startet som en uttrekking av Huskis' egen motor. Den siste
mergede PR-en (#4, «Rebuild Smett as a policy layer over dnd-kit») snudde
prosjektet: motoren er gitt bort til [dnd-kit](https://github.com/clauderic/dnd-kit),
og det som er igjen er de reglene dnd-kit bevisst lar stå åpne. `SortableController`
(654 linjer) er borte sammen med geometri-, motion-, scroll-, autoscroll-,
ownership- og live-region-modulene. Igjen står ~1 100 linjer fordelt på syv
politikk-moduler, en DOM-registrering og et board.

Det avgjørende for oss: **hver eneste regel Smett beholdt er en Huskis-regel, med
Huskis' egne tall.** De er ikke tilnærmet like — de er identiske:

| Huskis | Smett | Verdi |
|---|---|---|
| `SWAP_RATIO` | `swapRatio` | 0.2 |
| `SWAP_REV_RATIO` | `reverseRatio` | 0.5 |
| `SWAP_LOCK_MS` | `reverseLockMs` | 300 |
| «kolonne = ≥ 50 % horisontal overlapp» | `crossAxisRatio` | 0.5 |
| `HOLD_MS` | `holdMs` | 200 |
| `HOLD_MOVE` | `holdTolerance` | 10 |
| `HOLD_MOVE_MOUSE` | `mouseDistance` | 5 |

I tillegg er `draggedRect()` (uklemt intensjon) → `intentRectangle()`,
`clampToViewport` + `safeInsets()` → `SafeViewport` med kjøretids-insets, og den
autoritative sluttplasseringen ved `pointerup` → `AuthoritativeDrop` +
`insertByPoint`. Smett er altså ikke et fremmed system vi skal tilpasse oss til.
Det er våre egne regler, tatt vare på, med motoren under byttet ut.

## Hva som forsvinner

Dra-og-slipp-seksjonen i `app.js` er ~2 680 linjer (fra `DRA-OG-SLIPP-MOTOR` til
søppelkasse-seksjonen). Grovt regnet **~1 200 av dem er motor** og erstattes:

| Huskis-kode | Erstattes av |
|---|---|
| `attachHoldDrag` (77) | `PointerSensor` + `activationConstraints` |
| `preventTouchScroll` (2) | `PointerSensor`s egen ikke-passive `touchmove`-vakt, bundet ved AKTIVERING |
| `beginDragCommon`, `liftElement`, `moveElement`, `dragPosLeft/Top`, `dragUsesPageCoords`, `onDragScroll` (122) | `Feedback` (top layer via `popover`) + `ScrollListener` |
| `clampToViewport`, `dragRenderedHalf` (25) | `SafeViewport` |
| `vOverlap`…`isSingleRowLayout`, `layoutRect`, `draggedRect` (65) | `hysteresisCollision` + `intentRectangle` + dnd-kit-shapes |
| `snapshotRects`, `flipFrom` (71) | `Sortable`s indeks-transisjon |
| `wouldMove`, `placePlaceholder`, `swapReversesRecent`, `recordSwap`, `centerPlaceRows`, `dropIntoPlaceholder` (130) | `Hysteresis`-pluginen, `OptimisticSortingPlugin`, `Feedback`s drop-animasjon |
| `finishDrag`, `restoreDraggedToOrigin`, `cancelActiveDrag`, `dragElDetached` (106) | `DragOperation`-tilstandsmaskinen + Smetts `MutationObserver` |
| `frameSteps`…`stopAutoScroll` + modal-loopen (151) | `AutoScroller` / `Scroller` |
| `updateCardPlacement`/`commitCardPlacement` (105), `placeRowPlaceholder` (34), og plasseringshalvdelen av `updateItemPlacement`/`updateCategoryPlacement` | kollisjonsrammeverket + `settle()` |
| `startCardDrag`/`startItemDrag`/`startCategoryDrag`, `on*Move`, `on*Cancel` (~170) | sensorene + board-ets livssyklus |

To Huskis-problemer forsvinner **helt**, ikke bare flyttes:

- **`position: absolute` med dokument-koordinater.** Vi valgte det fordi et
  `fixed`-element med egen transform legger seg feil på iOS WebKit. Prisen var
  at det løftede objektet utvider sidens scroll-område → board-bunn-klemmen i
  auto-scrollen, `onDragScroll`, og hele `dragUsesPageCoords`-skillet mellom
  board og modal. dnd-kit løfter i stedet elementet inn i **top layer** via
  `popover`, som ikke teller i sidens scroll-område i det hele tatt.
  (At det samtidig er `position: fixed !important` er en åpen risiko — se under.)
- **To dra-scope med hver sin koordinatmodell.** `boardScope.pageCoords` /
  `navScope.pageCoords` blir uten mening; begge blir viewport-koordinater.

## Hva som blir igjen — og hvor det henger

Resten (~1 500 linjer) er Huskis-politikk, ikke motor. Den skal ikke bort; den
skal henge på Smetts kroker i stedet for på våre egne pointer-lyttere:

| Huskis-mekanikk | Smett-/dnd-kit-kroken |
|---|---|
| Søppelkassen som slippmål (`armDragTrash`, `pointerOnDragTrash`, `dropIntoTrash`) | `zoneSelector` + `onZoneDrop`. Smett ruller objektet tilbake FØR handlingen — nøyaktig dagens semantikk («ingen ny `pos` skrives») |
| 📁-breadcrumben som slippmål (`pointerOnNavCrumb`, `askCardMove`) | en ny sone (`data-dnd-zone="crumb"`) |
| Peek-åpning av kollapsede mål (`updatePeek`, `PEEK_MS`) | `onDropTarget` + app-timer. Smetts `extensions.md` viser mønsteret |
| `[data-drag-target]`-markering | `[data-dnd-over="item\|container\|zone"]` males av board-et |
| Skillelinje-forhåndsvisning (`applyDragSeparators`) | `dragover` fra `manager.monitor` + `[data-dnd-placeholder]` som «raden som kommer» |
| Kollaps-alle under liste-drag, normal-flow-vakten (`freezeBoardForDrag`) | `dragstart`/`dragend` fra `manager.monitor` |
| `scrollDroppedIntoView` | `onCommit` |
| `reindexContainerColors` | `onCommit` |
| `stampPos` / `between(prev, next)` / `cloudPersonalPos` | `onCommit` — Smetts egen anbefaling for rank-baserte databaser |
| Slipp i LÅST mål avvises | dnd-kits `accept` på droppablen. Dette blir **bedre**: en frossen container avviser under draget i stedet for etter slippet |
| `canDrag` (frossen/`done`/capability/forelderens myndighet) | `data-dnd-ignore` på raden — `preventPointer` sjekker `closest('[data-dnd-ignore]')` først |
| Unntakssonene (`.obj-menu-btn`, `.edit-input`, `.meta-chip`, avmerkingsboks) | `data-dnd-ignore` på de samme elementene |
| Dra-sonen (`.card-head`, `.cat-head`, hele `.item`) | `handleSelector` — UTEN `touch-action: none` |
| Dynamisk rotasjon ±5° + skala per type | CSS `rotate:`/`scale:` på `[data-dnd-dragging]` (egne egenskaper, ikke `transform` — den skriver dnd-kit selv med `!important`). `SafeViewport` måler den faktisk malte boksen, så klemmen tar høyde for det |
| `move_group`-RPC-en, `applyIdMapping`, `pendingGroupMoves` | uendret; kalles fra `onCommit` |
| `relayoutBoard`s frosne kolonner (`if (drag.active) return`) | `!manager.dragOperation.status.idle` — se under |

**Én kilde til sannhet må byttes ut, ikke bare flyttes.** `drag.active` er ikke
bare motorens interne flagg: `relayoutBoard` starter med `if (drag.active) return`,
og DET er stedet den frosne kolonnefordelingen faktisk håndheves. `boardRO`
(en `ResizeObserver`) planlegger `relayoutBoard` på neste rAF hver gang et kort
endrer høyde — og `collapseCardsForDrag` endrer høyden på ALLE kortene idet et
liste-drag starter. Uten en ny vakt ville board-et pakket om kolonnene midt i
draget, som er nøyaktig den flimringen `drag-and-drop.md` sier frysingen finnes
for. Vakten blir `!manager.dragOperation.status.idle`, og en utsatt
`relayoutBoard` etter `dragend` (kortene har da endret høyde for godt). Samme
gjelder `syncHeaderHeight`/`fixBoardBottomGap`-trioen på linje 6254, som deler
`ResizeObserver`-vei.

## Den konkrete arkitekturen

Fire board, to per scope, delt manager per scope:

```
boardScope (#board)                        navScope (#nav-board)
  kortboard:  item .card                     områdeboard: item .card
              container .board-col                        container .board-col
  radboard:   item .item, .category          mappeboard:  item .item, .category
              container .items-container,                 container .items-container,
                        .cat-items                                  .cat-items
```

Kort og rader er to nivåer i samme DOM, og Smetts `extensions.md` sier eksplisitt
«et board per hierarkinivå». De to trykksonene overlapper ikke — kortets håndtak
er `.card-head`, radene ligger i `.card-body` — så dnd-kits sensor-stempling
avgjør uansett riktig. De to boardene i ett scope deler `manager` (én gestrom),
så et listepunkt kan dras fra ett kort til et annet.

### Markup-endringer

Identitet må stå i DOM-en, og Smett feiler hardt på manglende/duplisert id:

- `idAttribute: 'data-id'` — vi har den allerede på `.card`, `.item`, `.category`.
- `.board-col` trenger `data-dnd-container` (indeksbasert; kolonnene bygges av
  `relayoutBoard`).
- `.items-container` trenger `data-dnd-container` = kortets id.
- `.cat-items` trenger `data-dnd-container` = kategoriens id.
- `.items-done` skal ikke være en container: bruk barn-selektorer
  (`.items-container > .item`, `.cat-items > .item`, `.items-container > .category`)
  så «Utført»-radene aldri registreres.
- Søppelkassene og nav-knappen trenger `data-dnd-zone`.
- Låste/`done`-rader og alle knapper i dra-sonen trenger `data-dnd-ignore`.

### Innpakning uten bundler *(gjort i steg 3)*

Huskis har ingen bundler og ingen klientavhengigheter, og det skal den ikke få.
Smett publiserer i dag ESM (`dist/`) og én selvstendig ESM-bundle
(`dist/smett.browser.js`); ingen av delene lastes av en klassisk `<script>`.
Løsningen er den samme som for Supabase: **en innsjekket, uendret UMD/IIFE-kopi
i `vendor/`**, lastet før `app.js`.

```html
<script src="vendor/smett-0.1.0.js"></script>   <!-- window.Smett -->
```

Det krever ett nytt byggemål i Smett (`esbuild --format=iife --global-name=Smett`)
og at artefaktet publiseres. Målt her: **126 KB rå, 41 KB gzip** minifisert —
mot 210 KB for den innsjekkede Supabase-kopien.

Alt annet følger `sikkerhetsheadere.md` uendret: `script-src 'self'` dekker det,
`vercel.json` gir `/vendor/(.*)` immutable cache, versjonen står i filnavnet, og
`tests/security-headers.test.js` får en `VENDOR_SHA384`-oppføring til.
`build.js` trenger ingen endring — `vendor/` kopieres allerede.

Alternativet — `<script type="module" src="app.js">` med `import` — er dårligere:
et modulskript kjører etter alle klassiske skript, så `update-check.js` ville
kjørt før `app.js`.

## Det som ikke har noe motstykke

Tre ting i Huskis har ingen Smett-modell, og de er selve arbeidet i migreringen:

1. **Ekstrahering til ny liste** («slipp i board-lufta»). Smetts svar er en
   semantisk sone, men vår er *posisjonell*: ny-liste-placeholderen velger kolonne
   etter pekerens x og plass etter det løftede objektets y-senter, og `extractionPos`
   gir den nye lista en `pos` mellom naboene. En sone gir `zoneId`, ikke «hvilken
   kolonne, hvilken plass». Veien videre: behold `placeNewListPlaceholder` som ren
   app-rendring (et element som ikke matcher noen `itemSelector`), og la
   `accept: () => !inExtractMode` på nivå-1-containerne slå av reorder mens
   ekstraheringsmodus står på.
2. **1/3-tersklene** (`dragOverCard`, `cardBand`, `MIN_BAND_SLACK`, `noteOverShift`).
   «Er objektet i denne lista?» er Huskis-politikk gjennom og gjennom, og den leser
   den uklemte intensjonsboksen — som Smett eksporterer (`intentRectangle`). Den
   flyttes uendret, men må lese `board.manager.dragOperation` i stedet for `drag.*`.
3. **Kategori som både rad og container.** En `.category` er et element i
   `.items-container` OG eier en `.cat-items`. Smetts `BoardRegistry` gir alle
   elementer typen `smett:item` og alle containere `accept: ITEM_TYPE`, så
   ingenting hindrer at en kategori slippes ned i en annen kategoris `.cat-items`
   — som Huskis forbyr («kategorier nøstes aldri»).

Punkt 3 er den ene **endringen Smett faktisk trenger**: en måte å gi elementer
ulik type og containere ulik `accept`. dnd-kit har mekanismen (`accept` kan være
`(source) => boolean`); den er bare ikke ført gjennom `SortableBoardOptions`. To
små tilvalg — `itemType?(el)` og `containerAccept?(el)` — løser det, og
`registry.ts` har allerede presedensen (`acceptsPointerDrag` for soner).

## Åpne risikoer, i rekkefølge

1. ~~**`position: fixed` på iOS WebKit.**~~ **AVKREFTET** på ekte maskinvare
   (iOS 26.6, Safari og Chrome): WebKit-defekten finnes ikke lenger, og
   kontrollen — `position: fixed` + transform UTEN top layer — hoppet heller
   ikke. dnd-kits top layer er altså ikke det som redder oss; det er ingenting å
   redde fra. Begrunnelsen for `position: absolute` i `drag-and-drop.md` er
   foreldet og skrives om i steg 7. Den opprinnelige teksten:
   dnd-kits regel er
   `[data-dnd-dragging] { position: fixed !important; transform: var(--dnd-transform) !important }`
   — nøyaktig kombinasjonen `drag-and-drop.md` sier vi bevisst unngikk, fordi et
   `fixed`-element med egen transform legger seg relativt til dokumentet der og
   «scroller vekk» ved løft. dnd-kit legger riktignok elementet i **top layer** via
   `popover`, som kan gjøre spørsmålet irrelevant. **Dette må verifiseres på ekte
   iOS-maskinvare før noe annet i planen settes i gang.** Svarer det feil, er
   migreringen blokkert på en upstream-endring.
2. ~~**Testene driver drag med syntetiske `PointerEvent`-er.**~~ **GJORT** i
   steg 2: alle elleve filene drives av ekte input gjennom `tests/dnd-gestures.js`.
   Den opprinnelige teksten: dnd-kits
   `PointerSensor` kaller `document.body.setPointerCapture(event.pointerId)` og
   **kansellerer draget hvis det kaster** — som det alltid gjør for en oppdiktet
   `pointerId`. Smetts egen roadmap fører dette opp som en kjent upstream-kostnad.
   **Elleve testfiler driver drag syntetisk, og alle elleve må skrives om** — ikke
   bare de som mangler ekte input:

   - **Åtte uten ekte input i det hele tatt**: `board-columns`,
     `dnd-collapse-scroll`, `dnd-drop-animation`, `dnd-extract-thresholds`,
     `dnd-mobile-autoscroll`, `dnd-peek-collapsed`, `dnd-recovery-scroll`,
     `dnd-viewport-clamp`.
   - **Tre som har ekte input for MUS, men syntetiske gester for TOUCH**:
     `dnd-activation` (13 `pointer()`-kall — hold-aktivering, sekundær peker,
     `pointerup` uten `pointermove`), `dnd-layout-modes` (14 `touch()`-kall) og
     `dnd-separators-preview` (5). Disse ser «halvt dekket» ut og er det ikke:
     musedelene overlever, touch-delene dør like stille som de åtte.

   De skrives om til `page.mouse`/`page.touchscreen`, slik Smetts egen
   `e2e/helpers.js` gjør. Dette er den største enkeltposten i arbeidet, og den er
   uunngåelig.
3. ~~**Opplesningene er engelske.**~~ **LØST** i Smett: `phrases` erstatter
   setnings-byggerne, og nav-scopet bygger dem av `tr()`. Den opprinnelige
   teksten: `announcements.ts` er faste engelske strenger,
   og `SortableBoard` bygger dem selv. `docs/sprak.md` og `docs/tilgjengelighet.md`
   krever at ALL brukerrettet tekst — også `announce()` — kommer fra ordboken.
   Man kan sende inn en egen `manager` med egne `announcements`, men board-ets
   `onAnnounce`-speiling og `speak()` (programmatisk flytting, feilet lagring)
   bruker fortsatt `say.*`. Smett trenger injiserbare fraser. Liten endring, men
   den er en forutsetning, ikke en pynt.
4. ~~**Klikk etter drag undertrykkes ikke.**~~ **LØST for nav-scopet** med en
   vakt på dokumentet, i capture-fasen, for det første klikket etter et drag
   (`navInstallClickGuard`) — den dekker også slippet på en ANNEN rad, som
   `attachHoldDrag`s vakt på kildens sone aldri så. Steg 4–5 arver den.
   Den opprinnelige teksten: dnd-kit binder `preventDefault` på
   `click`; våre `.card-head`- og `.cat-head`-handlere er vanlige `click`-lyttere
   og fyrer likevel — et fullført liste-drag ville kollapset lista etterpå.
   `attachHoldDrag`s `stopImmediatePropagation`-vakt må beholdes og kobles på
   `dragend`.
5. **Retningsstyringen er borte.** Vår regel er «nedover-drag bytter kun med kortet
   under». Smetts `hysteresisCollision` har ingen retningsinngang: den tar nærmeste
   godkjente nabo, og reverseringslåsen gjør jobben retningen gjorde. Det er en
   bevisst forenkling i Smett, men det er en oppførselsendring som må kjennes på,
   ikke bare leses.
6. **Auto-scroll-sonene.** `AutoScroller.threshold` er en brøkdel av containeren.
   Vår øvre sone måles fra bunnen av den faste toppmenyen, nettopp for at man ikke
   skal måtte dra lista opp bak headeren. Med 0.2 × viewporthøyde rekker sonen
   uansett godt under headeren, så dette er trolig akseptabelt — men det skal
   måles, ikke antas. Samme for at farten er per frame, ikke per millisekund
   (`frameSteps` forsvinner): 120 Hz scroller fortere enn 60 Hz.
7. **Placeholderens geometri.** *(Løst for nav-scopet: kollapsen skjer i
   `beforedragstart`, altså FØR dnd-kit måler, så klonen er korthøy/
   overskriftshøy av seg selv. Se punkt 3 over.)* dnd-kit holder plassen med en klone tatt ved løft.
   Vi krymper placeholderen (liste → korthode-høyde, kategori → header-høyde) etter
   løft. Det må gjøres om til CSS på `[data-dnd-placeholder]`.

Én ting som IKKE er en risiko, fordi spørsmålet melder seg av seg selv: at
native panorering fortsatt blokkeres mens draget lever. `activationConstraints`
avgjør bare NÅR draget starter; det er `PointerSensor` som ved aktivering binder
en ikke-passiv `touchmove` med `preventDefault` — samme mekanikk som
`preventTouchScroll`, bare upstream. Dra-sonene skal derfor IKKE ha
`touch-action: none`: Smetts anbefaling om det gjelder et dedikert håndtak, mens
vår sone er hele raden/korthodet og må fortsatt kunne scrolles fra. Det er
nøyaktig `card`-policyen i Smetts egen Release Board («as Huskis does»).

## Rekkefølge

Ingen big bang. Motoren driver fem nivåer i to scope; å bytte alt i én PR er ikke
verifiserbart.

0. **Blokker-avklaring.** Punkt 1 (iOS) på ekte maskinvare, og punkt 2/3 avtalt
   som endringer i Smett. Ingenting under her er verdt å begynne på før dette står.
1. **Smett-endringene**, i `peohol/smett`: IIFE-byggemål, injiserbare fraser,
   `itemType`/`containerAccept`. Egne PR-er der, med Smetts egne browser-suiter.
2. **Testinfrastrukturen først.** Skriv om ALLE elleve filene — hver syntetiske
   gest, ikke bare filene som mangler ekte input helt — til ekte input MOT DAGENS
   MOTOR. De skal være grønne før og etter; det er hele poenget: da er de et net
   under migreringen i stedet for en post i den.
3. **Nav-scopet først, ikke board-scopet.** Færre særtilfeller (alltid én kolonne,
   ingen ekstrahering til ny liste, ingen normal-flow-vakt, egen scroll-container),
   og det er det scopet der en feil er minst synlig for en bruker.
4. **Board-scopet, kortnivået** (lister i kolonner): kollaps-alle, board-vakten,
   søppelkassen, breadcrumben, `scrollDroppedIntoView`.
5. **Board-scopet, radnivået** (listepunkt + kategori): peek, skillelinjer,
   kategori-kollaps, kategori → annen liste.
6. **Ekstrahering til ny liste** til slutt — den er mest Huskis og minst Smett.
7. **Rydding**: slett den døde motoren, skriv om `drag-and-drop.md` til
   nåtilstanden, og la dette dokumentet dø.

## Det steg 3 lærte, som ikke sto her

Nav-scopet er i mål, og sju ting i planen over viste seg å være feil eller
ufullstendige. De står her fordi steg 4–6 møter de samme spørsmålene.

**1. Nav-scopet HAR ekstrahering.** Planen sa «ingen ekstrahering til ny liste»
som en grunn til å ta nav først. Det stemmer ikke: `navScope.canExtract` finnes,
og en mappe eller mappekategori dratt ut i lufta blir et nytt OMRÅDE. Den måtte
derfor med i steg 3, og løsningen er den planen selv foreskriver for steg 6:
`containerAccept` som svarer med tom liste mens ekstraheringsmodus står på, og
`placeNewListPlaceholder` som ren app-rendring. Det virker. Én forskjell fra den
gamle motoren, med vilje: klonen dnd-kit holder plassen med blir liggende i lista
i stedet for å bli fjernet, så layout-hoppet ved modusbyttet er mindre.

**2. CSP-en måtte utvides.** dnd-kit injiserer et `<style>`-element mens et drag
pågår — det som løfter objektet inn i top layer og posisjonerer det. `style-src
'self'` blokkerte det, og feilen var stille: draget «virket», men det løftede
objektet ble liggende sentrert i viewporten i stedet for å følge fingeren. Ett
element, én hash, og to av dnd-kits plugins (`Cursor`, `PreventSelection`) er
meldt av fordi Huskis maler det de maler fra `body.is-dragging`.
`tests/csp-enforced.test.js` regner hashen ut på nytt fra et EKTE drag.
Se [`sikkerhetsheadere.md`](sikkerhetsheadere.md).

**3. `beforedragstart` er den eneste kroken før målingen.** dnd-kit måler det
løftede objektets boks ÉN gang, og Smetts `intentRectangle` regner ut fra den.
Alt som endrer objektets størrelse ved løft — kollapsen av alle kort, kategoriens
sammenfolding — må derfor skje i `beforedragstart`, ikke i `dragstart`. Steg 4 og
5 møter nøyaktig det samme med `collapseCardsForDrag` og `collapseCategory`, og
kategori-kollapsen må da også bli momentan.

**4. Tre regler måtte uttrykkes som kollisjonsdetektorer.** Planen antok at
`accept` og sonene dekket avvikene. Tre gjorde de ikke:
kategoriens OVERSKRIFT som vei INN i kategorien, kolonnen som må ta imot et kort
sluppet nedenfor alt innhold, og at et `collisionPriority` på entiteten
OVERSTYRER det detektoren svarte (så en droppable som trenger to prioriteter må
settes til `null`). Alle tre er `docs/drag-and-drop.md`-stoff nå; steg 4 og 5
arver de to siste.

**5. dnd-kits klone er ikke en nabo.** Klonen som holder plassen ligger rett
etter det løftede objektet og bærer de samme klassene. `previousElementSibling`/
`nextElementSibling` — som hele `pos`-regnestykket hviler på — leste den som
naboen, og svarte da alltid «ingen nabo på den siden», altså «sist i lista»,
uansett hvor man slapp. `boardRows`/`isBoardRow` og en egen `navRowSibling`
hopper over den nå. Det samme gjelder `sepRows` (skillelinjene) og
`restoreCardsAfterDrag`.

**6. En ombygging må MELDES til dnd-kit.** Smett følger med på DOM-et selv, men
lar det være i fred mens et drag pågår — da er det dnd-kits. Rendringen etter et
slipp faller mellom de to: den kommer mens dnd-kit ennå avslutter draget, og
etterpå kommer det ingen ny endring å reagere på. Registeret blir stående med de
gamle, frakoblede elementene, og NESTE løft finner ingenting å løfte. På mus rakk
en synkrunde ofte å rendre imellom og skjulte feilen; på touch gjorde den ikke
det, og et andre områdedrag var umulig. `renderNav` avslutter derfor med
`navSyncBoards()` (Smetts `sync()` på begge board-ene). Steg 4 og 5 rendrer på
nøyaktig samme måte etter et slipp og trenger det samme.

**7. Et områdes `pos` må regnes innenfor sin egen seksjon.** Nav-modalen har tre
seksjoner, og `renderNav` sorterer på seksjon før `pos` — så en pos hentet over
en seksjonsgrense flytter ingenting dit man ser. Verre: det virtuelle «Mapper
delt med meg»-kortet har `pos: Infinity`, og `between(Infinity, null)` er
`Infinity`, som ikke overlever JSON. Et område sluppet nedenfor alt lagret da
`pos: null` på medlemskapsraden og mistet brukerens egen rekkefølge. Feilen
fantes i den gamle motoren også (samme regnestykke, samme placeholder-plassering
nederst i kolonnen), så steg 4–5 arver den ikke — men `navCardNeighbour` er nå
regelen ett sted, og tastaturet fulgte den allerede (`moveCtx`).

**Fortsatt uløst, og det gjelder steg 4–5 også:** et slipp i et LÅST mål avvises
ved slippet (`onCommit` kaster → Smett ruller tilbake), ikke under draget slik
planen ønsket. `containerAccept` kjenner bare containeren, ikke hvor raden kom
fra — og regelen er kilde-avhengig (en fri mappe kan omrokkeres i fri-seksjonen,
men ingen mappe kan flyttes INN i den). Å få den under draget krever enten et
kilde-argument til `containerAccept` i Smett, eller at Huskis setter `accept` på
droppable-ene selv ved `dragstart`. Utfallet er uendret i dag: rullet tilbake, og
en toast sier hvorfor.
