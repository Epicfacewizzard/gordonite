import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, para, docOf, task } from './helpers.js';
import { uuid } from '../../shared/ids.js';
import { linksInDoc, rewriteLinks, linkableTitle } from '../../shared/wiki-links.js';

let app;
before(async () => (app = await startServer({ HOME_TZ: 'America/Edmonton' })));
after(async () => app.close());

const note = async (title, tags, date, ...blocks) => {
  const id = uuid();
  const r = await app.api('PUT', `/api/notes/${id}`, { baseRevision: 0, kind: 'note', title, doc: docOf(...blocks), docFormat: 2, tags, date });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return id;
};
const read = async (id) => (await app.api('GET', `/api/notes/${id}`)).json.note;
const backlinks = async (id) => (await app.api('GET', `/api/notes/${id}/backlinks`)).json;
const rename = async (id, title) => {
  const n = await read(id);
  const r = await app.api('PUT', `/api/notes/${id}`, { baseRevision: n.revision, doc: n.doc, docFormat: 2, title });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return r.json;
};
const textOf = (n) => JSON.stringify(n.doc);

test('links in a document: the line each sits on, any heading, label or folder, never across a line break', () => {
  const doc = docOf(
    para('Coffee with [[Sam]] and [[05 People/Ana.md#Log|Ana]]'),
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'About [[Plan]]' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'first [[' }, { type: 'hardBreak' }, { type: 'text', text: 'x]] second [[Plan|the plan]]' }] },
    { type: 'taskList', content: [task('Ask [[Sam]] about it')] },
  );
  assert.deepEqual(linksInDoc(doc).map((l) => [l.title, l.line]), [
    ['Sam', 'Coffee with [[Sam]] and [[05 People/Ana.md#Log|Ana]]'],
    ['Ana', 'Coffee with [[Sam]] and [[05 People/Ana.md#Log|Ana]]'],
    ['Plan', 'About [[Plan]]'],
    ['Plan', 'x]] second [[Plan|the plan]]'],
    ['Sam', 'Ask [[Sam]] about it'],
  ]);
  const re = rewriteLinks(doc, 'ana', 'Ana B');
  assert.match(JSON.stringify(re), /\[\[Ana B#Log\|Ana\]\]/, 'the heading and label stay; the folder goes');
  assert.equal(JSON.stringify(doc).includes('Ana B'), false, 'the original is not changed');
  assert.equal(rewriteLinks(doc, 'Nobody', 'X'), null);
  const split = docOf({ type: 'paragraph', content: [{ type: 'text', text: '[[Sa' }, { type: 'text', text: 'm]]', marks: [{ type: 'bold' }] }] });
  assert.equal(rewriteLinks(split, 'Sam', 'Samuel'), null, 'a name split across formatting is left alone');
  assert.equal(linkableTitle('A/B'), false);
  assert.equal(linkableTitle('Fall [plan]'), false);
  assert.equal(linkableTitle('Sam Lee'), true);
});

test('Linked from: newest first, with the lines and tags, without itself or trashed notes', async () => {
  const target = await note('Budget 2026', ['projects'], '2026-10-01', para('the budget'));
  const a = await note('Meeting', ['school'], '2026-10-03', para('Discussed [[budget 2026]] today'), para('and [[Budget 2026|it]] again'));
  const b = await note('Older', [], '2026-09-20', para('See [[Budget 2026]]'));
  const self = await app.api('PUT', `/api/notes/${target}`, { baseRevision: 1, doc: docOf(para('see [[Budget 2026]]')), docFormat: 2 });
  assert.equal(self.status, 200);
  const gone = await note('Gone', [], '2026-10-05', para('[[Budget 2026]]'));
  await app.api('DELETE', `/api/notes/${gone}`);
  await note('Unrelated', [], '2026-10-05', para('[[Budget 2025]]'));

  const r = await backlinks(target);
  assert.equal(r.title, 'Budget 2026');
  assert.deepEqual(r.backlinks.map((x) => x.id), [a, b]);
  assert.deepEqual(r.backlinks[0].lines, ['Discussed [[budget 2026]] today', 'and [[Budget 2026|it]] again']);
  assert.equal(r.backlinks[0].count, 2);
  assert.deepEqual(r.backlinks[0].tags, ['school']);

  // Follows edits without being told: the index checks each note's revision.
  const older = await read(b);
  await app.api('PUT', `/api/notes/${b}`, { baseRevision: older.revision, doc: docOf(para('no link now')), docFormat: 2 });
  assert.deepEqual((await backlinks(target)).backlinks.map((x) => x.id), [a]);
  assert.equal((await app.api('GET', `/api/notes/${uuid()}/backlinks`)).status, 404);
});

test('a person is mentioned by name or by an "Also called" name, unless a note has that name', async () => {
  const sam = await note('Samantha Lee', ['05-people/css'], '2026-10-01', para('VP events'));
  const saved = await app.api('PUT', `/api/people/${sam}`, { profile: { aliases: ['Sammy', 'Plan'] } });
  assert.equal(saved.status, 200, JSON.stringify(saved.json));
  await note('Plan', [], '2026-10-02', para('a plan')); // "Plan" is a note's name, so [[Plan]] opens that note
  const by = await note('Lunch', [], '2026-10-04', para('Lunch with [[Sammy]]'));
  const by2 = await note('Call', [], '2026-10-03', para('Called [[Samantha Lee]]'), para('[[Plan]]'));

  assert.deepEqual((await backlinks(sam)).backlinks.map((x) => x.id), [by, by2]);
  const resolved = (await app.api('GET', '/api/note-links?target=sammy')).json.notes;
  assert.deepEqual(resolved.map((n) => [n.id, n.alias]), [[sam, 'sammy']]);
  assert.equal((await app.api('GET', '/api/note-links?target=Plan')).json.notes[0].title, 'Plan');

  const names = (await app.api('GET', '/api/note-names')).json;
  assert.equal(names.notes.find((n) => n.id === sam).person, true);
  assert.equal(names.notes.find((n) => n.title === 'Lunch').person, false);
  assert.deepEqual(names.aliases.filter((a) => a.id === sam).map((a) => a.name), ['Sammy', 'Plan']);
});

test('renaming a note rewrites the links to it through the save path, with the old text in History', async () => {
  const target = await note('Trip ideas', [], '2026-10-01', para('ideas'));
  const linking = await note('Weekend', ['home'], '2026-10-02', para('Read [[Trip ideas]] and [[trip ideas#Food|food]]'));
  const other = await note('Other', [], '2026-10-02', para('nothing linked, just Trip ideas in words'));
  const before = await read(linking);

  const res = await rename(target, 'Trip plan');
  assert.deepEqual(res.relinked, [linking]);
  const after = await read(linking);
  assert.equal(after.revision, before.revision + 1);
  assert.match(textOf(after), /Read \[\[Trip plan\]\] and \[\[Trip plan#Food\|food\]\]/);
  assert.equal((await read(other)).revision, 1, 'a note that only mentions the words is untouched');
  const versions = (await app.api('GET', `/api/notes/${linking}/versions`)).json.versions;
  assert.equal(versions[0].kind, 'link');
  assert.match(versions[0].preview, /\[\[Trip ideas\]\]/);
  assert.deepEqual((await backlinks(target)).backlinks.map((x) => x.id), [linking]);

  // An editor still holding the old revision gets a conflict, never an overwrite.
  const stale = await app.api('PUT', `/api/notes/${linking}`, { baseRevision: before.revision, doc: docOf(para('typed elsewhere')), docFormat: 2 });
  assert.equal(stale.status, 409);
  assert.match(textOf(await read(linking)), /Trip plan/);
});

test('a rename leaves links alone when another note has the old name or the new name cannot be a link', async () => {
  const one = await note('Notes', [], '2026-10-01', para('one'));
  await note('notes', ['x'], '2026-10-02', para('two'));
  const linking = await note('Index', [], '2026-10-03', para('[[Notes]]'));
  const res = await rename(one, 'Notes A');
  assert.equal(res.relinked, undefined);
  assert.equal((await read(linking)).revision, 1);

  const solo = await note('Reading list', [], '2026-10-01', para('books'));
  const l2 = await note('Shelf', [], '2026-10-03', para('[[Reading list]]'));
  assert.equal((await rename(solo, 'Reading / 2026')).relinked, undefined, 'a "/" would make the link name something else');
  assert.equal((await rename(solo, null)).relinked, undefined, 'removing the name rewrites nothing');
  assert.equal((await read(l2)).revision, 1);
});
