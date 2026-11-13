// Écran #/organismes — Phase 1. Accueil (recherche + 3 types) puis liste par type + fiche.
// Fiche : sections conditionnelles au rôle (couleur/partenaire, sponsor, régime) ;
// éditeur = bloc « Jeux de l'éditeur » (lecture seule) ; logo dans la carte Organisme.
import { supa } from "../supabase.js";
import { isAdmin, hasPole } from "../auth.js";
import { store } from "../store.js";
import { esc, plur, aujourdhui } from "../ui/util.js";

const ROLES = [["partenaire", "Partenaire"], ["editeur", "Éditeur"], ["sponsor", "Sponsor"]];
const STATUTS = [["invite", "À contacter"], ["relance", "À relancer"], ["confirme", "Confirmé"], ["refuse", "Refusé"]];
// « À relancer » est un état calculé (sur le dernier contact), pas un statut à choisir.
const STATUTS_SAISIE = STATUTS.filter((s) => s[0] !== "relance");
const PALETTE = ["#a9c6e8", "#f7b2b2", "#bfe3b4", "#f7d8a0", "#c9b7e8", "#a0d8d8", "#f0b8d8", "#d8cba0"];
const SUB_ROLE = { editeurs: "editeur", partenaires: "partenaire", sponsors: "sponsor" };
const ROLE_SUB = { editeur: "editeurs", partenaire: "partenaires", sponsor: "sponsors" };
const ROLE_PLURAL = { editeur: "Éditeurs", partenaire: "Partenaires", sponsor: "Sponsors" };
const JE_STATUT_LBL = { souhaite: "Souhaité", demande: "Demandé", recu: "Reçu", deja_asso: "Déjà à l'asso" };
const JE_STATUT_PILL = { souhaite: "grey", demande: "amber", recu: "ok", deja_asso: "blue" };
const JE_USAGE_LBL = { animation: "Animation", tournoi: "Tournoi", tombola: "Tombola" };

const today = aujourdhui;

let root, list = [], regimes = {}, jeuxEd = {}, catalogue = [], placedTables = {}, loadErr = "";
let scope = null, newPreset = null;
let filt = { q: "", statut: "", relance: false };
let view = { mode: "hub", id: null };

const roleLabel = (k) => (ROLES.find((r) => r[0] === k) || [k, k])[1];
const statutLabel = (k) => (STATUTS.find((s) => s[0] === k) || [k, k])[1];
const canWrite = () => isAdmin() || hasPole("partenaires") || hasPole("jeux_editeurs") || hasPole("sponsors");

export async function render(container, sub) {
  root = container;
  scope = SUB_ROLE[sub] || null;
  view = { mode: scope ? "list" : "hub", id: null };
  if (!store.editionId) {
    root.innerHTML = `<div class="page-head"><div><h1>Organismes</h1>
      <div class="sub">Aucune édition sélectionnée</div></div></div>
      <div class="card"><p>Choisis d'abord une édition. <a class="btn primary" href="#/editions">Éditions</a></p></div>`;
    return;
  }
  await load();
  wireOnce();
  go();
}

async function load() {
  loadErr = "";
  const { data, error } = await supa.from("organisme_editions")
    .select("*, organismes(*)").eq("edition_id", store.editionId);
  if (error) { loadErr = error.message; list = []; return; }
  list = (data ?? []).filter((x) => x.organismes);
  const ids = list.map((x) => x.id);
  regimes = {};
  if (ids.length) {
    const r = await supa.from("regimes").select("organisme_edition_id,texte").in("organisme_edition_id", ids);
    (r.data ?? []).forEach((x) => { regimes[x.organisme_edition_id] = x.texte; });
  }
  // Jeux par éditeur (compteur liste + bloc fiche) + catalogue (ajout).
  jeuxEd = {};
  const jed = await supa.from("jeux_editions")
    .select("id, statut, usages, exemplaires, jeux!inner(id, titre, editeur_id)")
    .eq("edition_id", store.editionId);
  (jed.data ?? []).forEach((r) => {
    const ed = r.jeux?.editeur_id; if (!ed) return;
    (jeuxEd[ed] = jeuxEd[ed] || []).push(r);
  });
  const cat = await supa.from("jeux").select("id, titre, editeur_id");
  catalogue = cat.data ?? [];
  // Tables déjà placées sur le plan par organisme-édition.
  placedTables = {};
  const pt = await supa.from("elements").select("organisme_edition_id")
    .eq("edition_id", store.editionId).eq("kind", "table").not("organisme_edition_id", "is", null);
  (pt.data ?? []).forEach((e) => { placedTables[e.organisme_edition_id] = (placedTables[e.organisme_edition_id] || 0) + 1; });
}

