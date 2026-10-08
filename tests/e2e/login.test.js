import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launch, withPhone, waitSaved } from './harness.js';

let browser;
before(async () => (browser = await launch()));
after(async () => browser.close());

test('with a password set the app shows only the login page; a wrong password is refused, the right one lets you in and stays in', () =>
  withPhone(browser, async ({ page, app }) => {
    assert.equal((await app.api('PUT', '/api/auth/password', { password: 'open sesame' })).status, 200);
    await page.goto(`${app.url}/#/`);
    await page.getByTestId('login').waitFor();
    assert.equal(await page.getByTestId('tabbar').count(), 0, 'no app behind it');
    assert.equal(await page.getByTestId('login-submit').isDisabled(), true, 'nothing to send yet');

    await page.getByTestId('login-password').fill('not the one');
    await page.getByTestId('login-submit').tap();
    await page.getByTestId('login-error').waitFor();
    assert.match(await page.getByTestId('login-error').innerText(), /not right/i);
    assert.equal(await page.getByTestId('tabbar').count(), 0);

    await page.getByTestId('login-password').fill('open sesame');
    await page.getByTestId('login-submit').tap();
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

test('a login that runs out while the app is open brings up the login page, and what was typed is not lost', () =>
  withPhone(browser, async ({ page, app }) => {
    await page.goto(`${app.url}/#/t/daily-jots`);
    const editor = page.locator('.note-text[contenteditable="true"]');
    await editor.waitFor();
    await app.api('PUT', '/api/auth/password', { password: 'open sesame' }); // turned on from another device: this browser has no login
    await editor.tap();
    await page.keyboard.type('written while locked out');
    await page.getByTestId('login').waitFor();
    assert.equal(await page.evaluate(() => /written while locked out/.test(JSON.stringify(Object.assign({}, localStorage)))), false, 'nothing leaks into the login page');

    await page.getByTestId('login-password').fill('open sesame');
    await page.getByTestId('login-submit').tap();
    await page.waitForSelector('.note-text[contenteditable="true"]');
    await waitSaved(page);
    assert.match(app.notes().map((n) => n.doc).join(' '), /written while locked out/, 'the words were kept on the phone and sent after logging in');
  }));

test('Settings turns the password on and off; the two entries must match; turning it off needs the current one', () =>
  withPhone(browser, async ({ page, app }) => {
    await page.goto(`${app.url}/#/settings`);
    await page.getByTestId('pw-turn-on').waitFor();
    assert.equal((await app.api('GET', '/api/auth')).json.enabled, false, 'off by default');

    await page.getByTestId('pw-new').fill('first try');
    await page.getByTestId('pw-again').fill('different');
    await page.getByTestId('pw-turn-on').tap();
    await page.getByText('do not match').waitFor();
    assert.equal((await app.api('GET', '/api/auth')).json.enabled, false);

    await page.getByTestId('pw-new').fill('short');
    await page.getByTestId('pw-again').fill('short');
    await page.getByTestId('pw-turn-on').tap();
    await page.getByText('at least 6').last().waitFor();
    assert.equal((await app.api('GET', '/api/auth')).json.enabled, false, 'too short is refused');

    await page.getByTestId('pw-new').fill('long enough');
    await page.getByTestId('pw-again').fill('long enough');
    await page.getByTestId('pw-turn-on').tap();
    await page.getByTestId('pw-state').waitFor();
    assert.equal((await app.api('GET', '/api/auth')).json.enabled, true);
    await page.reload();
    await page.getByTestId('pw-state').waitFor(); // this browser stayed logged in

    await page.getByText('Turn the password off').tap();
    await page.getByTestId('pw-off-current').fill('wrong one');
    await page.getByTestId('pw-off').tap();
    await page.getByText('current password is not right').waitFor();
    assert.equal((await app.api('GET', '/api/auth')).json.enabled, true);

    await page.getByTestId('pw-off-current').fill('long enough');
    await page.getByTestId('pw-off').tap();
    await page.getByTestId('pw-turn-on').waitFor();
    assert.equal((await app.api('GET', '/api/auth')).json.enabled, false);
  }));
