# Rettigheter og deling — den autoritative modellen

Denne fila er **fasiten** for hvem som får gjøre hva i Huskis. Ved motstrid
mellom dette og andre dokumenter gjelder dette.

Databasesiden ligger i
[`supabase/users-and-sharing.sql`](../supabase/users-and-sharing.sql)
(idempotent), mock-backenden speiler den (`mock-backend.js`, `?mock=1`), og
klientsiden i `app.js`. All autorisasjon håndheves **serverside** (RLS +
`BEFORE UPDATE`-vakter + SECURITY DEFINER-RPC-er); klienten viser/skjuler
kontroller for en bedre UX og kan aldri omgå reglene.

Se også [`arkitektur-brukere-deling.md`](arkitektur-brukere-deling.md)
(tabeller, søppel, LWW) og [`accounts.md`](accounts.md) (klient-UI, synk,
opQueue).

---

## 1. Hva kan deles

Bare **universer** og **grupper**.

* En **liste** kan aldri deles direkte. Den arver tilgangen fra gruppen sin.
* **Listepunkter og kategorier** arver fra listen og dermed fra gruppen.

Hierarkiet er som før:

```
Univers > Gruppe > Liste > Listepunkt/kategori
```

Hver gruppe har **alltid ett kanonisk univers**. «Grupper delt med meg» er bare
en alternativ *visning* av direkte delte grupper — ikke en reell forelder, og
aldri et gyldig flyttemål.

Serveren avviser ethvert forsøk på å dele en liste — også fra en gammel klient,
en modifisert klient eller et rått PostgREST-kall (`create_share_invite` godtar
kun `universe`/`group`, og `memberships`/`share_invites` har en CHECK som holder
`card_id` tom).

---

## 2. Oppretter vs. eier

| Begrep | Hvor | Betydning |
|---|---|---|
| **Oppretter** (`created_by`) | `owner_id` på objektraden | REN HISTORIKK. Uforanderlig. Gir **ingen** rettigheter. |
| **Eier / medeier** | `memberships.role = 'owner'` | Mutabel rolle. All myndighet kommer herfra. |
| **Medlem** | `memberships.role = 'member'` | Vanlig tilgang. |

Kolonnenavnet `owner_id` er beholdt av migreringshensyn, men skal leses som
`created_by`. Fjernes rollen din, mister du myndigheten — selv om du står som
oppretter.

Det finnes **ingen egen administratorrolle**. Full administrativ myndighet gis
gjennom eierskap eller medeierskap.

### Roller på universnivå

* `owner` — universeier. Alle universeiere er **helt likestilte**.
* `member` — vanlig universmedlem.

Visningsnavnet følger antallet: nøyaktig én `owner` → «Eier»; minst to →
«Medeiere». Backendrollen er den samme.

Den som oppretter et univers får `owner`. Aksepterer noen en eierskaps-
invitasjon, er de likestilt med de andre — den opprinnelige oppretteren har
ingen særskilt eller uoppsigelig myndighet.

**Siste-eier-invarianten:** et univers har alltid minst én eier.

* siste eier kan ikke forlate
* siste eier kan ikke degraderes
* siste eier kan ikke kastes ut
* siste eier **kan** slette universet for alle

Invarianten håndheves i databasen (`memberships_last_owner_guard` på både
UPDATE og DELETE), ikke bare i RPC-ene — også en rå `DELETE` blokkeres.

### Roller på gruppenivå

* `owner` — **eksplisitt** gruppeeier/medeier.
* `member` — direkte gruppemedlem uten medlemskap i universet.

Den som oppretter en gruppe blir eksplisitt gruppeeier — **med mindre**
vedkommende allerede er universeier (rollen er da arvet, og en egen rad ville
bare duplisert medlemslisten).

Alle universeiere er **dynamiske supereiere** av alle grupper i universet. En
gruppe kan derfor ha null eksplisitte gruppeeiere; kategorien «Eier(e) av
gruppen» utelates da fra medlemslisten.

Én eksplisitt gruppeeier → «Eier av gruppen»; flere → «Medeiere av gruppen».

