# CLAUDE.md — Huskis

Statisk app: **Univers > Gruppe > Liste > Listepunkt**. Universer er helt
uavhengige områder — grupper flyttes aldri på tvers av dem. Ingen byggesteg —
ren `index.html` + `styles.css` + `app.js` (vanilla JS), persistens i
`localStorage` + sanntids-synk via Supabase.

## Kjøre appen

```bash
cd /home/user/huskis
python3 -m http.server 8000
# åpne http://localhost:8000
```

## Dokumentkart — les ved behov, ikke i utgangspunktet

Denne fila lastes hver økt og holdes bevisst kort. Detaljene lever i egne
dokumenter i `docs/` — les det som er relevant for oppgaven, ignorer resten.
Tar du en designbeslutning som bør holde seg for fremtidige agenter,
oppdater det aktuelle dokumentet der (ikke dump alt tilbake i denne fila).

| Fil | Les når oppgaven gjelder |
|---|---|
| `docs/data-model.md` | state-form, foreldre-pekere, univers/gruppe/liste/listepunkt-hierarkiet |
| `docs/design-system.md` | styles.css, nye knapper/kontroller, delte klasser, UX-mønstre |
| `docs/menus.md` | toppmenyen (breadcrumb), univers-/gruppe-modalen, kontoknappen/-modalen |
| `docs/board-layout.md` | avstander/padding/gap i selve listevisningen |
| `docs/drag-and-drop.md` | reorder, dra-og-slipp-motoren, overføring mellom lister/grupper |
| `docs/trash.md` | slette/gjenopprette/tømme på ethvert nivå |
| `docs/colors-and-labels.md` | HSL-fargesystem, Mine/Delte-filter |
| `docs/scheduling.md` | innstillingsmodalen (tannhjul), tidsplan (start/frist), indikator-chips |
| `docs/arkitektur-brukere-deling.md` | brukerkontoer (Supabase Auth), eierskap, deling/mounts, lås, e-postvarsel — databasesiden |
| `docs/accounts.md` | KLIENTEN: auth-UI, synk-motor (get_my_doc/rad-CRUD), mount-rendring, delings-UI, e-postvarsel/innboks, mock-backend for testing |

## Verifisering (påkrevd før du sier deg ferdig)

Verifiser alltid i ekte nettleser (Playwright mot `python3 -m http.server`,
desktop- OG mobil-viewport, blokker eksterne kall for hermetikk) — funksjonelt
(CRUD/DnD/synk/deling/migrering) og visuelt (screenshots). Bruk `?mock=1` (mock-
backend) for å teste innlogging og to-bruker-deling uten ekte Supabase. Ikke
rapporter en oppgave som ferdig uten denne verifiseringen.

## GitHub-arbeidsflyt

- Hand-off-prompter: skriv dem i kopierbart format, og ikke ta med informasjon
  enhver agent uansett har tilgang til (f.eks. det som allerede står i denne
  fila).
- Når en PR er opprettet: send lenken til PR-en.
- Sjekk-inn-timer etter opprettet PR: sett den til maks 5 minutter — det tar
  sjelden lenger før tester er ferdige og reviewere har fått sett på den.

## Arbeidsstil

- Jobb autonomt; ikke still oppfølgingsspørsmål — bruk beste skjønn og
  dokumentér valg i riktig fil (se dokumentkartet over).
- Handle når du har nok informasjon. Ikke utled på nytt fakta som allerede er
  fastslått i samtalen, ikke ta opp igjen en beslutning brukeren allerede har
  tatt, og ikke ramse opp alternativer du uansett ikke velger i brukervendte
  meldinger — gi en anbefaling, ikke en fullstendig oversikt. Gjelder ikke
  tenke-blokker.
- Ikke legg til funksjonalitet, refaktorer eller abstraksjoner utover det
  oppgaven krever. En bugfix trenger ikke opprydding rundt seg, og en
  engangsoperasjon trenger sjelden en hjelpefunksjon. Ikke design for
  hypotetiske fremtidige behov — gjør det enkleste som fungerer godt. Unngå
  prematur abstraksjon og halvferdige implementasjoner. Ikke legg til
  feilhåndtering, fallbacks eller validering for scenarioer som ikke kan
  inntreffe — stol på interne garantier og valider kun ved systemgrenser
  (brukerinput, eksterne API-er). Ikke bruk feature flags eller
  bakoverkompatible snarveier når du bare kan endre koden direkte.
