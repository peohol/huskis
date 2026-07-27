# CLAUDE.md — Huskis

Statisk app: **Univers > Gruppe > Liste > Listepunkt**. De to øverste nivåene
speiler de to nederste: et univers ER et kort og en gruppe ER en rad, med samme
design og samme dra-og-slipp-motor (grupper kan flyttes mellom universer). Ingen
byggesteg — ren `index.html` + `styles.css` + `app.js` (vanilla JS), persistens i
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
| `docs/menus.md` | toppmenyens nav-knapp, navigasjonsmodalen (universer + grupper), kontoknappen/-modalen |
| `docs/board-layout.md` | avstander/padding/gap i selve listevisningen |
| `docs/drag-and-drop.md` | reorder, dra-og-slipp-motoren, overføring mellom lister/grupper |
| `docs/trash.md` | slette/gjenopprette/tømme på ethvert nivå |
| `docs/colors-and-labels.md` | HSL-fargesystem, Mine/Delte-filter |
| `docs/scheduling.md` | innstillingsmodalen (tannhjul), tidsplan (start/frist), indikator-chips |
| `docs/rettigheter-og-deling.md` | HVEM får gjøre HVA: oppretter/eier-hierarki, arvet lås + unntak, posisjon-vs-innhold, tretilstands invitasjonspolicy — den autoritative rettighetsmodellen |
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
tastatur-reordering på håndtakene (SENERE FJERNET sammen med håndtakene — se
«Trykk-og-hold-draging» under og `docs/drag-and-drop.md`),
`prefers-reduced-motion`-støtte, delte
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
med den gule kategori-knappen nederst i lista (se «Opprettelse …» nederst).
Dra-og-slipp: listepunkter flyttes mellom
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

**DnD på touch: normal-flow-vakt rundt board-et + auto-scroll-fortegnsklemme
(siste runde)**: forrige runde beholdt kollaps-alle på touch ved å pinne `<html>`
sin `min-height` (dokumenthøyde-lås). Det holdt DOKUMENTET høyt mens BOARD-et
krympet — og introduserte en NY feil: auto-scrollens `maxScroll` (målt fra board-
bunnen) kunne havne UNDER `scrollY`, så `maxScroll - scrollY` ble negativ og en
positiv nedover-`autoScrollSpeed` snudde til et stort hopp OPPOVER i én frame (kunne
utløse `pointercancel`). **To endringer:** (1) **Auto-scroll kan aldri bytte fortegn**
— nedover-avstanden klemmes til `Math.min(delta, Math.max(0, maxScroll - scrollY))`,
så en positiv fart aldri reduserer `scrollY` (nedover-scroll STOPPER i stedet for å
snu). (2) **`<html>`-låsen erstattet av en normal-flow-vakt rundt board-et**
(`freezeBoardForDrag`/`releaseBoardAfterDrag`): fryser `board.style.minHeight` til
høyden før kollaps (board-bunnen + dermed dokumenthøyde/`maxScroll` kan ikke synke),
og legger på `padding-top` = body-høyden som fjernes for listene OVER den dratte, så
den dratte lista beholder viewport-Y og de kompakte overskriftene bunkes rett over
den — nær fingeren, ikke rullet vekk (board bruker multi-column → `padding-top`, ikke
et spacer-barn). Touch kollapser MOMENTANT (`collapseCardsForDrag(…, true)`) i samme
oppgave, så ingen mellomtilstand males. Vakten slippes i `onCardUp`/`onCardCancel`
momentant rett etter `restoreCardsAfterDrag` (én reflow, intet hopp). Mus uendret fra
main (bare kollaps, siden justerer scroll naturlig, ingen vakt).
`lockDocHeight`/`unlockDocHeight`/`drag.pendingCollapse` er borte. **`pointercancel`-
rollbacken fra forrige runde er uendret** (`onCardCancel` m.fl. → `restoreDraggedToOrigin`,
ingen `pos`/`save`). Ingen DB-migrering. Se `docs/drag-and-drop.md`.

