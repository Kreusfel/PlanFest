// Écran #/admin — Phase 0 (étape C). Admin seulement.
// Membres & pôles, invitations, import du plan depuis la maquette, export JSON.
import { supa } from "../supabase.js";
import { session, isAdmin, sendInvitation } from "../auth.js";
import { store } from "../store.js";
import { esc, plur } from "../ui/util.js";
import { exportMontage } from "../export/montage.js";
import { exportEtiquettes } from "../export/etiquettes.js";
import { exportFiches } from "../export/fiches.js";

let root, poles = [], members = [], invitations = [], versions = [], edNom = "";

const HEAD = `<div class="page-head"><div><h1>Administration</h1>
  <div class="sub">Comptes, invitations et données du plan.</div></div></div>`;

export async function render(container) {
  root = container;
  if (!isAdmin()) {
    root.innerHTML = HEAD + `<div class="card"><p class="muted">Réservé aux administrateurs.</p></div>`;
    return;
  }
  root.innerHTML = HEAD + `<div class="card"><p class="muted">Chargement…</p></div>`;
  try { await loadRefs(); } catch (e) {
    root.innerHTML = HEAD + `<div class="card"><p class="msg">Erreur : ${esc(e.message || e)}</p></div>`;
    return;
  }
  draw();
}

async function loadRefs() {
  const [p, prof, resp, inv] = await Promise.all([
    supa.from("poles").select("*").order("ordre"),
    supa.from("profils").select("*").order("email"),
    supa.from("responsables_pole").select("profil_id,pole_id"),
    supa.from("invitations").select("*").order("cree_le", { ascending: false }),
  ]);
  for (const r of [p, prof, resp, inv]) if (r.error) throw r.error;
  poles = p.data ?? [];
  invitations = inv.data ?? [];
  const byProfil = new Map();
  (resp.data ?? []).forEach((r) => {
    if (!byProfil.has(r.profil_id)) byProfil.set(r.profil_id, new Set());
    byProfil.get(r.profil_id).add(r.pole_id);
  });
  members = (prof.data ?? []).map((m) => ({ ...m, poleIds: byProfil.get(m.id) ?? new Set() }));

  if (store.editionId) {
    const [v, ed] = await Promise.all([
      supa.from("versions_plan").select("id,nom,cree_le").eq("edition_id", store.editionId).order("cree_le", { ascending: false }),
      supa.from("editions").select("nom").eq("id", store.editionId).single(),
    ]);
    versions = v.data ?? []; edNom = ed.data?.nom || "";
  } else { versions = []; edNom = ""; }
}

const poleNom = (id) => poles.find((p) => p.id === id)?.nom ?? "?";

/* ---------- rendu ---------- */
function draw() {
  root.innerHTML = HEAD + cardMembres() + cardInvitations() + cardVersions() + cardDonnees();
  wire();
}

function cardVersions() {
  if (!store.editionId) return `<div class="card admin-sec"><h2>Versions du plan</h2>
    <p class="muted">Ouvre une édition (dans « Plan des salles ») pour figer son plan.</p></div>`;
  const rows = versions.map((v) => `<div class="row">
      <div class="row-main"><b>${esc(v.nom)}</b>
        <span class="muted">${esc((v.cree_le || "").slice(0, 16).replace("T", " "))}</span></div>
      <div class="actions"><button class="btn small" data-restore="${v.id}">Restaurer</button></div>
    </div>`).join("") || `<p class="muted">Aucune version figée.</p>`;
  return `<div class="card admin-sec"><h2>Versions du plan</h2>
    <p class="mini">Fige l'état actuel du plan (salles, tables, repères) pour pouvoir y revenir.</p>
    <button class="btn" id="fig-now">Figer le plan maintenant</button>
    <div class="list" style="margin-top:12px">${rows}</div>
    <p class="msg" id="v-msg"></p></div>`;
}

