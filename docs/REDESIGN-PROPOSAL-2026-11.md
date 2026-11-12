# Redesign proposal: everyday flows (2026-11-11)

Status: **proposal; step 1 of Direction 2 is built as 0.17.0** (plain names link themselves, Today is one journal,
People today, Also today, tasks first on the phone; see `docs/RELEASE-NOTES.md`). Everything else here is still design
only. The first clickable sketch is `design/gordonite-workflows-prototype.html` (open it in a browser;
fictional content, saves nothing, sends nothing to Gordonite).

## Direction 2: write once (added later on 2026-11-11, preferred)

The owner's reaction to the first sketch: better, but still a lot to keep updated, people most of all; reviewing a day
is hard; the first sketch's capture sheet added more fields. A read-only look at real use since 2026-10-06 (through the
assistant bridge; patterns only, no note text is recorded here) says the same thing:

* Daily entries exist on about 15 of 37 days, split across three tags (five days have entries in two or three), and
  regular writing stops after Oct 22.
* 51 open tasks, 46 with no date, none with a project, person or waiting attribute. 29 came from one meeting's minutes,
  other people's action items included, and one of those was ticked.
* 61 people, filled by import. No conversation logged since Oct 18, while meeting minutes and daily entries keep naming
  people (one set of minutes names about 18).
* Meeting minutes are AI-written; the CSS transcripts are not stored in the app. The inbox tag has had nothing since
  Oct 12. Mood and habits were used for days, then dropped.

Conclusion: anything that needs separate upkeep is not kept up. Writing does happen. So the design should ask for
writing only and derive the rest. Sketch: `design/gordonite-write-once-prototype.html`.

**The model**

