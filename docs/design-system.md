# Designsystem og UX-prinsipper

Les denne når oppgaven berører `styles.css`, nye kontroller/knapper, eller
visuell konsistens på tvers av nivåer (univers/gruppe/liste/element).

Appen skal føles **visuelt ryddig, konsistent og forutsigbar**.

## Tokens, ikke hardkoding (styles.css, øverst)

`--control-h` (38px), `--control-radius` (12px), `--control-bg`
(rgba(255,255,255,.75)), `--side-pad`, `--fade-h`, `--text-shadow`, skygge- og
radius-variablene. Nye kontroller skal bruke disse — aldri egne ad hoc-verdier.
Endres et token, skal hele appen følge med.

Alle knapper i samme knapperad har identisk høyde/radius/flate (`--control-h`
/ `--control-radius`). Gjelder ＋-knapper, søppelkasser, filterkortet og ☰.

## Delte klasser — gjenbruk før du lager nye

- `.panel-head` + `.panel-title` + `.panel-actions`: overskrift («GRUPPER»/
  «LISTER»/«UNIVERSER», uppercase via CSS) på egen linje + knapperad under.
  Brukes i gruppemenyen, listemenyen og meny-modalen.
- `.btn-add` (+ `.icon-only` for kvadratisk ＋): ALLE ＋-knapper — grønn gradient,
  **hvit tekst m/ `--text-shadow`**.
- `.trashcan`: ALLE søppelkasse-knapper — hvit avrundet beholder, antall i grå
  sirkel (`.trashcan-count`), **skjult (`hidden`) når tom**.
- `.menu-btn`: ☰ (tre linjer via `.menu-bars` + box-shadow).
- `.chip` / `.chip-name` / `.chip-count`: fargede kort med hvit skrift — deles av
  gruppekort og univers-rader. Aktiv = grønn brand-ring (`outline --primary`).
- Sletteknapper: felles regel (dempet ✕ → rød ved hover), `margin-left: auto` på
  chips (alltid helt til høyre). Element-✕ alltid synlig, dempet (`opacity .55`).
- Håndtak (`.drag-handle`): alltid **mørkere enn flaten sin** (kortets/gruppens
  aksentfarge `--card-accent`/`--g-accent`), grid-sentrert (vertikalt midtstilt).

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
  Destruktivt er alltid reversibelt frem til tømming (gravstein først da). Se
  `docs/trash.md`.
- Nytt objekt (univers/gruppe/liste) aktiveres og går rett i navneredigering.
- Escape lukker øverste modal — men avbryter kun inline-redigering hvis en pågår.

## Fargesystem (HSL, posisjonsbasert) + merkelapper/filter

Se `docs/colors-and-labels.md`.
