#!/usr/bin/env node
/* ============================================================
   Build-steg for produksjonsdeployen (Vercel: `node build.js`).

   Appen er fortsatt ren HTML/CSS/JS — det finnes ingen bundler, ingen
   avhengigheter og ingen transpilering. Dette steget gjør nøyaktig fire ting:

     1. Lager ÉN unik build-ID for deployen.
     2. Kopierer de statiske filene til `dist/` (det som faktisk skal
        publiseres — ikke tester, dokumentasjon eller SQL).
     3. Fjerner testmodusen (`?mock=1`): både `dev-mock.js`/`mock-backend.js` og
        `kun-dev`-blokken i `index.html` som laster dem, slik at den ikke finnes
        i produksjon. Preview-deployer (`VERCEL_ENV=preview`) beholder den —
        der ER `?mock=1` måten å teste uten å røre ekte data på. Se
        `docs/sikkerhetsheadere.md` og `docs/release-og-deploy.md`.
     4. Bygger de TO identitetene inn to steder hver, med samme verdi:
          • <meta name="huskis-build"> + <meta name="huskis-release"> i
            dist/index.html (klienten)
          • dist/version.json (det klienten spør mot)
        og hekter `?b=<build-ID>` på JS/CSS-URL-ene, slik at en reload av
        HTML-en garantert henter den nye koden mens filene samtidig kan
        caches for alltid (URL-en endrer seg når innholdet gjør det).

   Build-ID: identifiserer DENNE builden/deployen. Vercels deploy-ID
   (`VERCEL_DEPLOYMENT_ID`) når den finnes — den er unik per deploy og krever
   ingen ekstra konfigurasjon. Ellers commit-SHA + buildtidspunkt, som er unikt
   nok for alle andre miljøer.

   Release-ID: identifiserer KILDEN builden er laget av — de 12 første tegnene
   av commit-SHA-en. To builds av samme commit (Vercel-deployen og Android-
   builden, eller en re-deploy) er forskjellige builds av SAMME release, og får
   derfor samme release-ID og hver sin build-ID. Den er aldri Vercels deploy-ID,
   og den rører verken cache eller reload — det eier build-ID-en alene
   (`docs/auto-update.md`).

   Ingen hemmeligheter eller andre miljøvariabler eksponeres.

   Kjør lokalt:  node build.js [--out dist]
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = __dirname;

/* Filer/mapper som IKKE skal publiseres (kildekode-vedlegg, ikke app).

   Listen er invarianten «dist/ inneholder bare web-produksjonsartefakter», og
   den er stedet den uttrykkes. Mobilprosjektet (`docs/mobilapp-plan.md`) la til
   npm- og Capacitor-tooling i repo-roten: `package.json`, lockfila,
   Capacitor-konfigurasjonen og de native prosjektene er BYGGE-input, ikke
   web-assets, og skal aldri havne på huskis.no. `ios/` står her før den finnes,
   fordi mappen ellers ville blitt publisert den dagen den genereres.
   `tests/build-version.test.js` vokter listen. */
const SKIP = new Set([
  '.git', '.github', '.claude', '.vercel', 'node_modules', 'dist',
  'tests', 'docs', 'supabase', 'build.js', 'vercel.json',
  'package.json', 'package-lock.json', 'capacitor.config.json', 'android', 'ios',
]);
const SKIP_EXT = new Set(['.md']);

// Testmodusen (`?mock=1`): filene som utgjør den, og som holdes utenfor alle
// bygg unntatt preview-deployer. Se `keepTestMode()`.
const TEST_MODE_FILES = ['dev-mock.js', 'mock-backend.js'];

/* En preview-deploy skal BEHOLDE testmodusen. Preview-er peker på det samme
   Supabase-prosjektet som produksjon (`config.js`), så `?mock=1` er nettopp
   måten man ser en endring uten å røre ekte data på — se
   `docs/release-og-deploy.md`. Uten mock-backenden ville `?mock=1` stille falt
   tilbake til den ekte databasen, altså det motsatte av det man ba om.

   Vercel setter `VERCEL_ENV` selv: `production` for produksjonsdeployen,
   `preview` for alle andre grener. Regelen er FAIL CLOSED — testmodusen blir
   bare med når miljøet EKSPLISITT sier «preview». Et lokalt `node build.js`,
   et CI-bygg og enhver deploy uten variabelen fjerner den. */
function keepTestMode(env) {
  return (env || process.env).VERCEL_ENV === 'preview';
}

// Filene index.html laster lokalt, og som derfor får `?b=<build-ID>`.
const VERSIONED = ['theme.js', 'config.js', 'icons.js', 'i18n.js', 'app.js', 'update-check.js', 'styles.css',
  'dark-surface-experiment.css'];

function sanitize(s) {
  return String(s || '').replace(/[^A-Za-z0-9._-]/g, '').slice(0, 100);
}

function gitSha() {
  const env = sanitize(process.env.VERCEL_GIT_COMMIT_SHA || process.env.GITHUB_SHA);
  if (env) return env;
  try { return sanitize(execSync('git rev-parse HEAD', { cwd: ROOT }).toString().trim()); }
  catch (e) { return ''; }
}

// Én ID per build. Deploy-ID-en er allerede unik; fallbacken kombinerer commit
// og tidspunkt, slik at to deployer av samme commit også blir forskjellige.
function makeBuildId(atMs) {
  const dep = sanitize(process.env.VERCEL_DEPLOYMENT_ID);
  if (dep) return dep;
  const sha = gitSha();
  return (sha ? sha.slice(0, 12) : 'local') + '-' + atMs.toString(36);
}

