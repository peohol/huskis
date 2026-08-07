# Introduksjon for nye brukere: demonstrasjonen og de kontekstuelle tipsene

Les denne når oppgaven berører førstegangsopplevelsen — demonstrasjonen etter
første innlogging, stegene i den, «Vis på nytt» i konto-modalen, eller tipsene
som lærer bort de avanserte gestene. Koden ligger i `app.js`, seksjonen
«DEMONSTRASJONEN FOR NYE BRUKERE».

Prinsippet er todelt, og de to delene har med vilje ulik tyngde:

| | Demoen | Tipsene |
|---|---|---|
| Når | én gang, første gang en konto møter DENNE runden | første gang gesten er relevant |
| Hva | brukeren gjør alt appen kan, i en simulering | én avansert gest om gangen |
| Form | tooltip med pilspiss på ekte UI, som brukeren faktisk trykker på | vanlig toast, ikke-modal |
| Går videre av | at TILSTANDEN endret seg — aldri av et knappetrykk | timeren, «Skjønner» eller et sveip |
| Avsluttes av | «Ferdig» på siste steg, eller ✕ | timeren, «Skjønner» eller et sveip |

## Simuleringen: demoen har sin egen app

Hele runden kjører i en **simulering**. `demoSimStart()` legger brukerens egne
objekter til side (`demoSaved` holder på `state.universes`, de aktive pekerne og
`state._tomb`), gir `state` et helt nytt, tomt tre, og `demoSimStop()` gir det
hele tilbake når demoen er over.

Det løser tre problemer på én gang:

- **Demoen er lik for alle.** En tom konto og en konto med tre hundre lister ser
  nøyaktig det samme, og hvert steg kan peke på ett bestemt objekt uten å måtte
  gjette hva brukeren allerede har.
- **Ingen kan miste noe.** Slettingen, tømmingen og oppløsningen mot slutten er
  ekte handlinger i ekte UI — men på kulisser.
- **Runden avsluttes med blanke ark.** De siste stegene rydder bort alt demoen
  laget, så brukeren står igjen i den samme appen hen kom fra.

Ingenting av kulissen skal nå bufferen, kontoen eller databasen. `demoActive`
stenger veiene ut, og alle er merket i koden:

| Vei | Vakt |
|---|---|
| lokal buffer | `save()`, `saveLocal()` |
| sky-runden (push OG pull) | `scheduleCloud()`, `cloudCycle()` |
| husket posisjon på kontoen | `saveNavPref()` |
| bakgrunnskøen | `cloudLeave()` |

Pull-en er like viktig som pushen: en runde som landet midt i demoen ville
skrevet brukerens egne objekter inn over kulissen. `demoSimStop()` kaller
`scheduleCloud(0)`, så runden tas igjen straks demoen er over.

**To ting var allerede i gang da demoen startet, og begge måtte fanges:**

- **Den bestilte bufferskrivingen.** `scheduleCacheWrite()` debouncer 120 ms. En
  skriving bestilt FØR byttet ville fyrt etterpå og lagret den tomme kulissen
  sammen med den ekte synk-basen — og en reload midt i demoen leste da en buffer
  uten brukerens rader og en base som beskriver dem, altså «alt slettet lokalt»
  → push DELETE på gyldige rader. `demoSimStart()` kaller derfor
  `flushCacheWrite()`, som fullfører den ventende skrivingen med BRUKERENS state
  før byttet. Skrivingen bærer brukerens egne endringer, så den skal fullføres,
  ikke forkastes.
- **Sky-runden som venter på svar.** Vakten øverst i `cloudCycle()` fanger bare
  runder som ikke har begynt. En runde som venter på `get_my_doc` når demoen
  starter, ville gjenopptatt med kulissen i `state`, lest brukerens ekte rader
  som slettet og pushet DELETE. `cloudCycle()` sjekker derfor `demoActive` på
  nytt etter HVER await — etter pullen, etter gravsteins-oppslaget og rett før
  pushen.

Begge er dekket av `tests/onboarding.test.js` (sim 8 og sim 9).

## Grunnprinsippet: tilstand, ikke klikk

Demoen går **aldri** videre fordi en knapp ble trykket. Den går videre når
`done()` sier at handlingen faktisk er utført — objektet finnes hos riktig
forelder, med et navn; kategorien er borte; søppelkassen er tom. Det er hele
mekanikken, og den ligger i `demoObserve()`, som kjøres på et tidsur
(`DEMO_POLL_MS`) så lenge demoen står på.

