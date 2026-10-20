/* ============================================================
   Huskis — recipe-core.js

   Oppskriftenes rene logikk (docs/oppskrifter.md): dokumentformen, mengder
   (tolking, visning, porsjonsskalering) og underinndelingene i
   «Ingredienser» og «Fremgangsmåte». Ingen DOM, ingen tilstand, ingen
   avhengigheter — den SAMME koden kjører i appen (app.js), i den offentlige
   lesevisningen (recipe-public.js) og i node-testene
   (tests/recipe-core.test.js). Lastes som et klassisk skript før app.js og
   definerer `window.HUSKIS_RECIPE`; i node er den en CommonJS-modul.

   DOKUMENTET (`notes.recipe` i databasen):

     doc  = { v: 1, desc: '', serv: number|null, ing: Sec, step: Sec }
     Sec  = { items: Line[], subs: Sub[] }
     Sub  = { id, name, items: Line[] }
     Line = ingrediens: { id, q, q2, f, qs, u, t }
            steg:       { id, t }

   EN INGREDIENS ER STRUKTURERT, ikke en tekstlinje: mengden er et TALL (`q`,
   og `q2` for et spenn som «2–3»), atskilt fra enheten (`u`) og navnet (`t`).
   Det er det som gjør porsjonsskaleringen trygg — et tall ganges, en tekst
   gjør ikke. `f` sier at mengden ble skrevet som brøk, så visningen svarer i
   samme stil («½ ts», ikke «0,5 ts»). En mengde som ikke er et tall («en
   klype») ligger urørt i `qs` og skaleres aldri.

   «ØVRIGE» ER AVLEDET, ikke lagret. `items` er linjene som ikke står i noen
   underinndeling. Uten underinndelinger vises de rett under hovedoverskriften;
   så snart det finnes minst én, vises de samlet SIST som «Øvrige
   ingredienser»/«Øvrige steg». Hele regelsettet i oppgaven følger av det ene
   grepet, uten en eneste spesialsak å holde i synk:
     • ny linje på hovednivå havner i `items` — direkte under hovedoverskriften
       når det ikke finnes underinndelinger, ellers i «Øvrige»;
     • den første underinndelingen gjør eksisterende linjer til «Øvrige»;
     • «Øvrige» kan verken slettes eller oppløses for hånd — den finnes ikke
       som objekt — og forsvinner av seg selv når den blir tom;
     • blir den den ENESTE gjenværende, er det fordi siste ekte
       underinndeling er borte, og da vises linjene på hovednivå igjen.
   Rekkefølgen bevares hele veien: oppløsning legger linjene FØRST i `items`,
   altså nøyaktig der de stod i lesestrømmen (rett før «Øvrige»).
   ============================================================ */
