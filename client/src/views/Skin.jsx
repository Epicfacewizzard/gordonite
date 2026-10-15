import { useEffect, useState } from 'preact/hooks';
import { entryText, entryIsEmpty, monthTitle, qualifiersFor, reassessedText, NO_IRRITATION } from '../../../shared/skin.js';
import { dateInTz } from '../../../shared/dates.js';
import { addSkinEntry, editSkinEntry, deleteSkinEntry, reassessSkinEntry, getLists, addToList, getRecent, rememberRecent, picksOf, recentEntries, skinQueue } from '../skin-log.js';

// #/skin: a quick skin-log entry, picked like a charting flowsheet (see docs/SKIN-LOG.md). Date and time start at now;
// what is picked is shown as the line it will become, and "Add to skin log" puts that line into the month's note and
// saves the entry itself. Below: recent entries, each with Edit (the form comes back with what was picked) and
// Reassess (how it responded and how the skin is now, added to the end of that entry's own line).

const SEVERITIES = [
  [null, 'Not rated'],
  ['mild', 'Mild'],
  ['moderate', 'Moderate'],
  ['severe', 'Severe'],
];
const SIDES = [
  ['left', 'L'],
  ['right', 'R'],
  ['bilateral', 'Both'],
];
const ASPECTS = [
  ['anterior', 'Ant'],
  ['posterior', 'Post'],
];

const nowTime = (tz) => new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date());
const blank = () => ({ symptoms: [], severity: null, areas: [], where: {}, products: [], response: [], triggers: [], comment: '', reassessments: [] });
const withoutTime = (line) => line.replace(/^\d{3,4}:\s*/, '');
const toInputTime = (hhmm) => (hhmm && hhmm.length === 4 ? `${hhmm.slice(0, 2)}:${hhmm.slice(2)}` : '');
const shortDate = (date) => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;

function Picks({ kind, label, items, picked, onToggle, onAdd }) {
  const [adding, setAdding] = useState(false);
  const [word, setWord] = useState('');
  const [more, setMore] = useState(false);
  const finish = (e) => {
    e.preventDefault();
    if (word.trim()) onAdd(word.trim());
    setWord('');
    setAdding(false);
  };
  // behind "More": shown when opened, and any of them that is picked always shows
  const extra = more ? items.more : items.more.filter((w) => picked.includes(w));
  const custom = picked.filter((w) => !items.common.includes(w) && !items.more.includes(w)); // e.g. from an older entry
  const chip = (item) => (
    <button key={item} type="button" class="pick-chip" aria-pressed={picked.includes(item)} onClick={() => onToggle(item)}>
      {item}
    </button>
  );
  return (
    <fieldset class="skin-group" data-testid={`skin-${kind}`}>
      <legend>{label}</legend>
      <div class="pick-chips">
        {items.common.map(chip)}
        {extra.map(chip)}
        {custom.map(chip)}
        {items.more.length > 0 && (
          <button type="button" class="pick-chip add" aria-expanded={more} onClick={() => setMore(!more)} data-testid={`skin-${kind}-more`}>
            {more ? 'Less' : 'More…'}
          </button>
        )}
        {adding ? (
          <form class="pick-add" onSubmit={finish}>
            <input value={word} onInput={(e) => setWord(e.currentTarget.value)} placeholder="Add…" aria-label={`Add to ${label}`} autoFocus onBlur={finish} />
          </form>
        ) : (
          <button type="button" class="pick-chip add" onClick={() => setAdding(true)} aria-label={`Add to ${label}`}>
            +
          </button>
        )}
      </div>
    </fieldset>
  );
}

function Choice({ label, options, value, onChange, testid }) {
  return (
    <div class="skin-choice">
      <span class="skin-choice-label">{label}</span>
      <div class="segmented" role="radiogroup" aria-label={label} data-testid={testid}>
        {options.map(([v, name]) => (
          <button key={name} type="button" role="radio" aria-checked={value === v} onClick={() => onChange(v)}>
            {name}
          </button>
        ))}
      </div>
    </div>
  );
}

