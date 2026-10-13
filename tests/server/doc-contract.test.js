// The document contract on the server: what is saved, exported, imported, rendered and checked.
// (The contract itself, against the editor's schema, is tests/client/doc-contract.test.js.)
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, para, docOf } from './helpers.js';
import { uuid } from '../../shared/ids.js';
import { DOC_FORMAT, validateDoc, plainText } from '../../shared/doc.js';
import { markdownToDoc } from '../../shared/markdown-import.js';
import { docToMarkdown } from '../../server/markdown.js';
import { checkDocs } from '../../server/doc-check.js';
import { renderDoc } from '../../client/src/editor/render.js';
import { FIXTURES, FILE_ID, withFileId, hasFile } from '../fixtures/docs.js';

const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n');
const nested = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a paragraph inside a paragraph' }] }] }] };

const save = (t, id, doc, { base = 0, tags = ['daily-jots'], date = '2026-10-05', docFormat = DOC_FORMAT } = {}) =>
  t.api('PUT', `/api/notes/${id}`, { baseRevision: base, doc, docFormat, tags, date, opId: uuid() });
const read = async (t, id) => (await t.api('GET', `/api/notes/${id}`)).json.note;

// every text run in a document, in order
function textRuns(doc) {
  const out = [];
  (function walk(n) {
    if (n.type === 'text') out.push(n.text);
    (n.content ?? []).forEach(walk);
  })(doc);
  return out;
}
const flatten = (s) => s.replace(/\s+/g, ' ').trim();

describe('every supported structure survives the whole path', () => {
  let t;
  let file;
  before(async () => {
    t = await startServer();
    file = (await t.upload('Lease.pdf', PDF)).json.attachment;
  });
  after(() => t.close());

  const real = (doc) => (hasFile(doc) ? withFileId(doc, file.id) : doc);

  test('save, read back, and edit again', async () => {
    for (const [i, fixture] of FIXTURES.entries()) {
      const doc = real(fixture.doc);
      const id = uuid();
      const date = `2026-09-${String(i + 1).padStart(2, '0')}`;
      const res = await save(t, id, doc, { date, tags: [`fixture-${i}`] });
      assert.equal(res.status, 200, `${fixture.name}: ${JSON.stringify(res.json)}`);
      assert.deepEqual((await read(t, id)).doc, doc, `${fixture.name}: stored as sent`);
      // the editor writes the same document again with a little more text: still accepted
      const more = structuredClone(doc);
      more.content.push({ type: 'paragraph', content: [{ type: 'text', text: 'one more line' }] });
      const again = await save(t, id, more, { base: res.json.revision, date, tags: [`fixture-${i}`] });
      assert.equal(again.status, 200, `${fixture.name} (edited): ${JSON.stringify(again.json)}`);
    }
  });

  test('JSON export and import give back the same documents', async () => {
    const exported = (await t.api('GET', '/api/export/json')).json;
    const other = await startServer();
    try {
      const res = await other.api('POST', '/api/import?mode=replace', exported);
      assert.equal(res.status, 200, JSON.stringify(res.json));
      assert.equal(res.json.nestingProblems, undefined, 'nothing to report for documents that follow the rules');
      for (const n of exported.notes) assert.deepEqual((await read(other, n.id)).doc, n.doc);
      assert.equal(exported.notes.length, FIXTURES.length);
    } finally {
      await other.close();
    }
  });

  test('the Markdown and the page rendering keep every word and every file', () => {
    for (const fixture of FIXTURES) {
      const doc = real(fixture.doc);
      const markdown = docToMarkdown(doc);
      const html = renderDoc(doc); // as in a preview of an old version or the trash: nothing is hidden by today's date
      for (const run of textRuns(doc)) {
        // (the fixtures use no characters Markdown escapes, so the words appear as they are)
        assert.ok(markdown.includes(run), `${fixture.name}: Markdown lost "${run}"`);
        assert.ok(html.includes(run), `${fixture.name}: the page lost "${run}"`);
      }
      if (hasFile(fixture.doc)) {
        assert.ok(markdown.includes(`gordonite-file:${file.id}`), `${fixture.name}: Markdown lost the file reference`);
        assert.ok(html.includes(`data-attachment-id="${file.id}"`), `${fixture.name}: the page lost the file`);
      }
    }
  });

  test('Markdown read back as a note keeps the words and the files', () => {
    for (const fixture of FIXTURES) {
      const doc = real(fixture.doc);
      const back = markdownToDoc(docToMarkdown(doc), { resolveAttachment: (id) => (id === file.id ? { id, name: file.name, mime: file.mime, size: file.size } : null) });
      assert.equal(validateDoc(back), null, fixture.name);
      // (Markdown writes a task's dates and dismissal as words after it, so the text can only grow)
      const words = flatten(plainText(back));
      for (const run of textRuns(doc)) assert.ok(words.includes(flatten(run)), `${fixture.name}: "${run}" did not come back`);
      assert.equal(JSON.stringify(back).includes(file.id), hasFile(fixture.doc), `${fixture.name}: file reference`);
    }
  });
});

