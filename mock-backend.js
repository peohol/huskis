/* ============================================================
   Huskis — hermetisk mock-backend (KUN for testing, ?mock=1)
   ------------------------------------------------------------
   Etterligner den delmengden av Supabase-klienten appen bruker
   (auth, from().insert/update/delete, rpc, channel), med en
   «database» delt mellom faner via localStorage. Realtime
   simuleres med `storage`-hendelser. Sesjonen er PER FANE
   (sessionStorage), så to faner = to innloggede brukere.

   Fidelitet: nok til å kjøre hele rolle-/delingsmodellen (invitasjon →
   aksept → rolle, medeierskap, capabilities, effektivt mappemedlemskap,
   låser, forlat/utkast, mappeflytting med reparenting og kryssdomene-
   kopiering) + server-side felt-LWW og get_my_doc-synligheten.
   IKKE en full RLS-implementasjon.
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
    var db = null;
    try {
      var raw = localStorage.getItem(DB_KEY);
      if (raw) db = JSON.parse(raw);
    } catch (e) {}
    if (!db) {
      db = {
        profiles: [], passwords: {},
        universes: [], groups: [], cards: [], items: [],
        memberships: [], share_invites: [], tombstones: [],
      };
    }
    return migrateRoles(db);
  }
  // Speiler rolle-backfillen i users-and-sharing.sql: en database fra FØR
  // rolle-omleggingen har objekter uten roller (og kanskje medlemskap/
  // invitasjoner på listenivå). Vi utleder rollene av oppretteren én gang og
  // markerer det, så en senere fjernet rolle aldri kommer tilbake.
  function migrateRoles(db) {
    db.memberships = db.memberships || [];
    db.share_invites = db.share_invites || [];
    if (db._rolesBackfilled) return db;
    db._rolesBackfilled = true;
    var has = function (uid, col, id) {
      return db.memberships.some(function (m) { return m.user_id === uid && m[col] === id; });
    };
    (db.universes || []).forEach(function (u) {
      var row = db.memberships.find(function (m) { return m.user_id === u.owner_id && m.universe_id === u.id; });
      if (row) row.role = 'owner';
      else db.memberships.push({ id: newId('mem'), user_id: u.owner_id, universe_id: u.id,
        group_id: null, role: 'owner', pos: u.pos || 0, created_at: Date.now() });
    });
    (db.groups || []).forEach(function (g) {
      var isUniOwner = db.memberships.some(function (m) {
        return m.user_id === g.owner_id && m.universe_id === g.universe_id && m.role === 'owner';
      });
      if (isUniOwner) return;
      var row = db.memberships.find(function (m) { return m.user_id === g.owner_id && m.group_id === g.id; });
      if (row) row.role = 'owner';
      else db.memberships.push({ id: newId('mem'), user_id: g.owner_id, group_id: g.id,
        universe_id: null, role: 'owner', pos: g.pos || 0, created_at: Date.now() });
    });
    // Eksisterende medlemskap uten rolle er vanlige medlemmer; dedupliser dem
    // som allerede har arvet tilgang via området.
    db.memberships.forEach(function (m) { if (!m.role) m.role = 'member'; });
    db.memberships = db.memberships.filter(function (m) {
      if (m.card_id) return false;                 // lister deles ikke lenger
      if (!m.group_id || m.role !== 'member') return true;
      var g = (db.groups || []).find(function (x) { return x.id === m.group_id; });
      return !(g && has(m.user_id, 'universe_id', g.universe_id));
    });
    db.share_invites = db.share_invites.filter(function (s) { return !s.card_id; });
    db.share_invites.forEach(function (s) { if (!s.role) s.role = 'member'; });
    return db;
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
  // Objekt-id-er må være ekte UUID-er (som i Postgres) — brukes av move_group.
  function newUuid() {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (ch) {
      var r = (Math.random() * 16) | 0;
      return (ch === 'x' ? r : ((r & 0x3) | 0x8)).toString(16);
    });
  }
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

  /* ---------------- Rolle- og tilgangsmodell (speiler users-and-sharing.sql) ----------------
     Deling finnes KUN på områder og mapper. Myndighet kommer fra MUTABLE
     ROLLER i `memberships` (role 'owner' | 'member'); `owner_id` på objektradene
     er ren oppretter-historikk uten rettigheter. Områdeeiere er dynamiske
     supereiere av alle mapper i området. */
  function findU(db, id) { return db.universes.find(function (x) { return x.id === id; }) || null; }
  function findG(db, id) { return db.groups.find(function (x) { return x.id === id; }) || null; }
  function findC(db, id) { return db.cards.find(function (x) { return x.id === id; }) || null; }
  function findI(db, id) { return db.items.find(function (x) { return x.id === id; }) || null; }

  function uniMembership(db, uid, id) {
    return db.memberships.find(function (m) { return m.user_id === uid && m.universe_id === id; }) || null;
  }
  function grpMembership(db, uid, id) {
    return db.memberships.find(function (m) { return m.user_id === uid && m.group_id === id; }) || null;
  }
  function universeRole(db, id, uid) { var m = uniMembership(db, uid, id); return m ? m.role : null; }
  function groupRole(db, id, uid) { var m = grpMembership(db, uid, id); return m ? m.role : null; }
  function groupUniverse(db, id) { var g = findG(db, id); return g ? g.universe_id : null; }
  function isUniverseOwner(db, id, uid) { return universeRole(db, id, uid) === 'owner'; }
  function isUniverseMember(db, id, uid) { return universeRole(db, id, uid) !== null; }
  function isGroupOwner(db, id, uid) {
    return groupRole(db, id, uid) === 'owner' || isUniverseOwner(db, groupUniverse(db, id), uid);
  }
  function isGroupMember(db, id, uid) {
    return groupRole(db, id, uid) !== null || isUniverseMember(db, groupUniverse(db, id), uid);
  }
  function universeOwnerCount(db, id) {
    return db.memberships.filter(function (m) { return m.universe_id === id && m.role === 'owner'; }).length;
  }
  // En gjenværende eier av området (aldri uid) — speiler
  // public.surviving_universe_owner(). Null = området står uten eier når
  // brukeren er borte, og skal slettes med kontoen (se delete_account).
  function survivingOwner(db, id, uid) {
    var m = db.memberships.filter(function (x) {
      return x.universe_id === id && x.role === 'owner' && x.user_id !== uid;
    }).sort(function (a, b) { return (a.created_at || 0) - (b.created_at || 0); })[0];
    return m ? m.user_id : null;
  }
  function universeOwnerSet(db, id) {
    return db.memberships.filter(function (m) { return m.universe_id === id && m.role === 'owner'; })
      .map(function (m) { return m.user_id; }).sort().join(',');
  }
  function universeMemberCount(db, id) {
    return db.memberships.filter(function (m) { return m.universe_id === id; }).length;
  }
  function groupMemberCount(db, id) {
    var seen = {};
    db.memberships.forEach(function (m) {
      if (m.universe_id && m.universe_id === groupUniverse(db, id)) seen[m.user_id] = 1;
      if (m.group_id === id) seen[m.user_id] = 1;
    });
    return Object.keys(seen).length;
  }

  // Området leses KUN av områdemedlemmer — en direkte mappemottaker skal
  // aldri se områdets navn eller medlemsliste.
  function canReadUniverse(db, id, uid) { return isUniverseMember(db, id, uid); }
  function canReadGroup(db, id, uid) { return !!findG(db, id) && isGroupMember(db, id, uid); }
  function canReadCard(db, id, uid) {
    var c = findC(db, id);
    return !!c && canReadGroup(db, c.group_id, uid);
  }
  function canReadAny(db, type, id, uid) {
    if (type === 'universe') return canReadUniverse(db, id, uid);
    if (type === 'group') return canReadGroup(db, id, uid);
    if (type === 'card') return canReadCard(db, id, uid);
    if (type === 'item') { var i = findI(db, id); return !!i && canReadCard(db, i.card_id, uid); }
    return false;
  }
  function resourceGroup(db, type, id) {
    if (type === 'group') return id;
    if (type === 'card') { var c = findC(db, id); return c ? c.group_id : null; }
    if (type === 'item') { var i = findI(db, id); var c2 = i && findC(db, i.card_id); return c2 ? c2.group_id : null; }
    return null;
  }
  function resourceUniverse(db, type, id) {
    if (type === 'universe') return id;
    return groupUniverse(db, resourceGroup(db, type, id));
  }
  // PRIVILEGERT = eier på nivået som styrer objektet. Privilegerte påvirkes
  // aldri av en lås for egen redigering.
  function isPrivileged(db, type, id, uid) {
    if (type === 'universe') return isUniverseOwner(db, id, uid);
    var g = resourceGroup(db, type, id);
    return !!g && isGroupOwner(db, g, uid);
  }

  // Ordnet kjede nærmeste-først [liste?, mappe?, område?].
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
      if (n.locked || n.unlocked) return { type: chain[k].type, id: n.id, isLocked: !!n.locked };
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
  // Unntak fra en ARVET lås: områdeeiere alltid; er låsen satt på en MAPPE,
  // også en EKSPLISITT mappeeier der. Uten arvet lås er «unntak» bare en
  // overflødig flaggverdi som objektets lås-eier kan rydde bort.
  function canManageLockException(db, type, id, uid) {
    if (isUniverseOwner(db, resourceUniverse(db, type, id), uid)) return true;
    var s = inheritedLockSource(db, type, id);
    if (s && s.isLocked && s.type === 'group') return groupRole(db, s.id, uid) === 'owner';
    if (!(s && s.isLocked)) return isPrivileged(db, type, id, uid);
    return false;
  }

  // Invitasjonspolicy (tretilstand med dynamisk arv) — kun område og mappe.
  function effectiveInviteSource(db, type, id) {
    var chain = [], r;
    if (type === 'group') {
      r = findG(db, id); if (r) chain.push({ type: 'group', row: r });
      var u = r && findU(db, r.universe_id); if (u) chain.push({ type: 'universe', row: u });
    } else if (type === 'universe') {
      r = findU(db, id); if (r) chain.push({ type: 'universe', row: r });
    }
    for (var k = 0; k < chain.length; k++) {
      var pol = chain[k].row.invite_policy;
      if (pol === 'allow' || pol === 'deny') return { type: chain[k].type, id: chain[k].row.id, pol: pol };
    }
    return null;
  }
  function effectiveInvitePolicy(db, type, id) {
    var s = effectiveInviteSource(db, type, id); return s ? s.pol === 'allow' : true;
  }
  function inheritedInviteSource(db, type, id) {
    if (type !== 'group') return null;
    var g = findG(db, id);
    return g ? effectiveInviteSource(db, 'universe', g.universe_id) : null;
  }

  /* ---- Capabilities ---- */
  function canEditContent(db, type, id, uid) {
    return canReadAny(db, type, id, uid) &&
      (isPrivileged(db, type, id, uid) || !isEffectivelyLocked(db, type, id));
  }
  function canCreateChild(db, type, id, uid) { return canEditContent(db, type, id, uid); }
  // Posisjonen tilhører FORELDERENS organisering. Områdets toppnivåposisjon
  // er PERSONLIG (memberships.pos) og krever bare medlemskap.
  function canReorderInParent(db, type, id, uid) {
    var r;
    if (type === 'universe') return isUniverseMember(db, id, uid);
    if (type === 'group') { r = findG(db, id); return !!r && canEditContent(db, 'universe', r.universe_id, uid); }
    if (type === 'card') { r = findC(db, id); return !!r && canEditContent(db, 'group', r.group_id, uid); }
    if (type === 'item') { r = findI(db, id); return !!r && canEditContent(db, 'card', r.card_id, uid); }
    return false;
  }
  function canDeleteObject(db, type, id, uid) {
    if (type === 'universe') return isUniverseOwner(db, id, uid);
    if (type === 'group') {
      return isGroupOwner(db, id, uid) ||
        (isUniverseMember(db, groupUniverse(db, id), uid) && !isEffectivelyLocked(db, 'group', id));
    }
    return isPrivileged(db, type, id, uid) ||
      (canReadAny(db, type, id, uid) && !isEffectivelyLocked(db, type, id));
  }
  function canLeave(db, type, id, uid) {
    if (type === 'universe') {
      var r = universeRole(db, id, uid);
      return r !== null && (r !== 'owner' || universeOwnerCount(db, id) > 1);
    }
    // En direkte mapperolle gir bare forlat-rett når den er ENESTE vei inn:
    // med en områderolle i tillegg forlater man i området (se can_leave).
    if (type === 'group') {
      return groupRole(db, id, uid) !== null &&
        universeRole(db, groupUniverse(db, id), uid) === null;
    }
    return false;
  }
  function canManageMembers(db, type, id, uid) {
    if (type === 'universe') return isUniverseOwner(db, id, uid);
    if (type === 'group') return isGroupOwner(db, id, uid);
    return false;
  }
  function canInviteTo(db, type, id, uid) {
    return canManageMembers(db, type, id, uid) ||
      (canReadAny(db, type, id, uid) && (type === 'universe' || type === 'group') &&
       effectiveInvitePolicy(db, type, id));
  }
  function canInviteOwner(db, type, id, uid) { return canManageMembers(db, type, id, uid); }
  function canManageLock(db, type, id, uid) { return isPrivileged(db, type, id, uid); }
  function canManageInvitePolicy(db, type, id, uid) {
    var s = inheritedInviteSource(db, type, id);
    if (s && s.pol === 'deny') return isUniverseOwner(db, resourceUniverse(db, type, id), uid);
    return canManageMembers(db, type, id, uid);
  }
  function canMoveGroup(db, id, uid) { return canDeleteObject(db, 'group', id, uid); }

  function universeCaps(db, id, uid) {
    return {
      read: canReadUniverse(db, id, uid),
      editContent: canEditContent(db, 'universe', id, uid),
      createGroup: canCreateChild(db, 'universe', id, uid),
      reorderGroups: canEditContent(db, 'universe', id, uid),
      manageSettings: canManageMembers(db, 'universe', id, uid),
      delete: canDeleteObject(db, 'universe', id, uid),
      leave: canLeave(db, 'universe', id, uid),
      invite: canInviteTo(db, 'universe', id, uid),
      inviteOwner: canInviteOwner(db, 'universe', id, uid),
      manageMembers: canManageMembers(db, 'universe', id, uid),
      manageOwners: canManageMembers(db, 'universe', id, uid),
      manageLock: canManageLock(db, 'universe', id, uid),
      lockException: canManageLockException(db, 'universe', id, uid),
      managePolicy: canManageInvitePolicy(db, 'universe', id, uid),
      locked: isEffectivelyLocked(db, 'universe', id),
    };
  }
  function groupCaps(db, id, uid) {
    return {
      read: canReadGroup(db, id, uid),
      editContent: canEditContent(db, 'group', id, uid),
      createList: canCreateChild(db, 'group', id, uid),
      reorderInParent: canReorderInParent(db, 'group', id, uid),
      manageSettings: canManageMembers(db, 'group', id, uid),
      delete: canDeleteObject(db, 'group', id, uid),
      move: canMoveGroup(db, id, uid),
      leave: canLeave(db, 'group', id, uid),
      invite: canInviteTo(db, 'group', id, uid),
      inviteOwner: canInviteOwner(db, 'group', id, uid),
      manageMembers: canManageMembers(db, 'group', id, uid),
      manageOwners: canManageMembers(db, 'group', id, uid),
      manageLock: canManageLock(db, 'group', id, uid),
      lockException: canManageLockException(db, 'group', id, uid),
      managePolicy: canManageInvitePolicy(db, 'group', id, uid),
      locked: isEffectivelyLocked(db, 'group', id),
    };
  }

  function emailOf(db, uid) {
    var p = db.profiles.find(function (x) { return x.id === uid; });
    return p ? p.email : null;
  }
  function nameOf(db, uid) {
    var p = db.profiles.find(function (x) { return x.id === uid; });
    return p ? (p.display_name || null) : null;
  }

  /* ---- Opprydding ved forlat/utkast (purge_*_access i SQL) ---- */
  function purgeUniverseAccess(db, uniId, userId) {
    var groupIds = db.groups.filter(function (g) { return g.universe_id === uniId; })
      .map(function (g) { return g.id; });
    db.memberships = db.memberships.filter(function (m) {
      if (m.user_id !== userId) return true;
      if (m.universe_id === uniId) return false;
      return groupIds.indexOf(m.group_id) === -1;
    });
    var em = emailOf(db, userId);
    db.share_invites.forEach(function (s) {
      if (s.status !== 'pending') return;
      var mine = s.invitee_id === userId || (em && String(s.invitee_email).toLowerCase() === em);
      if (!mine) return;
      if (s.universe_id === uniId || groupIds.indexOf(s.group_id) > -1) s.status = 'revoked';
    });
    var cardIds = db.cards.filter(function (c) { return groupIds.indexOf(c.group_id) > -1; })
      .map(function (c) { return c.id; });
    db.cards.forEach(function (c) {
      if (c.responsible === userId && groupIds.indexOf(c.group_id) > -1) { c.responsible = null; c.ts = Date.now(); c.org = 'server'; }
    });
    db.items.forEach(function (i) {
      if (i.responsible === userId && cardIds.indexOf(i.card_id) > -1) { i.responsible = null; i.ts = Date.now(); i.org = 'server'; }
    });
  }
  function purgeGroupAccess(db, gid, userId) {
    db.memberships = db.memberships.filter(function (m) {
      return !(m.user_id === userId && m.group_id === gid);
    });
    var em = emailOf(db, userId);
    db.share_invites.forEach(function (s) {
      if (s.status === 'pending' && s.group_id === gid &&
          (s.invitee_id === userId || (em && String(s.invitee_email).toLowerCase() === em))) s.status = 'revoked';
    });
    if (isGroupMember(db, gid, userId)) return;
    var cardIds = db.cards.filter(function (c) { return c.group_id === gid; }).map(function (c) { return c.id; });
    db.cards.forEach(function (c) {
      if (c.responsible === userId && c.group_id === gid) { c.responsible = null; c.ts = Date.now(); c.org = 'server'; }
    });
    db.items.forEach(function (i) {
      if (i.responsible === userId && cardIds.indexOf(i.card_id) > -1) { i.responsible = null; i.ts = Date.now(); i.org = 'server'; }
    });
  }

  function getMyDoc(db, uid) {
    var myUni = db.universes.filter(function (u) { return isUniverseMember(db, u.id, uid); });
    var myUniIds = {}; myUni.forEach(function (u) { myUniIds[u.id] = 1; });
    var myGroups = db.groups.filter(function (g) {
      return myUniIds[g.universe_id] || grpMembership(db, uid, g.id);
    });
    var myGroupIds = {}; myGroups.forEach(function (g) { myGroupIds[g.id] = 1; });
    var myCards = db.cards.filter(function (c) { return myGroupIds[c.group_id]; });
    var myCardIds = {}; myCards.forEach(function (c) { myCardIds[c.id] = 1; });
    var myItems = db.items.filter(function (i) { return myCardIds[i.card_id]; });

    var email = emailOf(db, uid);
    var selfProf = db.profiles.find(function (x) { return x.id === uid; }) || {};
    return {
      user: { id: uid, email: email, display_name: selfProf.display_name || (email || '').split('@')[0] },
      universes: myUni.map(function (u) {
        var m = uniMembership(db, uid, u.id);
        return {
          id: u.id, creator: u.owner_id, createdByMe: u.owner_id === uid,
          role: m ? m.role : null, personalPos: m ? m.pos : 0,
          name: u.name, collapsed: !!u.collapsed,
          trashed: !!u.trashed, locked: !!u.locked, unlocked: !!u.unlocked,
          invitePolicy: u.invite_policy || 'inherit', ts: u.ts, org: u.org,
          pos: u.pos, posTs: u.pos_ts, posOrg: u.pos_org,
          ownerCount: universeOwnerCount(db, u.id),
          ownerKey: universeOwnerSet(db, u.id),
          memberCount: universeMemberCount(db, u.id),
          shared: universeMemberCount(db, u.id) > 1,
          caps: universeCaps(db, u.id, uid),
        };
      }),
      groups: myGroups.map(function (g) {
        var m = grpMembership(db, uid, g.id);
        return {
          id: g.id, creator: g.owner_id, createdByMe: g.owner_id === uid,
          uni: g.universe_id, free: !myUniIds[g.universe_id],
          role: m ? m.role : null, personalPos: m ? m.pos : 0,
          name: g.name, cat: g.cat_id || null, isCat: !!g.is_cat, collapsed: !!g.collapsed,
          trashed: !!g.trashed, locked: !!g.locked, unlocked: !!g.unlocked,
          invitePolicy: g.invite_policy || 'inherit', ts: g.ts, org: g.org,
          pos: g.pos, posTs: g.pos_ts, posOrg: g.pos_org,
          memberCount: groupMemberCount(db, g.id),
          shared: groupMemberCount(db, g.id) > 1,
          caps: groupCaps(db, g.id, uid),
        };
      }),
      cards: myCards.map(function (c) {
        return {
          id: c.id, creator: c.owner_id, createdByMe: c.owner_id === uid, group: c.group_id, title: c.title,
          trashed: !!c.trashed, locked: !!c.locked, unlocked: !!c.unlocked,
          k: c.k !== false, p: c.p !== false,
          responsible: c.responsible || null,
          start: c.start_at || null, due: c.due_at || null, lockTimes: !!c.lock_times,
          collapsed: !!c.collapsed,
          labTs: c.lab_ts, labOrg: c.lab_org, ts: c.ts, org: c.org,
          pos: c.pos, posTs: c.pos_ts, posOrg: c.pos_org,
        };
      }),
      items: myItems.map(function (i) {
        return {
          id: i.id, creator: i.owner_id, createdByMe: i.owner_id === uid, home: i.card_id, text: i.text,
          cat: i.cat_id || null, isCat: !!i.is_cat, lockTimes: !!i.lock_times, collapsed: !!i.collapsed,
          trashed: !!i.trashed, done: !!i.done, responsible: i.responsible || null,
          start: i.start_at || null, due: i.due_at || null,
          ts: i.ts, org: i.org, pos: i.pos, posTs: i.pos_ts, posOrg: i.pos_org,
        };
      }),
      invites_in: db.share_invites.filter(function (s) {
        return s.status === 'pending' && (s.universe_id || s.group_id) && (s.invitee_id === uid ||
          (email && String(s.invitee_email).toLowerCase() === email.toLowerCase()));
      }).map(function (s) {
        var type = s.universe_id ? 'universe' : 'group';
        var name = s.universe_id ? (findU(db, s.universe_id) || {}).name : (findG(db, s.group_id) || {}).name;
        return { id: s.id, type: type, role: s.role || 'member', name: name,
                 from: emailOf(db, s.inviter_id), from_name: nameOf(db, s.inviter_id),
                 created_at: s.created_at };
      }),
      invites_out: db.share_invites.filter(function (s) {
        return s.status === 'pending' && s.inviter_id === uid && (s.universe_id || s.group_id);
      }).map(function (s) {
        return { id: s.id, type: s.universe_id ? 'universe' : 'group', role: s.role || 'member',
                 target_id: s.universe_id || s.group_id,
                 email: s.invitee_email, created_at: s.created_at };
      }),
    };
  }

  // Deduplisert, kategorisert medlemsliste. Presedens:
  //   1 områdeeier  2 eksplisitt mappeeier  3 områdemedlem  4 mappemedlem
  function getMembers(db, type, id, uid) {
    if (!canReadAny(db, type, id, uid)) throw new Error('ingen tilgang');
    var uni = resourceUniverse(db, type, id);
    var acc = [];
    db.memberships.forEach(function (m) {
      if (m.universe_id && m.universe_id === uni) {
        acc.push({ user_id: m.user_id, prec: m.role === 'owner' ? 1 : 3,
          category: m.role === 'owner' ? 'universeOwner' : 'universeMember',
          role: m.role, source: 'universe', direct: type === 'universe' });
      }
      if (type === 'group' && m.group_id === id) {
        acc.push({ user_id: m.user_id, prec: m.role === 'owner' ? 2 : 4,
          category: m.role === 'owner' ? 'groupOwner' : 'groupMember',
          role: m.role, source: 'group', direct: true });
      }
    });
    var best = {};
    acc.forEach(function (a) { if (!best[a.user_id] || a.prec < best[a.user_id].prec) best[a.user_id] = a; });
    var canManage = canManageMembers(db, type, id, uid);
    var ownerCount = type === 'universe' ? universeOwnerCount(db, id)
      : db.memberships.filter(function (m) { return m.group_id === id && m.role === 'owner'; }).length;
    var members = Object.keys(best).map(function (k) { return best[k]; }).map(function (b) {
      var pr = db.profiles.find(function (x) { return x.id === b.user_id; }) || {};
      var lastOwner = type === 'universe' && b.role === 'owner' && ownerCount <= 1;
      return {
        id: b.user_id, email: pr.email, display_name: pr.display_name,
        avatar: pr.avatar || null,
        category: b.category, role: b.role, source: b.source, direct: b.direct,
        removable: b.direct && canManage && !lastOwner,
        removeHint: !b.direct ? 'Har tilgang via området og må fjernes der'
          : (lastOwner ? 'Siste eier kan ikke fjernes' : null),
        demotable: b.direct && b.role === 'owner' && canManage && !lastOwner,
        // Rolleløft går via en invitasjon mottakeren må godta — flagget speiler
        // retten til å invitere til eierskap, ikke retten til å skrive rollen.
        promotable: b.direct && b.role === 'member' && canInviteOwner(db, type, id, uid) &&
          !db.share_invites.some(function (s) {
            return s.status === 'pending' && s.role === 'owner' &&
              String(s.invitee_email).toLowerCase() === String(pr.email || '').toLowerCase() &&
              ((type === 'universe' && s.universe_id === id) || (type === 'group' && s.group_id === id));
          }),
        prec: b.prec,
      };
    }).sort(function (a, b) {
      if (a.prec !== b.prec) return a.prec - b.prec;
      return String(a.display_name || a.email || '').toLowerCase()
        .localeCompare(String(b.display_name || b.email || '').toLowerCase());
    });
    var self = type === 'universe' ? findU(db, id) : findG(db, id);
    return {
      type: type,
      ownerCount: ownerCount,
      memberCount: type === 'universe' ? universeMemberCount(db, id) : groupMemberCount(db, id),
      viewer: {
        id: uid,
        role: type === 'universe' ? universeRole(db, id, uid) : groupRole(db, id, uid),
        caps: type === 'universe' ? universeCaps(db, id, uid) : groupCaps(db, id, uid),
      },
      invitePolicy: (self && self.invite_policy) || 'inherit',
      inviteEffective: effectiveInvitePolicy(db, type, id),
      members: members,
      pendingInvites: db.share_invites.filter(function (s) {
        return s.status === 'pending' &&
          ((type === 'universe' && s.universe_id === id) || (type === 'group' && s.group_id === id));
      }).map(function (s) {
        return { id: s.id, email: s.invitee_email, role: s.role || 'member', created_at: s.created_at,
          by: s.inviter_id, by_name: nameOf(db, s.inviter_id), mine: s.inviter_id === uid };
      }),
    };
  }

  /* ---------------- Tabell-CRUD (med server-side LWW + vakter) ---------------- */
  // Ett sted for «passer raden filtrene?», så .eq() og .in() oppfører seg likt
  // i update, delete og select.
  function matches(row, filters) {
    for (var k in filters) {
      var f = filters[k];
      if (f.op === 'in') { if (f.val.indexOf(row[k]) === -1) return false; }
      else if (row[k] !== f.val) return false;
    }
    return true;
  }
  var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  // `items.cat_id`/`groups.cat_id` er fremmednøkler til sin egen tabell. Ekte
  // Postgres avviser en rad som peker på en kategori som ikke finnes — og det
  // er nettopp den avvisningen som en gang låste synken i en usynlig
  // retry-løkke, så mocken må håndheve den for at testene skal være ekte.
  function catFkError(db, table, payload) {
    if (table !== 'items' && table !== 'groups') return null;
    var cat = payload && payload.cat_id;
    if (!cat) return null;
    var rows = db[table] || [];
    for (var i = 0; i < rows.length; i++) if (rows[i].id === cat) return null;
    return { code: '23503', message: 'insert or update on table "' + table +
      '" violates foreign key constraint "' + table + '_cat_id_fkey"' };
  }
  var TYPE_OF_TABLE = { universes: 'universe', groups: 'group', cards: 'card', items: 'item' };
  // Speiler guard_object_insert: en gravlagt id kan ikke settes inn igjen.
  // Returneres som en feil (ikke et kast), med samme distinkte kode som
  // PostgREST gir for PT409, slik at klientens isTombstoneReject treffer.
  function tombstoneError(db, table, payload) {
    var type = TYPE_OF_TABLE[table];
    if (!type) return null;
    var rows = Array.isArray(payload) ? payload : [payload];
    for (var i = 0; i < rows.length; i++) {
      for (var j = 0; j < db.tombstones.length; j++) {
        if (db.tombstones[j].resource_type === type && db.tombstones[j].resource_id === rows[i].id) {
          return { code: 'PT409', message: 'gravlagt: ' + type + ' ' + rows[i].id + ' er permanent slettet' };
        }
      }
    }
    return null;
  }
  function applyInsert(db, table, uid, payload) {
    var rows = Array.isArray(payload) ? payload : [payload];
    // Objekt-tabellene har uuid-kolonner (som ekte Postgres): avvis ugyldige
    // id-er slik at klienten faktisk må generere UUID-er.
    var OBJ = { universes: 1, groups: 1, cards: 1, items: 1 };
    if (OBJ[table]) {
      for (var i = 0; i < rows.length; i++) {
        if (!UUID_RE.test(String(rows[i].id || ''))) {
          throw new Error('invalid input syntax for type uuid: "' + rows[i].id + '"');
        }
        for (var k = 0; k < db[table].length; k++) {
          if (db[table][k].id === rows[i].id) {
            throw new Error('duplicate key value violates unique constraint "' + table + '_pkey"');
          }
        }
      }
    }
    // Roller opprettes KUN av SECURITY DEFINER-veiene (aksept av invitasjon +
    // opprettelses-triggerne) — klienten har ingen INSERT-rett på memberships.
    if (table === 'memberships') throw new Error('permission denied for table memberships');
    rows.forEach(function (r) {
      var row = clone(r);
      row.owner_id = uid;
      // Opprettelse av subobjekt krever opprettelsesrett i forelderen.
      if (table === 'groups' && findU(db, row.universe_id) && !canCreateChild(db, 'universe', row.universe_id, uid))
        throw new Error('mangler tilgang til området');
      if (table === 'cards' && findG(db, row.group_id) && !canCreateChild(db, 'group', row.group_id, uid))
        throw new Error('mangler tilgang til mappen');
      if (table === 'items' && findC(db, row.card_id) && !canCreateChild(db, 'card', row.card_id, uid))
        throw new Error('mangler tilgang til listen');
      // Nye objekter arver invitasjonspolicy dynamisk → lagres som 'inherit'.
      if (table === 'universes' || table === 'groups') { if (!row.invite_policy) row.invite_policy = 'inherit'; }
      db[table].push(row);
      // Opprettelses-triggerne: områdeoppretteren blir områdeeier, mappe-
      // oppretteren eksplisitt mappeeier (med mindre rollen alt er arvet).
      if (table === 'universes') seedRole(db, uid, { universe_id: row.id }, row.pos);
      if (table === 'groups' && !isUniverseOwner(db, row.universe_id, uid))
        seedRole(db, uid, { group_id: row.id }, row.pos);
    });
  }
  function seedRole(db, uid, target, pos) {
    var dup = db.memberships.find(function (m) {
      return m.user_id === uid && m.universe_id === (target.universe_id || null) &&
             m.group_id === (target.group_id || null);
    });
    if (dup) return;
    db.memberships.push({
      id: newId('mem'), user_id: uid,
      universe_id: target.universe_id || null, group_id: target.group_id || null,
      role: 'owner', pos: pos || 0, created_at: Date.now(),
    });
  }

  function applyUpdate(db, table, uid, patch, filters) {
    var list = db[table];
    list.forEach(function (row) {
      if (!matches(row, filters)) return;
      if (table === 'profiles') {
        // Som RLS-policyen: kun egen rad, og kun display_name/avatar kan endres
        // (e-post går via auth.updateUser).
        if (row.id !== uid) return;
        if ('display_name' in patch) row.display_name = patch.display_name;
        if ('avatar' in patch) row.avatar = patch.avatar;
        return;
      }
      if (table === 'memberships') {
        // Kun egen rad, og kun den PERSONLIGE posisjonen. Roller endres via RPC.
        if (row.user_id !== uid) return;
        if ('role' in patch && patch.role !== row.role) throw new Error('roller endres kun via set_member_role()');
        if ('pos' in patch) row.pos = patch.pos;
        return;
      }
      var type = table === 'universes' ? 'universe' : table === 'groups' ? 'group'
               : table === 'cards' ? 'card' : 'item';
      var canContent = canEditContent(db, type, row.id, uid);
      var canReorder = canReorderInParent(db, type, row.id, uid);
      // Oppretter (owner_id) er uforanderlig og gir ingen rettigheter.
      if ('owner_id' in patch && patch.owner_id !== row.owner_id) throw new Error('owner_id (oppretter) kan ikke endres');
      // Priviligerte kolonner — endres kun av rett autoritet.
      if ('locked' in patch && patch.locked !== row.locked && !canManageLock(db, type, row.id, uid)) throw new Error('mangler myndighet til å låse/åpne');
      if ('unlocked' in patch && patch.unlocked !== row.unlocked && !canManageLockException(db, type, row.id, uid)) throw new Error('mangler myndighet til å endre unntak');
      if ('invite_policy' in patch && patch.invite_policy !== row.invite_policy && !canManageInvitePolicy(db, type, row.id, uid)) throw new Error('mangler myndighet til å endre invitasjonspolicy');
      // Sletting til felles søppel krever destruktiv myndighet.
      if ('trashed' in patch && patch.trashed !== row.trashed && !canDeleteObject(db, type, row.id, uid))
        throw new Error('mangler myndighet til å slette objektet');
      // Mappen bytter område KUN via move_group().
      if (type === 'group' && 'universe_id' in patch && patch.universe_id !== row.universe_id)
        throw new Error('mapper flyttes mellom områder med move_group()');
      // Flytting av liste/listepunkt til ny forelder: rettigheter i BÅDE kilde og mål.
      var pcol = type === 'card' ? 'group_id' : type === 'item' ? 'card_id' : null;
      var ptype = type === 'card' ? 'group' : type === 'item' ? 'card' : null;
      if (pcol && pcol in patch && patch[pcol] !== row[pcol]) {
        if (!canEditContent(db, ptype, row[pcol], uid)) throw new Error('mangler tilgang til kilde-' + ptype);
        if (!canCreateChild(db, ptype, patch[pcol], uid)) throw new Error('mangler tilgang til mål-' + ptype);
      }
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
        if ('trashed' in patch) row.trashed = patch.trashed;
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
        if ('group_id' in patch) row.group_id = patch.group_id;
        if ('card_id' in patch) row.card_id = patch.card_id;
        if ('cat_id' in patch) row.cat_id = patch.cat_id;
        row.pos_ts = patch.pos_ts; row.pos_org = patch.pos_org;
      }
    });
  }
  // Gravstein (write_tombstone-triggeren). Idempotent, som `on conflict do update`.
  function writeTombstone(db, type, id) {
    for (var i = 0; i < db.tombstones.length; i++) {
      if (db.tombstones[i].resource_type === type && db.tombstones[i].resource_id === id) {
        db.tombstones[i].ts = Date.now();
        return;
      }
    }
    db.tombstones.push({ resource_type: type, resource_id: id, ts: Date.now() });
  }
  function applyDelete(db, table, uid, filters) {
    var type = table === 'universes' ? 'universe' : table === 'groups' ? 'group' : table === 'cards' ? 'card' : 'item';
    if (table === 'memberships') {
      db.memberships = db.memberships.filter(function (row) {
        if (!matches(row, filters)) return true;
        var mayManage = row.universe_id ? canManageMembers(db, 'universe', row.universe_id, uid)
                      : canManageMembers(db, 'group', row.group_id, uid);
        if (row.user_id !== uid && !mayManage) return true;
        // Siste-eier-invarianten gjelder også en rå sletting.
        if (row.universe_id && row.role === 'owner' && universeOwnerCount(db, row.universe_id) <= 1)
          throw new Error('området må ha minst én eier');
        return false;
      });
      return;
    }
    db[table] = db[table].filter(function (row) {
      if (!matches(row, filters)) return true;
      if (!canDeleteObject(db, type, row.id, uid)) return true; // behold (blokkert)
      writeTombstone(db, type, row.id);
      cascadeDelete(db, type, row.id);
      return false;
    });
  }
  // `on delete cascade` i ekte Postgres sletter barna RAD FOR RAD, så deres egen
  // AFTER DELETE-trigger fyrer og skriver gravstein for hvert enkelt barn.
  function cascadeDelete(db, type, id) {
    if (type === 'universe') {
      db.groups.filter(function (g) { return g.universe_id === id; }).forEach(function (g) { cascadeDelete(db, 'group', g.id); });
      db.groups = db.groups.filter(function (g) {
        if (g.universe_id !== id) return true;
        writeTombstone(db, 'group', g.id); return false;
      });
    } else if (type === 'group') {
      db.cards.filter(function (c) { return c.group_id === id; }).forEach(function (c) { cascadeDelete(db, 'card', c.id); });
      db.cards = db.cards.filter(function (c) {
        if (c.group_id !== id) return true;
        writeTombstone(db, 'card', c.id); return false;
      });
    } else if (type === 'card') {
      db.items = db.items.filter(function (i) {
        if (i.card_id !== id) return true;
        writeTombstone(db, 'item', i.id); return false;
      });
    }
    db.memberships = db.memberships.filter(function (m) {
      return !((type === 'universe' && m.universe_id === id) || (type === 'group' && m.group_id === id));
    });
    db.share_invites = db.share_invites.filter(function (s) {
      return !((type === 'universe' && s.universe_id === id) || (type === 'group' && s.group_id === id));
    });
  }

  /* ---------------- RPC-er ---------------- */
  function nextPersonalPos(db, uid) {
    return db.memberships.filter(function (m) { return m.user_id === uid; })
      .reduce(function (a, m) { return Math.max(a, m.pos || 0); }, 0) + 1;
  }

  function rpcHandlers(db, uid) {
    return {
      get_my_doc: function () { return getMyDoc(db, uid); },
      import_doc: function (p) {
        var doc = p.p_doc || {};
        var imported = {};
        ['universes', 'groups', 'cards', 'items'].forEach(function (k) {
          (doc[k] || []).forEach(function (r) { imported[legacyId(uid, r.id)] = 1; });
        });
        db.tombstones = db.tombstones.filter(function (t) { return !imported[t.resource_id]; });
        function up(list, table, mapRow) {
          (list || []).forEach(function (r) {
            var id = legacyId(uid, r.id);
            var existing = db[table].find(function (x) { return x.id === id && x.owner_id === uid; });
            var row = mapRow(r, id);
            if (existing) Object.assign(existing, row);
            else {
              db[table].push(row);
              if (table === 'universes') seedRole(db, uid, { universe_id: id }, row.pos);
              if (table === 'groups' && !isUniverseOwner(db, row.universe_id, uid))
                seedRole(db, uid, { group_id: id }, row.pos);
            }
          });
        }
        up(doc.universes, 'universes', function (r, id) {
          return { id: id, owner_id: uid, name: r.name || '', trashed: !!r.trashed, locked: false, invite_policy: 'inherit',
            collapsed: !!r.collapsed,
            ts: r.ts || 0, org: r.org || '', pos: r.pos || 0, pos_ts: r.posTs || 0, pos_org: r.posOrg || '' };
        });
        up(doc.groups, 'groups', function (r, id) {
          return { id: id, owner_id: uid, universe_id: legacyId(uid, r.uni), name: r.name || '', trashed: !!r.trashed,
            cat_id: r.cat ? legacyId(uid, r.cat) : null, is_cat: !!r.isCat, collapsed: !!r.collapsed,
            locked: false, invite_policy: 'inherit', ts: r.ts || 0, org: r.org || '', pos: r.pos || 0, pos_ts: r.posTs || 0, pos_org: r.posOrg || '' };
        });
        up(doc.cards, 'cards', function (r, id) {
          return { id: id, owner_id: uid, group_id: legacyId(uid, r.group), title: r.title || '', trashed: !!r.trashed,
            locked: false, k: r.k !== false, p: r.p !== false, lab_ts: r.labTs || 0, lab_org: r.labOrg || '',
            responsible: r.responsible || null,
            start_at: r.start || null, due_at: r.due || null, lock_times: !!r.lockTimes,
            collapsed: !!r.collapsed,
            ts: r.ts || 0, org: r.org || '', pos: r.pos || 0, pos_ts: r.posTs || 0, pos_org: r.posOrg || '' };
        });
        up(doc.items, 'items', function (r, id) {
          return { id: id, owner_id: uid, card_id: legacyId(uid, r.home),
            cat_id: r.cat ? legacyId(uid, r.cat) : null, is_cat: !!r.isCat, lock_times: !!r.lockTimes,
            collapsed: !!r.collapsed,
            text: r.text || '', trashed: !!r.trashed,
            done: !!r.done, responsible: r.responsible || null,
            start_at: r.start || null, due_at: r.due || null,
            ts: r.ts || 0, org: r.org || '', pos: r.pos || 0, pos_ts: r.posTs || 0, pos_org: r.posOrg || '' };
        });
        return { universes: (doc.universes || []).length, groups: (doc.groups || []).length,
                 cards: (doc.cards || []).length, items: (doc.items || []).length };
      },
      create_share_invite: function (p) {
        var role = p.p_role || 'member';
        if (['universe', 'group'].indexOf(p.p_type) < 0)
          throw new Error('kun områder og mapper kan deles (fikk: ' + p.p_type + ')');
        if (['member', 'owner'].indexOf(role) < 0) throw new Error('ugyldig rolle: ' + role);
        var em = String(p.p_email).toLowerCase().trim();
        if (em === '' || em.indexOf('@') < 0) throw new Error('ugyldig e-postadresse');
        if (role === 'owner') {
          if (!canInviteOwner(db, p.p_type, p.p_id, uid)) throw new Error('bare eiere kan invitere til eierskap');
        } else if (!canInviteTo(db, p.p_type, p.p_id, uid)) {
          throw new Error('mangler myndighet til å invitere til dette objektet');
        }
        if (em === emailOf(db, uid)) throw new Error('kan ikke dele med deg selv');
        var target = (db.profiles.find(function (x) { return x.email === em; }) || {}).id || null;
        if (target) {
          if (role === 'member' && canReadAny(db, p.p_type, p.p_id, target))
            throw new Error('brukeren har allerede tilgang');
          if (role === 'owner' &&
              ((p.p_type === 'universe' && isUniverseOwner(db, p.p_id, target)) ||
               (p.p_type === 'group' && isGroupOwner(db, p.p_id, target))))
            throw new Error('brukeren er allerede eier');
        }
        var col = p.p_type === 'universe' ? 'universe_id' : 'group_id';
        // Som serveren: en ventende invitasjon oppdateres i stedet for å feile,
        // og rollen kan bare gå OPP (member → owner).
        var dup = db.share_invites.find(function (s) {
          return s.status === 'pending' && String(s.invitee_email).toLowerCase() === em && s[col] === p.p_id;
        });
        if (dup) {
          // Avsenderen overtas bare når kalleren selv er autorisert for rollen
          // invitasjonen ender opp med — `inviter_id` gir rett til å trekke den
          // tilbake, og den retten skal ikke kunne kapres med en
          // medlemsinvitasjon til en ventende eierinvitasjon.
          if (role === 'owner' || dup.role !== 'owner') dup.inviter_id = uid;
          if (role === 'owner') dup.role = 'owner';
          if (target) dup.invitee_id = target;
          return dup;
        }
        var inv = { id: newId('inv'), inviter_id: uid, invitee_email: em, invitee_id: target,
          universe_id: p.p_type === 'universe' ? p.p_id : null,
          group_id: p.p_type === 'group' ? p.p_id : null,
          role: role, status: 'pending', created_at: Date.now() };
        db.share_invites.push(inv);
        return inv;
      },
      accept_share_invite: function (p) {
        var inv = db.share_invites.find(function (s) { return s.id === p.p_invite; });
        if (!inv || inv.status !== 'pending') throw new Error('invitasjonen er ikke lenger åpen');
        var em = emailOf(db, uid);
        if (inv.invitee_id && inv.invitee_id !== uid) throw new Error('invitasjonen er ikke til deg');
        if (!inv.invitee_id && String(inv.invitee_email).toLowerCase() !== String(em).toLowerCase())
          throw new Error('invitasjonen er ikke til deg');
        var role = inv.role || 'member';
        var col = inv.universe_id ? 'universe_id' : 'group_id';
        var targetId = inv.universe_id || inv.group_id;
        var existing = db.memberships.find(function (m) { return m.user_id === uid && m[col] === targetId; });
        var mem;
        if (existing) {
          if (role === 'owner') existing.role = 'owner';
          mem = existing;
        } else {
          mem = { id: newId('mem'), user_id: uid, universe_id: inv.universe_id || null,
            group_id: inv.group_id || null, role: role,
            pos: p.p_pos != null ? p.p_pos : nextPersonalPos(db, uid), created_at: Date.now() };
          db.memberships.push(mem);
        }
        if (inv.universe_id) {
          // Områdemedlemskapet gjør ordinære DIREKTE mappemedlemskap i
          // området redundante; eksplisitte mappeeierroller beholdes.
          var gids = db.groups.filter(function (g) { return g.universe_id === inv.universe_id; })
            .map(function (g) { return g.id; });
          db.memberships = db.memberships.filter(function (m) {
            return !(m.user_id === uid && m.role === 'member' && gids.indexOf(m.group_id) > -1);
          });
        }
        inv.status = 'accepted'; inv.invitee_id = uid;
        return mem;
      },
      decline_share_invite: function (p) {
        var inv = db.share_invites.find(function (s) { return s.id === p.p_invite; });
        if (inv) { inv.status = 'declined'; inv.invitee_id = uid; }
        return null;
      },
      revoke_share_invite: function (p) {
        var inv = db.share_invites.find(function (s) { return s.id === p.p_invite && s.status === 'pending'; });
        if (!inv) throw new Error('fant ingen ventende invitasjon');
        var it = inv.universe_id ? 'universe' : 'group';
        var iid = inv.universe_id || inv.group_id;
        if (inv.inviter_id !== uid && !canManageMembers(db, it, iid, uid))
          throw new Error('mangler myndighet til å trekke tilbake denne invitasjonen');
        inv.status = 'revoked';
        return null;
      },
      revoke_share: function (p) {
        if (['universe', 'group'].indexOf(p.p_type) < 0) throw new Error('ugyldig type: ' + p.p_type);
        if (!canManageMembers(db, p.p_type, p.p_id, uid)) throw new Error('mangler myndighet til å fjerne medlemmer');
        if (p.p_type === 'universe') {
          if (universeRole(db, p.p_id, p.p_user) === null) throw new Error('brukeren er ikke medlem av området');
          if (universeRole(db, p.p_id, p.p_user) === 'owner' && universeOwnerCount(db, p.p_id) <= 1)
            throw new Error('området må ha minst én eier');
          purgeUniverseAccess(db, p.p_id, p.p_user);
        } else {
          if (groupRole(db, p.p_id, p.p_user) === null) {
            if (isGroupMember(db, p.p_id, p.p_user))
              throw new Error('brukeren har tilgang via området og må fjernes der');
            throw new Error('brukeren er ikke medlem av mappen');
          }
          purgeGroupAccess(db, p.p_id, p.p_user);
        }
        return null;
      },
      set_member_role: function (p) {
        if (['universe', 'group'].indexOf(p.p_type) < 0) throw new Error('ugyldig type: ' + p.p_type);
        if (['member', 'owner'].indexOf(p.p_role) < 0) throw new Error('ugyldig rolle: ' + p.p_role);
        if (!canManageMembers(db, p.p_type, p.p_id, uid)) throw new Error('mangler myndighet til å endre roller');
        var cur = p.p_type === 'universe' ? universeRole(db, p.p_id, p.p_user) : groupRole(db, p.p_id, p.p_user);
        if (cur === null) throw new Error('brukeren har ingen rolle her');
        if (p.p_role === 'owner' && cur !== 'owner')
          throw new Error('eierskap gis via en eierskapsinvitasjon mottakeren må godta');
        if (cur === p.p_role) return null;
        if (p.p_type === 'universe') {
          if (universeOwnerCount(db, p.p_id) <= 1) throw new Error('området må ha minst én eier');
          uniMembership(db, p.p_user, p.p_id).role = p.p_role;
        } else if (isUniverseMember(db, groupUniverse(db, p.p_id), p.p_user)) {
          db.memberships = db.memberships.filter(function (m) {
            return !(m.user_id === p.p_user && m.group_id === p.p_id);
          });
        } else {
          grpMembership(db, p.p_user, p.p_id).role = p.p_role;
        }
        return null;
      },
      leave_share: function (p) {
        if (['universe', 'group'].indexOf(p.p_type) < 0) throw new Error('ugyldig type: ' + p.p_type);
        if (p.p_type === 'universe') {
          if (universeRole(db, p.p_id, uid) === null) throw new Error('du er ikke medlem av dette området');
          if (!canLeave(db, 'universe', p.p_id, uid))
            throw new Error('du er siste eier — gi eierskap til noen andre først');
          purgeUniverseAccess(db, p.p_id, uid);
        } else {
          if (!canLeave(db, 'group', p.p_id, uid)) {
            if (isGroupMember(db, p.p_id, uid))
              throw new Error('du har tilgang via området — forlat området i stedet');
            throw new Error('du er ikke medlem av denne mappen');
          }
          purgeGroupAccess(db, p.p_id, uid);
        }
        return null;
      },
      set_locked: function (p) {
        if (['universe', 'group', 'card'].indexOf(p.p_type) < 0) throw new Error('ugyldig type: ' + p.p_type);
        if (!canManageLock(db, p.p_type, p.p_id, uid)) throw new Error('mangler myndighet til å låse/åpne');
        var t = p.p_type === 'universe' ? db.universes : p.p_type === 'group' ? db.groups : db.cards;
        var r = t.find(function (x) { return x.id === p.p_id; });
        if (r) { r.locked = p.p_locked; if (p.p_locked) r.unlocked = false; }
        return null;
      },
      set_unlocked: function (p) {
        if (['universe', 'group', 'card'].indexOf(p.p_type) < 0) throw new Error('ugyldig type: ' + p.p_type);
        if (!canManageLockException(db, p.p_type, p.p_id, uid)) throw new Error('mangler myndighet til å endre unntak');
        var t = p.p_type === 'universe' ? db.universes : p.p_type === 'group' ? db.groups : db.cards;
        var r = t.find(function (x) { return x.id === p.p_id; });
        if (r) { r.unlocked = p.p_unlocked; if (p.p_unlocked) r.locked = false; }
        return null;
      },
      set_invite_policy: function (p) {
        if (['universe', 'group'].indexOf(p.p_type) < 0) throw new Error('ugyldig type: ' + p.p_type);
        if (['inherit', 'allow', 'deny'].indexOf(p.p_policy) < 0) throw new Error('ugyldig policy');
        if (!canManageInvitePolicy(db, p.p_type, p.p_id, uid)) throw new Error('mangler myndighet til å endre invitasjonspolicy');
        var t = p.p_type === 'universe' ? db.universes : db.groups;
        var r = t.find(function (x) { return x.id === p.p_id; });
        if (r) r.invite_policy = p.p_policy;
        return null;
      },
      get_members: function (p) { return getMembers(db, p.p_type, p.p_id, uid); },
      // Sletter kontoen og alle spor av den — speiler public.delete_account()
      // steg for steg (rekkefølgen betyr noe: invitasjonene ryddes FØR
      // områdene, som ellers ville tatt dem med i kaskaden).
      delete_account: function () {
        var me = db.profiles.find(function (x) { return x.id === uid; });
        if (!me) throw new Error('fant ingen profil for kontoen');
        var em = String(me.email).toLowerCase();
        var now = Date.now();
        var heir = function (uni) { return survivingOwner(db, uni, uid); };

        // 1. invitasjoner begge veier (også de som bare er adressert til e-posten)
        db.share_invites = db.share_invites.filter(function (s) {
          return !(s.inviter_id === uid || s.invitee_id === uid ||
                   String(s.invitee_email).toLowerCase() === em);
        });
        // 2. områder jeg er knyttet til som står uten eier etter meg
        db.universes.filter(function (u) {
          return heir(u.id) === null && (u.owner_id === uid || isUniverseMember(db, u.id, uid));
        }).map(function (u) { return u.id; }).forEach(function (id) {
          writeTombstone(db, 'universe', id);
          cascadeDelete(db, 'universe', id);
          db.universes = db.universes.filter(function (x) { return x.id !== id; });
        });
        // 3. oppretter-arv på alt som overlever
        db.universes.forEach(function (u) { if (u.owner_id === uid) u.owner_id = heir(u.id); });
        db.groups.forEach(function (g) { if (g.owner_id === uid) g.owner_id = heir(g.universe_id); });
        db.cards.forEach(function (c) {
          if (c.owner_id === uid) c.owner_id = heir(groupUniverse(db, c.group_id));
        });
        db.items.forEach(function (i) {
          if (i.owner_id !== uid) return;
          var c = findC(db, i.card_id);
          i.owner_id = heir(c ? groupUniverse(db, c.group_id) : null);
        });
        // 4. ansvarstildelinger + rollene mine. Stempelet slår radens EGET
        //    register, ikke bare klokka (som i SQL-en: en rad fra en enhet med
        //    klokka foran serverens ville ellers vunnet LWW-en tilbake).
        var stamp = function (r) { r.ts = Math.max(now, (r.ts || 0) + 1); r.org = 'server'; };
        db.cards.forEach(function (c) {
          if (c.responsible === uid) { c.responsible = null; stamp(c); }
        });
        db.items.forEach(function (i) {
          if (i.responsible === uid) { i.responsible = null; stamp(i); }
        });
        db.memberships = db.memberships.filter(function (m) { return m.user_id !== uid; });
        // 5. profilen og selve kontoen (mocken har ingen auth.users-tabell —
        //    profilen + passordet ER kontoen her)
        db.profiles = db.profiles.filter(function (x) { return x.id !== uid; });
        delete db.passwords[em];
        return null;
      },
      // Den ENESTE veien en mappe bytter område. Samme domene → reparenting;
      // ulikt domene → kopier-og-slett med nye id-er + gravsteiner.
      move_group: function (p) {
        var g = findG(db, p.p_group);
        if (!g) throw new Error('mappen finnes ikke');
        if (g.is_cat) throw new Error('en mappekategori kan ikke flyttes til et annet område');
        if (!findU(db, p.p_universe)) throw new Error('målområdet finnes ikke');
        var cat = p.p_cat || null;
        if (cat) {
          var cg = findG(db, cat);
          if (!cg || !cg.is_cat || cg.universe_id !== p.p_universe)
            throw new Error('ugyldig mappekategori for målområdet');
        }
        var now = Date.now();
        var mapping = {};
        if (g.universe_id === p.p_universe) {
          if (!canReorderInParent(db, 'group', p.p_group, uid))
            throw new Error('mangler myndighet til å endre rekkefølgen i området');
          g.cat_id = cat; g.pos = p.p_pos || 0; g.pos_ts = now; g.pos_org = 'server';
          return { mode: 'reorder', group: p.p_group, mapping: mapping };
        }
        if (!canMoveGroup(db, p.p_group, uid))
          throw new Error('mangler myndighet til å flytte mappen ut av området');
        if (!canCreateChild(db, 'universe', p.p_universe, uid))
          throw new Error('mangler myndighet til å opprette mapper i målområdet');

        if (universeOwnerSet(db, g.universe_id) === universeOwnerSet(db, p.p_universe)) {
          g.universe_id = p.p_universe; g.cat_id = cat;
          g.pos = p.p_pos || 0; g.pos_ts = now; g.pos_org = 'server';
          db.cards.filter(function (c) { return c.group_id === g.id; }).forEach(function (c) {
            if (c.responsible && !isGroupMember(db, g.id, c.responsible)) { c.responsible = null; c.ts = now; c.org = 'server'; }
            db.items.filter(function (i) { return i.card_id === c.id; }).forEach(function (i) {
              if (i.responsible && !isGroupMember(db, g.id, i.responsible)) { i.responsible = null; i.ts = now; i.org = 'server'; }
            });
          });
          return { mode: 'reparent', group: p.p_group, mapping: mapping };
        }

        // Kryssdomene: nytt undertre med nye id-er, aktøren som oppretter/eier,
        // og det gamle treet permanent slettet (gravsteiner) i samme operasjon.
        var newG = newUuid();
        mapping[g.id] = newG;
        db.groups.push({
          id: newG, owner_id: uid, universe_id: p.p_universe, cat_id: cat, is_cat: false,
          name: g.name, trashed: !!g.trashed, locked: !!g.locked, unlocked: !!g.unlocked,
          collapsed: !!g.collapsed, invite_policy: g.invite_policy || 'inherit',
          ts: now, org: 'server', pos: p.p_pos || 0, pos_ts: now, pos_org: 'server',
        });
        if (!isUniverseOwner(db, p.p_universe, uid)) seedRole(db, uid, { group_id: newG }, p.p_pos || 0);
        var srcCards = db.cards.filter(function (c) { return c.group_id === g.id; });
        srcCards.forEach(function (c) {
          var nc = newUuid();
          mapping[c.id] = nc;
          db.cards.push(Object.assign({}, c, {
            id: nc, owner_id: uid, group_id: newG, ts: now, org: 'server',
            lab_ts: now, lab_org: 'server', pos_ts: now, pos_org: 'server',
            responsible: c.responsible && isGroupMember(db, newG, c.responsible) ? c.responsible : null,
          }));
        });
        var srcItems = db.items.filter(function (i) { return mapping[i.card_id]; })
          .slice().sort(function (a, b) { return (b.is_cat ? 1 : 0) - (a.is_cat ? 1 : 0); });
        srcItems.forEach(function (i) {
          var ni = newUuid();
          mapping[i.id] = ni;
          db.items.push(Object.assign({}, i, {
            id: ni, owner_id: uid, card_id: mapping[i.card_id],
            cat_id: i.cat_id ? mapping[i.cat_id] : null,
            ts: now, org: 'server', pos_ts: now, pos_org: 'server',
            responsible: i.responsible && isGroupMember(db, newG, i.responsible) ? i.responsible : null,
          }));
        });
        writeTombstone(db, 'group', g.id);
        cascadeDelete(db, 'group', g.id);
        db.groups = db.groups.filter(function (x) { return x.id !== g.id; });
        return { mode: 'copy', group: newG, mapping: mapping };
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
      // .eq()/.in() kjeder filtre (.in = «kolonnen er én av disse verdiene»,
      // brukt av gravsteins-oppslaget i synken).
      var filters = {};
      var builder = {
        eq: function (col, val) { filters[col] = { op: 'eq', val: val }; return builder; },
        in: function (col, vals) { filters[col] = { op: 'in', val: vals || [] }; return builder; },
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
              var db = loadDB();
              var tomb = tombstoneError(db, table, payload);
              if (tomb) return { data: null, error: tomb };
              var fk = catFkError(db, table, payload);
              if (fk) return { data: null, error: fk };
              applyInsert(db, table, u.id, payload); saveDB(db);
              return { data: null, error: null };
            });
          },
          update: function (payload) {
            return thenable(function (filters) {
              var u = getSess(); if (!u) return { data: null, error: { message: 'ikke innlogget' } };
              var db = loadDB();
              var fk = catFkError(db, table, payload);
              if (fk) return { data: null, error: fk };
              applyUpdate(db, table, u.id, clone(payload), filters); saveDB(db);
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
                return matches(r, filters);
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