function go() {
  if (view.mode === "fiche") root.innerHTML = ficheView();
  else if (view.mode === "new") root.innerHTML = newView();
  else if (view.mode === "hub") root.innerHTML = hubView();
  else root.innerHTML = listView();
}

const countRole = (role) => list.filter((o) => (o.roles || []).includes(role)).length;
function jeuxCount(orgId) {
  const arr = jeuxEd[orgId] || [];
  const recus = arr.filter((r) => r.statut === "recu").length;
  return `${plur(arr.length, "jeu", "jeux")} · ${recus} reçu${recus > 1 ? "s" : ""}`;
}

/* ---------- pastilles couleur ---------- */
function swatchPicker(selected, ro, attr) {
  const sel = (selected || PALETTE[0]).toLowerCase();
  return `<div class="swatches">${PALETTE.map((c) =>
    `<button type="button" class="swatch-btn${c.toLowerCase() === sel ? " on" : ""}" style="background:${c}" data-color="${c}"${ro ? " disabled" : ""} aria-label="couleur ${c}"></button>`).join("")}
    <input type="hidden" ${attr} value="${esc(selected || PALETTE[0])}"></div>`;
}

/* ---------- lignes (tableau v2) ---------- */
const STATUT_TAG = { invite: "warn", relance: "warn", confirme: "ok", refuse: "neu" };
function orgTr(oe) {
  const o = oe.organismes, isE = (oe.roles || []).includes("editeur"), isP = (oe.roles || []).includes("partenaire");
  const extra = isE ? jeuxCount(oe.organisme_id)
    : isP ? `${placedTables[oe.id] || 0} / ${oe.tables_souhaitees || 0} tables`
    : "—";
  return `<tr class="clk" data-open="${oe.id}">
    <td><span class="dot" style="background:${esc(oe.couleur || "#E4E4E7")}"></span><strong>${esc(o.nom)}</strong>${o.archive ? ' <span class="tag neu">archivé</span>' : ""}</td>
    <td class="muted">${esc((oe.roles || []).map(roleLabel).join(", ") || "—")}</td>
    <td class="muted">${esc(o.contact_nom || "—")}</td>
    <td><span class="tag ${STATUT_TAG[oe.statut] || "neu"}">${esc(statutLabel(oe.statut))}</span></td>
    <td class="muted">${oe.dernier_contact ? esc(oe.dernier_contact) : "jamais"}</td>
    <td class="muted">${esc(extra)}</td>
  </tr>`;
}

/* ---------- accueil ---------- */
function hubView() {
  const q = filt.q.trim().toLowerCase();
  const matches = q
    ? list.filter((oe) => `${oe.organismes.nom} ${oe.organismes.contact_nom || ""}`.toLowerCase().includes(q))
        .sort((a, b) => a.organismes.nom.localeCompare(b.organismes.nom, "fr"))
    : [];
  const results = q
    ? (matches.length
        ? `<div class="scroll"><table class="data-table"><tbody>${matches.map(orgTr).join("")}</tbody></table></div>`
        : `<p class="muted">Aucun résultat.</p>`)
    : "";
  const total = new Set(list.map((x) => x.organisme_id)).size;
  const tiles = ["editeur", "partenaire", "sponsor"].map((r) =>
    `<a class="hub-tile" href="#/organismes/${ROLE_SUB[r]}">
       <span class="hub-count">${countRole(r)}</span>
       <span class="hub-lbl">${esc(ROLE_PLURAL[r])}</span></a>`).join("");
  return `<div class="page-head"><div><h1>Organismes</h1>
    <div class="sub">${total} au total · choisis un type ou cherche</div></div>
    <div class="head-actions">${canWrite() ? `<button class="btn primary" id="new-org">+ Nouvel organisme</button>` : ""}</div></div>
    <div class="card">
      <div class="filters"><input id="f-q" class="grow" placeholder="Rechercher un organisme…" value="${esc(filt.q)}"></div>
      ${results}
    </div>
    <div class="hub-grid">${tiles}</div>`;
}

