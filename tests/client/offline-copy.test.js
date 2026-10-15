import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyKey } from '../../client/src/offline-copy.js';

test('the reads screens are built from are kept on the phone; files, history, backups and login are not', () => {
  assert.equal(copyKey('/api/config'), '/api/config');
  assert.equal(copyKey('/api/tags'), '/api/tags');
  assert.equal(copyKey('/api/tasks'), '/api/tasks');
  assert.equal(copyKey('/api/notes?limit=30&offset=0'), '/api/notes?limit=30&offset=0');
  assert.equal(copyKey('/api/notes/abc-123'), '/api/notes/abc-123');
  assert.equal(copyKey('/api/stream?tag=daily-jots'), '/api/stream?tag=daily-jots');
  assert.equal(copyKey('/api/moods?from=2026-10-01&to=2026-10-15'), '/api/moods?from=2026-10-01&to=2026-10-15');

  assert.equal(copyKey('/api/stream?tag=daily-jots&before=2026-10-01'), null, 'only the first page of a stream');
  assert.equal(copyKey('/api/notes/abc-123/versions'), null);
  assert.equal(copyKey('/api/attachments?noteId=x'), null);
  assert.equal(copyKey('/api/attachments/x/file'), null);
  assert.equal(copyKey('/api/auth'), null);
  assert.equal(copyKey('/api/health'), null);
  assert.equal(copyKey('/api/backups'), null);
  assert.equal(copyKey('/api/trash'), null);
});
