# Menyer: gruppemeny, listemeny, menyknapp, meny-modal

Les denne når oppgaven berører header/verktøylinje-layout, ☰-knappen, eller
meny-modalen (universer, logg ut).

## Gruppemenyen (header)

Fast panel (`position: fixed`), **én felles DOM** delt i to media-queryer:

- **Desktop (`min-width: 561px`)**: fast, full-høyde **kolonne til venstre**
  (`--sidebar-w`). Øverst `.panel-top`: overskriften **UNIVERS: [navn]** (navnet
  på gjeldende univers, satt av `updatePanelTitles()` i `render()`) og
  knapperaden **«＋ Gruppe» + gruppe-søppelkassen side om side**. Gruppekortene
  scroller i
  kolonnen under og **oppløses i en fade** (CSS `mask-image`, høyde `--fade-h`,
  tilsvarende fade i bunnen; hvile-padding = fade-høyden så ingenting er falmet
  i ro). Masken slås av under draging (`body.is-dragging`) fordi den ellers
  ville klippe det løftede (fixed) dra-kortet. Ingen pinnede soner lenger.
- **Mobil (`max-width: 560px`)**: fast panel øverst: overskrift, knapperad
  («＋ Gruppe» + søppelkasse) og gruppekortene på **én horisontalt scrollende
  rad** under — **uten fader** (kun en diskret, app-tilpasset scrollbar). ☰
  ligger IKKE i denne DOM-en (se «Menyknapp» under), men overlapper panelet
  visuelt.
- **Gruppekort** (`.group-card.chip`): håndtak (mørkt, `--g-accent`), navn, dempet
  antall, ✕ helt til høyre. Posisjonsbasert farge; aktiv = grønn ring. Klikk =
  bytt gruppe; klikk på aktivt navn = omdøp (`editText` autosize).
- **Rekkefølge**: dra-og-slipp via håndtaket med placeholder + FLIP
  (`updateGroupPlacement` dispatcher på orientering: vertikal kolonne på desktop
  (`…V`), horisontal rad på mobil (`…H`)); auto-scroll av feltet ved kantene.
- Header- og verktøylinje-høyder måles (`ResizeObserver`) → `--header-h`/`--toolbar-h`.

Gotcha: bytte av gruppe/univers kan lukke ting, men **sletting av en gruppe/et
univers lukker IKKE menyen** — brukeren skal kunne angre fra søppelkassen med
én gang. Bytte gjør det (bytt kontekst og gå).

## Listemenyen (verktøylinja)

Fast meny (`position: fixed`; desktop: øverst til høyre for kolonnen, mobil: rett
under gruppemenyen). To linjer: overskriften **GRUPPE: [navn]** (navnet på
gjeldende gruppe, samme `updatePanelTitles()`) og knapperaden **«＋
Liste» + liste-søppelkassen + filterkortet (👁️ K/P/KP)** (filter, se
`docs/colors-and-labels.md`). Filterkortet følger flate-mønsteret
(halvgjennomsiktig → opak ved hover). Logg ut-knappen ligger i meny-modalen
(ikke her). ☰ er ikke en del av denne DOM-en (se under), men overlapper
panelet visuelt på desktop.

## Menyknapp (☰)

**Én knapp** (`#menu-btn`, direkte i `<body>` — ikke inni gruppemenyen eller
listemenyen), **fast posisjonert i øvre høyre hjørne av VIEWPORTET**
(`position: fixed; top: 12px; right: …`), uavhengig av begge menyenes DOM/flyt.
Samme knapp/posisjon-strategi brukes på både mobil og desktop — kun selve
høyre-offset-tokenet byttes — det er IKKE to knapper med vis/skjul.

- z-index (35) over begge faste paneler (header 30, toolbar 20) men under
  modaler (200), så den ligger alltid synlig oppå uansett scroll-posisjon.
- **Mobil**: overlapper gruppemenyen (det faste toppanelet der) — bruker
  `--side-pad` (samme token som gruppemenyens egen sidepolstring) som høyre-
  offset, så den havner nøyaktig i det panelets hjørne.
- **Desktop**: overlapper listemenyen (til høyre for gruppemeny-kolonnen) —
  bruker i stedet `--toolbar-pad` (`clamp(12px, 3vw, 40px)`, listemenyens egen,
  viewport-relative sidepolstring — egen token, satt via en desktop-override av
  `.menu-btn { right: … }`), så den flukter nøyaktig med LISTER-linjens kant.
- Skjules på låseskjermen (`body.locked #menu-btn { display: none; }`).
- Effekt: knappen «arver» riktig hjørne fra hvilket som helst panel som faktisk
  ligger der på gjeldende skjermstørrelse, uten skjermstørrelse-spesifikk
  DOM-plassering eller flere knapper.

**Ikke gjeninnfør separate knapper per skjermstørrelse eller flytt den inn i et
panels flex-flyt igjen.** Dette gikk gjennom tre design-runder (separate
knapper → én knapp i listemenyen → dagens fast viewport-pinnede element) og
løsningen over er den bevisst valgte. Bruk `--side-pad`/`--toolbar-pad` for
responsiv styling i stedet.

## Meny-modal + universer

Menyknappen (☰) åpner `#menu-modal`:

- **«Logg ut»** øverst (med bekreftelse), deretter en delelinje (`<hr class=
  "menu-divider">`) i samme border-stil som `.modal-head` — se
  `docs/design-system.md` («Delelinjer i modaler»).
- **UNIVERSER**-seksjon: univers-rader (`.uni-row.chip` — håndtak, farget, aktiv
  m/ ring, antall grupper dempet, ✕ helt til høyre), «＋ Univers» og
  univers-søppelkassen (samme knapp/oppførsel som de andre — se
  `docs/trash.md`).
- Klikk på en rad = **bytt univers + lukk menyen**; klikk på det aktive navnet =
  omdøp. Slett = i søppelkassen (menyen forblir åpen så man kan angre).
  `setActiveUniverse` gjenoppretter sist aktive gruppe i universet
  (`activeGroups`, se `docs/data-model.md`).
- **Rekkefølge**: dra-og-slipp via håndtaket, samme placeholder+FLIP-motor som
  gruppekortene (se `docs/drag-and-drop.md`). `uni-list` er alltid én vertikal
  kolonne (ingen mobil/desktop-veksling som gruppelista), så kun
  V-varianten av bytte-logikken trengs (`updateUniversePlacement`); auto-scroll
  ruller `.menu-body` (modalens scroll-container), ikke `uni-list` selv.
- Søppelkasse-modalen kan ligge **over** menyen (ligger etter i DOM, samme
  z-index); `body.modal-open` styres samlet (`updateModalOpenClass`).
- Universer er **helt uavhengige**: se `docs/data-model.md`.
