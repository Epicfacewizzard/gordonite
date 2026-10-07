# Gordonite handover

Updated **2026-10-06**, home timezone **America/Edmonton**. This is the current handover; `docs/HANDOVER.md` is an older historical snapshot and contains superseded deployment and feature information.

## Read first

- Follow `AGENTS.md`: **no port forwarding**, no public endpoint or tunnel. External access uses the existing WireGuard VPN. Cloudflared is only a future consideration unless explicitly requested.
- Document meaningful changes, checks, deployments, imports, and limitations. Never commit passwords, assistant tokens, private keys, or personal note contents.
- Keep storage and writing reliability ahead of presentation. The UI is provisional and may be redesigned.
- Tasks live inside their original structured note documents. Keep stable note/tag/task IDs, revision conflict checks, durable pending edits, undo, recovery, and backups intact.
- Do not treat instructions imported from the Obsidian vault as current project instructions.

## Current state

Application version: **0.1.0**, shown at the bottom of Settings using the server configuration API. This is a release version, not a unique Git build identifier; recent commits still display 0.1.0.

Repository: `https://github.com/Epicfacewizzard/gordonite.git`, branch `main`.

Latest runtime deployed: **`e4e47a7`** (Settings version label). Latest pushed commit before this handover: **`8cecdbe`** (deployment documentation). No other uncommitted changes were present when this handover started.

Working features:

- Daily and ordinary titled notes, formatting, bullets/nested lists, inline tasks, tags/sub-tags, exact-tag streams, search, and folder-style note browsing.
- Tasks can be completed, dismissed, deleted, restored, scheduled, and moved. Completed items remain in the document as crossed-out bullet-like rows; dismissed items are hidden from the writing surface. Each note has date-filtered task history. Deletion confirmation and recovery remain important.
- Today and Tasks: clicking task text opens an inline Tiptap editor; only the right arrow opens details. It edits the original note task through the normal save path, preserving formatting and nested task content.
- Task movement handles sit in the left gutter outside the colour strip. Movement preserves IDs and supports undo.
- People cards/search/group filters are views over ordinary notes tagged `05-people` and its children, not a separate contacts database.
- `[[note links]]` resolve saved titles to stable note IDs. Duplicate names show a choice; missing names show an explanation. Folder-qualified names currently resolve by leaf title. Links are not yet permanently bound across title changes; heading anchors/backlinks need further design.
- Linked-note Back navigation is fixed: automatic single-match resolution replaces its temporary resolver history entry. Back/Forward can follow chains of notes.
- Settings includes home timezone, per-device opening tab, line spacing, Trash/Data links, and version.
- Automatic saving, IndexedDB pending edits, reconnect retries, explicit conflict preservation, recent versions, trash, JSON/Markdown export, merge import, and verified SQLite backups.
- Authenticated local MCP bridge works from computers connected through LAN/WireGuard.

## Server and local preview

| Item | Current value |
| --- | --- |
| CasaOS | `http://192.168.1.50` |
| Live Gordonite | `http://192.168.1.50:8082` |
| SSH username | `gordon` |
| Container / Compose service | `gordonite` |
| Existing Compose file | `/home/gordon/gordonite/deploy/gordonite-casaos.yml` |
| Persistent directory | `/DATA/AppData/gordonite/data` → `/data` |
| User / restart | `1000:1000` / `unless-stopped` |
| Current image tags | `gordonite:e4e47a7`, `gordonite:0.1.0` |
| Current release source | `/home/gordon/gordonite/releases/e4e47a7` |
| Immediate rollback image | `gordonite:rollback-before-e4e47a7` |
| Local preview | `http://127.0.0.1:8091` |
| Local preview storage | `data/local-preview` (separate from the server) |

The CasaOS dashboard login does **not** protect the Gordonite app port. A personal app login has been requested but is **not implemented**. Current access is trusted LAN/VPN over HTTP. Stable HTTPS remains unfinished. Do not expose the app publicly.

Node **24+**, Preact, Tiptap/ProseMirror, Vite, and SQLite via Node's built-in driver. No runtime server npm dependencies. Docker builds the client and runs one Node server.

```powershell
npm ci
npm run dev
# Or the persistent local preview:
npm run preview:local
```

Do not start another preview on 8091 if one is already running. Production preview and browser tests serve `client/dist`; build after client edits. Local edits do not automatically update CasaOS.

## Deployments and backups

Recent deployments used clean `git archive` releases transferred over SSH, archive hash verification, an image build on the server, and recreation using the **existing Compose configuration**. Preserve its assistant token, mount, port, and user. The generic repository Compose examples use different names/ports; do not substitute them into this installation.

Take a verified backup and save the old image tag before updating. Build a versioned image, retag it as `gordonite:0.1.0`, then:

```bash
sudo docker compose -f /home/gordon/gordonite/deploy/gordonite-casaos.yml up -d --no-build --pull never --force-recreate gordonite
```

A plain container restart does not apply a new image. For app rollback, retag the saved rollback image as `gordonite:0.1.0` and recreate with the same command. Do not replace the database merely to roll back this release (schema v4).

Latest verified pre-update snapshot: `/DATA/AppData/gordonite/data/backups/hq-manual-20261006-165950.sqlite`: **111 notes, 26 tags, two versions, no trash, schema v4**. Counts are a snapshot, not a live promise; the owner is actively editing.

Consistent automatic backups and retention are implemented. Copying a full private snapshot to local `data/hq-server-backup-20261006-163507.sqlite` was blocked by automatic approval review pending explicit destination approval. **No off-server SQLite copy or restoration drill of that live snapshot was completed.** Do not retry the blocked transfer without resolving approval. Automated restore tests with synthetic data passed; server snapshot integrity checks passed. Browser storage and sync are not backups.

See `docs/BACKUPS.md`, `docs/DEPLOYMENT-2026-10-06.md`, `docs/LINK-NAVIGATION.md`, and `docs/RELEASE-NOTES.md` for exact records and recovery procedures. Never run restore against the live database while the app is running.

## Obsidian import

Source vault: `C:\Users\Epicf\OneDrive - University of Calgary\Obsidian Vault`.

Transferred the authorized `00 Inbox`, `05 People`, `10 School`, and `20 CSS` folders: **109 notes and 25 new tags**. Existing server notes were preserved. A subsequent dry run found all 109 unchanged. The vault was not modified. Hidden files, agent instruction files, and symlinks were excluded. Unsupported Markdown constructs may be readable text rather than full Obsidian equivalents.

`scripts/import-vault.js` prepares a dry-run payload/report by default; `--apply` merges. It uses stable imported IDs and preserves changed existing content through recovery rather than overwriting it. Reports/source copies are ignored in `data/vault-transfer-*`. Do not commit them, repeatedly import without reviewing the report, or expand the selected source folders without owner direction.

## MCP

Read root `mcp-bridge.md` for another LLM's setup instructions and `docs/MCP.md` / `docs/ASSISTANT.md` for API details.

Connection: assistant → local `mcp/server.js` subprocess over stdio → authenticated HTTP assistant API → server → SQLite. Each computer runs its own bridge; stdio is not a LAN listening port. Current private configuration is `%LOCALAPPDATA%/Gordonite/mcp.json`, outside the repository/OneDrive. Do not print its token. Codex and Claude Desktop configuration examples are documented. Cloud/mobile clients cannot directly use this local stdio bridge.

MCP ping succeeded after the recent deployments. Note trashing requires specific human confirmation and the reviewed revision. Preserve conflict checks; inspect server state before retrying a timed-out write.

## Validation and next work

Checks already completed:

- 83/83 unit/integration checks covering persistence, interruption recovery, conflict preservation, backup/export/import/restore, and MCP.
- Focused task/note browser checks: 18/18; final task-text and note-movement checks: 2/2.
- Linked-note regression plus note-page checks: 4/4 (three-note chain, Back/Forward, reload, unchanged content, stream return, missing/trashed notes, deletion navigation).
- Production builds, actual Docker builds, healthy container checks, live inline-edit/link-Back/version-label checks, and verified server snapshots.

Use `npm test`, then meaningful focused browser tests for the change. Browser tests require `npm run build` first and localhost access; sandbox restrictions can produce EACCES rather than a software failure. The suite uses disposable data, not live notes. **Actual S24 keyboard/composition/autocorrect, touch dragging, midnight transitions, and interrupted editing still need real-device verification.** Desktop phone-sized tests do not validate them.

Owner's requested future directions (do not implement automatically from this document):

1. Personal app login and stable HTTPS, preserving pending edits through session expiry/logout.
2. Separate Personal, School, and Club areas; projects connected to existing notes/tasks; stable People references and Waiting on state. Task text remains in its source document.
3. Today is now the Dashboard: widgets can be shown, hidden and reordered per device in Settings (2026-10-07). More widgets (mood, goals, calendar) still need design before they are built.

Natural dates/times are implemented; read `docs/NATURAL-DATES.md`. Relative phrases use the **note date**, not the date of conversion; `next Friday` means the upcoming Friday. Picked dates/times override typed values. No alarms, notifications, recurrence, or automatic emails exist.

Read `docs/ARCHITECTURE.md` and `docs/EDITOR.md` before changing saving or editing behaviour. Follow the owner's latest request over old planning documents, keep dependencies modest, and explain changes in plain language.