En bruker kan være eksplisitt gruppeeier og universmedlem samtidig. Rollen gir
da ekstra myndighet i gruppen, men brukeren vises bare **én gang** i
medlemslisten (se presedensen i del 5).

### Ingen roller på liste- eller elementnivå

Den som oppretter en liste, kategori eller et listepunkt får **ingen**
vedvarende særrett. Dette er en bevisst endring fra den gamle oppretterbaserte
myndigheten. `created_by` der er kun historikk.

---

## 3. Capabilities

Autorisasjonen er **capability-basert**, ikke en antatt rangering av roller.
Serveren regner ut capabilities og returnerer dem til klienten
(`get_my_doc().universes[].caps` / `.groups[].caps`, og
`get_members().viewer.caps`). Klienten kan bruke lokale anslag for umiddelbar
visning, men **serverens capabilities og RLS/RPC-ene er alltid autoritative**.

| Capability | SQL-funksjon |
|---|---|
| lese objekt | `can_read` |
| redigere innhold | `can_edit_content` |
| opprette subobjekter | `can_create_child` |
| endre delt rekkefølge | `can_reorder_in_parent` |
| slette objektet for alle | `can_delete_object` |
| forlate objektet | `can_leave` |
| flytte gruppe ut av et univers | `can_move_group` |
| opprette gruppe i et målunivers | `can_create_child('universe', …)` |
| invitere medlemmer | `can_invite_to` |
| invitere eiere | `can_invite_owner` |
| administrere medlemmer, eierskap og innstillinger | `can_manage_members` |
| låse og låse opp | `can_manage_lock` |
| overstyre lås for egen redigering | `is_privileged` (inngår i `can_edit_content`) |
| opprette unntak fra arvet lås | `can_manage_lock_exception` |
| endre invitasjonspolicy | `can_manage_invite_policy` |

**PRIVILEGERT** (`is_privileged`) = eier på det nivået som styrer objektet:
universeier for et univers, gruppeeier (eksplisitt eller universeier) for
gruppe/liste/listepunkt. Privilegerte påvirkes aldri av en lås for **egen**
redigering.

### Universeier

* full lese-, redigerings- og administrasjonsmyndighet over universet og alle subobjekter
* påvirkes ikke av låser noe sted i universet
* kan opprette, redigere, flytte, slette, gjenopprette og omrokkere alle grupper, gruppekategorier, lister, listekategorier og listepunkter
* kan endre universets innstillinger, låse alt, og administrere låsunntak
* kan invitere universmedlemmer **og** universeiere
* kan invitere direkte medlemmer og eiere til grupper, og fjerne direkte gruppemedlemmer/-eiere
* kan kaste ut universmedlemmer, og fjerne/degradere andre universeiere så lenge minst én eier blir igjen
* kan slette universet for alle, og enhver gruppe eller liste — også andres

### Eksplisitt gruppeeier

* full myndighet over gruppen og alt innhold i den
* påvirkes ikke av gruppens eller listenes låser, og kan redigere gruppen selv om **universet** er låst
* kan administrere gruppens innstillinger, låse gruppen og listene
* kan invitere direkte gruppemedlemmer og gruppeeiere, og fjerne dem igjen
* kan slette gruppen for alle, og flytte den når kildekrav + målkrav er oppfylt
* kan opprette, redigere, slette og flytte lister og listeinnhold

Kan **ikke**: redigere universets innstillinger, invitere til universet, fjerne
universeiere eller universmedlemmer, ekskludere et universmedlem fra gruppen,
eller endre gruppens plassering blant søskengrupper i et **låst** univers.

> Et objekts posisjon blant grupper tilhører **universets struktur**. Å
> omrokkere grupper krever derfor rett til å redigere universets innhold — noe
> annet enn å redigere eller slette selve gruppen.

### Vanlig universmedlem

* er automatisk effektivt medlem av **alle** grupper i universet
* kan lese hele universet
* kan redigere innhold som er effektivt åpent
* kan opprette grupper og gruppekategorier når universet er effektivt åpent, og blir eksplisitt gruppeeier av det de selv oppretter
* kan opprette lister når gruppen er effektivt åpen
* kan redigere og slette åpne grupper og åpne lister — også andres
* kan omrokkere grupper når universet er åpent, og lister når gruppen er åpen
* kan invitere når effektiv invitasjonspolicy tillater det

