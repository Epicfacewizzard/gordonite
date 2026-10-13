// A workspace bundle: one file that restores the notes and the photos and PDFs in them together.
//
// A database backup (backup.js) holds the notes and the records of the files, but not the files' bytes, which live
// beside it in the files folder. A bundle is both, with a manifest that names every file it needs and the SHA-256 of
// each, so it can be checked on its own before anything is replaced.
//
//   bundle.json            the manifest: what is in the bundle, with a size and SHA-256 for every part
//   hq.sqlite              a consistent snapshot of the database (taken with VACUUM INTO, safe while the app runs)
//   files/<aa>/<sha256>    every stored file the database knows about, in the same layout as the files folder
//
// Every file the database has a record for is included: the ones in notes, in the trash, in old versions, the
// originals kept beside a converted photo, and files that were removed from the Files page (they can be brought
// back, so their bytes must survive too). Files are immutable and named by their content, so a snapshot of the
// database plus the files it names is a consistent whole even though the files are read a little later.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createBackup, verifyDatabaseFile } from './backup.js';
import { SCHEMA_VERSION, openDb } from './db.js';
import { ZipReader, ZipWriter } from './zip-stream.js';
import { DOC_FORMAT } from '../shared/doc.js';

export const BUNDLE_FORMAT = 'gordonite-bundle';
export const BUNDLE_FORMAT_VERSION = 1;
const MANIFEST = 'bundle.json';
const DB_ENTRY = 'hq.sqlite';
const SHA_RE = /^[0-9a-f]{64}$/;

const sqlString = (s) => `'${s.replace(/'/g, "''")}'`;
const filePathOf = (filesDir, sha) => path.join(filesDir, sha.slice(0, 2), sha);
const entryOf = (sha) => `files/${sha.slice(0, 2)}/${sha}`;

function sha256OfFile(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    fs.createReadStream(file).on('data', (c) => hash.update(c)).on('error', reject).on('end', () => resolve(hash.digest('hex')));
  });
}

async function sha256OfStream(stream) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of stream) hash.update(chunk);
  return hash.digest('hex');
}

// Every distinct stored file the database refers to, with the attachment records that use it.
function referencedFiles(dbFile) {
  const db = new DatabaseSync(dbFile, { readOnly: true });
  try {
    const has = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='attachments'").get();
    const byHash = new Map();
    const add = (sha, size, id, role) => {
      if (!SHA_RE.test(sha ?? '')) return;
      const item = byHash.get(sha) ?? { sha256: sha, size, attachments: [] };
      item.attachments.push(`${id}:${role}`);
      byHash.set(sha, item);
    };
    if (has) {
      for (const r of db.prepare('SELECT id, sha256, size, original_sha256, original_size FROM attachments').all()) {
        add(r.sha256, r.size, r.id, 'content');
        if (r.original_sha256) add(r.original_sha256, r.original_size, r.id, 'original');
      }
    }
    const count = (sql) => db.prepare(sql).get().c;
    return {
      files: [...byHash.values()],
      attachments: has ? count('SELECT COUNT(*) c FROM attachments') : 0,
      counts: {
        notes: count('SELECT COUNT(*) c FROM notes WHERE deleted_at IS NULL'),
        trashed: count('SELECT COUNT(*) c FROM notes WHERE deleted_at IS NOT NULL'),
        tags: count('SELECT COUNT(*) c FROM tags'),
        versions: count('SELECT COUNT(*) c FROM note_versions'),
      },
    };
  } finally {
    db.close();
  }
}

/**
 * Write a bundle of the live database and its files to `out` (any Writable: a response, a file).
 * Resolves to the manifest. `appVersion` is recorded in it. Files the database knows about but the disk does not have
 * are listed in `manifest.missing` and the bundle says `complete: false`; the bundle is still written, because the
 * notes in it are worth having.
 */
