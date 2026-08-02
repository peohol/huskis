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
     7. ci.yml kjører både JS- og SQL-suiten, og gjenbrukes av release.yml
     8. deployjobben sjekker Vercel-tilgangen FØR den bygger, forklarer 401/403/
        404 hver for seg, og logger aldri tokenet — og bruker ikke `vercel pull`

   Ren node-test — ingen server, ingen nettleser.

   Kjør:
     node tests/release-pipeline.test.js
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');

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
check('concurrency-gruppen er én fast gruppe (ikke per ref)',
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

/* SQL-suiten må faktisk kjøre smoke-testen, ellers kan den være ødelagt uten
   at noen ser det før den blokkerer en release. */
const sqlRunner = fs.readFileSync(path.join(ROOT, 'supabase', 'tests', 'run-tests.sh'), 'utf8');
check('SQL-suiten kjører smoke-testen mot et ferdig migrert skjema',
  /smoke-test\.sql/.test(sqlRunner),
  (sqlRunner.match(/smoke-test\.sql/g) || []).length + ' steder');

console.log('\n==== ' + pass + '/' + (pass + fail) + ' PASS ====');
process.exit(fail === 0 ? 0 : 1);
