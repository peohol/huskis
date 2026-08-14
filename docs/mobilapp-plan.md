# Mobilapper — plan og fremdrift

Dette er den levende arbeidsplanen for å gjøre Huskis til en ordentlig Android-
og iOS-app **uten å splitte produktet i tre frontender**. Webappen forblir
kilden til UI og forretningslogikk; native-prosjektene skal være tynne skall
rundt den samme produksjonsbuilden.

Dokumentet er autoritativt for **rekkefølgen, nåværende fase og hva som gjenstår**
i mobilprosjektet. Ferdig funksjonalitet dokumenteres fortsatt i det ordinære
autoritative dokumentet for fagfeltet.

## Status

| Felt | Nå |
|---|---|
| Målarkitektur | Én HTML/CSS/JS-kodebase + Capacitor for Android/iOS |
| Nåværende fase | **Fase 3 — nødvendige native integrasjoner** |
| Status | Fase 3 er i gang. Systemets tilbakeknapp OG safe areas/systemfeltene/skjermtastaturet er ferdige, automatisk dekket (`tests/safe-area.test.js`, `tests/landscape-chrome.test.js`, `tests/capacitor-android.test.js`) og verifisert på fysisk telefon. De fire øvrige fase 3-punktene er ikke påbegynt, så ferdigkriteriet er ikke nådd. |
| Neste milepæl | Android-appen oppfører seg som en normal mobilapp i de plattformtilfellene browseren ikke håndterer godt nok selv |
| Ett neste praktiske steg | Definer hvilke eksterne lenker som åpnes i systembrowser og hvilke som forblir i appen |
| OTA | Ikke innført; skal ikke innføres før Android-baselinen er stabil |
| iOS | Senere fase; ikke en del av første implementering |

### Slik holdes planen levende

Hver PR som flytter mobilprosjektet fremover skal oppdatere denne filen i samme
endring:

- oppdater **nåværende fase**, **status** og **neste milepæl** øverst;
- kryss bare av punkter som faktisk er implementert og verifisert;
- la ett konkret neste steg være tydelig;
- endrer vi strategi, oppdater planen før eller samtidig med implementeringen;
- ikke før kronologisk endringslogg her — git og PR-ene er historikken.

En fase er ikke ferdig fordi koden finnes. **Ferdigkriteriene må være
verifisert.**

## Målarkitektur

```text
                        Huskis-kildekode
                     HTML + CSS + JavaScript
                              │
                        node build.js
                              │
                            dist/
                              │
                 ┌────────────┴────────────┐
                 │                         │
              Vercel                  Capacitor
                 │                  ┌──────┴──────┐
             huskis.no           Android        iOS
```

`dist/` forblir den kanoniske web-builden. Capacitor skal kopiere denne inn i
de native prosjektene; mobilappen skal ikke ha sin egen kopi av Huskis-logikken.

## Faste arkitekturregler

1. **Ingen omskriving.** Vanilla HTML/CSS/JS er fortsatt produktkoden. React,
   Flutter eller et annet frontendrammeverk innføres ikke som del av
   mobilprosjektet.
2. **Web er førsteklasses.** Native tilpasninger må ikke gjøre browserutgaven
   avhengig av Capacitor eller native API-er. Plattformspesifikk kode gates
   eksplisitt.
3. **`dist/` er inngangen til native.** `node build.js` skal fortsatt være den
   eneste produksjonsbuilden av webkoden. `dist/` sjekkes ikke inn.
4. **Native skall er kildekode.** `android/` og senere `ios/` sjekkes inn når de
   opprettes, fordi native konfigurasjon skal kunne reviewes og reproduseres.
5. **Ingen ekstern `server.url` i produksjon.** Mobilappen skal pakke lokale
   web-assets; den skal ikke bare være en WebView som peker på `huskis.no`.
6. **Ingen OTA før funksjonell paritet.** Først får vi en stabil innebygd
   Android-versjon. OTA introduseres som et eget lag senere.
7. **Gamle klienter skal tåles.** Databaseendringer forblir additive og
   bakoverkompatible. En telefon kan være offline eller kjøre en eldre release
   lenge etter at webappen er oppdatert.
8. **Oppdateringssikkerheten bevares.** Dagens `updateSafety()` og
   synk-/sletteinvarianter skal gjenbrukes, ikke omgås, når mobiloppdateringer
   innføres.
9. **Tooling skal ikke deployes som web-assets.** `package.json`, lockfil,
   Capacitor-konfigurasjon og native mapper skal eksplisitt holdes utenfor
   `dist/` av `build.js`.
10. **Avhengigheter pinnes.** Native/runtime-versjoner skal være eksplisitte og
    reproduserbare; ingen `@latest` i CI eller produksjonsflyt.

## Beslutninger som allerede er tatt

- **Capacitor** er native runtime.
- **Android først**, iOS etter at Android-baselinen er bevist.
- Første native mål er en **debugbuild på fysisk Android-telefon**, ikke Google
  Play.
- OTA-leverandør velges **senere**, etter at krav til signering, rollback,
  kanaler, staged rollout og butikkpolicy er vurdert.
- PWA er valgfritt og ligger utenfor denne planen inntil det finnes et konkret
  behov.
- Planlagt app-/bundle-ID er **`no.huskis.app`**. Den skal behandles som en
  langsiktig identitet og bekreftes senest før første butikkopplasting.

### Teknisk baseline

