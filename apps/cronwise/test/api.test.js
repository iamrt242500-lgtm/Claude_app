import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/server.js';

let base, server;
const call = (m, p, b) => fetch(base + '/api' + p, { method: m, headers: { 'Content-Type': 'application/json' }, body: b === undefined ? undefined : JSON.stringify(b) });
before(async () => { server = createApp({ now: () => new Date('2026-01-01T00:00:00Z') }).server; await new Promise((r) => server.listen(0, r)); base = `http://127.0.0.1:${server.address().port}`; });
after(() => server.close());

test('explain valid, invalid, count clamp', async () => {
  const ok = await (await call('POST', '/explain', { expr: ' */30   * * * * ', count: 3 })).json();
  assert.equal(ok.valid, true); assert.equal(ok.expr, '*/30 * * * *'); assert.deepEqual(ok.next, ['2026-01-01T00:30:00.000Z', '2026-01-01T01:00:00.000Z', '2026-01-01T01:30:00.000Z']);
  assert.equal((await (await call('POST', '/explain', { expr: '* * * *' })).json()).valid, false);
  assert.equal((await (await call('POST', '/explain', {})).json()).valid, false);
  assert.equal((await (await call('POST', '/explain', { expr: '* * * * *', count: 9999 })).json()).next.length, 25);
});
test('jobs CRUD with validation', async () => {
  const bad = await call('POST', '/jobs', { label: '', expr: 'nope' }); assert.equal(bad.status, 422);
  const d = (await bad.json()).details; assert.ok(d.label && d.expr);
  const r = await call('POST', '/jobs', { label: 'Backup', expr: '0  3 * * *' }); assert.equal(r.status, 201);
  const j = await r.json(); assert.equal(j.expr, '0 3 * * *'); assert.equal(j.nextRun, '2026-01-01T03:00:00.000Z'); assert.match(j.description, /03:00/);
  const u = await (await call('PUT', `/jobs/${j.id}`, { label: 'Nightly', expr: '@daily' })).json(); assert.equal(u.label, 'Nightly'); assert.equal(u.nextRun, '2026-01-02T00:00:00.000Z');
  assert.equal((await call('PUT', `/jobs/${j.id}`, { label: 'x', expr: 'bad' })).status, 422);
  assert.equal((await (await call('GET', '/jobs')).json()).length, 1);
  assert.equal((await call('DELETE', `/jobs/${j.id}`)).status, 204);
  assert.equal((await call('DELETE', `/jobs/${j.id}`)).status, 404);
});
test('errors, static, traversal', async () => {
  assert.equal((await call('GET', '/jobs/abc')).status, 400); assert.equal((await call('GET', '/nope')).status, 404);
  assert.equal((await fetch(base + '/api/explain', { method: 'POST', body: '{x' })).status, 400);
  const big = await fetch(base + '/api/explain', { method: 'POST', body: JSON.stringify({ expr: 'x'.repeat(30000) }) }); assert.equal(big.status, 413);
  assert.equal((await fetch(base + '/%2e%2e/package.json')).status, 404);
});
