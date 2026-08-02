# Introduksjon for nye brukere: omvisningen og de kontekstuelle tipsene

Les denne når oppgaven berører førstegangsopplevelsen — omvisningen som vises
etter første innlogging, spotlight-markeringene, «Vis på nytt» i konto-modalen,
eller tipsene som lærer bort de avanserte gestene. Koden ligger i `app.js`,
seksjonen «INTRODUKSJON FOR NYE BRUKERE».

Prinsippet er todelt, og de to delene har med vilje ulik tyngde:

| | Omvisningen | Tipsene |
|---|---|---|
| Når | én gang, etter første vellykkede innlogging | første gang gesten er relevant |
| Hva | de fem tingene man må vite for å komme i gang | én avansert gest om gangen |
| Form | modalt kort + spotlight på ekte UI | vanlig toast, ikke-modal |
| Avsluttes av | Ferdig, Hopp over, ✕ eller Escape | timeren, «Skjønner» eller et sveip |

## Omvisningen (`#tour`)

Fem steg, aldri flere. Hvert steg peker på **ekte UI**, ikke på en tegning av
det: `.tour-spot` legges oppå elementet med en enorm `box-shadow`-spredning som
demper alt utenfor (samme grep som bilderedigererens `.avatar-mask`), så hullet
i sceneteppet ER knappen man skal lære. Kortet plasseres under målet når det er
plass, ellers over, ellers midt på skjermen.

| # | Steg | Spotlight |
|---|---|---|
| 1 | Hierarkiet: univers → gruppe → liste → listepunkt, og kategorier | — (midtstilt) |
| 2 | Navigasjonsknappen/breadcrumben: hvor du er, og veien til universer og grupper | `#nav-crumb` |
| 3 | Slik lages en liste | `#add-card-btn` |
| 4 | Grønn ＋ = listepunkt, gul ＋ = kategori | `.add-item-row` i første liste |
| 5 | Endre navn, flytte (hold/dra) og slette | `.card-head` i første liste |

**Et steg uten mål er ikke et hull i omvisningen.** En helt fersk konto har
verken grupper eller lister, så steg 4 og 5 har ingenting å peke på. Da demper
`.tour.no-spot` hele flaten og kortet midtstilles — teksten gjelder like fullt,
og omvisningen kan tas om igjen fra konto-modalen når innholdet finnes. Det
samme gjelder et mål som ikke er tegnet: `tourTargetFor()` godtar kun elementer
som faktisk har en boks (`getClientRects()`) — et `display:none`-element blir til
et steg uten spotlight i stedet for en ring i lufta. Et mål som bare er rullet
ut av syne rulles inn igjen (`scrollIntoView`), og `placeTour()` slår elementet
opp på nytt hvis en synk-runde har tegnet board-et om under omvisningen.

**Styring:** «Neste»/«Tilbake» (siste steg heter «Ferdig»), «Hopp over», ✕ og
Escape. Piltast høyre/venstre blar. Fokus flyttes til kortet når omvisningen
åpner, og blir så stående på knappen man trykker — teksten ligger i et
`aria-live="polite"`-område, så skjermleseren leser opp det nye steget uten at
fokus rykker. Tab holdes inne i kortet (fokusfelle), og fokus går tilbake dit
det kom fra når omvisningen lukkes. `prefersReducedMotion()` gjør rullingen til
målet momentan; CSS-transisjonene nøytraliseres av den globale
`prefers-reduced-motion`-blokken i `styles.css`.

**Laget** ligger på z-index 295 — over lagringsstatusen, under toasten og
oppdateringsbanneret — og tar imot klikk som en modal-overlay, så et bomtrykk
på scenen ikke utløser noe i appen bak. Spotlighten posisjoneres på nytt ved
`resize` og `scroll` (capture), siden siden bak fortsatt kan rulle.
`updateSafety()` regner en åpen omvisning som «ikke trygt å laste på nytt», så
den automatiske klient-oppdateringen ikke river den ned midt i.

## Tipsene om de avanserte gestene

Gester som ikke trengs for å komme i gang, læres bort **når de blir relevante** —
ett kort tips i den vanlige toasten, aldri mer enn ett om gangen:

| Nøkkel | Vises når | Innhold |
|---|---|---|
| `trash` | liste-søppelkassen er synlig | hold inne søppelkassen og sveip for å tømme |
| `drag` | gruppen har ≥ 2 lister | hold på (eller dra) en tittel for å flytte |
| `moveList` | gruppen har ≥ 1 liste og universet ≥ 2 grupper | dra en liste opp på navigasjonsknappen |

`showTip()` viser ingenting hvis det ville kostet brukeren noe: under
omvisningen (tipset huskes og kommer etterpå), midt i en redigering eller et
drag, mens en modal står åpen, mens en annen melding allerede vises — en
slette-toast med «Angre» skal aldri fortrenges — eller før det har gått
`TIP_QUIET_MS` siden forrige tips. **Et tips regnes som sett først når det
faktisk er vist**, så et undertrykt tips kommer igjen ved neste anledning.

Toasten får klassen `.toast-tip`, som lar teksten brekke over flere linjer i
stedet for å kappes med ellipsis. Alt annet er en helt vanlig toast: den fanger
ikke fokus, dekker ingenting man trenger, og kan sveipes bort.

## Hva som lagres, og hvor

Begge deler ligger på **kontoen**, i `user_metadata` — samme mekanikk som den
huskede posisjonen (`nav`, se `docs/accounts.md`), og derfor uten en eneste ny
kolonne i databasen:

```js
user_metadata.onboarding = { v: 1, status: 'done' | 'skipped' }
user_metadata.tips        = { drag: true, trash: true, moveList: true }
```

- `status` skiller kun for statistikkens skyld: **begge** betyr «sett», så
  omvisningen ikke dukker opp igjen på neste enhet.
- `v` sammenlignes med `TOUR_VERSION`. Skal omvisningen vises på nytt for alle
  (fordi den er skrevet om), er det ett tall som skal økes.
- Skrivingen er optimistisk: `authUser.meta` oppdateres først (så ingenting
  gjentar seg i denne økten), og `auth.updateUser({ data })` går i bakgrunnen
  med ett nytt forsøk ved feil. Lander den aldri, dukker omvisningen heller opp
  igjen ved neste innlogging enn at vi later som den er sett.

## «Vis på nytt»

Konto-modalen har raden **«Introduksjon til Huskis»** (`#menu-tour`) med
knappen «Vis på nytt» (`#tour-restart`). Den lukker konto-modalen først —
omvisningen peker på appen BAK den — og starter fra steg 1. Det lagrede
«sett»-merket røres ikke; fullfører man runden, skrives det bare på nytt.

## Endrer du noe her

- Endrer du hvilke steg som finnes, eller hva de peker på: `TOUR_STEPS` i
  `app.js` er hele definisjonen (tittel, tekst, selektor). Oppdater tabellen
  over i samme endring.
- Flytter eller omdøper du et element et steg peker på (`#nav-crumb`,
  `#add-card-btn`, `.add-item-row`, `.card-head`), faller steget stille tilbake
  til midtstilt — `tests/onboarding.test.js` fanger det.
- Nye tips skal ha en tydelig «nå er den relevant»-utløser, ikke en timer.
