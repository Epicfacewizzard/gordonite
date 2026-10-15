import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, save, para, docOf } from './helpers.js';
import { uuid } from '../../shared/ids.js';
import { frontMatter, profileFromFrontMatter } from '../../scripts/people-from-vault.js';

let app;
before(async () => (app = await startServer({ HOME_TZ: 'America/Edmonton' })));
after(async () => app.close());

const person = async (title, tags, ...lines) => {
  const id = uuid();
  const r = await app.api('PUT', `/api/notes/${id}`, { baseRevision: 0, kind: 'note', title, doc: docOf(...lines), docFormat: 1, tags, date: '2026-10-05' });
  assert.equal(r.status, 200);
  return id;
};

test('people are the notes tagged 05-people, each with details that start empty and are saved by note id', async () => {
  const maya = await person('Maya', ['05-people/css'], { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Notes' }] }, para('Runs events'));
  const ben = await person('Ben', ['05-people'], para('Met at the fair'));
  await save(app, uuid(), docOf(para('not a person')), { tags: ['school'] });

  let list = (await app.api('GET', '/api/people')).json.people;
  assert.deepEqual(list.map((p) => p.title), ['Ben', 'Maya']);
  const m = list.find((p) => p.noteId === maya);
  assert.deepEqual(m.tags, ['05-people/css']);
  assert.equal(m.preview, 'Runs events', 'the card line skips headings');
  assert.match(m.text, /Runs events/);
  assert.equal(m.profile.role, '');
  assert.equal(m.profileUpdatedAt, null);

  const saved = await app.api('PUT', `/api/people/${maya}`, { profile: { role: 'VP Events', birthday: '2004-10-21', lastTalked: '2026-10-14', remember: ['likes matcha'] } });
  assert.equal(saved.status, 200);
  assert.equal(saved.json.profile.role, 'VP Events');
  await app.api('PUT', `/api/people/${maya}`, { profile: { role: 'VP Events and Outreach' } });
  list = (await app.api('GET', '/api/people')).json.people;
  const again = list.find((p) => p.noteId === maya).profile;
  assert.equal(again.role, 'VP Events and Outreach');
  assert.equal(again.birthday, '', 'saving replaces the whole record');
  assert.equal((await app.api('GET', `/api/people/${ben}`)).json.profile.role, '');

  // trashed people leave the list; their details stay for when they come back
  await app.api('DELETE', `/api/notes/${maya}`);
  assert.deepEqual((await app.api('GET', '/api/people')).json.people.map((p) => p.title), ['Ben']);
  await app.api('POST', `/api/notes/${maya}/restore`);
  assert.equal((await app.api('GET', '/api/people')).json.people.find((p) => p.noteId === maya).profile.role, 'VP Events and Outreach');
});

test('what was last talked about is read from the Log in the note; last talked is the later of it and the detail', async () => {
  const log = (...lines) => ({ type: 'bulletList', content: lines.map((t) => ({ type: 'listItem', content: [para(t)] })) });
  const id = await person('Lena', ['05-people/css'], para('Notes'), { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Log' }] }, log('Oct 14, 2026 · Coffee: Booth plans', '2026-09-28: Reached out'));
  let p = (await app.api('GET', '/api/people')).json.people.find((x) => x.noteId === id);
  assert.deepEqual(p.lastChat, { date: '2026-10-14', how: 'Coffee', text: 'Booth plans' });
  assert.equal(p.lastTalked, '2026-10-14');
  await app.api('PUT', `/api/people/${id}`, { profile: { lastTalked: '2026-10-15' } });
  p = (await app.api('GET', '/api/people')).json.people.find((x) => x.noteId === id);
  assert.equal(p.lastTalked, '2026-10-15', 'a later "talked today" with nothing written wins');
  const none = (await app.api('GET', '/api/people')).json.people.find((x) => x.title === 'Ben');
  assert.equal(none.lastChat, null);
});

test('details can be saved before the note reaches the server (written offline), and bad ones are refused plainly', async () => {
  const later = uuid();
  assert.equal((await app.api('PUT', `/api/people/${later}`, { profile: { closeness: 'close' } })).status, 200);
  await person('Later', ['05-people/friends'], para('hi'));
  const bad = await app.api('PUT', `/api/people/${uuid()}`, { profile: { birthday: '02-30' } });
  assert.equal(bad.status, 400);
  assert.equal(bad.json.error.code, 'bad_profile');
  assert.match(bad.json.error.message, /birthday/);
  assert.equal((await app.api('PUT', `/api/people/${uuid()}`, {})).status, 400);
});

test('details travel in the JSON export; a merge import adds missing ones and never replaces existing ones', async () => {
  const t = await startServer({ HOME_TZ: 'America/Edmonton' });
  try {
    const id = uuid();
    await t.api('PUT', `/api/notes/${id}`, { baseRevision: 0, kind: 'note', title: 'Ava', doc: docOf(para('x')), docFormat: 1, tags: ['05-people'], date: '2026-10-05' });
    await t.api('PUT', `/api/people/${id}`, { profile: { role: 'Here first' } });
    const exported = (await t.api('GET', '/api/export/json')).json;
    assert.equal(exported.people.length, 1);
    assert.equal(exported.people[0].profile.role, 'Here first');

    const other = uuid();
    const fill = { format: 'hq-export', formatVersion: 1, exportedAt: new Date().toISOString(), tags: [], notes: [], people: [{ noteId: id, profile: { role: 'From the vault' } }, { noteId: other, profile: { birthday: '03-14' } }] };
    const merged = await t.api('POST', '/api/import?mode=merge', fill);
    assert.equal(merged.status, 200);
    assert.equal(merged.json.peopleAdded, 1);
    assert.equal((await t.api('GET', `/api/people/${id}`)).json.profile.role, 'Here first');
    assert.equal((await t.api('GET', `/api/people/${other}`)).json.profile.birthday, '03-14');

    const refused = await t.api('POST', '/api/import?mode=merge', { ...fill, people: [{ noteId: other, profile: { closeness: 'best' } }] });
    assert.equal(refused.status, 400);

    const replaced = await t.api('POST', '/api/import?mode=replace', exported);
    assert.equal(replaced.status, 200);
    assert.equal((await t.api('GET', `/api/people/${other}`)).json.profile.birthday, '', 'replace takes the export as it is');
  } finally {
    await t.close();
  }
});

test('the vault fill-in reads front matter into details, and leaves out what is not a person', () => {
  const fm = frontMatter('---\r\naliases: [Mags, "M"]\r\ndomain: css\r\ntype: person\r\nrole: VP Events\r\nbirthday: 2004-10-21\r\nmajor: Kinesiology\r\nstatus: unknown\r\ncontact: 403-555-0100\r\n---\r\n# Maya\r\n');
  assert.deepEqual(fm.aliases, ['Mags', 'M']);
  const p = profileFromFrontMatter(fm);
  assert.equal(p.role, 'VP Events');
  assert.equal(p.birthday, '2004-10-21');
  assert.deepEqual(p.aliases, ['Mags', 'M']);
  assert.deepEqual(p.contacts, [{ kind: 'phone', value: '403-555-0100' }]);
  assert.deepEqual(p.extra, [{ label: 'Major', value: 'Kinesiology' }], 'an unknown status is not worth keeping');
  assert.equal(profileFromFrontMatter(frontMatter('---\ntype: person\nbirthday: someday\n---\n')), null);
  assert.deepEqual(frontMatter('# no front matter'), {});
});
