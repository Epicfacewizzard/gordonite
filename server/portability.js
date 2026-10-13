import fs from 'node:fs';
import path from 'node:path';
import { tx } from './db.js';
import { createBackup } from './backup.js';
import { HttpError } from './errors.js';
import { checkId } from './ids.js';
import { exportSettings, importSettings, savedTimeZone } from './settings.js';
import { noteToMarkdownFile } from './markdown.js';
import { makeZip } from './zip.js';
import { uuid } from '../shared/ids.js';
import { normalizeTag } from '../shared/tags.js';
import { isValidDateString } from '../shared/dates.js';
import { DOC_FORMAT, attachmentsIn, migrateDoc, validateDoc } from '../shared/doc.js';
import { cleanFileName, isPlausibleMime, kindOfType } from '../shared/attachments.js';

export const EXPORT_FORMAT = 'hq-export';
export const EXPORT_FORMAT_VERSION = 1;

// ---------- full-fidelity JSON export ----------

export function exportAll(db, cfg) {
  const tags = db
    .prepare('SELECT id, path, created_at AS createdAt, favorite, daily FROM tags ORDER BY path')
    .all()
    .map((t) => ({ ...t, favorite: t.favorite === 1, daily: t.daily === 1 }));
  const links = db.prepare('SELECT note_id, tag_id FROM note_tags ORDER BY note_id, tag_id').all();
  const byNote = new Map();
  for (const l of links) {
    if (!byNote.has(l.note_id)) byNote.set(l.note_id, []);
    byNote.get(l.note_id).push(l.tag_id);
  }
  const versions = new Map();
  for (const v of db.prepare('SELECT * FROM note_versions ORDER BY created_at, rowid').all()) {
    if (!versions.has(v.note_id)) versions.set(v.note_id, []);
    versions.get(v.note_id).push({
      id: v.id,
      revision: v.revision,
      kind: v.kind,
      createdAt: v.created_at,
      docFormat: v.doc_format,
      doc: JSON.parse(v.doc),
    });
  }
  const notes = db
    .prepare('SELECT * FROM notes ORDER BY note_date, created_at, id')
    .all()
    .map((n) => ({
      id: n.id,
      kind: n.kind,
      title: n.title ?? null,
      date: n.note_date,
      docFormat: n.doc_format,
      doc: JSON.parse(n.doc),
      revision: n.revision,
      createdAt: n.created_at,
      updatedAt: n.updated_at,
      deletedAt: n.deleted_at,
      tags: byNote.get(n.id) ?? [],
      versions: versions.get(n.id) ?? [],
    }));
  return {
    format: EXPORT_FORMAT,
    formatVersion: EXPORT_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    homeTimeZone: cfg.tz,
    settings: exportSettings(db),
    tags,
    notes,
    moods: db
      .prepare('SELECT id, score, note, day, logged_at AS loggedAt, created_at AS createdAt, deleted_at AS deletedAt FROM mood_entries ORDER BY logged_at, id')
      .all(),
    // What the files are called and where they are used. The bytes are not in this JSON: take them with the files
    // zip (Data page) or by copying the files folder next to the database.
    attachments: db
      .prepare(
        `SELECT id, sha256, name, mime, size, kind, original_sha256 AS originalSha256, original_name AS originalName,
                original_mime AS originalMime, original_size AS originalSize, note_id AS noteId, source, created_at AS createdAt
         FROM attachments WHERE deleted_at IS NULL ORDER BY created_at, id`,
      )
      .all(),
  };
}

// ---------- the files themselves ----------

// The zips are built in memory, so there is a ceiling. Past it, copy the files folder instead.
const MAX_ZIP_BYTES = 1024 * 1024 * 1024;

