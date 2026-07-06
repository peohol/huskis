/* ============================================================
   Mine lister — app.js
   Vanilla JS. Egen dra-og-slipp-motor på Pointer Events.
   ============================================================ */
(function () {
  'use strict';

  /* ---------------- Konstanter ---------------- */
  const STORAGE_KEY = 'mine-lister-v1';
  const TABS = ['huskelister', 'handlelister'];

  // Pen, myk pastellpalett. Header og aksent utledes ved å mørkne bakgrunnen.
  const PALETTE = [
    '#FFD6A5', '#FDFFB6', '#CAFFBF', '#9BF6FF', '#A0C4FF',
    '#BDB2FF', '#FFC6FF', '#FFADAD', '#B5EAD7', '#C7CEEA',
    '#FFDAC1', '#E2F0CB', '#FEC8D8', '#D6E2E9', '#F1E0C5',
  ];

  /* ---------------- Hjelpere ---------------- */
  const uid = () =>
    'id-' + Math.random().toString(36).slice(2, 9) + Math.random().toString(36).slice(2, 5);

  function hexToRgb(hex) {
    const h = hex.replace('#', '');
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
    };
  }
  function darken(hex, amt) {
    const { r, g, b } = hexToRgb(hex);
    const f = (c) => Math.max(0, Math.round(c * (1 - amt)));
    const to = (c) => c.toString(16).padStart(2, '0');
    return '#' + to(f(r)) + to(f(g)) + to(f(b));
  }

  function randomColor(avoid) {
    let c = PALETTE[Math.floor(Math.random() * PALETTE.length)];
    if (avoid && PALETTE.length > 1) {
      let guard = 0;
      while (c === avoid && guard++ < 10) c = PALETTE[Math.floor(Math.random() * PALETTE.length)];
    }
    return c;
  }

  /* ---------------- State ---------------- */
  function seedTab(kind) {
    if (kind === 'huskelister') {
      return {
        cards: [
          card('Ukens gjøremål', ['Rydde garasjen', 'Ringe tannlegen', 'Vanne blomstene']),
          card('Pakke til tur', ['Regnjakke', 'Ladekabel', 'Drikkeflaske', 'Kart']),
          card('Ideer', ['Male gjerdet', 'Prøve ny kaffebar']),
        ],
      };
    }
    return {
      cards: [
        card('Dagligvarer', ['Melk', 'Brød', 'Egg', 'Smør', 'Kaffe']),
        card('Middag i kveld', ['Kyllingfilet', 'Ris', 'Brokkoli', 'Soyasaus']),
        card('Apotek', ['Plaster', 'Solkrem']),
      ],
    };
  }

  let lastColor = null;
  function card(title, items) {
    const color = randomColor(lastColor);
    lastColor = color;
    return {
      id: uid(),
      title,
      color,
      items: (items || []).map((t) => ({ id: uid(), text: t })),
    };
  }

  function defaultState() {
    return {
      activeTab: 'huskelister',
      tabs: {
        huskelister: seedTab('huskelister'),
        handlelister: seedTab('handlelister'),
      },
    };
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || !parsed.tabs || !parsed.tabs.huskelister || !parsed.tabs.handlelister) return null;
      return parsed;
    } catch (e) {
      return null;
    }
  }

  let saveTimer = null;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      } catch (e) {
        /* ignore quota */
      }
    }, 120);
  }

  const state = load() || defaultState();

  /* ---------------- DOM-referanser ---------------- */
  const board = document.getElementById('board');
  const tabsEl = document.getElementById('tabs');
  const addCardBtn = document.getElementById('add-card-btn');
  const boardHint = document.getElementById('board-hint');
  const cardTpl = document.getElementById('card-template');
  const itemTpl = document.getElementById('item-template');

  const activeCards = () => state.tabs[state.activeTab].cards;
  const findCard = (id) => activeCards().find((c) => c.id === id);

  /* ---------------- Render ---------------- */
  function render() {
    // Faner
    [...tabsEl.querySelectorAll('.tab')].forEach((t) => {
      t.classList.toggle('active', t.dataset.tab === state.activeTab);
      t.setAttribute('aria-selected', t.dataset.tab === state.activeTab ? 'true' : 'false');
    });

    board.innerHTML = '';
    const cards = activeCards();

    if (cards.length === 0) {
      board.classList.add('empty');
      const es = document.createElement('div');
      es.className = 'empty-state';
      es.innerHTML =
        '<div class="big">🗒️</div><p>Ingen kategorier ennå.</p><p>Trykk «Ny kategori» for å komme i gang.</p>';
      board.appendChild(es);
      boardHint.textContent = '';
      save();
      return;
    }

    board.classList.remove('empty');
    cards.forEach((c) => board.appendChild(buildCard(c)));
    boardHint.textContent = cards.length + (cards.length === 1 ? ' kategori' : ' kategorier');
    save();
  }

  function buildCard(cardData) {
    const el = cardTpl.content.firstElementChild.cloneNode(true);
    el.dataset.id = cardData.id;

    const head = darken(cardData.color, 0.08);
    const accent = darken(cardData.color, 0.32);
    el.style.setProperty('--card-bg', cardData.color);
    el.style.setProperty('--card-head', head);
    el.style.setProperty('--card-accent', accent);

    const titleEl = el.querySelector('.card-title');
    titleEl.textContent = cardData.title;
    titleEl.addEventListener('click', () => editText(titleEl, cardData.title, (val) => {
      cardData.title = val || 'Uten navn';
      titleEl.textContent = cardData.title;
      save();
    }));

    el.querySelector('.card-delete').addEventListener('click', () => {
      const arr = activeCards();
      const idx = arr.findIndex((c) => c.id === cardData.id);
      if (idx > -1) {
        arr.splice(idx, 1);
        render();
      }
    });

    // Håndtak for kort-draging
    el.querySelector('.card-handle').addEventListener('pointerdown', (ev) => startCardDrag(ev, el));

    // Elementer
    const list = el.querySelector('.items-container');
    cardData.items.forEach((it) => list.appendChild(buildItem(it, cardData)));

    // Legg til element
    const form = el.querySelector('.add-item-form');
    const input = form.querySelector('.add-item-input');
    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const text = input.value.trim();
      if (!text) return;
      const it = { id: uid(), text };
      cardData.items.push(it);
      list.appendChild(buildItem(it, cardData));
      input.value = '';
      input.focus();
      save();
    });

    return el;
  }

  function buildItem(itemData, cardData) {
    const el = itemTpl.content.firstElementChild.cloneNode(true);
    el.dataset.id = itemData.id;

    const textEl = el.querySelector('.item-text');
    textEl.textContent = itemData.text;
    textEl.addEventListener('click', () => editText(textEl, itemData.text, (val) => {
      if (!val) return; // tom redigering = ingen endring
      itemData.text = val;
      textEl.textContent = val;
      save();
    }));

    el.querySelector('.item-delete').addEventListener('click', () => {
      const owner = ownerCardOf(el) || cardData;
      const idx = owner.items.findIndex((i) => i.id === itemData.id);
      if (idx > -1) owner.items.splice(idx, 1);
      el.remove();
      save();
    });

    el.querySelector('.item-handle').addEventListener('pointerdown', (ev) => startItemDrag(ev, el));
    return el;
  }

  // Finn hvilket kort (i state) et element-DOM ligger i akkurat nå
  function ownerCardOf(itemEl) {
    const cardEl = itemEl.closest('.card');
    if (!cardEl) return null;
    return findCard(cardEl.dataset.id);
  }

  /* ---------------- Inline-redigering ---------------- */
  function editText(displayEl, current, onSave) {
    if (displayEl.dataset.editing === '1') return;
    displayEl.dataset.editing = '1';
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'edit-input';
    input.value = current;
    displayEl.replaceWith(input);
    input.focus();
    input.setSelectionRange(0, input.value.length);

    let done = false;
    const finish = (commit) => {
      if (done) return;
      done = true;
      const val = input.value.trim();
      input.replaceWith(displayEl);
      delete displayEl.dataset.editing;
      if (commit) onSave(val);
    };
    input.addEventListener('blur', () => finish(true));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); finish(true); }
      else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    });
  }

  /* ============================================================
     DRA-OG-SLIPP-MOTOR
     Felles idé: kandidatpunkt = (pekerX, dra-elementets øvre kant Y).
     - i nederste femtedel av et mål  -> placeholder ETTER målet
     - i øverste femtedel av et mål   -> placeholder FØR målet
     - midtsonen = dødsone (hindrer flimring)
     ============================================================ */

  const drag = { active: false };

  function beginDragCommon(ev, el) {
    ev.preventDefault();
    const rect = el.getBoundingClientRect();
    drag.el = el;
    drag.width = rect.width;
    drag.height = rect.height;
    drag.grabX = ev.clientX - rect.left;
    drag.grabY = ev.clientY - rect.top;
    drag.pointerId = ev.pointerId;
    drag.active = true;
    try { ev.target.setPointerCapture(ev.pointerId); } catch (e) {}
    document.body.classList.add('is-dragging');
  }

  function liftElement() {
    const el = drag.el;
    el.style.width = drag.width + 'px';
    el.style.height = drag.height + 'px';
    el.style.left = (drag.lastX - drag.grabX) + 'px';
    el.style.top = (drag.lastY - drag.grabY) + 'px';
    el.classList.add('dragging');
  }

  function moveElement() {
    const el = drag.el;
    el.style.left = (drag.lastX - drag.grabX) + 'px';
    el.style.top = (drag.lastY - drag.grabY) + 'px';
  }

  /* ------- Generisk treffdeteksjon ------- */
  // targets: array av { el, rect }. point: {x, y}. Returnerer {el, pos:'before'|'after'} el. null.
  function hitTest(point, targets) {
    // 1) Direkte inni et mål?
    for (const t of targets) {
      const r = t.rect;
      if (point.x >= r.left && point.x <= r.right && point.y >= r.top && point.y <= r.bottom) {
        if (point.y >= r.top + r.height * 0.8) return { el: t.el, pos: 'after' };
        if (point.y <= r.top + r.height * 0.2) return { el: t.el, pos: 'before' };
        return null; // dødsone
      }
    }
    // 2) Samme kolonne (x innenfor horisontalt spenn) -> nærmeste vertikale gap
    const col = targets.filter((t) => point.x >= t.rect.left && point.x <= t.rect.right);
    if (col.length) {
      col.sort((a, b) => a.rect.top - b.rect.top);
      for (const t of col) {
        if (point.y < t.rect.top) return { el: t.el, pos: 'before' };
      }
      return { el: col[col.length - 1].el, pos: 'after' };
    }
    // 3) Nærmeste mål totalt (avstand til senter)
    let best = null, bestD = Infinity;
    for (const t of targets) {
      const cx = t.rect.left + t.rect.width / 2;
      const cy = t.rect.top + t.rect.height / 2;
      const d = (cx - point.x) ** 2 + (cy - point.y) ** 2;
      if (d < bestD) { bestD = d; best = t; }
    }
    if (best) {
      const r = best.rect;
      return { el: best.el, pos: point.y < r.top + r.height / 2 ? 'before' : 'after' };
    }
    return null;
  }

  /* ---------------- KORT-DRAGING ---------------- */
  function startCardDrag(ev, cardEl) {
    if (ev.button != null && ev.button !== 0) return;
    beginDragCommon(ev, cardEl);
    drag.kind = 'card';
    drag.lastX = ev.clientX;
    drag.lastY = ev.clientY;

    // Placeholder på kortets plass
    const ph = document.createElement('div');
    ph.className = 'card-placeholder';
    ph.style.height = drag.height + 'px';
    ph.style.setProperty('--card-accent', getComputedStyle(cardEl).getPropertyValue('--card-accent'));
    board.insertBefore(ph, cardEl);
    drag.ph = ph;

    liftElement();
    window.addEventListener('pointermove', onCardMove);
    window.addEventListener('pointerup', onCardUp);
    window.addEventListener('pointercancel', onCardUp);
  }

  function onCardMove(ev) {
    if (!drag.active) return;
    drag.lastX = ev.clientX;
    drag.lastY = ev.clientY;
    moveElement();

    const topEdgeY = ev.clientY - drag.grabY;
    const point = { x: ev.clientX, y: topEdgeY };

    const targets = [...board.querySelectorAll('.card:not(.dragging)')].map((el) => ({
      el,
      rect: el.getBoundingClientRect(),
    }));
    if (!targets.length) return;

    const hit = hitTest(point, targets);
    if (!hit) return;
    placePlaceholder(board, drag.ph, hit.el, hit.pos);
  }

  function onCardUp() {
    if (!drag.active) return;
    window.removeEventListener('pointermove', onCardMove);
    window.removeEventListener('pointerup', onCardUp);
    window.removeEventListener('pointercancel', onCardUp);

    const el = drag.el;
    // Plasser kortet der placeholder står
    board.insertBefore(el, drag.ph);
    drag.ph.remove();
    resetDraggedEl(el);
    finishDrag();

    // Bygg ny rekkefølge fra DOM
    const order = [...board.querySelectorAll('.card')].map((c) => c.dataset.id);
    const cards = activeCards();
    cards.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
    save();
  }

  /* ---------------- ELEMENT-DRAGING ---------------- */
  function startItemDrag(ev, itemEl) {
    if (ev.button != null && ev.button !== 0) return;
    beginDragCommon(ev, itemEl);
    drag.kind = 'item';
    drag.lastX = ev.clientX;
    drag.lastY = ev.clientY;

    const ph = document.createElement('li');
    ph.className = 'item-placeholder';
    ph.style.height = drag.height + 'px';
    itemEl.parentNode.insertBefore(ph, itemEl);
    drag.ph = ph;

    liftElement();
    window.addEventListener('pointermove', onItemMove);
    window.addEventListener('pointerup', onItemUp);
    window.addEventListener('pointercancel', onItemUp);
  }

  function onItemMove(ev) {
    if (!drag.active) return;
    drag.lastX = ev.clientX;
    drag.lastY = ev.clientY;
    moveElement();

    const topEdgeY = ev.clientY - drag.grabY;
    const point = { x: ev.clientX, y: topEdgeY };

    const targets = [...document.querySelectorAll('.item:not(.dragging)')].map((el) => ({
      el,
      rect: el.getBoundingClientRect(),
    }));

    const hit = hitTest(point, targets);
    if (hit) {
      placePlaceholder(hit.el.parentNode, drag.ph, hit.el, hit.pos);
      return;
    }

    // Ingen element truffet: sjekk om vi er over en (tom) items-container
    const containers = [...document.querySelectorAll('.items-container')];
    for (const cont of containers) {
      const r = cont.getBoundingClientRect();
      // Litt slingringsmonn så det er lett å treffe smale/tomme kort
      if (ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top - 8 && ev.clientY <= r.bottom + 8) {
        const items = [...cont.querySelectorAll('.item:not(.dragging)')];
        let placed = false;
        for (const it of items) {
          const ir = it.getBoundingClientRect();
          if (point.y < ir.top + ir.height / 2) {
            cont.insertBefore(drag.ph, it);
            placed = true;
            break;
          }
        }
        if (!placed && drag.ph.parentNode !== cont) cont.appendChild(drag.ph);
        else if (!placed && cont.lastElementChild !== drag.ph) cont.appendChild(drag.ph);
        return;
      }
    }
  }

  function onItemUp() {
    if (!drag.active) return;
    window.removeEventListener('pointermove', onItemMove);
    window.removeEventListener('pointerup', onItemUp);
    window.removeEventListener('pointercancel', onItemUp);

    const el = drag.el;
    const sourceCardId = el.closest('.card') ? el.closest('.card').dataset.id : null;
    const targetContainer = drag.ph.parentNode;
    targetContainer.insertBefore(el, drag.ph);
    drag.ph.remove();
    resetDraggedEl(el);
    finishDrag();

    const targetCardId = el.closest('.card').dataset.id;
    reconcileItems(sourceCardId);
    if (targetCardId !== sourceCardId) reconcileItems(targetCardId);
    save();
  }

  // Bygg items-array for et kort ut fra gjeldende DOM-rekkefølge
  function reconcileItems(cardId) {
    const cardData = findCard(cardId);
    if (!cardData) return;
    const cardEl = board.querySelector('.card[data-id="' + cardId + '"]');
    if (!cardEl) return;
    const domIds = [...cardEl.querySelectorAll('.items-container > .item')].map((i) => i.dataset.id);

    // Slå sammen elementer som kan ha kommet fra et annet kort
    const pool = {};
    activeCards().forEach((c) => c.items.forEach((it) => { pool[it.id] = it; }));
    cardData.items = domIds.map((id) => pool[id]).filter(Boolean);
  }

  /* ---------------- Delte drag-hjelpere ---------------- */
  function placePlaceholder(container, ph, refEl, pos) {
    if (refEl === ph) return;
    if (pos === 'before') {
      if (refEl.previousElementSibling !== ph) container.insertBefore(ph, refEl);
    } else {
      if (refEl.nextElementSibling !== ph) container.insertBefore(ph, refEl.nextElementSibling);
    }
  }

  function resetDraggedEl(el) {
    el.classList.remove('dragging');
    el.style.left = el.style.top = el.style.width = el.style.height = '';
  }

  function finishDrag() {
    drag.active = false;
    drag.el = null;
    drag.ph = null;
    document.body.classList.remove('is-dragging');
  }

  /* ---------------- Fane / topp-knapper ---------------- */
  tabsEl.addEventListener('click', (ev) => {
    const t = ev.target.closest('.tab');
    if (!t) return;
    if (state.activeTab === t.dataset.tab) return;
    state.activeTab = t.dataset.tab;
    render();
  });

  addCardBtn.addEventListener('click', () => {
    const c = card('Ny kategori', []);
    activeCards().push(c);
    render();
    // Fokuser den nye tittelen for redigering
    const el = board.querySelector('.card[data-id="' + c.id + '"] .card-title');
    if (el) el.click();
  });

  /* ---------------- Start ---------------- */
  // Sett en fornuftig lastColor så nye kort varierer
  const existing = activeCards();
  if (existing.length) lastColor = existing[existing.length - 1].color;
  render();

  // Eksponer for enkel feilsøking/testing
  window.__mineLister = { state, render };
})();
