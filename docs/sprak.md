# Språk — norsk og engelsk

Autoritativt for språkvalget: hvor det lagres, hvem som vinner, hvordan en tekst
kommer inn i UI-et, og hvordan e-postene følger etter.

Huskis finnes på **norsk (`no`)** og **engelsk (`en`)**. Brukeren velger selv, og
valget gjelder både grensesnittet og e-postene appen sender.

## Hvor valget bor

| Sted | Hva det er | Hvem leser det |
|---|---|---|
| `localStorage['huskis-lang']` | **enhetens** språk | `i18n.js` ved oppstart — det eneste som finnes før innlogging |
| `user_metadata.lang` | **kontoens** språk | klienten ved innlogging, og `send_invite_email()` i databasen |

Enheten er den som avgjør hva appen starter på, fordi den kan leses uten et
nettverkskall. Kontoen er den som følger deg til en ny enhet — og den eneste
serveren kan se.

**Kontoen vinner ved innlogging.** `adoptAccountLanguage()` (app.js) kjører først
i `cloudStart()`: står kontoen på et annet språk enn enheten, skrives kontoens
verdi til enheten og appen lastes på nytt.

Har kontoen ikke noe språk ennå — en konto fra før språkvalget fantes, eller en
fersk registrering — løftes enhetens valg opp på kontoen, men **bare hvis
brukeren faktisk har tatt det** (`I18N.chosen()`, typisk på innloggingsskjermen
rett før). Står enheten bare på standarden, skrives ingenting: de to er enige
uansett, og en skriving ved hver eneste innlogging ville vært ren støy mot Auth.

**Standarden er norsk**, ikke nettleserens språk. Appen har vært norsk for alle
som allerede bruker den, og et automatisk bytte ville endret språket under
føttene på dem uten at de ba om det.

## Hvor brukeren velger

To steder, samme kontroll (`<select class="lang-select">`, fylt av
`paintLanguage()`):

- **innloggingsskjermen**, nederst — det eneste stedet valget kan tas før man
  har en konto, og det første en ny bruker ser;
- **konto-modalen**, som en `.menu-setting`-rad over e-postvarselet.

Språknavnene står på sitt eget språk («Norsk», «English»): det er slik man
finner sitt eget i en liste man ellers ikke kan lese.

**Et bytte laster appen på nytt** (`setLanguage()`). Språket sitter i hver eneste
tekst som allerede er bygget — korttitler, menyer, demoens steg, og tekst som ble
fanget i konstanter ved oppstart — og en omlasting er den eneste garantien for at
ingenting blir stående igjen på det gamle språket. Kontoen skrives FØR
omlastingen; feiler den skrivingen, husker enheten valget likevel, og det er bare
de andre enhetene (og e-postene) som blir stående på det gamle.

## Ordboken

`i18n.js` er ordboken og kjøretiden. Den lastes før `app.js`, har ingen
avhengigheter, og rører ingen tilstand utenom `<html lang>` og enhetens verdi.

Én nøkkel per tekst, med begge språkene på samme linje:

```js
'trash.purge': ['Slett for godt', 'Delete for good'],
```

Rekkefølgen er `[no, en]` — den samme som `LANGS`.

**Tekst med innsatte verdier bruker `{felt}`, aldri strengaddisjon.**
Ordstillingen er ikke den samme på de to språkene, så bitene MÅ kunne bytte plass
inne i oversettelsen:

```js
tr('a11y.movedUp', { name: quoted(navn), pos: 3, total: 7 })
// no: «{name} flyttet opp til plass {pos} av {total}.»
// en: «{name} moved up to position {pos} of {total}.»
```

Entall og flertall er egne nøkler (`count.item.one` / `count.item.other`) —
formen lar seg ikke regne ut på tvers av språk. Månedsnavn og datoformat ligger
også i ordboken (`date.monthsShort`, `date.dayMonth`): «12. mai» mot «12 May».