function zipFileEntries(rows, files, folder, budget = MAX_ZIP_BYTES) {
  const entries = [];
  const skipped = [];
  let total = 0;
  const seen = new Set();
  for (const r of rows) {
    const info = files.fileFor(r.id);
    if (!info) {
      skipped.push({ id: r.id, name: r.name, why: 'file is missing on disk' });
      continue;
    }
    if (total + info.size > budget) {
      skipped.push({ id: r.id, name: r.name, why: 'over the size limit for one zip' });
      continue;
    }
    const entry = `${folder}/${r.id}-${cleanFileName(r.name)}`;
    if (seen.has(entry)) continue;
    seen.add(entry);
    total += info.size;
    entries.push({ name: entry, data: fs.readFileSync(info.path), row: r });
  }
  return { entries, skipped, total };
}

/** Every file in one zip: files/<id>-<name> plus index.json (id, name, type, size, note). */
export function exportFilesZip(db, files) {
  const rows = db.prepare('SELECT id, name, mime, size, kind, note_id, created_at FROM attachments WHERE deleted_at IS NULL ORDER BY created_at, id').all();
  const { entries, skipped } = zipFileEntries(rows, files, 'files');
  if (skipped.some((x) => x.why.startsWith('over'))) {
    throw new HttpError(413, 'too_big', `Your files total more than ${Math.round(MAX_ZIP_BYTES / 1024 / 1024)} MB, which is too much for one download. Copy the "files" folder beside the database instead.`);
  }
  const index = {
    exportedAt: new Date().toISOString(),
    files: entries.map((e) => ({ path: e.name, id: e.row.id, name: e.row.name, mime: e.row.mime, size: e.row.size, noteId: e.row.note_id, createdAt: e.row.created_at })),
    missing: skipped,
  };
  return makeZip([...entries.map(({ name, data }) => ({ name, data })), { name: 'index.json', data: JSON.stringify(index, null, 1) }]);
}

// ---------- readable Markdown export (zip of tag/date.md files) ----------

export function exportMarkdownZip(store, db, fileStore = null) {
  const rows = db.prepare('SELECT id FROM notes WHERE deleted_at IS NULL ORDER BY note_date').all();
  const out = [];
  const used = new Map(); // attachment id -> its attrs, for the files saved beside the notes
  for (const { id } of rows) {
    const note = store.getNote(id);
    for (const a of attachmentsIn(note.doc)) used.set(a.id, a);
    // A note with several tags appears under each tag; the id in its front matter ties them together.
    // A free note can share a day with other notes (and may have no tag), so its file name carries its id.
    const stem = note.kind === 'note' ? `${note.date}-${note.id.slice(0, 8)}` : note.date;
    const folders = note.tags.length ? note.tags.map((t) => t.path) : ['untagged'];
    for (const folder of folders) {
      // Files sit in attachments/ at the top; a note in a/b/ is two folders deep.
      const up = '../'.repeat(folder.split('/').length);
      const fileHref = (a) => `${up}attachments/${encodeURIComponent(`${a.id}-${cleanFileName(a.name)}`)}`;
      out.push({ name: `${folder}/${stem}.md`, data: noteToMarkdownFile(note, { fileHref }) });
    }
  }
  let fileNote = '';
  if (fileStore && used.size) {
    const wanted = [...used.values()].map((a) => ({ id: a.id, name: a.name }));
    const { entries, skipped } = zipFileEntries(wanted, fileStore, 'attachments');
    out.push(...entries.map(({ name, data }) => ({ name, data })));
    if (skipped.length) fileNote = `\n${skipped.length} attached file(s) are not in this export: ${skipped.map((x) => x.name).join(', ')}.\n`;
  }
  out.push({
    name: 'README.txt',
    data:
      'Personal HQ Markdown export.\n\nOne file per tag per day: <tag>/<date>.md. A note with several tags is\nrepeated under each tag (same "id" in the front matter). Task ids and version\nhistory are not included; use the JSON export for a full-fidelity backup.\nFiles attached to notes are in attachments/, linked from the notes that use them.\n' + fileNote,
  });
  return makeZip(out);
}

