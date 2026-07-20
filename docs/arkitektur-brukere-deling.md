# Arkitektur: brukere, eierskap og deling

Grunnmuren for brukerkontoer og deling i Huskis. Databasesiden er
implementert i [`supabase/users-and-sharing.sql`](../supabase/users-and-sharing.sql)
(idempotent, kjøres av Actionen «Supabase DB-oppsett»). UI-/klientsiden er
**ikke** implementert ennå — se [TODO.md](../TODO.md).

## Oversikt

```
Supabase Auth (e-post + passord, bekreftelseslenke)
        │ 1:1 (trigger)
   profiles ──────────────┐
        │ owner_id på alt │
   universes ─ groups ─ cards («lister») ─ items      ← kanonisk innhold
        ▲          ▲          ▲
        └──────────┴──────────┴── memberships (mounts) ← andres tilgang + DERES plassering
                                  share_invites        ← invitasjoner på e-post
                                  tombstones           ← mot gjenoppliving offline
```

Den gamle éndoc-modellen (`public.lists` + `get_list`/`save_list`, mønster-lås)
er **pensjonert** — `supabase/setup.sql` dropper tabellen + RPC-ene, og klienten
har ingen v1-kode igjen.

## Identitet og registrering

- **Supabase Auth** med e-post + passord (`supabase.auth.signUp`). Med
  «Confirm email» PÅ (standard) sender Supabase bekreftelses-e-posten med
  lenke automatisk, og brukeren kan ikke logge inn før e-posten er bekreftet.
  Ingen egen e-postinfrastruktur trengs.
- `public.profiles` speiler `auth.users` via trigger (`handle_new_user`):
  opprettes ved registrering, e-post holdes synkron (lowercase). `display_name`
  = «Fornavn Etternavn» (fanges fra `raw_user_meta_data->>'display_name'`, som
  klienten sender ved registrering; ellers e-post-prefiksen). Triggeren kobler
  også **ventende invitasjoner** sendt til e-posten før kontoen fantes.
  Klienten kan kun endre `display_name` (kolonne-grant), aldri e-posten.
- RLS: hver bruker ser kun sin egen profil. Medlemslister hentes via
  `get_members()` (som krever tilgang til objektet).

## Datamodell

Fire objekttabeller — `universes` > `groups` > `cards` (= «lister» i UI-et)
> `items` — med `on delete cascade` nedover. Hver rad har:

- `owner_id` — **oppretteren** av raden; kan aldri endres (trigger-vakt). NB:
  betyr «oppretter», ikke universeier — universeieren er `owner_id` på rot-
  universet. Se [`rettigheter-og-deling.md`](rettigheter-og-deling.md).
- `trashed` — søppelkasseflagget, **felles** for alle med tilgang
  (innholds-søppel; jf. dagens modell).
- `locked`/`unlocked` (ikke på items) — lås/unntak, se «Låsing».
- `invite_policy` (ikke på items) — `inherit`/`allow`/`deny`, se
  «Invitasjonspolicy».
- LWW-registre som i dagens synk-doc: `ts`/`org` (innhold),
  `pos_ts`/`pos_org` (posisjon + forelder-peker), `lab_ts`/`lab_org`
  (K/P på cards). **Håndheves nå på serveren**: BEFORE UPDATE-triggere
  lar en skriving med eldre register-stempel tape mot dataene som står
  (per register — samme semantikk som klientens `mergeStates`).
  Klienten MÅ derfor stemple registrene ved endring, ellers biter ikke
  skrivingen.
- Id-er er `uuid` og kan genereres på klienten (`crypto.randomUUID()`)
  for offline-first-oppførsel.
- `items.responsible` (FK til `profiles`, `on delete set null`): ansvarlig
  bruker for et listepunkt i en delt liste. Rir på innholds-registeret (`ts`/`org`,
  som `text`/`done`/`trashed`) — server-LWW som resten. Klienten viser/endrer
  den kun for listepunkter i delt kontekst (`docs/accounts.md`).

## Tilgangsmodell

Lesetilgang til et objekt = én av:

