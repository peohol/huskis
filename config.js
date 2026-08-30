/* ============================================================
   Konfigurasjon for sky-synk (Supabase).

   url     = Project URL      (Project Settings → API)
   anonKey = "anon public"-nøkkelen (Project Settings → API)

   Begge er trygge å ha i frontend — de er laget for det.
   (service_role-nøkkelen skal ALDRI ligge her.)

   Appen krever innlogging med Supabase Auth (e-post + passord).
   ============================================================ */
window.SUPABASE_CONFIG = {
  url: 'https://bmkynefxgklxzcofflqu.supabase.co',
  anonKey:
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJta3luZWZ4Z2tseHpjb2ZmbHF1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMzMDY1NzUsImV4cCI6MjA5ODg4MjU3NX0.6aKDubEVdP1WNKMvu8MsHAQGgw8BprlBOe6aP5yXn_A',
};

/* Kanonisk produksjonsadresse — DEN ene kilden i frontend for URL-er Huskis
   selv GENERERER (auth-redirects: app.js → authRedirectUrl(), se
   docs/domains-and-urls.md). Aldri location.origin/location.host, som en
   gammel fane, et pensjonert domene eller en ukjent host kan forfalske.

   huskis.no er også det eneste originet appen KJØRER på: www.huskis.no og
   huskis.vercel.app svarer 308 hit (vercel.json + guarden øverst i
   index.html), så det finnes ingen liste over sidestilte produksjonsdomener
   å forgrene på. */
window.HUSKIS_CONFIG = {
  canonicalAppUrl: 'https://huskis.no',

  /* Web Push: den OFFENTLIGE halvdelen av VAPID-nøkkelparet (base64url, P-256).
     Den er ment å ligge her — nettleseren trenger den for å melde seg på, og
     den gir ingen tilgang til noe: den er identiteten senderen SIGNERER seg med
     (RFC 8292), og bare den private halvdelen kan lage en gyldig signatur.
     Den private ligger i Supabase Vault og finnes ingen steder i repoet.

     TOM = kanalen finnes ikke. Uten en avsendernøkkel er det ingen sender å
     melde seg på hos, og «Varsler på denne enheten» melder seg selv som ikke
     støttet i stedet for å love noe som aldri kommer. Nøkkelparet lages én gang
     og legges inn manuelt — stegene står i TODO.md. Android-varsler er upåvirket:
     de er lokale på enheten og trenger ingen nøkkel.
     Autoritativt: docs/varsler.md. */
  pushPublicKey: '',
};
