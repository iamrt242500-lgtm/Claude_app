import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/server.js';

let base, server, nowIso = '2026-03-09T12:00:00Z';
const call = (m, p, b) => fetch(base + '/api' + p, { method: m, headers: { 'Content-Type': 'application/json' }, body: b === undefined ? undefined : JSON.stringify(b) });
before(async () => { server = createApp({ now: () => new Date(nowIso) }).server; await new Promise((r) => server.listen(0, r)); base = `http://127.0.0.1:${server.address().port}`; });
after(() => server.close());

test('habit lifecycle, check-in idempotency, streaks and backfill', async () => {
  assert.equal((await call('POST', '/habits', { name: '', schedule: [1] })).status, 422);
  assert.equal((await call('POST', '/habits', { name: 'x', schedule: [] })).status, 422);
  assert.equal((await call('POST', '/habits', { name: 'x', schedule: [9] })).status, 422);
  const h = await (await call('POST', '/habits', { name: 'Read', schedule: [0, 1, 2, 3, 4, 5, 6] })).json();
  assert.equal(h.scheduledToday, true); assert.equal(h.currentStreak, 0);
  let r = await (await call('PUT', `/habits/${h.id}/checkins/2026-03-09`)).json(); assert.equal(r.doneToday, true); assert.equal(r.currentStreak, 1);
  r = await (await call('PUT', `/habits/${h.id}/checkins/2026-03-09`)).json(); assert.equal(r.total, 1, 'idempotent');
  r = await (await call('PUT', `/habits/${h.id}/checkins/2026-03-07`)).json(); assert.equal(r.currentStreak, 1, 'gap on the 8th');
  r = await (await call('PUT', `/habits/${h.id}/checkins/2026-03-08`)).json(); assert.equal(r.currentStreak, 3); assert.equal(r.longestStreak, 3);
  assert.equal(r.createdOn, '2026-03-09'); assert.deepEqual(r.recent, ['2026-03-07', '2026-03-08', '2026-03-09']);
  r = await (await call('DELETE', `/habits/${h.id}/checkins/2026-03-08`)).json(); assert.equal(r.currentStreak, 1);
  const u = await (await call('PUT', `/habits/${h.id}`, { name: 'Read daily', schedule: [1, 2, 3, 4, 5] })).json(); assert.equal(u.name, 'Read daily');
  assert.equal((await call('DELETE', `/habits/${h.id}`)).status, 204); assert.equal((await call('GET', `/habits/${h.id}`)).status, 404);
});
test('check-in validation: future, malformed, impossible date', async () => {
  const h = await (await call('POST', '/habits', { name: 'V', schedule: [1] })).json();
  for (const [d, re] of [['2026-03-10', /future/], ['2026-02-30', /Invalid date/], ['yesterday', /Invalid date/], ['1999-01-01', /too far/]]) {
    const r = await call('PUT', `/habits/${h.id}/checkins/${d}`); assert.equal(r.status, 422, d); assert.match((await r.json()).details.date, re);
  }
});
test('client-supplied today is honored within ±1 day of UTC only (timezones)', async () => {
  const day = async (q) => (await (await call('GET', `/habits${q}`)).json()).today;
  assert.equal(await day(''), '2026-03-09'); assert.equal(await day('?today=2026-03-10'), '2026-03-10'); assert.equal(await day('?today=2026-03-08'), '2026-03-08');
  assert.equal(await day('?today=2026-03-20'), '2026-03-09', 'far-off value ignored'); assert.equal(await day('?today=junk'), '2026-03-09');
  const h = await (await call('POST', '/habits', { name: 'TZ', schedule: [0, 1, 2, 3, 4, 5, 6] })).json();
  assert.equal((await call('PUT', `/habits/${h.id}/checkins/2026-03-10?today=2026-03-10`)).status, 200, 'ahead-of-UTC user may check in on their today');
});
test('errors and static', async () => {
  assert.equal((await call('GET', '/habits/abc')).status, 400); assert.equal((await call('GET', '/habits/999')).status, 404);
  assert.equal((await fetch(base + '/api/habits', { method: 'POST', body: '{x' })).status, 400); assert.equal((await fetch(base + '/%2e%2e/package.json')).status, 404);
});
