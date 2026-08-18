# Automatisk oppdatering av åpne klienter

En fane som har stått åpen i dagevis kjører fortsatt koden fra den deployen den
ble lastet med. Denne mekanikken oppdager at produksjonen har fått en nyere
build, og laster siden på nytt — men **bare når det ikke kan koste brukeren
noe**. Filene: `build.js`, `vercel.json`, `update-check.js`,
`__huskis.updateSafety()` i `app.js`, `.update-banner` i `styles.css`.

## Build-ID (ikke SemVer)

SemVer sier ingenting om hvilken deploy som kjører — to deployer av samme
versjon er forskjellige klienter. Derfor brukes en **unik build-ID per deploy**,
generert ÉN gang i `build.js` og skrevet til to steder med nøyaktig samme verdi:

| Sted | Hvordan |
|---|---|
| Den kjørende klienten | `<meta name="huskis-build" content="…">` i `index.html` |
| Fila klienten spør mot | `/version.json` |

```json
{ "buildId": "dpl_…", "releaseId": "a92b9a9c1d2e", "version": null,
  "builtAt": "2026-07-28T02:51:02.609Z", "commit": "a92b9a9c1d2e…" }
```

`buildId` = Vercels `VERCEL_DEPLOYMENT_ID` når den finnes (unik per deploy, ingen
konfigurasjon), ellers `<commit-sha[0..12]>-<buildtidspunkt i base36>`. I
produksjon er det deploy-ID-en som brukes: builden kjøres HOS Vercel, startet av
release-workflowen (se [`release-og-deploy.md`](release-og-deploy.md)).
Fallbacken gjelder lokale bygg og CI-bygg utenfor Vercel.

`commit` kommer fra `VERCEL_GIT_COMMIT_SHA` eller `GITHUB_SHA`. Workflowen
sender den siste inn med `--build-env`, fordi treet lastes opp fra CLI-en og
Vercel-builden derfor ikke har git-metadata å lese selv.

`version` leses fra `package.json`. Repoet HAR en `package.json`, men den finnes
kun for Capacitor-skallet ([`mobilapp-plan.md`](mobilapp-plan.md)) og har med
vilje ikke noe `version`-felt: SemVer skal ikke måtte økes per PR. `version` er
derfor `null`. Ingen andre miljøvariabler leses, og ingenting hemmelig havner i
fila.

ID-ene sammenlignes som **identitet**, aldri som rangering: en commit-SHA eller
en deploy-ID er ikke «større» eller «mindre» enn en annen.

## Release-ID (identiteten på tvers av plattformer)

`buildId` svarer på «hvilken build kjører denne klienten?». Den kan ikke svare på
«hvilken **release**?», for den er unik per build — og en release bygges flere
ganger: én gang av Vercel for web, én gang av Android-workflowen for APK-en, én
gang til hvis deployen kjøres om igjen. Derfor finnes `releaseId` ved siden av:

| | `buildId` | `releaseId` |
|---|---|---|
| Identifiserer | denne builden/deployen | kilden builden er laget av |
| Verdi | Vercels deploy-ID, ellers `<sha12>-<tid>` | commit-SHA-ens 12 første tegn |
| Web og Android, samme commit | forskjellige | **like** |
| To deployer av samme commit | forskjellige | like |
| Eier cache og reload | **ja** — alt under her | nei, rører ingenting |

Begge genereres ÉN gang i `build.js`, i den samme kjøringen, og skrives til de
samme to stedene: `<meta name="huskis-release">` i klienten og `/version.json`.
En klient kan altså rapportere sin egen release uten å spørre nettet — det er
det som gjør at en Android-app offline kan sammenlignes med `huskis.no`.

`releaseId` navngir commiten builden faktisk er laget AV — den leser nøyaktig
den samme kilden som `commit` (`VERCEL_GIT_COMMIT_SHA` → `GITHUB_SHA` →
`git rev-parse HEAD`). To artifacts har derfor samme `releaseId` bare når de er
bygget av samme commit; en CI-jobb som bygger en syntetisk merge-commit stempler
DEN (se [`mobilapp-plan.md`](mobilapp-plan.md), «Hvilken commit et artifact
faktisk er bygget av»). Den leser **aldri** `VERCEL_DEPLOYMENT_ID`: en deploy-ID
er Vercels infrastruktur, ikke en produktversjon.

`commit` beholder hele SHA-en; `releaseId` er den korte formen som sammenlignes
— også den som identitet, aldri som rangering. En commit-SHA har ingen ordning,
så `releaseId` kan svare på HVILKEN release en klient kjører, men aldri alene på
om den er nyere eller eldre enn en annen. Er SHA-en ukjent (bygg uten git og
uten miljøvariabel), er `releaseId` `null` og meta-taggen står på `dev`: en
ukjent release er ikke en oppdiktet en.

