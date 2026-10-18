// Fingerprint / face unlock: WebAuthn passkeys next to the PIN (see docs/LOGIN.md).
//
// - Uses @simplewebauthn/server for the WebAuthn checks (challenge, origin, rpId hash, user verification, signature,
//   sign counter). The passkey itself never leaves the phone; the server keeps only its public key.
// - The relying party (rpId) is the host the request came to, never a fixed name: https://gordonite.duckdns.org gets
//   passkeys for gordonite.duckdns.org. Browsers allow WebAuthn only in a secure context and refuse IP addresses, so a
//   plain http://<LAN IP> address cannot use passkeys at all (the PIN still works there).
// - Challenges are made here, kept in memory for 5 minutes and used once.
// - Only a browser that is logged in, on an install with a 4-digit PIN, can add a passkey. The PIN stays the root of
//   trust: changing it or turning it off removes every passkey (server/auth.js).
import { generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse } from '@simplewebauthn/server';
import { HttpError } from './errors.js';

const CHALLENGE_MS = 5 * 60_000;
const MAX_LABEL = 60;
const MAX_PASSKEYS = 20;
// EdDSA, ES256 (what phones use), RS256 (Windows Hello). Named here so the library does not offer its experimental
// post-quantum algorithm, which also prints a Node warning.
const ALGORITHMS = [-8, -7, -257];

/** The relying party of a request: the hostname it was sent to (no port). Throws when passkeys cannot work there. */
export function relyingParty(req) {
  let url;
  try {
    url = new URL(`http://${req.headers.host ?? ''}`);
  } catch {
    url = null;
  }
  const rpId = url?.hostname ?? '';
  // An IP address is never a valid rpId; browsers refuse it, so say so plainly instead of failing later.
  if (!rpId || /^[\d.]+$/.test(rpId) || rpId.startsWith('[')) throw new HttpError(400, 'passkey_needs_https', 'Fingerprint / face unlock needs the https:// address');
  const local = rpId === 'localhost' || rpId.endsWith('.localhost');
  // The page's origin as the browser reports it. Only localhost counts as secure over plain http.
  const origins = [`https://${url.host}`, ...(local ? [`http://${url.host}`] : [])];
  return { rpId, origins };
}

