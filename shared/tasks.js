// Tasks live inside note documents (taskItem nodes with a stable id), so there is no
// separate task table. These helpers read and change them in a document; the server
// uses extractTasks for the combined list and the client uses updateTask to change one
// without opening an editor.
//
// A task can carry three optional attributes, all picked by hand:
//   due    YYYY-MM-DD   when it is due
//   start  YYYY-MM-DD   it should not show up as "to do" before this day
//   hidden true         kept out of the combined Tasks list (still in its note)
//   hideUntil YYYY-MM-DD  hidden from the list until that day, then back by itself
//   priority  'both' | 'urgent' | 'important'   (none = no attribute)
// A date typed in the text ("due fri", see taskdates.js) is used when no date was picked;
// a picked date always wins.
import { addDays, formatDateShort } from './dates.js';
import { parseTaskDates } from './taskdates.js';

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
 * Tasks in document order. Tasks without an id or any text are skipped.
 * { id, text, checked, due, start, hidden, dueFrom, startFrom } where due/start are the effective
 * dates and dueFrom/startFrom say where they came from: 'set' (picked), 'text' (typed) or null.
 */
export function extractTasks(doc, noteDate) {
  const out = [];
  const walk = (node) => {
    if (node.type === 'taskItem') {
      const text = taskText(node);
      if (node.attrs?.id && text) {
        const a = node.attrs;
        const typed = parseTaskDates(text, noteDate);
        out.push({
          id: a.id,
          text,
          checked: !!a.checked,
          due: a.due ?? typed.due,
          start: a.start ?? typed.start,
          hidden: !!a.hidden,
          hideUntil: a.hideUntil ?? null,
          priority: a.priority ?? null,
          dueFrom: a.due ? 'set' : typed.due ? 'text' : null,
          startFrom: a.start ? 'set' : typed.start ? 'text' : null,
        });
      }
    }
    for (const child of node.content ?? []) walk(child);
  };
  walk(doc);
  return out;
}

// Attributes that are only stored when they mean something, so untouched tasks stay exactly as before.
const OPTIONAL = { due: (v) => !v, start: (v) => !v, hidden: (v) => !v, hideUntil: (v) => !v, priority: (v) => !v };

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
 * A copy of the document with a patch applied to one task ({ checked, due, start, hidden }; a null date
 * or hidden: false removes it), or null if no task has that id.
 */
export function updateTask(doc, taskId, patch) {
  let found = false;
  const walk = (node) => {
    if (node.type === 'taskItem' && node.attrs?.id === taskId) {
      found = true;
      node = { ...node, attrs: tidyAttrs({ ...node.attrs, ...patch }) };
    }
    return node.content ? { ...node, content: node.content.map(walk) } : node;
  };
  const next = walk(doc);
  return found ? next : null;
}

export const setTaskChecked = (doc, taskId, checked) => updateTask(doc, taskId, { checked });

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
  if (attrs?.priority && PRIORITY_LABEL[attrs.priority]) parts.push(PRIORITY_LABEL[attrs.priority].toLowerCase());
  if (attrs?.due) parts.push(`due ${formatDateShort(attrs.due)}`);
  if (attrs?.start) parts.push(`starts ${formatDateShort(attrs.start)}`);
  if (attrs?.hidden) parts.push('hidden');
  else if (attrs?.hideUntil) parts.push(`hidden until ${formatDateShort(attrs.hideUntil)}`);
  return parts.join(' · ');
}
