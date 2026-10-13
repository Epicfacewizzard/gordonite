# Undo and getting things back

What can be undone, how far back, and where the button is. There are four layers; each catches what the one above
it cannot.

## 1. Undo while a note is open

The **↶ / ↷** buttons in the toolbar, or Ctrl/Cmd+Z and Ctrl+Y.

* It reaches back **100 to 120 steps** (the editor keeps 100 and trims the oldest in batches of about 20).
* Typing with no pause longer than half a second is **one** step; a pause starts the next one.
* It covers everything done in the note: typing, formatting, ticking, dismissing, moving and deleting tasks, setting
  dates, and adding or taking out files (a batch of files is one step).
* **It is gone when you leave:** opening another note in a stream, leaving the page, or reloading starts that
  note's undo list afresh. Layer 2 is for that.

## 2. History (note menu ⋯ → History)

Every note keeps its own earlier versions, so the text can come back even after the editor's undo is gone.

* The newest **100** versions are kept per note.
* A version is saved when you edit, at most every **5 minutes**, and also extra ones at the moments that matter:
  just before a task is deleted, when the text shrinks sharply, before a restore, and before an assistant edit.
  An import never overwrites a note: a different imported text is kept as a version instead.
* **Restore this version** puts it back, and keeps the text you are replacing as a version too, so a restore can
  itself be undone.
* A version made by a conflict (two devices wrote at once) or an import is never pruned.

## 3. Trash (Settings → Trash)

Deleting a note moves it to the Trash with its full text and History. It stays there for **30 days**
(`TRASH_RETENTION_DAYS`; `0` keeps them for ever) and **Restore** brings it back to the tags it was in (if a daily
note for one of those tags and days has been written since, it says so and offers to restore without that tag).
After that it is removed for good.

## 4. Backups

The server takes a verified snapshot of the whole database every 6 hours and keeps the newest few, one per day for
two weeks, and one per week for two months. Restoring one is a server command (see
[BACKUPS.md](BACKUPS.md)), so this is the last resort rather than an undo button. A "replace everything" import
takes a backup of the current data first.

## Specific things

| You deleted | How to get it back |
|---|---|
| Text in a note | Undo (layer 1), or History (layer 2) |
| A task (Task details → Delete task…, which asks first) | Undo while the note is open; or History (a version is always saved first) |
| A task you *dismissed* (not deleted) | Tasks → Dismissed → Bring back; or the note's Task history |
| A file taken out of a note (the ×) | Undo while the note is open; the file itself was never deleted and is still on the Files page |
| A file **removed on the Files page** (asks first) | **Undo** right after, or Files → *Show removed files* → **Bring back**, with no time limit (removed files are hidden, never erased) |
| A mood entry (×) | **Undo** on the Mood box for 15 seconds after |
| A whole note | Trash (layer 3), 30 days |
| A tag taken off a note | Add it again from the note's tags; nothing else changed |

## What cannot be undone

* A note that stayed in the Trash for more than 30 days.
* A brand-new note that was never saved (the menu says **Discard note**): it only ever existed on that phone.
* Versions older than the newest 100 of a note.
* A mood entry after its 15-second Undo (it is hidden, not erased, but there is no button for it).
* Anything the server's backups no longer cover (older than the retention above).
