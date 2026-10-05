# Architecture

## Data model (SQLite, schema version in `PRAGMA user_version`)

```
tags(id, path UNIQUE, created_at)
notes(id, note_date, doc, doc_format, revision, last_op_id, created_at, updated_at, deleted_at, last_snapshot_at, kind)
note_tags(note_id, tag_id, note_date, live, slot)  UNIQUE(tag_id, note_date) WHERE live = 1 AND slot = 1
note_versions(id, note_id, revision, doc, doc_format, kind, created_at)
meta(key, value)
```

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
* **Streams match exact tags** (`WHERE tag_id = ?`). No prefix matching. Stream pages are whole days, so a
  day with several notes is never split. `GET /api/notes?tag=&sub=1&untagged=1&q=&limit=&offset=` lists notes
  (most recently changed first) and can include a tag's sub-tags (`path/%`, with `_` escaped) or search the text.
* **Document format**: `doc` is Tiptap/ProseMirror JSON; `doc_format` is its version (currently 1). `shared/doc.js`
  lists the allowed nodes/marks and has the `migrateDoc` hook for future formats; the server rejects documents
  outside the whitelist. Exports carry the format number too.
* **WAL + `synchronous=FULL`**: a committed save survives a power cut. Foreign keys on; a busy timeout set.

## Tasks

Tasks are `taskItem` nodes inside note documents. They may carry these optional attributes (added without a format
bump: older documents simply do not have them, and empty ones are never stored):

* `due`, `start`: `YYYY-MM-DD`, picked by hand. `hidden`: `true` keeps the task out of the combined list.
* A date typed in the task text (`due fri`, see `shared/taskdates.js`) is read when tasks are listed and fills in
  where no date was picked. It is resolved against the note's own date so it never drifts. The text is never rewritten.
* `GET /api/tasks` returns every task in live notes with the effective `due`/`start` and where each came from
  (`dueFrom`/`startFrom`: `set`, `text` or null). Which section a task belongs in (overdue, today, ...) is decided on
  the client from the device's "today".
* Ticking or dating a task from the Tasks page goes through the note's normal save session (`Session.editTask`):
  phone copy first, then the server against the note's revision, so a stale change gives the usual visible conflict.
  `sync.track()` keeps the status dot from showing saved while that is still on its way into the queue.

## API (JSON; all state changes require `Content-Type: application/json`)

```
GET  /api/config  /api/tags  /api/tasks  /api/notes?...  /api/stream?tag=&before=&limit=  /api/trash  /api/health
POST /api/tags      PUT /api/tags/:id/favorite
GET/PUT/DELETE /api/notes/:id               PUT = create or save; DELETE = move to trash
POST /api/notes/:id/restore[?dropConflictingTags=1]
POST/DELETE /api/notes/:id/tags[/:tagId]
GET  /api/notes/:id/versions[/:vid]         POST .../versions/:vid/restore
GET  /api/export/json   /api/export/markdown        POST /api/import?mode=merge|replace
GET/POST /api/backups   GET /api/backups/snapshot   GET /api/backups/file/:name
```

Cross-site writes are refused (`Sec-Fetch-Site`, and JSON-only bodies force a CORS preflight that is never
granted). There is no authentication; the VPN is the boundary.

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
  request ids, and any conflict.
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

## Why these choices

* **Node built-in SQLite** instead of `better-sqlite3`: no native module to compile or ship per architecture,
  nothing in `node_modules` at runtime, and `VACUUM INTO` / WAL are plain SQLite. The module is marked
  release-candidate by Node 24, so the Docker image pins Node 24; all database access is in `server/db.js` and
  `server/store.js` if you ever want to swap the driver.
* **No server framework**: about 15 routes; `node:http` is enough and has nothing to patch.
* **Optimistic concurrency by revision** rather than last-write-wins: with one person on two devices the
  common failure is a stale phone, and silently overwriting is the one outcome this app must not have.
