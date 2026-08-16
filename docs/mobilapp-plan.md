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
| Nåværende fase | **Fase 4 — felles release-identitet** er i gang, mens **fase 3** fortsatt har ETT åpent punkt. To faser er altså i luften samtidig. Fase 4 er startet fordi det som gjenstår i fase 3 verken blokkerer den eller berøres av den — det er en enhetsøkt, ikke kode. Fase 3 er ikke ferdig før den økten er kjørt. Statusen for hver av dem står på hver sin rad under; det gjør også neste praktiske steg. |
| Status — fase 3 | Fase 3 er i gang. Fem punkter er ferdige: systemets tilbakeknapp og safe areas/systemfeltene/skjermtastaturet, begge verifisert på fysisk telefon; eksterne lenker og auth-/e-postlenker, som begge er beslutninger uten kode og derfor ikke har noe å prøve på en telefon; og sikker lagring/`android:allowBackup`, der sikkerhetskopien av WebView-lagringen er slått av (se seksjonene). Lifecycle-/network-punktet er kartlagt og avgjort — ingen native signaler kobles på — hullet er lukket i webkoden, og den fysiske sekvensen er nå kjørt uten avvik: appen står med etterslepet inne straks Android tar den fram igjen. Punktet står likevel åpent, fordi runden ikke isolerte triggeren (pollet og realtime var i live) og enhetssjekken av `navigator.onLine` ikke er kjørt. Automatisk dekket av `tests/safe-area.test.js`, `tests/landscape-chrome.test.js`, `tests/system-back.test.js`, `tests/sync-foreground.test.js` og `tests/capacitor-android.test.js`. Ferdigkriteriet er ikke nådd. |
| Status — fase 4 | Fase 4 er i gang. Fem av sju punkter er ferdige: kartleggingen av dagens release-identiteter, `releaseId` er definert og generert i `build.js`, web og Android bygget fra samme commit rapporterer den samme verdien, `version.json` er utvidet additivt uten at cache- eller reload-sikkerheten er rørt, og kompatibilitetsregelen mellom klientrelease og databaseskjema er skrevet ned ([`release-og-deploy.md`](release-og-deploy.md)). De to siste — `minimumSupportedRelease` og valget mellom byte-identisk artifact og separate builds — står bevisst åpne til det finnes et konkret behov (se seksjonen). Automatisk dekket av `tests/build-version.test.js`, `tests/auto-update.test.js` og `tests/capacitor-android.test.js`. Ferdigkriteriet er ikke erklært oppfylt: Android-halvdelen er verifisert som kjede og i en simulert sync, ikke observert i en kjørende APK. |
| Neste milepæl | Android-appen oppfører seg som en normal mobilapp i de plattformtilfellene browseren ikke håndterer godt nok selv |
| Neste praktiske steg — fase 3 | Kjør ÉN `chrome://inspect`-økt mot debug-APK-en og svar på begge de gjenstående spørsmålene: lever `navigator.onLine` i flymodus uten `ACCESS_NETWORK_STATE`, og er det gjenopptakelsen som starter runden når pollet og realtime er tatt ut av bildet — det er alt som står igjen i fase 3 |
| Neste praktiske steg — fase 4 | Les `document.querySelector('meta[name=huskis-release]').content` i APK-en og på `huskis.no` bygget fra samme commit, og se at de er like mens build-ID-ene er forskjellige. Det er samme slags økt som fase 3s, og kan kjøres i den — men den erstatter den ikke: fase 3s to spørsmål må besvares uansett |
| OTA | Ikke innført; skal ikke innføres før Android-baselinen er stabil |
| iOS | Senere fase; ikke en del av første implementering |

### Slik holdes planen levende

Hver PR som flytter mobilprosjektet fremover skal oppdatere denne filen i samme
endring:

- oppdater **nåværende fase**, **status** og **neste milepæl** øverst;
- kryss bare av punkter som faktisk er implementert og verifisert;
- la ett konkret neste steg være tydelig — og er flere faser i luften samtidig,
  ett per åpen fase, med hver sin rad i tabellen. En fase som fortsatt har et
  åpent punkt skal aldri kunne bli usynlig fordi en senere fase er startet;
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
at `version.json.version` fortsatt er `null`: SemVer skal ikke måtte økes per PR.
Release-identiteten er `releaseId`, og den utledes av commiten, ikke av
`package.json` ([`auto-update.md`](auto-update.md)). Den er `private`, har
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
      Implementert, automatisk dekket, og hele den fysiske sekvensen kjørt —
      inkludert punkt 10, som er kjørt om igjen med rettingen inne og bekreftet
      på telefon (identisk i lys og mørk modus, lesbart i begge).
- [x] Definer hvilke eksterne lenker som åpnes i systembrowser og hvilke som
      forblir i appen. Regelen er skrevet ned og voktet; den krevde ingen kode,
      fordi appen ikke har én eneste utgående lenke og Capacitors egen ruting
      allerede gjør nøyaktig det regelen sier.
- [x] Gjør auth-/e-postlenker robuste; vurder Android App Links og senere iOS
      Universal Links slik at bekreftelse/reset kan returnere til appen.
      Kartlagt og avgjort: lenkene er robuste, App Links utsettes til fase 6.
      Krevde ingen kode i appen — TAPPET i auth-lenkene går til Supabase, ikke
      til `huskis.no`, så et intent-filter ser ikke selve trykket. Om 303-en
      videre havner i appen er et åpent spørsmål som skal prøves på telefon
      (se seksjonen).
- [ ] Koble native lifecycle/network-signaler til eksisterende synklogikk bare
      der websignalene ikke er tilstrekkelige. Kartlagt og avgjort: ingen native
      signaler kobles på — websignalene rekker, og det ene reelle hullet
      (ingenting hentet appen inn igjen ved gjenopptakelse) er lukket med
      `visibilitychange`, som browseren og WebView-en har likt. Koden og
      regresjonstesten er på plass, og den fysiske sekvensen er kjørt uten
      avvik: appen står med etterslepet inne straks Android tar den fram igjen.
      Det gjenstår en enhetsøkt med `chrome://inspect` før avkryssing, med to
      spørsmål runden ikke kunne svare på: om `navigator.onLine` lever uten
      `ACCESS_NETWORK_STATE`, og om det FAKTISK var gjenopptakelsen som startet
      runden — pollet og realtime var i live hele veien (se seksjonen).
