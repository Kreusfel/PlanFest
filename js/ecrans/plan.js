// Écran #/plan — Phase 0 (B1). Mise en page alignée sur la maquette.
import { supa } from "../supabase.js";
import { store } from "../store.js";
import { isAdmin, hasPole } from "../auth.js";
import { esc } from "../ui/util.js";
import { plan, loadPlan, curSalle, salleElements, maxNumero, freeSpot } from "../plan/model.js";
import { exportPlanPdf, exportPlanPng } from "../export/plan-pdf.js";
import { CELL, M, BLOCS, renderPlan } from "../plan/render.js";
import { markUpsert, markDelete, onStatus, onReload, flushNow } from "../plan/autosave.js";
import { initHistory, recordHistory, undo, redo, canUndo, canRedo } from "../plan/history.js";
import { startRealtime, stopRealtime } from "../plan/realtime.js";

let editable = false, svg, layer, zoom = 1, root, ro = null;

export async function render(container) {
  unmount();  // par sécurité si le routeur ne l'a pas fait
  root = container;
  if (!store.editionId) {
    root.innerHTML = `<div class="page-head"><div><h1>Plan des salles</h1>
      <div class="sub">Aucune édition sélectionnée</div></div></div>
      <div class="card"><p>Choisis d'abord une édition.</p>
      <a class="btn primary" href="#/editions">Aller aux éditions</a></div>`;
    return;
  }
  editable = isAdmin() || hasPole("logistique_securite");
  root.innerHTML = `<div class="card"><p class="muted">Chargement du plan…</p></div>`;
  // Les modifs encore en file partent vers LEUR édition avant de charger la nouvelle.
  await flushNow();
  try { await loadPlan(); } catch (e) {
    root.innerHTML = `<div class="card"><p class="msg">Erreur : ${esc(e.message || e)}</p></div>`;
    return;
  }
  buildShell();
  initHistory();
  onStatus(renderStatus);
  onReload(onRemoteChange);
  if (editable) startRealtime(onRemoteChange);
  updateHistButtons();
  window.addEventListener("beforeunload", flushNow);
}

// Appelé par le routeur quand on quitte l'écran (ou change d'édition) : plus aucun
// raccourci clavier, temps réel ni rappel d'autosave ne doit agir hors du plan.
export function unmount() {
  window.removeEventListener("keydown", onKey);
  window.removeEventListener("beforeunload", flushNow);
  stopRealtime();
  if (ro) { ro.disconnect(); ro = null; }
  onStatus(() => {}); onReload(() => {});
  flushNow();  // envoie tout de suite ce qui restait en attente
}

// Rendu complet après un changement non issu de l'utilisateur local (temps réel / conflit).
function renderAll() {
  if (!curSalle() && plan.salles.length) plan.salleId = plan.salles[0].id;
  renderTabs(); renderCanvas(); renderInspector();
}
function onRemoteChange() { renderAll(); initHistory(); updateHistButtons(); }

function updateHistButtons() {
  const u = document.getElementById("btn-undo"), r = document.getElementById("btn-redo");
  if (u) u.disabled = !canUndo();
  if (r) r.disabled = !canRedo();
}
function afterEdit() { recordHistory(); updateHistButtons(); }
function doUndo() { if (undo()) { renderAll(); updateHistButtons(); } }
function doRedo() { if (redo()) { renderAll(); updateHistButtons(); } }

