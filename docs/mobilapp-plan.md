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
| Nåværende fase | **Fase 5 — OTA for web-assets.** Fase 3 og fase 4 er ferdige; begge ferdigkriteriene ble oppfylt på fysisk enhet i samme `chrome://inspect`-økt. Fase 5 startet ikke med kode: OTA-løsningen skulle velges først, mot åtte krav, og **valget er tatt**. Kjeden er nå hel i koden — det som gjenstår av fasen er å prøve den på en fysisk telefon. Statusen for hver fase står på hver sin rad under. |
| Status — fase 3 | **Ferdigkriteriet er nådd.** Alle seks punktene er avgjort: systemets tilbakeknapp og safe areas/systemfeltene/skjermtastaturet, begge verifisert på fysisk telefon; eksterne lenker og auth-/e-postlenker, som begge er beslutninger uten kode og derfor ikke har noe å prøve på en telefon; sikker lagring/`android:allowBackup`, der sikkerhetskopien av WebView-lagringen er slått av; og lifecycle-/network-signalene, målt på enhet med sonden. `navigator.onLine` er bekreftet dødt uten `ACCESS_NETWORK_STATE`, og tillatelsen er lagt inn med vakt. Gjenopptakelsen er tilskrevet: et `get_my_doc` står i enhetsloggen merket `by: 'visibilitychange'`. Målingen viste samtidig at hendelsen IKKE leveres når Android har fryst prosessen — der starter pollets forfalte tikk runden i samme øyeblikk som opptiningen. Begge ledd er dermed bærende, hvert i sitt regime (se seksjonen). Ingen native plugin er innført. Automatisk dekket av `tests/safe-area.test.js`, `tests/landscape-chrome.test.js`, `tests/system-back.test.js`, `tests/sync-foreground.test.js` (del 2 og del 6 kjører hvert sitt regime) og `tests/capacitor-android.test.js`. |
| Status — fase 4 | Fase 4s ferdigkriterium er **oppfylt**: en kjørende APK og en Vercel-preview bygget av samme commit rapporterte den samme `releaseId` (`d10867a7c0a6`) med hver sin `buildId`, lest på telefon. Alle sju punktene er avgjort. Fem er implementert: kartleggingen av dagens release-identiteter, `releaseId` er definert og generert i `build.js`, web og Android bygget fra samme commit rapporterer den samme verdien, `version.json` er utvidet additivt uten at cache- eller reload-sikkerheten er rørt, og kompatibilitetsregelen mellom klientrelease og databaseskjema er skrevet ned ([`release-og-deploy.md`](release-og-deploy.md)). De to siste er beslutninger, ikke kode — `minimumSupportedRelease` og valget mellom byte-identisk artifact og separate builds — sto åpne til OTA ga dem en konsekvens, og er nå avgjort i fase 5: ingen nedre grense, og separate builds med samme `releaseId` (se «De to punktene fra fase 4 får sitt svar her»). Automatisk dekket av `tests/build-version.test.js`, `tests/auto-update.test.js` og `tests/capacitor-android.test.js`. |
| Status — fase 5 | **Hele kjeden står i koden: pluginen/rollback-veien, den signerte bundelen med manifestet, hentingen — og nå OPPSTILLINGEN OG BYTTET.** En APK leser manifestet på URL-en skallets `getVersionCode()` bestemmer, validerer det ved systemgrensen, sammenligner `releaseId` med `===`, laster ned bundelen, spør karantenen, og stiller den opp med `setNextBundle()`. Bundelen tas i bruk ved neste kaldstart — eller med en gang, gjennom `LiveUpdate.reload()`, som går den samme veien som en vanlig nettleser-reload: `updateSafety()`, banneret, inaktivitetsregelen og ett-forsøk-vakten i `update-check.js`. Leddet som er lagt til der er **klargjøringen**: et mål er ikke reloadbart før nedlasting OG oppstilling har lykkes, en feilet klargjøring brenner ikke ett-forsøk-vakten, og banneret vises ikke før målet er stilt opp. Karantenen er varig og har to lag, begge fail closed: pluginens egen blokkliste (`autoBlockRolledBackBundles` er nå slått PÅ) er hovedvakten, og klientens egen liste i `localStorage` dekker det ene tilfellet den ikke kan — at prosessen dør mellom rollbacken og readiness-punktet (se «En rullet-tilbake bundle må være varig sperret»). `versionCode` er økt til `3` fordi konfigurasjonsfeltet pakkes inn i APK-en, og `OTA_MIN_VERSION_CODE` er hevet til `3` med det: et nivå 2-skall bærer web-kode som laster ned uten å stille opp, og ville fått lovet en oppdatering det aldri kan aktivere. Flyten er KJØRT i ekte nettleser med faket bro (`tests/ota-fetch.test.js`: oppstilling, karantene, fail closed-blokkliste, feilet oppstilling) og klargjøringen i `tests/auto-update.test.js`. **Ikke prøvd på enhet ennå:** de to punktene hente-runden gjorde målbare (nedlastingen utenfor WebView-ens CSP, og telefonens verifisering av produksjonssignaturen), og de tre oppstillingsrunden gjorde målbare for første gang (rollback av en bundle som aldri når `ready()`, `reload()` som beholder originet, og et bytte gjennom `updateSafety()`). Det siste ULØSTE i veien for økten er nå avgjort og bygget: en bevisst ødelagt bundle kan ikke publiseres på produksjonsveien, fordi OTA-bundelen ER produksjonsbuilden — rollback og karantene måles derfor på en MÅLERIGG med eget skall, eget nøkkelpar og egen vert (`.github/scripts/ota-rig.js`, «Den ødelagte bundelen kan ikke være en produksjonsrelease»). **Ingen av implementasjonspunktene i sjekklisten er krysset av ennå.** |
| Neste milepæl | Fase 5: første OTA-bundle som flytter en APK til samme `releaseId` som `huskis.no` |
| Neste praktiske steg — fase 3 | Ingen. Fasen er ferdig |
| Neste praktiske steg — fase 4 | Ingen. Fasen er ferdig; de to «vurder …»-punktene fikk sitt svar i fase 5 |
| Neste praktiske steg — fase 5 | En enhetsøkt mot en debug-APK bygget av `main` (`versionCode 3`), der manifestet navngir en SENERE release enn APK-en — ellers svarer klienten `same-release`. Rollback- og karantenepunktet måles i tillegg mot måleriggen («Slik bygger og kjører du målerigg-runden»). Fem punkter kan nå måles i én økt: `window.__huskis.otaFetch` (nedlastingen utenfor CSP-en + produksjonssignaturen), `window.__huskis.otaStage` (at bundelen faktisk ble stilt opp), en kaldstart som tar den i bruk, et `reload()` midt i økten som beholder `localStorage` og Supabase-sesjonen, og en bevisst ødelagt bundle som ruller tilbake og deretter havner i karantenen (`window.__huskis.otaBlocked`). Fortsatt åpent fra før: presis tidsmåling av kaldstart mot `readyTimeout`, og hva AAR-ene (`zip4j`, `okhttp`) merger inn i det bygde manifestet |
| OTA | Innført ende til ende i koden: pluginen, den signerte bundelen, manifestet per native nivå, hentingen, karantenen, oppstillingen og byttet. Ikke prøvd på en fysisk enhet ennå — ferdigkriteriet står derfor åpent |
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
- **OTA-løsningen er valgt**: `@capawesome/capacitor-live-update`, selvhostet og
  uten sky-konto. Kravene til signering, rollback, kanaler, staged rollout og
  butikkpolicy er vurdert i fase 5-seksjonen, som er autoritativ for
  begrunnelsen.
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
      Enhetsøkten med `chrome://inspect` ER nå kjørt, og den avgjorde det ene av
      de to spørsmålene: `navigator.onLine` er dødt uten `ACCESS_NETWORK_STATE`,
      og tillatelsen er lagt inn. Det andre står åpent og kom dårligere ut enn
      ventet: lytteren ble ikke bekreftet i noen av de tre rundene, og de to
      lange registrerte ingen synlighetsvending overhodet. Hullet er lukket i
      nettleseren, ikke observert lukket på enheten (se seksjonen).
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
timer, og `visibilitychange` finnes i WebView-en så vel som i browseren — målt,
med en runde tilskrevet lytteren på fysisk Android (seksjonen «Kjørt med
sonden»). Web-laget kjenner derfor fortsatt native-runtimen på nøyaktig ÉN gated
linje — broen for tilbakeknappen — og unntaket i
`tests/capacitor-android.test.js` er uendret. Det samme gjelder
npm-avhengighetslista og appmodulens `dependencies`-blokk: ingen plugin er
innført.

**Men lytteren rekker ikke inn i begge regimene, og det er målingens andre
funn.** Har Android fryst prosessen — observert fra 103 s i bakgrunnen og
oppover — snur synligheten mens prosessen står stille, og hendelsen blir aldri
levert. Da er det pollets forfalte tikk som starter runden, og det kommer ikke
5 s etter opptiningen: intervallet forfalt for lengst, så event-løkka kjører det
først av alt. De to leddene deler altså jobben etter hvor lenge appen var borte,
og ingen av dem dekker begge regimene alene.

| Ledd | Rolle |
|---|---|
| `visibilitychange`-lytteren (`app.js`, ved `startCloudPoll`) | Synlig igjen + innlogget ⇒ `scheduleCloud(0)`. Fyrer ikke på vei INN i bakgrunnen — en app som ligger i bakgrunnen skal ikke polle. Dekker regimet der prosessen lever. |
| pollet (5 s) | Sikkerhetsnettet mens appen er fremme, og det som tar nettet igjen der `online` aldri kommer — OG det eneste leddet som starter runden etter en frysing, siden hendelsen ikke leveres da. Guarden MÅ derfor lese `document.hidden` på tikket; et flagg satt av en synlighetslytter ville stått på «skjult» for alltid etter en frysing (`tests/sync-foreground.test.js`, del 6). |
| realtime | Uendret, og trenger ingen nudge: dør kanalen, melder den fra selv (`CLOSED`/`CHANNEL_ERROR` → ny subscribe), og pullen over dekker hullet imens. |
| `tests/sync-foreground.test.js` | Kjører begge regimene hver for seg. Del 2: med pollet slått AV henter appen inn det en annen enhet gjorde straks den er synlig. Del 6: speilvendt — synligheten snus UTEN at hendelsen leveres, slik en opptint prosess gjør det, og pollets tikk skal starte runden likevel. Del 4: en endring som ikke nådde fram lander av seg selv uten én eneste `online`-hendelse og uten at `navigator.onLine` noen gang er falsk, altså slik en WebView uten `ACCESS_NETWORK_STATE` oppfører seg. |
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

To spørsmål krevde derfor en egen enhetsøkt, og det ble den samme økten:
`chrome://inspect` mot debug-APK-en (Capacitor slår på WebView-debugging i
debugbygg).

| Spørsmål | Hva økten gjør |
|---|---|
| Lever `navigator.onLine` uten `ACCESS_NETWORK_STATE`? | Flymodus på; les `navigator.onLine` og `__huskis.syncStatus.snapshot()`. |
| Var det gjenopptakelsen som startet runden? | Runden må TILSKRIVES, ikke tidfestes: både pollet og realtime kan starte en runde i samme øyeblikk som appen kommer fram, så et lite tidsintervall beviser ingenting. Sonden under gjør realtime inert og merker hver runde med kilden sin (`by`). |

Sonden er den samme teksten `tests/sync-foreground.test.js` (del 5) henter ut av
dette dokumentet og kjører i en ekte nettleser, så den måler det den påstår og
velter ikke appen. Økten ER kjørt, og svarene står under «Kjørt med sonden: hva
enheten svarte». Oppskriften blir stående: den gjenbrukes ved etterkontroll og
på iOS i fase 7.

### Sonden: én innliming, begge spørsmålene

Lim inn i konsollen i `chrome://inspect` mot WebView-en, ETTER innlogging:

```js
window.__probe = window.__probe || (() => {
  const log = [], now = () => Math.round(performance.now());
  const add = (what, extra) => log.push(Object.assign({ t: now(), what }, extra || {}));
  const c = window.__huskis.client, rpc = c.rpc.bind(c), fetch0 = window.fetch.bind(window);
  let inResume = false, by = null;
  /* Realtime ut av bildet — og HOLDT ute. `removeAllChannels()` alene rekker
     ikke: den lukker kanalen, appen ser `CLOSED` og re-subscriber etter 4 s, og
     et `SUBSCRIBED` starter selv en runde. En inert kanal tar imot forsøket. */
  const dead = { on: () => dead, subscribe: () => dead, unsubscribe: () => Promise.resolve('ok'), teardown() {} };
  c.channel = () => dead;
  c.removeAllChannels();
  /* Kilden til runden, uten gjetting: capture på window fyrer FØR appens egen
     visibilitychange-lytter, bobling ETTER den. Alt appen planlegger imens er
     dermed gjenopptakelsens, og merket står mens timeren kjører — `cloudCycle()`
     kaller `get_my_doc` synkront, så runden merkes der den faktisk starter. */
  addEventListener('visibilitychange', () => { inResume = !document.hidden; add('visible', { visible: !document.hidden }); }, true);
  addEventListener('visibilitychange', () => { inResume = false; }, false);
  const st = window.setTimeout;
  window.setTimeout = function (fn) {
    if (!inResume || typeof fn !== 'function') return st.apply(window, arguments);
    const a = [...arguments];
    a[0] = function () { by = 'visibilitychange'; try { return fn.apply(this, arguments); } finally { by = null; } };
    return st.apply(window, a);
  };
  c.rpc = function (name) { add('rpc', { name, by: by || 'annet' }); return rpc.apply(null, arguments); };
  window.fetch = function (u) { add('fetch', { url: String((u && u.url) || u).slice(-48), by: by || 'annet' }); return fetch0.apply(null, arguments); };
  /* Alle kandidatene til «appen er fremme igjen», ikke bare den ene vi tror på:
     fyrer ikke `visibilitychange` på enheten, må loggen vise hva som DA kom. */
  ['focus', 'blur', 'pageshow', 'pagehide', 'online', 'offline'].forEach((n) => addEventListener(n, () => add(n)));
  ['freeze', 'resume'].forEach((n) => document.addEventListener(n, () => add(n)));
  /* Fryser Android prosessen, stopper timerne. Da er hoppet i seg selv et
     signal — og det eneste som finnes hvis ingen hendelse fyrer. */
  let tick = now();
  setInterval(() => { const n = now(); if (n - tick > 2500) add('timer-hopp', { stilleMs: n - tick }); tick = n; }, 1000);
  const meta = (n) => (document.querySelector('meta[name="huskis-' + n + '"]') || {}).content;
  const WAKE = ['visible', 'resume', 'pageshow', 'focus', 'timer-hopp'];
  return {
    log,
    net: () => ({ onLine: navigator.onLine, release: meta('release'), build: meta('build'),
                  channels: c.getChannels().length, sync: window.__huskis.syncStatus.snapshot() }),
    report: () => {
      let i = -1;
      log.forEach((e, n) => { if (WAKE.includes(e.what) && e.visible !== false) i = n; });
      const w = i < 0 ? null : log[i];
      const calls = (i < 0 ? log : log.slice(i + 1))
        .filter((e) => e.what === 'rpc' || e.what === 'fetch')
        .map((e) => ({ what: e.what, name: e.name, by: e.by, etterMs: w ? e.t - w.t : null }));
      return { wokeBy: w && w.what, wokeAt: w && w.t,
               sawVisible: log.some((e) => e.what === 'visible' && e.visible),
               by: calls.length ? calls[0].by : null,
               deltaMs: calls.length && w ? calls[0].etterMs : null,
               calls, tail: log.slice(-10) };
    },
    reset: () => { log.length = 0; tick = now(); },
  };
})();
```

