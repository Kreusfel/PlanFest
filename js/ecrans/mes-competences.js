// Écran #/mes-competences — swipe perso : parcourir les jeux et dire
// « J'anime / Je veux apprendre / Je n'anime pas » (RU-013).
import { supa } from "../supabase.js";
import { session } from "../auth.js";
import { store } from "../store.js";
import { esc } from "../ui/util.js";

let root, me = null, games = [], comps = [], beneIds = new Set(), cats = [], idx = 0;

const page = (body) => `<div class="swipe-wrap">
  <header class="swipe-head"><h1>Mes compétences</h1>
    <span class="muted">${games.length ? `${Math.min(idx + 1, games.length)} / ${games.length}` : ""}</span></header>
  ${body}</div>`;
const catNom = (id) => cats.find((c) => c.id === id)?.nom || "";

export async function render(container) {
  root = container; idx = 0;
  if (!store.editionId) { root.innerHTML = page(`<div class="card"><p><a class="btn primary" href="#/editions">Choisir une édition</a></p></div>`); return; }
  root.innerHTML = page(`<div class="card"><p class="muted">Chargement…</p></div>`);
  const m = await supa.from("benevoles").select("id,nom").eq("profil_id", session.user.id).maybeSingle();
  if (!m.data) { root.innerHTML = page(`<div class="card"><p class="muted">Ton compte n'est pas relié à une fiche bénévole. Demande à un responsable de te créer et t'inviter.</p></div>`); return; }
  me = m.data;
  const [je, cp, be, c] = await Promise.all([
    supa.from("jeux_editions").select("jeux(id,titre,annee,image_url,miniature_url,joueurs_min,joueurs_max,duree_min,age_min,categorie_id)").eq("edition_id", store.editionId),
    supa.from("competences").select("benevole_id,jeu_id,categorie_id,niveau"),
    supa.from("benevoles_editions").select("benevole_id").eq("edition_id", store.editionId),
    supa.from("categories_jeux").select("id,nom"),
  ]);
  games = (je.data ?? []).map((x) => x.jeux).filter(Boolean).sort((a, b) => a.titre.localeCompare(b.titre, "fr"));
  comps = cp.data ?? [];
  beneIds = new Set((be.data ?? []).map((x) => x.benevole_id));
  cats = c.data ?? [];
  wireOnce();
  draw();
}

function niveauForBen(benId, jeu) {
  const cj = comps.find((c) => c.benevole_id === benId && c.jeu_id === jeu.id);
  if (cj) return cj.niveau;
  const cc = comps.find((c) => c.benevole_id === benId && c.categorie_id && c.categorie_id === jeu.categorie_id);
  return cc ? cc.niveau : "non";
}
function hasAnimator(jeu) {
  for (const c of comps) { if (beneIds.has(c.benevole_id) && niveauForBen(c.benevole_id, jeu) === "anime") return true; }
  return false;
}

