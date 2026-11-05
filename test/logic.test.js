import test from 'node:test';
import assert from 'node:assert/strict';
import { validateDecision, validateReview, computeStats, normalizeTags } from '../src/logic.js';

const ok = { title: 'T', prediction: 'P', confidence: 70, decidedAt: '2026-01-01', reviewOn: '2026-02-01', tags: 'A, b,a' };

test('validateDecision accepts valid input and normalizes tags', () => {
  const r = validateDecision(ok);
  assert.deepEqual(r.value.tags, ['a', 'b']);
});
test('validateDecision rejects impossible calendar dates', () => {
  const base = { title: 'T', prediction: 'P', confidence: 70, decidedAt: '2026-01-01', reviewOn: '2026-02-01' };
  for (const d of ['2026-02-30', '2026-13-01', '2026-04-31']) assert.ok(validateDecision({ ...base, reviewOn: d }).errors.reviewOn, d);
});
test('validateDecision rejects bad input', () => {
  const r = validateDecision({ title: ' ', confidence: 20, reviewOn: 'x' });
  assert.ok(r.errors.title && r.errors.prediction && r.errors.confidence && r.errors.reviewOn);
  assert.ok(validateDecision({ ...ok, reviewOn: '2025-12-31' }).errors.reviewOn);
  assert.ok(validateDecision({ ...ok, confidence: 70.5 }).errors.confidence);
  assert.ok(validateDecision(null).errors);
});
test('validateReview', () => {
  assert.ok(validateReview({ outcome: 'nope' }).errors.outcome);
  assert.equal(validateReview({ outcome: 'hit', outcomeNote: ' x ' }).value.outcomeNote, 'x');
});
test('normalizeTags caps at 10', () => {
  assert.equal(normalizeTags(Array.from({ length: 20 }, (_, i) => 't' + i)).length, 10);
});
test('computeStats: empty', () => {
  const s = computeStats([]);
  assert.equal(s.reviewed, 0); assert.equal(s.brier, null); assert.equal(s.verdict, null);
});
test('computeStats: brier, hit rate, buckets, verdict', () => {
  const mk = (confidence, outcome) => ({ status: 'reviewed', confidence, outcome });
  const list = [mk(90, 'miss'), mk(90, 'miss'), mk(90, 'hit'), mk(95, 'miss'), mk(80, 'hit'), { status: 'open', confidence: 60 }];
  const s = computeStats(list);
  assert.equal(s.reviewed, 5); assert.equal(s.open, 1);
  assert.equal(s.hitRate, 40);
  assert.equal(s.brier, Math.round(((0.81 + 0.81 + 0.01 + 0.9025 + 0.04) / 5) * 1000) / 1000);
  assert.equal(s.verdict, 'overconfident');
  const b90 = s.buckets.find((b) => b.lo === 90);
  assert.equal(b90.count, 4); assert.equal(b90.hitRate, 25);
});
test('partial counts as half', () => {
  const s = computeStats([{ status: 'reviewed', confidence: 50, outcome: 'partial' }]);
  assert.equal(s.hitRate, 50);
});
