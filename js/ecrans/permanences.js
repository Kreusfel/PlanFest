// Écran #/permanences — page fusionnée « Animation & permanences ».
// Regroupe l'ancien Planning d'animation (parties), les permanences bénévoles
// et la couverture des tables Jurande. 3 sous-onglets : Couverture / Animations /
// Permanences. Une table est COUVERTE si elle est occupée (une partie prévue OU
// une permanence d'animateur) sur les horaires d'ouverture du jour.
import { supa } from "../supabase.js";
import { isAdmin, hasPole } from "../auth.js";
import { store } from "../store.js";
import { esc, plur, toast } from "../ui/util.js";
import { exportFeuillesBenevoles, exportPlanningTables } from "../export/permanences-pdf.js";

const CELL = 22, M = 14;
const JOURS = { ven: "Vendredi", sam: "Samedi", dim: "Dimanche" };
const ALERTE_LBL = {
  sans_animateur: "Sans animateur", sans_competence: "Pas la compétence",
  double_attribution: "Animateur en double", table_chevauchement: "Tables en conflit",
  places: "Trop de places", jeu_hors_categorie: "Hors catégorie",
  exemplaires: "Trop d'exemplaires", indisponible: "Indisponible",
};
let root, ed = null, bens = [], anims = [], jeux = [], tables = [], salles = [], parts = [], alertes = {}, horaires = {}, postes = [], perms = [], inscParts = new Map();
let jour = "sam", tab = "couv", lastPoste = "", selTables = new Set(), suggestId = null, suggestList = [];
const canWrite = () => isAdmin() || hasPole("animateurs_benevoles");

export async function render(container) {
  root = container;
  if (!store.editionId) { root.innerHTML = `<div class="card"><p><a class="btn primary" href="#/editions">Choisir une édition</a></p></div>`; return; }
  root.innerHTML = `<div class="card"><p class="muted">Chargement…</p></div>`;
  await load();
  const days = ed.jours_actifs || ["sam", "dim"];
  if (!days.includes(jour)) jour = days[0] || "sam";
  draw();
}

async function load() {
  const edi = store.editionId;
  const [e, be, el, bq, pm, s, pa, h, je, al, pi] = await Promise.all([
    supa.from("editions").select("id,nom,jours_actifs").eq("id", edi).single(),
    supa.from("benevoles_editions").select("id,statut,est_animateur,equipes,benevoles(nom)").eq("edition_id", edi),
    supa.from("elements").select("id,numero,type_table,mode,kind,sous,label,salle_id,x,y,w,h,chaises").eq("edition_id", edi).in("kind", ["table", "bloc"]),
    supa.from("besoins_equipes").select("equipe").eq("edition_id", edi),
    supa.from("permanences").select("id,benevole_edition_id,poste,jour,debut,fin,element_id").eq("edition_id", edi),
    supa.from("salles").select("id,nom,cols,rows").eq("edition_id", edi).order("cree_le"),
    supa.from("parties").select("id,element_id,jour,debut,duree_min,fin,titre,places,jeu_edition_id,benevole_edition_id,jeux_editions(jeux(titre)),benevoles_editions(benevoles(nom))").eq("edition_id", edi),
    supa.from("horaires_ouverture").select("jour,debut,fin").eq("edition_id", edi),
    supa.from("jeux_editions").select("id,jeux(titre)").eq("edition_id", edi),
    supa.from("alertes_parties").select("*").eq("edition_id", edi),
    supa.from("partie_inscriptions").select("partie_id,nb").eq("edition_id", edi),
  ]);
  inscParts = new Map();
  (pi.data || []).forEach((r) => inscParts.set(r.partie_id, (inscParts.get(r.partie_id) || 0) + r.nb));
  ed = e.data || {};
  const act = (be.data || []).filter((b) => b.statut !== "annule");
  bens = act.map((b) => ({ id: b.id, nom: b.benevoles?.nom || "?" })).sort((a, b) => a.nom.localeCompare(b.nom, "fr"));
  anims = act.map((b) => ({ id: b.id, nom: b.benevoles?.nom || "?", est_animateur: b.est_animateur }))
    .sort((a, b) => (b.est_animateur - a.est_animateur) || a.nom.localeCompare(b.nom, "fr"));
  tables = (el.data || []).sort((a, b) => (parseInt(a.numero, 10) || 0) - (parseInt(b.numero, 10) || 0));
  salles = s.data || [];
  jeux = je.data || [];
  parts = pa.data || [];
  horaires = {};
  (h.data || []).forEach((r) => { horaires[r.jour] = { debut: r.debut, fin: r.fin }; });
  alertes = {};
  (al.data || []).forEach((a) => { (alertes[a.partie_id] = alertes[a.partie_id] || []).push(a.code); });
  const set = new Set();
  act.forEach((b) => (b.equipes || []).forEach((x) => set.add(x)));
  (bq.data || []).forEach((b) => set.add(b.equipe));
  (pm.data || []).forEach((p) => set.add(p.poste));
  postes = [...set].filter(Boolean).sort((a, b) => a.localeCompare(b, "fr"));
  perms = pm.data || [];
}

