// Fingerprint / face unlock in a real browser. Chromium's virtual authenticator (DevTools WebAuthn domain) plays the
// phone's fingerprint sensor. Passkeys need a host name, not an IP address, so the page is opened as localhost
// (a secure context over plain http, like https://gordonite.duckdns.org is on the phone).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launch, withPhone } from './harness.js';

let browser;
before(async () => (browser = await launch()));
after(async () => browser.close());

async function fingerprintSensor(context, page) {
  const cdp = await context.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });
  return {
    credentials: async () => (await cdp.send('WebAuthn.getCredentials', { authenticatorId })).credentials,
    fingerprintMatches: (yes) => cdp.send('WebAuthn.setUserVerified', { authenticatorId, isUserVerified: yes }),
  };
}

test('add fingerprint unlock in Settings, then the login page unlocks with it (by itself, or with the button); the PIN stays underneath', () =>
  withPhone(browser, async ({ page, app, context }) => {
    const sensor = await fingerprintSensor(context, page);
    const home = app.url.replace('127.0.0.1', 'localhost');
    await app.api('PUT', '/api/auth/password', { password: '4821' });

    await page.goto(`${home}/#/`);
    await page.getByTestId('login-pin').waitFor();
    assert.equal(await page.getByTestId('login-passkey').count(), 0, 'no passkey yet: only the PIN');
    await page.getByTestId('login-pin').fill('4821');
    await page.getByTestId('tabbar').waitFor();

    await page.goto(`${home}/#/settings`);
    await page.getByTestId('passkey-settings').waitFor();
    await page.getByText('No device unlocks with a fingerprint or face yet.').waitFor();
    await page.getByTestId('passkey-name').fill('Test phone');
    await page.getByTestId('passkey-add').tap();
    await page.getByText('Fingerprint / face unlock is on for this device.').waitFor();
    assert.match(await page.getByTestId('passkey-row').innerText(), /Test phone\s+added \w{3} \d{1,2}, \d{4}/);
    const [cred] = await sensor.credentials();
    assert.equal(cred.rpId, 'localhost');
    assert.equal((await sensor.credentials()).length, 1);

    // Logging out on purpose: the login page offers the fingerprint but does not ask at once.
    await page.getByTestId('pw-logout').tap();
    await page.getByTestId('login-passkey').waitFor();
    await page.getByTestId('login-pin').waitFor();
    assert.equal(await page.getByTestId('tabbar').count(), 0);
    await page.getByTestId('login-passkey').tap();
    await page.getByTestId('tabbar').waitFor();

    // A browser whose login is gone (30 days later, say): it asks for the fingerprint by itself, once.
    await context.clearCookies();
    const unlocked = page.waitForResponse((r) => r.url().endsWith('/api/auth/passkey/login') && r.status() === 200);
    await page.goto(`${home}/#/`);
    await unlocked; // no tap: it asked by itself
    await page.waitForLoadState();
    await page.getByTestId('tabbar').waitFor();
    assert.equal(await page.getByTestId('login').count(), 0);

    // The finger does not match: the page says so, and the PIN boxes are right there.
    await sensor.fingerprintMatches(false);
    await context.clearCookies();
    await page.goto(`${home}/#/`);
    await page.getByTestId('login-error').waitFor();
    assert.match(await page.getByTestId('login-error').innerText(), /Use the PIN/);
    assert.equal(await page.getByTestId('login-passkey').isEnabled(), true, 'the button can try again');
    await page.getByTestId('login-pin').fill('4821');
    await page.getByTestId('tabbar').waitFor();
    await sensor.fingerprintMatches(true);

    // Removing it in Settings: the login page is back to the PIN alone.
    page.on('dialog', (d) => d.accept());
    await page.goto(`${home}/#/settings`);
    await page.getByTestId('passkey-remove').tap();
    await page.getByText('No device unlocks with a fingerprint or face yet.').waitFor();
    await page.getByTestId('pw-logout').tap();
    await page.getByTestId('login-pin').waitFor();
    assert.equal(await page.getByTestId('login-passkey').count(), 0);
    assert.deepEqual(page.errors.filter((e) => !/401|Failed to load resource/i.test(e)), []);
    page.errors.length = 0;
  }));

test('changing the PIN removes fingerprint unlock everywhere', () =>
  withPhone(browser, async ({ page, app, context }) => {
    await fingerprintSensor(context, page);
    const home = app.url.replace('127.0.0.1', 'localhost');
    await app.api('PUT', '/api/auth/password', { password: '4821' });
    await page.goto(`${home}/#/`);
    await page.getByTestId('login-pin').fill('4821');
    await page.getByTestId('tabbar').waitFor();
    await page.goto(`${home}/#/settings`);
    await page.getByTestId('passkey-add').tap();
    await page.getByTestId('passkey-row').waitFor();

    await page.getByText('Change the PIN').tap();
    await page.getByTestId('pw-current').fill('4821');
    await page.getByTestId('pw-new').fill('7305');
    await page.getByTestId('pw-again').fill('7305');
    // The keyboard's Go key. (A tap on the button lands after the tab bar comes back on blur and shifts the page.)
    await page.getByTestId('pw-again').press('Enter');
    await page.getByText('PIN changed').waitFor();
    await page.getByText('No device unlocks with a fingerprint or face yet.').waitFor();
    assert.equal(await page.getByTestId('passkey-row').count(), 0);
    assert.equal((await app.api('GET', '/api/auth')).json.passkey, false);
  }));

test('at a plain IP address Settings explains that fingerprint unlock needs the https address, and offers no button', () =>
  withPhone(browser, async ({ page, app }) => {
    await app.api('PUT', '/api/auth/password', { password: '4821' });
    await page.goto(`${app.url}/#/`);
    await page.getByTestId('login-pin').fill('4821');
    await page.getByTestId('tabbar').waitFor();
    await page.goto(`${app.url}/#/settings`);
    await page.getByTestId('passkey-unsupported').waitFor();
    assert.equal(await page.getByTestId('passkey-add').count(), 0);
  }));
