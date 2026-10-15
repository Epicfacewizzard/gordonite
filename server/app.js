import http from 'node:http';
import crypto from 'node:crypto';
import { Store } from './store.js';
import { AssistantNotes } from './assistant-notes.js';
import { HttpError } from './errors.js';
import { FileStore } from './files.js';
import { createAuth } from './auth.js';
import { sendJson, readBody, createStaticServer } from './http.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerSettingsRoutes } from './routes/settings.js';
import { registerAssistantRoutes } from './routes/assistant.js';
import { registerMoodRoutes } from './routes/moods.js';
import { registerSkinRoutes } from './routes/skin.js';
import { registerHabitRoutes } from './routes/habits.js';
import { registerTagRoutes } from './routes/tags.js';
import { registerNoteRoutes } from './routes/notes.js';
import { registerFileRoutes } from './routes/files.js';
import { registerPortabilityRoutes } from './routes/portability.js';
import { registerBackupRoutes } from './routes/backups.js';

export const APP_VERSION = '0.9.0';

export function createApp({ config, db, log = console, convertHeic }) {
  const store = new Store(db, config);
  const assistant = new AssistantNotes(store);
  const files = new FileStore(db, config, convertHeic ? { convertHeic } : {});
  const auth = createAuth(db);
  const routes = [];
  // options.raw: the handler reads the body itself (an upload) instead of getting it parsed as JSON.
  const route = (method, pattern, handler, options = {}) => {
    const keys = [];
    const re = new RegExp(`^${pattern.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)'))}$`);
    routes.push({ method, re, keys, handler, raw: options.raw === true });
  };

  // The assistant's key. Off (404) unless ASSISTANT_TOKEN is set; compared as hashes so timing reveals nothing.
  const sha = (v) => crypto.createHash('sha256').update(v).digest();
  function requireAssistant(req) {
    if (!config.assistantToken) throw new HttpError(404, 'not_found', 'No such endpoint');
    const given = /^Bearer (.+)$/i.exec(req.headers.authorization ?? '')?.[1] ?? '';
    if (!crypto.timingSafeEqual(sha(given), sha(config.assistantToken))) throw new HttpError(401, 'unauthorized', 'Missing or wrong assistant key');
  }

  // Routes are matched in the order they are registered.
  const context = { route, db, config, store, assistant, files, auth, log, appVersion: APP_VERSION };
  registerHealthRoutes(context);
  registerAuthRoutes(context);
  registerSettingsRoutes(context);
  registerAssistantRoutes(context);
  registerMoodRoutes(context);
  registerSkinRoutes(context);
  registerHabitRoutes(context);
  registerTagRoutes(context);
  registerNoteRoutes(context);
  registerFileRoutes(context);
  registerPortabilityRoutes(context);
  registerBackupRoutes(context);

  const serveStatic = createStaticServer(config);

  async function handler(req, res) {
    const started = Date.now();
    try {
      const url = new URL(req.url, 'http://localhost');
      if (!url.pathname.startsWith('/api/')) {
        // A share from another app normally never gets here: the service worker takes it (client/sw.js). If it
        // does (no service worker yet), send the phone to the share page, which explains what to do. Nothing is read.
        if (req.method === 'POST' && url.pathname === '/share-target') {
          req.resume();
          res.writeHead(303, { location: '/#/share', 'cache-control': 'no-store' });
          return res.end();
        }
        if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'method_not_allowed', 'Method not allowed');
        return serveStatic(req, res, url.pathname);
      }

      // Cross-site request protection for state changes: browsers must send JSON
      // (which forces a CORS preflight we never grant) and not be cross-site.
      if (req.method !== 'GET') {
        const site = req.headers['sec-fetch-site'];
        if (site && site !== 'same-origin' && site !== 'none') throw new HttpError(403, 'cross_site', 'Cross-site request refused');
        if (req.method === 'POST' && url.pathname === '/api/attachments') {
          // An upload is raw bytes. A cross-site page cannot send a custom header without a CORS preflight,
          // which this server never grants, so this header takes the place of the JSON content type here.
          if (req.headers['x-gordonite-upload'] !== '1') throw new HttpError(415, 'upload_header_required', 'Uploads must send the X-Gordonite-Upload: 1 header');
        } else if (!/^application\/json\b/i.test(req.headers['content-type'] ?? '')) {
          throw new HttpError(415, 'json_required', 'Content-Type must be application/json');
        }
      }

      if (url.pathname.startsWith('/api/assistant/')) requireAssistant(req);

      // With a password set, every other request needs the login cookie. The health check, the login routes themselves
      // and the assistant (which has its own key) stay open. The page itself is not data, so it is always served.
      const open = url.pathname === '/api/health' || url.pathname.startsWith('/api/auth') || url.pathname.startsWith('/api/assistant/');
      if (!open && !auth.loggedIn(req)) throw new HttpError(401, 'login_required', 'Log in to continue');

      for (const r of routes) {
        if (r.method !== req.method) continue;
        const m = r.re.exec(url.pathname);
        if (!m) continue;
        const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
        const body = req.method === 'GET' || req.method === 'DELETE' || r.raw ? {} : await readBody(req, config.maxBodyBytes);
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
  server.requestTimeout = 15 * 60_000; // a big file over a slow link
  return { server, store, files };
}