| Ledd | Valgt | Hvorfor |
|---|---|---|
| Capacitor | **8.5.0**, pinnet eksakt for `@capacitor/core`, `@capacitor/cli` og `@capacitor/android` | siste stabile major; krever Node 22+, som Huskis-CI allerede bruker |
| Node | 22 | samme pin som `ci.yml` |
| JDK | 21 | `@capacitor/android` kompilerer med `sourceCompatibility`/`targetCompatibility` 21 |
| Android SDK | `minSdkVersion 24`, `compileSdkVersion`/`targetSdkVersion` 36 | Capacitor 8s egne standardverdier (`android/variables.gradle`) |
| Android Gradle Plugin / Gradle | 8.13.0 / 8.14.3 | følger med Capacitor-malen |

Oppgraderinger gjøres senere som egne, bevisste endringer — ikke som en
sidevirkning av en annen PR.

`package.json` er innført for Capacitor og har **ikke** noe `version`-felt, slik
at `version.json.version` fortsatt er `null` og build-ID-en forblir den eneste
release-identiteten ([`auto-update.md`](auto-update.md)). Den er `private`, har
ingen bundler eller frontendrammeverk, og `package-lock.json` er sjekket inn.
Vercel hopper over install-steget (`installCommand: ""` i `vercel.json`):
`node build.js` har ingen avhengigheter, så produksjonsdeployen skal ikke
installere Android-toolingen.

---

# Fase 0 — plan og rammer

**Mål:** gjøre mobilprosjektet synlig og styrbart før kodeendringer starter.

- [x] Velg grunnarkitektur: eksisterende webapp + Capacitor.
- [x] Velg Android som første plattform.
- [x] Skill mellom native butikkoppdateringer og senere OTA av web-assets.
- [x] Opprett denne levende planen.
- [x] Legg planen inn i `docs/README.md`.

**Ferdigkriterium:** repoet har én eksplisitt plan som senere PR-er oppdaterer.

---

# Fase 1 — mobilfundament og første Android-debugbuild

**Mål:** samme `dist/` som Vercel bruker skal kunne bygges inn i en installérbar
Android-app, uten OTA og uten å endre funksjonaliteten i webappen.

## Implementasjon

- [x] Opprett en minimal `package.json` og lockfil uten å innføre bundler eller
      frontendrammeverk.
- [x] Installer og pin `@capacitor/core`, `@capacitor/cli` og Android-plattformen
      i kompatible versjoner.
- [x] Opprett Capacitor-konfigurasjon med `appName = Huskis`, planlagt
      `appId = no.huskis.app` og `webDir = dist`.
- [x] Generer og sjekk inn `android/`.
- [x] Legg til små npm-skript for den repeterbare kjeden
      `node build.js` → Capacitor sync/copy → Android-build.
- [x] Oppdater `.gitignore` for `node_modules` og genererte native build-output,
      men **ikke** ignorer native prosjektfiler som skal være kildekode.
- [x] Oppdater `build.js` slik at npm-/Capacitor-/native tooling aldri kopieres
      inn i `dist/`.
- [x] Legg til regresjonssjekk som beviser at `dist/` fortsatt bare inneholder
      web-produksjonsartefakter, og at Capacitor peker på `dist/` uten
      produksjons-`server.url`.
- [x] Lag en enkel GitHub Actions-vei som kan produsere en Android debug-APK som
      artifact, slik at fysisk testing ikke avhenger av lokal Android Studio.
- [x] Ikke innfør iOS, OTA, pushvarsler, biometrikk eller annen native
      funksjonalitet i denne fasen.

### Slik henger delene sammen

```text
node build.js  →  dist/  ──►  Vercel (huskis.no)
                        └──►  npx cap sync android
                                 → android/app/src/main/assets/public/
                                 → ./gradlew assembleDebug
                                 → android/app/build/outputs/apk/debug/app-debug.apk
```

| Fil | Rolle |
|---|---|
| `package.json` / `package-lock.json` | npm-manifest for Capacitor-toolingen. Ikke en del av webappen. |
| `capacitor.config.json` | `appId`, `appName`, `webDir = dist`. Ingen `server`-blokk — appen kjører lokale web-assets. |
| `android/` | Det native skallet, sjekket inn som kildekode. Capacitors egen `android/.gitignore` holder Gradle-output, `local.properties`, den kopierte `dist/`-en og de genererte konfigurasjonsfilene ute; `npm run sync:android` gjenskaper alt det. |
| `.github/workflows/android-debug.yml` | Bygger debug-APK-en og laster den opp som artifact `huskis-debug-apk`. Manuell trigger + `pull_request` avgrenset med `paths`, så vanlige Huskis-PR-er ikke betaler for en Gradle-runde. |
| `tests/capacitor-android.test.js` | Vokter invariantene over. |
| `tests/build-version.test.js` | Vokter at toolingen ikke havner i `dist/`, og at `version.json` beholder `version: null`. |

## Verifisering

- [x] `node build.js` er grønn.
- [x] `node tests/build-version.test.js` er grønn.
- [x] Relevante release-/buildtester er grønne etter at `build.js` er endret
      (`release-pipeline`, `db-contract`, `security-headers`, `no-legacy-domain`,
      `i18n`, `shard-distribution`, `capacitor-android`).
- [x] Capacitor kan synkronisere `dist/` inn i Android-prosjektet.
- [x] Gradle kan produsere en debug-APK fra rent checkout.
- [x] APK-en kan installeres på fysisk Android-enhet.
- [x] Appen starter og viser Huskis uten å hente selve UI-et fra `huskis.no`.
- [x] Innlogging mot ekte Supabase fungerer.

Gradle-steget verifiseres i CI, ikke lokalt: `android-debug.yml` bygger fra et
rent checkout og er derfor den autoritative byggtesten. Et utviklingsmiljø uten
Android SDK kan ikke kjøre `./gradlew assembleDebug` — det er forventet og
blokkerer ingenting.

### Slik får du en debug-APK på telefonen

Samme oppskrift gjelder hver gang mobilen skal testes — også for testmatrisen i
fase 2.

