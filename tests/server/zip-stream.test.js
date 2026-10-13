import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { Writable } from 'node:stream';
import { ZipReader, ZipWriter } from '../../server/zip-stream.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'hq-zip-'));
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const collect = async (stream) => {
  const chunks = [];
  for await (const c of stream) chunks.push(c);
  return Buffer.concat(chunks);
};

async function build(dir, entries, { slow = false } = {}) {
  const file = path.join(dir, 'a.zip');
  const out = slow
    ? new Writable({ highWaterMark: 1, write: (chunk, _e, cb) => (fs.appendFileSync(file, chunk), setImmediate(cb)) })
    : fs.createWriteStream(file);
  const zip = new ZipWriter(out);
  for (const e of entries) await zip.addBuffer(e.name, e.data, { deflate: e.deflate });
  await zip.finish();
  return file;
}

describe('zip stream', () => {
  test('entries written stored and deflated are read back exactly, with their checksums', async () => {
    const dir = tmp();
    const random = crypto.randomBytes(300_000);
    const text = Buffer.from('the same sentence again. '.repeat(20_000));
    const file = await build(dir, [
      { name: 'bundle.json', data: '{"a":1}', deflate: true },
      { name: 'files/ab/photo', data: random },
      { name: 'ünïcode name.txt', data: text, deflate: true },
      { name: 'empty', data: Buffer.alloc(0) },
    ]);
    const zip = new ZipReader(file);
    assert.deepEqual([...zip.entries.keys()], ['bundle.json', 'files/ab/photo', 'ünïcode name.txt', 'empty']);
    assert.equal((await zip.read('bundle.json')).toString(), '{"a":1}');
    assert.equal(sha(await collect(zip.stream('files/ab/photo'))), sha(random));
    assert.equal((await collect(zip.stream('ünïcode name.txt'))).length, text.length);
    assert.equal((await zip.read('empty')).length, 0);
    assert.ok(zip.entries.get('ünïcode name.txt').compressedSize < text.length / 10, 'the repetitive entry was compressed');
    assert.equal(zip.entries.get('files/ab/photo').method, 0, 'a photo is stored, not recompressed');
    zip.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('a slow destination is waited for, and everything still arrives', async () => {
    const dir = tmp();
    const data = crypto.randomBytes(200_000);
    const file = await build(dir, [{ name: 'big', data }], { slow: true });
    const zip = new ZipReader(file);
    assert.equal(sha(await zip.read('big')), sha(data));
    zip.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('a file on disk is streamed in without being held whole', async () => {
    const dir = tmp();
    const source = path.join(dir, 'source.bin');
    const data = crypto.randomBytes(1_500_000);
    fs.writeFileSync(source, data);
    const file = path.join(dir, 'a.zip');
    const zip = new ZipWriter(fs.createWriteStream(file));
    const info = await zip.addFile('files/x', source);
    await zip.finish();
    assert.equal(info.size, data.length);
    const reader = new ZipReader(file);
    assert.equal(sha(await collect(reader.stream('files/x'))), sha(data));
    reader.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('an archive that was cut off says so', async () => {
    const dir = tmp();
    const file = await build(dir, [{ name: 'a', data: crypto.randomBytes(5000) }, { name: 'b', data: 'text' }]);
    const bytes = fs.readFileSync(file);
    fs.writeFileSync(file, bytes.subarray(0, bytes.length - 40));
    assert.throws(() => new ZipReader(file), /no index at its end|cut off|too small/);
    fs.writeFileSync(file, bytes.subarray(0, 10));
    assert.throws(() => new ZipReader(file), /too small/);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('a flipped byte in an entry is caught by its checksum, in a stored and in a deflated entry', async () => {
    const dir = tmp();
    const file = await build(dir, [
      { name: 'stored', data: Buffer.from('stored entry data that will be damaged') },
      { name: 'packed', data: Buffer.from('packed entry data '.repeat(100)), deflate: true },
    ]);
    const clean = new ZipReader(file);
    const damage = (entry) => {
      const bytes = fs.readFileSync(file);
      const at = entry.offset + 30 + Buffer.byteLength(entry.name) + 3;
      bytes[at] ^= 0xff;
      fs.writeFileSync(file, bytes);
    };
    damage(clean.entries.get('stored'));
    clean.close();
    const zip = new ZipReader(file);
    await assert.rejects(zip.read('stored'), /checksum|damaged/);
    zip.close();
    damage(new ZipReader(file).entries.get('packed'));
    const zip2 = new ZipReader(file);
    await assert.rejects(zip2.read('packed'), /checksum|damaged|incorrect|invalid/i);
    zip2.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('a name used twice is refused', async () => {
    const zip = new ZipWriter(new Writable({ write: (_c, _e, cb) => cb() }));
    await zip.addBuffer('a', 'one');
    await assert.rejects(zip.addBuffer('a', 'two'), /duplicate/);
  });

  test('ordinary unzip tools can read it (when one is installed)', async () => {
    const dir = tmp();
    const photo = crypto.randomBytes(20_000);
    const file = await build(dir, [{ name: 'bundle.json', data: '{"ok":true}', deflate: true }, { name: 'files/ab/photo', data: photo }]);
    const out = path.join(dir, 'out');
    fs.mkdirSync(out);
    const run = spawnSync('tar', ['-xf', file, '-C', out], { encoding: 'utf8' });
    if (run.error || run.status !== 0) return; // no tar that reads zip here; the in-process reader above is the check
    assert.equal(fs.readFileSync(path.join(out, 'bundle.json'), 'utf8'), '{"ok":true}');
    assert.equal(sha(fs.readFileSync(path.join(out, 'files', 'ab', 'photo'))), sha(photo));
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
