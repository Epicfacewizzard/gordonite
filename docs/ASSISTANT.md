# Letting the assistant add and edit things

A small, separate door into the app (`/api/assistant/...`) for an AI assistant (Claude) to read notes and to add
notes and tasks, for example turning a pasted meeting transcript into a summary note plus tasks.

It is **off** until you give the server a secret key. Without the key the door does not exist (404). With it, every
request must send the key, and anything on your network that does not have it is refused.

## Turn it on

1. Make a key (any 20+ character secret works; this makes a good one and does not store it anywhere):
   ```bash
   node server/cli.js token
   ```
2. Give it to the server as the setting `ASSISTANT_TOKEN`:
   * local dev: `ASSISTANT_TOKEN=<key> npm run dev` (PowerShell: `$env:ASSISTANT_TOKEN="<key>"; npm run dev`)
   * Docker / CasaOS: add `ASSISTANT_TOKEN: "<key>"` under `environment:` in the compose file, then recreate the container.
3. Keep the key private. It lets whoever has it read and change your notes, tasks, tags, moods, habits, skin log and
   People details (it cannot permanently delete anything; a trashed note stays recoverable for the retention period).
   To turn access off or change the key, remove or replace the setting and restart.

## What it can do

Send `Authorization: Bearer <key>` and, for POST, `Content-Type: application/json`.

| Request | What it does |
|---|---|
| `GET /api/assistant/ping` | Checks the key; returns today's date, the time zone, the daily tag and the server version |
| `GET /api/assistant/overview` | Everything open right now, each with a `bucket`: overdue, today, upcoming (7 days), later, nodate |
| `GET /api/assistant/notes?q=&tag=&sub=1&limit=` | Find notes (title, preview, tags, id); `q` searches words and titles |
| `GET /api/assistant/notes/:id` | One note as Markdown, with its tags, revision and tasks |
| `POST /api/assistant/notes/:id/trash` `{ expectedRevision, confirmed:true }` | Move a specifically confirmed note to recoverable Trash; refuse if its revision changed |
| `POST /api/assistant/notes` `{ title, markdown, tags, date }` | New note (title, tags and date are optional) |
| `POST /api/assistant/notes/:id/append` `{ markdown }` | Add to the end of a note |
| `POST /api/assistant/notes/:id/replace-text` `{ expectedRevision, find, replace, all? }` | Change exact text inside one paragraph, heading or list item (plain text; must match once unless `all:true`; `replace:""` removes it) |
| `POST /api/assistant/notes/:id/replace-section` `{ expectedRevision, heading, markdown, includeHeading? }` | Rewrite the body under a heading (until the next heading of the same or higher level); `includeHeading:true` replaces the heading too, and empty `markdown` then removes the section |
| `POST /api/assistant/daily/append` `{ markdown, tag? }` | Add to today's entry (the tag Today shows, unless you name one) |
| `POST /api/assistant/notes/:id/tasks/:taskId` `{ text?, checked?, due?, start?, dueTime?, startTime?, hidden?, hideUntil?, priority? }` | Change one task: its words, tick, dates, hiding or priority (only the fields sent change; `null` clears one) |

Editing (0.11.0). Every change to a note goes through the same save as the app (revisions, conflicts, History);
records (moods, habits, skin entries, people details) use the same functions as the app's own routes.

| Request | What it does |
|---|---|
| `PUT /api/assistant/notes/:id/title` `{ title }` | Rename a free note (`""` removes the title; daily entries have none) |
| `POST /api/assistant/notes/:id/tags` `{ tag }` / `POST .../tags/remove` `{ tag }` | Add or take off one tag |
| `POST /api/assistant/notes/:id/rewrite` `{ expectedRevision, markdown }` | Replace the whole text (see "Rewriting a note" below) |
| `GET /api/assistant/notes/:id/versions`, `GET .../versions/:vid`, `POST .../versions/:vid/restore` | History: list, read one as Markdown, put one back (the text now is kept first) |
| `GET /api/assistant/trash`, `POST /api/assistant/notes/:id/restore` `{ dropConflictingTags? }` | Notes in Trash; take one back out |
| `DELETE /api/assistant/notes/:id/tasks/:taskId` | Remove one task (and what is nested under it); the note before is in History |
| `POST /api/assistant/notes/:id/tasks/:taskId/move` `{ toNoteId }` | Move a task, unchanged, to the end of another note's task list |
| `GET /api/assistant/tags` | Every tag (count, last date, star, daily) and the dashboard's daily tag |
| `POST /api/assistant/tags/move` `{ tag, name?, into? }` | Rename a tag (`name`, the last part) and/or move it under `into` (`""` = top), with everything under it |
| `PUT /api/assistant/tags/flags` `{ tag, favorite?, daily? }` | Star a tag, turn its daily entry on or off |
| `PUT /api/assistant/settings` `{ dailyTag }` | The tag Today / the Dashboard writes in |
| `PUT /api/assistant/moods/:id` `{ score?, note?, at? }`, `DELETE .../moods/:id`, `POST .../moods/:id/restore` | Change, delete (soft) or bring back a mood entry; a change returns the entry as it was |
| `GET /api/assistant/habits?from=&to=`, `POST /api/assistant/habits` `{ name, detail?, days?, …options }` | Habits with their ticks; add one (`days` 0 = Sunday … 6, every day if left out). Options as in the app (docs/HABITS.md): `freq`, `kind`, `target`, `unit`, `targetType`, `color`, `question`, `reminder`, `archived` |
| `PUT /api/assistant/habits/:id` `{ name?, detail?, days?, sort?, …options? }`, `DELETE .../habits/:id` | Change some fields (a deleted habit comes back); delete (soft, ticks kept) |
| `POST /api/assistant/habits/:id/checks` `{ done, date?, value?, skip? }` | Tick or untick a day (today if left out; not the future); `value` is the number for a number habit, `skip` marks the day skipped |
| `GET /api/assistant/skin?from=&to=`, `POST /api/assistant/skin` `{ date?, time?, data }` | Skin log entries; add one: the line is written into that month's skin log note, as the Skin screen does |
| `PUT /api/assistant/skin/:id` `{ date?, time?, data? }`, `DELETE .../skin/:id` | Change picks (each field given replaces that pick) and rewrite the line; delete the entry and its line |
| `GET /api/assistant/people`, `GET .../people/:noteId` | People (no note text in the list) and one person's details |
| `PUT /api/assistant/people/:noteId` `{ profile }` | Change some details (each field given replaces that field; returns the details as they were) |
| `POST /api/assistant/people/:noteId/log` `{ text, how?, date? }` | Add a conversation to the top of the Log in the person's note |

