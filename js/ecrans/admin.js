// Écran #/admin — admin seulement : membres et pôles, invitations.
import { supa } from "../supabase.js";
import { session, isAdmin, sendInvitation } from "../auth.js";
import { esc, toast } from "../ui/util.js";

let root, poles = [], members = [], invitations = [];

const HEAD = `<div class="page-head"><div><h1>Administration</h1>
  <div class="sub">Comptes et invitations.</div></div></div>`;

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

}

const poleNom = (id) => poles.find((p) => p.id === id)?.nom ?? "?";

/* ---------- rendu ---------- */
function draw() {
  root.innerHTML = HEAD + cardMembres() + cardInvitations();
  wire();
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
    <div class="champ-groupe"><span class="lbl">Pôles responsables</span><div class="poles-pick">${chks}</div></div>
    <button class="btn primary" id="inv-create">Inviter par e-mail</button>
    <p class="msg" id="inv-msg" aria-live="polite"></p></div>`;
}

/* ---------- câblage ---------- */
function wire() {
  // Écouteurs délégués attachés une seule fois sur root (draw() peut être rappelé).
  if (!root.__adminWired) {
    root.addEventListener("click", onClick);
    root.addEventListener("change", onChange);
    root.__adminWired = true;
  }
}

async function onClick(e) {
  const b = e.target.closest("[data-act],#inv-create");
  if (!b) return;
  if (b.id === "inv-create") return createInvitation();
  const act = b.dataset.act, id = b.dataset.id;
  if (act === "actif") await upd("profils", id, { actif: b.dataset.v === "1" });
  else if (act === "role") await upd("profils", id, { role: b.dataset.v });
  else if (act === "inv-del") await del("invitations", id);
  else if (act === "compte-del") await supprimerCompte(members.find((m) => m.id === id));
  else if (act === "inv-send") await envoyer(invitations.find((i) => i.id === id)?.email);
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
  if (error) { toast("Erreur : " + error.message); return; }
  await reload();
}
async function del(table, id) {
  const { error } = await supa.from(table).delete().eq("id", id);
  if (error) { toast("Erreur : " + error.message); return; }
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
  if (error) { toast("Erreur : " + error.message); return; }
  await reload();
}

async function envoyer(email) {
  if (!email) return;
  const m = document.getElementById("inv-msg");
  if (m) m.textContent = "Envoi à " + email + "…";
  const r = await sendInvitation(email);
  if (m) m.textContent = r.error ? "Échec de l'envoi : " + r.error.message : "E-mail envoyé à " + email + ".";
}
