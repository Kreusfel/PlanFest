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
// Éditeurs du jeu (liens « boardgamepublisher ») : l'éditeur d'origine d'abord, puis les
// éditions étrangères. Les mentions génériques de BGG sont écartées.
function editeurs(itemXml: string): string[] {
  const noms = [...itemXml.matchAll(/<link[^>]*type="boardgamepublisher"[^>]*value="([^"]*)"/g)]
    .map((m) => decode(m[1]).trim())
    .filter((n) => n && !/^\((uncredited|web published|self-published)\)$/i.test(n));
  return [...new Set(noms)].slice(0, 20);
}
// Comparaison de titres : minuscules, sans accents ni ponctuation (« Root » = « root »).
const comparable = (t: string) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
// Version « mots » (espaces gardés) pour repérer le mot entier : « root » dans « Root: Underworld ».
const motsSimples = (t: string) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const echapper = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
    editeurs: editeurs(itemXml),
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
    // BGG renvoie tous les jeux dont le nom CONTIENT la recherche, dans un ordre peu utile
    // (« Root » noyé parmi les « … Roots … »). On classe : titre exact, puis « commence par »,
    // puis mot entier, puis le reste ; les extensions après les jeux de base ; à rang égal,
    // les plus populaires (nombre de notes BGG) d'abord.
    const sx = await fetchText(`https://boardgamegeek.com/xmlapi2/search?type=boardgame&query=${encodeURIComponent(query)}`);
    const cible = comparable(String(query));
    const candidats = [...sx.matchAll(/<item[^>]*type="([^"]*)"[^>]*id="(\d+)"[^>]*>([\s\S]*?)<\/item>/g)].map((m) => {
      const nom = decode((m[3].match(/<name[^>]*value="([^"]*)"/) || [])[1] || "");
      const c = comparable(nom);
      const rang = c === cible ? 0 : c.startsWith(cible) ? 1 : new RegExp(`(^|[^a-z0-9])${echapper(motsSimples(String(query)))}([^a-z0-9]|$)`).test(motsSimples(nom)) ? 2 : 3;
      return { id: m[2], rang: rang * 2 + (m[1] === "boardgame" ? 0 : 1) };
    });
    // Un même jeu peut apparaître deux fois (nom principal + nom alternatif) : garder le meilleur rang.
    const parId = new Map();
    candidats.forEach((x) => { const cur = parId.get(x.id); if (!cur || x.rang < cur.rang) parId.set(x.id, x); });
    const tries = [...parId.values()].sort((a, b) => a.rang - b.rang).slice(0, 20);
    if (!tries.length) return json({ results: [] });
    const rangDe = new Map(tries.map((x) => [x.id, x.rang]));
    const tx = await fetchText(`https://boardgamegeek.com/xmlapi2/thing?stats=1&id=${tries.map((x) => x.id).join(",")}`);
    const results = [...tx.matchAll(/<item[\s\S]*?<\/item>/g)].map((m) => ({
        ...parseItem(m[0]), _notes: num(attr(m[0], "usersrated")) || 0,
      }))
      .sort((a, b) => (rangDe.get(String(a.bgg_id)) ?? 9) - (rangDe.get(String(b.bgg_id)) ?? 9) || b._notes - a._notes)
      .slice(0, 10)
      .map(({ _notes, ...r }) => r);
    return json({ results });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
