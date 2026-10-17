import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launch, withPhone, seedNote, paragraphDoc, editor, waitSaved, newId } from './harness.js';

let browser;
before(async () => (browser = await launch()));
after(async () => browser.close());

async function freeNote(app, title, tags, date, ...texts) {
  const id = newId();
  const r = await app.api('PUT', `/api/notes/${id}`, { baseRevision: 0, kind: 'note', title, doc: paragraphDoc(...texts), docFormat: 2, tags, date });
  if (r.status !== 200) throw new Error(JSON.stringify(r.json));
  return id;
}

test('Linked from lists the linking notes; a rename rewrites their links; "[[" suggests names', () =>
  withPhone(browser, async ({ app, page }) => {
    const target = await freeNote(app, 'Trip ideas', ['trips'], '2026-10-01', 'Somewhere warm');
    const linking = await seedNote(app, { date: '2026-10-02', doc: paragraphDoc('Read [[Trip ideas]] tonight') });

    await page.goto(`${app.url}/#/n/${target}`);
    const section = page.getByTestId('backlinks');
    await section.getByRole('heading', { name: /Linked from/ }).waitFor();
    assert.equal(await section.getByTestId('backlink').count(), 1);
    assert.match(await section.getByTestId('backlink').innerText(), /daily-jots[\s\S]*Read \[\[Trip ideas\]\] tonight/);

    // Rename: the linking note now names the new title, and is still listed.
    await page.getByTestId('note-title').fill('Trip plan');
    await waitSaved(page);
    await page.waitForFunction(() => document.querySelector('[data-testid="backlink"]')?.innerText.includes('[[Trip plan]]'));
    assert.equal(app.docText(linking), 'Read [[Trip plan]] tonight');
    const versions = (await app.api('GET', `/api/notes/${linking}/versions`)).json.versions;
    assert.equal(versions[0].kind, 'link');

    // Follow the backlink, then link again with the suggestions.
    await section.getByRole('link', { name: /daily-jots/ }).click();
    await page.waitForURL(`**/#/n/${linking}`);
    await page.locator(`[data-testid="note-page"][data-note-id="${linking}"] .note-text`).waitFor();
    await editor(page).click({ position: { x: 3, y: 5 } }); // not the middle: that is the link's open arrow
    await page.keyboard.press('Control+End');
    await page.keyboard.type(' and [[tri');
    const list = page.getByTestId('link-suggest');
    await list.getByRole('option', { name: /Trip plan/ }).waitFor();
    await page.keyboard.press('Enter');
    await list.waitFor({ state: 'detached' });
    await waitSaved(page);
    assert.equal(app.docText(linking), 'Read [[Trip plan]] tonight and [[Trip plan]]');

    // Escape closes the list without writing anything.
    await page.keyboard.type(' [[');
    await list.waitFor();
    await page.keyboard.press('Escape');
    await list.waitFor({ state: 'detached' });
    await waitSaved(page);
    assert.equal(app.docText(linking), 'Read [[Trip plan]] tonight and [[Trip plan]] [[');
  }));

test('a person is "Mentioned in" the notes that link them by name or by an Also called name', () =>
  withPhone(browser, async ({ app, page }) => {
    const sam = await freeNote(app, 'Samantha Lee', ['05-people'], '2026-10-01', 'VP events');
    await app.api('PUT', `/api/people/${sam}`, { profile: { aliases: ['Sammy'] } });
    const lunch = await freeNote(app, 'Lunch', ['school'], '2026-10-03', 'Lunch with [[Sammy]]');
    await freeNote(app, 'Call', ['school'], '2026-10-02', 'Called [[Samantha Lee]]');

    await page.goto(`${app.url}/#/n/${lunch}`);
    await page.locator('a[href="#/link/Sammy"]').first().click();
    await page.waitForURL(`**/#/n/${sam}`);
    const section = page.getByTestId('backlinks');
    await section.getByRole('heading', { name: /Mentioned in/ }).waitFor();
    assert.deepEqual(await section.locator('.backlink-title').allInnerTexts(), ['Lunch', 'Call']);
  }));
