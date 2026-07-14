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
   `invites_in`/`invites_out`. Rader med en optimistisk forlatt deling
   (`suppressedRows`, se operasjonskøen under) filtreres bort — inkludert hele
   undertreet — i `contentDocFromMy`, så reconcile verken gjenoppliver dem
   lokalt eller pusher delete på eierens rader mens `leave_share` er underveis.
2. **3-veis fletting** (`reconcile(base, local, remote)`) mot en base-snapshot
   (forrige serverkjente doc): felt-nivå LWW (gjenbruker `merge*Scalar`/
   `mergeItem` fra v1) for rader som finnes begge steder; eksistens avgjøres
   3-veis (base skiller «lokalt slettet» fra «fjern-opprettet», så ingen
   gravsteiner trengs i pull-en).
3. **Push**: rad-CRUD (`insert`/`update`/`delete`) mot tabellene for radene der
   vår tilstand vant. Serveren håndhever RLS + felt-LWW (BEFORE UPDATE-
   triggere), så klienten stempler bare registrene som før og lar serveren
   avvise utdaterte/uautoriserte skrivinger. Etter en push kjøres straks en
   bekreftelses-pull (`cloudAgain = true`) — den frisker opp `lastMy`, så
   køede delings-operasjoner som venter på en nypushet rad
   (`rowKnownToServer`) slipper å vente på neste poll.
4. **Realtime** `postgres_changes` på de seks tabellene + poll (5 s) +
   `visibilitychange`/`focus`/`online` → `scheduleCloud`.

`cloudBase` settes til fjern-doc'et hver runde (basen for neste 3-veis).
Offline-buffer: `state` caches per bruker (`mine-lister-v1:<uid>`), uten intern
metadata (`stateReplacer` hopper over `_`-felt for å unngå sykliske refs).

**Render-vakt (`viewSignature`/`lastViewSig`)**: `applyMyDoc` river ned og
bygger hele board-DOM-en (`render()`). `cloudCycle` kaller den derfor KUN når
visningen faktisk endrer seg — en signatur over (flettet innhold + server-
metadata + optimistiske overlays) sammenlignes mot forrige anvendte. Uten denne
vakta tegnet hvert poll (hvert 5. s) board-et på nytt og nullstilte hover-
tilstanden (synlig «blink»); verre: hvis en push aldri lander (f.eks. en kolonne
mangler i basen så PostgREST avviser hver insert), genererer reconcile samme
op hver runde → `cloudAgain` → en rask retry-løkke som uten vakta ga konstant
flimmer. Motstykket til v1-synkens `mergedCanon !== localCanon`. Nullstilles ved
inn-/utlogging så en fersk sesjon alltid tegner første gang.

## Bakgrunns-operasjonskøen (`opQueue`)

Delings-operasjonene går ikke gjennom doc-synken, og ventet tidligere i UI-et
(deaktiverte knapper, spinnere, «Laster …») til de hadde landet. Nå utføres de
**optimistisk** i UI-et og legges i én **seriell kø** i bakgrunnen — brukeren
kan alltid gjøre neste operasjon umiddelbart, uansett hvor treg forrige er:

- **Serialisering**: neste operasjon starter først når forrige er ferdig, så to
  skrivinger på samme rad aldri lander i feil rekkefølge.
- **Koalescering** (`key` + `merge`): en operasjon med samme nøkkel som en som
  VENTER i køen slås sammen med den (siste tilstand vinner) — lås-spam blir én
  `set_locked` med sluttilstanden, gjentatte mount-flytt én membership-patch.
- **Kjeding** (`op.value`): resultatet av en ferdig operasjon er tilgjengelig
  for senere køede — «Trekk tilbake» på en invitasjon som ennå ikke er
  opprettet, køes bak opprettelsen og bruker invitasjons-id-en fra dens svar.
  Ligger opprettelsen fortsatt i kø, avbrytes den i stedet (`opQueue.cancel`) —
  kontrollert avbrudd, ingen server-trafikk.
