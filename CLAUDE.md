# CLAUDE.md — Arbeidsdokument

Personlig arbeidsnotat for utvikling av **Huskeliste-appen**. Oppdateres underveis.

## Mål (fra oppgaven)

En app med to faner: **Huskelister** og **Handlelister**. De fungerer helt likt.

I hver fane:
- Legge til / slette / redigere / endre rekkefølge på **kategorier**.
- Hver kategori er sitt eget **kort**.
- Kortene vises **kolonnevis** (masonry-aktig) slik at man ser flest mulig kort samtidig.
- Endre rekkefølge på kort via **dra-og-slipp** med håndtak:
  - Når man tar tak i et kort løftes det opp og følger musepekeren.
  - En **placeholder** vises der kortet var.
  - Når dra-kortets **øvre kant** passerer **nederste femtedel** av et annet kort, bytter de plass;
    det andre kortet flyttes, og en ny placeholder avdekkes der dra-kortet vil lande.
  - Tilsvarende oppover og nedover.
  - Kort kan bytte plass **på tvers av kolonner**.
- Endre **navn** på kategori ved å klikke på tittelen.

Inne i kortene:
- Legge til / slette / redigere / endre rekkefølge på **elementer**.
- Samme dra-og-slipp-oppførsel.
- Elementer kan **overføres mellom kategorier**.

Design:
- Fint, ryddig, oversiktlig, brukervennlig UI. Responsivt (desktop + mobil).
- **Quicksand**-fonten (Google Fonts) på alt.
- Kortene har **ulike, tilfeldige farger** fra en **pen fargepalett** for visuell separasjon.

## Valgt arkitektur

- **Ren statisk app**: `index.html` + `styles.css` + `app.js`. Ingen byggesteg, ingen rammeverk.
  - Enkelt å kjøre (`python3 -m http.server`) og enkelt å deploye hvor som helst.
- **Vanilla JS** med egen dra-og-slipp-motor bygget på **Pointer Events** (fungerer likt for mus og touch).
  - Egen motor fordi kravene (øvre kant vs. nederste femtedel, kryss-kolonne, placeholder) er svært spesifikke.
- **Persistens** i `localStorage`.
- **Datamodell**:
  ```js
  state = {
    activeTab: 'huskelister' | 'handlelister',
    tabs: {
      huskelister: { cards: [ { id, title, color, items: [ { id, text } ] } ] },
      handlelister: { cards: [ ... ] }
    }
  }
  ```

## Dra-og-slipp-logikk (kjernen)

Felles treffdeteksjon for både kort og elementer:
- Kandidatpunkt = (pekerX, dra-elementets øvre kant Y).
- Finn kortet/elementet punktet er **inni**.
  - Er punktet i **nederste femtedel** (y ≥ topp + 0.8·høyde) → placeholder **etter** det (dra-elementet lander under).
  - Er punktet i **øverste femtedel** (y ≤ topp + 0.2·høyde) → placeholder **før** det.
  - Midtsonen (60 %) er en **dødsone** som hindrer flimring (hysterese).
- Fallback når punktet ikke er inni noe kort: velg kolonne ut fra X, deretter nærmeste vertikale gap;
  ellers nærmeste kort totalt.
- Kort-DnD reflower automatisk fordi layouten er `CSS multi-column` og rekkefølgen bestemmes av DOM-rekkefølge.
- Element-DnD er scoped til `.items-container`, men treffdeteksjon går på tvers av alle kort → overføring mellom kategorier.
- Under draging manipuleres DOM direkte (for ytelse); state bygges opp igjen fra DOM ved slipp, så re-render.

## Fargepalett

Myke, harmoniske pastellfarger. Mørk tekst (`#37343f`) for god kontrast. Header-farge = litt mørkere
variant av kortfargen (via `darken()`). Farge lagres per kort så den er stabil, og velges tilfeldig men
unngår å gjenta forrige korts farge.

## Status / TODO

- [x] Prosjektoppsett + CLAUDE.md
- [x] HTML-skjelett + faner
- [x] CSS (responsivt, Quicksand, palett, kolonner)
- [x] State + persistens
- [x] Render av kort og elementer
- [x] Klikk-for-å-redigere tittel og elementer
- [x] Legg til / slett kategori og element
- [x] Dra-og-slipp for kort (kryss-kolonne, placeholder, femtedel-terskel)
- [x] Dra-og-slipp for elementer (inkl. overføring mellom kort)
- [x] Testet i nettleser (Playwright) — kort-reorder, element-reorder, element-overføring
- [x] Mobiltilpasning (touch-action, responsiv layout)

## Hvordan kjøre

```bash
cd /home/user/huskeliste
python3 -m http.server 8000
# åpne http://localhost:8000
```

## Notater / beslutninger

- Håndtak (`.drag-handle`) har `touch-action: none` så draging ikke scroller siden på mobil.
- Draging starter kun fra håndtaket; klikk på tittel/element-tekst redigerer i stedet.
- `pointercapture` brukes så draging ikke mister eventer.
