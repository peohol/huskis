/*
  Test for SIKKERHETSHEADERNE — innholdssikkerhetspolicyen (CSP) og de fire
  øvrige headerne, den låste Supabase-versjonen og at testmodusen ikke finnes i
  produksjonsbygget. Ingen nettleser: ren lesing av index.html, vercel.json og
  config.js, pluss én ekte build. Selve håndhevingen i nettleser dekkes av at
  meta-taggen ligger i index.html, som ALLE nettlesertestene laster.

  Autoritativ beskrivelse av policyen og hvert unntak: docs/sikkerhetsheadere.md.

  Verifiserer:
    1. vercel.json setter CSP, X-Content-Type-Options, Referrer-Policy,
       Permissions-Policy og X-Frame-Options på ALLE adresser.
    2. Policyen er restriktiv: default-src 'none', ingen 'unsafe-inline',
       'unsafe-eval', 'strict-dynamic' eller `*`; base-uri/object-src låst.
    3. Framing er umulig: frame-ancestors 'none' (+ X-Frame-Options DENY).
    4. Meta-taggen i index.html og headeren i vercel.json er NØYAKTIG samme
       policy, bortsett fra frame-ancestors, som kun virker som header. (De to
       lagene kan ikke komme i utakt: den lokale serveren sender ingen headere,
       så meta-taggen er det testene og utviklingsmiljøet faktisk kjører under.)
    5. Hash-en i script-src er hash-en av den ENE inline-blokken i index.html —
       regnet ut på nytt her, så guarden ikke kan endres uten at policyen følger
       med.
    6. Ingen andre inline-kilder: ingen flere <script> uten src, ingen on*=,
       ingen style=/<style> (som ellers ville krevd 'unsafe-inline').
    7. connect-src dekker Supabase-prosjektet i config.js — både https og wss
       (realtime) — og ingen andre verter. Drift mellom config.js og policyen
       stopper her.
    8. Supabase-biblioteket lastes fra en EKSAKT versjon (ingen flytende `@2`),
       og CSP-en slipper kun gjennom nøyaktig den versjonen.
    9. Testmodusen finnes ikke i produksjonsbygget: verken dev-mock.js,
       mock-backend.js eller taggen som laster dem — og build.js sier tydelig
       fra hvis markørene forsvinner.

  Kjør:
    node tests/security-headers.test.js
*/
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const vercel = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));

let passed = 0, failed = 0;
function check(name, cond, extra) {
  if (cond) { passed++; console.log('PASS — ' + name); }
  else { failed++; console.log('  ✗ FAIL: ' + name + (extra !== undefined ? '  [' + JSON.stringify(extra) + ']' : '')); }
}

/* ---------- Hjelpere ---------- */
// Én policy → { direktiv: [kilder] }. Whitespace er vilkårlig i CSP, og
// meta-taggen er brutt over flere linjer for å være lesbar.
function parseCsp(value) {
  const out = {};
  String(value).split(';').forEach((part) => {
    const bits = part.trim().split(/\s+/).filter(Boolean);
    if (!bits.length) return;
    out[bits[0].toLowerCase()] = bits.slice(1);
  });
  return out;
}
function cspText(map) {
  return Object.keys(map).sort().map((k) => k + ' ' + map[k].join(' ')).join('; ');
}

/* ================= 1) Headerne i vercel.json ================= */
// Vercel slår sammen alle reglene som matcher, så catch-all-regelen er den som
// gir hver eneste respons (HTML, JS, CSS, version.json) headerne under.
const CATCH_ALL = '/(.*)';
const allRule = (vercel.headers || []).find((h) => h.source === CATCH_ALL);
check('vercel.json har en headerregel for alle adresser (' + CATCH_ALL + ')', !!allRule,
  (vercel.headers || []).map((h) => h.source));

const hdr = {};
((allRule && allRule.headers) || []).forEach((h) => { hdr[h.key] = h.value; });