- **Forutsetninger** (`waitFor`): en operasjon som avhenger av at doc-synken
  har pushet en rad først (inviter/lås et NYOPPRETTET objekt), blir stående
  fremst i køen til `rowKnownToServer(id)` er sann (raden finnes i `lastMy`).
  Gir opp med rollback etter ~60 s, så en rad som aldri dukker opp ikke låser
  køen evig.
- **Nettverksfeil** (offline): operasjonen legges fremst igjen og prøves med
  backoff (maks 15 s); `online`-hendelsen napper køen i gang. Rekkefølgen
  bevares — alt bak venter, akkurat som doc-synken selv.
- **Serveravvisning**: operasjonens `onError` ruller UI-et tilbake (fjerner den
  optimistiske raden / resynker) og viser feilen — sluttilstanden blir som om
  operasjonen aldri var mulig.
- Ved utlogging (`cloudStop`) tømmes køen og overlayene (operasjonene tilhørte
  den gamle sesjonen). En operasjon som allerede er I LUFTA kan ikke avbrytes,
  men en epoke-teller gjør at resultatet forkastes når den lander — ingen
  callbacks og ingen nettverks-retry, så arbeid fra forrige konto aldri kjører
  videre under en ny innlogging.

**Optimistiske overlays** holder lokal visning stabil over synk-rebuilds til
operasjonen har landet (applyMyDoc bygger ellers fra serverens metadata, som
ennå ikke vet om endringen): `lockOverrides` (ønsket lås-status),
`mountOverrides` (pos/trashed/parent for membership-patcher i kø — brukes også
av «Plasser»-flyten, så objektet monteres lokalt på første pull selv før
patchen har landet), `suppressedRows` (forlatte delinger, filtreres fra pull),
`suppressedInvites` (besvarte invitasjoner, filtreres fra innboksen). Ryddes
av operasjonens onDone/onError når køen ikke har flere operasjoner for samme
nøkkel, fulgt av en resynk.

Avveining: køen lever i minnet. Lukkes fanen FØR en køet operasjon har landet,
er den borte (samme vindu som et vanlig RPC-kall hadde; doc-synkede endringer
overlever derimot via localStorage-cachen). Operasjoner committes ikke ved
`pagehide` — det finnes ingen synkron flush for autentiserte RPC-er.

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
  `attachMeta` legger de optimistiske overlayene (`lockOverrides`/
  `mountOverrides`) OVER serverens metadata, så en endring med skrivingen
  fortsatt i kø ikke visuelt hopper tilbake når en pull rekker å kjøre først.
- Mount-endringer (flytt/rekkefølge/søppel) skrives til `memberships` via
  operasjonskøen (`cloudMountUpdate`: koalescert per objekt + overlay), ikke
  via reconcile. Reorder/flytt-håndtererne (`onGroup Up`/`onCardUp`) og
  slett/gjenopprett-stiene forgrener på `obj._mount`.
- «Umonterte» delinger (mount uten forelder, f.eks. valgt forelder slettet)
  havner i `pendingPlacements` og vises som «Plasser»-rader i innboksen.

## Delings-UI

- **Åpning av delings-UI-et**: for LISTER ligger delingen som egen seksjon i
  innstillingsmodalen (tannhjulet `.card-cog`, se `docs/scheduling.md`) —
  `renderShareOwner`/`renderShareRecipient` tar en `body`-container og deles
  med del-modalen. Univers og grupper deles fra menyenes `.share-btn`
  (del-univers ved «＋ Gruppe», del-gruppe ved «＋ Liste» — de deler det AKTIVE
  universet/gruppen). `updateShareButtons()` (i `render()`) toggler synlighet
  ut fra `accountsMode()` + `_mine`/`_mount`; klikk-handlerne leser aktivt
  objekt.
- **`item.done`** (avkryssing) synker via samme rad-CRUD som resten (innholds-
  register `ts`/`org`). Krever `items.done`-kolonnen — se `TODO.md`.
