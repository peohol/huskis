# Sikkerhetsheadere og innholdssikkerhetspolicy

Huskis er en statisk app uten server-side rendering: hele forsvaret mot injisert
kode, innramming og eksfiltrering ligger i responsheaderne og i hvilke
tredjeparter appen i det hele tatt har lov til å snakke med. Filene:
`vercel.json` (headerne i produksjon), `index.html` (den samme policyen som
`<meta>`), `build.js` (fjerner testmodusen fra deployen),
`tests/security-headers.test.js` + `tests/csp-enforced.test.js`.

## Hvorfor policyen står to steder

| Sted | Gjelder | Innhold |
|---|---|---|
| `vercel.json` → `source: "/(.*)"` | produksjon og preview-deployer | hele policyen, inkludert `frame-ancestors` |
| `<meta http-equiv="Content-Security-Policy">` i `index.html` | ALLE miljøer, også `python3 -m http.server` og nettlesertestene | samme policy, uten `frame-ancestors` |

Den lokale serveren sender ingen HTTP-headere. Sto policyen bare i `vercel.json`,
ville den først blitt håndhevet i produksjon — der en feil koster en hvit skjerm
for alle. Meta-taggen gjør at hver eneste nettlesertest kjører under den ekte
policyen. `frame-ancestors` virker kun som header og utelates derfor fra
meta-taggen (den ignoreres der uansett).

De to må være **nøyaktig samme policy**: produksjon får begge, og to policyer
håndheves som snittet av dem, så en utakt gir en strengere policy enn noen har
bestemt. `tests/security-headers.test.js` sammenligner dem direktiv for direktiv.

Meta-taggen står **før den første `<script>`** — ellers ville guarden for
kanonisk origin kjørt utenfor policyen. Kun `<meta charset>` står foran, og den
kjører ikke kode.

## Policyen, direktiv for direktiv

```
default-src 'none';
base-uri 'none';
object-src 'none';
script-src 'self' 'sha256-…';
style-src 'self' https://fonts.googleapis.com;
font-src https://fonts.gstatic.com;
img-src 'self' data: blob:;
connect-src 'self' https://<prosjekt>.supabase.co wss://<prosjekt>.supabase.co;
form-action 'self';
frame-ancestors 'none'          ← kun som HTTP-header
```

`default-src 'none'` er bunnplaten: alt som ikke er nevnt eksplisitt, er
blokkert. Policyen inneholder verken `'unsafe-inline'`, `'unsafe-eval'`,
`'strict-dynamic'` eller `*`.

### De dokumenterte unntakene

Hvert unntak fra `'self'` står her fordi appen faktisk trenger det:

| Unntak | Hvorfor | Hva som skal til for å fjerne det |
|---|---|---|
| `script-src 'sha256-…'` | Guarden for kanonisk origin i `index.html` MÅ kjøre inline, før alt annet — se [`domains-and-urls.md`](domains-and-urls.md). En ekstern fil ville kostet en rundtur før redirecten. | flytte guarden til en egen fil og godta forsinkelsen |
| `style-src https://fonts.googleapis.com` | Stilarket for Atkinson Hyperlegible Next, appens lesevennlige skrift. | selvhoste `@font-face`-erklæringene |
| `font-src https://fonts.gstatic.com` | Selve fontfilene stilarket over peker på. | selvhoste fontfilene |
| `img-src data:` | Avatarbilder lagres som `data:image/jpeg`-URL-er på brukerens profil. | flytte avatarene til Supabase Storage |
| `img-src blob:` | Avatarredigereren tegner den valgte filen via `URL.createObjectURL` i nettlesere uten `createImageBitmap`. | droppe reserveløsningen |
| `connect-src wss://…` | Realtime (`postgres_changes`) går over WebSocket. | — (kreves) |

`connect-src 'self'` dekker oppdateringssjekkens `GET /version.json`
([`auto-update.md`](auto-update.md)). `form-action 'self'` er med fordi
skjemaene i appen (innlogging, navn, e-post, passord) sendes med JavaScript og
`preventDefault()`; en injisert `<form action="https://…">` kommer ingen vei.

### Endrer du guarden

Hash-en i `script-src` er SHA-256 av innholdet i inline-blokken, nøyaktig som den
står — også blanktegnene. Endres guarden uten at hash-en oppdateres, slutter
appen å laste. `tests/security-headers.test.js` regner hash-en ut på nytt fra
`index.html` og sammenligner, så feilen kommer i CI i stedet for i produksjon.
Ny hash:

```bash
node -e 'const f=require("fs"),c=require("crypto");const m=/<script>([\s\S]*?)<\/script>/.exec(f.readFileSync("index.html","utf8"));console.log("sha256-"+c.createHash("sha256").update(m[1],"utf8").digest("base64"))'
```

Verdien skal inn **begge** steder: meta-taggen i `index.html` og
`Content-Security-Policy` i `vercel.json`.

## De øvrige headerne

Alle settes på `source: "/(.*)"`, altså på hver eneste respons.

| Header | Verdi | Hvorfor |
|---|---|---|
| `X-Content-Type-Options` | `nosniff` | nettleseren skal aldri gjette innholdstype — en opplastet fil kan ikke bli til et skript |
| `Referrer-Policy` | `no-referrer` | adressene i appen kan inneholde invitasjons- og auth-parametere; ingenting av det skal følge med til Google Fonts eller en lenke ut |
| `Permissions-Policy` | tom allowlist `()` for kamera, mikrofon, posisjon, betaling, USB, MIDI, sensorer m.m. | appen ber aldri om noen av dem; alt som ikke er nevnt beholder nettleserens standard |
| `X-Frame-Options` | `DENY` | samme vern som `frame-ancestors 'none'`, for nettlesere som ikke kan CSP-en |

