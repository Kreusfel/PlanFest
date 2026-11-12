// Écran #/planning-animation — Phase 2. Parties des tables Jurande animées + alertes.
import { supa } from "../supabase.js";
import { isAdmin, hasPole } from "../auth.js";
import { store } from "../store.js";
import { esc, plur } from "../ui/util.js";

const JOUR_LBL = { ven: "Vendredi", sam: "Samedi", dim: "Dimanche" };
const ALERTE_LBL = {
  sans_animateur: "Sans animateur", sans_competence: "Pas la compétence",
  double_attribution: "Animateur en double", table_chevauchement: "Tables en conflit",
  places: "Trop de places", jeu_hors_categorie: "Hors catégorie",
  exemplaires: "Trop d'exemplaires", indisponible: "Indisponible",
};

let root, parts = [], tables = [], jeux = [], anims = [], alertes = {}, jours = ["sam", "dim"], loadErr = "";
let view = "list", suggestId = null, suggestList = [];

const canWrite = () => isAdmin() || hasPole("animateurs_benevoles");
const tLabel = (id) => { const t = tables.find((x) => x.id === id); return t ? "n°" + (t.numero || "?") : "?"; };

export async function render(container) {
  root = container;
  view = "list";
  if (!store.editionId) {
    root.innerHTML = `<div class="page-head"><div><h1>Planning d'animation</h1><div class="sub">Aucune édition</div></div></div>
      <div class="card"><p><a class="btn primary" href="#/editions">Choisir une édition</a></p></div>`;
    return;
  }
  await load();
  wireOnce();
  draw();
}

async function load() {
  loadErr = "";
  const ed = store.editionId;
  const [els, je, be, ps, al, edi] = await Promise.all([
    supa.from("elements").select("id,numero,type_table,mode,chaises").eq("edition_id", ed).eq("kind", "table"),
    supa.from("jeux_editions").select("id, jeux(titre)").eq("edition_id", ed),
    supa.from("benevoles_editions").select("id, est_animateur, benevoles(nom)").eq("edition_id", ed).neq("statut", "annule"),
    supa.from("parties").select("*, jeux_editions(jeux(titre)), benevoles_editions(benevoles(nom))").eq("edition_id", ed),
    supa.from("alertes_parties").select("*").eq("edition_id", ed),
    supa.from("editions").select("jours_actifs").eq("id", ed).single(),
  ]);
  if (ps.error) loadErr = ps.error.message;
  tables = (els.data ?? []).filter((e) => e.type_table === "jurande" && e.mode === "animee");
  jeux = je.data ?? [];
  anims = (be.data ?? []).sort((a, b) => (b.est_animateur - a.est_animateur) || (a.benevoles?.nom || "").localeCompare(b.benevoles?.nom || "", "fr"));
  parts = ps.data ?? [];
  jours = edi.data?.jours_actifs?.length ? edi.data.jours_actifs : ["sam", "dim"];
  alertes = {};
  (al.data ?? []).forEach((a) => { (alertes[a.partie_id] = alertes[a.partie_id] || []).push(a.code); });
}

function draw() { root.innerHTML = view === "new" ? newView() : listView(); }

/* ---------- liste ---------- */
function partyRow(p) {
  const jeu = p.jeux_editions?.jeux?.titre || p.titre || "—";
  const anim = p.benevole_edition_id ? (p.benevoles_editions?.benevoles?.nom || "?") : "—";
  const al = (alertes[p.id] || []).map((c) => `<span class="pill alert">${esc(ALERTE_LBL[c] || c)}</span>`).join(" ");
  return `<div class="row">
    <div class="row-main">
      <b>${esc(tLabel(p.element_id))} · ${esc((p.debut || "").slice(0, 5))}–${esc((p.fin || "").slice(0, 5))}</b>
      <span class="muted">${esc(jeu)} · ${esc(anim)}${p.places ? " · " + p.places + " pl." : ""}</span>
      ${al ? `<div>${al}</div>` : ""}
    </div>
    <div class="actions">
      ${canWrite() ? `<button class="btn small" data-suggest="${p.id}">Suggérer</button>` : ""}
      ${canWrite() ? `<button class="btn small danger" data-del="${p.id}">Suppr.</button>` : ""}
    </div>
  </div>${suggestId === p.id ? suggestPanel(p) : ""}`;
}
function suggestPanel(p) {
  if (!suggestList.length) return `<div class="suggest"><span class="muted">Aucun animateur compétent et disponible trouvé pour ce créneau.</span></div>`;
  const items = suggestList.map((s) =>
    `<button class="btn small" data-assign="${p.id}:${s.benevole_edition_id}" title="${esc(s.raison || "")}">${esc(s.nom)}${s.competent ? " ✓" : ""}</button>`).join("");
  return `<div class="suggest"><span class="mini">Proposer :</span> ${items}</div>`;
}
function listView() {
  const nbAl = Object.keys(alertes).length;
  const days = jours.map((j) => {
    const list = parts.filter((p) => p.jour === j).sort((a, b) => (a.debut || "").localeCompare(b.debut || ""));
    return `<div class="card"><h2>${esc(JOUR_LBL[j] || j)} <span class="mini">${plur(list.length, "partie", "parties")}</span></h2>
      <div class="list">${list.map(partyRow).join("") || `<p class="muted">Aucune partie.</p>`}</div></div>`;
  }).join("");
  return `<div class="page-head"><div><h1>Planning d'animation</h1>
    <div class="sub">${plur(parts.length, "partie", "parties")}${nbAl ? ` · ${nbAl} avec alerte` : ""}</div></div>
    <div class="head-actions">${canWrite() && tables.length ? `<button class="btn primary" id="new-p">+ Nouvelle partie</button>` : ""}</div></div>
    ${tables.length ? "" : `<div class="card"><p class="muted">Aucune table Jurande animée dans le plan. Crée-en une dans « Plan des salles ».</p></div>`}
    <div class="dash-grid">${days}</div>
    ${loadErr ? `<p class="msg">Erreur : ${esc(loadErr)}</p>` : ""}`;
}