- **Sletting er buffret** (`docs/trash.md`): den skrives ikke til DB før toast-
  vinduet utløper (eller fanen skjules). Angre innen vinduet gir null DB-trafikk.
  Buffer-flagget (`_pendingDelete`) gjenpåføres etter hver `applyMyDoc`
  (`reapplyPendingDeletes`), så en samtidig synk-runde ikke «angrer» skjulingen.
- **Del-modal** (på univers/gruppe/liste, kun for eier eller mottaker): åpner
  UMIDDELBART — eierskapet (`_mine`) kjennes synkront, så riktig visning
  tegnes uten «Laster …»; eieren selv vises straks fra kontoens egne data
  (`myOwnerInfo`), og medlemmer/ventende fylles inn når `get_members` lander.
  Alle handlingene er optimistiske med selve RPC-en i operasjonskøen:
  - **Inviter** (`create_share_invite`): raden («Venter på svar») vises og
    feltet tømmes straks; flere invitasjoner køes etter hverandre. Feiler den
    (ugyldig/duplikat/ikke synket), fjernes raden og feilen vises. «Trekk
    tilbake» på en ennå-ikke-landet rad avbryter/kjeder (se opQueue).
  - **Lås/åpne** (`set_locked`): knappen vender straks; spam koalesceres til
    én skriving med sluttilstanden.
  - **Unntak fra arvet lås** (`set_unlocked`, egen overlay `unlockOverrides`):
    når objektet har en **arvet lås** (en forelder er låst — `inheritedLockInfo`
    finner den nærmeste, et `_unlocked` på veien opp bryter arven), viser lås-
    feltet i stedet «Automatisk låst … Fordi [ikon][navn] er låst» og knappen
    «Gjør unntak» → objektet (og alt under, med mindre et lavere nivå låses på
    nytt) kan redigeres av andre likevel. Samme optimistiske kø-mønster som
    `set_locked`. `locked`/`unlocked` er gjensidig utelukkende (RPC-ene holder
    dem det). `frozen()` bruker nærmeste-eksplisitt-tilstand oppover `_parent`.
  - **Arvede medlemmer** (`refreshInherited`): under de direkte medlemmene vises
    en «Arvet fra deling over»-seksjon med personene forfedrenes delinger gir
    tilgang (henter `get_members` for hver DELT forelder, deduplisert mot eier +
    direkte medlemmer, «Deles via [navn]», uten «Kast ut» — de fjernes der de
    faktisk ble delt). Deling lenger ned kan legge til FLERE personer (egen
    invitasjon på gruppen/listen) uten å røre forelderens delegruppe.
  - **Kast ut** (`revoke_share`) / **trekk tilbake** (`revoke_share_invite`):
    raden forsvinner straks; `refreshMembers` gjenoppretter ved avvisning.
  - **Forlat deling** (mottaker, `leave_share`): objektet fjernes fra treet og
    modalen lukkes straks (`removeMountLocally` + `cloudLeave` med
    undertrykking). Mottakerens eier-navn hentes i bakgrunnen («Delt med deg»
    til det lander).
- **Innboks** (i meny-modalen, badge på ☰): godta (med plasseringsvalg,
  `accept_share_invite`), avslå (`decline_share_invite`) og «Plasser»
  (mount-patch) fjerner raden umiddelbart (`suppressedInvites`/
  `pendingPlacements`-filtrering) med RPC-en i køen; innholdet dukker opp når
  neste pull ser medlemskapet. Ved avvisning kommer raden tilbake + feil-toast.

## Navn, initialer og ansvarlig

- **Navn/initialer**: `display_name` = «Fornavn Etternavn». `initialsFromName`
  gir initialene (første bokstav i fornavn + etternavn), `personName` gir
  navnet (faller tilbake på e-post for uregistrerte/ventende invitasjoner).
  Del-modalen viser en initial-sirkel + navn for eier og hvert medlem
  (`avatarFor`, eier grønn / medlem grå — samme roller som før). Meny-modalens
  konto-avatar bruker samme navn/initialer (`my.user.display_name`).
