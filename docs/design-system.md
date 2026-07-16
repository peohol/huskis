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

Univers-rader, gruppe-rader og listekort har **identisk tittel-typografi**
(20px/600: `.chip-name` og `.card-title`) og identisk størrelse på ekvivalente
ikoner (delt-merke, slett-✕, håndtak).

Tekststørrelsene er tokens (`--fs-xs` 15 / `--fs-sm` 17 / `--fs-md` 18 /
`--fs-base` 19 (brødtekst) / `--fs-lg` 20 (titler) / `--fs-xl` 24
(modal-overskrifter)). Bruk et token, ikke en px-verdi — «juster all tekst X %»
skal være én endring. Kun ikon-/en-gangs-geometri (brand-mark, ikon-bokser)
står fortsatt som px.

## Tokens, ikke hardkoding (styles.css, øverst)

`--control-h` (49px), `--control-radius` (14px), `--control-bg`
(rgba(255,255,255,.75)), `--toolbar-pad`, `--text-shadow`,
`--grad-green/-red/-yellow` (knappe-gradienter), skygge- og radius-variablene.
Nye kontroller skal bruke disse — aldri egne ad hoc-verdier. Endres et token,
skal hele appen følge med.

Alle knapper i samme knapperad har identisk høyde/radius/flate (`--control-h`
/ `--control-radius`). Gjelder ＋-knapper, søppelkasser, filterkortet, breadcrumb-knappene og kontoknappen.

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

Egendefinert SVG-ikonsett, **fargelagt**: streker er SVARTE (`stroke="#111"`,
hardkodet — IKKE lenger `currentColor`) og flater fylles med hvit + palettfarger
der motivet tilsier det (kart under). **stroke-width 1.05** (30 % tynnere enn
opprinnelig 1.5), viewBox 0 0 24 24, avrundede linjer/hjørner. Alle ikoner har
klassen `.icon` (`width/height: 1em` — skalerer med `font-size` på elementet de
limes inn i).

**Fargekart** (fyllene er hardkodet hex som speiler palettens seks første farger,
HSL S=20 % L=60 %: farge 1–6 = `#ad8585 #adad85 #85ad85 #85adad #8585ad #ad85ad`;
grå = `#c0c4c9`):

| Ikon | Fyll |
|---|---|
| Globus (univers) | de seks globusfeltene = palettfarge 1–6 |
| Del (share) | stor sirkel farge 1, de to små farge 2 og 3 |
| Søppelkasse (trash/trashSwipe) | kroppen grå |
| Mappe (gruppe) | farge 2 (gulaktig mappefarge) |
| Liste | hvit flate, svarte punkter/linjer |
| Øye (vis) | hornhinne hvit, pupill svart |
| Person (mine) | hode + kropp farge 4 |
| Tre personer (delte) | hver person farge 1 / 2 / 3 |
| Brev (e-postvarsel) | hvit |
| Tannhjul (innstillinger) | grå kogg med FYLTE, brede tenner (⚙️-stil) — senterhullet gjennomsiktig (even-odd) |
| Oppløs (bubbleBurst) | ingen fyllflate — kun svarte streker |
| Dør inn (login) | dørfeltet hvitt |
| Hengelås | låst = farge 1, åpen = farge 3 |
| Kalender/klokke | flate hvit |
| Hånd-opp (ansvarlig) | person farge 4 |

Unntak som beholder `currentColor` (rene glyfer på massive fargeknapper):
utlogging (`.logout-icon`, hvit på rød), avkryssings-haken (`.item-check`) og
kategori-knappen (`.add-cat-btn`, hvit på gul).

**Kryss-ikonet** (`ICONS.xmark`, samt inline i `index.html`): lukk-/slett-
knappenes ✕ er nå en egen SVG med samme strek (1.05) og runde ender som resten
av settet, `stroke="currentColor"` så CSS styrer farge. Slett-knappene
(`.card-delete`/`.item-delete`/`.group-delete`/`.uni-delete`) er SVARTE i hvile
(også på fargede chip-/korthode-flater) og RØDE ved hover/aktivering; lukk-
knappene arver `.icon-btn`-fargen (`--ink-soft`).

- **Statiske forekomster** (panel-title-ikoner, søppelkasse-knapper,
  del-knapper, logo/brand-mark) limes rett inn som `<svg>`-markup i
  `index.html` — ingen build-steg, så det er enklest å holde dem der de brukes.
