// Mood entries (see docs/MOOD.md).
import { sendJson } from '../http.js';
import { addMood, listMoods, deleteMood, restoreMood } from '../moods.js';

export function registerMoodRoutes({ route, db, config }) {
  // ----- mood entries (see docs/MOOD.md) -----
  route('GET', '/api/moods', async ({ res, query }) => sendJson(res, 200, listMoods(db, config, { from: query.get('from'), to: query.get('to') })));
  route('PUT', '/api/moods/:id', async ({ res, params, body }) => sendJson(res, 200, addMood(db, config, body, params.id)));
  route('DELETE', '/api/moods/:id', async ({ res, params }) => sendJson(res, 200, deleteMood(db, params.id)));
  route('POST', '/api/moods/:id/restore', async ({ res, params }) => sendJson(res, 200, restoreMood(db, params.id)));
}
