# CLAUDE.md — Huskekurv

Statisk app: **Univers > Gruppe > Liste > Element**. Universer er helt
uavhengige områder — grupper flyttes aldri på tvers av dem. Ingen byggesteg —
ren `index.html` + `styles.css` + `app.js` (vanilla JS), persistens i
`localStorage` + sanntids-synk via Supabase.

## Kjøre appen

```bash
cd /home/user/huskekurv
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
| `docs/data-model.md` | state-form, foreldre-pekere, univers/gruppe/liste/element-hierarkiet |
| `docs/design-system.md` | styles.css, nye knapper/kontroller, delte klasser, UX-mønstre |
| `docs/menus.md` | gruppemeny, listemeny, ☰-knappen, meny-modal/universer |
| `docs/board-layout.md` | avstander/padding/gap i selve listevisningen |
| `docs/drag-and-drop.md` | reorder, dra-og-slipp-motoren, overføring mellom lister/grupper |
| `docs/trash.md` | slette/gjenopprette/tømme på ethvert nivå |
| `docs/sync.md` | Supabase-synk, fletting, gravsteiner, migrering, databaseoppsett |
| `docs/auth.md` | mønster-lås/splash-screen/innlogging |
| `docs/colors-and-labels.md` | HSL-fargesystem, Mine/Delte-filter |
| `docs/scheduling.md` | innstillingsmodalen (tannhjul), tidsplan (start/frist), indikator-chips |
| `docs/arkitektur-brukere-deling.md` | brukerkontoer (Supabase Auth), eierskap, deling/mounts, lås — database-grunnmuren for fase 2 |
| `docs/accounts.md` | fase 2-KLIENTEN: auth-UI, synk-motor v2 (get_my_doc/rad-CRUD), mount-rendring, delings-UI, kontomodus-flagget, mock-backend for testing |

## Verifisering (påkrevd før du sier deg ferdig)

Verifiser alltid i ekte nettleser (Playwright mot `python3 -m http.server`,
desktop- OG mobil-viewport, blokker eksterne kall for hermetikk) — funksjonelt
(CRUD/DnD/synk/migrering) og visuelt (screenshots). `localStorage['mine-lister-
auth']='1'` hopper over mønster-låsen under testing. Ikke rapporter en
oppgave som ferdig uten denne verifiseringen.

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
elementer m/ tynnere ikonstreker, felles `.btn-solid`-knappesystem,
prikke-håndtak, delt placeholder-stil, knapp-til-sveipefelt-morf,
slette-animasjon inn i søppelknappen) — se `docs/design-system.md` og
`docs/trash.md`. En påfølgende runde la til: typografi-tokens (`--fs-*`),
avkryssing av elementer (`item.done`), angre-toast + delte gjenopprett-hjelpere,
felles bekreftelses-modal (`askConfirm`, erstatter native `confirm()`),
tastatur-reordering på håndtakene, `prefers-reduced-motion`-støtte, delte
`.field`/avatar-klasser, hvit ✕ på fargede flater, og flytting av univers-/
gruppe-deling fra kortene til egne `.share-btn` i menyene (ved «＋ Gruppe» / «＋
Liste»). `item.done` krever en DB-migrering i kontomodus — se `TODO.md`.
Posisjonsbasert farge reindekseres alltid ved omrokkering (ikke bare
add/slett) for grupper, lister og universer — se `docs/drag-and-drop.md`.
En runde la til: **buffret sletting** (`_pendingDelete` + `DELETE_BUFFER_MS`) —
sletting skrives ikke til DB før angre-vinduet utløper, angre er umiddelbart
(`docs/trash.md`); **«Utført»-seksjon** for avkryssede elementer (FLIP,
posisjonsminne via uendret `pos`); liste-del-chip og liste-ikon oppdatert;
sveipefeltet sier «Tøm» + pil.

**Navn og ansvarlig** (siste runde): registrering krever fornavn + etternavn
(→ `profiles.display_name`); del-modalen viser initial-sirkel + navn for eier/
medlemmer; elementer i delte lister har en **ansvarsknapp** (hånd-opp-ikon →
popover/modal med delegruppen alfabetisk som fargede initial-sirkler + navn →
valgt ansvarlig vises som farget initial-sirkel, `item.responsible`). Krever en
DB-migrering + navne-seed i kontomodus — se `TODO.md`. Se `docs/accounts.md`.

**Brukere og deling**: database-grunnmuren (Supabase Auth, eierskap, deling,
lås — se `docs/arkitektur-brukere-deling.md`) er ferdig, testet og kjørt mot
Supabase. **Fase 2 (klient/UI) er implementert** — auth-UI (registrering/
innlogging/glemt passord), synk-motor v2 (`get_my_doc` → 3-veis fletting →
rad-CRUD), mount-rendring av delt innhold, delings-UI (inviter/medlemmer/
lås/innboks), søppel-semantikk for delinger (forlat) og migreringsflyt. Se
`docs/accounts.md`. Kontomodus ligger **bak et flagg** (`config.js`:
`accounts: true`, eller `?accounts=1`) inntil de manuelle Supabase-dashboard-
stegene i `TODO.md` er gjort og alt er verifisert mot ekte Supabase; til da
kjører fortsatt mønster-låsen (`docs/auth.md`) + synk-doc v1 (`docs/sync.md`).

**Kategorier (siste runde)**: lister har nå TO nivåer — nivå 1 rommer
ukategoriserte elementer OG kategorier (om hverandre, kan omrokkeres), nivå 2 er
elementene inne i hver kategori. En kategori lagres SOM et element (`item.isCat`),
leaf-elementer peker på den via `item.cat`; kategorier nøstes aldri. Opprettes
ved **klikk-og-hold** (400 ms) på ＋-knappen (som ellers legger til et element;
knappen er disablet til feltet har tekst). Dra-og-slipp: elementer flyttes mellom
nivå 1 / kategorier / lister (slipp på kategori-overskriften eller blant
elementene legger det i kategorien); kategori-håndtak reorderer på nivå 1 med en
rask kollaps-til-overskrift-animasjon under draging + utvidelse ved slipp; slipp
på en annen kategori nøster ikke (vanlig bytte-plass). Kategori-overskriften har
en innstillingsknapp (tannhjul → felles innstillingsmodal, `kind:'category'`,
med tidslås som liste-modalen) og en oppløs-knapp (boble-sprekk-ikon → elementene
blir ukategoriserte på samme plass). Kategoriens elementer ligger i en innrykket
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
(erstattet del-knappen) og elementer (erstattet ansvarsknappen) åpner en
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

Verifisert i nettleser (Playwright) mot en hermetisk in-memory-backend
(`mock-backend.js`, aktiveres med `?mock=1`) som etterligner Supabase-
klienten og deler «server» mellom faner via localStorage — kjør to faner for
å teste deling mellom to brukere uten ekte backend/e-postbekreftelse.
`&lag=800` gir kunstig serverforsinkelse for å teste kø-/optimisme-oppførselen.
