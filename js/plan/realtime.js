// Synchronisation temps réel du plan (§9). Écoute elements + salles de l'édition
// et applique les changements venus des autres éditeurs. Ignore nos propres écritures
// (élément en file d'autosave, ou version reçue ≤ version locale = écho).
import { supa } from "../supabase.js";
import { plan } from "./model.js";
import { isDirty } from "./autosave.js";

let channel = null;

export function stopRealtime() {
  if (channel) { supa.removeChannel(channel); channel = null; }
}

export function startRealtime(onChange) {
  stopRealtime();
  const ed = plan.edition;
  channel = supa.channel("plan-" + ed)
    .on("postgres_changes", { event: "*", schema: "public", table: "elements", filter: `edition_id=eq.${ed}` },
      (p) => { if (applyElement(p)) onChange(); })
    .on("postgres_changes", { event: "*", schema: "public", table: "salles", filter: `edition_id=eq.${ed}` },
      (p) => { if (applySalle(p)) onChange(); })
    .subscribe();
}

function applyElement(p) {
  if (p.eventType === "DELETE") {
    const id = p.old?.id;
    if (!id || isDirty(id) || !plan.elements.has(id)) return false;
    plan.elements.delete(id); plan.sel.delete(id); return true;
  }
  const row = p.new;
  if (!row || isDirty(row.id)) return false;
  const cur = plan.elements.get(row.id);
  if (cur && (row.version ?? 0) <= (cur.version ?? 0)) return false; // écho ou périmé
  plan.elements.set(row.id, row); return true;
}

function applySalle(p) {
  if (p.eventType === "DELETE") {
    const id = p.old?.id;
    const i = id ? plan.salles.findIndex((s) => s.id === id) : -1;
    if (i < 0) return false;
    plan.salles.splice(i, 1); return true;
  }
  const row = p.new; if (!row) return false;
  const i = plan.salles.findIndex((s) => s.id === row.id);
  if (i < 0) plan.salles.push(row); else plan.salles[i] = row;
  return true;
}