Et tidsur, ikke hendelseslyttere, er et bevisst valg: ＋-knappene oppretter
objektet OG åpner navnefeltet i samme håndterer, så et klikk sier ingenting om
hva brukeren fullførte. En liste over alle veiene dit ville råtnet; ett billig
spørsmål stilt om igjen råtner ikke.

**`done()` spørres før `premise()`.** Et steg som FJERNER noe — løs opp
kategorien, slett listen, tøm kassen — river bort sin egen forutsetning i samme
øyeblikk som det fullføres. Motsatt rekkefølge ville rullet steget tilbake i
stedet for å kvittere det ut.

**Et drag kvitteres ut av selve slippet**, ikke av at posisjonen endret seg: et
listepunkt som havner der det var, er et like gyldig drag. `dropSeq` i
dra-og-slipp-motoren telles opp i `finishDrag()` for hvert VELLYKKET slipp;
rollback-veiene (`restoreDraggedToOrigin()`) teller ikke.

## Avgrensningen: bare det steget handler om

Brukeren skal ikke kunne lukke eller navigere seg bort fra det pågående steget,
og ikke bruke andre funksjoner enn den steget demonstrerer. Ingen kollapsing der
kollapsing ikke er poenget, ingen sletting der sletting ikke er poenget.

Det håndheves av `demoGate`, som fanger `pointerdown`, `mousedown`, `click`,
`dblclick`, `contextmenu` og `keydown` i **window-capture** — altså før enhver
lytter i appen — og svelger dem med `stopImmediatePropagation()`. Tre regler
gjør den presis:

- **`isTrusted` skiller bruker fra app.** Appen dispatcher hendelser selv
  (`addUniverse()` åpner navnefeltet med et `click()` på tittelen); et blokkert
  syntetisk klikk der ville gitt et navnesteg uten navnefelt.
- **`preventDefault` brukes ikke på pointerdown.** Et klikk utenfor et åpent
  navnefelt skal fortsatt flytte fokus — det er sånn man bekrefter navnet.
- **En tillatt sone er ikke fritt fram.** En listepunkt-rad er hele sonen når
  den skal dras, men den bærer også avmerking og menyknapp.
  `DEMO_NEVER` slipper dem gjennom kun når de ER målet. Stegene som handler om
  menyen lister panelet i `allow`, så radene inni er nåbare.

Escape er av hele veien: den ville ellers avbrutt navngivingen (og fjernet raden
steget nettopp ba om), lukket modalen steget står i, eller avsluttet demoen
bakveien. **✕ i kortet er den ene utgangen** — demoen er frivillig, men den
forlates i sin helhet, ikke steg for steg.

Søppelkasse-knappen er et særtilfelle: kort trykk åpner modalen, hold og sveip
tømmer. `showTrashModal()` spør derfor `demoAllowsTrashModal()`, så modalen bare
kan åpnes i stegene som handler om den.

CSS-en (`body.tour-demo`) demper de samme kontrollene, med `:not(.tour-live)` som
hele forskjellen: `.tour-live` står på kontrollen steget handler om. Det er
affordansen, ikke vakten — blokkeringen ligger i JS.

## Kortet: en tooltip, ikke en modal

Poenget er at brukeren skal se hele appen mens hen bruker den. Derfor:

- **Ingen mørklegging og ingen ring rundt målet.** Bare en pilspiss
  (`#tour-arrow`) som peker på kontrollen. Laget er `pointer-events: none`;
  kun kortet tar imot. Spissen har en hårfin kontur: uten den forsvant det
  hvite kvadratet mot alt som er lyst — den hvite modalen bak, en lys side.
- **Velkomsten er unntaket** (`.tour.narrated`): midtstilt, med både mørklegging
  og uskarphet på flaten bak. Der er det ingenting å peke på ennå.
- **Framdrift som stolpe**, ikke «Steg n av m» — mindre tekst å lese, like
  presist om hvor langt igjen det er (`#tour-progress`, `role="progressbar"`).
- **Kortet legger seg aldri oppå målet.** `placeTour()` velger under → over →
  høyre → venstre, og pilspissen følger med til riktig kant. Er det ikke plass
  til et helt kort noe sted, velges den største luften, og kortet kappes til den
  og ruller innvendig.
