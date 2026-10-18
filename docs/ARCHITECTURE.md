# Architecture

## Data model (SQLite, schema version in `PRAGMA user_version`)

```
tags(id, path UNIQUE, created_at, favorite, daily)
notes(id, note_date, doc, doc_format, revision, last_op_id, created_at, updated_at, deleted_at, last_snapshot_at, kind, title)
note_tags(note_id, tag_id, note_date, live, slot)  UNIQUE(tag_id, note_date) WHERE live = 1 AND slot = 1
note_versions(id, note_id, revision, doc, doc_format, kind, created_at)
meta(key, value)
mood_entries(id, score, note, day, logged_at, created_at, deleted_at)
attachments(id, sha256, name, mime, size, kind, original_sha256/name/mime/size, note_id, source, created_at, deleted_at)
```

* **Files** (`attachments`, schema v6; see [ATTACHMENTS.md](ATTACHMENTS.md)). The bytes are on disk under
  `DATA_DIR/files/<sha256[0:2]>/<sha256>`, named by their content hash, written once and never changed; the row says
  what the file is called and what it is (decided from its bytes, never from the sender's claim). `note_id` is the
  note that first saved a reference to it and is deliberately not a foreign key (a file outlives a purged note).
  A HEIC photo is stored as a JPEG with the original kept (`original_*`). Removing is soft (`deleted_at`).
  **The SQLite backup does not contain these bytes**; back the folder up with the database.

* **Stable ids**: notes and tags have UUIDs (notes are created with a client-generated id, which is what
  makes "create" safe to retry); each task has a UUID **inside the note's document** (`taskItem.attrs.id`).
  There is no separate task table, so there is no second copy of task text to drift.
* **Dates vs timestamps**: `note_date` is a plain calendar date (`YYYY-MM-DD`, in `HOME_TZ` when the note was
  created); `created_at`/`updated_at`/`deleted_at` are UTC instants. Changing the time zone setting never
  moves existing notes.
* **Two kinds of note** (`notes.kind`). A **daily** note is a stream's entry for a day: **one per tag per date**,
  enforced by the database with a unique index on `(tag_id, note_date)` for live rows whose `slot = 1`. It is what
  makes "two devices both started today's note" a detectable conflict instead of a duplicate. A **free** note
  (`kind = 'note'`, `slot = 0`) is written on its own: any number per tag per day, and it may have no tag. Both
  kinds show in a tag's stream (daily first, then free notes newest first) and in the Notes list.
  A multi-tag note has one `note_tags` row per tag, so any tag's stream shows the same page.
  Trashed notes set `live = 0` (freeing any slot); restoring a daily note needs its slots to still be free.
  Free notes are created by the same `PUT /api/notes/:id` with `kind: 'note'` (tags may be empty).
* **Titles** (`notes.title`, free notes only; null = untitled, at most 120 characters, one line). The title rides in the
  same `PUT` as the text and counts as part of the note's state: renaming bumps the revision, a stale rename is a
  `409 revision` like a stale edit, and on the phone it is held in the same pending record. A rename alone does not
  create a text version. Daily entries ignore a title (their date is their name). Leaving `title` out of a save keeps it.
* **`tags.daily`** (default 1) says whether a stream shows an entry for today. A tag created by a free note is made
  with `daily = 0`; one created by a daily note (or by hand) with `daily = 1`; a tag that does not exist yet reads as
  daily. It only changes what the stream shows; existing daily notes stay.
* **Streams match exact tags** (`WHERE tag_id = ?`). No prefix matching. Stream pages are whole days, so a
  day with several notes is never split. `GET /api/notes?tag=&sub=1&untagged=1&q=&limit=&offset=` lists notes
  (most recently changed first) and can include a tag's sub-tags (`path/%`, with `_` escaped) or search the text.
* **Document format**: `doc` is Tiptap/ProseMirror JSON; `doc_format` is its version (currently 2). `shared/doc.js`
  lists the allowed nodes/marks and has the `migrateDoc` hook for future formats; the server rejects documents
  outside the whitelist. Exports carry the format number too. Format 2 adds the `attachment` block and is a strict
  superset of format 1 (nothing is rewritten on upgrade). The server accepts both numbers on save; a document that
  says it is format 1 may not contain attachments, and an editor still on format 1 cannot save over a note that has
  them (`409 client_outdated`) because it would drop them without knowing.
* **Document contract** (`shared/doc.js`, no browser code): besides which nodes exist, it says which may sit inside
  which: a document is one or more blocks; a paragraph or heading holds text and line breaks; a bullet list holds list
  items and a task list holds tasks; a list item or task is a paragraph followed by any blocks (that is how lists nest
  and where a file can sit inside one); a file holds nothing. Marks (bold, italic) sit on text and on line breaks, once
  each. The editor's schema (`client/src/editor/extensions.js`) is the other statement of the same rules;
  `tests/client/doc-contract.test.js` generates documents, mutates them, runs editing commands on them and checks the
  two agree, so a rule is only ever changed in both places. `tests/fixtures/docs.js` has one document per supported
  structure; the server tests save, export, import, render and read each one back.
  *Older notes*: the nesting rules were added after notes already existed. A save that is wrong only in how it is
  nested is accepted when the note is already stored that way (so such a note is never stuck unsaveable), and an import
  never refuses a document for nesting; it keeps it exactly as it was and lists it in the report
  (`nestingProblems`). `node server/cli.js check-docs` lists every stored note or saved version that breaks the rules.
  It is read-only; nothing is rewritten without someone choosing to.
* **WAL + `synchronous=FULL`**: a committed save survives a power cut. Foreign keys on; a busy timeout set.

## Server layout

One Node process, no framework. Each file has one job and says what it depends on:

| File | Job |
|---|---|
| `app.js` | builds the store, the files and the auth, registers the route groups **in a fixed order** (routes match in the order registered), and dispatches each request: the cross-site and JSON checks, the assistant key, the login |
| `http.js` | the transport only: write JSON, a download or a stored file (ranges, ETag), read a body, serve the built client |
| `routes/*.js` | one file per feature, each a `register…Routes(context)`: `health`, `auth`, `settings`, `assistant`, `moods`, `tags`, `notes`, `files`, `portability`, `backups` |
| `store.js` | the note store: reading, **the one save operation** (revisions, conflict copies, snapshots, files claimed), membership, trash, versions. Every write to a note, including the assistant's, goes through `saveNote` |
| `assistant-notes.js` | what the assistant door does to notes (create, append, replace text or a section, attach, change a task, read as Markdown), built on the store's public API |
| `tags.js`, `settings.js` | tag operations (list, create, flags, move) and the settings in the `meta` table with their export/import rules: one place for what a setting is and how a value is checked |
| `errors.js`, `ids.js` | `HttpError` and the shape of an id, so no feature has to import them from the note store |
| `moods.js`, `files.js`, `portability.js`, `backup.js`, `bundle.js`, `zip.js`, `zip-stream.js`, `auth.js`, `db.js`, `doc-check.js` | one feature each |

Transactions are synchronous SQLite transactions (`tx` in `db.js`): a function that reads and then writes does so in
one step, and nothing awaits inside one. Moving a function between files must not change which statements share a
transaction; the tests in `tests/server` pin this behaviour.

## Moving tags

Folders are derived from tag paths, so "moving" a tag is renaming paths. `POST /api/tags/move { from, into, order }`
renames `from` and every tag under it to sit inside `into` (`""` = top level) in one transaction. Tag ids, notes,
favourites and the daily setting are kept (a Today tag inside the moved branch is renamed too). It is refused, changing
nothing, if it would move a tag into itself, overwrite an existing tag (409 `tag_exists`) or exceed the path depth/length
limits. `order` lists the child names of the destination, including the moved tag. The manual order is saved in
`meta.tag_order` as `{parentPath: [names]}`, returned by `GET /api/tags` as `order`, and travels in the JSON export as
`settings.tagOrder`. Folders not named in the order follow alphabetically; names that no longer exist are ignored.

On the Tags page (`client/src/views/Home.jsx`) parents start collapsed. The grip on each tag or folder starts a
pointer-event drag (mouse and touch): the middle of a row nests into it (row highlighted), the top or bottom edge
reorders (a line shows where), and the "Drop here to move to the top level" bar un-nests. Hovering a closed folder opens
it; Esc cancels. `planMove` in `client/src/tag-folders.js` turns a drop into `{ into, order }`.

## Tasks

Tasks are `taskItem` nodes inside note documents. They may carry these optional attributes (added without a format
bump: older documents simply do not have them, and empty ones are never stored):

* `due`, `start`: `YYYY-MM-DD`, picked by hand. `hidden`: `true` keeps the task out of the combined list.
* A date typed in the task text (`due fri`, see `shared/taskdates.js`) is read when tasks are listed and fills in
  where no date was picked. It is resolved against the note's own date so it never drifts. The text is never rewritten.
* `GET /api/tasks` returns every task in live notes with the effective `due`/`start` and where each came from
  (`dueFrom`/`startFrom`: `set`, `text` or null), and the `revision` of the note each row comes from. A row is made
  by `taskRecords` in `shared/tasks.js`, which the client also uses, so both always agree on what a row is. Which
  section a task belongs in (overdue, today, ...) is decided on the client from the device's "today".
* **One task list for every screen** (`client/src/task-data.js`). The Tasks page and the dashboard's Tasks box read
  the same list: the server's rows, corrected by this device's own copy of every note it holds changes to (unsent
  edits, an open editor, or saved since the list was fetched). That note's whole set of rows is replaced, so a task
  removed or retyped here is gone or changed straight away and a task typed into a note the server has not seen
  appears too. It is derived, never a second copy anyone edits. The server is asked again when a screen showing tasks
  appears, on focus, when the page becomes visible or comes back online, and (coalesced) after something that
  changes which notes or tags exist, which `api.js` announces as `hq-data-changed` (a note deleted, restored,
  re-tagged or reverted, a tag moved, an import). Never for a keystroke or a save. One request runs at a time; more
  asked for meanwhile become one more. A failed request keeps the list on screen and says why. A change is shown
  at once (`optimistic`) until its command has finished, then the note's own copy shows it. The screen keeps only
  how it is shown: what is open, the date range, the menus. `tests/client/task-data.test.js`.
* Ticking or dating a task from the Tasks page goes through the note's normal save session (`Session.editTask`):
  phone copy first, then the server against the note's revision, so a stale change gives the usual visible conflict.
  `sync.track()` keeps the status dot from showing saved while that is still on its way into the queue.
* **Task commands** (`client/src/task-commands.js`): a screen changes a task by naming the note and the task
  (`update`, `remove`, `text`); it need not know whether the note is loaded on the device, whether its editor is open,
  or how the change travels. With the editor open it is one undoable editor edit (`client/src/editor/task-ops.js`, a
  ProseMirror transaction); without one it is made on the JSON document (`shared/tasks.js`). **Both take their decisions
  from `patchedTaskAttrs`**: when a completion time is stamped, that a dismissed task cannot be completed, which empty
  attributes are not stored. `tests/client/task-parity.test.js` runs the same patches down both paths on generated
  documents and compares the results. A view never assigns fields on a session: an editor attaches with
  `session.attachEditor({ provider, updateTask, removeTask })`, which returns the function that lets go of it (and does
  nothing if a newer editor has attached since), and tag changes the server confirmed come in through
  `session.applyServerTags`.

## Today screen and settings

`#/` is the Today screen (`client/src/views/Today.jsx`): a list of sections (`WIDGETS`; each can be placed in any column from Settings, see `getDashboard` in `client/src/prefs.js`), each a component given the same
context (today's date in `HOME_TZ`, config, tags, the chosen daily tag). It reuses `TasksView` in `compact` mode and
the stream's `NoteCard` for today's entry, so ticking, saving and conflicts behave exactly as elsewhere. The one setting
so far, which tag's daily entry Today shows, lives in the `meta` table (`daily_tag`, default `daily-jots`), is returned by
`GET /api/config` and changed with `PUT /api/settings { dailyTag }`, and travels with JSON export/import.

## API (JSON; all state changes require `Content-Type: application/json`)

```
GET  /api/config  /api/tags  /api/tasks  /api/notes?...  /api/stream?tag=&before=&limit=  /api/trash  /api/health
POST /api/tags      PUT /api/tags/:id/favorite   PUT /api/tags/:id/daily   PUT /api/settings
GET/PUT/DELETE /api/notes/:id               PUT = create or save; DELETE = move to trash
POST /api/notes/:id/restore[?dropConflictingTags=1]
POST/DELETE /api/notes/:id/tags[/:tagId]
POST /api/tags/move   { from, into, order }   move a tag and everything under it (see Moving tags)
GET  /api/notes/:id/versions[/:vid]         POST .../versions/:vid/restore
GET  /api/export/json   /api/export/markdown        POST /api/import?mode=merge|replace
GET/POST /api/backups   GET /api/backups/snapshot   GET /api/backups/file/:name
POST /api/attachments?name=&noteId=   raw file bytes (header X-Gordonite-Upload: 1, not JSON)
GET  /api/attachments?q=&kind=&noteId=&unattached=1   GET/DELETE /api/attachments/:id
GET  /api/attachments/:id/file[?download=1]   GET /api/attachments/:id/original      GET /api/export/files
GET  /api/attachments?removed=1   POST /api/attachments/:id/restore   undo a removal (soft delete)
POST /api/moods/:id/restore       undo a mood delete (soft delete)
```

Cross-site writes are refused (`Sec-Fetch-Site`, and JSON-only bodies force a CORS preflight that is never
granted). The one non-JSON write, a file upload, sends raw bytes and is protected the same way by requiring a custom
header, which a cross-site page cannot send without a preflight. There is no authentication of its own; the VPN is
the boundary (an optional 4-digit PIN can be set; see LOGIN.md).

## Saving protocol

`PUT /api/notes/:id` with `{ baseRevision, doc, docFormat, tags, date, opId, afterOps, keepPrevious? }`:

1. Validate the document. If the note does not exist, **create** it (needs `tags` and `date`); if another live
   note already holds a tag+date slot, refuse (`409 slot`).
2. If the note is in the trash, refuse (`409 deleted`).
3. If the content is identical to what is stored, succeed without a new revision (this makes retries harmless).
4. If `baseRevision` equals the current revision, **or** the note's last write is one of `afterOps` (a request
   the client sent but never saw the answer to, so the client's lineage is current), accept: store the
   previous content as a version if due, bump the revision.
5. Otherwise refuse with `409 revision`. **Every refusal stores the sender's document as a `conflict` version
   of the note** (de-duplicated across retries), so the text is safe on the server even before the user decides.

Versions of the *previous* content are written when the last snapshot is older than `VERSION_INTERVAL_MINUTES`,
when `keepPrevious` is set (a deliberate "use my text" resolution), or when the text shrinks to less than half
(so clearing a note is always recoverable). Conflict and import versions are never pruned; auto, guard and
restore versions keep the newest `VERSION_KEEP` per note. Clearing a note saves an empty document; it never deletes the note.

## Client

```
editor ──touch()──▶ Session ──300 ms──▶ IndexedDB (pending) ──500 ms──▶ PUT ──▶ server
                       ▲                                           │
                       └──── status: saved | saving | pending | offline | failed | conflict
```

* `sync.js` holds one **Session** per note, outside the components, so saving continues when an editor unmounts.
  A session knows the revision its text is based on, the newest unconfirmed document, the unresolved
  request ids, and any conflict. A `SyncManager` is given its API, local store, timers, clock, id source and page
  lifecycle hooks (the page's own are the defaults), so the protocol is tested without a browser:
  `tests/client/sync-save.test.js`. A failed request is classified in one place (`client/src/failure.js`: network,
  login, retry, conflict, rejected); nothing queued on the device is ever discarded because of a failure.
* Mood entries have their own, simpler queue (`client/src/moods.js`): each entry carries its own id so a repeat is
  harmless, and it leaves the queue only when the server acknowledges it or the person discards it. Entries the server
  refuses for good are kept visible with Try again and Discard.
* A response changes bookkeeping and the badge only. The editor is *never* set from server data while it is
  open. (`adopt()` refuses to move the base revision of an open editor, which would hide a conflict.)
* **Network failure or timeout (15-20 s)** → status *offline*, retry with backoff (2, 4, 8, 15, 30 s) and
  immediately on `online` / page becoming visible. **HTTP error** → status *failed*, same retries, message shown.
  The phone copy is deleted only if its sequence number is not newer than the one the server confirmed.
* On startup, unsent records are loaded and sent. If the note changed elsewhere meanwhile this becomes a
  visible conflict, not an overwrite.
* **Conflict resolution** (all keep the other version in History): *Combine both* (server text, a marker line,
  then the phone's text), *Use my text* (resends with `keepPrevious`), *Use the other version*.
  Deleted-elsewhere offers *Restore note with my text*; a slot clash offers *Combine into that note*.
* **Midnight**: `today` follows the device clock in `HOME_TZ`. A note's date is fixed when it is created.
  If a keyboard is in a note when the date changes, only a "Start today's note" banner appears; otherwise the
  new day's entry just appears.
* **Performance**: one live editor at a time; other notes are rendered by `render.js`. The stream loads 14 notes
  per page ("Load older notes").
* **Where the view code is**: `views/NoteCard.jsx` is the one card a stream, the dashboard, an earlier day and a note's
  own page all draw a note with. `task-groups.js` holds the rules for dividing the task list (which section, in what
  order, how much the dashboard's box shows, which finished tasks fall in a date range) as pure functions, so they are
  tested without drawing anything (`tests/client/task-groups.test.js`); `views/Tasks.jsx` only draws them and keeps
  how the list is shown (what is open, the range, the menus). The task whose words are being edited stays in its section
  until editing ends, because a date typed into its words is understood as it is typed.
* **Lists that load more** keep their own paging (notes by offset, a stream by whole days) and share two rules
  (`client/src/paging.js`): one request for the next page at a time (the button is disabled while it runs) and rows
  are added by id, so a page that overlaps what is there changes nothing. The header's conflict indicator opens the
  conflicted note's own page, which works for a note with no tag too.

## Why these choices

* **Node built-in SQLite** instead of `better-sqlite3`: no native module to compile or ship per architecture,
  nothing in `node_modules` at runtime, and `VACUUM INTO` / WAL are plain SQLite. The module is marked
  release-candidate by Node 24, so the Docker image pins Node 24; all database access is in `server/db.js` and
  `server/store.js` if you ever want to swap the driver.
* **No server framework**: about 15 routes; `node:http` is enough and has nothing to patch.
* **Optimistic concurrency by revision** rather than last-write-wins: with one person on two devices the
  common failure is a stale phone, and silently overwriting is the one outcome this app must not have.
