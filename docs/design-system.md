# Designsystem og UX-prinsipper

Les denne når oppgaven berører `styles.css`, nye kontroller/knapper, eller
visuell konsistens på tvers av nivåer (univers/gruppe/liste/element).

Appen skal føles **visuelt ryddig, konsistent og forutsigbar**.

## Typografi og skala

Fonten er **Atkinson Hyperlegible Next** (Google Fonts, lastet i index.html) —
valgt for lesbarhet/tilgjengelighet. Alle synlige elementer (tekst, ikoner,
knapper, kontroller) er skalert opp ~30 % i forhold til det opprinnelige
designet, mens padding/margin/gap IKKE er skalert tilsvarende — bevisst valg:
større, mer lesbare og lettere treffbare elementer i et fortsatt kompakt UI.

Univers-rader, gruppekort og listekort har **identisk tittel-typografi**
(20px/600: `.chip-name` og `.card-title`) og identisk størrelse på ekvivalente
ikoner (delt-merke, slett-✕, håndtak).

Tekststørrelsene er tokens (`--fs-xs` 15 / `--fs-sm` 17 / `--fs-md` 18 /
`--fs-base` 19 (brødtekst) / `--fs-lg` 20 (titler) / `--fs-xl` 24
(modal-overskrifter)). Bruk et token, ikke en px-verdi — «juster all tekst X %»
skal være én endring. Kun ikon-/en-gangs-geometri (brand-mark, ikon-bokser)
står fortsatt som px.

## Tokens, ikke hardkoding (styles.css, øverst)

`--control-h` (49px), `--control-radius` (14px), `--control-bg`
(rgba(255,255,255,.75)), `--side-pad`, `--fade-h`, `--text-shadow`,
`--grad-green/-red/-yellow` (knappe-gradienter), skygge- og radius-variablene.
Nye kontroller skal bruke disse — aldri egne ad hoc-verdier. Endres et token,
skal hele appen følge med.

Alle knapper i samme knapperad har identisk høyde/radius/flate (`--control-h`
/ `--control-radius`). Gjelder ＋-knapper, søppelkasser, filterkortet og ☰.

## Luft-regler (padding/margin/gap)

- **Symmetri per element**: et element skal ha samme luft på alle kanter — én
  padding-verdi, ikke ulike topp/høyre/bunn/venstre. (Full-bredde-paneler har
  symmetrisk v/h-par der siden styres av en token, f.eks. `--toolbar-pad`.)
- **Utenfor ≥ inni**: luften rundt/mellom elementer (margin/gap) skal alltid
  være minst like stor som paddingen inni dem — trangere inni enn utenfor
  oppleves harmonisk, det motsatte ikke. (F.eks. item-padding 6 / item-gap 8;
  chip-padding 6 / chip-gap 8; kort-seksjonspadding 10 / `--board-gap` ≥ 12.)
- Listekortet er en flex-kolonne med `gap: 10px` + `padding-bottom: 10px`;
  seksjonene (head/items/skjema/element-kurv) har 10px sidepolstring → jevn
  10px-luft langs alle kanter inne i kortet.

## Ikoner (`.icon`, `icons.js`)

Egendefinert SVG-ikonsett: stroke="currentColor", **stroke-width 1.05** (30 %
tynnere enn opprinnelig 1.5 — luftigere ikoner med tydeligere detaljer),
viewBox 0 0 24 24, avrundede linjer/hjørner. Alle ikoner har klassen `.icon`
(`width/height: 1em` — skalerer med `font-size` på elementet de limes inn i).

- **Statiske forekomster** (panel-title-ikoner, søppelkasse-knapper,
  del-knapper, logo/brand-mark) limes rett inn som `<svg>`-markup i
  `index.html` — ingen build-steg, så det er enklest å holde dem der de brukes.
- **Dynamiske forekomster** (delt/låst-merker, lås-knappen i del-modalen,
  auth-heading-ikonet, sveipefelt-søppelkassen, antall-pillene, element-
  søppelknappen, tom-tilstander) bygges fra `window.ICONS` (`icons.js`, lastet
  før `app.js`) via `el.innerHTML = ICONS.xxx`.
- ☰-knappen og dra-håndtakene tegnes i ren CSS (`.menu-bars` /
  `.drag-handle::before` — strek/prikk + kopier via `box-shadow`), i samme
  tynne, avrundede stil som ikonsettet.