export function createPasskeys(auth, { now = () => Date.now(), verifyRegistration = verifyRegistrationResponse, verifyAuthentication = verifyAuthenticationResponse } = {}) {
  const challenges = new Map(); // challenge -> { kind, rpId, expires }

  const remember = (challenge, kind, rpId) => {
    const t = now();
    for (const [c, v] of challenges) if (v.expires <= t) challenges.delete(c);
    challenges.set(challenge, { kind, rpId, expires: t + CHALLENGE_MS });
  };
  // Used once: a challenge is gone after the first answer, right or wrong.
  const take = (kind, rpId) => (challenge) => {
    const c = challenges.get(challenge);
    challenges.delete(challenge);
    return Boolean(c && c.kind === kind && c.rpId === rpId && c.expires > now());
  };
  // The same random handle for every passkey of this install, so a phone that registers again replaces its own.
  const userId = () => Buffer.from(auth.passkeyUserId(), 'hex');
  const here = (rpId) => auth.passkeys().filter((p) => p.rpId === rpId);

  const requireOwner = (req) => {
    if (!auth.enabled() || !auth.isPin()) throw new HttpError(400, 'pin_required', 'Set a 4-digit PIN first');
    if (!auth.loggedIn(req)) throw new HttpError(401, 'login_required', 'Log in to continue');
  };

  return {
    /** Is there a passkey for the host this request came to? Tells the login page whether to offer it. */
    availableFor(req) {
      if (!auth.enabled()) return false;
      try {
        return here(relyingParty(req).rpId).length > 0;
      } catch {
        return false;
      }
    },

    /** The saved passkeys for Settings (no keys). */
    list(req) {
      requireOwner(req);
      return auth.passkeys().map(({ id, label, createdAt, rpId }) => ({ id, label, createdAt, rpId }));
    },

    async registrationOptions(req) {
      requireOwner(req);
      const { rpId } = relyingParty(req);
      const options = await generateRegistrationOptions({
        rpName: 'Gordonite',
        rpID: rpId,
        userName: 'Gordonite',
        userDisplayName: 'Gordonite',
        userID: userId(),
        attestationType: 'none',
        excludeCredentials: here(rpId).map((p) => ({ id: p.id, transports: p.transports })),
        supportedAlgorithmIDs: ALGORITHMS,
        authenticatorSelection: { authenticatorAttachment: 'platform', residentKey: 'preferred', userVerification: 'required' },
      });
      remember(options.challenge, 'register', rpId);
      return options;
    },

    async register(req, { response, label } = {}) {
      requireOwner(req);
      const { rpId, origins } = relyingParty(req);
      let result;
      try {
        result = await verifyRegistration({ response, expectedChallenge: take('register', rpId), expectedOrigin: origins, expectedRPID: rpId, requireUserVerification: true, supportedAlgorithmIDs: ALGORITHMS });
      } catch (err) {
        throw new HttpError(400, 'passkey_rejected', `That did not work: ${err.message}`);
      }
      if (!result.verified) throw new HttpError(400, 'passkey_rejected', 'That did not work');
      const { credential } = result.registrationInfo;
      const list = auth.passkeys().filter((p) => p.id !== credential.id);
      if (list.length >= MAX_PASSKEYS) throw new HttpError(400, 'too_many_passkeys', `At most ${MAX_PASSKEYS} devices`);
      const name = typeof label === 'string' ? label.trim().slice(0, MAX_LABEL) : '';
      const saved = {
        id: credential.id,
        publicKey: Buffer.from(credential.publicKey).toString('base64url'),
        counter: credential.counter,
        transports: credential.transports ?? response?.response?.transports ?? [],
        rpId,
        label: name || 'This device',
        createdAt: new Date(now()).toISOString(),
      };
      auth.savePasskeys([...list, saved]);
      return { id: saved.id, label: saved.label, createdAt: saved.createdAt, rpId };
    },

    remove(req, id) {
      requireOwner(req);
      const list = auth.passkeys();
      const rest = list.filter((p) => p.id !== id);
      if (rest.length === list.length) throw new HttpError(404, 'not_found', 'No such device');
      auth.savePasskeys(rest);
    },

    async loginOptions(req) {
      if (!auth.enabled()) throw new HttpError(400, 'auth_off', 'No PIN is set');
      const { rpId } = relyingParty(req);
      const mine = here(rpId);
      if (!mine.length) throw new HttpError(400, 'no_passkey', 'No fingerprint / face unlock is set up for this address');
      const options = await generateAuthenticationOptions({ rpID: rpId, userVerification: 'required', allowCredentials: mine.map((p) => ({ id: p.id, transports: p.transports })) });
      remember(options.challenge, 'login', rpId);
      return options;
    },

    /** Checks a passkey answer; true when it is one of ours and verified. Moves its sign counter on. */
    async login(req, { response } = {}) {
      if (!auth.enabled()) throw new HttpError(400, 'auth_off', 'No PIN is set');
      const { rpId, origins } = relyingParty(req);
      const list = auth.passkeys();
      const saved = list.find((p) => p.id === response?.id && p.rpId === rpId);
      if (!saved) throw new HttpError(401, 'passkey_unknown', 'This device’s fingerprint / face unlock was removed. Use the PIN.');
      let result;
      try {
        result = await verifyAuthentication({
          response,
          expectedChallenge: take('login', rpId),
          expectedOrigin: origins,
          expectedRPID: rpId,
          requireUserVerification: true,
          credential: { id: saved.id, publicKey: Buffer.from(saved.publicKey, 'base64url'), counter: saved.counter, transports: saved.transports },
        });
      } catch (err) {
        throw new HttpError(401, 'passkey_rejected', `That did not work: ${err.message}`);
      }
      if (!result.verified) throw new HttpError(401, 'passkey_rejected', 'That did not work');
      auth.savePasskeys(list.map((p) => (p.id === saved.id ? { ...p, counter: result.authenticationInfo.newCounter } : p)));
      return true;
    },
  };
}