// For each picked area that can have them: its side and aspect, as small toggles (tap again to clear).
function AreaPlaces({ areas, where, onChange }) {
  const rows = areas.map((a) => [a, qualifiersFor(a)]).filter(([, q]) => q.side || q.aspect);
  if (!rows.length) return null;
  const toggle = (area, key, value) => onChange(area, key, value);
  return (
    <div class="skin-places" data-testid="skin-places">
      {rows.map(([area, q]) => (
        <div key={area} class="skin-place" data-area={area}>
          <span class="skin-place-name">{area}</span>
          {q.side && (
            <div class="segmented" role="group" aria-label={area + ': side'}>
              {SIDES.map(([v, name]) => (
                <button key={v} type="button" aria-pressed={where[area]?.side === v} onClick={() => toggle(area, 'side', v)}>
                  {name}
                </button>
              ))}
            </div>
          )}
          {q.aspect && (
            <div class="segmented" role="group" aria-label={area + ': aspect'}>
              {ASPECTS.map(([v, name]) => (
                <button key={v} type="button" aria-pressed={where[area]?.aspect === v} onClick={() => toggle(area, 'aspect', v)}>
                  {name}
                </button>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function RecentEntries({ entries, onEdit, onReassess, active }) {
  if (!entries.length) return null;
  return (
    <section class="skin-entries" data-testid="skin-entries">
      <h2 class="section">Recent entries</h2>
      <ul>
        {entries.slice(0, 15).map((e) => (
          <li key={e.id} class={active === e.id ? 'active' : ''} data-testid="skin-entry">
            <div class="skin-entry-text">
              <span class="muted small">
                {shortDate(e.date)}
                {e.followsId ? ' · reassessment' : ''}
                {e.waiting ? ' · waiting to be sent' : ''}
              </span>
              <span>{e.text}</span>
              {e.error && (
                <span class="error small">
                  Not saved: {e.error}{' '}
                  <button type="button" class="link" onClick={() => skinQueue.retry(e.id)}>
                    Try again
                  </button>
                </span>
              )}
            </div>
            <div class="skin-entry-actions">
              <button type="button" class="btn ghost" onClick={() => onEdit(e)} data-testid="skin-entry-edit">
                Edit
              </button>
              <button type="button" class="btn ghost" onClick={() => onReassess(e)} data-testid="skin-entry-reassess">
                Reassess
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function SkinView({ config }) {
  const [date, setDate] = useState(() => dateInTz(new Date(), config.tz));
  const [time, setTime] = useState(() => nowTime(config.tz));
  const [entry, setEntry] = useState(blank);
  const [mode, setMode] = useState({ kind: 'new' }); // { kind: 'new' } | { kind: 'edit', of } | { kind: 'reassess', of }
  const [lists, setLists] = useState(getLists);
  const [recent, setRecent] = useState(getRecent);
  const [entries, setEntries] = useState([]);
  const [state, setState] = useState({ busy: false, done: null, error: null });

  const loadEntries = () => recentEntries().then(setEntries, () => {});
  useEffect(() => {
    loadEntries();
    return skinQueue.subscribe(loadEntries);
  }, []);

  const toggle = (kind) => (item) => setEntry((e) => ({ ...e, [kind]: e[kind].includes(item) ? e[kind].filter((x) => x !== item) : [...e[kind], item] }));
  const add = (kind) => (word) => {
    setLists(addToList(kind, word));
    setEntry((e) => ({ ...e, [kind]: e[kind].includes(word) ? e[kind] : [...e[kind], word] }));
  };
  const set = (key) => (value) => setEntry((e) => ({ ...e, [key]: value }));
  const toNow = () => {
    setDate(dateInTz(new Date(), config.tz));
    setTime(nowTime(config.tz));
  };
  const startNew = () => {
    setMode({ kind: 'new' });
    setEntry(blank());
    toNow();
  };
  const reuse = (picks) => {
    startNew();
    setEntry({ ...blank(), ...picks });
    setState({ busy: false, done: null, error: null });
  };
  const edit = (e) => {
    setMode({ kind: 'edit', of: e });
    setEntry({ ...blank(), ...picksOf(e.data ?? {}), comment: e.data?.comment ?? '', reassessments: e.data?.reassessments ?? [] });
    setDate(e.date);
    setTime(toInputTime(e.time));
    setState({ busy: false, done: null, error: null });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const reassess = (e) => {
    setMode({ kind: 'reassess', of: e });
    setEntry(blank());
    toNow();
    setState({ busy: false, done: null, error: null });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const hhmm = time.replace(':', '');
  const reassessment = { date, time: hhmm, response: entry.response, symptoms: entry.symptoms, severity: entry.severity, comment: entry.comment };
  const line =
    mode.kind === 'reassess'
      ? entryText({ ...mode.of.data, time: mode.of.time, date: mode.of.date, reassessments: [...(mode.of.data?.reassessments ?? []), reassessment] })
      : entryText({ ...entry, time: hhmm, date });
  const empty = mode.kind === 'reassess' ? !entry.response.length && !entry.symptoms.length && !entry.comment.trim() : entryIsEmpty(entry);

  const save = async () => {
    setState({ busy: true, done: null, error: null });
    try {
      const what = { date, time: hhmm, text: line, entry };
      let result;
      if (mode.kind === 'edit') result = await editSkinEntry(mode.of, what);
      else if (mode.kind === 'reassess') result = await reassessSkinEntry(mode.of, reassessment);
      else result = await addSkinEntry(what);
      if (mode.kind === 'new') setRecent(rememberRecent(entry, line));
      const verb = mode.kind === 'new' ? 'Added to' : 'Changed in';
      const note = mode.kind !== 'new' && !result.lineWasFound ? ' (the old line was not found in the note, so check it there)' : '';
      setState({ busy: false, done: { noteId: result.noteId, title: monthTitle(date), verb, note }, error: null });
      startNew();
      loadEntries();
    } catch (err) {
      setState({ busy: false, done: null, error: err.message });
    }
  };
  const remove = async () => {
    if (!confirm('Delete this entry? Its line is taken out of the note too.')) return;
    setState({ busy: true, done: null, error: null });
    try {
      await deleteSkinEntry(mode.of);
      setState({ busy: false, done: null, error: null });
      startNew();
      loadEntries();
    } catch (err) {
      setState({ busy: false, done: null, error: err.message });
    }
  };

  const reassessing = mode.kind === 'reassess';
  return (
    <div class="skin" data-testid="skin">
      {mode.kind !== 'new' && (
        <div class="skin-mode" data-testid="skin-mode">
          <strong>{mode.kind === 'edit' ? 'Editing entry' : 'Reassessing'}</strong>
          <span class="small">
            {shortDate(mode.of.date)} · {mode.of.text}
          </span>
          <button type="button" class="btn ghost" onClick={startNew}>
            Cancel
          </button>
        </div>
      )}

      <div class="skin-when">
        <label>
          Date <input type="date" value={date} onInput={(e) => setDate(e.currentTarget.value)} data-testid="skin-date" />
        </label>
        <label>
          Time <input type="time" value={time} onInput={(e) => setTime(e.currentTarget.value)} data-testid="skin-time" />
        </label>
        <button type="button" class="btn ghost" onClick={toNow}>
          Now
        </button>
      </div>

      {mode.kind === 'new' && recent.length > 0 && (
        <section class="skin-recent" data-testid="skin-recent">
          <button type="button" class="btn primary block" onClick={() => reuse(recent[0].picks)} data-testid="skin-same">
            Same as last time
          </button>
          <ul>
            {recent.slice(0, 3).map((r, i) => (
              <li key={i}>
                <span>{withoutTime(r.line)}</span>
                <button type="button" class="btn ghost" onClick={() => reuse(r.picks)} data-testid="skin-use-again">
                  Use again
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* reassessing: only how it responded and how the skin is now; where and what was applied are the entry's own */}
      {reassessing && <Picks kind="response" label="Response" items={lists.response} picked={entry.response} onToggle={toggle('response')} onAdd={add('response')} />}
      <Picks kind="symptoms" label={reassessing ? 'Skin now' : 'Skin'} items={lists.symptoms} picked={entry.symptoms} onToggle={toggle('symptoms')} onAdd={add('symptoms')} />
      {entry.symptoms.some((s) => s !== NO_IRRITATION) && <Choice label="Severity" options={SEVERITIES} value={entry.severity} onChange={set('severity')} testid="skin-severity" />}
      {!reassessing && (
        <>
          <Picks kind="areas" label="Where" items={lists.areas} picked={entry.areas} onToggle={toggle('areas')} onAdd={add('areas')} />
          <AreaPlaces areas={entry.areas} where={entry.where} onChange={(area, key, value) => setEntry((e) => ({ ...e, where: { ...e.where, [area]: { ...e.where[area], [key]: e.where[area]?.[key] === value ? null : value } } }))} />
          <Picks kind="products" label="Applied" items={lists.products} picked={entry.products} onToggle={toggle('products')} onAdd={add('products')} />
          <Picks kind="response" label="Response" items={lists.response} picked={entry.response} onToggle={toggle('response')} onAdd={add('response')} />
          <Picks kind="triggers" label="Possible trigger" items={lists.triggers} picked={entry.triggers} onToggle={toggle('triggers')} onAdd={add('triggers')} />
        </>
      )}
      {mode.kind === 'edit' && entry.reassessments.length > 0 && (
        <fieldset class="skin-group" data-testid="skin-reassessments">
          <legend>Reassessments</legend>
          <ul class="skin-reassessments">
            {entry.reassessments.map((r, i) => (
              <li key={i}>
                <span>{reassessedText(r, date)}</span>
                <button type="button" class="btn ghost" onClick={() => setEntry((e) => ({ ...e, reassessments: e.reassessments.filter((_, j) => j !== i) }))} data-testid="skin-reassessment-remove">
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </fieldset>
      )}
      <label class="skin-comment">
        Comment
        <textarea rows="2" value={entry.comment} onInput={(e) => setEntry({ ...entry, comment: e.currentTarget.value })} placeholder="Anything else (optional)" data-testid="skin-comment" />
      </label>

      <div class="skin-preview" aria-live="polite" data-testid="skin-preview">
        {empty ? <span class="muted">Pick something above; the line for the log appears here.</span> : line}
      </div>
      <button type="button" class="btn primary block" disabled={empty || state.busy} onClick={save} data-testid="skin-add">
        {state.busy ? 'Saving…' : mode.kind === 'edit' ? 'Save changes' : reassessing ? 'Add reassessment to this entry' : 'Add to skin log'}
      </button>
      {mode.kind === 'edit' && (
        <button type="button" class="btn danger block" disabled={state.busy} onClick={remove} data-testid="skin-delete">
          Delete entry
        </button>
      )}
      {state.error && (
        <p class="error small" role="alert" data-testid="skin-error">
          {state.error}
        </p>
      )}
      {state.done && (
        <p class="small" role="status" data-testid="skin-done">
          {state.done.verb} <a href={`#/n/${state.done.noteId}`}>{state.done.title}</a>
          {state.done.note}.
        </p>
      )}

      <RecentEntries entries={entries} onEdit={edit} onReassess={reassess} active={mode.of?.id} />
    </div>
  );
}