export async function writeBundle(db, cfg, out, { appVersion = null, now = new Date() } = {}) {
  fs.mkdirSync(cfg.backupDir, { recursive: true });
  const tmp = path.join(cfg.backupDir, `bundle-${process.pid}-${Date.now()}.sqlite.tmp`);
  try {
    db.exec(`VACUUM INTO ${sqlString(tmp)}`);
    const check = verifyDatabaseFile(tmp);
    if (!check.ok) throw new Error(`the database snapshot failed verification: ${check.error}`);
    const dbSha = await sha256OfFile(tmp);
    const dbSize = fs.statSync(tmp).size;
    const known = referencedFiles(tmp);

    const present = [];
    const missing = [];
    for (const f of known.files) {
      const p = filePathOf(cfg.filesDir, f.sha256);
      let st = null;
      try {
        st = fs.statSync(p);
      } catch {
        /* not there */
      }
      if (!st || !st.isFile()) missing.push({ sha256: f.sha256, size: f.size, attachments: f.attachments, reason: 'not on the server' });
      else if (st.size !== f.size) missing.push({ sha256: f.sha256, size: f.size, attachments: f.attachments, reason: `on the server it is ${st.size} bytes, not ${f.size}` });
      else present.push({ ...f, path: entryOf(f.sha256) });
    }

    const manifest = {
      format: BUNDLE_FORMAT,
      formatVersion: BUNDLE_FORMAT_VERSION,
      createdAt: now.toISOString(),
      app: { version: appVersion, schemaVersion: SCHEMA_VERSION, docFormat: DOC_FORMAT },
      database: { entry: DB_ENTRY, size: dbSize, sha256: dbSha },
      counts: { ...known.counts, attachments: known.attachments, files: present.length },
      complete: missing.length === 0,
      files: present,
      missing,
    };

    const zip = new ZipWriter(out, { when: now });
    await zip.addBuffer(MANIFEST, JSON.stringify(manifest, null, 1), { deflate: true });
    await zip.addFile(DB_ENTRY, tmp, { deflate: true });
    for (const f of present) await zip.addFile(f.path, filePathOf(cfg.filesDir, f.sha256));
    await zip.finish();
    return manifest;
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

/** Write a bundle to a file, only giving it its final name once it is complete. Resolves to { file, size, manifest }. */
export async function createBundleFile(db, cfg, file, options = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const part = `${file}.part`;
  try {
    const out = fs.createWriteStream(part);
    const failed = new Promise((_, reject) => out.once('error', reject));
    const manifest = await Promise.race([writeBundle(db, cfg, out, options), failed]);
    fs.renameSync(part, file);
    return { file, size: fs.statSync(file).size, manifest };
  } catch (err) {
    fs.rmSync(part, { force: true });
    throw err;
  }
}

/**
 * Check a bundle on its own, without touching anything. Resolves to
 * { ok, complete, problems: [{ kind, message, path? }], manifest }.
 * `hashes: false` skips re-reading every file's bytes (the archive's own CRC is still checked when a file is read).
 */
export async function verifyBundle(file, { hashes = true } = {}) {
  const problems = [];
  const report = (kind, message, extra = {}) => problems.push({ kind, message, ...extra });
  let zip;
  try {
    zip = new ZipReader(file);
  } catch (err) {
    return { ok: false, complete: false, problems: [{ kind: 'archive', message: err.message }], manifest: null };
  }
  let manifest = null;
  let scratch = null;
  try {
    if (!zip.has(MANIFEST)) {
      report('manifest', 'This is not a Gordonite bundle (it has no bundle.json).');
      return { ok: false, complete: false, problems, manifest: null };
    }
    try {
      manifest = JSON.parse((await zip.read(MANIFEST, 32 * 1024 * 1024)).toString('utf8'));
    } catch (err) {
      report('manifest', `The bundle's manifest cannot be read: ${err.message}`);
      return { ok: false, complete: false, problems, manifest: null };
    }
    if (manifest?.format !== BUNDLE_FORMAT) {
      report('manifest', 'This is not a Gordonite bundle.');
      return { ok: false, complete: false, problems, manifest: null };
    }
    if (manifest.formatVersion !== BUNDLE_FORMAT_VERSION) {
      report('manifest', `This bundle is format ${manifest.formatVersion}; this version of Gordonite reads format ${BUNDLE_FORMAT_VERSION}.`);
      return { ok: false, complete: false, problems, manifest };
    }
    if ((manifest.app?.schemaVersion ?? 0) > SCHEMA_VERSION) {
      report('database', `The bundle's database is schema v${manifest.app.schemaVersion}, newer than this app (v${SCHEMA_VERSION}). Update the app first.`);
    }

    // the database
    const dbInfo = manifest.database ?? {};
    const dbEntry = zip.entries.get(DB_ENTRY);
    if (!dbEntry) {
      report('missing', 'The database is not in the bundle.', { path: DB_ENTRY });
    } else {
      scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'gordonite-verify-'));
      const dbCopy = path.join(scratch, DB_ENTRY);
      try {
        await new Promise((resolve, reject) => {
          const w = fs.createWriteStream(dbCopy);
          zip.stream(DB_ENTRY).on('error', reject).pipe(w).on('error', reject).on('finish', resolve);
        });
      } catch (err) {
        report('database', `The database in the bundle cannot be read: ${err.message}`, { path: DB_ENTRY });
      }
      if (fs.existsSync(dbCopy)) {
        if (dbEntry.size !== dbInfo.size) report('size', `The database is ${dbEntry.size} bytes but the manifest says ${dbInfo.size}.`, { path: DB_ENTRY });
        if (hashes && (await sha256OfFile(dbCopy)) !== dbInfo.sha256) report('hash', 'The database does not match its SHA-256 in the manifest (it is damaged).', { path: DB_ENTRY });
        const check = verifyDatabaseFile(dbCopy);
        if (!check.ok) report('database', `The database in the bundle is not usable: ${check.error}`, { path: DB_ENTRY });
        else {
          // the manifest must name every file the database refers to
          const listed = new Set((manifest.files ?? []).map((f) => f.sha256));
          const unlisted = new Set((manifest.missing ?? []).map((f) => f.sha256));
          for (const f of referencedFiles(dbCopy).files) {
            if (!listed.has(f.sha256) && !unlisted.has(f.sha256)) report('manifest', `A file the database refers to is not in the manifest.`, { path: entryOf(f.sha256) });
          }
        }
      }
    }

    // the files
    for (const f of manifest.files ?? []) {
      if (!SHA_RE.test(f.sha256 ?? '') || f.path !== entryOf(f.sha256)) {
        report('manifest', 'The manifest lists a file with an invalid name.', { path: String(f.path) });
        continue;
      }
      const entry = zip.entries.get(f.path);
      if (!entry) {
        report('missing', 'A file the manifest lists is not in the bundle.', { path: f.path });
        continue;
      }
      if (entry.size !== f.size) {
        report('size', `${f.path} is ${entry.size} bytes but the manifest says ${f.size}.`, { path: f.path });
        continue;
      }
      if (hashes) {
        try {
          const sha = await sha256OfStream(zip.stream(f.path));
          if (sha !== f.sha256) report('hash', `${f.path} does not match its SHA-256 (the data is damaged).`, { path: f.path });
        } catch (err) {
          report('hash', err.message, { path: f.path });
        }
      }
    }

    // the files the server itself could not find when the bundle was made
    for (const m of manifest.missing ?? []) {
      report('incomplete', `A file was missing on the server when this bundle was made (${m.reason}); the notes that use it will show a broken file.`, { path: entryOf(m.sha256) });
    }

    const damaged = problems.some((p) => p.kind !== 'incomplete');
    return { ok: !damaged && problems.length === 0, complete: manifest.complete === true && !damaged, damaged, problems, manifest };
  } finally {
    zip.close();
    if (scratch) fs.rmSync(scratch, { recursive: true, force: true });
  }
}

