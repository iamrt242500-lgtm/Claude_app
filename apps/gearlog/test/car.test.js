import test from 'node:test';
import assert from 'node:assert/strict';
import { consumption, averageConsumption, costPerKm, serviceStatus, addMonths } from '../src/car.js';

const F = (day, odometer, liters, full = true) => ({ day, odometer, ml: Math.round(liters * 1000), full });
test('consumption: first full fill-up is only a baseline; each later full fill-up gives a trip', () => {
  const t = consumption([F('2026-01-01', 10000, 40), F('2026-01-15', 10500, 30), F('2026-02-01', 11100, 36)]);
  assert.equal(t.length, 2); assert.deepEqual(t[0], { day: '2026-01-15', km: 500, ml: 30000, lPer100: 6, kmPerL: 16.67 }); assert.deepEqual([t[1].km, t[1].lPer100], [600, 6]);
});
test('partial fills add to the next full fill-up (a classic mistake is measuring each fill alone)', () => {
  const t = consumption([F('2026-01-01', 10000, 40), F('2026-01-08', 10250, 15, false), F('2026-01-15', 10500, 15)]); assert.equal(t.length, 1); assert.deepEqual([t[0].km, t[0].ml, t[0].lPer100], [500, 30000, 6]);
  assert.deepEqual(consumption([F('2026-01-01', 10000, 40, false), F('2026-01-15', 10500, 30, false)]), [], 'no full fill-up → nothing measurable'); assert.deepEqual(consumption([F('2026-01-01', 10000, 40)]), []);
  assert.equal(consumption([F('2026-01-05', 10000, 40, false), F('2026-01-06', 10100, 8), F('2026-01-20', 10600, 30)]).length, 1, 'fuel before the first full fill-up is ignored; the first full one is the baseline');
});
test('input order does not matter; same odometer is ignored; odometer rollback cannot produce negative trips', () => {
  const t = consumption([F('2026-02-01', 11100, 36), F('2026-01-01', 10000, 40), F('2026-01-15', 10500, 30)]); assert.deepEqual(t.map((x) => x.km), [500, 600]); assert.deepEqual(consumption([F('2026-01-01', 10000, 40), F('2026-01-02', 10000, 5)]), []);
});
test('averages are distance-weighted, not a mean of ratios', () => {
  const trips = [{ km: 100, ml: 10000, lPer100: 10 }, { km: 900, ml: 45000, lPer100: 5 }]; assert.deepEqual(averageConsumption(trips), { lPer100: 5.5, km: 1000, liters: 55 }); assert.equal(averageConsumption([]), null);
  assert.equal(costPerKm(5500, 1000), 5.5); assert.equal(costPerKm(100, 0), null);
});
test('addMonths clamps to the month end', () => { assert.equal(addMonths('2026-01-31', 1), '2026-02-28'); assert.equal(addMonths('2024-01-31', 1), '2024-02-29'); assert.equal(addMonths('2026-11-15', 3), '2027-02-15'); assert.equal(addMonths('2026-03-15', 12), '2027-03-15'); });
test('serviceStatus: km limit, time limit, whichever comes first; soon/overdue/never', () => {
  const oil = { everyKm: 10000, everyMonths: 12 }, last = { odometer: 20000, day: '2025-06-01' };
  assert.deepEqual(serviceStatus(oil, last, 24000, '2026-01-01'), { status: 'ok', dueKm: 30000, dueDay: '2026-06-01', kmLeft: 6000, daysLeft: 151 });
  assert.equal(serviceStatus(oil, last, 29000, '2026-01-01').status, 'soon', '1000 km left is exactly 10 %'); assert.equal(serviceStatus(oil, last, 28999, '2026-01-01').status, 'ok'); assert.equal(serviceStatus(oil, last, 30001, '2026-01-01').status, 'overdue', 'km exceeded');
  assert.equal(serviceStatus(oil, last, 21000, '2026-06-02').status, 'overdue', 'time exceeded even though km are fine'); assert.equal(serviceStatus(oil, last, 21000, '2026-05-18').status, 'soon', '14 days left'); assert.equal(serviceStatus(oil, last, 21000, '2026-05-17').status, 'ok');
  assert.equal(serviceStatus(oil, null, 21000, '2026-01-01').status, 'never');
  const km = { everyKm: 5000, everyMonths: null };
  assert.deepEqual(serviceStatus(km, last, 24000, '2030-01-01'), { status: 'ok', dueKm: 25000, dueDay: null, kmLeft: 1000, daysLeft: null }, 'no time limit: years pass without effect; 1000 of 5000 km left is 20 %');
  assert.equal(serviceStatus(km, last, 24500, '2030-01-01').status, 'soon', '500 km left is exactly 10 %'); assert.equal(serviceStatus(km, last, 25000, '2030-01-01').status, 'soon', 'due exactly now is not yet overdue'); assert.equal(serviceStatus(km, last, 25001, '2030-01-01').status, 'overdue');
  assert.equal(serviceStatus({ everyKm: null, everyMonths: null }, null, 1, '2026-01-01').status, 'ok', 'a task with no interval never nags');
});
