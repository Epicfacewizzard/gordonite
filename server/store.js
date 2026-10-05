import { tx } from './db.js';
import { uuid } from '../shared/ids.js';
import { normalizeTag } from '../shared/tags.js';
import { dateInTz, isValidDateString } from '../shared/dates.js';
import { DOC_FORMAT, migrateDoc, plainText, validateDoc } from '../shared/doc.js';
import { extractTasks, updateTask } from '../shared/tasks.js';
import { markdownToDoc } from '../shared/markdown-import.js';
import { docToMarkdown } from './markdown.js';

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

// A note title: one line, at most 120 characters; empty means untitled (null).
const MAX_TITLE = 120;
const DEFAULT_DAILY_TAG = 'daily-jots';
function cleanTitle(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') throw new HttpError(400, 'bad_title', 'title must be text');
  return value.replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE) || null;
}

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
      kind: row.kind,
      title: row.title ?? null,
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

  // A tag created by writing a free note in it is a plain topic (no daily entry); one created by a stream's
  // daily note, or by hand, keeps the daily entry on.
  #ensureTag(path, { daily = true } = {}) {
    const row = this.db.prepare('SELECT id, path FROM tags WHERE path = ?').get(path);
    if (row) return { id: row.id, path: row.path };
    const id = uuid();
    this.db.prepare('INSERT INTO tags (id, path, created_at, daily) VALUES (?, ?, ?, ?)').run(id, path, nowIso(), daily ? 1 : 0);
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
         WHERE nt.tag_id = ? AND nt.note_date = ? AND nt.live = 1 AND nt.slot = 1 AND n.id != ?`,
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
        `SELECT t.id, t.path, t.created_at AS createdAt, t.favorite, t.daily, COUNT(n.id) AS noteCount, MAX(nt.note_date) AS lastDate
         FROM tags t
         LEFT JOIN note_tags nt ON nt.tag_id = t.id AND nt.live = 1
         LEFT JOIN notes n ON n.id = nt.note_id AND n.deleted_at IS NULL
         GROUP BY t.id ORDER BY t.path`,
      )
      .all()
      .map((t) => ({ ...t, favorite: t.favorite === 1, daily: t.daily === 1 }));
  }

  setTagDaily(id, daily) {
    if (typeof daily !== 'boolean') throw new HttpError(400, 'bad_daily', '"daily" must be true or false');
    const res = this.db.prepare('UPDATE tags SET daily = ? WHERE id = ?').run(daily ? 1 : 0, id);
    if (res.changes === 0) throw new HttpError(404, 'not_found', 'Tag not found');
    return { id, daily };
  }

  setTagFavorite(id, favorite) {
    if (typeof favorite !== 'boolean') throw new HttpError(400, 'bad_favorite', '"favorite" must be true or false');
    const res = this.db.prepare('UPDATE tags SET favorite = ? WHERE id = ?').run(favorite ? 1 : 0, id);
    if (res.changes === 0) throw new HttpError(404, 'not_found', 'Tag not found');
    return { id, favorite };
  }

  createTag(rawPath) {
    const path = normalizeTag(rawPath);
    if (!path) throw new HttpError(400, 'bad_tag', 'Tag names use letters, numbers, - _ . and / for sub-tags');
    return tx(this.db, () => this.#ensureTag(path));
  }

  // ---------- for the assistant ----------
  // Each of these is synchronous, so a read and the write after it are one step: nothing can change in between.
  // They go through saveNote, so they follow the same rules as any save (validation, versions, revisions).

  #today() {
    return dateInTz(new Date(), this.cfg.tz);
  }

  #liveNote(id) {
    const note = this.getNote(checkId(id, 'note id'));
    if (!note || note.deletedAt) throw new HttpError(404, 'not_found', 'Note not found');
    return note;
  }

  #markdown(value) {
    if (typeof value !== 'string' || !value.trim()) throw new HttpError(400, 'bad_markdown', '"markdown" must be some text');
    if (value.length > 500_000) throw new HttpError(400, 'too_long', '"markdown" is too long');
    return value;
  }

  assistantCreateNote({ title, markdown, tags, date }) {
    const id = uuid();
    const res = this.saveNote(id, {
      baseRevision: 0,
      doc: markdownToDoc(this.#markdown(markdown)),
      docFormat: DOC_FORMAT,
      kind: 'note',
      tags: Array.isArray(tags) ? tags : [],
      date: date ?? this.#today(),
      opId: uuid(),
      ...(title !== undefined ? { title } : {}),
    });
    return { id, revision: res.revision };
  }

  // Add to the end of a note. The earlier text is kept as a version first, so it can be restored from History.
  assistantAppend(id, markdown) {
    const note = this.#liveNote(id);
    const blocks = markdownToDoc(this.#markdown(markdown)).content;
    const existing = note.doc.content ?? [];
    const blank = existing.length === 1 && existing[0].type === 'paragraph' && !existing[0].content?.length;
    const res = this.saveNote(id, {
      baseRevision: note.revision,
      doc: { ...note.doc, content: [...(blank ? [] : existing), ...blocks] },
      docFormat: DOC_FORMAT,
      opId: uuid(),
      keepPrevious: true,
    });
    return { id, revision: res.revision };
  }

  // Add to today's entry in a tag (the Today screen's tag by default), creating it if it is not there yet.
  assistantAppendDaily({ markdown, tag }) {
    const path = normalizeTag(tag ?? this.getSettings().dailyTag);
    if (!path) throw new HttpError(400, 'bad_tag', 'Invalid tag');
    const date = this.#today();
    const row = this.db
      .prepare(
        `SELECT n.id FROM note_tags nt JOIN tags t ON t.id = nt.tag_id JOIN notes n ON n.id = nt.note_id
         WHERE t.path = ? AND nt.note_date = ? AND nt.live = 1 AND nt.slot = 1 AND n.deleted_at IS NULL`,
      )
      .get(path, date);
    if (row) return { ...this.assistantAppend(row.id, markdown), tag: path, date };
    const id = uuid();
    const res = this.saveNote(id, { baseRevision: 0, doc: markdownToDoc(this.#markdown(markdown)), docFormat: DOC_FORMAT, kind: 'daily', tags: [path], date, opId: uuid() });
    return { id, revision: res.revision, tag: path, date, created: true };
  }

  assistantGetNote(id) {
    const note = this.#liveNote(id);
    return {
      id: note.id,
      title: note.title,
      kind: note.kind,
      date: note.date,
      tags: note.tags.map((t) => t.path),
      revision: note.revision,
      updatedAt: note.updatedAt,
      markdown: docToMarkdown(note.doc),
      tasks: extractTasks(note.doc, note.date),
    };
  }

  assistantUpdateTask(noteId, taskId, patch) {
    const note = this.#liveNote(noteId);
    const clean = {};
    for (const [k, v] of Object.entries(patch ?? {})) {
      if (k === 'checked' || k === 'hidden') {
        if (typeof v !== 'boolean') throw new HttpError(400, 'bad_task', `"${k}" must be true or false`);
        clean[k] = v;
      } else if (k === 'due' || k === 'start') {
        if (v !== null && !isValidDateString(v)) throw new HttpError(400, 'bad_task', `"${k}" must be YYYY-MM-DD or null`);
        clean[k] = v;
      }
    }
    if (Object.keys(clean).length === 0) throw new HttpError(400, 'bad_task', 'Nothing to change (use checked, due, start or hidden)');
    const doc = updateTask(note.doc, taskId, clean);
    if (!doc) throw new HttpError(404, 'not_found', 'Task not found in that note');
    const res = this.saveNote(noteId, { baseRevision: note.revision, doc, docFormat: DOC_FORMAT, opId: uuid() });
    return { id: noteId, taskId, revision: res.revision };
  }

  // What is open right now, with where each task sits: overdue / today / upcoming (next 7 days) / later / nodate.
  assistantOverview() {
    const today = this.#today();
    const soon = dateInTz(new Date(Date.now() + 7 * 86_400_000), this.cfg.tz);
    const tasks = this.listTasks()
      .filter((t) => !t.checked && !t.hidden && !(t.start && t.start > today))
      .map((t) => ({
        ...t,
        bucket: !t.due ? 'nodate' : t.due < today ? 'overdue' : t.due === today ? 'today' : t.due <= soon ? 'upcoming' : 'later',
      }));
    return { today, tasks };
  }

  // ---------- settings (the meta table) ----------

  // dailyTag: whose entry for today the Today screen shows for writing.
  getSettings() {
    const row = this.db.prepare("SELECT value FROM meta WHERE key = 'daily_tag'").get();
    return { dailyTag: row?.value ?? DEFAULT_DAILY_TAG };
  }

  setDailyTag(rawPath) {
    const path = normalizeTag(rawPath);
    if (!path) throw new HttpError(400, 'bad_tag', 'Tag names use letters, numbers, - _ . and / for sub-tags');
    this.db.prepare("INSERT INTO meta (key, value) VALUES ('daily_tag', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(path);
    return this.getSettings();
  }

  // ---------- tasks ----------

  // Every task in every live note, newest note first, in document order within a note.
  listTasks() {
    const rows = this.db
      .prepare(`SELECT * FROM notes WHERE deleted_at IS NULL AND doc LIKE '%"taskItem"%' ORDER BY note_date DESC, created_at DESC, id`)
      .all();
    const tagsOf = this.#tagsByNote(rows.map((r) => r.id));
    const tasks = [];
    for (const row of rows) {
      const note = this.#toNote(row, tagsOf.get(row.id));
      for (const t of extractTasks(note.doc, note.date)) {
        tasks.push({
          noteId: note.id,
          taskId: t.id,
          text: t.text,
          checked: t.checked,
          due: t.due,
          start: t.start,
          hidden: t.hidden,
          dueFrom: t.dueFrom,
          startFrom: t.startFrom,
          date: note.date,
          tags: note.tags.map((x) => x.path),
        });
      }
    }
    return tasks;
  }

  // ---------- reading ----------

  getNote(id) {
    const row = this.db.prepare('SELECT * FROM notes WHERE id = ?').get(id);
    if (!row) return null;
    return this.#notes([row])[0];
  }

  // Exact-tag stream, newest date first. Only dates that have a note are listed; the client adds
  // today's editable entry itself. Pages are whole days (`limit` days), so a day with several notes is
  // never split across pages; within a day the daily note comes first, then free notes newest first.
  stream(rawPath, { before = null, limit = 14 } = {}) {
    const path = normalizeTag(rawPath);
    if (!path) throw new HttpError(400, 'bad_tag', 'Invalid tag');
    if (before !== null && !isValidDateString(before)) throw new HttpError(400, 'bad_date', 'Invalid "before" date');
    limit = Math.min(Math.max(Number(limit) || 14, 1), 60);
    const tag = this.db.prepare('SELECT id, path, daily FROM tags WHERE path = ?').get(path);
    // A tag that does not exist yet is a new daily stream (that is how a stream starts).
    if (!tag) return { tag: { id: null, path, daily: true }, notes: [], hasMore: false };
    const info = { id: tag.id, path: tag.path, daily: tag.daily === 1 };
    const dates = this.db
      .prepare(
        `SELECT DISTINCT nt.note_date AS d FROM note_tags nt JOIN notes n ON n.id = nt.note_id
         WHERE nt.tag_id = ? AND nt.live = 1 AND n.deleted_at IS NULL AND (? IS NULL OR nt.note_date < ?)
         ORDER BY d DESC LIMIT ?`,
      )
      .all(tag.id, before, before, limit + 1)
      .map((r) => r.d);
    const hasMore = dates.length > limit;
    const shown = dates.slice(0, limit);
    if (shown.length === 0) return { tag: info, notes: [], hasMore: false };
    const rows = this.db
      .prepare(
        `SELECT n.* FROM note_tags nt JOIN notes n ON n.id = nt.note_id
         WHERE nt.tag_id = ? AND nt.live = 1 AND n.deleted_at IS NULL AND nt.note_date >= ? AND (? IS NULL OR nt.note_date < ?)
         ORDER BY nt.note_date DESC, CASE n.kind WHEN 'daily' THEN 0 ELSE 1 END, n.created_at DESC`,
      )
      .all(tag.id, shown[shown.length - 1], before, before);
    return { tag: info, notes: this.#notes(rows), hasMore };
  }

  // All live notes, most recently changed first, for the Notes page. Filters: tag (exact, or with its
  // sub-tags when `sub` is true), untagged, and a text search over the note's words.
  listNotes({ tag = null, sub = false, untagged = false, q = '', limit = 30, offset = 0 } = {}) {
    limit = Math.min(Math.max(Number(limit) || 30, 1), 100);
    offset = Math.max(Number(offset) || 0, 0);
    const where = ['n.deleted_at IS NULL'];
    const args = [];
    if (untagged) {
      where.push('NOT EXISTS (SELECT 1 FROM note_tags x WHERE x.note_id = n.id)');
    } else if (tag) {
      const path = normalizeTag(tag);
      if (!path) throw new HttpError(400, 'bad_tag', 'Invalid tag');
      where.push(
        `EXISTS (SELECT 1 FROM note_tags x JOIN tags t ON t.id = x.tag_id WHERE x.note_id = n.id AND (t.path = ?${
          sub ? " OR t.path LIKE ? ESCAPE '\\'" : ''
        }))`,
      );
      args.push(path);
      if (sub) args.push(`${path.replace(/[\\%_]/g, (c) => `\\${c}`)}/%`); // _ is a LIKE wildcard and legal in tags
    }
    const needle = String(q ?? '').trim().toLowerCase();
    const sql = `SELECT n.* FROM notes n WHERE ${where.join(' AND ')} ORDER BY n.updated_at DESC, n.id`;
    let rows;
    let hasMore;
    if (needle) {
      // The words live inside the JSON documents, so search in code; fine at personal scale.
      const all = this.db
        .prepare(sql)
        .all(...args)
        .filter((r) => `${r.title ?? ''}\n${plainText(JSON.parse(r.doc))}`.toLowerCase().includes(needle));
      hasMore = all.length > offset + limit;
      rows = all.slice(offset, offset + limit);
    } else {
      rows = this.db.prepare(`${sql} LIMIT ? OFFSET ?`).all(...args, limit + 1, offset);
      hasMore = rows.length > limit;
      rows = rows.slice(0, limit);
    }
    const tagsOf = this.#tagsByNote(rows.map((r) => r.id));
    const notes = rows.map((r) => {
      const lines = plainText(JSON.parse(r.doc))
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);
      return {
        id: r.id,
        date: r.note_date,
        kind: r.kind,
        revision: r.revision,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        // A name wins; otherwise the first line stands in for one.
        title: r.title || (lines[0] ?? '').slice(0, 120),
        named: !!r.title,
        preview: (r.title ? lines : lines.slice(1)).join(' · ').slice(0, 200),
        tags: tagsOf.get(r.id),
      };
    });
    return { notes, hasMore };
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
    // title is optional and only free notes have one. Left out = leave the stored title alone.
    const hasTitle = Object.hasOwn(body, 'title');
    const title = hasTitle ? cleanTitle(body.title) : undefined;

    return tx(this.db, () => {
      const note = this.db.prepare('SELECT * FROM notes WHERE id = ?').get(id);

      if (!note) return this.#createNote(id, body, docStr, opId, title ?? null);

      if (note.deleted_at) {
        if (note.doc !== docStr) this.#storeConflictCopy(id, baseRevision, docStr);
        return { status: 'conflict', reason: 'deleted', note: this.#notes([note])[0] };
      }

      const nextTitle = note.kind === 'note' && hasTitle ? title : note.title;
      if (note.doc === docStr && nextTitle === note.title) {
        return { status: 'ok', revision: note.revision, updatedAt: note.updated_at, unchanged: true };
      }

      const lineageCurrent =
        baseRevision === note.revision || (note.last_op_id !== null && afterOps.includes(note.last_op_id));
      if (!lineageCurrent) {
        if (note.doc !== docStr) this.#storeConflictCopy(id, baseRevision, docStr);
        return { status: 'conflict', reason: 'revision', note: this.#notes([note])[0] };
      }

      // Keep the previous content as a version, but not on every keystroke.
      const now = nowIso();
      const sinceSnap = Date.now() - Date.parse(note.last_snapshot_at ?? note.created_at);
      const oldLen = plainText(JSON.parse(note.doc)).trim().length;
      let snapKind = null;
      if (oldLen > 0 && note.doc !== docStr) {
        // keepPrevious: the sender is deliberately replacing content it had a conflict with.
        if (body.keepPrevious === true || sinceSnap >= this.cfg.versionIntervalMinutes * 60_000) snapKind = 'auto';
        else if (oldLen >= 20 && plainText(body.doc).trim().length < oldLen * 0.5) snapKind = 'guard';
      }
      if (snapKind) this.#addVersion(id, note.revision, note.doc, snapKind, note.doc_format);

      const revision = note.revision + 1;
      this.db
        .prepare(
          `UPDATE notes SET doc = ?, doc_format = ?, revision = ?, last_op_id = ?, updated_at = ?, last_snapshot_at = ?, title = ?
           WHERE id = ?`,
        )
        .run(docStr, DOC_FORMAT, revision, opId, now, snapKind ? now : note.last_snapshot_at, nextTitle, id);
      if (snapKind) this.#pruneVersions(id);
      return { status: 'ok', revision, updatedAt: now };
    });
  }

  #createNote(id, body, docStr, opId, title) {
    if (!isValidDateString(body.date)) throw new HttpError(400, 'bad_date', 'A valid note date (YYYY-MM-DD) is required');
    // 'daily' (default) is a stream's entry for a day; 'note' is a free note (no slot, may be untagged).
    const kind = body.kind === 'note' ? 'note' : 'daily';
    const paths = [...new Set((Array.isArray(body.tags) ? body.tags : []).map(normalizeTag))];
    if (paths.includes(null) || (kind === 'daily' && paths.length === 0)) throw new HttpError(400, 'bad_tag', 'At least one valid tag is required');

    const tags = paths.map((p) => this.#ensureTag(p, { daily: kind === 'daily' }));
    const holders = new Map();
    for (const t of kind === 'daily' ? tags : []) {
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
        `INSERT INTO notes (id, note_date, doc, doc_format, revision, last_op_id, created_at, updated_at, last_snapshot_at, kind, title)
         VALUES (?,?,?,?,1,?,?,?,?,?,?)`,
      )
      .run(id, body.date, docStr, DOC_FORMAT, opId, now, now, now, kind, kind === 'note' ? title : null);
    const link = this.db.prepare('INSERT INTO note_tags (note_id, tag_id, note_date, live, slot) VALUES (?,?,?,1,?)');
    for (const t of tags) link.run(id, t.id, body.date, kind === 'daily' ? 1 : 0);
    return { status: 'ok', revision: 1, updatedAt: now, created: true };
  }

  // ---------- tag membership ----------

  addTagToNote(noteId, rawPath) {
    const path = normalizeTag(rawPath);
    if (!path) throw new HttpError(400, 'bad_tag', 'Invalid tag name');
    return tx(this.db, () => {
      const note = this.db.prepare('SELECT * FROM notes WHERE id = ? AND deleted_at IS NULL').get(noteId);
      if (!note) throw new HttpError(404, 'not_found', 'Note not found (it may not be saved on the server yet)');
      const tag = this.#ensureTag(path, { daily: note.kind === 'daily' });
      const has = this.db.prepare('SELECT 1 FROM note_tags WHERE note_id = ? AND tag_id = ?').get(noteId, tag.id);
      if (!has) {
        const daily = note.kind === 'daily';
        const holder = daily ? this.#slotHolder(tag.id, note.note_date, noteId) : null;
        if (holder) {
          throw new HttpError(409, 'slot_taken', `"${path}" already has a note for ${note.note_date}`, { tag: path, date: note.note_date });
        }
        this.db.prepare('INSERT INTO note_tags (note_id, tag_id, note_date, live, slot) VALUES (?,?,?,1,?)').run(noteId, tag.id, note.note_date, daily ? 1 : 0);
      }
      return this.#tagsByNote([noteId]).get(noteId);
    });
  }

  removeTagFromNote(noteId, tagId) {
    return tx(this.db, () => {
      const note = this.db.prepare('SELECT * FROM notes WHERE id = ? AND deleted_at IS NULL').get(noteId);
      if (!note) throw new HttpError(404, 'not_found', 'Note not found');
      const count = this.db.prepare('SELECT COUNT(*) AS c FROM note_tags WHERE note_id = ?').get(noteId).c;
      if (count <= 1 && note.kind === 'daily') throw new HttpError(409, 'last_tag', 'A note needs at least one tag');
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
        .prepare('SELECT nt.tag_id, nt.slot, t.path FROM note_tags nt JOIN tags t ON t.id = nt.tag_id WHERE nt.note_id = ?')
        .all(id);
      const taken = links.filter((l) => l.slot === 1 && this.#slotHolder(l.tag_id, note.note_date, id));
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
