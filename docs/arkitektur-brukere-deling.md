# Arkitektur: brukere, eierskap og deling

Grunnmuren for brukerkontoer og deling i Huskis. Databasesiden er
implementert i [`supabase/users-and-sharing.sql`](../supabase/users-and-sharing.sql)
(idempotent, kjøres av Actionen «Supabase DB-oppsett»). Klientsiden er beskrevet
i [`accounts.md`](accounts.md).

## Oversikt

```
Supabase Auth (e-post + passord, bekreftelseslenke)
        │ 1:1 (trigger)
   profiles ──────────────┐
        │ owner_id = created_by (ren historikk, ingen rettigheter)
   universes ─ groups ─ cards («lister») ─ items      ← kanonisk innhold
        ▲          ▲
        └──────────┴── memberships (ROLLER: owner | member) ← all myndighet
                       share_invites (m/ rolle)             ← invitasjoner på e-post
                       tombstones                           ← mot gjenoppliving offline
```

Deling finnes **kun på universer og grupper**. Lister, kategorier og listepunkter
arver tilgangen. `supabase/setup.sql` dropper den gamle éndoc-modellen
(`public.lists` + `get_list`/`save_list`).

Den autoritative rettighetsmodellen står i
[`rettigheter-og-deling.md`](rettigheter-og-deling.md); dette dokumentet
beskriver databasesiden.

## Identitet og registrering

- **Supabase Auth** med e-post + passord (`supabase.auth.signUp`). Med
  «Confirm email» PÅ (standard) sender Supabase bekreftelses-e-posten med
  lenke automatisk, og brukeren kan ikke logge inn før e-posten er bekreftet.
- `public.profiles` speiler `auth.users` via trigger (`handle_new_user`):
  opprettes ved registrering, e-post holdes synkron (lowercase). `display_name`
  = «Fornavn Etternavn» (fanges fra `raw_user_meta_data->>'display_name'`).
  Triggeren kobler også **ventende invitasjoner** sendt til e-posten før kontoen
  fantes. Klienten kan kun endre `display_name` (kolonne-grant), aldri e-posten.
- RLS: hver bruker ser kun sin egen profil. Medlemslister hentes via
  `get_members()` (som krever tilgang til objektet).

## Datamodell

Fire objekttabeller — `universes` > `groups` > `cards` (= «lister» i UI-et)
> `items` — med `on delete cascade` nedover. Hver rad har:

- `owner_id` — **oppretteren** (`created_by`). Uforanderlig (trigger-vakt), og
  gir **ingen** rettigheter. Kolonnenavnet er beholdt av migreringshensyn.
- `trashed` — søppelkasseflagget, **felles** for alle med tilgang.
- `locked`/`unlocked` (ikke på items) — lås/unntak, se «Låsing».
- `invite_policy` (kun universes/groups) — `inherit`/`allow`/`deny`.
- LWW-registre: `ts`/`org` (innhold), `pos_ts`/`pos_org` (posisjon +
  forelder-peker), `lab_ts`/`lab_org` (K/P på cards). **Håndheves på serveren**:
  BEFORE UPDATE-triggere lar en skriving med eldre register-stempel tape mot
  dataene som står. Klienten MÅ stemple registrene ved endring.
- Id-er er `uuid` og kan genereres på klienten (`crypto.randomUUID()`).
- `cards.responsible` / `items.responsible` (FK til `profiles`,
  `on delete set null`): ansvarlig bruker. Kandidatene er gruppens **effektive**
  medlemsliste. Rir på innholds-registeret.

### Roller (`memberships`)

Én rad = én brukers ROLLE på ETT delbart objekt (univers **eller** gruppe):

| Kolonne | Betydning |
|---|---|
| `user_id` | brukeren |
| `universe_id` / `group_id` | nøyaktig én er satt (CHECK) |
| `role` | `'owner'` \| `'member'` |
| `pos` | brukerens **personlige** rekkefølge (toppnivå-universer, frie grupper) |

* Eiere **har** en rad — det er nettopp den som gjør eierskapet mutabelt.
* `card_id` er pensjonert: kolonnen står igjen for migreringens skyld, men en
  CHECK holder den `null`. Det samme gjelder `share_invites.card_id`.
* Mount-kolonnene (`parent_universe_id`, `parent_group_id`, `trashed`) er
  **droppet** — mottakeren velger ikke lenger sin egen forelder.
* `INSERT` er ikke gitt til `authenticated`: roller opprettes kun av
  SECURITY DEFINER-veiene (`accept_share_invite` og opprettelses-triggerne
  `universes_after_insert` / `groups_after_insert`).

