// Connexion et profil courant. Les droits réels sont appliqués par la base (RLS) ;
// ces helpers servent seulement à adapter l'affichage.
import { supa } from "./supabase.js";

export const session = { user: null, profil: null, poles: [] };

export async function refreshSession() {
  const { data } = await supa.auth.getSession();
  session.user = data.session?.user ?? null;
  if (session.user) {
    await loadProfil();
  } else {
    session.profil = null;
    session.poles = [];
  }
}

async function loadProfil() {
  const { data: p } = await supa
    .from("profils").select("*").eq("id", session.user.id).maybeSingle();
  session.profil = p ?? null;
  const { data: rp } = await supa
    .from("responsables_pole").select("poles(code)").eq("profil_id", session.user.id);
  session.poles = (rp ?? []).map((r) => r.poles?.code).filter(Boolean);
}

export function isAdmin() { return session.profil?.role === "admin"; }
export function isActif() { return !!session.profil?.actif; }
export function hasPole(code) { return isAdmin() || session.poles.includes(code); }

export function signIn(email, password) {
  return supa.auth.signInWithPassword({ email, password });
}
export function signUp(email, password) {
  return supa.auth.signUp({ email, password });
}
export function resetPassword(email) {
  return supa.auth.resetPasswordForEmail(email, {
    redirectTo: location.href.split("#")[0],
  });
}
export function signOut() { return supa.auth.signOut(); }
export function onAuth(cb) { return supa.auth.onAuthStateChange(cb); }
