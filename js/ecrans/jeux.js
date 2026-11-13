// Écran #/jeux — grille de pochettes, filtres, import BGG, usages multiples,
// table du plan, bloc animateurs (alimenté par Compétences).
import { supa } from "../supabase.js";
import { isAdmin, hasPole } from "../auth.js";
import { store } from "../store.js";
import { esc, plur } from "../ui/util.js";
import * as swipe from "./selection-swipe.js";

const STATUTS = [["souhaite", "Souhaité"], ["demande", "Demandé"], ["recu", "Reçu"], ["deja_asso", "Déjà à l'asso"]];
const STATUT_PILL = { souhaite: "grey", demande: "amber", recu: "ok", deja_asso: "blue" };
const USAGES = [["animation", "Animation"], ["tombola", "Tombola"]];
const BGG = `<p class="mini bgg-foot">Données et images : <a href="https://boardgamegeek.com" target="_blank" rel="noopener">Powered by BGG</a></p>`;

let root, list = [], cats = [], orgs = [], comps = [], benes = [], beneIds = new Set(), tables = [], loadErr = "";
let filt = { q: "", statut: "", categorie: "", editeur: "", sansAnim: false };
let view = { mode: "list", id: null, tab: "editeurs" };
let bggResults = null, bggMsg = "";

const stLabel = (k) => (STATUTS.find((s) => s[0] === k) || [k, k])[1];
const catNom = (id) => cats.find((c) => c.id === id)?.nom || "—";
const orgNom = (id) => orgs.find((o) => o.id === id)?.nom || "—";
const beneNom = (id) => benes.find((b) => b.id === id)?.nom || "?";
const tableLabel = (id) => { const t = tables.find((x) => x.id === id); return t ? `Table ${t.numero || "?"}${t.salles?.nom ? " · " + t.salles.nom : ""}` : null; };
const canWrite = () => isAdmin() || hasPole("jeux_editeurs");

export async function render(container, sub) {
  root = container;
  view = { mode: "list", id: null, tab: "editeurs" };
  filt.editeur = sub || "";
  if (!store.editionId) {
    root.innerHTML = `<div class="page-head"><div><h1>Sélection Jeux</h1><div class="sub">Aucune édition sélectionnée</div></div></div>
      <div class="card"><p><a class="btn primary" href="#/editions">Choisir une édition</a></p></div>`;
    return;
  }
  await load();
  wireOnce();
  go();
}

async function load() {
  loadErr = "";
  const ed = store.editionId;
  const [je, c, o, cp, be, el] = await Promise.all([
    supa.from("jeux_editions").select("*, jeux(*)").eq("edition_id", ed),
    supa.from("categories_jeux").select("id,nom,type,ordre").order("ordre"),
    supa.from("organismes").select("id,nom").order("nom"),
    supa.from("competences").select("benevole_id, jeu_id, categorie_id, niveau"),
    supa.from("benevoles_editions").select("benevole:benevoles(id,nom)").eq("edition_id", ed),
    supa.from("elements").select("id, numero, salle_id, salles(nom)").eq("edition_id", ed).eq("kind", "table"),
  ]);
  if (je.error) { loadErr = je.error.message; list = []; } else list = (je.data ?? []).filter((x) => x.jeux);
  cats = c.data ?? []; orgs = o.data ?? []; comps = cp.data ?? [];
  // Bénévoles de l'édition courante uniquement (competences est au niveau personne, persistant).
  beneIds = new Set();
  benes = (be.data ?? []).map((x) => x.benevole).filter(Boolean).filter((b) => (beneIds.has(b.id) ? false : beneIds.add(b.id)));
  tables = (el.data ?? []).sort((a, b) => (parseInt(a.numero, 10) || 0) - (parseInt(b.numero, 10) || 0));
}

// Niveau d'un bénévole pour un jeu : réponse sur le jeu puis sur sa catégorie.
function niveauFor(benevoleId, jeu) {
  const cj = comps.find((c) => c.benevole_id === benevoleId && c.jeu_id === jeu.id);
  if (cj) return cj.niveau;
  const cc = comps.find((c) => c.benevole_id === benevoleId && c.categorie_id && c.categorie_id === jeu.categorie_id);
  return cc ? cc.niveau : "non";
}
function animFor(jeu) {
  const seen = {}, anime = [], apprendre = [];
  comps.forEach((c) => {
    if (!beneIds.has(c.benevole_id) || c.benevole_id in seen) return; // seulement l'édition courante
    const niv = niveauFor(c.benevole_id, jeu);
    if (niv === "anime" || niv === "apprendre") {
      seen[c.benevole_id] = niv;
      (niv === "anime" ? anime : apprendre).push(beneNom(c.benevole_id));
    }
  });
  return { anime, apprendre };
}
const estAnimation = (je) => (je.usages || []).includes("animation");
const sansAnimateur = (je) => estAnimation(je) && animFor(je.jeux).anime.length === 0;

