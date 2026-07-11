/* ============================================================
   Konfigurasjon for sky-synk (Supabase).

   url     = Project URL      (Project Settings → API)
   anonKey = "anon public"-nøkkelen (Project Settings → API)

   Begge er trygge å ha i frontend — de er laget for det.
   (service_role-nøkkelen skal ALDRI ligge her.)

   Så lenge verdiene står som plassholderne (DIN_...), kjører
   appen lokalt (localStorage) uten sky-synk.
   ============================================================ */
window.SUPABASE_CONFIG = {
  url: 'https://bmkynefxgklxzcofflqu.supabase.co',
  anonKey:
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJta3luZWZ4Z2tseHpjb2ZmbHF1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMzMDY1NzUsImV4cCI6MjA5ODg4MjU3NX0.6aKDubEVdP1WNKMvu8MsHAQGgw8BprlBOe6aP5yXn_A',

  // Fase 2 — brukerkontoer og deling (e-post + passord i stedet for mønster-lås).
  // Sett `accounts: true` for å slå det PÅ i produksjon. Krever først de manuelle
  // Supabase-dashboard-stegene i TODO.md (Auth → URL Configuration: Site URL +
  // Redirect URLs; «Confirm email» på). Kan også slås på per økt med ?accounts=1.
  // Til da kjører den gamle mønster-låsen. (?mock=1 kjører kontomodus mot en
  // hermetisk in-memory-backend for testing.)
  accounts: true,
};
