# Plan: søk, kommende hendelser og varsler

Dette dokumentet er den autoritative implementeringsplanen for tre nye funksjonsområder i Huskis:

1. globalt søk;
2. oversikt over kommende hendelser og en ny fristinvariant;
3. varsler i appen, nettleseren og Android-appen.

Planen er bevisst delt i fire PR-er. De to første skal være fullt funksjonelle og testbare i nettleseren. Varsling deles i et rent Huskis-lag og et plattformlag, slik at native-/nettleserspesifikk kompleksitet ikke blandes inn i den sentrale forretningslogikken.

## Overordnede prinsipper

- Behold én felles HTML/CSS/JavaScript-kodebase for web og Capacitor.
- Gjenbruk eksisterende lokal/synkronisert tilstand; ikke introduser databaseendringer uten et konkret behov.
- Bygg sentrale regler som rene eller mest mulig isolerte funksjoner, slik at UI, varsler og tester bruker samme logikk.
- Alle nye brukerrettede tekster går gjennom eksisterende i18n-system.
- Alle nye kontroller følger Huskis' designsystem, safe-area-regler, tastaturstøtte og WCAG-krav.
- Slettede objekter/papirkurvinnhold skal aldri dukke opp i søk, hendelsesoversikt eller varsler.
- Funksjonene skal virke med delte områder/mapper og respektere eksisterende tilgangs-/synkregler.
- Eksisterende offline-first- og LWW-synkregler skal ikke omgås.
- Nye funksjoner skal dekkes av automatiserte regresjonstester og relevante nettlesertester.
- Oppdater relevant dokumentasjon når en PR endrer en etablert regel.

---

# PR 1 — Globalt søk og generell navigasjon til objekt

## Mål

Brukeren skal kunne finne ethvert levende område, enhver levende mappe, liste, kategori eller listepunkt hen har tilgang til, og navigere dit direkte.

PR-en skal samtidig innføre én generell navigasjonsmekanisme som senere kan gjenbrukes av «Kommende hendelser» og varsler.

## 1. Toppkontroller

### 1.1 Ny søkeknapp

- Legg til en knapp med forstørrelsesglassikon til venstre for lys/mørk-knappen.
- Knappen skal følge samme størrelse, flate, fokusstil, safe-area-regler og hover/active-mønster som eksisterende hjørnekontroller.
- Knappen skjules før innlogging på samme måte som konto-/draktkontrollene.
- Legg til tilgjengelig navn/tooltip via i18n.

### 1.2 Gjør hjørnekontrollene skalerbare

Dagens CSS er bygget rundt to faste knapper. Refaktorer dette til en felles responsiv kontrollgruppe for:

1. senere varselknapp;
2. senere kalenderknapp;
3. søk;
4. lys/mørk;
5. konto.

For PR 1 finnes bare søk + lys/mørk + konto, men strukturen skal tåle de to neste uten nye hardkodede `right:`-kjeder.

Krav:

- Desktop/bred skjerm: kontrollene ligger på én rad i øvre høyre område.
- Smal skjerm/mobil: gruppen kan brytes til flere rader dersom nødvendig; ingen knapp skal bli mindre enn eksisterende berøringsmål eller kollidere med breadcrumb/toppmeny.
- Safe areas må fortsatt respekteres i native skall.
- Eksisterende lys/mørk- og kontoknappadferd skal være uendret.

## 2. Søkemodal

Lag en modal med:

- tittel «Søk»;
- søkeinput som får fokus automatisk ved åpning;
- fortløpende resultatliste under inputen;
- tydelig tomtilstand dersom søket ikke gir treff;
- ingen massiv resultatdump når inputen er tom;
- Escape lukker modalen;
- vanlig fokusfelle/modaladferd i tråd med resten av Huskis.

### Tastaturnavigasjon

- Pil ned/opp flytter aktivt søkeresultat.
- Enter åpner aktivt resultat.
- Mus/touch skal fungere uten særbehandling.
- Aktiv rad skal være visuelt og semantisk tydelig.

## 3. Hvilke objekter som søkes

Søk over alle levende, tilgjengelige:

1. områder;
2. mapper;
3. lister;
4. kategorier;
5. listepunkter.

Ikke inkluder:

- objekter i papirkurven;
- virtuelle/interne tekniske objekter som ikke er meningsfulle for brukeren;
- ferdige listepunkter skal fortsatt kunne finnes — søk er navigasjon, ikke en oppgavelistefiltrering.

Bygg en normalisert søkeindeks fra gjeldende klienttilstand. Databasen skal ikke spørres per tastetrykk.

## 4. Tekstnormalisering

- Case-insensitiv matching.
- Behandle Unicode/norske bokstaver korrekt.
- Trim ledende/etterfølgende whitespace i søket.
- Ikke innfør aggressiv fuzzy matching i PR 1.
- Ikke fjern diakritikk dersom det gir unaturlige norske treff; enkel, forutsigbar matching er viktigere enn «smart» matching.

## 5. Treffgrupper

Resultatlisten består av to deler i denne rekkefølgen:

1. **Prefikstreff** — normalisert objektnavn begynner med søketeksten.
2. **Infikstreff** — objektnavnet inneholder søketeksten et annet sted, og er ikke allerede et prefikstreff.

