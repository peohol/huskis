# Oppskrifter

Oppskrifter er Huskis' tredje hoveddel, ved siden av Lister og Notater. Dette
dokumentet er **autoritativt** for oppskriftenes struktur, oppskriftsdokumentet,
porsjonsskaleringen, redigeringen og den offentlige lenken. Rettighetene er de
samme som for notatene og står i [rettigheter-og-deling.md](rettigheter-og-deling.md)
del 14; dra-og-slipp-motoren i [drag-and-drop.md](drag-and-drop.md).

## Hierarkiet

**Kokebok › Kapittel › Oppskrift.** En oppskrift ligger enten i et kapittel
eller rett i kokeboken. Kapitler er ett nivå; det finnes ingen underkapitler.
Kapitlene er kokebokens KATEGORIER, som mappekategoriene i et område: de frie
oppskriftene står om hverandre med kapitlene på bokens øverste nivå, sortert på
den samme `pos`-en, og det finnes ingen egen «uten kapittel»-overskrift — verken
i kokebokmenyen, i brødsmulen, i søket eller på den offentlige siden.

Alle tre nivåene kan opprettes, gis nytt navn, slettes (til søppelkassen, med
angre), sorteres, flyttes og deles. Et kapittel kan i tillegg **løses opp**:
kapittelet forsvinner, og oppskriftene i det blir liggende rett i kokeboken PÅ
KAPITTELETS PLASS, i samme rekkefølge — som listepunktene i en oppløst
mappekategori (jevnt fordelt i `pos`-gapet til neste rad på bokens øverste
nivå). Ingen oppskrift slettes av det.

Oppløsningen er en sletting av kapittelet OG en flytting av hver oppskrift til
kokeboken, og den er **alt eller ingenting**: den går som ÉN operasjon på
serveren, `recipe_chapter_dissolve(kapittel, ts, org)`, som i én transaksjon
låser kapittelet og oppskriftene, sjekker retten til å slette kapittelet,
retten til å legge oppskrifter rett i kokeboken og flytteretten på hver
oppskrift mot databasens faktiske tilstand — og så flytter alle og sletter
kapittelet. Mangler én rettighet, også om den forsvant et øyeblikk før, endres
ingenting. Klienten endrer heller ingenting før svaret er der; svaret er de nye
posisjonene, og visningen blir nøyaktig det databasen gjorde. Et nei gir en
melding om at ingenting ble endret.

Menyraden vises bare når klienten ser at alt går (`canDissolveRecipeChapter`) —
det er UX, ikke sikkerhet. Et kapittel som er delt direkte med en eier uten
tilgang til kokeboken (det står i «Delt med meg»), kan derfor slettes, men ikke
løses opp.

Sletter man et kapittel, går oppskriftene i det med i søppelkassen som én enhet
(og kommer tilbake med det). Skal oppskriftene beholdes, er det «Løs opp
kapittelet» som gjelder.

## Datamodellen — de samme tabellene som notatene

Oppskriftene bor i notattabellene, med `kind = 'recipe'`:

| Oppskrift | Tabell | Klient (`state`) |
|---|---|---|
| Kokebok | `note_projects` | `state.noteProjects` (`kind: 'recipe'`) |
| Kapittel | `note_folders` | `p.folders` |
| Oppskrift | `notes` (+ `recipe jsonb`) | `state.notes` |

Det er hele grepet: deling, roller, låser, invitasjoner, gravsteiner, «Delt med
meg», kontosletting og rad-synken gjelder uendret, og rettighetsmodellen finnes
fortsatt ett sted. `kind` er en egenskap ved hele treet — kokebokens verdi er
fasit, kapitler og oppskrifter arver den, den kan ikke endres etterpå, og
databasen avviser en flytting mellom en bokhylle og en kokebok
(`note_child_kind`/`note_kind_consistent` i `supabase/users-and-sharing.sql`).

I klienten skiller `isRecipeObj()` de to sortene. Notatsidens oppslag
(`noteProjects()`, `allNotes()`) ser bare notater, oppskriftssidens
(`recipeBooks()`, `allRecipes()`) bare oppskrifter — de to fanene kan aldri vise
hverandres innhold.

### Oppskriftsdokumentet

