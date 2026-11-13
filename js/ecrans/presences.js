// Écran #/presences — Phase 4. Pointage des bénévoles (jour J), gestionnaires.
// Résilient hors-ligne : chaque pointage part d'abord dans une file IndexedDB, puis
// est envoyé dès que le réseau répond (réessai régulier). La liste des bénévoles est
// gardée en local pour pouvoir rouvrir l'écran sans réseau.
import { supa } from "../supabase.js";
import { isAdmin, hasPole } from "../auth.js";
import { store } from "../store.js";
import { esc } from "../ui/util.js";
import { presencesQueue as Q } from "../offline/idb.js";

const ETATS = [["attendu", "Attendu", "grey"], ["present", "Présent", "ok"], ["retard", "Retard", "amber"], ["absent", "Absent", "alert"]];
const JOURS = [["ven", "Vendredi"], ["sam", "Samedi"], ["dim", "Dimanche"]];

let root, jours = ["sam", "dim"], jour = "sam", benevoles = [], etats = {}, attente = 0, retry = null;
const cacheKey = () => "pf_presences_" + store.editionId;
const gere = () => isAdmin() || hasPole("animateurs_benevoles");

export async function render(container) {
  root = container;
  if (!store.editionId) {
    root.innerHTML = page(`<div class="card"><p><a class="btn primary" href="#/editions">Choisir une édition</a></p></div>`);
    return;
  }
  if (!gere()) { root.innerHTML = page(`<div class="card"><p class="muted">Réservé aux responsables bénévoles et aux admins.</p></div>`); return; }
  const [ed, be] = await Promise.all([
    supa.from("editions").select("jours_actifs").eq("id", store.editionId).single(),
    supa.from("benevoles_editions").select("id, est_animateur, benevoles(nom)")
      .eq("edition_id", store.editionId).neq("statut", "annule"),
  ]);
  if (!ed.error && !be.error) {
    jours = ed.data?.jours_actifs?.length ? ed.data.jours_actifs : ["sam", "dim"];
    benevoles = (be.data ?? []).filter((x) => x.benevoles).sort((a, b) => a.benevoles.nom.localeCompare(b.benevoles.nom, "fr"));
    try { localStorage.setItem(cacheKey(), JSON.stringify({ jours, benevoles })); } catch { /* stockage plein ou bloqué */ }
  } else {
    // Hors ligne : dernière liste connue sur cet appareil.
    try { ({ jours, benevoles } = JSON.parse(localStorage.getItem(cacheKey())) || { jours, benevoles: [] }); } catch { benevoles = []; }
  }
  if (!jours.includes(jour)) jour = jours[0];
  wireOnce();
  window.addEventListener("online", flush);
  retry = setInterval(flush, 20000);  // wifi « connecté » sans Internet : on réessaie
  await loadEtats();
  draw();
  flush();
}

export function unmount() {
  window.removeEventListener("online", flush);
  clearInterval(retry); retry = null;
}

const page = (body) => `<div class="page-head"><div><h1>Présences</h1>
  <div class="sub">Pointage du jour J</div></div></div>${body}`;

async function loadEtats() {
  etats = {};
  const ids = benevoles.map((b) => b.id);
  if (!ids.length) return;
  const { data } = await supa.from("presences").select("benevole_edition_id,etat").eq("jour", jour).in("benevole_edition_id", ids);
  (data ?? []).forEach((p) => { etats[p.benevole_edition_id] = p.etat; });
  // Les pointages pas encore envoyés priment sur le serveur.
  const q = await Q.all().catch(() => []);
  q.filter((p) => p.jour === jour && ids.includes(p.benevole_edition_id)).forEach((p) => { etats[p.benevole_edition_id] = p.etat; });
  attente = q.length;
}

function draw() {
  const jourBtns = jours.map((j) => `<button class="btn small${j === jour ? " primary" : ""}" data-jour="${j}">${esc((JOURS.find((x) => x[0] === j) || [j, j])[1])}</button>`).join("");
  const counts = {}; ETATS.forEach(([k]) => (counts[k] = 0));
  benevoles.forEach((b) => { counts[etats[b.id] || "attendu"]++; });
  const rows = benevoles.map((b) => {
    const cur = etats[b.id] || "attendu";
    const btns = ETATS.map(([k, lbl, cls]) => `<button class="niv ${cur === k ? "on " + cls : ""}" aria-pressed="${cur === k}" data-be="${b.id}" data-etat="${k}">${esc(lbl)}</button>`).join("");
    return `<div class="comp-row"><span class="comp-nom">${esc(b.benevoles.nom)}${b.est_animateur ? ' <span class="pill amber">anim.</span>' : ""}</span><div class="niv-grp">${btns}</div></div>`;
  }).join("") || `<p class="muted">Aucun bénévole inscrit.</p>`;
  root.innerHTML = page(`<div class="page-head" style="margin:0 0 12px"><div></div><div class="head-actions">${jourBtns}</div></div>
    <div class="card">
      <div class="kpis">${ETATS.map(([k, lbl, cls]) => `<div class="kpi ${k === "present" ? "ok" : k === "absent" ? "alert" : ""}"><div class="kpi-val">${counts[k]}</div><div class="kpi-lbl">${esc(lbl)}</div></div>`).join("")}</div>
      ${attente ? `<p class="sync-warn">⚠ ${attente} pointage${attente > 1 ? "s" : ""} pas encore envoyé${attente > 1 ? "s" : ""} — conservé${attente > 1 ? "s" : ""} sur cet appareil, envoi automatique dès que le réseau revient.</p>` : ""}
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
  etats[benevole_edition_id] = etat;
  // D'abord sur l'appareil (jamais perdu), ensuite vers le serveur.
  await Q.add({ key: benevole_edition_id + "|" + jour, benevole_edition_id, jour, etat, signale_le: new Date().toISOString() });
  attente = (await Q.all()).length;
  draw();
  flush();
}

let flushing = false;
async function flush() {
  if (flushing) return;
  flushing = true;
  try {
    const q = await Q.all();
    let refus = null;
    for (const p of q) {
      const { error } = await supa.from("presences").upsert(
        { benevole_edition_id: p.benevole_edition_id, jour: p.jour, etat: p.etat, signale_le: p.signale_le },
        { onConflict: "benevole_edition_id,jour" });
      if (!error) { await Q.del(p.key); continue; }
      // Erreur réseau : on garde tout pour le prochain essai. Refus du serveur
      // (droits, bénévole supprimé…) : on abandonne ce pointage et on le signale.
      if (/fetch|network|Failed|Load failed/i.test(error.message)) break;
      await Q.del(p.key); refus = error.message;
    }
    const left = (await Q.all()).length;
    if (left !== attente || refus) {
      attente = left;
      if (root?.isConnected) {
        draw();
        if (refus) { const m = root.querySelector("#p-msg"); if (m) m.textContent = "Pointage refusé par le serveur : " + refus; }
      }
    }
  } catch { /* IndexedDB indisponible : rien à faire ici */ } finally { flushing = false; }
}
