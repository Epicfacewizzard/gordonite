// Is the server up (and which build is it).
import { sendJson } from '../http.js';

export function registerHealthRoutes({ route, db, appVersion }) {
  route('GET', '/api/health', async ({ res }) => {
    db.prepare('SELECT 1').get();
    sendJson(res, 200, { ok: true, version: appVersion });
  });
}
