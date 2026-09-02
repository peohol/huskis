# Tidsplanlegging (start/frist) og objektmenyens tidsskuff

Les denne når oppgaven gjelder start-/fristtider, tids-editoren eller
indikator-chipene under liste-/listepunktnavn.

## Hvor tidene redigeres

Den gamle innstillingsmodalen finnes ikke lenger. Tidene ligger nå to steder,
og begge bygger den SAMME editoren (`buildTimeEditor(getTarget, opts)`):

1. **Objektmenyens «Tidsplan»-skuff** — full visning (start + frist + evt.
   lås-avkryssing). Gjelder lister, listepunkter og kategorier. Menyen selv er
   beskrevet i `docs/menus.md`.
2. **Tids-popoveren** (`openTimeQuick`, `#time-switcher`) — én rad, åpnet fra
   start-/frist-chipen i meta-raden (`opts.only`).

Kategorier har — som lister — en **lås-avkryssing** som låser kategoriens tider
til listepunktene i den (`category.lockTimes`).

I fullvisningen er hvert feltpar (dato + klokkeslett) gruppert under en egen
overskrift med ikon — **«Starttid»** (kalender) og **«Tidsfrist»**
(kalender-m/-utropstegn); klokkeikonet står som eget element ved siden av
klokkeslett-feltet (ikke inni inputen). Tids-popoveren har sin egen tittel og
hopper derfor over feltpar-overskriften.

**Navn** redigeres ikke lenger i et modalfelt: menyens «Endre navn» åpner
navneredigereren på plassen (`editText` på selve tittelen).

**Ansvarlig** ligger i menyens «Ansvarlig»-skuff, og vises kun når MAPPEN er
delt (`shareRootFor` → mappen — gjelder OGSÅ hele listen, `card.responsible`).
Radene er de samme som ansvarlig-velgeren bruker;
`setResponsible(target, userId)` skriver valget.

**Deling** finnes ikke på lister: tilgangen arves fra mappen (se
`docs/rettigheter-og-deling.md`), og listens meny har derfor ingen delerad —
delingen gjøres fra mappens meny.

Ingen bekreftelsesknapp noe sted — alt settes fortløpende og optimistisk.
Editoren slår alltid opp det LEVENDE objektet på id per interaksjon
(`liveTarget`), så den tåler synk-rebuilds mens den står åpen.

## Tidsverdier og semantikk

- Verdi: `null` | `'YYYY-MM-DD'` | `'YYYY-MM-DDTHH:MM'` — dato + valgfritt
  klokkeslett (to inputs per rad: `type=date` + `type=time` + fjern-✕).
  Lagres som lokal «vegg-tid» (tekst), bevisst ikke UTC-timestamp: «14. juli»
  skal bety 14. juli overalt, og UI-et må vite om klokkeslett er definert.
- `start` = når noe BØR påbegynnes, `due` (frist) = når det bør være utført.
  Starttiden håndheves ikke — den visualiseres. Fristen gjør det: se «Den harde
  fristinvarianten» under.
- Feltene finnes på både listepunkter og lister og rir på **innholds-registeret**
  (`ts`/`org`, LWW) som tekst/done/responsible.
- **`card.lockTimes` / `category.lockTimes`**: avkryssing i tidsmodulen som
  låser en containers tider til listepunktene i den. Presedens (`timeController`):
  listen (kort) har forrang for ALLE sine listepunkter (også de i kategorier);
  ellers styrer en kategori med `lockTimes` bare sine egne listepunkter. Er et
  listepunkt låst, skjules dets egne tids-chips, og tidsfeltene i listepunktets
  tidsskuff er disablet og viser containerens tider + notis («Tidene styres av listen/
  kategorien …»). Elementenes egne verdier beholdes i data (kommer tilbake om
  låsen skrus av). En kategori viser alltid sine EGNE tids-chips (dens
  `lockTimes` gjelder listepunktene, ikke kategorien selv).