`notes.recipe` er ETT strukturert dokument. Formen eies av `recipe-core.js`;
databasen lagrer den som jsonb og tolker den ikke.

```
doc  = { v: 1, desc: '', serv: number|null, ing: Sec, step: Sec }
Sec  = { items: Line[], subs: Sub[] }
Sub  = { id, name, items: Line[] }
Line = ingrediens: { id, q, q2, f, qs, u, t }
       steg:       { id, t }
```

- `serv` er antall porsjoner oppskriften er skrevet for (grunnlaget).
- En ingrediens er strukturert: mengden er et tall (`q`, og `q2` for et spenn som
  «2–3»), atskilt fra enheten (`u`) og navnet (`t`). `f` sier at mengden ble
  skrevet som brøk. En mengde som ikke er et tall («en klype») ligger i `qs` og
  skaleres aldri.
- Dokumentet rir på innholdsregisteret (`ts`/`org`) sammen med tittelen: to
  samtidige redigeringer av den SAMME oppskriften gir én vinner per dokument.
  Oppskrifter har ingen samskriving eller historikk slik notatene har.
- `sanitizeRecipe()` normaliserer alt som kommer inn (synk, offentlig svar) og
  er deterministisk: to kjøringer på samme dokument gir byte-likt svar.

### «Øvrige ingredienser» / «Øvrige steg»

«Øvrige» er **avledet, ikke lagret**. `items` er linjene som ikke står i noen
underinndeling. Overskriften er dempet (grå) bare i redigeringen; ellers står
den som de andre underinndelingenes.

1. Uten underinndelinger vises linjene rett under hovedoverskriften, og en ny
   linje havner der.
2. Den første underinndelingen gjør de eksisterende linjene til «Øvrige», som
   vises sist.
3. En ny linje på hovednivå havner i «Øvrige» så lenge det finnes
   underinndelinger.
4. «Øvrige» kan ikke slettes eller løses opp for hånd — den finnes ikke som
   objekt — og forsvinner av seg selv når den er tom.
5. Er «Øvrige» det eneste som er igjen, er siste ekte underinndeling borte, og
   linjene vises på hovednivå igjen.

Rekkefølgen bevares: å løse opp en underinndeling legger linjene først i
`items`, nøyaktig der de stod i lesestrømmen.

## Porsjonsskaleringen

Faktoren er `valgt / grunnlag`. Den brukes **bare i visningen**
(`formatAmount`) — de lagrede mengdene endres aldri, og valget huskes bare i den
åpne fanen. Tall i desimalform vises som desimaltall med språkets desimaltegn;
mengder skrevet som brøk vises som brøk (½, ⅓, ¼ …) når resultatet ligger nær
en, ellers som desimaltall. Ingredienser uten tall står urørt. Porsjonsvelgeren
finnes bare når oppskriften har et grunnlag.

## Flatene

- **Fanen:** hovedbryteren er Lister | Notater | Oppskrifter. Brødsmulen viser
  kokebok › kapittel og åpner kokebokmenyen; den grønne ＋ lager en oppskrift
  der man står. Oppskriftene vises som notatkortene: tittel og utdrag
  (beskrivelsen, ellers ingrediensene), uten porsjonene.
- **Kokebokmenyen** ER navigasjonsmodalen for oppskrifter: en kokebok er et
  områdekort (kan foldes sammen), et kapittel en mappekategori og en oppskrift
  en mappe. De frie oppskriftene står mellom kapitlene, som ukategoriserte
  mapper. Grønn ＋ nederst i kortet lager en oppskrift rett i boken, gul ＋ et
  kapittel, og ＋ i kapittelet en oppskrift der. ＋-knappene bærer ikonet for
  det de lager, som alle grønne og gule ＋-knapper i appen.
- **Søppelkassene** er utsnitt av den samme kassen. Foten på flaten viser alle
  tre nivåene. I kokebokmenyen er det én kasse per nivå, som i
  navigasjonsmodalen: bøkene i foten, kapitlene og oppskriftene i kokeboken de
  ble slettet fra (`recipeTrashIn`) — bygget alltid, skjult når den er tom.
