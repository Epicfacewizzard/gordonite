import { useEffect, useRef, useState } from 'preact/hooks';
import { api } from '../api.js';
import { loginWithPasskey, passkeySupported } from '../passkey.js';

const PIN_LENGTH = 4;
/** Set by "Log out on this device", so the login page does not ask for the fingerprint straight away. */
export const LOGGED_OUT = 'gordonite-logged-out';

// Shown instead of the app when a PIN is set and this browser has not logged in (or the login ran out).
// Nothing else is drawn, and nothing the app holds is shown here. Anything typed on this device and not yet sent
// stays where it is (in the browser's own storage) and goes up once the login works.
//
// The PIN goes in by itself once the 4th digit is typed; a wrong one shakes, clears and waits for the next try.
// A longer password set before PINs (0.16.2) still gets the old text field until a PIN is set in Settings.
//
// When this address has fingerprint / face unlock (a passkey) and the browser can use it (a secure context: the
// https address, not http://<LAN IP>), the page asks for it once by itself and offers a button to ask again. The PIN
// boxes always stay underneath.
export function LoginView() {
  const [pinMode, setPinMode] = useState(true);
  const [value, setValue] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [shake, setShake] = useState(0);
  const [passkey, setPasskey] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const input = useRef(null);

  const unlock = async () => {
    setUnlocking(true);
    setMessage('');
    try {
      await loginWithPasskey();
      location.reload();
    } catch (err) {
      setMessage(err.message);
      setUnlocking(false);
    }
  };

  useEffect(() => {
    api
      .auth()
      .then((s) => {
        if (!s.enabled) return;
        setPinMode(s.pin !== false);
        if (!s.passkey || !passkeySupported()) return;
        setPasskey(true);
        // Once, by itself, unless this device has just logged out on purpose.
        let loggedOut = false;
        try {
          loggedOut = sessionStorage.getItem(LOGGED_OUT) !== null;
          sessionStorage.removeItem(LOGGED_OUT);
        } catch {
          /* no storage: ask anyway */
        }
        if (!loggedOut) unlock();
      })
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (!busy) input.current?.focus();
  }, [busy, pinMode]);

  const send = async (secret) => {
    setBusy(true);
    setMessage('');
    try {
      await api.login(secret);
      location.reload(); // starts the app fresh, which also sends anything waiting on this device
    } catch (err) {
      setValue('');
      setShake((n) => n + 1);
      // A wrong PIN needs no words; the shake says it. Anything else (the short lock, no server) is spelled out.
      if (!pinMode || err.code !== 'wrong_password') setMessage(err.message);
      setBusy(false);
    }
  };

  const onPin = (e) => {
    const digits = e.currentTarget.value.replace(/\D/g, '').slice(0, PIN_LENGTH);
    e.currentTarget.value = digits;
    setValue(digits);
    if (digits.length === PIN_LENGTH && !busy) send(digits);
  };
  const submitPassword = (e) => {
    e.preventDefault();
    send(value);
  };

  return (
    <main class="login" data-testid="login">
      <img class="login-logo" src="/icon-192.png" alt="" width="72" height="72" />
      <h1>Gordonite</h1>
      {passkey && (
        <button type="button" class="btn primary block passkey-btn" onClick={unlock} disabled={unlocking || busy} data-testid="login-passkey">
          {unlocking ? 'Waiting for fingerprint / face…' : 'Use fingerprint / face'}
        </button>
      )}
      {pinMode ? (
        <form onSubmit={(e) => e.preventDefault()}>
          <label class="pin-label" for="login-pin">PIN</label>
          <div class={`pin-boxes${shake ? ' pin-wrong' : ''}`} key={shake} onClick={() => input.current?.focus()}>
            <input
              id="login-pin"
              ref={input}
              class="pin-input"
              type="text"
              inputmode="numeric"
              pattern="[0-9]*"
              maxlength={PIN_LENGTH}
              autocomplete="current-password"
              value={value}
              onInput={onPin}
              disabled={busy}
              aria-label="PIN"
              data-testid="login-pin"
            />
            {Array.from({ length: PIN_LENGTH }, (_, i) => (
              <span class={`pin-box${i < value.length ? ' filled' : ''}${i === value.length ? ' current' : ''}`} aria-hidden="true" />
            ))}
          </div>
        </form>
      ) : (
        <form onSubmit={submitPassword}>
          <label>
            Password
            <input ref={input} type="password" value={value} onInput={(e) => setValue(e.currentTarget.value)} autocomplete="current-password" data-testid="login-password" />
          </label>
          <button type="submit" class="btn primary block" disabled={busy || !value} data-testid="login-submit">
            {busy ? 'Checking…' : 'Log in'}
          </button>
          <p class="muted small">Gordonite still has its old password. Once you are in, set a 4-digit PIN in Settings.</p>
        </form>
      )}
      {message && (
        <p class="error" role="alert" data-testid="login-error">
          {message}
        </p>
      )}
      <p class="muted small">Anything you wrote on this device that has not been sent yet is kept, and goes up once you are in.</p>
    </main>
  );
}
