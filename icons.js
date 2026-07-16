/* ============================================================
   Huskis — ikonsett brukt fra app.js (SVG som strenger)
   ------------------------------------------------------------
   Kun ikonene som bygges dynamisk fra JS ligger her (badges, lås-knapp,
   auth-heading, sveipefeltet, søppelkasse-ikonet i element-knappen og
   antall-pillene, tom-tilstander). De rent statiske ikonene (trash/logout/
   globe/share/logo) er limt direkte inn i index.html — se den for resten av
   ikonsettet fra design-handoffen.

   FARGELAGT IKONSETT: alle streker er SVARTE (`stroke="#111"`, konsekvent —
   ikke lenger currentColor), og flater fylles med hvit + appens fargepalett
   der motivet tilsier det (se docs/design-system.md → «Fargelagte ikoner» for
   fargekartet og reglene). Rene funksjons-glyfer på massive fargeknapper
   (avkryssing/utlogging) beholder currentColor. Fyllfargene er hardkodet hex
   fordi de speiler palettens seks første farger (HSL S=20 %, L=60 %): farge 1–6
   = #ad8585 #adad85 #85ad85 #85adad #8585ad #ad85ad; grå (søppel/tannhjul) =
   #c0c4c9. Endrer du palett-konstantene i app.js, oppdater disse tilsvarende.
   Størrelse styres av .icon-klassen i styles.css (width/height: 1em).

   trashSwipe har to bevegelige deler: `.swipe-icon-lid` (lokk+hank) roteres
   separat av app.js sin sveip-for-å-tømme-motor (se attachTrashHold/
   setProgress i app.js og .swipe-icon-lid i styles.css) — resten (kasse-kropp
   + ribbene) er statisk og roterer kun med hele ikonet. ViewBox-en er
   KVADRATISK og senter-symmetrisk rundt kassens midtpunkt (12,12):
   -9.5 -9.5 43 43 — halvbredden (21.5) er ≥ største avstand fra midtpunktet
   til noen del av tegningen i NOEN kombinasjon av helikon-rotasjon (0–180°)
   og lokk-sving (0–-95°), målt til lokktuppen fullt åpen (~21.3). Dermed
   klippes ALDRI noe av kassen/lokket under rotasjon, uansett fase. Endres
   viewBox-en, må .swipe-icon-lid sin transform-origin (32.56 % 39.53 % =
   hengselet 4.5,7.5) i styles.css og SWIPE_ICON_BOX i app.js regnes ut på
   nytt. Ikke fjern `.swipe-icon-lid`-klassen uten å oppdatere setProgress
   tilsvarende.
   ============================================================ */
