// The skin log (see docs/SKIN-LOG.md): a quick entry, picked from checkboxes, written as one line into a note.
//
// One note per month ("Skin log · September 2026", tag `skin`). Inside it, each day is a heading ("9/19", newest day
// first) followed by a bullet list of that day's entries in time order ("2300: …"). The note is ordinary text: it can
// be edited, searched and read like any other note; this file only knows how to word an entry and where it goes.

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "2026-09" -> "Skin log · September 2026" */
export function monthTitle(date) {
  const [y, m] = date.split('-').map(Number);
  return `Skin log · ${MONTHS[m - 1]} ${y}`;
}

/** "2026-09-07" -> "9/7" */
export const dayLabel = (date) => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;

/** "a", "a and b", "a, b and c" */
export function listWords(words) {
  const w = words.filter(Boolean);
  if (w.length <= 1) return w.join('');
  return `${w.slice(0, -1).join(', ')} and ${w.at(-1)}`;
}

const lower = (s) => s.charAt(0).toLowerCase() + s.slice(1);
const upper = (s) => s.charAt(0).toUpperCase() + s.slice(1);
export const NO_IRRITATION = 'No irritation';

// Which areas can have a side (left / right / bilateral) and which an aspect (anterior / posterior). An area added on
// the device (not in either list) can have a side.
const MIDLINE = new Set(['face', 'forehead', 'scalp', 'perioral', 'chest', 'back', 'abdomen']);
const WITH_ASPECT = new Set(['neck', 'arms', 'legs', 'lower legs', 'upper arms', 'forearms', 'thighs']);
const NO_SIDE = new Set([...MIDLINE, 'neck']);
/** { side, aspect }: whether this area can be qualified that way. */
export function qualifiersFor(area) {
  const a = area.toLowerCase();
  return { side: !NO_SIDE.has(a), aspect: WITH_ASPECT.has(a) };
}

// "left posterior legs": an area with its side and aspect (only the ones it can have).
function placeWords(area, q = {}) {
  const can = qualifiersFor(area);
  return [can.side ? q.side : null, can.aspect ? q.aspect : null, lower(area)].filter(Boolean).join(' ');
}

/**
 * One entry as a line of text.
 * entry: { time: '2300', symptoms: [], severity: 'mild'|'moderate'|'severe'|null, areas: [],
 *          where: { Legs: { side: 'left'|'right'|'bilateral'|null, aspect: 'anterior'|'posterior'|null } },
 *          products: [], response: [], triggers: [], comment: '', reassessments: [] }
 * -> "2300: Severe itch and redness on left posterior legs and forehead. Betaderm applied on left posterior legs and
 *     forehead. Response: partial relief. Trigger: alcohol. … Reassessed at 2345: relief."
 * (`side` / `aspect` for the whole entry are read too, from entries saved before areas had their own.)
 */
export function entryText({ time = '', symptoms = [], severity = null, areas = [], where: places = {}, side = null, aspect = null, products = [], response = [], triggers = [], comment = '', reassessments = [], date = null } = {}) {
  const where = areas.length ? ` on ${listWords(areas.map((a) => placeWords(a, places?.[a] ?? { side, aspect })))}` : '';
  const parts = [];
  const felt = symptoms.filter((s) => s !== NO_IRRITATION);
  if (felt.length) {
    parts.push(`${upper(`${severity ? `${severity} ` : ''}${listWords(felt.map(lower))}`)}${where}.`);
  } else if (symptoms.includes(NO_IRRITATION)) {
    parts.push(`No irritation${where}.`);
  }
  if (products.length) parts.push(`${products.join(' + ')} applied${where}.`);
  if (!parts.length && where) parts.push(`${upper(where.trim())}.`); // areas alone: where the comment is about
  if (response.length) parts.push(`Response: ${listWords(response.map(lower))}.`);
  if (triggers.length) parts.push(`Trigger: ${listWords(triggers.map(lower))}.`);
  const note = comment.trim();
  if (note) parts.push(sentence(note));
  for (const r of reassessments) parts.push(reassessedText(r, date));
  const body = parts.join(' ');
  return time ? `${time}: ${body}` : body;
}

const sentence = (s) => upper(/[.!?)]$/.test(s) ? s : `${s}.`);

/**
 * A reassessment, said on the same line as the entry it is about (which already says where and what was applied):
 * "Reassessed at 2345: partial relief, mild itch. Calmer." The day is named only when it is not the entry's own.
 * r: { date, time, response: [], symptoms: [], severity, comment }
 */
