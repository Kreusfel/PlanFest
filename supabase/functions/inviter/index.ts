// Edge Function inviter — envoie l'e-mail d'invitation PlanFest.
// Appel : supa.functions.invoke("inviter", { body: { email, redirectTo } })
// Préalable : la ligne public.invitations doit exister (créée par l'app, sous RLS).
//  - Personne sans compte  → auth.admin.inviteUserByEmail : e-mail « Vous êtes invité »,
//    le compte est créé et activé par le trigger creer_profil.
//  - Compte déjà créé      → e-mail de réinitialisation : la personne (re)choisit son
//    mot de passe. Sert de « Renvoyer le lien ».
// Droits (mêmes règles que la RLS d'invitations) : admin, ou responsable du pôle
// animateurs_benevoles pour une invitation de rôle « membre ».
// Déploiement : supabase functions deploy inviter
// La clé service_role est fournie par Supabase à la fonction ; elle ne quitte jamais le serveur.
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const URL_ = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

// Même effet que le trigger creer_profil (migrations 001/005) pour un profil déjà existant.
// deno-lint-ignore no-explicit-any
async function appliquerInvitation(admin: any, email: string): Promise<string | null> {
  const { data: inv } = await admin.from("invitations").select("*").ilike("email", email).maybeSingle();
  const { data: p } = await admin.from("profils").select("id").ilike("email", email).maybeSingle();
  if (!inv || !p) return "Compte existant introuvable dans profils.";
  const steps = [
    admin.from("profils").update({ actif: true, role: inv.role }).eq("id", p.id),
    inv.pole_ids?.length
      ? admin.from("responsables_pole").upsert(inv.pole_ids.map((pole_id: string) => ({ profil_id: p.id, pole_id })))
      : null,
    inv.benevole_id ? admin.from("benevoles").update({ profil_id: p.id }).eq("id", inv.benevole_id) : null,
    admin.from("invitations").update({ utilisee_le: new Date().toISOString() }).eq("id", inv.id),
  ].filter(Boolean);
  for (const r of await Promise.all(steps)) if (r.error) return r.error.message;
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    if (!SERVICE) return json({ error: "Clé service_role absente de la fonction." }, 500);
    const authHeader = req.headers.get("Authorization") ?? "";
    const { email: rawEmail, redirectTo } = await req.json();
    const email = String(rawEmail || "").trim().toLowerCase();
    if (!email) return json({ error: "E-mail requis." }, 400);

    // 1. Qui appelle ? (client au nom de l'utilisateur : auth.uid() = l'appelant)
    const asUser = createClient(URL_, ANON, { global: { headers: { Authorization: authHeader } } });
    const { data: u } = await asUser.auth.getUser();
    if (!u?.user) return json({ error: "Non connecté." }, 401);
    const [adm, resp] = await Promise.all([
      asUser.rpc("est_admin"),
      asUser.rpc("est_responsable", { p_code: "animateurs_benevoles" }),
    ]);
    const isAdmin = adm.data === true, isResp = resp.data === true;
    if (!isAdmin && !isResp) return json({ error: "Droits insuffisants pour inviter." }, 403);

    // 2. L'invitation doit exister (et être de rôle membre pour un responsable)
    const admin = createClient(URL_, SERVICE, { auth: { persistSession: false } });
    const { data: inv, error: invErr } = await admin
      .from("invitations").select("email, role, utilisee_le").ilike("email", email).maybeSingle();
    if (invErr) return json({ error: invErr.message }, 500);
    if (!inv) return json({ error: "Aucune invitation pour cette adresse." }, 404);
    if (!isAdmin && inv.role !== "membre") return json({ error: "Seul un admin peut inviter un admin." }, 403);

    // 3. Envoi
    const opts = redirectTo ? { redirectTo: String(redirectTo) } : {};
    if (!inv.utilisee_le) {
      const { error } = await admin.auth.admin.inviteUserByEmail(email, opts);
      if (!error) return json({ ok: true, envoi: "invitation" });
      // Compte déjà existant (créé avant l'invitation) : on bascule sur le lien de mot de passe.
      if (!/already|registered|exists/i.test(error.message)) return json({ error: error.message }, 400);
      // Le trigger creer_profil n'a pas joué (compte antérieur) : appliquer l'invitation ici.
      const err = await appliquerInvitation(admin, email);
      if (err) return json({ error: err }, 500);
    }
    const { error } = await asUser.auth.resetPasswordForEmail(email, opts);
    if (error) return json({ error: error.message }, 400);
    return json({ ok: true, envoi: "mot_de_passe" });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
