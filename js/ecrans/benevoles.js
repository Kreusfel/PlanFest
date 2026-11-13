// Écran #/benevoles — Phase 1. Liste, fiche (coordonnées, équipes, repas, disponibilités), invitation.
import { supa } from "../supabase.js";
import { isAdmin, hasPole, sendInvitation } from "../auth.js";
import { store } from "../store.js";
import { esc, plur } from "../ui/util.js";

const STATUTS = [["inscrit", "Inscrit"], ["confirme", "Confirmé"], ["annule", "Annulé"]];
const JOURS = [["ven", "Vendredi"], ["sam", "Samedi"], ["dim", "Dimanche"]];
// Grille de disponibilités : vendredi = mise en place, dimanche soir = rangement.
const DISPO_ROWS = [
  { jour: "ven", label: "Vendredi", demis: ["matin", "aprem"] },
  { jour: "sam", label: "Samedi", demis: ["matin", "aprem"] },
  { jour: "dim", label: "Dimanche", demis: ["matin", "aprem", "soir"] },
];
const DISPO_COLS = [["matin", "Matin"], ["aprem", "Après-midi"], ["soir", "Soir"]];

let root, list = [], poles = [], jours = ["sam", "dim"], dispos = {}, regimeBe = "", loadErr = "";
let filt = { q: "", statut: "", equipe: "", anim: false };
let view = { mode: "list", id: null };

// Équipes « terrain » (jour J) en plus des pôles — permet p.ex. l'équipe accueil.
const EXTRA_EQUIPES = [["accueil", "Accueil"], ["animation", "Animation"], ["montage", "Montage"], ["buvette", "Buvette (service)"]];
const equipesListe = () => [...poles.map((p) => [p.code, p.nom]), ...EXTRA_EQUIPES];

const stLabel = (k) => (STATUTS.find((s) => s[0] === k) || [k, k])[1];
const poleNom = (code) => poles.find((p) => p.code === code)?.nom || EXTRA_EQUIPES.find((x) => x[0] === code)?.[1] || code;
const canWrite = () => isAdmin() || hasPole("animateurs_benevoles");

export async function render(container) {
  root = container;
  view = { mode: "list", id: null };
  if (!store.editionId) {
    root.innerHTML = `<div class="page-head"><div><h1>Bénévoles</h1><div class="sub">Aucune édition sélectionnée</div></div></div>
      <div class="card"><p><a class="btn primary" href="#/editions">Choisir une édition</a></p></div>`;
    return;
  }
  await load();
  wireOnce();
  go();
}

async function load() {
  loadErr = "";
  const [be, ed, pol] = await Promise.all([
    supa.from("benevoles_editions").select("*, benevoles(*)").eq("edition_id", store.editionId),
    supa.from("editions").select("jours_actifs").eq("id", store.editionId).single(),
    supa.from("poles").select("code,nom,ordre").order("ordre"),
  ]);
  if (be.error) { loadErr = be.error.message; list = []; } else list = (be.data ?? []).filter((x) => x.benevoles);
  jours = ed.data?.jours_actifs?.length ? ed.data.jours_actifs : ["sam", "dim"];
  poles = pol.data ?? [];
}

function go() {
  root.innerHTML = view.mode === "fiche" ? ficheView() : view.mode === "new" ? newView() : listView();
}