function buildShell() {
  const blocOpts = Object.keys(BLOCS).map((k) => `<option value="${k}">${esc(BLOCS[k].label)}</option>`).join("");
  root.innerHTML = `
    <div class="page-head">
      <div><h1>Plan des salles</h1><div class="sub">${editable ? "Modification du plan" : "Lecture seule"}</div></div>
      <div class="head-actions">
        <span class="save" id="cb-save"></span>
        ${editable ? `<button class="btn small" id="btn-undo" title="Annuler (Ctrl+Z)">Annuler</button>
        <button class="btn small" id="btn-redo" title="Refaire (Ctrl+Maj+Z)">Refaire</button>` : ""}
        <span class="exp-group">
          <select class="exp-mode" id="exp-mode" title="Contenu de l'export"><option value="numeros">Numéros</option><option value="noms">Noms</option><option value="couleurs">Couleurs</option></select>
          <button class="btn small" id="exp-pdf">PDF</button>
          <button class="btn small" id="exp-png">PNG</button>
        </span>
      </div>
    </div>
    <nav class="tabs salles" id="tabs"></nav>
    <div class="planbody${editable ? "" : " readonly"}">
      ${editable ? `<aside class="palette card">
        <p class="lbl">Ajouter</p>
        <button class="btn block" data-act="add-table">Une table</button>
        <div class="inline"><input id="row-n" type="number" min="1" max="40" value="6">
          <select id="row-dir"><option value="h">Ligne</option><option value="v">Colonne</option></select></div>
        <button class="btn block" data-act="add-row">Ajouter la rangée</button>
        <p class="lbl">Repère</p>
        <select id="bloc-type">${blocOpts}</select>
        <button class="btn block" data-act="add-bloc">Ajouter le repère</button>
        <div class="hint">Clic = sélectionner · glisser = déplacer · poignée = redimensionner · <b>R</b> pivote · <b>Suppr</b> supprime.</div>
      </aside>` : ""}
      <section class="center card">
        <div class="legend">
          <span><i style="background:#a9c6e8"></i>Partenaire</span>
          <span><i style="background:#fbdd85"></i>Jurande animée</span>
          <span><i style="background:var(--surface);border:1.5px dashed var(--navy)"></i>Bar à jeux (libre)</span>
          <span><i style="background:var(--surface);border:1.5px dashed #b4453f"></i>À attribuer</span>
          <span><i style="background:var(--grey)"></i>Repère</span>
        </div>
        <div class="canvasbar">
          <span class="meta" id="cb-meta"></span>
          <span class="spacer"></span>
          <button class="btn small" data-z="out">−</button>
          <button class="btn small" data-z="fit">Ajuster</button>
          <button class="btn small" data-z="in">+</button>
        </div>
        <div class="canvas" id="canvas">
          <svg id="plan" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <pattern id="g1" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" fill="none" style="stroke:var(--line)" stroke-width="1"/></pattern>
              <pattern id="g5" width="200" height="200" patternUnits="userSpaceOnUse"><path d="M200 0H0V200" fill="none" style="stroke:var(--line-strong)" stroke-width="1.2"/></pattern>
              <pattern id="hatch" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="10" style="stroke:var(--line-strong)" stroke-width="4"/></pattern>
            </defs>
            <g id="layer"></g>
          </svg>
        </div>
      </section>
      <aside class="inspector card" id="inspector"></aside>
    </div>`;
  svg = document.getElementById("plan");
  layer = document.getElementById("layer");
  if (editable) {
    root.querySelector(".palette").addEventListener("click", onPalette);
    svg.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    // Délégation branchée UNE fois : #inspector persiste, seul son contenu est refait.
    document.getElementById("inspector").addEventListener("click", onInspectorClick);
    document.getElementById("btn-undo").onclick = doUndo;
    document.getElementById("btn-redo").onclick = doRedo;
  }
  root.querySelector(".canvasbar").addEventListener("click", onZoom);
  document.getElementById("tabs").addEventListener("click", onTabs);
  const expMode = () => document.getElementById("exp-mode")?.value || "numeros";
  document.getElementById("exp-pdf").onclick = async (e) => {
    e.target.disabled = true; try { await exportPlanPdf(store.editionId, plan.salles, salleElements, expMode()); } catch (_) { /* ignore */ } e.target.disabled = false;
  };
  document.getElementById("exp-png").onclick = async (e) => {
    const s = curSalle(); if (!s) return;
    e.target.disabled = true; try { await exportPlanPng(store.editionId, s, salleElements(s.id), expMode()); } catch (_) { /* ignore */ } e.target.disabled = false;
  };
  renderTabs(); renderCanvas(); renderInspector(); renderStatus("saved");
  if (window.ResizeObserver) { ro = new ResizeObserver(applyScale); ro.observe(document.getElementById("canvas")); }
}