**Momentan liste-kollaps + scroll-til-slupt-liste (siste runde)**: (1) All
åpne/lukke-animasjon for lister er FJERNET — `collapseCardBody`/`expandCardBody` setter/
fjerner bare høyde/opacity/padding momentant (gjelder både rullgardinen (klikk på
korthodet) og kollaps-alle under DnD, mobil OG desktop). Animasjonen gjorde systemet
tregere uten å tilføre klarhet; `CARD_COLLAPSE_MS` er borte. Board-vaktens release ble
dermed også momentan (ingen `padding`-transition/`transitionend`). (2) Etter et fullført
liste-drag scroller siden til den slupne lista (`scrollDroppedIntoView`, `onCardUp`):
toppen legges like under den faste toppmenyen (smooth; `auto` ved reduced-motion), målt i
dokument-koordinat før fly-inn-transformen. Hoppes over ved slipp på 📁-breadcrumben.
Ingen DB-migrering. Se `docs/drag-and-drop.md` og `docs/design-system.md`.

**DnD-modus følger board-layouten, ikke `pointerType` (siste runde)**: normal-flow-
vakten (`freezeBoardForDrag`) aktiveres nå KUN når input er touch/pen OG board-et er i
ÉNKOLONNE-layout. Før var skillet bare `ev.pointerType !== 'mouse'`, så Androids «Side
for datamaskin» (flerkolonne + touch) fikk vakten og en stor, stygg `padding-top` der
overskriftene flokket seg rundt den dratte lista. Nå: **flerkolonne** (bredt vindu,
uansett mus/touch/pen) → desktop-oppførsel som main (bare kollaps, board krymper naturlig,
ingen vakt); **énkolonne + touch/pen** → vakt (mobil-fiksen); **énkolonne + mus** → ingen
vakt. Kilde til sannhet = CSS-layouten: `--mobile-dnd-flow-guard` settes til `1` KUN i
mobil-media-regelen (`column-count: 1`) og leses av `boardUsesSingleColumnLayout()`, så
terskelen finnes ett sted (`styles.css`). Ingen UA-/enhets-/`maxTouchPoints`-sniffing.
Beslutningen lagres implisitt via `boardGuard`. De andre PR-endringene (momentan kollaps,
`pointercancel`-rollback, auto-scroll-fortegnsklemme, scroll-til-slupt-liste) er uendret.
Ny test `tests/dnd-layout-modes.test.js` (bl.a. bred touch = flerkolonne → ingen vakt,
ekte `page.mouse`, layoutgrensen 560/561 px). Ingen DB-migrering. Se `docs/drag-and-drop.md`.

**Hierarkiske rettigheter (siste runde)**: autorisasjonen er generalisert fra
«kun eieren» til et **oppretter/eier-hierarki** — se `docs/rettigheter-og-deling.md`
(ny, autoritativ). En **privilegert administrator** av et objekt = universeieren
+ objektets oppretter (`owner_id`) + oppretteren av hvert superobjekt; disse kan
alltid redigere/dele/låse, også under en lås. Redigeringslås arves med
nærmeste-eksplisitt-semantikk; **unntak** fra en arvet lås styres kun av
universeieren eller oppretteren av det låsende superobjektet (`set_unlocked` →
`can_manage_lock_exception`). **Posisjon er skilt fra innholdslås**
(`can_reorder_in_parent` = innholdsrett på superobjektet) og håndheves feltspesifikt
i `*_before_update`-vaktene. **Invitasjonsrett** har fått en **tretilstands dynamisk
arv** (`invite_policy` = `inherit`/`allow`/`deny`): vanlige medlemmer kan invitere
når effektiv policy tillater det (`can_invite_to`), styrt av en avmerkingsboks under
e-postfeltet (`set_invite_policy`, kun interaktiv for `can_manage_invite_policy`).
Alt håndheves serverside (RLS + vakter + SECURITY DEFINER-hjelpere); klienten
gate-r kontroller via `get_members.viewer`-flagg + lokalt anslag. Krever en DB-
migrering i kontomodus (`invite_policy`-kolonner + omskrevne funksjoner) — se
`TODO.md`. Ny SQL-test `supabase/tests/test-permissions.sql` (fire brukere) og
nettlesertest `tests/permissions-ui.test.js` (mock, desktop + mobil).