(function (root) {
  'use strict';

  var DOC_V = 1;
  var SECTIONS = ['ing', 'step'];
  // Tak som holder et ondsinnet eller ødelagt dokument fra å velte visningen.
  var MAX = { title: 300, desc: 5000, text: 1000, unit: 40, qs: 40, name: 200, lines: 500, subs: 100 };

  /* ---------------- Ids ---------------- */
  function newId() {
    var a = '';
    var c = (typeof crypto !== 'undefined' && crypto.getRandomValues) ? crypto : null;
    if (c) {
      var b = new Uint8Array(8);
      c.getRandomValues(b);
      for (var i = 0; i < b.length; i++) a += (b[i] % 36).toString(36);
    } else {
      a = Math.random().toString(36).slice(2, 10);
    }
    return 'r' + a;
  }

  /* ---------------- Dokumentet ---------------- */
  function emptySection() { return { items: [], subs: [] }; }
  function emptyRecipe() {
    return { v: DOC_V, desc: '', serv: null, ing: emptySection(), step: emptySection() };
  }
  function str(v, max) { return typeof v === 'string' ? v.slice(0, max) : ''; }
  /* En id som mangler eller er brukt fra før, erstattes av en som er UTLEDET
     av plassen — ikke tilfeldig. Normaliseringen kjøres på hver synk-runde,
     og to kjøringer på det samme dokumentet må gi BYTE-LIKT svar; ellers ville
     synken sett en endring hver gang og skrevet den samme oppskriften i det
     uendelige. */
  function keepId(raw, seen, sec) {
    var id = typeof raw === 'string' && raw && raw.length <= 40 && !seen[raw] ? raw : null;
    if (!id) {
      var k = 0;
      while (seen['x' + sec + k]) k++;
      id = 'x' + sec + k;
    }
    seen[id] = 1;
    return id;
  }
  function num(v) {
    return typeof v === 'number' && isFinite(v) && v >= 0 && v < 1e9 ? v : null;
  }
  function cleanLine(sec, raw, seen) {
    if (!raw || typeof raw !== 'object') return null;
    var id = keepId(raw.id, seen, sec);
    if (sec === 'step') return { id: id, t: str(raw.t, MAX.text) };
    var q = num(raw.q);
    var q2 = q == null ? null : num(raw.q2);
    return {
      id: id, q: q, q2: q2 != null && q2 > q ? q2 : null, f: q != null && raw.f ? 1 : 0,
      qs: q == null ? str(raw.qs, MAX.qs) : '', u: str(raw.u, MAX.unit), t: str(raw.t, MAX.text),
    };
  }
  function cleanLines(sec, list, seen, budget) {
    var out = [];
    (Array.isArray(list) ? list : []).forEach(function (raw) {
      if (budget.n <= 0) return;
      var l = cleanLine(sec, raw, seen);
      if (l) { out.push(l); budget.n--; }
    });
    return out;
  }
  function cleanSection(sec, raw, seen) {
    raw = raw && typeof raw === 'object' ? raw : {};
    var budget = { n: MAX.lines };
    var items = cleanLines(sec, raw.items, seen, budget);
    var subs = [];
    (Array.isArray(raw.subs) ? raw.subs : []).slice(0, MAX.subs).forEach(function (s) {
      if (!s || typeof s !== 'object') return;
      var id = keepId(s.id, seen, sec + 's');
      subs.push({ id: id, name: str(s.name, MAX.name), items: cleanLines(sec, s.items, seen, budget) });
    });
    return { items: items, subs: subs };
  }
  /* Normaliserer et dokument fra serveren eller en eldre klient. Alt ukjent
     kastes, alt for langt kappes, og to linjer med samme id får hver sin —
     slik at visning og redigering alltid kan stole på formen. */
  function sanitizeRecipe(raw) {
    raw = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    var seen = {};
    var serv = num(raw.serv);
    return {
      v: DOC_V,
      desc: str(raw.desc, MAX.desc),
      serv: serv != null && serv > 0 ? serv : null,
      ing: cleanSection('ing', raw.ing, seen),
      step: cleanSection('step', raw.step, seen),
    };
  }

  /* ---------------- Mengder: tolking ----------------
     Godtar heltall og desimaltall med komma eller punktum, brøker («1/2»,
     «½»), blandede tall («1 1/2», «1½») og spenn («2-3», «2–3», «½-1»).
     Svarer `null` på tom tekst og `{ qs }` på noe som ikke er et tall. */
  var VULGAR = {
    '½': 0.5, '⅓': 1 / 3, '⅔': 2 / 3, '¼': 0.25, '¾': 0.75, '⅕': 0.2, '⅖': 0.4, '⅗': 0.6,
    '⅘': 0.8, '⅙': 1 / 6, '⅚': 5 / 6, '⅛': 0.125, '⅜': 0.375, '⅝': 0.625, '⅞': 0.875,
  };
  var VULGAR_RE = '[½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]';
  var ONE_RE = new RegExp('^(?:(\\d+)\\s*(' + VULGAR_RE + ')|(\\d+)\\s+(\\d+)\\s*/\\s*(\\d+)|' +
    '(\\d+)\\s*/\\s*(\\d+)|(' + VULGAR_RE + ')|(\\d*[.,]\\d+|\\d+[.,]?))$');
  function parseOne(s) {
    var m = ONE_RE.exec(s.trim());
    if (!m) return null;
    if (m[1] != null) return { n: +m[1] + VULGAR[m[2]], f: 1 };
    if (m[3] != null) return +m[5] ? { n: +m[3] + m[4] / m[5], f: 1 } : null;
    if (m[6] != null) return +m[7] ? { n: m[6] / m[7], f: 1 } : null;
    if (m[8] != null) return { n: VULGAR[m[8]], f: 1 };
    var n = parseFloat(m[9].replace(',', '.'));
    return isFinite(n) ? { n: n, f: 0 } : null;
  }
  function parseAmount(text) {
    var s = String(text == null ? '' : text).trim();
    if (!s) return null;
    // Et spenn: to tall med bindestrek/tankestrek mellom. Bindestreken i en
    // brøk («1/2») er ikke et spenn — den er en skråstrek.
    var parts = s.split(/\s*[-–—]\s*/);
    if (parts.length === 2 && parts[0] && parts[1]) {
      var a = parseOne(parts[0]), b = parseOne(parts[1]);
      if (a && b && b.n > a.n) return { q: a.n, q2: b.n, f: a.f || b.f ? 1 : 0 };
    }
    var one = parts.length === 1 ? parseOne(s) : null;
    if (one) return { q: one.n, q2: null, f: one.f };
    return { qs: s.slice(0, MAX.qs) };
  }

  /* En hel ingredienslinje skrevet i ett felt («2 dl melk», «½ ts salt»,
     «salt etter smak»): mengden først, så enheten HVIS ordet er en kjent
     enhet, og resten er navnet. Ukjent ord etter mengden blir en del av navnet
     — «3 egg» er tre egg, ikke tre «egg»-enheter. */
  var UNITS = ['g', 'gr', 'gram', 'kg', 'hg', 'mg', 'l', 'liter', 'dl', 'cl', 'ml', 'ss', 'ts', 'krm',
    'spsk', 'tsk', 'kopp', 'kopper', 'stk', 'pk', 'pakke', 'pakker', 'boks', 'bokser', 'fedd',
    'klype', 'klyper', 'neve', 'never', 'skive', 'skiver', 'bunt', 'glass', 'flaske',
    'cup', 'cups', 'tbsp', 'tsp', 'oz', 'lb', 'lbs', 'pinch', 'clove', 'cloves', 'can', 'cans',
    'pcs', 'slice', 'slices', 'bunch', 'handful', 'pint', 'quart', 'gallon', 'stick', 'sticks'];
  function isUnit(w) {
    var k = String(w || '').toLowerCase().replace(/\.$/, '');
    return UNITS.indexOf(k) > -1;
  }
  function parseIngredientLine(text) {
    var s = String(text == null ? '' : text).trim().replace(/\s+/g, ' ');
    var line = { q: null, q2: null, f: 0, qs: '', u: '', t: '' };
    if (!s) return line;
    var words = s.split(' ');
    // Lengste forstavelse av ord som til sammen er en mengde (opptil tre ord:
    // «1 1/2», «2 - 3»).
    for (var k = Math.min(3, words.length); k >= 1; k--) {
      var a = parseAmount(words.slice(0, k).join(' '));
      if (a && a.q != null) {
        line.q = a.q; line.q2 = a.q2; line.f = a.f;
        words = words.slice(k);
        break;
      }
    }
    if (line.q != null && words.length > 1 && isUnit(words[0])) {
      line.u = words[0];
      words = words.slice(1);
    }
    line.t = words.join(' ').slice(0, MAX.text);
    return line;
  }

  /* ---------------- Mengder: visning ----------------
     `dec` er desimaltegnet (',' på norsk, '.' på engelsk) — appen og den
     offentlige visningen sender det fra språket. */
  var FRACS = [[0, ''], [1 / 8, '⅛'], [1 / 4, '¼'], [1 / 3, '⅓'], [3 / 8, '⅜'], [1 / 2, '½'],
    [5 / 8, '⅝'], [2 / 3, '⅔'], [3 / 4, '¾'], [7 / 8, '⅞'], [1, '']];
  function trimNum(n, digits, dec) {
    var s = n.toFixed(digits);
    if (s.indexOf('.') > -1) s = s.replace(/0+$/, '').replace(/\.$/, '');
    return s === '-0' ? '0' : s.replace('.', dec || ',');
  }
  // Et lesbart tall: få desimaler, og færre jo større tallet er — «333 g»,
  // ikke «333,3333 g». Uskalerte mengder vises med inntil tre desimaler, så
  // det brukeren skrev står igjen.
  function formatDecimal(n, scaled, dec) {
    if (!scaled) return trimNum(n, 3, dec);
    if (n >= 100) return trimNum(Math.round(n), 0, dec);
    if (n >= 10) return trimNum(n, 1, dec);
    return trimNum(n, 2, dec);
  }
  // Brøkstil: nærmeste åttedel eller tredjedel, når den er nær nok. Ellers et
  // desimaltall — en brøk som er feil er verre enn et tall som er riktig.
  function formatFraction(n, dec) {
    var whole = Math.floor(n + 1e-9);
    var rest = n - whole;
    var best = null;
    FRACS.forEach(function (f) {
      var d = Math.abs(rest - f[0]);
      if (!best || d < best.d) best = { d: d, f: f };
    });
    if (best.d > 0.02) return formatDecimal(n, true, dec);
    if (best.f[0] === 1) { whole += 1; return String(whole); }
    if (!best.f[1]) return String(whole);
    return whole ? whole + best.f[1] : best.f[1];
  }
  function formatNumber(n, frac, scaled, dec) {
    if (n == null || !isFinite(n)) return '';
    return frac ? formatFraction(n, dec) : formatDecimal(n, scaled, dec);
  }
  function scaleFactor(base, chosen) {
    var b = num(base), c = num(chosen);
    return b && c ? c / b : 1;
  }
  /* Mengdeteksten for én ingrediens ved en gitt faktor. Faktoren rører aldri
     det lagrede tallet — den brukes bare her, i visningen. */
  function formatAmount(line, factor, dec) {
    if (!line) return '';
    if (line.q == null) return line.qs || '';
    var k = typeof factor === 'number' && factor > 0 ? factor : 1;
    var scaled = Math.abs(k - 1) > 1e-9;
    var a = formatNumber(line.q * k, !!line.f, scaled, dec);
    if (line.q2 == null) return a;
    return a + '–' + formatNumber(line.q2 * k, !!line.f, scaled, dec);
  }
  // Mengden slik redigeringsfeltet viser den: uskalert, i brukerens egen stil.
  function amountInputText(line, dec) { return formatAmount(line, 1, dec); }
  function ingredientText(line, factor, dec) {
    return [formatAmount(line, factor, dec), line.u, line.t]
      .filter(function (s) { return s; }).join(' ');
  }

  /* ---------------- Underinndelingene ----------------
     Alle operasjonene MUTERER dokumentet de får og returnerer det de berører,
     slik at kalleren kan lagre én gang. `sec` er 'ing' eller 'step'. */
  function section(doc, sec) {
    if (SECTIONS.indexOf(sec) === -1) throw new Error('ukjent seksjon: ' + sec);
    return doc[sec];
  }
  function findSub(doc, sec, subId) {
    var s = section(doc, sec);
    for (var i = 0; i < s.subs.length; i++) if (s.subs[i].id === subId) return s.subs[i];
    return null;
  }
  // Lista en linje står i (`items` eller en underinndelings), og plassen.
  function locate(doc, sec, lineId) {
    var s = section(doc, sec);
    var lists = [{ sub: null, list: s.items }].concat(s.subs.map(function (u) {
      return { sub: u, list: u.items };
    }));
    for (var i = 0; i < lists.length; i++) {
      for (var j = 0; j < lists[i].list.length; j++) {
        if (lists[i].list[j].id === lineId) return { sub: lists[i].sub, list: lists[i].list, index: j };
      }
    }
    return null;
  }
  function listOf(doc, sec, subId) {
    if (!subId) return section(doc, sec).items;
    var sub = findSub(doc, sec, subId);
    return sub ? sub.items : null;
  }
  function clampIndex(i, len) {
    return typeof i === 'number' && i >= 0 && i <= len ? i : len;
  }
  function newLine(sec, fields) {
    if (sec === 'step') return { id: newId(), t: str(fields && fields.t, MAX.text) };
    var l = cleanLine('ing', Object.assign({}, fields || {}, { id: newId() }), {});
    return l;
  }
  /* Ny linje. `subId` null = HOVEDNIVÅET — som er rett under overskriften
     uten underinndelinger, og «Øvrige» med. Samme operasjon, og nettopp
     derfor samme oppførsel som oppgaven ber om. */
  function addLine(doc, sec, subId, fields, index) {
    var list = listOf(doc, sec, subId) || section(doc, sec).items;
    var line = newLine(sec, fields);
    list.splice(clampIndex(index, list.length), 0, line);
    return line;
  }
  function updateLine(doc, sec, lineId, fields) {
    var at = locate(doc, sec, lineId);
    if (!at) return null;
    var cur = at.list[at.index];
    var next = sec === 'step'
      ? { id: cur.id, t: str(fields.t != null ? fields.t : cur.t, MAX.text) }
      : cleanLine('ing', Object.assign({}, cur, fields, { id: cur.id }), {});
    at.list[at.index] = next;
    return next;
  }
  function removeLine(doc, sec, lineId) {
    var at = locate(doc, sec, lineId);
    if (!at) return null;
    return { line: at.list.splice(at.index, 1)[0], subId: at.sub ? at.sub.id : null, index: at.index };
  }
  // Flytt en linje til en plass i en (annen) underinndeling eller hovednivået
  // — men alltid INNENFOR samme seksjon: en ingrediens kan aldri bli et steg.
  function moveLine(doc, sec, lineId, toSubId, toIndex) {
    var target = listOf(doc, sec, toSubId);
    if (!target) return false;
    var at = locate(doc, sec, lineId);
    if (!at) return false;
    var line = at.list.splice(at.index, 1)[0];
    target.splice(clampIndex(toIndex, target.length), 0, line);
    return true;
  }
  function addSub(doc, sec, name, index) {
    var s = section(doc, sec);
    var sub = { id: newId(), name: str(name, MAX.name), items: [] };
    s.subs.splice(clampIndex(index, s.subs.length), 0, sub);
    return sub;
  }
  function renameSub(doc, sec, subId, name) {
    var sub = findSub(doc, sec, subId);
    if (sub) sub.name = str(name, MAX.name);
    return sub;
  }
  function moveSub(doc, sec, subId, toIndex) {
    var s = section(doc, sec);
    var i = s.subs.findIndex(function (u) { return u.id === subId; });
    if (i === -1) return false;
    var sub = s.subs.splice(i, 1)[0];
    s.subs.splice(clampIndex(toIndex, s.subs.length), 0, sub);
    return true;
  }
  /* Oppløs: underinndelingen forsvinner, linjene består. De legges FØRST på
     hovednivået — der de stod i lesestrømmen. Var den den eneste, er
     hovednivået nå uten underinndelinger og linjene vises rett under
     overskriften; ellers havner de i «Øvrige». Ingenting slettes. */
  function dissolveSub(doc, sec, subId) {
    var s = section(doc, sec);
    var i = s.subs.findIndex(function (u) { return u.id === subId; });
    if (i === -1) return null;
    var sub = s.subs.splice(i, 1)[0];
    s.items = sub.items.concat(s.items);
    return { sub: sub, index: i };
  }
  // Slett: underinndelingen OG linjene i den. Svaret er det som trengs for å
  // angre (`restoreSub`).
  function deleteSub(doc, sec, subId) {
    var s = section(doc, sec);
    var i = s.subs.findIndex(function (u) { return u.id === subId; });
    if (i === -1) return null;
    return { sub: s.subs.splice(i, 1)[0], index: i };
  }
  function restoreSub(doc, sec, removed) {
    if (!removed || !removed.sub) return;
    var s = section(doc, sec);
    if (findSub(doc, sec, removed.sub.id)) return;
    s.subs.splice(clampIndex(removed.index, s.subs.length), 0, removed.sub);
  }

  /* Gruppene slik de VISES: én per underinndeling i rekkefølge, pluss den
     avledede «Øvrige» sist når den har noe i seg — eller én navnløs gruppe
     når det ikke finnes underinndelinger. `other` merker «Øvrige»; den har
     ingen id fordi den ikke finnes som objekt. */
  function groups(doc, sec) {
    var s = section(doc, sec);
    if (!s.subs.length) return [{ id: null, name: null, other: false, items: s.items }];
    var out = s.subs.map(function (u) { return { id: u.id, name: u.name, other: false, items: u.items }; });
    if (s.items.length) out.push({ id: null, name: null, other: true, items: s.items });
    return out;
  }
  function lineCount(doc, sec) {
    var s = section(doc, sec);
    return s.subs.reduce(function (n, u) { return n + u.items.length; }, s.items.length);
  }

  /* ---------------- Ordene ----------------
     Nøklene i språkordboken (i18n.js) for de to hoveddelene. De står her
     fordi både appens redigering og den delte lesevisningen trenger dem —
     ett sett, så de to aldri kan kalle det samme ved to navn. */
  var LABELS = {
    ing: {
      title: 'recipes.ingredients', other: 'recipes.otherIngredients', empty: 'recipes.noIngredients',
      addLine: 'recipes.addIngredient', addLineIn: 'recipes.addIngredientIn',
      addSub: 'recipes.addIngredientGroup', subPlaceholder: 'recipes.ingredientGroupPlaceholder',
      subUntitled: 'recipes.ingredientGroupUntitled',
    },
    step: {
      title: 'recipes.steps', other: 'recipes.otherSteps', empty: 'recipes.noSteps',
      addLine: 'recipes.addStep', addLineIn: 'recipes.addStepIn',
      addSub: 'recipes.addStepGroup', subPlaceholder: 'recipes.stepGroupPlaceholder',
      subUntitled: 'recipes.stepGroupUntitled',
    },
  };
  // «4 porsjoner» — tellerformen fra ordboken, med språkets desimaltegn.
  function servingsText(n, tr, dec) {
    return tr('count.serving.' + (n === 1 ? 'one' : 'other'), { n: formatNumber(n, false, false, dec) });
  }
  function groupTitle(g, sec, tr) {
    return g.other ? tr(LABELS[sec].other) : (g.name || tr(LABELS[sec].subUntitled));
  }

  /* All lesbar tekst i én oppskrift. Uten `tr` er den søkets og utdragenes
     råtekst; med `tr` er den oppskriften slik den kopieres ut av Huskis —
     overskrifter, «- 2 dl melk» og nummererte steg. */
  function recipeText(doc, dec, tr) {
    if (!doc) return '';
    if (!tr) {
      var parts = [doc.desc || ''];
      SECTIONS.forEach(function (sec) {
        groups(doc, sec).forEach(function (g) {
          if (g.name) parts.push(g.name);
          g.items.forEach(function (l) {
            parts.push(sec === 'ing' ? ingredientText(l, 1, dec) : l.t);
          });
        });
      });
      return parts.filter(function (p) { return p; }).join('\n');
    }
    var out = [];
    if (doc.desc) out.push(doc.desc, '');
    if (doc.serv) out.push(servingsText(doc.serv, tr, dec), '');
    SECTIONS.forEach(function (sec) {
      out.push(tr(LABELS[sec].title));
      groups(doc, sec).forEach(function (g) {
        if (g.id || g.other) out.push('', groupTitle(g, sec, tr));
        g.items.forEach(function (l, i) {
          out.push(sec === 'ing' ? '- ' + ingredientText(l, 1, dec) : (i + 1) + '. ' + l.t);
        });
      });
      out.push('');
    });
    return out.join('\n').trim();
  }

  /* ---------------- Lesevisningen (DOM) ----------------
     ÉN byggefunksjon for oppskriften slik den LESES — i appen og på den
     offentlige lenken, så de to aldri kan vise den forskjellig. Nodene bygges
     én og én med `textContent`; innhold blir aldri markup. Bare ikonene (som
     er appens egne SVG-strenger, ikke innhold) settes som HTML.

       o.tr          ordboken (i18n.js)
       o.icons       ikonene (icons.js): servings, minus, plus
       o.dec         desimaltegnet
       o.chosen      valgt antall porsjoner — lokalt, LAGRES ALDRI
       o.onServings  kalles med nytt antall når brukeren endrer det

     Porsjonsvelgeren finnes bare når oppskriften har et antall porsjoner å
     regne fra. Mengdene skaleres med `chosen / serv`; en mengde som ikke er et
     tall («en klype») står urørt. */
  function renderReader(root, doc, o) {
    var d = root.ownerDocument;
    var tr = o.tr;
    var dec = o.dec || ',';
    function el(tag, cls, text) {
      var e = d.createElement(tag);
      if (cls) e.className = cls;
      if (text != null) e.textContent = text;
      return e;
    }
    function btn(cls, icon, label, fn, disabled) {
      var b = el('button', cls);
      b.type = 'button';
      if (icon) b.innerHTML = icon;
      if (label) { b.setAttribute('aria-label', label); b.title = label; }
      b.disabled = !!disabled;
      b.addEventListener('click', fn);
      return b;
    }
    doc = doc || emptyRecipe();
    root.textContent = '';
    if (doc.desc) root.appendChild(el('p', 'recipe-desc', doc.desc));
    var base = num(doc.serv);
    var chosen = base ? (num(o.chosen) || base) : null;
    var factor = scaleFactor(base, chosen);
    if (base) {
      var min = Math.min(1, base);
      var set = function (v) { o.onServings(Math.round(Math.max(min, v) * 100) / 100); };
      var bar = el('div', 'recipe-serv');
      bar.setAttribute('role', 'group');
      bar.setAttribute('aria-label', tr('recipes.servingsLabel'));
      var ic = el('span', 'recipe-serv-icon');
      ic.setAttribute('aria-hidden', 'true');
      ic.innerHTML = o.icons.servings;
      var val = el('output', 'recipe-serv-value', servingsText(chosen, tr, dec));
      val.setAttribute('aria-live', 'polite');
      bar.appendChild(ic);
      bar.appendChild(btn('recipe-serv-btn recipe-serv-less', o.icons.minus, tr('recipes.servingsLess'),
        function () { set(chosen - 1); }, chosen - 1 < min - 1e-9));
      bar.appendChild(val);
      bar.appendChild(btn('recipe-serv-btn recipe-serv-more', o.icons.plus, tr('recipes.servingsMore'),
        function () { set(chosen + 1); }, chosen >= 999));
      if (Math.abs(chosen - base) > 1e-9) {
        var reset = btn('btn btn-ghost btn-small recipe-serv-reset', null, null, function () { set(base); });
        reset.textContent = tr('recipes.servingsReset', { n: servingsText(base, tr, dec) });
        bar.appendChild(reset);
      }
      root.appendChild(bar);
    }
    SECTIONS.forEach(function (sec) {
      var L = LABELS[sec];
      var box = el('section', 'recipe-sec');
      box.setAttribute('data-sec', sec);
      box.appendChild(el('h2', 'recipe-sec-title', tr(L.title)));
      if (!lineCount(doc, sec) && !doc[sec].subs.length) box.appendChild(el('p', 'recipe-empty', tr(L.empty)));
      groups(doc, sec).forEach(function (g) {
        if (g.id || g.other) {
          box.appendChild(el('h3', 'recipe-sub-name' + (g.other ? ' recipe-other-name' : ''), groupTitle(g, sec, tr)));
        }
        if (!g.items.length) return;
        // Stegene nummereres på nytt i hver underinndeling: «1.» er første
        // steg i DEN delen, slik en kokebok skriver det.
        var list = el(sec === 'ing' ? 'ul' : 'ol', sec === 'ing' ? 'recipe-ing-list' : 'recipe-step-list');
        g.items.forEach(function (l) {
          var li = el('li');
          if (sec === 'ing') {
            var head = [formatAmount(l, factor, dec), l.u].filter(function (x) { return x; }).join(' ');
            if (head) li.appendChild(el('span', 'recipe-amt', head));
            if (head && l.t) li.appendChild(d.createTextNode(' '));
            if (l.t) li.appendChild(el('span', 'recipe-ing-name', l.t));
          } else {
            li.appendChild(el('span', 'recipe-step-text', l.t));
          }
          list.appendChild(li);
        });
        box.appendChild(list);
      });
      root.appendChild(box);
    });
  }

  var api = {
    DOC_V: DOC_V, SECTIONS: SECTIONS, MAX: MAX,
    newId: newId, emptyRecipe: emptyRecipe, sanitizeRecipe: sanitizeRecipe,
    parseAmount: parseAmount, parseIngredientLine: parseIngredientLine, isUnit: isUnit,
    formatNumber: formatNumber, formatAmount: formatAmount, amountInputText: amountInputText,
    ingredientText: ingredientText, scaleFactor: scaleFactor,
    addLine: addLine, updateLine: updateLine, removeLine: removeLine, moveLine: moveLine,
    addSub: addSub, renameSub: renameSub, moveSub: moveSub,
    dissolveSub: dissolveSub, deleteSub: deleteSub, restoreSub: restoreSub,
    findSub: findSub, locate: locate, groups: groups, lineCount: lineCount,
    recipeText: recipeText, LABELS: LABELS, servingsText: servingsText, renderReader: renderReader,
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.HUSKIS_RECIPE = api;
})(typeof window !== 'undefined' ? window : this);
