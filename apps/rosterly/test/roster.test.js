import test from 'node:test';
import assert from 'node:assert/strict';
import { toMin, span, hours, overlaps, weekStart, addDays, problems, totals, coverage, isDate } from '../src/roster.js';
const S = (day, start, end, extra = {}) => ({ day, start, end, ...extra });

test('toMin / isDate / addDays / weekStart', () => {
  assert.equal(toMin('00:00'), 0); assert.equal(toMin('23:59'), 1439); for (const bad of ['24:00', '9:00', '12:60', '', null, '12-00']) assert.equal(toMin(bad), null, String(bad));
  assert.equal(isDate('2026-02-30'), false); assert.equal(addDays('2026-02-28', 1), '2026-03-01'); assert.equal(addDays('2026-01-01', -1), '2025-12-31');
  assert.equal(weekStart('2026-03-11'), '2026-03-09', 'Wed → Mon'); assert.equal(weekStart('2026-03-09'), '2026-03-09'); assert.equal(weekStart('2026-03-15'), '2026-03-09', 'Sunday belongs to the week that started Monday'); assert.equal(weekStart('2026-03-01'), '2026-02-23');
});
test('span / hours: normal, overnight, invalid', () => {
  assert.equal(hours(S('2026-03-11', '09:00', '17:30')), 8.5); assert.equal(hours(S('2026-03-11', '22:00', '06:00')), 8, 'overnight'); assert.equal(hours(S('2026-03-11', '09:00', '09:00')), 0, 'zero-length is invalid'); assert.equal(hours(S('2026-03-11', '06:00', '23:00')), 0, '17 h exceeds the 16 h cap'); assert.equal(hours(S('2026-03-11', '06:00', '22:00')), 16); assert.equal(span(S('2026-13-01', '09:00', '10:00')), null);
  const o = span(S('2026-03-11', '22:00', '06:00')); assert.equal(o.end - o.start, 480);
});
test('overlaps: touching is fine; overnight spills into the next day', () => {
  assert.equal(overlaps(S('2026-03-11', '09:00', '12:00'), S('2026-03-11', '12:00', '15:00')), false); assert.equal(overlaps(S('2026-03-11', '09:00', '12:01'), S('2026-03-11', '12:00', '15:00')), true);
  assert.equal(overlaps(S('2026-03-11', '22:00', '06:00'), S('2026-03-12', '05:00', '08:00')), true, 'night shift runs until 06:00 next day'); assert.equal(overlaps(S('2026-03-11', '22:00', '06:00'), S('2026-03-12', '06:00', '08:00')), false); assert.equal(overlaps(S('2026-03-11', '22:00', '06:00'), S('2026-03-11', '05:00', '08:00')), false, 'same date early morning is before the shift');
});
const EX = [S('2026-03-09', '09:00', '17:00'), S('2026-03-10', '09:00', '17:00'), S('2026-03-11', '09:00', '17:00')];   // Mon–Wed, 24 h
const codes = (c, rules) => problems(c, EX, rules).map((p) => p.code);
test('problems: overlap and invalid input', () => {
  assert.deepEqual(codes(S('2026-03-12', '09:00', '17:00'), {}), []); assert.deepEqual(codes(S('2026-03-10', '16:00', '20:00'), {}), ['overlap']); assert.deepEqual(codes(S('2026-03-12', '09:00', '09:00'), {}), ['invalid']);
  assert.match(problems(S('2026-03-10', '16:00', '20:00'), EX)[0].message, /2026-03-10 09:00–17:00/);
});
test('problems: minimum rest is inclusive at the boundary, both directions', () => {
  const rest = problems(S('2026-03-11', '23:00', '23:30'), EX, { minRestHours: 8 }); assert.deepEqual(rest.map((p) => p.code), ['rest']); assert.match(rest[0].message, /6\.0 h rest/);
  assert.deepEqual(codes(S('2026-03-12', '04:00', '08:00'), { minRestHours: 11 }), [], '17:00→04:00 is exactly 11 h'); assert.deepEqual(codes(S('2026-03-12', '03:59', '08:00'), { minRestHours: 11 }), ['rest'], '10 h 59 min');
  assert.deepEqual(codes(S('2026-03-08', '23:00', '08:30'), { minRestHours: 1 }), ['rest'], 'ends 08:30 Monday: only 30 min before the 09:00 shift');
});
test('problems: weekly cap counts only that Monday–Sunday week', () => {
  assert.deepEqual(codes(S('2026-03-12', '09:00', '17:00'), { maxWeeklyHours: 32 }), [], '24 + 8 = 32 is allowed'); const w = problems(S('2026-03-12', '09:00', '17:00'), EX, { maxWeeklyHours: 30 }); assert.deepEqual(w.map((p) => p.code), ['weekly']); assert.match(w[0].message, /32 h this week \(max 30 h\)/);
  assert.deepEqual(codes(S('2026-03-16', '09:00', '17:00'), { maxWeeklyHours: 10 }), [], 'next week starts from zero'); assert.deepEqual(codes(S('2026-03-15', '09:00', '17:00'), { maxWeeklyHours: 30 }), ['weekly'], 'Sunday is in the same week as Monday');
});
test('problems: time off and weekday unavailability, including overnight spill', () => {
  assert.deepEqual(codes(S('2026-03-12', '09:00', '17:00'), { timeOff: ['2026-03-12'] }), ['timeoff']); assert.deepEqual(codes(S('2026-03-12', '09:00', '17:00'), { timeOff: ['2026-03-13'] }), []);
  assert.deepEqual(codes(S('2026-03-12', '22:00', '06:00'), { timeOff: ['2026-03-13'] }), ['timeoff'], 'spills into the day off'); assert.deepEqual(codes(S('2026-03-12', '09:00', '17:00'), { unavailable: [{ weekday: 4 }] }), ['unavailable'], 'Thursday = 4');
  assert.deepEqual(codes(S('2026-03-12', '22:00', '06:00'), { unavailable: [{ weekday: 5 }] }), ['unavailable'], 'Thursday night shift runs into Friday');
});
test('totals and coverage', () => {
  assert.deepEqual(totals([{ personId: 1, ...S('2026-03-09', '09:00', '17:00') }, { personId: 1, ...S('2026-03-10', '09:00', '13:00') }, { personId: 2, ...S('2026-03-09', '09:00', '17:00') }]), { 1: 12, 2: 8 });
  const cov = coverage([S('2026-03-11', '22:00', '06:00'), S('2026-03-12', '09:00', '17:00'), S('2026-03-12', '12:00', '14:30')], '2026-03-12'); assert.deepEqual(cov.slice(0, 7), [1, 1, 1, 1, 1, 1, 0], 'the night shift covers 00:00–06:00 of the next day'); assert.equal(cov[9], 1); assert.equal(cov[12], 2); assert.equal(cov[14], 2, '14:00–14:30 is within hour 14'); assert.equal(cov[15], 1); assert.equal(cov[17], 0); assert.equal(cov[23], 0);
});
