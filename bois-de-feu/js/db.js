// Stockage local (IndexedDB) — les données restent sur l'appareil.

const DB_NAME = 'bois-de-feu';
const DB_VERSION = 1;
const STORES = { lots: 'id', mouvements: 'id', commandes: 'id', photos: 'id', kv: 'key' };

let dbPromise;

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const d = req.result;
        for (const [name, keyPath] of Object.entries(STORES)) {
          if (!d.objectStoreNames.contains(name)) d.createObjectStore(name, { keyPath });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

async function run(store, mode, fn) {
  const d = await open();
  return new Promise((resolve, reject) => {
    const t = d.transaction(store, mode);
    const req = fn(t.objectStore(store));
    t.oncomplete = () => resolve(req && req.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export const db = {
  all: (s) => run(s, 'readonly', (x) => x.getAll()),
  keys: (s) => run(s, 'readonly', (x) => x.getAllKeys()),
  get: (s, id) => run(s, 'readonly', (x) => x.get(id)),
  put: (s, v) => run(s, 'readwrite', (x) => x.put(v)),
  del: (s, id) => run(s, 'readwrite', (x) => x.delete(id)),
  clear: (s) => run(s, 'readwrite', (x) => x.clear()),
};

export const STORE_NAMES = Object.keys(STORES);

export function uid() {
  return (crypto.randomUUID && crypto.randomUUID()) || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
