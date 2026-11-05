import test from 'node:test';
import assert from 'node:assert/strict';
import { reorder, normalizeLabels, isDate } from '../src/order.js';

test('reorder moves within list, clamps index', () => {
  assert.deepEqual(reorder([1, 2, 3, 4], 4, 0), [4, 1, 2, 3]);
  assert.deepEqual(reorder([1, 2, 3, 4], 1, 2), [2, 3, 1, 4]);
  assert.deepEqual(reorder([1, 2, 3], 2, 99), [1, 3, 2]);
  assert.deepEqual(reorder([1, 2, 3], 2, -5), [2, 1, 3]);
  assert.deepEqual(reorder([1, 2, 3], 2, undefined), [1, 3, 2]);
  assert.deepEqual(reorder([], 9, 0), [9]);
});
test('reorder does not mutate input', () => { const a = [1, 2, 3]; reorder(a, 3, 0); assert.deepEqual(a, [1, 2, 3]); });
test('normalizeLabels', () => {
  assert.deepEqual(normalizeLabels(' Bug, bug ,UI,,'), ['bug', 'ui']);
  assert.equal(normalizeLabels('a,b,c,d,e,f,g,h').length, 6); assert.deepEqual(normalizeLabels(undefined), []);
});
test('isDate', () => { assert.ok(isDate('2026-02-28')); assert.ok(!isDate('2026-13-01')); assert.ok(!isDate('tomorrow')); assert.ok(!isDate(null)); });