- **Dynamiske forekomster** (delt/låst-merker, lås-knappen i del-modalen,
  auth-heading-ikonet, sveipefelt-søppelkassen, antall-pillene, element-
  søppelknappen, tom-tilstander) bygges fra `window.ICONS` (`icons.js`, lastet
  før `app.js`) via `el.innerHTML = ICONS.xxx`.
- Dra-håndtakene tegnes i ren CSS (`.drag-handle::before` — prikk + kopier
  via `box-shadow`), i samme tynne, avrundede stil som ikonsettet.
- **Logo (`favicon.svg` + brand-mark på innloggingsskjermen)**: tre stablede
  lister — samme motiv som `list`-ikonet, men tegnet som tre avrundede kort
  forskjøvet nedover/til høyre; kun det fremste kortet har de tre listepunktene
  (prikk + strek). Logoen er fargelagt: **svarte** streker/prikker, og de tre
  kortene fylles med palettfarge **3/2/1** (bakerst→fremst — det fremste kortet
  har farge 1), slik at det fremste kortet dekker strekene på kortene bak →
  «papirbunke»-effekt. Tynnere strek enn ikonsettet (0.9) så listepunktene
  overlever i 16px favicon. Logoen finnes to steder (samme markup): `favicon.svg`
  (frittstående fil, siden `<link rel="icon">` ikke kan peke på en JS-streng) og
  inline i `.brand-mark` (`index.html`). Endrer du motivet/fargene, oppdater
  BEGGE.
- `--icon-stroke` (token, 1.05px): linjetykkelsen for CSS-tegnede (ikke-SVG)
  streker som skal matche ikonsettets stroke-width visuelt — brukt av
  sveipefeltets pil (`.swipe-arrow::before`/`::after`), som tidligere hadde en
  hardkodet, tykkere strek (2.5px).

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

- `.panel-head` + `.panel-title` + `.panel-actions`: overskrift («ALLE
  UNIVERSER»/«INVITASJONER» osv., uppercase via CSS) på egen linje + knapperad
  under. Brukes i univers-/gruppe-/konto-modalen og toppmenyens
  listefunksjons-rad.
- `.crumb-btn`: breadcrumb-knappene i toppmenyen (nivå-ikon + navn på
  flate-mønsteret, `.crumb-name` med ellipsis); `.crumb-sep` er ›-skilletegnet.
- `.trashcan`: ALLE søppelkasse-knapper — hvit avrundet beholder, antall i grå
  sirkel (`.trashcan-count`), **skjult (`hidden`) når tom**.
- `.account-btn`: kontoknappen (person-ikon, fast i øvre høyre hjørne, med
  `.menu-badge` som invitasjons-teller).
- `.modal-current` + `.current-chip`: «Du er i»-blokken øverst i univers-/
  gruppe-modalen (etikett + chip-farget navn + del-knapp under).
- `.account-form` (+ `-label`/`-row`) og `.account-msg`: endre navn/e-post i
  konto-modalen (etikett over felt, Lagre-knapp på samme rad).
- `.chip` / `.chip-name` / `.chip-count`: fargede kort med hvit skrift — deles
  av gruppe-/univers-rader (i modalene) og «Du er i»-chipen. Aktiv = grønn brand-ring (`outline
  --primary`). `.chip-count` er en liten, subtil **pill med nivå-ikon +
  antall** (univers-rad: mappe + antall grupper; gruppe-rad: liste-ikon +
  antall lister), med litt avstand fra navnet.
- Sletteknapper: felles regel (dempet ✕ → rød ved hover). På chips ligger
  **del-knappen alltid rett til venstre for ✕** (auto-margen flytter seg til
  del-knappen når den er synlig). Element-✕ alltid synlig, dempet
  (`opacity .55`).
- Innstillings-/del-knapper: listekort har `.card-cog` (tannhjul, svakt hvit
  flate + ring, lysner ved hover) som åpner innstillingsmodalen — **deling av
  lister ligger DER** (`docs/scheduling.md`), ikke i en egen kortknapp.
  **Univers og grupper deles fra menyenes egne `.share-btn`** (del-univers =
  [del]+[globus] ved «＋ Gruppe», del-gruppe = [del]+[mappe] ved «＋ Liste» —
  deler det AKTIVE universet/gruppen; flate-mønster; kun kontomodus).
  Delt-merket (`.share-badge`) brukes av gruppe-/univers-chips; listekortets
  delt-status vises som chip i meta-raden (`docs/scheduling.md`).
