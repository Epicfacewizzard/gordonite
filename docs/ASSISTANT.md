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
3. Keep the key private. It lets whoever has it add to and change your notes (it cannot delete anything).
   To turn access off or change the key, remove or replace the setting and restart.

## What it can do

Send `Authorization: Bearer <key>` and, for POST, `Content-Type: application/json`.

| Request | What it does |
|---|---|
| `GET /api/assistant/ping` | Checks the key; returns today's date |
| `GET /api/assistant/overview` | Everything open right now, each with a `bucket`: overdue, today, upcoming (7 days), later, nodate |
| `GET /api/assistant/notes?q=&tag=&sub=1&limit=` | Find notes (title, preview, tags, id); `q` searches words and titles |
| `GET /api/assistant/notes/:id` | One note as Markdown, with its tags, revision and tasks |
| `POST /api/assistant/notes` `{ title, markdown, tags, date }` | New note (title, tags and date are optional) |
| `POST /api/assistant/notes/:id/append` `{ markdown }` | Add to the end of a note |
| `POST /api/assistant/daily/append` `{ markdown, tag? }` | Add to today's entry (the tag Today shows, unless you name one) |
| `POST /api/assistant/notes/:id/tasks/:taskId` `{ checked?, due?, start?, hidden? }` | Tick, date or hide one task |

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

* **Nothing is deleted or replaced.** The assistant can only add to a note or change a task's tick, dates and hidden flag.
* **Earlier text is kept.** Before an append, the note's previous text is saved as a version (⋯ → History to restore).
* **It follows the app's rules.** If you are editing the same note on your phone while it adds something, your next save
  shows the usual conflict panel with both versions kept. Open notes show the addition after a reload.
* The key only protects `/api/assistant/...`. The rest of the app is as before: reachable from your home network and
  your VPN, with no login.
