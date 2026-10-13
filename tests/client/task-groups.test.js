import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { bucketOf, groupTasks, streamsOf, visibleSections, withinRange, COMPACT_UNDATED } from '../../client/src/task-groups.js';
import { taskKey } from '../../shared/tasks.js';

const TODAY = '2026-10-13';
const NOW = '10:00';
let n = 0;
const task = (over = {}) => ({
  noteId: `note-${++n}`, taskId: `task-${n}`, text: `task ${n}`, checked: false, dismissedAt: null, completedAt: null,
  due: null, start: null, dueTime: null, startTime: null, hidden: false, hideUntil: null, priority: null,
  date: '2026-10-10', tags: ['journal'], ...over,
});
const ctx = (extra = {}) => ({ today: TODAY, now: NOW, touched: new Set(), ...extra });

describe('which section a task is in', () => {
  test('each state lands where it belongs', () => {
    const cases = [
      [{ dismissedAt: '2026-10-01T00:00:00.000Z', checked: true }, 'dismissed'],
      [{ checked: true }, 'done'],
      [{ hidden: true, due: '2026-10-01' }, 'hidden'],
      [{ hideUntil: '2026-10-20', due: '2026-10-01' }, 'hidden'],
      [{ hideUntil: '2026-10-12' }, 'anytime'],
      [{ start: '2026-10-20' }, 'later'],
      [{ due: '2026-10-12' }, 'overdue'],
      [{ due: TODAY, dueTime: '09:00' }, 'overdue'],
      [{ due: TODAY, dueTime: '17:00' }, 'today'],
      [{ due: TODAY }, 'today'],
      [{ due: '2026-10-20' }, 'upcoming'],
      [{}, 'anytime'],
    ];
    for (const [over, expected] of cases) assert.equal(bucketOf(task(over), ctx()), expected, JSON.stringify(over));
  });

  test('a task ticked on this screen stays where it was until the screen is left', () => {
    const t = task({ checked: true, due: '2026-10-12' });
    assert.equal(bucketOf(t, ctx()), 'done');
    assert.equal(bucketOf(t, ctx({ touched: new Set([taskKey(t)]) })), 'overdue');
  });
});

describe('the task being edited', () => {
  test('stays in its section while its words change, and moves when editing ends', () => {
    // typing "today" into the words of a task with no date makes it due today
    const typed = task({ text: 'water the plants today', due: TODAY, dueFrom: 'text' });
    const key = taskKey(typed);
    assert.equal(bucketOf(typed, ctx()), 'today');
    assert.equal(bucketOf(typed, ctx({ pinned: new Map([[key, 'anytime']]) })), 'anytime');
    const g = groupTasks([typed, task()], ctx({ pinned: new Map([[key, 'anytime']]) }));
    assert.equal(g.anytime.length, 2);
    assert.equal(g.today.length, 0);
    assert.equal(groupTasks([typed], ctx({ pinned: null })).today.length, 1);
  });
});

describe('order', () => {
  test('overdue and today go by priority, then by date and time; undated keep the list order', () => {
    const rows = [
      task({ due: '2026-10-12', text: 'plain late' }),
      task({ due: '2026-10-11', text: 'earlier late' }),
      task({ due: '2026-10-12', priority: 'urgent', text: 'urgent late' }),
      task({ due: '2026-10-11', priority: 'both', text: 'both late' }),
      task({ text: 'first undated' }),
      task({ text: 'second undated', priority: 'important' }),
      task({ text: 'third undated' }),
    ];
    const g = groupTasks(rows, ctx());
    assert.deepEqual(g.overdue.map((t) => t.text), ['both late', 'urgent late', 'earlier late', 'plain late']);
    assert.deepEqual(g.anytime.map((t) => t.text), ['second undated', 'first undated', 'third undated']);
  });

  test('later is by start date; ties go to the newer note', () => {
    const g = groupTasks(
      [task({ start: '2026-10-30', text: 'c' }), task({ start: '2026-10-20', date: '2026-10-01', text: 'a-old' }), task({ start: '2026-10-20', date: '2026-10-09', text: 'a-new' })],
      ctx(),
    );
    assert.deepEqual(g.later.map((t) => t.text), ['a-new', 'a-old', 'c']);
  });

  test('undated tasks are grouped by the first tag of their note', () => {
    const streams = streamsOf([task({ tags: ['school'] }), task({ tags: [] }), task({ tags: ['school', 'x'] }), task({ tags: ['home'] })]);
    assert.deepEqual([...streams.keys()], ['school', '(untagged)', 'home']);
    assert.equal(streams.get('school').length, 2);
  });
});

describe('what the dashboard’s box shows', () => {
  const rows = [
    task({ due: '2026-10-11' }),
    task({ due: TODAY }),
    task({ due: '2026-10-16' }),
    task({ due: '2026-10-30' }),
    ...Array.from({ length: 8 }, () => task()),
  ];
  const buckets = groupTasks(rows, ctx());

  test('overdue only, today, the week, and everything', () => {
    const at = (level, compact = true) => visibleSections(buckets, { level, compact, today: TODAY });
    assert.deepEqual([at('overdue').showToday, at('overdue').showUpcoming, at('overdue').showUndated], [false, false, false]);
    assert.equal(at('overdue').listed, 1);
    assert.equal(at('today').listed, 2);
    assert.equal(at('week').listed, 3, 'the task due in 17 days is not in the next week');
    assert.equal(at('week').upcomingShown.length, 1);
    const all = at('all');
    assert.equal(all.undatedShown.length, COMPACT_UNDATED);
    assert.equal(all.undatedMore, 3);
    assert.equal(all.listed, 1 + 1 + 1 + COMPACT_UNDATED);
    assert.equal(all.openCount, 12, 'everything open is still counted');
  });

  test('the Tasks page shows everything', () => {
    const page = visibleSections(buckets, { level: 'all', compact: false, today: TODAY });
    assert.equal(page.upcomingShown.length, 2);
    assert.equal(page.undatedShown.length, 8);
    assert.equal(page.undatedMore, 0);
  });
});

describe('Done and Dismissed by date range', () => {
  const tz = 'America/Edmonton';
  const rows = [
    task({ completedAt: '2026-10-12T20:00:00.000Z', checked: true }),
    task({ completedAt: '2026-09-01T20:00:00.000Z', checked: true }),
    task({ checked: true }), // no day recorded
  ];

  test('what is outside the range is counted, and a task with no day is always listed', () => {
    const r = withinRange(rows, { from: '2026-10-07', to: '2026-10-13' }, tz);
    assert.equal(r.list.length, 2);
    assert.equal(r.outside, 1);
  });

  test('no limit lists everything', () => {
    assert.deepEqual(withinRange(rows, { from: '', to: '' }, tz), { list: rows, outside: 0 });
  });

  test('the day is the home day, not the UTC day', () => {
    // 03:00 UTC on the 14th is still the 13th in Edmonton
    const late = [task({ completedAt: '2026-10-14T03:00:00.000Z', checked: true })];
    assert.equal(withinRange(late, { from: '2026-10-13', to: '2026-10-13' }, tz).list.length, 1);
  });
});