/* ---------- rendus ---------- */
function renderTabs() {
  const t = plan.salles.map((s) =>
    `<button class="tab${s.id === plan.salleId ? " on" : ""}" data-salle="${s.id}">${esc(s.nom)} <span class="cnt">${
      [...plan.elements.values()].filter((e) => e.salle_id === s.id && e.kind === "table").length}</span></button>`).join("");
  document.getElementById("tabs").innerHTML = t + (editable ? `<button class="tab add" data-add-salle>+ Salle</button>` : "");
  const s = curSalle();
  document.getElementById("cb-meta").textContent = s ? `${s.cols} × ${s.rows} m · 1 case = 1 m` : "Aucune salle";
}
function renderCanvas() {
  const s = curSalle();
  if (!s) { layer.innerHTML = ""; svg.removeAttribute("viewBox"); return; }
  renderPlan(layer, svg, s);
  applyScale();
}
function applyScale() {
  const s = curSalle(); if (!s) return;
  const box = document.getElementById("canvas");
  if (!box || !svg) return;  // écran quitté / pas encore monté
  const vw = s.cols * CELL + 2 * M, vh = s.rows * CELL + 2 * M;
  const aw = Math.max(120, box.clientWidth - 36), ah = Math.max(120, box.clientHeight - 36);
  const fit = Math.max(0.2, Math.min(aw / vw, ah / vh, 1.8)) * zoom;
  svg.style.width = Math.round(vw * fit) + "px";
  svg.style.height = Math.round(vh * fit) + "px";
}
function renderStatus(st) {
  const el = document.getElementById("cb-save"); if (!el) return;
  const map = { pending: ["Modifié…", "var(--ink-3)"], sync: ["Enregistrement…", "#2f4b7b"],
    saved: ["Enregistré", "var(--ok)"], err: ["Erreur réseau", "var(--alert)"],
    conflict: ["Modifs distantes reprises", "var(--warn)"] };
  const m = map[st] || map.saved;
  el.textContent = m[0]; el.style.color = m[1];
}

