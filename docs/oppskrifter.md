# Oppskrifter

Oppskrifter er Huskis' tredje hoveddel, ved siden av Lister og Notater. Dette
dokumentet er **autoritativt** for oppskriftenes struktur, oppskriftsdokumentet,
porsjonsskaleringen, redigeringen og den offentlige lenken. Rettighetene er de
samme som for notatene og står i [rettigheter-og-deling.md](rettigheter-og-deling.md)
del 14; dra-og-slipp-motoren i [drag-and-drop.md](drag-and-drop.md).

## Hierarkiet

**Kokebok › Kapittel › Oppskrift.** En oppskrift ligger enten i et kapittel
eller rett i kokeboken («Uten kapittel»). Kapitler er ett nivå; det finnes ingen
underkapitler.

Alle tre nivåene kan opprettes, gis nytt navn, slettes (til søppelkassen, med
angre), sorteres, flyttes og deles. Et kapittel kan i tillegg **løses opp**:
kapittelet forsvinner, og oppskriftene i det blir liggende rett i kokeboken, i
samme rekkefølge. Ingen oppskrift slettes av det.

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
underinndeling:

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
  der man står. Oppskriftene vises som notatkortene.
- **Kokebokmenyen** er navigasjonsmodalens mønster: hver kokebok er et farget
  kort (kan foldes sammen), kapitlene er kategoriene i en liste, og
  oppskriftene er radene. «Uten kapittel» står først, med de frie oppskriftene
  under seg. Grønn ＋ nederst i kortet lager en oppskrift rett i boken, gul ＋
  et kapittel, og ＋ i kapittelet en oppskrift der.
- **Oppskriftsflaten** er notat-editorens fullskjermsbilde. Den åpner i
  **lesemodus**: beskrivelse, porsjonsvelger, ingredienser som punktliste og
  fremgangsmåten nummerert på nytt i hver underinndeling — uten
  redigeringskontroller. «Rediger» i verktøylinjen (bare med skriverett) bytter
  til redigeringsmodus; tilbake/Escape går først ut av redigeringen, så ut av
  flaten.

### Redigeringsmodusen

- Tittel, beskrivelse og antall porsjoner står øverst.
- Ingredienser har tre felt: mengde, enhet og navn. Skrives «2 dl melk» i
  navnefeltet mens de to andre er tomme, deles det opp.
- Grønn ＋ under en seksjon lager en linje på hovednivå (regel 1/3 over), grønn
  ＋ i en underinndeling en linje der, og gul ＋ en ny underinndeling.
- Enter lager neste linje; Backspace i en tom linje fjerner den.
- En underinndeling kan gis navn, løses opp (linjene blir) eller slettes (med
  angre).
- Alt lagres fortløpende (debounce 400 ms, og alltid ved lukking/`pagehide`).

## Dra-og-slipp

Tre dnd-kit-board gjennom Smett, med den delte limkoden
([drag-and-drop.md](drag-and-drop.md)):

| Scope | Hva | Regel |
|---|---|---|
| `recipesScope` | oppskriftskortene på flaten | omrokkering |
| `recipesNavScope` | kokebøkene (kort) + kapitlene og oppskriftene (rader) | kapittel bare i en kokebok; oppskrift i et kapittel eller rett i en kokebok |
| `recipeEditScope` | linjene og underinndelingene i redigeringen | ingrediens bare blant ingrediensene, steg bare blant stegene, underinndeling bare innen sin seksjon |

Hva som kan slippes hvor, er typestyrt (`itemType`/`containerAccept`), så et
ulovlig slipp aldri får et mål. En flytting til en kokebok man ikke kan legge
noe i, eller til den virtuelle «Delt med meg»-boken, avvises med en melding.
Et kapittel som flyttes til en annen kokebok tar oppskriftene sine med.

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
- En oppskrift som flyttes ut av en delt kokebok/et delt kapittel, følger ikke
  lenken. En som flyttes inn, gjør det.

**Den offentlige siden** (`oppskrift.html` + `recipe-public.js`):

- Nøkkelen står i fragmentet, som aldri sendes til serveren.
- Klienten er laget uten økt (`persistSession: false`), så en innlogget
  Huskis-bruker tar ikke med seg sine rettigheter dit.
- Svaret valideres ved grensen (`sanitizeRecipe`) og tegnes med den samme
  lesevisningen som appen (`renderReader`). Porsjonene kan skaleres lokalt.
- En kokebok eller et kapittel viser en innholdsliste; en oppskrift åpnes som
  eget historikksteg, så tilbakeknappen fungerer. Innholdet hentes på nytt når
  fanen blir synlig igjen.
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
  lage dem, hva anon får se, og når de dør.
