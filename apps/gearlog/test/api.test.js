import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/server.js';

let base, server, id;
before(async () => { server = createApp({ now: () => new Date('2026-06-01T12:00:00Z') }).server; await new Promise((r) => server.listen(0, r)); base = `http://127.0.0.1:${server.address().port}`; });
after(() => server.close());
const call = (m, p, b) => fetch(base + '/api' + p, { method: m, headers: { 'Content-Type': 'application/json' }, body: b === undefined ? undefined : JSON.stringify(b) });
const J = async (m, p, b) => (await call(m, p, b)).json();
const fill = (day, odometer, liters, price, full = true) => call('POST', `/cars/${id}/fills`, { day, odometer, liters, price, full });

test('cars: create, validation, normalised plate', async () => {
  const c = await J('POST', '/cars', { name: ' Civic ', plate: 'ab-123' }); id = c.id; assert.deepEqual([c.name, c.plate, c.odometer, c.average], ['Civic', 'AB-123', 0, null]);
  for (const [b, k] of [[{ name: '' }, 'name'], [{ name: 'x', plate: 'x'.repeat(13) }, 'plate']]) { const r = await call('POST', '/cars', b); assert.equal(r.status, 422); assert.ok((await r.json()).details[k], k); }
});
test('fill-ups: consumption from full-tank pairs, partial fills, fuel cost per km', async () => {
  assert.equal((await fill('2026-01-01', 10000, '40.000', '60.00')).status, 201); await fill('2026-01-10', 10250, '15.5', '23.25', false); await fill('2026-01-20', 10500, '14.5', '21.75', true);
  let s = await J('GET', `/cars/${id}`); assert.equal(s.odometer, 10500); assert.equal(s.trips.length, 1); assert.deepEqual([s.trips[0].km, s.trips[0].ml, s.trips[0].lPer100], [500, 30000, 6]); assert.deepEqual(s.average, { lPer100: 6, km: 500, liters: 30 });
  assert.equal(s.costPerKm, 9, '23.25 + 21.75 = 45.00 of fuel over the 500 measured km = 9 cents per km');
  await fill('2026-02-05', 11100, '36', '57.60'); s = await J('GET', `/cars/${id}`); assert.equal(s.trips.length, 2); assert.deepEqual(s.trips.map((t) => t.lPer100), [6, 6]); assert.equal(s.fuelSpend, 6000 + 2325 + 2175 + 5760);
});
test('fill-up validation: text amounts, dates, odometer must fit between neighbouring readings', async () => {
  for (const [b, k] of [[{ day: '2026-03-01', odometer: 11200, liters: '0', price: '1', full: true }, 'liters'], [{ day: '2026-03-01', odometer: 11200, liters: 30, price: '1', full: true }, 'liters'], [{ day: '2026-03-01', odometer: 11200, liters: '30', price: 5, full: true }, 'price'], [{ day: '2026-03-01', odometer: 11200, liters: '30', price: '1', full: 'yes' }, 'full'], [{ day: '2026-07-01', odometer: 11200, liters: '30', price: '1', full: true }, 'day'], [{ day: '2026-02-30', odometer: 11200, liters: '30', price: '1', full: true }, 'day'], [{ day: '2026-03-01', odometer: -5, liters: '30', price: '1', full: true }, 'odometer'], [{ day: '2026-03-01', odometer: 11200.5, liters: '30', price: '1', full: true }, 'odometer']]) { const r = await call('POST', `/cars/${id}/fills`, b); assert.equal(r.status, 422, JSON.stringify(b)); assert.ok((await r.json()).details[k], k); }
  const low = await fill('2026-03-01', 10000, '30', '40'); assert.equal(low.status, 422); assert.match((await low.json()).details.odometer, /below 11100/); const high = await fill('2026-01-15', 12000, '30', '40'); assert.equal(high.status, 422); assert.match((await high.json()).details.odometer, /above 10500/);
  assert.equal((await fill('2026-01-15', 10400, '5', '8', false)).status, 201, 'fits between 10250 (01-10) and 10500 (01-20)');
});
test('service tasks: intervals, status from odometer and date, history, validation', async () => {
  const t = await J('POST', `/cars/${id}/tasks`, { name: 'Oil change', everyKm: 10000, everyMonths: 12 }); assert.equal(t.tasks[0].status, 'never');
  for (const [b, k] of [[{ name: '' , everyKm: 1000 }, 'name'], [{ name: 'x' }, 'everyKm'], [{ name: 'x', everyKm: 50 }, 'everyKm'], [{ name: 'x', everyMonths: 0 }, 'everyMonths'], [{ name: 'x', everyMonths: 1.5 }, 'everyMonths']]) { const r = await call('POST', `/cars/${id}/tasks`, b); assert.equal(r.status, 422, JSON.stringify(b)); assert.ok((await r.json()).details[k], k); }
  const taskId = t.tasks[0].id; const sv = await call('POST', `/cars/${id}/services`, { taskId, day: '2026-02-10', odometer: 11100, cost: '89.90', note: ' synthetic ' }); assert.equal(sv.status, 201); const s = await sv.json();
  assert.deepEqual([s.tasks[0].status, s.tasks[0].dueKm, s.tasks[0].dueDay, s.tasks[0].kmLeft, s.services[0].label, s.services[0].cost, s.services[0].note], ['ok', 21100, '2027-02-10', 10000, 'Oil change', 8990, 'synthetic']); assert.equal(s.serviceSpend, 8990);
  await fill('2026-05-20', 20500, '40', '70'); const later = await J('GET', `/cars/${id}`); assert.equal(later.tasks[0].kmLeft, 600); assert.equal(later.tasks[0].status, 'soon'); await fill('2026-05-25', 21200, '40', '70'); assert.equal((await J('GET', `/cars/${id}`)).tasks[0].status, 'overdue');
  const bad = await call('POST', `/cars/${id}/services`, { label: '', day: '2026-05-25', odometer: 21200 }); assert.equal(bad.status, 422); assert.ok((await bad.json()).details.label); assert.equal((await call('POST', `/cars/${id}/services`, { taskId: 999, day: '2026-05-25', odometer: 21200 })).status, 422);
  assert.equal((await call('POST', `/cars/${id}/services`, { label: 'Tyres', day: '2026-05-25', odometer: 20000 })).status, 422, '20000 km is below the 20500 km reading from 05-20');
  const free = await J('POST', `/cars/${id}/services`, { label: 'Wipers', day: '2026-05-26', odometer: 21200, cost: '' }); assert.equal(free.services[0].cost, 0);
});
test('list, delete entries, cascade, errors', async () => {
  const list = await J('GET', '/cars'); assert.equal(list[0].odometer, 21200); assert.equal(list[0].attention, 1); const s = await J('GET', `/cars/${id}`);
  assert.equal((await call('DELETE', `/cars/${id}/fills/${s.fills[0].id}`)).status, 200); assert.equal((await call('DELETE', `/cars/${id}/fills/99999`)).status, 404); assert.equal((await call('DELETE', `/cars/${id}/services/${s.services[0].id}`)).status, 200); assert.equal((await call('DELETE', `/cars/${id}/tasks/${s.tasks[0].id}`)).status, 200);
  assert.equal((await call('DELETE', `/cars/${id}`)).status, 204); assert.equal((await call('GET', `/cars/${id}`)).status, 404); assert.equal((await call('GET', '/cars/zz')).status, 400); assert.equal((await fetch(base + '/api/cars', { method: 'POST', body: '{x' })).status, 400); assert.equal((await fetch(base + '/%2e%2e/package.json')).status, 404);
});
