import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/server.js';

let base, server;
const call = (m, p, b) => fetch(base + '/api' + p, { method: m, headers: { 'Content-Type': 'application/json' }, body: b === undefined ? undefined : JSON.stringify(b) });
before(async () => { server = createApp({ today: () => '2026-03-01' }).server; await new Promise((r) => server.listen(0, r)); base = `http://127.0.0.1:${server.address().port}`; });
after(() => server.close());
const mkGroup = async (members = ['Ann', 'Bob', 'Cy']) => (await call('POST', '/groups', { name: 'Trip', currency: 'EUR', members })).json();
const sum = (o) => Object.values(o).reduce((s, x) => s + x, 0);

test('group validation', async () => {
  for (const [b, key] of [[{ name: '', members: ['a', 'b'] }, 'name'], [{ name: 'x', members: ['a'] }, 'members'], [{ name: 'x', members: ['a', 'A'] }, 'members'], [{ name: 'x', currency: 'JPY', members: ['a', 'b'] }, 'currency']]) {
    const r = await call('POST', '/groups', b); assert.equal(r.status, 422); assert.ok((await r.json()).details[key], key);
  }
});
test('group validation reports every invalid field at once', async () => {
  const r = await call('POST', '/groups', { name: '', currency: 'JPY', members: ['a'] }); assert.deepEqual(Object.keys((await r.json()).details).sort(), ['currency', 'members', 'name']);
});
test('equal split with odd cents, balances sum to zero, settle-up clears them', async () => {
  const g = await mkGroup(); const [a, b, c] = g.members.map((m) => m.id);
  let r = await call('POST', `/groups/${g.id}/expenses`, { description: 'Dinner', amount: '100.00', paidBy: a, split: { type: 'equal', members: [a, b, c] } }); assert.equal(r.status, 201);
  const d = await r.json(); assert.deepEqual(d.expenses[0].shares, { [a]: 3334, [b]: 3333, [c]: 3333 }); assert.equal(sum(d.balances), 0); assert.equal(d.balances[a], 6666);
  assert.equal(d.expenses[0].day, '2026-03-01'); assert.equal(d.total, 10000);
  assert.equal(d.suggestions.length, 2);
  for (const s of d.suggestions) { const rr = await call('POST', `/groups/${g.id}/settlements`, { from: s.from, to: s.to, amount: (s.amount / 100).toFixed(2) }); assert.equal(rr.status, 201); }
  const after = await (await call('GET', `/groups/${g.id}`)).json(); assert.ok(Object.values(after.balances).every((v) => v === 0)); assert.deepEqual(after.suggestions, []);
});
test('exact, percent and shares splits; bad splits rejected with clear messages', async () => {
  const g = await mkGroup(); const [a, b, c] = g.members.map((m) => m.id);
  const add = (split, amount = '30.00') => call('POST', `/groups/${g.id}/expenses`, { description: 'x', amount, paidBy: b, split });
  assert.deepEqual((await (await add({ type: 'exact', values: { [a]: '10', [b]: '5.50', [c]: '14.50' } })).json()).expenses[0].shares, { [a]: 1000, [b]: 550, [c]: 1450 });
  assert.deepEqual((await (await add({ type: 'percent', values: { [a]: 50, [b]: 25, [c]: 25 } })).json()).expenses[0].shares, { [a]: 1500, [b]: 750, [c]: 750 });
  assert.deepEqual((await (await add({ type: 'shares', values: { [a]: 2, [b]: 1 } })).json()).expenses[0].shares, { [a]: 2000, [b]: 1000 });
  let r = await add({ type: 'exact', values: { [a]: '10' } }); assert.equal(r.status, 422); assert.match((await r.json()).details.split, /add up to 10.00 but the total is 30.00/);
  r = await add({ type: 'percent', values: { [a]: 60, [b]: 60 } }); assert.match((await r.json()).details.split, /100/);
  r = await add({ type: 'equal', members: [] }); assert.equal(r.status, 422);
  r = await add({ type: 'equal', members: [999999] }); assert.match((await r.json()).details.split, /unknown member/);
});
test('expense validation, edit and delete update balances', async () => {
  const g = await mkGroup(['P', 'Q']); const [p, q] = g.members.map((m) => m.id);
  for (const [b, key] of [[{ description: '', amount: '5', paidBy: p, split: { type: 'equal', members: [p] } }, 'description'], [{ description: 'x', amount: '0', paidBy: p, split: { type: 'equal', members: [p] } }, 'amount'], [{ description: 'x', amount: '1.999', paidBy: p, split: { type: 'equal', members: [p] } }, 'amount'], [{ description: 'x', amount: '5', paidBy: 999, split: { type: 'equal', members: [p] } }, 'paidBy'], [{ description: 'x', amount: '5', day: '2026-02-30', paidBy: p, split: { type: 'equal', members: [p] } }, 'day']]) {
    const r = await call('POST', `/groups/${g.id}/expenses`, b); assert.equal(r.status, 422); assert.ok((await r.json()).details[key], key);
  }
  let d = await (await call('POST', `/groups/${g.id}/expenses`, { description: 'Taxi', amount: '20', paidBy: p, split: { type: 'equal', members: [p, q] } })).json();
  assert.equal(d.balances[p], 1000); const eid = d.expenses[0].id;
  d = await (await call('PUT', `/groups/${g.id}/expenses/${eid}`, { description: 'Taxi', amount: '40', paidBy: q, split: { type: 'equal', members: [p, q] } })).json(); assert.equal(d.balances[q], 2000);
  d = await (await call('DELETE', `/groups/${g.id}/expenses/${eid}`)).json(); assert.equal(d.expenses.length, 0); assert.equal(d.balances[q], 0);
  assert.equal((await call('DELETE', `/groups/${g.id}/expenses/${eid}`)).status, 404);
});
test('members: add, duplicate, remove protection; settlements validation; delete group', async () => {
  const g = await mkGroup(['A1', 'B1']); const [a, b] = g.members.map((m) => m.id);
  assert.equal((await call('POST', `/groups/${g.id}/members`, { name: 'a1' })).status, 422);
  const d = await (await call('POST', `/groups/${g.id}/members`, { name: 'C1' })).json(); const c = d.members[2].id;
  await call('POST', `/groups/${g.id}/expenses`, { description: 'x', amount: '9', paidBy: a, split: { type: 'equal', members: [a, b] } });
  assert.equal((await call('DELETE', `/groups/${g.id}/members/${a}`)).status, 409);
  assert.equal((await (await call('DELETE', `/groups/${g.id}/members/${c}`)).json()).members.length, 2);
  assert.equal((await call('DELETE', `/groups/${g.id}/members/${b}`)).status, 409);
  for (const [bd, key] of [[{ from: a, to: a, amount: '1' }, 'to'], [{ from: a, to: b, amount: '-1' }, 'amount'], [{ from: 999, to: b, amount: '1' }, 'from']]) { const r = await call('POST', `/groups/${g.id}/settlements`, bd); assert.equal(r.status, 422); assert.ok((await r.json()).details[key]); }
  assert.equal((await call('DELETE', `/groups/${g.id}`)).status, 204); assert.equal((await call('GET', `/groups/${g.id}`)).status, 404);
});
test('errors and static', async () => {
  assert.equal((await call('GET', '/groups/abc')).status, 400); assert.equal((await call('GET', '/groups/9999')).status, 404);
  assert.equal((await fetch(base + '/api/groups', { method: 'POST', body: '{x' })).status, 400); assert.equal((await fetch(base + '/%2e%2e/package.json')).status, 404);
});
