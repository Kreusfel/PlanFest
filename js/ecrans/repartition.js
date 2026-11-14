// Écran #/repartition — le pôle Partenaires répartit les partenaires sur les
// tables partenaires posées par la logistique. Chaque table partenaire reçoit
// (ou non) un partenaire. Écriture via RPC attribuer_table_partenaire.
import { supa } from "../supabase.js";
import { store } from "../store.js";
import { esc, toast } from "../ui/util.js";
import { exportEtiquettes } from "../export/etiquettes.js";
import { exportFiches, CONSIGNES } from "../export/fiches.js";
import { exportBadges } from "../export/badges.js";
import { isAdmin, hasPole } from "../auth.js";

let root, salles = [], tables = [], partenaires = [], consignes = "";
const gere = () => isAdmin() || hasPole("partenaires");
const salleNom = (id) => salles.find((s) => s.id === id)?.nom || "";
const partNom = (id) => partenaires.find((p) => p.id === id)?.nom || "?";

export async function render(container) {
  root = container;
  if (!store.editionId) { root.innerHTML = `<div class="card"><p><a class="btn primary" href="#/editions">Choisir une édition</a></p></div>`; return; }
  root.innerHTML = `<div class="card"><p class="muted">Chargement…</p></div>`;
  const [s, el, oe, ed] = await Promise.all([
    supa.from("salles").select("id,nom").eq("edition_id", store.editionId).order("cree_le"),
    supa.from("elements").select("id,numero,salle_id,organisme_edition_id").eq("edition_id", store.editionId).eq("kind", "table").eq("type_table", "partenaire"),
    supa.from("organisme_editions").select("id,statut,tables_souhaitees,organismes(nom)").eq("edition_id", store.editionId).contains("roles", ["partenaire"]),
    supa.from("editions").select("consignes_exposants").eq("id", store.editionId).single(),
  ]);
  consignes = ed.data?.consignes_exposants || "";
  salles = s.data || [];
  tables = (el.data || []).sort((a, b) => (parseInt(a.numero, 10) || 0) - (parseInt(b.numero, 10) || 0));
  partenaires = (oe.data || []).map((o) => ({ id: o.id, nom: o.organismes?.nom || "?", statut: o.statut, souhait: o.tables_souhaitees || 0 }))
    .sort((a, b) => a.nom.localeCompare(b.nom, "fr"));
  draw();
}

function partSelect(table) {
  const opts = `<option value="">— libre —</option>` + partenaires.map((p) =>
    `<option value="${p.id}"${p.id === table.organisme_edition_id ? " selected" : ""}>${esc(p.nom)}${p.statut !== "confirme" ? " (à confirmer)" : ""}</option>`).join("");
  return `<select data-tbl="${table.id}"${gere() ? "" : " disabled"} style="min-width:200px;margin:0">${opts}</select>`;
}

