# Brukerkontoer og deling — klienten (fase 2)

Les denne når oppgaven berører innlogging med e-post/passord, synk mot de
relasjonelle tabellene, mount-rendring av delt innhold, delings-UI, eller
kontomodus-flagget. Databasesiden: `docs/arkitektur-brukere-deling.md`.
All koden ligger i `app.js`, seksjonen «FASE 2 — BRUKERKONTOER OG DELING».

## Kontomodus-flagget

Kontomodus (ekte kontoer i stedet for mønster-lås) er bevisst bak et flagg
inntil de manuelle Supabase-dashboard-stegene i `TODO.md` er gjort:

- `window.SUPABASE_CONFIG.accounts = true` (i `config.js`) — slår det på i
  produksjon.
- `?accounts=1` — slår det på for én økt (mot ekte Supabase).
- `?mock=1` — kontomodus mot `mock-backend.js` (hermetisk, se under).
- `?patternlock=1` / standard — den gamle mønster-låsen (`docs/auth.md`).

`accountsMode()` avgjør dette. Er den av, kjører appen 100 % som før (mønster-
lås + synk-doc v1, `docs/sync.md`) — fase 2-koden er ren tilleggskode som bare
aktiveres av flagget.

## Auth-UI

Ett skjema (`#auth-screen`) med tre modi (`login`/`register`/`forgot`):

- **Registrering**: `supabase.auth.signUp`. Krever **fornavn + etternavn**
  (egne felt, kun i register-modus) → `display_name = «Fornavn Etternavn»`
  sendes som `options.data.display_name` og fanges av `handle_new_user`-
  triggeren (`docs/arkitektur-brukere-deling.md`). Med «Confirm email» på
  returneres ingen sesjon → «sjekk innboksen»-visning (`#auth-sent`).
- **Innlogging**: `signInWithPassword`.
- **Glemt passord**: `resetPasswordForEmail` → «sjekk innboksen». Retur via
  e-postlenken gir en `PASSWORD_RECOVERY`-hendelse → prompt om nytt passord.
- **Logg ut**: `signOut` (i meny-modalen).

Sesjonen styres av `supabase.auth.onAuthStateChange` (erstatter
`mine-lister-auth`): `SIGNED_IN` → `cloudStart()`, `SIGNED_OUT` →
`cloudStop()`. En eksisterende sesjon hentes ved oppstart med `getSession()`.
`authUser` bærer `{ id, email, meta }` der `meta` = `user.user_metadata`.

**Aktiv posisjon på kontoen**: hvilket univers/gruppe man står i lagres i
`user_metadata.nav = {u,g}` via `auth.updateUser({ data })` (debouncet,
`saveNavPref`), og gjenopprettes ved første pull (`restoreNavPref`). Se
`docs/data-model.md` for semantikken. Mock-backenden speiler dette:
`user_metadata` ligger på profilen i den delte «databasen», settes av
`updateUser`, og leses inn i sesjonsbrukeren ved `signInWithPassword` — så to
faner (= to enheter) deler den huskede posisjonen.

## Synk-motor v2

Kanonisk innhold ligger nå relasjonelt (ikke ett jsonb-doc). Klienten holder
samme nested `state` som før; synken går slik (`cloudCycle`):

1. **Pull**: `get_my_doc()` → flatt doc i samme fasong som synk-doc v1, men med
   ekstra felt per rad: `owner`/`mine`/`locked`/`shared`/`mount`, samt
   `invites_in`/`invites_out`.
2. **3-veis fletting** (`reconcile(base, local, remote)`) mot en base-snapshot
   (forrige serverkjente doc): felt-nivå LWW (gjenbruker `merge*Scalar`/
   `mergeItem` fra v1) for rader som finnes begge steder; eksistens avgjøres
   3-veis (base skiller «lokalt slettet» fra «fjern-opprettet», så ingen
   gravsteiner trengs i pull-en).
