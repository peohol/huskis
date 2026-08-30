# Varsler

Les denne når oppgaven berører bjelleknappen, varselmodalen, hva som blir et
varsel, eller hvordan varselhistorikken lagres og synkes.

Fire ting bor her, og de er bevisst skilt:

1. **Generatoren** — `notifThresholds()` i `app.js`, sett gjennom to vinduer:
   `collectNotifications(state, now, prefs, cursor)` ser BAKOVER (det som har
   passert) og `planNotifications(state, now, prefs)` ser FRAMOVER (det som
   kommer). Begge leser TERSKLER ut av hendelsene
   [`kommende-hendelser.md`](kommende-hendelser.md) allerede regner ut, og har
   ingen egne regler om hva som er aktivt, hva som er arvet eller hva som
   dedupliseres.
2. **Lagringen** — per-bruker-tabeller i Supabase (`notifications`,
   `notification_prefs`, `push_subscriptions`, `push_deliveries`). Varsler er
   ikke innhold: de deles aldri, de flettes ikke, og de ligger utenfor
   synk-doc-et.
3. **Flaten** — bjelleknappen med ulest-badgen, modalen `#notif-modal`, og
   **varsel-toasten** som springer ut fra knappen når et varsel dukker opp.
4. **Leveringskanalene** — native Android-varsler og web push. De er
   LEVERINGER av rader generatoren allerede har logget, aldri egne generatorer.

Tidsverdiene og semantikken for dato uten klokkeslett er beskrevet i
[`scheduling.md`](scheduling.md), som er autoritativ for dem.

## De fire varseltypene

| Type | Terskel | Ikon/flate |
|---|---|---|
| `dueOver` — frist utløpt | den effektive fristen | varseltrekant, rød |
| `dueSoon` — frist om mindre enn en uke | `frist − 7 døgn` | varseltrekant, gul |
| `startNow` — begynner nå | den effektive starttiden | start-/play-ikon, blågrønn |
| `startSoon` — begynner om mindre enn en uke | `start − 7 døgn` | klokke, lilla |

Grensene er de SAMME som «Kommende hendelser» grupperer på: `WEEK_MS` er sju
døgn à 24 timer, og `timeMs(verdi, felt)` er den eneste omregningen — en
fristdato uten klokkeslett varer ut døgnet, en startdato begynner 00:00. Det
finnes ingen egen tolkning her.

Flatene er de samme også, helt bokstavelig: raden bruker `.event-icon` med
gruppens tone, så et varsel om en utløpt frist ser ut som «Frist utløpt» gjør i
hendelsesoversikten. Pinningen følger dermed platen, ikke modalen
([`mork-drakt.md`](mork-drakt.md)), og flatene er allerede med i
kontrastkontrakten ([`tilgjengelighet.md`](tilgjengelighet.md)).

## Generatoren

```js
collectNotifications(state, now, prefs, cursor)   // → rader som skal logges (fortid)
planNotifications(state, now, prefs)              // → rader som skal logges (framtid)
```

Rene funksjoner: tilstand, tidspunkt, preferanser og markør inn — radene ut.
Ingen DOM, ingen nettverk, ingen klokkeoppslag. Begge kaller den samme
`notifThresholds()`, som kaller `collectUpcomingEvents()` og leser to terskler
ut av hver hendelse (tidspunktet selv, og uka før det). De er altså ÉN motor
sett gjennom hvert sitt vindu, ikke to nesten like motorer.

Alt annet er hendelsesmotorens svar, ikke et nytt regelsett:

- hva som er **aktivt/ufullført** (tom liste, alt avkrysset, papirkurven).
  Merk konsekvensen: **en liste uten listepunkter varsler ikke**, heller ikke
  når den har en frist — den har ingen hendelse i «Kommende hendelser» heller,
  fordi det ikke er noe igjen å rekke fristen med
  ([`kommende-hendelser.md`](kommende-hendelser.md), «Hva som er aktivt»);
- **effektiv, egen og arvet** tid — et listepunkt med rent arvet frist får ingen
  egen rad, bare forelderen;
- den **hierarkiske dedupliseringen**;
- **navigasjonsmålet** (`{ type, id }` til `navigateToObject()`).

Trenger varslene noe mer, utvides `collectUpcomingEvents` — det skal ikke finnes
to nesten like motorer.

### Markøren er hele idempotensen

`cursor` er tidspunktet terskler er vurdert **til og med**. En terskel blir et
varsel bare når den ligger i det halvåpne vinduet `(cursor, now]`.

Markøren rykker fram i den SAMME serveroperasjonen som skriver radene
(`notify_record`), og bare framover — og aldri forbi serverens egen klokke, så
en enhet med feil klokke ikke kan blende varslene for de andre. Konsekvensene er
verdt å lese sammen:

- **Catch-up er ikke et eget kodeløp.** Har appen vært lukket i ti dager, dekker
  vinduet ti døgn. En frist som først kom innenfor uka og siden gikk ut gir da
  BEGGE varslene, hver med sin egen faktiske terskeltid som hendelsestid.
  Historikken beskriver hva som skjedde, ikke bare hvor det endte.
- **Ingenting genereres to ganger.** En ny åpning, en ny enhet eller en tømt
  historikk kan ikke gjenskape et varsel: markøren står allerede foran
  terskelen. «Tøm varsler» er dermed permanent.
- **Første runde på en konto logger ingenting.** Finnes det ingen markør, settes
  den til nå. Uten det ville hver eneste frist som noen gang er gått ut blitt et
  ulest varsel i det brukeren logget inn.
- **En terskel som allerede var passert da verdien ble satt, varsler ikke.**
  Setter man en frist til i går, ligger terskelen bak markøren. Varslene handler
  om terskler appen har SETT passere.

For at det siste punktet skal være sant, må markøren rykke fram også når det
ikke er noe å logge — ellers ville den blitt stående der siste varsel ble
skrevet, kanskje uker tilbake, og alt som ble SATT til et tidspunkt i mellomtiden
hadde blitt varslet med det samme. En tom runde flytter den derfor også, men
bare når den har blitt eldre enn fem minutter (`NOTIF_CURSOR_MAX_LAG_MS`): en
app som står åpen skal ikke skrive til databasen hvert femte sekund. Prisen er
at en frist satt til de siste par minuttene fortsatt kan gi et varsel om at den
er passert — den ER passert, så det er ikke galt.

Én runde logger maksimalt `NOTIF_BATCH_MAX` (50) rader, og beholder de nyeste
tersklene: en historikk som åpner med tre hundre rader er ikke en historikk.

### Planen framover

Markøren over svarer på hva som HAR skjedd. Det som gjør at et varsel kan nå
fram når appen er **lukket**, er at generatoren også ser den andre veien.

`planNotifications()` er den samme motoren med vinduet snudd: tersklene som
ligger i `(nå, nå + 30 døgn]`, nærmest først, maksimalt
`NOTIF_PLAN_MAX` (40). De logges med `notify_record()` som alle andre rader —
med `at` FRAM I TID.

