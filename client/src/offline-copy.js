// This phone's copy of what the server last said (see docs/OFFLINE.md).
//
// Answers to the reads that screens are built from (notes, a tag's stream, tags, tasks, settings, moods) are kept
// in IndexedDB. When the server cannot be reached, or is slow to answer, api.js answers from this copy instead and
// marks the answer `fromPhoneCopy` (the time it was kept). It is only ever a copy for reading: what is written
// offline goes through the save queue (pending.js) like always, and every save is checked against the note's
// revision on the server, so an old copy can cause a visible conflict but never a silent overwrite.
//
// Record: { key, json, at } where key is the request path (e.g. "/api/notes/<id>").

const DB_NAME = 'gordonite-copy';
const STORE = 'responses';

/** The key a GET is kept under, or null for reads that are not kept (files, history, backups, login, …). */
export function copyKey(path) {
  const [p, q = ''] = path.split('?');
  const params = new URLSearchParams(q);
  if (p === '/api/config' || p === '/api/tags' || p === '/api/tasks' || p === '/api/moods' || p === '/api/skin' || p === '/api/habits' || p === '/api/people' || p === '/api/projects') return path;
  if (p === '/api/notes') return path; // a list (a search, a tag, a page)
  if (/^\/api\/notes\/[^/]+$/.test(p)) return p;
  if (p === '/api/stream' && params.get('tag') && !params.get('before')) return path; // the first page of a stream
  return null;
}

function open() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in globalThis)) return reject(new Error('No local storage'));
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'key' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Could not open local storage'));
  });
}

async function run(mode, fn) {
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req?.result);
      tx.onerror = tx.onabort = () => reject(tx.error ?? new Error('Local storage failed'));
    });
  } finally {
    db.close();
  }
}

// A copy is a convenience: if the phone cannot store or read it, the app behaves as it did before (it asks the server).
export const offlineCopy = {
  keep: (key, json) => run('readwrite', (s) => s.put({ key, json, at: new Date().toISOString() })).catch(() => {}),
  recall: (key) => run('readonly', (s) => s.get(key)).catch(() => null),
  count: () => run('readonly', (s) => s.count()).catch(() => 0),
  forget: () => run('readwrite', (s) => s.clear()).catch(() => {}),
  /** Drop answers not refreshed for this many days (old searches, notes no longer looked at). */
  prune: (days) =>
    run('readwrite', (s) => {
      const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
      const req = s.openCursor();
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) return;
        if (cursor.value.at < cutoff) cursor.delete();
        cursor.continue();
      };
    }).catch(() => {}),
};
