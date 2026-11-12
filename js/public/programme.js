// Page publique #/public/programme/<editionId> — accessible sans compte.
// Lit la RPC anonyme programme_public (ne renvoie rien si l'édition n'est pas publiée).
import { supa } from "../supabase.js";
import { esc } from "../ui/util.js";

const JOUR_LBL = { ven: "Vendredi", sam: "Samedi", dim: "Dimanche" };

function shell(body) {
  return `<div class="public-wrap">
    <header class="public-head"><div class="brand">PlanFest</div>
      <h1>Programme du festival</h1></header>
    <div class="public-body">${body}</div>
    <footer class="public-foot">Festival du jeu de Fécamp · La Jurande des Conte-Brumes</footer>
  </div>`;
}

export async function render(app, editionId) {
  app.innerHTML = shell(`<p class="muted">Chargement…</p>`);
  if (!editionId) { app.innerHTML = shell(`<p>Lien incomplet.</p>`); return; }
  const { data, error } = await supa.rpc("programme_public", { p_edition: editionId });
  if (error) { app.innerHTML = shell(`<p>Programme indisponible pour le moment.</p>`); return; }
  if (!data || !data.length) {
    app.innerHTML = shell(`<p>Le programme n'est pas encore publié. Reviens bientôt !</p>`);
    return;
  }
  const byJour = {};
  data.forEach((p) => { (byJour[p.jour] = byJour[p.jour] || []).push(p); });
  const sections = ["ven", "sam", "dim"].filter((j) => byJour[j]).map((j) => {
    const rows = byJour[j].map((p) => `<tr>
      <td class="h">${esc((p.debut || "").slice(0, 5))}–${esc((p.fin || "").slice(0, 5))}</td>
      <td>${esc(p.jeu || "Animation")}</td>
      <td class="s">${esc(p.salle || "")}${p.numero ? " · n°" + esc(p.numero) : ""}</td>
      <td class="s">${p.places ? p.places + " pl." : ""}</td>
    </tr>`).join("");
    return `<section class="pub-day"><h2>${esc(JOUR_LBL[j] || j)}</h2>
      <table class="pub-table"><tbody>${rows}</tbody></table></section>`;
  }).join("");
  app.innerHTML = shell(sections);
}