function cardMembres() {
  const rows = members.map((m) => {
    const self = m.id === session.user.id;
    const chks = poles.map((p) =>
      `<label><input type="checkbox" data-pole="${p.id}" data-profil="${m.id}"${m.poleIds.has(p.id) ? " checked" : ""}> ${esc(p.nom)}</label>`
    ).join("");
    return `<div class="row">
      <div class="row-main">
        <b>${esc(m.nom || m.email)}</b>
        <span class="muted">${esc(m.email)}</span>
        <div class="poles-pick">${chks}</div>
      </div>
      <div class="actions">
        <span class="pill ${m.actif ? "ok" : "warn"}">${m.actif ? "Actif" : "Inactif"}</span>
        <span class="pill ${m.role === "admin" ? "amber" : "grey"}">${m.role === "admin" ? "Admin" : "Membre"}</span>
        ${self ? `<span class="mini">(vous)</span>` : `
          <button class="btn small" data-act="actif" data-id="${m.id}" data-v="${m.actif ? "0" : "1"}">${m.actif ? "Désactiver" : "Activer"}</button>
          <button class="btn small" data-act="role" data-id="${m.id}" data-v="${m.role === "admin" ? "membre" : "admin"}">${m.role === "admin" ? "Rétrograder" : "Promouvoir admin"}</button>
          <button class="btn small danger" data-act="compte-del" data-id="${m.id}">Supprimer</button>`}
      </div>
    </div>`;
  }).join("") || `<p class="muted">Aucun compte pour l'instant.</p>`;
  return `<div class="card admin-sec"><h2>Membres et pôles</h2>
    <p class="mini">Coche les pôles dont la personne est responsable (droits d'écriture associés).
      « Supprimer » efface le compte de connexion ; une éventuelle fiche bénévole est conservée.</p>
    <div class="list">${rows}</div></div>`;
}

function cardInvitations() {
  const list = invitations.map((i) => {
    const noms = (i.pole_ids ?? []).map(poleNom).join(", ") || "—";
    const used = !!i.utilisee_le;
    return `<div class="row">
      <div class="row-main">
        <b>${esc(i.email)}</b>
        <span class="muted">${i.role === "admin" ? "Admin" : "Membre"} · pôles : ${esc(noms)}</span>
      </div>
      <div class="actions">
        <span class="pill ${used ? "grey" : "ok"}">${used ? "Compte créé" : "En attente"}</span>
        <button class="btn small" data-act="inv-send" data-id="${i.id}" title="${used ? "Envoie un lien pour (re)choisir son mot de passe" : "Envoie l'e-mail d'invitation"}">${used ? "Renvoyer le lien" : "Envoyer"}</button>
        ${used ? "" : `<button class="btn small danger" data-act="inv-del" data-id="${i.id}">Supprimer</button>`}
      </div>
    </div>`;
  }).join("") || `<p class="muted">Aucune invitation.</p>`;
  const chks = poles.map((p) => `<label><input type="checkbox" data-inv-pole="${p.id}"> ${esc(p.nom)}</label>`).join("");
  return `<div class="card admin-sec"><h2>Invitations</h2>
    <p class="mini">Pas d'inscription libre : un compte n'est actif que si son e-mail a été invité ici.
      La personne reçoit un e-mail avec un lien pour choisir son mot de passe.</p>
    <div class="list">${list}</div>
    <hr>
    <h3>Nouvelle invitation</h3>
    <div class="row2">
      <label>E-mail<input id="inv-email" type="email" placeholder="prenom@exemple.fr"></label>
      <label>Rôle<select id="inv-role"><option value="membre">Membre</option><option value="admin">Admin</option></select></label>
    </div>
    <label>Pôles responsables<div class="poles-pick">${chks}</div></label>
    <button class="btn primary" id="inv-create">Inviter par e-mail</button>
    <p class="msg" id="inv-msg" aria-live="polite"></p></div>`;
}

