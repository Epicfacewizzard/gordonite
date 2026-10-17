// Tasks live inside note documents (taskItem nodes with a stable id), so there is no
// separate task table. These helpers read and change them in a document; the server
// uses extractTasks for the combined list and the client uses updateTask to change one
// without opening an editor.
//
// Tasks may carry optional scheduling, visibility, priority and lifecycle attributes.
// Picked dueTime/startTime are local HH:mm; text dates/times are interpreted by taskdates.js.
//   due    YYYY-MM-DD   when it is due
//   start  YYYY-MM-DD   it should not show up as "to do" before this day
//   hidden true         kept out of the combined Tasks list (still in its note)
//   hideUntil YYYY-MM-DD  hidden from the list until that day, then back by itself
//   priority  'both' | 'urgent' | 'important'   (none = no attribute)
//   repeat    { every, unit, days?, day?, from }   a recurring task (shared/repeat.js); "every 2 weeks" typed works too
//   completions  [{ at, due, skipped?, prev? }]  a repeating task's history: ticking it records one and moves `due` on
//   project   a project id: the task's own project instead of its note's (docs/PROJECTS.md)
//   person    a People note id: who the task is with
//   waitingSince YYYY-MM-DD  waiting for that person's reply since this day
// A date typed in the text ("due fri", see taskdates.js) is used when no date was picked;
// a picked date always wins.
import { addDays, formatDateShort } from './dates.js';
import { parseTaskSchedule } from './taskdates.js';
import { findRepeatPhrase, isValidRepeat, normalRepeat, nextOccurrence, repeatLabel, repeatZone, MAX_COMPLETIONS } from './repeat.js';

const inlineText = (node) => {
  if (node.type === 'text') return node.text;
  if (node.type === 'hardBreak') return ' ';
  return (node.content ?? []).map(inlineText).join('');
};

// The task's own words: its paragraphs, not any task nested under it.
export const taskText = (item) =>
  (item.content ?? [])
    .filter((c) => c.type !== 'taskList')
    .map(inlineText)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * What one task (a taskItem node as JSON) is right now, with dates typed in its text taken into account:
 * { text, checked, due, start, hidden, hideUntil, priority, project, person, waitingSince, dueFrom, startFrom } where due/start are the effective
 * dates and dueFrom/startFrom say where each came from: 'set' (picked), 'text' (typed) or null.
 */
export function describeTask(item, noteDate) {
  const a = item.attrs ?? {};
  const text = taskText(item);
  const typed = parseTaskSchedule(text, noteDate);
  return {
    text,
    checked: !!a.checked,
    dismissedAt: a.dismissedAt ?? null,
    completedAt: a.completedAt ?? null,
    due: a.due ?? typed.due ?? (a.dueTime ? noteDate : null),
    dueTime: a.dueTime ?? typed.dueTime,
    dueTimeFrom: a.dueTime ? 'set' : typed.dueTime ? 'text' : null,
    start: a.start ?? typed.start ?? (a.startTime ? noteDate : null),
    startTime: a.startTime ?? typed.startTime,
    startTimeFrom: a.startTime ? 'set' : typed.startTime ? 'text' : null,
    hidden: !!a.hidden,
    hideUntil: a.hideUntil ?? null,
    priority: a.priority ?? null,
    project: a.project ?? null,
    person: a.person ?? null,
    waitingSince: a.waitingSince ?? null,
    dueFrom: a.due ? 'set' : typed.due ? 'text' : null,
    startFrom: a.start ? 'set' : typed.start ? 'text' : null,
    ...repeatOf(a, text),
    completions: a.completions ?? [],
  };
}

// A task's repeat rule: the picked one, or one typed in its words ("every 2 weeks"). { repeat, repeatFrom }.
function repeatOf(a, text) {
  if (a.repeat) return { repeat: a.repeat, repeatFrom: 'set' };
  const typed = findRepeatPhrase(text);
  return typed ? { repeat: typed.rule, repeatFrom: 'text' } : { repeat: null, repeatFrom: null };
}

/** What names one row of the task list: the note and the task in it. */
export const taskKey = (t) => `${t.noteId}:${t.taskId}`;

/** The taskItem node (JSON) with this id, wherever it is in the document, or null. */
export function findTask(doc, taskId) {
  let found = null;
  const walk = (node) => {
    if (found) return;
    if (node.type === 'taskItem' && node.attrs?.id === taskId) found = node;
    else for (const child of node.content ?? []) walk(child);
  };
  walk(doc);
  return found;
}

/**
 * Tasks in document order. Tasks without an id or any text are skipped.
 * { id, ...describeTask } for each.
 */
export function extractTasks(doc, noteDate) {
  const out = [];
  const walk = (node) => {
    if (node.type === 'taskItem' && node.attrs?.id) {
      const task = describeTask(node, noteDate);
      if (task.text) out.push({ id: node.attrs.id, ...task });
    }
    for (const child of node.content ?? []) walk(child);
  };
  walk(doc);
  return out;
}

