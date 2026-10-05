import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isValidTimeZone } from '../shared/dates.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function loadConfig(env = process.env) {
  const int = (name, def, { min = 0 } = {}) => {
    const raw = env[name];
    if (raw === undefined || raw === '') return def;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < min) throw new Error(`${name} must be an integer >= ${min} (got "${raw}")`);
    return n;
  };

  const tz = env.HOME_TZ || 'America/Edmonton';
  if (!isValidTimeZone(tz)) throw new Error(`HOME_TZ "${tz}" is not a valid IANA time zone`);
  const dataDir = path.resolve(env.DATA_DIR || path.join(root, 'data'));
  // The key for /api/assistant/*. Unset = assistant access is off. Make one with: node server/cli.js token
  const assistantToken = (env.ASSISTANT_TOKEN ?? '').trim();
  if (assistantToken && assistantToken.length < 20) throw new Error('ASSISTANT_TOKEN must be at least 20 characters (make one with: node server/cli.js token)');

  return {
    root,
    port: int('PORT', 8080),
    host: env.HOST || '0.0.0.0',
    dataDir,
    dbFile: path.join(dataDir, 'hq.sqlite'),
    backupDir: path.resolve(env.BACKUP_DIR || path.join(dataDir, 'backups')),
    staticDir: path.resolve(env.STATIC_DIR || path.join(root, 'client', 'dist')),
    tz,
    assistantToken: assistantToken || null,
    // Automatic backups. 0 hours disables the scheduler (manual still works).
    backupIntervalHours: int('BACKUP_INTERVAL_HOURS', 6),
    backupKeepLatest: int('BACKUP_KEEP_LATEST', 6, { min: 1 }),
    backupKeepDaily: int('BACKUP_KEEP_DAILY', 14),
    backupKeepWeekly: int('BACKUP_KEEP_WEEKLY', 8),
    // 0 keeps deleted notes forever.
    trashRetentionDays: int('TRASH_RETENTION_DAYS', 30),
    // A version of the previous content is kept at most this often while
    // editing continues, plus whenever content shrinks sharply.
    versionIntervalMinutes: int('VERSION_INTERVAL_MINUTES', 5),
    versionKeep: int('VERSION_KEEP', 100, { min: 5 }),
    maxBodyBytes: int('MAX_BODY_MB', 100, { min: 1 }) * 1024 * 1024,
  };
}
