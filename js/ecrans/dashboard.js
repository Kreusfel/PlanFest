// Écran #/ — Accueil recentré sur les JEUX et les FOURNISSEURS de jeux.
// Les autres pôles (bénévoles, buvette, plan…) restent accessibles via « Reste du festival »
// dans la navigation, mais ne sont plus mis en avant ici.
// Les compteurs sont calculés par requêtes directes (lisibles par un compte actif via RLS),
// sans dépendre d'une migration : le tableau fonctionne dès que le code est en ligne.
import { supa } from "../supabase.js";
import { store } from "../store.js";
import { esc, plur } from "../ui/util.js";

let root;

// Jours depuis une date AAAA-MM-JJ (null si pas de date).
const joursDepuis = (d) => (d ? Math.round((Date.now() - new Date(d + "T00:00:00").getTime()) / 86400000) : null);
const STALE = 15;  // sans contact depuis plus de N jours = à relancer / « sans réponse »

export async function render(container) {
  root = container;
  const ed = store.editionId;
  if (!ed) {
    root.innerHTML = `<div class="page-head"><div><h1>Accueil</h1>
      <div class="sub">Aucune édition sélectionnée</div></div></div>
      <div class="card"><p>Choisis une édition pour voir la préparation des jeux et des fournisseurs.
        <a class="btn primary" href="#/editions">Choisir une édition</a></p>
        <p class="muted">La ludothèque de l'asso reste consultable depuis « Jeux », sans édition.</p></div>`;
    return;
  }
  root.innerHTML = `<div class="page-head"><div><h1>Accueil</h1>
    <div class="sub">Chargement…</div></div></div><div class="card"><p class="muted">Un instant…</p></div>`;

  // Tout en parallèle. jeux_editions, jeux, malle_jeux, organisme_editions et contreparties
  // sont lisibles par un compte actif (policies select = est_actif()).
  const [jeRes, jxRes, mjRes, oeRes, cpRes, edRes] = await Promise.all([
    supa.from("jeux_editions").select("statut, exemplaires, jeu_id, jeux(editeur_id)").eq("edition_id", ed),
    supa.from("jeux").select("id, ludotheque, exemplaires_asso"),
    supa.from("malle_jeux").select("jeu_id").eq("edition_id", ed),
    supa.from("organisme_editions").select("statut, dernier_contact, roles, organisme_id, organismes(nom)").eq("edition_id", ed),
    supa.from("contreparties").select("nature, description, beneficiaire, faite").eq("edition_id", ed).eq("faite", false),
    supa.from("editions").select("nom").eq("id", ed).single(),
  ]);

  if (jeRes.error) {
    root.innerHTML = `<div class="page-head"><div><h1>Accueil</h1></div></div>
      <div class="card"><p class="msg">Erreur de chargement : ${esc(jeRes.error.message)}</p></div>`;
    return;
  }

  const je = jeRes.data || [];
  const jx = jxRes.data || [];
  const nb = (s) => je.filter((x) => x.statut === s).length;

  // Exemplaires manquants — même règle que l'écran Jeux : possédés (exemplaires_asso si
  // jeu de l'asso, sinon 0) comparés au besoin = max(nb de malles, exemplaires au festival).
  const mallesParJeu = new Map();
  (mjRes.data || []).forEach((m) => mallesParJeu.set(m.jeu_id, (mallesParJeu.get(m.jeu_id) || 0) + 1));
  const exFestival = new Map();
  je.forEach((x) => exFestival.set(x.jeu_id, x.exemplaires || 1));
  let manqueTotal = 0, aCompleter = 0;
  jx.forEach((j) => {
    const possedes = j.ludotheque ? (j.exemplaires_asso ?? 1) : 0;
    const besoin = Math.max(mallesParJeu.get(j.id) || 0, (j.ludotheque && exFestival.has(j.id)) ? exFestival.get(j.id) : 0);
    const m = Math.max(0, besoin - possedes);
    if (m > 0) { manqueTotal += m; aCompleter++; }
  });

  const jeux = { total: je.length, souhaite: nb("souhaite"), demande: nb("demande"), recu: nb("recu"),
    ludo: jx.filter((j) => j.ludotheque).length, manque: manqueTotal, aCompleter };

  // Jeux encore attendus par fournisseur (souhaités ou demandés) → compteur « N attendus ».
  const attendus = new Map();
  je.forEach((x) => {
    const e = x.jeux?.editeur_id;
    if (e && (x.statut === "souhaite" || x.statut === "demande")) attendus.set(e, (attendus.get(e) || 0) + 1);
  });

  // Fournisseurs = pour l'instant les éditeurs (seul « rôle fournisseur » existant en base).
  const editeurs = (oeRes.data || []).filter((r) => (r.roles || []).includes("editeur") && r.organismes);
  const confirmes = editeurs.filter((r) => r.statut === "confirme").length;
  const aRelancer = editeurs.filter((r) => r.statut === "invite" || r.statut === "relance")
    .sort((a, b) => (a.dernier_contact || "").localeCompare(b.dernier_contact || ""));
  const sansReponse = aRelancer.filter((r) => r.statut === "relance" && (joursDepuis(r.dernier_contact) ?? 999) > STALE).length;

  draw({ nom: edRes.data?.nom || "Édition en cours", jeux, editeurs, aRelancer, sansReponse, confirmes, cp: cpRes.data || [], attendus });
}

