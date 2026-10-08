# Personal HQ

A self-hosted note app, built to be dependable first. Each **tag** has a **daily-note stream**; you open a
stream, write in today's note, turn a line into a task without leaving the keyboard, and keep writing.
Everything is saved to SQLite on your server, and anything not yet confirmed by the server is held durably
on the phone.

This is the first usable version: notes, tags, daily streams, inline tasks, versions, trash, backups,
export/import, a combined task list with due/start dates, and cards for people notes. Dashboard, calendar,
structured contact profiles, links/backlinks and AI are
deliberately not built.

| | |
|---|---|
| **Runs on** | Node 24 (built-in SQLite, no native modules, no runtime npm dependencies on the server) |
| **Client** | Preact + [Tiptap](https://tiptap.dev) (ProseMirror) editor, built with Vite |
| **Storage** | one SQLite file, WAL mode, `synchronous=FULL`; versioned schema migrations |
| **Docs** | [Deployment & HTTPS](docs/DEPLOYMENT.md) · [Backups & restore](docs/BACKUPS.md) · [Editor choices](docs/EDITOR.md) · [Architecture](docs/ARCHITECTURE.md) · [Assistant access](docs/ASSISTANT.md) · [Handover](docs/HANDOVER.md) · [S24 checklist](docs/DEVICE-CHECKLIST.md) |

## Using it

To try the folder browser with fictional notes locally, run `npm run preview:local`, then open
<http://127.0.0.1:8091/#/notes>. It listens only on this computer. Samples and edits persist separately in
`data/local-preview`; nothing is imported from Obsidian or sent to CasaOS. Stop with Ctrl+C and rerun the
same command to reopen your preview notes. Automatic backups are off for this sample instance.

**Notes folders** follow slash-separated tags. Expand a folder, select it, then tap a note to edit.
Intermediate folders appear even if only child tags exist. “Include sub-tags” controls whether folder
results include descendants; daily streams still match exact tags. Multi-tag notes remain one shared page.
Your folder and search stay selected when returning from a note in the same browser tab. This browser
does not yet import Obsidian links, tables or callouts.

For a local comparison with an existing vault, `node scripts/preview-vault.js "path to vault"` copies only
Markdown notes in `00 Inbox`, `10 School` and `20 CSS` into this separate preview database. It keeps each
original file byte-for-byte under `data/local-preview/vault-originals` (including frontmatter), excludes
agent instruction files, and never updates the source vault. Rerunning skips existing preview copies,
including copies you have edited or trashed. It uses the existing limited Markdown converter: links and
tables may appear as text, callouts lose their box styling, and attachments are not copied. This is a
preview comparison, not a full migration. All preview data is ignored by Git.
Add `--people` to copy only `05 People`, using the same original-file preservation and skip-on-rerun rules.

The current interface is provisional and may receive a full UX/UI redesign. Prioritize working features
and reliable data; keep navigation and styling replaceable without changing note storage or editor behavior.

* **Settings** (gear in the header): line spacing for note text (Tight / Normal / Relaxed, with a live preview), kept
  per device. Normal is tighter than the app's first version; Relaxed is that original look. Shift+Enter starts a new
  line inside the same paragraph with no gap.
* **Tab bar** (bottom): Today, Tasks, People and Notes, one tap away. People searches and opens ordinary notes
  tagged `05-people` (including child tags). Tags opens from the Notes page and keeps the existing tag controls. The bar steps aside inside a stream or a note (they have
  their own toolbar) and while you are typing, so the keyboard gets the room.
* **Today** (the home screen): the date, a New note button, any starred tags, what needs doing
  (Overdue, Due today, Coming up in the next 7 days, and a few tasks with no date; tick them right there), and
  today's note ready to write in. Which tag's daily entry it shows is a setting at the bottom of that section.
  It is a stack of independent sections, so adding one (a calendar, a mood check-in, goals) is adding one component.
* **Tags** (Notes → Tags, `#/tags`) lists every tag (`daily-jots`, `school/fall26`, …). Create a tag at the top, or tap an existing tag to open it.
  The create form saves an empty tag without creating a note. Parent tags expand/collapse; stars keep favorite tags on Today.
* **Settings** is reachable with the gear beside the save-status dot. Trash and Data & backups live there.
* **Dismiss a task** from its details to keep it in its note, excluded from active tasks and separate from completed
  tasks. A UTC dismissal timestamp is stored on the task itself. Open Tasks → Dismissed → task details →
  Bring back task to reactivate it. **Delete task…** asks for confirmation, then removes its text and any nested
  items from the note; siblings stay intact. A previous note version is always kept for deletion, even within
  the normal snapshot interval. Both actions use the existing autosave and conflict protection. Inside an
  active note editor they are undoable. The toolbar’s Task details button opens these actions for the task
  under the cursor. No imported tasks are automatically completed, dismissed or deleted.
* **People** shows cards, searches the note titles/body and filters by child tags of `05-people`, with each card
  opening its ordinary note page. This is not yet a structured contacts database. Obsidian `[[links]]` are still
  plain text; linking is the next separate change.
* **Task history** below a note lists its completed and dismissed tasks, grouped by the recorded date in your
  home timezone. Choose From/Through dates, filter by status, use All dates, or Show older tasks to expand the
  range. Bring back reopens a task in place. New checkbox completions record `completedAt` in the same undo
  operation; imported checked tasks have no fabricated completion timestamp and appear under Date not recorded.
* **A stream** shows today's entry first, then earlier days, newest first. Only the entry you are writing in
  is a live editor; the others are light read-only views (tap one to edit it). Opening a stream saves nothing;
  today's note is created on your first keystroke.
* **A note on its own page.** Tap a note's date (or ⋯ → *Open on its own page*, or *Open this task's note* in a
  task's sheet) to see just that one note full-screen at `#/n/<id>`. It is the same editor, status dot and menu,
  and the same note as in the stream, so the two never disagree. The link can be bookmarked or opened in another
  browser tab. Back returns to where you came from.
* **Toolbar** (bottom, above the keyboard): bold, italic, H1, H2, bullets, **task**, undo, redo. Buttons never
  take focus from the text, so the keyboard stays up. Tapping **task** converts the current line or bullet
  in place; tapping a checkbox ticks it where it is. Both are undoable.
* **Tasks** (home page, top): every task from every note in one list, grouped as Overdue / Today / Upcoming /
  Anytime (by stream). Tick one right there and it is saved into its own note like any other edit. Each task is a
  card with three round buttons: **hide** (eye), **due date** (calendar) and **priority** (star). Tap the task's text
  for all of its details in one sheet.
  * **Date button** → *Due*: Today, Tomorrow, This weekend, One week, Three weeks (each with its date), Choose date,
    Clear. The footer switches the same menu to *Starts at*. A task is out of the main list until its start date.
  * **Hide button** → *Hide until*: Tomorrow, This weekend, One week, Three weeks, Choose date, Choose number of days, or
    *Hide until I show it*. It comes back by itself on the day; *Show again* undoes it.
  * **Priority button**: Urgent & Important (filled star), Urgent (half), Important (outline), None. The most pressing
    tasks sort to the top of each section.
  * A date you type in a task (`due fri`) is shown dimmer in the task's text so you can see it was understood.
  * The strip down a task's left edge shows how soon it is due: **red** = due today or overdue, **yellow** = due
    tomorrow, grey = later or no date. Ticking a task takes its colour away.
  * The arrow at the right (or the task's text) opens the task out to show its details: where it lives, a link to its
    note, and all its dates and priority in one place.
  * A date word at the very end of a task counts as its due date, with or without "due" (`review this tomorrow`,
    `call mom on sun`). A start date still needs `starts`.
  * **Inside a note**, tasks look and work the same: the strip, the buttons and a small label with the dates, in the
    editor and in the read-only view of older notes. Tap a button for its menu; the change is saved into the note
    (in the editor it is one undoable edit). On a touch screen only buttons that hold something are shown; the
    toolbar's calendar button opens every option for the task under the cursor. With a mouse, empty buttons appear
    when you hover the task.
  * **Due, starts, hidden.** Type it in the task (`call dentist due fri`, `essay starts oct 12`, `due in 3 days`,
    `due 2026-11-01`) or pick it: the calendar button in the toolbar (caret in a task), or tap a task on the Tasks
    page. A picked date wins over a typed one. A task before its start date is under *Starts later* and a *hidden*
    task under *Hidden* (it stays in its note); both are folded away and not counted as to do.
  * Typed phrases are read when the list is built; your text is never rewritten. Words are resolved against the
    **note's** date, so `due fri` in Monday's note stays that Friday, and a weekday means the next one after the
    note's date (`due today` for the same day). Only the phrases listed here are understood; anything else is ignored.
* **Notes** (home page): every note in one list, most recently changed first. Search the words, filter by a tag
  (with or without its sub-tags) or by *No tag*, and tap a note to open it on its own page.
* **New note** (home, the Notes page, or *New note in "tag"* at the bottom of a stream): starts a free note on its own
  page. Nothing is created on the server until you type, so opening it and leaving leaves no trace. Free notes are
  not tied to a day: a tag can hold any number of them, even on the same day, next to its daily entry (marked
  *note* in a stream), and they can have no tag at all.
* **Names.** A free note has a title field at the top of its page ("Untitled" until you name it); a new note puts
  the cursor there first, and Enter moves on to the text. The name shows in streams and in the Notes list (search
  finds it too). A name alone is enough to create the note. Daily entries have no name: their date is their name.
* **Daily entry per tag.** Every tag starts as a daily stream: an entry for today waits at the top. For a topic you
  only write notes in (`trip/china`), untick *Show an entry for today* at the bottom of its stream and it shows just
  its notes. A tag first made by writing a free note starts with that off. Empty days are never saved (today's
  entry is created on your first keystroke), so there is nothing to archive.
* **Header trail.** In a stream the tag name is a trail: tap `school` in `school/fall26` to go up to it.
* **Tags** are edited right on the note's page: the chips show its tags, **×** removes one, **+** starts a
  sub-tag under it, and the box adds any tag (suggestions come from the tags you already have). A tag is a path:
  `school` is a tag, `school/fall26/math` is a sub-tag of it. You can tag a note before writing anything; the
  tags are sent with its first save. A note can have several tags and is one page whichever tag you open it through.
  Streams match the exact tag (`school` does not include `school/fall26`), but the Notes page can include sub-tags.
  The daily entry of a stream is still one per tag per day, and must keep at least one tag.
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
| `ASSISTANT_TOKEN` | *(off)* | a secret key (20+ characters) that lets an AI assistant add notes and tasks; see [docs/ASSISTANT.md](docs/ASSISTANT.md) |
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
* **Login is optional and off by default.** It assumes your VPN is the access control. A small password can be switched on in Settings → Password (see `docs/LOGIN.md`); you can also add basic auth at a reverse proxy.
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

Settings includes a shared home timezone selector for travel. Its SQLite override survives restarts and
backups; HOME_TZ supplies the initial default. Existing note dates are never relabelled. Other open devices
refresh configuration when focused or reopened.
Opening page is a separate device preference: choose Today, Notes, Tasks or People on each device.
It applies when opening the root address; explicit note links keep their destination.
Dismissed tasks are hidden from the note's writing surface and show an X in its history and on the Tasks
page. Bring them back before completing them. Completed tasks look like crossed-out bullets in the note.
Task history belongs to its source note and reads that note's task nodes; there is no copied task text.
The compact Add tag field offers up to six matching existing tags while focused. Select a suggestion,
then press Add; typing a new tag still works.
Natural date/time phrases and picked times use the home timezone. Task history has an inclusive range calendar with month navigation. See [Natural dates](docs/NATURAL-DATES.md) for examples, rules and limits.

For a child bullet or task, write a second item beneath its parent and use **Indent list item (→)** in the
formatting toolbar. **Outdent (←)** moves it back. With a physical keyboard, use Tab and Shift+Tab. Swipe
the toolbar sideways on narrow phones to reach additional controls. These use the engine's list commands.

Imported `[[Name]]` and `[[Name|alias]]` links open notes. In the editor, tap the ↗ beside a link; in a stream's
read-only note, tap the link text. Original Markdown text stays editable and unchanged. Resolution matches
the leaf title (case insensitive, optional `.md`); duplicates require choosing a note and missing targets
show an explanation. Navigation uses note IDs, but references are not yet permanently bound across renames.
Folder disambiguation, heading navigation and backlinks remain future work.

```
server/    HTTP API, SQLite store, backups, import/export, CLI      (Node built-ins only)
shared/    document format, tag rules, dates, ids (used by server and client)
client/    Preact app: sync engine (sync.js), IndexedDB store (pending.js), editor, views
tests/     server/ client/ e2e/
deploy/    CasaOS compose, Caddyfile example
docs/
```
