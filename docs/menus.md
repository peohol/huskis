# Menyer: toppmeny (nav-knapp), navigasjonsmodalen, kontoknapp/-modal

Les denne når oppgaven berører toppmenyen, navigasjonsknappen/-modalen (universer
og grupper) eller kontoknappen/konto-modalen.

Prinsipp: **all navigering, redigering, omrokkering og deling av universer og
grupper skjer i ÉN felles modal** — hovedsiden har kun nav-knappen (hvor er jeg)
og listefunksjonene.

Nøkkelidé: **universer og grupper bruker nøyaktig samme oppsett som lister og
listepunkter.** Et univers er et `.card`, en gruppe en `.item`-rad, en
gruppekategori en `.category`. Dermed arves hele kort-/rad-designet OG hele
dra-og-slipp-motoren — se `docs/drag-and-drop.md` («Nav-scopet»).

## Toppmenyen (`.topbar`)

Ett fast panel øverst (`position: fixed`, full bredde, samme DOM på mobil og
desktop). To rader:

1. **Navigasjonsknappen** (`.crumb-btn.nav-crumb`, `#nav-crumb`): ÉN knapp som
   viser hele lokasjonen som en breadcrumb — `🌐 [universnavn] › 📁 [gruppenavn]`
   (`updateCrumbs()`; fallback «Univers»/«Gruppe» når ingenting finnes). Klikk
   åpner nav-modalen. Navnene kappes med ellipsis; raden holder avstand til
   kontoknappen med `padding-right`. På mobil krympes fonten litt (media-query).
2. **Listefunksjonene** (`.panel-actions.toolbar`): «＋ Liste»
   (`#add-card-btn`), liste-søppelkassen (`#trash-btn`) og filterkortet
   (👁️ Mine/Delte, se `docs/colors-and-labels.md`).

Board-ets padding-top settes i JS (`syncHeaderHeight`: målt topbar-høyde +
`--board-gap`) — se `docs/board-layout.md`.

## Kontoknappen (`.account-btn`, `#account-btn`)

Fast i øvre høyre hjørne av VIEWPORTET (`position: fixed; top: 12px; right:
var(--toolbar-pad)`), utenfor toppmenyens flyt — z-index (35) over det faste
panelet (30) men under modaler (200). Person-ikon + rød badge
(`#account-badge`) med antall ventende invitasjoner. Åpner konto-modalen.
Skjules før innlogging (`body.no-auth`).

## Navigasjonsmodalen (`#nav-modal`, åpnes fra nav-knappen)

Overskrift: **«[univers-ikon] Universer og [gruppe-ikon] grupper»**. Innholdet er
ett `.board` (`#nav-board`, klassen `.nav-board`) med ett kort per univers, og
under det en knapperad med «＋ [globus]» og univers-søppelkassen.

- **Alltid ÉN kolonne**, uansett skjermbredde — i motsetning til hovedsidens
  board. Kolonnene lages av det samme `relayoutBoard`-maskineriet
  (`docs/board-layout.md`), men nav-scopet setter `singleColumn`.
- **Bygges bare når modalen er åpen** (`renderNav()` returnerer tidlig når
  `navModal.hidden`): en usett DOM-kopi av alle universer/grupper koster ved hver
  render, og ville dessuten gitt doble treff for `.card`/`.item` på tvers av de to
  board-ene. `openNavModal()` setter derfor `hidden = false` FØR den kaller
  `renderNav()`.

### Univers-kortet (`.card.uni-card`, `#uni-card-template`)

Samme oppbygning som et listekort (`.card-head` + `.card-body`), med disse
forskjellene:

| Listekort | Univers-kort |
|---|---|
| tannhjul (`.card-cog`) → innstillingsmodal | **del-knapp** (`.uni-share`, samme knappestil) → del-modalen |
| «(N)» ved navnet når kollapset | **[gruppe-ikon] + antall** (`.collapse-count.uni-count`) |
| «Utført»-seksjon + ⟲ | — (grupper krysses ikke av) |
| ＋ listepunkt / gul kategori-knapp | **＋ gruppe / gul gruppekategori-knapp** (`ICONS.groupCategory`) |
| listepunkt-søppelkasse i body-en | **gruppe-søppelkasse** i body-en (`.group-trash-btn`) |

- Klikk på **tittelen** = omdøp inline. Klikk **ellers på korthodet** (ikke
  tittel/del/×) = kollaps/utvid (`card.collapsed` ⇒ `universe.collapsed`, lagres
  og synkes). Trykk-og-hold (touch) / dra (mus) på korthodet = flytt universet.
- Det AKTIVE universet markeres med den grønne brand-ringen (`.card.active`).

### Gruppe-raden (`.item.group-row`, `#group-row-template`)

