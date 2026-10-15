import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { shareToNote, shareIsEmpty } from '../../client/src/share.js';
import { precacheList } from '../../client/sw-build.js';
import { validateDoc, plainText } from '../../shared/doc.js';

const lines = (doc) => plainText(doc).split('\n');
const FILE = { id: 'abcdefgh1234', name: 'Receipt.pdf', mime: 'application/pdf', size: 1234 };

describe('a share becomes a note', () => {
  test('Chrome sharing a page: its title names the note and the address is the text', () => {
    const { title, doc } = shareToNote({ title: 'A good article', text: 'https://example.com/a', url: '' });
    assert.equal(title, 'A good article');
    assert.deepEqual(lines(doc), ['https://example.com/a', '']);
    assert.equal(validateDoc(doc), null);
  });

  test('text over several lines keeps its lines; a link that is already in the text is not repeated', () => {
    const { title, doc } = shareToNote({ text: '\nfirst line\n\nsecond https://x.test/p\n\n', url: 'https://x.test/p' });
    assert.equal(title, null);
    assert.deepEqual(lines(doc), ['first line', '', 'second https://x.test/p', '']);
  });

  test('a link given separately is added below the text', () => {
    assert.deepEqual(lines(shareToNote({ text: 'look at this', url: 'https://x.test' }).doc), ['look at this', 'https://x.test', '']);
  });

  test('text that only repeats the title is left out', () => {
    const { title, doc } = shareToNote({ title: 'Same words', text: 'Same words' });
    assert.equal(title, 'Same words');
    assert.deepEqual(lines(doc), ['']);
  });

  test('files become attachment blocks after the text, with a line below to keep writing on', () => {
    const { doc } = shareToNote({ text: 'see attached' }, [FILE]);
    assert.deepEqual(doc.content.map((n) => n.type), ['paragraph', 'attachment', 'paragraph']);
    assert.deepEqual(doc.content[1].attrs, FILE);
    assert.equal(validateDoc(doc), null);
  });

  test('a very long title is cut to the length a note name may have', () => {
    assert.equal(shareToNote({ title: 'x'.repeat(300) }).title.length, 120);
  });

  test('an empty share is recognised', () => {
    assert.equal(shareIsEmpty({ title: ' ', text: '', url: '', files: [] }), true);
    assert.equal(shareIsEmpty(null), true);
    assert.equal(shareIsEmpty({ files: [{}] }), false);
    assert.equal(shareIsEmpty({ url: 'https://x.test' }), false);
  });
});

describe('the files the service worker keeps', () => {
  test('the page, the built files and the public files; no source maps, no index.html or sw.js twice', () => {
    const { files } = precacheList(['index.html', 'sw.js', 'assets/index-a.js', 'assets/index-a.js.map', 'assets/index-b.css'], ['manifest.json', 'icon-192.png']);
    assert.deepEqual(files, ['/', '/assets/index-a.js', '/assets/index-b.css', '/icon-192.png', '/manifest.json']);
  });

  test('a different build has a different cache name, the same build the same one', () => {
    const a = precacheList(['assets/index-a.js'], []).name;
    assert.equal(precacheList(['assets/index-a.js'], []).name, a);
    assert.notEqual(precacheList(['assets/index-b.js'], []).name, a);
    assert.match(a, /^gordonite-[0-9a-f]{12}$/);
  });
});
