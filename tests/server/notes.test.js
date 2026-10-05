import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, save, para, docOf, task } from './helpers.js';
import { uuid } from '../../shared/ids.js';
import { dateInTz } from '../../shared/dates.js';
import { normalizeTag } from '../../shared/tags.js';
import { validateDoc } from '../../shared/doc.js';
import { loadConfig } from '../../server/config.js';

const plainTextOf = (node) => (node.content ?? []).map((c) => c.text ?? plainTextOf(c)).join('');

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

describe('favorite tags', () => {
  let t;
  before(async () => (t = await startServer()));
  after(() => t.close());

  test('a tag can be favorited and unfavorited, and the flag survives export and replace-import', async () => {
    await save(t, uuid(), docOf(para('a')), { tags: ['alpha'] });
    await save(t, uuid(), docOf(para('b')), { tags: ['beta'] });
    let tags = (await t.api('GET', '/api/tags')).json.tags;
    assert.deepEqual(tags.map((x) => x.favorite), [false, false], 'new tags are not favorites');

    const beta = tags.find((x) => x.path === 'beta');
    let r = await t.api('PUT', `/api/tags/${beta.id}/favorite`, { favorite: true });
    assert.equal(r.status, 200);
    tags = (await t.api('GET', '/api/tags')).json.tags;
    assert.equal(tags.find((x) => x.path === 'beta').favorite, true);
    assert.equal(tags.find((x) => x.path === 'alpha').favorite, false);

    const exported = (await t.api('GET', '/api/export/json')).json;
    assert.equal(exported.tags.find((x) => x.path === 'beta').favorite, true);
    r = await t.api('POST', '/api/import?mode=replace', exported);
    assert.equal(r.status, 200);
    tags = (await t.api('GET', '/api/tags')).json.tags;
    assert.equal(tags.find((x) => x.path === 'beta').favorite, true, 'kept through export/import');

    await t.api('PUT', `/api/tags/${beta.id}/favorite`, { favorite: false });
    tags = (await t.api('GET', '/api/tags')).json.tags;
    assert.equal(tags.find((x) => x.path === 'beta').favorite, false);
  });

  test('bad requests are refused', async () => {
    assert.equal((await t.api('PUT', `/api/tags/${uuid()}/favorite`, { favorite: true })).status, 404);
    const [tag] = (await t.api('GET', '/api/tags')).json.tags;
    assert.equal((await t.api('PUT', `/api/tags/${tag.id}/favorite`, { favorite: 'yes' })).status, 400);
  });
});

describe('combined task list', () => {
  let t;
  before(async () => (t = await startServer()));
  after(() => t.close());

  test('lists tasks from every live note with tag and date; trashed notes drop out', async () => {
    const a = uuid();
    const b = uuid();
    const ta = task('call the dentist');
    const tb = task('hand in essay', true);
    const nested = task('outline');
    nested.content.push({ type: 'taskList', content: [task('sources')] });
    await save(t, a, docOf(para('plan'), { type: 'taskList', content: [ta, nested] }), { tags: ['daily-jots', 'school'], date: '2026-10-04' });
    await save(t, b, docOf({ type: 'taskList', content: [tb, task('')] }), { tags: ['school'], date: '2026-10-05' });
    await save(t, uuid(), docOf(para('no tasks here')), { tags: ['misc'], date: '2026-10-05' });

    let tasks = (await t.api('GET', '/api/tasks')).json.tasks;
    assert.deepEqual(
      tasks.map((x) => [x.text, x.checked, x.date, x.tags]),
      [
        ['hand in essay', true, '2026-10-05', ['school']],
        ['call the dentist', false, '2026-10-04', ['daily-jots', 'school']],
        ['outline', false, '2026-10-04', ['daily-jots', 'school']],
        ['sources', false, '2026-10-04', ['daily-jots', 'school']],
      ],
      'newest note first, document order inside, empty tasks skipped, nested tasks listed on their own',
    );
    assert.equal(tasks[1].noteId, a);
    assert.equal(tasks[1].taskId, ta.attrs.id);

    await t.api('DELETE', `/api/notes/${b}`);
    tasks = (await t.api('GET', '/api/tasks')).json.tasks;
    assert.equal(tasks.some((x) => x.text === 'hand in essay'), false, 'trashed notes are not listed');
  });
});

describe('task helpers', () => {
  test('setTaskChecked changes only the named task and leaves the input alone', async () => {
    const { setTaskChecked, extractTasks } = await import('../../shared/tasks.js');
    const one = task('one', false, 'id-one-1234');
    const two = task('two', false, 'id-two-1234');
    const doc = docOf({ type: 'taskList', content: [one, two] });
    const next = setTaskChecked(doc, 'id-two-1234', true);
    assert.deepEqual(extractTasks(next).map((x) => x.checked), [false, true]);
    assert.deepEqual(extractTasks(doc).map((x) => x.checked), [false, false], 'original untouched');
    assert.equal(setTaskChecked(doc, 'missing-id', true), null);
  });
});

