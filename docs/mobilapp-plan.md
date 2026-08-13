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
| Nåværende fase | **Fase 2 — funksjonell paritet på Android** |
| Status | Fase 1 er ferdig og verifisert (se fasen under). Fase 2 er i gang fra automatiseringssiden: den delen av matrisen som kan avgjøres uten telefon er gjennomgått og dekket av tester, og de invariantene som gjelder selve WebView-originet er nå voktet. Selve matrisen er ikke kjørt på telefon ennå. |
| Neste milepæl | Ingen kjent Android-spesifikk feil som gir datatap, synkfeil, blokkert kjernefunksjon eller dårligere tilgjengelighet enn web |
| Ett neste praktiske steg | Kjør de fysiske punktene i fase 2 på telefonen med en browserklient på samme konto samtidig, og loggfør hvert avvik som enten en ordinær Huskis-feil eller en native-spesifikk feil |
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

Alle fire er voktet av tester (tabellen under). Ut over dette har ikke webkoden
noen kjennskap til Capacitor, og skal ikke få det — `tests/capacitor-android.test.js`
feiler hvis en Capacitor-referanse sniker seg inn i web-kildefilene.

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

## Gjenstår — må testes på fysisk Android

Disse kan ikke avgjøres av kodeinspeksjon eller browser-emulering. Test dem med
en browserklient innlogget på samme konto samtidig:

- [ ] registrering/innlogging/utlogging;
- [ ] språk og kontoinnstillinger;
- [ ] opprette, endre navn, flytte og omorganisere alle objektnivåer;
- [ ] drag-and-drop og touch-hold på de to DnD-scope-ene;
- [ ] sletting, angre, gjenoppretting og permanent tømming;
- [ ] synk mellom mobil og browser uten gjenoppståtte eller tapte objekter;
- [ ] delt innhold, roller og invitasjoner;
- [ ] offline → online;
- [ ] bakgrunn → forgrunn;
- [ ] tvungen avslutning → ny oppstart;
- [ ] tastatur, fokus, modaler, popovere og smale viewporter;
- [ ] tilgjengelighet og berøringsflater;
- [ ] ingen uventet reload mens lokal/synkende tilstand er utrygg;
- [ ] auto-oppdateringsmekanikken oppfører seg forsvarlig i native runtime:
      `/version.json` er rot-relativ, så i appen leser `update-check.js` den
      INNEBYGDE fila og ser alltid sin egen build-ID. Den skal altså ikke vise
      oppdateringsbanner eller reloade — bekreft det, i stedet for å anta det.
      Å faktisk kunne oppdatere web-assetene er fase 5.

Feil som finnes både i browser og mobil er ordinære Huskis-feil. Feil som bare
finnes i native runtime skal få avgrensede plattformtilpasninger og egne tester.

## Slik kjører du den fysiske runden

Én sammenhengende økt dekker hele lista. Oppsett: debug-APK-en installert
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
webversjonen.

---

# Fase 3 — nødvendige native integrasjoner

**Mål:** gjøre appen naturlig å bruke som Android-app uten å bygge native
funksjoner bare fordi de er mulige.

- [ ] Definer korrekt system-tilbakeoppførsel: lukk øverste popover/modal,
      naviger ett Huskis-nivå tilbake der det er naturlig, og la OS håndtere
      resten.
- [ ] Verifiser safe areas, status-/navigasjonsfelt og skjermtastatur.
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

Fullfør **Fase 2**: kjør de gjenstående punktene på en fysisk Android-telefon,
med en browserklient innlogget på samme konto samtidig. Oppskrift på å få
APK-en på telefonen står i fase 1. Feil som finnes begge steder er ordinære
Huskis-feil og hører hjemme i sin egen endring; feil som bare finnes i native
runtime skal få en avgrenset plattformtilpasning og en egen test. Kryss av
punktene etter hvert som de faktisk er testet.
