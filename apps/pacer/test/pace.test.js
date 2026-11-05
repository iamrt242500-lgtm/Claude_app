import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTime, formatTime, parseDistance, paceSec, solve, riegel, splits, speedKmh, MILE } from '../src/pace.js';
const near = (a, b, e = 1e-6) => assert.ok(Math.abs(a - b) <= e, `${a} ≉ ${b}`);

test('parseTime: clock and unit forms; rejects invalid', () => {
  assert.equal(parseTime('1:45:30'), 6330); assert.equal(parseTime('25:10'), 1510); assert.equal(parseTime('25:10.5'), 1510.5); assert.equal(parseTime('90s'), 90); assert.equal(parseTime('45m'), 2700); assert.equal(parseTime('1h30m'), 5400); assert.equal(parseTime('1h 5m 3s'), 3903); assert.equal(parseTime(' 0:59 '), 59); assert.equal(parseTime(125), 125);
  for (const bad of ['', 'abc', '1:75', '1:99:00', '0:00', '0', '-5', '1:2:3:4', null, NaN, 0, '12:60']) assert.equal(parseTime(bad), null, String(bad));
});
test('formatTime', () => {
  assert.equal(formatTime(6330), '1:45:30'); assert.equal(formatTime(59), '0:59'); assert.equal(formatTime(1510.5, 1), '25:10.5'); assert.equal(formatTime(3599.6), '1:00:00', 'rounding carries into the hour'); assert.equal(formatTime(59.5), '1:00'); assert.equal(formatTime(NaN), '—');
  for (const t of [1, 59, 60, 3599, 3600, 86399]) assert.equal(parseTime(formatTime(t)), t);
});
test('parseDistance', () => {
  assert.equal(parseDistance('10k'), 10000); assert.equal(parseDistance('5 km'), 5000); assert.equal(parseDistance('10'), 10000, 'bare number is km'); assert.equal(parseDistance('6,2'), 6200); near(parseDistance('6.2 mi'), 6.2 * MILE); assert.equal(parseDistance('800m'), 800); assert.equal(parseDistance('Marathon'), 42195); assert.equal(parseDistance('half'), 21097.5);
  for (const bad of ['', 'far', '0', '-3k', '5 parsecs', '1e9', null, '2000000 m']) assert.equal(parseDistance(bad), null, String(bad));
});
test('pace, speed and solve (any two of three)', () => {
  assert.equal(paceSec(10000, 3000), 300); near(paceSec(10000, 3000, 'mi'), 300 * MILE / 1000); near(speedKmh(10000, 3000), 12);
  const a = solve({ distance: 10000, time: 3000 }); assert.equal(a.pace, 300); const b = solve({ distance: 10000, pace: 300 }); assert.equal(b.time, 3000); const c = solve({ time: 3000, pace: 300 }); assert.equal(c.distance, 10000); near(solve({ time: 3000, pace: 480 }, 'mi').distance, 3000 / 480 * MILE);
  assert.equal(solve({ distance: 1 }), null); assert.equal(solve({ distance: 1, time: 2, pace: 3 }), null);
});
test('Riegel: same distance is identity; marathon from a 10k; monotonic', () => {
  assert.equal(riegel(3000, 10000, 10000), 3000); near(riegel(3000, 10000, 42195), 3000 * (4.2195 ** 1.06), 1e-6); assert.ok(riegel(3000, 10000, 42195) > 3000 * 4.2195, 'longer races are slower per km');
});
test('splits: even → equal; totals exact; partial last split; negative split ramps and sums', () => {
  const e = splits(10000, 3000); assert.equal(e.splits.length, 10); assert.ok(e.splits.every((s) => Math.abs(s.split - 300) < 1e-9)); assert.equal(e.splits.at(-1).cumulative, 3000);
  const p = splits(5500, 1650); assert.equal(p.splits.length, 6); near(p.splits.at(-1).dist, 500); near(p.splits.at(-1).split, 150); near(p.splits.reduce((a, s) => a + s.split, 0), 1650);
  const ng = splits(10000, 3000, 'km', 4); near(ng.splits.reduce((a, s) => a + s.split, 0), 3000); assert.ok(ng.splits[0].pace > ng.splits[9].pace, 'later splits faster'); const half = (xs) => xs.reduce((a, s) => a + s.split, 0); assert.ok(half(ng.splits.slice(5)) < half(ng.splits.slice(0, 5)));
  near(half(ng.splits.slice(0, 5)) / half(ng.splits.slice(5)) - 1, 0.04, 0.012);
  const mi = splits(10000, 3000, 'mi'); assert.equal(mi.splits.length, 7); near(mi.splits.at(-1).dist, 10000 - 6 * MILE);
});