const benNom = (id) => bens.find((b) => b.id === id)?.nom || "";
const tLabel = (id) => { const t = tables.find((x) => x.id === id); return t ? "n°" + (t.numero || "?") : "?"; };
const locLabel = (id) => { const t = tables.find((x) => x.id === id); if (!t) return "?"; return t.kind === "bloc" ? (t.label || "Zone") : "n°" + (t.numero || "?"); };
const hhmm = (t) => (t ? String(t).slice(0, 5) : "");
const toMin = (t) => { if (!t) return null; const [h, m] = String(t).split(":"); return (+h) * 60 + (+m); };
const fmt = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

// Couverture (union parties + permanences) d'une table Jurande animée, un jour donné.
function cover(tableId, j) {
  const hh = horaires[j] || {};
  const o1 = toMin(hh.debut), o2 = toMin(hh.fin);
  if (o1 == null || o2 == null || o2 <= o1) return { noHours: true, gaps: [], nb: 0 };
  const ivs = [];
  parts.filter((p) => p.element_id === tableId && p.jour === j).forEach((p) => { const d = toMin(p.debut); ivs.push([Math.max(o1, d), Math.min(o2, d + p.duree_min)]); });
  perms.filter((p) => p.element_id === tableId && p.jour === j).forEach((p) => ivs.push([Math.max(o1, toMin(p.debut)), Math.min(o2, toMin(p.fin))]));
  const clipped = ivs.filter(([a, b]) => b > a).sort((a, b) => a[0] - b[0]);
  const merged = [];
  clipped.forEach((iv) => { const last = merged[merged.length - 1]; if (last && iv[0] <= last[1]) last[1] = Math.max(last[1], iv[1]); else merged.push([...iv]); });
  const gaps = []; let cur = o1;
  merged.forEach(([a, b]) => { if (a > cur) gaps.push([cur, a]); cur = Math.max(cur, b); });
  if (cur < o2) gaps.push([cur, o2]);
  return { noHours: false, gaps, nb: clipped.length };
}
function statut(c) {
  if (c.noHours) return { key: "nohours", label: "Horaires manquants", cls: "warn" };
  if (c.nb === 0) return { key: "vide", label: "Non couverte", cls: "bad" };
  if (c.gaps.length) return { key: "partiel", label: "Partielle", cls: "warn" };
  return { key: "couvert", label: "Couverte", cls: "ok" };
}

