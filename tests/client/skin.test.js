import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { entryText, addEntry, removeEntry, reassessedText, monthTitle, dayLabel, entryIsEmpty, NO_IRRITATION } from '../../shared/skin.js';
import { validateDoc, emptyDoc } from '../../shared/doc.js';

// The note as lines: "## 9/19" for a day, "- …" for an entry, "" for an empty line.
function outline(doc) {
  const text = (n) => (n.content ?? []).map((c) => (c.type === 'text' ? c.text : text(c))).join('');
  return doc.content.flatMap((n) => (n.type === 'heading' ? [`## ${text(n)}`] : n.type === 'bulletList' ? n.content.map((li) => `- ${text(li)}`) : [text(n)]));
}

describe('an entry as a line', () => {
  test('symptoms with severity, areas, products, trigger and comment', () => {
    assert.equal(
      entryText({ time: '2300', symptoms: ['Itch', 'Redness', 'Scarring'], severity: 'severe', areas: ['Legs', 'Arms', 'Neck'], products: ['Betaderm'], triggers: ['Alcohol'], comment: 'Worse on posterior leg' }),
      '2300: Severe itch, redness and scarring on legs, arms and neck. Betaderm applied on legs, arms and neck. Trigger: alcohol. Worse on posterior leg.',
    );
  });

  test('a treatment only, two products together', () => {
    assert.equal(entryText({ time: '1030', products: ['Betaderm', 'Eucerin'], areas: ['Arms', 'Legs'] }), '1030: Betaderm + Eucerin applied on arms and legs.');
  });

  test('each area has its own side and aspect, only where it can have them', () => {
    const where = { Legs: { side: 'left', aspect: 'posterior' }, Forehead: { side: 'left', aspect: 'anterior' }, 'Behind knees': { side: 'right', aspect: 'posterior' }, Neck: { side: 'left', aspect: 'anterior' } };
    assert.equal(
      entryText({ time: '2300', symptoms: ['Erythema'], areas: ['Legs', 'Forehead', 'Behind knees', 'Neck'], where, products: ['Betaderm'] }),
      '2300: Erythema on left posterior legs, forehead, right behind knees and anterior neck. Betaderm applied on left posterior legs, forehead, right behind knees and anterior neck.',
    );
  });

  test('an older entry with one side and aspect for all of it reads the same as it did', () => {
    assert.equal(entryText({ time: '2300', symptoms: ['Erythema'], areas: ['Legs'], side: 'bilateral', aspect: 'posterior', response: ['Partial relief'] }), '2300: Erythema on bilateral posterior legs. Response: partial relief.');
  });

  test('no irritation', () => {
    assert.equal(entryText({ time: '2300', symptoms: [NO_IRRITATION], areas: ['Arms', 'Legs'] }), '2300: No irritation on arms and legs.');
  });

  test('a comment alone keeps its own punctuation', () => {
    assert.equal(entryText({ time: '0240', comment: 'Woke up with burning on lower legs!' }), '0240: Woke up with burning on lower legs!');
  });

  test('nothing picked is empty', () => {
    assert.equal(entryIsEmpty({ symptoms: [], products: [], triggers: [], comment: ' ', areas: [] }), true);
    assert.equal(entryIsEmpty({ symptoms: ['Itch'] }), false);
  });

  test('names', () => {
    assert.equal(monthTitle('2026-09-19'), 'Skin log · September 2026');
    assert.equal(dayLabel('2026-09-07'), '9/7');
  });
});

