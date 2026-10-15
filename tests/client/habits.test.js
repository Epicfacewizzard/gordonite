import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scheduled, currentStreak, weekProgress, extendCourse, weekStart } from '../../shared/habits.js';

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
