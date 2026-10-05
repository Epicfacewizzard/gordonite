import { useEffect, useState } from 'preact/hooks';
import { api } from '../api.js';
import { renderDoc } from '../editor/render.js';
import { formatDateShort } from '../../../shared/dates.js';

const when = (iso) => new Date(iso).toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' });

export function TrashView({ config }) {
  const [notes, setNotes] = useState(null);
  const [error, setError] = useState(null);
  const [messages, setMessages] = useState({});

  const load = () =>
    api
      .trash()
      .then((r) => setNotes(r.notes))
      .catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, []);

  const restore = async (n, drop = false) => {
    try {
      const res = await api.restoreNote(n.id, drop);
      setMessages((m) => ({
        ...m,
        [n.id]: { ok: true, text: res.droppedTags.length ? `Restored without: ${res.droppedTags.join(', ')}` : 'Restored' },
      }));
      load();
    } catch (err) {
      setMessages((m) => ({ ...m, [n.id]: { ok: false, text: err.message, canDrop: err.body?.error?.canDrop } }));
    }
  };

  return (
    <div class="trash">
      <p class="muted">
        Deleted notes stay here for {config.trashRetentionDays ? `${config.trashRetentionDays} days` : 'ever'} and can be restored with their full text and history.
      </p>
      {error && <p class="error" role="alert">{error}</p>}
      {notes?.length === 0 && <p class="muted center">The trash is empty.</p>}
      <ul class="trash-list" data-testid="trash-list">
        {notes?.map((n) => (
          <li key={n.id} class="note" data-note-id={n.id}>
            <header class="note-head">
              <h2 class="note-date">{formatDateShort(n.date)}</h2>
              <span class="muted small">deleted {when(n.deletedAt)}</span>
            </header>
            <p class="muted small">{n.tags.map((t) => t.path).join(' · ')}</p>
            <details>
              <summary>Show text</summary>
              <div class="static" dangerouslySetInnerHTML={{ __html: renderDoc(n.doc) }} />
            </details>
            <div class="row">
              <button type="button" class="btn primary" data-testid="restore-note" onClick={() => restore(n)}>
                Restore
              </button>
              {messages[n.id]?.canDrop && (
                <button type="button" class="btn" onClick={() => restore(n, true)}>
                  Restore without those tags
                </button>
              )}
            </div>
            {messages[n.id] && <p class={messages[n.id].ok ? 'muted' : 'error'}>{messages[n.id].text}</p>}
          </li>
        ))}
      </ul>
    </div>
  );
}
