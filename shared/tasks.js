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
// A date typed in the text ("due fri", see taskdates.js) is used when no date was picked;
// a picked date always wins.
import { addDays, formatDateShort } from './dates.js';
import { parseTaskSchedule } from './taskdates.js';

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
 * { text, checked, due, start, hidden, hideUntil, priority, dueFrom, startFrom } where due/start are the effective
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
    dueFrom: a.due ? 'set' : typed.due ? 'text' : null,
    startFrom: a.start ? 'set' : typed.start ? 'text' : null,
  };
}

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

// Attributes that are only stored when they mean something, so untouched tasks stay exactly as before.
const OPTIONAL = { dueTime: (v) => !v, startTime: (v) => !v, due: (v) => !v, start: (v) => !v, hidden: (v) => !v, hideUntil: (v) => !v, priority: (v) => !v, dismissedAt: (v) => !v, completedAt: (v) => !v };

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
export function patchedTaskAttrs(attrs, patch, now = new Date().toISOString()) {
  if (patch.checked === true && (patch.dismissedAt ?? attrs.dismissedAt) && patch.dismissedAt !== null) return null;
  const { content, ...changes } = patch;
  const stamp = 'checked' in changes && changes.checked !== !!attrs.checked ? { completedAt: changes.checked ? now : null } : {};
  return tidyAttrs({ ...attrs, ...stamp, ...changes });
}

/**
 * A copy of the document with a patch applied to one task ({ checked, due, start, hidden }; a null date
 * or hidden: false removes it), or null if no task has that id. `now` is only for tests.
 */
export function updateTask(doc, taskId, patch, { now } = {}) {
  let found = false;
  const walk = (node) => {
    if (node.type === 'taskItem' && node.attrs?.id === taskId) {
      found = true;
      const attrs = patchedTaskAttrs(node.attrs, patch, now);
      if (!attrs) return node; // refused: the task is there, and stays exactly as it was
      node = { ...node, attrs };
      if (patch.content) node.content = [...patch.content, ...(node.content ?? []).filter((c) => c.type === 'taskList')];
    }
    return node.content ? { ...node, content: node.content.map(walk) } : node;
  };
  const next = walk(doc);
  return found ? next : null;
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
  if (attrs?.hidden) parts.push('hidden');
  else if (attrs?.hideUntil) parts.push(`hidden until ${formatDateShort(attrs.hideUntil)}`);
  return parts.join(' · ');
}