/* ---------- nouvelle partie ---------- */
function newView() {
  const tOpts = tables.map((t) => `<option value="${t.id}">n°${esc(t.numero || "?")}${t.chaises ? ` (${t.chaises} ch.)` : ""}</option>`).join("");
  const jOpts = jours.map((j) => `<option value="${j}">${esc(JOUR_LBL[j] || j)}</option>`).join("");
  const geOpts = `<option value="">— jeu —</option>` + jeux.map((j) => `<option value="${j.id}">${esc(j.jeux?.titre || "?")}</option>`).join("");
  const aOpts = `<option value="">— animateur —</option>` + anims.map((a) => `<option value="${a.id}">${esc(a.benevoles?.nom || "?")}${a.est_animateur ? "" : " (non animateur)"}</option>`).join("");
  return `<div class="page-head"><div><h1>Nouvelle partie</h1><div class="sub">Table Jurande animée</div></div>
    <div class="head-actions"><button class="btn" id="cancel">← Retour</button></div></div>
    <div class="card" style="max-width:620px">
      <div class="row2"><label>Table<select data-p="element_id">${tOpts}</select></label>
        <label>Jour<select data-p="jour">${jOpts}</select></label></div>
      <div class="row2"><label>Début<input type="time" data-p="debut" value="14:00"></label>
        <label>Durée (min)<input type="number" min="15" step="15" data-p="duree_min" value="60"></label></div>
      <label>Jeu<select data-p="jeu_edition_id">${geOpts}</select></label>
      <label>Animateur<select data-p="benevole_edition_id">${aOpts}</select></label>
      <div class="row2"><label>Places<input type="number" min="1" data-p="places"></label>
        <label>Titre (optionnel)<input data-p="titre"></label></div>
      <button class="btn primary" id="p-create">Créer la partie</button>
      <p class="msg" id="p-msg"></p>
    </div>`;
}

/* ---------- câblage ---------- */
function wireOnce() {
  if (root.__animWired) return;
  root.__animWired = true;
  root.addEventListener("click", onClick);
}
async function onClick(e) {
  const t = e.target;
  if (t.closest("#new-p")) { view = "new"; return draw(); }
  if (t.closest("#cancel")) { view = "list"; return draw(); }
  if (t.closest("#p-create")) return create();
  const sug = t.closest("[data-suggest]");
  if (sug) return loadSuggest(sug.dataset.suggest);
  const asg = t.closest("[data-assign]");
  if (asg) return assign(asg.dataset.assign);
  const del = t.closest("[data-del]");
  if (del) return remove(del.dataset.del);
}

async function loadSuggest(id) {
  if (suggestId === id) { suggestId = null; return draw(); } // bascule
  const { data, error } = await supa.rpc("suggestions_animateurs", { p_partie: id });
  suggestList = error ? [] : (data ?? []);
  suggestId = id; draw();
}
async function assign(key) {
  const i = key.indexOf(":"), partieId = key.slice(0, i), beId = key.slice(i + 1);
  const { error } = await supa.from("parties").update({ benevole_edition_id: beId }).eq("id", partieId);
  if (error) { alert("Erreur : " + error.message); return; }
  suggestId = null; await load(); draw();
}

async function create() {
  const msg = root.querySelector("#p-msg");
  const g = (f) => root.querySelector(`[data-p="${f}"]`);
  const element_id = g("element_id").value;
  const duree_min = parseInt(g("duree_min").value, 10);
  if (!element_id || !duree_min) { msg.textContent = "Table et durée requises."; return; }
  msg.textContent = "Création…";
  const row = {
    edition_id: store.editionId, element_id, jour: g("jour").value,
    debut: g("debut").value, duree_min,
    jeu_edition_id: g("jeu_edition_id").value || null,
    benevole_edition_id: g("benevole_edition_id").value || null,
    places: parseInt(g("places").value, 10) || null, titre: g("titre").value || null,
  };
  const { error } = await supa.from("parties").insert(row);
  if (error) { msg.textContent = "Erreur : " + error.message; return; }
  await load(); view = "list"; draw();
}

async function remove(id) {
  if (!confirm("Supprimer cette partie ?")) return;
  const { error } = await supa.from("parties").delete().eq("id", id);
  if (error) { alert("Erreur : " + error.message); return; }
  await load(); draw();
}
