# Mood tracker

A dashboard widget for logging how you feel. It is not part of your notes: entries live in their own small table
(`mood_entries`, schema v5), so they never clutter a note and are quick to chart.

## What you see

- **Five faces** (1 very low to 5 great), and nothing else at first.
- **Tap a face** to pick it (it highlights; tap it again to put it away). A **Note** box and a **Log** button then appear.
  The note is optional (one line, up to 280 characters). Nothing is saved until you tap **Log** (or press Enter in the
  box); the entry gets the current time. The box then closes and "Logged 🙂" shows for a few seconds. Log as often as you like.

It starts in the right-hand column of the dashboard, above Tasks, and can be moved to any column or across the top (Settings → Dashboard).

### Settings for this band (Settings → Dashboard, per device)

- **Ask for a note before logging** (on by default). Off: one tap on a face logs it straight away, with no note.
- **Show mood history** (off by default): the three parts below.

Both live in one list, `MOOD_OPTIONS` in `client/src/prefs.js`; a new option is one more line there and a check in `Mood.jsx`.

### History

These parts are built but off by default; nothing about the data changes (entries are still saved and exported). Turn them on
in **Settings → Dashboard → Mood band on this device → Show mood history**. Each choice is kept per device (a phone and a
computer can differ).

- **Today's entries** with the time, face and note, each with a delete (×). While this is hidden there is no way to delete
  an entry from the screen (the server still supports it).
- A small **7-day table**: one cell per day (weekday letter on top), tinted red to green and showing the face closest to that day's average; a dot means nothing was logged. Hover or long-press a cell for the exact average.
- A **streak** (days in a row with at least one entry; today not logged yet does not break it) and "N of the last 7 days".

Show, hide and reorder the widget in Settings → Dashboard.

## Never losing a tap

A tap is stored on the phone (`hq-mood-pending` in local storage) before it is sent. Each entry has its own id, so
sending it twice is harmless. If the connection is down the widget says "Not sent yet" (the entry list that used to show "(not sent yet)" is part of the hidden history) and the entry goes up by itself when
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
