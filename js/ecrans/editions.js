// Écran Éditions : liste, ouverture, création, duplication, clôture.
import { supa } from "../supabase.js";
import { isAdmin } from "../auth.js";
import { setEdition } from "../store.js";
import { esc } from "../ui/util.js";
import { qrSVG } from "../export/qr.js";

const ETATS = { preparation: "En préparation", figee: "Figée", cloturee: "Clôturée" };

export async function render(c) {
  c.innerHTML = `<div class="page-head"><div><h1>Éditions</h1></div></div><div class="card"><p class="muted">Chargement…</p></div>`;
  const { data, error } = await supa
    .from("editions").select("*").order("date_samedi", { ascending: false });
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
        ${isAdmin() ? `<details class="pub-editor"><summary>Contenu public (visiteurs)</summary>
          <label>Texte de présentation (activités, food trucks, partenaires…)
            <textarea data-pres="${e.id}" placeholder="Décris le festival pour les visiteurs…">${esc(e.presentation || "")}</textarea></label>
          <button class="btn primary" data-savepub="${e.id}">Enregistrer</button>
        </details>` : ""}
        ${isAdmin() ? `<div class="dup-form" data-dupform="${e.id}" hidden>
          <div class="row2">
            <label>Nom de la copie<input data-dupnom="${e.id}" value="${esc(e.nom)} (copie)"></label>
            <label>Date du samedi<input type="date" data-dupdate="${e.id}"></label>
          </div>
          <button class="btn primary small" data-dupgo="${e.id}">Créer la copie</button>
        </div>` : ""}
      </div>
      <div class="actions">
        <button class="btn" data-open="${e.id}">Ouvrir</button>
        ${isAdmin() ? `<button class="btn ghost small" data-dup="${e.id}">Dupliquer</button>` : ""}
        ${isAdmin() ? `<button class="btn ghost small" data-pub="${e.id}" data-v="${e.programme_publie ? "0" : "1"}">${e.programme_publie ? "Dépublier" : "Publier"}</button>` : ""}
        ${isAdmin() && e.etat !== "cloturee" ? `<button class="btn ghost small" data-close="${e.id}">Clôturer</button>` : ""}
      </div>
    </div>`).join("") || `<p class="muted">Aucune édition pour l'instant.</p>`;

  c.innerHTML = `<div class="page-head"><div><h1>Éditions</h1>
    <div class="sub">Crée, duplique ou clôture une édition du festival.</div></div></div>
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
    location.hash = "#/plan";
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

  c.querySelectorAll("[data-savepub]").forEach((b) => (b.onclick = async () => {
    const id = b.dataset.savepub;
    const pres = c.querySelector(`[data-pres="${id}"]`).value || null;
    msg.textContent = "Enregistrement…";
    const { error } = await supa.from("editions").update({ presentation: pres }).eq("id", id);
    msg.textContent = error ? "Erreur : " + error.message : "Contenu public enregistré.";
    if (!error) reload();
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
