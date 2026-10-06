import { Extension } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';

// Append timestamps to the engine's checkbox transaction, so undo remains one operation.
// Loading/pasting an old checked task doesn't fabricate a completion time.
export const TaskHistory = Extension.create({
  name: 'taskHistory',
  addProseMirrorPlugins() {
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
          const completedAt = node.attrs.checked ? node.attrs.completedAt || new Date().toISOString() : null;
          if (completedAt !== node.attrs.completedAt) { tr.setNodeMarkup(pos, undefined, { ...node.attrs, completedAt }); changed = true; }
        });
        return changed ? tr : null;
      },
    })];
  },
});
