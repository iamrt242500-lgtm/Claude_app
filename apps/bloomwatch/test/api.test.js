import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/server.js';

let base, server, clock = '2026-07-10T12:00:00Z';
before(async () => { server = createApp({ now: () => new Date(clock) }).server; await new Promise((r) => server.listen(0, r)); base = `http://127.0.0.1:${server.address().port}`; });
after(() => server.close());
const call = (m, p, b) => fetch(base + '/api' + p, { method: m, headers: { 'Content-Type': 'application/json' }, body: b === undefined ? undefined : JSON.stringify(b) });
const J = async (m, p, b) => (await call(m, p, b)).json();
let fern, cactus;

test('create: validation, never-watered plants are due on their start date', async () => {
  for (const [b, k] of [[{ name: '', everyDays: 7 }, 'name'], [{ name: 'x', everyDays: 0 }, 'everyDays'], [{ name: 'x', everyDays: 91 }, 'everyDays'], [{ name: 'x', everyDays: 7, added: '2026-02-30' }, 'added'], [{ name: 'x', everyDays: 7, seasonal: 'yes' }, 'seasonal'], [{ name: 'x', everyDays: 7, location: 'y'.repeat(41) }, 'location']]) { const r = await call('POST', '/plants', b); assert.equal(r.status, 422, JSON.stringify(b)); assert.ok((await r.json()).details[k], k); }
  fern = (await J('POST', '/plants', { name: ' Fern ', species: 'Boston', location: 'Bathroom', everyDays: 8, added: '2026-07-01' })).id; cactus = (await J('POST', '/plants', { name: 'Cactus', everyDays: 21, seasonal: false, added: '2026-07-01' })).id;
  const f = await J('GET', `/plants/${fern}`); assert.deepEqual([f.name, f.lastWatered, f.nextWatering, f.status, f.daysLeft, f.season, f.currentInterval], ['Fern', null, '2026-07-01', 'overdue', -9, 'summer', 6]);
});
test('watering: seasonal interval, history, same-day idempotence, validation', async () => {
  let f = await (await call('POST', `/plants/${fern}/water`, { day: '2026-07-08', note: 'a bit' })).json(); assert.deepEqual([f.lastWatered, f.nextWatering, f.status, f.daysLeft], ['2026-07-08', '2026-07-14', 'ok', 4], 'summer interval 6 days');
  assert.equal((await call('POST', `/plants/${fern}/water`, { day: '2026-07-08', note: 'updated' })).status, 201); assert.equal((await J('GET', `/plants/${fern}`)).waterings, 1, 'one watering per day');
  for (const [b, k] of [[{ day: '2026-07-11' }, 'day'], [{ day: '2026-06-30' }, 'day'], [{ day: '2026-02-30' }, 'day'], [{ note: 'x'.repeat(101) }, 'note']]) { const r = await call('POST', `/plants/${fern}/water`, b); assert.equal(r.status, 422, JSON.stringify(b)); assert.ok((await r.json()).details[k], k); }
  f = await J('POST', `/plants/${cactus}/water`, {}); const c = await f; assert.equal(c.lastWatered, '2026-07-10'); assert.equal(c.nextWatering, '2026-07-31', 'non-seasonal plants keep their plain interval');
});
test('today board groups by urgency and sorts by days left', async () => {
  clock = '2026-07-13T12:00:00Z'; const t = await J('GET', '/today'); assert.deepEqual(t.soon.map((x) => x.name), ['Fern']); assert.equal(t.overdue.length, 0); assert.deepEqual(t.ok.map((x) => x.name), ['Cactus']);
  clock = '2026-07-14T12:00:00Z'; assert.deepEqual((await J('GET', '/today')).today_.map((x) => x.name), ['Fern']); clock = '2026-07-20T12:00:00Z'; const late = await J('GET', '/today'); assert.deepEqual(late.overdue.map((x) => [x.name, x.daysLeft]), [['Fern', -6]]); assert.equal(late.total, 2); clock = '2026-07-10T12:00:00Z';
});
test('winter slows watering; the southern hemisphere flips seasons', async () => {
  await call('POST', `/plants/${fern}/water`, { day: '2026-07-10' }); clock = '2026-12-20T12:00:00Z'; const w = await J('POST', `/plants/${fern}/water`, {}); assert.deepEqual([w.season, w.currentInterval, w.nextWatering], ['winter', 14, '2027-01-03']);
  assert.deepEqual(await J('PUT', '/settings', { southern: true }), { southern: true }); const s = await J('GET', `/plants/${fern}`); assert.deepEqual([s.season, s.currentInterval, s.nextWatering], ['summer', 6, '2026-12-26']); assert.equal((await call('PUT', '/settings', { southern: 'x' })).status, 422); await J('PUT', '/settings', { southern: false }); clock = '2026-07-10T12:00:00Z';
});
test('undo watering, edit, archive hides from the board, adherence, delete', async () => {
  const del = await call('DELETE', `/plants/${fern}/water/2026-12-20`); assert.equal(del.status, 200); assert.equal((await call('DELETE', `/plants/${fern}/water/2026-12-20`)).status, 404); assert.equal((await call('DELETE', `/plants/${fern}/water/nope`)).status, 400);
  await call('POST', `/plants/${fern}/water`, { day: '2026-07-10' }); const d = await J('GET', `/plants/${fern}`); assert.ok(d.history.length >= 2); assert.ok(d.adherence === null || typeof d.adherence.meanGap === 'number');
  assert.equal((await J('PATCH', `/plants/${fern}`, { everyDays: 10, location: ' Hall ' })).location, 'Hall'); assert.equal((await call('PATCH', `/plants/${fern}`, { everyDays: 0 })).status, 422);
  const a = await J('PATCH', `/plants/${fern}`, { archived: true }); assert.equal(a.status, 'archived'); assert.equal((await J('GET', '/today')).total, 1); assert.equal((await call('POST', `/plants/${fern}/water`, {})).status, 409);
  assert.equal((await call('DELETE', `/plants/${fern}`)).status, 204); assert.equal((await call('GET', `/plants/${fern}`)).status, 404); assert.equal((await J('GET', '/today?today=2026-07-11')).today, '2026-07-11'); assert.equal((await J('GET', '/today?today=2030-01-01')).today, '2026-07-10'); assert.equal((await call('GET', '/plants/zz')).status, 400);
  assert.equal((await fetch(base + '/api/plants', { method: 'POST', body: '{x' })).status, 400); assert.equal((await fetch(base + '/%2e%2e/package.json')).status, 404);
});