/* ---------- liste par type ---------- */
function filtered() {
  const q = filt.q.trim().toLowerCase();
  return list.filter((oe) => {
    const o = oe.organismes;
    if (scope && !(oe.roles || []).includes(scope)) return false;
    if (q && !(`${o.nom} ${o.contact_nom || ""}`.toLowerCase().includes(q))) return false;
    if (filt.statut && oe.statut !== filt.statut) return false;
    if (filt.relance && !["invite", "relance"].includes(oe.statut)) return false;
    return true;
  }).sort((a, b) => a.organismes.nom.localeCompare(b.organismes.nom, "fr"));
}
function listView() {
  const rows = filtered().map(orgTr).join("")
    || `<tr><td colspan="6" class="muted">${loadErr ? "Erreur : " + esc(loadErr) : "Aucun organisme pour ces filtres."}</td></tr>`;
  const statutOpts = `<option value="">Tous statuts</option>` + STATUTS.map((s) => `<option value="${s[0]}"${filt.statut === s[0] ? " selected" : ""}>${s[1]}</option>`).join("");
  const scoped = list.filter((x) => (x.roles || []).includes(scope));
  const conf = scoped.filter((x) => x.statut === "confirme").length, rel = scoped.filter((x) => ["invite", "relance"].includes(x.statut)).length;
  return `<div class="page-head"><div><h1>${esc(ROLE_PLURAL[scope])}</h1>
    <div class="sub">${plur(scoped.length, "organisme", "organismes")} · ${plur(conf, "confirmé", "confirmés")} · ${rel} à relancer</div></div>
    <div class="head-actions"><a class="btn" href="#/organismes">← Organismes</a>
      ${canWrite() ? `<button class="btn primary" id="new-org">+ Nouvel organisme</button>` : ""}</div></div>
    <div class="card">
      <div class="filters">
        <input id="f-q" class="grow" placeholder="Rechercher…" value="${esc(filt.q)}">
        <select id="f-statut">${statutOpts}</select>
        <button class="btn small${filt.relance ? " primary" : ""}" id="f-relance">À relancer</button>
      </div>
      <div class="scroll"><table class="data-table">
        <thead><tr><th>Organisme</th><th>Rôle</th><th>Contact</th><th>Statut</th><th>Dernier contact</th><th>Tables / jeux</th></tr></thead>
        <tbody>${rows}</tbody></table></div>
    </div>`;
}

/* ---------- nouvel organisme ---------- */
function newView() {
  const def = newPreset || "partenaire";
  const roleChk = ROLES.map((r) => `<label><input type="checkbox" data-role="${r[0]}"${r[0] === def ? " checked" : ""}> ${r[1]}</label>`).join("");
  return `<div class="page-head"><div><h1>Nouvel organisme</h1>
    <div class="sub">Créé pour l'édition courante</div></div>
    <div class="head-actions"><button class="btn" id="cancel">← Retour</button></div></div>
    <div class="card" style="max-width:620px">
      <label>Nom<input id="o-nom" placeholder="Nom de l'organisme"></label>
      <label>Rôles<div class="poles-pick">${roleChk}</div></label>
      <div class="row2">
        <label>Statut<select id="o-statut">${STATUTS_SAISIE.map((s) => `<option value="${s[0]}">${s[1]}</option>`).join("")}</select></label>
        <label>Couleur${swatchPicker(PALETTE[list.length % PALETTE.length], "", 'id="o-couleur"')}</label>
      </div>
      <label>Site<input id="o-site" placeholder="https://…"></label>
      <div class="row2">
        <label>Contact<input id="o-contact" placeholder="Prénom Nom"></label>
        <label>E-mail<input id="o-email" type="email"></label>
      </div>
      <button class="btn primary" id="o-create">Créer</button>
      <p class="msg" id="o-msg"></p>
    </div>`;
}

