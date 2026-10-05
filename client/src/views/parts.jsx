import { useEffect, useRef, useState } from 'preact/hooks';
import { useSession } from '../hooks.js';

export const STATUS_TEXT = {
  saved: 'Saved on server',
  saving: 'Saving…',
  pending: 'Pending on phone',
  offline: 'Pending on phone · offline',
  failed: 'Save failed · kept on phone',
  conflict: 'Conflict · both versions kept',
};

export function Sheet({ title, onClose, children }) {
  const ref = useRef(null);
  useEffect(() => {
    ref.current?.focus();
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
  return (
    <div class="sheet-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div class="sheet" role="dialog" aria-modal="true" aria-label={title} ref={ref} tabIndex={-1}>
        <div class="sheet-head">
          <h2>{title}</h2>
          <button type="button" class="btn ghost" onClick={onClose} aria-label="Close">
            Close
          </button>
        </div>
        <div class="sheet-body">{children}</div>
      </div>
    </div>
  );
}

const CONFLICT_TEXT = {
  revision: 'This note was changed somewhere else while you were writing. Your text is kept on the server and on this phone. Choose what this note should contain now; the other version stays in History.',
  deleted: 'This note was moved to the trash while you were writing. Your text is kept. Restore the note with your text, or leave it in the trash.',
  slot: 'A note for this tag and day was already created somewhere else. Your text is kept in that note’s History. Combine the two, or keep only that note.',
};

export function ConflictPanel({ session, onResolved }) {
  useSession(session);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const { reason } = session.conflict;

  const act = (fn) => async () => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onResolved?.();
    } catch (err) {
      setError(err.message ?? String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="conflict" role="alert" data-testid="conflict-panel" data-reason={reason}>
      <strong>Two versions of this note exist</strong>
      <p>{CONFLICT_TEXT[reason]}</p>
      <div class="conflict-actions">
        {reason === 'revision' && (
          <>
            <button type="button" class="btn" disabled={busy} data-testid="resolve-combine" onClick={act(() => session.resolveCombine())}>
              Combine both
            </button>
            <button type="button" class="btn" disabled={busy} data-testid="resolve-mine" onClick={act(() => session.resolveKeepMine())}>
              Use my text
            </button>
            <button type="button" class="btn" disabled={busy} data-testid="resolve-server" onClick={act(async () => session.resolveUseServer())}>
              Use the other version
            </button>
          </>
        )}
        {reason === 'deleted' && (
          <>
            <button type="button" class="btn" disabled={busy} data-testid="resolve-mine" onClick={act(() => session.resolveKeepMine())}>
              Restore note with my text
            </button>
            <button type="button" class="btn" disabled={busy} data-testid="resolve-server" onClick={act(async () => session.resolveUseServer())}>
              Leave it in the trash
            </button>
          </>
        )}
        {reason === 'slot' && (
          <>
            <button type="button" class="btn" disabled={busy} data-testid="resolve-combine" onClick={act(() => session.resolveCombine())}>
              Combine into that note
            </button>
            <button type="button" class="btn" disabled={busy} data-testid="resolve-server" onClick={act(async () => session.resolveUseServer())}>
              Keep only that note
            </button>
          </>
        )}
      </div>
      {error && <p class="error">{error}</p>}
    </div>
  );
}
