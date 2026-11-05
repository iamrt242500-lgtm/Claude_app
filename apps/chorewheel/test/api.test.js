import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/server.js';

let base, server, clock = '2026-03-02T09:00:00Z';   // a Monday
before(async () => { server = createApp({ now: () => new Date(clock) }).server; await new Promise((r) => server.listen(0, r)); base = `http://127.0.0.1:${server.address().port}`; });
after(() => server.close());
const call = (m, p, b) => fetch(base + '/api' + p, { method: m, headers: { 'Content-Type': 'application/json' }, body: b === undefined ? undefined : JSON.stringify(b) });
const J = async (m, p, b) => (await call(m, p, b)).json();
let ann, ben, cy, dishes, bins, laundry;

test('members and chores: validation and normalisation', async () => {
  ann = (await J('POST', '/members', { name: ' Ann ' })).id; ben = (await J('POST', '/members', { name: 'Ben' })).id; cy = (await J('POST', '/members', { name: 'Cy' })).id;
  assert.equal((await call('POST', '/members', { name: 'ann' })).status, 422); assert.equal((await call('POST', '/members', { name: '' })).status, 422); assert.equal((await call('PATCH', `/members/${ann}`, { awayUntil: '2026-02-30' })).status, 422);
  dishes = (await J('POST', '/chores', { name: 'Dishes', points: 1, every: 1, start: '2026-03-02' })).id; bins = (await J('POST', '/chores', { name: 'Bins', points: 3, every: 7, start: '2026-03-02' })).id; laundry = (await J('POST', '/chores', { name: 'Laundry', points: 4, every: 3, start: '2026-03-02' })).id;
  for (const [b, k] of [[{ name: '', points: 1, every: 1, start: '2026-03-02' }, 'name'], [{ name: 'x', points: 0, every: 1, start: '2026-03-02' }, 'points'], [{ name: 'x', points: 11, every: 1, start: '2026-03-02' }, 'points'], [{ name: 'x', points: 1, every: 0, start: '2026-03-02' }, 'every'], [{ name: 'x', points: 1, every: 400, start: '2026-03-02' }, 'every'], [{ name: 'x', points: 1, every: 1, start: '2026-13-02' }, 'start']]) { const r = await call('POST', '/chores', b); assert.equal(r.status, 422, JSON.stringify(b)); assert.ok((await r.json()).details[k], k); }
});
test('board generates a week of instances and assigns them fairly; planning is idempotent', async () => {
  const b1 = await J('GET', '/board'); const total = b1.dueToday.length + b1.upcoming.length; assert.equal(b1.today, '2026-03-02'); assert.equal(b1.overdue.length, 0);
  assert.equal(b1.dueToday.length, 3, 'dishes, bins and laundry are all due on the start day'); assert.equal(total, 11, '7 dishes + 1 bins + 3 laundry (03-02, 05, 08) in the first week');
  const b2 = await J('GET', '/board'); assert.deepEqual(b2.dueToday.map((a) => a.id), b1.dueToday.map((a) => a.id)); assert.deepEqual(b2.upcoming.map((a) => a.id), b1.upcoming.map((a) => a.id));
  const per = Object.fromEntries(b1.members.map((m) => [m.name, m.assignedPoints])); assert.ok(Math.max(...Object.values(per)) - Math.min(...Object.values(per)) <= 4, JSON.stringify(per));
  const heavy = b1.dueToday.map((a) => a.member); assert.equal(new Set(heavy).size, 3, 'three chores due today go to three different people');
});
test('completing and undoing a chore updates done points and rejects invalid input', async () => {
  const b = await J('GET', '/board'), a = b.dueToday.find((x) => x.chore === 'Laundry'); const done = await J('PATCH', `/assignments/${a.id}`, { done: true }); assert.equal(done.doneDay, '2026-03-02');
  const after = await J('GET', '/board'); assert.equal(after.members.find((m) => m.id === a.memberId).donePoints, 4); assert.equal((await call('PATCH', `/assignments/${a.id}`, { memberId: cy })).status, 409, 'finished chores stay with who did them');
  await J('PATCH', `/assignments/${a.id}`, { done: false }); assert.equal((await J('GET', '/board')).members.find((m) => m.id === a.memberId).donePoints, 0);
  assert.equal((await call('PATCH', `/assignments/${a.id}`, { done: 'yes' })).status, 422); assert.equal((await call('PATCH', `/assignments/${a.id}`, { memberId: 9999 })).status, 422); assert.equal((await call('PATCH', '/assignments/99999', { done: true })).status, 404);
});
test('undone chores become overdue on later days and stay until done', async () => {
  clock = '2026-03-04T09:00:00Z'; const b = await J('GET', '/board'); assert.ok(b.overdue.length >= 3, 'the day-1 chores are still open'); assert.ok(b.overdue.every((a) => a.dueDay < '2026-03-04' && !a.doneDay)); assert.equal(b.dueToday.every((a) => a.dueDay === '2026-03-04'), true);
  clock = '2026-03-02T09:00:00Z';
});
test('away members get no assignments in their away window and their open chores are redistributed', async () => {
  const before = await J('GET', '/board'); assert.ok(before.upcoming.concat(before.dueToday).some((a) => a.memberId === ann)); await J('PATCH', `/members/${ann}`, { awayUntil: '2026-03-08' });
  const after = await J('GET', '/board'); assert.equal(after.upcoming.concat(after.dueToday).filter((a) => a.memberId === ann).length, 0); assert.ok(after.members.find((m) => m.id === ann).away);
  const task = await J('POST', '/chores', { name: 'Windows', points: 2, every: 2, start: '2026-03-03' }); const next = await J('GET', '/board'); assert.ok(next.upcoming.filter((a) => a.choreId === task.id).every((a) => a.memberId !== ann), 'new instances also skip the away member');
  await J('PATCH', `/members/${ann}`, { awayUntil: null });
});
test('manual reassignment, removing a member, archiving and deleting chores', async () => {
  const b = await J('GET', '/board'), a = b.upcoming[0]; const to = a.memberId === ben ? cy : ben; assert.equal((await J('PATCH', `/assignments/${a.id}`, { memberId: to })).memberId, to);
  assert.equal((await call('DELETE', `/members/${cy}`)).status, 204); const after = await J('GET', '/board'); assert.ok(after.upcoming.concat(after.dueToday, after.overdue).every((x) => x.memberId !== cy && x.memberId !== null), 'open chores were handed to others');
  await J('PATCH', `/chores/${dishes}`, { archived: true }); assert.equal((await J('GET', '/chores')).find((c) => c.id === dishes).archived, true); assert.equal((await call('DELETE', `/chores/${bins}`)).status, 204); assert.equal((await call('GET', '/members/zz')).status, 400);
  assert.equal((await call('DELETE', '/chores/99999')).status, 404);
});
test('fairness in the board and client date handling', async () => {
  const b = await J('GET', '/board?today=2026-03-03'); assert.equal(b.today, '2026-03-03'); assert.equal((await J('GET', '/board?today=2030-01-01')).today, '2026-03-02'); assert.equal(typeof b.fairness.spread, 'number'); assert.equal(b.windowDays, 28);
  assert.equal((await fetch(base + '/api/members', { method: 'POST', body: '{x' })).status, 400); assert.equal((await fetch(base + '/%2e%2e/package.json')).status, 404);
});
