/*
  Ren node-test: OPPSKRIFTENES LOGIKK (recipe-core.js, docs/oppskrifter.md).

  Dekker:
     1. Mengder: heltall, desimaler med komma og punktum, brøker, blandede tall
        og spenn tolkes til tall — og en mengde som ikke er et tall blir stående
        som tekst.
     2. En hel ingredienslinje i ett felt («2 dl melk») deles i mengde, enhet
        og navn — og et ukjent ord etter mengden er en del av navnet.
     3. Porsjonsskalering: faktoren er valgt / opprinnelig, brøkstil svarer i
        brøk, desimaler rundes lesbart, spenn skaleres i begge ender, og en
        mengde uten tall rører seg aldri. Det LAGREDE tallet endres ikke.
     4. Underinndelingene: ny linje på hovednivået, første underinndeling gjør
        eksisterende linjer til «Øvrige», «Øvrige» forsvinner når den er tom og
        går tilbake til hovednivået når den blir den eneste.
     5. Oppløsning sletter aldri innhold og bevarer rekkefølgen — både når den
        oppløste var den eneste og når det finnes andre.
     6. Sletting av en underinndeling kan angres; flytting skjer bare innenfor
        samme seksjon; stegnummereringen er per gruppe.
     7. Normaliseringen: ukjente felter kastes, duplikat-id-er får nye, og
        søketeksten har alt det lesbare.

  Kjør:
    node tests/recipe-core.test.js
*/
'use strict';
const R = require('../recipe-core.js');

const results = [];
const log = (n, ok, x = '') => {
  results.push(ok);
  console.log((ok ? 'PASS' : 'FAIL') + ' — ' + n + (x ? ' (' + x + ')' : ''));
};
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---- 1. Tolking av mengder ----
const cases = [
  ['2', { q: 2, q2: null, f: 0 }],
  ['2,5', { q: 2.5, q2: null, f: 0 }],
  ['2.5', { q: 2.5, q2: null, f: 0 }],
  [',5', { q: 0.5, q2: null, f: 0 }],
  ['1/2', { q: 0.5, q2: null, f: 1 }],
  ['½', { q: 0.5, q2: null, f: 1 }],
  ['1 1/2', { q: 1.5, q2: null, f: 1 }],
  ['1½', { q: 1.5, q2: null, f: 1 }],
  ['2-3', { q: 2, q2: 3, f: 0 }],
  ['2 – 3', { q: 2, q2: 3, f: 0 }],
  ['½-1', { q: 0.5, q2: 1, f: 1 }],
];
cases.forEach(([s, want]) => {
  const got = R.parseAmount(s);
  log('tolker «' + s + '»', eq(got, want), JSON.stringify(got));
});
log('tom mengde er ingen mengde', R.parseAmount('  ') === null);
log('en mengde som ikke er et tall blir tekst', eq(R.parseAmount('en klype'), { qs: 'en klype' }));
log('null i nevneren er ikke et tall', eq(R.parseAmount('1/0'), { qs: '1/0' }));
log('et baklengs spenn er ikke et spenn', eq(R.parseAmount('3-2'), { qs: '3-2' }));

// ---- 2. Hel linje i ett felt ----
const l1 = R.parseIngredientLine('2 dl melk');
log('«2 dl melk» → 2 / dl / melk', l1.q === 2 && l1.u === 'dl' && l1.t === 'melk', JSON.stringify(l1));
const l2 = R.parseIngredientLine('3 egg');
log('«3 egg» → 3 / – / egg (egg er ikke en enhet)', l2.q === 3 && l2.u === '' && l2.t === 'egg', JSON.stringify(l2));
const l3 = R.parseIngredientLine('salt etter smak');
log('«salt etter smak» har ingen mengde', l3.q === null && l3.t === 'salt etter smak', JSON.stringify(l3));
const l4 = R.parseIngredientLine('1 1/2 ts bakepulver');
log('«1 1/2 ts bakepulver» → 1,5 i brøkstil', l4.q === 1.5 && l4.f === 1 && l4.u === 'ts' && l4.t === 'bakepulver',
  JSON.stringify(l4));

// ---- 3. Porsjonsskalering ----
const k = R.scaleFactor(4, 6);
log('faktoren er valgt / opprinnelig', k === 1.5, String(k));
log('uten opprinnelig antall er faktoren 1', R.scaleFactor(null, 6) === 1 && R.scaleFactor(0, 6) === 1);
const half = { q: 0.5, q2: null, f: 1, qs: '', u: 'ts', t: 'salt' };
log('½ ts × 1,5 = ¾ ts (brøkstil)', R.formatAmount(half, k, ',') === '¾', R.formatAmount(half, k, ','));
log('½ ts × 3 = 1½', R.formatAmount(half, 3, ',') === '1½', R.formatAmount(half, 3, ','));
log('⅓ × 2 = ⅔', R.formatAmount({ q: 1 / 3, f: 1 }, 2, ',') === '⅔', R.formatAmount({ q: 1 / 3, f: 1 }, 2, ','));
const grams = { q: 500, q2: null, f: 0, qs: '', u: 'g', t: 'mel' };
log('500 g × 2/3 = 333 g (avrundet lesbart)', R.formatAmount(grams, 2 / 3, ',') === '333',
  R.formatAmount(grams, 2 / 3, ','));