- Stopp opp for brukeren kun når arbeidet faktisk krever det: en destruktiv
  eller irreversibel handling, en reell endring av omfang, eller informasjon
  bare brukeren kan gi. Møter du på et av disse, spør — og avslutt runden der,
  fremfor å avslutte med et løfte om å gjøre det senere.
- Før du rapporterer fremgang: sjekk hver påstand mot et faktisk
  verktøyresultat fra denne økten. Rapporter kun det du har belegg for, og si
  eksplisitt fra om noe ikke er verifisert ennå. Rapporter utfall ærlig: vis
  output hvis tester feiler, si fra hvis et steg ble hoppet over, og si rett ut
  at noe er ferdig og verifisert når det er det — uten unødvendige forbehold.
- Start svaret med resultatet. Første setning skal svare på «hva skjedde» eller
  «hva ble funnet» — det brukeren ville spurt om med «bare gi meg
  kortversjonen». Detaljer og resonnement kommer etterpå.
- Hold svar korte ved å velge bort det som ikke endrer hva leseren gjør videre
  — ikke ved å komprimere teksten til fragmenter, forkortelser, pil-kjeder
  («A → B → feiler») eller sjargong.
- Har du jobbet en stund uten at brukeren har fulgt med (over natten, gjennom
  mange verktøykall, siden de sist sa noe), er sluttmeldingen din deres første
  innblikk i det hele. Skriv den som en re-orientering, ikke en fortsettelse av
  tankestrømmen din: resultatet først, så det ene-to du eventuelt trenger fra
  dem, hver forklart som om det er nytt. Ordbruken du bygde opp underveis er
  din, ikke brukerens — legg den bak deg med mindre du introduserer den på
  nytt.

## Status

Alt i oppgavebeskrivelsen (universer, designsystem, søppelkasser på alle
nivåer, luft-system i board-et, dra-rekkefølge for universer i menyen) er
implementert og verifisert i nettleser — se git-historikk for detaljer.
Designsystemet er senere overhalt (Atkinson Hyperlegible Next, ~30 % større
listepunkter m/ tynnere ikonstreker, felles `.btn-solid`-knappesystem,
prikke-håndtak, delt placeholder-stil, knapp-til-sveipefelt-morf,
slette-animasjon inn i søppelknappen) — se `docs/design-system.md` og
`docs/trash.md`. En påfølgende runde la til: typografi-tokens (`--fs-*`),
avkryssing av listepunkter (`item.done`), angre-toast + delte gjenopprett-hjelpere,
felles bekreftelses-modal (`askConfirm`, erstatter native `confirm()`),
tastatur-reordering på håndtakene, `prefers-reduced-motion`-støtte, delte
`.field`/avatar-klasser, hvit ✕ på fargede flater, og flytting av univers-/
gruppe-deling fra kortene til egne `.share-btn` i menyene (ved «＋ Gruppe» / «＋
Liste»). `item.done` krever en DB-migrering i kontomodus — se `TODO.md`.
Posisjonsbasert farge reindekseres alltid ved omrokkering (ikke bare
add/slett) for grupper, lister og universer — se `docs/drag-and-drop.md`.
En runde la til: **buffret sletting** (`_pendingDelete` + `DELETE_BUFFER_MS`) —
sletting skrives ikke til DB før angre-vinduet utløper, angre er umiddelbart
(`docs/trash.md`); **«Utført»-seksjon** for avkryssede listepunkter (FLIP,
posisjonsminne via uendret `pos`); liste-del-chip og liste-ikon oppdatert;
sveipefeltet sier «Tøm» + pil.

**Navn og ansvarlig** (siste runde): registrering krever fornavn + etternavn
(→ `profiles.display_name`); del-modalen viser initial-sirkel + navn for eier/
medlemmer; listepunkter i delte lister har en **ansvarsknapp** (hånd-opp-ikon →
popover/modal med delegruppen alfabetisk som fargede initial-sirkler + navn →
valgt ansvarlig vises som farget initial-sirkel, `item.responsible`). Krever en
DB-migrering + navne-seed i kontomodus — se `TODO.md`. Se `docs/accounts.md`.