- Favicon (`favicon.svg`) er en frittstående fil siden `<link rel="icon">`
  ikke kan peke på en JS-streng (beholder stroke 1.5 — lesbarhet i 16px).

## Fargede knapper: `.btn-solid` + `.btn-green`/`.btn-red`/`.btn-yellow`

ÉN felles stil for alle fargede knapper — aldri egne ad hoc-gradienter:

- `.btn-solid`: hvit skrift m/ `--text-shadow`, `--shadow-sm`, og felles
  hover-feedback: flaten **lysner litt** (`filter: brightness(1.09)`) og
  skyggen løftes — tydelig, men ikke dramatisk fargeendring.
- `.btn-green` (`--grad-green`): alle positive/primære handlinger — ＋-knapper,
  Inviter, Gjenopprett, Godta, Plasser, auth-submit, filter-brytere i
  på-tilstand.
- `.btn-red` (`--grad-red`): destruktive handlinger — Tøm permanent, Forlat
  deling, Kast ut, Logg ut.
- `.btn-yellow` (`--grad-yellow`): lås-knappene i del-modalen.

Størrelse/form kommer fra egne klasser: `.btn` (modaler), `.btn-small`,
`.btn-add` (knapperadene, + `.icon-only` for kvadratisk ＋), `.switch`.
`.btn-ghost` er den nøytrale hvite varianten (Avslå, Trekk tilbake, Lukk).

## Delte klasser — gjenbruk før du lager nye

- `.panel-head` + `.panel-title` + `.panel-actions`: overskrift («UNIVERS:
  [navn]»/«GRUPPE: [navn]»/«UNIVERSER», uppercase via CSS) på egen linje +
  knapperad under. Brukes i gruppemenyen, listemenyen og meny-modalen.
- `.trashcan`: ALLE søppelkasse-knapper — hvit avrundet beholder, antall i grå
  sirkel (`.trashcan-count`), **skjult (`hidden`) når tom**.
- `.menu-btn`: ☰ (tre linjer via `.menu-bars` + box-shadow).
- `.chip` / `.chip-name` / `.chip-count`: fargede kort med hvit skrift — deles
  av gruppekort og univers-rader. Aktiv = grønn brand-ring (`outline
  --primary`). `.chip-count` er en liten, subtil **pill med nivå-ikon +
  antall** (univers-rad: mappe + antall grupper; gruppekort: liste-ikon +
  antall lister), med litt avstand fra navnet.
- Sletteknapper: felles regel (dempet ✕ → rød ved hover). På chips ligger
  **del-knappen alltid rett til venstre for ✕** (auto-margen flytter seg til
  del-knappen når den er synlig). Element-✕ alltid synlig, dempet
  (`opacity .55`).
- Del-knapper: listekort har `.card-share` (ser ut som en knapp — svakt hvit
  flate + ring, lysner ved hover), som viser **[del-ikon] + [liste-ikon]** —
  samme mønster som menyenes del-knapper. **Univers og grupper deles IKKE fra
  kortene**, men fra menyenes egne `.share-btn` (del-univers = [del]+[globus]
  ved «＋ Gruppe», del-gruppe = [del]+[mappe] ved «＋ Liste» — deler det AKTIVE
  universet/gruppen; flate-mønster). Kun kontomodus. Delt-merket
  (`.share-badge`) har samme høyde som teksten.
- Håndtak (`.drag-handle`): tre vertikale prikker (CSS `::before` +
  box-shadow), alltid **mørkere enn flaten sin** (`--card-accent`/`--g-accent`)
  og alltid nøyaktig vertikalt midtstilt (`align-self: stretch` +
  grid-sentrering). Tastatur: piltaster på et fokusert håndtak flytter objektet
  (se `docs/drag-and-drop.md`).
- Placeholders: én delt stil for `.card-/.item-/.group-placeholder` — se
  `docs/drag-and-drop.md`.
- `.field`: felles tekstfelt (auth-input + inviter-input) — solid kant, myk
  bakgrunn, grønn fokus-ring. Nye felt trenger bare klassen `.field`.
- `.account-avatar` / `.member-avatar`: felles avatar-form (rund, sentrert hvit
  initial på gradient) via delt selektor; størrelse/farge per bruk.