**Kategori-/listepunkt-ekstrahering + kategori-kollaps (siste runde)**: (1) Drar
man en **kategori** eller et **listepunkt** UT av listene og holder det i board-
luften (over/under/mellom dem), dukker en kort-formet placeholder med et **＋-ikon**
opp (`.new-list-placeholder`) — slipp der oppretter en NY liste: kategori →
samme tittel + medlemmene ukategorisert; listepunkt → bare seg selv med blank,
straks-fokusert tittel. Den som ekstraherer blir **oppretter** (`owner_id`) av
den nye lista, uansett hvem som eide kilde-lista. Umulig fra en LÅST liste (draget
er da avskrudd). `drag.phMode` (`reorder`/`extract`) + `pointerOverAnyCard` styrer
modus; `setExtractMode`/`setReorderMode` bytter placeholder. (2) Kategorier kan nå
**kollapses** som lister (klikk på overskriftslinjen, `item.collapsed`, momentan
`collapseCatBody`); en **grønn ＋-knapp nederst i kategorien** legger til et nytt
(tomt, straks-fokusert) listepunkt direkte i den (ingen «Legg til …»-input). (3)
En **kollapset liste/kategori viser antall listepunkter «(N)»** ved navnet
(`.collapse-count`; liste = alle leaf-elementer, kategorier ikke medregnet;
kategori = dens medlemmer). Krever en DB-migrering i kontomodus (`items.collapsed`)
— se `TODO.md`. Se `docs/drag-and-drop.md`, `docs/data-model.md`,
`docs/design-system.md`.

**Synk-herding: migrering-følger-deploy + skjema-varsel (siste runde)**: en
kontomodus-synkfeil (listepunkter lagt inn på mobil dukket ikke opp på PC) skyldtes
at `cards.collapsed`/`items.collapsed` manglet i produksjon mens den deployede
klienten sendte `collapsed` i hver kort-/listepunkt-skriving — PostgREST avviste
alle, og `pushOps` svelget feilen stille. Migreringen er kjørt (kolonnene finnes nå),
og to grep hindrer gjentakelse: (1) **`db-setup.yml` kjøres automatisk ved push til
`main`** (path-filtrert til SQL-filene) så en migrering ikke lenger kan henge etter
klienten; (2) **klienten overflater skjema-avvik** — `pushOps` leser `result.error`,
og `isSchemaMismatch`/`reportWriteResult` fanger KUN ukjent-kolonne/-tabell
(`PGRST204`/`PGRST205`/`42703`) med én bruker-toast + `console.error` (dedup), mens
forventede RLS-/nettverksfeil forblir stille. Ny test `tests/sync-schema-error.test.js`.
Ingen DB-migrering (kun kjøring av en allerede-eksisterende). Se `docs/accounts.md` og `TODO.md`.

**Peek-åpning av kollapsede dra-mål + kategori-til-annen-liste (siste runde)**: drar
man et **listepunkt** over en KOLLAPSET liste/kategori — eller en hel **kategori** over
en kollapset liste — og blir værende i **200 ms** (`PEEK_MS`), åpnes målet MIDLERTIDIG
(`updatePeek`, peek) så man ser hvor det vil lande; flytter man videre uten å slippe,
kollapses det tilbake. Peek er ren forhåndsvisning (rører ikke `card.collapsed`/
`item.collapsed`); to lag (`drag.peekCard` + `drag.peekCat`) åpner «listen OG/ELLER
kategorien». En **stabilitets-vakt** (`commit`-param i `updateItemPlacement`/
`updateCategoryPlacement`) holder placeholderen i ro mens et ennå-ikke-åpnet kollapset
mål hoveres (ellers krymper kildekortet og målet stikker vekk under pekeren → timeren
rakk aldri å løpe ut); ved selve slippet lander objektet i målet uansett. Slipp INN i et
peek-åpnet mål holder det åpent (`resolvePeekOnDrop`, `collapsed=false` lagres); ellers
kollapses det tilbake. **Ny kapasitet:** en kategori kan nå dras INN i en annen
eksisterende liste (`moveCategoryToCard` — kategori + medlemmer flytter, `home` oppdateres,
`render()` rebygger); `updateCategoryPlacement` er tre-veis (kilde-reorder / inn i annen
liste / ekstraher til ny). Ny test `tests/dnd-peek-collapsed.test.js`. Ingen DB-migrering.
Se `docs/drag-and-drop.md` og `docs/data-model.md`.

