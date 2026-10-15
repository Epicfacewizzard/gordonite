// Things shared to Gordonite from another app (see docs/ANDROID-APP.md).
//
// The service worker (client/sw.js) receives a share and keeps it in this browser's storage: { id, at, title, text,
// url, files[] }. The share page (views/Share.jsx) then makes it a new free note: the text and link as paragraphs,
// each file uploaded and added as an attachment block. The kept share is deleted only once the note is held on the
// phone like any typed note, so a share made with the server out of reach waits here instead of being lost.

const DB_NAME = 'gordonite-share'; // the same names as in client/sw.js
const STORE = 'shares';

function open() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in globalThis)) return reject(new Error('This browser has no local storage for shares'));
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
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

export const shareStore = {
  get: (id) => run('readonly', (s) => s.get(id)),
  /** Every waiting share, oldest first. */
  all: async () => ((await run('readonly', (s) => s.getAll())) ?? []).sort((a, b) => String(a.id).localeCompare(String(b.id))),
  delete: (id) => run('readwrite', (s) => s.delete(id)),
};

const paragraph = (text) => ({ type: 'paragraph', content: text ? [{ type: 'text', text }] : undefined });

/**
 * The note a share becomes: { title, doc }. Apps fill title/text/url differently (Chrome puts a page's address in
 * `text`, some apps put the title in `text` too), so a line that repeats the title or the link is left out.
 * `attachments` are files already stored on the server ({ id, name, mime, size }).
 */
export function shareToNote({ title = '', text = '', url = '' } = {}, attachments = []) {
  const name = title.trim().slice(0, 120);
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  while (lines.length && !lines[0]) lines.shift();
  while (lines.length && !lines.at(-1)) lines.pop();
  if (name && lines.length === 1 && lines[0] === name) lines.length = 0;
  const link = url.trim();
  if (link && !lines.some((l) => l.includes(link))) lines.push(link);
  const content = [
    ...lines.map((l) => paragraph(l)),
    ...attachments.map((a) => ({ type: 'attachment', attrs: { id: a.id, name: a.name, mime: a.mime, size: a.size } })),
  ];
  content.push(paragraph('')); // a line below to keep writing on
  return { title: name || null, doc: { type: 'doc', content } };
}

/** Is there anything in this share? */
export const shareIsEmpty = (share) => !share || (!share.title?.trim() && !share.text?.trim() && !share.url?.trim() && !(share.files?.length > 0));