Kan **ikke**: slette universet, endre administrative innstillinger, låse/låse
opp, endre invitasjonspolicy, administrere eierskap, kaste ut medlemmer, eller
fjerne et annet universmedlem fra en enkelt gruppe.

«Redigere» betyr her ordinært innhold: navn, tekst, rekkefølge, tidsplaner og
tilsvarende. Det omfatter **ikke** medlemskap, roller, lås eller
invitasjonspolicy.

### Direkte gruppemedlem uten universmedlemskap

* kan lese gruppen og alt i den
* kan redigere åpent innhold
* kan opprette, redigere, slette og omrokkere lister når gruppen er effektivt åpen
* kan redigere listepunkter og kategorier når nivåene er åpne
* kan invitere til gruppen når effektiv policy tillater det

Kan **ikke**: slette gruppen for alle, flytte gruppen, redigere gruppens
administrative innstillinger, låse/låse opp, administrere eierskap eller kaste
ut medlemmer.

---

## 4. Låser

Tretilstandsmodellen består: **eksplisitt låst**, **eksplisitt åpnet unntak**,
**arv**. Effektiv lås = den nærmeste eksplisitte tilstanden fra objektet og
oppover (`effective_lock_source`).

* Universeiere omgår alle låser for egen redigering.
* Eksplisitte gruppeeiere omgår univers-, gruppe- og listelåser for egen
  redigering **innenfor sin gruppe**. Det gir dem ikke rett til å åpne gruppen
  for andre i strid med en universlås.
* Bare universeiere kan gjøre et allment unntak fra en **universlås**.
* Universeiere **og** relevant eksplisitt gruppeeier kan administrere unntak fra
  en **gruppelås** på underliggende lister.
* Ordinære medlemmer kan aldri endre låstilstand.
* Listelåser påvirker verken gruppeeiere eller universeiere.
* Posisjon blant søsken styres av redigeringsrett på **forelderen**, ikke av
  barnets egen lås.

Finnes det ingen arvet lås, er «unntak» bare en overflødig flaggverdi — da kan
den som ellers styrer objektets lås rydde den bort (f.eks. etter at låsen over
er fjernet).

**Invitasjonspolicy** (`inherit | allow | deny`, nærmeste eksplisitte oppover)
finnes kun på universer og grupper. Listespesifikk policy er fjernet.

---

## 5. Effektivt medlemskap

Effektivt medlemskap i en gruppe er den **dedupliserte unionen** av:

1. universeiere
2. eksplisitte gruppeeiere
3. vanlige universmedlemmer
4. direkte gruppemedlemmer

Universeiere og universmedlemmer materialiseres **aldri** som gruppemedlems-
rader — den arvede tilgangen beregnes dynamisk. En rolle gir i seg selv den
tilgangen den skal: universeierrollen gir universmedlemskap, og en eksplisitt
gruppeeierrolle gir gruppetilgang selv uten medlemskap i universet.

En bruker vises aldri flere ganger i samme medlemsliste. Presedensen er
rekkefølgen over (1 vinner over 2 osv.).

**Universets medlemsliste:** «Eier»/«Medeiere», så «Medlemmer».

**Gruppens medlemsliste** (tomme kategorier utelates):

1. «Eier av universet» / «Medeiere av universet»
2. «Eier av gruppen» / «Medeiere av gruppen»
3. «Medlemmer av universet»
4. «Medlemmer av gruppen»

Universeiere og universmedlemmer vises i alle gruppers medlemslister, men kan
ikke fjernes der (`removable = false` + `removeHint`: «Har tilgang via universet
og må fjernes der»). Ventende invitasjoner står i en egen seksjon og teller ikke
som medlemmer.

---

## 6. Invitasjoner, roller og fjerning

### Eierskapsinvitasjoner