describe('task dates', () => {
  const NOTE = '2026-10-05'; // a Monday

  test('typed phrases are read against the note date, not today', async () => {
    const { parseTaskDates: p } = await import('../../shared/taskdates.js');
    const cases = [
      ['call dentist due fri', { due: '2026-10-09', start: null }],
      ['Due Friday please', { due: '2026-10-09', start: null }],
      ['due today', { due: '2026-10-05', start: null }],
      ['due tomorrow', { due: '2026-10-06', start: null }],
      ['due mon', { due: '2026-10-12', start: null }], // a weekday means the NEXT one
      ['due in 3 days', { due: '2026-10-08', start: null }],
      ['due in 2 weeks', { due: '2026-10-19', start: null }],
      ['starts oct 12', { due: null, start: '2026-10-12' }],
      ['start 12 oct, due oct 20', { due: '2026-10-20', start: '2026-10-12' }],
      ['due 2026-11-01', { due: '2026-11-01', start: null }],
      ['due jan 2', { due: '2027-01-02', start: null }], // already past this year -> next year
      ['pay rent due fri and due sat', { due: '2026-10-09', start: null }], // first phrase wins
      ['start exercising', { due: null, start: null }],
      ['due may', { due: null, start: null }], // a month alone is not a date
      ['due feb 30', { due: null, start: null }],
      ['undue fri', { due: null, start: null }],
    ];
    for (const [text, want] of cases) assert.deepEqual(p(text, NOTE), want, text);
  });

  test('a picked date wins over a typed one; clearing falls back; stored docs stay tidy', async () => {
    const { extractTasks, updateTask, cleanTaskAttrs } = await import('../../shared/tasks.js');
    const id = 'task-aaaa-1111';
    const doc = docOf({ type: 'taskList', content: [task('call dentist due fri', false, id)] });

    let [t] = extractTasks(doc, NOTE);
    assert.deepEqual([t.due, t.dueFrom, t.start, t.hidden], ['2026-10-09', 'text', null, false]);

    const picked = updateTask(doc, id, { due: '2026-10-20', start: '2026-10-12', hidden: true });
    [t] = extractTasks(picked, NOTE);
    assert.deepEqual([t.due, t.dueFrom, t.start, t.startFrom, t.hidden], ['2026-10-20', 'set', '2026-10-12', 'set', true]);

    const cleared = updateTask(picked, id, { due: null, start: null, hidden: false });
    [t] = extractTasks(cleared, NOTE);
    assert.deepEqual([t.due, t.dueFrom, t.start, t.hidden], ['2026-10-09', 'text', null, false], 'typed date is back');
    assert.deepEqual(cleared.content[0].content[0].attrs, { checked: false, id }, 'no leftover empty attributes');
    assert.deepEqual(cleanTaskAttrs(docOf({ type: 'taskList', content: [{ ...task('x', false, id), attrs: { checked: false, id, due: null, start: null, hidden: false } }] })).content[0].content[0].attrs, { checked: false, id });
  });

  test('documents with bad task dates are refused; good ones are stored and listed', async () => {
    const id = 'task-bbbb-2222';
    const withAttrs = (attrs) => docOf({ type: 'taskList', content: [{ ...task('x', false, id), attrs: { checked: false, id, ...attrs } }] });
    assert.match(validateDoc(withAttrs({ due: 'friday' })), /due must be a YYYY-MM-DD/);
    assert.match(validateDoc(withAttrs({ start: '2026-13-40' })), /start must be/);
    assert.match(validateDoc(withAttrs({ hidden: 'yes' })), /hidden must be boolean/);
    assert.equal(validateDoc(withAttrs({ due: '2026-10-09', start: null, hidden: true })), null);

    const t = await startServer();
    try {
      const bad = await save(t, uuid(), withAttrs({ due: 'soon' }));
      assert.equal(bad.status, 400, 'the server refuses it');
      const noteId = uuid();
      const doc = docOf({
        type: 'taskList',
        content: [
          { ...task('plain task', false, 'task-cccc-3333') },
          { ...task('write essay due fri', false, 'task-dddd-4444') },
          { ...task('picked wins due fri', false, 'task-eeee-5555'), attrs: { checked: false, id: 'task-eeee-5555', due: '2026-10-20', start: '2026-10-12', hidden: true } },
        ],
      });
      assert.equal((await save(t, noteId, doc, { date: NOTE })).status, 200);
      const tasks = (await t.api('GET', '/api/tasks')).json.tasks;
      const pick = (text) => tasks.find((x) => x.text === text);
      assert.deepEqual([pick('plain task').due, pick('plain task').hidden], [null, false]);
      assert.deepEqual([pick('write essay due fri').due, pick('write essay due fri').dueFrom], ['2026-10-09', 'text']);
      const p = pick('picked wins due fri');
      assert.deepEqual([p.due, p.dueFrom, p.start, p.startFrom, p.hidden], ['2026-10-20', 'set', '2026-10-12', 'set', true]);
      assert.equal(JSON.parse(t.db.prepare('SELECT doc FROM notes WHERE id = ?').get(noteId).doc).content[0].content[2].attrs.due, '2026-10-20', 'stored in the note itself');
    } finally {
      await t.close();
    }
  });
});

