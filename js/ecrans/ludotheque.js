// Écran #/ludotheque — inventaire perpétuel des jeux de l'association.
// Lister / ajouter (manuel, BGG, CSV) / modifier / supprimer. Écriture réservée
// au pôle Jeux & éditeurs + admin. Catalogue global (hors édition).
import { supa } from "../supabase.js";
import { esc, refocus, toast } from "../ui/util.js";
import { isAdmin, hasPole } from "../auth.js";
import { parseCSV, norm } from "../ui/csv.js";

let root, list = [], cats = [], q = "", mode = "list", editing = null, msg = "";
let bggResults = null, bggMsg = "", bggQ = "", imported = new Set();
let csvMsg = "";
const canWrite = () => isAdmin() || hasPole("jeux_editeurs");
const catNom = (id) => cats.find((c) => c.id === id)?.nom || "—";
const BGG = `<p class="mini bgg-foot">Données et images : <a href="https://boardgamegeek.com" target="_blank" rel="noopener">Powered by BGG</a></p>`;

export async function render(container) {
  root = container; mode = "list"; editing = null; msg = "";
  root.innerHTML = `<div class="card"><p class="muted">Chargement…</p></div>`;
  const [jx, c] = await Promise.all([
    supa.from("jeux").select("id,bgg_id,titre,annee,image_url,miniature_url,joueurs_min,joueurs_max,duree_min,age_min,categorie_id").eq("ludotheque", true),
    supa.from("categories_jeux").select("id,nom,ordre").order("ordre"),
  ]);
  list = (jx.data ?? []).sort((a, b) => a.titre.localeCompare(b.titre, "fr"));
  cats = c.data ?? [];
  draw();
}

function draw() {
  root.innerHTML = mode === "form" ? formView() : mode === "bgg" ? bggView() : mode === "csv" ? csvView() : listView();
  wire();
}

/* ---------- liste ---------- */
function listView() {
  const term = q.trim().toLowerCase();
  const rows = list.filter((j) => !term || j.titre.toLowerCase().includes(term));
  const body = rows.map((j) => {
    const img = j.miniature_url || j.image_url;
    const meta = [(j.joueurs_min || j.joueurs_max) ? `${j.joueurs_min || "?"}–${j.joueurs_max || "?"} j.` : "", j.duree_min ? `${j.duree_min} min` : "", j.age_min ? `${j.age_min}+` : ""].filter(Boolean).join(" · ");
    return `<tr class="clk" data-edit="${j.id}">
      <td><div class="ludo-cell"><span class="ludo-thumb">${img ? `<img src="${esc(img)}" alt="" loading="lazy">` : ""}</span>
        <span><b>${esc(j.titre)}</b>${j.annee ? ` <span class="muted">(${j.annee})</span>` : ""}</span></div></td>
      <td>${esc(catNom(j.categorie_id))}</td>
      <td class="muted">${esc(meta || "—")}</td>
      <td style="text-align:right">${canWrite() ? `<button class="btn small danger" data-del="${j.id}">Suppr.</button>` : ""}</td></tr>`;
  }).join("") || `<tr><td colspan="4" class="muted">${list.length ? "Aucun jeu pour cette recherche." : "Aucun jeu dans la ludothèque. Ajoute-en un."}</td></tr>`;

  return `<div class="page-head"><div><h1>Ludothèque</h1>
      <div class="sub">${list.length} jeu${list.length > 1 ? "x" : ""} de l'association · catalogue permanent</div></div>
    <div class="head-actions">${canWrite() ? `<button class="btn" id="imp-bgg">Import BGG</button>
      <button class="btn" id="imp-csv">Import CSV</button>
      <button class="btn primary" id="add">+ Ajouter</button>` : ""}</div></div>
    <div class="card">
      <div class="filters"><input id="f-q" placeholder="Rechercher un titre…" value="${esc(q)}"></div>
      <div class="scroll"><table class="data-table">
        <thead><tr><th>Jeu</th><th>Catégorie</th><th>Détails</th><th></th></tr></thead>
        <tbody>${body}</tbody></table></div>
    </div>`;
}

