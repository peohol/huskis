# Brukerkontoer og deling — klienten

Les denne når oppgaven berører innlogging med e-post/passord, synk mot de
relasjonelle tabellene, mount-rendring av delt innhold, delings-UI, e-postvarsel
eller innboks. Databasesiden: `docs/arkitektur-brukere-deling.md`. All koden
ligger i `app.js`, seksjonen «BRUKERKONTOER OG DELING».

Appen kjører KUN på ekte kontoer — mønster-låsen og synk-doc v1 er fjernet.
`?mock=1` bytter backend til `mock-backend.js` (hermetisk in-memory, for testing;
se under). Supabase-klienten lages av `acli()`.

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
- **Logg ut**: `signOut` (i konto-modalen).

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

1. **Pull**: `get_my_doc()` → ett flatt doc (universes/groups/cards/items), med
   ekstra felt per rad: `owner`/`mine`/`locked`/`shared`/`mount`, samt
   `invites_in`/`invites_out`. Rader med en optimistisk forlatt deling
   (`suppressedRows`, se operasjonskøen under) filtreres bort — inkludert hele
   undertreet — i `contentDocFromMy`, så reconcile verken gjenoppliver dem
   lokalt eller pusher delete på eierens rader mens `leave_share` er underveis.
2. **3-veis fletting** (`reconcile(base, local, remote, opts)`) mot en
   base-snapshot (forrige serverkjente doc): felt-nivå LWW (gjenbruker
   `merge*Scalar`/`mergeItem` fra v1) for rader som finnes begge steder;
   eksistens avgjøres 3-veis (base skiller «lokalt slettet» fra
   «fjern-opprettet»). `opts` bærer de tre vaktene under (gravsteiner, kjent
   base, fremmede rader).
3. **Push**: rad-CRUD (`insert`/`update`/`delete`) mot tabellene for radene der
   vår tilstand vant. Serveren håndhever RLS + felt-LWW (BEFORE UPDATE-
   triggere), så klienten stempler bare registrene som før og lar serveren
   avvise utdaterte/uautoriserte skrivinger. Etter en push kjøres straks en
   bekreftelses-pull (`cloudAgain = true`) — den frisker opp `lastMy`, så
   køede delings-operasjoner som venter på en nypushet rad
   (`rowKnownToServer`) slipper å vente på neste poll. Bekreftelses-pullen
   planlegges KUN når hele pushen landet (`pushOps` returnerer antall avviste
   ops): en skriving som avvises permanent regenereres av reconcile hver runde,
   og med en ubetinget `cloudAgain` ble det en varm løkke som hamret
   `get_my_doc` + den samme avvisningen ~1 gang i sekundet. Blir noe avvist,
   overlates neste forsøk til det vanlige pollet.

   **Rekkefølge innen en tabell**: `items.cat_id`/`groups.cat_id` er
   fremmednøkler til SIN EGEN tabell, så `pushOps` sorterer kategorier FØR
   medlemmene sine (i tillegg til foreldre-før-barn på radtype). Kategorier
   nøstes aldri, så ett nivå holder. `docFromMyState` kjører i tillegg
   `pruneDanglingCats`: en `cat` som ikke treffer en kategori i doc-en nulles,
   for en slik rad er umulig å skrive (FK) og ville låst synken for godt.
   Prunet skjer på VÅR side av flettingen, ikke bare i payloaden — ellers ville
   lokal state fortsatt påstått den døde kategorien, og fletteren sett en
   forskjell mot serveren hver runde. Visningen behandler allerede en hengende
   `cat` som nivå 1, så dette skriver bare ned det brukeren ser.

   **Skrivefeil forblir bevisst stille — UNNTATT skjema-avvik.** Supabase-
   klienten kaster ikke på en avvist skriving; feilen kommer i `result.error`.
   De aller fleste er forventet og skal ikke støye: RLS-avvisninger (en mottaker
   skriver på eierens rad) og transiente konflikter/FK er selv-legende. Men et
   **skjema-avvik** — appen sender en kolonne databasen ikke har fordi en
   migrering henger etter deployen — får PostgREST til å avvise HVER insert/
   update for radtypen. Det stoppet en gang all liste-/listepunkt-synk usynlig
   (cards/items.collapsed-hendelsen). `reportWriteResult`/`isSchemaMismatch`
   (i `pushOps`) fanger derfor KUN den klassen (`PGRST204`/`PGRST205`/`42703` +
   «could not find … column»/«schema cache»/«column … does not exist»): logger
   detaljene deduplisert og viser brukeren ÉN toast om at endringen ligger trygt
   lokalt men ikke nådde skyen (`schemaMismatchWarned`, nullstilles ved
   utlogging). For å hindre at en migrering i det hele tatt henger etter kjøres
   «Supabase DB-oppsett»-workflowen nå automatisk ved push til `main` — se
   `.github/workflows/db-setup.yml` og `TODO.md`.

   De øvrige feilene er fortsatt stille, men ikke lenger *usynlige*: avviser
   serveren SAMME rad `PERSISTENT_REJECTS` (3) ganger på rad, logges detaljene
   og brukeren får én toast om at én endring ikke nådde skyen (`noteReject`).
   Telleren nullstilles så snart raden går gjennom, så en forbigående konflikt
   aldri når terskelen. Det var nettopp en usynlig, evig avvist skriving (et
   listepunkt som pekte på en kategori serveren ikke hadde) som låste synken i
   praksis — se rekkefølge-/prune-avsnittet over og
   `tests/sync-dangling-category.test.js`.
