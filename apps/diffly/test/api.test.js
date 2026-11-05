import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/server.js';

let base, server;
const call = (m, p, b) => fetch(base + '/api' + p, { method: m, headers: { 'Content-Type': 'application/json' }, body: b === undefined ? undefined : JSON.stringify(b) });
before(async () => { server = createApp().server; await new Promise((r) => server.listen(0, r)); base = `http://127.0.0.1:${server.address().port}`; });
after(() => server.close());

test('POST /diff returns rows, stats, unified text; options respected', async () => {
  const r = await (await call('POST', '/diff', { left: 'a\nb\nc', right: 'a\nB\nc\nd' })).json(); assert.deepEqual(r.rows.map((x) => x.type), ['eq', 'mod', 'eq', 'add']); assert.equal(r.stats.added, 2); assert.equal(r.stats.removed, 1); assert.match(r.unified, /^--- left\n\+\+\+ right\n@@ /);
  assert.equal((await (await call('POST', '/diff', { left: 'A  b', right: 'a b', ignoreCase: true, ignoreWhitespace: true })).json()).stats.identical, true); assert.equal((await (await call('POST', '/diff', { left: '', right: '' })).json()).stats.identical, true);
});
test('validation: non-text, oversize characters, oversize lines (all 422 with a clear message)', async () => {
  assert.equal((await call('POST', '/diff', { left: 1, right: 'x' })).status, 422); const big = await call('POST', '/diff', { left: 'x'.repeat(400_001), right: '' }); assert.equal(big.status, 422); assert.match((await big.json()).details.left, /400,000 characters/);
  const lines = await call('POST', '/diff', { left: 'a\n'.repeat(8001), right: '' }); assert.equal(lines.status, 422); assert.match((await lines.json()).details.left, /8000 lines/);
  const huge = await fetch(base + '/api/diff', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ left: 'x'.repeat(1_300_000), right: '' }) }); assert.equal(huge.status, 413); assert.equal((await fetch(base + '/api/diff', { method: 'POST', body: '{x' })).status, 400);
});
test('saved comparisons: create stores stats, list is light, get returns the texts, delete', async () => {
  assert.equal((await call('POST', '/comparisons', { title: '', left: 'a', right: 'b' })).status, 422);
  const c = await (await call('POST', '/comparisons', { title: ' Config change ', left: 'port=80\nhost=a', right: 'port=8080\nhost=a\ndebug=1', ignoreCase: true })).json(); assert.equal(c.title, 'Config change'); assert.equal(c.added, 2); assert.equal(c.removed, 1); assert.equal(c.left, 'port=80\nhost=a'); assert.equal(c.ignoreCase, true);
  const list = await (await call('GET', '/comparisons')).json(); assert.equal(list[0].left, undefined); assert.equal(list[0].added, 2); assert.equal((await (await call('GET', `/comparisons/${c.id}`)).json()).right, 'port=8080\nhost=a\ndebug=1');
  assert.equal((await call('DELETE', `/comparisons/${c.id}`)).status, 204); assert.equal((await call('GET', `/comparisons/${c.id}`)).status, 404);
});
test('shared module is served; errors and static', async () => {
  const m = await fetch(base + '/diff.js'); assert.equal(m.status, 200); assert.match(await m.text(), /export function myers/); assert.equal((await call('GET', '/comparisons/abc')).status, 400); assert.equal((await fetch(base + '/%2e%2e/package.json')).status, 404); assert.equal((await call('GET', '/nope')).status, 404);
});
