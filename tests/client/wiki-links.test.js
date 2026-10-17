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
test('"[[" suggestions: names starting with what is typed first, people by their other names too', async () => {
  const { suggestLinks } = await import('../../client/src/editor/link-suggest.js');
  const data = {
    notes: [
      { id: '1', title: 'Budget 2026', person: false },
      { id: '2', title: 'Samantha Lee', person: true },
      { id: '3', title: 'Old budget', person: false },
      { id: '4', title: 'A/B tests', person: false },
    ],
    aliases: [{ id: '2', name: 'Sammy', title: 'Samantha Lee' }],
  };
  assert.deepEqual(suggestLinks(data, 'bud').map((s) => s.insert), ['Budget 2026', 'Old budget']);
  assert.deepEqual(suggestLinks(data, 'sam').map((s) => s.insert), ['Samantha Lee', 'Samantha Lee|Sammy']);
  assert.deepEqual(suggestLinks(data, '').map((s) => s.title), ['Budget 2026', 'Samantha Lee', 'Old budget'], 'nothing typed: recent notes, no other names, nothing a link cannot name');
});