check('X-Content-Type-Options: nosniff', hdr['X-Content-Type-Options'] === 'nosniff', hdr['X-Content-Type-Options']);
check('Referrer-Policy er satt og lekker ikke adresser på tvers av origin',
  ['no-referrer', 'same-origin', 'strict-origin', 'strict-origin-when-cross-origin']
    .indexOf(hdr['Referrer-Policy']) > -1, hdr['Referrer-Policy']);
check('X-Frame-Options: DENY (for nettlesere uten frame-ancestors)',
  hdr['X-Frame-Options'] === 'DENY', hdr['X-Frame-Options']);

const pp = hdr['Permissions-Policy'] || '';
check('Permissions-Policy er satt', pp.length > 0);
// Appen ber aldri om noen av disse. Alt som er nevnt skal være slått HELT av
// — `()` er en tom allowlist; `(self)` ville fortsatt gitt appen tilgang.
['camera', 'microphone', 'geolocation', 'payment', 'usb', 'midi', 'magnetometer',
  'gyroscope', 'accelerometer', 'display-capture'].forEach((f) => {
  check('Permissions-Policy slår av ' + f, new RegExp('(^|,\\s*)' + f + '=\\(\\)').test(pp), pp);
});
check('Permissions-Policy gir ingen funksjon en ikke-tom allowlist',
  !/=\(\s*[^)\s]/.test(pp), pp);

/* ================= 2–3) Policyen er restriktiv ================= */
const headerCspRaw = hdr['Content-Security-Policy'] || '';
check('vercel.json setter Content-Security-Policy', headerCspRaw.length > 0);
const headerCsp = parseCsp(headerCspRaw);

check("default-src 'none' (alt som ikke er nevnt er blokkert)",
  String(headerCsp['default-src']) === "'none'", headerCsp['default-src']);
check("base-uri 'none' (ingen injisert <base> kan flytte relative URL-er)",
  String(headerCsp['base-uri']) === "'none'", headerCsp['base-uri']);
check("object-src 'none'", String(headerCsp['object-src']) === "'none'", headerCsp['object-src']);
check("frame-ancestors 'none' (siden kan ikke rammes inn)",
  String(headerCsp['frame-ancestors']) === "'none'", headerCsp['frame-ancestors']);
check('form-action er låst til eget origin',
  String(headerCsp['form-action']) === "'self'", headerCsp['form-action']);

const allSources = Object.keys(headerCsp).reduce((a, k) => a.concat(headerCsp[k]), []);
["'unsafe-inline'", "'unsafe-eval'", "'unsafe-hashes'", "'strict-dynamic'", '*', 'data:', 'http:', 'https:']
  .forEach((bad) => {
    // data: er tillatt i img-src (avatarene), men ingen andre steder.
    const where = Object.keys(headerCsp).filter((k) => headerCsp[k].indexOf(bad) > -1);
    const ok = bad === 'data:' ? where.every((k) => k === 'img-src') : where.length === 0;
    check('ingen ' + bad + ' i policyen' + (bad === 'data:' ? ' utenfor img-src' : ''), ok, where);
  });
check('script-src er egen direktiv (arver ikke default-src)', !!headerCsp['script-src']);
check('img-src tillater data: og blob: (avatarbilder), men ikke fremmede verter',
  (headerCsp['img-src'] || []).slice().sort().join(' ') === "'self' blob: data:",
  headerCsp['img-src']);

/* ================= 4) Meta-taggen === headeren ================= */
const metaMatch = /<meta\s+http-equiv="Content-Security-Policy"\s+content="([\s\S]*?)"\s*\/?>/.exec(html);
check('index.html har CSP-meta-taggen', !!metaMatch);
const metaCsp = parseCsp(metaMatch ? metaMatch[1] : '');

check('CSP-meta-taggen står før den første <script> (dekker også guarden)',
  !!metaMatch && html.indexOf(metaMatch[0]) < html.indexOf('<script'),
  { meta: html.indexOf(metaMatch ? metaMatch[0] : ''), script: html.indexOf('<script') });
