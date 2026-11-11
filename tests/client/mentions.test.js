import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMentionMatcher } from '../../shared/mentions.js';
import { renderDoc } from '../../client/src/editor/render.js';

// Made-up people. Quinn Hart and Quinn Ortiz share a first name; Avery has two other names.
const people = [
  { id: 'sam', title: 'Samantha Lee', aliases: ['Sammy', 'Sam Lee Jr'] },
  { id: 'quinn-h', title: 'Quinn Hart', aliases: [] },
  { id: 'quinn-o', title: 'Quinn Ortiz', aliases: [] },
  { id: 'avery', title: 'Avery Stone', aliases: ['the Stoner'] },
  { id: 'dev', title: 'Dev Patel', aliases: [] },
  { id: 'jo', title: 'Jo Kim', aliases: [] },
  { id: 'zoe', title: 'Zoë Müller', aliases: [] },
];
const match = buildMentionMatcher(people);
const found = (text) => match(text).map((m) => `${text.slice(m.from, m.to)}=${m.id}`);

test('the full name matches in any capitals, with its position', () => {
  assert.deepEqual(match('Lunch with samantha lee today'), [{ from: 11, to: 23, id: 'sam' }]);
  assert.deepEqual(found('AVERY STONE called'), ['AVERY STONE=avery']);
});

test('a unique first name of at least three letters matches, exactly as capitalised', () => {
  assert.deepEqual(found('Samantha said hi, then samantha left'), ['Samantha=sam']);
  assert.deepEqual(found('Avery came. avery did not'), ['Avery=avery']);
  assert.deepEqual(found('Jo came'), [], 'two letters is too short to be a first name');
  assert.deepEqual(found('Jo Kim came'), ['Jo Kim=jo'], 'but the full name still matches');
});

test('a first name two people share links to nobody; the first name and last initial still tells them apart', () => {
  assert.deepEqual(found('Quinn was late'), []);
  assert.deepEqual(found('Quinn H and Quinn O. met'), ['Quinn H=quinn-h', 'Quinn O.=quinn-o']);
  assert.deepEqual(found('Quinn Hart and Quinn Ortiz'), ['Quinn Hart=quinn-h', 'Quinn Ortiz=quinn-o']);
});

test('First L and First L. both match, and the dot belongs to the name', () => {
  assert.deepEqual(found('Ask Samantha L. now'), ['Samantha L.=sam']);
  assert.deepEqual(found('Ask Samantha L now'), ['Samantha L=sam']);
  assert.deepEqual(found('Samantha l'), ['Samantha=sam'], 'a lower-case initial is not the name');
});

test('a form that is also another person\'s name is ambiguous and links to nobody', () => {
  const m = buildMentionMatcher([
    { id: 'a', title: 'Robin Cole', aliases: [] },
    { id: 'b', title: 'Pat Day', aliases: ['Robin'] },
  ]);
  assert.deepEqual(m('Robin here'), []);
  assert.deepEqual(m('Robin Cole here').map((x) => x.id), ['a']);
});

test('aliases: several words in any capitals, one word exactly as written', () => {
  assert.deepEqual(found('Sammy is here; sammy is not'), ['Sammy=sam']);
  assert.deepEqual(found('met THE STONER'), ['THE STONER=avery']);
  assert.deepEqual(found('Sam Lee Jr was there'), ['Sam Lee Jr=sam']);
});

test('whole words only, with accents and apostrophes handled', () => {
  assert.deepEqual(found('Developer Devon Devs predev'), [], 'Dev inside a longer word is not Dev');
  assert.deepEqual(found('Dev Patel and Dev Patels'), ['Dev Patel=dev', 'Dev=dev'], 'Patels is not Patel, but Dev alone is the first name');
  assert.deepEqual(found('Zoë Müller, Zoë and Zoëy'), ['Zoë Müller=zoe', 'Zoë=zoe']);
  assert.deepEqual(found("Samantha's idea; (Avery)"), ['Samantha=sam', 'Avery=avery']);
  assert.deepEqual(found('xSamantha Samanthax Samantha_'), []);
  assert.deepEqual(found('Sammy2 Sammy'), ['Sammy=sam']);
});

test('where names overlap the longest, earliest match wins and nothing overlaps', () => {
  // "Quinn" alone is nobody, "Samantha Lee" beats "Samantha", and a match never starts inside another.
  const text = 'Samantha Lee met Samantha L. and Avery Stone';
  assert.deepEqual(found(text), ['Samantha Lee=sam', 'Samantha L.=sam', 'Avery Stone=avery']);
  const spans = match(text);
  for (let i = 1; i < spans.length; i++) assert.ok(spans[i].from >= spans[i - 1].to);
});

test('text inside [[ ]] is already a link and is skipped; the rest of the line still matches', () => {
  assert.deepEqual(found('[[Samantha Lee]] and Samantha, [[Avery Stone|Avery]] and Avery'), ['Samantha=sam', 'Avery=avery']);
  assert.deepEqual(found('[[Sammy'), ['Sammy=sam'], 'an unfinished [[ is not a link');
});

test('the read-only view links names to the person\'s page, across formatting, but not to the page itself or inside [[ ]]', () => {
  const doc = { type: 'doc', content: [{ type: 'paragraph', content: [
    { type: 'text', text: 'Hi Sam' },
    { type: 'text', text: 'antha <b>', marks: [{ type: 'bold' }] },
    { type: 'text', text: ' and [[Avery Stone]] and Avery' },
  ] }] };
  const html = renderDoc(doc, { mentions: match });
  assert.match(html, /Hi <a href="#\/people\/sam" class="mention">Sam<\/a><strong><a href="#\/people\/sam" class="mention">antha<\/a> &lt;b&gt;<\/strong>/);
  assert.match(html, /<a href="#\/link\/Avery%20Stone" class="wiki-link">\[\[Avery Stone\]\]<\/a> and <a href="#\/people\/avery" class="mention">Avery<\/a>/);
  assert.equal(renderDoc(doc, { mentions: match, selfId: 'sam' }).includes('people/sam'), false, 'not on their own page');
  assert.equal(renderDoc(doc).includes('class="mention"'), false, 'no matcher, no links');
});

test('no people, no titles and odd input match nothing', () => {
  assert.deepEqual(buildMentionMatcher([])('Samantha'), []);
  assert.deepEqual(buildMentionMatcher(undefined)('Samantha'), []);
  assert.deepEqual(buildMentionMatcher([{ id: 'x', title: null, aliases: [] }])('anything'), []);
  assert.deepEqual(match(''), []);
  assert.deepEqual(match(undefined), []);
  assert.deepEqual(found('a (b) [c] Samantha.*+?'), ['Samantha=sam'], 'regular-expression characters in the text or in names are harmless');
  const odd = buildMentionMatcher([{ id: 'p', title: 'Pat (Pip) Lee', aliases: ['A+B'] }]);
  assert.deepEqual(odd('Pat (Pip) Lee and A+B').map((m) => m.id), ['p', 'p']);
});
