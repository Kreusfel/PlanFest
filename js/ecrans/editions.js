// Écran Éditions : liste, ouverture, création, duplication, clôture.
import { supa } from "../supabase.js";
import { isAdmin } from "../auth.js";
import { store, setEdition } from "../store.js";
import { esc } from "../ui/util.js";
import { qrSVG } from "../export/qr.js";

const ETATS = { preparation: "En préparation", figee: "Figée", cloturee: "Clôturée" };
const JOURS = [["ven", "Vendredi"], ["sam", "Samedi"], ["dim", "Dimanche"]];
const hm = (t) => (t ? String(t).slice(0, 5) : "");

// Horaires d'ouverture par « édition|jour » (table horaires_ouverture, partagée avec
// l'écran Animations où le pôle bénévoles peut aussi les modifier).
let horaires = {};

// Réglages d'une édition : jours actifs, horaires d'ouverture par jour, limite matin
// (sert aux suggestions d'animateurs : avant = matin, après = après-midi).
function reglagesForm(e) {
  const actifs = e.jours_actifs?.length ? e.jours_actifs : ["sam", "dim"];
  const lignes = JOURS.map(([j, lbl]) => {
    const h = horaires[`${e.id}|${j}`] || {};
    return `<div class="reg-jour">
      <span class="chk-inline"><input type="checkbox" data-rjour="${e.id}" value="${j}" aria-label="${lbl} actif"${actifs.includes(j) ? " checked" : ""}> <b>${lbl}</b></span>
      <label>Ouverture<input type="time" data-rdeb="${e.id}|${j}" value="${hm(h.debut)}"></label>
      <label>Fermeture<input type="time" data-rfin="${e.id}|${j}" value="${hm(h.fin)}"></label>
    </div>`;
  }).join("");
  return `<details class="pub-editor"><summary>Réglages (jours, horaires)</summary>
    <p class="mini">Jours cochés = jours du festival : ils apparaissent dans Animations, Accueil, Présences et Sur le terrain.
      Vendredi = journée intergénérationnelle et mise en place.</p>
    ${lignes}
    <label>Limite matin / après-midi<input type="time" data-rlim="${e.id}" value="${hm(e.limite_matin) || "13:00"}"></label>
    <p class="mini">Sert à proposer des animateurs selon leurs disponibilités (matin / après-midi).</p>
    <button class="btn primary" data-saveregl="${e.id}">Enregistrer les réglages</button>
  </details>`;
}

