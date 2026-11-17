// Écran #/fournisseurs — Fournisseurs de jeux : les contacts à solliciter pour obtenir des
// jeux. Aujourd'hui = les éditeurs (seul « rôle fournisseur » du modèle) ; les types
// ludothèque / boutique viendront avec une évolution du modèle (nouveau champ en base).
// Pipeline de contact : Sollicité (invite) → Relancé (relance) → Confirmé (confirme).
// « Sans réponse » = relancé mais sans nouvelles depuis plus de 15 jours.
// Sous-route #/fournisseurs/<id organisme> = fiche d'un fournisseur.
import { supa } from "../supabase.js";
import { store } from "../store.js";
import { esc, toast, aujourdhui } from "../ui/util.js";

let root, editeurs = [], attendus = new Map(), contrep = new Map();
let filtre = "tous", ficheId = null, fiche = null;

const STALE = 15;
const joursDepuis = (d) => (d ? Math.round((Date.now() - new Date(d + "T00:00:00").getTime()) / 86400000) : null);
const estSansReponse = (r) => r.statut === "relance" && (joursDepuis(r.dernier_contact) ?? 999) > STALE;
const aRelancer = (r) => r.statut === "invite" || r.statut === "relance";
const dateLongue = (d) => d ? new Date(d + "T00:00:00").toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" }) : null;
const dateCourte = (d) => d ? new Date(d + "T00:00:00").toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" }) : null;

export async function render(container, sub = "") {
  root = container;
  if (!store.editionId) {
    root.innerHTML = `<div class="page-head"><div><h1>Fournisseurs</h1><div class="sub">Aucune édition</div></div></div>
      <div class="card"><p><a class="btn primary" href="#/editions">Choisir une édition</a></p></div>`;
    return;
  }
  ficheId = sub && sub !== "obtenir" ? sub : null;
  root.innerHTML = `<div class="card"><p class="muted">Chargement…</p></div>`;
  wireOnce();
  if (ficheId) { await loadFiche(ficheId); drawFiche(); }
  else { await load(); draw(); }
}

/* ---------- liste ---------- */
async function load() {
  const ed = store.editionId;
  const [oe, je, cp] = await Promise.all([
    supa.from("organisme_editions").select("statut, dernier_contact, roles, organisme_id, organismes(nom)").eq("edition_id", ed).contains("roles", ["editeur"]),
    supa.from("jeux_editions").select("statut, jeux(editeur_id)").eq("edition_id", ed),
    supa.from("contreparties").select("organisme_id, faite").eq("edition_id", ed).eq("faite", false),
  ]);
  editeurs = (oe.data || []).filter((r) => r.organismes);
  attendus = new Map();
  (je.data || []).forEach((x) => {
    const e = x.jeux?.editeur_id;
    if (e && (x.statut === "souhaite" || x.statut === "demande")) attendus.set(e, (attendus.get(e) || 0) + 1);
  });
  contrep = new Map();
  (cp.data || []).forEach((c) => { if (c.organisme_id) contrep.set(c.organisme_id, (contrep.get(c.organisme_id) || 0) + 1); });
}

const roleLbl = (roles) => (roles || []).includes("editeur")
  ? (roles.includes("sponsor") ? "Éditeur Sponsor" : roles.includes("partenaire") ? "Éditeur Partenaire" : "Éditeur")
  : "Fournisseur";

// Pastille colorée avec l'initiale (couleur stable d'après le nom).
const AV = [["var(--blue-tint)", "var(--blue)"], ["var(--purple-tint)", "var(--purple)"], ["#F3D9C4", "#7A3E14"],
  ["#F6D5D5", "#8A2B2B"], ["#D5E6E2", "#0E4F4F"], ["var(--green-tint)", "var(--green)"], ["var(--accent-tint)", "var(--accent-dark)"]];
const avatar = (nom) => { const [bg, c] = AV[(nom.charCodeAt(0) || 0) % AV.length]; return `<span class="avatar" aria-hidden="true" style="background:${bg};color:${c}">${esc((nom[0] || "?").toUpperCase())}</span>`; };

function statutTag(r) {
  if (r.statut === "confirme") return `<span class="pill ok">✓ Confirmé</span>`;
  if (r.statut === "refuse") return `<span class="pill alert">Refusé</span>`;
  if (estSansReponse(r)) return `<span class="pill alert">⚠ Relancé · sans réponse</span>`;
  if (r.statut === "relance") return `<span class="pill amber">Relancé</span>`;
  return `<span class="pill grey">Sollicité</span>`;
}

