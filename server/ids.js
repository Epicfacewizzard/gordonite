// The shape of an id (a note, a tag, a file, a mood entry...): letters, digits, - and _, 8 to 64 long.
import { HttpError } from './errors.js';

const ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

export const isId = (value) => typeof value === 'string' && ID_RE.test(value);

export function checkId(id, what = 'id') {
  if (!isId(id)) throw new HttpError(400, 'bad_id', `Invalid ${what}`);
  return id;
}
