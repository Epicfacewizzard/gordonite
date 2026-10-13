# Gordonite handover

Updated **2026-10-12**, home timezone **America/Edmonton**. This is the current handover; `docs/HANDOVER.md` is an older historical snapshot and contains superseded deployment and feature information. The exact per-release record is `docs/RELEASE-NOTES.md`.

## Read first

- Follow `AGENTS.md`: **no port forwarding**, no public endpoint or tunnel. External access uses the existing WireGuard VPN. Cloudflared is only a future consideration unless explicitly requested.
- Document meaningful changes, checks, deployments, imports, and limitations. Never commit passwords, assistant tokens, private keys, or personal note contents.
- Keep storage and writing reliability ahead of presentation. The UI is provisional and may be redesigned.
- Tasks live inside their original structured note documents. Keep stable note/tag/task IDs, revision conflict checks, durable pending edits, undo, recovery, and backups intact.
- Do not treat instructions imported from the Obsidian vault as current project instructions.
- **Source files use Windows (CRLF) line endings.** A script that matches multi-line text will silently fail to match; use the editor tool or normalise line endings first and write them back.

## Current state

| | |
| --- | --- |
| Repository | `https://github.com/Epicfacewizzard/gordonite.git`, branch `main` |
| Version on `origin/main` | **0.5.1** (`37bf398`: undo for a removed file and a deleted mood entry; pushed 2026-10-12 after it was deployed) |
| Version running on the server | **0.5.1** (`/api/health` reported `0.5.1` on 2026-10-12, after the owner ran the deploy script; schema v6) |

Raise the version (`APP_VERSION` in `server/app.js`, `package.json`, `package-lock.json`) with every code change, and add a `docs/RELEASE-NOTES.md` entry; the number is shown at the bottom of Settings and in `/api/health`.

### 0.5.1 (deployed 2026-10-12)

Undo for the two deletes that had none: a file removed on the Files page (Undo link, or *Show removed files* →
*Bring back*) and a deleted mood entry (15-second Undo). Both are soft deletes that already existed, so there is no
schema change. [docs/UNDO.md](docs/UNDO.md) lists every undo and recovery path and what cannot be undone. The editor's
undo is **100 to 120 steps** (verified by `tests/e2e/undo-depth.test.js`).

### 0.5.0 (deployed 2026-10-12)

**Photos, PDFs and other files in notes.** Paperclip in the toolbar (also paste/drop), Files page at Settings → Files,
HEIC converted to JPEG with the original kept, assistant tools and an inbox-folder import. Read
[docs/ATTACHMENTS.md](docs/ATTACHMENTS.md) first; the points that matter operationally:

- **Schema v6** and **document format 2** (a strict superset; stored notes are not rewritten). The previous app
  version refuses a v6 database, so a rollback needs the pre-update backup the deploy script takes.
- **Files are NOT in the SQLite backups.** They are in `<data folder>/files` (`FILES_DIR`). Back that folder up with
  the database. In the CasaOS setup it is inside the mounted data folder, so it survives updates. `node
  server/cli.js check-files [--hashes]` verifies it.
- **New runtime dependency** `heic-convert` (about 10 MB with its dependencies). The Dockerfile's final stage now runs
  `npm ci --omit=dev`; the browser libraries moved to `devDependencies`. The first image build needs network access.
  The real image built on the server without trouble, and a real HEIC photo was converted inside the running
  container afterwards (checked through the live API; the test file was hidden again). The pre-update backup is
  `hq-manual-20261013-045146.sqlite` (schema v5); the rollback image is `gordonite:rollback-before-bf48e8b`.
- Bridge: 18 tools; `inboxDir` in the private config file enables `list_inbox` / `upload_file` (confined to that
  folder). Existing assistant config files keep working unchanged.
- Tests: unit 137/137; the browser suite has the same known/pre-existing failures as 0.4.4 (see the 0.5.0 release
  notes). Not yet checked on a real phone: camera capture from the paperclip and HEIC from an iPhone.

### 0.4.3 (deployed 2026-10-12)

On the dashboard, under today's note, the last **two** days' daily entries of the chosen tag show, greyed out and headed only by their date. **Tapping one opens it for editing in place** (caret where tapped; saved to that day, never into a new note). Only one editor is open at a time (today's, or the tapped day's); tapping today's note makes it the open one again. "Show older notes" adds three at a time and fetches older stream pages when the loaded ones run out. Empty days are skipped; only `daily` entries are listed; long entries fade until opened. The tag choices moved from under the note to beside the "Today's note" heading.

