#!/usr/bin/env node
// Command-line maintenance: backup, verify, restore.
//   node server/cli.js backup
//   node server/cli.js verify <backup.sqlite>
//   node server/cli.js restore <backup.sqlite> --yes     (stop the app first)
//   node server/cli.js token                             (a new random key for ASSISTANT_TOKEN)
//   node server/cli.js check-files [--hashes]            (every attached file is present and undamaged)
//   node server/cli.js check-docs                        (stored notes that break the document rules; read-only)
//   node server/cli.js bundle [file.zip] [--keep N]      (the database and every stored file in one verified zip)
//   node server/cli.js verify-bundle <file.zip> [--quick]
//   node server/cli.js restore-bundle <file.zip> --yes   (STOP THE APP FIRST)
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from './config.js';
import { openDb } from './db.js';
import { createBackup, verifyDatabaseFile } from './backup.js';
import { FileStore } from './files.js';
import { checkDocs } from './doc-check.js';
import { createBundleFile, restoreBundle, verifyBundle } from './bundle.js';

const [, , cmd, arg, ...flags] = process.argv;
const config = loadConfig();

function usage() {
  console.log(`Usage:
  node server/cli.js backup                        Take a verified backup now
  node server/cli.js password-off                  Turn the app's login password off (if you forgot it)
  node server/cli.js token                         Print a new random key to use as ASSISTANT_TOKEN
                                                   (it is not stored anywhere; put it in the app's settings)
  node server/cli.js check-files [--hashes]        Check that every attached file is present (--hashes also
                                                   re-reads each one and checks its content)
  node server/cli.js check-docs                    List notes (and saved versions) whose documents break the
                                                   document rules. Read-only: it changes nothing
  node server/cli.js bundle [file.zip] [--keep N]  Write the database AND every stored file as one zip, then verify
                                                   it. Without a name it goes in backups/bundles/ and only the
                                                   newest N (default 3) are kept there
  node server/cli.js verify-bundle <file.zip>      Check a bundle on its own (--quick skips re-reading every file)
  node server/cli.js restore-bundle <file.zip> --yes
                                                   Put a bundle's database and files in place (STOP THE APP
                                                   FIRST; the current database is saved as a "prerestore" backup,
                                                   files already here are kept, nothing is deleted)
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
  case 'password-off': {
    const db = openDb(config.dbFile);
    const had = db.prepare("DELETE FROM meta WHERE key = 'auth_password'").run().changes > 0;
    db.close();
    console.log(had ? 'The password is off. The app opens without a login again; set a new one in Settings.' : 'No password was set.');
    break;
  }
  case 'token': {
    console.log(crypto.randomBytes(24).toString('base64url'));
    break;
  }
  case 'check-files': {
    const db = openDb(config.dbFile);
    const r = new FileStore(db, config).check({ hashes: arg === '--hashes' || flags.includes('--hashes') });
    db.close();
    for (const p of r.problems) console.error(`  ${p.name} (${p.id}): ${p.problem}`);
    console.log(r.ok ? `OK: ${r.checked} stored file(s) present in ${config.filesDir}` : `NOT OK: ${r.problems.length} problem(s) among ${r.checked} stored file(s)`);
    process.exit(r.ok ? 0 : 1);
    break;
  }
  case 'check-docs': {
    const db = openDb(config.dbFile);
    const r = checkDocs(db);
    db.close();
    for (const p of r.problems) {
      const where = p.kind === 'version' ? `a saved version (revision ${p.revision}) of note ${p.noteId}` : `note ${p.id}`;
      console.error(`  ${where}${p.date ? ` from ${p.date}` : ''}${p.title ? ` "${p.title}"` : ''}${p.trashed ? ' (in the trash)' : ''}: ${p.error}`);
    }
    console.log(
      r.problems.length
        ? `${r.problems.length} document(s) break the document rules, among ${r.notes} notes and ${r.versions} saved versions. Nothing was changed; they keep their text and stay editable.`
        : `OK: all ${r.notes} notes and ${r.versions} saved versions follow the document rules.`,
    );
    process.exit(r.problems.length ? 1 : 0);
    break;
  }
  case 'bundle': {
    const { APP_VERSION } = await import('./app.js');
    const named = arg && !arg.startsWith('--') ? path.resolve(arg) : null;
    const dir = path.join(config.backupDir, 'bundles');
    const stamp = new Date().toISOString().slice(0, 19).replaceAll('-', '').replaceAll(':', '').replace('T', '-');
    const target = named ?? path.join(dir, `gordonite-bundle-${stamp}.zip`);
    const keepAt = flags.indexOf('--keep');
    const keep = keepAt >= 0 ? Number(flags[keepAt + 1]) : arg === '--keep' ? Number(flags[0]) : 3;
    const db = openDb(config.dbFile);
    let made;
    try {
      made = await createBundleFile(db, config, target, { appVersion: APP_VERSION });
    } finally {
      db.close();
    }
    const check = await verifyBundle(target);
    const m = made.manifest;
    console.log(`Bundle written: ${target} (${(made.size / 1024 / 1024).toFixed(1)} MB)`);
    console.log(`  ${m.counts.notes} notes, ${m.counts.trashed} in the trash, ${m.counts.tags} tags, ${m.counts.versions} versions; ${m.files.length} stored file(s)`);
    for (const p of check.problems) console.error(`  ${p.kind}: ${p.message}${p.path ? ` (${p.path})` : ''}`);
    if (!named && Number.isInteger(keep) && keep >= 1) {
      const old = fs.readdirSync(dir).filter((n) => /^gordonite-bundle-.*\.zip$/.test(n)).sort().reverse().slice(keep);
      for (const n of old) fs.rmSync(path.join(dir, n), { force: true });
      if (old.length) console.log(`  removed ${old.length} older bundle(s); keeping the newest ${keep}`);
    }
    if (check.damaged) {
      console.error('NOT OK: the bundle did not verify. Do not rely on it.');
      process.exit(1);
    }
    console.log(m.complete ? 'OK: complete, and verified (every file re-read and matched to its SHA-256).' : 'INCOMPLETE: some files were missing on the server (listed above). The notes are in the bundle; those files are not.');
    process.exit(m.complete ? 0 : 3);
    break;
  }
  case 'verify-bundle': {
    if (!arg) usage();
    const r = await verifyBundle(path.resolve(arg), { hashes: !flags.includes('--quick') });
    for (const p of r.problems) console.error(`  ${p.kind}: ${p.message}${p.path ? ` (${p.path})` : ''}`);
    if (r.manifest) {
      const m = r.manifest;
      console.log(`Bundle from ${m.createdAt} (app ${m.app?.version ?? '?'}, schema v${m.app?.schemaVersion ?? '?'}): ${m.counts?.notes ?? '?'} notes, ${m.counts?.trashed ?? '?'} in the trash, ${m.files?.length ?? 0} file(s)`);
    }
    if (r.damaged || !r.manifest) {
      console.error('NOT OK: this bundle is damaged or not a bundle, and would not be restored.');
      process.exit(1);
    }
    console.log(r.complete ? `OK: complete${flags.includes('--quick') ? ' (file contents were not re-read; run without --quick for that)' : ', and every file matches its SHA-256'}.` : 'INCOMPLETE: intact, but some files were missing on the server when it was made.');
    process.exit(r.complete ? 0 : 3);
    break;
  }
  case 'restore-bundle': {
    if (!arg) usage();
    const file = path.resolve(arg);
    const r = await verifyBundle(file);
    for (const p of r.problems) console.error(`  ${p.kind}: ${p.message}${p.path ? ` (${p.path})` : ''}`);
    if (r.damaged || !r.manifest) {
      console.error('Refusing to restore: the bundle is damaged or not a bundle. Nothing was changed.');
      process.exit(1);
    }
    const m = r.manifest;
    console.log(`Bundle to restore: ${file}\n  made ${m.createdAt}: ${m.counts.notes} notes, ${m.counts.trashed} in the trash, ${m.counts.tags} tags, ${m.counts.versions} versions; ${m.files.length} stored file(s)`);
    if (!flags.includes('--yes')) {
      console.error('\nThis replaces the live database and adds the bundle\'s files to the files folder. Stop the app first, then re-run with --yes.');
      process.exit(1);
    }
    const done = await restoreBundle(file, config, { allowIncomplete: flags.includes('--allow-incomplete') });
    if (done.prerestore) console.log(`Current database saved as ${path.join(config.backupDir, done.prerestore)}`);
    console.log(`Restored. ${describe(done.database)}\n  ${done.filesAdded} file(s) added to ${config.filesDir}, ${done.filesPresent} already there.\nStart the app again.`);
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
