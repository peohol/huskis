# Dra-og-slipp-logikk

Les denne når oppgaven berører reorder, overføring mellom lister/grupper, eller
selve dra-motoren i app.js.

Bytte utløses av **overlapp**, ikke av et punkt:

- ≥ **20 %** høyde-/breddeoverlapp bytter plass; **retningsstyrt** (hysterese mot
  flimring): nedover-drag bytter kun med kortet under, oppover kun med kortet over
  (transponert for horisontale rader).
- **Kolonne** = kort med ≥ 50 % horisontal overlapp; kryss-kolonne plasseres etter
  vertikal senterposisjon. For elementer = overføring til annen `.items-container`.
- **FLIP-animasjon (150 ms)** ved hver placeholder-flytting og ved slipp.
  `layoutRect()` trekker fra pågående FLIP-transform → stabil treffdeteksjon.
- Under draging manipuleres DOM direkte; state bygges fra DOM ved slipp (kirurgisk:
  kun det flyttede objektets posisjonsregister stemples).
- **Dynamisk rotasjon** av dra-kort (`cardRotation()`, ±5° ut fra horisontal
  posisjon); elementer roterer ikke. **Auto-scroll** ved vindus-kant for kort, og
  av gruppefeltet ved feltets kanter under gruppe-drag.
- Kun én drag om gangen (`if (drag.active) return`); `finishDrag()` feier bort
  evt. foreldreløse placeholdere.
- Håndtak (`.drag-handle`) har `touch-action: none`; draging starter kun fra
  håndtaket. `pointercapture` brukes så draging ikke mister eventer. Placeholder
  lever kun under draging; `finishDrag()` har sikkerhetsnett.

## Overføring av lister mellom grupper (innen samme univers)

Dra en liste opp på et gruppekort i gruppemenyen: gruppekortet markeres
(`.drop-target`), dra-kortet blir gjennomskinnelig (`.to-group`), board-et fryses
mens man sikter. Slipp = kirurgisk flytting (`card.group` + `pos` bakerst, kun
posisjonsregisteret stemples) + toast + puls på målgruppen (`pulseReceivedGroup`).

Kun mulig innen samme univers — kun det aktive universets grupper vises i
gruppemenyen, se `docs/data-model.md`.
