import StarterKit from '@tiptap/starter-kit';
import { TaskList, TaskItem } from '@tiptap/extension-list';
import { UniqueID } from '@tiptap/extension-unique-id';
import { uuid } from '../../../shared/ids.js';
import { describeTask, dueBar, taskMetaLabel } from '../../../shared/tasks.js';
import { taskButtons } from './taskIcons.js';
import { TaskHistory } from './task-history.js';
import { WikiLinks } from './wiki-links.js';
import { TaskVisibility } from './task-visibility.js';
import { moveTask } from './task-move.js';
import { Selection } from '@tiptap/pm/state';
import { closeHistory } from '@tiptap/pm/history';
import { getShiftDismiss } from '../prefs.js';

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
      const grip = document.createElement('button');
      grip.type = 'button'; grip.className = 'note-task-grip'; grip.contentEditable = 'false'; grip.textContent = '⠿';
      grip.setAttribute('aria-label', 'Move task'); grip.title = 'Drag within this list; Task details also has Move up/down';
      view.dom.prepend(grip);
      let gesture = null;
      const clearDrop = () => props.editor.view.dom.querySelectorAll('[data-move-drop]').forEach((el) => el.removeAttribute('data-move-drop'));
      grip.addEventListener('pointerdown', (e) => { if (e.button !== 0) return; e.preventDefault(); gesture = { x: e.clientX, y: e.clientY, moved: false, active: true }; grip.setPointerCapture(e.pointerId); });
      grip.addEventListener('pointermove', (e) => {
        if (!gesture?.active || (!gesture.moved && Math.hypot(e.clientX - gesture.x, e.clientY - gesture.y) < 6)) return;
        gesture.moved = true; clearDrop(); gesture.target = null;
        const target = document.elementFromPoint(e.clientX, e.clientY)?.closest('li[data-task-move-id]');
        if (!target || target === view.dom || target.parentElement !== view.dom.parentElement) return;
        gesture.target = target.dataset.taskMoveId;
        const rect = target.getBoundingClientRect(); gesture.after = e.clientY > rect.top + rect.height / 2;
        target.dataset.moveDrop = gesture.after ? 'after' : 'before';
      });
      grip.addEventListener('pointerup', (e) => {
        if (gesture) gesture.active = false;
        const target = gesture?.target, after = gesture?.after;
        clearDrop();
        if (grip.hasPointerCapture(e.pointerId)) grip.releasePointerCapture(e.pointerId);
        if (target) moveTask(props.editor, node.attrs.id, 0, target, after);
      });
      grip.addEventListener('pointercancel', () => { clearDrop(); gesture = null; });
      grip.addEventListener('click', (e) => {
        e.preventDefault();
        if (gesture?.moved) { gesture = null; return; }
        gesture = null;
        const pos = props.getPos();
        if (typeof pos === 'number') props.editor.view.dispatch(props.editor.state.tr.setSelection(Selection.near(props.editor.state.doc.resolve(pos + 1))));
        props.editor.view.focus();
      });
      const checkbox = view.dom.querySelector('input[type="checkbox"]');
      const dismissedIcon = document.createElement('span');
      dismissedIcon.className = 'dismissed-icon';
      dismissedIcon.textContent = '⊠';
      dismissedIcon.setAttribute('role', 'img');
      dismissedIcon.setAttribute('aria-label', 'Dismissed task');
      checkbox?.parentElement.append(dismissedIcon);
      const completedBullet = document.createElement('span');
      completedBullet.className = 'completed-bullet';
      completedBullet.textContent = '•';
      completedBullet.setAttribute('role', 'img');
      completedBullet.setAttribute('aria-label', 'Completed task');
      checkbox?.parentElement.append(completedBullet);
      checkbox?.parentElement.addEventListener('click', (e) => {
        // Shift-click dismisses instead of ticking (one undoable step, the same change the task details sheet makes).
        if (e.shiftKey && e.target === checkbox && !node.attrs.checked && !node.attrs.dismissedAt && getShiftDismiss()) {
          e.preventDefault();
          const pos = props.getPos();
          if (typeof pos === 'number') {
            const tr = props.editor.state.tr;
            closeHistory(tr);
            tr.setNodeMarkup(pos, undefined, { ...node.attrs, dismissedAt: new Date().toISOString() });
            props.editor.view.dispatch(tr);
          }
          return;
        }
        if (node.attrs.checked || node.attrs.dismissedAt) e.preventDefault();
      });

      const refresh = () => {
        const dismissed = !!node.attrs.dismissedAt;
        const completed = !!node.attrs.checked;
        view.dom.dataset.taskMoveId = node.attrs.id;
        view.dom.hidden = dismissed;
        if (checkbox) { checkbox.disabled = dismissed; checkbox.hidden = dismissed || completed; checkbox.setAttribute('aria-hidden', String(dismissed || completed)); if (checkbox.nextElementSibling !== dismissedIcon) checkbox.nextElementSibling.hidden = dismissed || completed; }
        dismissedIcon.hidden = !dismissed;
        completedBullet.hidden = !completed || dismissed;
        const today = options.getToday?.();
        actions.hidden = !today || dismissed || completed;
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
        stopEvent: (event) => grip.contains(event.target) || actions.contains(event.target) || (!!node.attrs.dismissedAt && !!checkbox?.parentElement.contains(event.target)) || !!view.stopEvent?.(event),
        // Our own DOM (the buttons, the row's attributes) is not the user editing the note.
        ignoreMutation: (mutation) =>
          mutation.type !== 'selection' && (grip.contains(mutation.target) || actions.contains(mutation.target) || checkbox?.parentElement.contains(mutation.target) || (mutation.type === 'attributes' && mutation.target === view.dom)),
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
      dueTime: { ...dateAttr('dueTime'), keepOnSplit: false },
      startTime: { ...dateAttr('startTime'), keepOnSplit: false },
      completedAt: {
        default: null,
        keepOnSplit: false,
        parseHTML: (el) => el.getAttribute('data-completed-at') || null,
        renderHTML: (attrs) => attrs.completedAt ? { 'data-completed-at': attrs.completedAt } : {},
      },
      dismissedAt: {
        default: null,
        keepOnSplit: false,
        parseHTML: (el) => el.getAttribute('data-dismissed-at') || null,
        renderHTML: (attrs) => attrs.dismissedAt ? { 'data-dismissed-at': attrs.dismissedAt } : {},
      },
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
    TaskHistory,
    WikiLinks,
    TaskVisibility,
    TaskItemWithDates.configure({ nested: true, ...taskContext }),
    UniqueID.configure({ types: ['taskItem'], generateID: () => uuid() }),
  ];
}
