import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/server.js';

let base, server, clock = '2026-03-15T12:00:00Z';
before(async () => { server = createApp({ now: () => new Date(clock) }).server; await new Promise((r) => server.listen(0, r)); base = `http://127.0.0.1:${server.address().port}`; });
after(() => server.close());
const call = (m, p, b) => fetch(base + '/api' + p, { method: m, headers: { 'Content-Type': 'application/json' }, body: b === undefined ? undefined : JSON.stringify(b) });
const J = async (m, p, b) => (await call(m, p, b)).json();
const mk = (name, price, unit, every, start, category = 'software') => J('POST', '/subs', { name, price, unit, every, start, category });

test('create: normalisation and next renewal incl. month-end clamping; validation', async () => {
  const s = await mk(' Streamy ', '$15.99', 'month', 1, '2025-08-31', 'entertainment'); assert.deepEqual([s.name, s.price, s.nextRenewal, s.daysUntil, s.monthly, s.yearly], ['Streamy', 1599, '2026-03-31', 16, 1599, 19188]);
  for (const [b, k] of [[{ name: '', price: '1', unit: 'month', every: 1, start: '2026-01-01' }, 'name'], [{ name: 'x', price: 9.99, unit: 'month', every: 1, start: '2026-01-01' }, 'price'], [{ name: 'x', price: '1', unit: 'day', every: 1, start: '2026-01-01' }, 'unit'], [{ name: 'x', price: '1', unit: 'month', every: 0, start: '2026-01-01' }, 'every'], [{ name: 'x', price: '1', unit: 'month', every: 1, start: '2026-02-30' }, 'start'], [{ name: 'x', price: '1', unit: 'month', every: 1, start: '2026-01-01', category: 'fun' }, 'category']]) { const r = await call('POST', '/subs', b); assert.equal(r.status, 422, JSON.stringify(b)); assert.ok((await r.json()).details[k], k); }
});
test('yearly and weekly plans: equivalents and renewals', async () => {
  const y = await mk('Cloud', '120', 'year', 1, '2025-06-10'); assert.deepEqual([y.nextRenewal, y.monthly, y.yearly], ['2026-06-10', 1000, 12000]); const w = await mk('Paper', '5', 'week', 1, '2026-03-02', 'news'); assert.deepEqual([w.nextRenewal, w.monthly], ['2026-03-16', 2167]);
  const leap = await mk('Leap', '10', 'year', 1, '2024-02-29'); assert.equal(leap.nextRenewal, '2027-02-28');
});
test('overview: totals, categories, upcoming list within the horizon, spending forecast', async () => {
  const o = await J('GET', '/overview?days=30'); assert.equal(o.count, 4); assert.equal(o.monthly, 1599 + 1000 + 2167 + 83); assert.equal(o.yearly, 19188 + 12000 + 26000 + 1000);
  assert.deepEqual(o.byCategory.map((c) => c.category), ['entertainment', 'news', 'software'].sort((a, b) => ({ entertainment: 1599, news: 2167, software: 1083 }[b] - { entertainment: 1599, news: 2167, software: 1083 }[a]))); 
  const weeks = o.upcoming.filter((u) => u.name === 'Paper'); assert.deepEqual(weeks.map((u) => u.date), ['2026-03-16', '2026-03-23', '2026-03-30', '2026-04-06', '2026-04-13']); assert.equal(o.upcoming.find((u) => u.name === 'Streamy').date, '2026-03-31');
  assert.ok(o.upcoming.every((u, i, a) => !i || a[i - 1].date <= u.date), 'sorted'); assert.equal(o.upcomingTotal, o.upcoming.reduce((s, u) => s + u.amount, 0)); assert.equal(o.upcoming.find((u) => u.name === 'Cloud'), undefined, 'June is outside 30 days');
  assert.equal((await J('GET', '/overview?days=365')).upcoming.find((u) => u.name === 'Cloud').date, '2026-06-10'); for (const d of ['0', '400', 'x', '1.5']) assert.equal((await call('GET', '/overview?days=' + d)).status, 422, d);
});
test('cancel / resume: removed from totals, counted as savings, no renewal shown', async () => {
  const before = await J('GET', '/overview'); const subs = await J('GET', '/subs'); const paper = subs.find((s) => s.name === 'Paper'); const c = await J('POST', `/subs/${paper.id}/cancel`); assert.deepEqual([c.active, c.nextRenewal, c.daysUntil, c.cancelledDay], [false, null, null, '2026-03-15']);
  const after = await J('GET', '/overview'); assert.equal(after.monthly, before.monthly - 2167); assert.equal(after.savedPerMonth, 2167); assert.equal(after.savedPerYear, 26000); assert.equal(after.cancelledCount, 1); assert.ok(!after.upcoming.some((u) => u.name === 'Paper'));
  assert.equal((await call('POST', `/subs/${paper.id}/cancel`)).status, 409); assert.equal((await J('POST', `/subs/${paper.id}/resume`)).active, true); assert.equal((await call('POST', `/subs/${paper.id}/resume`)).status, 409);
});
test('list is ordered by next renewal; patch re-validates; details; delete; client date', async () => {
  const list = await J('GET', '/subs'); assert.deepEqual(list.map((s) => s.name), ['Paper', 'Streamy', 'Cloud', 'Leap']); const id = list[1].id; const p = await J('PATCH', `/subs/${id}`, { price: '17.99', category: 'news' }); assert.deepEqual([p.price, p.category, p.name], [1799, 'news', 'Streamy']); assert.equal((await call('PATCH', `/subs/${id}`, { price: 'abc' })).status, 422);
  const d = await J('GET', `/subs/${id}`); assert.equal(d.upcoming.length, 6); assert.equal(d.upcoming[0], '2026-03-31'); assert.equal((await call('DELETE', `/subs/${id}`)).status, 204); assert.equal((await call('GET', `/subs/${id}`)).status, 404);
  assert.equal((await J('GET', '/overview?today=2026-03-16')).today, '2026-03-16'); assert.equal((await J('GET', '/overview?today=2030-01-01')).today, '2026-03-15'); assert.equal((await call('GET', '/subs/zz')).status, 400); assert.equal((await fetch(base + '/api/subs', { method: 'POST', body: '{x' })).status, 400); assert.equal((await fetch(base + '/%2e%2e/package.json')).status, 404);
});
