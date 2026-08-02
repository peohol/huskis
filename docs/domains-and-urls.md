# Domener og URL-generering

Les denne når oppgaven berører produksjonsdomener, Supabase Auth-redirects
(registrering/glemt passord/e-postendring), Resend-e-postenes lenker, eller
det pensjonerte domenet `huskekurv.vercel.app`. Dette er det **autoritative**
stedet for domenekonfigurasjon — andre dokumenter (`docs/accounts.md`,
`docs/arkitektur-brukere-deling.md`, `docs/auto-update.md`) lenker hit i
stedet for å gjenta detaljene.

## Domenene

| Domene | Rolle |
|---|---|
| `https://huskis.no` | **Kanonisk** — alt Huskis selv genererer (auth-redirects, Resend-lenker) bruker denne |
| `https://www.huskis.no` | Gyldig alternativt produksjonsdomen (innkommende trafikk) |
| `https://huskis.vercel.app` | Gyldig alternativt produksjonsdomen (Vercels eget domene for prosjektet) |
| `https://huskekurv.vercel.app` | **Pensjonert.** Appens gamle domene — skal ALDRI genereres av aktiv kode. Se «Det gamle domenet» under. |

Disse tre gyldige domenene er samlet ETT sted i kode:
`window.HUSKIS_CONFIG.allowedProductionOrigins` i `config.js`.

## To separate e-postsystemer

Huskis sender e-post fra to helt uavhengige systemer — ikke bland dem sammen:

1. **Supabase Auth** sender registreringsbekreftelse, tilbakestilling av
   passord og bekreftelse av endret e-postadresse. Avsender/utseende styres
   av Supabase (innebygd mailer eller egen SMTP) + malene i **Supabase
   Dashboard → Authentication → Email Templates** — malene ligger IKKE i
   dette repoet (se «Auth-e-postmalene» under).
2. **Resend** sender Huskis' egne formaterte e-poster (delingsinvitasjoner,
   varsler) fra `noreply@huskis.no`, trigget av `send_invite_email()` i
   `supabase/users-and-sharing.sql` (pg_net → `api.resend.com`). Se
   `docs/arkitektur-brukere-deling.md` og `docs/accounts.md` for
   funksjonaliteten; denne fila dekker kun URL-ene malen bygger inn.

Denne oppgaven migrerer IKKE Auth-e-postene til Resend — de er og blir to
adskilte systemer.

## Hvor auth-returadressen konfigureres

`config.js` setter `window.HUSKIS_CONFIG = { canonicalAppUrl, allowedProductionOrigins }`
— den ENE kilden i frontend som navngir domenene. `app.js` bygger to små,
testbare hjelpefunksjoner over den (nær auth-koden, søk `authRedirectUrl`):

```js
canonicalAppUrl()       // → 'https://huskis.no/' (trailing slash normalisert)
authRedirectUrl(origin) // origin er valgfri og KUN til testing — appen kaller
                         // den alltid uten argument, som da bruker location.origin
```

`authRedirectUrl()` sin regel er bevisst enkel — ingen generell «sanitiser en
vilkårlig URL»-funksjon, kun et eksplisitt valg mellom to betrodde utfall:

- `location.origin` er `http(s)://localhost[:port]` eller `http(s)://127.0.0.1[:port]`
  (lokal utvikling, `python3 -m http.server`) → behold den originen.
- Alt annet — `huskis.no`, `www.huskis.no`, `huskis.vercel.app`, det
  pensjonerte `huskekurv.vercel.app`, eller en hvilken som helst annen/ukjent
  host — → **alltid** `canonicalAppUrl()`.

Det finnes altså ingen «tillatt produksjons-liste» å slippe gjennom: selv
`www.huskis.no` og `huskis.vercel.app` (begge gyldige produksjonsdomener for
INNKOMMENDE trafikk) normaliseres til det kanoniske `huskis.no` i alt Huskis
selv GENERERER. `allowedProductionOrigins` er dokumentasjon/ett sted å teste
mot — ingen kode forgrener på den.

