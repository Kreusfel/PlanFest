// Écran #/intergeneration — pôle Intergénérationnel (journée du vendredi).
//  - Écoles : écoles choisies pour l'event (participation vendredi + effectif).
//  - Établissements : EHPAD / handicap / autres invités le vendredi.
//  - Malles : jeux sélectionnés pour les malles prêtées aux écoles.
import { supa } from "../supabase.js";
import { store } from "../store.js";
import { esc, toast } from "../ui/util.js";
import { isAdmin, hasPole } from "../auth.js";
import { parseCSV, norm } from "../ui/csv.js";

const STATUTS = [["invite", "Invité"], ["confirme", "Confirmé"], ["venu", "Venu"], ["decline", "Décline"]];
const ETAB_TYPES = ["EHPAD", "Handicap", "Foyer", "Autre"];
let root, tab = "ecoles", mode = "list", contacts = [], parts = new Map(), jeux = [], malles = [], cats = [];
let csvMsg = "", importTypes = ["EHPAD"];
const canWrite = () => isAdmin() || hasPole("intergenerationnelle");
const catNom = (id) => cats.find((c) => c.id === id)?.nom || "";

export async function render(container) {
  root = container;
  if (!store.editionId) { root.innerHTML = `<div class="card"><p><a class="btn primary" href="#/editions">Choisir une édition</a></p></div>`; return; }
  root.innerHTML = `<div class="card"><p class="muted">Chargement…</p></div>`;
  const [cc, vp, jx, mj, c] = await Promise.all([
    supa.from("comm_contacts").select("*").order("nom"),
    supa.from("vendredi_participants").select("*").eq("edition_id", store.editionId),
    supa.from("jeux").select("id,titre,categorie_id,annee").eq("ludotheque", true).order("titre"),
    supa.from("malle_jeux").select("*").eq("edition_id", store.editionId),
    supa.from("categories_jeux").select("id,nom"),
  ]);
  contacts = cc.data || [];
  parts = new Map((vp.data || []).map((p) => [p.contact_id, p]));
  jeux = jx.data || [];
  malles = mj.data || [];
  cats = c.data || [];
  draw();
}

function draw() {
  const subTabs = `<div class="utabs">
    <button data-tab="ecoles"${tab === "ecoles" ? ' class="on"' : ""}>Écoles</button>
    <button data-tab="etab"${tab === "etab" ? ' class="on"' : ""}>Établissements</button>
    <button data-tab="malles"${tab === "malles" ? ' class="on"' : ""}>Malles écoles</button></div>`;
  let body;
  if (mode === "csv") body = csvView();
  else if (tab === "malles") body = mallesTab();
  else if (tab === "etab") body = contactsTab(ETAB_TYPES, "Établissements invités le vendredi");
  else body = contactsTab(["École"], "Écoles choisies pour l'event");
  root.innerHTML = `<div class="page-head"><div><h1>Intergénérationnel</h1>
      <div class="sub">Journée du vendredi & malles des écoles</div></div></div>
    ${subTabs}${body}`;
  wire();
}

