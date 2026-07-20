# Rettigheter og deling — hierarkisk myndighet, lås og invitasjon

Denne fila er den autoritative definisjonen av **hvem som får gjøre hva** i
Huskis. Databasesiden ligger i
[`supabase/users-and-sharing.sql`](../supabase/users-and-sharing.sql) (idempotent),
mock-backenden speiler den (`mock-backend.js`, `?mock=1`), og klientsiden i
`app.js`. All autorisasjon håndheves **serverside** (RLS + `BEFORE UPDATE`-vakter
+ SECURITY DEFINER-RPC-er); klienten viser bare/skjuler kontroller for en bedre
UX og kan aldri omgå reglene.

Se også [`arkitektur-brukere-deling.md`](arkitektur-brukere-deling.md) (tabeller,
mounts, søppel, LWW) og [`accounts.md`](accounts.md) (klient-UI, synk, opQueue).

## Terminologi

- **Supernivå** — nivået over en objekttype: lister er supernivået til
  listepunkter, grupper til lister, universer til grupper. **Kategorier holdes
  utenfor** denne inndelingen (en kategori er teknisk et listepunkt).
- **Subnivå** — nivået under en objekttype.
- **Superobjekt** — objektet i det umiddelbare supernivået (en listes superobjekt
  er gruppen den ligger i).
- **Subobjekt** — et objekt i det umiddelbare subnivået.
- **Oppretter** — brukeren som opprettet objektet. Lagres som radens `owner_id`.
  **Kolonnenavnet `owner_id` betyr «oppretter» på ALLE objektrader** — det er
  beholdt teknisk (en omdøping ville vært en risikabel migrering), men det er
  ikke «eieren» i betydningen universeier. Oppretteren har full myndighet over
  objektet og **alle objekter i samtlige subnivåer under det**, men ingen
  rettigheter over superobjekter andre har opprettet.
- **Eier** (universeier) — brukeren som opprettet **rot-universet**, altså
  `owner_id` på universe-raden. Eieren har full myndighet over hele universet og
  alt i det, **uten unntak**.

I koden:

| Begrep | Hjelpefunksjon (SQL) | Betydning |
|---|---|---|
| oppretter | `resource_creator(type, id)` (= `resource_owner`, synonym) | `owner_id` på raden |
| universeier | `resource_universe_owner(type, id)` | `owner_id` på rot-universet |
| privilegert administrator | `can_admin_resource(type, id, uid)` | eier ELLER oppretter av objektet/et superobjekt |
| innholdsredigering | `can_edit_content(type, id, uid)` | respekterer arvet lås |
| posisjonsendring | `can_reorder_in_parent(type, id, uid)` | superobjektets organisering, skilt fra innholdslås |
| unntak fra arvet lås | `can_manage_lock_exception(type, id, uid)` | hvem kan åpne en arvet lås for andre |
| effektiv invitasjonspolicy | `effective_invite_policy(type, id)` | tretilstands dynamisk arv |
| invitere | `can_invite_to(type, id, uid)` | admin ELLER (lesetilgang + policy tillater) |
| styre policy | `can_manage_invite_policy(type, id, uid)` | hvem kan endre invitasjonspolicyen |

## Grunnleggende myndighet (privilegert administrator)

For et gitt objekt regnes disse som **privilegerte administratorer**
(`can_admin_resource`):

- universeieren,
- objektets egen oppretter,
- oppretteren av **hvert superobjekt** mellom objektet og universet.

Eksempel — A oppretter universet, B en gruppe i det, C en liste i gruppen:

| | universet | gruppen (B) | listen (C) | listepunktene |
|---|---|---|---|---|
| **A** (eier) | ✔ | ✔ | ✔ | ✔ |
| **B** (gruppeoppretter) | — | ✔ | ✔ | ✔ |
| **C** (listeoppretter) | — | — | ✔ | ✔ |

