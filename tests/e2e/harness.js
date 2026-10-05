import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { loadConfig } from '../../server/config.js';
import { openDb } from '../../server/db.js';
import { createApp } from '../../server/app.js';
import { uuid } from '../../shared/ids.js';

export const TZ = 'America/Edmonton';

// A real server on a random port with a throwaway data directory, serving the built client.
export async function startApp(env = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-e2e-'));
  const config = loadConfig({ DATA_DIR: dir, BACKUP_INTERVAL_HOURS: '0', HOME_TZ: TZ, ...env });
  const db = openDb(config.dbFile);
  const { server, store } = createApp({ config, db, log: { log() {}, error: console.error } });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}`;
  const api = async (method, p, body) => {
    const res = await fetch(url + p, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body === undefined || method === 'GET' ? undefined : JSON.stringify(body),
    });
    return { status: res.status, json: await res.json().catch(() => null) };
  };
  return {
    url,
    dir,
    config,
    db,
    store,
    api,
    notes: () => db.prepare('SELECT * FROM notes ORDER BY note_date, created_at').all(),
    docText: (id) => textOf(JSON.parse(db.prepare('SELECT doc FROM notes WHERE id = ?').get(id).doc)),
    async close() {
      await new Promise((r) => server.close(r));
      db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

export function textOf(doc) {
  const out = [];
  const walk = (n) => {
    if (n.type === 'text') out.push(n.text);
    else (n.content ?? []).forEach(walk);
    if (['paragraph', 'heading'].includes(n.type)) out.push('\n');
  };
  walk(doc);
  return out.join('').replace(/\n$/, '');
}

// Uses an installed Chrome or Edge (no browser download). Set CHROME_PATH to use another binary.
export async function launch() {
  if (process.env.CHROME_PATH) return chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true });
  for (const channel of ['chrome', 'msedge']) {
    try {
      return await chromium.launch({ channel, headless: true });
    } catch {
      /* try the next one */
    }
  }
  throw new Error('No Chrome or Edge found. Install one, or set CHROME_PATH to a Chromium-based browser.');
}

// Samsung Galaxy S24-like context: 360x780 CSS px, 3x, touch, mobile.
export async function newPhone(browser, app, { clockTime, android = false } = {}) {
  const context = await browser.newContext({
    viewport: { width: 360, height: 780 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    timezoneId: TZ,
    locale: 'en-CA',
    // ProseMirror switches to its Android input path when the UA says Android, but Playwright can only
    // produce desktop-style key events, so that combination is opt-in (and not representative).
    ...(android ? { userAgent: 'Mozilla/5.0 (Linux; Android 14; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36' } : {}),
  });
  const page = await context.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text()) && page.errors.push(m.text()));
  if (clockTime) await page.clock.install({ time: clockTime });
  page.app = app;
  return { context, page };
}

export const open = async (page, tag = 'daily-jots') => {
  await page.goto(`${page.app.url}/#/t/${tag}`);
  await page.waitForSelector('[data-testid="stream"]');
  await page.waitForSelector('.note-text[contenteditable="true"]');
};

export const editor = (page) => page.locator('.note-text[contenteditable="true"]');
export const status = (page) => page.getByTestId('global-status').getAttribute('data-status');

export const waitStatus = (page, wanted, timeout = 10_000) =>
  page.waitForFunction(
    (w) => document.querySelector('[data-testid="global-status"]')?.dataset.status === w,
    wanted,
    { timeout },
  );

// Wait until everything typed so far is confirmed by the server.
export async function waitSaved(page, timeout = 10_000) {
  await page.waitForFunction(
    () => document.querySelector('[data-testid="global-status"]')?.dataset.status === 'saved',
    null,
    { timeout },
  );
}

export const tap = (page, testid) => page.getByTestId(testid).tap();

// Simplified document structure from the live DOM.
export const structure = (page) =>
  editor(page).evaluate((root) =>
    [...root.children].map((el) => {
      if (el.matches('ul[data-type="taskList"]')) {
        return { type: 'tasks', items: [...el.children].map((li) => ({ text: li.querySelector(':scope > div').textContent, checked: li.dataset.checked === 'true' })) };
      }
      if (el.tagName === 'UL') return { type: 'bullets', items: [...el.children].map((li) => li.textContent) };
      return { type: el.tagName.toLowerCase(), text: el.textContent };
    }),
  );

export const caret = (page) =>
  page.evaluate(() => {
    const sel = getSelection();
    if (!sel.rangeCount) return null;
    const node = sel.anchorNode;
    const el = node.nodeType === 3 ? node.parentElement : node;
    const block = el.closest('p,h1,h2,h3');
    const pre = document.createRange();
    if (block) {
      pre.selectNodeContents(block);
      pre.setEnd(node, sel.anchorOffset);
    }
    const li = block?.closest('li');
    return {
      collapsed: sel.isCollapsed,
      selected: sel.toString(),
      block: block?.textContent,
      offset: block ? pre.toString().length : null,
      tag: block?.tagName.toLowerCase(),
      list: li ? (li.hasAttribute('data-checked') ? 'task' : 'bullet') : null,
      focused: document.activeElement?.classList.contains('note-text') ?? false,
    };
  });

export const newId = uuid;

export function paragraphDoc(...texts) {
  return { type: 'doc', content: texts.map((t) => ({ type: 'paragraph', content: t ? [{ type: 'text', text: t }] : undefined })) };
}

// Create a note on the server directly (as if written earlier or on another device).
export async function seedNote(app, { tags = ['daily-jots'], date, doc, id = uuid() } = {}) {
  const r = await app.api('PUT', `/api/notes/${id}`, { baseRevision: 0, doc, docFormat: 1, tags, date });
  if (r.status !== 200) throw new Error(`seed failed: ${JSON.stringify(r.json)}`);
  return id;
}

export function expectNoPageErrors(page, assert) {
  assert.deepEqual(page.errors, [], `page errors:\n${page.errors.join('\n')}`);
}

// Run a scenario with a fresh server and phone context; fails on uncaught page errors.
export async function withPhone(browser, fn, opts = {}) {
  const app = await startApp(opts.env);
  const { context, page } = await newPhone(browser, app, opts);
  try {
    await fn({ app, page, context });
    if (page.errors.length) throw new Error(`page errors:\n${page.errors.join('\n')}`);
  } finally {
    await context.close();
    await app.close();
  }
}
