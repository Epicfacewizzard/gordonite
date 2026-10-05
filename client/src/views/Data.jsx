import { useEffect, useState } from 'preact/hooks';
import { api } from '../api.js';

const when = (iso) => (iso ? new Date(iso).toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' }) : 'never');
const size = (b) => (b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

export function DataView({ config }) {
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState('merge');
  const [report, setReport] = useState(null);

  const load = () =>
    api
      .backups()
      .then(setStatus)
      .catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, []);

  const backupNow = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.backupNow();
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const importFile = async (e) => {
    const file = e.currentTarget.files?.[0];
    e.currentTarget.value = '';
    if (!file) return;
    if (
      mode === 'replace' &&
      !confirm('Replace ALL notes on the server with the contents of this file?\n\nA backup of the current data is taken first.')
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    setReport(null);
    try {
      const data = JSON.parse(await file.text());
      setReport(await api.importAll(data, mode));
      await load();
    } catch (err) {
      setError(err instanceof SyntaxError ? 'That file is not valid JSON.' : err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="data">
      {error && <p class="error" role="alert">{error}</p>}

      <section>
        <h2 class="section">Server backups</h2>
        <p class="muted">
          Consistent snapshots of the whole database, verified after writing. A backup on the same server is not enough: copy them elsewhere (see the README).
        </p>
        <dl class="facts">
          <dt>Last successful backup</dt>
          <dd data-testid="last-backup">{when(status?.lastSuccessAt)}</dd>
          {status?.lastError && (
            <>
              <dt>Last error</dt>
              <dd class="error">{status.lastError}</dd>
            </>
          )}
          <dt>Stored in</dt>
          <dd>
            <code>{status?.dir}</code>
          </dd>
        </dl>
        <div class="row">
          <button type="button" class="btn primary" disabled={busy} onClick={backupNow} data-testid="backup-now">
            Back up now
          </button>
          <a class="btn" href="/api/backups/snapshot" download>
            Download a fresh copy
          </a>
        </div>
        <ul class="plain" data-testid="backup-list">
          {status?.backups.map((b) => (
            <li key={b.file}>
              <a href={`/api/backups/file/${b.file}`} download>
                {b.file}
              </a>{' '}
              <span class="muted small">{size(b.size)}</span>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 class="section">Export</h2>
        <p class="muted">
          <strong>Full backup (JSON)</strong> keeps everything, including task ids, history and the trash, and can be imported again. <strong>Markdown</strong> is for reading and other tools: one file per tag per day.
        </p>
        <div class="row">
          <a class="btn" href="/api/export/json" download data-testid="export-json">
            Full backup (JSON)
          </a>
          <a class="btn" href="/api/export/markdown" download data-testid="export-md">
            Markdown (zip)
          </a>
        </div>
      </section>

      <section>
        <h2 class="section">Import a JSON backup</h2>
        <fieldset class="choices">
          <label>
            <input type="radio" name="mode" checked={mode === 'merge'} onChange={() => setMode('merge')} /> Merge: add missing notes, never overwrite
          </label>
          <label>
            <input type="radio" name="mode" checked={mode === 'replace'} onChange={() => setMode('replace')} /> Replace everything (a backup is taken first)
          </label>
        </fieldset>
        <input type="file" accept="application/json,.json" onChange={importFile} disabled={busy} data-testid="import-file" aria-label="Choose a JSON backup file" />
        {report && (
          <pre class="report" data-testid="import-report">
            {JSON.stringify(report, null, 2)}
          </pre>
        )}
      </section>

      <section>
        <h2 class="section">About</h2>
        <dl class="facts">
          <dt>Version</dt>
          <dd>{config.version}</dd>
          <dt>Home time zone</dt>
          <dd>{config.tz}</dd>
        </dl>
      </section>
    </div>
  );
}