function draw() {
  const days = ed.jours_actifs || ["sam", "dim"];
  const dayTabs = days.map((d) => `<button class="pill-btn${d === jour ? " on" : ""}" data-jour="${d}">${esc(JOURS[d] || d)}</button>`).join("");
  const subTabs = `<div class="utabs">
    <button data-tab="couv"${tab === "couv" ? ' class="on"' : ""}>Couverture</button>
    <button data-tab="anim"${tab === "anim" ? ' class="on"' : ""}>Parties</button>
    <button data-tab="perm"${tab === "perm" ? ' class="on"' : ""}>Permanences</button></div>`;

  const body = tab === "anim" ? animTab() : tab === "perm" ? permTab() : couvTab();

  root.innerHTML = `
    <div class="ihead" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
      <div><h1>Animations</h1><div class="sub">Parties, permanences et couverture des tables Jurande</div></div>
      <div class="head-actions">
        <button class="btn small" id="pdf-feuilles">Feuilles bénévoles (PDF)</button>
        <button class="btn small" id="pdf-tables">Planning des tables (PDF)</button>
      </div></div>
    <div class="salle-tabs">${dayTabs}</div>
    ${subTabs}
    ${body}`;
  wire();
}

/* ---------- onglet Couverture ---------- */
function couvTab() {
  const covTables = tables.filter((t) => t.kind === "table" && t.type_table === "jurande" && t.mode === "animee");
  const covByTable = new Map(covTables.map((t) => [t.id, cover(t.id, jour)]));
  const n = { couvert: 0, partiel: 0, vide: 0, nohours: 0 };
  covTables.forEach((t) => { n[statut(covByTable.get(t.id)).key]++; });
  const unassigned = perms.filter((p) => p.jour === jour && !p.benevole_edition_id).length;
  const h = horaires[jour] || {};

  const horairesCard = `<div class="card">
    <div class="ihead"><h3>Horaires d'ouverture — ${esc(JOURS[jour] || jour)}</h3></div>
    <div class="filters" style="align-items:flex-end">
      <label>Ouverture<input type="time" id="ouv-deb" value="${h.debut ? h.debut.slice(0, 5) : ""}"></label>
      <label>Fermeture<input type="time" id="ouv-fin" value="${h.fin ? h.fin.slice(0, 5) : ""}"></label>
      <button class="btn primary" id="ouv-save">Enregistrer</button>
      <span class="muted" id="ouv-msg"></span>
    </div>
    <p class="sub">Couverture = table occupée (partie OU permanence d'animateur) sur cette fenêtre.</p></div>`;

  const kpis = `<div class="grid g4">
    <div class="kpi"><span class="v" style="color:#15803D">${n.couvert}</span>Tables couvertes</div>
    <div class="kpi"><span class="v" style="${n.partiel ? "color:#B45309" : ""}">${n.partiel}</span>Partielles</div>
    <div class="kpi"><span class="v" style="${n.vide ? "color:#991B1B" : ""}">${n.vide}</span>Non couvertes</div>
    <div class="kpi"><span class="v" style="${unassigned ? "color:#991B1B" : ""}">${unassigned}</span>Permanences non attribuées</div></div>`;

  if (!covTables.length) return horairesCard + kpis + `<div class="card"><p class="muted">Aucune table Jurande animée dans le plan. La logistique doit en poser (Plan des salles).</p></div>`;

  const plan = salles.map((s) => salleSVG(s, covByTable)).join("");
  const rows = covTables.map((t) => {
    const c = covByTable.get(t.id), st = statut(c);
    const gaps = c.gaps.map(([a, b]) => `${fmt(a)}–${fmt(b)}`).join(", ");
    return `<tr><td><b>n°${esc(t.numero ?? "?")}</b></td>
      <td><span class="tag ${st.cls}">${esc(st.label)}</span></td>
      <td>${c.noHours ? "" : (gaps ? `<span style="color:#B45309">${esc(gaps)}</span>` : "<span class='muted'>complète</span>")}</td></tr>`;
  }).join("");
  const legend = `<div class="legend pub-legend">
    <span><i style="background:#DCFCE7;border:1px solid #16A34A"></i>Couverte</span>
    <span><i style="background:#FEF3C7;border:1px solid #D4A72C"></i>Partielle</span>
    <span><i style="background:#FEE2E2;border:1px solid #DC2626"></i>Non couverte</span>
    <span><i style="border:2px dashed #EA580C;background:#fff"></i>Trou (anneau orange)</span></div>`;
  return `${horairesCard}${kpis}${plan}<div class="card"><div class="scroll"><table class="data-table">
    <thead><tr><th>Table</th><th>État</th><th>Trous (créneaux non couverts)</th></tr></thead>
    <tbody>${rows}</tbody></table></div></div>${legend}`;
}

