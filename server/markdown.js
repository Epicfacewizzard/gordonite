// Readable Markdown for Personal HQ documents (format 1).
// This export is for reading and for other tools. It is lossy (task ids and
// revision history are not included); the JSON export is the full-fidelity one.

const MARK_ORDER = ['bold', 'italic'];
const DELIM = { bold: '**', italic: '*' };

const escapeText = (s) => s.replace(/([\\`*_[\]<>])/g, '\\$1');

function wrap(delim, s) {
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(s);
  return m[2] ? `${m[1]}${delim}${m[2]}${delim}${m[3]}` : s;
}

function renderInline(nodes, marks = MARK_ORDER) {
  if (marks.length === 0) {
    return nodes.map((n) => (n.type === 'hardBreak' ? '  \n' : escapeText(n.text))).join('');
  }
  const [mark, ...rest] = marks;
  const has = (n) => (n.marks ?? []).some((m) => m.type === mark);
  let out = '';
  for (let i = 0; i < nodes.length; ) {
    const on = has(nodes[i]);
    let j = i;
    while (j < nodes.length && has(nodes[j]) === on) j++;
    const group = nodes.slice(i, j);
    if (on) {
      const stripped = group.map((n) => ({ ...n, marks: n.marks.filter((m) => m.type !== mark) }));
      out += wrap(DELIM[mark], renderInline(stripped, rest));
    } else {
      out += renderInline(group, rest);
    }
    i = j;
  }
  return out;
}

const escapeLineStart = (s) => s.replace(/^(#{1,6}\s|[-+]\s|>|\d+[.)]\s)/, '\\$1');

function renderBlock(node) {
  switch (node.type) {
    case 'paragraph':
      return escapeLineStart(renderInline(node.content ?? []));
    case 'heading':
      return `${'#'.repeat(node.attrs.level)} ${renderInline(node.content ?? [])}`;
    case 'bulletList':
      return (node.content ?? []).map((li) => renderItem('- ', li)).join('\n');
    case 'taskList':
      return (node.content ?? []).map((ti) => renderItem(`- [${ti.attrs?.checked ? 'x' : ' '}] `, ti)).join('\n');
    default:
      return '';
  }
}

function renderItem(prefix, item) {
  const [first, ...rest] = item.content ?? [];
  const head = first ? renderInline(first.content ?? []) : '';
  const lines = [prefix + head];
  for (const child of rest) {
    for (const line of renderBlock(child).split('\n')) lines.push(`  ${line}`);
  }
  return lines.join('\n');
}

export function docToMarkdown(doc) {
  // List-only runs stay tight; other blocks are separated by a blank line.
  const blocks = (doc.content ?? []).map(renderBlock);
  return `${blocks.join('\n\n').trimEnd()}\n`;
}

export function noteToMarkdownFile(note) {
  const front = [
    '---',
    `id: ${note.id}`,
    `date: ${note.date}`,
    `tags: [${note.tags.map((t) => t.path).join(', ')}]`,
    `created: ${note.createdAt}`,
    `updated: ${note.updatedAt}`,
    '---',
    '',
  ].join('\n');
  return front + docToMarkdown(note.doc);
}