const dl = { q: 2.5, q2: null, f: 0, u: 'dl' };
log('2,5 dl × 1,5 = 3,75 dl (komma)', R.formatAmount(dl, 1.5, ',') === '3,75', R.formatAmount(dl, 1.5, ','));
log('… og 3.75 på engelsk', R.formatAmount(dl, 1.5, '.') === '3.75');
log('uskalert vises det som ble skrevet', R.formatAmount({ q: 0.125, f: 0 }, 1, ',') === '0,125');
const range = { q: 2, q2: 3, f: 0 };
log('spenn skaleres i begge ender', R.formatAmount(range, 2, ',') === '4–6', R.formatAmount(range, 2, ','));
const pinch = { q: null, qs: 'en klype', u: '', t: 'salt' };
log('en mengde uten tall rører seg aldri', R.formatAmount(pinch, 3, ',') === 'en klype');
log('en ingrediens uten mengde vises uendret', R.ingredientText({ q: null, qs: '', u: '', t: 'salt etter smak' }, 2, ',') === 'salt etter smak');
log('det lagrede tallet endres ikke av skaleringen', grams.q === 500 && half.q === 0.5);
log('en brøk som ikke er nær en pen brøk vises som desimaltall',
  R.formatAmount({ q: 1, f: 1 }, 0.29, ',') === '0,29', R.formatAmount({ q: 1, f: 1 }, 0.29, ','));

// ---- 4. Underinndelingene og «Øvrige» ----
let doc = R.emptyRecipe();
const a = R.addLine(doc, 'ing', null, { q: 2, u: 'dl', t: 'melk' });
R.addLine(doc, 'ing', null, { q: 3, t: 'egg' });
let g = R.groups(doc, 'ing');
log('uten underinndelinger: linjene står rett under hovedoverskriften',
  g.length === 1 && !g[0].other && g[0].name === null && g[0].items.length === 2);
const saus = R.addSub(doc, 'ing', 'Saus');
g = R.groups(doc, 'ing');
log('første underinndeling: eksisterende linjer blir «Øvrige», sist',
  g.length === 2 && g[0].id === saus.id && g[1].other && g[1].items.length === 2);
const smør = R.addLine(doc, 'ing', saus.id, { q: 50, u: 'g', t: 'smør' });
const ny = R.addLine(doc, 'ing', null, { t: 'pepper' });
g = R.groups(doc, 'ing');
log('ny linje på hovednivået med underinndelinger havner i «Øvrige»',
  g[1].other && g[1].items.map((l) => l.id).includes(ny.id));
// Tøm «Øvrige» (flytt alt inn i Saus): den forsvinner av seg selv.
[...doc.ing.items].forEach((l) => R.moveLine(doc, 'ing', l.id, saus.id));
g = R.groups(doc, 'ing');
log('«Øvrige» forsvinner når den blir tom', g.length === 1 && g[0].id === saus.id && g[0].items.length === 4);

// ---- 5. Oppløsning ----
const deig = R.addSub(doc, 'ing', 'Deig');
R.addLine(doc, 'ing', deig.id, { t: 'mel' });
R.addLine(doc, 'ing', null, { t: 'løs' });      // i «Øvrige»
const før = R.lineCount(doc, 'ing');
const lesestrøm = () => R.groups(doc, 'ing').flatMap((x) => x.items.map((l) => l.t));
const strømFør = lesestrøm();
R.dissolveSub(doc, 'ing', saus.id);              // det finnes andre → til «Øvrige»
g = R.groups(doc, 'ing');
log('oppløsning med andre igjen: linjene går til «Øvrige», ingen tapt',
  R.lineCount(doc, 'ing') === før && g.length === 2 && g[0].id === deig.id && g[1].other &&
  g[1].items.length === 5, JSON.stringify(g.map((x) => [x.name, x.items.length])));
log('… og rekkefølgen i «Øvrige» bevares (den oppløstes linjer først)',
  eq(g[1].items.map((l) => l.t), ['smør', 'melk', 'egg', 'pepper', 'løs']),
  JSON.stringify(g[1].items.map((l) => l.t)));
