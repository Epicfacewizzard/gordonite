import { useEffect, useRef, useState } from 'preact/hooks';
import { api } from '../api.js';
import { useSession } from '../hooks.js';
import {
  CHANNELS,
  CLOSENESS,
  CONTACT_KINDS,
  addLogLine,
  avatarHue,
  birthdayLabel,
  birthdaySoon,
  cleanProfile,
  contactHref,
  initials,
  logEntries,
  sinceLabel,
} from '../../../shared/people.js';
import { PersonTasks } from './PersonTasks.jsx';
import { loadPeople, peopleQueue, peopleState, savePersonProfile, subscribePeople } from '../people-data.js';

// A person's details at the top of their page (see docs/PEOPLE.md), laid out like the Personal CRM preview: a grid
// of details (tap one to change it; empty ones wait behind "+ Add detail"), things to remember, and Log a conversation,
// which writes into the note. Details are saved through the people queue, so they work offline; the name, groups (tags)
// and text below are the note's own.

export function usePeople() {
  const [, rerender] = useState(0);
  useEffect(() => {
    const stop = subscribePeople(() => rerender((n) => n + 1));
    loadPeople();
    return stop;
  }, []);
  return peopleState();
}

const dateLabel = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

/** A round photo, or coloured initials when there is none. */
export function PersonAvatar({ name, photo, size = 44 }) {
  const [broken, setBroken] = useState(false);
  const style = { width: `${size}px`, height: `${size}px`, fontSize: `${Math.round(size * 0.38)}px` };
  if (photo && !broken) return <img class="person-avatar" src={`/api/attachments/${encodeURIComponent(photo)}/file`} alt="" style={style} onError={() => setBroken(true)} />;
  const hue = avatarHue(name);
  return (
    <span class="person-avatar initials" aria-hidden="true" style={{ ...style, '--hue': hue }}>
      {initials(name)}
    </span>
  );
}

// Every detail the block knows, in the order shown. `empty(p)` says when it is hidden behind "+ Add detail".
const FIELDS = [
  { key: 'lastTalked', label: 'Last talked', empty: (p) => !p.lastTalked },
  { key: 'birthday', label: 'Birthday', empty: (p) => !p.birthday },
  { key: 'closeness', label: 'Closeness', empty: (p) => !p.closeness },
  { key: 'role', label: 'Role', empty: (p) => !p.role },
  { key: 'contacts', label: 'Contact', empty: (p) => !p.contacts.length },
  { key: 'pronouns', label: 'Pronouns', empty: (p) => !p.pronouns },
  { key: 'howMet', label: 'How we met', empty: (p) => !p.howMet && !p.metWhen },
  { key: 'aliases', label: 'Also called', empty: (p) => !p.aliases.length },
  { key: 'remember', label: 'Remember', empty: (p) => !p.remember.length },
  { key: 'extra', label: 'More details', empty: (p) => !p.extra.length },
];

