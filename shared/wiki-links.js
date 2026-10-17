// Keep imported Markdown unchanged; links are a view over the original text.
export function wikiLinks(text) {
  return [...text.matchAll(/\[\[([^\]\n]+)\]\]/g)].map((m) => {
    const [target, ...alias] = m[1].split('|');
    return { from: m.index, to: m.index + m[0].length, target: target.trim(), label: alias.join('|') || target.trim() };
  }).filter((link) => link.target);
}
export const wikiHref = (target) => `#/link/${encodeURIComponent(target)}`;

// The note title a link names. Imported folder-qualified names ("05 People/Sam.md#Log") match the leaf title.
export const linkTitle = (target) => target.split('#')[0].split('/').at(-1).replace(/\.md$/i, '').trim();
export const sameTitle = (a, b) => a.toLowerCase() === b.toLowerCase();

// A title a [[link]] can name: one that linkTitle gives back unchanged.
export const linkableTitle = (title) => !!title && !/[[\]|#/\n]/.test(title) && !/\.md$/i.test(title) && title.trim() === title;

// The blocks holding text (paragraphs, headings, the text of list items) with their inline text. A line break is "\n",
// so a link never spans one (as on the read-only page); any other inline node counts as one character.
function textBlocks(doc) {
  const out = [];
  const walk = (node) => {
    const kids = node.content ?? [];
    if (kids.some((c) => c.type === 'text' || c.type === 'hardBreak')) out.push(node);
    else kids.forEach(walk);
  };
  walk(doc);
  return out;
}
const pieceText = (c) => (c.type === 'text' ? c.text : c.type === 'hardBreak' ? '\n' : '￼');
const blockText = (block) => block.content.map(pieceText).join('');

/** Every [[link]] in a stored document: { target, title, label, line } where line is the line of text holding it. */
export function linksInDoc(doc) {
  const out = [];
  for (const block of textBlocks(doc)) {
    const text = blockText(block);
    for (const link of wikiLinks(text)) {
      const start = text.lastIndexOf('\n', link.from) + 1;
      const end = text.indexOf('\n', link.to);
      const line = text.slice(start, end === -1 ? undefined : end).replace(/￼/g, '').replace(/\s+/g, ' ').trim();
      out.push({ target: link.target, title: linkTitle(link.target), label: link.label, line: line.length > 200 ? `${line.slice(0, 199)}…` : line });
    }
  }
  return out;
}

/**
 * The document with every link naming oldTitle changed to name newTitle; null when none changed. Only the name changes:
 * "[[Old#Log|them]]" becomes "[[New#Log|them]]" and a folder in front ("[[05 People/Old]]") is dropped. A link whose
 * name is split across differently formatted text is left as it is.
 */
export function rewriteLinks(doc, oldTitle, newTitle) {
  const copy = structuredClone(doc);
  let changed = 0;
  for (const block of textBlocks(copy)) {
    const text = blockText(block);
    const hits = wikiLinks(text).filter((l) => sameTitle(linkTitle(l.target), oldTitle));
    for (const link of hits.reverse()) {
      const inner = text.slice(link.from + 2, link.to - 2);
      const name = inner.split('|')[0].split('#')[0];
      const from = link.from + 2, to = from + name.length;
      let at = 0;
      for (const piece of block.content) {
        const len = pieceText(piece).length;
        if (piece.type === 'text' && from >= at && to <= at + len) {
          const replacement = `${name.match(/^\s*/)[0]}${newTitle}${name.match(/\s*$/)[0]}`;
          piece.text = piece.text.slice(0, from - at) + replacement + piece.text.slice(to - at);
          changed++;
          break;
        }
        at += len;
      }
    }
  }
  return changed ? copy : null;
}