check('meta-taggen dropper frame-ancestors (virker kun som HTTP-header)',
  !metaCsp['frame-ancestors'], metaCsp['frame-ancestors']);

const headerWithoutFrame = Object.assign({}, headerCsp);
delete headerWithoutFrame['frame-ancestors'];
check('meta-taggen og vercel.json-headeren er samme policy',
  cspText(headerWithoutFrame) === cspText(metaCsp),
  { header: cspText(headerWithoutFrame), meta: cspText(metaCsp) });

/* ================= 5–6) Inline-kildene ================= */
// Alle <script>-blokker uten src. Guarden for kanonisk origin er den eneste
// som skal finnes; hash-en i policyen regnes ut på nytt fra fila her.
const inline = [];
const scriptRe = /<script(\s[^>]*)?>([\s\S]*?)<\/script>/g;
for (let m = scriptRe.exec(html); m; m = scriptRe.exec(html)) {
  if (!/\bsrc\s*=/.test(m[1] || '')) inline.push(m[2]);
}
check('index.html har nøyaktig én inline-<script> (guarden for kanonisk origin)',
  inline.length === 1, inline.length);
const guardHash = inline.length === 1
  ? "'sha256-" + crypto.createHash('sha256').update(inline[0], 'utf8').digest('base64') + "'"
  : null;
check('script-src inneholder hash-en av guarden slik den står i index.html',
  !!guardHash && (headerCsp['script-src'] || []).indexOf(guardHash) > -1,
  { regnet: guardHash, iPolicyen: headerCsp['script-src'] });