Det trenger ikke nødvendigvis vises eksplisitte seksjonsoverskrifter dersom den visuelle listen blir bedre uten, men sorteringsgrensen skal være deterministisk.

## 6. Sortering

Innen prefiksgruppen og deretter infiksgruppen:

### Primær sortering: objekttype

1. område;
2. mappe;
3. liste;
4. kategori;
5. listepunkt.

### Sekundær sortering innen samme objekttype

1. eksakt/fullt treff før lengre navn;
2. deretter alfabetisk etter normalisert objektnavn;
3. dersom navnene fortsatt er like, bruk en stabil tie-breaker, f.eks. full sti og til slutt ID, slik at rekkefølgen aldri hopper tilfeldig mellom rendringer.

Dette realiserer regelen om at et treff der «neste bokstav» ligger tidligere i alfabetet kommer før et tilsvarende treff med senere neste bokstav.

## 7. Visning av søkeresultat

Hver rad bør vise:

- passende typeikon;
- objektnavn som primærtekst;
- objekttype i dempet form dersom ikonet alene ikke er nok;
- en diskret kontekststi som gjør identiske navn forståelige.

Eksempler:

- område: `Arbeid`;
- mappe: `Arbeid › Klinikk`;
- liste: `Arbeid › Klinikk › Vaktdager`;
- kategori: `Arbeid › Klinikk › Vaktdager › September`;
- listepunkt: `Arbeid › Klinikk › Vaktdager › September › Mandag`.

Unngå å gjøre resultatene visuelt tunge; navnet skal dominere.

## 8. Generell navigasjonsfunksjon

Lag én sentral funksjon/API, konseptuelt `navigateToObject(target, options)`, som tar nok metadata/ID-er til å navigere til:

- område;
- mappe;
- liste;
- kategori;
- listepunkt.

Denne funksjonen skal være den eneste nye mekanismen søk bruker, og senere gjenbrukes av PR 2 og PR 3.

### 8.1 Område

Ved trykk på område:

- lukk søkemodalen;
- åpne navigasjonsmodalen;
- finn området;
- sørg for at området er synlig/utvidet dersom det kan være kollapset;
- scroll området inn i synlig område om nødvendig;
- gi kortvarig, ikke-forstyrrende visuell markering/fokus;
- ikke velg en mappe automatisk bare fordi området ble valgt som søkeresultat.

### 8.2 Mappe

Ved trykk på mappe:

- lukk søkemodalen;
- naviger til riktig område og mappe via eksisterende sentrale mappefunksjon (`goToGroup` eller en generalisering av den);
- render riktig mappe;
- behold eksisterende nav-preferanser/synksemantikk.

### 8.3 Liste

Ved trykk på liste:

- gå til overordnet mappe;
- render board;
- scroll listen inn i synlig område;
- dersom listen er kollapset og målobjektet er selve listen, er det ikke nødvendig å åpne den med mindre UX tilsier det;
- gi kortvarig markering uten å endre data.

### 8.4 Kategori/listepunkt

Ved trykk på kategori eller listepunkt:

- gå til overordnet mappe;
- sørg for at overordnet liste er ekspandert dersom nødvendig;
- render ferdig før scroll utføres;
- scroll målet inn i synlig område;
- gi kortvarig markering/fokus.

Navigasjonen må tåle board-relayout og fler-kolonne-layout uten at scrollingen skjer mot en node som umiddelbart erstattes.

## 9. Tilgjengelighet

- Korrekt dialogsemantikk.
- Automatisk fokus i input ved åpning.
- Fokus returneres til søkeknappen ved lukking.
- Resultatlisten skal ha forståelig semantikk for skjermleser.
- Aktivt resultat ved piltastnavigasjon annonseres på en hensiktsmessig måte.
- Farge skal ikke være eneste bærer av objekttype/aktiv rad.
- Respekter `prefers-reduced-motion` ved markering/scroll-animasjon.

## 10. Tester for PR 1

Minimum:

### Søkelogikk

- prefiks før infiks;
- typeprioritet 1–5;
- eksakt treff før lengre treff innen samme type;
- korrekt alfabetisk sortering;
- case-insensitivitet;
- norske tegn/Unicode;
- stabile ties;
- papirkurvinnhold ekskluderes;
- ferdige listepunkter inkluderes.

### Navigasjon

- område åpner nav-modal og peker ut riktig område uten å velge mappe;
- mappe bytter område/mappe korrekt;
- liste i annen mappe navigerer og scrolles til;
- kategori/listepunkt åpner nødvendig kollapset liste og scrolles til;
- identiske navn i ulike stier navigerer til riktig ID.

### UI/a11y

- autofokus;
- Escape;
- pil opp/ned + Enter;
- fokusretur;
- responsiv kontrollgruppe;
- safe-area-regresjoner;
- norsk/engelsk i18n-kontrakt.

## 11. Dokumentasjon for PR 1

- Dokumenter globalt søk og den generelle objekt-navigasjonsfunksjonen i passende eksisterende dokument eller et nytt kort dokument.
- Oppdater design-/tilgjengelighetsdokumentasjon dersom hjørnekontrollsystemet endres strukturelt.
- Ikke oppdater mobilplanens fase/status; PR 1 er produktfunksjonalitet, ikke en ny mobilfase.

## Ferdigkriterium PR 1