**Ingenting i oppdateringsmekanikken leser `releaseId`.** `update-check.js`
sammenligner `buildId` og bare den, og validerer svaret på `buildId` alene —
ukjente felt overses. Lik build-ID gir fortsatt intet banner, ingen reload, og
`updateSafety()` avgjør fortsatt alene når en reload er trygg. Det er testet fra
begge sider: `tests/build-version.test.js` (de to ID-ene, og at deploy-ID-en
aldri blir release-ID) og `tests/auto-update.test.js` (lik build-ID + en annen
`releaseId` + felt klienten ikke kjenner ⇒ ingen reaksjon).

**`version.json` er additiv.** En telefon kan kjøre en gammel release lenge
(arkitekturregel 7 i [`mobilapp-plan.md`](mobilapp-plan.md)), og den leser denne
fila. Nye felt legges derfor til; eksisterende felt døpes ikke om og fjernes
ikke. En klient som ikke kjenner `releaseId` oppfører seg nøyaktig som før.

Android-skallets `versionCode`/`versionName` er noe annet igjen: de er Google
Plays krav til butikkbinæren, ikke produktversjonen, og de hører til
butikkdistribusjonen (fase 6 i [`mobilapp-plan.md`](mobilapp-plan.md)).
`releaseId` erstatter dem ikke.

## Build og cache-headere

Appen har fortsatt ingen bundler. `build.js` gjør fire ting: kopierer de statiske
filene til `dist/` (uten `tests/`, `docs/`, `supabase/`, `*.md`), fjerner
testmodusen (`dev-mock.js`, `mock-backend.js` og `kun-dev`-blokken i HTML-en —
alt unntatt i preview-deployer, se
[`sikkerhetsheadere.md`](sikkerhetsheadere.md)), skriver `version.json`, og
stempler `index.html` — de to meta-taggene + `?b=<build-ID>` på `app.js`, `icons.js`,
`i18n.js`, `theme.js`, `config.js`, `update-check.js` og `styles.css`.

`SKIP`-listen i `build.js` holder også byggetoolingen ute: `package.json`,
lockfila, `capacitor.config.json` og de native mappene (`android/`, senere
`ios/`) er input til builden, ikke web-assets, og skal aldri serveres fra
huskis.no ([`mobilapp-plan.md`](mobilapp-plan.md)).

`vercel.json` (`buildCommand: node build.js`, `outputDirectory: dist`) setter
sikkerhetsheaderne på alle adresser ([`sikkerhetsheadere.md`](sikkerhetsheadere.md))
og i tillegg:

* `/version.json` → `no-store` (+ `CDN-Cache-Control: no-store`)
* `/` og `/index.html` → `max-age=0, must-revalidate`, så en vanlig
  `location.reload()` alltid henter ny HTML — og dermed nye `?b=`-URL-er.
  (`location.reload(true)` brukes ikke; parameteren er avviklet.)
* JS/CSS → `max-age=31536000, immutable`. Trygt fordi URL-en inneholder
  build-ID-en: nytt innhold ⇒ ny URL.
* `/ota/android/*.json` → `no-store` (+ `CDN-Cache-Control: no-store`), og
  `/ota/bundles/*.zip` → `max-age=31536000, immutable`. Samme to regimer som
  over, av samme grunn: manifestet navngir bundelen som gjelder NÅ, mens ZIP-en
  har build-ID-en i navnet. Hva filene er, og hvem som leser dem, står i
  [`mobilapp-plan.md`](mobilapp-plan.md) (fase 5).

`installCommand` er tom streng, som betyr at Vercel hopper over install-steget:
`node build.js` har ingen avhengigheter, og de eneste pakkene i `package.json`
er Capacitor-toolingen, som produksjonsdeployen verken bruker eller skal ha.

**I lokal utvikling** står begge meta-taggene på `dev`. `update-check.js` starter da
ikke — `python3 -m http.server` og nettlesertestene er urørt. Testene lager sine
egne instanser med injiserte avhengigheter.

Det finnes ingen service worker i appen, og denne funksjonen innfører ingen.

## Når det kontrolleres

`update-check.js` henter `/version.json` fra **samme origin som fanen kjører på**
(rot-relativ URL) — en preview-deploy skal måles mot seg selv, ikke mot
produksjon. Alltid med `cache: 'no-store'` og en cache-bustende parameter.
(Produksjon har ett origin, `https://huskis.no`; de alternative domenene
308-redirecter dit og kjører aldri appen. Autoritativt:
`docs/domains-and-urls.md` — denne mekanismen bruker rot-relative URL-er og
trenger ikke selv navngi domenene.)

* ~1,5 s etter oppstart
* når fanen blir synlig igjen, og ved `focus`
* ved `pageshow` (inkludert retur fra bfcache)
* når nettet kommer tilbake (`online`)
* hvert 10. minutt mens fanen er **synlig** (skjult fane poller ikke)

Samtidige kontroller deles (én forespørsel i lufta om gangen). Offline hoppes
over uten forespørsel. Nettverksfeil, HTTP-feil og ugyldig JSON håndteres helt
stille og prøves igjen ved neste naturlige anledning. Svaret valideres før
sammenligning: objekt, `buildId` som ikke-tom streng ≤ 200 tegn.

