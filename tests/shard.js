#!/usr/bin/env node
/* ============================================================
   Fordeler testfilene på shards, og skriver filene som hører til én av dem.

   Fordelingen er kostnadsbasert, ikke alfabetisk: de dyreste filene plasseres
   først, hver i den shard-en som har minst arbeid så langt (LPT). To ting
   følger av det — shardene blir jevne, og én ny testfil flytter ikke alle de
   andre, slik round-robin over en sortert filliste gjorde.

   Vektene er målt kjøretid i sekunder fra tests/durations.json (skrevet av
   tests/measure.sh). Tallene er RELATIVE — de er målt på en annen maskin enn
   CI-runneren, og det er forholdet mellom dem fordelingen trenger, ikke
   absoluttverdien. En fil som mangler i durations.json får medianen av de
   målte, så en ny test behandles som en helt vanlig test til den er målt.

   Kjør:
     node tests/shard.js 1 4       # filene i shard 1 av 4
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

/* Eksportert for tests/shard-distribution.test.js, som kjører fordelingen med
   syntetiske filsett og vekter. */
function fordel(files, total, known = {}) {
  const measured = files
    .map((f) => known[f])
    .filter((n) => typeof n === 'number' && n >= 0)
    .sort((a, b) => a - b);
  const fallback = measured.length ? measured[Math.floor(measured.length / 2)] : 1;

  // Tyngste først; filnavn som tiebreaker, så fordelingen er identisk hver gang.
  const sorted = files
    .map((file) => ({ file, cost: typeof known[file] === 'number' && known[file] >= 0 ? known[file] : fallback }))
    .sort((a, b) => b.cost - a.cost || a.file.localeCompare(b.file));

  const shards = Array.from({ length: total }, () => ({ cost: 0, files: [] }));
  for (const { file, cost } of sorted) {
    let lightest = 0;
    for (let i = 1; i < total; i++) if (shards[i].cost < shards[lightest].cost) lightest = i;
    shards[lightest].files.push(file);
    shards[lightest].cost += cost;
  }
  for (const s of shards) s.files.sort();
  return shards;
}

function testfiler() {
  return fs.readdirSync(path.join(ROOT, 'tests'))
    .filter((f) => f.endsWith('.test.js'))
    .map((f) => 'tests/' + f)
    .sort();
}

function vekter() {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, 'tests', 'durations.json'), 'utf8'));
  } catch {
    return {};
  }
}

module.exports = { fordel, testfiler, vekter };

if (require.main === module) {
  const [index, total] = process.argv.slice(2).map(Number);
  if (!Number.isInteger(index) || !Number.isInteger(total) || total < 1 || index < 1) {
    console.error('Bruk: node tests/shard.js <index> <total>   (1-basert index)');
    process.exit(2);
  }
  const mine = fordel(testfiler(), total, vekter())[(index - 1) % total].files;
  if (mine.length) process.stdout.write(mine.join('\n') + '\n');
}