/* ---------- fiche ---------- */
function field(l, inner) { return `<label>${l}${inner}</label>`; }
function planBanner(oe) {
  const placed = placedTables[oe.id] || 0, want = oe.tables_souhaitees || 0;
  return `<div class="plan-banner"><span>${plur(placed, "table placée", "tables placées")} sur ${want}</span>
    <a class="link" href="#/plan">Voir sur le plan</a></div>`;
}
function ficheView() {
  const oe = list.find((x) => x.id === view.id);
  if (!oe) { view.mode = backMode(); return view.mode === "hub" ? hubView() : listView(); }
  const o = oe.organismes, w = canWrite(), ro = w ? "" : " disabled";
  const roleChk = ROLES.map((r) => `<label><input type="checkbox" data-role="${r[0]}"${(oe.roles || []).includes(r[0]) ? " checked" : ""}${ro}> ${r[1]}</label>`).join("");
  const isP = (oe.roles || []).includes("partenaire"), isS = (oe.roles || []).includes("sponsor"), isE = (oe.roles || []).includes("editeur");
  const showBadge = !oe.logo_url && (isP || isS);
  return `<div class="page-head"><div><h1>${esc(o.nom)}</h1>
    <div class="sub">${(oe.roles || []).map(roleLabel).join(" · ") || "sans rôle"}</div></div>
    <div class="head-actions"><button class="btn" id="back">← Retour</button>
      ${w ? `<button class="btn primary" id="save">Enregistrer</button>` : ""}</div></div>
    <div class="two">
      <div class="l card"><h2>Organisme</h2>
        ${field("Nom", `<input data-o="nom" value="${esc(o.nom)}"${ro}>`)}
        ${field("Site", `<input data-o="site" value="${esc(o.site || "")}"${ro}>`)}
        <div class="row2">${field("Contact", `<input data-o="contact_nom" value="${esc(o.contact_nom || "")}"${ro}>`)}${field("Téléphone", `<input data-o="contact_tel" value="${esc(o.contact_tel || "")}"${ro}>`)}</div>
        ${field("E-mail", `<input type="email" data-o="contact_email" value="${esc(o.contact_email || "")}"${ro}>`)}
        ${field("Logo (URL)", `<div class="with-badge"><input data-e="logo_url" value="${esc(oe.logo_url || "")}" placeholder="Aucun logo"${ro}>
          <span class="pill alert logo-badge"${showBadge ? "" : ' style="display:none"'}>À récupérer</span></div>`)}
        ${field("Notes (organisme)", `<textarea data-o="notes"${ro}>${esc(o.notes || "")}</textarea>`)}
        ${field("", `<span class="chk-inline"><input type="checkbox" data-o="archive"${o.archive ? " checked" : ""}${ro}> Archivé</span>`)}
      </div>
      <div class="r"><div class="card"><h2>Cette édition</h2>
        ${field("Rôles", `<div class="poles-pick">${roleChk}</div>`)}
        <div class="row2">
          ${field("Statut", `<select data-e="statut"${ro}>${STATUTS_SAISIE.map((s) => `<option value="${s[0]}"${s[0] === oe.statut ? " selected" : ""}>${s[1]}</option>`).join("")}</select>`)}
          ${field("Dernier contact", `<input type="date" data-e="dernier_contact" value="${esc(oe.dernier_contact || "")}" title="Rempli automatiquement à la relance / confirmation"${ro}>`)}
        </div>
        <div data-sec="couleur"${isP ? "" : ' style="display:none"'}>
          ${field("Couleur sur le plan", swatchPicker(oe.couleur || PALETTE[0], ro, 'data-e="couleur"'))}
        </div>
        <div data-sec="partenaire"${isP ? "" : ' style="display:none"'}>
          <h3>Partenaire</h3>
          <p class="lbl">Matériel souhaité</p>
          <div class="row3">
            ${field("Tables", `<input type="number" min="0" data-e="tables_souhaitees" value="${oe.tables_souhaitees || 0}"${ro}>`)}
            ${field("Chaises", `<input type="number" min="0" data-e="chaises_souhaitees" value="${oe.chaises_souhaitees || 0}"${ro}>`)}
            ${field("Grilles", `<input type="number" min="0" data-e="grilles_souhaitees" value="${oe.grilles_souhaitees || 0}"${ro}>`)}
          </div>
          ${field("", `<span class="chk-inline"><input type="checkbox" data-e="electricite"${oe.electricite ? " checked" : ""}${ro}> Électricité</span>`)}
          ${planBanner(oe)}
          <h3>Personnes présentes</h3>
          ${field("Noms (pour les étiquettes)", `<textarea data-e="noms_personnes" placeholder="Un nom par ligne"${ro}>${esc(oe.noms_personnes || "")}</textarea>`)}
          <div class="row2">${field("Repas samedi", `<input type="number" min="0" data-e="personnes_sam" value="${oe.personnes_sam || 0}"${ro}>`)}${field("Repas dimanche", `<input type="number" min="0" data-e="personnes_dim" value="${oe.personnes_dim || 0}"${ro}>`)}</div>
          ${field("", `<div class="chk-row"><span class="chk-inline"><input type="checkbox" data-e="convention_recue"${oe.convention_recue ? " checked" : ""}${ro}> Convention reçue</span><span class="chk-inline"><input type="checkbox" data-e="assurance_recue"${oe.assurance_recue ? " checked" : ""}${ro}> Assurance reçue</span></div>`)}
        </div>
        <div data-sec="sponsor"${isS ? "" : ' style="display:none"'}>
          <h3>Sponsor</h3>
          ${field("Nature de l'aide", `<input data-e="nature_aide" value="${esc(oe.nature_aide || "")}"${ro}>`)}
        </div>
        <div data-sec="regime"${isP ? "" : ' style="display:none"'}>
          ${field("Régime / allergies (repas)", `<input data-regime value="${esc(regimes[oe.id] || "")}" placeholder="ex. 1 sans gluten, 2 végétariens…"${ro}>`)}
        </div>
        ${field("Notes (cette édition)", `<textarea data-e="notes"${ro}>${esc(oe.notes || "")}</textarea>`)}
      </div></div>
    </div>
    <div data-sec="editeur-jeux"${isE ? "" : ' style="display:none"'}>${editeurJeuxBlock(oe)}</div>
    <p class="mini" style="margin-top:14px">La couleur sur le plan n'apparaît que si le rôle Partenaire est coché.</p>
    <p class="msg" id="o-msg"></p>`;
}

