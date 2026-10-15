import { useEffect, useRef, useState } from 'preact/hooks';
import { api, NetworkError } from '../api.js';
import { sync } from '../sync.js';
import { shareStore, shareToNote, shareIsEmpty } from '../share.js';
import { dateInTz } from '../../../shared/dates.js';

/**
 * #/share/<id> (or #/share for the oldest waiting share): what another app shared to Gordonite becomes a new free
 * note, opened on its own page. The service worker has already kept the share on this phone; it is deleted only
 * once the note is held here like typed text. Files go to the server first, so with the server out of reach the
 * share waits (with Try again) instead of being lost. The redirect replaces this address, so Back skips it.
 */
export function ShareView({ id, config }) {
  const [state, setState] = useState({ step: 'working' });
  const session = useRef(null); // one note for this share, kept across retries
  const stored = useRef(new Map()); // file index -> stored attachment, so a retry only sends what is missing

  const run = async () => {
    setState({ step: 'working' });
    try {
      await sync.ready;
      if (id === 'failed') return setState({ step: 'error', message: 'Gordonite could not keep what was shared. Try sharing it again.' });
      const share = id ? await shareStore.get(id) : (await shareStore.all())[0];
      if (!share) return setState({ step: 'empty' });
      if (shareIsEmpty(share)) {
        await shareStore.delete(share.id);
        return setState({ step: 'empty' });
      }
      session.current ??= sync.newNote(dateInTz(new Date(), config.tz), []);
      const files = share.files ?? [];
      const failed = [];
      for (const [i, file] of files.entries()) {
        if (stored.current.has(i)) continue;
        setState({ step: 'working', detail: `Sending ${file.name || 'file'} (${i + 1} of ${files.length})…` });
        try {
          stored.current.set(i, (await api.uploadFile(file, { noteId: session.current.id })).attachment);
        } catch (err) {
          if (err instanceof NetworkError) {
            return setState({ step: 'error', share, offline: true, message: 'Can’t reach the server. What you shared is kept on this phone: connect (WireGuard on) and try again.' });
          }
          failed.push(`${file.name || 'file'}: ${err.message}`);
        }
      }
      if (failed.length) return setState({ step: 'error', share, message: `Some files were not stored. ${failed.join('; ')}` });

      const { title, doc } = shareToNote(share, files.map((_, i) => stored.current.get(i)));
      await session.current.fill(doc, title);
      if (session.current.localError) {
        return setState({ step: 'error', share, message: 'This phone could not store the note. What you shared is still kept; try again.' });
      }
      await shareStore.delete(share.id);
      location.replace(`#/n/${session.current.id}`);
    } catch (err) {
      setState({ step: 'error', message: err?.message ?? String(err) });
    }
  };

  useEffect(() => {
    run();
  }, [id]);

  // Coming back online retries by itself.
  useEffect(() => {
    if (!state.offline) return;
    window.addEventListener('online', run);
    return () => window.removeEventListener('online', run);
  }, [state.offline]);

  const discard = async () => {
    await shareStore.delete(state.share.id).catch(() => {});
    location.replace('#/');
  };

  if (state.step === 'working') return <p class="muted center" data-testid="share-working">{state.detail ?? 'Adding what you shared…'}</p>;
  if (state.step === 'empty') {
    return (
      <p class="muted center" data-testid="share-empty">
        Nothing shared is waiting. If you just shared something, open Gordonite once from its icon (so it can set itself up) and share again.
      </p>
    );
  }
  return (
    <div class="banner error" role="alert" data-testid="share-error">
      <span>{state.message}</span>
      {state.share && (
        <>
          <button type="button" class="btn" onClick={run} data-testid="share-retry">
            Try again
          </button>
          <button type="button" class="btn ghost" onClick={discard} data-testid="share-discard">
            Discard
          </button>
        </>
      )}
    </div>
  );
}

/** On the Dashboard: shares that are still waiting to become notes (shared while the server was out of reach). */
export function WaitingShares() {
  const [count, setCount] = useState(0);
  useEffect(() => {
    shareStore.all().then((all) => setCount(all.length), () => {});
  }, []);
  if (!count) return null;
  return (
    <div class="banner" role="status" data-testid="shares-waiting">
      <span>{count === 1 ? 'Something you shared is waiting to become a note.' : `${count} things you shared are waiting to become notes.`}</span>
      <a class="btn" href="#/share">
        Add now
      </a>
    </div>
  );
}
