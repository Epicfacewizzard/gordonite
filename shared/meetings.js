// Meetings (see docs/MEETINGS.md). A meeting is two ordinary notes and a small record beside them: the minutes (attendees,
// the minutes themselves, commitments as tasks, a pointer to the transcript) and the transcript exactly as it was pasted
// from outside (another app's output), with where it came from. This file turns what was typed or pasted into those two
// documents. Pure functions, shared by the server and the tests; the transcript is never edited or summarised here.
import { dateWrittenIn } from './suggestions.js';
import { uuid } from './ids.js';
import { isValidDateString } from './dates.js';

export const MAX_TRANSCRIPT = 400_000; // characters
export const MAX_MINUTES = 40_000;
const MAX_COMMITMENTS = 60;

const paragraph = (text) => ({ type: 'paragraph', ...(text ? { content: [{ type: 'text', text }] } : {}) });
const heading = (text, level = 2) => ({ type: 'heading', attrs: { level }, content: [{ type: 'text', text }] });
const lines = (text) => String(text ?? '').split(/\r?\n/).map((l) => l.replace(/\s+$/g, '')).filter((l) => l.trim());

/** A title a [[link]] can name: no brackets, bars, hashes or slashes. */
export const cleanMeetingTitle = (raw) => String(raw ?? '').replace(/[[\]|#/\\\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100);
export const transcriptTitleOf = (title) => `Transcript: ${title}`;

/**
 * Commitments typed one per line ("Sam: send the budget by Friday", "Robin - bring cups", "- [ ] book the hall") as
 * [{ text, ownerId, due, dueTime }]. A leading name that is an attendee's full name, first name or other name makes it
 * that person's commitment; anything else is the owner's own. `attendees` is [{ id, title, aliases? }].
 */
export function parseCommitments(text, attendees = [], noteDate = null) {
  const out = [];
  for (const raw of lines(text).slice(0, MAX_COMMITMENTS)) {
    let line = raw.replace(/^\s*(?:[-*•]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+)/, '').trim();
    if (!line) continue;
    let ownerId = null;
    const m = /^([^:–—-]{2,60}?)\s*(?::|\s[-–—]\s)\s*(\S.*)$/.exec(line);
    if (m) {
      const name = m[1].trim().toLowerCase();
      const hit = attendees.find((a) => [a.title, a.title?.split(' ')[0], ...(a.aliases ?? [])].filter(Boolean).some((n) => n.toLowerCase() === name));
      if (hit) {
        ownerId = hit.id;
        line = m[2].trim();
      }
    }
    const date = noteDate && isValidDateString(noteDate) ? dateWrittenIn(line, noteDate) : null;
    out.push({ text: line.slice(0, 500), ownerId, due: date?.due ?? null, dueTime: date?.dueTime ?? null });
  }
  return out;
}

/** The minutes note's document. `attendees` is [{ title }] (written as [[links]] so they open the person). */
export function minutesDoc({ title, date, source, attendees = [], minutes = '', commitments = [], transcriptTitle = null }) {
  const content = [];
  if (attendees.length) {
    content.push(heading('Attendees'), paragraph(attendees.map((a) => (/[[\]|#/]/.test(a.title) ? a.title : `[[${a.title}]]`)).join(', ')));
  }
  const minuteLines = lines(minutes);
  content.push(heading('Minutes'));
  if (minuteLines.length) for (const l of minuteLines) content.push(paragraph(l));
  else content.push(paragraph());
  if (commitments.length) {
    content.push(heading('Commitments'));
    content.push({
      type: 'taskList',
      content: commitments.map((c) => ({
        type: 'taskItem',
        attrs: { checked: false, id: uuid(), ...(c.ownerId ? { owner: c.ownerId } : {}), ...(c.due ? { due: c.due } : {}), ...(c.due && c.dueTime ? { dueTime: c.dueTime } : {}) },
        content: [paragraph(c.text)],
      })),
    });
  }
  if (transcriptTitle) {
    content.push(heading('Transcript'));
    content.push(paragraph(`${source ? `From ${source}. ` : ''}Kept as pasted: [[${transcriptTitle}]]`));
  }
  return { type: 'doc', content };
}

/** The transcript note's document: where it came from, then the text exactly as pasted, one paragraph per line. */
export function transcriptDoc({ source, date, text }) {
  const content = [paragraph(`Source: ${source || 'pasted text'} · saved ${date}. Kept as pasted and not edited.`)];
  for (const l of lines(text)) content.push(paragraph(l));
  return { type: 'doc', content };
}

/** Check a new meeting and return it in its stored shape. Throws an Error saying what is wrong. */
export function cleanMeeting(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('Missing meeting');
  const title = cleanMeetingTitle(raw.title);
  if (!title) throw new Error('A meeting needs a title');
  if (!isValidDateString(raw.date)) throw new Error('"date" must be a date like 2026-11-12');
  const text = (v, max, field) => {
    if (v == null || v === '') return '';
    if (typeof v !== 'string') throw new Error(`"${field}" must be text`);
    if (v.length > max) throw new Error(`"${field}" must be at most ${max} characters`);
    return v;
  };
  const source = text(raw.source, 200, 'source').replace(/\s+/g, ' ').trim();
  const transcript = text(raw.transcript, MAX_TRANSCRIPT, 'transcript');
  if (transcript.trim() && !source) throw new Error('Say where the transcript came from ("source"), for example the app that made it');
  if (raw.attendees != null && (!Array.isArray(raw.attendees) || raw.attendees.length > 60 || raw.attendees.some((a) => typeof a !== 'string'))) throw new Error('"attendees" must be a list of People note ids');
  return { title, date: raw.date, source, transcript, minutes: text(raw.minutes, MAX_MINUTES, 'minutes'), commitments: text(raw.commitments, 20_000, 'commitments'), attendees: [...new Set(raw.attendees ?? [])] };
}
