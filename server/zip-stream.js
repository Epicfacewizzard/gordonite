// A ZIP writer and reader that never hold a whole file in memory, for archives of any number of large files.
//
// zip.js is the small in-memory writer for a folder of text files. This one is for the workspace bundle (bundle.js):
// a database snapshot plus every stored photo and PDF. Entries are written as they stream past, with their size and
// CRC after the data (a "data descriptor"), and the index at the end; every unzip tool reads that.
//
// Limits, stated rather than hit by accident: the classic ZIP format, so no archive or entry over 4 GiB and no more
// than 65,535 entries. Going past either is an error with a message, never a damaged archive.
import fs from 'node:fs';
import zlib from 'node:zlib';
import { Readable } from 'node:stream';

const SIG_LOCAL = 0x04034b50;
const SIG_DESCRIPTOR = 0x08074b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_END = 0x06054b50;
const FLAGS = 0x0808; // bit 3: sizes follow the data; bit 11: names are UTF-8
const MAX_32 = 0xffffffff;

const dosParts = (when) => ({
  time: (when.getUTCHours() << 11) | (when.getUTCMinutes() << 5) | (when.getUTCSeconds() >> 1),
  date: (Math.max(when.getUTCFullYear() - 1980, 0) << 9) | ((when.getUTCMonth() + 1) << 5) | when.getUTCDate(),
});

/** Writes entries one after another to a Writable. */
export class ZipWriter {
  #out;
  #central = [];
  #offset = 0;
  #dos;
  #names = new Set();

  constructor(out, { when = new Date() } = {}) {
    this.#out = out;
    this.#dos = dosParts(when);
  }

  // Wait for the Writable to take the chunk (backpressure), so memory stays flat however large the entry is.
  async #write(chunk) {
    if (!chunk.length) return;
    this.#offset += chunk.length;
    if (this.#offset > MAX_32) throw new Error('This bundle is larger than the ZIP format allows (4 GiB). Copy the "files" folder and a database backup instead.');
    if (!this.#out.write(chunk)) {
      await new Promise((resolve, reject) => {
        const onDrain = () => (cleanup(), resolve());
        const onError = (err) => (cleanup(), reject(err));
        const cleanup = () => {
          this.#out.off('drain', onDrain);
          this.#out.off('error', onError);
        };
        this.#out.on('drain', onDrain);
        this.#out.on('error', onError);
      });
    }
  }

