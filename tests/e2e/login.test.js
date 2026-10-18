import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { launch, withPhone, waitSaved } from './harness.js';

let browser;
before(async () => (browser = await launch()));
after(async () => browser.close());

// What 0.16.1 and earlier stored for a text password: the same scrypt record, without `pin: true`.
function setLegacyPassword(db, password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 32);
  db.prepare("INSERT INTO meta (key, value) VALUES ('auth_password', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(JSON.stringify({ salt: salt.toString('hex'), hash: hash.toString('hex'), gen: 1 }));
}

test('with a PIN set the app shows only the PIN boxes; a wrong PIN shakes and clears, the right one goes in by itself and stays in', () =>
  withPhone(browser, async ({ page, app }) => {
    assert.equal((await app.api('PUT', '/api/auth/password', { password: '4821' })).status, 200);
    await page.goto(`${app.url}/#/`);
    await page.getByTestId('login').waitFor();
    assert.equal(await page.getByTestId('tabbar').count(), 0, 'no app behind it');
    const pin = page.getByTestId('login-pin');
    assert.equal(await pin.getAttribute('inputmode'), 'numeric', 'phones show the number pad');
    assert.equal(await page.getByTestId('login-submit').count(), 0, 'no button to press');
    assert.equal(await page.locator('.pin-box').count(), 4);

    await pin.tap();
    await page.keyboard.type('0000');
    await page.locator('.pin-wrong').waitFor();
    await page.waitForFunction(() => document.querySelector('[data-testid="login-pin"]').value === '' && !document.querySelector('[data-testid="login-pin"]').disabled);
    assert.equal(await page.getByTestId('tabbar').count(), 0);
    assert.equal(await page.getByTestId('login-error').count(), 0, 'a wrong PIN is not an error page');

    await page.keyboard.type('12'); // straight on, no tap needed: the field kept its focus
    await page.waitForFunction(() => document.querySelectorAll('.pin-box.filled').length === 2); // typed digits show as dots
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Backspace');
    await page.keyboard.type('4821');
    await page.getByTestId('tabbar').waitFor();
    assert.equal(await page.getByTestId('title').innerText(), 'Dashboard');

    await page.reload();
    await page.getByTestId('tabbar').waitFor();
    assert.equal(await page.getByTestId('login').count(), 0, 'still logged in after a reload');

    await page.goto(`${app.url}/#/settings`);
    await page.getByTestId('pw-state').waitFor();
    await page.getByTestId('pw-logout').tap();
    await page.getByTestId('login').waitFor();
    assert.deepEqual(page.errors.filter((e) => !/401|Failed to load resource/i.test(e)), []);
  }));

test('several wrong PINs in a row still let you keep typing', () =>
  withPhone(browser, async ({ page, app }) => {
    await app.api('PUT', '/api/auth/password', { password: '4821' });
    await page.goto(`${app.url}/#/`);
    await page.getByTestId('login-pin').tap();
    for (const guess of ['1111', '2222', '3333', '4444', '5555', '6666']) {
      await page.keyboard.type(guess);
      await page.waitForFunction(() => document.querySelector('[data-testid="login-pin"]').value === '' && !document.querySelector('[data-testid="login-pin"]').disabled);
    }
    await page.keyboard.type('4821');
    await page.getByTestId('tabbar').waitFor();
  }));

test('a login that runs out while the app is open brings up the login page, and what was typed is not lost', () =>
  withPhone(browser, async ({ page, app }) => {
    await page.goto(`${app.url}/#/t/daily-jots`);
    const editor = page.locator('.note-text[contenteditable="true"]');
    await editor.waitFor();
    await app.api('PUT', '/api/auth/password', { password: '4821' }); // turned on from another device: this browser has no login
    await editor.tap();
    await page.keyboard.type('written while locked out');
    await page.getByTestId('login').waitFor();
    assert.equal(await page.evaluate(() => /written while locked out/.test(JSON.stringify(Object.assign({}, localStorage)))), false, 'nothing leaks into the login page');

    await page.getByTestId('login-pin').fill('4821');
    await page.waitForSelector('.note-text[contenteditable="true"]');
    await waitSaved(page);
    assert.match(app.notes().map((n) => n.doc).join(' '), /written while locked out/, 'the words were kept on the phone and sent after logging in');
  }));