// ---------- import ----------

// Returns { nestingProblems }: documents that are fine except for how their nodes are nested. They are imported as
// they are, never rewritten and never a reason to refuse a restore; the report lists them (see check-docs).
function validateExport(data) {
  const bad = (m) => new HttpError(400, 'bad_import', `Not a valid Personal HQ export: ${m}`);
  const nestingProblems = [];
  if (!data || data.format !== EXPORT_FORMAT) throw bad('missing format marker');
  if (data.formatVersion !== EXPORT_FORMAT_VERSION) throw bad(`unsupported formatVersion ${data.formatVersion}`);
  if (!Array.isArray(data.tags) || !Array.isArray(data.notes)) throw bad('tags and notes must be arrays');

  const tagIds = new Map();
  const seenPaths = new Set();
  for (const t of data.tags) {
    checkId(t?.id, 'tag id');
    if (normalizeTag(t.path) !== t.path) throw bad(`invalid tag path "${t.path}"`);
    if (seenPaths.has(t.path) || tagIds.has(t.id)) throw bad(`duplicate tag "${t.path}"`);
    seenPaths.add(t.path);
    tagIds.set(t.id, t);
  }
  if (data.moods !== undefined) {
    if (!Array.isArray(data.moods)) throw bad('moods must be an array');
    for (const m of data.moods) {
      checkId(m?.id, 'mood id');
      if (!Number.isInteger(m.score) || m.score < 1 || m.score > 5) throw bad(`mood ${m.id}: bad score`);
      if (!isValidDateString(m.day) || Number.isNaN(Date.parse(m.loggedAt))) throw bad(`mood ${m.id}: bad day or time`);
    }
  }
  const noteIds = new Set();
  const slots = new Set();
  for (const n of data.notes) {
    checkId(n?.id, 'note id');
    if (noteIds.has(n.id)) throw bad(`duplicate note ${n.id}`);
    noteIds.add(n.id);
    if (!isValidDateString(n.date)) throw bad(`note ${n.id}: bad date`);
    for (const d of [n.doc, ...(n.versions ?? []).map((v) => v.doc)]) {
      const err = validateDoc(d, DOC_FORMAT, { structure: false });
      if (err) throw bad(`note ${n.id}: ${err}`);
      const nesting = validateDoc(d);
      if (nesting) nestingProblems.push({ note: n.id, problem: nesting });
    }
    if (n.kind !== undefined && n.kind !== 'daily' && n.kind !== 'note') throw bad(`note ${n.id}: unknown kind "${n.kind}"`);
    const free = n.kind === 'note'; // free notes may be untagged and may share a day with other notes
    if (!Array.isArray(n.tags) || (n.tags.length === 0 && !free)) throw bad(`note ${n.id}: needs at least one tag`);
    for (const tid of n.tags) {
      if (!tagIds.has(tid)) throw bad(`note ${n.id}: unknown tag id ${tid}`);
      if (!n.deletedAt && !free) {
        const key = `${tid}|${n.date}`;
        if (slots.has(key)) throw bad(`two live notes share tag "${tagIds.get(tid).path}" on ${n.date}`);
        slots.add(key);
      }
    }
  }
  return { nestingProblems };
}

const docOf = (n) => JSON.stringify(n.docFormat === DOC_FORMAT ? n.doc : migrateDoc(n.doc, n.docFormat));

