import test from 'node:test';
import assert from 'node:assert/strict';
import { splitByWeights, splitEqual, computeShares, balances, settleUp, toCents, SplitError } from '../src/split.js';

const sum = (o) => Object.values(o).reduce((s, x) => s + x, 0);
test('toCents', () => { assert.equal(toCents('12.34'), 1234); assert.equal(toCents('1,000'), 100000); assert.equal(toCents('0.5'), 50); for (const b of ['', '-1', '1.234', 'x', null]) assert.equal(toCents(b), null); });
test('equal split: remainder cents go to lowest ids; always sums to total', () => {
  assert.deepEqual(splitEqual(1000, [1, 2, 3]), { 1: 334, 2: 333, 3: 333 });
  assert.deepEqual(splitEqual(1001, [3, 1, 2]), { 1: 334, 2: 334, 3: 333 });
  assert.deepEqual(splitEqual(1, [1, 2, 3]), { 1: 1, 2: 0, 3: 0 });
  assert.deepEqual(splitEqual(0, [1, 2]), { 1: 0, 2: 0 });
});
test('property: any total / group size sums exactly and differs by at most 1 cent', () => {
  for (let n = 1; n <= 9; n++) for (const total of [1, 7, 99, 100, 1001, 33333, 999999]) {
    const r = splitEqual(total, Array.from({ length: n }, (_, i) => i + 1)); assert.equal(sum(r), total); const v = Object.values(r); assert.ok(Math.max(...v) - Math.min(...v) <= 1);
  }
});
test('weighted split keeps proportions and exact total', () => {
  assert.deepEqual(splitByWeights(1000, { 1: 2, 2: 1 }), { 1: 667, 2: 333 });
  assert.deepEqual(splitByWeights(10000, { 1: 50, 2: 30, 3: 20 }), { 1: 5000, 2: 3000, 3: 2000 });
  const r = splitByWeights(1000, { 1: 1, 2: 1, 3: 1, 4: 3 }); assert.equal(sum(r), 1000); assert.equal(r[4], 500);
  assert.throws(() => splitByWeights(100, {}), SplitError); assert.throws(() => splitByWeights(100, { 1: 0 }), SplitError); assert.throws(() => splitByWeights(100, { 1: -1 }), SplitError);
});
test('computeShares: equal / shares / percent / exact and their errors', () => {
  assert.deepEqual(computeShares(900, { type: 'equal', members: [1, 2, 3] }), { 1: 300, 2: 300, 3: 300 });
  assert.deepEqual(computeShares(900, { type: 'equal', members: [1, 1, 2] }), { 1: 450, 2: 450 }, 'duplicates collapse');
  assert.deepEqual(computeShares(900, { type: 'shares', values: { 1: 2, 2: 1, 3: 0 } }), { 1: 600, 2: 300 });
  assert.deepEqual(computeShares(1000, { type: 'percent', values: { 1: 70, 2: 30 } }), { 1: 700, 2: 300 });
  assert.throws(() => computeShares(1000, { type: 'percent', values: { 1: 70, 2: 20 } }), /add up to 100/);
  assert.deepEqual(computeShares(1000, { type: 'exact', values: { 1: '4.50', 2: '5.50', 3: '' } }), { 1: 450, 2: 550 });
  assert.throws(() => computeShares(1000, { type: 'exact', values: { 1: '4.50', 2: '5.00' } }), /add up to 9.50 but the total is 10.00/);
  assert.throws(() => computeShares(1000, { type: 'exact', values: { 1: 'abc' } }), /Invalid amount/);
  assert.throws(() => computeShares(1000, { type: 'equal', members: [] }), SplitError); assert.throws(() => computeShares(1000, { type: 'nope' }), /Unknown/); assert.throws(() => computeShares(1000, null), SplitError);
});
test('balances: payer is credited, sharers debited, settlements move balances; total is zero', () => {
  const ex = [{ paidBy: 1, amount: 3000, shares: { 1: 1000, 2: 1000, 3: 1000 } }, { paidBy: 2, amount: 1000, shares: { 1: 500, 2: 500 } }];
  const b = balances([1, 2, 3], ex); assert.deepEqual(b, { 1: 1500, 2: -500, 3: -1000 }); assert.equal(sum(b), 0);
  const after = balances([1, 2, 3], ex, [{ from: 3, to: 1, amount: 1000 }]); assert.deepEqual(after, { 1: 500, 2: -500, 3: 0 });
});
test('settleUp: clears every balance with at most n-1 transfers', () => {
  const bal = { 1: 5000, 2: -1500, 3: -2000, 4: -1500, 5: 0 };
  const t = settleUp(bal); assert.ok(t.length <= 3);
  const after = { ...bal }; for (const x of t) { after[x.from] += x.amount; after[x.to] -= x.amount; assert.ok(x.amount > 0); } assert.deepEqual(Object.values(after), [0, 0, 0, 0, 0]);
  assert.deepEqual(settleUp({ 1: 0, 2: 0 }), []); assert.deepEqual(settleUp({ 1: 100, 2: -100 }), [{ from: 2, to: 1, amount: 100 }]);
});
test('property: random scenarios always settle to zero in ≤ n-1 transfers', () => {
  let seed = 12345; const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  for (let k = 0; k < 200; k++) {
    const n = 2 + rnd(6), ids = Array.from({ length: n }, (_, i) => i + 1), ex = [];
    for (let e = 0; e < 1 + rnd(8); e++) { const amount = 1 + rnd(50000), members = ids.filter(() => rnd(2)).concat(ids[rnd(n)]); ex.push({ paidBy: ids[rnd(n)], amount, shares: computeShares(amount, { type: 'equal', members }) }); }
    const bal = balances(ids, ex); assert.equal(sum(bal), 0); const t = settleUp(bal); assert.ok(t.length <= n - 1);
    const after = balances(ids, ex, t); assert.ok(Object.values(after).every((v) => v === 0));
  }
});
