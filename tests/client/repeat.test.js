// Recurring tasks: the date math (month ends, leap years, the home timezone), the typed "every …" phrases, and what
// ticking, skipping and undoing do to a task (shared/repeat.js, shared/tasks.js patchedTaskAttrs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addMonths, nextDate, nextOccurrence, findRepeatPhrase, isValidRepeat, repeatLabel, MAX_COMPLETIONS } from '../../shared/repeat.js';
import { patchedTaskAttrs, updateTask, describeTask, taskMetaLabel } from '../../shared/tasks.js';
import { parseTaskSchedule } from '../../shared/taskdates.js';
import { validateDoc } from '../../shared/doc.js';

const TZ = 'America/Edmonton';
const rule = (r) => ({ every: 1, from: 'due', ...r });

test('months clamp to the last day and come back to the anchor day', () => {
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(addMonths('2028-01-31', 1), '2028-02-29'); // leap year
  assert.equal(addMonths('2026-02-28', 1, 31), '2026-03-31');
  assert.equal(addMonths('2026-04-30', 1, 31), '2026-05-31');
  assert.equal(addMonths('2026-11-15', 2), '2027-01-15'); // across the year
  assert.equal(addMonths('2026-03-31', -1), '2026-02-28');
  // a monthly task on the 31st, ticked again and again from its due date
  let due = '2026-01-31';
  const seen = [];
  for (let i = 0; i < 4; i++) seen.push((due = nextDate(rule({ unit: 'month', day: 31 }), due)));
  assert.deepEqual(seen, ['2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31']);
});

test('yearly on Feb 29 falls on Feb 28 and returns to Feb 29 in a leap year', () => {
  const r = rule({ unit: 'year', day: 29 });
  assert.equal(nextDate(r, '2028-02-29'), '2029-02-28');
  assert.equal(nextDate(r, '2031-02-28'), '2032-02-29');
  assert.equal(nextDate(rule({ unit: 'year', every: 4, day: 29 }), '2028-02-29'), '2032-02-29');
});

test('days and weeks, with and without chosen weekdays', () => {
  assert.equal(nextDate(rule({ unit: 'day', every: 3 }), '2026-12-30'), '2027-01-02');
  assert.equal(nextDate(rule({ unit: 'week', every: 2 }), '2026-10-16'), '2026-10-30');
  const monThu = rule({ unit: 'week', days: [1, 4] });
  assert.equal(nextDate(monThu, '2026-10-12'), '2026-10-15'); // Mon -> Thu
  assert.equal(nextDate(monThu, '2026-10-15'), '2026-10-19'); // Thu -> Mon
  assert.equal(nextDate(monThu, '2026-10-17'), '2026-10-19'); // Sat -> Mon
  const fortnightly = rule({ unit: 'week', every: 2, days: [1, 4] });
  assert.equal(nextDate(fortnightly, '2026-10-12'), '2026-10-15'); // same week
  assert.equal(nextDate(fortnightly, '2026-10-15'), '2026-10-26'); // skips a week
  const weekdays = rule({ unit: 'week', days: [1, 2, 3, 4, 5] });
  assert.equal(nextDate(weekdays, '2026-10-16'), '2026-10-19'); // Fri -> Mon
});

test('from completion counts from the day it was ticked in the home timezone', () => {
  const r = rule({ unit: 'day', every: 3, from: 'done' });
  // 2026-10-17 04:30 UTC is still Oct 16 in Edmonton (UTC-6 in October)
  assert.equal(nextOccurrence(r, { due: '2026-10-01', now: '2026-10-17T04:30:00.000Z', tz: TZ }).due, '2026-10-19');
  assert.equal(nextOccurrence(r, { due: '2026-10-01', now: '2026-10-17T07:30:00.000Z', tz: TZ }).due, '2026-10-20');
  // the day is whatever the runtime's timezone data says. On 2026-03-08 Edmonton's clocks went forward (UTC-7 to UTC-6,
  // where tzdata 2026c keeps them for good), so 06:30 UTC is still Mar 7 and 07:30 UTC is already Mar 8
  assert.equal(nextOccurrence(rule({ unit: 'day', from: 'done' }), { due: null, now: '2026-03-08T06:30:00.000Z', tz: TZ }).due, '2026-03-08');
  assert.equal(nextOccurrence(rule({ unit: 'day', from: 'done' }), { due: null, now: '2026-03-08T07:30:00.000Z', tz: TZ }).due, '2026-03-09');
  // and another zone gives another day for the same instant
  assert.equal(nextOccurrence(rule({ unit: 'day', from: 'done' }), { due: null, now: '2026-10-17T04:30:00.000Z', tz: 'UTC' }).due, '2026-10-18');
});

