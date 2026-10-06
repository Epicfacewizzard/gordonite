import { Extension } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { wikiLinks, wikiHref } from '../../../shared/wiki-links.js';

export const WikiLinks = Extension.create({
  name: 'wikiLinks',
  addProseMirrorPlugins() {
    return [new Plugin({ props: {
      decorations(state) {
        const decorations = [];
        state.doc.descendants((node, pos) => {
          if (!node.isTextblock) return;
          let text = '';
          node.forEach((child) => { text += child.isText ? child.text : '\uFFFC'.repeat(child.nodeSize); });
          for (const link of wikiLinks(text)) {
            decorations.push(Decoration.inline(pos + 1 + link.from, pos + 1 + link.to, { class: 'wiki-link-text' }));
            decorations.push(Decoration.widget(pos + 1 + link.to, () => {
              const a = document.createElement('a');
              a.href = wikiHref(link.target); a.textContent = '↗'; a.className = 'wiki-open';
              a.contentEditable = 'false'; a.setAttribute('aria-label', `Open link to ${link.label}`);
              a.addEventListener('mousedown', (e) => e.preventDefault());
              return a;
            }, { side: 1, key: `${pos}:${link.from}:${link.target}` }));
          }
        });
        return DecorationSet.create(state.doc, decorations);
      },
    } })];
  },
});
