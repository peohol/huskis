# Auth-e-postmalene (Supabase Dashboard)

Malene her er **utkast for manuell copy-paste** inn i Supabase Dashboard →
**Authentication → Email Templates**. De ligger i repoet kun for at utseendet
skal være versjonert og likt; ingen tilgjengelig integrasjon kan skrive dem til
Dashboard, så en endring her får ingen effekt før noen limer den inn.

Sendes av **Supabase Auth sin egen mailer** (via SMTP-avsenderen), ikke via
Resend. Resend-e-postene (delingsinvitasjoner) bygges i `send_invite_email()` i
`../users-and-sharing.sql` og har samme utseende.

## Hvilken fil hører til hvilket felt

| Fil | Dashboard-felt | Type |
|---|---|---|
| `confirm-signup.html` | **Confirm signup** | handling — må ha lenke |
| `reset-password.html` | **Reset password** | handling — må ha lenke |
| `change-email-address.html` | **Change email address** | handling — må ha lenke |
| `email-changed-notification.html` | **Email address changed** | varsel — ingen lenke |

De tre første er *authentication emails*: de sendes fordi noen skal gjøre noe,
og **må** inneholde `{{ .ConfirmationURL }}`. Den siste er et
*security notification email*: den sendes etter at endringen er gjennomført,
sendes kun hvis sikkerhetsvarsler er slått på for prosjektet, og har med vilje
verken knapp eller lenke.

**De to siste er lette å bytte om, og konsekvensen er alvorlig.** Havner
varselteksten («adressen din ble endret fra … til …») i *Change email address*,
mister den malen `{{ .ConfirmationURL }}` — og da kan ingen fullføre et
adressebytte i det hele tatt. Brukeren får en e-post som sier at noe skjedde,
uten noe å trykke på, og `auth.updateUser({ email })` i konto-modalen lander
aldri.

## Variablene er ikke felles

Hver mal har sitt eget sett. En variabel som ikke finnes i malen rendres som
**tom tekst** — ingen feilmelding, bare et hull i setningen.

| Variabel | Finnes i |
|---|---|
| `{{ .ConfirmationURL }}` | alle *authentication*-malene |
| `{{ .Email }}` | alle — men betyr **nåværende** adresse i `Change email address`, og **den nye** i `Email address changed` |
| `{{ .NewEmail }}` | KUN `Change email address` |
| `{{ .OldEmail }}` | KUN `Email address changed` |
| `{{ .Token }}`, `{{ .TokenHash }}`, `{{ .SiteURL }}` | alle *authentication*-malene (ikke i bruk her) |

## Lenken skal alltid være `{{ .ConfirmationURL }}`

Aldri en manuelt sammensatt `{{ .SiteURL }}/noe`. `ConfirmationURL` bærer
allerede returadressen klienten sendte (`authRedirectUrl()` i `app.js`, satt av
`emailRedirectTo`/`redirectTo`); bygger man lenken selv, overstyres det
tiltenkte målet. Se `../../docs/domains-and-urls.md`.

## Språk: malene er TOSPRÅKLIGE

Supabase Auth har ÉN mal per felt for hele prosjektet. Den kan ikke velges per
mottaker: malen rendres av Supabase sin egen mailer, som verken kjenner
`user_metadata.lang` eller noe annet om mottakeren utover variablene i tabellen
over. Det finnes altså ingen måte å sende «samme e-post, på mottakerens språk»
herfra.

Derfor står **både norsk og engelsk i samme e-post**: norsk seksjon først, en
tynn skillelinje, så den engelske — og en bunntekst med begge språkene. På
handlings-e-postene har hver seksjon sin egen knapp, men BEGGE peker på den
samme `{{ .ConfirmationURL }}`; det er én handling, presentert to ganger.

Delingsinvitasjonene er noe annet: de bygges av `send_invite_email()` i
`../users-and-sharing.sql`, som leser mottakerens `user_metadata.lang` og
skriver HELE e-posten på ett språk. Se `../../docs/sprak.md`.

Legger du til en tekst i en av malene her, legg den til på BEGGE språk — en
seksjon som bare finnes på norsk gir en engelsk leser et hull i meldingen.

## Utseendet

Alle fire deler samme oppbygning, og en ny mal skal kopiere den:

- ytre flate `#667788`, hvitt kort med `border-radius: 18px`
- toppbånd med logo (`https://huskis.no/assets/email/huskis-logo.png`) + ordmerket
- grønn etikett i versaler, `<h1>`, brødtekst
- grønn knapp `#4d664d` (kun på handlings-e-poster), med fallback-lenke under
- bunntekst over en `#e3e7e3`-skillelinje

Tabell-layout og inline-stiler med vilje: e-postklienter (særlig Outlook)
støtter ikke moderne CSS. `bgcolor`-attributtet står ved siden av
`background-color` av samme grunn.

## Endrer du en mal

Lim den inn i Dashboard i samme runde — ellers står repoet og produksjonen i
utakt, og neste person tror utseendet er live når det ikke er det. Send en
testmelding fra flyten malen hører til (registrering, «glemt passord»,
e-postendring) og kontroller at lenken lander på `https://huskis.no` med gyldig
sesjon.