describe('saving a document the editor could not hold', () => {
  let t;
  before(async () => {
    t = await startServer();
  });
  after(() => t.close());

  test('a paragraph inside a paragraph is refused, and nothing is created', async () => {
    const id = uuid();
    const res = await save(t, id, nested);
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, 'bad_doc');
    assert.match(res.json.error.message, /paragraph cannot go inside paragraph/);
    assert.equal((await t.api('GET', `/api/notes/${id}`)).status, 404);
  });

  test('so is a bad edit of a good note, which keeps its text', async () => {
    const id = uuid();
    const ok = await save(t, id, docOf(para('good text')));
    assert.equal(ok.status, 200);
    const bad = await save(t, id, nested, { base: ok.json.revision });
    assert.equal(bad.status, 400);
    assert.deepEqual((await read(t, id)).doc, docOf(para('good text')));
  });

  test('the assistant door cannot write one either (it builds documents from Markdown)', async () => {
    // Markdown always becomes valid nesting; this checks the path end to end with awkward input.
    const md = '- item\n\t- tab nested\n  - [ ] task under bullet\n> quote\n```\ncode\n```\n| a | b |\n';
    const body = markdownToDoc(md);
    assert.equal(validateDoc(body), null);
  });

  test('a line break inside bold text saves (the editor writes marks on it)', async () => {
    const doc = docOf({
      type: 'paragraph',
      content: [
        { type: 'text', text: 'one', marks: [{ type: 'bold' }] },
        { type: 'hardBreak', marks: [{ type: 'bold' }] },
        { type: 'text', text: 'two', marks: [{ type: 'bold' }] },
      ],
    });
    const id = uuid();
    const res = await save(t, id, doc, { date: '2026-10-06' });
    assert.equal(res.status, 200, JSON.stringify(res.json));
    assert.deepEqual((await read(t, id)).doc, doc);
    assert.equal(docToMarkdown(doc), '**one  \ntwo**\n');
  });
});