PR 1 er ferdig når en bruker i nettleser kan søke etter alle fem objekttyper med definert sortering, bruke mus/touch/tastatur til å velge et treff og pålitelig havne ved riktig objekt, og hele løsningen er dekket av automatiserte tester uten database- eller native-endringer.

---

# PR 2 — Kommende hendelser og fristinvariant

## Mål

Gi brukeren én samlet, prioritert oversikt over relevante frister og starttider på tvers av hele tilgjengelig Huskis-tilstand, uten redundans fra arvede tider.

PR-en skal samtidig gjøre frist-hierarkiet konsistent: et barn kan aldri ha en senere frist enn en forelder som selv har frist.

## 1. Kalenderknapp og modal

- Legg til kalenderknapp til venstre for søkeknappen i den responsive kontrollgruppen fra PR 1.
- Åpner modal med tittelen «Kommende hendelser».
- Modalens innhold beregnes fra gjeldende lokale tilstand når den åpnes og oppdateres ved relevante lokale/synkroniserte endringer mens den er åpen.
- Tomtilstand når ingen relevante hendelser finnes.

## 2. Sentral hendelsesmotor

Lag én sentral funksjon/modul, konseptuelt `collectUpcomingEvents(state, now)`, som returnerer normaliserte hendelser uten UI-avhengighet.

Den skal:

- gå over alle levende og tilgjengelige lister, kategorier og listepunkter;
- forstå egne kontra arvede tider;
- forstå fullføringsstatus;
- deduplisere hierarkisk;
- klassifisere frister og starter;
- returnere nok ID-/stiinformasjon til `navigateToObject()` fra PR 1;
- være deterministisk ved eksplisitt `now`, slik at grensetilfeller kan testes uten å avhenge av systemklokken.

UI og senere varselgenerator skal bruke denne funksjonen eller et felles underliggende regelsett — ikke kopiere reglene.

## 3. Hva som regnes som aktivt/ufullført

### Listepunkt

Aktivt hvis:

- det er levende;
- det ikke er kategori;
- `done !== true`.

### Kategori

Aktiv hvis den inneholder minst ett levende, ikke-fullført listepunkt som faktisk er barn av kategorien.

En kategori uten listepunkter regnes som utført/irrelevant i hendelsesoversikten.

### Liste

Aktiv hvis den inneholder minst ett levende, ikke-fullført listepunkt, uavhengig av om punktet ligger i kategori eller direkte på listen.

En liste uten listepunkter regnes som utført/irrelevant i hendelsesoversikten.

Ferdige listepunkter skal aldri vises som kommende hendelse.

## 4. Egne og arvede tider

Behold eksisterende presedens:

1. en liste med `lockTimes` styrer tidene til alle sine listepunkter;
2. ellers styrer en kategori med `lockTimes` tidene til sine egne listepunkter;
3. ellers bruker listepunktet egne tider.

Men hendelsesoversikten må skille mellom:

- **effektiv tid**: tiden som faktisk gjelder for objektet;
- **egen eksplisitt tid**: verdi objektet selv har satt;
- **arvet tid**: effektiv tid som kommer fra forelder.

Et rent arvet tidspunkt skal ikke generere en separat barn-hendelse når forelderen allerede representerer samme tidspunkt.

## 5. Fristseksjonen

Vis seksjon «Tidsfrister» med tre grupper:

### 5.1 Frist utløpt

- rødt varselikon/fyll i tråd med designsystemet;
- objekter med effektiv frist tidligere enn `now`;
- lengst overskredet først.

### 5.2 Frist innen 7 dager

- gult varselikon/fyll;
- `now <= due < now + 7 døgn`;
- nærmest frist først.

### 5.3 Frist om 7 dager eller mer

- grønn/nøytral fremtidsmarkering;
- `due >= now + 7 døgn`;
- nærmest frist først.

Bruk eksakte, uttømmende grenser i kode og tester. Unngå et hull ved nøyaktig 7 døgn.

## 6. Hierarkisk deduplisering for frister

Frister skal vise høyeste meningsfulle nivå, men et barn med tidligere egen frist skal kunne bryte ut.

### 6.1 Liste

En aktiv liste med egen/effective frist vises som listehendelse.

### 6.2 Kategori

En aktiv kategori vises ikke separat dersom dens frist bare er arvet/identisk fra listen og listen allerede representerer tidspunktet.

En kategori kan vises separat dersom den har en egen, tidligere frist enn listen.

Når listens frist allerede er utløpt, skal listen dominere over underliggende kategorier/listepunkter som også er utløpt på grunn av samme eller senere foreldrekontekst. Dette hindrer en vegg av redundante røde hendelser.

### 6.3 Listepunkt

Et listepunkt vises separat dersom:

- det har en relevant effektiv frist;
- fristen ikke bare er en ren arv som allerede representeres av forelder;
- og det tilfører tidsinformasjon som ikke allerede er dominert av en utløpt forelder.

Typisk: et listepunkt med egen frist tidligere enn kategori/listens frist vises mens forelderens frist ennå ikke er utløpt.

Skriv dedupliseringsreglene eksplisitt i tester for kombinasjoner liste → kategori → listepunkt.

## 7. Startseksjonen

Vis separat seksjon «Starttider». Samme objekt kan finnes både her og under «Tidsfrister».

Grupper:

### 7.1 Har begynt

