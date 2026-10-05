import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { sync, dedupeTaskIds } from '../../client/src/sync.js';
import { emptyDoc } from '../../shared/doc.js';

const doc = (text) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
const note = (id, text, revision, extra = {}) => ({ id, date: '2026-10-05', doc: doc(text), revision, tags: [{ id: 't1', path: 'daily-jots' }], ...extra });

describe('client sync sessions', () => {
  test('adopt refreshes a note nobody is editing', () => {
    const s = sync.adopt(note('aaaaaaaa-1', 'v1', 1));
    sync.adopt(note('aaaaaaaa-1', 'v2', 2));
    assert.equal(s.revision, 2);
    assert.deepEqual(s.currentDoc(), doc('v2'));
  });

  test('adopt never moves the base revision under an open editor (would hide a conflict)', () => {
    const s = sync.adopt(note('aaaaaaaa-2', 'mine', 1));
    s.attach(() => doc('mine'));
    sync.adopt(note('aaaaaaaa-2', 'changed elsewhere', 2));
    assert.equal(s.revision, 1, 'base stays at what the editor was loaded from');
    assert.deepEqual(s.currentDoc(), doc('mine'));
  });

  test('adopt never replaces unsent edits', () => {
    const s = sync.adopt(note('aaaaaaaa-3', 'base', 1));
    s.attach(() => doc('base + typed'));
    s.touch();
    s.captureNow({ schedule: false });
    s.detach();
    assert.equal(s.status, 'pending');
    sync.adopt(note('aaaaaaaa-3', 'server newer', 2));
    assert.deepEqual(s.currentDoc(), doc('base + typed'));
    assert.equal(s.revision, 1);
  });

  test('a new note with no content is never created or marked unsaved', () => {
    const s = sync.draft('some-tag', '2026-10-05');
    s.attach(() => emptyDoc());
    s.touch(); // e.g. the user typed and deleted a character before the first capture
    s.captureNow({ schedule: false });
    assert.equal(s.pending, null);
    assert.equal(s.status, 'saved', 'nothing to save');
    assert.equal(s.revision, 0);
  });

  test('draft sessions are stable per tag+date, so crossing a re-render keeps one note id', () => {
    assert.equal(sync.draft('x-tag', '2026-10-05'), sync.draft('x-tag', '2026-10-05'));
    assert.notEqual(sync.draft('x-tag', '2026-10-05').id, sync.draft('x-tag', '2026-10-06').id);
  });

  test('dedupeTaskIds gives repeated or missing task ids new ones', () => {
    const t = (id) => ({ type: 'taskItem', attrs: { checked: false, id }, content: [{ type: 'paragraph' }] });
    const out = dedupeTaskIds({ type: 'doc', content: [{ type: 'taskList', content: [t('a'), t('a'), t(null), t('b')] }] });
    const ids = out.content[0].content.map((x) => x.attrs.id);
    assert.equal(new Set(ids).size, 4);
    assert.equal(ids[0], 'a');
    assert.equal(ids[3], 'b');
  });
});
