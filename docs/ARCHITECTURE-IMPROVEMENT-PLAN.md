# Gordonite architecture improvement plan

Prepared: 2026-10-13. Current checkout: `fa8053f`, application 0.5.1.

## Goal

Make each feature easier to change without accidentally breaking another. Keep the current Preact, Tiptap, Node and SQLite stack, and improve ownership of data, shared rules and test coverage through small changes.

This is a proposal, not an implementation or deployment record. It builds on [the architecture audit](ARCHITECTURE-AUDIT-2026-10-12.md), which examined 0.4.4. The current source and release documentation were checked while preparing this plan; the full audit and tests were not repeated for 0.5.1.

## What has changed since the audit

- Attachments already exist, including images, PDFs, file cards, content-addressed storage and document format 2. Improve their recovery integration rather than rebuild their upload feature. See [ATTACHMENTS.md](ATTACHMENTS.md).
- Removed files can be restored, and mood deletion has a short Undo window. Preserve those behaviors.
- Release notes document repairs to the three older browser-test failures. Do not treat those failures as outstanding app bugs.
- The mood queue still drops entries after any HTTP API error. The separate Tasks snapshot and view-owned loading patterns also remain in the source.
- The earlier invalid-document reproduction needs to be rerun against format 2 before implementing its fix. The current validator still principally checks node names and attributes.

## Design rules to preserve

1. Notes remain the authoritative storage for task text and attributes. A task index may be derived, but must not become a second editable copy.
2. Saving continues when a screen or editor unmounts.
3. A server reply must not reset a live editor, its selection or undo history.
4. Pending edits survive reload where local storage is available; failures to store them must be visible.
5. Revision conflicts preserve both versions rather than silently overwrite newer work.
6. Existing IDs, note dates, history, trash and attachment references survive refactoring.
7. Schema and document changes have explicit compatibility and recovery rules.

## Suggested implementation order

| Stage | Change | Reason to do it at this point |
|---|---|---|
| 1 | Add focused save/queue tests and fix mood retries | Protect unconfirmed work and create a safety net |
| 2 | Align document validation with editor structure | Establish a reliable contract for notes and files |
| 3 | Introduce task commands and editor adapters | Give edits a consistent path |
| 4 | Unify task data and refresh behavior | Remove stale copies without changing editor behavior |
| 5 | Extract view controllers and common loading helpers | Make layout and data handling independently editable |
| 6 | Separate server feature modules | Reduce coupling while preserving transaction boundaries |
| 7 | Add complete attachment backup/restore bundles | Make recovery include the whole workspace |

Attachment recovery can be advanced earlier if it is the owner's priority. Each stage should be independently reviewable and usable; do not make completing the whole plan a prerequisite for a release.

## 1. Protect queued work and make saving testable

### Problem

Notes use `client/src/sync.js` and IndexedDB. Moods use `client/src/moods.js` and localStorage. Their failure behavior differs: the mood queue treats every `ApiError` as permanent, removes the entry and counts it as sent. A temporary server failure or expired session should not discard it.

The note save engine also depends directly on the API, storage, timers and browser lifecycle, which makes unusual timing failures harder to test quickly.

### How I would implement it

1. Add a shared error classifier with explicit outcomes: retry, pause for login, conflict, or rejected input. Handle network failures and temporary server errors as retryable; classify permanent failures by known error codes rather than assuming every client error is permanent.
2. Remove queued moods only after a successful acknowledgment. Keep rejected entries available with a useful error and a deliberate retry/discard action. Allow unrelated entries to proceed when an individual record is invalid.
3. Return a result such as `{ sent, pending, rejected, paused }` so the widget cannot report a rejected entry as saved.
4. Report localStorage/IndexedDB write failures clearly. A memory-only queue must not claim that its contents will survive closing the browser.
5. Allow note sessions to receive API, storage, clock and scheduling dependencies, with the existing implementations as defaults. Move browser focus/visibility listeners into a lifecycle adapter.
6. Share storage/error utilities where useful, while retaining separate protocols for note revisions and idempotent mood entries. Introduce a general queue only if several features actually need it.

**Relevant existing files:** `client/src/moods.js`, `client/src/sync.js`, `client/src/pending.js`, `client/src/api.js`, `client/src/views/Mood.jsx`.

**Checks:** 503 then success; login expiry then recovery; rejected input; failed local storage; reload with pending work; newer typing during an in-flight save; lost response; conflict resolution; detach during capture. Use deferred promises and a controllable clock for timing checks.

