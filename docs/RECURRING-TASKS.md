# Recurring tasks

Added in 0.14.0. For bills, assignments and routine admin: a task repeats, keeps a history of every time it was done,
and counts its next date from its **scheduled date** or from the day it was **done**. No schema change: everything lives
on the task inside its note.

## The rule

A task has an optional `repeat` rule: `{ every: 1-365, unit: day | week | month | year, days?: [0-6], day?: 1-31, from: due | done }`.

- **days** (weekly only, 0 = Sunday): "weekly on Mon and Thu", "every weekday", "every 2 weeks on Mon".
- **day**: the day of the month a monthly or yearly task belongs on, so a task due on the 31st falls on Feb 28 (29 in
  a leap year) and goes back to Mar 31. Set automatically from the due date when a rule counted from the due date is picked.
- **from `due`** (default): the next date counts from the due date the task had (rent, a bill). It moves on **one step**,
  even if that is still in the past: paying September's bill in October leaves October's owed. A task with no due date
  counts from the day it was done.
- **from `done`**: the next date counts from the day it was ticked **in the home timezone** (America/Edmonton unless
  changed in Settings), e.g. "water plants every 3 days".

Yearly on Feb 29 falls on Feb 28 in a non-leap year and returns to Feb 29. All of this is calendar arithmetic on
`YYYY-MM-DD` strings (`shared/repeat.js`), so the device's own timezone never matters; only "the day it was done" uses the
home timezone.

## Ticking

Ticking a repeating task does **not** complete it. In the same change (one undo step in the editor):

1. it stays unticked and its `due` moves to the next date; a start date moves by the same gap, `hideUntil` is cleared;
2. an entry `{ at, due, skipped?, prev }` is appended to its `completions` (newest last, at most 500; only the latest
   keeps `prev`, which is what **Undo last completion** puts back).

**Skip this one** moves it on the same way but records `skipped: true`. A dismissed task is never moved on.
The rules live in one place, `patchedTaskAttrs` in `shared/tasks.js`; the Tasks list, the open note's checkbox
(`client/src/editor/task-history.js`) and the assistant all use it (`tests/client/task-parity.test.js`).

## Setting it

- **Task details** (the chevron on the Tasks page, or the toolbar's task details in a note): a **Repeat** section with quick
  choices (Daily, Weekdays, Weekly on the due weekday, Every 2 weeks, Monthly, Yearly), **Custom…** (every N units, chosen weekdays),
  "From the scheduled date" / "From the day it is done", and **Stop repeating**. The due-date menu has a **Repeat…** row.
- **Typed in the words**, like dates (your words are never rewritten; a picked rule wins): `every day`, `daily`, `every week`,
  `weekly`, `every 2 weeks`, `every other week`, `fortnightly`, `every mon and thu`, `every Monday, Wednesday & Friday`,
  `every weekday`, `every month`, `monthly`, `every year`, `yearly`, `annually`, `every 3 days`. Add `from done`, `after completion`
  or `after finishing` to count from the day it is done. A repeat phrase is not read as a date ("every mon" does not make the task due Monday).

## Where it shows

- Tasks list and dashboard box: a "↻ every 2 weeks" chip next to the due date. After ticking, a notice says "Done: … Next due …" with **Undo**.
- Task details: the full history (date done, the due date it was for, "2 days late", skipped) with **Skip this one** and **Undo last completion**.
- The Tasks page's **Done** list and the note's **Task history** list each recorded completion as its own read-only entry
  (the task itself stays open in its note); the date-range filter applies.
- The note editor's small label says "repeats weekly".

## Assistant (MCP)

`update_task` takes `repeat` (a rule, or `null` to stop), `skip: true` and `undoCompletion: true`; `checked: true` on a
repeating task records a completion and moves it on. `get_note` tasks and `overview` carry `repeat`, `repeatFrom`
(`set` or `text`) and `completions`.

## Known limits

- No end date or "repeat N times", no reminders or notifications.
- Only the latest completion can be undone with the button; older ones can be removed only by editing the note's document.
- Older app versions show a repeating task as an ordinary task (the new attributes are ignored but kept).
- Tasks typed with a repeat phrase move on when ticked even though no rule was picked; the rule is read from the words each time.
