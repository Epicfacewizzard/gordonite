# Workspace and archived experiments

Checked 2026-10-16 (America/Edmonton).

## What to use

| Purpose | Branch | Folder |
| --- | --- | --- |
| Current application, version 0.12.0 | `main` | Repository root |
| Unfinished Android app, widgets and reminders | `codex/android-shell` | `data/development/android` |

The connected server's `ping` reported **0.12.0**. The root checkout was fast-forwarded from `8c90d65`
to the already published `b102492`; this cleanup did not deploy or change application code.
The Android folder was moved intact, including local configuration and build outputs. It has an older
web/server base: review against main before integrating it.

Use `npm run dev` from the repository root, or `npm run preview:local` for fictional preview notes
(port 8091). The local Claude launch settings now use this root preview instead of temporary checkouts.

## Local cleanup

The workspace went from **15 local branches and 8 registered working copies** to **2 of each**.
Six duplicate working copies and thirteen local branches were retired after archiving their history:
old attachments, restore, save-queue, habits, PWA/HTTPS, daily-tag, task-history, original agent-edit,
temporary release, randomly named Claude branches, and the earlier unfinished Android jot experiment.

Two empty folders, `.claude/worktrees/exciting-chandrasekhar-ac54eb` and
`.claude/worktrees/sweet-engelbart-277e10`, remain held open by another process. Their contents and Git
registrations are gone; remove the empty folders when the owning process closes. No unrelated process was stopped.

## Recovery

The private, Git-ignored folder `data/repository-archive/2026-10-16/` contains:

- `all-branches.bundle`: verified complete Git history and all original refs, including the stash.
- `refs.txt`, `worktrees-before.txt`: original commit IDs and checkout locations.
- `prototypes/habit-tracker-beta.zip`: the full browser-only habit beta snapshot.
- `prototypes/personal-crm-preview.zip`: the standalone CRM design preview.
- `prototypes/visual-concept-01.zip`: the visual mockup, also still available in `design/`.
- `preview-data/`: ignored data folders preserved from the removed fix and habits working copies.
- `verified-databases/`: consistent SQLite backup copies; the one database found passed integrity checking.
  Prefer this copy over a raw copied database/WAL pair.
- `launch-before.json`: the original local launch settings.
- `test-results.txt`: the successful release test run after updating main.

Keep this archive private: it may contain preview data and local settings. It is a local recovery archive,
not a verified off-server backup of the live app. Do not commit its contents.

From the repository root, inspect or recover an old branch without resetting main:

```powershell
git bundle verify data/repository-archive/2026-10-16/all-branches.bundle
git bundle list-heads data/repository-archive/2026-10-16/all-branches.bundle
git fetch data/repository-archive/2026-10-16/all-branches.bundle refs/heads/feature/android-jot-window:refs/heads/codex/recovered-android-jot
```

Substitute other original refs from `refs.txt` as needed. For the remote-only prototypes, the source refs are
`refs/remotes/origin/codex/habit-tracker-beta-test` and `refs/remotes/origin/codex/personal-crm-preview`.

## GitHub

A direct check found six GitHub branches: `main`, `codex/habit-tracker-beta-test`,
`codex/personal-crm-preview`, `feature/attachments`, `feature/restore-removed-files`, and
`work-from-other-session`. No remote refs were changed. Automatic approval review rejected deleting remote
branches without explicit approval beyond local cleanup. The Android branch remains local; its original
`feature/android-shell` history is also in the recovery bundle.

## Verification and limits

- Root application version: **0.12.0**; no new application code, schema migration, version bump or deployment.
- `npm test`: **340 passed, 0 failed**. The first sandboxed run failed during server setup; the successful run
  used the unrestricted local environment. Only the failed test runner and its waiting child were stopped.
- `npm run build`: passed, with Vite's warning about a JavaScript chunk larger than 500 kB.
- Preview data was preserved and the database backed up through SQLite's backup API and integrity-checked.
- Android was preserved, not rebuilt or device-tested. The new assistant tool inventory was not revalidated
  in a newly started chat.

For new work, use main unless deliberately continuing Android. Record whether an experiment is active,
shipped or archived before adding another working copy.