En `BroadcastChannel` (`huskis-update`) melder fra til andre faner på samme
origin at en ny build finnes, så de slipper å vente på sitt eget poll. Kanalen er
allerede origin-avgrenset, så domenene forblir uavhengige.

## «Trygt å oppdatere» — den konkrete definisjonen

`__huskis.updateSafety()` i `app.js` returnerer `{ safe, reason }` og er bygget på
tilstandene appen **allerede fører** — ikke på leting etter fokuserte
input-felter i DOM-en. Den er **fail closed**: alt vi ikke kan fastslå er utrygt.

| `reason` | Utrygt fordi |
|---|---|
| `offline` | `navigator.onLine === false` — endringer kan ikke ha nådd serveren |
| `drag` | `drag.active` (dra-og-slipp pågår, i begge scope) |
| `editing` | `isBusyEditing()` — inline navneredigering (`.edit-input`) |
| `modal` | nav-/konto-/søppel-/innstillings-/delings-/plasserings-/bekreftelses-modal eller en velger er åpen |
| `auth-form` | innloggingsskjermen vises og har tekst i et felt |
| `pending-delete` | en sletting ligger i angre-bufferet (`pendingDeletes`/`deleteToast`) — ennå ikke skrevet til databasen |
| `unsaved` | den debouncede localStorage-skrivingen har ikke kjørt ennå |
| `queue` | `opQueue` har en operasjon i lufta eller i kø (deling, lås, mount) |
| `sync-unknown` | innlogget, men ingen `get_my_doc` har lykkes ennå |
| `syncing` | en synk-runde kjører, er planlagt (`cloudDebounce`) eller ba om en ny |
| `unsynced` | `saveSeq !== syncedSeq` — lokale endringer serveren ikke har kvittert for |

`saveSeq` telles opp i `save()`; `syncedSeq` rykker fram til den verdien
`saveSeq` hadde da synk-runden leste staten, og **kun når runden fikk pushet
alt**. En avvist skriving holder altså fanen «utrygt» til den lykkes — heller
vente enn å reloade bort en endring.

## Hva som skjer når en nyere build oppdages

1. **Skjult fane + trygt** → last på nytt med en gang.
2. **Synlig fane** → et diskret, vedvarende, ikke-modalt banner nederst
   (`.update-banner`, samme glassflate som toasten): «En ny versjon av Huskis er
   tilgjengelig.» + knappen «Oppdater nå». `role="status"` + `aria-live="polite"`
   leser meldingen uten å flytte fokus; knappen er en vanlig `<button>` og kan
   fokuseres/aktiveres med tastatur. Banneret er sitt eget element, ikke toasten:
   toasten er forbigående og deles av angre-/feilmeldinger.
3. **Synlig + trygt + minst 60 s uten brukeraktivitet** → last på nytt.
   Tastatur, peker, berøring, scroll, hjul og input nullstiller inaktiviteten.
4. **Ikke trygt** → banneret får en ekstra linje: «Siden oppdateres når endringene
   dine er lagret.» En trygghets-tikk hvert 5. sekund gjennomfører reloaden
   automatisk senere, når tilstanden blir trygg og fanen er skjult eller har
   ligget lenge i ro.
5. «Oppdater nå» laster alltid — brukeren har bedt om det selv.

## Ingen reload-løkker

`sessionStorage['huskis:auto-reload-build']` holder hvilken **mål-build** fanen
allerede har forsøkt en automatisk reload for. Maks ett forsøk per mål-build per
fane: kjører den gamle klienten fortsatt etterpå (cache-glipp, forsinket deploy,
et domene som ligger bak), blir det med banneret — brukeren kan trykke selv.
En NY mål-build får sitt eget ene forsøk.

Forsøket skrives **før** reloaden, og skrivingen leses tilbake. Lar den seg ikke
lagre (privat modus, blokkert eller full `sessionStorage`), kan regelen ikke
garanteres — da gjøres ingen automatisk reload i det hele tatt, og banneret med
«Oppdater nå» er eneste vei videre. Fail closed også her: en fane uten vakt skal
ikke kunne havne i en reload-løkke.

## Avgrensning

Dette er et tillegg til, ikke en erstatning for, synk- og slettesikringen. En
gammel klient kan fortsatt ikke gjenopprette slettede objekter eller overskrive
nyere autoritativ tilstand — det håndheves av gravsteiner, `guard_object_insert`
og felt-LWW på serveren (se `docs/trash.md` og `docs/accounts.md`).

Kjente begrensninger:

* Et delt (montert) objekt påvirker ikke trygghetsvurderingen utover det
  `opQueue`/synken allerede sier.
* Trygghets-tikken er 5 s, så en automatisk reload kan komme inntil 5 s etter at
  tilstanden faktisk ble trygg.
* Poll-intervallet er bundet til at fanen er synlig; en fane som ligger skjult i
  ukevis oppdager først den nye builden når den vises igjen (eller får beskjed
  fra en annen fane).
