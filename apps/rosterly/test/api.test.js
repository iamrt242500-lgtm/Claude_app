import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/server.js';

let base, server, ana, ben;
const call = (m, p, b) => fetch(base + '/api' + p, { method: m, headers: { 'Content-Type': 'application/json' }, body: b === undefined ? undefined : JSON.stringify(b) });
const J = async (m, p, b) => (await call(m, p, b)).json();
before(async () => { server = createApp().server; await new Promise((r) => server.listen(0, r)); base = `http://127.0.0.1:${server.address().port}`; ana = (await J('POST', '/people', { name: 'Ana', role: 'Barista' })).id; ben = (await J('POST', '/people', { name: 'Ben', role: 'Cook', unavailable: [0] })).id; });
after(() => server.close());
const shift = (personId, day, start, end, extra = {}) => call('POST', '/shifts', { personId, day, start, end, ...extra });

test('people: validation, case-insensitive uniqueness, normalised weekdays', async () => {
  assert.equal((await call('POST', '/people', { name: 'ana' })).status, 422); const r = await call('POST', '/people', { name: '', role: 'x'.repeat(31), unavailable: [7] }); assert.deepEqual(Object.keys((await r.json()).details).sort(), ['name', 'role', 'unavailable']);
  const c = await J('POST', '/people', { name: 'Cy', unavailable: [6, 0, 6] }); assert.deepEqual(c.unavailable, [0, 6]); assert.equal((await call('PUT', `/people/${c.id}`, { name: 'ANA' })).status, 422); await call('DELETE', `/people/${c.id}`);
});
test('shifts: create, validate times, open shifts have no conflicts', async () => {
  const ok = await shift(ana, '2026-03-09', '09:00', '17:00'); assert.equal(ok.status, 201); const s = await ok.json(); assert.equal(s.hours, 8); assert.deepEqual(s.problems, []);
  const bad = await call('POST', '/shifts', { personId: ana, day: '2026-02-30', start: '9:00', end: '25:00', note: 'x'.repeat(101) }); assert.deepEqual(Object.keys((await bad.json()).details).sort(), ['day', 'end', 'note', 'start']);
  assert.equal((await shift(ana, '2026-03-10', '09:00', '09:00')).status, 422); assert.equal((await shift(ana, '2026-03-10', '05:00', '23:00')).status, 422, '18 h'); assert.equal((await shift(9999, '2026-03-10', '09:00', '10:00')).status, 422);
  const open = await shift(null, '2026-03-09', '09:00', '17:00'); assert.equal(open.status, 201); assert.equal((await open.json()).personId, null);
});
test('assigning a conflicting shift returns 409 with reasons; force overrides and flags it', async () => {
  const r = await shift(ana, '2026-03-09', '16:00', '20:00'); assert.equal(r.status, 409); const j = await r.json(); assert.deepEqual(j.problems.map((p) => p.code), ['overlap']);
  const rest = await shift(ana, '2026-03-10', '02:00', '06:00'); assert.equal(rest.status, 409); assert.deepEqual((await rest.json()).problems.map((p) => p.code), ['rest'], '09:00 shift ended 17:00 → 9 h < 11 h');
  const forced = await shift(ana, '2026-03-10', '02:00', '06:00', { force: true }); assert.equal(forced.status, 201); assert.deepEqual((await forced.json()).problems.map((p) => p.code), ['rest']);
});
test('weekly cap, time off, unavailability and settings', async () => {
  const wk = '2026-03-16'; for (let i = 0; i < 4; i++) assert.equal((await shift(ben, `2026-03-${16 + i}`, '09:00', '19:00')).status, 201);   // 4 × 10 h = 40 h, all fine
  const over = await shift(ben, '2026-03-20', '09:00', '10:00'); assert.equal(over.status, 409); assert.match((await over.json()).problems[0].message, /41 h this week \(max 40 h\)/);
  const sun = await shift(ben, '2026-03-22', '10:00', '12:00'); assert.equal(sun.status, 409); assert.deepEqual((await sun.json()).problems.map((p) => p.code), ['weekly', 'unavailable'], 'Sunday belongs to the already-full Monday week, and Ben is never available on Sundays');
  await J('POST', '/timeoff', { personId: ana, day: '2026-03-25' }); assert.deepEqual((await (await shift(ana, '2026-03-25', '09:00', '12:00')).json()).problems.map((p) => p.code), ['timeoff']);
  assert.equal((await call('PUT', '/settings', { maxWeeklyHours: 200, minRestHours: -1 })).status, 422); await J('PUT', '/settings', { maxWeeklyHours: 45, minRestHours: 11 }); assert.equal((await shift(ben, '2026-03-20', '09:00', '10:00')).status, 201, 'cap raised to 45');
});
test('editing a shift ignores itself; moving into a conflict is rejected', async () => {
  const s = await (await shift(ana, '2026-04-06', '09:00', '13:00')).json(); const t = await call('PUT', `/shifts/${s.id}`, { end: '15:00' }); assert.equal(t.status, 200); assert.equal((await t.json()).hours, 6, 'extending own shift is not an overlap with itself');
  const other = await (await shift(ana, '2026-04-07', '14:00', '18:00')).json(); assert.equal((await call('PUT', `/shifts/${other.id}`, { day: '2026-04-06' })).status, 409);
  const reassigned = await call('PUT', `/shifts/${other.id}`, { personId: null }); assert.equal((await reassigned.json()).personId, null);
});
test('schedule: week window, hours per person, coverage including overnight spill, open and problem counts', async () => {
  const g = await J('POST', '/people', { name: 'Gus' }); await shift(g.id, '2026-05-03', '22:00', '06:00', { note: 'night' }); await shift(g.id, '2026-05-04', '20:00', '23:00'); await shift(null, '2026-05-05', '09:00', '12:00');
  const w = await J('GET', '/schedule?week=2026-05-06'); assert.equal(w.from, '2026-05-04'); assert.equal(w.to, '2026-05-10'); assert.equal(w.shifts.length, 2, 'Sunday 05-03 night shift belongs to the previous week'); assert.equal(w.hoursByPerson[g.id], 3); assert.equal(w.open, 1);
  assert.deepEqual(w.coverage['2026-05-04'].slice(0, 7), [1, 1, 1, 1, 1, 1, 0], 'the 05-03 night shift still covers early Monday'); assert.equal(w.coverage['2026-05-04'][21], 1); assert.equal(w.coverage['2026-05-04'][10], 0); assert.equal((await call('GET', '/schedule?week=zz')).status, 400);
});
test('deleting a person turns their shifts into open shifts; timeoff delete; errors', async () => {
  const h = await J('POST', '/people', { name: 'Hal' }); const s = await (await shift(h.id, '2026-06-01', '09:00', '10:00')).json(); assert.equal((await call('DELETE', `/people/${h.id}`)).status, 204); assert.equal((await J('GET', `/shifts/${s.id}`)).personId, null);
  const t = await J('POST', '/timeoff', { personId: ana, day: '2026-07-01' }); assert.equal((await call('DELETE', `/timeoff/${t.id}`)).status, 204); assert.equal((await call('DELETE', `/timeoff/${t.id}`)).status, 404); assert.equal((await call('POST', '/timeoff', { personId: ana, day: '2026-02-30' })).status, 422);
  assert.equal((await fetch(base + '/api/shifts', { method: 'POST', body: '{x' })).status, 400); assert.equal((await fetch(base + '/%2e%2e/package.json')).status, 404); assert.equal((await call('GET', '/shifts/999')).status, 404);
});