/* ---------- bloc jeux de l'éditeur (lecture seule) ---------- */
function editeurJeuxBlock(oe) {
  const jed = (jeuxEd[oe.organisme_id] || []).slice().sort((a, b) => a.jeux.titre.localeCompare(b.jeux.titre, "fr"));
  const rows = jed.map((r) => `<tr>
    <td><b>${esc(r.jeux.titre)}</b></td>
    <td><span class="pill ${JE_STATUT_PILL[r.statut] || "grey"}">${esc(JE_STATUT_LBL[r.statut] || r.statut)}</span></td>
    <td>${esc((r.usages || []).map((u) => JE_USAGE_LBL[u] || u).join(", ") || "—")}</td>
    <td>${r.exemplaires || 1}</td>
  </tr>`).join("") || `<tr><td colspan="4" class="muted">Aucun jeu pour cette édition.</td></tr>`;
  const inEd = new Set(jed.map((r) => r.jeux.id));
  const dispo = catalogue.filter((j) => j.editeur_id === oe.organisme_id && !inEd.has(j.id));
  const canAdd = canWrite() && dispo.length;
  return `<div class="card" style="margin-top:14px">
    <div class="dash-head"><h2>Jeux de l'éditeur · cette édition</h2>
      <div class="actions"><a class="btn" href="#/jeux/${oe.organisme_id}">Voir dans Jeux</a>
        ${canAdd ? `<button class="btn primary" id="add-jeu-toggle">+ Ajouter un jeu</button>` : ""}</div></div>
    <div style="overflow-x:auto"><table class="pub-table je-table">
      <tr><th>Jeu</th><th>Statut</th><th>Usage</th><th>Exemplaires</th></tr>${rows}</table></div>
    ${canAdd ? `<div class="add-jeu-row" style="display:none">
      <select id="add-jeu"><option value="">— jeu du catalogue —</option>${dispo.map((j) => `<option value="${j.id}">${esc(j.titre)}</option>`).join("")}</select>
      <button class="btn small primary" id="add-jeu-go">Ajouter</button></div>` : ""}
    <p class="mini">Statuts : souhaité, demandé, reçu. Usages : animation et/ou tombola. Modifiable dans « Jeux ».</p>
    <p class="msg" id="je-msg"></p></div>`;
}

