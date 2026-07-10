# Innlogging (mønster-lås)

Les denne når oppgaven berører splash-screen, mønster-lås eller innlogging.

3×3-mønster på splash-screen, fasit kun som SHA-256-hash, lås i 5 min etter > 5
feil, husket innlogging (`mine-lister-auth`), synk-koden utledes av mønsteret
(`sha256('sync|' + mønster)`). «Logg ut» ligger i meny-modalen (`logout()` →
tømmer auth/synk-kode og laster på nytt) — se `docs/menus.md`.

Ved verifisering i nettleser: `localStorage['mine-lister-auth']='1'` hopper
over mønster-låsen.
