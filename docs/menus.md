# Menyer: toppmeny (breadcrumb), univers-/gruppe-modal, kontoknapp/-modal

Les denne når oppgaven berører toppmenyen, breadcrumb-navigasjonen,
univers-/gruppe-modalene eller kontoknappen/konto-modalen.

Prinsipp: **all navigering, redigering og deling av universer og grupper skjer
i deres respektive modaler** — hovedsiden har kun breadcrumben (hvor er jeg) og
listefunksjonene. Gruppene ligger IKKE lenger som kort på hovedsiden.

## Toppmenyen (`.topbar`)

Ett fast panel øverst (`position: fixed`, full bredde, samme DOM på mobil og
desktop — ingen sidebar/media-query-veksling lenger). To rader:

1. **Breadcrumb** (`.breadcrumb`): `🌐 [universnavn] › 📁 [gruppenavn]` — to
   knapper (`.crumb-btn`, `#uni-crumb`/`#group-crumb`) med nivå-ikon + navnet
   på gjeldende univers/gruppe (`updateCrumbs()` i `render()`; fallback
   «Univers»/«Gruppe» når ingenting finnes). Klikk åpner univers-/gruppe-
   modalen. Navnene kappes med ellipsis; raden holder avstand til kontoknappen
   med `padding-right`. På mobil krympes fonten litt (media-query).
2. **Listefunksjonene** (`.panel-actions.toolbar`): «＋ Liste»
   (`#add-card-btn`), liste-søppelkassen (`#trash-btn`) og filterkortet
   (👁️ Mine/Delte, se `docs/colors-and-labels.md`). Kun listefunksjoner her —
   ingen gruppe-/univers-knapper.

Board-ets padding-top settes i JS (`syncHeaderHeight`: målt topbar-høyde +
`--board-gap`, samme verdi på alle skjermstørrelser) — se
`docs/board-layout.md`.

## Kontoknappen (`.account-btn`, `#account-btn`)

Fast i øvre høyre hjørne av VIEWPORTET (`position: fixed; top: 12px; right:
var(--toolbar-pad)`), utenfor toppmenyens flyt — z-index (35) over det faste
panelet (30) men under modaler (200). Person-ikon + rød badge
(`#account-badge`) med antall ventende invitasjoner. Åpner konto-modalen.
Skjules før innlogging (`body.no-auth`).

## Univers-modalen (`#uni-modal`, åpnes fra 🌐-breadcrumben)

- **Øverst «Du er i»** (`.modal-current`): navnet på det aktive universet på
  en chip-farget flate (`#uni-current-chip`, ikke klikkbar) og **del-univers-
  knappen** (`.share-btn`, `#share-uni-btn`, kun kontomodus/eier-eller-mount)
  rett under. Del-knappen lukker univers-modalen og åpner del-modalen med
  tilbakeknapp (se «Del-modalens tilbakeknapp» under).
- **«Alle universer»**: univers-rader (`.uni-row.chip` — håndtak, farget,
  aktiv m/ ring, antall-pill med gruppe-ikon + antall grupper (`.chip-count`),
  ✕ helt til høyre), «＋ [univers-ikon]» og univers-søppelkassen (se
  `docs/trash.md`).
- Klikk på en rad = **bytt univers + lukk modalen**; klikk på det aktive
  navnet = omdøp; opprettelse holder modalen åpen (navnet redigeres inline).
  `setActiveUniverse` gjenoppretter sist aktive gruppe i universet
  (`activeGroups`, se `docs/data-model.md`).
- **Rekkefølge**: dra-og-slipp via håndtaket (placeholder + FLIP) eller
  piltaster på håndtaket; auto-scroll ruller modalens `.menu-body`. Se
  `docs/drag-and-drop.md`.

## Gruppe-modalen (`#group-modal`, åpnes fra 📁-breadcrumben)

Nøyaktig samme oppbygning som univers-modalen, for gruppene i det AKTIVE
universet: «Du er i»-blokk med aktiv gruppe + del-gruppe-knapp
(`#share-group-btn`), «Alle grupper i universet» (`.group-card.chip`-rader i
`#group-list`, antall-pill = liste-ikon + antall lister), «＋ Gruppe» og
gruppe-søppelkassen. Klikk på rad = bytt gruppe + lukk modalen; aktiv rad =
omdøp; «＋ Gruppe» holder modalen åpen med inline-omdøping. Gruppe-radene er
alltid én vertikal kolonne (V-varianten av dra-logikken — H-varianten fra den
gamle mobil-raden er fjernet).

Gotcha: bytte av gruppe/univers lukker modalen (bytt kontekst og gå), men
**sletting lukker den IKKE** — brukeren skal kunne angre fra søppelkassen med
én gang (søppelkasse-modalen ligger over, samme z-index men senere i DOM).

`refreshModalCurrents()` (kalles i `render()` og ved åpning) holder «Du er
i»-blokkene og del-knappenes synlighet i takt.

## Konto-modalen (`#account-modal`, erstatter den gamle meny-modalen/☰)

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

`openShare(type, id, obj, backTo)`: `backTo` (valgfri funksjon) gjenåpner
modalen del-modalen ble åpnet fra — satt av del-knappene i univers-/gruppe-
modalen (`openUniModal`/`openGroupModal`). Når satt vises `#share-back`
(pil-venstre) først i `modal-head`; klikk lukker del-modalen og kaller
`backTo`. **✕/overlay/Escape lukker helt** — da havner man på hovedsiden,
ikke i modalen bak (bevisst: lukk = ferdig). Listers deling (fra
innstillingsmodalen) sender ingen `backTo` og har dermed ingen tilbakeknapp.

## Flytt liste til annen gruppe (uten gruppekort på hovedsiden)

Dra en liste (håndtaket) opp på **📁-breadcrumben**: knappen markeres
(`.drop-target`) når det finnes andre grupper å flytte til; slipp legger
kortet normalt tilbake på board-et og åpner en velger («Flytt … til:») i
plasserings-modal-skallet (`openPicker`). Avbrytes velgeren skjer ingenting.
Se `docs/drag-and-drop.md`.

## Modal-infrastruktur

- `updateModalOpenClass()` samler alle modalene (uni/gruppe/konto/søppel/del/
  plasser/bekreft/innstillinger/popovere) → `body.modal-open` (scroll-lås).
- Escape lukker øverste lag først: tids-popover → ansvarlig-velger →
  bekreftelses-modal → plasser → del (helt) → innstillinger → søppel →
  univers/gruppe/konto-modal.
- `.switcher-overlay`/`.switcher-panel`-skallet (popover på desktop, sentrert
  modal på mobil) brukes nå kun av ansvarlig-velgeren og tids-popoveren —
  univers-/gruppebytterne (panel-title-knappene) er fjernet; breadcrumb-
  modalene er den ene måten å navigere på.
