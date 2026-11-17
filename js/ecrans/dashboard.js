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

// Une tuile chiffre. `alerte` la teinte quand il y a une action à mener.
function kpi(val, label, alerte = false, sous = "") {
  return `<div class="kpi${alerte ? " alert" : ""}"><div class="kpi-val">${esc(String(val))}</div>
    <div class="kpi-lbl">${esc(label)}${sous ? `<br><span class="mini">${esc(sous)}</span>` : ""}</div></div>`;
}

// Barre d'avancement À obtenir → Demandé → Obtenu (segments proportionnels, vides masqués).
function pipeline(j) {
  const seg = (n, bg, col, lbl) => (n > 0
    ? `<div style="flex:${n};background:${bg};color:${col};padding:10px;text-align:center;white-space:nowrap">${n} ${esc(lbl)}</div>`
    : "");
  if (!(j.souhaite + j.demande + j.recu)) return "";
  return `<div class="card"><div class="dash-head"><h2 style="font-size:15px;margin:0">Les jeux à obtenir, étape par étape</h2>
      <a class="link" href="#/jeux/obtenir">Ouvrir le suivi →</a></div>
    <div style="display:flex;border-radius:8px;overflow:hidden;font-size:12px;font-weight:600;margin-top:10px">
      ${seg(j.souhaite, "var(--warn-bg)", "var(--warn)", "à obtenir")}
      ${seg(j.demande, "#DBEAFE", "#1E40AF", "demandés")}
      ${seg(j.recu, "var(--ok-bg)", "var(--ok)", "obtenus")}
    </div></div>`;
}

function relancesCard(aRelancer, attendus) {
  if (!aRelancer.length) return `<div class="card"><div class="dash-head"><h2>À relancer</h2>
    <a class="link" href="#/fournisseurs">Fournisseurs →</a></div><p class="muted">Personne à relancer. 👍</p></div>`;
  const rows = aRelancer.slice(0, 8).map((r) => {
    const j = joursDepuis(r.dernier_contact);
    const stale = r.statut === "relance" && (j ?? 999) > STALE;
    const att = attendus.get(r.organisme_id) || 0;
    const when = j == null ? "jamais contacté" : `Sans nouvelles depuis ${j} j`;
    return `<tr>
      <td><strong>${esc(r.organismes.nom)}</strong>${stale ? ` <span class="tag bad">sans réponse</span>` : r.statut === "relance" ? ` <span class="tag warn">relancé</span>` : ` <span class="tag">sollicité</span>`}</td>
      <td class="muted">${esc(when)}${att ? ` · ${att} attendu${att > 1 ? "s" : ""}` : ""}</td>
      <td style="text-align:right"><a class="btn small" href="#/fournisseurs">Relancer</a></td></tr>`;
  }).join("");
  return `<div class="card"><div class="dash-head"><h2>À relancer <span class="tag bad">${aRelancer.length}</span></h2>
      <a class="link" href="#/fournisseurs">Tout voir →</a></div>
    <div class="scroll"><table class="data-table"><tbody>${rows}</tbody></table></div>
    ${aRelancer.length > 8 ? `<p class="mini">… et ${aRelancer.length - 8} autres.</p>` : ""}</div>`;
}

function contrepartiesCard(cp) {
  if (!cp.length) return "";
  const rows = cp.slice(0, 6).map((c) => `<tr>
      <td><strong>${esc(c.description || c.nature || "Contrepartie")}</strong>
        <br><span class="muted">${esc(c.beneficiaire || "")}</span></td>
      <td style="text-align:right"><span class="tag warn">à honorer</span></td></tr>`).join("");
  return `<div class="card"><div class="dash-head"><h2>Contreparties à honorer <span class="tag warn">${cp.length}</span></h2>
      <a class="link" href="#/communication">Ouvrir →</a></div>
    <div class="scroll"><table class="data-table"><tbody>${rows}</tbody></table></div></div>`;
}

function draw(d) {
  const j = d.jeux;
  const jeuxKpis = [
    kpi(j.total, "Jeux de l'édition", false, `${j.ludo} dans la ludothèque`),
    kpi(j.souhaite, "À obtenir"),
    kpi(j.demande, "Demandés"),
    kpi(j.recu, "Obtenus"),
    kpi(j.manque, "Exemplaires manquants", j.manque > 0, j.aCompleter ? `${j.aCompleter} jeu${j.aCompleter > 1 ? "x" : ""} à compléter` : "À jour"),
  ].join("");
  const fourKpis = [
    kpi(d.confirmes, "Confirmés", false, `sur ${d.editeurs.length} sollicités`),
    kpi(d.aRelancer.length, "À relancer", d.aRelancer.length > 0),
    kpi(d.sansReponse, "Sans réponse", d.sansReponse > 0),
    kpi(d.cp.length, "Contreparties à honorer", d.cp.length > 0),
  ].join("");

  root.innerHTML = `
    <div class="page-head"><div>
      <div class="sub" style="text-transform:uppercase;letter-spacing:.06em;font-size:11px">Édition en cours</div>
      <h1>${esc(d.nom)}</h1>
      <div class="sub">Voici où en est la préparation des jeux et des fournisseurs.</div>
    </div></div>

    <div class="filters" style="margin-bottom:18px">
      <a class="btn primary" href="#/jeux">+ Ajouter un jeu</a>
      <a class="btn" href="#/jeux">Scanner un code-barre</a>
      <a class="btn" href="#/fournisseurs">Solliciter un fournisseur</a>
    </div>

    <section class="dash-section">
      <div class="dash-head"><h2 class="sect-title">Les jeux</h2><a class="link" href="#/jeux">Voir tous les jeux →</a></div>
      <div class="kpis">${jeuxKpis}</div>
      ${pipeline(j)}
    </section>

    <section class="dash-section" style="margin-top:18px">
      <div class="dash-head"><h2 class="sect-title">Les fournisseurs de jeux</h2><a class="link" href="#/fournisseurs">Voir tous les fournisseurs →</a></div>
      <div class="kpis">${fourKpis}</div>
    </section>

    <div class="dash-grid" style="margin-top:18px">
      ${relancesCard(d.aRelancer, d.attendus)}
      ${contrepartiesCard(d.cp)}
    </div>

    <p class="mini" style="margin-top:18px">Bénévoles, buvette, plan des salles, communication… restent disponibles dans
      « Reste du festival », dans le menu.</p>`;
}
