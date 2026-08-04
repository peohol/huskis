# Introduksjon for nye brukere: innføringen og de kontekstuelle tipsene

Les denne når oppgaven berører førstegangsopplevelsen — den interaktive
innføringen etter første innlogging, spotlight-stegene, «Vis på nytt» i
konto-modalen, eller tipsene som lærer bort de avanserte gestene. Koden ligger
i `app.js`, seksjonen «INTRODUKSJON FOR NYE BRUKERE».

Prinsippet er todelt, og de to delene har med vilje ulik tyngde:

| | Innføringen | Tipsene |
|---|---|---|
| Når | én gang, etter første innlogging på en konto uten onboardingmarkør | første gang gesten er relevant |
| Hva | brukeren bygger hele hierarkiet selv, ett nivå om gangen | én avansert gest om gangen |
| Form | kort + spotlight på ekte UI, som brukeren faktisk trykker på | vanlig toast, ikke-modal |
| Går videre av | at TILSTANDEN endret seg — aldri av et knappetrykk | timeren, «Skjønner» eller et sveip |
| Avsluttes av | Ferdig, Hopp over, ✕ eller Escape | timeren, «Skjønner» eller et sveip |

## Grunnprinsippet: tilstand, ikke klikk

Innføringen går **aldri** videre fordi en knapp ble trykket. Den går videre når
objektet steget ber om faktisk finnes i `state`, hos riktig forelder, med et
navn. Det er hele mekanikken, og den ligger i én funksjon: `tourObserve()`,
som kjøres på et tidsur (`TOUR_POLL_MS`) så lenge innføringen står på. Hvert
steg svarer på ett spørsmål — `done()` returnerer en context-patch når steget
ER utført, ellers `null`.

Et tidsur, ikke hendelseslyttere, er et bevisst valg: objektet kan dukke opp
fra en inline-navngiving, fra en synk-runde startet på en annen enhet, eller
fra en angret sletting. En liste over alle veiene dit ville råtnet; ett billig
spørsmål stilt om igjen råtner ikke.

Tre ting kan holde et steg tilbake selv om objektet finnes:

- **En åpen navngiving** (`.edit-input` i DOM-en) er handlingen som PÅGÅR.
  Uten den vakten ville ＋-knappen alene drevet innføringen videre:
  `addUniverse()` og «＋ Liste» oppretter objektet med et standardnavn og åpner
  navnefeltet, så objektet finnes allerede idet fingeren slipper knappen.
  Avbryter brukeren, forsvinner et nytt listepunkt/en ny gruppe igjen
  (`nameNewRow`) — og steget står der det sto.
- **En avvist skriving** (`syncStatus` i tilstanden `rejected`). Handlingen er
  ikke lagret på kontoen, og skal ikke kvitteres ut: brukeren ville ellers fått
  beskjed om at alt gikk bra, mens objektet forsvant ved neste innlogging.
  Frakoblet er ikke det samme — da ligger endringen trygt lokalt.
- **`tourBaseline`**, id-ene som fantes da steget begynte. Et univers brukeren
  allerede hadde (eller som en synk-runde drar inn fra en annen enhet) kan ikke
  fullføre steget på vegne av en handling som aldri ble utført.

## Stegene

Åtte steg. To av dem er **fortellesteg** (ingen handling å utføre), seks er
**handlingssteg**.

| # | Steg (`id`) | Spotlight | Fullføres når |
|---|---|---|---|
| 1 | `welcome` | — (midtstilt) | «Kom i gang» |
| 2 | `open_nav` | `#nav-crumb` | navigasjonsvisningen er åpen |
| 3 | `create_universe` | `.nav-add-uni button` | et NYTT univers med navn finnes |
| 4 | `create_group` | ＋ i universkortet | en NY gruppe med navn finnes i det universet |
| 5 | `open_group` | gruppens rad i oversikten | gruppen er `state.activeGroup` |
| 6 | `create_card` | `#add-card-btn` | en NY liste med tittel finnes i den gruppen |
| 7 | `create_item` | grønn ＋ i den nye listen | et ikke-tomt listepunkt finnes i den listen |
| 8 | `finish` | — (midtstilt) | «Ferdig» |

Steg 8 nevner kort det som IKKE er obligatorisk — gul ＋ (kategori), omdøping,
flytting, sletting og deling. Ingen av dem er et krav for å fullføre; de læres
kontekstuelt når de blir relevante (se tipsene under).

Et steg kan i tillegg si `needsNav`/`needsBoard`: da må oversikten være åpen
(eller lukket) for at målet skal finnes. Er den ikke det, står instruksjonen om
å åpne/lukke den i kortet i stedet, og steget venter — det låser seg ikke.

## Interaksjonsmodellen: ekte UI, ikke en kopi

Spotlighten er den samme som før — `.tour-spot` med en enorm
`box-shadow`-spredning som demper alt utenfor (samme grep som
bilderedigererens `.avatar-mask`), så hullet i sceneteppet ER kontrollen. Det
nye er hvem som tar imot pekeren:

