# Handover

> Historical snapshot from 2026-10-05. Read [the current root handover](../handover.md) first; deployment, People, links, dates, and MCP details below have since changed.

Written 2026-10-05, for whoever picks this project up next (a person or another AI session). Read this first, then
[README.md](../README.md) and [docs/ARCHITECTURE.md](ARCHITECTURE.md).

## What this is, and what the owner wants

**Gordonite / "Personal HQ"**: a personal, self-hosted notes-and-tasks app for one person (the owner), used mostly from a
Samsung S24 over a home VPN, running on a CasaOS home server. It is **their own tailored tool, not a product**: keep it
simple and do not over-engineer. In their words, the goal is an app they open every day that:

1. opens on **today's to-dos**;
2. holds the notes they used to keep in **Obsidian** (one-time import, then only this app) and **connects notes together**;
3. has a **personal CRM** (a People tab: who they know, info, "memory cues");
4. lets **Claude add and edit things too**: e.g. they paste a meeting transcript and Claude files a summary note plus
   dated tasks, readable later on the phone.

Later widgets for the Today screen they want: a **mood tracker**, **quarterly goals**, maybe a **calendar**.

## State of the code (all committed; see `git log`)

Node 24, Preact + Tiptap (ProseMirror) client built with Vite, SQLite (Node's built-in) server with no runtime npm deps.

Built and tested:
* **Notes**: *daily* notes (the per-day entry of a tag stream; one per tag per day, conflict-protected) and *free* notes
  (any number per tag per day, may have no tag, can have a **title**). Notes page with search and tag/sub-tag filter, a
  page per note (`#/n/<id>`), trash, versions/history, backups, JSON/Markdown export and import.
* **Tags and sub-tags** (`school/fall26`); tag editor on each note's page (+ adds a sub-tag); favourites; a per-tag
  **daily switch** (a tag like `trip/china` can have no "today" entry); header shows the tag as a clickable trail.
* **Saving** is the careful part: edits go to IndexedDB on the phone first, then the server against a revision; a stale
  save becomes a visible conflict and nothing is overwritten. Never weaken this (see ARCHITECTURE.md "Saving protocol").
* **Tasks live inside notes** (no task table). They can carry `due`, `start`, `hideUntil`, `hidden`, `priority`.
  Typing `due fri`, `starts oct 12`, `in 3 days`, or a date word at the very end (`... tomorrow`) sets dates without
  rewriting the text. A task is a card with a strip colour (red = due today/overdue, yellow = tomorrow, grey = rest) and
  three round buttons (hide, due, priority), on the **Tasks page**, the **Today screen** and **inside notes** (editor and
  read-only). Buttons with nothing set show on hover on a mouse; on touch only set ones show.
* **Today screen** (home): date, New note, starred tags, compact tasks, today's note ready to write in (which tag is a
  setting). Built as a list of independent widgets (`WIDGETS` in `client/src/views/Today.jsx`); add new ones there.
* **Bottom tab bar** (Today, Tasks, Notes, Tags); hidden in streams/notes and while typing.
* **Settings** page (`#/settings`, from the Tags page): line spacing (Tight / Normal / Relaxed), stored per device.
* **Assistant access**: `/api/assistant/*`, off unless `ASSISTANT_TOKEN` is set; read/search notes, create a note from
  Markdown, append to a note or to today's entry, tick/date/hide a task, see what is open. Cannot delete or replace.
  Setup and examples: [docs/ASSISTANT.md](ASSISTANT.md).
* **Tests**: `npm test` (unit/API, about 75) and `npm run test:e2e` (real Chrome/Edge in a phone-sized touch context,
  about 68; it builds the client first). Both pass as of this handover.

## Run, build, test

```bash
npm install
npm run dev            # API on :8080 (auto-restart) + Vite on :5173 (proxies /api). Open http://localhost:5173
npm test               # fast
npm run test:e2e       # needs Chrome or Edge installed
npm run build && npm start     # production build served on :8080
node server/cli.js token       # make a key for ASSISTANT_TOKEN
```

Data is in `./data/` (git-ignored): `hq.sqlite`. Settings are environment variables (table in the README).
Schema migrations are append-only in `server/db.js` (currently **v4**); never edit a shipped one.

## Where things are

* `server/` HTTP API (`app.js`), all database logic (`store.js`), migrations (`db.js`), backups, import/export
  (`portability.js`), Markdown export (`markdown.js`), CLI (`cli.js`), config (`config.js`).
