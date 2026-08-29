/* ============================================================
   Huskis service worker — KUN varsler.

   Den finnes for ÉN grunn: en nettleser kan ikke kjøre en timer når fanen er
   lukket, så den ene veien til et varsel utenfor appen går gjennom Web Push,
   og Web Push krever en service worker. Alt annet den KUNNE gjort, gjør den
   ikke:

     • ingen `fetch`-lytter. Huskis er ikke en PWA, og caching av appens egne
       filer ligger i cache-headerne + build-ID-en i URL-ene
       (docs/auto-update.md). En service worker som svarte på forespørsler
       ville lagt seg MELLOM nettleseren og de headerne, og dermed blitt et
       nytt sted en gammel versjon kunne bli hengende. Uten `fetch`-lytteren
       er appens oppdateringsmodell nøyaktig som før den ble registrert.
     • ingen tilstand, ingen `Cache`, ingen IndexedDB, ingen nettverkskall.
       Den vet ingenting om brukeren og kan derfor ikke lekke noe.

   Kroppen som kommer inn er kryptert ende-til-ende (RFC 8291) og dekrypteres
   av nettleseren før den når hit. Den bærer objektets navn, varseltypen i
   klartekst på brukerens språk og en PEKER (type + id) — aldri en sti, aldri
   et token, aldri noe som gir tilgang til noe. Pekeren er ikke bevis: appen
   slår den opp i sin egen tilstand når den åpnes, og finnes den ikke der,
   skjer ingenting.

   Registreres bare når brukeren har slått på varsler i denne nettleseren.
   Autoritativt: docs/varsler.md.
   ============================================================ */
'use strict';

/* Ta over med det samme. En ny utgave av denne fila skal ikke bli stående og
   vente på at alle faner lukkes — den har ingen tilstand å ta vare på, og en
   gammel utgave som fortsatt håndterer push ville vist gammel oppførsel. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (ev) => ev.waitUntil(self.clients.claim()));

var IKON = 'assets/email/huskis-logo-v1.png';   // appens merke, 192×192

function lesKropp(ev) {
  if (!ev.data) return null;
  try { return ev.data.json(); } catch (e) { return null; }
}

self.addEventListener('push', function (ev) {
  var p = lesKropp(ev) || {};
  /* `userVisibleOnly: true` er et LØFTE til nettleseren: hver push skal bli
     et synlig varsel. Kommer en push uten kropp vi kan lese, holder vi løftet
     med det korteste sanne — ellers straffer nettleseren abonnementet ved å
     vise sitt eget «denne siden ble oppdatert i bakgrunnen». */
  var tittel = p.n || 'Huskis';
  var tekst = p.b || '';
  ev.waitUntil(self.registration.showNotification(tittel, {
    body: tekst,
    icon: IKON,
    badge: IKON,
    // Nøkkelen er varselets logiske identitet: kommer det samme varselet to
    // ganger (to leveringsforsøk), ERSTATTER det seg selv i stedet for å legge
    // seg oppå. Samme regel som den unike nøkkelen i databasen.
    tag: p.k || 'huskis',
    renotify: false,
    data: { objType: p.ot || '', objId: p.oi || '', key: p.k || '' },
  }));
});

self.addEventListener('notificationclick', function (ev) {
  ev.notification.close();
  var d = ev.notification.data || {};
  var scope = self.registration.scope;
  ev.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    .then(function (klienter) {
      /* Er Huskis allerede åpen, skal den brukes — ikke et nytt vindu ved
         siden av det brukeren står i. Fanen får pekeren som en melding og
         navigerer selv, med sin vanlige tilgangskontroll. */
      for (var i = 0; i < klienter.length; i++) {
        var k = klienter[i];
        if (k.url.indexOf(scope) !== 0) continue;
        k.postMessage({ type: 'huskis-notif-open', objType: d.objType, objId: d.objId });
        return 'focus' in k ? k.focus() : undefined;
      }
      // Ingen åpen fane: åpne appen med pekeren i adressen. app.js plukker den
      // opp når den er innlogget og synket, og fjerner den fra adressen.
      var url = scope;
      if (d.objType && d.objId) {
        url += (scope.indexOf('?') > -1 ? '&' : '?') + 'notif=' +
          encodeURIComponent(d.objType + ':' + d.objId);
      }
      return self.clients.openWindow(url);
    }));
});