1. Actions → **«Android debug-APK»** → «Run workflow» (eller bruk kjøringen
   workflowen selv startet på en PR som rører mobilfundamentet).
2. Last ned artifactet **`huskis-debug-apk`** og pakk ut `app-debug.apk`.
3. Overfør APK-en til telefonen og installer den. Android spør om lov til å
   installere fra ukjent kilde første gang — debug-APK-en er signert med
   Androids standard debug-nøkkel, ikke en butikknøkkel.
4. Appen viser Huskis fra sine egne innebygde filer. Flymodus + omstart
   bekrefter at UI-et ikke hentes fra `huskis.no` (innlogging krever selvsagt
   nett).

Lokalt gjør `npm run android:debug` det samme, men krever Android SDK.

**Ferdigkriterium:** en fysisk Android-telefon kan kjøre en installert Huskis-
debugbuild fra repoets vanlige web-build, mens browserversjonen fortsatt bygger
og deployes som før. **Oppfylt.**

---

# Fase 2 — funksjonell paritet på Android

**Mål:** bevise at WebView/runtime-laget ikke bryter Huskis' eksisterende
interaksjons- eller datasikkerhetsinvarianter.

## Hvor WebView-laget faktisk skiller seg

Appen kjører NØYAKTIG den samme koden som `huskis.no`, fra sine egne innebygde
filer. Den eneste tekniske forskjellen som betyr noe for klientlogikken er
**originet**: Capacitor serverer filene fra `https://localhost` i stedet for
`https://huskis.no`. Alt som forgrener på origin må derfor tåle den formen:

| Sted | Regel i appen |
|---|---|
| Guarden i `index.html` | rører kun de tre navngitte hostene → appen navigerer aldri seg selv ut på nett |
| `authRedirectUrl()` (`app.js`) | `https://localhost` er IKKE lokal utvikling → auth-lenker peker kanonisk ([`domains-and-urls.md`](domains-and-urls.md)) |
| `update-check.js` | rot-relativ `/version.json` → leser sin egen innebygde fil, ser sin egen build-ID |
| CSP (`index.html`) | `'self'` = det innebygde originet; Supabase er navngitt eksplisitt ([`sikkerhetsheadere.md`](sikkerhetsheadere.md)) |

Alle fire er voktet av tester (tabellen under). Ut over dette kjenner webkoden
native-runtimen på nøyaktig ÉN linje: gaten som setter opp broen for systemets
tilbakeknapp (fase 3). `tests/capacitor-android.test.js` holder det unntaket
avgrenset — én linje, gjennom `window.Capacitor.isNativePlatform()` — og feiler
hvis en Capacitor-referanse sniker seg inn noe annet sted i web-kildefilene.

Én ting til skiller runtimene, og den eier vi ikke: Capacitor limer sin egen
bro inn som et INLINE `<script>` rett etter `<head>` (`JSInjector`), altså foran
både innholdssikkerhetspolicyen og tegnsett-erklæringen i `index.html`. Broen
kjører derfor før policyen er lest og blir ikke blokkert av den; til gjengjeld
havner `<meta charset>` utenfor de første 1024 bytene, og dekodingen hviler på
WebView-ens standard (UTF-8). Praktisk konsekvens: at norsk tekst vises riktig i
appen er en observasjon, ikke noe repoet kan garantere — derfor står det i den
fysiske runden.

## Automatisk dekning

Testene kjører den samme koden APK-en pakker, og avgjør derfor **logikken** i
punktene under uavhengig av runtime. De erstatter ikke den fysiske testen; de
gjør at den kan konsentrere seg om det bare en telefon kan svare på.

| Område | Dekkes automatisk av |
|---|---|
| auth-flyten, returadresser, sesjon | `auth-redirect`, `nav-modal`, `account-password-avatar`, `delete-account` |
| språk og kontoinnstillinger | `language`, `i18n`, `account-menu-accordion`, `account-password-avatar` |
| opprette/endre navn/flytte/omorganisere alle nivåer | `item-creation`, `nav-modal`, `group-move`, `object-menu`, `locked-group-creation` |
| dra-og-slipp og trykk-og-hold, begge scope | `dnd-*` (11 filer, mobil-viewport med `hasTouch`) |
| sletting, angre, gjenoppretting, tømming | `trash-modal-layout`, `dnd-trash`, `restore-all-done` |
| synk- og sletteinvarianter (ingen gjenoppståtte/tapte objekter) | `sync-resurrection`, `sync-shared-resurrection`, `sync-dangling-category`, `sync-schema-error` |
| delt innhold, roller, invitasjoner | `roles-and-sections`, `locked-group-creation`, `sync-shared-resurrection` |
| offline → online, og statusen brukeren ser | `sync-status` |
| modaler, popovere, fokus, smale viewporter | `a11y-runtime`, `board-columns`, `trash-modal-layout`, `collapsed-alignment`, `dnd-viewport-clamp` |
| kontrast og berøringsflater (målt i px) | `a11y-contrast`, `a11y-runtime` |
| ingen reload mens tilstanden er utrygg (`updateSafety()`) | `auto-update` (del A og B) |
| lik build-ID ⇒ ingen banner, ingen reload | `auto-update`, `build-version` |
| appen peker ikke mot og reloader ikke `huskis.no` | `capacitor-android`, `canonical-origin`, `auth-redirect` |

## Testet på fysisk Android

Kjørt på telefon med en browserklient innlogget på samme konto samtidig,
etter sekvensen under:

- [x] registrering/innlogging/utlogging;
- [x] språk og kontoinnstillinger;
- [x] opprette, endre navn, flytte og omorganisere alle objektnivåer;
- [x] drag-and-drop og touch-hold på de to DnD-scope-ene;
- [x] sletting, angre, gjenoppretting og permanent tømming;
- [x] synk mellom mobil og browser uten gjenoppståtte eller tapte objekter;
- [x] delt innhold, roller og invitasjoner;
- [x] offline → online;
- [x] bakgrunn → forgrunn;
- [x] tvungen avslutning → ny oppstart;
- [x] tastatur, fokus, modaler, popovere og smale viewporter;
- [x] tilgjengelighet og berøringsflater;
- [x] ingen uventet reload mens lokal/synkende tilstand er utrygg;
- [x] auto-oppdateringsmekanikken oppfører seg forsvarlig i native runtime:
      `/version.json` er rot-relativ, så i appen leser `update-check.js` den
      INNEBYGDE fila og ser alltid sin egen build-ID. Den viser altså verken
      oppdateringsbanner eller reloader. Å faktisk kunne oppdatere
      web-assetene er fase 5.

**Ingen feil med datatap, synkfeil eller blokkert kjernefunksjon.**

Auth-returadressen fra WebView-originet ble funnet i gjennomgangen før runden,
ikke av runden. Trinn 1 bekreftet at bekreftelseslenken peker kanonisk, men det
trinnet kan ikke alene skille en fikset klient fra en ufikset: sender klienten
en returadresse som ikke står i Supabase' tillatelsesliste, faller den tilbake
til Site URL, og lenken ser riktig ut uansett. Det er
`tests/auth-redirect.test.js` som beviser at appen faktisk SENDER den kanoniske
adressen fra `https://localhost`.

Runden selv fant ett avvik, i demonstrasjonen: instruksen på steget «Slett
listepunktet» er lang, og når objektmenyen åpner seg må kortet vike for både
målet og panelet. Kortet blinket da opp og ned. Årsaken lå i delt kode, ikke i
native runtime — `placeTour()` målte kortets høyde mens forrige rundes
`maxHeight` sto på, altså sin egen forrige beslutning, og vekslet dermed mellom
kappet og ukappet. Browseren hadde den samme løkka, men fyrer ikke
scroll/resize ofte nok til at den ble synlig. Rettet ved å måle ukappet;
regresjonen ligger i `tests/onboarding.test.js` (sjekk 11b), som feiler uten
fiksen på mobil-viewport. Etterkontrollert på telefonen: boblen står stille.

TalkBack leste norsk tekst med engelsk stemme. Det er telefonens
TTS-stemmeutvalg, ikke Huskis: `lang`-håndteringen er på plass
([`tilgjengelighet.md`](tilgjengelighet.md)), og en installert norsk stemme
løser det.

Feil som finnes både i browser og mobil er ordinære Huskis-feil. Feil som bare
finnes i native runtime skal få avgrensede plattformtilpasninger og egne tester.

## Slik kjører du den fysiske runden

Dette er oppskriften runden over ble kjørt etter, og den gjenbrukes ved
etterkontroll og på iOS i fase 7. Én sammenhengende økt dekker hele lista.
Oppsett: debug-APK-en installert
(oppskrift i fase 1), `huskis.no` åpen i en nettleser på en annen maskin, og en
**ny testkonto** (T) som brukes begge steder — registreringen er selv et
testpunkt. Din vanlige konto (P) er motparten når deling skal testes.

| # | Gjør | Forventet | Dekker |
|---|---|---|---|
| 1 | Registrer konto T i appen. Åpne bekreftelseslenken fra e-posten. | Norsk tekst vises riktig (æ, ø, å — se dekodingsnotatet over). Lenken peker på `huskis.no` — aldri `localhost`. Bekreftelse fullfører, og innlogging i appen gir en sesjon. | registrering, auth-lenker, tegnsett |
| 2 | Kjør demonstrasjonen som møter T ved første innlogging. | Alle stegene lar seg utføre med finger: opprette, endre navn, dra, slette. | opprette/endre/flytte, dra-og-slipp, sletting |
| 3 | Bytt språk til engelsk og tilbake i konto-modalen. | Appen laster seg selv på nytt fra de innebygde filene, uten hvit skjerm og uten nettkrav for UI-et. | språk, kontoinnstillinger |
| 4 | Bygg en liten struktur: område → mappe → liste → tre punkter, og endre navn på hvert nivå. | Skjermtastaturet dekker ikke feltet som redigeres, fokus lander riktig, og Enter avslutter. | objektnivåene, tastatur/fokus, smale viewporter |
| 5 | Dra: omorganiser punkter, flytt et punkt til en annen liste, flytt en liste via navigasjonsknappen, og omorganiser områder/mapper i navigasjonsmodalen. | Trykk-og-hold tar tak, siden scroller ikke under gesten, og slippet lander der forhåndsvisningen viste. | begge DnD-scope, berøringsflater |
| 6 | Logg inn som T i nettleseren. Endre navn på noe der, opprett ett objekt til. | Alt fra telefonen er der, og nettleserens endringer dukker opp på telefonen. | synk mobil ↔ browser |
| 7 | På telefonen: slett et punkt og angre. Slett en liste, gjenopprett den fra søppelkassen. Slett en til og tøm kassen. | Angre gir punktet tilbake. Det permanent slettede kommer ALDRI tilbake — heller ikke etter at nettleseren har synket. | sletting/angre/gjenoppretting/tømming, synkinvarianter |
| 8 | Del et område fra telefonen med konto P. Godta invitasjonen som P i nettleseren, og endre noe der. | Rollen og rettighetene er som i web, og endringen når telefonen. | delt innhold, roller, invitasjoner |
| 9 | Slå på flymodus. Opprett og slett noe. Tving appen helt ut av minnet og start den igjen — fortsatt i flymodus. | Statuslinjen sier «Frakoblet – endringene lagres på denne enheten», og endringene er der etter omstart. Du er fortsatt innlogget. | offline, tvungen avslutning → ny oppstart |
| 10 | Slå av flymodus. La appen ligge i forgrunnen et par minutter, send den til bakgrunnen underveis og hent den tilbake. | Statusen går til «Lagret», nettleseren viser det samme, og appen laster seg ALDRI på nytt av seg selv — intet oppdateringsbanner, ingen halvskrevet tekst som forsvinner. | online, bakgrunn → forgrunn, ingen uventet reload, auto-oppdatering i native runtime |
| 11 | Slå på TalkBack og gå gjennom punkt 9, 12 og 13 i den manuelle sjekklista i [`tilgjengelighet.md`](tilgjengelighet.md). Slå den av igjen, logg ut og logg inn på nytt. | Kontrollene leses opp med meningsfulle navn, modaler fanger fokus, og utlogging/innlogging virker som i web. | tilgjengelighet, utlogging/innlogging |

