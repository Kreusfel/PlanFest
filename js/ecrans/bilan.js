// Écran #/bilan — chiffres de l'édition (RPC bilan, migration 038), comparés à l'édition
// précédente (N-1, par date du samedi), exports CSV, purge RGPD. Admin.
import { supa } from "../supabase.js";
import { store } from "../store.js";
import { esc, telecharger, slug } from "../ui/util.js";

const JOUR_LBL = { ven: "Vendredi", sam: "Samedi", dim: "Dimanche" };
const TRANCHES = ["3+", "6+", "8+", "13+", "adulte"];
let root, data = null, prec = null, edNom = "", precNom = "";

export async function render(container) {
  root = container;
  if (!store.editionId) {
    root.innerHTML = page(`<div class="card"><p><a class="btn primary" href="#/editions">Choisir une édition</a></p></div>`);
    return;
  }
  root.innerHTML = page(`<div class="card"><p class="muted">Chargement…</p></div>`);
  const [b, eds] = await Promise.all([
    supa.rpc("bilan", { p_edition: store.editionId }),
    supa.from("editions").select("id,nom,date_samedi").order("date_samedi"),
  ]);
  if (b.error) { root.innerHTML = page(`<div class="card"><p class="msg">${b.error.message.includes("acces") ? "Réservé aux admins." : "Erreur : " + esc(b.error.message)}</p></div>`); return; }
  data = b.data || {};
  const liste = eds.data || [];
  const i = liste.findIndex((e) => e.id === store.editionId);
  edNom = liste[i]?.nom || "";
  // Édition précédente : celle dont le samedi est juste avant.
  const avant = i > 0 ? liste[i - 1] : null;
  prec = null; precNom = "";
  if (avant) {
    const pb = await supa.rpc("bilan", { p_edition: avant.id });
    if (!pb.error) { prec = pb.data || {}; precNom = avant.nom; }
  }
  wireOnce();
  draw();
}

const page = (body) => `<div class="page-head"><div><h1>Bilan</h1>
  <div class="sub">Chiffres de l'édition${precNom ? ` · comparés à ${esc(precNom)}` : ""}</div></div>
  <div class="head-actions"><button class="btn" id="csv">Export CSV (entrées)</button>
    <button class="btn" id="csv-prov">Export CSV (provenance)</button></div></div>${body}`;

const get = (obj, path) => path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
const nombre = (n) => Number(n || 0).toLocaleString("fr-FR");
const eur = (n) => Number(n || 0).toLocaleString("fr-FR", { style: "currency", currency: "EUR" });
const pct = (a, b) => (b ? Math.round((a / b) * 100) + " %" : "—");

// Tuile : valeur de l'édition + rappel N-1 (si une édition précédente existe).
function tuile(lbl, chemin, fmt = nombre) {
  const v = get(data, chemin);
  const p = prec ? get(prec, chemin) : undefined;
  const n1 = prec && p != null ? `<div class="kpi-n1">N-1 : ${esc(fmt(p))}</div>` : "";
  return `<div class="kpi"><div class="kpi-val">${esc(fmt(v))}</div><div class="kpi-lbl">${esc(lbl)}</div>${n1}</div>`;
}
const carte = (titre, tuiles, extra = "") => `<div class="card"><h2>${esc(titre)}</h2><div class="kpis">${tuiles.join("")}</div>${extra}</div>`;