check('script-src har ingen hash-er utover den ene guarden',
  (headerCsp['script-src'] || []).filter((s) => /^'sha(256|384|512)-/.test(s)).length === 1,
  headerCsp['script-src']);
check("script-src tillater egne filer ('self')",
  (headerCsp['script-src'] || []).indexOf("'self'") > -1, headerCsp['script-src']);

// Alt annet inline ville krevd 'unsafe-inline' og dermed hullet policyen.
check('ingen inline hendelseshåndterere (on…=) i index.html',
  !/\son[a-z]+\s*=\s*["']/i.test(html.replace(/<!--[\s\S]*?-->/g, '')),
  (html.replace(/<!--[\s\S]*?-->/g, '').match(/\son[a-z]+\s*=\s*["']/ig) || []).slice(0, 5));
check('ingen <style>-blokk eller style="…" i index.html',
  !/<style[\s>]/i.test(html) && !/\sstyle\s*=\s*["']/i.test(html));

/* ================= 7) connect-src === Supabase-prosjektet ================= */
// config.js er en ren tilordning til window.SUPABASE_CONFIG; hent URL-en
// derfra i stedet for å gjenta prosjektreferansen i testen.
const cfgSrc = fs.readFileSync(path.join(ROOT, 'config.js'), 'utf8');
const cfgUrl = (/url:\s*'([^']+)'/.exec(cfgSrc) || [])[1];
check('config.js oppgir en Supabase-URL', !!cfgUrl, cfgUrl);
const origin = cfgUrl ? new URL(cfgUrl).origin : '';
const wss = origin.replace(/^https:/, 'wss:');
const conn = headerCsp['connect-src'] || [];
check('connect-src tillater Supabase over https', conn.indexOf(origin) > -1, { origin, conn });
check('connect-src tillater Supabase over wss (realtime)', conn.indexOf(wss) > -1, { wss, conn });
check("connect-src tillater eget origin ('self' — /version.json i oppdateringssjekken)",
  conn.indexOf("'self'") > -1, conn);
check('connect-src tillater ingen andre verter enn Supabase og eget origin',
  conn.length === 3, conn);

check('style-src tillater Google Fonts-stilarket (dokumentert unntak)',
  (headerCsp['style-src'] || []).indexOf('https://fonts.googleapis.com') > -1, headerCsp['style-src']);
check('font-src tillater kun fonts.gstatic.com',
  String(headerCsp['font-src']) === 'https://fonts.gstatic.com', headerCsp['font-src']);

/* ================= 8) Låst Supabase-versjon ================= */
const cdn = (/<script src="(https:\/\/cdn\.jsdelivr\.net\/[^"]+)"/.exec(html) || [])[1];
check('index.html laster Supabase-biblioteket fra jsDelivr', !!cdn, cdn);
check('URL-en er pinnet til en EKSAKT versjon (ikke flytende @2)',
  !!cdn && /@\d+\.\d+\.\d+\//.test(cdn) && !/@\d+\/|@\d+$/.test(cdn), cdn);
check('URL-en peker på en eksakt fil, ikke en katalog jsDelivr kan tolke om',
  !!cdn && /\.js$/.test(cdn), cdn);
const pinned = cdn ? cdn.slice(0, cdn.indexOf('/dist/') + 1) : null;
check('script-src slipper gjennom nøyaktig den pinnede versjonen — ikke jsDelivr som helhet',
  (headerCsp['script-src'] || []).indexOf(pinned) > -1,
  { pinned, script: headerCsp['script-src'] });
check('ingen andre eksterne skriptkilder i script-src',
  (headerCsp['script-src'] || []).filter((s) => /^https?:/.test(s)).length === 1,
  headerCsp['script-src']);

/* ================= 9) Testmodus finnes ikke i produksjonsbygget ========= */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'huskis-sec-'));
const out = path.join(tmp, 'dist');
execFileSync(process.execPath, [path.join(ROOT, 'build.js'), '--out', out], {
  cwd: ROOT,
  env: Object.assign({}, process.env, { VERCEL_DEPLOYMENT_ID: '', VERCEL_GIT_COMMIT_SHA: '' }),
  stdio: 'pipe',
});
const built = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
const names = fs.readdirSync(out);
check('kildekoden HAR testmodusen (utvikling og nettlesertester bruker den)',
  fs.existsSync(path.join(ROOT, 'dev-mock.js')) && fs.existsSync(path.join(ROOT, 'mock-backend.js')) &&
  html.indexOf('dev-mock.js') > -1);
['dev-mock.js', 'mock-backend.js'].forEach((f) => {
  check('produksjonsbygget publiserer ikke ' + f, names.indexOf(f) === -1, names);
});
check('produksjonsbygget nevner ikke mock i det hele tatt', !/mock/i.test(built),
  (built.match(/.{0,40}mock.{0,40}/i) || [])[0]);
check('kun-dev-blokken er fjernet fra dist/index.html', built.indexOf('kun-dev') === -1);
check('resten av HTML-en er urørt (samme antall <script src>)',
  (built.match(/<script src=/g) || []).length === (html.match(/<script src=/g) || []).length - 1,
  { dist: (built.match(/<script src=/g) || []).length, src: (html.match(/<script src=/g) || []).length });
check('CSP-meta-taggen er med i produksjonsbygget',
  /<meta\s+http-equiv="Content-Security-Policy"/.test(built));

// build.js skal STOPPE hvis markørene forsvinner — en stille no-op ville
// deployet testmodusen uten at noe sa fra.
const { stripDevOnly } = require(path.join(ROOT, 'build.js'));
let threw = false;
try { stripDevOnly('<html><body>uten markører</body></html>'); } catch (e) { threw = true; }
check('build.js kaster hvis kun-dev-markørene mangler i index.html', threw);
let threwHalf = false;
try { stripDevOnly('<!-- huskis:kun-dev:start --><script src="x.js"></script>'); } catch (e) { threwHalf = true; }
check('build.js kaster på en uavsluttet kun-dev-blokk', threwHalf);

fs.rmSync(tmp, { recursive: true, force: true });

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