- **Oppskriftsflaten** er notat-editorens fullskjermsbilde. Den åpner i
  **lesemodus**: beskrivelse, porsjonsvelger, ingredienser som punktliste og
  fremgangsmåten nummerert på nytt i hver underinndeling — uten
  redigeringskontroller. «Rediger» i verktøylinjen (bare med skriverett) bytter
  til redigeringsmodus; tilbake/Escape går først ut av redigeringen, så ut av
  flaten.

### Redigeringsmodusen

- Tittel, beskrivelse og antall porsjoner står øverst.
- Ingredienser har tre felt: mengde, enhet og navn. Skrives «2 dl melk» i
  navnefeltet mens de to andre er tomme, deles det opp. Enhet og navn gir ikke
  stor forbokstav på mobiltastaturet (`autocapitalize="none"`).
- Grønn ＋ under en seksjon lager en linje på hovednivå (regel 1/3 over), grønn
  ＋ i en underinndeling en linje der, og gul ＋ en ny underinndeling.
- Enter lager neste linje; Backspace i en tom linje fjerner den.
- En TOM linje forsvinner når fokus forlater den (klikk et annet sted, eller
  Enter i den), som en ny rad i en liste (`nameNewRow`): den står der for å ta
  imot neste linje (`dropEmptyRecipeLine`, `isEmptyLine`). Et trykk som pågår
  får fullføre før linjen fjernes, så knappen under fingeren ikke byttes ut.
- En underinndeling er en OVERSKRIFT på egen linje over et kort med linjene,
  som en kategori i en liste. Overskriften er håndtaket; menyknappen til høyre
  (objektmenyen) gir «Endre navn», «Flytt» (opp/ned), «Løs opp» (linjene blir)
  og «Slett» (med angre).
- Hver linje har en menyknapp i stedet for et slett-kryss: «Flytt» (opp/ned)
  og «Slett». Flyttingen er for den som ikke kan bruke dra-og-slipp
  (`stepRecipePart` → `stepLine`/`stepSub` i `recipe-core.js`): en linje i
  kanten av sin liste går over i nabolista, så hver plass i seksjonen nås.
- Søppelkassen i foten (`#recipe-edit-trash`, den vanlige `.drop-dock`-kassen)
  vises bare mens noe dras, og et slipp der sletter med én gang, uten
  bekreftelse og uten noe å hente tilbake fra en kasse — det menyens «Slett»
  gjør. Den tar først imot når pekeren har vært utenfor den
  (`recipeTrashWatch`): den folder seg ut nederst, og en linje som løftes der
  skal ikke slettes av at fingeren allerede står på den.
- Alt lagres fortløpende (debounce 400 ms, og alltid ved lukking/`pagehide`).

## Dra-og-slipp

Tre dnd-kit-board gjennom Smett, med den delte limkoden
([drag-and-drop.md](drag-and-drop.md)):

| Scope | Hva | Regel |
|---|---|---|
| `recipesScope` | oppskriftskortene på flaten | omrokkering |
| `recipesNavScope` | kokebøkene (kort) + kapitlene og oppskriftene (rader) | kapittel bare i en kokebok; oppskrift i et kapittel eller rett i en kokebok |
| `recipeEditScope` | linjene og underinndelingene i redigeringen | ingrediens bare blant ingrediensene, steg bare blant stegene, underinndeling bare innen sin seksjon; kassen i foten sletter direkte |

Hva som kan slippes hvor, er typestyrt (`itemType`/`containerAccept`), så et
ulovlig slipp aldri får et mål. En flytting til en kokebok man ikke kan legge
noe i, eller til den virtuelle «Delt med meg»-boken, avvises med en melding.
Et kapittel som flyttes til en annen kokebok tar oppskriftene sine med.

**Kokebokmenyen har ingen egen dra-kode.** Den kjøres av nav-modalens
maskineri: de samme board-ene (`buildNavBoards`), den samme løft-, kollaps- og
ankerkoden, den samme plasseringspolitikken og de samme kassene. En kokebok
dras som et område, et kapittel som en mappekategori og en oppskrift som en
mappe. Det som er eget, er hva et slipp BETYR (`recipesNavCommitBook` og
`recipesNavCommitRow`: posisjon, ekte flytting og avvisning).
Kassen for kapitler og oppskrifter følger boken raden svever over, men bare en
bok raden også kunne landet i (`recipesNavScope.refusesRow`).