- bruk et start/play-ikon eller annet ikon som ikke kan forveksles med «utført»;
- effektiv starttid < eller = `now`;
- mest nylig påbegynt først, med mindre testing/UX viser at eldste pågående gir bedre mening; velg én deterministisk regel og dokumenter den.

### 7.2 Begynner innen 7 dager

- klokkeikon;
- `now < start < now + 7 døgn`;
- nærmest start først.

### 7.3 Begynner om 7 dager eller mer

- kalender/fremtidsikon, ikke rødt kryss;
- `start >= now + 7 døgn`;
- nærmest start først.

## 8. Deduplisering for starttider

Ikke speil fristregelen ukritisk.

- Rent arvet/identisk starttid skjules på barn når forelder allerede representerer samme hendelse.
- Et barn med særskilt egen starttid skal fortsatt kunne vises selv om en forelder allerede har begynt.
- En forelders start betyr ikke at alle barn med senere eksplisitt start automatisk er «begynt».

Dette er viktig for at oversikten ikke skal gi feil semantikk.

## 9. Tidssemantikk: dato med og uten klokkeslett

Før hendelser og varsler bygges må Huskis ha én eksplisitt regel:

- startdato uten klokkeslett tolkes som starten av lokal dag (`00:00`) når et eksakt tidspunkt er nødvendig;
- fristdato uten klokkeslett tolkes som slutten av lokal dag (`23:59:59.999`) når et eksakt tidspunkt er nødvendig.

Dette skal brukes konsistent ved:

- klassifisering mot `now`;
- 7-døgnsgrenser;
- validering barn mot forelder;
- senere varselplanlegging.

Behold visningsformatet som før; regelen gjelder semantikk, ikke nødvendigvis lagringsformat.

Hvis eksisterende tidsfunksjoner har annen semantikk, refaktorer til én felles sammenlignings-/normaliseringsmekanisme og oppdater `docs/scheduling.md`.

## 10. Ny hard fristinvariant

### Regel

Hvis en forelder har frist, kan barnet bare ha egen frist som er **før eller lik** forelderens frist.

Hvis forelderen ikke har frist, kan barnet ha hvilken som helst frist.

### Foreldreforhold

- kategori → liste;
- kategorisert listepunkt → kategori;
- ukategorisert listepunkt → liste.

Hvis listen låser tidene, er barnets effektive tid allerede styrt av listen; egen skjult verdi skal ikke kunne skape en aktiv konflikt så lenge låsen gjelder, men verdien må valideres når den igjen blir aktiv/kan redigeres.

### UI-validering

Ved forsøk på ugyldig senere frist:

- ikke lagre den ugyldige verdien;
- behold/tilbakestill til forrige gyldige verdi;
- vis kort, tydelig feilmelding som forklarer at barnets frist må være senest samtidig med forelderens;
- oppgi gjerne forelderens navn og frist dersom det kan gjøres uten å gjøre meldingen tung.

Ingen bekreftelsesmodal.

### Valider alle innganger

Regelen må håndheves uansett om fristen endres via:

- objektmenyens tidsplan;
- hurtig-popover fra tidschip;
- eventuell annen eksisterende kodevei som kan sette `due`.

Legg valideringen i den sentrale setter-/commitlogikken, ikke bare i ett UI-felt.

### Forelder endres etter barnet

Hvis brukeren forsøker å flytte **forelderens** frist tidligere enn en eller flere eksisterende barns egne gyldige frister, skal endringen også avvises. Ikke muter barnas frister automatisk uten eksplisitt produktbeslutning.

Feilmeldingen bør forklare at ett eller flere barn har en senere frist og må endres først.

Dette er nødvendig for at invarianten faktisk skal være sann i begge retninger.

## 11. Eksisterende data som allerede bryter regelen

Dagens Huskis har eksplisitt tillatt tider utenfor foreldrenes tidsrom. Det kan derfor finnes eldre data som bryter den nye invarianten.

PR 2 skal:

- ikke slette eller automatisk endre eksisterende tidsdata under normalisering/synk;
- tåle å vise slike data;
- hindre nye brudd;
- hindre at et eksisterende brudd «bekreftes på nytt» gjennom redigering;
- dokumentere en tydelig strategi for legacy-brudd.

Anbefalt UX: vis eksisterende konflikt som en tydelig, men ikke blokkerende valideringsmelding når tidseditoren åpnes, og krev at neste relevante tidsendring bringer objektet tilbake til gyldig tilstand. Ikke gjør datamigrasjon i denne PR-en med mindre eksisterende fixtures viser at en sikker, deterministisk migrasjon er åpenbar.

## 12. Rader i «Kommende hendelser»

Hver hendelsesrad viser minst:

- statusikon/farge;
- objektnavn;
- objekttype eller kontekst;
- konkret start-/fristtid;
- diskret sti dersom identiske navn kan forekomme.

Trykk på raden:

- lukker modalen;
- bruker `navigateToObject()` fra PR 1;
- scroll/markerer riktig objekt.

## 13. Tester for PR 2

Minimum:

### Fullføringslogikk

- tom liste/kategori er irrelevant;
- alle barn ferdige → forelder irrelevant;
- minst ett uferdig barn → forelder aktiv.

### Tidsarv

- listelås har presedens;
- kategorilås gjelder egne barn;
- egne tider uten lås;
- arvet barn dedupliseres.

### Frister

