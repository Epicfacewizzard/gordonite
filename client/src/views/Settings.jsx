import { useEffect, useState } from 'preact/hooks';
import { SPACINGS, getSpacing, setSpacing, OPENING_PAGES, getOpeningPage, setOpeningPage, getDashboard, setDashboard, resetDashboard, DASHBOARD_REGIONS, DASHBOARD_TASKS, getDashboardTasks, setDashboardTasks, MOOD_OPTIONS, getMoodPrefs, setMoodPref } from '../prefs.js';
import { api } from '../api.js';

/** Settings that belong to this device. Line spacing for now; the preview uses the same rules as a real note. */
export function SettingsView({ config, onConfigChanged }) {
  const [spacing, setLocal] = useState(getSpacing);
  const [tz, setTz] = useState(config.tz);
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [opening, setOpening] = useState(getOpeningPage);
  const [openingMessage, setOpeningMessage] = useState('');
  const [dailyTag, setDailyTag] = useState(config.dailyTag ?? 'daily-jots');
  const [dailyTags, setDailyTags] = useState([]);
  const [dailyMessage, setDailyMessage] = useState('');
  const [widgets, setWidgets] = useState(getDashboard);
  const [tasksScope, setTasksScope] = useState(getDashboardTasks);
  const [moodPrefs, setMoodPrefs] = useState(getMoodPrefs);
  const changeMoodPref = (id, value) => {
    if (setMoodPref(id, value)) setMoodPrefs((p) => ({ ...p, [id]: value }));
    else setDailyMessage('This browser could not save the mood choices.');
  };
  useEffect(() => {
    api.tags().then((r) => setDailyTags(r.tags.filter((t) => t.daily).map((t) => t.path))).catch(() => {});
    api.config().then((c) => setDailyTag(c.dailyTag ?? 'daily-jots')).catch(() => {});
  }, []);
  const dailyOptions = [...new Set([dailyTag, ...dailyTags])].filter(Boolean).sort();
  // Saved on the server (it is the same on every device); put back if the server refuses.
  const chooseDailyTag = async (next) => {
    const before = dailyTag;
    setDailyTag(next); setDailyMessage('');
    try { await api.setSettings({ dailyTag: next }); await onConfigChanged(); setDailyMessage('Saved.'); }
    catch (err) { setDailyTag(before); setDailyMessage(err.message); }
  };
  const changeWidgets = (next) => {
    setWidgets(next);
    if (!setDashboard(next)) setDailyMessage('This browser could not save the widget choices.');
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
        <a href="#/trash">Trash</a>
        <a href="#/data">Data &amp; backups</a>
      </nav>
      <h2 class="section">Dashboard</h2>
      <p class="muted small">Today’s note on the dashboard is the entry for today in this tag. Shared across your devices.</p>
      <label>Today’s note comes from <select value={dailyTag} onChange={(e) => chooseDailyTag(e.currentTarget.value)} data-testid="daily-tag-select">{dailyOptions.map((path) => <option key={path} value={path}>{path}</option>)}</select></label>
      <p role="status" data-testid="daily-tag-message">{dailyMessage}</p>
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
        <button type="button" class="btn" data-testid="widget-reset" onClick={() => { if (resetDashboard()) setWidgets(getDashboard()); else setDailyMessage('This browser could not reset the layout.'); }}>Reset dashboard layout</button>
        <span class="muted small"> Puts every widget back where it started.</span>
      </p>
      <p class="muted small">Tasks box on this device:</p>
      <label>The dashboard Tasks box shows <select value={tasksScope} data-testid="dashboard-tasks-scope" onChange={(e) => { const v = e.currentTarget.value; if (setDashboardTasks(v)) setTasksScope(v); else setDailyMessage('This browser could not save the choice.'); }}>{DASHBOARD_TASKS.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
      <p class="muted small">Mood band on this device:</p>
      <ul class="widget-prefs" data-testid="mood-prefs">
        {MOOD_OPTIONS.map(([id, name, about]) => (
          <li key={id}>
            <label><input type="checkbox" checked={moodPrefs[id]} data-testid={`mood-pref-${id}`} onChange={(e) => changeMoodPref(id, e.currentTarget.checked)} /> {name}<span class="muted small"> {about}</span></label>
          </li>
        ))}
      </ul>
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
      <p class="muted small" data-testid="app-version">Gordonite · Version {config.version ?? 'unavailable'}</p>
    </div>
  );
}
