// Skin log entries (see docs/SKIN-LOG.md).
import { sendJson } from '../http.js';
import { saveSkinEntry, listSkinEntries, deleteSkinEntry } from '../skin.js';

export function registerSkinRoutes({ route, db, config }) {
  route('GET', '/api/skin', async ({ res, query }) => sendJson(res, 200, listSkinEntries(db, config, { from: query.get('from'), to: query.get('to') })));
  route('PUT', '/api/skin/:id', async ({ res, params, body }) => sendJson(res, 200, saveSkinEntry(db, config, params.id, body)));
  route('DELETE', '/api/skin/:id', async ({ res, params }) => sendJson(res, 200, deleteSkinEntry(db, params.id)));
}
