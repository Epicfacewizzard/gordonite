// Projects (see docs/PROJECTS.md): a small record per project, with the tag whose notes are in it. Which tasks are in a
// project, and who they wait on, is read from the notes themselves (shared/projects.js), so nothing here copies a task.
import { tx } from './db.js';
import { HttpError } from './errors.js';
import { checkId } from './ids.js';
import { ensureTag } from './tags.js';
import { areaFolders } from './settings.js';
import { uuid } from '../shared/ids.js';
import { normalizeTag } from '../shared/tags.js';
import { cleanProjectFields, isWaiting, byWaitingLongest, projectOfTask, tagInProject } from '../shared/projects.js';

const fields = (raw, opts) => {
  try {
    return cleanProjectFields(raw, opts);
  } catch (err) {
    throw new HttpError(400, 'bad_project', err.message);
  }
};

const toProject = (r) => ({
  id: r.id,
  name: r.name,
  area: r.area,
  status: r.status,
  tagId: r.tag_id ?? null,
  tag: r.tag_path ?? null,
  overviewNoteId: r.overview_note_id ?? null,
  sort: r.sort,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  deletedAt: r.deleted_at ?? null,
});

const SELECT = 'SELECT p.*, t.path AS tag_path FROM projects p LEFT JOIN tags t ON t.id = p.tag_id';