/* ---------- Écoles & Établissements (contacts + participation vendredi) ---------- */
function contactsTab(types, title) {
  const rows = contacts.filter((c) => types.includes(c.type));
  const parters = rows.filter((c) => parts.has(c.id));
  const confirmes = parters.filter((c) => ["confirme", "venu"].includes(parts.get(c.id).statut)).length;
  const effectif = parters.reduce((s, c) => s + (parts.get(c.id).effectif || 0), 0);
  const kpis = `<div class="grid g4">
    <div class="kpi"><span class="v">${parters.length}</span>Invités</div>
    <div class="kpi"><span class="v" style="color:#15803D">${confirmes}</span>Confirmés</div>
    <div class="kpi"><span class="v">${effectif}</span>Personnes attendues</div>
    <div class="kpi"><span class="v">${rows.length}</span>Dans le carnet</div></div>`;

  const isEcole = types.length === 1 && types[0] === "École";
  const addForm = canWrite() ? `<div class="card"><div class="ihead"><h3>Ajouter</h3></div>
    <div class="filters" style="align-items:flex-end">
      <label>Nom<input id="n-nom" placeholder="${isEcole ? "École…" : "EHPAD…, Foyer…"}"></label>
      ${isEcole ? `<input type="hidden" id="n-type" value="École">` : `<label>Type<select id="n-type">${ETAB_TYPES.map((t) => `<option>${t}</option>`).join("")}</select></label>`}
      <label>Commune<input id="n-commune"></label>
      <label>Email<input id="n-email" type="email"></label>
      <button class="btn primary" id="n-add">Ajouter au carnet</button>
      ${!isEcole ? `<button class="btn small" id="imp-csv">Import CSV</button>` : ""}
      <span class="muted" id="d-msg"></span>
    </div></div>` : "";

  const ro = canWrite() ? "" : " disabled";
  const statSel = (c) => {
    const st = parts.get(c.id)?.statut || "";
    return `<select data-pstat="${c.id}" style="margin:0;min-width:130px"${ro}><option value="">— non invité —</option>${STATUTS.map((s) => `<option value="${s[0]}"${st === s[0] ? " selected" : ""}>${s[1]}</option>`).join("")}</select>`;
  };
  const body = rows.map((c) => {
    const p = parts.get(c.id);
    return `<tr${p ? ' class="hl"' : ""}>
      <td><b>${esc(c.nom)}</b>${c.commune && c.commune !== c.nom ? ` <span class="muted">${esc(c.commune)}</span>` : ""}</td>
      <td class="muted">${esc(c.email || "")}</td>
      <td><input type="number" min="0" data-peff="${c.id}" value="${p?.effectif ?? (c.quantite_flyers || "")}" style="width:80px;margin:0"${ro}></td>
      <td><input data-pcren="${c.id}" value="${esc(p?.creneau || "")}" placeholder="ex. 10h-11h" style="min-width:110px;margin:0"${ro}></td>
      <td>${statSel(c)}</td></tr>`;
  }).join("") || `<tr><td colspan="5" class="muted">Aucun contact. Ajoute-en ou importe un CSV.</td></tr>`;

  const table = `<div class="card"><div class="scroll"><table class="data-table">
    <thead><tr><th>${isEcole ? "École" : "Établissement"}</th><th>Email</th><th>Effectif</th><th>Créneau</th><th>Participation</th></tr></thead>
    <tbody>${body}</tbody></table></div>
    <p class="mini">Mettre « Invité/Confirmé » retient le contact pour le vendredi ; « — non invité — » le retire (le contact reste dans le carnet).</p></div>`;

  return `<div class="ihead"><h2 class="sect-title">${esc(title)}</h2></div>${kpis}${addForm}${table}`;
}

/* ---------- Malles écoles (jeux) ---------- */
function mallesTab() {
  const chosen = new Set(malles.map((m) => m.jeu_id));
  const dispo = jeux.filter((j) => !chosen.has(j.id));
  const addForm = canWrite() ? `<div class="card"><div class="ihead"><h3>Ajouter un jeu à une malle</h3></div>
    <div class="filters" style="align-items:flex-end">
      <label>Jeu<select id="m-jeu">${dispo.map((j) => `<option value="${j.id}">${esc(j.titre)}${j.annee ? ` (${j.annee})` : ""}</option>`).join("")}</select></label>
      <label>Malle<input list="malles-dl" id="m-malle" placeholder="ex. Maternelle, Primaire 1…"></label>
      <datalist id="malles-dl">${[...new Set(malles.map((m) => m.malle).filter(Boolean))].map((m) => `<option value="${esc(m)}">`).join("")}</datalist>
      <button class="btn primary" id="m-add"${dispo.length ? "" : " disabled"}>Ajouter</button>
      <span class="muted" id="m-msg">${dispo.length ? "" : "Tous les jeux de la ludothèque sont déjà placés."}</span>
    </div><p class="mini">Les jeux viennent de la Ludothèque (${jeux.length} dispo). ${jeux.length ? "" : "Ajoute des jeux à l'asso d'abord (page Ludothèque)."}</p></div>` : "";

  const jeuNom = (id) => jeux.find((j) => j.id === id)?.titre || "?";
  const groups = {};
  malles.forEach((m) => { (groups[m.malle || "Sans malle"] = groups[m.malle || "Sans malle"] || []).push(m); });
  const names = Object.keys(groups).sort((a, b) => a.localeCompare(b, "fr"));
  const sections = names.map((g) => `<div class="card"><div class="ihead"><h3>${esc(g)}</h3><span class="muted">${groups[g].length} jeu${groups[g].length > 1 ? "x" : ""}</span></div>
    <div class="scroll"><table class="data-table"><tbody>${groups[g].sort((a, b) => jeuNom(a.jeu_id).localeCompare(jeuNom(b.jeu_id), "fr")).map((m) => `<tr>
      <td>${esc(jeuNom(m.jeu_id))}</td>
      <td style="text-align:right">${canWrite() ? `<button class="btn small danger" data-mdel="${m.jeu_id}">Retirer</button>` : ""}</td></tr>`).join("")}</tbody></table></div></div>`).join("")
    || `<div class="card"><p class="muted">Aucun jeu sélectionné pour les malles.</p></div>`;

  const kpi = `<div class="grid g3"><div class="kpi"><span class="v">${malles.length}</span>Jeux en malle</div>
    <div class="kpi"><span class="v">${names.filter((n) => n !== "Sans malle").length || (malles.length ? 1 : 0)}</span>Malles</div></div>`;
  return `<div class="ihead"><h2 class="sect-title">Jeux des malles des écoles</h2></div>${kpi}${addForm}${sections}`;
}

