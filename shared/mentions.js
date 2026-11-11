// Plain-name mentions (see docs/LINKS.md): finding the names of people in ordinary text, so a note that says "Sam"
// counts as mentioning Sam Lee without a [[link]]. A pure function over text; the server (who is mentioned where) and
// the client (names drawn as links, People today) share it.
//
// People are [{ id, title, aliases: [] }]. Each person is known by:
//   * their full name (the title), any capitals, or the title as one capitalised word when it is a single word;
//   * each "Also called" name: several words in any capitals, one word exactly as written;
//   * their first name, exactly as written, at least 3 letters, only when nobody else could be meant by it;
//   * "First L" and "First L." (first name and last initial), exactly as written, only when unique.
// A form claimed by two different people links to nobody. Matches are whole words, and text inside [[ ]] is left alone.

const WORD = /^[\p{L}][\p{L}'’-]*$/u;
const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const norm = (s) => s.trim().replace(/\s+/g, ' ');

// The forms a person is known by: { text, exact } where exact means capitals must match.
function formsOf(person) {
  const title = norm(person.title ?? '');
  const forms = [];
  if (title) {
    const words = title.split(' ');
    forms.push({ text: title, exact: words.length === 1 });
    const first = words[0];
    if (words.length > 1 && WORD.test(first) && [...first].length >= 3) forms.push({ text: first, exact: true });
    const last = words.at(-1);
    if (words.length > 1 && WORD.test(first) && /^\p{L}/u.test(last)) {
      const initial = [...last][0].toUpperCase();
      forms.push({ text: `${first} ${initial}`, exact: true }, { text: `${first} ${initial}.`, exact: true });
    }
  }
  for (const alias of person.aliases ?? []) {
    const text = norm(String(alias));
    if (text) forms.push({ text, exact: !text.includes(' ') });
  }
  return forms;
}

/** Builds `(text) => [{ from, to, id }]`: non-overlapping, in order; where names overlap, the earlier then longer wins. */
export function buildMentionMatcher(people) {
  // Who claims each form (any capitals), to drop the ones that could mean more than one person.
  const claims = new Map();
  const all = [];
  for (const person of people ?? []) {
    for (const form of formsOf(person)) {
      const key = form.text.toLowerCase();
      if (!claims.has(key)) claims.set(key, new Set());
      claims.get(key).add(person.id);
      all.push({ ...form, id: person.id, key });
    }
  }
  const usable = all.filter((f) => claims.get(f.key).size === 1);
  const idOf = new Map(); // lower-case form → id (exact forms are told apart again after matching)
  for (const f of usable) idOf.set(`${f.exact ? 'x' : 'i'}:${f.exact ? f.text : f.key}`, f.id);

  // One expression per kind of capitals, longest forms first so the longest name at a position wins.
  const pattern = (list) => {
    if (!list.length) return null;
    const alternatives = [...new Set(list.map((f) => f.text))].sort((a, b) => b.length - a.length).map(escapeRegExp);
    return new RegExp(`(?<![\\p{L}\\p{N}_])(?:${alternatives.join('|')})(?![\\p{L}\\p{N}_])`, list[0].exact ? 'gu' : 'giu');
  };
  const exactRe = pattern(usable.filter((f) => f.exact));
  const looseRe = pattern(usable.filter((f) => !f.exact));
  if (!exactRe && !looseRe) return () => [];

  return (text) => {
    text = String(text ?? '');
    const found = [];
    for (const [re, exact] of [[exactRe, true], [looseRe, false]]) {
      if (!re) continue;
      for (const m of text.matchAll(re)) {
        const id = idOf.get(exact ? `x:${m[0]}` : `i:${m[0].toLowerCase()}`);
        if (id !== undefined) found.push({ from: m.index, to: m.index + m[0].length, id });
      }
    }
    // A name inside [[ ]] is already a link.
    const links = [...text.matchAll(/\[\[[^\]\n]+\]\]/g)].map((m) => [m.index, m.index + m[0].length]);
    found.sort((a, b) => a.from - b.from || b.to - a.to);
    const out = [];
    for (const f of found) {
      if (links.some(([from, to]) => f.from < to && f.to > from)) continue;
      if (out.length && f.from < out.at(-1).to) continue;
      out.push(f);
    }
    return out;
  };
}
