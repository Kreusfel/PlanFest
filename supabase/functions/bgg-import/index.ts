// Edge Function bgg-import — proxy vers l'API XML publique de BoardGameGeek.
// Actions : { action:"search", query } → résultats enrichis ; { action:"thing", bgg_id } → 1 jeu.
// Déploiement : supabase functions deploy bgg-import
// (L'API BGG v2 ne requiert pas de jeton ; si un jeton devient nécessaire, le garder ICI.)

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
async function fetchText(url: string, tries = 4): Promise<string> {
  for (let i = 0; i < tries; i++) {
    const r = await fetch(url, { headers: { "User-Agent": "PlanFest/1.0 (festival tool)" } });
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
