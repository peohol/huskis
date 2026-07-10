# Søppelkasser (universer / grupper / lister / elementer)

Les denne når oppgaven berører sletting, gjenoppretting, eller tømming på et
hvilket som helst av de fire nivåene.

Fire nivåer, samme knapp (`.trashcan`: hvit beholder, 🗑️ + antall i grå sirkel) og
samme oppførsel; **alle vises kun når de har innhold** (`hidden`):

- **Universer**: i meny-modalen, ved siden av «＋ Univers».
- **Grupper**: i gruppemenyens knapperad (per aktivt univers).
- **Lister**: i listemenyens knapperad (per aktiv gruppe).
- **Elementer**: midtstilt nederst i hvert listekort.

## Interaksjon (`attachTrashHold`)

Kort trykk → felles modal (`showTrashModal`: gjenopprett enkeltvis / tøm med
bekreftelse; modalen åpnes utsatt og ignorerer overlay-klikk de første ~450 ms).

Klikk-og-hold (> `HOLD_EXPAND_MS`) → **sveipefelt** («🗑️ Sveip for å tømme →»,
fixed overlay): sveip helt til høyre roterer ikonet opp-ned og **tømmer** (rist
500 ms, kollaps); slipp før enden = avbryt.

Tømming setter **gravsteiner** rekursivt (univers → grupper → lister →
elementer: `emptyUniversesTrash`/`emptyGroupsTrash`/`emptyCardsTrash`/
`emptyItemsTrash`). Destruktivt er alltid reversibelt frem til tømming
(gravstein først da) — se `docs/sync.md` for hvordan gravsteiner brukes i
fletting.

Alle tekster/titler sier «hold og sveip for å tømme» (ikke «hold i 3
sekunder»).