test('from the scheduled date moves on one step, even when that is still overdue, and keeps the start lead', () => {
  const r = rule({ unit: 'month' });
  const next = nextOccurrence(r, { due: '2026-09-01', start: '2026-08-29', now: '2026-10-16T18:00:00.000Z', tz: TZ });
  assert.deepEqual(next, { due: '2026-10-01', start: '2026-09-28' });
  // with no due date it counts from the completion day
  assert.equal(nextOccurrence(r, { due: null, now: '2026-10-16T18:00:00.000Z', tz: TZ }).due, '2026-11-16');
});

test('typed repeat phrases', () => {
  const r = (t) => findRepeatPhrase(t)?.rule ?? null;
  assert.deepEqual(r('pay rent every month'), { every: 1, unit: 'month', from: 'due' });
  assert.deepEqual(r('water plants every 3 days from done'), { every: 3, unit: 'day', from: 'done' });
  assert.deepEqual(r('timesheet every 2 weeks'), { every: 2, unit: 'week', from: 'due' });
  assert.deepEqual(r('gym every mon and thu'), { every: 1, unit: 'week', days: [1, 4], from: 'due' });
  assert.deepEqual(r('gym every Monday, Wednesday & Friday'), { every: 1, unit: 'week', days: [1, 3, 5], from: 'due' });
  assert.deepEqual(r('standup every weekday'), { every: 1, unit: 'week', days: [1, 2, 3, 4, 5], from: 'due' });
  assert.deepEqual(r('backup daily'), { every: 1, unit: 'day', from: 'due' });
  assert.deepEqual(r('renew passport annually'), { every: 1, unit: 'year', from: 'due' });
  assert.deepEqual(r('payroll fortnightly'), { every: 2, unit: 'week', from: 'due' });
  assert.deepEqual(r('mow every other week after completion'), { every: 2, unit: 'week', from: 'done' });
  assert.equal(r('everyone at the meeting'), null);
  assert.equal(r('every 0 days'), null);
  assert.deepEqual(r('read the monthly report'), r('monthly')); // a bare adverb counts
  const p = findRepeatPhrase('pay rent every month due nov 1');
  assert.equal('pay rent every month due nov 1'.slice(p.index, p.index + p.length), 'every month');
});

test('a repeat phrase is not read as a date', () => {
  assert.equal(parseTaskSchedule('gym every mon', '2026-10-16').due, null);
  assert.equal(parseTaskSchedule('pay rent every month due nov 1', '2026-10-16').due, '2026-11-01');
  assert.equal(parseTaskSchedule('review every 2 weeks', '2026-10-16').due, null);
});

test('labels and validation', () => {
  assert.equal(repeatLabel(rule({ unit: 'week', every: 2 })), 'every 2 weeks');
  assert.equal(repeatLabel(rule({ unit: 'month', from: 'done' })), 'monthly · from done');
  assert.equal(repeatLabel(rule({ unit: 'week', days: [1, 4] })), 'weekly on Mon, Thu');
  assert.equal(repeatLabel(rule({ unit: 'week', days: [1, 2, 3, 4, 5] })), 'every weekday');
  assert.ok(isValidRepeat({ every: 1, unit: 'week', days: [0, 6], from: 'done' }));
  assert.ok(!isValidRepeat({ every: 0, unit: 'day' }));
  assert.ok(!isValidRepeat({ every: 1, unit: 'month', days: [1] }));
  assert.ok(!isValidRepeat({ every: 1, unit: 'hour' }));
  assert.ok(!isValidRepeat({ every: 1, unit: 'day', extra: 1 }));
});

