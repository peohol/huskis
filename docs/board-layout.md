# Listevisningen (board): luft-system

Les denne når oppgaven berører avstander/padding/gap i selve listevisningen
(kolonnene med lister/kort), IKKE menyene rundt (se `docs/menus.md`).

**Ett tall, `--board-gap` (`clamp(12px, 4vw, 40px)`), styrer ALL luft i board-et**
— venstre/høyre-padding på `.app-main`, kolonne-gap (`.board`), og kort-til-kort-
avstand (`.card`s `margin-bottom`). Samme variabel overalt → luften er alltid
identisk, uansett viewport-bredde (verdien er responsiv, men leses fra ÉN kilde).
Endres `--board-gap`, følger ALT automatisk med — ikke hardkod en egen verdi
noe sted i board-et.

## Bunn

`.app-main` har `padding-bottom: 0` — luften under SISTE kort kommer fra
kortets EGEN `margin-bottom` (samme `--board-gap`), ikke fra en egen
bunn-padding (det ville lagt gap oppå gap).

**Kvirk:** multi-column-layouten (`column-fill: balance`, default) kan
imidlertid **ignorere nettopp den margin-en** når den regner ut board-ets
auto-høyde ved ujevnt balanserte kolonner (bidrar 0 i noen kolonnefordelinger,
hele verdien i andre — en kjent nettleser-kvirk, ikke noe vi kan style oss vekk
fra). Bekreftet empirisk under utvikling: en statisk `padding-bottom` (verken på
`.app-main` eller `.board`) gir riktig luft i det ene tilfellet og DOBBEL luft i
det andre.

**Løsning:** `fixBoardBottomGap()` i app.js MÅLER det faktiske utfallet per
render (nullstiller `.board`s `padding-bottom`, tvinger reflow, sammenligner
board- og siste-korts bunnkant) og legger på akkurat nok padding til at total
bunn-luft alltid blir nøyaktig `--board-gap` — aldri mer, aldri mindre. Kalles
ved hver `render()` og ved vindus-resize.

**Ikke «forenkle» dette til en ren CSS-regel** uten å re-teste med et ODDETALL
kort som gir ujevnt balanserte kolonner (f.eks. 3 kort ved en bredde som gir
nøyaktig 2 kolonner) — det er nettopp det scenarioet som avslører kvirken.

## Topp

`.app-main`s `padding-top` settes IKKE via CSS `calc()`, men regnes ut i JS
(`syncHeaderHeight`, samme funksjon som måler `--header-h`/`--toolbar-h`):
eksakt meny-høyde (mobil: gruppemeny + listemeny; desktop: kun listemeny, siden
gruppemenyen er en venstre-kolonne) **+ `--board-gap`**, satt som
`--board-pad-top`.

`--board-gap` kan IKKE leses direkte fra `:root` i JS (en `clamp()`/`vw`-custom-
property gir tilbake selve uttrykket som streng, ikke tallet den løses til) —
den leses derfor fra `.board`s FAKTISK OPPLØSTE `column-gap`
(`getComputedStyle(board).columnGap`), som ER et vanlig, oppløst tall.
Resultat: avstanden fra menyenes nedre kant til første kort er PIKSELNØYAKTIG
lik gapet ellers, ikke en tilnærmet verdi fra en separat `clamp()`.

## Mobil, én kolonne

`column-count: 1` (IKKE `column-width: 100%` — prosent er ugyldig for
`column-width` per spec og blir stille ignorert av nettlesere). Kortene
(`width: 100%`, base-regelen) fyller dermed hele den ene kolonnen → jevn luft
på alle sider siden `--board-gap` uansett brukes konsekvent.