// Grosse carte chiffre (format maquette). alerte = teinte saumon quand il y a une action.
function kpiCard(num, label, { alerte = false, sous = "", href = "#/jeux" } = {}) {
  return `<a href="${href}" class="kpi-card${alerte ? " alert" : ""}">
    <div class="kpi-num">${esc(String(num))}</div>
    <div class="kpi-label">${esc(label)}</div>
    ${sous ? `<div class="kpi-sub">${alerte ? "⚠ " : ""}${esc(sous)}</div>` : ""}</a>`;
}

// Barre d'avancement À obtenir → Demandé → Obtenu (segments proportionnels, vides masqués).
function pipeline(j) {
  const seg = (n, bg, col, lbl) => (n > 0
    ? `<div class="pipe-seg" style="flex:${n};background:${bg};color:${col}">${n} ${esc(lbl)}</div>` : "");
  if (!(j.souhaite + j.demande + j.recu)) return "";
  return `<div class="pipe"><div class="pipe-head"><b>Les jeux à obtenir, étape par étape</b>
      <a class="link" href="#/jeux/obtenir">Ouvrir le suivi →</a></div>
    <div class="pipe-bar">
      ${seg(j.souhaite, "var(--accent)", "var(--side-bg)", "à obtenir")}
      ${seg(j.demande, "#2B5FA8", "#fff", "demandés")}
      ${seg(j.recu, "#2E7D4F", "#fff", "obtenus")}</div></div>`;
}

// Pastille colorée avec l'initiale, couleur stable d'après le nom.
const AV = [["var(--blue-tint)", "var(--blue)"], ["var(--purple-tint)", "var(--purple)"], ["#F3D9C4", "#7A3E14"],
  ["#F6D5D5", "#8A2B2B"], ["#D5E6E2", "#0E4F4F"], ["var(--green-tint)", "var(--green)"], ["var(--accent-tint)", "var(--accent-dark)"]];
function avatar(nom) {
  const [bg, c] = AV[(nom.charCodeAt(0) || 0) % AV.length];
  return `<span class="avatar" aria-hidden="true" style="background:${bg};color:${c}">${esc((nom[0] || "?").toUpperCase())}</span>`;
}

function relancePanel(aRelancer, attendus) {
  if (!aRelancer.length) return `<section class="dash-panel"><div class="dash-panel-head"><h2>À relancer</h2>
    <a class="link" href="#/fournisseurs">Fournisseurs →</a></div><p class="muted">Personne à relancer. 👍</p></section>`;
  const items = aRelancer.slice(0, 8).map((r) => {
    const j = joursDepuis(r.dernier_contact);
    const stale = r.statut === "relance" && (j ?? 999) > STALE;
    const att = attendus.get(r.organisme_id) || 0;
    const when = j == null ? "Jamais contacté" : `Sans nouvelles depuis ${j} j`;
    const pill = stale ? `<span class="pill alert">Relancé · sans réponse</span>`
      : r.statut === "relance" ? `<span class="pill amber">Relancé</span>` : `<span class="pill grey">Sollicité</span>`;
    return `<li class="relance-li">${avatar(r.organismes.nom)}
      <div class="relance-main">
        <div class="relance-name"><a href="#/fournisseurs/${r.organisme_id}">${esc(r.organismes.nom)}</a>${pill}</div>
        <div class="relance-when${stale ? " stale" : ""}">${esc(when)}${att ? ` · ${att} attendu${att > 1 ? "s" : ""}` : ""}</div>
      </div>
      <a class="btn small" href="#/fournisseurs/${r.organisme_id}">Relancer</a></li>`;
  }).join("");
  return `<section class="dash-panel alert">
    <div class="dash-panel-head"><div style="display:flex;align-items:center;gap:10px"><h2>À relancer</h2><span class="pill alert">${aRelancer.length}</span></div>
      <a class="link" href="#/fournisseurs">Tout voir →</a></div>
    <ul class="relance-ul">${items}</ul>
    ${aRelancer.length > 8 ? `<p class="mini">… et ${aRelancer.length - 8} autres.</p>` : ""}</section>`;
}

