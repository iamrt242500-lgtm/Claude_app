import test from 'node:test';
import assert from 'node:assert/strict';
import { season, interval, nextWatering, dueStatus, adherence, addDays, isDate } from '../src/plants.js';

test('season: meteorological, hemispheres', () => {
  assert.deepEqual(['2026-12-01', '2026-02-28', '2026-03-01', '2026-05-31', '2026-06-01', '2026-08-31', '2026-09-01', '2026-11-30'].map((d) => season(d)), ['winter', 'winter', 'spring', 'spring', 'summer', 'summer', 'autumn', 'autumn']);
  assert.equal(season('2026-12-01', true), 'summer'); assert.equal(season('2026-07-01', true), 'winter'); assert.equal(season('2026-03-15', true), 'autumn'); assert.equal(season('2026-10-15', true), 'spring');
});
test('interval: seasonal factors, rounding, floor of 1, opt-out', () => {
  const p = { everyDays: 8, seasonal: true }; assert.equal(interval(p, '2026-07-01'), 6, 'summer ×0.75'); assert.equal(interval(p, '2026-01-10'), 14, 'winter ×1.75'); assert.equal(interval(p, '2026-04-10'), 8); assert.equal(interval(p, '2026-10-10'), 10, 'autumn ×1.25');
  assert.equal(interval({ everyDays: 1, seasonal: true }, '2026-07-01'), 1, 'never below one day'); assert.equal(interval({ everyDays: 8, seasonal: false }, '2026-01-10'), 8); assert.equal(interval(p, '2026-07-01', true), 14, 'southern winter in July');
});
test('nextWatering: never watered → added date; interval taken from the season of the due date', () => {
  assert.equal(nextWatering({ added: '2026-03-01', lastWatered: null, everyDays: 7, seasonal: true }), '2026-03-01');
  const p = { added: '2026-01-01', everyDays: 8, seasonal: true };
  assert.equal(nextWatering({ ...p, lastWatered: '2026-07-01' }), '2026-07-07', 'summer: 6 days'); assert.equal(nextWatering({ ...p, lastWatered: '2026-05-28' }), '2026-06-03', 'watered in spring but due in summer → 6 days');
  assert.equal(nextWatering({ ...p, lastWatered: '2026-11-25' }), '2026-12-09', 'autumn watering, winter due date → winter interval (14) wins'); assert.equal(nextWatering({ ...p, lastWatered: '2026-07-01', seasonal: false }), '2026-07-09');
});
test('dueStatus: overdue, today, soon, ok', () => {
  const p = { added: '2026-01-01', everyDays: 7, seasonal: false, lastWatered: '2026-04-01' };   // due 04-08
  assert.deepEqual(dueStatus(p, '2026-04-10'), { due: '2026-04-08', daysLeft: -2, status: 'overdue' }); assert.equal(dueStatus(p, '2026-04-08').status, 'today'); assert.equal(dueStatus(p, '2026-04-07').status, 'soon'); assert.equal(dueStatus(p, '2026-04-06').status, 'soon'); assert.equal(dueStatus(p, '2026-04-05').status, 'ok');
  assert.equal(dueStatus({ added: '2026-04-02', lastWatered: null, everyDays: 7 }, '2026-04-05').status, 'overdue', 'never watered and the start date has passed');
});
test('adherence', () => {
  assert.equal(adherence(['2026-04-01'], 7), null); assert.deepEqual(adherence(['2026-04-01', '2026-04-08', '2026-04-17'], 7), { meanGap: 8, drift: 1, longest: 9 }); assert.deepEqual(adherence(['2026-04-17', '2026-04-01', '2026-04-08'], 7), { meanGap: 8, drift: 1, longest: 9 }, 'order-independent'); assert.equal(adherence(['2026-04-01', '2026-04-05'], 7).drift, -3);
});
test('date helpers', () => { assert.equal(addDays('2026-02-27', 3), '2026-03-02'); assert.equal(isDate('2026-04-31'), false); });
