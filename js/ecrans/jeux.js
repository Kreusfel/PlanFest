// Écran #/jeux — tous les jeux, en un seul endroit.
//  - Onglet « Festival » : les jeux de l'édition (jeux de l'asso pris au tri + jeux à
//    obtenir : don, achat ou prêt), filtres, alerte « sans animateur ».
//  - Onglet « Ludothèque de l'asso » : l'inventaire permanent, avec le choix
//    Oui / Bar à jeux / Non pour l'édition en un clic (ou « Trier rapidement »).
//  - Un seul ajout : on cherche d'abord dans nos jeux (pas de doublon), puis sur BGG ;
//    on dit si c'est un jeu de l'asso ou un jeu à obtenir (don, achat, prêt). Saisie à la
//    main et CSV au même endroit.
//  - Une seule fiche par jeu : infos du jeu + bloc « Ce festival ».
// Le tri (ludotheque_choix) alimente la sélection par un déclencheur en base (migration 036).
// Sous-adresses : #/jeux/festival · #/jeux/ludo · #/jeux/<id organisme> (filtre éditeur).
import { supa } from "../supabase.js";
import { isAdmin, hasPole } from "../auth.js";
import { store } from "../store.js";
import { esc, plur, toast, aujourdhui } from "../ui/util.js";
import { ouvrirScan, fermerScan, scanDisponible } from "../ui/scan.js";
import { bonRestitution } from "../export/restitution.js";
import { blocContreparties, actionContrepartie } from "../ui/contreparties.js";
import { parseCSV, norm } from "../ui/csv.js";
import * as swipe from "./selection-swipe.js";

// Jeux à obtenir pour le festival : don (éditeur ou autre), achat de l'asso, prêt
// (ludothèque, bar à jeux, boutique…). Mêmes statuts en base, libellés selon la provenance.
const PROVENANCES = [["don", "Don"], ["achat", "Achat"], ["pret", "Prêt"]];
const provLbl = (k) => (PROVENANCES.find((x) => x[0] === k) || [k, k])[1];
// Jeu à obtenir : À obtenir → Demandé (à qui) → Obtenu (comment : don, prêt, achat).
// On ne connaît la provenance qu'une fois le jeu obtenu (migration 051).
const STATUTS_OBTENIR = [["souhaite", "À obtenir"], ["demande", "Demandé"], ["recu", "Obtenu"]];
const STATUT_PILL = { souhaite: "grey", demande: "amber", recu: "ok", deja_asso: "blue" };
const statutLbl = (k) => (k === "deja_asso" ? "Jeu de l'asso" : (STATUTS_OBTENIR.find((x) => x[0] === k) || [k, k])[1]);
const estPret = (je) => je && je.provenance === "pret" && !jeux.get(je.jeu_id)?.ludotheque;
const pretsEdition = () => [...sel.values()].filter(estPret);
const listePreteurs = () => [...new Set([...preteursPasses, ...pretsEdition().map((je) => (je.provenance_detail || "").trim()).filter(Boolean)])].sort((a, b) => a.localeCompare(b, "fr"));
const preteursDl = () => `<datalist id="preteurs-dl">${listePreteurs().map((n) => `<option value="${esc(n)}">`).join("")}</datalist>`;
const source = (je) => je.provenance_detail || "";
// Libellé court d'un jeu à obtenir : « À obtenir », « Demandé · Asmodee », « Prêt · Ludothèque · Obtenu ».
const etiquetteObtenir = (je) => je.statut === "recu"
  ? [je.provenance ? provLbl(je.provenance) : "", source(je), "Obtenu"].filter(Boolean).join(" · ")
  : je.statut === "demande" ? ["Demandé", source(je)].filter(Boolean).join(" · ") : "À obtenir";
const aObtenirFestival = () => [...sel.values()].filter((je) => !jeux.get(je.jeu_id)?.ludotheque && je.statut !== "recu");
const USAGES = [["animation", "Animation"], ["bar", "Bar à jeux"], ["tombola", "Tombola"]];
const CHOIX = [["oui", "Oui", "ok"], ["bar", "Bar", "amber"], ["non", "Non", "grey"]];
const BGG = `<p class="mini bgg-foot">Données et images : <a href="https://boardgamegeek.com" target="_blank" rel="noopener">Powered by BGG</a></p>`;

let root, loadErr = "";
let jeux = new Map();      // catalogue : id → jeu
let sel = new Map();       // sélection de l'édition : jeu_id → ligne jeux_editions
let choix = new Map();     // tri de la ludothèque : jeu_id → oui | bar | non
let preteursPasses = [];  // prêteurs déjà saisis (toutes éditions), pour les suggestions
let contreparties = [];   // contreparties demandées (édition) ; celles d'un jeu ont jeu_edition_id
let ecoles = [];           // écoles qui viennent au festival (une malle chacune) : { contact_id, nom, demi_journee }
let malles = [];           // malles des écoles : { id, jeu_id, malle } (un jeu peut être dans plusieurs)
let cats = [], orgs = [], comps = [], benes = [], beneIds = new Set(), tables = [];
let edIds = new Set(), edIdsIci = new Set(), edStatut = new Map();   // organismes éditeurs (toutes éditions / cette édition)
const bggEditeurs = new Map();                 // jeu_id → éditeurs proposés par BGG
let tab = "festival", mode = "list", ficheId = null, ficheMode = "lecture";  // ficheMode : lecture | edition
let filt = { q: "", origine: "", prov: "", usage: "", categorie: "", editeur: "", sansAnim: false };
let ludoQ = "", ludoNonDecides = false;
let ajout = { q: "", asso: false, prendre: true, bgg: null, msg: "", ean: "", prov: "don", detail: "", upcStatus: null };  // ean : code-barre inconnu à associer ; upcStatus : statut du lookup gameupc (verified = pas de vote retour)
let csvMsg = "";

const canWrite = () => isAdmin() || hasPole("jeux_editeurs");
// Malles des écoles : pôle Jeux et pôle Intergénérationnel (migration 046).
const canMalles = () => canWrite() || hasPole("intergenerationnelle");
const mallesDe = (jeuId) => malles.filter((m) => m.jeu_id === jeuId);
// Exemplaires (jeux de l'asso) : les malles sont prêtées en même temps (une par école,
// un exemplaire chacune) et rendues le vendredi ; le samedi, ces exemplaires sont libres
// pour le festival. Besoin = le plus grand des deux, pas la somme.
// Un jeu qui n'est pas à l'asso : 0 exemplaire possédé (s'il est en malle, il est « à obtenir »).
const possedes = (j) => (j.ludotheque ? (j.exemplaires_asso ?? 1) : 0);
const auFestival = (j) => (j.ludotheque && sel.has(j.id) ? (sel.get(j.id).exemplaires || 1) : 0);
const besoin = (j) => Math.max(mallesDe(j.id).length, auFestival(j));
const besoinAvecUneMalleDePlus = (j) => Math.max(mallesDe(j.id).length + 1, auFestival(j));
const manque = (j) => Math.max(0, besoin(j) - possedes(j));
const aObtenir = () => [...jeux.values()].filter((j) => manque(j) > 0).sort((a, b) => a.titre.localeCompare(b.titre, "fr"));
function usageTexte(j) {
  const ms = mallesDe(j.id).map((m) => m.malle), f = auFestival(j);
  return [ms.length ? `malle${ms.length > 1 ? "s" : ""} ${ms.join(", ")}` : "", f ? `festival ×${f}` : ""].filter(Boolean).join(" puis ") || "non utilisé";
}
const nomsEcoles = () => ecoles.map((e) => e.nom);
const nomsMalles = () => [...new Set([...nomsEcoles(), ...malles.map((m) => m.malle).sort((a, b) => a.localeCompare(b, "fr"))])];
const catNom = (id) => cats.find((c) => c.id === id)?.nom || "—";
const orgNom = (id) => orgs.find((o) => o.id === id)?.nom || "—";
const beneNom = (id) => benes.find((b) => b.id === id)?.nom || "?";
const tableLabel = (id) => { const t = tables.find((x) => x.id === id); return t ? `Table ${t.numero || "?"}${t.salles?.nom ? " · " + t.salles.nom : ""}` : null; };
const usageLbl = (u) => (USAGES.find((x) => x[0] === u) || [u, u])[1];
const numOrNull = (v) => { const n = parseInt(v, 10); return isNaN(n) ? null : n; };
// Nom comparable (même règle que nom_comparable en base) : minuscules, sans accents ni ponctuation.
const comparable = (s) => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
const f = (l, inner) => `<label>${l}${inner}</label>`;
const chiffres = (v) => String(v || "").replace(/\D/g, "");
// Numéro BGG d'un lien collé (boardgamegeek.com/boardgame/237182/root), sinon null.
const bggIdDepuis = (t) => { const m = String(t || "").match(/boardgamegeek\.com\/(?:boardgame|boardgameexpansion|thing)\/(\d+)/i); return m ? +m[1] : null; };
const parEan = (code) => [...jeux.values()].find((j) => j.ean && j.ean === code);
const meta = (j) => [(j.joueurs_min || j.joueurs_max) ? `${j.joueurs_min || "?"}–${j.joueurs_max || "?"} j.` : "",
  j.duree_min ? `${j.duree_min} min` : "", j.age_min ? `${j.age_min}+` : ""].filter(Boolean).join(" · ");

