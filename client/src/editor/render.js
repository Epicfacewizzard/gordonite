// Lightweight read-only HTML for a note document. Notes in a long stream are drawn
// with this; only the note being edited gets a real editor instance.
// The markup mirrors what the editor produces so one stylesheet covers both.
import { describeTask, dueBar, taskMetaLabel } from '../../../shared/tasks.js';
import { taskButtons } from './taskIcons.js';

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function inline(nodes = []) {
  return nodes
    .map((n) => {
      if (n.type === 'hardBreak') return '<br>';
      let html = esc(n.text);
      for (const m of n.marks ?? []) {
        if (m.type === 'bold') html = `<strong>${html}</strong>`;
        else if (m.type === 'italic') html = `<em>${html}</em>`;
      }
      return html;
    })
    .join('');
}

function blocks(nodes = [], ctx) {
  return nodes.map((n) => block(n, ctx)).join('');
}

// The task's three round buttons, as in the editor. Only drawn when we know today's date (not in previews of old
// versions or the trash). They are plain buttons; the note card listens for taps on [data-task-action].
function taskActions(task, id, today) {
  const buttons = taskButtons(task, today)
    .map((b) => `<button type="button" class="round-btn ${b.state}" data-task-action="${b.kind}" data-task-id="${esc(id)}" aria-label="${esc(b.label)}" title="${esc(b.label)}">${b.svg}</button>`)
    .join('');
  return `<div class="task-actions" contenteditable="false">${buttons}</div>`;
}

function block(n, ctx) {
  switch (n.type) {
    case 'paragraph':
      return n.content?.length ? `<p>${inline(n.content)}</p>` : '<p><br></p>';
    case 'heading':
      return `<h${n.attrs.level}>${inline(n.content)}</h${n.attrs.level}>`;
    case 'bulletList':
      return `<ul>${blocks(n.content, ctx)}</ul>`;
    case 'listItem':
      return `<li>${blocks(n.content, ctx)}</li>`;
    case 'taskList':
      return `<ul data-type="taskList">${blocks(n.content, ctx)}</ul>`;
    case 'taskItem': {
      const checked = !!n.attrs?.checked;
      const meta = taskMetaLabel(n.attrs);
      const id = n.attrs?.id ?? '';
      const today = ctx?.today;
      const task = today ? describeTask(n, ctx.noteDate ?? today) : null;
      const bar = task ? ` data-bar="${dueBar(task.due, task.checked, today)}"` : '';
      const priority = n.attrs?.priority ? ` data-priority="${esc(n.attrs.priority)}"` : '';
      const actions = task && id ? taskActions(task, id, today) : '';
      return `<li data-type="taskItem" data-checked="${checked}" data-task-id="${esc(id)}"${bar}${priority}${meta ? ` data-task-meta="${esc(meta)}"` : ''}><label><input type="checkbox" ${checked ? 'checked' : ''} aria-label="${checked ? 'Completed task' : 'Task'}"></label><div>${blocks(n.content, ctx)}</div>${actions}</li>`;
    }
    default:
      return '';
  }
}

/** ctx (optional): { today, noteDate }. With today, tasks get their strip colour and buttons. */
export function renderDoc(doc, ctx) {
  return blocks(doc.content, ctx);
}