/**
 * The rows of the combined task list for one note: one per task with text, with where the task lives. The server sends
 * these (GET /api/tasks) and the client makes the same rows from a note it holds changes to, so a list can show a task
 * the server has not seen yet and both always agree on what a row is. `revision` is the note's revision the rows come from.
 */
export function taskRecords({ id, doc, date, tags, revision = 0 }) {
  return extractTasks(doc, date).map((t) => ({
    noteId: id,
    taskId: t.id,
    text: t.text,
    checked: t.checked,
    dismissedAt: t.dismissedAt,
    completedAt: t.completedAt,
    due: t.due,
    start: t.start,
    dueTime: t.dueTime,
    startTime: t.startTime,
    dueTimeFrom: t.dueTimeFrom,
    startTimeFrom: t.startTimeFrom,
    hidden: t.hidden,
    hideUntil: t.hideUntil,
    priority: t.priority,
    project: t.project,
    person: t.person,
    waitingSince: t.waitingSince,
    dueFrom: t.dueFrom,
    startFrom: t.startFrom,
    repeat: t.repeat,
    repeatFrom: t.repeatFrom,
    completions: t.completions,
    date,
    tags,
    revision,
  }));
}

// Attributes that are only stored when they mean something, so untouched tasks stay exactly as before.
const OPTIONAL = { dueTime: (v) => !v, startTime: (v) => !v, due: (v) => !v, start: (v) => !v, hidden: (v) => !v, hideUntil: (v) => !v, priority: (v) => !v, project: (v) => !v, person: (v) => !v, waitingSince: (v) => !v, dismissedAt: (v) => !v, completedAt: (v) => !v, repeat: (v) => !v, completions: (v) => !v?.length };

function tidyAttrs(attrs) {
  const next = { ...attrs };
  for (const [k, isEmpty] of Object.entries(OPTIONAL)) if (isEmpty(next[k])) delete next[k];
  return next;
}

/** A copy of the document without empty optional task attributes (null dates, hidden: false). */
export function cleanTaskAttrs(doc) {
  const walk = (node) => {
    if (node.type === 'taskItem' && node.attrs) node = { ...node, attrs: tidyAttrs(node.attrs) };
    return node.content ? { ...node, content: node.content.map(walk) } : node;
  };
  return walk(doc);
}

/**
 * What a task's attributes are after a patch, or null when the patch must not be applied (a dismissed task cannot be
 * completed). This is the one place that decides it: when a completion time is stamped (the moment `checked` really
 * changes, cleared when it is unticked), that a patch's own `completedAt` / `dismissedAt` wins, and that empty optional
 * attributes are not stored. The JSON path (updateTask) and the editor's path both use it, so a change gives the
 * same task whether or not the note's editor is open. `patch.content` (the task's text) is not an attribute and is
 * left to the caller.
 */
export function patchedTaskAttrs(attrs, patch, now = new Date().toISOString(), ctx = {}) {
  if (patch.checked === true && (patch.dismissedAt ?? attrs.dismissedAt) && patch.dismissedAt !== null) return null;
  const { content, skip, undoCompletion, ...changes } = patch;
  // Repeating tasks (shared/repeat.js). ctx = { text, noteDate, tz } lets a rule or dates typed in the words count.
  const typed = ctx.noteDate ? parseTaskSchedule(ctx.text ?? '', ctx.noteDate) : {};
  const effectiveDue = (a) => a.due ?? typed.due ?? (a.dueTime && ctx.noteDate ? ctx.noteDate : null);
  if ('repeat' in changes) {
    if (changes.repeat && !isValidRepeat(changes.repeat)) return null;
    changes.repeat = changes.repeat ? anchored(normalRepeat(changes.repeat), effectiveDue({ ...attrs, ...changes })) : null;
  }
  const merged = { ...attrs, ...changes };
  const rule = merged.repeat ?? (ctx.text ? findRepeatPhrase(ctx.text)?.rule : null);
  const history = merged.completions ?? [];
  if (undoCompletion) {
    const last = history.at(-1);
    if (!last?.prev) return null; // only the latest completion can be taken back, once
    return tidyAttrs({ ...merged, due: last.prev.due ?? null, start: last.prev.start ?? null, hideUntil: last.prev.hideUntil ?? null, completions: history.slice(0, -1) });
  }
  const ticking = changes.checked === true && !attrs.checked;
  if ((ticking || skip) && rule && !merged.dismissedAt) {
    const due = effectiveDue(merged);
    const start = merged.start ?? typed.start ?? null;
    const firstDue = history.find((c) => c.due)?.due ?? due;
    const next = nextOccurrence(rule, { due, start, now, tz: ctx.tz ?? repeatZone(), anchor: firstDue ? Number(firstDue.slice(8, 10)) : undefined });
    const prev = {};
    for (const k of ['due', 'start', 'hideUntil']) if (merged[k]) prev[k] = merged[k];
    const entry = { at: now, due, ...(ticking ? {} : { skipped: true }), prev };
    const completions = [...history.map(({ prev: _, ...c }) => c), entry].slice(-MAX_COMPLETIONS);
    return tidyAttrs({ ...merged, checked: false, completedAt: null, due: next.due, ...(next.start ? { start: next.start } : {}), hideUntil: null, completions });
  }
  if (skip) return null; // only a repeating task can be skipped
  const stamp = 'checked' in changes && changes.checked !== !!attrs.checked ? { completedAt: changes.checked ? now : null } : {};
  return tidyAttrs({ ...attrs, ...stamp, ...changes });
}

