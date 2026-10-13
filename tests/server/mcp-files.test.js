import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { startServer } from './helpers.js';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n');

test('the inbox folder: list, send to Gordonite, attach, read back; nothing outside it can be reached', async () => {
  const token = 'test-only-assistant-key-123456789';
  const app = await startServer({ ASSISTANT_TOKEN: token });
  const inbox = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-inbox-'));
  const secret = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-secret-'));
  fs.writeFileSync(path.join(secret, 'private.pdf'), PDF);
  fs.writeFileSync(path.join(inbox, 'Insurance Policy.pdf'), PDF);
  fs.mkdirSync(path.join(inbox, 'photos'));
  fs.writeFileSync(path.join(inbox, 'photos', 'Floor.png'), PNG);
  fs.writeFileSync(path.join(inbox, '.hidden.pdf'), PDF);

  const configFile = path.join(inbox, '..', `hq-mcp-config-${process.pid}.json`);
  fs.writeFileSync(configFile, JSON.stringify({ url: app.url, token, inboxDir: inbox }));
  const connect = async (args) => {
    const c = new Client({ name: 'test', version: '1' });
    await c.connect(new StdioClientTransport({ command: process.execPath, args: [path.resolve('mcp/server.js'), ...args], env: { ...process.env }, stderr: 'pipe' }));
    return c;
  };
  let c;
  let bare;
  try {
    c = await connect(['--config', configFile]);
    const call = async (name, args = {}) => {
      const r = await c.callTool({ name, arguments: args });
      assert.ok(!r.isError, JSON.stringify(r));
      return r;
    };
    const json = (r) => JSON.parse(r.content[0].text);

    // listing
    const listed = json(await call('list_inbox'));
    assert.deepEqual(listed.files.map((f) => f.path).sort(), ['Insurance Policy.pdf', 'photos/Floor.png'], 'hidden files are not offered');

    // sending, with the file also placed in a note
    const note = (await app.api('POST', '/api/assistant/notes', { title: 'Condo', markdown: 'Documents', tags: ['condo'] }, { authorization: `Bearer ${token}` })).json;
    const sent = json(await call('upload_file', { path: 'Insurance Policy.pdf', noteId: note.id, archive: true }));
    assert.equal(sent.file.kind, 'pdf');
    assert.equal(sent.file.source, 'assistant');
    assert.equal(sent.note.id, note.id);
    assert.equal(sent.archivedTo, '_imported/Insurance Policy.pdf');
    assert.ok(!fs.existsSync(path.join(inbox, 'Insurance Policy.pdf')), 'the original moved out of the way');
    assert.ok(fs.existsSync(path.join(inbox, '_imported', 'Insurance Policy.pdf')));
    assert.deepEqual(json(await call('list_inbox')).files.map((f) => f.path), ['photos/Floor.png'], 'it is not offered twice');

    // a file sent without a note, then attached
    const photo = json(await call('upload_file', { path: 'photos/Floor.png' }));
    assert.equal(photo.file.kind, 'image');
    assert.ok(fs.existsSync(path.join(inbox, 'photos', 'Floor.png')), 'left in place unless archive is asked for');
    assert.equal(json(await call('list_files', { unattached: true })).attachments.some((f) => f.id === photo.file.id), true);
    await call('attach_file', { noteId: note.id, fileId: photo.file.id });
    assert.equal(json(await call('list_files', { noteId: note.id })).attachments.length, 2);

    // reading back: an image arrives as an image, a PDF as a document
    const img = await call('get_file', { fileId: photo.file.id });
    assert.equal(img.content[1].type, 'image');
    assert.equal(img.content[1].mimeType, 'image/png');
    assert.deepEqual(Buffer.from(img.content[1].data, 'base64'), PNG);
    const doc = await call('get_file', { fileId: sent.file.id });
    assert.equal(doc.content[1].type, 'resource');
    assert.equal(doc.content[1].resource.mimeType, 'application/pdf');
    assert.deepEqual(Buffer.from(doc.content[1].resource.blob, 'base64'), PDF);

    // the note itself shows both
    const read = json(await call('get_note', { noteId: note.id }));
    assert.match(read.markdown, /\[Insurance Policy\.pdf\]\(gordonite-file:/);
    assert.match(read.markdown, /!\[Floor\.png\]\(gordonite-file:/);

    // nothing outside the inbox is reachable
    const refuse = async (p) => {
      const r = await c.callTool({ name: 'upload_file', arguments: { path: p } });
      assert.equal(r.isError, true, `${p} must be refused`);
      assert.match(r.content[0].text, /outside the inbox|No such file|not a file/);
    };
    await refuse('../' + path.basename(secret) + '/private.pdf');
    await refuse(path.join(secret, 'private.pdf'));
    await refuse('photos/../../' + path.basename(secret) + '/private.pdf');
    await refuse('photos'); // a folder
    await refuse('missing.pdf');
    if (process.platform !== 'win32') {
      fs.symlinkSync(path.join(secret, 'private.pdf'), path.join(inbox, 'link.pdf'));
      await refuse('link.pdf');
    }
    assert.equal(app.db.prepare("SELECT COUNT(*) c FROM attachments WHERE name = 'private.pdf'").get().c, 0, 'the outside file never reached the server');

    // with no inbox configured the tools say so
    bare = await connect([]).catch(() => null);
    if (bare === null) {
      const c2 = new Client({ name: 'test', version: '1' });
      await c2.connect(new StdioClientTransport({ command: process.execPath, args: [path.resolve('mcp/server.js')], env: { ...process.env, GORDONITE_URL: app.url, GORDONITE_TOKEN: token }, stderr: 'pipe' }));
      bare = c2;
    }
    const none = await bare.callTool({ name: 'list_inbox', arguments: {} });
    assert.equal(none.isError, true);
    assert.match(none.content[0].text, /inboxDir/);
  } finally {
    await c?.close();
    await bare?.close();
    await app.close();
    fs.rmSync(inbox, { recursive: true, force: true });
    fs.rmSync(secret, { recursive: true, force: true });
    fs.rmSync(configFile, { force: true });
  }
});