Full myndighet omfatter: redigering, navneendring, tidsplan/innstillinger,
opprettelse av subobjekter, sletting/gjenoppretting/permanent sletting, deling og
invitasjoner, låsing og åpning, medlems-/invitasjonsadministrasjon,
rekkefølge-endring, og flytting når det ellers er strukturelt gyldig. **Dette
gjelder også når objektet eller et superobjekt er låst** — en lås begrenser
vanlige medlemmer, aldri universeieren eller en relevant oppretter.

## Redigeringslås (arv + unntak)

Hver universe/gruppe/liste har én av tre tilstander via `locked`/`unlocked`
(gjensidig utelukkende per rad): **låst**, **unntak (åpnet)**, eller **arv**
(ingen av delene). Listepunkter har ingen egen lås — de følger listen sin.

**Effektiv redigeringsstatus for et vanlig medlem** = den **nærmeste eksplisitte
tilstanden** fra objektet og oppover (`effective_lock_source`):

- eksplisitt låst → redigering sperret,
- eksplisitt unntak → redigering tillatt,
- ingen eksplisitt tilstand → fortsett til superobjektet,
- ingen noe sted → tillatt.

Universeieren og relevante opprettere kan **alltid** redigere
(`can_edit_content` = `can_admin_resource OR NOT is_effectively_locked`).
Endringer i låsetilstand får virkning umiddelbart; det finnes ingen historisk
«låst fra start»-semantikk.

Når et univers/en gruppe/en liste er låst, kan et vanlig medlem bare LESE i hele
undertreet (ingen opprettelse, sletting, navn-/innstillings-/tidsplan-/kategori-/
listepunkt-endring, rekkefølge eller flytting) — med mindre et eksplisitt unntak
åpner en gren.

### Unntak fra arvet lås

Et objekt som er låst **fordi et superobjekt er låst** kan åpnes som et eksplisitt
unntak (`unlocked = true`). Tillatelse til å opprette/fjerne unntaket
(`can_manage_lock_exception`) har **kun**:

- universeieren, og
- oppretteren av det **nærmeste superobjektet som faktisk innfører den effektive
  låsen** (`inherited_lock_source`).

Oppretteren av det låste subobjektet kan fortsatt redigere objektet selv (som
oppretter), men kan **ikke** åpne det for andre i strid med en lås satt høyere av
en annen oppretter. Eksempler:

- Univers låst av eieren → bare eieren kan gjøre en gruppe til unntak (ikke
  gruppeoppretteren).
- Gruppe låst av gruppeoppretteren → gruppeoppretteren OG universeieren kan gjøre
  en liste i gruppen til unntak.
- En liste åpnet som unntak kan fortsatt inneholde et lavere eksplisitt
  låsepunkt — **en lavere eksplisitt lås vinner over et høyere unntak** (følger av
  nærmeste-eksplisitt-regelen).

Meldingene i klienten peker på det objektet som innfører den nærmeste effektive
låsen (ikon + navn, satt XSS-sikkert som tekstnode). Avmerkingsboksen for unntak
vises kun for autoriserte; en subobjekt-oppretter uten rett ser forklaringen, men
ingen aktiv kontroll.

## Rekkefølge og posisjon (skilt fra innholdslås)

Et objekts **posisjon** tilhører superobjektets organisering av subobjektene, ikke
objektets egen innholdslås. Retten styres av `can_reorder_in_parent`, som =
`can_edit_content` på **superobjektet**:

- En eksplisitt låst liste kan flyttes blant søsken hvis **gruppen** er åpen og
  medlemmet har redigeringstilgang til gruppen — men navn/tidsplan/ansvarlig/
  deling og andre attributter kan ikke endres.
- Er **gruppen** låst, kan medlemmet ikke endre listenes rekkefølge.
- Tilsvarende for grupper i et univers og listepunkter i en liste.
- Flytting til et annet superobjekt krever rettigheter i **både** kilde- og
  målstruktur (`can_edit_content` på begge foreldre).