Rapporter et avvik med: trinnummeret, hva som faktisk skjedde, hva statuslinjen
(`#sync-status`) sa, og om det samme skjer i nettleseren på samme konto. Det
siste avgjør om det er en ordinær Huskis-feil eller en native-spesifikk feil.

**Ferdigkriterium:** ingen kjent Android-spesifikk feil kan gi datatap,
synkfeil, blokkert kjernefunksjon eller vesentlig dårligere tilgjengelighet enn
webversjonen. **Oppfylt.**

---

# Fase 3 — nødvendige native integrasjoner

**Mål:** gjøre appen naturlig å bruke som Android-app uten å bygge native
funksjoner bare fordi de er mulige.

- [x] Definer korrekt system-tilbakeoppførsel: lukk øverste popover/modal,
      naviger ett Huskis-nivå tilbake der det er naturlig, og la OS håndtere
      resten.
- [x] Verifiser safe areas, status-/navigasjonsfelt og skjermtastatur.
      Implementert, automatisk dekket og kjørt på fysisk telefon — de to
      landskaps-avvikene runden fant er rettet (se sekvensen under).
- [ ] Definer hvilke eksterne lenker som åpnes i systembrowser og hvilke som
      forblir i appen.
- [ ] Gjør auth-/e-postlenker robuste; vurder Android App Links og senere iOS
      Universal Links slik at bekreftelse/reset kan returnere til appen.
- [ ] Koble native lifecycle/network-signaler til eksisterende synklogikk bare
      der websignalene ikke er tilstrekkelige.
- [ ] Vurder sikker lagring av native-spesifikke secrets/tokens dersom det
      faktisk finnes et behov; ikke flytt data ut av dagens modell uten grunn.
      Ta samtidig stilling til `android:allowBackup`, som i dag står på
      Capacitors standard `true`: da følger WebView-lagringen — altså den
      lokale bufferen OG Supabase-sesjonen — med i Androids sikkerhetskopi til
      en annen enhet. Webversjonen har ingen tilsvarende vei ut av enheten.

## Systemets tilbakeknapp

**Hva den gjorde før:** forlot appen ved FØRSTE trykk, uansett hva som stod
åpent. Ikke en beslutning noen hadde tatt — `@capacitor/android` 8.5.0 har
ingen back-håndtering i det hele tatt (ingen `onBackPressed`, ingen
`OnBackPressedCallback`, ingen `KEYCODE_BACK`; det eneste treffet på
«backButton» i pakken er en Cordova-kompatibilitetsstubbe i `native-bridge.js`).
`BridgeActivity` arver dermed AppCompats standard, og WebView-en får aldri
trykket. Huskis navigerer heller ikke med History API-et, så det fantes ingen
historikk å gå tilbake i.

**Hva den gjør nå:** ett lag per trykk, ovenfra og ned — inline-redigering,
så øverste popover/modal — og faller gjennom til OS når ingenting er åpent.
Del-modalen som ble åpnet fra nav-modalen går ett nivå tilbake dit, i stedet
for å lukke helt. Autoritativt for stigen og hvorfor hovedsiden er bunnen:
[`menus.md`](menus.md) («Systemets tilbakeknapp»).

| Ledd | Rolle |
|---|---|
| `closeTopLayer(viaBack)` (`app.js`) | ÉN stige, to innganger: Escape og tilbakeknappen. |
| `systemBack()` (`app.js`) | Tilbakeknappens inngang. Returnerer true når Huskis tok trykket. |
| gaten (`app.js`, én linje) | Setter `window.__huskisSystemBack` KUN når `window.Capacitor.isNativePlatform()` er sann. Nettleseren får ingen bro. |
| `MainActivity.java` | `OnBackPressedCallback` → spør broen → videresender til `OnBackPressedDispatcher` når svaret er false. Kaller ikke `finish()` selv; OS avgjør hva et tilbaketrykk på rot-aktiviteten betyr. |
| `android/app/build.gradle` | `androidx.activity` eksplisitt på kompileringsstien (Capacitor drar den inn som `implementation`, altså ikke til appmodulen). |
| `tests/system-back.test.js` | Stigen i ekte nettleser, begge viewportene: gaten, ett lag per trykk, del-modalens nivå tilbake, redigering avbrutt, demoen urørt, og at ingenting-åpent gir false. |
| `tests/capacitor-android.test.js` | Gaten er avgrenset til én kodelinje, og skallet spør web-laget før OS. |

### Testet på fysisk Android

Sekvensen under er kjørt i sin helhet på telefon, uten avvik. Den gjenbrukes
ved etterkontroll og på iOS i fase 7.

