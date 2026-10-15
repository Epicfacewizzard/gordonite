# Skin log

Since 0.9.0. A quick, structured entry for skin care, picked like a charting flowsheet, written into a monthly note.
Open it from **Log skin** on the Dashboard, the long-press shortcut on the installed app icon, or `#/skin`.

## Making an entry

1. **Date and time** start at now (**Now** resets them; change them for a late entry).
2. Tap chips. Everyday words are shown first; **More…** shows clinical terms (pruritus, erythema, xerosis,
   excoriation, lichenification, antecubital fossa, popliteal fossa, …). **+** adds your own (kept on that device).
   * **Skin**: symptoms, with **Severity** once one is picked.
   * **Where**: areas. Each picked area that can have one gets its own row: **L / R / Both** (side) and **Ant / Post**
     (aspect), only where they make sense (legs and arms both, behind knees a side only, neck an aspect only, face and
     forehead neither). Tap again to clear.
   * **Applied**, **Response**, **Possible trigger**, and an optional **Comment**.
3. The line it will write is shown as you go, e.g.
   `2100: Itch on left posterior legs and neck. Betaderm applied on left posterior legs and neck.`
4. **Add to skin log**. **Same as last time** (and **Use again** on the last three) fills in an earlier entry's picks
   with the time now.

## Where it goes

* **The note**: one per month, "Skin log · October 2026", tag `skin`. Each day is a heading (`10/14`, newest day first)
  with that day's entries as bullets in time order. It is an ordinary note: read, search and edit it as usual.
* **The record**: the same entry as data (what was picked), on the server (`skin_entries`, `/api/skin`). This is what
  makes editing, reassessing and habit courses work. It is in the JSON export and in backups.

Both work offline. The note line goes through the usual save queue; the record waits in a queue on the phone
(`hq-skin-pending`) and is sent when the server can be reached. A waiting entry says "waiting to be sent".

## Editing, reassessing, deleting

**Recent entries** (last 30 days) are listed under the form.

* **Edit**: the form comes back with what was picked and the original date and time. **Save changes** replaces the
  line in the note (moving it if the date changed). The entry's reassessments are listed with **Remove**.
  **Delete entry** takes the line out of the note too.
* **Reassess**: asks only **Response**, **Skin now** (with severity) and a comment; where and what was applied are the
  entry's own. It is added to the end of the same line: `… Reassessed at 2145: partial relief, mild itch.` (On another
  day: `Reassessed at 10/15 0700: …`.) Reassess again to add another.

If the line was changed by hand in the note, Edit cannot find it to replace: the new line is added and the screen says
to check the note.

## Habit courses

A habit can be started by a product in the skin log: see [HABITS.md](HABITS.md). Logging (or editing) an entry with
that product starts or extends the course and ticks the habit for that day. Deleting the entry does not shorten it.

## Code

`shared/skin.js` (wording, where a line goes, reassessments), `client/src/skin-log.js` (month notes, the queue, pick
lists, recent picks), `client/src/views/Skin.jsx`, `server/skin.js`, `server/routes/skin.js`, schema v7.
Tests: `tests/client/skin.test.js`, `tests/server/skin.test.js`, `tests/e2e/skin-habits.test.js`.
