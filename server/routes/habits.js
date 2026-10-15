// Habits (see docs/HABITS.md).
import { sendJson } from '../http.js';
import { listHabits, saveHabit, deleteHabit, setCheck } from '../habits.js';

export function registerHabitRoutes({ route, db, config }) {
  route('GET', '/api/habits', async ({ res, query }) => sendJson(res, 200, listHabits(db, config, { from: query.get('from'), to: query.get('to') })));
  route('PUT', '/api/habits/:id', async ({ res, params, body }) => sendJson(res, 200, saveHabit(db, params.id, body)));
  route('DELETE', '/api/habits/:id', async ({ res, params }) => sendJson(res, 200, deleteHabit(db, params.id)));
  route('PUT', '/api/habits/:id/checks/:date', async ({ res, params }) => sendJson(res, 200, setCheck(db, config, params.id, params.date, true)));
  route('DELETE', '/api/habits/:id/checks/:date', async ({ res, params }) => sendJson(res, 200, setCheck(db, config, params.id, params.date, false)));
}
