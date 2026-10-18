// Fingerprint / face unlock (WebAuthn passkeys; see docs/LOGIN.md). The browser does the work through
// @simplewebauthn/browser; the server makes and checks the challenges (server/passkeys.js).
//
// Passkeys exist only in a secure context: https://gordonite.duckdns.org (or localhost), never http://<LAN IP>.
import { startAuthentication, startRegistration } from '@simplewebauthn/browser';
import { api } from './api.js';

// http://127.0.0.1 counts as a secure context, but an IP address can never hold a passkey, so it is left out too.
export const passkeySupported = () =>
  typeof window !== 'undefined' && window.isSecureContext === true && typeof window.PublicKeyCredential === 'function' && !/^[\d.]+$|^\[/.test(location.hostname);

/** Unlock with this device's fingerprint / face. Resolves once logged in; throws with a readable message otherwise. */
export async function loginWithPasskey() {
  const optionsJSON = await api.passkeyLoginOptions();
  let response;
  try {
    response = await startAuthentication({ optionsJSON });
  } catch (err) {
    throw new Error(explain(err));
  }
  await api.passkeyLogin(response);
}

/** Add this device's fingerprint / face. Returns the server's list of saved devices. */
export async function addPasskeyHere(label) {
  const optionsJSON = await api.passkeyOptions();
  let response;
  try {
    response = await startRegistration({ optionsJSON });
  } catch (err) {
    if (err?.name === 'InvalidStateError' || err?.code === 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED') throw new Error('This device already has fingerprint / face unlock.');
    throw new Error(explain(err));
  }
  return (await api.addPasskey(response, label)).passkeys;
}

/** A short name for this device, to tell the saved ones apart. */
export function guessDeviceName() {
  const ua = navigator.userAgent;
  if (/Android/.test(ua)) return /Mobile/.test(ua) ? 'Android phone' : 'Android tablet';
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  if (/Windows/.test(ua)) return 'Windows PC';
  if (/Macintosh/.test(ua)) return 'Mac';
  return 'This device';
}

function explain(err) {
  // Cancelled, timed out, or no fingerprint / face set up on the device: the browser does not say which.
  if (err?.name === 'NotAllowedError' || err?.code === 'ERROR_CEREMONY_ABORTED') return 'Fingerprint / face unlock was cancelled. Use the PIN.';
  return err?.message || 'Fingerprint / face unlock did not work. Use the PIN.';
}