**Skillelinje-forhåndsvisning under DnD (siste runde)**: kategorienes horisontale
skillelinjer vises nå ALLEREDE mens man drar, slik de blir hvis man slipper der
placeholderen står — linjer rundt kategori-placeholderen når en kategori dras, og
en linje der et listepunkts placeholder er nærmeste nabo til en kategori over/under.
Hvile-reglene (`.category::before/::after`) kjenner hverken placeholderen eller at
det løftede objektet er ute av flyten (ga fantom-linjer), så JS overtar linjene i
containerne draget berører: `.seps-managed` slår av pseudo-reglene, og hver rad som
skal ha en linje over seg får `.sep-above` (klasser, ikke innsatte elementer — DOM-
naboskapet brukes av plasserings-/pos-logikken). Identisk geometri i hvile og
forhåndsvisning (33 px luft, linja midt i), så slippet er uten hopp. Ny test
`tests/dnd-separators-preview.test.js`. Ingen DB-migrering. Se
`docs/drag-and-drop.md` og `docs/design-system.md`.

**Viewport-klemme under DnD + «lag først, navngi på plassen» (siste runde)**: (1)
Det løftede objektet holdes nå innenfor viewporten på BEGGE akser og for ALLE
objekt-typer (`clampToViewport` i `dragPosLeft`/`dragPosTop`, mot den faktisk
rendrede boksen — `dragScale()` gir riktig skala per type). Hovedårsaken til at
det stakk utenfor var likevel en annen: `flipFrom` animerte kilde-KORTET når et
listepunkt/en kategori ble dratt ut i board-lufta (ny-liste-placeholderen
omrokkerer kortene), og et transformert element blir containing block for sine
absolutt posisjonerte etterkommere — dra-elementets dokument-koordinater ble
plutselig tolket relativt til kortet, så det hoppet langt ut til høyre, ga
horisontal overflow og skjøv kontoknappen/toppmenyen ut av viewporten på mobil.
`flipFrom` hopper nå over enhver FORFAR til det løftede objektet. (2)
Listepunkter og kategorier opprettes nå som i en kategori: «Legg til …»-inputen er
FJERNET, de to knappene (grønn ＋ = listepunkt, gul = kategori) står midtstilt
nederst i lista, og objektet legges inn med én gang med navnefeltet blankt og
fokusert. Bekreftes navngivingen uten tekst (Enter på tomt felt, Escape, klikk ut),
slettes det nyopprettede objektet igjen (`nameNewRow`). Nye tester
`tests/dnd-viewport-clamp.test.js` og `tests/item-creation.test.js`. Ingen
DB-migrering. Se `docs/drag-and-drop.md` og `docs/design-system.md`.

**1/3-terskler for ny-liste-placeholderen + synlig listepunkt ut av kategori (siste
runde)**: (1) Hvilken liste et løftet listepunkt/en kategori «er i» avgjøres nå av
OBJEKTETS boks, ikke pekeren (`dragOverCard`), og av listas INNHOLDSSONE
(midt i listetittelen … midt i +-knapperaden — halve rammeraden er slark, så
første/siste plass i lista er like lett å treffe) — de samme linjene inn og ut:
objektet er i lista når dets MIDTRE 1/3 ligger innenfor sonen. Kollapset/peek-åpnet
liste, og lister med for liten sone (tomme), bruker hele kortet. Hysteresen kommer av
layouten (placeholderne bytter plass), ikke av et dødbånd; `pointerOverAnyCard` er
borte. Ny-liste-placeholderen dukker dermed opp like lett
nedover som oppover (før måtte PEKEREN forlate kortet), og plasseres etter objektets
y-senter. Flerkolonne (desktop) styres av pekerens x som før. (2) Et listepunkt dratt
UT av en kategori til nivå 1 i SAMME liste **forsvant**: skillelinje-forhåndsvisningen
ga kategorien `position: relative`, og en posisjonert FORFAR blir containing block for
det absolutt posisjonerte dra-elementet (koordinatene tolkes relativt til den, kortets
`overflow: hidden` klipper det bort). Linja males nå speilvendt fra raden over
(`.sep-below`) når raden under linja er en forfar. Ny test
`tests/dnd-extract-thresholds.test.js`. Ingen DB-migrering. Se `docs/drag-and-drop.md`.