**Siste-eier-invarianten** håndheves av `memberships_before_update` og
`memberships_before_delete` (feilkode `PT422`), altså også mot rå SQL. Kaskader
(universet eller brukeren slettes) hoppes over.

## Tilgangsmodell

* `can_read_universe` = brukeren har en universrolle. Et univers leses **aldri**
  av en direkte gruppemottaker — navn og medlemsliste lekkes ikke.
* `can_read_group` = **effektivt** gruppemedlemskap: direkte grupperolle ELLER
  en hvilken som helst universrolle på gruppens kanoniske univers.
* `can_read_card` / listepunkter følger gruppen.

Alt håndheves med RLS-policyer bygget på SECURITY DEFINER-funksjoner (ingen
policy-rekursjon). `anon` har null tilgang.

Capabilities beregnes av `universe_caps()` / `group_caps()` og returneres til
klienten i `get_my_doc()` og `get_members().viewer.caps`.

## Deling (invitasjon → aksept → rolle)

1. `create_share_invite(type, id, email, role)` — `type` er `'universe'` eller
   `'group'`; `role` er `'member'` eller `'owner'`. Medlemsinvitasjoner krever
   `can_invite_to` (eier på nivået, eller et medlem når policyen tillater det);
   **eierskaps**-invitasjoner krever `can_invite_owner` (kun eiere). Mottakeren
   trenger ikke ha konto — invitasjonen kobles ved registrering. Redundante
   medlemsinvitasjoner avvises; en eierskaps-invitasjon til en som allerede har
   tilgang er gyldig (det er rolleløftet).
2. Mottakeren ser invitasjonen i `get_my_doc().invites_in` og aksepterer med
   `accept_share_invite(invite)`. **Ingen plassering velges.** Universet havner
   i «Mine universer» / «Universer delt med meg» etter rolle; en gruppe vises
   inne i universet hvis mottakeren er universmedlem, ellers i «Grupper delt med
   meg».
3. Aksepten oppretter (eller løfter) medlemskapsraden og legger objektet bakerst
   i mottakerens personlige rekkefølge. For en universinvitasjon ryddes samtidig
   redundante ordinære direkte gruppemedlemskap i universet.

Viktige egenskaper:

- **`set_member_role`** degraderer (eier → medlem). Rolleløft går alltid gjennom
  en invitasjon mottakeren må godta.
- **`revoke_share(type, id, user)`** krever `can_manage_members`. For et univers
  fjerner den ALL underliggende direkte tilgang (`purge_universe_access`); for en
  gruppe kun den direkte grupperollen. En universarvet bruker kan ikke fjernes
  fra én enkelt gruppe — RPC-en avviser med `PT409` og en forklaring.
- **`leave_share(type, id)`** er brukerens egen utgang, med samme opprydding.
  Siste universeier blokkeres (`PT422`). For en gruppe kreves at den direkte
  grupperollen er ENESTE vei inn: har man også en rolle i gruppens univers,
  avvises kallet med `PT409` og en peker til universet (`can_leave`) — å slette
  den overflødige raden ville sett ut som en forlatelse uten å fjerne tilgang.
- Begge nullstiller `responsible`-referanser som mister effektiv tilgang, med et
  ferskt innholds-register (`org = 'server'`) så LWW slipper endringen gjennom.
- **`move_group(group, universe, cat, pos)`** er den ENESTE veien en gruppe
  bytter univers. Se `rettigheter-og-deling.md` del 11 for semantikken
  (reorder / reparent / copy) — og merk at `groups_before_update` avviser en
  direkte skriving av `universe_id`.

## Låsing (med unntak for arvet lås)

> Full modell + autorisasjon: [`rettigheter-og-deling.md`](rettigheter-og-deling.md).

`locked`/`unlocked` på universes/groups/cards er **gjensidig utelukkende** per rad,
så hver node har én av tre tilstander: *låst*, *unntak (åpnet)*, eller *arv*.
`set_locked` styres av `can_manage_lock` (= `is_privileged`: universeier for et
univers, gruppeeier for gruppe/liste). `set_unlocked` (unntak fra en ARVET lås)
styres av `can_manage_lock_exception`: universeiere alltid, og — når den arvede
låsen er satt på en GRUPPE — også en eksplisitt gruppeeier der. En gruppeeier kan
altså ikke åpne en gren i strid med en universlås.

Effektiv redigeringsstatus for et **vanlig medlem** = den nærmeste eksplisitte
tilstanden fra objektet og oppover (`effective_lock_source`). Eiere på nivået kan
**alltid** redigere (`can_edit_content = is_privileged OR NOT
is_effectively_locked`). Lesing påvirkes aldri av lås.

