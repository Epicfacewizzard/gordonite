# Release notes

## 0.6.0 — 2026-10-13 — Backups that include the files; nothing queued on the phone is thrown away; a fresher Tasks list (built and tested, not yet deployed)

Version **0.6.0** (a new feature: second number). It carries out [ARCHITECTURE-IMPROVEMENT-PLAN.md](ARCHITECTURE-IMPROVEMENT-PLAN.md)
(all seven stages): it fixes the places where work waiting on the phone, or a list on screen, could be wrong; tightens
and tests the rules a note's document must follow; and adds a backup that holds the photos and PDFs too. No schema
change, so going back to 0.5.1 is the image swap only. Not deployed yet.

**Fixed**

- **The Tasks list went stale.** It was fetched once when the page opened and patched by hand afterwards, so a task
  added or ticked on another device did not show until a reload, and the dashboard's Tasks box ignored what was typed
  into today's note beside it. There is now one task list for every screen (`client/src/task-data.js`): the server's
  rows corrected by this device's own copy of the notes it has changed. It is asked again when the page is focused,
  becomes visible or comes back online, and after a note is deleted, restored or re-tagged, a tag is moved, or an import
  runs. A task typed into a note shows in the box within a second, before it is saved. Found by the 0.4.3 audit.
- **Load more could add the same notes twice** when tapped again before the first answer came back (found by the
  0.4.3 audit: 40 rows for 35 notes). The Notes list, People and a tag's stream now make one request for the next
  page at a time, disable the button while it runs, and add rows by id.
- **The header's conflict indicator did nothing for a note with no tag** (it opened the note's first tag, and there was
  none). It now opens the conflicted note's own page.
- **A mood entry waiting on the phone was thrown away by any server error.** A temporary 503, or a login that had run
  out, deleted the entry and still counted it as sent. An entry now leaves the queue only when the server acknowledges
  it or you discard it. If the server refuses an entry for good (a time in the future because the phone's clock is
  wrong, say) it stays visible on the Mood box with **Try again** and **Discard**, and the entries after it are still
  sent. A login that ran out says so ("Log in to send this") and the entries wait. If the device cannot store the
  entry at all, the box says to keep the page open until it is sent, instead of claiming it is safe.
- **Two open tabs could overwrite each other's waiting mood entries**; the queue now reads the stored list before every
  change.
- **Bold or italic applied across a line break (Shift+Enter) made the note impossible to save.** The editor puts the
  mark on the line break as well as on the text, and the server's rules refused marks on anything but text; the dot
  went to "failed" and kept retrying. The text was never lost (it stayed on the phone) but it never reached the server.
  Marks are now accepted on line breaks. Found by the new generated tests, then reproduced in the browser.
- **A note whose document the editor cannot hold opened as a blank area** (a stored note with a paragraph inside a
  paragraph, say). The editor's protective check ("never autosave over content this editor cannot represent") ran
  while the editor was still being built and tripped over itself, so nothing was drawn and the message never showed.
  It now opens read-only, says "This note contains content this version of the editor cannot show. It has not been
  changed.", and is never saved over. Found while writing the test for the document rules.
- **`***both***` in Markdown** was read as `*both*` in bold. The exporter writes bold-and-italic that way, so a
  note read back through the assistant lost its formatting; it is now read as bold and italic.

**Added**

