// What the client asks first: the config (version, time zone, today) and the settings, and note-name lookups.
import { sendJson } from '../http.js';
import { DOC_FORMAT } from '../../shared/doc.js';
import { dateInTz } from '../../shared/dates.js';

export function registerSettingsRoutes({ route, db, config, store, appVersion }) {
  route('GET', '/api/config', async ({ res }) => {
    sendJson(res, 200, {
      version: appVersion,
      tz: config.tz,
      today: dateInTz(new Date(), config.tz),
      docFormat: DOC_FORMAT,
      trashRetentionDays: config.trashRetentionDays,
      ...store.getSettings(),
    });
  });
  route('PUT', '/api/settings', async ({ res, body }) => {
    if (body.tz !== undefined) store.setTimeZone(body.tz);
    if (body.dailyTag !== undefined) store.setDailyTag(body.dailyTag);
    sendJson(res, 200, store.getSettings());
  });

  route('GET', '/api/note-links', async ({ res, query }) => {
    const target = (query.get('target') ?? '').trim();
    // Imported folder-qualified names match the leaf title. Show all matches rather
    // than guessing when names collide; navigation itself uses the stable note ID.
    const title = target.split('#')[0].split('/').at(-1).replace(/\.md$/i, '');
    const notes = db.prepare('SELECT id, title, note_date AS date FROM notes WHERE deleted_at IS NULL AND title = ? COLLATE NOCASE ORDER BY note_date DESC, id').all(title);
    sendJson(res, 200, { notes });
  });
}