Brukes av de tre Supabase Auth-kallene som tar en returadresse:

| Kall | Sted | Opsjon |
|---|---|---|
| `auth.signUp` | registrering | `options.emailRedirectTo` |
| `auth.resetPasswordForEmail` | glemt passord | `options` (2. argument) → `redirectTo` |
| `auth.updateUser({ email })` | endre e-post (konto-modalen) | `options` (2. argument) → `emailRedirectTo` |

Alle tre sendte tidligere `location.origin + location.pathname` — derfor
kunne en gammel fane, et utdatert domene eller en ukjent host havne direkte i
auth-lenken. `window.__huskis.authRedirectUrl`/`canonicalAppUrl` er eksponert
for nettlesertesting (`tests/auth-redirect.test.js`), som også verifiserer at
alle tre kallene faktisk sender riktig verdi — ikke bare at hjelpefunksjonen
regner riktig i isolasjon.

## Hvor Resend-mailenes base-URL konfigureres

Server-side, i `public.app_config` (Supabase SQL editor — ikke-hemmelig,
RLS-låst uten policyer/grants, kun lesbar for `send_invite_email()`):

```sql
insert into public.app_config(key, value) values
  ('email_from', 'Huskis <noreply@huskis.no>'),
  ('app_url',    'https://huskis.no/')
on conflict (key) do update set value = excluded.value;
```

`send_invite_email()` i `supabase/users-and-sharing.sql` leser `app_url`
derfra (faller tilbake til det hardkodede, kanoniske `https://huskis.no/`
hvis raden mangler — aldri en frontend-verdi, aldri en klientforespørsels
`Host`/`Origin`/`Referer`). Logo-URL-en (`https://huskis.no/assets/email/
huskis-logo.png`) er en konstant i samme funksjon. Se `docs/arkitektur-
brukere-deling.md` for resten av e-postoppsettet (Vault, `email_send_log`,
escaping/prosentkoding).

## Auth-e-postmalene (Supabase Dashboard)

Selve HTML-malene for **Confirm signup** / **Reset password** / **Change
email address** ligger KUN i Supabase Dashboard (Authentication → Email
Templates) — de finnes ikke i dette repoet, og ingen tilgjengelig verktøy
kunne lese eller skrive dem herfra i denne runden. **De er derfor ikke
bekreftet** — sjekk manuelt (Peder):

- [ ] Ingen mal hardkoder `huskekurv.vercel.app` (eller noe annet enn
      `{{ .ConfirmationURL }}`/`{{ .SiteURL }}`) som lenke.
- [ ] Standardlenken i hver mal bruker `{{ .ConfirmationURL }}` — IKKE en
      manuelt sammensatt `{{ .SiteURL }}«/noe»`, som ville overstyrt den
      `redirectTo`/`emailRedirectTo` klienten faktisk sender (se over).
- [ ] **Invite user** og **Magic link** er ikke i bruk (appen kaller verken
      `auth.admin.inviteUserByEmail` eller `auth.signInWithOtp` — bekreftet
      ved søk i `app.js`) — disse malene er irrelevante og kan ignoreres.
- [ ] «Confirm signup» er (denne rundens tillegg) ønsket **stilt likt** de
      formaterte Resend-e-postene. Et ferdig utkast med samme visuelle
      utforming (logo, skifer/grønn-palett, kort-layout, knapp) ligger i
      `supabase/email-templates/confirm-signup.html`, bygget med
      `{{ .ConfirmationURL }}` — **fortsatt sendt av Supabase Auth, ikke
      Resend**. Lim inn i Dashboard → Authentication → Email Templates →
      Confirm signup for å ta den i bruk; ingen tilgjengelig verktøy kunne
      gjøre dette steget herfra.

Site URL + Redirect URLs (Authentication → URL Configuration) er allerede
rettet manuelt til `huskis.no` — ikke rør den konfigurasjonen herfra.

## Lokal utvikling