function renderInspector() {
  const insp = document.getElementById("inspector");
  const sel = [...plan.sel].map((id) => plan.elements.get(id)).filter(Boolean);
  if (sel.length === 1) insp.innerHTML = fiche(sel[0]);
  else if (sel.length > 1) insp.innerHTML = `<div class="ihead"><h3>${sel.length} éléments</h3></div>${editable ? `<button class="btn danger block" data-act="del">Supprimer la sélection</button>` : ""}`;
  else insp.innerHTML = salleFiche();
  wireInspector();
}
function field(l, inner) { return `<label>${l}${inner}</label>`; }
function typePills(o) {
  const t = o.type_table === "jurande" ? `<span class="pill amber">Jurande</span>`
    : o.type_table === "partenaire" ? `<span class="pill blue">Partenaire</span>`
    : `<span class="pill grey">À attribuer</span>`;
  const m = o.type_table === "jurande"
    ? (o.mode === "libre" ? `<span class="pill grey">Libre</span>` : `<span class="pill ok">Animée</span>`) : "";
  return t + m;
}
function fiche(o) {
  if (o.kind === "table") {
    const head = `<div class="ihead"><h3>Table n°${esc(o.numero ?? "")}</h3><div class="pills">${typePills(o)}</div></div>`;
    if (!editable) return head + `<p class="muted">Lecture seule.</p>`;
    const cats = plan.categories.map((c) => `<option value="${c.id}"${c.id === o.categorie_id ? " selected" : ""}>${esc(c.nom)}</option>`).join("");
    return head +
      field("Numéro", `<input data-f="numero" value="${esc(o.numero ?? "")}">`) +
      field("Type", `<select data-f="type_table">
        <option value="non_attribuee"${o.type_table === "non_attribuee" ? " selected" : ""}>À attribuer</option>
        <option value="partenaire"${o.type_table === "partenaire" ? " selected" : ""}>Partenaire</option>
        <option value="jurande"${o.type_table === "jurande" ? " selected" : ""}>Jurande</option></select>`) +
      `<div class="row2">${field("Chaises", `<input type="number" min="0" data-f="chaises" value="${o.chaises ?? 0}">`)}${field("Zone", `<input data-f="zone" value="${esc(o.zone ?? "")}">`)}</div>` +
      (o.type_table === "jurande"
        ? field("Mode", `<select data-f="mode"><option value="animee"${o.mode === "animee" ? " selected" : ""}>Animée</option><option value="libre"${o.mode === "libre" ? " selected" : ""}>Libre (bar à jeux)</option></select>`) +
          field("Catégorie", `<select data-f="categorie_id"><option value="">—</option>${cats}</select>`)
        : "") +
      `<div class="row2">${field("Largeur (cases)", `<input type="number" min="1" data-f="w" value="${o.w}">`)}${field("Hauteur (cases)", `<input type="number" min="1" data-f="h" value="${o.h}">`)}</div>` +
      `<div class="actions"><button class="btn" data-act="dup">Dupliquer</button><button class="btn" data-act="rot">Pivoter</button><button class="btn danger" data-act="del">Supprimer</button></div>`;
  }
  const cfg = BLOCS[o.sous] || BLOCS.autre;
  const head = `<div class="ihead"><h3>${esc(o.label || cfg.label)}</h3><div class="pills"><span class="pill grey">Repère</span></div></div>`;
  if (!editable) return head + `<p class="muted">Lecture seule.</p>`;
  return head +
    field("Type", `<select data-f="sous">${Object.keys(BLOCS).map((k) => `<option value="${k}"${k === o.sous ? " selected" : ""}>${esc(BLOCS[k].label)}</option>`).join("")}</select>`) +
    field("Libellé", `<input data-f="label" value="${esc(o.label ?? "")}">`) +
    `<div class="row2">${field("Largeur (cases)", `<input type="number" min="1" data-f="w" value="${o.w}">`)}${field("Hauteur (cases)", `<input type="number" min="1" data-f="h" value="${o.h}">`)}</div>` +
    `<div class="actions"><button class="btn" data-act="dup">Dupliquer</button><button class="btn" data-act="rot">Pivoter</button><button class="btn danger" data-act="del">Supprimer</button></div>`;
}
function salleFiche() {
  const s = curSalle();
  if (!s) return `<div class="ihead"><h3>Plan</h3></div>${editable ? `<p class="muted">Aucune salle. Ajoute-en une avec « + Salle ».</p>` : `<p class="muted">Aucune salle.</p>`}`;
  if (!editable) return `<div class="ihead"><h3>${esc(s.nom)}</h3></div><p class="muted">${s.cols} × ${s.rows} m.</p>`;
  return `<div class="ihead"><h3>Salle</h3></div>` +
    field("Nom", `<input data-sf="nom" value="${esc(s.nom)}">`) +
    `<div class="row2">${field("Largeur (m)", `<input type="number" min="4" max="80" data-sf="cols" value="${s.cols}">`)}${field("Longueur (m)", `<input type="number" min="4" max="80" data-sf="rows" value="${s.rows}">`)}</div>` +
    (s.ici_x == null
      ? `<button class="btn block${placingIci ? " primary" : ""}" data-act="place-ici">${placingIci ? "Cliquez sur le plan…" : "Placer « Vous êtes ici »"}</button>`
      : `<div class="row2"><button class="btn${placingIci ? " primary" : ""}" data-act="place-ici">${placingIci ? "Cliquez…" : "Déplacer le repère"}</button><button class="btn danger" data-act="clear-ici">Retirer</button></div>`) +
    `<button class="btn block" data-act="rot-salle" title="Échange largeur et longueur, pivote tout le contenu">Pivoter la salle 90°</button>` +
    (plan.salles.length > 1 ? `<button class="btn danger block" data-act="del-salle">Supprimer la salle</button>` : "");
}

