// Edge Function gameupc — proxy vers l'API gameupc.com (code-barre UPC d'un jeu → numéro
// BoardGameGeek), réservé aux comptes actifs. Actions :
//   { action:"lookup", upc }         → { status, searched_for, suggestions:[{bgg_id,name}] }
//   { action:"vote", upc, bgg_id }   → { status, suggestions } (renvoie le choix de l'utilisateur
//                                       à gameupc : ~2 votes concordants valident un code → jeu.
//                                       Crowdsourcing demandé par gameupc pour les codes mal/non
//                                       reconnus — endpoint /upc/{upc}/bgg_id/{bgg_id})
// Clé d'API : secret Supabase GAMEUPC_KEY (Edge Functions → Secrets). SANS secret, on tombe en
// mode TEST (endpoint /test/ + clé de démo) : seuls les UPC de test de gameupc répondent. Dès que
// la vraie clé est posée en secret, on passe en prod sans toucher au code. La clé reste côté
// serveur, jamais dans le navigateur. Déploiement : supabase functions deploy gameupc

import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

// Choix de l'endpoint, du plus sûr au plus engageant :
//   - pas de clé            → /test + clé de démo (seuls les UPC de test répondent) ;
//   - clé + GAMEUPC_MODE≠prod→ /test + VRAIE clé (valider le dev sans toucher aux données de
//                              prod ni polluer le crowdsourcing — recommandé par gameupc) ;
//   - clé + GAMEUPC_MODE=prod→ /v1 + vraie clé (données de production).
// La bascule en prod est donc un geste explicite : poser la clé seule ne suffit pas.
const KEY = Deno.env.get("GAMEUPC_KEY");
const PROD = !!KEY && Deno.env.get("GAMEUPC_MODE") === "prod";
const BASE = PROD ? "https://api.gameupc.com/v1" : "https://api.gameupc.com/test";
const apiHeaders: Record<string, string> = { "x-api-key": KEY || "test_test_test_test_test" };

// gameupc renvoie une liste bgg_info ; on n'en garde que l'essentiel pour le navigateur.
function suggestions(data: any) {
  return (data?.bgg_info ?? [])
    .filter((x: any) => x && x.id)
    .map((x: any) => ({ bgg_id: +x.id, name: x.name ?? "" }));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    // Réservé aux comptes actifs : la clé publique seule ne suffit pas à consommer l'API.
    const asUser = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    });
    const { data: u } = await asUser.auth.getUser();
    if (!u?.user) return json({ error: "Non connecté." }, 401);
    const { data: actif } = await asUser.rpc("est_actif");
    if (actif !== true) return json({ error: "Compte inactif." }, 403);

    const { action, upc, bgg_id } = await req.json();

    if (action === "lookup") {
      const code = String(upc ?? "").replace(/\D/g, "");
      if (code.length < 6) return json({ error: "Code-barre trop court." }, 400);
      const r = await fetch(`${BASE}/upc/${encodeURIComponent(code)}`, { headers: apiHeaders });
      if (!r.ok) return json({ error: `gameupc indisponible (${r.status}).` }, 502);
      const data = await r.json();
      return json({
        status: data?.bgg_info_status ?? null,
        searched_for: data?.searched_for ?? null,
        suggestions: suggestions(data),
      });
    }

    if (action === "vote") {
      // On construit l'URL nous-mêmes à partir de (upc, bgg_id) validés en chiffres : pas de
      // destination arbitraire fournie par le client (anti-SSRF), et endpoint canonique gameupc.
      const code = String(upc ?? "").replace(/\D/g, "");
      const bid = String(bgg_id ?? "").replace(/\D/g, "");
      if (code.length < 6 || !bid) return json({ error: "Vote invalide." }, 400);
      // Identifiant stable et anonyme (prévention du bruit côté gameupc) = l'utilisateur connecté.
      const r = await fetch(`${BASE}/upc/${code}/bgg_id/${bid}`, {
        method: "POST",
        headers: { ...apiHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: `planfest-${u.user.id}` }),
      });
      if (!r.ok) return json({ error: `vote refusé (${r.status}).` }, 502);
      const data = await r.json().catch(() => ({}));
      return json({ status: data?.bgg_info_status ?? null, suggestions: suggestions(data) });
    }

    return json({ error: "Action inconnue." }, 400);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
