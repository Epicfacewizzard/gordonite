import { memo } from 'preact/compat';
import { useEffect, useRef } from 'preact/hooks';
import { Editor } from '@tiptap/core';
import { createExtensions } from './extensions.js';
import { cleanTaskAttrs } from '../../../shared/tasks.js';
import { writableDoc } from './task-visibility.js';
import { putTaskPatch, putTaskRemoval } from './task-ops.js';

// Toggle a task by its stable id. Goes through the editor so it is a normal,
// undoable transaction (the same one the checkbox itself dispatches).
export function toggleTaskById(editor, taskId) {
  let found = null;
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'taskItem' && node.attrs.id === taskId) found = { node, pos };
    return !found;
  });
  if (!found || found.node.attrs.dismissedAt) return false;
  return editor
    .chain()
    .command(({ tr }) => {
      tr.setNodeMarkup(found.pos, undefined, { ...found.node.attrs, checked: !found.node.attrs.checked });
      return true;
    })
    .run();
}

// Change a task's picked dates / hidden flag / text by its stable id. Like toggling, this is one ordinary, undoable
// transaction; what a change means is decided in shared/tasks.js (patchedTaskAttrs). A null date (or hidden: false)
// clears it. True when the task is in the note.
export function updateTaskById(editor, taskId, patch) {
  const tr = editor.state.tr;
  if (!putTaskPatch(tr, editor.schema, taskId, patch)) return false;
  if (tr.docChanged) editor.view.dispatch(tr);
  return true;
}

export function removeTaskById(editor, taskId) {
  const tr = editor.state.tr;
  if (!putTaskRemoval(tr, taskId)) return false;
  editor.view.dispatch(tr);
  return true;
}

// Document position for "N characters of text from the start". Used to put the caret where the
// user tapped in the read-only view; layout can shift when the previous editor closes, so a
// text offset is more reliable than screen coordinates.
function posForTextOffset(doc, n) {
  let seen = 0;
  let found = null;
  doc.descendants((node, pos) => {
    if (found !== null) return false;
    if (node.isText) {
      if (seen + node.nodeSize >= n) found = pos + (n - seen);
      else seen += node.nodeSize;
    }
    return true;
  });
  return found ?? Math.max(doc.content.size - 1, 0);
}

/**
 * One live editor bound to a sync session. The component is memoised and the host
 * element has no Preact children, so re-renders caused by save-status changes never
 * touch the editor DOM, selection, keyboard or undo history.
 */
export const NoteEditor = memo(function NoteEditor({ session, onEditor, onProblem, focusRequest, today, onTaskAction }) {
  const host = useRef(null);
  const request = useRef(focusRequest);
  // The editor is built once per session; the task buttons inside it read the latest of these.
  const live = useRef({});
  live.current = { today, onTaskAction };

  useEffect(() => {
    let broken = false;
    let editor = null; // assigned below; the content check can fire while the editor is still being built
    const markEmpty = () => {
      if (editor) host.current?.classList.toggle('is-empty', editor.isEmpty);
    };
    editor = new Editor({
      element: host.current,
      extensions: createExtensions({
        onTaskAction: (kind, taskId) => live.current.onTaskAction?.(kind, taskId),
        getToday: () => live.current.today,
        getNoteDate: () => session.date,
        getNoteId: () => session.id,
      }),
      content: writableDoc(session.currentDoc()),
      enableContentCheck: true,
      onContentError: () => {
        // Never autosave over content this editor cannot represent.
        broken = true;
        editor?.setEditable(false, false); // (while it is being built this is done just after, below)
        onProblem?.('This note contains content this version of the editor cannot show. It has not been changed.');
      },
      editorProps: {
        attributes: {
          class: 'note-text',
          role: 'textbox',
          'aria-multiline': 'true',
          'aria-label': 'Note text',
          autocapitalize: 'sentences',
          enterkeyhint: 'enter',
        },
        // Keep the caret clear of the sticky header and the bottom toolbar.
        scrollMargin: { top: 72, bottom: 110, left: 0, right: 0 },
        scrollThreshold: { top: 72, bottom: 110, left: 0, right: 0 },
      },
      onUpdate: ({ transaction }) => {
        markEmpty();
        // Housekeeping the engine does on its own (e.g. giving old tasks an id when a note is
        // opened) is flagged addToHistory:false and is not a user edit. Everything else is saved.
        if (broken || transaction.getMeta('addToHistory') === false) return;
        session.touch();
      },
      onCreate: () => {
        markEmpty();
        // Apply the tap that activated this editor (place the caret, or toggle the tapped task).
        const req = request.current;
        if (!req || editor.isDestroyed) return;
        if (req.taskId) toggleTaskById(editor, req.taskId);
        const pos = req.textOffset != null ? posForTextOffset(editor.state.doc, req.textOffset) : null;
        editor.chain().focus(pos ?? 'end', { scrollIntoView: false }).run();
      },
      onBlur: () => session.captureNow(),
    });
    // A document this editor cannot hold was found while it was being built: it opens read-only and is never saved.
    if (broken) editor.setEditable(false, false);
    markEmpty();
    // While this editor is open, a change to one of the note's tasks (from a button or a menu) goes through it, as one
    // undoable edit; the session lets go of it when this releases, and only if it has not been replaced since.
    // (cleanTaskAttrs drops empty optional task attributes, so tasks without dates are stored exactly as before.)
    const release = session.attachEditor({
      provider: () => cleanTaskAttrs(editor.getJSON()),
      updateTask: (taskId, patch) => updateTaskById(editor, taskId, patch),
      removeTask: (taskId) => removeTaskById(editor, taskId),
    });
    onEditor?.(editor);
    return () => {
      release();
      onEditor?.(null);
      editor.destroy();
    };
  }, [session]);

  return <div class="editor-host" ref={host} />;
});
