import { Fragment } from '@tiptap/pm/model';
import { Selection, TextSelection } from '@tiptap/pm/state';
import { closeHistory } from '@tiptap/pm/history';

const find = (doc, id) => {
  let result = null;
  doc.descendants((node, pos) => { if (node.type.name === 'taskItem' && node.attrs.id === id) result = { node, pos }; });
  return result;
};

/** Move an intact task among siblings using one engine transaction. No copied text or new IDs. */
export function moveTask(editor, id, direction, targetId = null, after = false) {
  const source = find(editor.state.doc, id);
  if (!source) return false;
  const parentPos = editor.state.doc.resolve(source.pos);
  const parent = parentPos.parent;
  if (parent.type.name !== 'taskList') return false;
  const items = [];
  parent.forEach((node) => items.push(node));
  const index = items.findIndex((node) => node.attrs.id === id);
  let destination = index + direction;
  if (targetId) {
    const target = items.findIndex((node) => node.attrs.id === targetId);
    if (target < 0 || target === index) return false;
    destination = target + (after ? 1 : 0) - (index < target ? 1 : 0);
  }
  if (destination < 0 || destination >= items.length || destination === index) return false;
  const selection = editor.state.selection;
  const bookmark = (pos) => {
    const resolved = editor.state.doc.resolve(pos);
    for (let depth = resolved.depth; depth > 0; depth--) {
      if (resolved.node(depth).type.name === 'taskItem') return { id: resolved.node(depth).attrs.id, offset: pos - resolved.before(depth) };
    }
    return null;
  };
  const anchor = bookmark(selection.anchor), head = bookmark(selection.head);
  const [moving] = items.splice(index, 1); items.splice(destination, 0, moving);
  const tr = closeHistory(editor.state.tr);
  tr.replaceWith(parentPos.start(), parentPos.end(), Fragment.fromArray(items));
  const locate = (saved, original) => saved ? find(tr.doc, saved.id)?.pos + saved.offset : tr.mapping.map(original);
  const a = locate(anchor, selection.anchor), h = locate(head, selection.head);
  if (selection instanceof TextSelection && Number.isFinite(a) && Number.isFinite(h)) tr.setSelection(TextSelection.create(tr.doc, a, h));
  else tr.setSelection(Selection.near(tr.doc.resolve(Math.min(source.pos, tr.doc.content.size))));
  editor.view.dispatch(tr);
  // Subsequent typing gets its own undo group even when it starts immediately after moving.
  editor.view.dispatch(closeHistory(editor.state.tr).setMeta('addToHistory', false));
  return true;
}