`python3 -m http.server 8000` → `location.origin` er `http://localhost:8000`,
som `authRedirectUrl()` eksplisitt gjenkjenner og beholder (se regelen over).
Registrerings-/gjenopprettingslenker i en LOKAL Supabase-e-post peker altså
til den lokale serveren, ikke til `huskis.no` — forutsatt at Supabase-
prosjektets Redirect URLs også tillater `http://localhost:8000` (kun
nødvendig hvis man faktisk tester ekte Supabase-e-post lokalt; `?mock=1`
trenger det ikke, se `docs/accounts.md`).

## Det gamle domenet (`huskekurv.vercel.app`)

**Bakgrunn:** Huskis-prosjektet på Vercel het opprinnelig `huskekurv` og ble
senere omdøpt til `huskis`. Et Vercel-prosjekts `<navn>.vercel.app`-alias
følger gjeldende prosjektnavn — det gamle aliaset frigis normalt ved
omdøping, det flyttes ikke automatisk.

**Verifisert i denne runden** (Vercel-API, kontoen `peohols-projects`):

- `huskis`-prosjektets domener er nøyaktig: `huskis.no`, `www.huskis.no`,
  `huskis.vercel.app` + to interne `-peohols-projects.vercel.app`-aliaser.
  `huskekurv.vercel.app` er IKKE blant dem.
- Det finnes ingen Vercel-prosjekt ved navn `huskekurv` i kontoen.
- Hva `huskekurv.vercel.app` faktisk viser i dag er IKKE bekreftet — utgående
  nettverkskall til vilkårlige HTTPS-verter er blokkert i denne kjøreomgivelsen
  (bekreftet ved at selv `https://huskis.no` ga nøyaktig samme proxy-403 —
  altså en miljøbegrensning, ikke et signal om huskekurv-domenets tilstand).

**Klargjort i denne runden:** `vercel.json` har en permanent redirect-regel
(`has: [{ type: "host", value": "huskekurv.vercel.app" }]` →
`https://huskis.no/:path*`) som trer i kraft AUTOMATISK dersom domenet noen
gang kobles til `huskis`-prosjektet — men en redirect-regel i prosjektets
egen `vercel.json` virker KUN for domener som faktisk er koblet til det
prosjektet. Den er ikke tilstrekkelig alene.

**Manuelt steg som gjenstår** (Vercel-tilgang, Peder — ingen tilgjengelig
verktøy i denne runden kunne utføre dette): koble domenet til `huskis`-
prosjektet, f.eks. via CLI:

```bash
vercel domains add huskekurv.vercel.app huskis
```

Hvis kommandoen sier domenet allerede er i bruk et annet sted, sjekk
Vercel-dashbordet (Domains) for hvilket scope/prosjekt som eier det —
`vercel domains move huskekurv.vercel.app <scope>` flytter det mellom egne
scopes. Er det ikke lenger tilgjengelig i det hele tatt (en tredjepart har
krevd det), er redirecten for akkurat den eksakte hosten ikke oppnåelig, og
det bør dokumenteres som sådan fremfor å late som den er løst.

## Testene

- `tests/auth-redirect.test.js` — `authRedirectUrl()`/`canonicalAppUrl()`
  for kjente og ukjente origins (inkl. det gamle domenet som negativt
  testtilfelle), trailing-slash-normalisering, `window.HUSKIS_CONFIG`s
  innhold, og at `signUp`/`resetPasswordForEmail`/`updateUser({ email })`
  faktisk sender den beregnede verdien.
- `supabase/tests/test-email-sharing.sql` — genererte Resend-e-poster
  bruker kanonisk `huskis.no` (ikke `www`) og inneholder aldri det gamle
  domenet.
- `tests/no-legacy-domain.test.js` — repo-vid tekstvakt: feiler dersom
  `huskekurv` dukker opp utenfor en eksplisitt, begrunnet unntaksliste
  (negative tester, denne fila, `TODO.md`, `vercel.json`s redirect-regel).
