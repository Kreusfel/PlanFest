// Historique annuler / refaire (RU-016). Snapshots de l'ensemble des éléments
// de l'édition ; chaque annulation/refaire est resynchronisée via l'autosave.
import { plan } from "./model.js";
import { markUpsert, markDelete } from "./autosave.js";

const past = [], future = [];
let baseline = [];
const MAX = 80;

const clone = (e) => JSON.parse(JSON.stringify(e));
const snap = () => [...plan.elements.values()].map(clone);

export function initHistory() { past.length = 0; future.length = 0; baseline = snap(); }
export function recordHistory() {
  past.push(baseline);
  if (past.length > MAX) past.shift();
  baseline = snap();
  future.length = 0;
}
export function canUndo() { return past.length > 0; }
export function canRedo() { return future.length > 0; }

function sameState(a, b) {
  return JSON.stringify({ ...a, version: 0 }) === JSON.stringify({ ...b, version: 0 });
}
function apply(target) {
  const tgt = new Map(target.map((e) => [e.id, e]));
  for (const id of [...plan.elements.keys()]) {
    if (!tgt.has(id)) { markDelete(plan.elements.get(id)); plan.elements.delete(id); }
  }
  for (const t of target) {
    const cur = plan.elements.get(t.id);
    if (cur && sameState(cur, t)) continue;
    const r = clone(t);
    r.version = cur ? cur.version : (t.version || 0); // garder la version serveur connue
    plan.elements.set(t.id, r);
    markUpsert(r);
  }
  plan.sel = new Set([...plan.sel].filter((id) => plan.elements.has(id)));
}
export function undo() {
  if (!past.length) return false;
  future.push(baseline);
  apply(past.pop());
  baseline = snap();
  return true;
}
export function redo() {
  if (!future.length) return false;
  past.push(baseline);
  apply(future.pop());
  baseline = snap();
  return true;
}
