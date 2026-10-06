import { useState } from 'preact/hooks';
import { SPACINGS, getSpacing, setSpacing } from '../prefs.js';

/** Settings that belong to this device. Line spacing for now; the preview uses the same rules as a real note. */
export function SettingsView() {
  const [spacing, setLocal] = useState(getSpacing);
  const choose = (id) => {
    setSpacing(id);
    setLocal(id);
  };
  return (
    <div class="settings" data-testid="settings">
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
