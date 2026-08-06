# Menyer: toppmeny (nav-knapp), navigasjonsmodalen, kontoknapp/-modal

Les denne når oppgaven berører toppmenyen, navigasjonsknappen/-modalen (områder
og mapper) eller kontoknappen/konto-modalen.

Prinsipp: **all navigering, redigering, omrokkering og deling av områder og
mapper skjer i ÉN felles modal** — hovedsiden har kun nav-knappen (hvor er jeg)
og listefunksjonene.

Nøkkelidé: **områder og mapper bruker nøyaktig samme oppsett som lister og
listepunkter.** Et område er et `.card`, en mappe en `.item`-rad, en
mappekategori en `.category`. Dermed arves hele kort-/rad-designet OG hele
dra-og-slipp-motoren — se `docs/drag-and-drop.md` («Nav-scopet»).

## Toppmenyen (`.topbar`)

Ett fast panel øverst (`position: fixed`, full bredde, samme DOM på mobil og
desktop). To rader:

1. **Navigasjonsknappen** (`.crumb-btn.nav-crumb`, `#nav-crumb`): ÉN knapp som
   viser hele lokasjonen som en breadcrumb — `🌐 [områdenavn] › 📁 [mappenavn]`
   (`updateCrumbs()`; fallback «Område»/«Mappe» når ingenting finnes). Klikk
   åpner nav-modalen. Navnene kappes med ellipsis; raden holder avstand til
   kontoknappen med `padding-right`. På mobil krympes fonten litt (media-query).
2. **Listefunksjonene** (`.panel-actions.toolbar`): «＋ Liste»
   (`#add-card-btn`) og liste-søppelkassen (`#trash-btn`). «＋ Liste» er avskrudd uten
   en aktiv mappe man kan opprette lister i (`canAddList`, `updateToolbarState`)
   — en LÅST mappe gir ingen knapp å trykke på, akkurat som «＋ Mappe» i et
   låst område. Se `docs/rettigheter-og-deling.md` («Å opprette og å plassere
   spør FORELDEREN»).

Board-ets padding-top settes i JS (`syncHeaderHeight`: målt topbar-høyde +
`--board-gap`) — se `docs/board-layout.md`.

## Kontoknappen (`.account-btn`, `#account-btn`)

Fast i øvre høyre hjørne av VIEWPORTET (`position: fixed; top: 12px; right:
var(--toolbar-pad)`), utenfor toppmenyens flyt — z-index (35) over det faste
panelet (30) men under modaler (200). Person-ikon + rød badge
(`#account-badge`) med antall ventende invitasjoner. Åpner konto-modalen.
Skjules før innlogging (`body.no-auth`).

## Navigasjonsmodalen (`#nav-modal`, åpnes fra nav-knappen)

Modalen har **tre seksjoner**, hver med overskrift (`.nav-section-head`) og en
skillelinje over (unntatt den første):

| # | Overskrift | Innhold |
|---|---|---|
| 1 | `[globus][konto] Mine områder` | områder der jeg har rollen `owner` — pluss ＋-knappen «Nytt område» (`.nav-add-uni`), som finnes KUN her |
| 2 | `[globus][personer] Områder delt med meg` | områder der jeg er `member` |
| 3 | `[mappe][personer] Mapper delt med meg` | mapper jeg har en DIREKTE rolle i uten å ha noen rolle i deres kanoniske område |

Seksjon 1 og 2 vises alltid (tomme får en `.nav-section-empty`-linje); seksjon 3
kun når man faktisk har frie mapper. Klassifiseringen følger **nåværende rolle**,
ikke hvem som opprettet objektet — se `docs/rettigheter-og-deling.md`.

Seksjon 3 tegnes som ett **virtuelt områdekort** (`.free-groups-card`,
`FREE_UNI_ID`) uten del-/slett-knapp og uten ＋-rad: mappene i det har allerede
et kanonisk område, og beholderen finnes ikke i databasen.

Alle tre seksjonene ligger i den SAMME `.board-col` som områdekortene, som egne
rader. Dra-og-slipp-motoren hopper over dem (`boardRows` filtrerer på
`.card`/`.card-placeholder`), så de kan stå der uten å bli dra-mål, og
`relayoutBoard` returnerer tidlig for énkolonne-scopet slik at kortene aldri
flyttes bort fra overskriften sin.

Overskrift: **«[område-ikon] Områder og [mappe-ikon] mapper»**. Innholdet er
ett `.board` (`#nav-board`, klassen `.nav-board`) med ett kort per område, og
under det område-søppelkassen. («＋ [globus]» ligger inne i seksjon 1.)

