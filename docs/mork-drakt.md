# Lys og mørk drakt

Les denne når oppgaven berører fargevalg, `styles.css`-tokens, ikonfarger eller
palettfargene på kort og rader.

Appen har to drakter: **lys** (som før) og **mørk**. Brukeren velger selv, også
før innlogging.

## Valget

| Verdi | Betyr |
|---|---|
| `system` (standard) | følger operativsystemets `prefers-color-scheme`, og skifter med det mens appen står åpen |
| `light` | lys drakt uansett hva systemet sier |
| `dark` | mørk drakt uansett hva systemet sier |

Valget ligger i `localStorage['huskis-theme']` og **bare der**. Det er
enhetens, ikke kontoens — i motsetning til språket
([`sprak.md`](sprak.md)), som også ligger på kontoen fordi serveren trenger
det til invitasjons-e-postene. Drakten hører til skjermen man sitter foran og
lyset i rommet; den har ingen serverside-effekt, og to enheter kan gjerne stå
forskjellig. Derfor ingen `user_metadata`, ingen synk og ingen fletting.

Kontrollen er den samme to steder, som språkvelgeren
([`menus.md`](menus.md)): en `<select>` i konto-modalen (`#theme-select`, en
`.menu-setting`-rad utenfor trekkspillet) og en på innloggingsskjermen
(`#auth-theme-select`). Et bytte laster **ikke** siden på nytt — drakten bor i
CSS-tokens og i kortfargene, og begge deler males på plassen sin.

## `theme.js` lastes i `<head>`

Fila er søsteren til `i18n.js`: ren tilstand, ingen avhengigheter, rører bare
`<html data-theme>`, `<meta name="theme-color">` og den lagrede verdien. Den
eksponerer `window.HUSKIS_THEME` (`mode()`, `effective()`, `setMode()`,
`onChange()`).

Den lastes **i `<head>`, ikke nederst i `<body>`**. Fargene velges av
`data-theme` på rot-elementet, så attributtet må stå der før nettleseren maler
første bilde; lastet sist ville skjermen blinket hvitt før den ble mørk.
`tests/dark-mode.test.js` måler dette i den første `requestAnimationFrame`-en,
altså før første maling.

`setMode()` returnerer om valget ble **lagret** — samme kontrakt som
`I18N.setLang()`. I privat modus kaster `setItem`, og drakten ville falt
tilbake ved neste lasting uten at noen sa fra; `app.js` viser en toast i stedet.

## Tokens, og bare tokens

Alt som skifter er custom properties. `:root` har de lyse verdiene,
`:root[data-theme="dark"]` overstyrer dem. **Den mørke blokken inneholder
ingenting annet enn custom properties** — ingen nye regler, ingen duplisert
geometri. Trenger du en `[data-theme="dark"]`-regel med noe annet i, mangler det
et token i `:root`.

Tokenene er delt i to familier etter hva de ligger på:

- **Flate-familien** (`--surface*`, `--line`, `--wash*`, `--overlay`,
  `--glass-bg`, `--control-bg*`, `--track`, `--count-bg`, `--free-*`) ligger på
  appens egne flater: modaler, toppmeny, paneler. I mørk drakt blir flatene
  mørke og blekket lyst.
- **På-farge-familien** (`--plate*`, `--tint*`, `--hairline`, `--on-color-soft`,
  `--chip-bg`) ligger oppå en **palettfarge**. Der snur ikke flaten —
  palettfargen gjør jobben selv — men lagene oppå: de halvgjennomsiktig hvite
  platene blir halvgjennomsiktig svarte, og de svarte hårstrekene blir hvite.

Fire ting snur som ikke er flater:

- **Fokusringen.** `--focus` er mørk i lys drakt (den må lese mot alle lyse
  flater) og **hvit** i mørk. Den mørke gir 1,0:1 mot den mørke
  board-bakgrunnen; den hvite gir ≥ 4,0:1 mot alle 36 mørke palettfarger.
- **Signalfargene som også er tekst.** `--danger`, `--warn` og `--primary-dark`
  er flate- og signalfarger (knappegradienter, prikker) og skal ikke lysne. Der
  de brukes som *tekst* brukes `--danger-ink`, `--primary-ink` og `--note-ink` i
  stedet — identiske med originalene i lys drakt, lyse i mørk.