- **Utenfor listens tidsrom**: et listepunkts STARTTID kan ligge utenfor
  containerens `start`–`due`-vindu; tidsmodulen viser da en subtil beskjed
  (`outsideFlags`). Fristen kan ikke lenger ligge etter containerens frist — det
  er invarianten under, og den beskjeden er ikke subtil.

### Dato uten klokkeslett: ÉN semantikk, ett sted

En dato uten klokkeslett er et **døgn**, ikke et tidspunkt, og hvilken ende av
døgnet som gjelder følger av FELTET:

| Felt | Uten klokkeslett betyr |
|---|---|
| `start` | `00:00:00.000` — døgnet begynner |
| `due` | `23:59:59.999` — døgnet slutter |

`timeMs(verdi, felt)` i `app.js` er den ENESTE omregningen, og alt som
sammenligner tid går gjennom den: chip-statusene, «utenfor tidsrommet»-hintet,
fristinvarianten, hendelsesmotoren
([`kommende-hendelser.md`](kommende-hendelser.md)) og varseltersklene
([`varsler.md`](varsler.md)). Da kan ikke to steder i
appen mene forskjellige ting om den samme datoen — en frist som står «innen 7
dager» i hendelsesoversikten kan ikke samtidig være rød i lista.

Regnestykket bruker `new Date(år, mnd, dag, …)`, altså **lokal veggtid**. «14.
juli» er 14. juli der brukeren står, også når sommertiden legger til eller
fjerner en time samme døgn; ingen del av kjeden går innom UTC.

Lagringsformatet er uendret — regelen gjelder semantikk, ikke tekst.

## Den harde fristinvarianten

**Et barn kan aldri ha en senere frist enn en forelder som selv har frist.**
Har forelderen ingen frist, er barnet ubundet.

Foreldrekjeden for frist:

| Barn | Forelder |
|---|---|
| kategori | listen |
| kategorisert listepunkt | kategorien → listen |
| ukategorisert listepunkt | listen |

Taket er den **tidligste** fristen i kjeden, ikke bare den nærmeste
forelderens: da holder regelen transitivt også når mellomleddet (kategorien)
ikke har frist i det hele tatt.

**Regelen gjelder begge veier.** Et barn kan ikke settes forbi forelderen, og en
forelder kan ikke flyttes foran et barns gyldige frist. Barnas frister endres
ALDRI automatisk — det er brukerens data.

**Låste tider teller ikke.** Er et listepunkts tider styrt av listen eller en
kategori (`timeController`), er dets egen verdi inert: den kan verken redigeres
eller skape en konflikt så lenge låsen står. Verdien valideres igjen den dagen
låsen tas av og feltet blir redigerbart.

### Hvor den håndheves

I `setObjectTime(target, felt, verdi)` — den sentrale setteren. Objektmenyens
tidsskuff og tids-popoveren bygger den samme editoren, og editoren committer
der; ingen kodevei skriver `due` utenom. Ligger valideringen ETT sted, kan en ny
inngang ikke gå utenom den.

Ved forsøk på en ugyldig verdi:

- verdien skrives ikke, og feltet faller tilbake til den forrige gyldige;
- en kort toast sier hvilken forelder (eller hvilket barn) som stopper den, og
  når den forfaller;
- ingen bekreftelsesmodal.

**Ett unntak fra tilbakestillingen.** Et felt er et PAR (dato + klokkeslett), og
brukeren skriver normalt datoen først. Er forelderens frist et klokkeslett samme
dag, blir datoen alene avvist — den varer ut døgnet. Da blir det brukeren skrev
stående i feltet (fortsatt uten å bli lagret), slik at klokkeslettet kan skrives
inn etterpå og fullføre en gyldig verdi. En dato som ikke kan reddes av noe
klokkeslett tilbakestilles som ellers.

### Et bytte av forelder er ikke en fristendring

