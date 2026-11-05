import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCron, nextRuns, describe, CronError } from '../src/cron.js';

const T = new Date('2026-01-01T00:00:00Z');
const runs = (e, n = 3, from = T) => nextRuns(e, from, n).map((d) => d.toISOString().slice(0, 16));

test('step, list, range and names', () => {
  assert.deepEqual(runs('*/20 * * * *'), ['2026-01-01T00:20', '2026-01-01T00:40', '2026-01-01T01:00']);
  assert.deepEqual(runs('0 9,17 * * *'), ['2026-01-01T09:00', '2026-01-01T17:00', '2026-01-02T09:00']);
  assert.deepEqual(runs('0 9 * * mon-fri'), ['2026-01-01T09:00', '2026-01-02T09:00', '2026-01-05T09:00']); // Jan 1 2026 is Thursday
  assert.deepEqual(runs('0 0 1 jan,jul *', 3), ['2026-07-01T00:00', '2027-01-01T00:00', '2027-07-01T00:00']);
  assert.deepEqual(runs('10-30/10 0 1 1 *', 3), ['2026-01-01T00:10', '2026-01-01T00:20', '2026-01-01T00:30']);
});
test('strictly after "from"; 7 equals Sunday', () => {
  assert.deepEqual(runs('0 0 * * *', 1, new Date('2026-01-01T00:00:00Z')), ['2026-01-02T00:00']);
  assert.deepEqual(runs('0 0 * * 7', 1), ['2026-01-04T00:00']);
  assert.deepEqual(runs('0 0 * * 0', 1), ['2026-01-04T00:00']);
});
test('day-of-month OR day-of-week when both restricted (vixie semantics)', () => {
  assert.deepEqual(runs('0 0 2 * mon', 3), ['2026-01-02T00:00', '2026-01-05T00:00', '2026-01-12T00:00']);
});
test('leap day and year rollover', () => {
  assert.deepEqual(runs('0 0 29 2 *', 2), ['2028-02-29T00:00', '2032-02-29T00:00']);
  assert.deepEqual(runs('59 23 31 12 *', 1, new Date('2026-12-31T23:59:00Z')), ['2027-12-31T23:59']);
});
test('aliases', () => {
  assert.equal(describe('@hourly'), 'Every hour, on the hour, every day (UTC)');
  assert.deepEqual(runs('@weekly', 1), ['2026-01-04T00:00']);
  assert.deepEqual(runs('@monthly', 1), ['2026-02-01T00:00']);
});
test('invalid expressions', () => {
  for (const [e, re] of [['* * * *', /Expected 5 fields/], ['60 * * * *', /out of range/], ['* 24 * * *', /out of range/], ['* * 0 * *', /out of range/], ['* * * 13 *', /out of range/],
    ['*/0 * * * *', /Invalid step/], ['5-1 * * * *', /after end/], ['a * * * *', /Invalid minute value/], ['@never', /Unknown alias/], ['1,,2 * * * *', /Invalid minute/], ['0 0 31 2 *', /never runs/], ['1-2-3 * * * *', /Invalid range/], ['1/2/3 * * * *', /Invalid/]])
    assert.throws(() => parseCron(e), (x) => x instanceof CronError && re.test(x.message), e);
  assert.throws(() => parseCron(5), CronError); assert.throws(() => parseCron('x'.repeat(300)), /too long/);
});
test('describe', () => {
  assert.equal(describe('* * * * *'), 'Every minute, every day (UTC)');
  assert.equal(describe('*/15 * * * *'), 'Every 15 minutes, every day (UTC)');
  assert.equal(describe('30 * * * *'), 'At minute 30 past every hour, every day (UTC)');
  assert.equal(describe('0 9 * * 1-5'), 'At 09:00, on Monday, Tuesday, Wednesday, Thursday and Friday (UTC)');
  assert.equal(describe('0 0 1 1 *'), 'At 00:00, on day 1 of the month, in January (UTC)');
  assert.equal(describe('*/5 9-17 * * 1-5'), 'Every 5 minutes, between 09:00 and 17:59, on Monday, Tuesday, Wednesday, Thursday and Friday (UTC)');
  assert.equal(describe('*/10 8,12 * * *'), 'Every 10 minutes, during hours 8 and 12, every day (UTC)');
  assert.equal(describe('*/10 3 * * *'), 'Every 10 minutes, during hour 3, every day (UTC)');
  assert.match(describe('0,5,10,15 9-17 * * *'), /times per day/);
});
test('never loops forever / bounded search', () => { assert.deepEqual(nextRuns('0 0 29 2 *', new Date('2026-01-01'), 0), []); });