function draw() {
  const e = data.entrees || { total: 0, detail: [] };
  const cell = (j, t) => (e.detail || []).find((d) => d.jour === j && d.tranche === t)?.n || 0;
  const jours = [...new Set((e.detail || []).map((d) => d.jour))];
  const thead = `<tr><th>Jour</th>${TRANCHES.map((t) => `<th>${esc(t)}</th>`).join("")}<th>Total</th></tr>`;
  const tbody = jours.map((j) => {
    const tot = TRANCHES.reduce((a, t) => a + cell(j, t), 0);
    return `<tr><th>${esc(JOUR_LBL[j] || j)}</th>${TRANCHES.map((t) => `<td>${cell(j, t)}</td>`).join("")}<td><b>${tot}</b></td></tr>`;
  }).join("") || `<tr><td colspan="${TRANCHES.length + 2}" class="muted">Aucune entrée enregistrée.</td></tr>`;

  const prov = data.provenance || { detail: [], sans: 0 };
  const provTot = (prov.detail || []).reduce((a, r) => a + r.n, 0) + (prov.sans || 0);
  const provRows = (prov.detail || []).map((r) => `<tr><td>${esc(r.cp)}</td><td>${esc(r.ville)}</td><td>${r.n}</td><td class="muted">${pct(r.n, provTot)}</td></tr>`).join("")
    || `<tr><td colspan="4" class="muted">Aucune provenance saisie.</td></tr>`;

  const a = data.animation || {};
  const pr = data.presences || {};
  const prTot = (pr.present || 0) + (pr.retard || 0) + (pr.absent || 0);

  root.innerHTML = page(`<div class="dash-grid">
    ${carte("Entrées", [tuile("Total entrées", "entrees.total")])}
    ${carte("Bénévoles", [tuile("Inscrits", "benevoles.total"), tuile("Confirmés", "benevoles.confirmes"), tuile("Animateurs", "benevoles.animateurs")],
      prTot ? `<p class="mini">Pointages : ${pr.present || 0} présents, ${pr.retard || 0} en retard, ${pr.absent || 0} absents (${pct((pr.present || 0) + (pr.retard || 0), prTot)} de présence).</p>` : "")}
    ${carte("Animation", [tuile("Parties", "animation.parties"), tuile("Places proposées", "animation.places"), tuile("Joueurs inscrits", "animation.inscrits_total")],
      a.places ? `<p class="mini">Remplissage des parties à places limitées : ${pct(a.inscrits, a.places)}.</p>` : "")}
    ${carte("Organismes", [tuile("Partenaires confirmés", "organismes.partenaires_confirmes"), tuile("Éditeurs", "organismes.editeurs"), tuile("Sponsors", "organismes.sponsors")])}
    ${carte("Jeux", [tuile("Total", "jeux.total"), tuile("Reçus", "jeux.recus"), tuile("Demandés", "jeux.demandes")])}
    ${carte("Buvette", [tuile("Chiffre d'affaires", "buvette.ca", eur), tuile("Coût d'achat", "buvette.cout", eur), tuile("Marge", "buvette.marge", eur)])}
    ${carte("Subventions", [tuile("Dossiers", "subventions.dossiers"), tuile("Accordées", "subventions.accordees"), tuile("Montant accordé", "subventions.accorde", eur)])}
    ${carte("Vendredi intergénérationnel", [tuile("Structures confirmées", "vendredi.confirmes"), tuile("Venues", "vendredi.venus"), tuile("Personnes attendues", "vendredi.personnes")])}
  </div>
  <div class="card" style="margin-top:14px"><h2>Entrées par jour et tranche d'âge</h2>
    <div class="scroll"><table class="pub-table bilan-table">${thead}${tbody}</table></div>
  </div>
  <div class="card" style="margin-top:14px"><h2>D'où viennent les visiteurs</h2>
    <p class="mini">Provenance saisie à l'accueil, par groupe. ${prov.sans ? `${prov.sans} entrée(s) sans provenance.` : ""} Les 20 premières communes.</p>
    <div class="scroll"><table class="data-table"><thead><tr><th>Code postal</th><th>Ville</th><th>Entrées</th><th>Part</th></tr></thead>
      <tbody>${provRows}</tbody></table></div>
  </div>
  <div class="card admin-sec" style="margin-top:14px"><h2>Clôture et RGPD</h2>
    <p class="mini">Après l'édition : efface les données sensibles (régimes, présences, disponibilités). Les compteurs ci-dessus restent, sauf les pointages de présence.</p>
    <button class="btn danger" id="purge">Purger les données nominatives</button>
    <p class="msg" id="b-msg"></p>
  </div>`);
}

function wireOnce() {
  if (root.__bilanWired) return;
  root.__bilanWired = true;
  root.addEventListener("click", (e) => {
    if (e.target.closest("#csv")) return exportCsv();
    if (e.target.closest("#csv-prov")) return exportProvenance();
    if (e.target.closest("#purge")) return purge();
  });
}

function csv(nom, rows) {
  const body = rows.map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(";")).join("\r\n");
  telecharger(`${nom}-${slug(edNom)}.csv`, String.fromCharCode(0xFEFF) + body, "text/csv;charset=utf-8"); // BOM UTF-8 pour Excel FR
}
function exportCsv() {
  const rows = [["Jour", "Tranche", "Entrées"]];
  (data.entrees?.detail || []).forEach((d) => rows.push([JOUR_LBL[d.jour] || d.jour, d.tranche, d.n]));
  csv("bilan-entrees", rows);
}
function exportProvenance() {
  const rows = [["Code postal", "Ville", "Entrées"]];
  (data.provenance?.detail || []).forEach((r) => rows.push([r.cp, r.ville, r.n]));
  if (data.provenance?.sans) rows.push(["", "(sans provenance)", data.provenance.sans]);
  csv("bilan-provenance", rows);
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
  const { data: r, error } = await supa.rpc("purger_edition", { p_edition: store.editionId });
  msg.textContent = error ? "Erreur : " + error.message
    : `Données personnelles purgées (${r?.formulaires ?? 0} formulaire(s), ${r?.noms_parties ?? 0} nom(s) d'inscrits, coordonnées de ${r?.coordonnees_benevoles ?? 0} bénévole(s)).`;
}
