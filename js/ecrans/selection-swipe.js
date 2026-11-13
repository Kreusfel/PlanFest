// Composant de tri de la ludothèque (swipe), monté dans la page « Sélection Jeux ».
// Pour chaque jeu de l'asso : Oui / Non / Oui au bar à jeux, enregistré par édition.
import { supa } from "../supabase.js";
import { store } from "../store.js";
import { esc } from "../ui/util.js";
import { isAdmin, hasPole } from "../auth.js";

const CHOIX_LBL = { oui: "Oui", bar: "Bar à jeux", non: "Non" };
const CHOIX_CLS = { oui: "ok", bar: "warn", non: "bad" };
let root, games = [], choix = new Map(), cats = [], idx = 0, reste = false;
const gere = () => isAdmin() || hasPole("jeux_editeurs");
const catNom = (id) => cats.find((c) => c.id === id)?.nom || "";

const page = (body) => `<div class="swipe-wrap">
  <header class="swipe-head"><h2 style="font-size:18px;margin:0">Trier la ludothèque</h2>
    <span class="muted">${games.length ? `${Math.min(idx + 1, games.length)} / ${games.length}` : ""}</span></header>
  ${body}</div>`;

export async function render(container) {
  root = container; idx = 0;
  if (!store.editionId) { root.innerHTML = page(`<div class="card"><p><a class="btn primary" href="#/editions">Choisir une édition</a></p></div>`); return; }
  root.innerHTML = page(`<div class="card"><p class="muted">Chargement…</p></div>`);
  const [jx, ch, c] = await Promise.all([
    supa.from("jeux").select("id,titre,annee,image_url,miniature_url,joueurs_min,joueurs_max,duree_min,age_min,categorie_id").eq("ludotheque", true),
    supa.from("ludotheque_choix").select("jeu_id,choix").eq("edition_id", store.editionId),
    supa.from("categories_jeux").select("id,nom"),
  ]);
  const all = (jx.data ?? []).sort((a, b) => a.titre.localeCompare(b.titre, "fr"));
  choix = new Map((ch.data ?? []).map((r) => [r.jeu_id, r.choix]));
  cats = c.data ?? [];
  games = reste ? all.filter((g) => !choix.has(g.id)) : all;
  draw();
}

function counts() {
  let oui = 0, bar = 0, non = 0;
  for (const v of choix.values()) { if (v === "oui") oui++; else if (v === "bar") bar++; else if (v === "non") non++; }
  return { oui, bar, non, decides: choix.size };
}

function draw() {
  if (!games.length) {
    const c = counts();
    root.innerHTML = page(`<div class="card" style="text-align:center;padding:30px">
      <h2 style="font-size:20px">${c.decides ? "Triage terminé 🎉" : "Aucun jeu dans la ludothèque"}</h2>
      ${c.decides ? `<p class="muted">Sur ce festival : <b>${c.oui}</b> oui · <b>${c.bar}</b> bar à jeux · <b>${c.non}</b> non.</p>` : `<p class="muted">Ajoute des jeux depuis la page <a href="#/ludotheque">Ludothèque</a> pour les trier ici.</p>`}
      <div class="swipe-row2" style="justify-content:center;margin-top:12px">
        <button class="btn" id="lu-all">Tout revoir</button>
        <button class="btn" id="lu-reste"${reste ? " disabled" : ""}>Revoir les non décidés</button></div></div>`);
    wireEnd();
    return;
  }
  if (idx >= games.length) { games = []; return draw(); }
  const g = games[idx];
  const img = g.image_url || g.miniature_url;
  const cat = catNom(g.categorie_id);
  const cur = choix.get(g.id);
  const meta = [g.age_min ? `dès ${g.age_min} ans` : "",
    (g.joueurs_min || g.joueurs_max) ? `${g.joueurs_min || "?"} à ${g.joueurs_max || "?"} joueurs` : "",
    g.duree_min ? `${g.duree_min} min` : ""].filter(Boolean).join(" · ");
  const c = counts();
  root.innerHTML = page(`
    <div class="bar"><i style="width:${Math.round((idx / games.length) * 100)}%"></i></div>
    <div class="swipe-card card" id="swcard">
      <div class="cov swipe-cov">${img ? `<img src="${esc(img)}" alt="">` : "Image du jeu"}</div>
      <div><h2 style="font-size:20px">${esc(g.titre)}${g.annee ? ` <span class="muted">(${g.annee})</span>` : ""}</h2>
        <div class="muted" style="margin-top:4px">${esc(meta || "—")}${cat ? " · " + esc(cat) : ""}</div></div>
      ${cur ? `<span class="tag ${CHOIX_CLS[cur]}" style="align-self:flex-start">Déjà : ${esc(CHOIX_LBL[cur])}</span>` : ""}
    </div>
    <div class="swipe-btns">
      <button class="btn big danger" data-ch="non">Non</button>
      <button class="btn big" data-ch="bar">Oui — bar à jeux</button>
      <button class="btn big primary" data-ch="oui">Oui</button>
    </div>
    <div class="swipe-row2">
      <button class="btn" id="lu-back"${idx === 0 ? " disabled" : ""}>Annuler</button>
      <span class="muted" style="flex:1;text-align:center;align-self:center">${c.oui} oui · ${c.bar} bar · ${c.non} non</span>
    </div>
    <div class="sub" style="text-align:center">Glisse à droite : oui · en haut : bar à jeux · à gauche : non</div>`);
  wireCard();
  wireBtns();
}

function wireBtns() {
  root.querySelectorAll("[data-ch]").forEach((b) => (b.onclick = () => setChoix(b.dataset.ch)));
  const back = root.querySelector("#lu-back");
  if (back) back.onclick = () => { idx = Math.max(0, idx - 1); draw(); };
}
function wireEnd() {
  const all = root.querySelector("#lu-all"), rst = root.querySelector("#lu-reste");
  if (all) all.onclick = () => { reste = false; render(root); };
  if (rst) rst.onclick = () => { reste = true; render(root); };
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
    if (dx > T) setChoix("oui");
    else if (dx < -T) setChoix("non");
    else if (dy < -T) setChoix("bar");
  });
}

async function setChoix(c) {
  const g = games[idx]; if (!g) return;
  if (!gere()) { alert("Réservé au pôle Jeux & éditeurs."); return; }
  const { error } = await supa.from("ludotheque_choix")
    .upsert({ edition_id: store.editionId, jeu_id: g.id, choix: c }, { onConflict: "edition_id,jeu_id" });
  if (error) { alert("Erreur : " + error.message); return; }
  choix.set(g.id, c);
  idx++; draw();
}