- [x] Vurder sikker lagring av native-spesifikke secrets/tokens dersom det
      faktisk finnes et behov; ikke flytt data ut av dagens modell uten grunn.
      Ta samtidig stilling til `android:allowBackup`. Kartlagt og avgjort: det
      finnes ingen native-spesifikke secrets, så ingen data flyttes ut av
      dagens modell og intet keystore-lag innføres. `android:allowBackup` er
      derimot slått AV, sammen med regler for datauttrekk: WebView-lagringen
      bærer både Supabase-sesjonen og hele bufferen, og den skal bli på enheten
      (se seksjonen).

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
ut. Uten `cover` blir appen stående med to striper i temaets vindusbakgrunn i stedet
for i Huskis' egen flate. Derfor er `cover` valgt: appen tegner selv helt ut, og
holder innholdet innenfor med CSS.

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
| `values/styles.xml` + `values-v27/` | Systemfeltenes UTSEENDE om dagen: DayNight-foreldretema, gjennomsiktige felt og MØRKE glyfer. Uten glyferklæringen ligger klokka som lyse glyfer over Huskis' lyse flate. |
| `values-night/` + `values-night-v27/` | Det samme om natten: vindusbakgrunnen bak feltene er nå mørk, så glyfene snus til LYSE. |
| `SystemBars.style = "DEFAULT"` (`capacitor.config.json`) | Pluginen setter glyffargen i RUNTIME og overstyrer temaet. `DEFAULT` = les telefonens nattmodus — den samme kilden temaet snur vindusbakgrunnen etter, så flaten og glyfene over den ikke kan skille lag. Se avsnittet under. |
| `tests/safe-area.test.js` | Setter sonen i ekte nettleser og måler at chromet flytter seg nøyaktig så mye — begge viewportene, begge board-scopene. Dekker også de to tastatur-tilfellene. |
| `tests/capacitor-android.test.js` | De to erklæringene sonen hviler på, i hver sin fil. |

Runden trengte **ingen native API-er**: `env()` er inert i en nettleser, så
CSS-en gjør hele jobben, og webkoden kjenner fortsatt native-runtimen på
nøyaktig ÉN linje — gaten for tilbakeknappens bro. Unntaket i
`tests/capacitor-android.test.js` er derfor uendret.

### Testet på fysisk Android

Sekvensen under er kjørt i sin helhet på telefon, og punkt 10 en gang til med
rettingen inne. Punkt 1–6 og 9 uten avvik.
Punkt 7–8 (landskap) avdekket to ordinære Huskis-feil — begge var der i
nettleseren på samme viewport, og begge er rettet: toppmenyen står nå på ÉN
linje når bredden rekker ([`menus.md`](menus.md)), og demonstrasjonens kort er
aldri høyere enn skjermen ([`introduksjon.md`](introduksjon.md)). De to
rettingene er verifisert i nettleseren på det samme viewportet, ikke kjørt om
igjen på telefon — de er ren webkode, uten en plattformbit som kan oppføre seg
annerledes der. Vakten er
`tests/landscape-chrome.test.js`. Sekvensen gjenbrukes ved etterkontroll og på
iOS i fase 7.

Punkt 10 kom TIL etter runden: skjermbilder fra telefonen viste at klokka og
statusikonene lå som lyse glyfer over Huskis' lyse flate. Rettingen tok to
runder, og det er verdt å huske hvorfor — systemfeltenes utseende settes to
steder:

1. **temaet** (`values/styles.xml`): lyst foreldretema, gjennomsiktige felt,
   `windowLightStatusBar`. Det fjernet den svarte stripen i mørk modus, men
   glyfene ble fortsatt snudd;
2. **`SystemBars`-pluginen**, som setter utseendet i RUNTIME og dermed
   overstyrer temaet. Med standardverdien leser den telefonens nattmodus, så
   mørk modus ga lyse glyfer. `SystemBars.style = "LIGHT"` i
   `capacitor.config.json` låser den.

Begge voktes i `tests/capacitor-android.test.js`. Utfallet var bekreftet på
telefon: appen så identisk ut i lys og mørk modus, med godt lesbar tekst i
begge.

**Punktet ble utfordret da appen fikk to drakter** ([`mork-drakt.md`](mork-drakt.md)),
og det tok to runder til. Begge er verdt å skrive ned.

**Runde 3 (feilet på telefon).** Resonnementet var: siden appen tegner under
systemfeltene, er flaten bak klokka vår egen — altså `#141922` i mørk drakt, og
da må mørke glyfer bli uleselige. Stilen ble satt til `DEFAULT`, som lar
pluginen følge telefonens nattmodus, mens temaet ble stående permanent lyst.
**På telefon var det uleselig i BEGGE modi:** båndet bak statusfeltet er ikke
sidens flate, men VINDUSBAKGRUNNEN fra temaet, og den var lys uansett drakt.
`DEFAULT` ga dermed lyse glyfer på et lyst bånd — nøyaktig den uleseligheten
punkt 10 fjernet.

**Runde 4 (denne, verifisert på telefon).** Feilen var ikke `DEFAULT` i seg
selv, men at båndet og glyfene hadde hver sin kilde. Foreldretemaet er derfor
`Theme.AppCompat.DayNight` igjen, med `values-night/` + `values-night-v27/` som
snur glyfene, og `SystemBars.style` tilbake på `DEFAULT`. Da leser flaten OG
glyfene den samme nattmodusen og kan ikke skille lag — uavhengig av hvilken
drakt brukeren har valgt i appen, som ikke rører systemfeltene i det hele tatt.
Den «svarte stripen» night-varianten ga i runde 1 er dessuten ikke lenger en
feil: nå ER den flaten, og den skal være mørk når appen er mørk.

Samme endring fikser en annen ting bare temaet kan fikse: fra targetSdk 33
utleder WebView `prefers-color-scheme` av appens eget tema (`isLightTheme`), så
med et permanent lyst tema ga draktens standardvalg «Følg systemet» lys app på
en mørk telefon.

Begge deler er bekreftet på enhet: appen blir mørk av seg selv på en mørk
telefon med drakten på «Følg systemet», og klokka og statusikonene er lesbare i
begge drakter — også når drakten overstyres mot telefonens modus.

Lærdommen er verdt å ta med til iOS i fase 7: **båndet bak systemfeltene er
temaets flate, ikke sidens, og glyfene må ha samme kilde som flaten under dem.**
Runde 1 og 3 så begge riktige ut i koden og feilet på enheten. Bare en telefon
avgjør dette.

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
| 10 | Se på klokka, batteriet og gestelinjen i BEGGE modusene. | Glyfene er mørke og lette å lese mot Huskis' lyse flate — i lys modus like godt som i mørk. |

Avvik rapporteres som i fase 2: trinnummer, hva som faktisk skjedde, og om det
samme skjer i nettleseren på samme viewport. Er svaret ja, er det en ordinær
Huskis-feil — ikke en Capacitor-tilpasning.

## Eksterne lenker

**Kartleggingen først.** Huskis' UI har ikke én utgående lenke: null `<a>`-tagger
med absolutt adresse, null `target="_blank"`, null `window.open()`. De to eneste
adressene utenfor eget origin som står i frontend i det hele tatt er
Supabase-endepunktet (data over `fetch`/WebSocket, ikke navigasjon) og
`canonicalAppUrl` (går inn i auth-lenkene Supabase sender på e-post, og
navigeres aldri til). Appen navigerer seg selv nøyaktig ett sted:
`location.replace(target)` i guarden øverst i `index.html` — og den rører kun de
tre navngitte redirect-hostene, så i appen, der verten er `localhost`, gjør den
ingenting.

