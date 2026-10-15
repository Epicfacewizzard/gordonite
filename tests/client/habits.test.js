import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HABIT_KEY, HabitStore, scheduled, currentStreak, weekProgress, validateHabits, weekStart } from '../../client/src/habit-data.js';

const today = '2026-10-14';
const habit = { id: 'read', name: 'Read', detail: '', created: '2026-10-05', days: [1, 2, 3, 4, 5], checks: ['2026-10-08', '2026-10-09', '2026-10-12', '2026-10-13'] };
function memory(initial) {
  let raw = initial === undefined ? null : JSON.stringify(initial);
  return { getItem: () => raw, setItem: (_, value) => { raw = value; } };
}
test('scheduled-day streaks skip weekends and allow unfinished today', () => {
  assert.equal(currentStreak(habit, today), 4);
  assert.equal(currentStreak({ ...habit, checks: [...habit.checks, today] }, today), 5);
  assert.equal(currentStreak({ ...habit, checks: ['2026-10-12'] }, today), 0);
  assert.equal(scheduled(habit, '2026-10-10'), false);
  assert.equal(scheduled(habit, '2026-10-02'), false);
});
test('week totals exclude future, unscheduled and pre-creation days', () => {
  assert.equal(weekStart('2026-10-18'), '2026-10-12');
  assert.deepEqual(weekProgress([habit], today), { done: 2, total: 3 });
  assert.deepEqual(weekProgress([{ ...habit, created: today }], today), { done: 0, total: 1 });
});
test('a check-in persists, undoes, and refuses future or unscheduled days', () => {
  const storage = memory({ format: 1, habits: [habit] });
  const store = new HabitStore(storage);
  store.toggle('read', today, today);
  assert.equal(new HabitStore(storage).read(today).habits[0].checks.includes(today), true);
  store.toggle('read', today, today);
  for (const date of ['2026-10-15', '2026-10-10', '2026-10-02']) store.toggle('read', date, today);
  assert.deepEqual(store.read(today).habits[0].checks, habit.checks);
});
test('independent tabs read the latest saved data before changing it', () => {
  const storage = memory({ format: 1, habits: [habit] });
  const a = new HabitStore(storage), b = new HabitStore(storage);
  a.read(today); b.read(today);
  a.toggle('read', today, today); b.toggle('read', '2026-10-07', today);
  const checks = new HabitStore(storage).read(today).habits[0].checks;
  assert.ok(checks.includes(today) && checks.includes('2026-10-07'));
});
test('unreadable storage is preserved and changes remain exportable in memory', () => {
  let writes = 0;
  const store = new HabitStore({ getItem: () => 'broken JSON', setItem: () => writes++ });
  assert.deepEqual(store.read(today).habits, []);
  store.change(today, () => ({ format: 1, habits: [habit] }));
  assert.equal(writes, 0);
  assert.match(store.error, /not been overwritten/);
  assert.equal(store.read(today).habits.length, 1);
});
test('failed storage writes keep the edited state and report the failure', () => {
  const store = new HabitStore({ getItem: () => JSON.stringify({ format: 1, habits: [habit] }), setItem: () => { throw Error('quota'); } });
  store.toggle('read', today, today);
  assert.equal(store.read(today).habits[0].checks.includes(today), true);
  assert.match(store.error, /could not be saved/);
  store.externalChange();
  assert.equal(store.read(today).habits[0].checks.includes(today), true);
});
test('backup validation refuses duplicate ids, impossible dates and empty schedules', () => {
  for (const habits of [[habit, habit], [{ ...habit, checks: ['2026-02-30'] }], [{ ...habit, days: [] }], [{ ...habit, checks: ['2026-10-15'] }]]) {
    assert.throws(() => validateHabits({ format: 1, habits }, today));
  }
  assert.equal(validateHabits({ format: 1, habits: [habit] }, today).habits.length, 1);
  assert.equal(HABIT_KEY, 'gordonite-habits-preview-v1');
});
