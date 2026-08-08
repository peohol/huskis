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

## Objektmenyen (`.obj-menu-btn` → `#obj-menu`)

**Autoritativt for hva et objekt kan gjøre og hvor man finner det.**

Alle seks objekttypene — **område, mappe, mappekategori, liste, listepunkt og
kategori** — har NØYAKTIG én knapp til høyre: menyknappen (tre prikker,
`ICONS.menuDots`). Den erstatter tannhjulet, ✕, del-knappen, forlat-knappen og
oppløs-knappen, og har avviklet den gamle innstillingsmodalen helt. Målet er
færre synlige knapper og ingen kamp mellom to funksjoner om det samme trykket.

Knappen arver flate og størrelse fra kontrollen den erstattet på hvert nivå, så
ingen ny knappestil er innført:

| Nivå | Klasser på menyknappen |
|---|---|
| Område / liste (korthode) | `.card-cog.obj-menu-btn` |
| Mappe / listepunkt (rad) | `.item-cog.obj-menu-btn` |
| Mappekategori / kategori (overskrift) | `.cat-cog.obj-menu-btn` |

### Form

**Popover** forankret i knappen på desktop (`min-width: 561px`), **sentrert ark**
på mobil — samme `.switcher-overlay`/`.switcher-panel`-skall som ansvarlig-
velgeren og tids-popoveren, så det finnes bare én popover-mekanikk i appen.
Panelet innledes med en overskrift som sier hvilket objekt menyen gjelder
(type-ikon + navn); på mobil dekker arket raden det kom fra, og uten navnet er
det ikke mulig å se hva man holder på med.

### Radene

Rekkefølgen er fast; rader som ikke gjelder objektet **utelates helt** (en
avskrudd rad er verre enn ingen rad). Alt gates av de samme capabilities som
knappene brukte, og feiler LUKKET — se `docs/rettigheter-og-deling.md`.

| # | Rad | Gjelder | Gate |
|---|---|---|---|
| 1 | **Endre navn** | alle | `editContent` / `!frozen` |
| 2 | **Ansvarlig** ▸ | liste, listepunkt, kategori i DELT mappe | mappen er delt |
| 3 | **Tidsplan** ▸ | liste, listepunkt, kategori | — (feltene låses av `timeController`) |
| 4 | **Flytt** ▸ | alle som kan omrokkeres | `canReorderObj` |
| 5 | **Deling og medlemmer** | område, mappe | — (medlemslisten er åpen for alle med tilgang) |
| 6 | **Lås / Åpne** (eller **Gjør/Fjern unntak**) | delt område, delt mappe | `manageLock` / `lockException` |
| 7 | **Forlat …** | delt område, delt mappe | `leave` |
| 8 | **Slett …** / **Løs opp …** | alle man kan fjerne | `delete` / `!frozen` |

**Sletting står SIST**, bak en skillelinje og i rødt (`.obj-menu-row.is-danger`).
Den er den eneste raden som fjerner noe, og den skal ikke ligge der fingeren
treffer først når menyen åpner seg.

**Bare område og mappe har delingsraden.** Det er de to nivåene som kan deles;
lister, listepunkter og kategorier arver tilgangen og har ingen egen
medlemsliste (`docs/rettigheter-og-deling.md`). En delerad i LISTENS meny leses
som om det er lista man deler, og den finnes derfor ikke — delingen gjøres der
myndigheten ligger, i mappens meny. At mappen er delt vises fortsatt på
listekortet med `.share-badge`.

### Trekkspillet

«Flytt», «Ansvarlig» og «Tidsplan» er skuffer (`.obj-menu-sub`) under sin
overskriftsrad. **Kun ÉN skuff kan være åpen om gangen** — å åpne en ny lukker
den forrige, begge med animert høyde (`slideObjSub`, 180 ms). Uten det ville
menyen blitt lengre enn skjermen på mobil.

Skuffene er skilt med hårfine linjer — fra hverandre og fra de vanlige radene
over og under. En fane som kan folde seg ut er en egen blokk, ikke nok en rad i
rekka. Linjene ligger som `border-top` på selve gruppen (ikke som egne
elementer), så nabo-faner deler én linje og ingen ekstra luft snik-legges inn.
Raden UNDER en skuff får linjen som et eget strøk i `::before` i stedet: radene
er avrundet, og en `border-top` på dem buer i endene. Alle skillelinjene i
menyen skal være flate.

Innholdet i en skuff er rykket inn, så nivåene leses uten egne rammer. Radene
(«Flytt opp», ansvarlig-radene) har sin egen polstring og får innrykket gratis;
tids-editoren har det ikke, og får det derfor eksplisitt — samme venstrekant.

- **Flytt** ▸ «Flytt opp» / «Flytt ned» (`keyboardReorder`, ett hakk per trykk,
  menyen blir stående så flere hakk kan tas etter hverandre) og «Flytt til …»
  (`keyboardMoveTo`, åpner velger-modalen). Dette er dra-og-slippets motstykke
  for den som ikke kan eller vil dra — se `docs/tilgjengelighet.md`.
- **Ansvarlig** ▸ de samme radene som ansvarlig-velgeren, men inne i menyen: en
  popover oppå en popover ville lagt to lag over samme knapp.
- **Tidsplan** ▸ hele tids-editoren (`buildTimeEditor`) — se `docs/scheduling.md`.

### Menyen tåler at DOM-en bygges om

Alt slås opp på id (`objMenuLive`), aldri på en fanget objektreferanse, og
ankeret finnes igjen med selektor (`objMenuAnchor`) etter en rendring — en
sortering fra menyen bygger jo board-et om under den. `repaintObjMenu()` maler
radene på nytt (etter lås, ansvar, sortering) uten å lukke, og beholder den åpne
skuffen. Forsvinner objektet, lukker menyen seg.

