// Petite file persistante (IndexedDB) pour les saisies hors-ligne (entrées jour J).
const DB = "planfest", STORE = "entrees_queue";

function open() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => {
      if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE, { keyPath: "id" });
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
function tx(db, mode, fn) {
  return new Promise((res, rej) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => res(req && req.result);
    t.onerror = () => rej(t.error);
  });
}
export async function qAdd(item) { return tx(await open(), "readwrite", (s) => s.put(item)); }
export async function qAll() { return tx(await open(), "readonly", (s) => s.getAll()); }
export async function qDel(id) { return tx(await open(), "readwrite", (s) => s.delete(id)); }
