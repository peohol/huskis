# Sanntids-synk (Supabase), migrering og databaseoppsett

Les denne når oppgaven berører synk-doc'et, fletting mellom enheter, gravstein-
logikk, eller migrering av gammel data.

Ett `jsonb`-doc per synk-kode, CAS (`version`) i databasen, Realtime broadcast +
poll-fallback, felt-nivå LWW-fletting (last-write-wins) med hybrid logisk klokke
og gravsteiner.

## Doc-form

**Flatt doc**: fire parallelle tabeller + gravsteiner:

```js
{ universes, groups, cards, items, tomb: {universes, groups, cards, items}, hlc }
```

med forelder-pekere (`gruppe.uni`, `kort.group`, `element.home`). Fletting per
register (innhold `ts/org`; merkelapp `labTs/labOrg` (kort); posisjon
`posTs/posOrg` — **forelder følger posisjonsregisteret**). Forelderløse
forkastes (gruppe uten univers, liste uten gruppe, element uten liste).

`activeUniverse`/`activeGroup`/`activeGroups` er per enhet og synkes ikke (se
`docs/data-model.md`).

## Migrering (deterministisk, uten duplisering — alle enheter migrerer likt)

1. To-fane-form (`tabs`) → to faste grupper (`grp-huskelister`/`grp-handlelister`).
2. Flat/nøstet gruppe-form (uten `universes`) → alt inn i **standard-universet**
   `uni-standard` («Standard») med nøytrale registre (ts 0, org '').

Steg 1+2 kjøres både på lagret state (`migrateTabsToGroups` +
`migrateGroupsToUniverses` i `normalize`) og på fjern-doc
(`migrateBareState`/`normalizeRemoteDoc`). Ingen databaseendring var nødvendig
for universer (samme `get_list`/`save_list`).

## Synk-syklus

`syncCycle()` (pull → flett → evt. push), `docFromState()`/`applyDoc()`,
`canonical()`. Interne funksjoner eksponert på `window.__huskekurv`.

## Databaseoppsett via GitHub Actions

`supabase/setup.sql` (idempotent) kjøres via Actionen «Supabase DB-oppsett»
(krever secret `SUPABASE_DB_URL`) eller limes inn i SQL Editor. Husk
`extensions` i `search_path` (pgcrypto/`digest()`).
