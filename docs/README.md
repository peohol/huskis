# Dokumentasjonskart

Les det oppgaven berører, ikke mer. Hvert dokument beskriver **nåtilstanden** i
sitt fagfelt; endringshistorikken ligger i git og i PR-ene. `mobilapp-plan.md`
og `dndkit-plan.md` er de bevisste unntakene: levende arbeidsplaner som også
viser fremdrift og neste steg.

Ved motstrid gjelder det dokumentet som er merket autoritativt for feltet — og
`rettigheter-og-deling.md` går foran alle andre i rettighetsspørsmål.

| Dokument | Les når oppgaven gjelder | Autoritativ for |
|---|---|---|
| [rettigheter-og-deling.md](rettigheter-og-deling.md) | hvem som får redigere, dele, låse, flytte, slette; roller (`owner`/`member`), capabilities, arvet lås + unntak, invitasjonspolicy | **ja** — fasiten for rettighetsmodellen |
| [data-model.md](data-model.md) | state-strukturen, foreldre-pekere, kategorier, id-er, hva som lagres lokalt vs. i databasen | **ja** — klientens datamodell |
| [arkitektur-brukere-deling.md](arkitektur-brukere-deling.md) | tabellene, RLS-policyene, triggerne, RPC-ene, LWW-stemplingen, gravsteinene, e-postvarsel-triggeren | **ja** — databasearkitekturen |
| [accounts.md](accounts.md) | auth-UI, sesjonen og resten av det enheten lagrer, synk-motoren (`get_my_doc` → fletting → rad-CRUD), operasjonskøen, delings-UI, innboks, mock-backenden | **ja** — klientsiden av kontoer og synk |
| [sprak.md](sprak.md) | språkvalget (norsk/engelsk): hvor det lagres, hvem som vinner, ordboken i `i18n.js`, hvordan en tekst kommer inn i UI-et, og hvilket språk e-postene får | **ja** — språkmodellen |
| [design-system.md](design-system.md) | `styles.css`, nye knapper/kontroller, delte klasser, toast, modaler, animasjon | **ja** — designsystemet |
| [mork-drakt.md](mork-drakt.md) | lys/mørk drakt: hvor valget lagres, `theme.js` i `<head>`, de to token-familiene, ikonfargene, og hvordan palettens L-sett speiles | **ja** — draktmodellen |
| [tilgjengelighet.md](tilgjengelighet.md) | kontrastkravene og fargekontrakten, `aria-label` på ikonknapper, tastatursnarveiene (sortering/flytting/omdøping), fokus i modaler og etter sletting, berøringsflater, de manuelle kontrollpunktene | **ja** — WCAG-kravene |
| [introduksjon.md](introduksjon.md) | demonstrasjonen etter første innlogging, simuleringen den kjører i, stegene, «Vis på nytt», de kontekstuelle tipsene om avanserte gester | **ja** — førstegangsopplevelsen |
| [menus.md](menus.md) | toppmenyen, navigasjonsmodalen (områder + mapper), kontoknappen/-modalen og **objektmenyen** på alle seks nivåene | **ja** — navigasjon og menyer |
| [drag-and-drop.md](drag-and-drop.md) | reorder, flytting mellom lister/mapper/områder, ekstrahering, peek, auto-scroll, de to dra-scopene | **ja** — dra-og-slipp-motoren |
| [dndkit-plan.md](dndkit-plan.md) | å bytte den hjemmesnekrede dra-og-slipp-motoren mot dnd-kit + Smett: hva som delegeres, hva som blir igjen, hva Smett mangler, og i hvilken rekkefølge | **ja** — migreringsplanen for dra-og-slipp |
| [board-layout.md](board-layout.md) | kolonnefordelingen i listevisningen og avstander/padding/gap der | **ja** — board-layouten |
| [trash.md](trash.md) | sletting (menyen og **slipp i kassen**), gjenoppretting og tømming på alle fire nivåene, buffret sletting, angre | **ja** — søppelkassene |
| [scheduling.md](scheduling.md) | tids-editoren (objektmenyens tidsskuff + tids-popoveren), start-/fristtider, indikator-chipene | **ja** — tidsplanlegging |
| [colors-and-labels.md](colors-and-labels.md) | posisjonsbasert HSL-farge på kort/rader, de gamle K/P-feltene | **ja** — fargesystemet |
| [domains-and-urls.md](domains-and-urls.md) | det kanoniske originet og 308-redirecten fra de alternative domenene, auth-redirects, lenker i utsendte e-poster | **ja** — domener og URL-generering |
| [auto-update.md](auto-update.md) | build-ID, release-ID, `/version.json`, cache-headerne i `vercel.json`, automatisk reload av åpne faner | **ja** — build og auto-oppdatering |
| [mobilapp-plan.md](mobilapp-plan.md) | Capacitor, Android/iOS, native builds, OTA og hvor mobilprosjektet står | **ja** — mobilplan, fremdrift og neste steg |
| [sikkerhetsheadere.md](sikkerhetsheadere.md) | innholdssikkerhetspolicyen (CSP) og unntakene i den, de øvrige sikkerhetsheaderne, den låste Supabase-versjonen, hvorfor testmodusen ikke finnes i produksjon | **ja** — responsheadere og CSP |
| [release-og-deploy.md](release-og-deploy.md) | rekkefølgen fra merge til produksjon: testing på PR, migrering, smoke-test, Vercel-deploy, preview-deploys, feil/retry/rollback | **ja** — releaseprosessen |

## Kilder som ikke er dokumenter

- `supabase/users-and-sharing.sql` — den faktiske databasen (skjema, RLS,
  triggere, RPC-er). Regler beskrevet i `rettigheter-og-deling.md` håndheves
  her. Arbeidsregler: `supabase/CLAUDE.md`.
- `mock-backend.js` — speiler serverens regler for testing (`?mock=1`), lastet av
  `dev-mock.js`. Begge er kun kildekode: `build.js` holder dem utenfor deployen
  (`sikkerhetsheadere.md`).
- `i18n.js` — ordboken (norsk/engelsk) og `t()`. Arbeidsregler: `sprak.md`.
- `tests/` — regresjonstestene; kommentarblokken i hver fil sier hva den dekker.
  Arbeidsregler: `tests/CLAUDE.md`.
- `TODO.md` — kun det som fortsatt gjenstår, mest manuelle steg i Supabase/Vercel.

## Når du oppdaterer dokumentasjonen

Endrer du en invariant, oppdater den ETT sted — det autoritative dokumentet — og
lenk dit fra de andre i stedet for å gjenta. Skriv hvordan det er nå; ikke legg
til hva som var før eller hvilken runde som endret det.
