// Écran #/communication — pôle Communication.
//  - Diffusion : carnet de contacts (mairies, écoles, EHPAD, presse…) avec email,
//    quantité de flyers, suivi d'envoi par édition + import CSV.
//  - Public : publier le programme, texte de présentation visiteurs, lien + QR,
//    logos d'organismes à récupérer.
import { supa } from "../supabase.js";
import { store } from "../store.js";
import { esc } from "../ui/util.js";
import { isAdmin, hasPole } from "../auth.js";
import { qrSVG } from "../export/qr.js";

const STATUTS = [["a_faire", "À faire"], ["envoye", "Envoyé"], ["distribue", "Distribué"]];
const TYPES = ["Mairie", "École", "Presse", "Commerce", "Association", "Autre"];
let root, tab = "diffusion", mode = "list", contacts = [], envois = new Map(), edRow = null, orgsNoLogo = [];
let q = "", filtType = "", csvMsg = "";
const canWrite = () => isAdmin() || hasPole("communication");
const statLbl = (k) => (STATUTS.find((s) => s[0] === k) || [k, k])[1];

export async function render(container) {
  root = container;
  if (!store.editionId) { root.innerHTML = `<div class="card"><p><a class="btn primary" href="#/editions">Choisir une édition</a></p></div>`; return; }
  root.innerHTML = `<div class="card"><p class="muted">Chargement…</p></div>`;
  const [cc, ce, edr, oe] = await Promise.all([
    supa.from("comm_contacts").select("*").order("type").order("nom"),
    supa.from("comm_envois").select("contact_id,statut").eq("edition_id", store.editionId),
    supa.from("editions").select("id,nom,presentation,programme_publie").eq("id", store.editionId).single(),
    supa.from("organisme_editions").select("id,logo_url,statut,roles,organismes(nom)").eq("edition_id", store.editionId).eq("statut", "confirme"),
  ]);
  contacts = cc.data || [];
  envois = new Map((ce.data || []).map((r) => [r.contact_id, r.statut]));
  edRow = edr.data || {};
  orgsNoLogo = (oe.data || []).filter((o) => !o.logo_url && (o.roles || []).some((r) => ["partenaire", "sponsor", "editeur"].includes(r)));
  draw();
}

function draw() {
  const subTabs = `<div class="utabs">
    <button data-tab="diffusion"${tab === "diffusion" ? ' class="on"' : ""}>Diffusion</button>
    <button data-tab="public"${tab === "public" ? ' class="on"' : ""}>Public</button></div>`;
  root.innerHTML = `<div class="page-head"><div><h1>Communication</h1>
      <div class="sub">Carnet de diffusion & contenu public</div></div></div>
    ${subTabs}${tab === "public" ? publicTab() : mode === "csv" ? csvView() : diffusionTab()}`;
  wire();
}

