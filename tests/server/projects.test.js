// Projects and Waiting on (0.15.0, docs/PROJECTS.md): the project records, which notes and tasks are in a project, a
// task's person and waiting day, and that all of it survives export and import.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, save, para, docOf } from './helpers.js';
import { uuid } from '../../shared/ids.js';
import { validateDoc } from '../../shared/doc.js';
import { cleanProjectFields, projectOfTask, waitingDays, waitingLabel, isWaiting } from '../../shared/projects.js';
import { tagForName } from '../../server/projects.js';

let app;
before(async () => (app = await startServer({ HOME_TZ: 'America/Edmonton' })));
after(async () => app.close());

const taskItem = (text, attrs = {}) => ({ type: 'taskItem', attrs: { checked: false, id: uuid(), ...attrs }, content: [para(text)] });
const tasks = (...items) => ({ type: 'taskList', content: items });
const freeNote = async (title, tags, ...blocks) => {
  const id = uuid();
  const r = await app.api('PUT', `/api/notes/${id}`, { baseRevision: 0, kind: 'note', title, doc: docOf(...blocks), docFormat: 2, tags, date: '2026-10-05' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return id;
};
const create = async (body) => {
  const r = await app.api('POST', '/api/projects', body);
  assert.equal(r.status, 201, JSON.stringify(r.json));
  return r.json.project;
};

test('the rules: which project a task is in, how long it has waited, what a project may hold', () => {
  const projects = [
    { id: 'p-css-0001', name: 'CSS', tag: '20-css' },
    { id: 'p-chin-001', name: 'Chinatown', tag: '20-css/chinatown' },
    { id: 'p-own-0001', name: 'Own', tag: 'elsewhere' },
  ];
  assert.equal(projectOfTask({ tags: ['20-css/chinatown/food'] }, projects).id, 'p-chin-001', 'the most specific tag wins');
  assert.equal(projectOfTask({ tags: ['20-css/events'] }, projects).id, 'p-css-0001');
  assert.equal(projectOfTask({ tags: ['20-cssx'] }, projects), null, 'a tag that only starts the same is not under it');
  assert.equal(projectOfTask({ tags: ['20-css'], project: 'p-own-0001' }, projects).id, 'p-own-0001', "the task's own project wins");
  assert.equal(projectOfTask({ tags: ['20-css'], project: 'p-gone-001' }, projects).id, 'p-css-0001', 'a project that is gone falls back to the note');
  assert.equal(waitingDays('2026-10-01', '2026-10-16'), 15);
  assert.equal(waitingLabel('2026-10-16', '2026-10-16'), 'waiting since today');
  assert.equal(waitingLabel('2026-10-15', '2026-10-16'), 'waiting 1 day');
  assert.equal(isWaiting({ waitingSince: '2026-10-01', checked: true }), false, 'a finished task is not waiting');
  assert.throws(() => cleanProjectFields({ name: '', area: 'club' }), /name/);
  assert.throws(() => cleanProjectFields({ name: 'x', area: 'work' }), /area/);
  assert.throws(() => cleanProjectFields({ name: 'x', area: 'club', status: 'paused' }), /status/);
  assert.equal(tagForName('20-css', 'Snack Olympics!'), '20-css/snack-olympics');
  // the three task attributes are optional and checked
  const doc = (attrs) => docOf(tasks(taskItem('x', attrs)));
  assert.equal(validateDoc(doc({ project: 'p-css-0001', person: 'person-0001', waitingSince: '2026-10-01' })), null);
  assert.match(validateDoc(doc({ person: 'no' })), /person must be an id/);
  assert.match(validateDoc(doc({ waitingSince: 'friday' })), /waitingSince/);
});

test('a project made from an existing tag has its notes and tasks at once; a task can name its own project', async () => {
  const sarah = await freeNote('Sarah', ['05-people/css'], para('Venue contact'));
  const plan = await freeNote('Snack plan', ['20-css/snack'], tasks(taskItem('Book the venue', { person: sarah, waitingSince: '2026-10-10' }), taskItem('Buy cups'), taskItem('Old thing', { checked: true })));
  const sub = await freeNote('Snack budget', ['20-css/snack/budget'], para('numbers'));
  const other = uuid();
  const otherTaskId = uuid();
  await save(app, other, docOf(tasks(taskItem('Print snack posters', { id: otherTaskId }))), { tags: ['daily-jots'], date: '2026-10-06' });

  const p = await create({ name: 'Snack Olympics', area: 'club', tag: '20-css/snack' });
  assert.equal(p.tag, '20-css/snack');
  assert.equal(p.status, 'active');
  let list = (await app.api('GET', '/api/projects')).json;
  assert.equal(list.projects.find((x) => x.id === p.id).noteCount, 2, 'the tag and the tag under it');
  assert.deepEqual(list.areaFolders, { personal: '30-personal', school: '10-school', club: '20-css' });

  // a task in a daily jot joins the project by naming it
  const jot = (await app.api('GET', `/api/notes/${other}`)).json.note;
  jot.doc.content[0].content[0].attrs.project = p.id;
  assert.equal((await save(app, other, jot.doc, { base: jot.revision, tags: ['daily-jots'], date: '2026-10-06' })).status, 200);

  const d = (await app.api('GET', `/api/projects/${p.id}`)).json;
  assert.deepEqual(d.notes.map((n) => n.id).sort(), [plan, sub].sort());
  assert.deepEqual(d.tasks.open.map((t) => t.text).sort(), ['Buy cups', 'Print snack posters']);
  assert.deepEqual(d.tasks.waiting.map((t) => [t.text, t.person, t.waitingSince]), [['Book the venue', sarah, '2026-10-10']]);
  assert.equal(d.tasks.doneCount, 1);
  assert.deepEqual(d.people, [sarah]);

  // the task list carries the attributes; /api/waiting lists only open waiting tasks, filtered by person
  const row = (await app.api('GET', '/api/tasks')).json.tasks.find((t) => t.text === 'Book the venue');
  assert.equal(row.person, sarah);
  assert.equal(row.project, null);
  const waiting = (await app.api('GET', `/api/waiting?person=${sarah}`)).json.tasks;
  assert.deepEqual(waiting.map((t) => [t.text, t.projectId]), [['Book the venue', p.id]]);
  assert.equal((await app.api('GET', '/api/waiting?person=someone-else')).json.tasks.length, 0);

  // renaming the tag keeps the project (it is held by tag id)
  assert.equal((await app.api('POST', '/api/tags/move', { from: '20-css/snack', into: '20-css', name: 'snack-olympics' })).status, 200);
  const renamed = (await app.api('GET', `/api/projects/${p.id}`)).json;
  assert.equal(renamed.project.tag, '20-css/snack-olympics');
  assert.equal(renamed.notes.length, 2);
});

test('a new project without a tag gets one in its area folder; the folders can be changed', async () => {
  const a = await create({ name: 'Garden Plan', area: 'personal' });
  assert.equal(a.tag, '30-personal/garden-plan');
  assert.ok((await app.api('GET', '/api/tags')).json.tags.some((t) => t.path === '30-personal/garden-plan'));
  const r = await app.api('PUT', '/api/projects/folders', { school: 'uni/fall26' });
  assert.deepEqual(r.json.areaFolders, { personal: '30-personal', school: 'uni/fall26', club: '20-css' });
  assert.equal((await create({ name: 'NURS 301', area: 'school' })).tag, 'uni/fall26/nurs-301');
  assert.equal((await app.api('PUT', '/api/projects/folders', { club: '../x' })).status, 400);
  assert.equal((await app.api('POST', '/api/projects', { name: 'x', area: 'work' })).status, 400);
});

test('edit, add notes (a daily slot that is taken is reported), remove and bring back', async () => {
  const p = await create({ name: 'Lunar New Year', area: 'club', tag: '20-css/lny' });
  const free = await freeNote('Ideas', ['20-css/ideas'], para('dragon'));
  const day = uuid();
  await save(app, day, docOf(para('jot')), { tags: ['daily-jots'], date: '2026-10-07' });
  const holder = uuid();
  await save(app, holder, docOf(para('lny entry')), { tags: ['20-css/lny'], date: '2026-10-08' });
  const clash = uuid();
  await save(app, clash, docOf(para('another jot')), { tags: ['daily-jots'], date: '2026-10-08' });

  const added = (await app.api('POST', `/api/projects/${p.id}/notes`, { noteIds: [free, day, holder, clash, 'missing-note-1'] })).json;
  assert.deepEqual(added.added.sort(), [day, free].sort());
  assert.deepEqual(added.already, [holder]);
  assert.deepEqual(added.failed.map((f) => f.noteId), [clash, 'missing-note-1']);
  assert.match(added.failed[0].message, /already has a note/);

  const edited = (await app.api('PUT', `/api/projects/${p.id}`, { status: 'done', overviewNoteId: free })).json.project;
  assert.equal(edited.status, 'done');
  assert.equal(edited.overviewNoteId, free);
  assert.equal(edited.name, 'Lunar New Year', 'fields left out stay');
  assert.equal((await app.api('PUT', `/api/projects/${p.id}`, { status: 'paused' })).status, 400);

  await app.api('DELETE', `/api/projects/${p.id}`);
  assert.ok(!(await app.api('GET', '/api/projects')).json.projects.some((x) => x.id === p.id));
  assert.ok((await app.api('GET', '/api/projects?removed=1')).json.projects.some((x) => x.id === p.id));
  assert.equal((await app.api('PUT', `/api/projects/${p.id}`, { name: 'x' })).status, 409);
  await app.api('POST', `/api/projects/${p.id}/restore`);
  assert.ok((await app.api('GET', '/api/projects')).json.projects.some((x) => x.id === p.id));
});

test('projects and the task attributes survive a JSON export and a replace or merge import', async () => {
  const p = await create({ name: 'Export me', area: 'school', tag: '10-school/exportable' });
  const person = await freeNote('Prof', ['05-people'], para('office hours'));
  await freeNote('Essay', ['10-school/exportable'], tasks(taskItem('Ask for extension', { person, waitingSince: '2026-10-02', project: p.id })));
  const exported = (await app.api('GET', '/api/export/json')).json;
  assert.ok(exported.projects.some((x) => x.id === p.id && x.area === 'school'));

  const b = await startServer({ HOME_TZ: 'America/Edmonton' });
  try {
    // merge into a server that already has a tag of that name: the project follows the local tag
    await b.api('POST', '/api/tags', { path: '10-school/exportable' });
    const merged = (await b.api('POST', '/api/import?mode=merge', exported)).json;
    assert.ok(merged.projectsAdded >= 1);
    const there = (await b.api('GET', `/api/projects/${p.id}`)).json;
    assert.equal(there.project.tag, '10-school/exportable');
    assert.deepEqual(there.tasks.waiting.map((t) => [t.text, t.person, t.waitingSince]), [['Ask for extension', person, '2026-10-02']]);
    const again = (await b.api('POST', '/api/import?mode=merge', exported)).json;
    assert.equal(again.projectsAdded, 0, 'merge never adds a project twice');
    const replaced = (await b.api('POST', '/api/import?mode=replace', exported)).json;
    assert.ok(replaced.projectsAdded >= 1);
    assert.equal((await b.api('GET', `/api/projects/${p.id}`)).json.project.tag, '10-school/exportable');
  } finally {
    await b.close();
  }
});
