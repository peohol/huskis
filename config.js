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
