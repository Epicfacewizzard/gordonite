// Attached files: images, PDFs and other documents.
//
// The bytes live on disk under cfg.filesDir/<first two hex of sha256>/<sha256>. A name is the SHA-256 of the
// content, so a file is stored once however many times it is added, a stored file is never rewritten, and a
// damaged file is detectable (`check`). The attachments table (schema v6) holds what each file is called, what
// it is, and which note first used it. Deleting is soft: the row is hidden, the bytes stay.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { HttpError } from './errors.js';
import { uuid } from '../shared/ids.js';
import { cleanFileName, kindOfType } from '../shared/attachments.js';

const nowIso = () => new Date().toISOString();
const sha256 = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');

// ---------- what a file is (decided from its bytes, never from what the sender claims) ----------

const HEIC_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs']);

function ftypBrands(buf) {
  if (buf.length < 16 || buf.toString('latin1', 4, 8) !== 'ftyp') return null;
  const size = Math.min(buf.readUInt32BE(0) || 32, buf.length, 256);
  const brands = [buf.toString('latin1', 8, 12)];
  for (let i = 16; i + 4 <= size; i += 4) brands.push(buf.toString('latin1', i, i + 4));
  return brands;
}

// Only used to label a document the app will offer as a download; it never decides how a file is served.
const EXTENSION_TYPES = {
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  txt: 'text/plain',
  csv: 'text/csv',
  md: 'text/markdown',
  json: 'application/json',
  zip: 'application/zip',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  m4a: 'audio/mp4',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
};

/** { mime, heic } for these bytes. Unknown content is a plain downloadable file. */
export function sniff(buf, name = '') {
  const starts = (...bytes) => bytes.every((b, i) => buf[i] === b);
  if (buf.subarray(0, 1024).includes('%PDF-')) return { mime: 'application/pdf', heic: false };
  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return { mime: 'image/png', heic: false };
  if (starts(0xff, 0xd8, 0xff)) return { mime: 'image/jpeg', heic: false };
  const head = buf.toString('latin1', 0, 12);
  if (head.startsWith('GIF87a') || head.startsWith('GIF89a')) return { mime: 'image/gif', heic: false };
  if (head.startsWith('RIFF') && head.slice(8, 12) === 'WEBP') return { mime: 'image/webp', heic: false };
  const brands = ftypBrands(buf);
  if (brands && !brands.includes('avif') && !brands.includes('avis')) {
    if (brands.some((b) => HEIC_BRANDS.has(b)) || brands.includes('mif1') || brands.includes('msf1')) return { mime: 'image/heic', heic: true };
  }
  const ext = path.extname(String(name)).slice(1).toLowerCase();
  return { mime: EXTENSION_TYPES[ext] ?? 'application/octet-stream', heic: false };
}

// ---------- HEIC -> JPEG ----------

export function convertHeicInWorker(buffer) {
  return new Promise((resolve, reject) => {
    // Copy exactly this file's bytes (a Buffer may be a view into a larger shared block).
    const copy = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    const worker = new Worker(new URL('./heic-worker.js', import.meta.url), {
      workerData: { buffer: copy },
      execArgv: [], // do not inherit the server's flags (--watch in development, for one)
    });
    const timer = setTimeout(() => {
      worker.terminate();
      reject(new HttpError(422, 'heic_timeout', 'That photo took too long to convert. Try a smaller one, or export it as JPEG first.'));
    }, 120_000);
    worker.once('message', (m) => {
      clearTimeout(timer);
      if (m.ok) resolve(Buffer.from(m.buffer));
      else reject(new HttpError(422, 'heic_failed', `That photo could not be converted to JPEG (${m.error}). Export it as JPEG and try again.`));
    });
    worker.once('error', (err) => {
      clearTimeout(timer);
      reject(new HttpError(500, 'heic_unavailable', `Photo conversion is not available on this server (${err.message}).`));
    });
  });
}

// ---------- the store ----------

