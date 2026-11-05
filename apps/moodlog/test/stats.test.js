import test from 'node:test';
import assert from 'node:assert/strict';
import { mean, pearson, strength, movingAverage, tagEffects, byWeekday } from '../src/stats.js';
const near = (a, b, e = 1e-9) => assert.ok(Math.abs(a - b) <= e, `${a} ≉ ${b}`);

test('mean', () => { assert.equal(mean([1, 2, 3, 4]), 2.5); assert.equal(mean([]), null); });
test('pearson: perfect, inverse, known value, undefined cases', () => {
  near(pearson([1, 2, 3, 4], [2, 4, 6, 8]), 1); near(pearson([1, 2, 3, 4], [8, 6, 4, 2]), -1);
  near(pearson([1, 2, 3, 4, 5], [2, 1, 4, 3, 5]), 0.8);   // Σdxdy=8, Σdx²=Σdy²=10 → 0.8
  assert.equal(pearson([1, 2], [1, 2]), null, 'n < 3'); assert.equal(pearson([3, 3, 3], [1, 2, 3]), null, 'zero variance'); assert.equal(pearson([1, 2, 3], [1, 2]), null, 'length mismatch');
});
test('strength labels', () => {
  assert.equal(strength(null), 'not enough data'); assert.equal(strength(0.1), 'no clear link'); assert.equal(strength(-0.1), 'no clear link'); assert.equal(strength(0.3), 'weak positive link'); assert.equal(strength(-0.5), 'moderate negative link'); assert.equal(strength(0.9), 'strong positive link'); assert.equal(strength(0.2), 'weak positive link', 'boundary is inclusive of the upper band');
});
test('movingAverage', () => { assert.deepEqual(movingAverage([1, 2, 3, 4, 5], 3), [null, null, 2, 3, 4]); assert.deepEqual(movingAverage([4], 1), [4]); assert.deepEqual(movingAverage([1, 2], 3), [null, null]); });
test('tagEffects: with/without means, ordering by effect size, min-days filter', () => {
  const e = (mood, ...tags) => ({ mood, tags });
  const data = [e(5, 'run'), e(4, 'run'), e(5, 'run', 'coffee'), e(2), e(3), e(2, 'coffee'), e(3, 'coffee'), e(4, 'rare')];
  const fx = tagEffects(data, 3); assert.deepEqual(fx.map((x) => x.tag), ['run', 'coffee']); const run = fx[0]; assert.equal(run.days, 3); near(run.withTag, 14 / 3); near(run.without, 14 / 5); near(run.diff, 14 / 3 - 14 / 5);
  assert.ok(!fx.some((x) => x.tag === 'rare'), 'seen on one day → skipped'); assert.deepEqual(tagEffects([e(3, 'a'), e(4, 'a')], 3), []); assert.deepEqual(tagEffects([e(3, 'a'), e(4, 'a'), e(5, 'a')], 3), [], 'no days without the tag → no comparison');
});
test('byWeekday', () => {
  const r = byWeekday([{ day: '2026-03-09', mood: 4 }, { day: '2026-03-16', mood: 2 }, { day: '2026-03-11', mood: 5 }]); assert.deepEqual(r[1], { n: 2, avg: 3 }); assert.deepEqual(r[3], { n: 1, avg: 5 }); assert.deepEqual(r[0], { n: 0, avg: null });
});
