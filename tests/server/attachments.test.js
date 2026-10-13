import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startServer, para, docOf } from './helpers.js';
import { uuid } from '../../shared/ids.js';
import { DOC_FORMAT, validateDoc, plainText, isEmptyDoc } from '../../shared/doc.js';
import { markdownToDoc } from '../../shared/markdown-import.js';
import { docToMarkdown } from '../../server/markdown.js';
import { sniff } from '../../server/files.js';
import { cleanFileName, formatBytes, kindOfType } from '../../shared/attachments.js';

// Real bytes, small enough to keep in the test: a 1x1 PNG, a minimal PDF, and the start of a HEIC file.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n');
const HEIC = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypheic'), Buffer.alloc(4), Buffer.from('mif1heic')]);
const FAKE_JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('converted jpeg bytes'), Buffer.from([0xff, 0xd9])]);

const attachmentNode = (a) => ({ type: 'attachment', attrs: { id: a.id, name: a.name, mime: a.mime, size: a.size } });
const saveWith = (t, id, doc, { base = 0, docFormat = DOC_FORMAT, tags = ['daily-jots'] } = {}) =>
  t.api('PUT', `/api/notes/${id}`, { baseRevision: base, doc, docFormat, tags, date: '2026-10-05', opId: uuid() });

describe('what a file is is decided from its bytes', () => {
  test('sniff: PDF, images, HEIC, and everything else', () => {
    assert.equal(sniff(PDF, 'x.bin').mime, 'application/pdf');
    assert.equal(sniff(PNG, 'x.pdf').mime, 'image/png', 'bytes win over the name');
    assert.equal(sniff(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]), 'a.jpg').mime, 'image/jpeg');
    assert.equal(sniff(Buffer.from('GIF89a......'), 'a.gif').mime, 'image/gif');
    assert.equal(sniff(Buffer.from('RIFF\0\0\0\0WEBPVP8 '), 'a.webp').mime, 'image/webp');
    assert.deepEqual(sniff(HEIC, 'IMG_1.HEIC'), { mime: 'image/heic', heic: true });
    assert.equal(sniff(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>'), 'a.svg').mime, 'application/octet-stream', 'SVG is never an image');
    assert.equal(sniff(Buffer.from('PK\u0003\u0004'), 'Report.docx').mime, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    assert.equal(sniff(Buffer.from('hello'), 'notes').mime, 'application/octet-stream');
  });

  test('names and sizes are tidied', () => {
    const traversal = cleanFileName('../../etc/passwd');
    assert.ok(!/[\/]/.test(traversal) && !traversal.startsWith('.'), traversal); // folders never survive
    assert.ok(!/[\\/]/.test(cleanFileName('a/b\\c.pdf')));
    assert.equal(cleanFileName('   '), 'file');
    assert.equal(cleanFileName('x'.repeat(300) + '.pdf').length, 200);
    assert.ok(cleanFileName('x'.repeat(300) + '.pdf').endsWith('.pdf'));
    assert.equal(formatBytes(1536), '2 KB');
    assert.equal(formatBytes(5 * 1024 * 1024), '5.0 MB');
    assert.equal(kindOfType('image/png'), 'image');
    assert.equal(kindOfType('image/svg+xml'), 'file');
  });
});

describe('upload and download', () => {
  let t;
  before(async () => {
    t = await startServer({ MAX_UPLOAD_MB: '1' });
  });
  after(() => t.close());

  test('an image is stored once, shown inline, and cached by its content', async () => {
    const up = await t.upload('Kitchen sink.png', PNG);
    assert.equal(up.status, 200);
    const a = up.json.attachment;
    assert.equal(a.kind, 'image');
    assert.equal(a.mime, 'image/png');
    assert.equal(a.size, PNG.length);
    assert.equal(a.name, 'Kitchen sink.png');
    assert.equal(a.noteId, null);

    const res = await fetch(`${t.url}/api/attachments/${a.id}/file`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'image/png');
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.match(res.headers.get('content-disposition'), /^inline;/);
    assert.match(res.headers.get('cache-control'), /immutable/);
    assert.deepEqual(Buffer.from(await res.arrayBuffer()), PNG);

    const again = await fetch(`${t.url}/api/attachments/${a.id}/file`, { headers: { 'if-none-match': res.headers.get('etag') } });
    assert.equal(again.status, 304);
  });

  test('a PDF opens in the browser and supports ranges', async () => {
    const a = (await t.upload('Policy.pdf', PDF)).json.attachment;
    assert.equal(a.kind, 'pdf');
    const res = await fetch(`${t.url}/api/attachments/${a.id}/file`, { headers: { range: 'bytes=0-3' } });
    assert.equal(res.status, 206);
    assert.equal(res.headers.get('content-range'), `bytes 0-3/${PDF.length}`);
    assert.equal(Buffer.from(await res.arrayBuffer()).toString(), '%PDF');
    const last = await fetch(`${t.url}/api/attachments/${a.id}/file`, { headers: { range: 'bytes=-5' } });
    assert.equal(Buffer.from(await last.arrayBuffer()).toString(), PDF.subarray(-5).toString());
    const bad = await fetch(`${t.url}/api/attachments/${a.id}/file`, { headers: { range: `bytes=${PDF.length + 10}-` } });
    assert.equal(bad.status, 416);
    const dl = await fetch(`${t.url}/api/attachments/${a.id}/file?download=1`);
    assert.match(dl.headers.get('content-disposition'), /^attachment;/);
    assert.equal(dl.headers.get('content-type'), 'application/octet-stream');
  });

  test('anything that is not an image or PDF is only ever a sandboxed download', async () => {
    const page = Buffer.from('<html><script>alert(1)</script></html>');
    const a = (await t.upload('page.html', page)).json.attachment;
    assert.equal(a.kind, 'file');
    const res = await fetch(`${t.url}/api/attachments/${a.id}/file`);
    assert.equal(res.headers.get('content-type'), 'application/octet-stream');
    assert.match(res.headers.get('content-disposition'), /^attachment;/);
    assert.match(res.headers.get('content-security-policy'), /sandbox/);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  });

  test('the same bytes are stored once on disk', async () => {
    const one = (await t.upload('first.pdf', Buffer.from('%PDF-dedupe-me'))).json.attachment;
    const two = (await t.upload('second.pdf', Buffer.from('%PDF-dedupe-me'))).json.attachment;
    assert.notEqual(one.id, two.id);
    const sha = t.db.prepare('SELECT sha256 FROM attachments WHERE id = ?').get(one.id).sha256;
    assert.equal(t.db.prepare('SELECT sha256 FROM attachments WHERE id = ?').get(two.id).sha256, sha);
    const dir = path.join(t.config.filesDir, sha.slice(0, 2));
    assert.equal(fs.readdirSync(dir).filter((f) => f === sha).length, 1);
    assert.equal(fs.readdirSync(dir).filter((f) => f.endsWith('.tmp')).length, 0, 'no temporary files left behind');
  });

  test('refused: no header, cross-site, empty, too large', async () => {
    const noHeader = await fetch(`${t.url}/api/attachments?name=x.png`, { method: 'POST', body: PNG });
    assert.equal(noHeader.status, 415);
    const cross = await fetch(`${t.url}/api/attachments?name=x.png`, { method: 'POST', headers: { 'x-gordonite-upload': '1', 'sec-fetch-site': 'cross-site' }, body: PNG });
    assert.equal(cross.status, 403);
    assert.equal((await t.upload('empty.png', Buffer.alloc(0))).status, 400);
    const big = await t.upload('big.pdf', Buffer.concat([Buffer.from('%PDF-'), Buffer.alloc(1024 * 1024 + 10)]));
    assert.equal(big.status, 413);
    assert.equal(big.json.error.code, 'too_large');
  });

  test('list, search by name, filter, and soft delete', async () => {
    const a = (await t.upload('Insurance Policy 2026.pdf', Buffer.from('%PDF-listed'))).json.attachment;
    let list = await t.api('GET', '/api/attachments?q=insurance');
    assert.ok(list.json.attachments.some((x) => x.id === a.id));
    assert.equal((await t.api('GET', '/api/attachments?kind=image')).json.attachments.every((x) => x.kind === 'image'), true);
    assert.equal((await t.api('DELETE', `/api/attachments/${a.id}`)).status, 200);
    list = await t.api('GET', '/api/attachments?q=insurance');
    assert.ok(!list.json.attachments.some((x) => x.id === a.id));
    assert.equal((await fetch(`${t.url}/api/attachments/${a.id}/file`)).status, 404);
    assert.equal((await t.api('DELETE', `/api/attachments/${a.id}`)).status, 404);
  });
});

describe('HEIC photos are converted to JPEG and the original is kept', () => {
  let t;
  before(async () => {
    t = await startServer({}, { convertHeic: async (buf) => (assert.deepEqual(buf, HEIC), FAKE_JPEG) });
  });
  after(() => t.close());

  test('converted on upload; original downloadable', async () => {
    const a = (await t.upload('IMG_4021.HEIC', HEIC)).json.attachment;
    assert.equal(a.mime, 'image/jpeg');
    assert.equal(a.kind, 'image');
    assert.equal(a.name, 'IMG_4021.jpg');
    assert.equal(a.converted, true);
    assert.equal(a.originalName, 'IMG_4021.HEIC');
    assert.equal(a.size, FAKE_JPEG.length);
    const shown = await fetch(`${t.url}/api/attachments/${a.id}/file`);
    assert.equal(shown.headers.get('content-type'), 'image/jpeg');
    assert.deepEqual(Buffer.from(await shown.arrayBuffer()), FAKE_JPEG);
    const original = await fetch(`${t.url}/api/attachments/${a.id}/original`);
    assert.deepEqual(Buffer.from(await original.arrayBuffer()), HEIC);
    assert.match(original.headers.get('content-disposition'), /^attachment;/);
  });

  test('a photo that cannot be converted is refused with a reason, and nothing is stored', async () => {
    const broken = await startServer({}, { convertHeic: async () => { throw Object.assign(new Error('bad'), { status: 422 }); } });
    try {
      const res = await broken.upload('x.heic', HEIC);
      assert.ok(res.status >= 400);
      assert.equal(broken.db.prepare('SELECT COUNT(*) c FROM attachments').get().c, 0);
    } finally {
      await broken.close();
    }
  });
});

describe('files in notes', () => {
  let t;
  before(async () => {
    t = await startServer();
  });
  after(() => t.close());

  test('format-2 documents accept attachments; the note claims the file', async () => {
    const a = (await t.upload('Lease.pdf', PDF)).json.attachment;
    const id = uuid();
    const doc = docOf(para('See the lease'), attachmentNode(a), para(''));
    assert.equal(validateDoc(doc), null);
    const res = await saveWith(t, id, doc);
    assert.equal(res.status, 200, JSON.stringify(res.json));
    assert.equal((await t.api('GET', `/api/attachments/${a.id}`)).json.attachment.noteId, id, 'claimed by the note that saved it');
    assert.equal((await t.api('GET', `/api/attachments?noteId=${id}`)).json.attachments.length, 1);
    assert.equal((await t.api('GET', '/api/attachments?unattached=1')).json.attachments.some((x) => x.id === a.id), false);
    // the stored document round-trips
    assert.deepEqual((await t.api('GET', `/api/notes/${id}`)).json.note.doc, JSON.parse(JSON.stringify(doc)));
  });

  test('bad attachment nodes are refused', async () => {
    const id = uuid();
    const base = { id: 'abcdefgh1234', name: 'a.pdf', mime: 'application/pdf', size: 3 };
    const bad = (attrs) => saveWith(t, id, docOf({ type: 'attachment', attrs }));
    assert.equal((await bad({ ...base, id: '../x' })).status, 400);
    assert.equal((await bad({ ...base, name: '' })).status, 400);
    assert.equal((await bad({ ...base, mime: 'not a type' })).status, 400);
    assert.equal((await bad({ ...base, size: -1 })).status, 400);
    assert.equal((await saveWith(t, id, docOf({ type: 'attachment', attrs: base, content: [para('x')] }))).status, 400);
    assert.equal((await saveWith(t, id, docOf({ type: 'attachment', attrs: base }), { docFormat: 1 })).status, 400, 'format 1 may not contain attachments');
  });

  test('an editor from before files existed cannot save over a note that has them', async () => {
    const a = (await t.upload('Photo.png', PNG)).json.attachment;
    const id = uuid();
    assert.equal((await saveWith(t, id, docOf(para('with photo'), attachmentNode(a)), { tags: ['stale-tab'] })).status, 200);
    const stale = await saveWith(t, id, docOf(para('with photo, edited by an old tab')), { base: 1, docFormat: 1, tags: ['stale-tab'] });
    assert.equal(stale.status, 409);
    assert.equal(stale.json.error.code, 'client_outdated');
    assert.match(JSON.stringify((await t.api('GET', `/api/notes/${id}`)).json.note.doc), /Photo\.png/, 'the file is still in the note');
  });

  test('a note with only a file is not empty, and the file name is searchable', async () => {
    const a = (await t.upload('Move In Inspection Report.pdf', PDF)).json.attachment;
    const doc = docOf(attachmentNode(a));
    assert.equal(isEmptyDoc(doc), false);
    assert.match(plainText(doc), /Move In Inspection Report/);
    const id = uuid();
    await saveWith(t, id, doc, { tags: ['condo'] });
    const found = await t.api('GET', '/api/notes?q=inspection%20report');
    assert.ok(found.json.notes.some((n) => n.id === id));
  });
});

describe('Markdown and the assistant', () => {
  const token = 'test-only-assistant-key-123456789';
  let t;
  before(async () => {
    t = await startServer({ ASSISTANT_TOKEN: token });
  });
  after(() => t.close());
  const A = (method, p, body) => t.api(method, p, body, { authorization: `Bearer ${token}` });

  test('files read as ![name](gordonite-file:ID) and write back to attachments', async () => {
    const attrs = { id: 'abcdefgh1234', name: 'Sink.jpg', mime: 'image/jpeg', size: 9 };
    const md = docToMarkdown(docOf(para('Look'), { type: 'attachment', attrs }, { type: 'attachment', attrs: { ...attrs, id: 'zzzzzzzz9999', name: 'Policy.pdf', mime: 'application/pdf' } }));
    assert.equal(md, 'Look\n\n![Sink.jpg](gordonite-file:abcdefgh1234)\n\n[Policy.pdf](gordonite-file:zzzzzzzz9999)\n');
    const doc = markdownToDoc(md, { resolveAttachment: (id) => (id === attrs.id ? attrs : null) });
    assert.equal(doc.content[1].type, 'attachment');
    assert.equal(doc.content[2].type, 'paragraph', 'an unknown file id stays as text');
  });

  test('upload, list, read back, attach, and the note shows it', async () => {
    const up = await A('POST', '/api/assistant/attachments', { name: 'Statement Feb 2026.pdf', data: PDF.toString('base64') });
    assert.equal(up.status, 200, JSON.stringify(up.json));
    const file = up.json.attachment;
    assert.equal(file.source, 'assistant');
    assert.equal(file.kind, 'pdf');

    assert.ok((await A('GET', '/api/assistant/attachments?q=statement')).json.attachments.some((x) => x.id === file.id));
    const content = (await A('GET', `/api/assistant/attachments/${file.id}/content`)).json;
    assert.equal(content.encoding, 'base64');
    assert.deepEqual(Buffer.from(content.data, 'base64'), PDF);

    const note = (await A('POST', '/api/assistant/notes', { title: 'Condo', markdown: 'Documents', tags: ['condo'] })).json;
    const attached = await A('POST', `/api/assistant/notes/${note.id}/attach`, { attachmentId: file.id });
    assert.equal(attached.status, 200, JSON.stringify(attached.json));
    const read = (await A('GET', `/api/assistant/notes/${note.id}`)).json;
    assert.match(read.markdown, new RegExp(`\\[Statement Feb 2026\\.pdf\\]\\(gordonite-file:${file.id}\\)`));
    assert.equal(read.attachments.length, 1);
    // a trailing paragraph is left so the person can keep writing after the file
    const doc = (await t.api('GET', `/api/notes/${note.id}`)).json.note.doc;
    assert.equal(doc.content.at(-1).type, 'paragraph');
    assert.equal((await A('GET', `/api/assistant/attachments?noteId=${note.id}`)).json.attachments.length, 1);
  });

  test('append_note can place an uploaded file with its reference line', async () => {
    const file = (await A('POST', '/api/assistant/attachments', { name: 'Floor.png', data: PNG.toString('base64') })).json.attachment;
    const note = (await A('POST', '/api/assistant/notes', { markdown: 'Photos', tags: ['condo'] })).json;
    await A('POST', `/api/assistant/notes/${note.id}/append`, { markdown: `Living room:\n\n![Floor.png](gordonite-file:${file.id})` });
    const doc = (await t.api('GET', `/api/notes/${note.id}`)).json.note.doc;
    assert.equal(doc.content.find((b) => b.type === 'attachment')?.attrs.id, file.id);
  });

  test('refused: attaching a file that does not exist; bad base64 and missing key', async () => {
    const note = (await A('POST', '/api/assistant/notes', { markdown: 'x', tags: ['condo'] })).json;
    assert.equal((await A('POST', `/api/assistant/notes/${note.id}/attach`, { attachmentId: 'doesnotexist99' })).status, 404);
    assert.equal((await A('POST', '/api/assistant/attachments', { name: 'x.pdf' })).status, 400);
    assert.equal((await t.api('GET', '/api/assistant/attachments')).status, 401);
  });
});

describe('export, import and integrity', () => {
  test('JSON export lists files; a server that already has the bytes imports the records, one without skips them', async () => {
    const a = await startServer();
    let b;
    let c;
    try {
      const file = (await a.upload('Lease.pdf', PDF)).json.attachment;
      const id = uuid();
      await saveWith(a, id, docOf(para('lease'), attachmentNode(file)));
      const exported = (await a.api('GET', '/api/export/json')).json;
      assert.equal(exported.attachments.length, 1);
      assert.equal(exported.attachments[0].id, file.id);
      assert.equal(exported.attachments[0].noteId, id);

      // b: the files folder was copied across (same bytes), the database is new
      b = await startServer();
      fs.cpSync(a.config.filesDir, b.config.filesDir, { recursive: true });
      const withFiles = await b.api('POST', '/api/import?mode=merge', exported);
      assert.equal(withFiles.json.attachmentsAdded, 1);
      assert.equal((await b.api('GET', `/api/attachments/${file.id}`)).status, 200);
      assert.equal((await fetch(`${b.url}/api/attachments/${file.id}/file`)).status, 200);

      // c: no bytes here, so the record is skipped and counted
      c = await startServer();
      const without = await c.api('POST', '/api/import?mode=merge', exported);
      assert.equal(without.json.attachmentsAdded, 0);
      assert.equal(without.json.attachmentsMissingFiles, 1);
      assert.equal((await c.api('GET', `/api/attachments/${file.id}`)).status, 404);
    } finally {
      await a.close();
      await b?.close();
      await c?.close();
    }
  });

  test('the files zip and the Markdown zip carry the bytes', async () => {
    const t = await startServer();
    try {
      const file = (await t.upload('Lease.pdf', PDF)).json.attachment;
      const id = uuid();
      await saveWith(t, id, docOf(para('lease'), attachmentNode(file)), { tags: ['condo/papers'] });
      const files = Buffer.from(await (await fetch(`${t.url}/api/export/files`)).arrayBuffer());
      assert.ok(files.includes(PDF), 'file bytes are in the files zip');
      assert.ok(files.includes(`files/${file.id}-Lease.pdf`));
      const md = Buffer.from(await (await fetch(`${t.url}/api/export/markdown`)).arrayBuffer());
      assert.ok(md.includes(PDF), 'file bytes are in the Markdown zip');
      assert.ok(md.includes(`attachments/${file.id}-Lease.pdf`));
      assert.ok(md.includes(`](../../attachments/${file.id}-Lease.pdf)`), 'nested tag folders link up to the top');
    } finally {
      await t.close();
    }
  });

  test('check finds a missing or damaged file', async () => {
    const t = await startServer();
    try {
      const good = (await t.upload('good.pdf', Buffer.from('%PDF-good'))).json.attachment;
      const gone = (await t.upload('gone.pdf', Buffer.from('%PDF-gone!'))).json.attachment;
      const bent = (await t.upload('bent.pdf', Buffer.from('%PDF-bent!!'))).json.attachment;
      assert.equal(t.files.check().ok, true);
      const pathOf = (a) => t.files.fileFor(a.id).path;
      fs.rmSync(pathOf(gone));
      fs.writeFileSync(pathOf(bent), '%PDF-bent!!'.replace('!!', '??')); // same size, different bytes
      const quick = t.files.check();
      assert.deepEqual(quick.problems.map((p) => p.name), ['gone.pdf']);
      const deep = t.files.check({ hashes: true });
      assert.deepEqual(deep.problems.map((p) => p.name).sort(), ['bent.pdf', 'gone.pdf']);
      assert.ok(deep.problems.every((p) => p.name !== good.name));
    } finally {
      await t.close();
    }
  });

  test('a database from before files existed upgrades in place', async () => {
    const t = await startServer();
    try {
      assert.equal(t.db.prepare('PRAGMA user_version').get().user_version, 6);
      const cols = t.db.prepare('PRAGMA table_info(attachments)').all().map((c) => c.name);
      for (const c of ['id', 'sha256', 'name', 'mime', 'size', 'kind', 'original_sha256', 'note_id', 'deleted_at']) assert.ok(cols.includes(c), c);
    } finally {
      await t.close();
    }
  });
});
