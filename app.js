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
    // Sky-synk (hvis en synk-kode er aktiv). Definert lenger nede; trygt å kalle.
    if (typeof cloudPush === 'function') cloudPush();
  }

  const state = load() || defaultState();

  // Sørg for at (evt. eldre) lagret state har forventet struktur, inkl. papirkurv.
  function normalize(s) {
    if (!TABS.includes(s.activeTab)) s.activeTab = 'huskelister';
    TABS.forEach((t) => {
      if (!s.tabs[t]) s.tabs[t] = { cards: [], trash: [] };
      if (!Array.isArray(s.tabs[t].cards)) s.tabs[t].cards = [];
      if (!Array.isArray(s.tabs[t].trash)) s.tabs[t].trash = [];
      s.tabs[t].cards.forEach((c) => { if (!Array.isArray(c.items)) c.items = []; });
      s.tabs[t].trash.forEach((c) => { if (!Array.isArray(c.items)) c.items = []; });
    });
  }
  normalize(state);

  /* ---------------- DOM-referanser ---------------- */
  const board = document.getElementById('board');
  const tabsEl = document.getElementById('tabs');
  const addCardBtn = document.getElementById('add-card-btn');
  const boardHint = document.getElementById('board-hint');
  const cardTpl = document.getElementById('card-template');
  const itemTpl = document.getElementById('item-template');

  const trashBtn = document.getElementById('trash-btn');
  const trashCount = document.getElementById('trash-count');
  const trashModal = document.getElementById('trash-modal');
  const trashList = document.getElementById('trash-list');
  const trashClose = document.getElementById('trash-close');
  const trashEmptyBtn = document.getElementById('trash-empty');

  const activeCards = () => state.tabs[state.activeTab].cards;
  const activeTrash = () => state.tabs[state.activeTab].trash;
  const findCard = (id) => activeCards().find((c) => c.id === id);

  /* ---------------- Render ---------------- */
  function updateTrashCount() {
    const n = activeTrash().length;
    trashCount.textContent = n;
    trashBtn.classList.toggle('has-items', n > 0);
  }

  function render() {
    // Faner
    [...tabsEl.querySelectorAll('.tab')].forEach((t) => {
      t.classList.toggle('active', t.dataset.tab === state.activeTab);
      t.setAttribute('aria-selected', t.dataset.tab === state.activeTab ? 'true' : 'false');
    });

    updateTrashCount();

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

    // Slett kategori -> legg i papirkurv (ikke permanent før «Tøm papirkurv»)
    el.querySelector('.card-delete').addEventListener('click', () => {
      const arr = activeCards();
      const idx = arr.findIndex((c) => c.id === cardData.id);
      if (idx > -1) {
        const [removed] = arr.splice(idx, 1);
        activeTrash().unshift(removed);
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
     Kort og elementer bytter plass når de overlapper et annet
     kort/element med minst 20 % av høyden. For å unngå flimring er
     byttet retningsstyrt: nedover-drag bytter kun med kortet under,
     oppover-drag kun med kortet over. Bytter animeres med FLIP (150 ms).
     Kryss-kolonne / overføring mellom kort skjer når dra-elementet
     føres inn i en annen kolonne/kategori.
     ============================================================ */

  const SWAP_RATIO = 0.2; // 20 % høydeoverlapp utløser bytte
  const FLIP_MS = 150;

  const drag = { active: false };

  /* ------- Geometri-hjelpere ------- */
  function vOverlap(a, b) {
    return Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  }
  function hOverlapFrac(a, b) {
    const o = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
    return o / Math.max(1, Math.min(a.width, b.width));
  }
  // Layout-boks uten evt. pågående FLIP-transform, så treffdeteksjon er stabil
  // selv mens kort animerer på plass.
  function layoutRect(el) {
    const r = el.getBoundingClientRect();
    const t = getComputedStyle(el).transform;
    if (t && t !== 'none') {
      try {
        const m = new DOMMatrixReadOnly(t);
        return {
          left: r.left - m.e, right: r.right - m.e,
          top: r.top - m.f, bottom: r.bottom - m.f,
          width: r.width, height: r.height,
        };
      } catch (e) { /* faller tilbake til r */ }
    }
    return r;
  }
  // Dra-elementets logiske boks ut fra pekerposisjon (urørt av rotasjon/skala).
  function draggedRect() {
    const left = drag.lastX - drag.grabX;
    const top = drag.lastY - drag.grabY;
    return { left, top, right: left + drag.width, bottom: top + drag.height, width: drag.width, height: drag.height };
  }

  /* ------- FLIP-animasjon ------- */
  function snapshotRects(els) {
    const m = new Map();
    els.forEach((el) => m.set(el, el.getBoundingClientRect()));
    return m;
  }
  function flipFrom(prev, dur) {
    prev.forEach((old, el) => {
      if (!el.isConnected) return;
      const now = el.getBoundingClientRect();
      const dx = old.left - now.left;
      const dy = old.top - now.top;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
      el.style.transition = 'none';
      el.style.transform = `translate(${dx}px, ${dy}px)`;
      void el.offsetWidth; // tving reflow så starttilstanden registreres
      requestAnimationFrame(() => {
        el.style.transition = `transform ${dur}ms cubic-bezier(.2,.75,.3,1)`;
        el.style.transform = '';
        el.addEventListener('transitionend', function te(e) {
          if (e.propertyName !== 'transform') return;
          el.style.transition = '';
          el.style.transform = '';
          el.removeEventListener('transitionend', te);
        });
      });
    });
  }

  /* ------- Felles start / bevegelse / slutt ------- */
  function beginDragCommon(ev, el) {
    ev.preventDefault();
    const rect = el.getBoundingClientRect();
    drag.el = el;
    drag.width = rect.width;
    drag.height = rect.height;
    drag.grabX = ev.clientX - rect.left;
    drag.grabY = ev.clientY - rect.top;
    drag.pointerId = ev.pointerId;
    drag.lastX = ev.clientX;
    drag.lastY = ev.clientY;
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

  function wouldMove(ph, refEl, pos) {
    if (refEl === ph) return false;
    if (pos === 'before') return refEl.previousElementSibling !== ph;
    return refEl.nextElementSibling !== ph; // 'after'
  }
  function placePlaceholder(container, ph, refEl, pos) {
    if (pos === 'before') container.insertBefore(ph, refEl);
    else container.insertBefore(ph, refEl.nextElementSibling);
  }

  // Animer dra-elementet fra flytende posisjon inn i placeholder-sloten.
  function dropIntoPlaceholder(el, spin) {
    const floatLeft = drag.lastX - drag.grabX;
    const floatTop = drag.lastY - drag.grabY;
    el.classList.remove('dragging');
    el.style.left = el.style.top = el.style.width = el.style.height = '';
    const now = el.getBoundingClientRect();
    const dx = floatLeft - now.left;
    const dy = floatTop - now.top;
    el.style.transition = 'none';
    el.style.transform = `translate(${dx}px, ${dy}px)${spin ? ' rotate(1.2deg) scale(1.02)' : ''}`;
    void el.offsetWidth;
    requestAnimationFrame(() => {
      el.style.transition = `transform ${FLIP_MS}ms cubic-bezier(.2,.75,.3,1)`;
      el.style.transform = '';
      el.addEventListener('transitionend', function te(e) {
        if (e.propertyName !== 'transform') return;
        el.style.transition = '';
        el.style.transform = '';
        el.removeEventListener('transitionend', te);
      });
    });
  }

  function finishDrag() {
    drag.active = false;
    drag.el = null;
    drag.ph = null;
    document.body.classList.remove('is-dragging');
  }

  /* ---------------- KORT-DRAGING ---------------- */
  function startCardDrag(ev, cardEl) {
    if (ev.button != null && ev.button !== 0) return;
    beginDragCommon(ev, cardEl);
    drag.kind = 'card';

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
    const dy = ev.clientY - drag.lastY;
    drag.lastX = ev.clientX;
    drag.lastY = ev.clientY;
    moveElement();

    const dragRect = draggedRect();
    const cards = [...board.querySelectorAll('.card:not(.dragging)')];
    if (!cards.length) return;
    const rects = new Map(cards.map((c) => [c, layoutRect(c)]));

    // Kolonne = kort som ligger på samme horisontale spor som dra-kortet.
    const col = cards.filter((c) => hOverlapFrac(dragRect, rects.get(c)) >= 0.5);
    const ph = drag.ph;
    const phInCol = col.length && hOverlapFrac(dragRect, layoutRect(ph)) >= 0.5;

    let action = null;

    if (col.length && !phInCol) {
      // Bytte kolonne: plasser etter vertikal senterposisjon.
      const cy = dragRect.top + dragRect.height / 2;
      const sorted = col.slice().sort((a, b) => rects.get(a).top - rects.get(b).top);
      let ref = null;
      for (const c of sorted) {
        const r = rects.get(c);
        if (cy < r.top + r.height / 2) { ref = c; break; }
      }
      action = ref ? { ref, pos: 'before' } : { ref: sorted[sorted.length - 1], pos: 'after' };
    } else if (col.length && dy > 0) {
      // Nedover: nærmeste kort under med >= 20 % overlapp.
      let best = null, bestTop = Infinity;
      for (const c of col) {
        const r = rects.get(c);
        if (r.top >= dragRect.top && vOverlap(dragRect, r) >= SWAP_RATIO * r.height && r.top < bestTop) {
          bestTop = r.top; best = c;
        }
      }
      if (best) action = { ref: best, pos: 'after' };
    } else if (col.length && dy < 0) {
      // Oppover: nærmeste kort over med >= 20 % overlapp.
      let best = null, bestTop = -Infinity;
      for (const c of col) {
        const r = rects.get(c);
        if (r.top <= dragRect.top && vOverlap(dragRect, r) >= SWAP_RATIO * r.height && r.top > bestTop) {
          bestTop = r.top; best = c;
        }
      }
      if (best) action = { ref: best, pos: 'before' };
    }

    if (!action || !wouldMove(ph, action.ref, action.pos)) return;
    const snap = snapshotRects(cards);
    placePlaceholder(board, ph, action.ref, action.pos);
    flipFrom(snap, FLIP_MS);
  }

  function onCardUp() {
    if (!drag.active) return;
    window.removeEventListener('pointermove', onCardMove);
    window.removeEventListener('pointerup', onCardUp);
    window.removeEventListener('pointercancel', onCardUp);

    const el = drag.el;
    board.insertBefore(el, drag.ph);
    drag.ph.remove();
    dropIntoPlaceholder(el, true);
    finishDrag();

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
    const dy = ev.clientY - drag.lastY;
    drag.lastX = ev.clientX;
    drag.lastY = ev.clientY;
    moveElement();

    const dragRect = draggedRect();
    const flipEls = [...document.querySelectorAll('.item:not(.dragging)')];

    // Finn hvilken items-container pekeren er over (håndterer overføring mellom kort).
    const containers = [...document.querySelectorAll('.items-container')];
    let targetCont = null;
    for (const cont of containers) {
      const r = cont.getBoundingClientRect();
      if (ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top - 12 && ev.clientY <= r.bottom + 12) {
        targetCont = cont; break;
      }
    }
    if (!targetCont) {
      for (const cont of containers) {
        const cr = cont.closest('.card').getBoundingClientRect();
        if (ev.clientX >= cr.left && ev.clientX <= cr.right && ev.clientY >= cr.top && ev.clientY <= cr.bottom) {
          targetCont = cont; break;
        }
      }
    }
    if (!targetCont) return;

    const ph = drag.ph;
    const items = [...targetCont.querySelectorAll('.item:not(.dragging)')];
    const phInCont = ph.parentNode === targetCont;

    let action = null; // {pos:'before'|'after'|'append', ref?}

    if (!phInCont) {
      // Overføring til en annen kategori: plasser etter vertikal posisjon.
      const cy = dragRect.top + dragRect.height / 2;
      let ref = null;
      for (const it of items) {
        const r = layoutRect(it);
        if (cy < r.top + r.height / 2) { ref = it; break; }
      }
      action = ref ? { ref, pos: 'before' } : { pos: 'append' };
    } else if (dy > 0) {
      let best = null, bestTop = Infinity;
      for (const it of items) {
        const r = layoutRect(it);
        if (r.top >= dragRect.top && vOverlap(dragRect, r) >= SWAP_RATIO * r.height && r.top < bestTop) {
          bestTop = r.top; best = it;
        }
      }
      if (best) action = { ref: best, pos: 'after' };
    } else if (dy < 0) {
      let best = null, bestTop = -Infinity;
      for (const it of items) {
        const r = layoutRect(it);
        if (r.top <= dragRect.top && vOverlap(dragRect, r) >= SWAP_RATIO * r.height && r.top > bestTop) {
          bestTop = r.top; best = it;
        }
      }
      if (best) action = { ref: best, pos: 'before' };
    }

    if (!action) return;
    const willMove = action.pos === 'append'
      ? targetCont.lastElementChild !== ph
      : wouldMove(ph, action.ref, action.pos);
    if (!willMove) return;

    const snap = snapshotRects(flipEls);
    if (action.pos === 'append') targetCont.appendChild(ph);
    else placePlaceholder(targetCont, ph, action.ref, action.pos);
    flipFrom(snap, FLIP_MS);
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
    dropIntoPlaceholder(el, false);
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

  /* ---------------- Papirkurv ---------------- */
  function buildTrashList() {
    const trash = activeTrash();
    trashList.innerHTML = '';
    if (!trash.length) {
      const p = document.createElement('p');
      p.className = 'trash-empty-msg';
      p.textContent = 'Papirkurven er tom.';
      trashList.appendChild(p);
      trashEmptyBtn.disabled = true;
      return;
    }
    trashEmptyBtn.disabled = false;
    trash.forEach((c) => {
      const row = document.createElement('div');
      row.className = 'trash-row';

      const dot = document.createElement('span');
      dot.className = 'trash-dot';
      dot.style.background = c.color;

      const name = document.createElement('span');
      name.className = 'trash-name';
      name.textContent = c.title;

      const n = c.items.length;
      const meta = document.createElement('span');
      meta.className = 'trash-meta';
      meta.textContent = n + ' ' + (n === 1 ? 'element' : 'elementer');

      const restore = document.createElement('button');
      restore.className = 'btn btn-small';
      restore.type = 'button';
      restore.textContent = 'Gjenopprett';
      restore.addEventListener('click', () => {
        const i = trash.findIndex((x) => x.id === c.id);
        if (i > -1) { const [rc] = trash.splice(i, 1); activeCards().push(rc); }
        buildTrashList();
        render();
      });

      row.append(dot, name, meta, restore);
      trashList.appendChild(row);
    });
  }

  function openTrash() {
    buildTrashList();
    trashModal.hidden = false;
    document.body.classList.add('modal-open');
  }
  function closeTrash() {
    trashModal.hidden = true;
    document.body.classList.remove('modal-open');
  }

  trashBtn.addEventListener('click', openTrash);
  trashClose.addEventListener('click', closeTrash);
  trashModal.addEventListener('click', (ev) => { if (ev.target === trashModal) closeTrash(); });
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && !trashModal.hidden) closeTrash();
  });

  trashEmptyBtn.addEventListener('click', () => {
    const trash = activeTrash();
    if (!trash.length) return;
    if (!confirm('Slette alt i papirkurven permanent? Dette kan ikke angres.')) return;
    trash.length = 0;
    buildTrashList();
    render();
    save();
  });

  /* ---------------- Sky-synk (Supabase, synk-kode) ----------------
     Alle enheter som skriver samme hemmelige synk-kode deler de samme
     listene. Tabellen er låst bak koden (via SECURITY DEFINER-funksjoner
     i databasen), så uten koden får man ikke tak i dataene.
     Modell: «sist lagret vinner». localStorage beholdes som offline-buffer. */
  const SYNC_CODE_KEY = 'mine-lister-sync-code';

  let sb = null;          // Supabase-klient (lazy)
  let syncCode = null;    // aktiv synk-kode, eller null
  let cloudTimer = null;
  let cloudBusy = false;
  let cloudPending = false;

  const syncBtn = document.getElementById('sync-btn');
  const syncDot = document.getElementById('sync-dot');
  const syncModal = document.getElementById('sync-modal');
  const syncClose = document.getElementById('sync-close');
  const syncForm = document.getElementById('sync-form');
  const syncCodeInput = document.getElementById('sync-code-input');
  const syncConnectBtn = document.getElementById('sync-connect-btn');
  const syncConnectEl = document.getElementById('sync-connect');
  const syncConnectedEl = document.getElementById('sync-connected');
  const syncCodeShown = document.getElementById('sync-code-shown');
  const syncDisconnectBtn = document.getElementById('sync-disconnect-btn');
  const syncStatusText = document.getElementById('sync-status-text');
  const syncConfigNote = document.getElementById('sync-config-note');

  function cloudConfigured() {
    const c = window.SUPABASE_CONFIG;
    return !!(
      c && typeof c.url === 'string' && typeof c.anonKey === 'string' &&
      c.url.indexOf('DIN_') !== 0 && c.anonKey.indexOf('DIN_') !== 0 &&
      window.supabase && typeof window.supabase.createClient === 'function'
    );
  }

  function ensureClient() {
    if (sb) return sb;
    if (!cloudConfigured()) return null;
    sb = window.supabase.createClient(window.SUPABASE_CONFIG.url, window.SUPABASE_CONFIG.anonKey);
    return sb;
  }

  // status: 'off' | 'connected' | 'saving' | 'error'
  function setSyncStatus(status, text) {
    syncDot.dataset.status = status;
    if (text) {
      syncStatusText.textContent = text;
      syncBtn.title = text;
    }
  }

  async function cloudPullCode(code) {
    const client = ensureClient();
    if (!client) return { ok: false };
    try {
      const { data, error } = await client.rpc('get_list', { p_code: code });
      if (error) return { ok: false, error };
      return { ok: true, data: data || null };
    } catch (e) {
      return { ok: false, error: e };
    }
  }

  async function cloudSaveNow() {
    const client = ensureClient();
    if (!client || !syncCode) return;
    cloudBusy = true;
    setSyncStatus('saving', 'Lagrer i skyen …');
    try {
      const { error } = await client.rpc('save_list', { p_code: syncCode, p_data: state });
      if (error) setSyncStatus('error', 'Kunne ikke lagre i skyen. Prøver igjen ved neste endring.');
      else setSyncStatus('connected', 'Tilkoblet — alt er lagret i skyen.');
    } catch (e) {
      setSyncStatus('error', 'Frakoblet — lagret lokalt. Prøver igjen senere.');
    }
    cloudBusy = false;
    if (cloudPending) { cloudPending = false; cloudPush(); }
  }

  // Kalles fra save(). Debouncet, og serialisert (én lagring om gangen).
  function cloudPush() {
    if (!syncCode || !cloudConfigured()) return;
    if (cloudBusy) { cloudPending = true; return; }
    clearTimeout(cloudTimer);
    cloudTimer = setTimeout(cloudSaveNow, 800);
  }

  // Skriv fjern-tilstand inn i det eksisterende state-objektet og tegn på nytt.
  function applyRemoteState(remote) {
    if (!remote || !remote.tabs) return;
    state.activeTab = remote.activeTab;
    state.tabs = remote.tabs;
    normalize(state);
    const ex = activeCards();
    if (ex.length) lastColor = ex[ex.length - 1].color;
    render();
  }

  function updateSyncUI() {
    const connected = !!syncCode;
    syncConnectEl.hidden = connected;
    syncConnectedEl.hidden = !connected;
    syncConfigNote.hidden = cloudConfigured();
    if (connected) syncCodeShown.textContent = syncCode;
    else syncCodeInput.value = '';
  }

  syncForm.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (!cloudConfigured()) {
      setSyncStatus('off', 'Sky-synk er ikke satt opp ennå. Fyll inn Supabase-verdiene i config.js.');
      return;
    }
    const code = syncCodeInput.value.trim();
    if (code.length < 6) {
      setSyncStatus('error', 'Velg en kode på minst 6 tegn (helst mye lengre).');
      return;
    }
    syncConnectBtn.disabled = true;
    setSyncStatus('saving', 'Kobler til …');
    const res = await cloudPullCode(code);
    if (!res.ok) {
      setSyncStatus('error', 'Kunne ikke koble til. Sjekk nettforbindelse og config.js.');
      syncConnectBtn.disabled = false;
      return;
    }
    if (res.data) {
      const ok = confirm(
        'Denne koden har allerede lister i skyen. Hente dem hit?\n\n' +
        'Listene som ligger lokalt på denne enheten blir erstattet.'
      );
      if (!ok) {
        setSyncStatus(syncCode ? 'connected' : 'off', syncCode ? 'Fortsatt tilkoblet.' : 'Avbrutt.');
        syncConnectBtn.disabled = false;
        return;
      }
      syncCode = code;
      localStorage.setItem(SYNC_CODE_KEY, code);
      applyRemoteState(res.data);
      setSyncStatus('connected', 'Tilkoblet — hentet listene fra skyen.');
    } else {
      // Ny kode uten data i skyen ennå → last opp det som ligger lokalt.
      syncCode = code;
      localStorage.setItem(SYNC_CODE_KEY, code);
      await cloudSaveNow();
      setSyncStatus('connected', 'Tilkoblet — lastet opp de lokale listene dine.');
    }
    syncConnectBtn.disabled = false;
    updateSyncUI();
  });

  syncDisconnectBtn.addEventListener('click', () => {
    syncCode = null;
    localStorage.removeItem(SYNC_CODE_KEY);
    clearTimeout(cloudTimer);
    setSyncStatus('off', 'Frakoblet. Listene lagres nå bare lokalt på denne enheten.');
    updateSyncUI();
  });

  function openSync() {
    updateSyncUI();
    if (!cloudConfigured()) {
      setSyncStatus('off', 'Sky-synk er ikke satt opp ennå. Fyll inn Supabase-verdiene i config.js.');
    } else if (syncCode) {
      setSyncStatus('connected', 'Tilkoblet med synk-koden din.');
    } else {
      setSyncStatus('off', 'Ikke tilkoblet. Skriv en synk-kode for å dele listene mellom enheter.');
    }
    syncModal.hidden = false;
    document.body.classList.add('modal-open');
  }
  function closeSync() {
    syncModal.hidden = true;
    document.body.classList.remove('modal-open');
  }

  syncBtn.addEventListener('click', openSync);
  syncClose.addEventListener('click', closeSync);
  syncModal.addEventListener('click', (ev) => { if (ev.target === syncModal) closeSync(); });
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && !syncModal.hidden) closeSync();
  });

  // Ved oppstart: har vi en lagret kode, hentes skyens versjon (skyen vinner).
  async function syncInit() {
    const savedCode = localStorage.getItem(SYNC_CODE_KEY);
    if (!cloudConfigured() || !savedCode) {
      setSyncStatus('off');
      return;
    }
    syncCode = savedCode;
    setSyncStatus('saving', 'Henter listene fra skyen …');
    const res = await cloudPullCode(savedCode);
    if (!res.ok) {
      setSyncStatus('error', 'Frakoblet — bruker lokale lister. Synker ved neste endring.');
      return;
    }
    if (res.data) {
      applyRemoteState(res.data);
      setSyncStatus('connected', 'Synket fra skyen.');
    } else {
      await cloudSaveNow();
      setSyncStatus('connected', 'Tilkoblet.');
    }
  }

  /* ---------------- Start ---------------- */
  // Sett en fornuftig lastColor så nye kort varierer
  const existing = activeCards();
  if (existing.length) lastColor = existing[existing.length - 1].color;
  render();
  syncInit();

  // Eksponer for enkel feilsøking/testing
  window.__mineLister = { state, render };
})();