### Rewriting a note

`rewrite` takes the Markdown `GET /notes/:id` gave, edited. A task line keeps its task (id, completion time, priority,
hiding) when its words are unchanged; its tick and the dates shown after it (`- [ ] Call Sam (due 2026-10-20 at
09:30)`, `(start …)`) are read back as the picked dates, so removing `(due …)` clears the date. A line whose words
changed, or a new one, is a new task; task lines left out are removed. Sending back exactly what was read changes
nothing. Only what the Markdown can say survives: headings up to `###`, bold and italic, bullet and task lists, files;
anything else the note has not got anyway.

### Errors

Every refusal is `{ error: { code, message } }` with a message that says what to do next, and the MCP bridge passes
the message on (before 0.11.0 it replaced 404s such as `task_not_found` with "check the note ID"). A 404 with code
`not_found` and message `No such endpoint` means this route is not on the server: the server is older than the
bridge (`ping` shows its version) or the key is not set.
| `GET /api/assistant/moods?days=14` | Recent mood entries (1-5, note, time) with the streak (see MOOD.md) |
| `POST /api/assistant/moods` `{ score, note?, at? }` | Log a mood entry |
| `GET /api/assistant/attachments`, `GET .../attachments/:id`, `GET .../attachments/:id/content` | List, describe and read stored files (photos, PDFs, documents; see ATTACHMENTS.md) |
| `POST /api/assistant/attachments` `{ name, data, noteId? }` | Store a file (`data` is base64) |
| `POST /api/assistant/notes/:id/attach` `{ attachmentId }` | Put a stored file at the end of a note |

Example:

```bash
curl -s -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"title":"Call with Sam","tags":["people/sam"],"markdown":"## Summary\nWe agreed on the plan.\n\n## Actions\n- [ ] Send the deck due fri"}' \
  http://<server>:8080/api/assistant/notes
```

## Markdown it understands

Headings, paragraphs, **bold**, *italic*, bullet and numbered lists (nested by indent) and task lists (`- [ ]` / `- [x]`).
A due date typed in a task works exactly as in the app: `- [ ] send the deck due fri`, `due 2026-11-01`, `starts oct 12`
(relative words count from the note's date). A stored file is a line of its own: `![name](gordonite-file:ID)` for an
image or `[name](gordonite-file:ID)` for anything else, where `ID` is the file's id; reading a note shows its files
this way and writing such a line places the file. Anything else (links, tables, code) is kept as plain text.

## Safety

* **Trash requires confirmation.** The MCP tool instructs the assistant to show the note and ask the human before calling. The API requires `confirmed:true` and the reviewed revision. This is a client assertion, not an independently verified human approval: use a trusted assistant client and keep its tool approvals enabled. No permanent purge tool is provided. Trash follows the configured retention period (30 days by default).
* **Earlier text is kept.** Before an append or an edit, the note's previous text is saved as a version (⋯ → History to restore, or `restore_version`). Deleting a task, moving one, rewriting a note and changing a skin log line all keep one too.
* **Nothing is deleted for good.** Moods, habits and skin entries are deleted softly: `restore_mood`, `edit_habit` on the habit's id, or logging the returned entry again bring them back. A change to a mood, habit or person's details returns what it was before.
* **Edits need the revision that was read.** `replace-text`, `replace-section` and `rewrite` return 409 if the note changed since (for example you typed in it on your phone), 404 if the text or heading is not there, and 409 if it matches more than once (`replace-section` takes `occurrence` to pick a heading). `replace-text` tries text copied with Markdown symbols once without them. Tasks inside a replaced section become new tasks; tasks elsewhere keep their ids and dates.
* **Records have no revision.** A change to a mood, habit, skin entry, tag or person's details is applied to what is saved at that moment, as the app's own saves are; the phone's queue may send its own later change after it.
* **It follows the app's rules.** If you are editing the same note on your phone while it adds something, your next save
  shows the usual conflict panel with both versions kept. Open notes show the addition after a reload.
* The key only protects `/api/assistant/...`. The rest of the app is as before: reachable from your home network and
  your VPN, with no login.
