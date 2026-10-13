import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendUnique } from '../../client/src/paging.js';

test('appendUnique adds what is new, in order, and skips what is already there', () => {
  const list = [{ id: 'a' }, { id: 'b' }];
  assert.deepEqual(appendUnique(list, [{ id: 'b' }, { id: 'c' }, { id: 'd' }]).map((x) => x.id), ['a', 'b', 'c', 'd']);
});

test('a page that is entirely already there returns the same list', () => {
  const list = [{ id: 'a' }, { id: 'b' }];
  assert.equal(appendUnique(list, [{ id: 'a' }, { id: 'b' }]), list);
});

test('the same id twice in one page is added once; ids can be plain strings', () => {
  assert.deepEqual(appendUnique(['a'], ['b', 'b', 'a', 'c'], (x) => x), ['a', 'b', 'c']);
});