**Posisjon er skilt fra innholdslås**: retten til å endre et objekts rekkefølge i
superobjektet styres av `can_reorder_in_parent` (= innholdsredigering på
superobjektet), ikke av objektets egen lås. En låst liste kan dermed flyttes blant
søsken når gruppen er åpen. Vaktene (`*_before_update`) håndhever dette
feltspesifikt.

Følger: lås på et univers fryser alt under for vanlige medlemmer, MEN en autorisert
bruker kan gjøre et **unntak** for en konkret gruppe/liste under (`unlocked =
true`), og et enda lavere nivå kan låses på nytt inni et unntak.
Nærmeste-eksplisitt-regelen håndterer vilkårlig nøsting. Finnes det ingen arvet
lås, er «unntak» en overflødig flaggverdi — da kan den som ellers styrer objektets
lås rydde den bort.

## Invitasjonspolicy (tretilstands dynamisk arv)

`invite_policy` (`inherit`/`allow`/`deny`) på **universes og groups** styrer om
vanlige medlemmer kan invitere flere. Effektiv verdi = nærmeste eksplisitte fra
objektet og oppover; ingen eksplisitt noe sted → tillat. Nye rader er `inherit`
(dynamisk arv). `set_invite_policy` styres av `can_manage_invite_policy`: eiere på
nivået, men under en arvet `deny` fra universet kun universeiere. Listespesifikk
policy er fjernet — `cards.invite_policy` er pensjonert og leses aldri.
Policyen gir **aldri** rett til å invitere eiere.
Full modell: [`rettigheter-og-deling.md`](rettigheter-og-deling.md).

## Sletting, søppel og gravsteiner

- `trashed`-flagg = søppelkasse (reversibel). Den er **felles** for alle med
  tilgang — det finnes ingen egen mottaker-søppelkasse lenger. Hvem som kan sette
  den styres av `can_delete_object` (håndhevet i `*_before_update`): for et
  univers kun eiere, for en gruppe eiere eller et universmedlem når gruppen er
  effektivt åpen. Å **forlate** en deling er noe annet — det rører aldri
  innholdet, bare egen tilgang.
- Tømming = hard `DELETE`. AFTER DELETE-triggere skriver **gravsteiner**
  (`tombstones(resource_type, resource_id, ts)`) — én rad per slettet objekt,
  også for barna, siden `on delete cascade` sletter dem rad for rad og deres
  egne triggere fyrer.
- **Gravsteinene håndheves av databasen** (`guard_object_insert`, BEFORE INSERT
  på alle fire objekttabellene): en id med gravstein kan ikke settes inn igjen.
  Avvisningen har en distinkt SQLSTATE, `PT409`, med meldingen «gravlagt: …»,
  så klienten kan skille den fra andre feil og gravlegge raden lokalt i stedet
  for å prøve igjen. Dette er hele poenget med at regelen ligger i databasen:
  den gjelder også for en gammel klientversjon, en modifisert klient og en rå
  `INSERT`/`UPSERT` mot PostgREST. (Fram til denne runden ble tabellen skrevet,
  men aldri konsultert — en klient med utdatert lokal cache kunne sende en helt
  ordinær insert og få det slettede objektet tilbake.)
- Samme vakt validerer at **`owner_id` er den innloggede brukeren**. RLS krever
  det samme ved insert, men her ligger regelen i selve skrive-veien, uavhengig
  av policy-oppsettet: en gammel kopi av andres delte objekt kan verken
  gjenopplives eller settes inn med avsenderen som ny oppretter.
- **Gravsteinene utløper aldri.** En klient som har ligget ubrukt i et år (en
  gammel telefon, en annen nettleser, det andre domenet) har fortsatt sin gamle
  lokale kopi og skal møte gravsteinen når den endelig synker igjen. Rydding må
  ikke innføres uten en dokumentert, sikker mekanisme.
- **Eneste automatiske opprydding**: `import_doc` fjerner gravsteinene for
  nøyaktig de id-ene importen skriver (utledet av brukerens egen uid via
  `legacy_uuid`). Uten det ville insert-vakten blokkert en re-import for en
  bruker som tidligere har slettet noe permanent. En administrator som bevisst
  vil gjenopprette noe (f.eks. fra sikkerhetskopi) må slette gravsteinen manuelt
  først: `delete from public.tombstones where resource_id = '<id>';`
- Klienten leser tabellen direkte (`select resource_type, resource_id where
  resource_id in (…)`, RLS: lesbar for innloggede) når den mangler synk-base og
  må avgjøre om en lokal rad er ny eller slettet — se `docs/accounts.md`.

