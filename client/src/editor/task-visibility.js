import { Extension } from '@tiptap/core';
import { Plugin, TextSelection } from '@tiptap/pm/state';

// Hidden tasks retain their original IDs and positions. Supply a writing paragraph
// when nothing visible remains, without creating a saved edit just by opening.
export function writableDoc(doc) {
  const visible = (node) => !node.attrs?.dismissedAt && (['paragraph', 'heading'].includes(node.type) || node.content?.some(visible));
  return visible(doc) ? doc : { ...doc, content: [...(doc.content ?? []), { type: 'paragraph' }] };
}
const inDismissed = ($pos) => {
  for (let depth = $pos.depth; depth > 0; depth--) if ($pos.node(depth).attrs.dismissedAt) return true;
  return false;
};
export const TaskVisibility = Extension.create({
  name: 'taskVisibility',
  addProseMirrorPlugins() {
    return [new Plugin({ appendTransaction(transactions, before, state) {
      const tr = state.tr;
      const positions = [];
      state.doc.descendants((node, pos) => {
        if (node.attrs.dismissedAt) return false;
        if (node.isTextblock) positions.push(pos + 1);
      });
      if (!positions.length && transactions.some((t) => t.docChanged)) {
        const pos = tr.doc.content.size;
        tr.insert(pos, state.schema.nodes.paragraph.create()); positions.push(pos + 1);
      }
      if (positions.length && (inDismissed(state.selection.$from) || inDismissed(state.selection.$to))) {
        const closest = positions.reduce((a, b) => Math.abs(a - state.selection.from) <= Math.abs(b - state.selection.from) ? a : b);
        tr.setSelection(TextSelection.create(tr.doc, closest));
      }
      return tr.docChanged || tr.selectionSet ? tr : null;
    } })];
  },
});