export async function render(container, sub = "") {
  root = container;
  mode = "list"; ficheId = null;
  tab = ["ludo", "malles", "prets", "obtenir"].includes(sub) ? sub : "festival";
  filt.editeur = sub && !["ludo", "malles", "prets", "obtenir", "festival"].includes(sub) ? sub : "";
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
  const [jx, je, ch, c, o, cp, be, el, oed, mj] = await Promise.all([
    supa.from("jeux").select("*"),
    supa.from("jeux_editions").select("*").eq("edition_id", ed),
    supa.from("ludotheque_choix").select("jeu_id,choix").eq("edition_id", ed),
    supa.from("categories_jeux").select("id,nom,type,ordre").order("ordre"),
    supa.from("organismes").select("id,nom,contact_email").order("nom"),
    // Qui anime quoi (noms + compétences, sans coordonnées) : lisible par tout compte actif.
    supa.rpc("animateurs_edition", { p_edition: ed }),
    Promise.resolve(null),
    supa.from("elements").select("id, numero, salle_id, salles(nom)").eq("edition_id", ed).eq("kind", "table"),
    supa.from("organisme_editions").select("organisme_id, edition_id, statut, dernier_contact").contains("roles", ["editeur"]),
    supa.from("malle_jeux").select("id, jeu_id, malle").eq("edition_id", ed),
  ]);
  const cpq = await supa.from("contreparties").select("*").eq("edition_id", ed).order("cree_le");
  contreparties = cpq.data ?? [];
  const ec = await supa.rpc("ecoles_festival", { p_edition: ed });
  ecoles = ec.data ?? [];
  const pp = await supa.from("jeux_editions").select("provenance_detail").eq("provenance", "pret").not("provenance_detail", "is", null);
  preteursPasses = [...new Set((pp.data ?? []).map((x) => x.provenance_detail.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "fr"));
  malles = mj.data ?? [];
  if (jx.error || je.error) loadErr = (jx.error || je.error).message;
  jeux = new Map((jx.data ?? []).map((j) => [j.id, j]));
  sel = new Map((je.data ?? []).map((r) => [r.jeu_id, r]));
  choix = new Map((ch.data ?? []).map((r) => [r.jeu_id, r.choix]));
  cats = c.data ?? []; orgs = o.data ?? [];
  comps = cp.data ?? [];
  beneIds = new Set(comps.map((x) => x.benevole_id));
  benes = [...new Map(comps.map((x) => [x.benevole_id, { id: x.benevole_id, nom: x.nom }])).values()];
  tables = (el.data ?? []).sort((a, b) => (parseInt(a.numero, 10) || 0) - (parseInt(b.numero, 10) || 0));
  edIds = new Set((oed.data ?? []).map((x) => x.organisme_id));
  edIdsIci = new Set((oed.data ?? []).filter((x) => x.edition_id === ed).map((x) => x.organisme_id));
  // Statut de l'éditeur sur sa fiche (même donnée que l'écran Organismes, synchronisée en base).
  edStatut = new Map((oed.data ?? []).filter((x) => x.edition_id === ed).map((x) => [x.organisme_id, x]));
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
      <div class="sub">${plur(sel.size, "jeu", "jeux")} au festival (${asso} de l'asso, ${sel.size - asso} à obtenir)${nsa ? ` · ${nsa} sans animateur` : ""} · ${plur(nLudo, "jeu", "jeux")} dans la ludothèque</div></div>
      <div class="head-actions">${canWrite() ? `<button class="btn primary" id="ajouter">+ Ajouter un jeu</button>` : ""}</div></div>
    <div class="utabs">
      <button data-tab="festival"${tab === "festival" ? ' class="on"' : ""}>Festival</button>
      <button data-tab="ludo"${tab === "ludo" ? ' class="on"' : ""}>Ludothèque de l'asso</button>
      <button data-tab="obtenir"${tab === "obtenir" ? ' class="on"' : ""}>À obtenir${aObtenirFestival().length + aObtenir().length ? ` (${aObtenirFestival().length + aObtenir().length})` : ""}</button>
      <button data-tab="malles"${tab === "malles" ? ' class="on"' : ""}>Malles des écoles</button>
      <button data-tab="prets"${tab === "prets" ? ' class="on"' : ""}>Prêts${pretsEdition().length ? ` (${pretsEdition().filter((je) => !je.rendu).length} à rendre)` : ""}</button></div>`;
}
function listView() { return entete() + (tab === "ludo" ? ludoView() : tab === "malles" ? mallesView() : tab === "prets" ? pretsView() : tab === "obtenir" ? obtenirView() : festivalView()); }

/* ---------- onglet Festival ---------- */
function festivalFiltres() {
  const q = comparable(filt.q);
  return [...sel.values()].filter((je) => {
    const j = jeux.get(je.jeu_id); if (!j) return false;
    if (q && !comparable(j.titre).includes(q)) return false;
    if (filt.origine === "asso" && !j.ludotheque) return false;
    if (filt.origine === "obtenir" && j.ludotheque) return false;
    if (filt.prov && (j.ludotheque || (["souhaite", "demande"].includes(filt.prov) ? je.statut !== filt.prov : (je.statut !== "recu" || je.provenance !== filt.prov)))) return false;
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
    : `<span class="pill ${STATUT_PILL[je.statut] || "grey"}">${esc(etiquetteObtenir(je))}</span>`;
  const usages = (je.usages || []).map((u) => `<span class="pill grey">${esc(usageLbl(u))}</span>`).join(" ");
  const tbl = je.element_id ? esc(tableLabel(je.element_id) || "Table ?") : "Non placé";
  return `<div class="jeu-card" data-open="${j.id}">
    <div class="jeu-img">${img ? `<img src="${esc(img)}" alt="" loading="lazy">` : `<span>Pas d'image</span>`}</div>
    <b>${esc(j.titre)}${j.annee ? ` <span class="mini">(${j.annee})</span>` : ""}</b>
    <div class="jeu-pills">${origine} ${usages}</div>
    ${sansAnimateur(je) ? `<div><span class="pill alert">Aucun animateur</span></div>` : ""}
    ${manque(j) ? `<div><span class="pill alert">Manque ${manque(j)} exemplaire(s)</span></div>` : ""}
    ${estPret(je) && je.rendu ? `<div><span class="pill ok">Rendu</span></div>` : ""}
    <div class="jeu-foot">${estAnimation(je) ? plur(nbAnim, "animateur", "animateurs") + " · " : ""}${tbl}</div>
  </div>`;
}
// Une ligne de la table « Jeux de l'édition » (format maquette). Le placement/animateur ne
// sont plus affichés ici (filtre « sans animateur » + plan des salles) ; focus catalogue.
function ligneFestival(je) {
  const j = jeux.get(je.jeu_id); if (!j) return "";
  const img = j.miniature_url || j.image_url;
  const joueurs = j.joueurs_min ? `${j.joueurs_min}${j.joueurs_max && j.joueurs_max !== j.joueurs_min ? "–" + j.joueurs_max : ""}` : "—";
  const duree = j.duree_min ? `${j.duree_min} min` : "—";
  const age = j.age_min ? `${j.age_min}+` : "—";
  const statut = j.ludotheque ? `<span class="pill blue">Ludothèque</span>`
    : `<span class="pill ${STATUT_PILL[je.statut] || "grey"}">${esc(etiquetteObtenir(je))}</span>`;
  const dest = (je.usages || []).map((u) => `<span class="pill grey">${esc(usageLbl(u))}</span>`);
  if (mallesDe(j.id).length) dest.push(`<span class="pill grey">Malles</span>`);
  const ex = manque(j) ? `<span class="alert-txt">${possedes(j)}/${besoin(j)} · manque ${manque(j)}</span>`
    : j.ludotheque ? String(possedes(j)) : "—";
  return `<tr class="clk" data-open="${j.id}">
    <td><div class="ludo-cell"><span class="ludo-thumb">${img ? `<img src="${esc(img)}" alt="" loading="lazy">` : ""}</span>
      <span><b>${esc(j.titre)}</b>${j.annee ? ` <span class="muted">${j.annee}</span>` : ""}</span></div></td>
    <td class="muted">${joueurs}</td><td class="muted">${duree}</td><td class="muted">${age}</td>
    <td class="muted">${j.editeur_id ? esc(orgNom(j.editeur_id)) : "—"}</td>
    <td>${statut}</td>
    <td>${dest.length ? dest.join(" ") : `<span class="muted">—</span>`}</td>
    <td>${ex}</td></tr>`;
}
function festivalView() {
  const rows = festivalFiltres().map(ligneFestival).join("")
    || `<tr><td colspan="8" class="muted">${loadErr ? "Erreur : " + esc(loadErr) : sel.size ? "Aucun jeu pour ces filtres." : "Aucun jeu pour ce festival. Trie la ludothèque ou ajoute un jeu à obtenir."}</td></tr>`;
  const nsa = [...sel.values()].filter(sansAnimateur).length;
  const opt = (v, cur, l) => `<option value="${v}"${cur === v ? " selected" : ""}>${esc(l)}</option>`;
  const eIds = [...new Set([...sel.values()].map((r) => jeux.get(r.jeu_id)?.editeur_id).filter(Boolean))];
  return `<div class="card">
    <div class="jeux-filters">
      <input id="f-q" placeholder="Rechercher un titre…" value="${esc(filt.q)}" aria-label="Rechercher un titre">
      <select id="f-origine" aria-label="Origine">${opt("", filt.origine, "Tous les jeux")}${opt("asso", filt.origine, "Jeux de l'asso")}${opt("obtenir", filt.origine, "Jeux à obtenir")}</select>
      <select id="f-prov" aria-label="Avancement">${opt("", filt.prov, "Tout avancement")}${opt("souhaite", filt.prov, "À obtenir")}${opt("demande", filt.prov, "Demandés")}${PROVENANCES.map(([k, l]) => opt(k, filt.prov, "Obtenus : " + l.toLowerCase())).join("")}</select>
      <select id="f-usage" aria-label="Usage">${opt("", filt.usage, "Tous usages")}${USAGES.map(([k, l]) => opt(k, filt.usage, l)).join("")}</select>
      <select id="f-cat" aria-label="Catégorie">${opt("", filt.categorie, "Toutes catégories")}${cats.map((c) => opt(c.id, filt.categorie, c.nom)).join("")}</select>
      <select id="f-editeur" aria-label="Éditeur">${opt("", filt.editeur, "Tous éditeurs")}${eIds.map((id) => opt(id, filt.editeur, orgNom(id))).join("")}</select>
      <button class="btn small${filt.sansAnim ? " primary" : ""}" id="f-sansanim">Sans animateur (${nsa})</button>
    </div>
    <div class="scroll"><table class="data-table">
      <thead><tr><th>Jeu</th><th>Joueurs</th><th>Durée</th><th>Âge</th><th>Éditeur</th><th>Statut</th><th>Destination</th><th>Ex.</th></tr></thead>
      <tbody>${rows}</tbody></table></div>
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
      // Destination = où va le jeu pour ce festival (choix Oui/Bar + malles des écoles).
      const dest = [];
      if (cur === "oui") dest.push(`<span class="pill ok">Animation</span>`);
      else if (cur === "bar") dest.push(`<span class="pill amber">Bar à jeux</span>`);
      if (mallesDe(j.id).length) dest.push(`<span class="pill grey">Malles</span>`);
      return `<tr>
        <td class="clk" data-open="${j.id}"><div class="ludo-cell"><span class="ludo-thumb">${img ? `<img src="${esc(img)}" alt="" loading="lazy">` : ""}</span>
          <span><b>${esc(j.titre)}</b>${j.annee ? ` <span class="muted">(${j.annee})</span>` : ""}
            ${possedes(j) !== 1 ? `<span class="muted">×${possedes(j)}</span>` : ""}
            ${mallesDe(j.id).map((m) => `<span class="pill grey">malle ${esc(m.malle)}</span>`).join(" ")}
            ${manque(j) ? `<span class="pill alert">manque ${manque(j)} ex.</span>` : ""}</span></div></td>
        <td class="muted">${esc(catNom(j.categorie_id))}</td>
        <td class="muted">${esc(meta(j) || "—")}</td>
        <td>${dest.length ? dest.join(" ") : `<span class="muted">—</span>`}</td>
        <td><div class="niv-grp" role="group" aria-label="Pour ce festival">${btns}</div></td></tr>`;
    }).join("") || `<tr><td colspan="5" class="muted">${tous.length ? "Aucun jeu pour cette recherche." : "La ludothèque est vide : « + Ajouter un jeu » ou import CSV."}</td></tr>`;
  const c = { oui: 0, bar: 0, non: 0 }; for (const v of choix.values()) if (v in c) c[v]++;
  return `<div class="card">
    <div class="filters">
      <input id="l-q" class="grow" placeholder="Rechercher un titre…" value="${esc(ludoQ)}" aria-label="Rechercher dans la ludothèque">
      <button class="btn small${ludoNonDecides ? " primary" : ""}" id="l-nd">Non décidés (${nd})</button>
      ${w ? `<form id="scan-form" class="scan-form"><input id="scan" inputmode="numeric" autocomplete="off" placeholder="Code-barre" aria-label="Scanner ou taper un code-barre"><button class="btn small" type="submit">OK</button>${scanDisponible() ? `<button class="btn small" type="button" data-scan-cam aria-label="Scanner avec la caméra">📷</button>` : ""}</form>` : ""}
      ${w ? `<button class="btn small" id="l-tri">Trier rapidement</button><button class="btn small" id="l-csv">Import CSV</button>` : ""}
    </div>
    <p class="mini">Pour ce festival : <b>${c.oui}</b> oui · <b>${c.bar}</b> bar à jeux · <b>${c.non}</b> non. « Oui » et « Bar » ajoutent le jeu à l'onglet Festival.</p>
    <div class="scroll"><table class="data-table">
      <thead><tr><th>Jeu</th><th>Catégorie</th><th>Détails</th><th>Destination</th><th>Ce festival</th></tr></thead>
      <tbody>${rows}</tbody></table></div></div>`;
}
/* ---------- onglet Malles des écoles ---------- */
// Jeux de la ludothèque prêtés aux écoles, regroupés par malle. Un même jeu peut être dans
// plusieurs malles (plusieurs exemplaires) et au festival en même temps.
function mallesView() {
  const w = canMalles(), ludo = [...jeux.values()].filter((j) => j.ludotheque).sort((a, b) => a.titre.localeCompare(b.titre, "fr"));
  const autres = [...jeux.values()].filter((j) => !j.ludotheque).sort((a, b) => a.titre.localeCompare(b.titre, "fr"));
  const sansEcole = !ecoles.length ? `<div class="card"><p class="sync-warn">Aucune école retenue pour ce festival : choisis d'abord les écoles qui viennent dans
      <a href="#/intergeneration">Intergénérationnel → Écoles</a>. Chaque école reçoit sa malle.</p></div>` : "";
  const ajoutForm = w && ecoles.length ? `<div class="card"><div class="ihead"><h3>Ajouter un jeu à une malle</h3></div>
    <form id="malle-form" class="filters" style="align-items:flex-end">
      <label>Jeu<input id="m-jeu" list="m-jeux-dl" placeholder="Tape le titre…" autocomplete="off"></label>
      <datalist id="m-jeux-dl">${ludo.map((j) => `<option value="${esc(j.titre)}">ludothèque</option>`).join("")}${autres.map((j) => `<option value="${esc(j.titre)}">pas à l'asso : à obtenir</option>`).join("")}</datalist>
      <label>Malle de l'école<select id="m-malle">${nomsEcoles().map((n) => `<option value="${esc(n)}">${esc(n)}</option>`).join("")}</select></label>
      <button class="btn primary" type="submit">Ajouter</button>
    </form>
    <p class="mini">Une malle par école retenue ; un même jeu peut être dans plusieurs malles. Un jeu qui n'est pas à l'asso (ou pas assez d'exemplaires) passe dans « À obtenir ».</p></div>` : "";
  const groupes = nomsMalles().map((nom) => {
    const lignes = malles.filter((m) => m.malle === nom).map((m) => ({ m, j: jeux.get(m.jeu_id) })).filter((x) => x.j)
      .sort((a, b) => a.j.titre.localeCompare(b.j.titre, "fr"));
    const ecole = ecoles.find((e) => e.nom === nom);
    return `<div class="card"><div class="ihead"><h3>${esc(nom)}${ecole?.demi_journee ? ` <span class="muted">${ecole.demi_journee === "matin" ? "matin" : "après-midi"}</span>` : ""}${!ecole ? ` <span class="pill grey">école non retenue</span>` : ""}</h3><span class="muted">${plur(lignes.length, "jeu", "jeux")}
        ${w && lignes.length && nomsEcoles().length > 1 ? ` <button class="btn small" data-mcopy="${esc(nom)}">Copier vers l'autre école</button>` : ""}</span></div>
      ${lignes.length ? "" : `<p class="muted">Malle vide.</p>`}
      <div class="scroll"><table class="data-table"><tbody>${lignes.map(({ m, j }) => `<tr>
        <td class="clk" data-open="${j.id}"><b>${esc(j.titre)}</b>${mallesDe(j.id).length > 1 ? ` <span class="pill grey">aussi : ${esc(mallesDe(j.id).filter((x) => x.id !== m.id).map((x) => x.malle).join(", "))}</span>` : ""}${sel.has(j.id) ? ` <span class="pill blue">au festival</span>` : ""}${manque(j) ? ` <span class="pill alert">manque ${manque(j)} ex.</span>` : ""}</td>
        <td class="muted">${esc(meta(j) || "—")}</td>
        <td style="text-align:right">${w ? `<button class="btn small danger" data-mdel="${m.id}">Retirer</button>` : ""}</td></tr>`).join("")}</tbody></table></div></div>`;
  }).join("") || `<div class="card"><p class="muted">Aucun jeu en malle pour cette édition.</p></div>`;
  const ao = aObtenir();
  const obtenir = ao.length ? `<div class="card"><p class="sync-warn">${plur(ao.length, "jeu manque", "jeux manquent")} pour les malles :
      voir l'onglet <button class="link" data-tab="obtenir">À obtenir</button>.</p></div>` : "";
  return `<p class="mini" style="margin:8px 2px">${plur(malles.length, "jeu", "jeux")} en malle · ${plur(ecoles.length, "école retenue", "écoles retenues")} (<a href="#/intergeneration">Intergénérationnel → Écoles</a>).</p>${sansEcole}${obtenir}${ajoutForm}${groupes}`;
}

/* ---------- onglet Prêts (restitution) ---------- */
// Jeux prêtés pour le festival, regroupés par prêteur : case « Rendu » par jeu, « Tout rendu »,
// bon de restitution PDF à faire signer.
function groupesPrets() {
  const g = new Map();
  pretsEdition().forEach((je) => {
    const nom = (je.provenance_detail || "").trim(), k = comparable(nom) || "?";
    if (!g.has(k)) g.set(k, { nom: nom || "Prêteur non renseigné", lignes: [] });
    g.get(k).lignes.push(je);
  });
  return [...g.entries()].sort((a, b) => a[1].nom.localeCompare(b[1].nom, "fr"));
}
function pretsView() {
  const w = canWrite(), gs = groupesPrets();
  if (!gs.length) return `<div class="card"><p class="muted">Aucun jeu prêté pour ce festival. Un prêt s'ajoute avec « + Ajouter un jeu » → jeu à obtenir → Prêt.</p></div>`;
  return gs.map(([k, g]) => {
    const rendus = g.lignes.filter((je) => je.rendu).length;
    const lignes = g.lignes.sort((a, b) => jeux.get(a.jeu_id).titre.localeCompare(jeux.get(b.jeu_id).titre, "fr")).map((je) => {
      const j = jeux.get(je.jeu_id);
      return `<tr><td class="clk" data-open="${j.id}"><b>${esc(j.titre)}</b></td>
        <td>×${je.exemplaires || 1}</td>
        <td><span class="pill ${STATUT_PILL[je.statut] || "grey"}">${esc(statutLbl(je.statut, "pret"))}</span></td>
        <td><span class="chk-inline"><input type="checkbox" data-rendu="${je.id}"${je.rendu ? " checked" : ""}${w ? "" : " disabled"} aria-label="${esc(j.titre)} rendu"> Rendu${je.rendu_le ? ` le ${esc(je.rendu_le)}` : ""}</span></td></tr>`;
    }).join("");
    return `<div class="card"><div class="ihead"><h3>${esc(g.nom)}</h3>
        <span class="tag ${rendus === g.lignes.length ? "ok" : "warn"}">${rendus}/${g.lignes.length} rendu${g.lignes.length > 1 ? "s" : ""}</span></div>
      ${k === "?" ? `<p class="sync-warn">Indique le prêteur sur la fiche de ces jeux pour pouvoir les rendre.</p>` : ""}
      <div class="scroll"><table class="data-table"><tbody>${lignes}</tbody></table></div>
      <div class="head-actions" style="justify-content:flex-start;margin-top:8px">
        <button class="btn small" data-bon="${esc(k)}">Bon de restitution (PDF)</button>
        ${w && rendus < g.lignes.length ? `<button class="btn small primary" data-toutrendu="${esc(k)}">Tout rendu</button>` : ""}</div></div>`;
  }).join("");
}

/* ---------- onglet À obtenir (kanban façon maquette) ---------- */
// Pastille colorée avec l'initiale du jeu (couleur stable d'après le titre).
const AVJ = [["var(--blue-tint)", "var(--blue)"], ["var(--purple-tint)", "var(--purple)"], ["#F3D9C4", "#7A3E14"],
  ["#F6D5D5", "#8A2B2B"], ["#D5E6E2", "#0E4F4F"], ["var(--green-tint)", "var(--green)"], ["var(--accent-tint)", "var(--accent-dark)"]];
const avatarJeu = (j) => {
  const img = j.miniature_url || j.image_url;
  if (img) return `<span class="avatar avatar-img" aria-hidden="true"><img src="${esc(img)}" alt="" loading="lazy"></span>`;
  const [bg, c] = AVJ[(j.titre.charCodeAt(0) || 0) % AVJ.length];
  return `<span class="avatar" aria-hidden="true" style="background:${bg};color:${c}">${esc((j.titre[0] || "?").toUpperCase())}</span>`;
};
// Jours depuis le dernier contact de l'éditeur (proxy du « sans réponse depuis »).
const joursDemande = (je) => { const ed = jeux.get(je.jeu_id).editeur_id; const d = ed ? edStatut.get(ed)?.dernier_contact : null; return d ? Math.round((Date.now() - new Date(d + "T00:00:00").getTime()) / 86400000) : null; };
const editeurDe = (je) => { const ed = jeux.get(je.jeu_id).editeur_id; return ed && !(je.notes || "").includes(`Refusé par ${orgNom(ed)}`) ? ed : ""; };

function obtenirView() {
  const w = canWrite(), afaire = aObtenirFestival();
  const souhait = afaire.filter((je) => je.statut === "souhaite");
  const demande = afaire.filter((je) => je.statut === "demande");
  const recu = afaire.filter((je) => je.statut === "recu");
  const nom = (je) => jeux.get(je.jeu_id).titre;
  const teteJ = (id, titre) => `<div class="kan-card-top">${avatarJeu(jeux.get(id))}
    <div class="row-main"><span class="kan-card-name clk" data-open="${id}">${esc(titre)}</span>`;
  const tete = (je) => teteJ(je.jeu_id, nom(je));

  const cardSouhait = (je) => { const ed = editeurDe(je), nomEd = ed ? orgNom(ed) : "";
    return `<li class="kan-card">${tete(je)}<span class="kan-sub">${jeux.get(je.jeu_id).annee || ""}</span></div></div>
      <div class="kan-note">${ed ? `À demander à <b>${esc(nomEd)}</b> · éditeur` : "À demander à une ludothèque, une boutique, ou à acheter"}</div>
      ${w ? `<button class="btn small" style="margin-top:10px" data-demande="${esc(ed || "?")}">✉ ${ed ? "Demander à " + esc(nomEd) : "Marquer demandé…"}</button>` : ""}</li>`;
  };
  const cardDemande = (je) => { const jo = joursDemande(je), stale = jo != null && jo > 15;
    return `<li class="kan-card${stale ? " alert" : ""}">${tete(je)}<span class="kan-sub">Demandé à ${esc(je.provenance_detail || "?")}</span></div></div>
      ${stale ? `<div class="kan-stale">⚠ Sans réponse depuis ${jo} jours</div>` : ""}
      ${w ? `<div class="kan-obtenu"><div class="kan-obtenu-q">Il a été obtenu comment ?</div><div class="kan-obtenu-btns">
        <button class="btn small" data-obtenuprov="${je.id}|don">Don</button>
        <button class="btn small" data-obtenuprov="${je.id}|achat">Achat</button>
        <button class="btn small primary" data-obtenuprov="${je.id}|pret">Prêt</button></div>
        <button class="btn small" style="margin-top:6px" data-refus="${je.id}">Refusé : chercher ailleurs</button></div>` : ""}</li>`;
  };
  const cardRecu = (je) => {
    const statut = je.provenance === "pret" ? `<span class="pill grey">Hors ludothèque${je.rendu ? " · rendu" : " · à rendre"}</span>` : `<span class="pill grey">Entré en ludothèque</span>`;
    const dest = (je.usages || []).map((u) => `<span class="pill grey">${esc(usageLbl(u))}</span>`).join(" ");
    return `<li class="kan-card">${tete(je)}<span class="kan-sub">${esc(provLbl(je.provenance))}${je.provenance_detail ? " · " + esc(je.provenance_detail) : ""}</span></div></div>
      <div class="kan-destins"><span class="pill ok">✓ ${esc(provLbl(je.provenance))}</span>${statut}</div>
      ${dest ? `<div class="kan-destins">${dest}</div>` : ""}</li>`;
  };

  // Jeux de malles encore à obtenir (manque d'exemplaires), ajoutés à la colonne « À obtenir ».
  const cardMalleNeed = (j) => `<li class="kan-card">${teteJ(j.id, j.titre)}<span class="kan-sub">Pour les malles</span></div></div>
    <div class="kan-note"><b class="alert-txt">Manque ${manque(j)}</b> · ${possedes(j)}/${besoin(j)} exemplaire(s) · ${esc(usageTexte(j))}</div></li>`;
  const vide = `<li class="kan-card"><span class="muted">Rien ici pour l'instant.</span></li>`;
  const colH = (cls, titre, count, inner) => `<section class="kan-col ${cls}"><div class="kan-head"><h3>${esc(titre)}</h3><span class="count">${count}</span></div>
    <ul class="kan-list">${inner || vide}</ul></section>`;

  const souhaitIds = new Set(souhait.map((je) => je.jeu_id));
  const malleNeed = aObtenir().filter((j) => !souhaitIds.has(j.id));
  const aObtenirInner = souhait.map(cardSouhait).join("") + malleNeed.map(cardMalleNeed).join("");
  const aObtenirCount = souhait.length + malleNeed.length;

  const prets = groupesPrets();
  const pretsTable = prets.length ? `<section class="card" style="margin-top:20px"><div class="dash-panel-head"><h2>Prêts à restituer <span class="pill grey">${prets.length}</span></h2></div>
    <div class="scroll"><table class="data-table"><thead><tr><th>Prêteur</th><th>Jeux prêtés</th><th>À rendre</th><th></th></tr></thead><tbody>
    ${prets.map(([k, g]) => `<tr><td><b>${esc(g.nom)}</b></td>
      <td class="muted">${esc(g.lignes.map((je) => nom(je)).sort((a, b) => a.localeCompare(b, "fr")).join(", "))}</td>
      <td>${g.lignes.filter((je) => !je.rendu).length} à rendre</td>
      <td style="text-align:right"><button class="btn small" data-bon="${esc(k)}">Bon de restitution</button></td></tr>`).join("")}
    </tbody></table></div></section>` : "";

  // Jeux par destination (un même jeu peut être dans plusieurs) : malle, animation, bar à jeux.
  const destinationsDe = (j) => {
    const d = new Set(), cur = choix.get(j.id), je = sel.get(j.id);
    if (cur === "oui") d.add("animation");
    if (cur === "bar") d.add("bar");
    (je?.usages || []).forEach((u) => d.add(u));
    if (mallesDe(j.id).length) d.add("malle");
    return d;
  };
  const parDest = (dest) => [...jeux.values()].filter((j) => destinationsDe(j).has(dest)).sort((a, b) => a.titre.localeCompare(b.titre, "fr"));
  const listeDest = (titre, dest, pillCls, extra) => {
    const items = parDest(dest);
    if (!items.length) return "";
    return `<section class="card" style="margin-top:16px"><div class="dash-panel-head"><h2>${esc(titre)} <span class="pill ${pillCls}">${items.length}</span></h2></div>
      <div class="list">${items.map((j) => `<div class="row">${avatarJeu(j)}<div class="row-main">
        <b class="kan-card-name clk" data-open="${j.id}">${esc(j.titre)}</b>${extra ? `<span class="muted">${esc(extra(j))}</span>` : ""}</div></div>`).join("")}</div></section>`;
  };
  const dests = listeDest("Pour les malles", "malle", "alert", (j) => `${usageTexte(j)}${manque(j) ? ` · manque ${manque(j)}` : ""}`)
    + listeDest("Pour l'animation", "animation", "grey")
    + listeDest("Pour le bar à jeux", "bar", "grey");

  return `<div class="kanban">
    ${colH("a", "À obtenir", aObtenirCount, aObtenirInner)}
    ${colH("d", "Demandé", demande.length, demande.map(cardDemande).join(""))}
    ${colH("o", "Obtenu", recu.length, recu.slice(0, 40).map(cardRecu).join(""))}</div>${pretsTable}${dests}`;
}

function triView() {
  return `<div class="page-head"><div><h1>Trier la ludothèque</h1><div class="sub">Un jeu après l'autre, pour ce festival</div></div>
    <div class="head-actions"><button class="btn" id="retour">← Ludothèque</button></div></div><div id="tri-mount"></div>`;
}

/* ---------- ajout ---------- */
// Jeux du catalogue dont le titre ressemble à la recherche (ou au même numéro BGG).
function trouvesLocaux() {
  const q = comparable(ajout.q);
  if (/^\d{6,14}$/.test(ajout.q.trim())) { const j = parEan(ajout.q.trim()); return j ? [j] : []; }
  const bggIds = new Set((ajout.bgg || []).map((r) => r.bgg_id).filter(Boolean));
  if (!q && !bggIds.size) return [];
  return [...jeux.values()].filter((j) => (q.length >= 2 && comparable(j.titre).includes(q)) || (j.bgg_id && bggIds.has(j.bgg_id)))
    .sort((a, b) => a.titre.localeCompare(b.titre, "fr")).slice(0, 12);
}
function etatLocal(j) {
  const je = sel.get(j.id);
  if (ajout.ean && !j.ean) return { txt: je ? "Déjà au festival" : (j.ludotheque ? "Dans la ludothèque" : "Déjà connu"),
    btn: `<button class="btn small primary" data-associer="${j.id}">C'est ce jeu</button><button class="btn small" data-open="${j.id}">Ouvrir</button>` };
  if (je) return { txt: "Déjà au festival", btn: `<button class="btn small" data-open="${j.id}">Ouvrir</button>` };
  return { txt: j.ludotheque ? "Dans la ludothèque, pas encore pris pour ce festival" : "Déjà connu, pas dans ce festival",
    btn: `<button class="btn small primary" data-aufestival="${j.id}">Ajouter au festival</button><button class="btn small" data-open="${j.id}">Ouvrir</button>` };
}
function ajoutView() {
  const locaux = trouvesLocaux(), dejaBgg = new Set(locaux.map((j) => j.bgg_id).filter(Boolean));
  const loc = locaux.length ? `<h3>Déjà chez nous</h3><div class="list">${locaux.map((j) => {
    const e = etatLocal(j), img = j.miniature_url || j.image_url;
    return `<div class="row"><div class="bgg-thumb">${img ? `<img src="${esc(img)}" alt="">` : ""}</div>
      <div class="row-main"><b>${esc(j.titre)}${j.annee ? ` <span class="mini">(${j.annee})</span>` : ""}</b>
        <span class="muted">${j.ludotheque ? "Asso" : (j.editeur_id ? esc(orgNom(j.editeur_id)) : "Jeu externe")} · ${esc(e.txt)}</span></div>
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
  const res = `${loc}${bgg}` || `<p class="muted">Scanne un code-barre ou cherche un nom pour voir des résultats.</p>`;
  const m = ajout.methode === "scan" ? "scan" : "nom";
  const meth = (key, titre, desc, attr) => `<button type="button" class="meth${m === key ? " on" : ""}" ${attr}>
    <span class="meth-t">${esc(titre)}</span><span class="meth-d">${esc(desc)}</span></button>`;
  const warn = ajout.ean ? `<p class="sync-warn">Code ${esc(ajout.ean)} : il sera enregistré avec le jeu que tu choisis.</p>` : "";
  const mid = m === "scan"
    ? `<form id="scan-form" class="jeux-filters">
        <input id="scan" inputmode="numeric" autocomplete="off" placeholder="Code-barre (douchette ou clavier)" value="${esc(ajout.ean)}" aria-label="Code-barre">
        ${scanDisponible() ? `<button class="btn" type="button" data-scan-cam aria-label="Scanner avec la caméra">📷 Scanner</button>` : ""}
        <button class="btn primary" type="submit">Chercher le code</button></form>${warn}
      <div id="a-res">${res}</div>`
    : `<form id="a-form" class="jeux-filters">
        <input id="a-q" placeholder="Nom du jeu, ou lien BGG collé…" value="${esc(ajout.q)}" aria-label="Nom du jeu ou lien BGG" autocomplete="off">
        <button class="btn primary" type="submit">Chercher sur BGG</button></form>${warn}
      <p class="msg" id="a-msg">${esc(ajout.msg)}</p><div id="a-res">${res}</div>`;
  return `<div class="modal">
    <div class="modal-head"><h1>Ajouter un jeu</h1><button class="btn small" id="retour">✕ Fermer</button></div>
    <div class="modal-body">
      <div class="modal-col methodes">
        <div class="lbl">Comment l'ajouter ?</div>
        ${meth("scan", "Scanner un code-barre", "Caméra, douchette ou saisie du numéro", `data-methode="scan"`)}
        ${meth("nom", "Chercher par nom", "Remplissage auto depuis BoardGameGeek", `data-methode="nom"`)}
        ${meth("manuel", "Saisir à la main", "Pour un jeu rare ou fait maison", `id="to-manuel"`)}
        ${meth("csv", "Importer un CSV", "Reprendre une liste d'un seul coup", `id="to-csv"`)}
      </div>
      <div class="modal-col mid">${mid}</div>
      <div class="modal-col ou"><div class="lbl">Où l'ajouter ?</div>${origineChoix("a")}</div>
    </div>${BGG}</div>`;
}
// Choix « jeu de l'asso / jeu à obtenir » (+ « le prendre pour ce festival », ou provenance), commun à
// la recherche et à la saisie à la main. Préfixe = a (ajout) ou m (manuel).
function origineChoix(p) {
  return `<div class="champ-groupe"><span class="lbl">Ce jeu est…</span><div class="chk-row">
      <span class="chk-inline"><input type="radio" name="${p}-origine" value="asso"${ajout.asso ? " checked" : ""} data-origine> un jeu de l'asso (ludothèque)</span>
      <span class="chk-inline"><input type="radio" name="${p}-origine" value="obtenir"${ajout.asso ? "" : " checked"} data-origine> un jeu à obtenir pour ce festival</span></div>
    ${ajout.asso ? `<span class="chk-inline"><input type="checkbox" id="${p}-prendre"${ajout.prendre ? " checked" : ""} data-prendre> Le prendre pour ce festival</span>`
      : `<p class="mini">Il ira dans l'onglet « À obtenir » : on le demandera à l'éditeur, puis à la ludothèque ou à une boutique, sinon on l'achètera.</p>`}</div>`;
}
function manuelView() {
  return `<div class="page-head"><div><h1>Saisir un jeu à la main</h1><div class="sub">Sans BGG</div></div>
    <div class="head-actions"><button class="btn" id="to-ajout">← Recherche</button></div></div>
    <div class="card" style="max-width:620px">
      ${origineChoix("m")}
      ${f("Titre", `<input data-m="titre" placeholder="Nom du jeu" value="${esc(ajout.q)}">`)}
      <div class="row2">${f("Année", `<input type="number" data-m="annee">`)}${f("Catégorie", catSel(null, "data-m"))}</div>
      ${f("Éditeur", editeurSel(null, "data-m"))}
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
        titre · annee · categorie (nom exact) · joueurs_min · joueurs_max · duree_min · age_min · image_url · bgg_id · ean (code-barre) · exemplaires.
        Un jeu déjà connu (même titre, ou même numéro BGG) n'est pas recréé : il est simplement marqué « jeu de l'asso ».</p>
    </div>`;
}

/* ---------- fiche ---------- */
/* ---------- fiche : vue lecture (maquette) + mode édition ---------- */
function stepperJeu(step) {
  const E = ["À obtenir", "Demandé", "Obtenu"];
  return `<div class="stepper">${E.map((lbl, i) => `<div class="step${i <= step ? " on" : ""}"><span class="step-dot">${i <= step ? "✓" : i + 1}</span><span class="mini">${esc(lbl)}</span></div>`).join("")}</div>`;
}
function ficheView() {
  if (ficheMode === "edition") return ficheEditView();
  const j = jeux.get(ficheId);
  if (!j) { mode = "list"; return listView(); }
  const je = sel.get(j.id), w = canWrite();
  const metaTxt = meta(j);
  const badges = `${j.ludotheque ? `<span class="pill blue">Ludothèque de l'asso</span>` : ""}${je ? `<span class="pill ok">Au festival</span>` : `<span class="pill grey">Pas dans ce festival</span>`}`;
  const leJeu = `<section class="card"><h2 class="fiche-h2">Le jeu</h2>
    <div class="fiche-grid">
      <div><div class="lbl">Catégorie</div>${esc(catNom(j.categorie_id))}</div>
      <div><div class="lbl">Code-barre</div>${j.ean ? esc(j.ean) : `<span class="muted">—</span>`}</div>
      ${j.ludotheque ? `<div><div class="lbl">Exemplaires possédés</div>${possedes(j)}</div>` : ""}
      ${j.annee ? `<div><div class="lbl">Année</div>${j.annee}</div>` : ""}
    </div>
    ${(j.ludotheque || mallesDe(j.id).length) ? `<div class="fiche-note">Besoin d'exemplaires : ${esc(usageTexte(j))} → <b>${besoin(j)}</b>${manque(j) ? ` <span class="alert-txt">(manque ${manque(j)})</span>` : ""}.</div>` : ""}</section>`;
  let ceFestival;
  if (!je) {
    ceFestival = `<section class="card"><h2 class="fiche-h2">Ce festival</h2><p class="muted">Ce jeu n'est pas prévu pour ce festival.</p>
      ${w ? `<button class="btn primary" data-aufestival="${j.id}">Ajouter au festival</button>` : ""}</section>`;
  } else if (!j.ludotheque) {
    const step = ["souhaite", "demande", "recu"].indexOf(je.statut);
    ceFestival = `<section class="card fiche-festival"><h2 class="fiche-h2">Ce festival</h2>
      ${stepperJeu(step)}
      <div class="fiche-grid" style="margin-top:14px">
        ${je.provenance ? `<div><div class="lbl">Provenance</div><span class="pill ok">${esc(provLbl(je.provenance))}</span></div>` : ""}
        ${je.provenance_detail ? `<div><div class="lbl">${je.statut === "recu" ? "Obtenu auprès de" : "Demandé à"}</div>${esc(je.provenance_detail)}</div>` : ""}
      </div>
      ${manque(j) ? `<div class="fiche-alert">⚠ Il manque ${manque(j)} exemplaire(s) : ${possedes(j)} dispo pour ${besoin(j)} nécessaires.</div>` : ""}
      <div class="filters" style="margin-top:12px">
        ${je.provenance === "pret" ? `<button class="btn small" data-bon="${esc(comparable(je.provenance_detail || "") || "?")}">Éditer le bon de restitution</button>` : ""}
        ${w ? `<button class="btn small" id="modifier">Changer le statut</button>` : ""}</div></section>`;
  } else {
    ceFestival = `<section class="card"><h2 class="fiche-h2">Ce festival</h2><p>Jeu de l'asso, <b>pris pour ce festival</b>.</p>
      ${manque(j) ? `<div class="fiche-alert">⚠ Il manque ${manque(j)} exemplaire(s).</div>` : ""}</section>`;
  }
  const cps = contreparties.filter((c) => je && c.jeu_edition_id === je.id && !c.faite);
  const cpCard = cps.length ? `<section class="card"><h2 class="fiche-h2">Contrepartie liée</h2>
    ${cps.map((c) => `<div class="row"><div class="row-main"><b>${esc(c.description || c.nature || "Contrepartie")}</b><span class="muted">${esc(c.beneficiaire || "")}</span></div>
      ${w ? `<div class="actions"><button class="btn small" data-cpfait="${c.id}">✓ Marquer faite</button></div>` : ""}</div>`).join("")}</section>` : "";
  return `<nav class="fil"><a class="link" id="retour">Jeux</a> › ${esc(j.titre)}</nav>
    <div class="fiche-head">
      ${avatarJeu(j)}
      <div class="fiche-head-main">
        <div class="fiche-badges">${badges}</div>
        <h1>${esc(j.titre)}${j.annee ? ` <span class="muted" style="font-weight:600;font-size:22px">${j.annee}</span>` : ""}</h1>
        ${metaTxt ? `<div class="sub">${esc(metaTxt)}</div>` : ""}
        ${j.editeur_id ? `<div class="sub">Éditeur <b>${esc(orgNom(j.editeur_id))}</b></div>` : ""}
      </div>
      <div class="head-actions">
        ${w ? `<button class="btn primary" id="modifier">Modifier la fiche</button>` : ""}
        ${j.bgg_id ? `<a class="btn" href="https://boardgamegeek.com/boardgame/${esc(String(j.bgg_id))}" target="_blank" rel="noopener">Voir sur BGG</a>` : ""}
      </div>
    </div>
    <div class="dash-cols" style="margin-top:14px">
      <div class="dash-main">${ceFestival}${cpCard}</div>
      <div class="dash-side">${leJeu}</div>
    </div>`;
}
// Formulaire d'édition complet (ancienne fiche), accessible via « Modifier la fiche ».
function ficheEditView() {
  const j = jeux.get(ficheId);
  if (!j) { mode = "list"; return listView(); }
  const je = sel.get(j.id), w = canWrite(), ro = w ? "" : " disabled";
  const img = j.image_url || j.miniature_url;
  return `<div class="page-head"><div><h1>${esc(j.titre)}</h1>
    <div class="sub">${j.ludotheque ? "Jeu de l'asso" : je ? esc(provLbl(je.provenance)) + (source(je, j) ? " · " + esc(source(je, j)) : "") : "Jeu externe"}${j.editeur_id ? " · éditeur " + esc(orgNom(j.editeur_id)) : ""} · ${je ? "au festival" : "pas dans ce festival"}</div></div>
    <div class="head-actions"><button class="btn" id="retour">← Jeux</button>${w ? `<button class="btn primary" id="save">Enregistrer</button>` : ""}</div></div>
    <div class="two">
      <div class="l card"><h2>Le jeu</h2>
        <div class="jeu-fiche-top">
          <div class="jeu-img sm">${img ? `<img src="${esc(img)}" alt="">` : `<span>Pas d'image</span>`}</div>
          <div class="jeu-fiche-meta">
            ${j.bgg_id ? `<span class="pill ok">Importé de BGG</span>
              <a class="link" href="https://boardgamegeek.com/boardgame/${esc(String(j.bgg_id))}" target="_blank" rel="noopener">Voir la fiche sur BGG</a>
              ${w ? `<button class="btn small" id="bgg-update">Mettre à jour depuis BGG</button>` : ""}` : `<span class="mini">Saisi à la main</span>
              ${w ? `<div class="lier-bgg"><input id="lien-bgg" placeholder="Coller le lien BGG du jeu" aria-label="Lien de la fiche BGG"><button class="btn small" id="lier-bgg">Lier à BGG</button></div>` : ""}`}
          </div>
        </div>
        <span class="chk-inline"><input type="checkbox" data-jbool="ludotheque"${j.ludotheque ? " checked" : ""}${ro}> Jeu de l'asso (dans la ludothèque)</span>
        ${f("Titre", `<input data-j="titre" value="${esc(j.titre)}"${ro}>`)}
        <div class="row2">${f("Année", `<input type="number" data-j="annee" value="${j.annee ?? ""}"${ro}>`)}${f("Catégorie", catSel(j.categorie_id, "data-j", ro))}</div>
        <label>Éditeur<div class="with-link">${editeurSel(j.editeur_id, "data-j", ro)}${j.editeur_id ? `<a class="link" href="#/organismes/editeurs">Voir la fiche</a>` : ""}</div></label>
        ${w ? ajoutEditeur(j) : ""}
        <div class="row2">${f("Joueurs min", `<input type="number" data-j="joueurs_min" value="${j.joueurs_min ?? ""}"${ro}>`)}${f("Joueurs max", `<input type="number" data-j="joueurs_max" value="${j.joueurs_max ?? ""}"${ro}>`)}</div>
        <div class="row2">${f("Durée (min)", `<input type="number" data-j="duree_min" value="${j.duree_min ?? ""}"${ro}>`)}${f("Âge min", `<input type="number" data-j="age_min" value="${j.age_min ?? ""}"${ro}>`)}</div>
        ${j.ludotheque ? f("Exemplaires possédés par l'asso", `<input type="number" min="0" data-j="exemplaires_asso" value="${possedes(j)}"${ro}>`) : ""}
        ${f("Code-barre (EAN)", `<input data-j="ean" inputmode="numeric" value="${esc(j.ean || "")}" placeholder="Scanner ou taper le code"${ro}>`)}
        ${j.bgg_id ? "" : f("Image (lien)", `<input data-j="image_url" value="${esc(j.image_url || "")}" placeholder="https://…"${ro}>`)}
        ${w ? `<button class="btn small danger" id="suppr-jeu" style="margin-top:10px">Supprimer ce jeu du catalogue</button>` : ""}
        ${BGG}
      </div>
      <div class="r">${j.ludotheque || mallesDe(j.id).length ? blocMalles(j) : ""}${je ? blocFestival(j, je, ro) : `<div class="card"><h2>Ce festival</h2>
          <p class="muted">Ce jeu n'est pas prévu pour ce festival.</p>
          ${w ? `<button class="btn primary" data-aufestival="${j.id}">Ajouter au festival</button>` : ""}</div>`}</div>
    </div>
    <p class="msg" id="j-msg"></p>`;
}
function blocMalles(j) {
  const w = canMalles(), ms = mallesDe(j.id);
  const dispo = nomsEcoles().filter((n) => !ms.some((m) => m.malle === n));
  // Contrôle d'ajout (optionnel) : on peut mettre n'importe quel jeu de l'asso dans une malle.
  const ajoutCtrl = !w ? "" : dispo.length
    ? `<div class="lier-bgg"><select id="f-malle" aria-label="Malle de l'école">${dispo.map((n) => `<option value="${esc(n)}">${esc(n)}</option>`).join("")}</select>
        <button class="btn small" data-madd="${j.id}">Ajouter à une malle</button></div>`
    : `<p class="mini">${ecoles.length ? "Déjà dans la malle de chaque école." : `Aucune école retenue (<a href="#/intergeneration">Intergénérationnel → Écoles</a>).`}</p>`;
  if (!ms.length) {
    // Pas dans une malle : présenter l'ajout comme une action, sans sous-entendre une présence.
    return `<div class="card"><h2>Malles des écoles</h2>
      <p class="muted">Ce jeu n'est dans aucune malle. Tu peux l'ajouter à une malle d'école :</p>
      ${ajoutCtrl || `<p class="mini">Aucune malle à gérer ici.</p>`}</div>`;
  }
  return `<div class="card"><h2>Malles des écoles</h2>
    <p class="mini">Dans ${plur(ms.length, "malle", "malles")} · ${plur(possedes(j), "exemplaire possédé", "exemplaires possédés")}${manque(j) ? ` <span class="pill alert">manque ${manque(j)}</span>` : ""}</p>
    <div class="chk-row">${ms.map((m) => `<span class="pill grey">${esc(m.malle)}${w ? ` <button class="link" data-mdel="${m.id}" aria-label="Retirer de la malle ${esc(m.malle)}">×</button>` : ""}</span>`).join(" ")}</div>
    ${ajoutCtrl}</div>`;
}
function blocFestival(j, je, ro) {
  const a = animFor(j);
  const tOpts = `<option value="">— non placé —</option>` + tables.map((t) => `<option value="${t.id}"${t.id === je.element_id ? " selected" : ""}>Table ${esc(t.numero || "?")}${t.salles?.nom ? " · " + esc(t.salles.nom) : ""}</option>`).join("");
  const animRows = (a.anime.map((n) => `<div class="anim-row"><span>${esc(n)}</span><span class="pill ok">Anime</span></div>`).join("")
    + a.apprendre.map((n) => `<div class="anim-row"><span>${esc(n)}</span><span class="pill amber">Veut apprendre</span></div>`).join(""))
    || `<p class="muted">Personne n'a encore répondu pour ce jeu.</p>`;
  const statut = j.ludotheque ? `<div class="champ-groupe"><span class="lbl">Statut</span><span class="pill blue">Jeu de l'asso</span></div>`
    : f("Statut", `<select data-e="statut"${ro}>${STATUTS_OBTENIR.map(([k, l]) => `<option value="${k}"${k === je.statut ? " selected" : ""}>${l}</option>`).join("")}</select>`);
  const aupres = j.ludotheque ? "" : `<div class="row2">
      ${f(je.statut === "recu" ? "Obtenu auprès de" : "Demandé à", `<input data-e="provenance_detail" list="preteurs-dl" value="${esc(je.provenance_detail || "")}" placeholder="éditeur, ludothèque, boutique…"${ro}>`)}
      ${f("Obtenu comment", `<select data-e="provenance"${ro}><option value="">— pas encore —</option>${PROVENANCES.map(([k, l]) => `<option value="${k}"${k === je.provenance ? " selected" : ""}>${l}</option>`).join("")}</select>`)}
    </div>${preteursDl()}
    ${!ro && je.statut === "demande" ? `<p class="mini">Réponse négative ? <button class="btn small" id="refuse">Refusé : chercher ailleurs</button></p>` : ""}
    ${je.provenance === "pret" ? `<span class="chk-inline"><input type="checkbox" data-e="rendu"${je.rendu ? " checked" : ""}${ro}> Rendu au prêteur${je.rendu_le ? ` (le ${esc(je.rendu_le)})` : ""}</span>` : ""}`;
  // Jeu acheté ou donné, reçu : il appartient désormais à l'asso.
  const garder = !ro && !j.ludotheque && je.statut === "recu" && ["achat", "don"].includes(je.provenance)
    ? `<p class="mini">Ce jeu appartient maintenant à l'asso ? <button class="btn small" id="garder-ludo">Le garder dans la ludothèque</button></p>` : "";
  return `<div class="card"><h2>Ce festival</h2>
      <div class="row2">${statut}${f("Exemplaires", `<input type="number" min="1" data-e="exemplaires" value="${je.exemplaires ?? 1}"${ro}>`)}</div>
      ${aupres}${garder}
      <div class="champ-groupe"><span class="lbl">Usages</span><div class="chk-row">${USAGES.map(([k, l]) => `<span class="chk-inline"><input type="checkbox" data-usage="${k}"${(je.usages || []).includes(k) ? " checked" : ""}${ro}> ${l}</span>`).join("")}</div></div>
      <label>Table (plan)<div class="with-link"><select data-e="element_id"${ro}>${tOpts}</select><a class="link" href="#/plan">Voir sur le plan</a></div></label>
      ${f("Notes", `<textarea data-e="notes"${ro}>${esc(je.notes || "")}</textarea>`)}
      ${ro ? "" : `<button class="btn small danger" id="retirer">Retirer du festival</button>`}
    </div>
    ${!j.ludotheque ? blocContreparties(contreparties.filter((c) => c.jeu_edition_id === je.id), !ro, "Contreparties demandées en échange") : ""}
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
// Quitter l'écran coupe la caméra si un scan était ouvert (appelé par le routeur).
export function unmount() { fermerScan(null); }
const msgEl = () => root.querySelector("#j-msg") || root.querySelector("#a-msg") || root.querySelector("#m-msg");
const dire = (t) => { const m = msgEl(); if (m) m.textContent = t; };

// Contexte d'une contrepartie ajoutée depuis la fiche d'un jeu : due à qui on l'a demandé.
function contexteContrepartieJeu() {
  const j = jeux.get(ficheId), je = sel.get(ficheId); if (!j || !je) return null;
  let qui = (je.provenance_detail || (j.editeur_id ? orgNom(j.editeur_id) : "")).trim();
  if (!qui) qui = (prompt("À qui doit-on cette contrepartie ?") || "").trim();
  const org = j.editeur_id && qui === orgNom(j.editeur_id) ? j.editeur_id : null;
  return { edition_id: store.editionId, beneficiaire: qui, organisme_id: org, origine: "jeu", jeu_edition_id: je.id };
}

async function onClick(e) {
  const t = e.target;
  if (mode === "fiche" && t.closest("[data-cpfait],[data-cpdel],[data-cpadd]")) {
    if (await actionContrepartie(t, contreparties, contexteContrepartieJeu)) go();
    return;
  }
  if (t.closest("[data-scan-cam]")) { const code = await ouvrirScan(); if (code) await scanner(code); return; }
  const op = t.closest("[data-obtenuprov]");
  if (op) { const [id, prov] = op.dataset.obtenuprov.split("|"); return obtenu(id, prov); }
  const me = t.closest("[data-methode]");
  if (me) { ajout.methode = me.dataset.methode; return go(); }
  const tb = t.closest("[data-tab]");
  if (tb) { tab = tb.dataset.tab; mode = "list"; return go(); }
  if (t.closest("#retour")) {
    if (mode === "tri") { await load(); tab = "ludo"; }  // le tri a pu changer la sélection
    mode = "list"; return go();
  }
  if (t.closest("#ajouter")) { ajout = { q: "", asso: tab === "ludo", prendre: true, bgg: null, msg: "", ean: "", prov: "don", detail: "", upcStatus: null }; mode = "ajout"; return go(); }
  if (t.closest("#modifier")) { ficheMode = "edition"; return go(); }
  if (t.closest("#to-manuel")) { mode = "manuel"; return go(); }
  if (t.closest("#to-ajout")) { mode = "ajout"; return go(); }
  if (t.closest("#to-csv") || t.closest("#l-csv")) { csvMsg = ""; mode = "csv"; return go(); }
  if (t.closest("#l-tri")) { mode = "tri"; return go(); }
  if (t.closest("#copier-obtenir")) return copierObtenir();
  if (t.closest("#l-nd")) { ludoNonDecides = !ludoNonDecides; return go(); }
  if (t.closest("#f-sansanim")) { filt.sansAnim = !filt.sansAnim; return go(); }
  if (t.closest("#m-create")) return creerManuel();
  if (t.closest("#csv-go")) return importCsv();
  if (t.closest("#csv-tpl")) return modeleCsv();
  if (t.closest("#save")) return enregistrer();
  if (t.closest("#bgg-update")) return majBgg();
  if (t.closest("#lier-bgg")) return lierBgg();
  if (t.closest("#retirer")) return retirerDuFestival(jeux.get(ficheId));
  if (t.closest("#refuse")) { const je = sel.get(ficheId); if (je) return refuser(je.id); }
  if (t.closest("#garder-ludo")) return garderDansLudo(jeux.get(ficheId));
  if (t.closest("#suppr-jeu")) return supprimerJeu(jeux.get(ficheId));
  if (t.closest("#new-ed-go")) return ajouterEditeur(root.querySelector("#new-ed")?.value);
  const b = t.closest("[data-choix],[data-aufestival],[data-bgg],[data-addeditor],[data-associer],[data-mdel],[data-madd],[data-mcopy],[data-bon],[data-toutrendu],[data-demande],[data-refus],[data-copietitres],[data-tab],[data-open]");
  if (!b) return;
  if (b.dataset.choix) { const [id, c] = b.dataset.choix.split("|"); return choisir(id, c); }
  if (b.dataset.aufestival) {
    const j = jeux.get(b.dataset.aufestival);
    if (mode === "ajout") { if (!j.ludotheque && !provenanceOk()) return; await memoriserEan(j); }
    return ajouterAuFestival(j);
  }
  if (b.dataset.bgg != null) return ajouterDepuisBgg(ajout.bgg?.[+b.dataset.bgg]);
  if (b.dataset.addeditor) return ajouterEditeur(b.dataset.addeditor);
  if (b.dataset.mdel) return retirerMalle(b.dataset.mdel);
  if (b.dataset.mcopy) return copierMalle(b.dataset.mcopy);
  if (b.dataset.demande) return marquerDemande(b.dataset.demande);
  if (b.dataset.refus) return refuser(b.dataset.refus);
  if (b.dataset.copietitres != null) { try { await navigator.clipboard.writeText(b.dataset.copietitres); toast("Liste copiée.", "ok"); } catch { prompt("Copie cette liste :", b.dataset.copietitres); } return; }
  if (b.dataset.bon || b.dataset.toutrendu) {
    const g = new Map(groupesPrets()).get(b.dataset.bon || b.dataset.toutrendu); if (!g) return;
    if (b.dataset.toutrendu) return marquerRendu(g.lignes.filter((je) => !je.rendu).map((je) => je.id), true);
    const { data: ed } = await supa.from("editions").select("nom").eq("id", store.editionId).single();
    try { bonRestitution(g.nom, ed?.nom || "", g.lignes.map((je) => ({ titre: jeux.get(je.jeu_id).titre, exemplaires: je.exemplaires, rendu: je.rendu }))); }
    catch (e) { toast("Erreur export : " + (e.message || e)); }
    return;
  }
  if (b.dataset.madd) return ajouterMalle(b.dataset.madd, root.querySelector("#f-malle")?.value);
  if (b.dataset.associer) { const j = jeux.get(b.dataset.associer); await memoriserEan(j); return apresCreation(j); }
  if (b.dataset.open) { ficheId = b.dataset.open; ficheMode = "lecture"; mode = "fiche"; window.scrollTo(0, 0); return go(); }
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
  if (t.id === "f-prov") { filt.prov = t.value; return go(); }
  if (t.id === "f-cat") { filt.categorie = t.value; return go(); }
  if (t.id === "f-editeur") { filt.editeur = t.value; return go(); }
  // Choisir « comment » revient à dire que le jeu est obtenu.
  if (t.matches('[data-e="provenance"]')) { const st = root.querySelector('[data-e="statut"]'); if (st && t.value) st.value = "recu"; return; }
  if (t.matches("[data-origine]")) {
    ajout.asso = t.value === "asso";
    // Garder ce qui a été tapé dans le formulaire manuel.
    if (mode === "manuel") ajout.q = root.querySelector('[data-m="titre"]')?.value || ajout.q;
    return go();
  }
  if (t.matches("[data-prendre]")) { ajout.prendre = t.checked; return; }
  if (t.matches("[data-prov]")) {
    ajout.prov = t.value;
    if (mode === "manuel") ajout.q = root.querySelector('[data-m="titre"]')?.value || ajout.q;
    return go();
  }
  if (t.matches("[data-detail]")) { ajout.detail = t.value; return; }
  if (t.matches("[data-rendu]")) return marquerRendu([t.dataset.rendu], t.checked);
  if (t.matches("[data-obtenu]") && t.value) return obtenu(t.dataset.obtenu, t.value);
  if (t.id === "csv-file") { const fl = t.files[0]; if (fl) fl.text().then((x) => { const ta = root.querySelector("#csv-text"); if (ta) ta.value = x; }); }
}
function onSubmit(e) {
  if (e.target.id === "malle-form") {
    e.preventDefault();
    const titre = (root.querySelector("#m-jeu")?.value || "").trim();
    const malle = root.querySelector("#m-malle")?.value;
    if (!titre) { toast("Tape le titre du jeu."); return; }
    const connus = [...jeux.values()].filter((x) => comparable(x.titre) === comparable(titre));
    const j = connus.find((x) => x.ludotheque) || connus[0];
    if (j) return ajouterMalle(j.id, malle);
    return creerPourMalle(titre, malle);
  }
  if (e.target.id === "scan-form") { e.preventDefault(); return scanner(root.querySelector("#scan")?.value); }
  if (e.target.id !== "a-form") return;
  e.preventDefault();
  chercherBgg();
}

/* ---------- code-barre ---------- */
// Code connu → fiche du jeu. Inconnu → on interroge gameupc (UPC → numéro BGG) pour proposer
// le jeu directement ; sinon repli sur la recherche par nom. Le code sera enregistré avec le
// jeu choisi (une douchette tape les chiffres puis « Entrée », comme un clavier).
async function scanner(v) {
  const code = chiffres(v);
  if (code.length < 6) { toast("Code-barre trop court."); return; }
  const j = parEan(code);
  if (j) { ficheId = j.id; ficheMode = "lecture"; mode = "fiche"; window.scrollTo(0, 0); go(); if (!sel.has(j.id)) toast(`« ${j.titre} » : pas encore au festival.`, "warn"); return; }
  if (mode !== "ajout") ajout = { q: "", asso: tab === "ludo", prendre: true, bgg: null, msg: "", ean: code, prov: "don", detail: "", upcStatus: null };
  else { ajout.ean = code; ajout.upcStatus = null; }
  ajout.methode = "scan";
  mode = "ajout"; go();
  await chercherParCode(code);
}
// Demande à gameupc le(s) jeu(x) correspondant à un code inconnu, puis lit leur fiche sur BGG
// pour les présenter (un tap = « C'est ce jeu »). On retient le statut du lookup : si le code
// n'était pas déjà « verified », le jeu confirmé est renvoyé à gameupc (voir memoriserEan).
async function chercherParCode(code) {
  ajout.upcStatus = null;
  dire("Recherche du code sur gameupc…");
  const { data, error } = await supa.functions.invoke("gameupc", { body: { action: "lookup", upc: code } });
  ajout.upcStatus = data?.status ?? null;
  if (error || data?.error || !data?.suggestions?.length) {
    ajout.bgg = null;
    ajout.msg = "Code inconnu de gameupc : cherche le jeu par son nom ci-dessous.";
    go(); root.querySelector("#a-q")?.focus(); return;
  }
  dire("Lecture des fiches BGG…");
  const fiches = (await Promise.all(data.suggestions.slice(0, 8).map((s) => lireBgg(s.bgg_id)))).filter(Boolean);
  ajout.bgg = fiches;
  ajout.msg = !fiches.length ? "Code trouvé, mais fiche BGG indisponible : réessaie ou cherche par son nom."
    : data.status === "verified" ? "Jeu reconnu : confirme d'un tap." : "Plusieurs jeux possibles : choisis le bon.";
  go();
}
async function memoriserEan(j) {
  if (!j || !ajout.ean || j.ean) return;
  const code = ajout.ean;
  const { error } = await supa.from("jeux").update({ ean: code }).eq("id", j.id);
  if (error) { toast(error.code === "23505" ? "Ce code-barre est déjà associé à un autre jeu." : "Code-barre non enregistré : " + error.message); return; }
  j.ean = code;
  // Crowdsourcing gameupc : sauf si le code était déjà « verified », on renvoie le mapping
  // code → numéro BGG choisi (couvre « suggestions » et « code inconnu »), best-effort.
  if (j.bgg_id && ajout.upcStatus !== "verified") {
    supa.functions.invoke("gameupc", { body: { action: "vote", upc: code, bgg_id: j.bgg_id } }).catch(() => {});
  }
  ajout.ean = "";
}

/* ---------- actions ---------- */
// Un prêt doit dire auprès de qui (restitution). Vrai si l'ajout peut continuer.
// (Plus de provenance à l'ajout : elle se choisit quand le jeu est obtenu.)
function provenanceOk() { return true; }
// « Demandé à l'éditeur » : tous les jeux à demander de cet éditeur passent en « Demandé ».
async function marquerDemande(ed) {
  const ed2 = (je) => { const e = jeux.get(je.jeu_id).editeur_id; return e && !(je.notes || "").includes(`Refusé par ${orgNom(e)}`) ? e : "?"; };
  const liste = aObtenirFestival().filter((je) => je.statut === "souhaite" && ed2(je) === ed);
  let aQui = ed !== "?" ? orgNom(ed) : (prompt("Demandé à qui ? (ludothèque, boutique…)") || "").trim();
  if (!aQui || !liste.length) return;
  const { error } = await supa.from("jeux_editions").update({ statut: "demande", provenance_detail: aQui }).in("id", liste.map((je) => je.id));
  if (error) return toast("Erreur : " + error.message);
  liste.forEach((je) => { je.statut = "demande"; je.provenance_detail = aQui; });
  // La base note le contact sur la fiche de l'éditeur : refléter ici sans recharger.
  if (ed !== "?") { const st = edStatut.get(ed) || { statut: "invite" }; edStatut.set(ed, { ...st, dernier_contact: aujourdhui() }); edIdsIci.add(ed); }
  go();
  toast(`${plur(liste.length, "jeu demandé", "jeux demandés")} à ${aQui}.`, "ok");
}
// Obtenu (don, prêt ou achat) : le prêteur est celui à qui on l'a demandé.
async function obtenu(id, prov) {
  const je = [...sel.values()].find((x) => x.id === id); if (!je) return;
  if (prov === "pret" && !je.provenance_detail) { toast("Pour un prêt, indique d'abord à qui tu l'as demandé (fiche du jeu)."); return go(); }
  const { error } = await supa.from("jeux_editions").update({ statut: "recu", provenance: prov }).eq("id", id);
  if (error) return toast("Erreur : " + error.message);
  je.statut = "recu"; je.provenance = prov;
  go();
  toast(`« ${jeux.get(je.jeu_id).titre} » obtenu (${provLbl(prov).toLowerCase()}).`, "ok");
}
// Refusé : retour « À obtenir », avec une note datée pour se souvenir à qui on l'a déjà demandé.
async function refuser(id) {
  const je = [...sel.values()].find((x) => x.id === id); if (!je) return;
  const note = [je.notes, `Refusé par ${je.provenance_detail || "?"} le ${aujourdhui()}`].filter(Boolean).join("\n");
  const { error } = await supa.from("jeux_editions").update({ statut: "souhaite", provenance: null, provenance_detail: null, notes: note }).eq("id", id);
  if (error) return toast("Erreur : " + error.message);
  Object.assign(je, { statut: "souhaite", provenance: null, provenance_detail: null, notes: note });
  go();
  toast("Noté : à chercher ailleurs (ludothèque, boutique, achat).", "ok");
}
async function marquerRendu(ids, rendu) {
  const patch = { rendu, rendu_le: rendu ? aujourdhui() : null };
  const { error } = await supa.from("jeux_editions").update(patch).in("id", ids);
  if (error) { toast("Erreur : " + error.message); return; }
  [...sel.values()].filter((je) => ids.includes(je.id)).forEach((je) => Object.assign(je, patch));
  go();
}

async function ajouterMalle(jeuId, nom) {
  nom = (nom || "").trim();
  if (!nom) { toast("Indique le nom de la malle."); return; }
  if (malles.some((m) => m.jeu_id === jeuId && m.malle === nom)) { toast("Ce jeu est déjà dans cette malle."); return; }
  const j = jeux.get(jeuId);
  if (j && j.ludotheque && besoinAvecUneMalleDePlus(j) > possedes(j)
    && !confirm(`Pas assez d'exemplaires de « ${j.titre} » pour une malle de plus : ${plur(possedes(j), "exemplaire possédé", "exemplaires possédés")}, déjà en malle (${usageTexte(j)}).\n\nL'ajouter quand même à « ${nom} » ? Il passera dans la liste « À obtenir ».\n(Si l'asso en a en réalité plus, corrige plutôt le nombre d'exemplaires sur sa fiche.)`)) return;
  const { data, error } = await supa.from("malle_jeux").insert({ edition_id: store.editionId, jeu_id: jeuId, malle: nom }).select("id, jeu_id, malle").single();
  if (error) { toast("Erreur : " + error.message); return; }
  malles.push(data);
  go();
  if (j && !j.ludotheque) toast(`« ${j.titre} » n'est pas à l'asso : il est dans « À obtenir ».`, "warn");
  if (mode === "list") root.querySelector("#m-jeu")?.focus();  // enchaîner les ajouts
}
async function copierObtenir() {
  const texte = aObtenir().map((j) => `${j.titre} — manque ${manque(j)} (${usageTexte(j)})`).join("\n");
  try { await navigator.clipboard.writeText(texte); toast("Liste copiée.", "ok"); } catch { prompt("Copie cette liste :", texte); }
}
// Copie tous les jeux d'une malle vers une autre (nouvelle ou existante), sans doublon.
async function copierMalle(source) {
  const autres = nomsEcoles().filter((n) => n !== source);
  if (!autres.length) { toast("Aucune autre école retenue vers laquelle copier."); return; }
  let cible = autres[0];
  if (autres.length > 1) {
    const rep = (prompt(`Copier les jeux de « ${source} » vers quelle école ?\n${autres.map((n, i) => `${i + 1}. ${n}`).join("\n")}\n\nTape le numéro :`) || "").trim();
    cible = autres[(parseInt(rep, 10) || 0) - 1];
    if (!cible) return;
  } else if (!confirm(`Copier les jeux de « ${source} » dans la malle de « ${cible} » ?`)) return;
  const deja = new Set(malles.filter((m) => m.malle === cible).map((m) => m.jeu_id));
  const rows = malles.filter((m) => m.malle === source && !deja.has(m.jeu_id))
    .map((m) => ({ edition_id: store.editionId, jeu_id: m.jeu_id, malle: cible }));
  if (!rows.length) { toast(`« ${cible} » contient déjà tous ces jeux.`); return; }
  const manquants = rows.map((r) => jeux.get(r.jeu_id)).filter((j) => j && j.ludotheque && besoinAvecUneMalleDePlus(j) > possedes(j));
  if (manquants.length && !confirm(`${plur(manquants.length, "jeu n'a", "jeux n'ont")} plus d'exemplaire libre (${manquants.slice(0, 5).map((j) => j.titre).join(", ")}${manquants.length > 5 ? "…" : ""}).\n\nCopier quand même ? Ils passeront dans la liste « À obtenir ».`)) return;
  const { data, error } = await supa.from("malle_jeux").insert(rows).select("id, jeu_id, malle");
  if (error) { toast("Erreur : " + error.message); return; }
  malles.push(...(data || []));
  go();
  toast(`${plur(rows.length, "jeu copié", "jeux copiés")} dans « ${cible} ».`, "ok");
}
// Jeu inconnu ajouté à une malle : créé au catalogue (pas à l'asso), donc « à obtenir ».
async function creerPourMalle(titre, malle) {
  if (!malle) { toast("Choisis la malle de l'école."); return; }
  if (!confirm(`« ${titre} » n'est pas dans nos jeux.\n\nLe créer et l'ajouter à la malle de « ${malle} » ? Il passera dans « À obtenir » (pense ensuite à « Lier à BGG » sur sa fiche pour l'image et les infos).`)) return;
  const { data: j, error } = await supa.from("jeux").insert({ titre, ludotheque: false, exemplaires_asso: 0 }).select().single();
  if (error) { toast("Erreur : " + error.message); return; }
  jeux.set(j.id, j);
  await ajouterMalle(j.id, malle);
}
async function retirerMalle(id) {
  const { error } = await supa.from("malle_jeux").delete().eq("id", id);
  if (error) { toast("Erreur : " + error.message); return; }
  malles = malles.filter((m) => m.id !== id);
  go();
}

async function choisir(jeuId, c) {
  if (!canWrite()) return toast("Réservé au pôle Jeux & éditeurs.");
  const { error } = await supa.from("ludotheque_choix")
    .upsert({ edition_id: store.editionId, jeu_id: jeuId, choix: c }, { onConflict: "edition_id,jeu_id" });
  if (error) return toast("Erreur : " + error.message);  // ex. jeu programmé dans une partie
  choix.set(jeuId, c);
  await rechargerSelection();
  go();
}

// Ajoute un jeu connu à ce festival : jeu de l'asso → tri « Oui » ; sinon jeu à obtenir
// statut « À obtenir », sans provenance (connue seulement une fois obtenu).
async function ajouterAuFestival(j) {
  if (!j || sel.has(j.id)) return;
  if (j.ludotheque) return choisir(j.id, "oui");
  const { data, error } = await supa.from("jeux_editions")
    .insert({ jeu_id: j.id, edition_id: store.editionId, statut: "souhaite", usages: ["animation"],
      provenance: null, provenance_detail: null }).select().single();
  if (error) return toast("Erreur : " + error.message);
  sel.set(j.id, data);
  go();
}
// Jeu acheté ou donné, reçu : il entre dans la ludothèque (statut « jeu de l'asso », tri « Oui »).
async function garderDansLudo(j) {
  const je = j && sel.get(j.id); if (!je) return;
  if (!confirm(`« ${j.titre} » entre dans la ludothèque de l'asso ?`)) return;
  const [r1, r2] = await Promise.all([
    supa.from("jeux").update({ ludotheque: true, exemplaires_asso: Math.max(1, j.exemplaires_asso || 0) }).eq("id", j.id),
    supa.from("jeux_editions").update({ statut: "deja_asso" }).eq("id", je.id),
  ]);
  if (r1.error || r2.error) return toast("Erreur : " + (r1.error || r2.error).message);
  j.ludotheque = true; je.statut = "deja_asso"; j.exemplaires_asso = Math.max(1, j.exemplaires_asso || 0);
  const c = (je.usages || []).includes("bar") && !(je.usages || []).includes("animation") ? "bar" : "oui";
  const { error } = await supa.from("ludotheque_choix").upsert({ edition_id: store.editionId, jeu_id: j.id, choix: c }, { onConflict: "edition_id,jeu_id" });
  if (!error) choix.set(j.id, c);
  go();
  toast("Ajouté à la ludothèque.", "ok");
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
  await memoriserEan(j);
  if (sel.has(j.id)) { /* déjà au festival */ }
  else if (j.ludotheque && ajout.prendre) await choisir(j.id, "oui");
  else if (!j.ludotheque) await ajouterAuFestival(j);
  ficheId = j.id; ficheMode = "lecture"; mode = "fiche"; go();
}

async function chercherBgg() {
  const q = ajout.q.trim();
  if (!q) { ajout.msg = "Saisis un nom de jeu."; return go(); }
  // Lien BGG collé : on va chercher directement ce jeu-là.
  const idLien = bggIdDepuis(q);
  if (idLien) {
    dire("Lecture de la fiche BGG…");
    const r = await lireBgg(idLien);
    ajout.bgg = r ? [r] : [];
    ajout.msg = r ? "" : "Fiche BGG introuvable ou BGG indisponible.";
    return go();
  }
  dire("Recherche sur BGG…");
  const { data, error } = await supa.functions.invoke("bgg-import", { body: { action: "search", query: q } });
  if (error || data?.error) { ajout.bgg = []; ajout.msg = "BGG indisponible pour le moment : « Saisir à la main »."; return go(); }
  ajout.bgg = data?.results ?? [];
  ajout.msg = ajout.bgg.length ? "" : "Aucun résultat sur BGG : « Saisir à la main ».";
  go();
}
async function ajouterDepuisBgg(r) {
  if (!r || !provenanceOk()) return;
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
  if (!provenanceOk()) return;
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

// Une fiche BGG par son numéro (action « thing » de la fonction bgg-import), ou null.
async function lireBgg(id) {
  const { data, error } = await supa.functions.invoke("bgg-import", { body: { action: "thing", bgg_id: id } });
  if (error || !data || data.error || !data.bgg_id) return null;
  return data;
}

// Jeu saisi à la main : le relier à sa fiche BGG (numéro, image, joueurs, durée, âge,
// éditeur). Le titre saisi est gardé (il peut être le titre français).
async function lierBgg() {
  const j = jeux.get(ficheId); if (!j) return;
  const id = bggIdDepuis(root.querySelector("#lien-bgg")?.value);
  if (!id) return dire("Colle l'adresse d'une fiche BGG (boardgamegeek.com/boardgame/…).");
  const autre = [...jeux.values()].find((x) => x.bgg_id === id && x.id !== j.id);
  if (autre) {
    root.querySelector("#j-msg").innerHTML = `Cette fiche BGG est déjà reliée à « ${esc(autre.titre)} ». <button class="btn small" data-open="${autre.id}">Ouvrir</button>`;
    return;
  }
  dire("Lecture de la fiche BGG…");
  const r = await lireBgg(id);
  if (!r) return dire("Fiche BGG introuvable ou BGG indisponible.");
  const patch = { bgg_id: r.bgg_id, annee: r.annee ?? j.annee, image_url: r.image_url || j.image_url,
    miniature_url: r.miniature_url || j.miniature_url, joueurs_min: r.joueurs_min ?? j.joueurs_min,
    joueurs_max: r.joueurs_max ?? j.joueurs_max, duree_min: r.duree_min ?? j.duree_min, age_min: r.age_min ?? j.age_min,
    categorie_id: j.categorie_id || suggestCat(r.age_min), editeur_id: j.editeur_id || editeurConnu(r.editeurs) };
  const { error } = await supa.from("jeux").update(patch).eq("id", j.id);
  if (error) return dire(error.code === "23505" ? "Cette fiche BGG est déjà reliée à un autre jeu." : "Erreur : " + error.message);
  Object.assign(j, patch);
  bggEditeurs.set(j.id, r.editeurs || []);
  go();
  toast(`Relié à BGG : « ${r.titre} ».`, "ok");
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
    categorie_id: g("categorie_id").value || null, editeur_id: g("editeur_id").value || null, ludotheque: asso,
    ean: chiffres(g("ean")?.value) || null };
  if (g("exemplaires_asso")) jPatch.exemplaires_asso = Math.max(0, numOrNull(g("exemplaires_asso").value) ?? 1);
  // Jeu qui devient « de l'asso » (ex. obtenu pour une malle) : au moins 1 exemplaire.
  else if (asso && !j.ludotheque && !(j.exemplaires_asso > 0)) jPatch.exemplaires_asso = 1;
  if (jPatch.ean && !/^\d{6,14}$/.test(jPatch.ean)) return dire("Code-barre : 6 à 14 chiffres.");
  const imgIn = g("image_url");
  if (imgIn) { const v = imgIn.value.trim(); jPatch.image_url = /^https?:\/\//i.test(v) ? v : null; }
  let ePatch = null;
  if (je) {
    const usages = [...root.querySelectorAll("[data-usage]")].filter((c) => c.checked).map((c) => c.dataset.usage);
    // Jeu de l'asso : statut « Déjà à l'asso » ; jeu à obtenir : statut et provenance choisis.
    const st = e("statut")?.value;
    ePatch = { statut: asso ? "deja_asso" : (st && st !== "deja_asso" ? st : "souhaite"),
      ...(e("provenance") ? { provenance: e("provenance").value, provenance_detail: (e("provenance_detail")?.value || "").trim() || null } : {}),
      ...(e("rendu") ? { rendu: e("rendu").checked, rendu_le: e("rendu").checked ? (je.rendu_le || aujourdhui()) : null } : {}),
      exemplaires: numOrNull(e("exemplaires").value) || 1, usages: usages.length ? usages : ["animation"],
      element_id: e("element_id").value || null, notes: e("notes").value || null };
  }
  if (ePatch && !asso) {
    if (ePatch.provenance === "") ePatch.provenance = null;
    if (ePatch.statut === "recu" && !ePatch.provenance) return dire("Jeu obtenu : indique comment (don, prêt ou achat).");
    if (ePatch.statut !== "recu" && ePatch.provenance) ePatch.statut = "recu";
    if (ePatch.provenance === "pret" && !ePatch.provenance_detail) return dire("Pour un prêt, indique auprès de qui (il faudra rendre le jeu).");
  }
  const [r1, r2] = await Promise.all([
    supa.from("jeux").update(jPatch).eq("id", j.id),
    je ? supa.from("jeux_editions").update(ePatch).eq("id", je.id) : Promise.resolve({ error: null }),
  ]);
  if (r1.error?.code === "23505") return dire("Ce code-barre est déjà associé à un autre jeu.");
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
  ean: ["ean", "ean13", "upc", "codebarre", "codebarres", "gencod"],
  exemplaires: ["exemplaires", "nb", "quantite", "qte", "copies"],
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
  const nouveaux = [], aMarquer = new Set(), eansVus = new Set(); let vides = 0;
  for (let r = 1; r < rows.length; r++) {
    const get = (k) => (idx[k] != null ? (rows[r][idx[k]] || "").trim() : "");
    const titre = get("titre"); if (!titre) { vides++; continue; }
    const bgg = numOrNull(get("bgg_id"));
    const ean = /^\d{6,14}$/.test(chiffres(get("ean"))) ? chiffres(get("ean")) : null;
    const connu = (ean && parEan(ean)) || (bgg && parBgg.get(bgg)) || parTitre.get(comparable(titre));
    if (connu) { if (!connu.ludotheque) aMarquer.add(connu.id); continue; }
    parTitre.set(comparable(titre), { id: null, titre });
    const img = get("image_url");
    nouveaux.push({ titre, annee: numOrNull(get("annee")), joueurs_min: numOrNull(get("joueurs_min")),
      joueurs_max: numOrNull(get("joueurs_max")), duree_min: numOrNull(get("duree_min")), age_min: numOrNull(get("age_min")),
      image_url: /^https?:\/\//i.test(img) ? img : null, bgg_id: bgg, ean: ean && !eansVus.has(ean) ? (eansVus.add(ean), ean) : null,
      categorie_id: catParNom.get(norm(get("categorie"))) || null, ludotheque: true,
      exemplaires_asso: Math.max(0, numOrNull(get("exemplaires")) ?? 1) });
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