function go() {
  root.innerHTML = view.mode === "fiche" ? ficheView()
    : view.mode === "bgg" ? bggView()
    : view.mode === "manual" ? manualView()
    : listView();
  if (view.mode === "list" && view.tab === "ludo") {
    const mount = root.querySelector("#ludo-mount");
    if (mount) swipe.render(mount);
  }
}

/* ---------- grille ---------- */
function filtered() {
  const q = filt.q.trim().toLowerCase();
  return list.filter((je) => {
    const j = je.jeux;
    if (filt.editeur && j.editeur_id !== filt.editeur) return false;
    if (q && !j.titre.toLowerCase().includes(q)) return false;
    if (filt.statut && je.statut !== filt.statut) return false;
    if (filt.categorie && j.categorie_id !== filt.categorie) return false;
    if (filt.sansAnim && !sansAnimateur(je)) return false;
    return true;
  }).sort((a, b) => a.jeux.titre.localeCompare(b.jeux.titre, "fr"));
}
function card(je) {
  const j = je.jeux, a = animFor(j), nbAnim = a.anime.length;
  const img = j.miniature_url || j.image_url;
  const usages = (je.usages || []).map((u) => `<span class="pill grey">${esc((USAGES.find((x) => x[0] === u) || [u, u])[1])}</span>`).join(" ");
  const tbl = je.element_id ? esc(tableLabel(je.element_id) || "Table ?") : "Non placé";
  return `<div class="jeu-card" data-open="${je.id}">
    <div class="jeu-img">${img ? `<img src="${esc(img)}" alt="" loading="lazy">` : `<span>Image BGG</span>`}</div>
    <b>${esc(j.titre)}${j.annee ? ` <span class="mini">(${j.annee})</span>` : ""}</b>
    <div class="jeu-pills"><span class="pill ${STATUT_PILL[je.statut]}">${esc(stLabel(je.statut))}</span> ${usages}</div>
    ${sansAnimateur(je) ? `<div><span class="pill alert">Aucun animateur</span></div>` : ""}
    <div class="jeu-foot">${estAnimation(je) ? plur(nbAnim, "animateur", "animateurs") + " · " : ""}${tbl}</div>
  </div>`;
}
function listView() {
  const grid = filtered().map(card).join("")
    || `<p class="muted">${loadErr ? "Erreur : " + esc(loadErr) : "Aucun jeu pour ces filtres."}</p>`;
  const nd = list.filter((x) => x.statut === "demande").length;
  const nr = list.filter((x) => x.statut === "recu").length;
  const nsa = list.filter(sansAnimateur).length;
  const sOpts = `<option value="">Tous statuts</option>` + STATUTS.map((s) => `<option value="${s[0]}"${filt.statut === s[0] ? " selected" : ""}>${s[1]}</option>`).join("");
  const cOpts = `<option value="">Toutes catégories</option>` + cats.map((c) => `<option value="${c.id}"${filt.categorie === c.id ? " selected" : ""}>${esc(c.nom)}</option>`).join("");
  const eIds = [...new Set(list.map((x) => x.jeux.editeur_id).filter(Boolean))];
  const eOpts = `<option value="">Tous éditeurs</option>` + eIds.map((id) => `<option value="${id}"${filt.editeur === id ? " selected" : ""}>${esc(orgNom(id))}</option>`).join("");
  const tabs = `<div class="utabs">
    <button data-tab="editeurs"${view.tab === "editeurs" ? ' class="on"' : ""}>Demandés &amp; reçus</button>
    <button data-tab="ludo"${view.tab === "ludo" ? ' class="on"' : ""}>Trier la ludothèque</button></div>`;
  const head = `<div class="page-head"><div><h1>Sélection Jeux</h1>
    <div class="sub">${plur(nr, "reçu", "reçus")} · ${plur(nd, "demandé", "demandés")} · ${nsa} sans animateur</div></div>
    <div class="head-actions">${canWrite() && view.tab === "editeurs" ? `<button class="btn primary" id="new-jeu">+ Ajouter un jeu</button>` : ""}</div></div>`;
  if (view.tab === "ludo") return head + tabs + `<div id="ludo-mount"></div>`;
  return head + tabs + `<div class="card">
      <div class="jeux-filters">
        <input id="f-q" placeholder="Rechercher un titre…" value="${esc(filt.q)}">
        <select id="f-statut">${sOpts}</select>
        <select id="f-cat">${cOpts}</select>
        <select id="f-editeur">${eOpts}</select>
        <button class="btn small${filt.sansAnim ? " primary" : ""}" id="f-sansanim">Sans animateur (${nsa})</button>
      </div>
      <div class="jeux-grid">${grid}</div>
      ${BGG}
    </div>`;
}