/* ---------- formulaire manuel ---------- */
const f = (l, inner) => `<label>${l}${inner}</label>`;
function formView() {
  const j = editing || {};
  const catSel = `<select data-f="categorie_id"><option value="">—</option>${cats.map((c) => `<option value="${c.id}"${c.id === j.categorie_id ? " selected" : ""}>${esc(c.nom)}</option>`).join("")}</select>`;
  return `<div class="page-head"><div><h1>${editing ? "Modifier un jeu" : "Ajouter un jeu"}</h1>
      <div class="sub">Jeu de la ludothèque (asso)</div></div>
    <div class="head-actions"><button class="btn" id="cancel">← Retour</button>
      <button class="btn primary" id="save">Enregistrer</button></div></div>
    <div class="card" style="max-width:560px">
      ${f("Titre", `<input data-f="titre" value="${esc(j.titre || "")}">`)}
      <div class="row2">${f("Année", `<input type="number" data-f="annee" value="${j.annee ?? ""}">`)}${f("Catégorie", catSel)}</div>
      <div class="row2">${f("Joueurs min", `<input type="number" data-f="joueurs_min" value="${j.joueurs_min ?? ""}">`)}${f("Joueurs max", `<input type="number" data-f="joueurs_max" value="${j.joueurs_max ?? ""}">`)}</div>
      <div class="row2">${f("Durée (min)", `<input type="number" data-f="duree_min" value="${j.duree_min ?? ""}">`)}${f("Âge min", `<input type="number" data-f="age_min" value="${j.age_min ?? ""}">`)}</div>
      ${f("Image (URL)", `<input data-f="image_url" value="${esc(j.image_url || "")}" placeholder="https://…">`)}
      <p class="msg" id="l-msg">${esc(msg)}</p>
    </div>`;
}

/* ---------- import BGG ---------- */
function bggView() {
  const res = bggResults == null ? "" : (bggResults.length
    ? bggResults.map((r, i) => `<div class="row">
        <div class="bgg-thumb">${r.miniature_url ? `<img src="${esc(r.miniature_url)}" alt="">` : "Image"}</div>
        <div class="row-main"><b>${esc(r.titre)}${r.annee ? ` <span class="mini">(${r.annee})</span>` : ""}</b>
          <span class="muted">${r.joueurs_min || "?"}-${r.joueurs_max || "?"} joueurs · ${r.duree_min || "?"} min · dès ${r.age_min || "?"} ans</span></div>
        <div class="actions">${imported.has(r.bgg_id) ? `<span class="pill ok">Ajouté</span>` : `<button class="btn primary" data-import="${i}">Ajouter</button>`}</div>
      </div>`).join("")
    : `<p class="muted">Aucun résultat.</p>`);
  return `<div class="page-head"><div><h1>Import BGG</h1><div class="sub">Recherche sur BoardGameGeek</div></div>
    <div class="head-actions"><button class="btn" id="cancel">← Liste</button></div></div>
    <div class="card">
      <div class="filters"><input id="bgg-q" placeholder="Nom du jeu…" value="${esc(bggQ)}">
        <button class="btn primary" id="bgg-search">Rechercher</button></div>
      <div class="list">${res}</div>
      <p class="mini">Les jeux ajoutés entrent dans la ludothèque (catalogue permanent).</p>
      <p class="msg" id="bgg-msg">${esc(bggMsg)}</p>
      ${BGG}
    </div>`;
}

/* ---------- import CSV ---------- */
function csvView() {
  return `<div class="page-head"><div><h1>Import CSV</h1><div class="sub">Ajout en masse dans la ludothèque</div></div>
    <div class="head-actions"><button class="btn" id="cancel">← Liste</button></div></div>
    <div class="card" style="max-width:720px">
      <label>Fichier CSV<input type="file" id="csv-file" accept=".csv,text/csv"></label>
      <label>… ou collez le contenu<textarea id="csv-text" rows="7" placeholder="titre,annee,categorie,joueurs_min,joueurs_max,duree_min,age_min,image_url"></textarea></label>
      <div class="head-actions" style="justify-content:flex-start"><button class="btn primary" id="csv-go">Importer</button>
        <a class="link" id="csv-tpl" href="#">Télécharger un modèle</a></div>
      <p class="msg" id="csv-msg">${esc(csvMsg)}</p>
      <hr>
      <p class="mini"><b>Colonnes reconnues</b> (1ʳᵉ ligne = en-têtes, seul <b>titre</b> est obligatoire) :
        titre · annee · categorie (nom exact) · joueurs_min · joueurs_max · duree_min · age_min · image_url · bgg_id.
        Les titres déjà présents sont ignorés.</p>
    </div>`;
}

