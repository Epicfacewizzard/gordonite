# Working with no connection

Since 0.8.0, Gordonite is meant to be used on the go without WireGuard: jot things down, read what you looked at
recently, tick tasks; turn WireGuard on later and everything is sent. It needs the HTTPS address and the installed
app ([ANDROID-APP.md](ANDROID-APP.md)), which is what lets the app itself open offline.

## What works offline

| | Offline |
|---|---|
| Open the app | yes (the service worker's copy of the app) |
| Today's note on the Dashboard | yes, write in it. If the phone has never seen today's note, a new one is started on the phone |
| New note | yes |
| Notes list, a note on its own page, a tag's stream | what the phone kept (see below) |
| Task list, tick a task | the kept list; a tick is saved into the kept note and sent later |
| Search, a tag or page never opened, history, files, Trash, backups | no (needs the server) |
| Sharing text to Gordonite | yes; files wait until online ([ANDROID-APP.md](ANDROID-APP.md)) |

Everything written offline goes through the same save queue as always: held on the phone (yellow dot), sent when the
server answers, never lost by closing the app. **The app has to be open to send**: after turning WireGuard on, open
Gordonite once.

## The status dot

| Dot | Means |
|---|---|
| green | everything is on the server |
| yellow | something is held on the phone, waiting to be sent |
| red | a save failed or a conflict needs a look (the text is kept) |
| **grey ring** (new) | the server cannot be reached and nothing is waiting. Tap it to check again |

While the server is out of reach a line under the header says *"Offline: showing what this phone kept…"*.

## The phone's copy

`client/src/offline-copy.js`. Answers to the reads that screens are built from are kept in the phone's browser
storage (IndexedDB database `gordonite-copy`): settings, tags, the task list, the first page of each tag's stream that
was opened, Notes lists, and each note opened. `client/src/api.js` answers from it when the server does not answer,
**or has not answered within 3 seconds** (with WireGuard off on mobile data a request does not fail, it just hangs).
The server's answer still replaces the copy when it arrives.

While the server is in reach the app also fills the copy by itself (`client/src/warm.js`): when it opens, when it
comes back to the screen and when the server is back, at most every 10 minutes, one request at a time. It fetches
settings, tags, the task list, today's stream, the first page of the Notes list, and up to 80 notes: those holding an
open task and those on that first page. Kept answers not refreshed for 30 days are dropped.

`client/src/connection.js` tracks whether the server answers. While it does not, it asks `/api/health` every 15
seconds (a VPN turning on fires no browser event); when the server is back the save queue retries at once and the
Dashboard fetches again.

### Safety

* A copy is only ever read. Saves are checked against the note's revision on the server, so writing into an old copy
  gives the usual **conflict panel** (keep mine / use theirs / combine; the other version stays in History), never a
  silent overwrite. Typical case: today's note was written on the laptop after the phone last saw it, and the phone
  then wrote today's note offline.
* An older copy never replaces a newer version this phone already has open (`SyncManager.adopt`).

### Privacy

The copy holds note text. Anyone holding the **unlocked** phone can read it offline, even with a Gordonite password
set (the app does not wait for the login check when the server cannot be reached). The copy is deleted when you log
out and when the server says the login has run out, and **Settings → Offline copy on this device → Forget** deletes it
by hand. Forgetting it never touches what is waiting to be sent.

## Tests

`tests/e2e/offline-copy.test.js` (open online; go offline and reload: today's note, the Notes list, a note and the
task list from the copy, grey dot; write and tick offline; reconnect and check the server got both and no duplicates.
With an empty copy: today's note is still writable offline and created on reconnect. Settings → Forget),
`tests/client/offline-copy.test.js` (which reads are kept).

## Not done

* Search, history and files offline.
* Sending in the background with the app closed.
* Not yet tried on the real S24.