**Regelen som ble valgt:** appens eget origin lastes inne i appen, alt annet
åpnes i systembrowseren. Autoritativt, med begrunnelse og de tre grensetilfellene:
[`domains-and-urls.md`](domains-and-urls.md) («Eksterne lenker»).

**Den krevde ingen kode.** Capacitors `BridgeWebViewClient.shouldOverrideUrlLoading()`
→ `Bridge.launchIntent()` sender allerede hver adresse med et annet skjema+vert
enn appens ut som `Intent.ACTION_VIEW`. Det ER regelen. Å legge en
`@capacitor/browser`-plugin (Custom Tab) oppå ville vært et native API for et
behov som ikke finnes — og fase 1 har med vilje ingen plugins utover kjernen.
Web-laget kjenner derfor fortsatt native-runtimen på nøyaktig ÉN gated linje,
broen for tilbakeknappen; unntaket i `tests/capacitor-android.test.js` er
uendret.

| Ledd | Rolle |
|---|---|
| `capacitor.config.json` uten `server.allowNavigation` | Det ene feltet som kan slå regelen av: hver oppføring der er en vert som lastes INNE i WebView-en. Den får ikke Huskis' data — Web Storage er origin-skilt — men den får Capacitor-broen, som injiseres i WebView-en og ikke i et bestemt origin ([`domains-and-urls.md`](domains-and-urls.md)). |
| `MainActivity.java` | Overtar ikke `WebViewClient`/`shouldOverrideUrlLoading`, og navigerer ikke WebView-en direkte med `loadUrl` — rutingen er Capacitors, ikke vår. |
| CSP `default-src 'none'` + `form-action 'self'` (`index.html`) | To av de tre unntakene fra rutingen: en fremmed side kommer ikke inn som `<iframe>`, og et skjema kan ikke sendes til et annet origin — heller ikke med POST, som ikke når `shouldOverrideUrlLoading` ([`sikkerhetsheadere.md`](sikkerhetsheadere.md)). Det tredje er `data:`/`blob:`, som blir i WebView-en — appen bruker dem bare til bilder, og en framtidig NAVIGASJON dit må kreve at nyttelasten er uavhengig etterprøvd ([`domains-and-urls.md`](domains-and-urls.md)). |
| `tests/capacitor-android.test.js` (del 12) | De to måtene å miste regelen på: `allowNavigation`, og web-kildekode som begynner å produsere utgående lenker. Vokter også at den ene selvnavigasjonen fortsatt er guardens. |

**De to grensetilfellene, avgjort.** Auth-lenkene i e-post kommer fra utsiden og
røres ikke av regelen: e-postklienten gir adressen til telefonens standardapp
for den — browseren — og Huskis har ikke noe intent-filter som gjør krav på
noen vert (neste seksjon). URL-er brukeren selv skriver i et
listepunkt er ren tekst og forblir det: å gjøre dem klikkbare er en
produktendring med egne spørsmål, ikke en native integrasjon. Regelen sier
allerede hvor en slik lenke havner den dagen den lages.

### Ikke prøvd på telefon — det finnes ingenting å trykke på

Dette punktet har **ingen fysisk sekvens**, og det er ikke en utsettelse: appen
har ingen lenke som kan tappes, så det finnes ingen handling en telefon kunne
svart på. Det som er verifisert er kildekoden — Capacitors ruting er LEST i
`node_modules/@capacitor/android`, ikke observert på en enhet.

Det skillet er verdt å holde fast på, av samme grunn som systemfeltene i forrige
punkt: koden er ikke fasit for hva enheten gjør. Den dagen appen får sin første
utgående lenke skal det observeres på telefon at adressen faktisk forlater
WebView-en og lander i browseren, og at Huskis står igjen med tilstanden sin når
man kommer tilbake. Neste punkt gir den ikke: App Links handler om lenker INN i
appen, og det punktet endte uten kode.

## Auth-/e-postlenker og App Links

**Kartleggingen først.** Huskis sender fem e-poster med en lenke i. Hvilken app
som svarer på telefonen avgjøres av verten i lenken brukeren faktisk trykker på,
og den er ikke `huskis.no` i de tre som bærer en HANDLING: Supabase
Auth-e-postene (bekreft registrering, tilbakestill passord, bekreft ny adresse)
peker på prosjektets egen verify-adresse på `*.supabase.co`, og `huskis.no` er
bare der 303-en LANDER. De to som peker rett på det kanoniske originet —
delingsinvitasjonen fra Resend, og fotnoten i varselet om endret adresse — er
nettopp de to som ikke bærer noen sesjon. Hele tabellen, med hva som skjer i
hvert enkelt tilfelle:
[`domains-and-urls.md`](domains-and-urls.md) («Auth-lenkene i e-post»).

**Konsekvensen i dag:** lenken åpner browseren, og handlingen fullføres DER —
kontoen blir bekreftet, passordet blir satt, adressen blir byttet. For
registrering og passordgjenoppretting står appen igjen ulogget, og prisen er én
ekstra innlogging; adressebyttet koster ikke engang det, siden det starter fra
en app som allerede er innlogget. Ingen av dem er en brutt flyt. At det
ikke er verre henger på at klienten kjører supabase-js' standard `implicit`-flyt:
tokenene kommer i fragmentet, ikke som en `?code=` som må byttes inn med en
PKCE-verifikator lagret i originet som startet flyten. Startet i appen
(`https://localhost`) og fullført i browseren (`huskis.no`) ville en PKCE-flyt
ikke kunnet fullføres i det hele tatt.

**Beslutningen: App Links utsettes til fase 6**, sammen med signeringsnøkkelen.
Fire endringer trengs uansett: intent-filteret på `MainActivity`, statementet på
originet, det selektive unntaket i `copyDir()` som faktisk får statementet
publisert, og lesing av den innkommende adressen (`@capacitor/app` + **en gate
til** i web-koden) — både ved KALDSTART (`getLaunchUrl()`, det vanlige når man
kommer fra e-post) og ved en ny intent (`appUrlOpen`). To andre er BETINGET av et spørsmål
ingen kan svare på herfra: verten i auth-lenkene er `*.supabase.co`, men de
ENDER på `huskis.no` — og om browseren leverer fra seg på slutten av en
redirect-kjede, slik native OAuth-klienter bygger på, avgjøres på en telefon.
Holder den veien, kan malene og `{{ .ConfirmationURL }}` stå som de er; holder
den ikke, kommer e-postmalene og `verifyOtp()` i tillegg. Begrunnelsen i sin
helhet:
[`domains-and-urls.md`](domains-and-urls.md) («Android App Links: hvorfor ikke
ennå»). iOS Universal Links har samme struktur og hører til fase 7.

**Punktet krevde derfor ingen kode.** Web-laget kjenner fortsatt native-runtimen
på nøyaktig ÉN gated linje — broen for tilbakeknappen — og unntaket i
`tests/capacitor-android.test.js` er uendret. Det som ER gjort, er å gjøre den
utsatte innføringen umulig å gjøre halvveis.

