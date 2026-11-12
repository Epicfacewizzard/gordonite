// Suggestions filed by an assistant, for the app's Debrief (see docs/DEBRIEF.md).
import { sendJson } from '../http.js';
import { listProposals, resolveProposal } from '../suggestions.js';

export function registerSuggestionRoutes({ route, db }) {
  route('GET', '/api/suggestions', async ({ res, query }) => sendJson(res, 200, { suggestions: listProposals(db, { day: query.get('day'), status: query.get('status') ?? 'open' }) }));
  // The app says what the owner did: accepted (after carrying it out through the note's own save) or dismissed.
  route('POST', '/api/suggestions/:id/resolve', async ({ res, params, body }) => sendJson(res, 200, { suggestion: resolveProposal(db, params.id, body?.status) }));
}