| Kall | Gir |
|---|---|
| `__probe.net()` | `onLine`, hele synk-snapshotet, `channels` (skal være `0` hele økten) — og `release`/`build` fra meta-taggene, altså fase 4s avlesning i samme slengen |
| `__probe.report()` | `wokeBy`/`sawVisible`: HVA som meldte at appen er fremme igjen. `calls`: hver runde etter det, med `by` — hvem som startet den |
| `__probe.reset()` | tømmer loggen mellom rundene |

**Sonden endrer appen til du laster den på nytt:** realtime kommer ikke tilbake
i denne økten. Det er hele poenget — pollet dekker hullet imens, og en reload
gir alt tilbake.

**Q1 — lever `navigator.onLine`?** Slå PÅ flymodus med appen fremme, og kjør
`__probe.net()`. `onLine: true` med flymodus på betyr at flagget står permanent
sant, altså at Chromiums nettverksvarsling er død uten `ACCESS_NETWORK_STATE` —
og da fyrer `online`/`offline` aldri. Slå flymodus AV igjen og se på
`__probe.report().tail`: står det ingen `online`-hendelse der, er svaret
bekreftet fra to kanter. `sync` viser samtidig hvilken av de to kildene til
«Frakoblet» som gjelder (`offline`-flagget kontra `netFailures`).

**Q2 — var det gjenopptakelsen?** `__probe.reset()`, send appen i bakgrunnen,
vent (varier lengden: ti sekunder, ett minutt, ti minutter), hent den fram og
kjør `__probe.report()`. Gjenta tre ganger.

Svaret leses i TO trinn, og rekkefølgen er viktig — det andre trinnet betyr
ingenting hvis det første svarer nei:

1. **Kom signalet?** `sawVisible: true` ⇒ `visibilitychange` fyrte. `false` ⇒ den
   fyrte ikke, og da KAN ikke lytteren ha gjort jobben — uansett hva som ellers
   skjedde. `wokeBy` sier hva som da meldte fra i stedet (`timer-hopp` = ingen
   hendelse i det hele tatt, bare en timer som våknet).
2. **Hvem startet runden?** Les `by` i `calls`, ikke bare den første:
   `'visibilitychange'` ⇒ lytteren. `'annet'` ⇒ noe annet, og med realtime inert
   er det pollet. Står det et `annet`-kall FØRST og et `visibilitychange`-kall
   rett etter, vant pollets forfalte tikk kappløpet med noen millisekunder —
   lytteren virket likevel. Tom `calls` ⇒ ingen runde i det hele tatt, og da er
   hullet ikke lukket.

**Tid alene duger ikke her, og det er verdt å vite hvorfor.** Pollet står på
under målingen, akkurat som i vanlig bruk — og en strupet eller fryst timer har
ikke uniform fase: et forfalt 5-sekunderstikk kan bli kjørbart i samme øyeblikk
som appen kommer fram. Et lite `deltaMs` er derfor forenlig med BEGGE
forklaringene uansett hvor mange ganger det gjentas. `by` skiller dem; `deltaMs`
sier bare hvor raskt det gikk. Sjekk samtidig at `net().channels` fortsatt er
`0` — er den ikke det, har realtime kommet tilbake og runden kan være dens.

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

### Kjørt med sonden: hva enheten svarte

Økten er kjørt på fysisk Android, med realtime inert (`channels: 0` gjennom
hele) og pollet på, som i vanlig bruk. Begge spørsmålene er besvart.

**Q1 — `navigator.onLine` er død uten `ACCESS_NETWORK_STATE`.** I flymodus sto
flagget fortsatt på `true`, og det kom ingen `online`/`offline` i loggen da
flymodus ble slått av igjen. Chromiums nettverksvarsling er altså ute av drift i
WebView-en — nøyaktig slik pakken ble lest. Tiltaket er tatt: manifestet ber nå
om tillatelsen, voktet av `tests/capacitor-android.test.js`. Ingen av de tre
leserne eier data, så dette rydder i signalene; det flytter ingen invariant.

**Q2 — ja, lytteren starter runden. Men bare i det ene av to regimer.** Loggen
deler seg rent etter om Android hadde fryst prosessen eller ikke, og de to
halvdelene har hver sin startkilde:

| Fravær (målt fra loggen) | Kom `visible: true`? | Hva som startet runden |
|---|---|---|
| 2,6 s — prosessen levde | ja | `get_my_doc` merket `by: 'visibilitychange'`, 3 ms etter |
| 103 s / 305 s / 1264 s — prosessen fryst | nei, ingen synlighetsvending i det hele tatt | pollets forfalte tikk (`by: 'annet'`), som første linje etter stillheten |

Grensen mellom de to ligger et sted mellom 3 s og 100 s, og økten pinner den
ikke — den trengs ikke: begge sidene av den starter runden.

**Den korte runden er svaret på spørsmålet slik det ble stilt.** Et
`get_my_doc`-kall står i loggen med `by: 'visibilitychange'`. Det er ikke et
tidsintervall som også kunne vært pollets — det er kallets egen kallstack,
merket mens gjenopptakelsens `setTimeout` sto på. Lytteren VIRKER altså i
WebView-en, og det er observert, ikke utledet.

**De tre lange rundene viser regimet lytteren ikke rekker inn i.** Der står hele
loggen stille — 103, 305 og 1264 sekunder uten en eneste linje, altså en fryst
prosess, ikke en strupet timer — og første linje etter stillheten er et
`get_my_doc` merket `annet`. Ingen `visible`-linje ligger foran det. At runden i
det hele tatt kjørte, BEVISER at siden allerede sto som synlig da timerne tinte:
pollets guard leser `document.hidden` på tikket og hadde ellers returnert. Med
andre ord snudde synligheten mens prosessen sto stille, og hendelsen ble aldri
levert.

**Hullet er lukket, men av to ledd, ikke ett:**

| Regime | Lytteren | Pollet |
|---|---|---|
| Kort fravær, prosessen lever | starter runden (målt: 3 ms etter) | ville uansett tatt det innen 5 s |
| Langt fravær, prosessen fryst | fyrer ikke — hendelsen kommer aldri | starter runden som aller første handling etter opptiningen |

Det forfalte tikket venter ikke 5 s på tur: intervallet forfalt for minutter
siden, så event-løkka kjører det først av alt. Brukeregenskapen holder derfor i
begge regimene — og på telefonen er det lange fraværet det vanlige.

**Konsekvensen for koden er at begge ledd er bærende.** Pollet er ikke lenger
bare et sikkerhetsnett bak lytteren; i det frosne regimet er det den eneste
starteren. Det gjør guarden i `startCloudPoll` til en invariant: den må lese
`document.hidden` PÅ TIKKET. Skrives den om til et flagg en
`visibilitychange`-lytter setter — en nærliggende opprydding — står flagget på
«skjult» for alltid etter en frysing, og appen våkner aldri igjen. Del 6 av
`tests/sync-foreground.test.js` kjører nettopp den situasjonen: synligheten snus
uten at hendelsen leveres, og runden skal komme likevel.

**Det økten ikke svarer på, og hvorfor det ikke endrer noe:** hvilket signal —
om noe — Chromium leverer i stedet på opptiningen. Sonden som ble kjørt lyttet
bare etter `visibilitychange`, så loggen kan ikke si om `focus`, `pageshow` eller
`resume` kom. Oppskriften over lytter etter alle fire, så en senere økt kan svare
på det. Svaret ville uansett bare vært en snarvei: pollet starter allerede runden
i samme øyeblikk, så det finnes ikke noe hull et ekstra signal kunne lukket.

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
- [x] Vurder `minimumSupportedRelease` bare dersom et konkret behov oppstår;
      gammel klient skal ellers fortsatt fungere. **Vurderingen er gjort:
      innføres ikke nå, og regelen står ved lag** — det er additivt skjema og
      bakoverkompatibel backend som bærer den, mens OTA gjør den vanligste
      grunnen til å ønske seg en grense mindre sannsynlig. Grensen mobilen
      faktisk trenger går på butikkbinæren (`versionCode`) og innføres i
      fase 5. Det som er krysset av er VURDERINGEN, ikke en implementasjon.
- [x] Bestem om web og mobil skal motta samme byte-identiske webartifact eller
      separate builds med samme `releaseId`. Ikke endre dagens sikre
      migrering→smoke→Vercel-rekkefølge uten eksplisitt design og tester.
      **Avgjort i fase 5: separate builds med samme `releaseId`** — altså det
      de allerede er. Et byte-identisk artifact ville krevd en ny kobling
      mellom release-workflowen og web-deployen uten å svare på noe
      `releaseId` ikke allerede svarer på. Det som er krysset av er
      BESLUTNINGEN, ikke en implementasjon.

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

## Det `releaseId` ikke kan svare på

**En «minimum» er en ORDNING** — «denne og alle nyere» — og en commit-SHA har
ingen. `releaseId` er en identitet som sammenlignes med `===`, aldri med `>=`;
en test som `releaseId >= minimumSupportedRelease` ville vært meningsløs uansett
hvordan den ble skrevet. `builtAt` løser det heller ikke: den er byggets
tidspunkt, ikke releasens rekkefølge, og to bygg av samme release har
forskjellig verdi.

Det er denne egenskapen — og ikke et åpent spørsmål — som avgjorde de to siste
punktene i lista over. Ingen nedre støttet release innføres, og web og mobil får
separate builds med samme `releaseId`. Avveiningen som gjorde dem avgjørbare kom
med OTA og står i fase 5-seksjonen, «De to punktene fra fase 4 får sitt svar
her»; den er autoritativ for begge.

### Hvilken commit et artifact faktisk er bygget av

`releaseId` navngir commiten builden ER laget av. Det er en egenskap, ikke en
svakhet — identiteten kan ikke lyve om opphavet sitt — men den betyr at to
artifacts bare har samme `releaseId` hvis de er bygget av samme commit, og det
er de ikke alltid:

| Artifact | Bygger | Blir `releaseId` |
|---|---|---|
| Vercel-preview på en PR | grenas HEAD | grenas HEAD-commit |
| `android-debug.yml` på `pull_request` | GitHubs syntetiske MERGE-commit (`actions/checkout` sin standard der) | merge-commiten |
| `android-debug.yml` på `workflow_dispatch` | HEAD på refen som velges (observert: en manuell kjøring på denne grenen sjekket ut grenas HEAD og stemplet nettopp den) | den commiten |
| Produksjonsdeployen (`release.yml`) | `github.sha` på `main` | main-commiten |

Målt på denne planens egen PR: previewen rapporterte `0427d395315a`, mens
`huskis-debug-apk` rapporterte `9d0a7634a036`. Begge var riktige — de var to
forskjellige commits.

**Workflowen er med vilje ikke endret.** Å pinne APK-jobben til PR-headen ville
gjort de to automatiske artifactene sammenlignbare, men svekket det jobben
finnes for: den bygger og kjører `tests/capacitor-android.test.js` mot det som
faktisk lander etter merge. En sammenligning er ikke verdt en dårligere port.

**Konsekvensen for enhetssjekken:** de to artifactene må komme fra SAMME commit,
og det er to måter å få det på.

1. **Etter merge:** kjør `android-debug.yml` manuelt på `main` og sammenlign
   APK-en med `huskis.no`. Begge er da main-commiten.
2. **Før merge:** kjør `android-debug.yml` manuelt på grenen — et
   `workflow_dispatch` bygger refens HEAD, altså nøyaktig den commiten Vercel
   previewer — og sammenlign APK-en med preview-URL-en.

Den automatiske PR-kjøringen er ikke en av dem, og et avvik derfra er forventet.

### Lest ut av en kjørende APK — hva enheten svarte

Avlesningen er gjort på telefon, i en `chrome://inspect`-økt mot debug-APK-en,
mot en Vercel-preview bygget av SAMME commit:

| | APK (debug-APK fra `android-debug.yml`) | Web (Vercel-preview) |
|---|---|---|
| `releaseId` | `d10867a7c0a6` | `d10867a7c0a6` |
| `buildId` | `d10867a7c0a6-msve6nhe` | `dpl_73Rj6UV3Xk8WHnyzSw8TEmJhfGn9` |

Lik release, ulike bygg — og formen er den tabellen over beskriver: APK-en bærer
`build.js`' egen `<sha12>-<tid i base36>`, mens webklienten bærer Vercels
deploy-ID. Deploy-ID-en er altså `buildId` og bare det; `releaseId` er den samme
identiteten på begge plattformene. Det er nøyaktig det fasen finnes for.

*Verifisert i kjeden fra før:* at `node build.js` skriver den samme `releaseId` i
klienten og i `version.json`, at to bygg av samme commit får lik `releaseId` og
ulik `buildId`, og at oppdateringsmekanikken ikke reagerer på feltet.

*Verifisert i APK-workflowen, med ekte `cap sync`:* Androids halvdel er
kopisteget som legger `dist/` i `android/app/src/main/assets/public`. Det er
kjørt i CI, ikke bare lokalt: `android-debug.yml` kjører
`tests/capacitor-android.test.js` etter synkroniseringen, og der målte den at
kopien er byte for byte kilden (`index.html` modulo de to ID-ene), at den
innebygde `version.json` bærer release-ID-en, og at klienten i APK-en og den
innebygde `version.json` melder den samme releasen. APK-en er altså bygget og
pakket med identiteten inne.

**Ferdigkriterium:** web og mobil kan sammenlignes på én release-identitet uten
at Vercels deploy-ID misbrukes som produktversjon. **Oppfylt** — målt på en
kjørende APK mot en preview av samme commit (tabellen over).

De to siste punktene i lista er «vurder …»-punkter, og vurderingen ER gjort:
ingen `minimumSupportedRelease`, og separate builds med samme `releaseId`.
Grunnlaget står i «De to punktene, og svaret de fikk»; konsekvensen som gjorde
dem avgjørbare kom med OTA, og avveiningen står i fase 5-seksjonen.

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

**Valget er tatt:** `@capawesome/capacitor-live-update`, i selvhostet modus, uten
sky-konto. Kartleggingen, sammenligningen og prisen står under. Fire
implementasjonsrunder er innført: pluginen og rollback-veien uten at noen bundle
hentes, den signerte bundelen med manifestet — publisert av `release.yml` —
hentingen, og til slutt oppstillingen og byttet: karantenen, `setNextBundle()`,
klargjøringstilstanden i `update-check.js` og `LiveUpdate.reload()` gjennom
`updateSafety()` (seksjonen «Hva som er innført»). Kjeden er dermed hel i koden.
Ingen av punktene i implementasjonslista nederst er krysset av: det som gjenstår
av dem krever en enhetsøkt.

## Nåtilstanden: hva som allerede finnes, og nøyaktig hvor hullet er

Fire ledd er på plass fra før, og de er grunnen til at fase 5 er et lite lag og
ikke et nytt system:

| Ledd | Hva den allerede gjør | Hva OTA trenger av den |
|---|---|---|
| `updateSafety()` (`app.js`) | ett samlet, fail closed «er det trygt å bytte kode nå?» — bygget på tilstander appen allerede fører ([`auto-update.md`](auto-update.md)) | uendret. OTA skal SPØRRE den, ikke få sin egen |
| `update-check.js` | banner, inaktivitetsregel, ett-forsøk-vakt, poll og hendelser — alt med injiserte avhengigheter (`url`, `reload`, `isSafe`) | uendret mekanikk; native får en gren som bytter KILDE og RELOAD |
| `releaseId` | plattformuavhengig identitet på kilden, sammenlignet med `===` ([`auto-update.md`](auto-update.md)) | svaret på «kjører denne telefonen den releasen web kjører?» |
| `buildId` | eier cache og reload alene: `?b=`-URL-ene og sammenligningen i `update-check.js` | identiteten på selve bundelen, én per bygg |

**Hullet er målt, ikke antatt.** `dist/` ble bygget og servert på sitt eget
origin — nøyaktig APK-situasjonen, der `https://localhost` serverer den
innebygde kopien av den samme builden — og oppdateringsmotoren ble spurt hva den
så:

```json
{ "started": true, "klientBuildId": "62e80375b74c-msyfflyy",
  "serverBuildId": "62e80375b74c-msyfflyy", "checks": 2, "target": null,
  "reloads": 0, "banner": false, "safety": { "safe": true, "reason": "" } }
```

Motoren er altså ikke AV i appen. Den startet av seg selv, den utførte de to
kontrollene sonden ba om i stedet for å vente på oppstartstimeren, og
`updateSafety()` svarte `safe: true` — den var villig. Den fant bare ingenting,
fordi den målte seg mot seg selv: `noteBuild()` returnerer på `id === buildId`,
og i APK-en ER de to alltid like. Det er ikke en manglende funksjon; det er en
sammenligning uten motpart.

**Og web-laget kan ikke bare spørre `huskis.no` i stedet.** CSP-en står som
meta-tag i `index.html` og gjelder derfor også inne i APK-en. Målt i ekte
nettleser mot den bygde `dist/`:

```
Refused to connect to 'https://huskis.no/ota/android.json' because it violates
the following Content Security Policy directive: "connect-src 'self' https://bmky…"
```

Samme forespørsel mot eget origin gikk gjennom. Å hente et OTA-manifest fra
web-laget koster altså nøyaktig én ny vert i `connect-src`
([`sikkerhetsheadere.md`](sikkerhetsheadere.md)) — en pris, ikke en hindring,
men den skal stå her og ikke oppdages underveis.

Den prisen er nå betalt — verten står i begge policyene, og målingen er snudd
til en vakt: `tests/csp-enforced.test.js` viser at manifest-oppslaget slipper
ut mens en fremmed vert fortsatt blokkeres. Underveis viste prisen seg å ha en
tvilling CSP-målingen over ikke kunne se: lesningen er CROSS-ORIGIN
(`https://localhost` → `https://huskis.no`), så svaret må i tillegg bære en
CORS-header — uten den slipper forespørselen ut, men svaret blokkeres, like
stille, ett lag lenger ut. `Access-Control-Allow-Origin: *` står derfor på
nøyaktig manifest-stien i `vercel.json`; begrunnelsen og avgrensningen står i
[`sikkerhetsheadere.md`](sikkerhetsheadere.md), vakten i
`tests/release-pipeline.test.js`.

**Og repoet har to porter som er bygget for å stoppe en ny native
avhengighet.** `tests/capacitor-android.test.js` låser hvilke npm-pakker og
hvilke Gradle-avhengigheter som finnes, nettopp fordi et nytt bibliotek merger
sitt eget manifest inn i appens. De skal utvides bevisst, ikke omgås — nøyaktig
hva de sier fra om, står under «Prisen».

## Kartleggingen: hva som finnes av OTA for Capacitor

| Kandidat | Lisens/modell | Cap 8 | Selvhostet uten konto | Status |
|---|---|---|---|---|
| `@capawesome/capacitor-live-update` | MIT (plugin), sky valgfri | 8.4.0 | **ja** — `downloadBundle({url, bundleId, checksum, signature})` | **valgt** |
| `@capgo/capacitor-updater` | MPL-2.0 (plugin), sky valgfri | 8.51.13 | ja — `download({url, version, checksum, sessionKey})` | reell reserve |
| `@capacitor/live-updates` (Appflow) | `"license": "Commercial"` | 0.5.0 | nei — krever Appflow | **ute** |
| Egen Capacitor-plugin | — | — | ja | **ute** |
| Ikke gjøre noe (kun butikkrelease) | — | — | — | **ute** |

**Appflow er ute fordi den legges ned.** Pakken er fortsatt publisert (0.5.0,
februar 2026) og støtter Capacitor 8, men den er lisensiert `Commercial` og
virker bare mot Appflow, som etter Ionics egen kunngjøring slutter å levere
31\. desember 2027. Å bygge fase 5 på en tjeneste med kjent sluttdato ville vært
å planlegge to migreringer i stedet for én.

**Egen plugin er ute** fordi den koster mest der den er svakest: signaturvakt,
rollback-timer, atomisk bundlebytte og gjenoppretting av den innebygde
versjonen er akkurat den native koden som er dyrest å skrive riktig og umulig å
teste billig. To vedlikeholdte, kvitterte implementasjoner finnes.

**«Ikke gjøre noe» er ute** fordi fase 5 ER kravet: en telefon skal ikke måtte
vente på en butikkrunde for en tekstretting. Alternativet er ikke gratis — det
er arkitekturregel 7 som betaler, ved at eldre klienter blir stadig eldre.

### De to reelle: målt, ikke lest

Begge ble installert i en kopi av repoet og synkronisert med ekte
`npx cap sync android`. Forskjellen er ikke funksjonell — den er hvor mye de
drar med seg inn i APK-en:

| | Capawesome | Capgo |
|---|---|---|
| Eget `AndroidManifest.xml` | tomt | tomt (bare `<application>`) |
| Gradle-avhengigheter den drar inn | `zip4j`, `okhttp`, `okhttp-brotli`, `appcompat` | `androidx.work`, `lifecycle-process`, **`play-services-tasks`**, **`play:app-update`(+ktx)**, `guava`, `versioncompare`, `okhttp`, `brotli`, `appcompat` |
| Native metoder eksponert | 26 | 50 |
| Konfigurasjonsvalg | 9 | ~35 |
| Standard-endepunkter | ingen kontakt: `autoUpdateStrategy` er `"none"`, `appId` tomt | `plugin.capgo.app/updates`, `/channel_self`, `/stats` — tre URL-er som må overstyres for å bli selvhostet |

Capgo drar inn Google Play-tjenester og Play Core i en app som i dag ikke har
noen av delene. Det er ikke en feil ved Capgo — den er bygget for å gjøre mer,
inkludert butikkoppdateringer — men i Huskis er det et helt lag med merget
manifest som ingen har bruk for, i en app som ellers navngir hver eneste
utgående adresse. Og de tre standard-URL-ene betyr at selvhosting hos Capgo er
noe man må huske å slå PÅ; hos Capawesome er det der man starter.

## Valget mot de åtte kravene

**`@capawesome/capacitor-live-update`, selvhostet.** Bundelen er en signert
ZIP-fil Huskis lager selv; skyen brukes ikke, og det finnes ingen konto å ha.

| Krav | Hvordan det dekkes | Kilde |
|---|---|---|
| Signering/integritet | `Signature.getInstance("SHA256withRSA")` over selve filbytene, X.509-nøkkel fra `publicKey` i `capacitor.config.json`. **Fail closed**: er `publicKey` satt og signaturen mangler, kastes `ERROR_SIGNATURE_MISSING` — den faller ikke tilbake til checksum | lest i pluginens Java-kilde |
| Innebygd kjent-god fallback | `reset()` går tilbake til bundelen som ble pakket i binæren | dokumentert + kilde |
| Rollback ved mislykket oppstart | rollback-timeren armeres i pluginens konstruktør og avvæpnes av `ready()`; `readyTimeout` styrer fristen | lest i kilden |
| Kanaler/staged rollout | selvhostet er kanalen manifest-URL-en, og utrulling en andel i manifestet som enheten avgjør mot sin egen `getDeviceId()`. Pluginen har også kanaler og rollout — de hører til skyen, og brukes ikke | dokumentert |
| Skille web/native | pluginen bytter KUN de utpakkede web-assetene; native kode og plugins ligger i binæren og kan bare endres gjennom butikken | dokumentert + kilde |
| App Store/Play | Play forbyr nedlastet kjørbar kode (dex/JAR/.so), men unntar eksplisitt kode som kjører i en tolk med indirekte tilgang til Android-API-ene — JavaScript i en WebView. Apples DPLA tillater tolket kode så lenge den ikke endrer appens primære formål eller omgår App Review | Play-policyen og Apples avtaletekst |
| Automatisering fra Actions | bundelen er en ZIP og en JSON. `release.yml` bygger og signerer den på den samme `github.sha` som migreres, smoke-testes og deployes | følger av dagens kjede |
| Leverandørlåsing/driftskostnad | MIT, ingen konto, ingen regning. Låsingen er formatet på ett `downloadBundle`-kall — bytter vi plugin, byttes kallet, ikke bundelen | npm + kilde |

Skyprisene ble ikke avgjørende, siden ingen av dem skal betales: Capgo oppgis
fra ~12 USD/mnd og Capawesome fra ~9 USD/mnd. Begge prissidene er blokkert av
utgående proxy i denne økten, så tallene er lest ut av søketreff og ikke
verifisert mot kilden — de er tatt med for fullstendighet, ikke som grunnlag.

## Prisen, eksplisitt

**Den ville prisen — en bundler — betales ikke.** Det var det åpne spørsmålet:
en Capacitor-plugin brukes normalt som `import { LiveUpdate } from '…'`, og en
`import` i `app.js` ville krevd nettopp det Huskis ikke har. Den veien trengs
ikke. Capacitors Android-bro GENERERER og injiserer JS-en som legger hver
registrerte native plugin på `window.Capacitor.Plugins['<id>']`, med én funksjon
per `@PluginMethod` (`JSExport.getPluginJS()` i `@capacitor/android`). Etter
`cap sync` sto `LiveUpdatePlugin` i den genererte
`android/app/src/main/assets/capacitor.plugins.json`, og pluginen eksponerer 26
native metoder. Web-koden når dem gjennom nøyaktig den samme vakten som
tilbakeknappens bro allerede bruker — `window.Capacitor` finnes ikke i en
nettleser, og da kjører ingenting av det. **Ingen bundler, ingen import, ingen
klientavhengighet i webappen.**

Det som faktisk koster:

| Pris | Hva den er | Hvor den betales |
|---|---|---|
| En fjerde npm-pakke | `@capawesome/capacitor-live-update`, pinnet eksakt. Den er byggeinput for det native skallet, aldri en web-asset — `SKIP`-listen i `build.js` holder `package.json` og `node_modules/` ute av `dist/` som før | `package.json`, lockfila |
| To låser må utvides | målt: en kopi av repoet med pluginen installert og synkronisert gir **134/136** i `tests/capacitor-android.test.js`, mot **129/129** uten. Nøyaktig to navngitte sjekker faller: «ingen andre npm-avhengigheter enn de tre Capacitor-pakkene» og «de applierte Gradle-skriptene legger ikke til avhengigheter». Ingen annen sjekk rører seg — heller ikke `server.url`, den synkede kopiens byte-likhet eller release-ID-ene | `tests/capacitor-android.test.js` |
| Native tredjepartskode i APK-en | `zip4j` og `okhttp`/`okhttp-brotli`. Pluginens eget manifest er tomt; hva AAR-ene merger inn er ikke lest ut av selve arkivene, og skal etterprøves på det bygde manifestet | `android/` |
| Én ny vert i CSP, og CORS på manifest-stien | `connect-src` navngir `https://huskis.no`, slik at web-laget kan lese OTA-manifestet fra appens origin — i browseren er verten allerede `'self'`, så tillegget endrer ingenting der. Og fordi lesningen er cross-origin inne i APK-en, svarer `/ota/android/*` med `Access-Control-Allow-Origin: *`: offentlige, ukredensierte data | `index.html`, `vercel.json`, [`sikkerhetsheadere.md`](sikkerhetsheadere.md) |
| Et definert readiness-punkt | `ready()` MÅ kalles hver gang appen starter, ellers ruller rollback-timeren tilbake. Timeren armeres i pluginens konstruktør, også når appen kjører den innebygde bundelen. HVOR kallet står er hele vakten, ikke en detalj — se «Readiness-punktet» | web-koden, bak native-vakten |
| Én signeringsnøkkel | privatnøkkelen er en Actions-secret og forlater aldri runneren; den offentlige står i `capacitor.config.json` og pakkes i APK-en | GitHub-secrets |

Signaturen kan lages med Nodes standardbibliotek alene
(`crypto.createSign('sha256')` over ZIP-bytene, base64) — pluginens verifisering
er ren `SHA256withRSA`, uten noe leverandørformat i mellom. Byggesteget får
altså ingen avhengighet.

## Readiness-punktet — den ene linjen som ER rollback-vakten

`ready()` avvæpner rollback-timeren. Kalles den for TIDLIG, er vakten borte: en
bundle som laster scriptene, kaller `ready()` og deretter feiler i initen blir
godkjent, og pluginen ruller den aldri tilbake. Kalles den for SENT, ruller en
fungerende bundle tilbake fordi kaldstarten var treg. Plasseringen er derfor
ikke «en linje ved oppstart» — den er selve definisjonen av «denne bundelen
virker».

**Punktet skal ligge etter at appen faktisk er brukbar, og det skal ikke
avhenge av nettet.** Det andre kravet er like hardt som det første: venter
`ready()` på et svar fra serveren, blir en offline kaldstart umulig å skille fra
en ødelagt bundle, og pluginen ruller tilbake en bundle som virker. Det ville
brutt punktet «tåle offline oppstart» i lista nederst.

Huskis har et signal som oppfyller begge: **første brukbare skjerm malt fra
lokal tilstand** — innloggingsskjermen for en utlogget bruker, brettet fra
`localStorage` for en innlogget. Begge nås uten nettverk; `updateSafety()` har
allerede `sync-unknown` for tilstanden «innlogget, men serveren har ikke svart
ennå», altså er det en tilstand appen kjører i, ikke en feil. Det er sent nok
til at en bundle som feiler i initen aldri kommer dit, og tidlig nok til at det
skjer uten nett.

To ting må måles på enhet før punktet kan kalles ferdig: at en bundle som feiler
ETTER at scriptene er lastet, men før skjermen er brukbar, faktisk blir rullet
tilbake — og at `readyTimeout` har margin nok for en treg kaldstart på ekte
maskinvare.

## Hva som er innført: hele kjeden, i fire steg

Koden er fire steg forbi valget, og alle er med vilje små nok til å kunne måles
hver for seg.

**Første steg: pluginen og rollback-veien.** Pluginen finnes, rollback-timeren
er PÅ, og ingenting henter en bundle. Da kan rollback-mekanikken måles før det
finnes et bundlebytte å feile i — og feiler den, feiler den mot den innebygde
bundelen, som allerede kjører. Pluginens egen `rollback()` skriver da bare
«Default bundle is already in use» og gjør ingenting.