Å gjøre noen til universeier eller gruppeeier er alltid en **eksplisitt
rolleinvitasjon mottakeren må akseptere** (`create_share_invite(..., 'owner')`).
Det gjelder både en eksisterende medlem som skal opp i rolle, en som ennå ikke
er medlem, og en e-postadresse uten konto. Ved aksept opprettes medlemskap og
rolle atomisk.

Vanlig invitasjonspolicy gir **aldri** rett til å invitere eiere — bare
relevante eiere kan det. `set_member_role` kan derfor bare degradere (eier →
medlem); rolleløft må gå gjennom en invitasjon.

Redundante **medlems**-invitasjoner avvises (mottakeren har allerede effektiv
tilgang). En **eierskaps**-invitasjon til samme person er derimot gyldig — det
er nettopp rolleløftet, og UI-et tilbyr den i stedet.

### Fjerning fra univers

Når en bruker forlater eller kastes ut av et univers (`purge_universe_access`):

* universrollen fjernes
* alle direkte gruppemedlemskap i universets grupper fjernes
* alle eksplisitte gruppeeierroller i universet fjernes
* ventende rolle- og medlemsinvitasjoner i universet og gruppene trekkes tilbake
* alle `responsible`-referanser i universet som peker på brukeren nullstilles

Brukeren skal ikke beholde skjult tilgang til enkeltgrupper — også når det
direkte gruppemedlemskapet fantes før universmedlemskapet.

En eier som **degraderes** til vanlig medlem beholder derimot universmedlemskap,
og eksplisitte gruppeeierroller består med mindre de fjernes særskilt.

### Fjerning fra gruppe

Når et direkte gruppemedlem eller en eksplisitt gruppeeier forlater eller
fjernes (`purge_group_access`): grupperollen fjernes, ansvarstildelinger i
gruppen som peker på brukeren nullstilles (kun hvis den effektive tilgangen
faktisk forsvant), og universmedlemskap røres ikke.

En universarvet bruker kan ikke fjernes fra gruppen alene — RPC-en avviser
forsøket med en forklarende feil i stedet for å bli en stille no-op.

---

## 7. De tre seksjonene i «Universer og grupper»

Modalen har tre klart adskilte seksjoner med overskrift og skillelinje. Et
univers eller en gruppe vises i **nøyaktig én** seksjon for den aktuelle
brukeren.

### 1. `[universikon][kontoikon] Mine universer`

Universer der brukeren nå har rollen `owner` — uansett hvem som opprettet dem.
Klassifikasjonen følger **nåværende rolle**, ikke `created_by`: degraderes en
tidligere oppretter, flyttes universet til seksjon 2.

«Nytt univers»-knappen står her, og bare her.

### 2. `[universikon][delt-ikon] Universer delt med meg`

Universer der brukeren er `member`, men ikke `owner`. Ingen «Nytt univers»-knapp.

Alle medlemmer kan åpne delemodalen og se medlemslisten; invitasjonskontroller
vises kun ved `caps.invite`/`caps.inviteOwner`. Forlat-knapp for alle som kan
forlate, sletteknapp kun ved `caps.delete`, begge når begge er tillatt.

Knapper for å opprette grupper og gruppekategorier vises kun ved
`caps.createGroup`. Grupperekkefølge, gruppekategorier og gruppeplassering inne
i universet er felles for alle med tilgang.

### 3. `[gruppeikon][delt-ikon] Grupper delt med meg`

Grupper der brukeren har en direkte gruppe-eier- eller gruppemedlemsrolle **og**
ingen rolle i gruppens kanoniske univers (`free = true` i `get_my_doc`).

De vises som frie grupper uten univers over seg, kan omordnes med dra-og-slipp
(personlig rekkefølge), kan ikke organiseres i gruppekategorier, har ingen
opprett-knapp, og har deleknapp for alle + forlat/slett etter capabilities.

Får en direkte gruppemottaker senere universmedlemskap, forsvinner gruppen fra
denne seksjonen og vises inne i universet — og redundante ordinære direkte
gruppemedlemskap i universet ryddes ved aksept (eksplisitte gruppeeierroller
beholdes, men fjernes hvis brukeren senere forlater eller kastes ut av
universet).

