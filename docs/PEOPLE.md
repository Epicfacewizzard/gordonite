# People

Since 0.10.0. A person is a page like in Notion: a photo (or coloured initials), their name, their groups, a block of
details, and the free-form note underneath. The People tab is the list of everyone, as cards or a table.

## What a person is

* **The note** is still the person's page: any note tagged `05-people` or a group under it (`05-people/css`,
  `05-people/nursing`, …). Its title is the name, its text is the notes about them, its tags are their **groups**.
  Nothing about existing people notes changed: they open as profiles with no details filled in yet.
* **The details** are a small record beside the note, on the server (table `people`, schema v9, `/api/people`), by
  note id. The note's text is never copied into it.

## Details

| Detail | What it holds |
| --- | --- |
| Photo | a picture from the phone (stored like any file; needs a connection to add). Without one: initials in a colour that stays the same for that name |
| Role | free text, e.g. "VP Events", "Clinical group" |
| Closeness | Close / Friendly / Acquaintance |
| Pronouns | free text |
| Birthday | month and day; the year is optional. Shows "turns 22 in 7 days" when the year is known |
| Last talked | the day of the last conversation in the note's Log, with what it was about; **Talked today** marks today without writing anything |
| Contact | phone, email, social or other; phone and email are tappable |
| How we met | a sentence and when (free text, e.g. "Fall 2024") |
| Also called | nicknames and other spellings; search finds them |
| Things to remember | short things to remember (likes, family names, …), shown as a list under the details |
| More details | your own labelled fields (Department, Major, Cohort, Grad year, Status, …) |

The page is laid out like the Personal CRM preview (branch `codex/personal-crm-preview`), without its follow-ups:
**Log a conversation**, then the details in two columns (tap one to change it), then Things to remember, then the note.
Last talked, Birthday and Closeness are always shown; other empty details wait behind **+ Add detail**. Groups are
changed with the tag controls under the name, as before.

## Log a conversation

**Log a conversation** asks when (up to today), how (Coffee, Call, Text, Email, In person) and what you talked about.
Saving writes one line at the top of the note's **Log** section, e.g. `Oct 15, 2026 · Coffee: Booth is confirmed`.
A note with no Log gets a "Log" heading at the end; a vault note with a "History" heading uses that (its
`2026-09-28: …` lines are read too). The note is the only copy: Last talked, and the line on the person's card in the
list ("Spoke today · Coffee: …"), are read from it, so changing or deleting a line in the note changes them. The line
goes in through the open editor, so it is saved like typing (offline too) and **Undo** takes it out.

## The People tab

* On a wide screen (900 px and up, in Cards), the list sits on the left and the open person on the right, as in the
  Personal CRM preview: tapping a card opens them there (`#/people/<id>`), with their details, Log a conversation and
  note; the list keeps its place. On a phone, a card opens the person's own page; a `#/people/<id>` link does the same.
* **Cards** or **Table** (remembered on each device). The table scrolls sideways inside its box on a phone; the name
  column stays put.
* Filter by **group** (from the tags) and by **closeness**; **Sort** by name, last talked (never or longest ago first),
  or next birthday.
* **Search** looks through names, details, groups and the note text.
* Each card shows the role, groups, closeness, birthday and when you last spoke, with what about.
* Birthdays in the next two weeks are listed at the top.
* **New person** starts a note in the group that is selected (or `05-people`).

## Offline

The list comes with a copy on the phone, so it opens with no connection. Changes to details wait in a queue on the
phone (`hq-people-pending`, the newest change per person) and are sent when the server can be reached; the page says
"Details waiting to be sent". A change the server refuses is shown with **Try again** and **Discard**. A person written
offline shows on their page at once and joins the list once their note reaches the server.

## Export, import, backups

The JSON export has a `people` list (`noteId`, `profile`). **Merge** import adds details for people who have none here
and never replaces details already here; **Replace** takes the export's. Backups and workspace bundles copy the
database, so they include details.

## Filling in details from the Obsidian vault (one time)

The vault's people notes had front matter (`birthday`, `role`, `aliases`, `department`, `major`, `cohort`, `grad_year`,
`status`, `contact`), which the original import dropped. `scripts/people-from-vault.js` reads it back:

```
node scripts/people-from-vault.js "<vault folder>" "<where to write the file>.json"
```

It reads `05 People` only, never writes to the vault and never talks to the server. Each file finds its note by the id
the vault import gave it (made from its path), so nothing is matched by name. Taken: birthday, role, aliases, contact,
and department / major / cohort / grad year / status as More details (an `unknown` status is skipped; `circle` is
already the group). Then on **Settings → Data & backups**, import the file with **Merge**. Keep the file out of the
repository and out of shared folders: it holds personal details.

## Code

`shared/people.js` (what a record may hold, wording, search, sorting), `server/people.js`, `server/routes/people.js`,
`client/src/people-data.js` (list + queue), `client/src/views/People.jsx`, `client/src/views/PersonProfile.jsx`,
`client/src/people.css`, `scripts/people-from-vault.js`. The note page adds the header and details through `NoteCard`'s
`aboveTitle` / `belowTags`. Tests: `tests/client/people.test.js`, `tests/server/people.test.js`, `tests/e2e/people.test.js`.

## Known limits

* A photo needs a connection to add (the file goes to the server); the rest works offline.
* The vault's overview page (`PRM`, tagged `05-people`) shows in the list like a person; take the tag off it, or
  leave it.
* The assistant (MCP) does not read or write details yet.
