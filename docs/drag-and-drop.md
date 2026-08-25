# Dra-og-slipp-logikk

Les denne når oppgaven berører reorder, overføring mellom lister/mapper/områder,
ekstrahering, peek eller søppelkassene som slippmål.

Dra-og-slipp er delt i to eierskap, og det skillet forklarer nesten alt i dette
dokumentet:

- **Gesten er dnd-kits.** Aktivering, løft, plassering underveis, auto-scroll,
  drop-animasjon og opprydding kommer fra
  [dnd-kit](https://github.com/clauderic/dnd-kit) gjennom
  [Smett](https://github.com/peohol/smett), som ligger i repoet som en
  innsjekket, låst kopi (`vendor/smett-0.1.0.js`, den globale `Smett` — se
  [`sikkerhetsheadere.md`](sikkerhetsheadere.md)).
- **Betydningen er Huskis'.** Hva et slipp GJØR — ny `pos`, hvilken container
  raden havner i, hvem som får lov, hva som slettes, hva som opprettes — ligger
  i `app.js`, i seksjonen «DELT DnD-POLITIKK». Den er DELT av alle fem nivåene:
  en endring der treffer både hovedsiden og nav-modalen.

Smett er ikke en motor, men et politikklag: hver regel Smett beholdt er en
Huskis-regel, og standardverdiene ER Huskis' egne tall (`swapRatio` 0.2,
`reverseRatio` 0.5, `reverseLockMs` 300, `mouseDistance` 5, `holdMs` 200,
`holdTolerance` 10). Huskis sender derfor ingen av dem inn — de står i Smett.

## De fire board-ene

Områder og mapper har ingen egen kode: et område ER et kort, en mappe ER en rad,
en mappekategori ER en kategori. Forskjellen er hvilket state-tre man slår opp i
(`boardScope` / `navScope`) og hvor draget foregår.

| Board | Elementer | Containere | Dra-sone | Soner |
|---|---|---|---|---|
| `navCardBoard` | `.card` (områder) | `.board-col` | `.card-head` | `#uni-trash-btn` |
| `navRowBoard` | `.item`, `.category` (mapper, mappekategorier) | `.items-container`, `.cat-items` | `.item`, `.cat-head` | `.group-trash-btn` |
| `boardCardBoard` | `#board .card` (lister) | `#board .board-col` | `.card-head` | `#trash-btn`, `#nav-crumb` |
| `boardRowBoard` | `.items-container > .item`, `.items-container > .category`, `.cat-items > .item` | `.items-container`, `.cat-items` | `.item`, `.cat-head` | `.item-trash-btn` |

**Ett board per hierarkinivå, hver med sin egen manager.** dnd-kit stempler
`pointerdown` med sensoren som tok den, så det INNERSTE board-et vinner et delt
trykk: et trykk på en mapperad løfter mappen, ikke området den ligger i. Egne
managere gir dessuten hvert nivå sine EGNE soner — område-kassen finnes ikke for
et mappe-drag, og omvendt.

**Roten følger sonene, ikke board-et.** `boardCardBoard` har `document.body` som
rot, fordi liste-søppelkassen og 📁-breadcrumben ligger i toppmenyen, utenfor
`#board`, og Smett registrerer bare soner under board-ets rot. Selektorene er da
scopet til `#board` selv, ellers ville nav-modalens kort havnet i det samme
registeret — to board som registrerer det samme elementet kjemper om det.
`boardRowBoard` har `board` som rot (element-kassene ligger inne i kortene), og
nav-board-ene har modal-KROPPEN (område-kassen ligger utenfor `#nav-board`).

**`.items-done` er ikke en container.** Selektorene er barn-selektorer, så
«Utført»-radene registreres aldri: de deltar ikke i rekkefølgen, og et trykk på
dem løfter ingenting.

Identiteten leses fra DOM-en (`idAttribute: 'data-id'`). Containerne bærer
`data-dnd-container`: nav-kolonnen `nav-col`, board-kolonnene sin INDEKS
(`stampBoardColumns`), hvert områdes/korts `.items-container` sin egen id, hver
kategoris `.cat-items` kategoriens id. Kassene og 📁-breadcrumben bærer
`data-dnd-zone`.

## `drag` — den ene posten om draget som pågår

`drag` fylles fra dnd-kits `dragOperation` (`dndSyncIntent`), og alt Huskis-eid
leser den: `draggedRect`, `dragOverCard`/`cardBand`, peek-lagene, skillelinjene,
søppelkassen, `finishDrag`. Det er også den som holder `relayoutBoard` frosset
gjennom draget og hindrer at et board-drag starter oppå et nav-drag.

`Smett.intentRectangle()` gir den UKLEMTE boksen. **Intensjonsboksen må være
LAYOUT-boksen**: `intentRectangle` er målt på elementet slik det MALES, og vi
skalerer det 1,02/1,03 mens det er løftet. To piksler der er forskjellen på å
være i lista og å falle ut av den — en peek rakk ikke å åpne fordi den nedre 1/3
lå 0,3 px for lavt. `dndSyncIntent` beholder derfor SENTERET (skalaen er
sentrert) og bytter størrelsen mot objektets egen `offsetWidth`/`offsetHeight`,
målt ved løft (`dndNoteLiftedBox`).

## Aktivering: trykk-og-hold på touch, avstand på mus

Dra-håndtakene finnes ikke; draging inviteres på objektets navn-/tittelsone
(`handleSelector`). To modi etter inn-enhet:

- **Touch/pen (mobil)**: trykk og HOLD (200 ms) løfter — nødvendig for å skille
  drag fra scroll på en berøringsskjerm. Beveger fingeren seg mer enn 10 px FØR
  holdet er ferdig, tolkes det som scroll/sveip og avbrytes.
- **Mus (desktop)**: INGEN delay — draget starter idet pekeren beveger seg forbi
  5 px med knappen nede. En mus har ikke fingerens naturlige vandring, så
  terskelen kan være lavere uten at et vanlig klikk blir et drag.

Et rent klikk (ingen bevegelse) gjør fortsatt det klikket pleide — omdøp, bytt,
kryss av, kollaps.

**Sonene og unntakene.** Hvert objekt har nøyaktig én knapp til høyre
(`.obj-menu-btn`, se [`menus.md`](menus.md)), så unntaket er det samme overalt:

| Nivå | Dra-sone |
|---|---|
| område / liste | hele korthodet (`.card-head`) |
| mappe / listepunkt | hele raden (`.item`) |
| kategori / mappekategori | hele overskriftslinjen (`.cat-head`) |

Kategorien drar bare på OVERSKRIFTEN, ikke på hylla under: der ligger medlemmene,
og et trykk der skal ikke løfte kategorien.

**«Skal ikke starte et drag» uttrykkes som `data-dnd-ignore`** på det som ikke
skal løfte noe: menyknappen, avmerkingsboksen, ＋-raden i en kategori,
meta-chipene (`fillMetaRow` — et tregt trykk skal ÅPNE dem), det åpne navnefeltet
(`editText` → `.edit-input`, der et hold ville blokkert caret-plassering og
markering), et avkrysset listepunkt (det ligger i «Utført» og deltar ikke i
rekkefølgen), og hele dra-sonen på et objekt man ikke har lov til å omrokkere:
en låst mappe på raden, en låst mappekategori på `.cat-head` (ikke på hele
kategorien — det ville tatt mappene inni med seg), fri-beholderen på korthodet,
korthodet i en frossen liste.

Gatingen er `canReorderObj`, og den feiler LUKKET: mangler capability, står
`data-dnd-ignore`. Den spør **FORELDEREN** der plasseringen tilhører den — et
listekort krever i tillegg `canAddList(activeGroupObj())`, siden rekkefølgen
blant søskenlistene er mappens struktur, akkurat som mapperadene krever
`reorderInParent` på området. Uten det kunne en liste med lås-unntak i en låst
mappe dras rundt mens serveren forkastet hver posisjons-skriving.

**Cursor:** dra-sonene for listepunkt/kategori får `cursor: grab` (åpen hånd —
«klikk-og-hold/dra drar»), mens område/mappe/liste har `cursor: pointer` (der er
klikk den primære handlingen: bytt/kollaps). Mens holdet registreres (KUN
touch/pen, der holdet tar tid) får objektet et lite «press» (`.drag-hold`, scale)
— hoppes over ved `prefers-reduced-motion`.

**Klikket etter draget.** dnd-kit binder `preventDefault` på `click`, men ikke
`stopPropagation` — og våre egne klikk-lyttere (korthodet kollapser
lista/området, mapperaden navigerer) fyrer likevel. Vakten tar klikket på
DOKUMENTET, i capture-fasen, for det første klikket etter et drag
(`dndInstallClickGuard`, delt av alle board-ene). En vakt på KILDENS sone holder
ikke: et ekte slipp over en ANNEN rad gir et tiltrodd klikk på DEN raden.

## Plassering underveis

Bytte utløses av **overlapp**, ikke av et punkt (Smetts hysterese-detektor). Den
måler hvor mye av NABOEN det løftede objektet dekker langs dra-aksen, og tar den
nærmeste naboen som slipper gjennom:

- **Fremover er ivrig**: ≥ **20 %** av naboen er nok.
- **Å angre siste bytte er det ikke.** Rett etter et bytte ligger geometrien ofte
  slik at det MOTSATTE byttet straks trigges igjen (naboen har nettopp relokert),
  og objektene hopper frem og tilbake. Reverseringen av forrige bytte — samme
  nabo, motsatt side — møter derfor to hindre; vanlige bytter er urørt:
  (a) **tidslås** — reverseringen avvises i 300 ms etter byttet; (b)
  **overlapp-hysterese** — etterpå krever den ≥ 50 % overlapp, ikke bare 20 %.
  Asymmetrien er poenget: én høy terskel ville kjøpt den samme stabiliteten ved å
  gjøre HVER omrokkering treg, mens dette bare krever noe av det tilfellet som
  vanligvis er en rykning. Det er dessuten bevisst mildere enn full
  senter-kryssing (som overskjøt inn i NESTE nabo), så en bevisst tilbakeføring
  er fortsatt lett.
- **Retningen er borte, og reverseringslåsen gjør jobben den gjorde.**
  Detektoren har ingen retningsinngang — den tar nærmeste godkjente nabo. Det er
  en bevisst forenkling i Smett, og den koster ikke noe her: låsen er nettopp det
  som hindret at man byttet tilbake med den man kom fra.
- **Kolonneporten**: en nabo må dele ≥ **50 %** på TVERS av dra-aksen (Smetts
  `crossAxisRatio`) for å telle i det hele tatt. Et kort i nabokolonnen ligger i
  samme loddrette bånd, og uten porten leser dets vertikale overlapp som et
  bytte.

**Board-ets kolonner er ekte containere** (`.board-col`, se
[`board-layout.md`](board-layout.md)), og fordelingen er FROSSET mens et drag
pågår. Det er en DnD-forutsetning, ikke bare layout: med CSS multi-column kunne
en plassholder i én kolonne dytte et kort over i en annen, og siden svaret på
«hvilken liste er objektet i?» leses av nettopp den layouten, vekslet
plasseringen frem og tilbake for hver piksel.

**Plasseringen mellom rader er overlapp-basert hele veien.** Et lavt listepunkt
rekker ikke 20 % av en høy kategori, og da flytter hullet seg ikke — men slippet
lander riktig, se neste avsnitt.

### Forhåndsvisningen når ikke alltid fram; slippet gjør det

dnd-kits optimistiske sortering flytter raden UNDERVEIS bare når den overlapper
en RAD. Er det ingen rad å overlappe — en tom liste, stripen over første rad,
stripen under siste, en kategori som er for høy til at et listepunkt dekker en
femtedel av den — er CONTAINEREN selv slippmålet, og plasseringen avgjøres først
ved SLIPPET (Smetts `AuthoritativeDrop` → `insertByPoint`, som er punktbasert).
Slippet lander riktig; det er bare hullet som ikke rekker å flytte seg først.

Det er derfor kollisjonsdetektorene under finnes: de gjør containeren til et
svar, slik at slippet har et mål å lande i. Å lukke forskjellen helt hører hjemme
i Smett — en `settle` også på `dragover`, ikke bare ved slippet.

**Sluttplasseringen er autoritativ.** Den løpende plasseringen er
overlapp-basert, og den SISTE bevegelsen før et slipp kan være koalescert bort
eller helt utelatt (rask gest, eller en peker som bare hoppet fra nedtrykk til
slipp) — hullet kunne da bli stående fra nest siste bevegelse. Ved slippet
kjøres derfor én siste plassering fra de FAKTISKE slipp-koordinatene, for alle
fem nivåene. Den er **ren punktbasert** (`insertByPoint`): hverken 20 %-terskelen
eller reverseringslåsen gjelder der — slipp-punktet ER brukerens tydelige
sluttintensjon, og et raskt slipp skal lande der, ikke ett hakk unna.

### Politikken regnes om på BÅDE `dragmove` og `dragover`

dnd-kit oppdaterer sin egen posisjon og kjører sin egen kollisjonsrunde uten
alltid å melde en `dragmove`: etter en peek-utvidelse er pekeren målt å flytte
seg 100–400 px, `dragOperation.position` følge med og `dragover` fyre — men ingen
`dragmove`. Da ville peek-laget og ekstraheringsmodusen blitt stående på forrige
posisjon. `dndRowPolicy` henger derfor på begge krokene.

Testene merker det samme fra utsiden, og sender hver bevegelse som TO punkter —
som `travel()` i `tests/dnd-gestures.js` gjør, av samme grunn.

**Står pekeren stille, står svaret stille.** Det er ikke en optimalisering, det
er hele stabiliteten: vår egen plassering flytter radene, og en ny runde på det
SAMME punktet leser den nye layouten som en ny intensjon (målt: en rad lagt inn
over en kategori dyttet kategorien ned under pekeren, og neste runde leste det
som «legg raden i kategorien i stedet»).

Endrer svaret på «hvilken container?» seg, ber vi om en NY kollisjonsrunde
(`dndSetRowTarget`): dnd-kits runde løper FØR våre lyttere, så runden som nettopp
gikk brukte det forrige svaret — og står pekeren stille etterpå, kommer det ingen
ny.

## `beforedragstart` er den eneste kroken før målingen

dnd-kit måler det løftede objektet ÉN gang (`shape.initial`, som
`intentRectangle` regner ut fra). Alt som endrer objektets størrelse ved løft må
derfor skje FØR den målingen, og `beforedragstart` er den eneste kroken som
kjører der: kollapsen av alle kort, og kategoriens sammenfolding.

**Lister og områdekort kollapser mens ett dras**
(`boardCollapseCardsForDrag` / `navCollapseCardsForDrag` →
`restoreCardsAfterDrag`): BÅDE det dratte kortet og alle de andre foldes til bare
korthodet → board-et blir kompakt og dra-avstanden kort. MOMENTANT, ingen
animasjon (samme som rullgardinen, se `collapseCardBody`/`expandCardBody` i
[`design-system.md`](design-system.md)). `card.collapsed` røres IKKE under draget;
ved slipp gjenopprettes hver liste til sin lagrede lukketilstand — robust mot en
samtidig synk-rebuild, som uansett bygger kortene fra `card.collapsed`.

**Kategorien folder sammen hylla si MOMENTANT** (`dndCollapseCategory`), av samme
grunn: en boks som krymper etter målingen ville latt treffdeteksjonen sikte med
en kategori som ikke lenger er så høy som den ble målt. Ved slipp folder
`dndSettleCategory` den ut igjen — MED MINDRE kategorien er klikk-kollapset
(rullgardin, `item.collapsed`), da beholdes den kollapset. Ekstraheringen bruker
den animerte `expandCategory` i stedet, siden den nye lista bygges opp rundt en
kategori som skal folde seg ut. Dette (drag-kollapsen) er en EGEN mekanikk fra
rullgardin-kollapsen (`collapseCatBody`/`expandCatBody`, se
[`design-system.md`](design-system.md)).

### Board-vakten: grepet holder, og bunnen synker ikke

dnd-kit maler det løftede objektet fra der elementet FAKTISK LÅ da det ble målt —
ikke fra grepet. Kollapsen flytter nettopp det kortet man tok tak i, så uten
kompensasjon løsner kortet fra fingeren med akkurat den avstanden. Vakten gjør
derfor to jobber på én gang, for ALLE inputtyper og ALLE layouter:

1. **Grepet holder.** `padding-top` på board-et legger tilbake nøyaktig det
   kortet flyttet seg: toppen måles FØR kollapsen og skiftet ETTER, så
   regnestykket gjelder uansett kolonne og kolonneantall. Board-et er
   `box-sizing: border-box`, så padding-en spiser av innholdet og totalhøyden står
   stille.
2. **Board-bunnen synker ikke** (`min-height` = board-høyden før kollaps).
   Krymper board-INNHOLDET mens fingeren er nede, faller sidens maks-scroll brått
   under gjeldende `scrollY`; Android Chrome klemmer da `scrollY` oppover, og en
   slik scroll-klemme avbryter touch-en (`pointercancel` → draget dør).

Punkt 2 gjelder RADNIVÅET også, av en annen grunn: en kategori folder sammen
hylla si ved løft, og en full hylle er lett hundrevis av piksler.
`boardFreezeForRowDrag` holder board-høyden på samme måte. Kategorien trenger
derimot ingen padding-kompensasjon — hylla ligger UNDER overskriften, så
kategoriens egen topp flytter seg ikke.

I nav-modalen (`navCollapseCardsForDrag`) er regnestykket det samme, men grunnen
en annen: modalen er loddrett sentrert og re-sentrerer når innholdet blir
kortere, så kortet ville løsnet fra fingeren med opptil ~100 px. Board-høyden
fryses (modalen re-sentrerer da ikke) og kompenseres med `padding-top`.

`boardReleaseBoard` / `navReleaseBoard` (kalt fra `onCommit`/`onZoneDrop`/
`dragend` MOMENTANT rett etter `restoreCardsAfterDrag`) fjerner `min-height` +
`padding-top` i samme oppgave → én reflow maler den ferdige layouten uten et
mellomsteg. `overflowAnchor: none` på `<html>` under draget hindrer at
nettleserens scroll-anchoring rykker siden når kortene kollapser; `finishDrag`
slipper den igjen.

## Politikken som måtte uttrykkes som kollisjonsdetektorer

dnd-kits containere treffes normalt av `pointerIntersection` mot sin egen boks.
Huskis' regler er ikke boks-regler, så containerne har egne detektorer. To ting
om mekanikken: en `collisionPriority` på ENTITETEN overstyrer prioriteten
detektoren svarte, så en droppable som trenger to prioriteter får
`collisionPriority = null` og bestemmer selv; og radene inne i en container er
dnd-kits egne (hysterese-detektoren, Normal prioritet), så containeren er bare
fallbacken under dem.

- **KORTET velger container, ikke pekeren** (`dndPickRowContainer`,
  `dndLevel1Collision`). Først «hvilket kort er objektet i?» — avgjort av
  objektets egen boks mot kortets innholdssone (1/3-tersklene under), ikke av
  pekeren — og så, inne i det kortet, velger pekeren mellom nivå 1 og en
  kategoris hylle. Et sikte rett under siste rad, på ＋-knapperaden, er innenfor
  kortet men utenfor `.items-container`; med ren boks-testing traff det
  ingenting, og raden ble liggende igjen.

  Svaret regnes ut ÉN gang per pekerbevegelse. Det er ikke en optimalisering:
  `dragOverCard` har hukommelse, og slarken `noteOverShift` gir gjennom ett
  layout-hopp forbrukes av det FØRSTE kallet som finner objektet inne i sonen på
  egen hånd. Regnet detektorene det ut selv, ville bevegelsen og kollisjonen
  svart på hver sin layout og skiftet på å ha rett én gang per frame.

- **Kategoriens OVERSKRIFT er en vei INN i kategorien** (`dndShelfCollision`).
  Pekeren inne i en kategori — overskriften like mye som hylla — betyr «legg
  raden i kategorien». For dnd-kit er overskriften en del av kategori-RADEN, så
  et sikte der ville lest som «bytt plass med kategorien». Hylla svarer derfor på
  overskriften også, med høy prioritet; står pekeren i selve hylla, svarer den
  med lav, slik at radene der bestemmer plassen. En KOLLAPSET kategori er unntatt
  — der er hylla uten høyde, og nivå 1 gjelder til peek har foldet den ut.

- **En kategori pekeren står INNI er ikke en nabo — den er MÅLET**
  (`dndCategoryRowCollision`). Kategorien er den eneste raden som også er en
  container, og hysteresen byttet det løftede listepunktet med kategori-RADEN
  mens pekeren allerede var inne i kategorien: kategorien hoppet en radhøyde
  oppover, siktepunktet ble liggende under den, og raden landet ved siden av
  kategorien i stedet for i den — og var hylla TOM, fantes det ingen rad inni å
  sortere mot som kunne rettet det opp.

  **Svaret må leses av pekeren dnd-kit selv holder**
  (`dragOperation.position.current`), i detektoren. En vakt hengt på `dragmove`
  svarer på FORRIGE bevegelse, siden den kroken løper ETTER kollisjonsrunden — og
  en vakt som leser forrige bevegelse er ikke en sen vakt, den er en gal en. Det
  ble først prøvd med et NOTAT i stedet («radene konkurrerer bare inne i
  containeren totrinnsregelen valgte»), og det gjorde vondt verre: et for gammelt
  svar ble til et VETO, og et slipp nederst i en liste sluttet å bytte plass med
  siste rad. Gjelder bare listepunkt-drag — en kategori kan ikke ligge i en
  kategori.

- **En KOLLAPSET kategori er ingen nabo** — samme detektor, samme grunn. Se
  stabilitets-vakten under [«Peek»](#peek-åpning-av-kollapsede-dra-mål-updatepeek-peek_ms--200-ms).

- **Kolonnen er siste utvei.** Et slipp NEDENFOR alt innhold i en kolonne betyr
  «sist i den kolonnen», ikke «ingenting» — og `pointerIntersection` mot
  kolonnens egen boks sier «ingenting» der, for kolonnen slutter der innholdet
  slutter. Nav-modalen har nøyaktig én kolonne og kan svare ubetinget
  (`navColumnCollision`); hovedsidens board har flere, og bare ÉN av dem kan være
  svaret, ellers ville alle meldt seg samtidig for et slipp i lufta under
  board-et. Hvilken avgjøres av KORTETS EGEN BOKS (`boardPickColumn`, regnet ut
  én gang per bevegelse), ikke av pekeren. Prioriteten er den lavest mulige, så
  kolonnen aldri vinner over et kort eller en sone.

- **Kortet legges tilbake BLANT kortene** (`navSettleCardInColumn`) — ikke en
  detektor, men den samme saken: sluttplasseringen legger kortet sist i
  containeren når slippet er nedenfor alle kort, og sist i nav-kolonnen er etter
  seksjonsoverskriften for neste seksjon.

## Kategorier: to nivåer i en liste ([`data-model.md`](data-model.md))

En liste har nivå 1 (ukategoriserte listepunkter + kategorier, om hverandre) og
nivå 2 (listepunktene inne i hver kategori). DOM: kortets `.items-container`
holder nivå-1-radene (`.item` og `.category`); hver `.category` har en overskrift
på listeflaten + en nøstet `.cat-items`-liste (nivå 2) som er en innrykket
fordypning («hylle», se [`design-system.md`](design-system.md)).

**Ett board, to containernivåer.** `.items-container` og `.cat-items` er
containere i det SAMME board-et. Det er det som gjør at et listepunkt kan dras
fra én liste til en annen, og inn og ut av en kategori, uten å krysse en
board-grense.

**Kategorien er både rad og container.** `itemType` gir den typen `category`
(`groupcat` i nav-scopet), og `containerAccept` sier at `.cat-items` bare tar
`item` (`group`) — kategorier nøstes aldri. Regelen avvises dermed UNDER draget,
av dnd-kits egen `accept`-port, ikke etter slippet.

Ved slipp bygges kortets `items` fra HELE DOM-treet (`reconcileRows`: nivå 1 +
hver kategoris `.cat-items`), og `it.cat` settes; kun det flyttede listepunktets
`home`/`cat`/`pos` stemples (kirurgisk — `cat` rir på posisjonsregisteret som
`home`).

**Utseendet under draging.** Det løftede objektet skal lese som en kompakt rad,
ikke et stort felt: kategori-ikonet (`.cat-drag-icon`, `ICONS.category`, skjult i
hvile) vises til venstre for tittelen; tittelen blir SVART uten skygge
(hvit-på-hvit var uleselig mot den hvite dra-flaten); menyknappen og ＋-raden
skjules `display: none` (ikke bare opacity) så overskriften får element-høyde;
`::before`/`::after`-skillelinjene skjules (`content: none`) så de ikke males på
det løftede objektet; polstring/radius = et listepunkt (6 px / 10 px) + `gap: 0`.
Uten de fire siste leser objektet som en beholder med luft i.

**Oppløs kategori** (`dissolveCategory`, boble-sprekk-knappen): listepunktene blir
ukategoriserte og «arver» kategoriens plass i nivå-1-lista (fordeles jevnt i
pos-gapet mellom kategorien og neste nivå-1-rad, rekkefølge bevart), og selve
kategori-raden tombstones + fjernes.

## «Hvilken liste er objektet i?» — 1/3-terskler (`dragOverCard`)

Grensen mellom lister avgjøres av det LØFTEDE OBJEKTETS boks (`draggedRect()`,
uklemt), ikke av pekeren. Pekeren sitter der man tok tak, så et pekerbasert svar
gjorde ny-liste-placeholderen mye lettere å få frem oppover enn nedover.

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
**flerkolonne** (desktop) håndteres av pekerens x. Innenfor en liste er det
fortsatt PEKEREN som velger rad/kategori. Valget henger igjen i `drag.overCard`;
er flere kort aktuelle, vinner det man alt er i.

Ingen dødbånd mellom inn og ut — hysteresen kommer av LAYOUTEN: idet man går inn,
forsvinner ny-liste-placeholderen fra board-et og raden sorteres inn i lista
(sonen vokser med en radhøyde), og motsatt når man går ut. Begge deler flytter
geometrien i «bli der du er»-retning, så en monoton bevegelse gir nøyaktig
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
grensen for å gå INN er uendret, så 1/3-tersklene måles som før).

Slarken **forbrukes** så snart objektet ligger inne i sonen på egen hånd
(`inCard(cur, 0)`): den er kompensasjon for ETT hopp, ikke en varig utvidelse av
lista. Blir den liggende, må man dra en placeholderhøyde EKSTRA for å komme ut igjen,
og et slipp rett under lista havner i den i stedet for i en ny liste (målt: 57 px
forbi terskelen, mot 0,5 px når den forbrukes). Dekket av punkt 6 og 7 i
`tests/board-columns.test.js`.

To spesialtilfeller i `cardBand`:

- **Kollapset eller peek-åpnet liste** → hele kortet er sonen. En kollapset liste
  har ingen innholdssone i det hele tatt, og en peek-åpnet liste ble åpnet nettopp
  fordi objektet siktet på den (over overskriften, det eneste som fantes) — den
  skal ikke miste objektet i det den folder seg ut.
- **For liten sone** (tom eller nesten tom liste) → hele kortet. Sonen måles da som
  om raden ikke lå der; ellers ville samme liste hatt en romsligere sone UTE enn
  INNE, og objektet ville gått inn, falt ut igjen og flimret. `MIN_BAND_SLACK`
  (48 px) må dekke at lista rykker oppover mot objektet idet ny-liste-placeholderen
  (≥ 72 px) byttes mot en radhøyde inne i lista.

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
  stedet for inne i kategorien. Uten slarken var «over en kategori øverst» umulig:
  målt 0 px vindu, mot 63 px over et vanlig listepunkt øverst; med slarken 30 px
  (og 93 px over et listepunkt). Dekket av `G1`/`G2` i
  `tests/dnd-extract-thresholds.test.js`.

Ut-tersklene ligger ~20–30 px innenfor kortets ytterkanter, så
ny-liste-placeholderen dukker opp tidligere enn med kortkantene som grense.

Peek-åpning av kollapsede mål bruker samme `dragOverCard`, ellers kunne
plasseringen stå og vente på en peek som aldri startet fordi pekeren ennå ikke var
inne i kortet.

## Ekstrahering til ny container (rad → nytt kort)

Drar man en **kategori** eller et **listepunkt** UT av listene og holder det over,
under eller mellom dem (dvs. i board-luften, ikke over noe kort), dukker en KORT-
formet placeholder med et **＋-ikon** i midten opp (`.new-list-placeholder`) —
slipp der oppretter en NY liste. Det samme gjelder i nav-modalen: en mappe eller
mappekategori dratt ut i lufta blir et nytt OMRÅDE.

`drag.phMode` (`'reorder'` | `'extract'`) styrer modusen;
`*SetExtractMode`/`*SetReorderMode` bytter. `dragOverCard()` avgjør modus hver
runde: er objektet «i» en liste → reorder, ingen liste → extract.
`extractionPos` gir den nye containeren en `pos` mellom placeholderens naboer i
leserekkefølge.

**Slik slås reorder av:** mens modusen står på svarer `*RowAccept` med TOM liste
— ingen container tar imot, dnd-kit finner ikke noe mål, sorteringen står stille,
og plasseringen er vår. Det er Smetts eget svar på «slå av reorder akkurat nå».

`placeNewListPlaceholder` plasserer kort-placeholderen:

- **KOLONNEN** etter pekerens x (±8 px slingring). Ingen kolonnetreff (pekeren i et
  kolonnegap) → behold kolonnen placeholderen alt står i. Klemmes til siste kolonne
  som har kort: en tom kolonne lenger til høyre finnes bare fordi vinduet er bredt,
  og en ny liste havner aldri der før kolonnene til venstre er fulle
  ([`board-layout.md`](board-layout.md)).
- **PLASSEN i kolonnen** etter det LØFTEDE OBJEKTETS y-senter — ikke pekerens:
  ut-terskelen (1/3) slår inn mens pekeren fortsatt kan være inne i lista man
  forlot, og et pekerbasert y-valg la da placeholderen på feil side av den. Målt
  mot den layouten man SER; den er selvstabiliserende, siden et kort placeholderen
  passerer samtidig glir en placeholderhøyde bort i samme retning.

**To veier til samme plass:** bunnen av kolonne k og toppen av kolonne k+1 er samme
plass i rekkefølgen, men to ulike containere. Sikter man under siste liste i
kolonne k, havner placeholderen der; sikter man over første liste i kolonne k+1,
havner den der. Sluttresultatet er identisk. Dekket av punkt 4 i
`tests/board-columns.test.js`.

**Hullet blir stående i kilde-lista.** dnd-kits klone blir liggende der raden kom
fra mens ekstraheringsmodusen står på. Kilde-lista er altså en radhøyde høyere
enn den blir, samtidig som ny-liste-placeholderen legger seg inn i kolonnen — den
døde sonen mellom «ut av lista» og «ny liste» er tilsvarende større. Å ta hullet
ut av flyten er PRØVD (usynlig klone + negativ margin på resten av lista, boksen
beholdt fordi dnd-kit måler det løftede objektet PÅ klonen) og krympet sonen fra
112 til 64 px — men da mistet en kategori dratt over en kollapset liste
peek-åpningen sin (`dnd-peek-collapsed` test 4), fordi kilde-lista krympet under
pekeren mens 200 ms-timeren løp. Hullet blir derfor stående.

Hva slippet gjør:

- **Kategori → ny liste** (`extractCategoryToNewContainer`): ny liste med samme
  tittel; medlemmene flyttes inn ukategorisert (`cat = null`, `home` = ny liste),
  aktive får `pos` 0..n i bevart rekkefølge, avkryssede/slettede løsnes bare fra
  kategorien. Kategori-raden tombstones + fjernes fra kilde-lista. `render()`
  rebygger board-et rent.
- **Listepunkt → ny liste** (`extractRowToNewContainer`): ny liste med BARE dette
  listepunktet (`cat = null`), tittelen **blank og straks fokusert** så den kan
  navngis med en gang.
- **Oppretter = den som ekstraherer**: den nye containeren lages lokalt med ny id
  og pushes som en ny rad eid av gjeldende bruker (`insertPayload` → `owner_id` =
  meg), uansett hvem som eide kilde-containeren.
- **Låst kilde-liste**: umulig — selve draget er avskrudd (`data-dnd-ignore`), så
  ingen egen vakt trengs i drop-flyten.
- **Opprettelsesrett i FORELDEREN** (`S.canExtract(row)`, sjekket via
  `canExtractDragged()`): ekstrahering LAGER en container, og den myndigheten
  ligger på mappen/området, ikke på det løftede objektet. Board-scopet spør
  `canAddList(activeGroupObj())`; nav-scopet svarer `cap(row, 'move')` — det NYE
  området blir alltid mitt, men å ta mappen UT av det gamle er en flytting
  `move_group` krever destruktiv myndighet i kilden for. Uten retten dukker
  ny-liste-placeholderen aldri opp, og et slipp i board-luften legger objektet
  tilbake der det kom fra. Det er ikke bare teoretisk: et **lås-unntak** på én
  liste i en låst mappe gjør nettopp at objektet kan dras (lista er redigerbar)
  uten at en ny søskenliste kan opprettes.

## Kategori → en annen liste (`moveCategoryToCard`)

En kategori kan dras INN i en annen eksisterende liste (ikke bare reorderes i sin
egen eller ekstraheres til en helt ny). Tre-veis, med mål-lista fra
`dragOverCard`: KILDE-lista → reorder på nivå 1; en ANNEN liste → nivå 1 der
(kategorier nøstes aldri, så alltid `.items-container`); board-luft → ekstraher.

Ved slipp i en annen liste (mål-kort ≠ kilde-kort) flytter `moveCategoryToCard`
kategorien OG alle medlemmene (aktive + avkryssede + slettede) til mål-kortet:
medlemmene beholder `cat`-pekeren, både kategori og medlemmer får ny `home`
(= mål-kortet) og stemples (`home` rir på posisjonsregisteret), kategoriens `pos`
settes mellom slipp-naboene. Board-et rebygges rent med `render()`, så
«Utført»-medlemmer i andre DOM-seksjoner følger korrekt med.

## Peek-åpning av kollapsede dra-mål (`updatePeek`, `PEEK_MS` = 200 ms)

Drar man et **listepunkt** over en KOLLAPSET liste eller kategori — eller en hel
**kategori** over en kollapset liste — og BLIR VÆRENDE der i `PEEK_MS`, åpnes målet
MIDLERTIDIG (peek) så man ser hvor objektet vil lande. Flytter man videre uten å
slippe, kollapses målet tilbake. Peek er ren forhåndsvisning: den rører IKKE
`card.collapsed`/`item.collapsed` og lagrer ikke.

- **To lag samtidig** (`drag.peekCard` + `drag.peekCat`, kun kategori-laget for
  listepunkt-drag): «listen OG/ELLER kategorien» åpnes progressivt — først lista, så
  en kollapset kategori inne i den. Hvert lag har en 200 ms-timer (`setPeekLayer`); et
  allerede peek-åpnet mål (ikke lenger `.collapsed`) beholdes så lenge det er målet.
  Liste-laget bruker `dragOverCard()` (samme 1/3-terskler som plasseringen);
  kategori-laget velges av pekeren, som all annen plassering innenfor en liste.
  `peekExpand`/`peekCollapse` bruker de momentane body-veksel-funksjonene
  (`expandCardBody`/`collapseCardBody`, `expandCatBody`/`collapseCatBody`) + skjuler/viser
  «(N)»-telleren (`peekChip`).
- **Stabilitets-vakt**: MENS et kollapset mål (ennå ikke peek-åpnet) hoveres, skal
  ingenting flytte seg — flyttet vi raden inn nå, ville kilden krympet med en
  radhøyde og målet (særlig en liste UNDER kilden i énkolonne) stukket vekk under
  pekeren, så 200 ms-timeren aldri rakk å løpe ut. Det sies to steder, fordi de to
  slagene mål feiler på hver sin måte:

  **(a) en kollapset LISTE tar ikke imot** — `*RowAccept` svarer tomt for
  containere i et kollapset kort (`dndInCollapsedTarget`), og svaret leses på
  hver `sync()`, altså før draget begynner;
  **(b) en kollapset KATEGORI er ingen NABO** — den ligger som en rad på nivå 1,
  og hysteresen byttet plass med den, så kategorien flyktet oppover før pekeren
  nådde den. En vakt hengt på pekeren kommer for sent (kollisjonsrunden løper før
  våre `dragmove`-lyttere), så den sies i en kollisjonsdetektor:
  `dndCategoryRowCollision` er ikke et treff mens kategorien er kollapset.

  Ved selve SLIPPET lander raden i målet uansett (`dndLandInPeekTarget`), så et
  raskt slipp før peek rakk fortsatt havner der.
- **Ved slipp** (`resolvePeekOnDrop`): et peek-åpnet mål slippet LANDET i forblir åpent
  (persisteres `collapsed = false` + stemples), et peek-åpnet mål man IKKE landet i
  kollapses tilbake. Kategori-slipp INN i en annen liste rebygger med `render()` og
  setter mål-listas `collapsed = false` når den var peek-åpnet. `refreshAllCollapseCounts`
  oppdaterer «(N)» på lister/kategorier som fikk et raskt slipp uten peek.
- **Opprydding**: `clearAllPeeks(recollapse)` river ned begge lag (kalt av `finishDrag`
  som sikkerhetsnett → kollapser tilbake ved avbrudd), og hvert board nullstiller
  `drag.peekCard`/`peekCat` ved løft.

## Skillelinjene forhåndsvises under draget (`applyDragSeparators`)

I hvile males linjene rundt en kategoris hylle av pseudo-elementer på selve
kategorien (`.category::before/::after`, se
[`design-system.md`](design-system.md)): en linje mellom to nabo-rader på nivå 1
når minst én av dem er en kategori. De reglene holder ikke under et drag — de
kjenner ikke den KOMMENDE plassen, og de teller det LØFTEDE objektet som nabo
selv om det ligger i top layer, ute av flyten (som ga fantom-linjer).

Under listepunkt- og kategori-draging tar JS derfor over linjene i de
nivå-1-containerne draget berører: containeren får `.seps-managed` (slår av
pseudo-reglene) og hver rad som skal ha en linje OVER seg får `.sep-above`.
Klonen teller som den raden den representerer, så man ser skillelinjene slik de
BLIR hvis man slipper der hullet står.

- Linjene uttrykkes som **klasser på radene**, ikke innsatte linje-elementer:
  radenes DOM-naboskap brukes av pos-logikken (`rowPos`) og av dnd-kits egen
  sortering, og et element mellom radene ville forstyrret den.
- **Klonen speiler det LØFTEDE objektet.** dnd-kit bygger klonen på nytt av
  objektet ved HVER sortering, og den arver klassene og inline-stilene DENS. En
  linje som skal males på hullet må derfor settes på OBJEKTET (`addSep`), som
  klonen kopierer den fra — og der er den skrudd av i CSS, siden objektet ligger i
  top layer og ikke er en rad i lista. Satt på klonen alene overlever den ikke
  neste bevegelse.
- **Linjene tegnes ÉN GANG TIL på neste frame** (`applyDragSeparatorsSoon`):
  dnd-kit avgjør plasseringen i kollisjonsrunden, men SKRIVER den asynkront, så
  `dragover` fyrer mens radene fortsatt står som før.
- **En rad som er FORFAR til det løftede objektet får aldri `.sep-above`** —
  linja males i stedet speilvendt fra raden OVER (`.sep-below`, `margin-bottom:
  25px` + linja 16 px under raden; identisk geometri). `.sep-above` setter
  `position: relative`, og en posisjonert forfar blir containing block for
  absolutt posisjonerte etterkommere; symptomet var at et listepunkt dratt UT av
  en kategori til nivå 1 i samme liste forsvant. Top layer gjør at nettopp det
  symptomet ikke kan gjenta seg, men speilingen står — geometrien er identisk
  uansett hvilken av de to radene som bærer linja, og det er den formen
  `dnd-separators-preview` måler. Raden over er aldri en forfar (det løftede
  objektet hører til nøyaktig én nivå-1-rad), så byttet er trygt.
- Ryddes med `clearAllDragSeparators` i `finishDrag` og i hver commit. Geometrien
  er identisk i hvile og forhåndsvisning (33 px total luft, linja midt i), så
  byttet er usynlig.

## Søppelkassen er et slippmål mens draget varer

Idet et drag starter, vises kassen for NIVÅET fram (`armDragTrash` — den er
ellers skjult når den er tom), den markeres når man sikter på den, og et slipp i
den SLETTER objektet i stedet for å flytte det.

Kassene er **soner** (`zoneSelector` + `onZoneDrop`), og Smett ruller raden
tilbake dit den kom fra FØR handlingen kalles — nøyaktig semantikken vi vil ha:
ingen ny `pos` skrives, slettingen tar over. Treffsonen er knappen selv; sonen er
en droppable, og dnd-kit måler dens egen boks.

- **Kassen er BUNDET til draget**: for et listepunkt/en mappe er det kassen i
  containeren raden kom FRA (`drag.trashHost`), ikke den man tilfeldigvis svever
  over. Et slipp på en ANNEN synlig kasse — et annet områdes, eller mappe-kassen
  under et kategori-drag — ruller raden tilbake i stedet for å omrokkere den.
- **Kategorier har ingen kasse.** En kategori slettes ikke — den LØSES OPP
  (listepunktene blir stående), fra objektmenyen. `dragTrashBtn()` svarer null for
  dem, og ingenting armes.
- **Feiler LUKKET** (`draggedCanBeTrashed`): samme capabilities som menyens
  «Slett»-rad. Uten rett vises ingen kasse i det hele tatt, så man kan ikke sikte
  på noe serveren ville avvist.

Autoritativt: [`trash.md`](trash.md) («Slett ved å dra objektet i kassen»).

## Slipp i en LÅST mål-container

DB-vaktene (`*_before_update`) krever redigeringsrett på BÅDE gammel og ny
forelder. Uten en klient-sjekk ville et slipp inn i en frossen liste/et frossent
område sett ut til å lykkes og så blitt snappet tilbake ved neste synk.

**Board-scopet avviser UNDER draget.** Der er regelen om CONTAINEREN alene —
radene i en låst liste kan ikke løftes (`data-dnd-ignore`), så kilden er aldri
selv låst, og hovedsiden har ingen virtuell beholder som må kunne omrokkeres
innvendig men ikke tas imot utenfra. `boardRowAccept` svarer derfor tomt for
containere i en frossen liste: hullet dukker aldri opp der, og raden blir liggende
i stedet for å flytte inn og snappe tilbake. Slippet sier likevel HVORFOR
(`boardWarnLockedTarget`) — uten en forklaring ser det bare ut som om det ikke
virket.

**I nav-scopet avgjøres den ved SLIPPET**, fordi regelen der er
KILDE-avhengig: en fri mappe kan omrokkeres i fri-seksjonen, men ingen mappe kan
flyttes INN i den, og `containerAccept` kjenner bare containeren, ikke kilden.
Skal den også bli en drag-tid-regel, krever det et kilde-argument i Smetts
`containerAccept` — en Smett-endring i egen rett.

Commit-sjekken (`navRejectTarget` / `boardRejectTarget`) står uansett igjen som
vakten for containeren som ble låst MENS draget pågikk. Den **kaster**: Smett
ruller da rekkefølgen tilbake til der draget startet, og en toast sier fra —
`S.lockedTargetMsg`, «Listen er låst – du kan ikke flytte noe hit» på board-et og
«Området er låst – du kan ikke flytte noe hit» i nav-modalen.

## `pos`-regnestykket ved slippet

Ny `pos` regnes mellom naboene i leserekkefølge (`between`, `rowPos`,
`navCardNeighbour`, `dndRowSibling`). Tre ting gjør regnestykket vanskeligere enn
det ser ut:

**Klonen er ikke en nabo.** dnd-kit holder plassen med en KLONE av det løftede
objektet, og den ligger rett etter det med de samme klassene.
`previousElementSibling`/`nextElementSibling` leser den da som naboen, og svarer
«ingen nabo på den siden», altså «sist i lista», uansett hvor man faktisk slapp.
`boardRows`/`isBoardRow`, `dndRowSibling`, `sepRows` og `restoreCardsAfterDrag`
hopper derfor over `[data-dnd-placeholder]`.

**Board-ets kolonner er egne containere.** Naboen over den ØVERSTE raden i en
kolonne ligger nederst i kolonnen FØR, ikke i samme container.
`boardRows()`/`boardRowSibling()` leser derfor på tvers av kolonnene, i
leserekkefølge.

**Områdenes `pos` regnes ALLTID innenfor sin egen seksjon.** Nav-modalen deler
områdene i tre seksjoner, og `renderNav` sorterer på seksjon FØR `pos`. En `pos`
hentet over en seksjonsgrense flytter ingenting dit man ser — den importerer bare
en fremmed verdi inn i seksjonen og stokker om på resten. Det virtuelle «Mapper
delt med meg»-kortet er dessuten aldri en nabo: det har `pos: Infinity`, og
`between(Infinity, null)` er `Infinity`, en verdi som ikke overlever JSON —
slippet ville lagret `pos: null` på medlemskapsraden og slettet brukerens egen
rekkefølge. `navCardNeighbour` er regelen ett sted: den går utover i
leserekkefølge og HOPPER OVER både det virtuelle kortet og kort i en annen
seksjon. Både slippet og ekstraheringen bruker den, og tastaturet har alltid
fulgt den samme regelen (`moveCtx`).

**Seksjonsoverskriftene** i nav-modalen ligger i den samme `.board-col` som
kortene, men `boardRows` filtrerer på `.card`/`.card-placeholder`, så de er aldri
dra-mål.

**Posisjonsbasert farge reindekseres alltid ved en fullført omrokkering** (ikke
bare ved add/slett): commit-en kaller `reindexContainerColors`, som går gjennom
den sorterte lista (samme kilde som render bruker) og setter `colorForIndex(i)` +
oppdaterer CSS-variablene direkte på de allerede eksisterende DOM-nodene —
kirurgisk, ingen full re-rendring (som ville kuttet drop-animasjonen).

## En ombygging må meldes til dnd-kit

Et slipp rendrer board-et eller nav-modalen på nytt, og da byttes hvert eneste
kort og hver eneste rad ut. dnd-kit har fortsatt de GAMLE elementene i registeret
sitt, og de finnes ikke i dokumentet lenger — da er det ingenting igjen å løfte.

Smett følger med på DOM-et selv (`MutationObserver`), men bare mens ingen drar:
endringene som skjer mens en gest står på er dnd-kits egne, og den lar dem være i
fred. Ombyggingen etter et slipp faller nøyaktig mellom de to — den kommer mens
dnd-kit ennå avslutter draget (slippanimasjonen), og etterpå kommer det ingen ny
endring å reagere på.

`renderNav` avslutter derfor med `navSyncBoards()`, som kaller Smetts `sync()`
(«public for a render you know about») på begge nav-board-ene; `renderBoard` gjør
det samme med `boardSyncBoards()`. Mens et drag FAKTISK pågår gjør de ingenting —
da er DOM-et dnd-kits.

Uten den virker det neste løftet først når noe annet tilfeldigvis rendrer på
nytt, som en synkrunde. På mus rakk det ofte akkurat; på touch gjorde det ikke
det, og et andre drag var umulig. `dnd-nav-engine` sjekk 9 er vakten.

## Etterarbeidet ved slippet

**Fordelingen må kjøres ved SLIPPET.** Kolonnene er frosset gjennom draget, og et
kort som bytter kolonne endrer som regel den grådige pakkingen. `boardCommitCard`
kjører derfor `relayoutBoardNow` (den samme fordelingen uten drag-vakten):
dnd-kit regner ut hvor det løftede kortet skal fly, og sikter på KLONENS boks.
Kjøres fordelingen først etterpå, flyr kortet til den frosne sloten og
teleporterer så til sin endelige plass — målt til ~1000 px.

Fordelingen må da regne med det løftede kortets **hvilehøyde**. dnd-kit pinner
den KOLLAPSEDE høyden på elementet gjennom hele animasjonen, så `offsetHeight`
svarer feil for nettopp den raden: pakkingen ville fordelt kolonnene på et kort
som «veier» et korthode. Hvilehøyden måles rett før kollapsen
(`boardLiftedRow`/`boardLiftedRowH`, lest av `boardRowHeight`) — den eneste
gangen den er å se. `board-columns` sjekk 9 følger selve flukten: den skal gå mot
hvileplassen hele veien, og ende der.

To ting må vente til klonen faktisk er borte (`boardRelayoutAfterDrop`):

- **Scroll til den slupne lista.** Klonen holder plassen med den KOLLAPSEDE
  boksen, så dokumentet er kortere enn det blir — og scrollen klemmes mot nettopp
  dokumenthøyden. `scrollDroppedIntoView` kjøres derfor én frame etter at klonen
  er fjernet, og slår opp lista på ID: en synk-runde kan ha rendret board-et i
  mellomtiden, og en frakoblet node måler 0 (scrollen ville da sendt siden til
  toppen).
- **Bunn-luften og en siste synk.** `fixBoardBottomGap` måler kortenes bokser, og
  slettingen («dra lista i kassen») kan ha rendret board-et mens dnd-kit ennå
  avsluttet draget.

**Scrollen er så lite påtrengende som mulig.** Det trygge området er mellom
toppmenyen (+ board-gapet) og den BRUKBARE bunnen (viewportbunnen −
`--safe-bottom` − gapet; gestelinjen dekker de nederste pikslene, og er 0 i en
nettleser — [`design-system.md`](design-system.md)). Ligger lista allerede HELT
innenfor det, er funksjonen en **no-op** — en liste som var synlig hele tiden skal
ikke rykke rundt bare fordi den ble omrokkert. Ellers scrolles den KORTEST MULIGE
avstanden inn i området, men aldri så langt at toppen forsvinner bak toppmenyen.
`behavior: 'smooth'`, `'auto'` ved `prefers-reduced-motion`. Sloten måles på
KLONEN — det løftede kortet ligger i top layer og har ingen plass i flyten å måle.
Hoppes over når lista slippes på nav-knappen eller i kassen (begge er soner og går
aldri gjennom `onCommit`). Kun i `boardScope` — nav-modalen har ingen
window-scroll å justere.

## Et avbrutt drag er ikke et slipp

Smett ruller rekkefølgen tilbake selv og kaller aldri `onCommit`, så `pos` skrives
uansett ikke. Men `finishDrag()` teller ETHVERT drag som avsluttes som et slipp
(`dropSeq`), og den telleren er blind for tilstand med vilje: demoen har steg der
selve slippet ER handlingen, også når objektet lander på samme plass, der verken
`pos` eller rekkefølge endrer seg og en tilstandssjekk derfor ikke ville sett noe.

Hvert board sier derfor fra om avbruddet før det rydder (`dndNoteCanceled(event)`
→ `dragRolledBack`), av dnd-kits egen `dragend.canceled`. Uten det kvitterte en
`pointercancel` — typisk Android Chrome som klemmer scrollen — ut «dra
raden»-steget i demoen uten at brukeren hadde flyttet noe
(`tests/onboarding.test.js`, «11 avbrudd»).

`restoreDraggedToOrigin` er rollback-veien Huskis selv tar når en commit ikke lar
seg fullføre (f.eks. ekstrahering uten en aktiv mappe): den setter
`dragRolledBack`, fører elementet tilbake til den registrerte sloten
(`drag.origParent`/`origNext`) og rydder sikte-klassene. Geometrien er dnd-kits og
ryddes av dnd-kit. En node som alt er ute av dokumentet settes IKKE inn igjen —
DOM-en har gått videre uten den, og en re-innsetting ville gitt et
spøkelses-duplikat ved siden av de ferske nodene.

## Viewport-klemmen og rotasjonen

Det løftede objektet holdes innenfor det BRUKBARE feltet av Smetts
`SafeViewport`, matet med `safeInsets()`. «Brukbart» = viewporten minus den sikre
sonen: et hakk i siden er en del av `innerWidth`, og et objekt som stopper der
ville lagt seg delvis under det mens board-et det kom fra står innenfor
([`design-system.md`](design-system.md)). Sonen er 0 i en nettleser, så klemmen
regner ut nøyaktig det samme der.

**Rotasjonen er ikke med i klemmen, og det er med vilje.** `SafeViewport` klemmer
den boksen dnd-kit har MÅLT, og målingen tar ikke med rotasjonen vi maler
objektet med etterpå (`dndPaintRotation`). En rotert boks er både høyere og
bredere — for en bred, lav rad ved ±5° er forskjellen ~30 px i høyden — og
differansen stikker ut med halvparten på hver kant: et kort dratt til nedre høyre
hjørne på en 390 × 780-skjerm ligger ~13 px under viewportkanten.

Å legge slarken inn i klemmen — enten som ekstra safe insets eller ved å klemme
mot den roterte boksen — koster det som betyr noe: grepet løsner fra fingeren med
nøyaktig den samme slarken hver gang objektet nærmer seg en kant
(`dnd-layout-modes` sjekk 1). Objektet ligger i top layer (`position: fixed`), så
hjørnet utenfor kanten lager verken scrollbar eller overflow — det er kosmetikk;
grepet er det ikke. `dnd-viewport-clamp` regner derfor rotasjons-slarken inn i sin
egen toleranse, og måler den ut fra objektets faktiske `rotate`.

**Rotasjonen er dynamisk** (`cardRotation()`, ±5° ut fra horisontal posisjon: −5°
inntil venstre kant, +5° inntil høyre) og gjelder ALLE objekt-typene. Den settes
fra JS som en EGEN `rotate`-egenskap, aldri via `transform`: geometrien er
dnd-kits og skrives med `!important` (`position`, `top`, `left`, `width`,
`height`, `transform`, `translate`). Skalaen ligger i CSS av samme grunn.

**Og en regel uten virkning er ingen regel.** `.board [data-dnd-placeholder] {
rotate: none }` gjorde ingenting — klonen bærer rotasjonen som en INLINE-stil, og
en inline-stil slår enhver klasseregel, så en bred, lav rad fikk et hull dobbelt
så høyt som seg selv. Med `!important` står den.

## Auto-scroll

dnd-kits `AutoScroller` finner scroll-containeren selv: vinduet for et drag på
hovedsiden, modalens `.menu-body` for et nav-drag (den er en forfar til det
løftede objektet). Ingen Huskis-kode er involvert, og to spørsmål som en gang var
våre er dermed upstreams:

- **Den ØVRE sonen rekker under den faste toppmenyen.** `AutoScroller.threshold`
  er en brøkdel av containeren, der Huskis' egen sone ble målt fra toppmenyens
  bunn — man skulle ikke måtte dra lista opp BAK headeren for å få siden til å
  rulle. MÅLT: et sikte rett under toppmenyen (`topbarBottom + 12 px`) scroller
  oppover. `dnd-mobile-autoscroll` sjekk (d) er vakten.
- **Farten er per frame, ikke per millisekund**, så en 120 Hz-skjerm scroller
  fortere enn en 60 Hz-skjerm på samme fysiske tid. En falsk rAF-klokke måler da
  biblioteket, ikke oss — `dnd-recovery-scroll` vokter i stedet at auto-scrollen
  i det hele tatt slår inn for et listepunkt.
- **En nedover-frame reduserer aldri `scrollY`.** Board-vakten holder
  board-bunnen stabil gjennom draget, men påstanden vokter uansett at et
  fortegnsbytte ikke kan skje. `dnd-mobile-autoscroll` sjekk (b).

## Områder og mapper (nav-modalen)

Egen kode for disse to nivåene finnes ikke: områder dras som lister, mapper som
listepunkter, mappekategorier som kategorier — samme komponenter, samme politikk,
bare et annet state-tre (`navScope`). Det som er verdt å merke seg:

- **Alltid én kolonne**: `navScope.singleColumn` gjør at `relayoutBoard` lager
  nøyaktig én `.board-col` (samme kolonnemaskineri som hovedsiden, se
  [`board-layout.md`](board-layout.md)), så kort-draget aldri møter
  flerkolonne-logikken.
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
  [`rettigheter-og-deling.md`](rettigheter-og-deling.md) del 11 og 12.
- **Den aktive mappen følger med** når den bytter område (dratt dit, ekstrahert
  til et nytt, eller båret med av en mappekategori): `followActiveGroup()` kalles
  først i `renderBoard()` og flytter `state.activeUniverse` etter mappa.
  `activeGroupObj()` leter bare i det aktive området, så uten dette falt
  hovedsiden til «Ingen mapper ennå.» med mappa fortsatt i behold. Den bor i
  render-veien nettopp for å dekke ALLE veiene inn med ett sted.

## Flytting av lister til en annen mappe (innen samme område)

Mappene ligger ikke på hovedsiden. Dra i stedet lista opp på **nav-knappen** i
toppmenyen: knappen er en SONE for kortdraget (`data-dnd-zone="crumb"`), den
markeres (`.drop-target`, kun når det finnes andre mapper), og det løftede kortet
blir gjennomskinnelig (`.to-group`). Smett ruller lista tilbake dit den kom fra
FØR handlingen — som for søppelkassen — og så åpnes en velger («Flytt … til:», i
plasserings-modal-skallet via `openPicker`); valget gjør en kirurgisk flytting
(`moveCardToGroup`: `card.group` + `pos` bakerst, kun posisjonsregisteret
stemples) + toast. Avbrytes velgeren, er INGENTING endret — heller ikke
rekkefølgen på board-et, som draget kan ha rukket å endre på veien opp.
`moveCardToGroup` slår opp det LEVENDE kortet på id — en synk-rebuild kan ha
byttet ut objektet mens velgeren sto åpen.

Velgeren viser mappene i det AKTIVE området der man faktisk kan opprette lister
(`cap(g, 'createList')`; mappekategorier er overskrifter og listes ikke). Vil man
flytte lista lenger — til en mappe i et annet område — flytter man i stedet MAPPEN
i nav-modalen. Se [`data-model.md`](data-model.md).

## Tastaturet er Huskis' eget

Alle board-ene bygges med `keyboard: false`. dnd-kits `KeyboardSensor` ville
kjempet om Enter/Mellomrom, som på et korthode og en mapperad allerede betyr
«kollaps» og «naviger». WCAG-alternativet til draget er `attachKeyHandle` — F2,
Alt+piler og «Flytt til …» — se «Rekkefølge og flytting fra tastatur» i `app.js`
og [`tilgjengelighet.md`](tilgjengelighet.md).

## CSP-en har en hash for dnd-kits stilark

dnd-kit injiserer et `<style>`-element mens et drag pågår — det som løfter
objektet inn i top layer og posisjonerer det. `style-src 'self'` blokkerte det, og
feilen var STILLE: draget «virket», men det løftede objektet ble liggende
sentrert i viewporten i stedet for å følge fingeren. Ett element, én hash, og to
av dnd-kits plugins (`Cursor`, `PreventSelection`) er meldt av fordi Huskis maler
det de maler fra `body.is-dragging`. `tests/csp-enforced.test.js` regner hashen ut
på nytt fra et EKTE drag. Se [`sikkerhetsheadere.md`](sikkerhetsheadere.md).