| Ledd | Rolle |
|---|---|
| `authRedirectUrl()` (`app.js`) | Sender allerede den kanoniske adressen fra WebView-originet, altså den ene formen App Links en gang kan fange. Voktet av `tests/auth-redirect.test.js`. |
| `AndroidManifest.xml` uten `<data android:scheme="https">` | Manifest-halvdelen. Finnes ikke i dag; innføres den alene, verifiserer Android ingenting. |
| `.well-known/assetlinks.json` (finnes ikke) | Origin-halvdelen: `no.huskis.app` + signeringsnøkkelens SHA-256. Repo-eid — Vercel serverer `dist/`, og `build.js` fyller den. |
| `copyDir()` i `build.js` | Den tredje halvdelen, og den lettest oversette: den hopper over hvert navn som starter med punktum, så en `.well-known/`-katalog havner i dag ikke i `dist/`. Innføres statementet, må dette endres i samme slengen — og fritaket må være SELEKTIVT. Fjernes prikk-regelen helt, publiseres `.gitignore` og hver framtidige skjulte fil på `huskis.no` med det samme. |
| `tests/capacitor-android.test.js` (del 13) | Vakten: halvdelene innføres sammen eller ikke i det hele tatt; filteret er komplett (`VIEW` + `DEFAULT` + `BROWSABLE` + `https`) og ber om verifisering; statementet navngir riktig appId med et fingeravtrykk på riktig form, og det når faktisk `dist/`; og noe leser den innkommende adressen. Manifestene leses uten XML-kommentarer og i ALLE source set-ene — Gradle slår dem sammen, så et filter i `src/release/` teller like fullt. |

### Ikke prøvd på telefon — det finnes ingen lenke som kan fange

Som forrige punkt har dette **ingen fysisk sekvens**, og det er en konsekvens av
beslutningen, ikke en utsettelse: uten et intent-filter finnes det ingen
oppførsel en telefon kunne svart annerledes på enn den allerede gjør i fase 2s
punkt 1 (bekreftelseslenken åpner browseren, og innlogging i appen etterpå gir
en sesjon — kjørt, uten avvik).

**Debugnøkkelen er verdt å si presist.** Debug-APK-en er signert med Androids
automatisk genererte debugnøkkel, og CI-runnerne er flyktige — det finnes altså
ikke ett SHA-256 som er stabilt på tvers av bygg, og derfor ingen nøkkel å
publisere permanent før fase 6.

Men verifiseringen KAN prøves før det: debugkeystoren på én maskin er stabil, så
fingeravtrykket derfra kan legges midlertidig i statementet og hele kjeden kjøres
på en telefon. Prisen er at `huskis.no` da offentlig autoriserer en debugnøkkel
så lenge fila står der — et bevisst, tidsavgrenset eksperiment, ikke noe som blir
stående. (De manuelle omveiene, `adb shell pm set-app-links-user-selection`,
beviser derimot ikke det som skal bevises: at ORIGINET har autorisert appen.)

**Det ene spørsmålet som må avgjøres først** er redirect-veien: tapp en
bekreftelseslenke i e-postklienten på en telefon der appen er installert og
verifisert, og se om Supabase' 303 til `huskis.no` lander i appen eller blir
liggende i browseren — og om `#access_token=…` følger med. Svaret bestemmer om
App Links koster fire eller seks koblede endringer, og det finnes ikke noe annet
sted enn en enhet å hente det fra. Det kan kjøres med det midlertidige
debug-fingeravtrykket beskrevet over, altså før fase 6, dersom svaret trengs for
å planlegge den fasen.

## Lifecycle- og network-signaler

**Kartleggingen først.** Synken hentes fram av seks ting, og bare tre av dem er
hendelser:

| Ledd i `app.js` | Hva det gjør |
|---|---|
| `save()` | en lokal endring → `scheduleCloud()` (300 ms debounce) |
| realtime `postgres_changes` | endring hos en annen enhet → `scheduleCloud(150)` |
| pollet (5 s) | `scheduleCloud(0)` — men `return` mens `document.hidden` |
| `online` (to lyttere) | statusen nullstiller frakoblet-tellingen og ber om en runde straks; operasjonskøen nuller backoffen og pumper |
| `offline` | maler statusen. Ingen synk-effekt |
| `visibilitychange` → SKJULT | `commitAllPending()`: committer buffrede slettinger. Ikke en synk-trigger |

`navigator.onLine` leses tre steder: frakoblet-tilstanden i lagringsstatusen,
`isNetworkError()` og `updateSafety()`.

**Hva som er upålitelig i en WebView — og hva som er lest kontra observert.**

*Lest, ikke observert:* det sammenslåtte manifestet ber bare om `INTERNET`
(`@capacitor/android` 8.5.0 sitt eget bibliotekmanifest er tomt — kontrollert i
pakken). Chromiums nettverksvarsling i WebView-en henger på
`ACCESS_NETWORK_STATE`; uten den er tilstanden UKJENT, og ukjent leses som «på
nett». Da står `navigator.onLine` permanent på `true`, og `online`/`offline`
fyrer aldri.

*Observert — men det avgjør ikke spørsmålet:* fase 2 punkt 9 viste «Frakoblet» i
flymodus, og trinn 3 i sekvensen under synket etter en bakgrunnsperiode med
flymodus på. Ingen av dem skiller de to verdenene: «Frakoblet» har TO kilder —
flagget ELLER to runder som ikke nådde fram — og trinn 3 slår av flymodus FØR
appen hentes fram, så nettet er tilbake uten at noen `online`-hendelse trengs.
Runden er dermed forklart uansett hva flagget sto på.

*Fortsatt ubesvart:* enhetssjekken som avgjør det er IKKE kjørt, og den er ikke
en runde med appen — den krever `chrome://inspect` mot debug-APK-en (Capacitor
slår på WebView-debugging i debugbygg), flymodus på, og lesing av
`navigator.onLine` + `__huskis.syncStatus.snapshot()`. Spørsmålet står altså
åpent.

*Konsekvensen om det stemmer:* de to `online`-lytterne blir aldri kalt. Ingen av
dem eier data. Begge er snarveier forbi en timer som prøver igjen uansett —
pollet hvert 5. sekund, og køens egen backoff med tak på 15 s — og det som
faktisk MELDER frakoblet er terskelen på to runder som ikke nådde fram, som
ikke spør `navigator.onLine` i det hele tatt. Derfor er dette ikke et hull, og
derfor er ikke `ACCESS_NETWORK_STATE` lagt inn: en tillatelse skal ikke inn på
en uprøvd antakelse for å spare sekunder i veier som leger seg selv. Blir
svaret på enhetssjekken «ja, den er død», er den ene manifestlinjen det
naturlige tiltaket — ikke en plugin — og den hører sammen med en ny sjekk i del
6 av `tests/capacitor-android.test.js`, der de andre manifesterklæringene
voktes.