**Andre steg: den første signerte bundelen og manifestet.** `release.yml`
bygger, signerer og publiserer dem. Steget ble tatt tidlig med vilje, av to
grunner — det var det minste som ga noe å måle, og det var det eneste med en
menneskelig avhengighet (nøkkelparet), som derfor ikke skulle ligge sist.

**Tredje steg: hentingen — uten å bytte.** Den første gangen web-laget får
adgang til noe utenfor sitt eget origin: CSP-verten (med CORS-tvillingen), og
`fetchOtaBundle()` i `app.js`, som leser manifestet på URL-en skallets
`getVersionCode()` bestemmer og laster ned en annen release med
`downloadBundle()`. Bundelen ble liggende ubrukt til steget etter stilte den
opp — og nettopp derfor var en feil der gratis: appen kjørte videre på den
bundelen den hadde, og hvert utfall var et stille no-op som kun syntes i
`window.__huskis.otaFetch`.

**Fjerde steg: stille opp og bytte.** Karantenen spørres, `setNextBundle()`
stiller bundelen opp, og `update-check.js` får sitt ene nye ledd —
klargjøringen — før den bytter med `LiveUpdate.reload()` gjennom de samme
vaktene en nettleser-reload alltid har gått gjennom. Det er her en bundle for
FØRSTE gang kan feile ved oppstart, og derfor også her rollback-timeren og
karantenen kan prøves i praksis.