function contrepartiesPanel(cp) {
  if (!cp.length) return "";
  const items = cp.slice(0, 6).map((c) => `<li class="relance-li">
    <span class="avatar" aria-hidden="true" style="background:var(--accent-tint);color:var(--accent-dark)">★</span>
    <div class="relance-main"><div style="font-weight:700;font-size:15px">${esc(c.description || c.nature || "Contrepartie")}</div>
      <div class="muted" style="font-size:13.5px">${esc(c.beneficiaire || "")}</div></div></li>`).join("");
  return `<section class="dash-panel"><div class="dash-panel-head"><h2>Contreparties à honorer</h2>
      <a class="link" href="#/communication">Ouvrir →</a></div>
    <ul class="relance-ul">${items}</ul></section>`;
}

function draw(d) {
  const j = d.jeux;
  const jeuxCards = [
    kpiCard(j.total, "Jeux de l'édition", { sous: `${j.ludo} dans la ludothèque`, href: "#/jeux" }),
    kpiCard(j.souhaite, "À obtenir", { href: "#/jeux/obtenir" }),
    kpiCard(j.demande, "Demandés", { alerte: d.sansReponse > 0, sous: d.sansReponse ? `${d.sansReponse} sans réponse` : "", href: "#/jeux/obtenir" }),
    kpiCard(j.recu, "Obtenus", { href: "#/jeux/obtenir" }),
    kpiCard(j.manque, "Exemplaires manquants", { alerte: j.manque > 0, sous: j.manque > 0 ? "à compléter" : "à jour", href: "#/jeux" }),
  ].join("");
  const fourCards = [
    kpiCard(d.confirmes, "Confirmés", { sous: `sur ${d.editeurs.length} sollicités`, href: "#/fournisseurs" }),
    kpiCard(d.aRelancer.length, "À relancer", { alerte: d.aRelancer.length > 0, sous: "plus de 15 jours", href: "#/fournisseurs" }),
    kpiCard(d.sansReponse, "Sans réponse", { alerte: d.sansReponse > 0, sous: "relancés sans retour", href: "#/fournisseurs" }),
    kpiCard(d.cp.length, "Contreparties à honorer", { alerte: d.cp.length > 0, sous: d.cp.length ? "promesses faites" : "", href: "#/fournisseurs" }),
  ].join("");

  root.innerHTML = `
    <div class="page-head"><div>
      <div class="sub" style="text-transform:uppercase;letter-spacing:.06em;font-size:11px;color:var(--primary);font-weight:700">Édition en cours</div>
      <h1>${esc(d.nom)}</h1>
      <div class="sub">Voici où en est la préparation des jeux et des fournisseurs.</div>
    </div>
    <div class="head-actions">
      <a class="btn primary" href="#/jeux">+ Ajouter un jeu</a>
      <a class="btn" href="#/jeux">Scanner un code-barre</a>
      <a class="btn" href="#/fournisseurs">Solliciter un fournisseur</a>
    </div></div>

    <div class="dash-cols">
      <div class="dash-main">
        <section class="dash-sec"><div class="dash-sec-head"><h2>Les jeux</h2><a class="link" href="#/jeux">Voir tous les jeux →</a></div>
          <div class="kpi-row">${jeuxCards}</div>${pipeline(j)}</section>
        <section class="dash-sec"><div class="dash-sec-head"><h2>Les fournisseurs de jeux</h2><a class="link" href="#/fournisseurs">Voir tous les fournisseurs →</a></div>
          <div class="kpi-row">${fourCards}</div></section>
        <p class="mini">Bénévoles, buvette, plan des salles, communication… restent disponibles dans « Reste du festival », dans le menu.</p>
      </div>
      <div class="dash-side">${relancePanel(d.aRelancer, d.attendus)}${contrepartiesPanel(d.cp)}</div>
    </div>`;
}