Det er hele mekanismen, og den er billig fordi den låner en form som allerede
fantes: **en rad med `at` i framtiden er usynlig og teller ikke som ulest før
den forfaller** — nøyaktig som et utsatt varsel («Utsett», under). Modalen,
badgen, vekkingen og toasten trengte derfor ingen ny regel.

Svaret på «hvor kjører generatoren når appen er lukket» er dermed: **den gjør
ikke det.** Den kjørte sist appen var åpen, og la planen fra seg. Android
planlegger sine lokale varsler fra den listen; web push leverer den fra
serveren. Ingen av kanalene tolker en terskel — de leverer rader som allerede er
logget.

**Planen har to tall, og begge koster noe.** Konsekvensen av hvert av dem:

**Horisonten (30 døgn).** En terskel lenger unna enn horisonten er ikke
planlagt, og kan derfor ikke leveres eksternt. Har appen ikke vært åpen på en
måned, er det ingenting å levere. Den dagen den åpnes, logges de passerte
tersklene som vanlig (vinduet bakover) og en ny plan legges — altså: varselet
uteblir som PUSH, ikke fra appen.

**Taket (40 rader).** Planen tar de NÆRMESTE 40 tersklene innenfor horisonten.
Ligger det flere der, rykker nummer 41 inn i planen i den samme synk-runden som
nummer 1 forfaller — planen legges på nytt hver runde, så køen er selvgående så
lenge appen brukes. Det eneste tilfellet der en terskel faktisk ikke blir
levert, er derfor: appen står lukket sammenhengende, OG det lå mer enn 40
terskler foran den i horisonten. Også da står raden i historikken neste gang
appen åpnes.

Tallet er 40 og ikke høyere fordi planen deler budsjett med historikken:
`get_my_doc()` sender de 200 nyeste varselradene sortert på `at`, og planlagte
rader har den største `at`-en — de ligger altså først i de 200, og hver plass
planen tar er en plass historikken mister. Klienten henter det doc-et hvert
femte sekund. 40 er en femtedel av budsjettet; en plan på hundre ville halvert
historikken for alle, for en gevinst bare en konto med svært mange datoer i
samme måned ville merket.

**Planen er ikke historikk.** Forskjellen er hva som gjør en rad ugyldig, og den
står under «Varsler som ikke gjelder lenger».

### Tidssonen planen tilhører

Terskeltidene er absolutte millisekunder, regnet ut av `timeMs()` fra **lokal
veggtid**. En frist «14. mars kl. 09:00» er derfor et annet tidspunkt i Tokyo
enn i Oslo, og en plan hører til ÉN sone.

`notification_prefs.tz` er den sonen, og `tz_at` er når den sist ble hevdet.
Regelen har tre ledd:

- **Bare enheten som HOLDER sonen planlegger** — og bare den rydder i planlagte
  rader. En enhet i en annen sone logger historikk som før, men lar planen være.
- En enhet i en annen sone **hevder** sonen (`notify_claim_tz`) og planlegger
  fra og med neste runde.
- Hevdelsen går bare gjennom når den forrige er **eldre enn seks timer**
  (`NOTIF_TZ_CLAIM_MS`), og ventetiden håndheves av serveren, ikke av klienten.
  Uten den ville to enheter i hver sin sone slettet og gjenskapt hverandres plan
  i hver eneste synk-runde. Reiser man, står den forrige enheten som regel
  ubrukt, og overtakelsen skjer med det samme.

**Sommertid trenger ingen regel.** `new Date(år, måned, dag, time, minutt)` gir
riktig instans for den lokale datoen på begge sider av en overgang; det er bare
sonebytter som gjør en plan ugyldig.

**Delt innhold får hver sin tid.** En delt liste med frist kl. 09:00 varsler
hvert medlem kl. 09:00 i MEDLEMMETS egen sone — planen er per bruker, og hver
klient regner den ut i sin egen. Veggtiden er den samme for alle; øyeblikket er
det ikke.

Selve `start`/`due`-feltene er fortsatt lokal veggtid som tekst
([`scheduling.md`](scheduling.md)) og konverteres ikke til UTC. Serveren regner
ingen terskler og trenger derfor ingen sone til det; feltet er der for å si
hvilken sone planen tilhører — og for at en feil skal være mulig å se.

### Identitet

Nøkkelen er `type|objekttype|objekt-id|tidsverdi`, og den unike indeksen
`(user_id, key)` i databasen er andre lag: to enheter som regner ut det samme
varselet i samme øyeblikk skriver den samme raden, og den andre skrivingen faller
stille bort. `notify_record()` svarer med hvor mange rader som FAKTISK ble lagt
inn — klienten planlegger bare en ekstra pull når svaret er større enn null, og
luker dessuten kandidater den alt har en rad for. Uten begge deler ville en
klient med klokka foran serverens sendt de samme tersklene om igjen i det
uendelige.

**Tidsverdien er med i nøkkelen.** Flytter brukeren fristen, er det en ny
tidsplan: den nye terskelen kan varsle for seg, og det gamle varselet blir
stående i historikken (det beskriver noe som faktisk skjedde). Settes fristen
TILBAKE til en verdi det allerede er varslet om, varsles det ikke på nytt —
varselet finnes allerede.

## Preferansene

Fire brytere, én per type, bak tannhjulet i modalens hode. **Standard er PÅ for
alle fire.**

**Hodet har to tilstander, og aldri begge utgangene samtidig.** I listen står
bjellen + «Varsler» med tannhjulet til høyre; i innstillingene står tannhjulet
+ «Varselinnstillinger», tannhjul-knappen er borte, og en tilbakeknapp til
VENSTRE for overskriften er veien ut. Overskriften sier dermed selv hvor man er,
og det finnes én vei inn og én vei ut. Ingen forklaringstekst over bryterne:
navnene sier hva de gjør, og hva en avslått type betyr står her, ikke i UI-et.

Innstillingene er et NIVÅ inne i varselmodalen, ikke en egen modal: Androids
tilbakeknapp går ett nivå tilbake til varslene (samme mønster som del-modalens
← i [`menus.md`](menus.md)), mens Escape fortsatt lukker helt — «lukk = ferdig».
En badge er ingen avbrytelse, og en funksjon som er av fra første stund blir
aldri sett. De eksterne kanalene har sin egen opt-in oppå dette, som en femte
rad i det samme panelet (se «De eksterne kanalene»).

Bryterne styrer om hendelsen **genereres i det hele tatt** — ikke om den vises.
En avslått type lager ingen rad, heller ikke i historikken. Det er den regelen
som gjør in-app og eksternt varsel til to leveringskanaler for det samme valget
i stedet for to uavhengige innstillinger.

Et bytte flytter markøren til nå (både i klienten og i `notify_set_prefs`): en
terskel som passerte mens typen var av skal ikke velte inn i det den slås på
igjen.

Preferansene ligger på **brukeren**, ikke på enheten, og synkes med resten av
doc-et.

## Lagringen

