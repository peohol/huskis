# Innlogging (mønster-lås)

Les denne når oppgaven berører splash-screen, mønster-lås eller innlogging.

> **Merk (fase 2):** Mønster-låsen er nå **fallback**. Ekte kontoer (e-post +
> passord via Supabase Auth) er implementert og ligger bak et flagg — se
> `docs/accounts.md`. `accountsMode()` i `app.js` velger mellom dem; er den av
> (standard inntil verifisert mot ekte Supabase) gjelder alt under uendret.

3×3-mønster på splash-screen, fasit kun som SHA-256-hash, lås i 5 min etter > 5
feil, husket innlogging (`mine-lister-auth`), synk-koden utledes av mønsteret
(`sha256('sync|' + mønster)`). «Logg ut» ligger i meny-modalen (`logout()` →
tømmer auth/synk-kode og laster på nytt) — se `docs/menus.md`.

Ved verifisering i nettleser: `localStorage['mine-lister-auth']='1'` hopper
over mønster-låsen.
