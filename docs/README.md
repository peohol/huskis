# Huskis — dokumentasjonskart

Dette er inngangen til repoets produkt- og arkitekturdokumentasjon. Les det dokumentet som dekker området du skal endre; ikke bruk denne fila som en kronologisk logg.

## Produkt og brukeropplevelse

- [`introduksjon.md`](introduksjon.md) — hva Huskis er, sentrale begreper og produktmodell.
- [`design-system.md`](design-system.md) — visuell utforming, komponentmønstre, responsive regler og safe areas.
- [`tilgjengelighet.md`](tilgjengelighet.md) — tilgjengelighetskontrakter, tastatur, fokus og skjermleser.
- [`sprak.md`](sprak.md) — språk/i18n og reglene for brukerrettet tekst.
- [`menus.md`](menus.md) — objektmenyer, skuffer, popovere og tilhørende interaksjonsmønstre.
- [`scheduling.md`](scheduling.md) — starttider, frister, tidsarv og tidseditor.
- [`feature-plan-search-events-notifications.md`](feature-plan-search-events-notifications.md) — implementeringsplan for globalt søk, kommende hendelser og varsler.

## Data, synk og deling

- [`data-model.md`](data-model.md) — datamodell og relasjonene område → mappe → liste → kategori/listepunkt.
- [`accounts.md`](accounts.md) — konto, autentisering og brukerflyt.
- [`arkitektur-brukere-deling.md`](arkitektur-brukere-deling.md) — overordnet arkitektur for brukere og deling.
- [`rettigheter-og-deling.md`](rettigheter-og-deling.md) — tilgangsregler, roller og deling.
- [`trash.md`](trash.md) — papirkurv, sletting, angre og gravsteiner.

## UI-motor og layout

- [`board-layout.md`](board-layout.md) — board-/kolonnelayout og relayout.
- [`drag-and-drop.md`](drag-and-drop.md) — dra-og-slipp, dnd-kit/Smett og semantikken ved flytting.
- [`colors-and-labels.md`](colors-and-labels.md) — farger, etiketter og relaterte visningsregler.
- [`mork-drakt.md`](mork-drakt.md) — lys/mørk drakt.

## Plattform, bygg og drift

- [`mobilapp-plan.md`](mobilapp-plan.md) — levende plan og status for Android/iOS/Capacitor.
- [`auto-update.md`](auto-update.md) — automatisk oppdatering av webklienten.
- [`release-og-deploy.md`](release-og-deploy.md) — releaseidentitet, bygg og deploy.
- [`domains-and-urls.md`](domains-and-urls.md) — domener, kanonisk origin og URL-/lenkeflyt.
- [`sikkerhetsheadere.md`](sikkerhetsheadere.md) — CSP og øvrige sikkerhetsheadere.

## Hvordan dokumentasjonen vedlikeholdes

- Oppdater autoritativ dokumentasjon i samme PR som funksjonaliteten endres.
- Ikke før historikk/changelog i dokumentene; Git og PR-er er historikken.
- Ikke dupliser samme regel i mange filer. Pek heller til det autoritative dokumentet.
- Planfiler kan beskrive fremtidig arbeid, men når funksjonaliteten er implementert skal den faktiske kontrakten dokumenteres i det ordinære fagområdedokumentet.
