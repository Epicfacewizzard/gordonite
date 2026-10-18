import { useEffect, useState } from 'preact/hooks';
import { api } from '../api.js';
import { addPasskeyHere, guessDeviceName, passkeySupported } from '../passkey.js';
import { LOGGED_OUT } from './LoginView.jsx';

const EMPTY = { current: '', password: '', again: '', offCurrent: '' };

// Settings → PIN. Off by default. When it is on, every browser has to type the 4-digit PIN once (it then stays logged
// in for 30 days). The PIN itself is kept only as a hash on the server (see docs/LOGIN.md). A longer password set
// before PINs keeps working until a PIN replaces it, so "current" asks for whichever is set.
export function PasswordSettings() {
  const [state, setState] = useState(null); // { enabled, loggedIn, pin }
  const [message, setMessage] = useState('');
  const [fields, setFields] = useState(EMPTY);
  const [round, setRound] = useState(0); // a PIN change removes the passkeys: reload their list
  const set = (key) => (e) => setFields((f) => ({ ...f, [key]: e.currentTarget.value }));
  const setDigits = (key) => (e) => {
    const digits = e.currentTarget.value.replace(/\D/g, '').slice(0, 4);
    e.currentTarget.value = digits;
    setFields((f) => ({ ...f, [key]: digits }));
  };

  useEffect(() => {
    api.auth().then(setState).catch(() => setMessage('Can’t reach the server.'));
  }, []);

  const run = async (call, done) => {
    setMessage('');
    try {
      setState(await call());
      setFields(EMPTY);
      setRound((n) => n + 1);
      setMessage(done);
    } catch (err) {
      setMessage(err.message);
    }
  };
  const invalid = () => {
    if (!/^\d{4}$/.test(fields.password)) {
      setMessage('The PIN is exactly 4 digits.');
      return true;
    }
    if (fields.password === fields.again) return false;
    setMessage('The two PINs do not match.');
    return true;
  };
  const turnOn = (e) => {
    e.preventDefault();
    if (!invalid()) run(() => api.setPassword(fields.password), 'The PIN is on. Other devices will ask for it.');
  };
  const change = (e) => {
    e.preventDefault();
    if (!invalid()) run(() => api.setPassword(fields.password, fields.current), 'PIN changed. Other devices will ask for the new one.');
  };
  const turnOff = (e) => {
    e.preventDefault();
    run(() => api.passwordOff(fields.offCurrent), 'The PIN is off.');
  };
  const logOut = async () => {
    try {
      sessionStorage.setItem(LOGGED_OUT, '1'); // the login page then waits instead of asking for the fingerprint at once
    } catch {
      /* it asks; no harm */
    }
    await api.logout().catch(() => {});
    location.reload();
  };

  const pinInput = (key, testId, autocomplete = 'new-password') => (
    <input type="password" inputmode="numeric" pattern="[0-9]*" maxlength={4} autocomplete={autocomplete} value={fields[key]} onInput={setDigits(key)} data-testid={testId} />
  );
  // The current PIN, or the old password on an install that has not switched yet.
  const currentInput = (key, testId) =>
    state?.pin ? pinInput(key, testId, 'current-password') : <input type="password" autocomplete="current-password" value={fields[key]} onInput={set(key)} data-testid={testId} />;
  const currentName = state?.pin ? 'PIN' : 'password';

  return (
    <section data-testid="password-settings">
      <h2 class="section">PIN</h2>
      <p class="muted small">
        Off by default. When it is on, anyone opening the app on any device has to type a 4-digit PIN first (a device then stays logged in for 30 days). Your notes do not change.
        The VPN is still your main protection; this is a second lock.
      </p>
      {state === null && !message && <p class="muted small">Checking…</p>}
      {state && !state.enabled && (
        <form class="pw-form" onSubmit={turnOn}>
          <label>New PIN (4 digits){pinInput('password', 'pw-new')}</label>
          <label>Type it again{pinInput('again', 'pw-again')}</label>
          <button type="submit" class="btn" disabled={!fields.password} data-testid="pw-turn-on">Turn on PIN</button>
        </form>
      )}
      {state?.enabled && (
        <>
          <p data-testid="pw-state">
            The {state.pin ? 'PIN' : 'old password'} is <strong>on</strong>.
          </p>
          {!state.pin && <p class="muted small" data-testid="pw-legacy">Gordonite still has a password from before PINs. Set a 4-digit PIN below to replace it.</p>}
          <p>
            <button type="button" class="btn" onClick={logOut} data-testid="pw-logout">Log out on this device</button>
          </p>
          {state.pin && <PasskeySettings key={round} />}
          <details open={!state.pin}>
            <summary>{state.pin ? 'Change the PIN' : 'Set a PIN instead'}</summary>
            <form class="pw-form" onSubmit={change}>
              <label>Current {currentName}{currentInput('current', 'pw-current')}</label>
              <label>New PIN (4 digits){pinInput('password', 'pw-new')}</label>
              <label>Type the new one again{pinInput('again', 'pw-again')}</label>
              <button type="submit" class="btn" disabled={!fields.current || !fields.password} data-testid="pw-change">{state.pin ? 'Change PIN' : 'Set PIN'}</button>
            </form>
          </details>
          <details>
            <summary>Turn the {state.pin ? 'PIN' : 'password'} off</summary>
            <form class="pw-form" onSubmit={turnOff}>
              <label>Current {currentName}{currentInput('offCurrent', 'pw-off-current')}</label>
              <button type="submit" class="btn" disabled={!fields.offCurrent} data-testid="pw-off">Turn off {state.pin ? 'PIN' : 'password'}</button>
            </form>
          </details>
          <p class="muted small">Changing the PIN or turning it off also removes every fingerprint / face unlock.</p>
          <p class="muted small">Forgot it? On the server run <code>sudo docker exec gordonite node server/cli.js password-off</code>, then set a new PIN here.</p>
        </>
      )}
      <p role="status" data-testid="pw-message">{message}</p>
    </section>
  );
}