- utløpt;
- nøyaktig nå;
- < 7 døgn;
- nøyaktig 7 døgn;
- > 7 døgn;
- sorteringsrekkefølge;
- liste/kategori/listepunkt-hierarki;
- tidligere barnefrist vises separat;
- utløpt forelder dominerer redundant barn.

### Starter

- begynt;
- < 7 døgn;
- nøyaktig 7 døgn;
- senere;
- særskilt barnestart bevares selv om forelder har begynt.

### Dato/klokkeslett

- startdato uten klokke = dagens start;
- fristdato uten klokke = dagens slutt;
- DST-/lokal-veggtid håndteres uten utilsiktet UTC-konvertering.

### Invariant

- barn før forelder godtas;
- lik frist godtas;
- barn etter forelder avvises;
- barn med frist når forelder mangler frist godtas;
- forelder kan ikke flyttes foran eksisterende barns frister;
- kategori/listelistepunkt begge veier;
- alle UI-kodeveier bruker samme validering;
- legacy-brudd ødelegger ikke lasting/synk.

### UI/a11y

- modalgrupper og tomtilstand;
- tastatur/fokus;
- responsiv kalenderknapp;
- klikk på hendelse navigerer via PR 1-funksjonen;
- i18n og kontrast.

## 14. Dokumentasjon for PR 2

Oppdater `docs/scheduling.md` slik at det ikke lenger står at tider utenfor foreldres frist fritt er tillatt.

Dokumenter:

- effektiv/arvet tid;
- dato-uten-klokke-semantikk;
- hard fristinvariant;
- legacy-data;
- hendelsesmotor/deduplisering.

## Ferdigkriterium PR 2

PR 2 er ferdig når «Kommende hendelser» gir en korrekt, ikke-redundant oversikt over alle relevante start-/fristobjekter på tvers av Huskis, navigerer via PR 1, og den nye fristinvarianten er håndhevet sentralt og testet uten å ødelegge eldre data.

---

# PR 3A — In-app-varsler, historikk og preferanser

## Mål

Huskis skal kunne generere, lagre og vise varselhendelser inne i appen på en robust og synkbar måte, uavhengig av om eksterne Android-/nettleservarsler er slått på.

Denne PR-en skal **ikke** innføre native Android-varsler eller Web Push. Den etablerer den plattformuavhengige varselkjernen først.

## 1. Varseltyper

Brukeren skal kunne slå av/på hver av disse typene separat:

1. fristbrudd;
2. frist utløper om mindre enn én uke;
3. begynner nå;
4. begynner om mindre enn én uke.

Definer grensene med samme tidssemantikk som PR 2.

Anbefalt hendelsestidspunkt:

- «fristbrudd»: genereres når effektiv frist passeres;
- «frist < 1 uke»: genereres én gang når objektet passerer terskelen `due - 7 døgn`;
- «begynner nå»: genereres når effektiv start passeres;
- «begynner < 1 uke»: genereres én gang ved `start - 7 døgn`.

Ikke generer samme terskelvarsel på nytt hver gang appen åpnes.

## 2. Gjenbruk hendelses-/tidsreglene

Varselgeneratoren skal dele samme grunnregler som «Kommende hendelser» for:

- effektiv/arvet tid;
- fullførte objekter;
- hierarkisk deduplisering;
- dato uten klokkeslett;
- navigasjonsmål.

Ikke lag en separat «nesten lik» implementasjon.

## 3. Varselidentitet og idempotens

Hvert logisk varsel må ha en deterministisk identitet som gjør det mulig å vite at det allerede er generert.

Identiteten bør minst binde sammen:

- bruker/mottaker;
- objekttype + objekt-ID;
- varseltype/terskel;
- relevant planlagt tidsverdi eller revisjon av den.

Hvis en bruker endrer fristen/starttiden etter at et terskelvarsel er generert, må systemet ha eksplisitt semantikk for om en ny tidsplan senere kan generere et nytt varsel. Anbefalt: endret relevant tidspunkt gir ny logisk varselinstans; identiteten inkluderer planlagt tidsverdi.

## 4. Hvor varselhistorikken lagres

Før implementering skal Claude undersøke dagens data-/synkmodell og velge den minste robuste løsningen.

Krav:

- historikken skal være knyttet til brukeren, ikke til en bestemt nettleser/enhet;
- lest/ulest bør være konsistent på tvers av brukerens enheter;
- «Tøm varsler» skal gjelde brukerens historikk, ikke alle deltakere i et delt objekt;
- andre brukeres varsler må aldri eksponeres.

Dette tilsier sannsynligvis egne brukerrettede Supabase-rader/tabeller fremfor å legge varselhistorikk inn i dokumenttilstanden, men implementeringen skal velges etter inspeksjon av dagens arkitektur.

Alle skjemaendringer skal være additive og bakoverkompatible med gamle klienter.

## 5. Varselpreferanser

Lag fire brukerpreferanser for typene over.

Krav:

- preferanser er per bruker;
- synkroniseres mellom enheter;
- alle bør ha et eksplisitt standardvalg;
- anbefalt standard ved lansering er AV for eksterne varsler, men in-app-historikk kan enten følge samme preferanse eller ha egen semantikk — velg og dokumenter tydelig før kode.

