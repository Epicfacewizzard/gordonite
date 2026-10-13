// The transport layer: how answers are written and bodies are read. No application rules in here.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { HttpError } from './errors.js';

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

export function sendJson(res, status, body) {
  const data = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': data.length,
    'cache-control': 'no-store',
  });
  res.end(data);
}

export function sendDownload(res, filename, type, data) {
  res.writeHead(200, {
    'content-type': type,
    'content-length': data.length,
    'content-disposition': `attachment; filename="${filename}"`,
    'cache-control': 'no-store',
  });
  res.end(data);
}

export async function readBody(req, limit) {
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

// The whole body as bytes (an uploaded file), refusing anything over `limit`.
export async function readRaw(req, limit) {
  const tooLarge = () => new HttpError(413, 'too_large', `That file is larger than the ${Math.round(limit / 1024 / 1024)} MB limit`);
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > limit) throw tooLarge();
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw tooLarge();
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

// Content-Disposition with a plain ASCII fallback and the real (UTF-8) name for browsers that understand it.
function disposition(kind, name) {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  const utf8 = encodeURIComponent(name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${utf8}`;
}

// Serve one stored file. Images and PDFs show in the browser; everything else is only ever a download, as opaque
// bytes, so a stored page or script can never run from this origin. Files are named by their content hash, so they
// are cached for good and can be fetched in ranges (PDF viewers do).
export function sendFile(req, res, info, { download = false } = {}) {
  const show = !download && (info.kind === 'image' || info.kind === 'pdf');
  const headers = {
    'content-type': show ? info.mime : 'application/octet-stream',
    'content-disposition': disposition(show ? 'inline' : 'attachment', info.name),
    'accept-ranges': 'bytes',
    etag: `"${info.sha}"`,
    'cache-control': 'private, max-age=31536000, immutable',
    'x-content-type-options': 'nosniff',
  };
  if (!show) headers['content-security-policy'] = "sandbox; default-src 'none'";
  if (req.headers['if-none-match'] === headers.etag) {
    res.writeHead(304, { etag: headers.etag, 'cache-control': headers['cache-control'] });
    return res.end();
  }
  let start = 0;
  let end = info.size - 1;
  let status = 200;
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
  if (range && (range[1] || range[2]) && info.size > 0) {
    if (range[1] === '') {
      start = Math.max(info.size - Number(range[2]), 0); // the last N bytes
    } else {
      start = Number(range[1]);
      if (range[2] !== '') end = Math.min(Number(range[2]), end);
    }
    if (start > end || start >= info.size) {
      res.writeHead(416, { 'content-range': `bytes */${info.size}` });
      return res.end();
    }
    status = 206;
    headers['content-range'] = `bytes ${start}-${end}/${info.size}`;
  }
  headers['content-length'] = info.size === 0 ? 0 : end - start + 1;
  res.writeHead(status, headers);
  if (info.size === 0) return res.end();
  fs.createReadStream(info.path, { start, end }).on('error', () => res.destroy()).pipe(res);
}

/** A date for file names: 2026-10-13. */
export const fileStamp = () => new Date().toISOString().slice(0, 10);

/**
 * The built client: files from config.staticDir (gzipped when the browser accepts it), and index.html for any
 * client-side route. Returns serveStatic(req, res, pathname).
 */
export function createStaticServer(config) {
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
  return serveStatic;
}
