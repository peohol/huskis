# Dra-og-slipp-logikk

Les denne når oppgaven berører reorder, overføring mellom lister/mapper, eller
selve dra-motoren i app.js.

Motoren er **midt i et bytte**, og de to scopene kjøres derfor av hver sin:

| Nivå | Motor |
|---|---|
| `boardScope`, radnivået — listepunkter og kategorier | den hjemmesnekrede, på Pointer Events. Resten av dette dokumentet beskriver den. |
| `boardScope`, kortnivået — listene i kolonnene | **dnd-kit**. Se [«Board-scopets kortnivå kjører på dnd-kit»](#board-scopets-kortnivå-kjører-på-dnd-kit) under. |
| `navScope` — nav-modalen (områder, mapper, mappekategorier) | **dnd-kit**, gjennom [Smett](https://github.com/peohol/smett). Se [«Nav-scopet kjører på dnd-kit»](#nav-scopet-kjører-på-dnd-kit-smett) under. |

Rekkefølgen for resten av byttet står i [`dndkit-plan.md`](dndkit-plan.md).
**Politikken** — hva et slipp betyr, hvem som får lov, tersklene, peek,
skillelinjene, søppelkassen — er den samme i begge scopene og beskrives ett sted
her; det som skiller dem er hvem som leverer gesten, geometrien og
placeholderen.

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
  (`drag.recentSwap`), og gjelder kort/listepunkt/mappe/område (kategori-
  plasseringen er ren senterbasert og flimrer ikke). Aksen for overlapp-målingen
  velges etter hvor nabo og dra-senter er mest adskilt (vertikale lister → Y-
  overlapp; horisontal kort-rad → X-overlapp).
- **Kolonne** = kort med ≥ 50 % horisontal overlapp; kryss-kolonne plasseres etter
  vertikal senterposisjon. For listepunkter = overføring til annen `.items-container`.
- **Board-ets kolonner er ekte containere** (`.board-col`, se
  `docs/board-layout.md`), og fordelingen er FROSSET mens et drag pågår. Det er en
  DnD-forutsetning, ikke bare layout: med CSS multi-column kunne en placeholder lagt
  i én kolonne dytte et kort over i en annen, og siden svaret på «hvilken liste er
  objektet i?» (`dragOverCard`) leses av nettopp den layouten placeholderen former,
  vekslet plasseringen frem og tilbake for hver piksel. En placeholder påvirker nå
  kun sin egen kolonne, og alltid slik at nabokortene skyves BORT fra objektet —
  altså i «bli der du er»-retning. `placePlaceholder` legger derfor placeholderen i
  REFERANSERADENS container (kolonnen ref ligger i), ikke i en fast container.
  Rekkefølgen på board-nivå (`pos` ved slipp, `extractionPos`) leses med
  `boardRows()`/`boardRowSibling()`: naboen over den øverste raden i en kolonne
  ligger nederst i kolonnen FØR, ikke i samme container.
- **FLIP-animasjon (150 ms)** ved hver placeholder-flytting og ved slipp.
  `layoutRect()` trekker fra pågående FLIP-transform → stabil treffdeteksjon.
- Under draging manipuleres DOM direkte; state bygges fra DOM ved slipp (kirurgisk:
  kun det flyttede objektets posisjonsregister stemples).
- **Dynamisk rotasjon** av det løftede objektet (`cardRotation()`, ±5° ut fra
  horisontal posisjon: −5° inntil venstre kant, +5° inntil høyre). Gjelder
  **globalt** — ALLE objekt-typer (område/mappe/liste/listepunkt/kategori)
  roterer likt under draging (`start*Drag`/`on*Move` setter `rotate(…) scale(…)`)
  og ved slipp (`dropIntoPlaceholder(el, rot)`). Unntak: kategori-slippet folder
  seg ut igjen (`expandCategory`) og hopper derfor over drop-rotasjonen, ellers
  ville en rotert `.cat-items` blåst opp utfoldings-høyde-målingen; rotasjonen
  under selve draging gjelder også kategorier. **Auto-scroll** ved vindus-kant for
  kort, og av mappefeltet ved feltets kanter under mappe-drag.
- **Posisjonering av det løftede elementet**: kort/listepunkt/kategori dras på selve
  board-et (window kan være scrollet) og er `position: absolute` med DOKUMENT-
  koordinater (`dragPos*` = peker − grep + `window.scroll{X,Y}`). Det er bevisst
  IKKE `position: fixed`: på iOS WebKit (bl.a. Chrome for iPhone) legges et
  `fixed`-element SOM HAR en transform (skala/rotasjon under draging) relativt til
  dokumentet i stedet for viewporten, så det «scroller vekk» og hopper rett opp —
  ofte forbi viewporten — idet man tar tak. Absolute unngår dette (uendret på
  Android/desktop). Under auto-scroll flyttes kortet hver frame (`moveElement()` i
  scroll-loopen) så det blir liggende under fingeren. Mappe/område dras i en
  modal der window-scroll aldri endres og er derfor fortsatt `fixed` (viewport-
  koordinater — `dragUsesPageCoords()` skiller på `drag.kind`). Fordi et absolutt-
  posisjonert barn teller i sidens scroll-område (et `fixed` gjorde ikke det),
  klemmes nedover-auto-scroll ved board-ets faktiske bunn (ellers uendelig scroll
  ut i blankt) — pluss `--safe-bottom`, siden `.app-main` bærer gestelinjens
  strimmel som padding UNDER board-et og dokumentet derfor rekker så mye lenger
  (`docs/board-layout.md`). Nedre auto-scroll-sone måles mot den samme brukbare
  bunnen, ikke mot viewportkanten.
- **Det løftede objektet holdes ALLTID innenfor det brukbare feltet**
  (`dragPosLeft`/`dragPosTop` → `clampToViewport`, begge akser, alle
  objekt-typer). «Brukbart» = viewporten minus den sikre sonen: et hakk i siden
  er en del av `innerWidth`, og et objekt som stopper der ville lagt seg delvis
  under hakket mens board-et det kom fra står innenfor
  ([`design-system.md`](design-system.md)). Sonen er 0 i en nettleser, så
  klemmen regner ut nøyaktig det samme der. Det finnes
  ingen grunn til å dra noe utenfor skjermen, og et board-drag er `position:
  absolute`, så et objekt som stikker ut utvider sidens scroll-område: horisontal
  scrollbar, og på mobil/iOS WebKit forskyves da høyre-forankrede `position:
  fixed`-elementer (kontoknappen, toppmenyen) ut av viewporten. Klemmen måler den
  FAKTISK RENDREDE boksen (`dragRenderedHalf` = skala × maks rotasjon, og
  `dragScale()` gir riktig skala per type: liste 1.02, listepunkt/kategori 1.03,
  mappe/område 1.05 — en for lav skala her ga noen få piksler overflow, nok til
  en scrollbar). Er objektet større enn viewporten langs en akse, sentreres det.
  Klemmen slår kun inn helt ute ved kanten, så den er usynlig for vanlig reorder/
  kolonnebytte. `draggedRect()` er bevisst UKLEMT — den er pekerens *intensjon* og
  driver treffdeteksjon/auto-scroll.
- **FLIP-en rører aldri en FORFAR til det løftede objektet** (`flipFrom`): et
  transformert element blir containing block for sine absolutt posisjonerte
  etterkommere, så dra-elementets dokument-koordinater ville plutselig bli tolket
  relativt til forfaren — objektet hopper vekk fra fingeren, ofte helt ut av
  viewporten (og drar da headeren med seg, se punktet over). Det skjedde når et
  listepunkt/en kategori ble dratt ut i board-lufta: ny-liste-placeholderen
  omrokkerer board-ets kort, og kilde-kortet er en forfar til det løftede
  objektet. Slike forfedre snapper på plass uten tween i stedet.
- **Auto-scrollens ankerpunkt** (`updateAutoScroll`): symmetrisk og kant-
  forankret. OPPOVER måles kortets ØVRE kant mot toppen av området rett UNDER den
  faste headeren (`topbarEl`-bunn + `ZONE`), ikke mot viewportens øvre kant — ellers
  måtte man dra lista opp bak headeren før scrollingen slo inn (spesielt på mobil).
  NEDOVER måles kortets NEDRE kant mot viewportens nedre kant. Er kortet høyere enn
  gapet mellom sonene (ligger i begge samtidig), avgjør pekerens halvdel retningen.
  **Gjelder kort, listepunkt OG kategori** (`windowScrollDrag()` — alle tre dras på
  board-et med dokument-koordinater; mappe/område har egen modal-auto-scroll).
  Etter hver scroll-frame re-evalueres plasseringen via `reapplyPlacement(dir)`
  (kort → `updateCardPlacement`, listepunkt → `updateItemPlacement(lastX, lastY, dir)`,
  kategori → `placeRowPlaceholder`) med rulleretningen som dra-retning siden pekeren
  står stille. For kategorier settes `grabY` relativt til `.cat-head` (ikke hele den
  u-kollapsede boksen), ellers ville en `::before`-skillelinje over headeren gjort
  grabY større enn den kollapsede høyden → fingeren utenfor boksen, og nedre kant nådde
  aldri scroll-sonen.
- Kun én drag om gangen (`if (drag.active) return`); `finishDrag()` feier bort
  evt. foreldreløse placeholdere.
- **Sluttplasseringen er autoritativ** (`centerPlaceRows` + `commitCardPlacement`,
  `updateItemPlacement(..., commit)`, `updateCategoryPlacement(commit)`,
  `finishColumnDrop(o, ev)`): den løpende plasseringen er retningsstyrt og drives
  av `pointermove`, men den SISTE bevegelsen før et slipp kan være koalescert bort
  eller helt utelatt (rask gest, eller en peker som bare hoppet fra nedtrykk til
  slipp) — placeholderen kunne da bli stående fra NEST siste bevegelse. Ved
  `pointerup` kjøres derfor én siste plassering fra de FAKTISKE slipp-
  koordinatene, for ALLE fem nivåene (liste/listepunkt/kategori/mappe/område).
  Den er **ren senterbasert**: ingen retning (det finnes ingen ved et hopp), ingen
  20 %-terskel og ingen anti-reverseringslås — slipp-punktet ER brukerens tydelige
  sluttintensjon, og et raskt slipp skal lande der, ikke ett hakk unna. Retningen
  (`dy`) regnes alltid FØR `drag.lastX/Y` overskrives. Slippes lista over
  toppmenyen (nav-knappen), hoppes sluttplasseringen over — board-et ligger da
  bevisst i ro.
- **Drop-animasjonen starter der objektet FAKTISK står malt**
  (`dropIntoPlaceholder`): startpunktet måles med `untransformedRect(el)` mens
  elementet fortsatt er `.dragging` (transformen nøytraliseres, ellers ville den
  roterte omslutningsboksen blitt målt), ikke regnet ut fra den UKLEMTE
  `drag.lastX - grabX`/`lastY - grabY`. Så snart `clampToViewport` har slått inn
  (slipp ved eller utenfor viewportkanten) ligger den uklemte posisjonen utenfor
  skjermen, og animasjonen startet et sted objektet aldri var malt → et synlig
  hopp. `onCardUp` måler boksen selv (den må rydde dra-stilene før den måler
  slot-posisjonen) og sender den inn som `fromRect`. Startskalaen kommer fra
  `dragScale()` (liste 1.02, listepunkt 1.03, mappe/område 1.05) — en hardkodet
  1.02 ga et synlig krymp for alt annet enn lister. Kategorien sender fortsatt
  `rot = false` (ingen rotate/scale i drop-transformen), siden en transform der
  ville forstyrret utfoldings-høydeanimasjonen (`expandCategory`).
- **Auto-scrollen er oppfriskningsuavhengig** (`frameSteps`): fartene er px per
  60 Hz-frame, og hver frame skaleres med FAKTISK forløpt tid siden forrige
  RAF-kall (`dt / 16.67`). Uten dette scrollet en 120 Hz-skjerm dobbelt så fort
  som en 60 Hz-skjerm på samme fysiske tid. `dt` klemmes til 50 ms (3 frames) så
  en bakgrunnsfane/pause ikke gir et hopp, og resten som avrundingen spiser
  (`rest`, ±1 px) tas med til neste frame så en lav fart ikke forsvinner på
  120 Hz. Gjelder alle tre loopene: vindus-, mappe- og område-auto-scroll.
  Soner, retning, board-bunngrense og fortegnsklemmen er uendret.
- **Et drag som mister OBJEKTET SITT avbrytes** (`cancelActiveDrag` +
  `dragElDetached`): draget lever av `pointermove`/`pointerup` på window, og de
  lytterne overlever alt annet enn at selve noden forsvinner. Rives `drag.el` ut
  av DOM, kan draget aldri fullføres — objektet ville blitt hengende limt til
  pekeren med placeholder i DOM og auto-scroll i gang. `dragElDetached()` sjekkes
  derfor øverst i hver `on*Move` (rydd med én gang) og hver `on*Up`/
  `finishColumnDrop` (ikke commit et drop på en død node), og `cancelActiveDrag`
  kjører den nivå-riktige kanselleringsflyten (`on*Cancel` → rollback, ingen
  pos/lagring). Den er idempotent: hver `on*Cancel` returnerer straks når
  `drag.active` er false. `restoreDraggedToOrigin` setter en frakoblet node IKKE
  inn igjen — DOM-en har gått videre uten den, og en re-innsetting ville gitt et
  spøkelses-duplikat ved siden av de ferske nodene.
  **Ikke bruk hendelses-utløsere her.** `window.blur`/`visibilitychange` sier
  ingenting om gesten (fokus flytter seg av grunner som ikke rører pekeren — en
  innebygd iframe/verktøylinje, OS-nivå fokusbytte, nettleser-UI), og å avbryte
  på dem fikk lister/listepunkter/kategorier til å «glippe» rett etter løft — mens
  mappe-/område-rader, som dras i en modal over siden, ikke ble rammet.
  `lostpointercapture` duger heller ikke: den fyrer også når alt er i orden, og
  når noden faktisk rives ut, dispatches den på en node som ikke lenger er i
  dokumentet — så den når uansett ikke en lytter på `document`.
- **Ekstern window-scroll reposisjonerer ALLE dokument-koordinat-drag**
  (`onDragScroll`, registrert i `beginDragCommon`): kort, listepunkt OG kategori
  ligger i dokument-koordinater, så scroller siden uten at vi gjorde det
  (momentum, kollaps-klemme, tastatur), må det løftede objektet flyttes for å bli
  liggende under pekeren. Før gjaldt dette kun lister. Lytteren REAGERER bare —
  den scroller aldri selv — og gjør ingen plasseringsevaluering (pekeren har ikke
  flyttet seg; auto-scroll-loopen gjør den jobben én gang per frame når det er VI
  som scroller).
- **Draging startes ulikt på touch og mus** (`attachHoldDrag` — nå kun for
  listepunkter og kategorier; lister, områder, mapper og mappekategorier
  aktiveres av dnd-kits `PointerSensor` med de samme tallene). Dra-håndtakene er
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
    `HOLD_MOVE_MOUSE` (5 px) med knappen nede (klassisk desktop-drag). En mus har
    ikke fingerens naturlige vandring, så terskelen kan være lavere enn touch sin
    uten at et vanlig klikk blir et drag. På desktop er det ingen konflikt mellom
    scroll og drag, så et hold trengs ikke. Et rent klikk (ingen bevegelse) forblir
    et klikk.
  - Avstanden måles **euklidsk** fra nedtrykkspunktet (kvadrert, ingen rot), så en
    diagonal bevegelse teller like mye som en akse-parallell — før måtte terskelen
    passeres på én enkelt akse.
  - **Draget starter i AKTUELL pekerposisjon**, ikke i `pointerdown`-punktet: siste
    koordinater oppdateres mens aktiveringen er armert (`cx`/`cy`) og brukes i det
    syntetiske start-eventet. Grepet (`grabX`/`grabY`) måles dermed mot der
    pekeren faktisk er, og objektet rykker ikke tilbake til nedtrykkspunktet ved
    første bevegelse — det gjaldt både musas terskelbevegelse og fingerens drift
    under holdet.
  - **Forutsetningene sjekkes på nytt akkurat når draget skal starte**: `canDrag()`
    (låst/`done`), `dragEl.isConnected` (en synk-rebuild kan ha byttet ut
    noden), `drag.active` (et annet drag rakk å starte) og at pekeren fortsatt er
    primær. En `pointerdown` med `isPrimary === false` (sekundær multitouch-peker)
    ignoreres helt.

  Soner/unntak: hvert objekt har nå NØYAKTIG én knapp til høyre
  (`.obj-menu-btn`, se `docs/menus.md`), så unntaket er det samme overalt —
  **område/liste** = hele korthodet (`.card-head`) unntatt menyknappen (klikk
  ellers på headeren kollapser/utvider, se under); **mappe/listepunkt** = hele
  `.item` unntatt avmerkingsboks + menyknapp; **kategori/mappekategori** = hele
  overskriftslinjen (`.cat-head`) unntatt menyknappen. **Cursor:** dra-sonene for
  listepunkt/kategori får `cursor: grab` (åpen hånd — «klikk-og-hold/dra drar»),
  mens område/mappe/liste har `cursor: pointer` (pekende hånd — der er klikk den
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
  `dragEl` ikke lenger er `isConnected`. `canDrag` gater på frossen/capability/`done`
  — og på FORELDERENS myndighet der plasseringen tilhører den: et listekort krever
  i tillegg `canAddList(activeGroupObj())` (rekkefølgen blant søskenlistene er
  mappens struktur, akkurat som mapperadene krever `reorderInParent` på
  området). Uten det kunne en liste med lås-unntak i en låst mappe dras rundt
  mens serveren forkastet hver posisjons-skriving.
  Under et pågående drag blokkeres native scroll av en ikke-passiv `touchmove`-
  lytter (`preventTouchScroll`, av/på i `beginDragCommon`/`finishDrag`). Mens
  holdet registreres (KUN touch/pen, der holdet tar tid) får `dragEl` et lite
  «press» (`.drag-hold`, scale) — hoppes over ved `prefers-reduced-motion` og på
  mus (draget starter der umiddelbart på bevegelse). `pointercapture` brukes så
  draging ikke mister eventer. Placeholder lever kun under draging; `finishDrag()`
  har sikkerhetsnett.
- **Søppelkassen er et drop-mål mens draget varer.** Idet et drag starter,
  vises kassen for nivået fram (`armDragTrash`), den markeres når man sikter på
  den, og et slipp i den SLETTER objektet i stedet for å flytte det: draget
  rulles tilbake som et avbrutt drag først, så ingen ny `pos` skrives. Sjekken
  ligger først i `onCardMove`/`onItemMove` og i de tilsvarende `*Up`-funksjonene,
  altså FØR plassering og før 📁-breadcrumben — sikter man på kassen, er det
  slettingen som gjelder. Kategorier har ingen kasse (de løses opp fra menyen).
  Autoritativt: `docs/trash.md` («Slett ved å dra objektet i kassen»).
- **Lister kollapser mens en liste dras** (`boardCollapseCardsForDrag`/
  `restoreCardsAfterDrag`): idet et liste-drag starter, kollapses BÅDE den dratte
  lista og alle de andre til bare korthodet (som kategorienes kollaps under drag)
  → board-et blir kompakt og dra-avstanden kort. MOMENTANT, ingen animasjon (samme
  som rullgardinen, se `collapseCardBody`/`expandCardBody` i `docs/design-system.md`
  — en kollaps-animasjon gjorde systemet tregere uten å tilføre klarhet).
  `card.collapsed` røres IKKE under draget; ved slipp gjenopprettes hver liste til sin
  lagrede lukketilstand — robust mot en samtidig synk-rebuild, som uansett bygger
  kortene fra `card.collapsed`. Kollapsen skjer i `beforedragstart`, den eneste
  kroken før dnd-kit måler det løftede kortet.
  - **Board-vakten gjelder ALLE liste-drag** (`boardCollapseCardsForDrag`/
    `boardReleaseBoard`), på mus som på finger og i én kolonne som i flere. Den gjør
    to jobber på én gang:
    1. **Kortet skal bli liggende under fingeren.** dnd-kit maler det løftede kortet
       fra der elementet FAKTISK LÅ da det ble målt — ikke fra grepet, slik den gamle
       motoren gjorde. Kollapsen flytter kortet man nettopp tok tak i (hver åpen liste
       over det i kortets egen kolonne krymper), og uten kompensasjon løsner kortet fra
       fingeren med akkurat den avstanden. `padding-top` på board-et legger den tilbake:
       kortets topp måles FØR kollapsen og skiftet ETTER, så regnestykket gjelder uansett
       kolonne og kolonneantall. Board-et er `box-sizing: border-box`, så padding-en
       spiser av innholdet og totalhøyden står stille.
    2. **Board-bunnen skal ikke synke** (`min-height` = board-høyden før kollaps).
       Krymper board-INNHOLDET mens fingeren er nede, faller sidens maks-scroll brått
       under gjeldende `scrollY`; Android Chrome klemmer da `scrollY` oppover, og en slik
       scroll-klemme avbryter touch-en (`pointercancel` → draget dør). Tidligere fikser
       (utsatt kollaps til > 2 px; deretter en `<html>`-`min-height`-lås) hjalp bare
       delvis: den utsatte kollapsen skjedde fortsatt straks etter løftet, og
       `<html>`-låsen holdt dokumentet høyt mens BOARD-et krympet — det ga en NY feil der
       auto-scrollens `maxScroll` (målt fra board-bunnen) kunne havne UNDER `scrollY`.

    Før dnd-kit var punkt 1 ikke et problem (den gamle motoren malte fra grepet), og
    vakten fantes derfor KUN for punkt 2 — altså kun på touch/pen i énkolonne-layout
    (`boardUsesSingleColumnLayout`, `--mobile-dnd-flow-guard`). Punkt 1 gjelder alle
    inputtyper og alle layouter, så skillet er borte. `padding-top` er dessuten ikke
    lenger summen av alle body-høydene over — den er det MÅLTE skiftet, som i
    flerkolonne-layout er langt mindre (kun listene i kortets egen kolonne teller).
    `boardReleaseBoard` (kalt fra `onCommit`/`onZoneDrop`/`dragend` MOMENTANT rett etter
    `restoreCardsAfterDrag`, som utvider listene momentant) fjerner `min-height` +
    `padding-top` i samme oppgave → én reflow maler den ferdige, naturlige layouten uten
    et mellomsteg. `overflowAnchor='none'` på `<html>` under draget er beholdt.
  - **Scroll til den slupne lista — så lite påtrengende som mulig**
    (`scrollDroppedIntoView`, kalt fra `boardCommitCard`): det trygge området er mellom
    toppmenyen (+ board-gapet) og den BRUKBARE bunnen (viewportbunnen −
    `--safe-bottom` − gapet; gestelinjen dekker de nederste pikslene, og er 0 i
    en nettleser — `docs/design-system.md`). Ligger lista allerede
    HELT innenfor det, er funksjonen en **no-op** — en liste som var synlig hele
    tiden skal ikke rykke rundt bare fordi den ble omrokkert. Ellers scrolles den
    KORTEST MULIGE avstanden inn i området: ligger den (delvis) bak toppmenyen,
    legges toppen på `safeTop`; stikker den under den brukbare bunnen, scrolles det bare
    så langt at nedre kant kommer inn — men aldri så langt at toppen forsvinner bak
    toppmenyen (en liste høyere enn området prioriterer altså toppen).
    `behavior: 'smooth'`, `'auto'` ved `prefers-reduced-motion`. Kalles ETTER at
    layouten er satt (restore/release). Sloten måles på KLONEN — det løftede kortet
    ligger i top layer og har ingen plass i flyten å måle — og høyden er kortets egen,
    nå som det er foldet tilbake til lagret tilstand. Hoppes over når lista slippes på
    nav-knappen eller i kassen (begge er soner og går aldri gjennom `onCommit`).
    Gjelder både touch og mus. Kun i `boardScope` — nav-modalen har ingen
    window-scroll å justere.
  - **Auto-scroll kan aldri bytte fortegn** (`startAutoScroll`): den tillatte
    nedover-avstanden klemmes til `Math.min(delta, Math.max(0, maxScroll - scrollY))`.
    Ligger board-bunnen (den kompakte, kollapsede) OVER `scrollY` — slik den kunne med
    den gamle `<html>`-låsen — blir `maxScroll - scrollY` negativ; UTEN `Math.max(0, …)`
    ville en positiv nedover-`autoScrollSpeed` blitt til en stor NEGATIV `delta` og
    hoppet siden langt OPPOVER i én frame (og kunne utløst `pointercancel`). En positiv
    `autoScrollSpeed` reduserer nå aldri `scrollY`; nedover-scroll STOPPER i stedet for
    å snu. (Med board-vakten over holdes board-bunnen uansett stabil, men klemmen er et
    selvstendig sikkerhetsnett.)
- **`pointercancel` ruller tilbake, det er ikke et slipp** (`onCardCancel` m.fl.):
  en kansellert pekersekvens må ALDRI behandles som et vellykket drop. Tidligere delte
  `pointercancel` handler med `pointerup` (`onCardUp`), så et avbrudd fullførte og
  lagret droppet. Nå har hvert nivå en egen kanselleringsflyt (`onCardCancel`,
  `onItemCancel`, `onCategoryCancel`, `onGroup-/onUniverseCancel` via
  `cancelColumnDrop`) registrert på `pointercancel` (og gjenbrukt av
  `cancelActiveDrag`, se sikkerhetsnett-punktet over): den fjerner draglytterne, stopper
  auto-scroll, fører elementet tilbake til den opprinnelige DOM-sloten
  (`restoreDraggedToOrigin` — `drag.origParent`/`origNext` registreres i
  `beginDragCommon` FØR placeholderen settes inn), fjerner placeholderen, rydder
  dragstiler/global dragtilstand og gjenoppretter evt. desktop-kollaps
  (`restoreCardsAfterDrag`). Den beregner IKKE ny `pos`, kaller ikke `stampPos`/
  `cloudPersonalPos`/`reindex*Colors`/`save`, og åpner ikke mappe-flyttevelgeren.
  `pointerup` bruker fortsatt den vanlige drop-flyten.
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
- **Kategori-draging** (`startCategoryDrag`) reorderer en kategori på nivå 1 i
  sin egen liste, ELLER flytter den (med alle medlemmene) INN i en annen liste —
  se «Kategori → en annen liste» under. Den kan ikke nøstes i en annen kategori
  (slipp på en annen kategori = vanlig bytte-plass på nivå 1). Idet draget starter
  **kollapser**
  kategorien (`CAT_COLLAPSE_MS` = 300 ms) til bare overskriften — `.cat-items`
  animeres til høyde/opacity 0 og placeholderen krymper til header-høyden; ved
  slipp folder den seg ut igjen (`expandCategory`, reversert animasjon).
  `liftCategory` setter ingen fast høyde (så det løftede elementet følger den
  kollapsende høyden). Innsetting er senterbasert (`placeRowPlaceholder`) blant
  nivå-1-radene. `prefers-reduced-motion` hopper over kollaps/utvidelse. Ved slipp/
  kansellering folder `settleCategoryAfterDrag` ut igjen — MED MINDRE kategorien er
  klikk-kollapset (rullgardin, `item.collapsed`), da beholdes den kollapset. NB:
  dette (drag-kollapsen) er en EGEN, animert mekanikk fra rullgardin-kollapsen
  (`collapseCatBody`/`expandCatBody`, momentan — se `docs/design-system.md`).
  - **Utseende under draging** (`.category.dragging`): det løftede kortet skal lese
    som en kompakt rad, ikke et stort felt. Kategori-ikonet (`.cat-drag-icon`,
    `ICONS.category`, skjult i hvile) vises til venstre for tittelen; tittelen blir
    SVART uten skygge (hvit-på-hvit var uleselig mot den hvite dra-flaten);
    menyknappen skjules `display:none` (ikke bare opacity) så headeren får element-høyde;
    `::before`/`::after`-skillelinjene skjules (`content:none`) så de ikke males på
    kortet; polstring/radius = et listepunkt (6px / 10px) + `gap:0`. `collapseCategory`
    måler header-høyden med `offsetHeight` (IKKE `getBoundingClientRect`, som ville
    inkludert dra-rotasjonen og blåst opp en bred, lav header) → `collapsedH = headH
    + 12` gir riktig placeholder-/treff-høyde.
- **Skillelinjene forhåndsvises under draget** (`applyDragSeparators`). I hvile
  males linjene rundt en kategoris hylle av pseudo-elementer på selve kategorien
  (`.category::before/::after`, se `docs/design-system.md`): en linje mellom to
  nabo-rader på nivå 1 når minst én av dem er en kategori. De reglene holder ikke
  under et drag — de kjenner ikke **placeholderen** (den kommende plassen), og de
  teller det **løftede** objektet som nabo selv om det er `position:absolute` og
  ute av flyten (som ga fantom-linjer). Under listepunkt- og kategori-draging tar
  JS derfor over linjene i de nivå-1-containerne draget berører (kildens
  `.items-container` + placeholderens): containeren får `.seps-managed` (slår av
  pseudo-reglene) og hver rad som skal ha en linje OVER seg får `.sep-above`.
  Placeholderen teller som den raden den representerer — kategori-placeholderen
  (`.cat-placeholder`) som en kategori — så en dratt kategori får linjer rundt
  placeholderen sin, og et dratt listepunkt får en linje der placeholderen er
  nærmeste nabo til en kategori over og/eller under.
  - Linjene uttrykkes som **klasser på radene**, ikke innsatte linje-elementer:
    radenes DOM-naboskap brukes av plasserings- og pos-logikken (`wouldMove`,
    `rowPos`), og et element mellom radene ville forstyrret den.
  - **En rad som er FORFAR til det løftede objektet får aldri `.sep-above`** —
    linja males i stedet speilvendt fra raden OVER (`.sep-below`, `margin-bottom:
    25px` + linja 16px under raden; identisk geometri). Grunnen er den samme som
    for `flipFrom`: `.sep-above` setter `position: relative`, og en posisjonert
    forfar blir containing block for det absolutt posisjonerte dra-elementet →
    dokument-koordinatene tolkes plutselig relativt til raden, og kortets
    `overflow: hidden` klipper objektet bort. Symptomet var at et listepunkt dratt
    UT av en kategori til nivå 1 i SAMME liste **forsvant** (kategorien er da
    forfar OG en nivå-1-rad som skal ha linje); dro man videre til en annen
    kategori eller en annen liste dukket det opp igjen, fordi kilde-kategorien da
    ikke lenger var en rad JS styrte linjer for. Raden over er aldri en forfar
    (det løftede objektet hører til nøyaktig én nivå-1-rad), så byttet er trygt.
  - Kalles ved dragstart (ETTER `liftElement`/`liftCategory`, så det dratte alt er
    ute av flyten), ved modusbytte (`setExtractMode`/`setReorderMode`) og etter hver
    placeholder-flytting — alltid FØR `flipFrom`, så FLIP-en måler den nye layouten
    og linjene glir på plass sammen med radene.
  - Ryddes (`clearAllDragSeparators`) i `finishDrag`, og i `onItemUp`/`onCategoryUp`
    rett etter at objektet har erstattet placeholderen — FØR `dropIntoPlaceholder`
    måler hvileposisjonen. Geometrien er identisk i hvile og forhåndsvisning (33px
    total luft, linja midt i), så byttet er usynlig.
- **Oppløs kategori** (`dissolveCategory`, boble-sprekk-knappen): listepunktene blir
  ukategoriserte og «arver» kategoriens plass i nivå-1-lista (fordeles jevnt i
  pos-gapet mellom kategorien og neste nivå-1-rad, rekkefølge bevart), og selve
  kategori-raden tombstones + fjernes.

## Ekstrahering til ny liste (kategori/listepunkt → nytt kort)

Drar man en **kategori** eller et **listepunkt** UT av listene og holder det over,
under eller mellom dem (dvs. i board-luften, ikke over noe kort), dukker en KORT-
formet placeholder med et **＋-ikon** i midten opp (`.new-list-placeholder`) —
slipp der oppretter en NY liste. `drag.phMode` (`'reorder'` | `'extract'`) styrer
hvilken placeholder som er aktiv; `setExtractMode`/`setReorderMode` bytter den ut
(fjerner den gamle, lager riktig type i riktig container). `dragOverCard()` avgjør
modus hver frame: er objektet «i» en liste → reorder (kategori: nivå-1-reorder når
lista er kilde-lista, ellers inn i den andre lista; listepunkt: container-logikken
under), ingen liste → extract. `extractionPos` gir den nye lista en `pos` mellom
placeholderens naboer i leserekkefølge.

`placeNewListPlaceholder` plasserer kort-placeholderen:

- **KOLONNEN** etter pekerens x (±8 px slingring). Ingen kolonnetreff (pekeren i et
  kolonnegap) → behold kolonnen placeholderen alt står i. Klemmes til siste kolonne
  som har kort: en tom kolonne lenger til høyre finnes bare fordi vinduet er bredt,
  og en ny liste havner aldri der før kolonnene til venstre er fulle
  (`docs/board-layout.md`).
- **PLASSEN i kolonnen** etter det LØFTEDE OBJEKTETS y-senter — ikke pekerens:
  ut-terskelen (1/3, se under) slår inn mens pekeren fortsatt kan være inne i lista
  man forlot, og et pekerbasert y-valg la da placeholderen på feil side av den.
  Målt mot den layouten man SER; den er selvstabiliserende, siden et kort
  placeholderen passerer samtidig glir en placeholderhøyde bort i samme retning.

**To veier til samme plass:** bunnen av kolonne k og toppen av kolonne k+1 er samme
plass i rekkefølgen, men to ulike containere. Sikter man under siste liste i
kolonne k, havner placeholderen der; sikter man over første liste i kolonne k+1,
havner den der. Sluttresultatet er identisk — brukeren kan ikke overstyre hvordan
listene organiseres, det finnes bare to steder å sikte. Dekket av punkt 4 i
`tests/board-columns.test.js`.

Tidligere ble placeholderen lagt med `appendChild` på et flatt board når objektet
lå under alle kortene i pekerens kolonne. Siste plass i DOM er bunnen av SISTE
kolonne, så «under liste 1 i kolonne 1» ga en placeholder under liste 3 i kolonne 3.

### «Hvilken liste er objektet i?» — 1/3-terskler (`dragOverCard`)

Grensen mellom lister avgjøres av det LØFTEDE OBJEKTETS boks (`draggedRect()`,
uklemt), ikke av pekeren. Pekeren sitter der man tok tak, så et pekerbasert svar
gjorde ny-liste-placeholderen mye lettere å få frem oppover enn nedover (og
motsatt inn i den neste lista).

Referanselinjene er listas **innholdssone** — fra **midt i listetittelen**
(korthodet) til **midt i +-knapperaden** (`.add-item-row`) — de SAMME linjene inn
og ut. Kortets ytterkanter brukes ikke: tittelraden og knapperaden er rammen rundt
innholdet, og halve rammeraden regnes som lista (se slark-punktet under). «1/3 har
passert» = 1/3-linja ligger på andre siden av referanselinja:

| Bevegelse | Placeholderen skifter når … |
|---|---|
| INN, nedover | objektets **øvre 1/3** har passert **tittelradens midtlinje** |
| UT, oppover | objektets **øvre 1/3** har passert **tittelradens midtlinje** |
| INN, oppover | objektets **nedre 1/3** har passert **knapperadens midtlinje** |
| UT, nedover | objektets **nedre 1/3** har passert **knapperadens midtlinje** |

Det er altså én regel: **objektet er i lista når dets midtre 1/3 ligger innenfor
sonen** (`cardBand` + `inCard` i `dragOverCard`). Reglene er rent loddrette —
**flerkolonne** (desktop) håndteres av pekerens x, som før. Innenfor en liste er
det fortsatt PEKEREN som velger rad/kategori. Valget henger igjen i
`drag.overCard`; er flere kort aktuelle, vinner det man alt er i.

Ingen dødbånd mellom inn og ut — hysteresen kommer av LAYOUTEN: idet man går inn,
forsvinner ny-liste-placeholderen fra board-et og reorder-placeholderen legges inn
i lista (sonen vokser med en radhøyde), og motsatt når man går ut. Begge deler
flytter geometrien i «bli der du er»-retning, så en monoton bevegelse gir nøyaktig
`reorder(A)` → `extract` → `reorder(B)`.

**Unntaket: en KORT sone under placeholderen** (`noteOverShift`/`drag.overGrace`).
Selve modusbyttet rykker alt som lå under ny-liste-placeholderen i kolonnen
OPPOVER. Har lista en høy sone, betyr det bare at sonen kommer objektet i møte —
«bli der du er». Men en **kollapset** liste (hele det lille kortet er sonen), eller
en tom der `MIN_BAND_SLACK` gjør hele kortet til sone, er kortere enn hoppet: sonen
rekker forbi objektet, som faller ut igjen, som legger placeholderen tilbake, som
dytter lista ned igjen — én runde per piksel. Vi MÅLER derfor hvor langt lista
faktisk flyttet seg av byttet og lar stickiness-en i `dragOverCard` beholde den
gjennom akkurat det hoppet (`grace` legges bare på det kortet man ALLEREDE er i;
grensen for å gå INN er uendret, så 1/3-tersklene måles som før). Å forlate lista
krever da en tydelig bevegelse ut — ikke bare at gulvet flyttet seg under objektet.

Slarken **forbrukes** så snart objektet ligger inne i sonen på egen hånd
(`inCard(cur, 0)`): den er kompensasjon for ETT hopp, ikke en varig utvidelse av
lista. Blir den liggende, må man dra en placeholderhøyde EKSTRA for å komme ut igjen,
og et slipp rett under lista havner i den i stedet for i en ny liste (målt: 57 px
forbi terskelen, mot 0,5 px når den forbrukes). I det vanlige tilfellet — en fylt
liste med høy sone — er slarken borte allerede ved neste bevegelse.
Dekket av punkt 6 og 7 i `tests/board-columns.test.js`.

To spesialtilfeller i `cardBand`:
- **Kollapset eller peek-åpnet liste** → hele kortet er sonen. En kollapset liste
  har ingen innholdssone i det hele tatt, og en peek-åpnet liste ble åpnet nettopp
  fordi objektet siktet på den (over overskriften, det eneste som fantes) — den
  skal ikke miste objektet i det den folder seg ut.
- **For liten sone** (tom eller nesten tom liste) → hele kortet. Sonen måles da som
  om reorder-placeholderen ikke lå der; ellers ville samme liste hatt en romsligere
  sone UTE enn INNE, og objektet ville gått inn, falt ut igjen og flimret.
  `MIN_BAND_SLACK` (48 px) må dekke at lista rykker oppover mot objektet idet
  ny-liste-placeholderen (≥ 72 px) byttes mot en radhøyde inne i lista.

**Hvorfor linjene går MIDT i rammeradene og ikke langs innerkantene**: første og
siste plass i lista er de trangeste å treffe, og halve rammeraden er slarken som
gjør dem like lette som plassene mellom radene.
- **Nederst**: for å havne sist må objektets senter forbi siste rads senter, og da
  stikker nedre 1/3 nesten ned i knapperaden. Slippes en KATEGORI sist i en liste
  med kategorier, krymper lista i tillegg ~25 px i samme øyeblikk (skillelinja
  under placeholderen forsvinner når den blir siste rad), så linja kommer opp mot
  objektet mens man sikter — uten slarken var vinduet ~2 px. Dekket av `F1`/`F2` i
  `tests/dnd-extract-thresholds.test.js` og «dratt nederst» i
  `tests/dnd-separators-preview.test.js`.
- **Øverst**: ligger en KATEGORI først i lista, er det bare ~10 px mellom
  tittelraden og kategorien — og pekeren må være nettopp DER for å treffe nivå 1 i
  stedet for inne i kategorien (`updateItemPlacement` steg 1 ruter pekeren inn i
  kategorien den er over). Uten slarken var «over en kategori øverst» umulig: målt
  0 px vindu, mot 63 px over et vanlig listepunkt øverst; med slarken 30 px (og
  93 px over et listepunkt). Dekket av `G1`/`G2` i
  `tests/dnd-extract-thresholds.test.js`.

Ut-tersklene ligger fortsatt ~20-30 px innenfor kortets ytterkanter, så
ny-liste-placeholderen dukker opp tidligere enn med kortkantene som grense.

Peek-åpning av kollapsede mål (under) bruker samme `dragOverCard`, ellers kunne
placeholderen stå og vente på en peek som aldri startet fordi pekeren ennå ikke var
inne i kortet.

- **Kategori → liste** (`extractCategoryToNewList`, `onCategoryUp` når `phMode` er
  `extract`): ny liste med samme tittel; medlemmene flyttes inn ukategorisert
  (`cat = null`, `home` = ny liste), aktive får `pos` 0..n i bevart rekkefølge,
  avkryssede/slettede løsnes bare fra kategorien. Kategori-raden tombstones +
  fjernes fra kilde-lista. `render()` rebygger board-et rent.
- **Listepunkt → liste** (`extractItemToNewList`, `onItemUp` når `phMode` er
  `extract`): ny liste med BARE dette listepunktet (`cat = null`), tittelen **blank
  og straks fokusert** (`.card-title`.click()) så den kan navngis med en gang.
- **Oppretter = den som ekstraherer**: den nye lista lages lokalt med ny id og
  pushes som en ny rad eid av gjeldende bruker (`insertPayload` → `owner_id` = meg),
  uansett hvem som eide kilde-lista.
- **Låst kilde-liste**: umulig — selve draget er avskrudd (`attachHoldDrag` sin
  `canDrag = !frozen(cardData)` for både listepunkt og kategori), så ingen egen
  vakt trengs i drop-flyten.
- **Opprettelsesrett i mappen** (`S.canExtract(row)`, sjekket via
  `canExtractDragged()` i `updateItemPlacement`/`updateCategoryPlacement`):
  ekstrahering LAGER en liste, og den myndigheten ligger på MAPPEN, ikke på det
  løftede objektet. Board-scopet spør derfor `canAddList(activeGroupObj())`.
  Uten den dukker ny-liste-placeholderen aldri opp — `setReorderMode()` beholder
  reorder-placeholderen der den står, og et slipp i board-luften legger objektet
  tilbake der det kom fra. Det er ikke bare teoretisk: et **lås-unntak** på én
  liste i en låst mappe gjør nettopp at objektet kan dras (lista er redigerbar)
  uten at en ny søskenliste kan opprettes. Nav-scopet svarer `cap(row, 'move')` —
  det NYE området blir alltid mitt, men å ta mappen UT av det gamle er en
  flytting `move_group` krever destruktiv myndighet i kilden for.
- Under auto-scroll re-evalueres modus/plassering via `reapplyPlacement` →
  `updateCategoryPlacement`/`updateItemPlacement` (samme som peker-bevegelsen), så
  ekstrahering virker også når man drar mot vindus-kanten.
- **Modus re-evalueres ved `pointerup`** (`onItemUp(ev)`/`onCategoryUp(ev)`): siste
  `pointermove` kan være koalescert eller helt utelatt, så `drag.phMode` kan være
  foreldet — slippes objektet tilbake OVER et kort etter å ha vært i board-luften,
  ville et foreldet `extract` ellers laget en ny liste. Vi setter derfor
  `drag.lastX/Y` fra slipp-eventet og kjører placeringsfunksjonen på nytt med
  `commit = true` FØR vi velger extract vs. reorder — samme autoritative
  sluttplassering som alle de andre nivåene gjør (se «Sluttplasseringen er
  autoritativ» over). Retningen (`dy`) regnes FØR `drag.lastY` overskrives, men
  med `commit` er innsettingen uansett senterbasert: den retningsstyrte varianten
  gjorde tidligere INGENTING ved et slipp i en homogen liste (`dy` ble sendt inn
  som 0, og hverken oppover- eller nedover-grenen traff).
- **Avkryssing**: et avkrysset listepunkt (også i en kategori) flyttes til kortets
  felles «Utført»-seksjon; reaktivering ruter det tilbake INN i kategorien sin
  (om den finnes), ellers til nivå 1 (se `toggleItemDone`).

## Kategori → en annen liste (`moveCategoryToCard`)

En kategori kan dras INN i en annen eksisterende liste (ikke bare reorderes i sin
egen eller ekstraheres til en helt ny). `updateCategoryPlacement` er tre-veis (mål-
lista fra `dragOverCard`, se 1/3-tersklene over): KILDE-lista → reorder på nivå 1;
en ANNEN liste → placeholder på nivå 1 der (kategorier nøstes aldri, så alltid `.items-container`,
ikke en `.cat-items`); board-luft → ekstraher til ny liste. Ved slipp i en annen
liste (`onCategoryUp`, mål-kort ≠ kilde-kort) flytter `moveCategoryToCard` kategorien
OG alle medlemmene (aktive + avkryssede + slettede) til mål-kortet: medlemmene beholder
`cat`-pekeren, både kategori og medlemmer får ny `home` (= mål-kortet) og stemples
(`home` rir på posisjonsregisteret), kategoriens `pos` settes mellom slipp-naboene.
Board-et rebygges rent med `render()` (ikke kirurgisk, som ekstraheringen), så
«Utført»-medlemmer i andre DOM-seksjoner følger korrekt med. Reorder INNEN kilde-lista
bruker fortsatt den kirurgiske drop-flyten (`dropIntoPlaceholder` + `settleCategoryAfterDrag`).

## Peek-åpning av kollapsede dra-mål (`updatePeek`, `PEEK_MS` = 200 ms)

Drar man et **listepunkt** over en KOLLAPSET liste eller kategori — eller en hel
**kategori** over en kollapset liste — og BLIR VÆRENDE der i `PEEK_MS`, åpnes målet
MIDLERTIDIG (peek) så man ser hvor objektet vil lande. Flytter man videre uten å
slippe, kollapses målet tilbake til sin opprinnelige lille tilstand. Peek er ren
forhåndsvisning: den rører IKKE `card.collapsed`/`item.collapsed` og lagrer ikke.

- **To lag samtidig** (`drag.peekCard` + `drag.peekCat`, kun kategori-laget for
  listepunkt-drag): «listen OG/ELLER kategorien» åpnes progressivt — først lista, så
  en kollapset kategori inne i den. Hvert lag har en 200 ms-timer (`setPeekLayer`); et
  allerede peek-åpnet mål (ikke lenger `.collapsed`) beholdes så lenge det er målet.
  Liste-laget bruker `dragOverCard()` (samme 1/3-terskler som plasseringen — ellers
  kunne placeholderen stå og vente på en peek som aldri startet); kategori-laget
  velges av pekeren, som all annen plassering innenfor en liste.
  `peekExpand`/`peekCollapse` bruker de momentane body-veksel-funksjonene
  (`expandCardBody`/`collapseCardBody`, `expandCatBody`/`collapseCatBody`) + skjuler/viser
  «(N)»-telleren (`peekChip`). `updatePeek` kalles fra `onItemMove`/`onCategoryMove`.
- **Stabilitets-vakt** (`commit`-parameteren i `updateItemPlacement`/`updateCategoryPlacement`):
  MENS et kollapset mål (ennå ikke peek-åpnet) hoveres, blir placeholderen der den er
  — flyttet vi den inn nå, ville kildekortet krympet og målet (særlig en liste UNDER
  kilden i énkolonne) stukket vekk under pekeren, så 200 ms-timeren aldri rakk å løpe
  ut. Ved selve slippet kaller `onItemUp`/`onCategoryUp` med `commit=true` så et rask
  slipp (før peek rakk) fortsatt lander i det kollapsede målet.
- **Ved slipp** (`resolvePeekOnDrop`): et peek-åpnet mål slippet LANDET i forblir åpent
  (persisteres `collapsed=false` + stemples), et peek-åpnet mål man IKKE landet i
  kollapses tilbake. Kategori-slipp INN i en annen liste rebygger med `render()` og
  setter mål-listas `collapsed=false` når den var peek-åpnet. `refreshAllCollapseCounts`
  oppdaterer «(N)» på lister/kategorier som fikk et rask slipp uten peek.
- **Opprydding**: `clearAllPeeks(recollapse)` river ned begge lag (kalt av `finishDrag`
  som sikkerhetsnett → kollapser tilbake ved avbrudd/`pointercancel`); `beginDragCommon`
  nullstiller `drag.peekCard`/`peekCat` per drag.

## Områder og mapper (nav-modalen)

Egen kode for disse to nivåene finnes ikke: områder dras som lister, mapper som
listepunkter, mappekategorier som kategorier — samme komponenter, samme
politikk, bare et annet state-tre (`navScope`, se toppen av dokumentet). Selve
gesten leveres av dnd-kit; se [neste kapittel](#nav-scopet-kjører-på-dnd-kit-smett).

Det som er verdt å merke seg:

- **Alltid én kolonne**: `navScope.singleColumn` gjør at `relayoutBoard` lager
  nøyaktig én `.board-col` (samme kolonnemaskineri som hovedsiden, se
  `docs/board-layout.md`), så kort-draget aldri møter flerkolonne-logikken.
- **Auto-scroll ruller modalens `.menu-body`** — dnd-kits `AutoScroller` finner
  scroll-containeren selv (den er en forfar til det løftede objektet).
- **Kollaps-alle under draget** gjelder også her (områdekortene foldes til
  overskriften mens ett dras), men uten normal-flow-vakten — den finnes for
  window-scroll-klemmen på mobil, og modalen scroller i sin egen container.
- **En mappe som bytter område går gjennom `move_group`-RPC-en**
  (`commitGroupMove`) — databasen avviser en direkte skriving av
  `groups.universe_id`. Flyttingen vises optimistisk lokalt og holdes i
  `pendingGroupMoves` til RPC-en har landet (doc-et beholder den GAMLE
  plasseringen så lenge). Krysser flyttingen et **eierskapsdomene** (ulikt sett
  områdeeiere), vises en eksplisitt bekreftelse først, og serveren svarer med en
  id-mapping som `applyIdMapping` bruker til å bytte det lokale treet uten
  flimmer. Avbrutt bekreftelse ruller tilbake (`revertGroupMove`).
- **Fri mappe** («Mapper delt med meg») omrokkert i sin egen seksjon skriver kun
  PERSONLIG rekkefølge (`cloudPersonalPos` → `memberships.pos`) — det andre ser
  endres aldri. Det samme gjelder områdene på toppnivå. Se
  `docs/rettigheter-og-deling.md` del 11 og 12.
- **Seksjonsoverskriftene** i nav-modalen ligger i den samme `.board-col` som
  kortene, men `boardRows` filtrerer på `.card`/`.card-placeholder` (og hopper
  over dnd-kits klone), så de er aldri dra-mål.
- **Den aktive mappen følger med** når den bytter område (dratt dit, ekstrahert
  til et nytt, eller båret med av en mappekategori): `followActiveGroup()` kalles
  først i `renderBoard()` og flytter `state.activeUniverse` etter mappa.
  `activeGroupObj()` leter bare i det aktive området, så uten dette falt
  hovedsiden til «Ingen mapper ennå.» med mappa fortsatt i behold. Den bor i
  render-veien nettopp for å dekke ALLE veiene inn med ett sted.

### Slipp i en LÅST mål-container avvises med en gang

DB-vaktene (`*_before_update`) krever redigeringsrett på BÅDE gammel og ny
forelder. Uten en klient-sjekk ville et slipp inn i en frossen liste/et frossen
område sett ut til å lykkes og så blitt snappet tilbake ved neste synk. Både
`onItemUp` og `onCategoryUp` sjekker derfor mål-containeren FØR de rører state:
er den `frozen()`, kjøres `restoreDraggedToOrigin()` + `finishDrag()` (som et
avbrutt drag) og en toast sier fra — `S.lockedTargetMsg`, «Listen er låst – du
kan ikke flytte noe hit» på board-et og «Området er låst – du kan ikke flytte
noe hit» i nav-modalen.

I nav-scopet gjør `navCommitRow`/`navCommitCategory` den samme sjekken
(`navRejectTarget`) og **kaster** i stedet: Smett ruller da rekkefølgen tilbake
til der draget startet, og toasten sier det samme. Utfallet er identisk;
mekanikken er Smetts transaksjon i stedet for vår egen rollback.

## Nav-scopet kjører på dnd-kit (Smett)

Nav-modalen dras av [dnd-kit](https://github.com/clauderic/dnd-kit) gjennom
[Smett](https://github.com/peohol/smett), som ligger i repoet som en innsjekket,
låst kopi (`vendor/smett-0.1.0.js`, den globale `Smett` — se
[`sikkerhetsheadere.md`](sikkerhetsheadere.md)). Hovedsidens KORTNIVÅ kjører på
det samme (se [neste kapittel](#board-scopets-kortnivå-kjører-på-dnd-kit));
radnivået står fortsatt på motoren beskrevet over. Rekkefølgen for resten står i
[`dndkit-plan.md`](dndkit-plan.md). Koden ligger i seksjonen
«NAV-SCOPET PÅ dnd-kit» i `app.js`.

### To board, ett nivå hver, hver sin manager

| Board | Elementer | Containere | Dra-sone | Sone |
|---|---|---|---|---|
| `navCardBoard` | `.card` (områder) | `.board-col` | `.card-head` | `#uni-trash-btn` |
| `navRowBoard` | `.item`, `.category` (mapper, mappekategorier) | `.items-container`, `.cat-items` | `.cat-head`, `.item` | `.group-trash-btn` |

Smetts `extensions.md` sier «et board per hierarkinivå», og at hvert board da
bygger sin egen manager: dnd-kit stempler `pointerdown` med sensoren som tok
den, så det INNERSTE board-et vinner et delt trykk. Et trykk på en mapperad
løfter mappen, ikke området den ligger i. To managere gir dessuten hvert nivå
sine EGNE soner — område-kassen finnes ikke for et mappe-drag, og omvendt.

Identiteten leses fra DOM-en (`idAttribute: 'data-id'`, som vi allerede hadde).
Containerne har fått `data-dnd-container`: kolonnen `nav-col`, hvert områdes
`.items-container` områdets id, hver kategoris `.cat-items` kategoriens id.
Kassene har `data-dnd-zone`.

«Kan ikke dras» uttrykkes som `data-dnd-ignore` på selve dra-sonen: en låst
mappe på raden, en låst mappekategori på `.cat-head` (ikke på hele kategorien —
det ville tatt mappene inni med seg), fri-beholderen på korthodet. Objektmeny-
knappen og ＋-raden i en kategori har den også, så et trykk der aldri løfter noe.

### `drag` er fortsatt den ene posten om draget som pågår

Nav-motoren fyller `drag` fra dnd-kits `dragOperation` (`dndSyncIntent`), og da
virker alt som allerede leser den — `draggedRect`, `dragOverCard`/`cardBand`,
peek-lagene, skillelinjene, søppelkassen, `finishDrag` — uendret, på begge
motorer. Det er også det som holder `relayoutBoard` frosset og hindrer at et
board-drag starter oppå et nav-drag. `Smett.intentRectangle()` gir nøyaktig den
UKLEMTE boksen `draggedRect()` alltid har vært.

### Hva som er dnd-kits nå

Aktiveringen (trykk-og-hold 200 ms / musavstand 5 px — Smett har Huskis' egne
tall), plasseringspolitikken (Smetts hysterese-detektor med `SWAP_RATIO` 0.2,
`SWAP_REV_RATIO` 0.5, `SWAP_LOCK_MS` 300, kolonne-porten 0.5), den autoritative
sluttplasseringen ved `pointerup`, placeholderen (en KLONE av det løftede
objektet, ikke et tomt element vi lager selv), auto-scrollen av modalen,
drop-animasjonen og klemmen mot det brukbare feltet (`SafeViewport`, matet med
`safeInsets()`).

To Huskis-problemer forsvant med det:

- **`position: absolute` i dokument-koordinater.** dnd-kit løfter objektet inn i
  **top layer** via `popover`. Det teller ikke i sidens scroll-område, og
  iOS-WebKit-defekten den gamle løsningen skrev seg bort fra finnes ikke lenger
  (verifisert på iOS 26.6).
- **`.dragging`-klassen.** Motoren merker i stedet `[data-dnd-dragging]` (det
  løftede objektet) og `[data-dnd-placeholder]` (klonen). CSS-en er speilet på de
  to i `styles.css`; skalaen ligger der, rotasjonen settes fra JS som EGEN
  `rotate`-egenskap — aldri via `transform`, som dnd-kit skriver selv med
  `!important`.

### Hva som fortsatt er Huskis' — og hvor det henger

| Mekanikk | Kroken |
|---|---|
| Ny `pos` mellom naboene, personlig rekkefølge, `move_group` | `onCommit` (`navCommitCard`/`navCommitRow`/`navCommitCategory`) |
| Søppelkassen som slippmål | `zoneSelector` + `onZoneDrop` — Smett ruller raden tilbake FØR handlingen, altså dagens semantikk |
| Peek-åpning av kollapsede mål | `dragmove` → `updatePeek` (uendret); `reapplyPeekPlacement` ber om en ny kollisjonsrunde i stedet for å regne om selv |
| Skillelinjene rundt kategorier | `dragover` → `applyDragSeparators` (uendret; `sepRows` hopper over `[data-dnd-dragging]`, og klonen ER «raden som kommer») |
| Kollaps-alle ved løft, kategoriens sammenfolding | `beforedragstart` — se under |
| Låst/virtuelt/uten opprettelsesrett mål | `navRejectTarget` i `onCommit`, som KASTER → Smett ruller tilbake |
| Ekstrahering til nytt område | `containerAccept` → tom liste + vår egen `.new-list-placeholder` |
| «Kategorier nøstes aldri» | `itemType` + `containerAccept` — avvises UNDER draget, ikke etter slippet |
| Opplesningene | `phrases`, bygget av `tr()` (`docs/sprak.md`) |

### `beforedragstart` er den eneste kroken før målingen

dnd-kit måler det løftede objektet ÉN gang (`shape.initial`, som Smetts
`intentRectangle` regner ut fra). Alt som endrer objektets størrelse ved løft må
derfor skje før den målingen, og `beforedragstart` er den eneste kroken som
kjører der: kollapsen av alle områdekort, og mappekategoriens sammenfolding til
bare overskriften. Kategorien folder seg derfor sammen MOMENTANT i nav-scopet,
ikke over 300 ms som på board-et — en boks som krymper etter målingen ville latt
treffdeteksjonen sikte med en kategori som ikke lenger er så høy som den ble
målt.

**Og board-høyden fryses mens et områdekort dras.** Den gamle motoren malte det
løftede objektet fra GREPET (`peker − grabY`), så det lå under fingeren uansett
hva kollapsen gjorde med layouten. dnd-kit maler fra der elementet FAKTISK LÅ da
det ble målt. Kollapsen flytter kortet man nettopp tok tak i — både fordi
kortene over krymper, og fordi nav-modalen er loddrett sentrert og re-sentrerer
når innholdet blir kortere — og uten mottiltak løsner kortet fra fingeren med
akkurat den avstanden (målt til ~100 px i en vanlig modal). `navCollapseCardsForDrag`
fryser derfor `#nav-board`s høyde (modalen re-sentrerer da ikke) og kompenserer
med `padding-top` for kortene over. Board-et er `box-sizing: border-box`, så
padding-en spiser av innholdet og totalhøyden står stille. Samme regnestykke som
`freezeBoardForDrag` gjør for hovedsidens board, av en annen grunn: der finnes
vakten for window-scroll-klemmen på mobil.

### Politikken som måtte uttrykkes som kollisjonsdetektorer

dnd-kits containere treffes normalt av `pointerIntersection` mot sin egen boks.
Huskis' regler er ikke boks-regler, så containerne i nav-scopet har egne
detektorer. To ting å vite om mekanikken: en `collisionPriority` på entiteten
OVERSTYRER prioriteten detektoren svarte, så en droppable som trenger to
prioriteter får `collisionPriority = null` og bestemmer selv; og radene inne i
en container er dnd-kits egne (Smetts hysterese-detektor, Normal prioritet), så
containeren er bare fallbacken under dem.

- **KORTET velger container, ikke pekeren** (`navPickContainer`,
  `navLevel1Collision`). Regelen er den samme som før: først «hvilket kort er
  objektet i?» — avgjort av objektets egen boks mot kortets innholdssone
  (1/3-tersklene), ikke av pekeren — og så, inne i det kortet, velger pekeren
  mellom nivå 1 og en mappekategoris hylle. Et sikte rett under siste mappe, på
  ＋-knapperaden, er innenfor kortet men utenfor `.items-container`; med ren
  boks-testing traff det ingenting, og mappen ble liggende igjen.
  Svaret regnes ut ÉN gang per pekerbevegelse. Det er ikke en optimalisering:
  `dragOverCard` har hukommelse, og slarken `noteOverShift` gir gjennom ett
  layout-hopp blir forbrukt av det første kallet som finner objektet inne i
  sonen på egen hånd. Regnet detektorene det ut selv, ville bevegelsen og
  kollisjonen svart på hver sin layout og skiftet på å ha rett én gang per
  frame.
- **Kategoriens OVERSKRIFT er en vei INN i kategorien** (`navShelfCollision`).
  Pekeren inne i en mappekategori — overskriften like mye som hylla — betyr «legg
  raden i kategorien». For dnd-kit er overskriften en del av kategori-RADEN, så
  et sikte der ville lest som «bytt plass med kategorien». Hylla svarer derfor på
  overskriften også, med høy prioritet; står pekeren i selve hylla, svarer den
  med lav, slik at radene der bestemmer plassen. En KOLLAPSET kategori er
  unntatt — der er hylla uten høyde, og nivå 1 gjelder til peek har foldet den
  ut.
- **Kolonnen tar ALLTID imot et områdekort** (`navColumnCollision`). Nav-modalen
  har nøyaktig én kolonne, og et områdekort har ingen annen plass å falle ned i:
  slipp nedenfor kortene — eller utenfor modalen — betyr «sist», ikke
  «ingenting». Sluttplasseringen er punktbasert, så «over alle kortene» blir
  først og «under alle» blir sist, som den senterbaserte sluttplasseringen på
  board-et. Prioriteten er den lavest mulige, så kolonnen aldri vinner over et
  kort eller kassen.
- **Kortet legges tilbake BLANT kortene** (`navSettleCardInColumn`) — ikke en
  detektor, men den samme saken: sluttplasseringen legger kortet sist i
  containeren når slippet er nedenfor alle kort, og sist i kolonnen er etter
  seksjonsoverskriften for neste seksjon.

### Klikket etter draget

dnd-kit binder `preventDefault` på `click`, men ikke `stopPropagation` — og våre
egne klikk-lyttere (korthodet kollapser lista/området, mapperaden navigerer)
fyrer likevel. Den gamle motoren stoppet klikket på KILDENS sone, og det holdt
bare så lenge klikket kom tilbake dit: et ekte slipp over en ANNEN rad gir et
tiltrodd klikk på DEN raden. Vakten tar det derfor på dokumentet, i
capture-fasen, for det første klikket etter et drag (`dndInstallClickGuard`,
delt av begge dnd-kit-scopene).

### Klonen er ikke en nabo

dnd-kit holder plassen med en KLONE av det løftede objektet, og den ligger rett
etter det med de samme klassene. `previousElementSibling`/`nextElementSibling` —
som hele `pos`-regnestykket hviler på — leser den da som naboen, og svarer
«ingen nabo på den siden», altså «sist i lista», uansett hvor man faktisk slapp.
`boardRows`/`isBoardRow` og `navRowSibling` hopper derfor over
`[data-dnd-placeholder]`, og det samme gjør `sepRows` (skillelinjene) og
`restoreCardsAfterDrag`.

### En ombygging må meldes til dnd-kit

Et slipp rendrer nav-modalen på nytt, og da byttes hvert eneste kort og hver
eneste rad ut. dnd-kit har fortsatt de GAMLE elementene i registeret sitt, og
de finnes ikke i dokumentet lenger — da er det ingenting igjen å løfte.

Smett følger med på DOM-et selv, men bare mens ingen drar: endringene som skjer
mens en gest står på er dnd-kits egne, og den lar dem være i fred. Ombyggingen
etter et slipp faller nøyaktig mellom de to — den kommer mens dnd-kit ennå
avslutter draget (slippanimasjonen), og etterpå kommer det ingen ny endring å
reagere på. `renderNav` avslutter derfor med `navSyncBoards()`, som kaller
Smetts `sync()` («public for a render you know about») på begge board-ene. Mens
et nav-drag FAKTISK pågår gjør den ingenting — da er DOM-et dnd-kits.

`renderBoard` gjør det samme med `boardSyncCardBoard()`. Der er det slettingen
(«dra lista i kassen») som rendrer midt i avslutningen, og etterarbeidet
(`boardRelayoutAfterDrop`) synker derfor én gang til når klonen er borte — da er
DOM-et endelig, uansett hvem som rakk å rendre underveis.

Uten den virker det neste løftet først når noe annet tilfeldigvis rendrer på
nytt, som en synkrunde. På mus rakk det ofte akkurat; på touch gjorde det ikke
det, og et andre områdedrag var umulig. `dnd-nav-engine` sjekk 9 er vakten.

### Områdenes `pos` regnes ALLTID innenfor sin egen seksjon

Nav-modalen deler områdene i tre seksjoner, og `renderNav` sorterer på seksjon
FØR `pos`. En `pos` hentet over en seksjonsgrense flytter derfor ingenting dit
man ser — den importerer bare en fremmed verdi inn i seksjonen og stokker om på
resten av den. Det virtuelle «Mapper delt med meg»-kortet er dessuten aldri en
nabo: det har `pos: Infinity`, og `between(Infinity, null)` er `Infinity`, en
verdi som ikke overlever JSON. Slippet ville da lagret `pos: null` på
medlemskapsraden og slettet brukerens egen rekkefølge i stedet for å endre den.

`navCardNeighbour` er regelen ett sted: den går utover i leserekkefølge og
HOPPER OVER både det virtuelle kortet og kort i en annen seksjon — slipper man
nedenfor alt, er svaret «sist i min egen seksjon», ikke «ingen naboer». Både
slippet (`navCommitCard`) og ekstraheringen (`extractionPos` i nav-scopet)
bruker den, og tastaturet har alltid fulgt den samme regelen (`moveCtx`).

### Det som er annerledes enn før, og hvorfor

- **Kategorien folder seg sammen momentant** ved løft (se over).
- **Søppelkassens treffsone er knappen selv**, ikke knappen pluss 12 px slark:
  sonen er en droppable, og dnd-kit måler dens egen boks.
- **Ekstraheringsmodus fjerner ikke klonen** fra lista. Den gamle motoren tok
  reorder-placeholderen ut idet ny-liste-placeholderen kom; her blir klonen
  liggende. Layout-hoppet er dermed mindre, og `noteOverShift` gjør fortsatt
  resten.
- **Låst mål avvises ved slippet**, ikke under draget. Planen sier at dnd-kits
  `accept` skal ta det UNDER draget, og for «kategorier nøstes aldri» gjør den
  det. Resten avhenger av hvor raden kom FRA — en fri mappe kan omrokkeres i
  fri-seksjonen, men ingen mappe kan flyttes INN i den — og `containerAccept`
  kjenner bare containeren, ikke kilden. Utfallet er uendret (rullet tilbake +
  toast); mekanikken er Smetts transaksjon.
- **En kasse som ikke er DETTE dragets** tar ikke imot: kassen som gjelder er
  den i containeren raden kom fra, og bare når jeg har lov til å slette. Kassene
  er soner, så et slipp på en annen synlig kasse — et annet områdes, eller
  mappe-kassen under et kategori-drag — ruller raden tilbake i stedet for å
  omrokkere den. Den gamle motoren lot den falle gjennom til en vanlig
  omrokkering.

### Tastaturet er fortsatt Huskis' eget

Begge board-ene bygges med `keyboard: false`. dnd-kits `KeyboardSensor` ville
kjempet om Enter/Mellomrom, som på et korthode og en mapperad allerede betyr
«kollaps» og «naviger». WCAG-alternativet til draget er `attachKeyHandle` — F2,
Alt+piler og «Flytt til …» — se «Rekkefølge og flytting fra tastatur» i `app.js`
og [`tilgjengelighet.md`](tilgjengelighet.md).

## Board-scopets kortnivå kjører på dnd-kit

Listene på hovedsiden — kortene i kolonnene — dras av dnd-kit gjennom Smett, som
nav-modalen. RADNIVÅET (listepunkt og kategori) står fortsatt på motoren
beskrevet øverst. Koden ligger i seksjonen «BOARD-SCOPETS KORTNIVÅ PÅ dnd-kit»
i `app.js`, og alt som gjelder begge dnd-kit-scopene står i
[«Nav-scopet kjører på dnd-kit»](#nav-scopet-kjører-på-dnd-kit-smett) over —
`dndSyncIntent` (som fyller `drag`), `dndPaintRotation` og klikk-vakten
(`dndInstallClickGuard`) er delt.

| Board | Elementer | Containere | Dra-sone | Soner |
|---|---|---|---|---|
| `boardCardBoard` | `#board .card` | `#board .board-col` | `.card-head` | `#trash-btn`, `#nav-crumb` |

**Roten er dokumentet, ikke board-et.** Liste-søppelkassen og 📁-breadcrumben
ligger i toppmenyen, utenfor `#board`, og en sone må ligge under board-ets rot
for å bli registrert. Selektorene er derfor scopet til `#board` selv, så
nav-modalens kort og kolonne aldri havner i dette registeret — to board som
registrerer det samme elementet ville kjempet om det.

**Kolonnene er containerne**, og de har fått `data-dnd-container` etter INDEKS
(`stampBoardColumns`, kalt der kolonnene bygges). Fordelingen er frosset gjennom
draget, så id-ene kan ikke skifte under fingeren. Huskis-regelen «kolonne = kort
med ≥ 50 % horisontal overlapp» er Smetts `crossAxisRatio`: et kort i en annen
kolonne er ingen nabo før det løftede kortet faktisk overlapper sporet.

**«Kan ikke dras»** står på dra-sonen som `data-dnd-ignore`: korthodet i en liste
man ikke kan omrokkere (frossen, eller uten rett til å endre mappens innhold),
menyknappen, meta-chipene og det åpne navnefeltet (`editText`).

### Kolonnen som siste utvei

Et slipp NEDENFOR alt innhold i en kolonne betyr «sist i den kolonnen», ikke
«ingenting» — og `pointerIntersection` mot kolonnens egen boks sier «ingenting»
der, for kolonnen slutter der innholdet slutter. Nav-modalen har nøyaktig én
kolonne og kan svare ubetinget; hovedsidens board har flere, og bare ÉN av dem
kan være svaret, ellers ville alle meldt seg samtidig for et slipp i lufta under
board-et. Hvilken avgjøres av KORTETS EGEN BOKS (`boardPickColumn`, regnet ut én
gang per bevegelse), ikke av pekeren: det er den samme kolonneregelen som gjelder
ellers. Prioriteten er den lavest mulige, så kolonnen aldri vinner over et kort
eller en sone.

### Fordelingen ved slippet, og etterarbeidet når klonen er borte

Kolonnene er frosset gjennom draget, og et kort som bytter kolonne endrer som
regel den grådige pakkingen. **Fordelingen må derfor kjøres ved SLIPPET**, i
`boardCommitCard` (`relayoutBoardNow` — den samme fordelingen uten drag-vakten):
dnd-kit regner ut hvor det løftede kortet skal fly, og sikter på KLONENS boks.
Kjøres fordelingen først etterpå, flyr kortet til den frosne sloten og
teleporterer så til sin endelige plass — målt til ~1000 px.

Fordelingen må da regne med det løftede kortets **hvilehøyde**. dnd-kit pinner
den KOLLAPSEDE høyden på elementet gjennom hele animasjonen, så `offsetHeight`
svarer feil for nettopp den raden: pakkingen ville fordelt kolonnene på et kort
som «veier» et korthode, og kortet måtte flytte seg en gang til når klonen
forsvant. Hvilehøyden måles rett før kollapsen (`boardLiftedRow`/
`boardLiftedRowH`, lest av `boardRowHeight`) — den eneste gangen den er å se.
`board-columns` sjekk 9 følger selve flukten: den skal gå mot hvileplassen hele
veien, og ende der.

To ting må likevel vente til klonen faktisk er borte (`boardRelayoutAfterDrop`):

- **`scrollDroppedIntoView`.** Klonen holder plassen med den kollapsede boksen,
  så dokumentet er kortere enn det blir — og scrollen klemmes mot nettopp
  dokumenthøyden. Den kjøres derfor én frame etter at klonen er fjernet, og slår
  opp lista på ID: en synk-runde kan ha rendret board-et i mellomtiden, og en
  frakoblet node måler 0 (scrollen ville da sendt siden til toppen).
- **Bunn-luften og en siste synk.** `fixBoardBottomGap` måler kortenes bokser, og
  slettingen («dra lista i kassen») kan ha rendret board-et mens dnd-kit ennå
  avsluttet draget.

### Det som er annerledes enn før

- **Board-vakten gjelder alle liste-drag** — se kollaps-punktet øverst.
- **Søppelkassens treffsone er knappen selv**, ikke knappen pluss 12 px slark:
  sonen er en droppable, og dnd-kit måler dens egen boks. Samme endring som i
  nav-scopet.
- **Et slipp på 📁-breadcrumben ruller lista tilbake først** — se under.
- **Board-et fryses ikke lenger mens man sikter i toppmenyen.** Den gamle motoren
  hoppet over plasseringen der oppe. Begge målene i toppmenyen er soner nå, og
  Smett ruller lista tilbake dit den kom fra FØR handlingen, så rekkefølgen
  underveis har ingen virkning. En vakt for den ville dessuten ikke kunne
  observeres: veien opp til toppmenyen går tvers over kortene uansett, så lista
  har allerede byttet plass før pekeren kommer dit.

## Flytting av lister til en annen mappe (innen samme område)

Mappene ligger ikke på hovedsiden. Dra i stedet lista opp på
**nav-knappen** i toppmenyen: knappen er en SONE for kortdraget
(`data-dnd-zone="crumb"`), den markeres (`.drop-target`, kun når det finnes andre
mapper), og dra-kortet blir gjennomskinnelig (`.to-group`). Smett ruller lista
tilbake dit den kom fra FØR handlingen — som for søppelkassen — og så åpnes en
velger («Flytt … til:», i plasserings-modal-skallet via `openPicker`); valget gjør
en kirurgisk flytting (`moveCardToGroup`: `card.group` + `pos` bakerst, kun
posisjonsregisteret stemples) + toast. Avbrytes velgeren, er INGENTING endret —
heller ikke rekkefølgen på board-et, som draget kan ha rukket å endre på veien
opp. `moveCardToGroup` slår opp det LEVENDE kortet på id — en synk-rebuild kan ha
byttet ut objektet mens velgeren sto åpen.

Velgeren viser mappene i det AKTIVE området der man faktisk kan opprette
lister (`cap(g, 'createList')`; mappekategorier er overskrifter og listes ikke). Vil man flytte lista lenger — til en mappe i et annet område —
flytter man i stedet MAPPEN i nav-modalen. Se `docs/data-model.md`.
