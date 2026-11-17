// Écran #/fournisseurs — Fournisseurs de jeux : les contacts à solliciter pour obtenir des
// jeux. Aujourd'hui = les éditeurs (seul « rôle fournisseur » du modèle) ; les types
// ludothèque / boutique viendront avec une évolution du modèle (Vague 2).
// Pipeline de contact : Sollicité (invite) → Relancé (relance) → Confirmé (confirme).
// « Sans réponse » = relancé mais sans nouvelles depuis plus de 15 jours.
import { supa } from "../supabase.js";
import { store } from "../store.js";
import { esc, plur, toast, aujourdhui } from "../ui/util.js";

let root, editeurs = [], attendus = new Map(), contrep = new Map();

const STALE = 15;
const joursDepuis = (d) => (d ? Math.round((Date.now() - new Date(d + "T00:00:00").getTime()) / 86400000) : null);
const estSansReponse = (r) => r.statut === "relance" && (joursDepuis(r.dernier_contact) ?? 999) > STALE;
const aRelancer = (r) => r.statut === "invite" || r.statut === "relance";

export async function render(container) {
  root = container;
  if (!store.editionId) {
    root.innerHTML = `<div class="page-head"><div><h1>Fournisseurs</h1><div class="sub">Aucune édition</div></div></div>
      <div class="card"><p><a class="btn primary" href="#/editions">Choisir une édition</a></p></div>`;
    return;
  }
  root.innerHTML = `<div class="card"><p class="muted">Chargement…</p></div>`;
  await load();
  wireOnce();
  draw();
}

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
  ? ((roles.includes("sponsor") ? "Éditeur Sponsor" : roles.includes("partenaire") ? "Éditeur Partenaire" : "Éditeur"))
  : "Fournisseur";

function statutTag(r) {
  if (r.statut === "confirme") return `<span class="tag ok">✓ Confirmé</span>`;
  if (r.statut === "refuse") return `<span class="tag bad">Refusé</span>`;
  if (estSansReponse(r)) return `<span class="tag bad">⚠ Relancé · sans réponse</span>`;
  if (r.statut === "relance") return `<span class="tag warn">Relancé</span>`;
  return `<span class="tag">Sollicité</span>`;
}

function ligne(r) {
  const id = r.organisme_id;
  const j = joursDepuis(r.dernier_contact);
  const att = attendus.get(id) || 0, cp = contrep.get(id) || 0;
  const date = r.dernier_contact
    ? `${new Date(r.dernier_contact + "T00:00:00").toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" })}<br><span class="mini${aRelancer(r) ? " alert-txt" : ""}">il y a ${j} j</span>`
    : `<span class="muted">jamais</span>`;
  const action = aRelancer(r)
    ? `<button class="btn small" data-relancer="${id}">✉ Relancer</button>`
    : `<button class="btn small" data-confirmer="${id}">Marquer confirmé</button>`;
  return `<tr>
    <td><strong>${esc(r.organismes.nom)}</strong><br><span class="muted">${esc(roleLbl(r.roles))}</span></td>
    <td>${statutTag(r)}</td>
    <td>${date}</td>
    <td>${att ? `${att} jeu${att > 1 ? "x" : ""}` : "<span class=\"muted\">—</span>"}</td>
    <td>${cp ? `<span class="alert-txt">${cp} à honorer</span>` : "<span class=\"muted\">—</span>"}</td>
    <td style="text-align:right">${action}</td></tr>`;
}

function draw() {
  const prio = editeurs.filter(aRelancer).sort((a, b) => (a.dernier_contact || "").localeCompare(b.dernier_contact || ""));
  const autres = editeurs.filter((r) => !aRelancer(r)).sort((a, b) => a.organismes.nom.localeCompare(b.organismes.nom, "fr"));
  const section = (titre, cls, rows) => rows.length
    ? `<tr class="group-row ${cls}"><td colspan="6">${esc(titre)} · ${rows.length}</td></tr>${rows.map(ligne).join("")}`
    : "";
  const corps = editeurs.length
    ? `${section("À relancer en priorité", "alert", prio)}${section("Les autres fournisseurs", "", autres)}`
    : `<tr><td colspan="6" class="muted">Aucun fournisseur pour cette édition. Les éditeurs apparaissent quand on leur demande des jeux.</td></tr>`;

  root.innerHTML = `
    <div class="page-head"><div>
      <div class="sub" style="text-transform:uppercase;letter-spacing:.06em;font-size:11px">Jeux et fournisseurs</div>
      <h1>Les fournisseurs de jeux</h1>
      <div class="sub">Les contacts à solliciter pour obtenir des jeux (éditeurs).</div>
    </div></div>
    <div class="card"><div class="scroll"><table class="data-table">
      <thead><tr><th>Fournisseur</th><th>Statut</th><th>Dernier contact</th><th>Jeux attendus</th><th>Contreparties</th><th></th></tr></thead>
      <tbody>${corps}</tbody></table></div>
      <p class="mini">À relancer : sollicité ou relancé, sans contact depuis plus de ${STALE} jours. Sans réponse : déjà relancé, toujours sans retour après ${STALE} jours.</p>
    </div>`;
}

function wireOnce() {
  if (root.__fourWired) return;
  root.__fourWired = true;
  root.addEventListener("click", onClick);
}

async function onClick(e) {
  const rel = e.target.closest("[data-relancer]");
  const conf = e.target.closest("[data-confirmer]");
  if (!rel && !conf) return;
  const id = (rel || conf).dataset.relancer || (conf).dataset.confirmer;
  const statut = rel ? "relance" : "confirme";
  const { error } = await supa.from("organisme_editions")
    .update({ statut, dernier_contact: aujourdhui() })
    .eq("organisme_id", id).eq("edition_id", store.editionId);
  if (error) { toast("Action impossible : " + error.message); return; }
  const r = editeurs.find((x) => x.organisme_id === id);
  if (r) { r.statut = statut; r.dernier_contact = aujourdhui(); }
  toast(rel ? "Fournisseur relancé." : "Fournisseur confirmé.", "ok");
  draw();
}
