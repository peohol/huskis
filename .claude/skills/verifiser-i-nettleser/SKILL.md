---
name: verifiser-i-nettleser
description: Ad-hoc verifisering av en Huskis-endring i ekte nettleser med Playwright — når endringen berører UI, layout, dra-og-slipp, synk eller deling, og det ikke finnes en regresjonstest som allerede dekker den. Dekker oppstart av lokal server, mock-backend, skjermbilder på desktop og mobil, og hva som skal rapporteres.
---

# Verifiser en endring i nettleseren

Dette er den manuelle runden — for endringer der en eksisterende testfil ikke
gir evidensen. Skal endringen ha en varig regresjonstest (bugfikser skal det),
skriv den i `tests/` i stedet, etter konvensjonene i `tests/CLAUDE.md`.

## 1. Start serveren

```bash
python3 -m http.server 8000     # fra repo-roten, i bakgrunnen
```

Appen kjøres uendret fra kildekoden — ingen build før du skal teste selve
byggesteget (`node build.js`).

## 2. Skriv et engangsskript utenfor repoet

Legg skriptet i scratch-mappen for økten, ikke i `tests/` — repoets testmappe er
for varige regresjonstester.

```js
const { chromium } = require('playwright');
const BASE = process.env.HUSKIS_URL || 'http://localhost:8000';

(async () => {
  for (const [navn, vp, mobil] of [
    ['desktop', { width: 1200, height: 900 }, false],
    ['mobil',   { width: 390,  height: 780 }, true],
  ]) {
    const browser = await chromium.launch();
    const ctx = await browser.newContext({ viewport: vp, isMobile: mobil, hasTouch: mobil });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message));

    await page.goto(BASE + '/?mock=1');
    // … logg inn / seed mock-databasen, gjør det endringen gjelder …

    await page.screenshot({ path: `/tmp/huskis-${navn}.png`, fullPage: true });
    console.log(navn, 'JS-feil:', errs);
    await browser.close();
  }
})();
```

Kjøres med `NODE_PATH=$(npm root -g) node <skript>.js`.

Oppsett av innlogging, seeding av `hk-mock-db`/`hk-mock-session` og
`window.__huskis`-krokene er beskrevet i `tests/CLAUDE.md` — les den før du
skriver oppsettet på nytt.

## 3. Velg omfang etter risiko

- Visuell eller interaktiv endring: kjør begge viewportene og se på
  skjermbildene, ikke bare på at skriptet gikk gjennom.
- Ren logikk uten layoutavhengighet: ett viewport holder.
- Deling, roller eller synk: seed to brukere i mock-databasen og bytt sesjon,
  slik at BEGGE sidene av flyten er sett.
- Sjekk alltid at `pageerror`-listen er tom.

## 4. Rapporter

Oppgi hva som faktisk ble kjørt og observert: kommandoen, hvilke viewporter,
hva skjermbildene viste, og om det kom JS-feil. Er noe ikke prøvd, si det
eksplisitt.
