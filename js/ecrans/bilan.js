// Écran #/bilan — Phase 5. Compteurs de l'édition, export CSV, purge RGPD. Admin.
import { supa } from "../supabase.js";
import { store } from "../store.js";
import { esc } from "../ui/util.js";

const JOUR_LBL = { ven: "Vendredi", sam: "Samedi", dim: "Dimanche" };
let root, data = null, edNom = "";

export async function render(container) {
  root = container;
  if (!store.editionId) {
    root.innerHTML = page(`<div class="card"><p><a class="btn primary" href="#/editions">Choisir une édition</a></p></div>`);
    return;
  }
  root.innerHTML = page(`<div class="card"><p class="muted">Chargement…</p></div>`);
  const [b, ed] = await Promise.all([
    supa.rpc("bilan", { p_edition: store.editionId }),
    supa.from("editions").select("nom").eq("id", store.editionId).single(),
  ]);
  if (b.error) { root.innerHTML = page(`<div class="card"><p class="msg">${b.error.message.includes("acces") ? "Réservé aux admins." : "Erreur : " + esc(b.error.message)}</p></div>`); return; }
  data = b.data || {}; edNom = ed.data?.nom || "";
  wireOnce();
  draw();
}

const page = (body) => `<div class="page-head"><div><h1>Bilan</h1>
  <div class="sub">Chiffres de l'édition</div></div>
  <div class="head-actions"><button class="btn" id="csv">Export CSV (entrées)</button></div></div>${body}`;

function kpiCard(titre, obj, map) {
  const tiles = Object.entries(map).map(([k, lbl]) => `<div class="kpi"><div class="kpi-val">${esc(String(obj?.[k] ?? 0))}</div><div class="kpi-lbl">${esc(lbl)}</div></div>`).join("");
  return `<div class="card"><h2>${esc(titre)}</h2><div class="kpis">${tiles}</div></div>`;
}

function draw() {
  const e = data.entrees || { total: 0, detail: [] };
  // tableau entrées jour × tranche
  const tranches = ["3+", "6+", "8+", "13+", "adulte"];
  const jours = [...new Set((e.detail || []).map((d) => d.jour))];
  const cell = (j, t) => (e.detail || []).find((d) => d.jour === j && d.tranche === t)?.n || 0;
  const thead = `<tr><th>Jour</th>${tranches.map((t) => `<th>${esc(t)}</th>`).join("")}<th>Total</th></tr>`;
  const tbody = jours.map((j) => {
    const tot = tranches.reduce((a, t) => a + cell(j, t), 0);
    return `<tr><th>${esc(JOUR_LBL[j] || j)}</th>${tranches.map((t) => `<td>${cell(j, t)}</td>`).join("")}<td><b>${tot}</b></td></tr>`;
  }).join("") || `<tr><td colspan="${tranches.length + 2}" class="muted">Aucune entrée enregistrée.</td></tr>`;

  root.innerHTML = page(`<div class="dash-grid">
    ${kpiCard("Entrées", { total: e.total }, { total: "Total entrées" })}
    ${kpiCard("Bénévoles", data.benevoles, { total: "Inscrits", confirmes: "Confirmés", animateurs: "Animateurs" })}
    ${kpiCard("Organismes", data.organismes, { partenaires_confirmes: "Partenaires confirmés", editeurs: "Éditeurs", sponsors: "Sponsors" })}
    ${kpiCard("Jeux", data.jeux, { total: "Total", recus: "Reçus", demandes: "Demandés" })}
    ${kpiCard("Animation", { parties: data.parties }, { parties: "Parties programmées" })}
  </div>
  <div class="card" style="margin-top:14px"><h2>Entrées par jour et tranche d'âge</h2>
    <div style="overflow-x:auto"><table class="pub-table bilan-table">${thead}${tbody}</table></div>
  </div>
  <div class="card admin-sec" style="margin-top:14px"><h2>Clôture et RGPD</h2>
    <p class="mini">Après l'édition : efface les données sensibles (régimes, présences, disponibilités). Les compteurs ci-dessus restent.</p>
    <button class="btn danger" id="purge">Purger les données nominatives</button>
    <p class="msg" id="b-msg"></p>
  </div>`);
}

function wireOnce() {
  if (root.__bilanWired) return;
  root.__bilanWired = true;
  root.addEventListener("click", (e) => {
    if (e.target.closest("#csv")) return exportCsv();
    if (e.target.closest("#purge")) return purge();
  });
}

function download(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function exportCsv() {
  const detail = data.entrees?.detail || [];
  const rows = [["Jour", "Tranche", "Entrées"]];
  detail.forEach((d) => rows.push([JOUR_LBL[d.jour] || d.jour, d.tranche, d.n]));
  const body = rows.map((r) => r.join(";")).join("\r\n");
  const nom = (edNom || "edition").replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  download(`bilan-entrees-${nom}.csv`, String.fromCharCode(0xFEFF) + body); // BOM UTF-8 pour Excel FR
}
async function purge() {
  const msg = root.querySelector("#b-msg");
  if (!confirm("Purger les données personnelles de cette édition ?\n\n"
    + "• régimes alimentaires, présences, disponibilités\n"
    + "• formulaires d'inscription publics reçus\n"
    + "• noms des inscrits aux parties (le nombre de joueurs est gardé)\n"
    + "• e-mail et téléphone des bénévoles qui n'ont pas accepté d'être recontactés\n\n"
    + "Les statistiques du bilan sont conservées. Irréversible.")) return;
  msg.textContent = "Purge…";
  const { data, error } = await supa.rpc("purger_edition", { p_edition: store.editionId });
  msg.textContent = error ? "Erreur : " + error.message
    : `Données personnelles purgées (${data?.formulaires ?? 0} formulaire(s), ${data?.noms_parties ?? 0} nom(s) d'inscrits, coordonnées de ${data?.coordonnees_benevoles ?? 0} bénévole(s)).`;
}
