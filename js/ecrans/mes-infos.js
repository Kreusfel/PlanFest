// Écran #/mes-infos — le bénévole renseigne lui-même ce qui le concerne pour l'édition :
// confirmer (ou annuler) sa venue, ses disponibilités, son téléphone et son accord pour
// être recontacté l'an prochain. Droits en base : disponibilités et fiche « soi-même »
// (RLS), venue par confirmer_ma_venue (migration 045).
import { supa } from "../supabase.js";
import { session } from "../auth.js";
import { store } from "../store.js";
import { esc, toast } from "../ui/util.js";

// Même grille que la fiche bénévole : vendredi = mise en place, dimanche soir = rangement.
const DISPO_ROWS = [["ven", "Vendredi", ["matin", "aprem"]], ["sam", "Samedi", ["matin", "aprem"]], ["dim", "Dimanche", ["matin", "aprem", "soir"]]];
const DEMI = [["matin", "Matin"], ["aprem", "Après-midi"], ["soir", "Soir"]];
const STATUT = { inscrit: ["En attente de ta confirmation", "warn"], confirme: ["Venue confirmée", "ok"], annule: ["Tu as indiqué ne pas venir", "bad"] };

let root, me = null, be = null, dispos = new Set(), edNom = "";

const page = (body) => `<div class="page-head"><div><h1>Mes infos</h1>
  <div class="sub">${esc(edNom)}</div></div></div>${body}`;

export async function render(container) {
  root = container;
  if (!store.editionId) { root.innerHTML = page(`<div class="card"><p><a class="btn primary" href="#/editions">Choisir une édition</a></p></div>`); return; }
  root.innerHTML = page(`<div class="card"><p class="muted">Chargement…</p></div>`);
  const [m, ed] = await Promise.all([
    supa.from("benevoles").select("id,nom,email,telephone,recontacter").eq("profil_id", session.user.id).maybeSingle(),
    supa.from("editions").select("nom").eq("id", store.editionId).single(),
  ]);
  edNom = ed.data?.nom || "";
  me = m.data;
  if (!me) {
    root.innerHTML = page(`<div class="card"><p class="muted">Ton compte n'est pas relié à une fiche bénévole. Demande à un responsable bénévoles de te créer et de t'inviter.</p></div>`);
    return;
  }
  const r = await supa.from("benevoles_editions").select("id,statut,equipes").eq("edition_id", store.editionId).eq("benevole_id", me.id).maybeSingle();
  be = r.data;
  dispos = new Set();
  if (be) {
    const d = await supa.from("disponibilites").select("jour,demi_journee,disponible").eq("benevole_edition_id", be.id);
    (d.data || []).forEach((x) => { if (x.disponible) dispos.add(`${x.jour}|${x.demi_journee}`); });
  }
  draw();
}

function draw() {
  if (!be) {
    root.innerHTML = page(`<div class="card"><p>Bonjour ${esc(me.nom)} ! Tu n'es pas encore inscrit·e comme bénévole sur cette édition.</p>
      <p class="muted">Préviens un responsable bénévoles si tu veux participer.</p></div>${coordonnees()}`);
    wire(); return;
  }
  const [lbl, cls] = STATUT[be.statut] || [be.statut, "neu"];
  const grille = `<table class="dispo-grid"><tr><th></th>${DEMI.map(([, l]) => `<th>${l}</th>`).join("")}</tr>${
    DISPO_ROWS.map(([j, jl, ds]) => `<tr><th>${jl}</th>${DEMI.map(([d, dl]) => ds.includes(d)
      ? `<td><input type="checkbox" data-dispo="${j}|${d}" aria-label="${jl} ${dl}"${dispos.has(`${j}|${d}`) ? " checked" : ""}></td>` : "<td></td>").join("")}</tr>`).join("")}</table>`;
  root.innerHTML = page(`
    <div class="card"><div class="ihead"><h2>Ma venue</h2><span class="tag ${cls}">${esc(lbl)}</span></div>
      <div class="head-actions" style="justify-content:flex-start">
        ${be.statut !== "confirme" ? `<button class="btn primary" data-venue="1">Je confirme ma venue</button>` : ""}
        ${be.statut !== "annule" ? `<button class="btn" data-venue="0">Je ne pourrai pas venir</button>` : ""}
      </div>
      <p class="mini">Ton planning (parties et permanences) : <a href="#/terrain/moi">Mon planning</a>.</p></div>
    <div class="card"><h2>Mes disponibilités</h2>
      <p class="mini">Coche les demi-journées où tu peux aider. Vendredi = mise en place · dimanche soir = rangement.</p>
      ${grille}
      <button class="btn primary" id="dispo-save" style="margin-top:10px">Enregistrer mes disponibilités</button></div>
    ${coordonnees()}`);
  wire();
}

function coordonnees() {
  return `<div class="card"><h2>Mes coordonnées</h2>
    <label>E-mail (sert à te connecter)<input value="${esc(me.email || "")}" disabled></label>
    <label>Téléphone<input id="tel" type="tel" value="${esc(me.telephone || "")}" autocomplete="tel"></label>
    <span class="chk-inline"><input type="checkbox" id="recontacter"${me.recontacter ? " checked" : ""}> J'accepte d'être recontacté·e pour la prochaine édition</span>
    <button class="btn primary" id="coord-save" style="margin-top:10px">Enregistrer</button></div>`;
}

function wire() {
  root.querySelectorAll("[data-venue]").forEach((b) => (b.onclick = () => venue(b.dataset.venue === "1")));
  const ds = root.querySelector("#dispo-save"); if (ds) ds.onclick = saveDispos;
  const cs = root.querySelector("#coord-save"); if (cs) cs.onclick = saveCoord;
}

async function venue(vient) {
  if (!vient && !confirm("Indiquer que tu ne pourras pas venir ? Les responsables bénévoles le verront.")) return;
  const { error } = await supa.rpc("confirmer_ma_venue", { p_edition: store.editionId, p_vient: vient });
  if (error) { toast("Erreur : " + error.message); return; }
  be.statut = vient ? "confirme" : "annule";
  draw();
  toast(vient ? "Merci, ta venue est confirmée !" : "C'est noté.", "ok");
}

async function saveDispos() {
  const rows = [...root.querySelectorAll("[data-dispo]")].map((c) => {
    const [jour, demi] = c.dataset.dispo.split("|");
    return { benevole_edition_id: be.id, jour, demi_journee: demi, disponible: c.checked };
  });
  const { error } = await supa.from("disponibilites").upsert(rows, { onConflict: "benevole_edition_id,jour,demi_journee" });
  if (error) { toast("Erreur : " + error.message); return; }
  dispos = new Set(rows.filter((r) => r.disponible).map((r) => `${r.jour}|${r.demi_journee}`));
  toast("Disponibilités enregistrées.", "ok");
}

async function saveCoord() {
  const patch = { telephone: (root.querySelector("#tel").value || "").trim() || null, recontacter: root.querySelector("#recontacter").checked };
  const { data, error } = await supa.from("benevoles").update(patch).eq("id", me.id).select("id");
  if (error || !data?.length) { toast("Erreur : " + (error?.message || "modification refusée")); return; }
  Object.assign(me, patch);
  toast("Coordonnées enregistrées.", "ok");
}
