import { useEffect, useRef, useState } from 'preact/hooks';
import { api } from '../api.js';
import { fileHref, formatBytes } from '../../../shared/attachments.js';

const PAGE = 30;
const KINDS = [
  ['', 'All'],
  ['image', 'Images'],
  ['pdf', 'PDFs'],
  ['file', 'Other'],
];
const when = (iso) => new Date(iso).toLocaleDateString('en-CA', { year: 'numeric', month: 'short', day: 'numeric' });
const typeLabel = (f) => (f.kind === 'pdf' ? 'PDF' : (/\.([A-Za-z0-9]{1,5})$/.exec(f.name)?.[1] ?? 'FILE').toUpperCase());

/**
 * Every file stored in Gordonite (photos, PDFs, documents), newest first. Files can be added here without a note,
 * which makes this the in-app inbox: an assistant (or you) can later attach them to a note. Removing a file hides
 * it everywhere; notes that showed it then show it as missing.
 */
export function FilesView() {
  const [q, setQ] = useState('');
  const [kind, setKind] = useState('');
  const [loose, setLoose] = useState(false); // only files that are not in any note yet
  const [list, setList] = useState({ status: 'loading', files: [], hasMore: false, error: null, total: null });
  const [busy, setBusy] = useState(0);
  const [message, setMessage] = useState(null);
  const [confirming, setConfirming] = useState(null);
  const run = useRef(0);
  const picker = useRef(null);

  const load = async ({ append = false } = {}) => {
    const mine = ++run.current;
    if (!append) setList((l) => ({ ...l, status: l.files.length ? 'ready' : 'loading', error: null }));
    try {
      const offset = append ? list.files.length : 0;
      const res = await api.files({ q: q.trim(), kind, unattached: loose, limit: PAGE, offset });
      if (mine !== run.current) return;
      setList((l) => ({ status: 'ready', files: append ? [...l.files, ...res.attachments] : res.attachments, hasMore: res.hasMore, error: null, total: res.total }));
    } catch (err) {
      if (mine === run.current) setList((l) => ({ ...l, status: 'error', error: err.message }));
    }
  };

  useEffect(() => {
    const t = setTimeout(load, q ? 250 : 0); // wait for the typing to pause
    return () => clearTimeout(t);
  }, [q, kind, loose]);

  const upload = async (picked) => {
    const files = [...picked];
    if (!files.length) return;
    setMessage(null);
    setBusy(files.length);
    const failed = [];
    for (const file of files) {
      try {
        await api.uploadFile(file);
      } catch (err) {
        failed.push(`${file.name}: ${err.message}`);
      }
      setBusy((n) => n - 1);
    }
    setMessage(failed.length ? { error: true, text: `Could not add: ${failed.join('; ')}` } : { text: files.length === 1 ? 'File added.' : `${files.length} files added.` });
    load();
  };

  const remove = async (file) => {
    try {
      await api.deleteFile(file.id);
      setConfirming(null);
      setMessage({ text: `Removed ${file.name}.` });
      load();
    } catch (err) {
      setMessage({ error: true, text: err.message });
    }
  };

  return (
    <div class="files" data-testid="files">
      <p class="muted">
        Photos, PDFs and documents. Add them to a note with the paperclip while writing, or add them here and attach them later.
      </p>
      <div class="row">
        <button type="button" class="btn primary" data-testid="files-add" disabled={busy > 0} onClick={() => picker.current?.click()}>
          {busy > 0 ? `Uploading ${busy}…` : 'Add files'}
        </button>
        <input ref={picker} type="file" multiple hidden data-testid="files-input" onChange={(e) => { const picked = [...e.currentTarget.files]; e.currentTarget.value = ''; upload(picked); }} />
      </div>
      {message && (
        <p class={message.error ? 'error' : 'muted'} role={message.error ? 'alert' : 'status'} data-testid="files-message">
          {message.text}
        </p>
      )}

      <div class="notes-filters">
        <input
          type="search"
          placeholder="Search file names"
          aria-label="Search file names"
          autocapitalize="none"
          autocomplete="off"
          data-testid="files-search"
          value={q}
          onInput={(e) => setQ(e.currentTarget.value)}
        />
      </div>
      <nav class="filter-row" aria-label="Kind of file">
        {KINDS.map(([id, label]) => (
          <button key={id || 'all'} type="button" class="link" aria-pressed={kind === id} onClick={() => setKind(id)}>
            {label}
          </button>
        ))}
      </nav>
      <label class="check-row small">
        <input type="checkbox" checked={loose} onChange={(e) => setLoose(e.currentTarget.checked)} data-testid="files-loose" />
        <span>Only files not in a note yet</span>
      </label>

      {list.status === 'error' && (
        <div class="banner error" role="alert">
          <span>Can’t reach the server: {list.error}</span>
          <button type="button" class="btn" onClick={() => load()}>Retry</button>
        </div>
      )}
      {list.status === 'loading' && <p class="muted center">Loading…</p>}
      {list.status === 'ready' && list.files.length === 0 && (
        <p class="muted center" data-testid="files-empty">{q || kind || loose ? 'No files match.' : 'No files yet.'}</p>
      )}

      <ul class="file-list" data-testid="file-list">
        {list.files.map((f) => (
          <li key={f.id} class="file-row" data-file-id={f.id}>
            <a class="file-thumb" href={fileHref(f.id)} target="_blank" rel="noopener" aria-label={`Open ${f.name}`}>
              {f.kind === 'image' ? <img src={fileHref(f.id)} alt="" loading="lazy" decoding="async" /> : <span class="attachment-type">{typeLabel(f)}</span>}
            </a>
            <div class="file-info">
              <a class="file-name" href={fileHref(f.id)} target="_blank" rel="noopener">{f.name}</a>
              <span class="muted small">
                {formatBytes(f.size)} · {when(f.createdAt)}
                {f.converted ? ' · converted from HEIC' : ''}
                {f.noteId ? <> · <a href={`#/n/${f.noteId}`} data-testid="file-note">in a note</a></> : ' · not in a note'}
              </span>
              {confirming === f.id ? (
                <span class="file-confirm">
                  Remove it? Notes that show it will show it as missing.
                  <button type="button" class="btn" data-testid="file-remove-confirm" onClick={() => remove(f)}>Remove</button>
                  <button type="button" class="btn" onClick={() => setConfirming(null)}>Keep</button>
                </span>
              ) : (
                <span class="file-actions">
                  <a class="link" href={`${fileHref(f.id)}?download=1`} download={f.name}>Download</a>
                  {f.converted && <a class="link" href={`/api/attachments/${f.id}/original`}>Original</a>}
                  <button type="button" class="link" data-testid="file-remove" onClick={() => setConfirming(f.id)}>Remove</button>
                </span>
              )}
            </div>
          </li>
        ))}
      </ul>
      {list.hasMore && (
        <button type="button" class="btn block" data-testid="files-more" onClick={() => load({ append: true })}>
          Show more
        </button>
      )}
      {list.total && list.total.count > 0 && (
        <p class="muted small center">{list.total.count} file{list.total.count === 1 ? '' : 's'}, {formatBytes(list.total.bytes)} in all</p>
      )}
    </div>
  );
}