- **Signaler som tegnes OPPÅ en kortfarge.** Tre av dem er faste farger på et
  underlag som skifter med drakten, og alle tre falt igjennom da paletten ble
  mørk:

  | Token | Hva | Hvorfor |
  |---|---|---|
  | `--check-hover` | avkryssingsboksens kant ved hover | `--primary` gir 1,78:1 på den mørkeste platen — under hvilekantens egne 3,06:1, altså blir kontrollen *utydeligere* i det man sikter på den. Den lyse grønnen gir 3,38:1. |
  | `--danger-edge` | den stiplede slippmål-kanten på søppelkassen | `--danger` bunner ut på 1,03:1 mot de mørke kortfargene. Den lyse rødfargen gir 1,76:1. |
  | `--scrim` | drag-placeholderens flate | en mørkning på en mørk board-bakgrunn er 1,03:1; et *løft* gir 1,45:1. |

  `--danger-edge` og `--scrim` når ikke 3:1 — og har aldri gjort det, heller
  ikke i lys drakt (1,52:1 og 1,22:1). Begge er stiplede/pulserende
  affordanser som kommer sammen med andre signaler (kassen vokser, objektet blir
  gjennomskinnelig). Kravet testen håndhever er derfor **paritet**: den mørke
  drakten skal ikke være dårligere enn den lyse.

`color-scheme` settes på rot-elementet i begge drakter, så det vi ikke tegner
selv følger med: `<select>`-nedtrekket, dato- og klokkeslettvelgerne i
tidsplanen ([`scheduling.md`](scheduling.md)) og rullefeltene.

## Ikonene snur uten at en eneste SVG endres

Ikonsettet (`icons.js` + de innlimte SVG-ene i `index.html`) har fargene som
**presentasjonsattributter**: `stroke="#111"`, `fill="#ffffff"`,
`fill="#c0c4c9"`. En CSS-regel slår et presentasjonsattributt, så tre
attributt-selektorer maler dem om til `--icon-ink`, `--icon-paper` og
`--icon-grey`. I lys drakt er tokenene identiske med attributtene; i mørk blir
streken lys og «papiret» mørkt, så ikonene leser som strektegninger på mørk
flate i stedet for som hvite blaff.

Unntaket er `.btn-solid`. Gradientene på de fargede knappene er de samme i
begge drakter (de er kontraktsfarger, se
[`tilgjengelighet.md`](tilgjengelighet.md)), så ikonene på dem skal bli stående
svarte — det er nettopp derfor grønnfargen får være lys. Knappen pinner derfor
`--icon-ink`/`--icon-paper` tilbake, og `--ink` med dem: `.btn-yellow` setter
`color: var(--ink)` fordi en gul flate ikke kan bære hvit tekst, og uten
pinningen ville blekket lyst opp i mørk drakt og gjort nettopp det ulovlige.
Custom properties arver, så ett sted dekker hele subtreet.

Statuschipene under navnet (`.meta-chip.is-started/-soon/-over`) er fargede
flater som ikke er `.btn-solid`, og de fanges derfor ikke av knappenes pinning.
Der er den lyse streken en **forbedring** på blågrønt (3,90 → 3,95/5,54) og på
rødt (3,52 → 4,38/5,56), så bare den gule chipen pinnes mørk — 1,47:1 med lys
strek mot 10,48:1 med mørk. Samme regel som `.btn-yellow`: en gul flate bærer
mørke merker. Streken og «papiret» pinnes **sammen**: kalender- og
klokkeikonene har en hvit flate under strekene, og med bare streken pinnet ville
mørk strek møtt mørkt papir og ikonet blitt en ulesbar klatt.

**De seks palettfyllene i ikonene** (globusens felter, mappene i logoen) står
uendret i begge drakter. De er den lyse palettens første sett (S=20 %, L=60 %)
og leser godt mot mørk flate; skiftet til den mørke rekka ville gjort ikonene
grumsete uten å vinne noe.

## Palettfargene: samme tone, speilet lyshet