| Ledd | Hva som står der nå |
|---|---|
| npm | `@capawesome/capacitor-live-update` 8.4.0, pinnet eksakt, i `dependencies` — ikke `devDependencies`: koden pakkes inn i APK-en, i motsetning til `@capacitor/cli`, som bare kjører på byggemaskinen |
| `capacitor.config.json` | `LiveUpdate`-blokken med `readyTimeout: 10000` (standardverdien er `0`, og `0` betyr at automatisk rollback er AV), `autoUpdateStrategy: "none"` og `autoBlockRolledBackBundles: true`. Ingen `appId`, `defaultChannel` eller `serverDomain`: pluginen har ingen adresse å kontakte, og kontakter derfor ingenting av seg selv |
| `app.js` (readiness-punktet) | `markAppReady()` kaller `LiveUpdate.ready()` bak `nativeShell` — den samme gaten tilbakeknappens bro bruker. Kallstedene er de brukbare skjermene: `cloudStart()` rett etter at board-et er brettet fra `localStorage`, og `initAccounts()` når innloggingsskjermen står malt — også i grenen der Supabase mangler og skjermen er alt appen har å vise. Ingen av dem ligger etter noe som venter på serveren. Funksjonen er idempotent — første vei vinner, og et kontobytte senere i økten er ikke en ny oppstart. `window.__huskis.appReady` blir først `true` når `ready()` faktisk har RESOLVERT (eller når det ikke finnes noe native-kall å vente på); en avvist promise fanges i `window.__huskis.liveReadyError` i stedet for å telle som avvæpnet (PR-review #134, punkt P1) |
| `app.js` (hentingen) | `fetchOtaBundle()`, kalt én gang ved oppstart, bak den samme gaten: bygger `<canonicalAppUrl()>ota/android/<getVersionCode()>.json` (nivået er en STRENG — ingen tallparsing), gjør nøyaktig ETT `fetch(…, {cache: 'no-store'})`, validerer svaret ved systemgrensen (`validOtaManifest`: form og typer på `releaseId`/`bundleId`/`url`/`signature`, `url` låst til det kanoniske originet, `versionCode` som selvkontroll), sammenligner `releaseId` med `===` mot `<meta name="huskis-release">`, og kaller `downloadBundle({url, bundleId, signature})` — uten `checksum`, som pluginen bare sjekker når `publicKey` ikke er satt. 404, nettverksfeil, ugyldig manifest og avvist nedlasting er alle stille no-op; utfallet står i `window.__huskis.otaFetch` for enhetsøkten. En bundle som alt ligger i pluginens lager skilles ut som `already-downloaded` og ikke som en feil — se «En allerede hentet bundle er ikke en feilet nedlasting». Manifestets `bundleId` meldes samtidig inn til `update-check.js` som mål-build: inne i appen er `/version.json` klientens egen, innebygde kopi, så motoren kan bare finne seg selv |
| `app.js` (karantenen) | `noteRollback()` leser `ready()`-svaret og fører en rullet-tilbake `bundleId` i en VARIG liste (`localStorage`, `huskis:ota-blocked`). `otaBlockedBundle()` spør både den listen og pluginens egen `getBlockedBundles()` FØR oppstillingen, og er fail closed: kan ingen av dem leses, stilles ingenting opp |
| `app.js` (oppstillingen og byttet) | `prepareOtaBundle()`: karantene → nedlasting (eller en bundle som alt ligger i lageret) → `setNextBundle({bundleId})`. `prepareUpdate()`/`applyUpdate()` er de to krokene `update-check.js` slår opp på `window.__huskis`; `applyUpdate()` kaller `LiveUpdate.reload()` KUN når en bundle faktisk er stilt opp, ellers `location.reload()` |
| `update-check.js` | klargjøringen: et mål er ikke reloadbart før `prepare` har svart ja. En feilet klargjøring brenner ikke ett-forsøk-vakten og prøves igjen ved neste kontroll; banneret vises først når målet er klart, og «Oppdater nå» går utenom trygghetsvakten, men ikke utenom klargjøringen. Reloaden er sen-bundet på samme måte ([`auto-update.md`](auto-update.md)) |
| `index.html` + `vercel.json` (CSP) | `https://huskis.no` i `connect-src`, i BEGGE policyene — meta-taggen er den som gjelder inne i APK-en. Og CORS-headeren på manifest-stien, siden lesningen er cross-origin fra `https://localhost` ([`sikkerhetsheadere.md`](sikkerhetsheadere.md)) |
| `tests/capacitor-android.test.js` | de to låsene som måtte utvides, pluss invariantene: at `LiveUpdate`-blokken finnes, at `readyTimeout` er positiv, at `autoUpdateStrategy` ikke er slått på, at `autoBlockRolledBackBundles` ER slått på, at ingen sky-felter er satt, at `ready()` står bak gaten og kalles fra begge skjermene, at `appReady` ikke settes før promisen er avgjort. Og de to native halvdelene av signeringen: at `versionCode` er over `2` (feltet over pakkes inn i APK-en), og at `publicKey` er en RSA-nøkkel som overlever PLUGINENS egen parsing — base64 uten PEM-hoder, lest som `X509EncodedKeySpec`. Fra hente-runden: at broen kalles med kun de seks kjente metodene, at hentingen står bak gaten, at URL-en bygges av `canonicalAppUrl()` + `versionCode` uten tallparsing, ett `fetch` med `no-store`, validering før bruk, `===` mot meta-taggen, og `downloadBundle` uten `checksum`. Fra oppstillingsrunden: at `downloadBundle`/`setNextBundle`/`reload` hver kalles fra nøyaktig ETT sted, at karantenen spørres FØR `setNextBundle` og er fail closed, at «klargjort» dekker en bundle som alt ligger i lageret, at rollback føres i en VARIG liste, at `live.reload()` bare kalles når noe faktisk er stilt opp — og at `update-check.js` fortsatt ikke kjenner et eneste pluginnavn: at ett-forsøk-vakten kun skrives i `autoReload()`, at `evaluate()` returnerer før alt annet når målet ikke er klargjort, og at banneret kun vises fra klargjøringens ja-gren |
| `tests/ota-fetch.test.js` | flyten KJØRT i ekte nettleser, med broen faket slik skallet injiserer den og manifest-URL-en rutet: i nettleser skjer ingenting; 404 og nettverksfeil er stille no-op med nøyaktig ett oppslag på riktig URL; ugyldige manifester (ikke-JSON, fremmed `url`-vert, feil `versionCode`) stopper ved systemgrensen; lik `releaseId` laster ingenting; ulik `releaseId` gir nøyaktig ett `downloadBundle` med nøyaktig de tre feltene, og deretter ett `setNextBundle` med manifestets `bundleId` — etter at karantenen er spurt. En avvist nedlasting stiller ingenting opp; `ERROR_BUNDLE_EXISTS` leses som `already-downloaded` og stilles LIKEVEL opp; en blokkert `bundleId` lastes ikke engang ned; en blokkliste som ikke kan leses er også et nei; en feilet oppstilling er stille. Ingenting kaller `reload()` av seg selv |
| `tests/auto-update.test.js` | klargjøringen KJØRT i ekte nettleser med injisert `prepare`: et uklargjort mål gir verken banner eller reload og brenner ikke ett-forsøk-vakten, en feilet klargjøring prøves igjen ved neste kontroll, en vellykket klargjøring viser banneret og gjennomfører reloaden med nøyaktig ett registrert forsøk, og «Oppdater nå» laster ikke noe som ikke er stilt opp — men gjennomføres straks klargjøringen har lykkes |
| `android/app/build.gradle` | `versionCode 3` — økt fordi `autoBlockRolledBackBundles` pakkes inn i APK-en. Tallet ER kompatibilitetsgrensen (se under) |
| `.github/scripts/ota-bundle.js` | pakker `dist/` til `ota/bundles/<buildId>.zip`, signerer ZIP-bytene (`crypto.createSign('sha256')`, base64), VERIFISERER signaturen mot den innebygde `publicKey` før noe skrives, og skriver ett manifest per støttet nivå. Ren Node — `fs`, `path`, `crypto`, `child_process` — så byggesteget får ingen avhengighet |
| `.github/workflows/release.yml` | steget kjører i deployjobben, altså bak `needs: smoke`, på den samme `github.sha` som ble migrert og smoke-testet, og legger utdataene i treet FØR `vercel deploy`. `OTA_MIN_VERSION_CODE` står i workflow-env som det laveste native nivået bundelen støttes i, og er `3` (se under). Mangler `OTA_SIGNING_KEY`, stopper releasen — den publiserer ikke en bundle ingen kan verifisere |
| `vercel.json` | `/ota/android/*.json` → `no-store` (manifestet navngir bundelen som gjelder NÅ), `/ota/bundles/*.zip` → `immutable` (build-ID-en står i navnet) |
| `tests/release-pipeline.test.js` | at rekkefølgen holder, at bundelen bygges før opplastingen, at grensen er over `1` og ikke høyere enn skallet, at `ota/` faktisk publiseres — og signaturen KJØRT: nøkkelparet lages i testen, hele veien zip → signatur → verifisering går gjennom, og en endret byte, feil nøkkel eller et nøkkelpar som ikke henger sammen må gi et NEI |

Gaten i `app.js` er fortsatt gaten, men den er nå to linjer i stedet for én:
`isNativePlatform()`-spørsmålet, og oppslaget av `window.Capacitor.Plugins` BAK
svaret på det. Testen låser begge — at det er nøyaktig to linjer, hva hver av
dem gjør, og hvilke fire steder pluginbroen brukes.

**Ingen kodesteg gjenstår.** Det som gjenstår av fase 5 er å prøve kjeden på en
fysisk telefon: en bundle kan nå feile ved oppstart, og derfor kan
rollback-timeren, karantenen og byttet endelig måles i praksis (seksjonen «Hva
som krever en enhetsøkt»).

### Nøkkelparet: hvor de to halvdelene bor, og hvorfor de aldri møtes

Ett RSA-nøkkelpar, delt i to som aldri ligger samme sted:

| Halvdel | Hvor den bor | Hva som skjer hvis den er feil |
|---|---|---|
| privat | GitHub-secreten `OTA_SIGNING_KEY` (PKCS#8 PEM). Leses ETT sted i `ota-bundle.js`, som miljøvariabel, og skrives aldri ut | mangler den, stopper releasen. Ingen usignert bundle publiseres |
| offentlig | `publicKey` i `capacitor.config.json`, pakket inn i APK-en | passer den ikke privatnøkkelen, kan ingen telefon verifisere bundelen |

Den andre raden er den farlige: feltet kan ikke endres uten en ny butikkbinær,
så et nøkkelpar som ikke henger sammen ville stått uoppdaget helt til en telefon
avviste bundelen — og pluginen er fail closed nettopp her, den faller ikke
tilbake til checksum. Derfor VERIFISERER byggesteget sin egen signatur mot den
innebygde nøkkelen før det skriver et eneste manifest. Er de ikke to halvdeler
av samme par, feiler releasen med den setningen som forklaring.

Nøkkelen er lest maskinelt på begge måter den kan bli lest: som PEM av Node, og
som base64 uten PEM-hoder inn i en `X509EncodedKeySpec` — nøyaktig linjene i
`LiveUpdate.java`. En nøkkel på et annet format (PKCS#1, DER-fil, OpenSSH-linje)
ville sett riktig ut i konfigurasjonen og feilet på telefonen.

### `versionCode` er kompatibilitetsgrensen — derfor kunne den ikke bli stående på 1

Den står på `3`. Capacitor-malens `1` kunne ikke brukes, og grunnen er ikke at
`1` er et lavt tall: en APK bygget FØR OTA-pluginen og en bygget ETTER er native
forskjellige — den ene har pluginen, den andre ikke — men begge meldte
`versionCode 1`. En grense på `1` ville sluppet inn begge. Nå faller alle
`versionCode 1`-skall utenfor OTA uansett hvilket av dem det er, som er riktig
svar: ingen av dem er bygget for å hente en bundle.

Fra og med nå har tallet en jobb, og prisen er at det MÅ økes når det native
skallet endres. Repoet holder to tall som må stemme overens, og
`tests/release-pipeline.test.js` sjekker forholdet mellom dem:

- `versionCode` i `android/app/build.gradle` — skallet som bygges nå;
- `OTA_MIN_VERSION_CODE` i `release.yml` — det LAVESTE skallet denne
  web-bundelen fortsatt virker i. Manifestet skrives for hvert nivå i spennet
  mellom de to, så et eldre skall som fortsatt er innenfor får OTA, og et som
  faller utenfor får 404.

**`versionCode` gikk fra `2` til `3` i oppstillingsrunden**, av nøyaktig den
grunnen: `autoBlockRolledBackBundles` kom inn i `capacitor.config.json`, og
konfigurasjonen pakkes inn i APK-en. Et skall med karantenen på og ett uten er
native forskjellige, og kan derfor ikke melde det samme nivået.

**`OTA_MIN_VERSION_CODE` ble hevet til `3` i den samme runden**, og
avveiningen der er verdt å skrive ned, fordi et første utkast satte den til `2`
på et resonnement som ikke holdt. Det lød: web-koden bruker bare metoder
pluginen har i begge nivåer, så bundelen VIRKER i et nivå 2-skall. Det er sant
om pluginen og likevel feil om utfallet, og kodegjennomgangen av PR #137 fant
hvorfor.

**Grensen avhenger av web-koden som ALLEREDE KJØRER i skallet, ikke bare av
hva pluginen kan.** Et `versionCode 2`-skall bærer web-koden fra hente-runden.
Den laster ned bundelen og stopper der — den kaller aldri `setNextBundle()`.
Koden som kan stille opp ligger inne i bundelen, og hjelper derfor ikke: den
kommer aldri til å kjøre, fordi ingenting tar bundelen i bruk. Et manifest på
nivå 2 ville altså lovet en oppdatering som aldri kan aktiveres — en
nedlasting i evig løkke, ett stille no-op per kaldstart.

Regelen som følger, og som gjelder for hver senere runde: **det laveste
støttede nivået er det laveste skallet som kan TA I BRUK en bundle**, ikke det
laveste skallet der pluginen har metodene. Nivå 3 er det første skallet som
bærer oppstillingen, og grensen står derfor der.

Prisen er at debug-APK-ene fra de tre første rundene faller utenfor OTA. Det
koster ingenting: en debug-APK bygget av DENNE runden er nivå 3, og den måler
alt de eldre kunne målt — inkludert de to punktene hente-runden gjorde
målbare — pluss oppstillingen, byttet og rollbacken, som bare den kan måle.

Det maskinen ikke kan svare på ennå er om noen GLEMTE å øke `versionCode` da
skallet ble endret; testene ser bare det som står der nå. Skulle det bli et
reelt problem, er svaret en innsjekket historikk av par (`versionCode`,
fingeravtrykk av de native kildefilene): et endret fingeravtrykk uten et nytt
nivå er da en rød test. Det er ikke bygget nå — det ville vært en mekanisme uten
en observert feil bak seg.

Fase 6 eier fortsatt det samme tallet som BUTIKKENS krav (monotont økende per
opplasting). Det er en annen bruk, og den kommer i tillegg.

### Hva manifestet inneholder

```json
{
  "releaseId": "9f191b3ea1b6",
  "bundleId": "9f191b3ea1b6-msyntpx6",
  "versionCode": 2,
  "url": "https://huskis.no/ota/bundles/9f191b3ea1b6-msyntpx6.zip",
  "signature": "<base64, SHA256withRSA over ZIP-bytene>",
  "commit": "9f191b3ea1b6933dc69a9fde4687ffdb550a45f0",
  "builtAt": "2026-08-18T12:49:43.290Z"
}
```

`releaseId` er signalet klienten sammenligner med sin egen
`<meta name="huskis-release">`; `bundleId` er `buildId` under det navnet
`downloadBundle()` bruker. `versionCode` gjentar nivået filen ER for — ikke som
vakten (den er URL-en), men som en selvkontroll: klienten kan slå fast at filen
den fikk er filen den ba om. `url` er absolutt fordi nedlastingen skjer i NATIV
kode; en rot-relativ sti ville pekt på `https://localhost` inne i appen.

**Ingen `checksum`.** Lest i pluginens kilde: feltet sjekkes kun i `else`-grenen
når `publicKey` IKKE er satt. Et checksum-felt ved siden av signaturen ville
påstått en kontroll som aldri kjører.

## Slik er løsningen tenkt å henge sammen

Fire ledd, med hvert sitt regime — og `updateSafety()` eier fortsatt det ene
spørsmålet den alltid har eid, uendret:

```text
0. AVVIS      manifestet finnes på én URL PER native nivå. Telefonen ber om
              sitt eget (`…/android/<versionCode>.json`); finnes det ikke,
              svarer serveren 404 og INGENTING skjer — verken download eller
              set. Vakten er altså URL-en, ikke en sammenligning i klienten.
1. HENTE      downloadBundle({url, bundleId, signature}) — native nedlasting,
              rører ikke klienten som kjører. Alltid trygt.
2. STILLE OPP setNextBundle() — bundelen tas i bruk ved neste kaldstart.
              Kaldstart er trygt av seg selv: ingen usikret arbeid i lufta.
              FØRST når 1 og 2 har lykkes er målet «reloadbart».
3. BYTTE NÅ   LiveUpdate.reload() — dette ER en reload midt i en økt, og går
              derfor gjennom updateSafety(), banneret, inaktivitetsregelen og
              ett-forsøk-vakten i update-check.js. Uendret regel, ny reload.
```

**Steg 0–2 er et nytt ledd i `update-check.js`, ikke en byttet avhengighet.**
Motoren gikk før rett fra «jeg så en annen build-ID» til `reload()`: `check()`
gjorde fetch → `validBuildId()` → `noteBuild()`, og `autoReload()` kalte
`reload()` uten noe imellom. På native ville det betydd en
`LiveUpdate.reload()` på en bundle som verken er lastet ned eller stilt opp —
altså en reload av nøyaktig den koden som allerede kjører.

Leddet står nå der: en eksplisitt, asynkron **klargjøringstilstand** mellom
`noteBuild()` og `evaluate()`. Et mål er ikke reloadbart før nedlasting og
`setNextBundle()` har lykkes, og begge de to fail closed-reglene som følger av
det er av samme slag som resten av modulen:

- **En feilet klargjøring brenner ikke ett-forsøk-vakten.** `markAttempt()`
  skrives rett før reloaden, og en oppbrukt vakt er permanent for den
  mål-builden i den fanen. Klargjøringen kan derfor feile og prøves igjen ved
  neste kontroll uten å koste forsøket.
- **Banneret lover ikke noe som ikke er klart.** Det vises først når
  klargjøringen har lykkes. «Oppdater nå» går utenom trygghetsvakten med vilje
  — brukeren har bedt om det selv — men ikke utenom klargjøringen: er bundelen
  ikke stilt opp, settes klargjøringen i gang, og reloaden skjer når den har
  lykkes.

Det browser-laget beholder uendret er avgjørelsen: `updateSafety()`, banneret,
inaktivitetsregelen og ett-forsøk-vakten er de samme. Arkitekturregel 8 handler
om at trygghetsvurderingen ikke dupliseres, og den holder — fasen la til et
ledd, den byttet ikke bare to felt.

**Og målet må komme et annet sted fra i native.** Motoren måler seg mot
`/version.json` på sitt eget origin, og inne i APK-en ER den klientens egen,
innebygde kopi: den kan bare finne seg selv. Manifestet er den eneste kilden
som vet at det finnes en nyere release, og det er `app.js` som leser det.
`fetchOtaBundle()` melder derfor bundelens ID inn til motoren
(`HuskisUpdate.instance.noteBuild()`) når manifestet navngir en annen release.
Det er ett signal, ikke en avgjørelse: klargjøringen, `updateSafety()`,
banneret, inaktivitetsregelen og ett-forsøk-vakten ligger fortsatt i motoren
alene, og `bundleId` er den identiteten ett-forsøk-vakten teller på — samme
rolle `buildId` har i nettleseren.

### Hvor hente-koden bor — valgt: `app.js`, bak gaten

Valget måtte tas av runden som skrev hentingen, slik manifestformen ble valgt
av runden som publiserte det første manifestet. To plasser var aktuelle:

| Plass | Kobling | |
|---|---|---|
| Frittstående funksjon i `app.js` (`fetchOtaBundle()`), bak `nativeShell`-gaten, kalt én gang ved oppstart | ingen ny: gaten, pluginbroen og `canonicalAppUrl()` finnes der fra før, og `update-check.js` røres ikke | **valgt** |
| Et nytt ledd i `update-check.js` sin `check()` | broen, gaten og manifest-URL-en måtte vært injisert — og instansen auto-opprettes FØR `app.js` kjører, så injeksjonen hadde krevd at `app.js` konstruerte motoren på nytt. Capacitor-kunnskap i en fil til | ute |

Tre målbare grunner avgjorde:

- **testlåsene peker dit.** `tests/capacitor-android.test.js` feiler på en
  Capacitor-referanse i enhver annen web-kildefil enn `app.js`, og på en
  absolutt URL i `update-check.js`. Begge låsene er riktige, og begge ville
  måttet svekkes for det andre alternativet;
- **runden skal ikke røre ett-forsøk-vakten eller banneret.** Null endring i
  `update-check.js` gjør det trivielt sant;
- **hentingen er ETT fetch per oppstart, ikke en poll.** `check()` fyrer hvert
  tiende minutt og på synlighet/fokus/online, og et ledd der ville arvet den
  rytmen.

Setningen «steg 0–2 er et nytt ledd i `update-check.js`» står fortsatt — den
handler om KLARGJØRINGSTILSTANDEN, som dekker nedlasting og oppstilling
sammen. Formen ble gitt av motorens eget mønster: alt i `update-check.js` er
injiserte avhengigheter (`url`, `reload`, `isSafe`), og de to nye krokene
(`prepare` og reloaden) slås opp på `window.__huskis` ved HVERT kall, nøyaktig
som `defaultIsSafe` allerede gjorde. Native-koden ble derfor stående bak gaten
i `app.js`, og motoren måtte verken konstrueres på nytt eller lære et
pluginnavn — testen låser at den ikke kan ha lært et heller.

`releaseId` er signalet: manifestet navngir releasen web kjører, og enheten
sammenligner med `===` mot sin egen `<meta name="huskis-release">`. `buildId`
beholder rollen sin og blir bundelens identitet mot pluginen (`bundleId`), slik
at to bygg av samme release ikke kolliderer i pluginens lager.

Hvor bundelen ligger er avgjort, og kriteriet den måtte oppfylle var at den
ikke skulle koste en ny leverandør, en ny vert utover den ene i CSP-en, eller en
avhengighet i byggesteget. `release.yml` bygger og signerer ZIP-en på samme
`github.sha` og legger den i treet før `vercel deploy`; Vercel-builden kopierer
`ota/` ut i `dist/`, og filene serveres fra `huskis.no` sammen med resten av
appen. Ingen av de tre kostnadene ble betalt.

To ting følger av at det er Vercel-builden som kopierer dem ut. `ota/` står
IKKE i `SKIP`-listen i `build.js` — havner den der, blir hverken bundelen eller
manifestet publisert, og OTA stopper stille. Og mappen er ikke gitignorert, av
samme grunn: hva Vercel CLI-en laster opp styres ikke av dette repoet, og en
mappe som ikke lastes opp finnes ikke å kopiere. Begge er låst i
`tests/release-pipeline.test.js`.

## Native-kompatibilitet er en vakt i fase 5, ikke et punkt i fase 6

Lista nederst sier «aldri OTA-oppdatere native plugins». Det er en REGEL for hva
vi publiserer — ikke en vakt i klienten, og en regel kan ikke stoppe det som
skjer utilsiktet. Så snart fase 5 publiserer bundles automatisk fra
`release.yml`, er scenariet dette: en senere release endrer en native plugin
eller Capacitor-konfigurasjonen OG web-assetene i samme commit. Butikkbinæren
oppdateres i sitt eget tempo, men web-halvdelen ville nådd hver telefon med én
gang — inkludert de som fortsatt kjører det gamle skallet, og som da får
web-kode som kaller inn i noe som ikke finnes.

**Manifestet skal derfor bære en kompatibilitetsgrense fra den første
fungerende OTA-flyten**, og klienten skal avvise en inkompatibel bundle FØR
nedlasting og oppstilling — steg 0 i flyten over. Pluginen har halvdelen på
plass: `getVersionCode()` finnes nettopp for å begrense live updates til
kompatible native versjoner, og leverandøren dokumenterer i tillegg mønsteret
med å binde kanalnavnet til `versionCode` ved byggtid.

Begge halvdelene står nå i koden: manifestet publiseres per nivå
(signeringsrunden), og klienten bygger URL-en av skallets eget
`getVersionCode()` (hente-runden) — et skall utenfor spennet spør etter en fil
som ikke finnes, får 404 og gjør ingenting. Det siste er målt i ekte nettleser
med faket bro (`tests/ota-fetch.test.js`); det som gjenstår er å se det samme
fra et EKTE skall mot produksjon (se «Hva som krever en enhetsøkt»).

**Formen er valgt: URL-en bærer nivået.** To var aktuelle, og valget måtte tas
av runden som publiserte det første manifestet, siden formen bestemmer både
URL-en `release.yml` skriver til og hvor vakten ligger:

| Form | Hvordan den feiler | Pris | |
|---|---|---|---|
| Manifest-URL-en bærer det native nivået (`…/android/<versionCode>.json`) | fail closed av seg selv: et gammelt skall ber om et manifest som ikke finnes, får 404 og gjør ingenting | én URL-form, og én publisering per støttet nivå | **valgt** |
| Manifestet har et felt med nedre `versionCode` | klienten må selv sammenligne og avvise | ett felt, men vakten ligger i klientkoden | ute |

Avgjørende var HVEM som holder vakten. Spørsmålet «får denne klienten lov til å
hente dette?» besvares serverside overalt ellers i Huskis, og klientens gating
er kun UX. Med URL-formen er svaret et faktum om hva som FINNES: et nivå er
støttet nøyaktig når releasen skrev en fil for det. Med feltformen er svaret en
sammenligning klienten kan gjøre feil — og gjør den det, laster den ned og
stiller opp en bundle som kaller inn i noe som ikke finnes, og feilen havner
rett i reload-løkken seksjonen under handler om.

To mindre ting pekte samme vei. `getVersionCode()` returnerer en STRENG, så
URL-formen slipper både tallparsing og sammenligningsoperator. Og 404-grenen
finnes uansett — den er den samme som «ingen release ennå» og «nettet er nede» —
så vakten arver en vei som allerede må virke.

Prisen er reell og betales: ett manifest per støttet nivå, altså N identiske
filer. Spennet er `OTA_MIN_VERSION_CODE` til og med `versionCode`, og akkurat nå
er begge `3` — altså ett nivå og én fil.

Fase 6 eier fortsatt `versionCode` som BUTIKKENS krav: monotont økende per
opplasting, signering, spor. Det er en annen bruk av det samme tallet, og den
kommer i tillegg — ikke i stedet.

### En rullet-tilbake bundle må være varig sperret — ikke bare gjenkjent av timeren

Funn fra kodegjennomgang av PR #134 (P2), verifisert mot pluginens kilde:
`readyTimeout` beskytter mot at en DÅRLIG bundle blir stående, men ikke mot at
NESTE kaldstart velger nøyaktig samme `bundleId` igjen. Pluginen har en
blokkliste (`autoBlockRolledBackBundles`, `getBlockedBundles()`,
`clearBlockedBundles()`), men to ting gjør den ikke en vakt av seg selv:

- standardverdien er `false` — den må slås PÅ eksplisitt;
- **den sjekkes kun inne i pluginens egen `sync()`-flyt**
  (`isBlockedBundleId(latestBundleId)` i `fetchLatestBundleInternal`), lest
  direkte i `LiveUpdate.java`. Huskis' selvhostede flyt bruker den MANUELLE
  veien — `downloadBundle()` + `setNextBundle()` — og `setNextBundle()`
  konsulterer aldri blokklisten. Et manifest som (ved en feil, eller en
  fastlåst utrulling) fortsetter å peke på en `bundleId` som nettopp ble
  rullet tilbake, ville derfor bli stilt opp på nytt ved neste kaldstart, ryke
  på `readyTimeout` igjen, og gjenta seg for hver kaldstart — en reload-løkke
  på tvers av kalde oppstarter, som er nøyaktig det implementasjonslista
  nederst («unngå reload-/oppdateringsløkker») skal hindre. Ett-forsøk-vakten
  i `update-check.js` er `sessionStorage`-basert og dekker ikke dette: den
  overlever ikke en kald app-prosess.

**Vakten står nå, i to lag.** Før et manifestmål stilles opp med
`setNextBundle()`, spør klienten selv — samme prinsipp som steg 0
(native-kompatibilitet), men for identitet i stedet for versjon:

1. **Pluginens egen blokkliste** (`getBlockedBundles()`), som
   `autoBlockRolledBackBundles` fyller. Feltet er slått PÅ i den samme runden —
   det har først nå noe å føre opp, og siden det pakkes inn i APK-en, ble
   `versionCode` økt sammen med det. **Dette er hovedvakten.**
2. **Klientens egen, varige karantene** (`localStorage`, `huskis:ota-blocked`)
   — ett lag til, for det ene tilfellet det første ikke kan dekke.

Rekkefølgen er rettet etter kodegjennomgangen av PR #137, som fant at et
tidligere utkast av denne seksjonen bygget på en FEIL modell av pluginen.
Lesningen som gjelder, i `LiveUpdate.java` 8.4.0: `rollback()` setter
`rollbackPerformed`, husker den dårlige bundelen som `previousBundleId`, bytter
til den innebygde med `setCurrentBundleById(null)` — og den veien ender i
`setCurrentCapacitorServerPath()`, som kaller `Bridge.reload()`. Alt skjer i
SAMME prosess. Den innebygde bundelen laster altså med det samme, dens
`ready()` treffer et `rollbackPerformed` som fortsatt er `true`, og pluginen
fører bundelen opp i sin egen varige liste. **Den vanlige rollback-veien er
dermed dekket av pluginen selv.**

Hullet som blir igjen er smalt, og det er det klientens egen liste finnes for:
dør prosessen mellom rollbacken og readiness-punktet i den innebygde bundelen,
blir flagget aldri lest, og ved neste kaldstart finnes det ikke lenger — det
bor i minnet. Da står `previousBundleId` igjen alene, og `ready()` melder
`currentBundleId === null` (vi kjører den innebygde) sammen med den. Den
signaturen ER rollbacken, og den vises nøyaktig én gang — `ready()` overskriver
`previousBundleId` med det samme.

**Begge lag er fail closed, og det er en egenskap ved koden, ikke en påstand.**
En liste som ikke kan LESES — blokkert lagring, en verdi som ikke lar seg
parse, et brosvar som ikke er en liste — er ikke det samme som en tom liste;
hvert av de tilfellene er et NEI. Og en rollback som ikke kunne FØRES OPP er
heller ikke det samme som ingen rollback: skrivingen leses tilbake, og slår den
feil, stilles ingenting opp i den økten. Uten det ville et ekstra lag som
svarer «ingenting er sperret» når det ikke vet, gjort vakten svakere enn den
uten laget. Alle fire tilfellene er kjørt i `tests/ota-fetch.test.js` og låst i
`tests/capacitor-android.test.js`.

### En allerede hentet bundle er ikke en feilet nedlasting

Funn fra kodegjennomgang av PR #136, verifisert i pluginens kilde:
`downloadBundle()` starter med `if (hasBundleById(bundleId))` og svarer da
`ERROR_BUNDLE_EXISTS` («bundle already exists.») FØR den laster ned noe. Det
er ikke en kant-situasjon — det treffer HVER kaldstart etter den første
vellykkede nedlastingen, så lenge manifestet peker på den samme bundelen.

To ting følger, og begge står nå i koden:

- **Instrumentet må skille dem.** `otaFetch` er det enhetsøkten leser, og de
  to punktene økten skal avgjøre — at nedlastingen går utenfor WebView-ens
  CSP, og at telefonen godtar produksjonssignaturen — besvares nettopp av om
  nedlastingen lyktes. Meldt som `download-failed` ville en allerede hentet
  bundle sett ut som en AVVIST SIGNATUR, altså en falsk negativ i den ene
  målingen. Klienten skiller den derfor ut som `already-downloaded`
  (`app.js`, dekket av `tests/ota-fetch.test.js`).
- **Oppstillingen er ikke gjort avhengig av at et ferskt `downloadBundle()`
  lyktes.** Klargjøringen regner en bundle som ligger i lageret som KLAR —
  ellers ville en app som lastet ned i går aldri kommet videre til oppstilling
  i dag: nedlastingen «feiler» hver gang, fordi den allerede er gjort. Begge
  veier er kjørt i `tests/ota-fetch.test.js`.

### Den ødelagte bundelen kan ikke være en produksjonsrelease

To av punktene enhetsøkten skal måle — at en dårlig bundle RULLES TILBAKE, og at
den deretter havner i KARANTENEN — krever en bundle som aldri når
readiness-punktet. Den kan ikke lages på produksjonsveien: OTA-bundelen ER
produksjonsbuilden. `release.yml` pakker nøyaktig den `dist/`-en som deployes til
huskis.no, signerer den med produksjonsnøkkelen og lar manifestet peke på den. En
bevisst ødelagt bundle publisert der ville vært en ødelagt nettside for hver
eneste browserbruker, ikke bare et testtilfelle for én telefon.

**Valgt: en MÅLERIGG — et eget skall som ikke kan nå produksjon i det hele
tatt.** Riggen bygges av `.github/scripts/ota-rig.js` på en egen gren som aldri
merges, og består av to halvdeler:

- **et riggskall**, altså en debug-APK bygget av riggrenen. Nøyaktig tre
  konstanter skiller den fra produksjonsskallet: `canonicalAppUrl` i `config.js`,
  verten i CSP-ens `connect-src` i `index.html`, og `LiveUpdate.publicKey` i
  `capacitor.config.json`;
- **en riggbundle**, signert med riggens eget engangsnøkkelpar og servert fra
  riggrenens egen Vercel-preview, sammen med et manifest på nivået skallet spør
  etter. Bundelen er hele web-builden med `app.js` byttet mot et skript som maler
  en riggmelding og kaster (`--mode throw`), eller en `index.html` uten skript i
  det hele tatt (`--mode blank`) — de to tilfellene «laster scriptene fint, men
  feiler FØR skjermen er brukbar» og «når aldri `ready()`».

| Form | Hva den koster | |
|---|---|---|
| Målerigg: eget skall, eget nøkkelpar, egen vert | skallet er ikke lenger BYTE FOR BYTE produksjonsskallet, og det må sies eksplisitt i det som rapporteres | **valgt** |
| Midlertidig bundle på et `versionCode`-nivå produksjonsklienter ikke spør etter | formen finnes allerede, men filene må likevel LIGGE på huskis.no — og dit går det bare én vei | ute |
| Signere den ødelagte bundelen lokalt med produksjonsnøkkelen | privatnøkkelen må ut av Actions-secreten for å signere noe vi VET er ødelagt | ute |
| Simulere defekten i `chrome://inspect` (blokkere `app.js` etter byttet) | produksjonsskallet i behold, men målingen blir et kappløp mot en 10 s-timer — og instrumentene bor i den `app.js` som blokkeres | ute |

Avgjørende var HVOR den ødelagte bundelen må ligge. Alternativ to og tre er
egentlig det samme kravet: at filene serveres fra huskis.no. Dit går det én vei,
og den er `release.yml` bak `needs: smoke` — `tests/release-pipeline.test.js`
(sjekk 6) måler at ingen ANNEN workflow deployer til produksjon. Å legge en
ødelagt bundle på produksjonsverten krever derfor enten en ny deployvei utenom
den kjeden, eller at riggartefaktene merges til `main`. Begge deler betaler med
den ene invarianten releaseprosessen er bygget rundt, for å slippe å bytte tre
konstanter i et testskall.

Fjerde form er den mest fristende, siden den beholder produksjonsskallet helt:
blokker `app.js` i DevTools rett etter et bundlebytte, så nås readiness-punktet
aldri. Den faller på at `window.__huskis` — hvert eneste instrument økten leser
— ER `app.js`. Blokkeringen må stå til rollbacken har skjedd og fjernes før den
innebygde bundelen laster, ellers finnes det ingenting å lese; et tapt kappløp
mot `readyTimeout` ser da ut som en rollback som ikke virket.

**Hva riggen kan svare på, og hva den ikke får brukes til.** De tre konstantene
leses ikke av rollback-timeren, av pluginens blokkliste eller av klientens egen
karantene — den koden er byte for byte produksjonens, og patchen rører ingenting
annet (`tests/ota-rig.test.js` måler det linje for linje mot de ekte filene).
Rollback- og karantenepunktet kan derfor måles på riggen. De to
nedlastingspunktene kan det IKKE: riggen signerer med sin egen nøkkel og leser
fra sin egen vert, så både «telefonen godtar produksjonssignaturen» og
«manifestet kan leses fra huskis.no (CSP + CORS)» ville vært selvbevis. De må
leses av det EKTE skallet, i den samme økten.

Riggen kan heller ikke smitte produksjon, og det er ikke en påstand: manifestet
peker på riggverten, og klientens `url`-vakt forkaster det mot produksjonens
`canonicalAppUrl` før noe lastes ned. Skulle det likevel nå et produksjonsskall,
verifiserer riggsignaturen ikke mot den innebygde nøkkelen — pluginen er fail
closed på signatur. Begge leddene er kjørt i `tests/ota-rig.test.js`.

**Riggrenen skal aldri merges**, og det er maskinelt sagt: riggen må committe
`ota/` for at previewen skal servere bundelen, og `tests/ota-rig.test.js` feiler
på et tre der `ota/` er sjekket inn. Riggens privatnøkkel er en engangsnøkkel i
en gitignorert mappe (`.ota-rig/`) — den signerer bare bundles vi vet er
ødelagte, og produksjonsnøkkelen rører riggen aldri (skriptet kjenner ikke
secretens navn).

### Slik bygger og kjører du målerigg-runden

Riggen er ett verktøy for én måling, ikke en del av releasen. Ingen workflow
kjører den.

1. Lag en riggren av den samme commiten APK-en ellers bygges av, og push den —
   grenen får sin egen Vercel-preview (`docs/release-og-deploy.md`).
2. `node build.js`, deretter
   `node .github/scripts/ota-rig.js --host https://<preview-verten>`. Skriptet
   patcher de tre konstantene, lager nøkkelparet første gang, bygger og signerer
   `ota/bundles/rig-broken-1.zip` og skriver `ota/android/<versionCode>.json`.
3. Commit `ota/` og de tre patchede filene, og push. Previewen serverer nå
   riggmanifestet med de samme headerne produksjonen bruker (no-store + CORS på
   manifestet).
4. Bygg APK-en med workflowen «Android debug-APK» på RIGGRENEN, og installer den.
   Den erstatter produksjons-APK-en (samme `appId`, samme debug-nøkkel) — og
   appdataen følger med, så tøm den mellom riggen og det ekte skallet.
5. Kaldstart. `otaFetch` skal ende på `downloaded`, `otaStage` på `staged`. Et
   nytt kaldstart — eller et `reload()` gjennom banneret — tar riggbundelen i
   bruk, den kaster, og etter `readyTimeout` (10 000 ms) skal pluginen være
   tilbake på den innebygde. Les `liveReady` (`rollback`, `previousBundleId`) og
   `otaBlocked`, og se at NESTE kaldstart melder `otaStage.state === 'blocked'`.

Hver måling trenger et nytt `--id`: en bundle som er hentet én gang avvises som
«already exists», og en som er rullet tilbake er sperret for alltid i begge
karantenelagene.

Og riggen trenger ikke to merger, slik produksjonsmålingen gjør: manifestets
`releaseId` er riggens eget navn (`rig-broken-<n>`), aldri tolv hex-tegn, så det
kan ikke være det samme som APK-ens egen release.

## De to punktene fra fase 4 får sitt svar her

Begge sto åpne til OTA ga dem en konsekvens. Det gjør fase 5 nå.

**`minimumSupportedRelease` innføres ikke nå, og regelen forblir «bare ved et
konkret inkompatibilitetsbehov».** En nedre grense finnes for å STENGE UTE en
klient som ikke lenger kan virke. OTA angriper det fra motsatt kant: den flytter
klienten FRAMOVER, og manifestet navngir én release alle skal på — en identitet,
ikke en grense.

Men OTA er en LEVERINGSMEKANISME, ikke en garanti for at alle klienter faktisk
blir oppdatert. En telefon kan ha vært offline i månedsvis, kjøre en APK fra før
OTA fantes, eller ha en updater som ikke virker. Det som gjør at grensen ikke
trengs, er derfor fortsatt at skjemaet er additivt og backend bakoverkompatibel
([`release-og-deploy.md`](release-og-deploy.md)) — OTA gjør bare den vanligste
grunnen til å ville ha en grense mye mindre sannsynlig. Skulle et konkret
inkompatibilitetsbehov oppstå, står ordningsproblemet fortsatt der:
`releaseId` kan ikke være grensen alene, og en monoton verdi må designes sammen
med grensen.

Grensen OTA faktisk skaper går den andre veien: en web-bundle kan kreve et
nyere NATIVE skall enn det telefonen har. Den grensen kan ikke vente på fase 6 —
se «Native-kompatibilitet er en vakt i fase 5».

**Web og mobil får separate builds med samme `releaseId`.** Byte-identisk
artifact ble vurdert og valgt bort. Produksjonsbuilden kjører HOS Vercel og får
`VERCEL_DEPLOYMENT_ID` som `buildId`; en OTA-bundle må pakkes som ZIP der
verktøyet finnes, altså på Actions-runneren. Å tvinge de to til å bli ett bygg
ville krevd at build-ID-en ble sendt inn utenfra og at release-workflowen og
web-deployen delte artifact — en ny kobling i den ene kjeden som i dag holder
rekkefølgen migrering → smoke → deploy.

Prisen for å la dem være to er null, fordi `releaseId` allerede er svaret:
identiteten som betyr noe er kilden, og den er lik. `buildId` skal være
forskjellig — de ER to bygg. At de to byggene er like nok er dessuten allerede
bevist maskinelt: `tests/capacitor-android.test.js` måler at den synkede kopien
er byte for byte kilden, `index.html` modulo de to ID-ene.

## Hva som er lest, og hva som er observert

| Påstand | Grunnlag |
|---|---|
| Oppdateringsmotoren kjører i APK-en, men måler seg mot seg selv | **observert** — `dist/` servert på eget origin, motoren avlest i ekte nettleser |
| CSP-en avviser en OTA-forespørsel til `huskis.no` fra appens origin | **observert** — CSP-brudd i konsollen, samme-origin gikk gjennom |
| Pluginen krever ingen bundler | **observert** — `cap sync` registrerte `LiveUpdatePlugin` i `capacitor.plugins.json`; broens generering av `window.Capacitor.Plugins` lest i `JSExport.java` |
| Prisen i testsuiten er nøyaktig to sjekker | **observert** — 129/129 uten, 134/136 med, i en kopi av repoet. Bekreftet på nytt i repoet selv da pluginen ble innført: nøyaktig de to navngitte sjekkene falt, og suiten står nå på 152/152 med de nye invariantene |
| `cap sync` legger nøyaktig én Gradle-linje til | **observert** — `implementation project(':capawesome-capacitor-live-update')` i den genererte `android/app/capacitor.build.gradle`, og ingen endring i appmodulens egen `dependencies`-blokk |
| Rollback-timeren armeres i konstruktøren, uansett bundle | **lest** i `LiveUpdate.java`: `startRollbackTimer()` kalles i konstruktøren, og `rollback()` med den innebygde bundelen i bruk logger «Default bundle is already in use» og gjør ingenting |
| Capgo drar inn Play-tjenester, Capawesome ikke | **observert** — begge installert, Gradle-blokkene lest fra pakkene |
| Signering er `SHA256withRSA` og fail closed | **lest** i pluginens Java-kilde, ikke kjørt. VÅR halvdel er derimot kjørt: `crypto.createSign('sha256')` → `crypto.createVerify` gir `true` over de signerte bytene, `false` for en endret byte og `false` for feil nøkkel (`tests/release-pipeline.test.js`) |
| Den innebygde `publicKey` lar seg lese på pluginens egen måte | **observert** — samme nøkkel ut av både Nodes PEM-parser og `X509EncodedKeySpec`-veien (base64 uten PEM-hoder), sammenlignet som DER |
| Bundelen er `dist/` med `index.html` i roten | **observert** — 407 kB, 20 filer, `unzip -Z1` mot den faktisk produserte ZIP-en. Byggesteget avviser en ZIP uten `index.html` i roten |
| Vercel-builden publiserer `ota/` | **observert** — `node build.js` kjørt med `ota/` i treet la `ota/android/2.json` og `ota/bundles/<buildId>.zip` i `dist/` |
| Et nøkkelpar som ikke henger sammen stopper releasen | **observert** — `publishBundle()` med to ulike halvdeler kaster, og skriver ingen manifest |
| Rollback-timer, `reset()` og `reload()`s virkemåte | **lest** i pluginens Java-kilde, ikke kjørt |
| Play- og App Store-reglene tillater JS-OTA | **lest** — Apples avtaletekst hentet direkte; Play-policyen bare gjennom søketreff, siden `support.google.com` er blokkert av utgående proxy i denne økten |
| Appflow legges ned 31.12.2027 | **lest** gjennom søketreff — Ionics egne sider er blokkert av proxyen. Pakkens `"license": "Commercial"` er derimot lest direkte fra npm |
| Skyprisene | **lest** gjennom søketreff; begge prissidene er blokkert. Ikke grunnlag for valget |
| CSP-en slipper nå manifest-oppslaget ut, og blokkerer fortsatt fremmede verter | **observert** — `tests/csp-enforced.test.js` i ekte nettleser: intet `connect-src`-brudd for det kanoniske originet, fortsatt brudd for `cdn.example.invalid`. Og med verten fjernet ble hele hente-flyten et stille no-op (`no-manifest`, ingen JS-feil) — fail closed, målt i en bevisst rød kjøring |
| Hele hente-flyten: stille 404/nettverksfeil, systemgrense-validering, `===`, `downloadBundle` med nøyaktig tre felter | **observert** — `tests/ota-fetch.test.js` i ekte nettleser, med broen faket slik skallet injiserer den og manifest-URL-en rutet. Det testen IKKE ser: et ekte skalls `getVersionCode()`, produksjonens faktiske svar (inkludert CORS-headeren), og pluginens faktiske nedlasting/verifisering |
| Manifest-lesningen krever CORS i tillegg til CSP-verten (cross-origin fra `https://localhost`) | **resonnert + låst**, ikke observert på enhet: headeren står i `vercel.json` og voktes i `tests/release-pipeline.test.js`, men nettlesertesten svarer selv med headeren (rutet), så det ekte produksjonssvaret lest fra en WebView gjenstår |
| Pluginens egen blokkliste dekker den vanlige rollback-veien | **lest** i `LiveUpdate.java` 8.4.0, etter en RETTING fra kodegjennomgangen av PR #137: `rollback()` setter `rollbackPerformed`, husker den dårlige bundelen som `previousBundleId` og kaller `setCurrentBundleById(null)` → `setCurrentCapacitorServerPath()` → `Bridge.reload()` — alt i SAMME prosess. Den innebygde bundelen laster med det samme, dens `ready()` ser flagget fortsatt `true`, og `addBlockedBundleId()` kjører. Et tidligere utkast av planen påsto at flagget gikk tapt i en ny prosess; det var feil |
| Hullet klientens egen karantene dekker | **lest** i den samme kilden: `rollbackPerformed` bor i minnet og nullstilles først på slutten av `ready()`. Dør prosessen mellom rollbacken og readiness-punktet i den innebygde bundelen, leses flagget aldri, og neste kaldstart har det ikke. Da står `previousBundleId` igjen alene sammen med `currentBundleId === null` — signaturen klienten fører opp. Smalt, men ikke tomt |
| `setNextBundle()` konsulterer ikke blokklisten | **lest** i `LiveUpdate.java` 8.4.0: metoden sjekker kun `hasBundleById()`; `isBlockedBundleId()` leses bare i `fetchLatestBundleInternal`, altså i `sync()`-flyten Huskis ikke bruker |
| Hele oppstillingen: karantene → nedlasting (eller en bundle som alt ligger der) → `setNextBundle` med manifestets `bundleId` | **observert** — `tests/ota-fetch.test.js` i ekte nettleser: rekkefølgen, at en blokkert bundle ikke engang lastes ned, at en ulesbar blokkliste er et nei, og at en feilet oppstilling er stille. Det testen IKKE ser: en ekte plugins faktiske oppstilling, og at neste kaldstart tar bundelen i bruk |
| Klargjøringen i motoren: et uklargjort mål gir verken banner eller reload, og en feilet klargjøring koster ikke forsøket | **observert** — `tests/auto-update.test.js` i ekte nettleser, med injisert `prepare` på begge viewportene |
| Pluginen AVVISER en `bundleId` den alt har, og det treffer hver kaldstart etter den første nedlastingen | **lest** i `LiveUpdate.java` 8.4.0: `downloadBundle()` starter med `if (hasBundleById(bundleId))` → `ERROR_BUNDLE_EXISTS` («bundle already exists.»), FØR nedlastingen. Funnet kom fra kodegjennomgangen av PR #136 og er verifisert i kilden. Klienten skiller derfor utfallet ut som `already-downloaded` — se «En allerede hentet bundle er ikke en feilet nedlasting» |
| `reload()` armerer rollback-timeren PÅ NYTT | **lest** i `LiveUpdate.java` 8.4.0: `reload()` er `getNextCapacitorServerPath()` → `setCurrentCapacitorServerPath()` → `startRollbackTimer()`. Et bundlebytte midt i en økt er derfor også en anledning til å måle rollback — uten en kaldstart |
| `previousBundleId` er VARIG, `rollbackPerformed` er det ikke | **lest** i `LiveUpdatePreferences.java` 8.4.0: `setPreviousBundleId()` skriver til SharedPreferences, mens flagget er et vanlig felt i `LiveUpdate`. Det er nøyaktig derfor signaturen «`previousBundleId` sammen med `currentBundleId === null`» finnes igjen å lese for klientens eget karantenelag etter en prosessdød |
| Måleriggen er smal: den bytter tre konstanter og ingenting mer | **observert** — `tests/ota-rig.test.js` kjører patchen over de EKTE `config.js`, `index.html` og `capacitor.config.json`: nøyaktig én linje i hver, og `readyTimeout`/`autoBlockRolledBackBundles` står urørt |
| En riggbundle kan ikke aktiveres av et produksjonsskall | **observert** — samme fil: riggmanifestet forkastes av klientens `url`-vakt når basen er produksjonens `canonicalAppUrl`, og riggsignaturen verifiserer ikke mot den innebygde `publicKey` |
| Riggbundelen er faktisk ødelagt, og hele veien zip → signatur → manifest kjører | **observert** — samme fil, over en liten `dist/`: `app.js` i arkivet kaller aldri `ready()` og kaster, blank-modus er én `index.html` uten skript, og manifestet passerer klientens systemgrense med riggverten som base |

## Hva som krever en enhetsøkt

Ingenting av dette kan avgjøres uten en telefon, og ingen av dem skal krysses av
før de er målt i en `chrome://inspect`-økt mot en APK:

- ✅ **at `window.Capacitor.Plugins.LiveUpdate` faktisk finnes i Huskis' egen
  APK** — MÅLT mot debug-APK-en fra PR #134 (`android-debug.yml`,
  commit `b6b369f`): `window.Capacitor.Plugins.LiveUpdate` var et objekt med
  metoder, og `getCurrentBundle()` meldte ingen bundle (den innebygde/default
  builden — ingen OTA-bundle er hentet). Broen var tidligere bare lest i
  Capacitors kilde, ikke sett i appen;
- 🔜 **klar til måling: at `reload()` beholder originet**, og dermed
  `localStorage` og Supabase-sesjonen, gjennom et bundlebytte. Oppstillings-
  runden gjorde punktet målbart: `LiveUpdate.reload()` kalles nå — gjennom
  `updateSafety()`, banneret, inaktivitetsregelen og ett-forsøk-vakten — så
  økten kan se et bytte midt i en økt og lese om brukeren fortsatt er
  innlogget etterpå. Fortsatt ikke testet — klar, ikke verifisert;
- 🔜 **klar til måling: at rollback-timeren faktisk gjenoppretter den innebygde
  bundelen** når en bevisst ødelagt bundle aldri rekker `ready()` — og, som
  eget tilfelle, en bundle som laster scriptene fint men feiler FØR skjermen er
  brukbar. Oppstillingsrunden gjorde punktet målbart for første gang: en bundle
  kan nå tas i bruk, og dermed feile ved oppstart. Målingen har to ledd, og det
  andre er nytt: etter rollbacken skal `bundleId`-en havne i karantenen, som
  leses i `window.__huskis.otaBlocked` — en tom liste der etter en rollback
  betyr at signaturen fra `ready()` ikke ble lest, og at den samme dårlige
  bundelen ville blitt stilt opp igjen. **Dette punktet måles på MÅLERIGGEN,
  ikke på produksjonsskallet** (seksjonen «Den ødelagte bundelen kan ikke være
  en produksjonsrelease»): en ødelagt bundle kan ikke publiseres på
  produksjonsveien, fordi OTA-bundelen ER produksjonsbuilden. Riggskallet skiller
  seg fra produksjonsskallet i tre konstanter, og det skal stå i det som
  rapporteres. Byttet trenger heller ingen kaldstart: `reload()` armerer
  rollback-timeren på nytt (lest i `LiveUpdate.java` 8.4.0), så et bytte midt i
  økten teller. Fortsatt ikke testet — klar, ikke verifisert;
- 🔜 **klar til måling: at oppstillingen faktisk virker på enheten.**
  `window.__huskis.otaStage` skal stå på `staged`, og NESTE kaldstart skal
  kjøre den nye releasen — lest som `<meta name="huskis-release">` /
  `window.__huskis.otaFetch.state === 'same-release'`. Ingen av leddene er
  prøvd mot en ekte plugin;
- ⚠️ **delvis målt: at en offline kaldstart rekker readiness-punktet** —
  telefonen ble satt i flymodus, appen tvangslukket og åpnet på nytt, og
  `window.__huskis.appReady` ble `true` med `window.__huskis.liveReadyError`
  lik `null`. Det bekrefter at en offline kaldstart IKKE hindrer readiness-
  punktet eller etterlater en feil. Det som IKKE er målt her er PRESIS
  TIDSBRUK — om det skjedde godt innenfor `readyTimeout` (10000 ms) eller nær
  grensen — siden `appReady` blir `true` selv om pluginens rollback-timer
  rakk å utløse FØRST (rollback mot en allerede-innebygd bundle er et
  no-op, så det ville ikke vist seg som en feil her). En stoppeklokke-måling
  gjenstår, sammen med det generelle punktet «hva pluginen koster i
  kaldstartstid» under;
- 🔜 **klar til måling: at et bytte gjennom `updateSafety()` ikke taper en
  usynket endring** — samme spørsmål som del B i `tests/auto-update.test.js`
  stiller i browseren, men med `LiveUpdate.reload()` som reload. Fortsatt ikke
  testet — klar, ikke verifisert;
- 🔜 **klar til måling: at den native nedlastingen ikke er underlagt
  WebView-ens CSP.** Hente-runden gjorde punktet målbart for første gang —
  koden som laster ned finnes, og `chrome://inspect` mot en APK av den viser
  utfallet i `window.__huskis.otaFetch`. Målingen er skarp av en grunn til:
  `/ota/bundles/`-stien har med vilje INGEN CORS-header (kun manifest-stien
  har), så en nedlasting som lykkes kan ikke ha skjedd som en lesning fra
  WebView-en — den gikk i OkHttp, utenfor både CSP og CORS. Fortsatt ikke
  testet — klar, ikke verifisert;
- 🔜 **klar til måling: at en telefon faktisk VERIFISERER en bundle signert
  med produksjonsnøkkelen.** Signaturen er verifisert maskinelt på vår side
  (Node signerer, Node verifiserer), og at Java leser det samme formatet er
  lest i pluginens kilde — men de to har aldri møtt hverandre. Hente-runden er
  runden som kaller `downloadBundle()`, og kallet bærer manifestets signatur
  mot den innebygde `publicKey`: `otaFetch` ender på `downloaded` når Javas
  verifisering godtar Node-signaturen, og på `download-failed` med en
  signaturfeil hvis de to halvdelene ikke passer sammen. Fortsatt ikke testet
  — klar, ikke verifisert;
- **lesningsregel for de to punktene over:** `otaFetch.state` skiller fire
  utfall, og enhetsøkten må lese dem riktig. `downloaded` = begge punktene
  besvart. `already-downloaded` = bundelen ble hentet i en TIDLIGERE økt
  (pluginen avviser en `bundleId` den alt har) — også et JA på begge
  punktene, men fra forrige oppstart, ikke denne. `download-failed` = en ekte
  feil, og det er DEN som ville betydd at telefonen avviste signaturen.
  `no-manifest` = 404/nettverksfeil, altså at det ikke kom så langt. En APK
  som har lastet ned én gang vil derfor melde `already-downloaded` ved hver
  senere kaldstart; for å måle en FERSK nedlasting må appdata tømmes (eller
  en ny release publiseres) først;
- hva pluginen koster i kaldstartstid — samme stoppeklokke-måling som
  readiness-punktet lenger opp; ikke presist målt;
- hva AAR-ene faktisk merger inn i det bygde manifestet.

**To ting må stemme før økten i det hele tatt gir et svar**, og de gjelder
produksjonsskallet — ikke riggen:

- **APK-en må være `versionCode 3` eller høyere**, altså bygget av `main` fra og
  med oppstillingsrunden. `OTA_MIN_VERSION_CODE` ble hevet til `3` i den samme
  runden, så en debug-APK fra de tre første rundene får 404 på manifestet. Det er
  vakten som virker, ikke en feil — men den måler ingenting.
- **Manifestet må navngi en ANNEN release enn APK-en.** `release.yml` publiserer
  manifestet for nøyaktig den commiten APK-en bygges av, så en APK og et manifest
  fra samme merge gir `same-release` og ingenting skjer. Bygg derfor APK-en av én
  merge, og la en SENERE merge til `main` publisere releasen telefonen skal
  flyttes til.

Riggen har ingen av de to bindingene: den serverer sitt eget manifest på det
nivået skallet spør etter, og navngir en `releaseId` som aldri kan være APK-ens.

## Implementasjonen skal

- [ ] aldri OTA-oppdatere Swift/Kotlin/native plugins;
- [ ] håndheve native-kompatibilitet som en VAKT, ikke bare som en regel:
      manifestet bærer grensen, klienten avviser en inkompatibel bundle før
      nedlasting og oppstilling, og `versionCode` øker når skallet endres
      (seksjonen «Native-kompatibilitet er en vakt i fase 5»). Serversiden står
      (formen er valgt, `versionCode` er `3`, manifestet publiseres per nivå),
      og klientsiden står nå også: URL-en bygges av skallets eget nivå, og en
      404 er målt som stille no-op i ekte nettleser (`tests/ota-fetch.test.js`)
      — men med faket bro og rutet manifest. Punktet krysses av når enhetsøkten
      har sett vakten virke fra et EKTE skall mot produksjon — CORS-leddet i
      lesningen kan bare den se;
- [ ] verifisere bundle før aktivering — `downloadBundle()` bærer nå
      signaturen, og pluginen er fail closed når `publicKey` er satt; at en
      TELEFON faktisk godtar produksjonssignaturen står i «Hva som krever en
      enhetsøkt»;
- [ ] beholde den innebygde butikkversjonen som fallback — `readyTimeout` er
      satt, så pluginens rollback er slått PÅ, og fra og med oppstillingsrunden
      finnes det endelig en bundle som KAN feile. Veien er fortsatt ikke prøvd
      på en telefon;
- [ ] kalle `ready()` i et definert readiness-punkt — etter at appen er brukbar,
      og uten å vente på nettet (seksjonen «Readiness-punktet»). Koden står, og
      invariantene er låst i `tests/capacitor-android.test.js`; punktet krysses
      ikke av før enhetsøkten har målt de to tingene seksjonen navngir;
- [ ] gjenbruke `updateSafety()` slik at bundlebytte ikke skjer midt i usikret
      arbeid — `LiveUpdate.reload()` går gjennom nøyaktig den samme veien som
      en nettleser-reload, og vurderingen er uendret (arkitekturregel 8). Kjørt
      i nettleser; et bytte på enhet gjenstår;
- [ ] klargjøre målet (nedlasting + `setNextBundle()`) som en egen tilstand før
      det kan reloades, og la en feilet klargjøring prøves igjen uten å brenne
      ett-forsøk-vakten. Leddet står i `update-check.js` og er kjørt i ekte
      nettleser (`tests/auto-update.test.js`); punktet krysses av når en telefon
      har vist at klargjøringen gjør det den lover;
- [ ] tåle offline oppstart;
- [ ] unngå reload-/oppdateringsløkker — inkludert på tvers av KALDE
      oppstarter: en rullet-tilbake `bundleId` skal avvises FØR den stilles
      opp på nytt, ikke bare oppdages av `readyTimeout` igjen (seksjonen «En
      rullet-tilbake bundle må være varig sperret»). Den doble karantenen står,
      og avvisningen er kjørt i nettleser; at en EKTE rollback faktisk fyller
      den gjenstår på enhet, og måles på måleriggen;
- [ ] kunne rulle tilbake en dårlig mobilbundle — HVORDAN en ødelagt bundle i det
      hele tatt kan nå en telefon uten å ødelegge produksjonen er nå avgjort og
      bygget (`.github/scripts/ota-rig.js`, seksjonen «Den ødelagte bundelen kan
      ikke være en produksjonsrelease»). Selve rullingen er fortsatt en måling,
      ikke kode;
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
- [ ] Ta `versionCode` videre fra OTA-vakten (fase 5) til butikkens krav:
      monotont økende per opplasting, og konsistent med grensen OTA-manifestet
      allerede bruker. Det er samme tall i to roller — ikke to ordninger.

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

**Fase 5 er hel i koden.** Fase 3 og fase 4 er begge ferdige, og ble avsluttet
i samme `chrome://inspect`-økt mot debug-APK-en. Fire runder er innført, og den
siste lukket det siste kodesteget.

Første runde (merget): pluginen pinnet, `LiveUpdate`-blokken i
`capacitor.config.json` med `readyTimeout` (rollback PÅ) og
`autoUpdateStrategy: "none"`, `ready()` kalt i readiness-punktet bak den samme
native-vakten som tilbakeknappen bruker. Kodegjennomgangen fant og fikset ett
reelt funn (P1: `appReady` ble satt `true` FØR `ready()` var bekreftet) og
navnga ett krav for senere (P2: en rullet-tilbake bundle må sperres varig).

Andre runde (merget): den første signerte bundelen og manifestet. `release.yml`
bygger og signerer ZIP-en på den commiten som ble migrert og smoke-testet,
verifiserer signaturen mot den innebygde nøkkelen, og skriver ett manifest per
støttet native nivå. Manifestformen er avgjort — URL-en bærer nivået —
`versionCode` er økt, og `publicKey` står i konfigurasjonen.

Tredje runde (merget): hentingen, uten å bytte. CSP-verten (`https://huskis.no`
i `connect-src`, begge policyene) pluss CORS-headeren på manifest-stien som
cross-origin-lesningen fra `https://localhost` krever; `fetchOtaBundle()` i
`app.js` bak samme gate som `ready()` — URL-en bygget av `getVersionCode()`,
ett `fetch` med `no-store`, systemgrense-validering, `===` mot
`<meta name="huskis-release">`, og `downloadBundle({url, bundleId, signature})`.

Fjerde runde: stille opp og bytte. Den doble karantenen (P2 er dermed lukket i
koden), `setNextBundle()`, klargjøringstilstanden i `update-check.js` og
`LiveUpdate.reload()` gjennom `updateSafety()`, banneret, inaktivitetsregelen
og ett-forsøk-vakten. `autoBlockRolledBackBundles` er slått på, og `versionCode`
er økt til `3` fordi feltet pakkes inn i APK-en, og `OTA_MIN_VERSION_CODE` er
hevet til `3` med det. Kodegjennomgangen av runden rettet to ting som begge sto
på feil premiss: grensen kan ikke være `2`, fordi et nivå 2-skall bærer
web-kode som laster ned uten å stille opp og derfor aldri kan aktivere
bundelen; og pluginens egen blokkliste rekker lenger enn først antatt —
`rollback()` bytter til den innebygde bundelen og kaller `Bridge.reload()` i
SAMME prosess, så den vanlige rollback-veien fyller listen. Klientens egen
karantene er derfor ett lag til, ikke hovedvakten, og begge lag er nå
fail closed på både lesning og skriving (se «En rullet-tilbake bundle må være
varig sperret»).

Femte runde er ikke et nytt ledd i kjeden, men det siste hinderet foran økten:
**hvordan en bevisst ødelagt bundle kan nå en telefon uten å ødelegge
produksjonen.** OTA-bundelen ER produksjonsbuilden, så en ødelagt bundle på
produksjonsveien ville vært en ødelagt nettside for alle. Valget er en MÅLERIGG
— eget skall, eget engangsnøkkelpar, egen vert — bygget av
`.github/scripts/ota-rig.js` på en gren som aldri merges, og låst av
`tests/ota-rig.test.js`: patchen bytter tre konstanter og ingenting mer, og en
riggbundle kan verken nå eller aktiveres av et produksjonsskall. Begrunnelsen og
de forkastede formene står i «Den ødelagte bundelen kan ikke være en
produksjonsrelease».

**Enhetsøkten er delvis gjort**, mot debug-APK-en fra første runde:
`window.Capacitor.Plugins.LiveUpdate` finnes, `getCurrentBundle()` melder den
innebygde builden, og en kaldstart i FLYMODUS nådde readiness-punktet
(`window.__huskis.appReady === true`, `liveReadyError === null`).

**Neste steg er derfor ikke kode, men en telefon.** Fem punkter er nå klare til
måling i én økt (seksjonen «Hva som krever en enhetsøkt»): den første ekte
nedlastingen (`otaFetch` — måler i ett at OkHttp går utenfor WebView-ens CSP og
at telefonen godtar produksjonsnøkkelens signatur), at bundelen faktisk stilles
opp (`otaStage`), at neste kaldstart kjører den, at `reload()` beholder
originet og dermed sesjonen, og at en bevisst ødelagt bundle rulles tilbake OG
havner i karantenen (`otaBlocked`). De fire første leses av det EKTE skallet mot
produksjon; det femte måles på måleriggen, og at skallet da er et annet skal stå
i det som rapporteres. To bindinger gjelder produksjonsmålingen alene: APK-en må
være `versionCode 3`, og manifestet må navngi en SENERE release enn den APK-en
er bygget av. I tillegg gjenstår fra før en presis tidsmåling mot `readyTimeout`,
og hva AAR-ene merger inn i det bygde manifestet.

### Fase 3

**Alle seks punktene er avgjort.** Tilbakeknappen og safe
areas/systemfeltene/skjermtastaturet er verifisert på telefon; de to
lenkepunktene — eksterne lenker og auth-/e-postlenker — endte som beslutninger
uten kode, og har derfor ingenting å prøve på en telefon; sikker
lagring/`allowBackup` endte i to native erklæringer og ingen web-kode
(seksjonen «Sikker lagring og sikkerhetskopi»).

**Lifecycle- og network-signalene er kartlagt, avgjort og MÅLT på enhet.**
Websignalene rekker, ingen native signaler er koblet på, og det ene reelle
hullet — at ingenting hentet appen inn igjen ved gjenopptakelse — er lukket.
Enhetsøkten svarte på begge spørsmålene runden med vilje ikke kunne svare på
(seksjonen «Kjørt med sonden: hva enheten svarte»):

- **`navigator.onLine` er død uten `ACCESS_NETWORK_STATE`** — flagget sto på
  `true` i flymodus. Manifestlinjen er lagt inn, voktet av del 6 i
  `tests/capacitor-android.test.js`.
- **Gjenopptakelsen startet runden** — et `get_my_doc` står i loggen tilskrevet
  `visibilitychange`. Målingen la samtidig til noe planen ikke visste: har
  Android fryst prosessen, leveres hendelsen ikke i det hele tatt, og da er
  pollets forfalte tikk det eneste som starter runden. Begge ledd er bærende,
  hvert i sitt regime, og `tests/sync-foreground.test.js` kjører dem hver for
  seg (del 2 og del 6).

Ingen plugin er innført, og unntaket for tilbakeknappens bro står uendret.

### Fase 4

**Identiteten finnes, og de to siste punktene er avgjort.** `releaseId` er
definert, generert i `build.js` og stemplet inn i både klienten og
`/version.json`; web og Android bygget fra samme commit rapporterer den samme
verdien, mens `buildId` fortsatt er unik per bygg og eier cache- og
reload-sikkerheten alene. `minimumSupportedRelease` innføres ikke — OTA flytter
gamle klienter framover i stedet for å stenge dem ute — og web og mobil får
separate builds med samme `releaseId`. Begge svarene er begrunnet i
fase 5-seksjonen.

**Ferdigkriteriet er sett på enhet:** en kjørende APK og en Vercel-preview
bygget av samme commit rapporterte den samme `releaseId` (`d10867a7c0a6`) med
hver sin `buildId`, lest i `chrome://inspect` mot APK-en og i nettleseren.

Hver fase 3-endring er plattformspesifikk og skal gates eksplisitt
(arkitekturregel 2): browserutgaven skal fortsatt kjøre uten Capacitor.
`tests/capacitor-android.test.js` har fått sitt bevisste unntak for
tilbakeknappens bro — ÉN kodelinje i `app.js`, gjennom
`window.Capacitor.isNativePlatform()`. Trenger et nytt punkt et native API,
utvides unntaket like avgrenset i samme endring; vakten fjernes ikke.

### Fase 5

**Løsningen er valgt, og prisen er skrevet ned.**
`@capawesome/capacitor-live-update` i selvhostet modus: MIT, ingen sky-konto,
ingen regning, og bundelen er en signert ZIP Huskis lager selv. Valget hviler på
tre målinger, ikke på produktsider — at pluginen ikke krever en bundler, at den
koster nøyaktig to navngitte sjekker i `tests/capacitor-android.test.js`, og at
alternativet drar Google Play-tjenester inn i en app som ikke har dem.

**Hullet fasen skal fylle er også målt:** oppdateringsmotoren kjører i APK-en og
`updateSafety()` svarer `safe: true` — den sammenlignet bare sin egen innebygde
`/version.json` med seg selv. Fase 5 ga den en motpart uten å røre
trygghetsvurderingen: `updateSafety()`, banneret, inaktivitetsregelen og
ett-forsøk-vakten er de samme (arkitekturregel 8). Det som kom i tillegg er et
ledd, ikke et nytt begrep — et mål må klargjøres (nedlasting +
`setNextBundle()`) før det kan reloades, en inkompatibel bundle avvises før
klargjøringen begynner, og signalet om at det FINNES et mål kommer fra
manifestet i stedet for fra `/version.json`.

**Fire runder er innført, og kjeden er hel i koden:** pluginen,
`LiveUpdate`-blokken og readiness-punktet i den første; den signerte bundelen og
manifestet i den andre; hentingen i den tredje; oppstillingen og byttet i den
fjerde. Kodegjennomgangen på den første fant ett reelt funn i selve runden
(rettet: readiness-punktet ventet ikke på at native-kallet lyktes) og navnga
ett krav (P2, varig sperring) som den fjerde runden lukket. Kodegjennomgangen
av DEN runden rettet i sin tur modellen den lukkingen bygget på: `rollback()`
kaller `Bridge.reload()` i samme prosess, så pluginens egen blokkliste dekker
den vanlige veien, og klientens egen karantene er ett lag til — for det ene
tilfellet der prosessen dør før readiness-punktet.

**Kompatibilitetsvakten har fått sin form:** manifest-URL-en bærer det native
nivået, så et skall utenfor spennet får 404 og gjør ingenting — vakten ligger i
hva som FINNES, ikke i en sammenligning klienten kan gjøre feil. `versionCode`
er `3`, og `OTA_MIN_VERSION_CODE` likeså: spennet er ett nivå, fordi grensen er
det laveste skallet som kan TA I BRUK en bundle — ikke det laveste skallet der
pluginen har metodene. Signaturen er verifisert maskinelt, og byggesteget
verifiserer sin egen signatur mot den innebygde nøkkelen før det skriver et
manifest.

**Den ødelagte bundelen har fått sin form.** Rollback- og karantenepunktet
kunne ikke måles i det hele tatt uten å avgjøre hvor en bevisst ødelagt bundle
skal komme fra, og produksjonsveien var utelukket: `release.yml` pakker den
samme `dist/`-en som deployes til huskis.no. Valget er en målerigg med eget
skall, eget engangsnøkkelpar og egen vert — de tre konstantene som skiller den
fra produksjonsskallet leses ikke av rollback-timeren, blokklisten eller
karantenen, og `tests/ota-rig.test.js` måler at patchen ikke rører noe annet.
Formene som ble forkastet, og hva riggen IKKE får brukes til å svare på, står i
«Den ødelagte bundelen kan ikke være en produksjonsrelease».

**Enhetsøkten er delvis gjort**, mot debug-APK-en bygget av første runde:
`window.Capacitor.Plugins.LiveUpdate` finnes, `getCurrentBundle()` melder den
innebygde builden, og en kaldstart i FLYMODUS (tvangslukk + gjenåpne) nådde
readiness-punktet — `window.__huskis.appReady` ble `true`,
`window.__huskis.liveReadyError` var `null`. **Ingen av implementasjonspunktene
i sjekklisten er krysset av.** Det som gjenstår er ikke kode, men målinger: fem
punkter står klare i «Hva som krever en enhetsøkt», og instrumentene er
`window.__huskis.otaFetch` (nedlastingen utenfor CSP-en + produksjons-
signaturen), `otaStage` (oppstillingen), `liveReady` (rollbacken) og
`otaBlocked` (karantenen). I tillegg gjenstår fra før: presis tidsmåling mot
`readyTimeout`, og hva AAR-ene merger inn i manifestet.