function draw() {
  const attrib = tables.filter((t) => t.organisme_edition_id).length;
  const placedCount = new Map();
  tables.forEach((t) => { if (t.organisme_edition_id) placedCount.set(t.organisme_edition_id, (placedCount.get(t.organisme_edition_id) || 0) + 1); });
  const countFor = (id) => placedCount.get(id) || 0;
  // Partenaires incomplets : moins de tables placées que souhaitées (0/Y inclus).
  const aPlacer = partenaires.map((p) => ({ ...p, placed: countFor(p.id) }))
    .filter((p) => p.placed < p.souhait)
    .sort((a, b) => (a.placed === 0 ? 0 : 1) - (b.placed === 0 ? 0 : 1) || a.nom.localeCompare(b.nom, "fr"));
  const sansSouhait = partenaires.filter((p) => p.souhait === 0 && countFor(p.id) === 0);
  const sansTable = partenaires.filter((p) => countFor(p.id) === 0);

  const kpis = `<div class="grid g4">
    <div class="kpi"><span class="v">${tables.length}</span>Tables partenaires</div>
    <div class="kpi"><span class="v">${attrib}</span>Attribuées</div>
    <div class="kpi"><span class="v" style="${tables.length - attrib ? "color:#B45309" : ""}">${tables.length - attrib}</span>Libres</div>
    <div class="kpi"><span class="v" style="${sansTable.length ? "color:#991B1B" : ""}">${sansTable.length}</span>Partenaires sans table</div></div>`;

  const bySalle = salles.map((s) => {
    const ts = tables.filter((t) => t.salle_id === s.id);
    if (!ts.length) return "";
    return `<div class="card"><div class="ihead"><h3>${esc(s.nom)}</h3><span class="muted">${ts.length} table${ts.length > 1 ? "s" : ""}</span></div>
      <div class="scroll"><table class="data-table"><thead><tr><th>Table</th><th>Partenaire</th></tr></thead>
      <tbody>${ts.map((t) => `<tr><td><b>n°${esc(t.numero ?? "?")}</b></td><td>${partSelect(t)}</td></tr>`).join("")}</tbody></table></div></div>`;
  }).join("");

  const aPlacerCard = aPlacer.length
    ? `<div class="card"><div class="ihead"><h3>Partenaires à compléter</h3><span class="muted">${aPlacer.length}</span></div>
       <div class="scroll"><table class="data-table"><thead><tr><th>Partenaire</th><th style="text-align:right">Tables</th></tr></thead>
       <tbody>${aPlacer.map((p) => `<tr>
         <td>${esc(p.nom)}${p.statut !== "confirme" ? ` <span class="muted">(à confirmer)</span>` : ""}</td>
         <td style="text-align:right"><span class="tag ${p.placed === 0 ? "bad" : "warn"}">${p.placed}/${p.souhait} table${p.souhait > 1 ? "s" : ""}</span></td></tr>`).join("")}</tbody></table></div>
       ${sansSouhait.length ? `<p class="mini">${sansSouhait.length} partenaire(s) sans nombre de tables renseigné (à compléter sur leur fiche).</p>` : ""}</div>`
    : `<div class="card"><p class="muted">Tous les partenaires ont le nombre de tables souhaité. 🎉${sansSouhait.length ? ` <span class="mini">(${sansSouhait.length} sans nombre renseigné)</span>` : ""}</p></div>`;

  root.innerHTML = `<div class="page-head"><div><h1>Répartition des tables</h1>
      <div class="sub">Attribue les partenaires aux tables posées par la logistique</div></div>
      <div class="head-actions">
        <button class="btn small" id="exp-etiquettes">Étiquettes de table (PDF)</button>
        <button class="btn small" id="exp-fiches">Fiches d'accueil (PDF)</button>
        <button class="btn small" id="exp-badges">Badges exposants (PDF)</button></div></div>
    ${kpis}
    ${aPlacerCard}
    ${tables.length
      ? bySalle
      : `<div class="card"><p class="muted">Aucune table de type « Partenaire » dans le plan. La logistique doit d'abord en poser (page Plan des salles).</p></div>`}
    <div class="card"><details class="pub-editor"><summary>Consignes des fiches d'accueil</summary>
      <label>Une consigne par ligne (imprimées sur chaque fiche)
        <textarea id="consignes" rows="5"${gere() ? "" : " disabled"} placeholder="${esc(CONSIGNES.join("\n"))}">${esc(consignes)}</textarea></label>
      <p class="mini">Laisser vide pour garder les consignes par défaut (affichées en gris).</p>
      ${gere() ? `<button class="btn primary" id="consignes-save">Enregistrer</button>` : ""}
    </details></div>
    <p class="msg" id="r-msg" aria-live="polite"></p>`;
  wire();
}

function wire() {
  const pdf = (id, fn) => { const b = root.querySelector(id); if (b) b.onclick = async () => {
    b.disabled = true;
    try {
      const { data } = await supa.from("editions").select("nom").eq("id", store.editionId).single();
      await fn(store.editionId, data?.nom || "");
    } catch (e) { toast("Erreur export : " + (e.message || e)); }
    b.disabled = false;
  }; };
  pdf("#exp-etiquettes", exportEtiquettes);
  pdf("#exp-fiches", exportFiches);
  pdf("#exp-badges", exportBadges);
  const cs = root.querySelector("#consignes-save");
  if (cs) cs.onclick = async () => {
    const texte = root.querySelector("#consignes").value || "";
    const { error } = await supa.rpc("maj_consignes_exposants", { p_edition: store.editionId, p_texte: texte });
    if (error) { toast("Erreur : " + error.message); return; }
    consignes = texte.trim();
    toast("Consignes enregistrées.", "ok");
  };
  root.querySelectorAll("[data-tbl]").forEach((sel) => (sel.onchange = () => assign(sel.dataset.tbl, sel.value || null)));
}

async function assign(elementId, orgEdId) {
  const m = root.querySelector("#r-msg"); if (m) m.textContent = "…";
  const { error } = await supa.rpc("attribuer_table_partenaire", { p_element: elementId, p_organisme_edition: orgEdId });
  if (error) { if (m) m.textContent = "Erreur : " + error.message; return; }
  const t = tables.find((x) => x.id === elementId); if (t) t.organisme_edition_id = orgEdId;
  if (m) m.textContent = orgEdId ? `Table attribuée à ${partNom(orgEdId)}.` : "Table libérée.";
  draw();
}
