# Local habit preview

This is the actual Gordonite 0.8.1 client/server source at 2aa20c3 with a local habit experiment added, identified as 0.8.2-habits-preview.1. It lives in an independent checkout outside the shared Gordonite directory. The Git branch is `codex/habit-tracker-beta-test`, titled **Habit tracker beta test**. It has not been deployed. The other session's skin/design documentation is untouched.

Open http://127.0.0.1:8094/#/ for the Dashboard, then Habits → History & manage, or go directly to http://127.0.0.1:8094/#/habits.

## Start or restart

From this preview checkout, run:

```powershell
npm run build
node scripts/preview-habits.js
```

The server binds only to 127.0.0.1:8094. Stop a foreground run with Ctrl+C. The initially opened preview runs as a hidden background Node process; find only the process whose command line is `scripts/preview-habits.js` before stopping it. An occupied port causes startup to fail without stopping another service. No firewall, VPN, tunnel, public endpoint, or startup registration was added.

Dependencies currently reuse the already-installed packages via a local node_modules junction to the original Gordonite checkout. No package installation was performed through that junction. If that checkout is moved, recreate this preview's dependencies separately; do not run package installation through the junction, because that would modify the shared dependencies.

## What to try

- The Dashboard retains its real note editor, Mood widget, Tasks widget, tab bar, settings and responsive layout. All app operations target the preview's own SQLite database in `data/habits-preview`.
- Check a habit on the Dashboard, open History & manage, and see the same check-in. Reload to verify it persists. The global app save indicator still refers to notes; the Habits widget separately labels its browser storage.
- Add a habit, choose weekdays or individual days, and edit through its three-dot button. Delete requires confirmation. New habits begin today. Past check-ins can be corrected from the start date through today; future and unscheduled days are disabled.
- Weekly percentage counts Monday through today, excluding future and unscheduled days. Streaks count consecutive scheduled days, skip rest days, and allow today's unfinished check-in.
- The Habits widget uses the existing Settings → Dashboard controls for visibility, placement and order.
- Expand Sample data & backups to copy JSON, restore by pasting JSON, or Start fresh. Replacement and clearing require confirmation. Invalid JSON or malformed records do not replace habits.

## Storage and limitations

The preview notes database is independent of all normal local and remote databases. Only fictional notes were seeded. Assistant access is disabled by the explicit preview configuration.

Habits live in browser storage at this exact origin under `gordonite-habits-preview-v1`. They are not saved in SQLite, included in Gordonite's normal note/database backups, or synced between devices. A separate browser/profile or switching between localhost and 127.0.0.1 has separate habits. The older standalone HTML experiment also uses a separate key and is not automatically imported.

Copy the JSON text from Show backup into a plain text .json file to keep it. Restore by pasting that JSON into the restore box. Export before clearing site data, deleting the browser profile, or removing this preview. If storage fails, a visible warning says changes remain in this tab. Corrupt stored data is not overwritten. A change reads the latest stored data first; another tab's update refreshes the visible habits. This is not transactional multi-user storage.

Changing a schedule recalculates history and streaks using the new schedule; old check-in dates are retained and become visible if rescheduled. There is no schedule version history, reminder service, archive, or integration with production tasks. Habits follow the configured home timezone through Gordonite's existing date hook. The preview supports 100 habits and limits pasted backups to 5 MB.

## Checks

- `npm run build`: passed, with the existing large-bundle advisory.
- `npm test`: 286 passed, including seven habit-domain tests covering streaks/rest days, totals, saving/undo, future-date refusal, two-store updates, bad storage, and backup validation.
- `node --test --test-concurrency=1 tests/e2e/habits.test.js tests/e2e/today.test.js tests/e2e/settings.test.js`: 16 passed, run across two invocations. Includes habit navigation/editing, persistence, create/delete, text backup restore, invalid backup preservation, phone layout, and existing Dashboard/Settings behavior.
- `node scripts/inspect-habits-preview.mjs`: running server health confirmed preview version; zero page errors and zero non-local requests. Screenshots in `data/screenshots` inspected for the real Dashboard, desktop habit page, and light/dark phone habit page. Additional overflow checks covered 320 px.

The initial sandboxed tests failed because local connections were denied, not because of an application failure. Successful runs used loopback access outside that sandbox. No remote application requests were made during preview testing.

To return to the unmodified application, close this preview and use the existing Gordonite address. Production was never changed. To preserve any experiments, export browser habit JSON and retain `data/habits-preview` before removing this checkout.
