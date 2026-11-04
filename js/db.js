// Lokale Datenbank im Browser (IndexedDB). Alles bleibt auf dem Gerät.
const NAME = 'kalorien';
const VERSION = 1;
const STORES = {
  foods: { keyPath: 'id', index: [['barcode', 'barcode'], ['src', 'src']] },
  entries: { keyPath: 'id', index: [['date', 'date']] },
  weights: { keyPath: 'date' },
  settings: { keyPath: 'key' },
};

let dbp;
function open() {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    const r = indexedDB.open(NAME, VERSION);
    r.onupgradeneeded = () => {
      const db = r.result;
      for (const [name, def] of Object.entries(STORES)) {
        if (db.objectStoreNames.contains(name)) continue;
        const s = db.createObjectStore(name, { keyPath: def.keyPath });
        for (const [iname, path] of def.index || []) s.createIndex(iname, path);
      }
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}

const req = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

async function tx(store, mode, fn) {
  const db = await open();
  return new Promise((res, rej) => {
    const t = db.transaction(store, mode);
    let out;
    Promise.resolve(fn(t.objectStore(store))).then((v) => { out = v; });
    t.oncomplete = () => res(out);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
  });
}

export const db = {
  get: (store, key) => tx(store, 'readonly', (s) => req(s.get(key))),
  all: (store) => tx(store, 'readonly', (s) => req(s.getAll())),
  put: (store, val) => tx(store, 'readwrite', (s) => req(s.put(val))),
  del: (store, key) => tx(store, 'readwrite', (s) => req(s.delete(key))),
  byIndex: (store, index, value) => tx(store, 'readonly', (s) => req(s.index(index).getAll(value))),
  range: (store, index, lo, hi) => tx(store, 'readonly', (s) => req(s.index(index).getAll(IDBKeyRange.bound(lo, hi)))),
  clear: (store) => tx(store, 'readwrite', (s) => req(s.clear())),
  async putMany(store, vals) {
    return tx(store, 'readwrite', (s) => { vals.forEach((v) => s.put(v)); });
  },
};

export async function getSetting(key, fallback) {
  const r = await db.get('settings', key);
  return r ? r.value : fallback;
}
export const setSetting = (key, value) => db.put('settings', { key, value });

export async function exportAll() {
  const out = { app: 'kalorien-tracker', version: 1, exportedAt: new Date().toISOString() };
  for (const s of Object.keys(STORES)) out[s] = await db.all(s);
  return out;
}

export async function importAll(data) {
  if (!data || data.app !== 'kalorien-tracker') throw new Error('Das ist keine Sicherung dieser App.');
  for (const s of Object.keys(STORES)) {
    if (!Array.isArray(data[s])) continue;
    await db.clear(s);
    await db.putMany(s, data[s]);
  }
}

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
