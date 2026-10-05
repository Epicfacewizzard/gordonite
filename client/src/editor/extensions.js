import StarterKit from '@tiptap/starter-kit';
import { TaskList, TaskItem } from '@tiptap/extension-list';
import { UniqueID } from '@tiptap/extension-unique-id';
import { uuid } from '../../../shared/ids.js';

// The editing engine is Tiptap (ProseMirror). Nearly everything below is stock
// behaviour: Enter/Backspace/Delete in paragraphs and lists, input rules, paste,
// selection, and undo history all come from the engine.
//
// Deliberate choices (see docs/EDITOR.md):
//  - Only format-1 content is enabled, matching shared/doc.js and the server's validator.
//  - UniqueID gives every task a stable id. It also repairs duplicate ids that
//    appear when a task is split or pasted.
//  - No bubble/floating menus, drop cursor, gap cursor or trailing-node plugin, so
//    nothing pops up or edits the document on its own while typing.
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
    TaskItem.configure({ nested: true }),
    UniqueID.configure({ types: ['taskItem'], generateID: () => uuid() }),
  ];
}
