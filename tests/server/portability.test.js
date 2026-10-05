import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
import { startServer, save, para, docOf, task } from './helpers.js';
import { docToMarkdown } from '../../server/markdown.js';
import { makeZip } from '../../server/zip.js';
import { listBackups } from '../../server/backup.js';
import { uuid } from '../../shared/ids.js';

// Tiny ZIP reader for tests (stored entries only).
function readZip(buf) {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = {};
  for (let i = 0; i < count; i++) {
    assert.equal(buf.readUInt32LE(p), 0x02014b50);
    const crc = buf.readUInt32LE(p + 16);
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const off = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    const lh = off + 30 + buf.readUInt16LE(off + 26) + buf.readUInt16LE(off + 28);
    const data = buf.subarray(lh, lh + size);
    assert.equal(zlib.crc32(data), crc, `crc of ${name}`);
    out[name] = data.toString('utf8');
    p += 46 + nameLen;
  }
  return out;
}

const bold = [{ type: 'bold' }];
const italic = [{ type: 'italic' }];
const t = (text, marks) => ({ type: 'text', text, ...(marks ? { marks } : {}) });

describe('markdown', () => {
  test('headings, marks, lists and tasks', () => {
    const doc = docOf(
      { type: 'heading', attrs: { level: 2 }, content: [t('Plan')] },
      { type: 'paragraph', content: [t('plain '), t('bold', bold), t(' and '), t('italic', italic), t(' and '), t('both', [...bold, ...italic])] },
      { type: 'bulletList', content: [{ type: 'listItem', content: [para('one')] }, { type: 'listItem', content: [para('two')] }] },
      { type: 'taskList', content: [task('open'), task('done', true)] },
    );
    assert.equal(
      docToMarkdown(doc),
      '## Plan\n\nplain **bold** and *italic* and ***both***\n\n- one\n- two\n\n- [ ] open\n- [x] done\n',
    );
  });

  test('marker whitespace, adjacent runs and escaping', () => {
    const doc = docOf(
      { type: 'paragraph', content: [t('a ', bold), t('b', bold), t(' ', bold), t('c')] },
      para('1 * 2 _ 3 # not heading'),
      para('# looks like a heading'),
    );
    assert.equal(docToMarkdown(doc), '**a b** c\n\n1 \\* 2 \\_ 3 # not heading\n\n\\# looks like a heading\n');
  });

  test('nested bullets and hard breaks', () => {
    const doc = docOf({
      type: 'bulletList',
      content: [
        {
          type: 'listItem',
          content: [para('parent'), { type: 'bulletList', content: [{ type: 'listItem', content: [para('child')] }] }],
        },
      ],
    }, { type: 'paragraph', content: [t('line1'), { type: 'hardBreak' }, t('line2')] });
    assert.equal(docToMarkdown(doc), '- parent\n  - child\n\nline1  \nline2\n');
  });

  test('zip writer produces a readable archive', () => {
    const files = readZip(makeZip([{ name: 'a/b.md', data: 'héllo' }, { name: 'c.txt', data: 'x' }]));
    assert.deepEqual(files, { 'a/b.md': 'héllo', 'c.txt': 'x' });
  });
});

async function seed(srv) {
  const a = uuid();
  await save(srv, a, docOf(para('Shared note'), { type: 'taskList', content: [task('t1', true), task('t2')] }), {
    tags: ['daily-jots', 'school/fall26'],
    date: '2026-10-05',
  });
  srv.db.prepare('UPDATE notes SET last_snapshot_at = ? WHERE id = ?').run('2020-01-01T00:00:00.000Z', a); // let a version be recorded
  await save(srv, a, docOf(para('Shared note, edited with enough text to be notable'), { type: 'taskList', content: [task('t1', true)] }), {
    base: 1,
    tags: ['daily-jots', 'school/fall26'],
  });
  const b = uuid();
  await save(srv, b, docOf(para('Other day')), { tags: ['daily-jots'], date: '2026-10-04' });
  const trashed = uuid();
  await save(srv, trashed, docOf(para('in the trash')), { tags: ['school/fall26'], date: '2026-10-03' });
  await srv.api('DELETE', `/api/notes/${trashed}`);
  return { a, b, trashed };
}

const exportOf = async (srv) => JSON.parse((await srv.api('GET', '/api/export/json')).text);
const strip = (x) => ({ ...x, exportedAt: 0 });