4. **Realtime** `postgres_changes` på de seks tabellene + poll (5 s) +
   `visibilitychange`/`focus`/`online` → `scheduleCloud`.

Offline-buffer: `state` caches per bruker (`mine-lister-v1:<uid>`), uten intern
metadata (`stateReplacer` hopper over `_`-felt for å unngå sykliske refs — med
unntak av `_mine`, `_tomb`, `_hlc` og `_base`/`_baseV`).

### Gjenoppstandelse: hvorfor basen lagres og gravsteinene håndheves

`cloudBase` levde tidligere bare i minnet. Hver oppstart begynte derfor med en
TOM base, og første synk var i praksis `reconcile(emptyDoc(), local, remote)` —
der kombinasjonen «finnes lokalt, ikke på serveren, ikke i base» leses som en
**lokal nyopprettelse**. En klient med utdatert cache (en annen enhet, en gammel
fane, eller det andre domenet — `huskis.vercel.app` og `www.huskis.no` har hver
sin localStorage) satte da inn igjen alt den hadde og serveren ikke hadde,
inkludert permanent slettede objekter. `state._tomb` og `tombstones`-tabellen
fantes begge, men ingen av dem ble konsultert. Fire lag løser det:

1. **Basen overlever omstart.** Den lagres i den brukerspesifikke cachen, i
   SAMME `localStorage`-post som innholdet (én skriving → base og innhold kan
   ikke komme i utakt), med et versjonsnummer (`_baseV`, `BASE_VERSION`) så en
   framtidig endring av doc-fasongen forkaster gamle baser i stedet for å
   mistolke dem. Basen rykker fram KUN når fletteresultatet faktisk er tatt i
   bruk i `state` — ellers ville den beskrevet rader staten ikke har, og neste
   runde lest dem som «slettet lokalt» → push `DELETE` på gyldige rader. Og så
   lenge historikken er UAVKLART (se 2), skrives ingen gyldig base til disk i det
   hele tatt: tvilen lever bare i minnet, så en gyldig base på disk ville fått
   neste oppstart til å tro at den visste hva serveren hadde.
2. **Manglende base = ukjent historikk, ikke nyopprettelse** (`unknownHistory`,
   satt av `loadCache` til id-ene i en cache uten gyldig base). Bare DE radene er
   tvilsomme; de samles i `unverified` i stedet for å bli pushet. Klienten slår
   dem opp mot serverens `tombstones` (direkte tabell-select på
   `resource_id in (…)`, i porsjoner à 100, RLS: lesbar for innloggede),
   gravlegger treffene lokalt og fletter på nytt. De som overlever er ekte lokale
   nyopprettelser og pushes i samme runde — så en genuint ny liste blir ikke
   forsinket. Oppslaget skjer kun når det finnes tvilstilfeller, altså aldri i
   steady state. Alt brukeren lager ETTER at cachen ble lest er utvilsomt nytt og
   skrives som før, så et midlertidig feilende oppslag ikke kan stoppe vanlig
   bruk.
3. **Gravsteiner konsulteres i begge retninger** (`opts.tombs` = `tombIds()`,
   union av `state._tomb`). En gravlagt id havner aldri i `merged` og får aldri
   en insert; ligger den fortsatt på serveren, sendes en `delete` i stedet.
4. **Fremmede rader gjenskapes aldri** (`opts.foreign`): tvilsomme rader der
   cachen sier `_mine === false`. Forsvinner en slik rad fra serveren, er
   delingen opphørt eller eieren har slettet den — begge veier skal den slippes,
   for `insertPayload` ville satt OSS som `owner_id` og dermed gjort en gammel
   kopi av andres innhold til vår. Settet fryses for HELE runden (`doubted` i
   `cloudCycle`): den andre flettingen, etter gravsteins-oppslaget, må ta samme
   avgjørelse som den første — leste den `foreign` av det da-tømte tvilssettet,
   ville en tilbaketrukket deling glidd gjennom som en «lokal nyopprettelse».

