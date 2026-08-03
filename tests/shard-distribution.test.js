#!/usr/bin/env node
/* ============================================================
   Vakt for shard-fordelingen i tests/shard.js.

   Fordelingen er ikke synlig noe sted når den er feil: hver shard er grønn for
   seg, og en fil som faller ut mellom to shards gir ingen rød CI — bare en test
   som stille aldri kjøres igjen. Derfor sjekkes dekningen her.

   Den forrige fordelingen (round-robin over en alfabetisk sortert filliste)
   ga i tillegg shards som ikke var jevne — 343 s mot 216 s da dette ble målt.
   Jevnheten er det denne testen holder fast.

   Dekker:
     1. hver testfil havner i nøyaktig én shard — ingen utelatt, ingen dobbelt
     2. det gjelder for alle aktuelle shard-antall, også 1 og flere enn filer
     3. fordelingen er deterministisk: samme input gir samme svar
     4. dyre filer spres — shardene blir jevne i målt kostnad
     5. og de forblir jevne når suiten vokser
     6. filer uten måling får medianvekt, ikke null (ellers klumper de seg),
        og durations.json har ikke rotnet bort fra suiten
     7. ci.yml og fordelingen er i takt: SHARD_TOTAL følger matrisestørrelsen

   Ren node-test — ingen server, ingen nettleser.

   Kjør:
     node tests/shard-distribution.test.js
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const { fordel, testfiler, vekter } = require('./shard.js');

const ROOT = path.join(__dirname, '..');

let pass = 0, fail = 0;
function check(navn, ok, evidens) {
  if (ok) { pass++; console.log('PASS — ' + navn + (evidens ? '  [' + evidens + ']' : '')); }
  else { fail++; console.log('FAIL — ' + navn + (evidens ? '  [' + evidens + ']' : '')); }
}

const ALLE = testfiler();
const VEKTER = vekter();

const MÅLTE = ALLE.map((f) => VEKTER[f]).filter((n) => typeof n === 'number').sort((a, b) => a - b);
const MEDIAN_KOST = MÅLTE.length ? MÅLTE[Math.floor(MÅLTE.length / 2)] : 1;
const DYRESTE = MÅLTE.length ? MÅLTE[MÅLTE.length - 1] : 1;

/* ---- 1+2. Full dekning, uansett shard-antall ---- */
for (const total of [1, 2, 3, 4, 5, 6, 8, 12, ALLE.length, ALLE.length + 5]) {
  const shards = fordel(ALLE, total, VEKTER);
  const samlet = shards.flatMap((s) => s.files).sort();
  const unike = new Set(samlet);

  check(
    `${total} shards: hver fil nøyaktig én gang`,
    samlet.length === ALLE.length && unike.size === ALLE.length && samlet.every((f, i) => f === ALLE[i]),
    `${samlet.length} plasserte / ${ALLE.length} filer, ${unike.size} unike`
  );
}

/* ---- 3. Determinisme ---- */
{
  const a = fordel(ALLE, 4, VEKTER).map((s) => s.files.join(','));
  const b = fordel(ALLE, 4, VEKTER).map((s) => s.files.join(','));
  check('samme input gir samme fordeling', JSON.stringify(a) === JSON.stringify(b));
}

/* ---- 4. Jevnhet ---- */
{
  /* Med ekte, målte vekter skal den tyngste shard-en ikke være vesentlig
     tyngre enn den letteste. Grensen er romslig: perfekt balanse er umulig når
     én enkelt fil kan være dyrere enn gjennomsnittsshard-en. */
  const målte = Object.keys(VEKTER).length;
  for (const total of [4, 6]) {
    const kostnader = fordel(ALLE, total, VEKTER).map((s) => s.cost);
    const maks = Math.max(...kostnader);
    const min = Math.min(...kostnader);
    const dyrestefil = Math.max(...ALLE.map((f) => VEKTER[f] || 0));
    /* Teoretisk gulv for spredningen: én fil kan ikke deles. */
    const tak = Math.max(dyrestefil, maks * 0.05);
    check(
      `${total} shards: jevn kostnad`,
      målte === 0 || maks - min <= tak,
      `maks=${maks}s min=${min}s spredning=${maks - min}s, dyreste enkeltfil=${dyrestefil}s`
    );
  }
  /* Umålte filer er greit — de får medianvekt, og en ny test skal ikke tvinge
     fram en 20-minutters måling. Men har tallene rotnet nok, blir fordelingen
     gjetning igjen. Grensen slår først ut når en fjerdedel av suiten er umålt. */
  const umålte = ALLE.filter((f) => typeof VEKTER[f] !== 'number');
  check('durations.json dekker mesteparten av suiten (ellers: kjør tests/measure.sh)',
    umålte.length <= Math.floor(ALLE.length / 4),
    `${målte} målte, ${umålte.length} umålte av ${ALLE.length}` +
      (umålte.length ? ': ' + umålte.map((f) => f.replace('tests/', '')).join(', ') : ''));
}

