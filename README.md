# Personal HQ

A self-hosted note app, built to be dependable first. Each **tag** has a **daily-note stream**; you open a
stream, write in today's note, turn a line into a task without leaving the keyboard, and keep writing.
Everything is saved to SQLite on your server, and anything not yet confirmed by the server is held durably
on the phone.

This is the first usable version: notes, tags, daily streams, inline tasks, versions, trash, backups,
export/import, a combined task list with due/start dates. Dashboard, calendar, people, links/backlinks and AI are
deliberately not built.

| | |
|---|---|
| **Runs on** | Node 24 (built-in SQLite, no native modules, no runtime npm dependencies on the server) |
| **Client** | Preact + [Tiptap](https://tiptap.dev) (ProseMirror) editor, built with Vite |
| **Storage** | one SQLite file, WAL mode, `synchronous=FULL`; versioned schema migrations |
| **Docs** | [Deployment & HTTPS](docs/DEPLOYMENT.md) · [Backups & restore](docs/BACKUPS.md) · [Editor choices](docs/EDITOR.md) · [Architecture](docs/ARCHITECTURE.md) · [S24 checklist](docs/DEVICE-CHECKLIST.md) |

## Using it

* **Home** lists tags (`daily-jots`, `school/fall26`, …). Type a name in the box to open or start one.
* **A stream** shows today's entry first, then earlier days, newest first. Only the entry you are writing in
  is a live editor; the others are light read-only views (tap one to edit it). Opening a stream saves nothing;
  today's note is created on your first keystroke.
* **Toolbar** (bottom, above the keyboard): bold, italic, H1, H2, bullets, **task**, undo, redo. Buttons never
  take focus from the text, so the keyboard stays up. Tapping **task** converts the current line or bullet
  in place; tapping a checkbox ticks it where it is. Both are undoable.
* **Tasks** (home page, top): every task from every note in one list, grouped as Overdue / Today / Upcoming /
  Anytime (by stream). Tick one right there and it is saved into its own note like any other edit. Tap a task for
  its dates.
  * **Due, starts, hidden.** Type it in the task (`call dentist due fri`, `essay starts oct 12`, `due in 3 days`,
    `due 2026-11-01`) or pick it: the calendar button in the toolbar (caret in a task), or tap a task on the Tasks
    page. A picked date wins over a typed one. A task before its start date is under *Starts later* and a *hidden*
    task under *Hidden* (it stays in its note); both are folded away and not counted as to do.
  * Typed phrases are read when the list is built; your text is never rewritten. Words are resolved against the
    **note's** date, so `due fri` in Monday's note stays that Friday, and a weekday means the next one after the
    note's date (`due today` for the same day). Only the phrases listed here are understood; anything else is ignored.
* **Tags** (⋯ → Tags): a note can have several tags; it is one page whichever tag you open it through.
  Streams match the exact tag: `school` does not include `school/fall26`. A tag can have one note per date.
* **Status dot** in the header: green = saved on the server, yellow = held on the phone and on its way
  (saving, pending, offline), red = needs a look (save failed, conflict, or the phone cannot store your text).
  Tap it when it is not green to retry or jump to a conflict; press and hold or hover for the exact words.
* **⋯ → History** lists earlier versions (including text kept from conflicts); restoring never discards the
  current text. **⋯ → Move to trash**; **Trash** (home page) restores for 30 days.
* **Data & backups** (home page): back up now, download a backup, export (JSON full-fidelity, Markdown zip),
  import (merge or replace).

## Run it locally

Requires Node 24+.

```bash
npm install
npm run dev          # API on :8080 (auto-restart) + Vite on :5173 with /api proxied
```

Open http://localhost:5173. Data goes to `./data/` (git-ignored). For the production build:

```bash
npm run build && npm start      # serves API + built client on http://localhost:8080
```

### Configuration (environment variables)

| Variable | Default | Meaning |
|---|---|---|
| `PORT` / `HOST` | `8080` / `0.0.0.0` | listen address |
| `DATA_DIR` | `./data` (`/data` in the image) | database lives here (`hq.sqlite`) |
| `BACKUP_DIR` | `<DATA_DIR>/backups` | where automatic backups go |
| `HOME_TZ` | `America/Edmonton` | IANA zone that decides note dates and "today" |
| `BACKUP_INTERVAL_HOURS` | `6` | automatic backup interval; `0` disables |
| `BACKUP_KEEP_LATEST` / `_DAILY` / `_WEEKLY` | `6` / `14` / `8` | retention: newest N, plus newest of each of the last N days and weeks |
| `TRASH_RETENTION_DAYS` | `30` | deleted notes are purged after this; `0` keeps them forever |
| `VERSION_INTERVAL_MINUTES` / `VERSION_KEEP` | `5` / `100` | version snapshots at most this often while editing, newest N kept per note |
| `MAX_BODY_MB` | `100` | request size limit (imports) |

Changing `HOME_TZ` affects new notes and "today"; existing notes keep the date they were created with.

## Deploy (Docker / CasaOS)

Short version; the full walkthrough, permissions, and HTTPS options are in
[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

```bash
git clone <this repo> personal-hq && cd personal-hq
docker compose up -d --build            # app on http://<server>:8080, data in ./data
```

On CasaOS, build the image once over SSH (`docker build -t personal-hq:0.1.0 .`), then import
[deploy/casaos-compose.yml](deploy/casaos-compose.yml) with *Custom Install*. Data lives in
`/DATA/AppData/personal-hq/data`, outside the container, so replacing or upgrading the container keeps it.

> **Not verified here:** the Dockerfile, compose files and CasaOS import could not be built or run on the
> machine this was developed on (no Docker available). The application itself, including the production
> entry point and static serving, was tested. Expect to fix small things on first deploy and tell me.

## Backups and restore

* Automatic, consistent snapshots (`VACUUM INTO`, safe while the app runs) every 6 h by default, **verified
  after writing** (integrity check + row counts) and pruned by the retention settings above.
* **A backup on the same server is not enough.** Copy `backups/` somewhere else, or use the *Download*
  buttons; examples (rsync, rclone, Syncthing) are in [docs/BACKUPS.md](docs/BACKUPS.md).
* Restore (app stopped): `node server/cli.js restore <file> --yes`, which first saves the current database as a
  `prerestore` backup. In-app JSON import offers *merge* (never overwrites) and *replace* (takes a backup first).
* Restoration is tested: see *Testing* below.

## How saving works (the short version)

1. Typing updates only the editor. 300 ms after you pause, the text is written to **IndexedDB on the phone**;
   500 ms later it is sent to the server. A reply changes the dot and nothing else: the editor is never
   reloaded, so the caret, keyboard and undo history are untouched.
2. If the connection drops, the text stays **Pending on phone**, retries with backoff and on reconnect, and
   is still there if you close or reload the page. The phone copy is deleted only after the server confirms
   that exact text.
3. Every save carries the revision it is based on. If the note changed elsewhere, the server **refuses to
   overwrite**, keeps the phone's text as a *conflict version* on the server, and the phone keeps it too. A
   panel offers *Combine both*, *Use my text* or *Use the other version*; nothing is lost either way.
4. A lost reply (server saved, phone never heard) is recognised and is not treated as a conflict.

Details: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Testing

```bash
npm test             # server + client unit tests (fast; no browser needed)
npm run test:e2e     # builds the client, then drives real Chrome/Edge in a 360×780 touch context
```

The e2e tests use an installed Chrome or Edge (set `CHROME_PATH` for another Chromium-based browser); nothing is downloaded.

| Area | What is checked |
|---|---|
| Editing | Enter/Backspace/Delete at paragraph and list boundaries (pinned), bold/italic/heading from the toolbar keep focus and selection, undo/redo, emoji and CJK text, IME composition (simulated through the DevTools protocol) with autosave firing mid-composition, paste of rich HTML / plain text, select-all and word selection, caret stays above toolbar when the viewport shrinks like a keyboard |
| Tasks | text/bullet ↔ task keeps text, formatting and caret; one undo reverses it; new tasks start unchecked; Enter/Backspace rules; check/uncheck in place, undoable, persisted; stable and unique task ids across splits, duplicate pastes and reloads |
| Saving | opening saves nothing; first keystroke creates the note; save does not move the caret, drop focus or reset undo history |
| Streams | exact-tag matching, multi-tag note is one page, one live editor in a 30-note stream, tapping a past note, checkbox in a past note, paging, midnight crossing (fake clock) |
| Interruptions | offline typing then reconnect; offline + reload + reconnect (new and existing notes); lost reply; server 503s; indicator never says "saved" while the server lacks text |
| Conflicts | other-device edit, note deleted elsewhere, two devices creating today's note, edits found on reopening; all three resolutions; both versions verified on server and phone |
| Data safety | clearing a note keeps it and its text; trash/restore incl. slot clash; versions; backups verified and pruned; **restore from backup via the CLI**; JSON export → import (replace and merge) is lossless; Markdown export |

**What this does not prove:** real Android/Gboard behaviour. See [docs/DEVICE-CHECKLIST.md](docs/DEVICE-CHECKLIST.md)
for what to verify on the S24 before relying on mobile editing.

## Known limitations

* **Not yet validated on a real S24.** Autocorrect/suggestions, the on-screen keyboard resize, tap-to-focus
  opening the keyboard, and Samsung Keyboard/Gboard composition are untested on hardware.
* **No login.** It assumes your VPN is the access control. Add basic auth at a reverse proxy if you want more.
* Opening a stream needs the server. Mid-session disconnects are handled; cold-starting the app offline shows
  only notes that have unsent edits on the phone (full offline browsing is out of scope).
* Two Chrome tabs/windows on the same note share one phone-side pending record; keep to one.
* Task ids survive saves, splits and reloads but not task → text → task round trips (a new task gets a new id).
* Versions are throttled (at most every 5 min, plus when text shrinks sharply), not per keystroke.
* Trash is emptied only by retention (no "delete permanently" button). Tags cannot be renamed or deleted in the UI.
* Backspace at the start of a heading leaves the heading (it does not turn into a paragraph).
* Markdown export is one-way and omits task ids/history; use the JSON export for full fidelity.
* Docker/CasaOS files are untested (see above). Browser storage is per address: pick one stable URL
  ([HTTPS](docs/DEPLOYMENT.md#https-and-a-stable-address)) and keep using it, or unsent edits made under another address won't be seen.

## Layout

```
server/    HTTP API, SQLite store, backups, import/export, CLI      (Node built-ins only)
shared/    document format, tag rules, dates, ids (used by server and client)
client/    Preact app: sync engine (sync.js), IndexedDB store (pending.js), editor, views
tests/     server/ client/ e2e/
deploy/    CasaOS compose, Caddyfile example
docs/
```
