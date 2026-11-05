import test from 'node:test';
import assert from 'node:assert/strict';
import { dueDates, pickAssignee, fairness, addDays, isDate } from '../src/chores.js';

test('dueDates: daily, weekly, from mid-cycle, before start, inclusive ends', () => {
  const c = { start: '2026-03-02', every: 7 };
  assert.deepEqual(dueDates(c, '2026-03-01', '2026-03-31'), ['2026-03-02', '2026-03-09', '2026-03-16', '2026-03-23', '2026-03-30']);
  assert.deepEqual(dueDates(c, '2026-03-10', '2026-03-23'), ['2026-03-16', '2026-03-23'], 'window starts mid-cycle; end is inclusive'); assert.deepEqual(dueDates(c, '2026-03-03', '2026-03-08'), []); assert.deepEqual(dueDates(c, '2026-02-01', '2026-03-01'), [], 'before the start date');
  assert.deepEqual(dueDates({ start: '2026-03-01', every: 1 }, '2026-03-01', '2026-03-03'), ['2026-03-01', '2026-03-02', '2026-03-03']); assert.deepEqual(dueDates({ start: '2026-02-27', every: 2 }, '2026-02-28', '2026-03-04'), ['2026-03-01', '2026-03-03'], 'crosses a month end'); assert.deepEqual(dueDates({ start: '2026-03-01', every: 0 }, '2026-03-01', '2026-03-10'), []);
});
test('addDays / isDate', () => { assert.equal(addDays('2026-12-31', 1), '2027-01-01'); assert.equal(isDate('2026-02-29'), false); assert.equal(isDate('2024-02-29'), true); });
const M = (id, awayUntil = null) => ({ id, awayUntil });
test('pickAssignee: least loaded wins; ties go to who did this chore longest ago; then lowest id', () => {
  const members = [M(1), M(2), M(3)];
  assert.equal(pickAssignee('2026-03-10', members, new Map([[1, 5], [2, 3], [3, 4]]), new Map()), 2);
  assert.equal(pickAssignee('2026-03-10', members, new Map([[1, 3], [2, 3], [3, 3]]), new Map([[1, '2026-03-05'], [2, '2026-03-01'], [3, '2026-03-08']])), 2, 'tie on load → did it longest ago');
  assert.equal(pickAssignee('2026-03-10', members, new Map([[1, 3], [2, 3], [3, 3]]), new Map([[1, '2026-03-05']])), 2, 'equal load: someone who never did it beats someone who did; lowest id among them');
  assert.equal(pickAssignee('2026-03-10', members, new Map(), new Map()), 1, 'complete tie → lowest id');
});
test('pickAssignee: away members are skipped on the due day (inclusive of awayUntil as the last away day)', () => {
  const members = [M(1, '2026-03-12'), M(2), M(3)]; const load = new Map([[2, 10], [3, 10]]);
  assert.equal(pickAssignee('2026-03-12', members, load, new Map()), 2, 'still away on their last away day'); assert.equal(pickAssignee('2026-03-13', members, load, new Map()), 1, 'back the next day and least loaded');
  assert.equal(pickAssignee('2026-03-10', [M(1, '2026-03-20'), M(2, '2026-03-20')], new Map(), new Map()), null, 'everybody away → unassigned'); assert.equal(pickAssignee('2026-03-10', [], new Map(), new Map()), null);
});
test('pickAssignee rotates fairly over time (simulation)', () => {
  const members = [M(1), M(2), M(3)], load = new Map(), last = new Map(), counts = { 1: 0, 2: 0, 3: 0 };
  for (let i = 0; i < 30; i++) { const day = addDays('2026-03-01', i), w = pickAssignee(day, members, load, last); counts[w]++; load.set(w, (load.get(w) || 0) + 2); last.set(w, day); }
  assert.deepEqual(counts, { 1: 10, 2: 10, 3: 10 });
});
test('pickAssignee balances unequal chore weights', () => {
  const members = [M(1), M(2)], load = new Map(), pts = [5, 1, 1, 1, 1, 1, 1, 1, 1, 1]; const got = { 1: 0, 2: 0 };
  for (const [i, p] of pts.entries()) { const w = pickAssignee(addDays('2026-03-01', i), members, load, new Map()); got[w] += p; load.set(w, (load.get(w) || 0) + p); }
  assert.ok(Math.abs(got[1] - got[2]) <= 1, JSON.stringify(got));
});
test('fairness', () => {
  assert.deepEqual(fairness({ 1: 10, 2: 10 }), { total: 20, spread: 0, shares: { 1: 50, 2: 50 } }); assert.deepEqual(fairness({ 1: 15, 2: 5 }), { total: 20, spread: 10, shares: { 1: 75, 2: 25 } }); assert.deepEqual(fairness({ 1: 0, 2: 0, 3: 0 }), { total: 0, spread: 0, shares: { 1: 33, 2: 33, 3: 33 } }); assert.deepEqual(fairness({}), { total: 0, spread: 0, shares: {} });
});
