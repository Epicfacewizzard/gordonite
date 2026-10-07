// Tag paths look like "daily-jots" or "school/fall26". Matching is exact:
// a parent tag does not include its children.
const SEGMENT = /^[\p{L}\p{N}_.-]+$/u;
const MAX_LEN = 100;
export const MAX_DEPTH = 6;

export function normalizeTag(input) {
  if (typeof input !== 'string') return null;
  let s = input.trim().toLowerCase().replace(/^#+/, '').replace(/\s+/g, '-');
  const segments = s.split('/').filter(Boolean);
  if (segments.length === 0 || segments.length > MAX_DEPTH) return null;
  if (!segments.every((seg) => SEGMENT.test(seg) && seg !== '.' && seg !== '..')) return null;
  s = segments.join('/');
  return s.length <= MAX_LEN ? s : null;
}
