/* ============================================================
   Huskis — hermetisk mock-backend (KUN for testing, ?mock=1)
   ------------------------------------------------------------
   Etterligner den delmengden av Supabase-klienten appen bruker
   (auth, from().insert/update/delete, rpc, channel), med en
   «database» delt mellom faner via localStorage. Realtime
   simuleres med `storage`-hendelser. Sesjonen er PER FANE
   (sessionStorage), så to faner = to innloggede brukere.

   Fidelitet: nok til å kjøre delingsflyten (invitasjon → aksept →
   mount), server-side felt-LWW, lås, forlat/utkast, og get_my_doc-
   synligheten. IKKE en full RLS-implementasjon.
   ============================================================ */
(function () {
  'use strict';
  var DB_KEY = 'hk-mock-db';
  var PING_KEY = 'hk-mock-ping';

  // Kunstig «server»-forsinkelse (ms) på alle RPC-/tabell-kall: ?mock=1&lag=800.
  // Brukes i tester for å bevise at UI-et er umiddelbart og operasjonskøen
  // serialiserer riktig selv når operasjonene er trege. 0 (av) uten parameter.
  var LAG = (function () {
    var m = /[?&]lag=(\d+)/.exec(location.search);
    return m ? Math.min(parseInt(m[1], 10) || 0, 10000) : 0;
  })();
  // Utfør et «server»-kall: run() kjøres ETTER forsinkelsen (som om forespørselen
  // var underveis), og resultatet leveres asynkront. Kastede feil → { error }.
  function serverCall(run) {
    function attempt() {
      try { return run(); } catch (e) { return { data: null, error: { message: e.message } }; }
    }
    if (!LAG) return Promise.resolve(attempt());
    return new Promise(function (resolve) {
      setTimeout(function () { resolve(attempt()); }, LAG);
    });
  }

  function loadDB() {
    try {
      var raw = localStorage.getItem(DB_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    return {
      profiles: [], passwords: {},
      universes: [], groups: [], cards: [], items: [],
      memberships: [], share_invites: [], tombstones: [],
    };
  }
  function saveDB(db) {
    localStorage.setItem(DB_KEY, JSON.stringify(db));
    localStorage.setItem(PING_KEY, String(Math.random()) + ':' + (window.__pingc = (window.__pingc || 0) + 1));
  }
  function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }

  function hash(str) {
    var h = 0; str = String(str);
    for (var i = 0; i < str.length; i++) h = (Math.imul(h, 31) + str.charCodeAt(i)) >>> 0;
    return h.toString(16);
  }
  function uidFor(email) { return 'u-' + hash('user:' + String(email).toLowerCase()); }
  function newId(pfx) { return (pfx || 'id') + '-' + Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6); }
  function legacyId(uid, old) { return 'imp-' + hash(uid + ':' + old); }

  function regNewer(aTs, aOrg, bTs, bOrg) {
    aTs = aTs || 0; bTs = bTs || 0;
    if (aTs !== bTs) return aTs > bTs;
    return String(aOrg || '') > String(bOrg || '');
  }

  /* ---------------- Sesjon (per fane) ---------------- */
  var SESS_KEY = 'hk-mock-session';
  function getSess() {
    try { return JSON.parse(sessionStorage.getItem(SESS_KEY) || 'null'); } catch (e) { return null; }
  }
  function setSess(user) {
    if (user) sessionStorage.setItem(SESS_KEY, JSON.stringify(user));
    else sessionStorage.removeItem(SESS_KEY);
  }

  /* ---------------- Tilgangshjelpere (get_my_doc) ---------------- */
  function membershipFor(db, uid, type, id) {
    return db.memberships.find(function (m) {
      return m.user_id === uid &&
        ((type === 'universe' && m.universe_id === id) ||
         (type === 'group' && m.group_id === id) ||
         (type === 'card' && m.card_id === id));
    }) || null;
  }
  function canReadUniverse(db, id, uid) {
    var u = db.universes.find(function (x) { return x.id === id; });
    if (!u) return false;
    return u.owner_id === uid || !!membershipFor(db, uid, 'universe', id);
  }
  function canReadGroup(db, id, uid) {
    var g = db.groups.find(function (x) { return x.id === id; });
    if (!g) return false;
    return g.owner_id === uid || !!membershipFor(db, uid, 'group', id) || canReadUniverse(db, g.universe_id, uid);
  }
  function canReadCard(db, id, uid) {
    var c = db.cards.find(function (x) { return x.id === id; });
    if (!c) return false;
    return c.owner_id === uid || !!membershipFor(db, uid, 'card', id) || canReadGroup(db, c.group_id, uid);
  }
  function lockedAncestor(db, obj, type, uid) {
    // Redigering blokkeres hvis nærmeste nivå (objektet selv eller en forelder)
    // med eksplisitt lås-tilstand satt av en ANNEN er låst. Et unntak (unlocked)
    // åpner grenen igjen. Nærmeste-først: objektet, så oppover.
    var chain = [];
    if (type === 'universe') { chain = [obj]; }
    else if (type === 'group') {
      chain = [obj, db.universes.find(function (x) { return x.id === obj.universe_id; })];
    } else { // card
      var g = db.groups.find(function (x) { return x.id === obj.group_id; });
      var u = g && db.universes.find(function (x) { return x.id === g.universe_id; });
      chain = [obj, g, u];
    }
    for (var i = 0; i < chain.length; i++) {
      var n = chain[i];
      if (!n || n.owner_id === uid) continue; // egne låser/unntak blokkerer ikke meg selv
      if (n.unlocked) return false;
      if (n.locked) return true;
    }
    return false;
  }
  function ownerOf(db, type, id) {
    var t = type === 'universe' ? db.universes : type === 'group' ? db.groups : db.cards;
    var r = t.find(function (x) { return x.id === id; });
    return r ? r.owner_id : null;
  }
  function emailOf(db, uid) {
    var p = db.profiles.find(function (x) { return x.id === uid; });
    return p ? p.email : null;
  }
  function nameOf(db, uid) {
    var p = db.profiles.find(function (x) { return x.id === uid; });
    return p ? (p.display_name || null) : null;
  }

  /* ---- Hierarkisk rettighetsmodell (speiler users-and-sharing.sql) ---- */
  function findU(db, id) { return db.universes.find(function (x) { return x.id === id; }) || null; }
  function findG(db, id) { return db.groups.find(function (x) { return x.id === id; }) || null; }
  function findC(db, id) { return db.cards.find(function (x) { return x.id === id; }) || null; }
  function findI(db, id) { return db.items.find(function (x) { return x.id === id; }) || null; }

  // Universets eier (owner_id på rot-universet) for et objekt av enhver type.
  function universeOwnerOf(db, type, id) {
    var u = null, g, c, i;
    if (type === 'universe') u = findU(db, id);
    else if (type === 'group') { g = findG(db, id); u = g && findU(db, g.universe_id); }
    else if (type === 'card') { c = findC(db, id); g = c && findG(db, c.group_id); u = g && findU(db, g.universe_id); }
    else if (type === 'item') { i = findI(db, id); c = i && findC(db, i.card_id); g = c && findG(db, c.group_id); u = g && findU(db, g.universe_id); }
    return u ? u.owner_id : null;
  }
  // Privilegert administrator: eier objektet ELLER et hvilket som helst superobjekt.
  function canAdminResource(db, type, id, uid) {
    var u, g, c, i;
    if (type === 'universe') { u = findU(db, id); return !!u && u.owner_id === uid; }
    if (type === 'group') { g = findG(db, id); if (!g) return false; u = findU(db, g.universe_id); return g.owner_id === uid || !!(u && u.owner_id === uid); }
    if (type === 'card') { c = findC(db, id); if (!c) return false; g = findG(db, c.group_id); u = g && findU(db, g.universe_id); return c.owner_id === uid || !!(g && g.owner_id === uid) || !!(u && u.owner_id === uid); }
    if (type === 'item') { i = findI(db, id); if (!i) return false; c = findC(db, i.card_id); g = c && findG(db, c.group_id); u = g && findU(db, g.universe_id); return i.owner_id === uid || !!(c && c.owner_id === uid) || !!(g && g.owner_id === uid) || !!(u && u.owner_id === uid); }
    return false;
  }
  // Ordnet kjede nærmeste-først [liste?, gruppe?, univers?] (item → sin listes kjede).
  function lockChain(db, type, id) {
    var vCard = null, vGroup = null, vUniverse = null, r, chain = [];
    if (type === 'item') { r = findI(db, id); vCard = r ? r.card_id : null; }
    else if (type === 'card') vCard = id;
    else if (type === 'group') vGroup = id;
    else if (type === 'universe') vUniverse = id;
    if (vCard) { r = findC(db, vCard); vGroup = r ? r.group_id : null; }
    if (vGroup) { r = findG(db, vGroup); vUniverse = r ? r.universe_id : null; }
    if (vCard) { r = findC(db, vCard); if (r) chain.push({ type: 'card', row: r }); }
    if (vGroup) { r = findG(db, vGroup); if (r) chain.push({ type: 'group', row: r }); }
    if (vUniverse) { r = findU(db, vUniverse); if (r) chain.push({ type: 'universe', row: r }); }
    return chain;
  }
  function effectiveLockSource(db, type, id) {
    var chain = lockChain(db, type, id);
    for (var k = 0; k < chain.length; k++) {
      var n = chain[k].row;
      if (n.locked || n.unlocked) return { type: chain[k].type, id: n.id, isLocked: !!n.locked, creator: n.owner_id };
    }
    return null;
  }
  function isEffectivelyLocked(db, type, id) { var s = effectiveLockSource(db, type, id); return !!(s && s.isLocked); }
  function inheritedLockSource(db, type, id) {
    var pt = null, pid = null, r;
    if (type === 'card') { pt = 'group'; r = findC(db, id); pid = r ? r.group_id : null; }
    else if (type === 'group') { pt = 'universe'; r = findG(db, id); pid = r ? r.universe_id : null; }
    else if (type === 'item') { pt = 'card'; r = findI(db, id); pid = r ? r.card_id : null; }
    else return null;
    return pid ? effectiveLockSource(db, pt, pid) : null;
  }
  function canManageLockException(db, type, id, uid) {
    if (universeOwnerOf(db, type, id) === uid) return true;
    var s = inheritedLockSource(db, type, id);
    return !!(s && s.isLocked && s.creator === uid);
  }
  function canReadAny(db, type, id, uid) {
    if (type === 'universe') return canReadUniverse(db, id, uid);
    if (type === 'group') return canReadGroup(db, id, uid);
    if (type === 'card') return canReadCard(db, id, uid);
    if (type === 'item') { var i = findI(db, id); return !!i && canReadCard(db, i.card_id, uid); }
    return false;
  }
  function canEditContent(db, type, id, uid) {
    return canReadAny(db, type, id, uid) && (canAdminResource(db, type, id, uid) || !isEffectivelyLocked(db, type, id));
  }
  // Posisjon styres av superobjektets innhold (skilt fra objektets innholdslås).
  function canReorderInParent(db, type, id, uid) {
    var r;
    if (type === 'universe') { r = findU(db, id); return !!r && r.owner_id === uid; }
    if (type === 'group') { r = findG(db, id); return !!r && canEditContent(db, 'universe', r.universe_id, uid); }
    if (type === 'card') { r = findC(db, id); return !!r && canEditContent(db, 'group', r.group_id, uid); }
    if (type === 'item') { r = findI(db, id); return !!r && canEditContent(db, 'card', r.card_id, uid); }
    return false;
  }
  // Invitasjonspolicy (tretilstand med dynamisk arv).
  function inviteChain(db, type, id) {
    var vCard = null, vGroup = null, vUniverse = null, r, chain = [];
    if (type === 'card') vCard = id; else if (type === 'group') vGroup = id;
    else if (type === 'universe') vUniverse = id; else return [];
    if (vCard) { r = findC(db, vCard); vGroup = r ? r.group_id : null; }
    if (vGroup) { r = findG(db, vGroup); vUniverse = r ? r.universe_id : null; }
    if (vCard) { r = findC(db, vCard); if (r) chain.push({ row: r }); }
    if (vGroup) { r = findG(db, vGroup); if (r) chain.push({ row: r }); }
    if (vUniverse) { r = findU(db, vUniverse); if (r) chain.push({ row: r }); }
    return chain;
  }
  function effectiveInviteSource(db, type, id) {
    var chain = inviteChain(db, type, id);
    for (var k = 0; k < chain.length; k++) {
      var pol = chain[k].row.invite_policy;
      if (pol === 'allow' || pol === 'deny') return { pol: pol, creator: chain[k].row.owner_id };
    }
    return null;
  }
  function effectiveInvitePolicy(db, type, id) { var s = effectiveInviteSource(db, type, id); return s ? s.pol === 'allow' : true; }
  function inheritedInviteSource(db, type, id) {
    var pt = null, pid = null, r;
    if (type === 'card') { pt = 'group'; r = findC(db, id); pid = r ? r.group_id : null; }
    else if (type === 'group') { pt = 'universe'; r = findG(db, id); pid = r ? r.universe_id : null; }
    else return null;
    return pid ? effectiveInviteSource(db, pt, pid) : null;
  }
  function canInviteTo(db, type, id, uid) {
    return canAdminResource(db, type, id, uid) || (canReadAny(db, type, id, uid) && effectiveInvitePolicy(db, type, id));
  }
  function canManageInvitePolicy(db, type, id, uid) {
    var s = inheritedInviteSource(db, type, id);
    if (s && s.pol === 'deny') return universeOwnerOf(db, type, id) === uid || s.creator === uid;
    return canAdminResource(db, type, id, uid);
  }

  function getMyDoc(db, uid) {
    var myUni = db.universes.filter(function (u) {
      return u.owner_id === uid || membershipFor(db, uid, 'universe', u.id);
    });
    var myUniIds = {}; myUni.forEach(function (u) { myUniIds[u.id] = 1; });
    var myGroups = db.groups.filter(function (g) {
      return g.owner_id === uid || membershipFor(db, uid, 'group', g.id) || myUniIds[g.universe_id];
    });
    var myGroupIds = {}; myGroups.forEach(function (g) { myGroupIds[g.id] = 1; });
    var myCards = db.cards.filter(function (c) {
      return c.owner_id === uid || membershipFor(db, uid, 'card', c.id) || myGroupIds[c.group_id];
    });
    var myCardIds = {}; myCards.forEach(function (c) { myCardIds[c.id] = 1; });
    var myItems = db.items.filter(function (i) { return myCardIds[i.card_id]; });

    function mountObj(m, withParent) {
      if (!m) return null;
      var o = { pos: m.pos, trashed: !!m.trashed };
      // Gruppe-mount forelder = parent_universe_id; liste-mount = parent_group_id.
      if (withParent) o.parent = m.group_id ? m.parent_universe_id : m.parent_group_id;
      return o;
    }
    var sharedU = {}, sharedG = {}, sharedC = {};
    db.memberships.forEach(function (m) {
      if (m.universe_id) sharedU[m.universe_id] = 1;
      if (m.group_id) sharedG[m.group_id] = 1;
      if (m.card_id) sharedC[m.card_id] = 1;
    });

    var email = emailOf(db, uid);
    var selfProf = db.profiles.find(function (x) { return x.id === uid; }) || {};
    return {
      user: { id: uid, email: email, display_name: selfProf.display_name || (email || '').split('@')[0] },
      universes: myUni.map(function (u) {
        var m = membershipFor(db, uid, 'universe', u.id);
        return {
          id: u.id, owner: u.owner_id, mine: u.owner_id === uid, name: u.name,
          trashed: !!u.trashed, locked: !!u.locked, unlocked: !!u.unlocked,
          invitePolicy: u.invite_policy || 'inherit', ts: u.ts, org: u.org,
          pos: u.pos, posTs: u.pos_ts, posOrg: u.pos_org,
          shared: !!sharedU[u.id], mount: mountObj(m, false),
        };
      }),
      groups: myGroups.map(function (g) {
        var m = membershipFor(db, uid, 'group', g.id);
        return {
          id: g.id, owner: g.owner_id, mine: g.owner_id === uid, uni: g.universe_id, name: g.name,
          trashed: !!g.trashed, locked: !!g.locked, unlocked: !!g.unlocked,
          invitePolicy: g.invite_policy || 'inherit', ts: g.ts, org: g.org,
          pos: g.pos, posTs: g.pos_ts, posOrg: g.pos_org,
          shared: !!sharedG[g.id], mount: mountObj(m, true),
        };
      }),
      cards: myCards.map(function (c) {
        var m = membershipFor(db, uid, 'card', c.id);
        return {
          id: c.id, owner: c.owner_id, mine: c.owner_id === uid, group: c.group_id, title: c.title,
          trashed: !!c.trashed, locked: !!c.locked, unlocked: !!c.unlocked,
          invitePolicy: c.invite_policy || 'inherit', k: c.k !== false, p: c.p !== false,
          responsible: c.responsible || null,
          start: c.start_at || null, due: c.due_at || null, lockTimes: !!c.lock_times,
          collapsed: !!c.collapsed,
          labTs: c.lab_ts, labOrg: c.lab_org, ts: c.ts, org: c.org,
          pos: c.pos, posTs: c.pos_ts, posOrg: c.pos_org,
          shared: !!sharedC[c.id], mount: mountObj(m, true),
        };
      }),
      items: myItems.map(function (i) {
        return {
          id: i.id, owner: i.owner_id, mine: i.owner_id === uid, home: i.card_id, text: i.text,
          cat: i.cat_id || null, isCat: !!i.is_cat, lockTimes: !!i.lock_times,
          trashed: !!i.trashed, done: !!i.done, responsible: i.responsible || null,
          start: i.start_at || null, due: i.due_at || null,
          ts: i.ts, org: i.org, pos: i.pos, posTs: i.pos_ts, posOrg: i.pos_org,
        };
      }),
      invites_in: db.share_invites.filter(function (s) {
        return s.status === 'pending' && (s.invitee_id === uid ||
          (email && String(s.invitee_email).toLowerCase() === email.toLowerCase()));
      }).map(function (s) {
        var type = s.universe_id ? 'universe' : s.group_id ? 'group' : 'card';
        var name = s.universe_id ? (db.universes.find(function (x) { return x.id === s.universe_id; }) || {}).name :
                   s.group_id ? (db.groups.find(function (x) { return x.id === s.group_id; }) || {}).name :
                   (db.cards.find(function (x) { return x.id === s.card_id; }) || {}).title;
        return { id: s.id, type: type, name: name, from: emailOf(db, s.inviter_id),
                 from_name: nameOf(db, s.inviter_id), created_at: s.created_at };
      }),
      invites_out: db.share_invites.filter(function (s) {
        return s.status === 'pending' && s.inviter_id === uid;
      }).map(function (s) {
        var type = s.universe_id ? 'universe' : s.group_id ? 'group' : 'card';
        return { id: s.id, type: type, target_id: s.universe_id || s.group_id || s.card_id,
                 email: s.invitee_email, created_at: s.created_at };
      }),
    };
  }

  /* ---------------- Tabell-CRUD (med server-side LWW + vakter) ---------------- */
  var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  function applyInsert(db, table, uid, payload) {
    var rows = Array.isArray(payload) ? payload : [payload];
    // Objekt-tabellene har uuid-kolonner (som ekte Postgres): avvis ugyldige
    // id-er slik at klienten faktisk må generere UUID-er (fanger P1-regresjon).
    var OBJ = { universes: 1, groups: 1, cards: 1, items: 1 };
    if (OBJ[table]) {
      for (var i = 0; i < rows.length; i++) {
        if (!UUID_RE.test(String(rows[i].id || ''))) {
          throw new Error('invalid input syntax for type uuid: "' + rows[i].id + '"');
        }
      }
    }
    rows.forEach(function (r) {
      var row = clone(r);
      if (table !== 'memberships') row.owner_id = uid;
      // Opprettelse av subobjekt krever redigeringstilgang i forelderen (speiler
      // *_insert-policyene): et vanlig medlem kan ikke opprette i en låst gren.
      if (table === 'groups' && findU(db, row.universe_id) && !canEditContent(db, 'universe', row.universe_id, uid))
        throw new Error('mangler tilgang til universet');
      if (table === 'cards' && findG(db, row.group_id) && !canEditContent(db, 'group', row.group_id, uid))
        throw new Error('mangler tilgang til gruppen');
      if (table === 'items' && findC(db, row.card_id) && !canEditContent(db, 'card', row.card_id, uid))
        throw new Error('mangler tilgang til listen');
      // Nye objekter arver invitasjonspolicy dynamisk → lagres som 'inherit'.
      if (table !== 'memberships' && table !== 'items' && !row.invite_policy) row.invite_policy = 'inherit';
      db[table].push(row);
    });
  }
  function applyUpdate(db, table, uid, patch, filters) {
    var list = db[table];
    list.forEach(function (row) {
      for (var k in filters) if (row[k] !== filters[k]) return;
      if (table === 'profiles') {
        // Som RLS-policyen: kun egen rad, og kun display_name kan endres
        // (e-post går via auth.updateUser).
        if (row.id !== uid) return;
        if ('display_name' in patch) row.display_name = patch.display_name;
        return;
      }
      if (table === 'memberships') {
        if (row.user_id !== uid) return;
        ['pos', 'trashed', 'parent_universe_id', 'parent_group_id'].forEach(function (f) {
          if (f in patch) row[f] = patch[f];
        });
        return;
      }
      // objekt-tabeller: feltnivå-autorisasjon + felt-LWW (speiler *_before_update).
      var isOwner = row.owner_id === uid;
      var direct = table === 'universes' ? membershipFor(db, uid, 'universe', row.id)
                 : table === 'groups' ? membershipFor(db, uid, 'group', row.id)
                 : table === 'cards' ? membershipFor(db, uid, 'card', row.id) : null;
      var type = table === 'universes' ? 'universe' : table === 'groups' ? 'group' : table === 'cards' ? 'card' : 'item';
      var canContent = canEditContent(db, type, row.id, uid);
      var canReorder = canReorderInParent(db, type, row.id, uid);
      // Oppretter (owner_id) er uforanderlig.
      if ('owner_id' in patch && patch.owner_id !== row.owner_id) throw new Error('owner_id (oppretter) kan ikke endres');
      // Priviligerte kolonner — endres kun av rett autoritet (ellers avvist).
      if ('locked' in patch && patch.locked !== row.locked && !canAdminResource(db, type, row.id, uid)) throw new Error('mangler myndighet til å låse/åpne');
      if ('unlocked' in patch && patch.unlocked !== row.unlocked && !canManageLockException(db, type, row.id, uid)) throw new Error('mangler myndighet til å endre unntak');
      if ('invite_policy' in patch && patch.invite_policy !== row.invite_policy && !canManageInvitePolicy(db, type, row.id, uid)) throw new Error('mangler myndighet til å endre invitasjonspolicy');
      // Flytting til ny forelder: rettigheter i BÅDE kilde og mål.
      var pcol = type === 'group' ? 'universe_id' : type === 'card' ? 'group_id' : type === 'item' ? 'card_id' : null;
      var ptype = type === 'group' ? 'universe' : type === 'card' ? 'group' : type === 'item' ? 'card' : null;
      if (pcol && pcol in patch && patch[pcol] !== row[pcol]) {
        if (!isOwner && direct) throw new Error('delte objekter flyttes via egen plassering (mount)');
        if (!canEditContent(db, ptype, row[pcol], uid)) throw new Error('mangler tilgang til kilde-' + ptype);
        if (!canEditContent(db, ptype, patch[pcol], uid)) throw new Error('mangler tilgang til mål-' + ptype);
      }
      // trashed-vakt: mottaker med direkte medlemskap kan ikke endre trashed på share-roten
      var blockTrashed = (!isOwner && direct && (type === 'universe' || type === 'group' || type === 'card'));
      // content-register: kun ved can_edit_content OG nyere register.
      if (canContent && regNewer(patch.ts, patch.org, row.ts, row.org)) {
        if ('name' in patch) row.name = patch.name;
        if ('title' in patch) row.title = patch.title;
        if ('text' in patch) row.text = patch.text;
        if ('done' in patch) row.done = patch.done;
        if ('responsible' in patch) row.responsible = patch.responsible;
        if ('start_at' in patch) row.start_at = patch.start_at;
        if ('due_at' in patch) row.due_at = patch.due_at;
        if ('lock_times' in patch) row.lock_times = patch.lock_times;
        if ('collapsed' in patch) row.collapsed = patch.collapsed;
        if ('is_cat' in patch) row.is_cat = patch.is_cat;
        if ('trashed' in patch && !blockTrashed) row.trashed = patch.trashed;
        row.ts = patch.ts; row.org = patch.org;
      }
      // label-register (cards): også innhold → can_edit_content.
      if (table === 'cards' && canContent && regNewer(patch.lab_ts, patch.lab_org, row.lab_ts, row.lab_org)) {
        if ('k' in patch) row.k = patch.k;
        if ('p' in patch) row.p = patch.p;
        row.lab_ts = patch.lab_ts; row.lab_org = patch.lab_org;
      }
      // pos-register (+ forelder følger posisjon): kun ved can_reorder OG nyere.
      if (canReorder && regNewer(patch.pos_ts, patch.pos_org, row.pos_ts, row.pos_org)) {
        if ('pos' in patch) row.pos = patch.pos;
        if ('universe_id' in patch) row.universe_id = patch.universe_id;
        if ('group_id' in patch) row.group_id = patch.group_id;
        if ('card_id' in patch) row.card_id = patch.card_id;
        if ('cat_id' in patch) row.cat_id = patch.cat_id;
        row.pos_ts = patch.pos_ts; row.pos_org = patch.pos_org;
      }
    });
  }
  function applyDelete(db, table, uid, filters) {
    var type = table === 'universes' ? 'universe' : table === 'groups' ? 'group' : table === 'cards' ? 'card' : 'item';
    db[table] = db[table].filter(function (row) {
      for (var k in filters) if (row[k] !== filters[k]) return true;
      var isOwner = row.owner_id === uid;
      // Vakter: universe kun eier; group/card eier ELLER (kan-redigere UTEN direkte medlemskap).
      var direct = type === 'universe' ? membershipFor(db, uid, 'universe', row.id)
                 : type === 'group' ? membershipFor(db, uid, 'group', row.id)
                 : type === 'card' ? membershipFor(db, uid, 'card', row.id) : null;
      var allowed;
      if (type === 'universe') allowed = isOwner;                       // kun eier hardsletter
      else if (type === 'item') allowed = isOwner || canEditContent(db, 'item', row.id, uid);
      else allowed = isOwner || (!direct && canEditContent(db, type, row.id, uid));  // felles tømming, ikke share-rot
      if (!allowed) return true; // behold (blokkert)
      // gravstein + kaskade
      db.tombstones.push({ resource_type: type, resource_id: row.id, ts: Date.now() });
      cascadeDelete(db, type, row.id);
      return false;
    });
  }
  function cascadeDelete(db, type, id) {
    if (type === 'universe') {
      db.groups.filter(function (g) { return g.universe_id === id; }).forEach(function (g) { cascadeDelete(db, 'group', g.id); });
      db.groups = db.groups.filter(function (g) { return g.universe_id !== id; });
    } else if (type === 'group') {
      db.cards.filter(function (c) { return c.group_id === id; }).forEach(function (c) { cascadeDelete(db, 'card', c.id); });
      db.cards = db.cards.filter(function (c) { return c.group_id !== id; });
    } else if (type === 'card') {
      db.items = db.items.filter(function (i) { return i.card_id !== id; });
    }
    db.memberships = db.memberships.filter(function (m) {
      return !((type === 'universe' && m.universe_id === id) ||
               (type === 'group' && m.group_id === id) ||
               (type === 'card' && m.card_id === id));
    });
  }

  /* ---------------- RPC-er ---------------- */
  function rpcHandlers(db, uid) {
    return {
      get_my_doc: function () { return getMyDoc(db, uid); },
      import_doc: function (p) {
        var doc = p.p_doc || {};
        function up(list, table, mapRow) {
          (list || []).forEach(function (r) {
            var id = legacyId(uid, r.id);
            var existing = db[table].find(function (x) { return x.id === id && x.owner_id === uid; });
            var row = mapRow(r, id);
            if (existing) Object.assign(existing, row);
            else db[table].push(row);
          });
        }
        up(doc.universes, 'universes', function (r, id) {
          return { id: id, owner_id: uid, name: r.name || '', trashed: !!r.trashed, locked: false, invite_policy: 'inherit',
            ts: r.ts || 0, org: r.org || '', pos: r.pos || 0, pos_ts: r.posTs || 0, pos_org: r.posOrg || '' };
        });
        up(doc.groups, 'groups', function (r, id) {
          return { id: id, owner_id: uid, universe_id: legacyId(uid, r.uni), name: r.name || '', trashed: !!r.trashed,
            locked: false, invite_policy: 'inherit', ts: r.ts || 0, org: r.org || '', pos: r.pos || 0, pos_ts: r.posTs || 0, pos_org: r.posOrg || '' };
        });
        up(doc.cards, 'cards', function (r, id) {
          return { id: id, owner_id: uid, group_id: legacyId(uid, r.group), title: r.title || '', trashed: !!r.trashed,
            locked: false, invite_policy: 'inherit', k: r.k !== false, p: r.p !== false, lab_ts: r.labTs || 0, lab_org: r.labOrg || '',
            responsible: r.responsible || null,
            start_at: r.start || null, due_at: r.due || null, lock_times: !!r.lockTimes,
            collapsed: !!r.collapsed,
            ts: r.ts || 0, org: r.org || '', pos: r.pos || 0, pos_ts: r.posTs || 0, pos_org: r.posOrg || '' };
        });
        up(doc.items, 'items', function (r, id) {
          return { id: id, owner_id: uid, card_id: legacyId(uid, r.home),
            cat_id: r.cat ? legacyId(uid, r.cat) : null, is_cat: !!r.isCat, lock_times: !!r.lockTimes,
            text: r.text || '', trashed: !!r.trashed,
            done: !!r.done, responsible: r.responsible || null,
            start_at: r.start || null, due_at: r.due || null,
            ts: r.ts || 0, org: r.org || '', pos: r.pos || 0, pos_ts: r.posTs || 0, pos_org: r.posOrg || '' };
        });
        return { universes: (doc.universes || []).length, groups: (doc.groups || []).length,
                 cards: (doc.cards || []).length, items: (doc.items || []).length };
      },
      create_share_invite: function (p) {
        if (!canInviteTo(db, p.p_type, p.p_id, uid)) throw new Error('mangler myndighet til å invitere til dette objektet');
        var em = String(p.p_email).toLowerCase().trim();
        if (em === '' || em.indexOf('@') < 0) throw new Error('ugyldig e-postadresse');
        if (em === emailOf(db, uid)) throw new Error('kan ikke dele med deg selv');
        var target = (db.profiles.find(function (x) { return x.email === em; }) || {}).id || null;
        // Avvis redundant invitasjon: mottakeren har allerede EFFEKTIV tilgang (også arvet).
        if (target && canReadAny(db, p.p_type, p.p_id, target)) throw new Error('brukeren har allerede tilgang');
        var dup = db.share_invites.find(function (s) {
          return s.status === 'pending' && String(s.invitee_email).toLowerCase() === em &&
            s[p.p_type === 'universe' ? 'universe_id' : p.p_type === 'group' ? 'group_id' : 'card_id'] === p.p_id;
        });
        if (dup) throw new Error('det finnes allerede en ventende invitasjon til ' + em);
        var inv = { id: newId('inv'), inviter_id: uid, invitee_email: em, invitee_id: target,
          universe_id: p.p_type === 'universe' ? p.p_id : null,
          group_id: p.p_type === 'group' ? p.p_id : null,
          card_id: p.p_type === 'card' ? p.p_id : null,
          status: 'pending', created_at: Date.now() };
        db.share_invites.push(inv);
        return inv;
      },
      accept_share_invite: function (p) {
        var inv = db.share_invites.find(function (s) { return s.id === p.p_invite; });
        if (!inv || inv.status !== 'pending') throw new Error('invitasjonen er ikke lenger åpen');
        var m = { id: newId('mem'), user_id: uid, universe_id: inv.universe_id, group_id: inv.group_id,
          card_id: inv.card_id, parent_universe_id: null, parent_group_id: null, pos: p.p_pos || 0, trashed: false };
        if (inv.group_id) m.parent_universe_id = p.p_parent;
        if (inv.card_id) m.parent_group_id = p.p_parent;
        // dedupe
        db.memberships = db.memberships.filter(function (x) {
          return !(x.user_id === uid && x.universe_id === inv.universe_id && x.group_id === inv.group_id && x.card_id === inv.card_id);
        });
        db.memberships.push(m);
        inv.status = 'accepted'; inv.invitee_id = uid;
        return m;
      },
      decline_share_invite: function (p) {
        var inv = db.share_invites.find(function (s) { return s.id === p.p_invite; });
        if (inv) { inv.status = 'declined'; inv.invitee_id = uid; }
        return null;
      },
      revoke_share_invite: function (p) {
        var inv = db.share_invites.find(function (s) { return s.id === p.p_invite && s.status === 'pending'; });
        if (!inv) throw new Error('fant ingen ventende invitasjon');
        var it = inv.universe_id ? 'universe' : inv.group_id ? 'group' : 'card';
        var iid = inv.universe_id || inv.group_id || inv.card_id;
        // Egen invitasjon ELLER en administrator på objektet.
        if (inv.inviter_id !== uid && !canAdminResource(db, it, iid, uid))
          throw new Error('mangler myndighet til å trekke tilbake denne invitasjonen');
        inv.status = 'revoked';
        return null;
      },
      revoke_share: function (p) {
        if (!canAdminResource(db, p.p_type, p.p_id, uid)) throw new Error('mangler myndighet til å kaste ut andre');
        db.memberships = db.memberships.filter(function (m) {
          return !(m.user_id === p.p_user &&
            m[p.p_type === 'universe' ? 'universe_id' : p.p_type === 'group' ? 'group_id' : 'card_id'] === p.p_id);
        });
        db.share_invites.forEach(function (s) {
          if (s.status === 'pending' && s[p.p_type === 'universe' ? 'universe_id' : p.p_type === 'group' ? 'group_id' : 'card_id'] === p.p_id &&
              (s.invitee_id === p.p_user)) s.status = 'revoked';
        });
        return null;
      },
      leave_share: function (p) {
        var before = db.memberships.length;
        db.memberships = db.memberships.filter(function (m) {
          return !(m.user_id === uid &&
            m[p.p_type === 'universe' ? 'universe_id' : p.p_type === 'group' ? 'group_id' : 'card_id'] === p.p_id);
        });
        if (db.memberships.length === before) throw new Error('du er ikke medlem av dette objektet');
        return null;
      },
      set_locked: function (p) {
        if (!canAdminResource(db, p.p_type, p.p_id, uid)) throw new Error('mangler myndighet til å låse/åpne');
        var t = p.p_type === 'universe' ? db.universes : p.p_type === 'group' ? db.groups : db.cards;
        var r = t.find(function (x) { return x.id === p.p_id; });
        // locked og unlocked er gjensidig utelukkende: å låse fjerner et ev. unntak.
        if (r) { r.locked = p.p_locked; if (p.p_locked) r.unlocked = false; }
        return null;
      },
      set_unlocked: function (p) {
        // Unntak fra en ARVET lås: kun universets eier ELLER oppretteren av det
        // nærmeste superobjektet som innfører låsen (can_manage_lock_exception).
        if (!canManageLockException(db, p.p_type, p.p_id, uid)) throw new Error('mangler myndighet til å endre unntak');
        var t = p.p_type === 'universe' ? db.universes : p.p_type === 'group' ? db.groups : db.cards;
        var r = t.find(function (x) { return x.id === p.p_id; });
        if (r) { r.unlocked = p.p_unlocked; if (p.p_unlocked) r.locked = false; }
        return null;
      },
      set_invite_policy: function (p) {
        if (['inherit', 'allow', 'deny'].indexOf(p.p_policy) < 0) throw new Error('ugyldig policy');
        if (!canManageInvitePolicy(db, p.p_type, p.p_id, uid)) throw new Error('mangler myndighet til å endre invitasjonspolicy');
        var t = p.p_type === 'universe' ? db.universes : p.p_type === 'group' ? db.groups : db.cards;
        var r = t.find(function (x) { return x.id === p.p_id; });
        if (r) r.invite_policy = p.p_policy;
        return null;
      },
      get_members: function (p) {
        if (!canReadAny(db, p.p_type, p.p_id, uid)) throw new Error('ingen tilgang');
        var ownerId = ownerOf(db, p.p_type, p.p_id);
        var ownerP = db.profiles.find(function (x) { return x.id === ownerId; });
        var col = p.p_type === 'universe' ? 'universe_id' : p.p_type === 'group' ? 'group_id' : 'card_id';
        var self = p.p_type === 'universe' ? findU(db, p.p_id) : p.p_type === 'group' ? findG(db, p.p_id) : findC(db, p.p_id);
        return {
          owner: ownerP ? { id: ownerP.id, email: ownerP.email, display_name: ownerP.display_name } : null,
          viewer: {
            id: uid,
            can_admin: canAdminResource(db, p.p_type, p.p_id, uid),
            can_invite: canInviteTo(db, p.p_type, p.p_id, uid),
            can_manage_policy: canManageInvitePolicy(db, p.p_type, p.p_id, uid),
          },
          invite_policy: (self && self.invite_policy) || 'inherit',
          invite_effective: effectiveInvitePolicy(db, p.p_type, p.p_id),
          members: db.memberships.filter(function (m) { return m[col] === p.p_id; }).map(function (m) {
            var pr = db.profiles.find(function (x) { return x.id === m.user_id; }) || {};
            return { id: pr.id, email: pr.email, display_name: pr.display_name, since: m.created_at };
          }),
          pending_invites: db.share_invites.filter(function (s) {
            return s.status === 'pending' && s[col] === p.p_id;
          }).map(function (s) {
            return { id: s.id, email: s.invitee_email, created_at: s.created_at,
              by: s.inviter_id, by_name: nameOf(db, s.inviter_id), mine: s.inviter_id === uid };
          }),
        };
      },
    };
  }

  /* ---------------- Klient-fabrikk ---------------- */
  function createClient() {
    var authListeners = [];
    function emitAuth(event, session) { authListeners.forEach(function (cb) { try { cb(event, session); } catch (e) {} }); }
    function sessionObj() { var u = getSess(); return u ? { user: u } : null; }

    var channels = [];
    function fireChannels() { channels.forEach(function (ch) { ch._handlers.forEach(function (h) { try { h(); } catch (e) {} }); }); }
    window.addEventListener('storage', function (ev) {
      if (ev.key === PING_KEY) fireChannels();
    });

    function thenable(fn) {
      // Awaitbar builder som utfører fn() ved await (etter ev. ?lag=-forsinkelse);
      // .eq() kjeder filtre.
      var filters = {};
      var builder = {
        eq: function (col, val) { filters[col] = val; return builder; },
        then: function (resolve, reject) {
          return serverCall(function () { return fn(filters); }).then(resolve, reject);
        },
      };
      return builder;
    }

    var client = {
      auth: {
        signUp: function (opts) {
          var db = loadDB();
          var email = String(opts.email).toLowerCase();
          var uid = uidFor(email);
          // Unikhet på E-POST, ikke bare uidFor-id: en bruker som har ENDRET
          // e-post beholder sin gamle id, og adressen må fortsatt regnes som
          // opptatt — ellers kunne en ny registrering overskrive passordet
          // (db.passwords[email]) og «overta» den eksisterende kontoen.
          if (!db.profiles.some(function (p) { return p.email === email; })) {
            // Navn (display_name) fra registrerings-metadata (handle_new_user).
            var meta = (opts.options && opts.options.data) || {};
            var dn = (meta.display_name && String(meta.display_name).trim()) || email.split('@')[0];
            db.profiles.push({ id: uid, email: email, display_name: dn, user_metadata: clone(meta) });
            db.passwords[email] = opts.password;
            // koble ventende invitasjoner (handle_new_user)
            db.share_invites.forEach(function (s) {
              if (s.status === 'pending' && !s.invitee_id && String(s.invitee_email).toLowerCase() === email) s.invitee_id = uid;
            });
            saveDB(db);
          }
          // Simuler «bekreft e-post»: ingen sesjon returneres (bruker må «logge inn»).
          return Promise.resolve({ data: { user: { id: uid, email: email }, session: null }, error: null });
        },
        signInWithPassword: function (opts) {
          var db = loadDB();
          var email = String(opts.email).toLowerCase();
          // Slå opp på E-POST (ikke uidFor): e-posten kan være endret etter
          // registrering (auth.updateUser({ email })), mens id-en består.
          var p = db.profiles.find(function (x) { return x.email === email; });
          if (!p || db.passwords[email] !== opts.password) {
            return Promise.resolve({ data: null, error: { message: 'Invalid login credentials' } });
          }
          var user = { id: p.id, email: email, user_metadata: clone(p.user_metadata) || {} };
          setSess(user);
          setTimeout(function () { emitAuth('SIGNED_IN', { user: user }); }, 0);
          return Promise.resolve({ data: { user: user, session: { user: user } }, error: null });
        },
        resetPasswordForEmail: function () { return Promise.resolve({ data: {}, error: null }); },
        updateUser: function (attrs) {
          var u = getSess();
          if (u && (attrs.password || attrs.data || attrs.email)) {
            var db = loadDB();
            if (attrs.password) db.passwords[u.email] = attrs.password;
            if (attrs.data) {
              var p = db.profiles.find(function (x) { return x.id === u.id; });
              if (p) {
                p.user_metadata = Object.assign({}, p.user_metadata, attrs.data);
                u.user_metadata = clone(p.user_metadata);
                setSess(u); // hold denne fanens sesjon i takt
              }
            }
            if (attrs.email) {
              // E-postendring — ekte Supabase sender bekreftelseslenke; mocken
              // endrer direkte (som handle_user_email_change etter bekreftelse).
              var ne = String(attrs.email).toLowerCase().trim();
              var mine = db.profiles.find(function (x) { return x.id === u.id; });
              var taken = db.profiles.some(function (x) { return x.email === ne && x.id !== u.id; });
              if (!mine || taken) {
                return Promise.resolve({ data: null, error: { message: 'E-postadressen er allerede i bruk' } });
              }
              db.passwords[ne] = db.passwords[mine.email];
              delete db.passwords[mine.email];
              mine.email = ne;
              u.email = ne;
              setSess(u);
            }
            saveDB(db);
          }
          return Promise.resolve({ data: { user: u }, error: null });
        },
        signOut: function () { setSess(null); setTimeout(function () { emitAuth('SIGNED_OUT', null); }, 0); return Promise.resolve({ error: null }); },
        getSession: function () { return Promise.resolve({ data: { session: sessionObj() }, error: null }); },
        onAuthStateChange: function (cb) {
          authListeners.push(cb);
          setTimeout(function () { cb('INITIAL_SESSION', sessionObj()); }, 0);
          return { data: { subscription: { unsubscribe: function () {} } } };
        },
      },
      from: function (table) {
        return {
          insert: function (payload) {
            return thenable(function () {
              var u = getSess(); if (!u) return { data: null, error: { message: 'ikke innlogget' } };
              var db = loadDB(); applyInsert(db, table, u.id, payload); saveDB(db);
              return { data: null, error: null };
            });
          },
          update: function (payload) {
            return thenable(function (filters) {
              var u = getSess(); if (!u) return { data: null, error: { message: 'ikke innlogget' } };
              var db = loadDB(); applyUpdate(db, table, u.id, clone(payload), filters); saveDB(db);
              return { data: null, error: null };
            });
          },
          delete: function () {
            return thenable(function (filters) {
              var u = getSess(); if (!u) return { data: null, error: { message: 'ikke innlogget' } };
              var db = loadDB(); applyDelete(db, table, u.id, filters); saveDB(db);
              return { data: null, error: null };
            });
          },
          select: function () {
            return thenable(function (filters) {
              var db = loadDB(); var rows = db[table].filter(function (r) {
                for (var k in filters) if (r[k] !== filters[k]) return false; return true;
              });
              return { data: clone(rows), error: null };
            });
          },
        };
      },
      rpc: function (name, params) {
        return serverCall(function () {
          var u = getSess();
          if (!u) return { data: null, error: { message: 'ikke innlogget' } };
          // Databasen leses FØRST når kallet «når serveren» (etter forsinkelsen),
          // så serialiserte kall ser hverandres skrivinger — som ekte Postgres.
          var db = loadDB();
          var h = rpcHandlers(db, u.id)[name];
          if (!h) return { data: null, error: { message: 'ukjent rpc: ' + name } };
          var data = h(params || {});
          saveDB(db);
          return { data: data, error: null };
        });
      },
      channel: function (nm) {
        var ch = { _handlers: [], _statusCb: null,
          on: function () { var cb = arguments[arguments.length - 1]; ch._handlers.push(cb); return ch; },
          subscribe: function (statusCb) { channels.push(ch); if (statusCb) setTimeout(function () { statusCb('SUBSCRIBED'); }, 0); return ch; },
        };
        return ch;
      },
      removeChannel: function (ch) { channels = channels.filter(function (c) { return c !== ch; }); },
    };
    return client;
  }

  window.HK_MOCK = { createClient: createClient, _loadDB: loadDB, _saveDB: saveDB };
})();
