# Søppelkasser (universer / grupper / lister / elementer)

Les denne når oppgaven berører sletting, gjenoppretting, eller tømming på et
hvilket som helst av de fire nivåene.

Fire nivåer, samme knapp (`.trashcan`: hvit beholder, søppelkasse-SVG + antall i
grå sirkel) og samme oppførsel; **alle vises kun når de har innhold** (`hidden`):

- **Universer**: i meny-modalen, ved siden av «＋ [univers-ikon]».
- **Grupper**: i gruppemenyens knapperad (per aktivt univers).
- **Lister**: i listemenyens knapperad (per aktiv gruppe).
- **Elementer**: midtstilt nederst i hvert listekort (`ICONS.trash`, samme
  SVG som de statiske knappene — aldri emoji).

## Slette-animasjonen («pakk sammen og fly i søpla»)

Når et objekt slettes (element/liste/gruppe/univers) kjøres `ghostFrom` +
`flyGhost` (app.js): en klone av DOM-elementet tas FØR re-render, deretter
oppdateres state og `render()`/`refreshCard()` kjøres — slik at søppelkasse-
knappen **finnes/er synlig FØR animasjonen starter** — og til slutt animeres
klonen (`FLY_MS` = 600 ms, WAAPI): innholdet fader ut (første ~30 %), boksen
krymper til en sirkel (bare de avrundede hjørnene igjen, ved halvveis) og
svever inn i tilhørende søppelkasse-knapp og fader rett før den er fremme.
Varigheten er bevisst romslig (600 ms) så den er godt synlig også for store
listekort. Poenget er å vise HVOR det slettede havnet (og at det kan
gjenopprettes derfra). Ingen bekreftelses-dialog — sletting er reversibel.
Hopper over ved `prefersReducedMotion()`.

## Delete-buffer (optimistisk sletting + angre)

