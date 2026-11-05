import test from 'node:test';
import assert from 'node:assert/strict';
import { pagesPerDay, mergeDays, rate, eta, streak, longestStreak, goalPace, addDays, isLeap, isDate } from '../src/reading.js';

const L = (day, page) => ({ day, page });
test('pagesPerDay: differences, first log from zero, corrections count as zero', () => {
  const m = pagesPerDay([L('2026-03-03', 90), L('2026-03-01', 30), L('2026-03-02', 55), L('2026-03-05', 80)]); assert.deepEqual([...m], [['2026-03-01', 30], ['2026-03-02', 25], ['2026-03-03', 35], ['2026-03-05', 0]]);
  assert.deepEqual([...pagesPerDay([])], []);
});
test('mergeDays sums books', () => { assert.deepEqual([...mergeDays([new Map([['a', 5], ['b', 1]]), new Map([['a', 2]])])], [['a', 7], ['b', 1]]); });
test('rate: zero days count; window boundary', () => {
  const inside = new Map([['2026-03-14', 28], ['2026-03-01', 100]]); assert.equal(rate(inside, '2026-03-14', 14), 128 / 14, '03-01 is 13 days back: the last day of the window');
  const outside = new Map([['2026-03-14', 28], ['2026-02-28', 100]]); assert.equal(rate(outside, '2026-03-14', 14), 2, '02-28 is 14 days back: just outside');
  assert.equal(rate(new Map(), '2026-03-14'), 0); assert.equal(rate(new Map([['2026-03-14', 10], ['2026-03-13', 10]]), '2026-03-14', 2), 10);
});
test('eta', () => { assert.deepEqual(eta(100, 12, '2026-03-14'), { days: 9, date: '2026-03-23' }); assert.deepEqual(eta(120, 12, '2026-03-14'), { days: 10, date: '2026-03-24' }); assert.equal(eta(150, 150 / 14, '2026-03-14').days, 14, 'exact division must not round up because of float error'); assert.equal(eta(100, 0, '2026-03-14'), null); assert.equal(eta(0, 5, '2026-03-14'), null); });
test('streak: ends today or yesterday, breaks on a zero day; longest streak', () => {
  const m = new Map([['2026-03-10', 5], ['2026-03-11', 1], ['2026-03-12', 20], ['2026-03-13', 0], ['2026-03-14', 7]]);
  assert.equal(streak(m, '2026-03-14'), 1, '03-13 was a zero day'); assert.equal(streak(m, '2026-03-15'), 1, 'nothing yet today → still alive from yesterday'); assert.equal(streak(m, '2026-03-16'), 0);
  assert.equal(streak(new Map([['2026-03-12', 5], ['2026-03-13', 5], ['2026-03-14', 5]]), '2026-03-14'), 3); assert.equal(longestStreak(m), 3); assert.equal(longestStreak(new Map()), 0);
});
test('goalPace: ahead/behind/on track and leap years', () => {
  assert.equal(isLeap(2024), true); assert.equal(isLeap(2100), false); assert.equal(isLeap(2000), true);
  const mid = goalPace(24, 12, '2026-07-02'); assert.equal(mid.dayOfYear, 183); assert.equal(mid.daysInYear, 365); assert.equal(mid.expected, 12); assert.equal(mid.status, 'on track');
  assert.equal(goalPace(24, 15, '2026-07-02').status, 'ahead'); assert.equal(goalPace(24, 9, '2026-07-02').status, 'behind'); assert.equal(goalPace(24, 9, '2026-07-02').diff, -3);
  assert.equal(goalPace(12, 0, '2024-12-31').daysInYear, 366); assert.equal(goalPace(12, 0, '2024-12-31').expected, 12); assert.equal(goalPace(12, 12, '2026-01-01').booksPerMonthNeeded, 0);
  assert.equal(goalPace(12, 0, '2026-01-01').dayOfYear, 1);
});
test('date helpers', () => { assert.equal(addDays('2026-02-28', 1), '2026-03-01'); assert.equal(isDate('2026-02-29'), false); });
