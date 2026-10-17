// The Projects and Waiting on tools of the MCP bridge (0.15.0), called the way an agent calls them: through the stdio
// bridge and the assistant door.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { startServer } from './helpers.js';

const token = 'test-only-assistant-key-123456789';
let app, c, today;

before(async () => {
  app = await startServer({ ASSISTANT_TOKEN: token, HOME_TZ: 'America/Edmonton' });
  c = new Client({ name: 'test', version: '1' });
  await c.connect(new StdioClientTransport({ command: process.execPath, args: [path.resolve('mcp/server.js')], env: { ...process.env, GORDONITE_URL: app.url, GORDONITE_TOKEN: token }, stderr: 'pipe' }));
  today = (await call('ping')).today;
});
after(async () => {
  await c?.close();
  await app?.close();
});

async function call(name, args = {}) {
  const r = await c.callTool({ name, arguments: args });
  assert.ok(!r.isError, `${name}: ${JSON.stringify(r.content)}`);
  return JSON.parse(r.content[0].text);
}
async function refused(name, args, pattern) {
  const r = await c.callTool({ name, arguments: args });
  assert.equal(r.isError, true, `${name} should be refused`);
  if (pattern) assert.match(r.content[0].text, pattern);
}

test('an agent makes a project, puts notes in it, links a person and sets and clears waiting', async () => {
  const sarah = (await call('create_note', { title: 'Sarah', markdown: 'Venue contact', tags: ['05-people/css'] })).id;
  const plan = await call('create_note', { title: 'Snack plan', markdown: '- [ ] Book the venue\n- [ ] Buy cups' });
  const notPerson = (await call('create_note', { title: 'Not a person', markdown: 'x' })).id;

  const { project } = await call('create_project', { name: 'Snack Olympics', area: 'club' });
  assert.equal(project.tag, '20-css/snack-olympics');
  assert.equal((await call('list_projects')).projects.find((p) => p.id === project.id).noteCount, 0);

  const added = await call('add_notes_to_project', { projectId: project.id, noteIds: [plan.id] });
  assert.deepEqual(added.added, [plan.id]);
  const venue = (await call('get_note', { noteId: plan.id })).tasks.find((t) => t.text === 'Book the venue');

  await refused('update_task', { noteId: plan.id, taskId: venue.id, waiting: true }, /Waiting needs a person/);
  await refused('update_task', { noteId: plan.id, taskId: venue.id, person: notPerson }, /No such person/);
  await refused('update_task', { noteId: plan.id, taskId: venue.id, project: 'no-such-project' }, /No such project/);
  await call('update_task', { noteId: plan.id, taskId: venue.id, person: sarah, waiting: true });

  let task = (await call('get_note', { noteId: plan.id })).tasks.find((t) => t.id === venue.id);
  assert.equal(task.person, sarah);
  assert.equal(task.waitingSince, today);
  assert.deepEqual((await call('list_waiting', { person: sarah })).tasks.map((t) => [t.text, t.projectId]), [['Book the venue', project.id]]);
  assert.deepEqual((await call('list_waiting', { projectId: project.id })).tasks.length, 1);
  const person = await call('get_person', { noteId: sarah });
  assert.deepEqual(person.tasks.map((t) => t.text), ['Book the venue']);
  const details = await call('get_project', { projectId: project.id });
  assert.deepEqual(details.tasks.waiting.map((t) => t.text), ['Book the venue']);
  assert.deepEqual(details.tasks.open.map((t) => t.text), ['Buy cups']);
  assert.deepEqual(details.people, [sarah]);

  // a waiting day in the past, then the reply: waiting stops, the person stays
  await call('update_task', { noteId: plan.id, taskId: venue.id, waitingSince: '2026-10-01' });
  assert.equal((await call('get_note', { noteId: plan.id })).tasks.find((t) => t.id === venue.id).waitingSince, '2026-10-01');
  await call('update_task', { noteId: plan.id, taskId: venue.id, waiting: false });
  task = (await call('get_note', { noteId: plan.id })).tasks.find((t) => t.id === venue.id);
  assert.equal(task.waitingSince, null);
  assert.equal(task.person, sarah);
  assert.equal((await call('list_waiting')).tasks.length, 0);
  // taking the person off also stops waiting
  await call('update_task', { noteId: plan.id, taskId: venue.id, waiting: true });
  await call('update_task', { noteId: plan.id, taskId: venue.id, person: null });
  task = (await call('get_note', { noteId: plan.id })).tasks.find((t) => t.id === venue.id);
  assert.deepEqual([task.person, task.waitingSince], [null, null]);

  // a task elsewhere joins the project by naming it; null puts it back
  const jot = await call('append_daily', { markdown: '- [ ] Print posters' });
  const posters = (await call('get_note', { noteId: jot.id })).tasks[0];
  await call('update_task', { noteId: jot.id, taskId: posters.id, project: project.id });
  assert.ok((await call('get_project', { projectId: project.id })).tasks.open.some((t) => t.text === 'Print posters'));
  await call('update_task', { noteId: jot.id, taskId: posters.id, project: null });
  assert.ok(!(await call('get_project', { projectId: project.id })).tasks.open.some((t) => t.text === 'Print posters'));
});

test('update_project changes fields, removes and brings back; an existing tag makes a project with its notes', async () => {
  await call('create_note', { title: 'Hub', markdown: 'plans', tags: ['20-css/chinatown'] });
  const { project } = await call('create_project', { name: 'Chinatown Hub', area: 'club', tag: '20-css/chinatown' });
  assert.equal((await call('list_projects')).projects.find((p) => p.id === project.id).noteCount, 1);
  const done = await call('update_project', { projectId: project.id, status: 'done', name: 'Chinatown Hub 2027' });
  assert.deepEqual([done.project.status, done.project.name], ['done', 'Chinatown Hub 2027']);
  await call('update_project', { projectId: project.id, removed: true });
  assert.ok(!(await call('list_projects')).projects.some((p) => p.id === project.id));
  assert.ok((await call('list_projects', { removed: true })).projects.some((p) => p.id === project.id));
  await call('update_project', { projectId: project.id, removed: false });
  assert.ok((await call('list_projects')).projects.some((p) => p.id === project.id));
  await refused('create_project', { name: 'x', area: 'club', tag: '../bad' }, /Tag names/);
});
