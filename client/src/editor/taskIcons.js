// One source for the small icons on a task's buttons. Plain strings, so they work in Preact, in the editor's DOM
// and in the read-only HTML alike.
export const ICON_PATHS = {
  eyeOff: 'M3 3l18 18M10.6 10.6a3 3 0 0 0 4.2 4.2M9.9 5.1A10 10 0 0 1 12 5c5 0 9 4 10 7a11 11 0 0 1-3.2 4.3M6.1 6.1A11 11 0 0 0 2 12c1 3 5 7 10 7a10 10 0 0 0 4.1-.9',
  calendar: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4M9.5 15l2 2 3.5-3.5',
  star: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z',
  chevron: 'M6 9l6 6 6-6',
};

const svg = (inner, fill = 'none', size = 18) =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true" fill="${fill}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;

export const iconSvg = (name, size) => svg(`<path d="${ICON_PATHS[name]}"/>`, 'none', size);

/** Star for a priority: filled = urgent & important, half = urgent, outline = important, outline (dim) = none. */
export function starSvg(priority, size = 18) {
  const half = priority === 'urgent' ? `<clipPath id="star-half"><rect x="0" y="0" width="12" height="24"/></clipPath><path d="${ICON_PATHS.star}" fill="currentColor" clip-path="url(#star-half)"/>` : '';
  return svg(`${half}<path d="${ICON_PATHS.star}"/>`, priority === 'both' ? 'currentColor' : 'none', size);
}

/**
 * The three round buttons of a task as plain data, so every place draws the same thing.
 * task: { due, start, hidden, hideUntil, priority, checked }; due is the effective date. Returns
 * [{ kind: 'hide'|'date'|'priority', state, label, svg }] where state is the CSS class that colours it.
 */
export function taskButtons(task, today) {
  const hiddenNow = task.hidden || (task.hideUntil && task.hideUntil > today);
  const waiting = task.start && task.start > today;
  const dateState = !task.due && !waiting ? 'unset' : task.due && task.due <= today && !task.checked ? 'due-soon' : 'due-set';
  const labels = { both: 'Urgent & Important', urgent: 'Urgent', important: 'Important' };
  return [
    { kind: 'hide', state: hiddenNow ? 'on' : 'unset', label: hiddenNow ? 'Hidden: change or show again' : 'Hide for a while', svg: iconSvg('eyeOff') },
    { kind: 'date', state: dateState, label: 'Due date', svg: iconSvg('calendar') },
    { kind: 'priority', state: `prio-${task.priority ?? 'none'}${task.priority ? '' : ' unset'}`, label: `Priority: ${labels[task.priority] ?? 'none'}`, svg: starSvg(task.priority) },
  ];
}
