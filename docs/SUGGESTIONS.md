# Suggestions (0.19.0)

As the owner writes in today's journal on **Today**, simple built-in rules notice things and offer a one-tap choice under
the entry. No AI, no network: the rules are pure functions in `shared/suggestions.js` (tests: `tests/client/suggestions.test.js`),
so they work on the phone and offline. **Nothing changes unless a button is tapped.**

| Offered | When | Tapping it |
| --- | --- | --- |
| **Make this a task** | a plain paragraph says "need to", "have to", "got to", "gotta", "must", "remind me", "remember to", "don't forget" or "by Friday" (also "by tomorrow", "by EOD"). Questions, denials ("don't need to") and lines under 8 characters are skipped | The paragraph becomes a checkbox task, its words and bold/italic kept. A date written in it ("by Friday", "due Oct 12") is carried as the task's own due date, read by the existing date parser (`shared/taskdates.js`) |
| **Add *Name* as a person** | a capitalised name that matches nobody in People, when it follows a cue ("met", "with", "told", "asked", "emailed"…), is followed by one ("Priya said", "Priya will"), or is two or three capitalised words in mid-sentence ("Priya Rao"). Days, months, sentence starters and a name that is already a person (full name, nickname, unique first name) are skipped | A new note named as written is created in `05-people` (saved on the phone first like any note), and the name links itself once the people list has it (plain-name linking, [LINKS.md](LINKS.md)) |

Only top-level paragraphs are read: lines that are already tasks, headings, list items and files are left alone, and so are
names inside `[[ ]]`. A line that mentions a known person and a commitment of theirs ("Sam will send the budget") is not
suggested in 0.19.0; 0.21.0 adds it (see [RELEASE-NOTES.md](RELEASE-NOTES.md)).

**Dismissing.** *Dismiss* hides that suggestion for that line. This is remembered on the device (`localStorage`, key
`hq-suggestions-dismissed`, a hash of the line, never its text), so it works offline. If the line is rewritten into
something else the suggestion can come back. A person added from a suggestion is also remembered
(`hq-suggestions-people-added`) so the name is not offered again before the people list has them.

**Timing.** Suggestions appear about a second after typing stops, so they are not offered mid-sentence. At most four are
shown; the rest wait in the Debrief (0.20.0).

**Known limits.** Dismissals are per device (a phone and a laptop each remember their own). The rules read English only and
miss odd phrasing by design; fuller noticing is the laptop assistant's job, on request ([MCP.md](MCP.md)).

## Code

`shared/suggestions.js` (rules, `makeLineATask`) · `client/src/views/Suggestions.jsx` (the list under the entry, accepting) ·
`client/src/editor/suggestion-ops.js` (the undoable editor edit) · `client/src/suggestion-store.js` (dismissals).
