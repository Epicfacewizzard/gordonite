import { useState } from 'preact/hooks';
import { api } from '../api.js';

// Shown instead of the app when a password is set and this browser has not logged in (or the login ran out).
// Nothing else is drawn, and nothing the app holds is shown here. Anything typed on this device and not yet sent
// stays where it is (in the browser's own storage) and goes up once the login works.
export function LoginView() {
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      await api.login(password);
      location.reload(); // starts the app fresh, which also sends anything waiting on this device
    } catch (err) {
      setMessage(err.message);
      setBusy(false);
    }
  };

  return (
    <main class="login" data-testid="login">
      <img class="login-logo" src="/icon-192.png" alt="" width="72" height="72" />
      <h1>Gordonite</h1>
      <form onSubmit={submit}>
        <label>
          Password
          <input type="password" value={password} onInput={(e) => setPassword(e.currentTarget.value)} autocomplete="current-password" autofocus data-testid="login-password" />
        </label>
        <button type="submit" class="btn primary block" disabled={busy || !password} data-testid="login-submit">
          {busy ? 'Checking…' : 'Log in'}
        </button>
      </form>
      {message && (
        <p class="error" role="alert" data-testid="login-error">
          {message}
        </p>
      )}
      <p class="muted small">Anything you wrote on this device that has not been sent yet is kept, and goes up once you are in.</p>
    </main>
  );
}