**Toast: glassflate + sveip-til-lukk (forrige runde)**: toasten har fått en mer
gjennomsiktig flate (`rgba(45,38,70,0.62)`) med `backdrop-filter: blur(14px)`, og
hele flaten kan **sveipes/dras til høyre for å lukke den umiddelbart** — man
slipper å vente ut timeren (`attachToastSwipe`; terskel 30 % av bredden, minst
56 px, kun høyre-retning, vertikal bevegelse gir gesten til siden så den ruller
nativt). Toasten er `pointer-events: auto` mens den vises (klikk-gjennom i hvile),
og et fullført sveip svelger klikket etterpå så «Angre» ikke fyrer. Nytt
`showToast`-alternativ `opts.onDismiss`: slette-toasten committer slettingen
straks ved sveip (`commitDeleteToastNow`, delt med timeren). Ny test
`tests/toast-swipe.test.js`. Ingen DB-migrering. Se `docs/design-system.md` og
`docs/trash.md`.

**Vertikal justering i kollapsede lister/kategorier (siste runde)**: (1) «(N)»-telleren
leste som hevet skrift ved siden av navnet — `align-self: flex-start` på `.card-title`/
`.cat-title` koblet ut `.title-line`s `align-items: baseline`, så tittel og teller ble
topp-justert i stedet for å stå på samme skriftlinje. `align-self` er fjernet (klikk-
flaten følger fortsatt teksten: titlene er flex-elementer i `.title-line`). (2) En
kollapset kategori hadde 4px mer luft under overskriften enn over (tydeligst rundt
knappene og mot skillelinjene): den nullhøye `.cat-items` lå fortsatt som en flex-rad
mellom to av `.category`s 4px-gap. `.category.collapsed:not(.dragging) > .cat-items`
har nå `margin-top: -4px` → lik luft (16px) over og under, som en kollapset liste er
nøyaktig header-høy (`.dragging` er utelatt: den har allerede `gap: 0`, og `collapsedH`
i `collapseCategory` regner med det). Ny test `tests/collapsed-alignment.test.js`
(baseline + sentrering + symmetri, desktop og mobil). Ingen DB-migrering. Se
`docs/design-system.md`.

**Board-kolonner: fyll venstre først + stabil DnD (forrige runde)**: board-et bruker
ikke lenger CSS multi-column. Kolonnene er **ekte containere** (`.board-col`), og JS
fordeler kortene **grådig** (`relayoutBoard`): kolonne 1 fylles til kolonnebudsjettet
(skjermhøyden under toppmenyen) er brukt opp, så kolonne 2 osv. Får ikke alt plass i
kolonnene vinduet har rom til, økes budsjettet til det minste som holder — kolonnene
blir høyere, siden scroller, og den øverste lista i kolonne 2 glir ned som den nederste
i kolonne 1. Multi-column BALANSERTE (tre lister → tre kolonner med én hver). Ekte
kolonner fjerner samtidig **flimringen** brukeren rapporterte: en placeholder kunne før
dytte et kort over i en annen kolonne, og siden `dragOverCard` leser nettopp den
layouten placeholderen former, vekslet plasseringen frem og tilbake for hver piksel.
`placeNewListPlaceholder` legger nå placeholderen i den KOLONNEN man sikter på (før:
`appendChild` = bunnen av SISTE kolonne), og «bunnen av kolonne k» / «toppen av kolonne
k+1» er to steder å sikte med samme sluttresultat. `placePlaceholder` bruker
referanseradens egen container; `pos` på board-nivå leses med `boardRows()`/
`boardRowSibling()` (naboen over øverste rad i en kolonne ligger nederst i kolonnen før).
En **kort sone under placeholderen** (kollapset/tom liste) flimret også fra før:
modusbyttet rykker lista forbi objektet. `noteOverShift`/`drag.overGrace` måler hoppet og
lar stickiness-en holde lista gjennom det. Ny test `tests/board-columns.test.js`. Ingen
DB-migrering. Se `docs/board-layout.md` og `docs/drag-and-drop.md`.

