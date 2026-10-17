import { Extension } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';
import { patchedTaskAttrs, taskText } from '../../../shared/tasks.js';
import { findRepeatPhrase } from '../../../shared/repeat.js';

// Append timestamps to the engine's checkbox transaction, so undo remains one operation.
// Loading/pasting an old checked task doesn't fabricate a completion time.
// A repeating task (shared/repeat.js) that is ticked is not completed: in the same transaction it is unticked, its due
// date moves on and the completion is recorded, exactly as patchedTaskAttrs does for a tick from the Tasks list.
export const TaskHistory = Extension.create({
  name: 'taskHistory',
  addOptions() {
    return { getNoteDate: null };
  },
  addProseMirrorPlugins() {
    const options = this.options;
    return [new Plugin({
      appendTransaction(transactions, before, after) {
        if (!transactions.some((tr) => tr.docChanged)) return null;
        const old = new Map();
        before.doc.descendants((node) => { if (node.type.name === 'taskItem' && node.attrs.id) old.set(node.attrs.id, node.attrs); });
        let changed = false;
        const tr = after.tr;
        after.doc.descendants((node, pos) => {
          if (node.type.name !== 'taskItem') return;
          const previous = old.get(node.attrs.id);
          if (!previous || !!previous.checked === !!node.attrs.checked) return;
          if (node.attrs.checked && !node.attrs.dismissedAt) {
            const text = taskText(node.toJSON());
            if (node.attrs.repeat || findRepeatPhrase(text)) {
              const attrs = patchedTaskAttrs(previous, { checked: true }, new Date().toISOString(), { text, noteDate: options.getNoteDate?.() ?? null });
              if (attrs) { tr.setNodeMarkup(pos, undefined, attrs); changed = true; return; }
            }
          }
          const completedAt = node.attrs.checked ? node.attrs.completedAt || new Date().toISOString() : null;
          if (completedAt !== node.attrs.completedAt) { tr.setNodeMarkup(pos, undefined, { ...node.attrs, completedAt }); changed = true; }
        });
        return changed ? tr : null;
      },
    })];
  },
});