Anbefalt produktregel: de fire innstillingene styrer **om varselhendelsen genereres i det hele tatt**. Dermed er in-app- og eksternt varsel to leveringskanaler for samme valgte hendelser.

## 6. Varselknapp og badge

- Legg varselknappen til venstre for kalenderknappen i kontrollgruppen.
- Bruk et bjelleikon eller annet standard varselikon.
- Badge viser antall uleste varsler.
- Skjul badge når antallet er 0.
- Vurder visningsregel ved svært høyt antall, f.eks. `99+`, for å unngå layoutbrudd.
- ARIA-navn skal inkludere ulest antall når > 0.

## 7. Varselmodal

Modalen viser:

- tittel «Varsler»;
- nyeste varsel øverst;
- hver rad med ikon/farge etter varseltype;
- melding/objektnavn;
- diskret dato + klokkeslett i liten skrift;
- tomtilstand når historikken er tom;
- «Tøm varsler»-kontroll.

Trykk på et varsel bruker `navigateToObject()` fra PR 1 dersom objektet fortsatt finnes.

Hvis objektet er slettet eller brukeren har mistet tilgang:

- historikkraden kan fortsatt vises;
- klikk skal ikke feile eller lekke utilgjengelige data;
- vis eventuelt en kort melding om at objektet ikke lenger er tilgjengelig.

## 8. Lest/ulest

Når varselmodalen åpnes:

- alle varsler som brukeren faktisk har tilgang til i historikken markeres som lest automatisk;
- badge forsvinner/oppdateres uten «Sett alle som lest»-knapp;
- operasjonen skal være idempotent og tåle flere enheter.

Et varsel som kommer **etter** at modalens åpningstidspunkt er tatt, skal ikke ved et uhell markeres lest før brukeren faktisk har sett det. Implementer mark-as-read med en øvre tids-/ID-grense eller tilsvarende robust strategi.

## 9. «Tøm varsler» med 10 sekunders angre

Ved trykk:

1. ta et øyeblikksbilde av akkurat hvilke varsel-ID-er som skal slettes;
2. skjul disse umiddelbart i UI;
3. erstatt «Tøm varsler» med `Angre · 10`, der tallet teller ned;
4. ingen ekstra bekreftelse;
5. trykk «Angre» gjenoppretter snapshotet;
6. etter 10 sekunder committes slettingen permanent;
7. lukking av modal committer slettingen umiddelbart.

Varsler som ankommer etter snapshotet må ikke slettes sammen med det gamle settet.

Ved synkfeil skal appen ikke late som permanent sletting er ferdig dersom serveroperasjonen faktisk mislyktes; gjenbruk Huskis' etablerte optimistiske/synk-sikkerhetsmønstre der det passer.

## 10. Generering når appen ikke har vært åpen

Selv før eksterne varsler finnes må in-app-historikken kunne «ta igjen» terskler etter fravær.

Eksempel: appen var lukket i ti dager, og en frist gikk både inn i <7-døgnsvinduet og senere ble utløpt. Ved neste synk/åpning må generatoren kunne opprette relevante manglende varselhendelser uten duplikater.

Bestem og dokumenter om begge historiske hendelser skal logges eller bare siste relevante status. Anbefalt: logg hver valgte terskel som faktisk ble passert, med faktisk terskeltid som hendelsestid, slik at historikken beskriver hva som skjedde.

## 11. Fullførte/slettede objekter og endrede tider

Definer eksplisitt:

- fullføres et listepunkt før terskelen → fremtidig varsel skal ikke genereres;
- fullføres det etter at varsel er generert → historikken beholdes;
- slettes objektet → historikken kan beholdes, men navigasjon deaktiveres;
- flyttes objektet → historikken følger objekt-ID, ikke gammel sti;
- endres start/frist → avlys/ignorer fremtidige terskler fra gammel tidsplan og planlegg/generer etter ny tidsplan.

## 12. Tester for PR 3A

Minimum:

- fire preferanser på/av;
- idempotent generering;
- terskler og eksakte grenser;
- catch-up etter lang frakobling/lukket app;
- endret tidspunkt;
- fullført før/etter terskel;
- arvet/deduplisert tid;
- flere enheter genererer ikke duplikater;
- ulest badge;
- åpning markerer bare eksisterende varsler lest;
- nytt varsel under åpen modal forblir korrekt behandlet;
- newest-first;
- 10 s undo;
- lukking committer;
- nye varsler under undo-vindu slettes ikke;
- slettet/utilgjengelig mål håndteres trygt;
- i18n/a11y/kontrast.

## 13. Dokumentasjon for PR 3A

Lag et autoritativt dokument for varselmodellen som beskriver:

- varseltyper og terskler;
- identitet/idempotens;
- lagring;
- read/unread;
- undo-sletting;
- forholdet mellom in-app-historikk og senere eksterne leveringskanaler.

## Ferdigkriterium PR 3A

PR 3A er ferdig når Huskis har en robust, per-bruker, idempotent varselhistorikk med preferanser, ulest badge, automatisk markering som lest, navigasjon og 10-sekunders angresletting — uten native eller Web Push-avhengighet.

---

# PR 3B — Eksterne varsler: Android og nettleser

## Mål

Levere de valgte varselhendelsene også utenfor selve Huskis-UI-et:

- som Android-varsler i den native Capacitor-appen;
- som nettleservarsler der plattformen støtter det.