1. Du eier det (`owner_id`).
2. Du har **medlemskap** på det (direkte deling).
3. Du har medlemskap på en **forelder** (univers-deling gir alt under;
   gruppe-deling gir lister + listepunkter; liste-deling gir listepunkter).

Alt håndheves med RLS-policyer bygget på `can_read_*`/`can_edit_*`
(SECURITY DEFINER-funksjoner — ingen policy-rekursjon). `anon`-rollen har
null tilgang til de nye tabellene; alt krever innlogget bruker.

**Nedovergående deling er automatisk og additiv.** Å dele et univers deler
*hele* universet — alle grupper/lister/listepunkter arver tilgangen. Man kan i
tillegg dele et objekt lenger ned med **flere** enn forelderen er delt med (egen
membership-rad på gruppen/listen); de nye får bare den grenen, ikke søsken. Så en
liste kan være delt med 6 i en gruppe delt med 4 i et univers delt med 2.
Klienten viser arvede medlemmer (fra forfedre) sammen med de direkte i delings-
listen — se `docs/accounts.md`.

## Deling (invitasjon → aksept → mount)

> **Autorisasjonsmodellen er utvidet — se
> [`rettigheter-og-deling.md`](rettigheter-og-deling.md) for den autoritative
> definisjonen.** Kort: «eieren» nedenfor er generalisert til **privilegerte
> administratorer** (universeier + oppretteren av objektet + oppretteren av hvert
> superobjekt), og et **vanlig medlem kan invitere** når den effektive
> invitasjonspolicyen tillater det. Formuleringer som «kun eieren» er utdaterte.

1. En **privilegert administrator** — ELLER et vanlig medlem når den effektive
   invitasjonspolicyen tillater videreinvitasjon (`can_invite_to`) — inviterer en
   e-postadresse: `create_share_invite(type, id, email)`. Mottakeren trenger ikke
   ha konto — invitasjonen kobles ved registrering. En invitasjon avvises hvis
   mottakeren allerede har **effektiv** tilgang (også arvet fra et superobjekt).
2. Mottakeren ser invitasjonen i appen (`get_my_doc().invites_in`) og
   aksepterer med `accept_share_invite(invite, parent, pos)`:
   - **Univers**: ingen plassering (dukker opp blant mottakerens universer).
   - **Gruppe**: mottakeren velger hvilket av **sine** universer gruppen
     legges i (`parent_universe_id`).
   - **Liste**: mottakeren velger gruppe (`parent_group_id`).
3. Aksepten oppretter en **membership-rad** = mottakerens *mount*:
   tilgang + mottakerens egen plassering (forelder + `pos`) av det delte
   objektet. **Innholdet er felles; kun montasjepunktet er per bruker.**

Viktige egenskaper:

- **Eieren har aldri membership-rad** → kan strukturelt aldri kastes ut.
- **Kaste ut**: `revoke_share(type, id, user)` (en privilegert administrator,
  `can_admin_resource`) sletter det **direkte** medlemskapet + ev. ventende
  invitasjoner for brukeren. Arvede medlemmer (tilgang kun via et superobjekt)
  administreres der delingen faktisk finnes.
- **Invitere / trekke tilbake**: en administrator kan trekke tilbake ALLE ventende
  invitasjoner i sitt myndighetsområde; et vanlig medlem med inviterett kan bare
  trekke tilbake sine egne (`revoke_share_invite`, `get_members` gir `mine`).
- **Sletteregelen for en mottaker** (samme mønster på alle tre nivåer):
  mottakeren kan **ikke slette selve det delte objektet** (share-roten) —
  hverken legge det i søppel (`trashed`) *eller* hardslette det. Å fjerne
  det fra sitt eget syn gjøres i stedet via mounten (`membership.trashed`
  → tømming = `leave_share()`), som aldri rører innholdet.
  - Delt **univers** → mottakeren kan ikke slette universet, men kan slette
    grupper/lister/listepunkter **i** det.
  - Delt **gruppe** → kan ikke slette gruppen, men kan slette lister/
    listepunkter i den.
  - Delt **liste** → kan ikke slette listen, men kan slette listepunktene i den.
