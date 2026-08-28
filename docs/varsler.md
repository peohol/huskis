# Varsler

Les denne når oppgaven berører bjelleknappen, varselmodalen, hva som blir et
varsel, eller hvordan varselhistorikken lagres og synkes.

Tre ting bor her, og de er bevisst skilt:

1. **Generatoren** — `collectNotifications(state, now, prefs, cursor)` i
   `app.js`: en ren funksjon som leser TERSKLER ut av hendelsene
   [`kommende-hendelser.md`](kommende-hendelser.md) allerede regner ut. Den har
   ingen egne regler om hva som er aktivt, hva som er arvet eller hva som
   dedupliseres.
2. **Lagringen** — to per-bruker-tabeller i Supabase (`notifications`,
   `notification_prefs`). Varsler er ikke innhold: de deles aldri, de flettes
   ikke, og de ligger utenfor synk-doc-et.
3. **Flaten** — bjelleknappen med ulest-badgen og modalen `#notif-modal`.

Tidsverdiene og semantikken for dato uten klokkeslett er beskrevet i
[`scheduling.md`](scheduling.md), som er autoritativ for dem.

Dette dokumentet dekker **in-app**-varslene. Native Android-varsler og Web Push
kommer som egne leveringskanaler oppå den samme hendelsesmodellen — se
«Forholdet til de eksterne kanalene» nederst.

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
collectNotifications(state, now, prefs, cursor)   // → rader som skal logges
```

Ren funksjon: tilstand, tidspunkt, preferanser og markør inn — radene ut. Ingen
DOM, ingen nettverk, ingen klokkeoppslag. Den kaller `collectUpcomingEvents()`
og leser to terskler ut av hver hendelse (tidspunktet selv, og uka før det).

Alt annet er hendelsesmotorens svar, ikke et nytt regelsett:

- hva som er **aktivt/ufullført** (tom liste, alt avkrysset, papirkurven);
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

Én runde logger maksimalt `NOTIF_BATCH_MAX` (50) rader, og beholder de nyeste
tersklene: en historikk som åpner med tre hundre rader er ikke en historikk.

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
alle fire.** En badge er ingen avbrytelse, og en funksjon som er av fra første
stund blir aldri sett; eksterne kanaler får sin egen opt-in på toppen av dette.

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
| `notification_prefs` | én rad per bruker: de fire bryterne + `cursor_at` |

- **RLS: kun egne rader**, hele veien (select/update/delete). Andres varsler kan
  ikke leses, merkes eller slettes — heller ikke for et objekt vi deler.
- **Klienten kan ikke sette inn rader.** Det gjøres av `notify_record()`
  (security definer), som setter `user_id` fra `auth.uid()` selv. Update er
  kolonne-avgrenset til `read_at`: lest/ulest er det eneste klienten eier på en
  eksisterende rad. Preferansene skrives kun av `notify_set_prefs()`.
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
slettet med det.

Går serveroperasjonen i vasken, later appen **ikke** som noe annet: radene er
fortsatt på serveren, de vises igjen straks, og en toast sier fra.

## «Utsett»

Hver rad har en liten klokke ved siden av seg som folder ut tre valg: **om 1
time, om 6 timer, om 1 døgn**. Valget logger det samme varselet på nytt med et
tidspunkt i framtiden (`snoozed`), og nøkkelen får utsettelsestidspunktet med
seg, så identiteten ikke kolliderer med det opprinnelige.

Et varsel med `at` i framtiden er **usynlig og teller ikke som ulest** før det
forfaller. Modalen og badgen sover fram til det første slike tidspunktet
(`scheduleNotifWake`), med samme tak og samme `visibilitychange` som
hendelsesmodalen.

Å utsette er samtidig en kvittering: det opprinnelige varselet merkes lest.
Markøren røres ikke — ingen terskler er vurdert.

## Modalen (`#notif-modal`)

Vanlig `.modal-overlay`-skall (fokusfelle, Escape via `closeTopLayer`,
`body.modal-open`, fokus tilbake til bjellen ved lukking), med:

