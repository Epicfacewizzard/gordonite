// What the owner has dismissed or already acted on among the suggestions (shared/suggestions.js), kept on this device so
// a dismissed suggestion stays dismissed for its line, offline too. Keys are the suggestions' own keys (a hash of the
// line, never the text). A small list, oldest dropped. Storage may be missing or full: then nothing is remembered and
// the suggestion simply comes back, which is harmless (nothing is ever done without a tap).
const DISMISSED = 'hq-suggestions-dismissed';
const NAMES = 'hq-suggestions-people-added';
const LIMIT = 500;
const listeners = new Set();

const read = (key) => {
  try {
    const list = JSON.parse(localStorage.getItem(key));
    return Array.isArray(list) ? list.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
};
const write = (key, list) => {
  try {
    localStorage.setItem(key, JSON.stringify(list.slice(-LIMIT)));
  } catch {
    /* nothing remembered */
  }
  listeners.forEach((fn) => fn());
};

/** The keys dismissed on this device, as a Set. */
export const dismissedKeys = () => new Set(read(DISMISSED));
export const dismiss = (key) => write(DISMISSED, [...read(DISMISSED).filter((k) => k !== key), key]);
/** Names (lower case) added as people from a suggestion, so they are not offered again before the people list has them. */
export const addedNames = () => read(NAMES);
export const rememberAdded = (name) => write(NAMES, [...read(NAMES).filter((n) => n !== name.toLowerCase()), name.toLowerCase()]);
export const subscribeSuggestions = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
