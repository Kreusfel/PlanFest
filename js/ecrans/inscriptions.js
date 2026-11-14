// Écran #/inscriptions — Phase 1 (reliquat). Traiter les formulaires publics reçus.
import { supa } from "../supabase.js";
import { isAdmin, hasPole } from "../auth.js";
import { store } from "../store.js";
import { esc } from "../ui/util.js";

let root, parts = [], benv = [], loadErr = "";

const canPart = () => isAdmin() || hasPole("partenaires");
const canBenv = () => isAdmin() || hasPole("animateurs_benevoles");

export async function render(container) {
  root = container;
  if (!store.editionId) {
    root.innerHTML = page(`<div class="card"><p><a class="btn primary" href="#/editions">Choisir une édition</a></p></div>`);
    return;
  }
  await load();
  wireOnce();
  draw();
}

const page = (body) => `<div class="page-head"><div><h1>Inscriptions reçues</h1>
  <div class="sub">Formulaires publics à intégrer</div></div></div>${body}`;

async function load() {
  loadErr = "";
  const ed = store.editionId;
  const [p, b] = await Promise.all([
    canPart() ? supa.from("inscriptions_partenaires").select("*").eq("edition_id", ed).eq("traitee", false).order("recu_le") : Promise.resolve({ data: [] }),
    canBenv() ? supa.from("inscriptions_benevoles").select("*").eq("edition_id", ed).eq("traitee", false).order("recu_le") : Promise.resolve({ data: [] }),
  ]);
  if (p.error || b.error) loadErr = (p.error || b.error).message;
  parts = p.data ?? []; benv = b.data ?? [];
}

function lien(type) {
  return `${location.origin}${location.pathname}#/public/inscription/${type}/${store.editionId}`;
}
function card(ins, type) {
  const pl = ins.payload || {};
  const lignes = Object.entries(pl).filter(([k]) => k !== "_hp")
    .map(([k, v]) => `<span class="mini"><b>${esc(k)}</b> : ${esc(String(v))}</span>`).join(" · ");
  return `<div class="row">
    <div class="row-main"><b>${esc(pl.nom || "Sans nom")}</b><span class="muted">${esc((ins.recu_le || "").slice(0, 16).replace("T", " "))}</span>
      <div>${lignes}</div></div>
    <div class="actions"><button class="btn small danger" data-rejet="${type}:${ins.id}">Rejeter</button>
      <button class="btn small primary" data-integ="${type}:${ins.id}">Intégrer</button></div>
  </div>`;
}

function draw() {
  const pCard = canPart() ? `<div class="card"><h2>Partenaires <span class="mini">${parts.length}</span></h2>
    <p class="mini">Lien du formulaire : <button class="link" data-copy="${esc(lien("partenaire"))}">copier</button> · <a href="#/public/inscription/partenaire/${store.editionId}">ouvrir</a></p>
    <div class="list">${parts.map((i) => card(i, "partenaire")).join("") || `<p class="muted">Aucune inscription en attente.</p>`}</div></div>` : "";
  const bCard = canBenv() ? `<div class="card"><h2>Bénévoles <span class="mini">${benv.length}</span></h2>
    <p class="mini">Lien du formulaire : <button class="link" data-copy="${esc(lien("benevole"))}">copier</button> · <a href="#/public/inscription/benevole/${store.editionId}">ouvrir</a></p>
    <div class="list">${benv.map((i) => card(i, "benevole")).join("") || `<p class="muted">Aucune inscription en attente.</p>`}</div></div>` : "";
  root.innerHTML = page(`${loadErr ? `<p class="msg">Erreur : ${esc(loadErr)}</p>` : ""}<div class="dash-grid">${pCard}${bCard}</div><p class="msg" id="i-msg"></p>`);
}

function wireOnce() {
  if (root.__inscWired) return;
  root.__inscWired = true;
  root.addEventListener("click", async (e) => {
    const copy = e.target.closest("[data-copy]");
    if (copy) { try { await navigator.clipboard.writeText(copy.dataset.copy); const m = root.querySelector("#i-msg"); if (m) m.textContent = "Lien copié."; } catch { /* ignore */ } return; }
    const integ = e.target.closest("[data-integ]");
    if (integ) return integrer(integ.dataset.integ);
    const rejet = e.target.closest("[data-rejet]");
    if (rejet) return rejeter(rejet.dataset.rejet);
  });
}

async function integrer(key) {
  const [type, id] = key.split(":");
  const msg = root.querySelector("#i-msg"); if (msg) msg.textContent = "Intégration…";
  const rpc = type === "partenaire" ? "integrer_inscription_partenaire" : "integrer_inscription_benevole";
  const { error } = await supa.rpc(rpc, { p_id: id });
  if (error) { if (msg) msg.textContent = "Erreur : " + error.message; return; }
  await load(); draw();
  const m = root.querySelector("#i-msg"); if (m) m.textContent = type === "partenaire" ? "Partenaire créé (statut à contacter)." : "Bénévole créé.";
}

// Rejeter = supprimer le formulaire (doublon, spam, personne qui se désiste) :
// rien n'est créé, et les données personnelles ne restent pas stockées.
async function rejeter(key) {
  const [type, id] = key.split(":");
  const ins = (type === "partenaire" ? parts : benv).find((x) => x.id === id);
  if (!confirm(`Rejeter l'inscription de « ${ins?.payload?.nom || "sans nom"} » ? Le formulaire est supprimé définitivement.`)) return;
  const table = type === "partenaire" ? "inscriptions_partenaires" : "inscriptions_benevoles";
  const { data, error } = await supa.from(table).delete().eq("id", id).select("id");
  const msg = root.querySelector("#i-msg");
  if (error || !data?.length) { if (msg) msg.textContent = "Suppression impossible" + (error ? " : " + error.message : " (droits insuffisants)."); return; }
  await load(); draw();
  const m = root.querySelector("#i-msg"); if (m) m.textContent = "Inscription rejetée.";
}
