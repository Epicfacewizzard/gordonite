import { useState } from 'preact/hooks';
import { SPACINGS, getSpacing, setSpacing, OPENING_PAGES, getOpeningPage, setOpeningPage } from '../prefs.js';
import { api } from '../api.js';

/** Settings that belong to this device. Line spacing for now; the preview uses the same rules as a real note. */
export function SettingsView({ config, onConfigChanged }) {
  const [spacing, setLocal] = useState(getSpacing);
  const [tz, setTz] = useState(config.tz);
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [opening, setOpening] = useState(getOpeningPage);
  const [openingMessage, setOpeningMessage] = useState('');
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
    </div>
  );
}