/* ---------- câblage ---------- */
function wireOnce() {
  if (root.__orgWired) return;
  root.__orgWired = true;
  root.addEventListener("click", onClick);
  root.addEventListener("input", onInput);
  root.addEventListener("change", onChange);
}
function backMode() { return scope ? "list" : "hub"; }
function onClick(e) {
  const t = e.target;
  if (t.matches("[data-color]")) {
    const box = t.closest(".swatches");
    box.querySelector("input").value = t.dataset.color;
    box.querySelectorAll(".swatch-btn").forEach((b) => b.classList.toggle("on", b === t));
    return;
  }
  if (t.closest("#new-org")) { newPreset = scope; view = { mode: "new", id: null }; return go(); }
  if (t.closest("#cancel") || t.closest("#back")) { view = { mode: backMode(), id: null }; return go(); }
  if (t.closest("#o-create")) return createOrg();
  if (t.closest("#save")) return saveFiche();
  if (t.closest("#add-jeu-toggle")) { const row = root.querySelector(".add-jeu-row"); if (row) row.style.display = "flex"; return; }
  if (t.closest("#add-jeu-go")) return addJeu();
  if (t.closest("#f-relance")) { filt.relance = !filt.relance; return go(); }
  const openRow = t.closest("[data-open]");
  if (openRow) { view = { mode: "fiche", id: openRow.dataset.open }; return go(); }
}
function onInput(e) {
  if (e.target.id === "f-q") {
    filt.q = e.target.value;
    const pos = e.target.selectionStart;
    go();
    const inp = root.querySelector("#f-q");
    if (inp) { inp.focus(); try { inp.setSelectionRange(pos, pos); } catch (_) { /* ignore */ } }
  }
}
async function onChange(e) {
  const t = e.target;
  if (t.id === "f-statut") { filt.statut = t.value; return go(); }
  if (t.matches('[data-e="statut"]') && view.mode === "fiche") {
    if (t.value === "relance" || t.value === "confirme") {
      const d = root.querySelector('[data-e="dernier_contact"]');
      if (d) d.value = today();
    }
  }
  if (t.matches("[data-role]") && view.mode === "fiche") toggleSection();
}
function toggleSection() {
  const has = (k) => !!root.querySelector(`[data-role="${k}"]`)?.checked;
  const P = has("partenaire"), E = has("editeur"), S = has("sponsor");
  const set = (sec, on) => { const el = root.querySelector(`[data-sec="${sec}"]`); if (el) el.style.display = on ? "" : "none"; };
  set("couleur", P); set("partenaire", P); set("sponsor", S); set("regime", P); set("editeur-jeux", E);
  const logo = root.querySelector('[data-e="logo_url"]'), badge = root.querySelector(".logo-badge");
  if (badge) badge.style.display = (!(logo && logo.value) && (P || S)) ? "" : "none";
}

