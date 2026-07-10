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
| `docs/colors-and-labels.md` | HSL-fargesystem, K/P-merkelapper, filter |
| `docs/arkitektur-brukere-deling.md` | brukerkontoer (Supabase Auth), eierskap, deling/mounts, lås — database-grunnmuren for fase 2 |

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
nivåer, luft-system i board-et) er implementert og verifisert i nettleser — se
git-historikk for detaljer. Eneste åpne punkt der: dra-rekkefølge for
universer i menyen (ikke etterspurt; `pos`-felt er klart i datamodellen, se
`docs/data-model.md`).

**Brukere og deling**: database-grunnmuren (Supabase Auth, eierskap, deling,
lås — se `docs/arkitektur-brukere-deling.md`) er ferdig, testet og kjørt mot
Supabase. Klient/UI (fase 2: innlogging, delings-UI, mount-rendring) gjenstår
— se `TODO.md` for detaljert løypekart. Appen bruker fortsatt mønster-låsen
(`docs/auth.md`) og det gamle synk-doc'et (`docs/sync.md`) inntil fase 2 er
ferdig.