/* ---------- liste ---------- */
function filtered() {
  const q = filt.q.trim().toLowerCase();
  return list.filter((be) => {
    const b = be.benevoles;
    if (q && !(`${b.nom} ${b.email || ""}`.toLowerCase().includes(q))) return false;
    if (filt.statut && be.statut !== filt.statut) return false;
    if (filt.equipe && !(be.equipes || []).includes(filt.equipe)) return false;
    if (filt.anim && !be.est_animateur) return false;
    return true;
  }).sort((a, b) => a.benevoles.nom.localeCompare(b.benevoles.nom, "fr"));
}
function listView() {
  const TAG = { inscrit: "neu", confirme: "ok", annule: "bad" };
  const rows = filtered().map((be) => {
    const b = be.benevoles;
    const eq = (be.equipes || []).map((e) => `<span class="chip">${esc(poleNom(e))}</span>`).join(" ") || `<span class="muted">—</span>`;
    const repas = [be.repas_sam ? "sam" : "", be.repas_dim ? "dim" : ""].filter(Boolean).join(" + ") || "—";
    return `<tr class="clk" data-open="${be.id}">
      <td><strong>${esc(b.nom)}</strong>${be.est_animateur ? ' <span class="tag ok">animateur</span>' : ""}${b.profil_id ? "" : ' <span class="tag neu">sans compte</span>'}</td>
      <td class="muted">${esc(b.email || "—")}</td>
      <td>${eq}</td>
      <td><span class="tag ${TAG[be.statut] || "neu"}">${esc(stLabel(be.statut))}</span></td>
      <td class="muted">${repas}</td>
    </tr>`;
  }).join("") || `<tr><td colspan="5" class="muted">${loadErr ? "Erreur : " + esc(loadErr) : "Aucun bénévole pour ces filtres."}</td></tr>`;

  const sOpts = `<option value="">Tous statuts</option>` + STATUTS.map((s) => `<option value="${s[0]}"${filt.statut === s[0] ? " selected" : ""}>${s[1]}</option>`).join("");
  const eOpts = `<option value="">Toutes équipes</option>` + equipesListe().map(([code, nom]) => `<option value="${code}"${filt.equipe === code ? " selected" : ""}>${esc(nom)}</option>`).join("");
  const nc = list.filter((x) => x.statut === "confirme").length, na = list.filter((x) => x.est_animateur).length;

  return `<div class="page-head"><div><h1>Bénévoles</h1>
    <div class="sub">${plur(list.length, "inscrit", "inscrits")} · ${plur(nc, "confirmé", "confirmés")} · ${plur(na, "animateur", "animateurs")}</div></div>
    <div class="head-actions">${canWrite() ? `<button class="btn primary" id="new-ben">+ Nouveau bénévole</button>` : ""}</div></div>
    <div class="card">
      <div class="filters">
        <input id="f-q" class="grow" placeholder="Rechercher…" value="${esc(filt.q)}">
        <select id="f-statut">${sOpts}</select>
        <select id="f-equipe">${eOpts}</select>
        <button class="btn small${filt.anim ? " primary" : ""}" id="f-anim">Animateurs</button>
      </div>
      <div class="scroll"><table class="data-table">
        <thead><tr><th>Nom</th><th>E-mail</th><th>Équipes</th><th>Statut</th><th>Repas</th></tr></thead>
        <tbody>${rows}</tbody></table></div>
    </div>`;
}

/* ---------- champs ---------- */
function field(l, inner) { return `<label>${l}${inner}</label>`; }
function equipesChk(sel, ro) {
  return `<div class="poles-pick">${equipesListe().map(([code, nom]) => `<label><input type="checkbox" data-eq="${code}"${(sel || []).includes(code) ? " checked" : ""}${ro}> ${esc(nom)}</label>`).join("")}</div>`;
}
function disposGrid(ro) {
  const head = `<tr><th></th>${DISPO_COLS.map((c) => `<th>${esc(c[1])}</th>`).join("")}</tr>`;
  const body = DISPO_ROWS.map((r) => {
    const cells = DISPO_COLS.map((c) => {
      if (!r.demis.includes(c[0])) return `<td></td>`;
      const on = dispos[`${r.jour}|${c[0]}`];
      return `<td><input type="checkbox" data-dispo="${r.jour}|${c[0]}"${on ? " checked" : ""}${ro}></td>`;
    }).join("");
    return `<tr><th>${esc(r.label)}</th>${cells}</tr>`;
  }).join("");
  return `<table class="dispo-grid">${head}${body}</table>
    <p class="mini">Vendredi = mise en place · dimanche soir = rangement.</p>`;
}

/* ---------- nouveau ---------- */
function newView() {
  return `<div class="page-head"><div><h1>Nouveau bénévole</h1><div class="sub">Ajouté à l'édition courante</div></div>
    <div class="head-actions"><button class="btn" id="cancel">← Retour</button></div></div>
    <div class="card" style="max-width:620px">
      ${field("Nom", `<input data-b="nom" placeholder="Prénom Nom">`)}
      <div class="row2">${field("E-mail", `<input type="email" data-b="email">`)}${field("Téléphone", `<input data-b="telephone">`)}</div>
      ${field("Équipes", equipesChk([], ""))}
      <span class="chk-inline"><input type="checkbox" data-e="est_animateur"> Animateur</span>
      <button class="btn primary" id="b-create">Créer</button>
      <p class="msg" id="b-msg"></p>
    </div>`;
}

