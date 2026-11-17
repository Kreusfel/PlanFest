// Edge Function gameupc — proxy vers l'API gameupc.com (code-barre UPC d'un jeu → numéro
// BoardGameGeek), réservé aux comptes actifs. Actions :
//   { action:"lookup", upc }        → { status, searched_for, suggestions:[{bgg_id,name,update_url}] }
//   { action:"vote",   update_url } → { status, suggestions } (renvoie le choix de l'utilisateur
//                                      à gameupc : ~2 votes concordants valident un code → jeu)
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

// Mode prod si la clé réelle est fournie en secret, sinon mode test (clé de démo publique).
const KEY = Deno.env.get("GAMEUPC_KEY");
const BASE = KEY ? "https://api.gameupc.com" : "https://api.gameupc.com/test";
const apiHeaders: Record<string, string> = { "x-api-key": KEY || "test_test_test_test_test" };

// gameupc renvoie une liste bgg_info ; on n'en garde que l'essentiel pour le navigateur.
function suggestions(data: any) {
  return (data?.bgg_info ?? [])
    .filter((x: any) => x && x.id)
    .map((x: any) => ({ bgg_id: +x.id, name: x.name ?? "", update_url: x.update_url ?? null }));
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

    const { action, upc, update_url } = await req.json();

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
      // On ne POST que vers gameupc.com en https (l'update_url vient d'une réponse lookup
      // précédente, relayée par le client) : garde-fou anti-SSRF.
      let ok = false;
      try {
        const u2 = new URL(String(update_url));
        ok = u2.protocol === "https:" && /(^|\.)gameupc\.com$/i.test(u2.hostname);
      } catch { /* url invalide */ }
      if (!ok) return json({ error: "URL de vote invalide." }, 400);
      // Identifiant stable et anonyme (prévention du bruit côté gameupc) = l'utilisateur connecté.
      const r = await fetch(String(update_url), {
        method: "POST",
        headers: { ...apiHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: `planfest-${u.user.id}` }),
      });
      if (!r.ok) return json({ error: `vote refusé (${r.status}).` }, 502);
      const data = await r.json();
      return json({ status: data?.bgg_info_status ?? null, suggestions: suggestions(data) });
    }

    return json({ error: "Action inconnue." }, 400);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