Varslene ligger i to tabeller i `supabase/users-and-sharing.sql`, ikke i
synk-doc-et: de har ingen forelder å arve tilgang fra, de skal aldri flettes, og
lest/ulest skal være det samme på alle mine enheter.

| Tabell | Innhold |
|---|---|
| `notifications` | én rad per logisk varsel: `user_id`, `key`, `type`, `obj_type`/`obj_id`, `name`, `path`, `value`, `at`, `snoozed`, `created_at`, `read_at` |
| `notification_prefs` | én rad per bruker: de fire bryterne, `cursor_at` og sonen planen tilhører (`tz`, `tz_at`) |
| `push_subscriptions` | ett abonnement per nettleser: `endpoint` (globalt unikt), `p256dh`/`auth`, `labels`, `tz`, `disabled_at` |
| `push_deliveries` | utboksen: én rad per (varsel, abonnement) med `due_at`, `status`, `attempts` |

- **RLS: kun egne rader**, hele veien (select/update/delete). Andres varsler kan
  ikke leses, merkes eller slettes — heller ikke for et objekt vi deler.
- **Klienten kan ikke sette inn rader.** Det gjøres av `notify_record()`
  (security definer), som setter `user_id` fra `auth.uid()` selv. Update er
  kolonne-avgrenset til `read_at`: lest/ulest er det eneste klienten eier på en
  eksisterende rad. Preferansene skrives kun av `notify_set_prefs()`.
- **Abonnementene** leses og slettes av eieren, men skrives kun av
  `push_subscribe()` — ellers kunne en klient skrevet en rad på en annens
  bruker-id og fått den brukerens varsler sendt til seg.
- **Utboksen er låst.** RLS på, ingen policyer, ingen grants: verken `anon`
  eller `authenticated` når `push_deliveries` gjennom PostgREST. Den leses og
  skrives kun av `push_claim()`/`push_report()`, som er avgrenset til
  `service_role` — både med grants og med en rollesjekk inne i funksjonen.
- `name` og `path` er et **øyeblikksbilde** fra genereringstidspunktet, så raden
  kan vises også etter at objektet er slettet. Navigasjonen bruker dem aldri —
  den slår alltid opp `obj_id` i gjeldende tilstand.
- Historikken har et **tak på 200 rader per bruker**; `notify_record()` rydder
  de eldste utover det, og `get_my_doc()` leverer det samme taket.

Radene og preferansene kommer med `get_my_doc()` (samme runde som resten), og
generatoren kjøres sist i hver synk-runde. Skjemaendringene er additive: en
gammel klient som ikke kjenner grenene ignorerer dem.

**Historikken er serverens.** Den vises når en synk-runde har hentet den; det
finnes ingen lokal kopi i `localStorage`. En generator-runde som ikke når fram
lar markøren stå, og vinduet er fortsatt åpent ved neste forsøk — feilen er
selvlegende, ikke tapt.

## Varsler som ikke gjelder lenger

Et varsel beskriver ÉN tidsplan for ETT objekt. Forsvinner objektet, eller blir
tiden varselet gjaldt en annen, beskriver raden noe som ikke finnes — og da skal
den ikke bli stående og be om oppmerksomhet. Den **slettes**.

`purgeStaleNotifs()` kjøres rett etter hver pull (`applyNotifications`) og
sletter radene der:

| Tilstand | Gjelder | Hvorfor |
|---|---|---|
| objektet finnes ikke i `state` (slettet, i papirkurven, eller utenfor tilgangen min) | alle rader | det er ingenting igjen å varsle om |
| objektets **effektive** tid for feltet er en annen enn radens `value` | alle rader | den gamle tidsplanen finnes ikke lenger |
| raden står ikke lenger i planen, eller står der med en annen terskeltid | kun PLANLAGTE rader (`at` fram i tid, ikke utsatt) | en plan som ikke er planen lenger |

**Den siste raden er forskjellen på en plan og en historikk**, og den er det som
avlyser en framtidig levering:

- **fullføres listepunktet**, forsvinner hendelsen fra «Kommende hendelser» —
  selv om tiden på objektet står urørt. Den planlagte raden er da ikke i planen,
  og slettes. Kaskaden tar leveringene i utboksen med seg, og Android-adapteren
  kansellerer det native varselet ved neste runde;
- **byttes tidssonen**, gir den samme datoen en annen terskeltid. Raden beskriver
  da et tidspunkt planen ikke lenger har, og erstattes.

En **utsatt** rad er brukerens egen bestilling og står ikke i planen — den måles
bare mot objektet, som før. Og en enhet som ikke holder tidssonen rører ikke
planlagte rader i det hele tatt (se «Tidssonen planen tilhører»).

Merk at et varsel som ALLEREDE har forfalt ikke rammes av den siste raden: det
er historikk, og historikk beskriver noe som skjedde.

To ting gjør dette trygt å kjøre automatisk:

1. Det kjøres **kun rett etter en pull**, altså med et ferskt doc flettet inn i
   `state`. Et halvlastet tre ville sett ut som om alt var slettet.
2. Sammenligningen går på den **effektive** tiden (`effectiveTime`), samme
   presedens som resten av appen: en låst liste styrer listepunktenes tider, så
   en rad om et listepunkt måles mot den tiden som FAKTISK gjelder for det.

Feiler slettingen, står radene igjen på serveren og runden tas om igjen ved
neste pull. Ingen toast — brukeren ba ikke om dette.

**Merk hva som IKKE er ugyldig:** at et listepunkt som ALT er varslet om, krysses
av. Varselet beskriver noe som faktisk skjedde, og historikken beholdes. Det er
bare den framtidige planen fullføringen avlyser.

Konsekvensen av at markøren er permanent (se «Markøren er hele idempotensen»)
gjelder her også: gjenoppretter man objektet fra papirkurven, kommer ikke
varslene tilbake — terskelen er brukt opp. Det er det samme svaret «Tøm varsler»
gir.

## Lest/ulest

`read_at` på raden. Badgen på bjellen teller de SYNLIGE varslene som er uleste
og som ikke nettopp er sett i en åpen modal (skjult ved 0, `99+` over hundre),
og antallet står i knappens `aria-label` — badgen selv er `aria-hidden`. Uten
det siste leddet ville en pull som lander før serveren har bekreftet
lest-merkingen blinket antallet tilbake.

**Åpning av modalen markerer lest**, uten en «Sett alle som lest»-knapp.
Grensen er et **sett av ID-er**, ikke et tidspunkt: nøyaktig de varslene som sto
der da modalen ble åpnet. Et varsel som ankommer etterpå — eller et utsatt som
forfaller — forblir ulest til modalen åpnes på nytt. Operasjonen er idempotent
(bare uleste rader røres), så to enheter kan gjøre den samtidig.

De radene åpningen merket lest **beholder markeringen til modalen lukkes**. Ellers
ville hele listen blitt grå i det samme øyeblikket, og brukeren mistet nettopp
det badgen lovte: hvilke rader som var nye.

## «Tøm varsler» med angre

