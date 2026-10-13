// The one task list every screen reads (client/src/task-data.js): the server's rows, corrected by this device's own copy
// of every note it holds changes to.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { SyncManager } from '../../client/src/sync.js';
import { createTaskData } from '../../client/src/task-data.js';
import { taskKey, taskRecords } from '../../shared/tasks.js';
import { deferredApi, fakeStore, fakeClock, fakeLifecycle, sequentialIds, settle } from './fakes.js';

const paragraph = (text) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
const item = (id, text, attrs = {}) => ({ type: 'taskItem', attrs: { id, checked: false, ...attrs }, content: [paragraph(text)] });
const docWith = (...items) => ({ type: 'doc', content: [paragraph('A note'), { type: 'taskList', content: items }] });
const noteOf = (id, date, doc, extra = {}) => ({ id, date, kind: 'daily', revision: 1, tags: [{ id: 't1', path: 'journal' }], doc, ...extra });
const rowsOf = (...notes) => notes.flatMap((n) => taskRecords({ id: n.id, doc: n.doc, date: n.date, tags: n.tags.map((t) => t.path), revision: n.revision }));
const texts = (data) => data.tasks().map((t) => t.text);

class FakeEvents {
  #handlers = new Map();
  on(name, fn) {
    this.#handlers.set(name, [...(this.#handlers.get(name) ?? []), fn]);
    return () => this.#handlers.set(name, this.#handlers.get(name).filter((f) => f !== fn));
  }
  emit(name) {
    for (const fn of this.#handlers.get(name) ?? []) fn();
  }
  count(name) {
    return (this.#handlers.get(name) ?? []).length;
  }
}

function setup(initialRows = []) {
  const clock = fakeClock();
  const events = new FakeEvents();
  const calls = [];
  let answer = initialRows;
  let hold = null; // when set, api.tasks() waits for it
  const fetches = { count: 0 };
  const api = {
    ...deferredApi(),
    tasks: async () => {
      fetches.count++;
      const mine = answer;
      if (hold) await hold;
      if (answer === 'fail') throw new Error('Cannot reach the server');
      return { tasks: mine === 'fail' ? [] : mine };
    },
    getNote: async () => {
      throw new Error('not used here');
    },
  };
  const sync = new SyncManager({ api, store: fakeStore(), timers: clock.timers, now: clock.now, newId: sequentialIds('op'), lifecycle: fakeLifecycle() });
  const data = createTaskData({ api, sync, events, timers: clock.timers, now: clock.now });
  return {
    clock, events, sync, data, calls, fetches,
    serve: (rows) => { answer = rows; },
    holdNext() {
      let release;
      hold = new Promise((resolve) => (release = resolve));
      return () => { hold = null; release(); };
    },
  };
}

describe('the list', () => {
  test('is empty of rows until the server has answered, then shows what it said', async () => {
    const note = noteOf('note-aaaa-0001', '2026-10-13', docWith(item('task-a-0001', 'call'), item('task-a-0002', 'write')));
    const env = setup(rowsOf(note));
    assert.equal(env.data.tasks(), null);
    const stop = env.data.watch();
    await settle();
    assert.deepEqual(texts(env.data), ['call', 'write']);
    assert.equal(env.data.error(), null);
    stop();
  });

  test('a note this device has unsent edits to replaces that note’s rows, including a task removed here', async () => {
    const server = noteOf('note-aaaa-0002', '2026-10-13', docWith(item('task-b-0001', 'keep'), item('task-b-0002', 'remove me')));
    const other = noteOf('note-aaaa-0003', '2026-10-12', docWith(item('task-b-0003', 'elsewhere')));
    const env = setup(rowsOf(server, other));
    env.data.watch();
    await settle();
    assert.deepEqual(texts(env.data), ['keep', 'remove me', 'elsewhere']);

    const session = env.sync.adopt(server);
    session.removeTask('task-b-0002'); // editTask: held on the device, not yet sent
    await settle();
    assert.deepEqual(texts(env.data), ['keep', 'elsewhere'], 'the removed task is gone straight away, the other note is untouched');

    session.applyTaskPatch('task-b-0001', { content: [paragraph('keep, reworded')] });
    await settle();
    assert.deepEqual(texts(env.data), ['keep, reworded', 'elsewhere']);
  });

  test('a task typed into an open editor is listed, and a note the server does not know yet appears in date order', async () => {
    const known = noteOf('note-aaaa-0004', '2026-10-10', docWith(item('task-c-0001', 'old note task')));
    const env = setup(rowsOf(known));
    env.data.watch();
    await settle();

    const open = env.sync.adopt(known);
    let live = known.doc;
    open.attachEditor({ provider: () => live, updateTask: () => true, removeTask: () => true });
    live = docWith(item('task-c-0001', 'old note task'), item('task-c-0009', 'typed just now'));
    open.touch();
    open.captureNow({ schedule: false });
    await settle();
    assert.deepEqual(texts(env.data), ['old note task', 'typed just now']);

    // a brand-new note, on this device only, dated later than the one the server has
    const fresh = env.sync.newNote('2026-10-13', ['journal']);
    fresh.attach(() => docWith(item('task-c-0010', 'from a new note')));
    fresh.touch();
    fresh.captureNow({ schedule: false });
    await settle();
    assert.deepEqual(texts(env.data), ['from a new note', 'old note task', 'typed just now'], 'newest note first, like the server');
  });

  test('a note nobody has touched here is the server’s, and a newer server list wins over an older session', async () => {
    const v1 = noteOf('note-aaaa-0005', '2026-10-13', docWith(item('task-d-0001', 'first words')));
    const env = setup(rowsOf(v1));
    env.sync.adopt(v1); // loaded earlier, clean, at revision 1
    env.data.watch();
    await settle();
    assert.deepEqual(texts(env.data), ['first words']);

    // someone else changes the note: revision 2 on the server
    const v2 = noteOf('note-aaaa-0005', '2026-10-13', docWith(item('task-d-0001', 'reworded elsewhere')), { revision: 2 });
    env.serve(rowsOf(v2));
    await env.data.refresh();
    assert.deepEqual(texts(env.data), ['reworded elsewhere'], 'the idle session is older than the list, so the list is right');
  });

  test('a note saved here after the list was fetched keeps showing this device’s version until the list catches up', async () => {
    const v1 = noteOf('note-aaaa-0006', '2026-10-13', docWith(item('task-e-0001', 'before')));
    const env = setup(rowsOf(v1));
    const session = env.sync.adopt(v1);
    env.data.watch();
    await settle();

    session.applyTaskPatch('task-e-0001', { content: [paragraph('after')] });
    session.revision = 2; // the server confirmed it (what a successful save does)
    session.pending = null;
    session.dirtySeq = session.capturedSeq = 0;
    session.serverDoc = docWith(item('task-e-0001', 'after'));
    env.sync.emit();
    await settle();
    assert.deepEqual(texts(env.data), ['after'], 'ahead of the list, so this device’s copy is used');
  });
});

describe('asking the server', () => {
  test('appearing, focus, coming back online and a visible page each ask; nothing else does', async () => {
    const env = setup([]);
    const stop = env.data.watch();
    await settle();
    assert.equal(env.fetches.count, 1);
    env.clock.advance(5000);
    for (const name of ['focus', 'online', 'visibilitychange']) {
      const before = env.fetches.count;
      env.events.emit(name);
      await settle();
      assert.equal(env.fetches.count, before + 1, name);
    }
    // saving a note, typing: no events, no asks
    const before = env.fetches.count;
    env.sync.emit();
    await settle();
    assert.equal(env.fetches.count, before);
    stop();
    assert.equal(env.events.count('focus'), 0, 'listeners are removed when the last screen goes');
  });

  test('announced changes are coalesced into one ask', async () => {
    const env = setup([]);
    env.data.watch();
    await settle();
    const before = env.fetches.count;
    env.events.emit('hq-data-changed');
    env.events.emit('hq-data-changed');
    env.events.emit('hq-data-changed');
    await env.clock.advance(300);
    assert.equal(env.fetches.count, before + 1);
  });

  test('a second screen appearing soon after does not ask again; a request made while one runs follows it', async () => {
    const env = setup([]);
    const first = env.data.watch();
    await settle();
    assert.equal(env.fetches.count, 1);
    const second = env.data.watch();
    await settle();
    assert.equal(env.fetches.count, 1, 'the list is fresh');

    const release = env.holdNext();
    env.clock.advance(5000);
    const running = env.data.refresh();
    env.data.refresh();
    env.data.refresh();
    assert.equal(env.fetches.count, 2, 'one request in flight');
    release();
    await running;
    await settle();
    assert.equal(env.fetches.count, 3, 'and exactly one more for everything asked meanwhile');
    first();
    second();
  });

  test('a failed ask keeps the list on screen and says why; the next one clears it', async () => {
    const note = noteOf('note-aaaa-0007', '2026-10-13', docWith(item('task-f-0001', 'stay')));
    const env = setup(rowsOf(note));
    env.data.watch();
    await settle();
    env.serve('fail');
    await env.data.refresh();
    assert.deepEqual(texts(env.data), ['stay']);
    assert.match(env.data.error(), /Cannot reach/);
    env.serve(rowsOf(note));
    await env.data.refresh();
    assert.equal(env.data.error(), null);
  });

  test('subscribers hear about a change in the list, not about every save status tick', async () => {
    const note = noteOf('note-aaaa-0008', '2026-10-13', docWith(item('task-g-0001', 'steady')));
    const env = setup(rowsOf(note));
    env.data.watch();
    await settle();
    let heard = 0;
    env.data.subscribe(() => heard++);
    for (let i = 0; i < 5; i++) env.sync.emit(); // status ticks
    assert.equal(heard, 0);
    env.sync.adopt(note).applyTaskPatch('task-g-0001', { checked: true });
    await settle();
    assert.ok(heard >= 1);
  });
});

describe('showing a change at once', () => {
  test('a patch is shown until it is released, a removal hides the row, and several stack', async () => {
    const note = noteOf('note-aaaa-0009', '2026-10-13', docWith(item('task-h-0001', 'tick me'), item('task-h-0002', 'drop me')));
    const env = setup(rowsOf(note));
    env.data.watch();
    await settle();
    const find = (id) => env.data.tasks().find((t) => t.taskId === id);

    const releaseCheck = env.data.optimistic('note-aaaa-0009', 'task-h-0001', { checked: true });
    assert.equal(find('task-h-0001').checked, true);
    const releaseDue = env.data.optimistic('note-aaaa-0009', 'task-h-0001', { due: '2026-11-01' });
    assert.equal(find('task-h-0001').checked, true);
    assert.equal(find('task-h-0001').due, '2026-11-01');
    assert.equal(find('task-h-0001').dueFrom, 'set');
    releaseCheck();
    assert.equal(find('task-h-0001').checked, false, 'the first is gone, the second stays');
    assert.equal(find('task-h-0001').due, '2026-11-01');
    releaseDue();
    assert.equal(find('task-h-0001').due, null);

    const releaseDrop = env.data.optimistic('note-aaaa-0009', 'task-h-0002', null);
    assert.equal(find('task-h-0002'), undefined);
    releaseDrop();
    assert.ok(find('task-h-0002'), 'a change that did not stick comes back');
  });

  test('a cleared date falls back to a date typed in the words, as the server says', async () => {
    const note = noteOf('note-aaaa-0010', '2026-10-13', docWith(item('task-i-0001', 'send the deck due 2026-12-01', { due: '2026-11-15' })));
    const env = setup(rowsOf(note));
    env.data.watch();
    await settle();
    const release = env.data.optimistic('note-aaaa-0010', 'task-i-0001', { due: null });
    const row = env.data.tasks()[0];
    assert.equal(row.due, '2026-12-01');
    assert.equal(row.dueFrom, 'text');
    release();
    assert.equal(taskKey(row), 'note-aaaa-0010:task-i-0001');
  });
});