/* ---------- import BGG ---------- */
function bggView() {
  const res = bggResults == null ? "" : (bggResults.length
    ? bggResults.map((r, i) => `<div class="row">
        <div class="bgg-thumb">${r.miniature_url ? `<img src="${esc(r.miniature_url)}" alt="">` : "Image"}</div>
        <div class="row-main"><b>${esc(r.titre)}${r.annee ? ` <span class="mini">(${r.annee})</span>` : ""}</b>
          <span class="muted">${r.joueurs_min || "?"}-${r.joueurs_max || "?"} joueurs · ${r.duree_min || "?"} min · dès ${r.age_min || "?"} ans</span></div>
        <div class="actions"><button class="btn primary" data-import="${i}">Importer</button></div>
      </div>`).join("")
    : `<p class="muted">Aucun résultat sur BGG.</p>`);
  return `<div class="page-head"><div><h1>Ajouter un jeu</h1><div class="sub">Recherche sur BoardGameGeek</div></div>
    <div class="head-actions"><button class="btn" id="back">← Liste</button></div></div>
    <div class="card">
      <div class="jeux-filters"><input id="bgg-q" placeholder="Nom du jeu…" value="">
        <button class="btn primary" id="bgg-search">Rechercher</button></div>
      <div class="list">${res}</div>
      <p class="mini">Après l'import, le jeu est créé pour cette édition avec le statut « Souhaité ». Choisis ensuite la catégorie, l'éditeur et les usages sur la fiche.</p>
      <hr>
      <div class="org-filters" style="justify-content:space-between"><span class="mini">Jeu introuvable sur BGG ?</span>
        <button class="btn" id="to-manual">Saisir à la main</button></div>
      <p class="msg" id="bgg-msg">${esc(bggMsg)}</p>
      ${BGG}
    </div>`;
}
function manualView() {
  return `<div class="page-head"><div><h1>Saisir un jeu à la main</h1><div class="sub">Sans BGG</div></div>
    <div class="head-actions"><button class="btn" id="to-bgg">← Recherche BGG</button></div></div>
    <div class="card" style="max-width:620px">
      ${f("Titre", `<input data-m="titre" placeholder="Nom du jeu">`)}
      <div class="row2">${f("Année", `<input type="number" data-m="annee">`)}${f("Catégorie", catSel(null, "data-m"))}</div>
      ${f("Éditeur", editeurSel(null, "data-m"))}
      <div class="row2">${f("Joueurs min", `<input type="number" data-m="joueurs_min">`)}${f("Joueurs max", `<input type="number" data-m="joueurs_max">`)}</div>
      <div class="row2">${f("Durée (min)", `<input type="number" data-m="duree_min">`)}${f("Âge min", `<input type="number" data-m="age_min">`)}</div>
      <button class="btn primary" id="m-create">Ajouter</button>
      <p class="msg" id="m-msg"></p>
    </div>`;
}

/* ---------- champs ---------- */
function f(l, inner) { return `<label>${l}${inner}</label>`; }
function catSel(id, attr) {
  return `<select ${attr}="categorie_id"><option value="">— catégorie —</option>${
    cats.map((c) => `<option value="${c.id}"${c.id === id ? " selected" : ""}>${esc(c.nom)}</option>`).join("")}</select>`;
}
function editeurSel(id, attr) {
  return `<select ${attr}="editeur_id"><option value="">— éditeur —</option>${
    orgs.map((o) => `<option value="${o.id}"${o.id === id ? " selected" : ""}>${esc(o.nom)}</option>`).join("")}</select>`;
}
// Catégorie suggérée depuis l'âge min BGG (jamais imposée).
function suggestCat(age) {
  if (age == null) return "";
  const byNom = (n) => cats.find((c) => c.nom.toLowerCase().includes(n))?.id || "";
  if (age <= 3) return byNom("3+"); if (age <= 6) return byNom("6+");
  if (age <= 8) return byNom("8+"); return byNom("familial");
}