Siste forsvarslag ligger i databasen: `guard_object_insert` avviser en insert
med gravlagt id (`PT409`, «gravlagt: …»). `pushOps` kjenner igjen svaret
(`isTombstoneReject`), gravlegger raden lokalt og regner det IKKE som en feilet
skriving — så bekreftelses-pullen går som normalt og raden forsvinner fra
visningen med det samme. Det fanger både en klient som ikke rakk å hente
gravsteinen og kappløpet der en annen enhet sletter i samme øyeblikk som vi
skriver. Se `docs/arkitektur-brukere-deling.md` og `docs/trash.md`.

Ved **utlogging** tømmes innhold, gravsteiner og base sammen (`resetLocalSync`),
og ved **innlogging** leses alle tre fra den nye brukerens egen cache-post (eller
nullstilles hvis den ikke finnes) — ingen del av forrige brukers synk-tilstand
kan leses som historikk for den neste.

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

Vakta har en konsekvens for BASEN: blir fletteresultatet ikke tatt i bruk (aktiv
redigering/draging), rykker `cloudBase` heller ikke fram. Ellers ville basen
beskrevet rader `state` ikke har, og neste runde lest dem som «slettet lokalt» —
en liste en annen enhet nettopp opprettet ville blitt SLETTET på serveren fordi
den kom mens brukeren skrev. Basen er per definisjon «fjern-doc'et vi har flettet
mot», og skal bare oppdateres når vi faktisk har flettet mot det.

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

> Rettighetsmodellen (hvem ser hvilke kontroller) er definert i
> [`rettigheter-og-deling.md`](rettigheter-og-deling.md). Del-UI-et er nå
> **permission-gated** ut fra `get_members.viewer`-flaggene (`can_admin`,
> `can_invite`, `can_manage_policy`) med et lokalt anslag for umiddelbar visning
> (`localIsAdmin`/`localCanInvite`/`localCanManageInvitePolicy`/
> `localCanManageLockException`, som stopper ved mount-grenser). Ikke bare eieren
> får den fulle visningen: en administrator (oppretter/superobjekt-oppretter)
> eller et vanlig medlem med inviterett får inviter-/medlemsvisningen; en ren
> mottaker uten inviterett får «Forlat deling» + forklaring.

- **Åpning av delings-UI-et**: for LISTER ligger delingen som egen seksjon i
  innstillingsmodalen (tannhjulet `.card-cog`, se `docs/scheduling.md`) —
  `renderShareOwner`/`renderShareRecipient` tar en `body`-container og deles
  med del-modalen. Univers og grupper deles fra del-knappene i nav-modalen
  (`.uni-share` på universkortet, `.group-share` på grupperaden) — hvert objekt
  har sin egen knapp, så man deler nøyaktig det man peker på. Knappene bygges av
  `buildUniverseCard`/`buildGroupRow` og vises kun når objektet er mitt eller
  montert (`_mine`/`_mount`); begge sender `openNavModal` som `backTo` så
  tilbakeknappen i del-modalen fører rett tilbake.
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
  - **Inviter** (`create_share_invite`): inviter-feltet vises for den som kan
    invitere (admin ELLER effektiv policy tillater). Raden («Venter på svar») vises
    og feltet tømmes straks; flere invitasjoner køes. Feiler den (ugyldig/duplikat/
    redundant/ikke synket), fjernes raden og feilen vises.
  - **Invitasjonspolicy** (`set_invite_policy`, egen overlay `policyOverrides`,
    nøkkel `policy:<type>:<id>`): en avmerkingsboks UNDER e-postfeltet — «Tillat
    andre å invitere folk til {universet/gruppen/listen}». Viser den EFFEKTIVE
    tilstanden, er interaktiv kun for `can_manage_policy`, ellers en lesbar status
    (`.share-policy-note`). Optimistisk + koalescert; en køet endring overstyrer
    ikke en mellomliggende pull (`policyOverrides` foran serververdi i `applyPerm`/
    `attachMeta`). Nye rader er `inherit` → effektiv tillat (dynamisk arv).
  - **Lås/åpne** (`set_locked`): knappen vender straks; spam koalesceres. Vises kun
    for administratorer (`perm.canAdmin`).
  - **Unntak fra arvet lås** (`set_unlocked`, `unlockOverrides`): når objektet har
    en **arvet lås** (`inheritedLockInfo` finner den nærmeste låsende forelderen),
    viser lås-feltet «Automatisk låst … Fordi [ikon][navn] er låst» og knappen «Gjør
    unntak». Knappen er nå kun synlig for **autoriserte** (`localCanManageLockException`
    = universeier ELLER oppretter av den låsende forelderen); en subobjekt-oppretter
    uten rett ser forklaringen, men ingen aktiv kontroll. Samme kø-mønster som
    `set_locked`. `frozen()` er admin-bevisst (opprettere fryses aldri av en lås).
  - **Medlemslisten** vises for alle med visningen, men administrative kontroller
    («Kast ut») kun for `perm.canAdmin`; «Trekk tilbake» kun på egne ventende
    invitasjoner (`inv.mine`) eller for admin.
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
- **Innboks** (i konto-modalen, badge på kontoknappen): godta (med plasseringsvalg,
  `accept_share_invite`), avslå (`decline_share_invite`) og «Plasser»
  (mount-patch) fjerner raden umiddelbart (`suppressedInvites`/
  `pendingPlacements`-filtrering) med RPC-en i køen; innholdet dukker opp når
  neste pull ser medlemskapet. Ved avvisning kommer raden tilbake + feil-toast.
  Hver invitasjonsrad viser **inviterendes navn** (`invites_in[].from_name` =
  `display_name`), ikke e-posten — `updateInbox` bruker `from_name || from`.

