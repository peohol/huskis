# Fargesystem og merkelapper/filter

Les denne når oppgaven berører fargelegging av kort/rader, eller K/P-brytere og
filtrering.

## Fargesystem (HSL, posisjonsbasert)

Farge utledes av **posisjon** i den synlige, sorterte lista (S=`COLOR_SAT` 20 %,
L-sett `[60,75,90]`, tone-rekkefølge fra `buildHueOrder` (12 toner, 60°-hopp));
re-fargelegges ved add/slett/omrokkering; ikke lagret/synket (`colorForId` som
stabil reserve i søppelkasse-modalen). Gjelder gruppekort, listekort OG
univers-radene i menyen. Hvit skrift m/ `--text-shadow` på alle fargede flater
og grønne knapper.

## Merkelapper (K/P) + filter

K/P-brytere per kort (minst én på; eget synk-register `labTs/labOrg`), filter
(👁️ K/P/KP) i listemenyen (se `docs/menus.md`), per enhet
(`mine-lister-filter`).
