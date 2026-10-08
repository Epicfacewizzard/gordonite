// Display preferences kept on this device (a phone and a laptop may want different ones).
// They are applied as an attribute on <html>, which the stylesheet reads.

const SPACING_KEY = 'hq-spacing';
const OPENING_KEY = 'hq-opening-page';
export const OPENING_PAGES = [['/', 'Dashboard'], ['/notes', 'Notes'], ['/tasks', 'Tasks'], ['/people', 'People']];

// The dashboard's widgets: which are shown, in which column, and in what order. Kept on this device like the other
// display prefs. [id, name, the column it starts in], in the order they first appear. A widget added later appears at
// the end of its column until it is moved. To add a widget: add it here and to WIDGETS in views/Today.jsx.
const DASHBOARD_KEY = 'hq-dashboard';
export const DASHBOARD_WIDGETS = [['nav', 'New note button', 'right'], ['pinned', 'Starred tags', 'left'], ['mood', 'Mood', 'right'], ['tasks', 'Tasks', 'right'], ['note', 'Today’s note', 'center']];
// Where a widget can go. 'top' is a band across the whole width; the others are columns side by side (stacked top to
// bottom in this order on a phone). A column nobody uses takes no room.
export const DASHBOARD_REGIONS = [['top', 'Across the top'], ['left', 'Left column'], ['center', 'Middle column'], ['right', 'Right column']];
/** [{ id, name, shown, region }] in the saved order (order inside a column is the order here). */
export function getDashboard() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(DASHBOARD_KEY)) ?? {}; } catch { /* storage unavailable or damaged: use the defaults */ }
  const order = Array.isArray(saved.order) ? saved.order : [];
  const hidden = Array.isArray(saved.hidden) ? saved.hidden : [];
  const regions = saved.regions && typeof saved.regions === 'object' ? saved.regions : {};
  const known = new Map(DASHBOARD_WIDGETS.map(([id, name, region]) => [id, { name, region }]));
  const placed = (id) => (DASHBOARD_REGIONS.some(([r]) => r === regions[id]) ? regions[id] : known.get(id).region);
  const ids = [...order.filter((id) => known.has(id)), ...DASHBOARD_WIDGETS.map(([id]) => id).filter((id) => !order.includes(id))];
  return [...new Set(ids)].map((id) => ({ id, name: known.get(id).name, shown: !hidden.includes(id), region: placed(id) }));
}
export function setDashboard(list) {
  try {
    localStorage.setItem(DASHBOARD_KEY, JSON.stringify({ order: list.map((w) => w.id), hidden: list.filter((w) => !w.shown).map((w) => w.id), regions: Object.fromEntries(list.map((w) => [w.id, w.region])) }));
    return true;
  } catch { return false; }
}
export function getOpeningPage() {
  try { const value = localStorage.getItem(OPENING_KEY); return OPENING_PAGES.some(([path]) => path === value) ? value : '/'; }
  catch { return '/'; }
}
export function setOpeningPage(value) {
  if (!OPENING_PAGES.some(([path]) => path === value)) return false;
  try { localStorage.setItem(OPENING_KEY, value); return true; }
  catch { return false; }
}

/** [id, name, what it means] */
export const SPACINGS = [
  ['tight', 'Tight', 'Lines close together; Enter adds almost no gap.'],
  ['normal', 'Normal', 'Compact, with a small gap after each Enter.'],
  ['relaxed', 'Relaxed', 'Roomy: the spacing the app started with.'],
];

export function getSpacing() {
  try {
    const v = localStorage.getItem(SPACING_KEY);
    return SPACINGS.some(([id]) => id === v) ? v : 'normal';
  } catch {
    return 'normal'; // storage can be unavailable (private window, blocked site data)
  }
}

export function applySpacing(value = getSpacing()) {
  document.documentElement.dataset.spacing = value;
}

export function setSpacing(value) {
  try {
    localStorage.setItem(SPACING_KEY, value);
  } catch {
    /* it still applies for this visit */
  }
  applySpacing(value);
}

// How the Mood band behaves, kept on this device like the other display prefs. [id, name, what it does, default]
const MOOD_KEY = 'hq-mood-prefs';
export const MOOD_OPTIONS = [
  ['askNote', 'Ask for a note before logging', 'On: picking a face opens a Note box and a Log button. Off: one tap on a face logs it straight away.', true],
  ['history', 'Show mood history', 'The 7-day table, the streak line and today\u2019s entries (with delete) under the faces.', false],
];
/** { askNote, history } as chosen on this device; anything not chosen yet takes its default. */
export function getMoodPrefs() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(MOOD_KEY)) ?? {}; } catch { /* storage unavailable or damaged: use the defaults */ }
  return Object.fromEntries(MOOD_OPTIONS.map(([id, , , fallback]) => [id, typeof saved[id] === 'boolean' ? saved[id] : fallback]));
}
export function setMoodPref(id, value) {
  if (!MOOD_OPTIONS.some(([known]) => known === id)) return false;
  try { localStorage.setItem(MOOD_KEY, JSON.stringify({ ...getMoodPrefs(), [id]: !!value })); return true; }
  catch { return false; }
}
/** Forget the saved dashboard choices (shown or hidden, column, order) so the defaults apply again. */
export function resetDashboard() {
  try { localStorage.removeItem(DASHBOARD_KEY); return true; } catch { return false; }
}

// What the dashboard's Tasks box lists. Kept on this device like the other display prefs. [id, name]
const DASH_TASKS_KEY = 'hq-dashboard-tasks';
export const DASHBOARD_TASKS = [['overdue', 'Overdue only'], ['today', 'Overdue and due today'], ['week', 'Overdue, due today and the coming week'], ['all', 'Everything open (adds a few with no date)']];
export const DASHBOARD_TASKS_DEFAULT = 'today';
export function getDashboardTasks() {
  try { const v = localStorage.getItem(DASH_TASKS_KEY); return DASHBOARD_TASKS.some(([id]) => id === v) ? v : DASHBOARD_TASKS_DEFAULT; }
  catch { return DASHBOARD_TASKS_DEFAULT; }
}
export function setDashboardTasks(value) {
  if (!DASHBOARD_TASKS.some(([id]) => id === value)) return false;
  try { localStorage.setItem(DASH_TASKS_KEY, value); return true; }
  catch { return false; }
}
