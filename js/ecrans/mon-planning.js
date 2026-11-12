// Écran #/mon-planning — Phase 3. Les parties que j'anime sur l'édition courante.
import { supa } from "../supabase.js";
import { session } from "../auth.js";
import { store } from "../store.js";
import { esc } from "../ui/util.js";

const JOUR_LBL = { ven: "Vendredi", sam: "Samedi", dim: "Dimanche" };
let root;

export async function render(container) {
  root = container;
  if (!store.editionId) {
    root.innerHTML = page(`<div class="card"><p><a class="btn primary" href="#/editions">Choisir une édition</a></p></div>`);
    return;
  }
  root.innerHTML = page(`<div class="card"><p class="muted">Chargement…</p></div>`);

  // Mon bénévole → ma participation à l'édition → mes parties.
  const me = await supa.from("benevoles").select("id").eq("profil_id", session.user.id).maybeSingle();
  if (!me.data) { root.innerHTML = page(`<div class="card"><p class="muted">Ton compte n'est pas relié à une fiche bénévole.</p></div>`); return; }
  const be = await supa.from("benevoles_editions").select("id").eq("benevole_id", me.data.id).eq("edition_id", store.editionId).maybeSingle();
  if (!be.data) { root.innerHTML = page(`<div class="card"><p class="muted">Tu n'es pas inscrit sur cette édition.</p></div>`); return; }

  const { data, error } = await supa.from("parties")
    .select("*, elements(numero, salle_id, salles(nom)), jeux_editions(jeux(titre))")
    .eq("benevole_edition_id", be.data.id).order("jour").order("debut");
  if (error) { root.innerHTML = page(`<div class="card"><p class="msg">Erreur : ${esc(error.message)}</p></div>`); return; }
  if (!data || !data.length) { root.innerHTML = page(`<div class="card"><p class="muted">Aucune partie ne t'est attribuée pour l'instant.</p></div>`); return; }

  const byJour = {};
  data.forEach((p) => { (byJour[p.jour] = byJour[p.jour] || []).push(p); });
  const cards = ["ven", "sam", "dim"].filter((j) => byJour[j]).map((j) => {
    const rows = byJour[j].map((p) => {
      const t = p.elements || {}, salle = t.salles?.nom || "";
      const jeu = p.jeux_editions?.jeux?.titre || p.titre || "Animation";
      return `<div class="row"><div class="row-main">
        <b>${esc((p.debut || "").slice(0, 5))}–${esc((p.fin || "").slice(0, 5))} · ${esc(jeu)}</b>
        <span class="muted">${esc(salle)}${t.numero ? " · table n°" + esc(t.numero) : ""}${p.places ? " · " + p.places + " places" : ""}</span>
      </div></div>`;
    }).join("");
    return `<div class="card"><h2>${esc(JOUR_LBL[j] || j)}</h2><div class="list">${rows}</div></div>`;
  }).join("");
  root.innerHTML = page(`<div class="dash-grid">${cards}</div>`);
}

const page = (body) => `<div class="page-head"><div><h1>Mon planning</h1>
  <div class="sub">Les parties que tu animes</div></div></div>${body}`;