/* ---------- fiche ---------- */
function ficheView() {
  const je = list.find((x) => x.id === view.id);
  if (!je) { view.mode = "list"; return listView(); }
  const j = je.jeux, w = canWrite(), ro = w ? "" : " disabled";
  const img = j.image_url || j.miniature_url;
  const a = animFor(j);
  const tOpts = `<option value="">— non placé —</option>` + tables.map((t) => `<option value="${t.id}"${t.id === je.element_id ? " selected" : ""}>Table ${esc(t.numero || "?")}${t.salles?.nom ? " · " + esc(t.salles.nom) : ""}</option>`).join("");
  const animRows = (a.anime.map((n) => `<div class="anim-row"><span>${esc(n)}</span><span class="pill ok">Anime</span></div>`).join("")
    + a.apprendre.map((n) => `<div class="anim-row"><span>${esc(n)}</span><span class="pill amber">Veut apprendre</span></div>`).join(""))
    || `<p class="muted">Personne n'a encore répondu pour ce jeu.</p>`;
  return `<div class="page-head"><div><h1>${esc(j.titre)}</h1>
    <div class="sub">${esc(catNom(j.categorie_id))}${j.editeur_id ? " · " + esc(orgNom(j.editeur_id)) : ""}</div></div>
    <div class="head-actions"><button class="btn" id="back">← Liste</button>${w ? `<button class="btn primary" id="save">Enregistrer</button>` : ""}</div></div>
    <div class="two">
      <div class="l card"><h2>Jeu</h2>
        <div class="jeu-fiche-top">
          <div class="jeu-img sm">${img ? `<img src="${esc(img)}" alt="">` : `<span>Image BGG</span>`}</div>
          <div class="jeu-fiche-meta">
            ${j.bgg_id ? `<span class="pill ok">Importé de BGG</span>
              <a class="link" href="https://boardgamegeek.com/boardgame/${j.bgg_id}" target="_blank" rel="noopener">Voir la fiche sur BGG</a>
              ${w ? `<button class="btn small" id="bgg-update">Mettre à jour depuis BGG</button>` : ""}` : `<span class="mini">Saisi à la main</span>`}
          </div>
        </div>
        ${f("Titre", `<input data-j="titre" value="${esc(j.titre)}"${ro}>`)}
        <div class="row2">${f("Année", `<input type="number" data-j="annee" value="${j.annee ?? ""}"${ro}>`)}${f("Catégorie", catSel(j.categorie_id, "data-j"))}</div>
        <label>Éditeur<div class="with-link">${editeurSel(j.editeur_id, "data-j")}${j.editeur_id ? `<a class="link" href="#/organismes/editeurs">Voir la fiche</a>` : ""}</div></label>
        <div class="row2">${f("Joueurs min", `<input type="number" data-j="joueurs_min" value="${j.joueurs_min ?? ""}"${ro}>`)}${f("Joueurs max", `<input type="number" data-j="joueurs_max" value="${j.joueurs_max ?? ""}"${ro}>`)}</div>
        <div class="row2">${f("Durée (min)", `<input type="number" data-j="duree_min" value="${j.duree_min ?? ""}"${ro}>`)}${f("Âge min", `<input type="number" data-j="age_min" value="${j.age_min ?? ""}"${ro}>`)}</div>
        <label>Ludothèque<div class="chk-row"><span class="chk-inline"><input type="checkbox" data-jbool="ludotheque"${j.ludotheque ? " checked" : ""}${ro}> Jeu de l'asso (apparaît dans le triage Ludothèque)</span></div></label>
        ${BGG}
      </div>
      <div class="r">
        <div class="card"><h2>Cette édition</h2>
          <div class="row2">${f("Statut", `<select data-e="statut"${ro}>${STATUTS.map((s) => `<option value="${s[0]}"${s[0] === je.statut ? " selected" : ""}>${s[1]}</option>`).join("")}</select>`)}${f("Exemplaires", `<input type="number" min="1" data-e="exemplaires" value="${je.exemplaires ?? 1}"${ro}>`)}</div>
          <label>Usages<div class="chk-row">${USAGES.map(([k, l]) => `<span class="chk-inline"><input type="checkbox" data-usage="${k}"${(je.usages || []).includes(k) ? " checked" : ""}${ro}> ${l}</span>`).join("")}</div></label>
          <label>Table (plan)<div class="with-link"><select data-e="element_id"${ro}>${tOpts}</select><a class="link" href="#/plan">Voir sur le plan</a></div></label>
          ${f("Notes", `<textarea data-e="notes"${ro}>${esc(je.notes || "")}</textarea>`)}
        </div>
        <div class="card"><h2>Animateurs</h2>
          ${animRows}
          <p class="mini">Réponses données dans l'écran Compétences. Un jeu en animation sans animateur est signalé dans la liste.</p>
        </div>
      </div>
    </div>
    <p class="msg" id="j-msg"></p>`;
}