describe('free notes: several per tag per day, optionally untagged', () => {
  let t;
  before(async () => (t = await startServer()));
  after(() => t.close());

  const freeNote = (id, text, tags, date = '2026-10-05') =>
    t.api('PUT', `/api/notes/${id}`, { baseRevision: 0, doc: docOf(para(text)), docFormat: 1, tags, date, opId: uuid(), kind: 'note' });

  test('a tag can hold any number of free notes on one day, next to its daily note; the daily rule is unchanged', async () => {
    const daily = uuid();
    assert.equal((await save(t, daily, docOf(para('daily jot')), { tags: ['ideas'] })).status, 200);
    const [a, b] = [uuid(), uuid()];
    assert.equal((await freeNote(a, 'app idea', ['ideas'])).status, 200);
    assert.equal((await freeNote(b, 'book idea', ['ideas'])).status, 200);

    const s = (await t.api('GET', '/api/stream?tag=ideas')).json.notes;
    assert.deepEqual(s.map((n) => [n.id, n.kind]), [[daily, 'daily'], [b, 'note'], [a, 'note']], 'daily first, then free notes newest first');

    const second = await save(t, uuid(), docOf(para('another daily')), { tags: ['ideas'] });
    assert.equal(second.status, 409, 'a second DAILY note for the same tag and day is still a conflict');
    assert.equal(second.json.reason, 'slot');

    const noTag = await t.api('PUT', `/api/notes/${uuid()}`, { baseRevision: 0, doc: docOf(para('x')), docFormat: 1, tags: [], date: '2026-10-05', opId: uuid() });
    assert.equal(noTag.status, 400, 'a daily note still needs a tag');
  });

  test('a free note can start untagged, gain tags and sub-tags later, and lose them all again', async () => {
    const id = uuid();
    assert.equal((await freeNote(id, 'plain thought', [])).status, 200);
    assert.deepEqual((await t.api('GET', `/api/notes/${id}`)).json.note.tags, []);

    let r = await t.api('POST', `/api/notes/${id}/tags`, { path: 'school' });
    assert.deepEqual(r.json.tags.map((x) => x.path), ['school']);
    r = await t.api('POST', `/api/notes/${id}/tags`, { path: 'school/fall26/math' });
    assert.deepEqual(r.json.tags.map((x) => x.path), ['school', 'school/fall26/math']);

    // Tagging a free note never clashes with a daily note of that tag and day.
    await save(t, uuid(), docOf(para('school jot')), { tags: ['school/fall26/math'], date: '2026-10-05' });
    r = await t.api('POST', `/api/notes/${id}/tags`, { path: 'ideas' });
    assert.equal(r.status, 200);

    for (const tag of r.json.tags) await t.api('DELETE', `/api/notes/${id}/tags/${tag.id}`);
    assert.deepEqual((await t.api('GET', `/api/notes/${id}`)).json.note.tags, [], 'a free note may end up with no tags');

    // ...but a daily note may not lose its last tag.
    const dailyId = uuid();
    await save(t, dailyId, docOf(para('d')), { tags: ['solo'], date: '2026-10-01' });
    const solo = (await t.api('GET', `/api/notes/${dailyId}`)).json.note.tags[0];
    assert.equal((await t.api('DELETE', `/api/notes/${dailyId}/tags/${solo.id}`)).status, 409);
  });

  test('stream pages are whole days: a day with several notes is never split', async () => {
    const day = '2026-09-01';
    for (const n of ['one', 'two', 'three']) await freeNote(uuid(), n, ['pages'], day);
    await freeNote(uuid(), 'earlier', ['pages'], '2026-08-31');
    const first = (await t.api('GET', '/api/stream?tag=pages&limit=1')).json;
    assert.equal(first.notes.length, 3, 'all three notes of the day come together');
    assert.equal(first.hasMore, true);
    const next = (await t.api('GET', `/api/stream?tag=pages&limit=1&before=${day}`)).json;
    assert.deepEqual(next.notes.map((n) => n.date), ['2026-08-31']);
    assert.equal(next.hasMore, false);
  });

  test('trashed free notes restore without any slot trouble', async () => {
    const id = uuid();
    await freeNote(id, 'to trash', ['ideas']);
    await t.api('DELETE', `/api/notes/${id}`);
    await freeNote(uuid(), 'newcomer', ['ideas']); // takes nothing, so restoring cannot clash
    const r = await t.api('POST', `/api/notes/${id}/restore`);
    assert.equal(r.status, 200);
    assert.equal(r.json.note.kind, 'note');
  });
});