function draw() {
  if (!games.length) { root.innerHTML = page(`<div class="card"><p class="muted">Aucun jeu dans cette édition pour l'instant.</p></div>`); return; }
  if (idx >= games.length) {
    root.innerHTML = page(`<div class="card" style="text-align:center;padding:30px">
      <h2 style="font-size:20px">Terminé ! 🎉</h2>
      <p class="muted">Tu as parcouru les ${games.length} jeux. Merci !</p>
      <button class="btn" id="sw-restart">Revoir depuis le début</button></div>`);
    return;
  }
  const g = games[idx];
  const img = g.image_url || g.miniature_url;
  const cat = catNom(g.categorie_id);
  const meta = [g.age_min ? `dès ${g.age_min} ans` : "",
    (g.joueurs_min || g.joueurs_max) ? `${g.joueurs_min || "?"} à ${g.joueurs_max || "?"} joueurs` : "",
    g.duree_min ? `${g.duree_min} min` : ""].filter(Boolean).join(" · ");
  root.innerHTML = page(`
    <div class="bar"><i style="width:${Math.round((idx / games.length) * 100)}%"></i></div>
    <div class="swipe-card card" id="swcard">
      <div class="cov swipe-cov">${img ? `<img src="${esc(img)}" alt="">` : "Image BGG"}</div>
      <div><h2 style="font-size:20px">${esc(g.titre)}${g.annee ? ` <span class="muted">(${g.annee})</span>` : ""}</h2>
        <div class="muted" style="margin-top:4px">${esc(meta || "—")}${cat ? " · " + esc(cat) : ""}</div></div>
      ${hasAnimator(g) ? "" : `<span class="tag warn" style="align-self:flex-start">Aucun animateur pour ce jeu</span>`}
    </div>
    <div class="swipe-btns">
      <button class="big" style="color:#991B1B;border-color:#991B1B" data-lvl="non">Je n'anime pas</button>
      <button class="big" data-lvl="apprendre">Je veux apprendre</button>
      <button class="big pri" data-lvl="anime">J'anime</button>
    </div>
    <div class="swipe-row2">
      <button class="btn" id="sw-back"${idx === 0 ? " disabled" : ""}>Annuler</button>
      ${g.categorie_id ? `<button class="btn" style="flex:1" data-catlvl="anime">J'anime toute la catégorie ${esc(cat)}</button>` : ""}
    </div>
    <div class="sub" style="text-align:center">Glisse à droite : j'anime · en haut : je veux apprendre · à gauche : je n'anime pas</div>`);
  wireCard();
}

function wireOnce() {
  if (root.__mcWired) return;
  root.__mcWired = true;
  root.addEventListener("click", (e) => {
    const lvl = e.target.closest("[data-lvl]");
    if (lvl) return setLevel(lvl.dataset.lvl);
    const cat = e.target.closest("[data-catlvl]");
    if (cat) return setCatLevel(cat.dataset.catlvl);
    if (e.target.closest("#sw-back")) { idx = Math.max(0, idx - 1); return draw(); }
    if (e.target.closest("#sw-restart")) { idx = 0; return draw(); }
  });
}
function wireCard() {
  const card = root.querySelector("#swcard"); if (!card) return;
  let sx = 0, sy = 0, dx = 0, dy = 0, dragging = false;
  card.addEventListener("pointerdown", (e) => { dragging = true; sx = e.clientX; sy = e.clientY; card.setPointerCapture(e.pointerId); });
  card.addEventListener("pointermove", (e) => {
    if (!dragging) return; dx = e.clientX - sx; dy = e.clientY - sy;
    card.style.transform = `translate(${dx}px,${dy}px) rotate(${dx / 25}deg)`;
  });
  card.addEventListener("pointerup", () => {
    if (!dragging) return; dragging = false; card.style.transform = "";
    const T = 80;
    if (dx > T) setLevel("anime");
    else if (dx < -T) setLevel("non");
    else if (dy < -T) setLevel("apprendre");
  });
}

async function setLevel(niveau) {
  const g = games[idx]; if (!g) return;
  await supa.from("competences").delete().eq("benevole_id", me.id).eq("jeu_id", g.id);
  const { error } = await supa.from("competences").insert({ benevole_id: me.id, jeu_id: g.id, niveau });
  if (error) { alert("Erreur : " + error.message); return; }
  comps = comps.filter((c) => !(c.benevole_id === me.id && c.jeu_id === g.id));
  comps.push({ benevole_id: me.id, jeu_id: g.id, niveau });
  idx++; draw();
}
async function setCatLevel(niveau) {
  const g = games[idx]; if (!g || !g.categorie_id) return;
  await supa.from("competences").delete().eq("benevole_id", me.id).eq("categorie_id", g.categorie_id);
  const { error } = await supa.from("competences").insert({ benevole_id: me.id, categorie_id: g.categorie_id, niveau });
  if (error) { alert("Erreur : " + error.message); return; }
  comps = comps.filter((c) => !(c.benevole_id === me.id && c.categorie_id === g.categorie_id));
  comps.push({ benevole_id: me.id, categorie_id: g.categorie_id, niveau });
  idx++; draw();
}
