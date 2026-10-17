# Habits

Since 0.9.0. Layout and behaviour follow the habit tracker beta test on branch `codex/habit-tracker-beta-test`
(widget, week grid, streaks, schedule editor); unlike that preview, habits are kept on the server, so they sync between
devices, are in backups and the JSON export, and work offline through a queue. The beta's sample data, browser-only
storage and JSON backup box are not carried over.

Since 0.11.0 a habit has more options. Which ones, and how they behave, was chosen from the open-source
[Loop Habit Tracker](https://github.com/iSoron/uhabits) (GPL-3.0). Only its features and behaviour were used as a
reference; **no code was taken from it**, so its licence does not apply to Gordonite. The score is Gordonite's own
running average, not Loop's formula.

## Using it

* **Dashboard → Habits** widget: today's habits. A yes-or-no habit has a checkbox; a number habit has a button
  showing today's number (tap to enter it). Each row shows the question (or course, or goal), "1 of 3 this week" for
  a habit counted per week or month, and the reminder time. Rows with a reminder time come first, earliest first.
  Show, hide or move the widget in Settings → Dashboard.
  **‹ day ›** above the list steps back to log a past day (tap the day for a calendar; **Today** comes back). The
  list then shows that day's habits and ticks, numbers and "1 of 3 this week" for that day. It never goes past today.
* **History & manage** (`#/habits`): today / this week so far / longest current streak; each habit's week with a square
  per day (tap to tick or untick a yes-or-no habit, or to enter a number; past days can be filled in, future and
  not-due days cannot); previous weeks with ‹. Under each week: the streak, the score and the period's progress.
  **↑ / ↓** move a habit up or down (the Dashboard follows the same order). **Archived (n)** at the bottom lists
  archived habits with **Unarchive**.
* **The habit's own page** (tap its name; `#/habits/<id>`): score, current streak, best streak, days done, and a month
  calendar (‹ › for other months). Tapping any past day there opens it: **Done** / the number, **Skip day**, **Clear**.
* **Started on** (in the editor) is the habit's first day: streaks, the score and "every N days" periods count from
  it. It is today for a new habit and can be set to any earlier day.
* **New habit** / **⋯** (the editor):
  * **Habit** name, **Question** ("Did you stretch today?", shown on the Dashboard), **Small goal or notes**.
  * **Type**: *Yes or no*, or *A number* with a target per day: *at least* or *at most* N, and a unit
    ("at least 8 glasses", "at most 2 cups").
  * **How often**: *on chosen days of the week* (as before), *N times a week* (Monday to Sunday), *N times a month*,
    or *once every N days* (counted from the day the habit was made).
  * **Colour** (eight, or the app's default): the card's edge, done squares and the Dashboard checkbox.
  * **Reminder time**: shown on the Dashboard and orders it. **There are no notifications yet** (a web app on the
    phone cannot reliably ring at a time; this waits for the Android shell, `docs/ANDROID-SHELL-PLAN.md`).
  * **Archive** hides the habit from the Dashboard and the list but keeps everything; **Delete habit** asks first.

### Backdating (0.13.0)

Any past day the app has loaded (the last 400 days) can be ticked, given a number, skipped or cleared, from the
Dashboard's ‹ day ›, the week squares on `#/habits` or the habit's month calendar. Future days cannot (the screen
disables them and the server refuses them). Streaks, best streak, the score, totals and "N of M this week" are worked
out from the check-ins each time the screen draws, so a backdated day counts at once.

* **Before the habit's start:** those days show as dotted squares ("before the start"), and on the Dashboard a habit
  made later is listed for a past day with "before its start". Logging such a day moves the habit's start back to it
  (the app saves the habit with the new `created`, then the check-in), so the days between count as missed until they
  are filled in or skipped. Clearing that day later does not move the start forward again; use **Started on**. A week
  square on `#/habits` opens the day instead of ticking it straight away, so the note about the start is seen.
* **Course habits** are still due only during a course: days outside one stay "not due".
* **Older than 400 days:** the app does not load those check-ins, so ‹ stops there (the Dashboard, the week and the
  month arrows) and such days are disabled. Agents can still tick them with `tick_habit`.
* **Offline:** a backdated change goes through the same queue as today's (`hq-habit-pending`) and is sent when the
  connection is back.

### How days count

* A **number habit** is done on a day when the number reaches the target (or, for *at most*, stays at or under it).
  A number short of the target shows in the square in the habit's colour, but is not done. The target is per day,
  also for habits counted per week or month (a week of "3 times a week" needs three days that reached it).
* A **skipped day** (ill, away) is neither done nor missed: it never breaks a streak, and in a week, month or N-day
  habit it stands in for one of the times. It shows as ↷.
* **Streaks** count due days in a row for weekday habits (days it is not due and skipped days are passed over), and
  whole weeks, months or N-day periods that reached their target for the others. An unfinished today (or this week,
  month, period) does not break it.
* A **week / month / N-day habit** is on the Dashboard every day until the period's target is reached; after that only
  on the days it was done (so a tick stays where it was made).
* **Score** (0–100 %): a running average of the due days (or periods) so far, in which recent ones weigh most. A done
  day pulls it up, a missed one down, each by about half over four weeks' worth of chances; skipped days leave it as it
  is. A long run is not lost to one bad day, and a few good days do not make a strong habit.
* The app loads the last 400 days of check-ins, so streaks, best streak, totals and the score cover that long.

## Courses from the skin log

In the habit editor, tick **Start from the skin log**, choose the product (from the skin log's list) and how many days:
"When I log **Betaderm**, keep this going for **7** days."

* The habit is due only while a course runs (and on its chosen weekdays). A course habit always uses chosen weekdays
  (not N times a week); the server refuses the combination.
* Logging that product in the skin log starts a course on the entry's day, or extends the one running (or just
  finished) to 7 days from then. That day is ticked automatically (`source: skin`).
* The Dashboard shows "Betaderm course · until Oct 21"; before any course, "Starts when you log Betaderm".
* This runs on the server when the skin entry arrives, so it works from any device; an entry logged offline starts the
  course once it is sent.

## Storage

Tables `habits` and `habit_checks` (schema v8, extended in **v10**); `/api/habits?from&to` (list, at most 400 days of
check-ins), `PUT/DELETE /api/habits/:id`, `PUT/DELETE /api/habits/:id/checks/:date`. A future day cannot be ticked.
Deleting a habit is soft.

* `habits.options` (JSON, v10): `freq` (`{type:'days'}`, `{type:'week'|'month', times}`, `{type:'every', n}`), `kind`
  (`yesno` | `number`), `unit`, `target`, `targetType` (`atLeast` | `atMost`), `color` (a key of `COLORS` in
  `shared/habits.js`, or null), `question`, `reminder` (`HH:MM` or null), `archived`. The API and the JSON export show
  them as fields of the habit. Rows from before v10 have `{}`: a yes-or-no habit on its weekdays.
* `habit_checks.value` (the number entered) and `habit_checks.skip` (1 = skipped day), v10.
  `PUT …/checks/:date` with `{ value, skip }` replaces what the day had; with an empty body (an older app, the skin log)
  it ticks the day and keeps an existing check-in as it is.
* A save that leaves out an option (an app older than 0.11.0 still open on a phone) keeps what the habit had, as
  editing on the phone already never sends a habit's courses.
* Archived habits are still listed by the API, marked `archived: true`; the app keeps them out of the Dashboard and
  the week list.
* Order is each habit's `sort`; ↑ / ↓ renumber the list in tens and save the habits whose number changed.

On the phone, changes wait in `hq-habit-pending` (`client/src/record-queue.js`, shared with the skin log) and show at
once; the list is also kept in the offline copy. A change the server has taken stays on screen until a list asked for
after it comes from the server itself (0.10.2): a slow list is answered from the phone copy, which was kept before the
change.

## Code and tests

`shared/habits.js` (due days, periods, streaks, best streak, score, week progress, courses), `client/src/habit-data.js`,
`client/src/views/Habits.jsx`, `client/src/habits.css`, `server/habits.js`, `server/routes/habits.js`. Tests:
`tests/client/habits.test.js`, `tests/server/habits.test.js`, `tests/e2e/skin-habits.test.js` (the "habit options"
group covers number habits, frequency, colour, reminder, the habit page, skipping, reordering and archiving; the
"backdating habits" group covers the Dashboard's ‹ day ›, days before the start and a past day logged offline), and the
Dashboard layout in `tests/e2e/today.test.js`.

## Not done

Notifications for the reminder time; a course shortened when a skin entry is deleted; a habit's own page beyond 400
days of history; charts other than the month calendar (Loop's bar and frequency charts); CSV export (the JSON export
has everything).
