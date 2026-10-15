import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CHANNELS,
  addLogLine,
  birthdayLabel,
  birthdaySoon,
  cleanProfile,
  contactHref,
  emptyProfile,
  groupName,
  groupsOf,
  initials,
  isBirthday,
  isPersonTags,
  logEntries,
  logLine,
  matchesSearch,
  nextBirthday,
  parseLogLine,
  sinceLabel,
  sortPeople,
} from '../../shared/people.js';

test('a record is checked and kept in one shape; unknown fields are dropped', () => {
  assert.deepEqual(cleanProfile({}), emptyProfile());
  const p = cleanProfile({ role: '  VP Events ', closeness: 'close', birthday: '02-29', remember: ['likes tea', 'likes tea', ' '], contacts: [{ kind: 'phone', value: '403-555-0100' }, { kind: 'email', value: '' }], extra: [{ label: 'Major', value: 'Nursing' }, { label: '', value: 'x' }], surprise: 1 });
  assert.equal(p.role, 'VP Events');
  assert.deepEqual(p.remember, ['likes tea']);
  assert.deepEqual(p.contacts, [{ kind: 'phone', value: '403-555-0100' }], 'an empty contact is left out');
  assert.deepEqual(p.extra, [{ label: 'Major', value: 'Nursing' }]);
  assert.equal('surprise' in p, false);
  for (const bad of [{ closeness: 'best' }, { birthday: '02-30' }, { birthday: '2026-13-01' }, { lastTalked: '10/14' }, { contacts: [{ kind: 'fax', value: '1' }] }, { photo: '../x' }, { role: 'x'.repeat(121) }, []]) {
    assert.throws(() => cleanProfile(bad), Error, JSON.stringify(bad));
  }
});

test('birthdays: with or without a year, the next one, and Feb 29 in other years', () => {
  assert.equal(isBirthday('03-14'), true);
  assert.equal(isBirthday('2004-02-29'), true);
  assert.equal(isBirthday('2005-02-29'), false);
  assert.equal(birthdayLabel('1998-03-14'), 'Mar 14, 1998');
  assert.equal(birthdayLabel('03-14'), 'Mar 14');
  assert.deepEqual(nextBirthday('2004-10-21', '2026-10-14'), { date: '2026-10-21', days: 7, turning: 22 });
  assert.deepEqual(nextBirthday('03-14', '2026-10-14'), { date: '2027-03-14', days: 151, turning: null });
  assert.equal(nextBirthday('2004-02-29', '2027-02-01').date, '2027-02-28');
  assert.equal(nextBirthday('10-14', '2026-10-14').days, 0);
  assert.equal(birthdaySoon('2004-10-21', '2026-10-14'), 'turns 22 in 7 days');
  assert.equal(birthdaySoon('10-15', '2026-10-14'), 'tomorrow');
});

test('last talked reads as a plain distance', () => {
  assert.equal(sinceLabel('', '2026-10-14'), '');
  assert.equal(sinceLabel('2026-10-14', '2026-10-14'), 'Today');
  assert.equal(sinceLabel('2026-10-13', '2026-10-14'), 'Yesterday');
  assert.equal(sinceLabel('2026-10-04', '2026-10-14'), '10 days ago');
  assert.equal(sinceLabel('2026-09-01', '2026-10-14'), '6 weeks ago');
  assert.equal(sinceLabel('2026-04-14', '2026-10-14'), '6 months ago');
  assert.equal(sinceLabel('2024-01-01', '2026-10-14'), '2 years ago');
});

test('groups come from the tags under 05-people, with readable names', () => {
  assert.equal(isPersonTags(['05-people']), true);
  assert.equal(isPersonTags(['05-people/css/execs']), true);
  assert.equal(isPersonTags(['05-peoples', 'people/sam']), false);
  assert.deepEqual(groupsOf(['school', '05-people/css/execs', '05-people/css', '05-people/nursing']), ['05-people/css', '05-people/nursing']);
  assert.equal(groupName('05-people/css-applicants'), 'CSS Applicants');
  assert.equal(groupName('05-people/high-school'), 'High School');
  assert.equal(initials('Maya Okafor-Lee'), 'MO');
  assert.equal(initials(''), '?');
});