/* ---------- câblage ---------- */
function wireOnce() {
  if (root.__jeuxWired) return;
  root.__jeuxWired = true;
  root.addEventListener("click", onClick);
  root.addEventListener("input", onInput);
  root.addEventListener("change", onChange);
}
async function onClick(e) {
  const t = e.target;
  const tab = t.closest("[data-tab]");
  if (tab) { view = { mode: "list", id: null, tab: tab.dataset.tab }; return go(); }
  if (t.closest("#new-jeu")) { bggResults = null; bggMsg = ""; view = { mode: "bgg", id: null }; return go(); }
  if (t.closest("#back")) { view = { mode: "list", id: null, tab: "editeurs" }; return go(); }
  if (t.closest("#to-manual")) { view = { mode: "manual", id: null }; return go(); }
  if (t.closest("#to-bgg")) { bggResults = null; bggMsg = ""; view = { mode: "bgg", id: null }; return go(); }
  if (t.closest("#bgg-search")) return bggSearch();
  if (t.closest("#m-create")) return createManual();
  if (t.closest("#save")) return saveFiche();
  if (t.closest("#bgg-update")) return bggUpdate();
  if (t.closest("#f-sansanim")) { filt.sansAnim = !filt.sansAnim; return go(); }
  const imp = t.closest("[data-import]");
  if (imp) return importBgg((bggResults || [])[+imp.dataset.import]);
  const openCard = t.closest("[data-open]");
  if (openCard) { view = { mode: "fiche", id: openCard.dataset.open }; return go(); }
}
function onInput(e) { if (e.target.id === "f-q") { filt.q = e.target.value; refreshGrid(); } }
function onChange(e) {
  const t = e.target;
  if (t.id === "f-statut") { filt.statut = t.value; return go(); }
  if (t.id === "f-cat") { filt.categorie = t.value; return go(); }
  if (t.id === "f-editeur") { filt.editeur = t.value; return go(); }
}
function refreshGrid() {
  const box = root.querySelector(".jeux-grid"); if (!box) return;
  const tmp = document.createElement("div"); tmp.innerHTML = listView();
  box.replaceWith(tmp.querySelector(".jeux-grid"));
}

/* ---------- BGG ---------- */
async function bggSearch() {
  const q = root.querySelector("#bgg-q")?.value || "";
  const msg = root.querySelector("#bgg-msg");
  if (!q.trim()) { if (msg) msg.textContent = "Saisis un nom de jeu."; return; }
  if (msg) msg.textContent = "Recherche…";
  const { data, error } = await supa.functions.invoke("bgg-import", { body: { action: "search", query: q } });
  if (error || data?.error) { bggMsg = "BGG indisponible pour le moment. Utilise « Saisir à la main »."; bggResults = []; go(); return; }
  bggResults = data?.results ?? [];
  bggMsg = bggResults.length ? ""
    : "Aucun résultat — l'API BoardGameGeek restreint actuellement l'accès depuis les serveurs. Utilise « Saisir à la main ».";
  go();
}
async function importBgg(r) {
  const msg = root.querySelector("#bgg-msg"); if (msg) msg.textContent = "Import…";
  const { data: jeu, error: e1 } = await supa.from("jeux").insert({
    bgg_id: r.bgg_id, titre: r.titre, annee: r.annee, image_url: r.image_url, miniature_url: r.miniature_url,
    joueurs_min: r.joueurs_min, joueurs_max: r.joueurs_max, duree_min: r.duree_min, age_min: r.age_min,
    categorie_id: suggestCat(r.age_min) || null,
  }).select().single();
  if (e1) { if (msg) msg.textContent = e1.message.includes("duplicate") ? "Ce jeu est déjà au catalogue." : "Erreur : " + e1.message; return; }
  const { data: je, error: e2 } = await supa.from("jeux_editions")
    .insert({ jeu_id: jeu.id, edition_id: store.editionId, statut: "souhaite", usages: ["animation"] })
    .select("*, jeux(*)").single();
  if (e2) { if (msg) msg.textContent = "Jeu créé mais erreur sur l'édition : " + e2.message; return; }
  list.push(je); view = { mode: "fiche", id: je.id }; go();
}
async function bggUpdate() {
  const je = list.find((x) => x.id === view.id); if (!je || !je.jeux.bgg_id) return;
  const msg = root.querySelector("#j-msg"); if (msg) msg.textContent = "Mise à jour depuis BGG…";
  const { data, error } = await supa.functions.invoke("bgg-import", { body: { action: "thing", bgg_id: je.jeux.bgg_id } });
  if (error || !data || data.error) { if (msg) msg.textContent = "BGG indisponible."; return; }
  const patch = { titre: data.titre || je.jeux.titre, annee: data.annee, image_url: data.image_url,
    miniature_url: data.miniature_url, joueurs_min: data.joueurs_min, joueurs_max: data.joueurs_max,
    duree_min: data.duree_min, age_min: data.age_min };
  const { error: e2 } = await supa.from("jeux").update(patch).eq("id", je.jeu_id);
  if (e2) { if (msg) msg.textContent = "Erreur : " + e2.message; return; }
  Object.assign(je.jeux, patch); go();
}

