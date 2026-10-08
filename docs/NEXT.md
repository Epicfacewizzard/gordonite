# Next steps

The current UX/UI is provisional. Keep working features and reliable storage separate from presentation so
a future redesign can replace the interface without changing note documents.

- Home timezone is now editable in Settings, persisted in SQLite, and included in backups/export.
  America/Edmonton (or HOME_TZ) is the initial default. Verify manual travel changes on real devices.
- Verify crossing midnight on the actual S24, both while typing and while idle. Automated checks cover
  keeping active writing on the original date and offering the next day's entry separately.
- Basic [[links]] now open matching notes through their stable IDs, preserving original text. Names with
  duplicates show a choice, missing names show an explanation, and aliases label the editor's open button.
  Future work: bind references permanently across title changes, precise vault folder matching, heading
  anchors, and backlinks. Folder-qualified links currently resolve the leaf title; no match is guessed.
- Continue improving People cards as views over ordinary notes. Structured contacts and relationship
  metadata need a separate design decision; avoid a duplicate copy of note contents.
- A small optional login now exists (Settings → Password, `docs/LOGIN.md`); the fuller version below is still open if this becomes a private diary: one owner account, salted password hash,
  server sessions, login throttling, CSRF protection, logout and local administrator recovery. Protect all
  note/export/backup endpoints. Keep separately authenticated MCP access. Use HTTPS over LAN/WireGuard;
  no public exposure or port forwarding. Pending phone edits must survive logout/session expiry and must
  not be shown on a logged-out screen. Consider shared-device local-data clearing separately.
- Settings now allows an opening tab per device. User prefers a custom phone dashboard later, after the
  useful features are established. Mood tracking is a possible future feature, not current scope. Keep
  layout replaceable and do not build the dashboard yet.
- User's next project direction: separate Personal, School and Club areas; project pages connected to
  existing notes and inline tasks, plus stable People-note references and a Waiting on flag. Before
  implementing, keep task text in its original document and distinguish waiting from completion/dismissal.
  Suggested first workflow: Club > event project > venue/poster/sponsor tasks > linked People and waiting
  filter. Natural dates now recognise dates and home-timezone clock times (see NATURAL-DATES.md); notifications and recurrence remain outside scope.
- Task presentation implemented after the project/date discussion: completed tasks become crossed-out
  bullet-like rows in the note and appear in its Completed history. Dismissed tasks are hidden from the
  writing surface and shown in that note's history. Simplify history to date-grouped rows and compact date
  controls, without graphs or scores. Preserve original document nodes, IDs, undo and recovery; do not
  physically move task text into a separate table. The editor moves a selection out of a newly hidden
  task and supplies a writing paragraph when nothing visible remains. Verify these transitions on S24.

- Future Today direction: replace Today with the user's customizable Dashboard. Reuse note/task views as widgets; widgets may vary by date or context. Design remains open; build it after the desired features are established.