- **Alltid ÉN kolonne**, uansett skjermbredde — i motsetning til hovedsidens
  board. Kolonnene lages av det samme `relayoutBoard`-maskineriet
  (`docs/board-layout.md`), men nav-scopet setter `singleColumn`.
- **Bygges bare når modalen er åpen** (`renderNav()` returnerer tidlig når
  `navModal.hidden`): en usett DOM-kopi av alle områder/mapper koster ved hver
  render, og ville dessuten gitt doble treff for `.card`/`.item` på tvers av de to
  board-ene. `openNavModal()` setter derfor `hidden = false` FØR den kaller
  `renderNav()`.

### Område-kortet (`.card.uni-card`, `#uni-card-template`)

Samme oppbygning som et listekort (`.card-head` + `.card-body`), med disse
forskjellene:

| Listekort | Område-kort |
|---|---|
| tannhjul (`.card-cog`) → innstillingsmodal | **del-knapp** (`.uni-share`, samme knappestil) → del-modalen |
| «(N)» ved navnet når kollapset | **[mappe-ikon] + antall** (`.collapse-count.uni-count`) |
| «Utført»-seksjon + ⟲ | — (mapper krysses ikke av) |
| ＋ listepunkt / gul kategori-knapp | **＋ mappe / gul mappekategori-knapp** (`ICONS.groupCategory`) |
| listepunkt-søppelkasse i body-en | **mappe-søppelkasse** i body-en (`.group-trash-btn`) |

- Klikk på **tittelen** = omdøp inline. Klikk **ellers på korthodet** (ikke
  tittel/del/×) = kollaps/utvid (`card.collapsed` ⇒ `universe.collapsed`, lagres
  og synkes). Trykk-og-hold (touch) / dra (mus) på korthodet = flytt området.
- Det AKTIVE området markeres med ringen i `--focus` (`.card.active`) og med
  `aria-current`, så tilstanden også finnes for en skjermleser.
- **Tastatur:** korthodet er `role="button" tabindex="0"` med `aria-expanded`, og
  Enter/Mellomrom gjør det samme som et klikk der — kollapser/utvider.
  `toggleCardCollapsed` oppdaterer `aria-expanded` når attributtet finnes
  (listekortene på hovedsidens board har ingen tastaturrolle, så der er det no-op).

### Mappe-raden (`.item.group-row`, `#group-row-template`)

Samme rad som et listepunkt, men **uten avmerkingsboks** (mapper krysses ikke
av) og med **del-knapp** (`.group-share`) i stedet for tannhjul.

- Klikk på **navnet** (`.item-text`) = omdøp inline.
- Klikk **ellers på raden** (ikke navn/del/×) = **gå til mappen** (setter aktivt
  område + mappe, `goToGroup`) og **lukk modalen**.
- Den AKTIVE mappen markeres med ringen i `--focus` (`.item.active`) og med
  `aria-current`. Se `docs/tilgjengelighet.md`.
- **Tastatur:** raden er `role="button" tabindex="0"`. Navnet er ikke
  fokuserbart, så Enter/Mellomrom **omdøper når man allerede står i mappen**
  (ellers ville et Enter der bare lukket modalen) og **navigerer** ellers — samme
  kompromiss som chip-radene hadde før nav-modalen. `ev.target !== el`-vakten
  lar del-/slett-knappene beholde sin egen tastaturoppførsel.

### Type-ikon og delt-merke foran navnet

Både områdekortet og mapperaden innleder med **[type-ikon]([delt-ikon])Navn** —
`.kind-icon` (`ICONS.globe` / `ICONS.folder`, samme ikoner som breadcrumben)
først, så `.share-badge` når objektet er delt, så navnet. Rekkefølgen ligger i
malene; byggerne fyller bare ikonet.

Områdekortet får derfor **ikke** den lyse innerkanten delte listekort har
(`.nav-board .card.is-shared` nullstiller den): `.card-body` er gjennomsiktig, så
ringen lyste gjennom nederst og leste som en ramme rundt mappelista. Delt-merket
ved navnet sier det samme uten kanten.

### Mappekategorien (`.category.group-cat`, `#group-cat-template`)

Samme kategori-rad som i en liste (overskrift på områdeflaten + en innrykket
«hylle» med mappene), men **uten innstillinger og uten deling** — kun
**oppløs-knappen** (`.cat-dissolve`) og den grønne ＋-knappen nederst i hylla.
Klikk på overskriftslinjen kollapser/utvider; klikk på tittelen omdøper.

### Søppelkassene

- **Mappe-søppelkassen ligger i områdekortet** — akkurat som listepunkt-
  søppelkassen ligger i lista si. Vises kun når området har slettede mapper.