describe('export / import', () => {
  test('JSON export -> replace-import into a fresh server is lossless (notes, tasks, tags, versions, trash)', async () => {
    const a = await startServer();
    const b = await startServer();
    try {
      await seed(a);
      const exported = await exportOf(a);
      assert.equal(exported.format, 'hq-export');
      assert.equal(exported.notes.length, 3);
      assert.ok(exported.notes.some((n) => n.deletedAt), 'trash included');
      assert.ok(exported.notes.some((n) => n.versions.length > 0), 'versions included');
      const r = await b.api('POST', '/api/import?mode=replace', exported);
      assert.equal(r.status, 200, r.text);
      assert.equal(r.json.notesCreated, 3);
      assert.deepEqual(strip(await exportOf(b)), strip(exported));
      // streams work on the imported data, trash stays trash
      assert.equal((await b.api('GET', '/api/stream?tag=daily-jots')).json.notes.length, 2);
      assert.equal((await b.api('GET', '/api/trash')).json.notes.length, 1);
    } finally {
      await a.close();
      await b.close();
    }
  });

  test('replace takes a pre-import backup so even a mistaken import is undoable', async () => {
    const a = await startServer();
    const b = await startServer();
    try {
      await seed(a);
      await save(b, uuid(), docOf(para('precious local note')), { tags: ['local'], date: '2026-01-01' });
      const r = await b.api('POST', '/api/import?mode=replace', await exportOf(a));
      assert.equal(r.status, 200);
      assert.equal((await b.api('GET', '/api/stream?tag=local')).json.notes.length, 0);
      const pre = listBackups(b.config).find((x) => x.kind === 'preimport');
      assert.ok(pre, 'pre-import backup exists');
      assert.equal(r.json.preImportBackup, pre.file);
    } finally {
      await a.close();
      await b.close();
    }
  });

  test('merge never overwrites: identical skipped, different content kept as a version, new notes added', async () => {
    const a = await startServer();
    const b = await startServer();
    try {
      const ids = await seed(a);
      const snapshot = await exportOf(a);
      // b already has note "a" with different content and an extra note of its own
      await save(b, ids.a, docOf(para('B edited this differently')), { tags: ['daily-jots', 'school/fall26'], date: '2026-10-05' });
      await save(b, uuid(), docOf(para('only on b')), { tags: ['b-only'], date: '2026-02-02' });
      const r = await b.api('POST', '/api/import?mode=merge', snapshot);
      assert.equal(r.status, 200, r.text);
      assert.equal(r.json.notesKeptBothVersions, 1);
      assert.equal(r.json.notesCreated, 2);
      const kept = (await b.api('GET', `/api/notes/${ids.a}`)).json.note;
      assert.match(JSON.stringify(kept.doc), /B edited this differently/);
      const versions = (await b.api('GET', `/api/notes/${ids.a}/versions`)).json.versions;
      assert.ok(versions.some((v) => v.kind === 'import' && v.preview.startsWith('Shared note, edited')));
      assert.equal((await b.api('GET', '/api/stream?tag=b-only')).json.notes.length, 1);
      // importing the same file again changes nothing
      const again = await b.api('POST', '/api/import?mode=merge', snapshot);
      assert.equal(again.json.notesCreated, 0);
    } finally {
      await a.close();
      await b.close();
    }
  });

  test('merge: a different note already holding the tag+date slot keeps the imported text as a version', async () => {
    const a = await startServer();
    const b = await startServer();
    try {
      const ids = await seed(a);
      const holder = uuid();
      await save(b, holder, docOf(para('holder')), { tags: ['school/fall26'], date: '2026-10-04' });
      // import note b (daily-jots 2026-10-04) retagged to collide
      const snap = await exportOf(a);
      const nb = snap.notes.find((n) => n.id === ids.b);
      const other = snap.tags.find((x) => x.path === 'school/fall26');
      nb.tags = [other.id];
      const r = await b.api('POST', '/api/import?mode=merge', snap);
      assert.equal(r.status, 200, r.text);
      assert.equal(r.json.membershipsDropped.length >= 1, true);
      const versions = (await b.api('GET', `/api/notes/${holder}/versions`)).json.versions;
      assert.ok(versions.some((v) => v.kind === 'import' && v.preview === 'Other day'));
    } finally {
      await a.close();
      await b.close();
    }
  });

  test('invalid imports are rejected before anything changes', async () => {
    const a = await startServer();
    try {
      await save(a, uuid(), docOf(para('keep me')), { tags: ['x'], date: '2026-01-01' });
      const bad = [
        {},
        { format: 'hq-export', formatVersion: 99, tags: [], notes: [] },
        { format: 'hq-export', formatVersion: 1, tags: [], notes: [{ id: uuid(), date: '2026-01-01', doc: docOf(), docFormat: 1, tags: ['nope'] }] },
        { format: 'hq-export', formatVersion: 1, tags: [{ id: uuid(), path: 'a' }], notes: [{ id: uuid(), date: '2026-01-01', doc: { type: 'doc', content: [{ type: 'script' }] }, docFormat: 1, tags: [] }] },
      ];
      for (const body of bad) {
        const r = await a.api('POST', '/api/import?mode=replace', body);
        assert.equal(r.status, 400, JSON.stringify(body).slice(0, 60));
      }
      assert.equal((await a.api('GET', '/api/stream?tag=x')).json.notes.length, 1);
      assert.equal(listBackups(a.config).length, 0, 'no pre-import backup for invalid files');
    } finally {
      await a.close();
    }
  });

  test('Markdown export: one file per tag per day with front matter, trash excluded', async () => {
    const a = await startServer();
    try {
      await seed(a);
      const res = await fetch(`${a.url}/api/export/markdown`);
      assert.equal(res.headers.get('content-type'), 'application/zip');
      const files = readZip(Buffer.from(await res.arrayBuffer()));
      assert.deepEqual(Object.keys(files).sort(), [
        'README.txt',
        'daily-jots/2026-10-04.md',
        'daily-jots/2026-10-05.md',
        'school/fall26/2026-10-05.md',
      ]);
      const note = files['daily-jots/2026-10-05.md'];
      assert.match(note, /^---\nid: .+\ndate: 2026-10-05\ntags: \[daily-jots, school\/fall26\]/);
      assert.match(note, /Shared note, edited with enough text to be notable\n\n- \[x\] t1\n$/);
      assert.equal(files['daily-jots/2026-10-05.md'], files['school/fall26/2026-10-05.md']);
    } finally {
      await a.close();
    }
  });

  test('database snapshot download is a valid database', async () => {
    const a = await startServer();
    try {
      await seed(a);
      const res = await fetch(`${a.url}/api/backups/snapshot`);
      assert.equal(res.status, 200);
      const file = `${a.dir}/dl.sqlite`;
      fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
      const { verifyDatabaseFile } = await import('../../server/backup.js');
      const v = verifyDatabaseFile(file);
      assert.equal(v.ok, true);
      assert.equal(v.notes, 2);
    } finally {
      await a.close();
    }
  });
});