test('ticking a repeating task keeps it open, moves the due date and records the completion', () => {
  const now = '2026-10-16T18:00:00.000Z';
  const attrs = { id: 't1', checked: false, due: '2026-10-01', hideUntil: '2026-09-25', repeat: { every: 1, unit: 'month', day: 1, from: 'due' } };
  const after = patchedTaskAttrs(attrs, { checked: true }, now, { tz: TZ });
  assert.equal(after.checked, false);
  assert.equal(after.completedAt, undefined);
  assert.equal(after.due, '2026-11-01');
  assert.equal(after.hideUntil, undefined);
  assert.deepEqual(after.completions, [{ at: now, due: '2026-10-01', prev: { due: '2026-10-01', hideUntil: '2026-09-25' } }]);
  // ticked again: only the latest entry keeps what undo needs
  const again = patchedTaskAttrs(after, { checked: true }, '2026-10-20T18:00:00.000Z', { tz: TZ });
  assert.equal(again.due, '2026-12-01');
  assert.equal(again.completions[0].prev, undefined);
  // undo puts the last one back, once
  const undone = patchedTaskAttrs(again, { undoCompletion: true });
  assert.equal(undone.due, '2026-11-01');
  assert.equal(undone.completions.length, 1);
  assert.equal(patchedTaskAttrs(undone, { undoCompletion: true }), null);
  // a valid document
  assert.equal(validateDoc({ type: 'doc', content: [{ type: 'taskList', content: [{ type: 'taskItem', attrs: again, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Rent' }] }] }] }] }), null);
});

test('skip moves on without counting as done; an ordinary task cannot be skipped', () => {
  const attrs = { id: 't1', due: '2026-10-12', repeat: { every: 1, unit: 'week', from: 'due' } };
  const after = patchedTaskAttrs(attrs, { skip: true }, '2026-10-16T18:00:00.000Z');
  assert.equal(after.due, '2026-10-19');
  assert.equal(after.completions[0].skipped, true);
  assert.equal(patchedTaskAttrs({ id: 'x' }, { skip: true }), null);
});

test('a monthly rule set by hand remembers the day; the 31st survives February', () => {
  const set = patchedTaskAttrs({ id: 't', due: '2026-01-31' }, { repeat: { every: 1, unit: 'month', from: 'due' } });
  assert.deepEqual(set.repeat, { every: 1, unit: 'month', from: 'due', day: 31 });
  const feb = patchedTaskAttrs(set, { checked: true }, '2026-01-31T18:00:00.000Z');
  assert.equal(feb.due, '2026-02-28');
  const mar = patchedTaskAttrs(feb, { checked: true }, '2026-02-28T18:00:00.000Z');
  assert.equal(mar.due, '2026-03-31');
  // clearing it
  assert.equal(patchedTaskAttrs(mar, { repeat: null }).repeat, undefined);
  assert.equal(patchedTaskAttrs(mar, { repeat: { every: 0, unit: 'day' } }), null);
});

test('a rule typed in the words works through updateTask, and the typed due date counts', () => {
  const doc = { type: 'doc', content: [{ type: 'taskList', content: [{ type: 'taskItem', attrs: { id: 'a', checked: false }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Pay rent every month due oct 31' }] }] }] }] };
  const t = describeTask(doc.content[0].content[0], '2026-10-16');
  assert.equal(t.repeatFrom, 'text');
  assert.equal(t.due, '2026-10-31');
  const next = updateTask(doc, 'a', { checked: true }, { now: '2026-10-31T18:00:00.000Z', noteDate: '2026-10-16', tz: TZ });
  const a = next.content[0].content[0].attrs;
  assert.equal(a.checked, false);
  assert.equal(a.due, '2026-11-30');
  // the typed due's day (31) is the anchor through the history
  const dec = updateTask(next, 'a', { checked: true }, { now: '2026-11-30T18:00:00.000Z', noteDate: '2026-10-16', tz: TZ });
  assert.equal(dec.content[0].content[0].attrs.due, '2026-12-31');
  // without a rule a tick is an ordinary completion
  const plain = updateTask({ ...doc, content: [{ type: 'taskList', content: [{ type: 'taskItem', attrs: { id: 'b' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Once' }] }] }] }] }, 'b', { checked: true }, { now: '2026-10-16T18:00:00.000Z' });
  assert.equal(plain.content[0].content[0].attrs.checked, true);
});

test('the history is capped', () => {
  let attrs = { id: 't', due: '2026-01-01', repeat: { every: 1, unit: 'day', from: 'due' }, completions: Array.from({ length: MAX_COMPLETIONS }, (_, i) => ({ at: new Date(Date.UTC(2024, 0, 1) + i * 86400000).toISOString(), due: null })) };
  attrs = patchedTaskAttrs(attrs, { checked: true }, '2026-01-01T18:00:00.000Z');
  assert.equal(attrs.completions.length, MAX_COMPLETIONS);
  assert.equal(attrs.completions.at(-1).due, '2026-01-01');
});

test('the editor label says it repeats', () => {
  assert.equal(taskMetaLabel({ due: '2026-10-19', repeat: { every: 1, unit: 'week', from: 'due' } }), 'due Mon, Oct 19 · repeats weekly');
});