- `.item-check`: avkryssingsboks på elementer — rund-firkantet boks, grønt
  hake-fyll (`.item.done`) + gjennomstreket tekst + lavere bakgrunn. Avkryssede
  elementer flyttes med FLIP til en egen **«Utført»-seksjon** (`.items-done`,
  skilt med `.done-divider`) nederst i kortet; `done` er datamodell (se
  `docs/data-model.md`). Håndtaket er inaktivt for avkryssede rader.
- `.spinner`: liten roterende ring — lasteindikator i søppel-modalen for
  buffer-slettede objekter som ennå ikke er gjenopprettbare (se `docs/trash.md`).
- Liste-ikonet (`ICONS.list`): de tre «linjene» er nå **fylte bullets** (små
  sirkler, `r=0.7`, `fill=currentColor`) for tydeligere separasjon.
- Antall-piller (`.chip-count`) og tellere (`.trashcan-count`) samt varsel-
  badgen (`.menu-badge`) holdes **bevisst separate** — de deler visuelt uttrykk
  (avrundet, tabular-nums) men har ulike roller; å tvinge dem inn i én `.pill`
  ville vært prematur abstraksjon.

## Flate-mønsteret

Hvile = halvgjennomsiktig hvit (`--control-bg`), hover = helt ugjennomsiktig
hvit. Gjelder søppelkasser, filterkortet og ☰.

## `[hidden]`-regelen

`[hidden]` har en global `display:none !important`-regel i styles.css — den MÅ
beholdes. Uten den ville klasse-display som `.trashcan`s `inline-flex`
overstyre `hidden`-attributtet, og tomme søppelkasser ville vises likevel.

## Delelinjer i modaler

Delelinjer (f.eks. meny-modalens Logg ut/Universer-skille) skal se ut som
`.modal-head`s `border-bottom` — kant-til-kant, IKKE en innrykket `<hr>` med
vanlig margin (den ville stoppe ved `.modal-body`s side-padding og se kortere
ut enn linja over). Bruk `border-bottom: 1px solid var(--line)` + negativ
side-margin som kansellerer den omsluttende paddingen.

## UX-prinsipper (samme mønster på alle nivåer)

- Klikk = bytt/aktivér; klikk på det **aktive** navnet = omdøp inline (autosize).
- Slett = `trashed`-flagg → søppelkasse; søppelkasser vises kun med innhold;
  kort trykk = modal (gjenopprett/tøm), klikk-og-hold = sveipefelt for tømming.
  Sletting animeres («pakk sammen og fly i søpla», se `docs/trash.md`) så
  brukeren ser hvor objektet havnet. Destruktivt er alltid reversibelt frem
  til tømming (gravstein først da) — derfor ingen bekreftelses-dialog på selve
  slettingen, og heller ikke på «Tøm permanent» i modalen (sveipe-tømming har
  heller ingen).
- Nytt objekt (univers/gruppe/liste) aktiveres og går rett i navneredigering.
- Escape lukker øverste modal — men avbryter kun inline-redigering hvis en pågår.
- Del-modalens overskrift er alltid «[objekttype-ikon] [navn] — Innstillinger
  for deling» (gir mening for både eier og mottaker).
- **Bekreftelse**: bruk `askConfirm({title, message, okLabel, danger})` (Promise
  → boolean, app-stilt `#confirm-modal`), ALDRI native `confirm()`. `danger`
  (standard) gir rød OK; `danger:false` grønn. Stables øverst blant modalene.
- **Angre**: destruktive handlinger som kan angres viser en toast med «Angre»-
  knapp: `showToast(msg, { label, fn })`. Slettinger bruker dette (5 s) sammen
  med fly-i-søpla-animasjonen; gjenopprett-logikken deles med søppel-modalen
  (`restoreUniverse/Group/Card/Item`).

## Bevegelse og tilgjengelighet

- `prefersReducedMotion()` (app.js) hopper over fly-/FLIP-/drop-animasjonene, og
  et `@media (prefers-reduced-motion: reduce)`-blokk nøytraliserer CSS-
  transisjoner/animasjoner. Respekter dette i nye animasjoner.
- Ingen `user-scalable=no` (brukere skal kunne zoome). Kontroller er minst
  ~29–49px høye for touch. Fargede ✕/håndtak er hvite m/ tekst-skygge på farge.

## Fargesystem (HSL, posisjonsbasert) + filter

Se `docs/colors-and-labels.md`.
