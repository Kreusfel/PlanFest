// Écran #/presences — Phase 4. Pointage des bénévoles (jour J), gestionnaires.
import { supa } from "../supabase.js";
import { isAdmin, hasPole } from "../auth.js";
import { store } from "../store.js";
import { esc } from "../ui/util.js";

const ETATS = [["attendu", "Attendu", "grey"], ["present", "Présent", "ok"], ["retard", "Retard", "amber"], ["absent", "Absent", "alert"]];
const JOURS = [["ven", "Vendredi"], ["sam", "Samedi"], ["dim", "Dimanche"]];

let root, jours = ["sam", "dim"], jour = "sam", benevoles = [], etats = {};
const gere = () => isAdmin() || hasPole("animateurs_benevoles");

export async function render(container) {
  root = container;
  if (!store.editionId) {
    root.innerHTML = page(`<div class="card"><p><a class="btn primary" href="#/editions">Choisir une édition</a></p></div>`);
    return;
  }
  if (!gere()) { root.innerHTML = page(`<div class="card"><p class="muted">Réservé aux responsables bénévoles et aux admins.</p></div>`); return; }
  const ed = await supa.from("editions").select("jours_actifs").eq("id", store.editionId).single();
  jours = ed.data?.jours_actifs?.length ? ed.data.jours_actifs : ["sam", "dim"];
  if (!jours.includes(jour)) jour = jours[0];
  const be = await supa.from("benevoles_editions").select("id, est_animateur, benevoles(nom)")
    .eq("edition_id", store.editionId).neq("statut", "annule");
  benevoles = (be.data ?? []).filter((x) => x.benevoles).sort((a, b) => a.benevoles.nom.localeCompare(b.benevoles.nom, "fr"));
  wireOnce();
  await loadEtats();
  draw();
}

const page = (body) => `<div class="page-head"><div><h1>Présences</h1>
  <div class="sub">Pointage du jour J</div></div></div>${body}`;

async function loadEtats() {
  etats = {};
  const ids = benevoles.map((b) => b.id);
  if (!ids.length) return;
  const { data } = await supa.from("presences").select("benevole_edition_id,etat").eq("jour", jour).in("benevole_edition_id", ids);
  (data ?? []).forEach((p) => { etats[p.benevole_edition_id] = p.etat; });
}

function draw() {
  const jourBtns = jours.map((j) => `<button class="btn small${j === jour ? " primary" : ""}" data-jour="${j}">${esc((JOURS.find((x) => x[0] === j) || [j, j])[1])}</button>`).join("");
  const counts = {}; ETATS.forEach(([k]) => (counts[k] = 0));
  benevoles.forEach((b) => { counts[etats[b.id] || "attendu"]++; });
  const rows = benevoles.map((b) => {
    const cur = etats[b.id] || "attendu";
    const btns = ETATS.map(([k, lbl, cls]) => `<button class="niv ${cur === k ? "on " + cls : ""}" data-be="${b.id}" data-etat="${k}">${esc(lbl)}</button>`).join("");
    return `<div class="comp-row"><span class="comp-nom">${esc(b.benevoles.nom)}${b.est_animateur ? ' <span class="pill amber">anim.</span>' : ""}</span><div class="niv-grp">${btns}</div></div>`;
  }).join("") || `<p class="muted">Aucun bénévole inscrit.</p>`;
  root.innerHTML = page(`<div class="page-head" style="margin:0 0 12px"><div></div><div class="head-actions">${jourBtns}</div></div>
    <div class="card">
      <div class="kpis">${ETATS.map(([k, lbl, cls]) => `<div class="kpi ${k === "present" ? "ok" : k === "absent" ? "alert" : ""}"><div class="kpi-val">${counts[k]}</div><div class="kpi-lbl">${esc(lbl)}</div></div>`).join("")}</div>
      <div style="margin-top:14px">${rows}</div>
      <p class="msg" id="p-msg"></p>
    </div>`);
}

function wireOnce() {
  if (root.__presWired) return;
  root.__presWired = true;
  root.addEventListener("click", async (e) => {
    const j = e.target.closest("[data-jour]");
    if (j) { jour = j.dataset.jour; await loadEtats(); return draw(); }
    const b = e.target.closest("[data-etat]");
    if (b) return setEtat(b.dataset.be, b.dataset.etat);
  });
}

async function setEtat(benevole_edition_id, etat) {
  const prev = etats[benevole_edition_id];
  etats[benevole_edition_id] = etat; draw();
  const { error } = await supa.from("presences").upsert(
    { benevole_edition_id, jour, etat, signale_le: new Date().toISOString() },
    { onConflict: "benevole_edition_id,jour" });
  if (error) { etats[benevole_edition_id] = prev; draw(); const m = root.querySelector("#p-msg"); if (m) m.textContent = "Erreur : " + error.message; }
}