/* ---------- câblage ---------- */
function wire() {
  const search = root.querySelector("#f-q");
  if (search) search.oninput = () => { q = search.value; const pos = search.selectionStart; draw(); refocus(root, "#f-q", pos); };
  const add = root.querySelector("#add");
  if (add) add.onclick = () => { editing = null; msg = ""; mode = "form"; draw(); };
  const impB = root.querySelector("#imp-bgg");
  if (impB) impB.onclick = () => { bggResults = null; bggMsg = ""; bggQ = ""; imported = new Set(); mode = "bgg"; draw(); };
  const impC = root.querySelector("#imp-csv");
  if (impC) impC.onclick = () => { csvMsg = ""; mode = "csv"; draw(); };
  root.querySelectorAll("[data-edit]").forEach((tr) => tr.addEventListener("click", (e) => {
    if (e.target.closest("[data-del]")) return;
    editing = list.find((x) => x.id === tr.dataset.edit) || null; msg = ""; mode = "form"; draw();
  }));
  root.querySelectorAll("[data-del]").forEach((b) => (b.onclick = (e) => { e.stopPropagation(); del(b.dataset.del); }));
  const cancel = root.querySelector("#cancel");
  if (cancel) cancel.onclick = () => { mode = "list"; editing = null; draw(); };
  const save = root.querySelector("#save");
  if (save) save.onclick = save2;
  const bs = root.querySelector("#bgg-search");
  if (bs) bs.onclick = bggSearch;
  root.querySelectorAll("[data-import]").forEach((b) => (b.onclick = () => importBgg((bggResults || [])[+b.dataset.import])));
  const cf = root.querySelector("#csv-file");
  if (cf) cf.onchange = () => { const fl = cf.files[0]; if (!fl) return; fl.text().then((t) => { const ta = root.querySelector("#csv-text"); if (ta) ta.value = t; }); };
  const cg = root.querySelector("#csv-go");
  if (cg) cg.onclick = csvImport;
  const tpl = root.querySelector("#csv-tpl");
  if (tpl) tpl.onclick = (e) => { e.preventDefault(); downloadTemplate(); };
}

const numOrNull = (v) => { const n = parseInt(v, 10); return isNaN(n) ? null : n; };

async function save2() {
  if (!canWrite()) { setMsg("l-msg", "Réservé au pôle Jeux & éditeurs."); return; }
  const g = (k) => root.querySelector(`[data-f="${k}"]`);
  const titre = (g("titre").value || "").trim();
  if (!titre) { setMsg("l-msg", "Titre requis."); return; }
  const patch = {
    titre, annee: numOrNull(g("annee").value), categorie_id: g("categorie_id").value || null,
    joueurs_min: numOrNull(g("joueurs_min").value), joueurs_max: numOrNull(g("joueurs_max").value),
    duree_min: numOrNull(g("duree_min").value), age_min: numOrNull(g("age_min").value),
    image_url: (g("image_url").value || "").trim() || null,
  };
  setMsg("l-msg", "Enregistrement…");
  const res = editing
    ? await supa.from("jeux").update(patch).eq("id", editing.id)
    : await supa.from("jeux").insert({ ...patch, ludotheque: true });
  if (res.error) { setMsg("l-msg", "Erreur : " + res.error.message); return; }
  mode = "list"; editing = null; render(root);
}

async function del(id) {
  const j = list.find((x) => x.id === id);
  if (!confirm(`Supprimer « ${j?.titre || "ce jeu"} » de la ludothèque ?\n(Retire aussi ses choix de tri et ses liens d'édition.)`)) return;
  const { error } = await supa.from("jeux").delete().eq("id", id);
  if (error) { toast("Erreur : " + error.message); return; }
  list = list.filter((x) => x.id !== id); draw();
}

