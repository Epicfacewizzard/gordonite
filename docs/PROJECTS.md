# Proposed Projects foundation

This is a design proposal, not a shipped feature. Keep the UI replaceable.

## Example workflow

Club > Snack Olympics > project overview and connected notes.

The venue task stays in the planning note. It references Sarah's existing People note by ID and can be
marked Waiting on. Sarah's People view and the project's waiting filter show that same task, with a link
back to its note. Editing or finishing it changes the original task; no text is copied into another store.

## Modest first version

- Personal, School and Club are explicit project areas, not three separate databases.
- A project has a stable ID, an area and an ordinary editable overview note. Related notes retain their
  own IDs and can be connected to projects through memberships; avoid guessing project membership from
  words in titles or importing every existing folder as a project automatically.
- Inline task attributes reference a project ID and one People note ID, plus a Waiting on boolean. A
  person chooser searches existing People notes; selecting it can display an @name chip without depending
  on typed names or changing the task text.
- Waiting on describes the next action's dependency. It is independent of due/start dates. Completed and
  dismissed tasks are excluded from open waiting views; no automatic email sending or notifications.
- Projects and People derive task lists from original note documents. The source note remains the
  authority for updates, revision conflicts, task history and undo.
- Persist memberships and project metadata in SQLite. New node attributes and relational references need
  export/import, deleted-person/project handling, backup restoration and conflict tests before deployment.

## Current date behavior

The actual parser is shared/taskdates.js. Relative phrases use the note's date, not the day the task is
viewed. Explicit manually picked dates override typed phrases. Text is never rewritten.

Recognised: today, tomorrow/tmr/tmrw, weekday names, in N days/weeks, month plus day, ISO dates; explicit
due and start/starts/starting keywords, and a due expression at the end of a task. The first recognised
phrase of each kind wins. A weekday always means its next occurrence; next Friday and Friday currently
have the same meaning. Month/day without a year uses this year or next year if already past.

Not recognised as scheduling: clock times, reminders, recurring tasks, next week, numeric slash dates,
arbitrary sentences. For a note dated 2026-10-05, Email Kelvin at 6pm tmr is due 2026-10-06 but has no
scheduled hour. Email Kelvin tmr at 6pm has no due date, because tmr is not at the end; due tmr at 6pm
does recognise the date because it has an explicit due keyword.
