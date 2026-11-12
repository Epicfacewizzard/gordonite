// The built-in suggestion rules (shared/suggestions.js): what is offered next to a line, and what accepting does.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMentionMatcher } from '../../shared/mentions.js';
import { cleanProposal, suggest, looksLikeATask, dateWrittenIn, makeLineATask, suggestionKey, undismissed, paragraphsOf } from '../../shared/suggestions.js';
import { validateDoc } from '../../shared/doc.js';

const NOTE_DATE = '2026-11-09'; // a Monday
const p = (text) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
const doc = (...lines) => ({ type: 'doc', content: lines.map((l) => (typeof l === 'string' ? p(l) : l)) });
const matcher = buildMentionMatcher([{ id: 'sam', title: 'Sam Lee', aliases: [] }, { id: 'ro', title: 'Robin Ortiz', aliases: [] }]);
const kinds = (list) => list.map((s) => `${s.kind}:${s.name ?? s.line}`);

test('wording that reads like something to do offers a task', () => {
  for (const line of ['I need to book the room', 'Have to send the invoice', 'Remind me to call the printer', 'remember to water the plants', 'Don’t forget the receipts', 'Slides ready by Friday', 'Got to finish the poster']) {
    assert.equal(looksLikeATask(line), true, line);
  }
});

test('questions, denials, short lines and plain statements offer nothing', () => {
  for (const line of ['Do I need to book the room?', 'I don’t need to book the room', 'No need to send it', 'Need it', 'Had a lovely walk by the river', 'The meeting went well']) {
    assert.equal(looksLikeATask(line), false, line);
  }
});

test('a date written in the line is carried; none is invented', () => {
  assert.deepEqual(dateWrittenIn('Need to send the budget by Friday', NOTE_DATE), { due: '2026-11-13', dueTime: null });
  assert.equal(dateWrittenIn('Need to send the budget', NOTE_DATE), null);
  assert.equal(suggest({ doc: doc('Need to send the budget by Friday'), noteDate: NOTE_DATE })[0].due, '2026-11-13');
});

test('only plain top-level paragraphs are read: tasks, headings and lists are left alone', () => {
  const d = doc(
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Need to plan' }] },
    { type: 'taskList', content: [{ type: 'taskItem', attrs: { id: 'a', checked: false }, content: [p('Need to book it')] }] },
    { type: 'bulletList', content: [{ type: 'listItem', content: [p('Have to call')] }] },
    'Need to email the venue',
  );
  assert.deepEqual(kinds(suggest({ doc: d, noteDate: NOTE_DATE })), ['task:Need to email the venue']);
  assert.deepEqual(paragraphsOf(d).map((x) => x.text), ['Need to email the venue']);
});

test('a name that matches nobody offers Add person, with a cue or a full name', () => {
  const run = (line) => kinds(suggest({ doc: doc(line), noteDate: NOTE_DATE, matcher }));
  assert.deepEqual(run('Met Priya Rao at the fair'), ['person:Priya Rao']);
  assert.deepEqual(run('Had lunch with Mateo today'), ['person:Mateo']);
  assert.deepEqual(run('Priya said the stall is free'), ['person:Priya']);
  assert.deepEqual(run('Today we spoke to Jordan Blake.'), ['person:Jordan Blake']);
});

test('places, days, sentence starters and known people are not offered', () => {
  const run = (line) => suggest({ doc: doc(line), noteDate: NOTE_DATE, matcher }).filter((s) => s.kind === 'person');
  assert.equal(run('Drove to Calgary on Friday').length, 0, 'no cue, one word');
  assert.equal(run('Monday was slow. The room is booked.').length, 0);
  assert.equal(run('Lunch with Sam Lee').length, 0, 'known person');
  assert.equal(run('Lunch with Robin').length, 0, 'unique first name of a known person');
  assert.equal(run('Lunch with Robin Ortiz, then met Mateo').map((s) => s.name).join(), 'Mateo');
  assert.equal(run('See [[Priya]] soon').length, 0, 'a [[link]] is already a link');
});

test('with no people list yet, no person is offered; names just added are not offered again', () => {
  assert.equal(suggest({ doc: doc('Met Priya Rao at the fair'), noteDate: NOTE_DATE, matcher: null }).length, 0);
  assert.equal(suggest({ doc: doc('Met Priya Rao at the fair'), noteDate: NOTE_DATE, matcher, knownNames: ['priya rao'] }).length, 0);
});

