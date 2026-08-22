# Migrering til dnd-kit + Smett — plan

En levende arbeidsplan, som `mobilapp-plan.md`: den viser hva som er avklart,
hva som gjenstår og hva som fortsatt er ubesvart. Nåtilstanden for dagens motor
står i [`drag-and-drop.md`](drag-and-drop.md), og den er autoritativ til
migreringen faktisk er gjennomført.

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
| `attachHoldDrag`, `preventTouchScroll` (79) | `PointerSensor` + `activationConstraints` |
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
| Dra-sonen (`.card-head`, `.cat-head`, hele `.item`) | `handleSelector` |
| Dynamisk rotasjon ±5° + skala per type | CSS `rotate:`/`scale:` på `[data-dnd-dragging]` (egne egenskaper, ikke `transform` — den skriver dnd-kit selv med `!important`). `SafeViewport` måler den faktisk malte boksen, så klemmen tar høyde for det |
| `move_group`-RPC-en, `applyIdMapping`, `pendingGroupMoves` | uendret; kalles fra `onCommit` |

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

### Innpakning uten bundler

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

1. **`position: fixed` på iOS WebKit.** dnd-kits regel er
   `[data-dnd-dragging] { position: fixed !important; transform: var(--dnd-transform) !important }`
   — nøyaktig kombinasjonen `drag-and-drop.md` sier vi bevisst unngikk, fordi et
   `fixed`-element med egen transform legger seg relativt til dokumentet der og
   «scroller vekk» ved løft. dnd-kit legger riktignok elementet i **top layer** via
   `popover`, som kan gjøre spørsmålet irrelevant. **Dette må verifiseres på ekte
   iOS-maskinvare før noe annet i planen settes i gang.** Svarer det feil, er
   migreringen blokkert på en upstream-endring.
2. **Testene driver drag med syntetiske `PointerEvent`-er.** dnd-kits
   `PointerSensor` kaller `document.body.setPointerCapture(event.pointerId)` og
   **kansellerer draget hvis det kaster** — som det alltid gjør for en oppdiktet
   `pointerId`. Smetts egen roadmap fører dette opp som en kjent upstream-kostnad.
   11 testfiler definerer syntetiske pekerhendelser; 7 av dem har ingen ekte input
   i det hele tatt (`dnd-collapse-scroll`, `dnd-drop-animation`,
   `dnd-extract-thresholds`, `dnd-mobile-autoscroll`, `dnd-peek-collapsed`,
   `dnd-recovery-scroll`, `dnd-viewport-clamp`, pluss `board-columns`). De må
   skrives om til `page.mouse`/`page.touchscreen`, slik Smetts egen `e2e/helpers.js`
   gjør. Dette er den største enkeltposten i arbeidet, og den er uunngåelig.
3. **Opplesningene er engelske.** `announcements.ts` er faste engelske strenger,
   og `SortableBoard` bygger dem selv. `docs/sprak.md` og `docs/tilgjengelighet.md`
   krever at ALL brukerrettet tekst — også `announce()` — kommer fra ordboken.
   Man kan sende inn en egen `manager` med egne `announcements`, men board-ets
   `onAnnounce`-speiling og `speak()` (programmatisk flytting, feilet lagring)
   bruker fortsatt `say.*`. Smett trenger injiserbare fraser. Liten endring, men
   den er en forutsetning, ikke en pynt.
4. **Klikk etter drag undertrykkes ikke.** dnd-kit binder `preventDefault` på
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
7. **Placeholderens geometri.** dnd-kit holder plassen med en klone tatt ved løft.
   Vi krymper placeholderen (liste → korthode-høyde, kategori → header-høyde) etter
   løft. Det må gjøres om til CSS på `[data-dnd-placeholder]`.

## Rekkefølge

Ingen big bang. Motoren driver fem nivåer i to scope; å bytte alt i én PR er ikke
verifiserbart.

0. **Blokker-avklaring.** Punkt 1 (iOS) på ekte maskinvare, og punkt 2/3 avtalt
   som endringer i Smett. Ingenting under her er verdt å begynne på før dette står.
1. **Smett-endringene**, i `peohol/smett`: IIFE-byggemål, injiserbare fraser,
   `itemType`/`containerAccept`. Egne PR-er der, med Smetts egne browser-suiter.
2. **Testinfrastrukturen først.** Skriv om de 8 filene til ekte input MOT DAGENS
   MOTOR. De skal være grønne før og etter — det er hele poenget: da er de et net
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