/* ---------- fiche ---------- */
function ficheView() {
  const be = list.find((x) => x.id === view.id);
  if (!be) { view.mode = "list"; return listView(); }
  const b = be.benevoles, w = canWrite(), ro = w ? "" : " disabled";
  return `<div class="page-head"><div><h1>${esc(b.nom)}</h1>
    <div class="sub">${(be.equipes || []).map(poleNom).join(" · ") || "sans équipe"}</div></div>
    <div class="head-actions"><button class="btn" id="back">← Liste</button>
      ${w && b.email && !b.profil_id ? `<button class="btn" id="invite">Inviter</button>` : ""}
      ${isAdmin() ? `<button class="btn danger" id="effacer" title="Droit à l'effacement (RGPD)">Effacer la personne</button>` : ""}
      ${w ? `<button class="btn primary" id="save">Enregistrer</button>` : ""}</div></div>
    <div class="two">
      <div class="l card"><h2>Personne</h2>
        ${field("Nom", `<input data-b="nom" value="${esc(b.nom)}"${ro}>`)}
        <div class="row2">${field("E-mail", `<input type="email" data-b="email" value="${esc(b.email || "")}"${ro}>`)}${field("Téléphone", `<input data-b="telephone" value="${esc(b.telephone || "")}"${ro}>`)}</div>
        <span class="chk-inline"><input type="checkbox" data-b="recontacter"${b.recontacter ? " checked" : ""}${ro}> Accepte d'être recontacté l'an prochain</span>
        ${b.profil_id ? `<p class="mini">Compte lié ✓</p>` : `<p class="mini">Pas encore de compte.</p>`}
      </div>
      <div class="r"><div class="card"><h2>Cette édition</h2>
        ${field("Équipes", equipesChk(be.equipes, ro))}
        <div class="row2">
          ${field("Statut", `<select data-e="statut"${ro}>${STATUTS.map((s) => `<option value="${s[0]}"${s[0] === be.statut ? " selected" : ""}>${s[1]}</option>`).join("")}</select>`)}
          ${field("", `<span class="chk-inline" style="margin-top:26px"><input type="checkbox" data-e="est_animateur"${be.est_animateur ? " checked" : ""}${ro}> Animateur</span>`)}
        </div>
        <div class="champ-groupe"><span class="lbl">Repas</span><span class="chk-inline"><input type="checkbox" data-e="repas_sam"${be.repas_sam ? " checked" : ""}${ro}> Samedi</span>
          <span class="chk-inline"><input type="checkbox" data-e="repas_dim"${be.repas_dim ? " checked" : ""}${ro}> Dimanche</span></div>
        <div class="champ-groupe"><span class="lbl">Disponibilités</span>${disposGrid(ro)}</div>
        ${field("Régime / allergies", `<input data-regime value="${esc(regimeBe)}" placeholder="ex. végétarien, sans gluten…"${ro}>`)}
        ${field("Notes", `<textarea data-e="notes"${ro}>${esc(be.notes || "")}</textarea>`)}
      </div></div>
    </div>
    <p class="msg" id="b-msg"></p>`;
}

