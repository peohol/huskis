#!/usr/bin/env node
/* ============================================================
   Vakt for releaserekkefølgen: en frontend som avhenger av nye
   databaseendringer skal ALDRI kunne publiseres før migreringen er kjørt og
   smoke-testet.

   Rekkefølgen er ikke kode i appen — den ER `needs`-kjeden i
   .github/workflows/release.yml pluss den avslåtte git-deployen i vercel.json.
   Faller ett av de leddene ut (noen fjerner en `needs`, slår git-deployen på
   igjen, eller legger inn en snarvei som deployer utenom kjeden), er
   sikringen borte uten at noen test ellers merker det. Derfor sjekkes den her.

   Dekker:
     1. release.yml kjører på push til main og har én serialiserende
        concurrency-gruppe som ikke avbryter en pågående kjøring
     2. kjeden tester → migrering → smoke → deploy henger sammen med `needs`
     3. migreringsjobben kjører begge SQL-filene, smoke-jobben smoke-test.sql
     4. `vercel deploy --prod` finnes KUN i jobben som `needs: smoke`
     5. vercel.json slår av Vercels egen git-deploy for main (ellers ville
        Vercel deployet parallelt med migreringen)
     6. ingen ANNEN workflow migrerer databasen eller deployer til produksjon
     7. ci.yml kjører både JS- og SQL-suiten, og gjenbrukes av release.yml —
        og nettstegene der kan ikke henge til jobbens timeout
     8. deployjobben sjekker Vercel-tilgangen FØR den bygger, forklarer 401/403/
        404 hver for seg, og logger aldri tokenet — og bruker ikke `vercel pull`
     9. Vercel CLI-en er låst til en EKSAKT versjon (aldri `@latest`), definert
        ett sted og verifisert i jobben
    10. OTA-bundelen (fase 5): den bygges og signeres i den samme jobben som
        deployer — altså bak smoke-testen — og legges i treet FØR opplastingen.
        Signeringen er ikke bare påstått her: nøkkelparet lages i testen, hele
        veien zip → signatur → verifisering kjøres, og en endret byte eller feil
        nøkkel må gi et NEI. Grensene rundt den (nedre `versionCode`, at `ota/`
        faktisk publiseres, at secreten aldri skrives ut, cache- og
        CORS-headerne for manifest og bundle) sjekkes ved siden av.

   Ren node-test — ingen server, ingen nettleser.

   Kjør:
     node tests/release-pipeline.test.js
   ============================================================ */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const WF = path.join(ROOT, '.github', 'workflows');

let pass = 0, fail = 0;
function check(navn, ok, evidens) {
  if (ok) { pass++; console.log('PASS — ' + navn + (evidens ? '  [' + evidens + ']' : '')); }
  else { fail++; console.log('FAIL — ' + navn + (evidens ? '  [' + evidens + ']' : '')); }
}

const release = fs.readFileSync(path.join(WF, 'release.yml'), 'utf8');
const ci = fs.readFileSync(path.join(WF, 'ci.yml'), 'utf8');
const vercel = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));

/* «Denne workflowen gjør IKKE X»-sjekkene må lese det som faktisk kjører.
   En kommentar som forklarer hvorfor X ble fjernet inneholder jo X, og ville
   ellers få vakten til å slå ut på sin egen begrunnelse. */
function utenKommentarer(yaml) {
  return yaml.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
}

/* Deler `jobs:`-blokken i én tekstbit per jobb (jobbnavn står på to
   mellomrom). Nok struktur til å svare på «hva står i DENNE jobben», uten en
   YAML-parser — repoet har ingen avhengigheter. */
function jobber(yaml) {
  const start = yaml.indexOf('\njobs:');
  if (start === -1) return {};
  const kropp = yaml.slice(start + 6);
  const ut = {};
  const re = /^ {2}([a-zA-Z_][\w-]*):[ \t]*$/gm;
  const treff = [...kropp.matchAll(re)];
  treff.forEach((m, i) => {
    const slutt = i + 1 < treff.length ? treff[i + 1].index : kropp.length;
    ut[m[1]] = kropp.slice(m.index, slutt);
  });
  return ut;
}

const relJobs = jobber(release);
const ciJobs = jobber(ci);

/* ---- 1. Trigger + serialisering ---- */
check('release.yml kjører på push til main',
  /\n {2}push:\s*\n {4}branches:\s*\[main\]/.test(release));

