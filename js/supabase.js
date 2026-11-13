// Client Supabase unique, partagé par toute l'application.
// supabase-js est vendorisé (vendor/supabase-js.js, bundle ESM figé v2.119.0 depuis esm.sh)
// pour fonctionner sur GitHub Pages sans dépendre d'un CDN.
import { createClient } from "../vendor/supabase-js.js";
import { SUPABASE_URL, SUPABASE_ANON } from "../config.js";

// Lien reçu par e-mail (invitation, mot de passe oublié) : Supabase renvoie ici avec
// #access_token=…&type=invite|recovery, ou #error=…&error_description=… .
// On le lit AVANT createClient, qui consomme puis efface ce fragment.
const h = new URLSearchParams(location.hash.slice(1));
export const lienEmail = {
  type: h.get("access_token") ? h.get("type") : null,   // "invite" | "recovery" | "signup" | …
  erreur: h.get("error_description") || null,
};

export const supa = createClient(SUPABASE_URL, SUPABASE_ANON, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});
