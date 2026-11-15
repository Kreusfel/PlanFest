// Écran #/jeux — tous les jeux, en un seul endroit.
//  - Onglet « Festival » : les jeux de l'édition (jeux de l'asso pris au tri + jeux
//    demandés aux éditeurs), filtres, alerte « sans animateur ».
//  - Onglet « Ludothèque de l'asso » : l'inventaire permanent, avec le choix
//    Oui / Bar à jeux / Non pour l'édition en un clic (ou « Trier rapidement »).
//  - Un seul ajout : on cherche d'abord dans nos jeux (pas de doublon), puis sur BGG ;
//    on dit si c'est un jeu de l'asso ou d'éditeur. Saisie à la main et CSV au même endroit.
//  - Une seule fiche par jeu : infos du jeu + bloc « Ce festival ».
// Le tri (ludotheque_choix) alimente la sélection par un déclencheur en base (migration 036).
// Sous-adresses : #/jeux/festival · #/jeux/ludo · #/jeux/<id organisme> (filtre éditeur).
import { supa } from "../supabase.js";
import { isAdmin, hasPole } from "../auth.js";
import { store } from "../store.js";
import { esc, plur, toast } from "../ui/util.js";
import { parseCSV, norm } from "../ui/csv.js";
import * as swipe from "./selection-swipe.js";

const STATUTS_EDITEUR = [["souhaite", "Souhaité"], ["demande", "Demandé"], ["recu", "Reçu"]];
const STATUT_PILL = { souhaite: "grey", demande: "amber", recu: "ok", deja_asso: "blue" };
const statutLbl = (k) => ({ souhaite: "Souhaité", demande: "Demandé", recu: "Reçu", deja_asso: "Déjà à l'asso" })[k] || k;
const USAGES = [["animation", "Animation"], ["bar", "Bar à jeux"], ["tombola", "Tombola"]];
const CHOIX = [["oui", "Oui", "ok"], ["bar", "Bar", "amber"], ["non", "Non", "grey"]];
const BGG = `<p class="mini bgg-foot">Données et images : <a href="https://boardgamegeek.com" target="_blank" rel="noopener">Powered by BGG</a></p>`;

let root, loadErr = "";
let jeux = new Map();      // catalogue : id → jeu
let sel = new Map();       // sélection de l'édition : jeu_id → ligne jeux_editions
let choix = new Map();     // tri de la ludothèque : jeu_id → oui | bar | non
let cats = [], orgs = [], comps = [], benes = [], beneIds = new Set(), tables = [];
let edIds = new Set(), edIdsIci = new Set();   // organismes éditeurs (toutes éditions / cette édition)
const bggEditeurs = new Map();                 // jeu_id → éditeurs proposés par BGG
let tab = "festival", mode = "list", ficheId = null;
let filt = { q: "", origine: "", usage: "", categorie: "", editeur: "", sansAnim: false };
let ludoQ = "", ludoNonDecides = false;
let ajout = { q: "", asso: false, prendre: true, bgg: null, msg: "" };
let csvMsg = "";

const canWrite = () => isAdmin() || hasPole("jeux_editeurs");
const catNom = (id) => cats.find((c) => c.id === id)?.nom || "—";
const orgNom = (id) => orgs.find((o) => o.id === id)?.nom || "—";
const beneNom = (id) => benes.find((b) => b.id === id)?.nom || "?";
const tableLabel = (id) => { const t = tables.find((x) => x.id === id); return t ? `Table ${t.numero || "?"}${t.salles?.nom ? " · " + t.salles.nom : ""}` : null; };
const usageLbl = (u) => (USAGES.find((x) => x[0] === u) || [u, u])[1];
const numOrNull = (v) => { const n = parseInt(v, 10); return isNaN(n) ? null : n; };
// Nom comparable (même règle que nom_comparable en base) : minuscules, sans accents ni ponctuation.
const comparable = (s) => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
const f = (l, inner) => `<label>${l}${inner}</label>`;
const meta = (j) => [(j.joueurs_min || j.joueurs_max) ? `${j.joueurs_min || "?"}–${j.joueurs_max || "?"} j.` : "",
  j.duree_min ? `${j.duree_min} min` : "", j.age_min ? `${j.age_min}+` : ""].filter(Boolean).join(" · ");

export async function render(container, sub = "") {
  root = container;
  mode = "list"; ficheId = null;
  tab = sub === "ludo" ? "ludo" : "festival";
  filt.editeur = sub && sub !== "ludo" && sub !== "festival" ? sub : "";
  if (!store.editionId) {
    root.innerHTML = `<div class="page-head"><div><h1>Jeux</h1><div class="sub">Aucune édition sélectionnée</div></div></div>
      <div class="card"><p><a class="btn primary" href="#/editions">Choisir une édition</a></p></div>`;
    return;
  }
  root.innerHTML = `<div class="card"><p class="muted">Chargement…</p></div>`;
  await load();
  wireOnce();
  go();
}

async function load() {
  loadErr = "";
  const ed = store.editionId;
  const [jx, je, ch, c, o, cp, be, el, oed] = await Promise.all([
    supa.from("jeux").select("*"),
    supa.from("jeux_editions").select("*").eq("edition_id", ed),
    supa.from("ludotheque_choix").select("jeu_id,choix").eq("edition_id", ed),
    supa.from("categories_jeux").select("id,nom,type,ordre").order("ordre"),
    supa.from("organismes").select("id,nom").order("nom"),
    supa.from("competences").select("benevole_id, jeu_id, categorie_id, niveau"),
    supa.from("benevoles_editions").select("benevole:benevoles(id,nom)").eq("edition_id", ed),
    supa.from("elements").select("id, numero, salle_id, salles(nom)").eq("edition_id", ed).eq("kind", "table"),
    supa.from("organisme_editions").select("organisme_id, edition_id").contains("roles", ["editeur"]),
  ]);
  if (jx.error || je.error) loadErr = (jx.error || je.error).message;
  jeux = new Map((jx.data ?? []).map((j) => [j.id, j]));
  sel = new Map((je.data ?? []).map((r) => [r.jeu_id, r]));
  choix = new Map((ch.data ?? []).map((r) => [r.jeu_id, r.choix]));
  cats = c.data ?? []; orgs = o.data ?? []; comps = cp.data ?? [];
  beneIds = new Set();
  benes = (be.data ?? []).map((x) => x.benevole).filter(Boolean).filter((b) => (beneIds.has(b.id) ? false : beneIds.add(b.id)));
  tables = (el.data ?? []).sort((a, b) => (parseInt(a.numero, 10) || 0) - (parseInt(b.numero, 10) || 0));
  edIds = new Set((oed.data ?? []).map((x) => x.organisme_id));
  edIdsIci = new Set((oed.data ?? []).filter((x) => x.edition_id === ed).map((x) => x.organisme_id));
}
// Après un changement du tri (le déclencheur en base ajoute / retire des jeux de la sélection).
async function rechargerSelection() {
  const { data } = await supa.from("jeux_editions").select("*").eq("edition_id", store.editionId);
  if (data) sel = new Map(data.map((r) => [r.jeu_id, r]));
}

