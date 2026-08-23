# CLAUDE.md — Huskis

## Prosjekt

Huskis er en statisk vanilla-JS-app uten bundler, rammeverk eller
klientavhengigheter. Innholdet er hierarkisk: **Område > Mappe > Liste >
Listepunkt**, der en liste i tillegg kan ha ett nivå med **kategorier**.

De to øverste nivåene er bygget av nøyaktig samme komponenter som de to
nederste: et område ER et kort, en mappe ER en rad, og de deler CSS-klasser,
maler og politikk. Dra-og-slipp kjører i to scope — `boardScope`
(listevisningen) og `navScope` (navigasjonsmodalen) — og de to står **midt i et
motorbytte**: `navScope` kjøres av dnd-kit gjennom Smett
(`vendor/smett-0.1.0.js`), `boardScope` fortsatt av den hjemmesnekrede motoren i
`app.js`. En endring i delt politikk treffer derfor begge nivåene, og en endring
i selve motoren bare ett. Rekkefølgen for resten av byttet:
`docs/dndkit-plan.md`. Nåtilstanden: `docs/drag-and-drop.md`.

**Kildekode** (det som deployes): `index.html`, `styles.css`, `app.js`,
`icons.js`, `i18n.js`, `theme.js`, `config.js`, `update-check.js`, `assets/`,
`vendor/`
(supabase-js og Smett som innsjekkede, låste kopier —
`docs/sikkerhetsheadere.md`).
`dev-mock.js` og
`mock-backend.js` er testmodus (`?mock=1`) og blir IKKE med i produksjons-
deployen — `build.js` fjerner både filene og taggen som laster dem. Kun
preview-deployer beholder dem (`docs/sikkerhetsheadere.md`).

**Generert output**: `dist/`, laget av `node build.js` — ikke sjekket inn, og
ingenting skal redigeres der. Byggesteget kopierer kildefilene og stempler en
build-ID inn i `index.html` + `version.json`; i repoet står build-ID-en på `dev`
med vilje, slik at lokal utvikling ikke trigger auto-oppdatering.

**Mobilskallet**: `package.json` + lockfila, `capacitor.config.json` og
`android/` finnes kun for å pakke den samme `dist/`-en inn i en native app.
Webappen har fortsatt ingen bundler og ingen klientavhengigheter, og denne
toolingen deployes aldri — `SKIP`-listen i `build.js` holder den utenfor `dist/`.
Autoritativt for fremdrift og neste steg: `docs/mobilapp-plan.md`.

**Serversiden** er `supabase/users-and-sharing.sql` — én idempotent fil med
tabeller, RLS, triggere og RPC-er.

**Releaseprosessen**: ved merge til `main` kjører `.github/workflows/release.yml`
tester → migrering → smoke-test → Vercel-deploy, i den rekkefølgen. Frontenden
publiseres aldri før skjemaet er migrert og verifisert. Autoritativt:
`docs/release-og-deploy.md`.

Tilstanden ligger i `localStorage` per konto og synkes mot Supabase (Auth +
relasjonelle tabeller med RLS). Appen har ingen anonym modus.

UI-et finnes på **norsk og engelsk**, og brukeren velger selv (også før
innlogging). All brukerrettet tekst går gjennom ordboken i `i18n.js` —
`tr('nøkkel')` i `app.js`, `data-i18n` i `index.html`. En norsk streng skrevet
rett inn i koden finnes ikke på engelsk, og `tests/i18n.test.js` stopper den.
Autoritativt: `docs/sprak.md`.

UI-et finnes også i **lys og mørk drakt**, og brukeren velger selv (også før
innlogging). Drakten er ÉN blokk med fargetokens i `styles.css` pluss ett
speilet L-sett i paletten — ingen egne mørke regler, ingen duplisert geometri.
Valget lagres kun på enheten (`theme.js`, lastet i `<head>` så attributtet står
der før første maling). Autoritativt: `docs/mork-drakt.md`.

De norske ordene i UI-et og dokumentasjonen er **område** og **mappe**;
identifikatorene i koden og databasen heter fortsatt `universe` og `group`
(kolonner, tabeller, CSS-klasser, funksjonsnavn). Døp dem ikke om — det er
databasekontrakten.

Autoritativt for hvem som får gjøre hva: `docs/rettigheter-og-deling.md`. Kart
over resten av dokumentasjonen: `docs/README.md`.

## Kommandoer