R.dissolveSub(doc, 'ing', deig.id);              // den siste ekte → «Øvrige» blir eneste → hovednivå
g = R.groups(doc, 'ing');
log('når «Øvrige» blir eneste gjenværende, oppløses den: alt står på hovednivået',
  g.length === 1 && !g[0].other && g[0].name === null && g[0].items.length === før,
  JSON.stringify(g.map((x) => [x.name, x.other, x.items.length])));
log('rekkefølgen i lesestrømmen er den samme som før oppløsningene',
  eq(lesestrøm(), ['mel'].concat(strømFør.filter((t) => t !== 'mel'))), JSON.stringify(lesestrøm()));
log('ingen linje forsvant (smør og melk er der)',
  !!R.locate(doc, 'ing', smør.id) && !!R.locate(doc, 'ing', a.id));

// ---- 6. Sletting, angring, flytting og nummerering ----
const s1 = R.addSub(doc, 'ing', 'Topping');
R.addLine(doc, 'ing', s1.id, { t: 'ost' });
const removed = R.deleteSub(doc, 'ing', s1.id);
log('sletting tar underinndelingen OG linjene', !R.findSub(doc, 'ing', s1.id) &&
  !R.groups(doc, 'ing').some((x) => x.items.some((l) => l.t === 'ost')));
R.restoreSub(doc, 'ing', removed);
log('… og kan angres', !!R.findSub(doc, 'ing', s1.id) && R.findSub(doc, 'ing', s1.id).items[0].t === 'ost');
const st = R.addLine(doc, 'step', null, { t: 'Rør' });
log('en ingrediens kan ikke flyttes inn blant stegene',
  R.moveLine(doc, 'step', a.id, null) === false && !!R.locate(doc, 'ing', a.id));
log('en underinndeling i ingrediensene finnes ikke i fremgangsmåten', R.findSub(doc, 'step', s1.id) === null);
const forb = R.addSub(doc, 'step', 'Forberedelse');
R.addLine(doc, 'step', forb.id, { t: 'Skjær' });
R.addLine(doc, 'step', forb.id, { t: 'Varm' });
g = R.groups(doc, 'step');
log('stegene grupperes slik at nummereringen kan starte på 1 i hver gruppe',
  g.length === 2 && g[0].items.length === 2 && g[1].other && g[1].items[0].id === st.id);
R.moveSub(doc, 'ing', s1.id, 0);
log('underinndelinger kan omorganiseres', doc.ing.subs[0].id === s1.id);
R.moveLine(doc, 'ing', a.id, s1.id, 0);
log('en linje kan flyttes til en plass i en annen underinndeling',
  R.findSub(doc, 'ing', s1.id).items[0].id === a.id);

// ---- 7. Normalisering og søketekst ----
const raw = {
  v: 1, desc: 'Godt', serv: 4, hack: '<script>',
  ing: { items: [{ id: 'x', q: 'tre', t: 'egg', evil: 1 }, { id: 'x', q: 2, q2: 1, u: 'dl', t: 'melk' }], subs: 'nei' },
  step: { items: [{ id: 's', t: 42 }], subs: [{ id: 's', name: 'Del', items: [{ t: 'Steg' }] }] },
};
const clean = R.sanitizeRecipe(raw);
log('ukjente felter kastes', !('hack' in clean) && !('evil' in clean.ing.items[0]));
log('en ikke-numerisk mengde blir null, et baklengs spenn blir et enkelt tall',
  clean.ing.items[0].q === null && clean.ing.items[1].q === 2 && clean.ing.items[1].q2 === null);
log('duplikat-id-er får hver sin', clean.ing.items[0].id !== clean.ing.items[1].id &&
  clean.step.subs[0].id !== clean.step.items[0].id);
log('feil typer blir tomme, ikke krasj', clean.step.items[0].t === '' && Array.isArray(clean.ing.subs));
log('et tomt eller ødelagt dokument blir et tomt dokument',
  eq(R.sanitizeRecipe(null).ing, { items: [], subs: [] }) && R.sanitizeRecipe([1]).serv === null);
const text = R.recipeText(R.sanitizeRecipe({ desc: 'Rask middag', ing: { items: [{ q: 2, u: 'dl', t: 'fløte' }] },
  step: { subs: [{ name: 'Saus', items: [{ t: 'Kok opp' }] }] } }), ',');
log('søketeksten har beskrivelse, ingredienser, overskrifter og steg',
  /Rask middag/.test(text) && /2 dl fløte/.test(text) && /Saus/.test(text) && /Kok opp/.test(text), JSON.stringify(text));

const ok = results.filter(Boolean).length;
console.log('\n==== ' + ok + '/' + results.length + ' PASS ====');
process.exit(ok === results.length ? 0 : 1);