- **Ansvarlig** (`item.responsible` OG `card.responsible`): objekter i delt
  kontekst (delt liste, eller liste under en delt gruppe/univers —
  `shareRootFor`) kan få en ansvarlig — både hvert element og hele listen.
  Settes fra innstillingsmodalens «Ansvarlig»-rad eller ansvarlig-chipen i
  meta-raden (`docs/scheduling.md`); begge åpner ansvarlig-velgeren
  (`openResponsible(target, …)`, target = `{ kind: 'card'|'item', obj, card }`)
  — popover (desktop) / modal (mobil) på `.switcher-*`-skallet. Radene viser
  hver i «delegruppen» (eier + medlemmer av nærmeste delte forelder, hentet med
  `get_members` og cachet i `shareGroupCache`) alfabetisk, som en farget
  initial-sirkel (`respAvatar`, palett via alfabetisk indeks — `colorForIndex`)
  + fullt navn, pluss «Ingen ansvarlig» når noen er valgt. `responsible` synkes
  som innhold, så alle med redigeringstilgang kan endre den. Delegruppen er
  nærmeste delte forelder (ett get_members-kall), ikke unionen av flere
  overlappende delinger — bevisst forenkling.
- **Umiddelbart og fritt bytte** (ingen venting): valget vises i samme øyeblikk
  (ansvarssirkelen males fra state) og kan byttes igjen med en gang — også mens
  forrige endring fortsatt er i lufta. Korrektheten ligger i synk-motoren, ikke
  i UI-låsing: `setResponsible` slår opp det *levende* item-objektet på id
  (`findAnyById`, så et foreldet objekt fanget av popoveren aldri muteres) og
  stempler innholds-registeret med et nytt `ts` per valg; den serielle
  `cloudCycle`-en + felt-LWW gjør at det siste valget alltid vinner, både
  lokalt og på serveren. (Den gamle `pendingResp`-spinneren/-låsen er fjernet.)
  Popoveren åpner også umiddelbart: cachet delegruppe males straks
  (stale-while-revalidate), en fersk `get_members` bygger radene om når den
  lander (ansvaret re-leses live på id, og panelet reposisjoneres aldri mot en
  anker-knapp en rebuild har revet ut av DOM-en).

## Søppel-semantikk for delinger

For en mottaker er «slett» på selve share-roten = legg mounten i egen søppel
(`membership.trashed`); tømming = `leave_share` (forlat, rører ikke eierens
innhold — går via operasjonskøen med `suppressedRows`-undertrykking, se
`docs/trash.md`). Innhold UNDER en deling slettes som vanlig (felles
`trashed`, gjelder alle). Håndteres i delete-/empty-/restore-stiene ved å
forgrene på `obj._mount`. Serveren håndhever reglene uansett (RLS +
trashed-vakter).

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

`?mock=1&lag=800` legger en kunstig «server»-forsinkelse (ms) på alle RPC-/
tabell-kall (ikke auth) — brukes til å bevise at UI-et er umiddelbart og at
operasjonskøen serialiserer riktig når operasjonene er trege.

Verifisert med Playwright: registrering→«sjekk innboksen»→innlogging, CRUD +
buffer over reload, to-bruker-deling (inviter→godta m/plassering→mount→kryss-
bruker-synk→lås/frys→forlat), migrering, og desktop+mobil. Operasjonskøen er
verifisert med `lag=800`: umiddelbar del-modal, køede invitasjoner m/
tilbaketrekking, lås-spam→koalescert sluttilstand, umiddelbar aksept,
fritt ansvars-bytte med LWW-sluttilstand, gjenopprett/tøm under buffret
sletting, mount-sletting uten gjenoppstandelse under pull, og forlat uten
resurrect-blink.
