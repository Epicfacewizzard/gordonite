// The app's settings: a few values in the meta table.
//
// This is the one place that says what a setting is, how a value is checked, and how it travels in an export and an
// import, so a change made in the app and one that arrives with an import follow the same rules.
//
//   daily tag        which tag's entry for today the dashboard shows for writing (default "daily-jots")
//   home time zone   what "today" means (an IANA name; the HOME_TZ environment value is only the starting point)
//   tag order        the order folders are shown in: { parentPath: [childName, ...] }, '' being the top level
//   area folders     where a new project's tag is made for each area: { personal, school, club } (docs/PROJECTS.md)
import { normalizeTag } from '../shared/tags.js';
import { isValidTimeZone } from '../shared/dates.js';
import { AREAS, cleanAreaFolders } from '../shared/projects.js';
import { HttpError } from './errors.js';

export const DEFAULT_DAILY_TAG = 'daily-jots';
const MAX_ORDER_NAMES = 500;
const KEYS = { dailyTag: 'daily_tag', timeZone: 'home_tz', tagOrder: 'tag_order', areaFolders: 'project_area_folders' };

const read = (db, key) => db.prepare('SELECT value FROM meta WHERE key = ?').get(key)?.value ?? null;
const write = (db, key, value) =>
  db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
// An import in "merge" mode only fills in what this server has not set.
const fill = (db, key, value) => db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING').run(key, value);

// ---- home time zone ----

/** The time zone chosen in Settings, or null if none is saved (or it is no longer a valid name). */
export function savedTimeZone(db) {
  const tz = read(db, KEYS.timeZone);
  return tz && isValidTimeZone(tz) ? tz : null;
}

export function setTimeZone(db, cfg, tz) {
  if (typeof tz !== 'string' || !isValidTimeZone(tz)) throw new HttpError(400, 'bad_timezone', 'Choose a valid IANA timezone, such as America/Edmonton');
  write(db, KEYS.timeZone, tz);
  cfg.tz = tz;
}

// ---- the daily tag ----

export const dailyTag = (db) => read(db, KEYS.dailyTag) ?? DEFAULT_DAILY_TAG;

export function setDailyTag(db, rawPath) {
  const path = normalizeTag(rawPath);
  if (!path) throw new HttpError(400, 'bad_tag', 'Tag names use letters, numbers, - _ . and / for sub-tags');
  write(db, KEYS.dailyTag, path);
  return path;
}

/** A tag was moved: if the daily tag is that tag, or one under it, it follows. */
export function followTagMove(db, source, target) {
  const daily = read(db, KEYS.dailyTag);
  if (daily && (daily === source || daily.startsWith(`${source}/`))) write(db, KEYS.dailyTag, target + daily.slice(source.length));
}

// ---- tag order ----

/** The child names of one parent, kept only if each is a plain, normalised name (no "/"), at most 500. */
export function cleanOrderNames(list) {
  if (!Array.isArray(list)) return null;
  return list.filter((n) => typeof n === 'string' && n && !n.includes('/') && normalizeTag(n) === n).slice(0, MAX_ORDER_NAMES);
}

/** An order read from outside (an import): only parents that are '' or normalised paths, with clean names. */
export function cleanTagOrder(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const clean = {};
  for (const [parent, names] of Object.entries(value)) {
    const list = cleanOrderNames(names);
    if (list && (parent === '' || normalizeTag(parent) === parent)) clean[parent] = list;
  }
  return clean;
}

export function readTagOrder(db) {
  const raw = read(db, KEYS.tagOrder);
  try {
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function writeTagOrder(db, order) {
  write(db, KEYS.tagOrder, JSON.stringify(order));
}

// ---- project area folders ----

/** Where each area's new projects get their tag: { personal, school, club } (the vault's folders unless changed). */
export function areaFolders(db) {
  try {
    return cleanAreaFolders(JSON.parse(read(db, KEYS.areaFolders) ?? '{}'), normalizeTag);
  } catch {
    return cleanAreaFolders(null, normalizeTag);
  }
}

export function setAreaFolders(db, raw) {
  if (!raw || typeof raw !== 'object') throw new HttpError(400, 'bad_folders', 'Give a folder for personal, school and club');
  for (const a of AREAS) {
    if (raw[a] !== undefined && !normalizeTag(raw[a])) throw new HttpError(400, 'bad_tag', `The ${a} folder must be a tag name`);
  }
  const next = cleanAreaFolders({ ...areaFolders(db), ...raw }, normalizeTag);
  write(db, KEYS.areaFolders, JSON.stringify(next));
  return next;
}

// ---- export and import ----

/** What goes into a JSON export under "settings" (the time zone is its own top-level field there). */
export function exportSettings(db) {
  const settings = {};
  const daily = read(db, KEYS.dailyTag);
  if (daily) settings.dailyTag = daily;
  const order = readTagOrder(db);
  if (Object.keys(order).length) settings.tagOrder = order;
  if (read(db, KEYS.areaFolders)) settings.projectAreaFolders = areaFolders(db);
  return settings;
}

/**
 * Apply the settings of an export. `mode` 'replace' takes the export's; 'merge' only fills in what is not set here.
 * Every value goes through the same checks as a change made in the app; one that fails them is left out.
 */
export function importSettings(db, data, mode) {
  const put = mode === 'replace' ? write : fill;
  const daily = normalizeTag(data.settings?.dailyTag);
  if (daily) put(db, KEYS.dailyTag, daily);
  const order = cleanTagOrder(data.settings?.tagOrder);
  if (order) put(db, KEYS.tagOrder, JSON.stringify(order));
  if (data.settings?.projectAreaFolders) put(db, KEYS.areaFolders, JSON.stringify(cleanAreaFolders(data.settings.projectAreaFolders, normalizeTag)));
  if (typeof data.homeTimeZone === 'string' && isValidTimeZone(data.homeTimeZone)) put(db, KEYS.timeZone, data.homeTimeZone);
}