- **Område-søppelkassen ligger nederst i modalen**, i knapperaden ved siden av
  «＋ [globus]». Vises kun når den har innhold.

Gotcha: å bytte mappe lukker modalen (bytt kontekst og gå), men **sletting
lukker den IKKE** — brukeren skal kunne angre fra søppelkassen med én gang
(søppelkasse-modalen ligger over, samme z-index men senere i DOM).

## Konto-modalen (`#account-modal`, kontoknappen)

Innhold (ovenfra og ned):

- **Profil-linje** (`#menu-account`): avatar (profilbilde, ellers initialene) +
  navn + knappene «Endre bilde»/«Fjern bilde». Selve avataren er OGSÅ knappen
  som velger bilde (kamera-merke nederst til høyre); valget åpner
  bilderedigereren (`#avatar-modal`). Se `docs/accounts.md`.
- **Endre navn** (`#account-name-form`): ett felt for hele navnet →
  `profiles.display_name` (RLS: kun egen rad) + `user_metadata.display_name`
  (fallback før første pull). Se `docs/accounts.md`.
- **Endre e-post** (`#account-email-form`): `auth.updateUser({ email })` —
  ekte Supabase sender bekreftelseslenke (meldingen sier «sjekk innboksen»);
  mock-backenden endrer direkte. `handle_user_email_change`-triggeren
  speiler til `profiles.email` etter bekreftelse.
- **Endre passord** (`#account-pass-form`): nåværende + nytt passord (begge med
  «vis passordet»-knapp). Se `docs/accounts.md`.
- **E-postvarsel-toggle** (`#email-pref-toggle`, se `docs/accounts.md`).
- **«Demonstrasjon av Huskis»** (`#menu-tour`): raden som starter demoen på
  nytt (`#tour-restart` → «Vis på nytt»). Den kjører i en simulering og rører
  aldri innholdet på kontoen. Samme `.menu-setting`-rad som e-postvarselet, men
  med en knapp i stedet for en bryter. Se `docs/introduksjon.md`.
- **«Invitasjoner»-innboksen** (`#menu-invites`, vises kun med innhold).
- **Bunnraden** (`.menu-account-actions`, under en delelinje `.menu-divider` i
  samme stil som `.modal-head` — se `docs/design-system.md` («Delelinjer i
  modaler»)): **«Logg ut»** (GUL, med bekreftelse) i venstre ende og **«Slett
  konto»** (RØD, med søppelkasse-ikon) i høyre. Fargene skiller det reversible
  fra det endelige; avstanden hindrer feiltrykk. Slett-knappen åpner
  `#delete-account-modal` (advarsel + sveip-for-å-bekrefte) — se
  `docs/accounts.md`.

## Del-modalens tilbakeknapp

Overskriften er «[nivå-ikon][navn] — Innstillinger for deling» i VANLIG
tekstflyt: ikonet ligger inline i direkte tilknytning til navnet
(`.share-title-obj`), ikke som egen flex-kolonne til venstre for overskriften.

`openShare(type, id, obj, backTo)`: `backTo` (valgfri funksjon) gjenåpner
modalen del-modalen ble åpnet fra — satt av del-knappene på område-kortene og
mappe-radene (`openNavModal`). Når satt vises `#share-back` (pil-venstre) først
i `modal-head`; klikk lukker del-modalen og kaller `backTo`. **✕/overlay/Escape
lukker helt** — da havner man på hovedsiden, ikke i modalen bak (bevisst: lukk =
ferdig). Listers deling (fra innstillingsmodalen) sender ingen `backTo` og har
dermed ingen tilbakeknapp.

## Flytt liste til annen mappe

Dra en liste (trykk-og-hold på korthodet) opp på **nav-knappen**: knappen
markeres (`.drop-target`) når det finnes andre mapper å flytte til; slipp legger
kortet normalt tilbake på board-et og åpner en velger («Flytt … til:») i
plasserings-modal-skallet (`openPicker`). Velgeren viser mappene i det AKTIVE
området (mappekategorier er overskrifter og listes ikke). Avbrytes velgeren
skjer ingenting. Se `docs/drag-and-drop.md`.

## Modal-infrastruktur

- `updateModalOpenClass()` samler alle modalene (nav/konto/søppel/del/plasser/
  bekreft/innstillinger/popovere) → `body.modal-open` (scroll-lås).
- Escape lukker øverste lag først: tids-popover → ansvarlig-velger →
  bekreftelses-modal → plasser → del (helt) → innstillinger → søppel →
  nav-/konto-modal.
- `.switcher-overlay`/`.switcher-panel`-skallet (popover på desktop, sentrert
  modal på mobil) brukes av ansvarlig-velgeren og tids-popoveren.