**Done when:** unconfirmed work is retained, failures are visible, sent counts mean acknowledged saves, and the note save protocol has fast tests that do not require a browser.

## 2. Make document validation, editing and rendering agree

### Problem

Recognizing a node type does not establish that it belongs in its current position. The earlier audit showed the server accepting a paragraph containing another paragraph, which the editor schema rejected. Attachments add another node whose placement and attributes must be understood consistently.

### How I would implement it

1. Reproduce invalid nesting against the current format-2 validator and save path.
2. Define a browser-independent document contract describing allowed children, required structure, marks and attributes for each node type. Include attachment blocks and both supported formats.
3. Make save/import validation enforce that contract. Preserve the existing protection that prevents an old editor from dropping attachments.
4. Create fixtures for each supported structure, including nested tasks, empty editable notes and files inside supported list structures.
5. Check each fixture against the server validator and the editor schema, then round-trip it through storage and export/import. Check static and Markdown representations for preservation of supported content and file references.
6. Examine existing records before tightening validation. Never silently rewrite incompatible stored notes; provide explicit repair or migration behavior where needed.

**Relevant existing files:** `shared/doc.js`, `shared/attachments.js`, `client/src/editor/extensions.js`, `client/src/editor/attachments.js`, `client/src/editor/render.js`, `server/store.js`, `server/portability.js`, `server/markdown.js`.

**Done when:** accepted documents are editable, invalid structures are refused with understandable errors, and old notes retain their content and attachment references.

## 3. Give task changes one command interface

### Problem

Task changes go through JSON helpers, live-editor transactions and screen-specific coordination. Components also assign Session fields directly. Changing a rule can require updating multiple paths.

### How I would implement it

1. Introduce a small command module with operations such as `completeTask`, `dismissTask`, `reactivateTask`, `updateTaskSchedule`, `editTaskText` and `removeTask`.
2. Have commands locate the note session and use its active editor adapter when present. Otherwise, apply the corresponding JSON transformation through the session save queue.
3. Share semantic decisions—completion timestamps, dismissal rules, schedule interpretation and nested-task preservation—while retaining ProseMirror transactions for editor changes.
4. Replace assignments such as `session.taskPatcher = ...` with an explicit attach/detach adapter API. Ensure a stale cleanup cannot disconnect a newer adapter.
5. Move tag and note actions behind similar explicit methods as needed, rather than letting views assign Session fields themselves.

**Relevant existing files:** `shared/tasks.js`, `client/src/sync.js`, `client/src/editor/NoteEditor.jsx`, `client/src/editor/task-history.js`, `client/src/views/Tasks.jsx`, `client/src/views/TaskTextEditor.jsx`, `client/src/views/TagEditor.jsx`.

**Checks:** the same command produces equivalent task state with and without an editor; editor actions remain one undo step; task IDs and nested children survive; stale edits still conflict.

**Done when:** views request a task action without having to know how the document is stored or whether its editor is open.

## 4. Give screens a consistent view of current data

### Problem

Tasks owns a fetched array and patches it independently, while Session owns pending note content. The dashboard and full Tasks page can display a different state from the edited note. Remote changes also need a refresh policy.

### How I would implement it

1. Introduce an observable task-data controller. Start with Tasks rather than replacing all application state at once.
2. Combine server tasks with tasks derived from locally changed note sessions. For a changed note, replace its complete task subset so deletions are reflected; do not merely append changed tasks.
3. Key tasks by note ID and task ID. Keep menus, expanded rows and filters in the view.
4. Emit targeted content/saved events from sessions. Refresh affected queries after successful commands, tag changes, restore/import operations, focus and reconnect.
5. Define refresh behavior explicitly: clean inactive sessions can adopt newer content; open editors or pending edits retain their revision base and conflict protection.
6. Deduplicate refresh requests and ignore late results from superseded queries. Avoid refetching every list for every keystroke or save-status update.

**Checks:** completing or dating a task updates every visible representation; creating/deleting a task in a dashboard note updates the dashboard list; remote edits appear after focus; pending local edits survive a refresh; deleted tasks are not resurrected by stale responses.

**Done when:** screens display consistent task state and no longer maintain independent editable task copies.

## 5. Separate view layout from controllers and loading

### How I would implement it