// Fingerprint / face unlock: one passkey per device, made by that device's own fingerprint or face sensor. Listing and
// removing work anywhere; adding needs the https:// address (WebAuthn exists only in a secure context).
function PasskeySettings() {
  const [list, setList] = useState(null);
  const [name, setName] = useState(guessDeviceName);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const supported = passkeySupported();

  useEffect(() => {
    api.passkeys().then((r) => setList(r.passkeys)).catch((err) => setMessage(err.message));
  }, []);

  const add = async () => {
    setBusy(true);
    setMessage('');
    try {
      setList(await addPasskeyHere(name));
      setMessage('Fingerprint / face unlock is on for this device.');
    } catch (err) {
      setMessage(err.message);
    } finally {
      setBusy(false);
    }
  };
  const remove = async (p) => {
    if (!confirm(`Remove fingerprint / face unlock for “${p.label}”? It then needs the PIN.`)) return;
    setMessage('');
    try {
      setList((await api.removePasskey(p.id)).passkeys);
    } catch (err) {
      setMessage(err.message);
    }
  };

  return (
    <div class="passkeys" data-testid="passkey-settings">
      <h3>Fingerprint / face unlock</h3>
      {list?.length ? (
        <ul class="passkey-list">
          {list.map((p) => (
            <li key={p.id} data-testid="passkey-row">
              <span>
                <strong>{p.label}</strong>
                <span class="muted small"> added {new Date(p.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}</span>
              </span>
              <button type="button" class="btn small" onClick={() => remove(p)} data-testid="passkey-remove">Remove</button>
            </li>
          ))}
        </ul>
      ) : (
        list && <p class="muted small">No device unlocks with a fingerprint or face yet.</p>
      )}
      {supported ? (
        <div class="pw-form">
          <label>Name for this device<input type="text" maxlength={60} value={name} onInput={(e) => setName(e.currentTarget.value)} data-testid="passkey-name" /></label>
          <button type="button" class="btn" onClick={add} disabled={busy} data-testid="passkey-add">
            {busy ? 'Waiting for fingerprint / face…' : 'Add fingerprint / face unlock on this device'}
          </button>
        </div>
      ) : (
        <p class="muted small" data-testid="passkey-unsupported">To add fingerprint / face unlock, open Gordonite at its https:// address (it does not work at a plain http:// address).</p>
      )}
      {message && <p role="status" data-testid="passkey-message">{message}</p>}
    </div>
  );
}