window.ICONS = {
  trashSwipe: '<svg class="icon swipe-icon" viewBox="-9.5 -9.5 43 43" fill="none" stroke="#111" stroke-width="1.05" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M6.3 7.5l.9 11a2 2 0 0 0 2 1.9h5.6a2 2 0 0 0 2-1.9l.9-11" fill="#c0c4c9" stroke="none"></path>' +
    '<g class="swipe-icon-lid">' +
    '<path d="M4.5 7.5h15"></path>' +
    '<path d="M9.5 7.5V6a2.5 2.5 0 0 1 5 0v1.5"></path>' +
    '</g>' +
    '<path d="M6.3 7.5l.9 11a2 2 0 0 0 2 1.9h5.6a2 2 0 0 0 2-1.9l.9-11"></path>' +
    '<path d="M9.7 11v6"></path>' +
    '<path d="M12 11v6"></path>' +
    '<path d="M14.3 11v6"></path>' +
    '</svg>',

  trash: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="#111" stroke-width="1.05" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M6.3 7.5l.9 11a2 2 0 0 0 2 1.9h5.6a2 2 0 0 0 2-1.9l.9-11" fill="#c0c4c9" stroke="none"></path>' +
    '<path d="M4.5 7.5h15"></path>' +
    '<path d="M9.5 7.5V6a2.5 2.5 0 0 1 5 0v1.5"></path>' +
    '<path d="M6.3 7.5l.9 11a2 2 0 0 0 2 1.9h5.6a2 2 0 0 0 2-1.9l.9-11"></path>' +
    '<path d="M9.7 11v6"></path>' +
    '<path d="M12 11v6"></path>' +
    '<path d="M14.3 11v6"></path>' +
    '</svg>',

  // Globus (univers): de seks feltene i kula fylles med palettens seks første
  // farger. Feltene er skjæringene mellom ekvatorlinja og meridian-vesicaen —
  // tre soner over (venstre halvmåne / midtlinse / høyre halvmåne) og tre under.
  globe: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="#111" stroke-width="1.05" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M3 12A9 9 0 0 1 12 3A14 14 0 0 0 8.2 12Z" fill="#ad8585" stroke="none"></path>' +
    '<path d="M8.2 12A14 14 0 0 1 12 3A14 14 0 0 1 15.8 12Z" fill="#adad85" stroke="none"></path>' +
    '<path d="M15.8 12A14 14 0 0 0 12 3A9 9 0 0 1 21 12Z" fill="#85ad85" stroke="none"></path>' +
    '<path d="M3 12A9 9 0 0 0 12 21A14 14 0 0 1 8.2 12Z" fill="#85adad" stroke="none"></path>' +
    '<path d="M8.2 12A14 14 0 0 0 12 21A14 14 0 0 0 15.8 12Z" fill="#8585ad" stroke="none"></path>' +
    '<path d="M15.8 12A14 14 0 0 1 12 21A9 9 0 0 0 21 12Z" fill="#ad85ad" stroke="none"></path>' +
    '<circle cx="12" cy="12" r="9"></circle>' +
    '<path d="M3 12h18"></path>' +
    '<path d="M12 3a14 14 0 0 1 3.8 9 14 14 0 0 1-3.8 9 14 14 0 0 1-3.8-9A14 14 0 0 1 12 3Z"></path>' +
    '</svg>',

  // Øye (Vis): hornhinnen (mandelen) hvit, pupillen (indre sirkel) svart.
  eye: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="#111" stroke-width="1.05" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" fill="#ffffff"></path>' +
    '<circle cx="12" cy="12" r="3" fill="#111" stroke="none"></circle>' +
    '<circle cx="12" cy="12" r="3"></circle>' +
    '</svg>',

  // Dør + pil inn (logg inn): dørfeltet hvitt, pila svart.
  login: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="#111" stroke-width="1.05" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M15 3h3a2.5 2.5 0 0 1 2.5 2.5v13A2.5 2.5 0 0 1 18 21h-3" fill="#ffffff"></path>' +
    '<path d="M3 12h11"></path>' +
    '<path d="M10.5 8.5 14 12l-3.5 3.5"></path>' +
    '</svg>',

  // Personsiluett (Mine lister): hode + kropp fylt med farge 4 (blågrønn).
  profile: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="#111" stroke-width="1.05" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<circle cx="12" cy="8" r="3.4" fill="#85adad"></circle>' +
    '<path d="M5.5 20a6.5 6.5 0 0 1 13 0" fill="#85adad"></path>' +
    '</svg>',

  // Personsiluett som rekker opp hånden («jeg tar oppgaven») — ansvarsknappen
  // på elementer i delte lister. Samme grunnform som `profile` (hode + skuldre),
  // men med én arm hevet opp til en hånd over hodet — fylt med farge 4.
  handRaise: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="#111" stroke-width="1.05" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<circle cx="10.5" cy="8" r="3.2" fill="#85adad"></circle>' +
    '<path d="M4.7 20a5.9 5.9 0 0 1 11.3-2.4" fill="#85adad"></path>' +
    '<path d="M15.3 14.5 18 8.2"></path>' +
    '<circle cx="18.4" cy="6.7" r="1.3" fill="#85adad"></circle>' +
    '</svg>',

  // Tre personer (Delte lister): hver person (hode + kropp) fylt med farge 1–3.
  // Sidepersonene tegnes FØRST (bak) med en fylt skulder-kuppel hver, så
  // senterpersonen oppå — da får sidene ekte fyll som titter fram på utsidene.
  people: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="#111" stroke-width="1.05" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<circle cx="4.7" cy="10.3" r="1.95" fill="#adad85"></circle>' +
    '<path d="M2.1 17.6a2.6 2.6 0 0 1 5.2 0" fill="#adad85"></path>' +
    '<circle cx="19.3" cy="10.3" r="1.95" fill="#85ad85"></circle>' +
    '<path d="M16.7 17.6a2.6 2.6 0 0 1 5.2 0" fill="#85ad85"></path>' +
    '<circle cx="12" cy="7.8" r="3.1" fill="#ad8585"></circle>' +
    '<path d="M6.7 18.6a5.3 5.2 0 0 1 10.6 0" fill="#ad8585"></path>' +
    '</svg>',

  // Hengelås: LÅST fylles med farge 1, ÅPEN med farge 3; bøyle + nøkkelhull svart.
  lock: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="#111" stroke-width="1.05" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<rect x="4.5" y="10.5" width="15" height="10" rx="2.5" fill="#ad8585"></rect>' +
    '<path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"></path>' +
    '<circle cx="12" cy="14.6" r="1.2" fill="#111" stroke="none"></circle>' +
    '<path d="M12 15.8v1.9"></path>' +
    '</svg>',

  unlock: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="#111" stroke-width="1.05" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<rect x="4.5" y="10.5" width="15" height="10" rx="2.5" fill="#85ad85"></rect>' +
    '<path d="M8 10.5V7.5a4 4 0 0 1 7.6-1.9"></path>' +
    '<circle cx="12" cy="14.6" r="1.2" fill="#111" stroke="none"></circle>' +
    '<path d="M12 15.8v1.9"></path>' +
    '</svg>',

  // Mappe (Gruppe): fylt med farge 2 (den typiske gulaktige mappefargen).
  folder: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="#111" stroke-width="1.05" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M3.5 19V6.5a2 2 0 0 1 2-2h3.3a2 2 0 0 1 1.6.8l1.1 1.5a2 2 0 0 0 1.6.8H19a2 2 0 0 1 2 2V19a2 2 0 0 1-2 2H5.5a2 2 0 0 1-2-2Z" fill="#adad85"></path>' +
    '</svg>',

  // Liste: kortflaten hvit, punkter + linjer svarte.
  list: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="#111" stroke-width="1.05" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<rect x="3" y="3" width="18" height="18" rx="4.5" fill="#ffffff"></rect>' +
    '<circle cx="8" cy="8.5" r="0.7" fill="#111" stroke="none"></circle>' +
    '<circle cx="8" cy="12" r="0.7" fill="#111" stroke="none"></circle>' +
    '<circle cx="8" cy="15.5" r="0.7" fill="#111" stroke="none"></circle>' +
    '<path d="M11.5 8.5h5.5"></path>' +
    '<path d="M11.5 12h5.5"></path>' +
    '<path d="M11.5 15.5h5.5"></path>' +
    '</svg>',

  // Tannhjul (innstillinger): grå RING (annulus, even-odd) — senterhullet er
  // gjennomsiktig, ikke fylt, siden det er hullet i tannhjulet.
  gear: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="#111" stroke-width="1.05" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M5 12a7 7 0 1 0 14 0 7 7 0 1 0 -14 0Z M8.8 12a3.2 3.2 0 1 0 6.4 0 3.2 3.2 0 1 0 -6.4 0Z" fill="#c0c4c9" fill-rule="evenodd" stroke="none"></path>' +
    '<circle cx="12" cy="12" r="7"></circle>' +
    '<circle cx="12" cy="12" r="3.2"></circle>' +
    '<path d="M12 5V2.8"></path><path d="M12 21.2V19"></path>' +
    '<path d="M19 12h2.2"></path><path d="M2.8 12H5"></path>' +
    '<path d="m16.95 7.05 1.56-1.56"></path><path d="m5.49 18.51 1.56-1.56"></path>' +
    '<path d="m16.95 16.95 1.56 1.56"></path><path d="m5.49 5.49 1.56 1.56"></path>' +
    '</svg>',

  // Kalender (starttid): ramme hvit med opphengs-tapper og topplinje.
  calendar: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="#111" stroke-width="1.05" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<rect x="3.5" y="5" width="17" height="16" rx="2.5" fill="#ffffff"></rect>' +
    '<path d="M8 3v4"></path><path d="M16 3v4"></path>' +
    '<path d="M3.5 9.5h17"></path>' +
    '</svg>',

  // Kalender med utropstegn (frist).
  calendarDue: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="#111" stroke-width="1.05" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<rect x="3.5" y="5" width="17" height="16" rx="2.5" fill="#ffffff"></rect>' +
    '<path d="M8 3v4"></path><path d="M16 3v4"></path>' +
    '<path d="M3.5 9.5h17"></path>' +
    '<path d="M12 12v3.4"></path>' +
    '<circle cx="12" cy="18.1" r="0.7" fill="#111" stroke="none"></circle>' +
    '</svg>',

  // Klokke (tidspunkt i dag): urskive hvit, visere svarte.
  clock: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="#111" stroke-width="1.05" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<circle cx="12" cy="12" r="8.5" fill="#ffffff"></circle>' +
    '<path d="M12 7.5V12l3 2.2"></path>' +
    '</svg>',

  // Kategori (venstre klamme rundt en liten liste): brukes i navne-seksjonen i
  // kategoriens innstillingsmodal — svarte streker, ingen egen fyllflate.
  category: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="#111" stroke-width="1.05" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M8.5 4.5H6.5a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2H8.5"></path>' +
    '<circle cx="12.5" cy="8" r="0.8" fill="#111" stroke="none"></circle>' +
    '<path d="M15 8h4.5"></path>' +
    '<circle cx="12.5" cy="12" r="0.8" fill="#111" stroke="none"></circle>' +
    '<path d="M15 12h4.5"></path>' +
    '<circle cx="12.5" cy="16" r="0.8" fill="#111" stroke="none"></circle>' +
    '<path d="M15 16h4.5"></path>' +
    '</svg>',

  // Oppløs kategori: en enkel sirkel med stiplet kant (boble som er i ferd med å
  // briste) — ingen stråler ut fra midten (unngår sol-uttrykket). Ingen fyll.
  bubbleBurst: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="#111" stroke-width="1.05" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<circle cx="12" cy="12" r="8.5" stroke-dasharray="2 4"></circle>' +
    '</svg>',
};