function cardDonnees() {
  return `<div class="card admin-sec"><h2>Plan : import / export</h2>
    <p class="mini">L'édition courante est celle ouverte dans « Plan des salles ».</p>
    <h3>Exporter</h3>
    <button class="btn" id="exp-go">Exporter le plan (JSON)</button>
    <button class="btn" id="exp-montage">Liste de montage (PDF)</button>
    <button class="btn" id="exp-etiquettes">Étiquettes de table (PDF)</button>
    <button class="btn" id="exp-fiches">Fiches d'accueil (PDF)</button>
    <hr>
    <h3>Importer depuis l'ancienne maquette</h3>
    <p class="mini">Reprend les salles et le plan (tables + repères) d'un export PlanFest localStorage.
      Les tables « libres » deviennent « à attribuer ». N'écrase rien : ajoute de nouvelles salles.</p>
    <label>Fichier JSON<input type="file" id="imp-file" accept="application/json,.json"></label>
    <label>…ou coller le JSON<textarea id="imp-json" rows="4" placeholder='{"festivals":[…]}'></textarea></label>
    <label>Festival à importer<select id="imp-fest"><option value="">— charger un JSON d'abord —</option></select></label>
    <button class="btn primary" id="imp-go">Importer dans l'édition courante</button>
    <p class="msg" id="imp-msg" aria-live="polite"></p></div>`;
}

/* ---------- câblage ---------- */
function wire() {
  // Écouteurs délégués attachés une seule fois sur root (draw() peut être rappelé).
  if (!root.__adminWired) {
    root.addEventListener("click", onClick);
    root.addEventListener("change", onChange);
    root.__adminWired = true;
  }
  // Ces champs sont recréés à chaque draw() : on (ré)attache leurs écouteurs propres.
  const file = document.getElementById("imp-file");
  if (file) file.addEventListener("change", onFile);
  const box = document.getElementById("imp-json");
  if (box) box.addEventListener("input", refreshFestSelect);
}

async function onClick(e) {
  const b = e.target.closest("[data-act],[data-restore],#inv-create,#exp-go,#imp-go,#exp-montage,#exp-etiquettes,#exp-fiches,#fig-now");
  if (!b) return;
  if (b.id === "inv-create") return createInvitation();
  if (b.id === "exp-go") return exportPlan();
  if (b.id === "imp-go") return importPlan();
  if (b.id === "exp-montage") return pdfExport(exportMontage);
  if (b.id === "exp-etiquettes") return pdfExport(exportEtiquettes);
  if (b.id === "exp-fiches") return pdfExport(exportFiches);
  if (b.id === "fig-now") return figer();
  if (b.dataset.restore) return restaurer(b.dataset.restore);
  const act = b.dataset.act, id = b.dataset.id;
  if (act === "actif") await upd("profils", id, { actif: b.dataset.v === "1" });
  else if (act === "role") await upd("profils", id, { role: b.dataset.v });
  else if (act === "inv-del") await del("invitations", id);
  else if (act === "compte-del") await supprimerCompte(members.find((m) => m.id === id));
  else if (act === "inv-send") await envoyer(invitations.find((i) => i.id === id)?.email);
}

async function pdfExport(fn) {
  if (!store.editionId) { alert("Aucune édition courante (ouvre-en une dans « Plan des salles »)."); return; }
  try { await fn(store.editionId, edNom); }
  catch (e) { alert("Erreur export : " + (e.message || e)); }
}
async function figer() {
  const msg = document.getElementById("v-msg");
  const nom = prompt("Nom de la version ?", "Plan " + new Date().toISOString().slice(0, 10));
  if (!nom) return;
  if (msg) msg.textContent = "Figement…";
  const { error } = await supa.rpc("figer_plan", { p_edition: store.editionId, p_nom: nom });
  if (error) { if (msg) msg.textContent = "Erreur : " + error.message; return; }
  await reload();
}
async function restaurer(id) {
  if (!confirm("Restaurer cette version ? Le plan actuel de l'édition sera remplacé.")) return;
  const { error } = await supa.rpc("restaurer_plan", { p_version: id });
  if (error) { alert("Erreur : " + error.message); return; }
  alert("Plan restauré. Rouvre « Plan des salles » pour le voir.");
  await reload();
}

