/* ============================================================
   Huskis — recipe-public.js

   Den offentlige lesevisningen bak en delt oppskriftslenke:
   `oppskrift.html#<nøkkel>`. Ingen innlogging, ingen konto, ingen skriving.

   SIKKERHETEN LIGGER I DATABASEN, ikke her. Siden kaller nøyaktig én funksjon,
   `recipe_public_get(nøkkel)`, som anonym — med en klient som verken leser
   eller lagrer noen innlogget økt, så heller ikke en innlogget Huskis-bruker
   tar med seg sine rettigheter hit. Svaret inneholder bare navn, titler og
   oppskriftsinnhold for det som er delt: ingen id-er, ingen personer, ingen
   andre deler av Huskis. Ukjent, avslått og død lenke gir det samme svaret
   (null), og siden sier det samme for alle tre.

   Nøkkelen står i FRAGMENTET (#…), som nettleseren aldri sender til serveren —
   den havner verken i tilgangslogger eller i en Referer.

   Porsjonsvalget er lokalt (som i appen) og endrer aldri det lagrede.
   Innholdet hentes på nytt når fanen blir synlig igjen, så leseren alltid ser
   den nyeste versjonen — og en lenke som er slått av slutter å vise noe.

   Autoritativt: docs/oppskrifter.md.
   ============================================================ */
