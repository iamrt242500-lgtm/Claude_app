import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/server.js';

let base, server;
const call = (m, p, b) => fetch(base + '/api' + p, { method: m, headers: { 'Content-Type': 'application/json' }, body: b === undefined ? undefined : JSON.stringify(b) });
before(async () => { server = createApp({ now: () => new Date('2026-03-11T10:00:00Z') }).server; await new Promise((r) => server.listen(0, r)); base = `http://127.0.0.1:${server.address().port}`; });
after(() => server.close());
const NOTES = 'Attendees: Sam, Priya\nTODO: update the budget sheet by Friday\nSam will draft the announcement by end of week\nPriya to send the proposal next Tuesday\nWe need to decide on pricing';

test('extract endpoint is stateless and validates the date', async () => {
  const t = await (await call('POST', '/extract', { notes: NOTES, day: '2026-03-11' })).json(); assert.equal(t.length, 4); assert.deepEqual(t.find((x) => x.owner === 'Priya'), { text: 'Send the proposal', owner: 'Priya', due: '2026-03-17', line: 4, source: 'owner-verb' });
  assert.equal((await call('POST', '/extract', { notes: 'x', day: '2026-13-01' })).status, 422); assert.deepEqual(await (await call('POST', '/extract', { day: '2026-03-11' })).json(), []);
});
test('create meeting extracts tasks; validation reports all problems', async () => {
  const bad = await call('POST', '/meetings', { title: '', day: '2026-02-30' }); assert.equal(bad.status, 422); assert.deepEqual(Object.keys((await bad.json()).details).sort(), ['day', 'title']);
  const m = await (await call('POST', '/meetings', { title: 'Weekly sync', day: '2026-03-11', notes: NOTES })).json(); assert.equal(m.tasks.length, 4); assert.equal(m.tasks[0].due, '2026-03-13'); assert.equal(m.tasks.at(-1).due, null, 'tasks without a date sort last');
  assert.equal((await (await call('GET', '/meetings')).json())[0].open, 4);
});
test('editing notes re-syncs: kept tasks keep done/edits, new ones appear, removed ones disappear, manual ones survive', async () => {
  const m = await (await call('POST', '/meetings', { title: 'Sync 2', day: '2026-03-11', notes: NOTES })).json(); const pricing = m.tasks.find((t) => t.text === 'Decide on pricing'), budget = m.tasks.find((t) => t.text === 'Update the budget sheet');
  await call('PATCH', `/tasks/${pricing.id}`, { done: true }); await call('PATCH', `/tasks/${budget.id}`, { due: '2026-04-01', owner: 'Lee' }); const manual = await (await call('POST', '/tasks', { text: 'Buy cake', meetingId: m.id, due: '2026-03-12' })).json();
  const upd = await (await call('PUT', `/meetings/${m.id}`, { title: 'Sync 2', day: '2026-03-11', notes: NOTES.replace('Priya to send the proposal next Tuesday', 'Lee will book the room tomorrow') })).json();
  const by = Object.fromEntries(upd.tasks.map((t) => [t.text, t])); assert.equal(by['Decide on pricing'].done, true); assert.equal(by['Decide on pricing'].id, pricing.id); assert.equal(by['Update the budget sheet'].owner, 'Lee', 'owner edit kept...'); assert.equal(by['Update the budget sheet'].due, '2026-04-01', '...and a hand-edited due date is not overwritten by re-extraction');
  assert.ok(by['Book the room'] && by['Book the room'].owner === 'Lee' && by['Book the room'].due === '2026-03-12'); assert.equal(by['Send the proposal'], undefined, 'task whose line was removed is gone'); assert.ok(by['Buy cake'], 'manual tasks are never deleted by re-extraction');
});
test('tasks: filters, buckets relative to the client date, counts, done toggling, validation', async () => {
  await call('POST', '/tasks', { text: 'Old thing', due: '2026-03-10' }); const all = await (await call('GET', '/tasks?today=2026-03-12')).json(); assert.equal(all.today, '2026-03-12'); assert.ok(all.owners.includes('Sam') && all.owners.includes('Priya')); const overdue = all.tasks.filter((t) => t.bucket === 'overdue'); assert.ok(overdue.length >= 1 && overdue.every((t) => t.due < '2026-03-12')); assert.equal(all.counts.overdue, overdue.length);
  assert.ok((await (await call('GET', '/tasks?owner=sam')).json()).tasks.every((t) => t.owner === 'Sam')); assert.ok((await (await call('GET', '/tasks?status=done')).json()).tasks.every((t) => t.done && t.bucket === 'done'));
  const t = all.tasks.find((x) => !x.done); assert.equal((await (await call('PATCH', `/tasks/${t.id}`, { done: true })).json()).bucket, 'done'); assert.equal((await (await call('PATCH', `/tasks/${t.id}`, { done: false })).json()).done, false);
  for (const [b, key] of [[{ done: 'yes' }, 'done'], [{ due: '2026-02-30' }, 'due'], [{ text: '' }, 'text'], [{ owner: 'x'.repeat(41) }, 'owner']]) { const r = await call('PATCH', `/tasks/${t.id}`, b); assert.equal(r.status, 422); assert.ok((await r.json()).details[key], key); }
  assert.equal((await call('POST', '/tasks', { text: '' })).status, 422); assert.equal((await call('PATCH', '/tasks/999999', { done: true })).status, 404);
  assert.equal((await (await call('GET', '/tasks?today=2030-01-01')).json()).today, '2026-03-11', 'a far-off client date is ignored');
});
test('delete meeting removes its tasks (but not unrelated manual ones); errors and static', async () => {
  const m = await (await call('POST', '/meetings', { title: 'Temp', day: '2026-03-11', notes: 'TODO: ping Zed' })).json(); const free = await (await call('POST', '/tasks', { text: 'Unrelated manual task' })).json();
  assert.equal((await call('DELETE', `/meetings/${m.id}`)).status, 204); const ids = (await (await call('GET', '/tasks')).json()).tasks.map((t) => t.id); assert.ok(!ids.includes(m.tasks[0].id)); assert.ok(ids.includes(free.id));
  assert.equal((await call('GET', '/meetings/abc')).status, 400); assert.equal((await fetch(base + '/api/meetings', { method: 'POST', body: '{x' })).status, 400); assert.equal((await fetch(base + '/%2e%2e/package.json')).status, 404);
  const mod = await fetch(base + '/extract.js'); assert.equal(mod.status, 200); assert.match(await mod.text(), /export function extractTasks/);
});