/** The avatar with a "change photo" control, shown above the name. */
export function PersonHeader({ noteId, name }) {
  const state = usePeople();
  const profile = state.profileOf(noteId);
  const input = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const pick = async (e) => {
    const file = e.currentTarget.files?.[0];
    e.currentTarget.value = '';
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const { attachment } = await api.uploadFile(file, { noteId });
      savePersonProfile(noteId, { ...profile, photo: attachment.id });
    } catch (err) {
      setError(`The photo was not added: ${err.message}. A photo needs a connection to the server.`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div class="person-header" data-testid="person-header">
      <button type="button" class="person-photo-btn" aria-label={profile.photo ? 'Change photo' : 'Add a photo'} disabled={busy} onClick={() => input.current?.click()}>
        <PersonAvatar name={name} photo={profile.photo} size={72} />
        <span class="person-photo-hint">{busy ? 'Adding…' : profile.photo ? 'Change' : 'Photo'}</span>
      </button>
      {profile.photo && (
        <button type="button" class="btn ghost small" onClick={() => savePersonProfile(noteId, { ...profile, photo: null })}>
          Remove photo
        </button>
      )}
      <input ref={input} type="file" accept="image/*" hidden onChange={pick} />
      {error && (
        <p class="error inline" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

// Always shown, filled or not: the three things looked at most. The rest appear once filled (or from "+ Add detail").
const ALWAYS = ['lastTalked', 'birthday', 'closeness'];

/**
 * Write a conversation into the person's note: through the open editor when there is one (one undoable step, saved like
 * typing), otherwise straight through the note's save session.
 */
function writeLog(session, editor, entry) {
  if (editor && !editor.isDestroyed) {
    const next = addLogLine(editor.getJSON(), entry);
    editor
      .chain()
      .command(({ tr, state }) => {
        tr.replaceWith(0, state.doc.content.size, state.schema.nodeFromJSON(next).content);
        return true;
      })
      .run();
  } else {
    session.editDoc((doc) => addLogLine(doc, entry));
  }
}

/** The block of details under the name and groups, laid out like the Personal CRM preview. */
export function PersonProfile({ noteId, name = '', today, session = null, editor = null }) {
  useSession(session);
  const state = usePeople();
  const profile = state.profileOf(noteId);
  const [editing, setEditing] = useState(null); // the key of the detail being changed
  const [adding, setAdding] = useState(false);
  const [logging, setLogging] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const firstName = name.trim().split(/\s+/)[0] || 'them';
  // What was last talked about lives in the note's Log; the detail only covers "talked, nothing written".
  const doc = editor && !editor.isDestroyed ? editor.getJSON() : session?.currentDoc();
  const lastChat = logEntries(doc)[0] ?? null;
  const lastTalked = [profile.lastTalked, lastChat?.date ?? ''].sort().at(-1);

  const save = (patch) => {
    try {
      savePersonProfile(noteId, cleanProfile({ ...profile, ...patch }));
      setError(null);
      return true;
    } catch (err) {
      setError(err.message);
      return false;
    }
  };
  const done = (patch) => {
    if (save(patch)) setEditing(null);
  };
  const logConversation = ({ date, how, text }) => {
    if (date > (profile.lastTalked || '') && !save({ lastTalked: date })) return false;
    try {
      writeLog(session, editor, { date, how, text });
      setNotice('Logged. It is at the top of the Log in the note below.');
    } catch (err) {
      setNotice(`Last talked is updated, but the note could not be changed: ${err.message}`);
    }
    return true;
  };

  const shown = FIELDS.filter((f) => f.key !== 'remember' && (ALWAYS.includes(f.key) || !f.empty(profile) || editing === f.key));
  const hidden = FIELDS.filter((f) => !ALWAYS.includes(f.key) && f.empty(profile) && editing !== f.key);
  const refused = state.refused.find((c) => c.noteId === noteId);

  return (
    <section class="person-profile" aria-label="Details" data-testid="person-profile">
      <div class="person-actions">
        <button type="button" class="btn primary" onClick={() => setLogging(true)} data-testid="person-log-open">
          Log a conversation
        </button>
        {lastTalked !== today && (
          <button type="button" class="btn" onClick={() => save({ lastTalked: today })} data-testid="person-talked-today">
            Talked today
          </button>
        )}
      </div>
      {notice && (
        <p class="person-notice small" role="status">
          {notice}
        </p>
      )}
      <dl class="person-facts">
        {shown.map((f) => (
          <div class={`person-fact${editing === f.key ? ' editing' : ''}${f.key === 'extra' || f.key === 'howMet' ? ' wide' : ''}`} key={f.key} data-prop={f.key}>
            <dt>{f.label}</dt>
            <dd>
              {editing === f.key ? (
                <Editor field={f.key} profile={profile} today={today} onDone={done} onCancel={() => setEditing(null)} />
              ) : (
                <button type="button" class="person-fact-value" onClick={() => setEditing(f.key)} aria-label={`Change ${f.label.toLowerCase()}`}>
                  {f.key === 'lastTalked' ? <LastTalked date={lastTalked} chat={lastChat} today={today} /> : f.empty(profile) ? <span class="muted">Add</span> : <Value field={f.key} profile={profile} today={today} />}
                </button>
              )}
            </dd>
          </div>
        ))}
      </dl>
      {hidden.length > 0 &&
        (adding ? (
          <div class="person-add-list" role="group" aria-label="Add a detail">
            {hidden.map((f) => (
              <button
                key={f.key}
                type="button"
                class="btn small"
                onClick={() => {
                  setAdding(false);
                  setEditing(f.key);
                }}
              >
                {f.label}
              </button>
            ))}
            <button type="button" class="btn ghost small" onClick={() => setAdding(false)}>
              Cancel
            </button>
          </div>
        ) : (
          <button type="button" class="btn ghost small person-add" onClick={() => setAdding(true)} data-testid="person-add-detail">
            + Add detail
          </button>
        ))}
      {(profile.remember.length > 0 || editing === 'remember') && (
        <div class="person-remember" data-testid="person-remember">
          <div class="person-section-head">
            <h3 class="person-section-title">Things to remember</h3>
            {editing !== 'remember' && (
              <button type="button" class="btn ghost small" onClick={() => setEditing('remember')}>
                Edit
              </button>
            )}
          </div>
          {editing === 'remember' ? (
            <Editor field="remember" profile={profile} today={today} onDone={done} onCancel={() => setEditing(null)} />
          ) : (
            <ul class="person-remember-list">
              {profile.remember.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      <PersonTasks noteId={noteId} today={today} />
      {state.isWaiting(noteId) && !refused && <p class="muted small">Details waiting to be sent.</p>}
      {refused && (
        <p class="banner error small" role="alert">
          These details were not saved: {refused.error}{' '}
          <button type="button" class="btn ghost" onClick={() => peopleQueue.retry(refused.key)}>
            Try again
          </button>
          <button type="button" class="btn ghost" onClick={() => peopleQueue.discard(refused.key)}>
            Discard
          </button>
        </p>
      )}
      {error && (
        <p class="error inline" role="alert">
          {error}
        </p>
      )}
      {logging && <LogDialog name={name} firstName={firstName} today={today} onSave={logConversation} onClose={() => setLogging(false)} />}
    </section>
  );
}

/** "Today" with what was talked about under it, from the note's Log. */
function LastTalked({ date, chat, today }) {
  if (!date) return <span class="muted">Not yet</span>;
  const about = chat && chat.date === date ? chat : null;
  return (
    <>
      <span class="person-fact-main">{sinceLabel(date, today)}</span>
      <span class="person-fact-sub">{about ? `${about.how ? `${about.how}: ` : ''}${about.text}` : dateLabel(date)}</span>
    </>
  );
}

/** Log a conversation: when, how, and what was talked about. */
function LogDialog({ name, firstName, today, onSave, onClose }) {
  const ref = useRef(null);
  const [date, setDate] = useState(today);
  const [how, setHow] = useState(CHANNELS[0]);
  const [text, setText] = useState('');
  const [problem, setProblem] = useState(null);
  useEffect(() => {
    ref.current?.showModal?.();
  }, []);
  const submit = (e) => {
    e.preventDefault();
    if (!date || date > today) return setProblem('Pick a day up to today.');
    if (!text.trim()) return setProblem(`Write a few words about what you and ${firstName} talked about.`);
    if (onSave({ date, how, text: text.trim() })) onClose();
  };
  return (
    <dialog ref={ref} class="person-dialog" onClose={onClose} onCancel={onClose} data-testid="person-log-dialog">
      <form onSubmit={submit}>
        <div class="person-section-head">
          <h2>Log a conversation</h2>
          <button type="button" class="icon-btn" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>
        <p class="muted small">{name || 'This person'} · Keep the detail you’d want to remember next time.</p>
        <div class="person-form-grid">
          <label>
            <span class="person-field">When</span>
            <input type="date" value={date} max={today} onInput={(e) => setDate(e.currentTarget.value)} />
          </label>
          <label>
            <span class="person-field">How</span>
            <select value={how} onChange={(e) => setHow(e.currentTarget.value)}>
              {CHANNELS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label>
          <span class="person-field">What did you talk about?</span>
          <textarea rows={4} value={text} maxLength={1000} autoFocus onInput={(e) => setText(e.currentTarget.value)} data-testid="person-log-text" />
        </label>
        <p class="muted small">It goes into the Log in {firstName}’s note, newest first, and updates Last talked.</p>
        {problem && (
          <p class="error inline" role="alert">
            {problem}
          </p>
        )}
        <div class="person-edit-actions">
          <button type="button" class="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" class="btn primary" data-testid="person-log-save">
            Save
          </button>
        </div>
      </form>
    </dialog>
  );
}


function Value({ field, profile: p, today }) {
  switch (field) {
    case 'closeness':
      return CLOSENESS.find((c) => c.id === p.closeness)?.label ?? '';
    case 'birthday': {
      const soon = birthdaySoon(p.birthday, today);
      return (
        <>
          {birthdayLabel(p.birthday)}
          {soon && <span class="muted"> · {soon}</span>}
        </>
      );
    }
    case 'lastTalked':
      return (
        <>
          {sinceLabel(p.lastTalked, today)}
          <span class="muted"> · {dateLabel(p.lastTalked)}</span>
        </>
      );
    case 'contacts':
      return (
        <span class="person-contacts">
          {p.contacts.map((c, i) => {
            const href = contactHref(c);
            return (
              <span key={i}>
                <span class="muted">{CONTACT_KINDS.find((k) => k.id === c.kind)?.label}: </span>
                {href ? (
                  <a href={href} onClick={(e) => e.stopPropagation()} target={href.startsWith('http') ? '_blank' : undefined} rel="noreferrer">
                    {c.value}
                  </a>
                ) : (
                  c.value
                )}
              </span>
            );
          })}
        </span>
      );
    case 'howMet':
      return (
        <>
          {p.howMet}
          {p.metWhen && <span class="muted">{p.howMet ? ' · ' : ''}{p.metWhen}</span>}
        </>
      );
    case 'aliases':
    case 'remember':
      return (
        <span class="chips small">
          {p[field].map((t) => (
            <span key={t} class="chip">
              {t}
            </span>
          ))}
        </span>
      );
    case 'extra':
      return (
        <span class="person-extra">
          {p.extra.map((x, i) => (
            <span key={i}>
              <span class="muted">{x.label}: </span>
              {x.value}
            </span>
          ))}
        </span>
      );
    default:
      return p[field];
  }
}

const keyDone = (commit, cancel) => (e) => {
  if (e.key === 'Enter' && e.currentTarget.tagName !== 'TEXTAREA') {
    e.preventDefault();
    commit();
  } else if (e.key === 'Escape') cancel();
};

function Actions({ onSave, onCancel, extra }) {
  return (
    <div class="person-edit-actions">
      {extra}
      <button type="button" class="btn ghost small" onClick={onCancel}>
        Cancel
      </button>
      <button type="button" class="btn primary small" onClick={onSave} data-testid="person-save">
        Save
      </button>
    </div>
  );
}

function Editor({ field, profile, today, onDone, onCancel }) {
  if (field === 'closeness') {
    return (
      <div class="person-choice" role="group" aria-label="Closeness">
        {CLOSENESS.map((c) => (
          <button key={c.id} type="button" class="btn small" aria-pressed={profile.closeness === c.id} onClick={() => onDone({ closeness: profile.closeness === c.id ? '' : c.id })}>
            {c.label}
          </button>
        ))}
        <button type="button" class="btn ghost small" onClick={onCancel}>
          Cancel
        </button>
      </div>
    );
  }
  if (field === 'role' || field === 'pronouns') return <TextEditor value={profile[field]} label={field === 'role' ? 'Role' : 'Pronouns'} placeholder={field === 'role' ? 'e.g. VP Events, classmate' : 'e.g. she/her'} onSave={(v) => onDone({ [field]: v })} onCancel={onCancel} />;
  if (field === 'birthday') return <BirthdayEditor value={profile.birthday} onSave={(v) => onDone({ birthday: v })} onCancel={onCancel} />;
  if (field === 'lastTalked') return <TalkedEditor value={profile.lastTalked || today} today={today} onSave={(v) => onDone({ lastTalked: v })} onCancel={onCancel} />;
  if (field === 'howMet') return <MetEditor profile={profile} onSave={onDone} onCancel={onCancel} />;
  if (field === 'aliases' || field === 'remember') return <ListEditor value={profile[field]} label={field === 'aliases' ? 'Nickname' : 'Something to remember'} placeholder={field === 'aliases' ? 'e.g. Mags' : 'e.g. likes matcha, sister Ana'} onSave={(v) => onDone({ [field]: v })} onCancel={onCancel} />;
  if (field === 'contacts') return <PairsEditor rows={profile.contacts.map((c) => ({ a: c.kind, b: c.value }))} kinds onSave={(rows) => onDone({ contacts: rows.map((r) => ({ kind: r.a, value: r.b })) })} onCancel={onCancel} />;
  if (field === 'extra') return <PairsEditor rows={profile.extra.map((x) => ({ a: x.label, b: x.value }))} onSave={(rows) => onDone({ extra: rows.map((r) => ({ label: r.a, value: r.b })) })} onCancel={onCancel} />;
  return null;
}

function TextEditor({ value, label, placeholder, onSave, onCancel }) {
  const [v, setV] = useState(value);
  const commit = () => onSave(v);
  return (
    <>
      <input type="text" aria-label={label} value={v} placeholder={placeholder} autoFocus onInput={(e) => setV(e.currentTarget.value)} onKeyDown={keyDone(commit, onCancel)} />
      <Actions onSave={commit} onCancel={onCancel} extra={value && <button type="button" class="btn ghost small" onClick={() => onSave('')}>Clear</button>} />
    </>
  );
}

function BirthdayEditor({ value, onSave, onCancel }) {
  const full = value.length === 10;
  const [month, setMonth] = useState(value ? Number((full ? value.slice(5) : value).slice(0, 2)) : 1);
  const [day, setDay] = useState(value ? Number(value.slice(-2)) : 1);
  const [year, setYear] = useState(full ? value.slice(0, 4) : '');
  const commit = () => {
    const md = `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    onSave(/^\d{4}$/.test(year.trim()) ? `${year.trim()}-${md}` : md);
  };
  return (
    <>
      <div class="person-birthday">
        <select aria-label="Month" value={month} onChange={(e) => setMonth(Number(e.currentTarget.value))}>
          {['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'].map((m, i) => (
            <option key={m} value={i + 1}>
              {m}
            </option>
          ))}
        </select>
        <input type="number" aria-label="Day" min="1" max="31" inputMode="numeric" value={day} onInput={(e) => setDay(Number(e.currentTarget.value))} />
        <input type="text" aria-label="Year (optional)" placeholder="Year (optional)" inputMode="numeric" maxLength={4} value={year} onInput={(e) => setYear(e.currentTarget.value)} onKeyDown={keyDone(commit, onCancel)} />
      </div>
      <Actions onSave={commit} onCancel={onCancel} extra={value && <button type="button" class="btn ghost small" onClick={() => onSave('')}>Clear</button>} />
    </>
  );
}

function TalkedEditor({ value, today, onSave, onCancel }) {
  const [v, setV] = useState(value);
  return (
    <>
      <div class="person-birthday">
        <input type="date" aria-label="Last talked" value={v} max={today} onInput={(e) => setV(e.currentTarget.value)} />
        <button type="button" class="btn small" onClick={() => setV(today)}>
          Today
        </button>
      </div>
      <Actions onSave={() => onSave(v)} onCancel={onCancel} extra={<button type="button" class="btn ghost small" onClick={() => onSave('')}>Clear</button>} />
    </>
  );
}

function MetEditor({ profile, onSave, onCancel }) {
  const [how, setHow] = useState(profile.howMet);
  const [when, setWhen] = useState(profile.metWhen);
  const commit = () => onSave({ howMet: how, metWhen: when });
  return (
    <>
      <textarea aria-label="How we met" rows={3} value={how} placeholder="e.g. Sat together in anatomy lab" autoFocus onInput={(e) => setHow(e.currentTarget.value)} onKeyDown={keyDone(commit, onCancel)} />
      <input type="text" aria-label="When we met" value={when} placeholder="When (e.g. Fall 2024)" onInput={(e) => setWhen(e.currentTarget.value)} onKeyDown={keyDone(commit, onCancel)} />
      <Actions onSave={commit} onCancel={onCancel} />
    </>
  );
}

function ListEditor({ value, label, placeholder, onSave, onCancel }) {
  const [items, setItems] = useState(value);
  const [text, setText] = useState('');
  const add = () => {
    const t = text.trim();
    if (t && !items.includes(t)) setItems([...items, t]);
    setText('');
  };
  return (
    <>
      <span class="chips small">
        {items.map((t) => (
          <span key={t} class="chip">
            {t}
            <button type="button" aria-label={`Remove ${t}`} onClick={() => setItems(items.filter((x) => x !== t))}>
              ×
            </button>
          </span>
        ))}
      </span>
      <div class="person-birthday">
        <input
          type="text"
          aria-label={label}
          value={text}
          placeholder={placeholder}
          autoFocus
          onInput={(e) => setText(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            } else if (e.key === 'Escape') onCancel();
          }}
        />
        <button type="button" class="btn small" onClick={add}>
          Add
        </button>
      </div>
      <Actions onSave={() => onSave(text.trim() && !items.includes(text.trim()) ? [...items, text.trim()] : items)} onCancel={onCancel} />
    </>
  );
}

// Contacts (kind + value) and More details (label + value): rows of two fields, a blank row at the end to add one.
function PairsEditor({ rows, kinds = false, onSave, onCancel }) {
  const blank = () => ({ a: kinds ? 'phone' : '', b: '' });
  const [list, setList] = useState([...rows, blank()]);
  const set = (i, patch) => {
    const next = list.map((r, j) => (j === i ? { ...r, ...patch } : r));
    if (next.at(-1).b.trim() || (!kinds && next.at(-1).a.trim())) next.push(blank());
    setList(next);
  };
  const commit = () => onSave(list.filter((r) => r.b.trim() && (kinds || r.a.trim())));
  return (
    <>
      {list.map((r, i) => (
        <div class="person-pair" key={i}>
          {kinds ? (
            <select aria-label="Kind" value={r.a} onChange={(e) => set(i, { a: e.currentTarget.value })}>
              {CONTACT_KINDS.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.label}
                </option>
              ))}
            </select>
          ) : (
            <input type="text" aria-label="Label" placeholder="Label (e.g. Major)" value={r.a} onInput={(e) => set(i, { a: e.currentTarget.value })} />
          )}
          <input
            type={kinds && r.a === 'phone' ? 'tel' : kinds && r.a === 'email' ? 'email' : 'text'}
            aria-label={kinds ? 'Contact' : 'Value'}
            placeholder={kinds ? (r.a === 'phone' ? '403-555-0100' : r.a === 'email' ? 'name@example.com' : '@handle or link') : 'Value'}
            value={r.b}
            onInput={(e) => set(i, { b: e.currentTarget.value })}
            onKeyDown={keyDone(commit, onCancel)}
          />
          {i < list.length - 1 && (
            <button type="button" class="icon-btn" aria-label="Remove" onClick={() => setList(list.filter((_, j) => j !== i))}>
              ×
            </button>
          )}
        </div>
      ))}
      <Actions onSave={commit} onCancel={onCancel} />
    </>
  );
}