Debug-APK som i fase 1. Bruk gestenavigasjon ELLER treknappsraden — begge
lander i den samme `OnBackPressedDispatcher`-en, så én av dem holder; kjør
gjerne punkt 1 og 6 i begge for å se at gesten oppfører seg likt.

| # | Gjør | Forventet |
|---|---|---|
| 1 | Åpne nav-modalen. Tilbake. | Modalen lukkes. Appen står fortsatt åpen på hovedsiden. |
| 2 | Åpne nav-modalen → objektmenyen på et områdekort. Tilbake, tilbake. | Først lukkes menyen (nav-modalen står), så nav-modalen. |
| 3 | Åpne objektmenyen på en liste → «Flytt» → «Flytt til …». Tilbake. | Velgeren lukkes, objektmenyen står igjen. |
| 4 | Åpne «Deling og medlemmer» fra en mappe i nav-modalen. Tilbake. | Del-modalen lukkes og nav-modalen kommer tilbake — samme sted som ← i overskriften. |
| 5 | Start en omdøping (menyen → «Endre navn»), skriv litt. Tilbake til tastaturet er borte, så tilbake igjen. | Første trykk lukker tastaturet (Android selv). Neste avbryter redigeringen — det gamle navnet står, og ingen modal bak ble lukket. |
| 6 | Stå på hovedsiden uten noe åpent. Tilbake. | Appen forlates som en vanlig Android-app; oppgaven ligger igjen, og et nytt trykk på ikonet tar deg rett tilbake — fortsatt innlogget, samme sted. |
| 7 | Under demonstrasjonen (ny konto, eller «Vis på nytt»): tilbake. | Demoen avbrytes ikke bakveien; trykket forlater appen. ✕ i kortet er utgangen. |
| 8 | Slå på flymodus, opprett noe, og trykk tilbake til appen forlates. Åpne den igjen. | Ingen tapte endringer, ingen dobbeltlagring, statuslinjen som før. |

Avvik rapporteres som i fase 2: trinnummer, hva som faktisk skjedde, og om det
samme skjer i nettleseren med Escape. Er svaret ja, er det en ordinær
Huskis-feil i stigen — ikke en Capacitor-tilpasning.

## Safe areas, systemfeltene og skjermtastaturet

**Hva runtimen faktisk gjør.** `@capacitor/android` 8.5.0 har en innebygd
`SystemBars`-plugin (ingen npm-plugin, ingen konfigurasjon — `insetsHandling`
står på `css`). Den lytter på vinduets insets og har TO utfall, og hvilket vi
får avgjøres av ÉN ting i webkoden: om den siste `meta[name=viewport]`-taggen
inneholder `viewport-fit=cover`.

| Uten `viewport-fit=cover` | Med `viewport-fit=cover` |
|---|---|
| Pluginen SPISER inset-ene (setter dem til 0) og polstrer WebView-ens forelder med dem på Android 15+ | Inset-ene slippes gjennom til WebView-en |
| WebView-en ligger altså MELLOM systemfeltene | WebView-en dekker hele skjermen |
| `env(safe-area-inset-*)` er 0 inne i siden | `env(safe-area-inset-*)` har de faktiske målene |
| Feltene og gestelinjen viser vindusbakgrunnen fra AppCompat-temaet, ikke Huskis' egen flate | Huskis' egen flate når helt ut i skjermkantene |

Ingen av dem KLIPPER noe — det er den samme pluginen som holder innholdet unna
systemflatene i begge. Forskjellen er hvem som gjør jobben, og hvordan det ser
ut. Uten `cover` blir appen stående med to fremmedfargede striper (mørke på en
telefon i mørk modus, siden temaet er `DayNight` mens Huskis alltid er lyst).
Derfor er `cover` valgt: appen tegner selv helt ut, og holder innholdet innenfor
med CSS.

Skjermtastaturet håndteres av den samme lytteren: når IME-en er synlig får
WebView-ens forelder en bunn-polstring like høy som tastaturet, og
`env(safe-area-inset-bottom)` settes samtidig til 0. Tastaturet KRYMPER altså
viewportet — det legger seg ikke oppå det, og det skyver ikke siden opp.
`android:windowSoftInputMode="adjustResize"` i manifestet gjør det samme valget
eksplisitt for de Android-versjonene der pluginen ikke polstrer selv; uten
erklæringen står modusen på «unspecified», og krymp-eller-skyv er systemets valg.

**Hva Huskis gjør.** Fire tokens (`--safe-top`/`-right`/`-bottom`/`-left`) leser
`env(safe-area-inset-*)` ett sted, og alt som ligger fast mot en viewport-kant
legger dem på sin egen avstand. Autoritativt:
[`design-system.md`](design-system.md) («Den sikre sonen»).

| Ledd | Rolle |
|---|---|
| `viewport-fit=cover` (`index.html`) | Ber om å få tegne under systemfeltene — det er det som gir sonen verdier i det hele tatt. |
| `--safe-*` (`styles.css`) | Sonen som fire tall. Toppmenyen, kontoknappen, board-et, modal-/popover-skallet, toasten, lagringsstatusen og oppdateringsbanneret legger dem på. |
| `safeInsets()` (`app.js`) | Det som regnes ut i JS leser sonen herfra: demonstrasjonens kort, popoveren på desktop, kolonnebudsjettet og dra-og-slippets to scroll-grenser klemmer mot den brukbare bunnen i stedet for mot skjermkanten. |
| `scroll-padding-top` (`styles.css`) | Sidens rulling vet at det faste panelet dekker toppen, så et felt som rulles fram ikke havner under det. |
| resize-lytteren (`app.js`) | Tastaturet krymper viewportet ⇒ feltet som redigeres rulles tilbake i syne. |
| `android:windowSoftInputMode` (manifestet) | Tastaturet krymper vinduet, det skyver det ikke. |
| `tests/safe-area.test.js` | Setter sonen i ekte nettleser og måler at chromet flytter seg nøyaktig så mye — begge viewportene, begge board-scopene. Dekker også de to tastatur-tilfellene. |
| `tests/capacitor-android.test.js` | De to erklæringene sonen hviler på, i hver sin fil. |

