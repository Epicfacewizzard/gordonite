import { memo } from 'preact/compat';
import { useEffect, useRef } from 'preact/hooks';
import { Editor } from '@tiptap/core';
import { createExtensions } from './extensions.js';
import { cleanTaskAttrs } from '../../../shared/tasks.js';

// Toggle a task by its stable id. Goes through the editor so it is a normal,
// undoable transaction (the same one the checkbox itself dispatches).
export function toggleTaskById(editor, taskId) {
  let found = null;
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'taskItem' && node.attrs.id === taskId) found = { node, pos };
    return !found;
  });
  if (!found) return false;
  return editor
    .chain()
    .command(({ tr }) => {
      tr.setNodeMarkup(found.pos, undefined, { ...found.node.attrs, checked: !found.node.attrs.checked });
      return true;
    })
    .run();
}

// Change a task's picked dates / hidden flag by its stable id. Like toggling, this is one ordinary,
// undoable transaction. A null date (or hidden: false) clears it.
export function updateTaskById(editor, taskId, patch) {
  let found = null;
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'taskItem' && node.attrs.id === taskId) found = { node, pos };
    return !found;
  });
  if (!found) return false;
  return editor
    .chain()
    .command(({ tr }) => {
      tr.setNodeMarkup(found.pos, undefined, { ...found.node.attrs, ...patch });
      return true;
    })
    .run();
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
export const NoteEditor = memo(function NoteEditor({ session, onEditor, onProblem, focusRequest }) {
  const host = useRef(null);
  const request = useRef(focusRequest);

  useEffect(() => {
    let broken = false;
    const editor = new Editor({
      element: host.current,
      extensions: createExtensions(),
      content: session.currentDoc(),
      enableContentCheck: true,
      onContentError: () => {
        // Never autosave over content this editor cannot represent.
        broken = true;
        editor.setEditable(false);
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
    const markEmpty = () => host.current?.classList.toggle('is-empty', editor.isEmpty);
    markEmpty();
    // cleanTaskAttrs drops empty optional task attributes, so tasks without dates are stored exactly as before.
    session.attach(() => cleanTaskAttrs(editor.getJSON()));
    onEditor?.(editor);
    return () => {
      session.detach();
      onEditor?.(null);
      editor.destroy();
    };
  }, [session]);

  return <div class="editor-host" ref={host} />;
});
