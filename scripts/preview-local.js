import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../server/config.js';
import { openDb } from '../server/db.js';
import { createApp } from '../server/app.js';
import { uuid } from '../shared/ids.js';
import { savePerson } from '../server/people.js';
import { addLogLine } from '../shared/people.js';

// Separate, persistent sample data. Never uses the normal server or vault database.
// `--port 8092` runs a second preview beside one already on 8091.
const at = process.argv.indexOf('--port');
const port = at > 0 && /^\d{2,5}$/.test(process.argv[at + 1] ?? '') ? process.argv[at + 1] : '8091';
const config = loadConfig({ DATA_DIR: path.resolve('data/local-preview'), HOST: '127.0.0.1', PORT: port, BACKUP_INTERVAL_HOURS: '0' });
fs.mkdirSync(config.dataDir, { recursive: true });
const db = openDb(config.dbFile);
const { server, store } = createApp({ config, db });
const marker = path.join(config.dataDir, '.samples-created');
if (!fs.existsSync(marker) && db.prepare('SELECT COUNT(*) AS n FROM notes').get().n === 0) {
  const samples = [
    ['School hub', ['School'], 'Sample notes for exploring the folder browser. These are not imported from your vault.'],
    ['Clinical preparation', ['School/Clinical', 'Projects/Study'], 'Review the practice checklist and write down questions before the next session.'],
    ['Practice evaluation', ['School/Clinical/Evaluations'], 'What went well? What would I practise next time?'],
    ['Fall reading list', ['School/Fall26'], 'A place to keep reading notes and ideas.'],
    ['Home project', ['Projects/Home'], 'Write the first small step, then turn it into a task using the toolbar.'],
    ['Loose idea', [], 'Try adding a tag to organise this sample note.'],
  ];
  for (const [title, tags, text] of samples) {
    store.saveNote(uuid(), { baseRevision: 0, kind: 'note', title, date: '2026-10-05', tags, docFormat: 1,
      doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] } });
  }
  fs.writeFileSync(marker, 'Sample notes created.\n');
}
// Made-up people for trying People (docs/PEOPLE.md). Added once, also to a preview made before People had details.
const peopleMarker = path.join(config.dataDir, '.people-samples-created');
if (!fs.existsSync(peopleMarker)) {
  const para = (text) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
  const h = (text) => ({ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text }] });
  const day = (n) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
  const soon = new Date(Date.now() + 6 * 86_400_000).toISOString().slice(5, 10);
  const people = [
    ['Maya Okafor', '05-people/css', ['Notes', 'Runs the events calendar; always has the room booking sorted.'],
      { role: 'VP Events', closeness: 'close', pronouns: 'she/her', birthday: `2004-${soon}`, howMet: 'Sat next to each other at the first general meeting', metWhen: 'Fall 2024', remember: ['likes matcha', 'training for a half marathon'], contacts: [{ kind: 'email', value: 'maya.sample@example.com' }], aliases: ['Mags'], extra: [{ label: 'Department', value: 'Events' }, { label: 'Major', value: 'Kinesiology' }] }],
    ['Dev Raman', '05-people/css', ['Notes', 'Built the club website; ask him about the sponsor page.'],
      { role: 'Marketing (website focus)', closeness: 'friendly', birthday: '06-18', extra: [{ label: 'Department', value: 'Marketing' }, { label: 'Grad year', value: '2027' }] }],
    ['Priya Shah', '05-people/css', ['Notes', 'Treasurer. Reimbursement forms go to her by Friday.'],
      { role: 'Treasurer', closeness: 'friendly', lastTalked: day(9), contacts: [{ kind: 'phone', value: '403-555-0142' }] }],
    ['Lucas Bennett', '05-people/css-applicants', ['Application', 'Applied for social media coordinator. Strong portfolio.'],
      { role: 'Applicant: social media', closeness: 'acquaintance', extra: [{ label: 'Status', value: 'interview booked' }] }],
    ['Hannah Kim', '05-people/nursing', ['Notes', 'Clinical group partner. Shares notes on pharmacology.'],
      { role: 'Clinical group', closeness: 'close', pronouns: 'she/her', birthday: '1999-02-03', howMet: 'Same clinical placement', metWhen: 'Winter 2025', remember: ['has a cat named Tofu'], extra: [{ label: 'Cohort', value: 'N24 Year 3' }] }],
    ['Owen Fraser', '05-people/nursing', ['Notes', 'Lab partner in anatomy. Good at mnemonics.'],
      { closeness: 'friendly', lastTalked: day(75) }],
    ['Sofia Marin', '05-people/friends', ['Notes', 'Friend from high school. Moved to Vancouver.'],
      { closeness: 'close', birthday: '11-29', contacts: [{ kind: 'social', value: '@sofia.sample' }], remember: ['allergic to peanuts'] }],
    ['Jordan Lee', '05-people/work', ['Notes', 'Shift lead at the pharmacy.'],
      { role: 'Shift lead', closeness: 'friendly', lastTalked: day(5) }],
    // Like a person brought over from the old notes: a note only, no details yet.
    ['Aunt Rosa', '05-people/family', ['Notes', 'Sends the best care packages. Call on Sundays.'], null],
    ['Theo Nakamura', '05-people/other', ['Met at the volunteer fair. Wants to do a joint fundraiser.'], null],
  ];
  // Conversations, oldest first (Log a conversation puts each newest at the top of the note's Log).
  const chats = {
    'Maya Okafor': [[30, 'Text', 'Swapped notes on the welcome week schedule.'], [2, 'Coffee', 'Planning the Mid-Autumn booth; she wants lanterns and a photo corner.']],
    'Hannah Kim': [[1, 'In person', 'Studied pharmacology together before clinical. Her cat Tofu is sick, ask how he is doing.']],
    'Dev Raman': [[40, 'Call', 'Went over the sponsor page for the website.']],
    'Sofia Marin': [[120, 'Call', 'She likes Vancouver; looking for a climbing gym near the new place.']],
  };
  for (const [title, tag, lines, profile] of people) {
    const id = uuid();
    let doc = { type: 'doc', content: lines.length > 1 ? [h(lines[0]), ...lines.slice(1).map(para)] : lines.map(para) };
    for (const [ago, how, text] of chats[title] ?? []) doc = addLogLine(doc, { date: day(ago), how, text });
    store.saveNote(id, { baseRevision: 0, kind: 'note', title, date: '2026-10-05', tags: [tag], docFormat: 2, doc });
    if (profile) savePerson(db, id, { profile });
  }
  fs.writeFileSync(peopleMarker, 'Sample people created.\n');
}
server.listen(config.port, config.host, () => console.log(`Local sample preview: http://127.0.0.1:${port}/#/notes\nEdits stay in data/local-preview. CasaOS and your vault are untouched.`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => { db.close(); process.exit(0); }));