/* Én ID per RELEASE, altså per kilde-commit — plattformuavhengig med vilje:
   Vercel-deployen og Android-builden kjører hver sin `node build.js` over det
   samme treet og får da samme verdi. Leser NØYAKTIG den samme kilden som
   `commit` (`VERCEL_GIT_COMMIT_SHA`/`GITHUB_SHA`/`git rev-parse HEAD`), aldri
   `VERCEL_DEPLOYMENT_ID`: en deploy-ID er infrastruktur, ikke produktversjon.
   `null` når SHA-en ikke er kjent — ukjent release er ikke en oppdiktet en. */
function makeReleaseId() {
  const sha = gitSha();
  return sha ? sha.slice(0, 12) : null;
}

function semver() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    return typeof pkg.version === 'string' ? pkg.version : null;
  } catch (e) { return null; } // ingen package.json: SemVer er valgfritt
}

function copyDir(from, to, top, out, skip) {
  fs.mkdirSync(to, { recursive: true });
  for (const name of fs.readdirSync(from)) {
    if (top && (skip.has(name) || SKIP_EXT.has(path.extname(name)))) continue;
    if (name.startsWith('.')) continue;
    const src = path.join(from, name), dst = path.join(to, name);
    if (src === out) continue; // aldri kopier utdata-mappen inn i seg selv
    if (fs.statSync(src).isDirectory()) copyDir(src, dst, false, out, skip);
    else fs.copyFileSync(src, dst);
  }
}
function reEscape(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// Fjerner blokkene som er merket `huskis:kun-dev` — i dag nøyaktig én: taggen
// som laster testmodusen (`?mock=1`). Filene den peker på hoppes over i samme
// slengen, så dette lukker det siste sporet av mock-backenden.
// Kaster hvis markørene mangler eller står i feil rekkefølge: en stille
// no-op her ville deployet testmodusen uten at noe sa fra.
const DEV_ONLY = /[ \t]*<!--\s*huskis:kun-dev:start[\s\S]*?huskis:kun-dev:slutt\s*-->[ \t]*\r?\n?/g;
function stripDevOnly(html) {
  const starts = (html.match(/huskis:kun-dev:start/g) || []).length;
  const ends = (html.match(/huskis:kun-dev:slutt/g) || []).length;
  if (!starts || starts !== ends) {
    throw new Error('Fant ' + starts + ' huskis:kun-dev:start og ' + ends + ' :slutt i index.html');
  }
  const out = html.replace(DEV_ONLY, '');
  if ((out.match(/huskis:kun-dev/g) || []).length) {
    throw new Error('huskis:kun-dev-blokken lot seg ikke fjerne fra index.html');
  }
  return out;
}

// Bygger de to identitetene inn i HTML-en + versjonerer de lokale JS/CSS-URL-ene.
// `ids` = { buildId, releaseId }. `keep` = behold testmodusen (kun
// preview-deployer, se keepTestMode).
function stampMeta(html, name, value) {
  const re = new RegExp('(<meta\\s+name="' + name + '"\\s+content=")[^"]*(")');
  const out = html.replace(re, (m, a, b) => a + value + b);
  if (out === html) throw new Error('Fant ikke <meta name="' + name + '"> i index.html');
  return out;
}
function stampHtml(html, ids, keep) {
  const stripped = keep ? html : stripDevOnly(html);
  let out = stampMeta(stripped, 'huskis-build', ids.buildId);
  // Ukjent release stemples som «dev» — samme plassholder som ubygget kilde,
  // og dermed noe ingen klient kan lese som en ekte release.
  out = stampMeta(out, 'huskis-release', ids.releaseId || 'dev');
  for (const f of VERSIONED) {
    const re = new RegExp('((?:src|href)=")' + reEscape(f) + '(")', 'g');
    out = out.replace(re, (m, a, b) => a + f + '?b=' + ids.buildId + b);
  }
  return out;
}

function build(outDir) {
  const at = new Date();
  const buildId = makeBuildId(at.getTime());
  const releaseId = makeReleaseId();
  const out = path.resolve(ROOT, outDir);
  const keep = keepTestMode();

  const skip = new Set(SKIP);
  if (!keep) TEST_MODE_FILES.forEach((f) => skip.add(f));

  fs.rmSync(out, { recursive: true, force: true });
  copyDir(ROOT, out, true, out, skip);

  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  fs.writeFileSync(path.join(out, 'index.html'), stampHtml(html, { buildId, releaseId }, keep));

  /* Feltene er ADDITIVE: en telefon kan kjøre en gammel release lenge
     (arkitekturregel 7 i docs/mobilapp-plan.md), og den leser denne fila. Nye
     felt legges til; ingen døpes om eller fjernes. `update-check.js` leser kun
     `buildId` og overser resten. */
  const version = {
    buildId,
    releaseId,
    version: semver(),
    builtAt: at.toISOString(),
    commit: gitSha() || null,
  };
  fs.writeFileSync(path.join(out, 'version.json'), JSON.stringify(version, null, 2) + '\n');
  return Object.assign(version, { testMode: keep });
}

if (require.main === module) {
  const i = process.argv.indexOf('--out');
  const v = build(i > -1 ? process.argv[i + 1] : 'dist');
  console.log('✅ Build ' + v.buildId + ' — release ' + (v.releaseId || 'ukjent') +
    ' (' + v.builtAt + ')' +
    (v.testMode ? ' — preview: testmodus (?mock=1) er MED' : ''));
}

module.exports = { build, makeBuildId, makeReleaseId, stampHtml, stripDevOnly, keepTestMode, VERSIONED };
