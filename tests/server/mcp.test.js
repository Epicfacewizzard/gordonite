import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { startServer } from './helpers.js';

test('MCP stdio handshake, tool discovery, authenticated writes/readback, history and denied keys', async () => {
  const token = 'test-only-assistant-key-123456789';
  const app = await startServer({ ASSISTANT_TOKEN: token });
  async function connect(key) {
    const c = new Client({ name: 'test', version: '1' });
    await c.connect(new StdioClientTransport({ command: process.execPath, args: [path.resolve('mcp/server.js')], env: { ...process.env, GORDONITE_URL: app.url, GORDONITE_TOKEN: key }, stderr: 'pipe' }));
    return c;
  }
  let c, bad;
  try {
    c = await connect(token);
    const tools = (await c.listTools()).tools;
    assert.equal(tools.length, 13);
    assert.ok(!tools.some(t => /delete|purge/.test(t.name)), 'no permanent delete or purge tool');
    const call = async (name, args = {}) => {
      const r = await c.callTool({ name, arguments: args });
      assert.ok(!r.isError, JSON.stringify(r));
      return JSON.parse(r.content[0].text);
    };
    assert.equal((await call('ping')).ok, true);
    await call('log_mood', { score: 4, note: 'logged through MCP' });
    const moods = await call('get_moods', { days: 3 });
    assert.equal(moods.moods.length, 1);
    assert.equal(moods.moods[0].score, 4);
    assert.equal(moods.streak, 1);
    assert.equal((await c.callTool({ name: 'log_mood', arguments: { score: 9 } })).isError, true, 'out-of-range score refused');
    const made = await call('create_note', { title: 'MCP test', markdown: '**Keep** this\n\n- [ ] test task', tags: ['mcp-test'] });
    const noteId = made.note?.id ?? made.id;
    assert.ok(noteId, JSON.stringify(made));
    const note = await call('get_note', { noteId });
    assert.match(JSON.stringify(note), /Keep/);
    await call('append_note', { noteId, markdown: 'Appended through MCP' });
    assert.match(JSON.stringify(await call('get_note', { noteId })), /Appended through MCP/);
    assert.ok(app.db.prepare('SELECT COUNT(*) n FROM note_versions WHERE note_id=?').get(noteId).n > 0);
    const read = await call('get_note', { noteId });
    await call('replace_text', { noteId, expectedRevision: read.revision, find: 'Appended through MCP', replace: 'Edited through MCP' });
    assert.match(JSON.stringify(await call('get_note', { noteId })), /Edited through MCP/);
    const stale = await c.callTool({ name: 'replace_text', arguments: { noteId, expectedRevision: read.revision, find: 'Edited', replace: 'X' } });
    assert.equal(stale.isError, true, 'a stale revision is refused');
    assert.match(stale.content[0].text, /changed since you read it/, 'the reason reaches the assistant');
    const fresh = await call('get_note', { noteId });
    assert.equal((await c.callTool({ name: 'replace_section', arguments: { noteId, expectedRevision: fresh.revision, heading: 'Nothing', markdown: 'x' } })).isError, true, 'unknown heading refused');
    assert.ok((await call('search_notes', { tag: 'mcp-test' })).notes.length > 0);
    assert.equal((await c.callTool({ name: 'trash_note', arguments: { noteId, expectedRevision: 1, confirmed: true } })).isError, true, 'stale revision refused');
    const headers = { authorization: `Bearer ${token}` };
    assert.equal((await app.api('POST', `/api/assistant/notes/${noteId}/trash`, { expectedRevision: 2 }, headers)).status, 400, 'missing confirmation refused');
    const latest = await call('get_note', { noteId });
    await call('trash_note', { noteId, expectedRevision: latest.revision, confirmed: true });
    assert.ok(app.db.prepare('SELECT deleted_at FROM notes WHERE id=?').get(noteId).deleted_at);
    bad = await connect('wrong-assistant-key-123456789');
    assert.equal((await bad.callTool({ name: 'ping', arguments: {} })).isError, true);
    assert.equal((await c.callTool({ name: 'get_note', arguments: {} })).isError, true);
  } finally {
    await c?.close(); await bad?.close(); await app.close();
  }
});
