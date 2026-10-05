import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, save, para, docOf, task } from './helpers.js';
import { uuid } from '../../shared/ids.js';
import { dateInTz } from '../../shared/dates.js';
import { normalizeTag } from '../../shared/tags.js';
import { validateDoc } from '../../shared/doc.js';

describe('dates, tags, documents', () => {
  test('note dates use the home timezone and flip at local midnight', () => {
    assert.equal(dateInTz(new Date('2026-10-05T05:59:59Z'), 'America/Edmonton'), '2026-10-04'); // 23:59:59 MDT
    assert.equal(dateInTz(new Date('2026-10-05T06:00:00Z'), 'America/Edmonton'), '2026-10-05');
    // Fixed UTC-7 zone: no dependence on the runtime's DST rules for Alberta.
    assert.equal(dateInTz(new Date('2026-12-05T06:59:59Z'), 'America/Phoenix'), '2026-12-04');
    assert.equal(dateInTz(new Date('2026-12-05T07:00:00Z'), 'America/Phoenix'), '2026-12-05');
  });

  test('tag normalisation', () => {
    assert.equal(normalizeTag('  #School/Fall26 '), 'school/fall26');
    assert.equal(normalizeTag('daily jots'), 'daily-jots');
    assert.equal(normalizeTag('a//b'), 'a/b');
    for (const bad of ['', '   ', '/', '../x', 'a/./b', 'bad$char', 'a'.repeat(101), 5, null]) {
      assert.equal(normalizeTag(bad), null, String(bad));
    }
  });

  test('document validation allows format 1 content only', () => {
    assert.equal(validateDoc(docOf(para('hi', [{ type: 'bold' }]))), null);
    assert.equal(validateDoc(docOf({ type: 'taskList', content: [task('x')] })), null);
    assert.match(validateDoc(docOf({ type: 'codeBlock' })), /unsupported node/);
    assert.match(validateDoc(docOf(para('x', [{ type: 'link' }]))), /unsupported mark/);
    assert.match(validateDoc({ type: 'nope' }), /root/);
    assert.match(validateDoc(docOf({ type: 'heading', attrs: { level: 9 } })), /level/);
  });
});

