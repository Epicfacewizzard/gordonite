// A note stored before the nesting rules existed, with a structure the editor's schema cannot hold: it must open
// without being rewritten, say why it cannot be edited, and never be saved over by the editor.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { uuid } from '../../shared/ids.js';
import { launch, withPhone } from './harness.js';

let browser;
before(async () => (browser = await launch()));
after(async () => browser.close());

test('a note with nesting the editor cannot hold opens read-only, says so, and is left exactly as it was', () =>
  withPhone(browser, async ({ page, app }) => {
    const id = uuid();
    const doc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'stored by an older build' }] }] }] };
    const now = new Date().toISOString();
    app.db
      .prepare(`INSERT INTO notes (id, note_date, doc, doc_format, revision, created_at, updated_at, last_snapshot_at, kind, title) VALUES (?,?,?,?,1,?,?,?,'note','Old note')`)
      .run(id, '2026-09-01', JSON.stringify(doc), 1, now, now, now);

    await page.goto(`${app.url}/#/n/${id}`);
    await page.getByText(/cannot show/i).waitFor();
    assert.equal(await page.locator('.note-text[contenteditable="true"]').count(), 0, 'it is not editable');
    // the server's check lists it, and nothing was rewritten
    const { checkDocs } = await import('../../server/doc-check.js');
    const report = checkDocs(app.db);
    assert.deepEqual(report.problems.map((p) => [p.id, /cannot go inside/.test(p.error)]), [[id, true]]);
    assert.equal(app.db.prepare('SELECT doc FROM notes WHERE id = ?').get(id).doc, JSON.stringify(doc));
    assert.equal(app.db.prepare('SELECT revision FROM notes WHERE id = ?').get(id).revision, 1);
    assert.deepEqual(page.errors.filter((e) => !/tiptap warn|Invalid content/i.test(e)), []);
  }));
