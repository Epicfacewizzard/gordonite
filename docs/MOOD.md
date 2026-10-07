# Mood tracker

A dashboard widget for logging how you feel. It is not part of your notes: entries live in their own small table
(`mood_entries`, schema v5), so they never clutter a note and are quick to chart.

## What you see

- **Five faces** (1 very low to 5 great). One tap logs an entry with the current time. Log as often as you like.
- An optional **note** (one line, up to 280 characters): type it first, then tap a face. The field clears after a tap.
- **Today's entries** with the time, face and note, each with a delete (×).
- A small **7-day table**: one cell per day (weekday letter on top), tinted red to green and showing the face closest to that day's average; a dot means nothing was logged. Hover or long-press a cell for the exact average.
- A **streak** (days in a row with at least one entry; today not logged yet does not break it) and "N of the last 7 days".

The widget is a compact band across the top of the dashboard (faces and note on one side, the table on the other; stacked on a phone).

Show, hide and reorder the widget in Settings → Dashboard.

## Never losing a tap

A tap is stored on the phone (`hq-mood-pending` in local storage) before it is sent. Each entry has its own id, so
sending it twice is harmless. If the connection is down the entry shows "(not sent yet)" and goes up by itself when
the connection returns or the dashboard is opened again. Deleting an unsent entry just forgets it.

## Server

| Request | What it does |
|---|---|
| `GET /api/moods?from=&to=` | Entries between two days (default last 30), oldest first, with `streak` and `daysLogged` |
| `PUT /api/moods/:id` `{ score, note?, at? }` | Save one entry; the same id again changes nothing |
| `DELETE /api/moods/:id` | Soft delete (the row stays, with `deleted_at`); repeating it is fine |

- `at` is when it was logged (default now; not in the future). The entry's `day` is that moment in the **home timezone**, fixed when saved.
- Moods are in the **JSON export and import** (merge adds what is missing; replace takes the export as is) and in every database backup. The Markdown export does not include them.

## Assistant

With the assistant key set, `GET /api/assistant/moods?days=N` reads recent entries and `POST /api/assistant/moods`
`{ score, note?, at? }` logs one. The MCP bridge has the tools `get_moods` and `log_mood`. There is no assistant
delete. The assistant should log a mood only when you ask it to.