Runden trengte **ingen native API-er**: `env()` er inert i en nettleser, så
CSS-en gjør hele jobben, og webkoden kjenner fortsatt native-runtimen på
nøyaktig ÉN linje — gaten for tilbakeknappens bro. Unntaket i
`tests/capacitor-android.test.js` er derfor uendret.

### Testet på fysisk Android

Sekvensen under er kjørt i sin helhet på telefon. Punkt 1–6 og 9 uten avvik.
Punkt 7–8 (landskap) avdekket to ordinære Huskis-feil — begge var der i
nettleseren på samme viewport, og begge er rettet: toppmenyen står nå på ÉN
linje når bredden rekker ([`menus.md`](menus.md)), og demonstrasjonens kort er
aldri høyere enn skjermen ([`introduksjon.md`](introduksjon.md)). Vakten er
`tests/landscape-chrome.test.js`. Sekvensen gjenbrukes ved etterkontroll og på
iOS i fase 7.

Debug-APK som i fase 1, på en telefon med hakk ELLER hull i skjermen og med
**gestenavigasjon** slått på. Kjør punkt 1 og 6 en gang til med treknappsraden,
og punkt 7–8 i landskap.

| # | Gjør | Forventet |
|---|---|---|
| 1 | Start appen og se på toppen. | Huskis' egen flate går helt opp i skjermkanten (ingen grå/svart stripe), men breadcrumben og kontoknappen står HELT under statusfeltet/hakket — ingen tekst eller knapp er delvis dekket. |
| 2 | Se på bunnen med innhold som fyller skjermen. | Nederste listekort kan rulles helt fram; gestelinjen dekker det ikke. Luften under siste kort ser ut som luften ellers. |
| 2b | Dra en liste helt ned til board-et auto-scroller, og slipp den nederst. | Auto-scrollen rekker helt til enden — den slupne lista blir ikke stående delvis under gestelinjen. |
| 3 | Utløs en toast (slett et listepunkt) og se på lagringsstatusen samtidig. | Begge ligger over gestelinjen, og de overlapper ikke hverandre. |
| 4 | Åpne nav-modalen, konto-modalen og en objektmeny. | Overskrift og lukkeknapp er aldri under statusfeltet; nederste rad er aldri under gestelinjen. |
| 5 | Endre navn på et listepunkt NEDERST på skjermen. | Tastaturet kommer opp, og feltet blir stående synlig over det — det havner verken under tastaturet eller under toppmenyen. Enter avslutter. |
| 6 | Endre navn på et listepunkt som ligger like under toppmenyen. | Feltet rulles fram under panelet, ikke bak det. |
| 7 | Snu telefonen til landskap med hakket til venstre. | Ingen knapp eller tekst ligger under hakket; board-ets venstre kolonne starter til høyre for det. |
| 8 | I landskap: åpne objektmenyen på et listepunkt, og kjør «Vis på nytt» av demonstrasjonen. | Popoveren og demo-kortet holder seg innenfor det brukbare feltet — ikke under hakket, statusfeltet eller gestelinjen. |
| 9 | Slå på mørk modus på telefonen og gjenta punkt 1. | Appen er fortsatt lys hele veien ut i kantene; ingen mørk stripe dukker opp øverst eller nederst. |

Avvik rapporteres som i fase 2: trinnummer, hva som faktisk skjedde, og om det
samme skjer i nettleseren på samme viewport. Er svaret ja, er det en ordinær
Huskis-feil — ikke en Capacitor-tilpasning.

**Ferdigkriterium:** Android-appen oppfører seg som en normal mobilapp i de
plattformtilfellene browseren ikke selv kan håndtere godt nok.

---

# Fase 4 — felles release-identitet

**Mål:** kunne svare entydig på «hvilken Huskis-release kjører denne klienten?»
uavhengig av Vercel, Android eller senere iOS.

Dagens `buildId` identifiserer en konkret build/deploy og beholdes så lenge det
er nyttig. Innfør i tillegg en **plattformuavhengig `releaseId`** som følger den
logiske Huskis-releasen.

- [ ] Definer `releaseId` og hvor den genereres.
- [ ] Web og Android kan rapportere samme `releaseId` for samme release.
- [ ] Skill `releaseId` fra Vercel-spesifikk `buildId`/deployment-ID.
- [ ] Oppdater `version.json`/mobilmetadata uten å svekke cache- eller
      reload-sikkerheten.
- [ ] Dokumenter kompatibilitetsregelen mellom klientrelease og databaseskjema.
- [ ] Vurder `minimumSupportedRelease` bare dersom et konkret behov oppstår;
      gammel klient skal ellers fortsatt fungere.
- [ ] Bestem om web og mobil skal motta samme byte-identiske webartifact eller
      separate builds med samme `releaseId`. Ikke endre dagens sikre
      migrering→smoke→Vercel-rekkefølge uten eksplisitt design og tester.

**Ferdigkriterium:** web og mobil kan sammenlignes på én release-identitet uten
at Vercels deploy-ID misbrukes som produktversjon.

---

# Fase 5 — OTA for web-assets

**Mål:** vanlige Huskis-endringer i HTML/CSS/JS/assets skal kunne nå installerte
mobilapper uten butikkrelease, med minst samme sikkerhetsnivå som dagens
auto-update i browser.

Før implementering skal OTA-løsning velges etter disse kravene:

