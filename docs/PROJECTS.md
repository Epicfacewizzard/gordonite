# Projects and Waiting on

Since 0.15.0 (schema v11). Group notes and tasks under **Personal**, **School** or **Club** projects, link a task to a
person, and mark it **waiting for their reply**. It reuses what was already there: tags decide which notes are in a
project, People notes are the people, and everything about a task stays an attribute of the task in its note.

## What a project is

* A small record (table `projects`, `/api/projects`): name, **area** (personal, school, club), **status** (active,
  done, archived), the **tag** whose notes belong to it (held by tag id, so renaming or moving the tag keeps the project)
  and an optional **overview note** (an ordinary note, linked from the project's page).
* **A note is in a project when it carries the project's tag or a tag under it.** Nothing is guessed from titles and no
  existing folder becomes a project by itself. Where two projects match, the one with the more specific tag wins.
* **A task is in its note's project** unless it names one of its own (`project`), which is how a task in a daily jot
  joins a project. A removed project is ignored; the task falls back to its note's.
* Removing a project is soft (**Remove project** on its page; it can be listed and restored through the API and the
  assistant). Its tag and notes stay.

## Tasks: three optional attributes

| Attribute | Meaning |
| --- | --- |
| `project` | a project id: the task's own project instead of its note's |
| `person` | a People note id: who the task is with. Shown as an **@Name** chip; the task text never changes |
| `waitingSince` | a day (YYYY-MM-DD): the task is waiting for that person's reply since then. Needs a person |

They are optional node attributes (no document format bump; empty ones are not stored), validated in
`shared/doc.js`, carried by `shared/tasks.js` into the task list rows, and kept by the editor. Waiting is independent of
due and start dates. Done and dismissed tasks are never "waiting". No notifications and no messages are sent.

## Screens

* **Projects** tab (`#/projects`): the three areas with their projects, each with open tasks, how many are waiting and
  how many notes. **New project**: a name, an area, and optionally an existing tag (its notes join at once); with none,
  a tag is made from the name under the area's folder. Archived projects are hidden until **Show archived**.
* **Project page** (`#/projects/<id>`): **Waiting on** (longest first), open tasks (done ones behind a link), the
  project's notes, **Add notes** (search, then Add: the note gets the project's tag; a daily entry that would clash with
  that tag's entry for the day is reported instead), status and area.
* **Tasks**: a **Waiting on** section (longest first, below Due today; a waiting task that is overdue or due today stays
  in those sections), and chips on every task row: "waiting 5 days", **@Person**, project name. In a task's details (and
  the editor's task sheet): **Project**, **With** (a person), **Waiting for their reply** with a **Since** day and
  **Got a reply**, which ends the waiting and keeps the link. Taking the person off also ends the waiting.
* **A person's page**: **Tasks with them**, the waiting ones first.

## Assigning what already exists

* From a tag you already use (for example `20-css/chinatown`): create the project with that tag.
* Notes elsewhere: **Add notes** on the project page (or `add_notes_to_project`). It adds the project's tag; note text is
  not changed.
* One task: its **Project** field.
* Area folders (where a new project's tag is made when none is given) default to `30-personal`, `10-school` and
  `20-css`; `PUT /api/projects/folders` changes them (no screen for it yet).

## Offline, export, backups

The projects list has a copy on the phone, so the Projects tab and the chips open offline; task changes are saved like
any task change. **Creating or editing a project needs a connection** (it may make a tag). The JSON export has a
`projects` list (and `projectAreaFolders` under settings); **Merge** import adds projects that are missing, mapping
their tag, and never changes one already here; **Replace** takes the export's. Backups copy the database, so they include
projects. Going back below 0.15.0 needs the pre-update backup (schema v11).

## For agents

`update_task` takes `project` (id or null), `person` (People noteId or null; null also ends waiting) and `waiting`
(true = since today, or since `waitingSince`; false = replied). New tools: `list_projects`, `get_project`,
`create_project`, `update_project` (including `removed`), `add_notes_to_project`, `list_waiting`; `get_person` also lists
the tasks with that person. See [MCP.md](MCP.md).

## Code

`shared/projects.js` (rules), `server/projects.js`, `server/routes/projects.js`, `client/src/projects-data.js`,
`client/src/views/Projects.jsx`, `TaskChips.jsx`, `PersonTasks.jsx`, the fields in `TaskSheet.jsx`, the Waiting on bucket in
`client/src/task-groups.js`. Tests: `tests/server/projects.test.js`, `tests/server/mcp-projects.test.js`,
`tests/e2e/projects.test.js`.

## Known limits

* Membership is by tag: a note in two projects' tags counts for the more specific one. A project has no separate list.
* No screen yet for the area folders, for restoring a removed project, or for choosing a different tag after creating it
  (the assistant can: `update_project`).
* A person removed from People shows as "someone removed" on their tasks until the note is restored.

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
