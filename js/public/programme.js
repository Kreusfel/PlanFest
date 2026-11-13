// Page publique #/public/programme/<editionId> — programme des animations (sans compte).
import { supa } from "../supabase.js";
import { esc } from "../ui/util.js";
import { publicShell } from "./layout.js";

const JOUR_LBL = { ven: "Vendredi", sam: "Samedi", dim: "Dimanche" };

export async function render(app, editionId) {
  app.innerHTML = publicShell("programme", editionId, `<p class="muted">Chargement…</p>`);
  if (!editionId) { app.innerHTML = publicShell("programme", "", `<p>Lien incomplet.</p>`); return; }
  const { data, error } = await supa.rpc("programme_public", { p_edition: editionId });
  if (error) { app.innerHTML = publicShell("programme", editionId, `<p>Programme indisponible pour le moment.</p>`); return; }
  if (!data || !data.length) {
    app.innerHTML = publicShell("programme", editionId, `<p>Le programme n'est pas encore publié. Reviens bientôt !</p>`);
    return;
  }
  const byJour = {};
  data.forEach((p) => { (byJour[p.jour] = byJour[p.jour] || []).push(p); });
  const sections = ["ven", "sam", "dim"].filter((j) => byJour[j]).map((j) => {
    const rows = byJour[j].map((p) => {
      const full = p.places != null && (p.inscrits || 0) >= p.places;
      const reste = p.places != null ? p.places - (p.inscrits || 0) : null;
      const dispo = p.places == null ? "" : (full ? `<span class="tag bad">Complet</span>` : `${reste} place${reste > 1 ? "s" : ""}`);
      return `<tr>
      <td class="h">${esc((p.debut || "").slice(0, 5))}–${esc((p.fin || "").slice(0, 5))}</td>
      <td>${esc(p.jeu || "Animation")}</td>
      <td class="s">${esc(p.salle || "")}${p.numero ? " · n°" + esc(p.numero) : ""}</td>
      <td class="s">${dispo}</td>
    </tr>`;
    }).join("");
    return `<section class="pub-day"><h2>${esc(JOUR_LBL[j] || j)}</h2>
      <table class="pub-table"><tbody>${rows}</tbody></table></section>`;
  }).join("");
  const note = `<p class="pub-note">📍 Les inscriptions aux animations se font <b>sur place, à l'accueil du festival</b> — dans la limite des places disponibles.</p>`;
  app.innerHTML = publicShell("programme", editionId, note + sections);
}
