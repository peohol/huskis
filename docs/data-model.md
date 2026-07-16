# Datamodell og arkitektur

Les denne når oppgaven berører state-strukturen, foreldre-peker-logikk, eller
per-enhet-minnet for aktiv gruppe/univers.

## Arkitektur

- **Ren statisk app**: `index.html` + `styles.css` + `app.js`. Ingen byggesteg, ingen rammeverk.
- **Vanilla JS** med egen dra-og-slipp-motor på Pointer Events (mus + touch likt) — se `docs/drag-and-drop.md`.
- **Persistens** i `localStorage` (offline-buffer per konto); sanntids-synk mot
  Supabase (Auth + relasjonelle tabeller) — se `docs/accounts.md`.

## State-form (nøstet i minnet for rendring, flat i synk-doc'et)

```js
state = {
  activeUniverse: <uniId>,     // aktiv posisjon (se under)
  activeGroup: <groupId>,      // aktiv posisjon (se under)
  activeGroups: { uniId: groupId }, // per enhet: sist aktive gruppe per univers
  universes: [
    { id, name, trashed, pos,  // + registre: ts/org (innhold), posTs/posOrg (rekkefølge)
      groups: [
        { id, uni, name, trashed, pos,   // uni = univers-forelder
          cards: [                        // «lister»
            { id, group, title, color, trashed, k, p, // k/p: legacy, se docs/colors-and-labels.md
              responsible, start, due, lockTimes,     // ansvarlig + tidsplan for hele listen (docs/scheduling.md)
              items: [ { id, text, trashed, done, responsible, start, due, home, cat, isCat, lockTimes } ] } ] } ] } // done: avkrysset; responsible: ansvarlig bruker-id (delte lister); start/due: tidsplan; cat/isCat/lockTimes: kategorier (se under)
  ],
  _tomb: { universes:{}, groups:{}, cards:{}, items:{} }, // gravsteiner: id → ts
}
```

Forelder-peker på hvert nivå: `element.home → kort`, `kort.group → gruppe`,
`gruppe.uni → univers`. Aktiv gruppe settes ALLTID via `setActiveGroup()` /
`setActiveUniverse()` så per-univers-minnet (`activeGroups`) holdes i takt.

**Aktiv posisjon huskes på kontoen (kontomodus).** `activeUniverse`/`activeGroup`
lagres på selve brukerkontoen (Supabase Auth `user_metadata.nav = {u,g}`), ikke i
synk-doc'et. Skrives debouncet fra `setActiveGroup()` (`saveNavPref`), og
gjenopprettes én gang ved første sky-pull etter innlogging (`restoreNavPref`, kalt
fra `applyMyDoc` bak `navRestored`-flagget). Da lander man på samme univers/gruppe
neste gang appen lastes — også på en ny enhet. Løpende synk flytter IKKE
visningen (restore skjer kun på første pull), så to åpne enheter kan stå i hver
sin gruppe. `activeGroups`-minnet er alltid per enhet (synkes aldri).

## Hierarkiet: Univers > Gruppe > Liste > Element

Universer er **helt uavhengige områder** — grupper kan ALDRI flyttes på tvers av
universer. Alt gruppe-/liste-UI er scopet til det aktive universet (`allGroups()`
osv.), så kryss-univers-flytting er umulig i UI-et.

- **Universer**: bytt/opprett/omdøp/slett i univers-modalen (🌐-breadcrumben). Se `docs/menus.md`.
- **Grupper** (gruppe-modalen, 📁-breadcrumben): opprett/slett/omdøp/dra-rekkefølge. Se `docs/menus.md`.
- **Lister** («kort», tidl. «kategorier») i hver gruppe: samme CRUD + dra-og-slipp,
  inkl. overføring til annen gruppe. Se `docs/drag-and-drop.md`.
- **Elementer** i hvert kort: samme CRUD + dra-og-slipp, inkl. overføring mellom
  lister i samme gruppe. Se `docs/drag-and-drop.md`.
