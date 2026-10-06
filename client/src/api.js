// Thin fetch wrapper. The important distinction for saving is:
//   NetworkError - the request may or may not have reached the server (offline,
//                  timeout, VPN dropped). The outcome is unknown, so we keep the data and retry.
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

async function request(method, path, body, { timeout = TIMEOUT_MS } = {}) {
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
    throw new NetworkError(ctrl.signal.aborted ? 'Request timed out' : 'Cannot reach the server');
  } finally {
    clearTimeout(timer);
  }
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* empty or non-JSON body */
  }
  if (!res.ok) {
    throw new ApiError(res.status, json?.error?.code ?? json?.reason ?? `http_${res.status}`, json?.error?.message ?? `Server error ${res.status}`, json);
  }
  return json;
}

const enc = encodeURIComponent;

export const api = {
  config: () => request('GET', '/api/config'),
  resolveLink: (target) => request('GET', `/api/note-links?target=${enc(target)}`),
  tags: () => request('GET', '/api/tags'),
  createTag: (path) => request('POST', '/api/tags', { path }),
  setDaily: (tagId, daily) => request('PUT', `/api/tags/${enc(tagId)}/daily`, { daily }),
  setFavorite: (tagId, favorite) => request('PUT', `/api/tags/${enc(tagId)}/favorite`, { favorite }),
  setSettings: (settings) => request('PUT', '/api/settings', settings),
  tasks: () => request('GET', '/api/tasks'),
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
  importAll: (data, mode) => request('POST', `/api/import?mode=${mode}`, data, { timeout: 300_000 }),
};
