import { addDays, isValidDateString } from '../../shared/dates.js';

export const HABIT_KEY = 'gordonite-habits-preview-v1';
export const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const weekday = (date) => new Date(date + 'T12:00:00Z').getUTCDay();
export const weekStart = (date) => addDays(date, -((weekday(date) + 6) % 7));
export const scheduled = (habit, date) => date >= habit.created && habit.days.includes(weekday(date));
export const checked = (habit, date) => habit.checks.includes(date);
export function currentStreak(habit, today) {
  let date = today, count = 0;
  if (!scheduled(habit, date) || !checked(habit, date)) date = addDays(date, -1);
  for (; date >= habit.created; date = addDays(date, -1)) {
    if (!scheduled(habit, date)) continue;
    if (!checked(habit, date)) break;
    count++;
  }
  return count;
}
export function weekProgress(habits, today) {
  let done = 0, total = 0;
  for (let date = weekStart(today); date <= today; date = addDays(date, 1)) {
    for (const habit of habits) if (scheduled(habit, date)) {
      total++; if (checked(habit, date)) done++;
    }
  }
  return { done, total };
}
export function seedHabits(today) {
  return { format: 1, habits: [
    ['sample-read', 'Read a few pages', 'Ten minutes with a book', [0, 1, 2, 3, 4, 5, 6]],
    ['sample-outside', 'Get outside', 'A short walk is enough', [0, 1, 2, 3, 4, 5, 6]],
    ['sample-pause', 'Take a quiet moment', 'Five minutes to pause', [1, 2, 3, 4, 5]],
  ].map(([id, name, detail, days], index) => {
    const habit = { id, name, detail, days, created: addDays(today, -20), checks: [] };
    for (let n = 20; n > 0; n--) {
      const date = addDays(today, -n);
      if (scheduled(habit, date) && (n + index) % 6 !== 0) habit.checks.push(date);
    }
    return habit;
  }) };
}
export function validateHabits(value, today) {
  if (value?.format !== 1 || !Array.isArray(value.habits) || value.habits.length > 100) throw Error('Choose a valid habit backup (up to 100 habits).');
  const ids = new Set();
  return { format: 1, habits: value.habits.map((h) => {
    if (!h || typeof h.id !== 'string' || !h.id || h.id.length > 100 || ids.has(h.id) ||
      typeof h.name !== 'string' || !h.name.trim() || h.name.length > 80 ||
      typeof h.detail !== 'string' || h.detail.length > 100 ||
      !isValidDateString(h.created) || h.created > today ||
      !Array.isArray(h.days) || !h.days.length || h.days.length > 7 || !h.days.every((n) => Number.isInteger(n) && n >= 0 && n <= 6) ||
      !Array.isArray(h.checks) || h.checks.length > 50000 ||
      !h.checks.every((date) => isValidDateString(date) && date >= h.created && date <= today)) {
      throw Error('This backup contains invalid habit data. Nothing was replaced.');
    }
    ids.add(h.id);
    return { id: h.id, name: h.name.trim(), detail: h.detail, days: [...new Set(h.days)], created: h.created, checks: [...new Set(h.checks)] };
  }) };
}

// This experiment is deliberately separate from note sync and the server database.
export class HabitStore {
  constructor(storage) { this.storage = storage; this.data = null; this.error = ''; this.writable = true; this.listeners = new Set(); }
  read(today) {
    if (this.data) return this.data;
    try {
      const raw = this.storage.getItem(HABIT_KEY);
      this.data = raw === null ? seedHabits(today) : validateHabits(JSON.parse(raw), today);
      if (raw === null) this.storage.setItem(HABIT_KEY, JSON.stringify(this.data));
    } catch {
      this.data ??= { format: 1, habits: [] };
      this.writable = false;
      this.error = 'Habit storage is unavailable or damaged. Existing data has not been overwritten. Changes stay in this tab; copy a backup before closing.';
    }
    return this.data;
  }
  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit() { for (const fn of this.listeners) fn(); }
  externalChange() {
    // Do not discard this tab's changes if it was already unable to save.
    if (this.writable) this.data = null;
    this.emit();
  }
  change(today, transform) {
    this.read(today);
    if (this.writable) {
      try {
        const raw = this.storage.getItem(HABIT_KEY);
        this.data = raw === null ? { format: 1, habits: [] } : validateHabits(JSON.parse(raw), today);
      } catch {
        this.writable = false;
        this.error = 'Habit storage could not be read. Changes stay in this tab; copy a backup to keep them.';
      }
    }
    const next = validateHabits(transform(structuredClone(this.data)), today);
    this.data = next;
    if (this.writable) try { this.storage.setItem(HABIT_KEY, JSON.stringify(next)); }
    catch {
      this.writable = false;
      this.error = 'Habits could not be saved in this browser. Keep this tab open and copy a backup to keep your changes.';
    }
    this.emit();
  }
  toggle(id, date, today) {
    this.change(today, (data) => {
      const habit = data.habits.find((h) => h.id === id);
      if (!habit || !isValidDateString(date) || date > today || !scheduled(habit, date)) return data;
      habit.checks = checked(habit, date) ? habit.checks.filter((d) => d !== date) : [...habit.checks, date];
      return data;
    });
  }
}