Sletting skriver **ikke** til databasen med en gang. Objektet får et lokalt
`_pendingDelete`-flagg (`_`-prefiks → strippes av `stateReplacer`, ikke i synk-
doc'et) og en **angre-toast** («Slettet «X» — Angre», 5 s). Angrer man innen
vinduet (`undoDelete(id)`), fjernes flagget lokalt — **ingen databasetrafikk,
umiddelbart**. Ellers committes slettingen når timeren (`DELETE_BUFFER_MS`,
5 s) utløper — eller når fanen skjules (`visibilitychange`/`pagehide`) —:
`trashed = true` + stempling/mount-push (`commitDelete`).

Mens objektet er buffret:
- Det er **skjult** fra board/menyer (`activeCards`/`visibleGroups`/… ekskluderer
  `_pendingDelete`) men **vises i søppel-visningen** (`trashedCards`/… inkluderer
  det) — med en **spinner** i stedet for «Gjenopprett»-knappen (ikke gjenopprettbart
  ennå), og «Tøm permanent» er deaktivert for pending-rader.
- Etter commit byttes spinneren til den vanlige «Gjenopprett»-knappen.

ALT går via **id-oppslag** (`findAnyById`), aldri fangede objekt-referanser, så
det tåler at synken bygger state-treet på nytt underveis — `reapplyPendingDeletes()`
gjenpåfører flagget etter hver `applyDoc`/`applyMyDoc`. Dette løste også en bug
der «Angre»/«Gjenopprett» mutere en foreldet referanse (etter at synken hadde
bygget treet på nytt) og dermed ikke virket før noen sekunder hadde gått.

### Samle-toast (`pushDeleteToast`)

Én felles «Angre»-toast eier timeren for en gruppe slettinger (ikke per objekt):

- Slettes flere objekter av **samme** kategori mens toasten er åpen, **slås de
  sammen** (`deleteToast.ids`) og timeren startes på nytt — meldingen blir
  «Slettet N elementer/lister/grupper/universer», og én «Angre» angrer alle.
- Slettes et objekt av en **annen** kategori, antas den forrige toasten
  unødvendig: den forrige gruppen **committes straks**, og en fersk toast
  starter for den nye kategorien.
- Toasten er «sticky» (`showToast(..., { sticky: true })`) — den felles timeren
  (`armDeleteTimer`) styrer både commit og skjuling. `commitDeleteOne`/
  `undoDeleteOne` gjør én-objekt-jobben uten å tegne board-et på nytt (commit er
  visuelt en no-op siden objektet allerede var skjult); gruppe-angre tegner én
  gang til slutt.

«Angre» (og «Gjenopprett» for committede) bruker de delte
`restoreUniverse/Group/Card/Item`-hjelperne (samme kode begge steder).

Sveipefeltets tekst er «Tøm» + en pil som fyller resten av feltet (symmetrisk
padding, satt i JS).

## Interaksjon (`attachTrashHold`)

Kort trykk → felles modal (`showTrashModal`: gjenopprett enkeltvis / «Tøm
permanent» — **uten ekstra bekreftelse**, samme som sveipe-tømming; modalen
åpnes utsatt og ignorerer overlay-klikk de første ~450 ms).

Klikk-og-hold (> `HOLD_EXPAND_MS`) → **sveipefeltet**: feltet starter med
knappens EKSAKTE geometri (posisjon/størrelse/radius, og ikonet står nøyaktig
der knappens ikon står — samme visuelle størrelse) mens selve knappen skjules
(`visibility`), og vokser så i bredden mot høyre — det ser ut som knappen selv
utvider seg, ikke som en popover. Venstre kant og høyde ligger fast (ingen
vertikal asymmetri). Sveip helt til høyre roterer ikonet opp-ned og **tømmer**
(rist 500 ms, kollaps tilbake til knappebredden før knappen tar over igjen);
slipp før enden = avbryt + kollaps. Feltet er ETT delt element — eierskap og
kollaps-timer er delt (`swipeOwnerBtn`/`swipeCollapseTimer`) så en ventende
kollaps fra én knapp aldri skjuler feltet for en annen.

Søppelkasse-ikonet i sveipefeltet (`ICONS.trashSwipe`, se `icons.js`) har kun
**to bevegelige deler**: hele ikonet (kasse-kropp + ribbene, urørt — de er
alltid synlige og roterer bare med resten) og `.swipe-icon-lid` (topp-strek +
hank), som roteres separat rundt venstre hengsel. `setProgress(p)` i
`attachTrashHold` (app.js) styrer begge via inline `transform`, i takt med
selve kassens 0→180°-rotasjon: lokket svinger **stadig lenger opp gjennom
hele sveipet og går aldri tilbake til lukket** (lineær, `-95° · p`), slik at
det henger tydelig løst av når kassen er helt opp-ned (p=1) — ikke smekket
igjen på nytt. Scrubbart (ikke en løkke-animasjon).

**ViewBox-en er kvadratisk og senter-symmetrisk rundt kassens midtpunkt**
(`-9.5 -9.5 43 43`): halvbredden er ≥ største avstand fra midtpunktet til noen
del av tegningen i noen kombinasjon av rotasjon og lokk-sving — hele kassen og
hele lokket er derfor ALLTID synlige, ingenting klippes. Kassen tegner ~40 %
av boksen; `.swipe-icon`s font-size (34px) er skalert opp tilsvarende slik at
kassen visuelt matcher knappens ikon (19px), og `SWIPE_ICON_BOX` i app.js
holder posisjoneringen i takt. Endres viewBox-en: regn ut `.swipe-icon-lid`s
transform-origin (hengselet 4.5,7.5) og `SWIPE_ICON_BOX` på nytt. Ikke fjern
`.swipe-icon-lid`-klassen uten å oppdatere `setProgress`/`collapseField`
tilsvarende.

Tømming setter **gravsteiner** rekursivt (univers → grupper → lister →
elementer: `emptyUniversesTrash`/`emptyGroupsTrash`/`emptyCardsTrash`/
`emptyItemsTrash`). Destruktivt er alltid reversibelt frem til tømming
(gravstein først da) — se `docs/sync.md` for hvordan gravsteiner brukes i
fletting.

Alle tekster/titler sier «hold og sveip for å tømme» (ikke «hold i 3
sekunder»).

## Feltet henger igjen hvis knappen forsvinner midt i et sveip

Element-søppelknappen bygges på nytt hver gang kortet re-renders
(`buildCard`/`refreshCard`, f.eks. via en synk-oppdatering mens brukeren
holder inne). Da fjernes DEN GAMLE knapp-DOM-noden midt i gesten, og
pekerfangsten (`setPointerCapture`) frigis implisitt — men verken
`pointerup` eller `pointercancel` fyres på den frakoblede knappen i så fall,
kun `lostpointercapture`, og den leveres på `document` (ikke på selve
knappen). `attachTrashHold` lytter derfor på `document` i fangst-fasen,
filtrert på `pointerId`, koblet til/fra PER TRYKK (ikke i selve
`attachTrashHold`-oppsettet) — ellers ville hver kort-ombygging lagt igjen en
varig `document`-lytter (én per element-søppelknapp som noensinne bygges).

## Buffer-slettede objekter kan ikke tømmes ennå

`emptyXTrash()` hopper alltid over `_pendingDelete`-objekter (de er ikke
`trashed` i state ennå). Derfor er både sveipefeltet og «Tøm permanent»-
knappen i modalen sperret så lenge NOE i søppelen fortsatt er buffret:
`attachTrashHold`s `api.pending()` stopper `openField()` fra å starte, og
`renderTrashModalBody()` deaktiverer `trashEmptyBtn` når
`rows.some(r => r.pending)`. Søppelkasse-knappens tall-badge
(`.trashcan-count`) viser en liten spinner (`.pending`-klassen, CSS `::after`)
i stedet for tallet mens dette gjelder — samme visuelle språk som spinneren
per rad i modalen. Fordi tallet i seg selv ikke endrer seg når en sletting
committes (objektet var allerede talt med som «i søppel»), måtte de tre
commit-stedene (`armDeleteTimer`, kategoribytte i `pushDeleteToast`,
`commitAllPending`) begynne å rydde badgen når timeren utløper — ellers ble
spinneren hengende til neste urelaterte re-render, selv etter at objektet
faktisk var klart til å tømmes.

Dette gjøres bevisst UTEN en full `render()`: siden `DELETE_BUFFER_MS`-
timeren kan utløpe mens brukeren har et annet, usagret inline-redigeringsfelt
åpent et sted i UI-et (`editText()` sitt `.edit-input`, som ikke er bundet
til state før blur/Enter), ville en full board-rebuild slettet den uferdige
redigeringen under brukerens hender. `commitDeleteOne` returnerer nå hva slags
objekt som ble committet (`{ kind, obj, card? }`), og
`refreshTrashBadgesAfterCommit()` bruker det til å oppdatere KUN de relevante
badgene direkte (`updateTrashCount`/`updateGroupsTrash`/`updateUniversesTrash`
for gruppe/liste/univers-nivå, `updateItemsTrashBadge(cardData)` — som kun
rører `.trashcan-count`-spannet, ikke resten av kortet — for element-nivå).

`commitAllPending()` (kjøres ved `visibilitychange`/`pagehide`, altså når
fanen skjules mens noe er buffret) må også rydde modalen hvis den står åpen
(`if (!trashModal.hidden) renderTrashModalBody();`) — ellers ble den
stående med spinner-rader til brukeren lukket og åpnet den på nytt, selv
lenge etter at objektene faktisk var committet.

## Knappen svarer ikke på et lite bevegelig trykk mens noe er pending

`openField()`s `api.pending()`-sperre (over) gjør at et sveipeforsøk kan
avvises FØR `mode` rekker å bli `'swiping'`. Et ekte trykk har alltid litt
bevegelse (fingerskjelving/mus-jitter) — og `onUp` krevde tidligere BÅDE
`mode === 'pending'` OG at pekeren ikke hadde beveget seg (`!moved`) for å
tolke slippet som et kort trykk (åpne modalen). Når `openField()` ble avvist
midt i et forsøk med litt bevegelse, ble ingen av grenene i `onUp` truffet —
knappen gjorde ingenting ved slipp, uten noen synlig feilmelding. Siden
`mode` fortsatt er `'pending'` betyr nettopp at INGENTING visuelt åpnet seg
(hverken sveipefeltet eller noe annet), er det alltid trygt å tolke et slipp
i den tilstanden som et kort trykk — `moved`-sjekken er derfor fjernet fra
denne grenen; `onUp` åpner modalen uansett når `mode === 'pending'` ved
slipp.
