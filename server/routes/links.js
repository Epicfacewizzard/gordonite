// Links between notes (see docs/LINKS.md): what a [[link]] opens, what links to a note, and what "[[" suggests.
import { sendJson } from '../http.js';

export function registerLinkRoutes({ route, links }) {
  // Show all matches rather than guessing when names collide; navigation itself uses the stable note ID.
  route('GET', '/api/note-links', async ({ res, query }) => sendJson(res, 200, links.resolve((query.get('target') ?? '').trim())));
  route('GET', '/api/note-names', async ({ res }) => sendJson(res, 200, links.names()));
  route('GET', '/api/notes/:id/backlinks', async ({ res, params }) => sendJson(res, 200, links.backlinks(params.id)));
}