**Brukere og deling**: appen kjører nå KUN på ekte kontoer (Supabase Auth,
e-post/passord) + relasjonelle tabeller med RLS og server-side felt-LWW —
auth-UI (registrering/innlogging/glemt passord), synk-motor (`get_my_doc` →
3-veis fletting → rad-CRUD), mount-rendring av delt innhold, delings-UI
(inviter/medlemmer/lås/innboks), søppel-semantikk for delinger (forlat) og
migreringsflyt. Se `docs/accounts.md` og `docs/arkitektur-brukere-deling.md`.
**Mønster-låsen og synk-doc v1 er fjernet** (setup.sql pensjonerer `lists`-
tabellen + `get_list`/`save_list`). `?mock=1` kjører mot en hermetisk
in-memory-backend for to-bruker-testing.

**E-postvarsel + i-app-varsel ved deling (siste runde)**: mottakeren varsles på
to måter. (1) **I appen**: en rød ring med antall på kontoknappen + en «Invitasjoner»-
innboks i konto-modalen (godta/avslå) — invitasjonen viser inviterendes **navn**
(ikke e-post). (2) **På e-post** (valgfritt, krever konfig): en `share_invites`-
insert-trigger (`send_invite_email`, pg_net → Resend) e-poster mottakeren —
uregistrerte får en `?signup=<e-post>`-lenke som åpner registreringssiden med
e-posten utfylt (invitasjonen kobles på ved registrering); registrerte får en
åpne-appen-lenke, men kun hvis de har e-postvarsel PÅ. Registrerte kan slå
e-postvarsel av/på i konto-modalen (`user_metadata.email_notifications`, standard
PÅ). Krever manuell Supabase-konfig (Resend-nøkkel i `app_config` + pg_net) — se
`TODO.md`. Se `docs/accounts.md`.

**Kategorier (siste runde)**: lister har nå TO nivåer — nivå 1 rommer
ukategoriserte listepunkter OG kategorier (om hverandre, kan omrokkeres), nivå 2 er
listepunktene inne i hver kategori. En kategori lagres SOM et listepunkt (`item.isCat`),
leaf-listepunkter peker på den via `item.cat`; kategorier nøstes aldri. Opprettes
ved **klikk-og-hold** (400 ms) på ＋-knappen (som ellers legger til et listepunkt;
knappen er disablet til feltet har tekst). Dra-og-slipp: listepunkter flyttes mellom
nivå 1 / kategorier / lister (slipp på kategori-overskriften eller blant
listepunktene legger det i kategorien); kategori-håndtak reorderer på nivå 1 med en
rask kollaps-til-overskrift-animasjon under draging + utvidelse ved slipp; slipp
på en annen kategori nøster ikke (vanlig bytte-plass). Kategori-overskriften har
en innstillingsknapp (tannhjul → felles innstillingsmodal, `kind:'category'`,
med tidslås som liste-modalen) og en oppløs-knapp (boble-sprekk-ikon → listepunktene
blir ukategoriserte på samme plass). Kategoriens listepunkter ligger i en innrykket
fordypning («hylle i veggen»); overskriften står på listeflaten over. Krever en DB-migrering i kontomodus (`items.cat_id`/`is_cat`/
`lock_times`) — se `TODO.md`. Se `docs/data-model.md`, `docs/drag-and-drop.md`,
`docs/scheduling.md`, `docs/design-system.md`.

**Hierarkisk deling og lås (siste runde)**: å dele et objekt deler automatisk
*hele* undertreet med de samme folkene, og delings-listen viser nå de arvede
personene («Arvet fra deling over», `refreshInherited`) sammen med de direkte.
Man kan dele lenger ned med FLERE (additivt — egen invitasjon på gruppen/listen).
Lås arves nedover, MEN eieren kan gjøre et **unntak** for en konkret gruppe/liste
under et låst objekt («Gjør unntak» → `set_unlocked`/`unlocked`): lås-feltet viser
da «Automatisk låst … Fordi [ikon][navn] er låst». `frozen()`/`can_edit_*` bruker
nærmeste-eksplisitt-tilstand oppover. Krever DB-migrering i kontomodus
(`unlocked`-kolonner + `set_unlocked`) — se `TODO.md`. Se
`docs/arkitektur-brukere-deling.md` og `docs/accounts.md`.

