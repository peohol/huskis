# Kommende hendelser

Les denne når oppgaven berører kalenderknappen, modalen «Kommende hendelser»
eller reglene som avgjør hvilke frister og starttider som vises der.

To ting bor her, og de er bevisst skilt:

1. **Hendelsesmotoren** — `collectUpcomingEvents(state, now)` i `app.js`: en ren
   funksjon av tilstand + tidspunkt, uten et eneste DOM-oppslag.
2. **Modalen** (`#events-modal`) — som bare TEGNER det motoren returnerte, og
   navigerer via `navigateToObject()` fra
   [`sok-og-navigering.md`](sok-og-navigering.md).

Tidsverdiene, semantikken for dato uten klokkeslett og den harde
fristinvarianten er beskrevet i [`scheduling.md`](scheduling.md), som er
autoritativ for dem.

## Kalenderknappen

Første knapp i toppkontrollgruppen (`.corner-btn.events-btn`, `#events-btn` —
se [`menus.md`](menus.md), «Toppkontrollene»). Den er en `.corner-btn` som de
andre og trengte ingen ny posisjonsutregning: gruppen plasserer knappene med
flex, og en ny legges FØRST. Under 560 px ligger den sammen med søkeknappen på
en rad UNDER drakt og konto, så breadcrumben bare trenger å vike for to knapper
— se `menus.md`.

## Modalen (`#events-modal`)

Vanlig `.modal-overlay`-skall (fokusfelle, Escape via `closeTopLayer`,
`body.modal-open`, fokus tilbake til kalenderknappen ved lukking) med to
seksjoner, hver med opptil tre grupper:

| Seksjon | Gruppe | Grense | Ikon/flate |
|---|---|---|---|
| **Tidsfrister** | Frist utløpt | `due < now` | varseltrekant, rød |
| | Frist innen 7 dager | `now <= due < now + 7 døgn` | varseltrekant, gul |
| | Frist om 7 dager eller mer | `due >= now + 7 døgn` | kalender m/utropstegn, grønn |
| **Starttider** | Har begynt | `start <= now` | start-/play-ikon, blågrønn |
| | Begynner innen 7 dager | `now < start < now + 7 døgn` | klokke, lilla |
| | Begynner om 7 dager eller mer | `start >= now + 7 døgn` | kalender, blå |

Grensene er **uttømmende og møtes uten hull**: nøyaktig 7 døgn havner i den
siste gruppen, ikke mellom to. Ved `now` skiller de to seksjonene lag med
vilje — en frist som er nøyaktig nå er ennå ikke oversittet, mens en start som
er nøyaktig nå HAR begynt. Ett døgn er 24 timer (`WEEK_MS`), ikke syv
kalenderdager.

**Startgruppene bærer ikke varselfargene.** At noe begynner er ingen advarsel,
så de to siste startgruppene har sine EGNE flater (`--grad-purple`,
`--grad-blue`) i stedet for å låne gult og grønt. Fristgruppene bruker de samme
gradientene som statuschipene (`docs/design-system.md`). Alle seks flatene er
med i kontrastkontrakten (`docs/tilgjengelighet.md`).

**Ikonene ser like ut i lys og mørk drakt.** Modalen pinner `--icon-ink` og
`--icon-paper` for hele subtreet, slik `.btn-solid` gjør: platene under
gruppeikonene er kontraktsfarger som er de samme i begge drakter, og da skal
strekene være det også — det gjelder også typeikonene i radene.

Bare grupper som HAR rader tegnes, og finnes ingen hendelser i det hele tatt,
står det én linje om det. Antallet rader i en gruppe telles ikke opp: radene
står der og kan telles.

**Skillelinje mellom gruppene.** Fra og med den andre gruppen i en seksjon
skiller en linje den fra den forrige, med LIK luft på hver side (seksjonens gap
over, gruppens padding under). Avstanden mellom to grupper blir dermed dobbelt
så stor som luften inne i én, og grupperingen leses uten å telle rader.

### Raden

`[typeikon] navn` med en dempet linje under seg som gir **kontekststien**
(`Arbeid › Klinikk`), og tiden i enden. Typen står ikke i teksten — den er
ikonet: liste, kategori eller listepunkt (`ICONS.list` / `.category` / `.item`;
listepunktets er listens motiv med én rad i stedet for tre). Radene bærer
altså IKKE gruppens statusikon: fargen står én gang, i overskriften.

**Tiden er to linjer.** Øverst avstanden i tid, under den den konkrete datoen.
Avstanden vises bare innenfor sju døgn hver vei — lenger ut sier datoen alene
mer enn et tall gjør — og teller HELE enheter nedover: «om 3 d» betyr minst tre
hele døgn igjen. Under ett døgn byttes enheten til timer («om 5 t», «3 t
siden»), aldri under 1. Under 560 px legges begge på én linje under teksten,
slik at stien får hele bredden.

At enhetene telles ned til hele har en teknisk side også: teksten bytter da på
eksakte tidspunkter (`at ± n · enhet`), som `nextEventBoundary` kan sove fram
til uten å regne på halve enheter.

Trykk på raden lukker modalen og kaller `navigateToObject({ type, id })` — som
går til riktig mappe, folder ut det som må foldes ut, ruller målet fram,
fokuserer og markerer det.

### Oppdatering mens modalen står åpen

Innholdet regnes ut når modalen åpnes, og på nytt ved enhver endring i
tilstanden: `save()` og `renderBoard()` kaller `refreshEventsModal()`, og en
synk-runde ender i begge. Kallet er en no-op når modalen er lukket, og maler
bare om når SIGNATUREN endrer seg — da mister ikke en fokusert rad fokus av en
bakgrunnssynk som ikke rørte noen av hendelsene.