Samme rad som et listepunkt, men **uten avmerkingsboks** (grupper krysses ikke
av) og med **del-knapp** (`.group-share`) i stedet for tannhjul.

- Klikk på **navnet** (`.item-text`) = omdøp inline.
- Klikk **ellers på raden** (ikke navn/del/×) = **gå til gruppen** (setter aktivt
  univers + gruppe, `goToGroup`) og **lukk modalen**.
- Den AKTIVE gruppen markeres med brand-ringen (`.item.active`).

### Gruppekategorien (`.category.group-cat`, `#group-cat-template`)

Samme kategori-rad som i en liste (overskrift på universflaten + en innrykket
«hylle» med gruppene), men **uten innstillinger og uten deling** — kun
**oppløs-knappen** (`.cat-dissolve`) og den grønne ＋-knappen nederst i hylla.
Klikk på overskriftslinjen kollapser/utvider; klikk på tittelen omdøper.

### Søppelkassene

- **Gruppe-søppelkassen ligger i universkortet** — akkurat som listepunkt-
  søppelkassen ligger i lista si. Vises kun når universet har slettede grupper.
- **Univers-søppelkassen ligger nederst i modalen**, i knapperaden ved siden av
  «＋ [globus]». Vises kun når den har innhold.

Gotcha: å bytte gruppe lukker modalen (bytt kontekst og gå), men **sletting
lukker den IKKE** — brukeren skal kunne angre fra søppelkassen med én gang
(søppelkasse-modalen ligger over, samme z-index men senere i DOM).

## Konto-modalen (`#account-modal`, kontoknappen)

Innhold (ovenfra og ned):

- **Profil-linje**: initial-avatar + navn (`#menu-account`).
- **Endre navn** (`#account-name-form`): ett felt for hele navnet →
  `profiles.display_name` (RLS: kun egen rad) + `user_metadata.display_name`
  (fallback før første pull). Se `docs/accounts.md`.
- **Endre e-post** (`#account-email-form`): `auth.updateUser({ email })` —
  ekte Supabase sender bekreftelseslenke (meldingen sier «sjekk innboksen»);
  mock-backenden endrer direkte. `handle_user_email_change`-triggeren
  speiler til `profiles.email` etter bekreftelse.
- **E-postvarsel-toggle** (`#email-pref-toggle`, se `docs/accounts.md`).
- **«Invitasjoner»-innboksen** (`#menu-invites`, vises kun med innhold).
- **«Logg ut»** nederst (rød knapp, med bekreftelse), over en delelinje
  (`.menu-divider`) i samme stil som `.modal-head` — se
  `docs/design-system.md` («Delelinjer i modaler»).

## Del-modalens tilbakeknapp

Overskriften er «[nivå-ikon][navn] — Innstillinger for deling» i VANLIG
tekstflyt: ikonet ligger inline i direkte tilknytning til navnet
(`.share-title-obj`), ikke som egen flex-kolonne til venstre for overskriften.

`openShare(type, id, obj, backTo)`: `backTo` (valgfri funksjon) gjenåpner
modalen del-modalen ble åpnet fra — satt av del-knappene på univers-kortene og
gruppe-radene (`openNavModal`). Når satt vises `#share-back` (pil-venstre) først
i `modal-head`; klikk lukker del-modalen og kaller `backTo`. **✕/overlay/Escape
lukker helt** — da havner man på hovedsiden, ikke i modalen bak (bevisst: lukk =
ferdig). Listers deling (fra innstillingsmodalen) sender ingen `backTo` og har
dermed ingen tilbakeknapp.

## Flytt liste til annen gruppe

Dra en liste (trykk-og-hold på korthodet) opp på **nav-knappen**: knappen
markeres (`.drop-target`) når det finnes andre grupper å flytte til; slipp legger
kortet normalt tilbake på board-et og åpner en velger («Flytt … til:») i
plasserings-modal-skallet (`openPicker`). Velgeren viser gruppene i det AKTIVE
universet (gruppekategorier er overskrifter og listes ikke). Avbrytes velgeren
skjer ingenting. Se `docs/drag-and-drop.md`.

## Modal-infrastruktur

- `updateModalOpenClass()` samler alle modalene (nav/konto/søppel/del/plasser/
  bekreft/innstillinger/popovere) → `body.modal-open` (scroll-lås).
- Escape lukker øverste lag først: tids-popover → ansvarlig-velger →
  bekreftelses-modal → plasser → del (helt) → innstillinger → søppel →
  nav-/konto-modal.
- `.switcher-overlay`/`.switcher-panel`-skallet (popover på desktop, sentrert
  modal på mobil) brukes av ansvarlig-velgeren og tids-popoveren.