/* ---------- Import CSV (établissements) ---------- */
function csvView() {
  return `<div class="card" style="max-width:720px"><div class="ihead"><h3>Import CSV — établissements</h3>
      <button class="btn small" id="csv-cancel">← Retour</button></div>
    <label>Fichier CSV<input type="file" id="csv-file" accept=".csv,text/csv"></label>
    <label>… ou collez le contenu<textarea id="csv-text" rows="7" placeholder="nom,type,email,commune,telephone"></textarea></label>
    <label>Type par défaut (si absent)<input list="etab-dl" id="csv-type" value="EHPAD"></label>
    <datalist id="etab-dl">${ETAB_TYPES.map((t) => `<option>${t}</option>`).join("")}</datalist>
    <div class="head-actions" style="justify-content:flex-start"><button class="btn primary" id="csv-go">Importer</button></div>
    <p class="msg" id="csv-msg">${esc(csvMsg)}</p>
    <hr><p class="mini">Colonnes : nom · type · email · telephone · commune · adresse · code_postal · contact · notes. Doublons (nom+email) ignorés. Tu peux charger <b>import_ehpad.csv</b> ici.</p></div>`;
}

/* ---------- câblage ---------- */
function wire() {
  root.querySelectorAll("[data-tab]").forEach((b) => (b.onclick = () => { tab = b.dataset.tab; mode = "list"; draw(); }));
  const na = root.querySelector("#n-add"); if (na) na.onclick = addContact;
  const ic = root.querySelector("#imp-csv"); if (ic) ic.onclick = () => { csvMsg = ""; mode = "csv"; draw(); };
  root.querySelectorAll("[data-pstat]").forEach((s) => (s.onchange = () => setStat(s.dataset.pstat, s.value)));
  root.querySelectorAll("[data-peff]").forEach((i) => (i.onchange = () => setPart(i.dataset.peff, { effectif: parseInt(i.value, 10) || null })));
  root.querySelectorAll("[data-pcren]").forEach((i) => (i.onchange = () => setPart(i.dataset.pcren, { creneau: i.value.trim() || null })));
  const ma = root.querySelector("#m-add"); if (ma) ma.onclick = addMalle;
  root.querySelectorAll("[data-mdel]").forEach((b) => (b.onclick = () => delMalle(b.dataset.mdel)));
  const cf = root.querySelector("#csv-file"); if (cf) cf.onchange = () => { const f = cf.files[0]; if (f) f.text().then((t) => { const ta = root.querySelector("#csv-text"); if (ta) ta.value = t; }); };
  const cg = root.querySelector("#csv-go"); if (cg) cg.onclick = csvImport;
  const cc = root.querySelector("#csv-cancel"); if (cc) cc.onclick = () => { mode = "list"; draw(); };
}

const dmsg = (t) => { const m = root.querySelector("#d-msg"); if (m) m.textContent = t; };

async function addContact() {
  const g = (id) => root.querySelector("#" + id);
  const nom = (g("n-nom").value || "").trim();
  if (!nom) return dmsg("Nom requis.");
  const row = { nom, type: g("n-type").value || null, commune: (g("n-commune").value || "").trim() || null, email: (g("n-email").value || "").trim() || null };
  const { data, error } = await supa.from("comm_contacts").insert(row).select().single();
  if (error) return dmsg("Erreur : " + error.message);
  contacts.push(data); contacts.sort((a, b) => a.nom.localeCompare(b.nom, "fr"));
  // Invité d'office au vendredi
  await setStat(data.id, "invite");
}

