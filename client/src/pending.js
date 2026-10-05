// Durable storage for edits that the server has not confirmed yet.
//
// Every unconfirmed edit is written to IndexedDB (a few hundred ms after typing
// stops, and immediately when the page is hidden or the editor loses focus), so a
// dropped connection, a discarded tab or a browser restart does not lose text.
// A record is deleted only after the server confirmed that exact content.
//
// Record: { noteId, doc, tags[], date, kind, baseRevision, unknownOps[], isNew, seq, updatedAt }

const DB_NAME = 'personal-hq';
const STORE = 'pending';

let dbPromise = null;
let unavailable = null;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in globalThis)) return reject(new Error('IndexedDB is not available in this browser'));
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'noteId' });
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    req.onerror = () => reject(req.error ?? new Error('Could not open local storage'));
    req.onblocked = () => reject(new Error('Local storage is blocked by another tab'));
  }).catch((err) => {
    unavailable = err;
    dbPromise = null; // allow a later retry
    throw err;
  });
  return dbPromise;
}

async function run(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const store = tx.objectStore(STORE);
    let result;
    try {
      result = fn(store);
    } catch (err) {
      reject(err);
      return;
    }
    // Resolve only when the transaction is durably committed.
    tx.oncomplete = () => resolve(result?.result ?? undefined);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('Local write aborted'));
  });
}

export const pendingStore = {
  put: (record) => run('readwrite', (s) => s.put(record)),
  delete: (noteId) => run('readwrite', (s) => s.delete(noteId)),
  async getAll() {
    const db = await open();
    return new Promise((resolve, reject) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  },
  // Delete only if the stored record is still the one we just got confirmed.
  async deleteIfSeq(noteId, seq) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      const get = store.get(noteId);
      get.onsuccess = () => {
        if (get.result && get.result.seq <= seq) store.delete(noteId);
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  },
  get unavailableReason() {
    return unavailable;
  },
  probe: () => open().then(() => true).catch(() => false),
};
