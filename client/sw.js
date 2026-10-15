// The service worker (see docs/ANDROID-APP.md). It is only registered on HTTPS (or localhost) in a built app.
//
// 1. Keeps a copy of the app itself (the page, scripts, styles, icons) so it opens with no connection, e.g. with
//    WireGuard off. The list of files is written in at build time (client/sw-build.js), so every build is a new
//    service worker: the browser installs it in the background, it copies the new files, then drops the old copy.
//    The page is asked from the server first and the copy is used only when the server does not answer in time.
// 2. Receives what is shared to Gordonite from another app (Android's share menu; the manifest's share_target).
//    The share is kept in this browser's storage first and the app then turns it into a note (client/src/share.js),
//    so nothing shared is lost when the server cannot be reached.
//
// Never touches /api/: notes, saving and files always go to the server, exactly as without a service worker.

const PRECACHE = self.__GORDONITE_PRECACHE__; // { name, files: ['/', '/assets/…', …] }
const PAGE_TIMEOUT_MS = 3000;

// The same database and store as client/src/share.js reads.
const SHARE_DB = 'gordonite-share';
const SHARE_STORE = 'shares';

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(PRECACHE.name);
      await cache.addAll(PRECACHE.files.map((url) => new Request(url, { cache: 'reload' })));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key.startsWith('gordonite-') && key !== PRECACHE.name) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  if (request.method === 'POST' && url.pathname === '/share-target') return event.respondWith(receiveShare(request));
  if (request.method !== 'GET') return;
  if (request.mode === 'navigate') return event.respondWith(page(request));
  event.respondWith(caches.match(url.pathname).then((hit) => hit ?? fetch(request)));
});

// The page: the server's, unless it does not answer in time (VPN off, no signal); then the copy.
async function page(request) {
  const fromServer = fetch(request);
  fromServer.catch(() => {}); // it may fail after the copy was already used
  const timeout = new Promise((resolve) => setTimeout(resolve, PAGE_TIMEOUT_MS, null));
  try {
    const res = await Promise.race([fromServer, timeout]);
    if (res && res.status < 500) return res;
  } catch {
    /* unreachable: use the copy */
  }
  const copy = await caches.match('/');
  return copy ?? fromServer;
}

async function receiveShare(request) {
  let id = '';
  try {
    const form = await request.formData();
    const text = (name) => String(form.get(name) ?? '').trim();
    const files = form.getAll('files').filter((f) => typeof f === 'object' && f.size > 0);
    id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await saveShare({ id, at: new Date().toISOString(), title: text('title'), text: text('text'), url: text('url'), files });
  } catch {
    id = 'failed';
  }
  return Response.redirect(`/#/share/${id}`, 303);
}

function saveShare(record) {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(SHARE_DB, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(SHARE_STORE, { keyPath: 'id' });
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction(SHARE_STORE, 'readwrite');
      tx.objectStore(SHARE_STORE).put(record);
      tx.oncomplete = () => (db.close(), resolve());
      tx.onerror = tx.onabort = () => (db.close(), reject(tx.error));
    };
  });
}