async function bggSearch() {
  bggQ = (root.querySelector("#bgg-q")?.value || "").trim();
  if (!bggQ) { bggMsg = "Saisis un nom de jeu."; return draw(); }
  bggMsg = "Recherche…"; setMsg("bgg-msg", "Recherche…");
  const { data, error } = await supa.functions.invoke("bgg-import", { body: { action: "search", query: bggQ } });
  if (error || data?.error) { bggMsg = "BGG indisponible. Utilise « + Ajouter » ou l'import CSV."; bggResults = []; return draw(); }
  bggResults = data?.results ?? [];
  bggMsg = bggResults.length ? "" : "Aucun résultat — l'API BGG restreint l'accès serveur. Saisie manuelle ou CSV.";
  draw();
}
async function importBgg(r) {
  if (!r) return;
  setMsg("bgg-msg", "Ajout…");
  const { data, error } = await supa.from("jeux").insert({
    bgg_id: r.bgg_id, titre: r.titre, annee: r.annee, image_url: r.image_url, miniature_url: r.miniature_url,
    joueurs_min: r.joueurs_min, joueurs_max: r.joueurs_max, duree_min: r.duree_min, age_min: r.age_min, ludotheque: true,
  }).select().single();
  if (error) { bggMsg = error.message.includes("duplicate") ? "Ce jeu est déjà au catalogue." : "Erreur : " + error.message; return draw(); }
  imported.add(r.bgg_id); list.push(data); bggMsg = `« ${r.titre} » ajouté.`; draw();
}

/* ---------- CSV ---------- */
const COLS = {
  titre: ["titre", "nom", "name", "title"],
  annee: ["annee", "year", "yearpublished"],
  categorie: ["categorie", "category", "cat"],
  joueurs_min: ["joueursmin", "min", "minplayers"],
  joueurs_max: ["joueursmax", "max", "maxplayers"],
  duree_min: ["dureemin", "duree", "duration", "playingtime", "temps"],
  age_min: ["agemin", "age", "minage"],
  image_url: ["imageurl", "image", "img"],
  bgg_id: ["bggid", "bgg"],
};


async function csvImport() {
  if (!canWrite()) { setMsg("csv-msg", "Réservé au pôle Jeux & éditeurs."); return; }
  const text = root.querySelector("#csv-text")?.value || "";
  const rows = parseCSV(text);
  if (rows.length < 2) { setMsg("csv-msg", "CSV vide ou sans ligne de données (1ʳᵉ ligne = en-têtes)."); return; }
  const header = rows[0].map(norm);
  const idx = {};
  for (const [field, aliases] of Object.entries(COLS)) {
    const pos = header.findIndex((h) => aliases.includes(h));
    if (pos >= 0) idx[field] = pos;
  }
  if (idx.titre == null) { setMsg("csv-msg", "Colonne « titre » introuvable dans les en-têtes."); return; }
  const existing = new Set(list.map((j) => j.titre.trim().toLowerCase()));
  const catByName = new Map(cats.map((c) => [norm(c.nom), c.id]));
  let skip = 0; const toInsert = [];
  for (let r = 1; r < rows.length; r++) {
    const get = (fld) => (idx[fld] != null ? (rows[r][idx[fld]] || "").trim() : "");
    const titre = get("titre");
    if (!titre) { skip++; continue; }
    if (existing.has(titre.toLowerCase())) { skip++; continue; }
    existing.add(titre.toLowerCase());
    toInsert.push({
      titre, annee: numOrNull(get("annee")),
      joueurs_min: numOrNull(get("joueurs_min")), joueurs_max: numOrNull(get("joueurs_max")),
      duree_min: numOrNull(get("duree_min")), age_min: numOrNull(get("age_min")),
      image_url: get("image_url") || null, bgg_id: numOrNull(get("bgg_id")),
      categorie_id: catByName.get(norm(get("categorie"))) || null, ludotheque: true,
    });
  }
  if (!toInsert.length) { setMsg("csv-msg", `Rien à importer (${skip} ignoré${skip > 1 ? "s" : ""} : vides ou déjà présents).`); return; }
  setMsg("csv-msg", `Import de ${toInsert.length} jeu(x)…`);
  const { error } = await supa.from("jeux").insert(toInsert);
  if (error) { setMsg("csv-msg", "Erreur : " + error.message); return; }
  csvMsg = `${toInsert.length} jeu(x) ajouté(s)${skip ? `, ${skip} ignoré(s)` : ""}.`;
  mode = "list"; render(root);
}

function downloadTemplate() {
  const csv = "titre,annee,categorie,joueurs_min,joueurs_max,duree_min,age_min,image_url\n" +
    "Les Aventuriers du Rail,2004,Familial,2,5,45,8,\n";
  const a = document.createElement("a");
  a.href = "data:text/csv;charset=utf-8," + encodeURIComponent(csv);
  a.download = "modele-ludotheque.csv";
  document.body.appendChild(a); a.click(); a.remove();
}

function setMsg(id, t) { const m = root.querySelector("#" + id); if (m) m.textContent = t; if (id === "l-msg") msg = t; }