De to andre leserne taper heller ingenting på et flagg som står permanent på
`true`. `isNetworkError()` faller tilbake på meldingsteksten, som er der
uansett. Og `updateSafety()`s offline-arm («ikke trygt å reloade») leses bare av
`update-check.js`, som i appen ser sin egen innebygde `/version.json`, aldri
finner en nyere build-ID og derfor aldri foreslår en reload i det hele tatt
(fase 2).

**Hullet som ER reelt, og det er et web-hull.** Pollet er slått av mens siden er
skjult, og INGENTING hentet appen inn igjen ved gjenopptakelse.
[`accounts.md`](accounts.md) påsto at `visibilitychange`/`focus` gjorde det;
de lytterne fantes ikke i koden. Etter en pause i bakgrunnen var altså
INTERVALLET det eneste som kunne ta appen igjen — og intervallet er nettopp det
en bakgrunnsprosess ikke lover: en skjult side får timerne sine strupet
(Chromium samkjører oppvåkningene, og etter fem minutter skjult ned mot én i
minuttet), og en bakgrunnsapp kan fryses av OS-et. Scenarioet: telefonen ligger
i lomma en time med Huskis i bakgrunnen mens en annen enhet flytter en liste.
Brukeren åpner appen og ser den gamle visningen til en timer vi ikke eier
bestemmer seg for å fyre.

**Fiksen krevde ingen native API-er.** Gjenopptakelsen er en hendelse, ikke en
timer, og `visibilitychange` er det samme signalet i browseren og i WebView-en.
Web-laget kjenner derfor fortsatt native-runtimen på nøyaktig ÉN gated linje —
broen for tilbakeknappen — og unntaket i `tests/capacitor-android.test.js` er
uendret. Det samme gjelder npm-avhengighetslista og appmodulens
`dependencies`-blokk: ingen plugin er innført.

| Ledd | Rolle |
|---|---|
| `visibilitychange`-lytteren (`app.js`, ved `startCloudPoll`) | Synlig igjen + innlogget ⇒ `scheduleCloud(0)`. Fyrer ikke på vei INN i bakgrunnen — en app som ligger i bakgrunnen skal ikke polle. |
| pollet (5 s) | Uendret: sikkerhetsnettet mens appen er fremme, og det som tar nettet igjen der `online` aldri kommer. |
| realtime | Uendret, og trenger ingen nudge: dør kanalen, melder den fra selv (`CLOSED`/`CHANNEL_ERROR` → ny subscribe), og pullen over dekker hullet imens. |
| `tests/sync-foreground.test.js` | Med pollet slått AV — altså situasjonen en strupet timer gir — henter appen inn det en annen enhet gjorde straks den er synlig. Og: en endring som ikke nådde fram lander av seg selv uten én eneste `online`-hendelse og uten at `navigator.onLine` noen gang er falsk, altså slik en WebView uten `ACCESS_NETWORK_STATE` ville oppført seg. |
| [`accounts.md`](accounts.md) | Autoritativt for hva som starter en synk-runde. |

**Ikke koblet på, og hvorfor:** `@capacitor/app` (`appStateChange`,
`getLaunchUrl`) og `@capacitor/network` gir de samme to signalene som web-laget
allerede har. Prisen ville vært en npm-avhengighet, en Gradle-avhengighet i
appmodulen som merger sitt eget manifest, og en gate til i web-koden — tre
låser fra #122 som alle måtte utvides — for et signal `visibilitychange` gir
gratis. `@capacitor/app` kommer først når fase 6 eventuelt tar App Links opp
igjen, og da for den innkommende ADRESSEN, ikke for lifecycle.

### Kjørt på fysisk Android — og det de fire trinnene ikke avgjør

Sekvensen under er kjørt i sin helhet på telefon, uten avvik. Den gjenbrukes ved
etterkontroll og på iOS i fase 7.

**Det som ER observert** er brukeregenskapen punktet finnes for: appen står med
etterslepet inne praktisk talt straks Android tar den fram igjen — etter en lang
bakgrunnsperiode, og etter en bakgrunnsperiode med flymodus på — og en endring
gjort rett før appen ble skjult ligger allerede hos den andre klienten. Ingen av
scenarioene lot brukeren se en gammel visning mens en timer bestemte seg.

**Det runden IKKE gjør er å isolere hvem som startet runden.** På telefonen er
både pollet (5 s) og realtime i live hele veien, og begge kan starte en runde
straks WebView-en våkner eller kanalen kobler seg opp igjen. Sekvensen slår
ingenting av og teller ingen pulls, så et poll-tikk innen 5 s ser likt ut på
skjermen som gjenopptakelses-lytteren. Observasjonen er altså FORENLIG med
lytteren — og lytteren er regresjonstestet nettopp med pollet slått av
(`tests/sync-foreground.test.js`) — men runden beviser den ikke.

To spørsmål krever derfor fortsatt en enhetsøkt, og det er den samme økten:
`chrome://inspect` mot debug-APK-en (Capacitor slår på WebView-debugging i
debugbygg).

| Spørsmål | Hva som må gjøres |
|---|---|
| Lever `navigator.onLine` uten `ACCESS_NETWORK_STATE`? | Flymodus på; les `navigator.onLine` og `__huskis.syncStatus.snapshot()`. |
| Var det gjenopptakelsen som startet runden? | Isoler triggeren før appen sendes i bakgrunnen: ta realtime ut av bildet (`__huskis.client.removeAllChannels()`), og merk av når hver runde starter — f.eks. ved å instrumentere `fetch` og `visibilitychange` med tidsstempel. Lander første Supabase-kall i samme øyeblikk som synligheten snur, var det gjenopptakelsen; kommer det først ved neste 5-sekunderstikk, var det pollet. |

Den høyre kolonnen er lest ut av koden — `__huskis` eksponeres også i APK-en, og
`removeAllChannels()` finnes i den innsjekkede supabase-js — men den er **ikke
prøvd på en enhet**, så den er en plan, ikke en oppskrift som har virket.

Sekvensen er kort, og skal kjøres med en browserklient innlogget på samme konto:

| # | Gjør | Forventet |
|---|---|---|
| 1 | Send appen til bakgrunnen og la telefonen ligge låst i minst ti minutter (gjerne en time). Endre et listenavn i nettleseren imens. | — |
| 2 | Hent appen fram igjen og se på skjermen UTEN å røre noe. | Det nye navnet står der praktisk talt med en gang — ikke etter en pause på titalls sekunder, og uten at du må dra, trykke eller endre noe for å utløse det. |
| 3 | Gjenta med flymodus på telefonen i bakgrunnsperioden, og slå den av FØR du henter appen fram. | Statuslinjen går til «Lagret», og endringen fra nettleseren er der. |
| 4 | Snu det: endre noe i appen, send den til bakgrunnen med en gang, vent, og se i nettleseren. | Endringen er hos den andre klienten. Den ble pushet før appen ble skjult, ikke etter. |

