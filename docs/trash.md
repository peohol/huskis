# Søppelkasser (universer / grupper / lister / elementer)

Les denne når oppgaven berører sletting, gjenoppretting, eller tømming på et
hvilket som helst av de fire nivåene.

Fire nivåer, samme knapp (`.trashcan`: hvit beholder, søppelkasse-SVG + antall i
grå sirkel) og samme oppførsel; **alle vises kun når de har innhold** (`hidden`):

- **Universer**: i meny-modalen, ved siden av «＋ Univers».
- **Grupper**: i gruppemenyens knapperad (per aktivt univers).
- **Lister**: i listemenyens knapperad (per aktiv gruppe).
- **Elementer**: midtstilt nederst i hvert listekort.

## Interaksjon (`attachTrashHold`)

Kort trykk → felles modal (`showTrashModal`: gjenopprett enkeltvis / tøm med
bekreftelse; modalen åpnes utsatt og ignorerer overlay-klikk de første ~450 ms).

Klikk-og-hold (> `HOLD_EXPAND_MS`) → **sveipefelt** («Sveip for å tømme →»,
fixed overlay): sveip helt til høyre roterer ikonet opp-ned og **tømmer** (rist
500 ms, kollaps); slipp før enden = avbryt.

Søppelkasse-ikonet i sveipefeltet (`ICONS.trashSwipe`, se `icons.js`) er bygget
med tre separat animerbare deler — `.swipe-icon-lid` (lokk+hank),
`.swipe-icon-body` og `.swipe-icon-dots` (ribbene/søppelet) — som
`setProgress(p)` i `attachTrashHold` (app.js) styrer direkte via inline
`transform`/`opacity`, i takt med selve kassens 0→180°-rotasjon:
lokket svinger opp og lukkes igjen midtveis (`sin(p·π)`, topp ved p=0.5,
tilbake til 0 ved p=1), og ribbene fader/forskyves ut i samme vindu og
forblir borte helt til sveipet nullstilles (scrubbart — ikke en løkke-
animasjon). Ikke fjern `.swipe-icon-lid`/`.swipe-icon-body`/`.swipe-icon-dots`-
klassene uten å oppdatere `setProgress`/`collapseField` tilsvarende.

Tømming setter **gravsteiner** rekursivt (univers → grupper → lister →
elementer: `emptyUniversesTrash`/`emptyGroupsTrash`/`emptyCardsTrash`/
`emptyItemsTrash`). Destruktivt er alltid reversibelt frem til tømming
(gravstein først da) — se `docs/sync.md` for hvordan gravsteiner brukes i
fletting.

Alle tekster/titler sier «hold og sveip for å tømme» (ikke «hold i 3
sekunder»).