/* ---------- interactions ---------- */
function onTabs(e) {
  const b = e.target.closest("[data-salle],[data-add-salle]"); if (!b) return;
  if (b.hasAttribute("data-add-salle")) return addSalle();
  plan.salleId = b.dataset.salle; plan.sel.clear();
  renderTabs(); renderCanvas(); renderInspector();
}
function onZoom(e) {
  const b = e.target.closest("[data-z]"); if (!b) return;
  if (b.dataset.z === "in") zoom = Math.min(zoom * 1.25, 3);
  else if (b.dataset.z === "out") zoom = Math.max(zoom / 1.25, 0.5);
  else zoom = 1;
  applyScale();
}
function onPalette(e) {
  const b = e.target.closest("[data-act]"); if (!b) return;
  if (b.dataset.act === "add-table") addTables(1, "h");
  else if (b.dataset.act === "add-row") addTables(Math.max(1, Math.min(40, parseInt(document.getElementById("row-n").value, 10) || 1)), document.getElementById("row-dir").value);
  else if (b.dataset.act === "add-bloc") addBloc(document.getElementById("bloc-type").value);
}

function newEl(extra) {
  const s = curSalle();
  return Object.assign({ id: crypto.randomUUID(), edition_id: plan.edition, salle_id: s.id,
    x: 0, y: 0, w: 2, h: 1, etat_terrain: "a_installer", version: 0 }, extra);
}
function addTables(n, dir) {
  const s = curSalle(); if (!s) return;
  const span = dir === "h" ? { w: n * 2, h: 1 } : { w: 2, h: n };
  const spot = span.w <= s.cols && span.h <= s.rows ? freeSpot(s, span.w, span.h) : null;
  const made = [];
  for (let i = 0; i < n; i++) {
    const pos = spot ? { x: spot.x + (dir === "h" ? i * 2 : 0), y: spot.y + (dir === "v" ? i : 0) } : freeSpot(s, 2, 1);
    const t = newEl({ kind: "table", x: pos.x, y: pos.y, w: 2, h: 1, numero: String(maxNumero() + 1),
      type_table: "non_attribuee", chaises: 4, mode: "animee" });
    plan.elements.set(t.id, t); markUpsert(t); made.push(t.id);
  }
  plan.sel = new Set(made); afterEdit(); renderTabs(); renderCanvas(); renderInspector();
}
function addBloc(sous) {
  const s = curSalle(); if (!s) return;
  const cfg = BLOCS[sous] || BLOCS.autre, w = Math.min(cfg.w, s.cols), h = Math.min(cfg.h, s.rows);
  const pos = freeSpot(s, w, h);
  const b = newEl({ kind: "bloc", x: pos.x, y: pos.y, w, h, sous, label: cfg.label, assigne: null });
  plan.elements.set(b.id, b); markUpsert(b); plan.sel = new Set([b.id]);
  afterEdit(); renderCanvas(); renderInspector();
}
async function addSalle() {
  const s = { edition_id: plan.edition, nom: "Salle " + (plan.salles.length + 1), cols: 24, rows: 16 };
  const { data, error } = await supa.from("salles").insert(s).select().single();
  if (error) { renderStatus("err"); return; }
  plan.salles.push(data); plan.salleId = data.id; plan.sel.clear();
  renderTabs(); renderCanvas(); renderInspector();
}

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function selItems() { return [...plan.sel].map((id) => plan.elements.get(id)).filter(Boolean); }