- Personlig plassering av direkte delte røtter går fortsatt via mount-semantikken
  (`memberships`), uendret.

Serverside håndheves dette feltspesifikt: RLS `update`-policyen slipper gjennom
den som kan endre **innhold ELLER posisjon**, og `*_before_update`-vaktene
reverterer innholdsfelt uten `can_edit_content` og posisjonsfelt uten
`can_reorder_in_parent`. Slik kan en reorder-tilgang aldri snike inn endringer i
låste innholdsfelt selv om klienten skulle sende dem.

## Invitasjonsrett (tretilstands dynamisk arv)

Hver universe/gruppe/liste har en `invite_policy`: **`inherit` | `allow` |
`deny`** — styrer om **vanlige medlemmer** (ikke opprettere/eier) kan invitere
flere. Nye rader opprettes med `inherit` (kolonne-standard), så en policy-endring
høyere oppe slår straks gjennom på alle arvende subobjekter — **dynamisk arv, ikke
en kopiert boolsk verdi**.

**Effektiv policy** (`effective_invite_policy`) = nærmeste eksplisitte
(`allow`/`deny`) fra objektet og oppover; ingen eksplisitt noe sted → **tillat**
(rot-standard). Konsekvenser:

- Endres et univers fra tillat til `deny`, sperres eksisterende grupper/lister
  uten eget unntak straks.
- En gruppe kan ha et `allow`-unntak selv om universet nekter; en liste kan
  `deny` selv om gruppen tillater; en liste kan `allow` som unntak fra en
  gruppe-sperre (om rett bruker autoriserer). En lavere eksplisitt `deny` vinner
  over en høyere tillatelse.

Migreringen gir alle eksisterende rader `inherit` → effektiv **tillat**, så dagens
funksjonalitet ikke innskrenkes.

### Hvem kan invitere? (`can_invite_to`)

En bruker kan invitere direkte til et objekt hvis minst ett stemmer:

- er universeier, oppretter av objektet, eller oppretter av et superobjekt
  (= privilegert administrator), **eller**
- har lesetilgang OG effektiv invitasjonspolicy tillater videreinvitasjon.

Et vanlig medlem med effektiv inviterett kan invitere nye folk direkte og trekke
tilbake **sine egne** ventende invitasjoner. Det kan **ikke** kaste ut medlemmer,
trekke tilbake andres invitasjoner, endre policy/lås/unntak, eller administrere
delinger på superobjekter det ikke administrerer. Universeieren og relevante
opprettere kan invitere uansett policy, trekke tilbake **alle** ventende
invitasjoner i sitt myndighetsområde, kaste ut **direkte** medlemmer, og endre
policyen (innenfor reglene under). Arvede medlemmer administreres der delingen
faktisk ble opprettet — «Kast ut» tilbys ikke på et subobjekt for en som bare har
arvet tilgang ovenfra.

### Hvem kan endre policyen? (`can_manage_invite_policy`)

- Uten en arvet sperre: universeieren, objektets oppretter, eller en
  superobjekt-oppretter (= privilegert administrator).
- Når et superobjekt har eksplisitt `deny`, kan et `allow`-unntak på subobjektet
  kun opprettes/fjernes av universeieren ELLER oppretteren av det nærmeste
  superobjektet som innfører sperren (`inherited_invite_source`) — parallelt med
  lås-unntak. Subobjektets oppretter kan fortsatt invitere til sitt eget objekt
  (privilegert), men kan ikke slå på videreinvitasjon for alle andre i strid med
  en høyere sperre.

### Redundante invitasjoner

En invitasjon avvises hvis mottakeren allerede har **effektiv** tilgang — også
arvet fra et delt superobjekt (`can_read`). Additiv deling med flere personer på
lavere nivåer består, men samme person kan ikke inviteres redundant til et
subobjekt hen allerede når via en deling over.

## Servermodell (nøkkelfunksjoner)