Klienten samler seksjon 3 i én **virtuell beholder** (`FREE_UNI_ID`) som aldri
pushes; gruppene beholder sitt kanoniske `uni` i doc-et, og universets navn/
medlemsliste lekkes aldri til en mottaker uten universadgang.

---

## 8. Ikoner og breadcrumbs

Fast rekkefølge: `[ressursikon][delt-ikon ved behov] Ressursnavn`. Gruppeikonet
vises aldri to ganger.

Et objekt er **aktivt delt** når mer enn én bruker har effektiv tilgang.
Ventende invitasjoner alene utløser ikke delt-ikonet. For en gruppe regnes det
fra den dedupliserte effektive medlemslisten, inkludert arvede universmedlemmer
(`group_member_count`).

```
[universikon][delt?] Universnavn  ›  [gruppeikon][delt?] Gruppenavn
[delt-ikon] Delte grupper         ›  [gruppeikon][delt-ikon] Gruppenavn
```

Første ledd i den frie varianten er en **virtuell navigasjonsrot** uten
universikon; den navigerer tilbake til «Grupper delt med meg».

Alle ikoner og ikonknapper har tilgjengelige navn og tooltips.

---

## 9. Invitasjonsflyt

**Universinvitasjon.** Ved aksept: rollen fra invitasjonen opprettes, universet
legges bakerst i mottakerens personlige rekkefølge, ingen forelder velges,
redundante ordinære direkte gruppemedlemskap i universet fjernes, og eksplisitte
gruppeeierroller beholdes.

**Gruppeinvitasjon.** Ved aksept: direkte gruppe-eier- eller gruppemedlemsrolle
opprettes, ingen forelder velges. Gruppen vises under «Grupper delt med meg»
hvis mottakeren ikke er medlem av det kanoniske universet — ellers inne i
universet.

**Gruppe i delt univers.** Omfatter alltid minst alle universets medlemmer. Man
kan invitere flere direkte gruppemedlemmer uten å invitere dem til universet;
de ser da bare gruppen og dens lister. Det er aldri mulig å ekskludere et
universmedlem fra en bestemt gruppe.

**Liste.** Delingsknapp, medlemsadministrasjon, direkte invitasjoner,
listemedlemskap, mottakerspesifikke mounts og listespesifikk invitasjonspolicy
er **fjernet**. Ansvarlig-velgere i lister og listepunkter bruker gruppens
effektive medlemsliste.

---

## 10. Slette og forlate

* Ordinær «Slett» legger objektet i **felles** søppel for alle med tilgang.
* Gjenoppretting gjelder for alle.
* Permanent sletting ved tømming oppretter gravsteiner.
* Bare brukere med relevant sletterett kan slette eller gjenopprette.
* **«Forlat» endrer aldri innholdet** — det fjerner kun brukerens roller og tilgang.

| Situasjon | Forlat | Slett |
|---|---|---|
| Vanlig medlem av delt univers | ja | nei |
| Medeier (minst én annen eier) | ja | ja |
| Siste eier | nei | ja |
| Vanlig direkte medlem av fri gruppe | ja | nei |
| Gruppeeier av fri gruppe | ja | ja |

Er gruppeeieren også universmedlem, er gruppen ikke fri, og universreglene
gjelder for tilgangen.

Bekreftelsesdialog kreves for handlinger som påvirker andre: slette univers eller
gruppe for alle, fjerne medeier, flytte en gruppe slik at medlemskretsen endres,
og kaste ut universmedlem.

Forsvinner tilgangen mens man står i objektet (sletting, flytting, utkastelse,
rolleendring), lukkes visningen, appen navigerer til nærmeste gyldige fallback,
og en nøktern melding forklarer hva som skjedde (`noteAccessLoss`). En gammel
lokal kopi blir aldri stående redigerbar.

---

## 11. Flytting av grupper

All flytting mellom universer skjer gjennom **én atomisk server-RPC**,
`move_group(p_group, p_universe, p_cat, p_pos)`. Klienten gjennomfører den aldri
som en sekvens av inserts/updates/deletes. RPC-en låser radene (`for update`),
kontrollerer rettighetene på nytt inne i transaksjonen, og fullfører helt eller
ruller helt tilbake. En direkte skriving av `groups.universe_id` avvises av
`groups_before_update`.

