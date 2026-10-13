import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { api } from '../api.js';
import { sync } from '../sync.js';
import { useSession, useToday } from '../hooks.js';
import { formatDateShort } from '../../../shared/dates.js';
import { NoteCard } from './NoteCard.jsx';
import { EditorBar } from './EditorBar.jsx';
import { appendUnique } from '../paging.js';

const isEditingNow = () => !!document.activeElement?.closest?.('.note-text');

export function StreamView({ tag, config }) {
  useSession(); // any session change (save status, new unsent notes)
  const today = useToday(config.tz);
  const [shownToday, setShownToday] = useState(today);
  const [newDay, setNewDay] = useState(false);
  const [load, setLoad] = useState({ status: 'loading', notes: [], hasMore: false, error: null, daily: true, tagId: null });
  const [activeId, setActiveId] = useState(null);
  const [focusRequest, setFocusRequest] = useState(null);
  const [editor, setEditor] = useState(null);
  const [, refresh] = useState(0);
  const [olderBusy, setOlderBusy] = useState(false);
  const generation = useRef(0);
  const olderRunning = useRef(false);

  // Crossing midnight never moves or interrupts writing: if the keyboard is up in a
  // note, only offer the new day; otherwise show it right away.
  useEffect(() => {
    if (today === shownToday) return;
    if (isEditingNow()) setNewDay(true);
    else setShownToday(today);
  }, [today]);

  const fetchFirst = useCallback(async () => {
    const mine = ++generation.current;
    setLoad((l) => ({ ...l, status: l.notes.length ? 'ready' : 'loading', error: null }));
    try {
      await sync.ready;
      const res = await api.stream(tag);
      if (mine !== generation.current) return;
      res.notes.forEach((n) => sync.adopt(n));
      setLoad({ status: 'ready', notes: res.notes.map((n) => n.id), hasMore: res.hasMore, error: null, daily: res.tag.daily, tagId: res.tag.id });
    } catch (err) {
      if (mine === generation.current) setLoad((l) => ({ ...l, status: 'error', error: err.message }));
    }
  }, [tag]);

  useEffect(() => {
    setLoad({ status: 'loading', notes: [], hasMore: false, error: null, daily: true, tagId: null });
    setActiveId(null);
    fetchFirst();
  }, [tag]);

  // One request for the next days at a time, and an answer that arrives after the stream was reloaded is dropped.
  const loadMore = async () => {
    if (olderRunning.current) return;
    olderRunning.current = true;
    setOlderBusy(true);
    const mine = generation.current;
    const last = sync.get(load.notes[load.notes.length - 1]);
    try {
      const res = await api.stream(tag, last.date);
      if (mine !== generation.current) return;
      res.notes.forEach((n) => sync.adopt(n));
      setLoad((l) => ({ ...l, notes: appendUnique(l.notes, res.notes.map((n) => n.id), (id) => id), hasMore: res.hasMore }));
    } catch (err) {
      setLoad((l) => ({ ...l, error: err.message }));
    } finally {
      olderRunning.current = false;
      setOlderBusy(false);
    }
  };

  // Everything shown, newest first: notes from the server, plus notes of this tag created
  // or edited on this phone in the loaded date range, plus today's (possibly empty) entry.
  const entries = (() => {
    if (load.status === 'loading') return [];
    const byId = new Map();
    for (const id of load.notes) {
      const s = sync.get(id);
      if (s && s.tags.includes(tag) && !s.discarded) byId.set(id, s);
    }
    const oldest = load.notes.length ? sync.get(load.notes[load.notes.length - 1])?.date : null;
    for (const s of sync.sessions.values()) {
      if (byId.has(s.id) || s.discarded || !s.tags.includes(tag)) continue;
      const touched = s.revision === 0 ? !!s.pending : true;
      const inWindow = !load.hasMore || (oldest && s.date >= oldest);
      if (touched && inWindow && (s.pending || s.drafted)) byId.set(s.id, s);
    }
    // A tag with its daily entry switched off shows only the notes written in it (and any daily entries it already has).
    const existingToday = [...byId.values()].find((s) => s.date === shownToday && s.kind === 'daily');
    const todaySession = existingToday ?? (load.daily ? sync.draft(tag, shownToday) : null);
    if (todaySession) byId.set(todaySession.id, todaySession);
    // Newest day first; within a day the daily entry, then free notes newest first.
    const rank = (x) => (x.kind === 'daily' ? 0 : 1);
    return [...byId.values()].sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      if (rank(a) !== rank(b)) return rank(a) - rank(b);
      return a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0;
    });
  })();
  // Remember which sessions were created for this stream so they stay listed after saving.
  entries.forEach((s) => (s.drafted = true));

  const todayEntry = entries.find((s) => s.date === shownToday && s.kind === 'daily');
  const effectiveActive = activeId ?? todayEntry?.id;

  const activate = (id, req) => {
    setActiveId(id);
    setFocusRequest(req ? { ...req, n: Date.now() } : null);
  };

  const startNewDay = () => {
    setShownToday(today);
    setNewDay(false);
    const s = sync.draft(tag, today);
    activate(s.id, {});
  };

  // Switch the daily entry for this tag on or off (a tag that has no notes yet is created first).
  const toggleDaily = async () => {
    const next = !load.daily;
    setLoad((l) => ({ ...l, daily: next }));
    try {
      let id = load.tagId;
      if (!id) id = (await api.createTag(tag)).tag.id;
      await api.setDaily(id, next);
      setLoad((l) => ({ ...l, tagId: id }));
    } catch (err) {
      setLoad((l) => ({ ...l, daily: !next, error: err.message }));
    }
  };

  const newNoteButton = (
    <a class="btn block" href={`#/new?tag=${encodeURIComponent(tag).replaceAll('%2F', '/')}`} data-testid="new-note-here">
      New note in “{tag}”
    </a>
  );

  const changed = () => {
    refresh((n) => n + 1);
    fetchFirst();
  };

  return (
    <div class="stream" data-testid="stream" data-tag={tag}>
      {newDay && (
        <div class="banner" role="status">
          <span>It is now {formatDateShort(today)}.</span>
          <button type="button" class="btn" data-testid="new-day" onClick={startNewDay}>
            Start today’s note
          </button>
        </div>
      )}
      {load.status === 'error' && (
        <div class="banner error" role="alert" data-testid="load-error">
          <span>Can’t reach the server: {load.error}. Text already typed on this phone is safe.</span>
          <button type="button" class="btn" onClick={fetchFirst}>
            Retry
          </button>
        </div>
      )}
      {load.status === 'loading' && <p class="muted center">Loading…</p>}
      {!load.daily && newNoteButton}
      {entries.map((s) => (
        <NoteCard
          key={s.id}
          session={s}
          tag={tag}
          today={today}
          tz={config.tz}
          active={s.id === effectiveActive}
          focusRequest={s.id === effectiveActive ? focusRequest : null}
          onActivate={activate}
          onChanged={changed}
          onEditor={s.id === effectiveActive ? setEditor : undefined}
        />
      ))}
      {load.daily && newNoteButton}
      {load.hasMore && (
        <button type="button" class="btn block" data-testid="load-older" disabled={olderBusy} onClick={loadMore}>
          {olderBusy ? 'Loading…' : 'Load older notes'}
        </button>
      )}
      {load.status === 'ready' && !load.hasMore && load.daily && entries.length <= 1 && (
        <p class="muted center">Notes you write here are saved by day under “{tag}”.</p>
      )}
      {load.status === 'ready' && !load.daily && entries.length === 0 && (
        <p class="muted center" data-testid="no-notes">
          No notes in “{tag}” yet.
        </p>
      )}
      {load.status === 'ready' && (
        <label class="check-row small daily-toggle">
          <input type="checkbox" checked={load.daily} onChange={toggleDaily} data-testid="daily-toggle" />
          <span>Show an entry for today in “{tag}” (turn off for a topic you only write notes in)</span>
        </label>
      )}
      <div class="toolbar-spacer" />
      <EditorBar editor={editor} noteDate={sync.get(effectiveActive)?.date} today={today} />
    </div>
  );
}
