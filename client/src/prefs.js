// Display preferences kept on this device (a phone and a laptop may want different ones).
// They are applied as an attribute on <html>, which the stylesheet reads.

const SPACING_KEY = 'hq-spacing';
const OPENING_KEY = 'hq-opening-page';
export const OPENING_PAGES = [['/', 'Today'], ['/notes', 'Notes'], ['/tasks', 'Tasks'], ['/people', 'People']];
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
