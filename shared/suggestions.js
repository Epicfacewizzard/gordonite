// Suggestions (see docs/SUGGESTIONS.md): simple built-in rules that notice things in what was written and offer a one-tap
// choice next to the line. No AI, no network, so it works on the phone and offline. Nothing here changes a note: these
// are pure functions that say what could be offered, and what accepting one would do to the document.
//
//   task    a line that reads like something to do ("need to", "have to", "remind me", "by Friday")
//   person  a capitalised name that matches nobody in People ("met Priya", "Priya said")
//
// A rule only reads ordinary paragraphs at the top of the page; lines that are already tasks, headings, list items,
// files or [[links]] are left alone. A suggestion has a `key` that names it for the line it came from, so a dismissed
// suggestion stays dismissed for that line (and returns if the line is rewritten into something else).
import { findDatePhrases } from './taskdates.js';
import { uuid } from './ids.js';

const RELATIVE_DAY = 'monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun|tomorrow|tonight|today|eod|end of (?:the )?(?:day|week|month)|next week|next month';
// Wording that reads as "something I have to do". The first group is the commitment; NEGATED ones are skipped.
const TO_DO = new RegExp(`(?<![\\w'’])(?:need to|have to|got to|gotta|must|remind me|remember to|don['’]?t forget|do not forget|to do:|todo:|by (?:${RELATIVE_DAY})\\b)`, 'i');
const NEGATED = /\b(?:no need to|not need to|don['’]?t need to|do not need to|didn['’]?t need to|doesn['’]?t need to|won['’]?t need to|don['’]?t have to|do not have to|didn['’]?t have to|never have to|no longer need to)\b/i;
const LONG_ENOUGH = 8;
const TOO_LONG = 400;

// Words that are capitalised without being names: sentence starters, days, months, pronouns and the like.
const NOT_NAMES = new Set(
  `i i'm i'll i've i'd the a an and but or so if then when while after before also today tomorrow tonight yesterday monday tuesday wednesday thursday friday saturday sunday
   january february march april may june july august september october november december
   he she they we you it his her their our your my this that these those there here what who why how where which
   yes no ok okay thanks thank please hi hello hey dear note notes todo task tasks meeting call email text
   mr mrs ms dr prof professor met meet told tell asked ask ping pinged called calling texted emailed messaged saw spoke talked talking thanks introduced catch cc lunch coffee dinner`.split(/\s+/),
);
// Words just before a name that make it read as a person: "met Priya", "with Priya", "told Priya".
const BEFORE = /(?:\b(?:met|meet|with|told|tell|asked|ask|ping|pinged|call|called|calling|text|texted|email|emailed|message|messaged|saw|spoke to|talk to|talked to|talking to|thanks to|thank|introduced to|catch up with|cc)|@)\s+$/i;
// Words just after a name that make it read as a person: "Priya said", "Priya will".
const AFTER = /^\s+(?:said|says|told|asked|asks|called|calls|texted|emailed|wants|wanted|thinks|mentioned|replied|will|would|can|could|is|was|has|had|needs|promised|offered|suggested|agreed|sent|gave|joined|came|left|is going|asked me)\b/i;