// Prédicats des filtres de la barre.
const FILTRES = {
  tous: () => true,
  relancer: aRelancer,
  sansreponse: estSansReponse,
  sollicites: (r) => r.statut === "invite",
  relances: (r) => r.statut === "relance",
  confirmes: (r) => r.statut === "confirme",
};
const FILTRE_LBL = { tous: "Tous", relancer: "À relancer", sansreponse: "Sans réponse", sollicites: "Sollicités", relances: "Relancés", confirmes: "Confirmés" };

function ligne(r) {
  const id = r.organisme_id;
  const j = joursDepuis(r.dernier_contact);
  const att = attendus.get(id) || 0, cp = contrep.get(id) || 0;
  const date = r.dernier_contact
    ? `${dateCourte(r.dernier_contact)}<br><span class="mini${aRelancer(r) ? " alert-txt" : ""}">il y a ${j} j</span>`
    : `<span class="muted">jamais</span>`;
  const action = aRelancer(r)
    ? `<button class="btn small" data-relancer="${id}">✉ Relancer</button>`
    : `<a class="link" href="#/fournisseurs/${id}">Ouvrir</a>`;
  return `<tr>
    <td><div class="four-cell">${avatar(r.organismes.nom)}<div class="row-main">
      <a class="link" href="#/fournisseurs/${id}" style="padding:0"><strong>${esc(r.organismes.nom)}</strong></a>
      <span class="muted">${esc(roleLbl(r.roles))}</span></div></div></td>
    <td>${statutTag(r)}</td>
    <td>${date}</td>
    <td>${att ? `${att} jeu${att > 1 ? "x" : ""}` : "<span class=\"muted\">—</span>"}</td>
    <td>${cp ? `<span class="alert-txt">${cp} à honorer</span>` : "<span class=\"muted\">—</span>"}</td>
    <td style="text-align:right">${action}</td></tr>`;
}

function draw() {
  const compte = (k) => editeurs.filter(FILTRES[k]).length;
  const chips = Object.keys(FILTRE_LBL).map((k) => {
    const alertK = k === "relancer" || k === "sansreponse";
    return `<button class="chip${filtre === k ? " on" : ""}${alertK ? " alert" : ""}" data-filtre="${k}">${esc(FILTRE_LBL[k])} <span class="chip-n">${compte(k)}</span></button>`;
  }).join("");

  const liste = editeurs.filter(FILTRES[filtre]);
  let corps;
  if (!editeurs.length) {
    corps = `<tr><td colspan="6" class="muted">Aucun fournisseur pour cette édition. Les éditeurs apparaissent quand on leur demande des jeux.</td></tr>`;
  } else if (filtre === "tous") {
    const prio = liste.filter(aRelancer).sort((a, b) => (a.dernier_contact || "").localeCompare(b.dernier_contact || ""));
    const autres = liste.filter((r) => !aRelancer(r)).sort((a, b) => a.organismes.nom.localeCompare(b.organismes.nom, "fr"));
    const section = (titre, cls, rows) => rows.length
      ? `<tr class="group-row ${cls}"><td colspan="6">${esc(titre)} · ${rows.length}</td></tr>${rows.map(ligne).join("")}`
      : "";
    corps = `${section("À relancer en priorité", "alert", prio)}${section("Les autres fournisseurs", "", autres)}`;
  } else {
    const rows = [...liste].sort((a, b) => (a.dernier_contact || "").localeCompare(b.dernier_contact || ""));
    corps = rows.length ? rows.map(ligne).join("") : `<tr><td colspan="6" class="muted">Aucun fournisseur « ${esc(FILTRE_LBL[filtre])} ».</td></tr>`;
  }

  root.innerHTML = `
    <div class="page-head"><div>
      <div class="sub" style="text-transform:uppercase;letter-spacing:.06em;font-size:11px;color:var(--primary);font-weight:700">Jeux et fournisseurs</div>
      <h1>Les fournisseurs de jeux</h1>
      <div class="sub">Les contacts à solliciter pour obtenir des jeux (éditeurs).</div>
    </div>
    <div class="head-actions"><a class="btn primary" href="#/organismes">+ Ajouter un fournisseur</a></div></div>
    <p class="mini" style="margin:-8px 0 14px"><b>Type :</b> seuls les éditeurs sont gérés pour l'instant (ludothèques / boutiques à venir).</p>
    <div class="card">
      <div class="filters" style="margin-bottom:12px">${chips}</div>
      <div class="scroll"><table class="data-table">
        <thead><tr><th>Fournisseur</th><th>Statut</th><th>Dernier contact</th><th>Jeux attendus</th><th>Contreparties</th><th></th></tr></thead>
        <tbody>${corps}</tbody></table></div>
      <p class="mini">À relancer : sollicité ou relancé, sans contact depuis plus de ${STALE} jours. Sans réponse : déjà relancé, toujours sans retour après ${STALE} jours.</p>
    </div>`;
}

