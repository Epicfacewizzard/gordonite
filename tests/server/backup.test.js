import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { startServer, save, para, docOf, task } from './helpers.js';
import { createBackup, listBackups, pruneBackups, verifyDatabaseFile } from '../../server/backup.js';
import { openDb } from '../../server/db.js';
import { exportAll } from '../../server/portability.js';
import { loadConfig } from '../../server/config.js';
import { uuid } from '../../shared/ids.js';

const CLI = path.resolve('server/cli.js');
const cli = (dataDir, ...args) =>
  spawnSync(process.execPath, [CLI, ...args], { env: { ...process.env, DATA_DIR: dataDir, BACKUP_INTERVAL_HOURS: '0' }, encoding: 'utf8' });

async function seed(t) {
  const a = uuid();
  const b = uuid();
  const tk = task('call dentist', true);
  await save(t, a, docOf(para('Hello', [{ type: 'bold' }]), { type: 'taskList', content: [tk, task('book flights')] }), {
    tags: ['daily-jots', 'school/fall26'],
    date: '2026-10-05',
  });
  await save(t, a, docOf(para('Hello world, edited a few times')), { base: 1, tags: ['daily-jots', 'school/fall26'] });
  await save(t, b, docOf(para('Second day')), { tags: ['daily-jots'], date: '2026-10-04' });
  const gone = uuid();
  await save(t, gone, docOf(para('deleted but recoverable')), { tags: ['daily-jots'], date: '2026-10-03' });
  await t.api('DELETE', `/api/notes/${gone}`);
  return { a, b, gone };
}