- **Sletting og gjenoppretting av delt *innhold* gjelder for alle.**
  `trashed` er et **felles** felt på selve raden, så når en mottaker legger
  en gruppe/liste/listepunkt i søppel (eller henter den ut igjen), ser eieren
  og alle andre med tilgang nøyaktig samme tilstand. Det finnes ingen
  per-bruker søppelkasse for delt innhold — kun for selve mounten.
- **Eierens sletting er reell** (trashed → tømming = hard delete med
  kaskade); da forsvinner objektet for alle. Eieren kan i stedet kaste
  ut de andre hvis bare delingen skal opphøre.
- Slettes *mottakerens* valgte forelder (f.eks. universet mounten pekte
  på), settes mount-pekeren til `null` («umontert») — delingen består,
  og UI-et kan be om ny plassering.
- Mottakere av en **direkte** deling kan ikke flytte objektets *kanoniske*
  forelder (eierens plassering) — de flytter sin egen mount. Innen et delt
  univers/gruppe kan medlemmer derimot dra lister/listepunkter fritt (felles
  struktur).

Håndhevingen ligger på to steder: RLS `*_delete`-policyene sperrer
hardsletting av en share-rot for alle med direkte medlemskap på objektet
(universe-sletting er dessuten eier-only), og BEFORE UPDATE-triggerne
sperrer `trashed`-endring på en share-rot fra en mottaker (et univers kan
ingen ikke-eier trashe; en gruppe/liste kan ikke trashes av en med direkte
medlemskap *på den*, men gjerne av et univers-/gruppemedlem over den).
Innhold uten eget medlemskap (barn) faller alltid utenfor sperren og kan
slettes fritt.
- `profiles.email` er **skrivebeskyttet for klienter** (kolonne-grant: kun
  `display_name`) og speiles utelukkende fra `auth.users` — ellers kunne en
  bruker kapre invitasjoner sendt til uregistrerte adresser (aksept
  sammenligner mot `profiles.email`) eller blokkere andres registrering
  via unik-indeksen på e-post.
- `profiles.email` er **skrivebeskyttet for klienter** (kolonne-grant: kun
  `display_name`) og speiles utelukkende fra `auth.users` — ellers kunne en
  bruker kapre invitasjoner sendt til uregistrerte adresser (aksept
  sammenligner mot `profiles.email`) eller blokkere andres registrering
  via unik-indeksen på e-post.

## Låsing (med unntak for arvet lås)

> Full modell + autorisasjon: [`rettigheter-og-deling.md`](rettigheter-og-deling.md).

`locked`/`unlocked` på universes/groups/cards er **gjensidig utelukkende** per rad,
så hver node har én av tre tilstander: *låst*, *unntak (åpnet)*, eller *arv*.
`set_locked` kan settes av en **privilegert administrator** (`can_admin_resource`);
`set_unlocked` (unntak fra en ARVET lås) kun av universeieren ELLER oppretteren av
det nærmeste superobjektet som innfører den effektive låsen
(`can_manage_lock_exception`) — en lavere oppretter kan ikke åpne en gren i strid
med en høyere lås.

Effektiv redigeringsstatus for et **vanlig medlem** = den nærmeste eksplisitte
tilstanden fra objektet og oppover (`effective_lock_source`). Universeieren og
relevante opprettere kan **alltid** redigere (`can_edit_content =
can_admin_resource OR NOT is_effectively_locked`). Lesing påvirkes aldri av lås.

**Posisjon er skilt fra innholdslås**: retten til å endre et objekts rekkefølge i
superobjektet styres av `can_reorder_in_parent` (= innholdsredigering på
superobjektet), ikke av objektets egen lås. En låst liste kan dermed flyttes blant
søsken når gruppen er åpen. Vaktene (`*_before_update`) håndhever dette
feltspesifikt.

Følger: lås på et univers fryser alt under for vanlige medlemmer, MEN en autorisert
bruker kan gjøre et **unntak** for en konkret gruppe/liste under (`unlocked =
true`), og et enda lavere nivå kan låses på nytt inni et unntak.
Nærmeste-eksplisitt-regelen håndterer vilkårlig nøsting.