1. et **øyeblikksbilde** av akkurat de ID-ene som er synlige nå;
2. de skjules med én gang;
3. knappen blir `Angre · 10` og teller ned — ingen bekreftelse;
4. «Angre» gjenoppretter øyeblikksbildet;
5. etter ti sekunder committes slettingen;
6. **å lukke modalen committer med én gang** — angre-vinduet hører til den åpne
   modalen, og det samme gjør en fane som forsvinner (`visibilitychange`), som
   for den buffrede slettingen ([`trash.md`](trash.md)).

Et varsel som ankommer etter øyeblikksbildet er ikke med i settet og blir ikke
slettet med det. **Planen framover røres heller ikke:** øyeblikksbildet er de
SYNLIGE radene, og en planlagt rad er usynlig til den forfaller. Å tømme
historikken slår altså ikke av de eksterne varslene — det gjør bryteren i
innstillingene.

Går serveroperasjonen i vasken, later appen **ikke** som noe annet: radene er
fortsatt på serveren, de vises igjen straks, og en toast sier fra.

## «Utsett»

Hver rad har en liten klokke ved siden av seg. Den åpner en **popover forankret
i knappen** — ikke en rad under kortet: der lå valgene mellom to kort, og det
var ikke til å se hvilket av dem de hørte til. Popoveren har overskriften
**«Varsle på nytt om»**, og fordi overskriften bærer «om» er valgene rene
varigheter:

| Valg | Betydning |
|---|---|
| **1 time** / **6 timer** / **1 døgn** | et fast sprang fra nå |
| **Egendefinert** | folder ut en liten skuff med **dato + klokkeslett** |

Skallet er det samme som bytterne og tids-popoveren bruker (`.switcher-*`):
popover ved knappen på desktop, sentrert ark på mobil, felles fokusfelle og
felles plass i Escape-stigen (`closeTopLayer`) — den ligger over varselmodalen.
Panelet er så bredt innholdet krever, så det er smalt med bare fire varigheter
og vokser når skuffen åpnes.

**Skuffen krever begge feltene, og et tidspunkt fram i tid.** Et utsatt varsel er
ET TIDSPUNKT, ikke et døgn, og et tidspunkt som alt er passert ville forfalt med
det samme — da har «utsett» ikke betydd noe. Begge deler avvises i panelet med
en kort beskjed i stedet for å bli logget.

Valget logger det samme varselet på nytt med et tidspunkt i framtiden
(`snoozed`), og nøkkelen får utsettelsestidspunktet med seg (`<original>|s<tid>`),
så identiteten ikke kolliderer med det opprinnelige.

### Knappen er ARMERT når noe er bestilt

Nøkkelformen over er samtidig **lenken tilbake**: `pendingSnooze(row)` finner en
rad som ennå ligger i framtiden og hvis nøkkel er radens egen pluss `|s` og rene
siffer. (Sifferkravet er der for at en utsettelse av utsettelsen — `…|s1|s2` —
ikke skal armere den opprinnelige raden også.) Ingen ny kolonne trengs.

Er noe bestilt, bærer utsett-knappen aksentflaten med hvit glyf, den samme
«på»-fargen bryterne bruker — ellers var utsettelsen usynlig i det sekundet
toasten forsvant. Fargen er ikke eneste bærer: knappens navn sier det samme.

Og popoveren tilbyr da **ikke** en ny utsettelse — to varsler om det samme er
ikke det noen mente. Den sier når varselet kommer («Du vil bli varslet igjen kl.
17:00», med datoen i tillegg når det er et annet døgn), og tilbyr det ene som
gir mening: å avbryte det. Å avbryte er å slette den planlagte raden.

Et varsel med `at` i framtiden er **usynlig og teller ikke som ulest** før det
forfaller. Modalen og badgen sover fram til det første slike tidspunktet
(`scheduleNotifWake`), med samme tak og samme `visibilitychange` som
hendelsesmodalen.

**Neste midnatt er alltid en grense der også.** Datooverskriftene og
dagsnavnene i meldingene avhenger av hvilket døgn vi står i, ikke av radene:
uten den vekkingen ville en modal som står åpen over midnatt uten at noe annet
skjer — appen ligger stille, ingen synk-runde, ingen utsatte varsler — blitt
stående med gårsdagens ord. Datoen i signaturen sørger for at malingen faktisk
skjer når vekkingen kommer.

Å utsette er samtidig en kvittering: det opprinnelige varselet merkes lest.
Markøren røres ikke — ingen terskler er vurdert.

## Modalen (`#notif-modal`)

Vanlig `.modal-overlay`-skall (fokusfelle, Escape via `closeTopLayer`,
`body.modal-open`, fokus tilbake til bjellen ved lukking), med:

- **nyeste øverst**, sortert på hendelsens tidspunkt (`at`) — det er det samme
  på alle enheter — med id-en som tie-breaker, så rekkefølgen aldri hopper;
- radene samlet i **bunker per døgn**, med datoen som overskrift (under);
- raden i **tre linjer** (under);
- en tomtilstand når historikken er tom;
- «Tøm varsler» i foten;
- tannhjulet i hodet, som vender panelet til de fire preferansene.

Trykk på en rad lukker modalen og kaller `navigateToObject({ type, id })`
([`sok-og-navigering.md`](sok-og-navigering.md)).

### Datoen står over bunken, ikke på raden

Varslene som kom samme døgn ligger under ÉN datooverskrift. Datoen sies dermed
én gang der den betyr noe, i stedet for som et tidsstempel på hver eneste rad —
og raden får plassen til det den faktisk sier.

| Døgnet | Overskrift |
|---|---|
| i dag | «I dag» |
| i går | «I går» |
| eldre | ukedag + full dato: «Torsdag 27. august» (med årstall når det ikke er inneværende) |

Bunkene skilles av luft (`.notif-body`s gap), ikke av en strek — samme grep som
gruppene i «Kommende hendelser».

Datoen er en del av tilstanden malingen avhenger av, ikke bare radene: står
modalen åpen over midnatt, blir «I dag» til «I går» uten at en eneste rad har
endret seg. Dagens dato er derfor med i signaturen `refreshNotifModal()`
sammenligner på.

### Raden

Tre linjer over hverandre, med statusikonet til venstre:

```
[ikon]  Testområde › Testmappe            ← kontekststien, svært liten og dempet
        Testliste                          ← objektets navn
        Fristen er utløpt – den var i dag kl. 09:00.
```

Stien er et **øyeblikksbilde** fra genereringstidspunktet (se «Lagringen») og
plasserer objektet uten å konkurrere med navnet, som er det man leter etter.

**Meldingen navngir de tre nærmeste døgnene.** `fmtTimeRelDay()` skriver «i dag»,
«i går» og «i morgen» i stedet for datoen, og faller tilbake på den vanlige
datoen lenger ut («5. sep kl. 17:00»). Uten klokkeslett står dagen alene
(«Begynte i dag.») — en dato uten klokkeslett er et DØGN
([`scheduling.md`](scheduling.md)), og et klokkeslett vi ikke har skal ikke
finnes på.

