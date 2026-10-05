// Lightweight read-only HTML for a note document. Notes in a long stream are drawn
// with this; only the note being edited gets a real editor instance.
// The markup mirrors what the editor produces so one stylesheet covers both.
import { taskMetaLabel } from '../../../shared/tasks.js';

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

function blocks(nodes = []) {
  return nodes.map(block).join('');
}

function block(n) {
  switch (n.type) {
    case 'paragraph':
      return n.content?.length ? `<p>${inline(n.content)}</p>` : '<p><br></p>';
    case 'heading':
      return `<h${n.attrs.level}>${inline(n.content)}</h${n.attrs.level}>`;
    case 'bulletList':
      return `<ul>${blocks(n.content)}</ul>`;
    case 'listItem':
      return `<li>${blocks(n.content)}</li>`;
    case 'taskList':
      return `<ul data-type="taskList">${blocks(n.content)}</ul>`;
    case 'taskItem': {
      const checked = !!n.attrs?.checked;
      const meta = taskMetaLabel(n.attrs);
      return `<li data-type="taskItem" data-checked="${checked}" data-task-id="${esc(n.attrs?.id ?? '')}"${meta ? ` data-task-meta="${esc(meta)}"` : ''}><label><input type="checkbox" ${checked ? 'checked' : ''} aria-label="${checked ? 'Completed task' : 'Task'}"></label><div>${blocks(n.content)}</div></li>`;
    }
    default:
      return '';
  }
}

export function renderDoc(doc) {
  return blocks(doc.content);
}