- **Fortellesteg** (`.tour.narrated`) er modale: flaten tar imot klikk som en
  modal-overlay, kortet har `aria-modal="true"`, Tab holdes inne i kortet, og
  fokus står på kortet.
- **Handlingssteg** (`.tour.guided`) er det ikke, og kan ikke være det:
  handlingen skal utføres på det ekte UI-et. Laget slipper pekeren gjennom
  (`pointer-events: none`; bare kortet tar imot klikk), `aria-modal` fjernes
  (det ville vært en løgn overfor skjermleseren), og Tab går fritt ut i appen.

Det som holdes unna er ikke «alt», men **det destruktive**: `body.tour-guided`
slår av slette- og søppelkassekontrollene, så et bomtrykk ikke kan kaste noe
underveis — og ikke kan fjerne akkurat det objektet steget venter på.

**Tastatur og fokus.** På et handlingssteg flyttes fokus til den EKTE
kontrollen, så Enter der utfører handlingen uten at brukeren må lete. Fokus
følger med når målet tegnes på nytt (synk-runde) eller nettopp dukket opp — men
bare hvis det sto på den gamle noden eller ingen steder, og aldri mens brukeren
skriver. Teksten ligger i et `aria-live="polite"`-område, og `#tour-note` sier i
én linje hva som skal gjøres nå (eller hvorfor steget ennå ikke er kvittert ut).

**Escape** avslutter innføringen kun når fokus står i kortet, eller når steget
er modalt. Ellers hører Escape hjemme i appen: den avbryter en inline-navngiving
og lukker en modal. En capture-håndterer som slukte Escape uansett ville gjort
handlingsstegene umulige å angre seg ut av.

**Plassering.** Kortet legger seg aldri oppå målet — på et handlingssteg ville
det gjort steget umulig, siden fingeren traff kortet. Er det ikke plass til et
helt kort verken over eller under (smal skjerm, mål midt på), velges den største
luften, og kortet kappes til den og ruller innvendig. `placeTour()` slår
elementet opp på nytt hvis en synk-runde har tegnet board-et om, og
posisjonerer på nytt ved `resize` og `scroll` (capture).

**Reduser bevegelse.** `prefersReducedMotion()` gjør rullingen til målet
momentan; CSS-transisjonene nøytraliseres av den globale
`prefers-reduced-motion`-blokken i `styles.css`.

**Laget** ligger på z-index 295 — over lagringsstatusen, under toasten og
oppdateringsbanneret. `updateSafety()` regner en åpen innføring som «ikke trygt
å laste på nytt», så den automatiske klient-oppdateringen ikke river den ned
midt i et steg.

## Hva som lagres, og hvor

På **kontoen**, i `user_metadata` — samme mekanikk som den huskede posisjonen
(`nav`, se `docs/accounts.md`), og derfor uten en eneste ny kolonne i databasen:

```js
user_metadata.onboarding = {
  v: 2,
  status: 'in_progress' | 'done' | 'skipped',
  step: 'create_group',                       // stegets id
  context: { universeId, groupId, cardId },   // det stegene har opprettet
}
user_metadata.tips = { drag: true, trash: true, moveList: true }
```

- `status` skiller de tre tilstandene som betyr noe. **Ikke startet** er
  fraværet av feltet.
- `step` + `context` er nok til å gjenoppta etter reload, ny innlogging og på
  en annen enhet.
- Skrivingen er optimistisk: `authUser.meta` oppdateres først (så ingenting
  gjentar seg i denne økten), og `auth.updateUser({ data })` går i bakgrunnen
  med ett nytt forsøk ved feil. Retryen er bundet til **bruker-id-en** den ble
  startet for: Supabase kan gå fra én innlogget bruker til en annen mens
  forsøket venter, og da ville merket stemplet DERES introduksjon som sett.
  Lander skrivingen aldri, dukker innføringen heller opp igjen enn at vi later
  som den er sett.
- **Framdriften går aldri bakover.** `onboardingFloor` holder det høyeste steget
  økten har nådd, og `saveOnboarding()` skriver ikke et lavere. En
  metadatarespons som lander sent, eller en eldre tilstand fra en annen enhet,
  kan altså ikke kaste brukeren tilbake til et steg hen alt har gjort.
- **Slettede referanser låser ikke.** Peker `context` på et univers, en gruppe
  eller en liste som ikke finnes lenger, faller `tourResolveResume()` tilbake
  til det siste steget hvis forutsetninger fortsatt holder.

## Eksisterende brukere (migreringsregelen)

Regelen er én linje, og den står i `onboardingSeen()`: **et registrert `done`
eller `skipped` teller, uansett hvilken versjon som registrerte det.**

- Den som kom gjennom v1 (den passive omvisningen) blir altså ikke dratt inn i
  v2 automatisk — men kan hente den fram igjen med «Vis på nytt».
