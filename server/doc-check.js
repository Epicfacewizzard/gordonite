// Which stored documents break the document rules (shared/doc.js)?
//
// Read-only: it reports and never changes a note. The rules about how nodes nest were added after notes already
// existed, so this is how an owner can see whether any stored note (or saved version of one) predates them. Such a
// note stays editable and keeps its text; it is simply not something the editor's own schema would have written.
import { validateDoc } from '../shared/doc.js';

function problemOf(json, format) {
  let doc;
  try {
    doc = JSON.parse(json);
  } catch {
    return 'the stored document is not valid JSON';
  }
  return validateDoc(doc, format);
}

/** { notes, versions, problems: [{ kind: 'note' | 'version', id, noteId, date, title, trashed, error }] } */
export function checkDocs(db) {
  const problems = [];
  let notes = 0;
  let versions = 0;
  for (const r of db.prepare('SELECT id, note_date, title, doc, doc_format, deleted_at FROM notes ORDER BY note_date, id').iterate()) {
    notes++;
    const error = problemOf(r.doc, r.doc_format);
    if (error) problems.push({ kind: 'note', id: r.id, noteId: r.id, date: r.note_date, title: r.title ?? null, trashed: !!r.deleted_at, error });
  }
  const sql = `SELECT v.id, v.note_id, v.revision, v.doc, v.doc_format, n.note_date, n.title, n.deleted_at
               FROM note_versions v LEFT JOIN notes n ON n.id = v.note_id ORDER BY n.note_date, v.note_id, v.revision`;
  for (const r of db.prepare(sql).iterate()) {
    versions++;
    const error = problemOf(r.doc, r.doc_format);
    if (error) problems.push({ kind: 'version', id: r.id, noteId: r.note_id, revision: r.revision, date: r.note_date ?? null, title: r.title ?? null, trashed: !!r.deleted_at, error });
  }
  return { notes, versions, problems };
}
