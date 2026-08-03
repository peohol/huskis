# Tilgjengelighet

Les denne når oppgaven berører farger, fokus, tastatur, skjermlesere eller
navnene på kontroller. Autoritativ for tilgjengelighetskravene; det visuelle
uttrykket ellers ligger i `design-system.md`.

Målet er **WCAG 2.2 nivå AA**. Kravene under er ikke råd — de er håndhevet av
tester, og der en test ikke rekker, av en manuell sjekkliste.

## Grunnregelen: peker først, tastatur likestilt

Dra-og-slipp er fortsatt den **primære hurtigmekanismen**. Ingenting i dette
dokumentet skal gjøre den vanlige arbeidsflyten tregere:

- Ingen synlige tekstetiketter ved ikonene. Navnet ligger i `aria-label`, som
  koster null piksler. Etiketter ved hvert ikon ville gjort listevisningen mer
  overfylt og tregere å lese for alle andre.
- Hyppige handlinger ligger ikke i menyer. Sortering er ett tastetrykk
  (`Alt`+pil), ikke et menyvalg. Kun flytting til en NY forelder åpner en
  velger — og det er den samme velgeren draget allerede åpner.
- Ingen nye kontroller i board-et. Tastaturhåndtaket er nøyaktig den sonen
  musen drar i, så det finnes ingen ekstra knapp å hoppe over.

## Kontrast (`tests/a11y-contrast.test.js`)

Fargetokenene i `styles.css` er en **kontrakt**, ikke smaksvalg. Testen leser
tokenene ut av fila og regner ratioene på nytt, så en endret farge fanges med
én gang.

| Krav | Verdi |
|---|---|
| Hvit tekst på `.btn-green` / `.btn-red` | ≥ 4.5:1 mot **begge** gradient-endene |
| `.btn-yellow` | bærer **mørk** tekst (`--ink`), ikke hvit — se under |
| `--danger` / `--warn` / `--primary` / `--ink-soft` som tekst på hvit | ≥ 4.5:1 |
| `--focus` mot enhver flate ringen kan havne på | ≥ 3:1 |
| `--focus-on-dark` mot toast/oppdateringsbanner | ≥ 3:1 |
| Ikonstreken `#111` mot enhver flate | ≥ 3:1 |

**Hvorfor gult har mørk tekst.** En gul flate som gir 4.5:1 mot hvit tekst er
ikke gul lenger — den er oliven (`#936e18`). Valget står mellom å miste fargen
eller å bytte tekstfarge; appen beholder gulfargen og setter teksten til
`--ink`. `text-shadow` slås av samtidig: skyggen finnes for å løfte hvit skrift
fra en lys flate, og under mørk tekst gjør den bare bokstavene uskarpe.

**Hvorfor fokusringen ikke er brand-grønn.** Den grønne ringen lå på 1,2:1 mot
board-bakgrunnen og mot de grønne palettfargene — altså usynlig nettopp der den
trengtes. `--focus` (`#10131a`) klarer ≥ 3:1 mot alt: hvit, board-bakgrunnen,
alle seks palettfarger og alle tre knappefarger. De hvite ringene på
korthodene falt gjennom på tre av seks kortfarger og er borte.

Testen vokter i tillegg at **ingen** `:focus-visible`-regel maler ringen i noe
annet enn `--focus`/`--focus-on-dark`, og at de pensjonerte fargeverdiene ikke
finnes noe sted i kildetreet.

## Navn på kontroller

Alle ikonknapper har `aria-label`. `title` settes ved siden av som musehjelp,
men teller aldri alene: den leses ikke av alle skjermlesere, og på touch finnes
den ikke.

Navnet er **presist** — det inneholder objektets navn, ikke bare handlingen.
«Slett listepunkt» tjue ganger på rad forteller ingenting; «Slett listepunktet
«Kjøp melk»» gjør det. Navnene settes i `label*Controls()` i hver `build*`-
funksjon (`app.js`) og settes **på nytt etter omdøping**, så de aldri blir
stående på gammel tekst.

## Tastatur