- **Et drag har også en DESTINASJON**, og et kort oppå den gjør steget like
  umulig som et kort oppå målet. `clear()` på steget gir det ekstra elementet
  (kategorien i `drag_into_cat`); plasseringen regnes på rektangelet som rommer
  begge, mens pilspissen fortsatt peker på det brukeren skal ta tak i.
- **Objektmenyen holdes alltid fri.** Den åpner seg MENS et steg pågår (målet er
  menyknappen, men handlingen ligger i en rad inne i popoveren), så den kan ikke
  stå i `clear()`. `placeTour()` legger den derfor inn i frisonen automatisk når
  den er åpen, og `openObjMenu`/`closeObjMenu` plasserer kortet på nytt.

**Instruksjonen vises aldri før navigasjonen er ferdig.** `demoReady()` krever at
riktig modal er åpen/lukket OG at målet finnes og er synlig; til da står kortet
skjult (`demoHideCard()`). Uten den regelen dukket neste kort opp mens
Områder og mapper-modalen fortsatt lukket seg, og pilen pekte på en knapp som lå
bak modalens uskarphet.

**Tastatur og fokus.** Fokus flyttes til den EKTE kontrollen, så Enter der
utfører handlingen uten at brukeren må lete. Vi rører aldri fokus mens brukeren
skriver. Teksten ligger i et `aria-live="polite"`-område.

**Reduser bevegelse.** `prefersReducedMotion()` gjør rullingen til målet
momentan; CSS-transisjonene nøytraliseres av den globale
`prefers-reduced-motion`-blokken i `styles.css`.

**Laget** ligger på z-index 295 — over lagringsstatusen, under toasten og
oppdateringsbanneret. `updateSafety()` regner en åpen demo som «ikke trygt å
laste på nytt», så den automatiske klient-oppdateringen ikke river den ned midt
i et steg.

## Å gå tilbake

«Tilbake» går ETT steg tilbake og **nullstiller det man gjorde der**, slik at
handlingen kan gjøres om. `demoSnaps[i]` er en dyp kopi av kulissen slik den så
ut da steg `i` begynte (objekter, aktive pekere, gravsteiner og
demo-konteksten); `demoApplySnapshot()` legger den tilbake, og `demoApplyUi()`
setter modalene slik steget forutsetter. Tellerne (`demoBase`) regnes på nytt
etterpå, ellers ville et drag-steg sett et gammelt slipp som sitt eget.

Et navnesteg får i tillegg navnefeltet sitt tilbake (`reopen`). Objektet ble
opprettet med et standardnavn av steget FØR, så uten det ville steget vært
oppfylt i det øyeblikk man kom til det — og «Tilbake» sprettet rett fram igjen.

Den samme mekanikken er sikkerhetsnettet: faller `premise()` — typisk fordi en
navngiving ble avbrutt og raden forsvant igjen — rulles demoen tilbake til
steget som LAGER raden (`rewind`), med tilstanden fra da.

## Stegene

36 steg. Ett fortellesteg i hver ende (velkomst og avslutning, med en knapp som
driver dem videre); resten er handlingssteg som må utføres.