Kort-, mappe- og områdefargene er de eneste fargene som **ikke** bor i CSS — de
utledes av posisjon ved rendring ([`colors-and-labels.md`](colors-and-labels.md)).
Tone og metning er de samme i begge drakter; bare L-settet snur:

```
lys   L = [60, 75, 90]
mørk  L = [42, 32, 22]
```

Den mørke rekka er **ikke** en ren `100 − L` (`[40, 25, 10]`). Kontrastforhold
speiles ikke lineært i L: mot en mørk board-bakgrunn faller L=10 til 1,0–1,1:1,
og de tre settene ville smeltet sammen med bakgrunnen og med hverandre.
`[42, 32, 22]` er speilingen komprimert opp i det området som fortsatt har
spennvidde, og gir målt nesten samme spredning mot board-et som den lyse gir mot
sitt:

| Sett | Lys drakt, mot `--bg` | Mørk drakt, mot `--bg` |
|---|---|---|
| 1 | 1,31–1,99:1 | 2,55–4,37:1 |
| 2 | 2,25–2,82:1 | 1,81–2,80:1 |
| 3 | 3,52–3,84:1 | 1,32–1,74:1 |

Samme gulv (1,3) og samme tak (3,8–4,4), med settene i motsatt rekkefølge — som
er hele poenget med en speiling.

Kortets to avledede farger snur retning med drakten (`paintCardColor` i
`app.js`): korthodet og avkryssingsboksens kant **mørknes** i lys drakt og
**lysnes** i mørk. Mørknet på et allerede mørkt kort ville gitt et korthode som
forsvinner i bakgrunnen og en avkryssingskant som er borte.

Fordi kortfargene settes inline og ikke av CSS, må de males på nytt når drakten
skifter — også når skiftet kom fra operativsystemet mens appen sto åpen.
`app.js` lytter på `THEME.onChange` og maler **kirurgisk, aldri med en full
`render()`**:

1. **`reindexContainerColors`** bytter custom properties på kortene som allerede
   står i DOM-en, i begge scopene.
2. **`repaintAvatars()`** for ansvarssirklene, som `respAvatar` maler inline.
   Sirkelens farge kommer av personens plass i delegruppen — en indeks som ikke
   finnes igjen i DOM-en — så elementet stemples med kilden (`data-pal-index`
   eller `data-pal-id`) når det bygges, og males om derfra.

Til sammen er det hver eneste palettflate som lever i board-et, så en full
`render()` ville ikke tilført noe — men kostet tre ting: den river ned et åpent
`.edit-input` (`captureFocusIn` bevarer det ikke, og en fjernet fokusert node
fyrer ikke pålitelig sin egen `blur`), `renderBoardInner()` kaller `save()` og
ville dermed stemplet dokumentet som endret og køet en synk-runde for et rent
lokalt fargebytte, og å utsette rendringen løser ingenting — `finishDrag()`
kalles av droppene FØR de har committet, så en rendring der ville malt board-et
fra tilstanden før slippet.

Søppelkassens prikker utleder fargen **direkte fra id-en** (`colorForId`) i den
drakten som gjelder når raden bygges — de tar ikke objektets hurtiglagrede
`.color`. Det er ikke bare ryddigere, det er den eneste varianten som holder:

- Et draktbytte MENS appen står åpen kunne vært løst med en opprydding i
  lytteren. En **kaldstart** kan ikke: `theme.js` maler drakten før `app.js`
  rekker å registrere lytteren sin, så et OS-modusbytte mens appen var lukket
  når aldri fram til noen opprydding.
- Og `.color` overlever mellom øktene: `stateReplacer` fjerner bare
  `_`-prefiksede nøkler, så den ligger i den lokale bufferen.

For et trashet objekt er `.color` uansett et levn fra sist det var synlig —
posisjonsfargen fryses idet det forsvinner ut av lista. `colorForId` er
deterministisk per objekt og dermed stabil på tvers av økter og enheter, og er
allerede dokumentert som søppelkassens fargekilde
([`colors-and-labels.md`](colors-and-labels.md)).

## Kontrasten er målt, ikke valgt