test('an install with a password from before PINs keeps its text login until a PIN is set in Settings', () =>
  withPhone(browser, async ({ page, app }) => {
    setLegacyPassword(app.db, 'old long password');
    await page.goto(`${app.url}/#/`);
    await page.getByTestId('login-password').waitFor();
    assert.equal(await page.getByTestId('login-pin').count(), 0);
    await page.getByTestId('login-password').fill('not the one');
    await page.getByTestId('login-submit').tap();
    await page.getByTestId('login-error').waitFor();
    assert.match(await page.getByTestId('login-error').innerText(), /not right/i);
    await page.getByTestId('login-password').fill('old long password');
    await page.getByTestId('login-submit').tap();
    await page.getByTestId('tabbar').waitFor();

    await page.goto(`${app.url}/#/settings`);
    await page.getByTestId('pw-legacy').waitFor();
    await page.getByTestId('pw-current').fill('old long password');
    await page.getByTestId('pw-new').fill('1357');
    await page.getByTestId('pw-again').fill('1357');
    await page.getByTestId('pw-change').tap();
    await page.getByText('PIN changed').waitFor();
    assert.deepEqual((await app.api('GET', '/api/auth')).json, { enabled: true, loggedIn: false, pin: true, passkey: false });
    assert.equal(await page.getByTestId('pw-legacy').count(), 0);
  }));

test('Settings turns the PIN on and off; it is exactly 4 digits, the two entries must match; turning it off needs the current one', () =>
  withPhone(browser, async ({ page, app }) => {
    await page.goto(`${app.url}/#/settings`);
    await page.getByTestId('pw-turn-on').waitFor();
    assert.equal((await app.api('GET', '/api/auth')).json.enabled, false, 'off by default');
    assert.equal(await page.getByTestId('pw-new').getAttribute('inputmode'), 'numeric');

    await page.getByTestId('pw-new').fill('1234');
    await page.getByTestId('pw-again').fill('4321');
    await page.getByTestId('pw-turn-on').tap();
    await page.getByText('do not match').waitFor();
    assert.equal((await app.api('GET', '/api/auth')).json.enabled, false);

    await page.getByTestId('pw-new').fill('12a');
    assert.equal(await page.getByTestId('pw-new').inputValue(), '12', 'only digits go in');
    await page.getByTestId('pw-again').fill('12');
    await page.getByTestId('pw-turn-on').tap();
    await page.getByText('exactly 4 digits').waitFor();
    assert.equal((await app.api('GET', '/api/auth')).json.enabled, false, 'too short is refused');

    await page.getByTestId('pw-new').fill('2468');
    await page.getByTestId('pw-again').fill('2468');
    await page.getByTestId('pw-turn-on').tap();
    await page.getByTestId('pw-state').waitFor();
    assert.equal((await app.api('GET', '/api/auth')).json.enabled, true);
    await page.reload();
    await page.getByTestId('pw-state').waitFor(); // this browser stayed logged in

    await page.getByText('Turn the PIN off').tap();
    await page.getByTestId('pw-off-current').fill('1111');
    await page.getByTestId('pw-off').tap();
    await page.getByText('current PIN is not right').waitFor();
    assert.equal((await app.api('GET', '/api/auth')).json.enabled, true);

    await page.getByTestId('pw-off-current').fill('2468');
    await page.getByTestId('pw-off').tap();
    await page.getByTestId('pw-turn-on').waitFor();
    assert.equal((await app.api('GET', '/api/auth')).json.enabled, false);
  }));
