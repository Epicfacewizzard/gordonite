# Habits

Since 0.9.0. Layout and behaviour follow the habit tracker beta test on branch `codex/habit-tracker-beta-test`
(widget, week grid, streaks, schedule editor); unlike that preview, habits are kept on the server, so they sync between
devices, are in backups and the JSON export, and work offline through a queue. The beta's sample data, browser-only
storage and JSON backup box are not carried over.

## Using it

* **Dashboard → Habits** widget: today's due habits with checkboxes. Show, hide or move it in Settings → Dashboard.
* **History & manage** (`#/habits`): today / this week so far / longest current streak; each habit's week with a square
  per day (tap to tick or untick; past days can be filled in, future and not-due days cannot); previous weeks with ‹.
* **New habit** / **⋯**: name, small goal, which weekdays. **Delete habit** asks first.
* Streaks count due days in a row; days it is not due are skipped; an unfinished today does not break the streak.

## Courses from the skin log

In the habit editor, tick **Start from the skin log**, choose the product (from the skin log's list) and how many days:
"When I log **Betaderm**, keep this going for **7** days."

* The habit is due only while a course runs (and on its chosen weekdays).
* Logging that product in the skin log starts a course on the entry's day, or extends the one running (or just
  finished) to 7 days from then. That day is ticked automatically (`source: skin`).
* The Dashboard shows "Betaderm course · until Oct 21"; before any course, "Starts when you log Betaderm".
* This runs on the server when the skin entry arrives, so it works from any device; an entry logged offline starts the
  course once it is sent.

## Storage

Tables `habits` and `habit_checks` (schema v8); `/api/habits` (list with check-ins of the last 120 days), `PUT/DELETE
/api/habits/:id`, `PUT/DELETE /api/habits/:id/checks/:date`. A future day cannot be ticked. Deleting a habit is soft.
Editing a habit on the phone never sends its courses, so a course just extended by a skin entry is not overwritten.

On the phone, changes wait in `hq-habit-pending` (`client/src/record-queue.js`, shared with the skin log) and show at
once; the list is also kept in the offline copy.

## Code and tests

`shared/habits.js` (due days, streaks, week progress, courses), `client/src/habit-data.js`, `client/src/views/Habits.jsx`,
`client/src/habits.css`, `server/habits.js`, `server/routes/habits.js`. Tests: `tests/client/habits.test.js`,
`tests/server/habits.test.js`, `tests/e2e/skin-habits.test.js`, and the Dashboard layout in `tests/e2e/today.test.js`.

## Not done

Reminders or notifications; archiving a habit; reordering habits; a course shortened when a skin entry is deleted.