| # | Steg (`id`) | Pilspiss | Fullføres når |
|---|---|---|---|
| 1 | `welcome` | — (midtstilt, modal) | «Kom i gang» |
| 2 | `open_nav` | `#nav-crumb` | oversikten er åpen |
| 3 | `create_area` | `.nav-add-uni button` | et område finnes |
| 4 | `name_area` | områdets navnefelt | navnet er bekreftet |
| 5 | `create_folder` | ＋ i områdekortet | en mappe finnes |
| 6 | `name_folder` | mappens navnefelt | navnet er bekreftet |
| 7 | `open_folder` | mapperaden | mappen er aktiv OG oversikten lukket |
| 8 | `create_list` | `#add-card-btn` | en liste finnes |
| 9 | `name_list` | listens navnefelt | navnet er bekreftet |
| 10 | `create_item` | grønn ＋ i listen | et listepunkt finnes |
| 11 | `name_item` | listepunktets navnefelt | navnet er bekreftet |
| 12 | `create_item2` | grønn ＋ i listen | to listepunkter finnes |
| 13 | `name_item2` | listepunktets navnefelt | begge har navn |
| 14 | `drag_item` | nederste listepunkt | et vellykket slipp |
| 15 | `create_list2` | `#add-card-btn` | liste nummer to finnes |
| 16 | `name_list2` | listens navnefelt | navnet er bekreftet |
| 17 | `drag_list` | den nye listens overskrift | et vellykket slipp |
| 18 | `create_cat` | gul ＋ i listen | en kategori finnes |
| 19 | `name_cat` | kategoriens navnefelt | navnet er bekreftet |
| 20 | `drag_into_cat` | et listepunkt (kortet holder seg unna kategorien) | et punkt ligger i kategorien |
| 21 | `create_cat_item` | ＋ inne i kategorien | ett medlem til |
| 22 | `name_cat_item` | navnefeltet | alle medlemmer har navn |
| 23 | `dissolve_cat` | radens menyknapp → «Løs opp kategorien» | kategorien er borte |
| 24 | `delete_item` | radens menyknapp → «Slett listepunktet» | noe ligger i søppelkassen |
| 25 | `open_item_trash` | listens søppelkasse | søppelkasse-modalen er åpen |
| 26 | `restore_item` | «Gjenopprett» | kassen er tom |
| 27 | `close_item_trash` | `#trash-close` | modalen er lukket |
| 28 | `delete_item2` | radens menyknapp → «Slett listepunktet» | noe ligger i søppelkassen |
| 29 | `empty_item_trash` | listens søppelkasse | listepunktet er borte for godt |
| 30 | `delete_list` | korthodets menyknapp → «Slett listen» | listen er i søpla |
| 31 | `empty_card_trash` | `#trash-btn` | listen er borte for godt |
| 32 | `open_nav2` | `#nav-crumb` | oversikten er åpen |
| 33 | `delete_area` | områdekortets menyknapp → «Slett området for alle» | området er i søpla |
| 34 | `empty_uni_trash` | `#uni-trash-btn` | området er borte for godt |
| 35 | `close_nav` | `#nav-modal-close` | oversikten er lukket |
| 36 | `finish` | `#account-btn` | «Ferdig» |

Tre steg (29, 31, 34) demonstrerer **hold-og-sveip**-tømmingen; de sier det i
klartekst, siden et kort trykk der ville åpnet modalen i stedet. Mappen slettes
ikke i sitt eget steg: den følger med området i steg 33, og slette-krysset er
det samme på begge nivåene.

Et steg kan si `needsNav`, `needsTrash` eller `trashModal`: det er
forutsetningene `demoReady()` og `demoApplyUi()` leser.

## Hva som lagres, og hvor

På **kontoen**, i `user_metadata` — samme mekanikk som den huskede posisjonen
(`nav`, se `docs/accounts.md`), og derfor uten en eneste ny kolonne i databasen:

```js
user_metadata.onboarding = { v: 3, status: 'done' | 'skipped' }
user_metadata.tips = { drag: true, trash: true, moveList: true, swipeDelete: true }
```

Bare utfallet lagres, og bare når runden er over. Demoen er en simulering, ikke
et arbeid som skal kunne gjenopptas: det finnes ingen halvferdig kulisse å komme
tilbake til på en annen enhet. Avbryter man midt i (reload, lukket fane), får man
tilbudet igjen neste gang — det er billigere enn å late som noe ble sett.

Skrivingen er optimistisk: `authUser.meta` oppdateres først (så ingenting gjentar
seg i denne økten), og `auth.updateUser({ data })` går i bakgrunnen med ett nytt
forsøk ved feil. Retryen er bundet til **bruker-id-en** den ble startet for:
Supabase kan gå fra én innlogget bruker til en annen mens forsøket venter, og da
ville merket stemplet DERES demo som sett.

## Eksisterende brukere (migreringsregelen)

Regelen står i `onboardingSeen()`, og den er **versjonert**: markøren teller
først fra og med `v: 3`.

- Den som kom gjennom v1 (den passive omvisningen) eller v2 (innføringen i egne
  data) har aldri sett DENNE runden, og får den tilbudt neste gang hen går inn i
  appen. Det koster dem ingenting: demoen rører ikke innholdet deres, og ✕ takker
  nei for godt.
- Kun en konto med `v: 3` + `done`/`skipped` regnes som ferdig.

`TOUR_VERSION` skal bare økes hvis ALLE — også de som er ferdige — skal gjennom
en ny runde.

