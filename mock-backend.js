/* ============================================================
   Huskekurv — hermetisk mock-backend (KUN for testing, ?mock=1)
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
    // Redigering blokkeres hvis objektet selv eller en forelder er låst av en annen.
    var u, g;
    if (type === 'universe') { return obj.locked && obj.owner_id !== uid; }
    if (type === 'group') {
      u = db.universes.find(function (x) { return x.id === obj.universe_id; });
      return (obj.locked && obj.owner_id !== uid) || (u && u.locked && u.owner_id !== uid);
    }
    // card
    g = db.groups.find(function (x) { return x.id === obj.group_id; });
    u = g && db.universes.find(function (x) { return x.id === g.universe_id; });
    return (obj.locked && obj.owner_id !== uid) ||
           (g && g.locked && g.owner_id !== uid) ||
           (u && u.locked && u.owner_id !== uid);
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
          trashed: !!u.trashed, locked: !!u.locked, ts: u.ts, org: u.org,
          pos: u.pos, posTs: u.pos_ts, posOrg: u.pos_org,
          shared: !!sharedU[u.id], mount: mountObj(m, false),
        };
      }),
      groups: myGroups.map(function (g) {
        var m = membershipFor(db, uid, 'group', g.id);
        return {
          id: g.id, owner: g.owner_id, mine: g.owner_id === uid, uni: g.universe_id, name: g.name,
          trashed: !!g.trashed, locked: !!g.locked, ts: g.ts, org: g.org,
          pos: g.pos, posTs: g.pos_ts, posOrg: g.pos_org,
          shared: !!sharedG[g.id], mount: mountObj(m, true),
        };
      }),
      cards: myCards.map(function (c) {
        var m = membershipFor(db, uid, 'card', c.id);
        return {
          id: c.id, owner: c.owner_id, mine: c.owner_id === uid, group: c.group_id, title: c.title,
          trashed: !!c.trashed, locked: !!c.locked, k: c.k !== false, p: c.p !== false,
          labTs: c.lab_ts, labOrg: c.lab_org, ts: c.ts, org: c.org,
          pos: c.pos, posTs: c.pos_ts, posOrg: c.pos_org,
          shared: !!sharedC[c.id], mount: mountObj(m, true),
        };
      }),
      items: myItems.map(function (i) {
        return {
          id: i.id, owner: i.owner_id, mine: i.owner_id === uid, home: i.card_id, text: i.text,
          trashed: !!i.trashed, done: !!i.done, responsible: i.responsible || null,
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
        return { id: s.id, type: type, name: name, from: emailOf(db, s.inviter_id), created_at: s.created_at };
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
      db[table].push(row);
    });
  }
  function applyUpdate(db, table, uid, patch, filters) {
    var list = db[table];
    list.forEach(function (row) {
      for (var k in filters) if (row[k] !== filters[k]) return;
      if (table === 'memberships') {
        if (row.user_id !== uid) return;
        ['pos', 'trashed', 'parent_universe_id', 'parent_group_id'].forEach(function (f) {
          if (f in patch) row[f] = patch[f];
        });
        return;
      }
      // objekt-tabeller: owner-immutabel, lås/trashed-vakter, felt-LWW
      var isOwner = row.owner_id === uid;
      var direct = table === 'universes' ? membershipFor(db, uid, 'universe', row.id)
                 : table === 'groups' ? membershipFor(db, uid, 'group', row.id)
                 : table === 'cards' ? membershipFor(db, uid, 'card', row.id) : null;
      var type = table === 'universes' ? 'universe' : table === 'groups' ? 'group' : table === 'cards' ? 'card' : 'item';
      // Lås: ikke-eier kan ikke redigere låst gren.
      if (!isOwner && type !== 'item' && lockedAncestor(db, row, type, uid)) return;
      if (!isOwner && type === 'item') {
        var c = db.cards.find(function (x) { return x.id === row.card_id; });
        if (c && lockedAncestor(db, c, 'card', uid)) return;
      }
      // locked kun av eier
      if ('locked' in patch && !isOwner) delete patch.locked;
      // content-register
      if (regNewer(patch.ts, patch.org, row.ts, row.org)) {
        // trashed-vakt: mottaker med direkte medlemskap kan ikke endre trashed på share-roten
        var blockTrashed = (!isOwner && direct && (type === 'universe' || type === 'group' || type === 'card'));
        if ('name' in patch) row.name = patch.name;
        if ('title' in patch) row.title = patch.title;
        if ('text' in patch) row.text = patch.text;
        if ('done' in patch) row.done = patch.done;
        if ('responsible' in patch) row.responsible = patch.responsible;
        if ('trashed' in patch && !blockTrashed) row.trashed = patch.trashed;
        row.ts = patch.ts; row.org = patch.org;
      }
      // label-register (cards)
      if (table === 'cards' && regNewer(patch.lab_ts, patch.lab_org, row.lab_ts, row.lab_org)) {
        if ('k' in patch) row.k = patch.k;
        if ('p' in patch) row.p = patch.p;
        row.lab_ts = patch.lab_ts; row.lab_org = patch.lab_org;
      }
      // pos-register (+ forelder følger posisjon)
      if (regNewer(patch.pos_ts, patch.pos_org, row.pos_ts, row.pos_org)) {
        if ('pos' in patch) row.pos = patch.pos;
        if ('universe_id' in patch) row.universe_id = patch.universe_id;
        if ('group_id' in patch) row.group_id = patch.group_id;
        if ('card_id' in patch) row.card_id = patch.card_id;
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
      if (type === 'universe') allowed = isOwner;
      else if (type === 'item') allowed = isOwner || canReadCard(db, row.card_id, uid);
      else allowed = isOwner || (!direct && (type === 'group' ? canReadGroup(db, row.id, uid) : canReadCard(db, row.id, uid)));
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
          return { id: id, owner_id: uid, name: r.name || '', trashed: !!r.trashed, locked: false,
            ts: r.ts || 0, org: r.org || '', pos: r.pos || 0, pos_ts: r.posTs || 0, pos_org: r.posOrg || '' };
        });
        up(doc.groups, 'groups', function (r, id) {
          return { id: id, owner_id: uid, universe_id: legacyId(uid, r.uni), name: r.name || '', trashed: !!r.trashed,
            locked: false, ts: r.ts || 0, org: r.org || '', pos: r.pos || 0, pos_ts: r.posTs || 0, pos_org: r.posOrg || '' };
        });
        up(doc.cards, 'cards', function (r, id) {
          return { id: id, owner_id: uid, group_id: legacyId(uid, r.group), title: r.title || '', trashed: !!r.trashed,
            locked: false, k: r.k !== false, p: r.p !== false, lab_ts: r.labTs || 0, lab_org: r.labOrg || '',
            ts: r.ts || 0, org: r.org || '', pos: r.pos || 0, pos_ts: r.posTs || 0, pos_org: r.posOrg || '' };
        });
        up(doc.items, 'items', function (r, id) {
          return { id: id, owner_id: uid, card_id: legacyId(uid, r.home), text: r.text || '', trashed: !!r.trashed,
            done: !!r.done, responsible: r.responsible || null,
            ts: r.ts || 0, org: r.org || '', pos: r.pos || 0, pos_ts: r.posTs || 0, pos_org: r.posOrg || '' };
        });
        return { universes: (doc.universes || []).length, groups: (doc.groups || []).length,
                 cards: (doc.cards || []).length, items: (doc.items || []).length };
      },
      create_share_invite: function (p) {
        if (ownerOf(db, p.p_type, p.p_id) !== uid) throw new Error('kun eieren kan dele');
        var em = String(p.p_email).toLowerCase().trim();
        if (em === emailOf(db, uid)) throw new Error('kan ikke dele med deg selv');
        var target = (db.profiles.find(function (x) { return x.email === em; }) || {}).id || null;
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
        var inv = db.share_invites.find(function (s) { return s.id === p.p_invite && s.inviter_id === uid; });
        if (!inv) throw new Error('fant ingen ventende invitasjon');
        inv.status = 'revoked';
        return null;
      },
      revoke_share: function (p) {
        if (ownerOf(db, p.p_type, p.p_id) !== uid) throw new Error('kun eieren kan kaste ut andre');
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
        if (ownerOf(db, p.p_type, p.p_id) !== uid) throw new Error('kun eieren kan låse/åpne');
        var t = p.p_type === 'universe' ? db.universes : p.p_type === 'group' ? db.groups : db.cards;
        var r = t.find(function (x) { return x.id === p.p_id; });
        if (r) r.locked = p.p_locked;
        return null;
      },
      get_members: function (p) {
        var ok = p.p_type === 'universe' ? canReadUniverse(db, p.p_id, uid)
               : p.p_type === 'group' ? canReadGroup(db, p.p_id, uid)
               : canReadCard(db, p.p_id, uid);
        if (!ok) throw new Error('ingen tilgang');
        var ownerId = ownerOf(db, p.p_type, p.p_id);
        var ownerP = db.profiles.find(function (x) { return x.id === ownerId; });
        var col = p.p_type === 'universe' ? 'universe_id' : p.p_type === 'group' ? 'group_id' : 'card_id';
        return {
          owner: ownerP ? { id: ownerP.id, email: ownerP.email, display_name: ownerP.display_name } : null,
          members: db.memberships.filter(function (m) { return m[col] === p.p_id; }).map(function (m) {
            var pr = db.profiles.find(function (x) { return x.id === m.user_id; }) || {};
            return { id: pr.id, email: pr.email, display_name: pr.display_name, since: m.created_at };
          }),
          pending_invites: db.share_invites.filter(function (s) {
            return s.status === 'pending' && s[col] === p.p_id;
          }).map(function (s) { return { id: s.id, email: s.invitee_email, created_at: s.created_at }; }),
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
          if (!db.profiles.find(function (p) { return p.id === uid; })) {
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
          var uid = uidFor(email);
          var p = db.profiles.find(function (x) { return x.id === uid; });
          if (!p || db.passwords[email] !== opts.password) {
            return Promise.resolve({ data: null, error: { message: 'Invalid login credentials' } });
          }
          var user = { id: uid, email: email, user_metadata: clone(p.user_metadata) || {} };
          setSess(user);
          setTimeout(function () { emitAuth('SIGNED_IN', { user: user }); }, 0);
          return Promise.resolve({ data: { user: user, session: { user: user } }, error: null });
        },
        resetPasswordForEmail: function () { return Promise.resolve({ data: {}, error: null }); },
        updateUser: function (attrs) {
          var u = getSess();
          if (u && (attrs.password || attrs.data)) {
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
