// Meetings (see docs/MEETINGS.md).
import { sendJson } from '../http.js';
import { createMeeting, listMeetings } from '../meetings.js';

export function registerMeetingRoutes({ route, db, store }) {
  route('GET', '/api/meetings', async ({ res, query }) => sendJson(res, 200, { meetings: listMeetings(db, store, { tag: query.get('tag') }) }));
  route('POST', '/api/meetings', async ({ res, body }) => sendJson(res, 201, createMeeting(db, store, body)));
}
