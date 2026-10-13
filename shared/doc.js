// Structured note documents.
//
// A note body is a ProseMirror/Tiptap JSON document stored together with an
// explicit format version (DOC_FORMAT). Each format allows only the nodes and
// marks below. Changing the allowed set, or the meaning of an attribute,
// requires a new format number and a migration in `migrateDoc`.
//
//   1  paragraphs, headings, bullet lists, tasks.
//   2  adds the `attachment` block (a file, image or PDF stored on the server; see docs/ATTACHMENTS.md).
//      Format 2 is a strict superset: every format-1 document is already a valid format-2 document.
//
// Which nodes may sit inside which is part of the contract too (see contentRule below). The editor's own schema
// (client/src/editor/extensions.js) states the same rules; tests/client/doc-contract.test.js generates documents and
// checks that the two agree, so a node or a nesting rule is only ever changed in both places.
import { isValidDateString, isValidTime } from './dates.js';
import { isPlausibleMime } from './attachments.js';

// Optional attributes may be ADDED to a node (e.g. taskItem due/start/hidden) without a new format:
// existing documents stay valid and meaning does not change. Removing a node/mark/attribute or
// changing what one means needs a new number.
export const DOC_FORMAT = 2;

const NODE_TYPES = new Set([
  'doc',
  'paragraph',
  'text',
  'heading',
  'hardBreak',
  'bulletList',
  'listItem',
  'taskList',
  'taskItem',
  'attachment',
]);
const ATTACHMENT_ID = /^[A-Za-z0-9_-]{8,64}$/;
const MARK_TYPES = new Set(['bold', 'italic']);
// Text and line breaks are the inline nodes: they sit inside a paragraph or heading and are the only nodes that carry marks.
const INLINE = ['text', 'hardBreak'];

// What may sit inside what.
//
//   doc         one or more blocks
//   paragraph   text and line breaks          heading     text and line breaks (level 1 to 3)
//   bulletList  one or more listItem          taskList    one or more taskItem
//   listItem    a paragraph, then any blocks (this is how lists nest)        taskItem   the same
//   attachment  nothing inside it (format 2)  text, hardBreak   nothing inside
//
// `first` is the type the first child must have; `min` the fewest children.
const BLOCKS_1 = ['paragraph', 'heading', 'bulletList', 'taskList'];
const blocksFor = (format) => (format >= 2 ? [...BLOCKS_1, 'attachment'] : BLOCKS_1);
function contentRule(type, format) {
  switch (type) {
    case 'doc':
      return { allow: blocksFor(format), min: 1 };
    case 'paragraph':
    case 'heading':
      return { allow: INLINE };
    case 'bulletList':
      return { allow: ['listItem'], min: 1 };
    case 'taskList':
      return { allow: ['taskItem'], min: 1 };
    case 'listItem':
    case 'taskItem':
      return { allow: blocksFor(format), first: 'paragraph' };
    default:
      return { allow: [] }; // text, hardBreak, attachment
  }
}
const MAX_DEPTH = 20;
const MAX_NODES = 200_000;

export function emptyDoc() {
  return { type: 'doc', content: [{ type: 'paragraph' }] };
}

// Upgrade older stored documents to the current format. Format 2 only adds a node type, so a format-1
// document is already a valid format-2 document and is returned unchanged.
export function migrateDoc(doc, fromFormat) {
  if (fromFormat === DOC_FORMAT || fromFormat === 1) return doc;
  throw new Error(`Unsupported document format ${fromFormat}`);
}