/* ---------- fiche ---------- */
async function loadFiche(id) {
  const ed = store.editionId;
  const [org, oe, je, cp] = await Promise.all([
    supa.from("organismes").select("nom, site, contact_nom, contact_email, contact_tel").eq("id", id).single(),
    supa.from("organisme_editions").select("statut, dernier_contact, roles").eq("organisme_id", id).eq("edition_id", ed).maybeSingle(),
    supa.from("jeux_editions").select("statut, jeux!inner(titre, editeur_id)").eq("edition_id", ed).eq("jeux.editeur_id", id),
    supa.from("contreparties").select("id, nature, description, faite").eq("edition_id", ed).eq("organisme_id", id).eq("faite", false),
  ]);
  fiche = { id, org: org.data, oe: oe.data || { statut: "invite", dernier_contact: null, roles: ["editeur"] },
    jeux: je.data || [], contreparties: cp.data || [] };
}

const ETAPES = [["invite", "Sollicité"], ["relance", "Relancé"], ["confirme", "Confirmé"]];

function stepper(statut) {
  const idx = Math.max(0, ETAPES.findIndex((e) => e[0] === statut));
  const dot = (i) => {
    const on = i <= idx && statut !== "refuse";
    const bg = on ? "var(--primary)" : "var(--soft)", col = on ? "#fff" : "var(--muted)";
    return `<div style="display:flex;flex-direction:column;align-items:center;gap:6px;flex:1">
      <div style="width:36px;height:36px;border-radius:50%;background:${bg};color:${col};display:grid;place-items:center;font-weight:700">${on ? "✓" : i + 1}</div>
      <span class="mini">${esc(ETAPES[i][1])}</span></div>`;
  };
  return `<div class="card"><div style="display:flex;align-items:flex-start">${ETAPES.map((_, i) => dot(i)).join("")}</div></div>`;
}

function jeuAttenduLigne(x) {
  const t = x.jeux?.titre || "Jeu";
  const tag = x.statut === "demande" ? `<span class="tag blue">⏱ Demandé</span>`
    : x.statut === "recu" ? `<span class="tag ok">✓ Obtenu</span>`
    : `<span class="tag warn">↧ À obtenir</span>`;
  const sous = x.statut === "demande" ? "Demandé" : x.statut === "recu" ? "Obtenu" : "Pas encore demandé";
  return `<div class="row"><div class="row-main"><b>${esc(t)}</b><span class="muted">${esc(sous)}</span></div><div class="actions">${tag}</div></div>`;
}