## Klient-API (fase 2 bygger på dette)

| Kall | Rolle |
|---|---|
| `supabase.auth.signUp/signInWithPassword/…` | registrering/innlogging (bekreftelses-e-post håndteres av Supabase) |
| `get_my_doc()` | hele brukerens datasett som ETT flatt jsonb-doc: universes/groups/cards/items + `role`, `free`, `personalPos`, `ownerKey`, `shared` og `caps` + invitasjoner |
| vanlige `insert/update/delete` på tabellene | CRUD med RLS + server-side LWW; klienten stempler `ts/org`-registrene som i dag |
| `import_doc(doc)` | engangs-migrering av lokalt/legacy doc til egne data (deterministiske id-er per bruker, idempotent) |
| `create_share_invite(type, id, email, role)` / `accept_share_invite(invite)` / `decline_share_invite` / `revoke_share_invite` | delingsflyt, medlem eller eierskap; aksept krever ingen plassering |
| `revoke_share` / `set_member_role` / `leave_share` / `set_locked` / `set_unlocked` / `set_invite_policy` / `get_members` | administrasjon (roller, låsing + unntak, invitasjonspolicy; `get_members` gir `viewer.caps`) |
| `move_group(group, universe, cat, pos)` | ATOMISK gruppeflytting: reorder / reparent / kopier-og-slett med id-mapping |
| `update memberships set pos` (egen rad) | personlig rekkefølge (toppnivå-universer + frie grupper) |
| Realtime `postgres_changes` på tabellene | live-oppdatering (tabellene ligger i `supabase_realtime`-publikasjonen) |

## Migrering fra dagens modell

1. Bruker registrerer seg / logger inn (fase 2-UI).
2. Klienten normaliserer sitt lokale doc med dagens migreringssteg
   (`migrateTabsToGroups` → `migrateGroupsToUniverses` → flatt doc) og
   kaller `import_doc(doc)`.
3. Id-mapping er `md5(uid || ':' || gammel_id) → uuid`: deterministisk per
   bruker (re-kjøring er idempotent) og to brukere som importerer samme
   gamle delte doc får hver sin uavhengige kopi (deling gjenopprettes
   eksplisitt med den nye delingsmodellen).
4. Den gamle `lists`-tabellen + mønster-låsen er pensjonert (`setup.sql`
   dropper dem); migrering av lokale data skjer ved første innlogging.
5. **Rolle-backfill + migrering av gamle listedelinger** kjøres én gang av
   `users-and-sharing.sql` (markert i `public.migration_log`). Se
   `rettigheter-og-deling.md` del 13.

## Testing

`supabase/tests/` inneholder en hermetisk testsuite (ren PostgreSQL 16,
Supabase-miljøet stubbes med `local-stub.sql` — samme
`request.jwt.claim.sub`-mekanikk som PostgREST):

```bash
# med en lokal postgres på 5433 og tom database hk_test:
PGHOST=... PGPORT=5433 PGUSER=postgres PGDATABASE=hk_test supabase/tests/run-tests.sh
```

Suiten har **to løp**: ett vanlig (nytt skjema, migreringen kjørt to ganger for
idempotens) og ett **oppgraderingsløp** der `tests/legacy-share-fixture.sql`
legger inn den GAMLE databasefasongen med data før migreringen kjøres.

Dekning: profil-trigger, RLS-isolasjon, rollemodellen (eiere/medeiere,
siste-eier-invarianten, degradering, capabilities), effektivt gruppemedlemskap og
medlemslistens kategorier, invitasjoner (medlem + eierskap + avviste liste-
invitasjoner), låser og unntak, sletting/forlatelse med opprydding av ansvar,
personlig rekkefølge, gruppeflytting (reorder/reparent/kopier-og-slett med
gravsteiner), server-side LWW, import (determinisme + idempotens + foreldreløse),
gravsteiner, anon-avvisning og hele migreringen av gamle listedelinger.

## Manuelle steg (utenfor SQL — én gang, i Supabase-dashboardet)

1. **Authentication → Sign In / Up**: «Confirm email» skal stå PÅ (standard).
2. **Authentication → URL Configuration**: *Site URL* og *Redirect URLs* skal
   kun inneholde det kanoniske originet `https://huskis.no` — de alternative
   domenene 308-redirecter dit og kjører aldri en klient. Klienten sender
   uansett alltid en eksplisitt, betrodd `redirectTo`/`emailRedirectTo`
   (`authRedirectUrl()`, se `docs/domains-and-urls.md` — autoritativ for
   domener/URL-generering).