/* ---------- Diffusion ---------- */
function diffusionTab() {
  const term = q.trim().toLowerCase();
  const rows = contacts.filter((c) => (!filtType || c.type === filtType) &&
    (!term || (c.nom + " " + (c.commune || "") + " " + (c.email || "")).toLowerCase().includes(term)));
  const totFlyers = contacts.reduce((s, c) => s + (c.quantite_flyers || 0), 0);
  const envoyes = contacts.filter((c) => { const s = envois.get(c.id); return s === "envoye" || s === "distribue"; }).length;
  const kpis = `<div class="grid g4">
    <div class="kpi"><span class="v">${contacts.length}</span>Contacts</div>
    <div class="kpi"><span class="v">${totFlyers}</span>Flyers à distribuer</div>
    <div class="kpi"><span class="v">${envoyes}</span>Traités (cette édition)</div>
    <div class="kpi"><span class="v">${contacts.length - envoyes}</span>Restants</div></div>`;

  const types = [...new Set(contacts.map((c) => c.type).filter(Boolean))].sort();
  const bar = `<div class="card"><div class="filters">
      <input id="f-q" placeholder="Rechercher (nom, commune, email)…" value="${esc(q)}">
      <select id="f-type"><option value="">Tous types</option>${types.map((t) => `<option value="${esc(t)}"${t === filtType ? " selected" : ""}>${esc(t)}</option>`).join("")}</select>
      <button class="btn small" id="copy-mails">Copier les emails</button>
      ${canWrite() ? `<button class="btn small" id="imp-csv">Import CSV</button><button class="btn primary small" id="c-add">+ Ajouter</button>` : ""}
      <span class="muted" id="d-msg"></span>
    </div></div>`;

  const addForm = canWrite() ? `<div class="card"><div class="ihead"><h3>Ajouter un contact</h3></div>
    <div class="filters" style="align-items:flex-end">
      <label>Nom<input id="n-nom" placeholder="Mairie de…, École…"></label>
      <label>Type<input list="types-dl" id="n-type"></label>
      <datalist id="types-dl">${TYPES.map((t) => `<option value="${t}">`).join("")}</datalist>
      <label>Email<input id="n-email" type="email"></label>
      <label>Commune<input id="n-commune"></label>
      <label>Flyers<input type="number" min="0" id="n-flyers" style="width:90px"></label>
      <button class="btn primary" id="n-add">Ajouter</button>
    </div></div>` : "";

  const ro = canWrite() ? "" : " disabled";
  const statSel = (c) => `<select data-sid="${c.id}" style="margin:0;min-width:120px"${ro}>${STATUTS.map((s) => `<option value="${s[0]}"${(envois.get(c.id) || "a_faire") === s[0] ? " selected" : ""}>${s[1]}</option>`).join("")}</select>`;
  const inp = (c, f, w = 120) => `<input data-cid="${c.id}" data-cf="${f}" value="${esc(c[f] ?? "")}" style="min-width:${w}px;margin:0"${ro}>`;
  const body = rows.map((c) => `<tr>
      <td>${inp(c, "nom", 150)}</td>
      <td>${inp(c, "type", 90)}</td>
      <td>${inp(c, "commune", 100)}</td>
      <td>${inp(c, "email", 170)}</td>
      <td>${inp(c, "telephone", 100)}</td>
      <td><input type="number" min="0" data-cid="${c.id}" data-cf="quantite_flyers" value="${c.quantite_flyers || 0}" style="width:70px;margin:0"${ro}></td>
      <td>${statSel(c)}</td>
      <td style="text-align:right">${canWrite() ? `<button class="btn small danger" data-cdel="${c.id}">×</button>` : ""}</td></tr>`).join("")
    || `<tr><td colspan="8" class="muted">${contacts.length ? "Aucun contact pour ce filtre." : "Aucun contact. Ajoute-en ou importe un CSV."}</td></tr>`;

  const table = `<div class="card"><div class="scroll"><table class="data-table">
    <thead><tr><th>Nom</th><th>Type</th><th>Commune</th><th>Email</th><th>Tél</th><th>Flyers</th><th>Statut</th><th></th></tr></thead>
    <tbody>${body}</tbody></table></div><p class="mini">${rows.length} affiché(s) sur ${contacts.length}. Le statut est propre à l'édition en cours.</p></div>`;

  return kpis + bar + addForm + table;
}

/* ---------- Import CSV ---------- */
function csvView() {
  return `<div class="card" style="max-width:760px"><div class="ihead"><h3>Import CSV — contacts</h3>
      <button class="btn small" id="csv-cancel">← Retour</button></div>
    <label>Fichier CSV<input type="file" id="csv-file" accept=".csv,text/csv"></label>
    <label>… ou collez le contenu<textarea id="csv-text" rows="7" placeholder="nom,type,email,commune,telephone,flyers"></textarea></label>
    <label>Type par défaut (si absent du CSV)<input list="types-dl2" id="csv-type" placeholder="Mairie, École, EHPAD…"></label>
    <datalist id="types-dl2">${TYPES.map((t) => `<option value="${t}">`).join("")}</datalist>
    <div class="head-actions" style="justify-content:flex-start"><button class="btn primary" id="csv-go">Importer</button></div>
    <p class="msg" id="csv-msg">${esc(csvMsg)}</p>
    <hr><p class="mini"><b>Colonnes reconnues</b> (1ʳᵉ ligne = en-têtes) : nom (ou structure / commune / établissement) · type · contact (ou maire / directeur) · email (ou mail / courriel) · telephone · commune · adresse · code_postal (ou cp) · flyers (ou nombre) · notes. Emails multiples → le 1ᵉʳ est gardé, les autres passent en note. Doublons (même nom + email) ignorés.</p></div>`;
}

