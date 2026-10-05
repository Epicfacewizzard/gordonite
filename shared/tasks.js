// Tasks live inside note documents (taskItem nodes with a stable id), so there is no
// separate task table. These helpers read and change them in a document; the server
// uses extractTasks for the combined list and the client uses updateTask to change one
// without opening an editor.
//
// A task can carry three optional attributes, all picked by hand:
//   due    YYYY-MM-DD   when it is due
//   start  YYYY-MM-DD   it should not show up as "to do" before this day
//   hidden true         kept out of the combined Tasks list (still in its note)
// A date typed in the text ("due fri", see taskdates.js) is used when no date was picked;
// a picked date always wins.
import { formatDateShort } from './dates.js';
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
const OPTIONAL = { due: (v) => !v, start: (v) => !v, hidden: (v) => !v };

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

/** Short words shown on a task that has picked dates or is hidden, e.g. "due Fri, Oct 9 · starts Mon, Oct 12". */
export function taskMetaLabel(attrs) {
  const parts = [];
  if (attrs?.due) parts.push(`due ${formatDateShort(attrs.due)}`);
  if (attrs?.start) parts.push(`starts ${formatDateShort(attrs.start)}`);
  if (attrs?.hidden) parts.push('hidden');
  return parts.join(' · ');
}
