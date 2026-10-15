// Builds the service worker (client/sw.js) into dist/sw.js with the list of files it keeps a copy of.
// Every build gets a new cache name, so the phone picks up the new version and drops the old copy.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/** What the service worker keeps: the page, every built file except source maps, and the files in public/. */
export function precacheList(bundleFiles, publicFiles) {
  const files = ['/', ...[...bundleFiles, ...publicFiles].filter((f) => !f.endsWith('.map') && f !== 'index.html' && f !== 'sw.js').map((f) => `/${f}`)];
  const unique = [...new Set(files)].sort();
  const name = `gordonite-${crypto.createHash('sha256').update(unique.join('\n')).digest('hex').slice(0, 12)}`;
  return { name, files: unique };
}

export function serviceWorker() {
  let publicDir;
  return {
    name: 'gordonite-service-worker',
    apply: 'build',
    configResolved(config) {
      publicDir = config.publicDir;
    },
    generateBundle(_options, bundle) {
      const publicFiles = publicDir && fs.existsSync(publicDir) ? fs.readdirSync(publicDir) : [];
      const precache = precacheList(Object.keys(bundle), publicFiles);
      const source = fs.readFileSync(path.join(here, 'sw.js'), 'utf8').replace('self.__GORDONITE_PRECACHE__', JSON.stringify(precache));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}