describe('where an entry goes in the month note', () => {
  test('the first entry in an empty note: the day, the entry, a line to write on', () => {
    const doc = addEntry(emptyDoc(), { date: '2026-09-19', time: '2300', text: '2300: a' });
    assert.deepEqual(outline(doc), ['## 9/19', '- 2300: a', '']);
    assert.equal(validateDoc(doc), null);
  });

  test('newest day first; entries of a day in time order', () => {
    let doc = emptyDoc();
    doc = addEntry(doc, { date: '2026-09-07', time: '2200', text: '2200: b' });
    doc = addEntry(doc, { date: '2026-09-19', time: '2300', text: '2300: d' });
    doc = addEntry(doc, { date: '2026-09-07', time: '0022', text: '0022: a' });
    doc = addEntry(doc, { date: '2026-09-11', time: '1400', text: '1400: c' });
    doc = addEntry(doc, { date: '2026-09-01', time: '0900', text: '0900: z' });
    assert.deepEqual(outline(doc), ['## 9/19', '- 2300: d', '## 9/11', '- 1400: c', '## 9/7', '- 0022: a', '- 2200: b', '## 9/1', '- 0900: z', '']);
    assert.equal(validateDoc(doc), null);
  });

  test('text typed into the note by hand stays where it is', () => {
    const start = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Dermatologist on the 30th' }] }] };
    const doc = addEntry(start, { date: '2026-09-02', time: '0800', text: '0800: x' });
    assert.deepEqual(outline(doc), ['Dermatologist on the 30th', '## 9/2', '- 0800: x', '']);
  });

  test('a day heading typed by hand with no list under it gets one', () => {
    const start = { type: 'doc', content: [{ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '9/3' }] }] };
    assert.deepEqual(outline(addEntry(start, { date: '2026-09-03', time: '2237', text: '2237: x' })), ['## 9/3', '- 2237: x', '']);
  });
});

describe('editing and reassessing', () => {
  test('an entry’s line is taken out from under its day; a day left empty loses its heading', () => {
    let doc = emptyDoc();
    doc = addEntry(doc, { date: '2026-09-07', time: '0022', text: '0022: a' });
    doc = addEntry(doc, { date: '2026-09-07', time: '2200', text: '2200: b' });
    doc = addEntry(doc, { date: '2026-09-08', time: '1200', text: '1200: c' });
    let r = removeEntry(doc, { date: '2026-09-07', text: '0022: a' });
    assert.equal(r.found, true);
    assert.deepEqual(outline(r.doc), ['## 9/8', '- 1200: c', '## 9/7', '- 2200: b', '']);
    r = removeEntry(r.doc, { date: '2026-09-08', text: '1200: c' });
    assert.deepEqual(outline(r.doc), ['## 9/7', '- 2200: b', '']);
    assert.equal(validateDoc(r.doc), null);
  });

  test('a line moved by hand is still found; one that is gone is reported, and nothing changes', () => {
    const doc = addEntry(emptyDoc(), { date: '2026-09-07', time: '2200', text: '2200: b' });
    assert.equal(removeEntry(doc, { date: '2026-09-09', text: '2200: b' }).found, true, 'found under another day');
    const r = removeEntry(doc, { date: '2026-09-07', text: '2200: edited by hand' });
    assert.equal(r.found, false);
    assert.deepEqual(outline(r.doc), outline(doc));
  });

  test('a reassessment is said at the end of its entry’s own line; another day is named', () => {
    const entry = { date: '2026-09-07', time: '2143', symptoms: ['Itch'], areas: ['Legs'], products: ['Betaderm'] };
    assert.equal(
      entryText({ ...entry, reassessments: [{ date: '2026-09-07', time: '2330', response: ['Partial relief'], symptoms: ['Itch'], severity: 'mild' }] }),
      '2143: Itch on legs. Betaderm applied on legs. Reassessed at 2330: partial relief, mild itch.',
    );
    assert.equal(
      entryText({ ...entry, reassessments: [{ date: '2026-09-07', time: '2330', response: ['No change'] }, { date: '2026-09-08', time: '0700', symptoms: [NO_IRRITATION], comment: 'calm' }] }),
      '2143: Itch on legs. Betaderm applied on legs. Reassessed at 2330: no change. Reassessed at 9/8 0700: no irritation. Calm.',
    );
    assert.equal(reassessedText({ time: '0100', comment: 'Slept fine' }), 'Reassessed at 0100. Slept fine.');
  });
});