- **Bundles: the notes and their files in one verified file** (stage 7 of the plan). A database backup never held your
  photos and PDFs, which sit in the `files` folder, so a restore needed two separate copies kept in step. A bundle is
  one zip with the database snapshot, every stored file the database knows about (including files in the trash and in
  old versions, a converted photo's original, and files removed from the Files page), and a manifest with a size and
  SHA-256 for each. *Data & backups → Download everything (database + files)*, or on the server
  `node server/cli.js bundle` (keeps the newest 3 in `backups/bundles/`), `verify-bundle <file>` (checks it on its own
  and says what is wrong in plain words), `restore-bundle <file> --yes` (verifies first; saves the current database
  as a prerestore backup; adds missing files without deleting anything; then replaces the database). It is streamed, so
  memory stays flat however large it is; the ZIP limit (4 GiB) is stated and stops with a message. See
  [BACKUPS.md](BACKUPS.md#bundles-the-notes-and-their-files-in-one-verified-file). `tests/server/zip-stream.test.js` (7),
  `tests/server/bundle.test.js` (14: restore into an empty folder, a separate files folder, damage, cut-off, not a
  bundle, an incomplete bundle, a restore that cannot finish, download, command line, retention).
- **The nesting rules of a document are now part of the contract** (`shared/doc.js`): which nodes may sit inside which
  (see [ARCHITECTURE.md](ARCHITECTURE.md), "Document contract"). The server used to check only that each node was a
  known kind, so it accepted a paragraph inside a paragraph, which the editor cannot hold. It now refuses such a
  document with a plain message ("paragraph cannot go inside paragraph").
- **`node server/cli.js check-docs`** lists every stored note or saved version that breaks the rules. It is read-only.
- **Older notes are never made unsaveable.** A save that is wrong only in how it is nested is accepted when the note is
  already stored that way, and an import keeps such a document exactly as it was and lists it in its report
  (`nestingProblems`) instead of refusing the whole restore.

**Internal**

- **Server layout (stage 6 of the plan).** `server/app.js` was one 500-line function with every route inline, and
  `server/store.js` held the notes, the tags, the settings and the assistant's editing together, so unrelated features
  imported their error class and id check from the note store. Now: `errors.js` and `ids.js`; `http.js` for the
  transport; one file per route group in `server/routes/`, registered in the same order; `settings.js` (what a setting
  is, how a value is checked, and how it travels in an export and an import, so a setting changed in the app and one
  that arrives with an import follow the same rules; an import used to accept a few values the app itself would
  refuse); `tags.js`; and `assistant-notes.js`. The store is 525 lines instead of 869 and still has the one save
  operation. A mechanical move: the routes are copied verbatim and in the same order, and the existing server tests and
  the browser suite are the check (the layout is described in [ARCHITECTURE.md](ARCHITECTURE.md#server-layout)).
  `tests/server/settings.test.js` (7) pins the settings rules.
- **View structure (stage 5 of the plan).** `NoteCard` has its own file (`views/NoteCard.jsx`) instead of living in
  the stream's; the rules for dividing the task list are pure functions in `client/src/task-groups.js`
  (`tests/client/task-groups.test.js`, 11 tests); `client/src/paging.js` is the shared guard for lists that load more.
  Behaviour is unchanged except that the task whose words are being edited now stays in its section until editing ends.
- **The task list (stage 4 of the plan).** `GET /api/tasks` rows are built by `taskRecords` (`shared/tasks.js`), shared
  with the client, and now carry the note's `revision`. `Tasks.jsx` lost its own fetched array and hand-patching;
  it keeps only how the list is shown. `tests/client/task-data.test.js` (12 tests), `tests/e2e/task-list.test.js` (3).
- **Task commands (stage 3 of the plan).** A change to a task has one set of rules whether or not the note's editor is
  open: `patchedTaskAttrs` in `shared/tasks.js` decides when a completion time is stamped, that a dismissed task cannot
  be completed, and which empty attributes are not stored; both the JSON path and the editor's transaction use it
  (`client/src/editor/task-ops.js`). Screens ask by note id and task id (`client/src/task-commands.js`) instead of
  fetching and adopting notes themselves, an open editor attaches with `session.attachEditor(...)` (a late tear-down
  cannot disconnect its replacement), and tag changes go through `session.applyServerTags`. One small difference is
  removed: completing a dismissed task through an open editor used to answer "that task is no longer in its note"; it
  now says the task is there and changes nothing, as the other path always did.
  `tests/client/task-parity.test.js` (14 tests) compares the two paths on generated documents.
- The save engine (`client/src/sync.js`) takes its API, local store, timers, clock, id source and page-lifecycle hooks
  as inputs, with the page's own as the defaults, so its protocol is tested without a browser:
  `tests/client/sync-save.test.js` (15 tests: a 503 then success with back-off, a lost reply, an expired login, a
  refused document, a failed local write, reload with unsent text, newer typing during a request, detach during capture,
  and the three ways to resolve a conflict). Mood queue: `tests/client/moods.test.js` (15 tests).
- Request failures are classified in one place (`client/src/failure.js`): network, login, retry, conflict or rejected.
  Only input the server names as bad is "rejected"; an unknown 4xx is treated as temporary, so nothing is discarded
  because an old server or a proxy said something unexpected.
- **Document tests:** `tests/client/doc-contract.test.js` generates documents from the editor's own schema, mutates
  them, runs real editing commands on them (500, 1500, 1500 and 250 sequences) and checks that the validator and the
  editor agree both ways; `tests/server/doc-contract.test.js` saves, exports, imports, renders and reads back one
  document per supported structure (`tests/fixtures/docs.js`); `tests/e2e/doc-contract.test.js` is the Shift+Enter
  case in a browser.

**Tests**

- Unit suite (`npm test`): **267/267** (it was 140 at 0.5.1). New: the mood queue (15), the save protocol (15), the
  document contract against the editor (13 client, 16 server), task parity (14), the task list (12), task grouping
  (11), paging (3), settings (7), zip streams (7), bundles (14).
- Browser suite: new `task-list`, `lists-and-conflicts`, `doc-contract` and `legacy-nesting` files (the last
  one is the note above), and
  additions to `mood` and `resilience`. Two long-standing flaky tests were fixed at their cause: `streams` "home lists
  tags…" asserted on the stream's entry before it had loaded (it passed 20 of 20 afterwards), and `task-lifecycle`
  now taps again until the caret has really moved, because a synthetic tap issued as the page redraws is sometimes
  never delivered (the app is fine; it passed 20 of 20 afterwards). `editing` "boundary behaviours" is still flaky.

**Rollback**: there is no schema change, so going back to 0.5.1 only needs the image retag and recreate.

**Before you deploy**: nothing is required. If you want to know whether any note predates the nesting rules, run
`node server/cli.js check-docs` on the server afterwards (it changes nothing). Such notes keep working either way.

## Before 0.6.0 — inbox listing skips its README; three old failing browser tests repaired (no deployment of their own)

- **Bridge:** `list_inbox` no longer lists the inbox folder's own `README.md` (its instructions are not an item to
  process). Covered by `tests/server/mcp-files.test.js`. This is the local bridge (`mcp/server.js`), not the server, so
  there is no deployment; it takes effect the next time the assistant client starts the bridge.
- **Owner's setup (not in the repository):** `"inboxDir"` was added to the private bridge config
  (`%LOCALAPPDATA%\Gordonite\mcp.json`, used by both Claude Desktop and Codex), pointing at
  `Obsidian Vault\00 Inbox`; checked by starting the bridge as the client does and calling `ping`, `list_inbox` and
  `list_files`.

The three browser tests that had been failing since 0.4.x were looked into and were not app bugs:

- `history-move.test.js` "desktop grip drag corrects the recorded day" hard-coded the dates 2026-10-04/05; the task
  history shows only the last 7 days by default, so once the real date passed 2026-10-11 the grip was no longer on
  screen. The test now pins the clock to the day its data is from, as the first test in the file does.
- `task-text-edit.test.js` looked for a task with no date on the dashboard. Since 0.3.1 the dashboard's Tasks box shows
  only overdue and due-today tasks (adjustable in Settings), so it was never there. The test now uses the Tasks page.
- `task-lifecycle.test.js` "task dismissal and deletion in the editor are undoable and survive a connection
  interruption" failed about half the time. Logging the selection and editor events showed that a synthetic tap
  issued in the instant a save finishes was sometimes never delivered by the browser, so the caret stayed in the
  newly typed task and the test then deleted that task instead of the first. The app did what it was told, and the
  offline save, undo, redo and reconnect all behaved correctly. The test now pauses 300 ms and checks the caret
  moved; it passed 10 of 10 runs.

Two other browser tests flake at roughly 1 run in 6 and 1 in 10 (`streams.test.js` "home lists tags…" and
`editing.test.js` "boundary behaviours"); the rate is the same on 0.4.4, so they are older than 0.5, and they have
not been investigated.

## 0.5.1 — 2026-10-12 — Undo for a removed file and a deleted mood entry (deployed to CasaOS)

Version **0.5.1** (a small change: third number). Two deletes had no way back in the app; now they do.

- **A file removed on the Files page** can be **undone**: an Undo link right after, or tick *Show removed files* and
  press *Bring back* at any later time (removed files are only hidden, never erased). Bringing one back shows it
  again in every note that had it. `GET /api/attachments?removed=1` and `POST /api/attachments/:id/restore`.
- **A deleted mood entry** shows **Undo** on the Mood box for 15 seconds. `POST /api/moods/:id/restore`.
- **New guide, [UNDO.md](UNDO.md):** every way to get something back and how far each goes. The editor's undo
  reaches **100 to 120 steps** (it is set to 100 and its engine trims in batches of about 20); typing without a
  pause of half a second is one step. This is pinned by `tests/e2e/undo-depth.test.js`.
- **Tests:** server `attachments.test.js` (2 new), `moods.test.js` (1 new); browser `attachments.test.js` (the Files
  page now covers Undo and Bring back), `mood.test.js` (Undo), `undo-depth.test.js` (new).
- **No schema change** (it uses the existing `deleted_at` columns); nothing about backups or rollback changes.
- **Deployed** on 2026-10-12 to `http://192.168.1.50:8082` with `scripts/deploy-casaos.ps1` (release `37bf398`,
  140/140 unit tests), run by the owner from the home network (the first attempt was closed by the server while it
  waited at the password prompt and changed nothing; the second went through); `/api/health` then reported `0.5.1`,
  and the mood API and logo checks returned 200. Afterwards, on the live server: a removed test photo was brought
  back through `POST /api/attachments/:id/restore`, served again, and removed once more; the mood restore route
  answered. Verified pre-update backup: `hq-manual-20261013-054257.sqlite` (schema v6, 230 notes, 43 tags, 89
  versions). Rollback image: `gordonite:rollback-before-37bf398`; because there is no schema change, going back to
  0.5.0 only needs the image retag and recreate, not a database restore. Pushed to GitHub `main` after deployment.
- **Browser test result at release:** 128 of 131 pass; the three failures are the known ones listed under 0.5.0.

## 0.5.0 — 2026-10-12 — Photos, PDFs and other files in notes (deployed to CasaOS)

Version **0.5.0** (a new feature: second number). Notes can hold **images, PDFs and other documents**. Tap the
**paperclip** in the toolbar (on a phone this includes the camera), or paste a screenshot / drop files on a note. An
image is drawn in the note (tap to open full size); a PDF or document is a card that opens or downloads. The new
**Files** page (Settings → Files) lists everything stored, with search, a kind filter, "not in a note yet", open,
download and remove, and files can be added there without a note (the in-app inbox). **iPhone HEIC photos are
converted to JPEG** on upload, with the original kept. The assistant can list, read and add files, and the MCP bridge
can take new PDFs and photos from a configured inbox folder. Full guide: [ATTACHMENTS.md](ATTACHMENTS.md).

- **Storage:** schema **v6** (`attachments` table). Bytes live in `DATA_DIR/files/<sha256>` (new `FILES_DIR`,
  `MAX_UPLOAD_MB`, default 100); the same bytes are stored once, a stored file is never rewritten. A file's kind is
  decided from its bytes. SVG is not treated as an image; anything that is not an image or PDF is only ever served as
  a sandboxed download.
- **Document format 2** (adds the `attachment` block; a strict superset of format 1). Stored notes are not rewritten.
  The server accepts format 1 and 2; an editor still on the old format cannot save over a note that has files (it
  gets a "reload the app" error), so an already-open tab can never silently drop a file.
- **The database backup does not contain the files.** Back up the `files` folder with the database, or use Data →
  All files (zip). `node server/cli.js check-files [--hashes]` verifies every stored file. The JSON export lists the
  files; the Markdown export includes the ones its notes use. Importing a JSON backup adds file records only for
  files already present in the `files` folder and reports the rest as `attachmentsMissingFiles`.
- **New runtime dependency:** `heic-convert` (and its four small dependencies, about 10 MB) for HEIC. The Docker image
  now runs `npm ci --omit=dev` in the final stage (the browser libraries moved to `devDependencies`); the build needs
  network once. Conversion runs in a worker thread, about 1.5 s for a 1.4 MB photo.
- **Assistant:** `/api/assistant/attachments` (list, describe, read as base64, store) and `.../notes/:id/attach`;
  files appear in Markdown as `![name](gordonite-file:ID)` / `[name](gordonite-file:ID)`. MCP tools `list_files`,
  `get_file`, `attach_file`, and, with `"inboxDir"` in the private config, `list_inbox` and `upload_file` (which can
  read only inside that folder). The bridge now has 18 tools.
- **Where:** `server/files.js`, `server/heic-worker.js`, `server/app.js`, `server/store.js`, `server/db.js`,
  `server/portability.js`, `server/markdown.js`, `shared/attachments.js`, `shared/doc.js`, `mcp/server.js`,
  `client/src/editor/attachments.js`, `client/src/editor/render.js`, `client/src/views/Files.jsx` and others.
- **Tests:** `tests/server/attachments.test.js` (22: sniffing, serving, ranges, sandboxing, dedupe, limits, HEIC with a
  stand-in converter, format rules, stale editors, assistant, export/import, integrity),
  `tests/server/mcp-files.test.js` (the inbox, including every attempt to read outside it) and
  `tests/e2e/attachments.test.js` (6: paperclip, undo, ×, paste, drop, failed upload, Files page, tap behaviour).
  Existing tests that hard-coded `docFormat 1` now use the constant. Unit tests 137/137.
- **Verified by hand:** a real 1.4 MB HEIC photo converted to JPEG through the worker thread in a production-only
  install layout (the Docker image's), original kept, integrity check clean.
- **Known, not caused by this change** (they also fail on unmodified 0.4.4): `history-move.test.js` "desktop grip
  drag corrects the recorded day", `task-text-edit.test.js` "text edits stay in the original task…", and a flake in
  `streams.test.js` "home lists tags; opening a tag shows today as an editable entry…" (about 1 run in 6) and
  `editing.test.js` "boundary behaviours" (about 1 in 10).
- **Limits:** PDF text is not extracted or searched (found by name); no thumbnails or resizing; uploads need the
  server (not queued offline); removed files are hidden, never purged; JPEG metadata (location) is kept as sent.
- **Rollback:** schema v6 is applied on first start. The previous app refuses a newer schema, so a rollback needs the
  verified pre-update backup the deploy script takes, as for 0.4.0 and earlier. Files already stored stay on disk.
- **Deployed** on 2026-10-12 to `http://192.168.1.50:8082` with `scripts/deploy-casaos.ps1` (release `bf48e8b`,
  137/137 unit tests), run by the owner from the home network; `/api/health` then reported `0.5.0` and the
  configuration reported document format 2, and the mood API and logo checks returned 200. The real image built
  on the server (including `npm ci --omit=dev` for the HEIC converter). Afterwards a real 1.0 MB HEIC photo was
  uploaded to the live API: it came back as a JPEG, its original was retrievable, and the test file was removed
  again. Verified pre-update backup: `hq-manual-20261013-045146.sqlite` (schema v5, 222 notes, 42 tags, 79
  versions). Rollback image: `gordonite:rollback-before-bf48e8b` (retag as `gordonite:0.1.0`, recreate the service,
  and restore that backup, because an older app refuses a v6 database). Pushed to GitHub `main` after deployment.

## 0.4.4 — 2026-10-12 — Task history only on a note's own page (deployed to CasaOS)

Version **0.4.4** (a small fix: third number). **Task history** no longer shows under notes on the dashboard (today's note and the earlier days beneath it) or in tag streams; it appears only on a note's own page (`#/n/<id>`), where it always was meant to live. Nothing is removed: tasks, history dates and Bring back are unchanged, and every note's history is still one tap away by opening the note.

- **Where:** `client/src/views/Stream.jsx` (`NoteCard` renders `TaskArchive` only when `standalone`). No server change beyond the version number.
- **Tests:** `tests/e2e/tasks.test.js` and `tests/e2e/done-range.test.js` now open task history from the note's own page, and `tasks.test.js` asserts it is absent in a stream.
- **Deployed** on 2026-10-12 to `http://192.168.1.50:8082` with `scripts/deploy-casaos.ps1` (release `5fa921b`, 114/114 unit tests passing), run by the owner from the home network; `/api/health` then reported `0.4.4`, and the mood API and logo checks returned 200. Verified pre-update backup: `hq-manual-20261013-021614.sqlite` (schema v5, 222 notes, 42 tags, 79 versions). Rollback image: `gordonite:rollback-before-5fa921b` (retag as `gordonite:0.1.0`, then recreate the service). No schema change. Pushed to GitHub `main` before the deployment.
- **Known, not caused by this change:** `history-move.test.js` "desktop grip drag corrects the recorded day" and `task-text-edit.test.js` "text edits stay in the original task…" fail on unmodified 0.4.3 as well.

## 0.4.3 — 2026-10-12 — The last few days under today's note, editable in place; tag choices beside the heading (deployed to CasaOS)

Version **0.4.3** (a small change: third number). On the **dashboard**, under today's note, the last **two** days' entries of the same tag now show, **greyed out**, each headed by its date (no "Earlier" label). **Tap one and it opens for editing right there**, with the cursor where you tapped, and anything you type is saved to that day, not into a new note. Only one note is open for editing at a time (today's, or the one you tapped); the others stay greyed and light. Tapping today's note makes it the open one again. **Show older notes** adds three more each time and fetches older pages when it runs out. Days with nothing written are skipped, only the tag's **daily** entries are listed (not free-standing notes), and a long entry is cut off with a fade until it is opened. The tag choices (the current tag and starred tags) moved from under the note to **beside the "Today’s note" heading**.

- **Where:** `client/src/views/EarlierNotes.jsx` (new), `client/src/views/Today.jsx` and `client/src/styles.css`. It reuses the stream's note card, so saving, conflicts, history and the ⋯ menu behave exactly as in a stream. No server change.
- **Tests:** `tests/e2e/earlier-notes.test.js` (9 tests: order and skipping, no label, edit in place and where it saves, going back to today's note, ticking a task, paging across stream pages, tag choices beside the heading, follows the chosen tag and daily-only, long entries, nothing repeated). Server/unit suite 114/114.
- **Test fix:** `tests/e2e/resilience.test.js` seeded notes for a hard-coded "today" of 2026-10-05, so eight of its tests stopped working once the real date moved on. It now uses the real current date.
- **Known, not caused by this change** (they fail identically on unmodified 0.4.2): `history-move.test.js` "desktop grip drag corrects the recorded day", `task-text-edit.test.js` "text edits stay in the original task…", and `task-lifecycle.test.js` "task dismissal and deletion in the editor…" (the last passed in one earlier run, so it may depend on time or order). Not investigated here.
- **Deployed** on 2026-10-12 to `http://192.168.1.50:8082` with `scripts/deploy-casaos.ps1`, run by the owner from the home network; the server's `/api/health` then reported `0.4.3`. The app code is the same in `856def5` and the handover-only commit after it. Pushed to GitHub `main` after deployment.

## 0.4.2 — 2026-10-09 — Starred tags beside the New note button; more room for today's note (version raised; not yet deployed)

Version **0.4.2** (a small change: third number). The starred tags used to start in their own left column, which left a wide, mostly empty strip beside the date. They now start in the **right column, on the same row as the New note button** (they wrap onto the next line if there is no room), the left column is empty so it takes no space, and today's note starts straight under the date with the most room. Nothing is fixed: in **Settings → Dashboard** each widget can still be moved to any column or the top band, hidden or reordered, and **Reset** puts back this new starting layout. A device that already saved its own layout keeps it, so press Reset (or set the starred tags' column to "Right column") to see the change. No server or database change. Checks: `tests/e2e/today.test.js` updated and extended (starred tags beside the button, no column kept for them, the date above the note).

## 0.4.1 — 2026-10-08 — Date range on the Tasks page's Done and Dismissed lists (deployed to CasaOS)

**Deployed** from commit `1c61337` (pushed to GitHub `main` first) to `http://192.168.1.50:8082` with `scripts/deploy-casaos.ps1`, over the home network. The server's `/api/health` reports version 0.4.1 and the home page loads. The script ran the unit tests (114/114) and took a verified backup of the live data before changing anything (listed under Data & backups); the previous image is tagged `gordonite:rollback-before-1c61337`. No database change, so rolling back means retagging that image as `gordonite:0.1.0` and recreating the service. Settings kept in each browser (including the new done/dismissed length) are per device.

Version **0.4.1** (a small change: third number). The date range that each note's task history already had is now also on the **Tasks page**: the Done and Dismissed sections list only what was finished or dismissed in the range (the last 7 days to start with, using the same calendar control), say "N outside this range" and have a **Show all** link. One range covers both lists. The starting length is a setting, **Settings → Dashboard → "Done and dismissed tasks show"** (last 7, 14, 30 or 90 days, or everything; `hq-done-days`, per device), and each note's own task history now starts with the same length instead of a fixed week. Nothing is deleted: older done and dismissed tasks stay in their notes and can be listed any time. A task with no recorded date (from before dates were kept) is always listed. No server or database change. Checks: new `tests/e2e/done-range.test.js` (3); unit tests 114/114; the task history, tasks, dismissal and settings browser suites pass, apart from the connection-interruption test in `task-lifecycle.test.js` that already fails on this machine without these changes.

## 0.4.0 — 2026-10-08 — Optional login password (deployed to CasaOS)

**Deployed** from commit `cd09a9b` (pushed to GitHub `main` first) to `http://192.168.1.50:8082` with `scripts/deploy-casaos.ps1`, over the home network. The server's `/api/health` reports version 0.4.0, the home page loads, and `/api/auth` says `{"enabled":false}`: the password is off, so the app opens as before until one is set in Settings → Password. The script ran the unit tests (114/114) and took a verified backup of the live data before changing anything (listed under Data & backups); the previous image is tagged `gordonite:rollback-before-cd09a9b`. No database migration, so rolling back means retagging that image as `gordonite:0.1.0` and recreating the service; if a password had been set, the older version simply ignores it. This was the first deploy with the updated backup step in `deploy/casaos-update.sh` (it only uses the in-container backup when the web route is refused, i.e. when a password is on). It also carries 0.3.2 (Shift-click dismiss).

Version **0.4.0** (a new capability: second number). A small, **optional** password for the web app, off by default, so nothing changes until you turn it on in **Settings → Password**. Once on, every browser has to log in once (it then stays logged in for 30 days) and sees only a login page until it does. Details, limits and recovery are in `docs/LOGIN.md`. In short: the password is kept only as a salted hash in the database (never exported, never in a backup you would read, and an import cannot remove it); a signed cookie marks a logged-in browser and is invalidated by changing the password; five wrong tries lock the login for a minute; the assistant door keeps its own key and the health check stays open. If you forget it: `sudo docker exec gordonite node server/cli.js password-off`. Anything typed on a device that is not logged in stays on that device and is sent after logging in. `deploy/casaos-update.sh` now takes its pre-update backup from inside the container if the web route refuses it (password on). The helper scripts `scripts/import-vault.js` and `scripts/detask-notes.js` talk to the web API and need the password off while they run. Checks: new `tests/server/auth.test.js` (14) and `tests/e2e/login.test.js` (3); the 0.3.2 notes follow.

## 0.3.2 — 2026-10-07 — Shift-click a task's checkbox to dismiss it (deployed with 0.4.0)

Version **0.3.2** (a small addition: third number). Holding **Shift** while clicking a task's checkbox now **dismisses** the task instead of ticking it. It works on the Tasks page, in the dashboard's Tasks box, in a note being edited, and in the read-only view of a note in a stream. Dismissing is the same reversible change the task details sheet makes ("Dismiss task"): the task leaves the open list, stays in its note's history, and can be brought back from there or from the Dismissed section of the Tasks page; in an open note it is one undo step. A plain click still ticks. Switch it off per device in Settings → Dashboard → "Tasks on this device" (`hq-shift-dismiss`). It needs a keyboard, so on a phone dismissing is still done from the task's details. Hovering a checkbox on the Tasks page says "Shift-click to dismiss". No server or database change. Checks: new `tests/e2e/shift-dismiss.test.js`.

## 0.3.1 — 2026-10-07 — Dashboard Tasks box: overdue and due today by default, adjustable (deployed to CasaOS)

**Deployed** from commit `abca4aa` (pushed to GitHub `main` first) to `http://192.168.1.50:8082` with `scripts/deploy-casaos.ps1`, over the home network. The server's `/api/health` reports version 0.3.1 and the home page loads. The script ran the unit tests (100/100) and took a verified backup of the live data before changing anything (listed under Data & backups); the previous image is tagged `gordonite:rollback-before-abca4aa`. No database change, so rolling back means retagging that image as `gordonite:0.1.0` and recreating the service. Tasks box, dashboard layout, mood and tag-choice settings are kept per device in each browser.

Version **0.3.1** (a small change: third number). The dashboard's Tasks box showed only overdue tasks, fixed in the code. It now shows **overdue and due today** by default, and Settings → Dashboard → "Tasks box on this device" lets you choose: overdue only; overdue and due today; overdue, today and the coming week (seven days); or everything open (adds a few with no date). Saved per device (`hq-dashboard-tasks`; list in `DASHBOARD_TASKS` in `client/src/prefs.js`). The count line adapts ("1 overdue · 2 today · 9 open") and an empty box says what it is empty of. The full Tasks page is unchanged. Also: in the Today's note tag choices, a starred tag whose daily entry is switched off is now left out instead of shown greyed (the current tag always shows). No server or database change. Checks: unit tests 100/100; browser tests for the dashboard (default, all four choices, remembered, empty message), tasks, task rows, settings and the clock/calendar view, 29/29.

## 0.3.0 — 2026-10-07 — Dashboard widgets can sit in any column; Mood widget slimmed down (deployed to CasaOS)

**Deployed** from commit `efce7be` (pushed to GitHub `main` first) to `http://192.168.1.50:8082` with `scripts/deploy-casaos.ps1`, over the home network. The server's `/api/health` reports version 0.3.0 and the home page loads. The script runs the unit tests (100/100 before sending), takes a verified backup of the live data before changing anything (it is listed under Data & backups), and tags the previous image `gordonite:rollback-before-efce7be`; the release is unpacked in `/home/gordon/gordonite/releases/efce7be`. No database change in this release, so rolling back means retagging that image as `gordonite:0.1.0` and recreating the service. Dashboard layout, mood and tag-choice settings are kept per device in each browser, so a phone starts on the new default layout until its own choices are made.

Version **0.3.0** (`APP_VERSION` in `server/app.js`, `package.json`, `package-lock.json`). A minor release: new dashboard features, nothing removed, no database or server change. Numbering rule: first number for a major change, second for a new feature or noticeable change, third for a small fix.

**Movable widgets.** Every dashboard widget can now be put in any column, not just moved up or down. Settings → Dashboard lists the widgets grouped by column; each has a **Column** menu (Across the top, Left, Middle, Right) and ↑ ↓ to reorder within its column; a moved widget lands at the bottom of its new column. A column with nothing to show takes no room (this includes Starred tags when nothing is starred), and column widths follow what is in them (`WIDTH` in `views/Today.jsx`). **Reset dashboard layout** puts everything back. New starting layout on a wide screen: Today's note in the middle; on the right a small New note button, then Mood, then overdue Tasks; Starred tags on the left only when something is starred. Mood is no longer a band across the top by default. On a phone the columns stack top to bottom (left, middle, right). Saved per device (`hq-dashboard` now also stores each widget's column); a device that saved a layout earlier keeps its hidden widgets and order, and its widgets start in the new default columns until moved. The New note button is smaller and no longer fills its column. Checks: `tests/e2e/today.test.js` updated for the new defaults plus a test that moves widgets between columns, uses the top band and resets; unit tests 100/100.

**Today's note source, on the dashboard.** The line under Today's note (it used to read "Comes from … change in Settings") is now just a row of one-tap tag choices, with no label or hint text: the current tag, every **starred** tag, and any tag used since the page was opened (so there is always a way back). Tapping one saves it as the dashboard's tag, the same server-wide setting Settings changes, so it applies on every device. A starred tag whose daily entry is switched off is shown greyed and cannot be picked. With nothing starred only the current tag shows; any tag can still be chosen in Settings → Dashboard. Checks: two new browser tests in `tests/e2e/today.test.js`; unit tests 100/100.

**Mood widget.** Faces first, Note and Log on demand, history hidden (details below).

**Mood widget.** The dashboard's Mood widget now shows only the five faces. Tapping a face selects it and reveals a "Note" box and a **Log** button; nothing is saved until Log (so a face is no longer logged by a single tap). The 7-day table, the streak line and today's entries (with delete) are off by default and can be turned on in Settings → Dashboard ("Show mood history"). A second switch there, "Ask for a note before logging" (on by default), brings back one-tap logging when turned off. Both are per device (`hq-mood-prefs`). Entries are still saved, exported and backed up exactly as before. While the list is hidden there is no on-screen way to delete an entry. No server change, no schema change. The version was left at 0.2.0 on request. Checks: `tests/e2e/mood.test.js` rewritten for the new flow, 4/4 (faces only at first, Note and Log on demand, history works when switched on in Settings, offline log kept and sent later, note step switched off); unit tests and the dashboard browser tests unchanged.

## 0.2.0 — 2026-10-07 (version raised; went out with 0.3.0)

The application version is now **0.2.0** (`APP_VERSION` in `server/app.js`, `package.json`, `package-lock.json`), shown in Settings and returned by `/api/health`. It marks the assistant edit tools above and makes it possible to tell from the server whether an update landed. Rule from now on: raise the version with every change to the code (not for note-only work); see `AGENTS.md`. The Docker image keeps its `gordonite:0.1.0` tag name: that is only the name the Compose file and `deploy/casaos-update.sh` use for "the running image", not the app version, and renaming it would mean changing the live Compose file. Take the usual pre-update backup; there is no database change. After the server update, `/api/health` should say `0.2.0`.

## 2026-10-07: the assistant can edit existing text (deployed from commit `f0aa762`)

Two new assistant tools, `replace_text` and `replace_section` (API: `POST /api/assistant/notes/:id/replace-text` and `/replace-section`), so a mistake in a note can be fixed in place instead of leaving a correction at the bottom. `replace_text` changes exact text inside one paragraph, heading or list item (it must match once, or `all:true`), keeps bold/italic, and leaves task ids, dates and ticks alone. `replace_section` rewrites the body under a heading up to the next heading of the same or higher level; `includeHeading:true` also replaces the heading, and with empty Markdown removes the whole section. Both require the revision the assistant last read (`expectedRevision`) and refuse a stale one, and both save the previous text as a version first (⋯ → History). The MCP bridge now passes the server's reason for a rejected edit (changed note, ambiguous or missing text) back to the assistant. Still not available to the assistant: permanent delete or purge. Trash is unchanged: it needs explicit confirmation, and trashed notes are purged after `TRASH_RETENTION_DAYS` (30 by default). Checks: unit tests 100/100 (new cases in `tests/server/notes.test.js` and `tests/server/mcp.test.js`). Deployed to CasaOS; a rejected test edit confirmed the new server code was live. Each computer's MCP client must be restarted to see the two new tools. That commit did not raise the version number, so `/api/health` still said 0.1.0 afterwards; see 0.2.0 below.

## Unreleased — Tags page: collapsed parents and drag to move

The Tags page now opens with every parent collapsed. Dragging a tag by its grip puts it inside another tag (the target is highlighted), takes it back out (top-level bar or between tags at another level), or reorders it among siblings (a line shows the position). Moving renames the tag path of the tag and its children; notes, ids and favourites are unchanged. Manual order is stored in settings (`tag_order`) and exported/imported with settings. No schema migration. Validation: server and browser tests (`tests/server/tag-move.test.js`, `tests/e2e/tag-move.test.js`). Known limit: dragging uses a grip and needs a pointer or finger (no keyboard-only move yet). Not yet deployed.

## 0.1.0 — 2026-10-06

Settings now displays “Gordonite · Version 0.1.0” at the bottom, using the version returned by the server configuration API. This is the application release version, not an individual Git commit number. Keep it aligned with `APP_VERSION` in the server when numbering future releases. A missing version displays “unavailable”.

Validation: production client build passed. Existing server configuration already provides the version; no database or settings migration is required.

Deployed code commit `e4e47a7` to CasaOS with the existing Compose configuration and persistent data directory. Browser checks confirmed the label on both the local preview and server Settings page. Pre-update verified backup: `/DATA/AppData/gordonite/data/backups/hq-manual-20261006-165950.sqlite` (111 notes, 26 tags, two versions). Release directory/image: `/home/gordon/gordonite/releases/e4e47a7`, `gordonite:e4e47a7`; rollback image: `gordonite:rollback-before-e4e47a7`. Recreate the existing service after retagging the rollback image as `gordonite:0.1.0` if needed.

## Unreleased — 2026-10-07 (not yet deployed to CasaOS)

- **Logo and icons.** The Gordonite logo (`assets/branding/gordonite-logo-v1.png`) is now the browser tab icon and the phone home-screen icon. Resized copies and a small `manifest.json` live in `client/public/`. The running server shows them only after the next deployment. The CasaOS dashboard tile icon is set separately in CasaOS (an icon URL such as `http://192.168.1.50:8082/icon-512.png` once deployed).
- **Vault import reads the whole vault.** `scripts/import-vault.js` now imports every top-level vault folder except hidden ones and `99 System`, and strips characters tags cannot hold (for example parentheses) from folder names. Run against the live vault (`C:\Users\Epicf\Vault`, not the old OneDrive copy): 98 notes created, 11 existing notes kept with both versions, 13 tags created; a second dry run found all 207 notes unchanged. The server saved `hq-preimport-20261007-012405.sqlite` first.
- **Project and archive tasks turned into bullets.** New `scripts/detask-notes.js` converts tasks to plain bullet points through the normal revision-checked save route (dry run by default, `--apply` to save, backup taken first). Applied to notes under `50-projects` and `90-archive`: 85 tasks in 7 notes. Ticked tasks keep a leading "✓". Each note's earlier text is in its History; backup `hq-manual-20261007-015333.sqlite`. A future vault re-import will show those notes as changed.
- **Assistant bridge** registered for Claude Code in this project; `ping` verified over the VPN.
- **Today is now the Dashboard.** The first tab, the screen title and the "opening page" choice say "Dashboard" (the route is still `#/`). The dashboard is a list of widgets: New note button, Starred tags, Tasks and Today's note. Settings → Dashboard lets you show or hide each widget and move it up or down; this is kept per device (like line spacing). Which tag "Today's note" comes from moved from the dashboard into the same Settings section (still a server-wide setting, so it is the same on every device). New widgets are added in `client/src/views/Today.jsx` (`WIDGETS`) and `DASHBOARD_WIDGETS` in `client/src/prefs.js`. Checks: unit tests 83/83; browser tests for the dashboard, Settings, navigation, tasks and notes folders pass (one folders test failed once under load and passed on rerun).
- **Mood tracker** (new Dashboard widget, see `docs/MOOD.md`). Five-face tap buttons with an optional note, several entries a day, today's list with delete, a 7/30-day chart and a streak. Stored in a new `mood_entries` table (**schema v5**), included in JSON export/import and backups. Taps are queued on the phone and sent when the connection is back. The assistant door and MCP bridge can read moods and log one (`get_moods`, `log_mood`). Checks: unit tests 92/92 (new `tests/server/moods.test.js` and an extended MCP test); browser tests `tests/e2e/mood.test.js` (tap, note, chart, streak, delete, offline queue) and the dashboard tests pass.
  **Deployment warning:** the first start on the new version upgrades the database to v5. An older image refuses a v5 database, so rolling back the app image also means restoring a backup taken before the update (take one first).
- **Dashboard layout (local only, not deployed).** On a wide screen: a compact Mood band across the top (faces, note, and a small 7-day table instead of the earlier bar chart), then three columns: left = New note button and starred tags, center = Today's note (the widest), right = **only the overdue tasks** ("N overdue · M open" and a link to All tasks). On a phone everything stacks in that order. Each widget has a fixed column; Settings → Dashboard still shows or hides each one, and the arrows reorder widgets within the same column. The dashboard page is wider than other pages (`.page.wide`). Tasks due today, coming up and undated are no longer on the dashboard; they are on the Tasks page. Checks: unit tests 92/92; browser tests for the dashboard, mood, task rows, settings, tasks, navigation and free notes (34/34).
- **MCP bridge startup messages.** `mcp/server.js` now says why it could not start (config file missing or unreadable, not valid JSON, invalid key or URL, or no configuration at all) and never prints the key or the file's contents. A UTF-8 BOM in the private file is accepted. The other session had committed the tests and docs for this (`tests/server/mcp-startup.test.js`, `docs/MCP.md`) but not the code; it was written afterwards from those. Merged the other session's tag-move work (`work-from-other-session`) with the dashboard and mood work; fixed `streams.test.js`, whose "clash" test used a fixed date (2026-10-05) and had stopped matching "today". Unit tests 98/98.

## Deployed to CasaOS — 2026-10-07 (commit `b7553b4`)

Everything listed above under "Unreleased" (logo and icons, Dashboard and its layout, mood tracker, tag drag-to-nest, MCP startup messages, whole-vault import) went live on `http://192.168.1.50:8082`. Updated with `deploy/casaos-update.sh` run from a fresh clone of GitHub on the server (type-in command in `docs/DEPLOYMENT.md`), which reuses the existing Compose file unchanged.

- Verified backup taken first: `hq-manual-20261007-054816.sqlite` (schema v4). The database was upgraded to **schema v5** on first start.
- Rollback image: `gordonite:rollback-before-b7553b4`. Rolling the app back also needs that backup restored (the old image refuses a v5 database).
- Checks after the update: health ok; `/api/moods`, `/icon-512.png` and `/manifest.json` return 200; the assistant key is still set and the MCP `ping` works; the live export holds 213 notes, 40 tags and 0 mood entries.
- An earlier attempt with `scripts/deploy-casaos.ps1` stopped with "No such image: personal-hq:0.1.0" before changing anything (the app kept running). The cause was not found; the server's container and Compose file correctly name `gordonite:0.1.0`. The script path is untested end to end; the on-server path above is the one that was used.
- Still to do by hand: set the CasaOS tile icon to `http://192.168.1.50:8082/icon-512.png`, and check the dashboard, mood widget and tags page on the real S24.