function salleSVG(salle, covByTable) {
  const els = tables.filter((e) => e.salle_id === salle.id);
  if (!els.length) return "";
  const W = salle.cols * CELL, H = salle.rows * CELL;
  let g = `<rect width="${W}" height="${H}" fill="#fff"/>`;
  for (let i = 0; i <= salle.cols; i++) g += `<line x1="${i * CELL}" y1="0" x2="${i * CELL}" y2="${H}" stroke="#F1F1F3"/>`;
  for (let j = 0; j <= salle.rows; j++) g += `<line x1="0" y1="${j * CELL}" x2="${W}" y2="${j * CELL}" stroke="#F1F1F3"/>`;
  g += `<rect width="${W}" height="${H}" fill="none" stroke="#111" stroke-width="1.3"/>`;
  els.forEach((e) => {
    const px = e.x * CELL, py = e.y * CELL, w = e.w * CELL, h = e.h * CELL;
    const isJA = e.kind === "table" && e.type_table === "jurande" && e.mode === "animee";
    let fill = "#F4F4F5", stroke = "#D4D4D8", ring = false, label = "";
    if (isJA) {
      const c = covByTable.get(e.id), st = statut(c);
      fill = st.key === "couvert" ? "#DCFCE7" : st.key === "vide" ? "#FEE2E2" : "#FEF3C7";
      stroke = st.key === "couvert" ? "#16A34A" : st.key === "vide" ? "#DC2626" : "#D4A72C";
      ring = !c.noHours && (st.key === "partiel" || st.key === "vide");
      label = e.numero || "";
    }
    g += `<rect x="${px + 1}" y="${py + 1}" width="${w - 2}" height="${h - 2}" rx="3" fill="${fill}" stroke="${stroke}" stroke-width="1.2"/>`;
    if (ring) g += `<rect x="${px - 2}" y="${py - 2}" width="${w + 4}" height="${h + 4}" rx="5" fill="none" stroke="#EA580C" stroke-width="2.2" stroke-dasharray="4 3"/>`;
    if (label) g += `<text x="${px + w / 2}" y="${py + h / 2 + 4}" text-anchor="middle" font-size="10" font-weight="700" fill="#111">${esc(label)}</text>`;
  });
  return `<div class="card pub-plan"><div class="muted" style="margin-bottom:6px">${esc(salle.nom)}</div>
    <svg viewBox="0 0 ${W + 2 * M} ${H + 2 * M}" width="100%" style="max-width:${W + 2 * M}px;height:auto;display:block">
    <g transform="translate(${M},${M})">${g}</g></svg></div>`;
}

