// The workspace bundle: one file that restores the notes and their photos and PDFs together.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer, para, docOf } from './helpers.js';
import { createBundleFile, restoreBundle, verifyBundle, BUNDLE_FORMAT } from '../../server/bundle.js';
import { ZipReader } from '../../server/zip-stream.js';
import { loadConfig } from '../../server/config.js';
import { openDb } from '../../server/db.js';
import { createApp } from '../../server/app.js';
import { FileStore } from '../../server/files.js';
import { uuid } from '../../shared/ids.js';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n');
const HEIC = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypheic'), Buffer.alloc(4), Buffer.from('mif1heic')]);
const FAKE_JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('converted jpeg bytes'), Buffer.from([0xff, 0xd9])]);

const scratch = [];
const tempDir = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-bundle-'));
  scratch.push(d);
  return d;
};
after(() => scratch.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

const attachmentNode = (a) => ({ type: 'attachment', attrs: { id: a.id, name: a.name, mime: a.mime, size: a.size } });
const save = (t, id, doc, { base = 0, date = '2026-10-05', tags = ['journal'], keepPrevious } = {}) =>
  t.api('PUT', `/api/notes/${id}`, { baseRevision: base, doc, docFormat: 2, tags, date, opId: uuid(), keepPrevious });

// A workspace with: a note holding a PNG and a PDF, a note in the trash, a note whose old version holds a photo that
// was later taken out of it, a HEIC photo whose original is kept, and a file removed from the Files page.
async function populate(t) {
  const png = (await t.upload('Kitchen.png', PNG)).json.attachment;
  const pdf = (await t.upload('Lease.pdf', PDF)).json.attachment;
  const heic = (await t.upload('IMG_4021.HEIC', HEIC)).json.attachment;
  const removed = (await t.upload('Old receipt.pdf', Buffer.concat([PDF, Buffer.from('% removed\n')]))).json.attachment;

  const live = uuid();
  assert.equal((await save(t, live, docOf(para('move-in'), attachmentNode(png), attachmentNode(pdf), para('')))).status, 200);
  const trashed = uuid();
  assert.equal((await save(t, trashed, docOf(para('in the trash'), attachmentNode(heic), para('')), { date: '2026-10-06' })).status, 200);
  assert.equal((await t.api('DELETE', `/api/notes/${trashed}`)).status, 200);
  // a photo that only an older version of a note still shows
  const edited = uuid();
  const first = await save(t, edited, docOf(para('draft with a photo that was cut'), attachmentNode(removed), para('')), { date: '2026-10-07' });
  assert.equal(first.status, 200);
  const second = await save(t, edited, docOf(para('the photo was cut from the note')), { base: first.json.revision, date: '2026-10-07', keepPrevious: true });
  assert.equal(second.status, 200);
  assert.equal((await t.api('DELETE', `/api/attachments/${removed.id}`)).status, 200);
  return { png, pdf, heic, removed, live, trashed, edited };
}

// The data folder `dir` as a running app, so what was restored can be used the way a person would.
async function bootOn(config) {
  const db = openDb(config.dbFile);
  const { server, files } = createApp({ config, db, log: { log() {}, error() {} } });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}`;
  const json = async (p) => (await fetch(url + p)).json();
  const bytes = async (p) => Buffer.from(await (await fetch(url + p)).arrayBuffer());
  return { url, db, files, json, bytes, close: async () => (await new Promise((r) => server.close(r)), db.close()) };
}

const configFor = (dir, extra = {}) => loadConfig({ DATA_DIR: dir, BACKUP_INTERVAL_HOURS: '0', STATIC_DIR: path.join(dir, 'none'), ...extra });
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

describe('a bundle of a whole workspace', () => {
  let t;
  let made;
  let bundleFile;
  let result;
  before(async () => {
    t = await startServer({}, { convertHeic: async () => FAKE_JPEG });
    made = await populate(t);
    bundleFile = path.join(tempDir(), 'workspace.zip');
    result = await createBundleFile(t.db, t.config, bundleFile, { appVersion: '9.9.9' });
  });
  after(() => t.close());

  test('holds the database, a manifest, and every file the database knows about', async () => {
    const m = result.manifest;
    assert.equal(m.format, BUNDLE_FORMAT);
    assert.equal(m.app.version, '9.9.9');
    assert.equal(m.complete, true);
    assert.deepEqual(m.missing, []);
    // PNG, PDF, the HEIC's JPEG and its original, the removed receipt
    assert.equal(m.files.length, 5);
    assert.equal(m.counts.attachments, 4);
    assert.equal(m.counts.trashed, 1);
    assert.ok(m.counts.versions >= 1);
    const zip = new ZipReader(bundleFile);
    for (const f of m.files) assert.ok(zip.has(f.path), f.path);
    assert.ok(zip.has('hq.sqlite') && zip.has('bundle.json'));
    zip.close();
  });

  test('includes the original of a converted photo, a removed file, and files used only by trash or an old version', () => {
    const shas = new Set(result.manifest.files.map((f) => f.sha256));
    assert.ok(shas.has(sha(HEIC)), 'the HEIC original');
    assert.ok(shas.has(sha(FAKE_JPEG)), 'the converted JPEG');
    assert.ok(shas.has(sha(Buffer.concat([PDF, Buffer.from('% removed\n')]))), 'the removed receipt');
  });

  test('verifies on its own, quickly or by re-reading every byte', async () => {
    const full = await verifyBundle(bundleFile);
    assert.deepEqual(full.problems, []);
    assert.equal(full.ok, true);
    assert.equal(full.complete, true);
    assert.equal((await verifyBundle(bundleFile, { hashes: false })).ok, true);
  });

  test('restores into an empty folder: notes, trash, history and every file come back and open', async () => {
    const dir = tempDir();
    const config = configFor(dir);
    const restored = await restoreBundle(bundleFile, config);
    assert.equal(restored.filesAdded, 5);
    assert.equal(restored.prerestore, null, 'nothing was there to save');
    assert.equal(restored.database.notes, 2);
    assert.equal(restored.database.trashed, 1);

    const app = await bootOn(config);
    try {
      assert.equal((await app.json(`/api/notes/${made.live}`)).note.doc.content[1].attrs.id, made.png.id);
      assert.equal((await app.bytes(`/api/attachments/${made.png.id}/file`)).equals(PNG), true);
      assert.equal((await app.bytes(`/api/attachments/${made.pdf.id}/file`)).equals(PDF), true);
      assert.equal((await app.bytes(`/api/attachments/${made.heic.id}/file`)).equals(FAKE_JPEG), true);
      assert.equal((await app.bytes(`/api/attachments/${made.heic.id}/original`)).equals(HEIC), true, 'the HEIC original');
      // trash and history still point at files that are there
      assert.equal((await app.json('/api/trash')).notes.length, 1);
      const versions = (await app.json(`/api/notes/${made.edited}/versions`)).versions;
      assert.ok(versions.length >= 1);
      // a removed file can be brought back, and its bytes are there
      const back = await fetch(`${app.url}/api/attachments/${made.removed.id}/restore`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      assert.equal(back.status, 200);
      assert.equal((await app.bytes(`/api/attachments/${made.removed.id}/file`)).length, PDF.length + '% removed\n'.length);
      const check = new FileStore(app.db, config).check({ hashes: true });
      assert.equal(check.ok, true, JSON.stringify(check.problems));
    } finally {
      await app.close();
    }
  });

  test('works with the files kept in a different folder from the database', async () => {
    const dir = tempDir();
    const filesDir = path.join(tempDir(), 'photos');
    const config = configFor(dir, { FILES_DIR: filesDir });
    const restored = await restoreBundle(bundleFile, config);
    assert.equal(restored.filesAdded, 5);
    assert.equal(fs.existsSync(path.join(filesDir, sha(PNG).slice(0, 2), sha(PNG))), true);
    assert.equal(fs.existsSync(path.join(dir, 'files')), false, 'nothing was put in the default place');
  });

  test('is additive and reversible: files already there stay, extra files are never deleted, the old database is saved', async () => {
    const dir = tempDir();
    const config = configFor(dir);
    // a different workspace is already here
    const existing = await startServer({ DATA_DIR: dir });
    await save(existing, uuid(), docOf(para('a note that is already here')), { date: '2026-09-01', tags: ['other'] });
    await existing.upload('Stray.png', Buffer.concat([PNG, Buffer.from('stray')]));
    const strayBytes = Buffer.concat([PNG, Buffer.from('stray')]);
    const strayPath = path.join(config.filesDir, sha(strayBytes).slice(0, 2), sha(strayBytes));
    assert.equal(fs.existsSync(strayPath), true);
    await existing.stop();

    const restored = await restoreBundle(bundleFile, config);
    assert.ok(restored.prerestore, 'the database that was here was saved first');
    assert.equal(fs.existsSync(path.join(config.backupDir, restored.prerestore)), true);
    assert.equal(fs.existsSync(strayPath), true, 'a file the bundle does not mention is left alone');
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('a bundle that is not whole', () => {
  let t;
  let made;
  let good;
  before(async () => {
    t = await startServer({}, { convertHeic: async () => FAKE_JPEG });
    made = await populate(t);
    good = path.join(tempDir(), 'good.zip');
    await createBundleFile(t.db, t.config, good);
  });
  after(() => t.close());

  const damagedCopy = (mutate) => {
    const copy = path.join(tempDir(), 'damaged.zip');
    const bytes = Buffer.from(fs.readFileSync(good));
    fs.writeFileSync(copy, mutate(bytes) ?? bytes);
    return copy;
  };

  test('a damaged file is named, and nothing is restored', async () => {
    const zip = new ZipReader(good);
    const target = [...zip.entries.values()].find((e) => e.name.startsWith('files/'));
    zip.close();
    const copy = damagedCopy((bytes) => {
      bytes[target.offset + 30 + Buffer.byteLength(target.name) + 1] ^= 0xff; // a byte inside the file's data
    });
    const check = await verifyBundle(copy);
    assert.equal(check.ok, false);
    assert.equal(check.damaged, true);
    assert.ok(check.problems.some((p) => p.path === target.name && /checksum|SHA-256|damaged/i.test(p.message)), JSON.stringify(check.problems));

    const dir = tempDir();
    await assert.rejects(restoreBundle(copy, configFor(dir)), /not usable, so nothing was changed/);
    assert.equal(fs.existsSync(path.join(dir, 'hq.sqlite')), false);
  });

  test('a bundle cut off before its end says it was cut off', async () => {
    const copy = damagedCopy((bytes) => bytes.subarray(0, bytes.length - 100));
    const check = await verifyBundle(copy);
    assert.equal(check.ok, false);
    assert.match(check.problems[0].message, /not a complete ZIP|cut off|only partly copied/);
  });

  test('something that is not a bundle says so', async () => {
    const other = path.join(tempDir(), 'notes.txt');
    fs.writeFileSync(other, 'hello there '.repeat(10));
    assert.equal((await verifyBundle(other)).ok, false);
    const { ZipWriter } = await import('../../server/zip-stream.js');
    const zipFile = path.join(tempDir(), 'plain.zip');
    const w = new ZipWriter(fs.createWriteStream(zipFile));
    await w.addBuffer('readme.txt', 'just a zip');
    await w.finish();
    const check = await verifyBundle(zipFile);
    assert.match(check.problems[0].message, /not a Gordonite bundle/);
  });

  test('a file that was missing on the server is listed, and restoring needs a deliberate choice', async () => {
    // lose a file on the server, then make a bundle
    const pdfSha = sha(PDF);
    const lost = path.join(t.config.filesDir, pdfSha.slice(0, 2), pdfSha);
    const kept = fs.readFileSync(lost);
    fs.rmSync(lost);
    const incomplete = path.join(tempDir(), 'incomplete.zip');
    try {
      const { manifest } = await createBundleFile(t.db, t.config, incomplete);
      assert.equal(manifest.complete, false);
      assert.equal(manifest.missing.length, 1);
      assert.equal(manifest.missing[0].sha256, pdfSha);
    } finally {
      fs.mkdirSync(path.dirname(lost), { recursive: true });
      fs.writeFileSync(lost, kept);
    }
    const check = await verifyBundle(incomplete);
    assert.equal(check.damaged, false, 'what is in it is intact');
    assert.equal(check.complete, false);
    assert.ok(check.problems.some((p) => p.kind === 'incomplete'));

    const dir = tempDir();
    await assert.rejects(restoreBundle(incomplete, configFor(dir)), /incomplete/);
    assert.equal(fs.existsSync(path.join(dir, 'hq.sqlite')), false, 'nothing changed');
    const restored = await restoreBundle(incomplete, configFor(dir), { allowIncomplete: true });
    assert.equal(restored.filesAdded, 4);
  });

  test('a restore that cannot finish leaves the current database as it was', async () => {
    const dir = tempDir();
    const config = configFor(dir);
    const existing = await startServer({ DATA_DIR: dir });
    const keep = uuid();
    await save(existing, keep, docOf(para('must survive a failed restore')), { date: '2026-09-02', tags: ['other'] });
    await existing.stop();
    // the files folder cannot be created: a file is in its place
    fs.writeFileSync(config.filesDir, 'not a folder');
    await assert.rejects(restoreBundle(good, config), /Could not put/);
    const db = openDb(config.dbFile);
    try {
      assert.equal(db.prepare('SELECT COUNT(*) c FROM notes WHERE id = ?').get(keep).c, 1);
      assert.equal(db.prepare('SELECT COUNT(*) c FROM notes').get().c, 1, 'the bundle’s notes were not put in');
    } finally {
      db.close();
    }
    assert.equal(fs.existsSync(`${config.dbFile}.restore-tmp`), false, 'no half-written database is left');
  });
});

describe('downloading and the command line', () => {
  let t;
  let made;
  before(async () => {
    t = await startServer({}, { convertHeic: async () => FAKE_JPEG });
    made = await populate(t);
  });
  after(() => t.close());

  test('the app streams a bundle that verifies and restores', async () => {
    const res = await fetch(`${t.url}/api/backups/bundle`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'application/zip');
    assert.match(res.headers.get('content-disposition'), /^attachment; filename="gordonite-bundle-\d{4}-\d{2}-\d{2}\.zip"$/);
    const file = path.join(tempDir(), 'downloaded.zip');
    fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    const check = await verifyBundle(file);
    assert.deepEqual(check.problems, []);
    assert.equal(check.manifest.counts.trashed, 1);
    const restored = await restoreBundle(file, configFor(tempDir()));
    assert.equal(restored.filesAdded, 5);
  });

  test('bundle, verify-bundle and restore-bundle work from the command line', async () => {
    const { spawnSync } = await import('node:child_process');
    const cli = path.resolve('server/cli.js');
    const env = { ...process.env, DATA_DIR: t.dir, BACKUP_INTERVAL_HOURS: '0' };
    delete env.FILES_DIR;
    delete env.BACKUP_DIR;
    const run = (args, extra = {}) => spawnSync(process.execPath, [cli, ...args], { env: { ...env, ...extra }, encoding: 'utf8' });

    const out = path.join(tempDir(), 'cli-bundle.zip');
    const made1 = run(['bundle', out]);
    assert.equal(made1.status, 0, made1.stdout + made1.stderr);
    assert.match(made1.stdout, /OK: complete, and verified/);
    assert.match(made1.stdout, /5 stored file\(s\)/);

    const checked = run(['verify-bundle', out]);
    assert.equal(checked.status, 0, checked.stderr);
    assert.match(checked.stdout, /every file matches its SHA-256/);
    assert.equal(run(['verify-bundle', out, '--quick']).status, 0);

    // a damaged copy is refused with a non-zero exit
    const bad = path.join(tempDir(), 'bad.zip');
    fs.writeFileSync(bad, fs.readFileSync(out).subarray(0, 1000));
    const refused = run(['verify-bundle', bad]);
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /NOT OK/);

    // restore needs --yes, and says what it will do
    const target = tempDir();
    const asks = run(['restore-bundle', out], { DATA_DIR: target });
    assert.equal(asks.status, 1);
    assert.match(asks.stderr, /re-run with --yes/);
    assert.equal(fs.existsSync(path.join(target, 'hq.sqlite')), false);
    const done = run(['restore-bundle', out, '--yes'], { DATA_DIR: target });
    assert.equal(done.status, 0, done.stdout + done.stderr);
    assert.match(done.stdout, /5 file\(s\) added/);
    const app = await bootOn(configFor(target));
    try {
      assert.equal((await app.bytes(`/api/attachments/${made.pdf.id}/file`)).equals(PDF), true);
    } finally {
      await app.close();
    }
  });

  test('without a name the bundle goes in backups/bundles and only the newest few are kept', async () => {
    const { spawnSync } = await import('node:child_process');
    const dir = tempDir();
    const config = configFor(dir);
    const live = await startServer({ DATA_DIR: dir });
    await save(live, uuid(), docOf(para('one note')), { tags: ['x'] });
    await live.stop();
    const env = { ...process.env, DATA_DIR: dir, BACKUP_INTERVAL_HOURS: '0' };
    delete env.FILES_DIR;
    delete env.BACKUP_DIR;
    // older bundles that are already there
    const folder = path.join(config.backupDir, 'bundles');
    fs.mkdirSync(folder, { recursive: true });
    for (const stamp of ['20260101-000000', '20260102-000000', '20260103-000000']) fs.writeFileSync(path.join(folder, `gordonite-bundle-${stamp}.zip`), 'old');
    fs.writeFileSync(path.join(folder, 'my-own-notes.txt'), 'not a bundle');
    const run = spawnSync(process.execPath, [path.resolve('server/cli.js'), 'bundle', '--keep', '2'], { env, encoding: 'utf8' });
    assert.equal(run.status, 0, run.stdout + run.stderr);
    const names = fs.readdirSync(folder).sort();
    assert.equal(names.filter((n) => n.endsWith('.zip')).length, 2, names.join(', '));
    assert.ok(names.includes('my-own-notes.txt'), 'files that are not bundles are never touched');
    assert.ok(names.some((n) => n > 'gordonite-bundle-2026' && /gordonite-bundle-20\d{6}-\d{6}\.zip/.test(n)));
  });
});
