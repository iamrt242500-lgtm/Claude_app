import test from 'node:test';
import assert from 'node:assert/strict';
import { workingDays, isWorkday, nextWorkday, addWorkdays, ideal, remainingAt, actual, forecast } from '../src/sprint.js';

const T = (points, addedDay, doneDay = null) => ({ points, addedDay, doneDay });
test('working days skip weekends', () => {
  assert.deepEqual(workingDays('2026-03-09', '2026-03-15'), ['2026-03-09', '2026-03-10', '2026-03-11', '2026-03-12', '2026-03-13']); assert.equal(workingDays('2026-03-14', '2026-03-15').length, 0); assert.equal(workingDays('2026-03-09', '2026-03-20').length, 10);
  assert.equal(isWorkday('2026-03-13'), true); assert.equal(isWorkday('2026-03-14'), false); assert.equal(nextWorkday('2026-03-13'), '2026-03-16', 'Friday → Monday'); assert.equal(nextWorkday('2026-03-14'), '2026-03-16');
  assert.equal(addWorkdays('2026-03-12', 3), '2026-03-17'); assert.equal(addWorkdays('2026-03-12', 0), '2026-03-12');
});
test('ideal burndown ends at zero and is linear', () => {
  const i = ideal(20, workingDays('2026-03-09', '2026-03-13')); assert.deepEqual(i.map((x) => x.ideal), [16, 12, 8, 4, 0]); assert.deepEqual(ideal(10, workingDays('2026-03-09', '2026-03-20')).map((x) => x.ideal).slice(-2), [1, 0]); assert.deepEqual(ideal(7, ['2026-03-09', '2026-03-10', '2026-03-11']).map((x) => x.ideal), [4.67, 2.33, 0]); assert.deepEqual(ideal(5, []), []);
});
test('remainingAt: done on the day counts as done at its end; scope added mid-sprint counts from its day', () => {
  const tasks = [T(5, '2026-03-09', '2026-03-10'), T(3, '2026-03-09'), T(8, '2026-03-11', '2026-03-12')];
  assert.equal(remainingAt(tasks, '2026-03-09'), 8); assert.equal(remainingAt(tasks, '2026-03-10'), 3, 'the 5 was finished on 03-10'); assert.equal(remainingAt(tasks, '2026-03-11'), 11, 'the 8 was added'); assert.equal(remainingAt(tasks, '2026-03-12'), 3);
});
test('actual burndown only up to today', () => { const a = actual([T(5, '2026-03-09', '2026-03-10')], workingDays('2026-03-09', '2026-03-13'), '2026-03-11'); assert.deepEqual(a, [{ day: '2026-03-09', remaining: 5 }, { day: '2026-03-10', remaining: 0 }, { day: '2026-03-11', remaining: 0 }]); });
test('forecast: on track / ahead / behind, velocity and finish date', () => {
  const s = '2026-03-09', e = '2026-03-20';   // 10 working days, 20 points
  const base = [T(5, s), T(5, s), T(5, s), T(5, s)];
  const behind = forecast([{ ...base[0], doneDay: '2026-03-09' }, base[1], base[2], base[3]], s, e, '2026-03-11'); assert.deepEqual([behind.scope, behind.remaining, behind.elapsedWorkdays, behind.ideal, behind.status], [20, 15, 3, 14, 'behind']); assert.equal(behind.velocity, 1.67); assert.equal(behind.workdaysLeft, 9); assert.equal(behind.finish, '2026-03-24'); assert.equal(behind.finishesInSprint, false);
  const ahead = forecast([{ ...base[0], doneDay: '2026-03-09' }, { ...base[1], doneDay: '2026-03-10' }, { ...base[2], doneDay: '2026-03-11' }, base[3]], s, e, '2026-03-11'); assert.deepEqual([ahead.remaining, ahead.status, ahead.velocity, ahead.workdaysLeft, ahead.finish, ahead.finishesInSprint], [5, 'ahead', 5, 1, '2026-03-12', true]);
  const ok = forecast([{ ...base[0], doneDay: '2026-03-09' }, { ...base[1], doneDay: '2026-03-10' }, base[2], base[3]], s, e, '2026-03-10'); assert.equal(ok.ideal, 16); assert.equal(ok.remaining, 10); assert.equal(ok.status, 'ahead');
});
test('forecast edge cases: nothing done, finished, before start, no tasks, scope creep', () => {
  const s = '2026-03-09', e = '2026-03-13'; const none = forecast([T(5, s)], s, e, '2026-03-10'); assert.deepEqual([none.velocity, none.workdaysLeft, none.finish, none.finishesInSprint], [0, null, null, false]);
  const done = forecast([T(5, s, '2026-03-10')], s, e, '2026-03-11'); assert.deepEqual([done.status, done.remaining, done.finish, done.finishesInSprint], ['complete', 0, null, true]);
  assert.equal(forecast([T(5, s)], s, e, '2026-03-05').status, 'not started'); assert.equal(forecast([], s, e, '2026-03-10').status, 'on track'); assert.equal(forecast([], s, e, '2026-03-10').scope, 0);
  const creep = forecast([T(5, s, '2026-03-09'), T(5, '2026-03-10')], s, e, '2026-03-10'); assert.equal(creep.scope, 5, 'scope is what was committed at the start'); assert.equal(creep.remaining, 5);
  const after = forecast([T(5, s, '2026-03-12'), T(5, s)], s, e, '2026-03-20'); assert.equal(after.elapsedWorkdays, 5, 'days after the sprint do not inflate elapsed time'); assert.equal(after.remaining, 5);
});
