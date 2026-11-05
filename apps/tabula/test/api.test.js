import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp, LIMITS } from '../src/server.js';

let base, server;
const call = (m, p, b) => fetch(base + '/api' + p, { method: m, headers: { 'Content-Type': 'application/json' }, body: b === undefined ? undefined : JSON.stringify(b) });
const csv = 'city,sales,date\nParis,10,2026-01-01\nParis,20,2026-01-02\nRome,5,2026-01-03\nRome,,2026-01-04\nOslo,7,2026-01-05\n';
before(async () => { server = createApp().server; await new Promise((r) => server.listen(0, r)); base = `http://127.0.0.1:${server.address().port}`; });
after(() => server.close());

test('upload, profile, rows (paging/search/sort), aggregate, delete', async () => {
  const r = await call('POST', '/datasets', { name: 'Sales', csv }); assert.equal(r.status, 201);
  const d = await r.json(); assert.equal(d.rowCount, 5);
  assert.deepEqual(d.columns.map((c) => c.type), ['text', 'number', 'date']);
  assert.equal(d.columns[1].nulls, 1);
  let rows = await (await call('GET', `/datasets/${d.id}/rows?limit=2&offset=1`)).json(); assert.equal(rows.total, 5); assert.equal(rows.rows.length, 2); assert.equal(rows.rows[0].sales, '20');
  rows = await (await call('GET', `/datasets/${d.id}/rows?q=rome`)).json(); assert.equal(rows.total, 2);
  rows = await (await call('GET', `/datasets/${d.id}/rows?sort=sales&dir=desc`)).json(); assert.equal(rows.rows[0].sales, '20');
  const agg = await (await call('GET', `/datasets/${d.id}/aggregate?group=city&metric=sales&fn=sum`)).json();
  assert.deepEqual(agg.map((x) => [x.key, x.value]), [['Paris', 30], ['Oslo', 7], ['Rome', 5]]);
  assert.equal((await call('GET', `/datasets/${d.id}/aggregate?group=sales&metric=city&fn=sum`)).status, 422);
  assert.equal((await call('GET', `/datasets/${d.id}/rows?sort=nope`)).status, 400);
  assert.equal((await (await call('GET', '/datasets')).json())[0].columnCount, 3);
  assert.equal((await call('DELETE', `/datasets/${d.id}`)).status, 204);
  assert.equal((await call('GET', `/datasets/${d.id}`)).status, 404);
});
test('validation: empty, header-only, unterminated, too many rows, ragged rows padded', async () => {
  assert.equal((await call('POST', '/datasets', { name: '', csv })).status, 422);
  assert.equal((await call('POST', '/datasets', { name: 'x', csv: '  ' })).status, 422);
  assert.equal((await call('POST', '/datasets', { name: 'x', csv: 'a,b' })).status, 422);
  assert.equal((await call('POST', '/datasets', { name: 'x', csv: 'a,b\n"x,1' })).status, 422);
  const big = 'a\n' + '1\n'.repeat(LIMITS.rows + 1);
  assert.equal((await call('POST', '/datasets', { name: 'x', csv: big })).status, 422);
  const ok = await (await call('POST', '/datasets', { name: 'ragged', csv: 'a,b,c\n1\n1,2,3,4' })).json();
  assert.equal(ok.columns.length, 3);
  assert.equal((await fetch(base + '/api/datasets', { method: 'POST', body: '{bad' })).status, 400);
});
test('delimiters: semicolon CSV', async () => {
  const d = await (await call('POST', '/datasets', { name: 's', csv: 'a;b\n1;2\n3;4' })).json(); assert.equal(d.delimiter, ';'); assert.equal(d.columns[1].sum, 6);
});
test('static, traversal, headers, bad ids', async () => {
  const r = await fetch(base + '/'); assert.equal(r.status, 200); assert.ok(r.headers.get('content-security-policy'));
  assert.equal((await fetch(base + '/%2e%2e/package.json')).status, 404);
  assert.equal((await call('GET', '/datasets/abc')).status, 400);
  assert.equal((await call('GET', '/datasets/999')).status, 404);
});
