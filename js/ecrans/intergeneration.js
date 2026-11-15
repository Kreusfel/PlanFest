// Écran #/intergeneration — pôle Intergénérationnel (journée du vendredi).
//  - Écoles : les écoles qui VIENNENT au festival (choisies dans le carnet de Communication,
//    qui lui sert aux flyers) : matin ou après-midi, classes et nombre d'élèves.
//  - Établissements : EHPAD / handicap / autres invités le vendredi.
//  - Déroulé du vendredi. Les malles des écoles se gèrent dans Jeux → Malles.
import { supa } from "../supabase.js";
import { store } from "../store.js";
import { esc, toast } from "../ui/util.js";
import { isAdmin, hasPole } from "../auth.js";
import { parseCSV, norm } from "../ui/csv.js";

const STATUTS = [["invite", "Invité"], ["confirme", "Confirmé"], ["venu", "Venu"], ["decline", "Décline"]];
const ETAB_TYPES = ["EHPAD", "Handicap", "Foyer", "Autre"];
let root, tab = "ecoles", mode = "list", contacts = [], parts = new Map();
let csvMsg = "", importTypes = ["EHPAD"];
const canWrite = () => isAdmin() || hasPole("intergenerationnelle");

export async function render(container) {
  root = container;
  if (!store.editionId) { root.innerHTML = `<div class="card"><p><a class="btn primary" href="#/editions">Choisir une édition</a></p></div>`; return; }
  root.innerHTML = `<div class="card"><p class="muted">Chargement…</p></div>`;
  const [cc, vp] = await Promise.all([
    supa.from("comm_contacts").select("*").order("nom"),
    supa.from("vendredi_participants").select("*").eq("edition_id", store.editionId),
  ]);
  contacts = cc.data || [];
  parts = new Map((vp.data || []).map((p) => [p.contact_id, p]));
  draw();
}

function draw() {
  const subTabs = `<div class="utabs">
    <button data-tab="ecoles"${tab === "ecoles" ? ' class="on"' : ""}>Écoles</button>
    <button data-tab="etab"${tab === "etab" ? ' class="on"' : ""}>Établissements</button>
    <button data-tab="deroule"${tab === "deroule" ? ' class="on"' : ""}>Déroulé du vendredi</button></div>`;
  let body;
  if (mode === "csv") body = csvView();
  else if (tab === "deroule") body = derouleTab();
  else if (tab === "etab") body = contactsTab(ETAB_TYPES, "Établissements invités le vendredi");
  else body = ecolesTab();
  root.innerHTML = `<div class="page-head"><div><h1>Intergénérationnel</h1>
      <div class="sub">Journée du vendredi</div></div>
      <div class="head-actions"><a class="btn" href="#/jeux/malles">Malles des écoles →</a></div></div>
    ${subTabs}${body}`;
  wire();
}