- Kun en konto **uten** onboardingmarkør regnes som reelt ny og starter den
  interaktive flyten av seg selv.
- En konto med `status: 'in_progress'` på `v: 2` gjenopptar der den slapp.

`TOUR_VERSION` skal bare økes hvis ALLE — også de som er ferdige — skal gjennom
en ny runde. Det er ikke det som skjedde ved overgangen fra v1 til v2.

## «Vis på nytt» og repetisjonsmodus

Konto-modalen har raden **«Introduksjon til Huskis»** (`#menu-tour`) med knappen
«Vis på nytt» (`#tour-restart`). Den lukker konto-modalen først — innføringen
peker på appen BAK den — og starter fra steg 1.

En etablert konto skal ikke måtte lage duplikater for å se innføringen igjen.
Derfor velges modus etter innholdet (`tourHasContent()`):

| Modus | Når | Hva stegene gjør |
|---|---|---|
| `practice` | ny konto, eller «Vis på nytt» på en konto uten grupper | krever at handlingen faktisk utføres |
| `review` | «Vis på nytt» på en konto som har minst ett univers med en gruppe | peker på det som ALLEREDE finnes, og oppretter ingenting |

I repetisjonsmodus kan hvert steg hoppes over («Hopp over steget») — runden er
frivillig hele veien. Velkomsten har i tillegg knappen «Øv med nye», som bytter
til `practice` for den som faktisk vil gjøre handlingene om igjen.

## Inviterte og delte kontoer

- Innføringen blokkerer ingenting: laget slipper klikk gjennom, så konto-knappen
  med invitasjonsbadgen er tilgjengelig hele veien, og en invitasjon kan godtas
  midt i et steg.
- Handlingsstegene bygger i brukerens **eget** univers, som alle kan opprette.
  Innføringen ber derfor aldri en gjest om å skrive i noe hen bare kan lese.
- Er et steg likevel umulig for kontoen — en låst gruppe, manglende
  `createGroup`/`createList` — sier `blocked()` fra i klartekst, og «Hopp over
  steget» dukker opp. Et steg brukeren ikke har lov til å løse skal ikke bli
  stående som en oppgave.

## Tipsene om de avanserte gestene

Gester som ikke trengs for å komme i gang, læres bort **når de blir relevante** —
ett kort tips i den vanlige toasten, aldri mer enn ett om gangen:

| Nøkkel | Vises når | Innhold |
|---|---|---|
| `trash` | liste-søppelkassen er synlig | hold på søppelkassen og sveip for å slette alt i den |
| `drag` | gruppen har ≥ 2 lister | hold på (eller dra) en tittel for å flytte |
| `moveList` | gruppen har ≥ 1 liste og universet ≥ 2 grupper | dra en liste opp på navigasjonsknappen for å flytte den |

`showTip()` viser ingenting hvis det ville kostet brukeren noe: før
introduksjonen er ferdig (tipset huskes og kommer etterpå), midt i en redigering
eller et drag, mens en modal står åpen, mens en annen melding allerede vises —
en slette-toast med «Angre» skal aldri fortrenges — eller før det har gått
`TIP_QUIET_MS` siden forrige tips. **Et tips regnes som sett først når det
faktisk er vist**, så et undertrykt tips kommer igjen ved neste anledning.

Toasten får klassen `.toast-tip`, som lar teksten brekke over flere linjer i
stedet for å kappes med ellipsis. Alt annet er en helt vanlig toast: den fanger
ikke fokus og kan sveipes bort.

**Hold tipsene korte.** Toasten står nederst på skjermen, og en lang setning
brekker til en blokk som på mobil dekker akkurat den nederste lista — der
fingeren skal ta tak. Én linje er målet, to er taket.

## Endrer du noe her

- Endrer du hvilke steg som finnes, eller hva de peker på: `TOUR_STEPS` i
  `app.js` er hele definisjonen (id, tittel, tekst, mål, `done`, `review`,
  `blocked`). Oppdater tabellen over i samme endring.
- **Et nytt handlingssteg trenger en `done()` som leser TILSTAND**, ikke en
  klikkhåndterer. Leser den DOM-en i stedet for `state`, har du bygget et
  knappetrykk med ekstra steg.
- Flytter eller omdøper du et element et steg peker på (`#nav-crumb`,
  `.nav-add-uni button`, `.add-item-row .add-item-btn`, `#add-card-btn`),
  faller steget stille tilbake til midtstilt uten spotlight —
  `tests/onboarding.test.js` fanger det.
- Nye tips skal ha en tydelig «nå er den relevant»-utløser, ikke en timer — og
  en tekst som får plass på én linje (se over). Legg nøkkelen i `TIPS`; den
  brukes også av `__huskis.tour.skipAll()`, som andre tester slår av HELE
  introduksjonen med (`tests/CLAUDE.md`).