- signering/integritetskontroll av bundles;
- innebygd kjent-god fallback;
- rollback ved mislykket oppstart;
- kanaler/miljøer og staged rollout;
- tydelig skille mellom web-assets og native kode;
- kompatibilitet med App Store-/Play-regler;
- mulighet for automatisering fra GitHub Actions;
- rimelig leverandørlåsing og driftskostnad.

Implementasjonen skal:

- [ ] aldri OTA-oppdatere Swift/Kotlin/native plugins;
- [ ] verifisere bundle før aktivering;
- [ ] beholde den innebygde butikkversjonen som fallback;
- [ ] gjenbruke `updateSafety()` slik at bundlebytte ikke skjer midt i usikret
      arbeid;
- [ ] tåle offline oppstart;
- [ ] unngå reload-/oppdateringsløkker;
- [ ] kunne rulle tilbake en dårlig mobilbundle;
- [ ] først bevises på Android før den tas til iOS.

**Ferdigkriterium:** en testrelease kan oppdatere browser og Android til samme
`releaseId` uten butikkoppdatering, og mobilappen kan trygt falle tilbake hvis
OTA-releasen er defekt.

---

# Fase 6 — Android intern distribusjon

**Mål:** flytte fra sideloadet debug-APK til en ekte signert Android-app i
Google Plays interne testspor.

- [ ] Opprett/verifiser Google Play Developer-konto.
- [ ] Bekreft endelig package ID før første opplasting.
- [ ] Sett opp signing og håndtering av nøkler uten secrets i repoet.
- [ ] Produser release-AAB reproducerbart fra CI.
- [ ] Opprett appoppføring, ikon, screenshots og nødvendig metadata.
- [ ] Fullfør privacy/Data Safety-opplysninger basert på faktisk databruk.
- [ ] Gi reviewer/testspor fungerende testkonto der det kreves.
- [ ] Test installasjon, oppgradering og rollback gjennom Play-sporet.

**Ferdigkriterium:** en tester kan installere og oppdatere Huskis gjennom Google
Play uten sideloading.

---

# Fase 7 — iOS og TestFlight

**Mål:** gjenbruke den beviste arkitekturen på iOS, ikke starte et nytt
mobilprosjekt.

Capacitor iOS bygges med Apples verktøykjede; macOS + Xcode kreves for normal
lokal bygging/testing. Dersom arbeidet fortsatt skal være cloud-first, må vi
velge en macOS CI/build-løsning før denne fasen.

- [ ] Installer/pin iOS-plattformen i samme Capacitor-major som Android.
- [ ] Generer og sjekk inn `ios/`.
- [ ] Konfigurer bundle ID, signing og Apple Developer/App Store Connect.
- [ ] Kjør samme funksjonelle paritetsmatrise som på Android.
- [ ] Implementer bare de iOS-spesifikke integrasjonene som faktisk trengs.
- [ ] Konfigurer Universal Links/auth-retur der nødvendig.
- [ ] Produser signert build og distribuer via TestFlight.
- [ ] Bevis OTA og fallback på TestFlight-build før offentlig lansering.

**Ferdigkriterium:** en ekstern TestFlight-tester kan bruke samme Huskis-release
som web/Android med fungerende synk og trygg oppdatering.

---

# Fase 8 — offentlig lansering og samlet releasepipeline

**Mål:** én normal Huskis-endring skal ha én forståelig vei fra PR til alle
plattformene.

- [ ] App Store- og Google Play-oppføringer er komplette og godkjenningsklare.
- [ ] Policy-/personvernopplysninger er konsistente med faktisk appadferd.
- [ ] En vanlig webrelease kan publisere web + OTA-kanaler fra samme
      `releaseId`.
- [ ] En native endring bygger nye butikkbinaries og kan ikke feilaktig gå kun
      gjennom OTA.
- [ ] Releasejobbene respekterer eksisterende databaseport:
      tester → migrering → smoke før inkompatibel frontend kan slippes.
- [ ] Secrets/signing-nøkler ligger i egnet secret store, aldri i repo/logg.
- [ ] Staged rollout og rollback er dokumentert og testet på begge plattformer.
- [ ] Overvåkning/feilrapportering er tilstrekkelig til å oppdage en dårlig
      mobilrelease.

**Ferdigkriterium:** Huskis utvikles fortsatt som **ett produkt**. Web, Android
og iOS deler produktkode og release-identitet; bare reelt native endringer
krever egne butikkbinaries.

---

## Senere muligheter — ikke del av minimumsløypa

Disse vurderes først etter stabil offentlig mobilrelease og bare dersom de gir
konkret brukerverdi:

- pushvarsler;
- haptisk feedback;
- biometrisk opplåsing;
- widgets/shortcuts;
- native share sheet;
- PWA/installasjon fra browser;
- mer avansert offline-funksjonalitet.

De skal ikke snike seg inn i fundamentfasene.

## Neste oppgave

**Fase 3 fortsetter.** Tilbakeknappen er ferdig og verifisert på telefon. Safe
areas, systemfeltene og skjermtastaturet er implementert og automatisk dekket,
men mangler den fysiske runden — kjør sekvensen over på en telefon med hakk og
gestenavigasjon, og kryss av punktet når den er grønn. Deretter står eksterne
lenker for tur.

Hver fase 3-endring er plattformspesifikk og skal gates eksplisitt
(arkitekturregel 2): browserutgaven skal fortsatt kjøre uten Capacitor.
`tests/capacitor-android.test.js` har fått sitt bevisste unntak for
tilbakeknappens bro — ÉN kodelinje i `app.js`, gjennom
`window.Capacitor.isNativePlatform()`. Trenger et nytt punkt et native API,
utvides unntaket like avgrenset i samme endring; vakten fjernes ikke.