/**
 * A copy of the document with a patch applied to one task ({ checked, due, start, hidden }; a null date
 * or hidden: false removes it), or null if no task has that id. `now` is only for tests. `noteDate` (and `tz`, the home
 * timezone) let a repeating task's typed rule and dates count when it is ticked.
 */
export function updateTask(doc, taskId, patch, { now, noteDate, tz } = {}) {
  let found = false;
  const walk = (node) => {
    if (node.type === 'taskItem' && node.attrs?.id === taskId) {
      found = true;
      const attrs = patchedTaskAttrs(node.attrs, patch, now, { text: taskText(node), noteDate, tz });
      if (!attrs) return node; // refused: the task is there, and stays exactly as it was
      node = { ...node, attrs };
      if (patch.content) node.content = [...patch.content, ...(node.content ?? []).filter((c) => c.type === 'taskList')];
    }
    return node.content ? { ...node, content: node.content.map(walk) } : node;
  };
  const next = walk(doc);
  return found ? next : null;
}

// A monthly or yearly rule counted from the due date remembers the day of the month it belongs on (the 31st stays the
// 31st after a short month).
function anchored(rule, due) {
  if ((rule.unit === 'month' || rule.unit === 'year') && rule.from === 'due' && !rule.day && due) return { ...rule, day: Number(due.slice(8, 10)) };
  return rule;
}

export const setTaskChecked = (doc, taskId, checked) => updateTask(doc, taskId, { checked });

/** Remove one task and its nested contents; prune empty task lists but keep the document editable. */
export function removeTask(doc, taskId) {
  let found = false;
  const walk = (node) => {
    if (node.type === 'taskItem' && node.attrs?.id === taskId) { found = true; return null; }
    if (!node.content) return node;
    const content = node.content.map(walk).filter(Boolean);
    if (node.type === 'taskList' && !content.length) return null;
    return { ...node, content: node.type === 'doc' && !content.length ? [{ type: 'paragraph' }] : content };
  };
  const next = walk(doc);
  return found ? next : null;
}

/**
 * The colour of the strip down a task's left edge, from how soon it is due:
 * 'red' = due today or overdue, 'yellow' = due tomorrow, 'none' = later, no date, or done (shown grey).
 */
export function dueBar(due, checked, today) {
  if (checked || !due || !today) return 'none';
  if (due <= today) return 'red';
  if (due === addDays(today, 1)) return 'yellow';
  return 'none';
}

export const PRIORITY_LABEL = { both: 'Urgent & Important', urgent: 'Urgent', important: 'Important' };
// Sort order: most pressing first, no priority last.
export const priorityRank = (p) => ({ both: 0, urgent: 1, important: 2 })[p] ?? 3;

/** Short words shown on a task that has picked dates, a priority or is hidden, e.g. "urgent · due Fri, Oct 9". */
export function taskMetaLabel(attrs) {
  const parts = [];
  if (attrs?.dismissedAt) parts.push('dismissed');
  if (attrs?.priority && PRIORITY_LABEL[attrs.priority]) parts.push(PRIORITY_LABEL[attrs.priority].toLowerCase());
  if (!attrs?.due && attrs?.dueTime) parts.push(`due at ${attrs.dueTime}`);
  if (!attrs?.start && attrs?.startTime) parts.push(`starts at ${attrs.startTime}`);
  if (attrs?.due) parts.push(`due ${formatDateShort(attrs.due)}${attrs.dueTime ? ` at ${attrs.dueTime}` : ''}`);
  if (attrs?.start) parts.push(`starts ${formatDateShort(attrs.start)}${attrs.startTime ? ` at ${attrs.startTime}` : ''}`);
  if (attrs?.repeat) parts.push(`repeats ${repeatLabel(attrs.repeat)}`);
  if (attrs?.waitingSince) parts.push(`waiting since ${formatDateShort(attrs.waitingSince)}`);
  if (attrs?.hidden) parts.push('hidden');
  else if (attrs?.hideUntil) parts.push(`hidden until ${formatDateShort(attrs.hideUntil)}`);
  return parts.join(' · ');
}