Avvik rapporteres som i fase 2: trinnummer, hva som faktisk skjedde, hva
`#sync-status` sa, og om det samme skjer i nettleseren med fanen i bakgrunnen.
Er svaret ja, er det en ordinær Huskis-feil.

## Sikker lagring og sikkerhetskopi

**Kartleggingen først.** Huskis har ingen native-spesifikke secrets. Det eneste
som ligger i frontend er Supabase-endepunktet og `anon`-nøkkelen, som begge er
laget for å stå i klartekst i en klient (`config.js`), og appen har ingen
API-nøkkel, ingen enhetsnøkkel og ingen native integrasjon som kunne hatt en.
Det som ER følsomt ligger i WebView-ens `localStorage`, og er det samme som i
nettleseren — hele lista med poster, innhold og levetid står i
[`accounts.md`](accounts.md) («Hva som ligger i enhetens lagring»). To av dem
betyr noe:

- **sesjonen** (`sb-<prosjekt-ref>-auth-token`), som supabase-js skriver selv:
  `persistSession` og `autoRefreshToken` står på klientens standard `true`
  (lest i `vendor/supabase-js-2.111.0.js`). Posten bærer `refresh_token` ved
  siden av det kortlevde `access_token`-et, og fornyer seg selv. Den er altså
  IKKE kortlevd: den lever til brukeren logger ut. (Hvor lenge et refresh-token
  er gyldig hos serveren er en prosjektinnstilling i Supabase, ikke noe repoet
  kan svare for — og en tidsboks der ville uansett bare forkortet vinduet, ikke
  fjernet det.)
- **bufferen** (`mine-lister-v1:<uid>`), som er hele brukerens innhold i lesbar
  form.

**Sikker lagring: nei.** Et keystore-lag under sesjonen ville
kostet en Capacitor-plugin (altså npm-avhengighetslista OG appmodulens
`dependencies`-blokk), en egen storage-adapter til supabase-js, og en gate til i
web-koden — tre låser fra #122 utvidet på én gang — for å beskytte ÉN av de to
postene mot en angriper som allerede er inne i appens sandkasse, der Androids
egen diskkryptering er den grensen som gjelder. Bufferen ved siden av ville
fortsatt ligget i klartekst. Den ene veien dataene faktisk forlot enheten var en
helt annen, og den lukkes med to erklæringer:

**`android:allowBackup`: slått AV.** Forskjellen i angrepsflate er reell.
Auto Backup tar som standard med filene under appens datakatalog — unntakene er
`cache`, `code_cache` og `no_backup` — og WebView-lagringen ligger i
`app_webview/` under nettopp den. Med Capacitors standard `true` fulgte derfor
BÅDE sesjonen og bufferen med i Googles sikkerhetskopi, og en gjenoppretting på
en annen telefon er innlogget som brukeren uten at noen har logget inn.
Nettleserutgaven har ingen tilsvarende vei ut av enheten. Sesjonen er ikke
kortlevd nok til å redde det: den fornyer seg selv så lenge posten finnes.

Å slå det av koster ingenting. Serveren er kanonisk, så en ny telefon henter alt
ved første innlogging; språk og drakt er bevisst per enhet ([`sprak.md`](sprak.md),
[`mork-drakt.md`](mork-drakt.md)); og `mine-lister-device` SKAL være ny på en ny
enhet — en kopi gir to enheter samme LWW-opphav, som er det `newer()` bryter
uavgjort med.

To erklæringer, fordi de dekker hver sin halvdel:

| Ledd | Rolle |
|---|---|
| `android:allowBackup="false"` (manifestet) | Stenger skykopien, på alle Android-versjoner. |
| `android:dataExtractionRules` → `res/xml/data_extraction_rules.xml` | Stenger enhet-til-enhet-overføringen, som attributtet IKKE rører hos alle produsenter fra Android 12 (vi er på targetSdk 36). Begge modusene må skrives eksplisitt: en manglende — eller tom — seksjon leses som «fullt aktivert», ikke som «ingenting». `cross-platform-transfer` er derimot opt-in og trenger ingen erklæring. |
| `tests/capacitor-android.test.js` (del 6) | Begge halvdelene, koblingen mellom dem (manifestet peker på en fil som faktisk finnes), at hver seksjon utelukker HELE datakatalogen, og at ingen `<include>` har begynt å plukke ut data som skal ut likevel. |
| [`accounts.md`](accounts.md) | Autoritativt for hva som ligger i enhetens lagring, og for at den blir der. |

**Punktet krevde ingen web-kode.** Ingen plugin, ingen npm-avhengighet, ingen
Gradle-avhengighet: web-laget kjenner fortsatt native-runtimen på nøyaktig ÉN
gated linje — broen for tilbakeknappen — og unntaket i
`tests/capacitor-android.test.js` er uendret.

### Ikke prøvd på telefon — og hva en telefon ville lagt til

Dette punktet er to erklæringer og en beslutning, og begge erklæringene er
statiske: testen leser dem, og APK-workflowen kompilerer dem (paths-filteret
`android/**` starter den), så at Android godtar regelfila og at manifestet
merger uten konflikt avgjøres i CI.

At Auto Backup som standard tar med `app_webview/` er LEST i Androids
dokumentasjon, ikke observert på en enhet — men retningen henger ikke på det:
vi vil ikke ha dataene ut i noen av tilfellene, og erklæringene feiler lukket.
Vil man se det på enhet, er `adb shell bmgr backupnow no.huskis.app` runden som
viser at pakken ikke lenger er kvalifisert. Det er en bekreftelse, ikke en
åpen beslutning.

**Ferdigkriterium:** Android-appen oppfører seg som en normal mobilapp i de
plattformtilfellene browseren ikke selv kan håndtere godt nok.

---

# Fase 4 — felles release-identitet

**Mål:** kunne svare entydig på «hvilken Huskis-release kjører denne klienten?»
uavhengig av Vercel, Android eller senere iOS.

Dagens `buildId` identifiserer en konkret build/deploy og beholdes så lenge det
er nyttig. Innfør i tillegg en **plattformuavhengig `releaseId`** som følger den
logiske Huskis-releasen.

- [x] Definer `releaseId` og hvor den genereres. De 12 første tegnene av
      commit-SHA-en, generert i `build.js` (se seksjonene).
- [x] Web og Android kan rapportere samme `releaseId` for samme release.
      Begge bygges av `node build.js` over det samme treet, og identiteten
      følger med `dist/` inn i APK-en.
- [x] Skill `releaseId` fra Vercel-spesifikk `buildId`/deployment-ID.
      `releaseId` leser aldri `VERCEL_DEPLOYMENT_ID`; `buildId` er fortsatt
      deploy-ID-en i produksjon.
- [x] Oppdater `version.json`/mobilmetadata uten å svekke cache- eller
      reload-sikkerheten. Feltet er lagt TIL; `update-check.js` er urørt og
      leser fortsatt bare `buildId`. Androids `versionCode`/`versionName` er
      ikke rørt — de hører til fase 6.