**Tillatelser:** `can_move_group` (destruktiv myndighet) i kilden **og**
`can_create_child` i måluniverset. Ren redigeringsrett holder ikke. Dra-og-slipp
viser bare gyldige mål, og serveren håndhever det samme.

### Samme univers

Vanlig endring av delt posisjon/gruppekategori: alle id-er, roller, medlemskap
og invitasjoner består; endringen påvirker alle universmedlemmers visning og
krever rett til å redigere universets struktur. (`mode: 'reorder'`)

### Eierskapsdomene

Gruppens eierskapsdomene defineres av det **nåværende, dedupliserte settet av
universeiere** (`universe_owner_set`). To universer er i samme domene bare
dersom settene er identiske i transaksjonsøyeblikket. Det er mer robust enn
«opprettet av meg» / «delt med meg», som blir ustabilt når eierskap kan endres.

Klienten får settet som én sammenlignbar nøkkel (`ownerKey`) og kan dermed vite
om en flytting krysser domenegrensen **før** den kaller RPC-en — slik at
bekreftelsen kommer i riktige tilfeller.

### Samme domene → ekte reparenting (`mode: 'reparent'`)

Gruppe-, liste-, kategori- og element-id-er består. Eksplisitte gruppeeiere,
direkte gruppemedlemmer, ventende direkte gruppeinvitasjoner, innhold og
eksplisitte låser beholdes. `universe_id`, kategori og delt posisjon settes
atomisk.

Tilgangsendringer: de som bare arvet tilgang fra kildeuniverset mister den;
måluniversets medlemmer får den; direkte gruppemedlemmer beholder den (og ser
gruppen i fri seksjon hvis de ikke er medlem av måluniverset).
Ansvarstildelinger til brukere uten effektiv tilgang etter flyttingen nullstilles.

### Ulikt domene → kopier-og-slett (`mode: 'copy'`)

Semantisk «slett den gamle gruppen for alle i det gamle domenet, og opprett en
ny i det nye». Atomisk:

* ny gruppe med ny UUID, og nye UUID-er for alle lister, kategorier og listepunkter
* aktøren blir `created_by` og eksplisitt gruppeeier
* innhold, rekkefølge, kategorier, listeinnstillinger, tidsplaner, låstilstander og eksplisitt invitasjonspolicy kopieres
* arv fra måluniverset beregnes på nytt
* gamle direkte gruppemedlemmer, gruppeeiere og ventende invitasjoner kopieres **ikke**
* kildeuniversets navn, medlemsliste og historikk eksponeres aldri i måluniverset
* ansvarstildelinger kopieres kun når den ansvarlige har effektiv tilgang i måldomenet; ellers `responsible = null`
* det gamle gruppetreet slettes permanent i samme transaksjon, med gravsteiner for **samtlige** gamle id-er
* en deterministisk `mapping` (gammel id → ny id) returneres, så klientens optimistiske visning kan byttes uten flimring

For de gamle medlemmene forsvinner gruppen helt; gamle offline-klienter møter
gravsteiner og kan aldri gjenopplive treet. En eksplisitt bekreftelse vises før
en slik flytting: de gamle mister tilgang, direkte gruppemedlemmer og medeiere
følger ikke med, måluniversets medlemmer får tilgang, og det er ikke en ordinær
omplassering.

Kryssdomene-flytting er **ikke** modellert som vanlig LWW — server-RPC-ens
transaksjon og id-mapping er autoritativ.

### Fra «Grupper delt med meg»

Et fritt gruppekort kan slippes på et univers bare når brukeren kan slette/flytte
gruppen og opprette gruppe i måluniverset. Det er normalt en domenekryssing og
bruker kopier-og-slett. Et vanlig direkte gruppemedlem kan ikke flytte gruppen.

### Ingen flytting til den virtuelle seksjonen