/* ---------- Écoles qui viennent au festival ---------- */
const DEMI_LBL = { matin: "Matin", aprem: "Après-midi" };
const classesDe = (p) => (Array.isArray(p?.classes) ? p.classes : []);
const totalEleves = (p) => classesDe(p).reduce((t, c) => t + (parseInt(c.eleves, 10) || 0), 0);
function ecolesTab() {
  const w = canWrite(), ro = w ? "" : " disabled";
  const carnet = contacts.filter((c) => c.type === "École");
  const retenues = carnet.filter((c) => parts.has(c.id) && parts.get(c.id).statut !== "decline");
  const libres = carnet.filter((c) => !parts.has(c.id));
  const n = (d) => retenues.filter((c) => parts.get(c.id).demi_journee === d).length;
  const eleves = retenues.reduce((t, c) => t + totalEleves(parts.get(c.id)), 0);
  const kpis = `<div class="grid g4">
    <div class="kpi"><span class="v">${retenues.length}</span>Écoles qui viennent</div>
    <div class="kpi"><span class="v">${n("matin")}</span>Le matin</div>
    <div class="kpi"><span class="v">${n("aprem")}</span>L'après-midi</div>
    <div class="kpi"><span class="v">${eleves}</span>Élèves</div></div>`;
  const ajout = w ? `<div class="card"><div class="ihead"><h3>Ajouter une école qui vient</h3></div>
    <div class="filters" style="align-items:flex-end">
      <label>École du carnet<select id="e-ecole"><option value="">— choisir —</option>${libres.map((c) => `<option value="${c.id}">${esc(c.nom)}${c.commune && c.commune !== c.nom ? ` (${esc(c.commune)})` : ""}</option>`).join("")}</select></label>
      <button class="btn primary" id="e-retenir">Ajouter</button></div>
    <details class="pub-editor"><summary>École absente du carnet ?</summary>
      <div class="filters" style="align-items:flex-end">
        <label>Nom<input id="e-nom" placeholder="École…"></label>
        <label>Commune<input id="e-commune"></label>
        <button class="btn" id="e-creer">Ajouter au carnet et à la liste</button></div>
      <p class="mini">Le carnet (écran Communication) sert à la diffusion des flyers ; ici, seules les écoles qui viennent au festival.</p></details>
    <p class="msg" id="d-msg"></p></div>` : "";
  const cartes = retenues.map((c) => {
    const p = parts.get(c.id), cls = classesDe(p);
    const lignes = cls.map((cl, i) => `<tr>
        <td><input data-cl="${c.id}|${i}|nom" value="${esc(cl.nom || "")}" placeholder="ex. CM1" aria-label="Classe" style="margin:0;min-width:110px"${ro}></td>
        <td><input type="number" min="0" data-cl="${c.id}|${i}|eleves" value="${cl.eleves ?? ""}" aria-label="Nombre d'élèves" style="margin:0;width:90px"${ro}></td>
        <td style="text-align:right">${w ? `<button class="btn small danger" data-cldel="${c.id}|${i}" aria-label="Retirer la classe">×</button>` : ""}</td></tr>`).join("")
      || `<tr><td colspan="3" class="muted">Aucune classe saisie.</td></tr>`;
    return `<div class="card"><div class="ihead"><h3>${esc(c.nom)}${c.commune && c.commune !== c.nom ? ` <span class="muted">${esc(c.commune)}</span>` : ""}</h3>
        <span class="muted">${totalEleves(p)} élève(s)</span></div>
      <div class="filters" style="align-items:flex-end">
        <label>Vient<select data-edemi="${c.id}"${ro}><option value="">— à préciser —</option>${Object.entries(DEMI_LBL).map(([k, l]) => `<option value="${k}"${p.demi_journee === k ? " selected" : ""}>${l}</option>`).join("")}</select></label>
        ${w ? `<button class="btn small danger" data-eretirer="${c.id}">Ne vient plus</button>` : ""}</div>
      <div class="scroll"><table class="data-table"><thead><tr><th>Classe</th><th>Élèves</th><th></th></tr></thead><tbody>${lignes}</tbody></table></div>
      ${w ? `<button class="btn small" data-cladd="${c.id}">+ Ajouter une classe</button>` : ""}</div>`;
  }).join("") || `<div class="card"><p class="muted">Aucune école pour l'instant.</p></div>`;
  return `<div class="ihead"><h2 class="sect-title">Écoles qui viennent au festival</h2></div>${kpis}${ajout}${cartes}
    <p class="mini">Une malle de jeux par école : <a href="#/jeux/malles">Jeux → Malles des écoles</a>.</p>`;
}
async function saveClasses(contactId, classes) {
  const total = classes.reduce((t, c) => t + (parseInt(c.eleves, 10) || 0), 0);
  await setPart(contactId, { classes, effectif: total || null });
}
function majClasse(key, val) {
  const [cid, i, champ] = key.split("|");
  const p = parts.get(cid); if (!p) return;
  const cls = classesDe(p).map((c) => ({ ...c }));
  if (!cls[+i]) return;
  cls[+i][champ] = champ === "eleves" ? (parseInt(val, 10) || 0) : val.trim();
  saveClasses(cid, cls);
}

