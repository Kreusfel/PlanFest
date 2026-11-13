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

// --- Simulation dev : tester la vue « responsable de pôle » sans toucher la base ---
// Activer (console du navigateur) :  localStorage.setItem('pf_sim_pole','partenaires')
//   puis recharger. Plusieurs pôles : 'partenaires,sponsors'. Désactiver :
//   localStorage.removeItem('pf_sim_pole'). N'affecte QUE l'affichage ; l'écriture
// reste régie par ton vrai rôle (RLS). Codes : partenaires, jeux_editeurs,
// animateurs_benevoles, buvette_catering, communication, sponsors,
// logistique_securite, intergenerationnelle.
export function simPoles() {
  try {
    const v = localStorage.getItem("pf_sim_pole");
    return v ? v.split(",").map((s) => s.trim()).filter(Boolean) : null;
  } catch { return null; }
}
export function isSimulating() { return !!simPoles(); }

async function loadProfil() {
  const { data: p } = await supa
    .from("profils").select("*").eq("id", session.user.id).maybeSingle();
  session.profil = p ?? null;
  const { data: rp } = await supa
    .from("responsables_pole").select("poles(code)").eq("profil_id", session.user.id);
  session.poles = (rp ?? []).map((r) => r.poles?.code).filter(Boolean);
  const sim = simPoles();
  if (sim) session.poles = sim; // override d'affichage pour le test
}

export function isAdmin() { return !simPoles() && session.profil?.role === "admin"; }
export function isActif() { return !!session.profil?.actif; }
export function hasPole(code) { return isAdmin() || session.poles.includes(code); }

export function signIn(email, password) {
  return supa.auth.signInWithPassword({ email, password });
}
export function resetPassword(email) {
  return supa.auth.resetPasswordForEmail(email, {
    redirectTo: retour(),
  });
}
// Adresse de retour des liens envoyés par e-mail (doit figurer dans
// Supabase → Authentication → URL Configuration → Redirect URLs).
const retour = () => location.href.split("#")[0];

// Envoie l'e-mail d'invitation (ou, si le compte existe déjà, un lien pour choisir
// son mot de passe). L'invitation doit déjà exister dans la table invitations.
export async function sendInvitation(email) {
  const { data, error } = await supa.functions.invoke("inviter", { body: { email, redirectTo: retour() } });
  if (error) {
    // Le corps de la réponse porte le message d'erreur de la fonction.
    let m = error.message;
    try { m = (await error.context.json()).error || m; } catch { /* corps illisible */ }
    return { error: { message: m } };
  }
  return { data };
}

export function setPassword(password) {
  return supa.auth.updateUser({ password });
}

export function signOut() { return supa.auth.signOut(); }
export function onAuth(cb) { return supa.auth.onAuthStateChange(cb); }