Dette er en plattform-PR og krever eksplisitt testing på fysisk Android og i relevante desktop-/mobilnettlesere.

## 1. Arkitekturvalg før kode

Claude skal først verifisere gjeldende Capacitor-versjon, Android-krav og nettleserstøtte mot offisiell dokumentasjon.

Hold kanalene konseptuelt separate:

### Android

For tidsbaserte personlige varsler bør førstevalget være lokale native varsler planlagt på enheten, dersom de oppfyller kravene etter verifikasjon.

Fordeler:

- ingen pushserver nødvendig for selve tidsalarmen;
- fungerer naturlig for brukerens lokale veggtid;
- kan planlegges/endres når Huskis synkroniserer data.

### Web

Bakgrunnsvarsling når nettleserfanen ikke er åpen krever Web Push/service worker og en serverdel som kan sende push. Vanlig Notifications API alene er ikke nok som generell bakgrunnsmekanisme.

Ikke lat som Android Local Notifications og Web Push er samme tekniske løsning. De skal konsumere samme varselmodell, men ha hver sin adapter.

## 2. Tillatelser og opt-in

- Be aldri om OS-/nettlesertillatelse ved første sidevisning uten brukerhandling.
- Brukeren skal først aktivere relevant varselkanal i Huskis.
- Forklar kort hvorfor tillatelsen trengs før systemdialogen utløses.
- Håndter «nektet» og «permanent nektet» uten gjentatte masete prompts.
- Vis kanalstatus i innstillinger: aktiv, ikke gitt, blokkert/ikke støttet.

Android 13+ og eventuelle nyere krav skal håndteres eksplisitt etter dokumentasjonsverifikasjon.

## 3. Tidssone

Huskis lagrer planlegging som lokal veggtid. Android kan tolke dette lokalt på enheten, men en Web Push-server trenger brukerens tidssone.

PR 3B skal derfor innføre en eksplisitt tidssonestrategi.

Anbefalt:

- lagre brukerens IANA-tidssone, f.eks. `Europe/Oslo`, som per-bruker preferanse;
- oppdater den når klienten oppdager at systemtidssonen har endret seg, med en konservativ regel;
- serverberegning av pushterskler bruker denne sonen;
- dokumenter hvordan delt innhold med samme veggtid oppfører seg for brukere i ulike tidssoner.

Ikke konverter selve eksisterende `start`/`due`-feltene til UTC i denne PR-en uten en separat migrasjonsbeslutning.

## 4. Android-adapter

Implementer en tynn plattformadapter rundt den verifiserte Capacitor-pluginen.

Adapteren skal kunne:

- sjekke støtte/tillatelse;
- be om tillatelse etter eksplisitt brukerhandling;
- planlegge fremtidige terskelvarsler;
- kansellere gammel plan når tid, fullføringsstatus, sletting eller preferanse endres;
- unngå duplikate native varsler ved gjentatte synk-runder;
- mappe native notification-ID deterministisk til Huskis' logiske varselidentitet;
- åpne Huskis og navigere til riktig objekt når brukeren trykker på varselet.

Hvis appen åpnes via varsel til et objekt i en annen mappe, bruk samme `navigateToObject()`-kontrakt etter at autentisering/synk/initial render er klare.

## 5. Android i bakgrunnen/restart

Test og dokumenter:

- app i forgrunn;
- app i bakgrunn;
- app prosess drept;
- telefon restartet;
- offline ved tidspunktet;
- senere synk endrer eller kansellerer en plan;
- DST-overgang;
- klokke-/tidssoneendring.

Velg plugin-/planleggingsmodus som gir korrekt nok levering uten å kreve unødvendig privilegerte «exact alarm»-tillatelser. Hvis eksakt alarmtillatelse ikke er nødvendig for Huskis' «innen en uke/begynner nå»-semantikk, ikke be om den.

## 6. Web Push-backend

Design minste nødvendige serverdel, sannsynligvis i eksisterende Supabase-/serverinfrastruktur.

Krav:

- push-abonnement knyttes til autentisert bruker;
- støtte for flere nettlesere/enheter per bruker;
- abonnement kan utløpe og ryddes opp sikkert;
- VAPID/private nøkler ligger aldri i klientkode/repo;
- RLS/autorisasjon hindrer brukere i å lese andre brukeres subscriptions;
- backend sender bare varsler brukeren har valgt;
- idempotens mot samme logiske varsel-ID;
- ingen varseltekst skal inneholde mer sensitivt innhold enn nødvendig.

## 7. Server-side planlegging for web

Velg en robust mekanisme som regelmessig finner terskler som er nådd og ennå ikke levert via webkanalen.

Krav:

- tåle scheduler-forsinkelse uten tap;
- idempotent ved retry;
- bruke brukerens IANA-tidssone;
- respektere fullført/slettet/endret tidspunkt ved sendetid;
- ikke sende samme logiske varsel to ganger til samme subscription;
- kunne sende til flere av brukerens aktive subscriptions dersom det er ønsket kanaladferd.

Ikke bygg en scheduler som krever at brukerens Huskis-fane er åpen.

## 8. Web service worker

- Registrer service worker på en måte som ikke bryter Huskis' eksisterende auto-update/OTA-/cachemodell.
- Hold service workerens ansvar så smalt som mulig dersom Huskis ellers ikke er en PWA.
- Håndter push-event og notification click.
- Klikk skal fokusere eksisterende Huskis-vindu hvis mulig, ellers åpne appen, og deretter navigere til objekt når appen er klar.
- Oppdater CSP/sikkerhetsdokumentasjon dersom nødvendig.

