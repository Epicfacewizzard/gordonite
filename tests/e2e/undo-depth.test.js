import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launch, withPhone, open, editor } from './harness.js';

let browser;
before(async () => (browser = await launch()));
after(async () => browser.close());

// What "undo" can reach while a note is open (the README and docs/ATTACHMENTS.md quote these numbers). The editor is
// set to keep 100 steps; its engine only trims the oldest ones once the list is 20 past that, so in practice the
// reachable history is between 100 and 120 steps. A pause of more than half a second between keystrokes starts a
// new step; typing without a pause is one step.
test('undo reaches between 100 and 120 steps back; quick typing is one step', () =>
  withPhone(
    browser,
    async ({ page }) => {
      await open(page);
      await editor(page).tap();

      // 200 separate steps: one character, then a pause longer than the grouping delay.
      for (let i = 0; i < 200; i++) {
        await page.keyboard.type('x');
        await page.clock.fastForward(700);
      }
      const length = () => editor(page).evaluate((el) => el.textContent.length);
      assert.equal(await length(), 200);

      // far more undos than there are steps: only the most recent ones can be reached
      for (let i = 0; i < 250; i++) await page.keyboard.press('Control+z');
      const left = await length();
      const reached = 200 - left;
      assert.ok(reached >= 100 && reached <= 120, `undo reached ${reached} steps; expected 100 to 120`);

      // quick typing is one step
      await page.keyboard.type('quick');
      await page.keyboard.press('Control+z');
      assert.equal(await length(), left, 'five letters typed together undo together');
    },
    { clockTime: new Date('2026-10-12T18:00:00Z') },
  ));
