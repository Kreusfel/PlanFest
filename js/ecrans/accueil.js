// Écran #/accueil — Phase 4. Comptage des entrées (jour J), résilient hors-ligne.
// Chaque clic crée une entrée (id client) mise en file IndexedDB puis synchronisée.
import { supa } from "../supabase.js";
import { session } from "../auth.js";
import { store } from "../store.js";
import { esc } from "../ui/util.js";
import { qAdd, qAll, qDel } from "../offline/idb.js";

const TRANCHES = [["3+", "3 ans +"], ["6+", "6 ans +"], ["8+", "8 ans +"], ["13+", "13 ans +"], ["adulte", "Adulte"]];
const JOURS = [["ven", "Vendredi"], ["sam", "Samedi"], ["dim", "Dimanche"]];

let root, jours = ["sam", "dim"], jour = "sam", counts = {}, synced = true;

export async function render(container) {
  root = container;
  if (!store.editionId) {
    root.innerHTML = `<div class="page-head"><div><h1>Accueil</h1><div class="sub">Aucune édition</div></div></div>
      <div class="card"><p><a class="btn primary" href="#/editions">Choisir une édition</a></p></div>`;
    return;
  }
  const ed = await supa.from("editions").select("jours_actifs").eq("id", store.editionId).single();
  jours = ed.data?.jours_actifs?.length ? ed.data.jours_actifs : ["sam", "dim"];
  if (!jours.includes(jour)) jour = jours[0];
  wireOnce();
  await refresh();
}

async function refresh() {
  const ed = store.editionId;
  const { data, error } = await supa.from("entrees").select("id,tranche_age").eq("edition_id", ed).eq("jour", jour);
  const c = {}; TRANCHES.forEach((t) => (c[t[0]] = 0));
  const serverIds = new Set();
  if (!error) (data ?? []).forEach((r) => { serverIds.add(r.id); c[r.tranche_age] = (c[r.tranche_age] || 0) + 1; });
  const q = (await qAll()).filter((e) => e.edition_id === ed && e.jour === jour && !serverIds.has(e.id));
  q.forEach((e) => { c[e.tranche_age] = (c[e.tranche_age] || 0) + 1; });
  counts = c; synced = q.length === 0;
  draw();
  flush();
}

function draw() {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const jourBtns = jours.map((j) => `<button class="btn small${j === jour ? " primary" : ""}" data-jour="${j}">${esc((JOURS.find((x) => x[0] === j) || [j, j])[1])}</button>`).join("");
  const tiles = TRANCHES.map(([k, lbl]) => `<button class="entry-tile" data-add="${k}">
      <span class="entry-count">${counts[k] || 0}</span>
      <span class="entry-lbl">${esc(lbl)}</span>
      <span class="entry-plus">+1</span></button>`).join("");
  root.innerHTML = `<div class="page-head"><div><h1>Accueil</h1>
    <div class="sub">Comptage des entrées · ${total} aujourd'hui · ${synced ? "synchronisé" : "en attente de réseau"}</div></div>
    <div class="head-actions">${jourBtns}</div></div>
    <div class="card">
      <p class="mini">${navigator.onLine ? "En ligne" : "⚠ Hors ligne — les saisies sont gardées et envoyées au retour du réseau."}</p>
      <div class="entry-grid">${tiles}</div>
    </div>`;
}

function wireOnce() {
  if (root.__accWired) return;
  root.__accWired = true;
  root.addEventListener("click", (e) => {
    const j = e.target.closest("[data-jour]");
    if (j) { jour = j.dataset.jour; return refresh(); }
    const a = e.target.closest("[data-add]");
    if (a) return add(a.dataset.add);
  });
  window.addEventListener("online", () => { if (store.editionId) refresh(); });
  window.addEventListener("offline", draw);
}

async function add(tranche) {
  const item = {
    id: crypto.randomUUID(), edition_id: store.editionId, jour,
    tranche_age: tranche, saisi_le: new Date().toISOString(), saisi_par: session.user.id,
  };
  await qAdd(item);
  counts[tranche] = (counts[tranche] || 0) + 1;
  synced = false;
  draw();
  flush();
}

let flushing = false;
async function flush() {
  if (flushing || !navigator.onLine) return;
  flushing = true;
  try {
    const q = await qAll();
    for (const e of q) {
      const { error } = await supa.from("entrees").upsert(e);
      if (!error) await qDel(e.id);
    }
    const left = (await qAll()).length;
    if (synced !== (left === 0)) { synced = left === 0; draw(); }
  } finally { flushing = false; }
}
