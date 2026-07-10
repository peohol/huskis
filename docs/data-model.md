# Datamodell og arkitektur

Les denne når oppgaven berører state-strukturen, foreldre-peker-logikk, eller
per-enhet-minnet for aktiv gruppe/univers.

## Arkitektur

- **Ren statisk app**: `index.html` + `styles.css` + `app.js`. Ingen byggesteg, ingen rammeverk.
- **Vanilla JS** med egen dra-og-slipp-motor på Pointer Events (mus + touch likt) — se `docs/drag-and-drop.md`.
- **Persistens** i `localStorage`; sanntids-synk via Supabase — se `docs/sync.md`.

## State-form (nøstet i minnet for rendring, flat i synk-doc'et)

```js
state = {
  activeUniverse: <uniId>,     // per enhet, synkes ikke
  activeGroup: <groupId>,      // per enhet, synkes ikke
  activeGroups: { uniId: groupId }, // per enhet: sist aktive gruppe per univers
  universes: [
    { id, name, trashed, pos,  // + registre: ts/org (innhold), posTs/posOrg (rekkefølge)
      groups: [
        { id, uni, name, trashed, pos,   // uni = univers-forelder
          cards: [                        // «lister»
            { id, group, title, color, trashed, k, p,
              items: [ { id, text, trashed, home } ] } ] } ] }
  ],
  _tomb: { universes:{}, groups:{}, cards:{}, items:{} }, // gravsteiner: id → ts
}
```

Forelder-peker på hvert nivå: `element.home → kort`, `kort.group → gruppe`,
`gruppe.uni → univers`. Aktiv gruppe settes ALLTID via `setActiveGroup()` /
`setActiveUniverse()` så per-univers-minnet (`activeGroups`) holdes i takt.

## Hierarkiet: Univers > Gruppe > Liste > Element

Universer er **helt uavhengige områder** — grupper kan ALDRI flyttes på tvers av
universer. Alt gruppe-/liste-UI er scopet til det aktive universet (`allGroups()`
osv.), så kryss-univers-flytting er umulig i UI-et.

- **Universer**: bytt/opprett/omdøp/slett i meny-modalen (☰). Se `docs/menus.md`.
- **Grupper** (gruppemenyen): opprett/slett/omdøp/dra-rekkefølge. Se `docs/menus.md`.
- **Lister** («kort», tidl. «kategorier») i hver gruppe: samme CRUD + dra-og-slipp,
  inkl. overføring til annen gruppe. Se `docs/drag-and-drop.md`.
- **Elementer** i hvert kort: samme CRUD + dra-og-slipp, inkl. overføring mellom
  lister i samme gruppe. Se `docs/drag-and-drop.md`.
- Klikk på navn (aktiv gruppe / aktivt univers / kort-tittel / element) = omdøp inline.
- Søppelkasse på alle fire nivåer (`trashed`-flagg) — se `docs/trash.md`.

Gotcha: «＋ Gruppe» skal alltid bare virke, selv uten univers — standard-universet
opprettes i farten (`ensureUniverse`). Dette bruker en NY tilfeldig id, ikke den
faste `uni-standard`-id-en (som kan ha gravstein fra migrering).
