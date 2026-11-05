import test from 'node:test';
import assert from 'node:assert/strict';
import { currentStreak, longestStreak, completionRate, normalizeSchedule, isDate, addDays, weekday } from '../src/streak.js';

const ALL = [0, 1, 2, 3, 4, 5, 6], WEEKDAYS = [1, 2, 3, 4, 5];
const S = (...d) => new Set(d);
// 2026-03-09 is a Monday.
test('date helpers', () => {
  assert.equal(weekday('2026-03-09'), 1); assert.equal(addDays('2026-03-01', -1), '2026-02-28'); assert.equal(addDays('2024-02-28', 1), '2024-02-29');
  assert.ok(isDate('2026-02-28')); assert.ok(!isDate('2026-02-30')); assert.ok(!isDate('2026-2-3')); assert.ok(!isDate(null));
});
test('daily habit: consecutive days, today is a grace day', () => {
  assert.equal(currentStreak(ALL, S('2026-03-07', '2026-03-08', '2026-03-09'), '2026-03-01', '2026-03-09'), 3);
  assert.equal(currentStreak(ALL, S('2026-03-07', '2026-03-08'), '2026-03-01', '2026-03-09'), 2, 'today not done yet does not break');
  assert.equal(currentStreak(ALL, S('2026-03-07', '2026-03-09'), '2026-03-01', '2026-03-09'), 1, 'a gap breaks it');
  assert.equal(currentStreak(ALL, S(), '2026-03-01', '2026-03-09'), 0);
});
test('weekday-only habit skips weekends', () => {
  // Fri 6, (Sat 7, Sun 8 skipped), Mon 9
  assert.equal(currentStreak(WEEKDAYS, S('2026-03-05', '2026-03-06', '2026-03-09'), '2026-03-01', '2026-03-09'), 3);
  assert.equal(currentStreak(WEEKDAYS, S('2026-03-06'), '2026-03-01', '2026-03-09'), 1, 'Mon today undone, Fri done, Thu missing');
  assert.equal(currentStreak(WEEKDAYS, S('2026-03-05', '2026-03-06'), '2026-03-01', '2026-03-08'), 2, 'Sunday today: nothing scheduled');
});
test('extra check-ins on unscheduled days neither help nor hurt', () => {
  assert.equal(currentStreak(WEEKDAYS, S('2026-03-06', '2026-03-07', '2026-03-09'), '2026-03-01', '2026-03-09'), 2);
});
test('streak is bounded by start date', () => {
  assert.equal(currentStreak(ALL, S('2026-03-08', '2026-03-09'), '2026-03-09', '2026-03-09'), 1);
});
test('longest streak', () => {
  const done = S('2026-03-01', '2026-03-02', '2026-03-03', '2026-03-05', '2026-03-06');
  assert.equal(longestStreak(ALL, done, '2026-03-01', '2026-03-06'), 3);
  assert.equal(longestStreak(ALL, S(), '2026-03-01', '2026-03-06'), 0);
  assert.equal(longestStreak(ALL, S('2026-03-06'), '2026-03-01', '2026-03-06'), 1);
});
test('completion rate', () => {
  assert.equal(completionRate(ALL, S('2026-03-07', '2026-03-08'), '2026-03-06', '2026-03-09', 30), 67);   // 6th missed, 7 and 8 done (2 of 3); today undone is not a miss yet
  assert.equal(completionRate(WEEKDAYS, S(), '2026-03-07', '2026-03-08', 30), null);                    // weekend only
  assert.equal(completionRate(ALL, S('2026-03-09'), '2026-03-09', '2026-03-09'), 100);
});
test('normalizeSchedule', () => {
  assert.deepEqual(normalizeSchedule([5, 1, 1, 3]), null, 'duplicates rejected'); assert.deepEqual(normalizeSchedule([5, 1, 3]), [1, 3, 5]);
  assert.equal(normalizeSchedule([]), null); assert.equal(normalizeSchedule([7]), null); assert.equal(normalizeSchedule('x'), null); assert.equal(normalizeSchedule([1.5]), null);
});