describe('notes list: search and tag filters', () => {
  let t;
  before(async () => (t = await startServer()));
  after(() => t.close());

  const put = (text, tags, date = '2026-10-05', kind = 'note') => {
    const id = uuid();
    return t
      .api('PUT', `/api/notes/${id}`, { baseRevision: 0, doc: docOf(para(text), para('second line here')), docFormat: 1, tags, date, opId: uuid(), kind })
      .then(() => id);
  };

  test('lists newest-changed first with title, preview and tags; filters by tag, sub-tags and untagged; searches text', async () => {
    const a = await put('Maths notes', ['school/fall26/math']);
    const b = await put('Essay plan', ['school/fall26']);
    const c = await put('Groceries', []);
    const d = await put('Weird tag', ['a_b']);
    const e = await put('Not under a_b', ['axb/child']);
    await put('Daily thing', ['daily-jots'], '2026-10-05', 'daily');
    // make "Maths notes" the most recently changed
    await t.api('PUT', `/api/notes/${a}`, { baseRevision: 1, doc: docOf(para('Maths notes v2'), para('second line here')), docFormat: 1, opId: uuid() });

    const all = (await t.api('GET', '/api/notes')).json;
    assert.equal(all.notes[0].id, a, 'most recently changed first');
    assert.equal(all.notes[0].title, 'Maths notes v2');
    assert.equal(all.notes[0].preview, 'second line here');
    assert.deepEqual(all.notes[0].tags.map((x) => x.path), ['school/fall26/math']);
    assert.equal(all.notes.length, 6);

    const ids = async (qs) => (await t.api('GET', `/api/notes?${qs}`)).json.notes.map((n) => n.id).sort();
    assert.deepEqual(await ids('tag=school/fall26'), [b], 'exact tag only');
    assert.deepEqual(await ids('tag=school/fall26&sub=1'), [a, b].sort(), 'with sub-tags');
    assert.deepEqual(await ids('untagged=1'), [c]);
    assert.deepEqual(await ids('tag=a_b&sub=1'), [d], '_ in a tag is not a wildcard');
    assert.equal((await ids('tag=a_b&sub=1')).includes(e), false);
    assert.deepEqual(await ids('q=GROCER'), [c], 'search ignores case');
    assert.deepEqual(await ids('q=second%20line&tag=school/fall26'), [b]);

    const page = (await t.api('GET', '/api/notes?limit=4&offset=0')).json;
    assert.equal(page.notes.length, 4);
    assert.equal(page.hasMore, true);
    const rest = (await t.api('GET', '/api/notes?limit=4&offset=4')).json;
    assert.equal(rest.notes.length, 2);
    assert.equal(rest.hasMore, false);
    assert.equal((await t.api('GET', '/api/notes?tag=../x')).status, 400);
  });

  test('trashed notes are not listed', async () => {
    const id = await put('soon gone', ['trashtag']);
    assert.equal((await t.api('GET', '/api/notes?tag=trashtag')).json.notes.length, 1);
    await t.api('DELETE', `/api/notes/${id}`);
    assert.equal((await t.api('GET', '/api/notes?tag=trashtag')).json.notes.length, 0);
  });
});

describe('free notes survive export and import', () => {
  test('JSON round trip keeps kind, untagged notes and same-day notes; Markdown files do not collide', async () => {
    const t = await startServer();
    try {
      const mk = (text, tags, kind) =>
        t.api('PUT', `/api/notes/${uuid()}`, { baseRevision: 0, doc: docOf(para(text)), docFormat: 1, tags, date: '2026-10-05', opId: uuid(), kind });
      await mk('daily', ['ideas'], 'daily');
      await mk('free one', ['ideas'], 'note');
      await mk('free two', ['ideas'], 'note');
      await mk('loose', [], 'note');

      const exported = (await t.api('GET', '/api/export/json')).json;
      assert.deepEqual(exported.notes.map((n) => n.kind).sort(), ['daily', 'note', 'note', 'note']);
      const imp = await t.api('POST', '/api/import?mode=replace', exported);
      assert.equal(imp.status, 200);
      const after = (await t.api('GET', '/api/notes')).json.notes;
      assert.equal(after.length, 4);
      assert.equal(after.filter((n) => n.kind === 'note').length, 3);
      assert.equal(after.find((n) => n.title === 'loose').tags.length, 0);
      assert.equal((await t.api('GET', '/api/stream?tag=ideas')).json.notes.length, 3);

      // merging the same export again changes nothing (and breaks no slot rule)
      const again = await t.api('POST', '/api/import?mode=merge', exported);
      assert.equal(again.status, 200);
      assert.equal((await t.api('GET', '/api/notes')).json.notes.length, 4);

      const zip = (await fetch(`${t.url}/api/export/markdown`)).status;
      assert.equal(zip, 200);
    } finally {
      await t.close();
    }
  });
});

