// Runs in a worker thread: turns one HEIC/HEIF photo into a JPEG. Decoding is CPU-heavy (about a second per
// photo, a few hundred MB of memory) so it is kept off the thread that answers requests and saves notes.
import { parentPort, workerData } from 'node:worker_threads';

try {
  const { default: convert } = await import('heic-convert');
  const out = await convert({ buffer: Buffer.from(workerData.buffer), format: 'JPEG', quality: 0.9 });
  parentPort.postMessage({ ok: true, buffer: Buffer.from(out) });
} catch (err) {
  parentPort.postMessage({ ok: false, error: String(err?.message ?? err) });
}