| Type | Melding |
|---|---|
| `dueOver` | «Fristen er utløpt – den var {tid}.» |
| `dueSoon` | «Fristen utløper {tid}.» |
| `startNow` | «Begynte {tid}.» |
| `startSoon` | «Begynner {tid}.» |

Er målet borte, sier meldingen det i stedet for å la et dødt trykk forklare det
— men det er en kort tilstand: en rad uten gyldig objekt ryddes bort ved neste
synk-runde (se «Varsler som ikke gjelder lenger»).

Til høyre for raden står to knapper: **utsett** (klokka) og **slett** (✕).
Slett-knappen tar ÉN rad, uten angre-vindu — «Tøm varsler» er den som tar
bunken, og der er angre-vinduet prisen for at det er mange. Slettingen er
optimistisk lokalt og går rett på serveren; feiler den, kommer raden tilbake med
det samme og en toast sier fra.

Bjelleknappen står **først** i toppkontrollgruppen, til venstre for kalenderen
([`menus.md`](menus.md), «Toppkontrollene»).

## Varsel-toasten

Et varsel som dukker opp mens appen står åpen skal SES, ikke bare telles. En
liten toast **springer ut fra bjelleknappen** (`transform-origin` øverst til
høyre, stabelen posisjoneres i JS fra knappens faktiske plass — gruppen brytes
til flere rader på smale skjermer), står i **tre sekunder** og forsvinner.

**Formatet er et annet enn radens**, med vilje: `[ikon] **navn** · én kort
setning`. Ingen sti, ingen dato — en toast leses i forbifarten.

| Type | Toastens setning |
|---|---|
| `dueOver` | «Fristen er utløpt» |
| `dueSoon` | «Fristen utløper {avstand}» |
| `startNow` | «Starter nå» |
| `startSoon` | «Starter {avstand}» |

`{avstand}` er hele KALENDERDØGN (`fmtDaysAway()`): «i dag», «i morgen», «om 3
dager». Kalenderdøgn og ikke 24-timers bolker — «i morgen» skal bety i morgen,
også når det er tjue minutter unna.

**Flaten er varseltypens egen farge**, halvgjennomsiktig med `backdrop-filter:
blur(…)`, så toasten sier hva den gjelder før man har lest et ord. Tinten er den
MØRKESTE enden av den samme gradienten ikonet står på: en toast er en liten flate
der gradienten uansett ikke leses, og det mørke stoppet er det som bærer
tekstfargen sin med margin også når det gjennomsiktige laget legger seg over en
hvit bakgrunn. Tekstfargen pinnes per tone, som på chipene — hvit på rødt og
blågrønt, mørk på gult og lilla. Selve ikonet er den vanlige `.event-icon`-platen
med sin tone, altså det ene toasten IKKE gjør på sin egen måte.
Begge ytterpunktene (helt hvitt og helt svart bak) er med i kontrastkontrakten
([`tilgjengelighet.md`](tilgjengelighet.md)).

- **Trykk** fører til varselet: modalen åpnes, raden rulles fram og fokuseres.
- **Sveip til høyre** fjerner toasten før de tre sekundene er ute — nøyaktig
  samme gest og samme motor (`attachToastSwipe`) som den vanlige toasten
  ([`design-system.md`](design-system.md)).

### Hva som er «dukket opp»

`notifSeen` er de radene ØKTEN allerede har presentert, og det er hele regelen:

- **Første runde etter innlogging seeder settet uten å vise noe.** Ellers ville
  en innlogging gitt en vegg av toaster — historikken er opptil 200 rader.
- Et **utsatt** varsel er ikke med i settet før det FORFALLER, og toaster derfor
  når det blir synlig.
- Toaster vises ikke mens **et lag står åpent** (`body.modal-open`). Er det
  varselmodalen, er raden allerede synlig der. Er det noe annet, ville et trykk
  på toasten stablet varselmodalen oppå et lag brukeren står midt i — og
  Escape-stigen (`closeTopLayer`) hadde lukket det underste først. Runden
  oppdaterer settet likevel, så toasten ikke kommer igjen når laget lukkes.
- Å følge ÉN toast inn i modalen rydder **hele stabelen**: søsknene viser rader
  modalen nå selv har. Et lag som rakk å åpne seg etter at toasten kom, lukkes
  først, av samme grunn som over.
- Én runde viser maksimalt tre toaster (de nyeste). En catch-up-runde kan ha
  dusinvis av rader, og en kø av toaster er ingen kø — badgen og modalen har
  resten.

## Fullførte, slettede, flyttede og omplanlagte objekter

| Hva som skjer | Følgen |
|---|---|
| listepunktet fullføres FØR terskelen | ingen hendelse, altså heller ikke noe varsel — og en PLANLAGT rad om den terskelen avlyses ved neste pull, med den eksterne leveringen |
| det fullføres ETTER at varselet finnes | historikken beholdes urørt |
| objektet slettes eller tilgangen forsvinner | raden SLETTES ved neste pull (se «Varsler som ikke gjelder lenger»). Fram til den runden står den merket i teksten sin, og et klikk gir en beskjed i stedet for en navigering |
| objektet flyttes | historikken følger objekt-ID-en, ikke stien — `navigateToObject` slår opp hvor det ligger NÅ |
| start/frist endres | raden om den GAMLE tiden slettes ved neste pull; den nye planens terskler varsler for seg (nøkkelen bar den gamle verdien, så den nye kan varsle) |

Et mål som er borte oppdages med et rent lokalt oppslag i `state`. En id vi ikke
har tilgang til finnes ikke der, så en rad kan verken navigere til eller røpe noe
om et objekt vi ikke ser.

## Tilgjengelighet

- Dialogsemantikk på modalen; fokus flyttes inn ved åpning og tilbake til
  bjellen ved lukking (unntatt når en rad ble åpnet — da eier navigeringen
  fokuset).
- Radene er vanlige knapper, så Tab og Enter virker uten særbehandling. Hver rad
  har et `aria-label` med lest/ulest, varseltypen i KLARTEKST, navnet, meldingen,
  bunkens dato og stien — eller beskjeden om at objektet er borte. Datoen står
  visuelt utenfor knappen, i overskriften over bunken, men opplesningen tar den
  med: en rad skal kunne leses alene.
- Utsett-knappen har `aria-haspopup="dialog"` og `aria-expanded`, og popoveren
  arver `.switcher-overlay`-skallets fokusfelle og Escape.
- Toastene ligger i et `role="status"`-live-område, så de også NÅR en
  skjermleser, og hver toast har et `aria-label` med typen, navnet og meldingen.
  De er dessuten ikke eneste kanal: badgen og modalen har det samme.
- Antallet og hvor mange som er uleste leses opp fra et visuelt skjult
  `role="status"` ved åpning.
- Farge er aldri eneste bærer: typen står i meldingen, ulest bæres av både en
  kant og en prikk, og et utilgjengelig mål sier det i teksten.
