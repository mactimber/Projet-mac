// Stockage local des chantiers (IndexedDB) — les données restent sur l'appareil.

const DB_NAME = 'releve-forestier-vd';
const DB_VERSION = 1;
const STORE = 'chantiers';

let dbPromise;

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

async function tx(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const store = t.objectStore(STORE);
    const req = fn(store);
    t.oncomplete = () => resolve(req && req.result);
    t.onerror = () => reject(t.error);
  });
}

export const db = {
  list: () => tx('readonly', (s) => s.getAll()),
  get: (id) => tx('readonly', (s) => s.get(id)),
  put: (chantier) => tx('readwrite', (s) => s.put(chantier)),
  remove: (id) => tx('readwrite', (s) => s.delete(id)),
};

export function uid() {
  return (crypto.randomUUID && crypto.randomUUID()) || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function newChantier(name = 'Nouveau chantier') {
  const now = new Date().toISOString();
  return {
    id: uid(),
    version: 2,
    created: now,
    updated: now,
    info: { name, date: now.slice(0, 10) },
    parcel: null, // [[lat, lng], ...]
    symbols: [], // { id, kind, lat, lng, lat2?, lng2?, text?, manual? }
    view: null,
  };
}
