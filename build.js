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
        i produksjon. Se `docs/sikkerhetsheadere.md`.
     4. Bygger build-ID-en inn to steder med samme verdi:
          • <meta name="huskis-build"> i dist/index.html (klienten)
          • dist/version.json (det klienten spør mot)
        og hekter `?b=<build-ID>` på JS/CSS-URL-ene, slik at en reload av
        HTML-en garantert henter den nye koden mens filene samtidig kan
        caches for alltid (URL-en endrer seg når innholdet gjør det).

   Build-ID: Vercels deploy-ID (`VERCEL_DEPLOYMENT_ID`) når den finnes — den er
   unik per deploy og krever ingen ekstra konfigurasjon. Ellers commit-SHA +
   buildtidspunkt, som er unikt nok for alle andre miljøer. Ingen hemmeligheter
   eller andre miljøvariabler eksponeres.

   Kjør lokalt:  node build.js [--out dist]
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = __dirname;

// Filer/mapper som IKKE skal publiseres (kildekode-vedlegg, ikke app).
// `dev-mock.js` + `mock-backend.js`: testmodusen (`?mock=1`) skal ikke finnes i
// produksjon i det hele tatt — verken filene eller taggen som laster dem (se
// stripDevOnly nedenfor og docs/sikkerhetsheadere.md).
const SKIP = new Set([
  '.git', '.github', '.claude', '.vercel', 'node_modules', 'dist',
  'tests', 'docs', 'supabase', 'build.js', 'vercel.json',
  'dev-mock.js', 'mock-backend.js',
]);
const SKIP_EXT = new Set(['.md']);

// Filene index.html laster lokalt, og som derfor får `?b=<build-ID>`.
const VERSIONED = ['config.js', 'icons.js', 'app.js', 'update-check.js', 'styles.css'];

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

function semver() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    return typeof pkg.version === 'string' ? pkg.version : null;
  } catch (e) { return null; } // ingen package.json: SemVer er valgfritt
}

function copyDir(from, to, top, out) {
  fs.mkdirSync(to, { recursive: true });
  for (const name of fs.readdirSync(from)) {
    if (top && (SKIP.has(name) || SKIP_EXT.has(path.extname(name)))) continue;
    if (name.startsWith('.')) continue;
    const src = path.join(from, name), dst = path.join(to, name);
    if (src === out) continue; // aldri kopier utdata-mappen inn i seg selv
    if (fs.statSync(src).isDirectory()) copyDir(src, dst, false, out);
    else fs.copyFileSync(src, dst);
  }
}
function reEscape(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// Fjerner blokkene som er merket `huskis:kun-dev` — i dag nøyaktig én: taggen
// som laster testmodusen (`?mock=1`). Filene den peker på ligger allerede i
// SKIP, så dette lukker det siste sporet av mock-backenden i produksjon.
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

// Bygger build-ID-en inn i HTML-en + versjonerer de lokale JS/CSS-URL-ene.
function stampHtml(html, buildId) {
  const stripped = stripDevOnly(html);
  let out = stripped.replace(
    /(<meta\s+name="huskis-build"\s+content=")[^"]*(")/,
    (m, a, b) => a + buildId + b
  );
  if (out === stripped) throw new Error('Fant ikke <meta name="huskis-build"> i index.html');
  for (const f of VERSIONED) {
    const re = new RegExp('((?:src|href)=")' + reEscape(f) + '(")', 'g');
    out = out.replace(re, (m, a, b) => a + f + '?b=' + buildId + b);
  }
  return out;
}

function build(outDir) {
  const at = new Date();
  const buildId = makeBuildId(at.getTime());
  const out = path.resolve(ROOT, outDir);

  fs.rmSync(out, { recursive: true, force: true });
  copyDir(ROOT, out, true, out);

  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  fs.writeFileSync(path.join(out, 'index.html'), stampHtml(html, buildId));

  const version = {
    buildId,
    version: semver(),
    builtAt: at.toISOString(),
    commit: gitSha() || null,
  };
  fs.writeFileSync(path.join(out, 'version.json'), JSON.stringify(version, null, 2) + '\n');
  return version;
}

if (require.main === module) {
  const i = process.argv.indexOf('--out');
  const v = build(i > -1 ? process.argv[i + 1] : 'dist');
  console.log('✅ Build ' + v.buildId + ' (' + v.builtAt + ')');
}

module.exports = { build, makeBuildId, stampHtml, stripDevOnly, VERSIONED };