/* ---------- Public ---------- */
function publicTab() {
  const lien = `${location.origin}${location.pathname}#/public/programme/${edRow.id}`;
  const pub = !!edRow.programme_publie;
  const logos = orgsNoLogo.length
    ? `<ul class="reg-list">${orgsNoLogo.map((o) => `<li>${esc(o.organismes?.nom || "?")}</li>`).join("")}</ul>`
    : `<p class="muted">Tous les organismes confirmés ont un logo. 🎉</p>`;
  return `
    <div class="card"><div class="ihead"><h3>Programme public</h3>
      <span class="tag ${pub ? "ok" : "warn"}">${pub ? "Publié" : "Non publié"}</span></div>
      <p class="sub">Publie les 3 pages visiteurs (programme, plan, infos & exposants).</p>
      <div class="head-actions" style="justify-content:flex-start">
        ${canWrite() ? `<button class="btn ${pub ? "" : "primary"}" id="pub-toggle">${pub ? "Dépublier" : "Publier le programme"}</button>` : ""}
        ${pub ? `<a class="btn" href="#/public/programme/${edRow.id}" target="_blank">Ouvrir</a><button class="btn" id="copy-lien">Copier le lien</button>` : ""}
      </div>
      ${pub ? `<div class="qr" style="margin-top:12px" title="QR du programme public">${qrSVG(lien)}</div>` : ""}
      <p class="msg" id="pub-msg"></p></div>

    <div class="card"><div class="ihead"><h3>Texte de présentation (visiteurs)</h3></div>
      <label>Activités, food trucks, partenaires présents…
        <textarea id="pres" rows="6"${canWrite() ? "" : " disabled"} placeholder="Décris le festival pour les visiteurs…">${esc(edRow.presentation || "")}</textarea></label>
      ${canWrite() ? `<button class="btn primary" id="pres-save">Enregistrer</button>` : ""}
      <span class="muted" id="pres-msg"></span></div>

    <div class="card"><div class="ihead"><h3>Logos à récupérer</h3><span class="muted">${orgsNoLogo.length}</span></div>
      ${logos}
      <p class="mini">Organismes confirmés sans logo. À compléter sur leur fiche (page Organismes).</p></div>`;
}

/* ---------- câblage ---------- */
function wire() {
  root.querySelectorAll("[data-tab]").forEach((b) => (b.onclick = () => { tab = b.dataset.tab; mode = "list"; draw(); }));
  // diffusion
  const s = root.querySelector("#f-q"); if (s) s.oninput = () => { q = s.value; const t = root.querySelector("tbody"); if (t) draw(); };
  const ft = root.querySelector("#f-type"); if (ft) ft.onchange = () => { filtType = ft.value; draw(); };
  const cp = root.querySelector("#copy-mails"); if (cp) cp.onclick = copyMails;
  const ic = root.querySelector("#imp-csv"); if (ic) ic.onclick = () => { csvMsg = ""; mode = "csv"; draw(); };
  const ca = root.querySelector("#c-add"); if (ca) ca.onclick = () => { root.querySelector("#n-nom")?.focus(); };
  const na = root.querySelector("#n-add"); if (na) na.onclick = addContact;
  root.querySelectorAll("[data-cdel]").forEach((b) => (b.onclick = () => delContact(b.dataset.cdel)));
  root.querySelectorAll("[data-cid]").forEach((i) => (i.onchange = () => editContact(i.dataset.cid, i.dataset.cf, i)));
  root.querySelectorAll("[data-sid]").forEach((sl) => (sl.onchange = () => setEnvoi(sl.dataset.sid, sl.value)));
  // csv
  const cf = root.querySelector("#csv-file"); if (cf) cf.onchange = () => { const f = cf.files[0]; if (f) f.text().then((t) => { const ta = root.querySelector("#csv-text"); if (ta) ta.value = t; }); };
  const cg = root.querySelector("#csv-go"); if (cg) cg.onclick = csvImport;
  const cc = root.querySelector("#csv-cancel"); if (cc) cc.onclick = () => { mode = "list"; draw(); };
  // public
  const pt = root.querySelector("#pub-toggle"); if (pt) pt.onclick = togglePub;
  const cl = root.querySelector("#copy-lien"); if (cl) cl.onclick = () => copy(`${location.origin}${location.pathname}#/public/programme/${edRow.id}`, "pub-msg");
  const ps = root.querySelector("#pres-save"); if (ps) ps.onclick = savePres;
}