/**
 * Put a verified bundle in place of the live data.
 *
 * Order matters, so that a failure at any step leaves the current data usable:
 *   1. verify the bundle completely (nothing is touched if it is damaged);
 *   2. save the current database as a "prerestore" backup;
 *   3. add the bundle's files to the files folder (only the ones that are missing or damaged; nothing is ever
 *      deleted, and each file is written under a temporary name and checked before it takes its real one);
 *   4. replace the database (the app must be stopped), then open it so any pending migration runs, and check it.
 * Resolves to { filesAdded, filesPresent, prerestore, manifest }.
 */
export async function restoreBundle(file, cfg, { allowIncomplete = false, hashes = true } = {}) {
  const check = await verifyBundle(file, { hashes });
  if (check.damaged || !check.manifest) {
    const detail = check.problems.map((p) => p.message).join(' ');
    throw new Error(`The bundle is not usable, so nothing was changed. ${detail}`);
  }
  if (!check.complete && !allowIncomplete) {
    throw new Error('The bundle is incomplete (some files were missing on the server when it was made). Nothing was changed. Run again with --allow-incomplete to restore what it has.');
  }
  const manifest = check.manifest;
  const zip = new ZipReader(file);
  try {
    let prerestore = null;
    if (fs.existsSync(cfg.dbFile)) {
      const live = openDb(cfg.dbFile);
      try {
        prerestore = createBackup(live, cfg, 'prerestore').file;
      } finally {
        live.close();
      }
    }

    let filesAdded = 0;
    let filesPresent = 0;
    for (const f of manifest.files) {
      const target = filePathOf(cfg.filesDir, f.sha256);
      let okAlready = false;
      try {
        okAlready = fs.statSync(target).size === f.size && (!hashes || (await sha256OfFile(target)) === f.sha256);
      } catch {
        /* not there */
      }
      if (okAlready) {
        filesPresent++;
        continue;
      }
      const part = `${target}.part`;
      try {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        await new Promise((resolve, reject) => {
          const w = fs.createWriteStream(part);
          zip.stream(f.path).on('error', reject).pipe(w).on('error', reject).on('finish', resolve);
        });
        if ((await sha256OfFile(part)) !== f.sha256) throw new Error(`${f.path} does not match its SHA-256`);
        fs.renameSync(part, target);
        filesAdded++;
      } catch (err) {
        fs.rmSync(part, { force: true });
        throw new Error(`Could not put ${f.path} in place: ${err.message}. The files already added are harmless; the database was not replaced.`);
      }
    }

    fs.mkdirSync(path.dirname(cfg.dbFile), { recursive: true });
    const staged = `${cfg.dbFile}.restore-tmp`;
    try {
      await new Promise((resolve, reject) => {
        const w = fs.createWriteStream(staged);
        zip.stream(DB_ENTRY).on('error', reject).pipe(w).on('error', reject).on('finish', resolve);
      });
      const staging = verifyDatabaseFile(staged);
      if (!staging.ok) throw new Error(`the database in the bundle failed verification: ${staging.error}`);
      for (const ext of ['-wal', '-shm']) fs.rmSync(cfg.dbFile + ext, { force: true });
      fs.renameSync(staged, cfg.dbFile);
    } catch (err) {
      fs.rmSync(staged, { force: true });
      throw new Error(`${err.message}. The current database was not replaced.`);
    }
    const reopened = openDb(cfg.dbFile); // runs any pending migration
    reopened.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    reopened.close();
    const after = verifyDatabaseFile(cfg.dbFile);
    if (!after.ok) throw new Error(`The restored database failed verification: ${after.error}`);
    return { filesAdded, filesPresent, prerestore, manifest, database: after };
  } finally {
    zip.close();
  }
}
