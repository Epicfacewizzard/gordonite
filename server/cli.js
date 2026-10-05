#!/usr/bin/env node
// Command-line maintenance: backup, verify, restore.
//   node server/cli.js backup
//   node server/cli.js verify <backup.sqlite>
//   node server/cli.js restore <backup.sqlite> --yes     (stop the app first)
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from './config.js';
import { openDb } from './db.js';
import { createBackup, verifyDatabaseFile } from './backup.js';

const [, , cmd, arg, ...flags] = process.argv;
const config = loadConfig();

function usage() {
  console.log(`Usage:
  node server/cli.js backup                        Take a verified backup now
  node server/cli.js verify <file.sqlite>          Check a backup file
  node server/cli.js restore <file.sqlite> --yes   Replace the live database with a backup
                                                   (STOP THE APP FIRST; the current database is saved
                                                   as a "prerestore" backup before being replaced)`);
  process.exit(2);
}

function describe(r) {
  return `${r.notes} notes, ${r.trashed} in trash, ${r.tags} tags, ${r.versions} versions (schema v${r.schemaVersion})`;
}

switch (cmd) {
  case 'backup': {
    const db = openDb(config.dbFile);
    const info = createBackup(db, config, 'manual');
    db.close();
    console.log(`Backup written and verified: ${path.join(config.backupDir, info.file)}\n  ${describe(info)}`);
    break;
  }
  case 'verify': {
    if (!arg) usage();
    const r = verifyDatabaseFile(path.resolve(arg));
    if (!r.ok) {
      console.error(`NOT OK: ${r.error}`);
      process.exit(1);
    }
    console.log(`OK: ${describe(r)}`);
    break;
  }
  case 'restore': {
    if (!arg) usage();
    const src = path.resolve(arg);
    const r = verifyDatabaseFile(src);
    if (!r.ok) {
      console.error(`Refusing to restore: ${r.error}`);
      process.exit(1);
    }
    console.log(`Backup to restore: ${src}\n  ${describe(r)}`);
    if (!flags.includes('--yes')) {
      console.error('\nThis replaces the live database. Stop the app first, then re-run with --yes.');
      process.exit(1);
    }
    if (fs.existsSync(config.dbFile)) {
      const db = openDb(config.dbFile);
      const saved = createBackup(db, config, 'prerestore');
      db.close();
      console.log(`Current database saved as ${path.join(config.backupDir, saved.file)}`);
    }
    fs.mkdirSync(path.dirname(config.dbFile), { recursive: true });
    const tmp = `${config.dbFile}.restore-tmp`;
    fs.copyFileSync(src, tmp);
    for (const ext of ['-wal', '-shm']) fs.rmSync(config.dbFile + ext, { force: true });
    fs.renameSync(tmp, config.dbFile);
    const db = openDb(config.dbFile); // runs any pending migrations
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    db.close();
    const after = verifyDatabaseFile(config.dbFile);
    if (!after.ok) {
      console.error(`Restored file failed verification: ${after.error}`);
      process.exit(1);
    }
    console.log(`Restored. ${describe(after)}\nStart the app again.`);
    break;
  }
  default:
    usage();
}