/* ---------- Établissements (contacts + participation vendredi) ---------- */
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
      <td><div class="heures"><input type="time" data-pdeb="${c.id}" value="${esc((p?.heure_debut || "").slice(0, 5))}" aria-label="Arrivée de ${esc(c.nom)}"${ro}>
        <span class="muted">→</span><input type="time" data-pfin="${c.id}" value="${esc((p?.heure_fin || "").slice(0, 5))}" aria-label="Départ de ${esc(c.nom)}"${ro}></div>
        ${p?.creneau && !p?.heure_debut ? `<span class="mini">avant : ${esc(p.creneau)}</span>` : ""}</td>
      <td>${statSel(c)}</td></tr>`;
  }).join("") || `<tr><td colspan="5" class="muted">Aucun contact. Ajoute-en ou importe un CSV.</td></tr>`;

  const table = `<div class="card"><div class="scroll"><table class="data-table">
    <thead><tr><th>${isEcole ? "École" : "Établissement"}</th><th>Email</th><th>Effectif</th><th>Arrivée → départ</th><th>Participation</th></tr></thead>
    <tbody>${body}</tbody></table></div>
    <p class="mini">Mettre « Invité/Confirmé » retient le contact pour le vendredi ; « — non invité — » le retire (le contact reste dans le carnet).</p></div>`;

  return `<div class="ihead"><h2 class="sect-title">${esc(title)}</h2></div>${kpis}${addForm}${table}`;
}

/* ---------- Déroulé du vendredi ---------- */
// Toutes les structures invitées ou confirmées (écoles + établissements), par heure d'arrivée.
function derouleTab() {
  const hm = (t) => (t || "").slice(0, 5);
  const STAT = Object.fromEntries(STATUTS);
  // Moment de la journée : demi-journée choisie (écoles), sinon heure d'arrivée (avant 13 h =
  // matin), sinon « à préciser ».
  const moment = (p) => p.demi_journee || (p.heure_debut ? (hm(p.heure_debut) < "13:00" ? "matin" : "aprem") : "");
  const liste = [...parts.values()].filter((p) => p.statut !== "decline")
    .map((p) => ({ p, c: contacts.find((x) => x.id === p.contact_id) })).filter((x) => x.c)
    .sort((a, b) => (a.p.heure_debut || "99").localeCompare(b.p.heure_debut || "99") || a.c.nom.localeCompare(b.c.nom, "fr"));
  const ligne = ({ p, c }) => {
    const cls = classesDe(p).map((x) => x.nom).filter(Boolean).join(", ");
    return `<tr>
      <td><b>${p.heure_debut ? `${esc(hm(p.heure_debut))}${p.heure_fin ? "–" + esc(hm(p.heure_fin)) : ""}` : `<span class="muted">${esc(p.creneau || "—")}</span>`}</b></td>
      <td>${esc(c.nom)} <span class="muted">${esc(c.type || "")}${cls ? " · " + esc(cls) : ""}</span></td>
      <td>${p.effectif ?? "—"}</td>
      <td><span class="tag ${p.statut === "invite" ? "warn" : "ok"}">${esc(STAT[p.statut] || p.statut)}</span></td></tr>`;
  };
  const bloc = (titre, items) => {
    const total = items.filter(({ p }) => ["confirme", "venu"].includes(p.statut)).reduce((t, { p }) => t + (p.effectif || 0), 0);
    return `<div class="card"><div class="ihead"><h3>${esc(titre)}</h3><span class="muted">${plurS(items.length, "structure")} · ${total} personne(s)</span></div>
      ${items.length ? `<div class="scroll"><table class="data-table"><thead><tr><th>Heure</th><th>Structure</th><th>Effectif</th><th>Statut</th></tr></thead>
      <tbody>${items.map(ligne).join("")}</tbody></table></div>` : `<p class="muted">Personne pour l'instant.</p>`}</div>`;
  };
  const sansMoment = liste.filter((x) => !moment(x.p));
  return `<div class="ihead"><h2 class="sect-title">Déroulé du vendredi</h2></div>
    ${bloc("Matin", liste.filter((x) => moment(x.p) === "matin"))}
    ${bloc("Après-midi", liste.filter((x) => moment(x.p) === "aprem"))}
    ${sansMoment.length ? bloc("À préciser", sansMoment) : ""}
    <p class="mini">Écoles : matin ou après-midi (onglet Écoles) ; établissements : heures d'arrivée (onglet Établissements, avant 13 h = matin).</p>`;
}
const plurS = (n, mot) => `${n} ${mot}${n > 1 ? "s" : ""}`;

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
  root.querySelectorAll("[data-pdeb]").forEach((i) => (i.onchange = () => setPart(i.dataset.pdeb, { heure_debut: i.value || null })));
  root.querySelectorAll("[data-pfin]").forEach((i) => (i.onchange = () => setPart(i.dataset.pfin, { heure_fin: i.value || null })));
  // Écoles qui viennent
  const er = root.querySelector("#e-retenir"); if (er) er.onclick = () => { const id = root.querySelector("#e-ecole").value; if (id) setStat(id, "confirme"); else dmsg("Choisis une école du carnet."); };
  const ec = root.querySelector("#e-creer"); if (ec) ec.onclick = creerEcole;
  root.querySelectorAll("[data-edemi]").forEach((sl) => (sl.onchange = () => setPart(sl.dataset.edemi, { demi_journee: sl.value || null })));
  root.querySelectorAll("[data-eretirer]").forEach((b) => (b.onclick = () => {
    const c = contacts.find((x) => x.id === b.dataset.eretirer);
    if (confirm(`« ${c?.nom || "Cette école"} » ne vient plus ? Ses classes saisies sont effacées (l'école reste dans le carnet).`)) setStat(b.dataset.eretirer, "");
  }));
  root.querySelectorAll("[data-cl]").forEach((i) => (i.onchange = () => majClasse(i.dataset.cl, i.value)));
  root.querySelectorAll("[data-cladd]").forEach((b) => (b.onclick = () => { const p = parts.get(b.dataset.cladd); saveClasses(b.dataset.cladd, [...classesDe(p), { nom: "", eleves: 0 }]); }));
  root.querySelectorAll("[data-cldel]").forEach((b) => (b.onclick = () => {
    const [cid, i] = b.dataset.cldel.split("|"); const cls = classesDe(parts.get(cid)).filter((_, k) => k !== +i); saveClasses(cid, cls);
  }));
  const cf = root.querySelector("#csv-file"); if (cf) cf.onchange = () => { const f = cf.files[0]; if (f) f.text().then((t) => { const ta = root.querySelector("#csv-text"); if (ta) ta.value = t; }); };
  const cg = root.querySelector("#csv-go"); if (cg) cg.onclick = csvImport;
  const cc = root.querySelector("#csv-cancel"); if (cc) cc.onclick = () => { mode = "list"; draw(); };
}

const dmsg = (t) => { const m = root.querySelector("#d-msg"); if (m) m.textContent = t; };

async function creerEcole() {
  const nom = (root.querySelector("#e-nom")?.value || "").trim();
  if (!nom) return dmsg("Nom de l'école requis.");
  const { data, error } = await supa.from("comm_contacts")
    .insert({ nom, type: "École", commune: (root.querySelector("#e-commune")?.value || "").trim() || null }).select().single();
  if (error) return dmsg("Erreur : " + error.message);
  contacts.push(data); contacts.sort((a, b) => a.nom.localeCompare(b.nom, "fr"));
  await setStat(data.id, "confirme");
}
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
    // Écoles : effectif = total des classes (pas le nombre de flyers du carnet).
    effectif: cur?.effectif ?? (c?.type === "École" ? null : (c?.quantite_flyers || null)), creneau: cur?.creneau || null };
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
