import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/server.js';

let base, server, clock = '2026-03-09T09:00:00Z';   // Monday, day 1
before(async () => { server = createApp({ now: () => new Date(clock) }).server; await new Promise((r) => server.listen(0, r)); base = `http://127.0.0.1:${server.address().port}`; });
after(() => server.close());
const call = (m, p, b) => fetch(base + '/api' + p, { method: m, headers: { 'Content-Type': 'application/json' }, body: b === undefined ? undefined : JSON.stringify(b) });
const J = async (m, p, b) => (await call(m, p, b)).json();
let sid; const taskIds = [];

test('sprint validation and creation', async () => {
  for (const [b, k] of [[{ name: '', start: '2026-03-09', end: '2026-03-20' }, 'name'], [{ name: 'x', start: '2026-02-30', end: '2026-03-20' }, 'start'], [{ name: 'x', start: '2026-03-20', end: '2026-03-09' }, 'end'], [{ name: 'x', start: '2026-03-01', end: '2026-06-01' }, 'end'], [{ name: 'x', start: '2026-03-14', end: '2026-03-15' }, 'end']]) { const r = await call('POST', '/sprints', b); assert.equal(r.status, 422, JSON.stringify(b)); assert.ok((await r.json()).details[k], k); }
  const s = await J('POST', '/sprints', { name: 'Sprint 1', start: '2026-03-09', end: '2026-03-20', goal: 'Ship login' }); sid = s.id; assert.equal(s.chart.length, 10); assert.equal(s.forecast.totalWorkdays, 10); assert.equal(s.forecast.status, 'on track', 'no tasks yet'); assert.equal(s.chart[0].remaining, 0);
});
test('tasks: add (scope), validation, ideal line follows scope', async () => {
  for (const [t, p] of [['Login', 8], ['Signup', 5], ['Emails', 5], ['Docs', 2]]) { const r = await call('POST', `/sprints/${sid}/tasks`, { title: t, points: p }); assert.equal(r.status, 201); }
  const d = await J('GET', `/sprints/${sid}`); taskIds.push(...d.tasks.map((t) => t.id)); assert.equal(d.forecast.scope, 20); assert.equal(d.startPoint, 20); assert.deepEqual(d.chart.slice(0, 3).map((c) => c.ideal), [18, 16, 14]); assert.equal(d.chart[0].remaining, 20); assert.equal(d.chart[1].remaining, null, 'future days have no actual yet');
  for (const [b, k] of [[{ title: '', points: 1 }, 'title'], [{ title: 'x', points: 0 }, 'points'], [{ title: 'x', points: 1.5 }, 'points'], [{ title: 'x', points: 1, addedDay: '2026-03-12' }, 'addedDay']]) { const r = await call('POST', `/sprints/${sid}/tasks`, b); assert.equal(r.status, 422, JSON.stringify(b)); assert.ok((await r.json()).details[k], k); }
});
test('finishing work updates the burndown, velocity and forecast day by day', async () => {
  clock = '2026-03-11T09:00:00Z'; await J('PATCH', `/tasks/${taskIds[0]}`, { done: true }); const d = await J('GET', `/sprints/${sid}`); assert.equal(d.forecast.remaining, 12); assert.equal(d.forecast.done, 8); assert.equal(d.forecast.elapsedWorkdays, 3); assert.equal(d.forecast.velocity, 2.67); assert.equal(d.forecast.ideal, 14); assert.equal(d.forecast.status, 'ahead', '12 left vs ideal 14');
  assert.equal(d.forecast.workdaysLeft, 5); assert.equal(d.forecast.finish, '2026-03-18'); assert.equal(d.forecast.finishesInSprint, true);
});
test('scope added mid-sprint is tracked separately and moves the burndown up', async () => {
  const d = await (await call('POST', `/sprints/${sid}/tasks`, { title: 'Urgent bug', points: 3 })).json(); assert.equal(d.forecast.scope, 20, 'committed scope is unchanged'); assert.equal(d.addedAfterStart, 3); assert.equal(d.forecast.remaining, 15);
  assert.equal(d.chart.find((c) => c.day === '2026-03-10').remaining, 20, 'history is not rewritten: the bug did not exist yesterday and Login was finished on 03-11'); assert.equal(d.chart.find((c) => c.day === '2026-03-11').remaining, 15);
});
test('un-doing, editing and deleting tasks', async () => {
  let d = await J('PATCH', `/tasks/${taskIds[0]}`, { done: false }); assert.equal(d.forecast.done, 0); assert.equal(d.forecast.status, 'behind'); d = await J('PATCH', `/tasks/${taskIds[0]}`, { title: ' Login v2 ', points: 13, done: true }); assert.equal(d.tasks.find((t) => t.id === taskIds[0]).title, 'Login v2');
  for (const [b, k] of [[{ title: '' }, 'title'], [{ points: 101 }, 'points'], [{ done: 'yes' }, 'done']]) { const r = await call('PATCH', `/tasks/${taskIds[1]}`, b); assert.equal(r.status, 422); assert.ok((await r.json()).details[k], k); }
  const del = await J('DELETE', `/tasks/${taskIds[3]}`); assert.ok(!del.tasks.some((t) => t.id === taskIds[3])); assert.equal((await call('PATCH', '/tasks/99999', { done: true })).status, 404);
});
test('finishing everything completes the sprint; list view; before start and after end', async () => {
  const d0 = await J('GET', `/sprints/${sid}`); for (const t of d0.tasks.filter((x) => !x.doneDay)) await call('PATCH', `/tasks/${t.id}`, { done: true }); const done = await J('GET', `/sprints/${sid}`); assert.equal(done.forecast.status, 'complete'); assert.equal(done.forecast.remaining, 0);
  const list = await J('GET', '/sprints'); assert.deepEqual(list.map((s) => [s.name, s.status, s.remaining]), [['Sprint 1', 'complete', 0]]);
  clock = '2026-03-02T09:00:00Z'; const before = await J('GET', `/sprints/${sid}`); assert.equal(before.forecast.status, 'not started'); assert.equal(before.forecast.remaining, 23, 'Login (13) + Signup + Emails; the bug was added later');
  clock = '2026-03-30T09:00:00Z'; const after = await J('GET', `/sprints/${sid}?today=2026-03-30`); assert.equal(after.forecast.elapsedWorkdays, 10); assert.equal(after.chart.at(-1).remaining, 0); clock = '2026-03-11T09:00:00Z';
});
test('patch sprint, delete cascades, errors and client date', async () => {
  const r = await J('PATCH', `/sprints/${sid}`, { end: '2026-03-27' }); assert.equal(r.chart.length, 15); assert.equal((await call('PATCH', `/sprints/${sid}`, { end: '2026-03-01' })).status, 422);
  assert.equal((await call('DELETE', `/sprints/${sid}`)).status, 204); assert.equal((await call('GET', `/sprints/${sid}`)).status, 404); assert.equal((await call('GET', '/sprints/zz')).status, 400);
  const s = await J('POST', '/sprints', { name: 'S2', start: '2026-03-09', end: '2026-03-13' }); assert.equal((await J('GET', `/sprints/${s.id}?today=2026-03-12`)).today, '2026-03-12'); assert.equal((await J('GET', `/sprints/${s.id}?today=2030-01-01`)).today, '2026-03-11');
  assert.equal((await fetch(base + '/api/sprints', { method: 'POST', body: '{x' })).status, 400); assert.equal((await fetch(base + '/%2e%2e/package.json')).status, 404);
});