- Badgen er `aria-hidden`; antallet ligger i knappens navn.

Kravene er de samme som ellers — se
[`tilgjengelighet.md`](tilgjengelighet.md).

## Språk

Alle tekstene ligger i ordboken under `notif.*`. Datoformene deles med resten av
appen og ligger under `date.*` — månedsnavn (korte og fulle), ukedagene, «i dag»/
«i går»/«i morgen» (små forbokstaver, de står midt i en setning) og avstanden i
døgn. Overskriftene «I dag»/«I går» har sine egne nøkler med stor forbokstav
(`notif.day.*`), fordi de er overskrifter og ikke setningsledd.
Se [`sprak.md`](sprak.md).

## De eksterne kanalene

De fire preferansene styrer HENDELSEN, ikke visningen. De to eksterne kanalene
er derfor ikke fire nye valg, men **én bryter per enhet** oppå de samme
hendelsene:

| | Android (i appen) | Nettleser |
|---|---|---|
| Mekanisme | LOKALE varsler planlagt på selve enheten (`@capacitor/local-notifications`) | Web Push: serveren sender, service workeren viser |
| Trenger en server? | **nei** — telefonen har planen og vekker seg selv | ja, både en abonnementsrad og en sender |
| Hva som leveres | planen (`planNotifications`) | planen, gjennom utboksen |
| Tillatelse | POST_NOTIFICATIONS (Android 13+) | `Notification.requestPermission()` |

Kanalen velges av plattformen og er aldri begge: inne i APK-en finnes det ingen
pushtjeneste å melde seg på, og i en nettleser finnes det ingen native plugin.

**Valget ligger på ENHETEN** (`localStorage`, som drakten), ikke på brukeren. At
telefonen skal buzze er ikke det samme valget som at den bærbare skal det. De
fire typebryterne ligger fortsatt på brukeren og gjelder alle kanaler — det er
den ene innstillingen som gjør in-app og eksternt varsel til to leveringer av
det samme valget i stedet for to uavhengige.

### Tillatelsen spørres aldri av seg selv

Systemdialogen kommer **kun** etter et trykk på bryteren i
varselinnstillingene, og linjen under bryteren forklarer hvorfor før den
utløses. Panelet har fire tilstander, og de sier hver sin sanne ting:

| Tilstand | Bryteren | Teksten |
|---|---|---|
| ikke støttet | finnes ikke | «Denne enheten kan ikke vise varsler utenfor Huskis. Varslene står fortsatt i listen her.» |
| av | av | forklaringen — hva du får, og at enheten kommer til å spørre |
| på | på | «På. Varslene kommer også når Huskis er lukket.» — eller «På her og på N andre enheter.» når web push er på flere |
| blokkert | av og **deaktivert** | «Blokkert. Slå på varsler for Huskis i enhetens innstillinger, og prøv igjen.» |

**Blokkert er en blindvei, ikke et nytt forsøk.** En bryter som lot seg slå på
uten å virke ville løyet, og en app som spurte igjen ville maset om noe
operativsystemet allerede har bestemt. Veien tilbake går gjennom enhetens
innstillinger, og det er det teksten sier.

Statusen leses på nytt hver gang panelet åpnes: tillatelsen kan ha blitt endret
i systeminnstillingene mens appen sto åpen.

### Teksten i et eksternt varsel

**Overskriften er objektets navn, kroppen er varseltypen i klartekst** — de
samme fire ordene som står over bryterne. Ikke radens melding, og ikke toastens:
et varsel på en låseskjerm skal si hva det gjelder og ikke mer.

Det som IKKE er med, er med vilje: ingen sti, ingen kontekst om hvem som deler
hva, ingen id-er i teksten, og aldri et token. Kroppen som sendes over nettet er
dessuten kryptert ende-til-ende (RFC 8291), så push-tjenesten ser bare et
endepunkt og en ugjennomsiktig blokk.

Pekeren i varselet (`{ objType, objId }`) er nettopp en peker — **aldri et
bevis**. Trykket kaller `navigateToObject()`, som slår id-en opp i gjeldende
tilstand; en id vi ikke har tilgang til finnes ikke der, og fører ingen steder.

### Android: lokale varsler

Adapteren speiler planen ut på enheten som en **diff** mot `getPending()`:
avlys det som ikke lenger står i planen, legg inn det som mangler. Uten diffen
ville hver synk-runde lagt inn de samme varslene på nytt, og en endret frist
blitt liggende ved siden av den nye.

Broen mellom Huskis' identitet og Androids er ren: `nativeNotifId()` er en
FNV-1a-hash klippet til et positivt 31-bits heltall (Androids varsel-ID er et
Java-`int`). Determinismen er hele poenget — det er den som gjør at den samme
planen speilet to ganger gir det samme varselet, ikke to.

Det som hashes er ikke nøkkelen, men **signaturen** (`nativeNotifSig()`):
nøkkelen, terskeltiden og teksten. Grunnen er at de tre kan skille lag.
Nøkkelen bærer objektets tidsVERDI («2026-09-02T09:00»), som er lokal veggtid,
mens terskeltiden `at` er det absolutte millisekundet den veggtiden peker på —
og det avhenger av tidssonen. Reiser telefonen til en annen sone, får det SAMME
logiske varselet et nytt `at` uten at nøkkelen rører seg. En diff på nøkkelen
alene ville da sett en alarm som «finnes allerede» og latt den bli stående og
ringe på gammelt klokkeslett. Med tiden inne i signaturen blir den flyttede
alarmen et annet tall, og diffen gjør det den skal: den gamle avlyses, den nye
legges inn. Teksten er med av samme grunn — et objekt som får nytt navn, eller
et språkbytte, endrer hva telefonen skal si uten å endre hvilket varsel det er.

Det betyr også at `getPending()` aldri trenger å levere mer enn ID-er, og på
Android er det klokt: `schedule.at` kommer tilbake derfra som en serialisert
Java-`Date`, ikke som noe man kan sammenligne på.

**Alarmene er upresise med vilje.** Hvert varsel planlegges med
`isExactNotification: false`, som gir `AlarmManager.setAndAllowWhileIdle()`:
systemet kan flytte det noen minutter, men det fyrer også i dvale. Tersklene er
«fristen er utløpt» og «begynner innen en uke», ikke alarmer på sekundet, og
SCHEDULE_EXACT_ALARM er derfor **trukket tilbake** fra pluginens manifest med
`tools:node="remove"`. En tillatelse Huskis ikke trenger — og som Google Play
krever et eget skjema for — skal appen ikke be om.

Ikonet i statuslinjen er `ic_stat_huskis`: merkets tre kortkonturer som maske.
Uten det bruker pluginen Androids egen `ic_dialog_info`, og hvert varsel ville
sett ut som ingens.

### Nettleser: web push

Fire ledd, og alle fire må finnes for at kanalen skal eksistere:
`serviceWorker`, `PushManager`, `Notification` og en **avsendernøkkel**
(`pushPublicKey` i `config.js`). Står nøkkelen tom, finnes kanalen ikke — det er
ikke «av», for det er ingen sender å melde seg på hos.