async function setStat(contactId, statut) {
  if (!statut) {
    const { error } = await supa.from("vendredi_participants").delete().eq("edition_id", store.editionId).eq("contact_id", contactId);
    if (error) return toast("Erreur : " + error.message);
    parts.delete(contactId); return draw();
  }
  const cur = parts.get(contactId);
  const c = contacts.find((x) => x.id === contactId);
  const row = { edition_id: store.editionId, contact_id: contactId, statut,
    effectif: cur?.effectif ?? (c?.quantite_flyers || null), creneau: cur?.creneau || null };
  const { data, error } = await supa.from("vendredi_participants").upsert(row, { onConflict: "edition_id,contact_id" }).select().single();
  if (error) return toast("Erreur : " + error.message);
  parts.set(contactId, data); draw();
}
async function setPart(contactId, patch) {
  const cur = parts.get(contactId) || { edition_id: store.editionId, contact_id: contactId, statut: "invite" };
  const row = { ...cur, ...patch };
  const { data, error } = await supa.from("vendredi_participants").upsert(row, { onConflict: "edition_id,contact_id" }).select().single();
  if (error) return toast("Erreur : " + error.message);
  parts.set(contactId, data); draw();
}

async function addMalle() {
  const jeu_id = root.querySelector("#m-jeu").value;
  const malle = (root.querySelector("#m-malle").value || "").trim() || null;
  if (!jeu_id) return;
  const { data, error } = await supa.from("malle_jeux").insert({ edition_id: store.editionId, jeu_id, malle }).select().single();
  if (error) { const m = root.querySelector("#m-msg"); if (m) m.textContent = "Erreur : " + error.message; return; }
  malles.push(data); draw();
}
async function delMalle(jeuId) {
  const { error } = await supa.from("malle_jeux").delete().eq("edition_id", store.editionId).eq("jeu_id", jeuId);
  if (error) return toast("Erreur : " + error.message);
  malles = malles.filter((m) => m.jeu_id !== jeuId); draw();
}

/* ---------- CSV établissements ---------- */
const COLS = {
  nom: ["nom", "structure", "etablissement", "name"], type: ["type"],
  contact: ["contact", "directeur", "referent"], email: ["email", "mail", "courriel", "courriel1"],
  telephone: ["telephone", "tel"], commune: ["commune", "ville"], adresse: ["adresse", "adressepostale"],
  code_postal: ["codepostal", "cp"], notes: ["notes", "note", "autre"],
};
async function csvImport() {
  const text = root.querySelector("#csv-text")?.value || "";
  const defType = (root.querySelector("#csv-type")?.value || "").trim() || null;
  const rows = parseCSV(text);
  if (rows.length < 2) { csvMsg = "CSV vide ou sans données."; return draw(); }
  const header = rows[0].map(norm), idx = {};
  for (const [f, al] of Object.entries(COLS)) { const p = header.findIndex((h) => al.includes(h)); if (p >= 0) idx[f] = p; }
  if (idx.nom == null) { csvMsg = "Colonne « nom » introuvable."; return draw(); }
  const seen = new Set(contacts.map((c) => (c.nom + "|" + (c.email || "")).toLowerCase()));
  let skip = 0; const toIns = [];
  for (let r = 1; r < rows.length; r++) {
    const get = (f) => (idx[f] != null ? (rows[r][idx[f]] || "").trim() : "");
    const nom = get("nom"); if (!nom) { skip++; continue; }
    const email = get("email").split(/[\/,;]/)[0].trim();
    const key = (nom + "|" + email).toLowerCase();
    if (seen.has(key)) { skip++; continue; } seen.add(key);
    toIns.push({ nom, type: get("type") || defType, contact: get("contact") || null, email: email || null,
      telephone: get("telephone") || null, commune: get("commune") || null, adresse: get("adresse") || null,
      code_postal: get("code_postal") || null, notes: get("notes") || null });
  }
  if (!toIns.length) { csvMsg = `Rien à importer (${skip} ignoré${skip > 1 ? "s" : ""}).`; return draw(); }
  const { data, error } = await supa.from("comm_contacts").insert(toIns).select();
  if (error) { csvMsg = "Erreur : " + error.message; return draw(); }
  contacts.push(...(data || [])); contacts.sort((a, b) => a.nom.localeCompare(b.nom, "fr"));
  csvMsg = `${toIns.length} établissement(s) importé(s)${skip ? `, ${skip} ignoré(s)` : ""}.`;
  mode = "list"; draw();
}
