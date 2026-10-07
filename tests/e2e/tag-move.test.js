import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launch, withPhone, expectNoPageErrors } from './harness.js';
let browser;
before(async () => { browser = await launch(); });
after(async () => { await browser.close(); });

// Carry a tag by its grip and hold over `target` at `fraction` of its height (0 = top edge, 0.5 = middle, 1 = bottom).
async function carry(page, grip, target, fraction) {
  const g = await grip.boundingBox();
  await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
  await page.mouse.down();
  const t = await target.boundingBox(); // the top-level drop zone only exists once a drag has begun
  await page.mouse.move(t.x + t.width / 2, t.y + t.height * fraction, { steps: 8 });
  await page.waitForTimeout(150);
}
const rowFor = (page, path) => page.locator(`[data-drop="${path}"]`);
const gripFor = (page, path) => rowFor(page, path).getByTestId('tag-grip');
const names = (app) => app.api('GET', '/api/tags').then((r) => r.json.tags.map((t) => t.path).sort());

test('tags start collapsed; dragging nests, reorders and un-nests with a clear drop indicator', () => withPhone(browser, async ({ app, page }) => {
  for (const path of ['alpha', 'beta/one', 'beta/two', 'gamma']) await app.api('POST', '/api/tags', { path });
  await page.goto(`${app.url}/#/tags`);
  await page.getByTestId('tag-folder').waitFor();
  assert.equal(await page.locator('details[open]').count(), 0, 'every parent starts collapsed');
  assert.equal(await page.getByTestId('tag-link').filter({ hasText: 'beta/one' }).isVisible(), false);

  // Over the middle of a tag it is highlighted: dropping puts the tag inside.
  await carry(page, gripFor(page, 'gamma'), rowFor(page, 'alpha'), 0.5);
  assert.equal(await rowFor(page, 'alpha').evaluate((el) => el.classList.contains('drop-into')), true);
  assert.equal(await rowFor(page, 'alpha').evaluate((el) => el.className.includes('drop-before') || el.className.includes('drop-after')), false);
  await page.mouse.up();
  await page.waitForFunction(async () => (await (await fetch('/api/tags')).json()).tags.some((t) => t.path === 'alpha/gamma'));
  assert.deepEqual(await names(app), ['alpha', 'alpha/gamma', 'beta/one', 'beta/two']);

  // Over the edge between tags a line shows instead, and the tag is reordered rather than nested.
  await carry(page, gripFor(page, 'beta'), rowFor(page, 'alpha'), 0.05);
  assert.equal(await rowFor(page, 'alpha').evaluate((el) => el.classList.contains('drop-before')), true);
  assert.equal(await rowFor(page, 'alpha').evaluate((el) => el.classList.contains('drop-into')), false);
  await page.mouse.up();
  await page.waitForFunction(async () => (await (await fetch('/api/tags')).json()).order?.[''] ?.[0] === 'beta');
  assert.deepEqual(await names(app), ['alpha', 'alpha/gamma', 'beta/one', 'beta/two'], 'reordering does not rename anything');
  const topLevel = await page.locator('.home > .tag-list > li').evaluateAll((lis) => lis.map((li) => li.textContent.replace(/\s+/g, ' ').trim().slice(0, 12)));
  assert.match(topLevel[0], /beta/);

  // Drag out: alpha opened itself to show where gamma landed; carry gamma to the top-level zone.
  await gripFor(page, 'alpha/gamma').waitFor();
  await carry(page, gripFor(page, 'alpha/gamma'), page.locator('[data-drop-root]'), 0.5);
  assert.equal(await page.locator('[data-drop-root]').evaluate((el) => el.classList.contains('drop-into')), true);
  await page.mouse.up();
  await page.waitForFunction(async () => (await (await fetch('/api/tags')).json()).tags.some((t) => t.path === 'gamma'));
  assert.deepEqual(await names(app), ['alpha', 'beta/one', 'beta/two', 'gamma']);

  // A tag cannot be dropped into itself: no target is offered.
  await carry(page, gripFor(page, 'beta'), page.locator('summary').filter({ hasText: 'beta' }), 0.5);
  assert.equal(await page.locator('.drop-into, .drop-before, .drop-after').count(), 0);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  assert.deepEqual(await names(app), ['alpha', 'beta/one', 'beta/two', 'gamma'], 'Escape cancels a drag');
  expectNoPageErrors(page, assert);
}));

test('a move that collides with an existing tag shows the server message and changes nothing', () => withPhone(browser, async ({ app, page }) => {
  for (const path of ['x/dup', 'y', 'dup']) await app.api('POST', '/api/tags', { path });
  await page.goto(`${app.url}/#/tags`);
  await page.getByTestId('tag-folder').waitFor();
  await carry(page, gripFor(page, 'dup'), rowFor(page, 'x'), 0.5);
  await page.mouse.up();
  await page.getByRole('alert').filter({ hasText: 'already exists' }).waitFor();
  assert.deepEqual(await names(app), ['dup', 'x/dup', 'y']);
}));
