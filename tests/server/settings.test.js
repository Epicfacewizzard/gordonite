import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../../server/db.js';
import {
  DEFAULT_DAILY_TAG, cleanOrderNames, cleanTagOrder, dailyTag, exportSettings, followTagMove, importSettings, readTagOrder,
  savedTimeZone, setDailyTag, setTimeZone, writeTagOrder,
} from '../../server/settings.js';

const fresh = () => openDb(':memory:');

describe('settings', () => {
  test('start at their defaults and say so', () => {
    const db = fresh();
    assert.equal(dailyTag(db), DEFAULT_DAILY_TAG);
    assert.equal(savedTimeZone(db), null);
    assert.deepEqual(readTagOrder(db), {});
    assert.deepEqual(exportSettings(db), {});
    db.close();
  });

  test('a time zone and a daily tag are checked the same way wherever they come from', () => {
    const db = fresh();
    const cfg = { tz: 'America/Edmonton' };
    assert.throws(() => setTimeZone(db, cfg, 'Mars/Olympus'), { code: 'bad_timezone', status: 400 });
    assert.throws(() => setTimeZone(db, cfg, 42), { code: 'bad_timezone' });
    setTimeZone(db, cfg, 'Asia/Tokyo');
    assert.equal(cfg.tz, 'Asia/Tokyo');
    assert.equal(savedTimeZone(db), 'Asia/Tokyo');
    assert.throws(() => setDailyTag(db, '../not a tag'), { code: 'bad_tag' });
    assert.equal(setDailyTag(db, 'Work/Log'), 'work/log', 'tag names are normalised');
    assert.equal(dailyTag(db), 'work/log');
    db.close();
  });

  test('the daily tag follows a tag that is moved, and only then', () => {
    const db = fresh();
    setDailyTag(db, 'archive/journal');
    followTagMove(db, 'archive', 'old/archive');
    assert.equal(dailyTag(db), 'old/archive/journal');
    followTagMove(db, 'something-else', 'x');
    assert.equal(dailyTag(db), 'old/archive/journal');
    db.close();
  });

  test('a tag order keeps only plain, normalised names, at most 500 a parent', () => {
    assert.deepEqual(cleanOrderNames(['school', 'Bad', 'a/b', '', 7, 'home']), ['school', 'home']);
    assert.equal(cleanOrderNames(Array.from({ length: 600 }, (_, i) => `t${i}`)).length, 500);
    assert.equal(cleanOrderNames('nope'), null);
    assert.deepEqual(cleanTagOrder({ '': ['b', 'a'], school: ['x', 'Y'], 'Not Normal': ['z'], list: 'nope' }), { '': ['b', 'a'], school: ['x'] });
    assert.equal(cleanTagOrder([1, 2]), null);
  });

  test('an import in merge mode fills in what is not set; replace takes the export’s', () => {
    const db = fresh();
    const data = { homeTimeZone: 'Asia/Tokyo', settings: { dailyTag: 'from/export', tagOrder: { '': ['b', 'a'] } } };
    importSettings(db, data, 'merge');
    assert.equal(dailyTag(db), 'from/export');
    assert.equal(savedTimeZone(db), 'Asia/Tokyo');
    assert.deepEqual(readTagOrder(db), { '': ['b', 'a'] });

    importSettings(db, { homeTimeZone: 'Europe/Paris', settings: { dailyTag: 'other', tagOrder: { '': ['z'] } } }, 'merge');
    assert.equal(dailyTag(db), 'from/export', 'merge never overwrites');
    assert.equal(savedTimeZone(db), 'Asia/Tokyo');

    importSettings(db, { homeTimeZone: 'Europe/Paris', settings: { dailyTag: 'other', tagOrder: { '': ['z'] } } }, 'replace');
    assert.equal(dailyTag(db), 'other');
    assert.equal(savedTimeZone(db), 'Europe/Paris');
    assert.deepEqual(readTagOrder(db), { '': ['z'] });
    db.close();
  });

  test('an import never stores a value the app itself would refuse', () => {
    const db = fresh();
    importSettings(db, { homeTimeZone: 'Mars/Olympus', settings: { dailyTag: '../nope', tagOrder: 'not an object' } }, 'replace');
    assert.equal(dailyTag(db), DEFAULT_DAILY_TAG);
    assert.equal(savedTimeZone(db), null);
    assert.deepEqual(readTagOrder(db), {});
    db.close();
  });

  test('export carries exactly what is set', () => {
    const db = fresh();
    setDailyTag(db, 'home');
    writeTagOrder(db, { '': ['a', 'b'] });
    assert.deepEqual(exportSettings(db), { dailyTag: 'home', tagOrder: { '': ['a', 'b'] } });
    writeTagOrder(db, {});
    assert.deepEqual(exportSettings(db), { dailyTag: 'home' });
    db.close();
  });
});