3. (Anbefalt før mange brukere) **Authentication → Emails/SMTP**: egen
   SMTP-avsender; Supabase sin innebygde e-postutsending er strengt
   ratebegrenset (~2–4 e-poster/time) og kun ment for utvikling.
4. **E-postvarsel ved deling** (valgfritt): aktiver `pg_net` (Database →
   Extensions), legg Resend-nøkkelen i **Supabase Vault** (`vault.create_secret`)
   og avsender/app-URL i `public.app_config`. Da e-poster
   `send_invite_email`-triggeren mottakeren ved hver ny invitasjon — se
   `docs/accounts.md` og `TODO.md`.

## E-postvarsel ved deling (`send_invite_email`)

En AFTER INSERT-trigger på `share_invites` (`send_invite_email`, SECURITY
DEFINER, `search_path = public, extensions, net`) sender en profilert Huskis-
e-post via `net.http_post` (pg_net) til Resend (`api.resend.com/emails`). Kroppen
er tabellbasert HTML med inline CSS (trygg fontstakk `Arial, Helvetica, sans-
serif` — ingen webfont), PNG-logo fra `https://huskis.no/assets/email/
huskis-logo.png` (kanonisk domene, uten `www` — se `docs/domains-and-urls.md`),
skifer/grønn-palett fra designsystemet, preheader-tekst,
stylet `<a>`-knapp og en `text/plain`-variant. To varianter:

- **Uregistrert mottaker** (`invitee_id is null`): «Du er invitert til Huskis» +
  lenke `<app_url>?signup=<e-post>` → registreringssiden med e-posten utfylt.
  `handle_new_user` kobler den ventende invitasjonen ved registrering.
- **Registrert mottaker**: «‹objekt› er delt med deg» + åpne-appen-lenke, MEN
  kun hvis `auth.users.raw_user_meta_data->>'email_notifications'` ikke er
  `'false'` (standard på; klienten setter flagget via `auth.updateUser`).

**Hemmelighet:** selve Resend-nøkkelen bor i **Supabase Vault** (kryptert i ro;
`vault.decrypted_secrets` er kun lesbar for eier-rollen), lagt inn via dashboard
eller Supabase-integrasjonen under secret-navnet `resend_api_key` — aldri i Git/
PR/logg/chat. Triggeren leser Vault først og faller tilbake til
`public.app_config` KUN så det hermetiske test-miljøet (uten Vault) kan kjøre; i
produksjon skal nøkkelen ikke ligge i app_config. Ikke-hemmelig konfig
(`email_from`, `app_url`) ligger i `public.app_config` (RLS på, ingen policyer/
grants, EXECUTE/SELECT revoked fra public/anon/authenticated → kun SECURITY
DEFINER-funksjoner leser den; ingen `cfg()`-RPC som kunne lekket verdien).

**Sikkerhet i kroppen:** brukerstyrt tekst (inviter-navn, objektnavn, over-
skrifter, synlig lenketekst) HTML-escapes med `html_escape`; URL-parametre
prosent-kodes med `url_encode` (byte-sikker RFC 3986, erstatter de gamle
manuelle `replace`-kjedene); JSON bygges med `jsonb_build_object`.

**Observabilitet — merk pg_net er asynkron:** `net.http_post` KØLEGGER
forespørselen og returnerer en request-id; selve HTTP-kallet til Resend skjer
først etter commit, og svaret (HTTP 2xx/4xx/5xx) lander senere i
`net._http_response`. Triggeren kan derfor bare vite om forespørselen ble kølagt,
ikke om Resend aksepterte/leverte. Kølegging logges i den låste tabellen
`public.email_send_log` (invitasjons-id, variant, `net_request_id`,
`enqueue_status` = `enqueued`/`enqueue_error`, ev. `SQLERRM` — aldri nøkkel,
Authorization-header, kropp eller mottakeradresse). `enqueued` betyr **ikke**
accepted/delivered/successful — det FAKTISKE HTTP-resultatet korreleres via
`net_request_id` mot `net._http_response` (kortvarig diagnostikk; pg_net rydder
tabellen). Uten en Resend-nøkkel returnerer triggeren umiddelbart (`return new`).
En **synkron** feil (f.eks. selve køleggingen feiler) fanges (`exception when
others`), logges som `enqueue_error` og blokkerer aldri selve invitasjonen; en
senere **asynkron** Resend-feil er ikke en trigger-exception og finnes kun i
`net._http_response`. Resend-webhooks for varig leveringsstatus er en mulig
senere forbedring, ikke implementert nå.