- **nyeste øverst**, sortert på hendelsens tidspunkt (`at`) — det er det samme
  på alle enheter — med id-en som tie-breaker, så rekkefølgen aldri hopper;
- raden: `[statusikon] navn`, en dempet linje med meldingen og kontekststien, og
  et diskret dato + klokkeslett i enden;
- en tomtilstand når historikken er tom;
- «Tøm varsler» i foten;
- tannhjulet i hodet, som vender panelet til de fire preferansene.

Trykk på en rad lukker modalen og kaller `navigateToObject({ type, id })`
([`sok-og-navigering.md`](sok-og-navigering.md)).

Bjelleknappen står **først** i toppkontrollgruppen, til venstre for kalenderen
([`menus.md`](menus.md), «Toppkontrollene»).

## Fullførte, slettede, flyttede og omplanlagte objekter

| Hva som skjer | Følgen |
|---|---|
| listepunktet fullføres FØR terskelen | ingen hendelse, altså heller ikke noe varsel |
| det fullføres ETTER at varselet finnes | historikken beholdes urørt |
| objektet slettes eller tilgangen forsvinner | raden står, men fører ingen steder: den er merket i teksten sin, klikk gir en beskjed i stedet for en navigering, og modalen blir stående |
| objektet flyttes | historikken følger objekt-ID-en, ikke stien — `navigateToObject` slår opp hvor det ligger NÅ |
| start/frist endres | den gamle tidsplanens terskler er brukt opp (nøkkelen bar den gamle verdien); den nye planen varsler for seg |

Et mål som er borte oppdages med et rent lokalt oppslag i `state`. En id vi ikke
har tilgang til finnes ikke der, så en rad kan verken navigere til eller røpe noe
om et objekt vi ikke ser.

## Tilgjengelighet

- Dialogsemantikk på modalen; fokus flyttes inn ved åpning og tilbake til
  bjellen ved lukking (unntatt når en rad ble åpnet — da eier navigeringen
  fokuset).
- Radene er vanlige knapper, så Tab og Enter virker uten særbehandling. Hver rad
  har et `aria-label` med lest/ulest, varseltypen i KLARTEKST, navnet, meldingen,
  tidspunktet og stien — eller beskjeden om at objektet er borte.
- Antallet og hvor mange som er uleste leses opp fra et visuelt skjult
  `role="status"` ved åpning.
- Farge er aldri eneste bærer: typen står i meldingen, ulest bæres av både en
  kant og en prikk, og et utilgjengelig mål sier det i teksten.
- Badgen er `aria-hidden`; antallet ligger i knappens navn.

Kravene er de samme som ellers — se
[`tilgjengelighet.md`](tilgjengelighet.md).

## Språk

Alle tekstene ligger i ordboken under `notif.*`. Se [`sprak.md`](sprak.md).

## Forholdet til de eksterne kanalene

De fire preferansene styrer HENDELSEN, ikke visningen. Når native
Android-varsler og Web Push kommer, blir de to nye **leveringskanaler** for
nøyaktig de hendelsene som allerede genereres her — med sin egen opt-in
(operativsystemets tillatelse) på toppen. Ingen ny hendelsesmodell, ingen ny
terskeltolkning, og in-app-historikken er fortsatt fasiten for hva som er
varslet.

## Voktere

- `tests/notifications.test.js` — generatoren: tersklene og de eksakte grensene,
  dato uten klokkeslett, markøren, catch-up, preferansene, fullføring, arv,
  identitet, hele veien gjennom serveren, to enheter uten duplikater, og at en
  tømt historikk ikke gjenskapes.
- `tests/notif-modal.test.js` — knappen og badgen, modalen, nyeste øverst,
  lest/ulest-grensen, angresletting, «Utsett», preferansepanelet, navigering,
  slettet mål, tastatur/fokus og i18n.
- `tests/corner-controls.test.js` — at bjelleknappen ikke rørte
  toppkontrollenes geometri.
- `tests/a11y-contrast.test.js` — at modalen ikke pinner ikonfargene (den
  arver statusflatene fra `.event-icon`).
- `supabase/tests/test-notifications.sql` — RLS, idempotent logging, markøren,
  preferansene og kontosletting.