function wireInspector() {
  const insp = document.getElementById("inspector");
  insp.querySelectorAll("[data-f]").forEach((inp) => {
    inp.addEventListener("change", () => {
      const o = selItems()[0]; if (!o) return;
      const f = inp.dataset.f, s = curSalle();
      if (f === "w") o.w = clamp(parseInt(inp.value, 10) || 1, 1, s.cols - o.x);
      else if (f === "h") o.h = clamp(parseInt(inp.value, 10) || 1, 1, s.rows - o.y);
      else if (f === "chaises") o.chaises = Math.max(0, parseInt(inp.value, 10) || 0);
      else if (f === "categorie_id") o.categorie_id = inp.value || null;
      else o[f] = inp.value;
      markUpsert(o); afterEdit(); renderCanvas();
      if (f === "type_table" || f === "sous" || f === "mode") renderInspector();
    });
  });
  insp.querySelectorAll("[data-sf]").forEach((inp) => {
    inp.addEventListener("change", () => saveSalle(inp.dataset.sf, inp.value));
  });
}
function onInspectorClick(e) {
  const b = e.target.closest("[data-act]"); if (!b) return;
  if (b.dataset.act === "dup") dup();
  else if (b.dataset.act === "rot") rotate();
  else if (b.dataset.act === "del") del();
  else if (b.dataset.act === "del-salle") delSalle();
  else if (b.dataset.act === "place-ici") { placingIci = !placingIci; renderInspector(); }
  else if (b.dataset.act === "clear-ici") setIci(null, null);
  else if (b.dataset.act === "rot-salle") rotateSalle();
}
// Pivote toute la salle de 90° horaire : échange cols/rows et repositionne chaque élément.
async function rotateSalle() {
  const s = curSalle(); if (!s) return;
  const oldRows = s.rows;
  salleElements(s.id).forEach((o) => {
    const nx = oldRows - o.y - o.h, ny = o.x, nw = o.h, nh = o.w;
    o.x = Math.max(0, nx); o.y = ny; o.w = nw; o.h = nh; markUpsert(o);
  });
  const nc = s.rows; s.rows = s.cols; s.cols = nc;
  if (s.ici_x != null && s.ici_y != null) { const nix = oldRows - s.ici_y; s.ici_y = s.ici_x; s.ici_x = nix; }
  // Non annulable : l'historique ne couvre que les éléments, pas les dimensions de la
  // salle (annuler laissait la salle pivotée avec les éléments à l'ancienne place).
  initHistory(); updateHistButtons(); renderTabs(); renderCanvas(); renderInspector();
  const { error } = await supa.from("salles").update({ cols: s.cols, rows: s.rows, ici_x: s.ici_x, ici_y: s.ici_y }).eq("id", s.id);
  renderStatus(error ? "err" : "saved");
}
async function setIci(x, y) {
  const s = curSalle(); if (!s) return;
  s.ici_x = x; s.ici_y = y; placingIci = false;
  renderCanvas(); renderInspector();
  const { error } = await supa.from("salles").update({ ici_x: x, ici_y: y }).eq("id", s.id);
  renderStatus(error ? "err" : "saved");
}
function dup() {
  const s = curSalle(); if (!s) return;
  const made = [];
  selItems().forEach((o) => {
    const pos = freeSpot(s, o.w, o.h);
    const copy = newEl({ ...o, id: crypto.randomUUID(), version: 0, x: pos.x, y: pos.y });
    if (copy.kind === "table") copy.numero = String(maxNumero() + 1);
    plan.elements.set(copy.id, copy); markUpsert(copy); made.push(copy.id);
  });
  if (!made.length) return;
  plan.sel = new Set(made); afterEdit(); renderTabs(); renderCanvas(); renderInspector();
}
async function saveSalle(f, v) {
  const s = curSalle(); if (!s) return;
  if (f === "cols") s.cols = clamp(parseInt(v, 10) || s.cols, 4, 80);
  else if (f === "rows") s.rows = clamp(parseInt(v, 10) || s.rows, 4, 80);
  else s.nom = v;
  renderTabs(); renderCanvas();
  const { error } = await supa.from("salles").update({ nom: s.nom, cols: s.cols, rows: s.rows }).eq("id", s.id);
  renderStatus(error ? "err" : "saved");
}
async function delSalle() {
  const s = curSalle(); if (!s || plan.salles.length < 2) return;
  if (!confirm("Supprimer cette salle et tout son contenu ?")) return;
  const { error } = await supa.from("salles").delete().eq("id", s.id);
  if (error) { alert("Suppression impossible : " + error.message); return; }
  for (const [id, e] of plan.elements) if (e.salle_id === s.id) plan.elements.delete(id);
  plan.salles = plan.salles.filter((x) => x.id !== s.id);
  plan.salleId = plan.salles[0].id; plan.sel.clear();
  initHistory(); updateHistButtons(); // suppression de salle non annulable
  renderTabs(); renderCanvas(); renderInspector();
}
function rotate() {
  const s = curSalle();
  selItems().forEach((o) => {
    const nw = Math.min(o.h, s.cols), nh = Math.min(o.w, s.rows);
    o.x = clamp(o.x + Math.round((o.w - nw) / 2), 0, s.cols - nw);
    o.y = clamp(o.y + Math.round((o.h - nh) / 2), 0, s.rows - nh);
    o.w = nw; o.h = nh; markUpsert(o);
  });
  afterEdit(); renderCanvas(); renderInspector();
}
function del() {
  selItems().forEach((o) => { plan.elements.delete(o.id); markDelete(o); });
  plan.sel.clear(); afterEdit(); renderTabs(); renderCanvas(); renderInspector();
}

