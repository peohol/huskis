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
  url: 'https://kdrsapafvmyjhzyqkrbc.supabase.co',
  anonKey:
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtkcnNhcGFmdm15amh6eXFrcmJjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMzMDE3NzQsImV4cCI6MjA5ODg3Nzc3NH0.Uu2--tsBvDVqeYm0rsabxAWOoDabzgwf9wx9TELNkgs',
};
