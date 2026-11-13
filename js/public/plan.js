// Page publique #/public/plan/<editionId> — plan des salles en lecture seule.
import { supa } from "../supabase.js";
import { esc } from "../ui/util.js";
import { publicShell } from "./layout.js";
import { salleSVG } from "../plan/svg-lecture.js";

let appEl, editionId, plan = null, salleIdx = 0;

export async function render(app, edId) {
  appEl = app; editionId = edId; salleIdx = 0; plan = null;
  app.innerHTML = publicShell("plan", editionId, `<p class="muted">Chargement…</p>`);
  if (!editionId) { body(`<p>Lien incomplet.</p>`); return; }
  // Schéma auto du plan (salles + tables).
  const { data, error } = await supa.rpc("plan_public", { p_edition: editionId });
  if (error || !data) { body(`<p>Le plan n'est pas encore publié.</p>`); return; }
  plan = data;
  draw();
}

function body(html) { appEl.innerHTML = publicShell("plan", editionId, html); wire(); }

function draw() {
  const salles = plan.salles || [];
  if (!salles.length) { body(`<p>Aucune salle à afficher.</p>`); return; }
  if (salleIdx >= salles.length) salleIdx = 0;
  const salle = salles[salleIdx];
  const els = (plan.elements || []).filter((e) => e.salle_id === salle.id);
  const tabs = salles.length > 1
    ? `<div class="salle-tabs">${salles.map((s, i) => `<button class="pill-btn${i === salleIdx ? " on" : ""}" data-salle="${i}">${esc(s.nom)}</button>`).join("")}</div>`
    : "";
  const legend = `<div class="legend pub-legend">
    <span><i style="background:#DBEAFE;border:1px solid #94A3B8"></i>Partenaire / boutique</span>
    <span><i style="background:#FEF3C7;border:1px solid #D4A72C"></i>Animation (jeux)</span>
    <span><i style="background:#E4E4E7;border:1px solid #6B6B73"></i>Repère (accueil, buvette…)</span></div>`;
  body(`${tabs}<div class="card pub-plan">${salleSVG(salle, els)}</div>${legend}`);
}

function wire() {
  appEl.querySelectorAll("[data-salle]").forEach((b) => (b.onclick = () => { salleIdx = +b.dataset.salle; draw(); }));
}
