import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

// Schema version is tracked with PRAGMA user_version. Each entry upgrades from
// the previous version. Never edit a shipped migration; append a new one.
const MIGRATIONS = [
  `
  CREATE TABLE tags (
    id         TEXT PRIMARY KEY,
    path       TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL
  );

  CREATE TABLE notes (
    id               TEXT PRIMARY KEY,
    note_date        TEXT NOT NULL,            -- YYYY-MM-DD in the home timezone
    doc              TEXT NOT NULL,            -- structured editor document (JSON)
    doc_format       INTEGER NOT NULL,         -- format version of "doc"
    revision         INTEGER NOT NULL,         -- +1 on every content change
    last_op_id       TEXT,                     -- id of the request that wrote this revision
    created_at       TEXT NOT NULL,            -- UTC instants
    updated_at       TEXT NOT NULL,
    deleted_at       TEXT,                     -- non-null = in trash
    last_snapshot_at TEXT
  );

  -- A note can carry several tags. note_date is copied here so the database
  -- itself guarantees one live note per tag per date; trashed notes release
  -- their slot (live = 0) and may only be restored if it is still free.
  CREATE TABLE note_tags (
    note_id   TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    tag_id    TEXT NOT NULL REFERENCES tags(id),
    note_date TEXT NOT NULL,
    live      INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (note_id, tag_id)
  );
  CREATE UNIQUE INDEX note_tags_slot ON note_tags (tag_id, note_date) WHERE live = 1;
  CREATE INDEX note_tags_stream ON note_tags (tag_id, note_date DESC) WHERE live = 1;

  CREATE TABLE note_versions (
    id         TEXT PRIMARY KEY,
    note_id    TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    revision   INTEGER NOT NULL,
    doc        TEXT NOT NULL,
    doc_format INTEGER NOT NULL,
    kind       TEXT NOT NULL,                  -- auto | guard | conflict | import | restore
    created_at TEXT NOT NULL
  );
  CREATE INDEX note_versions_note ON note_versions (note_id, created_at DESC);

  CREATE TABLE meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `,
  // v2: favourite tags are pinned to the top of the home screen.
  `ALTER TABLE tags ADD COLUMN favorite INTEGER NOT NULL DEFAULT 0;`,
  // v3: free notes. notes.kind is 'daily' (the per-day entry of a stream: one per tag per day, as before) or
  // 'note' (written on its own: any number per tag per day, and it may have no tag). note_tags.slot is 1 for
  // daily notes, which hold the tag+date slot, and 0 for free notes, which hold none.
  `
  ALTER TABLE notes ADD COLUMN kind TEXT NOT NULL DEFAULT 'daily';
  ALTER TABLE note_tags ADD COLUMN slot INTEGER NOT NULL DEFAULT 1;
  DROP INDEX note_tags_slot;
  CREATE UNIQUE INDEX note_tags_slot ON note_tags (tag_id, note_date) WHERE live = 1 AND slot = 1;
  `,
];

export const SCHEMA_VERSION = MIGRATIONS.length;

export function applyPragmas(db) {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = FULL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
  `);
}

export function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  applyPragmas(db);
  migrate(db);
  return db;
}

export function migrate(db) {
  const current = db.prepare('PRAGMA user_version').get().user_version;
  if (current > SCHEMA_VERSION) {
    throw new Error(
      `Database schema v${current} is newer than this app supports (v${SCHEMA_VERSION}). Refusing to open it.`,
    );
  }
  for (let v = current; v < SCHEMA_VERSION; v++) {
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(MIGRATIONS[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
}

// Run fn inside one transaction. fn must be synchronous.
export function tx(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      /* already rolled back */
    }
    throw err;
  }
}