/* ---------- animateurs (Compétences) ---------- */
function niveauFor(benevoleId, jeu) {
  const cj = comps.find((c) => c.benevole_id === benevoleId && c.jeu_id === jeu.id);
  if (cj) return cj.niveau;
  const cc = comps.find((c) => c.benevole_id === benevoleId && c.categorie_id && c.categorie_id === jeu.categorie_id);
  return cc ? cc.niveau : "non";
}
function animFor(jeu) {
  const seen = {}, anime = [], apprendre = [];
  comps.forEach((c) => {
    if (!beneIds.has(c.benevole_id) || c.benevole_id in seen) return;  // seulement l'édition courante
    const niv = niveauFor(c.benevole_id, jeu);
    if (niv === "anime" || niv === "apprendre") {
      seen[c.benevole_id] = niv;
      (niv === "anime" ? anime : apprendre).push(beneNom(c.benevole_id));
    }
  });
  return { anime, apprendre };
}
const estAnimation = (je) => (je.usages || []).includes("animation");
const sansAnimateur = (je) => estAnimation(je) && animFor(jeux.get(je.jeu_id) || {}).anime.length === 0;

/* ---------- éditeurs ---------- */
// Organismes ayant le rôle éditeur, un seul par nom (celui de cette édition de préférence).
function editeursListe() {
  const parNom = new Map();
  orgs.filter((o) => edIds.has(o.id)).forEach((o) => {
    const k = comparable(o.nom), cur = parNom.get(k);
    if (!cur || (!edIdsIci.has(cur.id) && edIdsIci.has(o.id))) parNom.set(k, o);
  });
  return [...parNom.values()].sort((a, b) => a.nom.localeCompare(b.nom, "fr"));
}
function editeurConnu(nomsBgg) {
  const connus = new Map(editeursListe().map((o) => [comparable(o.nom), o.id]));
  for (const n of nomsBgg || []) { const id = connus.get(comparable(n)); if (id) return id; }
  return null;
}
function editeurSel(id, attr, ro = "") {
  const opts = editeursListe();
  if (id && !opts.some((o) => o.id === id)) { const o = orgs.find((x) => x.id === id); if (o) opts.unshift(o); }
  return `<select ${attr}="editeur_id"${ro}><option value="">— éditeur —</option>${
    opts.map((o) => `<option value="${o.id}"${o.id === id ? " selected" : ""}>${esc(o.nom)}</option>`).join("")}</select>`;
}
function catSel(id, attr, ro = "") {
  return `<select ${attr}="categorie_id"${ro}><option value="">— catégorie —</option>${
    cats.map((c) => `<option value="${c.id}"${c.id === id ? " selected" : ""}>${esc(c.nom)}</option>`).join("")}</select>`;
}
// Catégorie suggérée depuis l'âge minimum (jamais imposée).
function suggestCat(age) {
  if (age == null) return null;
  const byNom = (n) => cats.find((c) => c.nom.toLowerCase().includes(n))?.id || null;
  if (age <= 3) return byNom("3+"); if (age <= 6) return byNom("6+");
  if (age <= 8) return byNom("8+"); return byNom("familial");
}

/* ---------- rendu ---------- */
function go() {
  root.innerHTML = mode === "fiche" ? ficheView()
    : mode === "ajout" ? ajoutView()
    : mode === "manuel" ? manuelView()
    : mode === "csv" ? csvView()
    : mode === "tri" ? triView()
    : listView();
  if (mode === "tri") { const m = root.querySelector("#tri-mount"); if (m) swipe.render(m); }
}

function entete() {
  const asso = [...sel.values()].filter((r) => jeux.get(r.jeu_id)?.ludotheque).length;
  const nsa = [...sel.values()].filter(sansAnimateur).length;
  const nLudo = [...jeux.values()].filter((j) => j.ludotheque).length;
  return `<div class="page-head"><div><h1>Jeux</h1>
      <div class="sub">${plur(sel.size, "jeu", "jeux")} au festival (${asso} de l'asso, ${sel.size - asso} d'éditeurs)${nsa ? ` · ${nsa} sans animateur` : ""} · ${plur(nLudo, "jeu", "jeux")} dans la ludothèque</div></div>
      <div class="head-actions">${canWrite() ? `<button class="btn primary" id="ajouter">+ Ajouter un jeu</button>` : ""}</div></div>
    <div class="utabs">
      <button data-tab="festival"${tab === "festival" ? ' class="on"' : ""}>Festival</button>
      <button data-tab="ludo"${tab === "ludo" ? ' class="on"' : ""}>Ludothèque de l'asso</button></div>`;
}
function listView() { return entete() + (tab === "ludo" ? ludoView() : festivalView()); }