- [x] Dokumenter kompatibilitetsregelen mellom klientrelease og databaseskjema.
      [`release-og-deploy.md`](release-og-deploy.md) («Klientrelease og
      databaseskjema»).
- [ ] Vurder `minimumSupportedRelease` bare dersom et konkret behov oppstår;
      gammel klient skal ellers fortsatt fungere. **Behovet finnes ikke i dag**
      — se «De to punktene som står åpne med vilje».
- [ ] Bestem om web og mobil skal motta samme byte-identiske webartifact eller
      separate builds med samme `releaseId`. Ikke endre dagens sikre
      migrering→smoke→Vercel-rekkefølge uten eksplisitt design og tester.
      **I dag ER de separate builds med samme `releaseId`**; valget tas når
      fase 5 (OTA) gir det en konsekvens — se samme seksjon.

## Kartleggingen først: hva identifiserer en release i dag

Fire tall er i omløp, og de svarer på fire forskjellige spørsmål. Ingen av dem
svarte på «hvilken Huskis-release er dette?» før `releaseId` kom til.

| Felt | Svarer på | Eies av | Verdi i dag |
|---|---|---|---|
| `buildId` | «hvilken build/deploy kjører denne klienten?» | `build.js`, én gang per bygg | Vercels deploy-ID i produksjon, ellers `<sha12>-<tid i base36>`. Stemplet i `<meta name="huskis-build">` OG `/version.json`, og hektet på JS/CSS-URL-ene som `?b=` |
| `version.json.version` | «hvilken SemVer?» — ingenting, med vilje | `package.json` | `null`. `package.json` finnes kun for Capacitor-skallet og har ikke noe `version`-felt, så SemVer skal ikke måtte økes per PR |
| Vercels deployment-ID | «hvilken deploy i Vercels infrastruktur?» | Vercel | Brukes som `buildId` i produksjonsbygget, og ALDRI til noe annet. Den er leverandørens identitet, ikke produktets |
| `versionCode` / `versionName` | «hvilken butikkbinær?» | `android/app/build.gradle` | `1` / `"1.0"` — Capacitor-malens startverdier, urørt. De trengs først når appen distribueres gjennom Play (fase 6), og er et krav DERFRA, ikke en produktversjon |

Hullet: `buildId` er unik per BYGG. Web og Android bygges av hver sin kjøring av
`node build.js` over det samme treet, så de kan ikke ha samme `buildId` — og
hadde dermed ingen måte å si at de er den samme releasen.

## `releaseId`

**Definisjonen:** `releaseId` er de 12 første tegnene av commit-SHA-en builden
er laget av. Én commit på `main` ER én Huskis-release: `release.yml` kjører på
hver push dit, og alt som deployes deployes fra en commit.

**Hvor den genereres:** i `build.js`, i den samme kjøringen som `buildId`, fra
den samme kilden som `commit` (`VERCEL_GIT_COMMIT_SHA` → `GITHUB_SHA` →
`git rev-parse HEAD`). Den skrives til de samme to stedene: klienten
(`<meta name="huskis-release">`) og `/version.json`.

**Forskjellen fra `buildId`,** som er hele poenget: to bygg av samme commit får
FORSKJELLIG `buildId` og LIK `releaseId`. Det gjelder web mot Android, og en
re-deploy mot den forrige. Autoritativt, med tabellen som stiller dem opp mot
hverandre: [`auto-update.md`](auto-update.md) («Release-ID»).

**Vercels deploy-ID misbrukes ikke.** `releaseId` leser aldri
`VERCEL_DEPLOYMENT_ID`. Den fortsetter å være `buildId` i produksjon, der den
hører hjemme: den identifiserer deployen, ikke produktet.

**`buildId` beholder rollen sin, uendret.** Den eier cache- og
reload-sikkerheten alene — `?b=`-URL-ene, sammenligningen i `update-check.js` og
dermed «lik build-ID ⇒ ingen banner, ingen reload». `updateSafety()` avgjør
fortsatt når en reload er trygg. `releaseId` er en identitet som RAPPORTERES,
ikke et signal noe reagerer på; ingen kodelinje i oppdateringsmekanikken leser
den.

**Additivt, fordi gamle klienter leser fila** (arkitekturregel 7). `releaseId`
er et nytt felt ved siden av de gamle — ingen er døpt om eller fjernet. En
klient fra før dette (en telefon som ikke er oppdatert, en fane som har stått
åpen) leser `version.json` som før: `update-check.js` validerer på `buildId`
alene og overser resten. Regelen gjelder framover også: `version.json` utvides,
den skrives ikke om.

| Ledd | Rolle |
|---|---|
| `makeReleaseId()` (`build.js`) | Genererer identiteten. `null` når SHA-en er ukjent — en ukjent release er ikke en oppdiktet en. |
| `stampHtml()` (`build.js`) | Stempler BEGGE meta-taggene. Mangler en av dem i `index.html`, kaster builden i stedet for å deploye en klient uten identitet. |
| `<meta name="huskis-release">` (`index.html`) | Klientens egen kopi, lesbar uten nett — det er den som gjør at en offline Android-app kan sammenlignes med web. `dev` = ubygget kilde eller ukjent commit. |
| `/version.json` | Det klienten spør mot. `releaseId` ligger ved siden av `buildId`; `commit` beholder hele SHA-en. |
| `update-check.js` | **Urørt.** Leser og sammenligner fortsatt bare `buildId`. |
| `tests/build-version.test.js` | De to ID-ene hver for seg: to bygg av samme commit gir lik `releaseId` og ulik `buildId`, formen er 12 heks, og deploy-ID-en blir aldri `releaseId`. |
| `tests/auto-update.test.js` | Reload-sikkerheten: lik `buildId` + en annen `releaseId` + felt klienten ikke kjenner ⇒ ingen mål-build, intet banner, ingen reload. |
| `tests/capacitor-android.test.js` | Androids halvdel: den synkede kopien er byte for byte kilden (`index.html` modulo begge ID-ene), og den innebygde `version.json` bærer den samme releasen som klienten i APK-en. |
| [`auto-update.md`](auto-update.md) | Autoritativt for build-ID, release-ID og oppdateringsmekanikken. |
| [`release-og-deploy.md`](release-og-deploy.md) | Autoritativt for releaseprosessen og for kompatibilitetsregelen mot databaseskjemaet. |

**Rekkefølgen migrering → smoke → Vercel er urørt.** Punktet krevde ingen
endring i `release.yml` eller `vercel.json`: releasen som migreres, smoke-testes
og deployes er allerede én `github.sha`, og det er nettopp den `releaseId`
navngir.

## De to punktene som står åpne med vilje

Begge er beslutninger som skal tas når det finnes noe å ta dem PÅ. Å innføre dem
nå ville vært mekanikk uten en bruker.

