# Fargesystem og gamle merkelapper

Les denne når oppgaven berører fargelegging av kort/rader.

## Fargesystem (HSL, posisjonsbasert)

Farge utledes av **posisjon** i den synlige, sorterte lista (S=`COLOR_SAT` 20 %,
L-sett `[60,75,90]` i lys drakt, tone-rekkefølge fra `buildHueOrder` (12 toner,
60°-hopp)); re-fargelegges ved add/slett/omrokkering; ikke lagret/synket
(`colorForId` som stabil reserve i søppelkasse-modalen). Gjelder mappe-rader,
listekort OG område-radene i menyen. Hvit skrift m/ `--text-shadow` på alle
fargede flater og grønne knapper.

**Drakten snur L-settet, ikke tonene.** I mørk drakt er settet `[42,32,22]` —
samme H, samme S. Korthodet og avkryssingskanten (`paintCardColor`) lysnes i
stedet for å mørknes. Hvorfor det ikke er en ren `100 − L`, og hvordan
spredningen mot board-bakgrunnen er målt: [`mork-drakt.md`](mork-drakt.md), som
er autoritativ for drakten.

## Legacy: K/P-felter

`k`/`p`/`labTs`/`labOrg` på lister er rester av et tidligere merkelapp-/
filter-system (per-kort K/P-brytere + et KP-filter, senere en Mine/Delte-
filterknapp) som er fjernet. Feltene lever videre i datamodellen og synk-laget
(`docs/data-model.md`, `docs/accounts.md`) for bakoverkompatibilitet med
allerede synkede data, men er ikke synlige eller redigerbare i UI-et.