  /** Add one entry from a readable source (an async iterable of Buffers). `deflate`: compress it (not worth it for photos). */
  async addStream(name, source, { deflate = false } = {}) {
    if (this.#names.has(name)) throw new Error(`duplicate entry "${name}"`);
    if (this.#central.length >= 0xffff) throw new Error('Too many files for the ZIP format (65,535).');
    this.#names.add(name);
    const nameBuf = Buffer.from(name, 'utf8');
    const start = this.#offset;
    const header = Buffer.alloc(30);
    header.writeUInt32LE(SIG_LOCAL, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(FLAGS, 6);
    header.writeUInt16LE(deflate ? 8 : 0, 8);
    header.writeUInt16LE(this.#dos.time, 10);
    header.writeUInt16LE(this.#dos.date, 12);
    header.writeUInt16LE(nameBuf.length, 26);
    await this.#write(header);
    await this.#write(nameBuf);

    let crc = 0;
    let size = 0;
    let stored = 0;
    async function* measured() {
      for await (const chunk of source) {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        crc = zlib.crc32(buf, crc);
        size += buf.length;
        yield buf;
      }
    }
    const body = deflate ? Readable.from(measured()).pipe(zlib.createDeflateRaw()) : measured();
    for await (const chunk of body) {
      stored += chunk.length;
      await this.#write(chunk);
    }
    if (size > MAX_32) throw new Error(`"${name}" is larger than the ZIP format allows (4 GiB)`);

    const descriptor = Buffer.alloc(16);
    descriptor.writeUInt32LE(SIG_DESCRIPTOR, 0);
    descriptor.writeUInt32LE(crc, 4);
    descriptor.writeUInt32LE(stored, 8);
    descriptor.writeUInt32LE(size, 12);
    await this.#write(descriptor);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(SIG_CENTRAL, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(FLAGS, 8);
    cd.writeUInt16LE(deflate ? 8 : 0, 10);
    cd.writeUInt16LE(this.#dos.time, 12);
    cd.writeUInt16LE(this.#dos.date, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(stored, 20);
    cd.writeUInt32LE(size, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt32LE(start, 42);
    this.#central.push(cd, nameBuf);
    return { name, size, crc };
  }

  addBuffer(name, data, options) {
    return this.addStream(name, Readable.from([Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8')]), options);
  }

  addFile(name, path, options) {
    return this.addStream(name, fs.createReadStream(path), options);
  }

  /** Write the index and end the output. */
  async finish() {
    const central = Buffer.concat(this.#central);
    const centralStart = this.#offset;
    await this.#write(central);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(SIG_END, 0);
    end.writeUInt16LE(this.#central.length / 2, 8);
    end.writeUInt16LE(this.#central.length / 2, 10);
    end.writeUInt32LE(central.length, 12);
    end.writeUInt32LE(centralStart, 16);
    await this.#write(end);
    await new Promise((resolve, reject) => {
      this.#out.once('error', reject);
      this.#out.end(resolve);
    });
  }
}

/** Reads a ZIP from disk by its index, one entry at a time. */
export class ZipReader {
  #fd;
  #size;
  entries = new Map(); // name -> { name, method, crc, compressedSize, size, offset }

  constructor(path) {
    this.path = path;
    this.#fd = fs.openSync(path, 'r');
    this.#size = fs.fstatSync(this.#fd).size;
    try {
      this.#readIndex();
    } catch (err) {
      this.close();
      throw err;
    }
  }

  #pread(position, length) {
    const buf = Buffer.alloc(length);
    const got = fs.readSync(this.#fd, buf, 0, length, position);
    if (got !== length) throw new Error('The archive ends early (it was cut off or only partly copied).');
    return buf;
  }

  #readIndex() {
    if (this.#size < 22) throw new Error('That is not a complete ZIP file (it is too small).');
    const tailLength = Math.min(this.#size, 22 + 0xffff);
    const tail = this.#pread(this.#size - tailLength, tailLength);
    const at = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    if (at < 0) throw new Error('That is not a complete ZIP file (no index at its end: it was cut off or only partly copied).');
    const count = tail.readUInt16LE(at + 10);
    const centralSize = tail.readUInt32LE(at + 12);
    const centralStart = tail.readUInt32LE(at + 16);
    if (centralStart + centralSize > this.#size) throw new Error('The archive index points past the end of the file (it was cut off).');
    const central = this.#pread(centralStart, centralSize);
    let p = 0;
    for (let i = 0; i < count; i++) {
      if (p + 46 > central.length || central.readUInt32LE(p) !== SIG_CENTRAL) throw new Error('The archive index is damaged.');
      const nameLength = central.readUInt16LE(p + 28);
      const extraLength = central.readUInt16LE(p + 30);
      const commentLength = central.readUInt16LE(p + 32);
      const name = central.subarray(p + 46, p + 46 + nameLength).toString('utf8');
      this.entries.set(name, {
        name,
        method: central.readUInt16LE(p + 10),
        crc: central.readUInt32LE(p + 16),
        compressedSize: central.readUInt32LE(p + 20),
        size: central.readUInt32LE(p + 24),
        offset: central.readUInt32LE(p + 42),
      });
      p += 46 + nameLength + extraLength + commentLength;
    }
  }

  has(name) {
    return this.entries.has(name);
  }

  // Where an entry's data begins: after its local header, whose name and extra lengths may differ from the index's.
  #dataStart(entry) {
    const header = this.#pread(entry.offset, 30);
    if (header.readUInt32LE(0) !== SIG_LOCAL) throw new Error(`The entry "${entry.name}" is damaged (its header is not where the index says).`);
    return entry.offset + 30 + header.readUInt16LE(26) + header.readUInt16LE(28);
  }

  /** The entry's bytes, uncompressed, as a stream. Errors if the data does not match the index (size or CRC). */
  stream(name) {
    const entry = this.entries.get(name);
    if (!entry) throw new Error(`"${name}" is not in the archive`);
    if (entry.method !== 0 && entry.method !== 8) throw new Error(`"${name}" uses an unsupported compression method`);
    const start = this.#dataStart(entry);
    if (start + entry.compressedSize > this.#size) throw new Error(`"${name}" runs past the end of the file (it was cut off).`);
    // (a stream cannot be asked for zero bytes of a file, so an empty entry has no file stream at all)
    const raw = entry.compressedSize === 0 ? Readable.from([]) : fs.createReadStream(this.path, { start, end: start + entry.compressedSize - 1 });
    const source = entry.method === 8 ? raw.pipe(zlib.createInflateRaw()) : raw;
    raw.on('error', (err) => source.destroy(err));
    async function* checked() {
      let crc = 0;
      let size = 0;
      for await (const chunk of source) {
        crc = zlib.crc32(chunk, crc);
        size += chunk.length;
        yield chunk;
      }
      if (size !== entry.size) throw new Error(`"${name}" has ${size} bytes but should have ${entry.size}`);
      if (crc !== entry.crc) throw new Error(`"${name}" does not match its checksum (the data is damaged)`);
    }
    return Readable.from(checked());
  }

  /** A small entry's bytes (refuses anything over `limit`). */
  async read(name, limit = 64 * 1024 * 1024) {
    const entry = this.entries.get(name);
    if (!entry) throw new Error(`"${name}" is not in the archive`);
    if (entry.size > limit) throw new Error(`"${name}" is too large to read into memory`);
    const chunks = [];
    for await (const chunk of this.stream(name)) chunks.push(chunk);
    return Buffer.concat(chunks);
  }

  close() {
    if (this.#fd !== null) {
      try {
        fs.closeSync(this.#fd);
      } catch {
        /* already closed */
      }
      this.#fd = null;
    }
  }
}
