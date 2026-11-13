// Écran #/subventions — Phase 1. Dossiers de subvention (admin, responsable sponsors).
import { supa } from "../supabase.js";
import { isAdmin, hasPole } from "../auth.js";
import { store } from "../store.js";
import { esc, plur } from "../ui/util.js";

const STATUTS = [["a_faire", "À faire"], ["depose", "Déposé"], ["accorde", "Accordé"], ["refuse", "Refusé"]];

let root, list = [], loadErr = "";
let filt = { statut: "" };
let view = { mode: "list", id: null };

const stLabel = (k) => (STATUTS.find((s) => s[0] === k) || [k, k])[1];
const canWrite = () => isAdmin() || hasPole("sponsors");

// Jours restants avant échéance (null si pas d'échéance)
function joursAvant(d) {
  if (!d) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return Math.round((new Date(d + "T00:00:00") - today) / 86400000);
}

export async function render(container) {
  root = container;
  view = { mode: "list", id: null };
  if (!store.editionId) {
    root.innerHTML = `<div class="page-head"><div><h1>Subventions</h1><div class="sub">Aucune édition sélectionnée</div></div></div>
      <div class="card"><p><a class="btn primary" href="#/editions">Choisir une édition</a></p></div>`;
    return;
  }
  await load();
  wireOnce();
  go();
}

async function load() {
  loadErr = "";
  const { data, error } = await supa.from("subventions").select("*")
    .eq("edition_id", store.editionId).order("echeance", { nullsFirst: false });
  if (error) { loadErr = error.message; list = []; } else list = data ?? [];
}

function go() {
  root.innerHTML = view.mode === "fiche" ? ficheView() : view.mode === "new" ? newView() : listView();
}

/* ---------- liste ---------- */
function listView() {
  const TAG = { a_faire: "warn", depose: "warn", accorde: "ok", refuse: "neu" };
  const rows = list.filter((s) => !filt.statut || s.statut === filt.statut).map((s) => {
    const dj = joursAvant(s.echeance);
    const soon = dj !== null && dj >= 0 && dj <= 30 && !["accorde", "refuse"].includes(s.statut);
    const ech = s.echeance ? `${esc(s.echeance)}${soon ? ` <span class="tag bad">J-${dj}</span>` : ""}` : "—";
    return `<tr class="clk" data-open="${s.id}">
      <td><strong>${esc(s.financeur)}</strong></td>
      <td><span class="tag ${TAG[s.statut] || "neu"}">${esc(stLabel(s.statut))}</span></td>
      <td class="muted">${ech}</td>
    </tr>`;
  }).join("") || `<tr><td colspan="3" class="muted">${loadErr ? "Erreur : " + esc(loadErr) : "Aucun dossier."}</td></tr>`;

  const sOpts = `<option value="">Tous statuts</option>` + STATUTS.map((s) => `<option value="${s[0]}"${filt.statut === s[0] ? " selected" : ""}>${s[1]}</option>`).join("");
  const soon = list.filter((s) => { const d = joursAvant(s.echeance); return d !== null && d >= 0 && d <= 30 && !["accorde", "refuse"].includes(s.statut); }).length;

  return `<div class="page-head"><div><h1>Subventions</h1>
    <div class="sub">${plur(list.length, "dossier", "dossiers")}${soon ? ` · ${plur(soon, "échéance", "échéances")} sous 30 j` : ""}</div></div>
    <div class="head-actions">${canWrite() ? `<button class="btn primary" id="new-sub">+ Nouveau dossier</button>` : ""}</div></div>
    <div class="card">
      <div class="filters"><select id="f-statut">${sOpts}</select></div>
      <div class="scroll"><table class="data-table">
        <thead><tr><th>Financeur</th><th>Statut</th><th>Échéance</th></tr></thead>
        <tbody>${rows}</tbody></table></div>
    </div>`;
}