## «Vis på nytt»

Konto-modalen har raden **«Demonstrasjon av Huskis»** (`#menu-tour`) med knappen
«Vis på nytt» (`#tour-restart`). Den lukker konto-modalen først — demoen peker på
appen BAK den — og starter fra steg 1. Det finnes ingen egen repetisjonsmodus
lenger: demoen er den samme for alle, hver gang, fordi den uansett kjører på sine
egne kulisser.

## Inviterte og delte kontoer

- Demoen bygger i sin egen simulering, som ingen andre har noe med. Den kan
  derfor ikke havne i en låst mappe eller be en gjest skrive i noe hen bare kan
  lese — og trenger ingen rettighetssjekk per steg.
- Konto-knappen (med invitasjonsbadgen) er dempet og avskrudd mens demoen står
  på, som resten av appen. Invitasjonen ligger der etterpå.

## Tipsene om de avanserte gestene

Gester som ikke trengs for å komme i gang, læres bort **når de blir relevante** —
ett kort tips i den vanlige toasten, aldri mer enn ett om gangen:

| Nøkkel | Vises når | Innhold |
|---|---|---|
| `trash` | liste-søppelkassen er synlig | hold på søppelkassen og sveip for å slette alt i den |
| `drag` | mappen har ≥ 2 lister | hold på (eller dra) en tittel for å flytte |
| `swipeDelete` | mappen har ≥ 1 liste OG enheten har grov peker (`pointer: coarse`) | sveip en tittel mot høyre for å slette den |
| `moveList` | mappen har ≥ 1 liste og området ≥ 2 mapper | dra en liste opp på navigasjonsknappen for å flytte den |

`swipeDelete` er betinget av pekertypen fordi gesten er armert kun for touch og
pen — se `docs/menus.md` («Sveip tittelen for å slette»). På desktop er
objektmenyen den raske veien, og et tips om en gest som ikke finnes der ville
vært direkte misvisende.

`showTip()` viser ingenting hvis det ville kostet brukeren noe: før demoen er
ferdig (tipset huskes og kommer etterpå), midt i en redigering eller et drag,
mens en modal står åpen, mens en annen melding allerede vises — en slette-toast
med «Angre» skal aldri fortrenges — eller før det har gått `TIP_QUIET_MS` siden
forrige tips. **Et tips regnes som sett først når det faktisk er vist**, så et
undertrykt tips kommer igjen ved neste anledning.

Toasten får klassen `.toast-tip`, som lar teksten brekke over flere linjer i
stedet for å kappes med ellipsis. Alt annet er en helt vanlig toast: den fanger
ikke fokus og kan sveipes bort.

**Hold tipsene korte.** Toasten står nederst på skjermen, og en lang setning
brekker til en blokk som på mobil dekker akkurat den nederste lista — der
fingeren skal ta tak. Én linje er målet, to er taket.

## Endrer du noe her

- Endrer du hvilke steg som finnes, eller hva de peker på: `DEMO_STEPS` i
  `app.js` er hele definisjonen (`id`, `title`, `html`, `target`, `done`,
  `premise`, `rewind`, `reopen`, `clear`, `needsNav`, `needsTrash`, `trashModal`,
  `cta`).
  Oppdater tabellen over i samme endring.
- **Et nytt handlingssteg trenger en `done()` som leser TILSTAND**, ikke en
  klikkhåndterer. Leser den DOM-en i stedet for `state`, har du bygget et
  knappetrykk med ekstra steg.
- **Et steg som fjerner noe trenger ingen `premise()` på det det fjerner** — og
  gir du det en, må `done()` fortsatt være sann i samme øyeblikk.
- **Et nytt navnesteg trenger en `reopen()`** hvis objektet opprettes med et
  standardnavn; ellers spretter «Tilbake» rett fram igjen.
- Flytter eller omdøper du et element et steg peker på, kommer steget aldri i
  gang: `demoReady()` krever et synlig mål, og kortet blir stående skjult.
  `tests/onboarding.test.js` kjører hele runden og fanger det.
- Nye tips skal ha en tydelig «nå er den relevant»-utløser, ikke en timer — og
  en tekst som får plass på én linje (se over). Legg nøkkelen i `TIPS`; den
  brukes også av `__huskis.tour.skipAll()`, som andre tester slår av HELE
  introduksjonen med (`tests/CLAUDE.md`).
