// Changing one task inside a live editor, as plain ProseMirror steps put into a transaction.
//
// These are the editor's side of the task commands (the same changes without an editor are shared/tasks.js
// updateTask and removeTask). They take a transaction and the schema, not an editor, so they can be run and compared
// against the JSON path with no browser: tests/client/task-parity.test.js.
//
// What a change means (when a completion time is stamped, what a dismissed task refuses, which attributes are
// stored) is decided once, in patchedTaskAttrs; this file only turns the result into steps.
import { closeHistory } from '@tiptap/pm/history';
import { patchedTaskAttrs } from '../../../shared/tasks.js';

function findTask(doc, taskId) {
  let found = null;
  doc.descendants((node, pos) => {
    if (node.type.name === 'taskItem' && node.attrs.id === taskId) found = { node, pos };
    return !found;
  });
  return found;
}

/**
 * Put a patch to one task into `tr`: { checked, due, start, dueTime, startTime, hidden, hideUntil, priority,
 * dismissedAt, completedAt, content } (a null date or hidden: false clears it; `content` replaces the task's own
 * paragraphs and keeps any tasks nested under it). True when the task is in the note, even if the patch is one it
 * refuses (completing a dismissed task changes nothing); false when there is no such task.
 */
export function putTaskPatch(tr, schema, taskId, patch, { now } = {}) {
  const found = findTask(tr.doc, taskId);
  if (!found) return false;
  const attrs = patchedTaskAttrs(found.node.attrs, patch, now);
  if (!attrs) return true;
  // Dismissing or completing is its own undo step, so one undo puts the task back and not the typing before it.
  if ('dismissedAt' in patch || 'completedAt' in patch) closeHistory(tr);
  tr.setNodeMarkup(found.pos, undefined, attrs);
  if (patch.content) {
    const nested = [];
    found.node.forEach((child) => {
      if (child.type.name === 'taskList') nested.push(child);
    });
    tr.replaceWith(found.pos + 1, found.pos + found.node.nodeSize - 1, [...patch.content.map((child) => schema.nodeFromJSON(child)), ...nested]);
  }
  return true;
}

/**
 * Put the removal of one task (and the tasks nested under it) into `tr`. A task list left with nothing in it goes
 * too. True when the task was there.
 */
export function putTaskRemoval(tr, taskId) {
  const found = findTask(tr.doc, taskId);
  if (!found) return false;
  const $pos = tr.doc.resolve(found.pos);
  const soleItem = $pos.parent.childCount === 1;
  const from = soleItem ? $pos.before($pos.depth) : found.pos;
  const to = soleItem ? from + $pos.parent.nodeSize : found.pos + found.node.nodeSize;
  closeHistory(tr);
  tr.deleteRange(from, to);
  return true;
}
