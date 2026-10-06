# Gordonite natural dates and times

Try the local browser simulator at http://127.0.0.1:8093/ while its preview runs. It uses the application parser and never edits notes.

## Write a scheduled task

Write your paragraph or bullet, then convert it with Task. Your words remain unchanged. Recognition does not interrupt typing with popups.

For a note dated **Monday, October 5, 2026**:

| Task words | Due | Starts |
| --- | --- | --- |
| Email Kelvin at 6pm tmr | October 6 at 18:00 | — |
| Email Kelvin tmr at 6pm | October 6 at 18:00 | — |
| Poster starts oct 7 at 9am due fri at 6pm | October 9 at 18:00 | October 7 at 09:00 |
| Email sponsor next week | October 12 | — |
| Call at noon | October 5 at 12:00 | — |
| Essay due oct 12, 2027 | October 12, 2027 | — |
| Pay rent due in 3 days | October 8 | — |

Times use the **home timezone in Settings**, initially America/Edmonton. Optional HH:mm attributes are stored alongside calendar dates in the original task node. Changing the home timezone retains that date and wall-clock time, interpreted in the new zone. Completion/dismissal timestamps remain UTC instants. During daylight-saving clock repetition the task view follows the current wall clock, so a local time can occur twice. There are no reminders, notifications, alarms, recurrence or automatic emails.

## Supported patterns

- today; tomorrow, tmr, tmrw
- weekdays, full or abbreviated, with optional “next”
- next week = seven days later; next month/year = same day next month/year, clamped to its last day if necessary
- in N days or weeks (up to three digits)
- oct 12, October 12th, 12 oct; optional four-digit year, including oct 12, 2027
- ISO dates: 2026-10-12
- times: 6pm, 6:30 pm, 18:30, noon, midnight; optional “at”

Use **due** for a due date and **start**, **starts** or **starting** for a start date. Optional “on” works: `due on Friday`. A date at the end counts as due without a keyword, optionally preceded by “by” or “on”. An adjacent time may come before or after it. A time without a date uses the note date: `Call at 6pm`. A start time needs its keyword: `Call starts at 6pm`.

This is a deterministic grammar: it recognizes date/time components and combines them. It does not store whole example sentences or ask AI to guess. Unsupported wording stays ordinary text. Bare `6` or `at 6` is ambiguous and ignored; use am/pm or HH:mm. “Next” alone, “next weekend”, slash dates, timezone abbreviations and “in two hours” are unsupported. Invalid dates/times such as February 30 and 25:00 are ignored. Check the interpreted values in Task details.

## Anchors, year and overrides

Relative dates use the **note date**, not today or the time of conversion. Tomorrow in an October 5 note means October 6 forever. Midnight does not move an existing note. A time alone does not roll forward if already past.

A weekday means its next occurrence strictly after the note date. On Friday, `due fri` means the following Friday; use `due today` for the same day. `next Friday` means the same upcoming Friday as `Friday`.

You usually do not need a year. Month/day means this year, or next year if already past. Explicit years are honored, including past ones. Next month/year clamps dates such as January 31 to February's last day.

The first recognized due expression and first start expression win. Picked dates and times override their corresponding typed values independently. Clearing a picked value falls back to the words; remove the scheduling words too if you want no schedule.

## Task list behavior

- Before its start date/time, a task is in Starts later.
- After its due date/time, it is Overdue. At the exact due minute it is still Due today.
- Date-only tasks become overdue the next day; they have no implicit morning deadline.
- Due today and future dates appear under Due today and Upcoming respectively.
- Undated tasks appear once their start date/time arrives.
- Completed/dismissed tasks leave the open sections and stay in their original note document.

The list checks the clock every 15 seconds and when the page becomes visible. Priority still sorts first; clock time breaks ties within a day, with date-only tasks after timed tasks. Device clock accuracy matters. Inline task colors continue to indicate the due day.

## Task history calendar

Expand Task history in the originating note and tap its range button. Tap a start and end day; the inclusive range works in either order. Month arrows navigate other months. Highlighted days show the range. From/Through inputs allow direct entry. All dates removes the filter. Escape or Done closes the picker; Show older tasks extends the range automatically.

History dates use completion/dismissal timestamps converted to your home timezone. Imported tasks with no timestamp remain under Date not recorded. The filter does not move or duplicate tasks.

## Simulator and verification

Change task words, note date, viewing date/time, or picked due date to see recognized words, effective schedule and task section. The simulator uses the explicit dates and home-zone wall clock you choose; it changes no app settings.

Automated checks cover parsing, invalid inputs, timezone clock comparisons, time persistence, export/import restoration, task list transitions and calendar interaction. Actual S24 keyboard behavior still needs real-device testing.

## Correcting completion or dismissal dates

Hover over a history row to reveal its left grip; touch screens show it directly. Drag the grip to reveal the preceding two weeks of day headings and drop on a day. This corrects the recorded completion/dismissal day rather than reordering or moving note text. The range expands to include the corrected date.

Tap the grip for a date input instead: this works with a phone or keyboard and reaches any older date. Future dates are refused. The original home-zone clock time is retained, including seconds; imported tasks with no recorded time use noon. If that clock time does not exist on the chosen day because of a daylight-saving jump, the app explains the problem instead of guessing. Undo reverses the date correction in the open editor. Updates use the same pending-phone save and conflict protection as other note edits.

Desktop drag-and-drop is checked in Chromium; actual S24 touch dragging is not validated. Use the tap-to-pick control on a phone.