- Extract the reusable `NoteCard` from `Stream.jsx` into a notes component used by streams, the dashboard and standalone note pages.
- Move fetching, pagination and editor-selection coordination into controllers/hooks. Keep rendering components responsible for layout and interactions.
- Extract task grouping/sorting/range filtering into pure functions. Keep display policies such as dashboard scope separate from fetching and mutation.
- Add shared request primitives for loading, retry, cancellation, generation checks and deduplication. Preserve each feature's pagination semantics: notes use offsets; streams page by whole days.
- Guard Load more while requests run and deduplicate returned IDs. Cover repeated taps and changing filters before a response arrives.
- Consolidate dashboard widget metadata and component registration into one registry.

**Relevant existing files:** `client/src/views/Tasks.jsx`, `Stream.jsx`, `Today.jsx`, `EarlierNotes.jsx`, `Notes.jsx`, `People.jsx`, `client/src/prefs.js`.

**Done when:** a layout change does not require editing saving logic, and task/list rules can be checked without rendering the entire dashboard.

## 6. Give the server clearer feature boundaries

### How I would implement it

1. Move generic errors and ID validation out of `server/store.js` into small common modules.
2. Extract settings and tag operations, then assistant editing and note queries. Keep Store as a compatibility facade during the transition.
3. Preserve one authoritative note-save operation for revisions, conflict copies, snapshots and document persistence. Assistant edits continue calling it.
4. Group HTTP route registration by feature, leaving HTTP response handling in the transport layer. The existing Node HTTP server can remain.
5. Centralize settings serialization/validation so normal settings updates and import agree.
6. Preserve transaction boundaries when moving functions. Do not accidentally wrap synchronous SQLite transactions around asynchronous work or nest independent transactions.

**Relevant existing files:** `server/store.js`, `server/app.js`, `server/moods.js`, `server/files.js`, `server/portability.js`, `server/db.js`.

**Done when:** feature modules have clear dependencies and unrelated features no longer import generic helpers from the note store. Existing API behavior and persistence rules remain compatible.

## 7. Make attachment recovery complete

### Current situation

The implemented file storage has stable references and immutable, content-addressed bytes. However, database backups and JSON exports hold file records rather than file contents. Copying files separately or downloading All files is currently required. This is documented, but a single complete recovery operation would be easier to rely on.

### How I would implement it

1. Add a versioned workspace-backup manifest that identifies the database snapshot and every required file hash, size and relative location, including converted-photo originals.
2. Build the bundle from a consistent database snapshot and its referenced immutable files. Include records needed by history, trash and removed-file recovery; do not collect files only from currently visible notes.
3. Stream large bundles instead of constructing the whole archive in memory.
4. Validate the manifest, hashes and database compatibility before restore. Stage restoration and keep the existing state recoverable until the replacement succeeds.
5. Keep the current database-only backup available and label its scope clearly. Add complete bundles to automatic/off-server recovery procedures as appropriate.
6. Update [BACKUPS.md](BACKUPS.md), [ATTACHMENTS.md](ATTACHMENTS.md), import reports and CLI checks together.

**Checks:** recovery into an empty data directory; images/PDFs reopening; original HEIC downloads; old note versions; trashed notes; removed-file restoration; missing/corrupted binaries; interrupted backup/restore; custom `FILES_DIR`.

**Done when:** one verified recovery package restores notes and their files together, with clear diagnostics for an incomplete package.

## How to deliver the work safely

- Make each stage a small change with a clear before/after behavior. Separate a file move from a behavior change where practical.
- Establish regression checks before changing sensitive save/undo behavior. Test invariants and meaningful failure scenarios rather than merely mirroring functions.
- Run focused checks first, then the relevant server/client and browser suites. Check mobile editing on real hardware when editor interactions change.
- Update architecture, setup and recovery documentation as boundaries change. Never include personal note contents or credentials.
- Follow AGENTS.md: bump application versions for code changes, keep the stable Docker tag, and document releases. This proposal alone needs no version bump.
- Before a deployment, take a verified recovery copy appropriate to its scope. If a schema migration is involved, rollback may require both the earlier image and its compatible pre-migration data/files. For a behavior-only release, use the existing documented image rollback process.
- Keep access on the home network and WireGuard. This plan requires no network changes.

## Suggested first implementation batch

Start with mood error handling and its regression checks, add deterministic save-engine tests, and rerun the current document-validity probe. Fix document validation once the compatibility checks are in place. Then introduce task commands and shared task data. These steps address demonstrated problems and establish the boundaries needed for later view/server extraction.

