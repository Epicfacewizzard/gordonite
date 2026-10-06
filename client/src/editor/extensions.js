import StarterKit from '@tiptap/starter-kit';
import { TaskList, TaskItem } from '@tiptap/extension-list';
import { UniqueID } from '@tiptap/extension-unique-id';
import { uuid } from '../../../shared/ids.js';
import { describeTask, dueBar, taskMetaLabel } from '../../../shared/tasks.js';
import { taskButtons } from './taskIcons.js';

// The editing engine is Tiptap (ProseMirror). Nearly everything below is stock
// behaviour: Enter/Backspace/Delete in paragraphs and lists, input rules, paste,
// selection, and undo history all come from the engine.
//
// Deliberate choices (see docs/EDITOR.md):
//  - Only format-1 content is enabled, matching shared/doc.js and the server's validator.
//  - UniqueID gives every task a stable id. It also repairs duplicate ids that
//    appear when a task is split or pasted.
//  - A task may carry picked due/start dates and a hidden flag. They are plain node attributes
//    (set with the stock updateAttributes/setNodeMarkup), and show as a small label via CSS.
//  - No bubble/floating menus, drop cursor, gap cursor or trailing-node plugin, so
//    nothing pops up or edits the document on its own while typing.

const dateAttr = (name) => ({
  default: null,
  parseHTML: (el) => el.getAttribute(`data-${name}`) || null,
  renderHTML: (attrs) => (attrs[name] ? { [`data-${name}`]: attrs[name] } : {}),
});

// A task in the editor is the stock task (checkbox + text) plus, after the text, the same three round buttons the
// Tasks page has (hide, due, priority), and a strip colour set from how soon it is due. The buttons live outside
// the editable text (contenteditable=false) and ProseMirror is told to ignore them, so typing, Enter, Backspace
// and undo behave exactly as before. A tap calls options.onTaskAction(kind, taskId); the note card opens the menu.
const TaskItemWithDates = TaskItem.extend({
  addOptions() {
    return { ...this.parent?.(), onTaskAction: null, getToday: null, getNoteDate: null };
  },

  addNodeView() {
    const parent = this.parent?.();
    if (!parent) return null;
    const options = this.options;
    return (props) => {
      const view = parent(props);
      const actions = document.createElement('div');
      actions.className = 'task-actions';
      actions.contentEditable = 'false';
      view.dom.append(actions);
      let node = props.node;
      let signature = '';

      const refresh = () => {
        const today = options.getToday?.();
        actions.hidden = !today;
        if (!today) return;
        const task = describeTask(node.toJSON(), options.getNoteDate?.() ?? today);
        view.dom.dataset.bar = dueBar(task.due, task.checked, today);
        const buttons = taskButtons(task, today);
        const next = buttons.map((b) => `${b.kind}:${b.state}:${b.label}`).join('|');
        if (next === signature) return; // nothing changed: leave the buttons alone
        signature = next;
        actions.replaceChildren(
          ...buttons.map((b) => {
            const el = document.createElement('button');
            el.type = 'button';
            el.className = `round-btn ${b.state}`;
            el.dataset.taskAction = b.kind;
            el.setAttribute('aria-label', b.label);
            el.title = b.label;
            el.innerHTML = b.svg;
            return el;
          }),
        );
      };
      refresh();

      // Keep the text cursor where it is (same trick as the toolbar), then report the tap.
      actions.addEventListener('mousedown', (e) => e.preventDefault());
      actions.addEventListener('click', (e) => {
        const button = e.target.closest?.('[data-task-action]');
        if (!button) return;
        e.preventDefault();
        options.onTaskAction?.(button.dataset.taskAction, node.attrs.id);
      });

      return {
        ...view,
        update: (updated) => {
          if (!view.update(updated)) return false;
          node = updated;
          refresh();
          return true;
        },
        stopEvent: (event) => actions.contains(event.target),
        // Our own DOM (the buttons, the row's attributes) is not the user editing the note.
        ignoreMutation: (mutation) =>
          mutation.type !== 'selection' && (actions.contains(mutation.target) || (mutation.type === 'attributes' && mutation.target === view.dom)),
      };
    };
  },

  addAttributes() {
    return {
      ...this.parent?.(),
      due: {
        ...dateAttr('due'),
        // One composite label for all three, so a single CSS pseudo-element can show it.
        renderHTML: (attrs) => ({
          ...(attrs.due ? { 'data-due': attrs.due } : {}),
          ...(taskMetaLabel(attrs) ? { 'data-task-meta': taskMetaLabel(attrs) } : {}),
        }),
      },
      start: dateAttr('start'),
      hideUntil: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-hide-until') || null,
        renderHTML: (attrs) => (attrs.hideUntil ? { 'data-hide-until': attrs.hideUntil } : {}),
      },
      priority: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-priority') || null,
        renderHTML: (attrs) => (attrs.priority ? { 'data-priority': attrs.priority } : {}),
      },
      hidden: {
        default: false,
        parseHTML: (el) => el.getAttribute('data-hidden') === 'true',
        renderHTML: (attrs) => (attrs.hidden ? { 'data-hidden': 'true' } : {}),
      },
    };
  },
});

/** taskContext: { onTaskAction(kind, taskId), getToday(), getNoteDate() } for the buttons on tasks. */
export function createExtensions(taskContext = {}) {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      blockquote: false,
      code: false,
      codeBlock: false,
      horizontalRule: false,
      orderedList: false,
      strike: false,
      underline: false,
      link: false,
      dropcursor: false,
      gapcursor: false,
      trailingNode: false,
    }),
    TaskList,
    TaskItemWithDates.configure({ nested: true, ...taskContext }),
    UniqueID.configure({ types: ['taskItem'], generateID: () => uuid() }),
  ];
}