Håndtaket er objektets navn-/tittelsone — samme element `attachHoldDrag` får,
koblet med `attachKeyHandle`. Snarveiene virker på det som har fokus, og står
oppført i konto-modalen (`.menu-keys`).

| Tast | Virkning |
|---|---|
| `Alt` + `↑` / `↓` (og `←` / `→`) | flytt objektet ett hakk — **sortering** |
| `Alt` + `M` | «Flytt til …» — ny forelder |
| `F2` | endre navn (`Enter` gjør det samme på en rad) |
| `Enter` / `Mellomrom` | på et korthode: kollaps/utvid. På en grupperad: naviger |
| `Escape` | lukk øverste modal — eller avbryt en navneendring |

**Sortering = bytt plass.** `Alt`+pil bytter objektet med naboen, som er
nøyaktig dra-motorens egen semantikk («≥ 20 % overlapp bytter plass»,
`drag-and-drop.md`). Et listepunkt som passerer en kategorigrense havner derfor
INNE i kategorien, og medlemmet det passerte havner utenfor — de bytter faktisk
plass. Posisjonen skrives med samme regel som ved et slipp: objekter med
`_canon` (universer og frie grupper) har personlig rekkefølge og går via
`cloudPersonalPos`, alt annet stemples i synk-doc'et.

**Rettigheter gates likt som draget.** `canReorderObj` speiler `canDrag` på hvert
nivå, og feiler LUKKET: mangler capability-en, skjer ingenting og brukeren får
beskjed i live-området.

`Alt`+`M` sjekkes på `ev.code === 'KeyM'`, ikke `ev.key` — på macOS gir `Alt`+`M`
tegnet «µ».

## To bevisste avveininger

**Korthodet er `role="button"`, og det koster `<h2>`-en.** En knapp har
presentasjonelle barn, så overskriften inne i `.card-head`/`.cat-head` er ikke
lenger et hopp-mål for «neste overskrift». Byttet er verdt det: uten rollen kan
man ikke kollapse eller flytte en liste uten peker, og tittelen leses fortsatt —
den ER knappens navn. Strukturnavigeringen er gitt tilbake ved at `<article
class="card">` har `aria-label` («Listen «Handleliste»»), altså en navngitt
region i stedet for en overskrift. Nav-modalen har hatt dette oppsettet hele
tiden; listevisningen følger nå etter, så de to nivåene oppfører seg likt.

**Radene har ingen `aria-label`.** Et `listitem` med navn får innholdet sitt
erstattet av navnet, og da forsvinner indikator-chipene (ansvarlig, start,
frist) fra opplesningen. Teksten i raden er navnet; knappene inni har sine egne.

**Det svarte ＋-ikonet på de grønne knappene** ligger på 3,5:1 mot den nye,
mørkere grønnfargen — over kravet på 3:1 for grafiske objekter, men lavere enn
før. Alternativet var et hvitt ikon (5,4:1), som ville brutt regelen om at hele
ikonsettet har svart strek (`design-system.md`). Konsistensen vant, kravet er
oppfylt.

## Fokus

- **Modaler og popovere** (`.modal-overlay`, `.switcher-overlay`): fokus flyttes
  INN ved åpning, `Tab` holdes INNE mens de er åpne, og fokus går TILBAKE til
  elementet som åpnet dem. Koblingen er én `MutationObserver` per overlay på
  `hidden` — ikke endringer i de ni åpne-/lukkefunksjonene, som skjuler
  modalene fra for mange steder til at en av dem kan holdes i synk manuelt.
  Åpne-kode som allerede flytter fokus selv (bekreftelsesdialogen, sveipefeltet,
  innstillingsmodalen) får beholde sitt eget valg.
- **Omvisningen** har sin egen felle fra før (`docs/introduksjon.md`) og røres
  ikke av dette; `Tab`-fellen over trekker seg unna mens den er aktiv.