**Gjenopprett alle utførte (forrige runde)**: en **⟲-knapp** (`ICONS.restoreArrow`,
`.done-restore`) står helt til HØYRE på «Utført»-linja — etter skillelinja, i samme
kolonne som listepunktenes ×. Den reaktiverer ALLE avkryssede listepunkter i lista
på én gang (`restoreAllDone`): `done = false` + `stampContent` på hver, radene
flyttes tilbake til plassene sine (`pos` urørt, kategoriserte tilbake INN i
kategorien sin) i ÉN felles FLIP, og «Utført»-seksjonen skjules. Plasseringen
etter skillelinja kommer av `order: 1` (linja er divider-ens `::after` og ligger
sist i flex-rekkefølgen). Skjult i en frosset liste. Plasseringslogikken er
trukket ut av `toggleItemDone` til `placeItemBySection`, som begge bruker. Ny test
`tests/restore-all-done.test.js`. Ingen DB-migrering. Se `docs/design-system.md`
og `docs/data-model.md`.

Verifisert i nettleser (Playwright) mot en hermetisk in-memory-backend
(`mock-backend.js`, aktiveres med `?mock=1`) som etterligner Supabase-
klienten og deler «server» mellom faner via localStorage — kjør to faner for
å teste deling mellom to brukere uten ekte backend/e-postbekreftelse.
`&lag=800` gir kunstig serverforsinkelse for å teste kø-/optimisme-oppførselen.

**Ny navigasjon: ÉN modal for universer og grupper (siste runde)**: de to
breadcrumb-knappene og de to modalene er erstattet av **én nav-knapp**
(`🌐 univers › 📁 gruppe`) som åpner **én modal** med tittelen «[globus] Universer
og [mappe] grupper». Der bruker universer og grupper **nøyaktig samme oppsett som
lister og listepunkter**: et univers er et `.card` (kan kollapses — viser da
[mappe] + antall grupper i stedet for «(N)»), gruppene er `.item`-rader (uten
avmerkingsboks), og **gruppekategorier** er `.category`-rader (`group.isCat`/
`group.cat`, ny gul knapp + nytt `ICONS.groupCategory`). Board-et
(`#nav-board`) er et vanlig `.board` (samme `relayoutBoard`-kolonnemaskineri som
hovedsiden), men nav-scopet setter `singleColumn` → alltid ÉN `.board-col`. Universer/grupper har ingen innstillingsmodal
— kun **del-knapper** (`.uni-share`/`.group-share`); gruppekategorier har kun
oppløs. Klikk på en gruppe (utenom navnet/knappene) navigerer og lukker modalen.
Gruppe-søppelkassen ligger i universkortet (som listepunkt-kassen i lista);
univers-søppelkassen nederst i modalen. **Dra-og-slipp er den SAMME motoren**: hele
kort-/rad-/kategori-maskineriet kjører nå i to scope (`boardScope`/`navScope`,
valgt av `scopeForEl` ved dragstart) — grupper flyttes mellom universer, ut i
lufta for å lage et NYTT univers, inn i/ut av gruppekategorier, med peek, 1/3-
terskler, skillelinjer og `pointercancel`-rollback gratis. `startGroupDrag`/
`startUniverseDrag`/`finishColumnDrop` + de to gamle auto-scroll-loopene er
FJERNET (nav-scopet bruker viewport-koordinater + modal-scroll). Delt (montert)
innhold kan foreløpig ikke ligge i en gruppekategori (mount-plasseringen har
ingen kategori-kolonne) — slipp der lander på nivå 1 med en toast. Krever en
DB-migrering i kontomodus (`groups.cat_id`/`is_cat`/`collapsed`,
`universes.collapsed`) — se `TODO.md`. Ny test `tests/nav-modal.test.js`. Se
`docs/menus.md`, `docs/drag-and-drop.md`, `docs/data-model.md`,
`docs/design-system.md`, `docs/trash.md`.

Samme runde, etter tilbakemelding: (1) **den aktive gruppen følger med** når den
bytter univers (`followActiveGroup()` først i `renderBoard()`) — før falt
hovedsiden til «Ingen grupper ennå.» fordi `activeGroupObj()` bare leter i det
aktive universet. (2) **Tastatur** tilbake på begge nivåene: korthodet og
grupperaden er `role="button" tabindex="0"` (Enter/Mellomrom = kollaps på
universet; omdøp når man står i gruppa, ellers naviger). (3) **Slipp i en LÅST
mål-container avvises med en gang** i `onItemUp` (som `onCategoryUp` alt gjorde),
med scope-tilpasset toast (`S.lockedTargetMsg`) — DB-vakten ville avvist skrivingen
og snappet den tilbake ved neste synk. (4) Universkort og grupperader innleder med
**[type-ikon]([delt-ikon])Navn**, og delte universkort har ikke lenger den lyse
innerkanten (den lyste gjennom den gjennomsiktige `.card-body` og leste som en
ramme rundt gruppelista).