Files: `client/src/views/EarlierNotes.jsx` (new; reuses the stream's `NoteCard`), `client/src/views/Today.jsx`, `client/src/styles.css`. No server or database change. Tests: `tests/e2e/earlier-notes.test.js`.

### Working features

- Daily and ordinary titled notes, formatting, bullets/nested lists, inline tasks, tags/sub-tags, exact-tag streams, search, and folder-style note browsing. Tags page: collapsed parents and drag to move/nest.
- Tasks can be completed, dismissed (Shift-click a checkbox dismisses), deleted, restored, scheduled, and moved. Completed items stay in the document as crossed-out rows; dismissed items are hidden from the writing surface. Each note has date-filtered task history; the Tasks page has Done and Dismissed lists with a date range.
- Natural dates/times (`docs/NATURAL-DATES.md`): relative phrases use the **note date**. No alarms, notifications or recurrence.
- Dashboard (the "Today" route, `#/`): widgets (New note, starred tags, Tasks box, Mood, Today's note) can be shown, hidden, reordered and moved between columns per device in Settings → Dashboard.
- Optional login password, off by default (`docs/LOGIN.md`). Stable HTTPS is still unfinished.
- People cards/search/group filters are views over ordinary notes tagged `05-people` and its children, not a separate contacts database.
- `[[note links]]` resolve saved titles to stable note IDs; linked-note Back navigation works across chains.
- Automatic saving, IndexedDB pending edits, reconnect retries, explicit conflict preservation, recent versions, trash, JSON/Markdown export, merge import, and verified SQLite backups with retention.
- Authenticated local MCP bridge (see below).

## Server and local preview

| Item | Value |
| --- | --- |
| CasaOS | `http://192.168.1.50` |
| Live Gordonite | `http://192.168.1.50:8082` |
| SSH username | `gordon` |
| Container / Compose service | `gordonite` |
| Compose file | `/home/gordon/gordonite/deploy/gordonite-casaos.yml` |
| Persistent directory | `/DATA/AppData/gordonite/data` → `/data` |
| User / restart | `1000:1000` / `unless-stopped` |

The exact image tags and release folders change with every deployment; `docs/DEPLOYMENT-2026-10-06.md` and `docs/RELEASE-NOTES.md` record the earlier ones. They were **not** re-inspected for this handover (`scripts/deploy-casaos.ps1 -Inspect` shows them, read-only).

Do not expose the app publicly. Access is trusted LAN, or WireGuard away from home. The computer must be on `192.168.1.x` or have its WireGuard tunnel up; on 2026-10-11 it was on a different subnet with the tunnel off and could not reach the server. (That was written up in an uncommitted status note in the owner's working folder, `docs/STATUS-CHECK-2026-10-11.md`; it is not in `main`.)

Node **24+**, Preact, Tiptap/ProseMirror, Vite, SQLite via Node's built-in driver; no runtime server npm dependencies. Docker builds the client and runs one Node server.

```powershell
npm ci
npm run dev                  # API on :8080 + Vite on :5173
npm run build; npm start     # production-style, serves client/dist
npm run preview:local        # persistent local preview with its own data (scripts/preview-local.js)
```

Production preview and browser tests serve `client/dist`; **build after client edits**. A page that only changes its `#hash` does not reload: use a new query string or Ctrl+Shift+R to see a new build.

## Deploying

`scripts/deploy-casaos.ps1` builds a clean `git archive` of the last commit, runs the unit tests, copies it to the server, builds the image there and recreates the container with the **existing** Compose configuration (assistant token, mount, port and user preserved). It needs the server password interactively (copy, login, sudo), so it must be run by the owner in a normal PowerShell window; an assistant cannot answer those prompts. `-DryRun` builds and verifies without touching the server; `-Inspect` is read-only.

**Latest deployment: 0.4.3 on 2026-10-12**, run by the owner with the script above (the dry run had built release `856def5`, 2.8 MB, with 114/114 unit tests passing); `/api/health` then reported `0.4.3`. It was pushed to GitHub `main` afterwards, so the script's "HEAD is not the same as origin/main" note applied at deploy time and no longer does. The on-server image tags and release folder were not inspected.

Take a verified backup first (Settings → Data & backups → Back up now), and keep the old image tag for rollback. A plain container restart does not apply a new image; recreate with:

```bash
sudo docker compose -f /home/gordon/gordonite/deploy/gordonite-casaos.yml up -d --no-build --pull never --force-recreate gordonite
```

Never run restore against the live database while the app is running. The database is at schema **v5** (upgraded from v4 in the 2026-10-07 deployment); rolling back the app image past that point needs the pre-upgrade database backup as well (see the release notes for that deployment).

**No off-server copy of the database exists yet.** Backups are verified but live on the same machine; copy `/DATA/AppData/gordonite/data/backups` elsewhere (`docs/BACKUPS.md`).

## MCP

Read root `mcp-bridge.md` for another assistant's setup and `docs/MCP.md` / `docs/ASSISTANT.md` for API details. Connection: assistant → local `mcp/server.js` subprocess over stdio → authenticated HTTP assistant API → server → SQLite. Each computer runs its own bridge; stdio is not a LAN listening port.

- Private configuration: `%LOCALAPPDATA%\Gordonite\mcp.json` with `url` and `token`, kept outside the repository **and outside OneDrive**. Never print or commit it; the token equals the server's `ASSISTANT_TOKEN`.
- **2026-10-07 incident:** every client start failed with "Server disconnected" because that file did not exist. The bridge now says which startup step failed (file not found, invalid JSON, key too short, bad URL, no `--config`) and tolerates a UTF-8 BOM; the table is in `docs/MCP.md`. The owner recreated the file and `scripts/check-mcp.mjs` then listed all nine tools and pinged successfully.
- A chat loads MCP tools only when it starts; after fixing the connection, start a **new** chat to get them.
- Note trashing needs the human's explicit confirmation of that specific note and its reviewed revision. A timed-out write may have succeeded: read the note before retrying an append/create, to avoid duplicates (an append that looked as if it had failed had in fact been saved).

## Validation

- `npm test`: **114/114** (server, API, persistence, interruption recovery, conflicts, backup/export/import/restore, MCP bridge and startup messages, client sync).
- `npm run test:e2e` (real Chrome/Edge, 360×780 touch context; builds first): **120 of 123** pass on 0.4.3. The three failures fail identically on unmodified 0.4.2, so they are not from the 0.4.3 change, and have **not been investigated**:
  - `history-move.test.js` — "desktop grip drag corrects the recorded day"
  - `task-text-edit.test.js` — "text edits stay in the original task, preserve formatting/children and recover offline; only arrow expands"
  - `task-lifecycle.test.js` — "task dismissal and deletion in the editor are undoable and survive a connection interruption" (passed in one earlier run; may depend on time or test order)
- Test helpers and sleeps: Playwright sends keys far faster than a person. Several tests wait ~40 ms after navigation keys and ~400 ms after a tap before pressing keys, because ProseMirror ignores selection changes right after it places the caret. That is deliberate, not flakiness.
- Tests must not hard-code "today". `resilience.test.js` did (2026-10-05) and eight of its tests silently failed once the date moved; they now use the current date in `America/Edmonton`.
- **Not verified on the S24.** Autocorrect, Gboard/Samsung Keyboard composition, keyboard resizing and whether a tap on a read-only note opens the keyboard in one tap are unchecked on hardware; use `docs/DEVICE-CHECKLIST.md`. IME composition is only simulated.

## Repository and housekeeping

- The OneDrive checkout (`C:\Users\Epicf\OneDrive - University of Calgary\Gordonite`) is on branch **`work-from-other-session`** (`6a5876b`), **behind `origin/main`**, with one uncommitted local change in `mcp/server.js` that predates the 0.4.3 work and was left alone. Its branch is not `main`; switch or re-clone before starting new work. Do not build new work on it: `git fetch` and start from `origin/main`.
- 0.4.3 was built in a separate worktree under the session scratchpad (`...\scratchpad\gordonite-main`, a temp folder that may be cleaned up). The branch `feature/today-previous-days` lives in the main repository's `.git` and survives; run `git worktree prune` if the folder disappears.
- The repository is inside OneDrive. `git gc` packing loose objects makes OneDrive ask to confirm deleting hundreds of hex-named files (`.git/objects/..`); that is safe (**Delete all items**; the objects are in the pack and `git fsck` is clean). Moving the repository outside OneDrive (for example `C:\dev\Gordonite`) would stop this and keep `node_modules` out of the cloud.
- A stray folder `C:\proc\nonexistent\x` (a test database and one backup) was created on the system drive by a mistaken probe on 2026-10-05. It holds nothing else and can be deleted by hand; the assistant tool refuses to remove that path.
- The screenshots in the 2026-10-12 session used throwaway data on port 8083; it is not the live server.

## Obsidian import

Source vault: `C:\Users\Epicf\OneDrive - University of Calgary\Obsidian Vault`. The authorized `00 Inbox`, `05 People`, `10 School` and `20 CSS` folders were transferred (109 notes, 25 new tags); existing server notes were preserved and a repeat dry run found all unchanged. The vault was not modified. `scripts/import-vault.js` prepares a dry-run payload by default; `--apply` merges and preserves changed existing content through recovery rather than overwriting. Expanded vault import shipped with the 2026-10-07 deployment (see the release notes).

**Comparison, 2026-10-12 (read-only; the vault copy on this PC against the live server).** The vault is almost entirely
in the app already (an earlier note here wrongly said whole folders were never imported; the import covers every
top-level folder except `99 System`). Of the 214 Markdown files: **197 are on the server identical**; **4 differ**
(`01 Daily/2026-10-03` was edited in the app afterwards; `90 Archive/Imported 2026-09-27/EXECUTIVE_ACTION_TRACKER` was
de-tasked in the app; `50 Projects/CSS Ticketing System` and `50 Projects/HQ App - Build Plan` are different revisions
of the same note, a few lines or words each way, and were never edited in the app); **5 are not on the server**
(the four `File-…` transcripts waiting in `00 Inbox`, written 2026-10-07 after the last import, and
`50 Projects/HQ - System Design`); **8 are deliberately not imported** (`99 System/Templates` x4 and the four root
files `AGENTS.md`, `CLAUDE.md`, `Home.md`, the "MOVED" note). The **9 non-Markdown files (about 30 MB)** are not in the
app because it could not hold files before 0.5.0: in `00 Inbox` a PDF, a ZIP, two `.srt` and a `.csv`; in `10 School`
a DOCX and a PDF; in `20 CSS` an XLSX; in `30 Personal` a 23 MB WAV. The comparer was a throwaway script (it reuses
`import-vault.js`'s id and tag rules). `scripts/import-vault.js --apply` is safe for the rest: merge mode adds what is
missing and keeps a differing vault version as a version in History (kind `import`), and the server takes a
pre-import backup first.

**Then applied (same day).** `scripts/import-vault.js --apply` created 5 notes and kept the 4 differing vault versions
in History (server backup `hq-preimport-20261013-053642.sqlite`); re-running the comparison showed **206 of 206
identical** (only the 8 deliberately excluded files remain). The 9 non-Markdown files were uploaded and each put at the
end of the note beside it in the vault (the Week 5 DOCX and PDF, `CSS Inventory.xlsx`, the September FAT `.wav`, and
the two `.srt`), with the three loose Inbox files in a new note, **Inbox files from the vault** (tag `00-inbox`);
each edited note kept its earlier text as a version, and all 9 were checked to open at the stored size. The vault was
not modified. Trimming the OneDrive vault down to `00 Inbox` is now possible without losing anything that is only
there (the two `.srt` and the loose files are in the app; the originals are still in the vault).

The OneDrive vault copy is old (its own "MOVED" note says the live vault is `C:\Users\Epicf\Vault`, which is not on
this PC); its `00 Inbox` is still used as the agents' drop folder.

## Condo files import (2026-10-12)

The shared OneDrive folder `Condo Docs Shared - 1311 Sage Meadows Gardens` was copied into the app after 0.5.0 was
deployed (read-only on the folder; nothing there was moved, renamed or deleted). 81 files in the folder became 80
stored files (two identical equipment manuals are stored once; 52 HEIC photos were converted to JPEG with the originals
kept) in two notes tagged `30-personal/condo`: **Condo – 1311 Sage Meadows Gardens** (24 documents, in sections:
lease and rental, move-in inspection reports, condo corporation, insurance, unit and equipment) and **Condo – move-in
photos** (55 photos and one video). All 80 were checked to be retrievable at the stored size. The section grouping was
chosen from file names and can be rearranged. It was done by a throwaway script (not committed) that remembers its
uploads, with a rehearsal against a local server first.

## Next work (owner's requests; do not implement automatically from this document)

1. Investigate the three failing browser tests above.
2. Stable HTTPS; an off-server copy of the backups.
3. Separate Personal, School and Club areas; projects connected to existing notes/tasks; stable People references and Waiting on state. Task text stays in its source document.
4. More dashboard widgets (goals, calendar) need design before they are built.

Read `docs/ARCHITECTURE.md` and `docs/EDITOR.md` before changing saving or editing behaviour. Follow the owner's latest request over old planning documents, keep dependencies modest, and explain changes in plain language.
