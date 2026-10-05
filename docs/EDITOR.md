# Editor: engine choice and custom behaviour

## Choice

**Tiptap 3 on ProseMirror**, as the provisional default suggested. It was kept after building and testing
the whole feature set on it. **Lexical was not prototyped**; the comparison below is from documentation and
design reasoning, not a bake-off, so treat it as a reasoned preference rather than a measured result.

| | Tiptap / ProseMirror | Lexical |
|---|---|---|
| Lists and task lists with the required Enter/Backspace/Delete rules | Provided (`@tiptap/extension-list`: bullet, task, `ListKeymap`) and checked by tests here | Lists provided; checklist exists; key behaviour at boundaries would need to be verified and probably tuned |
| Undo/redo | ProseMirror history: grouped by time, one transaction per command, survives our autosave because the editor is never reset | Own history plugin |
| Document format | JSON schema with explicit node/mark types; easy to validate server-side and to version | JSON serialized editor state; format tied to Lexical node classes |
| Mobile/IME | Long history on Android; has a dedicated Android input path (see "Unverified") | Newer; also IME-aware |
| Stable ids for tasks | Official `UniqueID` extension | Would need a custom node property |
| Cost | ~140 kB gzip total for the app | Smaller core |

Not chosen: Slate (weaker mobile track record), Quill (legacy), CodeMirror (code editor model), a plain
`contenteditable` (what the brief rules out).

## What the engine does, what we wrote

**No custom key handling, input rules, commands or ProseMirror plugins were written.** Everything about Enter, Backspace, Delete,
selection, composition, paste and undo is the engine's. The editor-related code we own:

| File | What it does | Why it exists |
|---|---|---|
| `client/src/editor/extensions.js` | Chooses extensions and options | Match the document format: bold, italic, headings 1-3, bullets, tasks. Everything else is turned off (blockquote, code, links, ordered lists, strike, underline, rules, drop/gap cursor, trailing node) so nothing pops up or rewrites the text by itself. Adds `UniqueID` for task ids. |
| `client/src/editor/Toolbar.jsx` | Buttons that call stock commands (`toggleBold`, `toggleTaskList`, `undo`, …) | Cancels pointer/mouse down so the editor keeps focus and the keyboard stays up; `aria-disabled` rather than `disabled` because a disabled button can take focus away. Buttons are defined at module level so a re-render can't replace a button mid-tap. |
| `client/src/editor/NoteEditor.jsx` | Creates/destroys one editor for a note | Connects it to the save engine. Ignores transactions the engine flags `addToHistory:false` (housekeeping such as giving an old task an id) so merely opening a note never saves it; everything else counts as an edit. Refuses to autosave if the stored document can't be represented. Applies the tap that activated the editor (see below). Uses `toggleTaskById` for a checkbox tapped in a read-only note (one ordinary undoable transaction, same as the built-in checkbox). |
| `client/src/editor/render.js` | Draws a document as HTML for notes that are not being edited | A long stream must not mount an editor per note. Same markup/CSS as the editor's. |

### Departures from "just use the engine", and why

1. **Tap → caret in a read-only note.** The caret is placed by *text offset* counted in the read-only view, not
   by screen coordinates. When you tap another note, the previously active editor shrinks and the page shifts
   under your finger; coordinates would then land on the wrong line (this was a real bug found by testing).
2. **Task ids** come from the official `UniqueID` extension, configured with our own UUID generator because
   `crypto.randomUUID` does not exist on plain `http://` pages.
3. **Nested tasks enabled** (`nested: true`) so a task item has the same structure as a bullet item. There is
   no indent control on the toolbar; a hardware keyboard's Tab still works.
4. **The server validates the document** against a whitelist (`shared/doc.js`) and rejects anything else, so
   a bad client cannot store content the editor cannot show.

## Behaviour pinned by tests

These are the engine's behaviours, asserted in `tests/e2e/editing.test.js` and `tasks.test.js` so an upgrade
that changes them is noticed:

* **Enter** splits a paragraph; in a bullet/task it continues the list; a new task starts **unchecked** (even
  from a checked task); Enter on an **empty** bullet/task returns to ordinary text.
* **Backspace at the start** of a bullet/task removes the list/task status first and keeps the text; a second
  Backspace joins it to the block above. At the very start of the note it does nothing.
* **Backspace at the start of a paragraph right after a list** merges it into the last item.
* **Delete at the end of a bullet/task** joins the next one into it. **Delete at the end of a paragraph before a
  list** first turns the first item into text, a second Delete joins (the mirror of Backspace).
* **Text/bullet → task** keeps text, bold/italic and the caret offset; one undo reverses it; redo restores it.
  Task → text and task ↔ bullet convert in place. Several selected lines convert together.
* **Checking/unchecking** changes only that task, in place, is undoable, and persists.
* Toolbar actions keep the selection and the focus; typing resumes immediately.
* Autosave does not change the selection or focus and does not reset undo history.
* Pasted rich text is reduced to supported formatting (links, tables, underline and scripts are dropped).

## Unverified / watch list

* **Real device.** All of this ran in desktop Chrome with touch and mobile emulation, which exercises the
  same ProseMirror code but not Gboard/Samsung Keyboard, autocorrect, swipe typing, text-selection handles,
  or the soft-keyboard resize. IME composition was *simulated* through the Chrome DevTools protocol (composition
  events with autosave timers firing in the middle). See [DEVICE-CHECKLIST.md](DEVICE-CHECKLIST.md).
* **Android input path.** ProseMirror switches to special handling when the user agent says Android. In one
  experiment (emulating an Android user agent but feeding it desktop-style key events) a selection error appeared
  after a very fast insert-then-Backspace of an emoji sequence; it did not occur with the default user agent and
  that combination never happens on a real phone, so it is *not* treated as a finding. It is exactly the kind of
  thing the device checklist exists to settle (emoji and Backspace).
* **Backspace at the start of a heading** leaves a heading; it does not become a paragraph (engine default).
* Browser-native text behaviour differs by platform: e.g. desktop Chrome's double-click selects the trailing
  space, Android does not.
* The tap-to-caret mapping uses `document.caretRangeFromPoint`, available in Chrome; if it is missing the caret
  goes to the end of the note.