Regelen håndheves på hver skriving av `due` — den er altså sann for alt brukeren
SETTER. Men et objekt kan også få et nytt tak uten at fristen røres: et drag, en
tastaturflytting eller «Flytt til …» kan legge et listepunkt i en liste med
tidligere frist.

Den flyttingen avvises IKKE. Dra-og-slipp er appens primære gest, og målets
frist står ingen steder i det øyeblikket man drar — en avvisning ville vært
friksjon av en grunn brukeren ikke kan se. Resultatet håndteres i stedet av
nøyaktig det samme maskineriet som eldre data under: bruddet vises, det
blokkerer ingenting, og neste fristendring må bringe objektet innenfor.

Fristene til barna endres ALDRI automatisk av en flytting — det er brukerens
data (`docs/drag-and-drop.md` for hva et slipp ellers betyr).

### Eldre data som allerede bryter regelen

Tider utenfor foreldrenes tidsrom var tidligere fritt tillatt, så det kan finnes
data som bryter invarianten. Sammen med flyttingene over er dette de to måtene
et brudd kan finnes på. Strategien er:

- **ingen migrering og ingen mutering.** Normalisering, fletting og synk rører
  ikke tidsverdier; et brudd lastes, vises og synkes uendret.
- **et brudd blokkerer ikke forelderen sin.** Et barn som allerede lå utenfor
  taket teller ikke som et gyldig barn når forelderens frist flyttes — ellers
  ville forelderen vært låst fast for en feil den ikke har gjort.
- **bruddet er synlig — også uten å åpne noe.** Frist-chipen under navnet bytter
  til varseltrekanten (`ICONS.alert`) i stedet for kalenderen, og sier i
  `title`/`aria-label` hvilken forelder som er brutt og når den forfaller.
  Meningen bæres av glyfen og teksten, ikke av farge: statusfargen fortsetter å
  si hvor fristen står i tid. Åpner man tidseditoren, står den samme beskjeden
  der — tydelig, men ikke blokkerende.
- **bruddet kan ikke bekreftes på nytt.** Enhver ny skriving valideres, så et
  ugyldig objekt kan bare endres til en gyldig verdi — eller stå urørt.

Vokter: `tests/due-invariant.test.js`.

## Indikator-chips (`.meta-row` under navnet)

`fillMetaRow(row, target, canEdit)` fyller raden under liste-tittelen
(`.card-meta`, i `.card-title-wrap`) og listepunkt-teksten (`.item-meta`, i
`.item-main`). Kun innstillinger som faktisk er satt vises; tom rad skjules.
Chipene er KNAPPER for hurtigendring:

- **Ansvarlig**: liten initial-sirkel (`respAvatar`, palett fra delegruppen)
  → åpner ansvarlig-velgeren direkte, forankret i chipen.
- **Start** (kalenderikon) og **frist** (kalender-med-utropstegn,
  `ICONS.calendarDue`) → åpner tids-popoveren (`openTimeQuick`,
  `#time-switcher` — samme skall som ansvarlig-velgeren: popover på desktop, sentrert
  modal på mobil) med kun den ene raden.

Chip-innhold: datoen (`fmtDay`: «14. jul», + årstall når ≠ i år) — MEN hvis
datoen er I DAG og et klokkeslett er definert, vises i stedet klokkeslettet
med klokkeikon.

### Fargen er de samme bøttene som «Kommende hendelser»

`dueBucket`/`startBucket` er den ENE inndelingen av tid i appen, og både
chipene (`dueStatus`/`startStatus`) og gruppene i hendelsesmodalen leser dem.
En frist som står «innen en uke» der kan derfor ikke være rød i lista.

