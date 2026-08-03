#!/usr/bin/env bash
# ============================================================
# Måler kjøretiden til hver testfil og skriver tests/durations.json — tallene
# tests/run-all.sh fordeler shardene etter.
#
# Kjøres sjelden: når fordelingen har blitt skjev, eller når nye testfiler har
# ligget umålt en stund. Suiten kjøres i sin helhet, serielt, så dette tar like
# lang tid som en ushardet runde (~15-20 min).
#
#   tests/measure.sh
#   HUSKIS_URL=http://localhost:8000 tests/measure.sh
#
# Filene som feiler tas med som normalt — det er kjøretiden som måles, ikke
# resultatet. En rød runde her er likevel verdt å se på før tallene sjekkes inn.
# ============================================================
set -uo pipefail
cd "$(dirname "$0")/.."

OUT=tests/durations.json

# Én full, ushardet runde. Timing-linjene («  ⏱  12s») kommer fra run-all.sh.
SHARD_INDEX=1 SHARD_TOTAL=1 tests/run-all.sh | tee /tmp/huskis-measure.log
echo

node - /tmp/huskis-measure.log "$OUT" <<'NODE'
const fs = require('fs');
const [log, out] = process.argv.slice(2);

// run-all.sh skriver «──────── tests/x.test.js ────────» og senere «  ⏱  12s».
const lines = fs.readFileSync(log, 'utf8').split('\n');
const durations = {};
let current = null;
for (const line of lines) {
  const header = line.match(/^─+ (tests\/\S+\.test\.js) ─+$/);
  if (header) { current = header[1]; continue; }
  const timed = line.match(/^\s*⏱\s+(\d+)s$/);
  if (timed && current) { durations[current] = Number(timed[1]); current = null; }
}

const keys = Object.keys(durations).sort();
if (!keys.length) { console.error('✗ Fant ingen timing-linjer i ' + log); process.exit(1); }

const ordered = {};
for (const k of keys) ordered[k] = durations[k];
fs.writeFileSync(out, JSON.stringify(ordered, null, 2) + '\n');

const total = keys.reduce((s, k) => s + durations[k], 0);
console.log(`✅ Skrev ${out}: ${keys.length} filer, ${total}s til sammen.`);
NODE