/* ---------- câblage ---------- */
function wireOnce() {
  if (root.__benWired) return;
  root.__benWired = true;
  root.addEventListener("click", onClick);
  root.addEventListener("input", onInput);
  root.addEventListener("change", onChange);
}
function onClick(e) {
  const t = e.target;
  if (t.closest("#new-ben")) { view = { mode: "new", id: null }; return go(); }
  if (t.closest("#cancel") || t.closest("#back")) { view = { mode: "list", id: null }; return go(); }
  if (t.closest("#b-create")) return createBen();
  if (t.closest("#save")) return saveFiche();
  if (t.closest("#invite")) return invite();
  if (t.closest("#effacer")) return effacer();
  if (t.closest("#f-anim")) { filt.anim = !filt.anim; return go(); }
  const r = t.closest("[data-open]");
  if (r) return openFiche(r.dataset.open);
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
function onChange(e) {
  const t = e.target;
  if (t.id === "f-statut") { filt.statut = t.value; return go(); }
  if (t.id === "f-equipe") { filt.equipe = t.value; return go(); }
}
async function openFiche(id) {
  view = { mode: "fiche", id };
  dispos = {}; regimeBe = "";
  const [dsp, reg] = await Promise.all([
    supa.from("disponibilites").select("*").eq("benevole_edition_id", id),
    supa.from("regimes").select("texte").eq("benevole_edition_id", id).limit(1).maybeSingle(),
  ]);
  (dsp.data ?? []).forEach((d) => { dispos[`${d.jour}|${d.demi_journee}`] = d.disponible; });
  regimeBe = reg.data?.texte || "";
  go();
}

async function createBen() {
  const msg = root.querySelector("#b-msg");
  const g = (f) => root.querySelector(`[data-b="${f}"]`);
  const nom = (g("nom").value || "").trim();
  if (!nom) { msg.textContent = "Nom requis."; return; }
  const equipes = [...root.querySelectorAll("[data-eq]:checked")].map((c) => c.dataset.eq);
  const est_animateur = root.querySelector('[data-e="est_animateur"]').checked;
  msg.textContent = "Création…";
  const { data: b, error: e1 } = await supa.from("benevoles")
    .insert({ nom, email: g("email").value || null, telephone: g("telephone").value || null }).select().single();
  if (e1) { msg.textContent = "Erreur : " + e1.message; return; }
  const { data: be, error: e2 } = await supa.from("benevoles_editions")
    .insert({ benevole_id: b.id, edition_id: store.editionId, equipes, est_animateur }).select("*, benevoles(*)").single();
  if (e2) { msg.textContent = "Bénévole créé mais erreur sur l'édition : " + e2.message; return; }
  list.push(be);
  openFiche(be.id);
}

async function saveFiche() {
  const be = list.find((x) => x.id === view.id); if (!be) return;
  const msg = root.querySelector("#b-msg"); msg.textContent = "Enregistrement…";
  const g = (f) => root.querySelector(`[data-b="${f}"]`), e = (f) => root.querySelector(`[data-e="${f}"]`);
  const nom = (g("nom").value || "").trim();
  if (!nom) { msg.textContent = "Nom requis."; return; }
  const bPatch = { nom, email: g("email").value || null, telephone: g("telephone").value || null, recontacter: g("recontacter").checked };
  const equipes = [...root.querySelectorAll("[data-eq]")].filter((c) => c.checked).map((c) => c.dataset.eq);
  const ePatch = { equipes, statut: e("statut").value, est_animateur: e("est_animateur").checked,
    repas_sam: e("repas_sam").checked, repas_dim: e("repas_dim").checked, notes: e("notes").value || null };
  const dispoRows = [...root.querySelectorAll("[data-dispo]")].map((c) => {
    const [jour, demi] = c.dataset.dispo.split("|");
    return { benevole_edition_id: be.id, jour, demi_journee: demi, disponible: c.checked };
  });
  const regime = root.querySelector("[data-regime]")?.value || "";
  const [r1, r2, r3, r4] = await Promise.all([
    supa.from("benevoles").update(bPatch).eq("id", be.benevole_id),
    supa.from("benevoles_editions").update(ePatch).eq("id", be.id),
    dispoRows.length ? supa.from("disponibilites").upsert(dispoRows) : Promise.resolve({ error: null }),
    supa.rpc("definir_regime_benevole", { p_benevole_edition: be.id, p_texte: regime }),
  ]);
  if (r1.error || r2.error || r3.error || r4.error) { msg.textContent = "Erreur : " + (r1.error?.message || r2.error?.message || r3.error?.message || r4.error?.message); return; }
  Object.assign(be.benevoles, bPatch); Object.assign(be, ePatch);
  view = { mode: "list", id: null };
  go();
}

// Droit à l'effacement : fiche, inscriptions de toutes les éditions, formulaires
// publics, invitation et compte de connexion (migration 033, effacer_benevole).
async function effacer() {
  const be = list.find((x) => x.id === view.id); if (!be) return;
  const b = be.benevoles;
  if (!confirm(`Effacer définitivement ${b.nom} ?\n\nSupprime sa fiche, ses inscriptions à toutes les éditions, ses disponibilités, présences et compétences, ses formulaires reçus, son invitation et son compte de connexion. Irréversible.`)) return;
  const { error } = await supa.rpc("effacer_benevole", { p_benevole: b.id });
  const msg = root.querySelector("#b-msg");
  if (error) { if (msg) msg.textContent = "Erreur : " + error.message; return; }
  view = { mode: "list", id: null };
  await load(); go();
}

async function invite() {
  const be = list.find((x) => x.id === view.id); if (!be) return;
  const b = be.benevoles, msg = root.querySelector("#b-msg");
  if (!b.email) { msg.textContent = "Renseigne un e-mail d'abord."; return; }
  const email = b.email.trim().toLowerCase();
  msg.textContent = "Invitation…";
  const { error } = await supa.from("invitations").insert({
    email, role: "membre", pole_ids: [], benevole_id: b.id,
  });
  // 23505 = invitation déjà existante pour cet e-mail : on renvoie simplement l'e-mail.
  if (error && error.code !== "23505") { msg.textContent = "Erreur : " + error.message; return; }
  msg.textContent = "Envoi de l'e-mail…";
  const r = await sendInvitation(email);
  msg.textContent = r.error
    ? "Invitation enregistrée, mais l'e-mail n'est pas parti : " + r.error.message
    : "Invitation envoyée à " + email + " : la personne reçoit un lien pour choisir son mot de passe.";
}