3. **Push**: rad-CRUD (`insert`/`update`/`delete`) mot tabellene for radene der
   vår tilstand vant. Serveren håndhever RLS + felt-LWW (BEFORE UPDATE-
   triggere), så klienten stempler bare registrene som før og lar serveren
   avvise utdaterte/uautoriserte skrivinger.
4. **Realtime** `postgres_changes` på de seks tabellene + poll (5 s) +
   `visibilitychange`/`focus`/`online` → `scheduleCloud`.

`cloudBase` settes til fjern-doc'et hver runde (basen for neste 3-veis).
Offline-buffer: `state` caches per bruker (`mine-lister-v1:<uid>`), uten intern
metadata (`stateReplacer` hopper over `_`-felt for å unngå sykliske refs).

## Mount-rendring (delt innhold)

Delte objekter er felles innhold, men **mottakerens plassering** (forelder +
rekkefølge + egen søppel) ligger i en membership-rad («mount»). I `applyMyDoc`:

- En rad med `mount` re-foreldres til `mount.parent` (mottakerens valgte
  univers/gruppe) i stedet for eierens kanoniske forelder. Objektets `.pos`/
  `.trashed` speiler mounten (per bruker); de kanoniske verdiene tas vare på i
  `_canon` (til push, så innhold flettes kanonisk mens plassering ikke gjør
  det).
- Metadata legges på objektene: `_owner`/`_mine`/`_locked`/`_shared`/`_mount`/
  `_parent`. `frozen(obj)` = objektet selv eller en forelder er låst av noen
  andre → redigering deaktiveres i UI (serveren blokkerer uansett).
- Mount-endringer (flytt/rekkefølge/søppel) skrives direkte til `memberships`
  (`cloudMountUpdate`), ikke via reconcile. Reorder/flytt-håndtererne (`onGroup
  Up`/`onCardUp`) og slett/gjenopprett-stiene forgrener på `obj._mount`.
- «Umonterte» delinger (mount uten forelder, f.eks. valgt forelder slettet)
  havner i `pendingPlacements` og vises som «Plasser»-rader i innboksen.

## Delings-UI

- **Åpning av del-modalen**: listekort har egen `.card-share`-knapp. Univers og
  grupper deles derimot fra menyenes `.share-btn` (del-univers ved «＋ Gruppe»,
  del-gruppe ved «＋ Liste» — de deler det AKTIVE universet/gruppen, ikke et
  vilkårlig kort). `updateShareButtons()` (i `render()`) toggler synlighet ut
  fra `accountsMode()` + `_mine`/`_mount`; klikk-handlerne leser aktivt objekt.
- **`item.done`** (avkryssing) synker via samme rad-CRUD som resten (innholds-
  register `ts`/`org`). Krever `items.done`-kolonnen — se `TODO.md`.
- **Sletting er buffret** (`docs/trash.md`): den skrives ikke til DB før toast-
  vinduet utløper (eller fanen skjules). Angre innen vinduet gir null DB-trafikk.
  Buffer-flagget (`_pendingDelete`) gjenpåføres etter hver `applyMyDoc`
  (`reapplyPendingDeletes`), så en samtidig synk-runde ikke «angrer» skjulingen.
- **Del-modal** (på univers/gruppe/liste, kun for eier eller mottaker):
  eier ser inviter-på-e-post (`create_share_invite`), medlemsliste
  (`get_members`), kast ut (`revoke_share`), trekk tilbake invitasjon
  (`revoke_share_invite`) og lås/åpne (`set_locked`). Mottaker ser eier +
  låst-status + «Forlat deling» (`leave_share`).
- **Innboks** (i meny-modalen, badge på ☰): mottatte invitasjoner
  (`invites_in`) godtas med plasseringsvalg (`accept_share_invite`) eller
  avslås (`decline_share_invite`).

## Navn, initialer og ansvarlig

