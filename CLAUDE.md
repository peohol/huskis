# CLAUDE.md — Huskis

## Prosjekt

Huskis er en statisk vanilla-JS-app uten bundler, rammeverk eller
klientavhengigheter. Innholdet er hierarkisk: **Område > Mappe > Liste >
Listepunkt**, der en liste i tillegg kan ha ett nivå med **kategorier**.

De to øverste nivåene er bygget av nøyaktig samme komponenter og samme
dra-og-slipp-motor som de to nederste: et område ER et kort, en mappe ER en
rad. Motoren kjører i to scope — `boardScope` (listevisningen) og `navScope`
(navigasjonsmodalen) — så en endring i den treffer begge nivåene.

**Kildekode** (det som deployes): `index.html`, `styles.css`, `app.js`,
`icons.js`, `config.js`, `update-check.js`, `assets/`, `vendor/`
(supabase-js som innsjekket, uendret kopi — `docs/sikkerhetsheadere.md`).
`dev-mock.js` og
`mock-backend.js` er testmodus (`?mock=1`) og blir IKKE med i produksjons-
deployen — `build.js` fjerner både filene og taggen som laster dem. Kun
preview-deployer beholder dem (`docs/sikkerhetsheadere.md`).

**Generert output**: `dist/`, laget av `node build.js` — ikke sjekket inn, og
ingenting skal redigeres der. Byggesteget kopierer kildefilene og stempler en
build-ID inn i `index.html` + `version.json`; i repoet står build-ID-en på `dev`
med vilje, slik at lokal utvikling ikke trigger auto-oppdatering.

**Serversiden** er `supabase/users-and-sharing.sql` — én idempotent fil med
tabeller, RLS, triggere og RPC-er.

**Releaseprosessen**: ved merge til `main` kjører `.github/workflows/release.yml`
tester → migrering → smoke-test → Vercel-deploy, i den rekkefølgen. Frontenden
publiseres aldri før skjemaet er migrert og verifisert. Autoritativt:
`docs/release-og-deploy.md`.

Tilstanden ligger i `localStorage` per konto og synkes mot Supabase (Auth +
relasjonelle tabeller med RLS). Appen har ingen anonym modus.

Autoritativt for hvem som får gjøre hva: `docs/rettigheter-og-deling.md`. Kart
over resten av dokumentasjonen: `docs/README.md`.

## Kommandoer

```bash
python3 -m http.server 8000   # kjør appen: http://localhost:8000
node build.js                 # produksjonsbuild → dist/ (samme steg som Vercel kjører)
tests/run-all.sh              # hele JS-suiten (starter server selv) — samme som CI
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
  (delte klasser, delt DnD-motor). Sjekk begge.
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
