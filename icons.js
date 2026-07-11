/* ============================================================
   Huskekurv — ikonsett brukt fra app.js (SVG som strenger)
   ------------------------------------------------------------
   Kun ikonene som bygges dynamisk fra JS ligger her (badges, lås-knapp,
   auth-heading, sveipefeltet, søppelkasse-ikonet i element-knappen og
   antall-pillene, tom-tilstander). De rent statiske ikonene (trash/logout/
   globe/share/logo) er limt direkte inn i index.html — se den for resten av
   ikonsettet fra design-handoffen.

   Alle ikoner: stroke="currentColor" (arver farge fra `color` på forelder,
   samme mønster som --ink-soft/grønn-bruk i knapper), stroke-width 1.05,
   viewBox 0 0 24 24. Størrelse styres av .icon-klassen i styles.css
   (width/height: 1em) — sett font-size på elementet ikonet limes inn i for
   å skalere det, akkurat som emoji-glyfene de erstatter.

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
  trashSwipe: '<svg class="icon swipe-icon" viewBox="-9.5 -9.5 43 43" fill="none" stroke="currentColor" stroke-width="1.05" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<g class="swipe-icon-lid">' +
    '<path d="M4.5 7.5h15"></path>' +
    '<path d="M9.5 7.5V6a2.5 2.5 0 0 1 5 0v1.5"></path>' +
    '</g>' +
    '<path d="M6.3 7.5l.9 11a2 2 0 0 0 2 1.9h5.6a2 2 0 0 0 2-1.9l.9-11"></path>' +
    '<path d="M9.7 11v6"></path>' +
    '<path d="M12 11v6"></path>' +
    '<path d="M14.3 11v6"></path>' +
    '</svg>',

  trash: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.05" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M4.5 7.5h15"></path>' +
    '<path d="M9.5 7.5V6a2.5 2.5 0 0 1 5 0v1.5"></path>' +
    '<path d="M6.3 7.5l.9 11a2 2 0 0 0 2 1.9h5.6a2 2 0 0 0 2-1.9l.9-11"></path>' +
    '<path d="M9.7 11v6"></path>' +
    '<path d="M12 11v6"></path>' +
    '<path d="M14.3 11v6"></path>' +
    '</svg>',

  globe: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.05" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<circle cx="12" cy="12" r="9"></circle>' +
    '<path d="M3 12h18"></path>' +
    '<path d="M12 3a14 14 0 0 1 3.8 9 14 14 0 0 1-3.8 9 14 14 0 0 1-3.8-9A14 14 0 0 1 12 3Z"></path>' +
    '</svg>',

  eye: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.05" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"></path>' +
    '<circle cx="12" cy="12" r="3"></circle>' +
    '</svg>',

  login: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.05" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M15 3h3a2.5 2.5 0 0 1 2.5 2.5v13A2.5 2.5 0 0 1 18 21h-3"></path>' +
    '<path d="M3 12h11"></path>' +
    '<path d="M10.5 8.5 14 12l-3.5 3.5"></path>' +
    '</svg>',

  profile: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.05" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<circle cx="12" cy="8" r="3.4"></circle>' +
    '<path d="M5.5 20a6.5 6.5 0 0 1 13 0"></path>' +
    '</svg>',

  people: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.05" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<circle cx="12" cy="7.8" r="3.1"></circle>' +
    '<path d="M6.7 18.6a5.3 5.2 0 0 1 10.6 0"></path>' +
    '<circle cx="4.7" cy="10.3" r="1.95"></circle>' +
    '<path d="M1.8 18a3.3 3.2 0 0 1 3.3-2.7"></path>' +
    '<circle cx="19.3" cy="10.3" r="1.95"></circle>' +
    '<path d="M22.2 18a3.3 3.2 0 0 0-3.3-2.7"></path>' +
    '</svg>',

  lock: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.05" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<rect x="4.5" y="10.5" width="15" height="10" rx="2.5"></rect>' +
    '<path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"></path>' +
    '<circle cx="12" cy="14.6" r="1.2"></circle>' +
    '<path d="M12 15.8v1.9"></path>' +
    '</svg>',

  unlock: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.05" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<rect x="4.5" y="10.5" width="15" height="10" rx="2.5"></rect>' +
    '<path d="M8 10.5V7.5a4 4 0 0 1 7.6-1.9"></path>' +
    '<circle cx="12" cy="14.6" r="1.2"></circle>' +
    '<path d="M12 15.8v1.9"></path>' +
    '</svg>',

  folder: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.05" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M3.5 19V6.5a2 2 0 0 1 2-2h3.3a2 2 0 0 1 1.6.8l1.1 1.5a2 2 0 0 0 1.6.8H19a2 2 0 0 1 2 2V19a2 2 0 0 1-2 2H5.5a2 2 0 0 1-2-2Z"></path>' +
    '</svg>',

  list: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.05" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<rect x="3" y="3" width="18" height="18" rx="4.5"></rect>' +
    '<circle cx="8" cy="8.5" r="1.05"></circle>' +
    '<circle cx="8" cy="12" r="1.05"></circle>' +
    '<circle cx="8" cy="15.5" r="1.05"></circle>' +
    '<path d="M11.5 8.5h5.5"></path>' +
    '<path d="M11.5 12h5.5"></path>' +
    '<path d="M11.5 15.5h5.5"></path>' +
    '</svg>',
};