async function copy(txt, msgId) {
  try { await navigator.clipboard.writeText(txt); const m = root.querySelector("#" + msgId); if (m) m.textContent = "Copié."; }
  catch { const m = root.querySelector("#" + msgId); if (m) m.textContent = txt; }
}
function copyMails() {
  const mails = [...new Set(contacts.filter((c) => (!filtType || c.type === filtType)).map((c) => (c.email || "").split(/[\/,;]/)[0].trim()).filter(Boolean))];
  copy(mails.join(", "), "d-msg");
  const m = root.querySelector("#d-msg"); if (m) m.textContent = `${mails.length} emails copiés.`;
}

async function addContact() {
  const g = (id) => root.querySelector("#" + id);
  const nom = (g("n-nom").value || "").trim();
  if (!nom) { const m = root.querySelector("#d-msg"); if (m) m.textContent = "Nom requis."; return; }
  const row = { nom, type: (g("n-type").value || "").trim() || null, email: (g("n-email").value || "").trim() || null,
    commune: (g("n-commune").value || "").trim() || null, quantite_flyers: parseInt(g("n-flyers").value, 10) || 0 };
  const { data, error } = await supa.from("comm_contacts").insert(row).select().single();
  if (error) { const m = root.querySelector("#d-msg"); if (m) m.textContent = "Erreur : " + error.message; return; }
  contacts.push(data); contacts.sort((a, b) => (a.type || "").localeCompare(b.type || "") || a.nom.localeCompare(b.nom, "fr"));
  draw();
}
async function editContact(id, field, inp) {
  let val = inp.value;
  if (field === "quantite_flyers") val = parseInt(val, 10) || 0;
  else val = val.trim() || (field === "nom" ? null : null);
  if (field === "nom" && !val) { inp.classList.add("err"); return; }
  const { error } = await supa.from("comm_contacts").update({ [field]: val }).eq("id", id);
  if (error) { alert("Erreur : " + error.message); return; }
  const c = contacts.find((x) => x.id === id); if (c) c[field] = val;
  if (field === "quantite_flyers" || field === "type") draw();
}
async function delContact(id) {
  const c = contacts.find((x) => x.id === id);
  if (!confirm(`Supprimer « ${c?.nom || "ce contact"} » ?`)) return;
  const { error } = await supa.from("comm_contacts").delete().eq("id", id);
  if (error) { alert("Erreur : " + error.message); return; }
  contacts = contacts.filter((x) => x.id !== id); draw();
}
async function setEnvoi(contactId, statut) {
  const { error } = await supa.from("comm_envois").upsert({ edition_id: store.editionId, contact_id: contactId, statut }, { onConflict: "edition_id,contact_id" });
  if (error) { alert("Erreur : " + error.message); return; }
  envois.set(contactId, statut); draw();
}