Alle er `SECURITY DEFINER` med eksplisitt `search_path = public`, minimale grants
(kun `authenticated`), og håndterer `auth.uid() is null` (psql/vedlikehold →
hopper over autorisasjon, kun LWW). De leser via definer-rettigheter og
introduserer ingen RLS-rekursjon.

- Oppslag: `resource_creator`, `resource_owner` (synonym), `resource_universe_owner`.
- Tilgang: `can_read_*`, `can_read`, `can_admin_resource`, `can_edit_content`,
  `can_edit_universe/group/card` (synonymer for `can_edit_content`),
  `can_reorder_in_parent`.
- Lås: `effective_lock_source`, `is_effectively_locked`, `inherited_lock_source`,
  `can_manage_lock_exception`.
- Invitasjon: `effective_invite_source`/`_policy`, `inherited_invite_source`,
  `can_invite_to`, `can_manage_invite_policy`.
- RPC-er: `create_share_invite` (nå `can_invite_to` + redundans-sjekk),
  `revoke_share_invite` (egen ELLER admin), `revoke_share` (admin),
  `set_locked` (admin), `set_unlocked` (`can_manage_lock_exception`),
  `set_invite_policy` (ny, `can_manage_invite_policy`), `get_members` (nå med
  `viewer`-flagg, `invite_policy`/`invite_effective`, og `by`/`by_name`/`mine`
  per ventende invitasjon).
- Vakter (`*_before_update`): `owner_id` uforanderlig; `locked`/`unlocked`/
  `invite_policy` kun av rett autoritet (RAISES); innhold reverteres uten
  `can_edit_content`; posisjon reverteres uten `can_reorder_in_parent`; flytting
  krever rettigheter i både kilde og mål.
- RLS: `*_update`-policyene tillater innholds- **eller** posisjonsendring;
  `memberships_select/delete` bruker `can_admin_resource` (ikke bare eier).

## Klient (optimistisk UX)

Del-/innstillings-UI-et bruker `get_members.viewer`-flaggene som fasit (med et
lokalt anslag for umiddelbar visning). Nye operasjoner følger samme opQueue-mønster
som lås/deling (optimistisk oppdatering, stabil overlay gjennom synk-rebuild,
koalescering, rollback ved avvisning, retry ved nettverksfeil, rydding ved
utlogging, `waitFor` på nypushede rader):

- **Invitasjonspolicy**: `set_invite_policy` med overlay `policyOverrides` (nøkkel
  `policy:<type>:<id>`).
- **Unntak fra arvet lås**: `set_unlocked` (`unlockOverrides`) — nå med utvidet
  autorisasjon (kun synlig/aktiv for `can_manage_lock_exception`).
- **Invitasjon fra medlem**: `create_share_invite` (uendret kø, men nå tilgjengelig
  for medlemmer når policy tillater).

`_invitePolicy` legges på objektene i `metaFromMy`/`applyMyDoc` (fra
`get_my_doc().*.invitePolicy`), med `policyOverrides` foran serverens verdi så en
køet endring ikke hopper tilbake ved en mellomliggende pull. `frozen()` og
del-UI-ets rettighets-anslag stopper ved mount-grenser (over en montert rot er
`_parent` mottakerens plassering, ikke en kanonisk forelder).

## Testing

- SQL: `supabase/tests/test-permissions.sql` (fire brukere A/B/C/D — oppretter-
  hierarki, lås/unntak, rekkefølge-vs-innhold, tretilstands invitasjon, sikkerhet/
  regresjon). Kjøres av `run-tests.sh` (migreringen kjøres to ganger for
  idempotens).
- Mock: `mock-backend.js` speiler reglene (verifisert med en node-harness).
- Nettleser: `tests/permissions-ui.test.js` (mock, desktop + mobil): policy-
  avmerking, medlems-inviterett, arvet-lås-melding m/ ikon+navn, unntaks-kontroll
  kun for autoriserte, XSS, optimistisk endring + koalescering.
