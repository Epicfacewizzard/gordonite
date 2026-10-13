# Backups, export, and restore

Three independent layers, because syncing or browser storage is not a backup:

| Layer | What it is | Protects against |
|---|---|---|
| **Server backups** | verified SQLite snapshots in `backups/`, automatic | app bugs, bad edits, accidental deletes, corruption |
| **Off-server copies** | you copy `backups/` elsewhere | server disk failure, theft, fire |
| **Exports** | JSON (full fidelity) and Markdown (readable) from *Data & backups* | lock-in, "I want my words in plain files" |

The phone's own store (IndexedDB) is **not** a backup: it only holds edits the server has not yet confirmed.

**What a database backup does not hold: your photos and PDFs.** The `hq-*.sqlite` backups and the JSON export have
the notes, tags, history and the *list* of files, but the files' bytes live in the `files` folder beside the database.
A **bundle** (below) is the one file that holds both, so it is the thing to keep off the server.

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

## Bundles: the notes and their files in one verified file

A bundle is one zip that restores the notes **and** their photos and PDFs together:

```
bundle.json            what is in it, with a size and SHA-256 for every part
hq.sqlite              a consistent snapshot of the database (the same VACUUM INTO the automatic backups use)
files/<aa>/<sha256>    every stored file the database knows about
```

It holds **every** file the database has a record of, not only those in notes you can see: files in the trash, in
old versions of a note, the original kept beside a converted iPhone photo, and files that were removed from the Files
page (they can be brought back, so their bytes must survive too). Files never change once stored and are named by
their content, so a database snapshot plus the files it names is consistent even though the files are read a moment
later. It is streamed, so a big workspace is not held in memory.

**Make one**

* In the app: *Data & backups → Download everything (database + files)*.
* On the server (this also checks it, and is the one to schedule):
  `docker exec gordonite node server/cli.js bundle` writes `backups/bundles/gordonite-bundle-<time>.zip` and keeps the
  newest 3 there (`--keep N` to change; `bundle <file.zip>` writes where you say and keeps everything).

**Check one on its own** (nothing is changed; do this to any copy you rely on):
`node server/cli.js verify-bundle <file.zip>`. It reads the archive's index, checks every part is there with the right
size and SHA-256, opens the database and checks it (integrity, schema newer than the app?), and that the manifest names
every file the database refers to. `--quick` skips re-reading the file contents. It says plainly what is wrong: a
file cut off, a damaged file (named), not a bundle, a file that was already missing on the server when the bundle was
made (the bundle is then "incomplete": the notes are in it, that file is not).

**Restore one** (stop the app first):
`node server/cli.js restore-bundle <file.zip> --yes`. In this order, so a failure at any step leaves the current
data usable: (1) the whole bundle is verified, and nothing is touched if it is damaged or incomplete (an incomplete
one needs `--allow-incomplete`); (2) the current database is saved as `hq-prerestore-…`; (3) the bundle's files are
added to the files folder (only those missing or damaged; **nothing is ever deleted**; each is written under a
temporary name and checked before it takes its real one); (4) the database is replaced, opened (any pending migration
runs) and checked. The files folder is wherever `FILES_DIR` points, which need not be beside the database.

**Limits.** It is a classic ZIP, so **4 GiB** in total and 65,535 files; past that the command stops with a message
instead of writing a damaged archive. Then copy the `files` folder (rsync/robocopy/Syncthing; it is append-only, so
repeat copies are quick) together with a database backup. A bundle made through the app's download cannot be checked
by the app afterwards (the response has gone), so run `verify-bundle` on a downloaded copy once.

**Rolling back an update.** A bundle made by a newer app than the one you restore into is refused with a clear
message (its database schema is newer); restore with the newer app, or use the pre-update database backup as in
DEPLOYMENT.md.

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

**By hand**: *Data & backups → Download everything (database + files)* downloads a bundle (above): the one to keep.
*Download a fresh copy* is the database alone; the list below it downloads any stored backup. *Full backup (JSON)* is
a second, format-independent copy of the notes (not the files).

**Bundles on a schedule** (e.g. nightly, copied off the server afterwards):

```bash
15 3 * * *  docker exec gordonite node server/cli.js bundle --keep 3
```

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
