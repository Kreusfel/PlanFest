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

// Bandeau « infos pratiques » : dates des jours du festival, horaires, lieu.
// `ed` = résultat de la RPC edition_public.
const JOUR_DECALAGE = { ven: -1, sam: 0, dim: 1 };
export function infosPratiques(ed) {
  if (!ed || !ed.date_samedi) return "";
  const jours = (ed.jours_actifs?.length ? ed.jours_actifs : ["sam", "dim"]);
  const horaire = (j) => (ed.horaires || []).find((h) => h.jour === j);
  const lignes = ["ven", "sam", "dim"].filter((j) => jours.includes(j)).map((j) => {
    const d = new Date(ed.date_samedi + "T12:00:00"); d.setDate(d.getDate() + JOUR_DECALAGE[j]);
    const date = d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
    const h = horaire(j);
    return `<li><b>${esc(date.charAt(0).toUpperCase() + date.slice(1))}</b>${h ? ` · ${esc(h.debut)}–${esc(h.fin)}` : ""}</li>`;
  }).join("");
  return `<section class="card pub-infos"><ul class="pub-infos-dates">${lignes}</ul>
    ${ed.lieu ? `<p class="pub-infos-lieu">📍 ${esc(ed.lieu)}</p>` : ""}</section>`;
}

// Résout l'édition publiée (pour #/public sans identifiant).
export async function editionPubliee() {
  const { data } = await supa.rpc("edition_publiee");
  return data || null;
}