/* ---------- onglet Animations (parties) ---------- */
function animTab() {
  const jurande = tables.filter((t) => t.kind === "table" && t.type_table === "jurande" && t.mode === "animee");
  const dayParts = parts.filter((p) => p.jour === jour)
    .sort((a, b) => (parseInt(tLabel(a.element_id).slice(2)) || 0) - (parseInt(tLabel(b.element_id).slice(2)) || 0) || (a.debut || "").localeCompare(b.debut || ""));
  const form = !jurande.length ? `<div class="card"><p class="muted">Aucune table Jurande animée dans le plan.</p></div>` : `
    <div class="card"><div class="ihead"><h3>Nouvelle animation — ${esc(JOURS[jour] || jour)}</h3></div>
      <div class="filters" style="align-items:flex-end">
        <label>Table<select data-p="element_id">${jurande.map((t) => `<option value="${t.id}">n°${esc(t.numero || "?")}${t.chaises ? ` (${t.chaises} ch.)` : ""}</option>`).join("")}</select></label>
        <label>Début<input type="time" data-p="debut" value="14:00"></label>
        <label>Durée (min)<input type="number" min="15" step="15" data-p="duree_min" value="60"></label>
        <label>Jeu<select data-p="jeu_edition_id"><option value="">— jeu —</option>${jeux.map((j) => `<option value="${j.id}">${esc(j.jeux?.titre || "?")}</option>`).join("")}</select></label>
        <label>Animateur<select data-p="benevole_edition_id"><option value="">— animateur —</option>${anims.map((a) => `<option value="${a.id}">${esc(a.nom)}${a.est_animateur ? "" : " (non anim.)"}</option>`).join("")}</select></label>
        <label>Places<input type="number" min="1" data-p="places" style="width:80px"></label>
        <button class="btn primary" id="p-create">Ajouter</button>
      </div><p class="msg" id="p-msg" aria-live="polite"></p></div>`;

  const list = dayParts.map(partyRow).join("") || `<div class="card"><p class="muted">Aucune animation ${esc(JOURS[jour] || jour)}.</p></div>`;
  return form + `<div class="list">${list}</div>`;
}
function partyRow(p) {
  const jeu = p.jeux_editions?.jeux?.titre || p.titre || "—";
  const anim = p.benevole_edition_id ? (p.benevoles_editions?.benevoles?.nom || "?") : "—";
  const al = (alertes[p.id] || []).map((c) => `<span class="pill alert">${esc(ALERTE_LBL[c] || c)}</span>`).join(" ");
  const pris = inscParts.get(p.id) || 0;
  const full = p.places != null && pris >= p.places;
  const places = p.places != null
    ? ` · <span class="${full ? "" : ""}" style="${full ? "color:#991B1B;font-weight:600" : ""}">${pris}/${p.places} inscrits${full ? " — complet" : ""}</span>`
    : (pris ? ` · ${pris} inscrits` : "");
  return `<div class="row">
    <div class="row-main">
      <b>${esc(tLabel(p.element_id))} · ${esc(hhmm(p.debut))}–${esc(hhmm(p.fin))}</b>
      <span class="muted">${esc(jeu)} · ${esc(anim)}${places}</span>
      ${al ? `<div>${al}</div>` : ""}</div>
    <div class="actions">
      ${canWrite() ? `<button class="btn small" data-suggest="${p.id}">Suggérer</button>
      <button class="btn small danger" data-pdel="${p.id}">Suppr.</button>` : ""}
    </div></div>${suggestId === p.id ? suggestPanel(p) : ""}`;
}
function suggestPanel(p) {
  if (!suggestList.length) return `<div class="suggest"><span class="muted">Aucun animateur compétent et disponible pour ce créneau.</span></div>`;
  const items = suggestList.map((s) => `<button class="btn small" data-assign="${p.id}:${s.benevole_edition_id}" title="${esc(s.raison || "")}">${esc(s.nom)}${s.competent ? " ✓" : ""}</button>`).join("");
  return `<div class="suggest"><span class="mini">Proposer :</span> ${items}</div>`;
}

