import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wikiLinks, wikiHref } from '../../shared/wiki-links.js';
import { renderDoc } from '../../client/src/editor/render.js';

test('wiki link parser preserves aliases and paths, ignores broken and empty syntax', () => {
  assert.deepEqual(wikiLinks('[[Folder/Name|Alias]]').map(({ target, label }) => ({ target, label })), [{ target: 'Folder/Name', label: 'Alias' }]);
  assert.equal(wikiLinks('[[]] [[unfinished').length, 0);
  assert.equal(wikiHref('Name & other'), '#/link/Name%20%26%20other');
});
test('read-only links span formatting runs and escape all imported markup', () => {
  const html = renderDoc({ type: 'doc', content: [{ type: 'paragraph', content: [
    { type: 'text', text: '[[Ali' }, { type: 'text', text: 'na', marks: [{ type: 'bold' }] }, { type: 'text', text: ']] <img src=x onerror=alert(1)> [[<script>|hey]]' },
  ] }] });
  assert.equal((html.match(/href="#\/link\/Alina"/g) ?? []).length, 3);
  assert.ok(html.includes('<strong>'));
  assert.ok(!html.includes('<img'));
  assert.ok(!html.includes('<script>'));
});
