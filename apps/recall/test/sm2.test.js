import test from 'node:test';
import assert from 'node:assert/strict';
import { schedule, parseBulk, addDays } from '../src/sm2.js';

const fresh = { ease: 2.5, reps: 0, interval: 0 };
test('first Good -> 1 day, second -> 6 days, third -> interval*ease', () => {
  const a = schedule(fresh, 3, '2026-01-01'); assert.equal(a.interval, 1); assert.equal(a.due, '2026-01-02'); assert.equal(a.ease, 2.5);
  const b = schedule(a, 3, '2026-01-02'); assert.equal(b.interval, 6);
  const c = schedule(b, 3, '2026-01-08'); assert.equal(c.interval, 15); assert.equal(c.reps, 3);
});
test('Again resets reps and interval', () => {
  const r = schedule({ ease: 2.5, reps: 5, interval: 30 }, 1, '2026-01-01');
  assert.equal(r.reps, 0); assert.equal(r.interval, 1); assert.equal(r.ease, 1.96);
});
test('Easy raises ease, Hard lowers it, floor at 1.3', () => {
  assert.equal(schedule(fresh, 4, '2026-01-01').ease, 2.6);
  assert.equal(schedule(fresh, 2, '2026-01-01').ease, 2.36);
  let c = { ease: 1.35, reps: 0, interval: 0 };
  for (let i = 0; i < 5; i++) c = schedule(c, 1, '2026-01-01');
  assert.equal(c.ease, 1.3);
});
test('invalid grade throws; addDays crosses month/year', () => {
  assert.throws(() => schedule(fresh, 9, '2026-01-01'), RangeError);
  assert.equal(addDays('2025-12-31', 1), '2026-01-01');
});
test('parseBulk', () => {
  const r = parseBulk('a :: b\n\nbad line\nx :: y :: z\n :: no front');
  assert.deepEqual(r.cards, [{ front: 'a', back: 'b' }, { front: 'x', back: 'y :: z' }]); assert.deepEqual(r.bad, [3, 5]);
});
