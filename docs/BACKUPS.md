# Backups, export, and restore

Three independent layers, because syncing or browser storage is not a backup:

| Layer | What it is | Protects against |
|---|---|---|
| **Server backups** | verified SQLite snapshots in `backups/`, automatic | app bugs, bad edits, accidental deletes, corruption |
| **Off-server copies** | you copy `backups/` elsewhere | server disk failure, theft, fire |
| **Exports** | JSON (full fidelity) and Markdown (readable) from *Data & backups* | lock-in, "I want my words in plain files" |

The phone's own store (IndexedDB) is **not** a backup: it only holds edits the server has not yet confirmed.

## Automatic backups

* Every `BACKUP_INTERVAL_HOURS` (default 6) the app writes `backups/hq-auto-YYYYMMDD-HHMMSS.sqlite`
  (UTC time in the name) using SQLite `VACUUM INTO`, which gives a transactionally consistent copy while
  the app keeps running.
* The copy is **re-opened and checked** (`PRAGMA integrity_check`, schema version, required tables, counts)
  before it is accepted. A failed check leaves no file and the error appears on *Data & backups* and in the log.
* Retention (all configurable): keep the newest `BACKUP_KEEP_LATEST` (6), plus the newest backup of each of
  the last `BACKUP_KEEP_DAILY` (14) days and `BACKUP_KEEP_WEEKLY` (8) weeks. Backups taken automatically
  before an import (`hq-preimport-…`), before a restore (`hq-prerestore-…`) and by the *Back up now* button
  (`hq-manual-…`) are kept up to 20 of each kind. Files with other names in that folder are never touched.
* `backups/backup-status.json` records the last attempt, last success and last error.
* Backups only run while the container is running.

## Getting backups off the server

Pick at least one, and put a reminder in your calendar to check it works.

**Pull from another machine (rsync over SSH)**, e.g. a cron job on a laptop or NAS:

```bash
rsync -a --ignore-existing  user@casaos:/DATA/AppData/personal-hq/data/backups/  ~/hq-backups/
```

**Push to cloud storage (rclone)**, encrypted if you like (`rclone config` → a `crypt` remote):

```bash
rclone copy /DATA/AppData/personal-hq/data/backups  mycrypt:personal-hq-backups --include "hq-auto-*.sqlite"
```

Schedule it with `crontab -e` on the server, e.g. `15 3 * * * rclone copy ...`.

**Syncthing** (also available for CasaOS): share the `backups` folder as *send-only* to another device.

**By hand**: *Data & backups → Download a fresh copy* downloads a new consistent database file to the phone;
the list below it downloads any stored backup. *Full backup (JSON)* is a second, format-independent copy.

Periodically check a copy is good: `node server/cli.js verify <file>` (or, in Docker,
`docker run --rm -v <folder>:/b personal-hq:0.1.0 node server/cli.js verify /b/<file>`).

## Restoring (disaster recovery)

You need a backup file (from `backups/`, or an off-server copy). The restore command replaces the database,
so **stop the app first**. It refuses files that fail verification, and it saves the current database as a
`hq-prerestore-…` backup before replacing it, so a mistaken restore can itself be undone.

Docker Compose:

```bash
docker compose stop
docker compose run --rm personal-hq node server/cli.js verify /data/backups/hq-auto-20261005-081211.sqlite
docker compose run --rm personal-hq node server/cli.js restore /data/backups/hq-auto-20261005-081211.sqlite --yes
docker compose up -d
```

CasaOS / plain Docker (adjust the folder):

```bash
docker stop personal-hq
docker run --rm -u 1000:1000 -v /DATA/AppData/personal-hq/data:/data personal-hq:0.1.0 \
  node server/cli.js restore /data/backups/hq-auto-20261005-081211.sqlite --yes
docker start personal-hq
```

To restore a copy from elsewhere, put the file in the data folder's `backups/` first (or mount it).

Without Docker: `npm run restore -- <file> --yes` (with `DATA_DIR` set as the app uses it).

After restoring, notes written *after* the backup are gone from the server. If a phone still has unsent
edits for notes that no longer exist on the server, they are re-created from the phone's copy the next
time it connects (the app treats "note missing" as "create it").

### What was tested

* `tests/server/backup.test.js` seeds notes (multi-tag, tasks, versions, a trashed note), takes a backup,
  destroys the live data and writes junk, stops the app, runs the real CLI `restore`, starts a new app on the
  result, and checks that a full export of the restored database is **identical** to the export taken at
  backup time. It also checks the safety copy, `--yes` is required, corrupt/truncated/foreign files are
  refused, retention keeps/removes the right files and leaves unrelated files alone, and that a downloaded
  snapshot is a valid database.
* `tests/server/portability.test.js` checks JSON export → import (replace) into an empty server is lossless,
  replace takes a pre-import backup, merge never overwrites, invalid files change nothing.
* Not tested: the Docker invocations above (no Docker where this was written). The CLI they call is what was tested.

## Export and import

* **Full backup (JSON)** `GET /api/export/json`: notes (documents with their format version, dates,
  timestamps, revision), tags with ids, tag memberships, **task ids**, all kept versions, and the trash.
* **Markdown (zip)** `GET /api/export/markdown`: `<tag>/<YYYY-MM-DD>.md` with front matter (`id`, `date`,
  `tags`, timestamps). Tasks are `- [ ]` / `- [x]`, bold/italic/headings/bullets are standard Markdown.
  A multi-tag note appears under each tag. Trash and history are not included. One-way (no Markdown import).
* **Import** (Data & backups):
  * *Merge*: adds notes that are missing; a note with the same id but different text is **kept as is** and the
    imported text is stored as a version of it; if a different note already holds the same tag+date, the
    imported text is stored as a version of that one. Importing the same file twice changes nothing.
  * *Replace everything*: for restoring a whole state; takes a `hq-preimport-…` backup first.
  * The file is fully validated before anything is changed.
