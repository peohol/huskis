# Innstillingsmodal og tidsplanlegging (start/frist)

Les denne når oppgaven gjelder tannhjul-knappene, innstillingsmodalen,
indikator-chipene under liste-/elementnavn, eller start-/frist-tider.

## Innstillingsmodalen (`#settings-modal`, `openSettings(kind, id)`)

Én felles modal for lister og elementer, åpnet fra **tannhjulet**
(`.card-cog` på listekort — erstattet den gamle del-knappen; `.item-cog` på
elementer — erstattet den gamle ansvarsknappen). Seksjoner, i rekkefølge:

1. **Navn**: redigerbart `.field` (liste-ikon foran for lister). Lagres
   fortløpende per tastetrykk (stampContent + save; board-DOM oppdateres
   direkte uten full render, full render skjer ved lukking). Tomt felt
   committes ikke og gjenopprettes ved blur.
2. **Deling** (kun lister, kontomodus, `isMine(obj) || obj._mount` — MERK
   `isMine`, ikke `_mine`: en nyopprettet liste mangler metadata til første
   pull men er min): samme innhold som del-modalen. `renderShareOwner`/
   `renderShareRecipient` tar nå en `body`-container og gjenbrukes av både
   del-modalen (univers/gruppe) og denne seksjonen. Alle handlinger går via
   operasjonskøen som før (`docs/accounts.md`).
3. **Ansvarlig** (delt kontekst, `shareRootFor` — gjelder nå OGSÅ hele
   listen, `card.responsible`): rad med nåværende ansvarlig (initial-sirkel +
   navn) → åpner ansvarlig-velgeren. Velgeren er generalisert til targets
   (`{ kind: 'card'|'item', obj, card }`); `setResponsible(target, userId)`.
4. **Tidsplan** (alltid, også utenfor kontomodus): se under.

Ingen bekreftelsesknapp noe sted — alt settes fortløpende og optimistisk.
Modalen slår alltid opp det LEVENDE objektet på id per interaksjon
(`liveTarget`/`settingsTarget`), så den tåler synk-rebuilds mens den er åpen.

## Tidsverdier og semantikk

- Verdi: `null` | `'YYYY-MM-DD'` | `'YYYY-MM-DDTHH:MM'` — dato + valgfritt
  klokkeslett (to inputs per rad: `type=date` + `type=time` + fjern-✕).
  Lagres som lokal «vegg-tid» (tekst), bevisst ikke UTC-timestamp: «14. juli»
  skal bety 14. juli overalt, og UI-et må vite om klokkeslett er definert.
- `start` = når noe BØR påbegynnes, `due` (frist) = når det bør være utført.
  Ingen av dem håndheves — bare visualiseres.
- Feltene finnes på både elementer og lister og rir på **innholds-registeret**
  (`ts`/`org`, LWW) som tekst/done/responsible.
- **`card.lockTimes`**: avkryssing i listens tidsmodul («Lås tidene også til
  elementene i listen»). Da styrer listens tider elementene: elementenes egne
  tids-chips skjules, og tidsfeltene i element-modalen er disablet og viser
  listens tider + notis («Tidene styres av listen …»). Elementenes egne
  verdier beholdes i data (kommer tilbake om låsen skrus av).
- **Utenfor listens tidsrom**: et element KAN få tider utenfor listens
  `start`–`due`-vindu; tidsmodulen viser da en subtil beskjed med tre
  varianter (start / frist / begge «… er utenfor listens tidsrom», se
  `outsideFlags`). Sammenligning på dato-nivå når minst én av verdiene
  mangler klokkeslett (`cmpTime`), ellers på fullt tidspunkt.

## Indikator-chips (`.meta-row` under navnet)

`fillMetaRow(row, target, canEdit)` fyller raden under liste-tittelen
(`.card-meta`, i `.card-title-wrap`) og element-teksten (`.item-meta`, i
`.item-main`). Kun innstillinger som faktisk er satt vises; tom rad skjules.
Chipene er KNAPPER for hurtigendring:

- **Delt** (kun lister): people-/lås-ikon → åpner innstillingsmodalen.
  (Erstattet kortets gamle `.share-badge` i headeren; grupper/universer
  beholder badge-en via `applyShareBadge`.)
- **Ansvarlig**: liten initial-sirkel (`respAvatar`, palett fra delegruppen)
  → åpner ansvarlig-velgeren direkte, forankret i chipen.
- **Start** (kalenderikon) og **frist** (kalender-med-utropstegn,
  `ICONS.calendarDue`) → åpner tids-popoveren (`openTimeQuick`,
  `#time-switcher` — samme skall som bytterne: popover på desktop, sentrert
  modal på mobil) med kun den ene raden.

Chip-innhold: datoen (`fmtDay`: «14. jul», + årstall når ≠ i år) — MEN hvis
datoen er I DAG og et klokkeslett er definert, vises i stedet klokkeslettet
med klokkeikon. Fargestatus (regnes på dato-nivå, `startStatus`/`dueStatus`):

- start: nøytral (uten farge) frem i tid → **grønn** f.o.m. startdatoen.
- frist: nøytral → **gul** dagen før fristen → **rød** f.o.m. fristdatoen.

Fargene bruker knappesystemets gradienter (`--grad-green/-yellow/-red`).

## Synk/DB

Doc-radene har `start`/`due` (element + liste) og `lockTimes`/`responsible`
(liste); DB-kolonnene heter `start_at`/`due_at` (text), `lock_times`
(boolean) og `cards.responsible` (uuid → profiles, `on delete set null`).
Oppdatert hele veien: `cleanItem`/`cleanCard`, `mergeItem`/`mergeCardScalar`,
`canonRow` (mount-grenen), `insert-`/`updatePayload`, mock-backend,
`supabase/users-and-sharing.sql` (idempotente `add column if not exists`,
LWW-triggere, `get_my_doc`, `import_doc`). Kontomodus mot ekte Supabase
krever at db-setup-workflowen kjøres — se `TODO.md`.
