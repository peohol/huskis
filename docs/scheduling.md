# Tidsplanlegging (start/frist) og objektmenyens tidsskuff

Les denne når oppgaven gjelder start-/fristtider, tids-editoren eller
indikator-chipene under liste-/listepunktnavn.

## Hvor tidene redigeres

Den gamle innstillingsmodalen finnes ikke lenger. Tidene ligger nå to steder,
og begge bygger den SAMME editoren (`buildTimeEditor(getTarget, opts)`):

1. **Objektmenyens «Tidsplan»-skuff** — full visning (start + frist + evt.
   lås-avkryssing). Gjelder lister, listepunkter og kategorier. Menyen selv er
   beskrevet i `docs/menus.md`.
2. **Tids-popoveren** (`openTimeQuick`, `#time-switcher`) — én rad, åpnet fra
   start-/frist-chipen i meta-raden (`opts.only`).

Kategorier har — som lister — en **lås-avkryssing** som låser kategoriens tider
til listepunktene i den (`category.lockTimes`).

I fullvisningen er hvert feltpar (dato + klokkeslett) gruppert under en egen
overskrift med ikon — **«Starttid»** (kalender) og **«Tidsfrist»**
(kalender-m/-utropstegn); klokkeikonet står som eget element ved siden av
klokkeslett-feltet (ikke inni inputen). Tids-popoveren har sin egen tittel og
hopper derfor over feltpar-overskriften.

**Navn** redigeres ikke lenger i et modalfelt: menyens «Endre navn» åpner
navneredigereren på plassen (`editText` på selve tittelen).

**Ansvarlig** ligger i menyens «Ansvarlig»-skuff, og vises kun når MAPPEN er
delt (`shareRootFor` → mappen — gjelder OGSÅ hele listen, `card.responsible`).
Radene er de samme som ansvarlig-velgeren bruker;
`setResponsible(target, userId)` skriver valget.

**Deling** finnes ikke på lister: tilgangen arves fra mappen (se
`docs/rettigheter-og-deling.md`), og listens meny har derfor ingen delerad —
delingen gjøres fra mappens meny.

Ingen bekreftelsesknapp noe sted — alt settes fortløpende og optimistisk.
Editoren slår alltid opp det LEVENDE objektet på id per interaksjon
(`liveTarget`), så den tåler synk-rebuilds mens den står åpen.

## Tidsverdier og semantikk

- Verdi: `null` | `'YYYY-MM-DD'` | `'YYYY-MM-DDTHH:MM'` — dato + valgfritt
  klokkeslett (to inputs per rad: `type=date` + `type=time` + fjern-✕).
  Lagres som lokal «vegg-tid» (tekst), bevisst ikke UTC-timestamp: «14. juli»
  skal bety 14. juli overalt, og UI-et må vite om klokkeslett er definert.
- `start` = når noe BØR påbegynnes, `due` (frist) = når det bør være utført.
  Ingen av dem håndheves — bare visualiseres.
- Feltene finnes på både listepunkter og lister og rir på **innholds-registeret**
  (`ts`/`org`, LWW) som tekst/done/responsible.
- **`card.lockTimes` / `category.lockTimes`**: avkryssing i tidsmodulen som
  låser en containers tider til listepunktene i den. Presedens (`timeController`):
  listen (kort) har forrang for ALLE sine listepunkter (også de i kategorier);
  ellers styrer en kategori med `lockTimes` bare sine egne listepunkter. Er et
  listepunkt låst, skjules dets egne tids-chips, og tidsfeltene i listepunktets
  tidsskuff er disablet og viser containerens tider + notis («Tidene styres av listen/
  kategorien …»). Elementenes egne verdier beholdes i data (kommer tilbake om
  låsen skrus av). En kategori viser alltid sine EGNE tids-chips (dens
  `lockTimes` gjelder listepunktene, ikke kategorien selv).
- **Utenfor listens tidsrom**: et listepunkt KAN få tider utenfor listens
  `start`–`due`-vindu; tidsmodulen viser da en subtil beskjed med tre
  varianter (start / frist / begge «… er utenfor listens tidsrom», se
  `outsideFlags`). Sammenligning på dato-nivå når minst én av verdiene
  mangler klokkeslett (`cmpTime`), ellers på fullt tidspunkt.

## Indikator-chips (`.meta-row` under navnet)

`fillMetaRow(row, target, canEdit)` fyller raden under liste-tittelen
(`.card-meta`, i `.card-title-wrap`) og listepunkt-teksten (`.item-meta`, i
`.item-main`). Kun innstillinger som faktisk er satt vises; tom rad skjules.
Chipene er KNAPPER for hurtigendring:

- **Ansvarlig**: liten initial-sirkel (`respAvatar`, palett fra delegruppen)
  → åpner ansvarlig-velgeren direkte, forankret i chipen.
- **Start** (kalenderikon) og **frist** (kalender-med-utropstegn,
  `ICONS.calendarDue`) → åpner tids-popoveren (`openTimeQuick`,
  `#time-switcher` — samme skall som ansvarlig-velgeren: popover på desktop, sentrert
  modal på mobil) med kun den ene raden.

Chip-innhold: datoen (`fmtDay`: «14. jul», + årstall når ≠ i år) — MEN hvis
datoen er I DAG og et klokkeslett er definert, vises i stedet klokkeslettet
med klokkeikon. Fargestatus (regnes på dato-nivå, `startStatus`/`dueStatus`):

- start: nøytral (uten farge) frem i tid → **grønn** f.o.m. startdatoen.
- frist: nøytral → **gul** dagen før fristen → **rød** f.o.m. fristdatoen.

Fargene bruker knappesystemets gradienter (`--grad-green/-yellow/-red`).

## Synk/DB

Doc-radene har `start`/`due` (listepunkt + liste + kategori) og `lockTimes`/
`responsible` (liste + kategori); DB-kolonnene heter `start_at`/`due_at` (text),
`lock_times` (boolean, nå også på `items` for kategorier) og `cards.responsible`
(uuid → profiles, `on delete set null`). Kategorier lever i `items`-tabellen
(`items.is_cat`, `items.cat_id` → self-FK, `items.lock_times`) — se
`docs/data-model.md`.
Oppdatert hele veien: `cleanItem`/`cleanCard`, `mergeItem`/`mergeCardScalar`,
`canonRow` (`_canon`-grenen), `insert-`/`updatePayload`, mock-backend,
`supabase/users-and-sharing.sql` (idempotente `add column if not exists`,
LWW-triggere, `get_my_doc`, `import_doc`). Skjemaet kjøres av
«Supabase DB-oppsett»-workflowen ved push til `main`.