/* ---------- onglet Festival ---------- */
function festivalFiltres() {
  const q = comparable(filt.q);
  return [...sel.values()].filter((je) => {
    const j = jeux.get(je.jeu_id); if (!j) return false;
    if (q && !comparable(j.titre).includes(q)) return false;
    if (filt.origine === "asso" && !j.ludotheque) return false;
    if (filt.origine === "editeur" && j.ludotheque) return false;
    if (filt.usage && !(je.usages || []).includes(filt.usage)) return false;
    if (filt.categorie && j.categorie_id !== filt.categorie) return false;
    if (filt.editeur && j.editeur_id !== filt.editeur) return false;
    if (filt.sansAnim && !sansAnimateur(je)) return false;
    return true;
  }).sort((a, b) => jeux.get(a.jeu_id).titre.localeCompare(jeux.get(b.jeu_id).titre, "fr"));
}
function carte(je) {
  const j = jeux.get(je.jeu_id), nbAnim = animFor(j).anime.length;
  const img = j.miniature_url || j.image_url;
  const origine = j.ludotheque ? `<span class="pill blue">Asso</span>`
    : `<span class="pill ${STATUT_PILL[je.statut] || "grey"}">${esc(j.editeur_id ? orgNom(j.editeur_id) : "Éditeur")} · ${esc(statutLbl(je.statut))}</span>`;
  const usages = (je.usages || []).map((u) => `<span class="pill grey">${esc(usageLbl(u))}</span>`).join(" ");
  const tbl = je.element_id ? esc(tableLabel(je.element_id) || "Table ?") : "Non placé";
  return `<div class="jeu-card" data-open="${j.id}">
    <div class="jeu-img">${img ? `<img src="${esc(img)}" alt="" loading="lazy">` : `<span>Pas d'image</span>`}</div>
    <b>${esc(j.titre)}${j.annee ? ` <span class="mini">(${j.annee})</span>` : ""}</b>
    <div class="jeu-pills">${origine} ${usages}</div>
    ${sansAnimateur(je) ? `<div><span class="pill alert">Aucun animateur</span></div>` : ""}
    <div class="jeu-foot">${estAnimation(je) ? plur(nbAnim, "animateur", "animateurs") + " · " : ""}${tbl}</div>
  </div>`;
}
function festivalView() {
  const grid = festivalFiltres().map(carte).join("")
    || `<p class="muted">${loadErr ? "Erreur : " + esc(loadErr) : sel.size ? "Aucun jeu pour ces filtres." : "Aucun jeu pour ce festival. Trie la ludothèque ou ajoute un jeu d'éditeur."}</p>`;
  const nsa = [...sel.values()].filter(sansAnimateur).length;
  const opt = (v, cur, l) => `<option value="${v}"${cur === v ? " selected" : ""}>${esc(l)}</option>`;
  const eIds = [...new Set([...sel.values()].map((r) => jeux.get(r.jeu_id)?.editeur_id).filter(Boolean))];
  return `<div class="card">
    <div class="jeux-filters">
      <input id="f-q" placeholder="Rechercher un titre…" value="${esc(filt.q)}" aria-label="Rechercher un titre">
      <select id="f-origine" aria-label="Origine">${opt("", filt.origine, "Asso et éditeurs")}${opt("asso", filt.origine, "Jeux de l'asso")}${opt("editeur", filt.origine, "Jeux d'éditeurs")}</select>
      <select id="f-usage" aria-label="Usage">${opt("", filt.usage, "Tous usages")}${USAGES.map(([k, l]) => opt(k, filt.usage, l)).join("")}</select>
      <select id="f-cat" aria-label="Catégorie">${opt("", filt.categorie, "Toutes catégories")}${cats.map((c) => opt(c.id, filt.categorie, c.nom)).join("")}</select>
      <select id="f-editeur" aria-label="Éditeur">${opt("", filt.editeur, "Tous éditeurs")}${eIds.map((id) => opt(id, filt.editeur, orgNom(id))).join("")}</select>
      <button class="btn small${filt.sansAnim ? " primary" : ""}" id="f-sansanim">Sans animateur (${nsa})</button>
    </div>
    <div class="jeux-grid">${grid}</div>
    ${BGG}</div>`;
}

/* ---------- onglet Ludothèque ---------- */
function ludoView() {
  const q = comparable(ludoQ), w = canWrite();
  const tous = [...jeux.values()].filter((j) => j.ludotheque);
  const nd = tous.filter((j) => !choix.has(j.id)).length;
  const rows = tous.filter((j) => (!q || comparable(j.titre).includes(q)) && (!ludoNonDecides || !choix.has(j.id)))
    .sort((a, b) => a.titre.localeCompare(b.titre, "fr")).map((j) => {
      const img = j.miniature_url || j.image_url, cur = choix.get(j.id);
      const btns = CHOIX.map(([k, l, cls]) => `<button class="niv${cur === k ? " on " + cls : ""}" aria-pressed="${cur === k}" data-choix="${j.id}|${k}"${w ? "" : " disabled"}>${l}</button>`).join("");
      return `<tr>
        <td class="clk" data-open="${j.id}"><div class="ludo-cell"><span class="ludo-thumb">${img ? `<img src="${esc(img)}" alt="" loading="lazy">` : ""}</span>
          <span><b>${esc(j.titre)}</b>${j.annee ? ` <span class="muted">(${j.annee})</span>` : ""}</span></div></td>
        <td class="muted">${esc(catNom(j.categorie_id))}</td>
        <td class="muted">${esc(meta(j) || "—")}</td>
        <td><div class="niv-grp" role="group" aria-label="Pour ce festival">${btns}</div></td></tr>`;
    }).join("") || `<tr><td colspan="4" class="muted">${tous.length ? "Aucun jeu pour cette recherche." : "La ludothèque est vide : « + Ajouter un jeu » ou import CSV."}</td></tr>`;
  const c = { oui: 0, bar: 0, non: 0 }; for (const v of choix.values()) if (v in c) c[v]++;
  return `<div class="card">
    <div class="filters">
      <input id="l-q" class="grow" placeholder="Rechercher un titre…" value="${esc(ludoQ)}" aria-label="Rechercher dans la ludothèque">
      <button class="btn small${ludoNonDecides ? " primary" : ""}" id="l-nd">Non décidés (${nd})</button>
      ${w ? `<button class="btn small" id="l-tri">Trier rapidement</button><button class="btn small" id="l-csv">Import CSV</button>` : ""}
    </div>
    <p class="mini">Pour ce festival : <b>${c.oui}</b> oui · <b>${c.bar}</b> bar à jeux · <b>${c.non}</b> non. « Oui » et « Bar » ajoutent le jeu à l'onglet Festival.</p>
    <div class="scroll"><table class="data-table">
      <thead><tr><th>Jeu</th><th>Catégorie</th><th>Détails</th><th>Ce festival</th></tr></thead>
      <tbody>${rows}</tbody></table></div></div>`;
}
function triView() {
  return `<div class="page-head"><div><h1>Trier la ludothèque</h1><div class="sub">Un jeu après l'autre, pour ce festival</div></div>
    <div class="head-actions"><button class="btn" id="retour">← Ludothèque</button></div></div><div id="tri-mount"></div>`;
}

/* ---------- ajout ---------- */
// Jeux du catalogue dont le titre ressemble à la recherche (ou au même numéro BGG).
function trouvesLocaux() {
  const q = comparable(ajout.q);
  const bggIds = new Set((ajout.bgg || []).map((r) => r.bgg_id).filter(Boolean));
  if (!q && !bggIds.size) return [];
  return [...jeux.values()].filter((j) => (q.length >= 2 && comparable(j.titre).includes(q)) || (j.bgg_id && bggIds.has(j.bgg_id)))
    .sort((a, b) => a.titre.localeCompare(b.titre, "fr")).slice(0, 12);
}
function etatLocal(j) {
  const je = sel.get(j.id);
  if (je) return { txt: "Déjà au festival", btn: `<button class="btn small" data-open="${j.id}">Ouvrir</button>` };
  return { txt: j.ludotheque ? "Dans la ludothèque, pas encore pris pour ce festival" : "Déjà connu (jeu d'éditeur), pas dans ce festival",
    btn: `<button class="btn small primary" data-aufestival="${j.id}">Ajouter au festival</button><button class="btn small" data-open="${j.id}">Ouvrir</button>` };
}
function ajoutView() {
  const locaux = trouvesLocaux(), dejaBgg = new Set(locaux.map((j) => j.bgg_id).filter(Boolean));
  const loc = locaux.length ? `<h3>Déjà chez nous</h3><div class="list">${locaux.map((j) => {
    const e = etatLocal(j), img = j.miniature_url || j.image_url;
    return `<div class="row"><div class="bgg-thumb">${img ? `<img src="${esc(img)}" alt="">` : ""}</div>
      <div class="row-main"><b>${esc(j.titre)}${j.annee ? ` <span class="mini">(${j.annee})</span>` : ""}</b>
        <span class="muted">${j.ludotheque ? "Asso" : "Éditeur" + (j.editeur_id ? " · " + esc(orgNom(j.editeur_id)) : "")} · ${esc(e.txt)}</span></div>
      <div class="actions">${e.btn}</div></div>`;
  }).join("")}</div>` : "";
  const bgg = ajout.bgg == null ? "" : (() => {
    const res = ajout.bgg.filter((r) => !dejaBgg.has(r.bgg_id));
    return `<h3>Sur BoardGameGeek</h3>` + (res.length ? `<div class="list">${res.map((r, i) => `<div class="row">
        <div class="bgg-thumb">${r.miniature_url ? `<img src="${esc(r.miniature_url)}" alt="">` : ""}</div>
        <div class="row-main"><b>${esc(r.titre)}${r.annee ? ` <span class="mini">(${r.annee})</span>` : ""}</b>
          <span class="muted">${esc(meta(r) || "—")}${(r.editeurs || []).length ? " · " + esc(r.editeurs[0]) : ""}</span></div>
        <div class="actions"><button class="btn small primary" data-bgg="${ajout.bgg.indexOf(r)}">Ajouter</button></div></div>`).join("")}</div>`
      : `<p class="muted">Rien de plus sur BGG.</p>`);
  })();
  return `<div class="page-head"><div><h1>Ajouter un jeu</h1><div class="sub">On cherche d'abord dans nos jeux, puis sur BGG</div></div>
    <div class="head-actions"><button class="btn" id="retour">← Jeux</button></div></div>
    <div class="card" style="max-width:820px">
      ${origineChoix("a")}
      <form id="a-form" class="jeux-filters">
        <input id="a-q" placeholder="Nom du jeu…" value="${esc(ajout.q)}" aria-label="Nom du jeu" autocomplete="off">
        <button class="btn primary" type="submit">Chercher sur BGG</button>
      </form>
      <p class="msg" id="a-msg">${esc(ajout.msg)}</p>
      <div id="a-res">${loc}${bgg}</div>
      <hr>
      <div class="filters"><span class="mini">Introuvable ?</span>
        <button class="btn small" id="to-manuel">Saisir à la main</button>
        <button class="btn small" id="to-csv">Import CSV (ludothèque)</button></div>
      ${BGG}</div>`;
}
// Choix « jeu de l'asso / jeu d'éditeur » (+ « le prendre pour ce festival »), commun à
// la recherche et à la saisie à la main. Préfixe = a (ajout) ou m (manuel).
function origineChoix(p) {
  return `<div class="champ-groupe"><span class="lbl">Ce jeu est…</span><div class="chk-row">
      <span class="chk-inline"><input type="radio" name="${p}-origine" value="asso"${ajout.asso ? " checked" : ""} data-origine> un jeu de l'asso (ludothèque)</span>
      <span class="chk-inline"><input type="radio" name="${p}-origine" value="editeur"${ajout.asso ? "" : " checked"} data-origine> un jeu d'éditeur, demandé pour ce festival</span></div>
    ${ajout.asso ? `<span class="chk-inline"><input type="checkbox" id="${p}-prendre"${ajout.prendre ? " checked" : ""} data-prendre> Le prendre pour ce festival</span>` : ""}</div>`;
}
function manuelView() {
  return `<div class="page-head"><div><h1>Saisir un jeu à la main</h1><div class="sub">Sans BGG</div></div>
    <div class="head-actions"><button class="btn" id="to-ajout">← Recherche</button></div></div>
    <div class="card" style="max-width:620px">
      ${origineChoix("m")}
      ${f("Titre", `<input data-m="titre" placeholder="Nom du jeu" value="${esc(ajout.q)}">`)}
      <div class="row2">${f("Année", `<input type="number" data-m="annee">`)}${f("Catégorie", catSel(null, "data-m"))}</div>
      ${ajout.asso ? "" : f("Éditeur", editeurSel(null, "data-m"))}
      <div class="row2">${f("Joueurs min", `<input type="number" data-m="joueurs_min">`)}${f("Joueurs max", `<input type="number" data-m="joueurs_max">`)}</div>
      <div class="row2">${f("Durée (min)", `<input type="number" data-m="duree_min">`)}${f("Âge min", `<input type="number" data-m="age_min">`)}</div>
      ${f("Image (lien)", `<input data-m="image_url" placeholder="https://…">`)}
      <button class="btn primary" id="m-create">Ajouter</button>
      <p class="msg" id="m-msg"></p>
    </div>`;
}
function csvView() {
  return `<div class="page-head"><div><h1>Import CSV</h1><div class="sub">Ajout en masse dans la ludothèque de l'asso</div></div>
    <div class="head-actions"><button class="btn" id="retour">← Jeux</button></div></div>
    <div class="card" style="max-width:720px">
      <label>Fichier CSV<input type="file" id="csv-file" accept=".csv,text/csv"></label>
      <label>… ou colle le contenu<textarea id="csv-text" rows="7" placeholder="titre,annee,categorie,joueurs_min,joueurs_max,duree_min,age_min,image_url"></textarea></label>
      <div class="head-actions" style="justify-content:flex-start"><button class="btn primary" id="csv-go">Importer</button>
        <button class="btn small" id="csv-tpl">Télécharger un modèle</button></div>
      <p class="msg" id="csv-msg">${esc(csvMsg)}</p>
      <hr>
      <p class="mini"><b>Colonnes reconnues</b> (1ʳᵉ ligne = en-têtes, seul <b>titre</b> est obligatoire) :
        titre · annee · categorie (nom exact) · joueurs_min · joueurs_max · duree_min · age_min · image_url · bgg_id.
        Un jeu déjà connu (même titre, ou même numéro BGG) n'est pas recréé : il est simplement marqué « jeu de l'asso ».</p>
    </div>`;
}

/* ---------- fiche ---------- */
function ficheView() {
  const j = jeux.get(ficheId);
  if (!j) { mode = "list"; return listView(); }
  const je = sel.get(j.id), w = canWrite(), ro = w ? "" : " disabled";
  const img = j.image_url || j.miniature_url;
  return `<div class="page-head"><div><h1>${esc(j.titre)}</h1>
    <div class="sub">${j.ludotheque ? "Jeu de l'asso" : "Jeu d'éditeur" + (j.editeur_id ? " · " + esc(orgNom(j.editeur_id)) : "")} · ${je ? "au festival" : "pas dans ce festival"}</div></div>
    <div class="head-actions"><button class="btn" id="retour">← Jeux</button>${w ? `<button class="btn primary" id="save">Enregistrer</button>` : ""}</div></div>
    <div class="two">
      <div class="l card"><h2>Le jeu</h2>
        <div class="jeu-fiche-top">
          <div class="jeu-img sm">${img ? `<img src="${esc(img)}" alt="">` : `<span>Pas d'image</span>`}</div>
          <div class="jeu-fiche-meta">
            ${j.bgg_id ? `<span class="pill ok">Importé de BGG</span>
              <a class="link" href="https://boardgamegeek.com/boardgame/${esc(String(j.bgg_id))}" target="_blank" rel="noopener">Voir la fiche sur BGG</a>
              ${w ? `<button class="btn small" id="bgg-update">Mettre à jour depuis BGG</button>` : ""}` : `<span class="mini">Saisi à la main</span>`}
          </div>
        </div>
        <span class="chk-inline"><input type="checkbox" data-jbool="ludotheque"${j.ludotheque ? " checked" : ""}${ro}> Jeu de l'asso (dans la ludothèque)</span>
        ${f("Titre", `<input data-j="titre" value="${esc(j.titre)}"${ro}>`)}
        <div class="row2">${f("Année", `<input type="number" data-j="annee" value="${j.annee ?? ""}"${ro}>`)}${f("Catégorie", catSel(j.categorie_id, "data-j", ro))}</div>
        <label>Éditeur<div class="with-link">${editeurSel(j.editeur_id, "data-j", ro)}${j.editeur_id ? `<a class="link" href="#/organismes/editeurs">Voir la fiche</a>` : ""}</div></label>
        ${w ? ajoutEditeur(j) : ""}
        <div class="row2">${f("Joueurs min", `<input type="number" data-j="joueurs_min" value="${j.joueurs_min ?? ""}"${ro}>`)}${f("Joueurs max", `<input type="number" data-j="joueurs_max" value="${j.joueurs_max ?? ""}"${ro}>`)}</div>
        <div class="row2">${f("Durée (min)", `<input type="number" data-j="duree_min" value="${j.duree_min ?? ""}"${ro}>`)}${f("Âge min", `<input type="number" data-j="age_min" value="${j.age_min ?? ""}"${ro}>`)}</div>
        ${j.bgg_id ? "" : f("Image (lien)", `<input data-j="image_url" value="${esc(j.image_url || "")}" placeholder="https://…"${ro}>`)}
        ${w ? `<button class="btn small danger" id="suppr-jeu" style="margin-top:10px">Supprimer ce jeu du catalogue</button>` : ""}
        ${BGG}
      </div>
      <div class="r">${je ? blocFestival(j, je, ro) : `<div class="card"><h2>Ce festival</h2>
          <p class="muted">Ce jeu n'est pas prévu pour ce festival.</p>
          ${w ? `<button class="btn primary" data-aufestival="${j.id}">Ajouter au festival</button>` : ""}</div>`}</div>
    </div>
    <p class="msg" id="j-msg"></p>`;
}
function blocFestival(j, je, ro) {
  const a = animFor(j);
  const tOpts = `<option value="">— non placé —</option>` + tables.map((t) => `<option value="${t.id}"${t.id === je.element_id ? " selected" : ""}>Table ${esc(t.numero || "?")}${t.salles?.nom ? " · " + esc(t.salles.nom) : ""}</option>`).join("");
  const animRows = (a.anime.map((n) => `<div class="anim-row"><span>${esc(n)}</span><span class="pill ok">Anime</span></div>`).join("")
    + a.apprendre.map((n) => `<div class="anim-row"><span>${esc(n)}</span><span class="pill amber">Veut apprendre</span></div>`).join(""))
    || `<p class="muted">Personne n'a encore répondu pour ce jeu.</p>`;
  const statut = j.ludotheque ? `<div class="champ-groupe"><span class="lbl">Statut</span><span class="pill blue">Jeu de l'asso</span></div>`
    : f("Statut (demande à l'éditeur)", `<select data-e="statut"${ro}>${STATUTS_EDITEUR.map(([k, l]) => `<option value="${k}"${k === je.statut ? " selected" : ""}>${l}</option>`).join("")}</select>`);
  return `<div class="card"><h2>Ce festival</h2>
      <div class="row2">${statut}${f("Exemplaires", `<input type="number" min="1" data-e="exemplaires" value="${je.exemplaires ?? 1}"${ro}>`)}</div>
      <div class="champ-groupe"><span class="lbl">Usages</span><div class="chk-row">${USAGES.map(([k, l]) => `<span class="chk-inline"><input type="checkbox" data-usage="${k}"${(je.usages || []).includes(k) ? " checked" : ""}${ro}> ${l}</span>`).join("")}</div></div>
      <label>Table (plan)<div class="with-link"><select data-e="element_id"${ro}>${tOpts}</select><a class="link" href="#/plan">Voir sur le plan</a></div></label>
      ${f("Notes", `<textarea data-e="notes"${ro}>${esc(je.notes || "")}</textarea>`)}
      ${ro ? "" : `<button class="btn small danger" id="retirer">Retirer du festival</button>`}
    </div>
    ${estAnimation(je) ? `<div class="card"><h2>Animateurs</h2>${animRows}
      <p class="mini">Réponses données dans Compétences / Mes compétences.</p></div>` : ""}`;
}
// Éditeur absent de la liste : noms proposés par BGG, ou saisie libre (réutilise un
// organisme du même nom, migration 043).
function ajoutEditeur(j) {
  const bgg = bggEditeurs.get(j.id) || [];
  const rapides = !j.editeur_id && bgg.length
    ? `<div class="chk-row">${bgg.slice(0, 6).map((n) => `<button type="button" class="btn small" data-addeditor="${esc(n)}">+ ${esc(n)}</button>`).join("")}</div>` : "";
  return `<details class="pub-editor"${!j.editeur_id && bgg.length ? " open" : ""}><summary>Éditeur absent de la liste ?</summary>
    ${bgg.length ? `<p class="mini">Éditeurs indiqués par BGG (l'éditeur d'origine d'abord) :</p>${rapides}` : ""}
    <div class="filters" style="align-items:flex-end">
      <label>Nom de l'éditeur<input id="new-ed" list="bgg-ed-dl" placeholder="ex. Asmodee"></label>
      <datalist id="bgg-ed-dl">${bgg.map((n) => `<option value="${esc(n)}">`).join("")}</datalist>
      <button type="button" class="btn small primary" id="new-ed-go">Ajouter comme éditeur</button>
    </div>
    <p class="mini">Il est ajouté aux éditeurs de cette édition (statut « À contacter ») et rattaché à ce jeu.</p></details>`;
}

/* ---------- câblage ---------- */
function wireOnce() {
  if (root.__jeuxWired) return;
  root.__jeuxWired = true;
  root.addEventListener("click", onClick);
  root.addEventListener("input", onInput);
  root.addEventListener("change", onChange);
  root.addEventListener("submit", onSubmit);
}
const msgEl = () => root.querySelector("#j-msg") || root.querySelector("#a-msg") || root.querySelector("#m-msg");
const dire = (t) => { const m = msgEl(); if (m) m.textContent = t; };

async function onClick(e) {
  const t = e.target;
  const tb = t.closest("[data-tab]");
  if (tb) { tab = tb.dataset.tab; mode = "list"; return go(); }
  if (t.closest("#retour")) {
    if (mode === "tri") { await load(); tab = "ludo"; }  // le tri a pu changer la sélection
    mode = "list"; return go();
  }
  if (t.closest("#ajouter")) { ajout = { q: "", asso: tab === "ludo", prendre: true, bgg: null, msg: "" }; mode = "ajout"; return go(); }
  if (t.closest("#to-manuel")) { mode = "manuel"; return go(); }
  if (t.closest("#to-ajout")) { mode = "ajout"; return go(); }
  if (t.closest("#to-csv") || t.closest("#l-csv")) { csvMsg = ""; mode = "csv"; return go(); }
  if (t.closest("#l-tri")) { mode = "tri"; return go(); }
  if (t.closest("#l-nd")) { ludoNonDecides = !ludoNonDecides; return go(); }
  if (t.closest("#f-sansanim")) { filt.sansAnim = !filt.sansAnim; return go(); }
  if (t.closest("#m-create")) return creerManuel();
  if (t.closest("#csv-go")) return importCsv();
  if (t.closest("#csv-tpl")) return modeleCsv();
  if (t.closest("#save")) return enregistrer();
  if (t.closest("#bgg-update")) return majBgg();
  if (t.closest("#retirer")) return retirerDuFestival(jeux.get(ficheId));
  if (t.closest("#suppr-jeu")) return supprimerJeu(jeux.get(ficheId));
  if (t.closest("#new-ed-go")) return ajouterEditeur(root.querySelector("#new-ed")?.value);
  const b = t.closest("[data-choix],[data-aufestival],[data-bgg],[data-addeditor],[data-open]");
  if (!b) return;
  if (b.dataset.choix) { const [id, c] = b.dataset.choix.split("|"); return choisir(id, c); }
  if (b.dataset.aufestival) return ajouterAuFestival(jeux.get(b.dataset.aufestival));
  if (b.dataset.bgg != null) return ajouterDepuisBgg(ajout.bgg?.[+b.dataset.bgg]);
  if (b.dataset.addeditor) return ajouterEditeur(b.dataset.addeditor);
  if (b.dataset.open) { ficheId = b.dataset.open; mode = "fiche"; window.scrollTo(0, 0); return go(); }
}
function onInput(e) {
  const t = e.target;
  if (t.id === "f-q") { filt.q = t.value; return majPartielle(".jeux-grid", festivalView); }
  if (t.id === "l-q") { ludoQ = t.value; return majPartielle(".data-table", ludoView); }
  if (t.id === "a-q") { ajout.q = t.value; return majPartielle("#a-res", ajoutView); }
}
// Ne redessine qu'une partie (la saisie en cours garde le curseur).
function majPartielle(sel, vue) {
  const box = root.querySelector(sel); if (!box) return;
  const tmp = document.createElement("div"); tmp.innerHTML = vue();
  const neuf = tmp.querySelector(sel); if (neuf) box.replaceWith(neuf);
}
function onChange(e) {
  const t = e.target;
  if (t.id === "f-origine") { filt.origine = t.value; return go(); }
  if (t.id === "f-usage") { filt.usage = t.value; return go(); }
  if (t.id === "f-cat") { filt.categorie = t.value; return go(); }
  if (t.id === "f-editeur") { filt.editeur = t.value; return go(); }
  if (t.matches("[data-origine]")) {
    ajout.asso = t.value === "asso";
    // Garder ce qui a été tapé dans le formulaire manuel.
    if (mode === "manuel") ajout.q = root.querySelector('[data-m="titre"]')?.value || ajout.q;
    return go();
  }
  if (t.matches("[data-prendre]")) { ajout.prendre = t.checked; return; }
  if (t.id === "csv-file") { const fl = t.files[0]; if (fl) fl.text().then((x) => { const ta = root.querySelector("#csv-text"); if (ta) ta.value = x; }); }
}
function onSubmit(e) {
  if (e.target.id !== "a-form") return;
  e.preventDefault();
  chercherBgg();
}

/* ---------- actions ---------- */
async function choisir(jeuId, c) {
  if (!canWrite()) return toast("Réservé au pôle Jeux & éditeurs.");
  const { error } = await supa.from("ludotheque_choix")
    .upsert({ edition_id: store.editionId, jeu_id: jeuId, choix: c }, { onConflict: "edition_id,jeu_id" });
  if (error) return toast("Erreur : " + error.message);  // ex. jeu programmé dans une partie
  choix.set(jeuId, c);
  await rechargerSelection();
  go();
}

// Ajoute un jeu connu à ce festival : jeu de l'asso → tri « Oui » ; jeu d'éditeur → « Souhaité ».
async function ajouterAuFestival(j) {
  if (!j || sel.has(j.id)) return;
  if (j.ludotheque) return choisir(j.id, "oui");
  const { data, error } = await supa.from("jeux_editions")
    .insert({ jeu_id: j.id, edition_id: store.editionId, statut: "souhaite", usages: ["animation"] }).select().single();
  if (error) return toast("Erreur : " + error.message);
  sel.set(j.id, data);
  go();
}
async function retirerDuFestival(j) {
  const je = j && sel.get(j.id); if (!je) return;
  if (j.ludotheque) return choisir(j.id, "non");  // refusé en base s'il est programmé
  const { count } = await supa.from("parties").select("id", { count: "exact", head: true }).eq("jeu_edition_id", je.id);
  if (count) return toast(`Ce jeu est programmé dans ${count} partie(s) : retire-le d'abord des Animations.`);
  if (!confirm(`Retirer « ${j.titre} » de ce festival ? (Le jeu reste dans le catalogue.)`)) return;
  const { error } = await supa.from("jeux_editions").delete().eq("id", je.id);
  if (error) return toast("Erreur : " + error.message);
  sel.delete(j.id);
  go();
}
async function supprimerJeu(j) {
  if (!j) return;
  if (!confirm(`Supprimer « ${j.titre} » du catalogue ?\n\nIl disparaît de la ludothèque et de toutes les éditions (les parties prévues gardent leur créneau, sans jeu). Irréversible.`)) return;
  const { error } = await supa.from("jeux").delete().eq("id", j.id);
  if (error) return toast("Erreur : " + error.message);
  jeux.delete(j.id); sel.delete(j.id); choix.delete(j.id);
  mode = "list"; go();
}

// Après création d'un jeu : selon l'origine, le prendre pour le festival.
async function apresCreation(j) {
  jeux.set(j.id, j);
  if (sel.has(j.id)) { /* déjà au festival */ }
  else if (j.ludotheque && ajout.prendre) await choisir(j.id, "oui");
  else if (!j.ludotheque) await ajouterAuFestival(j);
  ficheId = j.id; mode = "fiche"; go();
}

async function chercherBgg() {
  const q = ajout.q.trim();
  if (!q) { ajout.msg = "Saisis un nom de jeu."; return go(); }
  dire("Recherche sur BGG…");
  const { data, error } = await supa.functions.invoke("bgg-import", { body: { action: "search", query: q } });
  if (error || data?.error) { ajout.bgg = []; ajout.msg = "BGG indisponible pour le moment : « Saisir à la main »."; return go(); }
  ajout.bgg = data?.results ?? [];
  ajout.msg = ajout.bgg.length ? "" : "Aucun résultat sur BGG : « Saisir à la main ».";
  go();
}
async function ajouterDepuisBgg(r) {
  if (!r) return;
  // Déjà au catalogue (même numéro BGG) : on le reprend.
  const existant = [...jeux.values()].find((j) => j.bgg_id && j.bgg_id === r.bgg_id);
  if (existant) {
    if (ajout.asso && !existant.ludotheque) {
      const { error } = await supa.from("jeux").update({ ludotheque: true }).eq("id", existant.id);
      if (error) return toast("Erreur : " + error.message);
      existant.ludotheque = true;
    }
    return apresCreation(existant);
  }
  dire("Ajout…");
  const { data: j, error } = await supa.from("jeux").insert({
    bgg_id: r.bgg_id, titre: r.titre, annee: r.annee, image_url: r.image_url, miniature_url: r.miniature_url,
    joueurs_min: r.joueurs_min, joueurs_max: r.joueurs_max, duree_min: r.duree_min, age_min: r.age_min,
    categorie_id: suggestCat(r.age_min), editeur_id: editeurConnu(r.editeurs), ludotheque: ajout.asso,
  }).select().single();
  if (error) { ajout.msg = "Erreur : " + error.message; return go(); }
  bggEditeurs.set(j.id, r.editeurs || []);
  return apresCreation(j);
}
async function creerManuel() {
  const g = (k) => root.querySelector(`[data-m="${k}"]`);
  const titre = (g("titre").value || "").trim();
  if (!titre) return dire("Titre requis.");
  const meme = [...jeux.values()].find((j) => comparable(j.titre) === comparable(titre));
  if (meme) {
    root.querySelector("#m-msg").innerHTML = `« ${esc(meme.titre)} » existe déjà. <button class="btn small" data-open="${meme.id}">Ouvrir sa fiche</button>`;
    return;
  }
  const img = (g("image_url").value || "").trim();
  const { data: j, error } = await supa.from("jeux").insert({
    titre, annee: numOrNull(g("annee").value),
    joueurs_min: numOrNull(g("joueurs_min").value), joueurs_max: numOrNull(g("joueurs_max").value),
    duree_min: numOrNull(g("duree_min").value), age_min: numOrNull(g("age_min").value),
    categorie_id: g("categorie_id").value || suggestCat(numOrNull(g("age_min").value)),
    editeur_id: g("editeur_id")?.value || null,
    image_url: /^https?:\/\//i.test(img) ? img : null, ludotheque: ajout.asso,
  }).select().single();
  if (error) return dire("Erreur : " + error.message);
  return apresCreation(j);
}

async function majBgg() {
  const j = jeux.get(ficheId); if (!j?.bgg_id) return;
  dire("Mise à jour depuis BGG…");
  const { data, error } = await supa.functions.invoke("bgg-import", { body: { action: "thing", bgg_id: j.bgg_id } });
  if (error || !data || data.error) return dire("BGG indisponible.");
  const patch = { titre: data.titre || j.titre, annee: data.annee, image_url: data.image_url,
    miniature_url: data.miniature_url, joueurs_min: data.joueurs_min, joueurs_max: data.joueurs_max,
    duree_min: data.duree_min, age_min: data.age_min };
  bggEditeurs.set(j.id, data.editeurs || []);
  if (!j.editeur_id) { const id = editeurConnu(data.editeurs); if (id) patch.editeur_id = id; }
  const { error: e2 } = await supa.from("jeux").update(patch).eq("id", j.id);
  if (e2) return dire("Erreur : " + e2.message);
  Object.assign(j, patch); go();
}

async function ajouterEditeur(nom) {
  nom = (nom || "").trim();
  const j = jeux.get(ficheId); if (!j || !nom) return;
  dire("Ajout de l'éditeur…");
  const { data, error } = await supa.rpc("ajouter_organisme", { p_edition: store.editionId, p_nom: nom, p_roles: ["editeur"], p_infos: {} });
  if (error) return dire("Erreur : " + error.message);
  const orgId = data.organisme_id;
  const { error: e2 } = await supa.from("jeux").update({ editeur_id: orgId }).eq("id", j.id);
  if (e2) return dire("Erreur : " + e2.message);
  j.editeur_id = orgId;
  if (!orgs.some((o) => o.id === orgId)) orgs.push({ id: orgId, nom });
  edIds.add(orgId); edIdsIci.add(orgId);
  // Mise à jour sur place : les autres champs en cours de saisie sont gardés.
  const s = root.querySelector('[data-j="editeur_id"]'); if (s) s.outerHTML = editeurSel(orgId, "data-j");
  root.querySelector(".pub-editor")?.removeAttribute("open");
  dire(data.existait ? `Éditeur existant « ${orgNom(orgId)} » rattaché au jeu.` : `Éditeur « ${nom} » ajouté et rattaché au jeu.`);
}

async function enregistrer() {
  const j = jeux.get(ficheId); if (!j) return;
  const je = sel.get(j.id);
  const g = (k) => root.querySelector(`[data-j="${k}"]`), e = (k) => root.querySelector(`[data-e="${k}"]`);
  const titre = (g("titre").value || "").trim();
  if (!titre) return dire("Titre requis.");
  dire("Enregistrement…");
  const asso = !!root.querySelector('[data-jbool="ludotheque"]')?.checked;
  const jPatch = { titre, annee: numOrNull(g("annee").value),
    joueurs_min: numOrNull(g("joueurs_min").value), joueurs_max: numOrNull(g("joueurs_max").value),
    duree_min: numOrNull(g("duree_min").value), age_min: numOrNull(g("age_min").value),
    categorie_id: g("categorie_id").value || null, editeur_id: g("editeur_id").value || null, ludotheque: asso };
  const imgIn = g("image_url");
  if (imgIn) { const v = imgIn.value.trim(); jPatch.image_url = /^https?:\/\//i.test(v) ? v : null; }
  let ePatch = null;
  if (je) {
    const usages = [...root.querySelectorAll("[data-usage]")].filter((c) => c.checked).map((c) => c.dataset.usage);
    // Jeu de l'asso : statut « Déjà à l'asso » ; jeu d'éditeur : statut choisi (Souhaité par défaut).
    const st = e("statut")?.value;
    ePatch = { statut: asso ? "deja_asso" : (st && st !== "deja_asso" ? st : "souhaite"),
      exemplaires: numOrNull(e("exemplaires").value) || 1, usages: usages.length ? usages : ["animation"],
      element_id: e("element_id").value || null, notes: e("notes").value || null };
  }
  const [r1, r2] = await Promise.all([
    supa.from("jeux").update(jPatch).eq("id", j.id),
    je ? supa.from("jeux_editions").update(ePatch).eq("id", je.id) : Promise.resolve({ error: null }),
  ]);
  if (r1.error || r2.error) return dire("Erreur : " + (r1.error || r2.error).message);
  // Jeu devenu « de l'asso » et présent au festival : le tri le reflète (Oui ou Bar).
  if (asso && je && !choix.has(j.id)) {
    const c = ePatch.usages.includes("bar") && !ePatch.usages.includes("animation") ? "bar" : "oui";
    const { error } = await supa.from("ludotheque_choix").upsert({ edition_id: store.editionId, jeu_id: j.id, choix: c }, { onConflict: "edition_id,jeu_id" });
    if (!error) choix.set(j.id, c);
  }
  // Éditeur choisi parmi ceux d'une édition passée : l'inscrire aussi sur celle-ci.
  if (jPatch.editeur_id && !edIdsIci.has(jPatch.editeur_id)) {
    const { error } = await supa.rpc("ajouter_organisme", { p_edition: store.editionId, p_nom: orgNom(jPatch.editeur_id), p_roles: ["editeur"], p_infos: {} });
    if (!error) edIdsIci.add(jPatch.editeur_id);
  }
  Object.assign(j, jPatch); if (je) Object.assign(je, ePatch);
  mode = "list"; go();
  toast("Jeu enregistré.", "ok");
}

/* ---------- CSV (ludothèque) ---------- */
const COLS = {
  titre: ["titre", "nom", "name", "title"], annee: ["annee", "year", "yearpublished"],
  categorie: ["categorie", "category", "cat"], joueurs_min: ["joueursmin", "min", "minplayers"],
  joueurs_max: ["joueursmax", "max", "maxplayers"], duree_min: ["dureemin", "duree", "duration", "playingtime", "temps"],
  age_min: ["agemin", "age", "minage"], image_url: ["imageurl", "image", "img"], bgg_id: ["bggid", "bgg"],
};
async function importCsv() {
  if (!canWrite()) return;
  const m = (t) => { csvMsg = t; const el = root.querySelector("#csv-msg"); if (el) el.textContent = t; };
  const rows = parseCSV(root.querySelector("#csv-text")?.value || "");
  if (rows.length < 2) return m("CSV vide ou sans ligne de données (1ʳᵉ ligne = en-têtes).");
  const header = rows[0].map(norm), idx = {};
  for (const [k, al] of Object.entries(COLS)) { const p = header.findIndex((h) => al.includes(h)); if (p >= 0) idx[k] = p; }
  if (idx.titre == null) return m("Colonne « titre » introuvable dans les en-têtes.");
  const parTitre = new Map([...jeux.values()].map((j) => [comparable(j.titre), j]));
  const parBgg = new Map([...jeux.values()].filter((j) => j.bgg_id).map((j) => [j.bgg_id, j]));
  const catParNom = new Map(cats.map((c) => [norm(c.nom), c.id]));
  const nouveaux = [], aMarquer = new Set(); let vides = 0;
  for (let r = 1; r < rows.length; r++) {
    const get = (k) => (idx[k] != null ? (rows[r][idx[k]] || "").trim() : "");
    const titre = get("titre"); if (!titre) { vides++; continue; }
    const bgg = numOrNull(get("bgg_id"));
    const connu = (bgg && parBgg.get(bgg)) || parTitre.get(comparable(titre));
    if (connu) { if (!connu.ludotheque) aMarquer.add(connu.id); continue; }
    parTitre.set(comparable(titre), { id: null, titre });
    const img = get("image_url");
    nouveaux.push({ titre, annee: numOrNull(get("annee")), joueurs_min: numOrNull(get("joueurs_min")),
      joueurs_max: numOrNull(get("joueurs_max")), duree_min: numOrNull(get("duree_min")), age_min: numOrNull(get("age_min")),
      image_url: /^https?:\/\//i.test(img) ? img : null, bgg_id: bgg,
      categorie_id: catParNom.get(norm(get("categorie"))) || null, ludotheque: true });
  }
  if (!nouveaux.length && !aMarquer.size) return m(`Rien à importer : tous les jeux sont déjà dans la ludothèque${vides ? ` (${vides} ligne(s) sans titre)` : ""}.`);
  m("Import…");
  if (nouveaux.length) { const { error } = await supa.from("jeux").insert(nouveaux); if (error) return m("Erreur : " + error.message); }
  if (aMarquer.size) { const { error } = await supa.from("jeux").update({ ludotheque: true }).in("id", [...aMarquer]); if (error) return m("Erreur : " + error.message); }
  await load();
  tab = "ludo"; mode = "list"; go();
  toast(`${plur(nouveaux.length, "jeu ajouté", "jeux ajoutés")}${aMarquer.size ? `, ${aMarquer.size} déjà connu(s) marqué(s) « jeu de l'asso »` : ""}.`, "ok");
}
function modeleCsv() {
  const csv = "titre,annee,categorie,joueurs_min,joueurs_max,duree_min,age_min,image_url\nLes Aventuriers du Rail,2004,Familial,2,5,45,8,\n";
  const a = document.createElement("a");
  a.href = "data:text/csv;charset=utf-8," + encodeURIComponent(csv);
  a.download = "modele-ludotheque.csv";
  document.body.appendChild(a); a.click(); a.remove();
}
