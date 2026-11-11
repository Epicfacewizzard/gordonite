import { Extension } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { currentMentions } from '../mentions.js';
import { subscribePeople } from '../people-data.js';

// People's names in the text, drawn like the read-only view draws them (class "mention"). Style only: a non-persistent
// inline decoration, so the document, undo, typing and saving are untouched, and there is no click handling (the name is
// a link on the read-only page; here it is just text being edited). Like WikiLinks, it is recomputed per update.
export const Mentions = Extension.create({
  name: 'mentions',
  addOptions() {
    return { getNoteId: null }; // a person's own name on their own page is left plain
  },
  addProseMirrorPlugins() {
    const options = this.options;
    return [new Plugin({
      props: {
        decorations(state) {
          const matcher = currentMentions()?.matcher;
          if (!matcher) return null;
          const selfId = options.getNoteId?.();
          const decorations = [];
          state.doc.descendants((node, pos) => {
            if (!node.isTextblock) return;
            let text = '';
            node.forEach((child) => { text += child.isText ? child.text : '￼'.repeat(child.nodeSize); });
            for (const m of matcher(text)) {
              if (m.id !== selfId) decorations.push(Decoration.inline(pos + 1 + m.from, pos + 1 + m.to, { class: 'mention' }));
            }
          });
          return DecorationSet.create(state.doc, decorations);
        },
      },
      // The people list can arrive after the editor opened: ask for a redraw (a transaction with no change).
      view(view) {
        const stop = subscribePeople(() => {
          if (!view.isDestroyed) view.dispatch(view.state.tr.setMeta('addToHistory', false));
        });
        return { destroy: stop };
      },
    })];
  },
});