function toCells(e) {
  const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
  const q = pt.matrixTransform(svg.getScreenCTM().inverse());
  return { x: (q.x - M) / CELL, y: (q.y - M) / CELL };
}
let drag = null, raf = false, placingIci = false;
function sched() { if (raf) return; raf = true; requestAnimationFrame(() => { raf = false; renderCanvas(); }); }
function onDown(e) {
  if (placingIci) {
    const s = curSalle(); if (!s) { placingIci = false; return; }
    const p = toCells(e);
    setIci(clamp(Math.round(p.x * 10) / 10, 0, s.cols), clamp(Math.round(p.y * 10) / 10, 0, s.rows));
    e.preventDefault(); return;
  }
  const g = e.target.closest("[data-id]");
  if (!g) { if (plan.sel.size) { plan.sel.clear(); renderCanvas(); renderInspector(); } return; }
  const id = g.getAttribute("data-id"), o = plan.elements.get(id); if (!o) return;
  const handle = !!e.target.closest("[data-handle]");
  if (!plan.sel.has(id) || handle) { plan.sel = new Set([id]); renderCanvas(); renderInspector(); }
  const p = toCells(e);
  drag = { mode: handle ? "resize" : "move", sx: p.x, sy: p.y, moved: false,
    start: selItems().map((q) => ({ o: q, x: q.x, y: q.y, w: q.w, h: q.h })) };
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  e.preventDefault();
}
function onMove(e) {
  if (!drag) return;
  const p = toCells(e), dx = Math.round(p.x - drag.sx), dy = Math.round(p.y - drag.sy), s = curSalle();
  if (drag.mode === "move") {
    const minX = Math.min(...drag.start.map((a) => a.x)), maxX = Math.max(...drag.start.map((a) => a.x + a.w));
    const minY = Math.min(...drag.start.map((a) => a.y)), maxY = Math.max(...drag.start.map((a) => a.y + a.h));
    const ddx = clamp(dx, -minX, s.cols - maxX), ddy = clamp(dy, -minY, s.rows - maxY);
    drag.start.forEach((a) => { a.o.x = a.x + ddx; a.o.y = a.y + ddy; });
  } else {
    const a = drag.start[0];
    a.o.w = clamp(a.w + dx, 1, s.cols - a.x); a.o.h = clamp(a.h + dy, 1, s.rows - a.y);
  }
  if (dx || dy) drag.moved = true;
  sched();
}
function onUp() {
  window.removeEventListener("pointermove", onMove);
  window.removeEventListener("pointerup", onUp);
  if (drag && drag.moved) { drag.start.forEach((a) => markUpsert(a.o)); afterEdit(); renderInspector(); }
  drag = null; renderCanvas();
}
function onKey(e) {
  if (!root?.isConnected) return;  // filet de sécurité : écran plus affiché
  const tag = (document.activeElement?.tagName) || "";
  if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
  if ((e.ctrlKey || e.metaKey) && (e.key === "z" || e.key === "Z")) {
    e.shiftKey ? doRedo() : doUndo(); e.preventDefault(); return;
  }
  if ((e.ctrlKey || e.metaKey) && (e.key === "y" || e.key === "Y")) { doRedo(); e.preventDefault(); return; }
  if (!plan.sel.size) return;
  if (e.key === "r" || e.key === "R") { rotate(); e.preventDefault(); return; }
  if (e.key === "Delete" || e.key === "Backspace") { del(); e.preventDefault(); return; }
  const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
  if (!d) return;
  const s = curSalle(), sel = selItems();
  if (sel.every((o) => o.x + d[0] >= 0 && o.x + o.w + d[0] <= s.cols && o.y + d[1] >= 0 && o.y + o.h + d[1] <= s.rows)) {
    sel.forEach((o) => { o.x += d[0]; o.y += d[1]; markUpsert(o); });
    afterEdit(); renderCanvas();
  }
  e.preventDefault();
}
