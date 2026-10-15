// People (see docs/PEOPLE.md).
import { sendJson } from '../http.js';
import { listPeople, getPerson, savePerson } from '../people.js';

export function registerPeopleRoutes({ route, db }) {
  route('GET', '/api/people', async ({ res }) => sendJson(res, 200, listPeople(db)));
  route('GET', '/api/people/:noteId', async ({ res, params }) => sendJson(res, 200, getPerson(db, params.noteId)));
  route('PUT', '/api/people/:noteId', async ({ res, params, body }) => sendJson(res, 200, savePerson(db, params.noteId, body)));
}
