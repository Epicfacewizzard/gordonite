import StarterKit from '@tiptap/starter-kit';
import { TaskList, TaskItem } from '@tiptap/extension-list';
import { UniqueID } from '@tiptap/extension-unique-id';
import { uuid } from '../../../shared/ids.js';
import { taskMetaLabel } from '../../../shared/tasks.js';

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

const TaskItemWithDates = TaskItem.extend({
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
      hidden: {
        default: false,
        parseHTML: (el) => el.getAttribute('data-hidden') === 'true',
        renderHTML: (attrs) => (attrs.hidden ? { 'data-hidden': 'true' } : {}),
      },
    };
  },
});

export function createExtensions() {
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
    TaskItemWithDates.configure({ nested: true }),
    UniqueID.configure({ types: ['taskItem'], generateID: () => uuid() }),
  ];
}