**`minimumSupportedRelease`.** Det som ville gjort en nedre grense nødvendig er
en klient som ikke lenger KAN fungere mot serveren. Det finnes ikke: skjemaet er
additivt, en gammel klient skriver et delsett av kolonnene og leser bort de nye
([`release-og-deploy.md`](release-og-deploy.md)). En grense ville altså i dag
bare kunne stenge ute klienter som virker. Den dagen en serverendring faktisk
brekker en eldre klient, er `releaseId` identiteten en slik grense må uttrykkes
i — men grensen selv er en egen, eksplisitt beslutning.

**Byte-identisk artifact eller separate builds.** I dag er svaret de facto
**separate builds med samme `releaseId`**: Vercel kjører `node build.js`, og
Android-workflowen kjører sin egen. `buildId` er derfor forskjellig, og det er
riktig — de ER to bygg. Et byte-identisk artifact ville krevd at build-ID-en ble
sendt inn utenfra og at ETT bygg ble delt mellom to kjeder, altså en ny
avhengighet mellom release-workflowen og Android-workflowen. Det er en pris uten
en gevinst så lenge appen ikke oppdaterer web-assetene sine. Med OTA (fase 5)
får spørsmålet en konsekvens — da er det bundelen som distribueres — og da tas
valget der, med design og tester.

### Ikke prøvd på telefon — hva som ER verifisert, og hva som ikke er det

*Verifisert:* at `node build.js` skriver den samme `releaseId` i klienten og i
`version.json`, at to bygg av samme commit får lik `releaseId` og ulik
`buildId`, og at oppdateringsmekanikken ikke reagerer på feltet. Alt dette er
kjørt i denne kjeden, ikke lest.

*Verifisert som kjede, i en simulert sync:* Androids halvdel er `cap sync`, som
kopierer `dist/` inn i `android/app/src/main/assets/public`. Kopisteget er
simulert lokalt, og `tests/capacitor-android.test.js` målte da at kopien er byte
for byte kilden og bærer den samme releasen som en NY build av samme commit —
med en annen `buildId`. Det er den samme kjeden APK-workflowen kjører.

*Ikke observert:* ingen har lest `releaseId` ut av en kjørende APK. Det er det
neste praktiske steget for fase 4, og det er en `chrome://inspect`-økt av samme
slag som fase 3s — de kan kjøres i samme økt, men fase 4 avlaster ikke fase 3.

**Ferdigkriterium:** web og mobil kan sammenlignes på én release-identitet uten
at Vercels deploy-ID misbrukes som produktversjon.

Mekanikken er på plass og voktet av tester, men kriteriet er **ikke erklært
oppfylt**: to punkter står åpne, og sammenligningen er ikke gjort på en enhet.
Planens egen regel gjelder — en fase er ikke ferdig før ferdigkriteriet er
verifisert.

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
- [ ] Ta App Links opp igjen når nøkkelen finnes: begge halvdelene i samme
      endring (intent-filter + `.well-known/assetlinks.json` som `build.js`
      faktisk kopierer ut). Avgjør FØRST det åpne spørsmålet i fase
      3-seksjonen, på telefon: leverer browseren fra seg på slutten av
      Supabase' 303 til en verifisert App Link? Svaret bestemmer om dette er
      fire eller seks koblede endringer, og dermed om det er verdt gevinsten:
      én spart innlogging i de to auth-flytene som koster en, pluss
      invitasjonen til en registrert mottaker.
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

**To faser er i luften samtidig.** Fase 4 er startet uten at fase 3 er ferdig,
fordi det som gjenstår i fase 3 er en enhetsøkt — ikke kode fase 4 kunne
kollidert med. Rekkefølgen i planen er ikke opphevet: fase 3 er ikke ferdig før
ferdigkriteriet er verifisert, og det som står igjen der er beskrevet først
under.

### Fase 3

**Fase 3 fortsetter, og alt som gjenstår krever en telefon.** Fem punkter er
ferdige: tilbakeknappen og safe areas/systemfeltene/skjermtastaturet (begge
verifisert på telefon); de to lenkepunktene — eksterne lenker og
auth-/e-postlenker — som begge endte som beslutninger uten kode, og som derfor
fortsatt ikke har noe å prøve på en telefon; og sikker lagring/`allowBackup`,
som endte i to native erklæringer og ingen web-kode (seksjonen «Sikker lagring
og sikkerhetskopi»).

**Lifecycle- og network-signalene er kartlagt og avgjort**: websignalene rekker,
ingen native signaler er koblet på, og det ene reelle hullet — at ingenting
hentet appen inn igjen ved gjenopptakelse — er lukket med `visibilitychange`
(seksjonen «Lifecycle- og network-signaler»). Den fysiske sekvensen på fire
trinn er kjørt uten avvik, og den viser brukeregenskapen: etterslepet er inne
praktisk talt straks appen hentes fram.

**Det som gjenstår er én `chrome://inspect`-økt mot debug-APK-en**, og den
svarer på begge spørsmålene runden med vilje ikke kunne svare på:

- **Lever `navigator.onLine` uten `ACCESS_NETWORK_STATE`?** Avgjør om én
  manifestlinje er verdt å legge inn. Ingenting som haster — alle veiene flagget
  rører leger seg selv — men blir svaret «den er død», hører linjen sammen med
  en ny sjekk i del 6 av `tests/capacitor-android.test.js`.
- **Var det gjenopptakelsen som startet runden?** På telefonen var pollet og
  realtime i live hele veien, så et poll-tikk innen 5 s ser likt ut på skjermen
  som lytteren. Tas de to ut av bildet og runden fortsatt kommer i det øyeblikket
  synligheten snur, er lytteren bekreftet på enhet — ikke bare i nettleseren.

Det er det eneste som står igjen i fase 3.

### Fase 4

**Identiteten finnes, og de to åpne punktene er åpne med vilje.** `releaseId` er
definert, generert i `build.js` og stemplet inn i både klienten og
`/version.json`; web og Android bygget fra samme commit rapporterer den samme
verdien, mens `buildId` fortsatt er unik per bygg og eier cache- og
reload-sikkerheten alene. `minimumSupportedRelease` og valget mellom
byte-identisk artifact og separate builds står åpne til det finnes et konkret
behov — det første til en serverendring faktisk brekker en eldre klient, det
andre til OTA (fase 5) gir valget en konsekvens.

**Det som gjenstår for ferdigkriteriet er å SE det på en enhet:** les
`document.querySelector('meta[name=huskis-release]').content` i APK-en og på
`huskis.no` bygget fra samme commit, og se at de er like mens build-ID-ene er
forskjellige. Androids halvdel er i dag verifisert som kjede og i en simulert
sync, ikke observert i en kjørende APK.

Hver fase 3-endring er plattformspesifikk og skal gates eksplisitt
(arkitekturregel 2): browserutgaven skal fortsatt kjøre uten Capacitor.
`tests/capacitor-android.test.js` har fått sitt bevisste unntak for
tilbakeknappens bro — ÉN kodelinje i `app.js`, gjennom
`window.Capacitor.isNativePlatform()`. Trenger et nytt punkt et native API,
utvides unntaket like avgrenset i samme endring; vakten fjernes ikke.
