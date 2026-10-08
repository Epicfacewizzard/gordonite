import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { Store, HttpError, checkId } from './store.js';
import { createBackup, backupPath, backupStatus } from './backup.js';
import { exportAll, exportMarkdownZip, importAll } from './portability.js';
import { addMood, listMoods, deleteMood } from './moods.js';
import { DOC_FORMAT } from '../shared/doc.js';
import { dateInTz, addDays } from '../shared/dates.js';

export const APP_VERSION = '0.3.2';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
};

function sendJson(res, status, body) {
  const data = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': data.length,
    'cache-control': 'no-store',
  });
  res.end(data);
}

function sendDownload(res, filename, type, data) {
  res.writeHead(200, {
    'content-type': type,
    'content-length': data.length,
    'content-disposition': `attachment; filename="${filename}"`,
    'cache-control': 'no-store',
  });
  res.end(data);
}

async function readBody(req, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, 'too_large', 'Request body too large');
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, 'bad_json', 'Body is not valid JSON');
  }
}

export function createApp({ config, db, log = console }) {
  const store = new Store(db, config);
  const routes = [];
  const route = (method, pattern, handler) => {
    const keys = [];
    const re = new RegExp(`^${pattern.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)'))}$`);
    routes.push({ method, re, keys, handler });
  };

  // The assistant's key. Off (404) unless ASSISTANT_TOKEN is set; compared as hashes so timing reveals nothing.
  const sha = (v) => crypto.createHash('sha256').update(v).digest();
  function requireAssistant(req) {
    if (!config.assistantToken) throw new HttpError(404, 'not_found', 'No such endpoint');
    const given = /^Bearer (.+)$/i.exec(req.headers.authorization ?? '')?.[1] ?? '';
    if (!crypto.timingSafeEqual(sha(given), sha(config.assistantToken))) throw new HttpError(401, 'unauthorized', 'Missing or wrong assistant key');
  }

  const fileStamp = () => new Date().toISOString().slice(0, 10);

  route('GET', '/api/health', async ({ res }) => {
    db.prepare('SELECT 1').get();
    sendJson(res, 200, { ok: true, version: APP_VERSION });
  });

  route('GET', '/api/config', async ({ res }) => {
    sendJson(res, 200, {
      version: APP_VERSION,
      tz: config.tz,
      today: dateInTz(new Date(), config.tz),
      docFormat: DOC_FORMAT,
      trashRetentionDays: config.trashRetentionDays,
      ...store.getSettings(),
    });
  });
  route('PUT', '/api/settings', async ({ res, body }) => {
    if (body.tz !== undefined) store.setTimeZone(body.tz);
    if (body.dailyTag !== undefined) store.setDailyTag(body.dailyTag);
    sendJson(res, 200, store.getSettings());
  });

  route('GET', '/api/note-links', async ({ res, query }) => {
    const target = (query.get('target') ?? '').trim();
    // Imported folder-qualified names match the leaf title. Show all matches rather
    // than guessing when names collide; navigation itself uses the stable note ID.
    const title = target.split('#')[0].split('/').at(-1).replace(/\.md$/i, '');
    const notes = db.prepare('SELECT id, title, note_date AS date FROM notes WHERE deleted_at IS NULL AND title = ? COLLATE NOCASE ORDER BY note_date DESC, id').all(title);
    sendJson(res, 200, { notes });
  });

  // ----- assistant (needs the ASSISTANT_TOKEN key; see docs/ASSISTANT.md) -----
  route('GET', '/api/assistant/ping', async ({ res }) => sendJson(res, 200, { ok: true, today: dateInTz(new Date(), config.tz), tz: config.tz }));
  route('GET', '/api/assistant/moods', async ({ res, query }) => {
    // ?days=N (default 14) counts back from today; ?from= and ?to= give exact days
    const days = Math.min(Math.max(Number(query.get('days')) || 14, 1), 400);
    const to = query.get('to') || dateInTz(new Date(), config.tz);
    sendJson(res, 200, listMoods(db, config, { from: query.get('from') || addDays(to, -(days - 1)), to }));
  });
  route('POST', '/api/assistant/moods', async ({ res, body }) => sendJson(res, 200, addMood(db, config, body)));
  route('GET', '/api/assistant/overview', async ({ res }) => sendJson(res, 200, store.assistantOverview()));
  route('GET', '/api/assistant/notes', async ({ res, query }) => {
    sendJson(res, 200, store.listNotes({ tag: query.get('tag'), sub: query.get('sub') === '1', untagged: query.get('untagged') === '1', q: query.get('q') ?? '', limit: query.get('limit'), offset: query.get('offset'), sort: query.get('sort') }));
  });
  route('GET', '/api/assistant/notes/:id', async ({ res, params }) => sendJson(res, 200, store.assistantGetNote(params.id)));
  route('POST', '/api/assistant/notes/:id/trash', async ({ res, params, body }) => {
    if (body.confirmed !== true) throw new HttpError(400, 'confirmation_required', 'Ask the user to confirm this specific note before moving it to Trash');
    const note = store.assistantGetNote(checkId(params.id));
    if (body.expectedRevision !== note.revision) throw new HttpError(409, 'revision_conflict', 'The note changed. Read it and ask for confirmation again');
    sendJson(res, 200, store.deleteNote(note.id));
  });
  route('POST', '/api/assistant/notes', async ({ res, body }) => sendJson(res, 200, store.assistantCreateNote(body)));
  route('POST', '/api/assistant/notes/:id/append', async ({ res, params, body }) => sendJson(res, 200, store.assistantAppend(params.id, body.markdown)));
  route('POST', '/api/assistant/notes/:id/replace-text', async ({ res, params, body }) => sendJson(res, 200, store.assistantReplaceText(params.id, body)));
  route('POST', '/api/assistant/notes/:id/replace-section', async ({ res, params, body }) => sendJson(res, 200, store.assistantReplaceSection(params.id, body)));
  route('POST', '/api/assistant/daily/append', async ({ res, body }) => sendJson(res, 200, store.assistantAppendDaily(body)));
  route('POST', '/api/assistant/notes/:id/tasks/:taskId', async ({ res, params, body }) => {
    sendJson(res, 200, store.assistantUpdateTask(params.id, params.taskId, body));
  });

  // ----- mood entries (see docs/MOOD.md) -----
  route('GET', '/api/moods', async ({ res, query }) => sendJson(res, 200, listMoods(db, config, { from: query.get('from'), to: query.get('to') })));
  route('PUT', '/api/moods/:id', async ({ res, params, body }) => sendJson(res, 200, addMood(db, config, body, params.id)));
  route('DELETE', '/api/moods/:id', async ({ res, params }) => sendJson(res, 200, deleteMood(db, params.id)));

  // ----- tags & streams -----
  route('GET', '/api/tags', async ({ res }) => sendJson(res, 200, { tags: store.listTags(), order: store.getTagOrder() }));
  route('POST', '/api/tags', async ({ res, body }) => sendJson(res, 200, { tag: store.createTag(body.path) }));
  route('POST', '/api/tags/move', async ({ res, body }) => sendJson(res, 200, store.moveTag(body)));
  route('PUT', '/api/tags/:id/daily', async ({ res, params, body }) => {
    sendJson(res, 200, store.setTagDaily(checkId(params.id, 'tag id'), body.daily));
  });
  route('PUT', '/api/tags/:id/favorite', async ({ res, params, body }) => {
    sendJson(res, 200, store.setTagFavorite(checkId(params.id, 'tag id'), body.favorite));
  });
  route('GET', '/api/stream', async ({ res, query }) => {
    sendJson(res, 200, store.stream(query.get('tag') ?? '', { before: query.get('before'), limit: query.get('limit') }));
  });

  route('GET', '/api/tasks', async ({ res }) => sendJson(res, 200, { tasks: store.listTasks() }));

  // ----- notes -----
  route('GET', '/api/notes', async ({ res, query }) => {
    sendJson(
      res,
      200,
      store.listNotes({
        tag: query.get('tag'),
        sub: query.get('sub') === '1',
        untagged: query.get('untagged') === '1',
        q: query.get('q') ?? '',
        limit: query.get('limit'),
        offset: query.get('offset'),
        sort: query.get('sort'),
      }),
    );
  });
  route('GET', '/api/notes/:id', async ({ res, params }) => {
    const note = store.getNote(checkId(params.id));
    if (!note) throw new HttpError(404, 'not_found', 'Note not found');
    sendJson(res, 200, { note });
  });
  route('PUT', '/api/notes/:id', async ({ res, params, body }) => {
    const result = store.saveNote(params.id, body);
    sendJson(res, result.status === 'ok' ? 200 : 409, result);
  });
  route('DELETE', '/api/notes/:id', async ({ res, params }) => sendJson(res, 200, store.deleteNote(checkId(params.id))));
  route('POST', '/api/notes/:id/restore', async ({ res, params, query }) => {
    sendJson(res, 200, store.restoreNote(checkId(params.id), { dropConflictingTags: query.get('dropConflictingTags') === '1' }));
  });
  route('POST', '/api/notes/:id/tags', async ({ res, params, body }) => {
    sendJson(res, 200, { tags: store.addTagToNote(checkId(params.id), body.path) });
  });
  route('DELETE', '/api/notes/:id/tags/:tagId', async ({ res, params }) => {
    sendJson(res, 200, { tags: store.removeTagFromNote(checkId(params.id), checkId(params.tagId, 'tag id')) });
  });
  route('GET', '/api/notes/:id/versions', async ({ res, params }) => {
    sendJson(res, 200, { versions: store.listVersions(checkId(params.id)) });
  });
  route('GET', '/api/notes/:id/versions/:vid', async ({ res, params }) => {
    sendJson(res, 200, { version: store.getVersion(checkId(params.id), checkId(params.vid, 'version id')) });
  });
  route('POST', '/api/notes/:id/versions/:vid/restore', async ({ res, params }) => {
    sendJson(res, 200, { note: store.restoreVersion(checkId(params.id), checkId(params.vid, 'version id')) });
  });
  route('GET', '/api/trash', async ({ res }) => sendJson(res, 200, { notes: store.listTrash() }));

  // ----- export / import -----
  route('GET', '/api/export/json', async ({ res }) => {
    sendDownload(res, `personal-hq-export-${fileStamp()}.json`, 'application/json', Buffer.from(JSON.stringify(exportAll(db, config), null, 1)));
  });
  route('GET', '/api/export/markdown', async ({ res }) => {
    sendDownload(res, `personal-hq-markdown-${fileStamp()}.zip`, 'application/zip', exportMarkdownZip(store, db));
  });
  route('POST', '/api/import', async ({ res, query, body }) => {
    sendJson(res, 200, importAll(db, config, body, query.get('mode') ?? 'merge'));
  });

  // ----- backups -----
  route('GET', '/api/backups', async ({ res }) => sendJson(res, 200, backupStatus(config)));
  route('POST', '/api/backups', async ({ res }) => sendJson(res, 200, createBackup(db, config, 'manual')));
  // A fresh consistent snapshot streamed straight to the client; nothing is kept on the server.
  route('GET', '/api/backups/snapshot', async ({ res }) => {
    const tmp = path.join(os.tmpdir(), `hq-snapshot-${process.pid}-${Date.now()}.sqlite`);
    try {
      db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
      sendDownload(res, `personal-hq-${fileStamp()}.sqlite`, 'application/vnd.sqlite3', fs.readFileSync(tmp));
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  });
  route('GET', '/api/backups/file/:name', async ({ res, params }) => {
    const p = backupPath(config, params.name);
    if (!p) throw new HttpError(404, 'not_found', 'No such backup');
    sendDownload(res, params.name, 'application/vnd.sqlite3', fs.readFileSync(p));
  });

  // ----- static client -----
  const gzCache = new Map();
  function serveStatic(req, res, pathname) {
    let rel = decodeURIComponent(pathname);
    if (rel.endsWith('/')) rel += 'index.html';
    let file = path.join(config.staticDir, rel);
    if (!file.startsWith(config.staticDir + path.sep) && file !== config.staticDir) {
      return sendJson(res, 400, { error: { code: 'bad_path', message: 'Bad path' } });
    }
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      if (path.extname(rel)) return sendJson(res, 404, { error: { code: 'not_found', message: 'Not found' } });
      file = path.join(config.staticDir, 'index.html'); // client-side routes
      if (!fs.existsSync(file)) {
        res.writeHead(503, { 'content-type': 'text/plain' });
        return res.end('Client not built. Run "npm run build" (or use "npm run dev").');
      }
    }
    const ext = path.extname(file);
    const st = fs.statSync(file);
    const headers = {
      'content-type': MIME[ext] ?? 'application/octet-stream',
      'cache-control': file.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache',
    };
    let data = fs.readFileSync(file);
    if (/\bgzip\b/.test(req.headers['accept-encoding'] ?? '') && data.length > 1024 && /\.(html|js|css|json|svg)$/.test(ext)) {
      const key = `${file}:${st.mtimeMs}`;
      if (!gzCache.has(key)) gzCache.set(key, zlib.gzipSync(data));
      data = gzCache.get(key);
      headers['content-encoding'] = 'gzip';
      headers.vary = 'Accept-Encoding';
    }
    headers['content-length'] = data.length;
    res.writeHead(200, headers);
    res.end(data);
  }

  async function handler(req, res) {
    const started = Date.now();
    try {
      const url = new URL(req.url, 'http://localhost');
      if (!url.pathname.startsWith('/api/')) {
        if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'method_not_allowed', 'Method not allowed');
        return serveStatic(req, res, url.pathname);
      }

      // Cross-site request protection for state changes: browsers must send JSON
      // (which forces a CORS preflight we never grant) and not be cross-site.
      if (req.method !== 'GET') {
        const site = req.headers['sec-fetch-site'];
        if (site && site !== 'same-origin' && site !== 'none') throw new HttpError(403, 'cross_site', 'Cross-site request refused');
        if (!/^application\/json\b/i.test(req.headers['content-type'] ?? '')) {
          throw new HttpError(415, 'json_required', 'Content-Type must be application/json');
        }
      }

      if (url.pathname.startsWith('/api/assistant/')) requireAssistant(req);

      for (const r of routes) {
        if (r.method !== req.method) continue;
        const m = r.re.exec(url.pathname);
        if (!m) continue;
        const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
        const body = req.method === 'GET' || req.method === 'DELETE' ? {} : await readBody(req, config.maxBodyBytes);
        await r.handler({ req, res, params, query: url.searchParams, body });
        return;
      }
      throw new HttpError(404, 'not_found', 'No such endpoint');
    } catch (err) {
      if (err instanceof HttpError) {
        sendJson(res, err.status, { error: { code: err.code, message: err.message, ...err.extra } });
      } else {
        log.error(`[http] ${req.method} ${req.url} failed:`, err);
        if (!res.headersSent) sendJson(res, 500, { error: { code: 'internal', message: 'Internal server error' } });
      }
    } finally {
      if (req.url.startsWith('/api/') && req.method !== 'GET') {
        log.log(`[http] ${req.method} ${req.url} ${res.statusCode} ${Date.now() - started}ms`);
      }
    }
  }

  const server = http.createServer(handler);
  server.requestTimeout = 5 * 60_000;
  return { server, store };
}
