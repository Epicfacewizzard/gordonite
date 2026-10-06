import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTaskSchedule } from '../../shared/taskdates.js';
import { describeTask } from '../../shared/tasks.js';
import { validateDoc } from '../../shared/doc.js';
import { hasStarted, isOverdue, timeInTz, changeTimestampDay } from '../../shared/dates.js';
import { startServer, save, task, docOf } from './helpers.js';
import { uuid } from '../../shared/ids.js';

test('clock grammar attaches times to the right dates, accepts next and explicit years, rejects ambiguous numbers', () => {
  const parse = (text, date = '2026-10-05') => parseTaskSchedule(text, date);
  for (const text of ['Email Kelvin at 6pm tmr', 'Email Kelvin tmr at 6pm', 'Email Kelvin due tmr at 18:00']) {
    assert.deepEqual(parse(text), { due: '2026-10-06', dueTime: '18:00', start: null, startTime: null });
  }
  assert.deepEqual(parse('Poster starts oct 7 at 9am due fri at 6pm'), { due: '2026-10-09', dueTime: '18:00', start: '2026-10-07', startTime: '09:00' });
  assert.equal(parse('Sponsor next week').due, '2026-10-12');
  assert.equal(parse('Sponsor next month', '2026-01-31').due, '2026-02-28');
  assert.equal(parse('Sponsor next year', '2028-02-29').due, '2029-02-28');
  assert.equal(parse('Sponsor due oct 12, 2027').due, '2027-10-12');
  assert.equal(parse('Sponsor due 12 oct 2025').due, '2025-10-12');
  for (const text of ['Buy 6 apples', 'Call at 25:00', 'Call at 13pm', 'Call at 6', 'Call at 9:70']) assert.equal(parse(text).dueTime, null);
  assert.equal(parse('Call at midnight').dueTime, '00:00');
  assert.equal(parse('Call at noon').dueTime, '12:00');
  assert.equal(parse('Call at 12am').dueTime, '00:00');
  assert.equal(parse('Call at 12pm').dueTime, '12:00');
  assert.equal(timeInTz(new Date('2026-10-06T00:00:00Z'), 'America/Edmonton'), '18:00');
  assert.equal(hasStarted('2026-10-05', '18:00', '2026-10-05', '17:59'), false);
  assert.equal(hasStarted('2026-10-05', '18:00', '2026-10-05', '18:00'), true);
  assert.equal(isOverdue('2026-10-05', '18:00', '2026-10-05', '18:01'), true);
  assert.equal(isOverdue('2026-10-05', null, '2026-10-05', '23:59'), false);
});

test('picked clock times persist, override words, and survive full export and restore', async () => {
  const app = await startServer(), copy = await startServer();
  try {
    const id = uuid(), item = task('Email Kelvin tmr at 6pm', false, uuid());
    item.attrs.due = '2026-11-01'; item.attrs.dueTime = '09:15'; item.attrs.startTime = '08:00'; item.attrs.start = '2026-11-01';
    const doc = docOf({ type: 'taskList', content: [item] });
    assert.equal(validateDoc(doc), null);
    assert.equal((await save(app, id, doc)).status, 200);
    const read = describeTask(item, '2026-10-05');
    assert.equal(read.dueTime, '09:15'); assert.equal(read.dueTimeFrom, 'set');
    assert.equal(app.store.listTasks()[0].startTime, '08:00');
    assert.equal(app.store.listTasks()[0].dueTime, '09:15');
    const exported = (await app.api('GET', '/api/export/json')).json;
    assert.equal((await copy.api('POST', '/api/import?mode=replace', exported)).status, 200);
    assert.deepEqual((await copy.api('GET', `/api/notes/${id}`)).json.note.doc, doc);
    item.attrs.dueTime = '25:00'; assert.match(validateDoc(doc), /HH:mm/);
  } finally { await app.close(); await copy.close(); }
});

test('history date correction retains home-zone clock across DST and rejects nonexistent local times', () => {
  assert.equal(changeTimestampDay('2025-10-05T18:15:34.123Z', '2025-12-01', 'America/Edmonton'), '2025-12-01T19:15:34.123Z');
  assert.equal(changeTimestampDay(null, '2026-10-05', 'America/Edmonton'), '2026-10-05T18:00:00.000Z');
  assert.throws(() => changeTimestampDay('2025-03-01T09:30:00.000Z', '2025-03-09', 'America/Edmonton'), /does not exist/);
});