(function () {
  'use strict';

  var I18N = window.HUSKIS_I18N;
  var tr = I18N.t;
  var RECIPE = window.HUSKIS_RECIPE;
  var ICONS = window.ICONS || {};
  var THEME = window.HUSKIS_THEME;
  var dec = I18N.lang() === 'en' ? '.' : ',';

  var main = document.getElementById('pub-main');
  var themeBtn = document.getElementById('pub-theme');
  var backBtn = document.getElementById('pub-back');
  var invite = document.getElementById('pub-invite');
  var INVITE_KEY = 'hk-pub-invite-closed';

  var data = null;     // det siste svaret fra serveren
  var view = { c: null, r: null, title: '' };  // hvor leseren står (indekser i svaret)
  var inflight = null; // nøkkelen som hentes nå

  function token() {
    try { return decodeURIComponent((location.hash || '').slice(1)); } catch (e) { return ''; }
  }

  /* En klient uten økt: `persistSession: false` gjør at den aldri leser
     appens innlogging fra localStorage. Kallet går dermed alltid som anonym. */
  var client = null;
  function cli() {
    if (client) return client;
    if (window.HK_MOCK && /[?&]mock=1/.test(location.search)) client = window.HK_MOCK.createClient();
    else {
      var c = window.SUPABASE_CONFIG;
      client = window.supabase.createClient(c.url, c.anonKey, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      });
    }
    return client;
  }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function icon(name) {
    var s = el('span', 'kind-icon pub-icon');
    s.setAttribute('aria-hidden', 'true');
    s.innerHTML = ICONS[name] || '';
    return s;
  }

  /* ---- Svaret valideres ved grensen: bare de feltene vi viser, i de typene
     vi venter. Alt annet kastes. ---- */
  function str(v) { return typeof v === 'string' ? v : ''; }
  function cleanRecipes(list) {
    return (Array.isArray(list) ? list : []).map(function (x) {
      return { title: str(x && x.title), recipe: RECIPE.sanitizeRecipe(x && x.recipe) };
    });
  }
  function clean(d) {
    if (!d || typeof d !== 'object' || ['book', 'chapter', 'recipe'].indexOf(d.type) < 0) return null;
    return {
      type: d.type,
      name: str(d.name),
      chapters: (Array.isArray(d.chapters) ? d.chapters : []).map(function (c) {
        return { name: str(c && c.name), recipes: cleanRecipes(c && c.recipes) };
      }),
      recipes: cleanRecipes(d.recipes),
    };
  }

  function recipeAt(c, r) {
    if (!data) return null;
    var list = c == null ? data.recipes : (data.chapters[c] || {}).recipes;
    return (list && list[r]) || null;
  }
  function titleOf(x) { return x.title.trim() || tr('recipes.untitled'); }

  /* ---- Tegning ---- */
  function setTitle(name) {
    document.title = (name ? name + ' – ' : '') + 'Huskis';
  }
  function heading(text, iconName) {
    var row = el('div', 'note-title-row pub-title-row');
    row.appendChild(icon(iconName));
    row.appendChild(el('h1', 'recipe-title', text));
    return row;
  }
  function recipeList(list, c) {
    var ul = el('ul', 'pub-list');
    list.forEach(function (x, r) {
      var li = el('li');
      var b = el('button', 'pub-recipe');
      b.type = 'button';
      b.appendChild(icon('recipe'));
      b.appendChild(el('span', 'pub-recipe-title', titleOf(x)));
      b.addEventListener('click', function () { go(c, r); });
      li.appendChild(b);
      ul.appendChild(li);
    });
    return ul;
  }
  function renderRecipe(x) {
    var wrap = el('div', 'note-sheet-wrap');
    wrap.appendChild(heading(titleOf(x), 'recipe'));
    var sheet = el('div', 'note-sheet recipe-sheet');
    RECIPE.renderReader(sheet, x.recipe, {
      tr: tr, icons: ICONS, dec: dec, servings: false,
    });
    wrap.appendChild(sheet);
    return wrap;
  }
  function renderIndex() {
    var wrap = el('div', 'note-sheet-wrap');
    wrap.appendChild(heading(data.name || tr(data.type === 'book' ? 'recipes.newBook' : 'recipes.newChapter'),
      data.type === 'book' ? 'cookbook' : 'chapter'));
    var sheet = el('div', 'note-sheet pub-index');
    var any = data.recipes.length || data.chapters.some(function (c) { return c.recipes.length; });
    if (!any) sheet.appendChild(el('p', 'recipe-empty', tr('public.noRecipes')));
    // Oppskriftene rett i kokeboken står først, uten overskrift — de hører til
    // boken selv, som de frie oppskriftene i kokebokmenyen.
    if (data.recipes.length) {
      var free = el('section', 'pub-chapter');
      free.appendChild(recipeList(data.recipes, null));
      sheet.appendChild(free);
    }
    data.chapters.forEach(function (ch, c) {
      var sec = el('section', 'pub-chapter');
      var h = el('h2', 'recipe-sec-title');
      h.appendChild(icon('chapter'));
      h.appendChild(document.createTextNode(ch.name || tr('recipes.newChapter')));
      sec.appendChild(h);
      if (ch.recipes.length) sec.appendChild(recipeList(ch.recipes, c));
      else sec.appendChild(el('p', 'recipe-empty', tr('public.noRecipes')));
      sheet.appendChild(sec);
    });
    wrap.appendChild(sheet);
    return wrap;
  }
  function message(key, hintKey, retry) {
    var box = el('div', 'note-sheet-wrap pub-message');
    var sheet = el('div', 'note-sheet');
    sheet.appendChild(el('p', 'pub-message-title', tr(key)));
    if (hintKey) sheet.appendChild(el('p', 'recipe-desc', tr(hintKey)));
    if (retry) {
      var b = el('button', 'btn btn-solid btn-green btn-small', tr('public.retry'));
      b.type = 'button';
      b.addEventListener('click', load);
      sheet.appendChild(b);
    }
    box.appendChild(sheet);
    if (backBtn) backBtn.hidden = true;
    main.textContent = '';
    main.appendChild(box);
    main.setAttribute('aria-busy', 'false');
  }

  function render() {
    main.textContent = '';
    main.setAttribute('aria-busy', 'false');
    // Tilbake står i toppmenyen, og finnes bare inne i en oppskrift man kom
    // til fra innholdslisten.
    var inRecipe = data.type !== 'recipe' && view.r != null && !!recipeAt(view.c, view.r);
    if (backBtn) backBtn.hidden = !inRecipe;
    // Én oppskrift alene har ingen innholdsliste å gå tilbake til.
    if (data.type === 'recipe') {
      var only = data.recipes[0];
      if (!only) { message('public.gone', 'public.goneHint'); return; }
      setTitle(titleOf(only));
      main.appendChild(renderRecipe(only));
      return;
    }
    var x = view.r == null ? null : recipeAt(view.c, view.r);
    if (x) {
      setTitle(titleOf(x));
      main.appendChild(renderRecipe(x));
    } else {
      setTitle(data.name);
      main.appendChild(renderIndex());
    }
  }

  /* Leseren går inn i en oppskrift som et eget historikksteg, så telefonens
     tilbakeknapp tar en tilbake til innholdslisten. */
  function go(c, r) {
    var x = recipeAt(c, r);
    view = { c: c, r: r, title: x ? x.title : '' };
    history.pushState({ c: c, r: r, title: view.title }, '');
    render();
    window.scrollTo(0, 0);
  }
  window.addEventListener('popstate', function (ev) {
    var s = ev.state;
    view = s && s.r != null ? { c: s.c, r: s.r, title: s.title || '' } : { c: null, r: null, title: '' };
    if (data) { reconcileView(); render(); }
  });

  /* Står leseren i en oppskrift når innholdet hentes på nytt, finnes den
     igjen på tittelen — men bare når tittelen er ENTYDIG. Svaret har ingen
     id-er (med vilje), så to oppskrifter med samme tittel kan ikke skilles;
     da går leseren heller tilbake til innholdslisten enn å vise feil
     oppskrift. */
  function reconcileView() {
    if (view.r == null) return;
    var lists = [[null, data.recipes]].concat(data.chapters.map(function (ch, i) { return [i, ch.recipes]; }));
    var hits = [];
    lists.forEach(function (l) {
      l[1].forEach(function (x, j) { if (x.title === view.title) hits.push([l[0], j]); });
    });
    if (hits.length === 1) { view.c = hits[0][0]; view.r = hits[0][1]; return; }
    view = { c: null, r: null, title: '' };
    history.replaceState(null, '');
  }

  function load() {
    var t = token();
    if (!t) { message('public.gone', 'public.goneHint'); return; }
    // Samme nøkkel er alt på vei. En NY nøkkel (fragmentet er byttet) hentes
    // med en gang; svaret for den gamle kastes når det kommer.
    if (inflight === t) return;
    inflight = t;
    if (!data) main.setAttribute('aria-busy', 'true');
    function done() { if (inflight === t) inflight = null; return t === token(); }
    Promise.resolve()
      .then(function () { return cli().rpc('recipe_public_get', { p_token: t }); })
      .then(function (res) {
        if (!done()) return;
        if (res && res.error) throw res.error;
        data = clean(res && res.data);
        if (!data) { message('public.gone', 'public.goneHint'); return; }
        reconcileView();
        render();
      })
      .catch(function () {
        if (!done()) return;
        // Har vi allerede noe å vise, blir det stående; en glipp i nettet er
        // ingen grunn til å ta bort oppskriften man står og lager.
        if (!data) message('public.error', null, true);
      });
  }

  function paintTheme() {
    if (!themeBtn || !THEME) return;
    var dark = THEME.mode() === 'dark';
    themeBtn.innerHTML = dark ? ICONS.moon : ICONS.sun;
    var label = tr(dark ? 'theme.toLight' : 'theme.toDark');
    themeBtn.title = label;
    themeBtn.setAttribute('aria-label', label);
  }
  if (themeBtn && THEME) {
    themeBtn.addEventListener('click', function () {
      THEME.setMode(THEME.mode() === 'dark' ? 'light' : 'dark');
      paintTheme();
    });
  }

  /* ---- Invitasjonen nederst ----
     Bare for den som ikke er logget inn i Huskis i denne nettleseren. Siden
     selv er alltid anonym (`cli`), så spørsmålet er om APPEN har en økt her:
     Supabase-klienten lagrer den under `sb-<prosjekt>-auth-token`, og
     mock-backenden per fane. Vi ser bare etter at nøkkelen finnes — innholdet
     leses aldri. Lukket er lukket for godt i denne nettleseren. */
  function store(fn) { try { return fn(); } catch (e) { return null; } }
  function signedIn() {
    if (window.HK_MOCK && /[?&]mock=1/.test(location.search)) {
      return !!store(function () { return sessionStorage.getItem('hk-mock-session'); });
    }
    return !!store(function () {
      return Object.keys(localStorage).some(function (k) { return /^sb-.+-auth-token$/.test(k); });
    });
  }
  function paintInvite() {
    if (!invite) return;
    var closed = store(function () { return localStorage.getItem(INVITE_KEY); }) === '1';
    invite.hidden = closed || signedIn();
    document.body.classList.toggle('has-invite', !invite.hidden);
    var title = document.getElementById('pub-invite-title');
    if (!title || title.firstChild) return;
    // «… med {brand} ❤️»: merket er Huskis-logoen og navnet, som i toppmenyen.
    var parts = tr('public.inviteTitle').split('{brand}');
    title.appendChild(document.createTextNode(parts[0]));
    var brand = el('span', 'pub-invite-brand');
    var logo = el('img', 'pub-logo');
    logo.src = 'favicon.svg';
    logo.alt = '';
    brand.appendChild(logo);
    brand.appendChild(document.createTextNode('Huskis'));
    title.appendChild(brand);
    title.appendChild(document.createTextNode(parts.slice(1).join('')));
  }
  if (invite) {
    // Siden holder av plass til stripa, så det nederste ikke ligger under den.
    if (typeof ResizeObserver === 'function') {
      new ResizeObserver(function () {
        document.documentElement.style.setProperty('--pub-invite-h', (invite.hidden ? 0 : invite.offsetHeight) + 'px');
      }).observe(invite);
    }
    document.getElementById('pub-invite-close').addEventListener('click', function () {
      store(function () { localStorage.setItem(INVITE_KEY, '1'); });
      paintInvite();
    });
  }

  I18N.applyStatic(document);
  if (backBtn) backBtn.addEventListener('click', function () { history.back(); });
  paintInvite();
  paintTheme();
  window.addEventListener('hashchange', function () { data = null; view = { c: null, r: null, title: '' }; load(); });
  document.addEventListener('visibilitychange', function () { if (!document.hidden) load(); });
  load();
})();
