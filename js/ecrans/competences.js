// Écran #/competences — Phase 2. Niveau par catégorie (J'anime / À apprendre / Non).
// Un gestionnaire (admin / animateurs_benevoles) édite n'importe quel bénévole ; sinon soi-même.
import { supa } from "../supabase.js";
import { session, isAdmin, hasPole } from "../auth.js";
import { store } from "../store.js";
import { esc } from "../ui/util.js";

const NIVEAUX = [["anime", "J'anime", "ok"], ["apprendre", "À apprendre", "amber"], ["non", "Non", "grey"]];
let root, cats = [], benevoles = [], targetId = null, comps = {};

const gere = () => isAdmin() || hasPole("animateurs_benevoles");

export async function render(container) {
  root = container;
  root.innerHTML = page(`<div class="card"><p class="muted">Chargement…</p></div>`);
  const c = await supa.from("categories_jeux").select("id,nom,type,ordre").order("ordre");
  cats = c.data ?? [];
  if (gere()) {
    // Limité aux bénévoles de l'édition courante (évite de lister tout l'historique).
    if (!store.editionId) { root.innerHTML = page(`<div class="card"><p><a class="btn primary" href="#/editions">Choisir une édition</a></p></div>`); return; }
    const b = await supa.from("benevoles_editions").select("benevole:benevoles(id,nom)").eq("edition_id", store.editionId);
    const seen = new Set();
    benevoles = (b.data ?? []).map((x) => x.benevole).filter(Boolean)
      .filter((x) => (seen.has(x.id) ? false : seen.add(x.id)))
      .sort((a, z) => a.nom.localeCompare(z.nom, "fr"));
    if (!(targetId && benevoles.some((x) => x.id === targetId))) targetId = benevoles[0]?.id || null;
  } else {
    const me = await supa.from("benevoles").select("id,nom").eq("profil_id", session.user.id).maybeSingle();
    if (!me.data) { root.innerHTML = page(`<div class="card"><p class="muted">Ton compte n'est pas encore relié à une fiche bénévole. Demande à un responsable de te créer et t'inviter.</p></div>`); return; }
    benevoles = [me.data]; targetId = me.data.id;
  }
  if (!targetId) { root.innerHTML = page(`<div class="card"><p class="muted">Aucun bénévole. Crée-en un dans « Bénévoles ».</p></div>`); return; }
  await loadComps();
  wireOnce();
  draw();
}

const page = (body) => `<div class="page-head"><div><h1>Compétences</h1>
  <div class="sub">Qui peut animer quoi</div></div></div>${body}`;

async function loadComps() {
  comps = {};
  const { data } = await supa.from("competences").select("*").eq("benevole_id", targetId).is("jeu_id", null);
  (data ?? []).forEach((c) => { comps[c.categorie_id] = c.niveau; });
}

function draw() {
  const sel = gere() ? `<label>Bénévole<select id="who">${benevoles.map((b) => `<option value="${b.id}"${b.id === targetId ? " selected" : ""}>${esc(b.nom)}</option>`).join("")}</select></label>` : "";
  const byType = {};
  cats.forEach((c) => { (byType[c.type] = byType[c.type] || []).push(c); });
  const TYPE_LBL = { age: "Âges", niveau: "Niveaux", format: "Formats" };
  const sections = Object.keys(byType).map((t) => `
    <h3 style="font:700 13px var(--display);margin:16px 0 8px">${esc(TYPE_LBL[t] || t)}</h3>
    ${byType[t].map((c) => {
      const cur = comps[c.id] || "non";
      const btns = NIVEAUX.map(([k, lbl, cls]) =>
        `<button class="niv ${cur === k ? "on " + cls : ""}" data-cat="${c.id}" data-niv="${k}">${esc(lbl)}</button>`).join("");
      return `<div class="comp-row"><span class="comp-nom">${esc(c.nom)}</span><div class="niv-grp">${btns}</div></div>`;
    }).join("")}`).join("");
  root.innerHTML = page(`<div class="card" style="max-width:720px">
    ${sel}
    <p class="mini">Clique pour définir le niveau. « J'anime » rend la personne proposable pour cette catégorie.</p>
    ${sections}
    <p class="msg" id="c-msg"></p>
  </div>`);
}

function wireOnce() {
  if (root.__compWired) return;
  root.__compWired = true;
  root.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-niv]"); if (!b) return;
    await setNiveau(b.dataset.cat, b.dataset.niv);
  });
  root.addEventListener("change", async (e) => {
    if (e.target.id === "who") { targetId = e.target.value; await loadComps(); draw(); }
  });
}

async function setNiveau(categorie_id, niveau) {
  const msg = root.querySelector("#c-msg"); if (msg) msg.textContent = "…";
  // Remplace la ligne existante pour cette (bénévole, catégorie).
  await supa.from("competences").delete().eq("benevole_id", targetId).eq("categorie_id", categorie_id);
  const { error } = await supa.from("competences").insert({ benevole_id: targetId, categorie_id, niveau });
  if (error) { if (msg) msg.textContent = "Erreur : " + error.message; return; }
  comps[categorie_id] = niveau;
  draw();
}
