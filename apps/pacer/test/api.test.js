import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/server.js';

let base, server;
const call = (m, p, b) => fetch(base + '/api' + p, { method: m, headers: { 'Content-Type': 'application/json' }, body: b === undefined ? undefined : JSON.stringify(b) });
const post = async (b) => (await call('POST', '/calc', b));
before(async () => { server = createApp().server; await new Promise((r) => server.listen(0, r)); base = `http://127.0.0.1:${server.address().port}`; });
after(() => server.close());

test('calc: solves each of the three unknowns', async () => {
  const a = await (await post({ distance: '10k', time: '50:00' })).json(); assert.equal(a.paceText, '5:00'); assert.equal(a.speedKmh, 12); assert.equal(a.timeText, '50:00'); assert.equal(a.splits.length, 10); assert.equal(a.splits.at(-1).cumulative, '50:00');
  const b = await (await post({ distance: 'marathon', pace: '5:00' })).json(); assert.equal(b.timeText, '3:30:59'); // 42.195 × 300 s = 12658.5 s
  const c = await (await post({ time: '1h', pace: '6:00' })).json(); assert.equal(c.distance, 10000);
  const m = await (await post({ distance: '10k', time: '50:00', unit: 'mi' })).json(); assert.equal(m.paceText, '8:03'); assert.equal(m.splits.length, 7);
});
test('calc: predictions use Riegel and are ordered', async () => {
  const r = await (await post({ distance: '10k', time: '50:00' })).json(); const names = r.predictions.map((p) => p.name); assert.deepEqual(names, ['5K', '10K', 'Half marathon', 'Marathon']); assert.equal(r.predictions[1].time, '50:00'); assert.equal(r.predictions[0].time, '23:59'); assert.equal(r.predictions[3].time, '3:50:01');
});
test('calc: negative split affects splits but not total; validation', async () => {
  const r = await (await post({ distance: '10k', time: '50:00', negative: 3 })).json(); assert.equal(r.splits.at(-1).cumulative, '50:00'); assert.notEqual(r.splits[0].pace, r.splits[9].pace);
  const cases = [[{ distance: '10k' }, 'form'], [{ distance: '10k', time: '50:00', pace: '5:00' }, 'form'], [{ distance: 'far', time: '50:00' }, 'distance'], [{ distance: '10k', time: '1:75' }, 'time'], [{ distance: '10k', pace: 'x' }, 'pace'], [{ distance: '10k', time: '50:00', negative: 50 }, 'negative'], [{ time: '0:01', pace: '30:00' }, 'form']];
  for (const [b, k] of cases) { const x = await post(b); assert.equal(x.status, 422, JSON.stringify(b)); assert.ok((await x.json()).details[k], k + ' ' + JSON.stringify(b)); }
});
test('goals: CRUD, ordering by race date, validation', async () => {
  const g1 = await (await call('POST', '/goals', { name: 'Autumn 10K', distance: '10k', time: '48:00', raceDate: '2026-10-04' })).json(); assert.equal(g1.paceText, '4:48'); assert.equal(g1.paceMi, '7:43');
  const g0 = await (await call('POST', '/goals', { name: 'Spring 5K', distance: '5k', time: '22:30', raceDate: '2026-04-01' })).json(); const g2 = await (await call('POST', '/goals', { name: 'Someday marathon', distance: 'marathon', time: '3:45:00' })).json();
  assert.deepEqual((await (await call('GET', '/goals')).json()).map((g) => g.id), [g0.id, g1.id, g2.id], 'dated goals first, undated last');
  const u = await (await call('PUT', `/goals/${g1.id}`, { name: 'Autumn 10K', distance: '10k', time: '47:30', raceDate: '' })).json(); assert.equal(u.raceDate, null); assert.equal(u.timeText, '47:30');
  for (const [b, k] of [[{ name: '', distance: '10k', time: '40:00' }, 'name'], [{ name: 'x', distance: '0', time: '40:00' }, 'distance'], [{ name: 'x', distance: '10k', time: 'soon' }, 'time'], [{ name: 'x', distance: '10k', time: '40:00', raceDate: '2026-02-30' }, 'raceDate']]) { const x = await call('POST', '/goals', b); assert.equal(x.status, 422); assert.ok((await x.json()).details[k], k); }
  assert.equal((await call('DELETE', `/goals/${g2.id}`)).status, 204); assert.equal((await call('PUT', `/goals/${g2.id}`, { name: 'x', distance: '5k', time: '20:00' })).status, 404); assert.equal((await call('GET', '/goals/zz')).status, 400);
});
test('errors and static', async () => {
  assert.equal((await fetch(base + '/api/calc', { method: 'POST', body: '{x' })).status, 400); assert.equal((await fetch(base + '/%2e%2e/package.json')).status, 404);
  assert.match(await (await fetch(base + '/pace.js')).text(), /export function parseTime/);
});
