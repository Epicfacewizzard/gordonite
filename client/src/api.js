// Thin fetch wrapper. The important distinction for saving is:
//   NetworkError - the request may or may not have reached the server (offline,
//                  timeout, VPN dropped). The outcome is unknown, so we keep the data and retry.
//
// Reads that screens are built from are also kept on the phone and answered from that copy when the server is out of
// reach (offline-copy.js); every request tells connection.js whether the server answered.
import { connection } from './connection.js';
import { copyKey, offlineCopy } from './offline-copy.js';

//   ApiError     - the server answered with an error status.
export class NetworkError extends Error {
  constructor(message) {
    super(message);
    this.name = 'NetworkError';
  }
}

export class ApiError extends Error {
  constructor(status, code, message, body) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

const TIMEOUT_MS = 15_000;
// A read the phone has a copy of waits this long for the server, then shows the copy (VPN off on mobile data
// does not fail fast: the request just hangs). Once the server is known to be out of reach, the copy is shown at
// once. Either way the request carries on: its answer replaces the copy and tells connection.js the server is back.
const COPY_AFTER_MS = 1000;

async function request(method, path, body, options = {}) {
  const key = method === 'GET' ? copyKey(path) : null;
  if (!key) return send(method, path, body, options);
  const live = send(method, path, body, options).then((json) => {
    offlineCopy.keep(key, json);
    return json;
  });
  const fromCopy = async () => {
    const copy = await offlineCopy.recall(key);
    return copy ? { ...copy.json, fromPhoneCopy: copy.at } : null;
  };
  let timer;
  const wait = connection.reachable === false ? 0 : COPY_AFTER_MS;
  const slow = new Promise((resolve) => (timer = setTimeout(resolve, wait, SLOW)));
  try {
    const first = await Promise.race([live, slow]);
    if (first !== SLOW) return first;
    const copy = await fromCopy();
    // No copy: wait for the server, unless it is (or becomes) known to be out of reach; then say so now instead of
    // after the full timeout, so a screen can offer what works offline (today's note is started on the phone).
    if (!copy) return await Promise.race([live, connection.whenUnreachable().then(() => Promise.reject(new NetworkError('Cannot reach the server')))]);
    live.catch(() => {}); // it may still fail after the copy was shown
    connection.unanswered(); // too slow to wait for: treat it as out of reach until it answers
    return copy;
  } catch (err) {
    const copy = err instanceof NetworkError ? await fromCopy() : null;
    if (copy) return copy;
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
const SLOW = Symbol('slow');

async function send(method, path, body, { timeout = TIMEOUT_MS } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  let res;
  try {
    res = await fetch(path, {
      method,
      headers: method === 'GET' ? undefined : { 'content-type': 'application/json' },
      body: method === 'GET' || method === 'DELETE' ? undefined : JSON.stringify(body ?? {}),
      signal: ctrl.signal,
      cache: 'no-store',
    });
  } catch (err) {
    connection.unanswered();
    throw new NetworkError(ctrl.signal.aborted ? 'Request timed out' : 'Cannot reach the server');
  } finally {
    clearTimeout(timer);
  }
  connection.answered();
  const result = await readJson(res);
  if (method !== 'GET' && changesWhichNotesExist(method, path)) announceChange();
  return result;
}

// A note deleted, restored or changed in its tags or history, a tag moved, an import: the task list on screen may now
// be wrong in a way no open note can tell it. Saving a note's text is not one (the note's own copy covers it).
const changesWhichNotesExist = (method, path) => /^\/api\/(notes|tags\/move|import)(\/|\?|$)/.test(path) && !(method === 'PUT' && /^\/api\/notes\/[^/?]+$/.test(path));
function announceChange() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('hq-data-changed'));
}

async function readJson(res) {
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* empty or non-JSON body */
  }
  if (!res.ok) {
    // A password is set and this browser is not (or no longer) logged in: the app shows the login page.
    if (json?.error?.code === 'login_required') {
      offlineCopy.forget(); // locked: the phone keeps nothing to read without logging in
      if (typeof window !== 'undefined') window.dispatchEvent(new Event('hq-login-required'));
    }
    throw new ApiError(res.status, json?.error?.code ?? json?.reason ?? `http_${res.status}`, json?.error?.message ?? `Server error ${res.status}`, json);
  }
  return json;
}