- Håndtak (`.drag-handle`): tre vertikale prikker (CSS `::before` +
  box-shadow), alltid **mørkere enn flaten sin** (`--card-accent`/`--g-accent`)
  og alltid nøyaktig vertikalt midtstilt (`align-self: stretch` +
  grid-sentrering). Tastatur: piltaster på et fokusert håndtak flytter objektet
  (se `docs/drag-and-drop.md`).
- Placeholders: én delt stil for `.card-/.item-/.group-placeholder` — se
  `docs/drag-and-drop.md`. Ingen kant (kun mørknet flate + innover-skygge);
  den stiplede kanten er fjernet.
- `.add-item-input`: ingen synlig kant i hvile (`border: 1.5px solid
  transparent` — usynlig, men holder boksens bredde stabil via
  `box-sizing: border-box`) og dempet (`opacity: 0.62`) så den tydelig skiller
  seg fra de eksisterende elementene. Fokus gir full opacity + synlig kant
  (`--card-accent`), som før.
- `.add-item-btn` (grønn ＋) og `.add-cat-btn` (gul, kategori-ikon):
  begge er **disablet (`opacity: .45`)** når feltet er tomt (`syncAddBtn`
  toggler `disabled` på begge ved input-event) — ingen hover-oppløfting da.
  ＋ legger til et element (`type=submit`); kategori-knappen (`type=button`,
  til høyre for ＋) oppretter i stedet en kategori med det innskrevne navnet.
  Kategori-knappens ikon er `ICONS.category`-tegningen limt inn direkte i
  `index.html` med `stroke/fill="currentColor"` (hvit på gul flate — samme
  unntak som utloggings-ikonet). Begge de kvadratiske icon-only-knappene
  (element-＋ og kategori) bærer store, tydelige ikoner: `.btn-add.icon-only
  .icon` settes til **34px** for begge, så ＋-en er like stor som kategori-ikonet
  (kategori-motivet — klammer/prikker/linjer — trenger størrelsen for å lese
  tydelig, og ＋-en matcher det).
- **Delt ＋-ikon** (`ICONS.plus`, samt inline-kopier i `index.html`): ALLE
  «legg til»-knappene (element/liste/gruppe/univers) bruker nå samme SVG-tegnede
  ＋ (to rette streker, `stroke-width="1.05"`, runde ender, `currentColor`) i
  stedet for tekst-glyfen ＋ — som har annen linjestil/tykkelse enn resten av
  ikonsettet og dermed brøt den ellers konsekvente streken. De tekst+ikon-
  knappene (liste/gruppe/univers) beholder `.btn-add .icon`-størrelsen (19px);
  kun de kvadratiske icon-only-knappene skaleres opp til 34px (se over).
- **Kategorier** (`.category` / `.cat-head` / `.cat-title` / `.cat-cog` /
  `.cat-dissolve` / `.cat-items`): en nivå-1-rad med en header (håndtak +
  tittel/meta + tannhjul + oppløs-knapp) over en nøstet elementliste. Kondensert:
  samme 8px-luft som mellom elementer, både over overskriften og mellom
  overskriften og elementene (`.category` gap 8px; `.cat-items` uten vertikal
  padding). `.cat-title` er **hvit m/ tekst-skygge** (som `.card-title`) —
  lesbar på enhver listefarge. `.cat-cog`/`.cat-dissolve` bruker den **hvite
  flate-knappestilen fra `.card-cog`** (svakt hvit flate + ring, lysner ved
  hover) så de er synlige mot den fargede listeflaten; tannhjul (innstillinger)
  til venstre for oppløs-knappen (boble-sprekk-ikonet `ICONS.bubbleBurst`).
  `.cat-head`s 6px sidepolstring stiller håndtak/knapper i **samme kolonner** som
  elementenes (som har 6px boks-padding) og kort-hodets — hele lista leser som
  felles kolonner. **«Hylle i veggen»-metafor:** overskriften står på veggen
  (listeflaten), og `.cat-items` er en **fordypning** rett under (4px gap) — litt
  mørkere flate (`rgba(0,0,0,.1)`) + innover-skygge (`inset box-shadow`) + stort
  venstre-innrykk, så elementene blir som «bøker» i en hylle som går inn i veggen
  (dette erstattet den tidligere grupperingsstreken). `.category.dragging` er et
  løftet, hvitt chip UTEN fast høyde (følger den kollapsende `.cat-items`-høyden
  under draging — se `docs/drag-and-drop.md`). Subtile skillelinjer
  (`rgba(0,0,0,.15)`) rammer en kategori mot nabo-radene på nivå 1: **under**
  kategorien (`.category:not(:last-child)::after`) mot det påfølgende elementet/
  kategorien — men **ikke** når kategorien er siste rad (`:not(:last-child)`
  følger DOM-rekkefølgen, item OG category som søsken); og **over** kategorien
  (`.item + .category::before`) KUN når raden over er et element. To kategorier
  på rad får dermed ingen ekstra linje mellom seg utover ::after-en fra den
  øverste. Linjene går **kant-til-kant** (negativ sidemargin `-10px` kansellerer
  `.items-container`s 10px sidepolstring) med **lik luft over og under (16px)**
  hver — margin-verdiene (`::after` 12/8, `::before` 8/12) er ulike fordi de
  kompenserer for forskjellige omkringliggende flex-gap (`.category`s 4px
  topp/bunn vs. `.items-container`s 8px mellom rader), men summerer til samme
  16px på begge sider.
