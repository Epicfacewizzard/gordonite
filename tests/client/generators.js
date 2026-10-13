// Random documents for the editor-parity tests: built from the editor's own schema, so they are exactly what the
// editor can hold, plus a way to change one slightly (and an oracle: would the editor open the result?).
import { getSchema } from '@tiptap/core';
import { createExtensions } from '../../client/src/editor/extensions.js';

export const schema = getSchema(createExtensions());

export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const pick = (r, list) => list[Math.floor(r() * list.length)];

/** Would the editor open this document? (Its schema's own check, the same one Tiptap uses for strict content.) */
export function editorAccepts(json) {
  try {
    schema.nodeFromJSON(json).check();
    return true;
  } catch {
    return false;
  }
}

const WORDS = ['alpha', 'beta words', 'gamma', 'delta task', 'x'];
let idCounter = 0;
const marksFor = (r) => pick(r, [{}, {}, { marks: [{ type: 'bold' }] }, { marks: [{ type: 'italic' }] }, { marks: [{ type: 'bold' }, { type: 'italic' }] }]);
function attrsFor(name, r) {
  if (name === 'heading') return { level: 1 + Math.floor(r() * 3) };
  if (name === 'taskItem') return { id: `task-gen-${++idCounter}`, checked: r() < 0.3, ...(r() < 0.3 ? { due: '2026-10-20' } : {}) };
  if (name === 'attachment') return { id: `file-gen-${++idCounter}`, name: 'a.pdf', mime: 'application/pdf', size: 10 };
  return undefined;
}

// A random document the editor's schema can hold, built by walking its content expressions.
export function generate(type, r, depth = 0) {
  if (type.name === 'text') return { type: 'text', text: pick(r, WORDS), ...marksFor(r) };
  const node = { type: type.name };
  const attrs = attrsFor(type.name, r);
  if (attrs) node.attrs = attrs;
  if (type.name === 'hardBreak') Object.assign(node, marksFor(r));
  if (type.isLeaf) return node;
  const nesting = new Set(['bulletList', 'taskList']);
  const want = Math.floor(r() * 4);
  const content = [];
  let match = type.contentMatch;
  for (;;) {
    const edges = [];
    for (let i = 0; i < match.edgeCount; i++) edges.push(match.edge(i));
    const usable = edges.filter((e) => depth < 4 || !nesting.has(e.type.name));
    if (match.validEnd && (content.length >= want || usable.length === 0)) break;
    const edge = pick(r, usable.length ? usable : edges);
    content.push(generate(edge.type, r, depth + 1));
    match = edge.next;
  }
  if (content.length) node.content = content;
  return node;
}

export const TYPES = ['paragraph', 'heading', 'bulletList', 'taskList', 'listItem', 'taskItem', 'attachment', 'text', 'hardBreak'];
export function generateAny(name, r, depth = 0) {
  const node = { type: name };
  const attrs = attrsFor(name, r);
  if (attrs) node.attrs = attrs;
  if (name === 'text') return { ...node, text: pick(r, WORDS), ...marksFor(r) };
  if (name === 'hardBreak') return { ...node, ...marksFor(r) };
  if (name === 'attachment') return node;
  const count = depth >= 3 ? 0 : Math.floor(r() * 3);
  if (count) node.content = Array.from({ length: count }, () => generateAny(pick(r, TYPES), r, depth + 1));
  return node;
}

function allPaths(node, path = [], out = []) {
  out.push(path);
  (node.content ?? []).forEach((child, i) => allPaths(child, [...path, i], out));
  return out;
}
const at = (root, path) => path.reduce((n, i) => n.content[i], root);

// One small change to a valid document: it is then valid or not, and the editor and the validator must say the same.
export function mutate(source, r) {
  const root = structuredClone(source);
  const path = pick(r, allPaths(root));
  const node = at(root, path);
  const parent = path.length ? at(root, path.slice(0, -1)) : null;
  const op = pick(r, ['insert', 'insert', 'remove', 'retype', 'wrap', 'marks']);
  if (op === 'insert') {
    // a text node has no children; ProseMirror quietly ignores a "content" on one, the validator refuses it
    const target = node.type === 'text' ? parent : node;
    target.content = target.content ?? [];
    target.content.splice(Math.floor(r() * (target.content.length + 1)), 0, generateAny(pick(r, TYPES), r, 2));
  } else if (op === 'remove' && parent) {
    parent.content.splice(path.at(-1), 1);
    if (!parent.content.length) delete parent.content;
  } else if (op === 'retype' && parent) {
    const type = pick(r, TYPES);
    const attrs = attrsFor(type, r);
    node.type = type;
    if (attrs) node.attrs = attrs;
    else delete node.attrs;
    if (type === 'text') Object.assign(node, { text: 'w' }), delete node.content;
  } else if (op === 'wrap' && parent) {
    const type = pick(r, ['paragraph', 'bulletList', 'taskList', 'listItem', 'taskItem']);
    parent.content[path.at(-1)] = { type, ...(attrsFor(type, r) ? { attrs: attrsFor(type, r) } : {}), content: [node] };
  } else if (op === 'marks' && parent) {
    // (not on the root: ProseMirror does not apply the "which nodes take marks" rule to the top node)
    node.marks = pick(r, [[{ type: 'bold' }], [{ type: 'italic' }], [{ type: 'bold' }, { type: 'bold' }]]);
  }
  return root;
}