- **Etter en rendring**: `renderBoard()`/`renderNav()` bygger fra bunnen, så
  `captureFocusIn()` noterer hvor fokus sto FØR nedrivingen og
  `applyFocusIntent()` setter det på den nye noden. Dette gjelder ikke bare
  tastaturflyttinger: hver bakgrunnssynk som lander kaller `render()`, og uten
  dette ville fokus falt til `<body>` med noen sekunders mellomrom mens man
  jobber.
- **Etter sletting/oppløsning**: `focusTargetAfterRemoval()` velger naboen under,
  ellers naboen over, ellers ＋-knappen i containeren. Kalles FØR objektet
  forsvinner.

## Bevegelse

`prefersReducedMotion()` og `@media (prefers-reduced-motion: reduce)` gjelder
alle animasjoner — se `design-system.md`. Ingen `user-scalable=no`.

## Berøringsflater

Kontrollene skal aldri krympe. `tests/a11y-runtime.test.js` måler dem i
nettleseren og holder dagens mål som gulv (`.icon-btn`/`.card-cog`/`.cat-cog`
36px, `.item-cog` 27px, `.item-check` 26px, `.btn-add` 34px, `.crumb-btn` 49px),
og krever i tillegg WCAG 2.2 «Target Size (Minimum)»: alt ≥ 24×24 px.

## Manuelle kontrollpunkter

Det automatiske dekker navn, tastaturmekanikk, fokusflyt, mål og kontrast.
Det gjør IKKE opplevelsen. Gå gjennom denne lista når endringen berører
navigasjon, en ny kontroll, en ny modal eller dra-og-slipp:

### Tastatur (uten mus, uten skjermleser)

1. `Tab` fra toppen av siden: går fokus gjennom UI-et i den rekkefølgen det
   leses, uten å hoppe bakover?
2. Er fokusringen synlig på **hver eneste** stopp — også over et fargesterkt
   kort, over en grønn knapp og i den gule delen av del-modalen?
3. Kan du opprette, navngi, krysse av, omdøpe, sortere, flytte og slette et
   listepunkt uten å røre musen?
4. Kan du gjøre det samme på alle fire nivåene (univers, gruppe, liste,
   listepunkt)?
5. Åpne en modal: havner fokus inni? Kommer du deg IKKE ut med `Tab`? Lander
   fokus tilbake på knappen du åpnet fra når du lukker med `Escape` og med ✕?
6. Med to modaler oppå hverandre (del-modal over nav-modal): lukker `Escape` én
   om gangen, og følger fokus med nedover?
7. Slett den siste raden i en liste: forsvinner fokus, eller lander det et sted
   du kan fortsette fra?
8. Start en omdøping og trykk `Escape`: avbrytes bare redigeringen — ikke også
   modalen bak?

### Skjermleser (VoiceOver på macOS/iOS, NVDA på Windows, TalkBack på Android)

9. Gå gjennom en liste med tjue rader: sier hver slettknapp HVILKEN rad den
   gjelder, eller høres de like ut?
10. Omdøp et objekt og gå tilbake til knappene: leses det NYE navnet?
11. Flytt et objekt med `Alt`+pil: blir flyttingen lest opp, med navn og ny
    plass?
12. Åpne en modal: leses dialogens overskrift, og oppleves innholdet bak som
    borte?
13. Er de tre delte ✕-ene (lukk / slett / forlat) mulige å skille fra
    hverandre på navnet alene?
14. Er alt som bare er dekorasjon (ikoner inne i en navngitt knapp) `aria-hidden`,
    slik at navnet ikke leses dobbelt?

### Syn og farge

15. Sett operativsystemet i høykontrastmodus: forsvinner noe?
16. Zoom nettleseren til 200 %: er alt fortsatt nåbart, uten horisontal scroll?
17. Se på appen i gråtoner: kan du fortsatt skille «gjort» fra «ikke gjort»,
    og en advarsel fra en feil? (Farge skal aldri være eneste bærer av mening —
    statuslinjas prikk har alltid tekst ved siden av.)

## Kjøre testene

```bash
node tests/a11y-contrast.test.js                        # tokens, ingen nettleser
NODE_PATH=$(npm root -g) node tests/a11y-runtime.test.js # navn, tastatur, fokus, mål
```
