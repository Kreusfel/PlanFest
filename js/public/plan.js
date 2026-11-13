// Page publique #/public/plan/<editionId> — plan des salles en lecture seule.
import { supa } from "../supabase.js";
import { esc } from "../ui/util.js";
import { publicShell } from "./layout.js";

const CELL = 24, M = 16;
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

function tableStyle(e) {
  if (e.kind === "bloc") return { fill: "#E4E4E7", stroke: "#6B6B73", dash: "" };
  if (e.type_table === "partenaire") return { fill: e.couleur || "#DBEAFE", stroke: "#94A3B8", dash: "" };
  if (e.type_table === "jurande") return e.mode === "libre"
    ? { fill: "#FFFFFF", stroke: "#111111", dash: ' stroke-dasharray="4 3"' }
    : { fill: "#FEF3C7", stroke: "#D4A72C", dash: "" };
  return { fill: "#FFFFFF", stroke: "#991B1B", dash: ' stroke-dasharray="4 3"' };
}

function salleSVG(salle, els) {
  const W = salle.cols * CELL, H = salle.rows * CELL;
  let g = `<rect width="${W}" height="${H}" fill="#fff"/>`;
  for (let i = 0; i <= salle.cols; i++) g += `<line x1="${i * CELL}" y1="0" x2="${i * CELL}" y2="${H}" stroke="#F1F1F3"/>`;
  for (let j = 0; j <= salle.rows; j++) g += `<line x1="0" y1="${j * CELL}" x2="${W}" y2="${j * CELL}" stroke="#F1F1F3"/>`;
  g += `<rect width="${W}" height="${H}" fill="none" stroke="#111" stroke-width="1.5"/>`;
  els.forEach((e) => {
    const px = e.x * CELL, py = e.y * CELL, w = e.w * CELL, h = e.h * CELL, s = tableStyle(e);
    g += `<rect x="${px + 1}" y="${py + 1}" width="${w - 2}" height="${h - 2}" rx="3" fill="${s.fill}" stroke="${s.stroke}" stroke-width="1.3"${s.dash}/>`;
    const label = e.kind === "bloc" ? (e.label || e.sous || "") : (e.nom || e.numero || "");
    const sub = e.kind === "table" && e.nom && e.numero ? `n°${e.numero}` : "";
    const cx = px + w / 2;
    g += `<text x="${cx}" y="${py + h / 2 + (sub ? -1 : 4)}" text-anchor="middle" font-size="11" font-weight="600" fill="#111">${esc(trunc(label, Math.max(4, Math.floor(w / 7))))}</text>`;
    if (sub) g += `<text x="${cx}" y="${py + h / 2 + 11}" text-anchor="middle" font-size="9" fill="#52525B">${esc(sub)}</text>`;
  });
  if (salle.ici_x != null && salle.ici_y != null) {
    const ix = salle.ici_x * CELL, iy = salle.ici_y * CELL;
    g += `<g transform="translate(${ix},${iy})">
      <circle r="9" fill="#DC2626" stroke="#fff" stroke-width="2"/><circle r="3" fill="#fff"/>
      <text x="0" y="-13" text-anchor="middle" font-size="11" font-weight="700" fill="#DC2626" stroke="#fff" stroke-width="3" paint-order="stroke">Vous êtes ici</text></g>`;
  }
  return `<svg viewBox="0 0 ${W + 2 * M} ${H + 2 * M}" width="100%" style="max-width:${W + 2 * M}px;height:auto;display:block">
    <g transform="translate(${M},${M})">${g}</g></svg>`;
}
function trunc(s, n) { s = String(s || ""); return s.length > n ? s.slice(0, n - 1) + "…" : s; }

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