## Invitasjonspolicy (tretilstands dynamisk arv)

`invite_policy` (`inherit`/`allow`/`deny`) på universes/groups/cards styrer om
**vanlige medlemmer** kan invitere flere. Effektiv verdi = nærmeste eksplisitte fra
objektet og oppover; ingen eksplisitt noe sted → tillat. Nye rader er `inherit`
(dynamisk arv). `set_invite_policy` styres av `can_manage_invite_policy` (parallelt
med lås-unntak). Migreringen gir eksisterende rader `inherit` → effektiv tillat.
Full modell: [`rettigheter-og-deling.md`](rettigheter-og-deling.md).

## Sletting, søppel og gravsteiner

- `trashed`-flagg = søppelkasse (reversibel), som i dag. For delt innhold
  er den **felles** (sletting/gjenoppretting gjelder for alle med tilgang);
  kun for selve mounten er den per mottaker. Share-roten kan mottakeren
  ikke trashe i det hele tatt (se «Deling»).
- Tømming = hard `DELETE`. AFTER DELETE-triggere skriver **gravsteiner**
  (`tombstones(resource_type, resource_id, ts)`) slik at en klient som
  var offline ikke gjenoppliver slettede objekter ved neste synk.

## Klient-API (fase 2 bygger på dette)

| Kall | Rolle |
|---|---|
| `supabase.auth.signUp/signInWithPassword/…` | registrering/innlogging (bekreftelses-e-post håndteres av Supabase) |
| `get_my_doc()` | hele brukerens datasett som ETT flatt jsonb-doc (universes/groups/cards/items + `mount`-info + invitasjoner) — samme fasong som dagens synk-doc, så `applyDoc`-maskineriet gjenbrukes |
| vanlige `insert/update/delete` på tabellene | CRUD med RLS + server-side LWW; klienten stempler `ts/org`-registrene som i dag |
| `import_doc(doc)` | engangs-migrering av lokalt/legacy doc til egne data (deterministiske id-er per bruker, idempotent) |
| `create_share_invite` / `accept_share_invite` / `decline_share_invite` / `revoke_share_invite` | delingsflyt (invitasjon fra admin ELLER medlem m/ inviterett) |
| `revoke_share` / `leave_share` / `set_locked` / `set_unlocked` / `set_invite_policy` / `get_members` | administrasjon (låsing + unntak + invitasjonspolicy; `get_members` gir `viewer`-rettigheter) |
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

## Testing

`supabase/tests/` inneholder en hermetisk testsuite (ren PostgreSQL 16,
Supabase-miljøet stubbes med `local-stub.sql` — samme
`request.jwt.claim.sub`-mekanikk som PostgREST):

```bash
# med en lokal postgres på 5433 og tom database hk_test:
PGHOST=... PGPORT=5433 PGUSER=postgres PGDATABASE=hk_test supabase/tests/run-tests.sh
```

Suiten kjører migreringen **to ganger** (idempotens) og dekker: profil-
trigger, RLS-isolasjon mellom brukere, hele delingsflyten for alle tre
nivåer, mount-plassering og -søppel, låsing (inkl. arv fra univers),
utkastelse/forlating, eierskapsvakter, server-side LWW, import
(determinisme + idempotens + foreldreløse), gravsteiner og anon-avvisning.

## Manuelle steg (utenfor SQL — én gang, i Supabase-dashboardet)

1. **Authentication → Sign In / Up**: «Confirm email» skal stå PÅ (standard).
2. **Authentication → URL Configuration**: sett *Site URL* til appens
   adresse (f.eks. GitHub Pages-URL-en) og legg samme adresse i *Redirect
   URLs* — bekreftelseslenken i e-posten sender brukeren dit.
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
serif` — ingen webfont), PNG-logo fra `https://www.huskis.no/assets/email/
huskis-logo.png`, skifer/grønn-palett fra designsystemet, preheader-tekst,
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