**Nøkkelparet.** VAPID (RFC 8292) identifiserer SENDEREN overfor
push-tjenesten. Den offentlige halvdelen ligger i `config.js` og er ment å ligge
der; den private ligger i Supabase Vault og finnes ingen steder i repoet. Bare
den private kan lage en gyldig signatur, så den offentlige gir ingen tilgang til
noe. Paret lages én gang, manuelt — stegene står i [`../TODO.md`](../TODO.md).

**Abonnementet er nettleseren.** `endpoint` er globalt unikt, så en ny
innlogging i samme nettleser FLYTTER abonnementet til den nye brukeren i stedet
for å lage en dublett. `push_subscribe()` er idempotent på endepunktet og
kjøres på nytt hver synk-runde det er noe å oppdatere: et endepunkt nettleseren
har rullert, nye etiketter etter et språkbytte, eller et abonnement som ble
meldt av ved utlogging. Fornyelsen er dermed selvhelbredende og spør aldri om
tillatelse på nytt.

**Et eierskifte tømmer køen.** Flyttingen over gjelder raden — men køen som lå
på den er den FORRIGE brukerens, og hver levering bærer et objektnavn. Uten en
tømming ville den nye brukerens nettleser vist forrige brukers varsler i det de
forfalt. `push_subscribe()` sletter dem derfor i den samme operasjonen som
flytter raden, og `push_claim()` plukker aldri opp en levering der
abonnementets eier ikke lenger er leveringens: andre lag gjør en rad som
likevel skulle bli hengende igjen INERT i stedet for feillevert.

**Avmeldingen går lokalt FØRST.** Det er avmeldingen i nettleseren som faktisk
stopper et varsel: uten service worker finnes det ingen som kan vise et, og et
avmeldt endepunkt gir 410 ved neste sending — som slår raden av på serveren av
seg selv. Ble serveren spurt først og svarte feil, ville hele den lokale
nedriggingen blitt hoppet over, og en utlogging UTEN NETT hadde gitt det
motsatte av hensikten: en utlogget nettleser som fortsetter å vise varsler med
objektnavn. Serveropprydningen er derfor best effort, og skjer etterpå.

**Hva et abonnement får være.** `endpoint` blir målet for et HTTP-kall senderen
gjør på vegne av serveren, og en innlogget konto er hele inngangsbilletten.
`push_subscribe()` setter derfor tre grenser, alle på serveren:

| Grense | Regel | Hvorfor |
|---|---|---|
| Endepunktet | `https://`, et vertsNAVN (ikke en bar IP, ikke `localhost`), ingen kontrolltegn, maks 2000 tegn | En vilkårlig URL ville gjort senderen til en måte å banke på dører på innsiden |
| Nøklene | base64url, `p256dh` 80–200 tegn og `auth` 16–40 | RFC 8291 sier 65 og 16 byte; grensene er romsligere (padding), men holder søppel ute av en tabell senderen leser fra |
| Antall | maks `push_sub_max()` (20) rader per bruker | Hvert abonnement multipliserer BÅDE utboksen og antallet HTTP-kall. Uten et tak er RPC-en en forsterker |

Ingen liste over pushleverandører: Web Push har ingen fast tjenesteliste, og en
slik liste ville låst appen ute fra enhver nettleser som ikke sto på den.

Taket kaster ut den **eldst sette**, aldri den som nettopp meldte seg på — den
er den brukeren står med i hånden. Kaskaden tar utboksen til den som ryker med
seg.

**Etikettene følger med abonnementet.** De fire typetekstene lagres i
`labels`, på brukerens språk. Service workeren har ingen ordbok, og SQL skal
ikke ha en — uten dette leddet måtte i18n ha ligget to steder til.

**Utlogging melder av.** Avmeldingen kjøres FØR sesjonen slippes: et abonnement
som ble stående ville sendt varsler med objektnavn til en nettleser ingen er
logget inn i. Med en frist på tre sekunder, og den er ikke pynt — dette er det
eneste nettverkskallet som står mellom brukeren og utloggingen, og en treg
server skal ikke kunne holde noen innlogget. Den lokale nedriggingen ligger
først i rekkefølgen nettopp derfor: den er ferdig lenge før fristen kan løpe
ut.

### Service workeren (`sw.js`)

Den finnes for én grunn: en nettleser kan ikke kjøre en timer når fanen er
lukket, så Web Push krever en service worker. Alt annet den KUNNE gjort, gjør
den ikke:

- **ingen `fetch`-lytter.** Huskis er ikke en PWA, og caching av appens egne
  filer ligger i cache-headerne og build-ID-en i URL-ene
  ([`auto-update.md`](auto-update.md)). En service worker som svarte på
  forespørsler ville lagt seg MELLOM nettleseren og de headerne, og blitt et nytt
  sted en gammel versjon kunne bli hengende. Uten `fetch`-lytteren er
  oppdateringsmodellen nøyaktig som før den ble registrert;
- ingen cache, ingen IndexedDB, ingen nettverkskall, ingen tilstand.

Den registreres først når brukeren har slått på kanalen, og avregistreres når
den slås av.

`push` viser varselet med `tag = <nøkkelen>`, så det samme varselet ERSTATTER
seg selv i stedet for å stable seg — samme regel som den unike nøkkelen i
databasen. En push uten lesbar kropp blir likevel et synlig varsel:
`userVisibleOnly: true` er et løfte til nettleseren, og brytes det, straffer den
abonnementet.

`notificationclick` **fokuserer en åpen Huskis-fane** og gir den pekeren som en
melding — fanen navigerer selv, med sin vanlige tilgangskontroll. Finnes ingen
åpen fane, åpnes appen med `?notif=<type>:<id>`; app.js plukker den opp når den
er innlogget og synket, og fjerner den fra adressen, så en reload ikke navigerer
igjen.

### Senderen

Databasen eier køen, rekkefølgen og idempotensen. Edge-funksjonen
`supabase/functions/push-send` eier HTTP-kallet — og bare det.

1. `notify_record()` fyller utboksen (`push_enqueue`): én rad per (planlagt
   varsel, aktivt abonnement), `due_at = varselets terskeltid`. Den unike
   indeksen `(notification_id, subscription_id)` er idempotensen: det samme
   logiske varselet kan ikke sendes to ganger til det samme abonnementet,
   uansett hvor mange ganger generatoren kjører.
2. `pg_cron` kaller `push_tick()` hvert minutt, som dytter Edge-funksjonen i
   gang med `pg_net` — nøyaktig det oppsettet e-postvarselet ved deling allerede
   bruker, med hemmeligheten i Vault og adressen i `app_config`. Uten
   konfigurasjon gjør tikket ingenting og feiler ikke.
3. `push_claim()` henter forfalte leveringer og LÅSER dem (`claimed_at`,
   `for update skip locked`). To samtidige kjøringer kan derfor ikke sende det
   samme, og en kjøring som dør halvveis blir hentet inn igjen av den neste i
   stedet for å bli stående.