| Felt | Bøtte | Grense | Chip |
|---|---|---|---|
| **frist** | `over` — utløpt | `due < now` | rød (`--grad-red`) |
| | `soon` — innen en uke | `now <= due < now + 7 døgn` | gul (`--grad-yellow`) |
| | `month` — innen en måned | `now + 7 døgn <= due < now + 30 døgn` | grønn (`--grad-green`) |
| | `far` — om mer enn en måned | `due >= now + 30 døgn` | grønn (`--grad-green`) |
| **start** | `started` — har begynt | `start <= now` | blågrønn (`--grad-accent`) |
| | `soon` — innen en uke | `now < start < now + 7 døgn` | lilla (`--grad-purple`) |
| | `month` — innen en måned | `now + 7 døgn <= start < now + 30 døgn` | blå (`--grad-blue`) |
| | `far` — om mer enn en måned | `start >= now + 30 døgn` | blå (`--grad-blue`) |

Grensene er uttømmende og møtes uten hull, og ett døgn er 24 timer — uka er
`WEEK_MS` (7 døgn) og måneden `MONTH_MS` (30 døgn), ikke kalenderuker eller
kalendermåneder. **Startene låner ikke varselfargene:** at noe begynner er
ingen advarsel, så de har sine egne flater, som i modalen
([`kommende-hendelser.md`](kommende-hendelser.md)).

**Chipen er en GROVERE lesning av de samme bøttene.** Modalen har åtte grupper,
chipen seks toner: `month` og `far` deler tone (`CHIP_TONE`). En chip under et
navn i board-et skal si at noe ikke haster — ikke hvor langt fram det ikke
haster; det tallet står allerede i chipens egen tekst. Inndelingen er fortsatt
ÉN: chipen leser den samme funksjonen, den bare slår sammen de to ytterste.

De fire LYSE flatene (gul, grønn, lilla, blå) pinner en mørk ikonstrek og et
lyst «papir» for seg selv; de to mørke (rød, blågrønn) beholder streken som
snur med drakten. Se [`mork-drakt.md`](mork-drakt.md) og
[`tilgjengelighet.md`](tilgjengelighet.md).

### Chipen lever i tid, ikke bare i tilstand

En frist som passerer mens brukeren ser på skjermen blir rød der og da — uten
en rendring. `paintTimeChip` eier ALT som avhenger av klokka (tonen, glyfen og
teksten), så den kan kalles på nytt alene, og `refreshTimeChips` sover til den
FØRSTE grensen som kan endre noe: hver chips tidspunkt, dens sju-døgnsgrense,
og midnatt (da «i dag kl. 14» blir «14. jul»). Taket er seks timer, og en
`visibilitychange` maler på nytt med én gang — en `setTimeout` er ikke til å
stole på over en fane i bakgrunnen eller en enhet som har sovet. Samme mekanikk
som hendelsesmodalen.

Bryter fristen invarianten (`.meta-chip.is-conflict`), bytter chipen glyf til
varseltrekanten og forteller i teksten sin hvilken forelder som er brutt — se
«Den harde fristinvarianten» over. Statusfargen står urørt: den sier fortsatt
hvor fristen ligger i tid.

## Synk/DB

Doc-radene har `start`/`due` (listepunkt + liste + kategori) og `lockTimes`/
`responsible` (liste + kategori); DB-kolonnene heter `start_at`/`due_at` (text),
`lock_times` (boolean, nå også på `items` for kategorier) og `cards.responsible`
(uuid → profiles, `on delete set null`). Kategorier lever i `items`-tabellen
(`items.is_cat`, `items.cat_id` → self-FK, `items.lock_times`) — se
`docs/data-model.md`.
Oppdatert hele veien: `cleanItem`/`cleanCard`, `mergeItem`/`mergeCardScalar`,
`canonRow` (`_canon`-grenen), `insert-`/`updatePayload`, mock-backend,
`supabase/users-and-sharing.sql` (idempotente `add column if not exists`,
LWW-triggere, `get_my_doc`, `import_doc`). Skjemaet kjøres av
«Supabase DB-oppsett»-workflowen ved push til `main`.