**Innstillinger + tidsplan (forrige runde)**: tannhjul-knapper på lister
(erstattet del-knappen) og listepunkter (erstattet ansvarsknappen) åpner en
felles innstillingsmodal (navn / deling (lister) / ansvarlig — nå også for
hele listen, `card.responsible` / tidsplan). Tidsplan: `start`/`due` på
begge nivåer + `card.lockTimes`; indikator-chips under navnet (delt/
ansvarlig/start/frist, farge etter status) som selv er hurtigredigerings-
knapper. Krever DB-migrering i kontomodus — se `TODO.md`. Alt i
`docs/scheduling.md`.

**Ventefri UX**: all blokkerende venting/lasteindikatorer er
erstattet med optimistisk UI + en seriell bakgrunns-operasjonskø for delings-
RPC-ene (`opQueue`: koalescering, venting på nypushede rader, offline-retry,
rollback ved avvisning) og optimistiske overlays som overlever synk-rebuilds.
Ansvarlig kan byttes fritt mens forrige valg er i lufta (LWW tar siste), søppel
kan gjenopprettes/tømmes UNDER buffring, og del-modalen åpner umiddelbart. Se
`docs/accounts.md` (opQueue) og `docs/trash.md`.

**Trykk-og-hold-draging (siste runde)**: alle dra-håndtak er FJERNET. Draging
inviteres nå ved å trykke og holde (200 ms) på et objekts navn-/tittelsone —
ikke på knappene: univers-/gruppe-rad = hele chip-en unntatt ×; liste = hele
korthodet unntatt tannhjul + ×; listepunkt = hele raden unntatt avmerkingsboks +
tannhjul + ×; kategori = hele overskriftslinjen unntatt tannhjul + oppløs.
Felles `attachHoldDrag`-hjelper (syntetisk pointer-event → de eksisterende
`startXxxDrag`); et kort trykk gjør fortsatt det klikket pleide (omdøp/bytt/
kryss), et fullført hold undertrykker det påfølgende klikket. Bevegelse >10 px
før holdet er ferdig = scroll/sveip (avbrytes, siden scroller nativt); native
scroll blokkeres kun MENS draget pågår. **Tastatur-reordering er fjernet** (den
bodde på håndtakene). Ingen DB-migrering. Se `docs/drag-and-drop.md`.

**Ny navigasjon (forrige runde)**: gruppemenyen (sidebar/topp-panel), listemeny-
overskriften, univers-/gruppebytterne og meny-modalen (☰) er erstattet av én
**toppmeny med breadcrumb** (🌐 univers › 📁 gruppe — knappene åpner hver sin
modal der ALT av navigering/redigering/deling for nivået skjer: «Du er i»-blokk
med del-knapp, alle rader m/ omdøp/slett/rekkefølge, ＋ og søppelkasse) +
listefunksjonene (＋ Liste/søppel/filter) på raden under. Del-modalen har
tilbakeknapp når den åpnes derfra (lukk = hovedsiden). ☰ er blitt en
**kontoknapp** → konto-modal (profil, endre navn (profiles.display_name) og
e-post (auth.updateUser), e-postvarsel, innboks, logg ut — ingen DB-migrering
nødvendig). Lister flyttes mellom grupper ved å slippe dem på 📁-breadcrumben
(velger-modal). Se `docs/menus.md`.

**Listekollaps, global DnD-rotasjon, desktop-drag + fikser (siste runde)**:
Lister kan **kollapses** som en rullgardin (klikk på korthodet, ikke tittel/
tannhjul/×); `.card-body`-wrapper animeres til høyde 0 (kortet blir header-høyt,
alle hjørner rundet), lukketilstanden `card.collapsed` lagres i DB (innholds-
register, ny `cards.collapsed`-kolonne — se `TODO.md`). Alle lister kollapser
midlertidig mens en liste dras (kortere dra-avstand). **DnD-rotasjonen gjelder nå
globalt** — også listepunkter og kategorier roterer (før bare kort/gruppe/
univers). **Desktop-drag** starter umiddelbart på musebevegelse (0 ms; touch
beholder 200 ms-holdet); listepunkt-/kategori-dra-soner får åpen-hånd-cursor,
univers/gruppe/liste pekende hånd. Fikser: univers-/gruppe-modalene redigerer
navnet på tittel-klikk (navigerer ved klikk ellers); listepunkter redigeres kun
på tittelen (som andre typer) med global hover-affordans; symmetrisk padding på
univers-/gruppe-chips. **«Elementer» heter nå «listepunkter»** i UI og
dokumentasjon (kode-identifikatorer som `item`/`items` og DOM-«element» i
kommentarer er urørt — nettopp for å skille brukerbegrepet fra det tekniske).
Se `docs/drag-and-drop.md`, `docs/design-system.md`, `docs/data-model.md`,
`docs/menus.md`.