En kanonisk gruppe kan ikke flyttes «ut av» et univers og inn i «Grupper delt med
meg». Alle grupper har alltid et kanonisk univers.

---

## 12. Personlig og delt rekkefølge

**Personlig** (per bruker, på medlemskapsraden `memberships.pos` — også for
eiere):

* universenes rekkefølge i «Mine universer»
* universenes rekkefølge i «Universer delt med meg»
* frie gruppers rekkefølge i «Grupper delt med meg»

**Felles** (på objektraden `pos`, for alle med tilgang):

* gruppers rekkefølge i et univers
* gruppekategorier og gruppenes kategoritilhørighet
* listers rekkefølge i en gruppe
* listekategorier og listepunkter

Universets kanoniske `pos` brukes ikke som felles toppnivårekkefølge. I klienten
holder `.pos` den personlige verdien og `_canon` den kanoniske, som skrives
tilbake uendret.

Ved rolleendring mellom eier og medlem flyttes universet mellom seksjonene, og
plasseres sist i den nye seksjonen dersom ingen tidligere personlig posisjon
finnes der.

---

## 13. Migrering av gamle direkte listedelinger

Kjøres én gang av `users-and-sharing.sql` (naturlig idempotent: etterpå finnes
ingen rader med `card_id`). For hver liste med direkte medlemskap eller ventende
invitasjoner:

1. Beregn den effektive tilgangen før migreringen.
2. **Redundante** listetilganger (mottakeren har allerede gruppetilgang) fjernes;
   listen blir liggende.
3. Finnes det ingen ANDRE aktive lister i foreldregruppen: mottakerne
   **promoteres** til direkte gruppemedlemmer, ventende listeinvitasjoner blir
   gruppeinvitasjoner, og listedelingene fjernes. (Kriteriet er «ingen annen
   aktiv liste», ikke «antall aktive lister ≤ 1» — ligger den delte lista selv i
   søpla mens en søskenliste er aktiv, ville promotering gitt mottakerne tilgang
   til nettopp den søskenlista.)
4. Finnes det andre aktive lister: en **ny søskengruppe** opprettes i
   samme univers (listetittelen som navn, «Delt liste» ved tom tittel,
   deterministisk kollisjonshåndtering med « (2)»), plassert ved siden av den
   gamle i samme gruppekategori. Listen flyttes dit med uendrede id-er. Alle som
   hadde tilgang via direkte medlemskap i den gamle gruppen (men ikke universet)
   eller via listen, får direkte gruppemedlemskap i den nye — med samme rolle
   som før. Ventende invitasjoner konverteres. Listemedlemskapene fjernes.

Resultatet bevarer den tidligere effektive tilgangen uten at noen får tilgang til
søskenlister de ikke kunne lese før. En tidligere direkte listemottaker uten
universmedlemskap ser den nye gruppen under «Grupper delt med meg».

Rollene backfilles i samme kjøring: universets oppretter blir universeier,
gruppens oppretter blir eksplisitt gruppeeier (med mindre rollen alt er arvet),
eksisterende direkte medlemskap blir vanlige roller, og redundante rader
dedupliseres. Backfillen er markert i `public.migration_log` og kjøres **aldri**
på nytt — en rolle som senere er fjernet med vilje skal ikke komme tilbake.

---

## 14. Testdekning

* `supabase/tests/test-roles-and-sharing.sql` — roller, medlemslister,
  invitasjoner, låser, sletting/forlatelse, siste-eier-invarianten, personlig
  rekkefølge.
* `supabase/tests/test-group-moves.sql` — reorder, reparenting, kryssdomene-
  kopiering, gravsteiner, rettighetskrav, rollback.
* `supabase/tests/test-list-share-migration.sql` (+ `legacy-share-fixture.sql`)
  — oppgraderingsløpet fra den gamle databasefasongen.
* `supabase/tests/test-users-and-sharing.sql` — grunnflyten (registrering, RLS,
  deling, import, gravsteiner, anon-sperre).
* `tests/roles-and-sections.test.js` — de tre seksjonene, capability-styrte
  knapper, medlemskategorier, breadcrumbs, tap av tilgang (desktop + mobil).
