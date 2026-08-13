# Release og deploy

Autoritativ for hvordan kode og skjema når produksjon: rekkefølgen, portene
mellom leddene, og hva som skjer når noe feiler.

Grunnregelen: **en frontend som avhenger av nye databaseendringer kan ikke
publiseres før migreringen er kjørt og verifisert.** Alt under er mekanikken
som håndhever det.

## De to workflowene

| Fil | Kjører når | Gjør |
|---|---|---|
| `.github/workflows/ci.yml` | hver pull request (og som ledd 1 i release) | hele testsuiten: JS (node + nettleser, delt på shards etter målt kjøretid — `tests/CLAUDE.md`), SQL (begge løp + smoke-testen) og produksjonsbuilden |
| `.github/workflows/release.yml` | push til `main`, eller manuelt | tester → migrering → smoke-test → produksjonsdeploy |

`ci.yml` rører ingenting utenfor sin egen runner: JS-testene kjører mot
mock-backenden (`?mock=1`), SQL-testene mot en fersk PostgreSQL i en
service-container. Den har ikke tilgang til `SUPABASE_DB_URL`.

Repoet har én workflow til, `android-debug.yml`, som står helt utenfor denne
kjeden: den pakker `dist/` inn i en Android debug-APK og laster den opp som
artifact. Den migrerer ingenting og deployer ingenting — se
[`mobilapp-plan.md`](mobilapp-plan.md). `tests/release-pipeline.test.js` holder
den (og enhver annen ny workflow) utenfor migreringen og produksjonsdeployen.

## Rekkefølgen ved merge til `main`

```
1. tester      ci.yml gjenbrukt via workflow_call
                 ↓ needs
2. migrering   psql: supabase/setup.sql + supabase/users-and-sharing.sql
                 ↓ needs                 (begge idempotente, lock_timeout=15s,
                                          tre forsøk med økende pause)
3. smoke       psql: supabase/smoke-test.sql
                 ↓ needs                 (read-only transaksjon mot produksjon)
4. deploy      preflight mot Vercels API → vercel deploy --prod
```

Builden i ledd 4 kjører HOS Vercel, ikke på runneren — altså som da
git-integrasjonen deployet `main`, bare startet fra denne jobben i stedet.
Porten er uendret: jobben ligger bak `needs: smoke`, så opplastingen skjer
først etter at migreringen er verifisert.

Hvert ledd er en egen jobb med `needs` på det forrige. Stopper ledd 2 eller 3,
kjøres ledd 4 aldri — produksjon fortsetter å servere den forrige frontenden.

Migreringen kjøres på HVER release, ikke bare når SQL-filene er endret. Begge
filene er idempotente, og en betingelse som ikke kjørte er en betingelse som kan
være feil: det er billigere å kjøre en no-op enn å oppdage at skjemaet henger
etter.

### Hvorfor migrering og deploy aldri kjører parallelt

Vercels egen git-deploy for `main` er slått av i `vercel.json`:

```json
"git": { "deploymentEnabled": { "main": false } }
```

Uten dette starter Vercel en produksjonsbuild i samme sekund som mergen lander,
og løper om kapp med migreringen — nøyaktig den situasjonen som brøt
lister/listepunkt-synken (klienten sendte `cards`/`items.collapsed` før kolonnene
fantes). Nå har produksjonsdeployen bare én vei inn: `deploy`-jobben i
`release.yml`, som ligger bak `needs: smoke`.

I tillegg serialiserer én concurrency-gruppe (`huskis-release`,
`cancel-in-progress: false`) hele workflowen, så to raske merger etter hverandre
ikke kan overlappe hverandres DDL.

`tests/release-pipeline.test.js` sjekker at alle disse leddene fortsatt henger
sammen.

### Preview-deploys

Bare `main` er tatt ut av git-deployen. Alle andre grener får preview-deploys
som før, uten å vente på noen migrering — de er ikke koblet til
release-kjeden.