export function reassessedText({ date = null, time = '', response = [], symptoms = [], severity = null, comment = '' } = {}, entryDate = null) {
  const when = `${date && entryDate && date !== entryDate ? `${dayLabel(date)} ` : ''}${time}`.trim();
  const felt = symptoms.filter((s) => s !== NO_IRRITATION);
  const found = [
    ...response.map(lower),
    ...(felt.length ? [`${severity ? `${severity} ` : ''}${listWords(felt.map(lower))}`] : []),
    ...(symptoms.includes(NO_IRRITATION) ? ['no irritation'] : []),
  ];
  const note = comment.trim();
  return `Reassessed${when ? ` at ${when}` : ''}${found.length ? `: ${found.join(', ')}` : ''}.${note ? ` ${sentence(note)}` : ''}`;
}

/** Is there anything to write? */
export const entryIsEmpty = (e) => !e.symptoms?.length && !e.products?.length && !e.response?.length && !e.triggers?.length && !e.comment?.trim() && !e.areas?.length;

const textOf = (node) => (node?.content ?? []).map((c) => (c.type === 'text' ? c.text : textOf(c))).join('');
const dayOf = (label) => {
  const m = /^\s*(\d{1,2})\/(\d{1,2})\s*$/.exec(label);
  return m ? Number(m[1]) * 100 + Number(m[2]) : null; // 9/19 -> 919: orders days within a year
};
const timeOf = (item) => {
  const m = /^\s*(\d{3,4})\b/.exec(textOf(item));
  return m ? Number(m[1]) : null;
};
const paragraph = (text) => ({ type: 'paragraph', content: text ? [{ type: 'text', text }] : undefined });
const bullet = (text) => ({ type: 'listItem', content: [paragraph(text)] });
const isBlank = (node) => node.type === 'paragraph' && !textOf(node).trim();

/**
 * The note without one entry's line ({ doc, found }): looked for under its day's heading first, then anywhere (it may
 * have been moved by hand). A day left with no entries loses its heading too. Nothing else changes.
 */
export function removeEntry(doc, { date, text }) {
  const content = [...(doc?.content ?? [])];
  const matches = (item) => textOf(item).trim() === text.trim();
  const day = dayOf(dayLabel(date));
  const tryList = (i) => {
    const list = content[i];
    if (list?.type !== 'bulletList') return false;
    const at = list.content.findIndex(matches);
    if (at === -1) return false;
    const items = list.content.filter((_, j) => j !== at);
    if (items.length) {
      content[i] = { ...list, content: items };
    } else {
      const heading = content[i - 1];
      const isDay = heading?.type === 'heading' && dayOf(textOf(heading)) !== null;
      content.splice(isDay ? i - 1 : i, isDay ? 2 : 1);
    }
    return true;
  };
  const head = content.findIndex((n) => n.type === 'heading' && dayOf(textOf(n)) === day);
  let found = head !== -1 && tryList(head + 1);
  for (let i = 0; !found && i < content.length; i++) found = tryList(i);
  if (!content.length) content.push(paragraph(''));
  return { doc: { ...doc, type: 'doc', content }, found };
}

/**
 * The month note's document with one more entry: under the day's heading (made if missing, newest day first), placed
 * by its time among that day's entries. Anything else in the note is left where it is.
 */
export function addEntry(doc, { date, time, text }) {
  const content = [...(doc?.content ?? [])].filter((n, i, all) => !(all.length === 1 && isBlank(n))); // an empty note
  const label = dayLabel(date);
  const day = dayOf(label);
  const line = bullet(text);

  const at = content.findIndex((n) => n.type === 'heading' && dayOf(textOf(n)) === day);
  if (at === -1) {
    // a new day: before the first day heading that is older, else at the end
    let insert = content.findIndex((n) => n.type === 'heading' && dayOf(textOf(n)) !== null && dayOf(textOf(n)) < day);
    if (insert === -1) {
      insert = content.length; // at the end, but above the empty line(s) left for writing
      while (insert > 0 && isBlank(content[insert - 1])) insert--;
    }
    content.splice(insert, 0, { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: label }] }, { type: 'bulletList', content: [line] });
  } else {
    const next = content[at + 1];
    if (next?.type === 'bulletList') {
      const items = [...next.content];
      const t = timeOf(line);
      let pos = items.length;
      if (t !== null) {
        const later = items.findIndex((it) => timeOf(it) !== null && timeOf(it) > t);
        if (later !== -1) pos = later;
      }
      items.splice(pos, 0, line);
      content[at + 1] = { ...next, content: items };
    } else {
      content.splice(at + 1, 0, { type: 'bulletList', content: [line] });
    }
  }
  if (content.at(-1)?.type !== 'paragraph') content.push(paragraph('')); // a line below to keep writing on
  return { ...doc, type: 'doc', content };
}