## Sletting: dra objektet i søppelkassen

Objektmenyens siste rad er den ene måten, dra-og-slipp den andre: løfter man et
objekt, dukker søppelkassen for nivået opp, og et slipp i den sletter. Samme
gest på desktop og mobil, samme motor som all annen flytting.

Kategorier har ingen kasse — de **løses opp** fra menyen (listepunktene blir
stående). Autoritativt: `docs/trash.md` («Slett ved å dra objektet i kassen»).

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
| «(N)» ved navnet når kollapset | **[mappe-ikon] + antall** (`.collapse-count.uni-count`) |
| «Utført»-seksjon + ⟲ | — (mapper krysses ikke av) |
| ＋ listepunkt / gul kategori-knapp | **＋ mappe / gul mappekategori-knapp** (`ICONS.groupCategory`) |
| listepunkt-søppelkasse i body-en | **mappe-søppelkasse** i body-en (`.group-trash-btn`) |

Begge har den samme ene knappen til høyre: **objektmenyen** (`.obj-menu-btn`,
se under).

- Klikk **hvor som helst på korthodet** (unntatt menyknappen) = kollaps/utvid
  (`card.collapsed` ⇒ `universe.collapsed`, lagres og synkes) — også på
  tittelen. Trykk-og-hold (touch) / dra (mus) på korthodet = flytt området.
- **Omdøping går via menyen** (eller F2 på korthodet); et klikk på navnet
  omdøper ikke lenger.
- Det AKTIVE området markeres med ringen i `--focus` (`.card.active`) og med
  `aria-current`, så tilstanden også finnes for en skjermleser.
- **Tastatur:** korthodet er `role="button" tabindex="0"` med `aria-expanded`, og
  Enter/Mellomrom gjør det samme som et klikk der — kollapser/utvider.
  `toggleCardCollapsed` oppdaterer `aria-expanded` når attributtet finnes
  (listekortene på hovedsidens board har ingen tastaturrolle, så der er det no-op).
- Fri-beholderen (`.free-groups-card`) har ingen meny: den er en seksjon, ikke
  et område, og har ingenting å tilby (`menuBtn.hidden = true`).

### Mappe-raden (`.item.group-row`, `#group-row-template`)

Samme rad som et listepunkt, men **uten avmerkingsboks** (mapper krysses ikke
av). Én knapp til høyre: objektmenyen.

- Klikk **hvor som helst på raden** — navnet inkludert — = **gå til mappen**
  (setter aktivt område + mappe, `goToGroup`) og **lukk modalen**.
- **Omdøping går via menyen** (eller F2). Dette er hele grunnen til at klikk på
  navnet ikke lenger omdøper: omdøping og navigering kjempet om det samme
  trykket, og navigering er det man gjør ti ganger oftere.
- Den AKTIVE mappen markeres med ringen i `--focus` (`.item.active`) og med
  `aria-current`. Se `docs/tilgjengelighet.md`.
- **Tastatur:** raden er `role="button" tabindex="0"`; Enter/Mellomrom
  navigerer, F2 omdøper. `ev.target !== el`-vakten lar menyknappen beholde sin
  egen tastaturoppførsel.

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
«hylle» med mappene). Én objektmenyknapp i overskriften (der ligger «Løs opp
mappekategorien») og den grønne ＋-knappen nederst i hylla. Klikk på
overskriftslinjen kollapser/utvider; **klikk på tittelen omdøper** — kategorier
og listepunkter beholder hurtig-omdøpingen, fordi de ikke har noen annen
handling å kollidere med.

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
modalen del-modalen ble åpnet fra — satt av «Deling og medlemmer» i
objektmenyen på område-kortene og mappe-radene (`openNavModal`). Når satt vises
`#share-back` (pil-venstre) først i `modal-head`; klikk lukker del-modalen og
kaller `backTo`. **✕/overlay/Escape lukker helt** — da havner man på
hovedsiden, ikke i modalen bak (bevisst: lukk = ferdig). Begge veiene inn i
del-modalen går i dag gjennom nav-modalen og sender derfor `backTo`; uten den
vises ingen tilbakeknapp (fortsatt tilfellet for programmatiske kall, f.eks.
fra testene).

## Flytt liste til annen mappe

Dra en liste (trykk-og-hold på korthodet) opp på **nav-knappen**: knappen
markeres (`.drop-target`) når det finnes andre mapper å flytte til; slipp legger
kortet normalt tilbake på board-et og åpner en velger («Flytt … til:») i
plasserings-modal-skallet (`openPicker`). Velgeren viser mappene i det AKTIVE
området (mappekategorier er overskrifter og listes ikke). Avbrytes velgeren
skjer ingenting. Se `docs/drag-and-drop.md`.

## Modal-infrastruktur

- `updateModalOpenClass()` samler alle modalene (nav/konto/søppel/del/plasser/
  bekreft/objektmeny/popovere) → `body.modal-open` (scroll-lås).
- Escape lukker øverste lag først: tids-popover → ansvarlig-velger →
  bekreftelses-modal → plasser → del (helt) → objektmeny → søppel →
  nav-/konto-modal.
- `.switcher-overlay`/`.switcher-panel`-skallet (popover på desktop, sentrert
  modal på mobil) brukes av objektmenyen, ansvarlig-velgeren og tids-popoveren.
- Fokus inn/ut av en overlay håndteres av ÉN felles fokusfelle
  (`overlayOpened`/`overlayClosed`, en MutationObserver på `hidden`) — ingen
  åpne-/lukkefunksjon fokuserer «tilbake» selv.