### Slik kommer en tekst inn i UI-et

- **`index.html`**: attributtene `data-i18n` (textContent), `data-i18n-html`,
  `data-i18n-title`, `data-i18n-aria-label` og `data-i18n-placeholder`. Den
  norske teksten står igjen i markupen som lesbar standard, men det er
  `applyStatic(document)` ved oppstart som setter den faktiske verdien.
- **Malene (`<template>`)** ligger i et eget fragment `applyStatic(document)`
  ikke går inn i. `fromTemplate()` i app.js oversetter derfor hver klon.
- **`app.js`**: `tr(nøkkel, felt)`. En norsk streng skrevet rett inn i koden
  finnes ikke på engelsk, og `tests/i18n.test.js` stopper den.
- **`update-check.js`** lastes etter app.js og slår opp via en liten `txt()`
  med den norske teksten som fallback — banneret skal virke selv om ordboken
  skulle mangle.

Konsollmeldinger og `new Error(...)` oversettes IKKE: de leses av den som
feilsøker, aldri av brukeren.

## E-postene

**Delingsinvitasjonene** (`send_invite_email()` i
`supabase/users-and-sharing.sql`) skrives på ÉN mottakers språk:

- registrert mottaker → mottakerens `user_metadata.lang`;
- uregistrert mottaker → **inviterens** språk, som er den beste gjetningen vi
  har om noen som ennå ikke har en konto;
- ukjent eller manglende verdi → norsk.

Språket styrer emnet, overskriften, brødteksten, knappen, bunnteksten,
forhåndsvisningsteksten og `<html lang>` — både i HTML- og text/plain-varianten.

**Auth-e-postene** (registrering, glemt passord, e-postendring, varsel om endret
adresse) rendres av Supabase Auth sin egen mailer, som har ÉN mal per felt for
hele prosjektet og ikke kan velge den per mottaker. De er derfor **tospråklige**:
norsk seksjon, skillelinje, engelsk seksjon. Se
`supabase/email-templates/README.md`.

## Tekst som kommer fra serveren

Det meste serveren sender er DATA (navn, e-post, roller), som ikke skal
oversettes. To ting er tekst:

- **`get_members.removeHint`** — hvorfor et medlem ikke kan fjernes her. Den
  sendes både som norsk tekst (`removeHint`, for eldre klienter) og som en
  språknøytral kode (`removeHintCode`: `inherited` | `lastOwner`), og klienten
  oversetter koden selv. Nye tekster fra serveren skal følge samme mønster:
  send en kode, ikke en setning.
- **`raise exception`-meldingene** i `users-and-sharing.sql` er fortsatt norske,
  og vises rått av `friendlyAuthError()` når ingen av mønstrene der treffer.
  Det er vakter mot noe klientens egen gating allerede har stengt for (den
  feiler LUKKET), så en bruker skal i praksis aldri se dem — men på engelsk er
  de en kjent skarp kant. Å rette det er en egen runde: hver melding må få en
  kode, og klienten en oversettelse per kode.

## Å legge til en tekst

1. Legg nøkkelen i `i18n.js` med begge språkene.
2. Bruk den — `tr(...)` i app.js, `data-i18n*` i index.html.
3. `node tests/i18n.test.js` sjekker at raden er komplett, at `{felt}`-ene er de
   samme i begge språkene, at nøkkelen finnes der den slås opp, at ingen nøkkel
   blir liggende ubrukt, og at ingen norsk tekst er skrevet rett inn i koden.

## Å legge til et språk

`LANGS` i `i18n.js` er listen, og indeksen i den er indeksen i hver ordboksrad.
Et nytt språk betyr derfor en ny verdi i HVER rad — testen feiler til alle er
på plass. I tillegg må `send_invite_email()` kjenne koden (den godtar i dag
`'no'` og `'en'`, og faller til norsk ellers), og auth-malene få en seksjon til.