// Send a file's bytes as they are. The header is what the server requires in place of a JSON body (a page on
// another site cannot send it). A large file or a slow link can take a while, so there is a long timeout.
async function upload(file, { noteId, timeout = 10 * 60_000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  let res;
  try {
    const query = `name=${encodeURIComponent(file.name || 'file')}${noteId ? `&noteId=${encodeURIComponent(noteId)}` : ''}`;
    res = await fetch(`/api/attachments?${query}`, {
      method: 'POST',
      headers: { 'content-type': file.type || 'application/octet-stream', 'x-gordonite-upload': '1' },
      body: file,
      signal: ctrl.signal,
      cache: 'no-store',
    });
  } catch {
    if (!ctrl.signal.aborted) connection.unanswered();
    throw new NetworkError(ctrl.signal.aborted ? 'The upload timed out' : 'Cannot reach the server');
  } finally {
    clearTimeout(timer);
  }
  connection.answered();
  return readJson(res);
}

const enc = encodeURIComponent;

export const api = {
  auth: () => request('GET', '/api/auth'),
  login: (password) => request('POST', '/api/auth/login', { password }),
  logout: () => request('POST', '/api/auth/logout', {}).then((r) => (offlineCopy.forget(), r)),
  setPassword: (password, current) => request('PUT', '/api/auth/password', { password, current }),
  passwordOff: (current) => request('POST', '/api/auth/off', { current }),
  config: () => request('GET', '/api/config'),
  resolveLink: (target) => request('GET', `/api/note-links?target=${enc(target)}`),
  tags: () => request('GET', '/api/tags'),
  createTag: (path) => request('POST', '/api/tags', { path }),
  setDaily: (tagId, daily) => request('PUT', `/api/tags/${enc(tagId)}/daily`, { daily }),
  setFavorite: (tagId, favorite) => request('PUT', `/api/tags/${enc(tagId)}/favorite`, { favorite }),
  moveTag: (from, into, order) => request('POST', '/api/tags/move', { from, into, order }),
  setSettings: (settings) => request('PUT', '/api/settings', settings),
  tasks: () => request('GET', '/api/tasks'),
  moods: (from, to) => request('GET', `/api/moods${from ? `?from=${from}&to=${to}` : ''}`),
  saveMood: (id, body) => request('PUT', `/api/moods/${enc(id)}`, body),
  deleteMood: (id) => request('DELETE', `/api/moods/${enc(id)}`),
  restoreMood: (id) => request('POST', `/api/moods/${enc(id)}/restore`, {}),
  skinEntries: () => request('GET', '/api/skin'),
  saveSkin: (id, body) => request('PUT', `/api/skin/${enc(id)}`, body),
  deleteSkin: (id) => request('DELETE', `/api/skin/${enc(id)}`),
  habits: (from, to) => request('GET', `/api/habits?from=${from}&to=${to}`),
  saveHabit: (id, body) => request('PUT', `/api/habits/${enc(id)}`, body),
  deleteHabit: (id) => request('DELETE', `/api/habits/${enc(id)}`),
  checkHabit: (id, date, entry = {}) => request('PUT', `/api/habits/${enc(id)}/checks/${date}`, entry),
  uncheckHabit: (id, date) => request('DELETE', `/api/habits/${enc(id)}/checks/${date}`),
  people: () => request('GET', '/api/people'),
  savePerson: (noteId, profile) => request('PUT', `/api/people/${enc(noteId)}`, { profile }),
  projects: () => request('GET', '/api/projects'),
  createProject: (body) => request('POST', '/api/projects', body),
  saveProject: (id, body) => request('PUT', `/api/projects/${enc(id)}`, body),
  removeProject: (id) => request('DELETE', `/api/projects/${enc(id)}`),
  restoreProject: (id) => request('POST', `/api/projects/${enc(id)}/restore`, {}),
  addNotesToProject: (id, noteIds) => request('POST', `/api/projects/${enc(id)}/notes`, { noteIds }),
  setAreaFolders: (folders) => request('PUT', '/api/projects/folders', folders),
  notes: (params = {}) => {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '' && v !== false).map(([k, v]) => [k, v === true ? '1' : String(v)]));
    return request('GET', `/api/notes?${qs}`);
  },
  stream: (tag, before) => request('GET', `/api/stream?tag=${enc(tag)}${before ? `&before=${before}` : ''}`),
  saveNote: (id, body) => request('PUT', `/api/notes/${enc(id)}`, body, { timeout: 20_000 }),
  getNote: (id) => request('GET', `/api/notes/${enc(id)}`),
  deleteNote: (id) => request('DELETE', `/api/notes/${enc(id)}`),
  restoreNote: (id, dropConflictingTags = false) =>
    request('POST', `/api/notes/${enc(id)}/restore${dropConflictingTags ? '?dropConflictingTags=1' : ''}`),
  addTag: (id, path) => request('POST', `/api/notes/${enc(id)}/tags`, { path }),
  removeTag: (id, tagId) => request('DELETE', `/api/notes/${enc(id)}/tags/${enc(tagId)}`),
  versions: (id) => request('GET', `/api/notes/${enc(id)}/versions`),
  version: (id, vid) => request('GET', `/api/notes/${enc(id)}/versions/${enc(vid)}`),
  restoreVersion: (id, vid) => request('POST', `/api/notes/${enc(id)}/versions/${enc(vid)}/restore`),
  trash: () => request('GET', '/api/trash'),
  backups: () => request('GET', '/api/backups'),
  backupNow: () => request('POST', '/api/backups', {}, { timeout: 120_000 }),
  uploadFile: (file, options) => upload(file, options),
  files: (params = {}) => {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '' && v !== false).map(([k, v]) => [k, v === true ? '1' : String(v)]));
    return request('GET', `/api/attachments?${qs}`);
  },
  deleteFile: (id) => request('DELETE', `/api/attachments/${enc(id)}`),
  restoreFile: (id) => request('POST', `/api/attachments/${enc(id)}/restore`, {}),
  importAll: (data, mode) => request('POST', `/api/import?mode=${mode}`, data, { timeout: 300_000 }),
};
