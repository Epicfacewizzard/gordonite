import { Extension } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';
import { api } from '../api.js';

// Typing "[[" lists notes and people to link to (docs/LINKS.md). Picking one writes "Name]]", so what is stored is the
// same plain [[Name]] text as before; a person's "Also called" name is written "[[Name|Nickname]]". Nothing is
// inserted unless a suggestion is picked: Escape, or typing on past a "]", just closes the list.

const OPEN = /\[\[([^[\]|#\n￼]{0,60})$/;
const MAX = 8;
const FRESH_MS = 30_000;

let names = { at: 0, data: null, loading: null };
function loadNames() {
  if (names.data && Date.now() - names.at < FRESH_MS) return Promise.resolve(names.data);
  names.loading ??= api
    .noteNames()
    .then((data) => (names = { at: Date.now(), data, loading: null }).data)
    .catch(() => ((names.loading = null), names.data));
  return names.loading;
}

/** The suggestions for what is typed after "[[": names starting with it first, then names containing it. */
export function suggestLinks(data, query) {
  const q = query.trim().toLowerCase();
  const all = [
    ...data.notes.map((n) => ({ key: `n:${n.id}`, title: n.title, insert: n.title, person: n.person })),
    ...data.aliases.map((a) => ({ key: `a:${a.id}:${a.name}`, title: a.name, insert: `${a.title}|${a.name}`, person: true, of: a.title })),
  ].filter((s) => !/[[\]|#/\n]/.test(s.of ?? s.title));
  if (!q) return all.filter((s) => !s.of).slice(0, MAX);
  const starts = [], within = [];
  for (const s of all) {
    const t = s.title.toLowerCase();
    if (t.startsWith(q)) starts.push(s);
    else if (t.includes(q)) within.push(s);
  }
  return [...starts, ...within].slice(0, MAX);
}

export const LinkSuggest = Extension.create({
  name: 'linkSuggest',
  addProseMirrorPlugins() {
    const ui = { list: null, items: [], index: 0, match: null, closedAt: null, view: null };

    const close = () => {
      ui.list?.remove();
      ui.list = null;
      ui.items = [];
      ui.match = null;
    };
    const choose = (item) => {
      const { view, match } = ui;
      if (!view || !match) return;
      const after = view.state.doc.textBetween(match.to, Math.min(match.to + 2, match.end), '\n', '￼');
      const to = after === ']]' ? match.to + 2 : match.to;
      close();
      view.dispatch(view.state.tr.insertText(`${item.insert}]]`, match.from, to).scrollIntoView());
      view.focus();
    };
    const render = () => {
      const { view, match } = ui;
      if (!view || !match || !names.data) return;
      ui.items = suggestLinks(names.data, match.query);
      if (!ui.items.length) {
        ui.list?.remove();
        ui.list = null;
        return;
      }
      ui.index = Math.min(ui.index, ui.items.length - 1);
      if (!ui.list) {
        ui.list = document.createElement('ul');
        ui.list.className = 'link-suggest';
        ui.list.setAttribute('role', 'listbox');
        ui.list.setAttribute('aria-label', 'Link to a note');
        ui.list.dataset.testid = 'link-suggest';
        document.body.append(ui.list);
      }
      ui.list.replaceChildren(
        ...ui.items.map((item, i) => {
          const li = document.createElement('li');
          li.setAttribute('role', 'option');
          li.setAttribute('aria-selected', String(i === ui.index));
          li.textContent = item.title;
          if (item.of || item.person) {
            const note = document.createElement('span');
            note.className = 'muted small';
            note.textContent = item.of ? ` · ${item.of}` : ' · person';
            li.append(note);
          }
          li.addEventListener('mousedown', (e) => e.preventDefault()); // keep the caret in the note
          li.addEventListener('click', () => choose(item));
          return li;
        }),
      );
      // Under the caret, or above it when the keyboard leaves no room below.
      const at = view.coordsAtPos(match.to);
      const height = window.visualViewport?.height ?? window.innerHeight;
      const box = ui.list.getBoundingClientRect();
      const below = at.bottom + 4;
      ui.list.style.left = `${Math.max(8, Math.min(at.left, window.innerWidth - box.width - 8))}px`;
      ui.list.style.top = `${below + box.height > height && at.top - box.height - 4 > 0 ? at.top - box.height - 4 : below}px`;
    };
    const update = (view) => {
      ui.view = view;
      const { selection } = view.state;
      const $from = selection.$from;
      if (!view.editable || !selection.empty || !$from.parent.isTextblock) return close();
      const before = $from.parent.textBetween(0, $from.parentOffset, '\n', '￼');
      const m = OPEN.exec(before);
      const from = m ? $from.pos - m[1].length : null;
      if (!m) ui.closedAt = null;
      if (!m || ui.closedAt === from) return close();
      ui.closedAt = null;
      if (ui.match?.from !== from || ui.match.query !== m[1]) ui.index = 0;
      ui.match = { from, to: $from.pos, end: $from.end(), query: m[1] };
      if (names.data) render();
      loadNames().then(() => ui.match && render());
    };

    return [
      new Plugin({
        view: (view) => {
          update(view);
          return { update, destroy: close };
        },
        props: {
          handleKeyDown(view, event) {
            if (!ui.list || !ui.items.length) return false;
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              ui.index = (ui.index + (event.key === 'ArrowDown' ? 1 : ui.items.length - 1)) % ui.items.length;
              render();
              return true;
            }
            if (event.key === 'Enter' || event.key === 'Tab') {
              choose(ui.items[ui.index]);
              return true;
            }
            if (event.key === 'Escape') {
              ui.closedAt = ui.match?.from ?? null; // stays closed for this "[[" until the caret leaves it
              close();
              return true;
            }
            return false;
          },
          handleDOMEvents: {
            blur: () => {
              close();
              return false;
            },
          },
        },
      }),
    ];
  },
});
