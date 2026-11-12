// Écran #/ — Tableau de bord. Lit la RPC tableau_de_bord (compteurs par pôle).
import { supa } from "../supabase.js";
import { store } from "../store.js";
import { esc } from "../ui/util.js";

const POLE_TITRE = {
  partenaires: "Partenaires", jeux_editeurs: "Jeux et éditeurs", sponsors: "Sponsors",
  animateurs_benevoles: "Animateurs et bénévoles", buvette_catering: "Buvette et catering",
  communication: "Communication", logistique_securite: "Logistique et sécurité",
  intergenerationnelle: "Intergénérationnelle",
};
const POLE_LIEN = {
  partenaires: "#/organismes", jeux_editeurs: "#/jeux", sponsors: "#/subventions",
  animateurs_benevoles: "#/benevoles", buvette_catering: "#/repas",
  logistique_securite: "#/plan", communication: "#/organismes", intergenerationnelle: "#/benevoles",
};
const LABELS = {
  confirmes: "Confirmés", a_relancer: "À relancer", tables_non_attribuees: "Tables à attribuer",
  editeurs_sans_reponse: "Éditeurs sans réponse", jeux_demandes: "Jeux demandés", jeux_recus: "Jeux reçus",
  dossiers_attente: "Dossiers en attente", echeances_30j: "Échéances < 30 j",
  tables_non_verifiees: "Tables non vérifiées", benevoles: "Bénévoles", animateurs: "Animateurs",
  alertes: "Alertes parties", confirmes_sans_logo: "Confirmés sans logo", programme_publie: "Programme publié",
  benevoles_vendredi: "Dispo vendredi", sam: "Repas samedi", dim: "Repas dimanche",
};
// Indicateurs où un nombre > 0 signale une action à mener (teinte d'alerte)
const ALERTE_SI_POSITIF = new Set(["a_relancer", "tables_non_attribuees", "editeurs_sans_reponse",
  "dossiers_attente", "echeances_30j", "tables_non_verifiees", "alertes", "confirmes_sans_logo"]);

const ROLE_SHORT = { editeur: "Éditeur", partenaire: "Partenaire", sponsor: "Sponsor" };
const STATUT_LBL = { invite: "à contacter", relance: "à relancer" };
const STALE_JOURS = 14; // sans contact depuis plus de N jours = en retard

let root;

export async function render(container) {
  root = container;
  if (!store.editionId) {
    root.innerHTML = `<div class="page-head"><div><h1>Tableau de bord</h1>
      <div class="sub">Aucune édition sélectionnée</div></div></div>
      <div class="card"><p>Choisis une édition pour voir les indicateurs.
        <a class="btn primary" href="#/editions">Éditions</a></p></div>`;
    return;
  }
  root.innerHTML = `<div class="page-head"><div><h1>Tableau de bord</h1></div></div>
    <div class="card"><p class="muted">Chargement…</p></div>`;
  const { data, error } = await supa.rpc("tableau_de_bord", { p_edition: store.editionId });
  if (error) {
    root.innerHTML = `<div class="page-head"><div><h1>Tableau de bord</h1></div></div>
      <div class="card"><p class="msg">Erreur : ${esc(error.message)}</p></div>`;
    return;
  }
  // Relances : organismes à contacter / à relancer, triés par dernier contact croissant.
  const rel = await supa.from("organisme_editions")
    .select("statut, dernier_contact, roles, organismes(nom)")
    .eq("edition_id", store.editionId).in("statut", ["invite", "relance"]);
  const relances = (rel.error ? [] : (rel.data ?? [])).filter((r) => r.organismes)
    .sort((a, b) => (a.dernier_contact || "").localeCompare(b.dernier_contact || ""));
  draw(data || {}, relances);
}

function relancesCard(rel) {
  const rows = rel.slice(0, 20).map((r) => {
    const d = r.dernier_contact;
    const days = d ? Math.round((Date.now() - new Date(d + "T00:00:00").getTime()) / 86400000) : null;
    const stale = days === null || days > STALE_JOURS;
    const when = d ? `il y a ${days} j` : "jamais contacté";
    const roles = (r.roles || []).map((x) => ROLE_SHORT[x] || x).join(", ");
    return `<tr>
      <td><strong>${esc(r.organismes.nom)}</strong></td>
      <td class="muted">${esc(roles)}</td>
      <td><span class="tag ${stale ? "bad" : "warn"}">${esc(when)}</span></td></tr>`;
  }).join("");
  return `<div class="card" style="margin-bottom:14px"><div class="dash-head">
      <h2>À relancer <span class="tag bad">${rel.length}</span></h2>
      <a class="link" href="#/organismes">Ouvrir Organismes →</a></div>
    <div class="scroll"><table class="data-table">
      <thead><tr><th>Organisme</th><th>Rôle</th><th>Dernier contact</th></tr></thead>
      <tbody>${rows}</tbody></table></div>
    ${rel.length > 20 ? `<p class="mini">… et ${rel.length - 20} autres.</p>` : ""}</div>`;
}

function tile(key, val) {
  const label = LABELS[key] || key;
  let disp, cls = "";
  if (typeof val === "boolean") { disp = val ? "Oui" : "Non"; cls = val ? "ok" : "warn"; }
  else { disp = val ?? 0; if (ALERTE_SI_POSITIF.has(key) && val > 0) cls = "alert"; }
  return `<div class="kpi ${cls}"><div class="kpi-val">${esc(String(disp))}</div><div class="kpi-lbl">${esc(label)}</div></div>`;
}

function draw(data, relances) {
  const keys = Object.keys(POLE_TITRE).filter((k) => data[k]);
  const cards = keys.map((k) => {
    const tiles = Object.entries(data[k]).map(([kk, vv]) => tile(kk, vv)).join("");
    return `<div class="card">
      <div class="dash-head"><h2>${esc(POLE_TITRE[k])}</h2>
        <a class="link" href="${POLE_LIEN[k]}">Ouvrir →</a></div>
      <div class="kpis">${tiles}</div></div>`;
  }).join("") || `<div class="card"><p class="muted">Aucun indicateur pour tes pôles.</p></div>`;
  const relCard = (relances && relances.length) ? relancesCard(relances) : "";
  root.innerHTML = `<div class="page-head"><div><h1>Tableau de bord</h1>
    <div class="sub">Vue d'ensemble de l'édition courante</div></div></div>
    ${relCard}
    <div class="dash-grid">${cards}</div>`;
}
