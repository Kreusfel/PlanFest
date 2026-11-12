// Client Supabase unique, partagé par toute l'application.
// supabase-js est vendorisé (vendor/supabase-js.js, bundle ESM figé v2.119.0 depuis esm.sh)
// pour fonctionner sur GitHub Pages sans dépendre d'un CDN.
import { createClient } from "../vendor/supabase-js.js";
import { SUPABASE_URL, SUPABASE_ANON } from "../config.js";

export const supa = createClient(SUPABASE_URL, SUPABASE_ANON, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});