const WORD_START = /\p{Lu}/u;
const NAME_WORD = /^\p{Lu}[\p{L}'’-]*\.?$/u;

/** Lowercase, collapse spaces: what a line is compared as. */
export const normalLine = (text) => String(text ?? '').trim().replace(/\s+/g, ' ');

// A short stable fingerprint of a line (FNV-1a), for the dismissal key. Collisions only hide a suggestion.
function hash(text) {
  let h = 0x811c9dc5;
  for (const ch of text) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

/** The key of a suggestion: its kind, the line it is about and (for a person) the name. */
export const suggestionKey = (kind, line, name = '') => `${kind}:${hash(normalLine(line).toLowerCase())}${name ? `:${name.toLowerCase()}` : ''}`;

const inlineText = (node) => {
  if (node.type === 'text') return node.text;
  if (node.type === 'hardBreak') return ' ';
  return (node.content ?? []).map(inlineText).join('');
};

/** The top-level paragraphs of a document as { text, index }: the only lines the rules read. */
export function paragraphsOf(doc) {
  const out = [];
  (doc?.content ?? []).forEach((node, index) => {
    if (node.type !== 'paragraph') return;
    const text = normalLine(inlineText(node));
    if (text) out.push({ text, index });
  });
  return out;
}

/** True when a line reads like something to do. */
export function looksLikeATask(text) {
  const line = normalLine(text);
  if (line.length < LONG_ENOUGH || line.length > TOO_LONG) return false;
  if (/\?\s*$/.test(line)) return false; // a question is not a commitment
  if (NEGATED.test(line)) return false;
  return TO_DO.test(line);
}

/** The date written in a line ("by Friday", "due Oct 12"), as { due, dueTime } or null. */
export function dateWrittenIn(text, noteDate) {
  const phrase = findDatePhrases(text, noteDate).find((p) => p.kind !== 'start');
  return phrase ? { due: phrase.date, dueTime: phrase.time ?? null } : null;
}

// Capitalised names in a line that read as people, in order: [{ name, from, to }]. A run of capitalised words is one name
// ("Priya Rao"). It counts when it follows or precedes a person-ish word, or has two or more words and is not first in
// the line. A single capitalised word at the start of a sentence needs a cue after it ("Priya said").
function nameCandidates(line) {
  const found = [];
  const words = [...line.matchAll(/\S+/g)].map((m) => ({ text: m[0].replace(/^[("“']+|[)"”',;:!?]+$/g, ''), from: m.index + (m[0].length - m[0].replace(/^[("“']+/, '').length), raw: m[0] }));
  for (let i = 0; i < words.length; ) {
    const w = words[i];
    const lower = w.text.toLowerCase().replace(/\.$/, '');
    if (!NAME_WORD.test(w.text) || !WORD_START.test(w.text) || NOT_NAMES.has(lower) || w.text.length < 2) {
      i++;
      continue;
    }
    let j = i + 1;
    // Extend over following capitalised words, but not over a word that ended a sentence or clause.
    while (j < words.length && j - i < 3 && !/[.,;:!?)”"]$/.test(words[j - 1].raw) && NAME_WORD.test(words[j].text) && !NOT_NAMES.has(words[j].text.toLowerCase().replace(/\.$/, ''))) j++;
    const last = words[j - 1];
    const name = words.slice(i, j).map((x) => x.text).join(' ').replace(/\.$/, '');
    const from = w.from;
    const to = last.from + last.text.replace(/\.$/, '').length;
    const before = line.slice(0, from);
    const after = line.slice(to);
    const sentenceStart = i === 0 || /[.!?]\s*$/.test(before.trim() === '' ? '.' : before);
    const cueBefore = BEFORE.test(before);
    const cueAfter = AFTER.test(after);
    const multiWord = j - i >= 2;
    if (cueBefore || cueAfter || (multiWord && !sentenceStart)) found.push({ name, from, to });
    i = j;
  }
  return found;
}

/**
 * What could be offered for a document.
 *   doc        the note's document (JSON)
 *   noteDate   YYYY-MM-DD, for dates written in a line
 *   matcher    the people matcher (shared/mentions.js) or null while the people list is not known; with no matcher no
 *              person is ever suggested (a name cannot be told from a person we merely have not loaded yet)
 *   knownNames lower-case names that are not to be suggested again (people just added on this device)
 * Returns [{ key, kind: 'task' | 'person', line, name?, due?, dueTime? }] in document order.
 */
export function suggest({ doc, noteDate, matcher = null, knownNames = [] }) {
  const out = [];
  const known = new Set(knownNames.map((n) => n.toLowerCase()));
  const offered = new Set();
  for (const { text } of paragraphsOf(doc)) {
    if (looksLikeATask(text)) {
      out.push({ key: suggestionKey('task', text), kind: 'task', line: text, ...(dateWrittenIn(text, noteDate) ?? {}) });
    }
    if (!matcher) continue;
    const mentioned = matcher(text);
    const links = [...text.matchAll(/\[\[[^\]\n]+\]\]/g)].map((m) => [m.index, m.index + m[0].length]);
    for (const c of nameCandidates(text)) {
      const lower = c.name.toLowerCase();
      if (known.has(lower) || offered.has(lower)) continue;
      if (mentioned.some((m) => c.from < m.to && c.to > m.from)) continue; // already a known person
      // Any word of the name being a known person's name means someone is probably already meant ("Priya Rao" when "Priya" is known).
      if (mentioned.some((m) => m.from >= c.from && m.to <= c.to)) continue;
      if (links.some(([a, b]) => c.from < b && c.to > a)) continue;
      offered.add(lower);
      out.push({ key: suggestionKey('person', text, c.name), kind: 'person', line: text, name: c.name });
    }
  }
  return out;
}

/** The suggestions that have not been dismissed. `dismissed` is a Set (or array) of keys. */
export const undismissed = (suggestions, dismissed) => {
  const set = dismissed instanceof Set ? dismissed : new Set(dismissed ?? []);
  return suggestions.filter((s) => !set.has(s.key));
};

/**
 * The task a line becomes: the paragraph's own words as a task item, carrying the date written in it. `due` /
 * `dueTime` are optional overrides. The task needs an id; the editor gives its own when it makes one.
 */
export function taskFromParagraph(paragraph, { due = null, dueTime = null, id = uuid() } = {}) {
  const attrs = { checked: false, id };
  if (due) attrs.due = due;
  if (due && dueTime) attrs.dueTime = dueTime;
  return { type: 'taskList', content: [{ type: 'taskItem', attrs, content: [paragraph] }] };
}

/**
 * A copy of the document where the first top-level paragraph reading `line` is a task instead (the line's words kept,
 * the date written in it carried as the task's own date). Null when no such paragraph is there any more.
 */
export function makeLineATask(doc, line, { noteDate, id, due = undefined } = {}) {
  const wanted = normalLine(line);
  const at = (doc?.content ?? []).findIndex((n) => n.type === 'paragraph' && normalLine(inlineText(n)) === wanted);
  if (at < 0) return null;
  const date = due ? { due, dueTime: null } : dateWrittenIn(wanted, noteDate);
  const task = taskFromParagraph(doc.content[at], { ...(date ?? {}), id });
  const content = [...doc.content];
  content.splice(at, 1, task);
  return { ...doc, content };
}

// ----- proposals filed by an assistant (docs/DEBRIEF.md) -----
// The same kinds of choice as the built-in rules, plus "remember" (a fact for a person's page). The assistant files them;
// the owner accepts or dismisses them in the Debrief. Checking is shared so the server, the bridge and the app agree.
export const PROPOSAL_KINDS = ['task', 'person', 'remember'];
const ID = /^[A-Za-z0-9_-]{8,64}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const str = (v, max, field, { required = false } = {}) => {
  if (v === undefined || v === null || v === '') {
    if (required) throw new Error(`"${field}" is required`);
    return undefined;
  }
  if (typeof v !== 'string') throw new Error(`"${field}" must be text`);
  const t = v.trim().replace(/\s+/g, ' ');
  if (!t && required) throw new Error(`"${field}" is required`);
  if (t.length > max) throw new Error(`"${field}" must be at most ${max} characters`);
  return t || undefined;
};

/** Check one proposal and return it in its stored shape { kind, noteId?, reason?, ...details }. Throws an Error saying what is wrong. */
export function cleanProposal(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('each suggestion must be an object');
  if (!PROPOSAL_KINDS.includes(raw.kind)) throw new Error(`"kind" must be one of ${PROPOSAL_KINDS.join(', ')}`);
  const out = { kind: raw.kind };
  if (raw.noteId != null) {
    if (typeof raw.noteId !== 'string' || !ID.test(raw.noteId)) throw new Error('"noteId" must be a note id');
    out.noteId = raw.noteId;
  }
  const reason = str(raw.reason, 200, 'reason');
  if (reason) out.reason = reason;
  if (raw.kind === 'task') {
    out.text = str(raw.text, 300, 'text', { required: true });
    const line = str(raw.line, 400, 'line');
    if (line) out.line = line; // the journal line to turn into this task; without it the task is added to the entry
    if (raw.due != null) {
      if (typeof raw.due !== 'string' || !DATE.test(raw.due) || Number.isNaN(Date.parse(`${raw.due}T00:00:00Z`))) throw new Error('"due" must be a date like 2026-11-13');
      out.due = raw.due;
    }
  } else if (raw.kind === 'person') {
    out.name = str(raw.name, 80, 'name', { required: true });
    const line = str(raw.line, 400, 'line');
    if (line) out.line = line;
  } else {
    if (typeof raw.personId !== 'string' || !ID.test(raw.personId)) throw new Error('"personId" must be a People note id');
    out.personId = raw.personId;
    out.text = str(raw.text, 80, 'text', { required: true });
  }
  return out;
}