describe('notes API', () => {
  let t;
  before(async () => (t = await startServer()));
  after(() => t.close());

  test('opening a stream creates nothing; the first save creates the note', async () => {
    let s = await t.api('GET', '/api/stream?tag=daily-jots');
    assert.deepEqual(s.json.notes, []);
    assert.equal((await t.api('GET', '/api/tags')).json.tags.length, 0, 'streams do not create tags');

    const id = uuid();
    const r = await save(t, id, docOf(para('hello')));
    assert.equal(r.status, 200);
    assert.equal(r.json.revision, 1);
    s = await t.api('GET', '/api/stream?tag=daily-jots');
    assert.equal(s.json.notes.length, 1);
    assert.equal(s.json.notes[0].id, id);
    assert.equal(s.json.notes[0].date, '2026-10-05');
    assert.equal(s.json.notes[0].docFormat, 1);
    assert.deepEqual(s.json.notes[0].doc, docOf(para('hello')));
  });

  test('edit and reopen: revisions advance, content persists across a new request', async () => {
    const id = uuid();
    await save(t, id, docOf(para('v1')), { tags: ['edit-test'] });
    const r2 = await save(t, id, docOf(para('v2')), { base: 1, tags: ['edit-test'] });
    assert.equal(r2.json.revision, 2);
    const got = await t.api('GET', `/api/notes/${id}`);
    assert.deepEqual(got.json.note.doc, docOf(para('v2')));
    assert.equal(got.json.note.revision, 2);
  });

  test('tasks live in the document and keep their ids', async () => {
    const id = uuid();
    const tk = task('buy milk', false);
    await save(t, id, docOf({ type: 'taskList', content: [tk] }), { tags: ['tasks-test'] });
    const checked = { ...tk, attrs: { ...tk.attrs, checked: true } };
    await save(t, id, docOf({ type: 'taskList', content: [checked] }), { base: 1, tags: ['tasks-test'] });
    const got = (await t.api('GET', `/api/notes/${id}`)).json.note;
    assert.equal(got.doc.content[0].content[0].attrs.id, tk.attrs.id);
    assert.equal(got.doc.content[0].content[0].attrs.checked, true);
    const tables = t.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
    assert.ok(!tables.some((n) => /task/i.test(n)), 'no separate task table / duplicated task text');
  });

  test('one live note per tag per date; multi-tag notes are one page', async () => {
    const a = uuid();
    const b = uuid();
    await save(t, a, docOf(para('shared')), { tags: ['school/fall26', 'daily-jots'], date: '2026-09-01' });
    // Edit through the other tag's stream: same note
    const viaDaily = (await t.api('GET', '/api/stream?tag=daily-jots')).json.notes.find((n) => n.id === a);
    const viaSchool = (await t.api('GET', '/api/stream?tag=school/fall26')).json.notes.find((n) => n.id === a);
    assert.ok(viaDaily && viaSchool);
    assert.deepEqual(viaDaily.tags.map((x) => x.path).sort(), ['daily-jots', 'school/fall26']);
    // A second note for the same tag+date is refused and its text preserved on the holder
    const dup = await save(t, b, docOf(para('other device')), { tags: ['school/fall26'], date: '2026-09-01' });
    assert.equal(dup.status, 409);
    assert.equal(dup.json.reason, 'slot');
    assert.equal(dup.json.note.id, a);
    const versions = (await t.api('GET', `/api/notes/${a}/versions`)).json.versions;
    assert.ok(versions.some((v) => v.kind === 'conflict' && v.preview === 'other device'));
    assert.equal((await t.api('GET', `/api/notes/${b}`)).status, 404, 'rejected note was not created');
  });

  test('streams match the exact tag only (parents do not include children)', async () => {
    await save(t, uuid(), docOf(para('child')), { tags: ['proj/alpha'], date: '2026-08-01' });
    const parent = await t.api('GET', '/api/stream?tag=proj');
    assert.equal(parent.json.notes.length, 0);
    const child = await t.api('GET', '/api/stream?tag=proj/alpha');
    assert.equal(child.json.notes.length, 1);
  });

  test('stream pages newest-first with a "before" cursor', async () => {
    for (let d = 1; d <= 5; d++) {
      await save(t, uuid(), docOf(para(`day ${d}`)), { tags: ['paging'], date: `2026-07-0${d}` });
    }
    const p1 = (await t.api('GET', '/api/stream?tag=paging&limit=2')).json;
    assert.deepEqual(p1.notes.map((n) => n.date), ['2026-07-05', '2026-07-04']);
    assert.equal(p1.hasMore, true);
    const p2 = (await t.api('GET', '/api/stream?tag=paging&limit=2&before=2026-07-04')).json;
    assert.deepEqual(p2.notes.map((n) => n.date), ['2026-07-03', '2026-07-02']);
    const p3 = (await t.api('GET', '/api/stream?tag=paging&limit=2&before=2026-07-02')).json;
    assert.equal(p3.hasMore, false);
  });

  test('stale write is refused, never overwrites, and the sender version is preserved', async () => {
    const id = uuid();
    await save(t, id, docOf(para('base')), { tags: ['conflict-tag'] });
    await save(t, id, docOf(para('desktop edit')), { base: 1, tags: ['conflict-tag'] }); // rev 2
    const stale = await save(t, id, docOf(para('phone edit')), { base: 1, tags: ['conflict-tag'] });
    assert.equal(stale.status, 409);
    assert.equal(stale.json.reason, 'revision');
    assert.deepEqual(stale.json.note.doc, docOf(para('desktop edit')));
    const live = (await t.api('GET', `/api/notes/${id}`)).json.note;
    assert.deepEqual(live.doc, docOf(para('desktop edit')), 'server content untouched');
    await save(t, id, docOf(para('phone edit')), { base: 1, tags: ['conflict-tag'] }); // retry
    const versions = (await t.api('GET', `/api/notes/${id}/versions`)).json.versions;
    assert.equal(versions.filter((v) => v.kind === 'conflict').length, 1, 'retries do not duplicate');
    assert.equal(versions.find((v) => v.kind === 'conflict').preview, 'phone edit');
  });

  test('retry after a lost response is accepted (idempotent), but a foreign write is still a conflict', async () => {
    const id = uuid();
    const op1 = uuid();
    await save(t, id, docOf(para('A')), { tags: ['lost-resp'], opId: op1 }); // response "lost"; client doesn't know rev 1
    // client kept typing; its base is still 0, but it remembers op1 is unresolved
    const op2 = uuid();
    const r = await save(t, id, docOf(para('AB')), { base: 0, tags: ['lost-resp'], opId: op2, afterOps: [op1] });
    assert.equal(r.status, 200);
    assert.equal(r.json.revision, 2);
    // same chain again (op2 response lost too)
    const r2 = await save(t, id, docOf(para('ABC')), { base: 0, tags: ['lost-resp'], opId: uuid(), afterOps: [op1, op2] });
    assert.equal(r2.status, 200);
    assert.equal(r2.json.revision, 3);
    // another device writes in between, then our stale chain tries again
    await save(t, id, docOf(para('other')), { base: 3, tags: ['lost-resp'], opId: uuid() });
    const r3 = await save(t, id, docOf(para('ABCD')), { base: 0, tags: ['lost-resp'], opId: uuid(), afterOps: [op1, op2] });
    assert.equal(r3.status, 409);
  });

  test('re-sending identical content is a no-op success', async () => {
    const id = uuid();
    await save(t, id, docOf(para('same')), { tags: ['noop'] });
    const r = await save(t, id, docOf(para('same')), { base: 0, tags: ['noop'] });
    assert.equal(r.status, 200);
    assert.equal(r.json.revision, 1);
  });

  test('clearing a note keeps the note and the previous text is recoverable', async () => {
    const id = uuid();
    const long = 'This is a reasonably long paragraph that will be wiped out.';
    await save(t, id, docOf(para(long)), { tags: ['clear-tag'] });
    const r = await save(t, id, docOf(para('')), { base: 1, tags: ['clear-tag'] });
    assert.equal(r.status, 200);
    const stream = (await t.api('GET', '/api/stream?tag=clear-tag')).json.notes;
    assert.equal(stream.length, 1, 'note still exists');
    const versions = (await t.api('GET', `/api/notes/${id}/versions`)).json.versions;
    assert.ok(versions.some((v) => v.kind === 'guard' && v.preview === long));
  });

  test('versions: restoring keeps the current text as a version', async () => {
    const id = uuid();
    await save(t, id, docOf(para('first draft is long enough to matter')), { tags: ['ver-tag'] });
    await save(t, id, docOf(para('')), { base: 1, tags: ['ver-tag'] }); // guard snapshot of draft
    const v = (await t.api('GET', `/api/notes/${id}/versions`)).json.versions.find((x) => x.kind === 'guard');
    const restored = await t.api('POST', `/api/notes/${id}/versions/${v.id}/restore`, {});
    assert.equal(restored.status, 200);
    assert.equal(restored.json.note.revision, 3);
    assert.match(JSON.stringify(restored.json.note.doc), /first draft/);
    const after = (await t.api('GET', `/api/notes/${id}/versions`)).json.versions;
    assert.ok(after.some((x) => x.kind === 'restore'), 'previous (empty) state kept');
  });

  test('time-based versions are throttled, not one per save', async () => {
    const id = uuid();
    await save(t, id, docOf(para('x')), { tags: ['throttle'] });
    for (let i = 2; i <= 6; i++) await save(t, id, docOf(para('x'.repeat(i))), { base: i - 1, tags: ['throttle'] });
    assert.equal((await t.api('GET', `/api/notes/${id}/versions`)).json.versions.length, 0);
    t.db.prepare('UPDATE notes SET last_snapshot_at = ? WHERE id = ?').run('2020-01-01T00:00:00.000Z', id);
    await save(t, id, docOf(para('xxxxxxx')), { base: 6, tags: ['throttle'] });
    assert.equal((await t.api('GET', `/api/notes/${id}/versions`)).json.versions.length, 1);
  });

  test('delete goes to trash, frees the slot, restore brings it back', async () => {
    const id = uuid();
    await save(t, id, docOf(para('trash me')), { tags: ['trash-tag'], date: '2026-06-01' });
    assert.equal((await t.api('DELETE', `/api/notes/${id}`)).status, 200);
    assert.equal((await t.api('GET', '/api/stream?tag=trash-tag')).json.notes.length, 0);
    const trash = (await t.api('GET', '/api/trash')).json.notes;
    assert.ok(trash.find((n) => n.id === id));
    const r = await t.api('POST', `/api/notes/${id}/restore`, {});
    assert.equal(r.status, 200);
    assert.equal((await t.api('GET', '/api/stream?tag=trash-tag')).json.notes.length, 1);
  });

  test('restore refuses when a new note took the slot; dropping a tag is explicit', async () => {
    const id = uuid();
    await save(t, id, docOf(para('old')), { tags: ['slot-a', 'slot-b'], date: '2026-06-02' });
    await t.api('DELETE', `/api/notes/${id}`);
    await save(t, uuid(), docOf(para('replacement')), { tags: ['slot-a'], date: '2026-06-02' });
    const refused = await t.api('POST', `/api/notes/${id}/restore`, {});
    assert.equal(refused.status, 409);
    assert.equal(refused.json.error.code, 'slot_taken');
    const ok = await t.api('POST', `/api/notes/${id}/restore?dropConflictingTags=1`, {});
    assert.equal(ok.status, 200);
    assert.deepEqual(ok.json.droppedTags, ['slot-a']);
    assert.deepEqual(ok.json.note.tags.map((x) => x.path), ['slot-b']);
  });

  test('saving to a trashed note is refused and the text is kept as a version', async () => {
    const id = uuid();
    await save(t, id, docOf(para('v1')), { tags: ['deleted-edit'] });
    await t.api('DELETE', `/api/notes/${id}`);
    const r = await save(t, id, docOf(para('typed on the phone meanwhile')), { base: 1, tags: ['deleted-edit'] });
    assert.equal(r.status, 409);
    assert.equal(r.json.reason, 'deleted');
    const versions = (await t.api('GET', `/api/notes/${id}/versions`)).json.versions;
    assert.ok(versions.some((v) => v.kind === 'conflict' && v.preview.startsWith('typed on the phone')));
  });

  test('tags on a note: add, slot clash, cannot remove the last tag', async () => {
    const id = uuid();
    await save(t, id, docOf(para('t')), { tags: ['one'], date: '2026-05-01' });
    await save(t, uuid(), docOf(para('t')), { tags: ['two'], date: '2026-05-01' });
    const clash = await t.api('POST', `/api/notes/${id}/tags`, { path: 'two' });
    assert.equal(clash.status, 409);
    const add = await t.api('POST', `/api/notes/${id}/tags`, { path: 'three/sub' });
    assert.deepEqual(add.json.tags.map((x) => x.path), ['one', 'three/sub']);
    const one = add.json.tags.find((x) => x.path === 'one');
    const rm = await t.api('DELETE', `/api/notes/${id}/tags/${one.id}`);
    assert.equal(rm.status, 200);
    const last = rm.json.tags[0];
    assert.equal((await t.api('DELETE', `/api/notes/${id}/tags/${last.id}`)).status, 409);
  });

  test('purge removes only notes trashed longer than the retention period', async () => {
    const old = uuid();
    const fresh = uuid();
    await save(t, old, docOf(para('old')), { tags: ['purge'], date: '2026-01-01' });
    await save(t, fresh, docOf(para('fresh')), { tags: ['purge'], date: '2026-01-02' });
    await t.api('DELETE', `/api/notes/${old}`);
    await t.api('DELETE', `/api/notes/${fresh}`);
    t.db.prepare('UPDATE notes SET deleted_at = ? WHERE id = ?').run(new Date(Date.now() - 40 * 86400e3).toISOString(), old);
    assert.equal(t.store.purgeTrash(), 1);
    assert.equal(t.store.getNote(old), null);
    assert.ok(t.store.getNote(fresh));
  });

  test('bad input is rejected with clear errors', async () => {
    assert.equal((await save(t, uuid(), { type: 'doc', content: [{ type: 'codeBlock' }] })).status, 400);
    assert.equal((await save(t, 'bad id!', docOf(para('x')))).status, 400);
    assert.equal((await save(t, uuid(), docOf(para('x')), { tags: [] })).status, 400);
    assert.equal((await save(t, uuid(), docOf(para('x')), { date: '2026-13-45' })).status, 400);
    const wrongFmt = await t.api('PUT', `/api/notes/${uuid()}`, { doc: docOf(), docFormat: 99, tags: ['x'], date: '2026-01-01' });
    assert.equal(wrongFmt.status, 400);
  });

  test('state-changing requests must be JSON (basic cross-site protection)', async () => {
    const res = await fetch(`${t.url}/api/tags`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{"path":"evil"}' });
    assert.equal(res.status, 415);
    const res2 = await fetch(`${t.url}/api/tags`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'sec-fetch-site': 'cross-site' },
      body: '{"path":"evil"}',
    });
    assert.equal(res2.status, 403);
  });

  test('data survives closing and reopening the database file', async () => {
    const id = uuid();
    await save(t, id, docOf(para('persist me')), { tags: ['persist'] });
    const { openDb } = await import('../../server/db.js');
    const db2 = openDb(t.config.dbFile);
    const row = db2.prepare('SELECT doc, doc_format FROM notes WHERE id = ?').get(id);
    assert.equal(row.doc_format, 1);
    assert.match(row.doc, /persist me/);
    db2.close();
  });
});
