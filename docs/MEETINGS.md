# Meetings and the one project page (0.22.0)

## A project over an existing tag

A project already records the tag whose notes are in it, and counts that tag **and every tag under it** (`shared/projects.js`
`tagInProject`). Creating a project with an existing tag (the **Existing tag** box on *New project*, which now suggests your
tags, or `create_project` with `tag`) only stores that tag's id: **no note is moved, retagged or re-saved** (a test checks
revisions and tags before and after). So the club can be one project over `20-css` and its sub-tags (events, sponsors,
finance, meetings…); the sub-tags simply stay as they are.

The project page (Look up → Projects → the project) is now one place for:

| Section | Comes from |
| --- | --- |
| Waiting on / Waiting on others / Open tasks | tasks in the project's notes: the owner's own, replies awaited, and other people's commitments ([PROJECTS.md](PROJECTS.md)) |
| **Meetings** | the `meetings` records whose minutes note is in the project: date, attendees, commitments (open of total), a link to the transcript and its source |
| **People** | people on the project's tasks (with or owning) and the attendees of its meetings |
| **Files** | files in the project's notes (up to 100) |
| Notes | every note with the tag or a sub-tag |

Nothing on the page is copied; it is read from the notes (files and meetings from the server, so those two sections are
empty while out of reach).

## Meetings

*New meeting* on a project page makes, in one step:

* the **minutes** note (title = the meeting): **Attendees** (as `[[links]]`), **Minutes**, **Commitments** (tasks; a line that
  starts with an attendee's name, as in `Sam: send the budget by Friday`, is that person's task via `owner`, a written date is
  carried; any other line is the owner's own), and **Transcript** with where it came from and a link;
* the **transcript** note, titled `Transcript: <title>`: first a line `Source: <where it came from> · saved <date>. Kept as
  pasted and not edited.`, then the pasted text, one paragraph per line. A transcript **must** say where it came from. The
  transcript is made outside Gordonite (another app); Gordonite stores it and never rewrites or summarises it;
* a row in `meetings` (schema **v13**): minutes note id, transcript note id, day, source, attendees (People note ids).

Both notes carry the project's tag (new notes; nothing existing is touched). They are ordinary notes: history, backups,
search and `[[links]]` work as for any note. Making a meeting needs the server (two notes and the record are made together).
API: `POST /api/meetings`, `GET /api/meetings?tag=`. Code: `shared/meetings.js`, `server/meetings.js`,
`client/src/views/MeetingForm.jsx`. Tests: `tests/server/meetings.test.js`, `tests/e2e/meetings.test.js`.

**Not built:** an assistant tool for filing minutes from a transcript (the proposal's *draft, then accept* meeting flow), a
Summary / Transcript tab view on the note, editing a meeting's attendees afterwards, and offline creation.

Since 0.22.1 a meeting is made in one transaction (all or nothing) and the JSON export and import carry the `meetings` records.