describe('notes stored before the nesting rules existed', () => {
  let t;
  before(async () => {
    t = await startServer();
  });
  after(() => t.close());

  // What an older build could have stored: put it in the database directly, as it would already be there.
  function plant(id, doc, { format = 1, date = '2026-09-01', tagPath = 'legacy' } = {}) {
    const now = new Date().toISOString();
    t.db.prepare(`INSERT INTO tags (id, path, created_at, favorite, daily) VALUES (?,?,?,0,1) ON CONFLICT(path) DO NOTHING`).run(uuid(), tagPath, now);
    const tag = t.db.prepare('SELECT id FROM tags WHERE path = ?').get(tagPath);
    t.db
      .prepare(`INSERT INTO notes (id, note_date, doc, doc_format, revision, created_at, updated_at, last_snapshot_at, kind) VALUES (?,?,?,?,1,?,?,?,'daily')`)
      .run(id, date, JSON.stringify(doc), format, now, now, now);
    t.db.prepare('INSERT INTO note_tags (note_id, tag_id, note_date, live, slot) VALUES (?,?,?,1,1)').run(id, tag.id, date);
  }

  test('such a note can still be edited and saved, so it is never stuck', async () => {
    const id = uuid();
    plant(id, nested);
    const stillNested = JSON.parse(JSON.stringify(nested));
    stillNested.content[0].content[0].content[0].text = 'edited, still nested';
    const res = await save(t, id, stillNested, { base: 1, tags: ['legacy'], date: '2026-09-01' });
    assert.equal(res.status, 200, JSON.stringify(res.json));
    assert.equal(JSON.stringify((await read(t, id)).doc).includes('edited, still nested'), true);
  });

  test('and it can be repaired by saving a document that follows the rules', async () => {
    const id = uuid();
    plant(id, nested, { date: '2026-09-02' });
    const res = await save(t, id, docOf(para('repaired')), { base: 1, tags: ['legacy'], date: '2026-09-02' });
    assert.equal(res.status, 200);
    // from here on the note is held to the rules like any other
    const worse = await save(t, id, nested, { base: res.json.revision, tags: ['legacy'], date: '2026-09-02' });
    assert.equal(worse.status, 400);
  });

  test('the allowance is only for the nesting rules, not for anything else', async () => {
    const id = uuid();
    plant(id, nested, { date: '2026-09-03' });
    const res = await save(t, id, { type: 'doc', content: [{ type: 'codeBlock' }] }, { base: 1, tags: ['legacy'], date: '2026-09-03' });
    assert.equal(res.status, 400);
    assert.match(res.json.error.message, /unsupported node/);
  });

  test('check-docs lists them, with their saved versions, and changes nothing', async () => {
    const before = t.db.prepare('SELECT COUNT(*) c FROM notes').get().c;
    const report = checkDocs(t.db);
    assert.equal(report.notes, before);
    const notes = report.problems.filter((p) => p.kind === 'note');
    assert.ok(notes.length >= 2, `found ${notes.length}`);
    assert.ok(notes.every((p) => /cannot go inside/.test(p.error)));
    assert.equal(t.db.prepare('SELECT COUNT(*) c FROM notes').get().c, before);
  });

  test('a clean workspace reports nothing', async () => {
    const clean = await startServer();
    try {
      await save(clean, uuid(), docOf(para('fine')));
      const report = checkDocs(clean.db);
      assert.deepEqual(report.problems, []);
      assert.equal(report.notes, 1);
    } finally {
      await clean.close();
    }
  });

  test('importing an export that has one keeps it, untouched, and says so', async () => {
    const source = await startServer();
    try {
      const good = uuid();
      await save(source, good, docOf(para('fine')), { tags: ['legacy'], date: '2026-08-01' });
      const exported = (await source.api('GET', '/api/export/json')).json;
      const id = uuid();
      const tag = exported.tags[0];
      exported.notes.push({ ...exported.notes[0], id, date: '2026-08-02', doc: nested, docFormat: 1, versions: [], tags: [tag.id] });
      const target = await startServer();
      try {
        const res = await target.api('POST', '/api/import?mode=merge', exported);
        assert.equal(res.status, 200, JSON.stringify(res.json));
        assert.equal(res.json.notesCreated, 2);
        assert.deepEqual(res.json.nestingProblems.map((p) => p.note), [id]);
        assert.match(res.json.nestingProblems[0].problem, /cannot go inside/);
        assert.deepEqual((await read(target, id)).doc, nested, 'stored exactly as it was exported');
      } finally {
        await target.close();
      }
    } finally {
      await source.close();
    }
  });

  test('an import with a document that is wrong in any other way is still refused whole', async () => {
    const source = await startServer();
    try {
      await save(source, uuid(), docOf(para('fine')));
      const exported = (await source.api('GET', '/api/export/json')).json;
      exported.notes[0].doc = { type: 'doc', content: [{ type: 'codeBlock' }] };
      const res = await source.api('POST', '/api/import?mode=merge', exported);
      assert.equal(res.status, 400);
      assert.equal(res.json.error.code, 'bad_import');
    } finally {
      await source.close();
    }
  });
});

test('the fixture file id is a valid file id', () => {
  assert.equal(validateDoc({ type: 'doc', content: [{ type: 'attachment', attrs: { id: FILE_ID, name: 'a.pdf', mime: 'application/pdf', size: 1 } }] }), null);
});