**I redigeringen er draget låst til den loddrette aksen** (`strictAxis`): en
linje dras bare opp og ned, og står i ro sidelengs. Håndtaket er nesten like
høyt som feltene og midtstilt på linjen; en underinndeling dras i overskriften. Arket er en `.dnd-surface`, så det som
dras er halvgjennomsiktig i kortform og hullet det kom fra er malt, som på alle
andre dra-flater. Draget svarer bare i sin egen seksjon
(`recipeEditDragBegin`): en linje åpner den tomme hovedsonen i SIN seksjon
(`.is-drag-lines`), aldri i den andre, som uansett ikke tar imot. En løftet
underinndeling foldes sammen til overskriften sin sammen med søsknene i samme
seksjon (`.is-drag-subs`), slik kategorier gjør, og blir liggende under
fingeren; etter slippet foldes alt ut igjen.

## Deling med medlemmer

Kokebøker, kapitler og oppskrifter deles i den vanlige delingsmodalen, med de
samme rollene (eier/medlem), låsene og arven nedover som notatene. Modalen
bruker kokebokordene («Medlemmer av kokeboken», «Har tilgang via kapittelet»).
Se [rettigheter-og-deling.md](rettigheter-og-deling.md) del 14.

## Offentlig lenke

**Offentlige lenker gir utelukkende lesetilgang.** En eier (den som kan styre
medlemmene) kan lage én lenke per kokebok, kapittel eller oppskrift fra
delingsmodalen: `https://huskis.no/oppskrift.html#<nøkkel>`.

**Databasen** (`supabase/users-and-sharing.sql`, seksjon 9f):

- `recipe_links` har RLS uten policy og uten grant — ingen klient når tabellen
  direkte.
- `recipe_link_get/_create/_revoke(p_type, p_id)` krever `can_manage_members`
  og at objektet er en oppskrift. Nøkkelen er 192 tilfeldige bit laget av
  serveren (`gen_random_bytes`), base64url.
- `recipe_public_get(p_token)` er den ENE funksjonen `anon` kan kalle. Den
  returnerer bare navn, titler og oppskriftsdokumenter for det som er delt —
  ingen id-er, ingen personer, ingen pekere oppover i treet. Ukjent, avslått og
  død lenke gir det samme svaret (`null`).

**Livssyklusen** følger objektet, ikke en kopi:

- Lenken viser alltid innholdet slik det er nå.
- Den slutter å virke når den slås av (en ny lenke får en ny nøkkel), når
  objektet ligger i søppelkassen eller arkivet, når det slettes for godt
  (kaskade), og når den som laget den ikke lenger kan styre medlemmene på
  objektet.
- Det siste er VARIG: triggerne på `memberships` (rollen endres eller fjernes)
  og på `note_folders`/`notes` (objektet flyttes) sletter med en gang hver
  lenke hvis oppretter ikke lenger er eier av objektet. Får hen eierskapet
  tilbake, eller flyttes objektet tilbake, er den gamle lenken fortsatt død; en
  ny lenke får en ny nøkkel. Sjekken i `recipe_link_get`/`recipe_public_get`
  står i tillegg.
- Det gjelder også under samtidighet. Alt som kan skape eller drepe en lenke i
  en kokebok — `recipe_link_create` og de tre triggerne — tar den samme
  rådgivende låsen per kokebok (`recipe_links_lock`) FØR det leser
  rettighetene. En opprettelse og en degradering eller flytting som skjer
  samtidig, ser derfor alltid hverandre: enten avvises opprettelsen, eller
  triggeren rydder lenken etter den. Forutsetter READ COMMITTED, som er
  Supabase/PostgREST sin standard.
- En oppskrift som flyttes ut av en delt kokebok/et delt kapittel, følger ikke
  lenken. En som flyttes inn, gjør det.

**Den offentlige siden** (`oppskrift.html` + `recipe-public.js`):

- Nøkkelen står i fragmentet, som aldri sendes til serveren.
- Klienten er laget uten økt (`persistSession: false`), så en innlogget
  Huskis-bruker tar ikke med seg sine rettigheter dit.