## 9. Kanalpreferanser

Skill mellom:

- hvilke **hendelsestyper** brukeren ønsker (PR 3A);
- hvilke **leveringskanaler** som er aktive: in-app, Android-systemvarsel, web push.

Ikke tving brukeren til å duplisere fire hendelsestypevalg per kanal med mindre det finnes et klart UX-behov.

Anbefalt UI:

- fire hendelsestypebrytere;
- egen kanalstatus/bryter for «Varsler på denne enheten/nettleseren».

## 10. Sikkerhet og personvern

- Eksterne varsler kan vises på låseskjerm; bruk konservativ tekst.
- Vurder standardtekst som «En frist i Huskis er utløpt» + objektnavn bare dersom brukerens valg eksplisitt tillater detaljert innhold.
- Ikke legg delings-/tilgangstokens i notification payload.
- Ved klikk skal appen gjøre vanlig autorisasjonskontroll; notification payload er bare en peker, aldri bevis på tilgang.

## 11. Tester for PR 3B

### Automatisert

- plattformdeteksjon;
- permission-state-håndtering;
- schedule/cancel-reschedule;
- deterministiske notification-ID-er;
- preferences;
- Web Push subscription-RLS;
- server-idempotens;
- tidssone/DST-regler;
- service-worker click-routing;
- CSP/build/Capacitor-regresjoner;
- gamle web-/Android-klienter tåler additive skjemaendringer.

### Fysisk Android

Må verifiseres eksplisitt:

- tillatelsesdialog;
- varsel i forgrunn/bakgrunn;
- varsel etter app-kill;
- tap på varsel åpner riktig Huskis-objekt;
- endret frist avlyser gammel plan og oppretter ny;
- fullføring avlyser fremtidig plan;
- restart dersom plugin/platform krever test av rescheduling;
- OTA-oppdatering ødelegger ikke adapteren.

### Nettleser

Test minst en Chromium-basert desktopbrowser og andre nettlesere som prosjektet eksplisitt støtter.

- opt-in;
- blokkert tillatelse;
- push med lukket/fokusert fane;
- click-routing;
- avregistrert/utløpt subscription;
- flere subscriptions for samme bruker.

## 12. Mobilplan

`docs/mobilapp-plan.md` sier i dag at pushvarsler er en senere mulighet etter minimumsløypa. Når PR 3B faktisk innfører native varsler, oppdater mobilplanen slik at den gjenspeiler ny status og hvilke native kapabiliteter som nå inngår.

Ikke marker noe som fysisk verifisert før det faktisk er prøvd på telefon.

## Ferdigkriterium PR 3B

PR 3B er ferdig når de samme logiske varselhendelsene fra PR 3A kan leveres pålitelig via valgte eksterne kanaler, tillatelser og tidssoner håndteres korrekt, Android er verifisert på fysisk telefon, Web Push fungerer uten å kreve åpen Huskis-fane, og løsningen ikke svekker oppdaterings-, synk- eller sikkerhetsarkitekturen.

---

# Foreslått gjennomføringsrekkefølge

```text
PR 1  Globalt søk + navigateToObject()
  ↓
PR 2  collectUpcomingEvents() + Kommende hendelser + fristinvariant
  ↓
PR 3A Varselmodell + historikk + preferanser + in-app UI
  ↓
PR 3B Android Local Notifications / verifisert native mekanisme
      + Web Push / service worker / serverplanlegging
```

Ikke start en senere PR før den foregående funksjonelle kontrakten er stabil. Særlig skal PR 2 og begge varsel-PR-ene gjenbruke `navigateToObject()`, og PR 3A/3B skal gjenbruke tids-/hendelsesreglene fra PR 2.

# Manuell verifikasjonsstrategi

## PR 1

Manuell nettleserverifikasjon på desktop + smal viewport er tilstrekkelig. Ingen fysisk Android-test kreves med mindre automatiske Capacitor-/safe-area-tester avdekker plattformspesifikk risiko.

## PR 2

Manuell nettleserverifikasjon på desktop + smal viewport. Test særlig nøyaktige tidsgrenser med kontrollerte testdata. Ingen fysisk Android-test kreves i utgangspunktet.

## PR 3A

Nettlesertest er primær. Fordi dette fortsatt er webkode i samme Capacitor-shell, fysisk Android-test er nyttig som sluttkontroll av layout/badge/modal, men ikke teknisk nødvendig for varselkjernens korrekthet.

## PR 3B

Fysisk Android-test er obligatorisk. Nettleser-push må i tillegg testes i reelle støttede nettlesere.

# Ikke-mål for hele serien

- Ingen omskriving til React/Flutter/annet rammeverk.
- Ingen ekstern søketjeneste eller server-side fulltekstsøk for dagens datamengder.
- Ingen fuzzy/semantisk KI-søk i PR 1.
- Ingen automatisk endring av barns frister for å «reparere» hierarkiet uten eksplisitt brukerhandling.
- Ingen native varselkode i PR 1, PR 2 eller PR 3A.
- Ingen påstand om fysisk Android-verifikasjon uten faktisk enhetstest.
