// Lightweight read-only HTML for a note document. Notes in a long stream are drawn
// with this; only the note being edited gets a real editor instance.
// The markup mirrors what the editor produces so one stylesheet covers both.
import { describeTask, dueBar, taskMetaLabel } from '../../../shared/tasks.js';
import { taskButtons } from './taskIcons.js';
import { wikiLinks, wikiHref } from '../../../shared/wiki-links.js';
import { fileHref, formatBytes, kindOfType } from '../../../shared/attachments.js';

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// A file in a note: an image is shown (tap to open it full size), anything else is a card that opens or
// downloads it. The editor draws the same markup (with `removable`, which adds a button to take it out of the
// note), so one stylesheet covers both and a note looks the same while writing and while reading.
export function attachmentHtml(a, { removable = false } = {}) {
  const href = fileHref(a.id);
  const name = esc(a.name || 'file');
  const kind = kindOfType(a.mime);
  const remove = removable
    ? `<button type="button" class="attachment-remove" data-attachment-remove aria-label="Remove ${name} from this note" title="Remove from this note">×</button>`
    : '';
  const attrs = `data-type="attachment" data-attachment-id="${esc(a.id)}"`;
  if (kind === 'image') {
    return `<figure class="attachment attachment-image" ${attrs}><a class="attachment-open" href="${href}" target="_blank" rel="noopener"><img src="${href}" alt="${name}" loading="lazy" decoding="async"></a><figcaption>${name}</figcaption>${remove}</figure>`;
  }
  const label = kind === 'pdf' ? 'PDF' : (/\.([A-Za-z0-9]{1,5})$/.exec(a.name ?? '')?.[1] ?? 'FILE').toUpperCase();
  const size = formatBytes(a.size);
  return `<figure class="attachment attachment-file" ${attrs}><a class="attachment-open attachment-card" href="${href}" target="_blank" rel="noopener"${kind === 'pdf' ? '' : ' download'}><span class="attachment-type">${esc(label)}</span><span class="attachment-name">${name}</span>${size ? `<span class="attachment-size">${esc(size)}</span>` : ''}</a>${remove}</figure>`;
}

function inline(nodes = []) {
  const links = wikiLinks(nodes.map((n) => n.type === 'hardBreak' ? '\n' : n.text).join(''));
  let position = 0;
  return nodes
    .map((n) => {
      if (n.type === 'hardBreak') { position++; return '<br>'; }
      let html = '', offset = 0;
      for (const link of links) {
        const from = Math.max(0, link.from - position), to = Math.min(n.text.length, link.to - position);
        if (from >= to) continue;
        html += esc(n.text.slice(offset, from)) + `<a href="${esc(wikiHref(link.target))}" class="wiki-link">${esc(n.text.slice(from, to))}</a>`;
        offset = to;
      }
      html += esc(n.text.slice(offset));
      position += n.text.length;
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
    case 'attachment':
      return attachmentHtml(n.attrs ?? {});
    case 'bulletList':
      return `<ul>${blocks(n.content, ctx)}</ul>`;
    case 'listItem':
      return `<li>${blocks(n.content, ctx)}</li>`;
    case 'taskList':
      return `<ul data-type="taskList">${blocks(n.content, ctx)}</ul>`;
    case 'taskItem': {
      const checked = !!n.attrs?.checked;
      if (n.attrs?.dismissedAt && ctx?.today) return '';
      const checkControl = n.attrs?.dismissedAt ? '<span class="dismissed-icon" role="img" aria-label="Dismissed task">⊠</span>' : checked ? '<span class="completed-bullet" role="img" aria-label="Completed task">•</span>' : '<input type="checkbox" aria-label="Task">';
      const meta = taskMetaLabel(n.attrs);
      const id = n.attrs?.id ?? '';
      const today = ctx?.today;
      const task = today ? describeTask(n, ctx.noteDate ?? today) : null;
      const bar = task ? ` data-bar="${dueBar(task.due, task.checked, today)}"` : '';
      const priority = n.attrs?.priority ? ` data-priority="${esc(n.attrs.priority)}"` : '';
      const actions = task && id && !checked ? taskActions(task, id, today) : '';
      return `<li data-type="taskItem" data-checked="${checked}" data-task-id="${esc(id)}"${n.attrs?.dismissedAt ? ` data-dismissed-at="${esc(n.attrs.dismissedAt)}"` : ''}${bar}${priority}${meta ? ` data-task-meta="${esc(meta)}"` : ''}><label>${checkControl}</label><div>${blocks(n.content, ctx)}</div>${actions}</li>`;
    }
    default:
      return '';
  }
}

/** ctx (optional): { today, noteDate }. With today, tasks get their strip colour and buttons. */
export function renderDoc(doc, ctx) {
  return blocks(doc.content, ctx);
}