describe('note titles and the per-tag daily switch', () => {
  let t;
  before(async () => (t = await startServer()));
  after(() => t.close());

  const put = (id, text, extra = {}) =>
    t.api('PUT', `/api/notes/${id}`, { baseRevision: 0, doc: docOf(para(text)), docFormat: 1, tags: [], date: '2026-10-05', opId: uuid(), kind: 'note', ...extra });
  const get = async (id) => (await t.api('GET', `/api/notes/${id}`)).json.note;

  test('a free note can be titled; changing only the title is an ordinary save; empty means untitled', async () => {
    const id = uuid();
    assert.equal((await put(id, 'body text', { title: '  Trip   to China  ' })).status, 200);
    assert.equal((await get(id)).title, 'Trip to China', 'trimmed to one line');

    // same text, new title: a new revision, and nothing else about the note moves
    let r = await t.api('PUT', `/api/notes/${id}`, { baseRevision: 1, doc: docOf(para('body text')), docFormat: 1, opId: uuid(), title: 'China trip' });
    assert.equal(r.json.revision, 2);
    assert.equal((await get(id)).title, 'China trip');
    assert.equal((await t.api('GET', `/api/notes/${id}/versions`)).json.versions.length, 0, 'a rename does not create a text version');

    // identical title and text: nothing happens
    r = await t.api('PUT', `/api/notes/${id}`, { baseRevision: 2, doc: docOf(para('body text')), docFormat: 1, opId: uuid(), title: 'China trip' });
    assert.equal(r.json.unchanged, true);

    // leaving title out keeps it; an empty title clears it
    r = await t.api('PUT', `/api/notes/${id}`, { baseRevision: 2, doc: docOf(para('body text changed')), docFormat: 1, opId: uuid() });
    assert.equal((await get(id)).title, 'China trip');
    r = await t.api('PUT', `/api/notes/${id}`, { baseRevision: 3, doc: docOf(para('body text changed')), docFormat: 1, opId: uuid(), title: '   ' });
    assert.equal((await get(id)).title, null);

    // a stale rename is refused like any stale save
    r = await t.api('PUT', `/api/notes/${id}`, { baseRevision: 1, doc: docOf(para('body text changed')), docFormat: 1, opId: uuid(), title: 'Late rename' });
    assert.equal(r.status, 409);
    assert.equal((await get(id)).title, null, 'nothing was overwritten');

    assert.equal((await put(uuid(), 'x', { title: 5 })).status, 400);
    const long = uuid();
    assert.equal((await put(long, 'x', { title: 'x'.repeat(300) })).status, 200);
    assert.equal((await get(long)).title.length, 120, 'long titles are cut to 120 characters');
  });

  test('daily entries are named by their date: a title sent for one is ignored', async () => {
    const id = uuid();
    await put(id, 'daily text', { kind: 'daily', tags: ['journal'], title: 'Nope' });
    const n = await get(id);
    assert.equal(n.kind, 'daily');
    assert.equal(n.title, null);
  });

  test('the notes list shows a name when there is one, otherwise the first line; search finds names', async () => {
    const named = uuid();
    const plain = uuid();
    await put(named, 'first line\nsecond line', { title: 'Flight plans' });
    await put(plain, 'Just a thought\nmore words');
    const list = (await t.api('GET', '/api/notes?limit=100')).json.notes;
    const a = list.find((n) => n.id === named);
    const b = list.find((n) => n.id === plain);
    assert.deepEqual([a.title, a.named, a.preview], ['Flight plans', true, 'first line · second line']);
    assert.deepEqual([b.title, b.named, b.preview], ['Just a thought', false, 'more words']);
    const hit = (await t.api('GET', '/api/notes?q=flight')).json.notes.map((n) => n.id);
    assert.deepEqual(hit, [named], 'a title is searchable');
  });

  test('tags made by writing a free note have no daily entry; tags made by a daily note do; it can be switched', async () => {
    await put(uuid(), 'x', { tags: ['trip/china'] });
    await save(t, uuid(), docOf(para('d')), { tags: ['journal-x'] });
    let tags = (await t.api('GET', '/api/tags')).json.tags;
    const china = tags.find((x) => x.path === 'trip/china');
    const journal = tags.find((x) => x.path === 'journal-x');
    assert.deepEqual([china.daily, journal.daily], [false, true]);

    // the stream says so, and a tag that does not exist yet is a new daily stream
    assert.equal((await t.api('GET', '/api/stream?tag=trip/china')).json.tag.daily, false);
    assert.equal((await t.api('GET', '/api/stream?tag=never-used')).json.tag.daily, true);

    assert.equal((await t.api('PUT', `/api/tags/${china.id}/daily`, { daily: true })).status, 200);
    assert.equal((await t.api('GET', '/api/stream?tag=trip/china')).json.tag.daily, true);
    assert.equal((await t.api('PUT', `/api/tags/${china.id}/daily`, { daily: 'yes' })).status, 400);
    assert.equal((await t.api('PUT', `/api/tags/${uuid()}/daily`, { daily: true })).status, 404);

    // tagging a free note with a brand-new tag makes a no-daily tag; export/import keeps the setting
    const id = uuid();
    await put(id, 'y', { tags: [] });
    await t.api('POST', `/api/notes/${id}/tags`, { path: 'fresh-topic' });
    await t.api('PUT', `/api/tags/${journal.id}/daily`, { daily: false });
    const exported = (await t.api('GET', '/api/export/json')).json;
    assert.equal(exported.tags.find((x) => x.path === 'fresh-topic').daily, false);
    assert.equal((await t.api('POST', '/api/import?mode=replace', exported)).status, 200);
    tags = (await t.api('GET', '/api/tags')).json.tags;
    assert.deepEqual(
      ['trip/china', 'journal-x', 'fresh-topic'].map((p) => tags.find((x) => x.path === p).daily),
      [true, false, false],
    );
  });

  test('titles survive export and import', async () => {
    const id = uuid();
    await put(id, 'keep my name', { title: 'Named note' });
    const exported = (await t.api('GET', '/api/export/json')).json;
    assert.equal(exported.notes.find((n) => n.id === id).title, 'Named note');
    assert.equal((await t.api('POST', '/api/import?mode=replace', exported)).status, 200);
    assert.equal((await get(id)).title, 'Named note');
  });
});

