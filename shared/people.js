// People (see docs/PEOPLE.md). A person is an ordinary note tagged `05-people` (or a group under it, such as
// `05-people/css`): its title is the name and its text is the free-form part. The details shown at the top of the page
// (closeness, birthday, contact, last talked, …) are a small record beside the note, kept on the server by note id.
// This file knows what a record may hold and how it is worded, sorted and searched; the server and the phone share it.

export const PEOPLE_TAG = '05-people';

export const CLOSENESS = [
  { id: 'close', label: 'Close' },
  { id: 'friendly', label: 'Friendly' },
  { id: 'acquaintance', label: 'Acquaintance' },
];
export const CONTACT_KINDS = [
  { id: 'phone', label: 'Phone' },
  { id: 'email', label: 'Email' },
  { id: 'social', label: 'Social' },
  { id: 'other', label: 'Other' },
];

const LIMITS = { role: 120, aliases: 10, alias: 60, extra: 20, extraLabel: 40, extraValue: 300, pronouns: 40, howMet: 500, metWhen: 60, contactValue: 200, contacts: 12, remember: 40, rememberItem: 80 };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS_IN = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** A record with nothing filled in. */
export const emptyProfile = () => ({
  photo: null,
  role: '',
  closeness: '',
  pronouns: '',
  howMet: '',
  metWhen: '',
  birthday: '',
  contacts: [],
  lastTalked: '',
  remember: [],
  aliases: [],
  extra: [],
});

const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s);
/** A birthday is "MM-DD" (year unknown) or a full date. */
export function isBirthday(s) {
  if (typeof s !== 'string') return false;
  if (isDate(s)) return true;
  const m = /^(\d{2})-(\d{2})$/.exec(s);
  return !!m && Number(m[1]) >= 1 && Number(m[1]) <= 12 && Number(m[2]) >= 1 && Number(m[2]) <= DAYS_IN[Number(m[1]) - 1];
}

const text = (v, max, field) => {
  if (v === undefined || v === null) return '';
  if (typeof v !== 'string') throw new Error(`"${field}" must be text`);
  const t = v.trim();
  if (t.length > max) throw new Error(`"${field}" must be at most ${max} characters`);
  return t;
};

/** Check a record and return it in its stored shape. Throws an Error saying what is wrong. Unknown fields are dropped. */
export function cleanProfile(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('"profile" must be an object');
  const p = emptyProfile();
  if (raw.photo !== undefined && raw.photo !== null && raw.photo !== '') {
    if (typeof raw.photo !== 'string' || !/^[A-Za-z0-9_-]{8,64}$/.test(raw.photo)) throw new Error('"photo" must be a file id');
    p.photo = raw.photo;
  }
  if (raw.closeness) {
    if (!CLOSENESS.some((c) => c.id === raw.closeness)) throw new Error('"closeness" must be close, friendly or acquaintance');
    p.closeness = raw.closeness;
  }
  p.role = text(raw.role, LIMITS.role, 'role');
  p.pronouns = text(raw.pronouns, LIMITS.pronouns, 'pronouns');
  p.howMet = text(raw.howMet, LIMITS.howMet, 'howMet');
  p.metWhen = text(raw.metWhen, LIMITS.metWhen, 'metWhen');
  if (raw.birthday) {
    if (!isBirthday(raw.birthday)) throw new Error('"birthday" must be a date like 1998-03-14, or 03-14 without the year');
    p.birthday = raw.birthday;
  }
  if (raw.lastTalked) {
    if (typeof raw.lastTalked !== 'string' || !isDate(raw.lastTalked)) throw new Error('"lastTalked" must be a date like 2026-10-14');
    p.lastTalked = raw.lastTalked;
  }
  if (raw.contacts !== undefined && raw.contacts !== null) {
    if (!Array.isArray(raw.contacts) || raw.contacts.length > LIMITS.contacts) throw new Error(`"contacts" must be a list of at most ${LIMITS.contacts}`);
    for (const c of raw.contacts) {
      if (!c || !CONTACT_KINDS.some((k) => k.id === c.kind)) throw new Error('each contact needs a kind: phone, email, social or other');
      const value = text(c.value, LIMITS.contactValue, 'contact');
      if (value) p.contacts.push({ kind: c.kind, value });
    }
  }
  if (raw.remember !== undefined && raw.remember !== null) {
    if (!Array.isArray(raw.remember) || raw.remember.length > LIMITS.remember) throw new Error(`"remember" must be a list of at most ${LIMITS.remember}`);
    for (const r of raw.remember) {
      const t = text(r, LIMITS.rememberItem, 'remember');
      if (t && !p.remember.includes(t)) p.remember.push(t);
    }
  }
  if (raw.aliases !== undefined && raw.aliases !== null) {
    if (!Array.isArray(raw.aliases) || raw.aliases.length > LIMITS.aliases) throw new Error(`"aliases" must be a list of at most ${LIMITS.aliases}`);
    for (const a of raw.aliases) {
      const t = text(a, LIMITS.alias, 'aliases');
      if (t && !p.aliases.includes(t)) p.aliases.push(t);
    }
  }
  // More details: the owner's own labelled fields (Department, Major, Cohort, …).
  if (raw.extra !== undefined && raw.extra !== null) {
    if (!Array.isArray(raw.extra) || raw.extra.length > LIMITS.extra) throw new Error(`"extra" must be a list of at most ${LIMITS.extra}`);
    for (const x of raw.extra) {
      if (!x || typeof x !== 'object') throw new Error('each detail needs a label and a value');
      const label = text(x.label, LIMITS.extraLabel, 'detail label');
      const value = text(x.value, LIMITS.extraValue, 'detail value');
      if (label && value) p.extra.push({ label, value });
    }
  }
  return p;
}

