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
  det) — som en helt vanlig rad. **Ingenting i søppel-flyten venter på
  bufferet** (ingen spinnere/deaktiverte knapper):
  - «Gjenopprett» på en buffret rad = angre bufferet (`undoBufferedDelete`):
    flagget fjernes og raden pilles ut av samle-toasten (`pruneDeleteToast`,
    som oppdaterer antallet i toasten / rydder den når den blir tom) —
    umiddelbart, null databasetrafikk.
  - «Tøm permanent» / sveipe-tømming committer buffrede rader i sitt omfang
    FØRST (`commitBufferedFor`) og tømmer så — brukeren merker ingen forskjell
    på en buffret og en committet rad.

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
`restoreUniverse/Group/Card/Item`-hjelperne (samme kode begge steder). Også
disse slår opp objektet på nytt via `findAnyById(id)` FØR de muterer det —
aldri referansen som ble sendt inn (se «Foreldede referanser i modalen» under).

Sveipefeltets tekst er «Tøm» + en pil som fyller resten av feltet (symmetrisk
padding, satt i JS).

### Foreldede referanser i modalen (element-søppelkassen)

Søppel-modalen kan stå åpen mens synken bygger hele state-treet på nytt
(`applyDoc`/`applyMyDoc` gjør `state.universes = [...ferske objekter]` hver
sky-runde — poll hvert 5. sekund + realtime-ekko i kontomodus). Da blir enhver
fanget objekt-referanse fra da modalen ble åpnet, foreldreløs.

De tre andre søppelkassene (`openUniversesTrash`/`openGroupsTrash`/
`openCardsTrash`) leser allerede ferskt fra `state` i hver `rows()`-kall
(`trashedUniverses()`/`trashedGroups()`/`trashedCards()`). **Element-modalen
(`openItemsTrash`) gjorde det ikke** — den fanget `cardData` én gang og lot
`rows()` lese `trashedItemsOf(cardData)` fra den. Etter en tre-rebuild pekte
den på et foreldreløst kort, som ga to symptomer (kun elementer, ikke grupper/
universer):

1. **Spinner som aldri ga seg**: åpnet man modalen rett etter en element-
   sletting og en rebuild traff mens den sto åpen, ryddet commit `_pendingDelete`
   på det LEVENDE objektet, mens modalens foreldreløse kort beholdt flagget →
   spinner for alltid, «Tøm permanent» aldri aktiv.
2. **«Gjenopprett» som ikke festet seg**: klikket satte `trashed = false` på den
   foreldreløse kopien → modalen så tom ut, men det levende treet hadde elementet
   fortsatt slettet; ved neste åpning var det der igjen.

Fiks: `openItemsTrash` slår opp kortet på nytt via `findAnyById(cardId)` i hver
`rows()`/`empty()`-kall (som de andre gjør mot `state`), og `restore` går via
`restoreItem(it)` som re-slår opp elementet på id. Restore-hjelperne for alle
fire nivåene er samtidig gjort id-baserte, så samme klasse feil ikke kan ramme
gruppe-/univers-gjenoppretting hvis en rebuild treffer mellom render og klikk.

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

## Tømming venter aldri på bufferet

`emptyXTrash()` starter med `commitBufferedFor(ids)`: alle buffrede rader i
tømmingens omfang committes umiddelbart (uten å vente på angre-vinduet) og
pilles ut av samle-toasten, før selve tømmingen kjører over hele lista.
Sveipefeltet og «Tøm permanent» er derfor **aldri sperret**; badge-tellerne
viser bare antallet. (Tidligere var begge deaktivert med spinnere til bufferet
var committet — det er borte.)

Commit-stedene som treffes av timeren/kategoribyttet (`armDeleteTimer`,
`pushDeleteToast`, `commitAllPending`) rydder fortsatt badge-tellerne bevisst
UTEN en full `render()`: `DELETE_BUFFER_MS`-timeren kan utløpe mens brukeren
har et usagret inline-redigeringsfelt åpent (`editText()` sitt `.edit-input`),
og en full board-rebuild ville slettet den uferdige redigeringen. `commitDeleteOne`
returnerer hva slags objekt som ble committet (`{ kind, obj, card? }`), og
`refreshTrashBadgesAfterCommit()` oppdaterer kun de relevante badgene
(`updateTrashCount`/`updateGroupsTrash`/`updateUniversesTrash`/
`updateItemsTrashBadge`).

`commitAllPending()` (ved `visibilitychange`/`pagehide`) rydder også modalen
hvis den står åpen (`renderTrashModalBody()`), så radene alltid speiler
faktisk tilstand.

**Delte mounts i tømming**: for en mottaker er «tøm» på en montert share-rot =
forlat delingen. `emptyXTrash` splicer objektet lokalt og kaller `cloudLeave`,
som legger `leave_share` i bakgrunns-operasjonskøen og undertrykker raden fra
synk-pullene til den har landet (`suppressedRows`, se `docs/accounts.md`) — så
den verken gjenoppstår lokalt eller trigger delete-push mot eierens rader.
(Tidligere ble hele `cloudBase` nullstilt i stedet; det kunne kortvarig
gjenopplive andre, egne rader som ble tømt i samme runde.)

## Knappen svarer alltid på et lite bevegelig trykk

`openField()` kan avvise et sveipeforsøk FØR `mode` rekker å bli `'swiping'`
(tom kasse). Et ekte trykk har alltid litt bevegelse (fingerskjelving/
mus-jitter) — og `onUp` krevde tidligere BÅDE `mode === 'pending'` OG at
pekeren ikke hadde beveget seg (`!moved`) for å tolke slippet som et kort
trykk (åpne modalen). Da kunne et avvist forsøk med litt bevegelse ende med
at knappen ikke gjorde noenting ved slipp. Siden `mode` fortsatt `'pending'`
betyr at INGENTING visuelt åpnet seg, er det alltid trygt å tolke et slipp i
den tilstanden som et kort trykk — `onUp` åpner modalen uansett liten
bevegelse.
