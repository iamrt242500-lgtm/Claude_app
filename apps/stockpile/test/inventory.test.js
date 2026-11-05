import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMoney, formatMoney, replay, dailyUsage, daysOfCover, isLow } from '../src/inventory.js';

const R = (id, day, qty, unitCost) => ({ id, day, type: 'receive', qty, unitCost });
const I = (id, day, qty) => ({ id, day, type: 'issue', qty });
const A = (id, day, qty, unitCost) => ({ id, day, type: 'adjust', qty, unitCost });

test('money helpers', () => { assert.equal(parseMoney('2.5'), 250); assert.equal(parseMoney('$1,000.05'), 100005); assert.equal(parseMoney('0'), 0); for (const b of ['', '-1', '1.234', 'x', null, 1.5]) assert.equal(parseMoney(b), null, String(b)); assert.equal(formatMoney(100005), '1,000.05'); assert.equal(formatMoney(-5), '-0.05'); });
test('FIFO: issues consume the oldest lot first and cost is exact', () => {
  const r = replay([R(1, '2026-01-01', 10, 100), R(2, '2026-01-05', 10, 150), I(3, '2026-01-06', 12)]);
  assert.equal(r.ok, true); assert.equal(r.cost.get(3), 10 * 100 + 2 * 150, 'ten at 1.00 then two at 1.50'); assert.equal(r.onHand, 8); assert.deepEqual(r.lots, [{ qty: 8, cost: 150, day: '2026-01-05', id: 2 }]); assert.equal(r.value, 8 * 150);
  assert.equal(r.balanceAfter.get(1), 10); assert.equal(r.balanceAfter.get(2), 20); assert.equal(r.balanceAfter.get(3), 8);
});
test('replay sorts by date then id regardless of input order (backdating)', () => {
  const r = replay([I(3, '2026-01-06', 5), R(2, '2026-01-05', 10, 150), R(1, '2026-01-01', 10, 100)]); assert.equal(r.ok, true); assert.equal(r.cost.get(3), 500, 'the 01-01 lot is consumed first');
  const same = replay([I(2, '2026-01-01', 3), R(1, '2026-01-01', 5, 100)]); assert.equal(same.ok, true, 'same day: lower id first');
  assert.equal(replay([I(1, '2026-01-01', 3), R(2, '2026-01-01', 5, 100)]).ok, false, 'issue before receipt on the same day');
});
test('negative stock is refused at the exact movement and day', () => {
  const r = replay([R(1, '2026-01-01', 5, 100), I(2, '2026-01-02', 6)]); assert.equal(r.ok, false); assert.equal(r.atId, 2); assert.match(r.error, /Only 5 on hand on 2026-01-02, can't remove 6/);
  const back = replay([R(1, '2026-01-10', 5, 100), I(2, '2026-01-05', 1)]); assert.equal(back.ok, false, 'issuing before anything was received'); assert.equal(replay([R(1, '2026-01-01', 5, 100), I(2, '2026-01-02', 5)]).ok, true, 'exactly zero is fine');
});
test('adjustments: positive adds a lot at the given cost, negative consumes FIFO', () => {
  const r = replay([R(1, '2026-01-01', 10, 100), A(2, '2026-01-02', 3, 120), A(3, '2026-01-03', -11)]); assert.equal(r.cost.get(2), 360); assert.equal(r.cost.get(3), 10 * 100 + 1 * 120); assert.equal(r.onHand, 2); assert.equal(r.value, 240);
  assert.equal(replay([A(1, '2026-01-01', 2)]).onHand, 2, 'adjust without cost counts at zero cost'); assert.deepEqual(replay([]), { ok: true, lots: [], onHand: 0, value: 0, cost: new Map(), balanceAfter: new Map() });
});
test('replay does not mutate its input', () => { const ms = [R(1, '2026-01-01', 10, 100), I(2, '2026-01-02', 4)]; const copy = JSON.parse(JSON.stringify(ms)); replay(ms); assert.deepEqual(ms, copy); });
test('usage, cover and low-stock', () => {
  const ms = [I(1, '2026-03-01', 30), I(2, '2026-03-20', 30), I(3, '2026-02-01', 100), A(4, '2026-03-25', -15), R(5, '2026-03-26', 50, 100)];
  assert.equal(dailyUsage(ms, '2026-03-30', 30), 75 / 30, '03-01..03-30 window: 30 + 30 + 15; the 02-01 issue and the receipt are excluded'); assert.equal(dailyUsage(ms, '2026-03-30', 10), 15 / 10, 'the 10-day window 03-21..03-30 holds only the −15 adjustment');
  assert.equal(daysOfCover(50, 2.5), 20); assert.equal(daysOfCover(7, 2), 3, 'rounded down'); assert.equal(daysOfCover(5, 0), null);
  assert.equal(isLow(5, 5), true); assert.equal(isLow(6, 5), false); assert.equal(isLow(0, 0), false, 'no reorder point set → never low');
});
