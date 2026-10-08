import { useEffect, useState } from 'preact/hooks';
import { api } from '../api.js';

const EMPTY = { current: '', password: '', again: '', offCurrent: '' };

// Settings → Password. Off by default. When it is on, every browser has to log in once (it then stays logged in
// for 30 days). The password itself is kept only as a hash on the server (see docs/LOGIN.md).
export function PasswordSettings() {
  const [state, setState] = useState(null); // { enabled, loggedIn }
  const [message, setMessage] = useState('');
  const [fields, setFields] = useState(EMPTY);
  const set = (key) => (e) => setFields((f) => ({ ...f, [key]: e.currentTarget.value }));

  useEffect(() => {
    api.auth().then(setState).catch(() => setMessage('Can’t reach the server.'));
  }, []);

  const run = async (call, done) => {
    setMessage('');
    try {
      setState(await call());
      setFields(EMPTY);
      setMessage(done);
    } catch (err) {
      setMessage(err.message);
    }
  };
  const mismatch = () => {
    if (fields.password === fields.again) return false;
    setMessage('The two new passwords do not match.');
    return true;
  };
  const turnOn = (e) => {
    e.preventDefault();
    if (!mismatch()) run(() => api.setPassword(fields.password), 'The password is on. Other devices will ask for it.');
  };
  const change = (e) => {
    e.preventDefault();
    if (!mismatch()) run(() => api.setPassword(fields.password, fields.current), 'Password changed. Other devices will ask for the new one.');
  };
  const turnOff = (e) => {
    e.preventDefault();
    run(() => api.passwordOff(fields.offCurrent), 'The password is off.');
  };
  const logOut = async () => {
    await api.logout().catch(() => {});
    location.reload();
  };

  return (
    <section data-testid="password-settings">
      <h2 class="section">Password</h2>
      <p class="muted small">
        Off by default. When it is on, anyone opening the app on any device has to type it first (a device then stays logged in for 30 days). Your notes do not change.
        The VPN is still your main protection; this is a second lock.
      </p>
      {state === null && !message && <p class="muted small">Checking…</p>}
      {state && !state.enabled && (
        <form class="pw-form" onSubmit={turnOn}>
          <label>New password (at least 6 characters)<input type="password" autocomplete="new-password" value={fields.password} onInput={set('password')} data-testid="pw-new" /></label>
          <label>Type it again<input type="password" autocomplete="new-password" value={fields.again} onInput={set('again')} data-testid="pw-again" /></label>
          <button type="submit" class="btn" disabled={!fields.password} data-testid="pw-turn-on">Turn on password</button>
        </form>
      )}
      {state?.enabled && (
        <>
          <p data-testid="pw-state">The password is <strong>on</strong>.</p>
          <p>
            <button type="button" class="btn" onClick={logOut} data-testid="pw-logout">Log out on this device</button>
          </p>
          <details>
            <summary>Change the password</summary>
            <form class="pw-form" onSubmit={change}>
              <label>Current password<input type="password" autocomplete="current-password" value={fields.current} onInput={set('current')} data-testid="pw-current" /></label>
              <label>New password<input type="password" autocomplete="new-password" value={fields.password} onInput={set('password')} data-testid="pw-new" /></label>
              <label>Type the new one again<input type="password" autocomplete="new-password" value={fields.again} onInput={set('again')} data-testid="pw-again" /></label>
              <button type="submit" class="btn" disabled={!fields.current || !fields.password} data-testid="pw-change">Change password</button>
            </form>
          </details>
          <details>
            <summary>Turn the password off</summary>
            <form class="pw-form" onSubmit={turnOff}>
              <label>Current password<input type="password" autocomplete="current-password" value={fields.offCurrent} onInput={set('offCurrent')} data-testid="pw-off-current" /></label>
              <button type="submit" class="btn" disabled={!fields.offCurrent} data-testid="pw-off">Turn off password</button>
            </form>
          </details>
          <p class="muted small">Forgot it? On the server run <code>sudo docker exec gordonite node server/cli.js password-off</code>, then set a new one here.</p>
        </>
      )}
      <p role="status" data-testid="pw-message">{message}</p>
    </section>
  );
}