4. Funksjonen signerer (VAPID), krypterer (RFC 8291) og sender.
5. `push_report()` tar imot utfallet: levert, **dødt** (404/410 — abonnementet
   slås av for godt) eller midlertidig (prøves igjen, opptil fem forsøk).

Kryptografien er skrevet for hånd i `push-send/webpush.mjs`, uten npm-pakker:
Huskis har ingen avhengigheter ([`sikkerhetsheadere.md`](sikkerhetsheadere.md)),
og en pushsender som drakk inn et avhengighetstre ville vært det første stedet
den regelen sprakk. Modulen kjører uendret i Deno og i Node, og
`tests/push-crypto.test.js` kjører den mot et fast vektor regnet ut av
`http_ece` — referanseimplementasjonen `web-push` selv bruker.

Et tapt tikk koster forsinkelse, ikke leveranser: all tilstand ligger i
utboksen, og neste tikk tar det samme arbeidet.

### Flere enheter per bruker

- **Web push** fanner ut til ALLE brukerens aktive abonnementer — én
  utbokslinje per abonnement, hver med sitt eget utfall. Et dødt endepunkt slås
  av uten å røre de andre. `get_my_doc()` teller de aktive og gir tallet til
  panelet, så «på» sier hvor mange enheter det gjelder.
- **Android** trenger ingen fan-ut: hver installasjon planlegger sine egne
  lokale varsler fra den samme planen, med de samme deterministiske ID-ene.
- **To enheter varsler begge.** Det er normalt og forventet, som e-post på både
  telefon og laptop.
- **Planen** legges derimot av ÉN enhet av gangen — den som holder tidssonen (se
  «Tidssonen planen tilhører»).

### Levert/ikke levert mot lest/ulest

De to henger sammen på nøyaktig ett punkt, og ellers ikke:

- **Leveringen er per enhet** og lever i utboksen (`push_deliveries.status`)
  eller i Androids alarmkø. **Lest/ulest er per bruker** og lever på
  varselraden (`read_at`), delt mellom alle enhetene.
- **En levert push merker ingenting som lest.** En push kan sveipes bort fra en
  låseskjerm uten at noen har lest noe. Raden blir stående ulest til
  varselmodalen åpnes — det er fortsatt den ene handlingen som markerer lest.
- **Lest/ulest gater aldri en levering**, og trenger ikke gjøre det: en rad kan
  først bli lest etter at den har forfalt, og da er den allerede levert. Det
  finnes ikke et vindu der «lest på laptopen» kunne rukket å avlyse en push som
  ennå ikke er sendt.
- **En push som ikke kommer fram, endrer ingenting.** Raden er der, ulest, og
  in-app-kanalen viser den. De eksterne kanalene er best effort; historikken i
  appen er fasiten for hva som er varslet.
- Det ene punktet de møtes i: **å utsette et varsel merker det lest** (det er en
  kvittering), og den utsatte raden er en ny, planlagt rad — som dermed også
  leveres eksternt når den forfaller.

## Voktere

- `tests/notifications.test.js` — generatoren bakover: tersklene og de eksakte
  grensene, dato uten klokkeslett, markøren, catch-up, preferansene, fullføring,
  arv, identitet, hele veien gjennom serveren, to enheter uten duplikater, og at
  en tømt historikk ikke gjenskapes.
- `tests/notif-plan.test.js` — generatoren framover: horisonten og taket, at
  planen er de samme tersklene med samme nøkkel, at den er usynlig og ikke
  teller som ulest, utboksen for web push, at fullføring og en endret frist
  avlyser den, og tidssone-hevdelsen med begge utfallene.
- `tests/notif-channels.test.js` — kanalene: den deterministiske native ID-en
  (og at et TIDSSONEBYTTE faktisk flytter alarmen — samme varsel, ny absolutt
  tid, gammel alarm avlyst), Android-adapterens diff og upresise alarm, at
  tillatelsen aldri spørres av seg selv, web push-påmeldingen og avmeldingen,
  grensene for hva et abonnement får være (speilet i mock-backenden), blokkert
  tillatelse, panelets fire tilstander, service workerens push- og klikkruting,
  og `?notif=` i adressen.
- `tests/push-crypto.test.js` — VAPID-signaturen og RFC 8291-krypteringen, mot
  et fast vektor fra `http_ece` og med signaturen faktisk verifisert.
- `tests/notif-modal.test.js` — knappen og badgen, modalen, nyeste øverst,
  datooverskriftene og meldingsformene, lest/ulest-grensen, angresletting,
  «Utsett»-popoveren (inkludert den egendefinerte skuffen, at et passert
  tidspunkt avvises, den ARMERTE knappen, panelet som sier når varselet kommer
  og at det kan avbrytes), slett-knappen på raden, varsel-toastene (at
  historikken ikke toaster, tonen og teksten, at den springer ut fra bjellen,
  sveip, trykk til varselet, og at ingen toast kommer oppå et åpent lag),
  preferansepanelet og hodets to tilstander, at et varsel slettes når målet
  eller tiden forsvinner, navigering, tastatur/fokus og i18n.
- `tests/system-back.test.js` — at varselinnstillingene er et NIVÅ inne i
  modalen: tilbakeknappen går til varslene, Escape lukker helt.
- `tests/corner-controls.test.js` — at bjelleknappen ikke rørte
  toppkontrollenes geometri.
- `tests/a11y-contrast.test.js` — at modalen ikke pinner ikonfargene (den
  arver statusflatene fra `.event-icon`), og at varsel-toastenes tekst klarer
  4.5:1 mot den halvgjennomsiktige flaten over BEGGE ytterpunktene.
- `tests/capacitor-android.test.js` — varselpluginen som pinnet
  runtime-avhengighet, at pluginbroen bare leses for de kjente pluginene, og at
  SCHEDULE_EXACT_ALARM er det ENESTE merger-direktivet i manifestet.
- `tests/security-headers.test.js` + `tests/build-version.test.js` — at
  `worker-src 'self'` står likt i begge policyene, og at `sw.js` publiseres.
- `tests/release-pipeline.test.js` — at senderen deployes etter smoke-testen,
  IKKE er en port for frontenden, og at Supabase-CLI-en kjøres på en måte som
  faktisk virker (`npx` med låst versjon — pakken nekter en global install).
- `supabase/tests/test-notifications.sql` — RLS, idempotent logging, markøren,
  preferansene og kontosletting.
- `supabase/tests/test-push.sql` — abonnementene og RLS-en rundt dem, utboksens
  idempotens, kaskaden som avlyser en levering, at et EIERSKIFTE tømmer køen og
  at senderen aldri plukker opp en levering som ikke hører til abonnementets
  eier, grensene for hva et abonnement får være (endepunkt, nøkkelform og taket
  på antall enheter), at senderens funksjoner er stengt for klienten,
  hent/send/meld-runden med alle tre utfallene, og tidssone-hevdelsen.