- Klikk på navn (aktiv gruppe / aktivt univers / kort-tittel / element) = omdøp inline.
- Søppelkasse på alle fire nivåer (`trashed`-flagg) — se `docs/trash.md`.
- **Avkryssing av elementer** (`item.done`): rir på innholds-registeret (`ts`/`org`,
  som `text`/`trashed`) — LWW ved samtidig endring. Avkryssede elementer flyttes
  (med FLIP, se `toggleItemDone`) til en egen **«Utført»-seksjon** nederst i kortet
  (skilt med en linje), med lavere bakgrunns-opacity + gjennomstreking. `pos`
  endres IKKE, så et reaktivert element sorterer tilbake til nøyaktig sin gamle
  plass blant de aktive (og skyver den som nå står der, ett hakk ned). I kontomodus
  er `done` en egen kolonne (`items.done`, se `supabase/users-and-sharing.sql` +
  TODO.md for påkrevd DB-migrering).
- **Ansvarlig** (`item.responsible` og `card.responsible`): bruker-id-en til den
  som «tar oppgaven» i delt kontekst — nå både per element og for HELE listen.
  Rir på innholds-registeret (`ts`/`org`, som `text`/`done`) — LWW ved samtidig
  endring. Settes fra innstillingsmodalen eller ansvarlig-chipen
  (`docs/scheduling.md`); se `docs/accounts.md` for delegruppen. I kontomodus
  egne kolonner (`items.responsible`/`cards.responsible`, FK til `profiles`,
  `on delete set null`).
- **Tidsplan** (`start`/`due` på elementer og lister + `card.lockTimes`): lokal
  vegg-tid som tekst (`'YYYY-MM-DD'` evt. + `'THH:MM'`), rir på innholds-
  registeret. Se `docs/scheduling.md` for semantikk, chips og DB-kolonner.
- **`_pendingDelete`** (lokalt, `_`-prefiks → ikke synket): buffret sletting —
  objektet er skjult og «på vei til søppel», men ennå ikke `trashed`/skrevet til
  DB. Se `docs/trash.md` (delete-buffer).
- **Kategorier** (`item.isCat` / `item.cat`): en liste har nå TO nivåer. En
  kategori er en nivå-1-«rad» som grupperer elementer under en felles overskrift,
  men den **lagres som et element** i kortets `items` (markert `isCat: true`), så
  den rir på hele element-synken gratis. En kategori har navn (`text`), egen
  tidsplan (`start`/`due`) og kan låse tidene til elementene sine (`lockTimes`,
  som lister). Leaf-elementer peker på kategorien sin via `cat` (kategori-id;
  null/undefined = ukategorisert, nivå 1). Regler: kategorier nøstes ALDRI
  (`cat` alltid falsy på en `isCat`), krysses aldri av (`done`), og et element
  hvis `cat` peker på en kategori som ikke finnes (f.eks. oppløst på en annen
  enhet) rendres som ukategorisert (nivå 1). Nivå 1 = aktive elementer med `cat`
  falsy (ukategoriserte + kategorier), sortert på `pos`; en kategoris medlemmer =
  aktive leaf-elementer med `cat === kategori.id`. Begge nivåer deler samme
  `pos`-rom (filtreres til søskengruppen FØR sortering, så absolutte pos-verdier
  trenger ikke være globalt monotone). `cat` er et forelder-medlemskap → rir på
  posisjonsregisteret (som `home`); `isCat`/`lockTimes` på innholds-registeret.
  Opprettes via en egen **gul kategori-knapp** ved siden av ＋-knappen; se
  `docs/drag-and-drop.md` for nivå-2-dra-og-slipp og `docs/scheduling.md` for
  kategori-innstillingsmodalen.

Gotcha: «＋ Gruppe» skal alltid bare virke, selv uten univers — standard-universet
opprettes i farten (`ensureUniverse`). Dette bruker en NY tilfeldig id, ikke den
faste `uni-standard`-id-en (som kan ha gravstein fra migrering).