`tests/a11y-contrast.test.js` regner ut den mørke halvdelen av kontrakten på
nytt fra `:root[data-theme="dark"]` og fra L-settene i `app.js`, akkurat som den
gjør for den lyse: blekket på de mørke flatene, fokusringen og ikonstreken mot
alle 36 mørke palettfarger, teksten på platene (som er blandinger — en
halvgjennomsiktig plate over en palettfarge, regnet ut i testen), trafikklyset
mot den mørke statuspillen, og at de to L-settene faktisk speiler hverandre.

Endrer du en verdi i den mørke blokken eller et L-sett, kjør den testen.
Kravene selv står i [`tilgjengelighet.md`](tilgjengelighet.md).

## Android-skallet: systemfeltene følger telefonen, ikke drakten

Appen tegner under systemfeltene (`viewport-fit=cover`, se
[`design-system.md`](design-system.md)), så man skulle tro at flaten bak klokka
er vår og dermed skifter farge med drakten. **Det gjør den ikke.** Målt på
telefon: båndet bak statusfeltet er VINDUSBAKGRUNNEN fra Android-temaet. Med et
permanent lyst tema var båndet lyst også når appen under var mørk.

Derfor er både flaten og glyfene bundet til telefonens nattmodus, ikke til
draktvalget:

- foreldretemaet er `Theme.AppCompat.DayNight.NoActionBar`, så vindusbakgrunnen
  blir mørk om natten;
- `values-night/` og `values-night-v27/` snur `windowLightStatusBar` og
  `windowLightNavigationBar` til `false` i samme slengen;
- `SystemBars.style = "DEFAULT"` lar pluginen lese den samme nattmodusen i
  runtime (pluginen overstyrer temaet etter oppstart, rotasjon og modusbytte).

Én kilde for både bånd og glyfer betyr at de ikke kan komme i utakt. Velger
brukeren en drakt som avviker fra telefonen, blir toppen uvant, men aldri
uleselig: mørkt bånd med lyse glyfer over en lys side, eller omvendt.
Verifisert på fysisk telefon i begge drakter, også med drakten overstyrt mot
telefonens modus.

**Splash-temaet har med vilje ingen night-variant.** `drawable/splash.png` er
hvitt hele døgnet, så der gjelder mørke glyfer også om natten.

**Historikk, fordi den er lett å gjenta:** kombinasjonen «permanent lyst tema»
+ `SystemBars.style = "DEFAULT"` ble prøvd og var uleselig på telefon i begge
modi — lyse glyfer på et lyst bånd. Feilen var ikke `DEFAULT` i seg selv, men at
båndet og glyfene hadde hver sin kilde. Vakten står i
`tests/capacitor-android.test.js`, med begrunnelsen skrevet ut i begge
retninger: låses glyfene igjen, må vindusbakgrunnen låses i samme slengen.

### «Følg systemet» virker først med DayNight

Fra targetSdk 33 utleder WebView `prefers-color-scheme` av appens EGET tema
(`isLightTheme`), ikke av telefonens nattmodus. Med et permanent lyst tema
svarte `matchMedia('(prefers-color-scheme: dark)')` derfor alltid `false` inne i
appen, og standardvalget `system` ga lys app på en mørk telefon — bekreftet på
enhet. DayNight er det som kobler de to sammen igjen; ingen ny bro mellom
web-laget og det native skallet trengs.

Nettleseren er upåvirket: der er `<meta name="theme-color">` det eneste som sier
noe om rammen, og `theme.js` holder den i takt med `--bg`.

## Hva testene dekker

| Fil | Dekker |
|---|---|
| `tests/a11y-contrast.test.js` | kontraktstallene i begge drakter |
| `tests/dark-mode.test.js` | attributtet før første maling, «følg systemet» levende, begge velgerne, varighet over omlasting, speilingen av kortfargene, `color-scheme` og `theme-color`, og at et systembytte ikke river ned en pågående navngiving |
| `tests/build-version.test.js` | at `theme.js` versjoneres og langtidscaches som de andre klientfilene |
| `tests/capacitor-android.test.js` | at Android-skallet står på DayNight, at night-variantene snur glyfene, og at `SystemBars.style` er `DEFAULT` |