async function onChange(e) {
  const c = e.target.closest("[data-pole]");
  if (!c) return;
  const pole_id = c.dataset.pole, profil_id = c.dataset.profil;
  if (c.checked) await supa.from("responsables_pole").insert({ profil_id, pole_id });
  else await supa.from("responsables_pole").delete().eq("profil_id", profil_id).eq("pole_id", pole_id);
  await reload();
}

async function upd(table, id, patch) {
  const { error } = await supa.from(table).update(patch).eq("id", id);
  if (error) { alert("Erreur : " + error.message); return; }
  await reload();
}
async function del(table, id) {
  const { error } = await supa.from(table).delete().eq("id", id);
  if (error) { alert("Erreur : " + error.message); return; }
  await reload();
}
async function reload() { try { await loadRefs(); draw(); } catch (e) { /* laissé en l'état */ } }

async function createInvitation() {
  const msg = document.getElementById("inv-msg");
  const email = (document.getElementById("inv-email").value || "").trim().toLowerCase();
  const role = document.getElementById("inv-role").value;
  const pole_ids = [...document.querySelectorAll("[data-inv-pole]:checked")].map((c) => c.dataset.invPole);
  if (!email) { msg.textContent = "E-mail requis."; return; }
  msg.textContent = "Création…";
  const { error } = await supa.from("invitations").insert({ email, role, pole_ids });
  if (error) { msg.textContent = "Erreur : " + error.message; return; }
  msg.textContent = "Envoi de l'e-mail…";
  const r = await sendInvitation(email);
  await reload();
  const m = document.getElementById("inv-msg");
  if (m) m.textContent = r.error
    ? "Invitation enregistrée, mais l'e-mail n'est pas parti : " + r.error.message + " (bouton « Envoyer » pour réessayer)."
    : "Invitation envoyée à " + email + ".";
}

async function supprimerCompte(m) {
  if (!m) return;
  if (!confirm(`Supprimer définitivement le compte ${m.email} ?\n\nLa personne ne pourra plus se connecter ; son invitation est effacée (tu pourras la réinviter). Sa fiche bénévole éventuelle est conservée.`)) return;
  const { error } = await supa.rpc("supprimer_compte", { p_profil: m.id });
  if (error) { alert("Erreur : " + error.message); return; }
  await reload();
}

async function envoyer(email) {
  if (!email) return;
  const m = document.getElementById("inv-msg");
  if (m) m.textContent = "Envoi à " + email + "…";
  const r = await sendInvitation(email);
  if (m) m.textContent = r.error ? "Échec de l'envoi : " + r.error.message : "E-mail envoyé à " + email + ".";
}

