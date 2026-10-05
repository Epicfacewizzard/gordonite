// Markdown -> a note document (format 1). Used when the assistant adds a note and, later, to import an Obsidian vault.
//
// Understood: # headings (levels 1-3; deeper ones become 3), paragraphs, **bold**, *italic*, bullet and numbered lists
// (nested by indent), task lists (- [ ] / - [x]), and a leading --- front matter block (skipped).
// Everything else is kept as plain text rather than dropped: links keep their words, `code` loses the backticks,
// quotes lose the >, tables keep their cells, [[wiki links]] stay as written.
import { uuid } from './ids.js';

const text = (t, marks = []) => ({ type: 'text', text: t, ...(marks.length ? { marks: marks.map((type) => ({ type })) } : {}) });

// Inline markup -> text nodes with bold/italic marks.
export function inlineToNodes(src) {
  const out = [];
  const push = (t, marks) => {
    if (!t) return;
    const last = out[out.length - 1];
    const same = last && JSON.stringify(last.marks ?? []) === JSON.stringify(marks.map((type) => ({ type })).filter(() => marks.length));
    if (last && (marks.length ? same : !last.marks)) last.text += t;
    else out.push(text(t, marks));
  };
  const walk = (s, marks) => {
    // escapes | bold | italic (underscores only at word edges, so snake_case is left alone) | `code` | [text](url) / ![alt](url)
    const re = /\\([\\`*_{}[\]()#+\-.!>|~])|(\*\*|__)(?=\S)([\s\S]*?\S)\2|(?<![\w*])\*(?=[^\s*])([\s\S]*?[^\s*])\*(?!\*)|(?<![\w])_(?=\S)([\s\S]*?\S)_(?![\w])|`([^`]+)`|!?\[([^\]]*)\]\(([^)]*)\)/g;
    let last = 0;
    for (const m of s.matchAll(re)) {
      push(s.slice(last, m.index), marks);
      last = m.index + m[0].length;
      if (m[1] !== undefined) push(m[1], marks);
      else if (m[3] !== undefined) walk(m[3], marks.includes('bold') ? marks : [...marks, 'bold']);
      else if (m[4] !== undefined) walk(m[4], marks.includes('italic') ? marks : [...marks, 'italic']);
      else if (m[5] !== undefined) walk(m[5], marks.includes('italic') ? marks : [...marks, 'italic']);
      else if (m[6] !== undefined) push(m[6], marks);
      else push(m[7] ?? '', marks); // a link keeps its words; an image keeps its alt text
    }
    push(s.slice(last), marks);
  };
  walk(src, []);
  return out;
}

const paragraph = (s) => {
  const content = inlineToNodes(s.trim());
  return content.length ? { type: 'paragraph', content } : { type: 'paragraph' };
};

const ITEM = /^(\s*)([-*+]|\d+[.)])\s+(?:\[([ xX])\]\s+)?(.*)$/;
const indentOf = (ws) => ws.replace(/\t/g, '    ').length;

// Lines of consecutive list items -> nested list nodes. Returns [nodes, nextIndex].
function buildLists(items, from, baseIndent) {
  const lists = [];
  let i = from;
  while (i < items.length && items[i].indent >= baseIndent) {
    const it = items[i];
    if (it.indent > baseIndent) {
      // deeper than the current level without a parent item: treat as this level
      items[i] = { ...it, indent: baseIndent };
      continue;
    }
    const task = it.checked !== null;
    const listType = task ? 'taskList' : 'bulletList';
    let list = lists[lists.length - 1];
    if (!list || list.type !== listType) {
      list = { type: listType, content: [] };
      lists.push(list);
    }
    const body = [paragraph(it.text)];
    i++;
    if (i < items.length && items[i].indent > baseIndent) {
      const [children, next] = buildLists(items, i, items[i].indent);
      body.push(...children);
      i = next;
    }
    list.content.push(task ? { type: 'taskItem', attrs: { checked: it.checked, id: uuid() }, content: body } : { type: 'listItem', content: body });
  }
  return [lists, i];
}

/** A note document from Markdown. Never throws on odd input; unknown syntax stays as text. */
export function markdownToDoc(md) {
  let src = String(md ?? '').replace(/\r\n?/g, '\n');
  src = src.replace(/^---\n[\s\S]*?\n---[ \t]*(\n|$)/, ''); // front matter
  const lines = src.split('\n');
  const blocks = [];
  let para = [];
  let items = [];
  let inFence = false;

  const flushPara = () => {
    if (para.length) blocks.push(paragraph(para.join(' ')));
    para = [];
  };
  const flushItems = () => {
    if (!items.length) return;
    const [lists] = buildLists(items, 0, Math.min(...items.map((x) => x.indent)));
    blocks.push(...lists);
    items = [];
  };

  for (const raw of lines) {
    if (/^\s*(```|~~~)/.test(raw)) {
      inFence = !inFence;
      flushPara();
      flushItems();
      continue;
    }
    if (inFence) {
      if (raw.trim()) blocks.push({ type: 'paragraph', content: [text(raw.trim())] }); // code stays as plain lines
      continue;
    }
    const line = raw.replace(/^\s{0,3}>\s?/, ''); // quote marker
    if (!line.trim()) {
      flushPara();
      flushItems();
      continue;
    }
    const h = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (h) {
      flushPara();
      flushItems();
      blocks.push({ type: 'heading', attrs: { level: Math.min(h[1].length, 3) }, content: inlineToNodes(h[2]) });
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      flushPara();
      flushItems();
      continue; // horizontal rule
    }
    const m = ITEM.exec(line);
    if (m) {
      flushPara();
      items.push({ indent: indentOf(m[1]), checked: m[3] === undefined ? null : m[3] !== ' ', text: m[4] });
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(line)) {
      // table row: keep the cells, drop the separator row
      flushPara();
      flushItems();
      if (!/^[\s|:-]+$/.test(line)) blocks.push(paragraph(line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim()).join(' · ')));
      continue;
    }
    if (items.length && /^\s+\S/.test(line)) {
      items[items.length - 1].text += ` ${line.trim()}`; // a wrapped list item
      continue;
    }
    flushItems();
    para.push(line.trim());
  }
  flushPara();
  flushItems();
  return { type: 'doc', content: blocks.length ? blocks : [{ type: 'paragraph' }] };
}
