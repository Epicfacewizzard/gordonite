// Display preferences kept on this device (a phone and a laptop may want different ones).
// They are applied as an attribute on <html>, which the stylesheet reads.

const SPACING_KEY = 'hq-spacing';

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
