// Accepting "Make this a task" inside a live editor: one ordinary, undoable transaction that swaps the top-level paragraph
// reading `line` for a task made from it. What the task is (its words, its date) is decided in shared/suggestions.js.
import { normalLine, taskFromParagraph, dateWrittenIn } from '../../../shared/suggestions.js';

/** True when the line was there and is now a task. */
export function makeLineATaskInEditor(editor, line, noteDate, { owner = null } = {}) {
  const wanted = normalLine(line);
  const { doc, schema } = editor.state;
  let found = null;
  doc.forEach((node, offset) => {
    if (!found && node.type.name === 'paragraph' && normalLine(node.textBetween(0, node.content.size, ' ', ' ')) === wanted) found = { node, offset };
  });
  if (!found) return false;
  const task = schema.nodeFromJSON(taskFromParagraph(found.node.toJSON(), { ...(dateWrittenIn(wanted, noteDate) ?? {}), owner }));
  const tr = editor.state.tr.replaceWith(found.offset, found.offset + found.node.nodeSize, task);
  editor.view.dispatch(tr);
  return true;
}
