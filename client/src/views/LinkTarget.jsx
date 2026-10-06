import { useEffect, useState } from 'preact/hooks';
import { api } from '../api.js';
import { go } from '../hooks.js';

export function LinkTarget({ target }) {
  const [notes, setNotes] = useState(null), [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    api.resolveLink(target).then(({ notes }) => {
      if (!alive) return;
      if (notes.length === 1) go(`/n/${notes[0].id}`);
      else setNotes(notes);
    }).catch((e) => alive && setError(e.message));
    return () => { alive = false; };
  }, [target]);
  return <div>
    <h2>{target}</h2>
    {error ? <p role="alert">{error}</p> : notes === null ? <p>Opening link…</p> : notes.length === 0 ? <p>No saved note matches this name. The original link text has been kept.</p> : <><p>More than one note has this name. Choose which to open:</p>{notes.map((n) => <p key={n.id}><a href={`#/n/${n.id}`}>{n.title} · {n.date}</a></p>)}</>}
    <a href="#/notes">Browse notes</a>
  </div>;
}