test('contacts become links only when they are one', () => {
  assert.equal(contactHref({ kind: 'phone', value: '(403) 555-0100' }), 'tel:4035550100');
  assert.equal(contactHref({ kind: 'email', value: 'a@b.ca' }), 'mailto:a@b.ca');
  assert.equal(contactHref({ kind: 'social', value: 'https://example.com/a' }), 'https://example.com/a');
  assert.equal(contactHref({ kind: 'social', value: '@maya' }), null);
  assert.equal(contactHref({ kind: 'email', value: 'javascript:alert(1)' }), null);
});

test('search covers the name, details, groups and note text; sorting by name, last talked and next birthday', () => {
  const person = (title, profile, text = '', tags = ['05-people/css']) => ({ title, tags, text, profile: { ...emptyProfile(), ...profile } });
  const a = person('Ava', { lastTalked: '2026-10-01', birthday: '12-01', aliases: ['Avie'] }, 'loves climbing');
  const b = person('ben', { lastTalked: '2026-01-01', birthday: '10-20', role: 'Treasurer' }, '', ['05-people/nursing']);
  const c = person('Cy', {});
  assert.equal(matchesSearch(a, 'avie climb'), true);
  assert.equal(matchesSearch(b, 'treasurer nursing'), true);
  assert.equal(matchesSearch(c, 'treasurer'), false);
  assert.equal(matchesSearch(c, '  '), true);
  assert.deepEqual(sortPeople([c, b, a], 'name', '2026-10-14').map((p) => p.title), ['Ava', 'ben', 'Cy']);
  assert.deepEqual(sortPeople([a, b, c], 'talked', '2026-10-14').map((p) => p.title), ['Cy', 'ben', 'Ava'], 'never talked first, then longest ago');
  assert.deepEqual(sortPeople([a, b, c], 'birthday', '2026-10-14').map((p) => p.title), ['ben', 'Ava', 'Cy'], 'no birthday last');
});

test('a conversation goes to the top of the note’s Log (or the vault’s History), and is read back from there', () => {
  const docOf = (...content) => ({ type: 'doc', content });
  const p = (text) => ({ type: 'paragraph', content: text ? [{ type: 'text', text }] : undefined });
  const h = (text) => ({ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text }] });
  assert.equal(logLine({ date: '2026-10-15', how: 'Coffee', text: ' Bake  sale\nplans ' }), 'Oct 15, 2026 · Coffee: Bake sale plans');

  // no log yet: a "Log" heading at the end, above the empty line left for writing
  let doc = addLogLine(docOf(h('Notes'), p('Runs events'), p('')), { date: '2026-10-14', how: 'Call', text: 'First call' });
  assert.deepEqual(doc.content.map((n) => n.type), ['heading', 'paragraph', 'heading', 'bulletList', 'paragraph']);
  doc = addLogLine(doc, { date: '2026-10-15', text: 'Quick hi' });
  assert.deepEqual(logEntries(doc), [
    { date: '2026-10-15', how: '', text: 'Quick hi' },
    { date: '2026-10-14', how: 'Call', text: 'First call' },
  ]);
  assert.equal(doc.content.filter((n) => n.type === 'heading').length, 2, 'one Log heading, not one per entry');

  // the vault's people notes already have a History section with ISO dates: use it, and read both formats
  const vault = docOf(h('Notes'), p('x'), h('🕰️ History'), { type: 'bulletList', content: [{ type: 'listItem', content: [p('2026-09-28: Reached out.')] }] }, h('🔗 Connected'), p('y'));
  const added = addLogLine(vault, { date: '2026-10-15', how: 'Text', text: 'Confirmed the booth' });
  assert.equal(added.content.filter((n) => n.type === 'heading').length, 3);
  assert.deepEqual(logEntries(added).map((e) => e.date), ['2026-10-15', '2026-09-28']);

  assert.equal(parseLogLine('Not a log line'), null);
  assert.equal(parseLogLine('Feb 30, 2026: impossible'), null);
  assert.deepEqual(logEntries(docOf(p('Oct 1, 2026: outside any log section'))), []);
  assert.equal(CHANNELS.includes('Coffee'), true);
});
