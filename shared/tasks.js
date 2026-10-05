// Tasks live inside note documents (taskItem nodes with a stable id), so there is no
// separate task table. These helpers read and change them in a document; the server
// uses extractTasks for the combined list and the client uses setTaskChecked to tick
// one without opening an editor.

const inlineText = (node) => {
  if (node.type === 'text') return node.text;
  if (node.type === 'hardBreak') return ' ';
  return (node.content ?? []).map(inlineText).join('');
};

// The task's own words: its paragraphs, not any task nested under it.
const ownText = (item) =>
  (item.content ?? [])
    .filter((c) => c.type !== 'taskList')
    .map(inlineText)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Tasks in document order: [{ id, text, checked }]. Tasks without an id or any text are skipped. */
export function extractTasks(doc) {
  const out = [];
  const walk = (node) => {
    if (node.type === 'taskItem') {
      const text = ownText(node);
      if (node.attrs?.id && text) out.push({ id: node.attrs.id, text, checked: !!node.attrs.checked });
    }
    for (const child of node.content ?? []) walk(child);
  };
  walk(doc);
  return out;
}

/** A copy of the document with one task ticked or unticked, or null if no task has that id. */
export function setTaskChecked(doc, taskId, checked) {
  let found = false;
  const walk = (node) => {
    if (node.type === 'taskItem' && node.attrs?.id === taskId) {
      found = true;
      node = { ...node, attrs: { ...node.attrs, checked } };
    }
    return node.content ? { ...node, content: node.content.map(walk) } : node;
  };
  const next = walk(doc);
  return found ? next : null;
}
