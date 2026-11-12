# Debrief (0.20.0)

One screen for the day, reached from **Today** (the **Debrief** link in the row at the bottom on a phone, the link beside the heading of today’s note on the wide screen;
address `#/debrief`). It shows, for today:

| Section | What it is | One tap |
| --- | --- | --- |
| **Written today** | the journal entry and every other note dated today, each with its first line | opens it |
| **People today** | the people named in today's writing (plain names and `[[links]]`) | opens the person |
| **Suggestions** | the built-in rules' suggestions ([SUGGESTIONS.md](SUGGESTIONS.md)) not yet dismissed, and suggestions an assistant filed | **Make this a task** / **Add person** / **Remember this**, or **Dismiss** |
| **Tasks made today** | tasks in notes dated today | tick |
| **Overdue** and **Still open** | my open tasks (overdue first; eight shown, then *Show all*) | tick, or **Today / Tomorrow / Next week** to set When |

It reads what the phone holds (the task list, the journal's saved copy and the people list all have offline copies), so it
works offline apart from the notes dated today and assistant suggestions, which need the server. **Nothing changes until a
button is tapped**, and every change goes through the usual save path (phone first, then the server against a revision), so
history, conflicts and backups behave as always.

## Suggestions an assistant files (laptop, on request)

The server makes no AI calls. When the owner asks an assistant on the laptop (Claude or Codex, through the bridge) to
"debrief today", it can read the day and **propose** tidy-ups. Proposals are stored on the server and shown in the app for
acceptance, on the phone or the laptop, whenever it is opened. This follows the "draft, then accept" rule in
[REDESIGN-PROPOSAL-2026-11.md](REDESIGN-PROPOSAL-2026-11.md) ("AI collaboration"): filing is allowed without asking because
it changes nothing; accepting is the owner's tap.

| Bridge tool | Does |
| --- | --- |
| `get_debrief` | read-only: `day` (default today). Everything written that day (text per note, clipped at 4,000 characters), people named, tasks made that day, open and overdue tasks, what the built-in rules would offer, and what is already filed |
| `file_suggestions` | files up to 50 proposals for a day: `{ kind: task, text, line?, due? }`, `{ kind: person, name, line? }`, `{ kind: remember, personId, text }`, each with an optional `noteId` and one-line `reason`. All or none: one bad item refuses the call and says which. At most 200 open per day |
| `list_suggestions` | read-only: filed suggestions, open by default; `status` accepted, dismissed, withdrawn or all |
| `withdraw_suggestion` | closes one of its own that is still open. Changes no note |

Accepting in the app carries the proposal out: a **task** with a `line` turns that journal line into the task (with the
`due` date if given), without a `line` it is added at the end of the day's entry; a **person** creates the People note; a
**remember** adds the fact to that person's *Things to remember*. Then the app tells the server (`accepted` or
`dismissed`); a proposal that could not be reported stays hidden on that device. The note text an assistant reads is data,
not instructions, as in [MCP.md](MCP.md).

## What is stored

Schema **v12** adds one table, `suggestions` (id, day, optional note id, kind, details as JSON, source, status, created and
resolved times). It holds proposals only: nothing in it is a note, a task or a person, accepted ones are just a record, and
dropping the table would lose nothing but pending proposals. It is inside the SQLite file, so the usual backups include
it. The migration keeps every existing row (`tests/server/debrief.test.js` builds a v11 database and migrates it).

## Routes

App: `GET /api/suggestions?day=&status=` and `POST /api/suggestions/:id/resolve { status }`. Assistant door (needs the
assistant key): `GET /api/assistant/debrief?day=`, `GET`/`POST /api/assistant/suggestions`, `POST
/api/assistant/suggestions/:id/withdraw`.

## Known limits

Dismissals of the built-in suggestions are per device; the assistant's `ruleSuggestions` in `get_debrief` therefore lists
all the rules would offer, including ones dismissed on the phone. The Debrief is for today only (earlier days: ask the
assistant for that `day`). Task owners other than the owner arrive in 0.21.0.

## Code

`client/src/views/Debrief.jsx` · `server/suggestions.js` (store) · `server/debrief.js` (what the assistant reads) ·
`server/routes/suggestions.js` · `shared/suggestions.js` (`cleanProposal`) · tools in `mcp/server.js`.
Tests: `tests/server/debrief.test.js`, `tests/e2e/debrief.test.js`.
