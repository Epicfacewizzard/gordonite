import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dailyTagChoices, readTodayTagId, writeTodayTagId } from '../../client/src/today-selection.js';

test('Today choices include daily favorites and the selected current tag, with readable unique labels', () => {
  const tags = [
    { id: '1', path: 'school/daily', daily: true, favorite: true },
    { id: '2', path: 'work/daily', daily: true, favorite: true },
    { id: '3', path: 'private', daily: true, favorite: false },
    { id: '4', path: 'not-daily', daily: false, favorite: true },
  ];
  assert.deepEqual(dailyTagChoices(tags, 'private').map(({ id, label }) => [id, label]), [
    ['3', 'private'],
    ['1', 'daily · school/daily'],
    ['2', 'daily · work/daily'],
  ]);
  assert.deepEqual(dailyTagChoices(tags, 'school/daily').map((t) => t.id), ['1', '2']);
  assert.deepEqual(dailyTagChoices(tags, 'work/daily', 'private').map((t) => t.id), ['3', '1', '2'], 'the configured journal remains reachable after choosing a favourite');
});

test('Today preference is stored by tag ID and storage errors remain observable by the caller', () => {
  const values = new Map();
  const storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  assert.equal(readTodayTagId(storage), null);
  writeTodayTagId('stable-tag-id', storage);
  assert.equal(readTodayTagId(storage), 'stable-tag-id');
  assert.throws(() => writeTodayTagId('id', { setItem() { throw new Error('denied'); } }), /denied/);
});