Gruppene avhenger også av `now`, ikke bare av tilstanden. Modalen PULSER likevel
ikke: hver hendelse har nøyaktig to øyeblikk der den kan bytte gruppe —
tidspunktet selv og de to 7-døgnsgrensene (`at ± WEEK_MS`) — pluss hver hele
enhet nedtellingen tikker på, så `refreshEventsModal()` sover til den FØRSTE av
dem (`nextEventBoundary`). En frist som passerer mens
modalen står åpen flytter seg dermed til «Frist utløpt» av seg selv. Søvnen har
et tak på seks timer, og en `visibilitychange` regner ut på nytt med én gang:
`setTimeout` er ikke til å stole på over en fane i bakgrunnen eller en enhet som
har sovet.

## Hva som er aktivt

En hendelse finnes bare for noe det fortsatt er noe å gjøre med:

| Nivå | Aktiv når |
|---|---|
| listepunkt | levende, ikke kategori, `done !== true` |
| kategori | har minst ett aktivt listepunkt som er BARN av den |
| liste | har minst ett aktivt listepunkt, i kategori eller ikke |

En tom liste eller kategori er altså irrelevant, og det samme er en der alt er
krysset av. Ferdige listepunkter vises aldri. Papirkurven er ute på alle nivåer
— motoren bruker den samme `live()`-vakten som rendringen
([`trash.md`](trash.md)).

## Effektiv, egen og arvet tid

Presedensen er den samme som ellers i appen (`timeController`,
[`scheduling.md`](scheduling.md)):

1. en liste med `lockTimes` styrer tidene til ALLE sine listepunkter;
2. ellers styrer en kategori med `lockTimes` sine egne listepunkter;
3. ellers bruker listepunktet sine egne tider.

Motoren skiller mellom **effektiv tid** (den som faktisk gjelder), **egen
eksplisitt tid** og **arvet tid**. Merk at arv KUN oppstår gjennom `lockTimes`:
et listepunkt uten frist har ingen frist, selv om listen over det har en.
Kategorier låses aldri av listen — de har alltid sine egne tider.

## Deduplisering

Målet er å vise det høyeste meningsfulle nivået uten å skjule et barn som
faktisk sier noe nytt. Reglene er per liste, og nivåene behandles ovenfra og
ned: liste → kategori → listepunkt.

**Felles for begge feltene:** en tid som er IDENTISK med en forelders allerede
viste tid gir ingen egen rad. Det dekker både ren arv (låste tider) og en
kategori som tilfeldigvis har satt samme dag som listen.

**Frister har én regel til:** er forelderens frist allerede UTLØPT, dominerer
den alt under seg som er utløpt av samme eller senere grunn. Uten den ville én
oversittet liste tegnet en vegg av røde rader som alle sier det samme. Et barn
som er ENDA MER overskredet enn forelderen bryter ut og står øverst — det er ny
informasjon.

**Starter har ikke den regelen, og skal ikke ha den.** At en liste er påbegynt
betyr ikke at et listepunkt med sin egen, senere start er det. Et barn med
særskilt egen starttid vises derfor alltid, i sin egen gruppe.

Typisk utfall: et listepunkt med egen frist tidligere enn kategoriens/listens
vises ved siden av dem så lenge forelderens frist ennå ikke er utløpt.

## Sortering

Innenfor hver gruppe sorteres det på tid: **lengst overskredet først** og
**nærmest først** er den samme stigende rekkefølgen. Det ene unntaket er «Har
begynt», der den SIST påbegynte står øverst — det er den man nettopp satte i
gang og mest sannsynlig leter etter.

Ties brytes deterministisk videre på objekttype (liste, kategori, listepunkt),
så navn (norsk alfabet, som i søket), så sti, og til slutt id. To visninger av
samme tilstand bytter derfor aldri om på to rader.

## Tilgjengelighet

- Dialogsemantikk på modalen; fokus flyttes inn ved åpning og tilbake til
  kalenderknappen ved lukking (unntatt når en rad ble åpnet — da eier
  navigeringen fokuset).
- Radene er vanlige knapper, så Tab og Enter virker uten særbehandling. Hver
  rad har et `aria-label` med navn, type, tidspunkt (med avstanden når den
  finnes) og sti — typen står der i KLARTEKST, siden den visuelt bare er et
  ikon.
- Antall hendelser leses opp fra et visuelt skjult `role="status"`.
- Farge er aldri eneste bærer: gruppen har overskrift i klartekst, glyfene
  skiller gruppene fra hverandre, og linjen mellom dem er en form, ikke en
  farge. Start-ikonet er bevisst IKKE en hake — det ville lest som «utført».

Kravene er de samme som ellers — se [`tilgjengelighet.md`](tilgjengelighet.md).

## Språk

Alle tekstene ligger i ordboken under `events.*` (pluss `kind.*` for typenavnene
i opplesningen). Tidsenheten i nedtellingen er en EGEN nøkkel — «t» heter «h» på
engelsk — så tallet og enheten kan settes sammen av oversettelsen. Se
[`sprak.md`](sprak.md).

## Voktere

- `tests/upcoming-events.test.js` — motoren: aktiv/ufullført, grensene, arv,
  deduplisering, sortering, dato-uten-klokke og sommertid.
- `tests/events-modal.test.js` — knappen, modalen, tastatur/fokus,
  navigeringen, oppdatering mens den står åpen, i18n og fargekontrakten.
- `tests/corner-controls.test.js` — at kalenderknappen ikke rørte
  toppkontrollenes geometri.
