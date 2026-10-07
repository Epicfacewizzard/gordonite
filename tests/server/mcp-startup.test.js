import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const SERVER = path.resolve('mcp/server.js');
const FAKE_TOKEN = 'x'.repeat(40);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-mcp-'));

// stdin is closed immediately: a bridge that starts properly then exits cleanly; a failing one prints why.
const run = (args, env = {}) =>
  spawnSync(process.execPath, [SERVER, ...args], { input: '', encoding: 'utf8', env: { PATH: process.env.PATH, ...env }, timeout: 20000 });

const write = (name, content) => {
  const file = path.join(dir, name);
  fs.writeFileSync(file, content);
  return file;
};

test('startup says which step failed, and never prints the key', () => {
  const missing = run(['--config', path.join(dir, 'absent.json')]);
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /config file not found: .*absent\.json/);

  const notJson = run(['--config', write('bad.json', `{"url":"http://h:1","token":"${FAKE_TOKEN}"`)]);
  assert.equal(notJson.status, 1);
  assert.match(notJson.stderr, /not valid JSON/);
  assert.doesNotMatch(notJson.stderr, new RegExp(FAKE_TOKEN), 'file contents are not echoed');

  const shortKey = run(['--config', write('short.json', '{"url":"http://h:1","token":"tooshort"}')]);
  assert.equal(shortKey.status, 1);
  assert.match(shortKey.stderr, /invalid configuration: Assistant key must contain at least 20 characters/);
  assert.doesNotMatch(shortKey.stderr, /tooshort/);

  const badUrl = run(['--config', write('url.json', `{"url":"not a url","token":"${FAKE_TOKEN}"}`)]);
  assert.equal(badUrl.status, 1);
  assert.match(badUrl.stderr, /invalid configuration/);
  assert.doesNotMatch(badUrl.stderr, new RegExp(FAKE_TOKEN));

  const nothing = run([]);
  assert.equal(nothing.status, 1);
  assert.match(nothing.stderr, /no --config .* and no GORDONITE_URL\/GORDONITE_TOKEN/);
});

test('a valid config starts, including one saved with a UTF-8 BOM (Windows PowerShell default)', () => {
  const good = JSON.stringify({ url: 'http://127.0.0.1:9', token: FAKE_TOKEN });
  for (const [name, content] of [['good.json', good], ['bom.json', `﻿${good}`]]) {
    const r = run(['--config', write(name, content)]);
    assert.equal(r.stderr, '', `${name}: no startup error`);
    assert.equal(r.status, 0, `${name}: exits cleanly when stdin closes`);
  }
  const viaEnv = run([], { GORDONITE_URL: 'http://127.0.0.1:9', GORDONITE_TOKEN: FAKE_TOKEN });
  assert.equal(viaEnv.stderr, '');
});
