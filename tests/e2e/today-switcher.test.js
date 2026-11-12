import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { uuid } from '../../shared/ids.js';
import { dateInTz } from '../../shared/dates.js';
import { launch, TZ, withPhone, waitSaved } from './harness.js';

let browser;
before(async () => (browser = await launch()));
after(async () => browser.close());

const today = () => dateInTz(new Date(), TZ);
const editor = (page) => page.locator('[data-testid="widget-note"] .note-text[contenteditable="true"]');

async function addFavoriteDailyTag(app, path) {
  const tag = (await app.api('POST', '/api/tags', { path })).json.tag;
  assert.equal((await app.api('PUT', `/api/tags/${tag.id}/favorite`, { favorite: true })).status, 200);
  return tag;
}

test('Today switches daily entries, captures immediate typing, persists the tag, and leaves Settings unchanged', () =>
  withPhone(browser, async ({ app, page }) => {
    const school = await addFavoriteDailyTag(app, 'school/daily');
    const work = await addFavoriteDailyTag(app, 'work/daily');
    await page.goto(`${app.url}/#/`);
    await page.getByTestId('today-switcher').waitFor();
    const choices = page.getByTestId('daily-tag-choice');
    assert.equal(await choices.count(), 3);
    assert.equal(await page.getByTestId('daily-tag-choice').filter({ hasText: 'daily · school/daily' }).getAttribute('title'), 'school/daily');

    await editor(page).tap();
    await page.keyboard.type('typed immediately');
    await page.getByTestId('daily-tag-choice').filter({ hasText: 'daily · school/daily' }).tap();
    await page.getByTestId('daily-tag-choice').filter({ hasText: 'daily · work/daily' }).tap();
    await editor(page).waitFor();
    await waitSaved(page);
    assert.equal(app.notes().length, 1, 'switching tags does not create empty notes');
    const savedId = app.notes()[0].id;
    assert.equal(app.docText(savedId), 'typed immediately');
    assert.equal(app.db.prepare('SELECT t.path FROM note_tags nt JOIN tags t ON t.id = nt.tag_id WHERE nt.note_id = ?').get(savedId).path, 'daily-jots');
    assert.equal((await app.api('GET', '/api/config')).json.dailyTag, 'daily-jots');

    await page.getByTestId('daily-tag-choice').filter({ hasText: 'daily-jots' }).tap();
    await editor(page).waitFor();
    assert.equal((await editor(page).innerText()).trim(), 'typed immediately');
    assert.equal(await page.locator('[data-testid="widget-note"] [data-testid="note"]').getAttribute('data-note-id'), savedId, 'switching back reuses the same server note');
    await page.getByTestId('daily-tag-choice').filter({ hasText: 'daily · work/daily' }).tap();
    await page.reload();
    await page.getByTestId('today-switcher').waitFor();
    assert.equal(await page.getByTestId('daily-tag-choice').filter({ hasText: 'daily · work/daily' }).getAttribute('aria-pressed'), 'true');
    assert.equal(work.path, 'work/daily');
  }));

test('offline drafts survive tag switching and reload, while existing tag notes retain distinct IDs and content', () =>
  withPhone(browser, async ({ app, page, context }) => {
    const school = await addFavoriteDailyTag(app, 'school');
    const work = await addFavoriteDailyTag(app, 'work');
    const makeNote = async (tag, content) => {
      const id = uuid();
      const r = await app.api('PUT', `/api/notes/${id}`, {
        baseRevision: 0, kind: 'daily', doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: content }] }] },
        docFormat: 1, tags: [tag], date: today(), opId: uuid(),
      });
      assert.equal(r.status, 200);
      return id;
    };
    const workId = await makeNote(work.path, 'work existing');
    await page.goto(`${app.url}/#/`);
    await editor(page).waitFor();
    await page.getByTestId('daily-tag-choice').filter({ hasText: /^school$/ }).tap();
    await editor(page).waitFor();
    assert.equal((await editor(page).innerText()).trim(), '');
    await context.setOffline(true);
    await editor(page).tap();
    await page.keyboard.type('offline school draft');
    await page.getByTestId('daily-tag-choice').filter({ hasText: /^work$/ }).tap();
    await page.getByTestId('daily-tag-choice').filter({ hasText: /^school$/ }).tap();
    const schoolId = await makeNote(school.path, 'school created on server while offline');
    await context.setOffline(false);
    await page.reload();
    await page.getByTestId('today-draft-collision').waitFor();
    await page.getByTestId('conflict-panel').waitFor();
    assert.equal((await editor(page).innerText()).trim(), 'offline school draft', 'the pending local text remains in the editor');
    assert.equal(app.notes().length, 2, 'the pending local draft cannot silently create a duplicate slot');
    assert.equal(app.docText(schoolId), 'school created on server while offline');
    assert.equal(app.docText(workId), 'work existing');
    assert.deepEqual(page.errors, []);
  }));
