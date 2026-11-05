import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/server.js';

let base, server;
const call = (m, p, b) => fetch(base + '/api' + p, { method: m, headers: { 'Content-Type': 'application/json' }, body: b === undefined ? undefined : JSON.stringify(b) });
before(async () => { server = createApp().server; await new Promise((r) => server.listen(0, r)); base = `http://127.0.0.1:${server.address().port}`; });
after(() => server.close());
const mk = async (o) => (await call('POST', '/snippets', o)).json();

test('CRUD, search ranking/highlight, stemming, filters, pin', async () => {
  assert.equal((await call('POST', '/snippets', { title: '', code: '' })).status, 422);
  const a = await mk({ title: 'Array flatten', language: 'js', code: 'const out = nested.flat(Infinity);', notes: 'flattening nested arrays', tags: 'array, js' });
  const b = await mk({ title: 'Debounce', language: 'ts', code: 'function debounce(fn, ms) { /* flatten calls */ }', tags: 'util' });
  const c = await mk({ title: 'Python list comprehension', language: 'python', code: '[x*2 for x in xs]', tags: 'python, array' });
  let r = await (await call('GET', '/snippets?q=flat')).json();
  assert.deepEqual(r.map((x) => x.id), [a.id, b.id], 'title match ranks first'); assert.ok(r[0].highlight.some((p) => p.hit));
  r = await (await call('GET', '/snippets?q=flattening')).json(); assert.ok(r.length >= 1, 'porter stemming: flattening ~ flatten');
  r = await (await call('GET', '/snippets?q=comprehens')).json(); assert.deepEqual(r.map((x) => x.id), [c.id], 'prefix match');
  assert.equal((await (await call('GET', '/snippets?q=' + encodeURIComponent('"; DROP TABLE snippets; --'))).json()).length, 0);
  assert.deepEqual(await (await call('GET', '/snippets?q=***')).json(), []);
  assert.equal((await (await call('GET', '/snippets?tag=array')).json()).length, 2); assert.equal((await (await call('GET', '/snippets?language=python')).json()).length, 1);
  assert.equal((await (await call('GET', '/snippets?q=flat&tag=util')).json()).length, 1);
  assert.equal((await call('POST', `/snippets/${c.id}/pin`, { pinned: 'yes' })).status, 422);
  assert.equal((await (await call('POST', `/snippets/${c.id}/pin`, { pinned: true })).json()).pinned, true);
  assert.equal((await (await call('GET', '/snippets')).json())[0].id, c.id, 'pinned first');
  assert.equal((await (await call('GET', '/snippets?pinned=1')).json()).length, 1);
  const t = await (await call('GET', '/tags')).json(); assert.equal(t.total, 3); assert.equal(t.tags[0].count, 2);
});
test('update re-indexes; delete removes from index', async () => {
  const s = await mk({ title: 'Zebra stripes', code: 'css here', tags: 'css' });
  assert.equal((await (await call('GET', '/snippets?q=zebra')).json()).length, 1);
  await call('PUT', `/snippets/${s.id}`, { title: 'Giraffe', code: 'css here', tags: 'css,animals' });
  assert.equal((await (await call('GET', '/snippets?q=zebra')).json()).length, 0); assert.equal((await (await call('GET', '/snippets?q=giraffe')).json()).length, 1);
  assert.equal((await (await call('GET', '/snippets?tag=animals')).json()).length, 1);
  assert.equal((await call('DELETE', `/snippets/${s.id}`)).status, 204);
  assert.equal((await (await call('GET', '/snippets?q=giraffe')).json()).length, 0); assert.equal((await call('GET', `/snippets/${s.id}`)).status, 404);
});
test('export / import round trip with partial failures', async () => {
  const exp = await (await call('GET', '/export')).json(); assert.equal(exp.version, 1); assert.ok(exp.snippets.length >= 3);
  const imp = await call('POST', '/import', { snippets: [{ title: 'Imported ok', code: 'x', tags: 'imp' }, { title: '', code: 'y' }, 'junk'] });
  assert.equal(imp.status, 201); const j = await imp.json(); assert.equal(j.imported, 1); assert.equal(j.skipped, 2); assert.equal(j.errors[0].index, 1);
  assert.equal((await (await call('GET', '/snippets?q=imported')).json()).length, 1, 'imported snippets are searchable');
  assert.equal((await call('POST', '/import', { nope: 1 })).status, 422);
  assert.equal((await call('POST', '/import', { snippets: Array.from({ length: 501 }, () => ({})) })).status, 422);
});
test('errors and static', async () => {
  assert.equal((await call('GET', '/snippets/abc')).status, 400); assert.equal((await call('GET', '/snippets/9999')).status, 404);
  assert.equal((await fetch(base + '/api/snippets', { method: 'POST', body: '{x' })).status, 400); assert.equal((await fetch(base + '/%2e%2e/package.json')).status, 404);
});