export function importAll(db, cfg, data, mode) {
  if (mode !== 'merge' && mode !== 'replace') throw new HttpError(400, 'bad_mode', 'mode must be "merge" or "replace"');
  const { nestingProblems } = validateExport(data);

  // Always snapshot the current database first, so even "replace" can be undone.
  const preImportBackup = createBackup(db, cfg, 'preimport').file;
  const report = {
    mode,
    preImportBackup,
    attachmentsAdded: 0,
    attachmentsMissingFiles: 0,
    notesCreated: 0,
    notesIdentical: 0,
    notesKeptBothVersions: 0,
    membershipsDropped: [],
    tagsCreated: 0,
    moodsAdded: 0,
  };

  const insertNote = db.prepare(
    `INSERT INTO notes (id, note_date, doc, doc_format, revision, last_op_id, created_at, updated_at, deleted_at, last_snapshot_at, kind, title)
     VALUES (?,?,?,?,?,NULL,?,?,?,?,?,?)`,
  );
  const insertLink = db.prepare('INSERT INTO note_tags (note_id, tag_id, note_date, live, slot) VALUES (?,?,?,?,?)');
  const insertVersion = db.prepare(
    'INSERT OR IGNORE INTO note_versions (id, note_id, revision, doc, doc_format, kind, created_at) VALUES (?,?,?,?,?,?,?)',
  );
  const addVersions = (n) => {
    for (const v of n.versions ?? []) {
      const doc = JSON.stringify(v.docFormat === DOC_FORMAT ? v.doc : migrateDoc(v.doc, v.docFormat));
      insertVersion.run(v.id && /^[A-Za-z0-9_-]{8,64}$/.test(v.id) ? v.id : uuid(), n.id, v.revision ?? 0, doc, DOC_FORMAT, v.kind ?? 'auto', v.createdAt ?? new Date().toISOString());
    }
  };
  const addNote = (n, tagIdFor, links) => {
    const doc = docOf(n);
    const kind = n.kind === 'note' ? 'note' : 'daily';
    insertNote.run(n.id, n.date, doc, DOC_FORMAT, n.revision ?? 1, n.createdAt, n.updatedAt, n.deletedAt ?? null, n.updatedAt, kind, kind === 'note' && typeof n.title === 'string' ? n.title.slice(0, 120) : null);
    for (const tid of links) insertLink.run(n.id, tagIdFor(tid), n.date, n.deletedAt ? 0 : 1, kind === 'daily' ? 1 : 0);
    addVersions(n);
  };

  const addMoods = () => {
    const insert = db.prepare('INSERT OR IGNORE INTO mood_entries (id, score, note, day, logged_at, created_at, deleted_at) VALUES (?,?,?,?,?,?,?)');
    for (const m of data.moods ?? []) {
      const res = insert.run(m.id, m.score, typeof m.note === 'string' ? m.note.slice(0, 280) : null, m.day, new Date(m.loggedAt).toISOString(), m.createdAt ?? new Date().toISOString(), m.deletedAt ?? null);
      report.moodsAdded += Number(res.changes);
    }
  };

  // File records come across only when their bytes are already here (copied with the files folder, or the same
  // server). Records for files this server does not have are skipped and counted, never created empty.
  const addAttachments = () => {
    const insert = db.prepare(
      `INSERT OR IGNORE INTO attachments (id, sha256, name, mime, size, kind, original_sha256, original_name, original_mime, original_size, note_id, source, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,'import',?)`,
    );
    const present = (sha) => typeof sha === 'string' && /^[0-9a-f]{64}$/.test(sha) && fs.existsSync(path.join(cfg.filesDir, sha.slice(0, 2), sha));
    for (const a of data.attachments ?? []) {
      if (!a || !/^[A-Za-z0-9_-]{8,64}$/.test(a.id) || !Number.isInteger(a.size) || !isPlausibleMime(a.mime)) continue;
      if (!present(a.sha256)) {
        report.attachmentsMissingFiles++;
        continue;
      }
      const original = present(a.originalSha256) ? a : null;
      const res = insert.run(
        a.id,
        a.sha256,
        cleanFileName(a.name),
        a.mime,
        a.size,
        kindOfType(a.mime),
        original?.originalSha256 ?? null,
        original ? cleanFileName(a.originalName) : null,
        original?.originalMime ?? null,
        original?.originalSize ?? null,
        typeof a.noteId === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(a.noteId) ? a.noteId : null,
        typeof a.createdAt === 'string' && !Number.isNaN(Date.parse(a.createdAt)) ? new Date(a.createdAt).toISOString() : new Date().toISOString(),
      );
      report.attachmentsAdded += Number(res.changes);
    }
  };

  tx(db, () => {
    const tagIdFor = new Map(); // import tag id -> local tag id

    // Settings: replace takes the export's; merge only fills in what is not set here (see settings.js).
    importSettings(db, data, mode);

    if (mode === 'replace') {
      db.exec('DELETE FROM note_versions; DELETE FROM note_tags; DELETE FROM notes; DELETE FROM tags; DELETE FROM mood_entries;');
      for (const t of data.tags) {
        db.prepare('INSERT INTO tags (id, path, created_at, favorite, daily) VALUES (?,?,?,?,?)').run(t.id, t.path, t.createdAt ?? new Date().toISOString(), t.favorite === true ? 1 : 0, t.daily === false ? 0 : 1);
        tagIdFor.set(t.id, t.id);
        report.tagsCreated++;
      }
      for (const n of data.notes) {
        addNote(n, (tid) => tagIdFor.get(tid), n.tags);
        report.notesCreated++;
      }
      addMoods();
      addAttachments();
      return;
    }

    // merge: add what is missing, never overwrite what exists.
    for (const t of data.tags) {
      const existing = db.prepare('SELECT id FROM tags WHERE path = ?').get(t.path);
      if (existing) {
        tagIdFor.set(t.id, existing.id);
      } else {
        const idTaken = db.prepare('SELECT 1 FROM tags WHERE id = ?').get(t.id);
        const id = idTaken ? uuid() : t.id;
        db.prepare('INSERT INTO tags (id, path, created_at, favorite, daily) VALUES (?,?,?,?,?)').run(id, t.path, t.createdAt ?? new Date().toISOString(), t.favorite === true ? 1 : 0, t.daily === false ? 0 : 1);
        tagIdFor.set(t.id, id);
        report.tagsCreated++;
      }
    }
    for (const n of data.notes) {
      const local = db.prepare('SELECT * FROM notes WHERE id = ?').get(n.id);
      const doc = docOf(n);
      if (local) {
        if (local.doc === doc) {
          report.notesIdentical++;
        } else {
          // Different content under the same id: keep the local note, keep the imported text as a version.
          insertVersion.run(uuid(), n.id, n.revision ?? 0, doc, DOC_FORMAT, 'import', new Date().toISOString());
          report.notesKeptBothVersions++;
        }
        continue;
      }
      let links = n.tags;
      if (!n.deletedAt && n.kind !== 'note') {
        const free = [];
        let holder = null;
        for (const tid of n.tags) {
          const h = db
            .prepare('SELECT n.id FROM note_tags nt JOIN notes n ON n.id = nt.note_id WHERE nt.tag_id = ? AND nt.note_date = ? AND nt.live = 1 AND nt.slot = 1')
            .get(tagIdFor.get(tid), n.date);
          if (h) {
            holder = h.id;
            report.membershipsDropped.push({ note: n.id, tag: data.tags.find((t) => t.id === tid).path, date: n.date });
          } else {
            free.push(tid);
          }
        }
        links = free;
        if (free.length === 0) {
          // Every slot is occupied: preserve the text as a version of the note that holds it.
          insertVersion.run(uuid(), holder, 0, doc, DOC_FORMAT, 'import', new Date().toISOString());
          report.notesKeptBothVersions++;
          continue;
        }
      }
      addNote(n, (tid) => tagIdFor.get(tid), links);
      report.notesCreated++;
    }
    addMoods();
    addAttachments();
  });
  const savedTz = savedTimeZone(db);
  if (savedTz) cfg.tz = savedTz;
  if (nestingProblems.length) report.nestingProblems = nestingProblems.slice(0, 50); // only present when there are some
  return report;
}