* **One thread.** Today is a single running page you write or dictate into, with one box and no kinds, fields or
  filing. (It is a view over the day's entries, as in direction 1.)
* **Links make themselves.** People's names, nicknames and project words in the text are linked as you write. No AI.
* **Pages are assembled, not maintained.** A person's page and a project's page are the same kind of page: a short
  card on top (person: where you met, last time, what to remember, what is open between you; project: next meeting,
  yours, others', decisions, people) and under it everything written that touches them. Writing on that page links to it
  without naming it.
* **Suggestions instead of forms.** What looks like a new person, a task, someone's promise or a fact to remember
  appears as a suggestion under the entry. One tap keeps it; ignoring it changes nothing.
* **Debrief.** One screen per day (or per transcript): who you saw and everything noticed, grouped, with Accept all.
  A meeting transcript is a long entry that goes through the same debrief (decisions, my tasks, others' promises, and
  "not sure" questions for unclear audio).
* **Three tabs:** Today, Tasks, Look up. Look up leads with "Met recently": each new face with the line written about
  them.

**What needs an AI.** Linking, the assembled pages and search do not. Spotting new people, tasks, promises and facts in
free writing, and reading transcripts, do. Three ways to supply it, not exclusive:

1. Simple built-in rules ("need to…", "met …", "… will …"): free, offline, misses odd phrasing.
2. The laptop assistant over the bridge, on request ("debrief my week"): works today inside the network rules.
3. The server asks an AI service itself when Debrief is tapped, so it works from the phone. This is an outgoing request
   only (no public endpoint, port forward or tunnel), but note text leaves the house and it costs per use. **It needs
   the owner's decision and is not assumed.**

**Decided 2026-11-11: laptop AI only.** The noticing is done by whichever assistant has the Gordonite bridge (Claude or
Codex) on the laptop, on request. The server makes no AI calls (option 3 is not built). On the phone, writing, linking,
the assembled pages and search work on their own; the simple built-in rules (option 1) may offer suggestions there, and
the fuller debrief waits for the next laptop session. The debrief tools must therefore be assistant-neutral: one call
to list what has not been debriefed yet, one to file suggestions against an entry, and the app shows them for
acceptance wherever it is opened.

The rest of this document (direction 1) still holds for the task sheet, owners, the meeting record and the AI rules;
the capture sheet, the five-tab shell and the separate project tabs are replaced by the model above.

## What was inspected

* The client shell and screens (`client/src/app.jsx`, `views/Today.jsx`, `Tasks.jsx`, `TaskSheet.jsx`, `Projects.jsx`,
  `Home.jsx`), the project rules (`shared/projects.js`, `docs/PROJECTS.md`), People, the MCP bridge (`mcp/server.js`,
  `docs/MCP.md`).
* The running app at phone width on the sample database (`npm run preview:local`): wrote a task in today's note, opened
  its details from the editor and from Tasks.
* The live server's structure through the assistant bridge (project list and tag list only; no note text was read).

## Findings

| Flow | What happens now | Why it is clumsy |
| --- | --- | --- |
| Opening on the phone | The Dashboard is six independent widgets. On a phone they stack: note, New note / Log skin, mood, habits, then tasks | Tasks, the thing wanted first, are last. Each widget is its own little app |
| Writing a daily note | "Today's note" is the entry of **one tag**, with a switch between starred tags. The live server's daily tag is `20-css`; `10-school` and `daily-jots` also have daily entries | One day is split across up to three notes. Choosing where to write comes before writing |
| Unfinished tasks | They already stay in their original note and keep showing in Tasks (nothing is copied) | This part works. But the Dashboard list is driven by due date, so an undated task from Monday is not visible on Wednesday's Dashboard |
| Capturing | New note asks for a tag first. A task is a line in a note plus the toolbar's task button. "Talked to X" is People → person → Log a conversation | Three different routes, none of them one tap from the home screen |
| A task row | Tick, text (tap edits it in place), hide, date, priority, arrow: six targets. At 375 px the words get about 110 px | Dense, and the largest target does the least expected thing |
| Opening a task | The arrow unfolds details **inside the list**: measured 1,727 px tall (over two screens) with 28 controls. Project and With come first, as dropdowns | The common change (move the date) is buried among rare ones (hide until, repeat, dismiss) |
| CSS as a project | **The live server has no CSS project.** Its only project is one named "Test". CSS is the "Club" *area folder* (`20-css`, about 65 notes in 13 sub-tags) | Projects were designed as things inside an area (an event, say). "CSS is one project" has nowhere to live, which is why it is hard to see how to use it |
| A project page | Waiting on, open tasks, notes, Add notes | No meetings, files, people, decisions or other people's commitments. Task rows link to the note, not to the task |
| Other people's commitments | A task can be "with" a person and "waiting for their reply" | There is no "this is theirs to do". Their items either sit in my lists or stay as prose in meeting notes |
| Meetings | A summary is an ordinary note under `20-css/meetings`; the transcript is another note or file | Nothing ties the two together, and uncertain transcription looks the same as fact |
| AI in a fresh chat | 55 tools, no starting point. The documented rule is "only write when the user requests it" | Every chat needs telling what to look up and reminding to save |
| Finding things | Notes search, People search, and Files (reached from Settings) are separate | No single search; nothing lists captures that were never filed |

Also noted: the bridge is a local program on a computer. Claude Desktop, Claude Code and Codex on the laptop can use it
at home or over WireGuard. AI apps on the phone cannot reach the server without a public address, which `AGENTS.md`
rules out. The proposal works inside that limit (see "AI collaboration").

## The proposed shape

Four places and one button, the same on phone and laptop:

**Today · Tasks · ( + ) · Projects · Find**

People, Notes, Tags and Files stop being top-level tabs. People are reached from a project, from Find, and from the
capture button; notes and files are found in their project or through Find. Tags stay underneath as the storage
structure, but are no longer something to manage day to day.

### Today: one page per day

* Top: pinned project (CSS) as a one-line strip: mine due this week, overdue from others, drafts to review.
* **Carried over**: open tasks that are overdue, or undated and written in the last few days, each marked "from Mon".
  The same task, shown again; not copied, date untouched.
* **Due today**, then **Today's page**: everything written today in time order, whichever project it is filed under.
  Typing continues at the bottom. Mood, habits and the skin log are one link away, unchanged.
* ‹ › steps through earlier days. An earlier page shows what was written and which of its tasks are still open.

How it maps to today's data: the page is a view over that day's daily entries across all tags. No migration; a line
"filed under CSS" is a line in the `20-css` entry for that day.

### Capture

One sheet from the + button or the bar above the tabs: a text box (the phone keyboard's own microphone does dictation;
the sheet says nothing about it), a three-way switch **Note / Task / Person**, and **File under**. Nothing is required
except words. Saved on the phone first, as now.

* **File under** is a search box over every project and section ("spon" finds CSS › Sponsors), with the pinned and
  last-used projects as one-tap shortcuts and "New project" when nothing matches. Left empty, the capture stays on
  today's page only.
* **Person** (revised 2026-11-11 after the owner's feedback) starts with a **Who** box that narrows as you type,
  matching names and "Also called" nicknames. Several people can be added. It covers four cases:
  1. **Someone I know:** pick them, write what it was about.
  2. **Someone new:** when nobody matches, "Add … as a new person" opens three fields: name, basic info, and
     **Met through** (another person search). Nothing else is needed to save.
  3. **A follow-up came out of it:** "+ Something to follow up" with **I will** (a task of mine, linked to them) or
     **They will** (their commitment, on their page and in the project).
  4. **Something to remember:** a loose fact about them (a like, a dislike, an allergy, a date), saved as written.

### Tasks

* A row is a tick and the task. Tapping the task opens one sheet: the words, **When** as one-tap choices, **Project**,
  **Who does it**. Start date, hide, priority, repeat, dismiss and delete stay available under **More**.
* **My tasks** lists only mine.

### Projects

* A project is a top-level folder of notes. **CSS adopts `20-css`**, so every existing note is in it at once; sub-tags
  (events, sponsors, marketing, finance…) become optional **sections** used as filters. The three fixed areas become a
  simple label (Club / School / Personal).
* Tabs: **Overview** (to review, next meeting, mine this week, others this week, decisions), **Tasks** (mine, then
  each person's commitments), **Meetings**, **Notes & files**, **People**.

### Responsibilities

A task gains one optional attribute, **owner** (a person). Owner empty = mine, and it behaves exactly as now. Owner set
= that person's commitment: it leaves My tasks and Today, and is listed in the project and on the person's page with
its due date. "Followed up" records the day I chased it; ticking it records they did it. Today shows one line when
something from others is overdue.

### Meetings

A meeting is a note with a small record beside it (the same pattern as People and Projects): date, who was there, the
transcript file, and a status. The page has two tabs, **Summary** and **Transcript**, so results and source stay
together. The summary has fixed parts: decisions, action items with an owner and date, and **To confirm**, where the AI
lists anything it could not hear or was unsure of instead of guessing.

### People

"Talked to Maya about…" is a capture kind (see Capture). It writes one line that appears on today's page and in the
person's log (the existing Log a conversation, reached in one step). A person's page leads with **We talked…** and
**Remember…**, then what is known about them, what they committed to and my tasks with them; the detailed profile
fields stay, to fill in later.

**Loose notes, tidied later.** Facts thrown in at random collect on the person's page as "Loose notes · unsorted".
**Tidy up** has the AI sort them under headings (Likes, Dislikes, Allergies, Dates, Other) as a draft: each line shows
its proposed heading, a tap changes it, and Accept files them into the **About** cards at the top of the page. This
follows the same draft-then-accept rule as everything else the AI writes, and the original lines stay in the note's
history. It runs when asked (from the page, or "tidy up my people notes" in an AI chat on the laptop); doing it on a
schedule is background AI processing, which is out of scope for now. The headings map onto the existing "Things to
remember" and labelled details, so no new storage is needed. Search finds people by these facts too.

### Find

One search over notes, tasks, people, meetings and files, matching words, a person's name, a project or a month.
**Unsorted captures** is a short review list: file under a project, make a task, or keep in the journal.

## AI collaboration: proposed rules

1. **One starting call.** A new `briefing` tool returns, in one answer: today's date, my tasks for the week, and per
   project the next meeting, others' commitments due or overdue, recent decisions and anything awaiting review. The
   bridge's own instructions tell the AI to call it first, so a fresh chat needs no pasted prompt.
2. **Drafts are saved without asking.** Meeting notes, agendas and suggested tasks are written as **Draft · from
   Claude**. Drafts are visible in the project under "To review" and are kept out of task lists and decisions.
3. **Accepted on my word.** A draft becomes real when I say so in the chat ("yes, that's right") or tap Accept in the
   app. On accept: my action items join my tasks, other people's join the project, decisions join the project's list.
4. **Corrections are proposals.** Changing something already accepted creates a draft correction. Accepting it marks
   the earlier decision "replaced" and keeps it; nothing is silently overwritten. Note history continues to keep every
   earlier version.
5. **Uncertainty is shown.** Unclear names, numbers and dates from a transcript go under "To confirm" until settled.

This replaces the current "only write when asked" rule for additive drafts only. Trash, deletes and edits to accepted
text keep today's confirmation rules.

On the phone, where AI apps cannot reach the server, a project offers **Copy briefing**: the same text, to paste into
any chat. Results come back through the existing share sheet or a later laptop session.

## What is reused and what changes

**Kept as is:** the note format, tasks living inside notes, saving (phone first, revisions, conflicts), offline copies,
history, trash, backups and export, natural dates, recurring tasks, the editor, files and attachments, the People
records, the share target, mood/habits/skin, login, the assistant API and bridge. No rewrite is recommended.

**Replaced (screens only):** the shell and tab bar, the Dashboard, the task row and details, the Projects screens, and
the Notes/Tags/Files/People entry points (folded into Projects and Find).

**Small additions to data:**

| Addition | Size |
| --- | --- |
| `owner` on a task | one optional attribute, like `project` and `person`; no document format change |
| Project sections; areas become a label | rules in `shared/projects.js`; CSS is created on `20-css` |
| Meeting record (date, attendees, transcript file, status) | one small table, a new schema version |
| Draft / accepted status and decisions list | part of the meeting record plus a small decisions table |
| `briefing`, draft and accept tools; bridge instructions | new assistant routes and bridge tools |
| One search endpoint across kinds | reuses the existing note, people and file queries |

## Suggested order

1. **Phone basics, no data changes:** new shell, Today page, capture sheet, task row and sheet. This is where most of
   the daily friction is.
2. **CSS as a project:** project on `20-css`, sections, the new project page, task owner and commitments.
3. **Meetings and AI:** meeting record, drafts and accept, `briefing`, bridge instructions, Copy briefing.
4. **Find:** one search and the Unsorted review.

Each step ships on its own with a version bump, release notes and a pre-update backup, as `AGENTS.md` requires.

## Out of scope for now

Archiving, new integrations, background AI processing, notifications, and any access from outside the home network and
WireGuard.

## Open choices

* Whether AI access from the laptop only is enough for now (the proposal assumes yes, with Copy briefing on the phone).
* Whether "carried over" should include undated tasks older than a few days (the sketch shows the last three days).