export async function render(c) {
  c.innerHTML = `<div class="page-head"><div><h1>Éditions</h1></div></div><div class="card"><p class="muted">Chargement…</p></div>`;
  const [{ data, error }, hor] = await Promise.all([
    supa.from("editions").select("*").order("date_samedi", { ascending: false }),
    supa.from("horaires_ouverture").select("edition_id,jour,debut,fin"),
  ]);
  horaires = {};
  (hor.data ?? []).forEach((h) => { horaires[`${h.edition_id}|${h.jour}`] = h; });
  if (error) {
    c.innerHTML = `<div class="page-head"><div><h1>Éditions</h1></div></div><div class="card"><p class="msg">Erreur : ${esc(error.message)}</p></div>`;
    return;
  }

  const lien = (id) => `${location.origin}${location.pathname}#/public/programme/${id}`;
  const rows = (data ?? []).map((e) => `
    <div class="row">
      <div class="row-main">
        <b>${esc(e.nom)}${e.programme_publie ? ' <span class="pill ok">publié</span>' : ""}</b>
        <span class="muted">samedi ${esc(e.date_samedi)} · ${ETATS[e.etat] || e.etat}</span>
        ${e.programme_publie ? `<span class="mini">Programme public : <a href="#/public/programme/${e.id}">ouvrir</a> · <button class="link" data-copy="${esc(lien(e.id))}">copier le lien</button></span><div class="qr" title="QR du programme public">${qrSVG(lien(e.id))}</div>` : ""}
        ${isAdmin() ? reglagesForm(e) : ""}
        ${isAdmin() ? `<div class="dup-form" data-dupform="${e.id}" hidden>
          <div class="row2">
            <label>Nom de la copie<input data-dupnom="${e.id}" value="${esc(e.nom)} (copie)"></label>
            <label>Date du samedi<input type="date" data-dupdate="${e.id}"></label>
          </div>
          <p class="mini">Repris : plan des salles, organismes (à recontacter), jeux, tri de la ludothèque, horaires, subventions (à refaire, échéances décalées),
            articles de buvette (sans quantités), créneaux de permanence (sans bénévole), malles des écoles.
            Les bénévoles se reprennent ensuite depuis l'écran Bénévoles.</p>
          <button class="btn primary small" data-dupgo="${e.id}">Créer la copie</button>
        </div>` : ""}
      </div>
      <div class="actions">
        <button class="btn" data-open="${e.id}">Ouvrir</button>
        ${isAdmin() ? `<button class="btn ghost small" data-dup="${e.id}">Dupliquer</button>` : ""}
        ${isAdmin() ? `<button class="btn ghost small" data-pub="${e.id}" data-v="${e.programme_publie ? "0" : "1"}">${e.programme_publie ? "Dépublier" : "Publier"}</button>` : ""}
        ${isAdmin() && e.etat !== "cloturee" ? `<button class="btn ghost small" data-close="${e.id}">Clôturer</button>` : ""}
        ${isAdmin() ? `<button class="btn danger small" data-suppr="${e.id}">Supprimer</button>` : ""}
      </div>
    </div>`).join("") || `<p class="muted">Aucune édition pour l'instant.</p>`;

  c.innerHTML = `<div class="page-head"><div><h1>Éditions</h1>
    <div class="sub">Crée, duplique, clôture ou supprime une édition du festival.</div></div></div>
  <div class="card">
    <div class="list">${rows}</div>
    ${isAdmin() ? `
      <hr>
      <h2>Nouvelle édition</h2>
      <label>Nom<input id="n-nom" placeholder="Fécamp 2027"></label>
      <label>Date du samedi<input id="n-date" type="date"></label>
      <button class="btn primary" id="n-create">Créer</button>` : ""}
    <p class="msg" id="msg" aria-live="polite"></p>
  </div>`;

  const msg = c.querySelector("#msg");
  const reload = () => render(c);

  c.querySelectorAll("[data-open]").forEach((b) => (b.onclick = () => {
    setEdition(b.dataset.open);
    location.hash = "#/";
  }));

  // Dupliquer : petit formulaire dans la ligne (nom + vrai sélecteur de date),
  // au lieu de deux prompt() où la date se tapait à la main.
  c.querySelectorAll("[data-dup]").forEach((b) => (b.onclick = () => {
    const f = c.querySelector(`[data-dupform="${b.dataset.dup}"]`);
    if (f) { f.hidden = !f.hidden; if (!f.hidden) f.querySelector("input")?.focus(); }
  }));
  c.querySelectorAll("[data-dupgo]").forEach((b) => (b.onclick = async () => {
    const id = b.dataset.dupgo;
    const nom = (c.querySelector(`[data-dupnom="${id}"]`)?.value || "").trim();
    const date = c.querySelector(`[data-dupdate="${id}"]`)?.value || "";
    if (!nom || !date) { msg.textContent = "Nom et date du samedi requis pour la copie."; return; }
    msg.textContent = "Duplication…";
    const { error } = await supa.rpc("dupliquer_edition", {
      p_source: id, p_nom: nom, p_date_samedi: date,
    });
    msg.textContent = error ? "Erreur : " + error.message : "Édition dupliquée.";
    if (!error) reload();
  }));

  c.querySelectorAll("[data-pub]").forEach((b) => (b.onclick = async () => {
    const publier = b.dataset.v === "1";
    if (publier && !confirm("Publier le programme de cette édition ? Toute autre édition publiée sera dépubliée.")) return;
    msg.textContent = publier ? "Publication…" : "Dépublication…";
    const { error } = await supa.rpc("publier_edition", { p_edition: b.dataset.pub, p_publier: publier });
    msg.textContent = error ? "Erreur : " + error.message : (publier ? "Programme publié." : "Programme dépublié.");
    if (!error) reload();
  }));

  c.querySelectorAll("[data-copy]").forEach((b) => (b.onclick = async () => {
    try { await navigator.clipboard.writeText(b.dataset.copy); msg.textContent = "Lien copié."; }
    catch { msg.textContent = b.dataset.copy; }
  }));

  c.querySelectorAll("[data-close]").forEach((b) => (b.onclick = async () => {
    if (!confirm("Clôturer cette édition ? Cette action marque l'édition comme terminée.")) return;
    const { error } = await supa.from("editions").update({ etat: "cloturee" }).eq("id", b.dataset.close);
    msg.textContent = error ? "Erreur : " + error.message : "Édition clôturée.";
    if (!error) reload();
  }));

  c.querySelectorAll("[data-saveregl]").forEach((b) => (b.onclick = async () => {
    const id = b.dataset.saveregl;
    const ed = (data ?? []).find((x) => x.id === id) || {};
    const jours = [...c.querySelectorAll(`[data-rjour="${id}"]:checked`)].map((x) => x.value);
    if (!jours.length) { msg.textContent = "Coche au moins un jour."; return; }
    const lignes = [];
    for (const [j, lbl] of JOURS) {
      const debut = c.querySelector(`[data-rdeb="${id}|${j}"]`)?.value || null;
      const fin = c.querySelector(`[data-rfin="${id}|${j}"]`)?.value || null;
      if (debut && fin && fin <= debut) { msg.textContent = `${lbl} : la fermeture doit être après l'ouverture.`; return; }
      const avant = horaires[`${id}|${j}`] || {};
      // N'écrit que ce qui a changé (pas de ligne vide créée pour rien).
      if ((debut || "") !== hm(avant.debut) || (fin || "") !== hm(avant.fin)) lignes.push({ edition_id: id, jour: j, debut, fin });
    }
    const limite = c.querySelector(`[data-rlim="${id}"]`)?.value || "13:00";

    // Retirer un jour masque ce qui y est programmé : prévenir avant.
    const retires = (ed.jours_actifs?.length ? ed.jours_actifs : ["sam", "dim"]).filter((j) => !jours.includes(j));
    if (retires.length) {
      const [pa, pe] = await Promise.all([
        supa.from("parties").select("id", { count: "exact", head: true }).eq("edition_id", id).in("jour", retires),
        supa.from("permanences").select("id", { count: "exact", head: true }).eq("edition_id", id).in("jour", retires),
      ]);
      const n = (pa.count || 0) + (pe.count || 0);
      if (n && !confirm(`${n} partie(s) ou permanence(s) sont prévues sur le(s) jour(s) retiré(s). Elles ne seront plus affichées (mais pas supprimées). Continuer ?`)) return;
    }

    msg.textContent = "Enregistrement…";
    const [r1, r2] = await Promise.all([
      supa.from("editions").update({ jours_actifs: JOURS.map(([j]) => j).filter((j) => jours.includes(j)), limite_matin: limite }).eq("id", id),
      lignes.length ? supa.from("horaires_ouverture").upsert(lignes, { onConflict: "edition_id,jour" }) : Promise.resolve({ error: null }),
    ]);
    if (r1.error || r2.error) { msg.textContent = "Erreur : " + (r1.error || r2.error).message; return; }
    msg.textContent = "Réglages enregistrés.";
    reload();
  }));

  // Supprimer une édition : tout ce qui lui appartient part avec (plan, parties, permanences,
  // inscriptions des bénévoles et des organismes, entrées, buvette, subventions…). Les fiches
  // permanentes restent : organismes, jeux, personnes bénévoles, carnet de contacts.
  c.querySelectorAll("[data-suppr]").forEach((b) => (b.onclick = async () => {
    const ed = (data ?? []).find((x) => x.id === b.dataset.suppr); if (!ed) return;
    const saisi = prompt(`Supprimer définitivement « ${ed.nom} » ?\n\nTout ce qui appartient à cette édition est effacé : plan, parties, permanences, bénévoles et organismes inscrits, entrées, buvette, subventions, bilan… Irréversible.\nLes organismes, les jeux, les personnes et le carnet de contacts sont conservés.\n\nPour confirmer, tape le nom de l'édition :`);
    if (saisi == null) return;
    if (saisi.trim() !== ed.nom.trim()) { msg.textContent = "Nom différent : rien n'a été supprimé."; return; }
    msg.textContent = "Suppression…";
    const { data: sup, error } = await supa.from("editions").delete().eq("id", ed.id).select("id");
    if (error || !sup?.length) { msg.textContent = "Suppression impossible" + (error ? " : " + error.message : " (droits insuffisants)."); return; }
    if (store.editionId === ed.id) setEdition(null);
    location.reload();  // la barre latérale (sélecteur d'édition) doit oublier l'édition supprimée
  }));

  const cr = c.querySelector("#n-create");
  if (cr) cr.onclick = async () => {
    const nom = (c.querySelector("#n-nom").value || "").trim();
    const date = c.querySelector("#n-date").value;
    if (!nom || !date) { msg.textContent = "Nom et date requis."; return; }
    msg.textContent = "Création…";
    const { error } = await supa.from("editions").insert({ nom, date_samedi: date });
    msg.textContent = error ? "Erreur : " + error.message : "Édition créée.";
    if (!error) reload();
  };
}
