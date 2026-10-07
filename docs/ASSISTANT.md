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
3. Keep the key private. It lets whoever has it add to and change your notes (it can edit text, but it cannot permanently delete anything; a trashed note stays recoverable for the retention period).
   To turn access off or change the key, remove or replace the setting and restart.

## What it can do

Send `Authorization: Bearer <key>` and, for POST, `Content-Type: application/json`.

| Request | What it does |
|---|---|
| `GET /api/assistant/ping` | Checks the key; returns today's date |
| `GET /api/assistant/overview` | Everything open right now, each with a `bucket`: overdue, today, upcoming (7 days), later, nodate |
| `GET /api/assistant/notes?q=&tag=&sub=1&limit=` | Find notes (title, preview, tags, id); `q` searches words and titles |
| `GET /api/assistant/notes/:id` | One note as Markdown, with its tags, revision and tasks |
| `POST /api/assistant/notes/:id/trash` `{ expectedRevision, confirmed:true }` | Move a specifically confirmed note to recoverable Trash; refuse if its revision changed |
| `POST /api/assistant/notes` `{ title, markdown, tags, date }` | New note (title, tags and date are optional) |
| `POST /api/assistant/notes/:id/append` `{ markdown }` | Add to the end of a note |
| `POST /api/assistant/notes/:id/replace-text` `{ expectedRevision, find, replace, all? }` | Change exact text inside one paragraph, heading or list item (plain text; must match once unless `all:true`; `replace:""` removes it) |
| `POST /api/assistant/notes/:id/replace-section` `{ expectedRevision, heading, markdown, includeHeading? }` | Rewrite the body under a heading (until the next heading of the same or higher level); `includeHeading:true` replaces the heading too, and empty `markdown` then removes the section |
| `POST /api/assistant/daily/append` `{ markdown, tag? }` | Add to today's entry (the tag Today shows, unless you name one) |
| `POST /api/assistant/notes/:id/tasks/:taskId` `{ checked?, due?, start?, hidden? }` | Tick, date or hide one task |
| `GET /api/assistant/moods?days=14` | Recent mood entries (1-5, note, time) with the streak (see MOOD.md) |
| `POST /api/assistant/moods` `{ score, note?, at? }` | Log a mood entry |

Example:

```bash
curl -s -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"title":"Call with Sam","tags":["people/sam"],"markdown":"## Summary\nWe agreed on the plan.\n\n## Actions\n- [ ] Send the deck due fri"}' \
  http://<server>:8080/api/assistant/notes
```

## Markdown it understands

Headings, paragraphs, **bold**, *italic*, bullet and numbered lists (nested by indent) and task lists (`- [ ]` / `- [x]`).
A due date typed in a task works exactly as in the app: `- [ ] send the deck due fri`, `due 2026-11-01`, `starts oct 12`
(relative words count from the note's date). Anything else (links, tables, code) is kept as plain text.

## Safety

* **Trash requires confirmation.** The MCP tool instructs the assistant to show the note and ask the human before calling. The API requires `confirmed:true` and the reviewed revision. This is a client assertion, not an independently verified human approval: use a trusted assistant client and keep its tool approvals enabled. No permanent purge tool is provided. Trash follows the configured retention period (30 days by default).
* **Earlier text is kept.** Before an append or an edit, the note's previous text is saved as a version (⋯ → History to restore).
* **Edits need the revision that was read.** `replace-text` and `replace-section` return 409 if the note changed since (for example you typed in it on your phone), 404 if the text or heading is not there, and 409 if it matches more than once. Tasks inside a replaced section become new tasks; tasks elsewhere keep their ids and dates.
* **It follows the app's rules.** If you are editing the same note on your phone while it adds something, your next save
  shows the usual conflict panel with both versions kept. Open notes show the addition after a reload.
* The key only protects `/api/assistant/...`. The rest of the app is as before: reachable from your home network and
  your VPN, with no login.
