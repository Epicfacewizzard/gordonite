import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SCHEMA_VERSION } from './db.js';

// Backups are consistent snapshots made with SQLite's VACUUM INTO (safe while
// the app is running and writing). Every snapshot is re-opened and checked
// before it is accepted, so a backup file that exists has passed verification.

const NAME_RE = /^hq-(auto|manual|preimport|prerestore)-(\d{8})-(\d{6})(?:-\d+)?\.sqlite$/;
const STATUS_FILE = 'backup-status.json';

const sqlString = (s) => `'${s.replace(/'/g, "''")}'`;

function stamp(d = new Date()) {
  const iso = d.toISOString(); // 2026-10-05T14:03:22.123Z
  return `${iso.slice(0, 10).replaceAll('-', '')}-${iso.slice(11, 19).replaceAll(':', '')}`;
}

// Open a database file read-only and check that it is a usable Personal HQ database.
export function verifyDatabaseFile(file) {
  let db;
  try {
    db = new DatabaseSync(file, { readOnly: true });
    const integrity = db.prepare('PRAGMA integrity_check').all().map((r) => r.integrity_check);
    if (integrity.length !== 1 || integrity[0] !== 'ok') {
      return { ok: false, error: `integrity_check failed: ${integrity.slice(0, 3).join('; ')}` };
    }
    const version = db.prepare('PRAGMA user_version').get().user_version;
    if (version < 1) return { ok: false, error: 'not a Personal HQ database (schema version 0)' };
    if (version > SCHEMA_VERSION) {
      return { ok: false, error: `database schema v${version} is newer than this app (v${SCHEMA_VERSION})` };
    }
    const has = (t) => db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t);
    for (const t of ['notes', 'tags', 'note_tags', 'note_versions']) {
      if (!has(t)) return { ok: false, error: `missing table "${t}"` };
    }
    const count = (sql) => db.prepare(sql).get().c;
    return {
      ok: true,
      schemaVersion: version,
      notes: count('SELECT COUNT(*) c FROM notes WHERE deleted_at IS NULL'),
      trashed: count('SELECT COUNT(*) c FROM notes WHERE deleted_at IS NOT NULL'),
      tags: count('SELECT COUNT(*) c FROM tags'),
      versions: count('SELECT COUNT(*) c FROM note_versions'),
    };
  } catch (err) {
    return { ok: false, error: String(err.message ?? err) };
  } finally {
    try {
      db?.close();
    } catch {
      /* ignore */
    }
  }
}

function readStatus(dir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, STATUS_FILE), 'utf8'));
  } catch {
    return { lastAttemptAt: null, lastSuccessAt: null, lastFile: null, lastError: null };
  }
}

function writeStatus(dir, patch) {
  const next = { ...readStatus(dir), ...patch };
  fs.writeFileSync(path.join(dir, STATUS_FILE), JSON.stringify(next, null, 2));
  return next;
}

export function createBackup(db, cfg, kind = 'auto') {
  fs.mkdirSync(cfg.backupDir, { recursive: true });
  const attemptAt = new Date().toISOString();
  let final = path.join(cfg.backupDir, `hq-${kind}-${stamp()}.sqlite`);
  for (let n = 2; fs.existsSync(final); n++) final = path.join(cfg.backupDir, `hq-${kind}-${stamp()}-${n}.sqlite`);
  const tmp = `${final}.tmp`;
  try {
    fs.rmSync(tmp, { force: true });
    db.exec(`VACUUM INTO ${sqlString(tmp)}`);
    const check = verifyDatabaseFile(tmp);
    if (!check.ok) throw new Error(`backup failed verification: ${check.error}`);
    fs.renameSync(tmp, final);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    writeStatus(cfg.backupDir, { lastAttemptAt: attemptAt, lastError: String(err.message ?? err) });
    throw err;
  }
  const info = { file: path.basename(final), size: fs.statSync(final).size, kind, ...verifyDatabaseFile(final) };
  writeStatus(cfg.backupDir, {
    lastAttemptAt: attemptAt,
    lastSuccessAt: new Date().toISOString(),
    lastFile: info.file,
    lastError: null,
  });
  pruneBackups(cfg);
  return info;
}

export function listBackups(cfg) {
  if (!fs.existsSync(cfg.backupDir)) return [];
  const out = [];
  for (const name of fs.readdirSync(cfg.backupDir)) {
    const m = NAME_RE.exec(name);
    if (!m) continue;
    const st = fs.statSync(path.join(cfg.backupDir, name));
    out.push({ file: name, kind: m[1], size: st.size, createdAt: st.mtime.toISOString() });
  }
  return out.sort((a, b) => (a.file < b.file ? 1 : -1)); // newest first (names sort by time)
}

export function backupStatus(cfg) {
  return { ...readStatus(cfg.backupDir), backups: listBackups(cfg), dir: cfg.backupDir };
}

export function backupPath(cfg, file) {
  if (!NAME_RE.test(file)) return null;
  const p = path.join(cfg.backupDir, file);
  return fs.existsSync(p) ? p : null;
}

// Retention for automatic backups: keep the newest N, plus the newest backup of
// each of the last D days and W weeks. Backups made before imports/restores and
// manual ones are kept up to a cap of 20 per kind.
export function pruneBackups(cfg) {
  const all = listBackups(cfg);
  const del = new Set();
  const auto = all.filter((b) => b.kind === 'auto');
  const keep = new Set(auto.slice(0, cfg.backupKeepLatest).map((b) => b.file));
  const days = new Set();
  const weeks = new Set();
  for (const b of auto) {
    const t = Date.parse(b.createdAt);
    const day = Math.floor(t / 86_400_000);
    const week = Math.floor((day + 3) / 7);
    if (!days.has(day) && days.size < cfg.backupKeepDaily) {
      days.add(day);
      keep.add(b.file);
    }
    if (!weeks.has(week) && weeks.size < cfg.backupKeepWeekly) {
      weeks.add(week);
      keep.add(b.file);
    }
  }
  for (const b of auto) if (!keep.has(b.file)) del.add(b.file);
  for (const kind of ['manual', 'preimport', 'prerestore']) {
    for (const b of all.filter((x) => x.kind === kind).slice(20)) del.add(b.file);
  }
  for (const f of del) fs.rmSync(path.join(cfg.backupDir, f), { force: true });
  return [...del];
}

export class BackupScheduler {
  constructor(db, cfg, store, log = console) {
    this.db = db;
    this.cfg = cfg;
    this.store = store;
    this.log = log;
    this.timer = null;
  }

  tick() {
    try {
      const purged = this.store.purgeTrash();
      if (purged) this.log.log(`[trash] permanently removed ${purged} note(s) older than ${this.cfg.trashRetentionDays} days`);
    } catch (err) {
      this.log.error('[trash] purge failed:', err);
    }
    if (this.cfg.backupIntervalHours <= 0) return;
    const newest = listBackups(this.cfg).find((b) => b.kind === 'auto');
    const age = newest ? Date.now() - Date.parse(newest.createdAt) : Infinity;
    if (age < this.cfg.backupIntervalHours * 3_600_000) return;
    try {
      const info = createBackup(this.db, this.cfg, 'auto');
      this.log.log(`[backup] ${info.file} (${info.notes} notes, ${info.size} bytes) verified`);
    } catch (err) {
      this.log.error('[backup] FAILED:', err);
    }
  }

  start() {
    setTimeout(() => this.tick(), 3000).unref();
    this.timer = setInterval(() => this.tick(), 10 * 60_000);
    this.timer.unref();
  }

  stop() {
    clearInterval(this.timer);
  }
}