const conc = release.match(/\nconcurrency:\s*\n(?: {2}.*\n|\s*#.*\n)*/);
check('release.yml har en concurrency-gruppe', !!conc);
check('concurrency-gruppen er én fast mappe (ikke per ref)',
  !!conc && /group:\s*huskis-release\s*$/m.test(conc[0]),
  conc ? (conc[0].match(/group:.*/) || [''])[0].trim() : '');
check('en pågående release avbrytes ikke (cancel-in-progress: false)',
  !!conc && /cancel-in-progress:\s*false/.test(conc[0]));

/* ---- 2. needs-kjeden ---- */
const kjede = [
  ['migrering', 'tester'],
  ['smoke', 'migrering'],
  ['deploy', 'smoke'],
];
check('release.yml har jobbene tester, migrering, smoke og deploy',
  ['tester', 'migrering', 'smoke', 'deploy'].every((j) => !!relJobs[j]),
  Object.keys(relJobs).join(' → '));
for (const [jobb, avhenger] of kjede) {
  check('«' + jobb + '» venter på «' + avhenger + '»',
    !!relJobs[jobb] && new RegExp('needs:\\s*' + avhenger + '\\s*$', 'm').test(relJobs[jobb]));
}
check('«tester» gjenbruker ci.yml',
  !!relJobs.tester && /uses:\s*\.\/\.github\/workflows\/ci\.yml/.test(relJobs.tester));

/* Web push-senderen (docs/varsler.md) deployes etter smoke-testen — den kaller
   `push_claim()`, som må finnes — men den er BEVISST ikke en port for
   frontenden: web push er en valgfri kanal, og en feilet funksjonsdeploy skal
   ikke holde en release tilbake. Begge halvdelene låses her, for det er
   nettopp en `needs`-linje som ellers kunne skli inn og gjøre kanalen til en
   port ingen har bestemt. */
check('«pushfunksjon» venter på smoke-testen (den kaller RPC-er migreringen lager)',
  !!relJobs.pushfunksjon && /needs:\s*smoke\s*$/m.test(relJobs.pushfunksjon));
check('… og deployjobben venter IKKE på den (web push er ikke en port for frontenden)',
  !!relJobs.deploy && !/needs:[\s\S]*pushfunksjon/.test(relJobs.deploy),
  (relJobs.deploy.match(/needs:.*/) || [''])[0].trim());
check('pushfunksjon-jobben deployer nøyaktig funksjonen push-send',
  !!relJobs.pushfunksjon &&
  /functions deploy push-send[\s\S]{0,60}--project-ref/.test(relJobs.pushfunksjon));
/* CLI-en kjøres med `npx` og en EKSAKT versjon. Begge halvdelene er ekte krav:

     · `npm install -g supabase@…` er ikke bare uvanlig — pakken NEKTER det.
       Postinstall-skriptet kaster «Installing Supabase CLI as a global module
       is not supported» så snart `npm_config_global` er satt, og jobben ville
       dødd på installasjonssteget. Den feilen er usynlig i CI så lenge
       secretene mangler (jobben hopper av før den kommer dit), så den må
       fanges her.
     · `@latest` i en produksjonsflyt gjør deployen uforutsigbar. */
// Kommentarlinjene ut først: jobben FORKLARER hvorfor den ikke gjør en global
// install, og den forklaringen skal ikke kunne leses som at den gjør det.
const pushKjør = (relJobs.pushfunksjon || '').split('\n')
  .filter((l) => !/^\s*#/.test(l)).join('\n');
check('… med en Supabase-CLI som faktisk lar seg kjøre (ikke global install)',
  !!relJobs.pushfunksjon && !/npm\s+(install|i)\b[^\n]*\bsupabase/i.test(pushKjør),
  (pushKjør.match(/npm[^\n]*supabase[^\n]*/i) || ['—'])[0]);
check('… kjørt med npx og en LÅST versjon (ingen @latest i en produksjonsflyt)',
  !!relJobs.pushfunksjon && /npx\s+(--yes\s+|-y\s+)?supabase@\d+\.\d+\.\d+\s/.test(pushKjør),
  (pushKjør.match(/supabase@[^\s]*/) || [''])[0]);
/* Senderen kalles av pg_cron gjennom pg_net, ikke av en innlogget bruker, og
   Supabases mønster for det er en secret key på `apikey`-headeren. En secret
   key er ikke et JWT, så plattformens JWT-verifisering må være AV — ellers
   avvises tikket før funksjonen får se nøkkelen. Porten er funksjonens egen
   sjekk. Uten flagget her ville web push stille sluttet å virke den dagen
   prosjektet går over til de nye nøklene. */
check('… og med JWT-verifisering AV (service-to-service, ikke en brukersesjon)',
  /--no-verify-jwt/.test(pushKjør), (pushKjør.match(/--no-verify-jwt/) || ['—'])[0]);
/* … og funksjonen må faktisk godta begge nøkkelgenerasjonene, ellers er
   flagget over bare et hull. */
const pushFn = fs.readFileSync(
  path.join(ROOT, 'supabase', 'functions', 'push-send', 'index.ts'), 'utf8');
check('senderen leser de NYE secret keys (SUPABASE_SECRET_KEYS) …',
  /SUPABASE_SECRET_KEYS/.test(pushFn));
check('… og faller tilbake på den gamle service_role-nøkkelen',
  /SUPABASE_SERVICE_ROLE_KEY/.test(pushFn));
const pushAuth = fs.readFileSync(
  path.join(ROOT, 'supabase', 'functions', 'push-send', 'auth.mjs'), 'utf8');
check('… og tar imot nøkkelen på apikey-headeren',
  /godkjentKaller\(req\.headers/.test(pushFn) && /headers\?\.\[n\]|les\('apikey'\)/.test(pushAuth));
check('… og sammenligner den uten tidslekkasje (ingen === på hemmeligheten)',
  /likeHemmeligheter/.test(pushAuth) && !/!==\s*'Bearer '/.test(pushFn));
/* De to nøkkelgenerasjonene skal IKKE ha de samme headerne: en `sb_secret_…`
   er ikke et JWT, og sendes den også på `Authorization: Bearer`, avviser
   plattformen hele kallet med «Invalid JWT». Avgjørelsen ligger ETT sted i
   hvert lag — `auth.mjs` og `push_headers()` — nettopp for at den skal kunne
   kjøres av en test. Den kjøringen er `tests/push-auth.test.js` og seksjon 11
   i `test-push.sql`; her låses bare at deployen ikke omgår dem. */
const pushSql = fs.readFileSync(
  path.join(ROOT, 'supabase', 'users-and-sharing.sql'), 'utf8');
check('push_tick() sender headerne push_headers() bestemmer',
  /headers := public\.push_headers\(svc_key\)/.test(pushSql));
check('… og hardkoder ikke en Authorization-header ved siden av',
  !/'Authorization', 'Bearer ' \|\| svc_key/.test(pushSql),
  (pushSql.match(/'Authorization'[^\n]*svc_key[^\n]*/) || ['—'])[0]);
check('… og hopper stille over når secretene ikke er satt (kanalen er valgfri)',
  !!relJobs.pushfunksjon && /SUPABASE_ACCESS_TOKEN/.test(relJobs.pushfunksjon) &&
  /exit 0/.test(relJobs.pushfunksjon));
/* Web push slås PÅ utenfor repoet, men de to bryterne virker først ved NESTE
   release-kjøring: funksjonsdeployen over hopper over seg selv til
   GitHub-secretene finnes, og `huskis-push-tick` registreres av skjemafila,
   altså av migreringsjobben, først når pg_cron er slått på. Følger man
   runbooken i TODO.md uten en avsluttende kjøring, står derfor alt riktig satt
   opp uten at noe tikker. Det siste steget må finnes — og workflowen må
   faktisk kunne startes for hånd, ellers er steget en instruksjon ingen kan
   følge. */
const todo = fs.readFileSync(path.join(ROOT, 'TODO.md'), 'utf8');
check('skjemafila registrerer pg_cron-jobben (den skjer i migreringen, ikke i Supabase-UI-et)',
  /cron\.schedule\('huskis-push-tick'/.test(pushSql));
check('… release.yml kan startes manuelt, som TODO.md sitt siste push-steg krever',
  /^\s{2}workflow_dispatch:/m.test(release));
check('… og TODO.md ber faktisk om den avsluttende kjøringen',
  /Kjør «Release» én gang til, manuelt/.test(todo) && /huskis-push-tick/.test(todo));

// Selve funksjonen og krypteringen den bruker skal finnes i treet — ellers
// deployer jobben over ingenting.
['supabase/functions/push-send/index.ts', 'supabase/functions/push-send/webpush.mjs',
 'supabase/functions/push-send/auth.mjs']
  .forEach((f) => check(f + ' finnes',
    fs.existsSync(path.join(ROOT, f))));

/* ---- 3. Hva jobbene faktisk gjør ---- */
check('migreringsjobben kjører setup.sql',
  !!relJobs.migrering && /supabase\/setup\.sql/.test(relJobs.migrering));
check('migreringsjobben kjører users-and-sharing.sql',
  !!relJobs.migrering && /supabase\/users-and-sharing\.sql/.test(relJobs.migrering));
check('smoke-jobben kjører supabase/smoke-test.sql',
  !!relJobs.smoke && /supabase\/smoke-test\.sql/.test(relJobs.smoke));
check('smoke-jobben stopper på feil (ON_ERROR_STOP)',
  !!relJobs.smoke && /ON_ERROR_STOP=1/.test(relJobs.smoke));
check('migreringen prøver på nytt ved feil',
  !!relJobs.migrering && /forsok/.test(relJobs.migrering));
check('migreringen setter lock_timeout mot den levende databasen',
  !!relJobs.migrering && /lock_timeout/.test(relJobs.migrering));

/* ---- 4. Produksjonsdeploy skjer KUN etter smoke-testen ---- */
const deployJobber = Object.entries(relJobs)
  .filter(([, tekst]) => /vercel\s+deploy[^\n]*--prod/.test(tekst))
  .map(([navn]) => navn);
check('nøyaktig én jobb kjører `vercel deploy --prod`',
  deployJobber.length === 1, deployJobber.join(', ') || 'ingen');
check('den jobben er «deploy», som venter på smoke-testen',
  deployJobber[0] === 'deploy');
/* Builden kjører hos Vercel, ikke på runneren: `--prebuilt` ville krevd at
   `vercel build` fikk hele prosjektkonfigurasjonen lokalt, og den skrives kun
   av `vercel pull`. Kommer `--prebuilt` tilbake uten `pull`, feiler deployen
   med «No Project Settings found locally». */
check('deployen lar Vercel bygge (ikke --prebuilt)',
  !!relJobs.deploy && !/--prebuilt/.test(utenKommentarer(relJobs.deploy)));
check('deployjobben bygger ikke lokalt med `vercel build`',
  !!relJobs.deploy && !/vercel build/.test(utenKommentarer(relJobs.deploy)));
/* build.js leser GITHUB_SHA som fallback for `commit` i /version.json. Uten at
   den sendes inn i Vercel-builden blir feltet null, siden treet lastes opp fra
   CLI-en og ikke har git-metadata. */
check('commit-en følger med inn i Vercel-builden',
  !!relJobs.deploy && /--build-env\s+"?GITHUB_SHA=/.test(relJobs.deploy));

/* Preflighten er der for at en feil skal si HVA som er galt i stedet for
   Vercels generiske «Could not retrieve Project Settings». Den må kjøre før
   deployen, ellers er den verdiløs — da har CLI-en allerede feilet.
   Ankeret er `vercel deploy`, som finnes: en indexOf mot et steg som er
   fjernet ville gitt -1 og snudd sammenligningen til en stille pass. */
const iPreflight = relJobs.deploy ? relJobs.deploy.indexOf('api.vercel.com') : -1;
const iDeploy = relJobs.deploy ? relJobs.deploy.indexOf('vercel deploy') : -1;
check('deployjobben sjekker Vercel-tilgangen før den deployer',
  iPreflight > -1 && iDeploy > -1 && iPreflight < iDeploy,
  'preflight@' + iPreflight + ', deploy@' + iDeploy);
for (const kode of ['401', '403', '404']) {
  check('preflighten forklarer HTTP ' + kode + ' konkret',
    !!relJobs.deploy && new RegExp('^\\s*' + kode + '\\)', 'm').test(relJobs.deploy));
}
/* ---- 4b. Vercel CLI-en er låst til en eksakt versjon ----
   `@latest` gjør deployen ikke-reproduserbar: en ny CLI-utgivelse kan endre
   oppførselen uten at repoet har endret seg, og utgivelsene kommer tett.
   Versjonen skal stå ETT sted (workflow-env) og brukes derfra. */
const cliVersjon = (release.match(/^\s*VERCEL_CLI_VERSION:\s*'([^']+)'/m) || [])[1];
check('release.yml definerer VERCEL_CLI_VERSION ett sted',
  !!cliVersjon, cliVersjon || 'mangler');
check('versjonen er eksakt (ingen ^, ~, x eller «latest»)',
  !!cliVersjon && /^\d+\.\d+\.\d+$/.test(cliVersjon), cliVersjon || '');
check('ingenting installerer vercel@latest',
  !/vercel@latest/.test(utenKommentarer(release)));
check('installasjonssteget bruker den definerte versjonen',
  !!relJobs.deploy
    && /npm install -g "?vercel@\$\{VERCEL_CLI_VERSION\}"?/.test(utenKommentarer(relJobs.deploy)),
  (utenKommentarer(relJobs.deploy || '').match(/npm install -g[^\n]*/) || [''])[0].trim());
/* Å installere riktig versjon er ikke det samme som å KJØRE den: en npm-cache
   eller et forhåndsinstallert globalt CLI på runneren kan legge seg foran. */
check('deployjobben verifiserer at den låste versjonen faktisk kjører',
  !!relJobs.deploy && /vercel --version/.test(utenKommentarer(relJobs.deploy)));

/* Uten tidsgrenser henger curl i det ene tilfellet 000-grenen finnes for: et
   API som tar imot forbindelsen og så tier. Da spises jobbens timeout og
   diagnostikken sier ingenting. */
check('preflighten har tidsgrense på både oppkobling og overføring',
  !!relJobs.deploy && /--connect-timeout\s+\d+/.test(relJobs.deploy)
    && /--max-time\s+\d+/.test(relJobs.deploy));
check('tidsgrensene er kortere enn jobbens timeout',
  !!relJobs.deploy
    && Number((relJobs.deploy.match(/--max-time\s+(\d+)/) || [])[1]) * 3
       < Number((relJobs.deploy.match(/timeout-minutes:\s*(\d+)/) || [])[1]) * 60,
  'max-time=' + (relJobs.deploy.match(/--max-time\s+(\d+)/) || [])[1] + 's, '
    + 'jobb-timeout=' + (relJobs.deploy.match(/timeout-minutes:\s*(\d+)/) || [])[1] + 'min');

check('preflighten logger aldri selve tokenet',
  !!relJobs.deploy && !/echo[^\n]*\$VERCEL_TOKEN/.test(utenKommentarer(relJobs.deploy))
    && !/cat \/tmp\/vc\.json/.test(utenKommentarer(relJobs.deploy)));

/* `vercel pull` henter miljøvariabler og krever bredere tilgang enn et
   project-scoped token. Appen er statisk og trenger ingen, så steget er ute —
   og `.vercel/project.json` skrives i stedet. Kommer `pull` tilbake, ryker
   deployen igjen for den som bruker minste-rettighet-token. */
check('deployjobben bruker ikke `vercel pull`',
  !!relJobs.deploy && !/vercel pull/.test(utenKommentarer(relJobs.deploy)));
check('deployjobben lenker prosjektet via .vercel/project.json',
  !!relJobs.deploy && /\.vercel\/project\.json/.test(relJobs.deploy));

/* ---- 5. Vercels egen git-deploy for main er av ---- */
check('vercel.json slår av git-deploy for main',
  vercel.git && vercel.git.deploymentEnabled
    && vercel.git.deploymentEnabled.main === false,
  JSON.stringify(vercel.git || null));
check('vercel.json slår IKKE av deploy for andre grener (preview lever videre)',
  !vercel.git || !vercel.git.deploymentEnabled
    || Object.keys(vercel.git.deploymentEnabled).every((b) => b === 'main'),
  Object.keys((vercel.git && vercel.git.deploymentEnabled) || {}).join(', '));

/* ---- 6. Ingen snarveier i andre workflowfiler ---- */
const andre = fs.readdirSync(WF)
  .filter((f) => /\.ya?ml$/.test(f) && f !== 'release.yml' && f !== 'ci.yml');
for (const f of andre) {
  const tekst = fs.readFileSync(path.join(WF, f), 'utf8');
  check(f + ' migrerer ikke databasen utenom release-kjeden',
    !/users-and-sharing\.sql/.test(utenKommentarer(tekst)));
  check(f + ' deployer ikke til produksjon utenom release-kjeden',
    !/vercel\s+deploy[^\n]*--prod/.test(utenKommentarer(tekst)));
}
check('ingen egen db-setup-workflow ved siden av release-kjeden',
  !fs.existsSync(path.join(WF, 'db-setup.yml')));

/* ---- 7. ci.yml dekker begge testsuitene ---- */
check('ci.yml kan gjenbrukes av release.yml (workflow_call)',
  /\n {2}workflow_call:/.test(ci));
check('ci.yml kjører på pull request', /\n {2}pull_request:/.test(ci));
check('ci.yml kjører JS-suiten', /tests\/run-all\.sh/.test(ci));
check('ci.yml kjører SQL-suiten', /supabase\/tests\/run-tests\.sh/.test(ci));
check('ci.yml bygger produksjonsbuilden', /node build\.js/.test(ci));
check('ci.yml rører ikke produksjonsdatabasen',
  !/SUPABASE_DB_URL/.test(utenKommentarer(ci)));
check('ci.yml deployer ikke',
  !/vercel\s+deploy/.test(utenKommentarer(ci)));

/* Nettstegene i JS-jobben kan ikke henge til jobbens timeout.

   2026-08-19 hang `playwright install-deps` inne i sitt eget `apt-get update`,
   mot et Ubuntu-speil som godtok forbindelsen, sendte headeren og så ble
   stille. Shard 3, 4 og 5 brukte hele jobbens 25 minutter uten å kjøre én
   testkropp, to runder på rad (run 32231446083). Det er ikke en testfeil, men
   loggen ser ut som en: siste linje er «The operation was canceled».

   Tre ting holder det borte, og alle tre kan fjernes uten at noen annen test
   merker det:
     · timeoutene må stå i apt-KONFIGURASJONEN. `playwright install-deps`
       kjører sitt EGET apt-get update inne i seg selv, så et forsteg med
       `-o Acquire::...` treffer ikke kallet som faktisk henger.
     · retryen må ligge rundt install-deps selv, og gi opp med ::error::, slik
       at en oppbrukt retry ser annerledes ut enn en ekte avhengighetsfeil.
     · stegene som går ut på nett må ha et tak under jobbens 25 minutter. */
const jsJobb = ciJobs.js || '';
const jsTak = Number((jsJobb.match(/^ {4}timeout-minutes:\s*(\d+)/m) || [])[1]);

/* Deler en jobb i ett tekststykke per steg. Kommentarene er strippet først:
   forklaringen over cachesteget nevner «timeout-minutes» i prosa, og en vakt
   som leser sin egen begrunnelse er ingen vakt. */
function stegene(jobb) {
  const ut = [];
  let cur = null;
  for (const l of utenKommentarer(jobb).split('\n')) {
    if (/^ {6}- /.test(l)) { if (cur) ut.push(cur.join('\n')); cur = [l]; }
    else if (cur) cur.push(l);
  }
  if (cur) ut.push(cur.join('\n'));
  return ut;
}
const jsSteg = stegene(jsJobb);
const stegMed = (frag) => jsSteg.find((s) => s.includes(frag)) || '';
const harTak = (s) => Number((s.match(/^\s*timeout-minutes:\s*(\d+)/m) || [])[1]) || 0;

const deps = stegMed('install-deps chromium');

/* Takene er BAKSTOPPERE, hvert for sitt steg — ikke budsjetter stegene må
   holde seg innenfor. Forskjellen er målt, ikke prinsipiell: i run 32246391806
   brukte de seks shardene 21/32/38/42/283 sekunder på det samme steget, og et
   tak på 6 minutter felte den sjette. Hele spredningen er apt-speilets
   hastighet — de samme 21,1 MB lastes ned på alt fra 12 s til 2min 32s.

   Men fordi hvert tak er en bakstopper, er SUMMEN av dem med vilje større enn
   jobbens tak (3 + 12 + 20 = 35 mot 25). Da må to ting holde, og ingen av dem
   følger av at hvert enkelt tak er under jobbens:

     1. Det må stå igjen et GULV til install-deps selv når stegene foran bruker
        hele taket sitt — ellers kan et cache-bom spise budsjettet, og jobbens
        tak slår inn før noe steg rekker å si fra selv. Det er nettopp den
        anonyme «The operation was canceled» hele blokken finnes for å unngå.
     2. Fristen i retry-løkka må regnes ut fra hvor mye av jobbens budsjett som
        FAKTISK er igjen. En fast frist vet ikke hva stegene foran brukte. */
const OPPSTART_MIN = 1;   // checkout + setup-node + cache: målt 4–12 s
const TESTRESERVE_MIN = 4; // tregeste målte shard: 2min 38s

const pwTak = harTak(stegMed('npm install -g playwright'));
const chromeTak = harTak(stegMed('playwright install chromium'));
const gulv = jsTak - OPPSTART_MIN - pwTak - chromeTak - TESTRESERVE_MIN;

check('install-deps har sitt eget tak, under jobbens',
  harTak(deps) > 0 && harTak(deps) < jsTak,
  `steg ${harTak(deps)} min mot jobbens ${jsTak} min`);

check('det står igjen et gulv til install-deps selv ved cache-bom',
  gulv >= 5,
  `${jsTak} − ${OPPSTART_MIN} oppstart − ${pwTak} playwright − ${chromeTak} chromium ` +
  `− ${TESTRESERVE_MIN} testreserve = ${gulv} min igjen`);

/* Fristen må være budsjettstyrt, ikke et fast tall. */
check('løkka leser jobbens starttid i stedet for å gjette',
  /JOBB_START/.test(deps) && /date \+%s/.test(deps),
  'ellers vet ikke fristen hva stegene foran brukte');

check('jobbens starttid blir faktisk satt, og før nettstegene',
  /JOBB_START=\$\(date \+%s\)" >> "\$GITHUB_ENV"/.test(jsJobb) &&
  jsJobb.indexOf('JOBB_START=$(date') < jsJobb.indexOf('install-deps chromium'));

/* Regnestykket i skriptet må bruke jobbens EGET tak. Endrer noen
   timeout-minutes på jobben uten å endre skriptet, driver de fra hverandre og
   fristen blir stille feil. */
const takIskript = Number((deps.match(/JOBB_TAK_S=\$\(\((\d+) \* 60\)\)/) || [])[1]);
check('skriptets jobbtak er det samme som jobbens timeout-minutes',
  takIskript === jsTak,
  `skript ${takIskript} min mot jobbens ${jsTak} min`);

const reserveIskript = Number((deps.match(/TEST_RESERVE_S=\$\(\((\d+) \* 60\)\)/) || [])[1]);
check('skriptet holder av en testreserve som dekker den tregeste sharden',
  reserveIskript >= TESTRESERVE_MIN,
  `${reserveIskript} min avsatt`);

for (const [navn, frag] of [['npm install -g playwright', 'npm install -g playwright'],
                            ['playwright install chromium', 'playwright install chromium']]) {
  check(`nedlastingssteget «${navn}» har et tak`,
    harTak(stegMed(frag)) > 0, `${harTak(stegMed(frag))} min`);
}

/* Shell-blokkene må holde som bash. To feilklasser, og `bash -n` fanger bare
   den ene:

     · ubalanserte sitater, en heredoc som ikke lukkes, et manglende `done` —
       parsefeil, og dem tar `bash -n`.
     · et ugyldig variabelnavn. `for forsøk in 1 2 3` PARSER fint; bash sier
       først «`forsøk': not a valid identifier» når linja kjøres. I et repo
       der alt annet skrives på norsk er det en nærliggende feil å gjøre, og
       den viser seg da først i CI.

   Den andre fanges ved å strippe kommentarer, sitater og heredoc-kropper —
   der HØRER norsk hjemme — og kreve at det som står igjen, selve koden, er
   ren ASCII. */
function kodedel(skript) {
  let ut = '', heredoc = null;
  for (const linje of skript.split('\n')) {
    if (heredoc !== null) { if (linje.trim() === heredoc) heredoc = null; continue; }
    let i = 0, kode = '';
    while (i < linje.length) {
      const c = linje[i];
      if (c === '\\') { i += 2; continue; }
      if (c === '#' && (i === 0 || /\s/.test(linje[i - 1]))) break;
      if (c === "'") { const slutt = linje.indexOf("'", i + 1); i = slutt === -1 ? linje.length : slutt + 1; continue; }
      if (c === '"') {
        i++;
        while (i < linje.length && linje[i] !== '"') i += linje[i] === '\\' ? 2 : 1;
        i++; continue;
      }
      kode += c; i++;
    }
    const hd = kode.match(/<<-?\s*'?([A-Za-z_][A-Za-z0-9_]*)'?/);
    if (hd) heredoc = hd[1];
    ut += kode + '\n';
  }
  return ut;
}

/* Trekker ut run-blokkene slik YAML leser dem: innrykket settes av første
   linje etter nøkkelen, og blokken slutter der innrykket blir mindre. Nok til
   å få tak i skriptet som faktisk kjører — repoet har ingen YAML-parser. */
function runBlokker(yaml) {
  const linjer = yaml.split('\n');
  const ut = [];
  for (let i = 0; i < linjer.length; i++) {
    /* Blokkformen først: «run: |» ville ellers blitt lest som en enlinjers
       kommando der selve |-tegnet er kommandoen. */
    if (!/^\s*(?:- )?run:[ \t]*\|-?[ \t]*$/.test(linjer[i])) {
      const enkel = linjer[i].match(/^\s*(?:- )?run:[ \t]+([^|>\s].*)$/);
      if (enkel) ut.push(enkel[1]);
      continue;
    }
    const kropp = [];
    let base = null;
    for (let j = i + 1; j < linjer.length; j++) {
      if (linjer[j].trim() === '') { kropp.push(''); continue; }
      const inn = linjer[j].length - linjer[j].replace(/^ +/, '').length;
      if (base === null) base = inn;
      if (inn < base) break;
      kropp.push(linjer[j].slice(base));
    }
    ut.push(kropp.join('\n'));
  }
  return ut;
}

for (const [fil, kilde] of [['ci.yml', ci], ['release.yml', release]]) {
  const blokker = runBlokker(kilde);
  const feil = [];
  blokker.forEach((b, i) => {
    /* ${{ ... }} er GitHub-uttrykk, ikke shell. De byttes ut med et vanlig ord
       så bash ser den fasongen den faktisk får utdelt. */
    const skript = b.replace(/\$\{\{[\s\S]*?\}\}/g, 'GHEXPR');
    const tmpfil = path.join(os.tmpdir(), `huskis-run-${process.pid}-${fil}-${i}.sh`);
    fs.writeFileSync(tmpfil, skript);
    const r = spawnSync('bash', ['-n', tmpfil], { encoding: 'utf8' });
    fs.unlinkSync(tmpfil);
    /* Også ADVARSLER teller. En heredoc som aldri lukkes gir exit 0 og bare
       «warning: here-document … delimited by end-of-file» på stderr — mens
       resten av blokken stilltiende er slukt som heredoc-innhold. */
    const klage = (r.stderr || '').trim();
    if (r.status !== 0 || klage) feil.push(`#${i}: ${klage.split('\n')[0]}`);
  });
  check(`alle run-blokkene i ${fil} parser som bash`,
    blokker.length > 0 && feil.length === 0,
    feil.length ? feil.join(' | ') : `${blokker.length} blokker`);

  const ikkeAscii = [];
  blokker.forEach((b, i) => {
    kodedel(b.replace(/\$\{\{[\s\S]*?\}\}/g, 'GHEXPR')).split('\n').forEach((l) => {
      if ([...l].some((c) => c.charCodeAt(0) > 126)) ikkeAscii.push(`#${i}: ${l.trim()}`);
    });
  });
  check(`ingen norske tegn i kodeposisjon i ${fil} (ugyldige variabelnavn)`,
    ikkeAscii.length === 0,
    ikkeAscii.length ? ikkeAscii.join(' | ') : `${blokker.length} blokker`);
}

/* SQL-suiten må faktisk kjøre smoke-testen, ellers kan den være ødelagt uten
   at noen ser det før den blokkerer en release. */
const sqlRunner = fs.readFileSync(path.join(ROOT, 'supabase', 'tests', 'run-tests.sh'), 'utf8');
check('SQL-suiten kjører smoke-testen mot et ferdig migrert skjema',
  /smoke-test\.sql/.test(sqlRunner),
  (sqlRunner.match(/smoke-test\.sql/g) || []).length + ' steder');

/* ---- 10. OTA-bundelen: bygget, signert og verifisert i release-kjeden ----

   Fase 5 publiserer en signert ZIP og ett manifest per støttet native nivå
   (docs/mobilapp-plan.md). Ingen klient leser dem ennå — denne runden
   produserer dem — men rekkefølgen og signaturen er nettopp det som ikke kan
   ettermonteres: en bundle bygget av en ANNEN commit enn den som ble migrert og
   smoke-testet, eller en signatur som ikke verifiserer, er stille feil helt
   fram til en telefon avviser bundelen. */
const otaSkript = '.github/scripts/ota-bundle.js';
const ota = require(path.join(ROOT, otaSkript));
const otaKilde = fs.readFileSync(path.join(ROOT, otaSkript), 'utf8');

check('signeringsskriptet finnes', fs.existsSync(path.join(ROOT, otaSkript)));
/* Repoet har ingen klientavhengigheter, og byggesteget skal ikke bli stedet der
   den første kommer inn. Signeringen er ren `crypto` fra Node. */
const otaRequire = [...otaKilde.matchAll(/require\('([^']+)'\)/g)].map((m) => m[1]);
check('skriptet bruker bare Nodes standardbibliotek (ingen ny avhengighet)',
  otaRequire.every((r) => ['fs', 'path', 'crypto', 'child_process'].indexOf(r) > -1),
  otaRequire.join(', '));

/* Rekkefølgen: bundelen skal bygges av den commiten som nettopp passerte
   smoke-testen, og ligge i treet før det lastes opp. Ankrene finnes begge, så
   en indexOf mot et fjernet steg kan ikke bli en stille pass. */
const otaJobber = Object.entries(relJobs)
  .filter(([, tekst]) => tekst.indexOf(otaSkript) > -1).map(([navn]) => navn);
check('nøyaktig én jobb bygger OTA-bundelen', otaJobber.length === 1,
  otaJobber.join(', ') || 'ingen');
check('den jobben er «deploy», som venter på smoke-testen', otaJobber[0] === 'deploy');
/* Indeksene måles i KODEN, ikke i teksten: kommentarene i jobben omtaler både
   `vercel deploy` og builden, og en rekkefølgesjekk mot dem ville målt hvor
   forklaringene står. */
const deployKode = utenKommentarer(relJobs.deploy || '');
const iOta = deployKode.indexOf(otaSkript);
const iBuild = deployKode.indexOf('node build.js');
const iOpplasting = deployKode.indexOf('vercel deploy');
check('OTA-bundelen bygges og signeres FØR treet lastes opp til Vercel',
  iOta > -1 && iOpplasting > -1 && iOta < iOpplasting,
  'ota@' + iOta + ', opplasting@' + iOpplasting);
check('webbuilden kjøres før bundelen pakkes (ZIP-en er dist/)',
  iBuild > -1 && iBuild < iOta, 'build@' + iBuild);
check('bundelen bygges av den samme commiten som deployes (GITHUB_SHA sendes inn)',
  !!relJobs.deploy && /GITHUB_SHA: \$\{\{ github\.sha \}\}/.test(relJobs.deploy));

/* Privatnøkkelen skal aldri kunne leses ut av en logg — verken av workflowen
   eller av skriptet. Skriptet rører den ett sted: der den hentes inn. */
check('deployjobben stopper hvis signeringsnøkkelen mangler (fail closed)',
  !!relJobs.deploy && /if \[ -z "\$OTA_SIGNING_KEY" \]/.test(relJobs.deploy));
check('workflowen skriver aldri ut signeringsnøkkelen',
  !/echo[^\n]*\$OTA_SIGNING_KEY/.test(utenKommentarer(release)));
const nokkelLesninger = (otaKilde.match(/process\.env\.OTA_SIGNING_KEY/g) || []).length;
check('skriptet leser signeringsnøkkelen på nøyaktig ett sted',
  nokkelLesninger === 1, nokkelLesninger + ' lesninger');
/* Og den skrives aldri ut. Navnet får stå i prosa og i feilmeldinger — det er
   VERDIEN som aldri skal nå en logg, altså variabelen den ligger i. */
const lekkendeUtskrift = otaKilde.split('\n')
  .filter((l) => /console\.(log|error)/.test(l))
  .filter((l) => /privateKeyPem|process\.env\.OTA_SIGNING_KEY/.test(l));
check('skriptet skriver aldri ut selve nøkkelen',
  lekkendeUtskrift.length === 0, lekkendeUtskrift.join(' | ') || 'ingen');

/* Nedre native grense. Manifestet publiseres per nivå, så grensen er hvilke
   filer som i det hele tatt finnes — og den kan aldri være 1, fordi både
   skallet før OTA-pluginen og skallet etter meldte `versionCode 1`. */
const minNivaa = (release.match(/^\s*OTA_MIN_VERSION_CODE:\s*'(\d+)'/m) || [])[1];
check('release.yml definerer OTA_MIN_VERSION_CODE ett sted', !!minNivaa, minNivaa || 'mangler');
const gradleVersionCode = ota.readVersionCode(
  fs.readFileSync(path.join(ROOT, 'android', 'app', 'build.gradle'), 'utf8'));
check('den nedre grensen er over 1 (versionCode 1 er tvetydig)',
  Number(minNivaa) >= 2, String(minNivaa));
check('den nedre grensen er ikke høyere enn skallet repoet bygger',
  Number(minNivaa) <= gradleVersionCode,
  'min=' + minNivaa + ', versionCode=' + gradleVersionCode);
check('manifestnivåene avvises hvis grensen settes til 1',
  (() => { try { ota.manifestLevels(1, 4); return false; } catch (e) { return true; } })());
check('manifestnivåene dekker hele spennet fra grensen til skallet',
  ota.manifestLevels(2, 4).join(',') === '2,3,4', ota.manifestLevels(2, 4).join(','));

/* Bundelen lastes ned av NATIV kode med en absolutt URL, og den må stå på det
   kanoniske originet — ikke på et av domenene som bare redirecter dit. */
const kanonisk = (fs.readFileSync(path.join(ROOT, 'config.js'), 'utf8')
  .match(/canonicalAppUrl:\s*'([^']+)'/) || [])[1];
check('bundle-URL-en står på det kanoniske originet',
  !!kanonisk && ota.bundleUrl('x').indexOf(kanonisk + '/') === 0, ota.bundleUrl('<bundleId>'));

/* `dist/` er det som serveres. Havner `ota` i SKIP-listen i build.js, blir
   verken bundelen eller manifestet publisert — og OTA stopper stille. */
const buildKilde = fs.readFileSync(path.join(ROOT, 'build.js'), 'utf8');
const skipListe = (buildKilde.match(/const SKIP = new Set\(\[[\s\S]*?\]\);/) || [''])[0];
check('build.js holder IKKE ota/ utenfor dist/', skipListe.indexOf("'ota'") === -1);
/* Mappen lages kun på runneren, midt i deployjobben, og kan derfor se ut som
   noe man burde gitignorere. Det ville vært en stille OTA-stopp: Vercel CLI-en
   laster opp treet, og hva den utelater styres ikke av dette repoet. En mappe
   ingen laster opp blir aldri kopiert til dist/, og manifestet ville svart 404
   for alle. */
check('ota/ er ikke gitignorert (ellers når den aldri opplastingen)',
  spawnSync('git', ['check-ignore', '-q', '--no-index', 'ota/'], { cwd: ROOT }).status !== 0);

/* Manifestet navngir bundelen som gjelder NÅ og må aldri serveres fra cache;
   ZIP-en har build-ID-en i navnet og kan caches for alltid. */
const otaHeader = (kilde, nokkel) => {
  const e = (vercel.headers || []).find((h) => h.source === kilde);
  const v = e && (e.headers || []).find((x) => x.key === nokkel);
  return v ? v.value : '';
};
check('manifestene serveres uten cache', /no-store/.test(otaHeader('/ota/android/(.*)', 'Cache-Control')),
  otaHeader('/ota/android/(.*)', 'Cache-Control') || 'ingen header');
check('…også forbi CDN-en', /no-store/.test(otaHeader('/ota/android/(.*)', 'CDN-Cache-Control')));
check('ZIP-ene caches for alltid (build-ID-en står i navnet)',
  /immutable/.test(otaHeader('/ota/bundles/(.*)', 'Cache-Control')),
  otaHeader('/ota/bundles/(.*)', 'Cache-Control') || 'ingen header');
/* Manifestet leses av WebView-en i APK-en, og DENS origin er https://localhost
   — en cross-origin-lesning som CSP-verten alene ikke åpner: uten CORS-headeren
   blokkeres SVARET, stille, ett lag lenger ut (docs/sikkerhetsheadere.md,
   «OTA-manifestet leses på tvers av origin»). Manifestet er offentlige,
   ukredensierte data, så `*` gir ingen tilgang noen ikke allerede har.
   Bundlene trenger den ikke: nedlastingen skjer i NATIV kode (OkHttp). */
check('manifestene kan leses fra et annet origin (APK-ens WebView er https://localhost)',
  otaHeader('/ota/android/(.*)', 'Access-Control-Allow-Origin') === '*',
  otaHeader('/ota/android/(.*)', 'Access-Control-Allow-Origin') || 'ingen header');

/* ---- Signaturen, kjørt — ikke lest ----
   Nøkkelparet lages her, så testen trenger ingen secret. Det den beviser er at
   `crypto.createSign('sha256')` gir en signatur `crypto.createVerify` godtar
   over nøyaktig de bytene som ble signert, og at den sier NEI når den skal.
   At Java leser den samme signaturen er lest i pluginens kilde
   (`Signature.getInstance("SHA256withRSA")` over filbytene, base64), ikke kjørt
   her — det krever en JVM, og står som eget punkt i mobilapp-planen. */
function nyttNokkelpar() {
  return crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'huskis-ota-'));
try {
  const par = nyttNokkelpar();
  const annet = nyttNokkelpar();

  const fil = path.join(tmp, 'vilkarlig.bin');
  fs.writeFileSync(fil, crypto.randomBytes(5000));
  const sig = ota.signFile(fil, par.privateKey);
  check('signaturen verifiserer mot den offentlige halvdelen',
    ota.verifyFile(fil, sig, par.publicKey) === true);
  check('en annen nøkkel verifiserer den IKKE',
    ota.verifyFile(fil, sig, annet.publicKey) === false);
  const bytes = fs.readFileSync(fil);
  bytes[0] = bytes[0] ^ 0xff;
  fs.writeFileSync(fil, bytes);
  check('én endret byte gjør signaturen ugyldig',
    ota.verifyFile(fil, sig, par.publicKey) === false);

  /* Hele jobben, med en liten `dist/`: zip → signatur → verifisering →
     manifest. Det er den samme funksjonen release.yml kjører; bare nøklene og
     mappen er testens egne. */
  const dist = path.join(tmp, 'dist');
  fs.mkdirSync(path.join(dist, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>t</title>');
  fs.writeFileSync(path.join(dist, 'assets', 'a.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  const ids = {
    bundleId: 'abc123def456-testid', releaseId: 'abc123def456',
    commit: 'a'.repeat(40), builtAt: '2026-08-18T00:00:00.000Z',
  };
  const res = ota.publishBundle({
    distDir: dist, outDir: path.join(tmp, 'ota'),
    privateKeyPem: par.privateKey, publicKeyPem: par.publicKey,
    ids, versionCode: 3, minVersionCode: 2,
  });
  check('ZIP-en ble skrevet med build-ID-en som navn',
    fs.existsSync(res.zipPath) && path.basename(res.zipPath) === ids.bundleId + '.zip',
    path.basename(res.zipPath));
  /* `zip` kjøres med cwd INNE i dist/. En utdata-sti som ikke er gjort absolutt
     ville da blitt tolket derfra — altså skrevet et annet sted enn kalleren ba
     om, eller feilet med en kryptisk exit-kode. */
  check('utdata-stiene er absolutte, uavhengig av hva kalleren sendte inn',
    path.isAbsolute(res.zipPath) && res.manifests.every((m) => path.isAbsolute(m.path)));

  /* `version.json` kjenner bare `buildId`, `downloadBundle()` bare `bundleId`.
     Navnebyttet skjer ett sted, og det er dette som faktisk kjører i release.yml
     — det er ikke dekket av kallet over, som får identitetene ferdig satt. */
  const fraVersjon = ota.idsFromVersion({
    buildId: 'b-1', releaseId: 'r-1', commit: 'c', builtAt: 't', version: null,
  });
  check('buildId fra version.json blir bundleId mot pluginen',
    fraVersjon.bundleId === 'b-1' && fraVersjon.releaseId === 'r-1',
    JSON.stringify(fraVersjon));
  check('en build uten identitet gir ingen bundle (fail closed)',
    (() => {
      try {
        ota.publishBundle({
          distDir: dist, outDir: path.join(tmp, 'ota-uten-id'),
          privateKeyPem: par.privateKey, publicKeyPem: par.publicKey,
          ids: ota.idsFromVersion({}), versionCode: 2, minVersionCode: 2,
        });
        return false;
      } catch (e) { return /mangler bundleId|mangler releaseId/.test(e.message); }
    })());
  check('signaturen i manifestet verifiserer mot ZIP-en som faktisk ble skrevet',
    ota.verifyFile(res.zipPath, res.manifests[0].manifest.signature, par.publicKey) === true);
  check('det skrives ett manifest per støttet nivå',
    res.manifests.length === 2
      && res.manifests.every((m) => fs.existsSync(m.path))
      && res.manifests.map((m) => path.basename(m.path)).join(',') === '2.json,3.json',
    res.manifests.map((m) => path.basename(m.path)).join(','));
  const m0 = JSON.parse(fs.readFileSync(res.manifests[0].path, 'utf8'));
  check('manifestet navngir releasen, bundelen og nivået sitt',
    m0.releaseId === ids.releaseId && m0.bundleId === ids.bundleId && m0.versionCode === 2,
    JSON.stringify({ releaseId: m0.releaseId, bundleId: m0.bundleId, versionCode: m0.versionCode }));
  check('manifestet peker på ZIP-en på det kanoniske originet',
    m0.url === ota.bundleUrl(ids.bundleId), m0.url);
  /* Pluginen sjekker `checksum` KUN når `publicKey` ikke er satt (lest i
     LiveUpdate.java). Et checksum-felt ved siden av signaturen ville påstått en
     kontroll som aldri kjører. */
  check('manifestet påstår ingen checksum ved siden av signaturen',
    !('checksum' in m0), Object.keys(m0).join(', '));

  /* Den ene feilen som ellers ikke ville vist seg før på en telefon: secreten
     og den innebygde nøkkelen er ikke to halvdeler av samme par. */
  let stoppet = false;
  try {
    ota.publishBundle({
      distDir: dist, outDir: path.join(tmp, 'ota-feil'),
      privateKeyPem: par.privateKey, publicKeyPem: annet.publicKey,
      ids, versionCode: 2, minVersionCode: 2,
    });
  } catch (e) { stoppet = /[Ss]ignaturen verifiserer ikke/.test(e.message); }
  check('et nøkkelpar som ikke henger sammen stopper publiseringen', stoppet);
  check('…og da ble det heller ikke skrevet noe manifest',
    !fs.existsSync(path.join(tmp, 'ota-feil', 'android')));
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log('\n==== ' + pass + '/' + (pass + fail) + ' PASS ====');
process.exit(fail === 0 ? 0 : 1);
