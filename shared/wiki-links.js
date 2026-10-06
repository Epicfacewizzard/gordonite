// Keep imported Markdown unchanged; links are a view over the original text.
export function wikiLinks(text) {
  return [...text.matchAll(/\[\[([^\]\n]+)\]\]/g)].map((m) => {
    const [target, ...alias] = m[1].split('|');
    return { from: m.index, to: m.index + m[0].length, target: target.trim(), label: alias.join('|') || target.trim() };
  }).filter((link) => link.target);
}
export const wikiHref = (target) => `#/link/${encodeURIComponent(target)}`;