/* ---------- export ---------- */
function download(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function exportPlan() {
  const msg = document.getElementById("imp-msg");
  if (!store.editionId) { msg.textContent = "Aucune édition courante (ouvre-en une dans « Plan des salles »)."; return; }
  const [s, el] = await Promise.all([
    supa.from("salles").select("*").eq("edition_id", store.editionId),
    supa.from("elements").select("*").eq("edition_id", store.editionId),
  ]);
  if (s.error || el.error) { msg.textContent = "Erreur export."; return; }
  const out = { kind: "planfest-edition", edition_id: store.editionId,
    exporte_le: new Date().toISOString(), salles: s.data ?? [], elements: el.data ?? [] };
  download("plan-" + store.editionId.slice(0, 8) + ".json", JSON.stringify(out, null, 2));
  msg.textContent = `Exporté : ${plur((s.data ?? []).length, "salle", "salles")}, ${plur((el.data ?? []).length, "élément", "éléments")}.`;
}

/* ---------- import depuis la maquette ---------- */
function onFile(e) {
  const f = e.target.files?.[0]; if (!f) return;
  const r = new FileReader();
  r.onload = () => { document.getElementById("imp-json").value = r.result; refreshFestSelect(); };
  r.readAsText(f);
}
function parseFestivals() {
  const raw = document.getElementById("imp-json").value.trim();
  if (!raw) return [];
  let obj; try { obj = JSON.parse(raw); } catch { return null; } // null = JSON invalide
  if (Array.isArray(obj.festivals)) return obj.festivals.map((f) => ({ nom: f.nom || "Festival", data: f.data }));
  if (obj.data && obj.data.salles) return [{ nom: obj.nom || "Festival", data: obj.data }];
  if (Array.isArray(obj.salles)) return [{ nom: "Festival", data: obj }];
  return [];
}
function refreshFestSelect() {
  const sel = document.getElementById("imp-fest"), msg = document.getElementById("imp-msg");
  const fests = parseFestivals();
  if (fests === null) { sel.innerHTML = `<option value="">— JSON invalide —</option>`; msg.textContent = "JSON illisible."; return; }
  if (!fests.length) { sel.innerHTML = `<option value="">— aucun festival trouvé —</option>`; msg.textContent = ""; return; }
  sel.innerHTML = fests.map((f, i) => {
    const n = (f.data?.items ?? []).length, ns = (f.data?.salles ?? []).length;
    return `<option value="${i}">${esc(f.nom)} — ${plur(ns, "salle", "salles")}, ${plur(n, "élément", "éléments")}</option>`;
  }).join("");
  msg.textContent = "";
}
async function importPlan() {
  const msg = document.getElementById("imp-msg");
  if (!store.editionId) { msg.textContent = "Aucune édition courante (ouvre-en une dans « Plan des salles »)."; return; }
  const fests = parseFestivals();
  if (!fests || !fests.length) { msg.textContent = "Rien à importer."; return; }
  const idx = parseInt(document.getElementById("imp-fest").value, 10) || 0;
  const data = fests[idx]?.data;
  if (!data || !Array.isArray(data.salles) || !data.salles.length) { msg.textContent = "Ce festival n'a pas de salle."; return; }
  msg.textContent = "Import…";
  try {
    const map = {};
    for (const s of data.salles) {
      const { data: ns, error } = await supa.from("salles")
        .insert({ edition_id: store.editionId, nom: s.nom || "Salle",
          cols: Math.max(1, s.cols | 0), rows: Math.max(1, s.rows | 0) }).select().single();
      if (error) throw error;
      map[s.id] = ns.id;
    }
    const rows = (data.items ?? []).filter((it) => map[it.salle]).map((it) => {
      const base = { edition_id: store.editionId, salle_id: map[it.salle], kind: it.kind,
        x: it.x | 0, y: it.y | 0, w: Math.max(1, it.w | 0), h: Math.max(1, it.h | 0) };
      if (it.kind === "table") {
        const tt = it.type === "partenaire" ? "partenaire" : it.type === "jurande" ? "jurande" : "non_attribuee";
        return { ...base, numero: String(it.numero ?? ""), type_table: tt, mode: "animee",
          chaises: it.chaises | 0, notes: it.notes || null };
      }
      return { ...base, kind: "bloc", sous: it.sous || "autre", label: it.label || null };
    });
    if (rows.length) { const { error } = await supa.from("elements").insert(rows); if (error) throw error; }
    msg.textContent = `Importé : ${plur(data.salles.length, "salle", "salles")}, ${plur(rows.length, "élément", "éléments")}. Ouvre « Plan des salles ».`;
  } catch (e) {
    msg.textContent = "Erreur import : " + (e.message || e);
  }
}