Framing er altså umulig: `frame-ancestors 'none'` i CSP-en, med `X-Frame-Options:
DENY` som reserve. Ingen del av Huskis er ment å vises inne i en annen side.

## Supabase-biblioteket: lokal kopi, eksakt versjon

Biblioteket ligger i repoet, ikke på et CDN:

```html
<script src="vendor/supabase-js-2.111.0.js"></script>
```

Filen er en **uendret kopi** av `dist/umd/supabase.js` fra npm-pakken
`@supabase/supabase-js`, og versjonen står i filnavnet. Det gir tre ting på én
gang: `script-src` trenger ingen eksterne kilder (`'self'` og guard-hash-en er
hele direktivet), appen laster like godt om et CDN er nede, og
tredjepartskoden endrer seg bare i en commit her — et flytende `@2` fra et CDN
kunne gitt hver deploy, og hver reload hos brukeren, en annen versjon enn den
som ble testet.

`vercel.json` gir `/vendor/(.*)` langtidscache (`immutable`). Filene der får
ikke `?b=<build-ID>` som resten av JS-en: versjonen står allerede i navnet, så
URL-en endrer seg av seg selv når innholdet gjør det.

`tests/security-headers.test.js` regner ut SHA-384 av den innsjekkede filen og
sammenligner med sjekksummen for den versjonen. En redigert, byttet eller
uregistrert kopi feiler i CI. Testen slår også fast at `script-src` ikke har
noen eksterne kilder, og at `index.html` ikke laster skript fra en fremmed vert.

**Oppgradering** er fire steg:

```bash
V=2.222.0
curl -fsSL "https://registry.npmjs.org/@supabase/supabase-js/-/supabase-js-$V.tgz" -o /tmp/sb.tgz
# Sammenlign med `dist.integrity` fra https://registry.npmjs.org/@supabase/supabase-js/$V
openssl dgst -sha512 -binary /tmp/sb.tgz | base64 -w0
tar xzf /tmp/sb.tgz -O package/dist/umd/supabase.js > "vendor/supabase-js-$V.js"
git rm "vendor/supabase-js-<gammel versjon>.js"
openssl dgst -sha384 -binary "vendor/supabase-js-$V.js" | base64 -w0   # → VENDOR_SHA384
```

1. Hent tarballen fra npm og verifiser den mot `dist.integrity` i
   registeret — kopien skal komme fra kilden, ikke fra en CDN-speiling.
2. Legg `dist/umd/supabase.js` inn som `vendor/supabase-js-<versjon>.js`, uendret,
   og slett den gamle.
3. Pek `<script>`-taggen i `index.html` på den nye filen.
4. Legg den nye sjekksummen inn i `VENDOR_SHA384` i
   `tests/security-headers.test.js` (en versjon som mangler der, feiler).

Kjør deretter `node tests/security-headers.test.js` og
`node tests/csp-enforced.test.js`, og verifiser i en preview-deploy at
`window.supabase.createClient` finnes — en feilstavet sti gir en app som ikke
kommer forbi innloggingsskjermen.

## Testmodus finnes ikke i produksjon

`?mock=1` bytter Supabase-klienten mot `mock-backend.js` — en in-memory-«database»
uten autorisasjon, laget for testing ([`tests/CLAUDE.md`](../tests/CLAUDE.md)).
Den skal ikke kunne nås fra produksjon, og gjør det heller ikke: `build.js`
fjerner den i tre lag.

**Unntaket er preview-deployer.** En preview peker på det samme
Supabase-prosjektet som produksjon, så `?mock=1` er nettopp måten å se en endring
uten å røre ekte data på ([`release-og-deploy.md`](release-og-deploy.md)). Fjernet
vi mock-backenden der, ville `?mock=1` stille falt tilbake til den ekte
databasen — det motsatte av det man ba om. `keepTestMode()` beholder derfor
testmodusen når `VERCEL_ENV === 'preview'`, og bare da. Regelen er **fail
closed**: et lokalt `node build.js`, et CI-bygg og enhver deploy uten variabelen
fjerner testmodusen. Produksjonsdeployen er `VERCEL_ENV=production` og treffer
aldri unntaket.

1. **Filene deployes ikke.** `dev-mock.js` og `mock-backend.js` hoppes over i
   `build.js` og kopieres aldri til `dist/`.
2. **Taggen fjernes.** Blokken i `index.html` er merket
   `<!-- huskis:kun-dev:start -->` … `<!-- huskis:kun-dev:slutt -->`, og hele
   blokken rives ut av `stripDevOnly()`. Finner den ikke markørene, **kaster**
   builden — en stille no-op ville deployet testmodusen uten at noe sa fra.
3. **Klienten feiler lukket.** `useMock()` i `app.js` krever at `window.HK_MOCK`
   FAKTISK er lastet. Uten backenden gjør `?mock=1` ingenting i det hele tatt.

I kildetreet — lokal utvikling og nettlesertestene — er alt uendret: `?mock=1`
laster `dev-mock.js`, som laster `mock-backend.js` før `app.js` starter.

`tests/security-headers.test.js` kjører en ekte build og sjekker at ordet «mock»
ikke forekommer noe sted i `dist/index.html`, og at ingen av de to filene ble
publisert.

## Hva som IKKE dekkes her

Autorisasjon håndheves serverside med RLS og RPC-er
([`rettigheter-og-deling.md`](rettigheter-og-deling.md),
[`arkitektur-brukere-deling.md`](arkitektur-brukere-deling.md)). Headerne her
begrenser hva en nettleser får lov til å laste og sende — de erstatter ikke ett
eneste serverside-vern, og en CSP stopper ikke en angriper som allerede har en
gyldig sesjon.
