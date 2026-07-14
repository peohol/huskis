# Fargesystem og filter

Les denne når oppgaven berører fargelegging av kort/rader, eller
Mine/Delte-filteret.

## Fargesystem (HSL, posisjonsbasert)

Farge utledes av **posisjon** i den synlige, sorterte lista (S=`COLOR_SAT` 20 %,
L-sett `[60,75,90]`, tone-rekkefølge fra `buildHueOrder` (12 toner, 60°-hopp));
re-fargelegges ved add/slett/omrokkering; ikke lagret/synket (`colorForId` som
stabil reserve i søppelkasse-modalen). Gjelder gruppekort, listekort OG
univers-radene i menyen. Hvit skrift m/ `--text-shadow` på alle fargede flater
og grønne knapper.

## Filter (Mine/Delte)

Filterkortet (👁️ Mine/Delte) i listemenyen (se `docs/menus.md`), per enhet
(`mine-lister-filter`, ikke synket). To uavhengige brytere — «Mine» (lister du
selv eier, `isMine(c)`/`c._mine !== false`) og «Delte» (lister andre har delt
med deg — `c._mine === false`). Begge kan stå på (alt vises) eller av (alt
skjules). Kort trykk =
uavhengig toggle; hold en bryter i 250 ms (`FILTER_HOLD_MS`) → aktiverer kun
den (skrur av den andre). På-tilstanden bruker samme grønne knappestil
(`--grad-green` + lys-opp-hover) som resten av de grønne knappene.

Erstatter det gamle K/P-merkelapp-systemet (per-kort K/P-brytere + KP-filter).
`k`/`p`/`labTs`/`labOrg`-feltene lever videre i datamodellen og synk-laget
(`docs/data-model.md`, `docs/accounts.md`) for bakoverkompatibilitet med
allerede synkede data, men er ikke lenger synlige eller redigerbare i UI-et.