## Varsling ved deling (i appen + e-post)

Mottakeren varsles på to måter når noe deles med hen:

- **I appen (alltid)**: `updateInbox(my)` (kalt hver `cloudCycle`) setter en rød
  ring med antall (`#account-badge`) på kontoknappen — summen av `invites_in` (ikke
  besvarte) + `pendingPlacements` — og fyller «Invitasjoner»-innboksen i konto-
  modalen. Dette dekker **registrerte** mottakere fullt ut (de trenger ikke
  e-post).
- **På e-post (valgfritt)**: en `share_invites`-insert-trigger i databasen
  (`send_invite_email`, pg_net → Resend, `docs/arkitektur-brukere-deling.md`)
  sender en profilert Huskis-e-post (branded tabell-HTML + `text/plain`, PNG-
  logo, skifer/grønn-palett, escaping + `url_encode`). **Uregistrerte**
  mottakere får «Du er invitert» med lenke `<app_url>?signup=<e-post>`;
  **registrerte** får «‹objekt› er delt med deg» + åpne-appen-lenke, men kun
  hvis de har e-postvarsel PÅ. Resend-nøkkelen ligger i **Supabase Vault**
  (`app_config` er kun fallback for lokale tester); triggeren gjør ingenting uten
  nøkkel, og køleggingen logges i den låste `email_send_log` (`enqueue_status`,
  ikke leveringsstatus) — se `docs/arkitektur-brukere-deling.md`
  og `TODO.md`.
- **`?signup=<e-post>`-dyplenke** (`applySignupInvite`, i `initAccounts`): åpner
  auth-skjermen i **register**-modus med e-posten utfylt + en «du er invitert»-
  melding, så en uregistrert mottaker oppretter konto direkte. `handle_new_user`
  kobler den ventende invitasjonen på e-post ved registrering, og den dukker opp
  i innboksen straks mottakeren logger inn.
- **E-postvarsel-innstilling** (registrerte): en toggle i konto-modalen
  (`#email-pref-toggle`) lagrer `user_metadata.email_notifications` via
  `auth.updateUser({ data })` (optimistisk, `emailPrefOn`/`paintEmailPref`).
  Standard PÅ (manglende flagg → på). E-post-triggeren respekterer flagget for
  registrerte mottakere. Mock-backenden speiler `user_metadata` (samme vei som
  `nav`), så toggelen persisterer på tvers av «faner» i test.

## Navn, initialer og ansvarlig

- **Navn/initialer**: `display_name` = «Fornavn Etternavn». `initialsFromName`
  gir initialene (første bokstav i fornavn + etternavn), `personName` gir
  navnet (faller tilbake på e-post for uregistrerte/ventende invitasjoner).
  Del-modalen viser en initial-sirkel + navn for eier og hvert medlem
  (`avatarFor`, eier grønn / medlem grå — samme roller som før). Konto-modalens
  konto-avatar bruker samme navn/initialer (`my.user.display_name`).
- **Ansvarlig** (`item.responsible` OG `card.responsible`): objekter i delt
  kontekst (delt liste, eller liste under en delt gruppe/univers —
  `shareRootFor`) kan få en ansvarlig — både hvert listepunkt og hele listen.
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

Fire skranker håndhever mocken bevisst, fordi en slapp mock ville sluppet
regresjonene gjennom: **id-er må være UUID-er** (`UUID_RE` i `applyInsert` —
testrader trenger derfor ekte UUID-er, ikke `'card-1'`), **`items.cat_id`/
`groups.cat_id` må peke på en kategori som finnes** (`catFkError`, avviser med
`23503` som ekte Postgres), **samme id kan ikke settes inn to ganger**
(primærnøkkel), og **gravsteiner blokkerer gjeninnsetting** (`tombstoneError`,
avviser med `PT409` som `guard_object_insert`). Kaskade-sletting skriver
gravstein for HVER slettet rad, ikke bare toppen — akkurat som `on delete
cascade` + AFTER DELETE-triggerne i Postgres.

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
