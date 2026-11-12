// Enregistrement automatique du plan (§9) : regroupe les éléments touchés
// et les envoie à enregistrer_plan après un court délai, avec contrôle de version.
import { supa } from "../supabase.js";
import { plan, reloadElements } from "./model.js";

let dirty = new Map();   // id -> element à écrire
let deletes = new Map(); // id -> version connue
let timer = null;
let statusCb = () => {};
let reloadCb = () => {};

export function onStatus(cb) { statusCb = cb; }
export function onReload(cb) { reloadCb = cb; }

// Vrai si l'élément a une modification locale non encore confirmée (filtre les échos temps réel).
export function isDirty(id) { return dirty.has(id) || deletes.has(id); }

export function markUpsert(el) { dirty.set(el.id, el); deletes.delete(el.id); schedule(); }
export function markDelete(el) { deletes.set(el.id, el.version || 0); dirty.delete(el.id); schedule(); }

function schedule() { statusCb("pending"); clearTimeout(timer); timer = setTimeout(flush, 2000); }

function serialize(e) {
  return {
    id: e.id, salle_id: e.salle_id, kind: e.kind, x: e.x, y: e.y, w: e.w, h: e.h,
    numero: e.numero ?? null, type_table: e.type_table ?? null,
    organisme_edition_id: e.organisme_edition_id ?? null,
    chaises: e.chaises ?? 0, mode: e.mode ?? "animee", zone: e.zone ?? null,
    categorie_id: e.categorie_id ?? null, sous: e.sous ?? null, label: e.label ?? null,
    assigne: e.assigne ?? null, etat_terrain: e.etat_terrain ?? "a_installer",
    notes: e.notes ?? null, version: e.version || 0,
  };
}

export async function flush() {
  if (!dirty.size && !deletes.size) return;
  const upserts = [...dirty.values()].map(serialize);
  const suppressions = [...deletes.entries()].map(([id, version]) => ({ id, version }));
  const pending = { up: [...dirty.values()], del: new Map(deletes) };
  dirty = new Map();
  deletes = new Map();
  statusCb("sync");
  const { data, error } = await supa.rpc("enregistrer_plan", {
    p_edition: plan.edition, p_upserts: upserts, p_suppressions: suppressions,
  });
  if (error) {
    // Remettre en file pour réessayer à la prochaine modification.
    pending.up.forEach((e) => dirty.set(e.id, e));
    pending.del.forEach((v, id) => deletes.set(id, v));
    statusCb("err");
    return;
  }
  (data?.versions ?? []).forEach((v) => {
    const el = plan.elements.get(v.id);
    if (el) el.version = v.version;
  });
  if (data?.conflits?.length) {
    // Un autre éditeur a touché ces éléments entre-temps : on reprend la version serveur.
    try { await reloadElements(data.conflits.map((c) => c.id)); } catch (_) { /* on retentera */ }
    statusCb("conflict");
    reloadCb();
  } else statusCb("saved");
}

// Vide la file en forçant l'envoi (ex. page en arrière-plan).
export function flushNow() { clearTimeout(timer); return flush(); }
