import { useEffect, useState } from 'preact/hooks';
import { SPACINGS, getSpacing, setSpacing, OPENING_PAGES, getOpeningPage, setOpeningPage, getDashboard, setDashboard, resetDashboard, DASHBOARD_REGIONS, DASHBOARD_TASKS, getDashboardTasks, setDashboardTasks, getShiftDismiss, setShiftDismiss, DONE_DAYS, getDoneDays, setDoneDays, MOOD_OPTIONS, getMoodPrefs, setMoodPref } from '../prefs.js';
import { api } from '../api.js';
import { offlineCopy } from '../offline-copy.js';
import { PasswordSettings } from './PasswordSettings.jsx';

/** Settings that belong to this device. Line spacing for now; the preview uses the same rules as a real note. */
// This device's copy of recent notes and tasks, for reading offline (offline-copy.js). Forgetting it never touches
// what is waiting to be sent: that lives in the save queue.
function PhoneCopySettings() {
  const [count, setCount] = useState(null);
  const [message, setMessage] = useState('');
  useEffect(() => {
    offlineCopy.count().then(setCount);
  }, []);
  const forget = async () => {
    await offlineCopy.forget();
    setCount(0);
    setMessage('Forgotten. Writing that waits to be sent is not affected.');
  };
  return (
    <>
      <h2 class="section">Offline copy on this device</h2>
      <p class="muted small">
        Recent notes, today’s stream and the task list are kept on this device so they can be read (and tasks ticked) with no connection. Anyone holding this
        unlocked device can read them, even with a Gordonite password set.
      </p>
      <p class="small" data-testid="phone-copy-count">{count === null ? '…' : `${count} ${count === 1 ? 'item' : 'items'} kept.`}</p>
      <button type="button" class="btn" onClick={forget} data-testid="phone-copy-forget">
        Forget this device’s copy
      </button>
      <p role="status">{message}</p>
    </>
  );
}