describe('backups', () => {
  test('a backup is a verified, consistent, independent copy', async () => {
    const t = await startServer();
    try {
      await seed(t);
      const info = createBackup(t.db, t.config, 'manual');
      assert.equal(info.ok, true);
      assert.equal(info.notes, 2);
      assert.equal(info.trashed, 1);
      const file = path.join(t.config.backupDir, info.file);
      // Changing the live DB afterwards must not change the backup.
      await save(t, uuid(), docOf(para('later')), { tags: ['daily-jots'], date: '2026-10-01' });
      const check = verifyDatabaseFile(file);
      assert.equal(check.notes, 2);
      const status = (await t.api('GET', '/api/backups')).json;
      assert.equal(status.lastFile, info.file);
      assert.equal(status.lastError, null);
    } finally {
      await t.close();
    }
  });

  test('corrupted or foreign files fail verification', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-bad-'));
    const cfg = loadConfig({ DATA_DIR: dir });
    const db = openDb(cfg.dbFile);
    db.close();
    const bytes = fs.readFileSync(cfg.dbFile);
    const truncated = path.join(dir, 'truncated.sqlite');
    fs.writeFileSync(truncated, bytes.subarray(0, 100));
    assert.equal(verifyDatabaseFile(truncated).ok, false);
    const garbage = path.join(dir, 'garbage.sqlite');
    fs.writeFileSync(garbage, 'this is not a database'.repeat(100));
    assert.equal(verifyDatabaseFile(garbage).ok, false);
    const foreign = path.join(dir, 'foreign.sqlite');
    const f = new DatabaseSync(foreign);
    f.exec('CREATE TABLE x(a)');
    f.close();
    assert.match(verifyDatabaseFile(foreign).error, /not a Personal HQ database/);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('retention keeps newest N + one per day + one per week, and never touches other files', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-ret-'));
    const cfg = loadConfig({ DATA_DIR: dir, BACKUP_KEEP_LATEST: '2', BACKUP_KEEP_DAILY: '3', BACKUP_KEEP_WEEKLY: '2' });
    fs.mkdirSync(cfg.backupDir, { recursive: true });
    const base = Date.parse('2026-10-05T12:00:00Z');
    // 20 days x 4 backups per day
    for (let d = 0; d < 20; d++) {
      for (let h = 0; h < 4; h++) {
        const when = new Date(base - d * 86400e3 - h * 6 * 3600e3);
        const iso = when.toISOString();
        const name = `hq-auto-${iso.slice(0, 10).replaceAll('-', '')}-${iso.slice(11, 19).replaceAll(':', '')}.sqlite`;
        const p = path.join(cfg.backupDir, name);
        fs.writeFileSync(p, 'x');
        fs.utimesSync(p, when, when);
      }
    }
    fs.writeFileSync(path.join(cfg.backupDir, 'notes-i-put-here.txt'), 'keep me');
    pruneBackups(cfg);
    const left = listBackups(cfg).filter((b) => b.kind === 'auto');
    const days = new Set(left.map((b) => b.createdAt.slice(0, 10)));
    assert.ok(left.length <= 2 + 3 + 2, `kept ${left.length}`);
    assert.ok(left.length >= 4);
    assert.equal(left[0].createdAt, new Date(base).toISOString(), 'newest is kept');
    assert.ok(days.has('2026-10-05') && days.has('2026-10-04') && days.has('2026-10-03'));
    assert.ok(fs.existsSync(path.join(cfg.backupDir, 'notes-i-put-here.txt')));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('scheduler takes an automatic backup when none exists, then waits for the interval', async () => {
    const t = await startServer({ BACKUP_INTERVAL_HOURS: '6' });
    try {
      await seed(t);
      const { BackupScheduler } = await import('../../server/backup.js');
      const s = new BackupScheduler(t.db, t.config, t.store, { log() {}, error() {} });
      s.tick();
      s.tick();
      assert.equal(listBackups(t.config).filter((b) => b.kind === 'auto').length, 1);
    } finally {
      await t.close();
    }
  });

  test('RESTORE: CLI restores a backup after data loss, saving the damaged state first', async () => {
    const t = await startServer();
    await seed(t);
    const expected = JSON.parse((await t.api('GET', '/api/export/json')).text);
    const backupFile = path.join(t.config.backupDir, createBackup(t.db, t.config, 'manual').file);
    // Disaster: content wiped, junk written afterwards.
    t.db.exec('DELETE FROM note_versions; DELETE FROM note_tags; DELETE FROM notes;');
    await save(t, uuid(), docOf(para('junk written after the backup')), { tags: ['junk'] });
    await t.stop(); // stop the app, as the docs instruct, but keep its data

    const refused = cli(t.dir, 'restore', backupFile);
    assert.notEqual(refused.status, 0, 'needs --yes');
    const bad = path.join(t.dir, 'bad.sqlite');
    fs.writeFileSync(bad, 'garbage'.repeat(1000));
    assert.notEqual(cli(t.dir, 'restore', bad, '--yes').status, 0, 'refuses a corrupt file');

    const ok = cli(t.dir, 'restore', backupFile, '--yes');
    assert.equal(ok.status, 0, ok.stdout + ok.stderr);
    assert.match(ok.stdout, /Restored/);

    // A new app instance on the restored database sees exactly the backed-up data.
    const cfg = loadConfig({ DATA_DIR: t.dir, BACKUP_INTERVAL_HOURS: '0' });
    const db = openDb(cfg.dbFile);
    const after = JSON.parse(JSON.stringify(exportAll(db, cfg)));
    assert.deepEqual({ ...after, exportedAt: 0 }, { ...expected, exportedAt: 0 });
    assert.ok(listBackups(cfg).some((b) => b.kind === 'prerestore'), 'damaged state was saved first');
    db.close();
    fs.rmSync(t.dir, { recursive: true, force: true });
  });

  test('CLI backup + verify work on a stopped database', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-cli-'));
    const cfg = loadConfig({ DATA_DIR: dir });
    const db = openDb(cfg.dbFile);
    db.close();
    const r = cli(dir, 'backup');
    assert.equal(r.status, 0, r.stderr);
    const f = listBackups(cfg)[0];
    const v = cli(dir, 'verify', path.join(cfg.backupDir, f.file));
    assert.equal(v.status, 0);
    assert.match(v.stdout, /^OK/);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