- **Navn/initialer**: `display_name` = «Fornavn Etternavn». `initialsFromName`
  gir initialene (første bokstav i fornavn + etternavn), `personName` gir
  navnet (faller tilbake på e-post for uregistrerte/ventende invitasjoner).
  Del-modalen viser en initial-sirkel + navn for eier og hvert medlem
  (`avatarFor`, eier grønn / medlem grå — samme roller som før). Meny-modalens
  konto-avatar bruker samme navn/initialer (`my.user.display_name`).
- **Ansvarlig for elementer** (`item.responsible`): elementer i delt kontekst
  (delt liste, eller liste under en delt gruppe/univers — `shareRootFor`) får en
  ansvarsknapp (`.item-resp`, hånd-opp-ikonet `ICONS.handRaise`) til venstre for
  slette-✕. Klikk åpner en popover (desktop) / modal (mobil) som gjenbruker
  `.switcher-overlay`/`.switcher-panel`-skallet (`openResponsible`): radene viser
  hver i «delegruppen» (eier + medlemmer av nærmeste delte forelder, hentet med
  `get_members` og cachet i `shareGroupCache`) alfabetisk, som en farget
  initial-sirkel (`respAvatar`, palett via alfabetisk indeks — `colorForIndex`)
  + fullt navn, pluss «Ingen ansvarlig» når noen er valgt. Valgt ansvarlig
  erstatter ikonet med sirkelen (`paintResp`); `item.responsible` synkes som
  innhold, så alle med redigeringstilgang kan endre den. Delegruppen er nærmeste
  delte forelder (én get_members-kall), ikke unionen av flere overlappende
  delinger — bevisst forenkling.
- **«Venter»-låsing** (`pendingResp`): når man velger en ansvarlig, markeres
  elementet som «i lufta» (keyet på id) → knappen viser en **spinner** og er
  deaktivert til endringen har landet (`clearLandedResp` fjerner flagget når det
  flettede doc-et har satt feltet på/forbi vår `ts` etter push). Dette hindrer
  et nytt bytte før det forrige er committet — og dermed en race der en samtidig
  synk-rebuild bytter ut item-objektet under en åpen popover og det siste byttet
  går tapt. `setResponsible` slår dessuten opp det *levende* item-objektet på id
  (`findAnyById`), så et foreldet objekt fanget av popoveren aldri muteres.

## Søppel-semantikk for delinger

For en mottaker er «slett» på selve share-roten = legg mounten i egen søppel
(`membership.trashed`); tømming = `leave_share` (forlat, rører ikke eierens
innhold). Innhold UNDER en deling slettes som vanlig (felles `trashed`,
gjelder alle). Håndteres i delete-/empty-/restore-stiene ved å forgrene på
`obj._mount`. Serveren håndhever reglene uansett (RLS + trashed-vakter).

## Migreringsflyt

Ved første innlogging med tom konto men lokale data (legacy `mine-lister-v1`)
tilbys import (`import_doc(legacyFlatDoc())`); flagg `hk-migrated:<uid>` hindrer
gjentatt spørring.

## Testing: mock-backend

`mock-backend.js` (kun ved `?mock=1`) etterligner den delmengden av Supabase-
klienten appen bruker (auth, `from().insert/update/delete`, `rpc`, `channel`),
med en «database» delt mellom faner via `localStorage` og realtime simulert med
`storage`-hendelser. Sesjonen er per fane (`sessionStorage`) → to faner = to
brukere. Nok fidelitet til å kjøre hele delingsflyten, server-LWW, lås og
forlat/utkast, uten ekte backend eller e-postbekreftelse. Ikke en full RLS-
implementasjon; produksjon bruker ekte Supabase.

Verifisert med Playwright: registrering→«sjekk innboksen»→innlogging, CRUD +
buffer over reload, to-bruker-deling (inviter→godta m/plassering→mount→kryss-
bruker-synk→lås/frys→forlat), migrering, og desktop+mobil.