* `shared/` code used by both sides: document format and validator (`doc.js`), task helpers (`tasks.js`: attributes,
  `describeTask`, `updateTask`, `dueBar`), typed-date parser (`taskdates.js`), Markdown to note converter
  (`markdown-import.js`, reused later for the Obsidian import), dates, tags, ids.
* `client/src/` `sync.js` (the save engine; `Session` per note), `pending.js` (IndexedDB), `prefs.js` (per-device
  display settings), `app.jsx` (routes, header, tab bar), `views/` (one file per screen; `Stream.jsx` holds `NoteCard`,
  used everywhere a note is shown), `editor/` (Tiptap setup, toolbar, read-only renderer `render.js`, icons).
* `docs/` ARCHITECTURE, EDITOR (read before touching the editor), ASSISTANT, BACKUPS, DEPLOYMENT, DEVICE-CHECKLIST.

## How the owner likes to work (important)

* **Ask when unsure what a feature is for; do not guess or invent.** Reference screenshots they share are inspiration:
  "the current system trumps these". They explicitly said: implement what we have in the way the picture does, and ask
  about anything whose purpose is unclear.
* Plain, short explanations; they are not a developer. Say what changed and what you did not do.
* Confirm before pushing to GitHub unless they have said to (they did at the end of this session: push everything).
* They will be on a **VPN** when away; the server need not be public. There is **no human login unless the owner turns on the small optional password** (Settings → Password, `docs/LOGIN.md`), by design (CasaOS's
  own login protects the CasaOS dashboard, not the app's port); only the assistant door has a key. A login can be added
  later if they want one.
* Decisions already made: Obsidian is a **one-time import** (no two-way sync), skipping dot-folders such as `.agents` and
  `.claude` (Claude skill files). **Ask before opening their vault** (it holds personal notes on ~61 people). Hide-until
  is by day, no time of day. The task arrow expands the task inline.

## Gotchas learned the hard way

* **Do not push text containing backslashes or `$` through shell heredocs** when editing code: the shell here changed
  backslashes, and `String.replace` treats `` $` `` / `$&` in the replacement as patterns. Use the editor/file tools, or a
  function replacer.
* **Vite's file watcher sometimes serves a stale module** after quick successive edits (blank page or a missing import).
  `touch` the changed files and reload.
* Killing "the dev server" by process name can also kill the API child of `npm run dev` (it ends the whole dev run).
* The e2e suite uses the **built** client: run `npm run build` (or `npm run test:e2e`, which does) after client edits.
* A few keyboard tests in `tests/e2e/editing.test.js` ("stage 1", boundary behaviours) are **flaky** under load (they pass
  or fail from run to run on old code too). Re-run on their own before concluding anything broke.
* Files have mixed CRLF/LF line endings on this Windows machine; git warns but it is harmless.
* ProseMirror: the task buttons are a wrapped node view (see EDITOR.md departure 5). Keep `stopEvent`/`ignoreMutation`
  narrow and never ignore selection mutations.

## Not verified yet

* **The Docker image and the CasaOS import** (the README says so; Docker is not installed on the dev laptop).
* **A real phone** (S24): keyboard behaviour, tap targets; see [DEVICE-CHECKLIST.md](DEVICE-CHECKLIST.md).
* **Reaching the home server from the laptop away from home** (needs WireGuard on the laptop, as its own peer; tethering
  through the phone's VPN usually does not carry laptop traffic). At home no VPN is needed.

## Next steps (agreed order)

1. **Get it on the home server** (CasaOS), set `ASSISTANT_TOKEN`, and try it on the S24. Best done at home. Walk the owner
   through it step by step; they will report back what happens.
2. **Links between notes**: `[[note name]]` in the text and a "linked from" list on each note (the Obsidian import and
   People both build on this; the converter already keeps `[[wiki links]]` as plain text).
3. **Obsidian import** (reuse `shared/markdown-import.js`; folder path to tag path; keep front matter fields).
4. **People (CRM)**: a person is a note-like page with circle (CSS, Nursing, Friends, ...), closeness (Close / Friendly /
   Acquaintance), memory cues and likes, one search across them, and the notes that mention them. Their earlier draft
   (cards with initials, filter pills) is only a reference. Add a People tab to the tab bar when it exists.
5. Today widgets: mood tracker (daily check-in with history), quarterly goals, calendar (start read-only by fetching their
   Google Calendar's private iCal link from the server; two-way sync is a much bigger job).
6. Optional: an MCP connector so Claude can reach the app from outside this desktop session; a human login.

Open items: the owner said they would share the contents of a GitHub Pages site with their older drafts later (no link
was received); the left-strip colour rule beyond red/yellow/grey and what else goes in the expanded task were not
specified, so ask before adding.