- `.field`: felles tekstfelt (auth-input + inviter-input) — solid kant, myk
  bakgrunn, grønn fokus-ring. Nye felt trenger bare klassen `.field`.
- `.account-avatar` / `.member-avatar`: felles avatar-form (rund, sentrert hvit
  initial på gradient) via delt selektor; størrelse/farge per bruk. Initialene
  kommer fra `display_name` (`initialsFromName`) — se `docs/accounts.md`.
- `.item-cog` / `.card-cog`: tannhjul-knappene som åpner innstillingsmodalen
  (element: dempet ikon ved slette-✕; liste: flate-knapp i kort-headeren).
  `.meta-row` + `.meta-chip`: indikator-chipene under navnet (delt/ansvarlig/
  start/frist — status-farger via `--grad-*`). `.resp-avatar` / `.resp-row`:
  ansvarlig-sirkler og velger-rader; sirkelfargen settes inline fra paletten
  (`colorForIndex`, personens alfabetiske plass i delegruppen). Se
  `docs/scheduling.md` og `docs/accounts.md`.
- `.item-check`: avkryssingsboks på elementer — rund-firkantet boks, grønt
  hake-fyll (`.item.done`) + gjennomstreket tekst + lavere bakgrunn. Avkryssede
  elementer flyttes med FLIP til en egen **«Utført»-seksjon** (`.items-done`,
  skilt med `.done-divider`) nederst i kortet; `done` er datamodell (se
  `docs/data-model.md`). Håndtaket er inaktivt for avkryssede rader.
- Ingen lasteindikatorer/spinnere: operasjoner utføres optimistisk og
  serialiseres i en bakgrunnskø (se `docs/accounts.md`) — UI-et venter aldri
  synlig på at noe skal lande. (Den gamle `.spinner`-klassen er fjernet.)
- Liste-ikonet (`ICONS.list`): de tre «linjene» er nå **fylte bullets** (små
  sirkler, `r=0.7`, `fill=currentColor`) for tydeligere separasjon.
- Antall-piller (`.chip-count`) og tellere (`.trashcan-count`) samt varsel-
  badgen (`.menu-badge`) holdes **bevisst separate** — de deler visuelt uttrykk
  (avrundet, tabular-nums) men har ulike roller; å tvinge dem inn i én `.pill`
  ville vært prematur abstraksjon.

## Flate-mønsteret

Hvile = halvgjennomsiktig hvit (`--control-bg`), hover = helt ugjennomsiktig
hvit. Gjelder søppelkasser, filterkortet, breadcrumb-knappene og kontoknappen.

## `[hidden]`-regelen

`[hidden]` har en global `display:none !important`-regel i styles.css — den MÅ
beholdes. Uten den ville klasse-display som `.trashcan`s `inline-flex`
overstyre `hidden`-attributtet, og tomme søppelkasser ville vises likevel.

## Delelinjer i modaler

Delelinjer (f.eks. skillene i univers-/gruppe-/konto-modalen) skal se ut som
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
