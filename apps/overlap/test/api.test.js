import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/server.js';

let base, server;
const call = (m, p, b) => fetch(base + '/api' + p, { method: m, headers: { 'Content-Type': 'application/json' }, body: b === undefined ? undefined : JSON.stringify(b) });
before(async () => { server = createApp({ now: () => Date.UTC(2026, 2, 9, 15, 0) }).server; await new Promise((r) => server.listen(0, r)); base = `http://127.0.0.1:${server.address().port}`; });
after(() => server.close());

test('overlap endpoint: NY–London during the mismatched-DST week, per-zone segments and labels', async () => {
  const r = await call('POST', '/overlap', { zones: ['America/New_York', 'Europe/London'], date: '2026-03-09' }); assert.equal(r.status, 200); const o = await r.json();
  assert.equal(o.best.minutes, 240); assert.deepEqual(o.best.local.map((l) => [l.zone, l.start, l.end]), [['America/New_York', '09:00', '13:00'], ['Europe/London', '13:00', '17:00']]);
  assert.deepEqual(o.zones.map((z) => [z.city, z.offsetLabel]), [['New York', 'UTC−4'], ['London', 'UTC+0']]); assert.equal(o.zones[0].nowLocal, '11:00'); assert.equal(o.zones[1].nowLocal, '15:00');
  assert.deepEqual(o.zones[0].segments, [{ from: 36, to: 68 }]); assert.equal(o.workStart, 9);
  const prev = await (await call('POST', '/overlap', { zones: ['America/New_York', 'Europe/London'], date: '2026-03-02' })).json(); assert.equal(prev.best.minutes, 180);
});
test('overlap validation: zones, hours, date; all problems reported together', async () => {
  const bad = await call('POST', '/overlap', { zones: ['Mars/Base'], start: 17, end: 9, date: '2026-02-30' }); assert.equal(bad.status, 422); assert.deepEqual(Object.keys((await bad.json()).details).sort(), ['date', 'hours', 'zones']);
  for (const [b, key, re] of [[{ zones: ['UTC'], date: '2026-03-01' }, 'zones', /2 to 8/], [{ zones: ['UTC', 'UTC'], date: '2026-03-01' }, 'zones', /different/], [{ zones: ['UTC', 'Europe/Paris'], date: '2026-03-01', start: 9.5, end: 17 }, 'hours', /whole hours/], [{ zones: ['UTC', 'Europe/Paris'], date: '2026-03-01', end: 25 }, 'hours', /0–24/], [{ zones: Array(9).fill('UTC'), date: '2026-03-01' }, 'zones', /2 to 8/]]) {
    const r = await call('POST', '/overlap', b); assert.equal(r.status, 422); assert.match((await r.json()).details[key], re);
  }
});
test('zones search: filters by city/region, shows current offset, limited', async () => {
  const r = await (await call('GET', '/zones?q=new%20york')).json(); assert.equal(r[0].zone, 'America/New_York'); assert.equal(r[0].offsetLabel, 'UTC−4'); assert.ok(r.length <= 25);
  assert.ok((await (await call('GET', '/zones?q=kolkata')).json())[0].offsetLabel === 'UTC+5:30'); assert.equal((await (await call('GET', '/zones?q=zzzzzz')).json()).length, 0); assert.equal((await (await call('GET', '/zones')).json()).length, 25);
});
test('teams CRUD with validation and case-insensitive unique names', async () => {
  const team = { name: 'Platform', zones: ['America/New_York', 'Europe/Berlin', 'Asia/Kolkata'], start: 8, end: 18 };
  const bad = await call('POST', '/teams', { name: '', zones: ['UTC'] }); assert.equal(bad.status, 422); assert.ok((await bad.json()).details.name);
  const t = await (await call('POST', '/teams', team)).json(); assert.deepEqual(t.zones, team.zones); assert.equal((await call('POST', '/teams', { ...team, name: 'platform' })).status, 422);
  assert.equal((await (await call('PUT', `/teams/${t.id}`, { ...team, name: 'Platform EU', end: 19 })).json()).end, 19); assert.equal((await (await call('GET', '/teams')).json()).length, 1);
  assert.equal((await call('DELETE', `/teams/${t.id}`)).status, 204); assert.equal((await call('GET', `/teams/${t.id}`)).status, 404);
});
test('errors and static', async () => {
  assert.equal((await call('GET', '/teams/abc')).status, 400); assert.equal((await fetch(base + '/api/overlap', { method: 'POST', body: '{x' })).status, 400); assert.equal((await fetch(base + '/%2e%2e/package.json')).status, 404); assert.equal((await call('GET', '/nope')).status, 404);
});
