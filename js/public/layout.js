// Coque commune des pages publiques (sans compte) : en-tête + onglets.
import { supa } from "../supabase.js";
import { esc } from "../ui/util.js";

const TABS = [["programme", "Programme"], ["plan", "Plan des salles"], ["infos", "Infos & exposants"]];

export function publicShell(active, editionId, body) {
  const tabs = editionId ? TABS.map(([k, l]) =>
    `<a class="pubtab${k === active ? " on" : ""}" href="#/public/${k}/${editionId}">${esc(l)}</a>`).join("") : "";
  return `<div class="public-wrap">
    <header class="public-head">
      <div class="brand">PlanFest</div>
      <h1>Festival du jeu de Fécamp</h1>
      <div class="public-sub">La Jurande des Conte-Brumes</div>
      <nav class="pubtabs">${tabs}</nav>
    </header>
    <div class="public-body">${body}</div>
    <footer class="public-foot">Programme et informations fournis par l'organisation.</footer>
  </div>`;
}

// Résout l'édition publiée (pour #/public sans identifiant).
export async function editionPubliee() {
  const { data } = await supa.rpc("edition_publiee");
  return data || null;
}
