# Links between notes

Since 0.16.0. A note's page shows **Linked from** (the notes whose text links to it); a person's page shows
**Mentioned in** (the same, also counting their other names and, since 0.17.0, their plain name written without a link, see [Plain names](#plain-names-since-0170)). Renaming a note keeps the links to it working.

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

## Plain names (since 0.17.0)

A person's name written in ordinary text counts as a mention, with no `[[ ]]`: **Mentioned in** on their page lists
those notes too, a note's read-only view draws the name as a quiet link to the person's page, and the editor underlines
it while you write (style only: the text, saving and undo are untouched, and a name is not a link there). `shared/mentions.js`
(`buildMentionMatcher`) holds the rules, so the server and the phone agree:

* **Full name** (the note's title), any capitals. A name that is one word is matched as written.
* **"Also called" names**: several words in any capitals, one word as written (`Sammy` is not `sammy`).
* **First name**, as written, at least three letters, **only when nobody else could be meant**: if another person has the
  same first word, or the same name as a title or "Also called" name, it links to nobody. Two people called Tobias mean
  `Tobias` is nobody; `Tobias A` / `Tobias A.` (first name and last initial, as written, when unique) still work.
* Whole words only (`Dev` is not in `Developer`; accents and apostrophes are handled). Where names overlap the earlier,
  longer one wins. Text already inside `[[ ]]` is left to the link.
* Only **people** (notes under `05-people`) are matched. An ordinary note is still linked from by `[[ ]]` alone, and a
  person's own page never lists itself or links their name to itself.

`backlinks` (server, assistant `get_backlinks`) merges both kinds: one row per note, `count` is links and names together,
`lines` up to three distinct lines. The Dashboard's **People today** uses the same
matcher ([ARCHITECTURE.md](ARCHITECTURE.md), the Today screen).

Known limits: a first name that is also an ordinary capitalised word (a person called Will, Grace or May) marks that word
wherever it starts a sentence, and "Sam" at the start of a note counts as a mention of Sam; give such a person a
distinct "Also called" name or accept it. Matching is by the people list: a person not yet in it (just created on
another device) is not marked until the list is next read. Words split across differently formatted text still match (the
view works on the whole line), but a name broken by a line break does not. Lines are read whole, so a name late in a very
long paragraph is found.

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
