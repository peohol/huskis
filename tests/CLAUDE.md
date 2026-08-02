# CLAUDE.md — tester

Testene er frittstående Node-skript, ikke et testrammeverk: ingen
`package.json`, ingen runner, ingen `npm test`. Hver fil kjøres direkte, skriver
`PASS`/`FAIL`-linjer med evidens, avslutter med `==== n/m PASS ====` og setter
exit-kode 0/1.

## Kjøre testene

Nettlesertester (Playwright + Chromium; serveren må kjøre i en egen terminal):

```bash
python3 -m http.server 8000                        # fra repo-roten
NODE_PATH=$(npm root -g) node tests/<navn>.test.js
```

Rene node-tester (ingen server, ingen nettleser):

```bash
node tests/build-version.test.js      # build.js + vercel.json
node tests/no-legacy-domain.test.js   # repo-vid vakt mot det pensjonerte domenet
node tests/release-pipeline.test.js   # rekkefølgen migrering → smoke → deploy
node tests/db-contract.test.js        # smoke-test.sql i takt med app.js
node tests/security-headers.test.js   # CSP + sikkerhetsheaderne, låst Supabase-versjon
```

Hele suiten i én runde (starter en lokal server selv hvis ingen svarer) —
nøyaktig det CI kjører:

```bash
tests/run-all.sh
SHARD_INDEX=1 SHARD_TOTAL=4 tests/run-all.sh   # slik CI deler den opp
```

- `NODE_PATH=$(npm root -g)` trengs fordi Playwright er installert globalt.
- `HUSKIS_URL` overstyrer `http://localhost:8000` hvis serveren kjører et annet
  sted.
- Kjør de testene endringen berører — hele mappen tar lang tid, og en full runde
  er sjelden det som gir evidensen. CI kjører den fulle runden på hver PR.

## Hermetikk: `?mock=1`

Nettlesertestene laster appen med `?mock=1`, som får `dev-mock.js` til å laste
`mock-backend.js`: en in-memory-«database» i `localStorage` (`hk-mock-db`) med
sesjon per fane i `sessionStorage` (`hk-mock-session`). Det er dette
backend-byttet som gjør testene hermetiske — det finnes ingen ruteblokkering av
nettverkskall, og testene stubber ikke fetch.

Begge filene er **kun kildekode**: `build.js` holder dem utenfor `dist/` og river
`kun-dev`-blokken ut av `index.html`, så testmodusen ikke finnes i produksjon
(`docs/sikkerhetsheadere.md`). Alle nettlesertestene kjører dessuten under den
ekte innholdssikkerhetspolicyen, som ligger i en `<meta>`-tagg i `index.html` —
en endring som krever nytt inline-script eller en ny tredjepartsvert vil feile
her før den når produksjon.

`&lag=800` gir kunstig serverforsinkelse og brukes til å vise at UI-et er
umiddelbart og at operasjonskøen serialiserer riktig.

To måter å komme inn i appen på:

1. **Kjør registreringen i UI-et** (som `nav-modal.test.js`) — dekker
   auth-flyten, men er treg.
2. **Seed databasen direkte** (som `roles-and-sections.test.js`): skriv
   `hk-mock-db` + `hk-mock-session` og last siden på nytt. Dette er måten
   flerbrukerscenarioer settes opp på — roller, medeierskap, invitasjoner, låser
   og delt innhold seedes ferdig i stedet for at to faner klikker seg gjennom
   flyten. Test som en annen bruker ved å seede en annen `hk-mock-session`.

**Introduksjonen kommer i veien.** En ny konto får omvisningen automatisk etter
innlogging (`docs/introduksjon.md`), og laget den ligger i fanger alle klikk.
Gest-tipsene er like mye i veien: de kommer som en toast NEDERST på skjermen —
nøyaktig der et mobil-drag tar tak i den nederste lista. Tester som ikke handler
om introduksjonen skal derfor slå av BEGGE deler med én gang:

- logger testen inn gjennom UI-et: `await p.evaluate(() => window.__huskis.tour.skipAll())`
  sist i innloggingshjelperen (merket lagres med én gang, så en omvisning som er
  på vei opp heller ikke rekker å starte);
- seeder testen sesjonen selv: gi den seedede brukeren
  `user_metadata: { onboarding: { v: 1, status: 'done' }, tips: { drag: true, trash: true, moveList: true } }`.

Mock-backenden speiler serverens regler (roller, capabilities, felt-LWW,
fremmednøkler, gravsteiner), men er ikke en full RLS-implementasjon. Endrer du
en regel i `supabase/users-and-sharing.sql`, må mock-backenden oppdateres i
samme endring — ellers tester nettlesertestene noe annet enn produksjon.

`window.__huskis` eksponerer state og et utvalg funksjoner (`openNavModal`,
`openSettings`, `cloudCycle`, `updateSafety`, `authUser`, `showToast` …). Bruk
dem til oppsett og inspeksjon; klikk deg gjennom UI-et der klikkene ER det som
testes.

## Viewport

Testfilene kjører vanligvis samme sjekker to ganger:

```js
await run('desktop', { width: 1200, height: 900 }, false);
await run('mobil',   { width: 390,  height: 780 }, true);   // isMobile + hasTouch
```

Begge kreves når oppførselen avhenger av layout eller pekertype: dra-og-slipp,
board-kolonner (grensen mellom én og flere kolonner går ved 560/561 px), scroll,
trykk-og-hold, plassering og visuell justering. Ett viewport holder for logikk
som ikke avhenger av noe av dette (synk, rettighetsgating, tilstandsendringer).

## Konvensjoner i testfilene

- Kommentarblokk øverst: nummerert liste over hva filen dekker, og en
  `Kjør:`-blokk med den faktiske kommandoen.
- Samle `page.on('pageerror')` og avslutt hvert løp med en sjekk på at ingen
  JS-feil oppsto.
- Assertions tar med den faktiske verdien som evidens, slik at en feilende linje
  er lesbar uten å kjøre testen på nytt.
- Én fil per tema eller regresjon, navngitt etter oppførselen
  (`dnd-peek-collapsed`, `sync-resurrection`) — aldri etter PR-nummer eller dato.
- En bugfiks skal ha en sjekk som feiler uten fiksen. Legg den i den filen som
  allerede dekker området hvis det finnes en.
- Skjermbilder tas kun der det visuelle ER påstanden (se
  `dnd-extract-thresholds.test.js`), ikke rutinemessig.

## Rapportering

Oppgi hvilke testfiler som ble kjørt og resultatlinjen deres. Berører endringen
en test du ikke kjørte, si det eksplisitt.