function numOrNull(v) { const n = parseInt(v, 10); return isNaN(n) ? null : n; }
async function createManual() {
  const msg = root.querySelector("#m-msg");
  const g = (f) => root.querySelector(`[data-m="${f}"]`);
  const titre = (g("titre").value || "").trim();
  if (!titre) { msg.textContent = "Titre requis."; return; }
  const { data: jeu, error: e1 } = await supa.from("jeux").insert({
    titre, annee: numOrNull(g("annee").value),
    joueurs_min: numOrNull(g("joueurs_min").value), joueurs_max: numOrNull(g("joueurs_max").value),
    duree_min: numOrNull(g("duree_min").value), age_min: numOrNull(g("age_min").value),
    categorie_id: g("categorie_id").value || null, editeur_id: g("editeur_id").value || null,
  }).select().single();
  if (e1) { msg.textContent = "Erreur : " + e1.message; return; }
  const { data: je, error: e2 } = await supa.from("jeux_editions")
    .insert({ jeu_id: jeu.id, edition_id: store.editionId, statut: "souhaite", usages: ["animation"] })
    .select("*, jeux(*)").single();
  if (e2) { msg.textContent = "Jeu créé mais erreur sur l'édition : " + e2.message; return; }
  list.push(je); view = { mode: "fiche", id: je.id }; go();
}

async function saveFiche() {
  const je = list.find((x) => x.id === view.id); if (!je) return;
  const msg = root.querySelector("#j-msg"); msg.textContent = "Enregistrement…";
  const g = (f) => root.querySelector(`[data-j="${f}"]`), e = (f) => root.querySelector(`[data-e="${f}"]`);
  const titre = (g("titre").value || "").trim();
  if (!titre) { msg.textContent = "Titre requis."; return; }
  const jPatch = { titre, annee: numOrNull(g("annee").value),
    joueurs_min: numOrNull(g("joueurs_min").value), joueurs_max: numOrNull(g("joueurs_max").value),
    duree_min: numOrNull(g("duree_min").value), age_min: numOrNull(g("age_min").value),
    categorie_id: g("categorie_id").value || null, editeur_id: g("editeur_id").value || null,
    ludotheque: !!root.querySelector('[data-jbool="ludotheque"]')?.checked };
  const usages = [...root.querySelectorAll("[data-usage]")].filter((c) => c.checked).map((c) => c.dataset.usage);
  const ePatch = { statut: e("statut").value, exemplaires: numOrNull(e("exemplaires").value) || 1,
    usages: usages.length ? usages : ["animation"], element_id: e("element_id").value || null,
    notes: e("notes").value || null };
  const [r1, r2] = await Promise.all([
    supa.from("jeux").update(jPatch).eq("id", je.jeu_id),
    supa.from("jeux_editions").update(ePatch).eq("id", je.id),
  ]);
  if (r1.error || r2.error) { msg.textContent = "Erreur : " + (r1.error?.message || r2.error?.message); return; }
  Object.assign(je.jeux, jPatch); Object.assign(je, ePatch);
  view = { mode: "list", id: null }; go();
}
