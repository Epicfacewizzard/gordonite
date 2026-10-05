import fs from 'node:fs';
import { loadConfig } from './config.js';
import { openDb } from './db.js';
import { createApp, APP_VERSION } from './app.js';
import { BackupScheduler } from './backup.js';

const config = loadConfig();

// The classic container mistake: a volume the app's user cannot write to. Say so plainly.
for (const dir of [config.dataDir, config.backupDir]) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.accessSync(dir, fs.constants.W_OK);
  } catch (err) {
    console.error(`Cannot write to ${dir}: ${err.message}`);
    console.error(`The app runs as uid ${process.getuid?.() ?? '?'}. Make the folder writable for that user (see README, "Permissions").`);
    process.exit(1);
  }
}

const db = openDb(config.dbFile);
const { server, store } = createApp({ config, db });
const scheduler = new BackupScheduler(db, config, store);

server.listen(config.port, config.host, () => {
  console.log(`Personal HQ ${APP_VERSION} listening on http://${config.host}:${config.port}`);
  console.log(`  data:    ${config.dbFile}`);
  console.log(`  backups: ${config.backupDir} (${config.backupIntervalHours ? `every ${config.backupIntervalHours} h` : 'automatic backups off'})`);
  console.log(`  home timezone: ${config.tz}`);
});
scheduler.start();

let closing = false;
function shutdown(signal) {
  if (closing) return;
  closing = true;
  console.log(`${signal} received, shutting down`);
  scheduler.stop();
  server.close(() => {
    try {
      db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
      db.close();
    } catch (err) {
      console.error('error while closing database:', err);
    }
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 8000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