The result should be fewer places to update for a feature, more dependable recovery behavior, and tests that explain which contract broke when something fails.

## Implementation status (2026-10-13, version 0.6.0)

All seven stages are built and tested; nothing here is deployed yet. The release notes ([0.6.0](RELEASE-NOTES.md))
have the detail and the test counts; this is the map from the plan to what changed.

| Stage | Result | Where |
|---|---|---|
| 1. Queued work and a testable save engine | A mood entry now leaves the queue only when the server acknowledges it or the person discards it (a 503 or an expired login used to delete it). Failures are classified in one place (`client/src/failure.js`): network, login, retry, conflict, rejected. Entries the server refuses for good stay visible with Try again / Discard. A write that fails is reported. Two tabs no longer overwrite each other's queue. `SyncManager` takes its API, store, timers, clock, ids and lifecycle, so the protocol is tested without a browser. | `client/src/moods.js`, `failure.js`, `sync.js`; `tests/client/moods.test.js`, `sync-save.test.js` |
| 2. Document contract | The validator now states which nodes may sit inside which, for both formats, and the editor's schema and the validator are checked against each other on generated, mutated and edited documents. **The rerun probe found a second, worse mismatch than the one in the audit**: bold or italic over a Shift+Enter line break put a mark on the break, which the server refused, so that note never saved. Fixed. Notes stored before the rules existed are never made unsaveable, an import never refuses for nesting, and `check-docs` lists any. The Markdown importer read `***x***` wrongly; fixed. | `shared/doc.js`, `server/doc-check.js`; `tests/client/doc-contract.test.js`, `tests/server/doc-contract.test.js`, `tests/fixtures/docs.js` |
| 3. Task commands and editor adapters | One function (`patchedTaskAttrs`) decides what a task change means; the JSON path and the editor's transaction both use it, and a parity test compares them. Screens ask by note id and task id; an editor attaches with `session.attachEditor`, whose release cannot disconnect a newer editor. | `shared/tasks.js`, `client/src/task-commands.js`, `editor/task-ops.js`; `tests/client/task-parity.test.js` |
| 4. One task list for every screen | The server's rows corrected, note by note, by this device's own copy of every note it holds changes to; asked again on focus, visibility, reconnect and after changes that alter which notes or tags exist; never for a keystroke or a save. The Tasks page and the dashboard's box can no longer disagree. | `client/src/task-data.js`; `tests/client/task-data.test.js`, `tests/e2e/task-list.test.js` |
| 5. Views | `NoteCard` has its own file; the rules for dividing the task list are pure functions; Load more takes one request at a time and adds rows by id (the audit's 40 rows for 35 notes); the conflict indicator opens a note with no tag. | `client/src/views/NoteCard.jsx`, `task-groups.js`, `paging.js`; `tests/e2e/lists-and-conflicts.test.js` |
| 6. Server boundaries | `app.js` registers one route file per feature in the same order; `errors.js`, `ids.js`, `http.js`, `settings.js`, `tags.js`, `assistant-notes.js` are their own files; the store keeps the one save operation. Settings changed in the app and arriving in an import follow the same rules. | `server/` ([ARCHITECTURE.md](ARCHITECTURE.md#server-layout)) |
| 7. Complete recovery | A bundle: one verified zip of the database and every stored file (including trash, old versions, converted originals and removed files). Download, `bundle`, `verify-bundle`, `restore-bundle`; restore verifies first, saves the current database, adds files without deleting anything. Streams, so memory stays flat. | `server/bundle.js`, `zip-stream.js`; `tests/server/bundle.test.js`, `zip-stream.test.js` |

Three things the plan did not predict, all found by the tests it asked for: the Shift+Enter mark above; that a task
list that follows typed dates live would move a row away from under the cursor while its words were being edited (the
edited task now stays in its section until editing ends); and that a note whose document the editor cannot hold opened
as a blank area, because the editor's own protective check tripped over itself while the editor was being built (it now
opens read-only with its message, and is never saved over).

Left for later, deliberately: automatic bundles on the app's own schedule (the command is the one to schedule, see
[BACKUPS.md](BACKUPS.md#bundles-the-notes-and-their-files-in-one-verified-file)); ZIP64 for workspaces over 4 GiB
(the command stops with a message and the folder-copy route is documented); splitting the note store's reading and
membership code further (it is 525 lines and has one clear job).
