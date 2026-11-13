// Petites files persistantes (IndexedDB) pour les saisies hors-ligne du jour J.
//  - entrees_queue   : entrées visiteurs (clé = id de l'entrée)
//  - presences_queue : pointages bénévoles (clé = "<benevole_edition_id>|<jour>",
//                      le dernier pointage d'une personne pour un jour remplace le précédent)
const DB = "planfest", VERSION = 2;
const STORES = { entrees_queue: "id", presences_queue: "key" };

let dbPromise = null;
function open() {
  if (!dbPromise) {
    dbPromise = new Promise((res, rej) => {
      const r = indexedDB.open(DB, VERSION);
      r.onupgradeneeded = () => {
        for (const [name, keyPath] of Object.entries(STORES)) {
          if (!r.result.objectStoreNames.contains(name)) r.result.createObjectStore(name, { keyPath });
        }
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => { dbPromise = null; rej(r.error); };
    });
  }
  return dbPromise;
}
function tx(db, store, mode, fn) {
  return new Promise((res, rej) => {
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));
    t.oncomplete = () => res(req && req.result);
    t.onerror = () => rej(t.error);
  });
}
function file(store) {
  return {
    add: async (item) => tx(await open(), store, "readwrite", (s) => s.put(item)),
    all: async () => tx(await open(), store, "readonly", (s) => s.getAll()),
    del: async (key) => tx(await open(), store, "readwrite", (s) => s.delete(key)),
  };
}

const entrees = file("entrees_queue");
export const qAdd = entrees.add, qAll = entrees.all, qDel = entrees.del;

export const presencesQueue = file("presences_queue");
