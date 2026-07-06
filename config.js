/* ============================================================
   Konfigurasjon for sky-synk (Supabase).

   Fyll inn de to verdiene fra Supabase-prosjektet ditt:
   Project Settings → API
     • url     = "Project URL"      (f.eks. https://abcd1234.supabase.co)
     • anonKey = "anon public"-nøkkelen (en lang tekststreng)

   Begge er trygge å ha i frontend — de er laget for det.
   (service_role-nøkkelen skal ALDRI ligge her.)

   Så lenge verdiene står som plassholderne under, kjører appen
   helt fint lokalt (localStorage) uten sky-synk.
   ============================================================ */
window.SUPABASE_CONFIG = {
  url: 'DIN_SUPABASE_URL_HER',
  anonKey: 'DIN_ANON_NØKKEL_HER',
};