**DnD-fikser: kategori-utseende, auto-scroll, mobil-kollaps (siste runde)**: (1)
Løftet kategori (`.category.dragging`) leser nå som en kompakt rad, ikke et stort
felt — kategori-ikon (`.cat-drag-icon`) til venstre for tittelen, svart tittel
uten skygge (var hvit-på-hvit), tannhjul/oppløs + skillelinjer skjult, høyde =
et listepunkt (`collapseCategory` måler headeren med `offsetHeight` så dra-
rotasjonen ikke blåser opp placeholderen). (2) Auto-scroll ved viewport-kanten
gjelder nå listepunkter og kategorier, ikke bare lister (`windowScrollDrag()` +
`reapplyPlacement`); kategoriens `grabY` måles fra `.cat-head`. (3) Mobil: å
løfte en liste (særlig den NEDERSTE) under en HØY liste som kollapser krympet
board-et under scroll-posisjonen → nettleseren tvang en window-scroll, og en
scroll mens fingeren står stille avbryter touch-en på Chrome for Android (markert
tekst). Nå UTSETTES liste-kollapsen på touch til første faktiske bevegelse
(`drag.pendingCollapse` → `onCardMove`), så scrollen skjer mens et touchmove fyrer
(draget «etablert») i stedet for under et stille hold; `beginDragCommon` måler
dra-boksen med transformen nøytralisert (så `.drag-hold`-trykkskalaen ikke gir en
for lav placeholder → 10 px scroll-klemme); `overflowAnchor='none'` + en passiv
`scroll`-lytter holder kortet under fingeren uten at VI scroller. Mus kollapser
umiddelbart (uendret desktop). Ingen DB-migrering. Se `docs/drag-and-drop.md` og
`docs/design-system.md`. **(Punkt 3 er senere erstattet — se neste avsnitt: den
utsatte kollapsen løste IKKE avbruddet, den bare gjorde det mindre konsekvent.)**

**DnD på touch: ingen kollaps av dokumentflyten + ekte `pointercancel`-rollback
(siste runde)**: den utsatte liste-kollapsen over løste ikke mobil-avbruddet — en
finger beveger seg lett > 2 px straks etter løftet, så den samme layout-krympingen
skjedde fortsatt helt i starten av draget, og Android Chromes scroll-klemme mot en
raskt synkende maks-scroll avbrøt touch-en (`pointercancel`). **Nå kollapser vi
IKKE i det hele tatt på touch/pen** (verken den dratte lista eller de andre;
placeholderen beholder full høyde) — `collapseCardsForDrag` gates på
`ev.pointerType === 'mouse'` i `startCardDrag`, og `drag.pendingCollapse` er borte.
Dokumenthøyden reduseres dermed aldri mens touch-pekeren er aktiv, så klemmen kan
ikke oppstå; auto-scroll dekker de lengre dra-avstandene. Mus beholder den kompakte
kollapsen uendret. I tillegg: **`pointercancel` er skilt fra et normalt slipp** —
tidligere delte det handler med `pointerup` (`onCardUp`) og fullførte/lagret droppet;
nå fører egne `onCardCancel`/`onItemCancel`/`onCategoryCancel`/`cancelColumnDrop`
elementet tilbake til opprinnelig slot (`restoreDraggedToOrigin`, origin registrert i
`beginDragCommon`) uten å beregne `pos`, stampe, reindeksere farge, kalle `save`
eller åpne flyttevelgeren. Ingen DB-migrering. Se `docs/drag-and-drop.md`.

Verifisert i nettleser (Playwright) mot en hermetisk in-memory-backend
(`mock-backend.js`, aktiveres med `?mock=1`) som etterligner Supabase-
klienten og deler «server» mellom faner via localStorage — kjør to faner for
å teste deling mellom to brukere uten ekte backend/e-postbekreftelse.
`&lag=800` gir kunstig serverforsinkelse for å teste kø-/optimisme-oppførselen.
