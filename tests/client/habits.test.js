import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scheduled, currentStreak, bestStreak, habitScore, weekProgress, extendCourse, weekStart, dueToday, periodOf, periodProgress, met, frequencyLabel, targetLabel } from '../../shared/habits.js';

const daily = { id: 'h', days: [0, 1, 2, 3, 4, 5, 6], created: '2026-10-01', trigger: null };
const doneOn = (dates) => (id, date) => dates.includes(date);

test('streaks count due days in a row; rest days are skipped; an unfinished today does not break it', () => {
  const weekdays = { ...daily, days: [1, 2, 3, 4, 5] }; // 2026-10-10 and 11 are a Saturday and Sunday
  assert.equal(currentStreak(weekdays, '2026-10-13', doneOn(['2026-10-08', '2026-10-09', '2026-10-12'])), 3);
  assert.equal(currentStreak(daily, '2026-10-13', doneOn(['2026-10-11', '2026-10-12'])), 2);
  assert.equal(currentStreak(daily, '2026-10-13', doneOn(['2026-10-11', '2026-10-13'])), 1);
});

test('a course habit is due only while a course runs', () => {
  const course = { ...daily, trigger: { product: 'Betaderm', days: 3 }, courses: [{ from: '2026-10-05', to: '2026-10-07' }] };
  assert.equal(scheduled(course, '2026-10-04'), false);
  assert.equal(scheduled(course, '2026-10-06'), true);
  assert.equal(scheduled(course, '2026-10-08'), false);
  assert.equal(currentStreak(course, '2026-10-07', doneOn(['2026-10-05', '2026-10-06', '2026-10-07'])), 3);
});

test('a course starts on the day used, is extended when used again during or right after it, and is never shortened', () => {
  const h = { ...daily, trigger: { product: 'Betaderm', days: 7 }, courses: [] };
  let c = extendCourse(h, '2026-10-01');
  assert.deepEqual(c, [{ from: '2026-10-01', to: '2026-10-07' }]);
  c = extendCourse({ ...h, courses: c }, '2026-10-05');
  assert.deepEqual(c, [{ from: '2026-10-01', to: '2026-10-11' }]);
  c = extendCourse({ ...h, courses: c }, '2026-10-02');
  assert.deepEqual(c, [{ from: '2026-10-01', to: '2026-10-11' }], 'an earlier use does not shorten it');
  c = extendCourse({ ...h, courses: c }, '2026-10-20');
  assert.deepEqual(c, [{ from: '2026-10-01', to: '2026-10-11' }, { from: '2026-10-20', to: '2026-10-26' }], 'a gap starts a new course');
});

test('the week so far counts only due days up to today', () => {
  assert.equal(weekStart('2026-10-15'), '2026-10-12');
  assert.deepEqual(weekProgress([daily], '2026-10-14', doneOn(['2026-10-12', '2026-10-14'])), { done: 2, total: 3 });
});

const entries = (map) => (id, date) => map[date] ?? null; // { date: true | { value, skip } }

test('a habit done 3 times a week: due until the week has 3, a streak counts whole weeks, skips stand in for a time', () => {
  const h = { ...daily, created: '2026-09-28', freq: { type: 'week', times: 3 } }; // 2026-09-28 and 10-05 are Mondays
  assert.equal(frequencyLabel(h), '3 times a week');
  assert.deepEqual(periodOf(h, '2026-10-08'), { from: '2026-10-05', to: '2026-10-11' });
  const e = entries({ '2026-09-29': true, '2026-09-30': true, '2026-10-02': true, '2026-10-05': true, '2026-10-06': { value: null, skip: true }, '2026-10-07': true });
  assert.equal(periodProgress(h, '2026-10-07', e).complete, true);
  assert.equal(dueToday(h, '2026-10-08', e), false, 'done for the week');
  assert.equal(dueToday(h, '2026-10-07', e), true, 'still listed on a day it was ticked');
  assert.equal(currentStreak(h, '2026-10-08', e), 2);
  assert.equal(currentStreak(h, '2026-10-13', e), 2, 'an unfinished week does not break it');
  assert.equal(currentStreak(h, '2026-10-20', e), 0, 'a missed week does');
  assert.equal(bestStreak(h, '2026-10-20', e), 2);
});

test('a habit every 3 days and one a month', () => {
  const h = { ...daily, freq: { type: 'every', n: 3 } };
  assert.deepEqual(periodOf(h, '2026-10-05'), { from: '2026-10-04', to: '2026-10-06' });
  const e = entries({ '2026-10-02': true, '2026-10-04': true });
  assert.equal(currentStreak(h, '2026-10-07', e), 2);
  assert.equal(dueToday(h, '2026-10-05', e), false);
  const m = { ...daily, freq: { type: 'month', times: 2 } };
  assert.deepEqual(periodOf(m, '2026-02-10'), { from: '2026-02-01', to: '2026-02-28' });
  assert.equal(frequencyLabel(m), '2 times a month');
});

test('a number habit is met when the number reaches the target, or stays under it', () => {
  const water = { ...daily, kind: 'number', unit: 'glasses', target: 8, targetType: 'atLeast' };
  assert.equal(targetLabel(water), 'at least 8 glasses');
  assert.equal(met(water, { value: 8, skip: false }), true);
  assert.equal(met(water, { value: 5, skip: false }), false);
  const coffee = { ...water, unit: 'cups', target: 2, targetType: 'atMost' };
  assert.equal(met(coffee, { value: 1, skip: false }), true);
  assert.equal(met(coffee, { value: 3, skip: false }), false);
  assert.equal(currentStreak(water, '2026-10-03', entries({ '2026-10-01': { value: 9 }, '2026-10-02': { value: 8 }, '2026-10-03': { value: 2 } })), 2);
});

test('a skipped day neither breaks nor adds to a streak, and an archived habit is never due', () => {
  const e = entries({ '2026-10-10': true, '2026-10-11': { value: null, skip: true }, '2026-10-12': true });
  assert.equal(currentStreak(daily, '2026-10-12', e), 2);
  assert.equal(dueToday({ ...daily, archived: true }, '2026-10-12', e), false);
});

test('the score rises with each done day, falls slowly with a missed one, and stays between 0 and 1', () => {
  const all = {};
  for (let i = 1; i <= 28; i++) all[`2026-10-${String(i).padStart(2, '0')}`] = true;
  const strong = habitScore(daily, '2026-10-28', entries(all));
  assert.ok(strong > 0.45 && strong < 1, String(strong));
  const after = habitScore(daily, '2026-10-29', entries(all));
  assert.equal(after, strong, 'an unfinished today changes nothing');
  const missed = habitScore(daily, '2026-10-30', entries(all));
  assert.ok(missed < strong && missed > strong * 0.9, 'one missed day costs a little');
  assert.equal(habitScore(daily, '2026-10-05', entries({})), 0);
});
