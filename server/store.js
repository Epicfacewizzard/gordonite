import { tx } from './db.js';
import { uuid } from '../shared/ids.js';
import { normalizeTag } from '../shared/tags.js';
import { isValidDateString } from '../shared/dates.js';
import { DOC_FORMAT, migrateDoc, plainText, validateDoc } from '../shared/doc.js';

export class HttpError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

const ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const nowIso = () => new Date().toISOString();

export function checkId(id, what = 'id') {
  if (typeof id !== 'string' || !ID_RE.test(id)) throw new HttpError(400, 'bad_id', `Invalid ${what}`);
  return id;
}

export class Store {
  constructor(db, config) {
    this.db = db;
    this.cfg = config;
  }

  // ---------- helpers ----------

  #tagsByNote(noteIds) {
    const out = new Map(noteIds.map((id) => [id, []]));
    if (noteIds.length === 0) return out;
    const marks = noteIds.map(() => '?').join(',');
    const rows = this.db
      .prepare(
        `SELECT nt.note_id, t.id, t.path FROM note_tags nt JOIN tags t ON t.id = nt.tag_id
         WHERE nt.note_id IN (${marks}) ORDER BY t.path`,
      )
      .all(...noteIds);
    for (const r of rows) out.get(r.note_id).push({ id: r.id, path: r.path });
    return out;
  }

  #toNote(row, tags) {
    let doc = JSON.parse(row.doc);
    if (row.doc_format !== DOC_FORMAT) doc = migrateDoc(doc, row.doc_format);
    return {
      id: row.id,
      date: row.note_date,
      doc,
      docFormat: DOC_FORMAT,
      revision: row.revision,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      deletedAt: row.deleted_at,
      tags,
    };
  }

  #notes(rows) {
    const tags = this.#tagsByNote(rows.map((r) => r.id));
    return rows.map((r) => this.#toNote(r, tags.get(r.id)));
  }

  #ensureTag(path) {
    const row = this.db.prepare('SELECT id, path FROM tags WHERE path = ?').get(path);
    if (row) return { id: row.id, path: row.path };
    const id = uuid();
    this.db.prepare('INSERT INTO tags (id, path, created_at) VALUES (?, ?, ?)').run(id, path, nowIso());
    return { id, path };
  }

  #addVersion(noteId, revision, docStr, kind, docFormat = DOC_FORMAT) {
    this.db
      .prepare(
        'INSERT INTO note_versions (id, note_id, revision, doc, doc_format, kind, created_at) VALUES (?,?,?,?,?,?,?)',
      )
      .run(uuid(), noteId, revision, docStr, docFormat, kind, nowIso());
  }

  #pruneVersions(noteId) {
    this.db
      .prepare(
        `DELETE FROM note_versions WHERE note_id = ? AND kind IN ('auto','guard','restore')
         AND id NOT IN (
           SELECT id FROM note_versions WHERE note_id = ? AND kind IN ('auto','guard','restore')
           ORDER BY created_at DESC, rowid DESC LIMIT ?)`,
      )
      .run(noteId, noteId, this.cfg.versionKeep);
  }

  #slotHolder(tagId, date, exceptNoteId) {
    return this.db
      .prepare(
        `SELECT n.* FROM note_tags nt JOIN notes n ON n.id = nt.note_id
         WHERE nt.tag_id = ? AND nt.note_date = ? AND nt.live = 1 AND n.id != ?`,
      )
      .get(tagId, date, exceptNoteId);
  }

  // Keep a copy of a rejected write so it can be recovered later. Repeated
  // retries of the same rejected content do not pile up duplicates.
  #storeConflictCopy(noteId, baseRevision, docStr) {
    const last = this.db
      .prepare(`SELECT doc FROM note_versions WHERE note_id = ? AND kind = 'conflict' ORDER BY created_at DESC, rowid DESC LIMIT 1`)
      .get(noteId);
    if (last?.doc === docStr) return;
    this.#addVersion(noteId, baseRevision, docStr, 'conflict');
  }

  // ---------- tags ----------

  listTags() {
    return this.db
      .prepare(
        `SELECT t.id, t.path, t.created_at AS createdAt, COUNT(n.id) AS noteCount, MAX(nt.note_date) AS lastDate
         FROM tags t
         LEFT JOIN note_tags nt ON nt.tag_id = t.id AND nt.live = 1
         LEFT JOIN notes n ON n.id = nt.note_id AND n.deleted_at IS NULL
         GROUP BY t.id ORDER BY t.path`,
      )
      .all();
  }

  createTag(rawPath) {
    const path = normalizeTag(rawPath);
    if (!path) throw new HttpError(400, 'bad_tag', 'Tag names use letters, numbers, - _ . and / for sub-tags');
    return tx(this.db, () => this.#ensureTag(path));
  }

  // ---------- reading ----------

  getNote(id) {
    const row = this.db.prepare('SELECT * FROM notes WHERE id = ?').get(id);
    if (!row) return null;
    return this.#notes([row])[0];
  }

  // Exact-tag stream, newest date first. Only dates that have a note are listed;
  // the client adds today's editable entry itself.
  stream(rawPath, { before = null, limit = 14 } = {}) {
    const path = normalizeTag(rawPath);
    if (!path) throw new HttpError(400, 'bad_tag', 'Invalid tag');
    if (before !== null && !isValidDateString(before)) throw new HttpError(400, 'bad_date', 'Invalid "before" date');
    limit = Math.min(Math.max(Number(limit) || 14, 1), 60);
    const tag = this.db.prepare('SELECT id, path FROM tags WHERE path = ?').get(path);
    if (!tag) return { tag: { id: null, path }, notes: [], hasMore: false };
    const rows = this.db
      .prepare(
        `SELECT n.* FROM note_tags nt JOIN notes n ON n.id = nt.note_id
         WHERE nt.tag_id = ? AND nt.live = 1 AND n.deleted_at IS NULL AND (? IS NULL OR nt.note_date < ?)
         ORDER BY nt.note_date DESC LIMIT ?`,
      )
      .all(tag.id, before, before, limit + 1);
    const hasMore = rows.length > limit;
    return { tag: { id: tag.id, path: tag.path }, notes: this.#notes(rows.slice(0, limit)), hasMore };
  }

  // ---------- saving ----------

  /**
   * Save a note. Never overwrites content the sender did not know about:
   * when the sender's base is stale the write is refused and the sender's
   * version is stored as a "conflict" version of the note so neither side is lost.
   *
   * body: { baseRevision, doc, docFormat, tags[], date, opId, afterOps[] }
   *  - opId identifies this request. afterOps lists earlier requests whose outcome
   *    the sender never learned (lost response). If the server's latest write is
   *    one of those, the sender's lineage is current and the save is accepted.
   */
  saveNote(id, body) {
    checkId(id, 'note id');
    if (!body || typeof body !== 'object') throw new HttpError(400, 'bad_body', 'Missing body');
    if (body.docFormat !== DOC_FORMAT) throw new HttpError(400, 'bad_format', `docFormat must be ${DOC_FORMAT}`);
    const docErr = validateDoc(body.doc);
    if (docErr) throw new HttpError(400, 'bad_doc', docErr);
    const baseRevision = Number.isInteger(body.baseRevision) ? body.baseRevision : 0;
    const opId = typeof body.opId === 'string' ? body.opId.slice(0, 64) : null;
    const afterOps = Array.isArray(body.afterOps) ? body.afterOps.filter((x) => typeof x === 'string').slice(-50) : [];
    const docStr = JSON.stringify(body.doc);

    return tx(this.db, () => {
      const note = this.db.prepare('SELECT * FROM notes WHERE id = ?').get(id);

      if (!note) return this.#createNote(id, body, docStr, opId);

      if (note.deleted_at) {
        if (note.doc !== docStr) this.#storeConflictCopy(id, baseRevision, docStr);
        return { status: 'conflict', reason: 'deleted', note: this.#notes([note])[0] };
      }

      if (note.doc === docStr) {
        return { status: 'ok', revision: note.revision, updatedAt: note.updated_at, unchanged: true };
      }

      const lineageCurrent =
        baseRevision === note.revision || (note.last_op_id !== null && afterOps.includes(note.last_op_id));
      if (!lineageCurrent) {
        this.#storeConflictCopy(id, baseRevision, docStr);
        return { status: 'conflict', reason: 'revision', note: this.#notes([note])[0] };
      }

      // Keep the previous content as a version, but not on every keystroke.
      const now = nowIso();
      const sinceSnap = Date.now() - Date.parse(note.last_snapshot_at ?? note.created_at);
      const oldLen = plainText(JSON.parse(note.doc)).trim().length;
      let snapKind = null;
      if (oldLen > 0) {
        // keepPrevious: the sender is deliberately replacing content it had a conflict with.
        if (body.keepPrevious === true || sinceSnap >= this.cfg.versionIntervalMinutes * 60_000) snapKind = 'auto';
        else if (oldLen >= 20 && plainText(body.doc).trim().length < oldLen * 0.5) snapKind = 'guard';
      }
      if (snapKind) this.#addVersion(id, note.revision, note.doc, snapKind, note.doc_format);

      const revision = note.revision + 1;
      this.db
        .prepare(
          `UPDATE notes SET doc = ?, doc_format = ?, revision = ?, last_op_id = ?, updated_at = ?, last_snapshot_at = ?
           WHERE id = ?`,
        )
        .run(docStr, DOC_FORMAT, revision, opId, now, snapKind ? now : note.last_snapshot_at, id);
      if (snapKind) this.#pruneVersions(id);
      return { status: 'ok', revision, updatedAt: now };
    });
  }

  #createNote(id, body, docStr, opId) {
    if (!isValidDateString(body.date)) throw new HttpError(400, 'bad_date', 'A valid note date (YYYY-MM-DD) is required');
    const paths = [...new Set((Array.isArray(body.tags) ? body.tags : []).map(normalizeTag))];
    if (paths.length === 0 || paths.includes(null)) throw new HttpError(400, 'bad_tag', 'At least one valid tag is required');

    const tags = paths.map((p) => this.#ensureTag(p));
    const holders = new Map();
    for (const t of tags) {
      const h = this.#slotHolder(t.id, body.date, id);
      if (h) holders.set(h.id, h);
    }
    if (holders.size > 0) {
      for (const h of holders.values()) this.#storeConflictCopy(h.id, h.revision, docStr);
      return { status: 'conflict', reason: 'slot', note: this.#notes([...holders.values()])[0] };
    }

    const now = nowIso();
    this.db
      .prepare(
        `INSERT INTO notes (id, note_date, doc, doc_format, revision, last_op_id, created_at, updated_at, last_snapshot_at)
         VALUES (?,?,?,?,1,?,?,?,?)`,
      )
      .run(id, body.date, docStr, DOC_FORMAT, opId, now, now, now);
    const link = this.db.prepare('INSERT INTO note_tags (note_id, tag_id, note_date, live) VALUES (?,?,?,1)');
    for (const t of tags) link.run(id, t.id, body.date);
    return { status: 'ok', revision: 1, updatedAt: now, created: true };
  }

  // ---------- tag membership ----------

  addTagToNote(noteId, rawPath) {
    const path = normalizeTag(rawPath);
    if (!path) throw new HttpError(400, 'bad_tag', 'Invalid tag name');
    return tx(this.db, () => {
      const note = this.db.prepare('SELECT * FROM notes WHERE id = ? AND deleted_at IS NULL').get(noteId);
      if (!note) throw new HttpError(404, 'not_found', 'Note not found (it may not be saved on the server yet)');
      const tag = this.#ensureTag(path);
      const has = this.db.prepare('SELECT 1 FROM note_tags WHERE note_id = ? AND tag_id = ?').get(noteId, tag.id);
      if (!has) {
        const holder = this.#slotHolder(tag.id, note.note_date, noteId);
        if (holder) {
          throw new HttpError(409, 'slot_taken', `"${path}" already has a note for ${note.note_date}`, { tag: path, date: note.note_date });
        }
        this.db.prepare('INSERT INTO note_tags (note_id, tag_id, note_date, live) VALUES (?,?,?,1)').run(noteId, tag.id, note.note_date);
      }
      return this.#tagsByNote([noteId]).get(noteId);
    });
  }

  removeTagFromNote(noteId, tagId) {
    return tx(this.db, () => {
      const note = this.db.prepare('SELECT * FROM notes WHERE id = ? AND deleted_at IS NULL').get(noteId);
      if (!note) throw new HttpError(404, 'not_found', 'Note not found');
      const count = this.db.prepare('SELECT COUNT(*) AS c FROM note_tags WHERE note_id = ?').get(noteId).c;
      if (count <= 1) throw new HttpError(409, 'last_tag', 'A note needs at least one tag');
      this.db.prepare('DELETE FROM note_tags WHERE note_id = ? AND tag_id = ?').run(noteId, tagId);
      return this.#tagsByNote([noteId]).get(noteId);
    });
  }

  // ---------- trash ----------

  deleteNote(id) {
    return tx(this.db, () => {
      const note = this.db.prepare('SELECT * FROM notes WHERE id = ?').get(id);
      if (!note) throw new HttpError(404, 'not_found', 'Note not found');
      if (!note.deleted_at) {
        this.db.prepare('UPDATE notes SET deleted_at = ? WHERE id = ?').run(nowIso(), id);
        this.db.prepare('UPDATE note_tags SET live = 0 WHERE note_id = ?').run(id);
      }
      return { ok: true };
    });
  }

  listTrash() {
    const rows = this.db.prepare('SELECT * FROM notes WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC').all();
    return this.#notes(rows);
  }

  restoreNote(id, { dropConflictingTags = false } = {}) {
    return tx(this.db, () => {
      const note = this.db.prepare('SELECT * FROM notes WHERE id = ?').get(id);
      if (!note) throw new HttpError(404, 'not_found', 'Note not found');
      if (!note.deleted_at) return { note: this.#notes([note])[0], droppedTags: [] };
      const links = this.db
        .prepare('SELECT nt.tag_id, t.path FROM note_tags nt JOIN tags t ON t.id = nt.tag_id WHERE nt.note_id = ?')
        .all(id);
      const taken = links.filter((l) => this.#slotHolder(l.tag_id, note.note_date, id));
      if (taken.length > 0) {
        const paths = taken.map((l) => l.path);
        if (!dropConflictingTags || taken.length === links.length) {
          throw new HttpError(
            409,
            'slot_taken',
            `${paths.join(', ')} already ${paths.length > 1 ? 'have notes' : 'has a note'} for ${note.note_date}. Copy the text from the trash instead, or restore it only under the other tags.`,
            { tags: paths, canDrop: taken.length < links.length },
          );
        }
        for (const l of taken) this.db.prepare('DELETE FROM note_tags WHERE note_id = ? AND tag_id = ?').run(id, l.tag_id);
      }
      this.db.prepare('UPDATE note_tags SET live = 1 WHERE note_id = ?').run(id);
      this.db.prepare('UPDATE notes SET deleted_at = NULL WHERE id = ?').run(id);
      const restored = this.db.prepare('SELECT * FROM notes WHERE id = ?').get(id);
      return { note: this.#notes([restored])[0], droppedTags: taken.map((l) => l.path) };
    });
  }

  purgeTrash() {
    if (this.cfg.trashRetentionDays === 0) return 0;
    const cutoff = new Date(Date.now() - this.cfg.trashRetentionDays * 86_400_000).toISOString();
    return this.db.prepare('DELETE FROM notes WHERE deleted_at IS NOT NULL AND deleted_at < ?').run(cutoff).changes;
  }

  // ---------- versions ----------

  listVersions(noteId) {
    const rows = this.db
      .prepare('SELECT id, revision, doc, kind, created_at FROM note_versions WHERE note_id = ? ORDER BY created_at DESC, rowid DESC')
      .all(noteId);
    return rows.map((r) => ({
      id: r.id,
      revision: r.revision,
      kind: r.kind,
      createdAt: r.created_at,
      preview: plainText(JSON.parse(r.doc)).trim().slice(0, 160),
    }));
  }

  getVersion(noteId, versionId) {
    const r = this.db.prepare('SELECT * FROM note_versions WHERE note_id = ? AND id = ?').get(noteId, versionId);
    if (!r) throw new HttpError(404, 'not_found', 'Version not found');
    let doc = JSON.parse(r.doc);
    if (r.doc_format !== DOC_FORMAT) doc = migrateDoc(doc, r.doc_format);
    return { id: r.id, revision: r.revision, kind: r.kind, createdAt: r.created_at, doc, docFormat: DOC_FORMAT };
  }

  // Restoring never discards the current content: it is kept as a version first.
  restoreVersion(noteId, versionId) {
    return tx(this.db, () => {
      const note = this.db.prepare('SELECT * FROM notes WHERE id = ? AND deleted_at IS NULL').get(noteId);
      if (!note) throw new HttpError(404, 'not_found', 'Note not found');
      const v = this.db.prepare('SELECT * FROM note_versions WHERE note_id = ? AND id = ?').get(noteId, versionId);
      if (!v) throw new HttpError(404, 'not_found', 'Version not found');
      if (v.doc !== note.doc) {
        this.#addVersion(noteId, note.revision, note.doc, 'restore', note.doc_format);
        const now = nowIso();
        this.db
          .prepare('UPDATE notes SET doc = ?, doc_format = ?, revision = ?, last_op_id = NULL, updated_at = ?, last_snapshot_at = ? WHERE id = ?')
          .run(v.doc, v.doc_format, note.revision + 1, now, now, noteId);
        this.#pruneVersions(noteId);
      }
      return this.getNote(noteId);
    });
  }
}
