# Datamodell og arkitektur

Les denne når oppgaven berører state-strukturen, foreldre-peker-logikk, eller
per-enhet-minnet for aktiv gruppe/univers.

## Arkitektur

- **Ren statisk app**: `index.html` + `styles.css` + `app.js`. Ingen bundler og
  ingen rammeverk; `node build.js` stempler kun en build-ID inn i produksjons-
  kopien (`docs/auto-update.md`).
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
    { id, name, trashed, collapsed, pos,  // + registre: ts/org (innhold), posTs/posOrg (rekkefølge)
      groups: [
        { id, uni, name, trashed, pos, cat, isCat, collapsed,  // uni = univers-forelder; cat/isCat = gruppekategori
          cards: [                        // «lister»
            { id, group, title, color, trashed, k, p, // k/p: legacy, se docs/colors-and-labels.md
              responsible, start, due, lockTimes,     // ansvarlig + tidsplan for hele listen (docs/scheduling.md)
              collapsed,                              // rullgardin-kollaps av lista (innholds-register, se docs/design-system.md)
              items: [ { id, text, trashed, done, responsible, start, due, home, cat, isCat, lockTimes } ] } ] } ] } // done: avkrysset; responsible: ansvarlig bruker-id (delte lister); start/due: tidsplan; cat/isCat/lockTimes: kategorier (se under)
  ],
  _tomb: { universes:{}, groups:{}, cards:{}, items:{} }, // gravsteiner: id → ts (permanent slettet)
  _base: { universes:[], groups:[], cards:[], items:[] }, // synk-base: forrige serverkjente doc
  _baseV: 1,                                              // basens versjon (BASE_VERSION)
}
```

`_tomb` og `_base`/`_baseV` er de eneste `_`-feltene (utenom `_hlc`/`_createdByMe`) som
lagres i cachen — de hører til synken, ikke til visningen. `_base` MÅ ligge i
samme localStorage-post som innholdet, ellers kan de to komme i utakt og
fletteren lese basens rader som «slettet lokalt». Se «Gjenoppstandelse» i
`docs/accounts.md` og `docs/trash.md`.

Forelder-peker på hvert nivå: `listepunkt.home → kort`, `kort.group → gruppe`,
`gruppe.uni → univers`.

**Rolle- og capability-metadata (kontomodus)** legges på objektene av
`applyMyDoc`, utenfor synk-doc'et: `_type`, `_parent`, `_creator`,
`_createdByMe`, `_role` (`'owner'`/`'member'`/`null` — kun universer og grupper),
`_free`, `_caps`, `_shared`, `_locked`, `_unlocked`, `_invitePolicy`,
`_ownerKey`, `_memberCount`, `_ownerCount`. Myndighet kommer fra `_role`/`_caps`
— `_creator` er ren historikk. Se `docs/rettigheter-og-deling.md`.

**Personlig vs. kanonisk `pos`.** For universer (alltid) og FRIE grupper er
`.pos` brukerens PERSONLIGE rekkefølge (fra medlemskapsraden), mens den kanoniske
verdien ligger i `_canon` og skrives tilbake uendret. For alt annet er `.pos` den
delte, kanoniske posisjonen.

**Den virtuelle fri-beholderen.** Grupper som er delt direkte med meg uten at jeg
har noen rolle i deres kanoniske univers (`_free`) samles i ett syntetisk
«univers» med id `'__free__'` (`FREE_UNI_ID`, `_virtual: true`). Det finnes ikke i
databasen, pushes aldri (`flattenNested` hopper over det), og gruppene i det
beholder sitt kanoniske `uni` i doc-et — universets navn lekkes aldri.

Aktiv gruppe settes ALLTID via `setActiveGroup()` /
`setActiveUniverse()` / `goToGroup()` så per-univers-minnet (`activeGroups`)
holdes i takt (`goToGroup` brukes fra nav-modalen, der et gruppevalg også kan
bytte univers).

**Aktiv posisjon huskes på kontoen (kontomodus).** `activeUniverse`/`activeGroup`
lagres på selve brukerkontoen (Supabase Auth `user_metadata.nav = {u,g}`), ikke i
synk-doc'et. Skrives debouncet fra `setActiveGroup()` (`saveNavPref`), og
gjenopprettes én gang ved første sky-pull etter innlogging (`restoreNavPref`, kalt
fra `applyMyDoc` bak `navRestored`-flagget). Da lander man på samme univers/gruppe
neste gang appen lastes — også på en ny enhet. Løpende synk flytter IKKE
visningen (restore skjer kun på første pull), så to åpne enheter kan stå i hver
sin gruppe. `activeGroups`-minnet er alltid per enhet (synkes aldri).

## Hierarkiet: Univers > Gruppe > Liste > Listepunkt

De to øverste nivåene speiler de to nederste: **et univers oppfører seg som en
liste og en gruppe som et listepunkt** — samme rendring, samme kategori-modell og
samme dra-og-slipp-motor (se `docs/menus.md` og `docs/drag-and-drop.md`). Grupper
kan derfor flyttes fritt mellom universer, og en gruppe sluppet utenfor alle
universer oppretter et NYTT univers (som listepunkt-ekstrahering lager en ny
liste) — og gruppen flyttes dit med `move_group`, ikke ved å skrive
`universe_id` direkte.
Alt liste-/listepunkt-UI er fortsatt scopet til den AKTIVE gruppen.

- **Universer**: bytt/opprett/omdøp/slett/omrokkér i nav-modalen. Se `docs/menus.md`.
- **Grupper** (samme modal, som rader i universkortet): samme CRUD + dra-og-slipp,
  inkl. overføring til et annet univers og til/fra gruppekategorier. Se `docs/menus.md`.
- **Gruppekategorier** (`group.isCat` / `group.cat`): et univers har TO nivåer,
  nøyaktig som en liste. En gruppekategori lagres SOM en gruppe (markert
  `isCat: true`, med `cards: []`), og vanlige grupper peker på den via `cat`
  (null = ukategorisert, nivå 1). Reglene er identiske med listepunkt-kategoriene
  under: nøstes aldri, `cat` rir på posisjonsregisteret (som `uni`), `isCat`/
  `collapsed` på innholds-registeret, og en gruppe hvis `cat` peker på en
  kategori som ikke finnes rendres som ukategorisert. En gruppekategori er ingen
  navigerbar plassering — `activeGroup`/`validateActive` hopper over `isCat`.
- **Lister** («kort», tidl. «kategorier») i hver gruppe: samme CRUD + dra-og-slipp,
  inkl. overføring til annen gruppe. Se `docs/drag-and-drop.md`.
- **Listepunkter** i hvert kort: samme CRUD + dra-og-slipp, inkl. overføring mellom
  lister i samme gruppe. Se `docs/drag-and-drop.md`.
- Klikk på **tittelen** (univers/gruppe/liste/listepunkt/kategori) = omdøp inline.
  Global hover-affordans (bakgrunnen bak tittelen mørkner) + klikkflaten følger
  teksten (`align-self: flex-start`), så det er kun tittelen — ikke hele raden —
  som redigerer. I univers-/gruppe-modalene: tittel-klikk redigerer, klikk ellers
  på raden navigerer (se `docs/menus.md`). Se `docs/design-system.md`.
- **Lukketilstand for lister** (`card.collapsed`): klikk på korthodet (ikke
  tittel/tannhjul/×) folder listen sammen som en rullgardin. Rir på innholds-
  registeret (`ts`/`org`, som `lockTimes`); lagres og synkes i DB via `save()`
  (optimistisk, ingen synlig forsinkelse). I kontomodus egen kolonne
  (`cards.collapsed`). Se `docs/design-system.md`.
  **Universer og gruppekategorier har det samme feltet** (`universe.collapsed` /
  `group.collapsed`, kolonnene `universes.collapsed`/`groups.collapsed`) — et
  kollapset univers viser [gruppe-ikon] + antall grupper i stedet for «(N)».
- Søppelkasse på alle fire nivåer (`trashed`-flagg) — se `docs/trash.md`.
- **Avkryssing av listepunkter** (`item.done`): rir på innholds-registeret (`ts`/`org`,
  som `text`/`trashed`) — LWW ved samtidig endring. Avkryssede listepunkter flyttes
  (med FLIP, se `toggleItemDone`) til en egen **«Utført»-seksjon** nederst i kortet
  (skilt med en linje), med lavere bakgrunns-opacity + gjennomstreking. `pos`
  endres IKKE, så et reaktivert listepunkt sorterer tilbake til nøyaktig sin gamle
  plass blant de aktive (og skyver den som nå står der, ett hakk ned). ⟲-knappen
  på «Utført»-linja (`restoreAllDone`) gjør det samme for ALLE utførte i lista på
  én gang — samme semantikk per listepunkt (`pos` urørt, kategoriserte tilbake INN
  i kategorien sin via `placeItemBySection`), men i én felles FLIP. I kontomodus
  er `done` en egen kolonne (`items.done`, se `supabase/users-and-sharing.sql`).
- **Ansvarlig** (`item.responsible` og `card.responsible`): bruker-id-en til den
  som «tar oppgaven» i delt kontekst — nå både per listepunkt og for HELE listen.
  Rir på innholds-registeret (`ts`/`org`, som `text`/`done`) — LWW ved samtidig
  endring. Settes fra innstillingsmodalen eller ansvarlig-chipen
  (`docs/scheduling.md`); se `docs/accounts.md` for delegruppen. I kontomodus
  egne kolonner (`items.responsible`/`cards.responsible`, FK til `profiles`,
  `on delete set null`).
- **Tidsplan** (`start`/`due` på listepunkter og lister + `card.lockTimes`): lokal
  vegg-tid som tekst (`'YYYY-MM-DD'` evt. + `'THH:MM'`), rir på innholds-
  registeret. Se `docs/scheduling.md` for semantikk, chips og DB-kolonner.
- **`_pendingDelete`** (lokalt, `_`-prefiks → ikke synket): buffret sletting —
  objektet er skjult og «på vei til søppel», men ennå ikke `trashed`/skrevet til
  DB. Se `docs/trash.md` (delete-buffer).
- **Kategorier** (`item.isCat` / `item.cat`): en liste har nå TO nivåer. En
  kategori er en nivå-1-«rad» som grupperer listepunkter under en felles overskrift,
  men den **lagres som et listepunkt** i kortets `items` (markert `isCat: true`), så
  den rir på hele listepunkt-synken gratis. En kategori har navn (`text`), egen
  tidsplan (`start`/`due`) og kan låse tidene til listepunktene sine (`lockTimes`,
  som lister). Leaf-listepunkter peker på kategorien sin via `cat` (kategori-id;
  null/undefined = ukategorisert, nivå 1). Regler: kategorier nøstes ALDRI
  (`cat` alltid falsy på en `isCat`), krysses aldri av (`done`), og et listepunkt
  hvis `cat` peker på en kategori som ikke finnes (f.eks. oppløst på en annen
  enhet) rendres som ukategorisert (nivå 1). Nivå 1 = aktive listepunkter med `cat`
  falsy (ukategoriserte + kategorier), sortert på `pos`; en kategoris medlemmer =
  aktive leaf-listepunkter med `cat === kategori.id`. Begge nivåer deler samme
  `pos`-rom (filtreres til søskengruppen FØR sortering, så absolutte pos-verdier
  trenger ikke være globalt monotone). `cat` er et forelder-medlemskap → rir på
  posisjonsregisteret (som `home`); `isCat`/`lockTimes` på innholds-registeret.
  Opprettes via en egen **gul kategori-knapp** ved siden av ＋-knappen; se
  `docs/drag-and-drop.md` for nivå-2-dra-og-slipp og `docs/scheduling.md` for
  kategori-innstillingsmodalen. En kategori kan **kollapses** som en rullgardin
  (klikk på overskriftslinjen, `item.collapsed` — som `card.collapsed`); en grønn
  **＋-knapp nederst i kategorien** legger til et nytt (tomt, straks-fokusert)
  listepunkt direkte i den. Se `docs/design-system.md`.
- **Ekstrahering til ny liste** (`docs/drag-and-drop.md`): drar man en kategori
  eller et listepunkt UT av listene og slipper det i board-luften, opprettes en NY
  liste (kategori → samme tittel + medlemmene ukategorisert; listepunkt → bare seg
  selv, blank straks-fokusert tittel). Den som ekstraherer blir **oppretter**
  (`owner_id`) av den nye lista — den lages lokalt med ny id og pushes som en ny rad
  eid av gjeldende bruker, uansett hvem som eide kilde-lista. Umulig fra en låst
  (frosset) liste (selve draget er da avskrudd).
- **Kategori inn i en annen liste** (`moveCategoryToCard`, `docs/drag-and-drop.md`):
  en kategori kan dras inn i en annen eksisterende liste — den blir en nivå-1-kategori
  der (nøstes aldri), og medlemmene følger med (`cat` bevart, ny `home` = mål-lista).
  Dette er den ENESTE måten en kategori bytter liste på (utover ekstrahering til en ny).
- **Lukketilstand for kategorier** (`item.collapsed`): rir på innholds-registeret
  (`ts`/`org`, som `isCat`/`lockTimes`). Kun meningsfullt for `isCat`-rader. I
  kontomodus egen kolonne (`items.collapsed`).

Gotcha: den programmatiske `addGroup()` (feilsøking/tester) skal alltid bare
virke, selv uten univers — standard-universet opprettes i farten
(`ensureUniverse`). Dette bruker en NY tilfeldig id, ikke den faste
`uni-standard`-id-en (som kan ha gravstein fra migrering). UI-veien er ＋-knappen
i universkortet, som i stedet oppretter gruppen tom og navngir den på plassen
(`nameNewRow`, som listepunkter).