En preview bygges av samme `build.js` og peker på det samme Supabase-prosjektet
som produksjon (`config.js`), så en preview har ikke egne produksjonsdata og
skal ikke brukes til å teste et skjema som ennå ikke er migrert. Vil du se en
endring uten å røre ekte data, bruk mock-backenden: `?mock=1`.

Nettopp derfor er preview-deployen det ene bygget som beholder testmodusen:
`build.js` fjerner den fra alle andre bygg, men lar den stå når Vercel setter
`VERCEL_ENV=preview` (se [`sikkerhetsheadere.md`](sikkerhetsheadere.md)).
Produksjonsdeployen har den aldri, så `?mock=1` gjør ingenting på `huskis.no`.

## Smoke-testen

`supabase/smoke-test.sql` svarer på ett spørsmål: **finnes og virker alt den
nye frontenden trenger?** Kontrakten er hentet fra klienten, ikke fra skjemafila:

1. tabellene i `TABLE`-mappingen i `app.js`
2. hver kolonne `insertPayload()`/`updatePayload()` sender — mangler én,
   avviser PostgREST HVER skriving for radtypen, usynlig
3. at RLS er på, og at alle 24 policyene finnes
4. de 15 RPC-ene klienten kaller, med riktig signatur, `execute` for
   `authenticated` og ikke for `anon`
5. capability-funksjonene, vaktene og gravsteinstriggerne
6. tabellrettighetene for `authenticated` og `anon`
7. at de seks tabellene klienten abonnerer på ligger i `supabase_realtime`
8. **funksjonelt**: `get_my_doc()` kalt som en innlogget, ukjent bruker
   returnerer et komplett, tomt doc — og `anon` avvises på både tabeller og RPC

Den kjører i ÉN `read only`-transaksjon som avsluttes med `rollback`, med
`statement_timeout` og `lock_timeout` satt. Den kan ikke skrive og tar ikke
tyngre låser enn `ACCESS SHARE` — derfor er den trygg mot produksjon med
brukere innlogget.

Alle brudd samles opp og rapporteres SAMLET til slutt, så én kjøring viser alt
som mangler.

To tester holder den ærlig:

- `tests/db-contract.test.js` leser `app.js` og krever at hver kolonne, tabell
  og `.rpc(...)` klienten bruker faktisk sjekkes av smoke-testen — og at hver
  `execute`-grantede RPC i `users-and-sharing.sql` står der med samme signatur.
- `supabase/tests/run-tests.sh` kjører smoke-testen mot et ferdig migrert skjema
  i begge løp (nytt skjema og oppgradert gammelt), så den er bevist grønn før
  den får lov til å blokkere en deploy.

## Feil, retry og rollback

**Testene (ledd 1) feiler** → ingenting er rørt. Fiks og push på nytt.

**Migreringen (ledd 2) feiler** → jobben prøver hver fil inntil tre ganger med
10/20 sekunders pause. `lock_timeout=15s` gjør at en DDL som blir stående og
vente gir opp raskt i stedet for å holde på låsene sine mens køen bygger seg
opp. Holder det ikke, stopper releasen og deployen skjer ikke.
Databasen kan da stå halvmigrert. Fordi begge filene er idempotente, er
responsen å kjøre releasen på nytt (Actions → «Release» → «Re-run failed
jobs»), ikke å rette manuelt. Den forrige frontenden er fortsatt i produksjon
og fungerer, fordi skjemaendringer er additive
([`supabase/CLAUDE.md`](../supabase/CLAUDE.md)).

**Smoke-testen (ledd 3) feiler** → databasen er migrert, men ikke komplett.
Deployen stoppes med vilje. Feilmeldingen lister nøyaktig hva som mangler.
Ingen automatisk retry her: enten er skjemaet riktig, eller så skal deployen
stoppe. Vanligste årsak er en halvfullført migrering — kjør releasen på nytt.
Er det skjemafila som mangler noe klienten sender, er fiksen en ny PR som
legger kolonnen/funksjonen inn, ikke å hoppe over porten.

