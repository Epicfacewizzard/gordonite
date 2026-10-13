import { Node } from '@tiptap/core';
import { Plugin, Selection } from '@tiptap/pm/state';
import { api } from '../api.js';
import { attachmentHtml } from './render.js';

// Files in a note (images, PDFs, other documents). See docs/ATTACHMENTS.md.
//
// A file is an `attachment` block: an atom that holds the file's id, name, type and size (the bytes live on the
// server). It is chosen from the paperclip button, pasted (a screenshot) or dropped onto the note. The file is
// uploaded first and the block is inserted when the server has it, as ONE undoable step, so a note never refers
// to a file that is not stored. Taking a file out of a note (the × on it, or Backspace) never deletes the file.

// ----- upload progress, read by the editor bar -----
let status = { busy: 0, error: null };
const listeners = new Set();
const setStatus = (patch) => {
  status = { ...status, ...patch };
  listeners.forEach((fn) => fn());
};
export const uploadStatus = {
  get: () => status,
  subscribe: (fn) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  dismiss: () => setStatus({ error: null }),
};

const attachmentExtension = (editor) => editor.extensionManager.extensions.find((e) => e.name === 'attachment');

/** The files in a paste or a drop (empty when it is only text). */
export function filesFromTransfer(data) {
  return [...(data?.files ?? [])].filter((f) => f && f.size >= 0);
}

// Put the stored files into the note as blocks: after the block the caret is in (or at `at`, a document position,
// for a drop). An empty paragraph the caret sits in is used up. A note never ends on a file, so there is always
// a line below to keep writing on.
export function insertAttachments(editor, items, at = null) {
  const { state, schema } = editor;
  const paragraph = schema.nodes.paragraph;
  const nodes = items.map((a) => schema.nodes.attachment.create({ id: a.id, name: a.name, mime: a.mime, size: a.size }));
  let from;
  let to;
  if (at !== null) {
    const $at = state.doc.resolve(Math.min(Math.max(at, 0), state.doc.content.size));
    from = to = $at.depth >= 1 ? $at.after(1) : $at.pos;
  } else {
    const { $to } = state.selection;
    if ($to.depth >= 1) {
      const block = $to.node(1);
      const blank = block.type === paragraph && block.content.size === 0;
      from = blank ? $to.before(1) : $to.after(1);
      to = blank ? $to.after(1) : from;
    } else {
      from = to = $to.pos;
    }
  }
  const tr = state.tr.replaceWith(from, to, nodes);
  const end = from + nodes.reduce((n, node) => n + node.nodeSize, 0);
  if (end >= tr.doc.content.size) tr.insert(end, paragraph.create());
  tr.setSelection(Selection.near(tr.doc.resolve(Math.min(end + 1, tr.doc.content.size))));
  editor.view.dispatch(tr.scrollIntoView());
}

/** Upload these files, then put them in the note. Resolves to the stored files (some may have failed: see status). */
export async function attachFiles(editor, files, { at = null } = {}) {
  const list = [...files];
  if (!list.length) return [];
  const noteId = attachmentExtension(editor)?.options.getNoteId?.() ?? null;
  const stored = [];
  const failed = [];
  setStatus({ busy: status.busy + list.length, error: null });
  for (const file of list) {
    try {
      stored.push((await api.uploadFile(file, { noteId })).attachment);
    } catch (err) {
      failed.push(`${file.name || 'file'}: ${err.message}`);
    } finally {
      setStatus({ busy: Math.max(status.busy - 1, 0) });
    }
  }
  if (stored.length && !editor.isDestroyed) insertAttachments(editor, stored, at);
  if (failed.length) setStatus({ error: failed.join('; ') });
  return stored;
}

export const Attachment = Node.create({
  name: 'attachment',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  addOptions() {
    return { getNoteId: null };
  },

  addAttributes() {
    // key = the node attribute; html = the data-* attribute it is written to when copied and pasted.
    const data = (key, html, fallback) => ({
      default: fallback,
      parseHTML: (el) => el.getAttribute(`data-${html}`) ?? fallback,
      renderHTML: (attrs) => ({ [`data-${html}`]: attrs[key] }),
    });
    return {
      id: data('id', 'attachment-id', null),
      name: data('name', 'name', 'file'),
      mime: data('mime', 'mime', 'application/octet-stream'),
      size: {
        default: 0,
        parseHTML: (el) => Number(el.getAttribute('data-size')) || 0,
        renderHTML: (attrs) => ({ 'data-size': attrs.size }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'figure[data-type="attachment"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['figure', { ...HTMLAttributes, 'data-type': 'attachment' }];
  },

  // What the editor shows: the same markup as the read-only view (render.js), plus a button to take it out.
  addNodeView() {
    return ({ node, editor, getPos }) => {
      let current = node;
      const dom = document.createElement('div');
      dom.className = 'attachment-block';
      dom.contentEditable = 'false';
      const draw = () => {
        dom.innerHTML = attachmentHtml(current.attrs, { removable: editor.isEditable });
      };
      draw();
      dom.addEventListener('click', (event) => {
        if (!event.target.closest?.('[data-attachment-remove]')) return;
        event.preventDefault();
        const pos = getPos();
        if (typeof pos !== 'number') return;
        editor.view.dispatch(editor.state.tr.delete(pos, pos + current.nodeSize));
        editor.view.focus();
      });
      return {
        dom,
        update(updated) {
          if (updated.type !== current.type) return false;
          current = updated;
          draw();
          return true;
        },
        // A tap on the file (to open it) or on × is ours; everything else is the editor's (select, drag).
        stopEvent: (event) => !!event.target.closest?.('a, button'),
        ignoreMutation: () => true,
      };
    };
  },

  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      new Plugin({
        props: {
          // A pasted screenshot or copied file. A paste that also carries text is left to the text.
          handlePaste(view, event) {
            const files = filesFromTransfer(event.clipboardData);
            if (!files.length || event.clipboardData.getData('text/plain')) return false;
            event.preventDefault();
            attachFiles(editor, files);
            return true;
          },
          // Files dropped onto the note (a drag inside the note moves the block and has no files).
          handleDrop(view, event, slice, moved) {
            const files = moved ? [] : filesFromTransfer(event.dataTransfer);
            if (!files.length) return false;
            event.preventDefault();
            const at = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos ?? null;
            attachFiles(editor, files, { at });
            return true;
          },
        },
      }),
    ];
  },
});