/* ---------- CSV ---------- */
const COLS = {
  nom: ["nom", "structure", "commune", "etablissement", "nometablissement", "name"],
  type: ["type"],
  contact: ["contact", "maire", "directeur", "directrice", "referent"],
  email: ["email", "mail", "courriel", "courriel1", "ecourriel", "adressemail"],
  telephone: ["telephone", "tel", "telephone1", "portable"],
  commune: ["commune", "ville"],
  adresse: ["adresse", "adressepostale"],
  code_postal: ["codepostal", "cp"],
  quantite_flyers: ["flyers", "nombre", "quantite", "qte", "nbflyers"],
  notes: ["notes", "note", "autre", "organisme", "courriel2", "courriel3"],
};
const norm = (s) => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
function parseCSV(text) {
  const rows = []; let row = [], f = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else inQ = false; } else f += c; }
    else if (c === '"') inQ = true;
    else if (c === "," || c === ";" || c === "\t") { row.push(f); f = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(f); if (row.some((v) => v.trim() !== "")) rows.push(row); row = []; f = ""; }
    else f += c;
  }
  if (f !== "" || row.length) { row.push(f); if (row.some((v) => v.trim() !== "")) rows.push(row); }
  return rows;
}
async function csvImport() {
  const text = root.querySelector("#csv-text")?.value || "";
  const defType = (root.querySelector("#csv-type")?.value || "").trim() || null;
  const rows = parseCSV(text);
  if (rows.length < 2) { csvMsg = "CSV vide ou sans ligne de données."; return draw(); }
  const header = rows[0].map(norm), idx = {};
  for (const [f, al] of Object.entries(COLS)) { const p = header.findIndex((h) => al.includes(h)); if (p >= 0) idx[f] = p; }
  if (idx.nom == null) { csvMsg = "Colonne « nom » (ou structure/commune) introuvable."; return draw(); }
  const seen = new Set(contacts.map((c) => (c.nom + "|" + (c.email || "")).toLowerCase()));
  let skip = 0; const toIns = [];
  for (let r = 1; r < rows.length; r++) {
    const get = (f) => (idx[f] != null ? (rows[r][idx[f]] || "").trim() : "");
    const nom = get("nom"); if (!nom) { skip++; continue; }
    const mails = get("email").split(/[\/,;]/).map((x) => x.trim()).filter(Boolean);
    const extra = mails.slice(1).join(", ");
    const note = [get("notes"), extra ? "Autres emails : " + extra : ""].filter(Boolean).join(" — ") || null;
    const key = (nom + "|" + (mails[0] || "")).toLowerCase();
    if (seen.has(key)) { skip++; continue; } seen.add(key);
    toIns.push({ nom, type: get("type") || defType, contact: get("contact") || null, email: mails[0] || null,
      telephone: get("telephone") || null, commune: get("commune") || null, adresse: get("adresse") || null,
      code_postal: get("code_postal") || null, quantite_flyers: parseInt(get("quantite_flyers"), 10) || 0, notes: note });
  }
  if (!toIns.length) { csvMsg = `Rien à importer (${skip} ignoré${skip > 1 ? "s" : ""}).`; return draw(); }
  csvMsg = `Import de ${toIns.length}…`; draw();
  const { data, error } = await supa.from("comm_contacts").insert(toIns).select();
  if (error) { csvMsg = "Erreur : " + error.message; return draw(); }
  contacts.push(...(data || [])); contacts.sort((a, b) => (a.type || "").localeCompare(b.type || "") || a.nom.localeCompare(b.nom, "fr"));
  csvMsg = `${toIns.length} contact(s) importé(s)${skip ? `, ${skip} ignoré(s)` : ""}.`;
  mode = "list"; draw();
}

/* ---------- Public actions ---------- */
async function togglePub() {
  const publier = !edRow.programme_publie;
  if (publier && !confirm("Publier le programme ? Toute autre édition publiée sera dépubliée.")) return;
  const m = root.querySelector("#pub-msg"); if (m) m.textContent = "…";
  const { error } = await supa.rpc("publier_edition", { p_edition: store.editionId, p_publier: publier });
  if (error) { if (m) m.textContent = "Erreur : " + error.message; return; }
  edRow.programme_publie = publier; draw();
}
async function savePres() {
  const pres = root.querySelector("#pres").value || null;
  const m = root.querySelector("#pres-msg"); if (m) m.textContent = "…";
  const { error } = await supa.rpc("maj_contenu_public", { p_edition: store.editionId, p_presentation: pres });
  if (error) { if (m) m.textContent = "Erreur : " + error.message; return; }
  edRow.presentation = pres; if (m) m.textContent = "Enregistré.";
}
