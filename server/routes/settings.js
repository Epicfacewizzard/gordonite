// What the client asks first: the config (version, time zone, today) and the settings. (Note-name lookups: links.js.)
import { sendJson } from '../http.js';
import { DOC_FORMAT } from '../../shared/doc.js';
import { dateInTz } from '../../shared/dates.js';

export function registerSettingsRoutes({ route, config, store, appVersion }) {
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
}