/* ---- 5. Balansen holder når suiten vokser ----
   HVILKEN shard en fil havner i er ikke stabilt, og skal ikke være det: LPT
   plasserer etter løpende sum, så en ny fil kan flytte mange av de andre. Det
   er uten betydning her — det finnes ingen cache eller tilstand per shard, hver
   shard kjører bare lista si. Det som MÅ holde, er at shardene fortsatt er like
   tunge etterpå, uansett hvor dyr den nye testen er. */
{
  for (const kost of [5, MEDIAN_KOST, DYRESTE]) {
    const nye = ALLE.concat('tests/zzz-helt-ny.test.js');
    const vekterMedNy = Object.assign({}, VEKTER, { 'tests/zzz-helt-ny.test.js': kost });
    const kostnader = fordel(nye, 6, vekterMedNy).map((s) => s.cost);
    const spredning = Math.max(...kostnader) - Math.min(...kostnader);
    check(`balansen holder når en ny test på ${kost}s kommer til`,
      spredning <= Math.max(kost, 30),
      `shards: ${kostnader.join(', ')} — spredning ${spredning}s`);
  }
}

/* ---- 5b. Gratis filer klumper seg ikke ----
   De rene node-testene måles til 0 s. Velges det bare på kostnad, forblir den
   første shard-en «lettest» uansett hvor mange den får, og alle havner der —
   mens shards lenger ute blir stående tomme. */
{
  const gratis = ALLE.filter((f) => VEKTER[f] === 0);
  if (gratis.length >= 2) {
    const shards = fordel(ALLE, 6, VEKTER);
    const medGratis = shards.filter((s) => s.files.some((f) => VEKTER[f] === 0)).length;
    check('gratis node-tester klumper seg ikke i én shard', medGratis >= 2,
      `${gratis.length} gratis filer fordelt på ${medGratis} shards`);
  }

  /* Flere shards enn filer skal gi tomme shards, ikke krasj eller tapte filer. */
  const mange = fordel(ALLE, ALLE.length + 5, VEKTER);
  const tomme = mange.filter((s) => !s.files.length).length;
  const plassert = mange.flatMap((s) => s.files).length;
  check('flere shards enn filer: resten står tomme, ingen fil går tapt',
    plassert === ALLE.length && tomme === 5,
    `${plassert} plasserte, ${tomme} tomme shards`);
}

/* ---- 6. Ukjente filer får medianvekt ---- */
{
  const kjente = { 'a.test.js': 10, 'b.test.js': 20, 'c.test.js': 30 };
  const shards = fordel(['a.test.js', 'b.test.js', 'c.test.js', 'ukjent.test.js'], 2, kjente);
  const ukjentShard = shards.find((s) => s.files.includes('ukjent.test.js'));
  const utenUkjent = shards.reduce((sum, s) => sum + s.cost, 0) - 20;
  check('ukjent fil får medianvekt, ikke null', ukjentShard.cost > 0 && utenUkjent === 60,
    `median=20 av {10,20,30}, sum=${shards.reduce((s, x) => s + x.cost, 0)}s`);

  const negativ = fordel(['x.test.js'], 1, { 'x.test.js': -5 });
  check('negativ vekt ignoreres', negativ[0].cost > 0, `kost=${negativ[0].cost}`);
}

/* ---- 7. ci.yml i takt med fordelingen ---- */
{
  const ci = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');

  check('ci.yml utleder SHARD_TOTAL fra matrisestørrelsen',
    /SHARD_TOTAL:\s*\$\{\{\s*strategy\.job-total\s*\}\}/.test(ci),
    'ellers kan matrisen og SHARD_TOTAL komme i utakt uten at noe feiler');

  const matrise = ci.match(/shard:\s*\[([^\]]+)\]/);
  const antall = matrise ? matrise[1].split(',').length : 0;
  const indekser = matrise ? matrise[1].split(',').map((n) => Number(n.trim())) : [];
  check('shard-matrisen er 1..N uten hull',
    antall > 0 && indekser.every((n, i) => n === i + 1),
    matrise ? `[${matrise[1].trim()}]` : 'fant ingen matrise');

  check('Playwright-versjonen er pinnet, ikke @latest',
    /PLAYWRIGHT_VERSION:\s*'[\d.]+'/.test(ci) && !/playwright@latest/.test(ci),
    (ci.match(/PLAYWRIGHT_VERSION:\s*'([\d.]+)'/) || [])[1] || 'ikke funnet');

  check('Chromium-nedlastingen er cachet',
    /actions\/cache@v4/.test(ci) && /ms-playwright/.test(ci),
    'uten cache betaler hver shard nedlastingen på nytt');

  check('cache-nøkkelen inneholder Playwright-versjonen',
    /key:\s*ms-playwright-\$\{\{\s*runner\.os\s*\}\}-\$\{\{\s*env\.PLAYWRIGHT_VERSION\s*\}\}/.test(ci),
    'ellers serveres feil nettleserversjon fra cachen etter en oppgradering');
}

console.log();
console.log(`==== ${pass}/${pass + fail} PASS ====`);
process.exit(fail ? 1 : 0);