/* ---------- onglet Permanences ---------- */
function permTab() {
  const jurandeTables = tables.filter((t) => t.kind === "table" && t.type_table === "jurande");
  const chips = jurandeTables.length
    ? `<label style="margin-top:4px">Sur une ou plusieurs tables de la Jurande (optionnel)</label>
       <div class="salle-tabs">${jurandeTables.map((t) => `<button type="button" class="pill-btn${selTables.has(t.id) ? " on" : ""}" data-tbl="${t.id}">n°${esc(t.numero ?? "?")}</button>`).join("")}</div>`
    : "";
  const form = `<div class="card"><div class="ihead"><h3>Ajouter une permanence — ${esc(JOURS[jour] || jour)}</h3></div>
    <div class="filters" style="align-items:flex-end">
      <label>Poste<input list="postes-dl" id="f-poste" placeholder="Accueil, Buvette…" value="${esc(lastPoste)}"></label>
      <datalist id="postes-dl">${postes.map((p) => `<option value="${esc(p)}"></option>`).join("")}</datalist>
      <label>Bénévole<select id="f-ben"><option value="">— non attribué —</option>${bens.map((b) => `<option value="${b.id}">${esc(b.nom)}</option>`).join("")}</select></label>
      <label>Début<input type="time" id="f-deb"></label>
      <label>Fin<input type="time" id="f-fin"></label>
      <button class="btn primary" id="f-add">Ajouter</button>
    </div>
    ${chips}<p class="msg" id="f-msg" aria-live="polite"></p></div>`;

  const dayPerms = perms.filter((p) => p.jour === jour);
  const used = [...new Set(dayPerms.map((p) => p.poste))].sort((a, b) => a.localeCompare(b, "fr"));
  const benOpts = (sel) => `<option value="">— non attribué —</option>` + bens.map((b) => `<option value="${b.id}"${b.id === sel ? " selected" : ""}>${esc(b.nom)}</option>`).join("");
  const sections = used.map((poste) => {
    const rows = dayPerms.filter((p) => p.poste === poste).sort((a, b) => (a.debut || "").localeCompare(b.debut || ""));
    return `<div class="card"><div class="ihead"><h3>${esc(poste)}</h3><span class="muted">${rows.length} créneau${rows.length > 1 ? "x" : ""}</span></div>
      <div class="scroll"><table class="data-table"><thead><tr><th>Horaire</th><th>Bénévole</th><th>Table</th><th></th></tr></thead>
      <tbody>${rows.map((r) => `<tr>
        <td><b>${hhmm(r.debut)}–${hhmm(r.fin)}</b></td>
        <td><select data-setben="${r.id}" style="min-width:150px;margin:0">${benOpts(r.benevole_edition_id)}</select></td>
        <td>${r.element_id ? esc(locLabel(r.element_id)) : `<span class="muted">—</span>`}</td>
        <td style="text-align:right"><button class="btn small danger" data-del="${r.id}">Suppr.</button></td></tr>`).join("")}</tbody></table></div></div>`;
  }).join("");
  return form + (used.length ? sections : `<div class="card"><p class="muted">Aucune permanence ${esc(JOURS[jour] || jour)}. Ajoute un créneau ci-dessus.</p></div>`);
}

/* ---------- câblage ---------- */
function wire() {
  root.querySelectorAll("[data-jour]").forEach((b) => (b.onclick = () => { jour = b.dataset.jour; suggestId = null; draw(); }));
  root.querySelectorAll("[data-tab]").forEach((b) => (b.onclick = () => { tab = b.dataset.tab; draw(); }));
  const pf = root.querySelector("#pdf-feuilles"); if (pf) pf.onclick = () => runPdf(pf, exportFeuillesBenevoles);
  const pt = root.querySelector("#pdf-tables"); if (pt) pt.onclick = () => runPdf(pt, exportPlanningTables);
  // Couverture
  const save = root.querySelector("#ouv-save");
  if (save) save.onclick = async () => {
    const deb = root.querySelector("#ouv-deb").value || null, fin = root.querySelector("#ouv-fin").value || null;
    const m = root.querySelector("#ouv-msg"); m.textContent = "…";
    const { error } = await supa.from("horaires_ouverture").upsert({ edition_id: store.editionId, jour, debut: deb, fin }, { onConflict: "edition_id,jour" });
    if (error) { m.textContent = "Erreur : " + error.message; return; }
    horaires[jour] = { debut: deb, fin }; draw();
  };
  // Animations
  const pc = root.querySelector("#p-create"); if (pc) pc.onclick = createPartie;
  root.querySelectorAll("[data-suggest]").forEach((b) => (b.onclick = () => loadSuggest(b.dataset.suggest)));
  root.querySelectorAll("[data-assign]").forEach((b) => (b.onclick = () => assign(b.dataset.assign)));
  root.querySelectorAll("[data-pdel]").forEach((b) => (b.onclick = () => removePartie(b.dataset.pdel)));
  // Permanences
  const add = root.querySelector("#f-add"); if (add) add.onclick = addPerm;
  root.querySelectorAll("[data-tbl]").forEach((b) => (b.onclick = () => {
    const id = b.dataset.tbl;
    if (selTables.has(id)) { selTables.delete(id); b.classList.remove("on"); } else { selTables.add(id); b.classList.add("on"); }
  }));
  root.querySelectorAll("[data-del]").forEach((b) => (b.onclick = () => delPerm(b.dataset.del)));
  root.querySelectorAll("[data-setben]").forEach((s) => (s.onchange = () => setBen(s.dataset.setben, s.value || null)));
}