/** Does a note with these tag paths count as a person? */
export const isPersonTags = (paths) => paths.some((p) => p === PEOPLE_TAG || p.startsWith(`${PEOPLE_TAG}/`));

/** The groups a person is in: the first level under `05-people` ("05-people/css"), from their tag paths. */
export const groupsOf = (paths) => [...new Set(paths.filter((p) => p.startsWith(`${PEOPLE_TAG}/`)).map((p) => p.split('/').slice(0, 2).join('/')))].sort();

/** "05-people/css" -> "CSS", "05-people/high-school" -> "High School" */
export const groupName = (path) =>
  path
    .slice(PEOPLE_TAG.length + 1)
    .split(/[-_ ]+/)
    .filter(Boolean)
    .map((w) => (w.length <= 3 && w === w.toLowerCase() && !/[aeiou]/.test(w) ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1)))
    .join(' ');

/** "Maya Okafor-Lee" -> "MO" */
export const initials = (name) =>
  (name || '?')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => Array.from(w)[0] ?? '')
    .join('')
    .toUpperCase() || '?';

/** A steady colour for someone without a photo (a hue 0-359 from their name). */
export function avatarHue(name) {
  let h = 0;
  for (const ch of name || '') h = (h * 31 + ch.codePointAt(0)) % 360;
  return h;
}

const dayNumber = (d) => Date.parse(`${d}T00:00:00Z`) / 86_400_000;

/** "1998-03-14" -> "Mar 14, 1998"; "03-14" -> "Mar 14" */
export function birthdayLabel(b) {
  if (!b) return '';
  const full = b.length === 10;
  const [m, d] = (full ? b.slice(5) : b).split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}${full ? `, ${b.slice(0, 4)}` : ''}`;
}

/** The next birthday on or after today: { date, days, turning } (turning is null without a year). Feb 29 falls on Feb 28. */
export function nextBirthday(b, today) {
  if (!b) return null;
  const md = b.length === 10 ? b.slice(5) : b;
  let year = Number(today.slice(0, 4));
  const on = (y) => {
    const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
    return `${y}-${md === '02-29' && !leap ? '02-28' : md}`;
  };
  let date = on(year);
  if (date < today) date = on(++year);
  return { date, days: dayNumber(date) - dayNumber(today), turning: b.length === 10 ? year - Number(b.slice(0, 4)) : null };
}

/** "Today", "in 3 days", "in 5 weeks", … for a birthday. */
export function birthdaySoon(b, today) {
  const n = nextBirthday(b, today);
  if (!n) return '';
  const when = n.days === 0 ? 'today' : n.days === 1 ? 'tomorrow' : n.days < 14 ? `in ${n.days} days` : n.days < 60 ? `in ${Math.round(n.days / 7)} weeks` : `in ${Math.round(n.days / 30.4)} months`;
  return n.turning ? `turns ${n.turning} ${when}` : when;
}

/** "Today", "Yesterday", "3 days ago", "2 weeks ago", "4 months ago", "over a year ago"; "" when never set. */
export function sinceLabel(date, today) {
  if (!date) return '';
  const days = dayNumber(today) - dayNumber(date);
  if (days < 0) return 'Planned';
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.round(days / 7)} weeks ago`;
  if (days < 365) return `${Math.round(days / 30.4)} months ago`;
  return days < 730 ? 'Over a year ago' : `${Math.floor(days / 365)} years ago`;
}

