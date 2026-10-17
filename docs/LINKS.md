# Links between notes

Since 0.16.0. A note's page shows **Linked from** (the notes whose text links to it); a person's page shows
**Mentioned in** (the same, also counting their other names). Renaming a note keeps the links to it working.

## How links are written

Unchanged from before: `[[Note title]]`, `[[Note title|label]]`, `[[Folder/Note title.md#Heading]]` (imported
vault links). A link names a note by its **title**; the text between `[[ ]]` is stored as typed, so exports and imports
are untouched. Titles match without regard to capitals. Opening a link (`#/link/<name>`, [LINK-NAVIGATION.md](LINK-NAVIGATION.md))
goes to the note with that title; when more than one note has the title you choose.

* **People:** there is no separate `@` mention. A person is a note, so `[[Samantha Lee]]` is the mention. A person's
  **Also called** names (People details) work too: `[[Sammy]]` opens Samantha and counts as a mention of her, unless
  some note is itself titled "Sammy" (that note wins).
* **Typing `[[`** in a note lists notes and people to link to (type to narrow; Up/Down, Enter or Tab to pick, Escape
  to close; tapping works). A person's other name is inserted as `[[Samantha Lee|Sammy]]`. Nothing is written unless
  you pick one. Only free notes have titles, so only they (and people) are listed; a title containing `[ ] | # /`
  cannot be written as a link and is not offered.
* **Linked from / Mentioned in** lists live notes (not Trash), newest first, each with the line(s) holding the link;
  tapping opens that note. A note does not list itself. The list is read from the server and a copy is kept for offline.

## Renaming

When a free note's title changes, the server changes every `[[Old title]]` (also `[[Old title#Heading|label]]`, any
capitals, and imported `[[Folder/Old title.md]]`, which becomes `[[New title]]`) in the other live notes to the new
title, **in the same save**. Each changed note gets a new revision and its previous text is kept in **History** as
"Before a linked note was renamed", so Restore undoes it. A phone that has that note open without unsent text shows
the new text; one with unsent text keeps it and meets the usual conflict instead of being overwritten.

Not rewritten: when another live note has the old title (the links may mean that one); when the new title cannot be
written as a link; a link whose name is split across differently formatted text; a note moved to Trash (its links
are changed only if it is restored and the title edited again); and links in a note edited on a phone not yet synced
(those link by the text typed, and keep working by title if a note with that title exists).
Removing a title does not rewrite anything (those links stop resolving until a note has the name again).

## The index

`server/links.js` reads each note's links and keeps them in memory, re-reading a note only when its revision
changes, so it follows typing, the assistant, restored versions and imports with no hook in each. Nothing is stored in
the database (no schema change). Parsing is `shared/wiki-links.js` (`linksInDoc`, `rewriteLinks`).

## API and assistant

`GET /api/notes/:id/backlinks`, `GET /api/note-names` (for the suggestions), `GET /api/note-links?target=` (now also
matches a person's other names, with `alias` set). The MCP tools `get_backlinks` and `resolve_link` read the same
([MCP.md](MCP.md)).

## Tests

`tests/server/links.test.js`, `tests/client/wiki-links.test.js` (suggestions), `tests/client/sync-save.test.js`
(refresh after a rename), `tests/e2e/links.test.js`, and the MCP test.

## Known limits

* Links are by title; a title changed on a phone that is offline is rewritten when it reaches the server.
* Two people or notes with the same title: links open a chooser and are counted for neither unambiguously (all
  same-titled notes list the same linking notes).
* Trashed notes do not appear as linking notes.