function drawFiche() {
  const f = fiche;
  if (!f.org) { root.innerHTML = `<div class="page-head"><div><h1>Fournisseur introuvable</h1></div></div>
    <div class="card"><p><a class="btn" href="#/fournisseurs">← Fournisseurs</a></p></div>`; return; }
  const r = f.oe, j = joursDepuis(r.dernier_contact);
  const contactLigne = r.dernier_contact
    ? `<div class="sub${aRelancer(r) ? " alert-txt" : ""}">⏱ Dernier contact le ${dateLongue(r.dernier_contact)}, il y a ${j} jours</div>`
    : `<div class="sub muted">Jamais contacté</div>`;

  const jeuxCard = `<div class="card"><div class="dash-head"><h2>Jeux attendus de ${esc(f.org.nom)} <span class="tag neu">${f.jeux.length}</span></h2></div>
    ${f.jeux.length ? `<div class="list">${f.jeux.map(jeuAttenduLigne).join("")}</div>` : `<p class="muted">Aucun jeu attendu de ce fournisseur.</p>`}</div>`;

  const cpCard = `<div class="card"><div class="dash-head"><h2>Contreparties à honorer${f.contreparties.length ? ` <span class="tag warn">${f.contreparties.length}</span>` : ""}</h2></div>
    ${f.contreparties.length ? `<div class="list">${f.contreparties.map((c) => `<div class="row">
        <div class="row-main"><b>${esc(c.description || c.nature || "Contrepartie")}</b></div>
        <div class="actions"><button class="btn small" data-cpfaite="${c.id}">✓ Marquer faite</button></div></div>`).join("")}</div>`
      : `<p class="muted">Aucune contrepartie en attente.</p>`}</div>`;

  const coord = `<div class="card"><div class="dash-head"><h2>Coordonnées</h2></div>
    <div class="grid g2">
      ${f.org.contact_nom ? `<div><div class="lbl">Contact</div>${esc(f.org.contact_nom)}</div>` : ""}
      ${f.org.contact_email ? `<div><div class="lbl">E-mail</div><a class="link" href="mailto:${esc(f.org.contact_email)}">${esc(f.org.contact_email)}</a></div>` : ""}
      ${f.org.contact_tel ? `<div><div class="lbl">Téléphone</div>${esc(f.org.contact_tel)}</div>` : ""}
      ${f.org.site ? `<div><div class="lbl">Site</div><a class="link" href="${esc(f.org.site)}" target="_blank" rel="noopener">${esc(f.org.site)}</a></div>` : ""}
    </div>
    ${!(f.org.contact_nom || f.org.contact_email || f.org.contact_tel || f.org.site) ? `<p class="muted">Pas de coordonnées enregistrées. (Fiche détaillée dans « Organismes ».)</p>` : ""}</div>`;

  const actions = `<div class="head-actions">
      <button class="btn primary" data-relancer="${f.id}">✉ Marquer relancé</button>
      <button class="btn" data-confirmer="${f.id}">✓ Marquer confirmé</button></div>`;

  root.innerHTML = `
    <div class="page-head"><div>
      <div class="sub"><a class="link" href="#/fournisseurs">Fournisseurs</a> › ${esc(f.org.nom)}</div>
      <h1>${esc(f.org.nom)} <span class="tag neu">${esc(roleLbl(r.roles))}</span> ${statutTag(r)}</h1>
      ${contactLigne}
    </div>${actions}</div>
    ${stepper(r.statut)}
    <div class="dash-grid" style="margin-top:14px">${jeuxCard}${cpCard}${coord}</div>`;
}

/* ---------- câblage ---------- */
function wireOnce() {
  if (root.__fourWired) return;
  root.__fourWired = true;
  root.addEventListener("click", onClick);
}

async function onClick(e) {
  const fi = e.target.closest("[data-filtre]");
  if (fi) { filtre = fi.dataset.filtre; return draw(); }

  const cpf = e.target.closest("[data-cpfaite]");
  if (cpf) {
    const { error } = await supa.from("contreparties").update({ faite: true, faite_le: aujourdhui() }).eq("id", cpf.dataset.cpfaite);
    if (error) { toast("Impossible : " + error.message); return; }
    if (fiche) fiche.contreparties = fiche.contreparties.filter((c) => c.id !== cpf.dataset.cpfaite);
    toast("Contrepartie marquée faite.", "ok"); return drawFiche();
  }

  const rel = e.target.closest("[data-relancer]");
  const conf = e.target.closest("[data-confirmer]");
  if (!rel && !conf) return;
  const id = (rel || conf).dataset.relancer || conf.dataset.confirmer;
  const statut = rel ? "relance" : "confirme";
  const { error } = await supa.from("organisme_editions")
    .update({ statut, dernier_contact: aujourdhui() })
    .eq("organisme_id", id).eq("edition_id", store.editionId);
  if (error) { toast("Action impossible : " + error.message); return; }
  toast(rel ? "Fournisseur relancé." : "Fournisseur confirmé.", "ok");
  // Rafraîchir la vue courante (fiche ou liste).
  if (ficheId) { if (fiche) { fiche.oe.statut = statut; fiche.oe.dernier_contact = aujourdhui(); } drawFiche(); }
  else { const r = editeurs.find((x) => x.organisme_id === id); if (r) { r.statut = statut; r.dernier_contact = aujourdhui(); } draw(); }
}