/** Where a contact goes when tapped (tel:, mailto:, a web address), or null when it is not a link. */
export function contactHref(c) {
  const v = c.value.trim();
  if (c.kind === 'phone' && /^[+(\d][\d\s().-]{2,}$/.test(v)) return `tel:${v.replace(/[^\d+]/g, '')}`;
  if (c.kind === 'email' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return `mailto:${v}`;
  if (/^https?:\/\/\S+$/i.test(v)) return v;
  return null;
}

// ---------- the log in a person's note ----------
// "Log a conversation" writes what you talked about into the person's note, as a dated bullet under a "Log" heading (or
// the "History" heading the vault's people notes already have), newest first: "Oct 15, 2026 · Coffee: <what>". The note
// is the only copy: what was last talked about is read back from it, so changing the line in the note changes it.

export const CHANNELS = ['Coffee', 'Call', 'Text', 'Email', 'In person'];

const nodeText = (node) => (node?.content ?? []).map((c) => (c.type === 'text' ? c.text : nodeText(c))).join('');
const isBlankLine = (node) => node.type === 'paragraph' && !nodeText(node).trim();
const LOG_HEADING = /\b(log|history)\b/i;

/** "2026-10-15" -> "Oct 15, 2026" */
export const logDate = (date) => birthdayLabel(date);

/** One log line, as written: "Oct 15, 2026 · Coffee: Talked about the bake sale". */
export const logLine = ({ date, how = '', text }) => `${logDate(date)}${how ? ` · ${how}` : ''}: ${text.trim().replace(/\s+/g, ' ')}`;

/** A log line read back ({ date, how, text }), or null. Takes the vault's "2026-09-28: …" lines too. */
export function parseLogLine(line) {
  const m = /^\s*(?:([A-Z][a-z]{2}) (\d{1,2}), (\d{4})|(\d{4})-(\d{2})-(\d{2}))(?: · ([^:]{1,30}))?:\s*(.+)$/.exec(line);
  if (!m) return null;
  const month = m[1] ? MONTHS.indexOf(m[1]) + 1 : Number(m[5]);
  if (month < 1) return null;
  const date = m[1] ? `${m[3]}-${String(month).padStart(2, '0')}-${m[2].padStart(2, '0')}` : `${m[4]}-${m[5]}-${m[6]}`;
  return isDate(date) ? { date, how: (m[7] ?? '').trim(), text: m[8].trim() } : null;
}

/** The dated lines of a note's log section(s), newest first. */
export function logEntries(doc) {
  const content = doc?.content ?? [];
  const out = [];
  content.forEach((n, i) => {
    if (n.type !== 'heading' || !LOG_HEADING.test(nodeText(n))) return;
    for (let j = i + 1; j < content.length && content[j].type !== 'heading'; j++) {
      if (content[j].type !== 'bulletList' && content[j].type !== 'orderedList') continue;
      for (const item of content[j].content ?? []) {
        const entry = parseLogLine(nodeText(item.content?.[0]));
        if (entry) out.push(entry);
      }
    }
  });
  return out.sort((a, b) => b.date.localeCompare(a.date));
}

/** The note with a conversation added at the top of its log (a new "Log" heading at the end when it has none). */
export function addLogLine(doc, { date, how = '', text }) {
  const content = [...(doc?.content ?? [])].filter((n, i, all) => !(all.length === 1 && isBlankLine(n)));
  const item = { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: logLine({ date, how, text }) }] }] };
  const at = content.findIndex((n) => n.type === 'heading' && LOG_HEADING.test(nodeText(n)));
  if (at === -1) {
    let end = content.length;
    while (end > 0 && isBlankLine(content[end - 1])) end--;
    content.splice(end, 0, { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Log' }] }, { type: 'bulletList', content: [item] });
  } else if (content[at + 1]?.type === 'bulletList') {
    content[at + 1] = { ...content[at + 1], content: [item, ...content[at + 1].content] };
  } else {
    content.splice(at + 1, 0, { type: 'bulletList', content: [item] });
  }
  if (content.at(-1)?.type !== 'paragraph') content.push({ type: 'paragraph' }); // a line below to keep writing on
  return { ...doc, type: 'doc', content };
}

/** The words a search looks through: name, details and the note text. */
export function searchText(person) {
  const p = person.profile ?? emptyProfile();
  const cl = CLOSENESS.find((c) => c.id === p.closeness)?.label ?? '';
  return [person.title, p.role, ...p.aliases, ...p.extra.map((x) => x.value), cl, p.pronouns, p.howMet, p.metWhen, ...p.remember, ...p.contacts.map((c) => c.value), ...groupsOf(person.tags).map(groupName), person.text ?? '']
    .join('\n')
    .toLowerCase();
}

/** Does this person match every word typed? */
export function matchesSearch(person, q) {
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = searchText(person);
  return words.every((w) => hay.includes(w));
}

const byName = (a, b) => (a.title || '').localeCompare(b.title || '', undefined, { sensitivity: 'base' });

/** Sort a list: 'name' (A-Z), 'talked' (longest since last talked first; never first of all), 'birthday' (soonest first). */
export function sortPeople(list, by, today) {
  const out = [...list];
  if (by === 'talked') {
    const talked = (p) => p.lastTalked ?? p.profile?.lastTalked ?? '';
    out.sort((a, b) => talked(a).localeCompare(talked(b)) || byName(a, b));
  } else if (by === 'birthday') {
    const days = (p) => nextBirthday(p.profile?.birthday, today)?.days ?? Infinity;
    out.sort((a, b) => days(a) - days(b) || byName(a, b));
  } else {
    out.sort(byName);
  }
  return out;
}