export function SettingsView({ config, onConfigChanged }) {
  const [spacing, setLocal] = useState(getSpacing);
  const [tz, setTz] = useState(config.tz);
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [opening, setOpening] = useState(getOpeningPage);
  const [openingMessage, setOpeningMessage] = useState('');
  const [prefsMessage, setPrefsMessage] = useState('');
  const [widgets, setWidgets] = useState(getDashboard);
  const [tasksScope, setTasksScope] = useState(getDashboardTasks);
  const [shiftDismiss, setShiftDismissState] = useState(getShiftDismiss);
  const [doneDays, setDoneDaysState] = useState(getDoneDays);
  const [moodPrefs, setMoodPrefs] = useState(getMoodPrefs);
  const changeMoodPref = (id, value) => {
    if (setMoodPref(id, value)) setMoodPrefs((p) => ({ ...p, [id]: value }));
    else setPrefsMessage('This browser could not save the mood choices.');
  };
  const changeWidgets = (next) => {
    setWidgets(next);
    if (!setDashboard(next)) setPrefsMessage('This browser could not save the widget choices.');
  };
  // Up and down move a widget past its neighbour in the same column; the column menu moves it side to side
  // (to the bottom of the column it lands in).
  const neighbour = (index, by) => {
    let j = index + by;
    while (widgets[j] && widgets[j].region !== widgets[index].region) j += by;
    return widgets[j] ? j : -1;
  };
  const moveWidget = (index, by) => {
    const j = neighbour(index, by);
    if (j < 0) return;
    const next = [...widgets];
    [next[index], next[j]] = [next[j], next[index]];
    changeWidgets(next);
  };
  const moveToColumn = (id, region) => {
    const w = widgets.find((x) => x.id === id);
    changeWidgets([...widgets.filter((x) => x.id !== id), { ...w, region }]);
  };
  const zones = [...new Set([config.tz, ...Intl.supportedValuesOf('timeZone')])];
  const saveTimezone = async (e) => {
    e.preventDefault(); setSaving(true); setMessage('');
    try { await api.setSettings({ tz }); await onConfigChanged(); setMessage('Timezone saved on server.'); }
    catch (err) { setMessage(err.message); }
    finally { setSaving(false); }
  };
  const choose = (id) => {
    setSpacing(id);
    setLocal(id);
  };
  return (
    <div class="settings" data-testid="settings">
      <nav class="footer-links" aria-label="Data management">
        <a href="#/files" data-testid="files-link">Files</a>
        <a href="#/trash">Trash</a>
        <a href="#/data">Data &amp; backups</a>
      </nav>
      <h2 class="section">Dashboard</h2>
      <p class="muted small">Widgets on this device: choose which to show, which column each sits in, and their order within a column. On a phone the columns stack top to bottom in the order shown here.</p>
      <div data-testid="widget-prefs">
        {DASHBOARD_REGIONS.map(([region, regionName]) => {
          const here = widgets.map((w, i) => ({ ...w, i })).filter((w) => w.region === region);
          if (here.length === 0) return null;
          return (
            <section key={region} class="widget-group" data-testid={`widget-group-${region}`}>
              <h3 class="widget-group-name">{regionName}</h3>
              <ul class="widget-prefs">
                {here.map((w) => (
                  <li key={w.id}>
                    <label><input type="checkbox" checked={w.shown} data-testid={`widget-toggle-${w.id}`} onChange={() => changeWidgets(widgets.map((x) => (x.id === w.id ? { ...x, shown: !x.shown } : x)))} /> {w.name}</label>
                    <span class="widget-move">
                      <select value={w.region} aria-label={`Column for ${w.name}`} data-testid={`widget-region-${w.id}`} onChange={(e) => moveToColumn(w.id, e.currentTarget.value)}>
                        {DASHBOARD_REGIONS.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
                      </select>
                      <button type="button" class="btn" disabled={neighbour(w.i, -1) < 0} aria-label={`Move ${w.name} up`} data-testid={`widget-up-${w.id}`} onClick={() => moveWidget(w.i, -1)}>↑</button>
                      <button type="button" class="btn" disabled={neighbour(w.i, 1) < 0} aria-label={`Move ${w.name} down`} data-testid={`widget-down-${w.id}`} onClick={() => moveWidget(w.i, 1)}>↓</button>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
      <p class="widget-reset">
        <button type="button" class="btn" data-testid="widget-reset" onClick={() => { if (resetDashboard()) setWidgets(getDashboard()); else setPrefsMessage('This browser could not reset the layout.'); }}>Reset dashboard layout</button>
        <span class="muted small"> Puts every widget back where it started.</span>
      </p>
      <p class="muted small">Tasks on this device:</p>
      <label class="check-row"><input type="checkbox" checked={shiftDismiss} data-testid="shift-dismiss" onChange={(e) => { const on = e.currentTarget.checked; if (setShiftDismiss(on)) setShiftDismissState(on); else setPrefsMessage('This browser could not save the choice.'); }} /> <span>Shift-click a task’s checkbox to dismiss it instead of ticking it</span></label>
      <label>Done and dismissed tasks show <select value={doneDays} data-testid="done-days" onChange={(e) => { const v = Number(e.currentTarget.value); if (setDoneDays(v)) setDoneDaysState(v); else setPrefsMessage('This browser could not save the choice.'); }}>{DONE_DAYS.map(([days, name]) => <option key={days} value={days}>{name}</option>)}</select></label>
      <p class="muted small">On the Tasks page and in each note's task history, to start with. You can pick any other dates on the spot.</p>
      <p class="muted small">Tasks box on this device:</p>
      <label>The dashboard Tasks box shows <select value={tasksScope} data-testid="dashboard-tasks-scope" onChange={(e) => { const v = e.currentTarget.value; if (setDashboardTasks(v)) setTasksScope(v); else setPrefsMessage('This browser could not save the choice.'); }}>{DASHBOARD_TASKS.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
      <p class="muted small">Mood band on this device:</p>
      <ul class="widget-prefs" data-testid="mood-prefs">
        {MOOD_OPTIONS.map(([id, name, about]) => (
          <li key={id}>
            <label><input type="checkbox" checked={moodPrefs[id]} data-testid={`mood-pref-${id}`} onChange={(e) => changeMoodPref(id, e.currentTarget.checked)} /> {name}<span class="muted small"> {about}</span></label>
          </li>
        ))}
      </ul>
      <PasswordSettings />
      <h2 class="section">Opening page on this device</h2>
      <p class="muted small">Choose separately on your phone and computer. Direct links to notes still open that note.</p>
      <label>Opening page <select value={opening} data-testid="opening-page" onChange={(e) => {
        const value = e.currentTarget.value;
        if (setOpeningPage(value)) { setOpening(value); setOpeningMessage('Saved on this device.'); }
        else setOpeningMessage('This browser could not save the preference.');
      }}>{OPENING_PAGES.map(([path, name]) => <option key={path} value={path}>{name}</option>)}</select></label>
      <p role="status">{openingMessage}</p>
      <h2 class="section">Home timezone</h2>
      <p class="muted small">Shared across your devices. Changes today’s date for new entries and task history dates. Existing note dates and writing stay where they are. Travel does not change this automatically.</p>
      <form onSubmit={saveTimezone}>
        <label>Timezone <select value={tz} onChange={(e) => setTz(e.currentTarget.value)} data-testid="timezone-select">{zones.map((zone) => <option key={zone} value={zone}>{zone}</option>)}</select></label>
        <button class="btn" type="submit" disabled={saving} data-testid="timezone-save">{saving ? 'Saving…' : 'Save timezone'}</button>
        <p role="status">{message}</p>
      </form>
      <h2 class="section">Line spacing</h2>
      <p class="muted small">Applies to the text of notes, on this device only.</p>
      <div class="spacing-options" role="radiogroup" aria-label="Line spacing">
        {SPACINGS.map(([id, name, about]) => (
          <label key={id} class={`spacing-option${spacing === id ? ' on' : ''}`}>
            <input type="radio" name="spacing" value={id} checked={spacing === id} onChange={() => choose(id)} data-testid={`spacing-${id}`} />
            <span>
              <strong>{name}</strong>
              <span class="muted small"> {about}</span>
            </span>
          </label>
        ))}
      </div>
      <div class="note-text spacing-preview" data-testid="spacing-preview" aria-label="Preview">
        <p>The first line of a note.</p>
        <p>A second paragraph, started with Enter.</p>
        <p>A third one, to see how the lines sit together.</p>
      </div>
      <p class="muted small">Tip: Shift+Enter starts a new line inside the same paragraph, with no gap.</p>
      <PhoneCopySettings />
      <p class="muted small" data-testid="app-version">Gordonite · Version {config.version ?? 'unavailable'}</p>
    </div>
  );
}