async function addJeu() {
  const oe = list.find((x) => x.id === view.id); if (!oe) return;
  const sel = root.querySelector("#add-jeu"); const jeuId = sel && sel.value;
  const msg = root.querySelector("#je-msg");
  if (!jeuId) { if (msg) msg.textContent = "Choisis un jeu du catalogue."; return; }
  const { data, error } = await supa.from("jeux_editions")
    .insert({ jeu_id: jeuId, edition_id: store.editionId, statut: "souhaite", usages: ["animation"] })
    .select("id, statut, usages, exemplaires, jeux!inner(id, titre, editeur_id)").single();
  if (error) { if (msg) msg.textContent = "Erreur : " + error.message; return; }
  (jeuxEd[oe.organisme_id] = jeuxEd[oe.organisme_id] || []).push(data);
  go();
}

async function createOrg() {
  const msg = root.querySelector("#o-msg");
  const nom = (root.querySelector("#o-nom").value || "").trim();
  if (!nom) { msg.textContent = "Nom requis."; return; }
  const roles = [...root.querySelectorAll("[data-role]:checked")].map((c) => c.dataset.role);
  msg.textContent = "Création…";
  const { data: org, error: e1 } = await supa.from("organismes")
    .insert({ nom, site: root.querySelector("#o-site").value || null,
      contact_nom: root.querySelector("#o-contact").value || null,
      contact_email: root.querySelector("#o-email").value || null }).select().single();
  if (e1) { msg.textContent = "Erreur : " + e1.message; return; }
  const { data: oe, error: e2 } = await supa.from("organisme_editions")
    .insert({ organisme_id: org.id, edition_id: store.editionId, roles,
      statut: root.querySelector("#o-statut").value,
      couleur: root.querySelector("#o-couleur").value }).select("*, organismes(*)").single();
  if (e2) { msg.textContent = "Organisme créé mais erreur sur l'édition : " + e2.message; return; }
  list.push(oe);
  view = { mode: "fiche", id: oe.id };
  go();
}

async function saveFiche() {
  const oe = list.find((x) => x.id === view.id); if (!oe) return;
  const msg = root.querySelector("#o-msg"); msg.textContent = "Enregistrement…";
  const getO = (f) => root.querySelector(`[data-o="${f}"]`);
  const getE = (f) => root.querySelector(`[data-e="${f}"]`);
  const nom = (getO("nom").value || "").trim();
  if (!nom) { msg.textContent = "Nom requis."; return; }
  const oPatch = { nom, site: getO("site").value || null,
    contact_nom: getO("contact_nom").value || null, contact_tel: getO("contact_tel").value || null,
    contact_email: getO("contact_email").value || null, notes: getO("notes").value || null,
    archive: getO("archive").checked };
  const roles = [...root.querySelectorAll('[data-role]')].filter((c) => c.checked).map((c) => c.dataset.role);
  const ePatch = { roles, statut: getE("statut").value,
    dernier_contact: getE("dernier_contact").value || null, couleur: getE("couleur").value,
    personnes_sam: +getE("personnes_sam").value || 0, personnes_dim: +getE("personnes_dim").value || 0,
    noms_personnes: getE("noms_personnes").value || null,
    tables_souhaitees: +getE("tables_souhaitees").value || 0,
    chaises_souhaitees: +getE("chaises_souhaitees").value || 0,
    grilles_souhaitees: +getE("grilles_souhaitees").value || 0,
    electricite: getE("electricite").checked,
    convention_recue: getE("convention_recue").checked, assurance_recue: getE("assurance_recue").checked,
    nature_aide: getE("nature_aide").value || null, logo_url: getE("logo_url").value || null,
    notes: getE("notes").value || null };
  const regime = root.querySelector("[data-regime]")?.value || "";
  const [r1, r2, r3] = await Promise.all([
    supa.from("organismes").update(oPatch).eq("id", oe.organisme_id),
    supa.from("organisme_editions").update(ePatch).eq("id", oe.id),
    supa.rpc("definir_regime_organisme", { p_organisme_edition: oe.id, p_texte: regime }),
  ]);
  if (r1.error || r2.error || r3.error) { msg.textContent = "Erreur : " + (r1.error?.message || r2.error?.message || r3.error?.message); return; }
  Object.assign(oe.organismes, oPatch); Object.assign(oe, ePatch);
  regimes[oe.id] = regime.trim();
  view = { mode: backMode(), id: null };
  go();
}