const publicShape = (r) => ({
  id: r.id,
  name: r.name,
  mime: r.mime,
  size: r.size,
  kind: r.kind,
  noteId: r.note_id ?? null,
  source: r.source,
  createdAt: r.created_at,
  converted: !!r.original_sha256,
  ...(r.original_sha256 ? { originalName: r.original_name, originalMime: r.original_mime, originalSize: r.original_size } : {}),
  ...(r.deleted_at ? { removedAt: r.deleted_at } : {}),
});

export class FileStore {
  constructor(db, cfg, { convertHeic = convertHeicInWorker } = {}) {
    this.db = db;
    this.cfg = cfg;
    this.convertHeic = convertHeic;
  }

  pathFor(sha) {
    return path.join(this.cfg.filesDir, sha.slice(0, 2), sha);
  }

  // Write bytes under their hash unless they are already there. Written to a temporary name and renamed, so a
  // reader never sees half a file and a crash never leaves a wrong file under a hash.
  #writeBlob(buffer) {
    const sha = sha256(buffer);
    const final = this.pathFor(sha);
    if (fs.existsSync(final) && fs.statSync(final).size === buffer.length) return sha;
    fs.mkdirSync(path.dirname(final), { recursive: true });
    const tmp = `${final}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    try {
      fs.writeFileSync(tmp, buffer);
      fs.renameSync(tmp, final);
    } catch (err) {
      fs.rmSync(tmp, { force: true });
      throw err;
    }
    return sha;
  }

  /**
   * Store a file and return its description. `name` is only a label (and, for unknown types, a hint at what it
   * is); what the file is comes from its bytes. A HEIC/HEIF photo is stored as a JPEG, with the original kept.
   */
  async add(buffer, { name, noteId = null, source = 'upload' } = {}) {
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw new HttpError(400, 'empty_file', 'That file is empty');
    if (buffer.length > this.cfg.maxUploadBytes) {
      throw new HttpError(413, 'too_large', `That file is larger than the ${Math.round(this.cfg.maxUploadBytes / 1024 / 1024)} MB limit`);
    }
    const label = cleanFileName(name, 'file');
    const found = sniff(buffer, label);
    const row = { id: uuid(), name: label, size: buffer.length, source, note_id: noteId, created_at: nowIso() };
    if (found.heic) {
      const jpeg = await this.convertHeic(buffer);
      Object.assign(row, {
        sha256: this.#writeBlob(jpeg),
        mime: 'image/jpeg',
        size: jpeg.length,
        name: label.replace(/\.[A-Za-z0-9]{1,5}$/, '') + '.jpg',
        original_sha256: this.#writeBlob(buffer),
        original_name: label,
        original_mime: found.mime,
        original_size: buffer.length,
      });
    } else {
      Object.assign(row, { sha256: this.#writeBlob(buffer), mime: found.mime, original_sha256: null, original_name: null, original_mime: null, original_size: null });
    }
    row.kind = kindOfType(row.mime);
    this.db
      .prepare(
        `INSERT INTO attachments (id, sha256, name, mime, size, kind, original_sha256, original_name, original_mime, original_size, note_id, source, created_at)
         VALUES (@id, @sha256, @name, @mime, @size, @kind, @original_sha256, @original_name, @original_mime, @original_size, @note_id, @source, @created_at)`,
      )
      .run(row);
    return publicShape({ ...row, deleted_at: null });
  }

  #row(id) {
    return this.db.prepare('SELECT * FROM attachments WHERE id = ? AND deleted_at IS NULL').get(id) ?? null;
  }

  get(id) {
    const r = this.#row(id);
    return r ? publicShape(r) : null;
  }

  /** Several at once, as a Map id -> description (ids that do not exist are left out). */
  describe(ids) {
    const out = new Map();
    for (const id of ids) {
      const r = this.#row(id);
      if (r) out.set(id, publicShape(r));
    }
    return out;
  }

  /** { path, size, mime, name, sha, inline, etag } for the bytes of a file, or null. `original` = the pre-conversion photo. */
  fileFor(id, { original = false } = {}) {
    const r = this.#row(id);
    if (!r) return null;
    const useOriginal = original && r.original_sha256;
    const sha = useOriginal ? r.original_sha256 : r.sha256;
    const file = this.pathFor(sha);
    if (!fs.existsSync(file)) return null;
    const mime = useOriginal ? r.original_mime : r.mime;
    const kind = useOriginal ? 'file' : r.kind;
    return {
      path: file,
      size: useOriginal ? r.original_size : r.size,
      mime,
      name: useOriginal ? r.original_name : r.name,
      sha,
      kind,
    };
  }

  // `removed: true` lists the files that were removed (most recently removed first) instead of the live ones.
  list({ noteId = null, unattached = false, q = '', kind = null, removed = false, limit = 50, offset = 0 } = {}) {
    limit = Math.min(Math.max(Number(limit) || 50, 1), 200);
    offset = Math.max(Number(offset) || 0, 0);
    const where = [removed ? 'deleted_at IS NOT NULL' : 'deleted_at IS NULL'];
    const args = [];
    if (noteId) {
      where.push('note_id = ?');
      args.push(noteId);
    } else if (unattached) {
      where.push('note_id IS NULL');
    }
    if (kind === 'image' || kind === 'pdf' || kind === 'file') {
      where.push('kind = ?');
      args.push(kind);
    }
    const needle = String(q ?? '').trim();
    if (needle) {
      where.push("name LIKE ? ESCAPE '\\'");
      args.push(`%${needle.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
    }
    const order = removed ? 'deleted_at DESC, id' : 'created_at DESC, id';
    const rows = this.db
      .prepare(`SELECT * FROM attachments WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT ? OFFSET ?`)
      .all(...args, limit + 1, offset);
    return { attachments: rows.slice(0, limit).map(publicShape), hasMore: rows.length > limit };
  }

  remove(id) {
    return this.db.prepare('UPDATE attachments SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL').run(nowIso(), id).changes > 0;
  }

  /** Bring a removed file back (everything that showed it shows it again). Null if it was not removed. */
  restore(id) {
    const r = this.db.prepare('SELECT * FROM attachments WHERE id = ? AND deleted_at IS NOT NULL').get(id);
    if (!r) return null;
    this.db.prepare('UPDATE attachments SET deleted_at = NULL WHERE id = ?').run(id);
    return publicShape({ ...r, deleted_at: null });
  }

  // A note that saved a reference to files claims the ones no note has claimed yet.
  linkToNote(noteId, ids) {
    const unique = [...new Set(ids)];
    if (!unique.length) return;
    this.db.prepare(`UPDATE attachments SET note_id = ? WHERE note_id IS NULL AND id IN (${unique.map(() => '?').join(',')})`).run(noteId, ...unique);
  }

  stats() {
    const r = this.db.prepare('SELECT COUNT(*) AS count, COALESCE(SUM(size), 0) AS bytes FROM attachments WHERE deleted_at IS NULL').get();
    const removed = this.db.prepare('SELECT COUNT(*) AS count FROM attachments WHERE deleted_at IS NOT NULL').get().count;
    return { count: r.count, bytes: r.bytes, removed };
  }

  /** Every file the database knows about is present with the right size (and, with hashes, the right content). */
  check({ hashes = false } = {}) {
    const problems = [];
    let checked = 0;
    const seen = new Set();
    const rows = this.db.prepare('SELECT id, name, sha256, size, original_sha256, original_size FROM attachments').all();
    for (const r of rows) {
      for (const [sha, size] of [[r.sha256, r.size], ...(r.original_sha256 ? [[r.original_sha256, r.original_size]] : [])]) {
        if (seen.has(sha)) continue;
        seen.add(sha);
        checked++;
        const file = this.pathFor(sha);
        let st;
        try {
          st = fs.statSync(file);
        } catch {
          problems.push({ id: r.id, name: r.name, problem: 'missing' });
          continue;
        }
        if (st.size !== size) problems.push({ id: r.id, name: r.name, problem: `size ${st.size}, expected ${size}` });
        else if (hashes && sha256(fs.readFileSync(file)) !== sha) problems.push({ id: r.id, name: r.name, problem: 'content does not match its hash' });
      }
    }
    return { checked, ok: problems.length === 0, problems };
  }
}
