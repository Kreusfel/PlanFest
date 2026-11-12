// État du plan en mémoire + chargement depuis Supabase.
import { supa } from "../supabase.js";
import { store } from "../store.js";

export const plan = {
  edition: null,
  salles: [],
  elements: new Map(), // id -> element
  salleId: null,
  sel: new Set(),       // ids sélectionnés
  categories: [],
};

export async function loadPlan() {
  const ed = store.editionId;
  plan.edition = ed;
  plan.elements = new Map();
  const [salles, els, cats] = await Promise.all([
    supa.from("salles").select("*").eq("edition_id", ed).order("cree_le"),
    supa.from("elements").select("*").eq("edition_id", ed),
    supa.from("categories_jeux").select("*").order("ordre"),
  ]);
  if (salles.error) throw salles.error;
  if (els.error) throw els.error;
  plan.salles = salles.data ?? [];
  (els.data ?? []).forEach((e) => plan.elements.set(e.id, e));
  plan.categories = cats.data ?? [];
  if (!plan.salleId || !plan.salles.some((s) => s.id === plan.salleId))
    plan.salleId = plan.salles[0]?.id ?? null;
}

// Recharge depuis le serveur un sous-ensemble d'éléments (conflit d'autosave).
// Un id absent de la réponse = élément supprimé côté serveur → on le retire aussi localement.
export async function reloadElements(ids) {
  if (!ids || !ids.length) return;
  const { data, error } = await supa.from("elements").select("*").in("id", ids).eq("edition_id", plan.edition);
  if (error) throw error;
  const got = new Set();
  (data ?? []).forEach((e) => { plan.elements.set(e.id, e); got.add(e.id); });
  ids.forEach((id) => { if (!got.has(id)) { plan.elements.delete(id); plan.sel.delete(id); } });
}

export function curSalle() { return plan.salles.find((s) => s.id === plan.salleId) ?? null; }
export function salleElements(sid) {
  return [...plan.elements.values()].filter((e) => e.salle_id === sid);
}
export function maxNumero() {
  let m = 0;
  for (const e of plan.elements.values()) {
    const n = parseInt(e.numero, 10);
    if (!isNaN(n) && n > m) m = n;
  }
  return m;
}
export function overlap(a, b) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}
export function isFree(s, x, y, w, h, ignore) {
  if (x < 0 || y < 0 || x + w > s.cols || y + h > s.rows) return false;
  const r = { x, y, w, h };
  return !salleElements(s.id).some((o) => o.id !== ignore && overlap(r, o));
}
export function freeSpot(s, w, h) {
  for (let y = 1; y <= s.rows - h; y++)
    for (let x = 1; x <= s.cols - w; x++) if (isFree(s, x, y, w, h)) return { x, y };
  for (let y = 0; y <= s.rows - h; y++)
    for (let x = 0; x <= s.cols - w; x++) if (isFree(s, x, y, w, h)) return { x, y };
  return { x: 0, y: 0 };
}