**Synk-fiks: én avvist skriving låste hele synken (siste runde)**: endringer
sluttet å nå databasen fordi ETT listepunkt pekte på en kategori serveren ikke
hadde. `items.cat_id`/`groups.cat_id` er fremmednøkler til sin egen tabell, og
raden var dermed umulig å skrive — men `cloudCycle` planla en ny runde etter
HVER push, uansett utfall, så den samme op-en ble regenerert og avvist ~1 gang i
sekundet i det stille (bekreftet i Supabase-loggene: `get_my_doc` 200 /
`POST /items` 409, i minuttevis). Tre grep: (1) `pushOps` sender kategorier FØR
medlemmene sine innen samme tabell; (2) `docFromMyState` kjører
`pruneDanglingCats` — en `cat` som ikke treffer en kategori nulles på VÅR side
av flettingen (ikke bare i payloaden, ellers konvergerer aldri lokal og fjern),
så raden lander på nivå 1 der visningen allerede viser den; (3) `pushOps`
returnerer antall avviste ops, og bekreftelses-pullen (`cloudAgain`) planlegges
kun når alt landet — pluss `noteReject`, som logger og gir én toast når SAMME rad
avvises tre ganger på rad. Mock-backenden håndhever nå kategori-FK-en så testene
er ekte. Ny test `tests/sync-dangling-category.test.js`. Ingen DB-migrering. Se
`docs/accounts.md`.

**Synk-fiks: slettede objekter gjenoppsto fra en gammel lokal cache (siste
runde)**: `cloudBase` (3-veis-flettingens base) levde bare i minnet, så hver
oppstart begynte med en TOM base — og «finnes lokalt, ikke på serveren, ikke i
base» leses som en LOKAL NYOPPRETTELSE. En klient med utdatert cache (en annen
enhet, en gammel fane, eller `huskis.vercel.app` vs `www.huskis.no` — hvert domene
har sin egen localStorage) satte derfor inn igjen alt den hadde som serveren ikke
hadde, inkludert permanent slettede objekter, med seg selv som `owner_id`.
`state._tomb` og `tombstones`-tabellen fantes begge, men ingen av dem ble
konsultert. Fem lag: (1) **basen overlever omstart** — lagres versjonert
(`_base`/`_baseV`, `BASE_VERSION`) i SAMME localStorage-post som innholdet, og
rykker kun fram når fletteresultatet faktisk er tatt i bruk i `state`; (2)
**manglende base = ukjent historikk** (`opts.baseKnown`) — «lokal, ikke fjern»-rader
pushes ikke, de slås først opp mot serverens `tombstones` (direkte tabell-select,
porsjoner à 100, kun når basen mangler OG det finnes tvilstilfeller); (3)
**gravsteiner konsulteres begge veier** (`opts.tombs`) — aldri insert, og en
gravlagt rad som fortsatt ligger på serveren får en `delete`; (4) **fremmede rader
gjenskapes aldri** (`opts.foreign` = `_mine === false`), så en gammel kopi av
andres delte objekt ikke kan settes inn med OSS som oppretter; (5) **databasen er
autoritativ** — `guard_object_insert` (BEFORE INSERT på alle fire tabellene)
avviser en gravlagt id (`PT409`, «gravlagt: …») og validerer `owner_id`, også for
gamle klienter og rå `INSERT`. Klienten kjenner igjen avvisningen
(`isTombstoneReject`), gravlegger raden lokalt og slutter å prøve. Utlogging tømmer
innhold + gravsteiner + base sammen (`resetLocalSync`); innlogging leser alle tre
fra den nye brukerens egen cache-post. Gravsteiner utløper ALDRI (eneste
automatiske opprydding er `import_doc`, for sine egne id-er). Krever en DB-migrering
i kontomodus (kun funksjoner/triggere/indeks — ingen nye kolonner) — se `TODO.md`.
Nye tester: `tests/sync-resurrection.test.js`, `tests/sync-shared-resurrection.test.js`
og `supabase/tests/test-tombstones.sql`. Se `docs/trash.md`, `docs/accounts.md`,
`docs/arkitektur-brukere-deling.md`, `docs/data-model.md`.
