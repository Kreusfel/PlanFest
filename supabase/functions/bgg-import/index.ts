// Edge Function bgg-import — proxy vers l'API XML de BoardGameGeek, réservé aux comptes actifs.
// Actions : { action:"search", query } → résultats enrichis ; { action:"thing", bgg_id } → 1 jeu.
// Déploiement : supabase functions deploy bgg-import
// Jeton d'application BGG : secret Supabase BGG_TOKEN (Edge Functions → Secrets),
// envoyé en « Authorization: Bearer … ». Il reste côté serveur, jamais dans le navigateur.

import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

function decode(s: string): string {
  return (s || "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#039;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));
}
const num = (v: string | null) => (v == null || v === "" ? null : (isNaN(+v) ? null : +v));
function attr(xml: string, tag: string): string | null {
  const m = xml.match(new RegExp(`<${tag}[^>]*\\bvalue="([^"]*)"`));
  return m ? m[1] : null;
}
function tagText(xml: string, tag: string): string | null {
  const m = xml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`));
  return m ? decode(m[1]) : null;
}
function parseItem(itemXml: string) {
  const id = (itemXml.match(/id="(\d+)"/) || [])[1];
  const name = (itemXml.match(/<name[^>]*type="primary"[^>]*value="([^"]*)"/) || [])[1]
    || (itemXml.match(/<name[^>]*value="([^"]*)"/) || [])[1] || "";
  return {
    bgg_id: id ? +id : null,
    titre: decode(name),
    annee: num(attr(itemXml, "yearpublished")),
    joueurs_min: num(attr(itemXml, "minplayers")),
    joueurs_max: num(attr(itemXml, "maxplayers")),
    duree_min: num(attr(itemXml, "playingtime")),
    age_min: num(attr(itemXml, "minage")),
    image_url: tagText(itemXml, "image"),
    miniature_url: tagText(itemXml, "thumbnail"),
  };
}
// BGG renvoie parfois 202 (requête en file) ou 429/503 (débit) : on réessaie avec un backoff.
const BGG_TOKEN = Deno.env.get("BGG_TOKEN");
const bggHeaders: Record<string, string> = { "User-Agent": "PlanFest/1.0 (festival tool)" };
if (BGG_TOKEN) bggHeaders.Authorization = `Bearer ${BGG_TOKEN}`;

async function fetchText(url: string, tries = 4): Promise<string> {
  for (let i = 0; i < tries; i++) {
    const r = await fetch(url, { headers: bggHeaders });
    if (r.status === 401 || r.status === 403) {
      throw new Error(BGG_TOKEN ? "BGG refuse le jeton (BGG_TOKEN invalide ou révoqué)." : "BGG exige un jeton : définir le secret BGG_TOKEN.");
    }
    if (r.status === 200) return await r.text();
    if (r.status === 202 || r.status === 429 || r.status === 503) {
      await new Promise((res) => setTimeout(res, 700 * (i + 1)));
      continue;
    }
    return await r.text(); // autre statut : renvoyer le corps (souvent vide)
  }
  return "";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    // Réservé aux comptes actifs : la clé publique seule ne suffit pas à consommer le jeton BGG.
    const asUser = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    });
    const { data: u } = await asUser.auth.getUser();
    if (!u?.user) return json({ error: "Non connecté." }, 401);
    const { data: actif } = await asUser.rpc("est_actif");
    if (actif !== true) return json({ error: "Compte inactif." }, 403);

    const { action, query, bgg_id } = await req.json();
    if (action === "thing") {
      const xml = await fetchText(`https://boardgamegeek.com/xmlapi2/thing?stats=1&id=${encodeURIComponent(String(bgg_id))}`);
      const item = (xml.match(/<item[\s\S]*?<\/item>/) || [])[0] || "";
      return json(parseItem(item));
    }
    if (!query || !String(query).trim()) return json({ results: [] });
    const sx = await fetchText(`https://boardgamegeek.com/xmlapi2/search?type=boardgame&query=${encodeURIComponent(query)}`);
    const ids = [...sx.matchAll(/<item[^>]*id="(\d+)"/g)].map((m) => m[1]).slice(0, 8);
    if (!ids.length) return json({ results: [] });
    const tx = await fetchText(`https://boardgamegeek.com/xmlapi2/thing?stats=1&id=${ids.join(",")}`);
    const results = [...tx.matchAll(/<item[\s\S]*?<\/item>/g)].map((m) => parseItem(m[0]));
    return json({ results });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