describe('assistant access', () => {
  const KEY = 'test-key-0123456789-abcdefghij';
  let t;
  before(async () => (t = await startServer({ ASSISTANT_TOKEN: KEY })));
  after(() => t.close());
  const as = (method, p, body) => t.api(method, `/api/assistant${p}`, body, { authorization: `Bearer ${KEY}` });

  test('off unless a key is set; with one, only the right key gets in', async () => {
    const off = await startServer();
    try {
      assert.equal((await off.api('GET', '/api/assistant/ping')).status, 404, 'no key configured: the door does not exist');
    } finally {
      await off.close();
    }
    assert.equal((await t.api('GET', '/api/assistant/ping')).status, 401);
    assert.equal((await t.api('GET', '/api/assistant/ping', undefined, { authorization: 'Bearer wrong' })).status, 401);
    assert.equal((await t.api('POST', '/api/assistant/notes', { markdown: 'x' }, { authorization: 'Bearer nope' })).status, 401);
    assert.equal((await as('GET', '/ping')).status, 200);
    assert.equal((await t.api('GET', '/api/tags')).status, 200, 'the normal app API is unaffected');
    assert.throws(() => loadConfig({ ASSISTANT_TOKEN: 'short' }), /at least 20/);
  });

  test('a note from Markdown: title, tags, tasks with typed dates, readable back, found by search', async () => {
    const md = '# Call with Sam\n\nWe agreed on the **plan**.\n\n## Actions\n- [ ] Send the deck due 2026-12-01\n- [x] Book the room\n- plain bullet\n';
    const made = await as('POST', '/notes', { title: 'Sam call', markdown: md, tags: ['people/sam', 'meetings'], date: '2026-10-05' });
    assert.equal(made.status, 200);
    const id = made.json.id;

    const note = (await as('GET', `/notes/${id}`)).json;
    assert.deepEqual([note.title, note.kind, note.date, note.tags], ['Sam call', 'note', '2026-10-05', ['meetings', 'people/sam']]);
    assert.match(note.markdown, /# Call with Sam/);
    assert.match(note.markdown, /- \[ \] Send the deck due 2026-12-01/);
    assert.match(note.markdown, /- \[x\] Book the room/);
    assert.deepEqual(note.tasks.map((x) => [x.text, x.checked, x.due]), [['Send the deck due 2026-12-01', false, '2026-12-01'], ['Book the room', true, null]]);

    const found = (await as('GET', '/notes?q=agreed')).json.notes;
    assert.deepEqual(found.map((n) => n.id), [id]);
    assert.equal(found[0].title, 'Sam call');
    // and it is an ordinary note in the app
    assert.equal((await t.api('GET', `/api/notes/${id}`)).json.note.title, 'Sam call');
    assert.equal((await t.api('GET', '/api/tasks')).json.tasks.some((x) => x.text === 'Send the deck due 2026-12-01' && x.due === '2026-12-01'), true);

    assert.equal((await as('POST', '/notes', { markdown: '   ' })).status, 400);
    assert.equal((await as('POST', '/notes', { markdown: 'x', date: 'soon' })).status, 400);
  });

  test('append adds to the end and keeps the earlier text as a version; the app sees a stale edit as a conflict', async () => {
    const { id } = (await as('POST', '/notes', { markdown: 'first paragraph', date: '2026-10-05' })).json;
    const r = await as('POST', `/notes/${id}/append`, { markdown: '## Later\n- [ ] follow up due fri' });
    assert.equal(r.status, 200);
    assert.equal(r.json.revision, 2);
    const note = (await as('GET', `/notes/${id}`)).json;
    assert.match(note.markdown, /^first paragraph\n\n## Later\n\n- \[ \] follow up due fri/);
    assert.equal((await t.api('GET', `/api/notes/${id}/versions`)).json.versions.length, 1, 'the text before the append is in History');

    // someone editing the old text in the app does not silently erase it
    const stale = await t.api('PUT', `/api/notes/${id}`, { baseRevision: 1, doc: docOf(para('first paragraph edited')), docFormat: 1, opId: uuid() });
    assert.equal(stale.status, 409);
    assert.match((await as('GET', `/notes/${id}`)).json.markdown, /## Later/);

    assert.equal((await as('POST', `/notes/${uuid()}/append`, { markdown: 'x' })).status, 404);
    assert.equal((await as('POST', `/notes/${id}/append`, { markdown: '' })).status, 400);
  });

  test("daily/append: writes into today's entry of the Today tag, creating it once", async () => {
    const today = dateInTz(new Date(), t.config.tz);
    const a = (await as('POST', '/daily/append', { markdown: 'Morning thought' })).json;
    assert.deepEqual([a.tag, a.date, a.created], ['daily-jots', today, true]);
    const b = (await as('POST', '/daily/append', { markdown: 'Afternoon thought' })).json;
    assert.equal(b.id, a.id, 'the same entry');
    const stream = (await t.api('GET', '/api/stream?tag=daily-jots')).json.notes;
    assert.equal(stream.filter((n) => n.date === today).length, 1);
    assert.match((await as('GET', `/notes/${a.id}`)).json.markdown, /Morning thought\n\nAfternoon thought/);
    const other = (await as('POST', '/daily/append', { markdown: 'x', tag: 'work-log' })).json;
    assert.equal(other.tag, 'work-log');
  });

  test('tasks: tick and date one; overview sorts what is open', async () => {
    const today = dateInTz(new Date(), t.config.tz);
    const day = (n) => dateInTz(new Date(Date.now() + n * 86_400_000), t.config.tz);
    const md = ['- [ ] overdue thing', '- [ ] today thing', '- [ ] soon thing', '- [ ] far thing', '- [ ] undated thing', '- [ ] hidden thing', '- [ ] not yet thing'].join('\n');
    const { id } = (await as('POST', '/notes', { markdown: md })).json;
    const tasks = (await as('GET', `/notes/${id}`)).json.tasks;
    const idOf = (text) => tasks.find((x) => x.text === text).id;
    const set = (text, patch) => as('POST', `/notes/${id}/tasks/${idOf(text)}`, patch);
    assert.equal((await set('overdue thing', { due: day(-3) })).status, 200);
    assert.equal((await set('today thing', { due: today })).status, 200);
    assert.equal((await set('soon thing', { due: day(3) })).status, 200);
    assert.equal((await set('far thing', { due: day(30) })).status, 200);
    assert.equal((await set('hidden thing', { hidden: true })).status, 200);
    assert.equal((await set('not yet thing', { start: day(5) })).status, 200);

    const o = (await as('GET', '/overview')).json;
    assert.equal(o.today, today);
    const bucket = (text) => o.tasks.find((x) => x.text === text)?.bucket;
    assert.deepEqual(['overdue thing', 'today thing', 'soon thing', 'far thing', 'undated thing'].map(bucket), ['overdue', 'today', 'upcoming', 'later', 'nodate']);
    assert.equal(bucket('hidden thing'), undefined, 'hidden tasks are left out');
    assert.equal(bucket('not yet thing'), undefined, 'tasks that have not started are left out');

    // tick it; it drops off the overview and the note reads back ticked
    assert.equal((await set('today thing', { checked: true })).status, 200);
    assert.equal((await as('GET', '/overview')).json.tasks.some((x) => x.text === 'today thing'), false);
    assert.match((await as('GET', `/notes/${id}`)).json.markdown, /- \[x\] today thing/);

    assert.equal((await as('POST', `/notes/${id}/tasks/${uuid()}`, { checked: true })).status, 404);
    assert.equal((await set('far thing', { checked: 'yes' })).status, 400);
    assert.equal((await set('far thing', { due: 'friday' })).status, 400);
    assert.equal((await set('far thing', {})).status, 400);
  });
});

describe('Markdown to note', () => {
  test('headings, emphasis, nested lists, tasks; odd syntax stays as text; always a valid document', async () => {
    const { markdownToDoc } = await import('../../shared/markdown-import.js');
    const doc = markdownToDoc('---\ntags: x\n---\n#### Deep\n\nsnake_case and *it* and __bold__\nwrapped line\n\n- a\n  - b\n    - [x] c\n1. one\n\n> quoted [[Wiki]] [link](http://e.com)\n');
    assert.equal(validateDoc(doc), null);
    const kinds = doc.content.map((n) => n.type);
    assert.deepEqual(kinds, ['heading', 'paragraph', 'bulletList', 'paragraph']);
    assert.equal(doc.content[0].attrs.level, 3, 'deep headings become level 3');
    assert.equal(plainTextOf(doc.content[1]), 'snake_case and it and bold wrapped line');
    assert.equal(doc.content[2].content[0].content[1].content[0].content[1].type, 'taskList', 'nesting follows indentation');
    assert.equal(plainTextOf(doc.content[2].content[1]), 'one', 'a numbered item joins the bullet list above it');
    assert.equal(plainTextOf(doc.content.at(-1)), 'quoted [[Wiki]] link', 'quote marker dropped; wiki link and link text kept');
    assert.equal(markdownToDoc('').content.length, 1, 'empty input is still a valid empty note');
  });
});

describe('task priority, hide-until and date phrase positions', () => {
  test('findDatePhrases says where in the text each date phrase is', async () => {
    const { findDatePhrases } = await import('../../shared/taskdates.js');
    const text = 'send the deck due fri then rest, starts oct 12';
    const found = findDatePhrases(text, '2026-10-05');
    assert.deepEqual(found.map((p) => [p.kind, p.date, text.slice(p.index, p.index + p.length)]), [
      ['due', '2026-10-09', 'due fri'],
      ['start', '2026-10-12', 'starts oct 12'],
    ]);
    assert.deepEqual(findDatePhrases('nothing due soon', '2026-10-05'), []);
  });

  test('priority and hide-until are stored only when set, validated, and listed', async () => {
    const { extractTasks, updateTask, priorityRank, taskMetaLabel } = await import('../../shared/tasks.js');
    const id = 'task-pppp-1111';
    const doc = docOf({ type: 'taskList', content: [task('plan trip', false, id)] });
    const set = updateTask(doc, id, { priority: 'both', hideUntil: '2026-10-20' });
    const [t] = extractTasks(set, '2026-10-05');
    assert.deepEqual([t.priority, t.hideUntil], ['both', '2026-10-20']);
    assert.equal(taskMetaLabel(set.content[0].content[0].attrs), 'urgent & important · hidden until Tue, Oct 20');
    const cleared = updateTask(set, id, { priority: null, hideUntil: null });
    assert.deepEqual(cleared.content[0].content[0].attrs, { checked: false, id }, 'None / shown again leaves no trace');
    assert.deepEqual(['both', 'urgent', 'important', null].map(priorityRank), [0, 1, 2, 3]);

    const withAttrs = (attrs) => docOf({ type: 'taskList', content: [{ ...task('x', false, id), attrs: { checked: false, id, ...attrs } }] });
    assert.match(validateDoc(withAttrs({ priority: 'high' })), /priority must be/);
    assert.match(validateDoc(withAttrs({ hideUntil: 'later' })), /hideUntil must be/);
    assert.equal(validateDoc(withAttrs({ priority: 'urgent', hideUntil: '2026-10-20' })), null);
  });

  test('the assistant can set priority and hide-until, and hidden-until tasks leave its overview', async () => {
    const KEY = 'test-key-0123456789-abcdefghij';
    const t = await startServer({ ASSISTANT_TOKEN: KEY });
    try {
      const as = (method, p, body) => t.api(method, `/api/assistant${p}`, body, { authorization: `Bearer ${KEY}` });
      const day = (n) => dateInTz(new Date(Date.now() + n * 86_400_000), t.config.tz);
      const { id } = (await as('POST', '/notes', { markdown: '- [ ] keep visible\n- [ ] snooze me' })).json;
      const tasks = (await as('GET', `/notes/${id}`)).json.tasks;
      const idOf = (text) => tasks.find((x) => x.text === text).id;
      assert.equal((await as('POST', `/notes/${id}/tasks/${idOf('keep visible')}`, { priority: 'urgent' })).status, 200);
      assert.equal((await as('POST', `/notes/${id}/tasks/${idOf('snooze me')}`, { hideUntil: day(5) })).status, 200);
      const overview = (await as('GET', '/overview')).json.tasks;
      assert.deepEqual(overview.map((x) => [x.text, x.priority]), [['keep visible', 'urgent']], 'the snoozed one is out of the overview');
      assert.equal((await as('POST', `/notes/${id}/tasks/${idOf('keep visible')}`, { priority: 'huge' })).status, 400);
      assert.equal((await as('POST', `/notes/${id}/tasks/${idOf('keep visible')}`, { hideUntil: 'someday' })).status, 400);
      assert.equal((await t.api('GET', '/api/tasks')).json.tasks.find((x) => x.text === 'snooze me').hideUntil, day(5));
    } finally {
      await t.close();
    }
  });
});