/* ---------- formulaire ---------- */
function field(l, inner) { return `<label>${l}${inner}</label>`; }
function form(s, ro) {
  return `${field("Financeur", `<input data-f="financeur" value="${esc(s.financeur || "")}"${ro}>`)}
    <div class="row2">
      ${field("Échéance", `<input type="date" data-f="echeance" value="${esc(s.echeance || "")}"${ro}>`)}
      ${field("Statut", `<select data-f="statut"${ro}>${STATUTS.map((o) => `<option value="${o[0]}"${o[0] === s.statut ? " selected" : ""}>${o[1]}</option>`).join("")}</select>`)}
    </div>
    ${field("Lien vers les pièces", `<input data-f="lien_pieces" value="${esc(s.lien_pieces || "")}" placeholder="https://…"${ro}>`)}
    ${field("Notes", `<textarea data-f="notes"${ro}>${esc(s.notes || "")}</textarea>`)}`;
}
function newView() {
  return `<div class="page-head"><div><h1>Nouveau dossier</h1><div class="sub">Édition courante</div></div>
    <div class="head-actions"><button class="btn" id="cancel">← Retour</button></div></div>
    <div class="card" style="max-width:560px">${form({ statut: "a_faire" }, "")}
      <button class="btn primary" id="s-create">Créer</button><p class="msg" id="s-msg"></p></div>`;
}
function ficheView() {
  const s = list.find((x) => x.id === view.id);
  if (!s) { view.mode = "list"; return listView(); }
  const w = canWrite(), ro = w ? "" : " disabled";
  return `<div class="page-head"><div><h1>${esc(s.financeur)}</h1><div class="sub">Dossier de subvention</div></div>
    <div class="head-actions"><button class="btn" id="back">← Liste</button>
      ${w ? `<button class="btn danger" id="del">Supprimer</button><button class="btn primary" id="save">Enregistrer</button>` : ""}</div></div>
    <div class="card" style="max-width:560px">${form(s, ro)}<p class="msg" id="s-msg"></p></div>`;
}

/* ---------- câblage ---------- */
function wireOnce() {
  if (root.__subWired) return;
  root.__subWired = true;
  root.addEventListener("click", onClick);
  root.addEventListener("change", onChange);
}
function onClick(e) {
  const t = e.target;
  if (t.closest("#new-sub")) { view = { mode: "new", id: null }; return go(); }
  if (t.closest("#cancel") || t.closest("#back")) { view = { mode: "list", id: null }; return go(); }
  if (t.closest("#s-create")) return create();
  if (t.closest("#save")) return save();
  if (t.closest("#del")) return remove();
  const r = t.closest("[data-open]");
  if (r) { view = { mode: "fiche", id: r.dataset.open }; return go(); }
}
function onChange(e) {
  const t = e.target;
  if (t.id === "f-statut" && t.closest(".filters")) { filt.statut = t.value; return go(); }
}
function readForm() {
  const g = (f) => root.querySelector(`[data-f="${f}"]`);
  return { financeur: (g("financeur").value || "").trim(), echeance: g("echeance").value || null,
    statut: g("statut").value, lien_pieces: g("lien_pieces").value || null, notes: g("notes").value || null };
}
async function create() {
  const msg = root.querySelector("#s-msg"), v = readForm();
  if (!v.financeur) { msg.textContent = "Financeur requis."; return; }
  msg.textContent = "Création…";
  const { data, error } = await supa.from("subventions").insert({ ...v, edition_id: store.editionId }).select().single();
  if (error) { msg.textContent = "Erreur : " + error.message; return; }
  list.push(data); view = { mode: "list", id: null }; go();
}
async function save() {
  const s = list.find((x) => x.id === view.id); if (!s) return;
  const msg = root.querySelector("#s-msg"), v = readForm();
  if (!v.financeur) { msg.textContent = "Financeur requis."; return; }
  msg.textContent = "Enregistrement…";
  const { error } = await supa.from("subventions").update(v).eq("id", s.id);
  if (error) { msg.textContent = "Erreur : " + error.message; return; }
  Object.assign(s, v); view = { mode: "list", id: null }; go();
}
async function remove() {
  const s = list.find((x) => x.id === view.id); if (!s) return;
  if (!confirm("Supprimer ce dossier ?")) return;
  const { error } = await supa.from("subventions").delete().eq("id", s.id);
  if (error) { alert("Erreur : " + error.message); return; }
  list = list.filter((x) => x.id !== s.id); view = { mode: "list", id: null }; go();
}