/** A tag path for a new project: "<area folder>/<name as a tag>", e.g. "20-css/snack-olympics". */
export function tagForName(folder, name) {
  const leaf = name.toLowerCase().replace(/[^\p{L}\p{N}_.-]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'project';
  return normalizeTag(`${folder}/${leaf}`) ?? normalizeTag(leaf);
}

// The tag a create or an edit names: an existing tag id, or a path (made if it is not there yet).
function resolveTag(db, { tagId, tag }) {
  if (tagId != null) {
    const row = db.prepare('SELECT id FROM tags WHERE id = ?').get(checkId(tagId, 'tag id'));
    if (!row) throw new HttpError(404, 'tag_not_found', 'Tag not found');
    return row.id;
  }
  const path = normalizeTag(tag);
  if (!path) throw new HttpError(400, 'bad_tag', 'Tag names use letters, numbers, - _ . and / for sub-tags');
  return ensureTag(db, path, { daily: false }).id;
}

/** Live projects (removed ones with { removed: true }), by area, then sort, then name; each with how many notes are in it. */
export function listProjects(db, { removed = false } = {}) {
  const rows = db.prepare(`${SELECT} WHERE p.deleted_at IS ${removed ? 'NOT ' : ''}NULL ORDER BY p.area, p.sort, p.name COLLATE NOCASE, p.id`).all();
  const count = db.prepare(
    `SELECT COUNT(DISTINCT n.id) AS c FROM notes n JOIN note_tags x ON x.note_id = n.id JOIN tags t ON t.id = x.tag_id
     WHERE n.deleted_at IS NULL AND (t.path = ? OR t.path LIKE ? ESCAPE '\\')`,
  );
  return rows.map((r) => {
    const p = toProject(r);
    p.noteCount = p.tag ? count.get(p.tag, `${p.tag.replace(/[\\%_]/g, (c) => `\\${c}`)}/%`).c : 0;
    return p;
  });
}

export function getProjectRecord(db, id) {
  const row = db.prepare(`${SELECT} WHERE p.id = ?`).get(checkId(id, 'project id'));
  if (!row) throw new HttpError(404, 'not_found', 'Project not found');
  return toProject(row);
}

/**
 * Make a project. body: { name, area, status?, overviewNoteId?, tag? | tagId? }. With no tag, one is made from the name
 * in the area's folder (Settings → Projects); a tag that already exists is used as it is, so its notes join at once.
 */
export function createProject(db, body) {
  const f = fields(body ?? {});
  return tx(db, () => {
    const tagId = body.tagId != null || body.tag != null ? resolveTag(db, body) : ensureTag(db, tagForName(areaFolders(db)[f.area], f.name), { daily: false }).id;
    const now = new Date().toISOString();
    const id = uuid();
    const sort = f.sort ?? (db.prepare('SELECT MAX(sort) AS m FROM projects WHERE area = ?').get(f.area).m ?? -1) + 1;
    db.prepare(
      'INSERT INTO projects (id, name, area, status, tag_id, overview_note_id, sort, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)',
    ).run(id, f.name, f.area, f.status, tagId, f.overviewNoteId ?? null, sort, now, now);
    return getProjectRecord(db, id);
  });
}

/** Change what is given: { name, area, status, overviewNoteId, sort, tag | tagId }. */
export function updateProject(db, id, body) {
  const f = fields(body ?? {}, { partial: true });
  return tx(db, () => {
    const was = getProjectRecord(db, id);
    if (was.deletedAt) throw new HttpError(409, 'removed', 'This project was removed; bring it back first');
    const tagId = body.tagId !== undefined || body.tag !== undefined ? resolveTag(db, body) : was.tagId;
    const next = { ...was, ...f, tagId };
    if (Object.keys(f).length === 0 && tagId === was.tagId) throw new HttpError(400, 'bad_project', 'Nothing to change');
    db.prepare('UPDATE projects SET name = ?, area = ?, status = ?, tag_id = ?, overview_note_id = ?, sort = ?, updated_at = ? WHERE id = ?').run(
      next.name, next.area, next.status, next.tagId, next.overviewNoteId, next.sort, new Date().toISOString(), was.id,
    );
    return getProjectRecord(db, was.id);
  });
}

/** Remove (soft) or bring back. Its tag and notes stay; tasks naming it fall back to their note's project. */
export function setProjectRemoved(db, id, removed) {
  const was = getProjectRecord(db, id);
  db.prepare('UPDATE projects SET deleted_at = ?, updated_at = ? WHERE id = ?').run(removed ? new Date().toISOString() : null, new Date().toISOString(), was.id);
  return getProjectRecord(db, was.id);
}

/**
 * Put notes in a project by giving each the project's tag. { added: [noteId], already: [noteId], failed: [{ noteId,
 * message }] }: a daily note cannot take a tag that already has a daily note that day, so that one is reported.
 */
export function addNotesToProject(db, store, id, noteIds) {
  const p = getProjectRecord(db, id);
  if (p.deletedAt) throw new HttpError(409, 'removed', 'This project was removed; bring it back first');
  if (!p.tag) throw new HttpError(409, 'no_tag', 'This project has no tag yet');
  if (!Array.isArray(noteIds) || noteIds.length === 0 || noteIds.length > 200) throw new HttpError(400, 'bad_notes', '"noteIds" must list 1 to 200 note ids');
  const out = { added: [], already: [], failed: [] };
  for (const raw of noteIds) {
    const noteId = checkId(raw, 'note id');
    const note = store.getNote(noteId);
    if (!note) {
      out.failed.push({ noteId, message: 'Note not found' });
      continue;
    }
    if (note.tags.some((t) => tagInProject(t.path, p.tag))) {
      out.already.push(noteId);
      continue;
    }
    try {
      store.addTagToNote(noteId, p.tag);
      out.added.push(noteId);
    } catch (err) {
      if (!(err instanceof HttpError)) throw err;
      out.failed.push({ noteId, message: err.message });
    }
  }
  return out;
}

/** One project with its notes, its tasks (open, waiting, done) and the people its tasks are with. */
export function projectDetails(db, store, id) {
  const project = getProjectRecord(db, id);
  const live = listProjects(db);
  const notes = project.tag ? store.listNotes({ tag: project.tag, sub: true, limit: 100, sort: 'updated' }).notes : [];
  const tasks = store.listTasks().filter((t) => projectOfTask(t, live)?.id === project.id);
  return {
    project: { ...project, noteCount: live.find((p) => p.id === project.id)?.noteCount ?? notes.length },
    notes,
    tasks: {
      open: tasks.filter((t) => !t.checked && !t.dismissedAt && !isWaiting(t)),
      waiting: tasks.filter(isWaiting).sort(byWaitingLongest),
      doneCount: tasks.filter((t) => t.checked).length,
    },
    people: [...new Set(tasks.filter((t) => t.person && !t.checked && !t.dismissedAt).map((t) => t.person))],
  };
}

/** Every open task waiting on someone, the longest waiting first, with its project id (or null). */
export function waitingTasks(db, store, { person = null, project = null } = {}) {
  const live = listProjects(db);
  return store
    .listTasks()
    .filter(isWaiting)
    .map((t) => ({ ...t, projectId: projectOfTask(t, live)?.id ?? null }))
    .filter((t) => (!person || t.person === person) && (!project || t.projectId === project))
    .sort(byWaitingLongest);
}
