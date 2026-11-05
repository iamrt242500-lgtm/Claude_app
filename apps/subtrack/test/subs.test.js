import test from 'node:test';
import assert from 'node:assert/strict';
import { occurrence, nextRenewal, occurrencesBetween, monthlyCost, yearlyCost, daysUntil, daysInMonth, parseMoney, formatMoney, addDays } from '../src/subs.js';

test('daysInMonth incl. leap years', () => { assert.equal(daysInMonth(2026, 2), 28); assert.equal(daysInMonth(2028, 2), 29); assert.equal(daysInMonth(2100, 2), 28); assert.equal(daysInMonth(2026, 12), 31); assert.equal(daysInMonth(2026, 4), 30); });
test('occurrence: month-end clamping always anchors to the original day', () => {
  const m = [0, 1, 2, 3, 4].map((k) => occurrence('2026-01-31', 'month', 1, k)); assert.deepEqual(m, ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31']);
  assert.equal(occurrence('2028-01-31', 'month', 1, 1), '2028-02-29'); assert.equal(occurrence('2026-01-15', 'month', 3, 1), '2026-04-15'); assert.equal(occurrence('2026-11-30', 'month', 3, 1), '2027-02-28', 'year rollover with clamping');
});
test('occurrence: yearly (Feb 29) and weekly', () => {
  assert.deepEqual([0, 1, 2, 4].map((k) => occurrence('2024-02-29', 'year', 1, k)), ['2024-02-29', '2025-02-28', '2026-02-28', '2028-02-29']); assert.equal(occurrence('2026-03-01', 'year', 2, 1), '2028-03-01');
  assert.equal(occurrence('2026-03-02', 'week', 2, 3), '2026-04-13'); assert.equal(occurrence('2026-12-28', 'week', 1, 1), '2027-01-04');
});
test('nextRenewal: on the day counts as upcoming; before start; far in the future; matches brute force', () => {
  assert.equal(nextRenewal('2026-03-15', 'month', 1, '2026-03-15'), '2026-03-15'); assert.equal(nextRenewal('2026-03-15', 'month', 1, '2026-03-16'), '2026-04-15'); assert.equal(nextRenewal('2026-03-15', 'month', 1, '2026-01-01'), '2026-03-15', 'not started yet');
  assert.equal(nextRenewal('2026-01-31', 'month', 1, '2026-02-01'), '2026-02-28'); assert.equal(nextRenewal('2026-01-31', 'month', 1, '2026-03-01'), '2026-03-31'); assert.equal(nextRenewal('2020-02-29', 'year', 1, '2027-01-01'), '2027-02-28'); assert.equal(nextRenewal('2010-05-05', 'year', 1, '2026-05-06'), '2027-05-05');
  assert.equal(nextRenewal('x', 'day', 1, '2026-01-01'), null); assert.equal(nextRenewal('2026-01-01', 'month', 0, '2026-01-02'), null);
  for (const [start, unit, every] of [['2026-01-31', 'month', 1], ['2024-02-29', 'year', 1], ['2026-03-02', 'week', 3], ['2025-12-30', 'month', 2]]) for (let i = 0; i < 400; i += 7) { const asOf = addDays('2026-01-01', i); let k = 0; while (occurrence(start, unit, every, k) < asOf) k++; assert.equal(nextRenewal(start, unit, every, asOf), occurrence(start, unit, every, k), `${start} ${unit} ${every} @${asOf}`); }
});
test('occurrencesBetween', () => {
  assert.deepEqual(occurrencesBetween('2026-01-31', 'month', 1, '2026-02-01', '2026-05-31'), ['2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31']); assert.deepEqual(occurrencesBetween('2026-03-02', 'week', 1, '2026-03-01', '2026-03-23'), ['2026-03-02', '2026-03-09', '2026-03-16', '2026-03-23']); assert.deepEqual(occurrencesBetween('2026-06-01', 'month', 1, '2026-01-01', '2026-03-01'), []);
});
test('monthly and yearly equivalents (cents, rounded)', () => {
  assert.equal(monthlyCost(1200, 'year', 1), 100); assert.equal(monthlyCost(1000, 'month', 1), 1000); assert.equal(monthlyCost(3000, 'month', 3), 1000, 'quarterly'); assert.equal(monthlyCost(500, 'week', 1), 2167, '5.00/wk = 21.67/mo'); assert.equal(monthlyCost(1999, 'year', 1), 167); assert.equal(monthlyCost(1000, 'week', 2), 2167, '10.00 every 2 weeks = 5.00/wk');
  assert.equal(yearlyCost(1000, 'month', 1), 12000); assert.equal(yearlyCost(500, 'week', 1), 26000); assert.equal(yearlyCost(5000, 'year', 2), 2500); assert.equal(yearlyCost(1000, 'month', 3), 4000);
});
test('daysUntil / money', () => { assert.equal(daysUntil('2026-03-20', '2026-03-15'), 5); assert.equal(daysUntil('2026-03-15', '2026-03-15'), 0); assert.equal(daysUntil('2026-03-01', '2026-03-15'), -14); assert.equal(parseMoney('$9.99'), 999); assert.equal(parseMoney('12'), 1200); assert.equal(parseMoney('1.234'), null); assert.equal(parseMoney(9.99), null); assert.equal(formatMoney(123456), '1,234.56'); });
