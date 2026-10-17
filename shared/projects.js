// Projects and Waiting on (see docs/PROJECTS.md).
//
// A project is a small record (table `projects`): a name, an area (Personal, School or Club), a status, the tag whose
// notes belong to it (by tag id, so renaming or moving the tag keeps it), and optionally an overview note. A note is in
// a project when it carries that tag or a tag under it. A task is in its note's project unless the task names a project
// of its own (taskItem `project`). A task may also name a person (`person`, a People note id) and be waiting for their
// reply since a day (`waitingSince`). These are pure rules used by the server, the phone and the assistant alike.
import { isValidDateString } from './dates.js';

export const AREAS = ['personal', 'school', 'club'];
export const AREA_LABEL = { personal: 'Personal', school: 'School', club: 'Club' };
export const STATUSES = ['active', 'done', 'archived'];
export const STATUS_LABEL = { active: 'Active', done: 'Done', archived: 'Archived' };
/** Where a new project's tag is made when none is chosen: the vault's area folders. Settings can change them. */
export const DEFAULT_AREA_FOLDERS = { personal: '30-personal', school: '10-school', club: '20-css' };
export const MAX_NAME = 120;

const ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
export const isProjectId = (v) => typeof v === 'string' && ID_RE.test(v);

/**
 * A project's editable fields, checked: { name, area, status, overviewNoteId, sort }. `partial` checks only what is
 * given (an edit). Throws an Error saying what is wrong.
 */
export function cleanProjectFields(raw, { partial = false } = {}) {
  if (!raw || typeof raw !== 'object') throw new Error('Missing project');
  const out = {};
  if (!partial || raw.name !== undefined) {
    const name = typeof raw.name === 'string' ? raw.name.replace(/\s+/g, ' ').trim() : '';
    if (!name || name.length > MAX_NAME) throw new Error(`A project needs a name of 1 to ${MAX_NAME} characters`);
    out.name = name;
  }
  if (!partial || raw.area !== undefined) {
    if (!AREAS.includes(raw.area)) throw new Error('"area" must be personal, school or club');
    out.area = raw.area;
  }
  if (raw.status !== undefined || !partial) {
    const status = raw.status ?? 'active';
    if (!STATUSES.includes(status)) throw new Error('"status" must be active, done or archived');
    out.status = status;
  }
  if (raw.overviewNoteId !== undefined) {
    if (raw.overviewNoteId !== null && !isProjectId(raw.overviewNoteId)) throw new Error('"overviewNoteId" must be a note id or null');
    out.overviewNoteId = raw.overviewNoteId;
  }
  if (raw.sort !== undefined) {
    if (!Number.isInteger(raw.sort) || Math.abs(raw.sort) > 1e6) throw new Error('"sort" must be a whole number');
    out.sort = raw.sort;
  }
  return out;
}

/** The area folders setting, checked: every area named, each a plain tag path. Unknown keys are dropped. */
export function cleanAreaFolders(raw, normalizeTag) {
  const out = { ...DEFAULT_AREA_FOLDERS };
  if (!raw || typeof raw !== 'object') return out;
  for (const a of AREAS) {
    const p = normalizeTag(raw[a]);
    if (p) out[a] = p;
  }
  return out;
}

/** True when a note with these tag paths is in a project whose tag is `tag` (the tag itself or one under it). */
export const tagInProject = (path, tag) => !!tag && (path === tag || path.startsWith(`${tag}/`));

/**
 * The project a task row is in, or null: the task's own `project` when that project exists, else the project whose tag
 * the note carries (the most specific tag wins when several match; then the first by name). Projects that were removed
 * do not count; done and archived ones still do (the task stays theirs).
 */
export function projectOfTask(task, projects) {
  if (task.project) {
    const own = projects.find((p) => p.id === task.project);
    if (own) return own;
  }
  return projectOfNote(task.tags ?? [], projects);
}

/** The project a note with these tag paths is in, or null (see projectOfTask). */
export function projectOfNote(tags, projects) {
  let best = null;
  for (const p of projects) {
    if (!p.tag || !tags.some((t) => tagInProject(t, p.tag))) continue;
    if (!best || p.tag.length > best.tag.length || (p.tag.length === best.tag.length && p.name.localeCompare(best.name) < 0)) best = p;
  }
  return best;
}

/** Whole days a task has been waiting by `today` (0 = since today). */
export function waitingDays(since, today) {
  if (!isValidDateString(since) || !isValidDateString(today)) return 0;
  return Math.max(0, Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${since}T00:00:00Z`)) / 86_400_000));
}

/** "waiting since today", "waiting 1 day", "waiting 12 days". */
export function waitingLabel(since, today) {
  const n = waitingDays(since, today);
  return n === 0 ? 'waiting since today' : `waiting ${n} ${n === 1 ? 'day' : 'days'}`;
}

/** An open task that is waiting on someone: not done, not dismissed, with a waiting day. */
export const isWaiting = (t) => !!t.waitingSince && !t.checked && !t.dismissedAt;

/** Waiting tasks, the longest waiting first. */
export const byWaitingLongest = (a, b) => (a.waitingSince ?? '').localeCompare(b.waitingSince ?? '') || a.text.localeCompare(b.text);