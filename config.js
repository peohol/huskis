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
  canonicalAppUrl: 'https://huskis-git-claude-ota-rigg-vc3-peohols-projects.vercel.app',
};