async function runPdf(btn, fn) {
  btn.disabled = true;
  try { await fn(store.editionId, ed.nom); } catch (e) { toast("Erreur export : " + (e.message || e)); }
  btn.disabled = false;
}
const pmsg = (t) => { const m = root.querySelector("#p-msg"); if (m) m.textContent = t; };
const fmsg = (t) => { const m = root.querySelector("#f-msg"); if (m) m.textContent = t; };

/* parties */
async function createPartie() {
  const g = (f) => root.querySelector(`[data-p="${f}"]`);
  const element_id = g("element_id").value, duree_min = parseInt(g("duree_min").value, 10);
  if (!element_id || !duree_min) return pmsg("Table et durée requises.");
  pmsg("Création…");
  const row = { edition_id: store.editionId, element_id, jour, debut: g("debut").value, duree_min,
    jeu_edition_id: g("jeu_edition_id").value || null, benevole_edition_id: g("benevole_edition_id").value || null,
    places: parseInt(g("places").value, 10) || null, titre: null };
  const { error } = await supa.from("parties").insert(row);
  if (error) return pmsg("Erreur : " + error.message);
  await load(); draw();
}
async function removePartie(id) {
  if (!confirm("Supprimer cette animation ?")) return;
  const { error } = await supa.from("parties").delete().eq("id", id);
  if (error) return toast("Erreur : " + error.message);
  await load(); draw();
}
async function loadSuggest(id) {
  if (suggestId === id) { suggestId = null; return draw(); }
  const { data, error } = await supa.rpc("suggestions_animateurs", { p_partie: id });
  suggestList = error ? [] : (data ?? []); suggestId = id; draw();
}
async function assign(key) {
  const i = key.indexOf(":"), partieId = key.slice(0, i), beId = key.slice(i + 1);
  const { error } = await supa.from("parties").update({ benevole_edition_id: beId }).eq("id", partieId);
  if (error) return toast("Erreur : " + error.message);
  suggestId = null; await load(); draw();
}

/* permanences */
async function addPerm() {
  const poste = (root.querySelector("#f-poste").value || "").trim();
  const deb = root.querySelector("#f-deb").value, fin = root.querySelector("#f-fin").value;
  const ben = root.querySelector("#f-ben").value || null;
  if (!poste) return fmsg("Indique un poste.");
  if (!deb || !fin) return fmsg("Indique l'heure de début et de fin.");
  if (fin <= deb) return fmsg("La fin doit être après le début.");
  const base = { edition_id: store.editionId, poste, jour, debut: deb, fin, benevole_edition_id: ben };
  const ids = [...selTables];
  const rows = ids.length ? ids.map((el) => ({ ...base, element_id: el })) : [{ ...base, element_id: null }];
  const { data, error } = await supa.from("permanences").insert(rows).select();
  if (error) return fmsg("Erreur : " + error.message);
  perms.push(...(data || [])); lastPoste = poste; selTables = new Set();
  if (!postes.includes(poste)) postes.push(poste), postes.sort((a, b) => a.localeCompare(b, "fr"));
  draw();
}
async function delPerm(id) {
  const { error } = await supa.from("permanences").delete().eq("id", id);
  if (error) return toast("Erreur : " + error.message);
  perms = perms.filter((p) => p.id !== id); draw();
}
async function setBen(id, ben) {
  const { error } = await supa.from("permanences").update({ benevole_edition_id: ben }).eq("id", id);
  if (error) return toast("Erreur : " + error.message);
  const p = perms.find((x) => x.id === id); if (p) p.benevole_edition_id = ben;
  draw();
}