```bash
python3 -m http.server 8000   # kjør appen: http://localhost:8000
node build.js                 # produksjonsbuild → dist/ (samme steg som Vercel kjører)
tests/run-all.sh              # hele JS-suiten (starter server selv) — samme som CI

npm ci                        # kun for mobilskallet (Capacitor) — webappen trenger den ikke
npm run sync:android          # node build.js → kopier dist/ inn i android/
npm run android:debug         # samme, og bygg debug-APK (krever Android SDK)
```

- `?mock=1` bytter Supabase-klienten mot den hermetiske mock-backenden;
  `&lag=800` legger på kunstig serverforsinkelse.
- Tester: se `tests/CLAUDE.md` (nettleser + node) og `supabase/CLAUDE.md` (SQL).

## Før du endrer kode

- Finn eksisterende implementasjon og eventuell test først. `app.js` er stor og
  seksjonsinndelt — søk i den før du antar at noe ikke finnes.
- Les kun dokumentene oppgaven faktisk berører; `docs/README.md` sier hvilke.
- Trenger du å vite HVORFOR koden er som den er, bruk git-historikken
  (`git log -S '<symbol>'`, `git log -p <fil>`). Dokumentene beskriver
  nåtilstanden, ikke veien dit.

## Implementering

- Gjør den minste sammenhengende endringen som løser oppgaven. Ingen
  uvedkommende refaktorering, abstraksjon eller feature flags.
- Klient og database endres SAMMEN: et felt klienten skriver må finnes i
  `supabase/users-and-sharing.sql`, ellers avviser PostgREST hver skriving og
  synken stopper. Se `supabase/CLAUDE.md`.
- All autorisasjon håndheves serverside. Klientens gating er kun UX, og skal
  feile LUKKET: mangler capabilities fra serveren, skjul kontrollen.
- Opprettelse og flytting spør FORELDEREN om lov, ikke objektet selv —
  myndigheten ligger på nivået over (`docs/rettigheter-og-deling.md`).
- Endringer i område-/mappe-UI-et treffer liste-/listepunkt-UI-et og omvendt
  (delte klasser, delt DnD-politikk). Sjekk begge — og husk at de to scopene har
  hver sin MOTOR under seg fram til migreringen er ferdig.
- Valider ved systemgrensene (brukerinput, svar fra Supabase), ikke internt.
- Endrer du en invariant, oppdater det autoritative dokumentet i `docs/` i samme
  endring. Skriv nåtilstanden, ikke endringshistorikk («siste runde» o.l.) —
  historikken hører hjemme i git og PR-en.
- Jobb autonomt når kravene kan utledes av repoet. Spør bare når det som mangler
  påvirker korrekthet, sikkerhet, destruktive handlinger eller oppgavens reelle
  omfang.

## Verifisering

Kjør den minste verifikasjonen som gir troverdig evidens for endringen:

| Endringen gjelder | Verifisering |
|---|---|
| Dokumentasjon/kommentarer | ingen nettlesertest |
| SQL i `supabase/` | SQL-testsuiten — `supabase/CLAUDE.md` |
| Avgrenset klientlogikk | de(n) relevante testen(e) i `tests/` |
| Brukerrettet UI | ekte nettleser (Playwright), + skjermbilde ved visuell endring |
| Responsiv eller pekeravhengig oppførsel | både desktop- og mobil-viewport |
| Auth, synk eller deling | mock-backend (`?mock=1`) + den relevante flerbrukerflyten |
| Deploy, caching, build-output | `node build.js` og `node tests/build-version.test.js` |
| Capacitor, `android/`, npm-tooling | `node tests/capacitor-android.test.js` + `node tests/build-version.test.js`, og Android debug-APK-workflowen |
| Sikkerhetsheadere, CSP, tredjepartsressurser | `node tests/security-headers.test.js` + `node tests/csp-enforced.test.js` |
| Releaseprosessen (workflows, `vercel.json`, smoke-test) | `node tests/release-pipeline.test.js` + `node tests/db-contract.test.js`, og SQL-suiten hvis `smoke-test.sql` er endret |

Retter du en feil, skal en test fange den — ny test, eller en ny sjekk i den
filen som allerede dekker området.

Rapporter nøyaktig hvilke kommandoer og tester som ble kjørt, og hva de ga. Si
eksplisitt fra om noe ikke er verifisert; ikke påstå at noe er verifisert uten
et faktisk resultat fra økten.

## PR-er

- Utvikle på egen gren, og send lenken til PR-en når den er opprettet.
- Sjekk-inn-timer etter opprettet PR: maks 5 minutter — det tar sjelden lenger
  før tester er ferdige og reviewere har sett på den.