test('the same name twice is offered once', () => {
  const list = suggest({ doc: doc('Met Priya at the fair', 'Priya said hello again'), noteDate: NOTE_DATE, matcher });
  assert.equal(list.filter((s) => s.kind === 'person').length, 1);
});

test('dismissal is by key: the same line stays dismissed, a changed line returns', () => {
  const first = suggest({ doc: doc('Need to email the venue'), noteDate: NOTE_DATE });
  const dismissed = new Set([first[0].key]);
  assert.equal(undismissed(suggest({ doc: doc('Need to email the venue'), noteDate: NOTE_DATE }), dismissed).length, 0);
  assert.equal(undismissed(suggest({ doc: doc('Need to email the venue  '), noteDate: NOTE_DATE }), dismissed).length, 0, 'spacing is not a change');
  assert.equal(undismissed(suggest({ doc: doc('Need to email the caterer'), noteDate: NOTE_DATE }), dismissed).length, 1);
  assert.notEqual(suggestionKey('person', 'Met Priya', 'Priya'), suggestionKey('task', 'Met Priya'));
});

test('making a line a task keeps its words and marks, carries the date and makes a valid document', () => {
  const bold = { type: 'paragraph', content: [{ type: 'text', text: 'Need to ' }, { type: 'text', text: 'print', marks: [{ type: 'bold' }] }, { type: 'text', text: ' posters by Friday' }] };
  const before = doc('Opening line', bold, 'Closing line');
  const after = makeLineATask(before, 'Need to print posters by Friday', { noteDate: NOTE_DATE, id: 'task-id-0001' });
  assert.equal(validateDoc(after), null);
  assert.deepEqual(after.content.map((n) => n.type), ['paragraph', 'taskList', 'paragraph']);
  const item = after.content[1].content[0];
  assert.deepEqual(item.attrs, { checked: false, id: 'task-id-0001', due: '2026-11-13' });
  assert.deepEqual(item.content[0], bold);
  assert.equal(makeLineATask(before, 'Something else', { noteDate: NOTE_DATE }), null);
  assert.equal(JSON.stringify(before.content[1]), JSON.stringify(bold), 'the original is untouched');
});

// ----- 0.21.0: someone else's commitment -----
const known = [{ id: 'sam', title: 'Sam Lee' }, { id: 'ro', title: 'Robin Ortiz' }];
const ownerRun = (line) => suggest({ doc: doc(line), noteDate: NOTE_DATE, matcher, people: known });

test('a known person and "will ..." offers their task, not mine; the date written is carried', () => {
  const [s, ...rest] = ownerRun('Sam Lee will send the budget by Friday');
  assert.equal(rest.length, 0, 'no second suggestion for my own task');
  assert.deepEqual([s.kind, s.personId, s.name, s.due], ['owner', 'sam', 'Sam Lee', '2026-11-13']);
  assert.equal(ownerRun('Robin promised to bring the cups')[0].personId, 'ro');
  assert.equal(ownerRun('Sam Lee needs to confirm the venue')[0].kind, 'owner');
});

test('not a commitment: a question, "will be", a denial or an unknown person', () => {
  assert.equal(ownerRun('Will Sam Lee send the budget?').length, 0);
  assert.equal(ownerRun('Sam Lee will be at the fair').length, 0);
  assert.equal(ownerRun('Sam Lee will not need to send it').length, 0);
  assert.deepEqual(kinds(ownerRun('Priya will send the budget')), ['person:Priya'], 'unknown: only Add person');
});

test('my own wording still offers my task even when a person is named', () => {
  assert.deepEqual(ownerRun('Need to email Sam Lee about the venue').map((s) => s.kind), ['task']);
});

test('making an owner task stores the owner id; a proposal may name an owner', () => {
  const after = makeLineATask(doc('Sam Lee will send the budget by Friday'), 'Sam Lee will send the budget by Friday', { noteDate: NOTE_DATE, id: 'task-id-0002', owner: 'sam-person-0001' });
  assert.equal(validateDoc(after), null);
  assert.deepEqual(after.content[0].content[0].attrs, { checked: false, id: 'task-id-0002', owner: 'sam-person-0001', due: '2026-11-13' });
  assert.equal(cleanProposal({ kind: 'task', text: 'Send budget', ownerId: 'sam-person-0001' }).ownerId, 'sam-person-0001');
  assert.throws(() => cleanProposal({ kind: 'task', text: 'x', ownerId: 'no' }), /ownerId/);
});