**Deployen (ledd 4) feiler** → databasen er migrert og verifisert, men den nye
frontenden ble ikke publisert. Produksjon serverer fortsatt den forrige, som
virker mot det migrerte skjemaet. Kjør `deploy`-jobben på nytt.

Jobben starter med et preflight-kall mot Vercels API, fordi CLI-en svarer
«Could not retrieve Project Settings» på alt som går galt — ugyldig token,
token uten tilgang og feil prosjekt-ID gir samme setning. Preflighten skiller
dem: 401 = tokenet er ugyldig eller utløpt, 403 = tokenets scope dekker ikke
prosjektet, 404 = `VERCEL_PROJECT_ID` og `VERCEL_ORG_ID` hører ikke sammen.
Bare statuskoden og Vercels egen feilmelding logges; tokenet forlater aldri
runneren.

Jobben kjører bevisst verken `vercel pull` eller `vercel build`. Begge krever at
runneren har hele prosjektkonfigurasjonen liggende lokalt — `vercel build`
avviser med «No Project Settings found locally» uten `settings`-blokken som kun
`vercel pull` skriver. Å gjette den fasongen selv er en unødvendig feilkilde.
Vercel kjenner sine egne innstillinger, så jobben skriver bare
`.vercel/project.json` med de to ID-ene og lar Vercel bygge.

**Rollback av frontenden**: rull tilbake i Vercel (Deployments → den forrige
produksjonsdeployen → «Promote to Production», eller `vercel rollback`). Det er
trygt fordi skjemaendringer er additive: den forrige klienten skriver et
delsett av kolonnene som nå finnes.

**Rollback av skjemaet** finnes ikke som eget steg, og skal ikke lages. En
kolonne fjernes tidligst en runde etter at klienten sluttet å bruke den — å
droppe den samtidig ville brutt den klienten som fortsatt kjører i folks faner.
Å rette et skjema betyr å rulle FRAMOVER: en ny PR som endrer
`users-and-sharing.sql` og kjører gjennom den samme kjeden.

### Kun migrering, uten deploy

Actions → «Release» → «Run workflow» → huk av «Kjør kun migrering +
smoke-test». Samme concurrency-gruppe, så den kan heller ikke overlappe med en
pågående release.

## Secrets

| Secret | Hvor den hentes | Brukes av |
|---|---|---|
| `SUPABASE_DB_URL` | Supabase → Project Settings → Database → Connection string → URI, med passordet satt inn | migrering + smoke |
| `VERCEL_TOKEN` | Vercel → Account Settings → Tokens. Scope kan være teamet (`peohols-projects`) ELLER bare prosjektet (`peohols-projects/huskis`) — deployjobben er bygget for at project-scope skal holde | deploy |
| `VERCEL_ORG_ID` | `.vercel/project.json` etter `vercel link` | deploy |
| `VERCEL_PROJECT_ID` | samme fil | deploy |

Mangler en av dem, feiler jobben med en eksplisitt melding om hvilken — den
feiler ALDRI stille videre til neste ledd. Merk at siden Vercels git-deploy for
`main` er av, er `VERCEL_TOKEN`/`ORG_ID`/`PROJECT_ID` nå det eneste som kan
publisere til produksjon.

`SUPABASE_DB_URL` må være den DIREKTE tilkoblingen (port 5432), ikke
pooler-URL-en (6543): både migreringen og smoke-testen kjører flerstegs
transaksjoner og `set local role`, som pgbouncer i transaction mode ikke
støtter.

`deploy`-jobben kjører i GitHub-miljøet `production`. Det er ikke nødvendig for
rekkefølgen — den holdes av `needs`-kjeden — men gir et sted å slå på manuell
godkjenning eller egne miljø-secrets senere.

## Se også

- [`auto-update.md`](auto-update.md) — build-ID, `/version.json` og hvordan
  åpne faner oppdager en ny deploy
- [`supabase/CLAUDE.md`](../supabase/CLAUDE.md) — reglene for selve
  skjemaendringen (idempotens, additivitet)
- [`tests/CLAUDE.md`](../tests/CLAUDE.md) — hvordan testene kjøres lokalt
