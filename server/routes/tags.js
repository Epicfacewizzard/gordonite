// Tags and a tag's stream.
import { sendJson } from '../http.js';
import { checkId } from '../ids.js';

export function registerTagRoutes({ route, store }) {
  route('GET', '/api/tags', async ({ res }) => sendJson(res, 200, { tags: store.listTags(), order: store.getTagOrder() }));
  route('POST', '/api/tags', async ({ res, body }) => sendJson(res, 200, { tag: store.createTag(body.path) }));
  route('POST', '/api/tags/move', async ({ res, body }) => sendJson(res, 200, store.moveTag(body)));
  route('PUT', '/api/tags/:id/daily', async ({ res, params, body }) => {
    sendJson(res, 200, store.setTagDaily(checkId(params.id, 'tag id'), body.daily));
  });
  route('PUT', '/api/tags/:id/favorite', async ({ res, params, body }) => {
    sendJson(res, 200, store.setTagFavorite(checkId(params.id, 'tag id'), body.favorite));
  });
  route('GET', '/api/stream', async ({ res, query }) => {
    sendJson(res, 200, store.stream(query.get('tag') ?? '', { before: query.get('before'), limit: query.get('limit') }));
  });
}