// Returns null when valid, otherwise a short error string. `format` is the format the sender says the
// document is in; a document that claims format 1 may not contain nodes added later.
//
// With { structure: false } the nesting rules are not applied (everything else is). That is only for looking at
// documents stored before the nesting rules existed; see hasOnlyStructureProblems.
export function validateDoc(doc, format = DOC_FORMAT, { structure = true } = {}) {
  if (!doc || typeof doc !== 'object' || doc.type !== 'doc') return 'document root must be {type:"doc"}';
  let count = 0;
  const walk = (node, depth, parent, index) => {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return 'node must be an object';
    if (depth > MAX_DEPTH) return 'document nested too deeply';
    if (++count > MAX_NODES) return 'document too large';
    if (!NODE_TYPES.has(node.type)) return `unsupported node type "${node.type}"`;
    if (node.type === 'text' && (typeof node.text !== 'string' || node.text.length === 0)) return 'text node needs non-empty text';
    if (node.marks !== undefined) {
      // Marks sit on inline nodes. A line break inside bold text carries the bold mark, exactly as the editor writes it.
      if (!INLINE.includes(node.type)) return 'only text and line breaks may carry marks';
      if (!Array.isArray(node.marks)) return 'marks must be a list';
      for (const m of node.marks) {
        if (!m || !MARK_TYPES.has(m.type)) return `unsupported mark "${m?.type}"`;
      }
      if (new Set(node.marks.map((m) => m.type)).size !== node.marks.length) return 'a mark can only be applied once to the same text';
    }
    if (node.type === 'attachment') {
      if (format < 2) return 'attachments need document format 2';
      const a = node.attrs ?? {};
      if (typeof a.id !== 'string' || !ATTACHMENT_ID.test(a.id)) return 'attachment.id must be a file id';
      if (typeof a.name !== 'string' || !a.name || a.name.length > 255) return 'attachment.name must be a file name';
      if (!isPlausibleMime(a.mime)) return 'attachment.mime must be a media type';
      if (!Number.isInteger(a.size) || a.size < 0) return 'attachment.size must be a whole number of bytes';
      if (node.content !== undefined && !(Array.isArray(node.content) && node.content.length === 0)) return 'attachment cannot have content';
    }
    if (node.type === 'heading') {
      const lv = node.attrs?.level;
      if (!Number.isInteger(lv) || lv < 1 || lv > 3) return 'heading level must be 1-3';
    }
    if (node.type === 'taskItem') {
      const a = node.attrs ?? {};
      if (a.checked !== undefined && typeof a.checked !== 'boolean') return 'taskItem.checked must be boolean';
      if (a.id != null && typeof a.id !== 'string') return 'taskItem.id must be a string';
      // Optional, added without a format bump: older documents simply do not have them.
      for (const k of ['due', 'start']) {
        if (a[k] != null && !isValidDateString(a[k])) return `taskItem.${k} must be a YYYY-MM-DD date`;
      }
      for (const k of ['dueTime', 'startTime']) {
        if (a[k] != null && !isValidTime(a[k])) return `taskItem.${k} must be HH:mm`;
      }
      if (a.hidden != null && typeof a.hidden !== 'boolean') return 'taskItem.hidden must be boolean';
      for (const key of ['dismissedAt', 'completedAt']) {
        if (a[key] != null && (typeof a[key] !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(a[key]) || !Number.isFinite(Date.parse(a[key])))) return `taskItem.${key} must be a UTC timestamp`;
      }
      if (a.hideUntil != null && !isValidDateString(a.hideUntil)) return 'taskItem.hideUntil must be a YYYY-MM-DD date';
      if (a.priority != null && !['both', 'urgent', 'important'].includes(a.priority)) return 'taskItem.priority must be both, urgent or important';
    }
    if (structure && parent) {
      const rule = contentRule(parent.type, format);
      if (index === 0 && rule.first && node.type !== rule.first) return `a ${parent.type} must start with a ${rule.first}`;
      if (!rule.allow.includes(node.type)) return `${node.type} cannot go inside ${parent.type}`;
    }
    if (node.content !== undefined) {
      if (!Array.isArray(node.content)) return 'content must be an array';
      for (let i = 0; i < node.content.length; i++) {
        const err = walk(node.content[i], depth + 1, node, i);
        if (err) return err;
      }
    }
    if (structure) {
      const rule = contentRule(node.type, format);
      const children = node.content?.length ?? 0;
      if (rule.first && children === 0) return `a ${node.type} must start with a ${rule.first}`;
      if (rule.min && children < rule.min) return `a ${node.type} needs at least one ${node.type === 'doc' ? 'block' : rule.allow[0]}`;
    }
    return null;
  };
  return walk(doc, 0, null, 0);
}

// A document that is acceptable except for how its nodes are nested. Notes stored before the nesting rules existed
// may be like this; saving them again is allowed (so they stay editable) until someone repairs them on purpose.
export const hasOnlyStructureProblems = (doc, format = DOC_FORMAT) =>
  validateDoc(doc, format, { structure: false }) === null && validateDoc(doc, format) !== null;

// Every attachment node in a document (its attrs), in order.
export function attachmentsIn(doc) {
  const found = [];
  const walk = (node) => {
    if (node?.type === 'attachment' && node.attrs) found.push(node.attrs);
    for (const child of node?.content ?? []) walk(child);
  };
  walk(doc);
  return found;
}

// Plain text of a document, one block per line. Used for previews, for search (so a file is found by its
// name) and for the "content shrank sharply" version guard.
export function plainText(doc) {
  const lines = [];
  const inline = (node) => {
    if (node.type === 'text') return node.text;
    if (node.type === 'hardBreak') return '\n';
    return (node.content ?? []).map(inline).join('');
  };
  const block = (node) => {
    if (node.type === 'paragraph' || node.type === 'heading') {
      lines.push(inline(node));
    } else if (node.type === 'attachment') {
      lines.push(String(node.attrs?.name ?? ''));
    } else {
      for (const c of node.content ?? []) block(c);
    }
  };
  block(doc);
  return lines.join('\n');
}

export function isEmptyDoc(doc) {
  return plainText(doc).trim().length === 0;
}
