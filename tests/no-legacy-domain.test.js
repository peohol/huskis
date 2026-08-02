/*
  Repo-vid vakt mot at det PENSJONERTE domenet («huskekurv», dvs.
  huskekurv.vercel.app) gjeninnføres i aktiv kode/konfig. Ingen nettleser —
  et rent tekstsøk gjennom repoet.

  De to redirect-KILDENE (vercel.json og guarden i index.html), bevisste
  negative regresjonstester (tabellen i tests/auth-redirect.test.js) og den
  autoritative domenedokumentasjonen får nevne domenet — se ALLOWLIST.
  Ethvert ANNET treff er en regresjon: enten en hardkodet lenke som er kommet
  tilbake, eller en ny fil som burde vært lagt til denne listen bevisst (ikke
  ved et uhell).

  Kjør:
    node tests/no-legacy-domain.test.js
*/
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SELF = path.relative(ROOT, __filename).split(path.sep).join('/');
const NEEDLE = /huskekurv/i;

// Eksplisitte unntak — hver enkelt begrunnet, ikke et fritt mønster.
const ALLOWLIST = new Set([
  'tests/auth-redirect.test.js',                 // negativt testtilfelle (kravtabellen)
  'tests/canonical-origin.test.js',               // dekker 308-regelen som navngir domenet
  'supabase/tests/test-email-sharing.sql',        // negativt testtilfelle (Resend-e-post)
  'vercel.json',                                  // redirect-regelen MÅ navngi det gamle domenet
  'index.html',                                   // guardens hostliste MÅ navngi det, av samme grunn
                                                  //   — at treffet KUN står der, sjekkes av
                                                  //   tests/canonical-origin.test.js
  'docs/domains-and-urls.md',                     // historisk forklaring + redirect-status (autoritativ)
]);

const SKIP_DIRS = new Set(['.git']);
const BINARY_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.ico', '.woff', '.woff2', '.ttf']);

const offenders = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(path.join(dir, entry.name));
      continue;
    }
    const full = path.join(dir, entry.name);
    const rel = path.relative(ROOT, full).split(path.sep).join('/');
    if (rel === SELF || ALLOWLIST.has(rel)) continue;
    if (BINARY_EXT.has(path.extname(entry.name).toLowerCase())) continue;
    let content;
    try { content = fs.readFileSync(full, 'utf8'); } catch (e) { continue; }
    if (NEEDLE.test(content)) offenders.push(rel);
  }
}
walk(ROOT);

if (offenders.length) {
  console.log('✗ FAIL: «huskekurv» funnet utenfor godkjente unntak:');
  offenders.forEach((f) => console.log('  - ' + f));
  console.log('\nLegg filen eksplisitt til ALLOWLIST i tests/no-legacy-domain.test.js HVIS');
  console.log('treffet virkelig er en tilsiktet historisk/test-referanse — ikke ellers.');
  console.log('\n0 passed, 1 failed');
  process.exit(1);
}
console.log('✓ Ingen aktive referanser til det pensjonerte domenet (huskekurv) funnet.');
console.log('\n1 passed, 0 failed');
process.exit(0);