- Svaret valideres ved grensen (`sanitizeRecipe`) og tegnes med den samme
  lesevisningen som appen (`renderReader`), porsjonsvelgeren med: leseren
  kan skalere porsjonene lokalt, og valget lagres aldri.
- Toppmenyen er appens glass (gjennomskinnelig, blur) og står fast. Huskis-merket
  står i midten og lenker til appens forside på samme domene (`./`, altså
  huskis.no — siden ligger der, se lenken over). Relativt med vilje: webkoden
  har ingen utgående lenker (`tests/capacitor-android.test.js`, «Eksterne
  lenker»), og det samme gjelder «Meld deg inn nå»;
  Tilbake står til venstre, bare inne i en oppskrift åpnet fra innholdslisten.
- En kokebok eller et kapittel viser en innholdsliste — oppskriftene rett i
  boken først, uten overskrift, så kapitlene (overskriften uten skillelinje,
  med like mye luft over som under); en oppskrift åpnes som
  eget historikksteg, så tilbakeknappen fungerer. Innholdet hentes på nytt når
  fanen blir synlig igjen; den åpne oppskriften finnes igjen på tittelen, og er
  tittelen ikke entydig (svaret har ingen id-er), vises innholdslisten i stedet.
- Den som ikke er logget inn i Huskis i nettleseren, får en invitasjon i en
  fast stripe nederst (samme glass). Siden spør bare om appens øktnøkkel
  FINNES (`sb-<prosjekt>-auth-token`), aldri om innholdet. × lukker den for godt
  i den nettleseren (`hk-pub-invite-closed` i localStorage).
  Teksten står midtstilt i to linjer, som bare brytes når skjermen er for
  smal, og «Meld deg inn nå» står midtstilt under; × står i hjørnet.
- Byttes fragmentet mens en henting pågår, hentes den nye nøkkelen, og svaret
  for den gamle kastes.
- I testmodus (`?mock=1`) og i en preview-deploy peker lenken på adressen
  appen kjører på — mock-databasen finnes bare der, og en preview skal vise
  sin egen kode; i produksjon peker den på det kanoniske domenet
  (`recipePublicUrl`).
- Samme innholdssikkerhetspolicy som appen, ingen inline-kode, og
  `noindex` ([sikkerhetsheadere.md](sikkerhetsheadere.md)).

## Søk

Kokebøker, kapitler og oppskrifter er med i det globale søket, med scopen
«Oppskrifter». Oppskriftens tekst (beskrivelse, ingredienser og steg) gir
tekst-treff etter navnetreffene, som notatenes. Se
[sok-og-navigering.md](sok-og-navigering.md).

## Filene

| Fil | Innhold |
|---|---|
| `recipe-core.js` | dokumentet, mengder, skalering, underinndelinger, `renderReader` — ingen DOM-tilstand; brukes av appen, den offentlige siden og node-testene |
| `app.js`, seksjonen OPPSKRIFTER | fanen, kokebokmenyen, oppskriftsflaten, redigeringen, dra-og-slipp |
| `oppskrift.html`, `recipe-public.js` | den offentlige lesevisningen |
| `supabase/users-and-sharing.sql` | `kind`, `recipe`, `recipe_links` og RPC-ene |

## Tester

- `tests/recipe-core.test.js` — dokumentet, mengdetolking, skalering, «Øvrige»
  (node).
- `tests/recipes.test.js` — fanen, kokebokmenyen, dra-og-slipp (også blokkerte
  slipp), oppløsning, lesevisning, redigering, søk, deling med arv og den
  offentlige lenken (nettleser, desktop + mobil).
- `supabase/tests/test-recipes.sql` — `kind`-vaktene og lenkene: hvem som kan
  lage dem, hva anon får se, og når de dør; og at «Løs opp kapittelet» er alt
  eller ingenting.
- `supabase/tests/test-recipe-race.sh` — det én økt ikke kan bevise, med to
  ekte tilkoblinger: en lenke som skulle vært død, overlever aldri et kappløp
  med en degradering eller flytting (i begge rekkefølger), og en oppløsning
  mot en samtidig låsing blir enten helt gjort eller ikke gjort i det hele
  tatt.
