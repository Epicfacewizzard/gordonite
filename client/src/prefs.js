// Display preferences kept on this device (a phone and a laptop may want different ones).
// They are applied as an attribute on <html>, which the stylesheet reads.

const SPACING_KEY = 'hq-spacing';
const OPENING_KEY = 'hq-opening-page';
export const OPENING_PAGES = [['/', 'Dashboard'], ['/notes', 'Notes'], ['/tasks', 'Tasks'], ['/people', 'People']];

// The dashboard's widgets: which are shown and in what order, kept on this device like the other display prefs.
// [id, name], top to bottom as first shown. A widget added later appears at the end until it is moved.
const DASHBOARD_KEY = 'hq-dashboard';
export const DASHBOARD_WIDGETS = [['nav', 'New note button'], ['pinned', 'Starred tags'], ['tasks', 'Tasks'], ['mood', 'Mood'], ['note', 'Today’s note']];
/** [{ id, name, shown }] in the saved order. */
export function getDashboard() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(DASHBOARD_KEY)) ?? {}; } catch { /* storage unavailable or damaged: use the defaults */ }
  const order = Array.isArray(saved.order) ? saved.order : [];
  const hidden = Array.isArray(saved.hidden) ? saved.hidden : [];
  const known = new Map(DASHBOARD_WIDGETS);
  const ids = [...order.filter((id) => known.has(id)), ...DASHBOARD_WIDGETS.map(([id]) => id).filter((id) => !order.includes(id))];
  return [...new Set(ids)].map((id) => ({ id, name: known.get(id), shown: !hidden.includes(id) }));
}
export function setDashboard(list) {
  try { localStorage.setItem(DASHBOARD_KEY, JSON.stringify({ order: list.map((w) => w.id), hidden: list.filter((w) => !w.shown).map((w) => w.id) })); return true; }
  catch { return false; }
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
