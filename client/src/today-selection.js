export const DAILY_TAG_STORAGE_KEY = 'hq-today-daily-tag-id';

export function dailyTagChoices(tags, selectedPath, defaultPath = selectedPath) {
  const candidates = tags.filter((t) => t.daily && t.favorite);
  const fallback = tags.find((t) => t.path === defaultPath) ?? (defaultPath ? { id: `path:${defaultPath}`, path: defaultPath, daily: true, favorite: false } : null);
  if (fallback && !candidates.some((t) => t.id === fallback.id)) candidates.unshift(fallback);
  const selected = tags.find((t) => t.path === selectedPath) ?? (selectedPath ? { id: `path:${selectedPath}`, path: selectedPath, daily: true, favorite: false } : null);
  if (selected && !candidates.some((t) => t.id === selected.id)) candidates.unshift(selected);
  const counts = new Map();
  for (const t of candidates) {
    const base = t.path.split('/').filter(Boolean).at(-1) || t.path;
    counts.set(base.toLocaleLowerCase(), (counts.get(base.toLocaleLowerCase()) ?? 0) + 1);
  }
  return candidates.map((t) => {
    const base = t.path.split('/').filter(Boolean).at(-1) || t.path;
    return { ...t, label: counts.get(base.toLocaleLowerCase()) > 1 ? `${base} · ${t.path}` : base };
  });
}

export function readTodayTagId(storage) {
  return storage.getItem(DAILY_TAG_STORAGE_KEY);
}

export function writeTodayTagId(id, storage) {
  storage.setItem(DAILY_TAG_STORAGE_KEY, id);
}
